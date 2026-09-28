# DiveAtlas visual QA

Use the repository's canonical browser environment before comparing Layers panel geometry or screenshots. The viewport numbers below are CSS pixels; DPR controls how those CSS pixels are rasterized into screenshot pixels.

## Canonical desktop environment

| Property | Value |
| --- | ---: |
| `window.innerWidth` × `window.innerHeight` | 1408 × 840 CSS px |
| `devicePixelRatio` | 2 |
| `visualViewport.scale` | 1 (100% zoom) |
| `screen.width` × `screen.height` | 1536 × 960 |
| root font size | 16 px |

The desktop Playwright project uses this viewport, screen, and DPR. The mobile project retains its device profile. If Microsoft Edge is installed, set `VISUAL_QA_CHANNEL=msedge` before running Playwright or the helper to use that browser channel; do not spoof the user agent to simulate another browser engine.

## Measure the panel

Run:

```sh
npm run visual:qa
```

The helper opens DiveAtlas in a headless Playwright Chromium context, waits for `document.fonts.ready`, and reports the browser environment, panel font load state, applicable Layers-related media queries, and `getBoundingClientRect()` values for the panel, header, view selector, Temperature controls, legend, overlay rows, and switches. It reveals the Temperature controls for layout measurement without selecting that view through the application controller, so the measurement does not initiate temperature-data loading.

To save a calibrated screenshot after those checks pass:

```sh
npm run visual:qa -- --screenshot artifacts/visual-qa/layers-panel.png
```

Capture both theme variants at the same calibrated viewport by setting the panel's existing theme state explicitly:

```sh
npm run visual:qa -- --theme dark --screenshot artifacts/visual-qa/layers-panel-dark.png
npm run visual:qa -- --theme light --screenshot artifacts/visual-qa/layers-panel-light.png
```

The report includes the resolved panel, selector, field, and overlay text colors alongside the same geometry measurements. The theme option changes only the application theme attribute for this visual check; it does not invoke the map theme transition or load a temperature dataset.

The helper skips screenshot capture if the viewport, DPR, zoom, root font size, expected Edge user agent, or Outfit font fails its calibration check. Captured images use Playwright's `scale: 'css'`, so their pixel dimensions remain 1408 × 840; DPR 2 remains recorded separately. Its default report-only run still records failures so environment differences are visible before anyone tunes CSS.

## Browser engine note

Playwright uses its installed Chromium build; setting viewport and DPR does not make that binary Edge 154. The report includes the actual user agent and loaded font face so differences in browser build or font availability remain explicit. Use the same Playwright/browser installation when collecting future before/after comparisons.
