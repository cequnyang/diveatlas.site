# Shared site header

The map, detail pages, directories, regions, destinations, and plain documents use
the same desktop/mobile header rail. Change its layout once in
`assets/site-header.css`; change document header markup once in `js/site-header.js`.
The shared Liquid Glass material remains in `assets/liquid-glass.css`.

## Use on a page

Include these assets in the head:

```html
<link rel="stylesheet" href="/assets/site-header.css?v=1">
<script src="/js/site-header.js?v=1" defer></script>
```

An optional server-rendered logo header remains useful without JavaScript. The
renderer expands it into search, theme, language, account, share, and menu controls.
For a plain document with no header, it inserts the same shell and loads the
document controllers and search catalog. Repeated `DiveAtlasHeader.mount()` calls
preserve existing nodes and handlers. Pages without a viewport declaration receive
one so the mobile layout uses device width.

## Generation and assembly

`tools/site_header_assets.py` provides the generator's asset tags and no-JavaScript
fallback. `page_shell()` includes the shared assets for every page class, including
plain documents. `prepare_pages.py` also installs them in **every published HTML
file**, covering older generated pages and future entry points without regenerating
the content catalog. Assembly updates legacy document-controller references and
passes the release version through the header script's `data-app-version` attribute.
Installation is idempotent.

`seo-browse-header.js` and `seo-browse-header.css` remain compatibility entry points
for existing URLs. The old detail-only header markup and layout have been removed
from the current source templates.

## State ownership

MapView already owns search data, map sharing, layer/theme state, language, and unit
settings. Its header keeps those exact DOM nodes and IDs. The shared renderer adds
layout classes rather than recreating controls or registering competing handlers.
Existing map-specific inline rules remain as the unenhanced fallback. Desktop map
unit controls remain available; they are not copied into unrelated documents.

Document search and menu behavior use `seo-site-search.js` and
`seo-page-controls.js`, which wait for the shared renderer before binding. Detail
pages initialize those controllers after their record is available; failed or
missing records explicitly start navigation so the header still works. Avoid
binding a second controller or replacing an initialized header.

## Verification

```sh
python -m unittest tests.unit.test_site_header_assets tests.unit.test_release_menu_version
npx playwright test tests/e2e/shared-header.spec.js
```

The checks cover both desktop and mobile across map, detail/error, directory,
region, destination, and plain-document routes: one header, viewport sizing,
idempotent mounting, theme, language/menu interaction, and build-time installation.
