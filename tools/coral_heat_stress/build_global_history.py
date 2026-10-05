"""Build a separately published global-map pilot from NOAA annual DHW composites."""

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

import netCDF4
import numpy as np
from PIL import Image

from .thermal_style import HISTORY_COLORS, HISTORY_CONTEXT_ALPHA, HISTORY_REEF_ALPHA, read_history_reef_mask

YEARS = tuple(range(2016, 2026))
MAP_ZOOM = 5
SOURCE_DIRECTORY = "https://www.star.nesdis.noaa.gov/pub/sod/mecb/crw/data/5km/v3.1_op/nc/v1.0/annual/"
VARIABLE = "degree_heating_week"
MAP_COLORS = np.asarray([
    tuple(int(color[index:index + 2], 16) for index in (1, 3, 5))
    for color in ("#f8edc6", *HISTORY_COLORS)
], dtype=np.uint8)
CONTEXT_ALPHA = np.asarray(HISTORY_CONTEXT_ALPHA, dtype=np.uint8)
REEF_ALPHA = np.asarray(HISTORY_REEF_ALPHA, dtype=np.uint8)
MAP_ALPHA = np.asarray([0, *REEF_ALPHA], dtype=np.uint8)
BINS = np.array([0, 4, 8, 12, 16, 20], dtype=np.float32)
VALUE_TILE_SIZE = 256
VALUE_MISSING = np.uint16(65535)
VALUE_TILE_HEADER = struct.Struct("<4sBHHHHI")


def _source_name(year: int) -> str:
    return f"ct5km_dhw-max_v3.1_{year}.nc"


def _coordinates(dataset: netCDF4.Dataset) -> tuple[np.ndarray, np.ndarray]:
    latitude = np.asarray(dataset.variables["lat"][:], dtype=np.float64)
    longitude = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
    if latitude.shape != (3600,) or longitude.shape != (7200,):
        raise ValueError("NOAA annual composite is not the verified 3600x7200 global grid")
    if not np.allclose(np.diff(latitude), -0.05, atol=2e-5, rtol=0) or not np.allclose(np.diff(longitude), 0.05, atol=2e-5, rtol=0):
        raise ValueError("NOAA annual composite coordinates are not regular 0.05-degree centers")
    if not np.isclose(latitude[0], 89.975, atol=2e-5) or not np.isclose(longitude[0], -179.975, atol=2e-5):
        raise ValueError("NOAA annual composite coordinate origin changed")
    return latitude, longitude


def _read_year(source: Path, year: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict]:
    if not source.is_file():
        raise FileNotFoundError(f"Missing NOAA annual composite: {source}")
    with netCDF4.Dataset(source, "r") as dataset:
        if VARIABLE not in dataset.variables:
            raise ValueError(f"NOAA annual composite lacks {VARIABLE}")
        variable = dataset.variables[VARIABLE]
        if variable.dimensions != ("time", "lat", "lon") or variable.shape != (1, 3600, 7200):
            raise ValueError(f"Unexpected NOAA annual composite dimensions for {year}")
        if float(getattr(variable, "scale_factor", np.nan)) != 0.01 or str(variable.units) not in ("degree_Celsius_weeks", "degrees_Celsius-weeks"):
            raise ValueError("NOAA annual DHW packing or units changed")
        latitude, longitude = _coordinates(dataset)
        coverage_start = str(dataset.time_coverage_start)
        coverage_end = str(dataset.time_coverage_end)
        if coverage_start[:4] != str(year) or coverage_end[:4] not in (str(year), str(year + 1)):
            raise ValueError(f"NOAA annual composite coverage metadata is inconsistent for {year}")
        variable.set_auto_maskandscale(True)
        values = np.asarray(variable[0, :, :].filled(np.nan), dtype=np.float32)
        valid = np.isfinite(values)
        valid_values = values[valid]
        if not valid.any() or valid_values.min() < 0 or valid_values.max() > 100:
            raise ValueError(f"NOAA annual composite has invalid global values for {year}")
        source_metadata = {
            "url": SOURCE_DIRECTORY + source.name,
            "productId": str(dataset.id),
            "title": str(dataset.title),
            "variable": VARIABLE,
            "dimensions": {"time": 1, "latitude": len(latitude), "longitude": len(longitude)},
            "resolution": "0.05 degree (~5 km at the equator)",
            "units": str(variable.units),
            "fillValuePacked": int(variable._FillValue),
            "scaleFactor": float(variable.scale_factor),
            "coverageStart": coverage_start,
            "coverageEnd": coverage_end,
            "fileBytes": source.stat().st_size,
            "validCells": int(valid.sum()),
            "min": float(valid_values.min()),
            "max": float(valid_values.max()),
            "globalCoverage": "Valid cells throughout NOAA's global 5 km grid; land and ocean retrieval gaps use the NOAA fill value.",
        }
        longitude = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
    return values, valid, latitude, longitude, source_metadata


