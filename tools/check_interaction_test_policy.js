const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const testFiles = [
  path.join(root, 'tests', 'unit', 'interaction-contract.test.js'),
  path.join(root, 'tests', 'e2e', 'critical-contracts.spec.js'),
  path.join(root, 'tests', 'e2e', 'mobile-interactions.spec.js')
];
const source = testFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
const forbidden = [
  /\.(?:skip|fixme|todo|only)\s*\(/,
  /\bskip\s*:\s*true/
];

for (const pattern of forbidden) {
  if (pattern.test(source)) {
    throw new Error(`Critical interaction tests may not be skipped or focused: ${pattern}`);
  }
}

const requiredBehaviorNames = [
  'aggregate Coral marker zooms and never opens details',
  'individual Coral feature opens details without aggregate zoom',
  'Dive cluster zooms and never opens a single-site popup',
  'individual Dive site opens its details popup',
  'Fish aggregate zooms instead of opening a details popup',
  'individual Fish feature opens details without aggregate zoom',
  'hidden Coral grid geometry is not clickable after its layer is turned off',
  'empty-ocean left click does not open Depth Inspection',
  'desktop right click on ocean opens Depth Inspection',
  'mobile long press on empty ocean opens Depth Inspection',
  'touch drag cancels long press and does not open a popup',
  'multi-touch gesture cancels long press and does not open a popup',
  'hover tooltip near top edge appears below and never moves the map',
  'top-edge popup is below its anchor on its first visible frame',
  'popup remains open after internal boundary auto-pan',
  'popup below its anchor keeps its arrow above during dismissal',
  'popup closes when user navigation moves its anchor outside the usable viewport',
  'turning the owning Coral layer off closes its popup and clears hover state',
  'stale popup owner revision cannot operate on a newer popup',
  'one aggregate activation produces at most one semantic action'
];

const missing = requiredBehaviorNames.filter(name => !source.includes(name));
if (missing.length) {
  throw new Error(`Required interaction contracts are missing: ${missing.join('; ')}`);
}

console.log(`Interaction test policy passed (${requiredBehaviorNames.length} required behaviors; no skips or focused-only tests).`);
