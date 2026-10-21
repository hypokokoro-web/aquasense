// Roles come from the database-backed administrator allowlist, never user metadata.
export function resolveAquaSenseRole(membership, error) {
  if (error) throw error;
  return membership ? 'admin' : 'user';
}

export function canAccessAdminRoute(role) {
  return role === 'admin';
}

export const SOCIAL_LOGIN_PROVIDERS = Object.freeze(['google', 'facebook']);

export function canOfferSocialLogin(adminPortal, registering) {
  return !adminPortal && !registering;
}

export function hasPasswordAuthMethod(accessToken) {
  try {
    const payload = accessToken?.split('.')[1];
    if (!payload) return false;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return Array.isArray(claims.amr) && claims.amr.some(method => method?.method === 'password');
  } catch {
    return false;
  }
}
