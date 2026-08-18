/**
 * Copy the realtime examiner's ESM modules into dist/ after `tsc`.
 *
 * tsc only emits the files it compiles, so the hand-written `.mjs` modules in
 * src/realtime never reach dist on their own — and `dist/realtime/index.js`
 * imports `./bridge.mjs` from beside itself. Without this step the build looks
 * clean and the examiner throws MODULE_NOT_FOUND on the first exam.
 *
 * Runs as part of `npm run build`, so Railway picks it up with no extra config.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const from = path.join(root, 'src', 'realtime');
const to = path.join(root, 'dist', 'realtime');

if (!fs.existsSync(from)) {
  console.error(`[build] missing ${path.relative(root, from)} — nothing to copy`);
  process.exit(1);
}

fs.mkdirSync(to, { recursive: true });

const modules = fs.readdirSync(from).filter((name) => name.endsWith('.mjs'));

if (modules.length === 0) {
  console.error('[build] no .mjs modules found in src/realtime — the examiner would not start');
  process.exit(1);
}

for (const name of modules) {
  fs.copyFileSync(path.join(from, name), path.join(to, name));
}

console.log(`[build] copied ${modules.length} realtime module(s) to dist/realtime`);
