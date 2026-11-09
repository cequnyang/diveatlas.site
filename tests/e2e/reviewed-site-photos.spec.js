const { test, expect } = require('@playwright/test');
const {openMap, setMapView}=require('./support');
const fs=require('node:fs');
const photos=JSON.parse(fs.readFileSync('assets/dive-sites/assignments.json','utf8'));

test('reviewed thumbnails follow stable permalinks across initial, dynamic and cloned cards',async({page})=>{
 // Bound simultaneous image decodes as the assignment catalog grows.
 test.setTimeout(120_000);
 await page.route('https://**',r=>r.abort());
 await page.goto('/dive-sites/richelieu-rock/');
 await page.waitForFunction(()=>Boolean(window.DiveAtlasReviewedPhotos));
 for(let offset=0;offset<photos.length;offset+=24){
  const batch=photos.slice(offset,offset+24);
  await page.evaluate(photos=>{
   document.querySelector('#thumbnail-regression')?.remove();
   const list=document.createElement('ul');list.id='thumbnail-regression';
   for(const [i,p] of photos.entries()){
    const li=document.createElement('li');const a=document.createElement('a');a.className='site-recommendations__card';a.href=i%2?'/dive-sites/'+p.slug+'/':'/dive-site.html?id=reviewed-'+p.site_id;
    a.innerHTML='<span class="site-recommendations__image site-recommendations__image--placeholder"></span>';li.append(a);list.append(li);
   }
   document.body.append(list);
  },batch);
  await expect(page.locator('#thumbnail-regression img[data-reviewed-thumbnail]')).toHaveCount(batch.length);
  const actual=await page.locator('#thumbnail-regression img').evaluateAll(images=>images.map(i=>({src:i.getAttribute('src'),title:i.title,decoded:i.complete&&i.naturalWidth>0})));
  expect(actual).toEqual(batch.map(p=>({src:'/assets/dive-sites/'+p.site_id+'/thumbnail.jpg',title:expect.stringContaining(p.licence),decoded:true})));
  await page.evaluate(()=>{const card=document.querySelector('#thumbnail-regression li');document.querySelector('#thumbnail-regression').append(card.cloneNode(true));});
  await expect(page.locator('#thumbnail-regression img[data-reviewed-thumbnail]')).toHaveCount(batch.length+1);
  await page.locator('#thumbnail-regression img').first().evaluate(image=>{image.src='/assets/diveatlas-logo.svg'});
  await expect(page.locator('#thumbnail-regression img').first()).toHaveAttribute('src',new RegExp(batch[0].site_id+'/thumbnail.jpg$'));
 }
 const invalid=await page.evaluate(()=>['https://elsewhere.example/dive-sites/richelieu-rock/','/dive-sites/richelieu-rock-homonym/','/dive-site.html?id=00000000-0000-0000-0000-000000000000'].map(url=>window.DiveAtlasReviewedPhotos.photoForLink(url)));
 expect(invalid).toEqual([null,null,null]);
});

test('unavailable reviewed thumbnail retains the existing card image',async({page})=>{
 await page.route('https://**',r=>r.abort());
 const p=photos[3];await page.route('**/'+p.site_id+'/thumbnail.jpg',r=>r.fulfill({status:404,body:'fixture missing'}));
 await page.goto('/dive-sites/richelieu-rock/');await page.waitForFunction(()=>Boolean(window.DiveAtlasReviewedPhotos));
 await page.evaluate(p=>{const card=document.createElement('a');card.id='thumbnail-failure';card.href='/dive-sites/'+p.slug+'/';card.innerHTML='<img src="/assets/diveatlas-logo.svg" alt="Existing preview">';document.body.append(card)},p);
 await page.waitForTimeout(400);await expect(page.locator('#thumbnail-failure img')).toHaveAttribute('src','/assets/diveatlas-logo.svg');
});

