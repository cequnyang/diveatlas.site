"""Build static map and point-query assets from the downloaded Copernicus file."""

from __future__ import annotations

import argparse
import gzip
import json
import math
import struct
from datetime import datetime, timezone
from pathlib import Path

import netCDF4
import numpy as np
from PIL import Image


PRODUCT_ID = "GLOBAL_MULTIYEAR_WAV_001_032"
DATASET_ID = "cmems_mod_glo_wav_my_0.2deg-climatology_P1M-m"
PERIOD = "1993-2020"
SOURCE_CATALOGUE_URL = "https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_WAV_001_032/services"
PUM_URL = "https://documentation.marine.copernicus.eu/PUM/CMEMS-GLO-PUM-001-032.pdf"
LICENCE_URL = "https://help.marine.copernicus.eu/en/articles/4444611-citing-copernicus-marine-products-and-services"
ATTRIBUTION = "Generated using E.U. Copernicus Marine Service Information; DOI: 10.48670/moi-00022."
MISSING = -32768
TILE_CELLS = 128
QUERY_HEADER = struct.Struct("<4sBBBBHHHH")
WEB_ZOOM = 3
WEB_TILE_SIZE = 256
WEB_WORLD_SIZE = WEB_TILE_SIZE * (1 << WEB_ZOOM)
WAVE_MAX_M = 8.0
MONTHS = tuple(range(1, 13))
COLORS = np.array([
    [34, 83, 117],
    [38, 132, 157],
    [72, 181, 173],
    [184, 211, 139],
    [246, 191, 91],
    [197, 91, 75],
], dtype=np.float32)


def _single_netcdf(source: Path) -> Path:
    paths = [source] if source.is_file() else sorted(source.rglob("*.nc"))
    if len(paths) != 1:
        raise ValueError(f"expected one source NetCDF file; found {len(paths)}")
    return paths[0]


def _check_variable(variable, name: str, standard_name: str, units: str) -> None:
    if variable.standard_name != standard_name or variable.units != units:
        raise ValueError(f"{name} metadata must be {standard_name!r} in {units!r}")
    if float(variable.scale_factor) != 0.01 or float(variable.add_offset) != 0.0:
        raise ValueError(f"{name} packed scale/offset changed; update the decoder deliberately")
    if int(variable._FillValue) != -32767 or int(variable.missing_value) != -32767:
        raise ValueError(f"{name} missing-value convention changed")


