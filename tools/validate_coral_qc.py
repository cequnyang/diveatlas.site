"""Offline regression checks for the production Coral inland-QC build."""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import math
import re
import sqlite3
import sys
from pathlib import Path

from coral_qc import (
    CORAL_STEP,
    GEBCO_DIR,
    MAX_INLAND_KM,
    POLICY_VERSION,
    WORK,
    classify_base_rows,
)
from build_local_data import CORAL_GRID_PYRAMID_STEPS


ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
GRID_DB = WORK / "coral_grid.sqlite"
QC_REPORT = WORK / "coral_qc_report.json"
SNAPSHOT = DATA / "coral_records_snapshot.js"
MANIFEST = DATA / "coral_occurrence_manifest.js"
CHUNKS_DIR = DATA / "coral_occurrence_chunks"
OUTPUT = WORK / "coral_qc_validation.json"
BASELINE = {
    "rejectedCells": 742,
    "rejectedRecords": 1687,
    "rejectedCellRatio": 742 / 130470,
    "rejectedRecordRatio": 1687 / 2682122,
    "distanceBands": {
        "50-100 km": 114,
        "100-250 km": 115,
        "250-500 km": 168,
        "500+ km": 345,
    },
    "aggregatedCellsByZoom": {
        "3": 2061, "4": 4407, "5": 9042, "6": 17914,
        "7": 33042, "8": 41304, "9": 54762, "10": 70067,
        "11": 99417,
    },
}
CONTROL_BOUNDS = {
    "Raja Ampat": (-1.8, 0.8, 128.8, 132.2),
    "Bali": (-9.5, -7.5, 113.8, 116.6),
    "Palau": (6.0, 9.0, 132.0, 136.0),
    "Tubbataha": (8.1, 9.8, 119.0, 121.0),
    "Fiji": (-21.0, -15.0, 176.0, 180.0),
    "Great Barrier Reef": (-26.0, -9.0, 141.0, 155.0),
    "Caribbean": (8.0, 27.0, -90.0, -55.0),
}


def metric_guardrails(summary: dict) -> tuple[list[str], list[str]]:
    """Return hard failures and drift warnings for report accounting."""
    failures, warnings = [], []
    required = (
        "totalBaseCells", "acceptedBaseCells", "rejectedBaseCells",
        "totalRecords", "recordsInAcceptedCells", "recordsInRejectedCells",
        "rejectedCellPercent", "rejectedRecordPercent",
    )
    missing = [key for key in required if key not in summary]
    if missing:
        return ["QC report is missing summary values: " + ", ".join(missing)], warnings
    raw_base_cells, accepted_base_cells, rejected_base_cells = (
        int(summary[k]) for k in ("totalBaseCells", "acceptedBaseCells", "rejectedBaseCells")
    )
    raw_records, accepted_records, rejected_records = (
        int(summary[k]) for k in ("totalRecords", "recordsInAcceptedCells", "recordsInRejectedCells")
    )
    if min(raw_base_cells, accepted_base_cells, rejected_base_cells, raw_records,
           accepted_records, rejected_records) < 0:
        failures.append("QC report contains negative cell or record counts")
    if accepted_base_cells + rejected_base_cells != raw_base_cells:
        failures.append("Accepted + rejected cells do not equal raw cells")
    if accepted_records + rejected_records != raw_records:
        failures.append("Accepted + rejected records do not equal raw records")
    if accepted_base_cells > raw_base_cells or rejected_base_cells > raw_base_cells:
        failures.append("Accepted or rejected cell count exceeds raw cells")
    if accepted_records > raw_records or rejected_records > raw_records:
        failures.append("Accepted or rejected record count exceeds raw records")
    if accepted_base_cells == 0:
        failures.append("No accepted Coral cells remain")
    cell_ratio = rejected_base_cells / raw_base_cells if raw_base_cells else math.inf
    record_ratio = rejected_records / raw_records if raw_records else math.inf
    if raw_base_cells and not math.isclose(float(summary["rejectedCellPercent"]), 100 * cell_ratio, abs_tol=0.01):
        failures.append("QC report rejectedCellPercent does not match its counts")
    if raw_records and not math.isclose(float(summary["rejectedRecordPercent"]), 100 * record_ratio, abs_tol=0.01):
        failures.append("QC report rejectedRecordPercent does not match its counts")
    if raw_base_cells == 0 or raw_records == 0:
        failures.append("Raw Coral cell or record total is zero")
    if cell_ratio > 0.02:
        failures.append(f"Rejected cell ratio {cell_ratio:.2%} exceeds 2.0% hard limit")
    if record_ratio > 0.005:
        failures.append(f"Rejected record ratio {record_ratio:.2%} exceeds 0.5% hard limit")
    if BASELINE["rejectedCellRatio"] and abs(cell_ratio / BASELINE["rejectedCellRatio"] - 1) > 0.5:
        warnings.append(
            f"Rejected-cell ratio drifted from baseline {BASELINE['rejectedCellRatio']:.5%} "
            f"to {cell_ratio:.5%}"
        )
    if BASELINE["rejectedRecordRatio"] and abs(record_ratio / BASELINE["rejectedRecordRatio"] - 1) > 1.0:
        warnings.append(
            f"Rejected-record ratio drifted from baseline {BASELINE['rejectedRecordRatio']:.5%} "
            f"to {record_ratio:.5%}"
        )
    return failures, warnings


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def read_snapshot(path: Path) -> dict:
    source = path.read_text(encoding="utf-8")
    match = re.search(r'DIVEATLAS_CORAL_SNAPSHOT\s*=\s*"([^\"]+)"', source)
    if not match:
        raise ValueError("compressed DIVEATLAS_CORAL_SNAPSHOT payload not found")
    return json.loads(gzip.decompress(base64.b64decode(match.group(1))))


