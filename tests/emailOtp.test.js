import test from 'node:test';
import assert from 'node:assert/strict';
import { maskEmailAddress, resendSignupOtp, SIGNUP_OTP_PATTERN, verifySignupOtp } from '../src/lib/emailOtp.js';
import { readFile } from 'node:fs/promises';

test('signup verification validates numeric codes and masks the destination address', () => {
  assert.equal(SIGNUP_OTP_PATTERN.test('123456'), true);
  assert.equal(SIGNUP_OTP_PATTERN.test('12345'), false);
  assert.equal(SIGNUP_OTP_PATTERN.test('12ab56'), false);
  assert.equal(SIGNUP_OTP_PATTERN.test('1234567890123'), false);
  assert.equal(maskEmailAddress('a@example.com'), 'a•••@example.com');
  assert.equal(maskEmailAddress('aquarium@example.com'), 'a•••@example.com');
});

test('signup confirmation verification and resend use the Supabase signup OTP type', async () => {
  const calls = [];
  const client = { auth: {
    verifyOtp: async options => { calls.push(['verifyOtp', options]); return { data: {}, error: null }; },
    resend: async options => { calls.push(['resend', options]); return { error: null }; },
  } };
  await verifySignupOtp(client, 'user@example.com', '123456');
  await resendSignupOtp(client, 'user@example.com');
  assert.deepEqual(calls, [
    ['verifyOtp', { email: 'user@example.com', token: '123456', type: 'signup' }],
    ['resend', { type: 'signup', email: 'user@example.com' }],
  ]);
  const failure = new Error('rate limit');
  client.auth.resend = async () => ({ error: failure });
  assert.equal((await resendSignupOtp(client, 'user@example.com')).error, failure);
});

test('signup presents OTP verification and preserves trusted role resolution', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /setVerificationEmail\(signupEmail\)/);
  assert.match(app, /verifySignupOtp\(supabase, verificationEmail, token\)/);
  assert.match(app, /resendSignupOtp\(supabase, verificationEmail\)/);
  assert.match(app, /const aquasenseRole = resolveAquaSenseRole\(membership, null\)/);
  assert.match(app, /if \(aquasenseRole !== 'user'/);
  assert.match(app, /autoComplete="one-time-code"[\s\S]*?inputMode="numeric"/);
  assert.match(app, /verificationRequest\.current\) return/);
  assert.match(app, /setResendSeconds\(60\)/);
  assert.match(app, /catch \(err\) \{\s*setError\(err\?\.message/);
});

test('Supabase signup email template displays an OTP and contains no confirmation link', async () => {
  const template = await readFile(new URL('../docs/AQUASENSE_SIGNUP_OTP_TEMPLATE.html', import.meta.url), 'utf8');
  assert.match(template, /\{\{\s*\.Token\s*\}\}/);
  assert.doesNotMatch(template, /ConfirmationURL/);
});
