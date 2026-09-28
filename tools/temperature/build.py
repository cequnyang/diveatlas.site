#!/usr/bin/env python3
"""Build static WOA23 temperature tiles and numeric query chunks for DiveAtlas.

The browser consumes transparent PNG tiles only. Nearest-cell sampling is
intentional: interpolating this grid would smooth values across the WOA land
mask. Use --profile development-1deg for the explicitly marked pipeline
validation build and --profile production-0.25deg for the 1991-2020 source.
"""

from __future__ import annotations

import argparse
import calendar
from dataclasses import dataclass
from datetime import datetime, timezone
import gzip
import json
import math
from pathlib import Path
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE_CONFIG = {
    "1.0": {
        "resolution": 1.0,
        "profile": "development-1deg",
        "grid_code": "01",
        "max_native_zoom": 2,
        "expected_grid": (180, 360),
        "level_count": 57,
    },
    "0.25": {
        "resolution": 0.25,
        "profile": "production-0.25deg",
        "grid_code": "04",
        "max_native_zoom": 3,
        "expected_grid": (720, 1440),
        "level_count": 57,
    },
}
PERIOD_CONFIG = {
    "decav": {
        "description": "1955-2022 average of seven decadal means; pipeline validation period, not the final 1991-2020 climate normal",
        "netcdf_directory": "decav",
    },
    "decav71A0": {
        "description": "1971-2000 climate normal",
        "netcdf_directory": "decav71A0",
    },
    "decav81B0": {
        "description": "1981-2010 climate normal",
        "netcdf_directory": "decav81B0",
    },
    "decav91C0": {
        "description": "1991-2020 climate normal",
        "netcdf_directory": "decav91C0",
    },
}
NOAA_ASCII_PHASE_A_URL = (
    "https://www.ncei.noaa.gov/data/oceans/woa/WOA23/DATA/temperature/"
    "ascii/decav/1.00/woa23_decav_t09an01.dat.gz"
)
NOAA_THREDDS_ROOT = "https://www.ncei.noaa.gov/thredds-ocean/fileServer/woa23/DATA/temperature/netcdf"
GDEX_OSDF_ROOT = "https://osdf-data.gdex.ucar.edu/ncar/gdex/d285000/woa23_netcdf"
GDEX_HTTP_ROOT = "https://tds.gdex.ucar.edu/thredds/fileServer/files/d285000/woa23_netcdf"
STANDARD_MONTHLY_DEPTHS_M = (
    0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85,
    90, 95, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400,
    425, 450, 475, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000,
    1050, 1100, 1150, 1200, 1250, 1300, 1350, 1400, 1450, 1500,
)
SOURCE_VERSION = "woa23-temperature-tiles-v2"
QUERY_VERSION = 1
QUERY_SCALE_C = 0.01
QUERY_MISSING = -32768
QUERY_CHUNK_DEGREES = 10
QUERY_HALO_CELLS = 1
DEPTHS = tuple(depth for depth in STANDARD_MONTHLY_DEPTHS_M if depth <= 50)
TILE_SIZE = 256
COLOR_STOPS = (
    (-2.0, (28, 75, 143)),
    (5.0, (50, 145, 190)),
    (15.0, (79, 174, 164)),
    (22.0, (196, 211, 141)),
    (27.0, (241, 190, 112)),
    (32.0, (206, 103, 94)),
)
TEST_REGION = {"west": 126.0, "east": 143.0, "south": -12.0, "north": 3.0}
COLOR_STOP_METADATA = [
    {"value_c": value, "color": "#%02x%02x%02x" % color} for value, color in COLOR_STOPS
]


@dataclass(frozen=True)
class TemperatureSourceMetadata:
    source_name: str
    source_product: str
    climatology_period: str
    source_resolution: float
    source_type: str
    source_url: str
    generated_at: str


@dataclass(frozen=True)
class NormalizedTemperatureGrid:
    """Common adapter output consumed by statistics and tile rasterization."""
    longitude: np.ndarray
    latitude: np.ndarray
    depth: int
    month: int
    temperature_c: np.ma.MaskedArray
    valid_mask: np.ndarray
    metadata: TemperatureSourceMetadata


def source_filename(resolution: str, period: str, month: int, source_format: str) -> str:
    info = SOURCE_CONFIG[resolution]
    suffix = "dat.gz" if source_format == "ascii-gzip" else "dat" if source_format == "ascii" else "nc"
    field_type = "an" if source_format.startswith("ascii") else ""
    grid_separator = "" if field_type else "_"
    return f"woa23_{period}_t{month:02d}{field_type}{grid_separator}{info['grid_code']}.{suffix}"


def source_url(resolution: str, period: str, month: int, source_format: str) -> str:
    info = SOURCE_CONFIG[resolution]
    if source_format.startswith("ascii"):
        return (
            "https://www.ncei.noaa.gov/data/oceans/woa/WOA23/DATA/temperature/"
            f"ascii/{period}/{info['resolution']:.2f}/{source_filename(resolution, period, month, source_format)}"
        )
    return (
        f"{NOAA_THREDDS_ROOT}/{PERIOD_CONFIG[period]['netcdf_directory']}/"
        f"{info['resolution']:.2f}/{source_filename(resolution, period, month, source_format)}"
    )


def source_format_for(path: Path) -> str:
    name = path.name.lower()
    if name.endswith(".dat.gz"):
        return "ascii-gzip"
    if name.endswith(".dat"):
        return "ascii"
    if name.endswith(".nc"):
        return "netcdf"
    raise RuntimeError(f"Unsupported WOA23 source format for {path.name}; expected .nc, .dat, or .dat.gz")


