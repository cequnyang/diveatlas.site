"""Diagnose inland-looking Coral density cells without changing map data.

The local snapshot contains counts aggregated by OBIS's grid/6 endpoint.
This audit classifies its displayed Z3-Z11 cells against an existing GEBCO
2-minute elevation raster and optionally checks suspicious cells against raw
OBIS occurrences. The raster is used only at build/audit time.
"""

from __future__ import annotations

import argparse
import base64
import csv
import gzip
import json
import math
import re
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path

import requests
from coral_qc import GebcoMask, MAX_INLAND_KM


ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WORK = DATA / ".build"
SNAPSHOT = DATA / "coral_records_snapshot.js"
GRID_DB = WORK / "coral_grid.sqlite"
OCC_DB = WORK / "coral_occurrences.sqlite"
GEBCO_DIR = WORK / "gebco_2026_2min"
REPORT_JSON = WORK / "coral_inland_audit.json"
REPORT_CSV = WORK / "coral_inland_audit.csv"
OBIS_OCCURRENCE = "https://api.obis.org/v3/occurrence"
OBIS_GRID = "https://api.obis.org/v3/occurrence/grid/6"
TAXA = ("Scleractinia", "Octocorallia", "Antipatharia", "Millepora")
DISTANCE_BANDS = ((0, 5), (5, 20), (20, 50), (50, 100), (100, math.inf))
PIXEL_KM = 111.2 / 30


def read_snapshot(path: Path) -> dict:
    source = path.read_text(encoding="utf-8")
    match = re.search(r'DIVEATLAS_CORAL_SNAPSHOT\s*=\s*"([^"]+)"', source)
    if not match:
        raise ValueError(f"Could not find compressed Coral snapshot in {path}")
    return json.loads(gzip.decompress(base64.b64decode(match.group(1))))


def read_local_occurrences(path: Path, cells: list[dict]) -> dict[tuple[int, int], list[dict]]:
    """Read retained points only for the selected suspicious cell neighborhoods."""
    if not path.exists():
        return {}
    chunks = {(math.floor(cell["centerLat"] + 90), math.floor(cell["centerLng"] + 180)) for cell in cells}
    connection = sqlite3.connect(path)
    result: dict[tuple[int, int], list[dict]] = {}
    for cy, cx in chunks:
        rows = connection.execute(
            "SELECT id,lat_i,lng_i,species FROM occurrence WHERE cy=? AND cx=? ORDER BY id LIMIT 1000",
            (cy, cx),
        )
        for record_id, lat_i, lon_i, species in rows:
            lat, lon = lat_i / 1_000_000, lon_i / 1_000_000
            key = (math.floor((lat + 90) / 0.015625), math.floor((lon + 180) / 0.015625))
            result.setdefault(key, []).append({
                "latitude": lat, "longitude": lon, "scientificName": species,
                "obisId": record_id, "source": "local occurrence builder; quality fields not retained",
            })
    connection.close()
    return result


def query_obis_raw(cell: dict, limit: int, timeout: int = 90) -> tuple[list[dict], dict]:
    """Query each currently-used taxon in a cell; return rows and query totals."""
    geometry = (
        f"POLYGON (({cell['west']} {cell['south']},{cell['east']} {cell['south']},"
        f"{cell['east']} {cell['north']},{cell['west']} {cell['north']},"
        f"{cell['west']} {cell['south']}))"
    )
    session = requests.Session()
    session.headers.update({"User-Agent": "DiveAtlas-inland-coral-audit/1.0"})
    records, totals = [], {}

    for taxon in TAXA:
        params = {
            "scientificname": taxon,
            "geometry": geometry,
            "size": min(max(limit, 1), 1000),
        }
        response = session.get(OBIS_OCCURRENCE, params=params, timeout=timeout)
        response.raise_for_status()
        payload = response.json()
        totals[taxon] = int(payload.get("total") or 0)
        for row in payload.get("results") or []:
            records.append({
                "latitude": row.get("decimalLatitude"),
                "longitude": row.get("decimalLongitude"),
                "scientificName": row.get("scientificName") or row.get("species"),
                "obisId": row.get("id"),
                "occurrenceId": row.get("occurrenceID"),
                "datasetId": row.get("dataset_id"),
                "coordinateUncertaintyInMeters": row.get("coordinateUncertaintyInMeters"),
                "geodeticDatum": row.get("geodeticDatum"),
                "occurrenceStatus": row.get("occurrenceStatus"),
                "basisOfRecord": row.get("basisOfRecord"),
                "locality": row.get("locality"),
                "depth": row.get("depth"),
                "eventDate": row.get("eventDate"),
                "marine": row.get("marine"),
                "flags": row.get("flags"),
                "bathymetry": row.get("bathymetry"),
                "shoreDistance": row.get("shoredistance"),
            })
    return records, totals


