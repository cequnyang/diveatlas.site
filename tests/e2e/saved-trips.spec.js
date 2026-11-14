const {test,expect}=require('@playwright/test');
const {openMap,clickFixture}=require('./support');
const KEY='diveatlas-saved-trips-v1';
test('map saves a site, opens and closes its list without moving, and persists trips',async({page})=>{
  await openMap(page);
  await page.evaluate(()=>window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,'saved-trip-test',{withFallbackPhoto:true}));
  await clickFixture(page,'saved-trip-test');
  await page.locator('[data-save-trip-site="saved-trip-test"]').click();
  const chooser=page.locator('.saved-trips-dialog');
  await expect(chooser).toBeVisible();
  await expect(chooser.locator('.saved-trips-source-site .dive-search-result-title')).toHaveText('Test dive site saved-trip-test');
  await expect(chooser.locator('.saved-trips-source-site .dive-search-result-meta')).toContainText(/5.*18/);
  const nameInput=chooser.getByRole('textbox',{name:'Trip name'});
  await nameInput.focus();
  const example=(await nameInput.getAttribute('placeholder')).replace(/^e\.g\.\s*/, '');
  await nameInput.press('Tab');
  await expect(nameInput).toHaveValue(example);
  await expect(nameInput).toBeFocused();
  await nameInput.press('Tab');
  await expect(chooser.getByRole('button',{name:'Create & save',exact:true})).toBeFocused();
  await nameInput.fill('My own trip');
  await nameInput.press('Tab');
  await expect(nameInput).toHaveValue('My own trip');
  await nameInput.fill('Raja Ampat in November');
  await chooser.getByRole('button',{name:'Create & save'}).click();
  await expect(chooser).toBeHidden();
  await expect(page.locator('#savedTripsPanel')).toBeHidden();
  await page.locator('[data-save-trip-site="saved-trip-test"]').click();
  await chooser.locator('.saved-trips-choice').first().click();
  await expect(chooser.locator('.saved-trips-choice').first()).toHaveAttribute('aria-pressed','false');
  await chooser.locator('.saved-trips-choice').first().click();
  await expect(chooser).toBeVisible();
  await chooser.getByRole('button',{name:'Close save dialog',exact:true}).click();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).trips[0].sites.length,KEY)).toBe(1);
  await page.getByRole('button',{name:'View saved sites',exact:true}).click();
  const panel=page.locator('#savedTripsPanel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.saved-trips-site')).toContainText('Test dive site');
  await expect(panel.locator('.saved-trips-site .dive-search-result-meta')).toContainText(/5.*18/);
  await expect(panel.getByLabel('Travel month')).toBeHidden();
  await expect(panel.locator('[data-resume]')).toBeHidden();
  // These controls are intentionally hidden, with state/handlers retained.
  await panel.getByLabel('Travel month').evaluate(select=>{select.value='11';select.dispatchEvent(new Event('change',{bubbles:true}))});
  const before=await page.evaluate(()=>{const m=window.__DIVEATLAS_TEST__.map;return [m.getCenter().lat,m.getCenter().lng,m.getZoom()]});
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  expect(await page.evaluate(()=>{const m=window.__DIVEATLAS_TEST__.map;return [m.getCenter().lat,m.getCenter().lng,m.getZoom()]})).toEqual(before);
  const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  expect(stored.trips[0].sites).toHaveLength(1);
  expect(stored.trips[0].month).toBe(11);
  await page.evaluate(()=>window.__DIVEATLAS_TEST__.setView(-2,125,8));
  await page.locator('#savedTripsButton').click();
  await panel.locator('[data-resume]').evaluate(button=>button.click());
  await expect(panel).toBeHidden();
  const restored=await page.evaluate(()=>{const m=window.__DIVEATLAS_TEST__.map;return [m.getCenter().lat,m.getCenter().lng,m.getZoom()]});
  expect(restored[0]).toBeCloseTo(before[0],4);expect(restored[1]).toBeCloseTo(before[1],4);expect(restored[2]).toBe(before[2]);
  // openMap resets storage at startup, so explicitly seed the saved state for
  // the next real page initialization, rather than weakening that shared helper.
  await page.addInitScript(({key,value})=>localStorage.setItem(key,value),{key:KEY,value:JSON.stringify(stored)});
  await page.reload();
  await page.locator('#savedTripsButton').click();
  await expect(panel.locator('.saved-trips-site')).toHaveCount(1);
  await expect(panel.getByLabel('Travel month')).toHaveValue('11');
  await panel.getByRole('button',{name:/Remove Test dive site/}).click();
  await expect(panel).toContainText('No saved sites yet');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('empty list and unavailable browser storage are honest',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Unavailable','QuotaExceededError')};});
  await openMap(page);
  await page.locator('#savedTripsButton').click();
  await expect(page.locator('#savedTripsPanel')).toContainText('start your first trip');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,'storage-test',{withFallbackPhoto:true}));
  await clickFixture(page,'storage-test');
  await page.locator('[data-save-trip-site="storage-test"]').click();
  await page.getByRole('textbox',{name:'Trip name'}).fill('Local trip');
  await page.getByRole('button',{name:'Create & save'}).click();
  await expect(page.locator('.saved-trips-dialog')).toBeHidden();
  await expect(page.locator('.saved-trips-feedback')).toContainText('storage is unavailable');
  await page.getByRole('button',{name:'View saved sites',exact:true}).click();
  await expect(page.locator('#savedTripsPanel')).toContainText('Changes last only for this open page');
});


