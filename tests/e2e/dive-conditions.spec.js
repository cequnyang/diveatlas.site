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

  await page.locator('.environment-segment').filter({
    has:page.locator('input[name="environmentView"][value="dive-experience-outlook"]')
  }).click();
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
  const conditionValues = popup.locator('.dive-experience-subscore .dive-conditions-grid .dive-experience-dimension-value');
  await expect(conditionValues).toHaveCount(4);
  for (const value of await conditionValues.all()) {
    await expect(value).toHaveCSS('font-weight', '650');
  }
  const placement = await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;
    const state = window.__DIVEATLAS_TEST__.getState().popup;
    const anchor = map.latLngToContainerPoint([-5, 130]);
    const mapRect = map.getContainer().getBoundingClientRect();
    const anchorY = mapRect.top + anchor.y;
    const popupHeight = state.bounds.bottom - state.bounds.top;
    const preferredSide = innerWidth <= 720 ? 'above' : 'below';
    const fitsAbove = anchorY - popupHeight - 24 >= state.safeBounds.top;
    const fitsBelow = anchorY + popupHeight + 24 <= state.safeBounds.bottom;
    return { preferredSide, fitsAbove, fitsBelow, arrowSide:state.arrowSide };
  });
  const expectedSide = placement.preferredSide === 'above' ? 'bottom' : 'top';
  const alternateSide = placement.preferredSide === 'above' ? 'top' : 'bottom';
  if (placement.preferredSide === 'above' ? placement.fitsAbove : placement.fitsBelow) {
    expect(placement.arrowSide).toBe(expectedSide);
  } else if (placement.preferredSide === 'above' ? placement.fitsBelow : placement.fitsAbove) {
    expect(placement.arrowSide).toBe(alternateSide);
  }

  for (const [rowLabel, popupSelector] of [
    ['Regional current:', '.regional-currents-popup'],
    ['Typical wave height:', '.waves-popup']
  ]) {
    await popup.getByRole('button', { name: new RegExp(rowLabel) }).click();
    const metricPopup = page.locator(popupSelector);
    await expect(metricPopup).toBeVisible();
    await expect(metricPopup.locator('.dive-conditions-popup-back')).toBeVisible();

    const metricPlacement = await page.evaluate(() => {
      const state = window.__DIVEATLAS_TEST__.getState().popup;
      const preferredSide = innerWidth <= 720 ? 'above' : 'below';
      const anchorY = state.anchorY;
      const popupHeight = state.bounds.bottom - state.bounds.top;
      const fitsAbove = anchorY - popupHeight - 24 >= state.safeBounds.top;
      const fitsBelow = anchorY + popupHeight + 24 <= state.safeBounds.bottom;
      return { preferredSide, fitsAbove, fitsBelow, arrowSide:state.arrowSide };
    });
    const preferredArrow = metricPlacement.preferredSide === 'above' ? 'bottom' : 'top';
    const alternateArrow = metricPlacement.preferredSide === 'above' ? 'top' : 'bottom';
    if (metricPlacement.preferredSide === 'above' ? metricPlacement.fitsAbove : metricPlacement.fitsBelow) {
      expect(metricPlacement.arrowSide).toBe(preferredArrow);
    } else if (metricPlacement.preferredSide === 'above' ? metricPlacement.fitsBelow : metricPlacement.fitsAbove) {
      expect(metricPlacement.arrowSide).toBe(alternateArrow);
    }

    await page.locator('html').evaluate(node => { node.dataset.theme = 'dark'; });
    const backButton = metricPopup.locator('.dive-conditions-popup-back');
    await backButton.hover();
    await expect(backButton).toHaveCSS('background-color', 'rgb(32, 52, 71)');
    await backButton.click();
    await expect(popup).toBeVisible();
  }

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
  await popup.locator('.dive-experience-score-info > summary').focus();
  await page.keyboard.press('Escape');
  await expect(infoTooltip).toBeHidden();
  await page.getByRole('button', { name: 'Close outlook popup' }).click();
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
