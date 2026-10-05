"""Build validated, offline-first Coral Heat Stress map and query assets."""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import re
import shutil
import struct
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import netCDF4
import numpy as np
from PIL import Image

from .thermal_style import COLORS, CATEGORY_COLORS, CURRENT_ADJACENT_ALPHA, CURRENT_CONTEXT_ALPHA, CURRENT_REEF_ALPHA, apply_common_display_mask, read_history_display_mask, read_history_reef_mask


SOURCE_BASE = "https://www.star.nesdis.noaa.gov/pub/socd/mecb/crw/data/5km/v3.1_op/nc/v1.0/daily"
PRODUCT_VERSION = "3.1"
PREPROCESSING_VERSION = "2"
MISSING = 255
QUERY_MISSING = -32768
NOAA_FILL = -32768
QUERY_SIZE = 256
QUERY_HEADER = struct.Struct("<4sBBHHH")
MAP_ZOOM = 5
CATEGORY_NAMES = ["No Stress", "Watch", "Warning", "Alert Level 1", "Alert Level 2", "Alert Level 3", "Alert Level 4", "Alert Level 5"]
PALETTE = np.asarray(CATEGORY_COLORS, dtype=np.uint8)
CONTEXT_ALPHA = np.asarray(CURRENT_CONTEXT_ALPHA, dtype=np.uint8)
ADJACENT_ALPHA = np.asarray(CURRENT_ADJACENT_ALPHA, dtype=np.uint8)
REEF_ALPHA = np.asarray(CURRENT_REEF_ALPHA, dtype=np.uint8)
PRODUCTS = {
    "baa": ("ct5km_baa5-max-7d_v3.1_", "bleaching_alert_area"),
    "hs": ("ct5km_hs_v3.1_", "hotspot"),
    "dhw": ("ct5km_dhw_v3.1_", "degree_heating_week"),
}


def classify_baa(hotspot: np.ndarray, dhw: np.ndarray, valid: np.ndarray | None = None) -> np.ndarray:
    """Classify raw NOAA hundredth-unit values. Invalid or fill inputs stay 255."""
    hotspot = np.asarray(hotspot)
    dhw = np.asarray(dhw)
    valid = np.isfinite(hotspot) & np.isfinite(dhw) if valid is None else np.asarray(valid, dtype=bool)
    valid &= np.isfinite(hotspot) & np.isfinite(dhw)
    valid &= (hotspot != NOAA_FILL) & (dhw != NOAA_FILL)
    categories = np.full(hotspot.shape, MISSING, dtype=np.uint8)
    categories[valid] = 0
    categories[valid & (hotspot > 0) & (hotspot < 100)] = 1
    active = valid & (hotspot >= 100)
    categories[active & (dhw < 400)] = 2
    categories[active & (dhw >= 400) & (dhw < 800)] = 3
    categories[active & (dhw >= 800) & (dhw < 1200)] = 4
    categories[active & (dhw >= 1200) & (dhw < 1600)] = 5
    categories[active & (dhw >= 1600) & (dhw < 2000)] = 6
    categories[active & (dhw >= 2000)] = 7
    return categories


def maximum_baa_window(days: list[tuple[np.ndarray, np.ndarray, np.ndarray]]) -> np.ndarray:
    """Take a categorical maximum across available daily observations; never infer from separate maxima."""
    if not days:
        raise ValueError("At least one daily HotSpot/DHW pair is required")
    shape = np.asarray(days[0][0]).shape
    maximum = np.zeros(shape, dtype=np.uint8)
    seen = np.zeros(shape, dtype=bool)
    for hotspot, dhw, valid in days:
        if np.asarray(hotspot).shape != shape or np.asarray(dhw).shape != shape or np.asarray(valid).shape != shape:
            raise ValueError("Daily HotSpot/DHW grids must have matching dimensions")
        categories = classify_baa(hotspot, dhw, valid)
        day_valid = categories != MISSING
        np.maximum(maximum, categories, out=maximum, where=day_valid)
        seen |= day_valid
    maximum[~seen] = MISSING
    return maximum


