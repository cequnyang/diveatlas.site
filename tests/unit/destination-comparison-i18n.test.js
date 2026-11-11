const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const copy = require('../../js/destination-comparison-i18n.js');
const source = fs.readFileSync(require.resolve('../../js/destination-comparison-i18n.js'), 'utf8').replace(/\r\n/g, '\n');
const dictionaries = JSON.parse(source.split('const copy = ')[1].split(';\n  function language')[0]);

test('all fifteen website languages have complete comparison copy and matching interpolation fields', () => {
  assert.equal(copy.languages.length, 15);
  for (const language of copy.languages) {
    assert.deepEqual(Object.keys(dictionaries[language]).sort(), copy.keys.slice().sort());
    for (const key of copy.keys) {
      const parameters = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      assert.ok(dictionaries[language][key].trim(), `${language}/${key}`);
      assert.deepEqual(parameters(dictionaries[language][key]), parameters(dictionaries.en[key]), `${language}/${key}`);
    }
  }
});

test('Traditional Chinese, fallback languages and recorded names preserve their meaning', () => {
  assert.equal(copy.text('zh', 'menu'), '比较目的地');
  assert.equal(copy.text('zh-TW', 'menu'), '比較目的地');
  assert.equal(copy.text('zh-Hant', 'menu'), '比較目的地');
  assert.equal(copy.text('es', 'menu'), 'Comparar destinos');
  assert.equal(copy.text('unsupported', 'menu'), 'Compare destinations');
  assert.equal(copy.text('zh', 'title', {left:'Raja Ampat',right:'Komodo'}), '比较 Raja Ampat 与 Komodo');
});
