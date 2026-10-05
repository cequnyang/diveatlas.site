"""Build NOAA Thermal History map tiles and sparse point-history assets."""

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

from .thermal_style import HISTORY_COLORS, HISTORY_ALPHA


SOURCE_VERSION = "3.7.0"
SOURCE_URL = "https://www.star.nesdis.noaa.gov/pub/socd/mecb/crw/data/thermal_history/v3.7/annual_history/noaa_crw_thermal_history_annual_history_v3.7.0_1985%E2%80%932025.nc"
SOURCE_VARIABLE = "ann_max_dhw"
SOURCE_FILL = np.float32(9.96921e36)
SOURCE_SHAPE = (41, 1390, 7200)
MAP_ZOOM = 5
POINT_TILE_SIZE = 256
POINT_HEADER = struct.Struct("<4sBHHHHI")
POINT_RECORD_PREFIX = struct.Struct("<H")
MAP_COLORS = np.asarray([tuple(int(color[index:index + 2], 16) for index in (1, 3, 5)) for color in ("#f8edc6", *HISTORY_COLORS)], dtype=np.uint8)
MAP_ALPHA = np.asarray([0, *HISTORY_ALPHA], dtype=np.uint8)
DHw_BINS = np.array([0, 4, 8, 12, 16, 20], dtype=np.float32)
REGION_CHECKS = {
    "Great Barrier Reef": (-18.2, 147.7),
    "Coral Triangle": (-5.7, 131.0),
    "Caribbean": (18.0, -66.0),
    "Hawaii": (21.3, -157.8),
}
CHECK_YEARS = (1985, 1998, 2010, 2016, 2023, 2025)


def _text(value) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _valid_values(values: np.ndarray, fill: float) -> np.ndarray:
    return np.isfinite(values) & (values != fill) & (values < 1e30)


def dhw_map_bins(values: np.ndarray, valid_mask: np.ndarray, fill: float = float(SOURCE_FILL)) -> np.ndarray:
    """Return display-only DHW bands; 0 and unavailable cells remain transparent."""
    values = np.asarray(values, dtype=np.float32)
    mask = np.asarray(valid_mask, dtype=bool)
    if values.shape != mask.shape:
        raise ValueError("DHW values and NOAA analyzed mask must have the same shape")
    if np.any(mask & _valid_values(values, fill) & (values < 0)):
        raise ValueError("Annual Maximum DHW contains impossible negative values")
    bins = np.zeros(values.shape, dtype=np.uint8)
    valid = mask & _valid_values(values, fill)
    stressed = valid & (values > 0)
    bins[stressed] = np.searchsorted(DHw_BINS, values[stressed], side="right").astype(np.uint8)
    return bins


def _mercator_source_indices(latitude: np.ndarray, grid_height: int, grid_width: int):
    world = 256 * (1 << MAP_ZOOM)
    pixel_x = np.arange(world, dtype=np.float64)
    longitude = -180.0 + (pixel_x + 0.5) * (360.0 / world)
    grid_lon = np.rint((longitude + 179.975) / 0.05).astype(np.int64) % grid_width
    ys = np.arange(world, dtype=np.float64) + 0.5
    latitudes = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * ys / world))))
    grid_lat = np.rint((latitudes - float(latitude[0])) / float(latitude[1] - latitude[0])).astype(np.int64)
    return grid_lon, grid_lat, (grid_lat >= 0) & (grid_lat < grid_height)


