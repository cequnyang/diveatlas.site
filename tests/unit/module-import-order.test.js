const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const regionalCurrentsModule = './js/regional-currents.js';

test('parallel import groups never initialize Regional Currents before its helpers', () => {
  const groups = [...html.matchAll(/Promise\.all\(\[([\s\S]*?)\]\)/g)];
  assert.ok(groups.length > 0, 'expected to inspect the page parallel-import groups');

  for (const [index, group] of groups.entries()) {
    const modules = [...group[1].matchAll(/import\(['"]([^'"]+)['"]\)/g)]
      .map((match) => match[1].split('?')[0]);
    assert.ok(
      !modules.includes(regionalCurrentsModule),
      `parallel import group ${index + 1} must not contain ${regionalCurrentsModule}`
    );
  }
});

test('Dive Conditions loads both current helpers before Regional Currents', () => {
  const start = html.indexOf('async function ensureDiveConditionsService()');
  const end = html.indexOf('async function ensureDiveExperienceOutlookMonth', start);
  assert.notEqual(start, -1, 'expected the Dive Conditions loader');
  assert.notEqual(end, -1, 'expected the next loader after Dive Conditions');

  const loader = html.slice(start, end);
  const helperBatch = loader.match(/Promise\.all\(\[([\s\S]*?)\]\)\.then\(\(\) => import\(['"]([^'"]+)['"]\)\)/);
  assert.ok(helperBatch, 'expected helper imports to finish before the dependent import starts');

  const helpers = [...helperBatch[1].matchAll(/import\(['"]([^'"]+)['"]\)/g)]
    .map((match) => match[1].split('?')[0]);
  assert.ok(helpers.includes('./js/current-math.js'));
  assert.ok(helpers.includes('./js/current-tile-cache.js'));
  assert.equal(helperBatch[2].split('?')[0], regionalCurrentsModule);
});
