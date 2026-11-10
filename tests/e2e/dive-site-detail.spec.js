const { test, expect } = require('@playwright/test');
const {displayURL,mockR2Images}=require('./photo-assets.cjs');

const FIRST = '1a532e42-9890-4ea9-b239-0f5fbb836317';
const SECOND = '2a532e42-9890-4ea9-b239-0f5fbb836317';
const MALPELO_PILOT = '02e2420d-02b2-4506-9725-f8be34da4c99';
const record = (id = FIRST, name = 'Example reef') => ({
  schema:'dive-site-detail-v1', site_id:id, name, lat:-0.55, lon:130.7,
  country:'Indonesia', region:'Raja Ampat', depth_min:'12', depth_max:'25',
  location_hierarchy:['Asia', 'South-Eastern Asia', 'Indonesia', 'Raja Ampat'],
  region_url:'/regions/indonesia/raja-ampat/',
  difficulty:'Beginner | Advanced', categories:{ setting:'marine', access:'boat', features:'reef' },
  summary:'A published description.', sources:[['Example', 'https://example.com/source']],
  photo:null, related:[{ site_id:SECOND, name:'Second reef', region:'Raja Ampat', photo:null }]
});

test.beforeEach(async ({ page }) => {
  await page.route('https://**', route => route.abort());
  await mockR2Images(page);
  // These tests exercise record loading and page startup, independently of the
  // environmental datasets tested by the existing chart/rating suites.
  await page.route('**/data/**', route => route.fulfill({ status:404, body:'Unavailable in test' }));
});

test('Dolphins Reef shared pilot renders its exported photo without an assignment lookup', async ({ page }) => {
  const { execFileSync } = require('node:child_process');
  const id = '95b478be-2487-49dc-81dd-46e553f54935';
  const photos = JSON.parse(execFileSync('python', ['-c', 'import json; from pathlib import Path; from tools.detail_photo_data import load_detail_photos; print(json.dumps(load_detail_photos(Path.cwd())))'], {encoding:'utf8'}));
  const exported = {...record(id, 'Dolphins Reef'), photo:photos[id]};
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({json:exported}));
  // Disable the old post-render enhancement: initial photo and linked credit
  // must come entirely from the record, even when assignments are unavailable.
  await page.route('**/assets/dive-sites/assignments.json*', route => route.abort());
  await page.goto(`/dive-site.html?id=dolphins-reef-${id}`);
  const image = page.locator('.site-photo-gallery-main img');
  await expect(image).toHaveAttribute('src', exported.photo.src);
  await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
  await expect(page.locator('.site-photo-gallery-main figcaption a', {hasText:'Source'})).toHaveAttribute('href', exported.photo.source_page);
  await expect(page.locator('.site-photo-gallery-main figcaption a', {hasText:'CC BY-SA'})).toHaveAttribute('href', exported.photo.licence_url);
  await expect(page.locator('.site-photo-gallery-main')).not.toContainText('Representative image');
});

test('catalog photos render initially on shared and static detail pages', async ({ page, browser }) => {
  const { execFileSync } = require('node:child_process');
  const assignments = require('../../assets/dive-sites/assignments.json');
  const photos = JSON.parse(execFileSync('python', ['-c', 'import json; from pathlib import Path; from tools.detail_photo_data import load_detail_photos; print(json.dumps(load_detail_photos(Path.cwd())))'], {encoding:'utf8'}));
  const samples = [assignments[0], assignments.find(entry => entry.hide_context_label),
    assignments.find(entry => !entry.alt), assignments.find(entry => (entry.creator_links || []).length)];
  await page.route('**/assets/dive-sites/assignments.json*', route => route.abort());
  const noScripts = await browser.newContext({javaScriptEnabled:false, viewport:page.viewportSize()});
  const staticPage = await noScripts.newPage();
  await mockR2Images(staticPage);
  try {
    for (const entry of samples) {
      await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({json:{...record(entry.site_id, entry.name), photo:photos[entry.site_id]}}));
      await page.goto(`/dive-site.html?id=${entry.site_id}`);
      await staticPage.goto(new URL(`/dive-sites/${entry.slug}/`, page.url()).href);
      for (const target of [page, staticPage]) {
        const hero = target.locator('.site-photo-gallery-main');
        await expect.poll(() => hero.locator('img').evaluate(image => image.src))
          .toBe(new URL(displayURL(entry.hero), target.url()).href);
        await expect.poll(() => hero.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
        await expect(hero.locator('figcaption')).toContainText(entry.creator);
        await expect(hero.locator('figcaption a', {hasText:'Source'})).toHaveAttribute('href', entry.source_page);
        for (const link of entry.creator_links || []) {
          await expect.poll(() => hero.locator('figcaption a').filter({hasText:link.label}).first().evaluate(node => node.href)).toBe(new URL(link.url).href);
        }
        await expect(hero.locator('.site-photo-upload-label')).toHaveCount(0);
      }
    }
  } finally { await noScripts.close(); }
});

test('explorer card expansion aligns with the real permalink preview on arrival', async ({ page }) => {
  // Keep the generated page and production styles; only replace remote image
  // bytes so geometry checks do not depend on a third-party asset connection.
  await page.route('https://assets.diveatlas.site/**', route => route.fulfill({
    contentType:'image/svg+xml',
    body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="teal"/></svg>'
  }));
  await page.goto('/dive-sites/twins-koh-tao/');
  await page.getByRole('button', { name:/^Keep exploring/ }).click();
  const card = page.locator('#cinematicRecommendations .site-recommendations__card:visible').first();
  await expect.poll(() => card.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const href = await card.getAttribute('href');
  const flight = page.locator('.cinematic-pilot__page-flight');
  // Freeze immediately before navigation to compare the expanded rectangle
  // with the destination. This catches the former hard-coded 42px offset.
  await card.evaluate(node => {
    node.click();
    for (const animation of document.querySelector('.cinematic-pilot__page-flight').getAnimations({ subtree:true })) {
      animation.pause();
      animation.currentTime = 559;
    }
  });
  await expect(flight).toBeVisible();
  const expanded = await flight.boundingBox();
  await flight.evaluate(node => node.getAnimations({ subtree:true }).forEach(animation => animation.finish()));
  await page.waitForURL(url => url.pathname === href);
  await expect(page.locator('body')).toHaveClass(/cinematic-pilot/);
  await expect(page.locator('.cinematic-pilot__arrival')).toHaveCount(0);
  const arrived = await page.locator('.site-photo-gallery-main').boundingBox();
  for (const dimension of ['x', 'y', 'width', 'height']) {
    expect(Math.abs(expanded[dimension] - arrived[dimension])).toBeLessThanOrEqual(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('detail scrollbar starts below the header without reserving a header gutter', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:record() }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await expect(page.locator('.shared-site-header')).toBeVisible();
  await expect(page.locator('.detail-scroll-rail')).toBeAttached();
  // Ensure both a narrow and a wide viewport have real overflow to exercise.
  await page.locator('#detailPage').evaluate(node => { node.style.minHeight = '2400px'; });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height:800 });
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((node, theme) => { node.dataset.theme = theme; }, theme);
      const rail = page.locator('.detail-scroll-rail');
      await expect(rail).toBeVisible();
      await expect.poll(() => page.evaluate(() => {
        const header = document.querySelector('.shared-site-header').getBoundingClientRect();
        const rail = document.querySelector('.detail-scroll-rail').getBoundingClientRect();
        const edge = document.elementFromPoint(innerWidth - 1, header.height / 2);
        return { gutter:innerWidth - document.documentElement.clientWidth,
          headerRight:header.right, viewport:innerWidth,
          railTop:rail.top, headerBottom:header.bottom,
          edgeOwnedByHeader:Boolean(edge?.closest('.shared-site-header')) };
      })).toEqual({ gutter:0, headerRight:width, viewport:width, railTop:42, headerBottom:42, edgeOwnedByHeader:true });
      await page.evaluate(() => window.scrollTo({ top:200, behavior:'instant' }));
      await expect.poll(() => rail.evaluate(node => node.scrollTop)).toBe(200);
      await rail.evaluate(node => { node.scrollTop = 400; });
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(400);
      await page.evaluate(() => window.scrollTo({ top:600, behavior:'smooth' }));
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(600);
      await rail.focus();
      await page.keyboard.press('End');
      await expect.poll(() => page.evaluate(() =>
        Math.abs(scrollY - (document.documentElement.scrollHeight - innerHeight)))).toBeLessThanOrEqual(1);
      await page.keyboard.press('Home');
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      await page.evaluate(() => window.scrollTo({ top:0, behavior:'instant' }));
      await expect.poll(() => page.locator('.site-hero').evaluate(node => node.getBoundingClientRect().top)).toBe(0);
    }
  }
  await page.setViewportSize({ width:1280, height:5000 });
  await expect(page.locator('.detail-scroll-rail')).toBeHidden();
  await page.setViewportSize({ width:390, height:800 });
  await expect(page.locator('.detail-scroll-rail')).toBeVisible();
});