def _mercator_indices(latitude: np.ndarray):
    world = 256 * (1 << MAP_ZOOM)
    x = np.arange(world, dtype=np.float64)
    longitude = -180 + (x + 0.5) * (360 / world)
    columns = np.rint((longitude + 179.975) / 0.05).astype(np.int64) % 7200
    y = np.arange(world, dtype=np.float64) + 0.5
    tile_latitude = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * y / world))))
    rows = np.rint((tile_latitude - float(latitude[0])) / float(latitude[1] - latitude[0])).astype(np.int64)
    return columns, rows, (rows >= 0) & (rows < len(latitude))


def _render_tiles(values: np.ndarray, valid: np.ndarray, latitude: np.ndarray,
                  reef_mask: np.ndarray, output: Path) -> dict:
    columns, rows, row_valid = _mercator_indices(latitude)
    tile_count = 0
    bytes_by_tile = []
    rendered_valid = 0
    world_tiles = 1 << MAP_ZOOM
    for tile_y in range(world_tiles):
        ys = slice(tile_y * 256, (tile_y + 1) * 256)
        selected_rows = rows[ys]
        good_rows = row_valid[ys]
        for tile_x in range(world_tiles):
            xs = slice(tile_x * 256, (tile_x + 1) * 256)
            source_columns = columns[xs]
            bins = np.zeros((256, 256), dtype=np.uint8)
            cell_valid = np.zeros((256, 256), dtype=bool)
            reef = np.zeros((256, 256), dtype=bool)
            if np.any(good_rows):
                rr = selected_rows[good_rows, None]
                cc = source_columns[None, :]
                cell_valid[good_rows] = valid[rr, cc]
                reef[good_rows] = reef_mask[rr, cc]
                data = values[rr, cc]
                stressed = cell_valid[good_rows] & (data > 0)
                band = np.zeros(data.shape, dtype=np.uint8)
                band[stressed] = np.searchsorted(BINS, data[stressed], side="right").astype(np.uint8)
                bins[good_rows] = band
            rgba = np.zeros((256, 256, 4), dtype=np.uint8)
            painted = cell_valid & (bins > 0)
            rgba[painted, :3] = MAP_COLORS[bins[painted]]
            alpha = np.zeros((256, 256), dtype=np.uint8)
            base = MAP_ALPHA[bins[painted]].astype(np.float32)
            alpha[painted] = np.where(reef[painted], base, CONTEXT_ALPHA[bins[painted]]).astype(np.uint8)
            rgba[:, :, 3] = alpha
            target = output / str(MAP_ZOOM) / str(tile_x) / f"{tile_y}.png"
            target.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(rgba, "RGBA").save(target, optimize=True)
            tile_count += 1
            bytes_by_tile.append(target.stat().st_size)
            rendered_valid += int(cell_valid.sum())
    sizes = np.asarray(bytes_by_tile, dtype=np.int64)
    return {
        "tileCount": tile_count,
        "bytes": int(sizes.sum()),
        "medianTileBytes": int(np.median(sizes)),
        "p95TileBytes": int(np.percentile(sizes, 95)),
        "largestTileBytes": int(sizes.max()),
        "renderedValidTilePixels": rendered_valid,
    }


