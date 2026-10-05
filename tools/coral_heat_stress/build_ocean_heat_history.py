"""Build local static summaries from NOAA CRW Marine Heatwave Watch files.

Daily source files are processed in date order and deleted after each day;
only compact accumulators and derived map/query assets remain. NOAA MHW
categories are ordinal levels (0 means no MHW; 1-5 are MHW days), so counts
and run lengths use category >= 1 rather than interpreting map colors.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import gzip
import json
import math
import re
import shutil
import struct
import sys
import tempfile
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from netCDF4 import Dataset
from PIL import Image

try:
    from .ocean_heat_history_palette import CATEGORY_LABELS, CATEGORY_RGBA, category_definitions
except ImportError:  # Direct script execution sets sys.path to this tool directory.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from ocean_heat_history_palette import CATEGORY_LABELS, CATEGORY_RGBA, category_definitions


ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = "https://www.star.nesdis.noaa.gov/pub/socd/mecb/crw/data/marine_heatwave/v1.0.1/category/nc"
SOURCE_SHAPE = (3600, 7200)
AGGREGATION = 5
GRID_SHAPE = (720, 1440)
CELL_DEGREES = 0.25
QUERY_SIZE = 256
MISSING = 255
CHECKPOINT_INTERVAL = 100
QUERY_HEADER = struct.Struct("<4sHH")
QUERY_DTYPE = np.dtype([
    ("worst", "u1"), ("worst_day", "<u2"), ("mhw_days", "<u2"),
    ("strong_days", "<u2"), ("severe_days", "<u2"), ("extreme_days", "<u2"),
    ("longest_run", "<u2"), ("valid_days", "<u2"),
])
OCEAN_COLORS = np.asarray(CATEGORY_RGBA, dtype=np.uint8)
PERSISTENCE_COLORS = np.asarray([
    (86, 151, 172, 34), (244, 219, 112, 72), (245, 177, 88, 92),
    (235, 132, 71, 112), (211, 86, 66, 132), (152, 55, 90, 150),
], dtype=np.uint8)


def daily_url(day: date) -> str:
    return f"{ARCHIVE}/{day.year}/noaa-crw_mhw_v1.0.1_category_{day:%Y%m%d}.nc"


def list_year_days(year: int, timeout: int = 45) -> set[date]:
    request = urllib.request.Request(f"{ARCHIVE}/{year}/", headers={"User-Agent": "DiveAtlas offline builder"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        html = response.read().decode("utf-8", errors="replace")
    return {date.fromisoformat(match) for match in re.findall(
        rf"noaa-crw_mhw_v1\.0\.1_category_({year}\d{{4}})\.nc", html,
    )}


def latest_complete_year(today: date | None = None) -> int:
    today = today or date.today()
    for year in range(today.year, 1984, -1):
        found = list_year_days(year)
        expected = {date(year, 1, 1) + timedelta(days=index) for index in range(366 if _leap(year) else 365)}
        if expected <= found:
            return year
    raise RuntimeError("NOAA archive contains no complete source year")


def recent_complete_period(end_year: int | None = None, years: int = 10) -> list[date]:
    if years < 1:
        raise ValueError("years must be positive")
    end_year = end_year or latest_complete_year()
    selected_years = year_window(end_year, years)
    available = [list_year_days(year) for year in selected_years]
    dates = []
    for year, found in zip(selected_years, available):
        expected = dates_in_year(year)
        if not set(expected) <= found:
            raise RuntimeError(f"NOAA year {year} is not complete; refusing an incomplete recent-decade window")
        dates.extend(expected)
    return dates


def year_window(end_year: int, years: int = 10) -> list[int]:
    if years < 1 or end_year - years + 1 < 1985:
        raise ValueError("requested year window is outside the NOAA MHW source period")
    return list(range(end_year - years + 1, end_year + 1))


def dates_in_year(year: int) -> list[date]:
    return [date(year, 1, 1) + timedelta(days=index) for index in range(366 if _leap(year) else 365)]


def _leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def read_daily(path: Path, observed_date: date, preceding_water_mask: np.ndarray | None = None
               ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    with Dataset(path) as dataset:
        variable = dataset.variables.get("heatwave_category")
        mask_variable = dataset.variables.get("mask")
        if variable is None or mask_variable is None or variable.shape != (1, *SOURCE_SHAPE):
            raise ValueError(f"Unsupported NOAA daily file: {path}")
        lat = np.asarray(dataset.variables["lat"][:], dtype=np.float64)
        lon = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
        # NOAA uses signed int8 storage (including negative fill codes), so
        # convert to int16 before replacing masked values with an unsigned sentinel.
        category = np.asarray(variable[0].astype(np.int16).filled(-127), dtype=np.int16)
        mask = np.asarray(mask_variable[0].astype(np.int16).filled(-127), dtype=np.int16)
    valid_ocean, water_mask = valid_water_pixels(category, mask, observed_date, preceding_water_mask)
    # Mask 0 is valid water; 1 land, 2 unavailable, 4 static ice, and fill are
    # not data. Keep them distinct from category 0 in all summaries.
    category = np.where(valid_ocean, category, MISSING).astype(np.uint8)
    return category, valid_ocean, water_mask, lat, lon


def read_daily_with_one_retry(path: Path, observed_date: date, preceding_water_mask: np.ndarray | None,
                              redownload: Callable[[], tuple[int, int]]
                              ) -> tuple[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray], int, int]:
    try:
        return read_daily(path, observed_date, preceding_water_mask), 0, 0
    except OSError:
        # A truncated HTTP response once produced a NetCDF/HDF error mid-run.
        # Re-fetch only that corrupt day once; persistent source failures still abort the build.
        path.unlink(missing_ok=True)
        retry_bytes, network_retries = redownload()
        return read_daily(path, observed_date, preceding_water_mask), retry_bytes, network_retries


def valid_water_pixels(category: np.ndarray, mask: np.ndarray, observed_date: date,
                       preceding_water_mask: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    if category.shape != mask.shape:
        raise ValueError("category and mask arrays must have matching dimensions")
    water_mask = mask == 0
    if observed_date.month == 2 and observed_date.day == 29:
        if preceding_water_mask is None or preceding_water_mask.shape != mask.shape:
            raise ValueError("Leap-day files require the preceding date's water mask")
        # NOAA's Feb 29 files in the inspected decade mark continental land
        # as mask=0. Intersect with Feb 28's geography so those cells cannot
        # become false MHW observations; actual Feb 29 ocean categories remain.
        water_mask &= preceding_water_mask
    return water_mask & (category >= 0) & (category <= 5), water_mask


@dataclass
class Accumulators:
    worst: np.ndarray
    worst_day: np.ndarray
    mhw_days: np.ndarray
    strong_days: np.ndarray
    severe_days: np.ndarray
    extreme_days: np.ndarray
    current_run: np.ndarray
    longest_run: np.ndarray
    valid_days: np.ndarray

    @classmethod
    def create(cls, shape: tuple[int, int] = GRID_SHAPE) -> "Accumulators":
        zeros = lambda: np.zeros(shape, dtype=np.uint16)
        return cls(np.full(shape, MISSING, dtype=np.uint8), np.full(shape, MISSING, dtype=np.uint16),
                   zeros(), zeros(), zeros(), zeros(), zeros(), zeros(), zeros())

    def update(self, categories: np.ndarray, day_index: int) -> None:
        if categories.ndim != 2 or categories.shape != self.worst.shape:
            raise ValueError("Daily category grid does not match summary grid")
        valid = categories <= 5
        mhw = valid & (categories >= 1)
        unseen = valid & (self.worst == MISSING)
        worse = valid & ((categories > self.worst) | unseen)
        tied = valid & (categories == self.worst) & (self.worst != MISSING)
        self.worst[worse] = categories[worse]
        self.worst_day[worse | tied] = day_index  # chronological iteration makes ties select the latest date
        self.valid_days[valid] += 1
        self.mhw_days[mhw] += 1
        self.strong_days[valid & (categories >= 2)] += 1
        self.severe_days[valid & (categories >= 3)] += 1
        self.extreme_days[valid & (categories >= 4)] += 1
        # Unknown/land/unavailable breaks a run; it is never silently counted as a zero-category day.
        self.current_run[~valid] = 0
        self.current_run[valid & ~mhw] = 0
        self.current_run[mhw] += 1
        np.maximum(self.longest_run, self.current_run, out=self.longest_run)

    def query_grid(self) -> np.ndarray:
        result = np.empty(self.worst.shape, dtype=QUERY_DTYPE)
        result["worst"] = self.worst
        result["worst_day"] = self.worst_day
        result["mhw_days"] = self.mhw_days
        result["strong_days"] = self.strong_days
        result["severe_days"] = self.severe_days
        result["extreme_days"] = self.extreme_days
        result["longest_run"] = self.longest_run
        result["valid_days"] = self.valid_days
        result["worst"][self.valid_days == 0] = MISSING
        return result


ACCUMULATOR_ARRAYS = (
    "worst", "worst_day", "mhw_days", "strong_days", "severe_days", "extreme_days",
    "current_run", "longest_run", "valid_days",
)


@dataclass
class BuildCheckpoint:
    accum: Accumulators
    completed: int = 0
    total_bytes: int = 0
    network_retries: int = 0
    invalid_netcdf_retries: int = 0
    preceding_water_mask: np.ndarray | None = None


def save_checkpoint(path: Path, dates: list[date], checkpoint: BuildCheckpoint) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f"{path.stem}.tmp{path.suffix}")
    arrays = {name: getattr(checkpoint.accum, name) for name in ACCUMULATOR_ARRAYS}
    np.savez_compressed(
        temporary_path,
        version=np.asarray([1], dtype=np.uint8),
        start_date=np.asarray(dates[0].isoformat()), end_date=np.asarray(dates[-1].isoformat()),
        day_count=np.asarray([len(dates)], dtype=np.uint32), completed=np.asarray([checkpoint.completed], dtype=np.uint32),
        total_bytes=np.asarray([checkpoint.total_bytes], dtype=np.uint64),
        network_retries=np.asarray([checkpoint.network_retries], dtype=np.uint32),
        invalid_netcdf_retries=np.asarray([checkpoint.invalid_netcdf_retries], dtype=np.uint32),
        preceding_water_mask=checkpoint.preceding_water_mask,
        **arrays,
    )
    temporary_path.replace(path)


def load_checkpoint(path: Path, dates: list[date]) -> BuildCheckpoint:
    if not path.exists():
        return BuildCheckpoint(Accumulators.create())
    with np.load(path, allow_pickle=False) as saved:
        expected = (1, dates[0].isoformat(), dates[-1].isoformat(), len(dates))
        actual = (int(saved["version"][0]), str(saved["start_date"].item()),
                  str(saved["end_date"].item()), int(saved["day_count"][0]))
        if actual != expected:
            raise ValueError(f"Checkpoint period/version does not match requested build: {actual}")
        completed = int(saved["completed"][0])
        if not 0 <= completed <= len(dates):
            raise ValueError("Checkpoint has an invalid completed-day count")
        arrays = [saved[name].copy() for name in ACCUMULATOR_ARRAYS]
        preceding = saved["preceding_water_mask"].astype(bool, copy=True)
        return BuildCheckpoint(
            accum=Accumulators(*arrays), completed=completed,
            total_bytes=int(saved["total_bytes"][0]), network_retries=int(saved["network_retries"][0]),
            invalid_netcdf_retries=int(saved["invalid_netcdf_retries"][0]),
            preceding_water_mask=preceding,
        )


def aggregate_source_grid(category: np.ndarray, valid_ocean: np.ndarray) -> np.ndarray:
    if category.shape != SOURCE_SHAPE or valid_ocean.shape != SOURCE_SHAPE:
        raise ValueError("Source grids must be 3600 x 7200")
    return aggregate_blocks(category, valid_ocean, AGGREGATION)


def aggregate_blocks(category: np.ndarray, valid_ocean: np.ndarray, block_size: int) -> np.ndarray:
    if block_size < 1 or category.ndim != 2 or category.shape != valid_ocean.shape:
        raise ValueError("category and valid_ocean must be same-size 2D arrays and block_size positive")
    if category.shape[0] % block_size or category.shape[1] % block_size:
        raise ValueError("source dimensions must be divisible by block_size")
    out_h, out_w = category.shape[0] // block_size, category.shape[1] // block_size
    cats = category.reshape(out_h, block_size, out_w, block_size)
    valid = valid_ocean.reshape(out_h, block_size, out_w, block_size)
    block = np.where(valid, cats, 0).max(axis=(1, 3)).astype(np.uint8)
    block[~valid.any(axis=(1, 3))] = MISSING
    return block


def source_categories_to_display(category: np.ndarray, valid_ocean: np.ndarray) -> np.ndarray:
    """Small-grid-friendly equivalent used by offline tests."""
    if category.shape != valid_ocean.shape:
        raise ValueError("category and valid_ocean must share dimensions")
    return np.where(valid_ocean, category, MISSING).astype(np.uint8)


def _download_one(item: tuple[int, date, Path], timeout: int) -> tuple[int, date, Path, int, int]:
    index, day, destination = item
    request = urllib.request.Request(daily_url(day), headers={"User-Agent": "DiveAtlas offline builder"})
    retries = 0
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response, destination.open("wb") as output:
                shutil.copyfileobj(response, output)
            return index, day, destination, destination.stat().st_size, retries
        except urllib.error.HTTPError as error:
            if error.code not in (408, 429, 500, 502, 503, 504) or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
        destination.unlink(missing_ok=True)
        retries += 1
        time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"Download retry loop ended unexpectedly for {day}")


def download_process(dates: list[date], output: Path, *, workers: int = 8,
                     progress_every: int = 100, checkpoint_path: Path | None = None
                     ) -> tuple[Accumulators, int, int, int, int]:
    if workers < 1 or workers > 16:
        raise ValueError("workers must be between 1 and 16")
    output.mkdir(parents=True, exist_ok=True)
    checkpoint = load_checkpoint(checkpoint_path, dates) if checkpoint_path else BuildCheckpoint(Accumulators.create())
    if checkpoint.completed:
        print(f"resuming from local accumulator checkpoint at {checkpoint.completed}/{len(dates)} days", flush=True)
    # At most `workers` source files are on disk; each is removed immediately
    # after incorporation. Checkpoints retain only summary arrays, never daily source files.
    with tempfile.TemporaryDirectory(prefix="mhw-daily-", dir=output) as temp:
        temp_root = Path(temp)
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            pending = {}
            next_submit = checkpoint.completed
            while next_submit < min(checkpoint.completed + workers, len(dates)):
                day = dates[next_submit]
                future = pool.submit(_download_one, (next_submit, day, temp_root / f"{day:%Y%m%d}.nc"), 90)
                pending[next_submit] = future
                next_submit += 1
            for expected_index in range(checkpoint.completed, len(dates)):
                future = pending.pop(expected_index)
                _, day, file_path, source_bytes, request_retries = future.result()
                parsed, retry_bytes, retry_network_retries = read_daily_with_one_retry(
                    file_path, day, checkpoint.preceding_water_mask,
                    redownload=lambda: _download_one((expected_index, day, file_path), 90)[3:5],
                )
                category, valid, water_mask, _, _ = parsed
                checkpoint.accum.update(aggregate_source_grid(category, valid), expected_index)
                checkpoint.preceding_water_mask = water_mask
                file_path.unlink()
                checkpoint.total_bytes += source_bytes + retry_bytes
                checkpoint.network_retries += request_retries + retry_network_retries
                checkpoint.invalid_netcdf_retries += int(retry_bytes > 0)
                checkpoint.completed += 1
                if next_submit < len(dates):
                    next_day = dates[next_submit]
                    pending[next_submit] = pool.submit(
                        _download_one, (next_submit, next_day, temp_root / f"{next_day:%Y%m%d}.nc"), 90,
                    )
                    next_submit += 1
                if checkpoint_path and (checkpoint.completed % CHECKPOINT_INTERVAL == 0 or checkpoint.completed == len(dates)):
                    save_checkpoint(checkpoint_path, dates, checkpoint)
                if progress_every and checkpoint.completed % progress_every == 0:
                    print(f"processed {checkpoint.completed}/{len(dates)} daily files through {day.isoformat()}", flush=True)
    return (checkpoint.accum, checkpoint.total_bytes, checkpoint.completed,
            checkpoint.network_retries, checkpoint.invalid_netcdf_retries)


def _write_tiles(values: np.ndarray, output: Path, palette: np.ndarray, *, quantile_breaks: list[int] | None = None) -> tuple[int, int]:
    height, width = values.shape
    count = size = 0
    for zoom in range(6):
        world = 256 * (1 << zoom)
        px = np.arange(world, dtype=np.float64) + 0.5
        py = np.arange(world, dtype=np.float64) + 0.5
        lon = -180 + px / world * 360
        lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * py / world))))
        cols = np.clip(np.floor((lon + 179.875) / CELL_DEGREES).astype(int), 0, width - 1)
        rows = np.clip(np.floor((lat + 89.875) / CELL_DEGREES).astype(int), 0, height - 1)
        side = 1 << zoom
        for y in range(side):
            row_slice = slice(y * 256, (y + 1) * 256)
            src_rows = rows[row_slice]
            row_valid = (lat[row_slice] >= -85.05113) & (lat[row_slice] <= 85.05113)
            for x in range(side):
                col_slice = slice(x * 256, (x + 1) * 256)
                cell_values = values[np.ix_(src_rows, cols[col_slice])].copy()
                cell_values[~row_valid, :] = MISSING
                rgba = np.zeros((256, 256, 4), dtype=np.uint8)
                if quantile_breaks is None:
                    valid = cell_values <= 5
                    rgba[valid] = palette[cell_values[valid]]
                else:
                    valid = cell_values != MISSING
                    bins = np.ones(cell_values.shape, dtype=np.uint8)
                    for threshold in quantile_breaks:
                        bins += (cell_values > threshold).astype(np.uint8)
                    bins[cell_values == 0] = 0
                    rgba[valid] = palette[np.minimum(bins[valid], len(palette) - 1)]
                path = output / str(zoom) / str(x) / f"{y}.png"
                path.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(rgba, "RGBA").save(path, optimize=True)
                count += 1
                size += path.stat().st_size
    return count, size


def _write_query_chunks(query: np.ndarray, output: Path) -> tuple[int, int]:
    count = size = 0
    for row in range(math.ceil(query.shape[0] / QUERY_SIZE)):
        for col in range(math.ceil(query.shape[1] / QUERY_SIZE)):
            block = np.zeros((QUERY_SIZE, QUERY_SIZE), dtype=QUERY_DTYPE)
            block["worst"] = MISSING
            block["worst_day"] = MISSING
            y, x = row * QUERY_SIZE, col * QUERY_SIZE
            view = query[y:min(y + QUERY_SIZE, query.shape[0]), x:min(x + QUERY_SIZE, query.shape[1])]
            block[:view.shape[0], :view.shape[1]] = view
            payload = gzip.compress(QUERY_HEADER.pack(b"MHW1", col, row) + block.tobytes(), compresslevel=8, mtime=0)
            path = output / f"{col}_{row}.bin.gz"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
            count += 1
            size += len(payload)
    return count, size


def write_metadata_with_exact_sizes(path: Path, metadata: dict) -> None:
    assets = metadata["assets"]
    for _ in range(5):
        path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        actual_metadata_bytes = path.stat().st_size
        actual_total_bytes = assets["mapTileBytes"] + assets["queryBytes"] + actual_metadata_bytes
        if assets["metadataBytes"] == actual_metadata_bytes and assets["totalBytes"] == actual_total_bytes:
            return
        assets["metadataBytes"] = actual_metadata_bytes
        assets["totalBytes"] = actual_total_bytes
    raise RuntimeError("Could not stabilize derived metadata byte totals")


def distributions(accum: Accumulators) -> dict:
    valid = accum.valid_days > 0
    count = int(valid.sum())
    categories = accum.worst[valid]
    category_distribution = {
        str(category): {"cells": int(np.count_nonzero(categories == category)),
                        "percent": round(float(np.count_nonzero(categories == category) / count * 100), 3)}
        for category in range(6)
    }
    def describe(array: np.ndarray) -> dict:
        data = array[valid].astype(np.float64)
        return {"min": int(data.min()), "p50": float(np.percentile(data, 50)),
                "p75": float(np.percentile(data, 75)), "p90": float(np.percentile(data, 90)),
                "p95": float(np.percentile(data, 95)), "p99": float(np.percentile(data, 99)),
                "max": int(data.max()), "zeroPercent": round(float(np.mean(data == 0) * 100), 3)}
    severe_positive = accum.severe_days[valid & (accum.severe_days > 0)]
    breaks = sorted({int(round(float(np.percentile(severe_positive, q)))) for q in (20, 40, 60, 80)}) if severe_positive.size else []
    return {"validCellCount": count, "worstCategory": category_distribution,
            "totalMhwDays": describe(accum.mhw_days), "severeOrWorseDays": describe(accum.severe_days),
            "longestMhwRunDays": describe(accum.longest_run), "persistencePositiveQuantileBreaks": breaks,
            "positivePersistenceCellCount": int(severe_positive.size)}


def build_outputs(accum: Accumulators, dates: list[date], output: Path, *, source_bytes: int,
                  file_count: int, duration_seconds: float, invalid_netcdf_retries: int = 0,
                  network_retries: int = 0) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    query = accum.query_grid()
    dist = distributions(accum)
    date_strings = [day.isoformat() for day in dates]
    worst_day = query["worst_day"]
    dated_categories = np.where((query["worst"] <= 5) & (worst_day != MISSING), query["worst"], MISSING)
    persistence = query["severe_days"].copy()
    persistence[query["valid_days"] == 0] = MISSING
    a_tiles, a_size = _write_tiles(dated_categories, output / "candidate-a" / "tiles", OCEAN_COLORS)
    b_tiles, b_size = _write_tiles(persistence, output / "candidate-b" / "tiles", PERSISTENCE_COLORS,
                                   quantile_breaks=dist["persistencePositiveQuantileBreaks"])
    q_count, q_size = _write_query_chunks(query, output / "query")
    meta = {
        "prototype": True, "provider": "NOAA Coral Reef Watch",
        "product": "Daily Global 5km Satellite Marine Heatwave Watch", "productVersion": "1.0.1",
        "sourceVariable": "heatwave_category", "sourcePeriod": {"start": dates[0].isoformat(), "end": dates[-1].isoformat(),
                         "startYear": dates[0].year, "endYear": dates[-1].year, "completeYears": dates[-1].year - dates[0].year + 1},
        "sourceGrid": {"width": 7200, "height": 3600, "stepDegrees": 0.05},
        "displayGrid": {"width": GRID_SHAPE[1], "height": GRID_SHAPE[0], "stepDegrees": CELL_DEGREES,
                        "aggregation": "maximum of valid 5x5 NOAA categories; missing blocks remain transparent"},
        "temporalSpatialSemantics": "Daily display-cell category is the maximum valid 5km source category in the 5x5 block; day counts and episode lengths therefore mean at least one valid source pixel in the approx. 25km block met the category threshold that day.",
        "categories": list(CATEGORY_LABELS),
        "categoryDefinitions": category_definitions(),
        "dayDefinitions": {"mhwDay": "category 1-5", "strongOrWorse": "category 2-5", "severeOrWorse": "category 3-5",
                           "extremeOrWorse": "category 4-5", "noMhw": "category 0", "missing": "not counted; breaks consecutive runs",
                           "landIceMask": "only mask=0 category values are eligible; legacy and current mask codes differ",
                           "leapDayMask": "Feb 29 water pixels are additionally intersected with Feb 28 mask because archived Feb 29 files flag land as water"},
        "worstCategoryTieRule": "latest date wins", "distribution": dist,
        "candidateA": {"label": "Worst MHW category in recent period", "purpose": "How bad did ocean heat get?",
                       "tileTemplate": "candidate-a/tiles/{z}/{x}/{y}.png", "tileMaxZoom": 5, "tileCount": a_tiles, "tileBytes": a_size},
        "candidateB": {"label": "Severe-or-worse MHW days", "purpose": "How persistent was serious ocean heat?",
                       "tileTemplate": "candidate-b/tiles/{z}/{x}/{y}.png", "tileMaxZoom": 5, "tileCount": b_tiles, "tileBytes": b_size,
                       "legendBreaks": dist["persistencePositiveQuantileBreaks"],
                       "legendNote": "Positive-value color breaks are quantiles of this source period, not NOAA MHW categories."},
        "query": {"template": "query/{column}_{row}.bin.gz", "header": f"MHW1 + uint16 tile column/row + packed {QUERY_DTYPE.itemsize}-byte records",
                  "recordFields": list(QUERY_DTYPE.names), "tileSize": QUERY_SIZE, "chunkCount": q_count, "bytes": q_size},
        "sourceProcessing": {"dailyFilesProcessed": file_count, "temporarySourceBytesProcessed": source_bytes,
                  "peakTemporarySourceFiles": min(8, file_count),
                  "invalidNetcdfRetries": invalid_netcdf_retries,
                  "transientNetworkRetries": network_retries,
                  "processingSeconds": round(duration_seconds, 2),
                             "storagePolicy": "daily files deleted after ordered incorporation; no source NetCDF in derived output"},
        "generatedAt": datetime.now(timezone.utc).isoformat(), "attribution": "NOAA Coral Reef Watch",
        "sourceUrl": "https://www.coralreefwatch.noaa.gov/product/marine_heatwave/",
        "semantics": "Broad marine heat environment; not coral bleaching, reef damage, or direct reef condition.",
    }
    meta["assets"] = {"mapTileBytes": a_size + b_size, "queryBytes": q_size,
                      "metadataBytes": 0, "totalBytes": a_size + b_size + q_size}
    write_metadata_with_exact_sizes(output / "metadata.json", meta)
    return meta


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/.build/reef_condition/ocean-heat-history-prototype"))
    parser.add_argument("--end-year", type=int, help="Override only for reproducible local analysis; default discovers latest complete source year")
    parser.add_argument("--years", type=int, default=10)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--sample-source", type=Path, help="Build a one-day small fixture/prototype, not a decade summary")
    args = parser.parse_args()
    import time
    dates = recent_complete_period(args.end_year, args.years)
    start = time.monotonic()
    invalid_retries = 0
    network_retries = 0
    checkpoint_path = args.output / f"_checkpoint_{dates[0]:%Y%m%d}_{dates[-1]:%Y%m%d}.npz"
    if args.sample_source:
        sample_date = date.fromisoformat(args.sample_source.stem[-8:][:4] + "-" + args.sample_source.stem[-4:-2] + "-" + args.sample_source.stem[-2:])
        category, valid, _, _, _ = read_daily(args.sample_source, sample_date)
        accum = Accumulators.create()
        accum.update(aggregate_source_grid(category, valid), 0)
        source_bytes, file_count = args.sample_source.stat().st_size, 1
        dates = [sample_date]
    else:
        accum, source_bytes, file_count, network_retries, invalid_retries = download_process(
            dates, args.output / "_tmp", workers=args.workers, checkpoint_path=checkpoint_path,
        )
    duration = time.monotonic() - start
    derived_start = time.monotonic()
    metadata = build_outputs(accum, dates, args.output, source_bytes=source_bytes, file_count=file_count,
                             duration_seconds=duration, invalid_netcdf_retries=invalid_retries,
                             network_retries=network_retries)
    derived_duration = time.monotonic() - derived_start
    metadata["sourceProcessing"]["derivedAssetGenerationSeconds"] = round(derived_duration, 2)
    metadata["sourceProcessing"]["totalBuildSeconds"] = round(duration + derived_duration, 2)
    write_metadata_with_exact_sizes(args.output / "metadata.json", metadata)
    if not args.sample_source:
        checkpoint_path.unlink(missing_ok=True)
    print(json.dumps({"output": str(args.output), "period": metadata["sourcePeriod"], "sourceProcessing": metadata["sourceProcessing"],
                      "distribution": metadata["distribution"], "assets": metadata["assets"]}, indent=2))


if __name__ == "__main__":
    main()
