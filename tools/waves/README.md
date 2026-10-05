# Waves data pipeline

Waves helps compare typical regional wave conditions by calendar month. The site serves generated static assets; the browser does not query Copernicus or download NetCDF. The map draws significant wave height, and a location popup can show total mean period and an on-demand 12-month height comparison.

## Rebuild the published data

Copernicus Marine requires an account for downloads. Log in once through the Toolbox on the machine that builds the site; credentials stay in the user's local Toolbox store and are not written to the repository.

```powershell
python -m venv data/.build/waves/.venv
data/.build/waves/.venv/Scripts/python.exe -m pip install -r tools/waves/requirements.txt
data/.build/waves/.venv/Scripts/copernicusmarine.exe login
data/.build/waves/.venv/Scripts/python.exe tools/waves/acquire.py --describe-only
data/.build/waves/.venv/Scripts/python.exe tools/waves/acquire.py
data/.build/waves/.venv/Scripts/python.exe tools/waves/build.py
data/.build/waves/.venv/Scripts/python.exe -m unittest tests.unit.test_waves_build -v
```

`acquire.py` records the current catalogue release and its exact variables, coordinates, and reference-month timestamps, then downloads the original monthly climatology NetCDF. `build.py` accepts only that product, checks the live catalogue record against the file, verifies the month and climatology bounds, and writes the generated assets to `data/waves`. Large raw downloads and intermediate files stay under ignored `data/.build/waves`.

After rebuilding, inspect `data/waves/metadata.json` for measured source and published sizes, validation summaries, and tile counts. `build.py` validates every output PNG and compressed query tile before writing the manifest. Unit-test fixtures live only in temporary directories and never become site data.

Preview the static site locally:

```powershell
npm run build
python -m http.server 8000 --directory _site
```

Then open `http://localhost:8000/`. Stop the local server with Ctrl+C.

## Verified source

- Product: `GLOBAL_MULTIYEAR_WAV_001_032`; dataset: `cmems_mod_glo_wav_my_0.2deg-climatology_P1M-m`; release observed 202311.
- Dataset variables: `VHM0` (`sea_surface_wave_significant_height`, m) and `VTM02` (`sea_surface_wave_mean_period_from_variance_spectral_density_second_frequency_moment`, s). Tm02 is the spectral-moment (0,2) mean period; this pipeline does not substitute peak period or a swell partition.
- Both NetCDF fields are signed Int16 with `scale_factor=0.01`, `add_offset=0`, and `_FillValue`/`missing_value=-32767`. The builder decodes through NetCDF's mask and scale handling, stores valid centimetre/centisecond values in the query tiles, and encodes missing samples as −32768. A height of 0 m remains a valid value.
- The downloaded file has dimensions 12 × 899 × 1800 with dimensions ordered `time, latitude, longitude`; latitude ascends from −89.8° to 89.8°, and longitude ascends from −180° to 179.8°, at 0.2° increments. UI months map to the corresponding January–December index. The 2006 mid-month timestamps are month labels, not baseline years.
- The live catalogue dataset name and the downloaded file title identify the climatology as 1993–2020. The downloaded file's `climatology_bounds` was inspected for all twelve months. The February 2026 PUM issue 1.6 still states 1993 through 30 April 2019; this manual text conflicts with the current dataset title and downloaded file, so the manifest records both the discrepancy and the dataset-specific evidence used.
- The climatology dataset contains no total mean wave direction. Direction arrows and popup direction values are therefore omitted. The parent product manual describes direction as a meteorological “from” bearing, with a 180° NetCDF offset; that convention is not applied to this direction-free climatology.
- Attribution: “Generated using E.U. Copernicus Marine Service Information; DOI: 10.48670/moi-00022.” Consult Copernicus Marine's current licence and citation guidance before republishing outside this project.

Official references: [product services and live catalogue](https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_WAV_001_032/services), [product page](https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_WAV_001_032/description), [Product User Manual, issue 1.6](https://documentation.marine.copernicus.eu/PUM/CMEMS-GLO-PUM-001-032.pdf), and [licence and citation guidance](https://help.marine.copernicus.eu/en/articles/4444611-citing-copernicus-marine-products-and-services).

## Static asset design

The map loads only the selected month's visible XYZ tiles at zoom 3, the native regional presentation level for the 0.2° source grid. Higher display zooms enlarge those tiles rather than requesting or creating finer data. Tile pixels use nearest source cells and alpha-zero land/missing cells. Point values use the same source cells and mask; no coastal interpolation or interpolation across missing cells is performed.

The selected month uses transparent RGBA PNG tiles. Popup point samples use gzip-compressed 128 × 128 geographic blocks with interleaved signed Int16 significant height (centimetres) and Tm02 (centiseconds). They are fetched only when a location is selected. The 12-month point comparison fetches its extra month blocks only when the user opens that chart. Longitude is wrapped into [−180°, 180°), so +180° and −180° resolve to the same dateline column.

Missing coastal/land cells remain transparent on the map and unavailable in point sampling. Zero height is not treated as missing. The layer uses the source's regular grid and does not provide individual beach, reef, bay, channel, safety, or dive-entry assessments.
