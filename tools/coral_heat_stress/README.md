# Coral Heat Stress

The NOAA Coral Reef Watch preprocessing tools in this directory retain support for the daily 5 km Bleaching Alert Area (7-day maximum) release and for annual thermal-history sources. DiveAtlas no longer exposes the standalone Current / History Heat Stress view or uses the daily BAA raster in its Reef Condition provider. The daily build path remains available for reproducible research and future reuse; it is not part of the production map's update requirement.

The map classifies each daily HotSpot and Degree Heating Week (DHW) pair using NOAA's revised 15 December 2023 thresholds, then takes the maximum category across seven consecutive daily observations. During the build, that result is compared against NOAA's separately published BAA 7-day file. A substantial mismatch blocks publication.

## Update the static data

Run these commands from the project root on a machine with Python:

```powershell
python -m pip install -r tools/coral_heat_stress/requirements.txt
python tools/coral_heat_stress/acquire.py
python tools/coral_heat_stress/build.py
python -m unittest tests.unit.test_coral_heat_stress_build -v
```

`acquire.py` finds the latest date shared by NOAA STAR's BAA, HotSpot, and DHW daily NetCDF listings, downloads the official BAA file and seven consecutive HotSpot/DHW pairs, and stages them under ignored `data/.build/coral_heat_stress/source`. `build.py` validates dates, variables, coordinates, resolution, missing-value conventions, categories, generated assets, and the derived-to-official comparison before publishing `data/coral-heat-stress/metadata.json` and a versioned release directory. To deliberately rebuild a date already published, pass `--force`; an older source date also requires this explicit flag.

Raw NetCDF inputs and temporary files stay under `data/.build`. The site publishes transparent RGBA PNG XYZ map tiles at native zoom 5 and gzip-compressed 256 × 256 cell query tiles. The browser loads the module and metadata only after Heat Stress is selected, then fetches visible map tiles. A query tile is fetched only after a user clicks a map location and is cached in memory.

The daily BAA assets and provider validator are retained for offline tooling compatibility, but the production Reef Condition interface does not request them. The separate Heat Stress selector and Current / History switch have been removed.

## Source and classification

- NOAA STAR daily global 5 km BAA 7-day maximum, HotSpot, and DHW NetCDF 1.0 files, product version 3.1.
- Variables: `bleaching_alert_area`, `hotspot`, and `degree_heating_week`; coordinates: `time`, `lat`, and `lon`.
- HotSpot and DHW are stored as int16 values scaled by 0.01; BAA values are uint8, with 251 missing and current categories 0 through 7. These rules are verified from recent NOAA STAR files, not the stale downstream ERDDAP `colorBarMaximum`.
- Each day is classified before the seven-day maximum is taken. A daily cell is ignored if either measurement is missing; a cell with no valid day is encoded as 255.
- Build metadata records source URLs and filenames, dates, product/classification/preprocessor versions, resolution, and full NOAA-vs-derived comparison statistics.

The generated map preserves the 0.05° cell grid at high zoom; it does not interpolate into finer geometry. BAA remains NOAA's 7-day maximum category and its source/query grids remain global. Current map tiles use the NOAA Thermal History `mask` as a display-only reef-plus-buffer footprint. The global values and query chunks remain intact. That mask comes from Thermal History v3.7.0 and covers reef-containing pixels plus NOAA's approximately 11 km buffer; builder validation requires aligned cell centers and refuses to resample. Update the footprint only after verifying a later official mask.

Current and History use the shared visual tokens in `js/coral-heat-stress-style.js`. BAA labels and DHW bands remain distinct; severity colors/opacity are aligned by category correspondence. Both use nearest-cell PNG tiles at native zoom 5 and the same high-zoom opacity policy, so neither mode interpolates beyond the approximate 5 km source grid. Current BAA category values are not converted to DHW, and annual DHW remains a continuous thermal-history measurement.

## Update the historical annual DHW data

History uses NOAA Coral Reef Watch Thermal History Annual History v3.7.0. It is a separate, infrequent release from the daily V1 BAA product. Rebuild it only after verifying a new official version and its annual coverage:

```powershell
python tools/coral_heat_stress/acquire_history.py
python tools/coral_heat_stress/build_history.py
```

The source NetCDF is 8.2 GB and is kept under ignored `data/.build/coral_heat_stress/history_source`. The builder validates the direct `ann_max_dhw` float32 variable, the 1985–2025 year coordinate, NOAA fill value, units, ranges, grid, masks, and source release before publishing. It reads one annual 40 MB grid at a time; the other annual-history SST fields are inspected for schema but not extracted. A failed or partial build leaves the active `history/metadata.json` pointer untouched. Use `--force` only for a deliberate same-version rebuild.

The static annual source output is grouped under `data/coral-heat-stress/history/releases/<release>/`. It is retained as a reproducible input for the smaller Reef Condition summary build below. The production browser does not load the annual time-series chunks or year-by-year map files.

## Reef Condition thermal-pressure summary

Reef Condition presents **Thermal stress history** as environmental-pressure context alongside independent field observations. The map color represents the maximum annual DHW in the latest ten available source years. The popup identifies its magnitude and year, shows the ten annual values, reports recent and full-period threshold counts and maxima, and states the source period. DHW represents accumulated thermal exposure; crossing a threshold does not establish observed bleaching, mortality, or reef-health change.

