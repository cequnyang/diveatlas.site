const { test, expect } = require('@playwright/test');
const {openMap, setMapView}=require('./support');
const {displayURL,mockR2Images}=require('./photo-assets.cjs');
const fs=require('node:fs');
const photos=JSON.parse(fs.readFileSync('assets/dive-sites/assignments.json','utf8'));

test('reviewed thumbnails follow stable permalinks across initial, dynamic and cloned cards',async({page})=>{
 // Bound simultaneous image decodes as the assignment catalog grows.
 test.setTimeout(120_000);
 await page.route('https://**',r=>r.abort());await mockR2Images(page);
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
  expect(actual).toEqual(batch.map(p=>({src:displayURL(p.hero),title:expect.stringContaining(p.licence),decoded:true})));
  await page.evaluate(()=>{const card=document.querySelector('#thumbnail-regression li');document.querySelector('#thumbnail-regression').append(card.cloneNode(true));});
  await expect(page.locator('#thumbnail-regression img[data-reviewed-thumbnail]')).toHaveCount(batch.length+1);
  await page.locator('#thumbnail-regression img').first().evaluate(image=>{image.src='/assets/diveatlas-logo.svg'});
  await expect(page.locator('#thumbnail-regression img').first()).toHaveAttribute('src',displayURL(batch[0].hero));
 }
 const invalid=await page.evaluate(()=>['https://elsewhere.example/dive-sites/richelieu-rock/','/dive-sites/richelieu-rock-homonym/','/dive-site.html?id=00000000-0000-0000-0000-000000000000'].map(url=>window.DiveAtlasReviewedPhotos.photoForLink(url)));
 expect(invalid).toEqual([null,null,null]);
});

test('unavailable reviewed thumbnail retains the existing card image',async({page})=>{
 await page.route('https://**',r=>r.abort());await mockR2Images(page);
 const p=photos[3];await page.route('**'+displayURL(p.hero),r=>r.fulfill({status:404,body:'fixture missing'}));
 await page.goto('/dive-sites/richelieu-rock/');await page.waitForFunction(()=>Boolean(window.DiveAtlasReviewedPhotos));
 await page.evaluate(p=>{const card=document.createElement('a');card.id='thumbnail-failure';card.href='/dive-sites/'+p.slug+'/';card.innerHTML='<img src="/assets/diveatlas-logo.svg" alt="Existing preview">';document.body.append(card)},p);
 await page.waitForTimeout(400);await expect(page.locator('#thumbnail-failure img')).toHaveAttribute('src','/assets/diveatlas-logo.svg');
});

test('map popup and enlarged preview use the assigned photo with context and linked attribution',async({page})=>{
 await openMap(page,{localStorage:{'global-coral-map-lang':'en'}});await page.waitForFunction(()=>Boolean(window.DiveAtlasReviewedPhotos));
 // Register after openMap's external-request blocker so migrated images decode offline.
 await mockR2Images(page);
 for(const p of [photos[3],photos[4],photos.find(p=>p.name==='Ashos Gap (Shark Cleaning Station)'),photos.find(p=>p.review_id==='c089'),...photos.slice(-3)]){
  await setMapView(page,-5.7,131,14);
  await page.evaluate(p=>{window.__DIVEATLAS_TEST__.map.closePopup();window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,p.site_id,{withFallbackPhoto:true}).openPopup()},p);
  // R2 filenames are content hashes, so identify the assigned image by its resolved URL.
  const popup=page.locator('.leaflet-popup.dive-site-popup--with-photo').filter({has:page.locator('img.dive-popup-photo').and(page.locator('[src="'+displayURL(p.hero)+'"]'))});await expect(popup).toBeVisible();
  await expect(popup.locator('.dive-popup-photo')).toHaveAttribute('src',displayURL(p.hero));
  await expect.poll(()=>popup.locator('.dive-popup-photo').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await expect(popup.locator('.dive-popup-photo-label--reviewed')).toHaveCount(0);
  // Source and licence evidence may share a URL. Check each credit role rather
  // than assuming that URL occurs only once (including in site references).
  const credit=popup.locator('.dive-popup-photo-credit');
  await expect(credit.getByRole('link',{name:'Source',exact:true})).toHaveAttribute('href',p.source_page);
  await expect(credit.getByRole('link',{name:p.licence,exact:true})).toHaveAttribute('href',p.licence_url);
  await popup.locator('.dive-popup-photo-trigger').click();await expect(page.locator('.dive-photo-preview[open]')).toBeVisible();await expect(page.locator('.dive-photo-preview__image')).toHaveAttribute('src',displayURL(p.hero));
  const previewCredit=page.locator('.dive-photo-preview__credit');
  await expect(previewCredit.getByRole('link',{name:'Source',exact:true})).toHaveAttribute('href',p.source_page);
  await expect(previewCredit.getByRole('link',{name:p.licence,exact:true})).toHaveAttribute('href',p.licence_url);
  await page.locator('.dive-photo-preview__close').click();await expect(page.locator('.dive-photo-preview')).not.toBeVisible();
 }
});

