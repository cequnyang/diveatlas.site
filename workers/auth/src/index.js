import { handleSiteSuggestion } from './site-suggestions.js';

const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const CALLBACK_PATH = '/api/auth/google/callback';
const SESSION_COOKIE = '__Host-diveatlas_session';
const STATE_COOKIE = '__Host-diveatlas_oauth_state';
const NONCE_COOKIE = '__Host-diveatlas_oauth_nonce';
const VERIFIER_COOKIE = '__Host-diveatlas_pkce_verifier';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const OAUTH_TTL_SECONDS = 10 * 60;

let cachedGoogleKeys;
let cachedGoogleKeysExpiresAt = 0;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      assertConfiguration(env);

      if (url.pathname === '/api/auth/google' && request.method === 'GET') {
        return await beginGoogleSignIn(env);
      }
      if (url.pathname === CALLBACK_PATH && request.method === 'GET') {
        return await completeGoogleSignIn(request, env);
      }
      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        return await getCurrentUser(request, env);
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        return await logOut(request, env);
      }
      if (url.pathname === '/api/site-suggestions') {
        return await handleSiteSuggestion(request, env, () => getAuthenticatedUser(request, env));
      }

      if (url.pathname.startsWith('/api/')) return textResponse('Not found', 404);
      if (env.ASSETS) return await env.ASSETS.fetch(request);
      return textResponse('Not found', 404);
    } catch (error) {
      // Keep provider, database, and secret details out of public responses.
      console.error('Authentication request failed:', error?.name || 'Error');
      return textResponse('Authentication is temporarily unavailable.', 500);
    }
  }
};

function assertConfiguration(env) {
  if (!env.DB || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET ||
      !env.APP_ORIGIN || !env.GOOGLE_REDIRECT_URI) {
    throw new Error('Missing authentication configuration');
  }

  const appUrl = new URL(env.APP_ORIGIN);
  const callbackUrl = new URL(env.GOOGLE_REDIRECT_URI);
  const localHttp = appUrl.hostname === 'localhost' || appUrl.hostname === '127.0.0.1';
  if ((appUrl.protocol !== 'https:' && !(localHttp && appUrl.protocol === 'http:')) ||
      appUrl.origin !== env.APP_ORIGIN || callbackUrl.origin !== appUrl.origin ||
      callbackUrl.pathname !== CALLBACK_PATH || callbackUrl.search || callbackUrl.hash) {
    throw new Error('Invalid application origin or Google callback URL');
  }
}

async function beginGoogleSignIn(env) {
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const challenge = base64UrlEncode(await sha256(verifier));
  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);

  authorizationUrl.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  });

  const headers = securityHeaders();
  headers.set('Location', authorizationUrl.toString());
  appendCookie(headers, STATE_COOKIE, state, OAUTH_TTL_SECONDS);
  appendCookie(headers, NONCE_COOKIE, nonce, OAUTH_TTL_SECONDS);
  appendCookie(headers, VERIFIER_COOKIE, verifier, OAUTH_TTL_SECONDS);
  return new Response(null, { status: 302, headers });
}