test('detail menu uses real session state and supports sign out', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:record() }));
  await page.route('**/api/auth/me', route => route.fulfill({ json:{ user:null } }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await expect(page.locator('#authMenuStatus')).toHaveText('Not signed in');
  await page.locator('#seoMenuButton').click();
  await expect(page.locator('#googleSignInLink')).toBeVisible();
  await expect(page.locator('#googleSignInLink')).toHaveAttribute('href', '/api/auth/google');
  await page.route('**/api/auth/me', route => route.fulfill({ json:{ user:{ name:'Test Diver', email:'diver@example.com' } } }));
  await page.route('**/api/auth/logout', route => route.fulfill({ json:{ success:true } }));
  await page.reload();
  await expect(page.locator('#authMenuStatus')).toContainText('Test Diver');
  await page.locator('#seoMenuButton').click();
  await expect(page.locator('#googleSignInLink')).toBeHidden();
  await page.locator('#authSignOutButton').click();
  await expect(page.locator('#authMenuStatus')).toHaveText('Not signed in');
  await expect(page.locator('#googleSignInLink')).toBeVisible();
});

test('photo immersion pilot is visible by default and retains card links and credits', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:record() }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  const panel = page.locator('#cinematicRecommendations');
  await expect(panel).toHaveClass(/recommendations--immersion/);
  await page.getByRole('button', { name:/^Keep exploring/ }).click();
  const card = panel.locator('a.site-recommendations__card').first();
  await expect(card).toBeVisible();
  const href = await card.getAttribute('href');
  expect(href).toContain(SECOND);
  await expect(card).toHaveCSS('border-top-width', '0px');
  await expect(card).toHaveCSS('height', '198px');
  await expect(card).toHaveCSS('border-radius', '13px');
  await card.evaluate(el => {
    const image = document.createElement('img');
    image.className = 'site-recommendations__image';
    image.title = 'Example photographer · CC BY 3.0';
    el.prepend(image);
  });
  await expect(card.locator('img.site-recommendations__image')).toHaveAttribute('title', 'Example photographer · CC BY 3.0');
  await expect(card.locator('.cinematic-pilot__card-credit')).toHaveCount(0);
  await page.goto(`/dive-site.html?id=${FIRST}&relatedStyle=classic`);
  await expect(page.locator('#cinematicRecommendations')).not.toHaveClass(/recommendations--immersion/);
});

test('detail menu hides sign-in when session lookup fails', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:record() }));
  await page.route('**/api/auth/me', route => route.fulfill({ status:503 }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await expect(page.locator('#authMenuStatus')).toHaveText('Account sign-in is unavailable');
  await page.locator('#seoMenuButton').click();
  await expect(page.locator('#googleSignInLink')).toBeHidden();
  await expect(page.locator('#authSignOutButton')).toBeHidden();
});

for (const [kind, bodyClass] of [['document', ''], ['directory', 'site-directory-page']]) {
  test(`shared results component mounts on generated ${kind} pages`, async ({ page }) => {
    let releaseComponent;
    if (kind === 'directory') {
      const held = new Promise(resolve => { releaseComponent = resolve; });
      await page.route('**/js/search-results-menu.js*', async route => { await held; await route.continue(); });
    }
    const {execFileSync} = require('node:child_process');
    const html = execFileSync('python', ['-c',
      'import sys; from tools.generate_seo_pages import page_shell; print(page_shell("Menu test", "Test", "https://diveatlas.site/", "<main>Content</main>", sys.argv[1]))', bodyClass
    ], {encoding:'utf8'});
    await page.route(`**/__search-menu-${kind}/`, route => route.fulfill({contentType:'text/html',body:html}));
    await page.route('**/data/dive-site-details/v2/recommendations.json', route => route.fulfill({
      json:{schema:'dive-site-recommendations-v1',sites:Array.from({length:45}, (_, index) => ({...record(),name:`Reef ${index}`}))}
    }));
    await page.goto(`/__search-menu-${kind}/`, {waitUntil:'domcontentloaded'});
    const input = page.locator('#seoSiteSearchInput');
    if (!await input.isVisible()) await page.locator('#seoSiteSearchToggle').click();
    await input.fill('Reef');
    // Typing remains valid even when the menu module finishes loading later.
    releaseComponent?.();
    const menu = page.locator('#seoSiteSearchResults');
    await expect(menu).toHaveClass(/search-results-menu/);
    await expect(menu.locator('.dive-search-result')).toHaveCount(20);
    await input.press('ArrowDown');
    await expect(menu.locator('[aria-selected="true"]')).toHaveCount(1);
    await page.locator('#seoSiteSearchFilterToggle').click();
    await expect(menu.locator('.dive-search-modes')).toBeHidden();
    const picker = page.locator('#seoSiteSearchCountryPicker');
    await picker.click();
    await page.locator('#seoSiteSearchCountryPickerOptions').getByRole('option',{name:'Indonesia',exact:true}).click();
    await expect(picker).toHaveValue('Indonesia');
    await input.fill('Raja Ampat');
    await expect(menu.locator('.dive-search-result').first()).toContainText('Raja Ampat');
    await expect(menu.locator('[data-result-kind="destination"]').first()).toBeVisible();
    await expect(menu.locator('[data-result-kind="site"]').first()).toBeVisible();
    await input.press('Escape');
    await expect(menu).toBeHidden();
  });
}

test('shared document search groups destinations above filtered dive sites', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({json:record()}));
  await page.route('**/data/dive-site-details/v2/recommendations.json', route => route.fulfill({
    json:{schema:'dive-site-recommendations-v1', sites:[record(SECOND, 'Second reef')]}
  }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  const input = page.locator('#seoSiteSearchInput');
  await input.fill('Second reef');
  await expect(page.locator('#seoSiteSearchResults .dive-search-result').first()).toContainText('Second reef');
  await expect(page.locator('#seoSiteSearchResults [data-result-kind="destination"]')).toHaveCount(0);
  await input.fill(record().country);
  await expect(page.locator('#seoSiteSearchResults .dive-search-result').first()).toContainText(record().country);
  await page.locator('#seoSiteSearchFilterToggle').click();
  await expect(page.locator('#seoSiteSearchResults .dive-search-modes')).toBeHidden();
  await expect(page.locator('#seoSiteSearchFilterControls')).toBeVisible();
  await expect(page.locator('#seoSiteSearchResults [data-result-kind="site"]').first()).toBeVisible();
  await expect(page.locator('#seoSiteSearchResults [data-result-kind="destination"]').first()).toContainText('1 dive site');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/?\?lat=.*&lng=.*&z=/);
});

