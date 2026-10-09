#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PLAYWRIGHT_PORT || process.argv.find(value => value.startsWith('--port='))?.slice('--port='.length) || 8766);
const configPath = path.join(root, '_site', 'js', 'data-assets-config.js');
const configText = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
const configValue = configText.match(/^window\.DIVEATLAS_DATA_ASSET_BASE_URL = (null|"[^"\r\n]*");$/m)?.[1];
const dataAssetBase = configValue && configValue !== 'null' ? new URL(JSON.parse(configValue)) : null;
const forceR2StartupAssets = process.env.DIVEATLAS_TEST_FORCE_R2_STARTUP_ASSETS === '1';
const R2_DATASET_ASSETS = new Set([
  'bathymetry_manifest.js',
  'coral_occurrence_manifest.js',
  'reef_raster_manifest.js',
  'reef_vector_manifest.js',
  'terrain_manifest.js',
  'dive-sites.js',
  'dive-site-search-locations.json.gz',
  'dive-site-summaries.json.gz',
  'temperature/metadata.json'
]);
const R2_VERSIONED_DATASET_PATHS = {
  'dive-sites.js': 'data/dive-sites-v3.js',
  'dive-site-search-locations.json.gz': 'data/dive-site-search-locations-v4.json.gz',
  'dive-site-summaries.json.gz': 'data/dive-site-summaries-v3.json.gz'
};
const contentTypes = new Map([
  ['.bin', 'application/octet-stream'],
  ['.css', 'text/css; charset=utf-8'],
  ['.geojson', 'application/geo+json'],
  ['.gz', 'application/gzip'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2']
]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function handle(req, res) {
  let requestUrl;
  try {
    requestUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  } catch {
    return send(res, 400, 'Bad request');
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestUrl.pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  const segments = decodedPath.split('/').filter(Boolean);
  const isSeaviewResearchBundle = segments[0] === 'data' && segments[1] === '.build' &&
    segments[2] === 'reef_condition' && segments[3] === 'seaview';
  if (segments.some(segment => segment === '.' || segment === '..' || (segment.startsWith('.') && !isSeaviewResearchBundle)) || decodedPath.includes('\\')) {
    return send(res, 404, 'Not found');
  }

  const relativePath = segments.length ? path.join(...segments) : 'index.html';
  const localPath = path.resolve(root, relativePath);
  if (!localPath.startsWith(`${root}${path.sep}`)) return send(res, 404, 'Not found');
  const datasetRelativePath = segments[0] === 'datasets' ? segments.slice(1).join('/') : '';
  const isR2DatasetAsset = segments[0] === 'datasets' && R2_DATASET_ASSETS.has(datasetRelativePath);

  // Browser tests keep asset requests same-origin so Playwright mocks can
  // intercept them. Local copies win; missing data and published startup
  // manifests fall back to the matching R2 release in clean CI checkouts.
  if (requestUrl.pathname === '/js/data-assets-config.js') {
    return send(res, 200,
      '// Test site keeps asset requests same-origin; missing published assets are proxied by this server.\n' +
      'window.DIVEATLAS_DATA_ASSET_BASE_URL = null;\n',
      { 'content-type': 'text/javascript; charset=utf-8' });
  }

  try {
    if ((!forceR2StartupAssets || !isR2DatasetAsset) && fs.statSync(localPath).isFile()) {
      const headers = { 'content-type': contentTypes.get(path.extname(localPath).toLowerCase()) || 'application/octet-stream' };
      res.writeHead(200, headers);
      return fs.createReadStream(localPath).on('error', error => {
        console.error(`Local test asset read failed for ${requestUrl.pathname}: ${error.message}`);
        if (!res.headersSent) send(res, 500, 'Read error');
        else res.destroy(error);
      }).pipe(res);
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') return send(res, 500, 'Read error');
  }

  const remoteAssetPath = segments[0] === 'data'
    ? segments.join('/')
    : isR2DatasetAsset
      ? R2_VERSIONED_DATASET_PATHS[datasetRelativePath] || `data/${datasetRelativePath}`
      : null;
  if (remoteAssetPath && dataAssetBase) {
    const clientAbort = new AbortController();
    const timeout = AbortSignal.timeout(60_000);
    const signal = AbortSignal.any([clientAbort.signal, timeout]);
    const abortWhenClientDisconnects = () => {
      if (!res.writableEnded) clientAbort.abort();
    };
    res.once('close', abortWhenClientDisconnects);
    try {
      // Dataset manifests keep their local development URL, while R2 stores
      // the production copy under data/ beside its tiles and chunks.
      const remotePath = remoteAssetPath.split('/').map(encodeURIComponent).join('/');
      const remoteUrl = new URL(`${remotePath}${requestUrl.search}`, dataAssetBase);
      const response = await fetch(remoteUrl, { signal });
      const headers = {};
      for (const name of ['cache-control', 'content-type', 'etag', 'last-modified']) {
        const value = response.headers.get(name);
        if (value) headers[name] = value;
      }
      res.writeHead(response.status, headers);
      if (response.body) {
        // pipeline owns both stream errors and client disconnects; an aborted
        // R2 fetch must fail this request without taking down the test server.
        await pipeline(Readable.fromWeb(response.body), res);
      } else {
        res.end();
      }
      return;
    } catch (error) {
      if (!clientAbort.signal.aborted) {
        console.error(`R2 test asset proxy failed for ${requestUrl.pathname}: ${error.message}`);
      }
      if (clientAbort.signal.aborted || res.destroyed || res.writableEnded) return;
      if (!res.headersSent) return send(res, 502, 'Data asset proxy failed');
      return res.destroy();
    } finally {
      res.off('close', abortWhenClientDisconnects);
    }
  }

  return send(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET') return send(res, 405, 'Method not allowed', { allow: 'GET' });
  void handle(req, res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Test site server listening on http://127.0.0.1:${port}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
