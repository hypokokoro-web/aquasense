import { createClient } from 'npm:@supabase/supabase-js@2';
import { createDeleteAccountHandler } from './handler.js';

Deno.serve(createDeleteAccountHandler({
  env: () => ({
    url: Deno.env.get('SUPABASE_URL'),
    anonKey: Deno.env.get('SUPABASE_ANON_KEY'),
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  }),
  createClient,
}));