def depth_level_index(depth_m: int) -> int:
    try:
        return STANDARD_MONTHLY_DEPTHS_M.index(depth_m)
    except ValueError as exc:
        raise RuntimeError(f"Depth {depth_m} m is not a standard WOA23 monthly level") from exc


def nearest_indices(coordinates: np.ndarray, targets: np.ndarray, *, circular=False) -> np.ndarray:
    if circular:
        # Reduce the signed difference before taking its magnitude. Taking
        # `360 - abs(delta)` directly fails when coordinates use -180..180
        # and targets have already been wrapped into 0..360.
        delta = (coordinates[:, None] - targets[None, :] + 180.0) % 360.0 - 180.0
        distance = np.abs(delta)
    else:
        distance = np.abs(coordinates[:, None] - targets[None, :])
    return np.argmin(distance, axis=0)


def tile_range(bounds: dict[str, float], zoom: int) -> tuple[range, range]:
    count = 1 << zoom

    def x_for(lon):
        return min(count - 1, max(0, int(math.floor((lon + 180.0) / 360.0 * count))))

    def y_for(lat):
        clipped = min(85.05112878, max(-85.05112878, lat))
        radians = math.radians(clipped)
        y = (1.0 - math.asinh(math.tan(radians)) / math.pi) / 2.0 * count
        return min(count - 1, max(0, int(math.floor(y))))

    west, east = x_for(bounds["west"]), x_for(bounds["east"])
    north, south = y_for(bounds["north"]), y_for(bounds["south"])
    return range(west, east + 1), range(north, south + 1)


def tile_pixel_coordinates(z: int, x: int, y: int) -> tuple[np.ndarray, np.ndarray]:
    scale = float(1 << z)
    px = x + (np.arange(TILE_SIZE) + 0.5) / TILE_SIZE
    py = y + (np.arange(TILE_SIZE) + 0.5) / TILE_SIZE
    lon = px / scale * 360.0 - 180.0
    lat_rad = np.arctan(np.sinh(np.pi * (1.0 - 2.0 * py / scale)))
    return lon, np.rad2deg(lat_rad)


def colorize(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    stops = np.asarray([stop[0] for stop in COLOR_STOPS], dtype=np.float32)
    colors = np.asarray([stop[1] for stop in COLOR_STOPS], dtype=np.float32)
    # Missing values stay missing; this RGB placeholder is fully transparent.
    safe_values = np.where(valid & np.isfinite(values), values, stops[0])
    for channel in range(3):
        rgba[:, :, channel] = np.clip(
            np.interp(safe_values, stops, colors[:, channel]), 0, 255
        ).astype(np.uint8)
    rgba[:, :, 3] = np.where(valid, 220, 0).astype(np.uint8)
    return rgba


def write_tile(source: NormalizedTemperatureGrid, output: Path,
               z: int, x: int, y: int) -> dict[str, int]:
    tile_lon, tile_lat = tile_pixel_coordinates(z, x, y)
    lon_indices = nearest_indices(source.longitude, np.mod(tile_lon, 360.0), circular=True)
    lat_indices = nearest_indices(source.latitude, tile_lat)
    sampled = np.ma.asarray(source.temperature_c[np.ix_(lat_indices, lon_indices)])
    values = np.asarray(sampled.filled(np.nan), dtype=np.float32)
    valid = source.valid_mask[np.ix_(lat_indices, lon_indices)] & np.isfinite(values)
    rgba = colorize(values, valid)
    output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, mode="RGBA").save(output, format="PNG", optimize=True)
    return {"valid_pixels": int(valid.sum()), "transparent_pixels": int(valid.size - valid.sum())}


def netcdf_dataset(source: Path):
    try:
        from netCDF4 import Dataset
    except ImportError as exc:
        raise RuntimeError("Missing dependency netCDF4; install tools/temperature/requirements.txt") from exc
    return Dataset(source, "r")


def expected_source_name(resolution: str, period: str, month: int, source_format: str) -> str:
    return source_filename(resolution, period, month, source_format)


