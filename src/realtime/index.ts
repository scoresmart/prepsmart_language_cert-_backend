/**
 * TypeScript entry point for the realtime speaking examiner.
 *
 * The examiner itself is plain ESM (`*.mjs`) shared with the frontend repo,
 * where it was written and is still smoke-tested. This backend compiles to
 * CommonJS, and `tsc` rewrites a normal `import()` into `require()` — which
 * throws ERR_REQUIRE_ESM on a `.mjs` file. Building the import through
 * `new Function` keeps it a genuine dynamic import that survives the
 * downlevel, and a file:// URL keeps it working on Windows, where a bare
 * `C:\...` path is not a valid module specifier.
 */

import type { Server } from 'http';
import path from 'path';
import { pathToFileURL } from 'url';

export interface RealtimeStatus {
  enabled: boolean;
  path: string;
  model?: string;
  voice?: string;
  activeSessions?: number;
  maxConcurrent?: number;
  maxExamMinutes?: number;
  requiresAuth?: boolean;
  reason?: string;
}

interface RealtimeBridgeModule {
  REALTIME_PATH: string;
  attachRealtimeBridge(server: Server): boolean;
  shutdownRealtimeBridge(reason?: string): Promise<void>;
  realtimeStatus(): RealtimeStatus;
}

export const REALTIME_PATH = '/realtime/speaking';

/** A real `import()`, not the `require()` tsc would otherwise emit. */
const importEsm = new Function('specifier', 'return import(specifier);') as (
  specifier: string,
) => Promise<unknown>;

let bridge: RealtimeBridgeModule | null = null;
let loadError: string | null = null;

/**
 * Mount the examiner on the API's HTTP server.
 *
 * Never throws: a broken or unconfigured examiner must not stop the REST API
 * from serving, since every other feature of the portal depends on it.
 */
export async function attachRealtime(server: Server): Promise<boolean> {
  try {
    // Resolves to src/realtime under ts-node-dev and dist/realtime after a
    // build — the .mjs files sit beside this module in both.
    const entry = pathToFileURL(path.join(__dirname, 'bridge.mjs')).href;
    bridge = (await importEsm(entry)) as RealtimeBridgeModule;
    return bridge.attachRealtimeBridge(server);
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    console.error('[realtime] failed to mount the speaking examiner:', loadError);
    console.error('[realtime] the REST API is unaffected and will keep serving.');
    bridge = null;
    return false;
  }
}

/** Snapshot for the /realtime/health route. Safe to call before mounting. */
export function realtimeStatus(): RealtimeStatus {
  if (!bridge) {
    return {
      enabled: false,
      path: REALTIME_PATH,
      reason: loadError ?? 'OPENAI_API_KEY is not set',
    };
  }
  return bridge.realtimeStatus();
}

/** Close live exams on SIGTERM so a Railway redeploy does not cut candidates off silently. */
export async function shutdownRealtime(reason = 'server_shutdown'): Promise<void> {
  if (!bridge) return;
  try {
    await bridge.shutdownRealtimeBridge(reason);
  } catch (error) {
    console.error('[realtime] shutdown error:', error);
  }
}