def _render_year_tiles(values: np.ndarray, analyzed: np.ndarray, latitude: np.ndarray, output: Path) -> tuple[int, int]:
    height, width = values.shape
    grid_lon, grid_lat, valid_y = _mercator_source_indices(latitude, height, width)
    tile_count = 0
    tile_bytes = 0
    world_tiles = 1 << MAP_ZOOM
    # Bins describe continuous annual DHW exposure; they are not BAA classes.
    year_map = dhw_map_bins(values, analyzed)
    for tile_y in range(world_tiles):
        y0 = tile_y * 256
        rows = slice(y0, y0 + 256)
        source_rows = grid_lat[rows]
        row_valid = valid_y[rows]
        for tile_x in range(world_tiles):
            cols = slice(tile_x * 256, (tile_x + 1) * 256)
            cells = np.zeros((256, 256), dtype=np.uint8)
            if row_valid.any():
                cells[row_valid] = year_map[source_rows[row_valid, None], grid_lon[cols][None, :]]
            rgba = np.zeros((256, 256, 4), dtype=np.uint8)
            stressed = cells > 0
            rgba[stressed, :3] = MAP_COLORS[cells[stressed]]
            rgba[stressed, 3] = MAP_ALPHA[cells[stressed]]
            target = output / str(MAP_ZOOM) / str(tile_x) / f"{tile_y}.png"
            target.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(rgba, "RGBA").save(target, optimize=True)
            tile_count += 1
            tile_bytes += target.stat().st_size
    return tile_count, tile_bytes


def _nearest_analyzed_reef(latitude: np.ndarray, longitude: np.ndarray, analyzed: np.ndarray, reef_mask: np.ndarray,
                           target_lat: float, target_lon: float) -> tuple[int, int, float]:
    eligible = analyzed & reef_mask
    candidate_rows, candidate_columns = np.where(eligible)
    if not len(candidate_rows):
        raise ValueError("NOAA analyzed/reef mask intersection contains no locations")
    dlat = latitude[candidate_rows] - target_lat
    dlng = (longitude[candidate_columns] - target_lon + 180) % 360 - 180
    distance = np.hypot(dlat, dlng * math.cos(math.radians(target_lat)))
    nearest = int(np.argmin(distance))
    return int(candidate_rows[nearest]), int(candidate_columns[nearest]), float(distance[nearest])


def _write_point_tiles(history: np.ndarray, source_rows: np.ndarray, source_columns: np.ndarray,
                       years: list[int], output: Path) -> tuple[int, int]:
    width = 7200
    tile_rows = math.ceil(SOURCE_SHAPE[1] / POINT_TILE_SIZE)
    tile_columns = math.ceil(width / POINT_TILE_SIZE)
    tiles: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for point_index, (source_row, source_column) in enumerate(zip(source_rows, source_columns)):
        tile_column, tile_row = int(source_column) // POINT_TILE_SIZE, int(source_row) // POINT_TILE_SIZE
        local_id = (int(source_row) % POINT_TILE_SIZE) * POINT_TILE_SIZE + (int(source_column) % POINT_TILE_SIZE)
        tiles.setdefault((tile_column, tile_row), []).append((local_id, point_index))
    tile_count = 0
    total_bytes = 0
    year_count = len(years)
    for tile_row in range(tile_rows):
        for tile_column in range(tile_columns):
            records = sorted(tiles.get((tile_column, tile_row), []))
            body = bytearray()
            for local_id, point_index in records:
                values = np.asarray(history[point_index, :], dtype="<f4")
                body.extend(POINT_RECORD_PREFIX.pack(local_id))
                body.extend(values.tobytes())
            header = POINT_HEADER.pack(b"DCHH", 1, POINT_TILE_SIZE, year_count, tile_column, tile_row, len(records))
            payload = gzip.compress(header + body, compresslevel=6, mtime=0)
            target = output / f"{tile_column}_{tile_row}.bin.gz"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            tile_count += 1
            total_bytes += len(payload)
    return tile_count, total_bytes


