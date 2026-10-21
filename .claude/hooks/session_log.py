#!/usr/bin/env python3
"""Claude Code session logger for ScoreSmart repos.

Wired as hooks in .claude/settings.json (SessionStart, UserPromptSubmit,
PostToolUse, SessionEnd). Every event is written to Postgres as it happens
(tables claude_sessions, claude_session_events, claude_session_transcripts
in the Prepsmart PTE Supabase project). Local JSONL files are kept as a
buffer; `session_log.py backfill` re-uploads them if the database was down.

Env:
  CLAUDE_LOG_SUPABASE_URL          e.g. https://<project>.supabase.co
  CLAUDE_LOG_SUPABASE_SERVICE_KEY  service role key (set as environment secret,
                                   never committed)

Stdlib only. Never blocks a session: errors go to errors.log and the hook
exits 0.
"""
import getpass
import json
import os
import socket
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DB_URL = os.environ.get("CLAUDE_LOG_SUPABASE_URL", "").rstrip("/")
DB_KEY = os.environ.get("CLAUDE_LOG_SUPABASE_SERVICE_KEY", "")
LOG_ROOT = Path(os.environ.get("CLAUDE_SESSION_LOG_DIR") or (Path.home() / "claude-session-logs"))
MAX_TEXT = 4000
SUMMARY_PROMPT_CHARS = 600

SECRET_PATTERNS = [
    (re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"), "<jwt>"),
    (re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}"), "<api-key>"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}"), "<github-token>"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "<aws-key>"),
    (re.compile(r"(?i)(\b(?:password|passwd|secret|token|api[_-]?key|apikey|authorization)\b[\"']?\s*[:=]\s*[\"']?)[^\s\"',;]+"), r"\1<redacted>"),
    (re.compile(r"https://[^/\s@]+@"), "https://"),
]

GIT_ACTIONS = [
    ("commit", re.compile(r"\bgit\s+commit\b")),
    ("push", re.compile(r"\bgit\s+push\b")),
    ("merge", re.compile(r"\bgit\s+merge\b")),
    ("pr_create", re.compile(r"\bgh\s+pr\s+create\b")),
    ("pr_merge", re.compile(r"\bgh\s+pr\s+merge\b")),
]

GITHUB_MCP_ACTIONS = {
    "mcp__github__create_pull_request",
    "mcp__github__merge_pull_request",
    "mcp__github__push_files",
    "mcp__github__create_or_update_file",
    "mcp__github__create_branch",
    "mcp__github__delete_file",
}

EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
AGENT_TOOLS = {"Agent", "Task"}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def redact(text, limit=MAX_TEXT):
    text = str(text or "")
    for pattern, replacement in SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    if limit and len(text) > limit:
        text = text[:limit] + f"...[+{len(text) - limit} chars]"
    return text


def git(cwd, *args, timeout=20):
    try:
        result = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def repo_info(cwd):
    top = git(cwd, "rev-parse", "--show-toplevel")
    remote = git(cwd, "remote", "get-url", "origin") or ""
    return {
        "repo": Path(top).name if top else Path(cwd).name,
        "remote": redact(remote, 300),
        "branch": git(cwd, "branch", "--show-current") or "",
        "head": git(cwd, "rev-parse", "HEAD") or "",
    }


def who(cwd):
    return git(cwd, "config", "user.email") or os.environ.get("USER") or "unknown"


def machine_info():
    try:
        os_user = getpass.getuser()
    except Exception:
        os_user = os.environ.get("USERNAME") or os.environ.get("USER") or "unknown"
    return {"machine": socket.gethostname() or "unknown", "os_user": os_user}


# ---------- Database (Supabase PostgREST, service role) ----------

def db_enabled():
    return bool(DB_URL and DB_KEY)