def validate_category_array(categories: np.ndarray) -> None:
    values = np.asarray(categories)
    if values.dtype != np.uint8 or np.any(~((values <= 7) | (values == MISSING))):
        raise ValueError("Processed categories must be uint8 values 0..7 or 255 missing")


def _source_paths(source: Path) -> tuple[date, Path, list[tuple[Path, Path]]]:
    baa_files = sorted(source.glob("ct5km_baa5-max-7d_v3.1_*.nc"))
    if not baa_files:
        raise FileNotFoundError(f"No NOAA 7-day BAA source file found under {source}")
    match = re.search(r"(\d{8})\.nc$", baa_files[-1].name)
    end_day = datetime.strptime(match.group(1), "%Y%m%d").date()
    window = []
    for day in (end_day - timedelta(days=offset) for offset in range(6, -1, -1)):
        token = day.strftime("%Y%m%d")
        hs = source / f"ct5km_hs_v3.1_{token}.nc"
        dhw = source / f"ct5km_dhw_v3.1_{token}.nc"
        if not hs.is_file() or not dhw.is_file() or hs.stat().st_size == 0 or dhw.stat().st_size == 0:
            raise FileNotFoundError(f"Missing or empty NOAA HotSpot/DHW data for {day}")
        window.append((hs, dhw))
    return end_day, baa_files[-1], window


def _read_source(path: Path, variable_name: str):
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError(f"Source file is missing or empty: {path}")
    dataset = netCDF4.Dataset(path)
    if variable_name not in dataset.variables or not all(name in dataset.variables for name in ("time", "lat", "lon")):
        dataset.close()
        raise ValueError(f"{path.name} does not contain required variables/coordinates")
    variable = dataset.variables[variable_name]
    if variable.ndim != 3 or variable.shape[0] != 1 or variable.dimensions != ("time", "lat", "lon"):
        dataset.close()
        raise ValueError(f"{path.name}:{variable_name} has unexpected dimensions {variable.dimensions}")
    if len(dataset.dimensions["lat"]) < 2 or len(dataset.dimensions["lon"]) < 2:
        dataset.close()
        raise ValueError(f"{path.name} latitude/longitude grid is too small")
    variable.set_auto_maskandscale(False)
    return dataset, variable


def _check_grid(reference, candidate, path: Path) -> None:
    for name in ("lat", "lon"):
        a = np.asarray(reference.variables[name][:])
        b = np.asarray(candidate.variables[name][:])
        if a.ndim != 1 or b.ndim != 1 or not np.all(np.isfinite(a)) or not np.all(np.isfinite(b)):
            raise ValueError(f"{path.name} has invalid {name} coordinates")
        differences = np.diff(b)
        if not np.array_equal(a, b) or not (np.all(differences > 0) or np.all(differences < 0)):
            raise ValueError(f"{path.name} {name} grid does not match or is not strictly monotonic")


def _date_from_dataset(dataset) -> date:
    value = netCDF4.num2date(dataset.variables["time"][0], dataset.variables["time"].units, calendar=getattr(dataset.variables["time"], "calendar", "standard"))
    return date(value.year, value.month, value.day)


def _raw_valid(variable, values) -> np.ndarray:
    fill = getattr(variable, "_FillValue", None)
    missing = getattr(variable, "missing_value", fill)
    valid = np.isfinite(values)
    if fill is not None:
        valid &= values != fill
    if missing is not None:
        valid &= values != missing
    source_min = getattr(variable, "valid_min", None)
    source_max = getattr(variable, "valid_max", None)
    if source_min is not None:
        valid &= values >= source_min
    if source_max is not None:
        valid &= values <= source_max
    return valid


