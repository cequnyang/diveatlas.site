const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { create } = require('../../js/dive-site-summary-translations.js');

const english = 'Divers reported turtles; sightings are not guaranteed.';
function response(language = 'zh') {
  return new Response(gzipSync(JSON.stringify({
    schema:'dive-site-summary-translations-v1', language,
    byEnglish:{ [english]:'潜水员报告见到海龟；不能保证每次都能见到。' }
  })));
}

test('loads only the requested locale once and matches the exact English claims', async () => {
  const requested = [];
  const api = create({ fetch:async url => { requested.push(url); return response(); } });
  assert.equal(api.translate('zh', english), english);
  await api.ensure('en');
  assert.equal(requested.length, 0);
  await Promise.all([api.ensure('zh'), api.ensure('zh')]);
  assert.deepEqual(requested, ['datasets/dive-site-summary-translations/zh.json.gz?v=1']);
  assert.notEqual(api.translate('zh', english), english);
  assert.equal(api.translate('zh', `${english} Newly edited claim.`), `${english} Newly edited claim.`);
  assert.equal(api.translate('de', english), english);
});

test('failed or mislabelled locales preserve English and allow a later retry', async () => {
  let calls = 0;
  const api = create({ warn:() => {}, fetch:async () => {
    calls++;
    return calls === 1 ? new Response('', { status:503 }) : calls === 2 ? response('fr') : response();
  } });
  assert.equal(await api.ensure('zh'), false);
  assert.equal(api.translate('zh', english), english);
  assert.equal(await api.ensure('zh'), false);
  assert.equal(api.translate('zh', english), english);
  assert.equal(await api.ensure('zh'), true);
  assert.equal(calls, 3);
  assert.notEqual(api.translate('zh', english), english);
});
