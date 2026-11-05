const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const root='http://127.0.0.1:8765';
const dir='data/content-enrichment-local/v1/sites';
const records=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));
(async()=>{
 assert.equal(records.filter(r=>r.status==='authored-draft').length,1700);
 let cursor=0;
 await Promise.all(Array.from({length:12},async()=>{while(cursor<records.length){const r=records[cursor++];const response=await fetch(root+'/__local/enrichment/v1/'+r.site_id+'.json');assert.equal(response.status,200);const actual=await response.json();assert.equal(actual.site_id,r.site_id);assert.equal(actual.overview,r.overview);assert.equal(actual.status,r.status);}}));
 console.log('PASS default draft endpoints: '+records.length+' records');
 const b=await chromium.launch();try{for(const width of [1280,390]){const context=await b.newContext({viewport:{width,height:900}});const p=await context.newPage();
 const sample=[records[0],records[Math.floor(records.length/2)],records.at(-1),records.find(r=>r.status==='named-site-background')];
 for(const r of sample){await p.goto(root+'/dive-site.html?id='+r.site_id,{waitUntil:'domcontentloaded'});await p.waitForSelector('.enrichment-guide');assert((await p.locator('.enrichment-guide').innerText()).includes(r.overview));assert.equal(await p.locator('.intro-details:visible').count(),0);await p.waitForSelector('.record-evidence .enrichment-evidence',{state:'attached'});assert.equal(await p.locator('.enrichment-guide .enrichment-evidence').count(),0);console.log('PASS',width,r.site_id,'default replacement');}
 const r=sample[0];await p.goto(root+'/dive-site.html?id='+r.site_id+'&enrichment=off');await p.waitForSelector('.site-hero');assert.equal(await p.locator('[data-enrichment]').count(),0);await p.goto(root+'/dive-site.html?id='+r.site_id);await p.waitForSelector('.site-hero');assert.equal(await p.locator('[data-enrichment]').count(),0);console.log('PASS',width,'legacy opt-out persists');await context.close();}
 const p=await b.newPage();await p.goto(root+'/dive-site.html?id=121b1b53-8a5c-44d0-8f18-37db29f017c0');await p.waitForSelector('main[data-enrichment-absent]');assert.equal(await p.locator('[data-enrichment]').count(),0);console.log('PASS non-authored page retains legacy content');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exit(1)});
