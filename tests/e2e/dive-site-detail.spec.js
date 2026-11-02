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
  await expect(page.locator('.facts-section')).toContainText('12 / 25 m (unknown meaning)');
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
  expect((await page.locator('.fact-grid').boundingBox()).height).toBe(gridBefore.height);
  await expect(depthInfo.locator('.note-icon')).toHaveCount(1);
  await expect(depthNote).toHaveAttribute('role', 'tooltip');
  await expect(depthInfo).toHaveAttribute('aria-expanded', 'true');
  await depthInfo.focus();
  await page.keyboard.press('Escape');
  await expect(depthNote).toBeHidden();
  const disclosure = page.locator('.record-evidence details');
  await expect(disclosure).toHaveCount(1);
  await expect(page.locator('.data-note')).toHaveCount(0);
  await expect(disclosure.locator('summary')).toHaveText('Sources and notes · unresolved records');
  await expect(disclosure.locator('.record-evidence-summary')).toContainText('Check local guidance before diving.');
  await expect(disclosure.locator('.record-evidence-summary')).toBeHidden();
  await expect(disclosure).not.toHaveAttribute('open', '');
  await expect(page.locator('.record-evidence-summary')).toContainText('kept separate');
  await expect(disclosure.locator('ul')).toBeHidden();
  await disclosure.locator('summary').click();
  await expect(disclosure.locator('ul')).toBeVisible();
  await expect(disclosure.locator('.record-evidence-summary')).toBeVisible();
  await page.evaluate(() => document.documentElement.lang = 'zh');
  await expect(disclosure.locator('summary')).toContainText('查看来源');
  await expect(disclosure.locator('ul')).toContainText('经验等级来自来源记录');
  await expect(disclosure.locator('ul')).toContainText('2026-06-22');
  await expect(disclosure.locator('ul')).not.toContainText('Recorded experience labels are source reports');
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
