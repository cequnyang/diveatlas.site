#!/usr/bin/env python3
"""Build a subdued, ocean-masked WOA23 nearest-cell extension for temperature maps.

This renders only pixels with no direct WOA23 value, where the bathymetry mask
confirms ocean and a valid same-month, same-depth WOA23 cell is within 25 km.
The direct tiles stay untouched so users can distinguish observed source-grid
coverage from nearby estimates by opacity.
"""

from __future__ import annotations

import gzip
import json
import math
from pathlib import Path
import sys

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "temperature"))
from build import (  # noqa: E402
    SOURCE_CONFIG,
    colorize,
    depth_level_index,
    tile_pixel_coordinates,
)

RADIUS_KM = 25.0
EARTH_RADIUS_KM = 6371.0088
ZOOM = 3
TILE_SIZE = 256
GRID_WIDTH = 1440
GRID_HEIGHT = 720
GRID_STEP = 0.25
GRID_WEST = -180.0
GRID_SOUTH = -90.0
GRID_LON_FIRST = -179.875
GRID_LAT_FIRST = -89.875
CHUNK_DEGREES = 10
CHUNK_HALO = 1
MISSING = -32768
QUERY_ROOT = ROOT / "data" / "temperature" / "query"
TEMPERATURE_METADATA = ROOT / "data" / "temperature" / "metadata.json"
OCEAN_MASK_PATH = ROOT / "data" / "dive_conditions_score" / "ocean-mask.bin.gz"
OUTPUT_ROOT = ROOT / "data" / "temperature" / "production-0.25deg"
OUTPUT_TEMPLATE = "estimated-nearest-25km/woa23/monthly/{month}/{depth}/{z}/{x}/{y}.png"


def load_source_cache(metadata: dict) -> np.memmap:
    months = metadata["available_months"]
    depths = metadata["available_depths_m"]
    cache_path = QUERY_ROOT / ".coverage-source-cache.i16"
    shape = (len(months), len(depths), GRID_HEIGHT, GRID_WIDTH)
    grid = np.memmap(cache_path, mode="w+", dtype="<i2", shape=shape)
    grid[:] = MISSING
    chunk_rows = round(CHUNK_DEGREES / GRID_STEP)
    chunk_columns = round(CHUNK_DEGREES / GRID_STEP)
    chunk_root = QUERY_ROOT / "chunks"
    for row_chunk in range(math.ceil(GRID_HEIGHT / chunk_rows)):
        row_start = row_chunk * chunk_rows
        row_end = min(GRID_HEIGHT, row_start + chunk_rows)
        data_row_start = max(0, row_start - CHUNK_HALO)
        rows = min(GRID_HEIGHT, row_end + CHUNK_HALO) - data_row_start
        local_rows = np.arange(row_start - data_row_start, row_end - data_row_start)
        for column_chunk in range(math.ceil(GRID_WIDTH / chunk_columns)):
            column_start = column_chunk * chunk_columns
            column_end = min(GRID_WIDTH, column_start + chunk_columns)
            column_indices = np.arange(column_start - CHUNK_HALO, column_end + CHUNK_HALO, dtype=np.int64) % GRID_WIDTH
            data_column_start = int(column_indices[0])
            local_columns = (np.arange(column_start, column_end) - data_column_start) % GRID_WIDTH
            columns = len(column_indices)
            name = f"r{row_chunk:02d}_c{column_chunk:02d}.i16.gz"
            packed = gzip.decompress((chunk_root / name).read_bytes())
            chunk = np.frombuffer(packed, dtype="<i2").reshape(
                len(months), len(depths), rows, columns
            )
            core = chunk[:, :, local_rows, :][:, :, :, local_columns]
            grid[:, :, row_start:row_end, column_start:column_end] = core
            print(f"Loaded temperature source chunk {name}.")
    grid.flush()
    return grid


def sphere_xyz(latitude: np.ndarray, longitude: np.ndarray) -> np.ndarray:
    lat = np.deg2rad(latitude)
    lon = np.deg2rad(longitude)
    cos_lat = np.cos(lat)
    return np.column_stack((cos_lat * np.cos(lon), cos_lat * np.sin(lon), np.sin(lat)))


