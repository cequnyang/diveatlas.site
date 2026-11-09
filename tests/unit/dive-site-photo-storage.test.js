const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const base = path.join(root, 'assets/dive-sites');
const uid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const assignments = JSON.parse(fs.readFileSync(path.join(base, 'assignments.json'), 'utf8'));

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

test('active photo references resolve within their assigned UID', () => {
    for (const entry of assignments) {
      assert.ok(uid.test(entry.site_id));
      assert.equal(entry.desktop, undefined);
      assert.equal(entry.mobile, undefined);
      assert.equal(entry.hero, `/assets/dive-sites/${entry.site_id}/hero.jpg`);
      assert.deepEqual(fs.readdirSync(path.join(base, entry.site_id)).sort(), ['hero.jpg']);
      assert.ok(fs.statSync(path.join(root, entry.hero)).isFile(), entry.hero);
    }
});

test('all preview catalog images use the same shared hero as full previews', () => {
  const script = fs.readFileSync(path.join(root, 'js/dive-site-reviewed-photo-catalog.js'), 'utf8');
  const catalog = JSON.parse(script.slice(script.indexOf('=') + 1).trim().replace(/;$/, ''));
  assert.equal(catalog.length, assignments.length);
  assert.equal(new Set(assignments.map(p => p.site_id)).size, assignments.length);
  for (const entry of assignments) {
    const preview = catalog.find(p => p.siteId === entry.site_id);
    assert.equal(preview.fullSrc, entry.hero);
    assert.equal(preview.src, entry.hero);
    assert.ok(fs.statSync(path.join(root, preview.src)).isFile());
  }
});
