#!/usr/bin/env node
/**
 * Ensures the LC admin account exists with the expected password and admin role.
 *
 * Usage: node scripts/ensure-admin-user.mjs
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(ROOT, '.env') });

const ADMIN_EMAIL = 'contact@scoresmartpte.com';
const ADMIN_PASSWORD = 'SCORE2026';
const ADMIN_NAME = 'Score Smart Admin';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email) {
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function ensureProfile(userId, email) {
  const { data: existing, error: selectError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle();

  if (selectError) throw selectError;

  const payload = {
    id: userId,
    email,
    name: ADMIN_NAME,
    role: 'admin',
    approval_status: 'approved',
  };

  if (existing) {
    const { error } = await supabase.from('profiles').update(payload).eq('id', userId);
    if (error) throw error;
    return 'updated';
  }

  const { error } = await supabase.from('profiles').insert(payload);
  if (error) throw error;
  return 'created';
}

async function main() {
  console.log(`Ensuring admin user: ${ADMIN_EMAIL}`);

  let user = await findUserByEmail(ADMIN_EMAIL);

  if (user) {
    const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { name: ADMIN_NAME, role: 'admin' },
    });
    if (error) throw error;
    user = data.user;
    console.log('Updated existing auth user password.');
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { name: ADMIN_NAME, role: 'admin' },
    });
    if (error) throw error;
    user = data.user;
    console.log('Created new auth user.');
  }

  const profileAction = await ensureProfile(user.id, ADMIN_EMAIL);
  console.log(`Profile ${profileAction} with admin role.`);

  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (signInError) throw signInError;
  if (!signIn.session) throw new Error('Sign-in verification failed: no session returned');

  console.log('Verified login with SCORE2026.');
  console.log('Admin ready:', ADMIN_EMAIL);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
