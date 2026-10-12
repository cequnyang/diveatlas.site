const { test, expect } = require('@playwright/test');
const { openMap } = require('./support');

async function expandLayers(page) {
  const layers = page.locator('#bioLegend');
  if (await layers.evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
}

test('Tide tab exposes its controls and numeric legend without startup requests', async ({ page }) => {
  await openMap(page);
  const tideRequests = [];
  page.on('request', request => {
    if (/tide|eot20|fes2014/i.test(request.url())) tideRequests.push(request.url());
  });
  await expandLayers(page);

  const tideTab = page.locator('.environment-segment').filter({
    has: page.locator('input[name="environmentView"][value="tide"]')
  });
  await expect(tideTab).toBeVisible();
  await expect(tideTab.locator('span')).toHaveText('Tide');
  await expect(tideTab).toHaveCSS('min-height', '44px');
  await expect(page.locator('#tideControls')).toBeHidden();
  expect(tideRequests).toEqual([]);

  await tideTab.click();
  await expect(page.locator('#tideControls')).toBeVisible();
  await expect(page.locator('#tideTitle')).toHaveText('Tide');
  await expect(page.locator('#tideInfoAbout')).toBeVisible();
  await expect(page.locator('#tideControls .temperature-heading-title')).toHaveCSS('font-family', /Outfit/);
  const timeSelector = page.locator('#tideTime').locator('xpath=..');
  await expect(timeSelector).toHaveCSS('width', '150px');
  await expect(page.locator('#tideTime')).toHaveCSS('width', '150px');
  const legendMetaGap = await page.evaluate(() => {
    const card = document.querySelector('.tide-legend .temperature-legend-card').getBoundingClientRect();
    const meta = document.querySelector('.tide-source-badge').getBoundingClientRect();
    return meta.top - card.bottom;
  });
  expect(legendMetaGap).toBeLessThanOrEqual(4.1);
  await page.locator('#tideInfoAbout').click();
  await expect(page.locator('#tideInfoPopover')).toHaveClass(/is-detached/);
  await expect(page.locator('#tideInfoPopover')).toContainText('does not directly indicate local current speed');
  await page.locator('#tideInfoAbout').click();
  await expect(page.locator('#tideTime')).toHaveValue('0');
  await expect(page.locator('#tideLegendSelection')).toHaveText('Now');
  await page.locator('#tideTime').click();
  const timeWheel = page.locator('#tideTime-wheel-list');
  await expect(timeWheel).toBeVisible();
  await expect(timeWheel.locator('[role="option"]')).toHaveCount(7);
  await timeWheel.locator('[role="option"]').filter({ hasText: '+6 h' }).click();
  await expect(page.locator('#tideLegendSelection')).toHaveText('+6 h');
  await expect(timeWheel).toBeHidden();
  await page.locator('#tideTime').selectOption('0');
  await expect(page.locator('.tide-controls .temperature-scale')).toContainText('−2 m');
});
