"""Audit 7 km connectivity flags against the bundled GEBCO 2-arc-minute grid.

This is a read-only diagnostic and never updates production scores. It labels
all GEBCO water pixels as connected components, then reruns support only for
the 11,122 cells flagged by the coarser score-grid connectivity screen.
"""
from __future__ import annotations

import gzip
import json
import math
import os
import tempfile
from collections import Counter
from pathlib import Path

import numpy as np
import rasterio
from scipy import ndimage
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"
GEBCO_DIR = ROOT / "data" / ".build" / "gebco_2026_2min"
SCORE_REPORT = REPORTS / "fish-density-coverage-diagnostics.json"
FISH_SNAPSHOT = ROOT / "data" / "fish_map_units.json.gz"
ROWS, COLS, TILE = 5_400, 21_600, 2_700
STEP = 1 / 30  # GEBCO_2026 two-arc-minute raster derivative
RADIUS_KM, DECAY_KM = 2_500.0, 250.0
MIN_SITES, MIN_EFFECTIVE = 3, 2.5
EARTH_KM = 6371.0088


def haversine_many(lat: float, lng: float, points: np.ndarray) -> np.ndarray:
    dlat = np.radians(points[:, 0] - lat)
    dlng = np.radians(((points[:, 1] - lng + 180) % 360) - 180)
    a = np.sin(dlat / 2) ** 2 + math.cos(math.radians(lat)) * np.cos(np.radians(points[:, 0])) * np.sin(dlng / 2) ** 2
    return EARTH_KM * 2 * np.arctan2(np.sqrt(a), np.sqrt(np.maximum(0, 1 - a)))


def pixel(lat: float, lng: float) -> tuple[int, int]:
    row = max(0, min(ROWS - 1, int((90 - lat) / STEP)))
    col = max(0, min(COLS - 1, int((((lng + 180) % 360) / STEP))))
    return row, col


def components() -> tuple[np.memmap, Path, int, tuple[Path, Path]]:
    temp_root = Path(tempfile.gettempdir())
    water_path = temp_root / "diveatlas_gebco_ocean_mask.tmp"
    labels_path = temp_root / "diveatlas_gebco_ocean_labels.tmp"
    water = np.memmap(water_path, mode="w+", dtype=np.uint8, shape=(ROWS, COLS))
    water[:] = 0
    print("Mosaicking the eight GEBCO 2-minute tiles into a temporary global wet mask.", flush=True)
    for tile_id in range(8):
        p = GEBCO_DIR / f"gebco_2026_{tile_id:02d}.tif"
        with rasterio.open(p) as ds:
            data = ds.read(1)
            north = tile_id >= 4
            ordinal = tile_id % 4
            col_start = {1: 0, 2: TILE, 0: 2 * TILE, 3: 3 * TILE}[ordinal]
            row_start = 0 if north else TILE
            water[row_start:row_start + TILE, col_start:col_start + TILE] = ((data < 0) & (data != ds.nodata)).astype(np.uint8)
    water.flush()
    labels = np.memmap(labels_path, mode="w+", dtype=np.int32, shape=(ROWS, COLS))
    # Four-neighbor connectivity avoids diagonal corner-touching being treated
    # as a navigable marine connection.
    print("Labeling global ocean connectivity on the finer raster; this is the long step.", flush=True)
    count = int(ndimage.label(water, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=np.uint8), output=labels))
    labels.flush()
    return labels, water_path, count, (water_path, labels_path)


def join_seams(labels: np.memmap, count: int) -> np.ndarray:
    parent = np.arange(count + 1, dtype=np.int32)

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = int(parent[x])
        return x

    def union(a: int, b: int) -> None:
        if not a or not b:
            return
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for row in range(ROWS):
        union(int(labels[row, 0]), int(labels[row, COLS - 1]))
    for row in (0, ROWS - 1):
        first = 0
        for value in labels[row, :]:
            v = int(value)
            if v:
                if first:
                    union(first, v)
                else:
                    first = v
    for i in range(1, count + 1):
        parent[i] = find(i)
    return parent


