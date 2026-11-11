# Raja Ampat destination overview

The Raja Ampat landing page uses three compact sections: overview, seasonal conditions and selected sites. Repeated highlight copy and the separate promotional banner were removed to reduce scanning and scrolling. The inline month wheel updates short condition summaries; detailed provenance remains in the expandable “Source & limitations” note. The page does not claim live conditions or a best month.

## Preview locally

```powershell
node tools/render_destination_map.cjs
python -m tools.preview_raja_ampat
python -m http.server 8796 --bind 127.0.0.1
```

Open [the local Raja Ampat page](http://127.0.0.1:8796/regions/indonesia/raja-ampat/). The scoped regeneration command writes only this landing page. The normal SEO generator also renders it, so the design survives subsequent builds. Pagination and other destinations retain their existing layouts.

## Shared components and scope

- `tools/destination_overview.py` provides the editorial content and layout; `generate_region_page` opts in only the Raja Ampat landing URL.
- Header/search/theme/language/share controls come from the shared header, without a second controller. `data-detail-scroll` opts into its existing synchronized document rail while keeping window scrolling authoritative.
- Surfaces and buttons use the shared `detail-page`, `detail-section`, `seo-primary-button`, `seo-secondary-button` classes and theme tokens. Layout overrides are destination-scoped.
- Shortlist cards use `recommendation_card_link` with the detail explorer’s shared immersion-card styles: assigned photo, overlaid name/location/features and the existing rating loader. The same thumbnail enhancement preserves reviewed-photo credits. The inline layout has three desktop columns and one mobile column.
- `scroll-wheel.js` enhances a native select and emits normal `change` events. Seasonal content is handled separately by `destination-overview.js`; no detached prototype buttons or duplicated content callbacks are retained. The existing map wheel is embedded in the map application and cannot be imported independently; this inline control does not add that map application as a dependency.
- Without JavaScript, the labeled November reference, credited photo and directory still render; the inactive month picker is hidden.

## Content provenance

The existing destination photo and its credit/source/license links are retained in a credited overlay on the hero image, without reassignment or a new rights determination. Shortlist cards reuse existing site photo assignments and their credits; no new assignment is inferred. Selection uses the three existing Cape Kri, Blue Magic and Arborek Jetty records and their recorded features; it implies no verified difficulty, quality rank or access guarantee.

Seasonal notes reference [Biodiversity Eco Resort](https://rajaampatbiodiversity.com/dive-into-raja-ampat/), consulted 11 November 2026. Its annual surface temperature and seasonal visibility descriptions are local operator experience, not a measured destination-wide climatological series, monthly dive-depth measurements or live data. Missing numeric ranges remain unavailable. November is the initial reference, not a recommended month. No numeric current strength is inferred.

## Verification

```powershell
python -m unittest tests.unit.test_site_header_assets tests.unit.test_destination_overview tests.unit.test_dive_site_details -q
$env:PLAYWRIGHT_PORT='8796'
node node_modules/@playwright/test/cli.js test tests/e2e/destination-overview.spec.js --workers=1
node node_modules/@playwright/test/cli.js test tests/e2e/dive-site-detail.spec.js --grep 'detail scrollbar starts below' --workers=1
```

The focused checks cover landing-page scope, continuation links, shared header assets, wheel keyboard/scroll changes, both scroll-rail directions, no-JavaScript content and desktop/touch browser layouts. Review screenshots are under `artifacts/raja-ampat-plan-a-20261111/`. This AI-assisted implementation is kept local for review; publication is a separate owner action.

The full site list, pagination and other-country-destinations block are removed from this landing page at owner request. Their existing continuation URLs remain unchanged; the map action remains available. The removed sections have no dangling in-page links.

The destination header uses the shared cinematic detail-page hero stylesheet and markup: a full-width photograph with theme-aware fade and overlaid breadcrumb/title. The summary is inside the conditions container; the clickable map inset replaces the separate map button. The detail recommendation explorer controller and detail-record modules are not loaded.

## Static map inset

The upper-right hero inset is a 600×600 PNG shown at 275px on desktop and 150px on mobile. Coastlines, place labels, the destination marker and compass rose are rendered at build time. The page loads a normal image and a link; it does not initialize another map or request map tiles for this inset. The shared layout now covers all 461 eligible destination landing pages. Raja Ampat retains its sourced editorial seasonal profile.

`node tools/render_destination_map.cjs` reads the existing region index, fits the region's recorded coordinate bounds and draws the mean coordinate as a destination marker. This is an area reference, not a claimed individual dive-site location. The main-map link uses the exported camera. The renderer uses OpenFreeMap's Positron style via MapLibre in a temporary headless browser, limits provider concurrency to four, and fails on missing map resources rather than caching a partial render.

Images and the manifest are under `assets/destination-maps/`. The fingerprint includes coordinates/framing, style JSON hash, renderer version, image size and compass/marker revision. Repeating the command with unchanged inputs reuses the PNG; `--force` explicitly refreshes it. Provider tile data is intentionally frozen in the cached image until refresh. Change the input revision when changing rendering code or framing rules. Required OpenMapTiles/OpenStreetMap attribution is supplied by a single linked label over the map’s bottom-right corner; the PNG must be displayed with that attribution, which is also recorded in its manifest. The redundant lower title/credit panel is removed. Photo attribution remains separate at the hero's bottom-right.

## Languages

The existing header language preference and `diveatlas:language-change` event drive the destination's 15-language catalog in `js/destination-overview-i18n.js`. Simplified and Traditional Chinese have separate destination copy. `Intl.DateTimeFormat` supplies month labels; Breadcrumb geography names retain their recorded identity and use the shared translator where available. The chosen month survives language switches; a reload restores the saved language and the explicit November reference.

The destination main opts out of the shared automatic text walker because this controller owns its copy. Recorded site names, source-photo credits and static basemap labels remain source values. Feature tags and rating states reuse the shared detail translator. A wheel-label refresh event updates option text and accessible names without rebuilding the wheel or changing its scroll position. Conditions subscribe to the destination-language-ready event so switching months never reintroduces English into a translated panel. Missing locale assets retain English condition copy.

Focused browser checks switch through all 15 header options on desktop and touch browsers, verify month preservation and saved-language reload, and check layout overflow. Additional visual checks cover German, French, Russian and Traditional Chinese at 320px, 390px and 1440px.


## Destination rollout

The shared generator applies this layout to every eligible destination landing page (at least three recorded sites). Site detail pages and directory continuation URLs keep their own templates. No deployment or Git publication is part of this rollout.

For destinations without an editorial profile, all four conditions explicitly show unavailable values and the month wheel is absent. This avoids presenting another region’s seasonal guidance as local evidence. Adding a sourced profile later should explicitly opt into monthly controls; merely having site coordinates is insufficient.

A deterministic greedy selection maximizes newly covered recorded features, with name and ID as stable tie breakers and canonical identities deduplicated. It supplies three starting cards without implying a quality or suitability rank. Raja Ampat keeps its editorial shortlist. Existing destination and site photo assignments and credits are preserved.

Reproduce the local rollout without regenerating unrelated site pages:

```powershell
python -m tools.preview_destinations
node tools/render_destination_map.cjs --all
python -m tools.preview_destinations
```

The first pass writes the map jobs; the last includes the cached maps in HTML. The batch renderer shares one browser, limits provider requests to four concurrently, caches responses within 40 MB, retries failed views, and writes a render report under `artifacts/destination-layout-rollout-20261111/`. Cache fingerprints include coordinates, framing, style and renderer revisions. Longitude bounds use the shortest occupied arc so destinations across the date line do not receive a near-worldwide framing. A manifest and 600×600 PNG are stored per destination; the page requests no inset tiles at runtime. Do not remove the linked attribution when reusing these images.

The generic summary, unavailable states, map descriptions and starting-selection labels are translated into the same 15 supported languages. Recorded place and site names, map labels and credits remain source values. The no-month layout uses four columns on desktop and two on narrow screens without reserving an empty wheel column.


## Mobile and language review — 11 November 2026

A local browser scan covered all 461 destinations at 320px. A separate matrix covered 24 destinations (including long names and different geographies), all 15 supported languages, and widths of 320, 390 and 720px: 1,080 combinations. The checks found no horizontal overflow, missing destination-copy updates, title/map collisions or card-name/rating collisions after the fixes. This is layout and locale-switch verification, not a linguistic review of every translation or verification of recorded place names.

Long mobile destination headings now participate in document flow beneath the map rather than growing upward into it; names longer than 24 characters use a responsive 36–48px heading size. Mobile recommendation cards grow with full recorded names and translated feature labels, reserving space above them for ratings. These overrides are destination-scoped so site-detail recommendation styling remains shared and unaffected. Card accessibility labels reuse the detail translator.

Reports and German, Traditional Chinese and Japanese review screenshots are in `artifacts/destination-mobile-review-20261111/`. Browser regression checks are in `tests/e2e/destination-overview.spec.js`. Changes remain local for owner review.
