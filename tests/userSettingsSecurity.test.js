import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/202610220005_user_settings_and_account_deletion.sql', import.meta.url), 'utf8');
const component = await readFile(new URL('../src/UserSettings.jsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const deletionHandler = await readFile(new URL('../supabase/functions/delete-account/handler.js', import.meta.url), 'utf8');

test('user preferences are RLS-scoped to the signed-in owner session', () => {
  assert.match(migration, /alter table public\.aquasense_user_preferences enable row level security/i);
  assert.match(migration, /for all to authenticated[\s\S]*?user_id = auth\.uid\(\)[\s\S]*?is_aquasense_owner_session\(\)/i);
  assert.match(migration, /revoke all on public\.aquasense_user_preferences from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete on public\.aquasense_user_preferences to authenticated/i);
  assert.match(app, /from\('aquasense_user_preferences'\)[\s\S]*?eq\('user_id', user\.id\)/);
});

test('settings use the existing aquarium settings flow and accurately disclose unavailable delivery', () => {
  assert.match(component, /saveAquariumSettings/);
  assert.match(component, /aquarium_settings/);
  assert.match(component, /Email delivery is not configured/);
  assert.match(component, /Local browser notifications work only while AquaSense is open/);
  assert.match(component, /Download my data/);
});

test('account deletion is the only new browser Edge Function with gateway JWT disabled and validates auth in the handler', () => {
  assert.match(config, /\[functions\.delete-account\][\s\S]*?verify_jwt = false/);
  assert.match(component, /functions\.invoke\('delete-account'/);
  assert.match(migration, /if coalesce\(auth\.role\(\), ''\) <> 'service_role' then/i);
  assert.match(deletionHandler, /auth\.getUser\(token\)/);
  assert.match(deletionHandler, /RECENT_AUTH_SECONDS/);
});
