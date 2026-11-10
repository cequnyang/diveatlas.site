# Shared search results menu

The map, its welcome guide, dive-site details, directories and ordinary documents
use `js/search-results-menu.js` and `assets/search-results-menu.css` for their
search results UI. Change these files to update the menu on every page.

Previously, a shared header concealed two separate results menus. Layout and
behavior changes could reach the map while leaving other pages unchanged. The
component now owns tab markup, result rows, highlights, empty/loading states,
active-option accessibility, keyboard and pointer selection, pagination controls,
filter pickers, responsive geometry and mobile handle gestures.

## Use

Create one menu for an existing results surface and supply its input and selection
handler. Feed it plain result models using `render`; do not build option HTML in a
page controller. `updateModes`, `syncFilters` and `position` update the same UI for
every host. `bindMobileHandle` and `bindPullPagination` install the shared gestures.

```js
const menu = window.DiveAtlasSearchResultsMenu.create({
  surface, scroll, slot, filterToggle,
  getInput: () => input,
  onSelect: index => selectResult(matches[index]),
  onMode: mode => updateSearch(mode),
  onLoadMore: () => loadNextPage()
});
menu.render({
  query: input.value.trim(), total: matches.length, moreLabel: 'Load more',
  items: matches.slice(0, window.DiveAtlasSearchResultsMenu.pageSize)
    .map(result => ({name: result.name, meta: result.description}))
});
```

The map adapter in `index.html` retains lazy dataset loading, localized search
data and the selected-value model shared with the Layers panel. The document
adapter in `js/seo-site-search.js` supplies its recommendation catalog. These
data sources do not own result DOM or menu styling. Navigation stays outside the
component: map selections fit an area or open a marker, while document selections
navigate to the appropriate record or map URL.

Result text and data attributes are escaped by the component. `badgeHtml` is
reserved for the existing trusted localized-name badge builder, never catalog
text. Selection checks the rendered query against the current input, so a late
response cannot select an obsolete result. Refreshing the same document query
retains the active record by identity rather than silently discarding keyboard
selection.

## Loading and verification

The map loads the script before its main controller. The shared header loads the
stylesheet for document pages, and their search adapter imports the script.
`tools/site_header_assets.py` and `tools/generate_seo_pages.py` version the assets
for generated and cached HTML. No package or build dependency is required.

The search cases in `tests/e2e/shared-header.spec.js` cover the map and welcome
guide. Those in `tests/e2e/dive-site-detail.spec.js` cover generated document and
directory shells, record navigation, catalog refresh and mobile gestures. Run
them through Playwright's desktop and mobile projects. Header asset installation
and idempotence are checked by `tests.unit.test_site_header_assets`.
