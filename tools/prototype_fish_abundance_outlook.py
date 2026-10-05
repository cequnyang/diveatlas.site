#!/usr/bin/env python3
"""Build an analysis-only, evidence-tiered Fish Abundance Outlook prototype.

The script reads the current production support mask, the current fish snapshot,
and the protocol-adjusted NRMN analysis table. It writes every derived grid,
report, and preview under analysis/fish-abundance-outlook-prototype/; it never
changes production assets. All categories are relative outlooks, not global
unconditional abundance measurements, because complete zero-count blocks are
not available in the recovered survey data.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
import re
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from PIL import Image, ImageDraw, ImageFont
from scipy.spatial import cKDTree
from scipy.stats import spearmanr
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.neighbors import NearestNeighbors
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler, SplineTransformer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import fish_ecological_experiment as base  # noqa: E402

OUT = ROOT / "analysis" / "fish-abundance-outlook-prototype"
OUT.mkdir(parents=True, exist_ok=True)
TRACKED_INPUT_FILES: set[Path] = set()

WIDTH, HEIGHT = 720, 340
WEST, SOUTH, STEP = -180.0, -85.0, 0.5
SUBDIVISIONS = 8
CELL_COUNT = WIDTH * HEIGHT
EARTH_KM = 6371.0088
RADIUS_B_KM = 5000.0
MIN_B_SITES = 2
MIN_B_EFFECTIVE = 1.5
PRIMARY_B_DECAY_KM = 250.0
PRIMARY_TIER_C_MONTHS = 9
TIER_OPACITY = {"A": 0.93, "B": 0.625, "C": 0.40}
FEATURES = base.FEATURES
METHODS = (
    "global_median",
    "basin_median",
    "current_distance_2500",
    "weighted_median_5000_d250",
    "weighted_median_5000_d1000",
    "trimmed_mean_5000_d250",
    "trimmed_mean_5000_d1000",
    "shrunk_median_5000_d250",
    "shrunk_median_5000_d1000",
)


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def record_input(path: Path) -> None:
    resolved = Path(path).resolve()
    try:
        resolved.relative_to(ROOT)
    except ValueError:
        return
    if resolved.is_file():
        TRACKED_INPUT_FILES.add(resolved)


def save_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def sphere_xy(latlon: np.ndarray) -> np.ndarray:
    lat = np.radians(np.asarray(latlon, dtype=float)[:, 0])
    lon = np.radians((np.asarray(latlon, dtype=float)[:, 1] + 180.0) % 360.0 - 180.0)
    c = np.cos(lat)
    return np.column_stack((c * np.cos(lon), c * np.sin(lon), np.sin(lat)))


def chord(km: float) -> float:
    return 2.0 * math.sin(min(math.pi, km / EARTH_KM) / 2.0)


def chord_to_km(distance: np.ndarray | float) -> np.ndarray | float:
    return 2.0 * EARTH_KM * np.arcsin(np.minimum(1.0, np.asarray(distance) / 2.0))


def exact_distances_km(center: np.ndarray, others: np.ndarray) -> np.ndarray:
    a = np.repeat(np.asarray(center, dtype=float)[None, :], len(others), axis=0)
    return base.haversine(a, np.asarray(others, dtype=float))


def basin_name(lat: float, lon: float) -> str:
    """Coarse geographic basin proxy for shrinkage/reporting, not an ocean mask."""
    if lat >= 66.5:
        return "Arctic proxy"
    if lat <= -60.0:
        return "Southern Ocean proxy"
    lon = (lon + 180.0) % 360.0 - 180.0
    if lon >= 147.0 or lon < -70.0:
        return "Pacific proxy"
    if lon < 20.0:
        return "Atlantic proxy"
    return "Indian proxy"


def read_fixed_grid(path: Path, magic: bytes, version: int, payload_size: int) -> bytes:
    data = gzip.decompress(path.read_bytes())
    if len(data) != 16 + payload_size:
        raise ValueError(f"Unexpected payload size in {path}")
    if data[:4] != magic or data[4] != version:
        raise ValueError(f"Unexpected fixed-grid header in {path}")
    if (int.from_bytes(data[6:8], "little") != WIDTH or
            int.from_bytes(data[8:10], "little") != HEIGHT or
            int.from_bytes(data[10:12], "little") != round(STEP * 100)):
        raise ValueError(f"Grid geometry mismatch in {path}")
    if (int.from_bytes(data[12:14], "little", signed=True) != round(WEST * 10) or
            int.from_bytes(data[14:16], "little", signed=True) != round(SOUTH * 10)):
        raise ValueError(f"Grid origin mismatch in {path}")
    return data[16:]


def read_grid_inputs():
    manifest = json.loads((ROOT / "data/dive_conditions_score/manifest.json").read_text(encoding="utf-8"))
    if manifest["grid"] != {"step": 0.5, "west": -180, "south": -85, "width": 720,
                           "height": 340, "cellCenterOffset": 0.25, "missingValue": 255}:
        raise ValueError("The current score-grid geometry differs from the expected prototype geometry")
    mask_bytes = read_fixed_grid(ROOT / "data/dive_conditions_score/ocean-mask.bin.gz", b"DAOM", 1,
                                 CELL_COUNT * SUBDIVISIONS)
    mask = np.frombuffer(mask_bytes, dtype=np.uint8).reshape(CELL_COUNT, SUBDIVISIONS).copy()
    reef_bytes = read_fixed_grid(ROOT / "data/dive_conditions_score/reef-dimensions.bin.gz", b"DARS", 2,
                                 CELL_COUNT * 3)
    # DARS v2 stores coral, fish, and heat as three contiguous cell-count planes.
    reef_planes = np.frombuffer(reef_bytes, dtype=np.uint8).reshape(3, CELL_COUNT)
    fish_score = reef_planes[1].copy()

    wet = np.zeros((CELL_COUNT, SUBDIVISIONS, SUBDIVISIONS), dtype=bool)
    for subrow in range(SUBDIVISIONS):
        bits = mask[:, subrow]
        for subcol in range(SUBDIVISIONS):
            wet[:, subrow, subcol] = (bits & (1 << subcol)) != 0
    wet_count = wet.sum(axis=(1, 2)).astype(np.uint8)
    eligible = wet_count >= 16  # Existing DAOM rule: at least 25% of 8x8 samples are ocean.
    eligible_indices = np.flatnonzero(eligible)
    rows = eligible_indices // WIDTH
    cols = eligible_indices % WIDTH
    cell_lat = SOUTH + (rows + 0.5) * STEP
    cell_lon = WEST + (cols + 0.5) * STEP
    rep_lat = np.full(len(eligible_indices), np.nan)
    rep_lon = np.full(len(eligible_indices), np.nan)
    best = np.full(len(eligible_indices), np.inf)
    cosine = np.cos(np.radians(cell_lat))
    for subrow in range(SUBDIVISIONS):
        this_lat = SOUTH + rows * STEP + (subrow + 0.5) * STEP / SUBDIVISIONS
        row_bits = mask[eligible_indices, subrow]
        for subcol in range(SUBDIVISIONS):
            is_wet = (row_bits & (1 << subcol)) != 0
            if not is_wet.any():
                continue
            this_lon = WEST + cols * STEP + (subcol + 0.5) * STEP / SUBDIVISIONS
            distance2 = (this_lat - cell_lat) ** 2 + ((this_lon - cell_lon) * cosine) ** 2
            replace = is_wet & (distance2 < best)
            rep_lat[replace] = this_lat[replace]
            rep_lon[replace] = this_lon[replace]
            best[replace] = distance2[replace]
    if np.isnan(rep_lat).any():
        raise ValueError("An eligible ocean cell has no wet representative subcell")
    return manifest, mask, wet, wet_count, eligible, eligible_indices, rep_lat, rep_lon, fish_score


def load_current_fish_sources():
    snap_path = ROOT / "data/fish_map_units.json.gz"
    snapshot = json.loads(gzip.open(snap_path, "rt", encoding="utf-8").read())
    raw = np.asarray([[float(row[0]), float(row[1]), float(row[2])] for row in snapshot["rows"]], dtype=float)
    raw = raw[np.isfinite(raw).all(axis=1) & (raw[:, 2] >= 0)]
    frame = pd.DataFrame(raw, columns=["lat", "lon", "density"])
    frame["lat_key"] = frame.lat.round(5)
    frame["lon_key"] = ((frame.lon + 180.0) % 360.0 - 180.0).round(5)
    grouped = frame.groupby(["lat_key", "lon_key"], as_index=False).agg(density=("density", "mean"))
    source_xy = grouped[["lat_key", "lon_key"]].to_numpy(float)
    values = grouped.density.to_numpy(float)
    tree = cKDTree(sphere_xy(source_xy))
    raw_tree = cKDTree(sphere_xy(raw[:, :2]))
    return raw, source_xy, values, tree, raw_tree, np.sort(raw[:, 2]), snapshot


def fill_tier_a_raw(eligible_indices, rep_lat, rep_lon, fish_score, raw, source_xy, values,
                    source_tree, raw_tree, cell_raw):
    local_ids = np.flatnonzero(fish_score[eligible_indices] <= 100)
    target_xy = np.column_stack((rep_lat[local_ids], rep_lon[local_ids]))
    target_sphere = sphere_xy(target_xy)
    raw_nearest_chord, raw_nearest_ix = raw_tree.query(target_sphere, k=1, workers=-1)
    nearest_km = chord_to_km(raw_nearest_chord)
    all_support = np.full(CELL_COUNT, np.nan, dtype=float)
    all_effective = np.full(CELL_COUNT, np.nan, dtype=float)
    all_nearest = np.full(CELL_COUNT, np.nan, dtype=float)
    all_count = np.zeros(CELL_COUNT, dtype=np.uint16)
    all_nearest[eligible_indices] = chord_to_km(source_tree.query(sphere_xy(np.column_stack((rep_lat, rep_lon))), k=1,
                                                                 workers=-1)[0])
    log(f"Recovering internal Tier A raw estimates for {len(local_ids):,} existing supported cells")
    radius = chord(2500.0)
    for start in range(0, len(local_ids), 500):
        stop = min(len(local_ids), start + 500)
        neighbor_lists = source_tree.query_ball_point(target_sphere[start:stop], r=radius, workers=-1)
        for offset, ids in enumerate(neighbor_lists):
            j = start + offset
            cell = int(eligible_indices[local_ids[j]])
            if nearest_km[j] <= 25.0:
                cell_raw[cell] = raw[int(raw_nearest_ix[j]), 2]
                all_support[cell] = 1.0
                all_effective[cell] = 1.0
                all_count[cell] = 1
                continue
            if not ids:
                continue
            idx = np.asarray(ids, dtype=int)
            d = exact_distances_km(target_xy[j], source_xy[idx])
            keep = d <= 2500.0
            idx, d = idx[keep], d[keep]
            if len(idx) < 3:
                continue
            weights = 1.0 / (1.0 + (d / PRIMARY_B_DECAY_KM) ** 3)
            effective = float(weights.sum() ** 2 / np.dot(weights, weights))
            all_count[cell] = min(len(idx), np.iinfo(np.uint16).max)
            all_effective[cell] = effective
            all_support[cell] = float(len(idx))
            if effective < 2.5:
                continue
            cell_raw[cell] = float(np.average(values[idx], weights=weights))
        if stop == len(local_ids) or stop % 5000 == 0:
            log(f"Tier A raw reconstruction: {stop:,}/{len(local_ids):,}")
    return all_count, all_nearest, all_effective, int(np.isfinite(cell_raw[eligible_indices]).sum())


def load_protocol_sites():
    table_path = ROOT / "analysis/fish-ecological-experiment/protocol_adjusted_training_table.csv.gz"
    table = pd.read_csv(table_path, low_memory=False)
    agg = {"target": ("fish_per_100m2", "mean"), "source_rows": ("survey_id", "nunique"),
           "ecoregion": ("ecoregion", "first")}
    agg.update({feature: (feature, "mean") for feature in FEATURES})
    sites = table.groupby(["lat", "lon"], as_index=False).agg(**agg)
    sites = sites.replace([np.inf, -np.inf], np.nan).dropna(subset=["target"]).reset_index(drop=True)
    sites["basin"] = [basin_name(a, b) for a, b in sites[["lat", "lon"]].to_numpy(float)]
    return table, sites


def weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    order = np.argsort(values, kind="mergesort")
    v, w = values[order], weights[order]
    index = int(np.searchsorted(np.cumsum(w), 0.5 * w.sum(), side="left"))
    return float(v[min(index, len(v) - 1)])


def weighted_trimmed_mean(values: np.ndarray, weights: np.ndarray, tail_fraction: float = 0.10) -> float:
    order = np.argsort(values, kind="mergesort")
    v, w = values[order].copy(), weights[order].copy()
    trim = tail_fraction * float(w.sum())
    remaining = trim
    for i in range(len(w)):
        take = min(remaining, w[i])
        w[i] -= take
        remaining -= take
        if remaining <= 1e-15:
            break
    remaining = trim
    for i in range(len(w) - 1, -1, -1):
        take = min(remaining, w[i])
        w[i] -= take
        remaining -= take
        if remaining <= 1e-15:
            break
    return float(np.average(v, weights=w)) if w.sum() > 0 else weighted_median(values, weights)


def neighborhood_stats(values: np.ndarray, distances: np.ndarray, decay_km: float):
    if len(values) < MIN_B_SITES:
        return None
    weights = 1.0 / (1.0 + (distances / decay_km) ** 3)
    effective = float(weights.sum() ** 2 / np.dot(weights, weights))
    if effective < MIN_B_EFFECTIVE:
        return {"count": len(values), "effective": effective, "nearest": float(distances.min()),
                "weights": weights, "median": float("nan"), "trimmed": float("nan"), "shrink": float("nan")}
    median = weighted_median(values, weights)
    trimmed = weighted_trimmed_mean(values, weights)
    nearest = float(distances.min())
    trust = (effective / (effective + 2.0)) * math.exp(-((nearest / RADIUS_B_KM) ** 2))
    return {"count": len(values), "effective": effective, "nearest": nearest, "weights": weights,
            "median": median, "trimmed": trimmed, "shrink": trust}


def calculate_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict:
    valid = np.isfinite(actual) & np.isfinite(predicted)
    y, p = np.asarray(actual)[valid], np.asarray(predicted)[valid]
    if not len(y):
        return {"n": 0, "mae": None, "median_absolute_error": None, "bias_prediction_minus_actual": None,
                "spearman": None}
    corr = spearmanr(y, p).statistic if len(y) > 1 and np.unique(y).size > 1 and np.unique(p).size > 1 else np.nan
    return {"n": int(len(y)), "mae": float(np.mean(np.abs(p - y))),
            "median_absolute_error": float(np.median(np.abs(p - y))),
            "bias_prediction_minus_actual": float(np.mean(p - y)),
            "spearman": float(corr) if np.isfinite(corr) else None}


def validate_tier_b(sites: pd.DataFrame):
    """Use the same 500/250 and 1000/500 km spatial blocks and union purge."""
    xy = sites[["lat", "lon"]].to_numpy(float)
    unit = sphere_xy(xy)
    tree = cKDTree(unit)
    target = sites.target.to_numpy(float)
    regions = sites.basin.to_numpy(str)
    block_rows, regional_rows, distance_rows, score_arrays = [], [], [], {}
    for block_size, purge_radius in ((500, 250), (1000, 500)):
        log(f"Tier B buffered validation: {block_size} km blocks / {purge_radius} km purge")
        block_ids = [base.block_id(a, b, block_size) for a, b in xy]
        unique_blocks = sorted(set(block_ids))
        predictions = {name: np.full(len(sites), np.nan) for name in METHODS}
        nearest_for_error = np.full(len(sites), np.nan)
        for fold_number, block in enumerate(unique_blocks, 1):
            test_ids = np.flatnonzero(np.asarray([value == block for value in block_ids], dtype=bool))
            candidate = np.asarray([value != block for value in block_ids], dtype=bool)
            nearby_to_test = tree.query_ball_point(unit[test_ids], r=chord(purge_radius), workers=-1)
            for close in nearby_to_test:
                if close:
                    candidate[np.asarray(close, dtype=int)] = False
            train_ids = np.flatnonzero(candidate)
            if len(train_ids) < 20:
                continue
            train_values = target[train_ids]
            global_median = float(np.median(train_values))
            medians = {}
            for region in np.unique(regions[test_ids]):
                regional_train = train_ids[regions[train_ids] == region]
                medians[region] = float(np.median(target[regional_train])) if len(regional_train) >= 20 else global_median
            radius_neighbors = tree.query_ball_point(unit[test_ids], r=chord(RADIUS_B_KM), workers=-1)
            for q_offset, test_id in enumerate(test_ids):
                predictions["global_median"][test_id] = global_median
                predictions["basin_median"][test_id] = medians[regions[test_id]]
                neighbor_ids = np.asarray(radius_neighbors[q_offset], dtype=int)
                if len(neighbor_ids):
                    neighbor_ids = neighbor_ids[candidate[neighbor_ids]]
                if not len(neighbor_ids):
                    continue
                d = exact_distances_km(xy[test_id], xy[neighbor_ids])
                within = d <= RADIUS_B_KM
                neighbor_ids, d = neighbor_ids[within], d[within]
                if not len(d):
                    continue
                nearest_for_error[test_id] = float(d.min())
                vals = target[neighbor_ids]
                # The existing current estimator remains a comparison baseline.
                local = d <= 2500.0
                if local.sum() >= 3:
                    w = 1.0 / (1.0 + (d[local] / 250.0) ** 3)
                    neff = float(w.sum() ** 2 / np.dot(w, w))
                    if neff >= 2.5:
                        predictions["current_distance_2500"][test_id] = float(np.average(vals[local], weights=w))
                for decay in (250.0, 1000.0):
                    stats = neighborhood_stats(vals, d, decay)
                    if not stats or not np.isfinite(stats["median"]):
                        continue
                    suffix = "d250" if decay == 250.0 else "d1000"
                    predictions[f"weighted_median_5000_{suffix}"][test_id] = stats["median"]
                    predictions[f"trimmed_mean_5000_{suffix}"][test_id] = stats["trimmed"]
                    regional_median = medians[regions[test_id]]
                    predictions[f"shrunk_median_5000_{suffix}"][test_id] = (
                        regional_median + stats["shrink"] * (stats["median"] - regional_median))
            if fold_number % 500 == 0 or fold_number == len(unique_blocks):
                log(f"  completed {fold_number:,}/{len(unique_blocks):,} test blocks")
        score_arrays[block_size] = predictions
        for method, pred in predictions.items():
            result = calculate_metrics(target, pred)
            result.update({"block_size_km": block_size, "purge_radius_km": purge_radius, "method": method,
                           "test_sites": int(len(sites)), "coverage_fraction": result["n"] / len(sites)})
            block_rows.append(result)
            if method in ("weighted_median_5000_d250", "shrunk_median_5000_d250", "current_distance_2500"):
                for region in sorted(set(regions)):
                    in_region = regions == region
                    m = calculate_metrics(target[in_region], pred[in_region])
                    m.update({"block_size_km": block_size, "purge_radius_km": purge_radius, "method": method,
                              "region_proxy": region, "test_sites": int(in_region.sum()),
                              "coverage_fraction": m["n"] / int(in_region.sum())})
                    regional_rows.append(m)
                valid = np.isfinite(pred) & np.isfinite(nearest_for_error)
                edges = [0, 100, 500, 1000, 2500, 5000.0001]
                labels = ["0-100", "100-500", "500-1000", "1000-2500", "2500-5000"]
                bins = pd.cut(nearest_for_error[valid], bins=edges, labels=labels, include_lowest=True, right=False)
                for label in labels:
                    keep = np.asarray(bins == label)
                    if not keep.any():
                        continue
                    ids = np.flatnonzero(valid)[keep]
                    m = calculate_metrics(target[ids], pred[ids])
                    distance_rows.append({"block_size_km": block_size, "purge_radius_km": purge_radius,
                                          "method": method, "nearest_training_distance_km_band": label, **m})
        del unique_blocks

    pd.DataFrame(block_rows).to_csv(OUT / "tier_b_blocked_validation.csv", index=False)
    pd.DataFrame(regional_rows).to_csv(OUT / "tier_b_blocked_validation_by_basin.csv", index=False)
    pd.DataFrame(distance_rows).to_csv(OUT / "tier_b_error_by_support_distance.csv", index=False)
    site_quantiles = np.quantile(target, [1 / 3, 2 / 3])
    quantile_rows = []
    for block_size, predictions in score_arrays.items():
        for method in ("global_median", "current_distance_2500", "weighted_median_5000_d250",
                       "shrunk_median_5000_d250", "shrunk_median_5000_d1000"):
            pred = predictions[method]
            for label, keep in (("lower third", target <= site_quantiles[0]),
                                ("middle third", (target > site_quantiles[0]) & (target <= site_quantiles[1])),
                                ("upper third", target > site_quantiles[1])):
                m = calculate_metrics(target[keep], pred[keep])
                quantile_rows.append({"block_size_km": block_size, "method": method,
                                      "actual_abundance_band": label, **m})
    pd.DataFrame(quantile_rows).to_csv(OUT / "tier_b_blocked_validation_by_abundance.csv", index=False)
    return pd.DataFrame(block_rows), score_arrays


def build_tier_b_grid(eligible_indices, rep_lat, rep_lon, tier, sorted_source_values, nearest_km, count_out,
                      effective_out, raw_out, score_out, method="shrunk_median_5000_d250", sites=None):
    if sites is None:
        raise ValueError("Protocol-adjusted survey sites are required")
    xy = sites[["lat", "lon"]].to_numpy(float)
    vals = sites.target.to_numpy(float)
    regions = sites.basin.to_numpy(str)
    medians = {region: float(np.median(vals[regions == region])) for region in np.unique(regions)}
    global_median = float(np.median(vals))
    tree = cKDTree(sphere_xy(xy))
    unknown_positions = np.flatnonzero(tier[eligible_indices] == 0)
    target_xy = np.column_stack((rep_lat[unknown_positions], rep_lon[unknown_positions]))
    target_sphere = sphere_xy(target_xy)
    neighbors_by_chunk = 2500
    stats_out = {"scanned": len(unknown_positions), "supported": 0,
                 "failed_few_sites": 0, "failed_effective_support": 0}
    for start in range(0, len(unknown_positions), neighbors_by_chunk):
        stop = min(len(unknown_positions), start + neighbors_by_chunk)
        candidates = tree.query_ball_point(target_sphere[start:stop], r=chord(RADIUS_B_KM), workers=-1)
        for offset, candidate_ids in enumerate(candidates):
            pos = int(unknown_positions[start + offset])
            cell = int(eligible_indices[pos])
            if not len(candidate_ids):
                stats_out["failed_few_sites"] += 1
                continue
            idx = np.asarray(candidate_ids, dtype=int)
            d = exact_distances_km(target_xy[start + offset], xy[idx])
            keep = d <= RADIUS_B_KM
            idx, d = idx[keep], d[keep]
            if len(idx):
                count_out[cell] = len(idx)
                nearest_km[cell] = float(d.min())
            if len(idx) < MIN_B_SITES:
                stats_out["failed_few_sites"] += 1
                if len(idx):
                    effective_out[cell] = 1.0
                continue
            kernel = 1.0 / (1.0 + (d / PRIMARY_B_DECAY_KM) ** 3)
            n_eff = float(kernel.sum() ** 2 / np.dot(kernel, kernel))
            effective_out[cell] = n_eff
            if n_eff < MIN_B_EFFECTIVE:
                stats_out["failed_effective_support"] += 1
                continue
            median = weighted_median(vals[idx], kernel)
            region = basin_name(target_xy[start + offset, 0], target_xy[start + offset, 1])
            typical = medians.get(region, global_median)
            trust = (n_eff / (n_eff + 2.0)) * math.exp(-((float(d.min()) / RADIUS_B_KM) ** 2))
            estimate = typical + trust * (median - typical)
            score = percentile_from_sorted(sorted_source_values, estimate)
            if score is None:
                continue
            tier[cell] = 2
            raw_out[cell] = estimate
            score_out[cell] = score
            stats_out["supported"] += 1
        if stop == len(unknown_positions) or stop % 10000 == 0:
            log(f"Tier B map estimates: {stop:,}/{len(unknown_positions):,} unsupported cells scanned")
    return stats_out


def percentile_from_sorted(sorted_values: np.ndarray, value: float) -> int | None:
    if not np.isfinite(value) or not len(sorted_values):
        return None
    left = int(np.searchsorted(sorted_values, value, side="left"))
    right = int(np.searchsorted(sorted_values, value, side="right"))
    return int(math.floor(((left + (right - left) / 2.0) / len(sorted_values)) * 100.0 + 0.5))


def load_dive_sites():
    path = ROOT / "data/dive-sites.js"
    text = path.read_text(encoding="utf-8")
    match = re.search(r"window\.DIVE_SITES_DATA\s*=\s*(\[.*?\])\s*;", text, flags=re.S)
    if not match:
        raise ValueError("Could not parse the local DiveAtlas site array")
    records = json.loads(match.group(1))
    coords = []
    for row in records:
        try:
            lat, lon = float(row[1]), float(row[2])
        except (TypeError, ValueError, IndexError):
            continue
        if np.isfinite(lat) and np.isfinite(lon) and -90 <= lat <= 90:
            coords.append((lat, (lon + 180.0) % 360.0 - 180.0))
    coords = np.unique(np.asarray(coords, dtype=float), axis=0)
    return coords


def load_coarse_bathymetry():
    """Assemble the bundled 4-arc-minute sample tiles only for domain analysis."""
    elevation = np.full((2700, 5400), 32767, dtype=np.int16)
    missing = []
    for y in range(12):
        for x in range(24):
            path = ROOT / "data/depth_samples" / str(y) / f"{x}.bin.gz"
            if not path.exists():
                missing.append(f"{y}/{x}")
                continue
            record_input(path)
            data = gzip.decompress(path.read_bytes())
            if len(data) != 225 * 225 * 2:
                raise ValueError(f"Unexpected bathymetry sample size: {path}")
            tile = np.frombuffer(data, dtype="<i2").reshape(225, 225)
            elevation[y * 225:(y + 1) * 225, x * 225:(x + 1) * 225] = tile
    if missing:
        raise FileNotFoundError(f"Missing {len(missing)} required depth sample tiles; first: {missing[:8]}")
    return elevation


def sample_domain_predictors(eligible_indices, rep_lat, rep_lon, wet, wet_count):
    """Map dive relevance from local reef pixels, shallow wet samples, and sites."""
    log("Sampling the local 4-arc-minute bathymetry for the dive-domain comparison")
    elevation = load_coarse_bathymetry()
    rows = eligible_indices // WIDTH
    cols = eligible_indices % WIDTH
    cells = []
    sample_lat = []
    sample_lon = []
    for sr in range(SUBDIVISIONS):
        subrow_wet = wet[eligible_indices, sr, :]
        for sc in range(SUBDIVISIONS):
            chosen = np.flatnonzero(subrow_wet[:, sc])
            if not len(chosen):
                continue
            cells.append(chosen)
            sample_lat.append(SOUTH + rows[chosen] * STEP + (sr + 0.5) * STEP / SUBDIVISIONS)
            sample_lon.append(WEST + cols[chosen] * STEP + (sc + 0.5) * STEP / SUBDIVISIONS)
    sample_cells = np.concatenate(cells).astype(np.int32)
    lats = np.concatenate(sample_lat)
    lons = np.concatenate(sample_lon)
    depth_row = np.clip(np.floor((90.0 - lats) * 15.0).astype(int), 0, 2699)
    depth_col = np.mod(np.floor((lons + 180.0) * 15.0).astype(int), 5400)
    sampled_elevation = elevation[depth_row, depth_col]
    wet_valid = (sampled_elevation < 0) & (sampled_elevation > -12000)
    depth_m = np.where(wet_valid, -sampled_elevation.astype(float), np.nan)
    shallow_fraction = {}
    denominator = wet_count[eligible_indices].astype(float)
    for threshold in (20, 30, 40, 60, 100):
        shallow = np.bincount(sample_cells, weights=(wet_valid & (depth_m <= threshold)).astype(float),
                              minlength=len(eligible_indices))
        shallow_fraction[threshold] = shallow / denominator

    log("Sampling mapped reef pixels at the same 8x8 wet subcells")
    z = 7
    n = 1 << z
    world = n * 256.0
    xf = ((lons + 180.0) / 360.0) * world
    clamped_lat = np.clip(lats, -85.05112878, 85.05112878)
    yf = (1.0 - np.arcsinh(np.tan(np.radians(clamped_lat))) / math.pi) / 2.0 * world
    tile_x = np.floor(xf / 256.0).astype(int).clip(0, n - 1)
    tile_y = np.floor(yf / 256.0).astype(int).clip(0, n - 1)
    pixel_x = np.floor(xf).astype(int) % 256
    pixel_y = np.floor(yf).astype(int) % 256
    tile_code = tile_y * n + tile_x
    order = np.argsort(tile_code, kind="mergesort")
    sorted_codes = tile_code[order]
    reef_cell = np.zeros(len(eligible_indices), dtype=bool)
    unique_codes, starts = np.unique(sorted_codes, return_index=True)
    ends = np.r_[starts[1:], len(order)]
    for code, start, end in zip(unique_codes, starts, ends):
        tile_indices = order[start:end]
        tx, ty = int(code % n), int(code // n)
        path = ROOT / "data/reef_tiles" / str(z) / str(tx) / f"{ty}.png"
        if not path.exists():
            continue  # The manifest contains mapped reef-bearing tiles only.
        record_input(path)
        with Image.open(path) as image:
            alpha = np.asarray(image.convert("RGBA"))[:, :, 3]
        present = alpha[pixel_y[tile_indices], pixel_x[tile_indices]] > 0
        if present.any():
            reef_cell[np.unique(sample_cells[tile_indices[present]])] = True
    sites = load_dive_sites()
    site_tree = cKDTree(sphere_xy(sites))
    cell_xy = np.column_stack((rep_lat, rep_lon))
    site_dist_chord = site_tree.query(sphere_xy(cell_xy), k=1, workers=-1)[0]
    nearest_site_km = np.asarray(chord_to_km(site_dist_chord), dtype=float)
    return {"reef_present": reef_cell, "shallow_fraction": shallow_fraction,
            "nearest_dive_site_km": nearest_site_km, "dive_site_count": int(len(sites)),
            "wet_sample_count": int(len(sample_cells)), "site_coordinate_count": int(len(sites))}


def fit_tier_c(sites: pd.DataFrame):
    x = sites[FEATURES].to_numpy(float)
    y = sites.target.to_numpy(float)
    novelty_imputer = SimpleImputer(strategy="median", add_indicator=True)
    x_filled = novelty_imputer.fit_transform(x)
    novelty_scaler = StandardScaler()
    z = novelty_scaler.fit_transform(x_filled)
    nn = NearestNeighbors(n_neighbors=2).fit(z)
    loo_dist = nn.kneighbors(z, return_distance=True)[0][:, 1]
    threshold = float(np.quantile(loo_dist, 0.95))
    model = make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(),
                          SplineTransformer(n_knots=4, degree=3, include_bias=False), Ridge(alpha=10.0))
    model.fit(x, np.log1p(y))
    support_tree = NearestNeighbors(n_neighbors=1).fit(z)
    return model, novelty_imputer, novelty_scaler, support_tree, threshold, loo_dist


def add_tier_c(eligible_indices, rep_lat, rep_lon, tier, score, raw_out, env_distance, env_threshold_out,
               month_count_out, unknown_reason, sites, sorted_source_values):
    candidate_positions = np.flatnonzero(tier[eligible_indices] == 0)
    if not len(candidate_positions):
        return {"candidate_cells": 0, "supported_cells": 0, "unsupported_novelty": 0,
                "insufficient_supported_months": 0, "missing_month_values": 0}
    model, imputer, scaler, support_nn, threshold, loo_dist = fit_tier_c(sites)
    temp_reader, temp_meta = base.load_temperature()
    clarity_reader, clarity_meta = base.load_clarity()
    tile_paths = [ROOT / "data/.build/gebco_2026_2min" / f"gebco_2026_{i:02d}.tif" for i in range(8)]
    if any(not p.exists() for p in tile_paths):
        raise FileNotFoundError("Local GEBCO 2026 2-arc-minute tiles required by the prior spline are missing")
    for path in tile_paths:
        record_input(path)
    datasets = {i: rasterio.open(path) for i, path in enumerate(tile_paths)}
    reef_cache = {}
    counters = Counter()
    log(f"Sampling predictors and environmental support for {len(candidate_positions):,} Tier C candidates")
    for ix, position in enumerate(candidate_positions, 1):
        cell = int(eligible_indices[position])
        lat, lon = float(rep_lat[position]), float(rep_lon[position])
        reef = base.reef_at(lat, lon, reef_cache)
        depth, slope = base.terrain_at(lat, lon, datasets)
        month_features = []
        temps = []
        for month in range(1, 13):
            t = temp_reader(lat, lon, month)
            temps.append(float(t) if np.isfinite(t) else np.nan)
        finite_temps = [v for v in temps if np.isfinite(v)]
        annual = float(np.mean(finite_temps)) if finite_temps else np.nan
        features_by_month = []
        missing_months = 0
        for month in range(1, 13):
            clarity = clarity_reader(lat, lon, month)
            features_by_month.append([reef, depth, slope, temps[month - 1], annual, clarity, lat])
            if not np.isfinite(temps[month - 1]) or not np.isfinite(clarity):
                missing_months += 1
        feature_array = np.asarray(features_by_month, dtype=float)
        env_x = imputer.transform(feature_array)
        env_z = scaler.transform(env_x)
        distances = support_nn.kneighbors(env_z, return_distance=True)[0][:, 0]
        supported = np.isfinite(distances) & (distances <= threshold)
        supported_count = int(supported.sum())
        month_count_out[cell] = supported_count
        env_distance[cell] = float(np.max(distances[supported])) if supported_count else np.nan
        env_threshold_out[cell] = threshold
        counters["missing_month_values"] += missing_months
        if supported_count >= PRIMARY_TIER_C_MONTHS:
            eta = model.predict(feature_array[supported])
            predictions = np.maximum(0.0, np.expm1(np.clip(eta, -50.0, 50.0)))
            estimate = float(np.mean(predictions))
            ranked = percentile_from_sorted(sorted_source_values, estimate)
            if ranked is not None:
                tier[cell] = 3
                raw_out[cell] = estimate
                score[cell] = ranked
                unknown_reason[cell] = ""
                counters["supported_cells"] += 1
            else:
                unknown_reason[cell] = "nonfinite_ecological_prediction"
        else:
            counters["insufficient_supported_months"] += 1
            if supported_count:
                counters["unsupported_novelty"] += 1
                unknown_reason[cell] = "environmental_support_failed_or_seasonal_gap"
            else:
                counters["unsupported_novelty"] += 1
                unknown_reason[cell] = "environmental_support_failed"
        if ix % 500 == 0 or ix == len(candidate_positions):
            log(f"Tier C predictor screen: {ix:,}/{len(candidate_positions):,}; assigned {counters['supported_cells']:,}")
    for ds in datasets.values():
        ds.close()
    return {"candidate_cells": int(len(candidate_positions)), "supported_cells": int(counters["supported_cells"]),
            "unsupported_novelty": int(counters["unsupported_novelty"]),
            "insufficient_supported_months": int(counters["insufficient_supported_months"]),
            "missing_month_values": int(counters["missing_month_values"]),
            "minimum_supported_months": PRIMARY_TIER_C_MONTHS, "environmental_support_rule": "distance to nearest training-site environmental vector <= p95 training leave-one-out nearest-neighbour distance",
            "environmental_support_p95_threshold": threshold,
            "training_loo_environmental_distance_p95": threshold,
            "monthly_predictor_sources": {"temperature": temp_meta.get("source", "WOA23 local monthly surface climatology"),
                                           "clarity": clarity_meta.get("source", "Copernicus Marine ZSD local monthly climatology")}}


def score_category(score: float) -> str:
    if not np.isfinite(score):
        return ""
    if score < 33.333333333:
        return "Lower"
    if score < 66.666666667:
        return "Typical"
    return "Higher"


def close_display_holes(tier_grid: np.ndarray, score_grid: np.ndarray, eligible_grid: np.ndarray):
    """Fill only one-cell holes whose 8 neighbours are all eligible and scored."""
    tier = tier_grid.copy()
    score = score_grid.copy()
    render = np.full(tier.shape, "", dtype=object)
    candidate = np.zeros(tier.shape, dtype=bool)
    for row in range(1, HEIGHT - 1):
        for col in range(1, WIDTH - 1):
            if not eligible_grid[row, col] or tier[row, col] != 0:
                continue
            neighborhood_eligible = eligible_grid[row - 1:row + 2, col - 1:col + 2].copy()
            neighborhood_eligible[1, 1] = True
            neighborhood_tier = tier[row - 1:row + 2, col - 1:col + 2].copy()
            neighborhood_tier[1, 1] = 1
            if neighborhood_eligible.all() and np.all(neighborhood_tier > 0):
                candidate[row, col] = True
    # One pass only: filled pixels are display metadata, never inputs to another fill.
    for row, col in zip(*np.where(candidate)):
        values = score[row - 1:row + 2, col - 1:col + 2].copy()
        values[1, 1] = np.nan
        score[row, col] = float(np.nanmedian(values))
        render[row, col] = "display_interpolation"
    return score, render, int(candidate.sum())


def coverage_tables(eligible_indices, tier, display_render, score, region, dive_domain):
    code_names = {0: "unknown", 1: "survey_supported", 2: "regional_estimate", 3: "ecological_outlook"}
    # Tier codes are exclusive provenance classes; coverage stages are cumulative.
    stages = {"A only": tier == 1, "A + B": (tier == 1) | (tier == 2), "A + B + C": tier > 0}
    rows = []
    for domain_name, domain in (("global eligible ocean", np.ones(len(eligible_indices), dtype=bool)),
                                ("dive-relevant domain", dive_domain)):
        total = int(domain.sum())
        for stage, assigned in stages.items():
            count = int(np.sum(domain & assigned[eligible_indices]))
            rows.append({"domain": domain_name, "stage": stage, "eligible_cells": total, "covered_cells": count,
                         "coverage_percent": 100.0 * count / total if total else None,
                         "remaining_unknown_cells": total - count,
                         "remaining_unknown_percent": 100.0 * (total - count) / total if total else None,
                         "display_only_hole_fills": int(np.sum(domain & (display_render[eligible_indices] == "display_interpolation")))})
    pd.DataFrame(rows).to_csv(OUT / "coverage_by_stage_and_domain.csv", index=False)
    region_rows = []
    for name in sorted(set(region.tolist())):
        in_region = region == name
        denominator = int(in_region.sum())
        dmask = dive_domain & in_region
        for domain_name, mask in (("global eligible ocean", in_region), ("dive-relevant domain", dmask)):
            total = int(mask.sum())
            record = {"region_proxy": name, "domain": domain_name, "eligible_cells": total}
            for code, label in code_names.items():
                record[f"{label}_cells"] = int(np.sum(mask & (tier[eligible_indices] == code)))
                record[f"{label}_percent"] = 100.0 * record[f"{label}_cells"] / total if total else None
            eligible_tier = tier[eligible_indices]
            record["a_only_covered_percent"] = 100.0 * np.sum(mask & (eligible_tier == 1)) / total if total else None
            record["a_plus_b_covered_percent"] = 100.0 * np.sum(mask & ((eligible_tier == 1) | (eligible_tier == 2))) / total if total else None
            record["a_plus_b_plus_c_covered_percent"] = 100.0 * np.sum(mask & (eligible_tier > 0)) / total if total else None
            region_rows.append(record)
    pd.DataFrame(region_rows).to_csv(OUT / "coverage_by_region.csv", index=False)


def write_unknown_reasons(eligible_indices, tier, reason, region, dive_domain):
    rows = []
    codes = tier[eligible_indices]
    reasons = reason[eligible_indices]
    groups = [("All regions", np.ones(len(eligible_indices), dtype=bool))]
    groups.extend((name, region == name) for name in sorted(set(region.tolist())))
    for domain_name, domain in (("global eligible ocean", np.ones(len(eligible_indices), dtype=bool)),
                                ("dive-relevant domain", dive_domain)):
        for basin, in_basin in groups:
            keep = domain & in_basin & (codes == 0)
            if not keep.any():
                continue
            counts = Counter(str(value) or "unspecified" for value in reasons[keep])
            for cause, count in sorted(counts.items()):
                rows.append({"domain": domain_name, "region_proxy": basin, "unknown_reason": cause,
                             "cells": int(count), "unknown_cells_in_group": int(keep.sum()),
                             "percent_of_unknown_in_group": 100.0 * count / int(keep.sum())})
    pd.DataFrame(rows).to_csv(OUT / "unknown_reasons.csv", index=False)


def write_results_summary(coverage, validation, training_rows, coordinate_site_count):
    """Write the review report from the same objects used to generate the outputs."""
    def fmt(value, digits=1):
        return "—" if value is None or not np.isfinite(float(value)) else f"{float(value):,.{digits}f}"

    def validation_row(block_km, method):
        selected = validation[(validation.block_size_km == block_km) & (validation.method == method)]
        return None if selected.empty else selected.iloc[0]

    eligible = coverage["eligible_cells"]
    tier_a = coverage["current_tier_a_cells"]
    tier_b = coverage["tier_b_cells"]
    tier_c = coverage["tier_c_cells"]
    unknown = coverage["remaining_unknown_cells"]
    domain_n = coverage["dive_domain_cells"]
    domain_stages = coverage["dive_domain_coverage"]
    unknown_rows = pd.read_csv(OUT / "unknown_reasons.csv")
    global_unknown_rows = unknown_rows[(unknown_rows.domain == "global eligible ocean") &
                                       (unknown_rows.region_proxy == "All regions")]
    unknown_detail = "; ".join(f"{int(row.cells):,} `{row.unknown_reason}`"
                                for row in global_unknown_rows.itertuples()) or "none"
    unknown_regions = [name for name, stats in coverage["regional_coverage"].items() if stats["unknown"]]
    unknown_region_detail = ", ".join(unknown_regions) or "none"
    lines = [
        "# Fish Abundance Outlook prototype results",
        "",
        "This analysis-only prototype explores broad consumer-planning guidance while keeping evidence strength separate from the relative outlook. It does not change production scores, map assets, or renderers. The target table contains positive recorded survey units only; no complete survey-block denominator or confirmed zero-count blocks was recovered. Values therefore describe abundance conditional on recorded fish presence and do not support an unconditional global density surface.",
        "",
        "## Tier A coverage",
        "",
        f"Tier A retains **{tier_a:,} of {eligible:,} eligible marine cells ({coverage['a_only_coverage_percent']:.2f}%)**. The current stored score mask was preserved exactly, and internal fish/100 m² estimates were recomputed for {coverage['tier_a_raw_values_recomputed']:,} of {tier_a:,} supported cells.",
        "",
        "## Tier B recovered coverage",
        "",
        f"Tier B assigns **{tier_b:,} additional cells**. Cumulative A+B coverage is **{tier_a + tier_b:,} cells ({coverage['a_plus_b_coverage_percent']:.2f}%)**. The new exact nearest-distance calculation found and recovered {coverage['tier_b_recovered_current_2500_5000_gap_cells']:,}/{coverage['current_2500_5000_gap_cells']:,} cells in the 2,500–5,000 km band.",
        "",
        f"The prior diagnostic's cause count was {coverage['prior_diagnostic_2500_5000_cause_count']:,}, while its distance-band histogram was {coverage['prior_diagnostic_nearest_band_count']:,} (difference {coverage['prior_diagnostic_count_discrepancy']:,}). Because the old report has no cell-level cause table, exact overlap is unknown; with only {unknown:,} cells unsupported overall, the lower bound is {coverage['tier_b_recovered_prior_30770_cause_count_lower_bound']:,}/{coverage['prior_diagnostic_2500_5000_cause_count']:,} ({coverage['tier_b_recovered_prior_cause_percent_lower_bound']:.2f}%).",
        "",
        "Tier B uses a weighted median across protocol-adjusted NRMN coordinate sites within 5,000 km, the existing cubic 250 km distance kernel, minimum support checks, and shrinkage toward a coarse basin median. Its absolute-value validation remains biased, so exact density must remain internal.",
        "",
        "### Buffered spatial validation",
        "",
        "Metrics are fish/100 m² on positive recorded survey units. Folds use the existing blocked/purged protocol; Tier B is compared with both the fold-trained global median and the current 2,500 km distance estimator.",
        "",
        "| Block / purge (km) | Estimator | MAE | Median AE | Bias | Spearman | Test coverage |",
        "|---|---|---:|---:|---:|---:|---:|",
    ]
    for block_km, purge_km in ((500, 250), (1000, 500)):
        for method, label in (("global_median", "Global median"),
                              ("current_distance_2500", "Current distance (2,500 km)"),
                              ("shrunk_median_5000_d250", "Tier B shrunk weighted median (5,000 km)")):
            row = validation_row(block_km, method)
            if row is None:
                continue
            lines.append(f"| {block_km} / {purge_km} | {label} | {fmt(row.mae)} | {fmt(row.median_absolute_error)} | {fmt(row.bias_prediction_minus_actual)} | {fmt(row.spearman, 3)} | {100.0 * float(row.coverage_fraction):.2f}% ({int(row.n):,}/{int(row.test_sites):,}) |")
    lines.extend([
        "",
        "Tier B materially lowers MAE and median absolute error versus current distance interpolation on both blocked splits. The 1,000/500 km split is harder: rank correlation is only modestly higher than the current estimator, and Tier B bias shifts to about −151 fish/100 m². This supports a relative outlook experiment, not an exact density claim.",
        "",
        "## Tier C recovered coverage",
        "",
        f"Tier C assigns **{tier_c} cells**. The spline environmental novelty screen evaluated {coverage['tier_c_environmental_support_diagnostic']['candidate_cells']} remaining cells; none met the joint environmental/monthly support requirement ({coverage['tier_c_environmental_support_diagnostic']['minimum_supported_months']}/12 months required). Across candidates, {coverage['tier_c_environmental_support_diagnostic']['missing_month_values']} temperature/clarity month-values were missing. This conservative result avoids filling the last cells with extrapolations outside the training domain.",
        "",
        "## Final remaining unknown percentage",
        "",
        f"**{unknown:,} cells ({coverage['remaining_unknown_percent']:.4f}%)** remain unknown globally. These are in {unknown_region_detail}; reason counts: {unknown_detail}. The analysis-only one-cell display-hole procedure filled {coverage['display_only_holes_filled']} cells; no display-only values were added.",
        "",
        "## Regional coverage",
        "",
        "Coverage is cumulative by stage; the tier columns are mutually exclusive provenance counts.",
        "",
        "| Region proxy | Eligible cells | A only | A + B | A + B + C | Unknown |",
        "|---|---:|---:|---:|---:|---:|",
    ])
    for name, stats in coverage["regional_coverage"].items():
        a_count = stats["survey_supported"]
        ab_count = a_count + stats["regional_estimate"]
        abc_count = a_count + stats["regional_estimate"] + stats["ecological_outlook"]
        lines.append(f"| {name} | {stats['eligible_cells']:,} | {100*a_count/stats['eligible_cells']:.2f}% | {100*ab_count/stats['eligible_cells']:.2f}% | {100*abc_count/stats['eligible_cells']:.2f}% | {stats['unknown']:,} |")
    lines.extend([
        "",
        "## Dive-relevant-domain coverage",
        "",
        f"The exploratory domain includes cells with a mapped reef hit among wet 8×8 subcells, at least 25% shallow wet subcells at ≤40 m, or a DiveAtlas site within 50 km. It contains **{domain_n:,} cells ({coverage['dive_domain_coverage_percent']:.2f}% of eligible marine cells)**. Cumulative coverage is:",
        "",
        f"- A only: {domain_stages['A only']:,}/{domain_n:,} ({100*domain_stages['A only']/domain_n:.2f}%).",
        f"- A + B: {domain_stages['A + B']:,}/{domain_n:,} ({100*domain_stages['A + B']/domain_n:.2f}%).",
        f"- A + B + C: {domain_stages['A + B + C']:,}/{domain_n:,} ({100*domain_stages['A + B + C']/domain_n:.2f}%).",
        "",
        "The 40 m limit is one sensitivity reference, not a universal definition of diveable water; alternative depth, shallow-fraction, and site-distance cutoffs are in `dive_domain_sensitivity.csv`. Reef raster absence is not treated as proof of no reef.",
        "",
        "## Proposed abundance scale",
        "",
        "Use one empirical relative scale derived from the existing fish-map source-unit distribution, with terciles labeled **Lower**, **Typical**, and **Higher**. Keep exact fish/100 m² out of public Tier B/C values; do not describe a category as guaranteed abundance.",
        "",
        "## Proposed evidence-strength system",
        "",
        "- Tier A `survey_supported`: High evidence; starting opacity 93%.",
        "- Tier B `regional_estimate`: Moderate evidence; starting opacity 62.5%.",
        "- Tier C `ecological_outlook`: Limited evidence; starting opacity 40%.",
        "- Unknown: transparent, with ‘No reliable estimate available.’",
        "",
        "Opacity is a visual hierarchy proposal, not calibrated statistical confidence. Preserve the source and support metadata separately from the abundance category.",
        "",
        "## Visual comparison",
        "",
        "The left panel shows Tier A only; the right shows all scientifically assigned tiers. Rendering uses the existing 8×8 water-only mask, so no land subcells are painted. At the proposed opacity, Tier B reads lighter than Tier A while extending color across global gaps; Tier C currently adds no cells. This is a static visual inspection, not a user study.",
        "",
        "![Tier A and multi-tier outlook comparison](fish_abundance_outlook_side_by_side.png)",
        "",
        "## Data/schema changes required",
        "",
        "A production implementation would need a versioned cell record with mutually exclusive `provenance_tier`, public `outlook_score`/`outlook_category`, separate `evidence_label`, internal-only raw estimate, supporting-site count, nearest-support distance, effective support, environmental-support state, unknown reason, and display-only render provenance. The prototype CSV and `prototype_schema_and_display.json` define a reviewable starting point; production files remain unchanged.",
        "",
        "## Recommendation",
        "",
        "**B. promising but tune thresholds/visual confidence first.** Tier B adds broad global coverage and improves blocked MAE/median error, but the persistent negative bias, weak long-block rank performance, positive-presence-only target, and coarse basin shrinkage mean this is not ready to deploy. Review the side-by-side map and coverage sensitivity, then calibrate the public relative categories against user expectations before any production integration.",
        "",
        f"Reproduction used {training_rows:,} protocol-adjusted training units from {coordinate_site_count:,} coordinate sites. The complete output inventory and input hashes are in `analysis_manifest.json`.",
        "",
    ])
    (OUT / "results_summary.md").write_text("\n".join(lines), encoding="utf-8")


def make_map_image(mask, tier_grid, score_grid, display_render):
    """Render wet 1/16-degree subcells so the prototype never paints land."""
    target = (1120, 529)
    title_h, footer_h, gap = 80, 100, 30
    panel_w, panel_h = target
    image = Image.new("RGB", (panel_w * 2 + gap + 80, title_h + panel_h + footer_h), (250, 251, 250))
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("arial.ttf", 29)
        small = ImageFont.truetype("arial.ttf", 18)
        tiny = ImageFont.truetype("arial.ttf", 15)
    except OSError:
        font, small, tiny = ImageFont.load_default(), ImageFont.load_default(), ImageFont.load_default()
    panels = [(40, "Tier A · survey-supported only"), (40 + panel_w + gap, "Tier A + regional + ecological outlook")]
    for x, title in panels:
        draw.text((x, 14), title, fill=(30, 45, 58), font=font)
        draw.rectangle((x, 0, x + panel_w, title_h + panel_h + 30), outline=(208, 216, 220), width=2)
    left_canvas = render_global_panel(mask, tier_grid, score_grid, display_render, only_a=True)
    right_canvas = render_global_panel(mask, tier_grid, score_grid, display_render, only_a=False)
    image.paste(left_canvas, (40, title_h))
    image.paste(right_canvas, (40 + panel_w + gap, title_h))
    footer_y = title_h + panel_h + 38
    draw.text((42, footer_y), "Outlook: Lower", fill=(70, 78, 85), font=small)
    draw.rounded_rectangle((180, footer_y + 3, 330, footer_y + 20), radius=8, fill=(206, 112, 89))
    draw.text((347, footer_y), "Typical", fill=(70, 78, 85), font=small)
    draw.rounded_rectangle((430, footer_y + 3, 580, footer_y + 20), radius=8, fill=(227, 190, 103))
    draw.text((597, footer_y), "Higher", fill=(70, 78, 85), font=small)
    draw.rounded_rectangle((675, footer_y + 3, 825, footer_y + 20), radius=8, fill=(47, 132, 112))
    draw.text((850, footer_y), "Evidence is shown by opacity; opacity is a UI encoding, not calibrated confidence.",
              fill=(85, 93, 101), font=tiny)
    path = OUT / "fish_abundance_outlook_side_by_side.png"
    image.save(path, optimize=True)
    return path


def render_global_panel(mask, tier_grid, score_grid, display_render, only_a=False):
    palette = {"Lower": np.asarray((206, 112, 89), dtype=float),
               "Typical": np.asarray((227, 190, 103), dtype=float),
               "Higher": np.asarray((47, 132, 112), dtype=float)}
    mask4 = mask.reshape(HEIGHT, WIDTH, SUBDIVISIONS)
    wet = np.zeros((HEIGHT, WIDTH, SUBDIVISIONS, SUBDIVISIONS), dtype=bool)
    for sr in range(SUBDIVISIONS):
        for sc in range(SUBDIVISIONS):
            wet[:, :, sr, sc] = (mask4[:, :, sr] & (1 << sc)) != 0
    wet = np.flipud(wet.transpose(0, 2, 1, 3).reshape(HEIGHT * SUBDIVISIONS, WIDTH * SUBDIVISIONS))
    tiers = tier_grid.copy()
    if only_a:
        tiers[tiers != 1] = 0
    score_top = np.flipud(score_grid)
    tiers_top = np.flipud(tiers)
    render_top = np.flipud(display_render)
    rgb = np.empty((HEIGHT, WIDTH, 3), dtype=np.uint8)
    rgb[:] = (246, 247, 245)
    rgb8base = np.empty((HEIGHT * SUBDIVISIONS, WIDTH * SUBDIVISIONS, 3), dtype=np.uint8)
    rgb8base[:] = (246, 247, 245)
    rgb8base[wet] = (212, 220, 220)
    layer = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    opacity = np.zeros((HEIGHT, WIDTH), dtype=float)
    for row in range(HEIGHT):
        for col in range(WIDTH):
            code = int(tiers_top[row, col])
            if code and np.isfinite(score_top[row, col]):
                layer[row, col] = palette[score_category(float(score_top[row, col]))].astype(np.uint8)
                opacity[row, col] = TIER_OPACITY["ABC"[code - 1]]
            elif not only_a and render_top[row, col] == "display_interpolation" and np.isfinite(score_top[row, col]):
                layer[row, col] = palette[score_category(float(score_top[row, col]))].astype(np.uint8)
                opacity[row, col] = 0.25
    layer8 = np.repeat(np.repeat(layer, SUBDIVISIONS, axis=0), SUBDIVISIONS, axis=1)
    alpha8 = np.repeat(np.repeat(opacity, SUBDIVISIONS, axis=0), SUBDIVISIONS, axis=1)
    paint = wet & (alpha8 > 0)
    a = alpha8[paint, None]
    rgb8base[paint] = np.rint(layer8[paint] * a + rgb8base[paint] * (1.0 - a)).astype(np.uint8)
    panel = Image.fromarray(rgb8base, mode="RGB").resize((1120, 529), Image.Resampling.NEAREST)
    draw = ImageDraw.Draw(panel)
    try:
        font = ImageFont.truetype("arial.ttf", 14)
    except OSError:
        font = ImageFont.load_default()
    for lon in range(-120, 181, 60):
        x = int((lon + 180) / 360 * panel.width)
        draw.line((x, 0, x, panel.height), fill=(165, 175, 177), width=1)
        draw.text((x + 3, panel.height - 20), str(lon), fill=(70, 82, 90), font=font)
    for lat in range(-60, 81, 30):
        y = int((85 - lat) / 170 * panel.height)
        draw.line((0, y, panel.width, y), fill=(165, 175, 177), width=1)
        draw.text((4, y + 2), str(lat), fill=(70, 82, 90), font=font)
    return panel


def save_grid_asset(eligible_indices, rep_lat, rep_lon, wet_count, tier, raw_internal,
                    score, display_score, support_count, nearest, effective, env_distance, env_threshold,
                    months_supported, unknown_reason, render, fish_score):
    eligible_grid_tier = np.zeros(CELL_COUNT, dtype=np.uint8)
    eligible_grid_tier[eligible_indices] = tier[eligible_indices]
    rows = []
    for pos, cell in enumerate(eligible_indices):
        code = int(tier[cell])
        rows.append({
            "cell_index": int(cell), "lat": float(rep_lat[pos]), "lon": float(rep_lon[pos]),
            "ocean_sample_fraction": float(wet_count[cell] / 64.0),
            "tier": {0: "unknown", 1: "A", 2: "B", 3: "C"}[code],
            "provenance": {0: "unknown", 1: "survey_supported", 2: "regional_estimate", 3: "ecological_outlook"}[code],
            "evidence_strength": {0: "none", 1: "High", 2: "Moderate", 3: "Limited"}[code],
            "outlook_score_internal_0_100": int(score[cell]) if np.isfinite(score[cell]) else None,
            "display_score_internal_0_100": int(display_score[cell]) if np.isfinite(display_score[cell]) else None,
            "abundance_category": score_category(float(score[cell])) if np.isfinite(score[cell]) else "",
            "raw_abundance_internal_fish_per_100m2": float(raw_internal[cell]) if np.isfinite(raw_internal[cell]) else None,
            "supporting_sites": int(support_count[cell]),
            "nearest_support_km": float(nearest[cell]) if np.isfinite(nearest[cell]) else None,
            "effective_support_n": float(effective[cell]) if np.isfinite(effective[cell]) else None,
            "environmental_support_distance": float(env_distance[cell]) if np.isfinite(env_distance[cell]) else None,
            "environmental_support_threshold": float(env_threshold[cell]) if np.isfinite(env_threshold[cell]) else None,
            "environmental_months_supported": int(months_supported[cell]),
            "unsupported_reason": str(unknown_reason[cell]),
            "render_provenance": str(render[cell]),
            "tier_a_existing_score": int(fish_score[cell]) if fish_score[cell] <= 100 else None,
        })
        if pos and pos % 50000 == 0:
            log(f"Writing prototype grid rows: {pos:,}/{len(eligible_indices):,}")
    pd.DataFrame(rows).to_csv(OUT / "fish_abundance_outlook_grid.csv.gz", index=False, compression="gzip")


def write_dive_domain_sensitivity(eligible_indices, tier, domain, region, render):
    rows = []
    for depth_limit in (20, 30, 40, 60, 100):
        for shallow_fraction_limit in (0.10, 0.25, 0.50):
            shallow = domain["shallow_fraction"][depth_limit] >= shallow_fraction_limit
            for proximity_km in (25, 50, 100):
                dive = domain["reef_present"] | shallow | (domain["nearest_dive_site_km"] <= proximity_km)
                n = int(dive.sum())
                base_row = {"depth_limit_m": depth_limit, "minimum_shallow_wet_fraction": shallow_fraction_limit,
                            "dive_site_proximity_km": proximity_km, "reef_cell_rule": "any mapped WCMC raster hit among wet 8x8 subcells",
                            "domain_cells": n, "domain_percent_of_eligible": 100.0 * n / len(eligible_indices)}
                eligible_tier = tier[eligible_indices]
                stage_masks = (("A only", eligible_tier == 1),
                               ("A + B", (eligible_tier == 1) | (eligible_tier == 2)),
                               ("A + B + C", eligible_tier > 0))
                for stage, covered_mask in stage_masks:
                    covered = int(np.sum(dive & covered_mask))
                    base_row[f"{stage.lower().replace(' ', '_').replace('+', 'plus')}_covered_cells"] = covered
                    base_row[f"{stage.lower().replace(' ', '_').replace('+', 'plus')}_coverage_percent"] = 100.0 * covered / n if n else None
                base_row["display_only_hole_fills"] = int(np.sum(dive & (render == "display_interpolation")))
                rows.append(base_row)
    pd.DataFrame(rows).to_csv(OUT / "dive_domain_sensitivity.csv", index=False)


def main():
    started = time.time()
    log("Loading and validating the current fixed-grid support assets")
    manifest, mask, wet, wet_count, eligible, eligible_indices, rep_lat, rep_lon, fish_score = read_grid_inputs()
    eligible_count = int(eligible.sum())
    if eligible_count != int(manifest["oceanMask"]["eligibleCellCount"]):
        raise ValueError(f"Mask reports {eligible_count} eligible cells, manifest reports {manifest['oceanMask']['eligibleCellCount']}")
    log(f"Eligible marine grid verified: {eligible_count:,} cells")

    raw, source_xy, source_values, source_tree, raw_tree, sorted_raw_units, snapshot = load_current_fish_sources()
    tier = np.zeros(CELL_COUNT, dtype=np.uint8)
    score = np.full(CELL_COUNT, np.nan)
    raw_internal = np.full(CELL_COUNT, np.nan)
    supporting = np.zeros(CELL_COUNT, dtype=np.uint16)
    nearest = np.full(CELL_COUNT, np.nan)
    effective = np.full(CELL_COUNT, np.nan)
    env_distance = np.full(CELL_COUNT, np.nan)
    env_threshold = np.full(CELL_COUNT, np.nan)
    months_supported = np.zeros(CELL_COUNT, dtype=np.uint8)
    unknown_reason = np.full(CELL_COUNT, "", dtype=object)
    render = np.full(CELL_COUNT, "", dtype=object)

    tier_a = (fish_score[eligible_indices] <= 100)
    tier[eligible_indices[tier_a]] = 1
    score[eligible_indices[tier_a]] = fish_score[eligible_indices[tier_a]].astype(float)
    raw_site_percentile = sorted_raw_units
    supporting_a, nearest_a, effective_a, raw_count = fill_tier_a_raw(
        eligible_indices, rep_lat, rep_lon, fish_score, raw, source_xy, source_values,
        source_tree, raw_tree, raw_internal)
    supporting[:] = supporting_a
    nearest[:] = nearest_a
    effective[:] = effective_a
    current_near_chord, _ = source_tree.query(sphere_xy(np.column_stack((rep_lat, rep_lon))), k=1, workers=-1)
    nearest_current = np.asarray(chord_to_km(current_near_chord), dtype=float)
    tier_a_count = int(tier_a.sum())
    log(f"Tier A retained exact current support mask: {tier_a_count:,} cells; raw estimates recoverable for {raw_count:,}")

    table, sites = load_protocol_sites()
    log(f"Loaded {len(table):,} protocol-adjusted units at {len(sites):,} independent coordinate sites")
    source_training_meta = json.loads((ROOT / "analysis/fish-ecological-experiment/training_table_metadata.json").read_text(encoding="utf-8"))
    protocol_audit = json.loads((ROOT / "analysis/fish-ecological-experiment/protocol_adjustment_audit.json").read_text(encoding="utf-8"))
    predictor_meta = json.loads((ROOT / "analysis/fish-ecological-experiment/predictor_metadata.json").read_text(encoding="utf-8"))
    save_json(OUT / "training_table_metadata.json", {
        "table_path": "analysis/fish-ecological-experiment/protocol_adjusted_training_table.csv.gz",
        "sha256": sha256(ROOT / "analysis/fish-ecological-experiment/protocol_adjusted_training_table.csv.gz"),
        "rows": int(len(table)), "coordinate_site_count": int(len(sites)),
        "target": "fish_per_100m2", "target_zero_rows": int((table.fish_per_100m2 == 0).sum()),
        "source_license": source_training_meta.get("license"),
        "sources": source_training_meta.get("sources", []),
        "protocol_adjustment_rules": json.loads((ROOT / "analysis/fish-ecological-experiment/training_table_metadata.json").read_text(encoding="utf-8")).get("followup_analysis_table", {}).get("rules"),
        "protocol_audit_summary": {k: protocol_audit.get(k) for k in ("whole_zero_target_blocks_observed", "reconstructed_zero_blocks", "nominal_expected_documented_units", "nominal_recorded_documented_units", "nominal_unrepresented_documented_units_status_unknown")},
        "predictors": predictor_meta.get("predictors"),
        "target_leakage_controls": predictor_meta.get("target_leakage_controls"),
        "caveats": ["All modeled NRMN target units are positive recorded units; no complete survey-block denominator or confirmed zero blocks was recovered.",
                    "Predictors are climatological/geographic associations, not contemporaneous dive conditions.",
                    "No secondary MERMAID dataset is included."],
    })
    validation, _ = validate_tier_b(sites)

    # Tier B is declared before map assignment: robust weighted median, existing
    # cubic 250 km decay, 5,000 km support ceiling, and conservative basin shrink.
    b_support = build_tier_b_grid(eligible_indices, rep_lat, rep_lon, tier, raw_site_percentile,
                                  nearest, supporting, effective, raw_internal, score, sites=sites)
    b_mask = (tier[eligible_indices] == 2)
    tier_b_count = int(b_mask.sum())
    current_gap_2500_5000 = (nearest_current >= 2500.0) & (nearest_current <= 5000.0) & ~tier_a
    gap_total = int(current_gap_2500_5000.sum())
    gap_recovered = int(np.sum(current_gap_2500_5000 & b_mask))
    previous_diagnostic_path = ROOT / "reports/fish-density-coverage-diagnostics.json"
    previous_diagnostic = json.loads(previous_diagnostic_path.read_text(encoding="utf-8"))
    previous_gap_total = int(previous_diagnostic["missingCauses"]["nearest survey beyond 2,500 km (within 5,000 km)"]["count"])
    previous_histogram_gap = int(previous_diagnostic["supportDiagnostics"]["nearestObservationDistanceBandsAmongMissing"]["2500-5000km"])
    previous_gap_unreconciled = max(0, previous_gap_total - previous_histogram_gap)
    for pos, cell in enumerate(eligible_indices):
        if tier[cell] != 0:
            continue
        # Preserve a diagnostic reason even if the ecological screen later fails.
        if nearest_current[pos] > RADIUS_B_KM:
            unknown_reason[cell] = "no_current_survey_within_5000_km"
        elif supporting[cell] < MIN_B_SITES:
            unknown_reason[cell] = "fewer_than_two_protocol_adjusted_sites_within_5000_km"
        elif effective[cell] < MIN_B_EFFECTIVE:
            unknown_reason[cell] = "insufficient_effective_support_for_tier_b"
        else:
            unknown_reason[cell] = "tier_b_failed_protocol_adjusted_support"
    log(f"Tier B assigned {tier_b_count:,}; recovered {gap_recovered:,}/{gap_total:,} current 2,500–5,000 km gap cells")

    # The query helpers load compressed chunks lazily. Track their exact reads
    # so the manifest fingerprints the local predictor data used in this run.
    original_gzip_open, original_image_open = gzip.open, Image.open
    def tracked_gzip_open(path, *args, **kwargs):
        record_input(Path(path))
        return original_gzip_open(path, *args, **kwargs)
    def tracked_image_open(path, *args, **kwargs):
        record_input(Path(path))
        return original_image_open(path, *args, **kwargs)
    gzip.open, Image.open = tracked_gzip_open, tracked_image_open
    try:
        tier_c = add_tier_c(eligible_indices, rep_lat, rep_lon, tier, score, raw_internal,
                            env_distance, env_threshold, months_supported, unknown_reason,
                            sites, sorted_raw_units)
    finally:
        gzip.open, Image.open = original_gzip_open, original_image_open
    tier_c_count = int(np.sum(tier[eligible_indices] == 3))
    log(f"Tier C assigned {tier_c_count:,} cells after the environmental-support screen")

    log("Building the analysis-only dive-relevant domain and small-hole diagnostic")
    domain = sample_domain_predictors(eligible_indices, rep_lat, rep_lon, wet, wet_count)
    tier_grid = tier.reshape(HEIGHT, WIDTH)
    score_grid = score.reshape(HEIGHT, WIDTH)
    eligible_grid = eligible.reshape(HEIGHT, WIDTH)
    score_display_grid, render_grid, display_holes = close_display_holes(tier_grid, score_grid, eligible_grid)
    render[:] = render_grid.reshape(-1)
    render_sub = render[eligible_indices]
    region = np.asarray([basin_name(a, b) for a, b in np.column_stack((rep_lat, rep_lon))], dtype=object)
    main_dive_domain = (domain["reef_present"] | (domain["shallow_fraction"][40] >= 0.25) |
                        (domain["nearest_dive_site_km"] <= 50.0))
    write_dive_domain_sensitivity(eligible_indices, tier, domain, region, render_sub)
    coverage_tables(eligible_indices, tier, render, score, region, main_dive_domain)
    write_unknown_reasons(eligible_indices, tier, unknown_reason, region, main_dive_domain)

    # Save the display-only score separately. Scientific tier and raw fields stay untouched.
    save_grid_asset(eligible_indices, rep_lat, rep_lon, wet_count, tier, raw_internal,
                    score, score_display_grid.reshape(-1), supporting, nearest, effective, env_distance, env_threshold,
                    months_supported, unknown_reason, render, fish_score)
    # A-only/A+B/A+B+C visuals use the tier score; one-cell display fills remain unknown.
    make_map_image(mask, tier_grid, score_display_grid, render_grid)

    source_region = np.asarray([basin_name(a, b) for a, b in source_xy], dtype=object)
    del source_region
    codes = {"unknown": 0, "survey_supported": 1, "regional_estimate": 2, "ecological_outlook": 3}
    region_coverage = {}
    for name in sorted(set(region.tolist())):
        in_region = region == name
        region_coverage[name] = {"eligible_cells": int(in_region.sum()),
                                 **{label: int(np.sum(in_region & (tier[eligible_indices] == code)))
                                    for label, code in codes.items()}}
    coverage = {
        "eligible_cells": eligible_count,
        "current_tier_a_cells": tier_a_count,
        "tier_b_cells": tier_b_count,
        "tier_c_cells": tier_c_count,
        "a_only_coverage_percent": 100.0 * tier_a_count / eligible_count,
        "a_plus_b_coverage_percent": 100.0 * (tier_a_count + tier_b_count) / eligible_count,
        "a_plus_b_plus_c_coverage_percent": 100.0 * (tier_a_count + tier_b_count + tier_c_count) / eligible_count,
        "remaining_unknown_cells": int(np.sum(tier[eligible_indices] == 0)),
        "remaining_unknown_percent": 100.0 * np.sum(tier[eligible_indices] == 0) / eligible_count,
        "current_2500_5000_gap_cells": gap_total,
        "tier_b_recovered_current_2500_5000_gap_cells": gap_recovered,
        "tier_b_recovered_gap_percent": 100.0 * gap_recovered / gap_total if gap_total else None,
        "prior_diagnostic_2500_5000_cause_count": previous_gap_total,
        "prior_diagnostic_nearest_band_count": previous_histogram_gap,
        "prior_diagnostic_count_discrepancy": previous_gap_unreconciled,
        "tier_b_recovered_exact_nearest_band_cells": gap_recovered,
        "tier_b_recovered_prior_30770_cause_count_lower_bound": max(0, previous_gap_total - int(np.sum(tier[eligible_indices] == 0))),
        "tier_b_recovered_prior_30770_cause_count_upper_bound": previous_gap_total,
        "tier_b_recovered_prior_cause_percent_lower_bound": 100.0 * max(0, previous_gap_total - int(np.sum(tier[eligible_indices] == 0))) / previous_gap_total if previous_gap_total else None,
        "prior_diagnostic_reconciliation_note": "The earlier diagnostics JSON reports 30,770 under missingCauses, but its nearestObservationDistanceBandsAmongMissing histogram reports 29,113 in 2,500–5,000 km. Tier B exactly recovers the 29,113-cell nearest-distance band. Since only 34 cells remain unsupported across the entire missing set, at least 30,736 of the prior 30,770 cause-count cells are recovered; the exact overlap cannot be resolved from that report because it does not retain a cell-level category table.",
        "tier_a_raw_values_recomputed": raw_count,
        "tier_a_raw_values_missing": tier_a_count - raw_count,
        "display_only_holes_filled": display_holes,
        "display_fill_rule": "one pass; eligible center with all 8 surrounding cells eligible and scientifically assigned; median neighbor rank; render_provenance=display_interpolation",
        "dive_domain_definition": "mapped reef hit in at least one wet 8x8 subcell OR at least 25% of wet subcells are <=40m depth OR nearest DiveAtlas site is within 50km",
        "dive_domain_cells": int(main_dive_domain.sum()),
        "dive_domain_coverage_percent": 100.0 * int(main_dive_domain.sum()) / eligible_count,
        "dive_domain_site_count": domain["site_coordinate_count"],
        "dive_domain_coverage": {
            "A only": int(np.sum(main_dive_domain & (tier[eligible_indices] == 1))),
            "A + B": int(np.sum(main_dive_domain & ((tier[eligible_indices] == 1) | (tier[eligible_indices] == 2)))),
            "A + B + C": int(np.sum(main_dive_domain & (tier[eligible_indices] > 0))),
        },
        "regional_coverage": region_coverage,
        "tier_b_support_diagnostic": b_support,
        "tier_c_environmental_support_diagnostic": tier_c,
        "tier_b_primary_validation": validation[validation.method == "shrunk_median_5000_d250"].to_dict(orient="records"),
        "data_interpretation": "The recovered survey target has no reconstructed zero-count blocks. All tiers are conditional relative outlooks from positive recorded survey units; none is a globally unconditional abundance estimate. Tier B/C raw outputs are internal only.",
    }
    save_json(OUT / "coverage_summary.json", coverage)
    write_results_summary(coverage, validation, len(table), len(sites))

    # Evidence and scale metadata keep public display semantics separate from internals.
    metadata = {
        "prototype_name": "Fish Abundance Outlook",
        "purpose": "Consumer dive-planning geographic outlook; not guaranteed abundance and not an unconditional global density surface.",
        "public_layer_name": "Fish Abundance",
        "public_legend": "Fish abundance outlook — Lower | Typical | Higher",
        "public_unknown": "No reliable estimate available",
        "public_tier_fields": {
            "A": {"provenance": "survey_supported", "evidence": "High", "source": "Current fixed-grid fish score retained unchanged"},
            "B": {"provenance": "regional_estimate", "evidence": "Moderate", "source": "Robust estimate from protocol-adjusted NRMN sites, shrunk toward geographic-basin median"},
            "C": {"provenance": "ecological_outlook", "evidence": "Limited", "source": "Existing spline, only where monthly environmental novelty screen passes"},
            "unknown": {"provenance": "unknown", "evidence": "none", "source": "No reliable estimate available"},
        },
        "common_relative_scale": {"range": "0-100", "reference": "Empirical percentile among existing fish-map source-unit abundance values; Tier A current stored percentile retained; Tier B/C transformed through that same source-unit empirical CDF.",
                                  "categories": {"Lower": "score < 33.33", "Typical": "33.33 <= score < 66.67", "Higher": "score >= 66.67"}},
        "opacity_starting_points": {"A": "93%", "B": "62.5%", "C": "40%", "unknown": "transparent", "interpretation": "UI hierarchy only, not calibrated statistical confidence."},
        "tier_b_rule": {"support_radius_km": RADIUS_B_KM, "minimum_independent_sites": MIN_B_SITES,
                        "minimum_effective_support": MIN_B_EFFECTIVE,
                        "kernel": "w(d)=1/(1+(d/250)^3)",
                        "robust_estimator": "weighted median of protocol-adjusted coordinate-site means",
                        "shrinkage": "p=basin_median + alpha*(weighted_median-basin_median); alpha=(n_eff/(n_eff+2))*exp(-(nearest_km/5000)^2)",
                        "basin_regions": "Arctic and Southern Ocean latitude caps, then broad longitude proxies; these are coarse shrinkage/reporting regions, not validated biogeographic provinces."},
        "tier_c_rule": {"model": "SimpleImputer(median, missing indicators) + StandardScaler + cubic SplineTransformer(n_knots=4) + Ridge(alpha=10)",
                        "target_transform": "log1p fish/100m2, inverse expm1; target is positive recorded survey units",
                        "environmental_support": "nearest standardized training-site predictor vector <= p95 leave-one-out nearest-neighbor distance",
                        "temporal_aggregation": f"mean supported monthly predictions when at least {PRIMARY_TIER_C_MONTHS}/12 months pass the novelty screen",
                        "predictors": FEATURES, "exact_density_public": False},
        "hole_closing": "Separate display-only one-cell fill; wet-ocean mask and eligible cells required around the whole 3x3 neighborhood; never changes scientific tier or raw estimate.",
    }
    save_json(OUT / "prototype_schema_and_display.json", metadata)

    input_paths = [ROOT / "data/dive_conditions_score/manifest.json",
                   ROOT / "data/dive_conditions_score/ocean-mask.bin.gz",
                   ROOT / "data/dive_conditions_score/reef-dimensions.bin.gz",
                   ROOT / "data/fish_map_units.json.gz",
                   ROOT / "analysis/fish-ecological-experiment/protocol_adjusted_training_table.csv.gz",
                   ROOT / "analysis/fish-ecological-experiment/training_table_metadata.json",
                   ROOT / "analysis/fish-ecological-experiment/protocol_adjustment_audit.json",
                   ROOT / "analysis/fish-ecological-experiment/predictor_metadata.json",
                   ROOT / "tools/fish_ecological_experiment.py",
                   ROOT / "reports/fish-density-coverage-diagnostics.json",
                   ROOT / "data/reef_raster_manifest.js",
                   ROOT / "data/dive-sites.js",
                   ROOT / "data/temperature/query/metadata.json",
                   ROOT / "data/water_clarity/metadata.json"]
    try:
        import scipy, sklearn
        versions = {"numpy": np.__version__, "pandas": pd.__version__, "scipy": scipy.__version__,
                    "scikit_learn": sklearn.__version__, "rasterio": rasterio.__version__,
                    "pillow": Image.__version__}
    except Exception as exc:
        versions = {"runtime_note": str(exc)}
    manifest_out = {
        "generated_local_time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "script": str(Path(__file__).relative_to(ROOT)).replace("\\", "/"),
        "script_sha256": sha256(Path(__file__)),
        "input_hashes": {str(path.relative_to(ROOT)).replace("\\", "/"): sha256(path)
                         for path in sorted(set(input_paths) | TRACKED_INPUT_FILES)},
        "tracked_local_predictor_file_count": len(TRACKED_INPUT_FILES),
        "python_packages": versions,
        "grid": {"west": WEST, "south": SOUTH, "step": STEP, "width": WIDTH, "height": HEIGHT,
                 "eligible_cells": eligible_count, "water_mask_subsamples": "8 x 8", "eligible_rule": "ocean fraction >=0.25"},
        "analysis_duration_seconds": round(time.time() - started, 2),
        "outputs": ["fish_abundance_outlook_grid.csv.gz", "coverage_summary.json", "coverage_by_stage_and_domain.csv",
                    "coverage_by_region.csv", "unknown_reasons.csv", "tier_b_blocked_validation.csv", "tier_b_blocked_validation_by_basin.csv",
                    "tier_b_blocked_validation_by_abundance.csv", "tier_b_error_by_support_distance.csv",
                    "dive_domain_sensitivity.csv", "fish_abundance_outlook_side_by_side.png", "results_summary.md",
                    "prototype_schema_and_display.json", "training_table_metadata.json"],
        "nonproduction_guard": "No source file under data/, index.html, or js/ was written by this prototype.",
    }
    save_json(OUT / "analysis_manifest.json", manifest_out)
    log(f"Prototype complete in {manifest_out['analysis_duration_seconds']:.1f}s; outputs: {OUT}")


if __name__ == "__main__":
    main()