test('catalog refresh keeps a keyboard-selected record visible after reordering', async ({ page }) => {
  const target = record(SECOND, 'Reef Z target');
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({json:record()}));
  await page.route('**/data/dive-site-details/v2/recommendations.json', route => route.fulfill({
    json:{schema:'dive-site-recommendations-v1',sites:[target]}
  }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  const input = page.locator('#seoSiteSearchInput');
  await input.fill('Reef');
  await expect(page.locator('#seoSiteSearchResults .dive-search-result').first()).toContainText(target.name);
  await input.press('ArrowDown');
  await page.evaluate(target => window.dispatchEvent(new CustomEvent('diveatlas:seo-search-catalog-ready', {
    detail:{sites:[...Array.from({length:40},(_, index) => ({...target,name:`Reef A ${index}`})),target]}
  })),target);
  const selected = page.locator('#seoSiteSearchResults .dive-search-result[aria-selected="true"]');
  await expect(selected).toContainText(target.name);
  await expect(input).toHaveAttribute('aria-activedescendant',await selected.getAttribute('id'));
});

test('filtered search stays inside a short mobile viewport', async ({ page }) => {
  await page.setViewportSize({width:568,height:280});
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({json:record()}));
  await page.route('**/data/dive-site-details/v2/recommendations.json', route => route.fulfill({
    json:{schema:'dive-site-recommendations-v1',sites:[record()]}
  }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await page.locator('#seoSiteSearchInput').fill('Reef');
  await page.locator('#seoSiteSearchFilterToggle').click();
  await expect(page.locator('#seoSiteSearchFilterControls')).toBeVisible();
  const menu = await page.locator('#seoSiteSearchResults').boundingBox();
  expect(menu.y + menu.height).toBeLessThanOrEqual(280);
});

for (const selection of ['click', 'Enter']) {
  test(`detail search opens the selected record with ${selection}`, async ({ page }) => {
    await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({
      json:route.request().url().includes(SECOND) ? record(SECOND, 'Second reef') : record()
    }));
    await page.route('**/data/dive-site-details/v2/recommendations.json', route => route.fulfill({
      json:{ schema:'dive-site-recommendations-v1', sites:[record(SECOND, 'Second reef')] }
    }));
    await page.goto(`/dive-site.html?id=${FIRST}`);
    const input = page.locator('#seoSiteSearchInput');
    await input.fill('Second reef');
    const result = page.locator('#seoSiteSearchResults .dive-search-result').first();
    await expect(result).toContainText('Second reef');
    if (selection === 'click') await result.click();
    else {
      await input.press('ArrowDown');
      // A late catalog notification must not discard the user's keyboard choice.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('diveatlas:seo-search-catalog-ready', {
        detail:{sites:window.DIVE_ATLAS_SEO_SEARCH_CATALOG}
      })));
      await expect(input).toHaveAttribute('aria-activedescendant','seoSiteSearchResults-option-0');
      await input.press('Enter');
    }
    await expect(page).toHaveURL(new RegExp(`/dive-site\\.html\\?id=${SECOND}$`));
    await expect(page.locator('#site-title')).toHaveText('Second reef');
  });
}

test('related card inspection loads and caches the linked site summary', async ({ page, hasTouch }) => {
  let inspectedRequests = 0;
  await page.route('**/data/dive-site-details/v1/*.json', route => {
    const inspected = route.request().url().includes(SECOND);
    if (inspected) inspectedRequests++;
    return route.fulfill({ json:record(inspected ? SECOND : FIRST, inspected ? 'Second reef' : 'Example reef') });
  });
  await page.goto(`/dive-site.html?id=${FIRST}`);
  expect(inspectedRequests).toBe(0);
  await page.getByRole('button', { name:/^Keep exploring/ }).click();
  const card = page.locator('#cinematicRecommendations a.site-recommendations__card').first();
  // The record fixture has no rating data; reproduce the nested production badge.
  await card.evaluate(el => {
    const meta = document.createElement('span');
    meta.className = 'site-recommendations__meta';
    meta.style.position = 'absolute';
    const badge = document.createElement('span');
    badge.className = 'site-recommendations__rating';
    badge.textContent = '88/100';
    meta.append(badge);
    el.querySelector('.site-recommendations__card-body').append(meta);
  });
  if (hasTouch) await card.focus(); else await card.hover();
  const summary = card.locator('.cinematic-pilot__card-summary');
  await expect(summary).toContainText('A published description.');
  await expect(summary).toHaveCSS('opacity', '1');
  const rating = card.locator('.site-recommendations__rating');
  await expect(rating).toHaveCSS('opacity', '1');
  await expect(card.locator('.site-recommendations__card-body')).toHaveCSS('opacity', '1');
  await expect(card.locator('.site-recommendations__meta')).toHaveCSS('opacity', '1');
  const titleTop = await card.locator('.site-recommendations__name').evaluate(el => el.getBoundingClientRect().top);
  const hoverTitleTop = await summary.locator('strong').evaluate(el => el.getBoundingClientRect().top);
  expect(Math.abs(hoverTitleTop - titleTop)).toBeLessThan(1);
  await card.blur();
  await page.mouse.move(0, 0);
  await expect(summary).toHaveCSS('opacity', '0');
  await card.focus();
  await expect(summary).toHaveCSS('opacity', '1');
  expect(inspectedRequests).toBe(1);
  await expect(card).toHaveAttribute('href', new RegExp(SECOND));
});

test('Malpelo cinematic pilot opens a full-page explorer with the thumbnail cards first', async ({ page }) => {
  const pilotRecord = record(MALPELO_PILOT, 'Malpelo');
  pilotRecord.related = Array.from({ length:4 }, (_, index) => ({
    site_id:`${index + 2}a532e42-9890-4ea9-b239-0f5fbb836317`,
    name:index === 0 ? 'Second reef' : `Related reef ${index + 1}`, region:'Raja Ampat', photo:{ src:`/assets/favicon-brand.ico?preview=${index}` }
  }));
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:pilotRecord }));
  await page.goto(`/dive-site.html?id=malpelo-${MALPELO_PILOT}`);
  await expect(page.locator('body')).toHaveClass(/cinematic-pilot/);
  // Conditions rely on inserting after this section in the main content.
  await expect(page.locator('#detailPage > .facts-section')).toHaveCount(1);
  const panel = page.locator('#cinematicRecommendations');
  const trigger = page.getByRole('button', { name:/^Keep exploring/ });
  await expect(panel).not.toBeVisible();
  const previews = await trigger.locator('.cinematic-pilot__stack img').evaluateAll(images => images.map(image => image.getAttribute('src')));
  await trigger.click();
  await expect(panel).toBeVisible();
  await expect(page.locator('dialog#cinematicRecommendations[open]')).toHaveCount(1);
  await expect.poll(() => panel.evaluate(element => element.getAnimations().length)).toBe(0);
  await expect(panel.locator('.cinematic-pilot__flying-photo')).toHaveCount(0);
  const bounds = await panel.boundingBox();
  expect(bounds.x).toBe(0);
  expect(bounds.y).toBe(0);
  expect(bounds.width).toBe(page.viewportSize().width);
  expect(bounds.height).toBe(page.viewportSize().height);
  await expect.poll(() => panel.locator('.site-recommendations__image').evaluateAll(images => images.slice(0, 3).map(image => image.getAttribute('src')))).toEqual(previews);
  await expect(panel.getByRole('link', { name:/Second reef/ })).toBeVisible();
  await expect(panel.locator('.site-recommendations__card:visible')).toHaveCount(4);
  await expect(trigger.locator('.cinematic-pilot__stack > *')).toHaveCount(3);
  // Simulate a late shared-module rebuild and verify the launcher selection stays first.
  await panel.locator('ul').evaluate(list => list.replaceChildren(...[...list.children].reverse()));
  await expect.poll(() => panel.locator('.site-recommendations__image').evaluateAll(images => images.slice(0, 3).map(image => image.getAttribute('src')))).toEqual(previews);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await panel.getByRole('button', { name:'Close', exact:true }).focus();
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await expect(panel.locator('.cinematic-pilot__flying-photo')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await panel.getByRole('button', { name:'Close', exact:true }).click();
  await expect(panel).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await panel.getByRole('heading', { name:'Related dive sites', exact:true }).click();
  await expect(panel).toBeVisible();
  await panel.click({ position:{ x:2, y:200 } });
  await expect(panel).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('recommendations close button stays in the visible top-right while scrolling', async ({ page }) => {
  // A short viewport forces overflow even before desktop's Load more action.
  await page.setViewportSize({ ...page.viewportSize(), height:400 });
  const data = record(MALPELO_PILOT, 'Malpelo');
  data.related = Array.from({ length:12 }, (_, index) => ({
    site_id:`${index + 2}a532e42-9890-4ea9-b239-0f5fbb836317`,
    name:`Related reef ${index}`, region:'Raja Ampat', photo:{ src:'/assets/favicon-brand.ico' }
  }));
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:data }));
  await page.goto(`/dive-site.html?id=${MALPELO_PILOT}`);
  const trigger = page.getByRole('button', { name:/^Keep exploring/ });
  await trigger.click();
  const panel = page.locator('#cinematicRecommendations');
  await expect.poll(() => panel.evaluate(el => el.getAnimations().length)).toBe(0);
  const close = panel.getByRole('button', { name:'Close', exact:true });
  const before = await close.boundingBox();
  expect(before.x + before.width).toBeGreaterThan(page.viewportSize().width - 60);
  const scroll = panel.locator('.cinematic-pilot__recommendations-surface');
  await expect(scroll).toHaveCSS('scrollbar-width', 'none');
  expect(await scroll.evaluate(el => getComputedStyle(el, '::-webkit-scrollbar').display)).toBe('none');
  await scroll.evaluate(el => el.scrollTop = el.scrollHeight);
  expect(await scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  const after = await close.boundingBox();
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  await close.click();
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('cinematic pilot handles rapid reversals and reduced motion without stale panels', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:record(MALPELO_PILOT, 'Malpelo') }));
  await page.goto(`/dive-site.html?id=${MALPELO_PILOT}`);
  const trigger = page.getByRole('button', { name:/^Keep exploring/ });
  const panel = page.locator('#cinematicRecommendations');
  await trigger.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();
  await expect.poll(() => panel.evaluate(element => element.getAnimations().length)).toBe(0);
  await expect(panel).not.toHaveAttribute('inert', '');
  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await trigger.click();
  await expect(panel).toBeVisible();
  expect(await panel.evaluate(element => element.getAnimations({ subtree:true }).length)).toBe(0);
  await expect(panel.locator('.cinematic-pilot__flying-photo')).toHaveCount(0);
  await panel.getByRole('button', { name:'Close', exact:true }).click();
  await expect(trigger).toBeFocused();
  await expect(panel).not.toBeVisible();
});