def _write_value_tiles(values: np.ndarray, valid: np.ndarray, output: Path) -> dict:
    """Publish lossless hundredth-DHW grids so map clicks can query the same global product."""
    rows, columns = values.shape
    tile_rows = math.ceil(rows / VALUE_TILE_SIZE)
    tile_columns = math.ceil(columns / VALUE_TILE_SIZE)
    tile_count = 0
    total_bytes = 0
    for tile_row in range(tile_rows):
        row_start = tile_row * VALUE_TILE_SIZE
        row_end = min(rows, row_start + VALUE_TILE_SIZE)
        for tile_column in range(tile_columns):
            column_start = tile_column * VALUE_TILE_SIZE
            column_end = min(columns, column_start + VALUE_TILE_SIZE)
            valid_chunk = valid[row_start:row_end, column_start:column_end]
            count = int(valid_chunk.sum())
            if not count:
                continue
            packed = np.full((VALUE_TILE_SIZE, VALUE_TILE_SIZE), VALUE_MISSING, dtype="<u2")
            chunk = values[row_start:row_end, column_start:column_end]
            encoded = np.rint(chunk[valid_chunk] * 100).astype(np.uint16)
            if np.any(encoded == VALUE_MISSING) or np.any(np.abs(encoded.astype(np.float32) / 100 - chunk[valid_chunk]) > 0.001):
                raise ValueError("NOAA global DHW values cannot be represented in hundredths")
            packed[:row_end - row_start, :column_end - column_start][valid_chunk] = encoded
            header = VALUE_TILE_HEADER.pack(b"DCHG", 1, VALUE_TILE_SIZE, tile_column, tile_row, 0, count)
            payload = gzip.compress(header + packed.tobytes(), compresslevel=6, mtime=0)
            target = output / f"{tile_column}_{tile_row}.bin.gz"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            tile_count += 1
            total_bytes += len(payload)
    return {"tileCount": tile_count, "bytes": total_bytes, "tileSizeCells": VALUE_TILE_SIZE,
            "headerBytes": VALUE_TILE_HEADER.size, "recordBytes": 2, "missing": int(VALUE_MISSING),
            "scaleFactor": 0.01}


def _validate_history_year(source: Path, year: int, latitude: np.ndarray,
                           longitude: np.ndarray,
                           global_values: np.ndarray, global_valid: np.ndarray) -> dict:
    with netCDF4.Dataset(source, "r") as dataset:
        dhw = dataset.variables["ann_max_dhw"]
        dhw.set_auto_maskandscale(False)
        source_latitude = np.asarray(dataset.variables["lat"][:], dtype=np.float64)
        source_longitude = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
        source_reef = np.asarray(dataset.variables["reef_mask"][:], dtype=np.uint8) == 1
        source_years = np.asarray(dataset.variables["years"][:], dtype=np.int32)
        column_index = np.rint((source_longitude - longitude[0]) / 0.05).astype(np.int64)
        # Convert the ascending history rows into the descending global-composite grid.
        global_rows = np.rint((latitude[0] - source_latitude) / 0.05).astype(np.int64)
        if not np.allclose(latitude[global_rows], source_latitude, atol=2e-5, rtol=0):
            raise ValueError("NOAA global and point-history latitude grids do not align")
        if not np.allclose(longitude[column_index], source_longitude, atol=2e-5, rtol=0):
            raise ValueError("NOAA global and point-history longitude grids do not align")
        annual = global_values[np.ix_(global_rows, column_index)]
        valid = source_reef & global_valid[np.ix_(global_rows, column_index)]
        point = np.asarray(dhw[year - int(source_years[0]), :, :], dtype=np.float32)
        valid &= np.isfinite(point) & (point < 1e30)
        delta = np.abs(annual[valid] - point[valid])
        if not len(delta):
            raise ValueError(f"No overlapping valid NOAA reef pixels for {year}")
        global_samples = annual[valid]
        point_samples = point[valid]
        global_bands = np.where(global_samples > 0, np.searchsorted(BINS, global_samples, side="right"), 0)
        point_bands = np.where(point_samples > 0, np.searchsorted(BINS, point_samples, side="right"), 0)
        regions = {
            "Great Barrier Reef": (-18.2, 147.7),
            "Coral Triangle": (-5.7, 131.0),
            "Caribbean": (18.0, -66.0),
            "Hawaii": (21.3, -157.8),
        }
        regional = {}
        for name, (target_lat, target_lon) in regions.items():
            nearby = (np.abs(source_latitude[:, None] - target_lat) <= 2.5) & (
                np.abs((source_longitude[None, :] - target_lon + 180) % 360 - 180) <= 2.5
            ) & source_reef
            valid_region = nearby & valid
            region_delta = np.abs(annual[valid_region] - point[valid_region])
            if not len(region_delta):
                raise ValueError(f"No overlapping NOAA reef cells near {name} in {year}")
            regional[name] = {
                "commonValidCells": int(len(region_delta)),
                "meanAbsoluteError": float(region_delta.mean()),
                "maxAbsoluteError": float(region_delta.max()),
            }
        return {
            "commonValidCells": int(len(delta)),
            "meanAbsoluteError": float(delta.mean()),
            "maxAbsoluteError": float(delta.max()),
            "within0_01Fraction": float(np.mean(delta <= 0.01)),
            "equivalentMatchFractionWithin0_1": float(np.mean(delta <= 0.1)),
            "sameLegendBandFraction": float(np.mean(global_bands == point_bands)),
            "regionalChecks": regional,
        }