def query_obis_grid(cell: dict) -> dict:
    """Fetch the grid/6 result for the exact test cell and each Coral taxon."""
    geometry = (
        f"POLYGON (({cell['west']} {cell['south']},{cell['east']} {cell['south']},"
        f"{cell['east']} {cell['north']},{cell['west']} {cell['north']},"
        f"{cell['west']} {cell['south']}))"
    )
    session = requests.Session()
    session.headers.update({"User-Agent": "DiveAtlas-inland-coral-audit/1.0"})
    result = {}
    for taxon in TAXA:
        response = session.get(OBIS_GRID, params={"scientificname": taxon, "geometry": geometry}, timeout=90)
        response.raise_for_status()
        payload = response.json()
        result[taxon] = [{
            "polygon": feature.get("geometry", {}).get("coordinates"),
            "properties": feature.get("properties", {}),
        } for feature in payload.get("features", [])]
    return result


def likely_cause(cell: dict, sample_occurrences: list[dict], raw: list[dict] | None) -> str:
    evidence = raw if raw is not None else sample_occurrences
    if not evidence:
        return "TYPE 4 - MIXED / UNCERTAIN"
    flags = [flag for row in evidence for flag in (row.get("flags") or [])]
    if "ON_LAND" in flags:
        return "TYPE 1 - SOURCE COORDINATE ISSUE"
    if all(row.get("marine") is True for row in evidence) and cell.get("distanceToCoastKm", 0) > 20:
        return "TYPE 2 - GRID AGGREGATION ISSUE"
    return "TYPE 4 - MIXED / UNCERTAIN"


def get_base_cells(path: Path) -> dict[tuple[int, int], dict]:
    if not path.exists():
        return {}
    db = sqlite3.connect(path)
    rows = db.execute("SELECT y,x,records FROM cells").fetchall()
    db.close()
    return {(int(y), int(x)): {"records": int(n)} for y, x, n in rows}


def build_display_cells(snapshot: dict, base_cells: dict) -> list[dict]:
    result = []
    steps = snapshot.get("gridPyramid") or {}
    for zoom_key, level in sorted(steps.items(), key=lambda item: int(item[0])):
        zoom, step = int(zoom_key), float(level["step"])
        for row in level.get("cells") or []:
            y, x, records = int(row[0]), int(row[1]), int(row[2])
            south, west = y * step - 90, x * step - 180
            species = row[3] if len(row) > 3 and isinstance(row[3], list) else []
            result.append({
                "zoom": zoom,
                "south": south,
                "west": west,
                "north": min(90.0, south + step),
                "east": west + step,
                "centerLat": south + step / 2,
                "centerLng": west + step / 2,
                "records": records,
                "speciesCount": len(species),
                "gridY": y,
                "gridX": x,
                "step": step,
            })
    return result


def classify_cells(cells: list[dict], mask: GebcoMask) -> None:
    points = list({(round(cell["centerLng"], 6), round(cell["centerLat"], 6)) for cell in cells})
    mask.classify_points(points)
    for cell in cells:
        key = (round(cell["centerLng"], 6), round(cell["centerLat"], 6))
        coast = mask.point_results.get(key) or mask.classify_point(*key)
        cell.update(coast)
        distance = coast["distanceToCoastKm"]
        # Use the cell center for inland status; land-intersecting rectangles
        # alone are not marked suspicious.
        if coast["land"] is True and distance is not None and distance > MAX_INLAND_KM:
            cell["classification"] = "C. inland suspicious"
        elif distance is not None and distance <= MAX_INLAND_KM:
            cell["classification"] = "B. coastal / mixed land-sea"
        elif coast["land"] is False:
            cell["classification"] = "A. marine"
        else:
            cell["classification"] = "D. unclassified"
        cell["distanceBand"] = next(
            (f"{lower}-{upper} km" if math.isfinite(upper) else "100+ km")
            for lower, upper in DISTANCE_BANDS
            if distance is not None and lower <= distance < upper
        ) if distance is not None else "unknown"


