#!/usr/bin/env python3
"""Normalize only reviewed, unambiguous legacy type-label mappings.

The legacy text in field 7 remains the source of truth and is never rewritten.
Rows flagged for taxonomy adjudication are deliberately skipped; this script
only adds the already reviewed direct mappings to fields 14-17.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from typing import Any

from dive_site_references import dedupe_reference_string

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "datasets/dive-sites.js"
REVIEW_PATH = ROOT / "artifacts/dive-site-category-normalization-audit-v154.csv"
SCHEMA = "dive-site-category-v1"
SETTING_VALUES = {"marine", "lake", "river", "spring", "pool", "quarry"}
ACCESS_VALUES = {"shore", "boat", "both"}
FEATURE_VALUES = {
    "reef", "artificial_reef", "wall", "wreck", "cave", "cavern", "pinnacle",
    "seamount", "boulder", "channel", "sandy_bottom", "kelp", "muck", "drift",
    "archaeological", "manta",
}


def read_dataset(path: Path) -> tuple[str, list[list[Any]], str]:
    text = path.read_text(encoding="utf-8-sig")
    match = re.search(r"window\.DIVE_SITES_DATA\s*=\s*", text)
    if not match: raise ValueError(f"Could not isolate DIVE_SITES_DATA array in {path}")
    rows, end = json.JSONDecoder().raw_decode(text, match.end())
    if not isinstance(rows, list) or any(not isinstance(row, list) for row in rows):
        raise ValueError("DIVE_SITES_DATA must be an array of site arrays")
    suffix = text[end:]
    if not suffix.lstrip().startswith(";"): raise ValueError("DIVE_SITES_DATA array is not followed by a semicolon")
    return text[:match.end()], rows, suffix


def split_features(raw: str) -> tuple[list[str], list[str]]:
    accepted: list[str] = []
    outside: list[str] = []
    for value in raw.split(";"):
        feature = value.strip()
        if not feature: continue
        target = accepted if feature in FEATURE_VALUES else outside
        if feature not in target: target.append(feature)
    return accepted, outside


def apply(rows: list[list[Any]], audit: list[dict[str, str]]) -> dict[str, int]:
    by_id: dict[str, list[Any]] = {}
    for row in rows:
        if len(row) < 13: raise ValueError(f"Site row has {len(row)} fields; expected at least 13")
        site_id = str(row[12] or "").strip()
        if site_id:
            if site_id in by_id: raise ValueError(f"Duplicate canonical site ID: {site_id}")
            by_id[site_id] = row

    stats = {"direct_mappings_added": 0, "already_structured": 0, "adjudication_rows_skipped": 0,
             "stale_audit_rows_skipped": 0, "out_of_contract_features_preserved": 0}
    seen: set[str] = set()
    for item in audit:
        site_id = item.get("site_id", "").strip()
        if not site_id: continue
        if site_id in seen: raise ValueError(f"Duplicate site ID in normalization audit: {site_id}")
        seen.add(site_id)
        status = item.get("normalization_status", "").strip()
        if status != "direct-contract-label-mapping":
            stats["adjudication_rows_skipped"] += 1
            continue
        row = by_id.get(site_id)
        if row is None:
            stats["stale_audit_rows_skipped"] += 1
            continue
        if len(row) > 17 and isinstance(row[17], dict) and row[17].get("schema") == SCHEMA:
            stats["already_structured"] += 1
            continue
        if any(value not in (None, "", []) for value in row[14:18]):
            raise ValueError(f"Unexpected occupied category slots for {site_id}")
        setting = item.get("proposed_setting", "").strip()
        access = item.get("proposed_access", "").strip()
        if setting and setting not in SETTING_VALUES: raise ValueError(f"Invalid setting {setting!r} for {site_id}")
        if access and access not in ACCESS_VALUES: raise ValueError(f"Invalid access {access!r} for {site_id}")
        features, outside = split_features(item.get("proposed_features", ""))
        while len(row) < 18: row.append(None)
        row[14], row[15], row[16] = setting or None, access or None, features
        row[17] = {
            "schema": SCHEMA,
            "status": "reviewed",
            "sourceReviewStatus": item.get("review_status", "").strip(),
            "evidenceSource": item.get("evidence_source", "").strip(),
            "evidenceUrlOrId": dedupe_reference_string(
                item.get("evidence_url_or_id", "")
            )[0],
            "outOfContractFeatures": outside,
        }
        stats["direct_mappings_added"] += 1
        stats["out_of_contract_features_preserved"] += len(outside)
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DATA_PATH)
    parser.add_argument("--audit", type=Path, default=REVIEW_PATH)
    parser.add_argument("--apply", action="store_true", help="Write direct category mappings")
    args = parser.parse_args()
    with args.audit.open(encoding="utf-8-sig", newline="") as stream:
        audit = list(csv.DictReader(stream))
    prefix, rows, suffix = read_dataset(args.input)
    stats = apply(rows, audit)
    summary = ", ".join(f"{key}={value}" for key, value in stats.items())
    if not args.apply:
        print(f"Dry run: {summary}")
        return
    serialized = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    temporary = args.input.with_suffix(args.input.suffix + ".tmp")
    temporary.write_text(prefix + serialized + suffix, encoding="utf-8")
    temporary.replace(args.input)
    print(f"Applied direct category mappings to {args.input}: {summary}")


if __name__ == "__main__":
    main()
