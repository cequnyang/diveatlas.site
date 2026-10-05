"""Audit Dive Experience score, evidence confidence, completeness, and render choices.

All outputs remain under analysis/dive-experience-outlook-prototype. The map
inputs are the review-only v3 grids; the old v2 grids are kept as an explicit
visual/scoring baseline. The dive-relevant mask reuses the Fish Outlook study's
documented local reef/shallow-water/site-proximity proxy, not a universal dive
habitat definition.
"""
from __future__ import annotations

import csv
import gzip
import json
import math
import re
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap
from PIL import Image
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "analysis/dive-experience-outlook-prototype"
MAP_DIR = OUT / "generated/map"
BASELINE_DIR = MAP_DIR / "baseline-v2"
WIDTH, HEIGHT, STEP, WEST, SOUTH = 720, 340, 0.5, -180.0, -85.0
CELL_COUNT = WIDTH * HEIGHT
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
SCORE_CATEGORIES = ((85, "Excellent"), (70, "Good"), (55, "Fair"), (0, "Challenging"))
CONFIDENCE_THRESHOLD_DEFAULTS = {"high": 0.75, "moderate": 0.4, "limited": 0.2}
SCORE_BINS = [(low, min(100, low + 9)) for low in range(0, 100, 10)] + [(100, 100)]


def read_asset(path: Path, expected_version: int) -> tuple[int, np.ndarray]:
    raw = gzip.decompress(path.read_bytes())
    version = raw[4]
    if raw[:4] != b"DAEO" or version != expected_version:
        raise ValueError(f"{path.name} has map format {raw[:4]!r} v{version}, expected DAEO v{expected_version}")
    if (int.from_bytes(raw[6:8], "little") != WIDTH or int.from_bytes(raw[8:10], "little") != HEIGHT or
            int.from_bytes(raw[10:12], "little") != int(STEP * 100) or
            int.from_bytes(raw[12:14], "little", signed=True) != int(WEST * 10) or
            int.from_bytes(raw[14:16], "little", signed=True) != int(SOUTH * 10)):
        raise ValueError(f"{path.name} grid geometry differs from the prototype's declared grid")
    expected = 16 + CELL_COUNT * (7 if expected_version == 2 else 10)
    if len(raw) != expected:
        raise ValueError(f"{path.name} has {len(raw)} bytes; expected {expected}")
    return raw[5], np.frombuffer(raw, dtype=np.uint8, offset=16).copy()


def load_v2(month: int) -> dict[str, np.ndarray]:
    decoded_month, data = read_asset(BASELINE_DIR / f"month-{month:02d}.bin.gz", 2)
    if decoded_month != month:
        raise ValueError("Baseline month ID does not match its filename")
    return {
        "score": data[:CELL_COUNT],
        "confidence_code": data[CELL_COUNT:CELL_COUNT * 2],
        "completeness": data[CELL_COUNT * 2:CELL_COUNT * 3],
        "physical_completeness": data[CELL_COUNT * 3:CELL_COUNT * 4],
        "ecological_completeness": data[CELL_COUNT * 4:CELL_COUNT * 5],
        "active_mask": np.frombuffer(data, dtype="<u2", offset=CELL_COUNT * 5).copy(),
    }


def load_v3(month: int) -> dict[str, np.ndarray]:
    decoded_month, data = read_asset(MAP_DIR / f"month-{month:02d}.bin.gz", 3)
    if decoded_month != month:
        raise ValueError("Current month ID does not match its filename")
    return {
        "overall_score": data[:CELL_COUNT],
        "physical_score": data[CELL_COUNT:CELL_COUNT * 2],
        "overall_confidence": data[CELL_COUNT * 2:CELL_COUNT * 3].astype(np.float32) / 255,
        "physical_confidence": data[CELL_COUNT * 3:CELL_COUNT * 4].astype(np.float32) / 255,
        "ecological_confidence": data[CELL_COUNT * 4:CELL_COUNT * 5].astype(np.float32) / 255,
        "completeness": data[CELL_COUNT * 5:CELL_COUNT * 6],
        "physical_completeness": data[CELL_COUNT * 6:CELL_COUNT * 7],
        "ecological_completeness": data[CELL_COUNT * 7:CELL_COUNT * 8],
        "active_mask": np.frombuffer(data, dtype="<u2", offset=CELL_COUNT * 8).copy(),
    }


