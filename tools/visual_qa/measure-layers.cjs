const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium, devices } = require('@playwright/test');
const { targetEnvironment, previousPlaywrightDesktop } = require('./config.cjs');

const projectRoot = path.resolve(__dirname, '../..');
const profileName = process.argv.includes('--previous-playwright') ? 'previous-playwright' : 'target';
const profile = profileName === 'previous-playwright' ? previousPlaywrightDesktop : targetEnvironment;
const screenshotFlag = process.argv.indexOf('--screenshot');
const screenshotPath = screenshotFlag >= 0 ? path.resolve(process.argv[screenshotFlag + 1] || 'artifacts/visual-qa/layers-panel.png') : null;
const themeFlag = process.argv.indexOf('--theme');
const forcedTheme = themeFlag >= 0 ? process.argv[themeFlag + 1] : null;
if (forcedTheme && !['light', 'dark'].includes(forcedTheme)) {
  throw new Error('--theme must be followed by "light" or "dark".');
}
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.webp', 'image/webp'], ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'], ['.txt', 'text/plain; charset=utf-8']
]);

function startStaticServer() {
  const server = http.createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }

    const filePath = path.resolve(projectRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (filePath !== projectRoot && !filePath.startsWith(`${projectRoot}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    fs.stat(filePath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': contentTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(filePath).pipe(response);
    });
  });

  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
  }));
}

async function readGeometry(page) {
  return page.evaluate(() => {
    const selectors = {
      panel: '#bioLegend',
      header: '#bioLegendHeading',
      viewSelector: '.environment-segment-group',
      temperatureSection: '#temperatureControls',
      temperatureHeading: '.temperature-heading',
      depthSelect: '#temperatureDepth',
      monthSelect: '#temperatureMonth',
      temperatureLegend: '#temperatureLegend'
    };
    const rect = element => {
      if (!element) return null;
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
      return Object.fromEntries(Object.entries({ x, y, width, height, right, bottom }).map(([key, value]) => [key, Math.round(value * 100) / 100]));
    };
    const matchingRules = new Map();
    const relevantSelector = /bio-legend|environment-|temperature-|layer-toggle|map-data-heading/i;

    function visit(rules, parentConditions = []) {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule) {
          const matching = [];
          function findRelevant(nestedRules) {
            for (const nested of nestedRules) {
              if (nested instanceof CSSStyleRule && relevantSelector.test(nested.selectorText)) matching.push(nested.selectorText);
              if (nested.cssRules) findRelevant(nested.cssRules);
            }
          }
          findRelevant(rule.cssRules);
          if (matching.length) {
            const conditions = [...parentConditions, rule.conditionText];
            const key = conditions.join(' and ');
            const result = matchingRules.get(key) || {
              conditions,
              active: conditions.every(condition => matchMedia(condition).matches),
              selectors: new Set()
            };
            matching.forEach(selector => result.selectors.add(selector));
            matchingRules.set(key, result);
          }
          visit(rule.cssRules, [...parentConditions, rule.conditionText]);
        } else if (rule.cssRules) {
          visit(rule.cssRules, parentConditions);
        }
      }
    }

    for (const sheet of document.styleSheets) {
      try { visit(sheet.cssRules); } catch (_) { /* Cross-origin stylesheets are not inspectable. */ }
    }

    const panel = document.querySelector('#bioLegend');
    const panelStyle = panel ? getComputedStyle(panel) : null;
    const fontFaces = [...document.fonts].map(face => ({ family: face.family, status: face.status, weight: face.weight }));
    return {
      theme: document.documentElement.dataset.theme ?? null,
      browser: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        devicePixelRatio: window.devicePixelRatio,
        visualViewportScale: window.visualViewport?.scale ?? null,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
        bodyFont: getComputedStyle(document.body).fontFamily,
        userAgent: navigator.userAgent
      },
      fonts: {
        intendedPanelFont: 'Outfit, sans-serif',
        computedPanelFont: panelStyle?.fontFamily ?? null,
        outfit500Loaded: document.fonts.check('500 16px Outfit'),
        outfitFaces: fontFaces.filter(face => /outfit/i.test(face.family) && face.status === 'loaded')
      },
      mediaQueries: [...matchingRules.values()].map(({ conditions, active, selectors }) => ({
        conditions,
        active,
        selectorCount: selectors.size,
        selectorExamples: [...selectors].slice(0, 4)
      })),
      geometry: {
        panel: rect(document.querySelector(selectors.panel)),
        header: rect(document.querySelector(selectors.header)),
        headerItems: Object.fromEntries([
          ['titleIcon', '.bio-legend-title-icon'],
          ['titleText', '.bio-legend-title-label'],
          ['layersControl', '#bioLegendTitle'],
          ['collapseIcon', '.bio-legend-title-chevron'],
          ['filterButton', '#bioLegendBulkAction'],
          ['filterIcon', '#bioLegendBulkAction .layer-filter-icon'],
          ['filterLabel', '#bioLegendBulkAction .bulk-action-label'],
          ['overflow', '#bioLegendOverflow > summary']
        ].map(([key, selector]) => {
          const box = rect(document.querySelector(selector));
          return [key, box && { ...box, centerY: Math.round((box.y + box.height / 2) * 100) / 100 }];
        })),
        viewSelector: rect(document.querySelector(selectors.viewSelector)),
        temperatureSection: rect(document.querySelector(selectors.temperatureSection)),
        temperatureHeading: rect(document.querySelector(selectors.temperatureHeading)),
        depthSelect: rect(document.querySelector(selectors.depthSelect)),
        monthSelect: rect(document.querySelector(selectors.monthSelect)),
        temperatureLegend: rect(document.querySelector(selectors.temperatureLegend)),
        overlayRows: [...document.querySelectorAll('.bio-legend-row')].map(rect),
        switches: [...document.querySelectorAll('#bioLegend .layer-toggle-switch')].map(rect)
      },
      appearance: {
        panel: panel ? {
          backgroundColor: panelStyle.backgroundColor,
          backgroundImage: panelStyle.backgroundImage,
          borderColor: panelStyle.borderTopColor,
          color: panelStyle.color,
          colorScheme: panelStyle.colorScheme,
          boxShadow: panelStyle.boxShadow
        } : null,
        viewSelector: (() => {
          const element = document.querySelector('.environment-segment-group');
          if (!element) return null;
          const style = getComputedStyle(element);
          const activeSegment = getComputedStyle(element, '::before');
          return { backgroundColor: style.backgroundColor, borderColor: style.borderTopColor, activeBackground: activeSegment.backgroundColor, activeBorderColor: activeSegment.borderTopColor };
        })(),
        depthSelect: (() => {
          const element = document.querySelector('#temperatureDepth');
          if (!element) return null;
          const style = getComputedStyle(element);
          return { backgroundColor: style.backgroundColor, borderColor: style.borderTopColor, color: style.color, colorScheme: style.colorScheme };
        })(),
        overlayText: getComputedStyle(document.querySelector('.bio-legend-row .legend-label') || panel).color
      }
    };
  });
}

async function main() {
  const { server, url } = await startStaticServer();
  let browser;
  try {
    const descriptor = profileName === 'previous-playwright' ? devices['Desktop Chrome'] : {};
    browser = await chromium.launch({ headless: true, channel: process.env.VISUAL_QA_CHANNEL || undefined });
    const context = await browser.newContext({
      ...descriptor,
      viewport: profile.viewport,
      screen: profile.screen,
      deviceScaleFactor: profile.deviceScaleFactor
    });
    const page = await context.newPage();
    await page.goto(`${url}?__diveatlas_test=1`, { waitUntil: 'domcontentloaded' });
    await page.locator('#bioLegend').waitFor({ state: 'visible' });
    await page.evaluate(async () => { await document.fonts.ready; });
    if (forcedTheme) {
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
      }, forcedTheme);
    }

    // Reveal the real controls for geometry measurement without changing the selected view
    // or invoking activation, data fetching, or map-layer side effects.
    await page.evaluate(() => {
      document.querySelector('#tutorialBackdrop').hidden = true;
      const controls = document.querySelector('#temperatureControls');
      controls.hidden = false;
      controls.inert = false;
      controls.setAttribute('aria-hidden', 'false');
      controls.classList.add('is-open');
      document.querySelector('input[name="environmentView"][value="temperature"]').checked = true;
    });
    await page.waitForTimeout(300);
    const report = await readGeometry(page);
    report.profile = profileName;
    report.calibration = {
      viewportMatches: report.browser.innerWidth === profile.viewport.width && report.browser.innerHeight === profile.viewport.height,
      clientAreaMatches: report.browser.clientWidth === profile.viewport.width && report.browser.clientHeight === profile.viewport.height,
      screenMatches: report.browser.screenWidth === profile.screen.width && report.browser.screenHeight === profile.screen.height,
      dprMatches: report.browser.devicePixelRatio === profile.deviceScaleFactor,
      zoomMatches: Math.abs((report.browser.visualViewportScale ?? 0) - profile.zoom) < 0.01,
      rootFontMatches: report.browser.rootFontSize === profile.rootFontSize,
      bodyFontMatches: !profile.bodyFont || report.browser.bodyFont === profile.bodyFont,
      // Headless Edge adds "Headless" to the Chromium product token while retaining
      // the same Edge build; normalize only that rendering-mode marker for comparison.
      browserBuildMatches: !profile.userAgent || report.browser.userAgent.replace('HeadlessChrome/', 'Chrome/') === profile.userAgent,
      screenshotCaptured: false
    };

    if (screenshotPath) {
      const environmentMatched = Object.entries(report.calibration)
        .filter(([key]) => key.endsWith('Matches'))
        .every(([, matched]) => matched);
      if (!environmentMatched || !report.fonts.outfit500Loaded) {
        throw new Error('Screenshot skipped: viewport, DPR, zoom, root font size, browser build, or Outfit font failed calibration.');
      }
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: false, scale: 'css' });
      report.calibration.screenshotCaptured = true;
      report.calibration.screenshotPath = screenshotPath;
    }

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
