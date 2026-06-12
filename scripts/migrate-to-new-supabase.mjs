#!/usr/bin/env node
/**
 * Migrates auth users + public data from old Supabase project to new.
 * Requires: supabase CLI logged in, Docker NOT required (uses `supabase db query --linked`).
 *
 * Usage:
 *   node scripts/migrate-to-new-supabase.mjs export   # link OLD project first
 *   node scripts/migrate-to-new-supabase.mjs import   # link NEW project first
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'migration');
const OLD_REF = 'sepzceaicoldqhyxxzff';
const NEW_REF = 'ajfhzylokauqcjrokizx';

const AUTH_TABLES = ['auth.users', 'auth.identities'];
const PUBLIC_TABLES = [
  'profiles',
  'student_access',
  'writing_task_questions',
  'listening_part_questions',
  'reading_part_questions',
  'language_cert_mock_tests',
  'language_cert_templates',
  'practice_attempts',
  'communities',
  'community_members',
  'community_messages',
  'tutors',
  'tutor_working_hours',
  'tutor_breaks',
  'materials',
  'announcements',
  'quad_slots',
  'quad_bookings',
  'one_to_one_slots',
  'tickets',
  'ticket_messages',
  'ticket_reads',
  'pinned_tickets',
  'student_assessments',
  'assessment_history',
];

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function queryJson(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  const out = run(`supabase db query --linked --agent=no -o json "${escaped}"`);
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  return JSON.parse(out.slice(start, end + 1));
}

function getLinkedRef() {
  const ref = readFileSync(join(ROOT, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
  return ref;
}

function exportTable(table, batchSize = 200) {
  const [schema, name] = table.includes('.') ? table.split('.') : ['public', table];
  const qualified = schema === 'public' ? `public.${name}` : table;
  const countRows = queryJson(`select count(*)::int as count from ${qualified};`);
  const total = countRows[0]?.count ?? 0;
  console.log(`Exporting ${qualified} (${total} rows)...`);

  const all = [];
  for (let offset = 0; offset < total; offset += batchSize) {
    const batch = queryJson(
      `select * from ${qualified} order by 1 limit ${batchSize} offset ${offset};`
    );
    all.push(...batch);
    process.stdout.write(`  ${Math.min(offset + batch.length, total)}/${total}\r`);
  }
  console.log('');
  writeFileSync(join(OUT_DIR, `${schema}.${name}.json`), JSON.stringify(all, null, 2));
  return total;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildInsert(schema, name, rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const lines = rows.map((row) => {
    const vals = cols.map((c) => sqlLiteral(row[c]));
    return `(${vals.join(', ')})`;
  });
  return `INSERT INTO ${schema}.${name} (${cols.join(', ')}) VALUES\n${lines.join(',\n')}\nON CONFLICT DO NOTHING;\n`;
}

function importTable(schema, name) {
  const file = join(OUT_DIR, `${schema}.${name}.json`);
  if (!existsSync(file)) {
    console.log(`Skip ${schema}.${name} (no export file)`);
    return;
  }
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  if (!rows.length) {
    console.log(`Skip ${schema}.${name} (empty)`);
    return;
  }
  console.log(`Importing ${schema}.${name} (${rows.length} rows)...`);
  const chunkSize = 50;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const sql = `SET session_replication_role = replica;\n${buildInsert(schema, name, chunk)}`;
    const tmp = join(OUT_DIR, `_import_${schema}_${name}_${i}.sql`);
    writeFileSync(tmp, sql);
    run(`supabase db query --linked --agent=no -f "${tmp}"`);
  }
}

function cmdExport() {
  const ref = getLinkedRef();
  if (ref !== OLD_REF) {
    console.error(`Link OLD project first: supabase link --project-ref ${OLD_REF}`);
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  for (const t of AUTH_TABLES) exportTable(t);
  for (const t of PUBLIC_TABLES) exportTable(`public.${t}`);
  console.log('Export complete -> migration/');
}

function cmdImport() {
  const ref = getLinkedRef();
  if (ref !== NEW_REF) {
    console.error(`Link NEW project first: supabase link --project-ref ${NEW_REF}`);
    process.exit(1);
  }
  for (const t of AUTH_TABLES) {
    const [schema, name] = t.split('.');
    importTable(schema, name);
  }
  for (const t of PUBLIC_TABLES) importTable('public', t);
  console.log('Import complete.');
}

const mode = process.argv[2];
if (mode === 'export') cmdExport();
else if (mode === 'import') cmdImport();
else {
  console.log('Usage: node scripts/migrate-to-new-supabase.mjs export|import');
  process.exit(1);
}