def validate_netcdf(source: Path, resolution: str, period: str, month: int) -> None:
    info = SOURCE_CONFIG[resolution]
    expected_name = expected_source_name(resolution, period, month, "netcdf")
    with netcdf_dataset(source) as dataset:
        for required in ("t_an", "depth", "lat", "lon"):
            if required not in dataset.variables:
                raise RuntimeError(f"{source.name} has no required {required!r} NetCDF variable")
        field = dataset.variables["t_an"]
        if expected_name not in source.name:
            raise RuntimeError(f"Input is not the expected WOA23 {expected_name} monthly analyzed field")
        title = str(getattr(dataset, "title", ""))
        institution = str(getattr(dataset, "institution", ""))
        project = str(getattr(dataset, "project", ""))
        global_id = str(dataset.getncattr("id")) if "id" in dataset.ncattrs() else ""
        if "world ocean atlas 2023" not in title.lower() or "temperature" not in title.lower():
            raise RuntimeError(f"NetCDF global title does not identify WOA23 temperature: {title or '(missing)'}")
        if "noaa" not in institution.lower() and "national centers for environmental information" not in institution.lower():
            raise RuntimeError(f"NetCDF global institution is not NOAA NCEI: {institution or '(missing)'}")
        if "world ocean atlas" not in project.lower():
            raise RuntimeError(f"NetCDF project metadata does not identify WOA: {project or '(missing)'}")
        month_name = calendar.month_name[month].lower()
        if month_name not in title.lower() or (global_id and global_id != expected_name):
            raise RuntimeError(f"NetCDF title/id does not confirm {calendar.month_name[month]} WOA23 product")
        units = getattr(field, "units", "").lower()
        if units not in ("degrees_celsius", "degree_celsius", "degc"):
            raise RuntimeError(f"Unexpected t_an units in {source.name}: {units or '(missing)'}")
        semantic_text = " ".join(str(getattr(field, attr, "")) for attr in ("long_name", "standard_name")).lower()
        if "temperature" not in semantic_text or ("anal" not in semantic_text and "sea_water" not in semantic_text):
            raise RuntimeError(f"t_an in {source.name} does not identify analyzed ocean temperature")
        lat = np.asarray(dataset.variables["lat"][:], dtype=np.float64)
        lon = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
        if (len(lat), len(lon)) != info["expected_grid"]:
            raise RuntimeError(f"Expected {info['resolution']} degree grid {info['expected_grid']}, found {(len(lat), len(lon))}")
        if str(getattr(dataset.variables["lat"], "units", "")).lower() != "degrees_north" or str(getattr(dataset.variables["lon"], "units", "")).lower() != "degrees_east":
            raise RuntimeError("WOA23 latitude/longitude coordinates have unexpected units")
        for coordinates, name in ((lat, "latitude"), (lon, "longitude")):
            if not np.all(np.isfinite(coordinates)) or not np.all(np.diff(coordinates) > 0):
                raise RuntimeError(f"WOA23 {name} coordinates must be finite and increasing")
            step = float(np.median(np.diff(coordinates)))
            if not np.isclose(step, info["resolution"], atol=1e-5):
                raise RuntimeError(f"{name} spacing does not match the requested {info['resolution']} degree source")
        step = info["resolution"]
        expected_lat = np.arange(-90.0 + step / 2, 90.0, step)
        expected_lon = np.arange(-180.0 + step / 2, 180.0, step)
        if not np.allclose(lat, expected_lat, atol=1e-5) or not np.allclose(lon, expected_lon, atol=1e-5):
            raise RuntimeError("WOA23 coordinates are not ordered global cell centers on the requested grid")
        depth_variable = dataset.variables["depth"]
        if str(getattr(depth_variable, "units", "")).lower() not in ("meters", "meter", "m"):
            raise RuntimeError("WOA23 depth coordinates must be expressed in metres")
        depth_values = np.asarray(depth_variable[:], dtype=np.float64)
        if tuple(np.round(depth_values, 4)) != tuple(STANDARD_MONTHLY_DEPTHS_M):
            raise RuntimeError(f"Unexpected standard WOA23 monthly depth levels in {source.name}")
        if field.ndim != 4 or field.shape[0] != 1 or field.shape[1:] != (len(depth_values), len(lat), len(lon)):
            raise RuntimeError(f"Unexpected WOA23 t_an dimensions in {source.name}: {field.shape}")
        if not hasattr(field, "_FillValue"):
            raise RuntimeError("WOA23 t_an is missing _FillValue; refusing to infer land/no-data cells")
        field[0, depth_level_index(20), 0:1, 0:1]


def parse_ascii_level(stream, level_index: int, grid_shape: tuple[int, int]) -> np.ma.MaskedArray:
    """Read one WOA compact-grid level (F8.4, ten sequential values per line)."""
    rows, columns = grid_shape
    values_per_level = rows * columns
    lines_per_level = math.ceil(values_per_level / 10)
    selected = np.empty(values_per_level, dtype=np.float32)
    target_start, target_end = level_index * lines_per_level, (level_index + 1) * lines_per_level
    total_lines = 0
    selected_offset = 0
    for line_number, line in enumerate(stream):
        if not line.strip():
            continue
        if len(line.rstrip("\r\n")) != 80:
            raise RuntimeError(f"Malformed WOA compact ASCII line {line_number + 1}: expected 80 characters")
        if target_start <= total_lines < target_end:
            raw = line.rstrip("\r\n")
            tokens = [raw[offset:offset + 8] for offset in range(0, 80, 8)]
            try:
                parsed = np.asarray([float(token) for token in tokens], dtype=np.float32)
            except ValueError as exc:
                raise RuntimeError(f"Malformed WOA compact ASCII value on line {line_number + 1}") from exc
            remaining = values_per_level - selected_offset
            take = min(10, remaining)
            selected[selected_offset:selected_offset + take] = parsed[:take]
            selected_offset += take
        total_lines += 1
    expected_lines = lines_per_level * len(STANDARD_MONTHLY_DEPTHS_M)
    if total_lines != expected_lines:
        raise RuntimeError(f"Incomplete WOA compact ASCII file: expected {expected_lines} data lines, found {total_lines}")
    if selected_offset != values_per_level:
        raise RuntimeError(f"WOA compact ASCII level {level_index + 1} is incomplete")
    mask = ~np.isfinite(selected) | np.isclose(selected, -99.9999, atol=0.00005)
    return np.ma.array(selected.reshape(rows, columns), mask=mask)


def validate_ascii(source: Path, resolution: str, period: str, month: int) -> None:
    if period != "decav":
        raise RuntimeError("WOA23 compact ASCII analyzed-mean source is configured for the decav period")
    expected = expected_source_name(resolution, period, month, source_format_for(source))
    if source.name.lower() != expected.lower():
        raise RuntimeError(f"Expected WOA23 analyzed-mean ASCII filename {expected}, found {source.name}")
    # Full record count and fixed-width checks prevent a truncated or shifted file
    # from producing plausible-looking tiles. The values are parsed again for build.
    with (gzip.open(source, "rt", encoding="ascii", newline="") if source.suffix.lower() == ".gz" else source.open("rt", encoding="ascii", newline="")) as stream:
        parse_ascii_level(stream, 0, SOURCE_CONFIG[resolution]["expected_grid"])


