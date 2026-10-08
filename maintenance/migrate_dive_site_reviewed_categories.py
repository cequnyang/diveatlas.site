#!/usr/bin/env python3
"""Apply reviewed category fields by stable DiveAtlas ID, preserving legacy data.

The reviewed export's ``needs-source-review`` status is treated as reviewed
because that is the owner's explicit meaning for this dataset. The literal
upstream status is retained in each row's provenance object. ``unreviewed``
rows are not modified. Labels outside the category contract remain in
provenance instead of being discarded or silently normalized.
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
REVIEW_PATH = ROOT / "artifacts/dive-site-category-review-reviewed-v149.csv"
SCHEMA = "dive-site-category-v1"
REVIEWED_STATUS = "needs-source-review"
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
    if not match:
        raise ValueError(f"Could not isolate DIVE_SITES_DATA array in {path}")
    rows, end = json.JSONDecoder().raw_decode(text, match.end())
    if not isinstance(rows, list) or any(not isinstance(row, list) for row in rows):
        raise ValueError("DIVE_SITES_DATA must be an array of site arrays")
    prefix = text[: match.end()]
    suffix = text[end:]
    if not suffix.lstrip().startswith(";"):
        raise ValueError("DIVE_SITES_DATA array is not followed by a semicolon")
    return prefix, rows, suffix


def read_review(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def split_features(raw: str) -> tuple[list[str], list[str]]:
    accepted: list[str] = []
    outside_contract: list[str] = []
    for value in raw.split(";"):
        feature = value.strip()
        if not feature:
            continue
        target = accepted if feature in FEATURE_VALUES else outside_contract
        if feature not in target:
            target.append(feature)
    return accepted, outside_contract


def apply_review(rows: list[list[Any]], review: list[dict[str, str]]) -> dict[str, int]:
    by_id: dict[str, list[Any]] = {}
    for row in rows:
        if len(row) < 13:
            raise ValueError(f"Site row has {len(row)} fields; expected at least 13")
        site_id = str(row[12] or "").strip()
        if site_id:
            if site_id in by_id:
                raise ValueError(f"Duplicate canonical site ID: {site_id}")
            by_id[site_id] = row

    counts = {
        "reviewed_rows": 0,
        "rows_with_categories": 0,
        "unreviewed_rows_skipped": 0,
        "stale_review_rows_skipped": 0,
        "out_of_contract_feature_values": 0,
    }
    seen_review_ids: set[str] = set()
    for item in review:
        site_id = item.get("site_id", "").strip()
        if not site_id:
            continue
        if site_id in seen_review_ids:
            raise ValueError(f"Duplicate site ID in review export: {site_id}")
        seen_review_ids.add(site_id)

        source_status = item.get("review_status", "").strip()
        if source_status == "unreviewed":
            counts["unreviewed_rows_skipped"] += 1
            continue
        if source_status != REVIEWED_STATUS:
            continue
        row = by_id.get(site_id)
        if row is None:
            counts["stale_review_rows_skipped"] += 1
            continue

        # Slots 0-13 are the existing record contract: field 7 is raw legacy
        # text, field 12 is the stable ID, and field 13 is retired IDs.
        if len(row) > 17:
            existing = row[17]
            if isinstance(existing, dict) and existing.get("schema") == SCHEMA:
                continue
            if any(value not in (None, "", []) for value in row[14:18]):
                raise ValueError(f"Unexpected occupied category slots for {site_id}")
        while len(row) < 14:
            row.append(None)
        while len(row) < 18:
            row.append(None)

        setting = item.get("setting", "").strip()
        access = item.get("access", "").strip()
        if setting and setting not in SETTING_VALUES:
            raise ValueError(f"Out-of-contract setting {setting!r} for {site_id}")
        if access and access not in ACCESS_VALUES:
            raise ValueError(f"Out-of-contract access {access!r} for {site_id}")
        features, outside_features = split_features(item.get("features", ""))

        row[14] = setting or None
        row[15] = access or None
        row[16] = features
        row[17] = {
            "schema": SCHEMA,
            "status": "reviewed",
            "sourceReviewStatus": source_status,
            "evidenceSource": item.get("evidence_source", "").strip(),
            "evidenceUrlOrId": dedupe_reference_string(
                item.get("evidence_url_or_id", "")
            )[0],
            "outOfContractFeatures": outside_features,
        }
        counts["reviewed_rows"] += 1
        if setting or access or features:
            counts["rows_with_categories"] += 1
        counts["out_of_contract_feature_values"] += len(outside_features)

    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DATA_PATH)
    parser.add_argument("--review", type=Path, default=REVIEW_PATH)
    parser.add_argument("--apply", action="store_true", help="Write reviewed fields to the dataset")
    args = parser.parse_args()

    prefix, rows, suffix = read_dataset(args.input)
    counts = apply_review(rows, read_review(args.review))
    summary = ", ".join(f"{key}={value}" for key, value in counts.items())
    if not args.apply:
        print(f"Dry run: {summary}")
        return

    serialized = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    temporary = args.input.with_suffix(args.input.suffix + ".tmp")
    temporary.write_text(prefix + serialized + suffix, encoding="utf-8")
    temporary.replace(args.input)
    print(f"Applied reviewed category migration to {args.input}: {summary}")


if __name__ == "__main__":
    main()
