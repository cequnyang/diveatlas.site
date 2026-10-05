"""Build lazy geographic EOT20 coefficient chunks and GEBCO-derived water masks."""

from __future__ import annotations

import argparse
import gzip
import json
import math
import struct
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import netCDF4
import numpy as np
import rasterio
from rasterio.transform import rowcol

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data/.build/tides/source/EOT20/ocean_tides"
GEBCO = ROOT / "data/.build/gebco_2026_2min"
OUTPUT = ROOT / "data/tides/eot20-v1"
CONSTITUENTS = ["2N2", "J1", "K1", "K2", "M2", "M4", "MF", "MM", "N2", "O1", "P1", "Q1", "S1", "S2", "SA", "SSA", "T2"]
HEADER = struct.Struct("<4sBBHHH")
CELL = struct.Struct("<B")
COEFF = struct.Struct("<ff")
VERSION = "eot20-v1"
TILE_DEGREES = 5
MAX_VALID_COEFFICIENT_DISTANCE_KM = 15.0


def _tile_id(lat: float, lon: float) -> tuple[int, int]:
    return math.floor((lat + 90) / TILE_DEGREES), math.floor(((lon + 180) % 360) / TILE_DEGREES)


def _tile_bounds(tile_y: int, tile_x: int) -> tuple[float, float, float, float]:
    return -90 + tile_y * TILE_DEGREES, -180 + tile_x * TILE_DEGREES, -90 + (tile_y + 1) * TILE_DEGREES, -180 + (tile_x + 1) * TILE_DEGREES


def _source_arrays() -> tuple[np.ndarray, np.ndarray, dict[str, tuple[np.ndarray, np.ndarray]], dict]:
    grids = {}
    source_meta = []
    latitude = longitude = None
    for constituent in CONSTITUENTS:
        path = SOURCE / f"{constituent}_ocean_eot20.nc"
        if not path.exists():
            raise FileNotFoundError(f"Missing official EOT20 constituent: {path}")
        with netCDF4.Dataset(path) as ds:
            lat, lon = ds.variables["lat"][:], ds.variables["lon"][:]
            if latitude is None:
                latitude, longitude = np.asarray(lat), np.asarray(lon)
            elif not np.array_equal(latitude, lat) or not np.array_equal(longitude, lon):
                raise ValueError(f"Grid coordinates differ for {path.name}")
            amplitude = np.ma.asarray(ds.variables["amplitude"][:])
            phase = np.ma.asarray(ds.variables["phase"][:])
            # PyTMD FES convention: complex harmonic coefficient is H * exp(-i*phase).
            # Its FES prediction computes Re(C)*cos(theta) - Im(C)*sin(theta), or H*cos(theta+phase).
            amp64 = np.asarray(amplitude.filled(0), dtype=np.float64)
            phase64 = np.asarray(phase.filled(0), dtype=np.float64)
            real = (amp64 * np.cos(np.deg2rad(phase64))).astype(np.float32)
            imag = (-amp64 * np.sin(np.deg2rad(phase64))).astype(np.float32)
            valid = ~(np.ma.getmaskarray(amplitude) | np.ma.getmaskarray(phase)) & (np.asarray(amplitude.filled(0)) != 0) & (np.asarray(phase.filled(0)) != 0)
            grids[constituent] = (real, imag, valid)
            source_meta.append({"file": path.name, "bytes": path.stat().st_size, "units": "cm", "phase_units": "degrees", "masked_cells": int((~valid).sum())})
    return latitude, longitude, grids, {"files": source_meta}


def _gebco_sources():
    paths = sorted(GEBCO.glob("gebco_2026_*.tif"))
    if len(paths) != 8:
        raise FileNotFoundError(f"Expected eight prepared GEBCO_2026 2-arc-minute quadrants under {GEBCO}")
    datasets = [rasterio.open(path) for path in paths]
    return datasets


_gebco_arrays: dict[str, np.ndarray] = {}