def _atomic_json(path: Path, payload: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    json.loads(temporary.read_text(encoding="utf-8"))
    temporary.replace(path)


def _release_name(end_day: date, releases: Path) -> str:
    """Use a later revision whenever a date already has a release, so retention cannot delete the active pointer."""
    name = end_day.strftime("%Y%m%d") + f"-p{PREPROCESSING_VERSION}"
    if any(releases.glob(f"{end_day:%Y%m%d}-p*")):
        name += "-r" + datetime.now(timezone.utc).strftime("%H%M%S")
    return name


def _current_tile_alpha(categories: np.ndarray, adjacent_cells: np.ndarray,
                        reef_cells: np.ndarray) -> np.ndarray:
    """Keep valid ocean context visible while progressively emphasizing analyzed reef cells."""
    if categories.shape != adjacent_cells.shape or categories.shape != reef_cells.shape:
        raise ValueError("Current BAA categories and reef emphasis masks must have matching shapes")
    if np.any(adjacent_cells & reef_cells):
        raise ValueError("Current BAA reef and buffer emphasis masks must not overlap")
    valid = categories != MISSING
    alpha = np.zeros(categories.shape, dtype=np.uint8)
    alpha[valid] = CONTEXT_ALPHA[categories[valid]]
    adjacent = valid & adjacent_cells
    alpha[adjacent] = ADJACENT_ALPHA[categories[adjacent]]
    reef = valid & reef_cells
    alpha[reef] = REEF_ALPHA[categories[reef]]
    return alpha


def _render_tiles(categories: np.ndarray, latitude: np.ndarray, output: Path,
                  adjacent_mask: np.ndarray | None = None, reef_mask: np.ndarray | None = None) -> int:
    world = 256 * (1 << MAP_ZOOM)
    pixel_x = np.arange(world, dtype=np.float64)
    longitude = -180.0 + (pixel_x + 0.5) * (360.0 / world)
    # Source centers are -179.975 + n*0.05; align against that actual coordinate origin.
    grid_lon = np.rint((longitude + 179.975) / 0.05).astype(np.int64) % categories.shape[1]
    if adjacent_mask is not None and adjacent_mask.shape != categories.shape:
        raise ValueError("Current BAA reef-buffer emphasis mask does not match its source grid")
    if reef_mask is not None and reef_mask.shape != categories.shape:
        raise ValueError("Current BAA reef emphasis mask does not match its source grid")
    if reef_mask is not None and adjacent_mask is not None and np.any(reef_mask & adjacent_mask):
        raise ValueError("Current BAA reef and buffer emphasis masks must not overlap")
    tile_count = 0
    for tile_y in range(1 << MAP_ZOOM):
        ys = tile_y * 256 + np.arange(256, dtype=np.float64) + 0.5
        latitudes = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * ys / world))))
        grid_lat = np.rint((latitudes - float(latitude[0])) / float(latitude[1] - latitude[0])).astype(np.int64)
        valid_y = (grid_lat >= 0) & (grid_lat < categories.shape[0])
        for tile_x in range(1 << MAP_ZOOM):
            xs = slice(tile_x * 256, (tile_x + 1) * 256)
            cells = np.full((256, 256), MISSING, dtype=np.uint8)
            adjacent_pixels = np.zeros(cells.shape, dtype=bool)
            reef_pixels = np.zeros(cells.shape, dtype=bool)
            if valid_y.any():
                cells[valid_y] = categories[grid_lat[valid_y, None], grid_lon[xs][None, :]]
                if adjacent_mask is not None:
                    adjacent_pixels[valid_y] = adjacent_mask[grid_lat[valid_y, None], grid_lon[xs][None, :]]
                if reef_mask is not None:
                    reef_pixels[valid_y] = reef_mask[grid_lat[valid_y, None], grid_lon[xs][None, :]]
            rgba = np.zeros((256, 256, 4), dtype=np.uint8)
            valid = cells != MISSING
            rgba[valid, :3] = PALETTE[cells[valid]]
            rgba[:, :, 3] = _current_tile_alpha(cells, adjacent_pixels, reef_pixels)
            target = output / str(MAP_ZOOM) / str(tile_x) / f"{tile_y}.png"
            target.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(rgba, "RGBA").save(target, optimize=True)
            tile_count += 1
    return tile_count


