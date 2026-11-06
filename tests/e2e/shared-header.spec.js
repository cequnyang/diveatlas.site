const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('global-coral-map-tutorial-suppressed-v1', '1');
    localStorage.setItem('diveatlas-tutorial-seen-v1', '1');
    localStorage.setItem('global-coral-map-theme', 'light');
  });
  await page.route('https://**', route => route.abort());
  await page.route('**/api/auth/me', route => route.fulfill({ json:{ user:null } }));
  await page.route('**/plain-page-fixture.html', route => route.fulfill({
    contentType:'text/html',
    body:'<!doctype html><html><head><title>Plain document</title><link rel="stylesheet" href="/assets/site-header.css?v=1"><script src="/js/site-header.js?v=1" defer></script></head><body><main><h1>Plain document</h1></main></body></html>'
  }));
});

for (const path of ['/', '/dive-site.html', '/dive-sites/', '/regions/', '/destinations/', '/plain-page-fixture.html']) {
  test(`shared header layout and controls on ${path}`, async ({ page }) => {
    await page.goto(path);
    const header = page.locator('.shared-site-header');
    await expect(header).toHaveCount(1);
    await expect(header.locator('.dive-search-box')).toBeVisible();
    const bounds = await header.boundingBox();
    expect(bounds.height).toBe(42);
    await expect.poll(async () => (await header.boundingBox()).width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    // Repeated mounts must retain existing nodes and their event handlers.
    const identity = await header.evaluate(el => {
      const input = el.querySelector('input');
      window.DiveAtlasHeader.mount();
      window.DiveAtlasHeader.mount();
      return input === el.querySelector('input');
    });
    expect(identity).toBe(true);
    const map = path === '/';
    if (!map) await expect(page.locator('#authMenuStatus')).toHaveText('Not signed in');
    await page.locator(map ? '#themeBtn' : '#seoThemeButton').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator(map ? '#languageMenuButton' : '#seoLanguageButton').click();
    await expect(page.locator(map ? '#languageDropdown' : '#seoLanguageDropdown')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator(map ? '#topMenuButton' : '#seoMenuButton').click();
    await expect(page.locator(map ? '#topMenuDropdown' : '#seoMenuDropdown')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.shared-site-header')).toHaveCount(1);
  });
}