async function completeGoogleSignIn(request, env) {
  const requestUrl = new URL(request.url);
  const cookies = parseCookies(request.headers.get('Cookie'));
  const state = requestUrl.searchParams.get('state') || '';
  const code = requestUrl.searchParams.get('code') || '';
  const returnedError = requestUrl.searchParams.get('error');
  const nonce = cookies[NONCE_COOKIE] || '';
  const verifier = cookies[VERIFIER_COOKIE] || '';
  const savedState = cookies[STATE_COOKIE] || '';
  const clearOAuthCookies = [STATE_COOKIE, NONCE_COOKIE, VERIFIER_COOKIE]
    .map((name) => cookieHeader(name, '', 0));

  if (returnedError || !code || !nonce || !verifier || !constantTimeEqual(state, savedState)) {
    return signInFailure(clearOAuthCookies);
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: verifier
    })
  });
  if (!tokenResponse.ok) return signInFailure(clearOAuthCookies);

  const tokenPayload = await tokenResponse.json();
  const identity = await verifyGoogleIdToken(tokenPayload.id_token, env.GOOGLE_CLIENT_ID, nonce);
  if (!identity) return signInFailure(clearOAuthCookies);

  const now = Math.floor(Date.now() / 1000);
  const user = await env.DB.prepare(`
    INSERT INTO auth_users (id, google_sub, email, name, picture_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(google_sub) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      picture_url = excluded.picture_url,
      updated_at = excluded.updated_at
    RETURNING id
  `).bind(
    crypto.randomUUID(), identity.sub, identity.email,
    identity.name || null, identity.picture || null, now, now
  ).first();

  if (!user?.id) throw new Error('User upsert returned no account');

  const sessionToken = randomToken();
  const sessionHash = await sha256Hex(sessionToken);
  const expiresAt = now + SESSION_TTL_SECONDS;
  await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now).run();
  await env.DB.prepare(`
    INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(sessionHash, user.id, now, expiresAt).run();

  const headers = securityHeaders();
  const returnUrl = new URL(env.APP_ORIGIN);
  returnUrl.searchParams.set('auth_notice', 'signed-in');
  headers.set('Location', returnUrl.toString());
  for (const cookie of clearOAuthCookies) headers.append('Set-Cookie', cookie);
  headers.append('Set-Cookie', cookieHeader(SESSION_COOKIE, sessionToken, SESSION_TTL_SECONDS));
  return new Response(null, { status: 303, headers });
}

async function verifyGoogleIdToken(token, clientId, expectedNonce) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header;
  let claims;
  try {
    header = JSON.parse(base64UrlDecodeText(parts[0]));
    claims = JSON.parse(base64UrlDecodeText(parts[1]));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

  const jwk = await findGoogleKey(header.kid);
  if (!jwk) return null;

  let validSignature = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    validSignature = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, base64UrlDecode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
  } catch {
    return null;
  }
  if (!validSignature) return null;

  const now = Math.floor(Date.now() / 1000);
  const audienceMatches = claims.aud === clientId ||
    (Array.isArray(claims.aud) && claims.aud.includes(clientId));
  const authorizedPartyMatches = !claims.azp || claims.azp === clientId;
  const issuerMatches = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!audienceMatches || !authorizedPartyMatches || !issuerMatches ||
      !Number.isFinite(claims.exp) || claims.exp <= now ||
      !Number.isFinite(claims.iat) || claims.iat > now + 60 ||
      !constantTimeEqual(claims.nonce || '', expectedNonce) ||
      typeof claims.sub !== 'string' || !claims.sub ||
      typeof claims.email !== 'string' || claims.email_verified !== true) {
    return null;
  }

  return {
    sub: claims.sub,
    email: claims.email,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 200) : '',
    picture: safeGooglePicture(claims.picture)
  };
}

async function findGoogleKey(keyId) {
  await refreshGoogleKeys(false);
  let key = cachedGoogleKeys.find((item) => item.kid === keyId && item.use === 'sig' && item.kty === 'RSA');
  if (!key) {
    // Google can rotate signing keys before an isolate's cached set expires.
    await refreshGoogleKeys(true);
    key = cachedGoogleKeys.find((item) => item.kid === keyId && item.use === 'sig' && item.kty === 'RSA');
  }
  return key || null;
}

async function refreshGoogleKeys(force) {
  const now = Date.now();
  if (!force && cachedGoogleKeys && cachedGoogleKeysExpiresAt > now) return;

  const response = await fetch(GOOGLE_JWKS_ENDPOINT, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error('Unable to fetch Google signing keys');
  const payload = await response.json();
  if (!Array.isArray(payload.keys)) throw new Error('Invalid Google signing key response');
  cachedGoogleKeys = payload.keys;
  const maxAge = Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/i)?.[1] || 3600);
  cachedGoogleKeysExpiresAt = now + Math.min(Math.max(maxAge, 60), 24 * 60 * 60) * 1000;
}

async function getCurrentUser(request, env) {
  return jsonResponse({ user: await getAuthenticatedUser(request, env) }, 200);
}

async function getAuthenticatedUser(request, env) {
  const token = parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE];
  if (!token) return null;

  const now = Math.floor(Date.now() / 1000);
  const sessionHash = await sha256Hex(token);
  const user = await env.DB.prepare(`
    SELECT u.id, u.email, u.name, u.picture_url AS picture
    FROM auth_sessions s
    JOIN auth_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
    LIMIT 1
  `).bind(sessionHash, now).first();

  return user || null;
}

async function logOut(request, env) {
  if (request.headers.get('Origin') !== env.APP_ORIGIN) {
    return textResponse('Forbidden', 403);
  }

  const token = parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE];
  if (token) {
    await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token)).run();
  }

  const headers = securityHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.append('Set-Cookie', cookieHeader(SESSION_COOKIE, '', 0));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

function signInFailure(cookiesToClear) {
  const headers = securityHeaders();
  headers.set('Content-Type', 'text/html; charset=utf-8');
  for (const cookie of cookiesToClear) headers.append('Set-Cookie', cookie);
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign-in failed | DiveAtlas</title><main><h1>Google sign-in could not be completed</h1><p>Return to DiveAtlas and try again.</p><a href="/">Back to DiveAtlas</a></main>',
    { status: 400, headers }
  );
}

function jsonResponse(value, status) {
  const headers = securityHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value), { status, headers });
}

function textResponse(value, status) {
  const headers = securityHeaders();
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(value, { status, headers });
}

function securityHeaders() {
  return new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  });
}

function appendCookie(headers, name, value, maxAge) {
  headers.append('Set-Cookie', cookieHeader(name, value, maxAge));
}

function cookieHeader(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function parseCookies(header = '') {
  const cookies = Object.create(null);
  for (const part of (header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    cookies[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return cookies;
}

function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64UrlEncode(bytes);
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function sha256Hex(value) {
  return Array.from(await sha256(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlDecodeText(value) {
  return new TextDecoder().decode(base64UrlDecode(value));
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

function safeGooglePicture(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'googleusercontent.com' ||
      (url.protocol === 'https:' && url.hostname.endsWith('.googleusercontent.com'))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
