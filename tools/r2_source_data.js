'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTION_CONFIG_URL = 'https://diveatlas.site/js/data-assets-config.js';
const SOURCE_PATHS = new Set(['data/coral_records_snapshot.js', 'data/fish_map_units.json.gz']);
const CONFIG_PATTERN = /^window\.DIVEATLAS_DATA_ASSET_BASE_URL = "([^"\r\n]+)";$/m;

async function readResponse(url) {
  const response = await fetch(url, { headers:{ 'user-agent':'DiveAtlas-R2-source/1' } });
  if (!response.ok) throw new Error(`R2 source request returned HTTP ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function resolveBaseUrl() {
  let configured = process.env.SOURCE_DATA_ASSET_BASE_URL || process.env.DATA_ASSET_BASE_URL;
  if (!configured) {
    try {
      const localConfig = await fs.readFile(path.join(ROOT, '_site/js/data-assets-config.js'), 'utf8');
      configured = localConfig.match(CONFIG_PATTERN)?.[1];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!configured) {
    configured = (await readResponse(PRODUCTION_CONFIG_URL)).toString('utf8').match(CONFIG_PATTERN)?.[1];
  }
  if (!configured) throw new Error('Could not find the current R2 release URL in DATA_ASSET_BASE_URL or the deployed site config.');
  const base = new URL(configured);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) {
    throw new Error('The R2 source URL must be an HTTPS release URL ending in /.');
  }
  return base;
}

async function resolveR2SourceFile(dataPath) {
  if (!SOURCE_PATHS.has(dataPath)) throw new TypeError(`Unsupported R2 source data path: ${dataPath}`);
  const base = await resolveBaseUrl();
  const releaseId = base.pathname.replace(/\/$/, '').split('/').at(-1);
  const cacheRoot = path.join(ROOT, 'data/.build/r2/source-cache', releaseId);
  const manifestPath = path.join(cacheRoot, 'release-manifest.json');
  await fs.mkdir(cacheRoot, { recursive:true });
  const manifestBytes = await readResponse(new URL(`release-manifest.json?cacheBust=${Date.now()}-${process.pid}`, base));
  const temporaryManifest = `${manifestPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryManifest, manifestBytes);
  await fs.rename(temporaryManifest, manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.format !== 'diveatlas-browser-data-release' || manifest.schemaVersion !== 1) {
    throw new Error('The configured R2 source does not contain a supported release manifest.');
  }
  const entry = manifest.files?.find(item => item.path === dataPath);
  if (!entry) throw new Error(`R2 release ${releaseId} does not contain ${dataPath}.`);

  const cachePath = path.join(cacheRoot, ...dataPath.split('/'));
  await fs.mkdir(path.dirname(cachePath), { recursive:true });
  const digestMatches = bytes => bytes.length === entry.bytes && crypto.createHash('sha256').update(bytes).digest('hex') === entry.sha256;
  try {
    const cached = await fs.readFile(cachePath);
    if (digestMatches(cached)) return cachePath;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const payload = await readResponse(new URL(dataPath, base));
  if (!digestMatches(payload)) throw new Error(`R2 source failed its release-manifest checksum: ${dataPath}`);
  const temporary = `${cachePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, payload);
  await fs.rename(temporary, cachePath);
  return cachePath;
}

module.exports = { resolveR2SourceFile };