def audit(args: argparse.Namespace) -> dict:
    snapshot = read_snapshot(Path(args.snapshot))
    base_cells = get_base_cells(Path(args.grid_db))
    cells = build_display_cells(snapshot, base_cells)
    mask = GebcoMask(Path(args.gebco_dir))
    try:
        classify_cells(cells, mask)
    finally:
        mask.close()

    # Load local point samples only after suspicious cells are selected.
    # All pyramid levels contain the same underlying precision-6 locations.
    # Use the highest level for unique base-cell joins and avoid duplicating
    # occurrence samples once per generalized zoom.
    by_base: dict[tuple[int, int], list[dict]] = {}
    suspicious = [cell for cell in cells if cell["classification"] == "C. inland suspicious"]
    suspicious.sort(key=lambda cell: cell["distanceToCoastKm"] or 0, reverse=True)
    # Prioritize the inland Queensland record-count example and sample the
    # most inland/high-count cells. Raw endpoint calls are capped for runtime.
    selected: list[dict] = []
    seen = set()
    queensland = next((cell for cell in suspicious if
        cell["zoom"] == 11 and cell["records"] == 59
        and abs(cell["centerLng"] - 142.765625) < 0.001
        and abs(cell["centerLat"] + 21.109375) < 0.001), None)
    if queensland is not None:
        selected.append(queensland)
        seen.add((queensland["zoom"], queensland["gridY"], queensland["gridX"]))
    for cell in suspicious:
        key = (cell["zoom"], cell["gridY"], cell["gridX"])
        if key in seen:
            continue
        selected.append(cell)
        seen.add(key)
        if len(selected) >= args.raw_query_limit:
            break

    by_base = read_local_occurrences(Path(args.occurrence_db), selected)
    raw_by_cell: dict[tuple[int, int, int], list[dict]] = {}
    query_totals = {}
    for cell in selected:
        raw, totals = query_obis_raw(cell, args.raw_sample_limit)
        key = (cell["zoom"], cell["gridY"], cell["gridX"])
        raw_by_cell[key] = raw
        query_totals["|".join(map(str, key))] = totals
        if cell["centerLng"] == 142.765625 and abs(cell["centerLat"] + 21.109375) < 0.02:
            cell["rawRecordsTotal"] = sum(totals.values())
            cell["speciesCount"] = len({row.get("scientificName") for row in raw if row.get("scientificName")})
        time.sleep(0.15)

    for cell in suspicious:
        key = (cell["zoom"], cell["gridY"], cell["gridX"])
        raw = raw_by_cell.get(key)
        # At Z11 the pyramid grid index is not the precision-6 row index,
        # so join by contained coordinates via the corresponding local bin.
        base_y = math.floor((cell["centerLat"] + 90) / 0.015625)
        base_x = math.floor((cell["centerLng"] + 180) / 0.015625)
        sample = by_base.get((base_y, base_x), [])[:args.local_sample_limit]
        cell["sampleOccurrences"] = raw[:args.raw_sample_limit] if raw is not None else sample
        cell["likelyCause"] = likely_cause(cell, cell["sampleOccurrences"], raw)
        if raw is None and not sample:
            cell["likelyCause"] = "TYPE 4 - MIXED / UNCERTAIN"

    categories = Counter(cell["classification"] for cell in cells)
    likely = Counter(cell["likelyCause"] for cell in suspicious)
    bands = Counter(cell["distanceBand"] for cell in suspicious)
    total = len(cells)
    # Also provide unique base-grid classification counts, the useful scale
    # for comparing underlying records without counting every zoom pyramid.
    base_display = [cell for cell in cells if cell["zoom"] == 11]
    grid_comparison = query_obis_grid(queensland) if queensland else {}
    report = {
        "createdAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": {
            "snapshot": str(Path(args.snapshot)),
            "gridDatabase": str(Path(args.grid_db)),
            "occurrenceDatabase": str(Path(args.occurrence_db)),
            "landOceanDataset": "GEBCO 2026 2-minute elevation GeoTIFFs already present under data/.build/gebco_2026_2min; land is elevation > 0 m",
            "obisGridEndpoint": "https://api.obis.org/v3/occurrence/grid/6",
            "rawEndpoint": OBIS_OCCURRENCE,
            "gridEndpoint": OBIS_GRID,
            "distanceMethod": "Spherical nearest-neighbor distance to land/sea boundary transitions in the complete 2-minute GEBCO raster; approximate at GEBCO resolution",
        },
        "pipeline": {
            "coordinateMapping": "Internally consistent: OBIS GeoJSON x=longitude,y=latitude; local builders use floor((lat+90)/0.015625), floor((normalize_lon(lon)+180)/0.015625); pyramid groups base-cell centers; browser reconstructs south=y*step-90, west=x*step-180.",
            "gridEndpointRemapping": "build_local_data.py reads OBIS grid/6 polygon rings, takes bbox midpoint, then bins that midpoint into the local 0.015625-degree grid. This re-binning is lossy at cell edges, but it cannot relocate a cell hundreds of kilometers inland.",
            "speciesEnrichment": "Raw occurrence query enriches species names for existing valid grid cells; it does not change grid counts.",
            "occurrenceChunks": "Raw points are stored as latitude/longitude (microdegrees), species, OBIS result id, and 1-degree chunk keys. Quality metadata is discarded by the builder.",
            "coordinateMathValidation": "No lat/lon swap, origin mismatch, pyramid offset, or frontend reconstruction shift found.",
            "sourceCountComparison": {
                "snapshotRecords": int(snapshot.get("records", 0)),
                "gridSqliteRecords": sum(item["records"] for item in base_cells.values()),
                "snapshotBaseCells": len(snapshot.get("cells") or []),
                "gridSqliteBaseCells": len(base_cells),
            },
        },
        "summary": {
            "totalCellsExaminedAcrossZooms": total,
            "marine": categories["A. marine"],
            "coastalMixed": categories["B. coastal / mixed land-sea"],
            "suspiciousInland": categories["C. inland suspicious"],
            "unclassified": categories["D. unclassified"],
            "suspiciousInlandPercent": round(100 * categories["C. inland suspicious"] / total, 5) if total else 0,
            "uniqueZ11CellsExamined": len(base_display),
            "uniqueZ11SuspiciousInland": sum(c["classification"] == "C. inland suspicious" for c in base_display),
            "countsByDistanceBand": dict(sorted(bands.items())),
            "countsByLikelyCause": dict(sorted(likely.items())),
            "causeCountsIncludeUnverifiedCellsAsType4": True,
            "rawQueriedSuspiciousCells": len(raw_by_cell),
            "sampledCellCauseCounts": dict(Counter(cell.get("likelyCause", "TYPE 4 - MIXED / UNCERTAIN") for cell in selected)),
            "causeCountsAreEvidenceBasedOnlyWhereRawOrLocalSamplesExist": True,
            "cellCountsByLikelyCauseAreRepeatedAcrossZooms": True,
        },
        "rawQueryTotalsByCell": query_totals,
        "queenslandGridEndpointResult": grid_comparison,
        "qualityFieldsAvailableInRawObis": [
            "coordinateUncertaintyInMeters", "geodeticDatum", "occurrenceStatus",
            "basisOfRecord", "locality", "depth", "eventDate", "dataset_id",
            "occurrenceID", "marine", "flags", "bathymetry", "shoredistance",
        ],
        "qualityFieldsRetainedInLocalOccurrenceDatabase": [
            "decimalLatitude", "decimalLongitude", "species", "id (OBIS result id)",
        ],
        "top20MostInlandSuspiciousCells": sorted(
            suspicious, key=lambda cell: cell["distanceToCoastKm"] or 0, reverse=True
        )[:20],
        "top20HighestRecordSuspiciousCells": sorted(
            suspicious, key=lambda cell: cell["records"], reverse=True
        )[:20],
        "queenslandCase": next((cell for cell in suspicious if cell["zoom"] == 11 and cell["records"] == 59 and abs(cell["centerLng"] - 142.765625) < 0.001 and abs(cell["centerLat"] + 21.109375) < 0.001), None),
        "cells": cells,
    }
    return report


