# diveatlas.site

Interactive global reef and dive map integrating coral reef extent, coral observations, fish-density surveys, and dive-site data.

## Current data layers

- Global coral reef extent
- OBIS coral records
- AODN / NRMN fish-density surveys
- Embedded global dive-site dataset

## Product features

- New visitors start with Reef extent and Dive sites enabled. Once a visitor has saved layer preferences, those preferences take precedence; a shared URL restores its own view without replacing the saved defaults.
- The Tutorial and Map Layers panel use the same live layer state, including the compact `All` / `Default` action and matching layer symbols.
- Dive-site records have persistent DiveAtlas UUIDs in `data/dive-sites.js`. Photo metadata is keyed only by those IDs in `data/dive-site-photos.js`; preserve IDs when updating records. Same-name records within 3 km are consolidated, with retired IDs retained on the merged row.
- Dive-site popups can show locally stored hero photos from `assets/dive-sites/<siteId>/hero.webp`. Portrait photos use a sharp, fully visible foreground over a subdued blurred copy in a fixed 16:9 frame. Photo credits and source metadata are kept in the photo registry.
- Opening a dive-site popup accounts for the rendered header height and keeps a 14px safe margin around the visible map area. Popup height is constrained to the available viewport, and a one-time bounds check makes only a minimal corrective pan when needed.
- Share opens a small popover with a context-aware map/site link action. It copies the same canonical URL that restores center, zoom, visible layers, and a selected dive-site ID.
- The browser tab icon follows the browser's light/dark preference; the site also uses a small Apple touch icon. See [DESIGN.md](DESIGN.md) for the product's visual conventions and [the dive-site photo guide](assets/dive-sites/README.md) for the asset and stable-ID workflow.

## Updating dive-site photos

1. Keep one permanent UUID in field `[12]` of each `data/dive-sites.js` row. Do not generate IDs during page load or rebuilds.
2. Optimize each approved image to WebP and store it at `assets/dive-sites/<siteId>/hero.webp`.
3. Add its `alt`, credit, source, license, and location confidence to `data/dive-site-photos.js` under that same ID.

The photo guide documents duplicate consolidation and UUID retirement rules. The original flattened source has no reliable per-site identifier, so the stored DiveAtlas UUID is the durable key.

## Run

Open `index.html` in a modern browser.

## Project layout

- `assets/`: UI icons and favicon assets. The light and dark brand icons are the only theme variants; the 180px file is reserved for Apple touch icons.
- `data/`: local coral snapshots and occurrence chunks, Reef raster tiles/vector chunks, and their manifests.
- `data/.build/`: generated build intermediates; intentionally ignored by Git.
- `tools/`: reusable local-data build utilities.

## Performance architecture

- Primary datasets remain local/static; online refreshes are optional rather than the normal rendering path.
- Reef rendering no longer deletes small polygons or relies on aggressively simplified low-zoom geometry. The runtime source is the cached UNEP-WCMC geometry at the same 0.0005° API offset used by the original local snapshot.
- Z3-Z7 Reef is pre-rendered into 1,020 local PNG tiles (~7.8 MiB total) directly from the source polygons. Tiles are rasterized at 2x and downsampled with Lanczos filtering for smoother boundaries while preserving the source footprint and avoiding hundreds of thousands of Leaflet paths.
- Z8+ Reef uses 1,738 local gzip/base64 vector chunks partitioned by individual polygon parts with a small 84 KB bbox manifest. Only chunks intersecting the padded viewport are decoded. A bounded 320-chunk LRU keeps nearby decoded chunks hot so short back-pans do not immediately re-fetch/re-decode them. Z8-Z11 batches visible polygons into Canvas paths, while Z12+ keeps feature-level paths for viewport clipping.
- Coral observations, coral grid cells, fish surveys, and dive sites use 5° in-memory spatial indexes so pan/zoom refreshes query nearby buckets rather than scanning each global dataset.
- Coral grid resolution scales with zoom and uses a build-time Z3-Z11 pyramid, preserving summed occurrence counts while avoiding runtime re-binning of the 130k base cells.
- Coral Z3-Z11 uses monotonically finer geographic cells for spatial fidelity (3°, 1.5°, 0.75°, 0.375°, 0.1875°, 0.140625°, 0.09375°, 0.0625°, 0.03125°). Visible cells are grouped into six opacity bins and rendered as only a handful of non-interactive Canvas paths; hover/click is resolved separately against the in-memory grid lookup. Z12+ point markers remain SVG.
- Fish surveys and dive sites use coarser pre-aggregated local LOD pyramids from Z3-Z8 before screen-distance clustering, while preserving original counts and expansion bounds.
- The batched Coral grid stays visible during zoom animation and local grid refresh runs synchronously at move/zoom end. For Z8+ Reef interaction, exact vector layers are detached during pan/zoom and the lightweight Z7 raster is temporarily scaled as a visual fallback; after the gesture settles, the next exact vector viewport is attached once and atomically replaces the raster. This avoids continuous vector reprojection and stale-vector redraw flashes.
- Popup auto-pan is guarded from triggering layer rebuilds; coral, fish, and dive SVG points retain hover tooltips and click popups. Reef Canvas paths never intercept pointer events; from Z8 onward Reef click detection is performed only on demand against the currently visible exact vector chunks.
- Compressed/base64 payload strings are released after decoding to avoid retaining duplicate representations in memory.

The map remains local/static-first: normal browsing does not call the Reef API. The build tool can regenerate the low-zoom raster tiles and viewport-lazy vector chunks from the cached Reef source geometry.