def validate_source_file(source: Path, resolution: str, period: str, month: int) -> None:
    fmt = source_format_for(source)
    if fmt == "netcdf":
        validate_netcdf(source, resolution, period, month)
    else:
        validate_ascii(source, resolution, period, month)


def acquisition_candidates(month: int, resolution: str, period: str, provider: str):
    netcdf_name = expected_source_name(resolution, period, month, "netcdf")
    ascii_name = expected_source_name(resolution, period, month, "ascii-gzip")
    if provider == "gdex":
        return [("netcdf", f"{GDEX_OSDF_ROOT}/{netcdf_name}"),
                ("netcdf", f"{GDEX_HTTP_ROOT}/{netcdf_name}")]
    if provider == "noaa":
        if (resolution, period, month) == ("1.0", "decav", 9):
            return [("ascii-gzip", NOAA_ASCII_PHASE_A_URL),
                    ("netcdf", source_url(resolution, period, month, "netcdf"))]
        return [("netcdf", source_url(resolution, period, month, "netcdf"))]
    raise RuntimeError(f"Unknown remote source {provider!r}")


def download_source(month: int, resolution: str, period: str, cache_dir: Path,
                    provider: str) -> tuple[Path, str, str]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    candidates = [provider] if provider != "auto" else ["gdex", "noaa"]
    for cached_name in (expected_source_name(resolution, period, month, "netcdf"),
                        expected_source_name(resolution, period, month, "ascii-gzip")):
        cached = cache_dir / cached_name
        if cached.exists():
            try:
                validate_source_file(cached, resolution, period, month)
                receipt_path = cached.with_name(cached.name + ".source.json")
                receipt = json.loads(receipt_path.read_text(encoding="utf-8")) if receipt_path.exists() else {}
                cached_provider = receipt.get("provider", "local")
                cached_url = receipt.get("url", "")
                print(f"Using validated WOA23 cache: {cached.name} ({cached_provider})")
                return cached, cached_provider, cached_url
            except Exception as exc:
                invalid = cached.with_name(cached.name + f".invalid-{int(time.time())}")
                cached.replace(invalid)
                print(f"Cached file failed validation; preserved as {invalid.name}: {exc}", file=sys.stderr)

    failures: list[str] = []
    for candidate_provider in candidates:
        for fmt, url in acquisition_candidates(month, resolution, period, candidate_provider):
            target = cache_dir / expected_source_name(resolution, period, month, fmt)
            partial = target.with_name(target.name + ".part")
            for attempt in range(2):
                print(f"GDEX/NOAA source={candidate_provider} attempt={attempt + 1}/2: {url}", flush=True)
                try:
                    request = Request(url, headers={"User-Agent": "DiveAtlas-WOA23-builder/2.2", "Accept-Encoding": "identity"})
                    received = 0
                    with urlopen(request, timeout=20) as response, partial.open("wb") as output:
                        if response.status != 200:
                            raise RuntimeError(f"HTTP {response.status}")
                        while chunk := response.read(1024 * 1024):
                            output.write(chunk)
                            received += len(chunk)
                    if received < 1024:
                        raise RuntimeError(f"only {received} bytes received")
                    partial.replace(target)
                    validate_source_file(target, resolution, period, month)
                    receipt_path = target.with_name(target.name + ".source.json")
                    receipt_path.write_text(json.dumps({"provider": candidate_provider, "url": url}, indent=2) + "\n", encoding="utf-8")
                    print(f"Acquired {received} bytes from {candidate_provider}; cached at {target}")
                    return target, candidate_provider, url
                except HTTPError as exc:
                    reason = f"HTTP {exc.code}: {exc.reason}"
                except Exception as exc:
                    reason = str(exc)
                partial.unlink(missing_ok=True)
                target.unlink(missing_ok=True)
                failures.append(f"{candidate_provider} {url}: {reason}")
                print(f"{candidate_provider} failed ({reason})", file=sys.stderr)
                if attempt == 0:
                    time.sleep(2)
    raise RuntimeError("SOURCE ACQUISITION BLOCKED: " + "; ".join(failures))


