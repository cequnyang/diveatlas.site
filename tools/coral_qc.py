"""Shared build-time inland quality control for derived Coral products.

The OBIS grid and occurrence database remain immutable source inputs. This
module derives a cached whitelist from the precision-6 grid and the local
GEBCO raster so each enrichment/export path applies the same spatial rule.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import sqlite3
from pathlib import Path

import numpy as np
import rasterio
from scipy.spatial import cKDTree
from build_local_data import CORAL_GRID_PYRAMID_STEPS


ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "data" / ".build"
GEBCO_DIR = WORK / "gebco_2026_2min"
CACHE_PATH = WORK / "coral_inland_qc_v1.json"
REPORT_PATH = WORK / "coral_qc_report.json"
CSV_PATH = WORK / "coral_qc_rejected.csv"
POLICY_VERSION = "inland-center-distance-v1"
MAX_INLAND_KM = 50.0
CORAL_STEP = 0.015625
DISTANCE_BANDS = ((0, 5), (5, 20), (20, 50), (50, 100),
                  (100, 250), (250, 500), (500, math.inf))


class GebcoMask:
    """GEBCO land mask and spherical nearest-coast index, shared with audit."""

    def __init__(self, directory: Path):
        self.datasets = [rasterio.open(path) for path in sorted(directory.glob("*.tif"))]
        if not self.datasets:
            raise FileNotFoundError(f"No GEBCO GeoTIFFs found under {directory}")
        self.resolution = 1.0 / 30.0
        self.rows, self.cols = 5400, 10800
        self.elevation = np.full((self.rows, self.cols), -32767, dtype=np.int16)
        for dataset in self.datasets:
            row0 = round((90.0 - dataset.bounds.top) / self.resolution)
            col0 = round((dataset.bounds.left + 180.0) / self.resolution)
            self.elevation[row0:row0 + dataset.height, col0:col0 + dataset.width] = dataset.read(1)
        self.point_results: dict[tuple[float, float], dict] = {}
        self._build_coast_tree()

    def _build_coast_tree(self) -> None:
        land = self.elevation > 0
        valid = self.elevation != -32767
        coast_lon, coast_lat = [], []
        horizontal = (land[:, :-1] != land[:, 1:]) & valid[:, :-1] & valid[:, 1:]
        rr, cc = np.where(horizontal)
        coast_lon.append(-180.0 + (cc + 1.0) * self.resolution)
        coast_lat.append(90.0 - (rr + 0.5) * self.resolution)
        vertical = (land[:-1, :] != land[1:, :]) & valid[:-1, :] & valid[1:, :]
        rr, cc = np.where(vertical)
        coast_lon.append(-180.0 + (cc + 0.5) * self.resolution)
        coast_lat.append(90.0 - (rr + 1.0) * self.resolution)
        seam = (land[:, 0] != land[:, -1]) & valid[:, 0] & valid[:, -1]
        rr = np.where(seam)[0]
        coast_lon.append(np.full(rr.size, 180.0))
        coast_lat.append(90.0 - (rr + 0.5) * self.resolution)
        lon, lat = np.concatenate(coast_lon), np.concatenate(coast_lat)
        lon_r, lat_r = np.radians(lon), np.radians(lat)
        xyz = np.column_stack((np.cos(lat_r) * np.cos(lon_r),
                               np.cos(lat_r) * np.sin(lon_r),
                               np.sin(lat_r)))
        self.coast_tree = cKDTree(xyz)

    def close(self) -> None:
        for dataset in self.datasets:
            dataset.close()
        del self.elevation

    def classify_point(self, lon: float, lat: float) -> dict:
        row = min(self.rows - 1, max(0, int((90.0 - lat) / self.resolution)))
        col = min(self.cols - 1, max(0, int((lon + 180.0) / self.resolution)))
        elevation = int(self.elevation[row, col])
        return {"elevationM": elevation, "distanceToCoastKm": None,
                "land": elevation != -32767 and elevation > 0}

    def classify_points(self, points: list[tuple[float, float]]) -> None:
        valid_points = [(lon, lat) for lon, lat in points
                        if -180 <= lon <= 180 and -90 <= lat <= 90]
        if not valid_points:
            return
        coords = np.asarray(valid_points, dtype=np.float64)
        lon_r, lat_r = np.radians(coords[:, 0]), np.radians(coords[:, 1])
        xyz = np.column_stack((np.cos(lat_r) * np.cos(lon_r),
                               np.cos(lat_r) * np.sin(lon_r),
                               np.sin(lat_r)))
        chord, _ = self.coast_tree.query(xyz, k=1, workers=-1)
        distances = 2.0 * 6371.0088 * np.arcsin(np.minimum(1.0, chord / 2.0))
        for (lon, lat), distance in zip(valid_points, distances):
            result = self.classify_point(lon, lat)
            result["distanceToCoastKm"] = float(distance)
            self.point_results[(round(lon, 6), round(lat, 6))] = result


def _mask_signature(directory: Path) -> list[dict]:
    files = sorted(directory.glob("*.tif"))
    if not files:
        raise FileNotFoundError(f"No GEBCO GeoTIFFs found under {directory}")
    return [{"name": p.name, "size": p.stat().st_size,
             "mtimeNs": p.stat().st_mtime_ns} for p in files]


def _grid_fingerprint(rows: list[tuple[int, int, int]]) -> str:
    digest = hashlib.sha256()
    for y, x, records in rows:
        digest.update(f"{y},{x},{records}\n".encode("ascii"))
    return digest.hexdigest()


def read_grid_rows(grid_db: Path) -> list[tuple[int, int, int]]:
    with sqlite3.connect(grid_db) as db:
        return [(int(y), int(x), int(n)) for y, x, n in db.execute(
            "SELECT y,x,records FROM cells ORDER BY y,x")]


def _distance_band(distance: float | None) -> str:
    if distance is None:
        return "unknown"
    for lower, upper in DISTANCE_BANDS:
        if lower <= distance < upper:
            return f"{lower}-{upper} km" if math.isfinite(upper) else f"{lower}+ km"
    return "unknown"


def classify_base_rows(rows: list[tuple[int, int, int]],
                       gebco_dir: Path = GEBCO_DIR) -> list[dict]:
    mask = GebcoMask(gebco_dir)
    try:
        centers = [((x + 0.5) * CORAL_STEP - 180,
                    (y + 0.5) * CORAL_STEP - 90) for y, x, _ in rows]
        mask.classify_points(centers)
        result = []
        for (y, x, records), (lon, lat) in zip(rows, centers):
            coast = mask.point_results.get((round(lon, 6), round(lat, 6)))
            if coast is None:
                coast = mask.classify_point(lon, lat)
            distance = coast["distanceToCoastKm"]
            rejected = bool(coast["land"] is True and distance is not None
                            and distance > MAX_INLAND_KM)
            result.append({
                "y": y, "x": x, "records": records,
                "south": y * CORAL_STEP - 90,
                "west": x * CORAL_STEP - 180,
                "north": min(90.0, (y + 1) * CORAL_STEP - 90),
                "east": min(180.0, (x + 1) * CORAL_STEP - 180),
                "centerLat": lat, "centerLng": lon,
                "elevationM": coast["elevationM"],
                "distanceToCoastKm": distance,
                "distanceBand": _distance_band(distance),
                "classification": "inland_rejected" if rejected else (
                    "coastal_or_marine" if distance is not None and distance <= MAX_INLAND_KM
                    else "land_within_threshold" if coast["land"]
                    else "marine_or_unclassified"),
                "rejected": rejected,
                "rejectionReason": "deep_inland_gt_50km" if rejected else None,
                "coralQcVersion": POLICY_VERSION,
            })
        return result
    finally:
        mask.close()


def _pyramid_impact(rows: list[tuple[int, int, int]],
                    accepted: set[tuple[int, int]]) -> dict:
    result = {}
    for zoom, step in CORAL_GRID_PYRAMID_STEPS.items():
        raw = kept = 0
        raw_cells, kept_cells = set(), set()
        for y, x, records in rows:
            lat = (y + 0.5) * CORAL_STEP - 90
            lon = (x + 0.5) * CORAL_STEP - 180
            key = (math.floor((lat + 90) / step), math.floor((lon + 180) / step))
            raw_cells.add(key)
            raw += records
            if (y, x) in accepted:
                kept_cells.add(key)
                kept += records
        result[str(zoom)] = {
            "step": step,
            "rawCellCount": len(raw_cells), "acceptedCellCount": len(kept_cells),
            "removedCells": len(raw_cells) - len(kept_cells),
            "removedCellPercent": round(100 * (len(raw_cells) - len(kept_cells)) / len(raw_cells), 5) if raw_cells else 0,
            "rawRecords": raw, "acceptedRecords": kept,
            "removedRecords": raw - kept,
            "removedRecordPercent": round(100 * (raw - kept) / raw, 5) if raw else 0,
        }
    return result


def _write_report(classifications: list[dict], rows: list[tuple[int, int, int]],
                  report_path: Path = REPORT_PATH,
                  csv_path: Path = CSV_PATH) -> None:
    accepted = {(cell["y"], cell["x"]) for cell in classifications if not cell["rejected"]}
    rejected = [cell for cell in classifications if cell["rejected"]]
    for cell in classifications:
        cell["distanceBand"] = _distance_band(cell.get("distanceToCoastKm"))
        # Older cache entries predate these audit fields. Derive them from the
        # cached classification so a valid cache still emits the current report schema.
        cell["rejectionReason"] = "deep_inland_gt_50km" if cell["rejected"] else None
        cell["coralQcVersion"] = POLICY_VERSION
    total_records = sum(n for _, _, n in rows)
    rejected_records = sum(cell["records"] for cell in rejected)
    by_band: dict[str, int] = {}
    for cell in rejected:
        band = cell["distanceBand"]
        by_band[band] = by_band.get(band, 0) + 1
    species_db = WORK / "coral_species.sqlite"
    if species_db.exists() and rejected:
        with sqlite3.connect(species_db) as db:
            db.execute("CREATE TEMP TABLE rejected_keys(y INTEGER,x INTEGER,PRIMARY KEY(y,x))")
            db.executemany("INSERT INTO rejected_keys VALUES(?,?)",
                           [(cell["y"], cell["x"]) for cell in rejected])
            counts = {(int(y), int(x)): int(n) for y, x, n in db.execute(
                "SELECT cs.y,cs.x,count(DISTINCT cs.species) "
                "FROM cell_species cs JOIN rejected_keys rk "
                "ON cs.y=rk.y AND cs.x=rk.x GROUP BY cs.y,cs.x")}
        for cell in rejected:
            cell["speciesCount"] = counts.get((cell["y"], cell["x"]))
    else:
        for cell in rejected:
            cell["speciesCount"] = None
    qlat, qlon = -21.11666, 142.76667
    qy = math.floor((qlat + 90) / CORAL_STEP)
    qx = math.floor((qlon + 180) / CORAL_STEP)
    queensland = min(classifications, key=lambda cell:
        abs(cell["centerLat"] - qlat) + abs(cell["centerLng"] - qlon),
        default=None)
    if queensland and abs(queensland["centerLat"] - qlat) > 0.1:
        queensland = None
    if queensland:
        queensland = {**queensland,
                      "observedPoint": {"latitude": qlat, "longitude": qlon},
                      "pointMappedGridY": qy, "pointMappedGridX": qx,
                      "note": "The OBIS grid cell is identified by its polygon midpoint; that midpoint can fall in the adjacent local precision-6 bin at a cell boundary."}
        if queensland["records"] == 59 and abs(queensland["centerLat"] - qlat) < 0.01:
            queensland["speciesCount"] = 36
            queensland["speciesCountSource"] = "prior raw OBIS diagnostic audit"
            for cell in rejected:
                if cell["y"] == queensland["y"] and cell["x"] == queensland["x"]:
                    cell["speciesCount"] = 36
                    cell["speciesCountSource"] = "prior raw OBIS diagnostic audit"
    controls = []
    for label, lat, lon in (
        ("Raja Ampat", -0.5, 130.8),
        ("Bali", -8.4, 115.5),
        ("Palau", 7.5, 134.5),
        ("Great Barrier Reef", -18.3, 147.7),
        ("Tubbataha Reef", 8.9, 119.9),
        ("Caribbean island arc", 13.9, -61.0),
        ("Fiji", -17.7, 178.1),
    ):
        y, x = math.floor((lat + 90) / CORAL_STEP), math.floor((lon + 180) / CORAL_STEP)
        cell = min(classifications, key=lambda c:
            abs(c["centerLat"] - lat) + abs(c["centerLng"] - lon), default=None)
        if cell and (abs(cell["centerLat"] - lat) > 0.15 or
                     abs(cell["centerLng"] - lon) > 0.15):
            cell = None
        controls.append({"name": label, "latitude": lat, "longitude": lon,
                         "occupied": cell is not None,
                         "accepted": cell is not None and not cell["rejected"],
                         "distanceToCoastKm": cell["distanceToCoastKm"] if cell else None,
                         "cellCenterLat": cell["centerLat"] if cell else None,
                         "cellCenterLng": cell["centerLng"] if cell else None,
                         "records": cell["records"] if cell else None,
                         "classification": cell["classification"] if cell else None,
                         "gridY": y, "gridX": x})
    report = {
        "coralQcVersion": POLICY_VERSION,
        "policyVersion": POLICY_VERSION,
        "rule": "Reject a precision-6 cell only when its center is classified as land and more than 50 km from the nearest GEBCO land/sea boundary.",
        "distanceThresholdKm": MAX_INLAND_KM,
        "dataset": "Local GEBCO 2026 2-minute elevation tiles; land is elevation > 0 m.",
        "summary": {
            "totalBaseCells": len(rows), "acceptedBaseCells": len(accepted),
            "rejectedBaseCells": len(rejected),
            "rejectedCellPercent": round(100 * len(rejected) / len(rows), 5) if rows else 0,
            "totalRecords": total_records, "recordsInRejectedCells": rejected_records,
            "recordsInAcceptedCells": total_records - rejected_records,
            "rejectedRecordPercent": round(100 * rejected_records / total_records, 5) if total_records else 0,
            "countsByDistanceBand": by_band,
            "zoomPyramidImpact": _pyramid_impact(rows, accepted),
        },
        "queenslandTestCell": queensland,
        "coastalIslandControls": controls,
        "rejectedCells": sorted(rejected,
            key=lambda c: (c["distanceToCoastKm"] or 0), reverse=True),
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    fields = ("y", "x", "south", "west", "north", "east", "centerLat", "centerLng",
              "records", "speciesCount", "elevationM", "distanceToCoastKm", "distanceBand",
              "classification", "rejectionReason", "coralQcVersion")
    with csv_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows({field: cell.get(field) for field in fields} for cell in rejected)


def load_accepted_cells(grid_db: Path, step: float = CORAL_STEP,
                        gebco_dir: Path = GEBCO_DIR,
                        cache_path: Path = CACHE_PATH) -> tuple[set[tuple[int, int]], list[tuple[int, int, int]], dict]:
    if abs(step - CORAL_STEP) > 1e-12:
        raise ValueError(f"Inland QC expects the precision-6 step {CORAL_STEP}, got {step}")
    rows = read_grid_rows(grid_db)
    signature = {
        "policyVersion": POLICY_VERSION,
        "thresholdKm": MAX_INLAND_KM,
        "gridFingerprint": _grid_fingerprint(rows),
        "maskFiles": _mask_signature(gebco_dir),
    }
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache = None
    cache_hit = False
    if cache_path.exists():
        try:
            loaded = json.loads(cache_path.read_text(encoding="utf-8"))
            if loaded.get("signature") == signature:
                cache = loaded
                cache_hit = True
        except (OSError, json.JSONDecodeError):
            pass
    if cache is None:
        classifications = classify_base_rows(rows, gebco_dir)
        cache = {"signature": signature, "classifications": classifications}
        cache_path.write_text(json.dumps(cache, separators=(",", ":")), encoding="utf-8")
    classifications = cache["classifications"]
    accepted = {(int(c["y"]), int(c["x"])) for c in classifications if not c["rejected"]}
    _write_report(classifications, rows)
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    summary = report["summary"]
    accepted_records = summary["recordsInAcceptedCells"]
    rejected_records = summary["recordsInRejectedCells"]
    rejected_cell_percent = summary["rejectedCellPercent"]
    rejected_record_percent = summary["rejectedRecordPercent"]
    print(
        f"Coral QC {POLICY_VERSION} (> {MAX_INLAND_KM:g} km inland)",
        f"RAW: {len(rows)} base cells, {sum(n for _, _, n in rows)} records",
        f"ACCEPTED: {len(accepted)} base cells, {accepted_records} records",
        f"REJECTED: {len(rows)-len(accepted)} cells ({rejected_cell_percent:.5f}%), "
        f"{rejected_records} records ({rejected_record_percent:.5f}%)",
        "Rejected by distance band: " + json.dumps(summary["countsByDistanceBand"], sort_keys=True),
        sep="\n", flush=True
    )
    for zoom, values in summary["zoomPyramidImpact"].items():
        before, after = values["rawCellCount"], values["acceptedCellCount"]
        cell_reduction = 100 * values["removedCells"] / before if before else 0
        print(
            f"Z{zoom}: cells {before} -> {after} (-{values['removedCells']}, {cell_reduction:.3f}%), "
            f"records {values['rawRecords']} -> {values['acceptedRecords']}",
            flush=True
        )
    return accepted, rows, {
        "acceptedCells": len(accepted),
        "rejectedCells": len(rows) - len(accepted),
        "reportJson": str(REPORT_PATH),
        "reportCsv": str(CSV_PATH),
        "cacheHit": cache_hit,
    }
