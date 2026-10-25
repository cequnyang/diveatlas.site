const { test, expect } = require('@playwright/test');

const FIRST = '1a532e42-9890-4ea9-b239-0f5fbb836317';
const SECOND = '2a532e42-9890-4ea9-b239-0f5fbb836317';
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
  // These tests exercise record loading and page startup, independently of the
  // environmental datasets tested by the existing chart/rating suites.
  await page.route('**/data/**', route => route.fulfill({ status:404, body:'Unavailable in test' }));
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
  await expect(page.locator('.facts-section')).toContainText('12–25 m');
  await expect(page.locator('.facts-section')).toContainText('Beginner');
  await expect(page.locator('.lead.location-hierarchy')).toContainText('Raja Ampat');
  await expect(page.locator('.lead.location-hierarchy')).toHaveText('Asia / South-Eastern Asia / Indonesia / Raja Ampat');
  await expect(page.locator('.site-photo-gallery-map__cta')).toHaveAttribute('href', new RegExp(FIRST));
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://diveatlas.site/dive-site.html?id=example-reef-${FIRST}`);
  await expect(page.locator('.monthly-conditions-section')).toBeAttached();
  await expect(page.locator('#seoThemeButton')).toBeVisible();
  await page.locator('#seoThemeButton').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
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
  page.on('request', request => { if (request.url().includes('/data/dive-site-details/')) requests++; });
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
      <style>.site-photo-gallery-rating{position:absolute;top:100px;left:20px;width:220px;height:108px}</style>
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
