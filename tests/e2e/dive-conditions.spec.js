const { test, expect } = require('@playwright/test');
const { openMap, openMobileSettings, setMapView } = require('./support');

test('standalone Dive Conditions tab is removed while Dive Experience retains monthly conditions', async ({ page }) => {
  await openMap(page);
  if (page.viewportSize().width <= 720) {
    if (await page.locator('#bioLegend').evaluate(element => element.classList.contains('is-collapsed'))) await page.locator('#bioLegendTitle').click();
    await page.locator('.environment-segment-group').evaluate(group => { group.scrollLeft = 0; });
  }
  await setMapView(page, -5, 130, 7);

  await expect(page.locator('input[name="environmentView"][value="dive-conditions"]')).toHaveCount(0);
  await expect(page.locator('#diveConditionsPanel')).toHaveCount(0);
  await expect(page.locator('#diveConditionsMonth')).toHaveCount(0);
  await expect(page.locator('#diveExperienceMonth')).toBeAttached();
  await expect(page.locator('#environmentViewSelect option[value="dive-conditions"]')).toHaveCount(0);

  await page.locator('.environment-segment').filter({ hasText: 'Dive Experience' }).click();
  await page.getByRole('button', { name: 'Map layers' }).click();
  await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;
    const latlng = window.L.latLng(-5, 130);
    const containerPoint = map.latLngToContainerPoint(latlng);
    map.fire('click', { latlng, containerPoint });
  });
  const popup = page.locator('.dive-experience-popup-content');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('Dive Conditions');
  await expect(popup).toContainText('Water temp.');
  await openMobileSettings(page);
  await page.locator('#temperatureUnitSwitch [data-temperature-unit="F"]').click();
  await expect(popup.locator('.dive-conditions-grid')).toContainText('°F');
  await page.locator('#measurementUnitSwitch [data-length-unit="ft"]').click();
  await expect(popup.locator('.dive-conditions-grid')).toContainText('ft');
  await popup.locator('.dive-experience-score-info > summary').click();
  const infoTooltip = page.locator('.dive-experience-popup-info-popover');
  await expect(infoTooltip).toBeVisible();
  await infoTooltip.locator('.dive-experience-dimension-details > summary').click();
  await expect(infoTooltip).toContainText('°F-weeks');
  await expect(infoTooltip).toContainText('mi from source');
  await page.locator('.leaflet-popup-close-button').click();
  await page.getByRole('button', { name: 'Map layers' }).click();

  const before = await page.evaluate(() => {
    const center = window.__DIVEATLAS_TEST__.map.getCenter();
    return { lat: center.lat, lng: center.lng, zoom: window.__DIVEATLAS_TEST__.map.getZoom() };
  });
  if (page.viewportSize().width <= 720) {
    await page.locator('#diveExperienceMonth').evaluate(select => {
      select.value = '7';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  } else {
    await page.locator('#diveExperienceMonth').selectOption('7');
  }
  await expect(page.locator('#diveExperienceMonth')).toHaveValue('7');
  const after = await page.evaluate(() => {
    const center = window.__DIVEATLAS_TEST__.map.getCenter();
    return { lat: center.lat, lng: center.lng, zoom: window.__DIVEATLAS_TEST__.map.getZoom() };
  });
  expect(after).toEqual(before);
});
