# R2 source snapshots

The coral-record and fish-survey snapshots are canonical in the immutable R2 data release. The site and offline data-release builder read them from R2; they are not checked into the GitHub repository.

Python and Node analysis tools use `tools/r2_source_data.py` and `tools/r2_source_data.js`. Each helper reads the current release URL from `SOURCE_DATA_ASSET_BASE_URL` or `DATA_ASSET_BASE_URL`, then from the generated `_site/js/data-assets-config.js`, and finally from the public deployed site config. It checks the release manifest and verifies each downloaded file's byte count and SHA-256 before caching it under ignored `data/.build/r2/source-cache/`.

The five small startup manifests and temperature metadata also live only in R2 as their canonical copy. Their ignored working copies are needed only for local development, where the app serves data from disk. On a fresh checkout, run `npm run prepare:local-manifests`; it downloads the startup files from the configured public release and verifies their checksums before writing them under `datasets/`. If a local file differs, the command stops instead of replacing it unless `--force` is explicitly passed through to the script.

To stage a new release, set `SOURCE_DATA_ASSET_BASE_URL` to the current immutable R2 release URL (or set `DATA_ASSET_BASE_URL`) and run:

```powershell
python tools/stage_data_release.py --release <new-release-id>
```

The builder copies the coral and fish snapshots from the configured R2 release and stages the other runtime datasets from their existing local production inputs. Complete releases are normally immutable. For the designated startup assets, an explicit append mode can add previously absent objects to an existing release, verify their hashes, and update the release inventory last. It refuses to overwrite any existing data object or accept an unlisted object in the prefix.

To append the coral-occurrence, bathymetry, reef raster/vector, and terrain manifests plus Temperature metadata to an existing release:

```powershell
python tools/stage_data_release.py --release 2026-10-05-v2 --startup-data-only
./tools/upload_r2_data_release.ps1 `
  -ReleaseDirectory data/.build/r2/releases/2026-10-05-v2 `
  -AssetBaseUrl https://assets.diveatlas.site/releases/2026-10-05-v2/ `
  -AppOrigin https://diveatlas.site `
  -AppendExisting
```

The inventory is replaced only after all six files are present and verified. Consumers fetch the small inventory with a cache-busting query because earlier releases used a year-long immutable cache header for that URL.

The dive-site catalog and its two compressed sidecars are part of live search and popup rendering. R2 release objects are immutable, so replacements use versioned keys and the app is updated to request those keys. Stage only the relevant objects and append them to the active release; do not overwrite existing objects or change the site's configured release URL:

```powershell
python tools/stage_data_release.py --release 2026-10-05-v2 --dive-site-catalog-only `
  --releases-directory $env:TEMP/diveatlas-r2-catalog
./tools/upload_r2_data_release.ps1 `
  -ReleaseDirectory (Join-Path $env:TEMP 'diveatlas-r2-catalog/2026-10-05-v2') `
  -AssetBaseUrl https://assets.diveatlas.site/releases/2026-10-05-v2/ `
  -AppOrigin https://diveatlas.site `
  -AppendExisting

python tools/stage_data_release.py --release 2026-10-05-v2 --dive-site-search-assets-only `
  --releases-directory $env:TEMP/diveatlas-r2-search
./tools/upload_r2_data_release.ps1 `
  -ReleaseDirectory (Join-Path $env:TEMP 'diveatlas-r2-search/2026-10-05-v2') `
  -AssetBaseUrl https://assets.diveatlas.site/releases/2026-10-05-v2/ `
  -AppOrigin https://diveatlas.site `
  -AppendExisting
```

Append mode publishes `data/dive-sites-v3.js` plus `data/dive-site-search-locations-v4.json.gz` and `data/dive-site-summaries-v3.json.gz` in addition to the designated startup files. The catalog and sidecar inventories can be staged separately, then appended in sequence; each inventory is updated after its objects are uploaded and verified.

## Environmental query slices

Dive Conditions reads only the selected month and 5 m temperature slice plus the selected month's clarity slice. Temperature profile and annual-chart slices are fetched only when those popup tabs are opened. The v2 data is a byte-preserving split of the current v1 quantized chunks; nearest-cell lookup, missing sentinels, and source values do not change. The extra small objects increase the Temperature archive by about 26 MB in the current dataset, while making the common point query substantially smaller.

After building new v2 assets from the existing local production chunks, prepare an additive release extension with:

```powershell
python scripts/rechunk_environmental_queries.py
python tools/stage_data_release.py --release <current-release-id> --environmental-query-only `
  --releases-directory $env:TEMP/diveatlas-environmental-query
```

Review and verify the generated release before using the existing append procedure. The uploader sends the many small v2 chunks through the AWS transfer manager and writes the release inventory last. The query readers use v2 when its metadata exists and fall back to v1 on HTTP 404, so the application code and the additive R2 assets can be released in either order without making lookups unavailable.
