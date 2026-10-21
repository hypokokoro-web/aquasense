export const SIGNUP_OTP_PATTERN = /^\d{6,12}$/;

export function verifySignupOtp(client, email, token) {
  return client.auth.verifyOtp({ email, token, type: 'signup' });
}

export function resendSignupOtp(client, email) {
  return client.auth.resend({ type: 'signup', email });
}

export function maskEmailAddress(email) {
  const [localPart, domain] = String(email || '').split('@');
  if (!localPart || !domain) return 'your email address';
  return `${localPart.slice(0, 1)}•••@${domain}`;
}
