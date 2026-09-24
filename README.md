# diveatlas.site

Interactive global reef and dive map integrating coral reef extent, coral observations, fish-density surveys, and dive-site data.

## Current data layers

- Global coral reef extent
- OBIS coral records
- AODN / NRMN fish-density surveys
- Embedded global dive-site dataset

## Run

Open `index.html` in a modern browser.

## Project layout

- `assets/`: UI icons and favicon assets. The light and dark brand icons are the only theme variants; the 180px file is reserved for Apple touch icons.
- `data/`: local coral snapshots, Reef raster tiles/vector chunks, raw data packages, and `fish_map_units.json.gz`.
- `data/.build/`: generated build intermediates; intentionally ignored by Git.
- `tools/`: reusable local-data build utilities.

## Performance architecture

- Primary datasets remain local/static; online refreshes are optional rather than the normal rendering path.
- Reef rendering no longer deletes small polygons or relies on aggressively simplified low-zoom geometry. The runtime source is the cached UNEP-WCMC geometry at the same 0.0005° API offset used by the original local snapshot.
- Z3-Z7 Reef is pre-rendered into 1,019 local PNG tiles (~1.45 MB total) directly from the source polygons. This preserves the source footprint at screen resolution while avoiding hundreds of thousands of Leaflet paths.
- Z8+ Reef uses 1,738 local gzip/base64 vector chunks partitioned by individual polygon parts with a small 84 KB bbox manifest. Only chunks intersecting the padded viewport are decoded. A bounded 320-chunk LRU keeps nearby decoded chunks hot so short back-pans do not immediately re-fetch/re-decode them. Z8-Z11 batches visible polygons into Canvas paths, while Z12+ keeps feature-level paths for viewport clipping.
- Coral observations, coral grid cells, fish surveys, and dive sites use 5° in-memory spatial indexes so pan/zoom refreshes query nearby buckets rather than scanning each global dataset.
- Coral grid resolution scales with zoom and uses a build-time Z3-Z11 pyramid, preserving summed occurrence counts while avoiding runtime re-binning of the 130k base cells.
- Coral Z3-Z11 uses monotonically finer geographic cells for spatial fidelity (3°, 1.5°, 0.75°, 0.375°, 0.1875°, 0.140625°, 0.09375°, 0.0625°, 0.03125°). Visible cells are grouped into six opacity bins and rendered as only a handful of non-interactive Canvas paths; hover/click is resolved separately against the in-memory grid lookup. Z12+ point markers remain SVG.
- Fish surveys and dive sites use coarser pre-aggregated local LOD pyramids from Z3-Z8 before screen-distance clustering, while preserving original counts and expansion bounds.
- The batched Coral grid stays visible during zoom animation and local grid refresh runs synchronously at move/zoom end. For Z8+ Reef interaction, exact vector layers are detached during pan/zoom and the lightweight Z7 raster is temporarily scaled as a visual fallback; after the gesture settles, the next exact vector viewport is attached once and atomically replaces the raster. This avoids continuous vector reprojection and stale-vector redraw flashes.
- Popup auto-pan is guarded from triggering layer rebuilds; coral, fish, and dive SVG points retain hover tooltips and click popups. Reef Canvas paths never intercept pointer events; from Z8 onward Reef click detection is performed only on demand against the currently visible exact vector chunks.
- Compressed/base64 payload strings are released after decoding to avoid retaining duplicate representations in memory.

The map remains local/static-first: normal browsing does not call the Reef API. The build tool can regenerate the low-zoom raster tiles and viewport-lazy vector chunks from the cached Reef source geometry.