test('shared cinematic appearance enhances other dive sites', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:record() }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await expect(page.locator('body')).toHaveClass(/cinematic-pilot/);
  await expect(page.locator('#detailPage > .site-photo-gallery-rail')).toHaveCount(1);
  await expect(page.getByRole('heading', { name:'Example reef', exact:true })).toBeVisible();
  await page.getByRole('button', { name:/^Keep exploring/ }).click();
  await expect(page.locator('#cinematicRecommendations')).toBeVisible();
  await expect(page.locator('#relatedSites')).toBeVisible();
});

test('shared appearance keeps long titles and empty recommendations usable', async ({ page }) => {
  const site = record(FIRST, 'A very long dive site title with several descriptive words');
  site.related = [];
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:site }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await expect(page.locator('.site-hero')).toHaveClass(/cinematic-pilot--no-photo/);
  await expect(page.getByRole('heading', { name:site.name, exact:true })).toBeVisible();
  await expect(page.locator('#detailPage > .facts-section')).toBeVisible();
  await expect(page.getByRole('button', { name:/^Keep exploring/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('current appearance is visible before recommendations finish loading', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:record() }));
  await page.route('**/data/dive-site-details/v2/*.json', async route => {
    await pending;
    await route.fulfill({ status:404 });
  });
  try {
    await page.goto(`/dive-site.html?id=${FIRST}`);
    await expect(page.getByRole('heading', { name:'Example reef', exact:true })).toBeVisible();
    await expect(page.locator('#detailPage > .cinematic-pilot__rail')).toBeVisible();
    await expect(page.locator('.site-hero .site-photo-gallery-rail')).toHaveCount(0);
    expect(await page.locator('body').evaluate(body => getComputedStyle(body).paddingTop)).toBe('0px');
  } finally { release(); }
});

test('generated permalinks use the shared detail appearance', async ({ page }) => {
  await page.goto('/dive-sites/1-crater-de-san-andres/');
  await expect(page.locator('body')).toHaveClass(/cinematic-pilot/);
  await expect(page.locator('#detailPage > .site-photo-gallery-rail')).toHaveCount(1);
  await expect(page.locator('#detailPage > .facts-section')).toBeVisible();
  await expect(page.locator('#cinematicRecommendations')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('missing-site form validates, sends for review, and stays on the detail page', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:record() }));
  await page.addInitScript(() => {
    window.DIVE_ATLAS_SEO_SEARCH_CATALOG = [{ name:'Known reef', features:[] }];
    window.turnstile = { render: (_node, options) => { options.callback('test-token'); return 1; }, reset: () => {} };
  });
  let submitted;
  await page.route('**/api/site-suggestions', route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json:{ success:true } });
  });
  await page.goto(`/dive-site.html?id=${FIRST}`);
  const trigger = page.locator('#seoSiteSearchInput');
  await trigger.fill('Unlisted reef');
  await page.locator('.dive-search-suggestion-button').click();
  await page.locator('#siteSuggestionName').fill('');
  const dialog = page.locator('#siteSuggestionDialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name:'Send suggestion' }).click();
  await expect(page.locator('#siteSuggestionStatus')).toHaveText('Enter a dive-site name.');
  await page.locator('#siteSuggestionName').fill('Missing reef');
  await page.locator('#siteSuggestionSource').fill('javascript:alert(1)');
  await dialog.getByRole('button', { name:'Send suggestion' }).click();
  await expect(page.locator('#siteSuggestionStatus')).toContainText('valid http or https');
  await page.locator('#siteSuggestionSource').fill('https://example.com/reef');
  await dialog.getByRole('button', { name:'Send suggestion' }).click();
  await expect(page.locator('#siteSuggestionStatus')).toContainText('sent for review');
  expect(submitted).toMatchObject({ siteName:'Missing reef', sourceUrl:'https://example.com/reef', turnstileToken:'test-token' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/dive-site.html\\?id=example-reef-${FIRST}`));
});

test('photo form previews a real image and submits the correct site and consent', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:{ ...record(), photo:{ source:'illustrative-fallback', src:'/assets/diveatlas-logo.svg', alt:'Representative image' } } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json:{ user:{ name:'Test Diver' } } }));
  let payload = '';
  await page.route('**/api/site-photo-submissions', route => {
    payload = route.request().postDataBuffer().toString();
    return route.fulfill({ json:{ success:true, status:'pending' } });
  });
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await page.locator('[data-site-contribution="photo"]:visible').click();
  await expect(page.locator('#sitePhotoUploadSiteName')).toHaveText('Example reef');
  await expect(page.locator('#sitePhotoUploadCredit')).toHaveValue('Test Diver');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 900;
    canvas.getContext('2d').fillRect(0, 0, 1200, 900);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  await page.locator('#sitePhotoUploadFile').setInputFiles({ name:'reef.jpg', mimeType:'image/jpeg', buffer:Buffer.from(image, 'base64') });
  await expect(page.locator('#sitePhotoUploadPreview')).toBeVisible();
  await page.locator('#sitePhotoUploadSubmitButton').click();
  await expect(page.locator('#sitePhotoUploadStatus')).toContainText('Confirm the photo');
  await page.locator('#sitePhotoUploadPolicyAttestation').check();
  await page.locator('#sitePhotoUploadSubmitButton').click();
  await expect(page.locator('#sitePhotoUploadSuccess')).toBeVisible();
  expect(payload).toContain(FIRST);
  expect(payload).toContain('name="attestRealPhoto"');
  expect(payload).toContain('name="attestRights"');
  expect(payload).toContain('originalDimensions');
  await page.locator('#sitePhotoUploadDoneButton').click();
  await expect(page.locator('#sitePhotoUploadModal')).toBeHidden();
});

test('photo sign-in and account failures do not expose an upload form', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:{ ...record(), photo:{ source:'illustrative-fallback', src:'/assets/diveatlas-logo.svg', alt:'Representative image' } } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json:{ user:null } }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await page.locator('[data-site-contribution="photo"]:visible').click();
  await expect(page.locator('#sitePhotoUploadSignIn')).toBeVisible();
  await expect(page.locator('#sitePhotoUploadForm')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.route('**/api/auth/me', route => route.fulfill({ status:503 }));
  await page.locator('[data-site-contribution="photo"]:visible').click();
  await expect(page.locator('#sitePhotoUploadSignInCopy')).toContainText('temporarily unavailable');
  await expect(page.locator('#sitePhotoUploadSignIn')).toBeHidden();
});

test('search suggestion opens in place with the search text and supports keyboard dismissal', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:record() }));
  await page.addInitScript(() => {
    window.DIVE_ATLAS_SEO_SEARCH_CATALOG = [{ name:'Known reef', site_id:'1a532e42-9890-4ea9-b239-0f5fbb836317',
      lat:-0.55, lon:130.7, features:[] }];
  });
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await page.locator('#seoSiteSearchInput').fill('Unlisted reef');
  await page.locator('.dive-search-suggestion-button').click();
  await expect(page.locator('#siteSuggestionName')).toHaveValue('Unlisted reef');
  await expect(page.locator('#siteSuggestionName')).toBeFocused();
  await page.locator('#siteSuggestionSubmitButton').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#siteSuggestionCloseButton')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#siteSuggestionModal')).toBeHidden();
  await expect(page.locator('#seoSiteSearchInput')).toBeFocused();
  await expect(page).toHaveURL(new RegExp(FIRST));
});

test('signed-in return resumes the saved photo submission on the detail page', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:record() }));
  await page.route('**/api/auth/me', route => route.fulfill({ json:{ user:{ name:'Returning diver' } } }));
  await page.addInitScript(id => {
    sessionStorage.setItem('diveatlas:photo-upload-after-sign-in:v1', JSON.stringify({
      siteId:id, siteName:'Example reef', createdAt:Date.now()
    }));
  }, FIRST);
  await page.goto(`/dive-site.html?id=${FIRST}&auth_notice=signed-in`);
  await expect(page.locator('#sitePhotoUploadModal')).toBeVisible();
  await expect(page.locator('#sitePhotoUploadSiteName')).toHaveText('Example reef');
  await expect(page.locator('#sitePhotoUploadCredit')).toHaveValue('Returning diver');
  expect(await page.evaluate(() => sessionStorage.getItem('diveatlas:photo-upload-after-sign-in:v1'))).toBeNull();
});

test('one shared shell renders two different IDs and keeps share/map links site-specific', async ({ page, request }) => {
  const shell = await (await request.get('/dive-site.html')).text();
  expect(shell).not.toContain('Example reef');
  expect(shell).not.toContain('data-site-id=');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/data/dive-site-details/v1/*.json', route => {
    const id = route.request().url().split('/').pop().replace('.json', '').match(/[0-9a-f-]{36}$/i)?.[0];
    return route.fulfill({ json:record(id, id === FIRST ? 'Example reef' : 'Second reef') });
  });
  await page.goto(`/dive-site.html?id=example-reef-${FIRST}`);
  await expect(page.locator('h1')).toHaveText('Example reef');
  await expect(page.locator('.facts-section')).toContainText('12 / 25 m');
  await expect(page.locator('.facts-section .depth-info-button')).toBeVisible();
  await expect(page.locator('.facts-section')).toContainText('Beginner');
  const locationBreadcrumbs = page.locator('nav.breadcrumbs[aria-label="Breadcrumb"] a');
  await expect(locationBreadcrumbs).toHaveText(['Regions', 'Asia', 'South-Eastern Asia', 'Indonesia', 'Raja Ampat']);
  await expect(locationBreadcrumbs.last()).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.site-photo-gallery-map__cta')).toHaveAttribute('href', new RegExp(FIRST));
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://diveatlas.site/dive-site.html?id=example-reef-${FIRST}`);
  await expect(page.locator('.monthly-conditions-section')).toBeAttached();
  await expect(page.locator('#seoThemeButton')).toBeVisible();
  await page.locator('#seoThemeButton').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name:/^Keep exploring/ }).click();
  await page.locator('#relatedSites a').click();
  await expect(page.locator('h1')).toHaveText('Second reef');
  await expect(page).toHaveURL(new RegExp(`second-reef-${SECOND}`));
  await expect(page.locator('main')).toHaveAttribute('data-site-id', SECOND);
  expect(errors).toEqual([]);
});

