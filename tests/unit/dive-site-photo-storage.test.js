const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const base = path.join(root, 'assets/dive-sites');
const uid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const assignments = JSON.parse(fs.readFileSync(path.join(base, 'assignments.json'), 'utf8'));
const migration = JSON.parse(fs.readFileSync(path.join(root, 'datasets/dive-site-photo-r2.json'), 'utf8'));
const displayURL = src => migration.enabled === false ? src : migration.assets[src]?.url || src;
const available = src => fs.existsSync(path.join(root,src)) ||
  (migration.enabled !== false && !migration.held?.[src] && Boolean(migration.assets[src]));

test('public assignments exclude private research paths while retaining public provenance', () => {
  const localData = /(?:^|[^A-Za-z0-9_.:/-])(?:\.\/|\/)?data[\\/][A-Za-z0-9_.-]/i;
  function inspect(value) {
    if (typeof value === 'string') assert.ok(!localData.test(value), value);
    else if (value && typeof value === 'object') Object.values(value).forEach(inspect);
  }
  for (const entry of assignments) {
    assert.ok(!Object.hasOwn(entry, 'source_review_manifest'), entry.site_id);
    assert.ok(!Object.hasOwn(entry, 'original_archive'), entry.site_id);
    assert.ok(entry.creator && entry.licence_url && entry.source_page, entry.site_id);
    inspect(entry);
  }
});

test('all photo files live directly under their stable site UID', () => {
  for (const entry of fs.readdirSync(base, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    assert.ok(uid.test(entry.name), entry.name);
    for (const filename of fs.readdirSync(path.join(base, entry.name), {recursive: true})) {
      if (!/\.(jpg|webp|png)$/i.test(filename)) continue;
      assert.ok(uid.test(entry.name), filename);
      assert.equal(path.dirname(filename), '.', filename);
    }
  }
});

test('active references resolve to canonical UUID assets without orphaned JPEGs', () => {
    const previewOnly = JSON.parse(fs.readFileSync(path.join(base, 'additional-preview-options.json'), 'utf8'));
    const expected = new Set(previewOnly.map(photo => photo.src));
    for (const entry of assignments) {
      assert.ok(uid.test(entry.site_id));
      assert.equal(entry.desktop, undefined);
      assert.equal(entry.mobile, undefined);
      assert.match(entry.hero, /^\/assets\/dive-sites\/[a-f0-9-]{36}\/hero\.jpg$/);
      expected.add(entry.hero);
      const additional = entry.additional_photos || [];
      assert.ok(available(entry.hero), entry.hero);
      for (const photo of additional) {
        assert.match(photo.src, /^\/assets\/dive-sites\/[a-f0-9-]{36}\/(?:photo-[a-f0-9]+|hero)\.jpg$/);
        expected.add(photo.src);
        assert.ok(photo.creator && photo.source_page && photo.licence_url);
        assert.ok(available(photo.src), photo.src);
      }
    }
    const actual = fs.readdirSync(base, {recursive:true}).filter(p => p.endsWith('.jpg'))
      .map(p => '/assets/dive-sites/' + p.replaceAll(path.sep, '/'));
    assert.deepEqual([...new Set(actual)].sort(), [...expected].filter(src=>fs.existsSync(path.join(root,src))).sort());
});

test('stored image bytes have no exact duplicates', () => {
  const crypto = require('node:crypto');
  const hashes = new Map();
  for (const filename of fs.readdirSync(base, {recursive:true})) {
    if (!/\.(jpg|png|webp)$/i.test(filename)) continue;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(base, filename))).digest('hex');
    assert.ok(!hashes.has(hash), `${filename} duplicates ${hashes.get(hash)}`);
    hashes.set(hash, filename);
  }
});

test('all preview catalog images use the same shared hero as full previews', () => {
  const script = fs.readFileSync(path.join(root, 'js/dive-site-reviewed-photo-catalog.js'), 'utf8');
  const catalog = JSON.parse(script.slice(script.indexOf('=') + 1).trim().replace(/;$/, ''));
  assert.equal(catalog.length, assignments.length);
  assert.equal(new Set(assignments.map(p => p.site_id)).size, assignments.length);
  for (const entry of assignments) {
    const preview = catalog.find(p => p.siteId === entry.site_id);
    assert.equal(preview.fullSrc, displayURL(entry.hero));
    assert.equal(preview.src, displayURL(entry.hero));
    assert.ok(available(entry.hero));
    if (entry.additional_photos?.length) {
      assert.equal(preview.photos.length, entry.additional_photos.length + 1);
      assert.equal(preview.photos[0].src, displayURL(entry.hero));
      assert.deepEqual(preview.photos.slice(1).map(photo => photo.src), entry.additional_photos.map(photo => displayURL(photo.src)));
      assert.equal(new Set(preview.photos.map(photo => photo.src)).size, preview.photos.length);
    }
  }
});

test('small source-supported photos remain assigned with their credit evidence', () => {
  const small = assignments.filter(entry => entry.original_dimensions?.[0] === 335 &&
    entry.source_page?.includes('Parazoanthus_darwini.Gordon_Rocks'));
  assert.equal(small.length, 3, 'The three named Gordon Rocks records retain the accepted 335px photo');
  for (const entry of small) {
    assert.ok(entry.identity_status.includes('Gordon'));
    assert.equal(entry.licence_url, 'https://creativecommons.org/licenses/by/3.0/');
    assert.ok(entry.quality_status.includes('NOT_A_REJECTION_CRITERION'));
    assert.ok(available(entry.hero));
  }
});