def _validate_source(path: Path, catalogue_path: Path, allow_regional: bool):
    if not catalogue_path.is_file():
        raise FileNotFoundError(f"missing live source_catalogue.json: {catalogue_path}")
    catalogue = json.loads(catalogue_path.read_text(encoding="utf-8"))
    if catalogue.get("product_id") != PRODUCT_ID or catalogue.get("dataset_id") != DATASET_ID:
        raise ValueError("source catalogue does not identify the expected Copernicus product and dataset")
    expected = {
        "VHM0": {"standard_name": "sea_surface_wave_significant_height", "units": "m"},
        "VTM02": {"standard_name": "sea_surface_wave_mean_period_from_variance_spectral_density_second_frequency_moment", "units": "s"},
    }
    if catalogue.get("variables") != expected:
        raise ValueError("source catalogue wave fields differ from the verified climatology variables")
    dataset = netCDF4.Dataset(path)
    for name, standard_name, units in (
        ("VHM0", "sea_surface_wave_significant_height", "m"),
        ("VTM02", "sea_surface_wave_mean_period_from_variance_spectral_density_second_frequency_moment", "s"),
    ):
        if name not in dataset.variables:
            dataset.close()
            raise ValueError(f"source climatology is missing {name}")
        _check_variable(dataset.variables[name], name, standard_name, units)
        if dataset.variables[name].dimensions != ("time", "latitude", "longitude"):
            dataset.close()
            raise ValueError(f"{name} must be ordered as time, latitude, longitude")
    if str(getattr(dataset, "title", "")).strip() != f"Monthly climatology reference period {PERIOD}":
        dataset.close()
        raise ValueError("source dataset title does not verify the 1993-2020 baseline")
    times = netCDF4.num2date(dataset.variables["time"][:], dataset.variables["time"].units,
                             calendar=getattr(dataset.variables["time"], "calendar", "gregorian"))
    if len(times) != 12 or [value.month for value in times] != list(MONTHS):
        dataset.close()
        raise ValueError("source time coordinate must map one-to-one to January through December")
    if any(value.year != 2006 for value in times):
        dataset.close()
        raise ValueError("reference timestamps are unexpected; do not infer the climatology baseline from them")
    if "climatology_bounds" not in dataset.variables:
        dataset.close()
        raise ValueError("source file must include climatology_bounds to verify averaging period")
    bounds = dataset.variables["climatology_bounds"]
    decoded_bounds = netCDF4.num2date(bounds[:], bounds.units, calendar="gregorian")
    if len(decoded_bounds) != 12 or any(
        pair[0].year != 1993 or pair[1].year != 2021 or pair[0].month != index or pair[1].month != index
        for index, pair in enumerate(decoded_bounds, start=1)
    ):
        dataset.close()
        raise ValueError("source climatology_bounds do not support the verified 1993-2020 period")
    latitude = np.asarray(dataset.variables["latitude"][:], dtype=np.float64)
    longitude = np.asarray(dataset.variables["longitude"][:], dtype=np.float64)
    lat_step = float(np.median(np.diff(latitude)))
    lon_step = float(np.median(np.diff(longitude)))
    if not np.all(np.diff(latitude) > 0) or not np.all(np.diff(longitude) > 0):
        dataset.close()
        raise ValueError("source axes must be strictly increasing; update normalization before building")
    if not np.allclose(np.diff(latitude), lat_step, atol=2e-5) or not np.allclose(np.diff(longitude), lon_step, atol=2e-5):
        dataset.close()
        raise ValueError("source grid is not regular")
    if abs(lat_step - 0.2) > 1e-4 or abs(lon_step - 0.2) > 1e-4:
        dataset.close()
        raise ValueError("source grid spacing is not the verified 0.2 degrees")
    if not allow_regional and (len(latitude), len(longitude)) != (899, 1800):
        dataset.close()
        raise ValueError("production build requires the full 899 x 1800 Copernicus source grid")
    return dataset, latitude, longitude, catalogue, decoded_bounds


def _color_rgba(height: np.ma.MaskedArray) -> np.ndarray:
    data = np.ma.filled(height, 0).astype(np.float32)
    pos = np.clip(data / WAVE_MAX_M, 0, 1) * (len(COLORS) - 1)
    low = np.floor(pos).astype(np.intp)
    high = np.minimum(low + 1, len(COLORS) - 1)
    frac = (pos - low)[..., None]
    rgb = np.rint(COLORS[low] * (1 - frac) + COLORS[high] * frac).astype(np.uint8)
    rgba = np.empty((*data.shape, 4), dtype=np.uint8)
    rgba[..., :3] = rgb
    rgba[..., 3] = np.where(np.ma.getmaskarray(height), 0, 235).astype(np.uint8)
    return rgba