test('trip picker reuses search result rows for mouse and keyboard selection',async({page})=>{
  const trips={version:1,active:'first',trips:[{id:'first',name:'Raja Ampat in November',month:11,sites:[],context:null},{id:'second',name:'Komodo next year',month:null,sites:[],context:null}]};
  await openMap(page,{localStorage:{[KEY]:JSON.stringify(trips)}});
  await page.locator('#savedTripsButton').click();
  const trigger=page.getByRole('button',{name:'Choose trip',exact:true});
  await trigger.click();
  const menu=page.locator('#savedTripsMenu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option')).toHaveCount(2);
  await expect(menu.locator('.dive-search-result-title')).toHaveText(['Komodo next year','Raja Ampat in November']);
  await menu.getByRole('option',{name:/Komodo next year/}).click();
  await expect(trigger).toHaveText('Komodo next year');
  await expect(menu).toBeHidden();
  await trigger.click();
  await trigger.press('ArrowDown');
  await trigger.press('Enter');
  await expect(trigger).toHaveText('Raja Ampat in November');
  await trigger.click();
  await trigger.press('ArrowUp');
  await trigger.press('Enter');
  await expect(trigger).toHaveText('Komodo next year');
  await trigger.click();
  await trigger.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.locator('#savedTripsPanel')).toBeVisible();
});


test('trip example follows the site location and active layer month, with current-month fallback',async({page})=>{
  await openMap(page);
  await page.evaluate(()=>{
    window.__DIVEATLAS_TEST__.selectEnvironmentalView('temperature');
    const month=document.getElementById('temperatureMonth');month.value='2';month.dispatchEvent(new Event('change',{bubbles:true}));
    window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,'example-month-test',{withFallbackPhoto:true});
  });
  await clickFixture(page,'example-month-test');
  await page.locator('[data-save-trip-site="example-month-test"]').click();
  const input=page.getByRole('textbox',{name:'Trip name'});
  await expect(input).toHaveAttribute('placeholder',/Test dive site example-month-test in February$/);
  await input.press('Tab');
  await expect(input).toHaveValue('Test dive site example-month-test in February');
  await page.getByRole('button',{name:'Create & save',exact:true}).click();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).trips[0].month,KEY)).toBe(2);
  await expect(page.locator('.saved-trips-dialog')).toBeHidden();
  await page.evaluate(()=>window.__DIVEATLAS_TEST__.selectEnvironmentalView('default'));
  // Closing the child save dialog keeps this source sheet open.
  await expect(page.locator('[data-save-trip-site="example-month-test"]')).toBeVisible();
  // This test targets the month fallback, independently of Leaflet's layer-switch animation.
  await page.locator('[data-save-trip-site="example-month-test"]').dispatchEvent('click');
  await page.locator('.saved-trips-dialog summary').click();
  const currentMonth=await page.evaluate(()=>new Intl.DateTimeFormat('en',{month:'long'}).format(new Date()));
  await expect(input).toHaveAttribute('placeholder',`e.g. Test dive site example-month-test in ${currentMonth}`);
  await input.press('Tab');
  await input.fill((await input.inputValue()) + ' with friends');
  await page.getByRole('button',{name:'Create & save',exact:true}).click();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).trips[1].month,KEY)).toBeNull();
});


