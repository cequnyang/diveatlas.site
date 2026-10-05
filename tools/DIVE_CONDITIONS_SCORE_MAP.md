# Precomputed Dive Conditions score map

The checked “Color map by overall score” control displays a fixed global score grid. Browsers load one compact monthly grid and paint it as Leaflet canvas tiles, so panning and zooming no longer query and score every visible cell.

## Regenerate the monthly grids

After updating any of the bundled source data listed in the manifest, run:

```powershell
node tools/build_dive_conditions_score_map.js
```

The builder reads only the local, versioned datasets already used by the site and writes a compressed sampled-ocean mask, a reusable compressed reef-dimension grid, twelve compressed monthly score grids, and `data/dive_conditions_score/manifest.json`. If a run is interrupted before the manifest is written, resume valid completed outputs with `node tools/build_dive_conditions_score_map.js --resume`. The generated files are static site assets; the normal site build copies them without recalculating them. Commit the grids and manifest together with any source-data update that requires regeneration.

For a focused update when the center-water monthly grids already exist, `node tools/build_dive_conditions_score_map.js --coastal-only --skip-months=1` merges newly eligible coastal cells into February through December while retaining January’s supported scores and clearing any January cells whose reef dimensions are unavailable. This mode requires the version 2 reef-dimension cache produced by a full build; the month files and manifest are rewritten at the end.

The fixed grid is 0.5° (about 56 km at the equator), chosen to be close to the coarser native current and wave products while removing the much larger viewport-dependent cells. Each cell is sampled on an 8 × 8 subgrid from the same local bathymetry used by the map. Cells need at least 25% ocean coverage to receive a representative score. The representative location is the sampled ocean subcell nearest the 0.5° cell center, reducing the chance that land-centered coastal cells are dropped while avoiding scores based on a narrow water sliver. The browser draws each cell only over subcells classified as ocean, so the overlay does not tint the land part of mixed cells.

Each monthly score is the equal-weighted mean of the seven dimension scores and is emitted only when every dimension is available either directly or through the existing distance-weighted estimate: a 2,500 km radius and weights of `1 / (1 + (distance / 250 km)^3)`, with minimum source/effective-source requirements. Coral and fish percentiles use the same bundled snapshots as the popup. The current NOAA DHW value is shared across the historical months, matching the popup’s existing score semantics. Missing final scores remain transparent; neighboring overall scores are not copied into unsupported cells. The manifest records reef-dimension coverage for the whole eligible grid and per-dimension missing counts for cells processed in each build pass.

The product remains a broad historical comfort indicator. Spatial estimates can cross marine regions and do not imply reef health or dive safety.
