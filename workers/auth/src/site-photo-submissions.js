const MAX_REQUEST_BYTES = 13 * 1024 * 1024;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MIN_PIXEL_COUNT = 1_000_000;
const MIN_SIDE_LENGTH = 700;
const MAX_SIDE_LENGTH = 12_000;
const MAX_PIXEL_COUNT = 80_000_000;
const LICENSE_VERSION = 'diveatlas-photo-upload-v1';

export async function handleSitePhotoSubmission(request, env, getSubmitter) {
  const origin = request.headers.get('Origin');
  if (!allowedAppOrigins(env).includes(origin)) {
    return jsonResponse({ success: false, error: 'origin_not_allowed' }, 403);
  }
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, error: 'method_not_allowed' }, 405);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) {
    return jsonResponse({ success: false, error: 'content_type_not_supported' }, 415);
  }
  // Submission metadata shares the existing review-queue D1 database; the image bytes remain private in R2.
  const reviewDb = env.SITE_SUGGESTIONS_DB;
  if (!reviewDb || !env.SITE_PHOTO_SUBMISSIONS) {
    return jsonResponse({ success: false, error: 'storage_unavailable' }, 503);
  }

  const submitter = await getSubmitter();
  if (!submitter?.id || !submitter?.email) {
    return jsonResponse({ success: false, error: 'sign_in_required' }, 401);
  }

  const body = await readLimitedBody(request, MAX_REQUEST_BYTES);
  if (!body) return jsonResponse({ success: false, error: 'request_too_large' }, 413);

  let form;
  try {
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    form = await new Request(request.url, {
      method: 'POST',
      headers,
      body
    }).formData();
  } catch {
    return jsonResponse({ success: false, error: 'invalid_request' }, 400);
  }

  const siteId = readText(form, 'siteId', 64);
  const siteName = readText(form, 'siteName', 120);
  const creditName = readText(form, 'creditName', 80) || cleanText(submitter.name, 80) || 'DiveAtlas diver';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(siteId) ||
      siteName.length < 2 || /[\u0000-\u001f\u007f]/.test(siteName)) {
    return jsonResponse({ success: false, error: 'invalid_site' }, 400);
  }
  if (/[\u0000-\u001f\u007f]/.test(creditName)) {
    return jsonResponse({ success: false, error: 'invalid_credit' }, 400);
  }
  if (form.get('attestRealPhoto') !== 'yes' || form.get('attestRights') !== 'yes') {
    return jsonResponse({ success: false, error: 'attestations_required' }, 400);
  }

  const photo = form.get('photo');
  if (typeof File === 'undefined' || !(photo instanceof File) || photo.size === 0) {
    return jsonResponse({ success: false, error: 'photo_required' }, 400);
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return jsonResponse({ success: false, error: 'photo_too_large' }, 413);
  }

  const bytes = new Uint8Array(await photo.arrayBuffer());
  const image = inspectImage(bytes);
  const claimedType = photo.type?.toLowerCase() === 'image/jpg' ? 'image/jpeg' : photo.type?.toLowerCase();
  if (!image || (claimedType && claimedType !== image.contentType)) {
    return jsonResponse({ success: false, error: 'unsupported_image' }, 415);
  }
  const pixelCount = image.width * image.height;
  if (Math.min(image.width, image.height) < MIN_SIDE_LENGTH || pixelCount < MIN_PIXEL_COUNT) {
    return jsonResponse({ success: false, error: 'image_too_small' }, 400);
  }
  if (Math.max(image.width, image.height) > MAX_SIDE_LENGTH || pixelCount > MAX_PIXEL_COUNT) {
    return jsonResponse({ success: false, error: 'image_dimensions_unsupported' }, 400);
  }

  const now = new Date().toISOString();
  const recentCount = await reviewDb.prepare(`
    SELECT COUNT(*) AS count
    FROM site_photo_submissions
    WHERE submitter_user_id = ? AND submitted_at >= ?
  `).bind(submitter.id, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).first();
  if (Number(recentCount?.count || 0) >= 5) {
    return jsonResponse({ success: false, error: 'daily_limit_reached' }, 429);
  }

  const duplicate = await reviewDb.prepare(`
    SELECT id FROM site_photo_submissions
    WHERE site_id = ? AND submitter_user_id = ? AND status = 'pending'
    LIMIT 1
  `).bind(siteId, submitter.id).first();
  if (duplicate) return jsonResponse({ success: false, error: 'already_pending' }, 409);

  const id = crypto.randomUUID();
  const extension = image.contentType === 'image/jpeg' ? 'jpg' : image.contentType.slice('image/'.length);
  const objectKey = `pending/${id}/original.${extension}`;
  const sha256 = await digestHex(bytes);

  await env.SITE_PHOTO_SUBMISSIONS.put(objectKey, bytes, {
    httpMetadata: { contentType: image.contentType },
    customMetadata: { submissionId: id, siteId }
  });

  try {
    await reviewDb.prepare(`
      INSERT INTO site_photo_submissions (
        id, site_id, site_name, submitter_user_id, submitter_email, credit_name,
        object_key, content_type, byte_size, width, height, sha256,
        attested_real_location, attested_not_ai_generated, attested_rights,
        license_version, status, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, 'pending', ?)
    `).bind(
      id, siteId, siteName, submitter.id, submitter.email, creditName,
      objectKey, image.contentType, bytes.byteLength, image.width, image.height,
      sha256, LICENSE_VERSION, now
    ).run();
  } catch (error) {
    await env.SITE_PHOTO_SUBMISSIONS.delete(objectKey);
    throw error;
  }

  return jsonResponse({ success: true, id, status: 'pending' }, 202);
}