def read_manifest(path: Path) -> dict:
    source = path.read_text(encoding="utf-8")
    marker = "window.DIVEATLAS_CORAL_OCCURRENCE_MANIFEST="
    if marker not in source:
        raise ValueError("DIVEATLAS_CORAL_OCCURRENCE_MANIFEST assignment not found")
    return json.loads(source.split(marker, 1)[1].strip().rstrip(";"))


def read_raw_grid_read_only(path: Path) -> list[tuple[int, int, int]]:
    uri = path.resolve().as_uri() + "?mode=ro"
    with sqlite3.connect(uri, uri=True) as db:
        return [(int(y), int(x), int(n)) for y, x, n in db.execute(
            "SELECT y,x,records FROM cells ORDER BY y,x")]


def report_rejected_cells(report: dict) -> list[dict]:
    cells = report.get("rejectedCells")
    if not isinstance(cells, list):
        raise ValueError("QC report rejectedCells must be a list")
    return cells


def _snapshot_base_index(snapshot: dict) -> tuple[dict[tuple[int, int], list], list[str]]:
    rows = snapshot.get("cells")
    species = snapshot.get("species")
    if not isinstance(rows, list) or not isinstance(species, list):
        raise ValueError("production snapshot must contain cells and species arrays")
    index = {}
    for row in rows:
        if not isinstance(row, list) or len(row) < 4:
            raise ValueError("malformed species-aware base snapshot row")
        key = (int(row[0]), int(row[1]))
        if key in index:
            raise ValueError(f"duplicate production base cell {key}")
        ids = row[3]
        if not isinstance(ids, list):
            raise ValueError(f"species IDs are not a list for base cell {key}")
        if any(not isinstance(value, int) or value < 0 or value >= len(species) for value in ids):
            raise ValueError(f"invalid species ID in production base cell {key}")
        index[key] = row
    return index, species


def _expected_pyramid(base_index: dict[tuple[int, int], list], step: float) -> dict:
    grouped: dict[tuple[int, int], list] = {}
    for (y, x), row in base_index.items():
        lat = (y + 0.5) * CORAL_STEP - 90
        lon = (x + 0.5) * CORAL_STEP - 180
        key = (math.floor((lat + 90) / step), math.floor((lon + 180) / step))
        item = grouped.setdefault(key, [0, set()])
        item[0] += int(row[2])
        item[1].update(int(species_id) for species_id in row[3])
    return grouped


