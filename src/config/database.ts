import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { env } from './env';

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      realtime: { transport: ws },
    });
  }
  return _supabase;
}

export async function connectDatabase(): Promise<void> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('profiles').select('id').limit(1);
    if (error) throw error;
    console.log('[Database] Supabase connection verified.');
  } catch (error) {
    console.error('[Database] Unable to connect to Supabase:', error);
    throw error;
  }
}