def _write_map_tiles(height: np.ma.MaskedArray, latitude: np.ndarray, longitude: np.ndarray, out: Path) -> int:
    lat_min, lat_max = latitude[0], latitude[-1]
    lon_min, lon_max = longitude[0], longitude[-1]
    longitude_step = longitude[1] - longitude[0]
    wraps_globe = math.isclose(len(longitude) * longitude_step, 360, rel_tol=0, abs_tol=0.02)
    tile_count = 0
    for tile_y in range(1 << WEB_ZOOM):
        global_y = tile_y * WEB_TILE_SIZE + np.arange(WEB_TILE_SIZE) + 0.5
        mercator_y = math.pi * (1 - 2 * global_y / WEB_WORLD_SIZE)
        latitudes = np.degrees(np.arctan(np.sinh(mercator_y)))
        source_rows = np.rint((latitudes - lat_min) / (latitude[1] - latitude[0])).astype(np.int64)
        rows_ok = (source_rows >= 0) & (source_rows < len(latitude)) & (latitudes >= -85.05112878) & (latitudes <= 85.05112878)
        source_rows = np.clip(source_rows, 0, len(latitude) - 1)
        # NetCDF rows ascend south-to-north; each north-origin Web Mercator pixel maps directly to its source row.
        source_row_indices = source_rows[:, None]
        for tile_x in range(1 << WEB_ZOOM):
            global_x = tile_x * WEB_TILE_SIZE + np.arange(WEB_TILE_SIZE) + 0.5
            longitudes = -180 + global_x * 360 / WEB_WORLD_SIZE
            source_cols = np.rint((longitudes - lon_min) / longitude_step).astype(np.int64)
            if wraps_globe:
                # Pixel centers at the Web Mercator dateline can round just past the final source column.
                # Wrap those centers to column zero so global tiles meet without a transparent seam.
                source_cols %= len(longitude)
                cols_ok = np.ones(source_cols.shape, dtype=bool)
            else:
                cols_ok = (source_cols >= 0) & (source_cols < len(longitude)) & (longitudes <= lon_max)
            source_cols = np.clip(source_cols, 0, len(longitude) - 1)
            sampled = height[source_row_indices, source_cols[None, :]]
            outside = ~(rows_ok[:, None] & cols_ok[None, :])
            sampled = np.ma.array(np.ma.getdata(sampled), mask=np.ma.getmaskarray(sampled) | outside)
            image = Image.fromarray(_color_rgba(sampled), mode="RGBA")
            path = out / str(WEB_ZOOM) / str(tile_x) / f"{tile_y}.png"
            path.parent.mkdir(parents=True, exist_ok=True)
            image.save(path, format="PNG", optimize=True)
            tile_count += 1
    return tile_count


def _write_query_tiles(height: np.ma.MaskedArray, period: np.ma.MaskedArray, out: Path) -> int:
    rows_north = height[::-1, :]
    period_north = period[::-1, :]
    tile_count = 0
    rows, columns = height.shape
    for tile_row, row0 in enumerate(range(0, rows, TILE_CELLS)):
        for tile_column, column0 in enumerate(range(0, columns, TILE_CELLS)):
            block = np.full((TILE_CELLS, TILE_CELLS, 2), MISSING, dtype="<i2")
            row_count = min(TILE_CELLS, rows - row0)
            column_count = min(TILE_CELLS, columns - column0)
            for index, field in enumerate((rows_north, period_north)):
                view = field[row0:row0 + row_count, column0:column0 + column_count]
                values = np.ma.filled(np.ma.round(view / 0.01), MISSING)
                values = np.asarray(values, dtype=np.int32)
                if np.any((values != MISSING) & ((values <= -32767) | (values > 32767))):
                    raise ValueError("wave value cannot be represented by the published Int16 encoding")
                block[:row_count, :column_count, index] = np.where(values == -32767, MISSING, values).astype("<i2")
            header = QUERY_HEADER.pack(b"DATW", 1, 2, 0, 0, TILE_CELLS, tile_column, tile_row, 0)
            compressed = gzip.compress(header + block.tobytes(order="C"), compresslevel=9, mtime=0)
            path = out / f"{tile_column}_{tile_row}.bin.gz"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(compressed)
            tile_count += 1
    return tile_count


def validate_assets(output: Path, grid_width: int, grid_height: int) -> dict:
    map_paths = sorted((output / "tiles").rglob("*.png"))
    query_paths = sorted((output / "query").rglob("*.bin.gz"))
    expected_map = 12 * (1 << WEB_ZOOM) ** 2
    expected_query = 12 * math.ceil(grid_width / TILE_CELLS) * math.ceil(grid_height / TILE_CELLS)
    if len(map_paths) != expected_map or len(query_paths) != expected_query:
        raise ValueError(f"published tile counts differ from expected map/query counts {expected_map}/{expected_query}")
    for path in map_paths:
        with Image.open(path) as image:
            if image.size != (WEB_TILE_SIZE, WEB_TILE_SIZE) or image.mode != "RGBA":
                raise ValueError(f"invalid map tile dimensions or alpha mode: {path}")
            image.verify()
    expected_payload = QUERY_HEADER.size + TILE_CELLS * TILE_CELLS * 2 * np.dtype("<i2").itemsize
    for path in query_paths:
        try:
            payload = gzip.decompress(path.read_bytes())
        except OSError as error:
            raise ValueError(f"invalid compressed query tile: {path}") from error
        if len(payload) != expected_payload:
            raise ValueError(f"query tile has an invalid fixed-size payload: {path}")
        magic, version, fields, _, _, size, _, _, _ = QUERY_HEADER.unpack(payload[:QUERY_HEADER.size])
        if (magic, version, fields, size) != (b"DATW", 1, 2, TILE_CELLS):
            raise ValueError(f"query tile header is invalid: {path}")
    return {
        "map_tile_count": len(map_paths),
        "map_tile_bytes": sum(path.stat().st_size for path in map_paths),
        "query_tile_count": len(query_paths),
        "query_tile_bytes": sum(path.stat().st_size for path in query_paths),
    }


