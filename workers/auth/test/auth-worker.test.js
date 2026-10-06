import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const APP_ORIGIN = 'https://diveatlas.test';
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const CALLBACK = `${APP_ORIGIN}/api/auth/google/callback`;
const SESSION_COOKIE = '__Host-diveatlas_session';

function base64Url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createDatabase() {
  const usersByGoogleSub = new Map();
  const usersById = new Map();
  const sessions = new Map();
  const db = {
    sessions,
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...boundValues) {
          values = boundValues;
          return statement;
        },
        async first() {
          if (sql.includes('INSERT INTO auth_users')) {
            const [id, googleSub, email, name, picture] = values;
            const user = usersByGoogleSub.get(googleSub) || { id };
            Object.assign(user, { id: user.id || id, email, name, picture });
            usersByGoogleSub.set(googleSub, user);
            usersById.set(user.id, user);
            return { id: user.id };
          }
          if (sql.includes('FROM auth_sessions s')) {
            const [tokenHash, now] = values;
            const session = sessions.get(tokenHash);
            if (!session || session.expiresAt <= now) return null;
            const user = usersById.get(session.userId);
            return user && {
              id: user.id,
              email: user.email,
              name: user.name,
              picture: user.picture
            };
          }
          throw new Error(`Unexpected D1 first() query: ${sql}`);
        },
        async run() {
          if (sql.includes('DELETE FROM auth_sessions WHERE expires_at')) {
            const [now] = values;
            for (const [hash, session] of sessions) {
              if (session.expiresAt <= now) sessions.delete(hash);
            }
            return { success: true };
          }
          if (sql.includes('INSERT INTO auth_sessions')) {
            const [tokenHash, userId, , expiresAt] = values;
            sessions.set(tokenHash, { userId, expiresAt });
            return { success: true };
          }
          if (sql.includes('DELETE FROM auth_sessions WHERE token_hash')) {
            sessions.delete(values[0]);
            return { success: true };
          }
          throw new Error(`Unexpected D1 run() query: ${sql}`);
        }
      };
      return statement;
    }
  };
  return db;
}

function cookieJar(response) {
  return response.headers.getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
}

function cookieValue(cookieHeader, name) {
  return cookieHeader.split('; ').find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function makeSignedIdToken(privateKey, claims) {
  const header = base64Url(JSON.stringify({ alg: 'RS256', kid: 'local-test-key', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify(claims));
  const signedBytes = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, signedBytes);
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

test('Google sign-in validates state, nonce, signature, session, logout, and static fallback', async () => {
  const keyPair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256'
  }, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  Object.assign(publicJwk, { kid: 'local-test-key', use: 'sig', alg: 'RS256' });

  const db = createDatabase();
  const env = {
    DB: db,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'test-secret',
    APP_ORIGIN,
    GOOGLE_REDIRECT_URI: CALLBACK,
    ASSETS: { fetch: async () => new Response('local site asset') }
  };
  const originalFetch = globalThis.fetch;
  let tokenClaims;
  let receivedVerifier;
  globalThis.fetch = async (input, init = {}) => {
    const endpoint = String(input);
    if (endpoint === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(init.body);
      receivedVerifier = body.get('code_verifier');
      return Response.json({ id_token: await makeSignedIdToken(keyPair.privateKey, tokenClaims) });
    }
    if (endpoint === 'https://www.googleapis.com/oauth2/v3/certs') {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { 'Cache-Control': 'public, max-age=60' }
      });
    }
    throw new Error(`Unexpected external request: ${endpoint}`);
  };

  try {
    const login = await worker.fetch(new Request(`${APP_ORIGIN}/api/auth/google`), env);
    assert.equal(login.status, 302);
    const authorization = new URL(login.headers.get('Location'));
    assert.equal(authorization.origin, 'https://accounts.google.com');
    assert.equal(authorization.searchParams.get('redirect_uri'), CALLBACK);
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.get('scope'), 'openid email profile');

    const loginCookies = cookieJar(login);
    for (const name of ['__Host-diveatlas_oauth_state', '__Host-diveatlas_oauth_nonce', '__Host-diveatlas_pkce_verifier']) {
      assert.match(login.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`)), /HttpOnly; Secure; SameSite=Lax/);
    }
    const nonce = cookieValue(loginCookies, '__Host-diveatlas_oauth_nonce');
    const state = authorization.searchParams.get('state');
    const callbackUrl = new URL(CALLBACK);
    callbackUrl.searchParams.set('code', 'test-code');
    callbackUrl.searchParams.set('state', 'wrong-state');

    const invalidState = await worker.fetch(new Request(callbackUrl, {
      headers: { Cookie: loginCookies }
    }), env);
    assert.equal(invalidState.status, 400);
    assert.equal(db.sessions.size, 0);

    tokenClaims = {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'google-subject-1',
      email: 'diver@example.com',
      email_verified: true,
      name: 'Dive Atlas User',
      picture: 'https://lh3.googleusercontent.com/avatar',
      nonce,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300
    };
    callbackUrl.searchParams.set('state', state);
    const callback = await worker.fetch(new Request(callbackUrl, {
      headers: { Cookie: loginCookies }
    }), env);
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get('Location'), `${APP_ORIGIN}/`);
    assert.equal(receivedVerifier, cookieValue(loginCookies, '__Host-diveatlas_pkce_verifier'));
    assert.equal(db.sessions.size, 1);
    assert.equal(callback.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`)), true);
    assert.match(callback.headers.getSetCookie().find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`)), /HttpOnly; Secure; SameSite=Lax/);

    const sessionCookie = callback.headers.getSetCookie()
      .find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`)).split(';', 1)[0];
    const currentUser = await worker.fetch(new Request(`${APP_ORIGIN}/api/auth/me`, {
      headers: { Cookie: sessionCookie }
    }), env);
    const sessionPayload = await currentUser.json();
    assert.equal(typeof sessionPayload.user.id, 'string');
    assert.equal(sessionPayload.user.email, 'diver@example.com');
    assert.equal(sessionPayload.user.name, 'Dive Atlas User');
    assert.equal(sessionPayload.user.picture, 'https://lh3.googleusercontent.com/avatar');
    assert.equal(currentUser.headers.get('Cache-Control'), 'no-store');

    const blockedLogout = await worker.fetch(new Request(`${APP_ORIGIN}/api/auth/logout`, {
      method: 'POST', headers: { Origin: 'https://attacker.test', Cookie: sessionCookie }
    }), env);
    assert.equal(blockedLogout.status, 403);
    assert.equal(db.sessions.size, 1);

    const logout = await worker.fetch(new Request(`${APP_ORIGIN}/api/auth/logout`, {
      method: 'POST', headers: { Origin: APP_ORIGIN, Cookie: sessionCookie }
    }), env);
    assert.equal(logout.status, 200);
    assert.equal(db.sessions.size, 0);
    const signedOut = await worker.fetch(new Request(`${APP_ORIGIN}/api/auth/me`), env);
    assert.deepEqual(await signedOut.json(), { user: null });

    const asset = await worker.fetch(new Request(`${APP_ORIGIN}/assets/example.js`), env);
    assert.equal(await asset.text(), 'local site asset');
    const unknownApi = await worker.fetch(new Request(`${APP_ORIGIN}/api/not-an-auth-route`), env);
    assert.equal(unknownApi.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
