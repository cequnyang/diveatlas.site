const {test,expect}=require('@playwright/test');
const {openMap,clickFixture}=require('./support');
const KEY='diveatlas-saved-trips-v1';

// Gesture cases are selected by the mobile project instead of skipped at runtime.
test('mobile trips handle reuses sheet drag, snaps back, dismisses and resets',async({page})=>{
  await openMap(page);
  await page.locator('#savedTripsButton').click();
  const panel=page.locator('#savedTripsPanel'),handle=panel.locator('.diveatlas-mobile-sheet-handle');
  await expect(panel).not.toHaveClass(/mobile-sheet-entering/);
  await expect.poll(()=>panel.evaluate(el=>getComputedStyle(el).translate)).toBe('0px');
  const box=await handle.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+30,{steps:6});await page.mouse.up();
  await expect(panel).toBeVisible();
  await expect.poll(()=>panel.evaluate(el=>getComputedStyle(el).translate)).toBe('0px');
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+110,{steps:10});await page.mouse.up();
  await expect(panel).toBeHidden();
  await page.locator('#savedTripsButton').click();await expect(panel).toBeVisible();
  expect(await panel.evaluate(el=>el.style.getPropertyValue('--mobile-panel-drag-y'))).toBe('');
});


test('mobile trips closes once with an exit transition',async({page})=>{
  await openMap(page);
  const sheet=page.locator('#savedTripsPanel');
  await page.locator('#savedTripsButton').click();
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/mobile-sheet-entering/);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveClass(/mobile-sheet-exiting/);
  await expect(sheet).toBeHidden();
  await page.locator('#savedTripsButton').click();
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/mobile-sheet-exiting/);
});

test('mobile trips cancels exit when reopened immediately',async({page})=>{
  await openMap(page);
  const button=page.locator('#savedTripsButton'), sheet=page.locator('#savedTripsPanel');
  await button.click();
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/mobile-sheet-entering/);
  await button.evaluate(el=>{el.click();el.click();});
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(400);
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/mobile-sheet-exiting/);
});

test('mobile trip selector uses the search-results drag handle',async({page})=>{
  const saved={version:1,active:'one',trips:[{id:'one',name:'Portugal in November',month:11,sites:[],context:null},{id:'two',name:'Madeira',month:null,sites:[],context:null}]};
  await openMap(page,{localStorage:{[KEY]:JSON.stringify(saved)}});
  await page.locator('#savedTripsButton').click();await page.getByRole('button',{name:'Choose trip',exact:true}).click();
  const menu=page.locator('#savedTripsMenu'),handle=menu.locator('.dive-search-results-handle');
  await expect(handle).toBeVisible();
  const rect=await handle.boundingBox(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  const collapseDirection=(await menu.getAttribute('data-placement'))==='above'?1:-1;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+collapseDirection*115,{steps:12});await page.mouse.up();
  await expect(menu).toBeHidden();await expect(page.locator('#savedTripsPanel')).toBeVisible();
  await page.getByRole('button',{name:'Choose trip',exact:true}).click();await expect(menu).toBeVisible();
  expect(await menu.evaluate(el=>el.style.height)).toBe('');
});


test('mobile My trips enters from below the viewport and settles at its sheet position',async({page})=>{
  await openMap(page);
  const start=await page.evaluate(()=>{
    document.getElementById('savedTripsButton').click();
    const sheet=document.getElementById('savedTripsPanel');
    return {entering:sheet.classList.contains('mobile-sheet-entering'),top:sheet.getBoundingClientRect().top,height:innerHeight};
  });
  expect(start.entering).toBe(true);expect(start.top).toBeGreaterThanOrEqual(start.height-1);
  const sheet=page.locator('#savedTripsPanel');
  await expect(sheet).not.toHaveClass(/mobile-sheet-entering/);
  await expect.poll(()=>sheet.evaluate(el=>getComputedStyle(el).translate)).toBe('0px');
  expect(await sheet.evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(start.height-50);
  await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#savedTripsButton').click();
  await expect(sheet).not.toHaveClass(/mobile-sheet-entering/);
});


test('mobile sheets share the dive-site corner radius token',async({page})=>{
  await openMap(page);
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--radius-sheet').trim())).toBe('18px');
  await page.evaluate(()=>{
    document.documentElement.style.setProperty('--radius-sheet','26px');
    window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,'shared-radius',{withFallbackPhoto:true});
  });
  await clickFixture(page,'shared-radius');
  const wrapper=page.locator('.diveatlas-mobile-sheet > .leaflet-popup-content-wrapper');
  expect(await wrapper.evaluate(el=>getComputedStyle(el).borderTopLeftRadius)).toBe('26px');
  expect(await page.locator('.diveatlas-mobile-sheet').evaluate(el=>getComputedStyle(el).borderTopRightRadius)).toBe('26px');
  await page.locator('#savedTripsButton').click();
  const panel=page.locator('#savedTripsPanel');
  expect(await panel.evaluate(el=>getComputedStyle(el).borderTopLeftRadius)).toBe('26px');
  expect(await panel.evaluate(el=>getComputedStyle(el).borderBottomLeftRadius)).toBe('0px');
});


