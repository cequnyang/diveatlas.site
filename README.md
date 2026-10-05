# DiveAtlas

![DiveAtlas project cover](assets/diveatlas-project-cover.webp)

[DiveAtlas](https://diveatlas.site/) is an interactive map for exploring dive sites and marine data around the world. Search for a place, compare environmental layers, and inspect mapped records in one view. No account or installation is needed to use the site.

## Explore the map

1. Search for a dive site or location and choose a result to move the map.
2. Drag to pan; use the zoom buttons or mouse wheel to change scale.
3. Open **Layers** to choose an environmental map view, select **None** to clear it, or toggle overlays independently.
4. Select a dive-site marker or an ocean location to inspect available details.
5. Use the share control to copy a link to the current map view.

Dive Experience is the initial environmental view on a fresh visit. Select **None** to clear the active environmental view; independently controlled overlays keep their current settings, and bathymetry remains part of the map background. The browser remembers the selected view and overlay settings.

The map works on desktop and mobile browsers. An internet connection is needed for the basemap and map data.

## Map views

### Terrain

Terrain colors show estimated seafloor slope, from gentle to steep. The view is derived from global bathymetry and supports broad exploration; it may include interpolated or lower-resolution areas and is not suitable for navigation.

### Water TEMP

Water TEMP shows typical monthly water-temperature climatology. Choose a depth and month, then select an ocean location to inspect an available sampled value. The detail popup can also show a temperature profile across depths. Locations without temperature data do not show a result.

The source is NOAA's [World Ocean Atlas 2023](https://www.ncei.noaa.gov/products/world-ocean-atlas). Values are long-term monthly averages, not live measurements or a forecast. Temperatures can be displayed in Celsius or Fahrenheit. The top-bar **m/ft** control changes displayed depth units; neither control changes the underlying data.

### Water Clarity

Water Clarity shows typical monthly water transparency estimated from satellite data. Choose a month, then select an ocean location to inspect an available reading. Locations without data for that month do not open a result popup.

The layer uses Copernicus Marine ZSD data for 2016–2025 at approximately 4 km source resolution. The top-bar **m/ft** control converts legend thresholds and popup readings for display; source values and map colors remain based on metres. Actual visibility can vary with waves, rain, sediment, plankton, tides, currents, and local conditions.

### Regional Currents

Regional Currents shows typical monthly ocean flow at broad regional scale. Choose a month and depth; animated lines show flow direction and typical speed. Select an ocean location to inspect its sampled current. The top-bar **m/ft** control updates depth and speed units.

The subtle ocean tint also shows relative current speed beneath the animated lines. Both visualizations and the popup reuse the same Copernicus Marine u/v current tiles; speed is derived from those components, and masked cells remain transparent. The tint is rendered only when Currents is enabled and does not download a second dataset.

The layer uses Copernicus Marine's [Global Ocean Physics Reanalysis](https://marine.copernicus.eu/) (GLORYS12V1), whose source grid is approximately 0.083° (about 8 km at the equator). To keep regional views efficient, the map samples every 32nd source cell at zooms 2–4, every 8th at zooms 5–7, and every 4th at zoom 8 and above; the rendered tint is interpolated from that selected grid, not new higher-resolution data. It is a monthly climatology, not real-time or tide-specific, and cannot resolve local reef or channel conditions. Currents information is for exploration, not navigation or dive-safety decisions.

### Tide

Choose **Tide** to show the continuous blue-series EOT20 surface and its fixed −2 m to +2 m legend. Choose a forecast time, then click or tap an ocean point to open the local EOT20 estimate, its 24-hour curve, next high and low, daily range, and local clock offset. The coarse map surface loads on activation; native point-prediction chunks load on the first map tap and are reused for nearby selections.

The model uses 17 harmonic constituents from EOT20 at 0.125° spacing. The map surface is a 0.25° sampled derivative and uses a wider conservative ocean stencil; popup estimates retain native-grid interpolation. Land-adjacent or masked points without four valid wet interpolation cells return unavailable. The GEBCO water mask and spatial-coverage label do not guarantee local accuracy; EOT20 cannot resolve reef passes, narrow channels, or many harbor effects. Tide height does not directly indicate local current speed and is not a dive-safety recommendation. See [the Tide data and validation notes](tools/tides/README.md).

### Waves

Waves shows typical monthly regional sea-surface conditions. Select a month and click an ocean location for significant wave height and mean period; open **Compare all months** to see its 12-month height climatology. Significant wave height is the average height of the highest third of waves, and individual waves can be higher.

The layer uses Copernicus Marine's [Global Ocean Waves Reanalysis](https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_WAV_001_032/description): total significant wave height (`VHM0`) and total mean period (`VTM02`, Tm02), averaged over 1993–2020 on a 0.2° grid (about 22 km at the equator). The monthly climatology dataset does not provide total mean wave direction. The values are regional seasonal context, not forecasts; local coastal conditions may differ, especially in bays, channels, and around reefs. They do not indicate entry suitability or dive safety.

Attribution: “Generated using E.U. Copernicus Marine Service Information; DOI: [10.48670/moi-00022](https://doi.org/10.48670/moi-00022).” The source follows Copernicus Marine's [licence and citation guidance](https://help.marine.copernicus.eu/en/articles/4444611-citing-copernicus-marine-products-and-services). See [the Waves data pipeline](tools/waves/README.md) for acquisition, validation, baseline evidence, and rebuild commands.

### Dive Experience Outlook

Choose **Dive Experience** in Layers to view a historical monthly outlook for the overall recreational experience. The map color represents the experience score; stronger opacity indicates stronger evidence. Select an ocean location to see the score, provisional label, confidence, available-dimension count, and concise reasons. The inspector separates physical dive conditions from reef/ecological context. Choose a month to update water temperature, clarity, current, and wave height; fish abundance outlook and thermal-stress history remain static across months.

The score uses fixed physical and ecological group influence. Missing reef measurements remain unavailable instead of being filled with proxies, so cells without ecological support stay transparent on the combined map. Fish is presented as a relative outlook category because NRMN records do not provide a complete survey-block denominator. Thermal stress history does not establish that bleaching or mortality occurred. Labels are provisional; this is an experience outlook, not a dive-safety rating. Conditions vary locally and day to day. See the [scoring guide](docs/dive-experience-score-guide.md) and [confidence guide](docs/dive-experience-confidence-guide.md) for the dimension rubrics and evidence rules.

### Reef Condition

Reef Condition shows environmental heat-pressure context. Choose **Ocean heat history** for marine heatwave categories or **Reef thermal stress history** for coral-focused thermal stress. These indicators describe environmental pressure; they do not confirm bleaching, mortality, or observed reef condition. Field-survey observations remain unavailable until a validated production observation dataset is configured.

The heat-history products are derived from NOAA Coral Reef Watch data. Their broad display grids summarize regional conditions and cannot resolve every reef, pass, or local exposure. See the source and resolution details in the layer panel before interpreting a location.

## Overlays

The overlay switches independently show or hide:

- **Terrain** — estimated seafloor slope.
- **Depth contours** — lines representing seafloor depth.
- **Reef extent** — mapped reef areas.
- **Coral records** — recorded coral observations.
- **Fish density** — available fish survey observations and recorded density.
- **Dive sites** — mapped dive locations. Select an individual site to open its available details.

The map language and appearance can be changed from the top bar. The introductory map guide can be reopened from the menu.

## Data and limitations

DiveAtlas combines mapped dive sites and marine datasets, including coral observations, reef extent, fish surveys, bathymetry, depth contours, temperature, water clarity, currents, waves, tides, and thermal-stress indicators. Coverage, dates, and resolution vary by source and location. A missing feature means no matching data is shown; it does not confirm that the feature is absent in the ocean.

Sources include [OBIS](https://obis.org/) coral observations, [UNEP-WCMC](https://data-gis.unep-wcmc.org/portal/home/item.html?id=0613604367334836863f5c0c10e452bf) reef extent, [AODN / NRMN](https://nrmn.aodn.org.au/) fish surveys, [GEBCO](https://www.gebco.net/data-products/gridded-bathymetry-data) bathymetry, [NOAA](https://www.ncei.noaa.gov/products/world-ocean-atlas) temperature, [NOAA Coral Reef Watch](https://coralreefwatch.noaa.gov/) heat stress, EOT20 tides ([data notes](tools/tides/README.md)), and [Copernicus Marine](https://marine.copernicus.eu/) clarity, currents, and waves. Feature popups link to more specific source information when available.

Bathymetry and terrain are gridded global products; their displayed detail does not guarantee local survey accuracy. Marine heat and reef thermal-stress indicators describe environmental pressure, not confirmed bleaching, mortality, or direct reef condition. Coral records are observations, not a complete map of coral habitat. Fish density reflects available surveys, not a census of all fish.

**DiveAtlas is an exploration tool. Do not use it for navigation, hazard assessment, or dive-safety decisions.** Use current local information and appropriate navigation equipment.

## Rights and reuse

Original DiveAtlas source code, documentation, text, and visual design are reserved by Cequn Yang unless a separate notice says otherwise. See [LICENSE](LICENSE). Third-party code, datasets, maps, images, and other materials remain subject to their own licenses and attribution terms.

## Local development and checks

The static site uses Node.js 22 for JavaScript tests and Python 3.12 for the local server and Pages build. Install the locked development dependencies, then use the scripts below:

```sh
npm ci
npm run test:unit
npm run check:test-policy
npm run build
```

`npm run build` validates local links and copies the publishable files into the ignored `_site/` directory. It packages the prebuilt datasets under `data/`; it does not regenerate environmental data. Dataset-generation tools and raw source downloads are not included in this repository.

To run the complete local build with all datasets, including Tide, bundled on the local server:

```sh
python -m http.server 8765 --bind 127.0.0.1 --directory _site
```

Open <http://127.0.0.1:8765/>. Normal app datasets and Tide assets are served from `_site`; no cloud storage or external Tide host is required. The basemap still uses online map tiles, so the map background needs an internet connection.

For local-only Seaview research, serve the repository root instead of `_site` and open <http://127.0.0.1:8765/?reefConditionLocalResearch=1>. This opt-in mode requires the previously generated canonical file under ignored `data/.build/reef_condition/seaview/`; it is not included in the full local build or production Pages output. Its license conflict remains unresolved. The default `_site` build represents the production feature set and does not expose Seaview.

### Hosting the app and data separately

The app can stay on GitHub Pages while large browser-loaded datasets are served from Cloudflare R2. The browser data resolver keeps local development on same-origin `data/` paths by default. For a production build, set `DATA_ASSET_BASE_URL` to an HTTPS release root such as `https://assets.diveatlas.site/releases/2026-10-06-v1/`. The R2 release mirrors the existing `data/` paths under that root; versioned URLs make immutable caching and rollback predictable. When this setting is present, the Pages build omits the external data families and also points the existing Tide resolver at `data/tides/` inside the same release.

Prepare and upload a release from the repository root:

```powershell
python tools/stage_data_release.py --release 2026-10-06-v1
$release = '2026-10-06-v1'
$env:CLOUDFLARE_ACCOUNT_ID = '<Cloudflare account ID>'
$env:CLOUDFLARE_R2_BUCKET = '<R2 bucket name>'
$env:CLOUDFLARE_R2_ACCESS_KEY_ID = '<bucket-scoped access key ID>'
$env:CLOUDFLARE_R2_SECRET_ACCESS_KEY = '<bucket-scoped secret access key>'
powershell -NoProfile -File tools/upload_r2_data_release.ps1 `
  -ReleaseDirectory "data/.build/r2/releases/$release" `
  -AssetBaseUrl "https://assets.diveatlas.site/releases/$release/" `
  -AppOrigin 'https://diveatlas.site'
```

Use a public R2 custom domain for production, enable credential-free `GET` CORS for the exact app origin, and retain the upload script's immutable release prefix. It checks staged hashes, refuses an occupied release path, checks uploaded object count, then verifies public object responses, cache headers, and CORS. It does not switch the site configuration. After the first release passes, set the GitHub repository variable `DATA_ASSET_BASE_URL` to that release URL; the Pages workflow then builds without the external dataset files. Keep old releases until the new Pages deployment has been checked, so rollback only requires restoring the previous variable value and deploying again.

Git source history is a separate storage concern from the Pages artifact. Do not rewrite Git history or remove previously tracked data until the external release is uploaded, publicly verified, and selected by a successful Pages deployment. R2 credentials belong in local environment variables or GitHub Actions secrets, never in the repository or the public asset URL.

For browser checks, install Playwright's Chromium browser once and run the desktop and touch regression suites:

```sh
npx playwright install chromium
npm run test:e2e
```

The Playwright configuration starts a local Python HTTP server. `npm run test:interactions` runs the unit, policy, build, and browser checks in sequence. The GitHub Actions workflow runs this validation before publishing the Pages artifact.

## Dive-site and region guides

- [Dive sites](https://diveatlas.site/dive-sites/) — browse selected site pages with available location details.
- [Regions](https://diveatlas.site/regions/) — browse places represented by the published dive-site pages.