def load_fish_tiers() -> np.ndarray:
    tiers = np.full(CELL_COUNT, "none", dtype="U7")
    path = ROOT / "analysis/fish-abundance-outlook-prototype/fish_abundance_outlook_grid.csv.gz"
    with gzip.open(path, "rt", encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            cell = int(row["cell_index"])
            if 0 <= cell < CELL_COUNT:
                tiers[cell] = row["tier"] if row["tier"] in ("A", "B", "C") else "none"
    return tiers


def load_masks():
    mask_raw = gzip.decompress((ROOT / "data/dive_conditions_score/ocean-mask.bin.gz").read_bytes())
    if mask_raw[:4] != b"DAOM" or mask_raw[4] != 1:
        raise ValueError("The current ocean mask does not match the Fish Outlook domain analysis input")
    wet_bytes = np.frombuffer(mask_raw, dtype=np.uint8, offset=16).reshape(CELL_COUNT, 8)
    wet = np.zeros((CELL_COUNT, 8, 8), dtype=bool)
    for subrow in range(8):
        for subcol in range(8):
            wet[:, subrow, subcol] = (wet_bytes[:, subrow] & (1 << subcol)) != 0
    wet_count = wet.sum(axis=(1, 2)).astype(np.uint8)
    eligible_indices = np.flatnonzero(wet_count >= 16)
    rows, columns = eligible_indices // WIDTH, eligible_indices % WIDTH
    cell_lat, cell_lon = SOUTH + (rows + .5) * STEP, WEST + (columns + .5) * STEP
    rep_lat, rep_lon = np.full(len(eligible_indices), np.nan), np.full(len(eligible_indices), np.nan)
    best = np.full(len(eligible_indices), np.inf)
    for subrow in range(8):
        sub_lat = SOUTH + rows * STEP + (subrow + .5) * STEP / 8
        for subcol in range(8):
            selected = (wet_bytes[eligible_indices, subrow] & (1 << subcol)) != 0
            sub_lon = WEST + columns * STEP + (subcol + .5) * STEP / 8
            distance2 = (sub_lat - cell_lat) ** 2 + ((sub_lon - cell_lon) * np.cos(np.radians(cell_lat))) ** 2
            replace = selected & (distance2 < best)
            rep_lat[replace], rep_lon[replace], best[replace] = sub_lat[replace], sub_lon[replace], distance2[replace]
    if np.isnan(rep_lat).any():
        raise ValueError("An eligible ocean cell has no wet representative subcell")

    # Recompute the study's three-way dive-domain proxy from the same local
    # 4-arc-minute depth samples, z7 reef tiles, and current site coordinate file.
    # Chunking by subrow keeps the 8x8 wet subcell expansion bounded in memory.
    elevation = np.full((2700, 5400), 32767, dtype=np.int16)
    for tile_y in range(12):
        for tile_x in range(24):
            path = ROOT / "data/depth_samples" / str(tile_y) / f"{tile_x}.bin.gz"
            values = np.frombuffer(gzip.decompress(path.read_bytes()), dtype="<i2").reshape(225, 225)
            elevation[tile_y * 225:(tile_y + 1) * 225, tile_x * 225:(tile_x + 1) * 225] = values
    shallow_counts = np.zeros(len(eligible_indices), dtype=np.uint8)
    reef_present = np.zeros(len(eligible_indices), dtype=bool)
    reef_tile_cache: dict[int, np.ndarray | None] = {}
    for subrow in range(8):
        cell_positions, subcols = np.nonzero(wet[eligible_indices, subrow, :])
        cell_ids = eligible_indices[cell_positions]
        lat = SOUTH + (cell_ids // WIDTH) * STEP + (subrow + .5) * STEP / 8
        lon = WEST + (cell_ids % WIDTH) * STEP + (subcols + .5) * STEP / 8
        depth_rows = np.clip(np.floor((90 - lat) * 15).astype(int), 0, 2699)
        depth_cols = np.mod(np.floor((lon + 180) * 15).astype(int), 5400)
        sampled = elevation[depth_rows, depth_cols]
        shallow_counts += np.bincount(cell_positions, weights=((sampled < 0) & (sampled > -12000) & (-sampled <= 40)),
                                       minlength=len(eligible_indices)).astype(np.uint8)

        world = 128 * 256.0
        x_float = ((lon + 180) / 360) * world
        lat_clip = np.clip(lat, -85.05112878, 85.05112878)
        y_float = (1 - np.arcsinh(np.tan(np.radians(lat_clip))) / math.pi) / 2 * world
        tile_xs = np.floor(x_float / 256).astype(int).clip(0, 127)
        tile_ys = np.floor(y_float / 256).astype(int).clip(0, 127)
        pixel_xs = np.floor(x_float).astype(int) % 256
        pixel_ys = np.floor(y_float).astype(int) % 256
        tile_codes = tile_ys * 128 + tile_xs
        order = np.argsort(tile_codes, kind="mergesort")
        sorted_codes = tile_codes[order]
        unique_codes, starts = np.unique(sorted_codes, return_index=True)
        ends = np.r_[starts[1:], len(order)]
        for code, start, end in zip(unique_codes, starts, ends):
            chosen = order[start:end]
            tile_x, tile_y = int(code % 128), int(code // 128)
            if code not in reef_tile_cache:
                path = ROOT / "data/reef_tiles/7" / str(tile_x) / f"{tile_y}.png"
                if path.exists():
                    with Image.open(path) as image:
                        reef_tile_cache[code] = np.asarray(image.convert("RGBA"))[:, :, 3]
                else:
                    reef_tile_cache[code] = None
            alpha = reef_tile_cache[code]
            if alpha is None:
                continue
            present = alpha[pixel_ys[chosen], pixel_xs[chosen]] > 0
            if present.any():
                reef_present[np.unique(cell_positions[chosen[present]])] = True
    shallow_fraction = shallow_counts / wet_count[eligible_indices]

    site_text = (ROOT / "data/dive-sites.js").read_text(encoding="utf-8")
    match = re.search(r"window\.DIVE_SITES_DATA\s*=\s*(\[.*?\])\s*;", site_text, flags=re.S)
    if not match:
        raise ValueError("Could not parse the current DiveAtlas site coordinates")
    site_rows = json.loads(match.group(1))
    sites = []
    for row in site_rows:
        try:
            site_lat, site_lon = float(row[1]), (float(row[2]) + 180) % 360 - 180
        except (ValueError, TypeError, IndexError):
            continue
        if np.isfinite(site_lat) and np.isfinite(site_lon) and -90 <= site_lat <= 90:
            sites.append((site_lat, site_lon))
    sites = np.unique(np.asarray(sites, dtype=float), axis=0)

    def sphere(latlon):
        lat_rad = np.radians(latlon[:, 0]); lon_rad = np.radians((latlon[:, 1] + 180) % 360 - 180)
        cosine = np.cos(lat_rad)
        return np.column_stack((cosine * np.cos(lon_rad), cosine * np.sin(lon_rad), np.sin(lat_rad)))

    distance_chord = cKDTree(sphere(sites)).query(sphere(np.column_stack((rep_lat, rep_lon))), k=1, workers=-1)[0]
    nearest_site_km = 2 * 6371.0088 * np.arcsin(np.minimum(1.0, distance_chord / 2))
    dive_domain = reef_present | (shallow_fraction >= .25) | (nearest_site_km <= 50)
    eligible_grid = np.zeros(CELL_COUNT, dtype=bool)
    eligible_grid[eligible_indices] = True
    dive_grid = np.zeros(CELL_COUNT, dtype=bool)
    dive_grid[eligible_indices] = dive_domain
    region = np.full(CELL_COUNT, "outside eligible ocean", dtype="U24")
    def basin_name(lat, lon):
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
    region[eligible_indices] = [basin_name(float(lat), float(lon)) for lat, lon in zip(rep_lat, rep_lon)]
    wet_fraction = wet_count.astype(np.float32) / 64
    return eligible_grid, dive_grid, region, wet_fraction, eligible_indices


def category(score: int) -> str:
    if score == 255:
        return "Unavailable"
    for threshold, label in SCORE_CATEGORIES:
        if score >= threshold:
            return label
    raise AssertionError("All numeric scores fall into a category")


def summarize_scores(values: np.ndarray, eligible_count: int) -> dict:
    n = int(len(values))
    if not n:
        return {"n_scored": 0, "n_eligible": int(eligible_count), "coverage_pct": 0.0,
                **{f"p{p}": None for p in (5, 10, 25, 50, 75, 90, 95)},
                **{f"fraction_{name.lower()}": None for name in ("Excellent", "Good", "Fair", "Challenging")}}
    values_i = values.astype(np.int16)
    labels = np.asarray([category(int(value)) for value in values_i])
    result = {"n_scored": n, "n_eligible": int(eligible_count), "coverage_pct": round(100 * n / eligible_count, 3) if eligible_count else 0.0}
    result.update({f"p{p}": round(float(np.percentile(values_i, p)), 2) for p in (5, 10, 25, 50, 75, 90, 95)})
    result.update({f"fraction_{name.lower()}": round(float(np.mean(labels == name)), 5) for name in ("Excellent", "Good", "Fair", "Challenging")})
    return result


def quantile_record(values: np.ndarray) -> dict:
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]
    if not len(values):
        return {"n": 0, "mean": None, "median": None, "p10": None, "p25": None, "p75": None, "p90": None, "minimum": None, "maximum": None}
    qs = np.percentile(values, [10, 25, 50, 75, 90])
    return {"n": int(len(values)), "mean": round(float(np.mean(values)), 4), "median": round(float(qs[2]), 4),
            "p10": round(float(qs[0]), 4), "p25": round(float(qs[1]), 4), "p75": round(float(qs[3]), 4),
            "p90": round(float(qs[4]), 4), "minimum": round(float(np.min(values)), 4), "maximum": round(float(np.max(values)), 4)}


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields = list(dict.fromkeys(key for row in rows for key in row.keys()))
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def confidence_name(value: float, thresholds: dict) -> str:
    if value >= thresholds["high"]:
        return "High"
    if value >= thresholds["moderate"]:
        return "Moderate"
    if value >= thresholds["limited"]:
        return "Limited"
    return "Low"


def band(values: np.ndarray) -> np.ndarray:
    return np.select([values < 25, values < 50, values < 75], ["0-24", "25-49", "50-74"], default="75-100")


def provenance_signature(mask: int, ids: list[str], fish_tier: str) -> str:
    bit_by_id = {name: 1 << index for index, name in enumerate(ids)}
    physical_ids = ["waterClarity", "current", "waveHeight", "waterTemperature"]
    physical_n = sum(bool(mask & bit_by_id[name]) for name in physical_ids)
    fish = "Tier " + fish_tier if fish_tier in ("A", "B", "C") else "no supported NRMN tier"
    thermal = "NOAA heat history present" if mask & bit_by_id["thermalStressHistory"] else "NOAA heat history absent"
    return f"monthly climatology/model conditions {physical_n}/4; {fish}; {thermal}"


def score_audit(maps, baseline, eligible, dive_domain, regions):
    distribution_rows, histogram_rows, coverage_rows = [], [], []
    categories = ("Excellent", "Good", "Fair", "Challenging")
    region_names = ["All regions", "Arctic proxy", "Atlantic proxy", "Indian proxy", "Pacific proxy", "Southern Ocean proxy"]
    domains = [("global eligible ocean", eligible), ("dive-relevant proxy", dive_domain)]
    for month, current in enumerate(maps, 1):
        old = baseline[month - 1]
        old_score = old["score"]
        current_score = current["overall_score"]
        scored_old, scored_new = old_score != 255, current_score != 255
        if not np.array_equal(old_score, current_score):
            mismatch = int(np.sum(old_score != current_score))
            raise AssertionError(f"Confidence/fallback calibration changed overall score at {mismatch} cells in month {month}")
        coverage_rows.append({
            "month": month, "month_name": MONTHS[month - 1], "eligible_ocean_cells": int(eligible.sum()),
            "overall_scored_cells": int(np.sum(scored_new & eligible)), "overall_coverage_pct": round(100 * np.sum(scored_new & eligible) / eligible.sum(), 3),
            "dive_relevant_cells": int(dive_domain.sum()), "dive_relevant_overall_scored_cells": int(np.sum(scored_new & dive_domain)),
            "dive_relevant_overall_coverage_pct": round(100 * np.sum(scored_new & dive_domain) / max(1, dive_domain.sum()), 3),
            "dive_conditions_cells": int(np.sum((current["physical_score"] != 255) & eligible)),
            "dive_conditions_coverage_pct": round(100 * np.sum((current["physical_score"] != 255) & eligible) / eligible.sum(), 3),
            "physical_only_fallback_cells": int(np.sum((current["physical_score"] != 255) & ~scored_new & eligible)),
            "mean_score_completeness_pct": round(float(np.mean(current["completeness"][eligible])), 2),
            "mean_physical_completeness_pct": round(float(np.mean(current["physical_completeness"][eligible])), 2),
            "mean_ecological_completeness_pct": round(float(np.mean(current["ecological_completeness"][eligible])), 2),
            "legacy_confidence_high_cells": int(np.sum((old["confidence_code"] == 4) & scored_old & eligible)),
            "new_confidence_high_cells": None,
        })
        for domain_name, domain_mask in domains:
            for region_name in region_names:
                mask = domain_mask.copy()
                if region_name != "All regions":
                    mask &= regions == region_name
                values = current_score[mask & scored_new]
                summary = summarize_scores(values, int(np.sum(mask)))
                row = {"month": month, "month_name": MONTHS[month - 1], "analysis_domain": domain_name, "region_proxy": region_name, **summary}
                distribution_rows.append(row)
                for lo, hi in SCORE_BINS:
                    count = int(np.sum((values >= lo) & (values <= hi)))
                    histogram_rows.append({"month": month, "month_name": MONTHS[month - 1], "analysis_domain": domain_name,
                                           "region_proxy": region_name, "score_bin": f"{lo}-{hi}", "count": count,
                                           "percent_of_scored": round(count / max(1, len(values)), 5)})
        eligible_count = int(eligible.sum())
        new_confidence = current["overall_confidence"]
        new_high = int(np.sum((new_confidence >= CONFIDENCE_THRESHOLD_DEFAULTS["high"]) & scored_new & eligible))
        coverage_rows[-1]["new_confidence_high_cells"] = new_high
    write_csv(OUT / "score_distribution_by_month.csv", distribution_rows)
    write_csv(OUT / "score_histogram_by_month.csv", histogram_rows)
    write_csv(OUT / "monthly_coverage_and_completeness.csv", coverage_rows)
    return distribution_rows, histogram_rows, coverage_rows


def confidence_audit(maps, eligible, regions, dive_domain, fish_tiers, scoring_config):
    thresholds = scoring_config.get("confidenceThresholds", CONFIDENCE_THRESHOLD_DEFAULTS)
    dimension_ids = [d["id"] for d in scoring_config["dimensions"] if d.get("isScoreDimension")]
    ecological_bits = (1 << dimension_ids.index("fishDensity")) | (1 << dimension_ids.index("thermalStressHistory")) | \
        (1 << dimension_ids.index("liveCoralCover")) | (1 << dimension_ids.index("observedBleaching")) | (1 << dimension_ids.index("macroalgaeCover"))
    records = {scope: {key: [] for key in ("value", "completeness", "physical_completeness", "ecological_completeness", "tier", "region", "signature", "domain")}
               for scope in ("overall", "physical", "ecological")}
    for data in maps:
        mask = data["active_mask"]
        overall_mask = (data["overall_score"] != 255) & eligible
        physical_mask = (data["physical_score"] != 255) & eligible
        ecological_mask = ((mask & ecological_bits) != 0) & eligible
        month_signature = np.asarray([provenance_signature(int(value), dimension_ids, fish_tiers[index])
                                      for index, value in enumerate(mask)], dtype="U96")
        for scope, selected, value_key, completeness_key in (
            ("overall", overall_mask, "overall_confidence", "completeness"),
            ("physical", physical_mask, "physical_confidence", "physical_completeness"),
            ("ecological", ecological_mask, "ecological_confidence", "ecological_completeness"),
        ):
            r = records[scope]
            r["value"].append(data[value_key][selected])
            r["completeness"].append(data[completeness_key][selected].astype(np.float32))
            r["physical_completeness"].append(data["physical_completeness"][selected].astype(np.float32))
            r["ecological_completeness"].append(data["ecological_completeness"][selected].astype(np.float32))
            r["tier"].append(fish_tiers[selected])
            r["region"].append(regions[selected])
            r["signature"].append(month_signature[selected])
            r["domain"].append(dive_domain[selected])

    conf_rows, group_rows, category_rows = [], [], []
    for scope, blocks in records.items():
        arrays = {key: np.concatenate(parts) for key, parts in blocks.items()}
        conf = arrays["value"]
        all_summary = quantile_record(conf)
        cats = {name: int(np.sum(np.asarray([confidence_name(float(value), thresholds) for value in conf]) == name))
                for name in ("High", "Moderate", "Limited", "Low")}
        conf_rows.append({"scope": scope, "grouping": "all supported cells × months", **all_summary,
                          **{f"{name.lower()}_cells": count for name, count in cats.items()},
                          **{f"{name.lower()}_fraction": round(count / max(1, len(conf)), 5) for name, count in cats.items()}})
        factors = [
            ("Fish tier", "tier", ["A", "B", "C", "none"]),
            ("Region proxy", "region", ["Arctic proxy", "Atlantic proxy", "Indian proxy", "Pacific proxy", "Southern Ocean proxy"]),
            ("Source-provenance combination", "signature", sorted(np.unique(arrays["signature"]).tolist())),
            ("Scope completeness", "completeness", ["0-24", "25-49", "50-74", "75-100"]),
            ("Physical group completeness", "physical_completeness", ["0-24", "25-49", "50-74", "75-100"]),
            ("Ecological group completeness", "ecological_completeness", ["0-24", "25-49", "50-74", "75-100"]),
            ("Geographic analysis domain", "domain", [False, True]),
        ]
        for factor_name, field, values in factors:
            column = band(arrays[field]) if "completeness" in field else arrays[field]
            for value in values:
                selected = column == value
                summary = quantile_record(conf[selected])
                if not summary["n"]:
                    continue
                conf_rows.append({"scope": scope, "grouping": f"{factor_name}: {value if field != 'domain' else ('dive-relevant proxy' if value else 'global remainder')}", **summary})
                if factor_name == "Scope completeness":
                    group_rows.append({"scope": scope, "dimension": factor_name, "band": value, **summary})
                elif factor_name in ("Physical group completeness", "Ecological group completeness"):
                    group_rows.append({"scope": scope, "dimension": factor_name, "band": value, **summary})
        for name, threshold in (("candidate_high", thresholds["high"]), ("diagnostic_high_060", 0.60),
                                ("candidate_moderate", thresholds["moderate"]),
                                ("candidate_limited", thresholds["limited"])):
            category_rows.append({"scope": scope, "cutoff": name, "minimum_confidence_value": threshold,
                                  "fraction_at_or_above": round(float(np.mean(conf >= threshold)), 5),
                                  "cells_at_or_above": int(np.sum(conf >= threshold)), "total_cells": int(len(conf))})
    write_csv(OUT / "confidence_distribution_analysis.csv", conf_rows)
    write_csv(OUT / "confidence_by_group_completeness.csv", group_rows)
    write_csv(OUT / "confidence_threshold_diagnostic.csv", category_rows)
    return records, conf_rows, group_rows, category_rows, thresholds


def average_ranks(values: np.ndarray) -> np.ndarray:
    order = np.argsort(values, kind="mergesort")
    sorted_values = values[order]
    ranks = np.empty(len(values), dtype=float)
    start = 0
    while start < len(values):
        stop = start + 1
        while stop < len(values) and sorted_values[stop] == sorted_values[start]:
            stop += 1
        ranks[order[start:stop]] = (start + 1 + stop) / 2
        start = stop
    return ranks


def future_sensitivity_audit():
    source = OUT / "synthetic_realistic_reef_sensitivity.csv"
    if not source.exists():
        return []
    with source.open("r", newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    summaries = []
    for scenario in sorted({row["scenario_id"] for row in rows}):
        cases = [row for row in rows if row["scenario_id"] == scenario]
        deltas = np.asarray([float(row["score_delta"]) for row in cases if row["score_delta"]], dtype=float)
        confidence_deltas = np.asarray([float(row["future_confidence_value"]) - float(row["current_confidence_value"])
                                        for row in cases if row["future_confidence_value"] and row["current_confidence_value"]], dtype=float)
        completeness_deltas = np.asarray([float(row["future_completeness_pct"]) - float(row["current_completeness_pct"])
                                          for row in cases], dtype=float)
        rank_correlations, reversals = [], 0
        for month in range(1, 13):
            paired = [row for row in cases if int(row["month"]) == month and row["current_score"] and row["future_score"]]
            if len(paired) < 2:
                continue
            before = np.asarray([float(row["current_score"]) for row in paired])
            after = np.asarray([float(row["future_score"]) for row in paired])
            before_ranks, after_ranks = average_ranks(before), average_ranks(after)
            corr = float(np.corrcoef(before_ranks, after_ranks)[0, 1]) if len(paired) > 1 else float("nan")
            if np.isfinite(corr):
                rank_correlations.append(corr)
            for left in range(len(paired)):
                for right in range(left + 1, len(paired)):
                    old_diff = before[left] - before[right]
                    new_diff = after[left] - after[right]
                    if old_diff * new_diff < 0:
                        reversals += 1
        summaries.append({
            "scenario_id": scenario, "scenario_label": cases[0]["scenario_label"],
            "synthetic_dimensions_available": cases[0]["synthetic_dimensions_available"],
            "n_location_months": len(cases), "n_currently_scored_pairs": len(deltas),
            "newly_scored_location_months": sum(row["newly_scored"] == "true" for row in cases),
            "mean_score_delta": round(float(np.mean(deltas)), 2) if len(deltas) else None,
            "median_score_delta": round(float(np.median(deltas)), 2) if len(deltas) else None,
            "min_score_delta": float(np.min(deltas)) if len(deltas) else None,
            "max_score_delta": float(np.max(deltas)) if len(deltas) else None,
            "label_changed_location_months": sum(row["label_changed"] == "true" for row in cases),
            "mean_confidence_value_delta": round(float(np.mean(confidence_deltas)), 4) if len(confidence_deltas) else None,
            "mean_completeness_point_change": round(float(np.mean(completeness_deltas)), 2) if len(completeness_deltas) else None,
            "mean_within_month_spearman_rank_correlation": round(float(np.mean(rank_correlations)), 4) if rank_correlations else None,
            "within_month_rank_reversals": reversals,
            "note": "Scores are synthetic dimension score combinations only; rank comparison uses currently scored shared sites."
        })
    write_csv(OUT / "synthetic_future_sensitivity_summary.csv", summaries)
    return summaries


def score_rgba(score, quality, completeness, wet_fraction, palette, alpha_curve, legacy_confidence=None):
    score = np.asarray(score)
    quality = np.asarray(quality, dtype=float)
    completeness = np.asarray(completeness, dtype=float) / 100
    wet_fraction = np.asarray(wet_fraction, dtype=float)
    colors = palette(np.clip(score, 0, 100) / 100)[..., :3]
    if alpha_curve == "legacy completeness fade":
        old_opacity = np.choose(np.clip(legacy_confidence.astype(int), 0, 4), [0, .32, .5, .72, .92])
        alpha = old_opacity * completeness
    elif alpha_curve == "confidence only":
        alpha = .32 + .68 * quality
    elif alpha_curve == "balanced candidate":
        alpha = (.62 + .38 * quality) * (.90 + .10 * completeness)
    elif alpha_curve == "strong completeness fade":
        alpha = (.32 + .68 * quality) * completeness
    else:
        raise ValueError(alpha_curve)
    alpha = np.where(score == 255, 0, alpha * wet_fraction)
    land = np.array([240, 238, 229], dtype=float) / 255
    ocean = np.array([220, 233, 236], dtype=float) / 255
    base = land[None, :] * (1 - wet_fraction[:, None]) + ocean[None, :] * wet_fraction[:, None]
    composite = colors * alpha[:, None] + base * (1 - alpha[:, None])
    return np.clip(composite.reshape(HEIGHT, WIDTH, 3), 0, 1)


def render_comparisons(october, eligible, wet_fraction, baseline, output_mode="overall"):
    views = [
        ("World", (-180, 180, -60, 80)),
        ("Coral Triangle · regional", (110, 160, -15, 15)),
        ("Great Barrier Reef · destination", (143, 154, -24, -12)),
    ]
    palette_items = [("RdYlGn", "Red–amber–green"), ("viridis", "Viridis"), ("cividis", "Cividis")]
    zoom_titles = ["World view", "Regional view", "Dive-destination zoom"]
    count = CELL_COUNT
    score_key = "overall_score" if output_mode == "overall" else "physical_score"
    quality_key = "overall_confidence" if output_mode == "overall" else "physical_confidence"
    completeness_key = "completeness" if output_mode == "overall" else "physical_completeness"
    score = october[score_key]
    quality = october[quality_key]
    comp = october[completeness_key]
    old_code = baseline[9]["confidence_code"]
    land = np.array([240, 238, 229], dtype=float) / 255
    ocean = np.array([220, 233, 236], dtype=float) / 255
    eligible_grid = eligible.reshape(HEIGHT, WIDTH)
    rgba_base = land[None, None, :] * (1 - wet_fraction.reshape(HEIGHT, WIDTH, 1)) + ocean[None, None, :] * wet_fraction.reshape(HEIGHT, WIDTH, 1)

    def paint(ax, rgb, extent, title):
        combined = rgba_base.copy()
        score_present = score != 255
        combined[score_present.reshape(HEIGHT, WIDTH)] = rgb[score_present.reshape(HEIGHT, WIDTH)]
        ax.imshow(combined, extent=(-180, 180, -85, 85), origin="lower", interpolation="nearest", aspect="auto")
        ax.set_xlim(extent[0], extent[1]); ax.set_ylim(extent[2], extent[3])
        ax.set_xticks(np.linspace(extent[0], extent[1], 4)); ax.set_yticks(np.linspace(extent[2], extent[3], 4))
        ax.grid(color="#667780", alpha=.22, linewidth=.5)
        ax.tick_params(labelsize=7)
        ax.set_title(title, fontsize=10, loc="left", pad=7)

    fig, axes = plt.subplots(3, 3, figsize=(15, 9), constrained_layout=True)
    for row, (palette_name, palette_label) in enumerate(palette_items):
        cmap = plt.get_cmap(palette_name)
        rgb = score_rgba(score, quality, comp, wet_fraction, cmap, "balanced candidate")
        for col, (view_title, extent) in enumerate(views):
            paint(axes[row, col], rgb, extent, f"{palette_label} · {view_title}")
    fig.suptitle(f"Palette comparison · October {output_mode.replace('_', ' ')} · balanced opacity candidate", fontsize=15, fontweight="bold")
    fig.savefig(OUT / "map_palette_zoom_comparison.png", dpi=170, facecolor="white")
    plt.close(fig)

    alpha_items = ["legacy completeness fade", "confidence only", "balanced candidate"]
    cmap = plt.get_cmap("RdYlGn")
    fig, axes = plt.subplots(3, 3, figsize=(15, 9), constrained_layout=True)
    for row, curve in enumerate(alpha_items):
        rgb = score_rgba(score, quality, comp, wet_fraction, cmap, curve, old_code)
        for col, (view_title, extent) in enumerate(views):
            paint(axes[row, col], rgb, extent, f"{curve.title()} · {view_title}")
    fig.suptitle(f"Opacity comparison · October {output_mode.replace('_', ' ')} · same score colors", fontsize=15, fontweight="bold")
    fig.savefig(OUT / "map_opacity_zoom_comparison.png", dpi=170, facecolor="white")
    plt.close(fig)

    # The fourth row isolates a deliberately stronger completeness fade to show
    # how it affects the same score field without changing score hue.
    alpha_items = ["confidence only", "balanced candidate", "strong completeness fade"]
    fig, axes = plt.subplots(3, 3, figsize=(15, 9), constrained_layout=True)
    for row, curve in enumerate(alpha_items):
        rgb = score_rgba(score, quality, comp, wet_fraction, cmap, curve, old_code)
        for col, (view_title, extent) in enumerate(views):
            paint(axes[row, col], rgb, extent, f"{curve.title()} · {view_title}")
    fig.suptitle("Separating confidence from completeness opacity · October", fontsize=15, fontweight="bold")
    fig.savefig(OUT / "map_completeness_effect_comparison.png", dpi=170, facecolor="white")
    plt.close(fig)


def write_calibration_report(distribution_rows, coverage_rows, confidence_rows, threshold_rows, thresholds, future_rows, alpha_rows, eligible_count, dive_count):
    global_rows = {(row["month"], row["analysis_domain"]): row for row in distribution_rows
                   if row["region_proxy"] == "All regions"}
    header = [
        "# Dive Experience Outlook calibration results", "",
        "This is an analysis-only review. Production scores, data, and visuals were not edited. The score grid was compared cell by cell with the saved v2 baseline across all twelve months.", "",
        "## Score distribution and monthly coverage", "",
        f"The eligible 0.5° ocean grid contains **{eligible_count:,}** cells. The dive-relevant sensitivity mask contains **{dive_count:,}** cells using the Fish Outlook proxy (reef hit, shallow-water fraction, or site within 50 km); it is not a definitive worldwide dive-area boundary.", "",
        "Existing score labels use Excellent ≥85, Good ≥70, Fair ≥55, and Challenging <55. The tables below show observed distribution rather than selecting thresholds to make class sizes equal.", "",
        "| Month | Global scored coverage | Dive-domain coverage | Global p10 / p50 / p90 | Global labels E / G / F / C | Dive-domain labels E / G / F / C |", "|---|---:|---:|---:|---:|---:|"
    ]
    for coverage in coverage_rows:
        month = coverage["month"]
        global_row = global_rows[(month, "global eligible ocean")]
        dive_row = global_rows[(month, "dive-relevant proxy")]
        score_q = f"{global_row['p10']:.0f} / {global_row['p50']:.0f} / {global_row['p90']:.0f}"
        global_mix = "/".join(f"{100*global_row[f'fraction_{name}']:.0f}%" for name in ("excellent", "good", "fair", "challenging"))
        domain_mix = "/".join(f"{100*dive_row[f'fraction_{name}']:.0f}%" for name in ("excellent", "good", "fair", "challenging"))
        header.append(f"| {MONTHS[month - 1]} | {coverage['overall_coverage_pct']:.1f}% | {coverage['dive_relevant_overall_coverage_pct']:.1f}% | {score_q} | {global_mix} | {domain_mix} |")
    header += [
        "", "`score_distribution_by_month.csv` and `score_histogram_by_month.csv` contain all 12 months, six basin proxies, global eligible ocean, and dive-relevant domain. They include p5/p10/p25/p50/p75/p90/p95, 0–100 histogram counts, category fractions, and sample sizes.", "",
        "### Representative locations (October)", ""
    ]
    sample_path = OUT / "validation_samples.json"
    if sample_path.exists():
        sample_data = json.loads(sample_path.read_text(encoding="utf-8"))
        header += ["| Location | Overall outlook | Dive conditions fallback | Confidence | Completeness |", "|---|---|---|---|---|"]
        for site in sample_data["locations"]:
            result = next(item for item in site["monthly"] if item["month"] == 10)
            overall = "Unavailable" if result["score"] is None else f"{result['score']} / {result['label']}"
            physical = "Unavailable" if result["diveConditionsScore"] is None else f"{result['diveConditionsScore']} / {result['diveConditionsLabel']}"
            header.append(f"| {site['label']} | {overall} | {physical} | {result['confidence']} ({result['confidenceValue']:.3f}) | {result['completenessText']} |")
    scope_summaries = {row["scope"]: row for row in confidence_rows if row.get("grouping") == "all supported cells × months"}
    confidence_groups = {(row["scope"], row["grouping"]): row for row in confidence_rows}
    overall_thresholds = {row["cutoff"]: row for row in threshold_rows if row["scope"] == "overall"}
    current_high_share = overall_thresholds.get("candidate_high", {}).get("fraction_at_or_above", 0)
    diagnostic_high_share = overall_thresholds.get("diagnostic_high_060", {}).get("fraction_at_or_above", 0)
    tier_a = confidence_groups.get(("overall", "Fish tier: A"), {})
    tier_b = confidence_groups.get(("overall", "Fish tier: B"), {})
    eco_tier_a = confidence_groups.get(("ecological", "Fish tier: A"), {})
    eco_tier_b = confidence_groups.get(("ecological", "Fish tier: B"), {})
    header += [
        "", "## Confidence: quality is separate from completeness", "",
        "The previous value multiplied evidence quality by group completeness before assigning a category. That made coverage gaps suppress confidence even when the evidence behind available dimensions was unchanged. The current index removes completeness and normalizes over groups with supported evidence; an unavailable overall outlook still has no combined score.", "",
        f"Confidence remains a heuristic strength index, not a probability. Current cutoffs are High ≥{thresholds['high']:.2f}, Moderate ≥{thresholds['moderate']:.2f}, Limited ≥{thresholds['limited']:.2f}, Low below the Limited cutoff. The observed overall index ranges from {scope_summaries.get('overall', {}).get('minimum', 0):.3f} to {scope_summaries.get('overall', {}).get('maximum', 0):.3f}; {100*current_high_share:.1f}% reaches the current High cutoff. A diagnostic cutoff of 0.60 would classify {100*diagnostic_high_share:.1f}% as High, but distribution alone does not validate that boundary, so no revised cutoffs are recommended.",
        f"The compression reflects evidence inputs rather than completeness: physical confidence averages {scope_summaries.get('physical', {}).get('mean', 0):.3f}, while ecological confidence averages {scope_summaries.get('ecological', {}).get('mean', 0):.3f}; the ecological-outlook provenance has a lower source-strength factor. Overall Tier A vs Tier B means are {tier_a.get('mean', 0):.3f} vs {tier_b.get('mean', 0):.3f}, and ecological Tier A vs Tier B means are {eco_tier_a.get('mean', 0):.3f} vs {eco_tier_b.get('mean', 0):.3f}. Completeness remains a separate output.", "",
        "| Scope | n cell-months | Mean | Median | p10 / p90 | High / Moderate / Limited / Low |", "|---|---:|---:|---:|---:|---:|"
    ]
    for scope in ("overall", "physical", "ecological"):
        item = scope_summaries.get(scope, {})
        n = item.get("n", 0)
        shares = "/".join(f"{100*item.get(f'{name.lower()}_fraction', 0):.1f}%" for name in ("High", "Moderate", "Limited", "Low"))
        header.append(f"| {scope.title()} | {n:,} | {item.get('mean', '—')} | {item.get('median', '—')} | {item.get('p10', '—')} / {item.get('p90', '—')} | {shares} |")
    header += [
        "", "Confidence breakdowns by NRMN Tier A/B, provenance combination, completeness band, physical/ecological completeness, basin proxy, and dive-domain membership are in `confidence_distribution_analysis.csv`. `confidence_legacy_vs_evidence_only.csv` compares old categories and new evidence-only values cell by cell. The new index changes confidence semantics, not the overall score: v2 and v3 overall scores/missing cells matched exactly in every month.", "",
        "### Completeness wording", "",
        "Use `Confidence: Moderate` and `X of 9 scoring dimensions available` as the primary concise copy. Keep a percentage in technical detail only if a later user test shows it helps. Confidence and completeness should not be merged into one badge or one probability-like value.", "",
        "## Physical-only fallback", "",
        "Keep `Overall outlook: unavailable` when the ecological group has no support. Separately show `Dive Conditions: <label>` only when at least 3 of 4 physical dimensions are available (40 of 58 group points); keep `Reef experience: insufficient data`. In combined map mode such cells stay transparent. An explicit Dive Conditions-only map can render the fallback with the same restrained opacity curve and its own label/legend.", "",
        "| Month | Overall coverage | Dive Conditions coverage | Physical-only fallback cells |", "|---|---:|---:|---:|"
    ]
    for coverage in coverage_rows:
        header.append(f"| {MONTHS[coverage['month']-1]} | {coverage['overall_coverage_pct']:.1f}% | {coverage['dive_conditions_coverage_pct']:.1f}% | {coverage['physical_only_fallback_cells']:,} |")
    header += [
        "", "## Label calibration", "",
        "Keep the existing score cut points as provisional while evaluating the distribution: Excellent ≥85, Good 70–84, Fair 55–69, Challenging <55. The global, basin, dive-domain, and representative-location counts show differentiation, but the score dimensions are product heuristics with no representative diver-reported experience labels. Therefore the numbers do not yet establish that an 85 feels Excellent or that a 55 feels Challenging. Do not move cut points based only on map proportions; calibrate them with a structured diver study before consumer release.", "",
        "## Future ecological-dimension sensitivity", "",
        "Future reef dimensions were enabled only in synthetic score tests. The inputs are directional score combinations (not measurements), with full and partial availability and separate assumed evidence quality.", "",
        "| Scenario | Dimensions available | Paired currently scored | Newly scored | Mean / median score delta | Label changes | Mean rank correlation | Rank reversals |", "|---|---|---:|---:|---:|---:|---:|---:|"
    ]
    for item in future_rows:
        rho = "—" if item["mean_within_month_spearman_rank_correlation"] is None else f"{item['mean_within_month_spearman_rank_correlation']:.2f}"
        header.append(f"| {item['scenario_label']} | {item['synthetic_dimensions_available'].replace('|', ', ')} | {item['n_currently_scored_pairs']} | {item['newly_scored_location_months']} | {item['mean_score_delta']} / {item['median_score_delta']} | {item['label_changed_location_months']} | {rho} | {item['within_month_rank_reversals']} |")
    header += [
        "", "Per-location/month score, label, confidence, and completeness changes are in `synthetic_realistic_reef_sensitivity.csv`; scenario assumptions are in `future_dimension_scenarios.json`. Current pending dimensions remain null in the ordinary location results.", "",
        "## Map rendering", "",
        "The candidate map opacity is `alpha = (0.62 + 0.38 × evidenceQuality) × (0.90 + 0.10 × completeness)`. This preserves visible score color while limiting completeness's effect to 10%. The old confidence-tier × completeness reference fades much more strongly; confidence-only preserves full score saturation but omits a small availability cue. See `map_opacity_curve_diagnostics.csv`.",
        "Of the tested palettes, red–amber–green is the clearest consumer-facing low-to-high cue, but its continuous ramp compresses much of the observed 50–85 score range into yellow/green at world scale. Viridis distinguishes that range more strongly but is less self-explanatory as good-to-challenging; cividis is more muted in these map views. Keep red–amber–green as the provisional choice and show score/label ticks at 55, 70, and 85; palette meaning remains provisional with the score labels.", "",
        "![Score palette comparison at world, Coral Triangle, and Great Barrier Reef scales](map_palette_zoom_comparison.png)", "",
        "![Opacity-curve comparison at world, regional, and destination scales](map_opacity_zoom_comparison.png)", "",
        "![Completeness fade comparison](map_completeness_effect_comparison.png)", "",
        "The map prototype also lets reviewers switch between the overall and physical-only views and choose a palette/opacity curve. Comparison screenshots use October so all treatments show the same scores.", "",
        "## Recommendation", "",
        "**B. one more calibration iteration needed.** The confidence/completeness separation, fallback semantics, and candidate rendering are testable and the score did not drift. The 98-point model and pending-dimension architecture can remain. Do not integrate yet: map-label semantics and numeric thresholds still lack a representative diver-experience calibration set, and NRMN fish evidence is conditional on positive recorded survey units.", "",
        "### Current numeric recommendations", "",
        "- Keep score cut points provisional at 85 / 70 / 55; do not claim the labels are validated recreational-experience categories.",
        "- Keep confidence cut points provisional at 0.75 / 0.40 / 0.20. Do not lower High to force nonzero High coverage; the 0.60 diagnostic appears in `confidence_threshold_diagnostic.csv`.",
        "- Show completeness as `X of 9 scoring dimensions available`, not as a percentage in the primary presentation.",
        "- Do not produce an overall score without ecological support; show the separate Dive Conditions fallback only with ≥3 physical dimensions.",
        "- Use the balanced candidate opacity above for further review; keep hue as the primary map signal."
    ]
    (OUT / "calibration_results.md").write_text("\n".join(header) + "\n", encoding="utf-8")


def main():
    current_manifest = json.loads((MAP_DIR / "manifest.json").read_text(encoding="utf-8"))
    baseline_manifest = json.loads((BASELINE_DIR / "manifest.json").read_text(encoding="utf-8"))
    if current_manifest.get("version") != 3 or baseline_manifest.get("version") != 2:
        raise ValueError("Generate all twelve analysis-only v3 grids and preserve the v2 baseline before running this audit")
    eligible, dive_domain, regions, wet_fraction, eligible_indices = load_masks()
    fish_tiers = load_fish_tiers()
    maps = [load_v3(month) for month in range(1, 13)]
    baseline = [load_v2(month) for month in range(1, 13)]
    distribution_rows, histogram_rows, coverage_rows = score_audit(maps, baseline, eligible, dive_domain, regions)
    records, confidence_rows, completeness_rows, threshold_rows, thresholds = confidence_audit(
        maps, eligible, regions, dive_domain, fish_tiers, current_manifest["scoring"])
    future_summaries = future_sensitivity_audit()

    # Compare original categories against the updated evidence-only confidence index.
    baseline_map = baseline_manifest.get("months", [])
    for month, data in enumerate(maps, 1):
        old_row = next((row for row in baseline_map if row.get("month") == month), {})
        old_code = baseline[month - 1]["confidence_code"]
        scored = data["overall_score"] != 255
        old_counts = {"High": int(np.sum((old_code == 4) & scored & eligible)),
                      "Moderate": int(np.sum((old_code == 3) & scored & eligible)),
                      "Limited": int(np.sum((old_code == 2) & scored & eligible)),
                      "Low": int(np.sum((old_code == 1) & scored & eligible))}
        current_conf = data["overall_confidence"]
        new_counts = {name: int(np.sum(np.fromiter((confidence_name(float(v), thresholds) == name for v in current_conf), bool, count=CELL_COUNT) & scored & eligible))
                      for name in ("High", "Moderate", "Limited", "Low")}
        if old_row.get("confidenceCounts") and any(int(old_row["confidenceCounts"].get(key, 0)) != old_counts[key]
                                                   for key in old_counts):
            raise AssertionError(f"Could not reconcile v2 confidence counts for month {month}: computed {old_counts}, manifest {old_row['confidenceCounts']}")
        coverage_rows[month - 1].update({f"legacy_confidence_{key.lower()}_cells": val for key, val in old_counts.items()})
        coverage_rows[month - 1].update({f"evidence_only_confidence_{key.lower()}_cells": val for key, val in new_counts.items()})
    write_csv(OUT / "monthly_coverage_and_completeness.csv", coverage_rows)

    # Score-only legacy and current output are expected to match cell-for-cell;
    # report confidence semantics separately rather than disguising score drift.
    comparison_rows = []
    for month, (new, old) in enumerate(zip(maps, baseline), 1):
        mask = eligible & (new["overall_score"] != 255)
        for region in ["All regions", "Arctic proxy", "Atlantic proxy", "Indian proxy", "Pacific proxy", "Southern Ocean proxy"]:
            local = mask if region == "All regions" else mask & (regions == region)
            for domain_name, domain_mask in (("global eligible ocean", eligible), ("dive-relevant proxy", dive_domain)):
                local_domain = local & domain_mask
                scored = new["overall_score"][local_domain]
                current_q = new["overall_confidence"][local_domain & (new["overall_score"] != 255)]
                phys_q = new["physical_confidence"][local_domain & (new["physical_score"] != 255)]
                old_code = old["confidence_code"][local_domain & (old["score"] != 255)]
                comparison_rows.append({"month": month, "month_name": MONTHS[month - 1], "region_proxy": region,
                    "analysis_domain": domain_name, "n_overall_scored": len(scored),
                    "score_values_identical_to_v2": True,
                    "mean_overall_confidence_value": round(float(np.mean(current_q)), 4) if len(current_q) else None,
                    "mean_physical_confidence_value": round(float(np.mean(phys_q)), 4) if len(phys_q) else None,
                    "legacy_high_fraction": round(float(np.mean(old_code == 4)), 5) if len(old_code) else None,
                    "legacy_moderate_fraction": round(float(np.mean(old_code == 3)), 5) if len(old_code) else None,
                    "legacy_limited_fraction": round(float(np.mean(old_code == 2)), 5) if len(old_code) else None,
                    "legacy_low_fraction": round(float(np.mean(old_code == 1)), 5) if len(old_code) else None,
                    "evidence_only_high_fraction": round(float(np.mean(current_q >= thresholds["high"])), 5) if len(current_q) else None,
                    "evidence_only_moderate_fraction": round(float(np.mean((current_q >= thresholds["moderate"]) & (current_q < thresholds["high"]))), 5) if len(current_q) else None,
                    "evidence_only_limited_fraction": round(float(np.mean((current_q >= thresholds["limited"]) & (current_q < thresholds["moderate"]))), 5) if len(current_q) else None,
                    "evidence_only_low_fraction": round(float(np.mean(current_q < thresholds["limited"])), 5) if len(current_q) else None})
    write_csv(OUT / "confidence_legacy_vs_evidence_only.csv", comparison_rows)

    # Alpha summary measures the mapped cells' average visual assertiveness.
    alpha_rows = []
    for month, (data, old) in enumerate(zip(maps, baseline), 1):
        scored = eligible & (data["overall_score"] != 255)
        q, comp = data["overall_confidence"], data["completeness"].astype(float) / 100
        old_alpha = np.choose(np.clip(old["confidence_code"].astype(int), 0, 4), [0, .32, .5, .72, .92]) * comp
        curves = {"legacy confidence-tier × completeness": old_alpha,
                  "confidence only": .32 + .68 * q,
                  "balanced candidate": (.62 + .38 * q) * (.90 + .10 * comp),
                  "strong completeness fade": (.32 + .68 * q) * comp}
        for name, values in curves.items():
            selected = values[scored]
            alpha_rows.append({"month": month, "month_name": MONTHS[month - 1], "opacity_curve": name,
                               "scored_cells": len(selected), "mean_alpha": round(float(np.mean(selected)), 4),
                               "median_alpha": round(float(np.median(selected)), 4), "p10_alpha": round(float(np.percentile(selected, 10)), 4),
                               "p90_alpha": round(float(np.percentile(selected, 90)), 4),
                               "fraction_alpha_below_0_5": round(float(np.mean(selected < .5)), 5)})
    write_csv(OUT / "map_opacity_curve_diagnostics.csv", alpha_rows)

    render_comparisons(maps[9], eligible, wet_fraction, baseline, "overall")
    render_comparisons(maps[9], eligible, wet_fraction, baseline, "physical")
    score_conf = {"overall": {}, "physical": {}, "ecological": {}}
    for month, data in enumerate(maps, 1):
        for name, score_key, conf_key in (("overall", "overall_score", "overall_confidence"),
                                          ("physical", "physical_score", "physical_confidence"),
                                          ("ecological", None, "ecological_confidence")):
            if name == "ecological":
                ids = [d["id"] for d in current_manifest["scoring"]["dimensions"] if d.get("isScoreDimension")]
                bits = sum(1 << ids.index(dim) for dim in ("fishDensity", "thermalStressHistory", "liveCoralCover", "observedBleaching", "macroalgaeCover"))
                scope = ((data["active_mask"] & bits) != 0) & eligible
            else:
                scope = (data[score_key] != 255) & eligible
            vals = data[conf_key][scope]
            score_conf[name][month] = quantile_record(vals)

    summary = {
        "generatedFrom": "analysis-only Dive Experience prototype v3 grids",
        "mapScoreComparison": "Overall scores and missing cells matched the v2 baseline exactly for all 12 months; the v3 change separates confidence from completeness and adds a conditions-only field.",
        "eligibleOceanCells": int(eligible.sum()), "diveRelevantProxyCells": int(dive_domain.sum()),
        "diveRelevantDomainDefinition": "Mapped reef pixel at any wet 8x8 subcell OR at least 25% of wet subcells at depth <=40m OR nearest DiveAtlas site <=50km. This is an analysis proxy, not an authoritative global dive-site boundary.",
        "regionalDefinition": "Same five coarse basin proxies used by the Fish Abundance Outlook analysis; not ecoregions.",
        "confidenceDefinition": "Evidence quality among supported groups only, group-weighted by configured 58/40 influence then normalized among groups with evidence. Completeness is excluded and reported separately. Confidence is not a probability.",
        "confidenceThresholds": thresholds,
        "scoreLabelThresholds": {"excellent_min": 85, "good_min": 70, "fair_min": 55, "challenging_max_exclusive": 55},
        "physicalOnlyFallback": current_manifest["scoring"].get("physicalFallback"),
        "monthlyCoverage": coverage_rows,
        "confidenceDistributionByScope": score_conf,
        "opacitySummary": alpha_rows,
        "futureSyntheticDimensionSensitivity": future_summaries,
        "renderingRecommendation": "The alpha=(0.62+0.38*evidenceQuality)*(0.90+0.10*completeness) curve preserves score hue as the main signal and makes completeness a small secondary cue. Inspect the palette and zoom comparison screenshots before production.",
        "limitations": [
            "The 0–100 dimension scores and qualitative labels are not calibrated against a representative diver-experience survey.",
            "Confidence is a deterministic evidence-quality index built from heuristic provenance/evidence/support factors, not a probability or empirically calibrated coverage interval.",
            "Fish abundance remains conditional on positive recorded NRMN survey units; it is not unconditional density.",
            "The fish dive-relevant mask is a sensitivity proxy, including proximity to the current DiveAtlas site list and a 40 m shallow-water rule.",
            "Future live coral, bleaching, and macroalgae dimensions remain synthetic sensitivity inputs only."
        ]
    }
    (OUT / "calibration_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    write_calibration_report(distribution_rows, coverage_rows, confidence_rows, threshold_rows, thresholds,
                             future_summaries, alpha_rows, int(eligible.sum()), int(dive_domain.sum()))
    print(f"Eligible ocean cells: {eligible.sum():,}; dive-relevant proxy cells: {dive_domain.sum():,}")
    for row in coverage_rows:
        print(f"{row['month_name']}: overall {row['overall_coverage_pct']:.1f}% ({row['overall_scored_cells']:,}); conditions {row['dive_conditions_coverage_pct']:.1f}%")
    print("Wrote score/confidence CSVs, monthly coverage, and world/regional/destination map comparisons.")


if __name__ == "__main__":
    main()
