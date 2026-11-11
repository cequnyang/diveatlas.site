const { test, expect } = require('@playwright/test');
const catalog = require('../../js/destination-comparison-data.js').buildDestinations(require('../../regions/area-index.json'));
const ready = page => expect(page.locator('#comparisonMetrics')).toHaveAttribute('data-state', 'ready');
const metric = (page, key, destination) => page.locator(`[data-metric="${key}"][data-destination="${destination}"]`);
async function chooseDestination(page, side, destination) {
  const input = page.locator(`#comparison${side}Search`);
  await input.fill(`${destination.name} · ${destination.country || 'Country not recorded'}`);
  await page.locator(`#comparison${side}SearchOptions`).getByRole('option', {
    name: `${destination.name} · ${destination.country || 'Country not recorded'} (${destination.sites.length})`, exact: true
  }).click();
}

test('comparison includes all records with shared components and auditable coverage', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/compare/?left=bali&right=komodo');
  await ready(page);
  await expect(page.locator('.shared-site-header')).toBeVisible();
  await expect(page.locator('.comparison-month .scroll-wheel')).toHaveAttribute('aria-valuetext', 'September');
  await expect(page.locator('[data-coverage="bali"]')).toContainText('138 mapped site records');
  await expect(page.locator('[data-coverage="komodo"]')).toContainText('63 mapped site records');
  const current = metric(page, 'current', 'komodo');
  await expect(current.locator('[data-value]')).toBeVisible();
  await expect(current.locator('[data-metric-coverage]')).toBeVisible();
  await expect(page.locator('#comparisonMetrics details')).toHaveCount(0);
  await expect(page.locator('#comparisonRetry')).toBeHidden();
  await expect(page.locator('#comparisonDestinations .seo-share-actions, #comparisonDestinations button')).toHaveCount(0);
  expect(await page.locator('link[rel="stylesheet"]').evaluateAll(links => links.some(link => /comparison|design-explorations/.test(link.href)))).toBe(false);
  await expect(page.locator('#comparisonDestinations details')).toHaveCount(0);
  await expect(metric(page, 'temperature', 'bali').locator('[data-metric-coverage]')).toContainText('/138');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('existing wheel, units and theme persist across reloads', async ({ page }) => {
  await page.goto('/compare/?left=bali&right=komodo');
  await ready(page);
  await page.locator('[data-temperature-unit="F"]').click();
  // Convert the unrounded source values; converting displayed Celsius endpoints
  // would incorrectly round the upper Fahrenheit endpoint to 81.3 instead.
  await expect(metric(page, 'temperature', 'bali').locator('[data-value]')).toHaveText('80.2–81.4 °F');
  await page.locator('[data-length-unit="ft"]').click();
  await expect(metric(page, 'clarity', 'bali').locator('[data-value]')).toHaveText('50.9–75.5 ft');
  const wheel = page.locator('.comparison-month .scroll-wheel');
  if (await wheel.isVisible()) {
    await wheel.focus(); await wheel.press('Home'); await wheel.press('End');
  } else {
    await page.locator('#comparisonMonth').selectOption('12');
  }
  await ready(page);
  await expect(page.locator('#comparisonMonth')).toHaveValue('12');
  await expect(page.locator('#comparisonMonthTitle')).toHaveText('December');
  await expect(page).toHaveURL(/month=12/);
  await page.locator('#seoThemeButton').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload(); await ready(page);
  await expect(metric(page, 'temperature', 'bali').locator('[data-value]')).toContainText('°F');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('failed requests are distinct from missing cells and retry restores coverage', async ({ page }) => {
  await page.route('**/data/waves/query/**', route => route.fulfill({ status: 503, body: 'Unavailable for test' }));
  await page.goto('/compare/?left=bali&right=komodo'); await ready(page);
  await expect(metric(page, 'waves', 'komodo').locator('[data-metric-coverage]')).toContainText('0/63');
  await expect(metric(page, 'current', 'komodo').locator('[data-metric-coverage]')).toContainText('18/63');
  await expect(page.locator('#comparisonStatus')).toContainText('requests failed');
  await expect(page.locator('#comparisonRetry')).toBeVisible();
  await page.unroute('**/data/waves/query/**');
  await page.locator('#comparisonRetry').click(); await ready(page);
  await expect(metric(page, 'waves', 'komodo')).toContainText('63/63');
  await expect(page.locator('#comparisonRetry')).toBeHidden();
});

test('Regions links to comparison and destination actions stay local', async ({ page }) => {
  await page.goto('/regions/');
  await page.getByRole('link', { name: 'Compare destinations', exact: true }).click();
  await chooseDestination(page, 'Left', catalog.find(destination => destination.id === 'bali'));
  await chooseDestination(page, 'Right', catalog.find(destination => destination.id === 'komodo'));
  await ready(page);
  await expect(page.locator('#comparisonDestinations h2').getByRole('link', { name: 'Bali', exact: true })).toHaveAttribute('href', '/regions/indonesia/bali/');
  await expect(page.locator('#comparisonDestinations h2').getByRole('link', { name: 'Komodo', exact: true })).toHaveAttribute('href', '/regions/indonesia/komodo-national-park/');
});

test('destination-page menu opens comparison with the shared menu item style', async ({ page }) => {
  await page.goto('/regions/indonesia/bali/');
  await expect(page.locator('.shared-site-header')).toBeVisible();
  await page.evaluate(() => { window.DiveAtlasHeader.mount(); window.DiveAtlasHeader.mount(); });
  await page.locator('#seoMenuButton').click();
  const link = page.locator('#seoMenuDropdown').getByRole('link', { name: 'Compare destinations', exact: true });
  await expect(link).toHaveCount(1);
  await expect(link).toHaveClass('top-menu-dropdown-item');
  await expect(link).toHaveAttribute('href', '/compare/');
  await expect(link).toBeVisible();
  await link.click();
  await chooseDestination(page, 'Left', catalog.find(destination => destination.id === 'bali'));
  await chooseDestination(page, 'Right', catalog.find(destination => destination.id === 'komodo'));
  await ready(page);
  await expect(page).toHaveURL(/\/compare\//);
});

test('map menu opens comparison without a separate menu implementation', async ({ page }) => {
  const { openMap } = require('./support');
  await openMap(page);
  await page.locator('#topMenuButton').click();
  const link = page.locator('#topMenuDropdown').getByRole('link', { name: 'Compare destinations', exact: true });
  await expect(link).toHaveCount(1);
  await expect(link).toHaveClass('top-menu-dropdown-item');
  await expect(link).toHaveAttribute('href', '/compare/');
  await expect(link).toBeVisible();
  await link.click();
  await chooseDestination(page, 'Left', catalog.find(destination => destination.id === 'bali'));
  await chooseDestination(page, 'Right', catalog.find(destination => destination.id === 'komodo'));
  await ready(page);
  await expect(page).toHaveURL(/\/compare\//);
});

test('any two destinations share one month and persist their selection in the page URL', async ({ page }) => {
  const left = catalog.find(d => d.country === 'Indonesia' && d.name === 'Raja Ampat');
  const right = catalog.find(d => d.country === 'Thailand' && d.name === 'Koh Tao');
  await page.goto('/compare/?month=4&left=bali&right=komodo'); await ready(page);
  await expect(page.locator('#comparisonLeft optgroup option')).toHaveCount(catalog.length);
  await chooseDestination(page, 'Left', left);
  await chooseDestination(page, 'Right', right);
  await ready(page);
  await expect(page.locator('#comparisonTitle')).toHaveText(`Compare ${left.name} & ${right.name}`);
  await expect(page.locator('#comparisonMonth')).toHaveValue('4');
  await expect(page.locator('#comparisonMonthTitle')).toHaveText('April');
  await expect(page.locator('[data-coverage]').nth(0)).toContainText(`${left.sites.length} mapped site records`);
  await expect(page.locator('[data-coverage]').nth(1)).toContainText(`${right.sites.length} mapped site records`);
  await expect(page.locator('#comparisonSeason')).not.toContainText('drier-season');
  expect(await page.evaluate(() => new URL(location.href).searchParams.get('left'))).toBe(left.id);
  expect(await page.evaluate(() => new URL(location.href).searchParams.get('right'))).toBe(right.id);
  await page.reload(); await ready(page);
  await expect(page.locator('#comparisonLeft')).toHaveValue(left.id);
  await expect(page.locator('#comparisonRight')).toHaveValue(right.id);
  await expect(page.locator('#comparisonMonth')).toHaveValue('4');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('single-site destinations are selectable and duplicate choices are prevented', async ({ page }) => {
  const tiny = catalog.find(d => d.sites.length === 1 && d.country !== 'Indonesia');
  await page.goto('/compare/?left=bali&right=komodo'); await ready(page);
  await chooseDestination(page, 'Left', tiny); await ready(page);
  await expect(page.locator('[data-coverage]').nth(0)).toContainText('1 mapped site records');
  await expect(page.locator('[data-metric="temperature"]').first().locator('[data-metric-coverage]')).toContainText('/1');
  // The native selector disables the other column's option. The event guard
  // also handles programmatic changes without comparing a destination to itself.
  expect(await page.locator('#comparisonRight option').evaluateAll((options, id) => options.find(o => o.value === id).disabled, tiny.id)).toBe(true);
  await page.locator('#comparisonLeft').evaluate(node => { node.value = 'komodo'; node.dispatchEvent(new Event('change')); });
  await ready(page);
  await expect(page.locator('#comparisonRight')).toHaveValue(tiny.id);
  await expect(page.locator('#comparisonSelectionStatus')).toContainText('swapped');
  await expect(page.locator('#comparisonMonth')).toHaveValue('9');
});

test('searchable selectors reuse the shared picker for country search, keyboard selection and draft dismissal', async ({ page }) => {
  await page.goto('/compare/?month=4&left=bali&right=komodo'); await ready(page);
  const left = page.getByRole('combobox', { name: 'First destination', exact: true });
  const right = page.getByRole('combobox', { name: 'Second destination', exact: true });
  const leftOptions = page.locator('#comparisonLeftSearchOptions');
  const rightOptions = page.locator('#comparisonRightSearchOptions');
  await expect(left).toHaveClass('dive-filter-picker');
  await left.fill('raja');
  await expect(leftOptions.getByRole('option')).toHaveCount(1);
  await expect(leftOptions.getByRole('option')).toContainText('Raja Ampat · Indonesia');
  await left.press('Enter'); await ready(page);
  await expect(page.locator('#comparisonTitle')).toHaveText('Compare Raja Ampat & Komodo');
  await right.fill('egypt');
  const egypt = catalog.filter(d => d.country.toLowerCase().includes('egypt'));
  await expect(rightOptions.getByRole('option')).toHaveCount(egypt.length);
  expect(await left.getAttribute('aria-expanded')).toBe('false');
  await right.press('Home'); await right.press('Enter'); await ready(page);
  await expect(page.locator('#comparisonRight')).toHaveValue(egypt[0].id);
  await expect(page.locator('#comparisonMonth')).toHaveValue('4');
  const before = await right.inputValue();
  await right.fill('zz-no-destination-zz');
  await expect(rightOptions).toContainText('No matching options');
  await right.press('Escape');
  await expect(right).toHaveValue(before);
  await expect(right).toHaveAttribute('aria-expanded', 'false');
  await right.fill('unfinished draft');
  await page.locator('#comparisonTitle').click();
  await expect(right).toHaveValue(before);
  const selected = await page.locator('#comparisonLeft').inputValue();
  await left.locator('..').getByRole('button', { name: 'Clear destination search' }).click();
  await expect(left).toHaveValue('');
  await expect(page.locator('#comparisonLeft')).toHaveValue(selected);
  const total = catalog.length - 1;
  await expect(leftOptions.getByRole('option')).toHaveCount(total);
  await left.fill(egypt[0].name + ' · Egypt');
  await expect(leftOptions).toContainText('No matching options');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await leftOptions.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
});

test('the shared optional filter still clears its committed value by default', async ({ page }) => {
  await page.goto('/compare/?left=bali&right=komodo'); await ready(page);
  await page.evaluate(() => {
    const select = document.createElement('select'); select.id = 'optionalFilterFixture';
    select.innerHTML = '<option value="">Any country</option><option value="eg">Egypt</option>';
    document.querySelector('#detailPage').prepend(select);
    select.value = 'eg';
    window.DiveAtlasSearchResultsMenu.createFilterPicker(select, {
      id: 'optionalFilterFixtureSearch', labelledBy: 'comparisonLeftLabel', hideSelect: true,
      getPeers: () => [], getClearLabel: () => 'Clear optional filter', getLanguage: () => 'en', onDraft: () => {}
    }).sync();
  });
  await page.getByRole('button', { name: 'Clear optional filter', exact: true }).click();
  await expect(page.locator('#optionalFilterFixture')).toHaveValue('');
});

test('comparison follows every website language without resetting selections or requerying data', async ({ page }) => {
  let requests = 0;
  page.on('request', request => { if (/\/data\/(temperature|water_clarity|currents|waves)\//.test(request.url())) requests++; });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/compare/?month=4&left=bali&right=komodo'); await ready(page);
  await page.locator('[data-temperature-unit="F"]').click();
  const initialRequests = requests;
  const languages = await page.locator('#seoLanguageSelect option').evaluateAll(nodes => nodes.map(node => node.value));
  expect(languages).toHaveLength(15);
  for (const language of languages) {
    await page.selectOption('#seoLanguageSelect', language);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    const expected = await page.evaluate(() => ({
      title: window.DiveAtlasComparisonCopy.text(document.documentElement.lang,'title',{left:'Bali',right:'Komodo'}),
      first: window.DiveAtlasComparisonCopy.text(document.documentElement.lang,'first'),
      coverage: window.DiveAtlasComparisonCopy.text(document.documentElement.lang,'coverageTitle'),
      month: new Intl.DateTimeFormat(document.documentElement.lang,{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2020,3,1))),
      stale: [...document.querySelectorAll('[data-comparison-text]')].filter(node => node.textContent !== window.DiveAtlasComparisonCopy.text(document.documentElement.lang,node.dataset.comparisonText)).map(node => node.dataset.comparisonText)
    }));
    await expect(page.locator('#comparisonTitle')).toHaveText(expected.title);
    await expect(page.locator('#comparisonLeftLabel')).toHaveText(expected.first);
    await expect(page.locator('#comparisonCoverageTitle')).toHaveText(expected.coverage);
    await expect(page.locator('.comparison-month .scroll-wheel')).toHaveAttribute('aria-valuetext',expected.month);
    await expect(page.locator('#comparisonLeft')).toHaveValue('bali');
    await expect(page.locator('#comparisonRight')).toHaveValue('komodo');
    await expect(page.locator('#comparisonMonth')).toHaveValue('4');
    await expect(metric(page,'temperature','bali').locator('[data-value]')).toContainText('°F');
    expect(expected.stale).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(requests).toBe(initialRequests);
  expect(errors).toEqual([]);
});

test('Chinese comparison labels, source notes, search feedback and saved language survive reload', async ({ page }) => {
  await page.goto('/compare/?month=4&left=bali&right=komodo'); await ready(page);
  await page.selectOption('#seoLanguageSelect','zh');
  await expect(page.locator('#comparisonTitle')).toHaveText('比较 Bali 与 Komodo');
  await expect(page.locator('#comparisonEvidenceTitle')).toHaveText('来源与限制');
  const search = page.getByRole('combobox',{name:'第一个目的地',exact:true});
  await search.fill('zzzz-no-match');
  await expect(page.locator('#comparisonLeftSearchOptions')).toContainText('没有匹配的选项');
  await search.press('Escape');
  await page.locator('#seoMenuButton').click();
  await expect(page.locator('#seoMenuDropdown [data-shared-navigation]')).toHaveText(['浏览潜点', '浏览区域', '浏览目的地', '比较目的地']);
  await page.reload(); await ready(page);
  await expect(page.locator('html')).toHaveAttribute('lang','zh');
  await expect(page.locator('#comparisonTitle')).toHaveText('比较 Bali 与 Komodo');
  await expect(page.locator('#comparisonMonth')).toHaveValue('4');
});

test('map comparison menu uses the same language preference and updates immediately', async ({ page }) => {
  const {openMap} = require('./support');
  await openMap(page,{localStorage:{'global-coral-map-lang':'zh'}});
  await page.locator('#topMenuButton').click();
  await expect(page.locator('[data-comparison-menu]')).toHaveText('比较目的地');
  await page.keyboard.press('Escape');
  await expect(page.locator('#topMenuDropdown')).toBeHidden();
  await page.locator('#languageMenuButton').click();
  await page.locator('#languageDropdown [data-language="es"]').click();
  await expect(page.locator('#topMenuDropdown [data-shared-navigation]')).toHaveText(['Ver sitios de buceo', 'Ver regiones', 'Ver destinos de buceo', 'Comparar destinos']);
});


test('seasonal source guidance belongs only to the selected Bali and Komodo pair', async ({ page }) => {
  await page.goto('/compare/?left=bali&right=komodo');
  await ready(page);
  await page.locator('section.record-evidence > details > summary').click();
  await expect(page.locator('#comparisonPairGuidance')).toBeVisible();
  await page.locator('#comparisonLeftSearch').click();
  await chooseDestination(page, 'Left', catalog.find(destination => destination.name === 'Shanghai'));
  await expect(page.locator('#comparisonTitle')).toContainText('Shanghai');
  await expect(page.locator('#comparisonPairGuidance')).toBeHidden();
  await expect(page.locator('#comparisonGenericGuidance')).toBeVisible();
  await page.locator('#comparisonLeftSearch').click();
  await chooseDestination(page, 'Left', catalog.find(destination => destination.id === 'bali'));
  await expect(page.locator('#comparisonPairGuidance')).toBeVisible();
  await expect(page.locator('#comparisonGenericGuidance')).toBeHidden();
});


test('swap button reverses destinations and preserves the shared month', async ({ page }) => {
  await page.goto('/compare/?left=bali&right=komodo&month=9');
  await ready(page);
  const original = await metric(page, 'temperature', 'bali').locator('[data-value]').textContent();
  await page.getByRole('button', { name: 'Swap destinations', exact: true }).click();
  await ready(page);
  await expect(page.locator('#comparisonLeft')).toHaveValue('komodo');
  await expect(page.locator('#comparisonRight')).toHaveValue('bali');
  await expect(page.locator('#comparisonLeftSearch')).toHaveValue(/Komodo/);
  await expect(page.locator('#comparisonRightSearch')).toHaveValue(/Bali/);
  await expect(page.locator('#comparisonMonth')).toHaveValue('9');
  await expect(page.locator('#comparisonDestinations h2 a')).toHaveText(['Komodo', 'Bali']);
  await expect(metric(page, 'temperature', 'bali').locator('[data-value]')).toHaveText(original);
  expect(new URL(page.url()).searchParams.get('left')).toBe('komodo');
  expect(new URL(page.url()).searchParams.get('right')).toBe('bali');
  await page.reload(); await ready(page);
  await expect(page.locator('#comparisonLeft')).toHaveValue('komodo');
  await page.getByRole('button', { name: 'Swap destinations', exact: true }).click();
  await ready(page);
  await expect(page.locator('#comparisonDestinations h2 a')).toHaveText(['Bali', 'Komodo']);
});


test('responsive controls preserve month and pair when switching layouts', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/compare/?left=bali&right=komodo&month=9');
  await ready(page);
  await expect(page.locator('.comparison-month .scroll-wheel')).toBeVisible();
  await expect(page.locator('#comparisonMonth')).toBeHidden();
  const fields = await page.locator('.comparison-selectors > li').evaluateAll(es => es.map(e => {const r=e.getBoundingClientRect();return {x:r.x,y:r.y};}));
  expect(fields[0].x).toBe(fields[1].x);
  expect(fields[0].y).toBeLessThan(fields[1].y);
  await page.locator('.comparison-month .scroll-wheel').focus();
  await page.locator('.comparison-month .scroll-wheel').press('End');
  await ready(page);
  await page.setViewportSize({width:1440,height:900});
  await expect(page.locator('.comparison-month .scroll-wheel')).toBeVisible();
  await expect(page.locator('.comparison-month .scroll-wheel')).toHaveAttribute('aria-valuetext','December');
  await expect(page.locator('#comparisonMonth')).toHaveValue('12');
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.comparison-month .scroll-wheel')).toBeVisible();
  await expect(page.locator('#comparisonMonth')).toHaveValue('12');
  await expect(page.locator('#comparisonLeft')).toHaveValue('bali');
  await expect(page.locator('#comparisonRight')).toHaveValue('komodo');
});


test('fresh comparison starts empty and queries only after two destinations are selected', async ({ page }) => {
  let requests = 0;
  page.on('request', request => { if (/\/data\/(temperature|water_clarity|currents|waves)\//.test(request.url())) requests++; });
  await page.goto('/compare/');
  await expect(page.locator('#comparisonLeftSearch')).toBeVisible();
  await expect(page.locator('#comparisonTitle')).toHaveText('Compare destinations');
  await expect(page.locator('.comparison-overview')).toBeHidden();
  await expect(page.locator('#comparisonMetrics section')).toHaveCount(0);
  expect(requests).toBe(0);
  await chooseDestination(page, 'Left', catalog.find(destination => destination.id === 'bali'));
  await expect(page.locator('#comparisonMetrics')).toHaveAttribute('data-state','empty');
  expect(requests).toBe(0);
  await chooseDestination(page, 'Right', catalog.find(destination => destination.id === 'komodo'));
  await ready(page);
  await expect(page.locator('#comparisonTitle')).toHaveText('Compare Bali & Komodo');
  await expect(page.locator('.comparison-overview')).toBeVisible();
  expect(requests).toBeGreaterThan(0);
});
