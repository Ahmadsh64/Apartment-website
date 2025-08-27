// src/lib/supabaseServer.js
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE env vars');
}

export const supabase = createClient(url, key);
