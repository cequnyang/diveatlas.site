const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('verified R2 browser resolver preserves local holds and already resolved URLs',()=>{
 const context={};vm.runInNewContext(fs.readFileSync('js/dive-site-photo-asset-urls.js','utf8').replace('export function','function'),context);
 const manifest=JSON.parse(fs.readFileSync('datasets/dive-site-photo-r2.json','utf8'));
 for(const [src,item] of Object.entries(manifest.assets)){
  assert.equal(context.photoAssetUrl(src),item.url);
  assert.equal(context.photoAssetUrl(src.slice(1)),item.url);
  assert.equal(context.photoAssetUrl(item.url),item.url);
 }
 assert.equal(context.photoAssetUrl('/assets/dive-sites/held/hero.jpg'),'/assets/dive-sites/held/hero.jpg');
});