def _write_queries(categories: np.ndarray, hotspot: np.ndarray, dhw: np.ndarray, valid_h: np.ndarray, valid_d: np.ndarray, output: Path) -> int:
    height, width = categories.shape
    tile_count = 0
    for row in range(math.ceil(height / QUERY_SIZE)):
        y0 = row * QUERY_SIZE
        for column in range(math.ceil(width / QUERY_SIZE)):
            x0 = column * QUERY_SIZE
            h = np.full((QUERY_SIZE, QUERY_SIZE), QUERY_MISSING, dtype="<i2")
            d = np.full_like(h, QUERY_MISSING)
            c = np.full((QUERY_SIZE, QUERY_SIZE), MISSING, dtype=np.uint8)
            y1, x1 = min(y0 + QUERY_SIZE, height), min(x0 + QUERY_SIZE, width)
            c[:y1-y0, :x1-x0] = categories[y0:y1, x0:x1]
            hv = valid_h[y0:y1, x0:x1]
            dv = valid_d[y0:y1, x0:x1]
            h[:y1-y0, :x1-x0][hv] = hotspot[y0:y1, x0:x1][hv]
            d[:y1-y0, :x1-x0][dv] = dhw[y0:y1, x0:x1][dv]
            body = np.empty((QUERY_SIZE, QUERY_SIZE, 5), dtype=np.uint8)
            body[:, :, 0] = c
            body[:, :, 1:3] = h.view(np.uint8).reshape(QUERY_SIZE, QUERY_SIZE, 2)
            body[:, :, 3:5] = d.view(np.uint8).reshape(QUERY_SIZE, QUERY_SIZE, 2)
            payload = QUERY_HEADER.pack(b"DCHS", 1, 5, QUERY_SIZE, column, row) + body.tobytes()
            target = output / f"{column}_{row}.bin.gz"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(gzip.compress(payload, compresslevel=6, mtime=0))
            tile_count += 1
    return tile_count


