'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertTestPolicy } = require('../../tools/interaction_test_policy');
const { assertSelection } = require('../../tools/check_browser_test_selection');
const Reporter = require('../../tools/interaction_test_reporter');

test('policy accepts parameterized viewport tags across formatting changes', () => {
  const source = 'for (const state of [false, true]) { test(`sheet ${state}`, { tag:"@mobile-only" }, async ({page}) => {}); }';
  for (const text of [source, source.replaceAll(';', ';\r\n')]) assert.doesNotThrow(() => assertTestPolicy(text, 'example.spec.js'));
  assert.doesNotThrow(() => assertTestPolicy('// test.skip()\nconst example = "test.only()";', 'example.spec.js'));
});

test('policy rejects skip and focus syntax without a name whitelist', () => {
  for (const source of [
    'test.skip(true);', 'test ["skip"] (true);', 'test?.fixme(true);',
    'test.describe.only("suite", () => {});', 'const skip = test.skip;',
    'test("unit", {skip:true}, () => {});', 'test("unit", {"only":true}, () => {});'
  ]) assert.throws(() => assertTestPolicy(source, 'example.spec.js'), /example.spec.js:1:/);
});

test('selection keeps both parameterized mobile cases and shared tests', () => {
  const entry = (title, mobile, tags) => ({ key:JSON.stringify(['example.spec.js', 1, title, mobile ? 'phone' : 'desktop']), mobile, tags });
  const all = ['displaced', 'swiped-away'].flatMap(title => [entry(title, false, ['@mobile-only']), entry(title, true, ['@mobile-only'])]);
  all.push(entry('shared', false, []), entry('shared', true, []));
  const selected = all.filter(item => item.mobile || !item.tags.length);
  assert.doesNotThrow(() => assertSelection(all, selected));
  assert.throws(() => assertSelection(all, selected.slice(1)), /omits applicable/);
  assert.throws(() => assertSelection(all, all), /inapplicable/);
  assert.throws(() => assertSelection([entry('orphan', false, ['@mobile-only'])], []), /No applicable project/);
  assert.throws(() => assertSelection([entry('conflict', true, ['@mobile-only', '@desktop-only'])], []), /Conflicting/);
});

test('runtime reporter rejects skipped selected tests even when static analysis was bypassed', () => {
  const reporter = new Reporter();
  reporter.onBegin({}, { allTests:() => [{ outcome:() => 'expected' }] });
  assert.equal(reporter.onEnd(), undefined);
  reporter.onBegin({}, { allTests:() => [{ outcome:() => 'skipped', titlePath:() => ['phone', 'example'] }] });
  assert.deepEqual(reporter.onEnd(), { status:'failed' });
});
