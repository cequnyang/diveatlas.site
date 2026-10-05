import { TIDE_ASSET_BASE_URL } from './deployment-config.js';

export function createTideAssetResolver(assetBaseUrl, moduleUrl = import.meta.url) {
  const localBase = new URL('../../data/tides/', moduleUrl);
  const appBase = new URL('../../', moduleUrl);
  if (assetBaseUrl === null || assetBaseUrl === '') return path => resolvePath(path, localBase);
  if (typeof assetBaseUrl !== 'string') throw new Error('Tide asset base URL must be a string or null.');

  const base = new URL(assetBaseUrl, appBase);
  if (base.username || base.password || base.search || base.hash) {
    throw new Error('Tide asset base URL cannot contain credentials, a query, or a fragment.');
  }
  const localHttp = base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.protocol !== 'https:' && !localHttp && base.origin !== appBase.origin) {
    throw new Error('Cross-origin Tide assets must use HTTPS (HTTP is allowed only on loopback for local development).');
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return path => resolvePath(path, base);
}

function resolvePath(path, base) {
  if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || path.includes('\\')) {
    throw new TypeError('Tide asset paths must be non-empty relative paths.');
  }
  const segments = path.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new TypeError('Tide asset paths cannot contain empty or traversal segments.');
  }
  return new URL(segments.map(encodeURIComponent).join('/'), base);
}

export const tideAssetUrl = createTideAssetResolver(TIDE_ASSET_BASE_URL);
