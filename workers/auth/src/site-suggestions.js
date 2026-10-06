const MAX_BODY_BYTES = 8192;
const MAX_NAME_LENGTH = 120;
const MAX_REGION_LENGTH = 120;
const MAX_SOURCE_URL_LENGTH = 500;
const MAX_TURNSTILE_TOKEN_LENGTH = 2048;

export async function handleSiteSuggestion(request, env) {
  const origin = request.headers.get('Origin');
  if (!allowedAppOrigins(env).includes(origin)) {
    return jsonResponse({ success: false, error: 'origin_not_allowed' }, 403);
  }
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, error: 'method_not_allowed' }, 405);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return jsonResponse({ success: false, error: 'content_type_not_supported' }, 415);
  }
  if (!env.TURNSTILE_SECRET) {
    return jsonResponse({ success: false, error: 'verification_unavailable' }, 503);
  }

  const payload = await readPayload(request);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonResponse({ success: false, error: 'invalid_request' }, 400);
  }

  // A filled honeypot receives the normal success response without a database write.
  if (typeof payload.website === 'string' && payload.website.trim()) {
    return jsonResponse({ success: true });
  }

  const siteName = typeof payload.siteName === 'string' ? payload.siteName.trim().replace(/\s+/g, ' ') : '';
  const region = typeof payload.region === 'string' ? payload.region.trim().replace(/\s+/g, ' ') : '';
  const sourceUrlInput = typeof payload.sourceUrl === 'string' ? payload.sourceUrl.trim() : '';
  if (siteName.length < 2 || siteName.length > MAX_NAME_LENGTH || region.length > MAX_REGION_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(siteName + region)) {
    return jsonResponse({ success: false, error: 'invalid_site_details' }, 400);
  }
  const sourceUrl = normalizeSourceUrl(sourceUrlInput);
  if (!sourceUrl.valid) return jsonResponse({ success: false, error: 'invalid_source_url' }, 400);

  const token = typeof payload.turnstileToken === 'string' ? payload.turnstileToken.trim() : '';
  if (!await verifyTurnstile(token, request, env)) {
    return jsonResponse({ success: false, error: 'verification_failed' }, 400);
  }

  const now = new Date().toISOString();
  await env.SITE_SUGGESTIONS_DB.prepare(`
    INSERT INTO site_suggestions (
      id, site_name, normalized_name, region, normalized_region, source_url,
      status, submission_count, first_submitted_at, last_submitted_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)
    ON CONFLICT(normalized_name, normalized_region) DO UPDATE SET
      submission_count = site_suggestions.submission_count + 1,
      source_url = COALESCE(site_suggestions.source_url, excluded.source_url),
      last_submitted_at = excluded.last_submitted_at
  `).bind(
    crypto.randomUUID(), siteName, normalizeName(siteName), region, normalizeName(region),
    sourceUrl.value, now, now
  ).run();

  return jsonResponse({ success: true });
}

async function readPayload(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES || !request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}

async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET || !token || token.length > MAX_TURNSTILE_TOKEN_LENGTH) return false;
  const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET,
      response: token,
      remoteip: request.headers.get('CF-Connecting-IP') || undefined,
      idempotency_key: crypto.randomUUID()
    })
  });
  if (!verification.ok) return false;
  const result = await verification.json();
  const hostnames = allowedAppHostnames(env);
  return result.success === true && result.action === 'site_suggestion' &&
    hostnames.includes(String(result.hostname || '').toLowerCase());
}

function allowedAppOrigins(env) {
  const appUrl = new URL(env.APP_ORIGIN);
  const origins = [appUrl.origin];
  if (appUrl.hostname === 'diveatlas.site') origins.push('https://www.diveatlas.site');
  return origins;
}

function allowedAppHostnames(env) {
  const appUrl = new URL(env.APP_ORIGIN);
  const hostnames = [appUrl.hostname];
  if (appUrl.hostname === 'diveatlas.site') hostnames.push('www.diveatlas.site');
  return hostnames;
}

function normalizeName(value) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

function normalizeSourceUrl(value) {
  if (!value) return { valid: true, value: null };
  if (value.length > MAX_SOURCE_URL_LENGTH) return { valid: false, value: null };
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return { valid: false, value: null };
    }
    return { valid: true, value: url.href };
  } catch {
    return { valid: false, value: null };
  }
}

function jsonResponse(body, status = 200) {
  const headers = securityHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}
