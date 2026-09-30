# DiveAtlas

![DiveAtlas project cover](assets/diveatlas-project-cover.webp)

[DiveAtlas](https://diveatlas.site/) is an interactive map for exploring dive sites and marine data around the world. Search for a place, compare environmental layers, and inspect mapped records in one view. No account or installation is needed to use the site.

## Explore the map

1. Search for a dive site or location and choose a result to move the map.
2. Drag to pan; use the zoom buttons or mouse wheel to change scale.
3. Open **Layers** to choose a map view or toggle overlays.
4. Select a dive-site marker or an ocean location to inspect available details.
5. Use the share control to copy a link to the current map view.

Terrain is the default environmental view for a new visit. The map remembers the selected view and overlay settings in the browser. Bathymetry remains part of the map background in every view.

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

The layer uses Copernicus Marine's [Global Ocean Physics Reanalysis](https://marine.copernicus.eu/) (GLORYS12V1), with approximately 8 km resolution. It is a monthly climatology, not real-time or tide-specific, and cannot resolve local reef or channel conditions. Currents information is for exploration, not navigation or dive-safety decisions.

## Overlays

The overlay switches independently show or hide:

- **Depth contours** — lines representing seafloor depth.
- **Reef extent** — mapped reef areas.
- **Coral records** — recorded coral observations.
- **Fish density** — available fish survey observations and recorded density.
- **Dive sites** — mapped dive locations. Select an individual site to open its available details.

The map language and appearance can be changed from the top bar. The introductory map guide can be reopened from the menu.

## Data and limitations

DiveAtlas combines mapped dive sites and marine datasets, including coral observations, reef extent, fish surveys, bathymetry, depth contours, temperature, water clarity, and currents. Coverage, dates, and resolution vary by source and location. A missing feature means no matching data is shown; it does not confirm that the feature is absent in the ocean.

Sources include [OBIS](https://obis.org/) coral observations, [UNEP-WCMC](https://data-gis.unep-wcmc.org/portal/home/item.html?id=0613604367334836863f5c0c10e452bf) reef extent, [AODN / NRMN](https://nrmn.aodn.org.au/) fish surveys, [GEBCO](https://www.gebco.net/data-products/gridded-bathymetry-data) bathymetry, [NOAA](https://www.ncei.noaa.gov/products/world-ocean-atlas) temperature, and [Copernicus Marine](https://marine.copernicus.eu/) clarity and currents. Feature popups link to more specific source information when available.

Bathymetry and terrain are gridded global products; their displayed detail does not guarantee local survey accuracy. Coral records are observations, not a complete map of coral habitat. Fish density reflects available surveys, not a census of all fish.

**DiveAtlas is an exploration tool. Do not use it for navigation, hazard assessment, or dive-safety decisions.** Use current local information and appropriate navigation equipment.

## Local development and checks

The static site uses Node.js 22 for JavaScript tests and Python 3.12 for the local server and Pages build. Install the locked development dependencies, then use the scripts below:

```sh
npm ci
npm run test:unit
npm run check:test-policy
npm run build
```

`npm run build` validates local links and copies the publishable files into the ignored `_site/` directory. It packages the prebuilt datasets under `data/`; it does not regenerate environmental data. Dataset-generation tools and raw source downloads are not included in this repository.

For browser checks, install Playwright's Chromium browser once and run the desktop and touch regression suites:

```sh
npx playwright install chromium
npm run test:e2e
```

The Playwright configuration starts a local Python HTTP server. `npm run test:interactions` runs the unit, policy, build, and browser checks in sequence. The GitHub Actions workflow runs this validation before publishing the Pages artifact.

## Dive-site and region guides

- [Dive sites](https://diveatlas.site/dive-sites/) — browse selected site pages with available location details.
- [Regions](https://diveatlas.site/regions/) — browse places represented by the published dive-site pages.