test('matches the static detail page recommendation filters and card links', async ({ page }) => {
  const nearbyId = '3a532e42-9890-4ea9-b239-0f5fbb836317';
  const featureId = '4a532e42-9890-4ea9-b239-0f5fbb836317';
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:record() }));
  const sites = [
    { site_id:nearbyId, name:'Nearby reef', country:'Indonesia', region:'Raja Ampat', lat:-0.551, lon:130.71,
      difficulty:'Beginner', features:['reef'], feature_values:['reef'], photo:null },
    { site_id:featureId, name:'Feature wall', country:'Indonesia', region:'Other region', lat:-0.56, lon:130.72,
      difficulty:'Advanced', features:['wall'], feature_values:['reef', 'wall'], photo:null }
  ];
  const shard = { schema:'dive-site-recommendations-v1', sites };
  await page.route('**/data/dive-site-details/v2/*.json', route => {
    if (route.request().url().endsWith('/recommendations.json')) return route.fulfill({ json:{
      schema:'dive-site-recommendation-manifest-v1', site_count:sites.length,
      shards:[{ file:'recommendations-0001.json', site_count:sites.length,
        bytes:Buffer.byteLength(`${JSON.stringify(shard)}\n`) }]
    } });
    if (route.request().url().endsWith('/recommendations-0001.json')) return route.fulfill({ json:shard });
    return route.fallback();
  });
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await page.getByRole('button', { name:/^Keep exploring/ }).click();
  await expect(page.getByRole('tab', { name:'All' })).toBeVisible();
  await expect(page.locator('#relatedSites .site-recommendations__combined .site-recommendations__card')).toHaveCount(2);
  await page.getByRole('tab', { name:'Features' }).click();
  await expect(page.locator('#relatedSites [data-recommendation-group="features"] .site-recommendations__name'))
    .toHaveText(['Nearby reef', 'Feature wall']);
  await page.getByRole('tab', { name:'Nearby' }).click();
  await expect(page.locator('#relatedSites [data-recommendation-group="nearby"] .site-recommendations__name'))
    .toHaveText(['Nearby reef']);
  const ratingCardHref = await page.evaluate(() => window.DiveAtlasRecommendationCards.create({
    name:'Nearby reef', slug:'nearby-reef', lat:-0.551, lon:130.71,
    detailUrl:'/dive-site.html?id=nearby-reef-3a532e42-9890-4ea9-b239-0f5fbb836317'
  }, 87).querySelector('a').getAttribute('href'));
  expect(ratingCardHref).toBe('/dive-site.html?id=nearby-reef-3a532e42-9890-4ea9-b239-0f5fbb836317');
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({
    json:{ ...record(), categories:{ setting:'marine', access:'boat', features:'' } }
  }));
  await page.reload();
  await page.getByRole('button', { name:/^Keep exploring/ }).click();
  await expect(page.getByRole('tab', { name:/Features/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name:'Nearby', exact:true })).toBeVisible();
  await page.getByRole('tab', { name:'All', exact:true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name:'Difficulty', exact:true })).toBeFocused();
});

test('uses the configured cloud URL and treats record text as text', async ({ page }) => {
  await page.route('**/js/data-assets-config.js', route => route.fulfill({
    contentType:'text/javascript', body:'window.DIVEATLAS_DATA_ASSET_BASE_URL="https://data.example.com/releases/test/";'
  }));
  let requested = '';
  await page.route('https://data.example.com/releases/test/data/dive-site-details/v1/*.json', route => {
    if (route.request().url().endsWith('/recommendations.json')) return route.fulfill({ status:404 });
    requested = route.request().url();
    const site = record(FIRST, '<img src=x onerror="window.injected=true">');
    site.sources.push(['Unsafe', 'javascript:window.injected=true']);
    return route.fulfill({ json:site, headers:{ 'access-control-allow-origin':'*' } });
  });
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await expect(page.locator('h1')).toHaveText('<img src=x onerror="window.injected=true">');
  expect(requested).toBe(`https://data.example.com/releases/test/data/dive-site-details/v1/${FIRST}.json`);
  await expect(page.locator('.source-list a')).toHaveCount(1);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test('invalid IDs do not request a record', async ({ page }) => {
  let requests = 0;
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    // Error pages still initialize navigation, which loads the shared catalog.
    // That catalog is not a per-site record derived from the invalid ID.
    if (pathname.includes('/data/dive-site-details/') && pathname !== '/data/dive-site-details/v2/recommendations.json') requests++;
  });
  await page.goto('/dive-site.html?id=../../private');
  await expect(page.locator('h1')).toHaveText('Choose a dive site');
  expect(requests).toBe(0);
});