test('map popup and enlarged preview use the assigned photo with context and linked attribution',async({page})=>{
 await openMap(page,{localStorage:{'global-coral-map-lang':'en'}});await page.waitForFunction(()=>Boolean(window.DiveAtlasReviewedPhotos));
 for(const p of [photos[3],photos[4],photos.find(p=>p.review_id==='c089'),...photos.slice(-3)]){
  await setMapView(page,-5.7,131,14);
  await page.evaluate(p=>{window.__DIVEATLAS_TEST__.map.closePopup();window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,p.site_id,{withFallbackPhoto:true}).openPopup()},p);
  const popup=page.locator('.leaflet-popup.dive-site-popup--with-photo').filter({has:page.locator('img.dive-popup-photo[src*="'+p.site_id+'"]')});await expect(popup).toBeVisible();
  await expect(popup.locator('.dive-popup-photo')).toHaveAttribute('src',new RegExp(p.site_id+'/thumbnail.jpg$'));
  await expect(popup.locator('.dive-popup-photo-label--reviewed')).toHaveText(p.hide_context_label?'':p.label);
  await expect(popup.locator('a[href="'+p.source_page+'"]')).toHaveCount(1);
  await expect(popup.locator('a[href="'+p.licence_url+'"]')).toHaveCount(1);
  await popup.locator('.dive-popup-photo-trigger').click();await expect(page.locator('.dive-photo-preview[open]')).toBeVisible();await expect(page.locator('.dive-photo-preview__image')).toHaveAttribute('src',p.desktop);
  await expect(page.locator('.dive-photo-preview__credit a[href="'+p.source_page+'"]')).toHaveCount(1);await page.locator('.dive-photo-preview__close').click();await expect(page.locator('.dive-photo-preview')).not.toBeVisible();
 }
});

test('published directory cards show the same real thumbnail without changing their card layout',async({page},testInfo)=>{
 await page.route('https://**',r=>r.abort());
 await page.goto('/regions/?area=%5B%22europe%22%2C%22southern%20europe%22%2C%22malta%22%2C%22malta%20and%20gozo%22%5D&page=8');
 const card=page.locator('a.site-recommendations__card[href*="4be432e2-22d5-4c5f-8cb2-609d61b15e68"]');
 await expect(card.locator('img[data-reviewed-thumbnail]')).toHaveCount(1);
 await card.scrollIntoViewIfNeeded();await expect(card.locator('img')).toHaveAttribute('src',/4be432e2-22d5-4c5f-8cb2-609d61b15e68\/thumbnail.jpg$/);
 await expect(card.locator('[data-reviewed-thumbnail-tag]').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.screenshot({path:'data/image-application-additional-20261108/directory-'+testInfo.project.name+'.png'});
});

test('a failing old image cannot discard a reviewed thumbnail while it decodes',async({page})=>{
 await page.route('https://**',r=>r.abort());const p=photos[4];
 await page.route('**/'+p.site_id+'/thumbnail.jpg',async route=>{await new Promise(resolve=>setTimeout(resolve,200));await route.continue();});
 await page.goto('/dive-sites/richelieu-rock/');await page.waitForFunction(()=>Boolean(window.DiveAtlasReviewedPhotos));
 const request=page.waitForRequest('**/'+p.site_id+'/thumbnail.jpg');
 await page.evaluate(p=>{const a=document.createElement('a');a.id='decode-race';a.href='/dive-sites/'+p.slug+'/';a.innerHTML='<img class="site-recommendations__image" src="/assets/diveatlas-logo.svg">';document.body.append(a)},p);
 await request;
 await page.evaluate(()=>{const placeholder=document.createElement('span');placeholder.className='site-recommendations__image site-recommendations__image--placeholder';document.querySelector('#decode-race img').replaceWith(placeholder)});
 await expect(page.locator('#decode-race img[data-reviewed-thumbnail]')).toHaveCount(1);
});


test('UID-organized hero images load on desktop and mobile with source credits',async({page})=>{
 await page.route('https://**',r=>r.abort());
 const p=photos[1];
 await page.goto('/dive-sites/'+p.slug+'/');
 const hero=page.locator('main[data-reviewed-images="main"] .reviewed-photo');
 await expect(hero).toBeVisible();
 await expect(hero).toHaveAttribute('src',p.desktop);
 await expect(hero.locator('..').locator('source')).toHaveAttribute('srcset',p.mobile);
 await expect.poll(()=>hero.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
 const expected=await page.evaluate(p=>innerWidth<=720?p.mobile:p.desktop,p);
 await expect.poll(()=>hero.evaluate(image=>new URL(image.currentSrc).pathname)).toBe(expected);
 await expect(page.locator('.site-hero a[href="'+p.source_page+'"]')).toHaveCount(1);
});