test('duplicate trip names are rejected without modifying existing trips',async({page})=>{
  const saved={version:1,active:'existing',trips:[{id:'existing',name:'Portugal in November',month:11,sites:[],context:null}]};
  await openMap(page,{localStorage:{[KEY]:JSON.stringify(saved)}});
  await page.evaluate(()=>window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,'duplicate-name',{withFallbackPhoto:true}));
  await clickFixture(page,'duplicate-name');
  await page.locator('[data-save-trip-site="duplicate-name"]').click();
  const dialog=page.locator('.saved-trips-dialog');
  await dialog.locator('summary').click();
  const input=dialog.getByRole('textbox',{name:'Trip name'});
  for(const name of ['Portugal in November','  PORTUGAL   in November  ']){
    await input.fill(name);
    await dialog.getByRole('button',{name:'Create & save',exact:true}).click();
    await expect(dialog.getByRole('alert')).toContainText('already exists');
    await expect(input).toBeFocused();
    expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY)).toEqual(saved);
  }
  await input.fill('Portugal with friends');
  await expect(dialog.getByRole('alert')).toBeHidden();
  await dialog.getByRole('button',{name:'Create & save',exact:true}).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).trips.length,KEY)).toBe(2);
});


test('save chooser toggles trip membership and stays open until explicitly closed',async({page})=>{
  const saved={version:1,active:'first',trips:[{id:'first',name:'First trip',month:null,sites:[],context:null},{id:'second',name:'Second trip',month:null,sites:[],context:null}]};
  await openMap(page,{localStorage:{[KEY]:JSON.stringify(saved)}});
  await page.evaluate(()=>window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,'toggle-site',{withFallbackPhoto:true}));
  await clickFixture(page,'toggle-site');
  await page.locator('[data-save-trip-site="toggle-site"]').click();
  const dialog=page.locator('.saved-trips-dialog');
  const first=dialog.locator('[data-trip="first"]'),second=dialog.locator('[data-trip="second"]');
  const beforeFeedback=await dialog.getByRole('button',{name:'Save',exact:true}).boundingBox();
  await first.click();await expect(first).toHaveAttribute('aria-pressed','true');await expect(dialog).toBeVisible();
  await second.click();await expect(second).toHaveAttribute('aria-pressed','true');await expect(dialog).toBeVisible();
  await first.click();await expect(first).toHaveAttribute('aria-pressed','false');await expect(first).toContainText('0 saved sites');await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-feedback]')).toContainText('Removed from First trip.');
  const afterFeedback=await dialog.getByRole('button',{name:'Save',exact:true}).boundingBox();
  expect(afterFeedback.y).toBeCloseTo(beforeFeedback.y,0);
  const statusBox=await dialog.locator('[data-feedback]').boundingBox();
  expect(statusBox.x+statusBox.width).toBeLessThan(afterFeedback.x);
  expect(statusBox.y+statusBox.height/2).toBeCloseTo(afterFeedback.y+afterFeedback.height/2,0);
  await expect(page.locator('.saved-trips-feedback')).toBeHidden();
  const trips=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).trips,KEY);
  expect(trips[0].sites).toHaveLength(0);expect(trips[1].sites).toHaveLength(1);
  await dialog.getByRole('heading',{name:'Save to a trip'}).click();await expect(dialog).toBeVisible();
  await page.mouse.click(4,4);await expect(dialog).toBeHidden();
  await expect(page.locator('.saved-trips-feedback')).toBeVisible();
  await page.locator('[data-save-trip-site="toggle-site"]').click();
  await expect(dialog.locator('[data-trip="second"]')).toHaveAttribute('aria-pressed','true');
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toBeHidden();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).trips[1].sites.length,KEY)).toBe(1);
});


