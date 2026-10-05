"""Read-only NRMN connectivity scenarios for held-out sites and eligible cells."""
from __future__ import annotations

import gzip
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import analyze_fish_connectivity_gebco as gebco  # noqa: E402

REPORTS = ROOT / "reports"
FISH = ROOT / "data" / "fish_map_units.json.gz"
CELL_BIN = REPORTS / "fish-density-eligible-cells.bin.gz"
RADIUS_KM = [25, 100, 250, 500, 750, 1000, 1500, 2500]
BLOCK_KM = [100, 250, 500, 750, 1000]
DISTANCE_BANDS = [(0, 25), (25, 50), (50, 100), (100, 250), (250, 500), (500, 1000),
                  (1000, 1500), (1500, 2000), (2000, 2500), (2500, math.inf)]
EARTH_KM = 6371.0088


def norm_lng(x):
    return ((x + 180) % 360) - 180


def xyz(points):
    lat, lng = np.radians(points[:, 0]), np.radians(points[:, 1])
    return np.column_stack((np.cos(lat) * np.cos(lng), np.cos(lat) * np.sin(lng), np.sin(lat)))


def haversine(lat, lng, points):
    dlat = np.radians(points[:, 0] - lat)
    dlng = np.radians(((points[:, 1] - lng + 180) % 360) - 180)
    a = np.sin(dlat / 2) ** 2 + math.cos(math.radians(lat)) * np.cos(np.radians(points[:, 0])) * np.sin(dlng / 2) ** 2
    return EARTH_KM * 2 * np.arctan2(np.sqrt(a), np.sqrt(np.maximum(0, 1 - a)))


def label_ids(labels, parent, coords):
    result = np.zeros(len(coords), dtype=np.int32)
    for i, (lat, lng) in enumerate(coords):
        row, col = gebco.pixel(float(lat), float(lng))
        label = int(labels[row, col])
        if label:
            result[i] = parent[label]
    return result


def block_id(point, size):
    lat_step = size / 110.574
    row = math.floor((float(point[0]) + 90) / lat_step)
    mid_lat = -90 + (row + 0.5) * lat_step
    lon_step = min(360.0, size / max(0.5, 111.32 * math.cos(math.radians(mid_lat))))
    col = math.floor((norm_lng(float(point[1])) + 180) / lon_step)
    return row, col


def metrics(rows, total, eligible_targets=None):
    n = len(rows)
    if not n:
        return {"predictedSites": 0, "coverageAllSitesPercent": 0.0, "coverageWetTargetsPercent": None,
                "medianAbsoluteLogError": None, "p90AbsoluteLogError": None, "mae": None, "rmse": None,
                "bias": None, "spearman": None, "medianNearestSupportKm": None, "p90NearestSupportKm": None}
    actual = np.asarray([r["actual"] for r in rows]); pred = np.asarray([r["pred"] for r in rows])
    err = pred - actual
    ae = np.abs(err)
    ale = np.abs(np.log1p(np.maximum(0, pred)) - np.log1p(np.maximum(0, actual)))
    nearest = np.asarray([r["nearestKm"] for r in rows])
    def average_ranks(values):
        order = np.argsort(values, kind="mergesort")
        ranks = np.empty(len(values), dtype=np.float64)
        start = 0
        while start < len(order):
            end = start + 1
            while end < len(order) and values[order[end]] == values[order[start]]:
                end += 1
            ranks[order[start:end]] = (start + end - 1) / 2 + 1
            start = end
        return ranks
    corr = float(np.corrcoef(average_ranks(pred), average_ranks(actual))[0, 1]) if n >= 3 else None
    return {"predictedSites": n, "coverageAllSitesPercent": 100 * n / total,
            "coverageWetTargetsPercent": 100 * n / eligible_targets if eligible_targets else None,
            "medianAbsoluteLogError": float(np.median(ale)), "p90AbsoluteLogError": float(np.percentile(ale, 90)),
            "mae": float(ae.mean()), "rmse": float(np.sqrt(np.mean(err * err))), "bias": float(err.mean()),
            "spearman": corr, "medianNearestSupportKm": float(np.median(nearest)),
            "p90NearestSupportKm": float(np.percentile(nearest, 90))}


