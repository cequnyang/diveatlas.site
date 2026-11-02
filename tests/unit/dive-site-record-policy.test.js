const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('map popup retains every experience label instead of choosing an entry level', () => {
  const source = fs.readFileSync('index.html', 'utf8');
  const start = source.indexOf('  function diveRecommendedLevelValue(');
  const end = source.indexOf('  const DIVE_CATEGORY_COPY', start);
  const context = vm.createContext({ diveCategoryValue:value => value });
  vm.runInContext(source.slice(start, end), context);
  assert.equal(context.diveRecommendedLevelValue('Beginner | Advanced | Expert'), 'Beginner · Advanced · Expert');
  assert.equal(context.diveRecommendedLevelValue('Unclassified'), 'Unclassified');
});
