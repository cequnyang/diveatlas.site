const {test, expect} = require('@playwright/test');
const destination = '/regions/indonesia/raja-ampat/';

test('Raja Ampat month wheel updates notes by keyboard and scroll with a compact shortlist', async ({page}) => {
  await page.goto(destination);
  const wheel = page.getByRole('spinbutton', {name:'Planning month'});
  await expect(wheel).toHaveAttribute('aria-valuetext', 'November');
  await wheel.focus();
  await wheel.press('Home');
  await expect(wheel).toHaveAttribute('aria-valuetext', 'January');
  await wheel.press('ArrowDown');
  await expect(wheel).toHaveAttribute('aria-valuetext', 'February');
  await wheel.evaluate(node => { node.scrollTop = 7 * 44; });
  await expect(wheel).toHaveAttribute('aria-valuetext', 'August');
  await expect(page.locator('#destination-current')).toHaveText('Wind can affect access');
  await wheel.press('End');
  await expect(wheel).toHaveAttribute('aria-valuetext', 'December');
  await expect(page.locator('#destination-clarity')).toHaveText('15–20 m reported');
  await expect(page.locator('.destination-site-list')).toHaveCount(0);
  await expect(page.locator('.related-destination-list')).toHaveCount(0);
  await expect(page.locator('.destination-shortlist .site-recommendations__card')).toHaveCount(3);
  await expect(page.getByRole('link', {name:'Explore the map', exact:true})).toHaveCount(0);
  const inset = page.locator('.destination-map-inset');
  await expect(inset).toBeVisible();
  await expect(inset.locator('img')).toHaveAttribute('width', '600');
  await expect(inset.locator('img')).toHaveAttribute('height', '600');
  await expect(inset.locator('.destination-map-inset__link')).toHaveAttribute('href', /layers=dive/);
  await expect(page.locator('.destination-hero-shell canvas, .destination-hero-shell iframe')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Raja Ampat reuses the shared header and synchronized document scroll rail in both themes', async ({page}) => {
  await page.goto(destination);
  await expect(page.locator('.shared-site-header')).toBeVisible();
  const rail = page.locator('.detail-scroll-rail');
  await expect(rail).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    const maximum = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    const first = Math.floor(maximum / 3), second = Math.floor(maximum * 2 / 3);
    await page.evaluate(top => window.scrollTo({top, behavior:'instant'}), first);
    await expect.poll(() => rail.evaluate(node => node.scrollTop)).toBe(first);
    await rail.evaluate((node, top) => { node.scrollTop = top; }, second);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(second);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('Raja Ampat keeps a labeled seasonal reference and shortlist without JavaScript', async ({browser, baseURL}) => {
  const page = await browser.newPage({javaScriptEnabled:false});
  await page.goto(new URL(destination, baseURL).href);
  await expect(page.locator('noscript p')).toBeVisible();
  await expect(page.locator('noscript p')).toContainText('Showing November’s seasonal notes.');
  await expect(page.getByRole('heading', {name:'Raja Ampat', exact:true})).toBeVisible();
  await expect(page.locator('.destination-site-list')).toHaveCount(0);
  await expect(page.locator('.related-destination-list')).toHaveCount(0);
  await page.close();
});

test('Raja Ampat localizes all supported languages without resetting the chosen month', async ({page}) => {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(destination);
  const select=page.locator('#seoLanguageSelect');
  const wheel=page.getByRole('spinbutton');
  await wheel.focus();
  await wheel.press('Home');
  await wheel.evaluate(node=>{node.scrollTop=7*44;});
  await expect(wheel).toHaveAttribute('aria-valuenow','8');
  const languages=await select.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value));
  expect(languages).toHaveLength(15);
  for(const language of languages) {
    await select.selectOption(language);
    await expect(page.locator('html')).toHaveAttribute('lang',language);
    const expected=await page.evaluate(()=>({
      summary:window.DiveAtlasDestinationI18n.t('summary'),
      wind:window.DiveAtlasDestinationI18n.t('wind'),
      month:new Intl.DateTimeFormat(document.documentElement.lang,{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2020,7,1))),
    }));
    await expect(page.locator('.destination-lead')).toHaveText(expected.summary);
    await expect(page.locator('#destination-current')).toHaveText(expected.wind);
    await expect(wheel).toHaveAttribute('aria-valuetext',expected.month);
    await expect(wheel).toHaveAttribute('aria-valuenow','8');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await select.selectOption('zh-TW');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','zh-TW');
  await expect(page.locator('[data-destination-text="water"]')).toHaveText('水溫');
  await expect(page.getByRole('spinbutton')).toHaveAttribute('aria-valuetext','11月');
  expect(errors).toEqual([]);
});


test('other destinations keep unavailable conditions and localize without a month wheel', async ({page}) => {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(const route of ['/regions/indonesia/komodo-national-park/','/regions/egypt/red-sea/']) {
    const response=await page.goto(route);
    expect(response.status()).toBe(200);
    await expect(page.locator('.destination-overview')).toHaveAttribute('data-condition-profile','unavailable');
    await expect(page.getByRole('spinbutton')).toHaveCount(0);
    await expect(page.locator('.destination-conditions strong')).toHaveCount(4);
    await expect(page.locator('.destination-shortlist .site-recommendations__card')).toHaveCount(3);
    for(const language of ['en','zh','de','fr','ja','ru','zh-TW']) {
      await page.locator('#seoLanguageSelect').selectOption(language);
      const expected=await page.evaluate(()=>({summary:window.DiveAtlasDestinationI18n.t('genericSummary'), unavailable:window.DiveAtlasDestinationI18n.t('waveValue')}));
      await expect(page.locator('.destination-lead')).toHaveText(expected.summary);
      for(const value of await page.locator('.destination-conditions strong').allTextContents()) expect(value).toBe(expected.unavailable);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await expect(page.locator('.destination-map-inset img')).toBeVisible();
    await expect(page.locator('.destination-map-inset img')).toHaveJSProperty('naturalWidth',600);
  }
  expect(errors).toEqual([]);
});

test('long destination names stay below the map inset on narrow screens', async ({page}) => {
  for(const width of [320,390,720]) {
    await page.setViewportSize({width,height:844});
    await page.goto('/regions/australia/south-australia-neptune-islands/');
    for(const language of ['de','zh-TW','ja']) {
      await page.locator('#seoLanguageSelect').selectOption(language);
      const layout=await page.evaluate(()=>{
        const title=document.querySelector('#destination-title').getBoundingClientRect();
        const map=document.querySelector('.destination-map-inset').getBoundingClientRect();
        return {titleTop:title.top,mapBottom:map.bottom,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      expect(layout.titleTop).toBeGreaterThan(layout.mapBottom);
      expect(layout.overflow).toBe(false);
    }
  }
});


test('mobile cards reserve room for a long recorded name below the rating', async ({page}) => {
  await page.setViewportSize({width:320,height:844});
  await page.goto('/regions/germany/mecklenburg-western-pomerania/');
  await page.locator('#seoLanguageSelect').selectOption('de');
  const cards=await page.locator('.destination-shortlist .site-recommendations__card').evaluateAll(nodes=>nodes.map(card=>({
    nameTop:card.querySelector('.site-recommendations__name').getBoundingClientRect().top,
    ratingBottom:card.querySelector('.site-recommendations__rating').getBoundingClientRect().bottom,
  })));
  for(const card of cards) expect(card.nameTop).toBeGreaterThan(card.ratingBottom);
  const expected=await page.evaluate(()=>DiveAtlasSiteDetailI18n.translate('Recorded features','de'));
  for(const label of await page.locator('.site-recommendations__features').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')))) expect(label).toBe(expected);
});