test('missing records explain the failure', async ({ page }) => {
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await expect(page.locator('h1')).toHaveText('Dive site unavailable');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
});

test('wrong-site responses are rejected and a retry can recover', async ({ page }) => {
  let attempt = 0;
  await page.route('**/data/dive-site-details/v1/*.json', route =>
    route.fulfill({ json:record(attempt++ ? FIRST : SECOND) }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await expect(page.locator('h1')).toHaveText('Unable to load this dive site');
  await page.getByRole('button', { name:'Try again' }).click();
  await expect(page.locator('h1')).toHaveText('Example reef');
});

test('rating chart collapse retains the release frame without flashing back open', async ({ page, hasTouch }) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = relative => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
  await page.setViewportSize({ width:390, height:844 });
  // Use the actual component sources; environmental data is independent of the gesture.
  await page.route('http://rating.test/**', route => {
    const url = route.request().url();
    if (url.includes('dive-site-rating-card.js')) {
      return route.fulfill({ contentType:'text/javascript', body:source('js/dive-site-rating-card.js') });
    }
    if (url.includes('dive-experience-outlook-map.js')) {
      return route.fulfill({ contentType:'text/javascript', body:'window.DiveAtlasDiveExperienceMap={createDataStore(){return {sample:async()=>({score:82,label:"Good"})}}}' });
    }
    return route.fulfill({ contentType:'text/html', body:`
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>${source('assets/seo.css')}</style>
      <style>.site-photo-gallery-rating{position:absolute;top:100px;left:20px;width:220px;height:108px}.site-photo-gallery-rating__trend{height:260px}</style>
      <body class="cinematic-pilot">
      <section class="site-photo-gallery-rating" data-rating-lat="1" data-rating-lng="1" tabindex="0">
        <div>Rating</div><div class="site-photo-gallery-rating__score">Loading</div>
        <div class="site-photo-gallery-rating__trend"><p class="site-photo-gallery-rating__trend-title">Monthly Rating</p><div class="site-photo-gallery-rating__trend-chart"></div></div>
      </section><script src="/js/dive-site-rating-card.js"></script>` });
  });
  await page.goto('http://rating.test/');
  await expect(page.locator('.site-photo-gallery-rating__score')).toHaveAttribute('data-status', 'ready');
  const touch = Boolean(hasTouch);
  const card = page.locator('.site-photo-gallery-rating');
  const panel = page.locator('.site-photo-gallery-rating__trend');
  if (touch) await card.tap();
  else await card.hover();
  await expect(panel).toBeVisible();
  await page.evaluate(() => {
    const panel = document.querySelector('.site-photo-gallery-rating__trend');
    window.ratingCollapseFrames = [];
    panel.addEventListener('pointerup', () => {
      const start = performance.now();
      const sample = () => {
        const style = getComputedStyle(panel);
        const inset = style.clipPath.match(/inset\(([^)]+)\)/)?.[1].split(/\s+/);
        window.ratingCollapseFrames.push(inset ? parseFloat(inset[2] || inset[0]) : 0);
        if (performance.now() - start < 500) requestAnimationFrame(sample);
        else window.ratingCollapseSamplingDone = true;
      };
      sample();
    }, { capture:true, once:true });
  });
  const handle = await page.getByRole('button', { name:'Collapse monthly rating chart' }).boundingBox();
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type, clientY) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints:type === 'touchEnd' ? [] : [{ x, y:clientY, id:1 }]
    });
    await send('touchStart', y);
    for (let step = 1; step <= 15; step++) await send('touchMove', y - 80 * step / 15);
    await send('touchEnd');
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 80, { steps:15 });
    await page.mouse.up();
  }
  await page.waitForFunction(() => window.ratingCollapseSamplingDone);
  const frames = await page.evaluate(() => window.ratingCollapseFrames);
  expect(frames[0]).toBeCloseTo(80, 0);
  // Increasing bottom inset means the exposed height only shrinks, including cleanup.
  for (let index = 1; index < frames.length; index++) {
    expect(frames[index], `collapse frame ${index}`).toBeGreaterThanOrEqual(frames[index - 1] - 0.5);
  }
  await expect(panel).toBeHidden();
  if (!touch) {
    await page.mouse.move(x + 2, y - 80);
    await page.mouse.move(x - 2, y - 80);
    await expect(panel).toBeHidden();
    await page.mouse.move(370, 700);
    await card.hover();
    await expect(panel).toBeVisible();
  }
});


for (const theme of ['light', 'dark']) {
  test(`rating popup visibly blurs the background in ${theme} theme`, async ({ page, hasTouch }) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = relative => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
    await page.setViewportSize({ width:390, height:844 });
    await page.emulateMedia({ reducedMotion:'reduce' });
    await page.route('http://rating-glass.test/**', route => {
      const url = route.request().url();
      if (url.includes('dive-site-rating-card.js')) return route.fulfill({ contentType:'text/javascript', body:source('js/dive-site-rating-card.js') });
      if (url.includes('dive-experience-outlook-map.js')) return route.fulfill({ contentType:'text/javascript', body:'window.DiveAtlasDiveExperienceMap={createDataStore(){return {sample:async()=>({score:82,label:"Good"})}}}' });
      return route.fulfill({ contentType:'text/html', body:`
        <html data-theme="${theme}"><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>${source('assets/seo.css')}</style><style>${source('assets/liquid-glass.css')}</style>
        <style>.site-photo-gallery-rating{position:absolute;top:100px;left:20px;width:220px;height:108px;container-type:inline-size}
        .site-photo-gallery-rating__trend{height:260px}
        .backing{position:absolute;top:208px;left:0;width:100%;height:1200px;background:repeating-linear-gradient(90deg,#102030 0 2px,#fff 2px 4px)}</style>
        <body class="cinematic-pilot"><section class="site-photo-gallery-rating" data-rating-lat="1" data-rating-lng="1" tabindex="0">
        <div>Rating</div><div class="site-photo-gallery-rating__score">Loading</div>
        <div class="site-photo-gallery-rating__trend"><p class="site-photo-gallery-rating__trend-title">Monthly Rating</p><div class="site-photo-gallery-rating__trend-chart"></div></div>
        </section><div class="backing"></div><script src="/js/dive-site-rating-card.js"></script></body></html>` });
    });
    await page.goto('http://rating-glass.test/');
    const card = page.locator('.site-photo-gallery-rating');
    const panel = page.locator('.site-photo-gallery-rating__trend');
    await expect(card.locator('.site-photo-gallery-rating__score')).toHaveAttribute('data-status', 'ready');
    if (hasTouch) await card.tap(); else await card.hover();
    await expect(panel.locator('svg')).toBeVisible();
    expect(await panel.evaluate(el => el.matches(':popover-open'))).toBe(true);
    const blurred = await panel.screenshot({ animations:'disabled' });
    await panel.evaluate(el => el.style.setProperty('backdrop-filter', 'none', 'important'));
    const unblurred = await panel.screenshot({ animations:'disabled' });
    // Computed backdrop-filter alone missed the original compositing failure.
    // Rendering the same fixed backing must actually produce different pixels.
    expect(blurred.equals(unblurred)).toBe(false);
    expect(unblurred.equals(await panel.screenshot({ animations:'disabled' }))).toBe(true);
    await panel.evaluate(el => el.style.removeProperty('backdrop-filter'));
    expect(blurred.equals(await panel.screenshot({ animations:'disabled' }))).toBe(true);
    const before = await panel.boundingBox();
    await page.evaluate(() => window.scrollBy(0, 25));
    await expect.poll(async () => (await panel.boundingBox()).y).toBeCloseTo(before.y - 25, 0);
  });
}