def _actual_pyramid(level: dict) -> dict:
    rows = level.get("cells")
    if not isinstance(rows, list):
        raise ValueError("pyramid level is missing its cells array")
    actual = {}
    for row in rows:
        if not isinstance(row, list) or len(row) < 4:
            raise ValueError("malformed species-aware pyramid row")
        key = (int(row[0]), int(row[1]))
        if key in actual:
            raise ValueError(f"duplicate pyramid cell {key}")
        actual[key] = (int(row[2]), set(int(value) for value in row[3]))
    return actual


def _point_in_bounds(lat: float, lon: float, bounds: tuple[float, float, float, float]) -> bool:
    south, north, west, east = bounds
    return south <= lat < north and west <= lon < east


def _iter_occurrence_chunks(manifest: dict, chunks_dir: Path):
    chunks = manifest.get("chunks")
    species = manifest.get("species")
    if not isinstance(chunks, dict) or not isinstance(species, list):
        raise ValueError("occurrence manifest must contain chunks and species")
    if not chunks:
        raise ValueError("occurrence manifest contains no chunks")
    for chunk_key, entry in chunks.items():
        if not isinstance(entry, list) or len(entry) != 2:
            raise ValueError(f"malformed occurrence manifest entry {chunk_key}")
        filename, declared_count = entry
        path = chunks_dir / filename
        if not path.is_file():
            raise FileNotFoundError(f"manifest chunk is missing: {path}")
        source = path.read_text(encoding="utf-8")
        match = re.search(
            r'DIVEATLAS_CORAL_OCCURRENCE_CHUNKS\["([^\"]+)"\]\s*=\s*"([^\"]+)"', source
        )
        if not match:
            raise ValueError(f"malformed occurrence chunk payload: {path}")
        if match.group(1) != chunk_key:
            raise ValueError(f"chunk key in {path.name} does not match manifest key {chunk_key}")
        rows = json.loads(gzip.decompress(base64.b64decode(match.group(2))))
        if not isinstance(rows, list) or len(rows) != int(declared_count):
            raise ValueError(f"chunk count mismatch for {chunk_key}: expected {declared_count}")
        cy, cx = (int(value) for value in chunk_key.split(":", 1))
        for row in rows:
            if not isinstance(row, list) or len(row) != 3:
                raise ValueError(f"malformed occurrence point in chunk {chunk_key}")
            lat_i, lon_i, species_id = (int(value) for value in row)
            if species_id < -1 or species_id >= len(species):
                raise ValueError(f"invalid occurrence species ID {species_id} in {chunk_key}")
            lat, lon = lat_i / 1_000_000, lon_i / 1_000_000
            if math.floor(lat + 90) != cy or math.floor(lon + 180) != cx:
                raise ValueError(f"occurrence point does not belong to manifest chunk {chunk_key}")
            yield {
                "latitude": lat,
                "longitude": lon,
                "species": species[species_id] if species_id >= 0 else None,
                "speciesId": species_id,
                "chunk": chunk_key,
            }


def _check_controls(base_index: dict[tuple[int, int], list]) -> dict[str, int]:
    found = {name: 0 for name in CONTROL_BOUNDS}
    for (y, x), row in base_index.items():
        lat = (y + 0.5) * CORAL_STEP - 90
        lon = (x + 0.5) * CORAL_STEP - 180
        for name, bounds in CONTROL_BOUNDS.items():
            if _point_in_bounds(lat, lon, bounds):
                found[name] += int(row[2])
    return found


