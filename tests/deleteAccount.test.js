import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeleteAccountHandler } from '../supabase/functions/delete-account/handler.js';

const user = { id: 'user-1', email: 'owner@example.com', banned_until: null };
const token = authTime => `header.${Buffer.from(JSON.stringify({ auth_time: authTime })).toString('base64url')}.signature`;
const env = () => ({ url: 'https://example.supabase.co', anonKey: 'publishable', serviceRoleKey: 'server-only' });

function fixture({ account = user, isAdmin = false, cleanupError = null, deleteError = null, now = Date.now() } = {}) {
  const calls = { cleanup: 0, delete: 0, service: false };
  const createClient = (_url, key) => {
    if (key === 'publishable') return { auth: { getUser: async () => ({ data: { user: account }, error: null }) } };
    calls.service = true;
    return {
      from: table => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === 'aquasense_admins' && isAdmin ? { user_id: account.id } : null, error: null }) }) }),
      }),
      rpc: async () => { calls.cleanup += 1; return { data: 1, error: cleanupError }; },
      auth: { admin: { deleteUser: async id => { calls.delete += 1; assert.equal(id, account.id); return { error: deleteError }; } } },
    };
  };
  const handler = createDeleteAccountHandler({ env, createClient, now: () => now, logger: { error() {} } });
  return { handler, calls };
}

function request({ bearer, email = user.email } = {}) {
  return new Request('https://example.test/functions/v1/delete-account', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({ confirmation_email: email }),
  });
}

test('rejects requests without a bearer token', async () => {
  const { handler } = fixture();
  const response = await handler(request());
  assert.equal(response.status, 401);
});

test('rejects oversized request bodies before making privileged calls', async () => {
  const { handler, calls } = fixture();
  const response = await handler(new Request('https://example.test/functions/v1/delete-account', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token(Date.now() / 1000)}` },
    body: JSON.stringify({ confirmation_email: user.email, extra: 'x'.repeat(3000) }),
  }));
  assert.equal(response.status, 413);
  assert.equal(calls.cleanup, 0);
});

test('requires recent authentication and matching account email', async () => {
  const now = Date.now();
  const { handler: staleHandler, calls } = fixture({ now });
  const stale = await staleHandler(request({ bearer: token(now / 1000 - 3600) }));
  assert.equal(stale.status, 401);
  assert.equal(calls.cleanup, 0);
  const { handler } = fixture({ now });
  const mismatch = await handler(request({ bearer: token(now / 1000), email: 'other@example.com' }));
  assert.equal(mismatch.status, 400);
});

test('refuses administrator accounts before deleting any aquarium data', async () => {
  const now = Date.now();
  const { handler, calls } = fixture({ isAdmin: true, now });
  const response = await handler(request({ bearer: token(now / 1000) }));
  assert.equal(response.status, 403);
  assert.equal(calls.cleanup, 0);
  assert.equal(calls.delete, 0);
});

test('stops on cleanup failure and reports success only after Auth deletion succeeds', async () => {
  const now = Date.now();
  const failedCleanup = fixture({ cleanupError: { code: '23503' }, now });
  const cleanupResponse = await failedCleanup.handler(request({ bearer: token(now / 1000) }));
  assert.equal(cleanupResponse.status, 500);
  assert.equal(failedCleanup.calls.delete, 0);

  const failedAuth = fixture({ deleteError: { code: 'service_error' }, now });
  const authResponse = await failedAuth.handler(request({ bearer: token(now / 1000) }));
  assert.equal(authResponse.status, 503);
  assert.equal((await authResponse.json()).success, false);

  const success = fixture({ now });
  const response = await success.handler(request({ bearer: token(now / 1000) }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(success.calls.cleanup, 1);
  assert.equal(success.calls.delete, 1);
});