test('published directory cards show the same real thumbnail without changing their card layout',async({page},testInfo)=>{
 await page.route('https://**',r=>r.abort());await mockR2Images(page);
 await page.goto('/regions/?area=%5B%22europe%22%2C%22southern%20europe%22%2C%22malta%22%2C%22malta%20and%20gozo%22%5D&page=8');
 const card=page.locator('a.site-recommendations__card[href*="4be432e2-22d5-4c5f-8cb2-609d61b15e68"]');
 await expect(card.locator('img[data-reviewed-thumbnail]')).toHaveCount(1);
 // Directory hydration can replace the card while scrolling; reacquire it on retry.
 await expect(async()=>{await card.scrollIntoViewIfNeeded();await expect(card).toBeInViewport();}).toPass({timeout:5000});
 await expect(card.locator('img')).toHaveAttribute('src',displayURL(photos.find(p=>p.site_id==='4be432e2-22d5-4c5f-8cb2-609d61b15e68').hero));
 await expect(card.locator('[data-reviewed-thumbnail-tag]').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.screenshot({path:'data/image-application-additional-20261108/directory-'+testInfo.project.name+'.png'});
});

test('a failing old image cannot discard a reviewed thumbnail while it decodes',async({page})=>{
 await page.route('https://**',r=>r.abort());await mockR2Images(page);const p=photos[4];
 await page.route('**'+displayURL(p.hero),async route=>{await new Promise(resolve=>setTimeout(resolve,200));await route.continue();});
 await page.goto('/dive-sites/richelieu-rock/');await page.waitForFunction(()=>Boolean(window.DiveAtlasReviewedPhotos));
 const request=page.waitForRequest('**'+displayURL(p.hero));
 await page.evaluate(p=>{const a=document.createElement('a');a.id='decode-race';a.href='/dive-sites/'+p.slug+'/';a.innerHTML='<img class="site-recommendations__image" src="/assets/diveatlas-logo.svg">';document.body.append(a)},p);
 await request;
 await page.evaluate(()=>{const placeholder=document.createElement('span');placeholder.className='site-recommendations__image site-recommendations__image--placeholder';document.querySelector('#decode-race img').replaceWith(placeholder)});
 await expect(page.locator('#decode-race img[data-reviewed-thumbnail]')).toHaveCount(1);
});


test('one hero source is browser-cropped across viewport changes with source credits',async({page})=>{
 await page.route('https://**',r=>r.abort());await mockR2Images(page);
 const p=photos[1];
 const heroPath=new URL(displayURL(p.hero),'http://localhost').pathname;
 const requests=[];
 page.on('request',request=>{if(new URL(request.url()).pathname===heroPath)requests.push(new URL(request.url()).pathname)});
 await page.goto('/dive-sites/'+p.slug+'/');
 const hero=page.locator('main[data-reviewed-images="main"] .reviewed-photo');
 await expect(hero).toBeVisible();
 await expect(hero).toHaveAttribute('src',displayURL(p.hero));
 await expect(hero.locator('..').locator('source')).toHaveCount(0);
 expect(await hero.getAttribute('srcset')).toBe(null);
 await expect.poll(()=>hero.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
 await expect.poll(()=>hero.evaluate(image=>new URL(image.currentSrc).pathname)).toBe(heroPath);
 await expect(hero).toHaveCSS('object-fit','cover');
 await expect(hero).toHaveCSS('object-position','50% 50%');
 // A small preview on the same page must reuse the hero resource and crop locally.
 await page.evaluate(p=>{
  const card=document.createElement('a');card.id='shared-hero-card';card.className='site-recommendations__card';
  card.href='/dive-sites/'+p.slug+'/';card.innerHTML='<img class="site-recommendations__image" src="/assets/diveatlas-logo.svg">';document.body.append(card);
 },p);
 const preview=page.locator('#shared-hero-card img[data-reviewed-thumbnail]');
 await expect(preview).toHaveAttribute('src',displayURL(p.hero));
 await expect(preview).toHaveCSS('object-fit','cover');
 const initialWidth=await hero.evaluate(image=>image.getBoundingClientRect().width);
 const wasMobile=await page.evaluate(()=>innerWidth<=720);
 await page.setViewportSize(wasMobile?{width:1280,height:900}:{width:390,height:844});
 await expect.poll(()=>hero.evaluate(image=>image.getBoundingClientRect().width)).not.toBe(initialWidth);
 await expect.poll(()=>hero.evaluate(image=>new URL(image.currentSrc).pathname)).toBe(heroPath);
 await expect(hero).toHaveCSS('object-fit','cover');
 expect(requests.filter(url=>url!==heroPath)).toEqual([]);
 expect(requests.filter(url=>url===heroPath)).toHaveLength(1);
 await expect(page.locator('.site-hero a[href="'+p.source_page+'"]')).toHaveCount(1);
});

test('additional preview options preserve the hero and change linked credits on selection',async({page},testInfo)=>{
 await page.route('https://**',r=>r.abort());await mockR2Images(page);
 const p=photos.find(entry=>entry.additional_photos?.length>=3);
 expect(p).toBeTruthy();
 const extraRequests=[];
 page.on('request',request=>{if(request.url().includes('/'+p.site_id+'/photo-'))extraRequests.push(request.url());});
 await page.goto('/dive-sites/'+p.slug+'/');
 const hero=page.locator('.site-hero img.reviewed-photo');
 await expect(hero).toHaveAttribute('src',displayURL(p.hero));
 expect(extraRequests).toEqual([]);
 await page.locator('.site-hero .reviewed-image-trigger').click();
 const dialog=page.locator('.dive-photo-preview[open]');
 await expect(dialog.locator('.dive-photo-preview__thumbnail')).toHaveCount(p.additional_photos.length+1);
 for(const [i,extra] of p.additional_photos.entries()){
  await dialog.locator('.dive-photo-preview__thumbnail').nth(i+1).click();
  await expect(dialog.locator('.dive-photo-preview__image')).toHaveAttribute('src',displayURL(extra.src));
  await expect(dialog.locator('.dive-photo-preview__credit')).toContainText(extra.creator);
  await expect(dialog.locator('.dive-photo-preview__credit a[href="'+extra.source_page+'"]')).toHaveCount(1);
  await expect(dialog.locator('.dive-photo-preview__credit a[href="'+extra.licence_url+'"]')).toHaveCount(1);
 }
 if(testInfo.project.name.includes('mobile')){
  await dialog.locator('.dive-photo-preview__thumbnail').first().click();
  const pane=await dialog.locator('.dive-photo-preview__image-pane').boundingBox();
  const cdp=await page.context().newCDPSession(page), y=pane.y+pane.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pane.x+pane.width*.8,y}]});
  for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:pane.x+pane.width*(.8-.6*step/6),y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(dialog.locator('.dive-photo-preview__image')).toHaveAttribute('src',displayURL(p.additional_photos[0].src));
  await expect(dialog.locator('.dive-photo-preview__credit a[href="'+p.additional_photos[0].source_page+'"]')).toHaveCount(1);
  await cdp.detach();
 }
 await page.screenshot({path:'data/image-additional-options-20261109/preview-'+testInfo.project.name+'.png'});
 await dialog.locator('.dive-photo-preview__close').click();
 await expect(hero).toHaveAttribute('src',displayURL(p.hero));
 await page.locator('.site-hero .reviewed-image-trigger').click();
 await expect(dialog.locator('.dive-photo-preview__image')).toHaveAttribute('src',displayURL(p.hero));
 await expect(dialog.locator('.dive-photo-preview__credit a[href="'+p.source_page+'"]')).toHaveCount(1);
 await dialog.locator('.dive-photo-preview__close').click();
 await page.locator('.site-hero .hero-copy h1').click();
 await expect(dialog).toBeVisible();
 await dialog.locator('.dive-photo-preview__close').click();
 const breadcrumb=page.locator('.site-hero .breadcrumbs a').first();
 // Preserve the page to inspect event routing without fetching the destination.
 await breadcrumb.evaluate(a=>a.addEventListener('click',event=>event.preventDefault(),{once:true}));
 await breadcrumb.click();
 await expect(dialog).not.toBeVisible();
});