def db_call(method, table, body=None, query="", prefer="return=minimal"):
    if not db_enabled():
        raise RuntimeError("CLAUDE_LOG_SUPABASE_URL / _SERVICE_KEY not set")
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{DB_URL}/rest/v1/{table}{query}",
        data=data,
        method=method,
        headers={
            "apikey": DB_KEY,
            "Authorization": f"Bearer {DB_KEY}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"{table} {error.code}: {redact(error.read().decode(errors='replace'), 300)}") from error


def db_upsert_session(state, extra=None):
    row = {
        "session_id": state["session_id"],
        "repo": state["repo"],
        "branch": state.get("branch") or None,
        "user_email": state.get("user"),
        "machine_name": state.get("machine") or None,
        "os_user": state.get("os_user") or None,
        "model": state.get("model") or None,
        "start_source": state.get("source") or None,
        "head_at_start": state.get("head") or None,
        "started_at": state["started_at"],
        "updated_at": now(),
        **(extra or {}),
    }
    db_call("POST", "claude_sessions", [row], "?on_conflict=session_id",
            "resolution=merge-duplicates,return=minimal")


def db_insert_event(session_id, event):
    payload = {k: v for k, v in event.items() if k not in ("ts", "type")}
    db_call("POST", "claude_session_events", [{
        "session_id": session_id,
        "ts": event["ts"],
        "type": event["type"],
        "payload": payload,
    }])


# ---------- Local buffer and state ----------

def state_path(session_id):
    return LOG_ROOT / ".state" / f"{session_id}.json"


def load_state(session_id):
    path = state_path(session_id)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def save_state(state):
    path = state_path(state["session_id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def session_dir(state):
    return LOG_ROOT / "sessions" / state["repo"] / state["session_id"]


def append_event(state, event):
    event = {"ts": now(), **event}
    path = session_dir(state) / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")
    if db_enabled():
        db_insert_event(state["session_id"], event)


def read_events(state):
    path = session_dir(state) / "events.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def load_or_init(inp):
    session_id = inp["session_id"]
    state = load_state(session_id)
    if state is None:
        cwd = inp.get("cwd") or os.getcwd()
        state = {
            "session_id": session_id,
            "started_at": now(),
            "user": who(cwd),
            "model": inp.get("model", ""),
            **machine_info(),
            "transcript_path": inp.get("transcript_path", ""),
            "cwd": cwd,
            **repo_info(cwd),
        }
        save_state(state)
        if db_enabled():
            db_upsert_session(state)
    return state


def read_transcript(path):
    tool_counts, last_text = {}, ""
    if not path or not Path(path).is_file():
        return tool_counts, last_text
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("type") != "assistant":
            continue
        for block in (obj.get("message") or {}).get("content") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                name = block.get("name", "unknown")
                tool_counts[name] = tool_counts.get(name, 0) + 1
            elif block.get("type") == "text" and block.get("text", "").strip():
                last_text = block["text"].strip()
    return tool_counts, last_text


# ---------- Hook handlers ----------

def handle_session_start(inp):
    state = load_or_init(inp)
    state["source"] = inp.get("source", "")
    state["model"] = inp.get("model") or state.get("model", "")
    save_state(state)
    if db_enabled():
        db_upsert_session(state)
    append_event(state, {
        "type": "session_start",
        "source": state["source"],
        "user": state["user"],
        "machine": state.get("machine", ""),
        "os_user": state.get("os_user", ""),
        "repo": state["repo"],
        "branch": state["branch"],
        "head": state["head"],
        "model": state["model"],
    })


def handle_prompt(inp):
    state = load_or_init(inp)
    append_event(state, {"type": "prompt", "text": redact(inp.get("prompt", ""), None)})


def handle_tool(inp):
    state = load_or_init(inp)
    tool = inp.get("tool_name", "")
    tool_input = inp.get("tool_input") or {}

    if tool in AGENT_TOOLS:
        append_event(state, {
            "type": "agent",
            "subagent_type": tool_input.get("subagent_type") or "general-purpose",
            "description": redact(tool_input.get("description", ""), 200),
            "background": bool(tool_input.get("run_in_background")),
            "isolation": tool_input.get("isolation") or "",
            "prompt": redact(tool_input.get("prompt", ""), None),
        })
    elif tool == "Bash":
        command = tool_input.get("command", "")
        actions = [name for name, pattern in GIT_ACTIONS if pattern.search(command)]
        if actions:
            append_event(state, {"type": "git", "actions": actions, "command": redact(command, 400)})
    elif tool in GITHUB_MCP_ACTIONS:
        repo = tool_input.get("repo", "")
        if tool_input.get("owner") and repo:
            repo = f"{tool_input['owner']}/{repo}"
        append_event(state, {
            "type": "github",
            "action": tool.replace("mcp__github__", ""),
            "repo": repo,
            "title": redact(tool_input.get("title", ""), 200),
            "branch": tool_input.get("branch") or tool_input.get("head") or "",
            "base": tool_input.get("base", ""),
            "pull_number": tool_input.get("pullNumber") or tool_input.get("pull_number") or "",
        })
    elif tool in EDIT_TOOLS:
        path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        append_event(state, {"type": "file_edit", "tool": tool, "path": path})


def build_summary(state, events, ended_at, reason, tool_counts, last_text, commits, unpushed, uncommitted):
    prompts = [e for e in events if e["type"] == "prompt"]
    agents = [e for e in events if e["type"] == "agent"]
    git_events = [e for e in events if e["type"] == "git"]
    github_events = [e for e in events if e["type"] == "github"]
    edits = sorted({e["path"] for e in events if e["type"] == "file_edit" and e["path"]})
    pr_count = sum(1 for e in git_events if "pr_create" in e["actions"]) + sum(
        1 for e in github_events if e["action"] == "create_pull_request")

    short = (f"{len(prompts)} prompts, {sum(tool_counts.values())} tool calls, {len(agents)} agents, "
             f"{len(commits)} commits, {pr_count} PRs, {len(edits)} files edited.")
    if last_text:
        short += f" Last reply: {redact(last_text, SUMMARY_PROMPT_CHARS)}"

    lines = [
        f"# Session {state['session_id'][:8]} · {state['repo']} ({state['branch'] or 'detached'})",
        "",
        f"- User: {state['user']}",
        f"- Model: {state.get('model') or 'unknown'}",
        f"- Started: {state['started_at']} (source: {state.get('source') or 'n/a'})",
        f"- Ended: {ended_at} (reason: {reason or 'unknown'})",
        f"- Uncommitted changes at end: {uncommitted if uncommitted is not None else 'unknown'}",
        f"- Unpushed commits at end: {unpushed if unpushed is not None else 'unknown'}",
        "",
        "## Short summary",
        short,
        "",
        f"## Prompts ({len(prompts)})",
    ]
    for index, prompt in enumerate(prompts, 1):
        lines.append(f"{index}. [{prompt['ts']}] {prompt['text']}")
    lines += ["", f"## Agents ({len(agents)})"]
    lines += [f"- {a['subagent_type']}: {a['description']}" for a in agents]
    lines += ["", f"## Git and PRs ({len(commits) + len(git_events) + len(github_events)})"]
    lines += [f"- commit {sha}: {subject}" for sha, subject in commits]
    lines += [f"- {'/'.join(e['actions'])}: `{e['command']}`" for e in git_events]
    lines += [f"- github {e['action']} {e['repo']} {e.get('title') or e.get('pull_number')}".rstrip() for e in github_events]
    lines += ["", f"## Files edited ({len(edits)})"]
    lines += [f"- {path}" for path in edits[:50]]
    if len(edits) > 50:
        lines.append(f"- ...and {len(edits) - 50} more")
    lines += ["", "## Tools used"]
    lines += [f"- {name}: {count}" for name, count in sorted(tool_counts.items(), key=lambda kv: -kv[1])]
    counts = {
        "prompts": len(prompts),
        "tool_calls": sum(tool_counts.values()),
        "agents": len(agents),
        "commits": len(commits),
        "prs": pr_count,
        "git_actions": len(git_events),
        "github_actions": len(github_events),
        "files_edited": len(edits),
    }
    return "\n".join(lines) + "\n", counts


def handle_session_end(inp):
    state = load_or_init(inp)
    state["transcript_path"] = inp.get("transcript_path") or state.get("transcript_path", "")
    reason = inp.get("reason", "")
    append_event(state, {"type": "session_end", "reason": reason})
    events = read_events(state)

    cwd = state["cwd"]
    commits = []
    if state.get("head"):
        log = git(cwd, "log", "--format=%h%x09%s", f"{state['head']}..HEAD") or ""
        commits = [tuple(line.split("\t", 1)) for line in log.splitlines() if "\t" in line]
    unpushed_raw = git(cwd, "rev-list", "--count", "@{u}..HEAD")
    unpushed = int(unpushed_raw) if unpushed_raw and unpushed_raw.isdigit() else None
    status = git(cwd, "status", "--porcelain")
    uncommitted = len(status.splitlines()) if status is not None else None

    tool_counts, last_text = read_transcript(state.get("transcript_path"))
    ended_at = now()
    summary, counts = build_summary(state, events, ended_at, reason, tool_counts, last_text,
                                    commits, unpushed, uncommitted)
    directory = session_dir(state)
    (directory / "summary.md").write_text(summary, encoding="utf-8")

    transcript_file = Path(state.get("transcript_path") or "")
    transcript = redact(transcript_file.read_text(encoding="utf-8", errors="replace"), None) \
        if transcript_file.is_file() else None

    end_fields = {
        "ended_at": ended_at,
        "end_reason": reason or None,
        "uncommitted_at_end": uncommitted,
        "unpushed_at_end": unpushed,
        "summary_md": summary,
        **counts,
    }
    if db_enabled():
        db_upsert_session(state, end_fields)
        if transcript is not None:
            db_call("POST", "claude_session_transcripts", [{
                "session_id": state["session_id"],
                "transcript_jsonl": transcript,
                "captured_at": ended_at,
            }], "?on_conflict=session_id", "resolution=merge-duplicates,return=minimal")
    else:
        raise RuntimeError("database not configured; session kept in local buffer only")


def backfill():
    """Upload every local buffered session (events + state) that the database may have missed."""
    if not db_enabled():
        raise RuntimeError("database not configured")
    count = 0
    for state_file in sorted((LOG_ROOT / ".state").glob("*.json")):
        state = json.loads(state_file.read_text(encoding="utf-8"))
        db_upsert_session(state)
        for event in read_events(state):
            db_insert_event(state["session_id"], event)
        count += 1
    print(f"backfilled {count} sessions")


def report_error(command, error):
    try:
        LOG_ROOT.mkdir(parents=True, exist_ok=True)
        with (LOG_ROOT / "errors.log").open("a", encoding="utf-8") as handle:
            handle.write(f"{now()} {command}: {type(error).__name__}: {redact(error, 500)}\n")
    except OSError:
        pass
    print(f"session_log {command} failed: {error}", file=sys.stderr)


HANDLERS = {
    "session-start": handle_session_start,
    "prompt": handle_prompt,
    "tool": handle_tool,
    "session-end": handle_session_end,
}


def main():
    if len(sys.argv) < 2:
        return 0
    command = sys.argv[1]
    if command == "backfill":
        try:
            backfill()
        except Exception as error:
            report_error(command, error)
        return 0
    if command not in HANDLERS:
        return 0
    try:
        inp = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        inp = {}
    try:
        if "session_id" not in inp:
            raise ValueError("hook payload has no session_id")
        HANDLERS[command](inp)
    except Exception as error:  # hooks must never block a session
        report_error(command, error)
    return 0


if __name__ == "__main__":
    sys.exit(main())