def build(source: Path, output: Path, allow_regional: bool = False) -> dict:
    nc_path = _single_netcdf(source)
    catalogue_path = source / "source_catalogue.json" if source.is_dir() else source.parent / "source_catalogue.json"
    dataset, latitude, longitude, catalogue, decoded_bounds = _validate_source(nc_path, catalogue_path, allow_regional)
    output.mkdir(parents=True, exist_ok=True)
    variables = {name: dataset.variables[name] for name in ("VHM0", "VTM02")}
    global_stats = {}
    slices = []
    map_tile_count = query_tile_count = 0
    try:
        for month in MONTHS:
            hs = np.ma.asarray(variables["VHM0"][month - 1, :, :], dtype=np.float64)
            tm = np.ma.asarray(variables["VTM02"][month - 1, :, :], dtype=np.float64)
            hs = np.ma.masked_invalid(hs)
            tm = np.ma.masked_invalid(tm)
            if hs.shape != (len(latitude), len(longitude)) or tm.shape != hs.shape:
                raise ValueError(f"month {month} source array dimensions do not match coordinate axes")
            if not np.array_equal(np.ma.getmaskarray(hs), np.ma.getmaskarray(tm)):
                raise ValueError(f"month {month} height and period land/missing masks differ")
            for name, field, maximum in (("VHM0", hs, 40), ("VTM02", tm, 60)):
                valid = field.compressed()
                if not len(valid) or valid.min() < 0 or valid.max() > maximum:
                    raise ValueError(f"month {month} {name} contains invalid values")
                global_stats[name] = {"minimum": min(global_stats.get(name, {}).get("minimum", float("inf")), float(valid.min())),
                                      "maximum": max(global_stats.get(name, {}).get("maximum", float("-inf")), float(valid.max()))}
            period = decoded_bounds[month - 1]
            if period[0].year != 1993 or period[0].month != month or period[1].year != 2021 or period[1].month != month:
                raise ValueError(f"month {month} climatology bounds differ from baseline {PERIOD}")
            map_tile_count += _write_map_tiles(hs, latitude, longitude, output / "tiles" / f"{month:02d}")
            query_tile_count += _write_query_tiles(hs, tm, output / "query" / f"{month:02d}")
            slices.append({"month": month, "reference_time": str(dataset.variables["time"][month - 1]),
                           "bounds_start": period[0].isoformat(), "bounds_end": period[1].isoformat(),
                           "valid_height_cells": int(hs.count()), "missing_height_cells": int(hs.size - hs.count()),
                           "valid_period_cells": int(tm.count()), "missing_period_cells": int(tm.size - tm.count())})
    finally:
        dataset.close()
    asset_metrics = validate_assets(output, len(longitude), len(latitude))
    version = catalogue.get("release", "unversioned")
    manifest = {
        "schema_version": 1,
        "version": f"copernicus-wave-{version}-v2",
        "asset_base": "data/waves",
        "product_id": PRODUCT_ID,
        "dataset_id": DATASET_ID,
        "source": "Copernicus Marine Global Ocean Waves Reanalysis (WAVERYS)",
        "source_catalogue_url": SOURCE_CATALOGUE_URL,
        "product_user_manual_url": PUM_URL,
        "climatology_period": PERIOD,
        "climatology_period_evidence": "Live catalogue dataset_name plus downloaded NetCDF title and per-month climatology_bounds; 2006 mid-month coordinates are reference labels only.",
        "documented_manual_discrepancy": "The February 2026 PUM issue 1.6 states 1993–30/04/2019, but the current dataset catalogue title and downloaded file title/bounds identify 1993–2020. The build uses the dataset-specific title and bounds.",
        "month_mapping": [{"month": month, "source_index": month - 1, "reference_time": slices[month - 1]["reference_time"]} for month in MONTHS],
        "variables": {
            "height": {"name": "VHM0", "standard_name": "sea_surface_wave_significant_height", "units": "m", "scale_factor": 0.01, "add_offset": 0, "missing_value": -32767},
            "mean_period": {"name": "VTM02", "standard_name": "sea_surface_wave_mean_period_from_variance_spectral_density_second_frequency_moment", "units": "s", "definition": "Tm02, spectral moments (0,2)", "scale_factor": 0.01, "add_offset": 0, "missing_value": -32767},
            "direction": {"available": False, "reason": "The monthly climatology dataset does not contain a total mean wave direction variable."},
        },
        "grid": {"width": int(len(longitude)), "height": int(len(latitude)), "longitude_min": float(longitude[0]), "longitude_max": float(longitude[-1]),
                 "longitude_step": float(np.median(np.diff(longitude))), "latitude_min": float(latitude[0]), "latitude_max": float(latitude[-1]),
                 "latitude_step": float(np.median(np.diff(latitude))), "source_coordinate_order": "latitude ascending south-to-north; longitude ascending west-to-east",
                 "longitude_convention": "-180 to 180 degrees", "resolution_degrees": 0.2},
        "encoding": {"query_format": "gzip DATW v1 + 128x128 interleaved little-endian signed Int16 [VHM0_cm, VTM02_centiseconds]", "query_tile_size_cells": TILE_CELLS,
                     "map_format": "transparent RGBA PNG XYZ tiles", "map_zoom": WEB_ZOOM, "max_native_zoom": WEB_ZOOM,
                     "missing_query_value": MISSING, "source_fill_value": -32767, "scale": 0.01, "missing_values_are_not_zero": True,
                     "sampling": "Nearest source cell only; land and source-missing cells remain missing; no spatial interpolation."},
        "map": {"tile_template": "tiles/{month}/{z}/{x}/{y}.png", "height_min_m": 0, "height_max_m": WAVE_MAX_M,
                "height_ticks_m": [0, 2, 4, 6, 8], "months_are_zero_padded": True},
        "query": {"tile_template": "query/{month}/{column}_{row}.bin.gz", "month_token": "two-digit calendar month",
                  "longitude_column_origin": "-180 degrees", "latitude_row_origin": "north", "antimeridian": "longitude normalized to [-180, 180); +180 maps to -180"},
        "source_sample_extrema": global_stats,
        "available_months": list(MONTHS),
        "slice_validation": slices,
        **asset_metrics,
        "attribution": ATTRIBUTION,
        "licence_guidance_url": LICENCE_URL,
        "source_file_bytes": nc_path.stat().st_size,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "production_source_validation": not allow_regional,
    }
    published = [path for path in output.rglob("*") if path.is_file() and path.name != "metadata.json"]
    manifest["published_file_count"] = len(published) + 1
    other_file_bytes = sum(path.stat().st_size for path in published)
    manifest["published_bytes"] = 0
    metadata_path = output / "metadata.json"
    for _ in range(4):
        serialized = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
        actual_bytes = other_file_bytes + len(serialized.encode("utf-8"))
        if manifest["published_bytes"] == actual_bytes:
            break
        manifest["published_bytes"] = actual_bytes
    metadata_path.write_bytes((json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8"))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=Path("data/.build/waves/source"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/waves"))
    parser.add_argument("--allow-regional", action="store_true", help="permit partial grids for isolated tests only")
    args = parser.parse_args()
    manifest = build(args.input_dir, args.output_dir, allow_regional=args.allow_regional)
    print(json.dumps({key: manifest[key] for key in ("version", "climatology_period", "map_tile_count", "map_tile_bytes", "query_tile_count", "query_tile_bytes", "published_file_count", "published_bytes", "source_file_bytes")}, indent=2))


if __name__ == "__main__":
    main()