def read_slice(source: Path, depth_m: int, resolution: str, month: int,
               period: str, acquisition_source: str,
               acquisition_url: str = "") -> NormalizedTemperatureGrid:
    fmt = source_format_for(source)
    if fmt.startswith("ascii"):
        opener = gzip.open if fmt == "ascii-gzip" else open
        with opener(source, "rt", encoding="ascii", newline="") as stream:
            grid = parse_ascii_level(stream, depth_level_index(depth_m), SOURCE_CONFIG[resolution]["expected_grid"])
        step = SOURCE_CONFIG[resolution]["resolution"]
        lat = np.arange(-90.0 + step / 2, 90.0, step, dtype=np.float64)
        lon = np.arange(step / 2, 360.0, step, dtype=np.float64)
        if grid.shape != (len(lat), len(lon)):
            raise RuntimeError(f"WOA compact ASCII grid shape {grid.shape} does not match coordinates {(len(lat), len(lon))}")
    else:
        with netcdf_dataset(source) as dataset:
            field = dataset.variables["t_an"]
            depth_values = np.asarray(dataset.variables["depth"][:], dtype=np.float64)
            match = np.flatnonzero(np.isclose(depth_values, depth_m, atol=1e-4))
            if not len(match):
                raise RuntimeError(f"Depth {depth_m} m is not a standard level in {source.name}")
            grid = np.ma.asarray(field[0, int(match[0]), :, :], dtype=np.float32)
            lat = np.asarray(dataset.variables["lat"][:], dtype=np.float64)
            lon = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
            if grid.shape != (len(lat), len(lon)):
                raise RuntimeError(f"Unexpected t_an slice dimensions: {grid.shape}")
    if acquisition_url:
        url = acquisition_url
    elif acquisition_source == "local":
        url = f"local-file:{source.resolve().as_posix()}"
    elif fmt.startswith("ascii"):
        url = NOAA_ASCII_PHASE_A_URL
    else:
        url = source_url(resolution, period, month, "netcdf")
    source_names = {"noaa": "NOAA NCEI", "gdex": "NSF NCAR GDEX", "local": "Local WOA23 input"}
    if acquisition_source not in source_names:
        raise RuntimeError(f"Unknown acquisition source {acquisition_source}")
    normalized_metadata = TemperatureSourceMetadata(
        source_name=source_names[acquisition_source],
        source_product="World Ocean Atlas 2023 monthly objectively analyzed temperature",
        climatology_period=PERIOD_CONFIG[period]["description"],
        source_resolution=SOURCE_CONFIG[resolution]["resolution"],
        source_type=f"WOA23 objectively analyzed mean ({'an' if fmt.startswith('ascii') else 't_an'})",
        source_url=url,
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )
    valid_mask = ~np.ma.getmaskarray(grid) & np.isfinite(np.asarray(grid.data))
    return NormalizedTemperatureGrid(
        longitude=lon, latitude=lat, depth=depth_m, month=month,
        temperature_c=grid, valid_mask=valid_mask, metadata=normalized_metadata,
    )


def read_query_month(source: Path, resolution: str, period: str, month: int,
                     acquisition_source: str, acquisition_url: str = ""):
    """Read every genuine WOA standard depth for one month, preserving masks."""
    validate_source_file(source, resolution, period, month)
    if source_format_for(source) != "netcdf":
        raise RuntimeError("Query chunks require the NetCDF source so all standard depths are available")
    with netcdf_dataset(source) as dataset:
        depths = np.asarray(dataset.variables["depth"][:], dtype=np.float64)
        selected_depth_indices = np.flatnonzero((depths >= 0) & (depths <= 50))
        if not len(selected_depth_indices):
            raise RuntimeError(f"{source.name} contains no source standard levels in the diver profile range")
        depths = depths[selected_depth_indices]
        lat = np.asarray(dataset.variables["lat"][:], dtype=np.float64)
        lon = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
        field = dataset.variables["t_an"]
        values = np.ma.asarray(field[0, selected_depth_indices, :, :], dtype=np.float32)
        if values.shape != (len(depths), len(lat), len(lon)):
            raise RuntimeError(f"Unexpected t_an query dimensions: {values.shape}")
        values.set_fill_value(QUERY_MISSING)
    valid = ~np.ma.getmaskarray(values) & np.isfinite(np.asarray(values.data))
    return depths, lat, lon, values, valid


def query_chunk_index(latitude: np.ndarray, longitude: np.ndarray, resolution: float):
    lat_step = float(np.median(np.abs(np.diff(latitude))))
    lon_step = float(np.median(np.abs(np.diff(longitude))))
    chunk_rows = max(1, round(QUERY_CHUNK_DEGREES / lat_step))
    chunk_columns = max(1, round(QUERY_CHUNK_DEGREES / lon_step))
    # WOA's regular monthly grids are centered on half-grid coordinates.
    latitude_direction = 1.0 if latitude[-1] > latitude[0] else -1.0
    lat_indices = np.rint((latitude - latitude[0]) / (lat_step * latitude_direction)).astype(int)
    lon_indices = np.rint((longitude - longitude[0]) / lon_step).astype(int)
    return lat_step, lon_step, chunk_rows, chunk_columns, lat_indices, lon_indices