def queensland_regression_errors(
    qld: dict,
    raw_index: dict[tuple[int, int], int],
    rejected_keys: set[tuple[int, int]],
    production_keys: set[tuple[int, int]],
    z11_keys: set[tuple[int, int]],
    z11_step: float,
) -> tuple[list[str], tuple[int, int] | None]:
    """Check that the known inland 59-record cell stays rejected at every output level."""
    errors = []
    parent = None
    try:
        key = (int(qld["y"]), int(qld["x"]))
        point = qld.get("observedPoint") or {"latitude": -21.11666, "longitude": 142.76667}
        lat, lon = float(point["latitude"]), float(point["longitude"])
        if abs(lat + 21.11666) > 0.03 or abs(lon - 142.76667) > 0.03:
            errors.append("Queensland report cell is not near the known anomaly")
        if key not in rejected_keys or key not in raw_index:
            errors.append("known 59-record Queensland base cell is not present in rejected raw cells")
        if key in production_keys:
            errors.append("Queensland rejected base cell appears in production snapshot")
        if qld.get("rejectionReason") != "deep_inland_gt_50km" or float(qld.get("distanceToCoastKm", 0)) <= MAX_INLAND_KM:
            errors.append("Queensland cell rejection reason/distance is invalid")
        if int(qld.get("records", 0)) != 59:
            errors.append("Queensland regression no longer identifies the expected 59 records")
        parent = (
            math.floor((lat + 90) / z11_step),
            math.floor((lon + 180) / z11_step),
        )
        if parent in z11_keys:
            errors.append(f"Queensland Z11 parent {parent} appears in production pyramid")
    except (KeyError, TypeError, ValueError, ZeroDivisionError) as exc:
        errors.append(f"malformed Queensland regression cell: {exc}")
    return errors, parent


def occurrence_cell_violation(
    lat: float,
    lon: float,
    accepted_keys: set[tuple[int, int]],
    rejected_keys: set[tuple[int, int]],
) -> tuple[int, int] | None:
    """Return the base-cell key if a point would leak into rejected/unknown coverage."""
    base_key = (
        math.floor((lat + 90) / CORAL_STEP),
        math.floor((lon + 180) / CORAL_STEP),
    )
    return base_key if base_key in rejected_keys or base_key not in accepted_keys else None


def pyramid_level_errors(
    base_index: dict[tuple[int, int], list], level: dict, expected_records: int,
    snapshot_records: int, canonical_step: float,
) -> list[str]:
    """Compare one exported pyramid level against direct aggregation of base cells."""
    errors = []
    try:
        step = float(level["step"])
        if not math.isclose(step, canonical_step, rel_tol=0, abs_tol=1e-12):
            errors.append(f"grid step {step} differs from canonical {canonical_step}")
        expected = _expected_pyramid(base_index, step)
        actual = _actual_pyramid(level)
        if set(expected) != set(actual):
            errors.append("parent-cell set does not match accepted base-cell aggregation")
        for cell_key in set(expected) & set(actual):
            records, species_ids = expected[cell_key]
            actual_records, actual_species = actual[cell_key]
            if records != actual_records or species_ids != actual_species:
                errors.append(f"aggregation mismatch at cell {cell_key}")
                break
        record_total = sum(row[0] for row in actual.values())
        if record_total != expected_records or record_total != snapshot_records:
            errors.append(f"record total {record_total} does not equal accepted total {expected_records}")
    except Exception as exc:
        errors.append(f"malformed pyramid level: {exc}")
    return errors


