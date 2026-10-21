import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('administrative records are private to browser roles and protected by RLS', async () => {
  const sql = await read('../supabase/migrations/202610220004_admin_platform_management.sql');
  for (const table of ['aquasense_audit_logs', 'aquasense_announcements', 'aquasense_platform_settings', 'aquasense_ingest_events']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, 'i'));
  }
  assert.match(sql, /public\.is_aquasense_account_active\(\)[\s\S]*?u\.banned_until is null or u\.banned_until <= now\(\)/i);
  assert.match(sql, /from pg_policies[\s\S]*?tablename = 'aquasense_admins'[\s\S]*?drop policy[\s\S]*?create policy "Membership fence"[\s\S]*?as restrictive for all to authenticated/i);
  assert.match(sql, /revoke all on public\.aquasense_admins from public, anon, authenticated[\s\S]*?grant select on public\.aquasense_admins to authenticated/i);
});

test('admin operations verify the bearer account and allow only published notices to regular users', async () => {
  const fn = await read('../supabase/functions/aquasense-admin/index.ts');
  assert.match(fn, /auth\.getUser\(token\)/);
  assert.match(fn, /from\('aquasense_admins'\)[\s\S]*?eq\('user_id', user\.id\)/);
  assert.match(fn, /if \(!hasPasswordAuthMethod\(token\)\) return json\(\{ error: 'Administrator sign-in requires email and password\.' \}, 403\)/);
  assert.match(fn, /body\.action === 'list_announcements'[\s\S]*?eq\('status', 'published'\)[\s\S]*?expires_at/);
  assert.match(fn, /if \(!admin\) return json\(\{ error: 'Administrator access is required\.' \}, 403\)/);
});

test('role and suspension changes prevent self lockout and protect the final administrator', async () => {
  const fn = await read('../supabase/functions/aquasense-admin/index.ts');
  assert.match(fn, /body\.user_id === user\.id\) \{[\s\S]*?You cannot remove your own administrator access/);
  assert.match(fn, /The final administrator cannot be removed/);
  assert.match(fn, /Remove administrator access before suspending this account/);
  assert.match(fn, /updateUserById\(body\.user_id, \{ ban_duration: body\.suspended \? '876000h' : 'none' \}\)/);
  const sql = await read('../supabase/migrations/202610220004_admin_platform_management.sql');
  assert.match(sql, /public\.is_aquasense_owner_session\(\)[\s\S]*?public\.is_aquasense_account_active\(\)/);
  assert.match(sql, /pg_advisory_xact_lock\(8447, 2204\)/);
  assert.match(fn, /service\.rpc\('remove_aquasense_admin'/);
  assert.doesNotMatch(fn, /from\('aquasense_admins'\)\.delete/);
  const assistant = await read('../supabase/functions/aquasense-assistant/index.ts');
  assert.match(assistant, /user\.banned_until[\s\S]*?This account is suspended/);
});

test('audit history is written by the server and ordinary users cannot modify it', async () => {
  const sql = await read('../supabase/migrations/202610220004_admin_platform_management.sql');
  const fn = await read('../supabase/functions/aquasense-admin/index.ts');
  assert.match(sql, /revoke all on public\.aquasense_audit_logs from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert on public\.aquasense_audit_logs to service_role/i);
  assert.doesNotMatch(sql, /grant[^;]*(update|delete)[^;]*aquasense_audit_logs/i);
  assert.match(fn, /service\.from\('aquasense_audit_logs'\)\.insert/);
  assert.match(fn, /action: 'role_change'[\s\S]*?outcome: 'success'/);
  assert.doesNotMatch(fn, /console\.log\([^\n]*(?:password|access_token|service_role_key)/i);
});

test('Explore content publication controls the existing knowledge retrieval source', async () => {
  const sql = await read('../supabase/migrations/202610220004_admin_platform_management.sql');
  const fn = await read('../supabase/functions/aquasense-admin/index.ts');
  assert.match(sql, /where k\.is_published and not k\.is_archived/);
  assert.match(fn, /body\.action === 'list_content'[\s\S]*?aquasense_knowledge_chunks/);
  assert.match(fn, /body\.action === 'save_content'[\s\S]*?source_title/);
  assert.match(fn, /body\.action === 'set_content_state'[\s\S]*?is_archived/);
});

test('diagnostics are bounded and never persist device credentials or raw payloads', async () => {
  const sql = await read('../supabase/migrations/202610220004_admin_platform_management.sql');
  const handler = await read('../supabase/functions/ingest-reading/handler.js');
  const fn = await read('../supabase/functions/ingest-reading/index.ts');
  assert.match(sql, /revoke all on public\.aquasense_ingest_events from public, anon, authenticated/i);
  assert.match(handler, /recordEvent\('reading_accepted', 'success'/);
  assert.match(handler, /recordEvent\('aquarium_mismatch', 'rejected'/);
  assert.match(fn, /from\('aquasense_ingest_events'\)\.insert\(event\)/);
  assert.match(fn, /from\('aquasense_ingest_events'\)\.insert\(event\)/);
  assert.doesNotMatch(handler, /logEvent\(\{[^}]*deviceKey|logEvent\(\{[^}]*payload/i);
});

test('platform settings are narrowly allowlisted and all frontend data calls use the shared client', async () => {
  const fn = await read('../supabase/functions/aquasense-admin/index.ts');
  const ui = await read('../src/AdminDashboard.jsx');
  const api = await read('../src/lib/adminApi.js');
  assert.match(fn, /allowedZones = \['UTC', 'Asia\/Manila'/);
  assert.match(fn, /setting_key: 'default_announcement_category'/);
  assert.match(api, /supabase\.auth\.getSession\(\)/);
  assert.match(ui, /callAquaSenseAdmin\('get_platform_report', \{ days: reportDays \}\)/);
  assert.doesNotMatch(`${ui}${api}`, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
});