def build(source: Path, output: Path, *, force: bool = False) -> dict:
    source = source.resolve()
    output = output.resolve()
    end_day, baa_path, window = _source_paths(source)
    if output.exists() and (output / "metadata.json").is_file() and not force:
        current = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
        if current.get("dataDate", "") >= end_day.isoformat():
            raise ValueError(f"NOAA data {end_day} is not newer than the published dataset {current.get('dataDate')}; pass --force to rebuild deliberately")

    stage_parent = output.parent / ".build" / "coral_heat_stress" / "staging"
    stage_parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f"{end_day:%Y%m%d}-", dir=stage_parent))
    open_datasets = []
    try:
        baa_ds, baa_var = _read_source(baa_path, "bleaching_alert_area")
        open_datasets.append(baa_ds)
        if len(baa_ds.dimensions["lat"]) != 3600 or len(baa_ds.dimensions["lon"]) != 7200:
            raise ValueError("Production NOAA global grid must be 3600 x 7200 at 0.05 degree")
        if str(getattr(baa_ds, "product_version", "")) != PRODUCT_VERSION:
            raise ValueError("NOAA BAA source product version is not the verified 3.1 release")
        baa_date = _date_from_dataset(baa_ds)
        if baa_date != end_day:
            raise ValueError(f"BAA filename date {end_day} differs from NetCDF timestamp {baa_date}")
        latitude = np.asarray(baa_ds.variables["lat"][:], dtype=np.float32)
        longitude = np.asarray(baa_ds.variables["lon"][:], dtype=np.float32)
        if not np.isclose(abs(np.median(np.diff(latitude))), 0.05, rtol=0, atol=0.00002) or not np.isclose(abs(np.median(np.diff(longitude))), 0.05, rtol=0, atol=0.00002):
            raise ValueError("NOAA global source grid is not the verified 0.05 degree resolution")
        if int(getattr(baa_var, "_FillValue", -1)) != 251:
            raise ValueError("NOAA BAA fill value changed; update the decoder deliberately")
        history_mask, history_latitude, history_longitude = read_history_display_mask()
        reef_mask, reef_latitude, reef_longitude = read_history_reef_mask()
        if history_mask.shape[1] != len(longitude) or not np.allclose(longitude, history_longitude, atol=2e-5, rtol=0):
            raise ValueError("Current NOAA longitudes do not match the validated Thermal History display mask")
        baa_var.set_auto_maskandscale(False)
        official = baa_var[0]
        official_valid = (official >= 0) & (official <= 7) & (official != int(baa_var._FillValue))
        if np.any((official != int(baa_var._FillValue)) & ~((official >= 0) & (official <= 7))):
            raise ValueError("NOAA BAA contains categories outside 0..7")

        daily_sources = []
        for hs_path, dhw_path in window:
            hs_ds, hs_var = _read_source(hs_path, "hotspot")
            dhw_ds, dhw_var = _read_source(dhw_path, "degree_heating_week")
            open_datasets.extend((hs_ds, dhw_ds))
            _check_grid(baa_ds, hs_ds, hs_path)
            _check_grid(baa_ds, dhw_ds, dhw_path)
            hs_date, dhw_date = _date_from_dataset(hs_ds), _date_from_dataset(dhw_ds)
            if hs_date != dhw_date or hs_date != _date_from_dataset(baa_ds) - timedelta(days=6-len(daily_sources)):
                raise ValueError(f"NOAA HotSpot/DHW timestamps are not consecutive and aligned: {hs_date} / {dhw_date}")
            for var, label in ((hs_var, "HotSpot"), (dhw_var, "DHW")):
                if float(getattr(var, "scale_factor", 1)) != 0.01:
                    raise ValueError(f"NOAA {label} scale factor changed; update the decoder deliberately")
            daily_sources.append((hs_var, dhw_var))
        if len(daily_sources) != 7:
            raise ValueError("Exactly seven consecutive NOAA HotSpot/DHW pairs are required")

        derived = np.full(official.shape, MISSING, dtype=np.uint8)
        valid_days = np.zeros(official.shape, dtype=np.uint8)
        final_hotspot = np.full(official.shape, QUERY_MISSING, dtype="<i2")
        final_dhw = np.full_like(final_hotspot, QUERY_MISSING)
        valid_h_final = np.zeros(official.shape, dtype=bool)
        valid_d_final = np.zeros(official.shape, dtype=bool)
        transition = np.zeros((8, 8), dtype=np.int64)
        mismatch_samples = []
        for y0 in range(0, official.shape[0], 64):
            y1 = min(y0 + 64, official.shape[0]); region = (slice(y0, y1), slice(None))
            max_category = np.zeros((y1-y0, official.shape[1]), dtype=np.uint8)
            seen = np.zeros(max_category.shape, dtype=bool)
            for index, (hs_var, dhw_var) in enumerate(daily_sources):
                h = hs_var[0, y0:y1, :]
                d = dhw_var[0, y0:y1, :]
                vh = _raw_valid(hs_var, h); vd = _raw_valid(dhw_var, d)
                valid = vh & vd
                category = classify_baa(h, d, valid)
                np.maximum(max_category, category, out=max_category, where=valid)
                seen |= valid
                if index == 6:
                    final_hotspot[region] = np.where(vh, h, QUERY_MISSING).astype("<i2")
                    final_dhw[region] = np.where(vd, d, QUERY_MISSING).astype("<i2")
                    valid_h_final[region] = vh
                    valid_d_final[region] = vd
            max_category[~seen] = MISSING
            derived[region] = max_category
            comparable = official_valid[region] & seen
            observed = official[region]
            for source_category in range(8):
                for target_category in range(8):
                    transition[source_category, target_category] += np.count_nonzero(comparable & (max_category == source_category) & (observed == target_category))
            if len(mismatch_samples) < 20:
                mismatch_rows, mismatch_columns = np.where(comparable & (max_category != observed))
                for mismatch_row, mismatch_column in zip(mismatch_rows, mismatch_columns):
                    mismatch_samples.append({"latitude": float(latitude[y0 + mismatch_row]), "longitude": float(longitude[mismatch_column]), "derived": int(max_category[mismatch_row, mismatch_column]), "official": int(observed[mismatch_row, mismatch_column])})
                    if len(mismatch_samples) == 20:
                        break
        valid_cells = int(transition.sum())
        identical_cells = int(np.trace(transition))
        mismatches = valid_cells - identical_cells
        mismatch_percent = mismatches / valid_cells * 100 if valid_cells else 100.0
        if mismatch_percent > 0.01:
            raise ValueError(f"Derived BAA disagrees with NOAA official BAA at {mismatches:,}/{valid_cells:,} cells ({mismatch_percent:.6f}%); refusing publication")
        validate_category_array(derived)
        # Align both NOAA relevance masks for styling; unlike the earlier reef-only map, all valid BAA cells remain visible.
        adjacent_categories = apply_common_display_mask(np.zeros_like(derived), latitude, history_mask, history_latitude, history_longitude)
        reef_categories = apply_common_display_mask(np.zeros_like(derived), latitude, reef_mask, reef_latitude, reef_longitude)
        aligned_adjacent_mask = (adjacent_categories == 0) & (reef_categories != 0)
        aligned_reef_mask = reef_categories == 0
        if latitude[0] > latitude[-1]:
            latitude = latitude[::-1].copy()
            derived = derived[::-1].copy()
            aligned_adjacent_mask = aligned_adjacent_mask[::-1].copy()
            aligned_reef_mask = aligned_reef_mask[::-1].copy()
            final_hotspot = final_hotspot[::-1].copy()
            final_dhw = final_dhw[::-1].copy()
            valid_h_final = valid_h_final[::-1].copy()
            valid_d_final = valid_d_final[::-1].copy()
        latest_hs, latest_dhw = daily_sources[-1]
        observed_categories = np.unique(official[official_valid]).astype(int).tolist()
        if not all(category in range(8) for category in observed_categories):
            raise ValueError("NOAA BAA unique values violate the verified classification")
        generated_at = datetime.now(timezone.utc).isoformat()
        release = _release_name(end_day, output / "releases")
        release_dir = stage / "releases" / release
        map_count = _render_tiles(derived, latitude, release_dir / "tiles", adjacent_mask=aligned_adjacent_mask, reef_mask=aligned_reef_mask)
        query_count = _write_queries(derived, final_hotspot, final_dhw, valid_h_final, valid_d_final, release_dir / "query")
        map_files = list((release_dir / "tiles").rglob("*.png"))
        query_files = list((release_dir / "query").glob("*.bin.gz"))
        if not map_files or not query_files or any(path.stat().st_size == 0 for path in map_files + query_files):
            raise ValueError("Generated Heat Stress assets are empty or incomplete")
        metadata = {
            "schema_version": 1,
            "version": release,
            "asset_base": f"data/coral-heat-stress/releases/{release}",
            "source": "NOAA Coral Reef Watch",
            "provider": "NOAA Coral Reef Watch",
            "product": "Daily Global 5 km Satellite Coral Bleaching Heat Stress Monitoring Product Suite",
            "productVersion": PRODUCT_VERSION,
            "preprocessingVersion": PREPROCESSING_VERSION,
            "dataDate": end_day.isoformat(),
            "generatedAt": generated_at,
            "resolution": "0.05 degree (~5 km at the equator)",
            "metric": "Bleaching Alert Area 7-day maximum",
            "units": "NOAA BAA classification category (unitless)",
            "sourceMetadata": "Daily Global 5 km Satellite Coral Bleaching Heat Stress Monitoring Product Suite, version 3.1; seven-day maximum BAA classification compared with NOAA's official BAA product.",
            "displayFootprint": {"strategy": "All valid NOAA global BAA ocean cells are rendered; NOAA reef-plus-buffer and reef footprints increase opacity for nearby context and reef cells; missing and land-fill cells remain transparent", "maskSource": "data/.build/coral_heat_stress/history_source/noaa_crw_thermal_history_annual_history_v3.7.0_1985-2025.nc:mask,reef_mask", "maskCells": int(history_mask.sum()), "reefCells": int(reef_mask.sum())},
            "classification": {"scheme": "NOAA CRW revised BAA classification", "effectiveSince": "2023-12-15", "min": 0, "max": 7},
            "categories": CATEGORY_NAMES,
            "sourceUrls": {"baa": f"{SOURCE_BASE}/baa5-max-7d/", "hotspot": f"{SOURCE_BASE}/hs/", "dhw": f"{SOURCE_BASE}/dhw/", "methodology": "https://coralreefwatch.noaa.gov/product/5km/methodology.php"},
            "sourceFiles": {"baa": baa_path.name, "hotspot": [hs.name for hs, _ in window], "dhw": [dhw.name for _, dhw in window], "timestamps": [date.isoformat() for date in (end_day - timedelta(days=offset) for offset in range(6, -1, -1))]},
            "variables": {"baa": "bleaching_alert_area (independent 7-day maximum validation)", "hotspot": "hotspot", "dhw": "degree_heating_week"},
            "attribution": "NOAA Coral Reef Watch",
            "grid": {"width": int(official.shape[1]), "height": int(official.shape[0]), "longitude_min": float(longitude[0]), "longitude_step": float(np.median(np.diff(longitude))), "latitude_min": float(latitude[0]), "latitude_step": float(np.median(np.diff(latitude))), "row_order": "south-to-north"},
            "encoding": {"missing": MISSING, "query_missing": QUERY_MISSING, "query_tile_size_cells": QUERY_SIZE, "query_bytes_per_cell": 5, "map_zoom": MAP_ZOOM, "max_native_zoom": MAP_ZOOM, "map_format": "transparent RGBA PNG XYZ tiles, nearest-cell sampling", "query_format": "gzip DCHS v1; uint8 category + int16 HotSpot/DHW hundredths", "displayStyle": {"colors": list(COLORS), "contextAlpha": CONTEXT_ALPHA.tolist(), "adjacentAlpha": ADJACENT_ALPHA.tolist(), "reefAlpha": REEF_ALPHA.tolist(), "zoomOpacity": {"fullThrough": 8, "reducedFrom": 9, "fadedFrom": 12, "floor": 0.48}}},
            "map_tile_template": "tiles/{z}/{x}/{y}.png",
            "query_tile_template": "query/{column}_{row}.bin.gz",
            "comparison": {"validCells": valid_cells, "identicalCells": identical_cells, "mismatchedCells": mismatches, "mismatchPercent": mismatch_percent, "mismatchesByTransition": {f"{a}->{b}": int(transition[a,b]) for a in range(8) for b in range(8) if transition[a,b]}, "sampleMismatchLocations": mismatch_samples},
            "actualOfficialBaaValues": observed_categories,
            "assets": {"mapTileCount": map_count, "mapBytes": sum(path.stat().st_size for path in map_files), "queryTileCount": query_count, "queryBytes": sum(path.stat().st_size for path in query_files)},
        }
        metadata_path = stage / "metadata.json"
        _atomic_json(metadata_path, metadata)
        json.loads(metadata_path.read_text(encoding="utf-8"))
        if output.exists() and (output / "metadata.json").is_file():
            published = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
            published_base = Path(published.get("asset_base", ""))
            if published_base.parts[:2] != ("data", "coral-heat-stress"):
                raise ValueError("Published metadata points outside the managed Heat Stress asset directory")
        output.mkdir(parents=True, exist_ok=True)
        final_release = output / "releases" / release
        final_release.parent.mkdir(parents=True, exist_ok=True)
        if final_release.exists():
            raise FileExistsError(f"Release asset directory already exists: {final_release}")
        final_release.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(release_dir), str(final_release))
        _atomic_json(output / "metadata.json", metadata)
        # Daily retries may create multiple package revisions for one NOAA date.
        # Keep only the newest revision for each date, then retain two dates for rollback.
        release_dirs = sorted((output / "releases").glob("????????-p*"), key=lambda path: path.name, reverse=True)
        newest_by_date: dict[str, Path] = {}
        for path in release_dirs:
            newest_by_date.setdefault(path.name[:8], path)
        retained_dates = set(sorted(newest_by_date, reverse=True)[:2])
        for obsolete in release_dirs:
            if obsolete.name[:8] not in retained_dates or newest_by_date[obsolete.name[:8]] != obsolete:
                shutil.rmtree(obsolete, ignore_errors=True)
        return metadata
    finally:
        for dataset in open_datasets:
            dataset.close()
        shutil.rmtree(stage, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=Path("data/.build/coral_heat_stress/source"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/coral-heat-stress"))
    parser.add_argument("--force", action="store_true", help="allow rebuilding a dataset with the same or an older date")
    args = parser.parse_args()
    metadata = build(args.input_dir, args.output_dir, force=args.force)
    print(json.dumps(metadata["comparison"] | metadata["assets"] | {"version": metadata["version"], "dataDate": metadata["dataDate"], "actualOfficialBaaValues": metadata["actualOfficialBaaValues"]}, indent=2))


if __name__ == "__main__":
    main()
