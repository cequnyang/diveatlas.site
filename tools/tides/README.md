# DiveAtlas Tide data pipeline

Tide displays local predictions from an offline EOT20 harmonic model. It is intended for broad environmental exploration; its global grid is too coarse to describe many reefs, channels, harbors, or local tidal currents.

## Use and rebuild

On the site, open **Layers → Tide** to display the blue-series map surface, then click or tap an ocean location for its popup prediction. Choose **Now** or a forecast offset in the panel. World views (zoom 3 and below) use a 1° derivative for quick loading; closer views sample the native 0.125° EOT20 grid. Clicked-location predictions use the same native source model. The browser fetches only regional chunks needed by the current view and reuses them during the session. No tide service is called at runtime.

The builders require Python with `numpy`, `netCDF4`, `rasterio`, `requests`, and `shapely`; the astronomy comparison additionally uses PyTMD 3.0.9. Install `tools/tides/requirements.txt` in a local virtual environment, then run:

```powershell
python tools/tides/fetch.py
python tools/tides/inspect_eot20.py
python tools/tides/build_assets.py
python tools/tides/build_visualization.py
python tools/tides/build_timezones.py
python tools/tides/validate_astronomy.py
python tools/tides/validate_noaa.py
```

`fetch.py` downloads the official [SEANOE EOT20 archive](https://www.seanoe.org/data/00683/79489/data/85762.zip) into ignored build storage at `data/.build/tides/source/85762.zip`, checks SHA-256, and extracts `ocean_tides.zip`. The published source bundle was downloaded 2026-09-30 UTC: 2,330,678,793 bytes, SHA-256 `bced7af7eb7c34896d4fd04680a751cc9f5a4c7a3c03852997d9263d61e07018`. It contains the ocean and load archives; this feature uses the 17-constituent ocean set. EOT20 is Hart-Davis et al. (2021), DOI [10.17882/79489](https://doi.org/10.17882/79489), published under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

`build_assets.py` reads the 17 NetCDF files in `data/.build/tides/source/EOT20/ocean_tides/` and uses the existing GEBCO 2026 2-arc-minute rasters in `data/.build/gebco_2026_2min/`. Generated versioned point-query assets are under `data/tides/eot20-v1/`; raw NetCDF and archives are never shipped to browsers. Close-up map tiles sample these native chunks and use the point resolver's four-node validity and 15 km distance checks; world views use the 1-degree derivative. `build_visualization.py` still creates the former 1-degree display derivative for reproducible comparisons; it is not loaded by the active map. `build_timezones.py` downloads the timezone-boundary-builder 2026d ocean-inclusive polygons, checks the pinned archive checksum, and writes 10-degree chunks under `data/tides/timezones-2026d/`. Timezone polygons are ODbL; see [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder) and the [ODbL](https://opendatacommons.org/licenses/by/1.0/).

## Static asset origin boundary

Tide has three browser-reachable, lazy-loaded families: 5° EOT20 coefficient chunks in `eot20-v1`, 30° one-degree visualization chunks in `eot20-viz-v1`, and 10° timezone polygons in `timezones-2026d`. None is requested by default. The renderer requests its visible overview chunks only after Tide activation at world zoom; point coefficients and the timezone manifest/chunk are fetched after a map tap. Runtime requests are ordinary credential-free `fetch()` calls and each family is versioned. Browsers cache these immutable files with `force-cache`; a new data release should use a new version directory.

The shared URL resolver is `js/tides/asset-config.js`. Local mode points to `data/tides/`. To build a Pages artifact against an already-deployed static asset origin, set `TIDE_ASSET_BASE_URL` to the directory root whose children are the three version directories, for example `https://assets.example.org/tides/`, then run `npm run build`. The Pages builder excludes `data/tides/` only when this explicit build-time value is present and writes it to the generated `js/tides/deployment-config.js`; an ordinary build keeps the bundled files and continues to work offline from its own origin. The verifier checks that external mode has no bundled Tide tree and that bundled mode includes all three manifests. Do not enable the external setting until every staged file has been uploaded and tested at its final HTTPS origin.

For an ignored local staging copy that mirrors the static origin layout:

```powershell
python tools/tides/stage_static_release.py --release local-phase4-10
python tools/tides/serve_staged_release.py --port 8766 --allow-origin http://127.0.0.1:8765
$env:TIDE_ASSET_BASE_URL = 'http://127.0.0.1:8766/tides/'
python tools/prepare_pages.py --output _site
```

The immutable release stager writes to `data/.build/tides/phase4-10/releases/<release>/`, hashes every staged asset, and verifies the copied file set against a release manifest. The manifest records the asset families, model/source metadata already present in their manifests, total count/size, per-file SHA-256 values, and an aggregate inventory digest. Each release directory is immutable: use a new release ID instead of overwriting an existing release.

### Optional Cloudflare R2 upload

No production bucket, custom asset hostname, account ID, or credentials are configured in this repository. The following is an opt-in upload path for an owner-provisioned R2 bucket; it refuses to overwrite a non-empty version prefix and does not change the Pages configuration:

```powershell
python tools/tides/stage_static_release.py --release 2026-10-03
$env:CLOUDFLARE_ACCOUNT_ID = '<Cloudflare account ID>'
$env:CLOUDFLARE_R2_BUCKET = '<R2 bucket name>'
$env:CLOUDFLARE_R2_ACCESS_KEY_ID = '<R2 S3 access key ID>'
$env:CLOUDFLARE_R2_SECRET_ACCESS_KEY = '<R2 S3 secret access key>'
powershell -NoProfile -File tools/tides/upload_r2_release.ps1 `
  -ReleaseDirectory data/.build/tides/phase4-10/releases/2026-10-03 `
  -AssetBaseUrl 'https://<configured-host>/tides/2026-10-03/tides/' `
  -AppOrigin 'https://<actual-DiveAtlas-origin>'
```

The upload script requires AWS CLI v2 and uses the standard R2 S3 endpoint. It validates the staged manifest first, refuses an occupied immutable prefix, uploads the release with `Cache-Control: public, max-age=31536000, immutable`, checks object count, then calls `verify_http_release.py` against the final HTTPS origin. It reports success only after the public manifest, representative compressed chunks, exact-origin CORS, cache headers, no-redirect behavior, gzip decoding, and a missing-object 404 pass. The script never switches the Pages build URL. Only after this validation should a build use `TIDE_ASSET_BASE_URL` with that release's `/tides/` URL.

Before the first upload, create an R2 bucket, a bucket-scoped S3 token with object read/write access, and a public custom HTTPS domain. In that bucket's CORS settings, add one rule with `AllowedOrigins` set to the exact deployed app origin, `AllowedMethods` set to `GET`, `AllowedHeaders` empty, `ExposeHeaders` set to `Content-Length`, `Content-Type`, and `ETag`, and `MaxAgeSeconds` set to `86400`. This app makes credential-free GET requests without custom headers. Do not add cookies, authorization headers, or credentialed CORS. After changing CORS on an already cached custom domain, purge that hostname's cache so old cached responses do not hide the new CORS headers. The mutable R2 bucket configuration is account-specific and is deliberately not fabricated here. Configure the `tides/<release-id>/` prefix with the immutable cache policy above. The versioned release manifest is immutable too; production switching is done by rebuilding with a different `TIDE_ASSET_BASE_URL`, not by changing a mutable pointer. Roll back by rebuilding Pages with the previous versioned base URL; the prior 434 MB release remains available and needs no re-upload.

The development server binds only to loopback and restricts CORS to the app's loopback origin. The repository currently configures GitHub Pages only and has no external Tide origin, R2 account configuration, or upload credentials. The scripts prepare a reproducible deployment path, but do not publish data without those owner-provided account settings.

If the origin or a chunk fails, Tide's existing layer-level error path reports that the surface/model could not be loaded while leaving the map and other environmental views usable. There is no automatic retry loop. A failed regional chunk can be requested again by the normal next user action; successful chunks are reused from the session cache and browser HTTP cache.

## Model interpretation and safety

Each source file provides `amplitude` and `phase` in centimetres and degrees on a 1441 × 2881 grid: latitude −90°…90° at 0.125°, longitude 0°…360° at 0.125° (with a duplicate seam). The browser stores the complex harmonic coefficient as `H = amplitude × exp(−i × phase)` and reconstructs height with `Re(H) cos(θ) − Im(H) sin(θ)`. The astronomical argument and FES nodal corrections follow PyTMD 3.0.9 (MIT); the browser implementation has no PyTMD dependency. Epoch handling is UTC Unix time converted to MJD for ASTRO5 arguments.

Missing source values and zero-amplitude/zero-phase cells are treated as invalid, matching the source reader's validity convention. A generated model node is marked wet only if all nine neighboring GEBCO cells are below zero metres; interpolation requires all four surrounding EOT20 nodes to be both valid and wet. There is no nearest-water fallback. A point that fails this conservative check is unavailable. The `Limited` / `Moderate` label describes spatial applicability based on location within a model cell; it is not a probability of accuracy.

All prediction calculations use UTC milliseconds. The browser locates the clicked point in local timezone polygons and uses its built-in IANA `Intl` rules (including daylight time) for displayed clocks. If the polygon lookup or browser timezone support fails, the result is unavailable instead of using the visitor's timezone.

## Reference checks and known limits

`validate_astronomy.py` checks the browser's per-constituent astronomical and nodal terms against PyTMD 3.0.9 FES arguments on two dates. `validate_noaa.py` compares the generated float32 chunks and browser predictor with NOAA CO-OPS official station harmonic predictions over 48 hourly samples for geographically varied stations, including the Bay of Fundy and American Samoa near the dateline. It samples the nearest wet EOT20 grid node within 20 km of each gauge; this is a regional diagnostic, not a station-level accuracy claim. Results are written to `noaa-validation-report.json`. Model and gauge constituent sets, coastal resolution, station locations, and local datums differ, so the comparisons identify major reconstruction errors rather than certify a local prediction.

The map uses a fixed −2 m to +2 m sequential blue scale, clipping more extreme values at its end colors. This normalization is global and does not change with the viewport. The rendering pane opacity is 0.43 in light theme and 0.42 in dark theme; the visual stencil keeps masked samples transparent so adjacent tiles share continuous coast and ocean boundaries. The map surface is an environmental overview, not local harbor or reef detail. Tide shows predicted astronomical height only; it must not infer slack water, current speed, safe entry, or a preferred dive time. In particular, a high or low tide is not necessarily slack current.
