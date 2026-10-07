#!/usr/bin/env python3
"""Export dive sites with no legacy type labels for evidence-backed review."""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "datasets/dive-sites.js"
DEFAULT_OUTPUT = ROOT / "artifacts/dive-site-category-review.csv"
FIELDS = [
    "site_id",
    "name",
    "latitude",
    "longitude",
    "country",
    "region",
    "listed_sources",
    "legacy_types",
    "setting",
    "access",
    "features",
    "evidence_source",
    "evidence_url_or_id",
    "review_status",
    "review_notes",
]


def load_sites(path: Path) -> list[list[object]]:
    text = path.read_text(encoding="utf-8-sig")
    match = re.search(r"window\.DIVE_SITES_DATA\s*=\s*(\[.*?\])\s*;", text, re.S)
    if not match:
        raise ValueError(f"Could not find DIVE_SITES_DATA array in {path}")
    rows = json.loads(match.group(1))
    if not isinstance(rows, list):
        raise ValueError("DIVE_SITES_DATA must be an array")
    return rows


def review_rows(sites: list[list[object]]) -> list[dict[str, str]]:
    result = []
    for row in sites:
        if len(row) < 13:
            raise ValueError(f"Site row has {len(row)} fields; expected at least 13")
        if str(row[7] or "").strip():
            continue
        result.append(
            {
                "site_id": str(row[12] or ""),
                "name": str(row[0] or ""),
                "latitude": "" if row[1] is None else str(row[1]),
                "longitude": "" if row[2] is None else str(row[2]),
                "country": str(row[9] or ""),
                "region": str(row[10] or ""),
                "listed_sources": str(row[8] or ""),
                "legacy_types": str(row[7] or ""),
                "setting": "",
                "access": "",
                "features": "",
                "evidence_source": "",
                "evidence_url_or_id": "",
                "review_status": "unreviewed",
                "review_notes": "",
            }
        )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DATA_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    rows = review_rows(load_sites(args.input))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Exported {len(rows)} uncategorized dive sites to {args.output}")


if __name__ == "__main__":
    main()