test('long mobile trip menu opens above its selector and stays scrollable',async({page})=>{
  const trips={version:1,active:'trip0',trips:Array.from({length:12},(_,i)=>({id:`trip${i}`,name:`Trip ${i}`,month:null,sites:[],context:null}))};
  await openMap(page,{localStorage:{[KEY]:JSON.stringify(trips)}});
  await page.locator('#savedTripsButton').click();
  const trigger=page.getByRole('button',{name:'Choose trip',exact:true});
  await trigger.click();
  const menu=page.locator('#savedTripsMenu');
  await expect(menu).toBeVisible();
  const anchor=await trigger.boundingBox(),box=await menu.boundingBox();
  expect(box.y+box.height).toBeLessThanOrEqual(anchor.y-7);
  const headerBottom=await page.locator('#topMenuBar').evaluate(el=>el.getBoundingClientRect().bottom);
  expect(box.y).toBeGreaterThanOrEqual(headerBottom+7);
  await expect(menu).toHaveAttribute('data-placement','above');
  const handle=await menu.locator('.dive-search-results-handle').boundingBox();
  const list=await menu.locator('.dive-search-results-scroll').boundingBox();
  expect(handle.y+handle.height).toBeLessThanOrEqual(list.y+1);
  expect(await menu.locator('.dive-search-results-scroll').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await menu.getByRole('option',{name:'Trip 11',exact:false}).scrollIntoViewIfNeeded();
  await menu.getByRole('option',{name:'Trip 11',exact:false}).click();
  await expect(trigger).toHaveText('Trip 11');
  await trigger.click();
  const grip=menu.locator('.dive-search-results-handle');
  await expect(grip).toHaveAttribute('aria-label','Close trip selector; swipe down');
  const geometry=await grip.evaluate(el=>{
    el.setPointerCapture=()=>{};
    const menu=el.parentElement,start=menu.getBoundingClientRect();
    const fire=(type,y)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:7,button:0,clientX:100,clientY:y,cancelable:true}));
    fire('pointerdown',200);fire('pointermove',-2000);
    const expandedRect=menu.getBoundingClientRect();
    const expanded=expandedRect.height;
    fire('pointercancel',170);
    fire('pointerdown',200);fire('pointermove',230);
    const shrunk=menu.getBoundingClientRect();
    fire('pointerup',230);
    return {expandedTop:expandedRect.top,start:start.height,expanded,shrunk:shrunk.height,bottom:start.bottom,shrunkBottom:shrunk.bottom};
  });
  expect(geometry.expanded).toBeGreaterThanOrEqual(geometry.start);
  expect(geometry.expandedTop).toBeGreaterThanOrEqual(headerBottom+7);
  expect(geometry.shrunk).toBeLessThan(geometry.start);
  expect(geometry.shrunkBottom).toBeCloseTo(geometry.bottom,0);
  await expect(menu).toBeVisible();
  await grip.evaluate(el=>{
    const fire=(type,y)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:8,button:0,clientX:100,clientY:y,cancelable:true}));
    fire('pointerdown',200);fire('pointermove',300);fire('pointerup',300);
  });
  await expect(menu).toBeHidden();
  await expect(page.locator('#savedTripsPanel')).toBeVisible();
});
