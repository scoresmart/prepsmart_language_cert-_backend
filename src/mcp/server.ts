import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { getSupabase } from '../config/database';

const server = new McpServer({
  name: 'prepsmart-language-cert',
  version: '1.0.0',
});

// ── Tests ─────────────────────────────────────────────────────────────────────

server.tool(
  'list_tests',
  'List all active language cert mock tests',
  {
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
  },
  async ({ page, limit }) => {
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const { data, error, count } = await getSupabase()
      .from('language_cert_mock_tests')
      .select('id, title, description, created_at', { count: 'exact' })
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ tests: data, total: count, page, totalPages: Math.ceil((count || 0) / limit) }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  'get_test_structure',
  'Get full structure of a mock test (listening, reading, writing sections)',
  { test_id: z.string().uuid('Must be a valid UUID') },
  async ({ test_id }) => {
    const supabase = getSupabase();
    const { data: test, error } = await supabase
      .from('language_cert_mock_tests')
      .select('*')
      .eq('id', test_id)
      .eq('is_active', true)
      .single();

    if (error || !test) return { content: [{ type: 'text', text: `Test not found: ${test_id}` }] };

    const listeningIds = [
      { part: 1, id: test.listening_part1_id },
      { part: 2, id: test.listening_part2_id },
      { part: 3, id: test.listening_part3_id },
      { part: 4, id: test.listening_part4_id },
    ].filter((p) => p.id);

    const readingIds = [
      { part_type: 'part1a', id: test.reading_part1a_id },
      { part_type: 'part1b', id: test.reading_part1b_id },
      { part_type: 'part2', id: test.reading_part2_id },
      { part_type: 'part3', id: test.reading_part3_id },
      { part_type: 'part4', id: test.reading_part4_id },
    ].filter((p) => p.id);

    const writingIds = [
      { task: 1, id: test.writing_task1_id },
      { task: 2, id: test.writing_task2_id },
    ].filter((p) => p.id);

    const [listeningRes, readingRes, writingRes] = await Promise.all([
      listeningIds.length
        ? supabase.from('listening_part_questions').select('id, part_number, audio_path, questions').in('id', listeningIds.map((p) => p.id))
        : Promise.resolve({ data: [] }),
      readingIds.length
        ? supabase.from('reading_part_questions').select('id, part_type, title, passage, questions').in('id', readingIds.map((p) => p.id))
        : Promise.resolve({ data: [] }),
      writingIds.length
        ? supabase.from('writing_task_questions').select('id, task_type, question_text').in('id', writingIds.map((p) => p.id))
        : Promise.resolve({ data: [] }),
    ]);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              id: test.id,
              title: test.title,
              sections: {
                listening: listeningIds.map((p) => ({ part: p.part, ...((listeningRes.data || []).find((q: any) => q.id === p.id) || {}) })),
                reading: readingIds.map((p) => ({ part_type: p.part_type, ...((readingRes.data || []).find((q: any) => q.id === p.id) || {}) })),
                writing: writingIds.map((p) => ({ task: p.task, ...((writingRes.data || []).find((q: any) => q.id === p.id) || {}) })),
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── Questions ─────────────────────────────────────────────────────────────────

server.tool(
  'list_writing_questions',
  'List writing task questions (task1 or task2)',
  { task_type: z.enum(['task1', 'task2']).optional() },
  async ({ task_type }) => {
    let query = getSupabase()
      .from('writing_task_questions')
      .select('id, task_type, question_text, created_at')
      .order('created_at', { ascending: false });

    if (task_type) query = query.eq('task_type', task_type);

    const { data, error } = await query;
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'list_listening_questions',
  'List listening part questions with optional filter by part number',
  {
    part_number: z.number().min(1).max(4).optional(),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
  },
  async ({ part_number, page, limit }) => {
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    let query = getSupabase()
      .from('listening_part_questions')
      .select('id, part_number, audio_path, questions', { count: 'exact' })
      .order('part_number', { ascending: true })
      .range(from, to);

    if (part_number) query = query.eq('part_number', part_number);

    const { data, error, count } = await query;
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    return { content: [{ type: 'text', text: JSON.stringify({ questions: data, total: count }, null, 2) }] };
  }
);

server.tool(
  'list_reading_questions',
  'List reading part questions with optional filter by part type',
  {
    part_type: z.enum(['part1a', 'part1b', 'part2', 'part3', 'part4']).optional(),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
  },
  async ({ part_type, page, limit }) => {
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    let query = getSupabase()
      .from('reading_part_questions')
      .select('id, part_type, title, passage, questions', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (part_type) query = query.eq('part_type', part_type);

    const { data, error, count } = await query;
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    return { content: [{ type: 'text', text: JSON.stringify({ questions: data, total: count }, null, 2) }] };
  }
);

// ── Health ────────────────────────────────────────────────────────────────────

server.tool('health_check', 'Check Supabase connection status', {}, async () => {
  try {
    const { error } = await getSupabase().from('profiles').select('id').limit(1);
    if (error) throw error;
    return { content: [{ type: 'text', text: 'Supabase connection OK' }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Connection failed: ${err.message}` }] };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't pollute MCP stdio
  process.stderr.write('PrepSmart MCP server running on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`MCP server error: ${err.message}\n`);
  process.exit(1);
});
