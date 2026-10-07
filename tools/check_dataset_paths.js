#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA_ROOTS = ['assets', 'datasets'];
const TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.csv', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.txt', '.xml', '.yaml', '.yml'
]);
const DATA_DIRECTORY_REFERENCE = /(?:^|[^A-Za-z0-9_.-])(?:\.\/|\/)?data\/[A-Za-z0-9_.-]/i;

function collectTextFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTextFiles(absolute);
    return entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [absolute] : [];
  });
}

const trackedData = spawnSync('git', ['ls-files', '--', 'data'], {
  cwd: ROOT,
  encoding: 'utf8'
});
if (trackedData.status !== 0) {
  console.error(trackedData.stderr || 'Could not inspect Git tracking for data/.');
  process.exit(2);
}

const violations = [];
for (const trackedPath of trackedData.stdout.split(/\r?\n/).filter(Boolean)) {
  violations.push(`${trackedPath}: tracked under data/`);
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
  console.error('Dataset path policy failed: assets/ and datasets/ must not point into data/, and data/ must not be tracked.');
  for (const violation of violations.slice(0, 50)) console.error(`- ${violation}`);
  if (violations.length > 50) console.error(`- ...and ${violations.length - 50} more`);
  process.exit(1);
}

console.log('Dataset path policy passed: no assets/ or datasets/ references into data/, and no tracked data/ files.');