def load_ocean_mask() -> np.ndarray:
    raw = gzip.decompress(OCEAN_MASK_PATH.read_bytes())
    # The mask covers -90..80 degrees at 0.5-degree resolution: 720 x 340.
    # WOA23 itself reaches the North Pole, so its grid height is not reusable here.
    width, height = 720, 340
    if (raw[:4] != b"DAOM" or raw[4] != 1 or raw[5] != 8 or
            len(raw) != 16 + width * height * 8):
        raise RuntimeError("The DiveAtlas bathymetry-derived ocean mask has an unsupported format.")
    return np.frombuffer(raw, dtype=np.uint8, offset=16).reshape(height, width, 8)


def ocean_pixels(latitude: np.ndarray, longitude: np.ndarray, mask: np.ndarray) -> np.ndarray:
    latitude, longitude = np.broadcast_arrays(latitude, longitude)
    row = np.floor((latitude - GRID_SOUTH) / 0.5).astype(np.int32)
    column = np.floor((longitude - GRID_WEST) / 0.5).astype(np.int32) % mask.shape[1]
    inside = (row >= 0) & (row < mask.shape[0])
    safe_row = np.clip(row, 0, mask.shape[0] - 1)
    south = GRID_SOUTH + safe_row * 0.5
    west = GRID_WEST + column * 0.5
    subrow = np.clip(np.floor((latitude - south) * 16).astype(np.int32), 0, 7)
    subcolumn = np.clip(np.floor((longitude - west) * 16).astype(np.int32), 0, 7)
    bits = mask[safe_row, column, subrow]
    return inside & ((bits & (1 << subcolumn)) != 0)


