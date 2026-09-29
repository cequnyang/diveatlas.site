# Water Clarity data pipeline

Water Clarity shows typical satellite-derived Secchi transparency depth (ZSD) by calendar month. The renderer and click query use the same quantized source cells, so a map color never claims finer detail than the approximately 4 km source grid.

## Rebuild

Install the Copernicus Marine Toolbox and configure an account with `copernicusmarine login`. Install the preprocessing libraries with `python -m pip install -r tools/water_clarity/requirements.txt`.

Acquire the 120 monthly source slices for 2016–2025. This downloads only ZSD and keeps raw files in the ignored build cache:

```powershell
python tools/water_clarity/acquire.py
```

To check access and validate a small tropical/coastal window first, request a spatial subset (it still needs all 10 years for each month):

```powershell
python tools/water_clarity/acquire.py --years 2016-2025 --bounds 129,-2,134,2 --output-dir data/.build/water_clarity/sample
python tools/water_clarity/build.py --scope sample --input-dir data/.build/water_clarity/sample --output-dir data/.build/water_clarity/sample-output
```

The production builder requires one `YYYY-MM.nc` file for every year and month. To build the global production assets, run:

```powershell
python tools/water_clarity/build.py
```

To change the map palette without reacquiring the 120 source files, repaint the existing tiles from the saved quantized query chunks:

```powershell
python tools/water_clarity/build.py --render-existing-query
```

This validates each source grid, calculates a cell-wise monthly median, quantizes values at 0.5 m to 0–127 m (255 is No Data), writes month-major gzip query chunks, and paints 256 px Web Mercator PNG tiles at native-equivalent zoom 5. Missing or incompatible files stop the build. Values beyond the encoding range are counted in metadata and clipped only to the representable maximum. No raw NetCDF files are copied to the runtime directory.

For deterministic local tests, run:

```powershell
python -m unittest discover -s tests/unit -p test_water_clarity_build.py
node --test tests/unit/water-clarity-*.test.js
```

## Runtime and limitations

The browser loads metadata and visible PNG tiles only after Water Clarity is selected. Click lookup fetches a bounded spatial chunk from the same encoded monthly grid, selects the nearest source cell without interpolation, and returns No Data for the reserved sentinel. Zooming above the source-equivalent zoom reuses the same tiles; it does not add scientific detail. Copernicus Marine Toolbox access is used only for offline preprocessing; the public site has no Copernicus API dependency.

The interface calls the value “Typical transparency.” ZSD is satellite-derived water transparency, not a direct scuba visibility measurement; waves, rain, sediment, plankton, tides, currents, and local conditions can change actual dive visibility. Source period, dimensions, valid range, missing-data share, clipping, generated tile/chunk counts, and total output bytes are recorded in `data/water_clarity/metadata.json` after a build.

To update the normal period, adjust `YEARS` in `build.py`, acquire every calendar month for the same years, rebuild, and review the per-month statistics and output size before publishing. Rebuilding does not fetch or publish data automatically.