def estimate(candidates, radius, weighted):
    keep = candidates[1] <= radius
    ids, dist = candidates[0][keep], candidates[1][keep]
    if not len(ids):
        return None
    direct = np.flatnonzero(dist <= 25)
    if len(direct):
        j = direct[int(np.argmin(dist[direct]))]
        return float(SITE_VALUES[ids[j]]), float(dist[j])
    if len(ids) < 3:
        return None
    if not weighted:
        return float(np.mean(SITE_VALUES[ids])), float(np.min(dist))
    w = 1 / (1 + (dist / 250) ** 3)
    neff = float(w.sum() ** 2 / np.square(w).sum())
    if neff < 2.5:
        return None
    return float(np.dot(w, SITE_VALUES[ids]) / w.sum()), float(np.min(dist))


def region_for(lat, lng):
    if 5 <= lat <= 30 and -100 <= lng <= -55: return "Caribbean"
    if 12 <= lat <= 30 and 32 <= lng <= 44: return "Red Sea"
    if 30 <= lat <= 46 and -6 <= lng <= 36: return "Mediterranean"
    if -25 <= lat <= -10 and 142 <= lng <= 154: return "Great Barrier Reef / Australia"
    poly = [(95, -12), (130, -12), (141, -6), (141, 20), (120, 20), (95, 10)]
    inside = False
    for i, (xi, yi) in enumerate(poly):
        xj, yj = poly[i - 1]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
    if inside: return "Coral Triangle / Southeast Asia"
    if -35 <= lat <= 16 and 30 <= lng <= 52: return "East Africa"
    if -35 <= lat <= 25 and 45 <= lng <= 100: return "Indian Ocean"
    if -30 <= lat <= 30 and (lng >= 140 or lng <= -100): return "Pacific Islands"
    if -50 <= lat <= 50 and -60 <= lng <= 20: return "Atlantic islands"
    return "Other"


