// Keep ordinary UI tests offline while exercising the real migrated URL. Live
// R2 delivery and CORS are verified separately by the migration browser checks.
const path=require('node:path');
const fs=require('node:fs');
const manifest=require('../../datasets/dive-site-photo-r2.json');
const byURL=new Map(Object.entries(manifest.assets).map(([local,item])=>[item.url,local]));
const displayURL=src=>manifest.enabled===false?src:manifest.assets[src]?.url||src;
async function mockR2Images(page){
 await page.route('https://assets.diveatlas.site/site-photos/v1/**',route=>{
  const local=byURL.get(route.request().url());
  if (!local) return route.abort();
  const file=path.resolve(__dirname,'../..',local.slice(1));
  if(fs.existsSync(file))return route.fulfill({path:file});
  // A clean checkout intentionally has no R2 payload backups. Offline UI tests
  // need a decodable response, not another tracked copy of a real photograph.
  return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#19728a"/></svg>'});
 });
}
module.exports={displayURL,mockR2Images};
