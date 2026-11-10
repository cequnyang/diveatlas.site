# Map welcome

The first-visit guide connects three steps: explore a destination on the real map, choose a travel month, and start exploring. It reuses the original tutorial's branded header, glass material, typography, close control and footer buttons.

The destination and month steps share a compact frame beside the real map, so the month step keeps the destination step’s width, height and position. The month field reuses the Layers panel’s existing `createTemperatureWheelSelector`, including scrolling, keyboard controls, localization and theme. Its wheel is portaled outside the guide; navigation and dismissal close it while retaining the chosen month. Destination context uses a small full-width card rather than a large side column. Its editable search field uses area search in the existing shared results menu. Country, region and ocean-area labels are grouped from the loaded dive-site catalogue and location metadata. Pointer or keyboard selection fits the real map to the area’s mapped-site extents and never opens a dive-site popup or phone detail sheet. The header defaults to ordinary dive-site search and offers Areas / Dive sites modes in the same menu. Dive-site filters apply to site mode; area lookup remains geographic. Results are paged to keep the panel usable on phones. Visitors can also pan and zoom normally. Use this map area advances to the month step, then Next shows the plan. Month changes immediately update the shared saved Layers setting; Start exploring opens Outlook for that month without relocating the map. Coordinates describe the viewport center, not a named destination or a clicked site. The area stays live across steps; the area index is derived from the existing catalogue without an external geocoder or new geographic dataset. Extents describe mapped sites, not official administrative boundaries; matching uses the catalogue’s recorded names.

Starting an area lookup or choosing a new search result cancels the previous site's pending popup timer and move-completion listener. Area selection also stops its old map animation before fitting the new extent. This prevents an old site sheet from appearing over the guide after the new destination has already been chosen.

Large-area fitting temporarily permits an overview below the normal zoom floor of 2. The fitted zoom becomes the overview's lower bound; zooming back to 2 or beyond restores the normal floor. The site's ordinary point navigation, maximum zoom and global vertical map bounds remain owned by the existing map controls. Browser regression checks inspect all recorded Pacific Ocean positions independently, including dateline world copies, and cover portrait and landscape layouts.

The month entry follows the owning Outlook capability: setting `window.DIVEATLAS_FEATURE_FLAGS.diveExperienceOutlook` to `false` hides it. Destination, direct map and layer-guide access remain available. Leaving the flag unset preserves the default enabled month flow. The capability is passed into the welcome by the map page so both interfaces use the same flag interpretation.

The panel is nonmodal: it does not dim the map, trap keyboard focus, or steal focus on load. Close, Skip to map, and Escape from inside the panel dismiss it and focus the Layers button. On phones the zoom/location controls stay above the guide. At heights of 500px or less, the whole guide scrolls so its header/footer cannot collapse the month area; the compact map step leaves room beside it for map controls. Layer guide is a detour: closing the reference returns to the same planning step and month. The reference remains available from the existing Layers menu too.

The existing `global-coral-map-tutorial-suppressed-v1` preference suppresses automatic welcome display. The welcome saves checkbox changes immediately, follows suppression changes from another tab, and reads back changes from the layer guide when returning. Dismissal writes checked and unchecked states, so clearing the option removes suppression. As before, closing without that preference allows automatic display on a later page load. Shared map URLs bypass the welcome. The existing layer tutorial's localization is retained; welcome copy follows the same 14 supported language keys, with an English fallback.

Guide implementation lives in `js/map-welcome.js` and `assets/map-welcome.css`, with geographic grouping/matching in `js/area-search.js`; `index.html` connects it to map movement, search, language, suppression and the environmental view. Shared tutorial/glass styles own appearance, while welcome CSS owns layout. No package or setup changes are needed: serve with `node tools/serve_test_site.js --port=8879` and open `http://127.0.0.1:8879/`.

## Verification

The month control initializes from the saved layer setting, and changes from either month field update the other plus the review summary. Language changes retain the selected month and localize coordinate formatting. Area selection updates the guide’s selected area without transferring focus. Specific dive-site names remain separate from the guide’s area query; ordinary header site selection still opens its native detail popup. The shared language menu reports its expanded state on the guide trigger and returns focus there when opened from the guide.

The guide input and header input share the existing `#diveSearchResults` menu and its renderer, styles, pagination, highlighting, suggestion entry, mobile handle, and keyboard state. The guide has no separate results menu. Area mode supplies geographic entries through the same menu shell, pagination and keyboard-selection state. The active input owns the query and ARIA state; switching inputs cancels pending work before handing off the menu. Typing in the guide does not focus or overwrite the header. The existing menu is anchored at the guide field during that session, leaving the guide's dimensions unchanged; its body portal avoids guide clipping. Placement follows scrolling/resizing and opens above when space below is limited. Selection, clearing, Escape and outside clicks dismiss results.

Run the relevant desktop and mobile browser checks with:

```powershell
$env:PLAYWRIGHT_PORT = '8879'
npx playwright test tests/e2e/shared-header.spec.js --grep 'welcome|tutorial language|glass popup interactions|header destination|header offers area' --output=artifacts/onboarding-b-tests
node tools/check_interaction_test_policy.js
node --check js/map-welcome.js
node --test tests/unit/area-search.test.js
```

These cover inline typing, pointer/keyboard result selection, pagination, empty queries, unavailable data and stale async responses; real map dragging; viewport updates across steps; month retention through Back and the layer-reference detour; month application without relocation; disabled Outlook; suppression in both directions; direct skip and shared links. Landscape tests use pointer clicks on the month selector and footer at 844×390 and 568×320. Existing tutorial language-popover checks continue on desktop and mobile. Historical conditions remain estimates rather than live conditions or safety ratings.

Implementation and verification were prepared with AI assistance for human review.
