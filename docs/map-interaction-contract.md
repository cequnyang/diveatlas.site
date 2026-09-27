# DiveAtlas map interaction contract

This document records the map behaviors that automated tests enforce. The purpose is to keep interaction semantics consistent across map layers, input devices, and popup changes; it is not permission to change those behaviors without an explicit product request.

## Behavior contract

### Aggregates and individual features

- A count-bearing aggregate represents navigation to more detail. It uses a zoom-in cursor on desktop and zooms or expands on click/tap. It never opens an individual detail popup.
- An exact, individual feature uses a pointer cursor on desktop and opens its own details on click/tap. It never invokes aggregate zoom.
- These rules follow feature semantics, not marker shape or layer color. Coral, Fish, and Dive aggregates and individual features share the same decision resolver.

### Interaction eligibility

A feature can receive an interaction only while its owning layer is enabled, its representation is active at the current zoom, the feature is still attached to the active map layer, and its geometry is visible and hit-testable. Data kept in memory, hidden Coral cells, and point geometry outside its display mode do not qualify.

### Depth inspection and gestures

- Depth contours visualize bathymetry; they do not handle inspection input.
- Desktop right-click in the map requests Depth Inspection. Context menus outside the map keep normal browser behavior.
- A mobile/pen long press on empty map space requests Depth Inspection. A short tap does not. Dragging, a second pointer, and a cancelled pointer do not become a depth request.
- A normal click/tap on empty ocean does not open Depth Inspection.
- One physical activation may produce at most one semantic action, even if the browser synthesizes a click after touch input.

### Hover behavior

- Hover tooltips are transient and must never pan, recenter, or zoom the map.
- Placement is selected before the tooltip is displayed: above when it fits, below when the upper space is blocked, and horizontal body adjustment when needed.
- User map navigation closes hover tooltips. Leaving a feature closes its tooltip without changing map center or zoom.

### Popup placement and movement

- A persistent popup stays associated with its geographic anchor. Choose placement before its first visible frame: above by default, below when vertical space above is insufficient, and the existing fallback only when neither side fits.
- The popup body may shift horizontally to remain visible; the geographic anchor and map center do not change for horizontal correction. The arrow remains aligned to the anchor.
- Click popups may use the shared vertical auto-pan fallback. That internal movement does not dismiss the popup. Hover placement never moves the map.
- User drag, wheel/pinch, and zoom may revalidate a persistent popup. Keep it while its owning feature remains valid and its anchor is in the usable viewport; close it when either condition stops being true.
- Opening a different popup makes it the sole current owner. Delayed work from an older popup cannot change the current popup's placement or lifecycle.

### Popup dismissal and ownership

- During closing, freeze placement, arrow direction, and horizontal arrow offset. Reset them only after that popup has completely closed.
- A popup remains valid only while its geographic anchor is in the usable viewport and its owning layer/feature/representation remains valid. Turning a layer off or changing Coral representation closes an invalid popup and clears its hover state.

## Test architecture

`js/map-interaction-contract.js` contains the small pure decisions shared by the map and Node's built-in test runner. Browser tests use `@playwright/test`, a local Python static server, a fixed view, and the actual Leaflet event and popup infrastructure. A `window.__DIVEATLAS_TEST__` hook exists only when both conditions hold: the page is served on `localhost`/`127.0.0.1` and the URL includes `__diveatlas_test=1`. It adds deterministic in-memory fixtures; it does not replace event handlers, popup placement, the popup manager, or production data.

The fast required matrix is Chromium desktop plus Chromium with a Pixel 7 touch profile. It covers marker semantics, Coral visibility and representation, empty-map/depth interactions, hover stability, vertical and horizontal popup boundaries, lifecycle ownership, layer invalidation, and one-action activation. The multi-touch and long-press browser cases exercise Pointer Events in a mobile emulation; they are not a claim of native Android or iOS browser verification. Keep a real-device check for OS-specific touch/context-menu differences when those platform behaviors change.

Popup screenshots are scoped to the popup element rather than the map tiles. Screenshot diagnostics, traces, and video are retained on failure in `test-results/`.

## Commands

From the repository root:

```powershell
npm ci
npx playwright install chromium
npm run test:unit
npm run test:e2e
npm run test:interactions
```

`npm run test:unit` is the fastest decision-logic check. `npm run test:e2e` runs the required desktop and touch browser projects. `npm run test:interactions` runs unit tests, the test-policy guard, static artifact validation, and the full browser suite; this is the local CI-equivalent command. GitHub Actions installs Chromium with its Linux system dependencies before running that suite.

The site has no bundler or type checker. `npm run build` validates local HTML references and assembles the static Pages artifact into ignored `_site/`; there is no separate lint/typecheck command in the existing project.

## CI and deployment gate

`.github/workflows/map-interactions.yml` runs the required suite on pull requests and pushes to `main`. The GitHub Pages deployment job depends on that suite, so a test or static-build failure prevents that workflow from publishing. For this gate to control the live site, repository Pages settings must use **GitHub Actions** as the deployment source; branch-based Pages publishing would bypass this workflow. The workflow's required check should also be enabled in branch protection for `main` so failing pull requests cannot merge.

## Test policy

When an existing interaction regression test fails after a code change:

1. Assume the implementation is wrong first.
2. Do not delete, skip, weaken, broaden tolerances, or rewrite the expected behavior merely to make CI pass.
3. A regression test may be changed only when the requested product behavior explicitly changes.
4. Any such test change must be explained in the implementation report.

Critical tests must not silently become skipped, todo, fixme, conditional skips, or focused-only tests. `tools/check_interaction_test_policy.js` enforces the required behavior names and rejects those escape hatches in the critical suite.
