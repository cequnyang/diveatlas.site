#!/usr/bin/env python3
"""Convert BCO-DMO dataset 958181 to a local canonical schema v3 pilot.

The source stores one row per substrate group and species along a 10 m
transect. A canonical survey event is therefore keyed by its original date,
locality, reef number, transect, and depth. Only the release's SCL (scleractinian
coral) rows contribute to hard coral cover; absent SCL rows remain unavailable
rather than being inferred as zero.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
PROVIDER = "BCO-DMO southwestern Puerto Rico benthic surveys"
DOI = "10.26008/1912/bco-dmo.958181.1"
SOURCE_URL = "https://www.bco-dmo.org/dataset/958181"
LICENSE = "CC BY 4.0"
CITATION = (
    "Weil, E.F., Schizas, N.V., & Cruz Motta, J.J. (2025). Benthic community "
    "data from surveys of reefs in southwestern Puerto Rico during 2018 and "
    "2020. BCO-DMO dataset 958181 v1. https://doi.org/10.26008/1912/bco-dmo.958181.1"
)


def _decimal(value: str, field: str, *, allow_empty: bool = False) -> Decimal | None:
    value = value.strip()
    if not value:
        if allow_empty:
            return None
        raise ValueError(f"{field} is required")
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(f"{field} must be numeric") from exc
    if not number.is_finite():
        raise ValueError(f"{field} must be finite")
    return number


def _source_site_id(row: dict[str, str]) -> str:
    # Preserve the release's literal site/transect identity; do not merge on
    # coordinates or normalize locality spellings without source confirmation.
    return "|".join((row["Locality"].strip(), row["Reef_Number"].strip(), row["Transect"].strip(), row["Depth"].strip()))


def adapt_csv(source: Path, *, generated_at: str | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    grouped: dict[tuple[str, str, str, str, str], list[dict[str, str]]] = defaultdict(list)
    with source.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"Date", "Locality", "Latitude", "Longitude", "Reef_Number", "Transect", "Depth", "Group", "percent_cover"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"Source columns missing: {sorted(required - set(reader.fieldnames or []))}")
        raw_rows = list(reader)

    for row in raw_rows:
        date = row["Date"].strip()
        try:
            datetime.strptime(date, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError(f"Date must be an ISO calendar date: {date!r}") from exc
        if not row["Locality"].strip() or not row["Reef_Number"].strip() or not row["Transect"].strip():
            raise ValueError("Locality, Reef_Number, and Transect are required")
        for field in ("Latitude", "Longitude", "Depth"):
            if _decimal(row[field], field) is None:
                raise ValueError(f"{field} is required")
        key = (row["Date"].strip(), row["Locality"].strip(), row["Reef_Number"].strip(), row["Transect"].strip(), row["Depth"].strip())
        grouped[key].append(row)

    records = []
    missing_metric_events = 0
    measurement_row_count = 0
    for key, rows in sorted(grouped.items()):
        date, locality, reef_number, transect, depth_text = key
        first = rows[0]
        lat = _decimal(first["Latitude"], "Latitude")
        lon = _decimal(first["Longitude"], "Longitude")
        depth = _decimal(depth_text, "Depth")
        if lat is None or not -90 <= lat <= 90:
            raise ValueError("Latitude outside -90..90")
        if lon is None or not -180 <= lon <= 180:
            raise ValueError("Longitude outside -180..180")
        for row in rows[1:]:
            if _decimal(row["Latitude"], "Latitude") != lat or _decimal(row["Longitude"], "Longitude") != lon:
                raise ValueError(f"Coordinates change within source survey {key}")

        coral_rows = [row for row in rows if row["Group"].strip() == "SCL"]
        if coral_rows:
            coral_values = [_decimal(row["percent_cover"], "percent_cover") for row in coral_rows]
            if any(value is None for value in coral_values):
                raise ValueError(f"Incomplete SCL cover rows for source survey {key}")
            coral_total = sum(coral_values, Decimal(0))
            if not 0 <= coral_total <= 100:
                raise ValueError(f"Summed SCL percent cover outside 0..100 for source survey {key}")
            coral_cover: float | None = float(coral_total)
            measurement_row_count += len(coral_rows)
        else:
            coral_cover = None
            missing_metric_events += 1

        site_id = _source_site_id(first)
        event_id = f"bco-dmo-958181:{site_id}:{date}"
        records.append({
            "schemaVersion": 3,
            "id": event_id,
            "location": {
                "lat": float(lat), "lon": float(lon), "siteName": f"{locality}, reef {reef_number}, transect {transect}",
                "region": "Southwestern Puerto Rico", "country": "Puerto Rico", "sourceSiteId": site_id,
            },
            "survey": {
                "date": date, "datePrecision": "day", "managementRegime": None,
                "sampleId": f"reef-{reef_number}-transect-{transect}", "sourceRowNumber": None,
            },
            "protocols": [{
                "method": "10 m line transect; in-situ substrate identification",
                "sourceMethod": "Linear distance of each substrate beneath the transect tape; source percent_cover values are aggregated by substrate group per transect",
                "sampleUnitCount": None,
                "depth": {"meanM": float(depth), "sdM": None},
                "dataPolicy": None,
                "metrics": {
                    "hardCoralCover": {
                        "valuePct": coral_cover, "sdPct": None, "basis": "benthic-cover",
                        "sourceMetricName": "sum(percent_cover) where Group = SCL",
                    }
                },
            }],
            "quality": {"confidenceLevel": None},
            "provenance": {
                "provider": PROVIDER, "projectId": DOI, "sourceRecordId": event_id,
                "projectName": "RAPID: Microbiome and population dynamics in scleractinian coral tissue loss disease infected corals in Puerto Rico",
                "suggestedCitation": CITATION, "license": LICENSE, "sourceUrl": SOURCE_URL,
                "sourceMetricSemantics": "Hard coral cover is calculated by summing the release's scleractinian (SCL) substrate-group percent_cover rows within one original transect survey. Other coral groups are not merged; absent SCL rows remain null.",
            },
        })

    sites: dict[str, list[str]] = defaultdict(list)
    for record in records:
        sites[record["location"]["sourceSiteId"]].append(record["survey"]["date"])
    dates = [record["survey"]["date"] for record in records]
    dataset = {
        "schemaVersion": 3,
        "metadata": {
            "provider": PROVIDER,
            "datasetType": "local-pilot",
            "eventCount": len(records),
            "sourceSiteCount": len(sites),
            "generatedAt": generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "redistributionApproved": True,
            "dateRange": {"from": min(dates), "to": max(dates)},
            "sourceDoi": DOI,
            "license": LICENSE,
            "sourceUrl": SOURCE_URL,
        },
        "records": records,
    }
    report = {
        "provider": PROVIDER,
        "sourceDoi": DOI,
        "license": LICENSE,
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "rawRowCount": len(raw_rows),
        "eventCount": len(records),
        "sourceSiteCount": len(sites),
        "repeatedSiteCount": sum(len(site_dates) > 1 for site_dates in sites.values()),
        "maxEventsPerSite": max(map(len, sites.values()), default=0),
        "dateRange": dataset["metadata"]["dateRange"],
        "eventsByYear": dict(sorted(Counter(date[:4] for date in dates).items())),
        "hardCoralCoverEvents": sum(record["protocols"][0]["metrics"]["hardCoralCover"]["valuePct"] is not None for record in records),
        "hardCoralCoverMissingEvents": missing_metric_events,
        "scleractinianMeasurementRows": measurement_row_count,
        "macroalgaeMapped": False,
        "aggregation": "Sum source percent_cover for SCL rows within each source date/locality/reef/transect/depth event.",
    }
    return dataset, report


def write_gzip(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with path.open("wb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0, compresslevel=9) as stream:
            stream.write(raw)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "data/.build/reef_condition/phase4-8/workstream-b/raw/958181_v1_reef_surveys_2018_2020.csv")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data/.build/reef_condition/phase4-8/workstream-b/output")
    args = parser.parse_args()
    if not args.input.resolve().is_relative_to((ROOT / "data/.build").resolve()):
        raise SystemExit("Input must remain under ignored data/.build")
    if not args.output_dir.resolve().is_relative_to((ROOT / "data/.build").resolve()):
        raise SystemExit("Output must remain under ignored data/.build")
    dataset, report = adapt_csv(args.input)
    write_gzip(args.output_dir / "canonical-v3.json.gz", dataset)
    (args.output_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