test('record evidence preserves multiple levels and unknown depths on shared pages', async ({ page }, testInfo) => {
  const notes = ['Recorded experience labels are source reports, not verified suitability.',
    'SSI snapshot: 26 m (maximum); snapshot date 2026-06-22; retrieval date unknown.',
    'Possible related record: 日本語の名前; 37 m (unknown). Shared identity has not been established. These records remain separate.'];
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:{ ...record(),
    difficulty:'Beginner | Advanced | Expert', evidence_notes:notes,
    observations:[{ depths:[{ value:26, meaning:'unknown' }, { value:26, meaning:'maximum' }, { value:37, meaning:'unknown' }] }] } }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await expect(page.locator('.fact').filter({ has:page.locator('dt', { hasText:'Recorded experience levels' }) })).toContainText('Beginner | Advanced | Expert');
  await expect(page.locator('.record-evidence')).toContainText('remain separate');
  await expect(page.locator('.fact-grid')).toContainText('26 m The source does not say whether this is the maximum depth or the usual dive depth.; 26 m (maximum); 37 m The source does not say whether this is the maximum depth or the usual dive depth.');
  await expect(page.locator('.record-evidence')).toContainText('retrieval date unknown');
  await expect(page.locator('.record-evidence')).toHaveCSS('overflow-wrap', 'anywhere');
  await expect(page.locator('.fact-grid [data-depth-min="26"]')).toHaveCount(2);
  const depthInfo = page.getByRole('button', { name:'About this depth' }).first();
  const depthNote = page.locator('.depth-meaning-unknown').first();
  await expect(depthNote).toBeHidden();
  const gridBefore = await page.locator('.fact-grid').boundingBox();
  await depthInfo.click();
  await expect(depthNote).toBeVisible();
  await expect(depthNote).toHaveCSS('backdrop-filter', 'blur(8px) saturate(1.45)');
  await expect(depthNote).toHaveCSS('background-color', 'color(srgb 1 1 1 / 0.85)');
  expect((await page.locator('.fact-grid').boundingBox()).height).toBe(gridBefore.height);
  await expect(depthInfo.locator('.note-icon')).toHaveCount(1);
  await expect(depthNote).toHaveAttribute('role', 'tooltip');
  await expect(depthInfo).toHaveAttribute('aria-expanded', 'true');
  await depthInfo.focus();
  await page.keyboard.press('Escape');
  await expect(depthNote).toBeHidden();
  const disclosure = page.locator('.record-evidence > details');
  await expect(disclosure).toHaveCount(1);
  await expect(page.locator('.data-note')).toHaveCount(0);
  await expect(disclosure.locator(':scope > summary')).toHaveText('Sources and notes · unresolved records');
  await expect(disclosure.locator('.record-evidence-summary')).toContainText('Check local guidance before diving.');
  await expect(disclosure.locator('.record-evidence-summary')).toBeHidden();
  await expect(disclosure).not.toHaveAttribute('open', '');
  await expect(page.locator('.record-evidence-summary')).toContainText('kept separate');
  await expect(disclosure.locator('.record-evidence-notes')).toBeHidden();
  await expect(disclosure.locator('.source-section')).toHaveCount(1);
  await expect(disclosure.locator('.source-list')).toBeHidden();
  await disclosure.locator(':scope > summary').click();
  await expect(disclosure.locator('.record-evidence-notes')).toBeHidden();
  await disclosure.locator('.record-evidence-metadata > summary').click();
  await expect(disclosure.locator('.record-evidence-notes')).toBeVisible();
  await expect(disclosure.locator('.source-list')).toBeVisible();
  await expect(disclosure.locator('.source-list a')).toHaveAttribute('href', 'https://example.com/source');
  await expect(disclosure.locator('.record-evidence-summary')).toBeVisible();
  await page.evaluate(() => document.documentElement.lang = 'zh');
  await expect(disclosure.locator(':scope > summary')).toContainText('查看来源');
  await expect(disclosure.locator('.record-evidence-notes')).toContainText('经验等级来自来源记录');
  await expect(disclosure.locator('.record-evidence-notes')).toContainText('2026-06-22');
  await expect(disclosure.locator('.record-evidence-notes')).not.toContainText('Recorded experience labels are source reports');
  await expect(page.locator('.depth-meaning-unknown').first()).toHaveText('来源未说明这是最大深度，还是通常的潜水深度。');
  await expect(page.locator('.record-evidence-summary')).toContainText('尚未确认');
  await page.locator('.record-evidence').scrollIntoViewIfNeeded();
  await page.screenshot({ path:testInfo.outputPath('record-evidence.png'), fullPage:true });
  await page.evaluate(() => localStorage.setItem('diveatlas-length-unit', 'ft'));
  await page.reload();
  await expect(page.locator('.fact-grid')).toContainText('85 ft The source does not say whether this is the maximum depth or the usual dive depth.; 85 ft (maximum); 121 ft The source does not say whether this is the maximum depth or the usual dive depth.');
});

test('legacy indexed pages show the same uncertainty and never retain a Beginner-only badge', async ({ page }) => {
  const id = '40f5a479-c6e6-4cf3-9d78-4eb3a046f30a';
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:{
    ...record(id), difficulty:'Beginner | Advanced | Expert',
    evidence_notes:['Recorded labels are not verified suitability.', 'Possible related record; identity remains unresolved.'],
    observations:[{ depths:[{ value:26, meaning:'maximum' }] }]
  } }));
  await page.route('**/legacy-record.html', route => route.fulfill({ contentType:'text/html', body:`
    <main data-site-id="${id}"><section class="facts-section"><dl class="fact-grid">
      <div class="fact"><dt>Difficulty</dt><dd>Beginner</dd></div>
      <div class="fact"><dt>Recorded depth</dt><dd data-depth-min="26" data-depth-max="26">26 m</dd></div>
    </dl></section></main><script type="module">
      import { enhanceRecordedEvidence } from '/js/dive-site-record-evidence.js';
      enhanceRecordedEvidence();
    </script>` }));
  await page.goto('/legacy-record.html');
  await expect(page.locator('.record-evidence')).toContainText('identity remains unresolved');
  await expect(page.locator('.fact-grid')).toContainText('Beginner | Advanced | Expert');
  await expect(page.locator('.fact-grid')).toContainText('26 m (maximum)');
});

test('confirmed identity aliases remain searchable and are excluded from recommendations', async ({ page }) => {
  const alias = { ...record(SECOND, '日本語の名前') }; // Older catalogs may omit canonical metadata.
  const current = { ...record(), canonical_id:FIRST, identity_status:'confirmed', identity_members:[FIRST, SECOND], aliases:'日本語の名前' };
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:current }));
  await page.route('**/data/dive-site-details/v2/recommendations.json', route => route.fulfill({ json:{
    schema:'dive-site-recommendations-v1', sites:[{ ...current, features:['reef'] }, { ...alias, features:['reef'] }]
  } }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await expect(page.locator('#site-title')).toHaveText('Example reef');
  await expect(page.locator('[data-recommendation-card]')).toHaveCount(0);
  await page.locator('#seoSiteSearchInput').fill('日本語の名前');
  await expect(page.locator('#seoSiteSearchResultsScroll')).toContainText('Example reef');
  await page.locator('#seoSiteSearchFilterToggle').click();
  await page.locator('#seoSiteSearchDifficultyPicker').click();
  await page.locator('#seoSiteSearchDifficultyPickerOptions').getByRole('option', { name:'Advanced', exact:true }).click();
  await expect(page.locator('#seoSiteSearchResultsScroll')).toContainText('Example reef');
});


test('generated Antonio profiles retain recorded labels and uncertainty without JavaScript', async ({ page }) => {
  await page.route('**/*.js*', route => route.abort());
  await page.goto('/dive-sites/antonio-gaudi/index.html');
  await expect(page.locator('.fact-grid')).toContainText('Beginner | Advanced | Expert');
  await expect(page.locator('.record-evidence')).toContainText('These records remain separate');
  await page.goto('/dive-sites/site-89ebb901-okinawa-japan/index.html');
  await expect(page.locator('h1')).toHaveText('アントニオガウデイ');
  await expect(page.locator('.fact-grid')).toContainText('37 m (unknown)');
  await expect(page.locator('.record-evidence')).toContainText('Shared site or route identity has not been established');
});