test('trip-menu delete removes only its trip and handles deleting the final trip',async({page})=>{
  const saved={version:1,active:'one',trips:[{id:'one',name:'First trip',month:11,sites:[],context:null},{id:'two',name:'Second trip',month:12,sites:[],context:null}]};
  await openMap(page,{localStorage:{[KEY]:JSON.stringify(saved)}});
  await page.locator('#savedTripsButton').click();
  await page.getByRole('button',{name:'Choose trip',exact:true}).click();
  await page.getByRole('button',{name:'Delete trip First trip',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'Delete trip?',exact:true});
  await expect(confirmation).toContainText('First trip');
  expect(await confirmation.evaluate(el=>Boolean(el.closest('#savedTripsMenu .saved-trips-row')))).toBe(true);
  await expect(page.locator('#savedTripsPanel')).toBeVisible();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY)).toEqual(saved);
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(confirmation).toHaveCount(0);
  await page.getByRole('button',{name:'Delete trip First trip',exact:true}).click();
  await confirmation.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(page.getByRole('button',{name:'Choose trip',exact:true})).toHaveText('Second trip');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).trips.map(t=>t.id),KEY)).toEqual(['two']);
  await page.getByRole('button',{name:'Delete trip Second trip',exact:true}).click();
  await expect(confirmation).toContainText('Second trip');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).trips.length,KEY)).toBe(1);
  await page.getByRole('button',{name:'Delete trip Second trip',exact:true}).click();
  await confirmation.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(page.locator('#savedTripsPanel')).toContainText('No saved trips yet');
  await expect(page.locator('#savedTripsMenu')).toBeHidden();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).trips,KEY)).toEqual([]);
});


test('creating trips saves the site and dismisses the chooser',async({page})=>{
  await openMap(page);
  await page.evaluate(()=>window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,'create-open',{withFallbackPhoto:true}));
  await clickFixture(page,'create-open');await page.locator('[data-save-trip-site="create-open"]').click();
  const dialog=page.locator('.saved-trips-dialog');
  await expect(dialog.locator('.contact-button-primary')).toHaveCount(1);
  await dialog.getByRole('textbox',{name:'Trip name'}).fill('First new trip');
  await dialog.getByRole('button',{name:'Create & save',exact:true}).click();
  await expect(dialog).toBeHidden();
  await page.locator('[data-save-trip-site="create-open"]').click();
  await expect(dialog.locator('[data-trip]')).toHaveCount(1);
  await expect(dialog.locator('[data-trip]').first()).toHaveAttribute('aria-pressed','true');
  await expect(dialog.getByRole('button',{name:'Save',exact:true})).toBeVisible();
  await expect(dialog.locator('details')).not.toHaveAttribute('open');
  await dialog.locator('summary').click();
  await expect(dialog.locator('.contact-button-primary')).toHaveCount(1);
  await expect(dialog.getByRole('button',{name:'Create & save',exact:true})).toBeVisible();
  await dialog.locator('summary').click();
  await expect(dialog.getByRole('button',{name:'Save',exact:true})).toBeVisible();
  await dialog.locator('summary').click();
  await dialog.getByRole('textbox',{name:'Trip name'}).fill('Second new trip');
  await dialog.getByRole('button',{name:'Create & save',exact:true}).click();
  await expect(dialog).toBeHidden();
  await page.locator('[data-save-trip-site="create-open"]').click();
  await expect(dialog.locator('[data-trip][aria-pressed="true"]')).toHaveCount(2);
  const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  expect(stored.active).toBe(stored.trips[1].id);expect(stored.trips[1].sites).toHaveLength(1);
  await expect(dialog.locator('.contact-button-primary')).toHaveCount(1);
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toBeHidden();
});