def build(source_dir: Path, point_history: Path, output: Path, years: tuple[int, ...] = YEARS) -> dict:
    if years not in (YEARS, (2025,)):
        raise ValueError("Build either the 2025 validation preview or the complete 2016–2025 pilot")
    reef_mask, reef_latitude, reef_longitude = read_history_reef_mask(point_history)
    output.parent.mkdir(parents=True, exist_ok=True)
    stage_root = Path(tempfile.mkdtemp(prefix="global-history-stage-", dir=output.parent))
    try:
        release_name = "noaa-v3.1-annual-dhw-2016-2025"
        if (output / "releases" / release_name).exists():
            release_name += "-r" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        release = stage_root / "release"
        annual_root = release / "maps"
        annual_root.mkdir(parents=True)
        year_metadata = {}
        overlap = {}
        value_tile_counts = {}
        value_bytes_by_year = {}
        reef_rows = np.rint((89.975 - reef_latitude) / 0.05).astype(np.int64)
        reef_columns = np.rint((reef_longitude + 179.975) / 0.05).astype(np.int64)
        aligned_reef = np.zeros((3600, 7200), dtype=bool)
        if not np.allclose(89.975 - reef_rows * 0.05, reef_latitude, atol=2e-5, rtol=0) or not np.allclose(-179.975 + reef_columns * 0.05, reef_longitude, atol=2e-5, rtol=0):
            raise ValueError("NOAA reef footprint does not align to the 5 km global grid")
        aligned_reef[np.ix_(reef_rows, reef_columns)] = reef_mask
        for year in years:
            values, valid, latitude, longitude, source = _read_year(source_dir / _source_name(year), year)
            folder = annual_root / str(year)
            rendered = _render_tiles(values, valid, latitude, aligned_reef, folder)
            value_result = _write_value_tiles(values, valid, release / "values" / str(year))
            if rendered["tileCount"] != (1 << MAP_ZOOM) ** 2:
                raise ValueError(f"Incomplete world tile grid for {year}")
            year_metadata[str(year)] = {**source, **rendered, "valueTiles": value_result["tileCount"], "valueBytes": value_result["bytes"]}
            value_tile_counts[str(year)] = value_result["tileCount"]
            value_bytes_by_year[str(year)] = value_result["bytes"]
            overlap[str(year)] = _validate_history_year(
                point_history, year, latitude, longitude, values, valid
            )
            print(f"{year}: {source['validCells']:,} global valid cells, {rendered['bytes']:,} map bytes", flush=True)
        map_files = list(annual_root.rglob("*.png"))
        total_map_bytes = sum(path.stat().st_size for path in map_files)
        total_bytes_by_year = {str(year): sum(path.stat().st_size for path in (annual_root / str(year)).rglob("*.png")) for year in years}
        metadata = {
            "schema_version": 1,
            "product": "NOAA Coral Reef Watch global annual maximum Degree Heating Week composite",
            "source": "NOAA Coral Reef Watch Daily Global 5 km v3.1 annual composite",
            "sourceVersion": "3.1",
            "sourceDirectory": SOURCE_DIRECTORY,
            "metric": "Annual Maximum Degree Heating Week",
            "variable": VARIABLE,
            "units": "degree_Celsius_weeks",
            "yearStart": years[0],
            "yearEnd": years[-1],
            "years": list(years),
            "version": release_name,
            "release": release_name,
            "asset_base": f"data/coral-heat-stress/history/global-maps/releases/{release_name}",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "grid": {"width": 7200, "height": 3600, "longitude_min": -179.975, "longitude_step": 0.05, "latitude_min": -89.975, "latitude_step": 0.05, "row_order": "north-to-south"},
            "reefEmphasis": {"source": "NOAA reef_mask from existing Thermal History source", "contextAlpha": CONTEXT_ALPHA.tolist(), "reefAlpha": REEF_ALPHA.tolist()},
            "encoding": {"mapZoom": MAP_ZOOM, "maxNativeZoom": MAP_ZOOM, "mapTileTemplate": "maps/{year}/{z}/{x}/{y}.png", "valueTileTemplate": "values/{year}/{column}_{row}.bin.gz", "valueTileSizeCells": VALUE_TILE_SIZE, "valueTileHeaderBytes": VALUE_TILE_HEADER.size, "valueTileBytesPerCell": 2, "valueMissing": int(VALUE_MISSING), "valueScaleFactor": 0.01, "mapLegendBins": [0, 4, 8, 12, 16, 20], "mapColors": ["transparent", *HISTORY_COLORS], "contextAlpha": CONTEXT_ALPHA.tolist(), "reefAlpha": REEF_ALPHA.tolist(), "tileMimeType": "image/png", "valueTileMimeType": "application/gzip", "rendering": "Nearest source cell; unobserved NOAA fill cells transparent; reef emphasis changes only alpha."},
            "validationAgainstPointHistory": overlap,
            "yearsMetadata": year_metadata,
            "assets": {"mapTileCount": len(map_files), "mapBytes": total_map_bytes, "mapBytesByYear": total_bytes_by_year, "valueTileCountByYear": value_tile_counts, "valueBytesByYear": value_bytes_by_year, "valueTileCount": sum(value_tile_counts.values()), "valueBytes": sum(value_bytes_by_year.values()), "totalBytes": total_map_bytes + sum(value_bytes_by_year.values())},
        }
        if len(map_files) != len(years) * (1 << MAP_ZOOM) ** 2:
            raise ValueError("Global pilot tile inventory is incomplete")
        release_final = output / "releases" / release_name
        release_final.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(release), str(release_final))
        output.mkdir(parents=True, exist_ok=True)
        pointer_part = output / "metadata.json.part"
        pointer_part.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        json.loads(pointer_part.read_text(encoding="utf-8"))
        pointer_part.replace(output / "metadata.json")
        return metadata
    finally:
        shutil.rmtree(stage_root, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=Path("data/.build/coral_heat_stress/global_annual_source"))
    parser.add_argument("--point-history", type=Path, default=Path("data/.build/coral_heat_stress/history_source/noaa_crw_thermal_history_annual_history_v3.7.0_1985-2025.nc"))
    parser.add_argument("--output", type=Path, default=Path("data/coral-heat-stress/history/global-maps"))
    parser.add_argument("--years", type=int, nargs="+", default=list(YEARS), help="Use only 2025 for the first validation preview")
    args = parser.parse_args()
    metadata = build(args.source_dir, args.point_history, args.output, tuple(args.years))
    print(json.dumps({"release": metadata["release"], "years": metadata["years"], "assets": metadata["assets"], "validationAgainstPointHistory": metadata["validationAgainstPointHistory"]}, indent=2))


if __name__ == "__main__":
    main()
