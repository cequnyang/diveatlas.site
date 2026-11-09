const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const options=JSON.parse(fs.readFileSync(path.join(root,'assets/dive-sites/additional-preview-options.json')));
const hosted=JSON.parse(fs.readFileSync(path.join(root,'datasets/dive-site-photo-r2.json')));
test('preview-only options retain provenance, local assets, review caveats and stable site joins',()=>{
 const seen=new Set();
 for(const o of options){
  const key=o.siteId+':'+o.originalSha256;assert(!seen.has(key));seen.add(key);
  assert.match(o.src,/^\/assets\/dive-sites\/[a-f0-9-]{36}\/(?:preview-option-[a-f0-9]+|photo-[a-f0-9]+|hero)\.jpg$/);
  assert(fs.existsSync(path.join(root,o.src)) || (hosted.enabled!==false&&!hosted.held?.[o.src]&&hosted.assets[o.src]));
  const html=fs.readFileSync(path.join(root,'dive-sites',o.slug,'index.html'),'utf8');
  assert(html.includes('data-site-id="'+o.siteId+'"'));
  assert.equal(o.publication,'NOT_AUTHORIZED');
  assert(o.credit&&o.creditLinks.some(l=>l.label==='Source'));
  assert(o.attributionDetail.includes('NOT been newly verified'));
 }
});
test('preview-only registry does not masquerade as hero or thumbnail assignments',()=>{
 const src=fs.readFileSync(path.join(root,'js/dive-site-reviewed-thumbnails.js'),'utf8');
 assert(src.includes('additionalForSite: id => (additionalById.get(id) || []).filter'));
 assert(src.includes('photo.originalSha256 !== byId.get(id)?.originalSha256'));
 assert(src.includes('new Map(reviewedPhotos.map(photo => [photo.siteId, photo]))'));
 assert(!src.includes('reviewedPhotos.push'));
});