def _ocean_mask_for_tile(tile_y: int, tile_x: int, datasets) -> np.ndarray:
    south, west, north, east = _tile_bounds(tile_y, tile_x)
    # The mask is evaluated at the EOT20 nodes. The 2' source retains coast features
    # that are lost at EOT20 spacing; any non-negative cell is treated as land.
    latitudes = np.arange(max(-90.0, south - 0.125), min(90.0, north + 0.125) + 1e-8, 0.125)
    longitudes = np.arange(west - 0.125, east + 0.125 + 1e-8, 0.125)
    mask = np.full((len(latitudes), len(longitudes)), 2, dtype=np.uint8)
    lookup = {}
    for ds in datasets:
        lookup[(round(ds.bounds.left), round(ds.bounds.bottom))] = ds
    lat_grid, lon_grid = np.meshgrid(latitudes, ((longitudes + 180) % 360) - 180, indexing="ij")
    # Exact quadrant edges have no complete 3x3 neighborhood on either raster;
    # sample inward on both sides and keep the node wet only when both are ocean.
    for source in datasets:
        longitude_boundary = np.isclose(lon_grid / 90.0, np.round(lon_grid / 90.0))
        equator = np.isclose(lat_grid, 0.0)
        inside = ((lon_grid >= source.bounds.left) & (lon_grid < source.bounds.right) &
                  (lat_grid >= source.bounds.bottom) & (lat_grid < source.bounds.top))
        right_boundary = ((source.bounds.right + 180.0) % 360.0) - 180.0
        if math.isclose(source.bounds.right / 90.0, round(source.bounds.right / 90.0)):
            inside |= (longitude_boundary & np.isclose(lon_grid, right_boundary) &
                       (lat_grid >= source.bounds.bottom) & (lat_grid < source.bounds.top))
        if source.bounds.top <= 1e-10:
            inside |= equator & (lon_grid >= source.bounds.left) & (lon_grid < source.bounds.right)
        if not inside.any():
            continue
        key = str(source.name)
        if key not in _gebco_arrays:
            _gebco_arrays[key] = source.read(1)
        elevation = _gebco_arrays[key]
        sample_lon = lon_grid[inside].copy()
        sample_lat = lat_grid[inside].copy()
        boundary_points = longitude_boundary[inside]
        equator_points = equator[inside]
        left_boundary = math.isclose(source.bounds.left / 90.0, round(source.bounds.left / 90.0))
        right_boundary = math.isclose(source.bounds.right / 90.0, round(source.bounds.right / 90.0))
        if left_boundary:
            sample_lon[boundary_points] = source.bounds.left + 1.5 * source.res[0]
        elif right_boundary:
            sample_lon[boundary_points] = source.bounds.right - 1.5 * source.res[0]
        if source.bounds.bottom >= -1e-10:
            sample_lat[equator_points] = source.bounds.bottom + 1.5 * source.res[1]
        elif source.bounds.top <= 1e-10:
            sample_lat[equator_points] = source.bounds.top - 1.5 * source.res[1]
        cols = np.floor((sample_lon - source.bounds.left) / source.res[0]).astype(np.int64)
        rows = np.floor((source.bounds.top - sample_lat) / source.res[1]).astype(np.int64)
        valid = (rows > 0) & (cols > 0) & (rows < elevation.shape[0] - 1) & (cols < elevation.shape[1] - 1)
        wet = valid.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                wet &= elevation[rows.clip(1, elevation.shape[0] - 2) + dy,
                                 cols.clip(1, elevation.shape[1] - 2) + dx] < 0
        current = mask[inside].copy()
        # The 180° node has two raster neighborhoods; require both sides of the
        # antimeridian to be ocean instead of treating the raster edge as land.
        overlap_points = boundary_points | equator_points
        first_overlap_side = overlap_points & (current == 2)
        later_overlap_side = overlap_points & ~first_overlap_side
        current[first_overlap_side] = wet[first_overlap_side].astype(np.uint8)
        current[later_overlap_side] = ((current[later_overlap_side] == 1) & wet[later_overlap_side]).astype(np.uint8)
        current[~overlap_points] = wet[~overlap_points].astype(np.uint8)
        mask[inside] = current
    return (mask == 1).astype(np.uint8)