test('map photo preview includes the same additional options with individual source links',async({page})=>{
 const p=photos.find(entry=>entry.additional_photos?.length);
 await openMap(page,{localStorage:{'global-coral-map-lang':'en'}});
 await mockR2Images(page);
 await page.waitForFunction(()=>Boolean(window.DiveAtlasReviewedPhotos));
 await setMapView(page,-5.7,131,14);
 await page.evaluate(p=>window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,p.site_id,{withFallbackPhoto:true}).openPopup(),p);
 const popup=page.locator('.leaflet-popup.dive-site-popup--with-photo');
 await expect(popup.locator('.dive-popup-photo')).toHaveAttribute('src',displayURL(p.hero));
 await popup.locator('.dive-popup-photo-trigger').click();
 const dialog=page.locator('.dive-photo-preview[open]');
 await expect(dialog.locator('.dive-photo-preview__thumbnail')).toHaveCount(p.additional_photos.length+1);
 await dialog.locator('.dive-photo-preview__thumbnail').nth(1).click();
 await expect(dialog.locator('.dive-photo-preview__image')).toHaveAttribute('src',displayURL(p.additional_photos[0].src));
 await expect.poll(()=>dialog.locator('.dive-photo-preview__image').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
 await expect(dialog.locator('.dive-photo-preview__credit a[href="'+p.additional_photos[0].source_page+'"]')).toHaveCount(1);
});