The annual summary is generated from validated NOAA Thermal History point chunks and published under `data/reef-condition/thermal-stress-history/`. It contains a zoom-0–5 PNG tile pyramid (1,365 tiles) and 174 gzip DCHR v2 query chunks. The v3.7 source covers 1985–2025, so the latest ten years are 2016–2025. Missing annual values remain unavailable rather than being counted as zero. Query chunks retain detailed annual values as uint16 hundredths of a DHW unit; the PNG tiles contain only the recent-period maximum needed to color the map. Overview pixels at zooms 0–4 use the strongest source category in each footprint so small areas of stress remain visible. Zoom 5 uses nearest NOAA cells at the source grid's ~5 km equatorial resolution; zooms above 5 enlarge those same cells and do not imply finer source data.

### Local broad-ocean MHW history experiment

`build_ocean_heat_history.py` reads NOAA Coral Reef Watch Marine Heatwave Watch daily NetCDF files, discovers the latest complete calendar year from the NOAA archive index, then summarizes the trailing complete years. Daily MHW categories 1–5 count as event days; category 0 is a valid observed non-event. Strong/severe/extreme thresholds use the source category codes (2/3/4 and higher). A missing, land, or ice cell is never converted to category 0, and missing dates break consecutive-day runs. Equal worst categories use the latest occurrence date. NOAA's archived Feb 29 files mark land as water; the builder intersects leap-day pixels with the Feb 28 water mask to prevent false land observations while retaining valid ocean categories.

Run the local-only prototype with:

```powershell
python tools/coral_heat_stress/build_ocean_heat_history.py
```

By default the derived artifacts are written to the ignored `data/.build/reef_condition/ocean-heat-history-prototype/` directory; source files are transient and deleted after each ordered daily summary. The builder checkpoints summary accumulators locally every 100 days, retries transient network failures at most twice, and re-fetches an unreadable NetCDF once. Checkpoints are removed after successful asset generation and never contain daily source files. The local `index.html` compares worst category, severe-or-worse day persistence, and the existing reef-specific DHW layer without changing production UI or metrics. This experiment is broad marine heat context, not a reef-health, bleaching, or mortality observation.

For an explicit reproducible period during validation, pass `--end-year 2025 --years 10`. Do not point the output at published `data/` paths unless the product integration is separately reviewed and approved.

After NOAA publishes a new annual release, verify its version and period, then rebuild the annual history assets and Reef Condition summary:

```powershell
python tools/coral_heat_stress/acquire_history.py
python tools/coral_heat_stress/build_history.py
python tools/coral_heat_stress/build_history_summary.py
python -m unittest tests.unit.test_coral_heat_history_build tests.unit.test_coral_heat_history_summary -v
node --test tests/unit/reef-condition-provider.test.js tests/unit/reef-survey-condition-view.test.js
```

The NOAA annual-history NetCDF is 8,226,693,376 bytes (about 8.23 GB decimal) and is build-time input only. The derived summary is regenerated from the new DCHR v2 format; only visible map tiles load after activation, and one compact query chunk is requested after a map click. Refresh approximately annually, after verifying a new NOAA Thermal History release. The site has no NOAA runtime API dependency and continues serving the last generated static summary if a later release is delayed.

## Global annual-map pilot

History's map uses NOAA's official global annual maximum DHW composites for 2016–2025. These maps are published separately from the 1985–2025 Thermal History point series: point clicks, charts, and summaries continue to use the original `ann_max_dhw` source. The map pilot does not interpolate the reef-only point grid.

To refresh the pilot, resume or download the ten NOAA NetCDF composites and build a staged map release:

```powershell
python tools/coral_heat_stress/acquire_global_history.py
python tools/coral_heat_stress/build_global_history.py
```

The builder validates each 0.05-degree source grid and variable, renders all global valid pixels as zoom-5 PNG tiles, emphasizes cells in NOAA's reef footprint through alpha alone, and records year-by-year value and overlap checks against `ann_max_dhw`. Each year also includes compressed 256×256 uint16 value tiles, preserving the source's 0.01 °C-week precision with a no-data sentinel. These let a click return the selected annual value from the same global product when the reef-focused point-history dataset has no value for that cell/year; the popup labels this fallback separately and does not imply that a reef time series exists there. The release is staged and `history/global-maps/metadata.json` is atomically replaced; separate point-history metadata and release remain unchanged. A one-year validation preview can be built under an ignored `.build` directory before release with `--years 2025 --output data/.build/coral_heat_stress/global_2025_preview`. The browser fetches map metadata only when History opens, requests visible image tiles for the selected year, and fetches a compressed value tile only when a map click needs the global fallback.

The pilot deliberately stops at 2025. It measures the value, transfer cost, storage, and validation quality of global maps before any decision to extend map coverage to earlier years. NOAA's global composites are annual maxima of its daily DHW product; they remain Annual Maximum Degree Heating Week and are not bleaching observations or Bleaching Alert Area categories.

Current-vs-History mode is deliberately local session state. The existing share URL format serializes map location and overlay switches, not environmental feature modes, so this change does not introduce new URL parameters.

## References

- [NOAA CRW 5 km product suite and STAR downloads](https://coralreefwatch.noaa.gov/product/5km/)
- [NOAA CRW Bleaching Alert Area (7-day maximum)](https://www.coralreefwatch.noaa.gov/product/5km/index_5km_baa-max-7d.php)
- [NOAA CRW methodology](https://coralreefwatch.noaa.gov/product/5km/methodology.php)
- [NOAA CRW Thermal History Annual History](https://coralreefwatch.noaa.gov/product/thermal_history/annual_history.php)
- [NOAA CRW Thermal History Stress Frequency definitions](https://coralreefwatch.noaa.gov/product/thermal_history/stress_frequency.php)
- [NOAA CRW annual composite products](https://coralreefwatch.noaa.gov/product/5km/index_5km_composite.php)