def _write_chunk(path: Path, tile_y: int, tile_x: int, latitude: np.ndarray, longitude: np.ndarray, grids, watermask: np.ndarray) -> dict:
    south, west, north, east = _tile_bounds(tile_y, tile_x)
    lat_indices = np.flatnonzero((latitude >= south - 0.125) & (latitude <= north + 0.125))
    # Normalize source longitudes to [-180, 180), dropping duplicate +180.
    source_lon = ((longitude + 180) % 360) - 180
    tile_lon = source_lon.copy()
    if tile_x == 71:
        tile_lon[tile_lon < west] += 360
    elif tile_x == 0:
        tile_lon[tile_lon > east] -= 360
    lon_indices = np.flatnonzero((tile_lon >= west - 0.125) & (tile_lon <= east + 0.125))
    # The source includes both 0° and 360°; retain one canonical seam column.
    _, unique_positions = np.unique(source_lon[lon_indices], return_index=True)
    lon_indices = lon_indices[np.sort(unique_positions)]
    lon_indices = lon_indices[np.argsort(tile_lon[lon_indices], kind="stable")]
    lat_values = latitude[lat_indices]
    lon_values = tile_lon[lon_indices]
    if not len(lat_values) or not len(lon_values):
        return {"cells": 0, "bytes": 0}
    # Use only samples whose EOT20 and GEBCO support is ocean. This allows local
    # bilinear interpolation only when all four bracketing centers are valid water.
    y0 = int(round((lat_values[0] - max(-90.0, south - 0.125)) / 0.125))
    x0 = int(round((lon_values[0] - (west - 0.125)) / 0.125))
    water = watermask[y0:y0 + len(lat_values), x0:x0 + len(lon_values)] == 1
    ys, xs = np.meshgrid(lat_indices, lon_indices, indexing="ij")
    flat_valid = water.copy()
    for constituent in CONSTITUENTS:
        flat_valid &= grids[constituent][2][ys, xs]
    cells = len(lat_values) * len(lon_values)
    # Invalid cells are fixed-size records too, so the reader has O(1) direct indexing.
    record_size = 1 + len(CONSTITUENTS) * COEFF.size
    records = bytearray(cells * record_size)
    for iy in range(len(lat_values)):
        for ix in range(len(lon_values)):
            pos = (iy * len(lon_values) + ix) * record_size
            if not flat_valid[iy, ix]:
                continue
            records[pos] = 1
            for ci, constituent in enumerate(CONSTITUENTS):
                real, imag, _ = grids[constituent]
                records[pos + 1 + ci * COEFF.size:pos + 1 + (ci + 1) * COEFF.size] = COEFF.pack(float(real[ys[iy, ix], xs[iy, ix]]), float(imag[ys[iy, ix], xs[iy, ix]]))
    raw = bytearray(HEADER.pack(b"EOT1", 1, len(CONSTITUENTS), len(lat_values), len(lon_values), record_size))
    raw.extend(struct.pack("<dd", float(lat_values[0]), float(lon_values[0])))
    raw.extend(records)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as stream:
        stream.write(gzip.compress(raw, compresslevel=9, mtime=0))
    return {"cells": cells, "valid_cells": int(flat_valid.sum()), "bytes": path.stat().st_size, "raw_bytes": len(raw), "lat0": float(lat_values[0]), "lon0": float(lon_values[0]), "rows": len(lat_values), "columns": len(lon_values)}