def _validate_point_tile(path: Path, years: list[int], expected_column: int, expected_row: int) -> int:
    payload = gzip.decompress(path.read_bytes())
    if len(payload) < POINT_HEADER.size:
        raise ValueError(f"Generated point-history tile is truncated: {path.name}")
    magic, version, tile_size, year_count, column, row, count = POINT_HEADER.unpack_from(payload)
    record_size = POINT_RECORD_PREFIX.size + len(years) * 4
    if (magic != b"DCHH" or version != 1 or tile_size != POINT_TILE_SIZE or year_count != len(years) or
            column != expected_column or row != expected_row or len(payload) != POINT_HEADER.size + count * record_size):
        raise ValueError(f"Generated point-history tile has an invalid header or length: {path.name}")
    previous = -1
    for offset in range(POINT_HEADER.size, len(payload), record_size):
        (cell_id,) = POINT_RECORD_PREFIX.unpack_from(payload, offset)
        if cell_id <= previous or cell_id >= POINT_TILE_SIZE ** 2:
            raise ValueError(f"Point-history cell index is invalid or unsorted: {path.name}")
        previous = cell_id
    return count


def _verify_source_series_in_point_asset(path: Path, source_row: int, source_column: int,
                                         source_series: np.ndarray,
                                         tile_column: int, tile_row: int) -> None:
    payload = gzip.decompress(path.read_bytes())
    _, _, tile_size, _, stored_column, stored_row, count = POINT_HEADER.unpack_from(payload)
    if stored_column != tile_column or stored_row != tile_row or tile_size != POINT_TILE_SIZE:
        raise ValueError(f"Regional source check points to the wrong history tile: {path.name}")
    target_id = (source_row % tile_size) * tile_size + source_column % tile_size
    record_size = POINT_RECORD_PREFIX.size + len(source_series) * 4
    low, high = 0, count - 1
    while low <= high:
        middle = (low + high) // 2
        offset = POINT_HEADER.size + middle * record_size
        (cell_id,) = POINT_RECORD_PREFIX.unpack_from(payload, offset)
        if cell_id == target_id:
            generated = np.frombuffer(payload, dtype="<f4", count=len(source_series), offset=offset + POINT_RECORD_PREFIX.size)
            if not np.array_equal(generated, source_series, equal_nan=True):
                raise ValueError(f"Generated point history does not match NOAA source at row {source_row}, column {source_column}")
            return
        if cell_id < target_id:
            low = middle + 1
        else:
            high = middle - 1
    raise ValueError(f"NOAA regional source check cell is absent from {path.name}")