def main() -> None:
    coverage = json.loads(SCORE_REPORT.read_text(encoding="utf-8"))
    flagged = coverage["coarseConnectivityFlaggedCells"]
    if len(flagged) != coverage["supportDiagnostics"]["currentlyCoveredCellsWhoseEuclideanSupportFailsSameComponentCheck"]:
        raise RuntimeError("Flagged-cell payload count does not match the saved coverage diagnostic.")
    with gzip.open(FISH_SNAPSHOT, "rt", encoding="utf-8") as f:
        snapshot = json.load(f)
    grouped: dict[tuple[float, float], list[float]] = {}
    raw_points = []
    for row in snapshot["rows"]:
        lat, lng, value = float(row[0]), ((float(row[1]) + 180) % 360) - 180, float(row[2])
        grouped.setdefault((round(lat, 5), round(lng, 5)), []).append(value)
        raw_points.append((lat, lng, value))
    sites = np.array([[lat, lng, float(np.mean(values))] for (lat, lng), values in grouped.items()], dtype=np.float64)
    site_counts = np.array([len(v) for v in grouped.values()], dtype=np.int32)
    site_coords = sites[:, :2]
    site_xyz = np.column_stack((np.cos(np.radians(site_coords[:, 0])) * np.cos(np.radians(site_coords[:, 1])),
                                np.cos(np.radians(site_coords[:, 0])) * np.sin(np.radians(site_coords[:, 1])),
                                np.sin(np.radians(site_coords[:, 0]))))
    tree = cKDTree(site_xyz)
    chord = 2 * math.sin(RADIUS_KM / EARTH_KM / 2)
    labels, water_path, num_components, temp_paths = components()
    try:
        print(f"Raster labeling complete ({num_components:,} components); joining the dateline and pole seams.", flush=True)
        parent = join_seams(labels, num_components)
        sites[:, 1] = ((sites[:, 1] + 180) % 360) - 180
        site_ids = np.zeros(len(sites), dtype=np.int32)
        site_pixel_land = 0
        for i, (lat, lng, _) in enumerate(sites):
            r, c = pixel(float(lat), float(lng))
            label = int(labels[r, c])
            if label:
                site_ids[i] = parent[label]
            else:
                site_pixel_land += 1

        raw = np.asarray(raw_points, dtype=np.float64)
        raw_xyz = np.column_stack((np.cos(np.radians(raw[:, 0])) * np.cos(np.radians(raw[:, 1])),
                                   np.cos(np.radians(raw[:, 0])) * np.sin(np.radians(raw[:, 1])),
                                   np.sin(np.radians(raw[:, 0]))))
        raw_tree = cKDTree(raw_xyz)
        raw_ids = np.zeros(len(raw), dtype=np.int32)
        for i, (lat, lng, _) in enumerate(raw):
            r, c = pixel(float(lat), float(lng))
            label = int(labels[r, c])
            if label:
                raw_ids[i] = parent[label]

        stats = Counter()
        region = Counter()
        sample_rows = []
        for cell in flagged:
            r, c = pixel(float(cell["lat"]), float(cell["lng"]))
            target_label = int(labels[r, c])
            if not target_label:
                stats["flagged representative is land or GEBCO no-data"] += 1
                region[(cell["region"], "target is not wet at 2-minute pixel")] += 1
                continue
            target_component = int(parent[target_label])
            # Spherical cKDTree query uses unit-vector coordinates.
            lat, lng = float(cell["lat"]), float(cell["lng"])
            xyz = np.array([math.cos(math.radians(lat)) * math.cos(math.radians(lng)),
                            math.cos(math.radians(lat)) * math.sin(math.radians(lng)), math.sin(math.radians(lat))])
            idx = np.asarray(tree.query_ball_point(xyz, chord), dtype=np.int32)
            if idx.size:
                distances = haversine_many(lat, lng, site_coords[idx])
                keep = distances <= RADIUS_KM
                idx, distances = idx[keep], distances[keep]
            else:
                distances = np.empty(0, dtype=np.float64)
            connected = site_ids[idx] == target_component if idx.size else np.zeros(0, dtype=bool)
            conn_ids, conn_d = idx[connected], distances[connected]
            raw_chord = 2 * math.sin(25.0 / EARTH_KM / 2)
            raw_idx = np.asarray(raw_tree.query_ball_point(xyz, raw_chord), dtype=np.int32)
            direct_raw = raw_idx[raw_ids[raw_idx] == target_component]
            if direct_raw.size:
                status = "native GEBCO connected direct observation <=25 km"
            else:
                weights = 1 / (1 + (conn_d / DECAY_KM) ** 3)
                neff = float(weights.sum() ** 2 / np.square(weights).sum()) if weights.size and np.square(weights).sum() else 0.0
                status = "native GEBCO connected weighted support" if len(conn_ids) >= MIN_SITES and neff >= MIN_EFFECTIVE else "no native GEBCO support under current thresholds"
            stats[status] += 1
            region[(cell["region"], status)] += 1
            delta = {"cellIndex": cell["index"], "region": cell["region"], "nativeStatus": status,
                     "coarseScore": cell["score"], "targetComponent": target_component,
                     "euclideanSitesWithin2500km": int(idx.size), "sameComponentSitesWithin2500km": int(conn_ids.size),
                     "nearestEuclideanSourceKm": float(distances.min()) if distances.size else None,
                     "nearestSameComponentSourceKm": float(conn_d.min()) if conn_d.size else None}
            sample_rows.append(delta)
        print("High-resolution connectivity audit complete; writing per-cell results.", flush=True)

        result = {
            "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
            "method": {"bathymetry": "Bundled GEBCO_2026 global 2-arc-minute raster mosaic (15 arc-second source sampled to 2 arc minutes)",
                       "waterRule": "Raster elevation < 0 m; 4-neighbor connected components; wrap at dateline and join wet segments at poles.",
                       "supportRule": "25 km direct observation or same-component survey sites within 2,500 km, min 3 distinct sites and Kish effective count >=2.5, weights 1/(1+(d/250)^3).",
                       "caveat": "A global raster path is higher resolution than the 8x8 score-mask diagnostic but still cannot resolve channels narrower than approximately 3.7 km or uncertainty in the source survey coordinates; not a production authorization."},
            "flaggedCells": len(flagged), "nativeRasterConnectedComponentsBeforeSeamMerge": num_components,
            "surveySitesNotWetAtTheirExactTwoMinutePixel": site_pixel_land,
            "outcomes": dict(stats),
            "regionalOutcomes": [{"region": r, "status": s, "cells": n} for (r, s), n in sorted(region.items())],
            "cells": sample_rows,
        }
        (REPORTS / "fish-connectivity-gebco-audit.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        md = ["# Native-resolution follow-up of the coarse connectivity flags", "",
              f"Generated {result['generatedAt']}. Audited {len(flagged):,} already-scored cells flagged by the 7 km component screen. Production scores were not changed.", "",
              "The follow-up labels water on the bundled GEBCO_2026 two-arc-minute raster (roughly 3.7 km at the equator) using four-neighbor connectivity, then checks whether each source survey coordinate maps to the same connected wet component as the score cell.", "",
              "## Outcomes", "", "| GEBCO component result | Cells |", "|---|---:|"]
        md.extend(f"| {name} | {count:,} |" for name, count in stats.items())
        md += ["", f"Survey sites landing on land/no-data at the exact 2-minute raster pixel: **{site_pixel_land:,} / {len(sites):,}**. Such points are excluded from connected support rather than snapped across a shoreline.", "",
               "## Region × outcome", "", "| Region screen | Result | Cells |", "|---|---|---:|"]
        md.extend(f"| {r} | {s} | {n:,} |" for (r, s), n in sorted(region.items()))
        md += ["", "## Limits", "", result["method"]["caveat"],
               "This is a connectivity audit, not accuracy validation; the separate spatial holdout report evaluates prediction error. A water path can establish that a source is not separated by land at this raster resolution, but the depth grid does not establish ecological exchangeability across ocean basins or reef provinces. A failed path may also reflect unresolved raster coastlines or source-coordinate error.", "",
               "No production score or support-radius setting was changed. See the JSON for per-cell outcomes and support distances.", ""]
        (REPORTS / "fish-connectivity-gebco-audit.md").write_text("\n".join(md), encoding="utf-8")
        print(json.dumps({"cells": len(flagged), "components": num_components, "surveySitesNotWetAtExactPixel": site_pixel_land, "outcomes": dict(stats), "report": "reports/fish-connectivity-gebco-audit.md"}, indent=2))
    finally:
        del labels
        for p in temp_paths:
            try:
                Path(p).unlink()
            except OSError:
                pass


if __name__ == "__main__":
    main()
