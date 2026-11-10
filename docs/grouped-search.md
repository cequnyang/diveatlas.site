# Destination-first search

Header search shows matching destinations above dive sites in one dropdown. Visitors can explore a known area without knowing individual site names, while exact site-name searches retain the existing site ranking. Groups have screen-reader labels, without visible section titles. Individual site rows omit pin icons, arrows and separators; destinations retain the map icon and a separating rule.

Search for `Raja Ampat` to see an `Explore Raja Ampat` result and its current mapped-site count, followed by individual matches. Search for `Blue Magic` to go directly to site results. Active country, difficulty and feature filters apply to both groups.

## Interaction and navigation

- Arrow keys move through a continuous option list across both groups. Enter activates the highlighted option. Escape dismisses the dropdown.
- On the map, a destination fits its matching sites' extent and updates the existing area guide. It does not open an individual-site popup. Site selection retains marker/detail navigation.
- On detail and document pages, destinations navigate to the area on the map. Site selection retains the host's existing destination: record details from a detail page, or the selected map site from a directory/document.
- Loading and unavailable states distinguish pending catalog data from a completed search with no matches. Empty searches retain the existing filter/prompt behavior. Async results are rendered for the current query.

## Design constraints

Show three destination suggestions initially, then a “Show all N destinations” option when more match. Activating it opens a separate destination-only view with the normal 20-option pagination, rather than rendering thousands of destinations above individual sites. A sticky “Back to results” option restores the mixed list. Both actions participate in arrow-key navigation: entering the destination view highlights its first destination, and returning highlights the expansion action. A new query or changed filters resets the preview. Counts and destination extents use the same filtered site indices, and never imply administrative boundaries. Counts are derived at runtime rather than hard-coded from a design sample.

Same-name destinations retain their geographic scope. For example, `Red Sea` can be an ocean area, an Egyptian region, or a region whose country was not recorded. The subtitle distinguishes these using area type and recorded country; missing countries are explicitly labeled. Memberships and counts are not merged merely because names match. Repeated source labels for the same type, country and normalized name are already deduplicated by the area catalog.

Automatically translated site names keep a small inline AUTO label and the original name below. In search, this is a noninteractive label inside the selectable result, with its explanation exposed through a hover title and the option's accessible description. A nested badge button would cause the browser to split the outer result button, disrupting layout and navigation. Clicking anywhere on the result selects the site; popup translation badges retain their existing independent interaction.

Mixed results and the destination-only view retain independent scroll offsets and loaded-page counts for the current query and filters. A new query, changed filters, or a switch between header and onboarding search starts at the top; pagination and same-query data refreshes retain the current list's position.

`js/area-search.js` owns geographic matching and result copy. `js/search-results-menu.js` owns grouped markup, focus and geometry. The map and SEO search adapters own data readiness, filters and navigation. The onboarding area field keeps its existing area-only behavior; it reuses the same menu without adding site results to that flow.

## Verification

```powershell
node --test tests/unit/area-search.test.js
$env:PLAYWRIGHT_PORT = '8772'
npx playwright test tests/e2e/shared-header.spec.js tests/e2e/dive-site-detail.spec.js --grep 'grouped|shared results component|shared document search|catalog refresh' --workers=1
```

The browser checks cover desktop and touch layouts, filter geometry, destination/site keyboard actions, pagination, loading, no matches, failed catalogs and catalog refreshes. Existing welcome/header handoff and delayed-popup cancellation checks protect the independent onboarding flow. AI assisted this implementation and its verification; the changes remain subject to human review.
