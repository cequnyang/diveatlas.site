"""Build the compact Reef Condition thermal-history layer from CRW annual data."""

from __future__ import annotations

import argparse
import gzip
import json
import math
import shutil
import struct
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
POINT_HEADER = struct.Struct("<4sBHHHHI")
SUMMARY_HEADER = struct.Struct("<4sBBHHH")
POINT_RECORD = struct.Struct("<H")
SUMMARY_CELL = struct.Struct("<6BHHHHHH10H")
TILE_SIZE = 256
MAP_ZOOM = 5
MISSING_BYTE = 255
MISSING_YEAR = 65535
STRESS_THRESHOLD = 4.0
SEVERE_THRESHOLD = 8.0
RECENT_YEARS = 10
SOURCE_PAGE_URL = "https://coralreefwatch.noaa.gov/product/thermal_history/annual_history.php"
COLORS = np.asarray([
    (120, 146, 137),
    (218, 185, 80),
    (237, 144, 43),
    (223, 83, 43),
    (183, 43, 52),
    (112, 36, 105),
], dtype=np.uint8)
ALPHAS = np.asarray([24, 86, 132, 174, 214, 238], dtype=np.uint8)


def _text(value) -> str:
    return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else str(value)


def summary_for_point_tile(payload: bytes, years: list[int], *, threshold: float = STRESS_THRESHOLD,
                           severe_threshold: float = SEVERE_THRESHOLD, recent_years: int = RECENT_YEARS) -> tuple[bytes, list[tuple[int, tuple]]]:
    """Summarize one validated DCHH chunk and return a fixed-grid DCHR payload."""
    if len(payload) < POINT_HEADER.size:
        raise ValueError("Annual-history point chunk is truncated")
    magic, version, tile_size, year_count, tile_column, tile_row, record_count = POINT_HEADER.unpack_from(payload)
    record_size = POINT_RECORD.size + year_count * 4
    if (magic != b"DCHH" or version != 1 or tile_size != TILE_SIZE or year_count != len(years) or
            len(payload) != POINT_HEADER.size + record_count * record_size):
        raise ValueError("Annual-history point chunk has an unsupported header or length")
    if not years or any(years[index] >= years[index + 1] for index in range(len(years) - 1)):
        raise ValueError("Annual-history years must be strictly increasing")
    recent_start_index = max(0, len(years) - recent_years)
    recent_values: list[tuple[int, tuple]] = []
    previous_cell = -1
    for record_index in range(record_count):
        offset = POINT_HEADER.size + record_index * record_size
        (cell_id,) = POINT_RECORD.unpack_from(payload, offset)
        if cell_id <= previous_cell or cell_id >= TILE_SIZE * TILE_SIZE:
            raise ValueError("Annual-history point cell indices must be sorted and unique")
        previous_cell = cell_id
        values = np.frombuffer(payload, dtype="<f4", count=year_count, offset=offset + POINT_RECORD.size)
        valid = np.isfinite(values)
        if np.any(valid & (values < 0)):
            raise ValueError("Annual maximum DHW values cannot be negative")
        if not valid.any():
            continue
        recent_valid = valid[recent_start_index:]
        recent_series = values[recent_start_index:]
        full_indices = np.flatnonzero(valid)
        recent_indices = np.flatnonzero(recent_valid)
        full_max_index = int(full_indices[np.argmax(values[full_indices])])
        full_severe = np.flatnonzero(valid & (values >= severe_threshold))
        recent_severe = np.flatnonzero(recent_valid & (recent_series >= severe_threshold))
        recent_max_index = int(recent_indices[np.argmax(recent_series[recent_indices])]) if recent_indices.size else -1
        recent_max = float(recent_series[recent_max_index]) if recent_max_index >= 0 else float("nan")
        def dhw_hundredths(value: float) -> int:
            if not math.isfinite(value):
                return MISSING_YEAR
            scaled = round(value * 100)
            if scaled < 0 or scaled >= MISSING_YEAR:
                raise ValueError("Annual maximum DHW exceeds the supported query precision range")
            return int(scaled)

        cell = (
            int(valid.sum()), int(recent_valid.sum()),
            int(np.count_nonzero(valid & (values >= threshold))),
            int(np.count_nonzero(valid & (values >= severe_threshold))),
            int(np.count_nonzero(recent_valid & (recent_series >= threshold))),
            int(np.count_nonzero(recent_valid & (recent_series >= severe_threshold))),
            years[int(full_severe[-1])] if full_severe.size else MISSING_YEAR,
            years[recent_start_index + int(recent_severe[-1])] if recent_severe.size else MISSING_YEAR,
            dhw_hundredths(recent_max),
            years[recent_start_index + recent_max_index] if recent_max_index >= 0 else MISSING_YEAR,
            dhw_hundredths(float(values[full_max_index])), years[full_max_index],
            *[dhw_hundredths(float(value)) for value in recent_series],
        )
        recent_values.append((cell_id, cell))
    body = bytearray([MISSING_BYTE] * (TILE_SIZE * TILE_SIZE * SUMMARY_CELL.size))
    for cell_id, values in recent_values:
        SUMMARY_CELL.pack_into(body, cell_id * SUMMARY_CELL.size, *values)
    header = SUMMARY_HEADER.pack(b"DCHR", 2, SUMMARY_CELL.size, TILE_SIZE, tile_column, tile_row)
    return header + body, recent_values


