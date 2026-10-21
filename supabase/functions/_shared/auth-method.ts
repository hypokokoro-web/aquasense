// The caller's JWT is verified with Supabase Auth before this helper is used.
// Read only the signed amr claim to distinguish the required admin password
// session from OAuth sessions; never use user-editable metadata for this.
export function hasPasswordAuthMethod(accessToken: string): boolean {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return false;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return Array.isArray(claims.amr) && claims.amr.some((method: { method?: unknown }) => method?.method === 'password');
  } catch {
    return false;
  }
}
