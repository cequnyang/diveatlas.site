import { getAuthenticatedUser } from '../../shared/session-auth.js';
import { handleSitePhotoSubmission } from './site-photo-submissions.js';

const SUBMISSION_PATH = '/api/site-photo-submissions';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const isLocalFrontend = Boolean(env.LOCAL_APP_ORIGIN && origin === env.LOCAL_APP_ORIGIN);

    if (url.pathname !== SUBMISSION_PATH) return jsonResponse({ success: false, error: 'not_found' }, 404);
    if (request.method === 'OPTIONS') {
      if (!isLocalFrontend) return jsonResponse({ success: false, error: 'method_not_allowed' }, 405);
      return new Response(null, { status: 204, headers: localCorsHeaders(origin) });
    }

    try {
      const response = await handleSitePhotoSubmission(
        request,
        env,
        () => getAuthenticatedUser(request, env, env.AUTH_DB)
      );
      return isLocalFrontend ? withLocalCors(response, origin) : response;
    } catch (error) {
      console.error(JSON.stringify({
        event: 'site_photo_submission_failed',
        errorName: error?.name || 'Error'
      }));
      const response = jsonResponse({ success: false, error: 'service_unavailable' }, 503);
      return isLocalFrontend ? withLocalCors(response, origin) : response;
    }
  }
};

function withLocalCors(response, origin) {
  const headers = new Headers(response.headers);
  for (const [name, value] of localCorsHeaders(origin)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function localCorsHeaders(origin) {
  return new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  });
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