test('trip surfaces yield to other map tasks and preserve their own child menu',async({page})=>{
  const trips={version:1,active:'first',trips:[{id:'first',name:'My trip',month:null,sites:[],context:null}]};
  await openMap(page,{localStorage:{[KEY]:JSON.stringify(trips)}});
  await page.evaluate(()=>document.getElementById('bioLegendWelcome').click());
  await expect(page.locator('#mapWelcome')).toBeVisible();
  const preference=await page.evaluate(()=>localStorage.getItem('global-coral-map-welcome-suppressed-v1'));
  await page.locator('#savedTripsButton').click();
  expect(await page.evaluate(()=>localStorage.getItem('global-coral-map-welcome-suppressed-v1'))).toBe(preference);
  const panel=page.locator('#savedTripsPanel');
  await expect(panel).toBeVisible();
  const mobile=await page.evaluate(()=>matchMedia('(max-width:720px)').matches);
  if (mobile) await expect(page.locator('#mapWelcome')).toBeHidden();
  else await expect(page.locator('#mapWelcome')).toBeVisible();
  await panel.getByRole('button',{name:'Choose trip',exact:true}).click();
  await expect(panel).toBeVisible();
  await expect(page.locator('#savedTripsMenu')).toBeVisible();
  await page.locator('#topMenuButton').click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#savedTripsMenu')).toBeHidden();
  // The mobile menu is a full-page surface, so dismiss it before using its header.
  if (await page.evaluate(()=>matchMedia('(max-width:720px)').matches)) await page.keyboard.press('Escape');
  await page.locator('#savedTripsButton').click();
  await expect(panel).toBeVisible();
  if (mobile) await expect(page.locator('#topMenuDropdown')).toBeHidden();
  else await expect(page.locator('#topMenuDropdown')).toBeVisible();
  await page.evaluate(()=>window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,'overlay-trip-test',{withFallbackPhoto:true}));
  await clickFixture(page,'overlay-trip-test');
  await expect(panel).toBeHidden();
  await page.locator('[data-save-trip-site="overlay-trip-test"]').click();
  await expect(page.locator('.saved-trips-dialog')).toBeVisible();
  await expect(page.locator('.leaflet-popup')).toHaveCount(1);
  await page.locator('.leaflet-popup').evaluate(el=>window.__savedTripSourceSheet=el);
  await expect(panel).toBeHidden();
  await page.getByRole('button',{name:'Close save dialog',exact:true}).click();
  await expect(page.locator('[data-save-trip-site="overlay-trip-test"]')).toBeVisible();
  expect(await page.locator('.leaflet-popup').evaluate(el=>el===window.__savedTripSourceSheet)).toBe(true);
  await page.locator('#savedTripsButton').click();
  await expect(page.locator('.leaflet-popup')).toHaveCount(mobile ? 0 : 1);
  if (mobile) await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchInput').fill('Test');
  await expect(page.locator('#diveSearchResults')).toBeVisible();
  await expect(panel).toBeHidden();
  // Search opens over the header at full height. Collapse it before switching
  // tasks so this remains a real pointer interaction with the trips launcher.
  if (mobile) {
    await page.locator('#diveSearchResultsHandle').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#diveSearchResultsHandle')).toHaveAttribute('aria-expanded','false');
  }
  await page.locator('#savedTripsButton').click();
  await expect(panel).toBeVisible();
  if (mobile) await expect(page.locator('#diveSearchResults')).toBeHidden();
  else await expect(page.locator('#diveSearchResults')).toBeVisible();
  if (await page.evaluate(()=>matchMedia('(max-width:720px)').matches)) {
    await page.evaluate(()=>window.__DIVEATLAS_TEST__.setLegendCollapsed(false));
    await expect(panel).toBeHidden();
  }
});




test('saved dive sites show at most five rows with scrolling inside their list',async({page})=>{
  const sites=Array.from({length:8},(_,i)=>({id:`site${i}`,name:`Site ${i}`,lat:0,lng:0,location:'Portugal',recordedDepth:22}));
  const trips={version:1,active:'one',trips:[{id:'one',name:'Portugal',month:null,sites,context:null}]};
  await openMap(page,{localStorage:{[KEY]:JSON.stringify(trips)}});
  await page.locator('#savedTripsButton').click();
  const list=page.locator('.saved-trips-site-list');
  await expect(list.locator('[data-site]')).toHaveCount(8);
  const size=await list.evaluate(el=>({height:el.clientHeight,total:el.scrollHeight,five:[...el.children].slice(0,5).reduce((sum,row)=>sum+row.getBoundingClientRect().height,0)}));
  expect(size.height).toBeLessThanOrEqual(size.five+1);
  expect(size.total).toBeGreaterThan(size.height);
  await list.locator('[data-remove="7"]').scrollIntoViewIfNeeded();
  await list.locator('[data-remove="7"]').click();
  await expect(list.locator('[data-site]')).toHaveCount(7);
});