def build(selected_tiles: set[tuple[int, int]] | None = None) -> dict:
    started = time.perf_counter()
    if len([path for path in SOURCE.glob("*_ocean_eot20.nc") if not path.name.startswith("._")]) != len(CONSTITUENTS):
        raise FileNotFoundError("Run tools/tides/fetch.py first to download the official EOT20 archive")
    latitude, longitude, grids, source = _source_arrays()
    datasets = _gebco_sources()
    try:
        chunks = 0
        for ty in range(36):
            for tx in range(72):
                south, west, north, east = _tile_bounds(ty, tx)
                yi = np.any((latitude >= south - 0.125) & (latitude <= north + 0.125))
                lon_n = ((longitude + 180) % 360) - 180
                xi = np.any((lon_n >= west - 0.125) & (lon_n <= east + 0.125))
                if not yi or not xi:
                    continue
                if selected_tiles is not None and (ty, tx) not in selected_tiles:
                    continue
                water = _ocean_mask_for_tile(ty, tx, datasets)
                mask_path = OUTPUT / "water" / f"{ty}_{tx}.bin.gz"
                mask_path.parent.mkdir(parents=True, exist_ok=True)
                mask_raw = struct.pack("<4sHH", b"WTR1", water.shape[0], water.shape[1]) + water.tobytes()
                mask_path.write_bytes(gzip.compress(mask_raw, compresslevel=9, mtime=0))
                chunk_path = OUTPUT / "coeff" / f"{ty}_{tx}.bin.gz"
                meta = _write_chunk(chunk_path, ty, tx, latitude, longitude, grids, water)
                meta.update({"coeff_path": f"coeff/{ty}_{tx}.bin.gz", "water_path": f"water/{ty}_{tx}.bin.gz", "water_bytes": mask_path.stat().st_size})
                chunks += 1
    finally:
        for ds in datasets:
            ds.close()
    output_files = [p for p in OUTPUT.rglob("*") if p.is_file() and p.name not in {"manifest.json", "manifest.js"}]
    manifest = {
        "model": "EOT20", "version": VERSION, "productVersion": "1.0.0", "gridResolutionDegrees": 0.125,
        "constituents": CONSTITUENTS, "source": "https://www.seanoe.org/data/00683/79489/",
        "sourceFile": "85762.zip", "sourceSha256": "bced7af7eb7c34896d4fd04680a751cc9f5a4c7a3c03852997d9263d61e07018",
        "attribution": "Hart-Davis, M.G. et al. (2021), EOT20, SEANOE, https://doi.org/10.17882/79489. CC BY 4.0.",
        "license": "https://creativecommons.org/licenses/by/4.0/", "builtAtUTC": datetime.now(timezone.utc).isoformat(),
        "encoding": {"format": "gzip DATW v1 + row-major cells: validity byte, 17 little-endian float32 (Re,Im) pairs in cm", "tileDegrees": TILE_DEGREES, "longitude": "-180 to 180", "invalid": "all constituents must be valid; water mask must be water", "amplitudeQuantization": "float64 source complex coefficients to float32; measured separately by validate.py"},
        "validity": {"coastSource": "Existing GEBCO_2026 global 2-arc-minute raster quadrants", "rule": "all 3x3 GEBCO cells around EOT20 node must be below 0m; all 4 bilinear EOT20 nodes valid and wet; nearest node must be within 15 km", "maxCoefficientDistanceKm": MAX_VALID_COEFFICIENT_DISTANCE_KM, "confidence": "Moderate at <=7.5 km to nearest wet model node, otherwise Limited; spatial applicability only, not probability of prediction accuracy"},
        "chunkTemplate": "coeff/{ty}_{tx}.bin.gz", "chunkCount": chunks,
        "assetCount": len(output_files), "publishedBytes": sum(p.stat().st_size for p in output_files),
        "sourceGrid": {"rows": len(latitude), "columns": len(longitude), "latitude": [float(latitude[0]), float(latitude[-1])], "longitude": [float(longitude[0]), float(longitude[-1])]},
        "sourceMetadata": source,
        "runtimeDependencies": [], "timezone": {"data": "timezone-boundary-builder 2026d timezones.geojson", "license": "ODbL-1.0", "lookup": "10 degree geographic chunk + built-in Intl IANA timezone rules"},
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    manifest["assetCount"] += 1
    manifest["publishedBytes"] += (OUTPUT / "manifest.json").stat().st_size
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    (OUTPUT / "manifest.js").unlink(missing_ok=True)
    print(json.dumps({"version": VERSION, "chunk_count": chunks, "published_bytes": manifest["publishedBytes"], "elapsed_seconds": round(time.perf_counter() - started, 2)}, indent=2))
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tile", action="append", help="Build one tile as y_x; repeat for several (diagnostics only).")
    args = parser.parse_args()
    selected = {tuple(map(int, item.split("_"))) for item in args.tile} if args.tile else None
    build(selected)