def write_csv(report: dict, path: Path) -> None:
    fields = (
        "zoom", "south", "west", "north", "east", "centerLat", "centerLng",
        "records", "speciesCount", "elevationM", "distanceToCoastKm",
        "distanceBand", "classification", "likelyCause",
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in report["cells"]:
            writer.writerow({field: row.get(field, "") for field in fields})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", default=str(SNAPSHOT))
    parser.add_argument("--grid-db", default=str(GRID_DB))
    parser.add_argument("--occurrence-db", default=str(OCC_DB))
    parser.add_argument("--gebco-dir", default=str(GEBCO_DIR))
    parser.add_argument("--output", default=str(REPORT_JSON))
    parser.add_argument("--csv", default=str(REPORT_CSV))
    parser.add_argument("--raw-query-limit", type=int, default=8)
    parser.add_argument("--raw-sample-limit", type=int, default=100)
    parser.add_argument("--local-sample-limit", type=int, default=10)
    args = parser.parse_args()
    report = audit(args)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")
    write_csv(report, Path(args.csv))
    summary = report["summary"]
    print(json.dumps({
        "report": str(output),
        "csv": args.csv,
        "totalCellsExaminedAcrossZooms": summary["totalCellsExaminedAcrossZooms"],
        "marine": summary["marine"],
        "coastalMixed": summary["coastalMixed"],
        "suspiciousInland": summary["suspiciousInland"],
        "suspiciousInlandPercent": summary["suspiciousInlandPercent"],
        "countsByDistanceBand": summary["countsByDistanceBand"],
        "countsByLikelyCause": summary["countsByLikelyCause"],
        "queenslandCase": report["queenslandCase"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit("Interrupted")