test('trip panels and tooltips follow every supported language',async({page})=>{
  const saved={version:1,active:'one',trips:[{id:'one',name:'Owner name <unchanged>',month:11,sites:[{id:'a',name:'Site A',lat:0,lng:0,location:'Portugal',recordedDepth:22}],context:null}]};
  await openMap(page,{localStorage:{[KEY]:JSON.stringify(saved)}});
  await page.locator('#savedTripsButton').click();
  const labels={en:'My trips',zh:'我的行程','zh-TW':'我的行程',ja:'マイトリップ',fr:'Mes voyages',de:'Meine Reisen',nl:'Mijn reizen',it:'I miei viaggi',ru:'Мои поездки',pt:'Minhas viagens',sv:'Mina resor',no:'Mine reiser',es:'Mis viajes',ko:'내 여행',id:'Perjalanan saya'};
  for(const [language,label] of Object.entries(labels)) {
    await page.locator('#langSelect').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},language);
    await expect(page.locator('#savedTripsPanel h2')).toHaveText(label);
    await expect(page.locator('#savedTripsButton')).toHaveAttribute('title',label);
    await expect(page.locator('.saved-trips-picker')).toHaveText('Owner name <unchanged>');
    await expect(page.locator('[data-remove]')).toHaveAttribute('aria-label',/Site A/);
    expect(await page.locator('#savedTripsPanel').innerText()).not.toMatch(/undefined|countOther|startTrip/);
  }
});

test('save dialog language changes preserve drafts and translate validation and feedback',async({page})=>{
  const saved={version:1,active:'one',trips:[{id:'one',name:'Existing trip',month:11,sites:[],context:null}]};
  await openMap(page,{localStorage:{[KEY]:JSON.stringify(saved)}});
  await page.evaluate(()=>window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,'i18n-save',{withFallbackPhoto:true}));
  await clickFixture(page,'i18n-save');await page.locator('[data-save-trip-site="i18n-save"]').click();
  const dialog=page.locator('.saved-trips-dialog');
  await dialog.locator('[data-trip]').click();
  await dialog.locator('summary').click();
  await dialog.locator('input[name="name"]').fill('Existing trip');
  await dialog.locator('[data-save]').click();
  const change=language=>page.locator('#langSelect').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},language);
  await change('zh');
  await expect(dialog.locator('h2')).toHaveText('保存到行程');
  await expect(dialog.locator('input[name="name"]')).toHaveValue('Existing trip');
  await expect(dialog.locator('[data-save]')).toHaveText('创建并保存');
  await expect(dialog.getByRole('alert')).toContainText('已有同名行程');
  await expect(dialog.locator('[data-feedback-copy]')).toContainText('已添加到');
  await expect(dialog.locator('[data-cancel]')).toHaveAttribute('aria-label','关闭保存窗口');
  await change('pt');
  await expect(dialog.locator('[data-save]')).toHaveText('Criar e guardar');
  await expect(dialog.getByRole('alert')).toContainText('Já existe');
  await dialog.locator('input[name="name"]').fill('');
  await dialog.locator('[data-save]').click();
  await expect(dialog.getByRole('alert')).toHaveText('Introduza o nome da viagem.');
  await dialog.locator('input[name="name"]').fill('My own unchanged name');
  await dialog.locator('[data-save]').click();await expect(dialog).toBeHidden();
  await expect(page.locator('.saved-trips-feedback')).toContainText('Guardado em My own unchanged name.');
  await page.locator('#savedTripsButton').click();
  await page.locator('.saved-trips-picker').click();
  await page.locator('[data-delete-trip="one"]').click();
  await expect(page.locator('.saved-trips-delete-confirm')).toContainText('Eliminar');
  await expect(page.locator('.saved-trips-delete-confirm [data-cancel]')).toHaveText('Cancelar');
});


