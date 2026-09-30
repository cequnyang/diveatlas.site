# Derived GLORYS12 integration fixture

This small fixture was generated on 2026-09-29 from real Copernicus Marine Toolbox subsets for climatology months January and September, release `202311`, over longitude 128°–132°E and latitude 10°–6°S. It contains only the derived quantized current tiles and metadata; the source NetCDF files stay under ignored `data/.build/currents/sources`.

The source is `GLOBAL_MULTIYEAR_PHY_001_030` / `cmems_mod_glo_phy_my_0.083deg-climatology_P1M-m`, fields `uo` and `vo`, product DOI `10.48670/moi-00021`. The fixture retains all four nearest-neighbour target depths and the source ocean mask. `samples.json` records several real September/18.49556 m cells and their source, encoded, decoded, speed, and flow-toward direction values for browser cross-checks.

The fixture is deliberately a regional test input and must not be used as site-wide current coverage. Attribution: “Generated using E.U. Copernicus Marine Service Information; DOI: 10.48670/moi-00021.” See the [Copernicus Marine citation guidance](https://help.marine.copernicus.eu/en/articles/4444611-citing-copernicus-marine-products-and-services) and [product manual](https://documentation.marine.copernicus.eu/PUM/CMEMS-GLO-PUM-001-030.pdf).
