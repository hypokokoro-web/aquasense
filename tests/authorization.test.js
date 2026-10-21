import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canAccessAdminRoute,
  canOfferSocialLogin,
  hasPasswordAuthMethod,
  resolveAquaSenseRole,
  SOCIAL_LOGIN_PROVIDERS,
} from '../src/lib/authorization.js';

test('administrator status is derived only from allowlist membership', () => {
  assert.equal(resolveAquaSenseRole({ user_id: 'trusted-user' }, null), 'admin');
  assert.equal(resolveAquaSenseRole(null, null), 'user');
  assert.throws(() => resolveAquaSenseRole(null, new Error('membership lookup failed')));
  assert.equal(canAccessAdminRoute('user'), false);
  assert.equal(canAccessAdminRoute('admin'), true);
});

test('ownership migration scopes related rows and makes admin membership client read-only', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202610220001_user_roles_and_aquarium_ownership.sql', import.meta.url), 'utf8');
  assert.match(sql, /owner_id uuid references auth\.users\(id\)/i);
  assert.match(sql, /a\.owner_id = auth\.uid\(\)/i);
  assert.match(sql, /public\.owns_aquarium\(aquarium_id\)/i);
  assert.match(sql, /revoke insert, update, delete on public\.aquasense_admins from anon, authenticated/i);
  assert.match(sql, /as restrictive for all to anon, authenticated/i);
  assert.match(sql, /revoke insert, update, delete on public\.sensor_readings from anon, authenticated/i);
  assert.match(sql, /for select to authenticated using \(user_id = auth\.uid\(\)\)/i);
  assert.match(sql, /for select to authenticated using \(public\.owns_aquarium\(aquarium_id\) or public\.is_aquasense_admin\(\)\)/i);
  assert.doesNotMatch(sql, /drop policy/i);
});

test('the browser signup call does not request or submit an administrator role', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /supabase\.auth\.signUp\(\{\s*email: signupEmail,\s*password,\s*options: \{ emailRedirectTo: window\.location\.origin \}/);
  assert.match(app, /const aquasenseRole = resolveAquaSenseRole\(membership, null\)/);
  assert.match(app, /if \(adminRoute && !canAccessAdminRoute\(auth\.user\.aquasenseRole\)\) return <AccessDenied \/>/);
});

test('Google and Facebook options are limited to the regular-user sign-in form', async () => {
  assert.deepEqual(SOCIAL_LOGIN_PROVIDERS, ['google', 'facebook']);
  assert.equal(canOfferSocialLogin(false, false), true);
  assert.equal(canOfferSocialLogin(true, false), false);
  assert.equal(canOfferSocialLogin(false, true), false);

  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /Continue with Google/);
  assert.match(app, /Continue with Facebook/);
  assert.match(app, /supabase\.auth\.signInWithOAuth\(\{\s*provider,\s*options: \{ redirectTo: window\.location\.origin \}/);
  assert.match(app, /canOfferSocialLogin\(adminPortal, registering\)/);
});

test('admin sessions require the signed password authentication method', async () => {
  const makeToken = claims => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  assert.equal(hasPasswordAuthMethod(makeToken({ amr: [{ method: 'password' }] })), true);
  assert.equal(hasPasswordAuthMethod(makeToken({ amr: [{ method: 'oauth' }] })), false);
  assert.equal(hasPasswordAuthMethod('not-a-jwt'), false);

  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /const aquasenseRole = resolveAquaSenseRole\(data, null\)/);
  assert.match(app, /if \(aquasenseRole === 'admin' && !hasPasswordAuthMethod\(session\?\.access_token\)\)/);
  assert.match(app, /await supabase\.auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(app, /Administrator accounts must use the administrator sign-in page with email and password/);

  const migration = await readFile(new URL('../supabase/migrations/202610220003_admin_password_auth_only.sql', import.meta.url), 'utf8');
  assert.match(migration, /auth\.jwt\(\) -> 'amr'[\s\S]*?method.*password/i);
  assert.match(migration, /public\.is_aquasense_owner_session\(\)/);

  const adminFunction = await readFile(new URL('../supabase/functions/aquasense-admin/index.ts', import.meta.url), 'utf8');
  const assistantFunction = await readFile(new URL('../supabase/functions/aquasense-assistant/index.ts', import.meta.url), 'utf8');
  assert.match(adminFunction, /if \(!hasPasswordAuthMethod\(token\)\).*403/);
  assert.match(assistantFunction, /if \(admin && !hasPasswordAuthMethod\(token\)\)/);
});

test('admin URL authorization is based on the verified role, not client metadata', async () => {
  assert.equal(canAccessAdminRoute('user'), false);
  assert.equal(canAccessAdminRoute('admin'), true);
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /if \(adminRoute && !canAccessAdminRoute\(auth\.user\.aquasenseRole\)\) return <AccessDenied \/>/);
  assert.match(app, /supabase\.from\('aquasense_admins'\)\.select\('user_id'\)\.eq\('user_id', user\.id\)/);
});

test('administrative account operations verify the caller and use server-only credentials', async () => {
  const fn = await readFile(new URL('../supabase/functions/aquasense-admin/index.ts', import.meta.url), 'utf8');
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /\[functions\.aquasense-admin\][\s\S]*?verify_jwt\s*=\s*false/i);
  assert.match(fn, /request\.method === 'OPTIONS'[\s\S]*?corsHeaders/);
  assert.match(fn, /auth\.getUser\(token\)/);
  assert.match(fn, /from\('aquasense_admins'\)[\s\S]*?eq\('user_id', user\.id\)/);
  assert.match(fn, /if \(!admin\) return json\(\{ error: 'Administrator access is required\.' \}, 403\)/);
  assert.match(fn, /service\.auth\.admin\.listUsers/);
  assert.match(fn, /service\.from\('aquasense_admins'\)\.upsert/);
  assert.doesNotMatch(await readFile(new URL('../src/AdminDashboard.jsx', import.meta.url), 'utf8'), /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
});

test('regular-user assistant context is aquarium-owner scoped', async () => {
  const fn = await readFile(new URL('../supabase/functions/aquasense-assistant/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /if \(!admin\) aquariumQuery = aquariumQuery\.eq\('owner_id', user\.id\)/);
});