test('accepting a generated trip name retains its month through a language change',async({page})=>{
  await openMap(page);
  await page.evaluate(()=>window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,'i18n-generated',{withFallbackPhoto:true}));
  await clickFixture(page,'i18n-generated');await page.locator('[data-save-trip-site="i18n-generated"]').click();
  const input=page.locator('.saved-trips-dialog input[name="name"]');
  await input.press('Tab');const name=await input.inputValue();
  await page.locator('#langSelect').evaluate(el=>{el.value='ja';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect(input).toHaveValue(name);
  await expect(input).toHaveAttribute('placeholder',/^例：/);
  await page.locator('.saved-trips-dialog [data-save]').click();
  const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).trips[0],KEY);
  expect(stored.name).toBe(name);expect(stored.month).not.toBeNull();
});


test('save window contains scrolling within the trip list and keeps its actions visible',async({page})=>{
  const saved={version:1,active:'t0',trips:Array.from({length:14},(_,i)=>({id:`t${i}`,name:`Saved trip ${i}`,month:null,sites:[],context:null}))};
  await openMap(page,{localStorage:{[KEY]:JSON.stringify(saved)}});
  await page.evaluate(()=>window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,'scroll-save',{withFallbackPhoto:true}));
  await clickFixture(page,'scroll-save');await page.locator('[data-save-trip-site="scroll-save"]').click();
  const dialog=page.locator('.saved-trips-dialog'),list=dialog.locator('.saved-trips-choice-list');
  expect(await list.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await list.locator('[data-trip="t13"]').scrollIntoViewIfNeeded();
  await list.locator('[data-trip="t13"]').click();
  expect(await dialog.evaluate(el=>el.scrollTop)).toBe(0);
  for(const selector of ['h2','summary','[data-save]']) {
    const box=await dialog.locator(selector).boundingBox(),bounds=await dialog.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(bounds.y);
    expect(box.y+box.height).toBeLessThanOrEqual(bounds.y+bounds.height);
  }
  await dialog.locator('summary').click();
  await expect(dialog.locator('input[name="name"]')).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Create & save',exact:true})).toBeVisible();
});


test('bookmark exists in initial HTML and is reused when trips initialize',async({page,browser,baseURL})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:page.viewportSize()});
  const initial=await context.newPage();
  await initial.goto(new URL('/',baseURL).href,{waitUntil:'domcontentloaded'});
  await expect(initial.locator('#savedTripsButton')).toHaveCount(1);
  await expect(initial.locator('#savedTripsButton')).toBeVisible();
  await expect(initial.locator('#savedTripsButton svg')).toBeVisible();
  await context.close();
  await openMap(page);
  await expect(page.locator('#savedTripsButton')).toHaveCount(1);
  await page.locator('#savedTripsButton').click();
  await expect(page.locator('#savedTripsPanel')).toBeVisible();
  await page.evaluate(()=>window.DiveAtlasSavedTrips.mount({}));
  await expect(page.locator('#savedTripsButton')).toHaveCount(1);
});

test('trip lists show newest created first and select the displayed trip',async({page})=>{
  const trips={version:1,active:'old',trips:['old','middle','new'].map(id=>({id,name:id,month:null,sites:[],context:null}))};
  await openMap(page,{localStorage:{[KEY]:JSON.stringify(trips)}});
  await page.locator('#savedTripsButton').click();
  await page.locator('#savedTripsPanel').getByRole('button',{name:'Choose trip'}).click();
  const rows=page.locator('#savedTripsMenu .saved-trips-row');
  await expect(rows.locator('.dive-search-result-title')).toHaveText(['new','middle','old']);
  await rows.nth(1).locator('.saved-trips-site').click();
  await expect(page.locator('#savedTripsPanel .saved-trips-picker')).toHaveText('middle');
  await page.evaluate(()=>window.__DIVEATLAS_TEST__.addDiveSite(-5.7,131,'order-test',{withFallbackPhoto:true}));
  await clickFixture(page,'order-test');
  await page.locator('[data-save-trip-site="order-test"]').click();
  await expect(page.locator('.saved-trips-choice .dive-search-result-title')).toHaveText(['new','middle','old']);
});