def build_query_dataset(month_sources: dict[int, tuple[Path, str, str]], output_root: Path,
                        resolution: str, period: str) -> dict:
    """Write bounded, little-endian Int16 chunks in month/depth/lat/lon order."""
    if not month_sources:
        raise RuntimeError("No authentic monthly sources were supplied for query generation")
    month_ids = sorted(month_sources)
    first_month = month_ids[0]
    source, provider, source_url_used = month_sources[first_month]
    actual_depths, lat, lon, values, valid = read_query_month(
        source, resolution, period, first_month, provider, source_url_used
    )
    lat_step, lon_step, chunk_rows, chunk_columns, lat_indices, lon_indices = query_chunk_index(
        lat, lon, SOURCE_CONFIG[resolution]["resolution"]
    )
    chunk_root = output_root / "query" / "chunks"
    chunk_root.mkdir(parents=True, exist_ok=True)
    chunks = []
    depth_values = [float(value) for value in actual_depths]
    work_root = output_root / "query" / ".work"
    work_root.mkdir(parents=True, exist_ok=True)
    work_files = []

    for row_start in range(0, len(lat), chunk_rows):
        row_end = min(len(lat), row_start + chunk_rows)
        row0 = max(0, row_start - QUERY_HALO_CELLS)
        row1 = min(len(lat), row_end + QUERY_HALO_CELLS)
        for column_start in range(0, len(lon), chunk_columns):
            column_end = min(len(lon), column_start + chunk_columns)
            column_indices = np.arange(column_start - QUERY_HALO_CELLS,
                                       column_end + QUERY_HALO_CELLS, dtype=np.int64) % len(lon)
            column0 = int(column_indices[0])
            row_chunk = row_start // chunk_rows
            column_chunk = column_start // chunk_columns
            name = f"r{row_chunk:02d}_c{column_chunk:02d}.i16.gz"
            work_path = work_root / name.replace(".gz", ".tmp")
            shape = (len(month_ids), len(depth_values), row1-row0, len(column_indices))
            data = np.memmap(work_path, mode="w+", dtype="<i2", shape=shape)
            data[:] = QUERY_MISSING
            descriptor = {
                "key": f"{row_chunk}:{column_chunk}", "file": name,
                "row_start": row_start, "row_count": row_end-row_start,
                "column_start": column_start, "column_count": column_end-column_start,
                "data_row_start": row0, "data_column_start": column0,
                "rows": row1-row0, "columns": len(column_indices),
                "uncompressed_bytes": int(np.prod(shape) * np.dtype("<i2").itemsize),
                "_column_indices": column_indices,
                "_work_path": work_path, "_shape": shape, "_memmap": data,
            }
            chunks.append(descriptor)
            work_files.append(work_path)

    for month_index, month in enumerate(month_ids):
        if month == first_month:
            month_values, month_valid = values, valid
        else:
            source, provider, source_url_used = month_sources[month]
            depths, month_lat, month_lon, month_values, month_valid = read_query_month(
                source, resolution, period, month, provider, source_url_used
            )
            if not (np.array_equal(lat, month_lat) and np.array_equal(lon, month_lon) and
                    np.array_equal(actual_depths, depths)):
                raise RuntimeError("Monthly query inputs do not share identical source coordinates and depth levels")
        for descriptor in chunks:
            r0, c0 = descriptor["data_row_start"], descriptor["data_column_start"]
            r1 = r0 + descriptor["rows"]
            column_indices = descriptor["_column_indices"]
            values_slice = np.asarray(np.take(month_values.data[:, r0:r1, :], column_indices, axis=2), dtype=np.float64)
            valid_slice = np.take(month_valid[:, r0:r1, :], column_indices, axis=2) & (values_slice >= -327.67) & (values_slice <= 327.67)
            quantized = np.full(values_slice.shape, QUERY_MISSING, dtype="<i2")
            quantized[valid_slice] = np.rint(values_slice[valid_slice] / QUERY_SCALE_C).astype("<i2")
            descriptor["_memmap"][month_index] = quantized

    for descriptor in chunks:
        descriptor.pop("_column_indices")
        data = descriptor.pop("_memmap")
        data.flush()
        data._mmap.close()
        del data
        work_path = descriptor.pop("_work_path")
        shape = descriptor.pop("_shape")
        path = chunk_root / descriptor["file"]
        with work_path.open("rb") as source_file, path.open("wb") as raw:
            with gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=6, mtime=0) as compressed:
                compressed.write(source_file.read())
        data_bytes = work_path.stat().st_size
        work_path.unlink()
        descriptor["bytes"] = path.stat().st_size
        descriptor["uncompressed_bytes"] = data_bytes

    providers = {provider for _, provider, _ in month_sources.values()}
    source_label = "NSF NCAR GDEX" if providers == {"gdex"} else "NOAA NCEI" if providers == {"noaa"} else "WOA23 mixed/local source inputs"
    chunk_sizes = [descriptor["bytes"] for descriptor in chunks]
    compressed_total = sum(chunk_sizes)
    metadata = {
        "format": "diveatlas-temperature-query", "format_version": QUERY_VERSION,
        "designation": "development-validation" if resolution == "1.0" else "production",
        "source": source_label,
        "source_product": "World Ocean Atlas 2023 monthly objectively analyzed temperature",
        "climatology_period": PERIOD_CONFIG[period]["description"],
        "source_resolution_degrees": SOURCE_CONFIG[resolution]["resolution"],
        "grid": {"latitude_count": len(lat), "longitude_count": len(lon),
                 "latitude_first_center": float(lat[0]), "longitude_first_center": float(lon[0]),
                 "latitude_step_degrees": lat_step, "longitude_step_degrees": lon_step,
                 "latitude_order": "south_to_north" if lat[-1] > lat[0] else "north_to_south",
                 "longitude_convention": "-180_to_180" if lon[0] < 0 else "0_to_360"},
        "available_months": month_ids, "available_depths_m": depth_values,
        "value_encoding": {"dtype": "int16", "byte_order": "little", "scale_c": QUERY_SCALE_C,
                            "missing_sentinel": QUERY_MISSING, "dimensions": ["month", "depth", "latitude", "longitude"]},
        "chunk_degrees": QUERY_CHUNK_DEGREES, "chunk_halo_cells": QUERY_HALO_CELLS,
        "chunk_grid": {"rows": math.ceil(len(lat) / chunk_rows), "columns": math.ceil(len(lon) / chunk_columns)},
        "chunk_size_summary": {
            "count": len(chunks), "compressed_total_bytes": compressed_total,
            "compressed_max_bytes": max(chunk_sizes),
            "compressed_p50_bytes": sorted(chunk_sizes)[len(chunk_sizes) // 2],
            "uncompressed_total_bytes": sum(item["uncompressed_bytes"] for item in chunks),
        },
        "chunk_order": "month-major, depth-major, latitude-major, longitude-major",
        "lookup": "nearest valid ocean source cell within 0.75 source-grid diagonal; no interpolation",
        "display_precision_c": 0.1,
        "source_files": {str(month): source.name for month, (source, _, _) in sorted(month_sources.items())},
        "generation_version": f"woa23-query-v{QUERY_VERSION}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    }
    path = output_root / "query" / "metadata.json"
    path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"{path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}: {len(chunks)} chunks, {sum(item['bytes'] for item in chunks)} bytes")
    return metadata


def report_source_values(source: Path, normalized: NormalizedTemperatureGrid) -> dict[str, float | int]:
    grid = normalized.temperature_c
    valid = normalized.valid_mask
    values = np.asarray(grid.data, dtype=np.float64)[valid]
    if not values.size:
        raise RuntimeError("No valid ocean cells found in the requested WOA23 field")
    minimum, maximum = float(values.min()), float(values.max())
    if np.allclose(values, 0.0) or minimum < -5.0 or maximum > 50.0:
        raise RuntimeError(f"WOA23 values are physically implausible or parser-shifted: min={minimum:g} max={maximum:g} °C")
    stats = {"valid_cells": int(values.size), "masked_cells": int(grid.size - values.size), "min_c": minimum, "max_c": maximum}
    metadata = normalized.metadata
    print(f"SOURCE: name={metadata.source_name} format={source_format_for(source)} file={source.name} resolution={metadata.source_resolution}° period={normalized.metadata.climatology_period} product={metadata.source_product} field={metadata.source_type}")
    print(f"PARSE: requested_depth={normalized.depth}m found=yes valid_cells={stats['valid_cells']} masked_cells={stats['masked_cells']} min={minimum:.3f}°C max={maximum:.3f}°C")
    return stats


def update_metadata(output_root: Path, profile: str, month: int, depth_m: int,
                    tile_count: int, resolution: str, period: str,
                    input_mode: str, source: Path,
                    normalized: NormalizedTemperatureGrid) -> None:
    info = SOURCE_CONFIG[resolution]
    period_info = PERIOD_CONFIG[period]
    path = output_root / "metadata.json"
    metadata = {}
    if path.exists():
        metadata = json.loads(path.read_text(encoding="utf-8"))
    if metadata.get("active_profile") != profile:
        metadata = {}
    slices = {tuple(item) for item in metadata.get("available_slices", [])}
    slices.add((month, depth_m))
    metadata.update({
        "source": normalized.metadata.source_name,
        "source_product": normalized.metadata.source_product,
        "source_dataset": f"WOA23 monthly temperature, objectively analyzed mean (t_an/an), {period_info['description']}",
        "source_period": period,
        "source_period_description": period_info["description"],
        "source_field_type": normalized.metadata.source_type,
        "source_format": source_format_for(source),
        "source_file": source.name,
        "source_url": normalized.metadata.source_url,
        "source_url_template": normalized.metadata.source_url,
        "source_doi": "https://doi.org/10.25921/va26-hv25",
        "source_repository": "NSF NCAR Geoscience Data Exchange (GDEX)" if normalized.metadata.source_name == "NSF NCAR GDEX" else normalized.metadata.source_name,
        "source_repository_doi": "https://doi.org/10.5065/BC03-2G95" if normalized.metadata.source_name == "NSF NCAR GDEX" else None,
        "publication_citation": "Locarnini, R.A., A.V. Mishonov, O.K. Baranova, J.R. Reagan, T.P. Boyer, D. Seidov, Z. Wang, H.E. Garcia, C. Bouchard, S.L. Cross, C.R. Paver, and D. Dukhovskoy (2024). World Ocean Atlas 2023, Volume 1: Temperature. A. Mishonov Technical Editor, NOAA Atlas NESDIS 89. https://doi.org/10.25923/54bh-1613",
        "active_profile": profile,
        "purpose": "development-validation" if resolution == "1.0" else "production",
        "source_resolution": info["resolution"],
        "source_type": normalized.metadata.source_type,
        "generated_at": normalized.metadata.generated_at,
        "native_resolution": info["resolution"],
        "source_grid": {"resolution_degrees": info["resolution"], "latitude_points": info["expected_grid"][0], "longitude_points": info["expected_grid"][1]},
        "asset_base": f"data/temperature/{profile}",
        "tile_template": "woa23/monthly/{month}/{depth}/{z}/{x}/{y}.png",
        "supported_months": sorted({item[0] for item in slices}),
        "supported_depths_m": sorted({item[1] for item in slices}),
        "available_slices": [list(item) for item in sorted(slices)],
        "tile_contract": "{asset_base}/woa23/monthly/{month:02d}/{depth_m}/{z}/{x}/{y}.png",
        "max_native_zoom": info["max_native_zoom"],
        "min_native_zoom": info["max_native_zoom"],
        "temperature_scale": {"min_c": -2, "max_c": 32, "color_stops": COLOR_STOP_METADATA},
        "encoding": "RGBA PNG; fixed global continuous palette, alpha 0 means no source value",
        "missing_data": "Preserve the NetCDF t_an fill-value mask or WOA compact ASCII -99.9999 sentinel; sample nearest source cell with no interpolation",
        "coast_mask": "WOA23 t_an missing/land cells remain transparent; no raster interpolation is performed",
        "generation_version": SOURCE_VERSION,
        "acquisition_mode": input_mode,
        "generated_at_utc": normalized.metadata.generated_at,
        "last_build": {"month": month, "depth_m": depth_m, "zoom": info["max_native_zoom"], "tiles": tile_count},
    })
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


def build_slice(month: int, depth_m: int, source: Path | None, output_root: Path,
                region: str, cache_dir: Path, resolution: str, period: str,
                acquisition_source: str) -> int:
    info = SOURCE_CONFIG[resolution]
    provider, source_url_used = "local", ""
    if source is None:
        source_path, provider, source_url_used = download_source(month, resolution, period, cache_dir, acquisition_source)
    else:
        source_path = source
    if not source_path.exists():
        raise RuntimeError(f"Input file does not exist: {source_path}")
    validate_source_file(source_path, resolution, period, month)
    normalized = read_slice(source_path, depth_m, resolution, month, period, provider, source_url_used)
    report_source_values(source_path, normalized)
    bounds = TEST_REGION if region == "indonesia-test" else {
        "west": -180.0, "east": 179.999999, "south": -85.0, "north": 85.0
    }
    zoom = info["max_native_zoom"]
    xs, ys = tile_range(bounds, zoom)
    count = 0
    for x in xs:
        for y in ys:
            tile_path = output_root / info["profile"] / "woa23" / "monthly" / f"{month:02d}" / str(depth_m) / str(zoom) / str(x) / f"{y}.png"
            stats = write_tile(normalized, tile_path, zoom, x, y)
            shown_path = tile_path.relative_to(ROOT) if tile_path.is_relative_to(ROOT) else tile_path
            print(f"{shown_path}: valid={stats['valid_pixels']} transparent={stats['transparent_pixels']}")
            count += 1
    input_mode = f"local:{source_path}" if source else f"remote:{provider}"
    update_metadata(output_root, info["profile"], month, depth_m, count, resolution, period, input_mode, source_path, normalized)
    return count


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=False)
    selection.add_argument("--month", type=int, choices=range(1, 13))
    selection.add_argument("--all", action="store_true", help="Build all 12 months at every standard WOA23 depth from surface through 50 m")
    selection.add_argument("--build-query", action="store_true", help="Build spatial numeric query chunks from cached/downloaded monthly NetCDF sources")
    parser.add_argument("--months", help="Comma-separated months for --build-query (default: September only)")
    parser.add_argument("--depth", type=int, choices=DEPTHS, help="Standard WOA depth in metres (0 means surface)")
    parser.add_argument("--input", type=Path, help="Use an already acquired WOA23 NetCDF, .dat, or .dat.gz file (offline mode)")
    parser.add_argument("--profile", choices=("development-1deg", "production-0.25deg"), help="Select the source grid and output profile")
    parser.add_argument("--resolution", choices=("1.0", "0.25"), help="Deprecated alias for --profile")
    parser.add_argument("--period", choices=tuple(PERIOD_CONFIG), help="WOA23 climatological period (default: decav for 1°, decav91C0 for 0.25°)")
    parser.add_argument("--source", choices=("auto", "gdex", "noaa", "local"), default="auto", help="auto tries GDEX first, then NOAA; local requires --input")
    parser.add_argument("--region", choices=("indonesia-test", "global"), default="indonesia-test")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "temperature")
    parser.add_argument("--cache", type=Path, default=ROOT / "data" / ".build" / "temperature")
    args = parser.parse_args()
    if not (args.month is not None or args.all or args.build_query):
        parser.error("choose --month, --all, or --build-query")
    resolution_by_profile = {item["profile"]: resolution for resolution, item in SOURCE_CONFIG.items()}
    if args.profile and args.resolution and resolution_by_profile[args.profile] != args.resolution:
        parser.error("--profile and --resolution select different grids")
    args.resolution = args.resolution or resolution_by_profile.get(args.profile, "1.0")
    args.profile = SOURCE_CONFIG[args.resolution]["profile"]
    args.period = args.period or ("decav" if args.resolution == "1.0" else "decav91C0")
    if args.input:
        if args.source not in ("auto", "local"):
            parser.error("--input uses the local adapter; do not combine it with --source gdex/noaa")
        args.source = "local"
    elif args.source == "local":
        parser.error("--source local requires --input")
    if args.all and args.input:
        parser.error("--input can only be used with one --month/--depth pair")
    if args.all and (args.resolution != "0.25" or args.period != "decav91C0"):
        parser.error("--all production generation requires --profile production-0.25deg --period decav91C0")
    if args.all and args.region != "global":
        parser.error("--all requires --region global; generate and verify one slice first")
    if not args.all and args.depth is None:
        if args.month is not None:
            parser.error("--depth is required with --month")
    if args.months and not args.build_query:
        parser.error("--months is only valid with --build-query")
    return args


def main() -> int:
    args = parse_args()
    try:
        if args.build_query:
            months = [int(value.strip()) for value in args.months.split(",")] if args.months else [9]
            if not months or any(month < 1 or month > 12 for month in months) or len(set(months)) != len(months):
                raise RuntimeError("--months must list unique month numbers from 1 through 12")
            sources = {
                month: download_source(month, args.resolution, args.period, args.cache, args.source)
                for month in sorted(months)
            }
            build_query_dataset(sources, args.output, args.resolution, args.period)
        elif args.all:
            for month in range(1, 13):
                for depth in DEPTHS:
                    build_slice(month, depth, None, args.output, args.region, args.cache, args.resolution, args.period, args.source)
        else:
            build_slice(args.month, args.depth, args.input, args.output, args.region, args.cache, args.resolution, args.period, args.source)
    except Exception as exc:
        print(f"temperature build failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
