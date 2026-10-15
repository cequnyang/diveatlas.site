export const SESSION_COOKIE = '__Host-diveatlas_session';

export async function getAuthenticatedUser(request, env, authDatabase = env.DB) {
  const token = parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE];
  if (!token || !authDatabase) return null;

  const now = Math.floor(Date.now() / 1000);
  const sessionHash = await sha256Hex(token);
  const user = await authDatabase.prepare(`
    SELECT u.id, u.email, u.name, u.picture_url AS picture
    FROM auth_sessions s
    JOIN auth_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
    LIMIT 1
  `).bind(sessionHash, now).first();

  return user || null;
}

export function parseCookies(header = '') {
  const cookies = Object.create(null);
  for (const part of (header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    cookies[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return cookies;
}

export async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