def source_indices(latitude: np.ndarray, longitude: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    rows = np.rint((latitude - GRID_LAT_FIRST) / GRID_STEP).astype(np.int32)
    delta = (longitude - GRID_LON_FIRST + 180.0) % 360.0 - 180.0
    columns = np.rint(delta / GRID_STEP).astype(np.int32) % GRID_WIDTH
    return np.clip(rows, 0, GRID_HEIGHT - 1), columns


def build_slice(values_i16: np.ndarray, mask: np.ndarray, month: int, depth: int) -> dict:
    valid = values_i16 != MISSING
    source_rows, source_columns = np.nonzero(valid)
    if not len(source_rows):
        raise RuntimeError(f"WOA23 month {month}, depth {depth} m has no valid source cells.")
    source_latitudes = GRID_LAT_FIRST + source_rows * GRID_STEP
    source_longitudes = GRID_LON_FIRST + source_columns * GRID_STEP
    tree = cKDTree(sphere_xyz(source_latitudes, source_longitudes))
    chord_limit = 2 * math.sin((RADIUS_KM / EARTH_RADIUS_KM) / 2)
    month_estimated = 0
    month_direct_ocean = 0
    month_estimated_area_weight = 0.0
    month_direct_area_weight = 0.0

    for y in range(1 << ZOOM):
        for x in range(1 << ZOOM):
            longitude, latitude = tile_pixel_coordinates(ZOOM, x, y)
            lon_grid, lat_grid = np.meshgrid(longitude, latitude)
            rows, columns = source_indices(lat_grid, lon_grid)
            direct = valid[rows, columns]
            wet = ocean_pixels(lat_grid, lon_grid, mask)
            eligible = wet & ~direct
            month_direct_ocean += int(np.count_nonzero(wet & direct))
            pixel_area_weight = np.cos(np.deg2rad(lat_grid))
            month_direct_area_weight += float(np.sum(pixel_area_weight[wet & direct]))

            rgba = np.zeros((TILE_SIZE, TILE_SIZE, 4), dtype=np.uint8)
            target_positions = np.flatnonzero(eligible)
            if target_positions.size:
                target_lat = lat_grid.ravel()[target_positions]
                target_lon = lon_grid.ravel()[target_positions]
                points = sphere_xyz(target_lat, target_lon)
                distances, nearest = tree.query(points, k=1, distance_upper_bound=chord_limit, workers=-1)
                supported = np.isfinite(distances) & (nearest < len(source_rows))
                if np.any(supported):
                    positions = target_positions[supported]
                    source_positions = nearest[supported]
                    temperatures = (values_i16[source_rows[source_positions], source_columns[source_positions]] * 0.01).astype(np.float32)
                    colors = colorize(temperatures.reshape(-1, 1), np.ones((len(temperatures), 1), dtype=bool))[:, 0, :]
                    colors[:, 3] = 100
                    rgba.reshape(-1, 4)[positions] = colors
                    month_estimated += int(len(positions))
                    month_estimated_area_weight += float(np.sum(np.cos(np.deg2rad(target_lat[supported]))))

            destination = OUTPUT_ROOT / OUTPUT_TEMPLATE.format(month=f"{month:02d}", depth=depth, z=ZOOM, x=x, y=y)
            destination.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(rgba, mode="RGBA").save(destination, format="PNG", optimize=True)
        print(f"Month {month:02d}, depth {depth:02d} m: rendered tile row {y + 1}/{1 << ZOOM}.")

    eligible_area_weight = month_direct_area_weight + month_estimated_area_weight
    return {
        "month":month, "depth_m":depth, "directOceanPixels":month_direct_ocean,
        "estimatedOceanPixels":month_estimated,
        "estimatedShareOfRenderedOceanPixelsPct":round(100 * month_estimated_area_weight / eligible_area_weight, 3) if eligible_area_weight else 0,
        "maximumEstimateDistanceKm":RADIUS_KM,
        "sourceCells":int(len(source_rows)),
    }


def main() -> int:
    metadata = json.loads(TEMPERATURE_METADATA.read_text(encoding="utf-8"))
    query_metadata = json.loads((QUERY_ROOT / "metadata.json").read_text(encoding="utf-8"))
    if (metadata.get("active_profile") != "production-0.25deg" or
            query_metadata.get("designation") != "production" or
            query_metadata.get("source_product") != "World Ocean Atlas 2023 monthly objectively analyzed temperature"):
        raise RuntimeError("Coverage extension requires the production WOA23 0.25-degree temperature profile.")
    if query_metadata["grid"]["latitude_count"] != GRID_HEIGHT or query_metadata["grid"]["longitude_count"] != GRID_WIDTH:
        raise RuntimeError("WOA23 query source grid does not match the expected 0.25-degree global grid.")
    ocean_mask = load_ocean_mask()
    source_cache = load_source_cache(query_metadata)
    results = []
    for month_index, month in enumerate(query_metadata["available_months"]):
        for depth_index, depth in enumerate(query_metadata["available_depths_m"]):
            results.append(build_slice(source_cache[month_index, depth_index], ocean_mask, int(month), int(depth)))
    source_cache.flush()
    del source_cache
    metadata["estimated_tile_template"] = OUTPUT_TEMPLATE
    metadata["missing_data"] = "Direct WOA23 t_an cells are shown at full source opacity. Elsewhere, same-month and same-depth nearest valid cells within 25 km are drawn as subdued estimates only over GEBCO-mask-confirmed ocean pixels."
    metadata["coast_mask"] = "Direct WOA23 t_an missing/land cells remain transparent in the source layer; estimate tiles additionally require a GEBCO-derived wet subcell."
    metadata["estimated_tile_layer"] = {
        "method":"Nearest valid WOA23 cell at the same month and depth; no temporal/depth mixing or interpolation.",
        "maximum_distance_km":RADIUS_KM,
        "oceanMask":"data/dive_conditions_score/ocean-mask.bin.gz; GEBCO-derived wet subcells only.",
        "visualEncoding":"Estimated pixels use the same temperature palette at 100/255 source alpha; direct WOA23 pixels remain opaque in the original tile layer.",
        "sourceResolutionDegrees":GRID_STEP,
        "validation":"Uses the existing 25 km supported sampling limit; no greater-radius extrapolation is published."
    }
    metadata["estimated_tile_generation_version"] = "woa23-nearest-ocean-25km-v1"
    metadata["estimated_tile_coverage"] = results
    TEMPERATURE_METADATA.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    report_path = OUTPUT_ROOT / "estimated-nearest-25km" / "coverage-manifest.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps({
        "format":"diveatlas-temperature-estimated-map-coverage", "version":1,
        "source":"WOA23 monthly objectively analyzed temperature, 1991-2020", "radiusKm":RADIUS_KM,
        "depths_m":query_metadata["available_depths_m"], "months":query_metadata["available_months"],
        "rule":"Only directly masked pixels that fall on a bathymetry-confirmed ocean subcell are eligible; each estimate copies the nearest valid source cell with the same month and depth.",
        "slices":results
    }, indent=2) + "\n", encoding="utf-8")
    print(f"Built {len(results)} month-depth temperature coverage extensions at no more than {RADIUS_KM:g} km.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"temperature coverage extension failed: {error}", file=sys.stderr)
        raise SystemExit(1)