test('small real photos remain eligible and retain exact collection credit when selected',async({page})=>{
 await page.route('https://**',r=>r.abort());await mockR2Images(page);
 const p=photos.find(entry=>entry.attribution_detail?.includes('© Akira Sonoda'));
 expect(p).toBeTruthy();
 expect(p.original_dimensions[0]).toBeLessThan(1200);
 await page.goto('/dive-sites/'+p.slug+'/');
 await expect(page.locator('main[data-reviewed-images="main"]')).toBeVisible();
 await page.locator('.site-hero .hero-copy h1').click();
 const dialog=page.locator('.dive-photo-preview[open]');
 await expect(dialog.locator('.dive-photo-preview__image')).toHaveAttribute('src',displayURL(p.hero));
 await dialog.locator('.dive-photo-preview__credit summary').click();
 await expect(dialog.locator('.dive-photo-preview__credit details')).toContainText('Image collection in the Coral Reef Network WEB System © Akira Sonoda licensed under CC Attribution-Share Alike 4.0 International');
 await expect(dialog.locator('.dive-photo-preview__credit a[href="'+p.licence_url+'"]')).toHaveCount(1);
 if(p.additional_photos?.length){
  await dialog.locator('.dive-photo-preview__thumbnail').nth(1).click();
  await expect(dialog.locator('.dive-photo-preview__credit details')).toHaveCount(1);
  await dialog.locator('.dive-photo-preview__credit summary').click();
  await expect(dialog.locator('.dive-photo-preview__credit details')).toContainText('© Akira Sonoda');
 }
});
