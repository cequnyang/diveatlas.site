"""Build static Water Clarity tiles and numeric query chunks from Copernicus NetCDF.

Expected source files are named YYYY-MM.nc and contain the monthly ZSD field.
The production build uses the Copernicus Marine Toolbox for acquisition; source
files stay in the local build cache and are never copied to the website.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from netCDF4 import Dataset
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
YEARS = tuple(range(2016, 2026))
MONTHS = tuple(range(1, 13))
DATASET_ID = "cmems_obs-oc_glo_bgc-transp_my_l4-multi-4km_P1M"
PRODUCT_ID = "OCEANCOLOUR_GLO_BGC_L4_MY_009_104"
SOURCE_URL = f"https://data.marine.copernicus.eu/product/{PRODUCT_ID}/services"
NODATA = 255
QUANTIZATION_METRES = 0.5
QUANTIZATION_MAX_METRES = (NODATA - 1) * QUANTIZATION_METRES
CHUNK_DEGREES = 10
NATIVE_ZOOM = 5
TILE_SIZE = 256
# A viridis-like scale separates clarity from Temperature's blue-to-orange ramp.
# Keep these colors and value stops aligned with the clarity legend in index.html.
PALETTE = np.asarray([
    [253, 231, 37], [53, 183, 121], [38, 130, 142],
    [49, 104, 142], [62, 73, 137], [72, 40, 120],
], dtype=np.uint8)
PALETTE_STOPS_M = np.asarray([0, 5, 10, 20, 30, 40], dtype=np.float32)


def _coordinate(dataset: Dataset, candidates: tuple[str, ...]) -> np.ndarray:
    for name in candidates:
        if name in dataset.variables:
            values = np.asarray(dataset.variables[name][:], dtype=np.float64).squeeze()
            if values.ndim == 1 and values.size > 1 and np.all(np.isfinite(values)):
                return values
    raise ValueError(f"Could not find a one-dimensional coordinate among {candidates}")


def _read_month(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    with Dataset(path) as source:
        if "ZSD" not in source.variables:
            raise ValueError(f"{path.name} does not contain the required ZSD variable")
        latitude = _coordinate(source, ("lat", "latitude", "LATITUDE"))
        longitude = _coordinate(source, ("lon", "longitude", "LONGITUDE"))
        variable = source.variables["ZSD"]
        variable.set_auto_maskandscale(False)
        values = np.asarray(variable[:], dtype=np.float32)
        while values.ndim > 2:
            if values.shape[0] != 1:
                raise ValueError(f"{path.name} contains more than one time/depth slice")
            values = values[0]
        if values.shape != (latitude.size, longitude.size):
            raise ValueError(f"ZSD dimensions in {path.name} do not match its coordinates")
        data = np.asarray(values, dtype=np.float32)
        fill_values = [getattr(variable, "_FillValue", None), getattr(variable, "missing_value", None)]
        for fill in fill_values:
            if fill is not None:
                data[data == float(fill)] = np.nan
        scale = float(getattr(variable, "scale_factor", 1.0))
        offset = float(getattr(variable, "add_offset", 0.0))
        data = data * scale + offset
        data[(~np.isfinite(data)) | (data < 0)] = np.nan

    lat_order = np.argsort(latitude)
    latitude = latitude[lat_order]
    data = data[lat_order, :]
    longitude = ((longitude + 180) % 360) - 180
    lon_order = np.argsort(longitude)
    longitude = longitude[lon_order]
    data = data[:, lon_order]
    if np.any(np.diff(latitude) <= 0) or np.any(np.diff(longitude) <= 0):
        raise ValueError(f"Coordinates in {path.name} are not unique and monotonic after normalization")
    return latitude, longitude, data


def normalize_month_stack(paths: list[Path]) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    if not paths:
        raise ValueError("A monthly climatology requires at least one source observation")
    reference_lat = reference_lon = None
    observations = []
    loaded = []
    for path in sorted(paths):
        latitude, longitude, values = _read_month(path)
        if reference_lat is None:
            reference_lat, reference_lon = latitude, longitude
        elif not (np.array_equal(reference_lat, latitude) and np.array_equal(reference_lon, longitude)):
            raise ValueError(f"Grid coordinates in {path.name} differ from the other source files")
        observations.append(values)
        loaded.append(path.name)
    stack = np.stack(observations)
    with warnings.catch_warnings():
        # Land and persistently unobserved cells are expected to be all-NaN.
        warnings.simplefilter("ignore", RuntimeWarning)
        climatology = np.nanmedian(stack, axis=0)
    valid = np.isfinite(climatology)
    if not valid.any():
        raise ValueError("Monthly inputs contain no valid ocean ZSD cells")
    stats = {
        "observations": len(paths), "valid_cells": int(valid.sum()),
        "total_cells": int(valid.size), "valid_cell_percent": float(valid.mean() * 100),
        "no_data_percent": float((~valid).mean() * 100),
        "min_m": float(climatology[valid].min()),
        "median_m": float(np.median(climatology[valid])),
        "max_m": float(climatology[valid].max()),
        "clipped_cells": int((valid & (climatology > QUANTIZATION_MAX_METRES)).sum()),
        "loaded_month_files": loaded,
    }
    return reference_lat, reference_lon, climatology, stats


def quantize(values: np.ndarray) -> tuple[np.ndarray, int]:
    valid = np.isfinite(values) & (values >= 0)
    clipped = valid & (values > QUANTIZATION_MAX_METRES)
    encoded = np.full(values.shape, NODATA, dtype=np.uint8)
    encoded[valid] = np.rint(np.minimum(values[valid], QUANTIZATION_MAX_METRES) / QUANTIZATION_METRES).astype(np.uint8)
    return encoded, int(clipped.sum())


def _regular_step(coordinates: np.ndarray, name: str) -> float:
    steps = np.diff(coordinates)
    step = float(np.median(steps))
    # Copernicus stores these regular 4 km coordinates as float32; adjacent
    # differences can vary by about 1e-5 degrees from rounding alone.
    if step <= 0 or not np.allclose(steps, step, rtol=1e-4, atol=1e-5):
        raise ValueError(f"{name} coordinate is not a regular grid")
    return step


def _colorize(encoded: np.ndarray) -> np.ndarray:
    metres = encoded.astype(np.float32) * QUANTIZATION_METRES
    rgba = np.zeros((*encoded.shape, 4), dtype=np.uint8)
    valid = encoded != NODATA
    clipped = np.minimum(metres, PALETTE_STOPS_M[-1])
    for channel in range(3):
        rgba[..., channel][valid] = np.interp(
            clipped[valid], PALETTE_STOPS_M, PALETTE[:, channel]
        ).round().astype(np.uint8)
    rgba[..., 3][valid] = 190
    return rgba


def _tile_source_indices(latitude: np.ndarray, longitude: np.ndarray, z: int, x: int, y: int):
    world = 2 ** z
    pixel = np.arange(TILE_SIZE, dtype=np.float64) + 0.5
    tile_x = x + pixel / TILE_SIZE
    tile_y = y + pixel / TILE_SIZE
    lon = tile_x / world * 360.0 - 180.0
    mercator_y = np.pi * (1 - 2 * tile_y / world)
    lat = np.degrees(np.arctan(np.sinh(mercator_y)))
    lat_idx = np.rint((lat - latitude[0]) / _regular_step(latitude, "latitude")).astype(np.int64)
    lon_idx = np.rint((lon - longitude[0]) / _regular_step(longitude, "longitude")).astype(np.int64)
    return lat_idx, lon_idx


def write_tiles(encoded: np.ndarray, latitude: np.ndarray, longitude: np.ndarray, month: int,
                output: Path, tile_output: Path | None = None) -> tuple[int, int]:
    count = 0
    total_bytes = 0
    for y in range(2 ** NATIVE_ZOOM):
        lat_idx, lon_idx = _tile_source_indices(latitude, longitude, NATIVE_ZOOM, 0, y)
        valid_rows = (lat_idx >= 0) & (lat_idx < latitude.size)
        if not valid_rows.any():
            continue
        for x in range(2 ** NATIVE_ZOOM):
            _, lon_idx = _tile_source_indices(latitude, longitude, NATIVE_ZOOM, x, y)
            valid_cols = (lon_idx >= 0) & (lon_idx < longitude.size)
            if not valid_cols.any():
                continue
            data = np.full((TILE_SIZE, TILE_SIZE), NODATA, dtype=np.uint8)
            data[np.ix_(valid_rows, valid_cols)] = encoded[np.ix_(lat_idx[valid_rows], lon_idx[valid_cols])]
            tile_path = (tile_output or output) / "tiles" / f"{month:02d}" / str(NATIVE_ZOOM) / str(x) / f"{y}.png"
            tile_path.parent.mkdir(parents=True, exist_ok=True)
            image = Image.fromarray(_colorize(data), mode="RGBA")
            for attempt in range(4):
                try:
                    image.save(tile_path, optimize=True)
                    break
                except OSError:
                    if attempt == 3:
                        raise
                    time.sleep(0.05 * (attempt + 1))
            count += 1
            total_bytes += tile_path.stat().st_size
    return count, total_bytes


def write_query_chunks(monthly: dict[int, np.ndarray], latitude: np.ndarray, longitude: np.ndarray, output: Path) -> dict:
    lat_step = _regular_step(latitude, "latitude")
    lon_step = _regular_step(longitude, "longitude")
    core_rows = max(1, round(CHUNK_DEGREES / lat_step))
    core_columns = max(1, round(CHUNK_DEGREES / lon_step))
    chunk_rows = math.ceil(latitude.size / core_rows)
    chunk_columns = math.ceil(longitude.size / core_columns)
    chunks = []
    total_bytes = 0
    for row_chunk in range(chunk_rows):
        row_start = row_chunk * core_rows
        rows = min(core_rows, latitude.size - row_start)
        for column_chunk in range(chunk_columns):
            column_start = column_chunk * core_columns
            columns = min(core_columns, longitude.size - column_start)
            values = np.stack([
                monthly[month][row_start:row_start + rows, column_start:column_start + columns]
                for month in MONTHS
            ])
            if np.all(values == NODATA):
                continue
            raw = values.tobytes(order="C")
            compressed = gzip.compress(raw, compresslevel=9, mtime=0)
            filename = f"r{row_chunk:02d}_c{column_chunk:02d}.u8.gz"
            target = output / "query" / "chunks" / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(compressed)
            chunks.append({"row": row_chunk, "column": column_chunk, "file": filename,
                           "row_start": row_start, "column_start": column_start,
                           "rows": rows, "columns": columns, "bytes": len(compressed)})
            total_bytes += len(compressed)
    return {
        "format": "diveatlas-water-clarity-query", "format_version": 1,
        "chunk_degrees": CHUNK_DEGREES,
        "chunk_grid": {"rows": chunk_rows, "columns": chunk_columns},
        "chunk_size_summary": {"count": len(chunks), "compressed_total_bytes": total_bytes},
        "chunks": chunks,
    }


def build(input_dir: Path, output_dir: Path, render: bool = True, scope: str = "global") -> dict:
    monthly_encoded = {}
    monthly_stats = {}
    latitude = longitude = None
    for month in MONTHS:
        paths = [input_dir / f"{year}-{month:02d}.nc" for year in YEARS]
        missing = [path.name for path in paths if not path.is_file()]
        if missing:
            raise FileNotFoundError(f"Month {month:02d} is missing source observations: {', '.join(missing)}")
        lat, lon, values, stats = normalize_month_stack(paths)
        if latitude is None:
            latitude, longitude = lat, lon
        elif not (np.array_equal(latitude, lat) and np.array_equal(longitude, lon)):
            raise ValueError(f"Month {month:02d} does not share the same global grid")
        encoded, clipped = quantize(values)
        stats["clipped_cells"] = clipped
        monthly_encoded[month] = encoded
        monthly_stats[str(month)] = stats

    assert latitude is not None and longitude is not None
    if scope == "global" and not (
        latitude[0] <= -89.5 and latitude[-1] >= 89.5 and
        longitude[0] <= -179.5 and longitude[-1] >= 179.5
    ):
        raise ValueError("The default production build requires global latitude and longitude coverage; use --scope sample only for a local validation build")
    query_info = write_query_chunks(monthly_encoded, latitude, longitude, output_dir)
    render_counts = {}
    if render:
        for month in MONTHS:
            count, size = write_tiles(monthly_encoded[month], latitude, longitude, month, output_dir)
            render_counts[str(month)] = {"tile_count": count, "bytes": size}

    metadata = {
        "format": "diveatlas-water-clarity", "format_version": 1,
        "designation": "production" if scope == "global" else "development-sample",
        "source": "Copernicus Marine Service Ocean Colour", "product_id": PRODUCT_ID,
        "dataset_id": DATASET_ID, "source_url": SOURCE_URL,
        "variable": "ZSD", "variable_description": "Secchi transparency depth",
        "unit": "m", "source_resolution_km": 4,
        "climatology_period": "2016-2025", "aggregation": "cell-wise median by calendar month",
        "source_time_range": "2016-01 through 2025-12",
        "source_dimensions": [int(latitude.size), int(longitude.size)],
        "latitude_range": [float(latitude[0]), float(latitude[-1])],
        "longitude_range": [float(longitude[0]), float(longitude[-1])],
        "available_months": list(MONTHS),
        "grid": {
            "latitude_count": int(latitude.size), "longitude_count": int(longitude.size),
            "latitude_first_center": float(latitude[0]), "longitude_first_center": float(longitude[0]),
            "latitude_step_degrees": _regular_step(latitude, "latitude"),
            "longitude_step_degrees": _regular_step(longitude, "longitude"),
            "latitude_order": "south_to_north", "longitude_convention": "-180_to_180",
        },
        "value_encoding": {"dtype": "uint8", "byte_order": "not_applicable",
                           "scale_m": QUANTIZATION_METRES, "minimum_m": 0,
                           "maximum_m": QUANTIZATION_MAX_METRES, "missing_sentinel": NODATA,
                           "lookup": "nearest source cell; no interpolation"},
        "rendering": {"tile_template": "tiles/{month}/{z}/{x}/{y}.png",
                      "min_native_zoom": NATIVE_ZOOM, "max_native_zoom": NATIVE_ZOOM,
                      "opacity": 0.58, "palette_stops_m": PALETTE_STOPS_M.tolist(),
                      "palette_rgb": PALETTE.tolist()},
        "query": query_info,
        "statistics_by_month": monthly_stats,
        "render_tiles_by_month": render_counts,
        "output_bytes": 0,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "limitations": ["Satellite-derived regional water transparency; actual dive visibility may differ.",
                        "Approximately 4 km source resolution; no interpolation or finer-scale inference."],
    }
    metadata_path = output_dir / "metadata.json"
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    metadata["output_bytes"] = sum(path.stat().st_size for path in output_dir.rglob("*") if path.is_file())
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    metadata["output_bytes"] = sum(path.stat().st_size for path in output_dir.rglob("*") if path.is_file())
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"months": len(MONTHS), "query_chunks": query_info["chunk_size_summary"],
                      "render_tiles": render_counts, "output_bytes": metadata["output_bytes"]}, indent=2))
    return metadata


def render_existing_query(output_dir: Path) -> dict:
    """Repaint tiles from the persisted quantized query grid without NetCDF downloads."""
    metadata_path = output_dir / "metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    staging_base = output_dir.parent / ".build" / "water_clarity"
    staging_base.mkdir(parents=True, exist_ok=True)
    staging = staging_base / f"palette-render-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%f}"
    staged_tiles = staging / "tiles"
    rows, columns = metadata["source_dimensions"]
    monthly_encoded = {
        month: np.full((rows, columns), NODATA, dtype=np.uint8)
        for month in MONTHS
    }
    for chunk in metadata["query"]["chunks"]:
        chunk_path = output_dir / "query" / "chunks" / chunk["file"]
        with gzip.open(chunk_path, "rb") as source:
            values = np.frombuffer(source.read(), dtype=np.uint8).reshape(
                len(MONTHS), chunk["rows"], chunk["columns"]
            )
        row = slice(chunk["row_start"], chunk["row_start"] + chunk["rows"])
        column = slice(chunk["column_start"], chunk["column_start"] + chunk["columns"])
        for index, month in enumerate(MONTHS):
            monthly_encoded[month][row, column] = values[index]

    latitude = metadata["grid"]["latitude_first_center"] + np.arange(rows) * metadata["grid"]["latitude_step_degrees"]
    longitude = metadata["grid"]["longitude_first_center"] + np.arange(columns) * metadata["grid"]["longitude_step_degrees"]
    render_counts = {}
    for month in MONTHS:
        count, size = write_tiles(monthly_encoded[month], latitude, longitude, month, output_dir, staging)
        render_counts[str(month)] = {"tile_count": count, "bytes": size}

    metadata["rendering"]["palette_stops_m"] = PALETTE_STOPS_M.tolist()
    metadata["rendering"]["palette_rgb"] = PALETTE.tolist()
    metadata["render_tiles_by_month"] = render_counts
    metadata["generated_at_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    static_bytes = sum(path.stat().st_size for path in output_dir.rglob("*")
                       if path.is_file() and path != metadata_path and output_dir / "tiles" not in path.parents)
    tile_bytes = sum(path.stat().st_size for path in staged_tiles.rglob("*") if path.is_file())
    metadata["output_bytes"] = static_bytes + tile_bytes
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    metadata["output_bytes"] += metadata_path.stat().st_size
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    backup = staging / "previous-tiles"
    current_tiles = output_dir / "tiles"
    os.replace(current_tiles, backup)
    try:
        os.replace(staged_tiles, current_tiles)
    except OSError:
        os.replace(backup, current_tiles)
        raise
    return {"months": len(MONTHS), "render_tiles": render_counts, "output_bytes": metadata["output_bytes"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=ROOT / "data" / ".build" / "water_clarity" / "sources")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data" / "water_clarity")
    parser.add_argument("--skip-render", action="store_true", help="Write query data only")
    parser.add_argument("--scope", choices=("global", "sample"), default="global")
    parser.add_argument("--render-existing-query", action="store_true",
                        help="Repaint existing global tiles from cached query chunks without source NetCDF files")
    args = parser.parse_args()
    try:
        if args.render_existing_query:
            print(json.dumps(render_existing_query(args.output_dir), indent=2))
        else:
            build(args.input_dir, args.output_dir, render=not args.skip_render, scope=args.scope)
    except Exception as error:
        print(f"water clarity build failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
