const {test,expect}=require('@playwright/test');
const {openMap}=require('./support');
const KEY='diveatlas-saved-trips-v1';

// Gesture cases are selected by the mobile project instead of skipped at runtime.
test('mobile trips handle reuses sheet drag, snaps back, dismisses and resets',async({page})=>{
  await openMap(page);
  await page.locator('#savedTripsButton').click();
  const panel=page.locator('#savedTripsPanel'),handle=panel.locator('.diveatlas-mobile-sheet-handle');
  const box=await handle.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+30,{steps:6});await page.mouse.up();
  await expect(panel).toBeVisible();
  await expect.poll(()=>panel.evaluate(el=>getComputedStyle(el).translate)).toBe('0px');
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+110,{steps:10});await page.mouse.up();
  await expect(panel).toBeHidden();
  await page.locator('#savedTripsButton').click();await expect(panel).toBeVisible();
  expect(await panel.evaluate(el=>el.style.getPropertyValue('--mobile-panel-drag-y'))).toBe('');
});



test('mobile trip selector uses the search-results drag handle',async({page})=>{
  const saved={version:1,active:'one',trips:[{id:'one',name:'Portugal in November',month:11,sites:[],context:null},{id:'two',name:'Madeira',month:null,sites:[],context:null}]};
  await openMap(page,{localStorage:{[KEY]:JSON.stringify(saved)}});
  await page.locator('#savedTripsButton').click();await page.getByRole('button',{name:'Choose trip',exact:true}).click();
  const menu=page.locator('#savedTripsMenu'),handle=menu.locator('.dive-search-results-handle');
  await expect(handle).toBeVisible();
  const rect=await handle.boundingBox(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-115,{steps:12});await page.mouse.up();
  await expect(menu).toBeHidden();await expect(page.locator('#savedTripsPanel')).toBeVisible();
  await page.getByRole('button',{name:'Choose trip',exact:true}).click();await expect(menu).toBeVisible();
  expect(await menu.evaluate(el=>el.style.height)).toBe('');
});
