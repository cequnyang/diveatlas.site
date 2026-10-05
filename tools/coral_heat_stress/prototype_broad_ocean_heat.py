#!/usr/bin/env python3
"""Build an ignored, single-date NOAA MHW spatial-coverage prototype.

This is deliberately a dated snapshot, not a decadal summary. It tests the
global footprint, tile payload, and click-query plumbing before any historical
aggregation is chosen. Source data and generated assets stay under data/.build.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import struct
from pathlib import Path

import numpy as np
from netCDF4 import Dataset
from PIL import Image


SOURCE_GRID = (3600, 7200)
AGGREGATION = 5  # 5x5 source cells produce an approximately 25 km context cell.
GRID_HEIGHT, GRID_WIDTH = SOURCE_GRID[0] // AGGREGATION, SOURCE_GRID[1] // AGGREGATION
CELL_DEGREES = 0.25
QUERY_TILE_SIZE = 256
FILL = 255
COLORS = (
    (103, 184, 205, 36),  # category 0: ocean baseline, intentionally subtle
    (245, 213, 92, 92),
    (244, 155, 65, 112),
    (229, 91, 59, 132),
    (178, 55, 68, 154),
    (105, 47, 112, 170),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="One NOAA MHW category NetCDF file")
    parser.add_argument("--date", required=True, help="Source observation date, YYYY-MM-DD")
    parser.add_argument(
        "--output", type=Path,
        default=Path("data/.build/reef_condition/ocean-heat-prototype"),
        help="Ignored local output directory",
    )
    return parser.parse_args()


def read_source(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    with Dataset(path) as dataset:
        category_var = dataset.variables.get("heatwave_category")
        mask_var = dataset.variables.get("mask")
        lat = np.asarray(dataset.variables["lat"][:], dtype=np.float64)
        lon = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
        if category_var is None or mask_var is None or category_var.shape != (1, *SOURCE_GRID):
            raise ValueError("Unsupported NOAA MHW file: expected one 3600 x 7200 heatwave_category grid.")
        if not np.all(np.diff(lat) > 0) or not np.all(np.diff(lon) > 0):
            raise ValueError("Source coordinates must be regularly ordered south-to-north and west-to-east.")
        category = np.asarray(category_var[0, :, :].filled(FILL), dtype=np.uint8)
        mask = np.asarray(mask_var[0, :, :].filled(FILL), dtype=np.uint8)
    ocean = (mask == 0) & (category <= 5)
    if not ocean.any():
        raise ValueError("Source contains no valid ocean category cells.")
    return category, ocean, lat


def aggregate(category: np.ndarray, ocean: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    categories = category.reshape(GRID_HEIGHT, AGGREGATION, GRID_WIDTH, AGGREGATION)
    valid = ocean.reshape(GRID_HEIGHT, AGGREGATION, GRID_WIDTH, AGGREGATION)
    block_values = np.where(valid, categories, 0).max(axis=(1, 3)).astype(np.uint8)
    block_ocean = valid.any(axis=(1, 3))
    block_values[~block_ocean] = FILL
    return block_values, block_ocean


def web_mercator_lat(y_fraction: np.ndarray) -> np.ndarray:
    return np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * y_fraction))))


def make_tile(grid: np.ndarray, zoom: int, tile_x: int, tile_y: int) -> Image.Image:
    world_pixels = 256 * (1 << zoom)
    px = tile_x * 256 + np.arange(256) + 0.5
    py = tile_y * 256 + np.arange(256) + 0.5
    longitudes = px / world_pixels * 360 - 180
    latitudes = web_mercator_lat(py / world_pixels)
    cols = np.clip(np.floor((longitudes + 179.875) / CELL_DEGREES).astype(int), 0, GRID_WIDTH - 1)
    rows = np.clip(np.floor((latitudes + 89.875) / CELL_DEGREES).astype(int), 0, GRID_HEIGHT - 1)
    values = grid[np.ix_(rows, cols)]
    rgba = np.zeros((256, 256, 4), dtype=np.uint8)
    for value, color in enumerate(COLORS):
        rgba[values == value] = color
    return Image.fromarray(rgba, "RGBA")


def write_tiles(grid: np.ndarray, root: Path) -> tuple[int, int]:
    count = 0
    total_bytes = 0
    for zoom in range(0, 6):
        side = 1 << zoom
        for tile_y in range(side):
            for tile_x in range(side):
                image = make_tile(grid, zoom, tile_x, tile_y)
                path = root / "tiles" / str(zoom) / str(tile_x) / f"{tile_y}.png"
                path.parent.mkdir(parents=True, exist_ok=True)
                image.save(path, format="PNG", optimize=True)
                count += 1
                total_bytes += path.stat().st_size
    return count, total_bytes


def write_queries(grid: np.ndarray, root: Path) -> tuple[int, int]:
    count = 0
    total_bytes = 0
    for tile_y in range(math.ceil(GRID_HEIGHT / QUERY_TILE_SIZE)):
        for tile_x in range(math.ceil(GRID_WIDTH / QUERY_TILE_SIZE)):
            block = np.full((QUERY_TILE_SIZE, QUERY_TILE_SIZE), FILL, dtype=np.uint8)
            y0, x0 = tile_y * QUERY_TILE_SIZE, tile_x * QUERY_TILE_SIZE
            view = grid[y0:min(y0 + QUERY_TILE_SIZE, GRID_HEIGHT), x0:min(x0 + QUERY_TILE_SIZE, GRID_WIDTH)]
            block[:view.shape[0], :view.shape[1]] = view
            header = struct.pack("<4sHH", b"BOH1", tile_x, tile_y)
            payload = gzip.compress(header + block.tobytes(), compresslevel=9, mtime=0)
            path = root / "query" / f"{tile_x}_{tile_y}.bin.gz"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
            count += 1
            total_bytes += len(payload)
    return count, total_bytes


def coverage_area_km2(ocean: np.ndarray, latitude_centers: np.ndarray, step: float) -> float:
    dlon = math.radians(step)
    radius = 6_371_008.8
    row_area = radius**2 * dlon * (
        np.sin(np.radians(latitude_centers + step / 2))
        - np.sin(np.radians(latitude_centers - step / 2))
    )
    return float((ocean.sum(axis=1) * row_area).sum() / 1_000_000)


def main() -> None:
    args = parse_args()
    if not args.source.is_file():
        raise SystemExit(f"Source NetCDF not found: {args.source}")
    date = args.date
    try:
        from datetime import date as date_type
        date_type.fromisoformat(date)
    except ValueError as error:
        raise SystemExit("--date must be a valid YYYY-MM-DD date") from error

    source_category, source_ocean, source_lat = read_source(args.source)
    grid, ocean = aggregate(source_category, source_ocean)
    args.output.mkdir(parents=True, exist_ok=True)
    map_count, map_bytes = write_tiles(grid, args.output)
    query_count, query_bytes = write_queries(grid, args.output)
    ocean_area = coverage_area_km2(source_ocean, source_lat, 0.05)
    metadata = {
        "prototype": True,
        "provider": "NOAA Coral Reef Watch",
        "product": "Daily Global 5km Satellite Marine Heatwave Watch",
        "productVersion": "1.0.1",
        "sourceDate": date,
        "sourceFileBytes": args.source.stat().st_size,
        "variable": "heatwave_category",
        "sourceResolutionDegrees": 0.05,
        "displayResolutionDegrees": CELL_DEGREES,
        "displayAggregation": "maximum category within each 5x5 source-cell block",
        "categories": ["No marine heatwave", "Moderate", "Strong", "Severe", "Extreme", "Beyond extreme"],
        "latitudeCoverage": [
            round(float(source_lat[np.flatnonzero(source_ocean.any(axis=1))[0]]), 3),
            round(float(source_lat[np.flatnonzero(source_ocean.any(axis=1))[-1]]), 3),
        ],
        "validOceanCellCount": int(source_ocean.sum()),
        "displayCellCount": int(ocean.sum()),
        "coveredOceanAreaKm2": round(ocean_area),
        "globalOceanAreaCoveragePct": round(ocean_area / 361_900_000 * 100, 2),
        "assetBase": "data/.build/reef_condition/ocean-heat-prototype",
        "tileTemplate": "tiles/{z}/{x}/{y}.png",
        "queryTemplate": "query/{column}_{row}.bin.gz",
        "grid": {"width": GRID_WIDTH, "height": GRID_HEIGHT, "longitudeMin": -179.875, "latitudeMin": -89.875, "step": CELL_DEGREES},
        "queryTileSize": QUERY_TILE_SIZE,
        "queryHeader": "BOH1 + little-endian uint16 tile column/row + 256x256 uint8 categories (255=missing)",
        "assets": {"tileCount": map_count, "tileBytes": map_bytes, "queryChunkCount": query_count, "queryBytes": query_bytes},
        "attribution": "NOAA Coral Reef Watch Marine Heatwave Watch",
        "sourceUrl": "https://www.coralreefwatch.noaa.gov/product/marine_heatwave/",
        "semantics": "Dated broad-ocean marine heatwave category snapshot; not coral bleaching, reef damage, or a decade summary.",
    }
    (args.output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