test('confirmed old UUID links render the canonical identity and survive reload', async ({ page }) => {
  const canonical = { ...record(FIRST, 'Canonical reef'), canonical_id:FIRST,
    identity_status:'confirmed', identity_members:[FIRST, SECOND], aliases:'日本語の名前',
    evidence_notes:['Confirmed shared identity. Retained source records disagree on maximum depth.'] };
  await page.route('**/data/dive-site-details/v1/*.json', route => {
    const id = route.request().url().includes(SECOND) ? SECOND : FIRST;
    return route.fulfill({ json:{ ...canonical, site_id:id } });
  });
  await page.goto(`/dive-site.html?id=old-name-${SECOND}&language=ja#sources`);
  await expect(page.locator('#site-title')).toHaveText('Canonical reef');
  await expect(page.locator('main')).toHaveAttribute('data-site-id', FIRST);
  await expect(page).toHaveURL(new RegExp(`canonical-reef-${FIRST}.*language=ja#sources$`));
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(FIRST));
  await expect(page.locator('.site-photo-gallery-map__cta')).toHaveAttribute('href', new RegExp(FIRST));
  await page.reload();
  await expect(page.locator('#site-title')).toHaveText('Canonical reef');
  await expect(page.locator('.record-evidence')).toContainText('Retained source records');
});

test('indexed pages refresh existing evidence and remove confirmed identities from old recommendation links', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:{
    ...record(SECOND, 'Canonical reef'), canonical_id:FIRST, identity_status:'confirmed', identity_members:[FIRST, SECOND],
    identity_urls:['/dive-sites/canonical-reef/', '/dive-sites/old-alias/'],
    evidence_notes:['Confirmed shared identity; category references from both records retained.'],
    sources:[['Source A', 'https://example.com/a'], ['Source B', 'https://example.com/b']],
    observations:[{ depths:[{ value:26, meaning:'maximum' }, { value:18, meaning:'typical' }] }]
  } }));
  await page.route('**/old-alias/index.html', route => route.fulfill({ contentType:'text/html', body:`
    <link rel="canonical" href="https://diveatlas.site/dive-sites/old-alias/">
    <main class="detail-page" data-site-id="${SECOND}"><section class="facts-section"><dl class="fact-grid">
      <div class="fact"><dt>Recorded experience levels</dt><dd>Beginner</dd></div>
      <div class="fact"><dt>Source-reported depths</dt><dd>26 m</dd></div></dl></section>
      <section class="record-evidence"><h2>Source evidence and uncertainty</h2><ul><li>Old candidate decision</li></ul></section>
      <section class="source-section"><h2>Sources</h2><ul><li><a href="https://www.openstreetmap.org/">OSM</a></li></ul></section></main>
    <aside class="site-recommendations"><ul>
      <li><a href="/dive-sites/canonical-reef/">Canonical</a></li>
      <li><a href="/dive-sites/old-alias/">Alias</a></li>
      <li><a href="/dive-site.html?id=old-name-${FIRST}">Old UUID</a></li>
      <li><a href="/dive-sites/distinct-reef/">Distinct site</a></li></ul></aside>
    <script type="module">import { enhanceRecordedEvidence } from '/js/dive-site-record-evidence.js'; enhanceRecordedEvidence();</script>` }));
  await page.goto('/old-alias/index.html');
  await expect(page.locator('.record-evidence')).toContainText('Confirmed shared identity');
  await expect(page.locator('.record-evidence')).not.toContainText('Old candidate');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(FIRST));
  await expect(page.locator('.source-section a')).toHaveCount(2);
  await expect(page.locator('.source-section')).not.toContainText('OSM');
  await expect(page.locator('.fact-grid')).toContainText('26 m (maximum); 18 m (typical)');
  await expect(page.locator('.site-recommendations a')).toHaveText(['Distinct site']);
  await page.evaluate(() => {
    const item = document.createElement('li');
    item.innerHTML = '<a href="/dive-sites/old-alias/">Late alias</a>';
    document.querySelector('.site-recommendations ul').append(item);
  });
  await expect(page.locator('.site-recommendations a')).toHaveText(['Distinct site']);
});

test('unavailable evidence keeps server-rendered provenance intact', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ status:404 }));
  await page.goto('/dive-sites/antonio-gaudi/index.html');
  await expect(page.locator('.record-evidence')).toContainText('257960');
  await expect(page.locator('.fact-grid')).toContainText('Beginner | Advanced | Expert');
  await expect(page.locator('.source-section')).toContainText('SSI');
});


test('candidate metadata cannot redirect an old UUID to a canonical identity', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:{
    ...record(SECOND, 'Unresolved candidate'), canonical_id:FIRST, identity_members:[FIRST, SECOND],
    identity_status:'candidate'
  } }));
  await page.goto(`/dive-site.html?id=${SECOND}`);
  await expect(page.locator('h1')).toHaveText('Unable to load this dive site');
  await expect(page).toHaveURL(new RegExp(SECOND));
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});


test('mobile search reserves the drag handle area for short and scrollable suggestion lists', async ({ page }) => {
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:record() }));
  await page.addInitScript(() => {
    window.DIVE_ATLAS_SEO_SEARCH_CATALOG = Array.from({ length:40 }, (_, index) => ({
      name:`Known reef ${index}`, site_id:'1a532e42-9890-4ea9-b239-0f5fbb836317',
      lat:-0.55, lon:130.7, country:'Indonesia', difficulty:'Advanced', features:['reef']
    }));
  });
  await page.goto(`/dive-site.html?id=${FIRST}`);
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height:650 });
    for (const filters of [false, true]) {
      for (const query of ['Unlisted reef', 'Known reef']) {
        if (!await page.locator('#seoSiteSearchInput').isVisible()) await page.locator('#seoSiteSearchToggle').click();
        await page.locator('#seoSiteSearchInput').fill(query);
        const toggle = page.locator('#seoSiteSearchFilterToggle');
        if ((await toggle.getAttribute('aria-expanded') === 'true') !== filters) await toggle.click();
        await page.locator('#seoSiteSearchResultsScroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
        const suggestion = page.locator('.dive-search-suggestion-button');
        await expect(suggestion).toBeVisible();
        const buttonBox = await suggestion.boundingBox();
        const handleBox = await page.locator('#seoSiteSearchResultsHandle').boundingBox();
        expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(handleBox.y);
        await suggestion.click();
        await expect(page.locator('#siteSuggestionName')).toHaveValue(query);
        await page.keyboard.press('Escape');
        await expect(page.locator('#siteSuggestionModal')).toBeHidden();
      }
    }
  }
});

test('mobile search handle still dismisses with an upward drag and keyboard activation', async ({ page }) => {
  await page.setViewportSize({ width:393, height:650 });
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:record() }));
  await page.addInitScript(() => { window.DIVE_ATLAS_SEO_SEARCH_CATALOG = [{ name:'Known reef', features:[] }]; });
  await page.goto(`/dive-site.html?id=${FIRST}`);
  await page.locator('#seoSiteSearchInput').fill('Unlisted reef');
  const handle = page.locator('#seoSiteSearchResultsHandle');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 85, { steps:8 });
  await page.mouse.up();
  await expect(page.locator('#seoSiteSearchResults')).toBeHidden();
  await page.locator('#seoSiteSearchInput').fill('Unlisted reef');
  await handle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#seoSiteSearchResults')).toBeHidden();
});


test('record field labels follow persisted and changed language after evidence refresh', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('global-coral-map-lang', 'zh'));
  await page.route('**/data/dive-site-details/v1/*.json', route => route.fulfill({ json:{ ...record(),
    evidence_notes:['Recorded experience labels are source reports, not verified suitability.'],
    observations:[{ depths:[{ value:25, meaning:'unknown' }] }] } }));
  await page.goto(`/dive-site.html?id=${FIRST}`);
  const depth = page.locator('[data-record-field="depth"] dt');
  const experience = page.locator('[data-record-field="difficulty"] dt');
  await expect(depth).toHaveText('来源记录的深度');
  await expect(experience).toHaveText('来源记录的经验等级');
  await page.locator('#seoLanguageSelect').selectOption('en', { force:true });
  await expect(depth).toHaveText('Source-reported depths');
  await expect(experience).toHaveText('Recorded experience levels');
  await page.locator('#seoLanguageSelect').selectOption('zh', { force:true });
  await expect(depth).toHaveText('来源记录的深度');
  await expect(experience).toHaveText('来源记录的经验等级');
});
