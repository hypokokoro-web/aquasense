
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const aquasenseAssistantUrl = url
  ? `${url.replace(/\/+$/, '')}/functions/v1/aquasense-assistant`
  : '';
export const supabasePublishableKey = key;

export const isSupabaseConfigured = Boolean(
  url &&
  key &&
  !url.includes('YOUR_PROJECT_REF') &&
  !key.includes('REPLACE_ME')
);

export const supabase = isSupabaseConfigured
  ? createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;