async function readLimitedBody(request, maxBytes) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maxBytes || !request.body) return null;

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
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
  return bytes;
}

function inspectImage(bytes) {
  if (hasBytes(bytes, [0xff, 0xd8, 0xff])) {
    const dimensions = jpegDimensions(bytes);
    return dimensions && { ...dimensions, contentType: 'image/jpeg' };
  }
  if (hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) &&
      bytes.length >= 24 && ascii(bytes, 12, 4) === 'IHDR') {
    return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20), contentType: 'image/png' };
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const dimensions = webpDimensions(bytes);
    return dimensions && { ...dimensions, contentType: 'image/webp' };
  }
  return null;
}

function jpegDimensions(bytes) {
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker >= 0xd0 && marker <= 0xd7 || marker === 0x01) continue;
    const segmentLength = readU16BE(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (frameMarkers.has(marker)) {
      return {
        height: readU16BE(bytes, offset + 3),
        width: readU16BE(bytes, offset + 5)
      };
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(bytes) {
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + readU24LE(bytes, 24),
      height: 1 + readU24LE(bytes, 27)
    };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: readU16LE(bytes, 26) & 0x3fff,
      height: readU16LE(bytes, 28) & 0x3fff
    };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
    return {
      width: 1 + ((b1 & 0x3f) << 8) + b0,
      height: 1 + ((b3 & 0x0f) << 10) + (b2 << 2) + ((b1 & 0xc0) >> 6)
    };
  }
  return null;
}

function allowedAppOrigins(env) {
  const appUrl = new URL(env.APP_ORIGIN);
  const origins = [appUrl.origin];
  if (appUrl.hostname === 'diveatlas.site') origins.push('https://www.diveatlas.site');
  return origins;
}

function readText(form, key, maxLength) {
  const value = form.get(key);
  return typeof value === 'string' ? cleanText(value, maxLength) : '';
}

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function hasBytes(bytes, expected) {
  return expected.every((value, index) => bytes[index] === value);
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readU16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32BE(bytes, offset) {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function readU16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

async function digestHex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(body, status = 200) {
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
