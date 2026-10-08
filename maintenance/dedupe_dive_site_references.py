#!/usr/bin/env python3
"""Remove repeated source URLs and record IDs within each dive-site record."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from dive_site_references import dedupe_reference_string

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "datasets/dive-sites.js"


def read_dataset(path: Path) -> tuple[str, list[list[Any]], str]:
    text = path.read_text(encoding="utf-8-sig")
    marker = re.search(r"window\.DIVE_SITES_DATA\s*=\s*", text)
    if not marker:
        raise ValueError(f"Could not find DIVE_SITES_DATA in {path}")
    rows, end = json.JSONDecoder().raw_decode(text, marker.end())
    if not isinstance(rows, list) or any(not isinstance(row, list) for row in rows):
        raise ValueError("DIVE_SITES_DATA must be an array of site arrays")
    suffix = text[end:]
    if not suffix.lstrip().startswith(";"):
        raise ValueError("DIVE_SITES_DATA array is not followed by a semicolon")
    return text[:marker.end()], rows, suffix


def dedupe_sites(rows: list[list[Any]]) -> tuple[dict[str, int], list[dict[str, Any]]]:
    stats = {"sites_with_repeats": 0, "references_removed": 0}
    examples: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for row in rows:
        if len(row) <= 17 or not isinstance(row[17], dict):
            continue
        site_id = str(row[12] or "") if len(row) > 12 else ""
        if site_id and site_id in seen_ids:
            raise ValueError(f"Duplicate canonical site ID: {site_id}")
        if site_id:
            seen_ids.add(site_id)
        metadata = row[17]
        normalized, removed = dedupe_reference_string(metadata.get("evidenceUrlOrId", ""))
        if not removed:
            continue
        stats["sites_with_repeats"] += 1
        stats["references_removed"] += removed
        metadata["evidenceUrlOrId"] = normalized
        if len(examples) < 20:
            examples.append({"name": row[0], "site_id": site_id, "references_removed": removed})
    return stats, examples


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DATA_PATH)
    parser.add_argument("--apply", action="store_true", help="Write the deduplicated references")
    args = parser.parse_args()

    prefix, rows, suffix = read_dataset(args.input)
    stats, examples = dedupe_sites(rows)
    print(json.dumps({**stats, "examples": examples}, ensure_ascii=False, indent=2))
    if not args.apply:
        print("Dry run only. Pass --apply to update the dataset.")
        return

    serialized = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    temporary = args.input.with_suffix(args.input.suffix + ".tmp")
    temporary.write_text(prefix + serialized + suffix, encoding="utf-8")
    temporary.replace(args.input)
    print(f"Updated {args.input}")


if __name__ == "__main__":
    main()