def validate(args: argparse.Namespace) -> dict:
    failures, warnings, passes = [], [], []
    metrics = {}
    controls = {}
    qld_passed = False
    required = {
        "raw grid": args.grid_db,
        "QC report": args.report,
        "production snapshot": args.snapshot,
        "occurrence manifest": args.manifest,
        "GEBCO land/coast tiles": args.gebco_dir,
        "occurrence chunk directory": args.chunks_dir,
    }
    for label, path in required.items():
        present = path.is_dir() if label.endswith("tiles") or label.endswith("directory") else path.is_file()
        if not present:
            failures.append(f"Required {label} is missing: {path}")
    if failures:
        return {"status": "fail", "failures": failures, "warnings": warnings,
                "passes": passes, "metrics": metrics, "positiveControls": controls,
                "queenslandRegressionPassed": qld_passed}

    try:
        raw_rows = read_raw_grid_read_only(args.grid_db)
        raw_index = {(y, x): n for y, x, n in raw_rows}
        report = read_json(args.report)
        snapshot = read_snapshot(args.snapshot)
        manifest = read_manifest(args.manifest)
        rejected_rows = report_rejected_cells(report)
        base_index, snapshot_species = _snapshot_base_index(snapshot)
    except Exception as exc:
        failures.append(f"Required Coral artifact is malformed or unreadable: {exc}")
        return {"status": "fail", "failures": failures, "warnings": warnings,
                "passes": passes, "metrics": metrics, "positiveControls": controls,
                "queenslandRegressionPassed": qld_passed}

    try:
        policy_version = str(report.get("coralQcVersion") or report.get("policyVersion") or "")
        threshold = float(report.get("distanceThresholdKm"))
        rule = str(report.get("rule") or "")
        if not policy_version or policy_version != POLICY_VERSION:
            failures.append(f"QC policy version {policy_version!r} does not match implementation {POLICY_VERSION!r}")
        for field in ("coralQcVersion", "policyVersion"):
            if report.get(field) is not None and report[field] != POLICY_VERSION:
                failures.append(f"QC report {field} {report[field]!r} does not match implementation {POLICY_VERSION!r}")
        if not math.isclose(threshold, MAX_INLAND_KM, rel_tol=0, abs_tol=1.0):
            failures.append(f"QC report threshold {threshold:g} km does not match canonical 50 km policy")
        if "center" not in rule.lower() or "50 km" not in rule.lower() or not (
            "> 50 km" in rule.lower() or "more than 50 km" in rule.lower()
        ):
            failures.append("QC report rule does not describe the inland cell-center >50 km policy")
        if policy_version == POLICY_VERSION and math.isclose(threshold, MAX_INLAND_KM, abs_tol=1.0):
            passes.append("QC policy/version matches the conservative inland-v1 implementation")
    except (TypeError, ValueError) as exc:
        failures.append(f"QC policy metadata is missing or invalid: {exc}")

    summary = report.get("summary")
    if not isinstance(summary, dict):
        failures.append("QC report summary is missing or malformed")
        summary = {}
    metric_failures, metric_warnings = metric_guardrails(summary)
    failures.extend(metric_failures)
    warnings.extend(metric_warnings)
    raw_records = sum(n for _, _, n in raw_rows)
    raw_base_cells = len(raw_rows)
    rejected_keys = set()
    rejected_metadata_issues = []
    for cell in rejected_rows:
        try:
            key = (int(cell["y"]), int(cell["x"]))
            if key in rejected_keys:
                failures.append(f"QC report has duplicate rejected cell {key}")
            rejected_keys.add(key)
            if key not in raw_index:
                rejected_metadata_issues.append(f"cell absent from raw grid: {key}")
            elif int(cell.get("records", -1)) != raw_index[key]:
                rejected_metadata_issues.append(f"record count differs from raw grid: {key}")
            if cell.get("rejectionReason") != "deep_inland_gt_50km":
                rejected_metadata_issues.append(f"missing/invalid rejection reason: {key}")
            if cell.get("coralQcVersion") != POLICY_VERSION:
                rejected_metadata_issues.append(f"missing/invalid coralQcVersion: {key}")
            if cell.get("rejected") is not True or cell.get("classification") != "inland_rejected":
                rejected_metadata_issues.append(f"classification is not inland_rejected: {key}")
            distance = float(cell.get("distanceToCoastKm"))
            if cell.get("elevationM", 0) <= 0 or distance <= MAX_INLAND_KM:
                rejected_metadata_issues.append(f"does not meet land and >50 km rule: {key}")
        except (KeyError, TypeError, ValueError) as exc:
            rejected_metadata_issues.append(f"malformed row: {exc}")
    if rejected_metadata_issues:
        failures.append(
            f"Rejected-cell audit has {len(rejected_metadata_issues)} invalid rows; "
            f"examples: {rejected_metadata_issues[:5]}"
        )
    if len(rejected_keys) != int(summary.get("rejectedBaseCells", -1)):
        failures.append("Rejected-cell audit rows do not match the rejectedBaseCells total")
    if raw_base_cells != int(summary.get("totalBaseCells", -1)) or raw_records != int(summary.get("totalRecords", -1)):
        failures.append("QC report raw totals do not match read-only coral_grid.sqlite")
    if (raw_base_cells == int(summary.get("totalBaseCells", -1))
            and raw_records == int(summary.get("totalRecords", -1))
            and len(rejected_keys) == int(summary.get("rejectedBaseCells", -1))
            and sum(raw_index.get(key, 0) for key in rejected_keys)
            == int(summary.get("recordsInRejectedCells", -1))
            and sum(raw_index.get(key, 0) for key in set(raw_index) - rejected_keys)
            == int(summary.get("recordsInAcceptedCells", -1))):
        passes.append("Raw/accepted/rejected counts reconcile with the preserved source grid")

    accepted_raw_keys = set(raw_index) - rejected_keys
    expected_accepted_records = sum(raw_index[key] for key in accepted_raw_keys)
    snapshot_records = sum(int(row[2]) for row in base_index.values())
    metrics.update({
        "rawBaseCells": raw_base_cells,
        "acceptedBaseCells": len(accepted_raw_keys),
        "rejectedBaseCells": len(rejected_keys),
        "rawRecords": raw_records,
        "acceptedRecords": expected_accepted_records,
        "rejectedRecords": raw_records - expected_accepted_records,
        "rejectedCellRatio": len(rejected_keys) / raw_base_cells if raw_base_cells else None,
        "rejectedRecordRatio": (raw_records - expected_accepted_records) / raw_records if raw_records else None,
        "policyVersion": report.get("coralQcVersion") or report.get("policyVersion"),
        "thresholdKm": report.get("distanceThresholdKm"),
    })

    if set(base_index) != accepted_raw_keys:
        missing = list(accepted_raw_keys - set(base_index))[:10]
        unexpected = list(set(base_index) - accepted_raw_keys)[:10]
        failures.append(
            "Production base cells differ from the QC accepted set; "
            f"missing={missing}, unexpected/rejected={unexpected}"
        )
    else:
        passes.append("No rejected cells exist in the production base snapshot")
    if int(summary.get("acceptedBaseCells", -1)) != len(base_index):
        failures.append("QC accepted-cell count does not match production snapshot base cells")
    if snapshot_records != expected_accepted_records or int(snapshot.get("records", -1)) != expected_accepted_records:
        failures.append("Production snapshot record total does not reconcile to accepted raw cells")
    if int(summary.get("recordsInAcceptedCells", -1)) != expected_accepted_records:
        failures.append("QC accepted-record total does not match production snapshot records")
    if snapshot_records == expected_accepted_records and set(base_index) == accepted_raw_keys:
        passes.append("Production snapshot contains exactly the accepted base cells and records")

    used_species_ids = {int(value) for row in base_index.values() for value in row[3]}
    if used_species_ids != set(range(len(snapshot_species))):
        failures.append("Species index contains unused or missing IDs relative to accepted base cells")

    pyramid = snapshot.get("gridPyramid")
    if not isinstance(pyramid, dict):
        failures.append("Production snapshot gridPyramid is missing or malformed")
        pyramid = {}
    for zoom in range(3, 12):
        key = str(zoom)
        level = pyramid.get(key)
        if not isinstance(level, dict):
            failures.append(f"Production pyramid is missing Z{zoom}")
            continue
        try:
            step = float(level["step"])
            actual = _actual_pyramid(level)
            record_total = sum(row[0] for row in actual.values())
            level_errors = pyramid_level_errors(
                base_index, level, expected_accepted_records,
                int(snapshot.get("records", -1)), float(CORAL_GRID_PYRAMID_STEPS[zoom]),
            )
            failures.extend(f"Z{zoom} {error}" for error in level_errors)
            baseline_count = BASELINE["aggregatedCellsByZoom"].get(key)
            if baseline_count and abs(len(actual) / baseline_count - 1) > 0.5:
                warnings.append(
                    f"Z{zoom} aggregated-cell count drifted from baseline "
                    f"{baseline_count:,} to {len(actual):,}"
                )
            passes.append(
                f"Z{zoom} aggregated cells, parent keys, species, and "
                f"{record_total:,} records reconcile"
            )
            print(f"  Z{zoom}: {len(actual):,} aggregated cells, {record_total:,} records")
        except Exception as exc:
            failures.append(f"Unable to validate Z{zoom} pyramid: {exc}")

    # Reclassify the actual production cells through the shared read-only GEBCO classifier.
    try:
        production_rows = [(y, x, int(row[2])) for (y, x), row in base_index.items()]
        production_classifications = classify_base_rows(production_rows, args.gebco_dir)
        inland_in_snapshot = [
            cell for cell in production_classifications if cell["rejected"]
        ]
        if inland_in_snapshot:
            failures.append(
                "Production snapshot contains cells classified land and >50 km inland: "
                + repr([(c["y"], c["x"], c["distanceToCoastKm"]) for c in inland_in_snapshot[:10]])
            )
        else:
            passes.append("Shared GEBCO classifier found no >50 km inland cells in production")
    except Exception as exc:
        failures.append(f"Could not reclassify production cells using the shared QC classifier: {exc}")

    # Safety regression: locate the audit's 59-record Queensland cell and its Z11 parent.
    qld = report.get("queenslandTestCell")
    try:
        if not isinstance(qld, dict):
            raise ValueError("Queensland regression cell is missing from QC report")
        qkey = (int(qld["y"]), int(qld["x"]))
        point = qld.get("observedPoint") or {"latitude": -21.11666, "longitude": 142.76667}
        lat, lon = float(point["latitude"]), float(point["longitude"])
        if abs(lat + 21.11666) > 0.03 or abs(lon - 142.76667) > 0.03:
            raise ValueError("Queensland report cell is not near the known anomaly")
        if qkey not in rejected_keys or qkey not in raw_index:
            raise ValueError("known 59-record Queensland base cell is not present in rejected raw cells")
        if qkey in base_index:
            raise ValueError("Queensland rejected base cell appears in production snapshot")
        qld_z11 = pyramid.get("11") or {}
        qld_errors, qld_parent = queensland_regression_errors(
            qld, raw_index, rejected_keys, set(base_index),
            set(_actual_pyramid(qld_z11)), float(qld_z11["step"]),
        )
        if qld_errors:
            raise ValueError("; ".join(qld_errors))
        qld_passed = True
        passes.append("Queensland 59-record / 36-species anomaly remains rejected and absent from Z11")
    except Exception as exc:
        failures.append(f"Queensland regression failed: {exc}")
        qkey = None
        qld_parent = None
        lat, lon = -21.11666, 142.76667

    # Stream every exported coordinate; occurrence chunk rows do not retain OBIS IDs.
    chunk_total = 0
    qld_chunk_points = 0
    leaked = []
    try:
        for occurrence in _iter_occurrence_chunks(manifest, args.chunks_dir):
            chunk_total += 1
            lat, lon = occurrence["latitude"], occurrence["longitude"]
            base_key = occurrence_cell_violation(lat, lon, accepted_raw_keys, rejected_keys)
            if base_key is not None:
                leaked.append({**occurrence, "baseCell": base_key, "recordId": None})
                if len(leaked) >= 20:
                    break
            if qld_parent is not None and _point_in_bounds(
                lat, lon,
                (
                    qld_parent[0] * float(pyramid["11"]["step"]) - 90,
                    (qld_parent[0] + 1) * float(pyramid["11"]["step"]) - 90,
                    qld_parent[1] * float(pyramid["11"]["step"]) - 180,
                    (qld_parent[1] + 1) * float(pyramid["11"]["step"]) - 180,
                ),
            ):
                qld_chunk_points += 1
        if leaked:
            failures.append(f"Occurrence chunk leak(s) found: {leaked[:5]}")
        elif chunk_total == int(manifest.get("records", -1)):
            passes.append(f"All {chunk_total:,} occurrence chunk points map only to accepted base cells")
        else:
            failures.append(
                f"Occurrence manifest reports {manifest.get('records')} records but chunks contain {chunk_total}"
            )
        if qld_chunk_points:
            failures.append(f"{qld_chunk_points} occurrence points reappear inside the Queensland rejected cell")
        metrics["occurrenceChunkRecords"] = chunk_total
        metrics["occurrenceChunkFiles"] = len(manifest["chunks"])
    except Exception as exc:
        failures.append(f"Occurrence chunks are missing, malformed, or inconsistent: {exc}")

    band_counts = {}
    try:
        for cell in rejected_rows:
            band = str(cell.get("distanceBand"))
            band_counts[band] = band_counts.get(band, 0) + 1
        reported_bands = summary.get("countsByDistanceBand") or {}
        if band_counts != reported_bands:
            failures.append("QC report rejected-cell distance-band counts do not match its cell audit rows")
        for band, baseline_count in BASELINE["distanceBands"].items():
            current = band_counts.get(band, 0)
            if baseline_count and abs(current / baseline_count - 1) > 0.5:
                warnings.append(f"Rejected cells in {band} drifted from baseline {baseline_count} to {current}")
        metrics["rejectedCellsByDistanceBand"] = band_counts
    except Exception as exc:
        failures.append(f"Rejected-cell distance bands are malformed: {exc}")

    controls = _check_controls(base_index)
    for name, records in controls.items():
        if records:
            passes.append(f"{name} positive control retains accepted Coral records ({records:,})")
        else:
            failures.append(f"Positive-control region {name} has no accepted Coral base cells")

    metrics["snapshotRecords"] = snapshot_records
    metrics["snapshotBaseCells"] = len(base_index)
    metrics["aggregatedCellsByZoom"] = {
        str(z): len((pyramid.get(str(z)) or {}).get("cells") or [])
        for z in range(3, 12)
    }
    metrics["positiveControls"] = controls
    metrics["snapshotSpeciesCount"] = len(snapshot_species)
    metrics["queenslandZ11Parent"] = qld_parent
    return {
        "status": "fail" if failures else "pass",
        "failures": failures,
        "warnings": warnings,
        "passes": passes,
        "metrics": metrics,
        "positiveControls": controls,
        "queenslandRegressionPassed": qld_passed,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--grid-db", type=Path, default=GRID_DB)
    parser.add_argument("--report", type=Path, default=QC_REPORT)
    parser.add_argument("--snapshot", type=Path, default=SNAPSHOT)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--chunks-dir", type=Path, default=CHUNKS_DIR)
    parser.add_argument("--gebco-dir", type=Path, default=GEBCO_DIR)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = validate(args)
    metrics = result.get("metrics", {})
    if "rawBaseCells" in metrics:
        print(
            "Base cells: "
            f"{metrics['rawBaseCells']:,} raw, "
            f"{metrics['acceptedBaseCells']:,} accepted, "
            f"{metrics['rejectedBaseCells']:,} rejected"
        )
    for message in result.get("passes", []):
        print(f"[PASS] {message}")
    for message in result.get("warnings", []):
        print(f"[WARN] {message}")
    for message in result.get("failures", []):
        print(f"[FAIL] {message}", file=sys.stderr)
    result_payload = {
        "status": result["status"],
        "warnings": result.get("warnings", []),
        "failures": result.get("failures", []),
        **metrics,
        "queenslandRegressionPassed": result.get("queenslandRegressionPassed", False),
        "positiveControls": result.get("positiveControls", {}),
    }
    try:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result_payload, indent=2), encoding="utf-8")
    except Exception as exc:
        print(f"[FAIL] Could not write validation report {args.output}: {exc}", file=sys.stderr)
        result["status"] = "fail"
    print(f"CORAL QC VALIDATION: {result['status'].upper()}")
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