def _map_indices(longitude_min: float, longitude_step: float, latitude_min: float, latitude_step: float,
                 grid_width: int, grid_height: int):
    world = TILE_SIZE * (1 << MAP_ZOOM)
    pixel_x = np.arange(world, dtype=np.float64)
    longitude = -180.0 + (pixel_x + 0.5) * (360.0 / world)
    grid_lon = np.rint((longitude - longitude_min) / longitude_step).astype(np.int64) % grid_width
    pixel_y = np.arange(world, dtype=np.float64) + 0.5
    latitude = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * pixel_y / world))))
    grid_lat = np.rint((latitude - latitude_min) / latitude_step).astype(np.int64)
    return grid_lon, grid_lat, (grid_lat >= 0) & (grid_lat < grid_height)


def severity_bins(values: np.ndarray) -> np.ndarray:
    """Map annual maximum DHW to six non-overlapping severity bands."""
    return np.select([values < 4, values < 8, values < 12, values < 16, values < 20],
                     [0, 1, 2, 3, 4], default=5).astype(np.uint8)


def _write_map_tiles(recent_max_dhw: np.ndarray, output: Path, *, longitude_min: float, longitude_step: float,
                     latitude_min: float, latitude_step: float) -> tuple[int, int]:
    height, width = recent_max_dhw.shape
    grid_lon, grid_lat, valid_rows = _map_indices(
        longitude_min, longitude_step, latitude_min, latitude_step, width, height,
    )
    tile_count = 0
    total_bytes = 0
    world_size = TILE_SIZE * (1 << MAP_ZOOM)
    native = np.full((world_size, world_size), MISSING_BYTE, dtype=np.uint8)
    for pixel_row in np.flatnonzero(valid_rows):
        sampled_values = recent_max_dhw[grid_lat[pixel_row], grid_lon]
        known = np.isfinite(sampled_values)
        native[pixel_row, known] = severity_bins(sampled_values[known])

    zoom = MAP_ZOOM
    while zoom >= 0:
        for tile_y in range(1 << zoom):
            row_start = tile_y * TILE_SIZE
            for tile_x in range(1 << zoom):
                column_start = tile_x * TILE_SIZE
                bins = native[row_start:row_start + TILE_SIZE, column_start:column_start + TILE_SIZE]
                rgba = np.zeros((TILE_SIZE, TILE_SIZE, 4), dtype=np.uint8)
                visible = bins != MISSING_BYTE
                rgba[visible, :3] = COLORS[bins[visible]]
                rgba[visible, 3] = ALPHAS[bins[visible]]
                target = output / str(zoom) / str(tile_x) / f"{tile_y}.png"
                target.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(rgba, "RGBA").save(target, optimize=True)
                tile_count += 1
                total_bytes += target.stat().st_size

        if zoom == 0:
            break
        # Overview pixels preserve the strongest observed category in their source
        # footprint, so narrow reef stress signals do not vanish while zoomed out.
        paired = native.reshape(native.shape[0] // 2, 2, native.shape[1] // 2, 2)
        has_data = np.any(paired != MISSING_BYTE, axis=(1, 3))
        strongest = np.max(np.where(paired == MISSING_BYTE, 0, paired), axis=(1, 3))
        native = np.where(has_data, strongest, MISSING_BYTE).astype(np.uint8)
        zoom -= 1
    return tile_count, total_bytes


def build(input_metadata: Path, output: Path, *, force: bool = False) -> dict:
    input_metadata = input_metadata.resolve()
    output = output.resolve()
    metadata = json.loads(input_metadata.read_text(encoding="utf-8"))
    years = metadata.get("years")
    grid = metadata.get("grid", {})
    if (metadata.get("source") != "NOAA Coral Reef Watch" or
            metadata.get("product") != "Thermal History Annual History" or
            metadata.get("variable") != "ann_max_dhw" or metadata.get("units") != "degrees_Celsius-weeks" or
            metadata.get("productVersion") != "3.7.0" or not isinstance(years, list) or
            not years or years != list(range(years[0], years[-1] + 1))):
        raise ValueError("Input must be a complete NOAA CRW Thermal History annual-history release")
    if (grid.get("width") != 7200 or grid.get("height") != 1390 or
            grid.get("row_order") != "south-to-north" or
            not np.isclose(float(grid.get("longitude_step", 0)), 0.05, atol=2e-5) or
            not np.isclose(float(grid.get("latitude_step", 0)), 0.05, atol=2e-5)):
        raise ValueError("Input Thermal History grid differs from the verified NOAA 0.05-degree analyzed grid")
    input_root = ROOT / metadata["asset_base"]
    point_template = metadata.get("pointTileTemplate", "points/{column}_{row}.bin.gz")
    rows, columns = grid["height"], grid["width"]
    recent_max_dhw = np.full((rows, columns), np.nan, dtype=np.float32)
    query_root = Path(tempfile.mkdtemp(prefix="reef-thermal-summary-", dir=output.parent if output.parent.exists() else ROOT / "data"))
    stage = query_root / "stage"
    map_root = stage / "tiles"
    query_out = stage / "query"
    try:
        query_out.mkdir(parents=True)
        query_files = []
        recent_start = max(years[0], years[-1] - RECENT_YEARS + 1)
        for tile_row in range(math.ceil(rows / TILE_SIZE)):
            for tile_column in range(math.ceil(columns / TILE_SIZE)):
                relative = point_template.replace("{column}", str(tile_column)).replace("{row}", str(tile_row))
                source_path = input_root / relative
                if not source_path.is_file():
                    raise FileNotFoundError(f"Annual-history point tile is missing: {source_path}")
                raw = gzip.decompress(source_path.read_bytes())
                summary, values = summary_for_point_tile(raw, years)
                _, _, _, _, source_column, source_row, _ = POINT_HEADER.unpack_from(raw)
                if source_column != tile_column or source_row != tile_row:
                    raise ValueError(f"Annual-history point tile address does not match its path: {source_path}")
                query_path = query_out / f"{tile_column}_{tile_row}.bin.gz"
                query_path.write_bytes(gzip.compress(summary, compresslevel=6, mtime=0))
                query_files.append(query_path)
                row0, column0 = tile_row * TILE_SIZE, tile_column * TILE_SIZE
                tile_view = recent_max_dhw[row0:min(rows, row0 + TILE_SIZE), column0:min(columns, column0 + TILE_SIZE)]
                for cell_id, cell in values:
                    local_row, local_column = divmod(cell_id, TILE_SIZE)
                    tile_view[local_row, local_column] = cell[8] / 100
        count, map_bytes = _write_map_tiles(
            recent_max_dhw, map_root, longitude_min=float(grid["longitude_min"]), longitude_step=float(grid["longitude_step"]),
            latitude_min=float(grid["latitude_min"]), latitude_step=float(grid["latitude_step"]),
        )
        map_files = list(map_root.rglob("*.png"))
        query_bytes = sum(path.stat().st_size for path in query_files)
        assets_bytes = map_bytes + query_bytes
        period = {"fullStart": years[0], "fullEnd": years[-1], "recentStart": recent_start, "recentEnd": years[-1]}
        result = {
            "schema_version": 1,
            "provider": "NOAA Coral Reef Watch",
            "product": "Thermal History Annual History",
            "productVersion": metadata["productVersion"],
            "sourceUrl": metadata["sourceUrl"],
            "sourcePageUrl": SOURCE_PAGE_URL,
            "sourceMetadata": "Annual maximum Degree Heating Week (DHW) from NOAA CRW CoralTemp Thermal History. DHW represents accumulated thermal-stress exposure; threshold crossings do not confirm observed bleaching or mortality.",
            "attribution": "NOAA Coral Reef Watch",
            "variable": "ann_max_dhw",
            "units": "degrees_Celsius-weeks",
            "periods": period,
            "thresholds": [4, 8, 12, 16, 20],
            "recentYears": RECENT_YEARS,
            "asset_base": "data/reef-condition/thermal-stress-history",
            "map_tile_template": "tiles/{z}/{x}/{y}.png",
            "query_tile_template": "query/{column}_{row}.bin.gz",
            "version": f"crw-{metadata['productVersion']}-{years[0]}-{years[-1]}-recent-max-v2-pyramid-v1",
            "grid": {key: grid[key] for key in ("width", "height", "longitude_min", "longitude_step", "latitude_min", "latitude_step", "row_order")},
            "encoding": {"missing": MISSING_BYTE, "query_tile_size_cells": TILE_SIZE, "query_bytes_per_cell": SUMMARY_CELL.size,
                         "min_zoom": 0,
                         "map_zoom": MAP_ZOOM, "max_native_zoom": MAP_ZOOM,
                         "map_format": "transparent RGBA PNG XYZ pyramid; z0-z4 show the strongest source category per overview pixel, z5 samples nearest NOAA source cells",
                         "query_format": "gzip DCHR v2; yearly counts, full/recent extrema, and ten recent annual DHW values as uint16 hundredths"},
            "categories": ["<4 · Lower accumulated heat stress", "4–<8 · Bleaching-level heat stress", "8–<12 · Severe heat stress", "12–<16 · Very severe heat stress", "16–<20 · Extreme heat stress", "20+ · Exceptional heat stress"],
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "sourceSizeBytes": metadata.get("sourceSizeBytes"),
            "sourceRelease": metadata.get("release"),
            "sourcePeriod": {"start": years[0], "end": years[-1]},
            "assets": {"mapTileCount": count, "mapBytes": map_bytes, "queryTileCount": len(query_files), "queryBytes": query_bytes, "totalBytes": assets_bytes},
        }
        expected_map_tiles = sum((1 << zoom) ** 2 for zoom in range(MAP_ZOOM + 1))
        if len(map_files) != expected_map_tiles or len(query_files) != math.ceil(columns / TILE_SIZE) * math.ceil(rows / TILE_SIZE):
            raise ValueError("Generated NOAA thermal-history tiles are incomplete")
        if output.exists() and not force:
            raise FileExistsError(f"Thermal-history summary already exists: {output}; pass --force to create a revision")
        stage.mkdir(parents=True, exist_ok=True)
        (stage / "metadata.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        if output.exists():
            shutil.rmtree(output)
        shutil.copytree(stage, output)
        return result
    finally:
        shutil.rmtree(query_root, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-metadata", type=Path, default=Path("data/coral-heat-stress/history/metadata.json"))
    parser.add_argument("--output", type=Path, default=Path("data/reef-condition/thermal-stress-history"))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    result = build(args.input_metadata, args.output, force=args.force)
    print(json.dumps({"output": str(args.output), "period": result["periods"], "assets": result["assets"]}, indent=2))


if __name__ == "__main__":
    main()