def main():
    global SITE_VALUES
    coverage = json.loads((REPORTS / "fish-density-coverage-diagnostics.json").read_text(encoding="utf-8"))
    with gzip.open(FISH, "rt", encoding="utf-8") as f:
        snapshot = json.load(f)
    grouped = defaultdict(list)
    raw_coords, raw_values = [], []
    for row in snapshot["rows"]:
        lat, lng, value = float(row[0]), norm_lng(float(row[1])), float(row[2])
        grouped[(round(lat, 5), round(lng, 5))].append(value)
        raw_coords.append((lat, lng)); raw_values.append(value)
    sites = np.asarray([[lat, lng] for lat, lng in grouped], dtype=np.float64)
    SITE_VALUES = np.asarray([np.mean(grouped[key]) for key in grouped], dtype=np.float64)
    raw_coords = np.asarray(raw_coords, dtype=np.float64)
    raw_values = np.asarray(raw_values, dtype=np.float64)
    site_tree, raw_tree = cKDTree(xyz(sites)), cKDTree(xyz(raw_coords))
    labels, _, component_count, temp_paths = gebco.components()
    try:
        parent = gebco.join_seams(labels, component_count)
        site_comp = label_ids(labels, parent, sites)
        # Build a coordinate->site map once; the rows are already grouped on that exact rounding.
        site_lookup = {key: i for i, key in enumerate(grouped)}
        raw_comp = np.asarray([site_comp[site_lookup[(round(a, 5), round(b, 5))]] for a, b in raw_coords], dtype=np.int32)
        sites_with_region = [region_for(float(p[0]), float(p[1])) for p in sites]
        wet_targets = np.flatnonzero(site_comp > 0)
        chord = 2 * math.sin(2500 / EARTH_KM / 2)
        cv = {name: {r: [] for r in RADIUS_KM} for name in ("A Euclidean cubic", "B connected unweighted", "C connected cubic")}
        buffered_cv = {size: {name: {r: [] for r in RADIUS_KM} for name in cv} for size in BLOCK_KM}
        block_ids = {size: [block_id(p, size) for p in sites] for size in BLOCK_KM}
        for i, point in enumerate(sites):
            target_comp = int(site_comp[i])
            xyz_point = xyz(point.reshape(1, 2))[0]
            ids = np.asarray(site_tree.query_ball_point(xyz_point, chord), dtype=np.int32)
            ids = ids[ids != i]
            d = haversine(float(point[0]), float(point[1]), sites[ids]) if len(ids) else np.empty(0)
            in_radius = d <= 2500
            ids, d = ids[in_radius], d[in_radius]
            comp_ok = (site_comp[ids] == target_comp) if target_comp else np.zeros(len(ids), dtype=bool)
            for radius in RADIUS_KM:
                a = estimate((ids, d), radius, True)
                b = estimate((ids[comp_ok], d[comp_ok]), radius, False) if target_comp else None
                c = estimate((ids[comp_ok], d[comp_ok]), radius, True) if target_comp else None
                for name, pred in (("A Euclidean cubic", a), ("B connected unweighted", b), ("C connected cubic", c)):
                    if pred:
                        cv[name][radius].append({"actual": SITE_VALUES[i], "pred": pred[0], "nearestKm": pred[1]})
                for size in BLOCK_KM:
                    same_block = np.asarray([block_ids[size][j] == block_ids[size][i] for j in ids], dtype=bool)
                    purge = (d >= size / 2) & ~same_block
                    block_ids_near = ids[purge]
                    block_d = d[purge]
                    block_connected = (site_comp[block_ids_near] == target_comp) if target_comp else np.zeros(len(block_ids_near), dtype=bool)
                    ba = estimate((block_ids_near, block_d), radius, True)
                    bb = estimate((block_ids_near[block_connected], block_d[block_connected]), radius, False) if target_comp else None
                    bc = estimate((block_ids_near[block_connected], block_d[block_connected]), radius, True) if target_comp else None
                    for name, pred in (("A Euclidean cubic", ba), ("B connected unweighted", bb), ("C connected cubic", bc)):
                        if pred:
                            buffered_cv[size][name][radius].append({"actual": SITE_VALUES[i], "pred": pred[0], "nearestKm": pred[1]})

        eligible_dtype = np.dtype([("lat", "<f8"), ("lng", "<f8"), ("hasFish", "u1")])
        cells = np.frombuffer(gzip.open(CELL_BIN, "rb").read(), dtype=eligible_dtype)
        if len(cells) != 166560:
            raise RuntimeError(f"Expected 166,560 eligible-cell rows, found {len(cells)}")
        grid = {name: {r: Counter() for r in RADIUS_KM} for name in ("B connected unweighted", "C connected cubic")}
        region_grid = defaultdict(lambda: defaultdict(lambda: defaultdict(Counter)))
        for cell in cells:
            lat, lng, current = float(cell["lat"]), float(cell["lng"]), bool(cell["hasFish"])
            row, col = gebco.pixel(lat, lng)
            label = int(labels[row, col])
            target_comp = int(parent[label]) if label else 0
            region = region_for(lat, lng)
            xyz_point = xyz(np.asarray([[lat, lng]]))[0]
            if target_comp:
                ids = np.asarray(site_tree.query_ball_point(xyz_point, chord), dtype=np.int32)
                d = haversine(lat, lng, sites[ids]) if len(ids) else np.empty(0)
                take = (d <= 2500) & (site_comp[ids] == target_comp)
                conn_ids, conn_d = ids[take], d[take]
                raw_chord = 2 * math.sin(25 / EARTH_KM / 2)
                rid = np.asarray(raw_tree.query_ball_point(xyz_point, raw_chord), dtype=np.int32)
                raw_d = haversine(lat, lng, raw_coords[rid]) if len(rid) else np.empty(0)
                direct_connected = bool(len(rid) and np.any((raw_comp[rid] == target_comp) & (raw_d <= 25)))
            else:
                conn_ids, conn_d, direct_connected = np.empty(0, dtype=np.int32), np.empty(0), False
            for radius in RADIUS_KM:
                subset = conn_d <= radius
                ids_r, d_r = conn_ids[subset], conn_d[subset]
                b_support = direct_connected or len(ids_r) >= 3
                weights = 1 / (1 + (d_r / 250) ** 3) if len(d_r) else np.empty(0)
                neff = float(weights.sum() ** 2 / np.square(weights).sum()) if len(weights) and np.square(weights).sum() else 0.0
                c_support = direct_connected or (len(ids_r) >= 3 and neff >= 2.5)
                for name, supported in (("B connected unweighted", b_support), ("C connected cubic", c_support)):
                    rec = grid[name][radius]
                    rec["supported"] += int(supported)
                    rec["currentCoveredRetained"] += int(current and supported)
                    rec["currentCoveredLost"] += int(current and not supported)
                    rec["currentMissingRecovered"] += int((not current) and supported)
                    reg_rec = region_grid[region][name][radius]
                    reg_rec["eligible"] += 1
                    reg_rec["supported"] += int(supported)
                    reg_rec["currentCoveredLost"] += int(current and not supported)
                    reg_rec["currentMissingRecovered"] += int((not current) and supported)
        flagged_report = json.loads((REPORTS / "fish-connectivity-gebco-audit.json").read_text(encoding="utf-8"))
        unsupported = [c for c in flagged_report["cells"] if c["nativeStatus"] == "no native GEBCO support under current thresholds"]
        by_region = defaultdict(list)
        for c in unsupported: by_region[c["region"]].append(c)
        examples = []
        suspect_class = Counter()
        for region, group in sorted(by_region.items()):
            group.sort(key=lambda c: (c["nearestEuclideanSourceKm"] is None, c["nearestEuclideanSourceKm"] or math.inf, c["cellIndex"]))
            picks = sorted(set([group[0]["cellIndex"], group[len(group)//2]["cellIndex"], group[-1]["cellIndex"]]))
            for cell_id in picks:
                c = next(x for x in group if x["cellIndex"] == cell_id)
                # Coarse flags store lat/lng in the coverage report for reproducibility.
                flag = next(x for x in coverage["coarseConnectivityFlaggedCells"] if x["index"] == cell_id)
                lat, lng = float(flag["lat"]), float(flag["lng"])
                row, col = gebco.pixel(lat, lng); label = int(labels[row, col]); target_component = int(parent[label]) if label else 0
                target_xyz = xyz(np.asarray([[lat, lng]]))[0]
                ids = np.asarray(site_tree.query_ball_point(target_xyz, chord), dtype=np.int32)
                d = haversine(lat, lng, sites[ids]) if len(ids) else np.empty(0)
                order = np.argsort(d)[:3]
                nearest = [{"lat": float(sites[ids[j], 0]), "lng": float(sites[ids[j], 1]), "distanceKm": float(d[j]),
                            "sameConnectedComponent": bool(target_component and site_comp[ids[j]] == target_component),
                            "sourceComponentAssigned": bool(site_comp[ids[j]] > 0), "densityFishPer100m2": float(SITE_VALUES[ids[j]])} for j in order]
                same = int(np.sum(site_comp[ids] == target_component)) if target_component else 0
                if not same: category = "no survey coordinate in target GEBCO component"
                elif same < 3: category = "some connected sources but fewer than three sites"
                else: category = "three or more connected sources but effective support below 2.5"
                suspect_class[category] += 1
                examples.append({"region": region, "target": {"lat": lat, "lng": lng}, "coarseScore": c["coarseScore"],
                                 "targetComponentAssigned": bool(target_component), "nearestEuclideanSources": nearest,
                                 "sameComponentSiteCountWithin2500Km": same, "sampleClassification": category})
        result = {"generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
                  "scope": "Read-only connectivity scenarios; no production score/radius changes.",
                  "method": {"grid": "GEBCO 2026 2-arc-minute elevation<0, four-neighbor components; targets/sources use exact pixels without coast snapping.",
                             "A": "Current-style cubic distance weighting and 3-site/effective>=2.5 support, without water-component filtering.",
                             "B": "Same-component Euclidean radius only; equal-weight mean and >=3 connected sites after the local <=25 km direct shortcut.",
                             "C": "Same-component filtering with the existing cubic distance weighting, 3-site/effective>=2.5 support, and local <=25 km direct shortcut.",
                             "validation": "Exact coordinate sites are grouped and held out as one; connected CV excludes targets/sites whose exact GEBCO 2-minute pixel is land/no-data.",
                             "limitations": "This raster misses sub-3.7 km channels and has coordinate/coastline uncertainty; same connected component is not ecological interchangeability."},
                  "eligibleCells": len(cells), "currentEuclideanCoverageCells": coverage["source"]["fishSupportedCells"],
                  "currentEuclideanCoveragePercent": coverage["source"]["coveragePercent"],
                  "wetSurveyTargetSites": len(wet_targets), "allSurveySites": len(sites),
                  "crossValidation": {scheme: {str(r): metrics(cv[scheme][r], len(sites), len(wet_targets) if scheme != "A Euclidean cubic" else None) for r in RADIUS_KM} for scheme in cv},
                  "bufferedSpatialBlockCrossValidation": {str(size): {scheme: {str(r): metrics(buffered_cv[size][scheme][r], len(sites), len(wet_targets) if scheme != "A Euclidean cubic" else None) for r in RADIUS_KM} for scheme in cv} for size in BLOCK_KM},
                  "gridCoverage": {scheme: {str(r): {**dict(grid[scheme][r]), "coveragePercent": 100*grid[scheme][r]["supported"]/len(cells)} for r in RADIUS_KM} for scheme in grid},
                  "gridRegionalCoverage": {region: {scheme: {str(r): {**dict(region_grid[region][scheme][r]),
                        "coveragePercent": 100*region_grid[region][scheme][r]["supported"]/region_grid[region][scheme][r]["eligible"]}
                        for r in RADIUS_KM if region_grid[region][scheme][r]["eligible"]} for scheme in grid} for region in sorted(region_grid)},
                  "suspectCells": {"flagged": len(flagged_report["cells"]), "insufficientConnectedSupport": len(unsupported),
                                   "sampleClassificationCounts": dict(suspect_class), "representativeExamples": examples}}
        (REPORTS / "fish-connectivity-support-validation.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        lines = ["# NRMN connectivity support validation", "", f"Generated {result['generatedAt']}. Diagnostic only; production values unchanged.", "",
                 "## Scenario comparison", "", "A uses cubic Euclidean weights without connectivity. B requires same GEBCO component but uses an equal-weight average. C filters to the same component and applies the existing cubic weights and effective-source gate.", "",
                 "### Holdout prediction", "", "| Scenario | Radius | Predicted sites | Coverage of all sites | Median abs log error | p90 abs log error | MAE | Bias | Spearman | Median / p90 nearest source km |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
        for name in cv:
            for r in RADIUS_KM:
                x = result["crossValidation"][name][str(r)]
                f = lambda v: "n/a" if v is None else f"{v:.2f}"
                lines.append(f"| {name} | {r} | {x['predictedSites']} | {x['coverageAllSitesPercent']:.1f}% | {f(x['medianAbsoluteLogError'])} | {f(x['p90AbsoluteLogError'])} | {f(x['mae'])} | {f(x['bias'])} | {f(x['spearman'])} | {f(x['medianNearestSupportKm'])} / {f(x['p90NearestSupportKm'])} |")
        lines += ["", "## Connectivity-aware buffered spatial holdouts", "", "Each target excludes its entire approximate equal-distance block and also purges training sites within half that block size. A is Euclidean cubic-weighted support; B uses only same-component support with equal weights; C uses same-component sources with cubic weights and the current effective-support gate. Connected scenarios omit targets whose native raster pixel is dry/no-data.", "", "| Block km | Scenario | Radius | Predicted sites | Coverage all sites | Median abs log error | p90 abs log error | MAE | Bias | Spearman | Median / p90 nearest support km |", "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
        for size in BLOCK_KM:
            for name in cv:
                for r in RADIUS_KM:
                    x = result["bufferedSpatialBlockCrossValidation"][str(size)][name][str(r)]
                    f = lambda v: "n/a" if v is None else f"{v:.2f}"
                    lines.append(f"| {size} | {name} | {r} | {x['predictedSites']} | {x['coverageAllSitesPercent']:.1f}% | {f(x['medianAbsoluteLogError'])} | {f(x['p90AbsoluteLogError'])} | {f(x['mae'])} | {f(x['bias'])} | {f(x['spearman'])} | {f(x['medianNearestSupportKm'])} / {f(x['p90NearestSupportKm'])} |")
        lines += ["", "### Eligible-grid coverage at the current 2,500 km radius", "", "| Scenario | Supported cells | Coverage | Current supported retained | Current supported lost | Previously missing recovered |", "|---|---:|---:|---:|---:|---:|"]
        for name in grid:
            x = result["gridCoverage"][name]["2500"]
            lines.append(f"| {name} | {x['supported']:,} | {x['coveragePercent']:.1f}% | {x['currentCoveredRetained']:,} | {x['currentCoveredLost']:,} | {x['currentMissingRecovered']:,} |")
        lines += ["", "## Regional island and coast screen", "", "The following regional figures use the approximate non-overlapping screening windows, not official marine provinces.", "", "| Region | B coverage | B lost / recovered | C coverage | C lost / recovered |", "|---|---:|---:|---:|---:|"]
        for region, schemes in result["gridRegionalCoverage"].items():
            b, c = schemes["B connected unweighted"]["2500"], schemes["C connected cubic"]["2500"]
            lines.append(f"| {region} | {b['coveragePercent']:.1f}% | {b['currentCoveredLost']:,} / {b['currentMissingRecovered']:,} | {c['coveragePercent']:.1f}% | {c['currentCoveredLost']:,} / {c['currentMissingRecovered']:,} |")
        lines += ["", "## 3,246 insufficient-connectivity cells: representative checks", "", f"Sample classification counts: {dict(suspect_class)}. Samples were chosen by nearest Euclidean support distance (minimum, median, maximum) within each report-region window; these are diagnostic examples, not exhaustive manual cartographic verification.", "", "| Region | Target lat,lng | Score | Nearest source lat,lng (km; same component?) | 2nd source | 3rd source | Connected site count | Interpretation |", "|---|---|---:|---|---|---|---:|---|"]
        for e in examples:
            s = e["nearestEuclideanSources"]
            sf = lambda x: f"{x['lat']:.3f},{x['lng']:.3f} ({x['distanceKm']:.0f}; {'yes' if x['sameConnectedComponent'] else 'no'})"
            lines.append(f"| {e['region']} | {e['target']['lat']:.3f},{e['target']['lng']:.3f} | {e['coarseScore']} | {sf(s[0]) if len(s)>0 else 'n/a'} | {sf(s[1]) if len(s)>1 else 'n/a'} | {sf(s[2]) if len(s)>2 else 'n/a'} | {e['sameComponentSiteCountWithin2500Km']} | {e['sampleClassification']} |")
        lines += ["", "## Interpretation", "", "The connected-source scenario C is the appropriate connectivity-filtered comparison; a water-component match is necessary evidence against a land barrier, not proof that distant sites share comparable reef ecology. The score-grid's 7 km mask is not used here. Native GEBCO paths remain vulnerable to unresolved narrow channels, raster coastline error, and imperfect survey coordinates. B and C differences isolate the effects of requiring effective support after filtering and weighted averaging; no scenario is adopted in production.", ""]
        (REPORTS / "fish-connectivity-support-validation.md").write_text("\n".join(lines), encoding="utf-8")
        print(json.dumps({"report":"reports/fish-connectivity-support-validation.md", "gridCoverage":result["gridCoverage"],
                          "cv1000":{"A":result["bufferedSpatialBlockCrossValidation"]["1000"]["A Euclidean cubic"]["1000"],
                                    "B":result["bufferedSpatialBlockCrossValidation"]["1000"]["B connected unweighted"]["1000"],
                                    "C":result["bufferedSpatialBlockCrossValidation"]["1000"]["C connected cubic"]["1000"]},
                          "suspectSampleCounts":dict(suspect_class)}, indent=2))
    finally:
        del labels
        for p in temp_paths:
            try: Path(p).unlink()
            except OSError: pass


if __name__ == "__main__":
    main()
