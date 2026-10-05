const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prototypePath = path.join(__dirname, '../../data/.build/reef_condition/ocean-heat-history-prototype/index.html');
const html = fs.readFileSync(prototypePath, 'utf8');

test('ocean heat prototype is lazy and has mutually exclusive candidates', () => {
  assert.match(html, /fetch\('\.\/metadata\.json'\)/);
  assert.match(html, /async function selectMode\(next\)/);
  assert.match(html, /map\.removeLayer\(oceanLayer\)/);
  assert.match(html, /map\.removeLayer\(reefLayer\)/);
  assert.match(html, /Worst ocean heat reached/);
  assert.match(html, /Persistence of severe heat/);
  assert.match(html, /candidate === 'candidate-a' \? metadata\.candidateA : metadata\.candidateB/);
});

test('ocean heat prototype popup reports history fields and missing data', () => {
  for (const field of [
    'Recent period:', 'Worst marine heatwave:', 'Worst occurrence:', 'Marine heatwave days:',
    'Strong-or-worse days:', 'Severe-or-worse days:', 'Longest episode:', 'Source: NOAA Coral Reef Watch',
  ]) assert.ok(html.includes(field), `popup field missing: ${field}`);
  assert.match(html, /No valid source value for this display cell/);
});

test('packed query reader accounts for the one-byte category before uint16 fields', () => {
  assert.match(html, /validDays = read\(13\)/);
  assert.match(html, /dayIndex:read\(1\), mhwDays:read\(3\), strongDays:read\(5\), severeDays:read\(7\), extremeDays:read\(9\), longestRun:read\(11\)/);
});

test('ocean heat prototype has no NOAA runtime data request', () => {
  assert.doesNotMatch(html, /fetch\([^)]*noaa\.gov/i);
  assert.doesNotMatch(html, /fetch\([^)]*coralreefwatch\.noaa\.gov/i);
  assert.match(html, /\.\/query\/\$\{key\}\.bin\.gz/);
});