def build(source: Path, output: Path, *, force: bool = False) -> dict:
    source = source.resolve()
    output = output.resolve()
    if not source.is_file() or source.stat().st_size == 0:
        raise FileNotFoundError(f"NOAA Thermal History source is missing or empty: {source}")
    stage_parent = output.parent.parent / ".build" / "coral_heat_stress" / "history_staging"
    stage_parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f"v{SOURCE_VERSION}-", dir=stage_parent))
    try:
        ds = netCDF4.Dataset(source, "r")
        try:
            if _text(getattr(ds, "product_version", "")) != SOURCE_VERSION:
                raise ValueError("NOAA Thermal History source version is not the verified v3.7.0 release")
            if _text(getattr(ds, "title", "")) != "NOAA Coral Reef Watch Thermal History Version 3.7.0 Annual History Metrics":
                raise ValueError("NOAA Thermal History source title changed")
            required = (SOURCE_VARIABLE, "ann_max_sst", "ann_max_anom", "withinyear_mean", "withinyear_sd", "years", "lat", "lon", "mask", "reef_mask")
            missing = [name for name in required if name not in ds.variables]
            if missing:
                raise ValueError(f"NOAA Thermal History is missing required fields: {missing}")
            dhw = ds.variables[SOURCE_VARIABLE]
            if dhw.dimensions != ("years", "lat", "lon") or dhw.shape != SOURCE_SHAPE:
                raise ValueError(f"Unexpected {SOURCE_VARIABLE} dimensions/shape: {dhw.dimensions} {dhw.shape}")
            if _text(dhw.units) != "degrees_Celsius-weeks" or _text(dhw.long_name) != "Annual-maximum Degree Heating Weeks":
                raise ValueError("NOAA annual maximum DHW units or meaning changed")
            related_fields = {}
            for name in ("ann_max_sst", "ann_max_anom", "withinyear_mean", "withinyear_sd"):
                variable = ds.variables[name]
                if variable.dimensions != ("years", "lat", "lon") or variable.shape != SOURCE_SHAPE:
                    raise ValueError(f"NOAA related annual field {name} has unexpected dimensions")
                related_fields[name] = {
                    "longName": _text(getattr(variable, "long_name", "")),
                    "units": _text(getattr(variable, "units", "")),
                    "validMin": float(np.asarray(variable.valid_min).reshape(-1)[0]),
                    "validMax": float(np.asarray(variable.valid_max).reshape(-1)[0]),
                    "exposedInV2": False,
                }
            years = np.asarray(ds.variables["years"][:], dtype=np.int32).tolist()
            if years != list(range(1985, 2026)):
                raise ValueError("NOAA Thermal History year coordinate is not the complete, ordered 1985–2025 sequence")
            if _text(ds.time_coverage_start) != "19850101T000000Z" or _text(ds.time_coverage_end) != "20251231T000000Z":
                raise ValueError("NOAA Thermal History coverage attributes disagree with its year coordinate")
            latitude = np.asarray(ds.variables["lat"][:], dtype=np.float64)
            longitude = np.asarray(ds.variables["lon"][:], dtype=np.float64)
            if latitude.shape != (1390,) or longitude.shape != (7200,) or not np.all(np.diff(latitude) > 0) or not np.all(np.diff(longitude) > 0):
                raise ValueError("NOAA Thermal History coordinate arrays or row order changed")
            # NOAA stores these coordinates as float32, so adjacent 0.05-degree
            # differences vary by a few millionths across the grid.
            if not np.allclose(np.diff(latitude), 0.05, atol=2e-5, rtol=0) or not np.allclose(np.diff(longitude), 0.05, atol=2e-5, rtol=0):
                raise ValueError("NOAA Thermal History grid is not the verified 0.05-degree spacing")
            if not np.isclose(latitude[0], -35.27499771118164, atol=1e-5) or not np.isclose(longitude[0], -179.97500610351562, atol=1e-5):
                raise ValueError("NOAA Thermal History coordinate origin changed")
            analyzed = np.asarray(ds.variables["mask"][:], dtype=np.int8) == 1
            reef_mask = np.asarray(ds.variables["reef_mask"][:], dtype=np.int8) == 1
            if analyzed.shape != SOURCE_SHAPE[1:] or reef_mask.shape != analyzed.shape or not analyzed.any() or not reef_mask.any():
                raise ValueError("NOAA analyzed/reef masks have invalid dimensions or no valid cells")
            fill = np.float32(getattr(dhw, "_FillValue", SOURCE_FILL))
            if fill != SOURCE_FILL:
                raise ValueError(f"NOAA annual DHW fill value changed: {fill}")
            analyzed_comment = _text(getattr(ds.variables["mask"], "comment", ""))
            reef_comment = _text(getattr(ds.variables["reef_mask"], "comment", ""))
            if "reef" not in analyzed_comment.lower() or "buffer" not in analyzed_comment.lower() or "reef" not in reef_comment.lower():
                raise ValueError("NOAA reef/analyzed mask definitions changed")
            dhw.set_auto_maskandscale(False)

            release_name = f"v{SOURCE_VERSION}"
            if (output / "releases" / release_name).exists():
                if not force:
                    raise FileExistsError(f"History release already exists: {output / 'releases' / release_name}; pass --force to create a revision")
                release_name += "-r" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
            release_dir = stage / "release"
            maps_dir = release_dir / "maps"
            points_dir = release_dir / "points"
            analyzed_flat = np.flatnonzero(analyzed)
            point_rows, point_columns = np.unravel_index(analyzed_flat, analyzed.shape)
            history = np.full((len(analyzed_flat), SOURCE_SHAPE[0]), np.nan, dtype="<f4")
            valid_cells_by_year: dict[str, int] = {}
            ranges_by_year: dict[str, dict[str, float]] = {}
            map_bytes_by_year: dict[str, int] = {}
            total_map_tiles = 0
            global_min = np.inf
            global_max = -np.inf
            previous_coverage = None
            coverage_warnings = []
            for index, year in enumerate(years):
                values = np.asarray(dhw[index, :, :], dtype=np.float32)
                valid = analyzed & _valid_values(values, float(fill))
                if np.any(valid & (values < 0)):
                    raise ValueError(f"NOAA annual DHW has negative values in {year}")
                if not valid.any():
                    raise ValueError(f"NOAA annual DHW contains no analyzed cells in {year}")
                selected = values[valid]
                year_min, year_max = float(selected.min()), float(selected.max())
                if year_max > 100 or year_min < 0:
                    raise ValueError(f"NOAA annual DHW range is implausible in {year}: {year_min}..{year_max}")
                coverage = int(valid.sum())
                if previous_coverage is not None and abs(coverage - previous_coverage) / previous_coverage > 0.2:
                    coverage_warnings.append({"year": year, "previousValidCells": previous_coverage, "validCells": coverage, "changeFraction": abs(coverage - previous_coverage) / previous_coverage})
                previous_coverage = coverage
                valid_cells_by_year[str(year)] = coverage
                ranges_by_year[str(year)] = {"min": year_min, "max": year_max}
                global_min, global_max = min(global_min, year_min), max(global_max, year_max)
                point_values = values.ravel()[analyzed_flat]
                point_is_valid = _valid_values(point_values, float(fill))
                history[:, index] = np.where(point_is_valid, point_values, np.nan)
                count, size = _render_year_tiles(values, analyzed, latitude, maps_dir / str(year))
                if count != (1 << MAP_ZOOM) ** 2:
                    raise ValueError(f"Map tiles are incomplete for {year}")
                total_map_tiles += count
                map_bytes_by_year[str(year)] = size
                print(f"Processed annual DHW {year}: {coverage:,} valid cells, max {year_max:.4f}", flush=True)

            source_min = float(np.asarray(dhw.valid_min).reshape(-1)[0])
            source_max = float(np.asarray(dhw.valid_max).reshape(-1)[0])
            if abs(global_min - source_min) > 1e-4 or abs(global_max - source_max) > 1e-4:
                raise ValueError(f"Observed DHW range {global_min}..{global_max} disagrees with NOAA metadata {source_min}..{source_max}")
            point_count, point_bytes = _write_point_tiles(history, point_rows, point_columns, years, points_dir)
            expected_point_count = math.ceil(SOURCE_SHAPE[2] / POINT_TILE_SIZE) * math.ceil(SOURCE_SHAPE[1] / POINT_TILE_SIZE)
            if point_count != expected_point_count:
                raise ValueError("Point-history chunk coverage is incomplete")

            source_cross_checks = {}
            for label, (target_lat, target_lon) in REGION_CHECKS.items():
                row, column, distance = _nearest_analyzed_reef(latitude, longitude, analyzed, reef_mask, target_lat, target_lon)
                point_index = int(np.searchsorted(analyzed_flat, row * SOURCE_SHAPE[2] + column))
                sample = history[point_index]
                source_values = [None if not np.isfinite(sample[year - years[0]]) else float(sample[year - years[0]]) for year in CHECK_YEARS]
                tile_column, tile_row = column // POINT_TILE_SIZE, row // POINT_TILE_SIZE
                _verify_source_series_in_point_asset(
                    points_dir / f"{tile_column}_{tile_row}.bin.gz", row, column,
                    sample, tile_column, tile_row,
                )
                finite_series = sample[np.isfinite(sample)]
                distribution = {
                    "validYears": int(finite_series.size),
                    "zeroYears": int(np.count_nonzero(finite_series == 0)),
                    "mean": float(finite_series.mean()),
                    "median": float(np.median(finite_series)),
                    "yearsAtOrAbove8": int(np.count_nonzero(finite_series >= 8)),
                }
                source_cross_checks[label] = {
                    "requested": {"latitude": target_lat, "longitude": target_lon},
                    "gridCell": {"latitude": float(latitude[row]), "longitude": float(longitude[column]), "row": row, "column": column},
                    "distanceDegrees": distance,
                    "mask": "NOAA analyzed and reef masks",
                    "years": list(CHECK_YEARS),
                    "sourceValues": source_values,
                    "distributionSample": distribution,
                    "pointAssetMatchesSourceFloat32Exactly": True,
                }

            point_manifest = {}
            for tile_row in range(math.ceil(SOURCE_SHAPE[1] / POINT_TILE_SIZE)):
                for tile_column in range(math.ceil(SOURCE_SHAPE[2] / POINT_TILE_SIZE)):
                    path = points_dir / f"{tile_column}_{tile_row}.bin.gz"
                    records = _validate_point_tile(path, years, tile_column, tile_row)
                    if not records and path.stat().st_size == 0:
                        raise ValueError(f"Empty point-history tile file: {path.name}")
                    point_manifest[path.name] = {"records": records, "bytes": path.stat().st_size}

            generated_at = datetime.now(timezone.utc).isoformat()
            map_files = list(maps_dir.rglob("*.png"))
            point_files = list(points_dir.glob("*.bin.gz"))
            if len(map_files) != total_map_tiles or len(point_files) != point_count:
                raise ValueError("Generated annual map or point-history asset inventory is inconsistent")
            metadata = {
                "schema_version": 1,
                "version": SOURCE_VERSION,
                "release": release_name,
                "asset_base": f"data/coral-heat-stress/history/releases/{release_name}",
                "source": "NOAA Coral Reef Watch",
                "product": "Thermal History Annual History",
                "productVersion": SOURCE_VERSION,
                "released": "2026-01-09",
                "sourceUrl": SOURCE_URL,
                "sourceSizeBytes": source.stat().st_size,
                "sourceFile": source.name,
                "generatedAt": generated_at,
                "yearStart": years[0],
                "yearEnd": years[-1],
                "years": years,
                "metric": "Annual Maximum Degree Heating Week",
                "variable": SOURCE_VARIABLE,
                "units": _text(dhw.units),
                "resolution": "0.05 degree (~5 km at the equator)",
                "grid": {"width": SOURCE_SHAPE[2], "height": SOURCE_SHAPE[1], "longitude_min": float(longitude[0]), "longitude_step": 0.05, "latitude_min": float(latitude[0]), "latitude_step": 0.05, "row_order": "south-to-north", "latitude_max": float(latitude[-1]), "longitude_max": float(longitude[-1])},
                "masks": {"analyzed": "NOAA mask: reef-containing pixels plus approximately 11 km buffer", "reef": "NOAA reef_mask; retained for validation and regional source checks, not applied as an additional display mask", "analyzedCells": int(analyzed.sum()), "reefCells": int(reef_mask.sum()), "currentDisplayMask": "This analyzed mask is also applied to Current BAA map tile rendering only; Current global source and query data remain available."},
                "missing": {"sourceFill": float(fill), "pointEncoding": "IEEE-754 float32 NaN; omitted cells mean no NOAA analyzed pixel", "map": "transparent"},
                "quantization": "None; point history retains source float32 values without quantization.",
                "summaryStatistic": "Median over finite annual values; the sampled regional series contain rare high years and many low or zero years, so median is more robust to event outliers than mean.",
                "summaryYears": {"recentStart": years[-10], "recentEnd": years[-1], "fullStart": years[0], "fullEnd": years[-1]},
                "sourceRange": {"min": global_min, "max": global_max, "validMinAttribute": source_min, "validMaxAttribute": source_max},
                "inspectedRelatedFields": related_fields,
                "maskDefinitions": {"analyzed": analyzed_comment, "reef": reef_comment},
                "validCellsByYear": valid_cells_by_year,
                "rangesByYear": ranges_by_year,
                "coverageWarnings": coverage_warnings,
                "crossChecks": source_cross_checks,
                "displayStyle": {"colors": list(HISTORY_COLORS), "alpha": MAP_ALPHA.astype(int).tolist(), "zoomOpacity": {"fullThrough": 8, "reducedFrom": 9, "fadedFrom": 12, "floor": 0.48}},
                "encoding": {"mapZoom": MAP_ZOOM, "maxNativeZoom": MAP_ZOOM, "mapTileTemplate": "maps/{year}/{z}/{x}/{y}.png", "mapLegendBins": [0, 4, 8, 12, 16, 20], "mapColors": ["transparent", *HISTORY_COLORS], "pointTileSizeCells": POINT_TILE_SIZE, "pointHeaderBytes": POINT_HEADER.size, "pointRecordBytes": POINT_RECORD_PREFIX.size + len(years) * 4, "pointFormat": "gzip DCHH v1; sorted uint16 local cell index followed by source float32 DHW values for all years; NaN denotes missing"},
                "pointTileTemplate": "points/{column}_{row}.bin.gz",
                "assets": {"mapTileCount": len(map_files), "mapBytes": sum(path.stat().st_size for path in map_files), "mapBytesByYear": map_bytes_by_year, "mapBytesPerYearMean": round(sum(map_bytes_by_year.values()) / len(years)), "pointTileCount": len(point_files), "pointBytes": sum(path.stat().st_size for path in point_files), "pointBytesByTile": point_manifest, "totalBytes": sum(path.stat().st_size for path in map_files + point_files)},
            }
            metadata_path = stage / "metadata.json"
            metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            checked = json.loads(metadata_path.read_text(encoding="utf-8"))
            if checked["years"] != list(range(checked["yearStart"], checked["yearEnd"] + 1)):
                raise ValueError("Generated history metadata year sequence is invalid")
        finally:
            ds.close()

        if output.exists() and (output / "metadata.json").is_file() and not force:
            published = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
            if published.get("version") == SOURCE_VERSION:
                raise FileExistsError(f"Published NOAA history is already v{SOURCE_VERSION}; pass --force only for a deliberate rebuild")
        release_dir = stage / "release"
        final_release = output / "releases" / release_name
        final_release.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(release_dir), str(final_release))
        output.mkdir(parents=True, exist_ok=True)
        pointer_tmp = output / "metadata.json.part"
        pointer_tmp.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        json.loads(pointer_tmp.read_text(encoding="utf-8"))
        pointer_tmp.replace(output / "metadata.json")
        return metadata
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("data/.build/coral_heat_stress/history_source/noaa_crw_thermal_history_annual_history_v3.7.0_1985-2025.nc"))
    parser.add_argument("--output", type=Path, default=Path("data/coral-heat-stress/history"))
    parser.add_argument("--force", action="store_true", help="allow a deliberate same-version rebuilt release")
    args = parser.parse_args()
    metadata = build(args.input, args.output, force=args.force)
    print(json.dumps({"version": metadata["version"], "years": [metadata["yearStart"], metadata["yearEnd"]], "assets": {key: value for key, value in metadata["assets"].items() if key not in ("mapBytesByYear", "pointBytesByTile")}, "sourceRange": metadata["sourceRange"], "coverageWarnings": metadata["coverageWarnings"], "crossChecks": metadata["crossChecks"]}, indent=2))


if __name__ == "__main__":
    main()
