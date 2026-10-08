#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA_ROOTS = ['assets', 'datasets'];
const TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.csv', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.txt', '.xml', '.yaml', '.yml'
]);
// A slash inside an external URL (for example, `https://host/data/file.csv`)
// is not a local path reference. Keep URL path separators out of the prefix
// delimiter while still matching quoted/root-relative local `data/` paths.
const DATA_DIRECTORY_REFERENCE = /(?:^|[^A-Za-z0-9_.:/-])(?:\.\/|\/)?data\/[A-Za-z0-9_.-]/i;

function collectTextFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTextFiles(absolute);
    return entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [absolute] : [];
  });
}

const trackedData = spawnSync('git', ['ls-files', '--', 'data', 'datasets/coral_records_snapshot.js', 'datasets/fish_map_units.json.gz',
  'datasets/bathymetry_manifest.js', 'datasets/coral_occurrence_manifest.js', 'datasets/reef_raster_manifest.js',
  'datasets/reef_vector_manifest.js', 'datasets/terrain_manifest.js', 'datasets/temperature/metadata.json'], {
  cwd: ROOT,
  encoding: 'utf8'
});
if (trackedData.status !== 0) {
  console.error(trackedData.stderr || 'Could not inspect Git tracking for data/.');
  process.exit(2);
}

const violations = [];
for (const trackedPath of trackedData.stdout.split(/\r?\n/).filter(Boolean)) {
  if (trackedPath.startsWith('data/')) violations.push(`${trackedPath}: tracked under data/`);
  else violations.push(`${trackedPath}: R2 source snapshot must not be tracked`);
}

for (const root of DATA_ROOTS) {
  for (const file of collectTextFiles(path.join(ROOT, root))) {
    const contents = fs.readFileSync(file, 'utf8');
    const lines = contents.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (DATA_DIRECTORY_REFERENCE.test(line)) {
        violations.push(`${path.relative(ROOT, file)}:${index + 1}: points into data/`);
      }
    });
  }
}

if (violations.length) {
  console.error('Dataset path policy failed: assets/ and datasets/ must not point into data/, data/ must not be tracked, and R2 source snapshots/startup assets must stay in R2.');
  for (const violation of violations.slice(0, 50)) console.error(`- ${violation}`);
  if (violations.length > 50) console.error(`- ...and ${violations.length - 50} more`);
  process.exit(1);
}

console.log('Dataset path policy passed: no asset references into data/, no tracked data/, and no tracked R2 source snapshots or startup assets.');
