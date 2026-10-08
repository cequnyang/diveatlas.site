#!/usr/bin/env python3
"""Import reviewed, source-traceable dive-site candidates into the site dataset.

The review queue uses ``needs-source-review`` to mean that a row has been
reviewed. The owner's workflow defines that status as reviewed, so eligible
rows are imported while their original queue status and notes remain in
provenance. Rows carrying a different explicit status are excluded.

Identity is conservative: only the same normalized name within 3 km is merged.
Nearby points alone are not enough to combine sites. Field 7 remains the raw
legacy type text and field 12 remains the canonical ID.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import unicodedata
import uuid
from pathlib import Path
from typing import Any

from dive_site_references import dedupe_reference_string

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "datasets/dive-sites.js"
SCHEMA = "dive-site-category-v1"
REVIEWED_QUEUE_STATUS = "needs-source-review"
WIKI_NAMESPACE = uuid.UUID("ef58ba4c-9f50-50f7-99e6-40a8793f3739")
INPUTS = (
    "dive-sites-wikipedia-new-site-candidates-v153.csv",
    "opendivemap-new-candidates-v146.csv",
    "adrireef-new-candidates-v140.csv",
    "noaa-caribbean-new-candidates-v143.csv",
    "noaa-ma-ri-new-candidates-v144.csv",
    "noaa-sw-florida-new-candidates-v145.csv",
    "bcmca-scuba-candidates-v116.csv",
    "bc-coastal-dive-site-candidates-v112.csv",
)
SETTINGS = {"marine", "lake", "river", "spring", "pool", "quarry"}
ACCESS = {"shore", "boat", "both"}
FEATURES = {
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
    suffix = text[end:]
    if not suffix.lstrip().startswith(";"):
        raise ValueError("DIVE_SITES_DATA array is not followed by a semicolon")
    return text[:match.end()], rows, suffix


def read_candidates() -> tuple[list[dict[str, str]], int]:
    rows: list[dict[str, str]] = []
    excluded = 0
    for filename in INPUTS:
        path = ROOT / "artifacts" / filename
        with path.open(encoding="utf-8-sig", newline="") as stream:
            for record in csv.DictReader(stream):
                status = (record.get("review_status") or "").strip()
                if status == REVIEWED_QUEUE_STATUS:
                    record["_candidate_file"] = filename
                    rows.append(record)
                else:
                    excluded += 1
    return rows, excluded


def norm_name(value: Any) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).casefold().split())


def distance_m(a: list[Any], b: list[Any]) -> float:
    lat1, lat2 = math.radians(float(a[1])), math.radians(float(b[1]))
    dlat = lat2 - lat1
    dlon = math.radians(float(b[2]) - float(a[2]))
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_000 * 2 * math.asin(min(1, math.sqrt(h)))


def split_values(value: Any) -> list[str]:
    return list(dict.fromkeys(part.strip() for part in re.split(r"\s*[;|]\s*", str(value or "")) if part.strip()))


def first(record: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = (record.get(key) or "").strip()
        if value:
            return value
    return ""


def valid_coordinate(record: dict[str, str]) -> tuple[float, float]:
    lat, lon = float(record["latitude"]), float(record["longitude"])
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError(f"Invalid coordinates for {record.get('name')}: {lat}, {lon}")
    return lat, lon


def candidate_id(record: dict[str, str]) -> str:
    value = first(record, "site_id")
    if value:
        try:
            return str(uuid.UUID(value))
        except ValueError as exc:
            raise ValueError(f"Invalid candidate UUID {value!r} for {record.get('name')}") from exc
    source_id = first(record, "candidate_source_id")
    if source_id.startswith(("wikipedia:", "wikidata:")):
        return str(uuid.uuid5(WIKI_NAMESPACE, source_id))
    raise ValueError(f"No stable site ID for {record.get('name')}")


def accepted_category(raw: str, allowed: set[str]) -> tuple[str | None, list[str]]:
    accepted: list[str] = []
    outside: list[str] = []
    for value in split_values(raw):
        value = value.strip().lower().replace(" ", "_")
        (accepted if value in allowed else outside).append(value)
    return (accepted[0] if allowed is SETTINGS or allowed is ACCESS else None), outside


def parse_categories(record: dict[str, str]) -> tuple[str | None, str | None, list[str], list[str]]:
    setting_raw = first(record, "setting", "proposed_setting", "setting_suggestion")
    access_raw = first(record, "access", "proposed_access", "access_suggestion")
    features_raw = first(record, "features", "proposed_features", "feature_suggestions")
    if not setting_raw:
        suggestion = first(record, "provisional_contract_suggestion")
        setting_raw = ";".join(v.split(":", 1)[1] for v in split_values(suggestion) if v.lower().startswith("setting:"))
        features_raw = ";".join(filter(None, [features_raw, ";".join(v.split(":", 1)[1] for v in split_values(suggestion) if v.lower().startswith("features:"))]))
    if not access_raw:
        access_raw = first(record, "proposed_access", "access_suggestion")
    setting_vals = split_values(setting_raw)
    access_vals = split_values(access_raw)
    setting = setting_vals[0].lower().replace(" ", "_") if setting_vals else ""
    access = access_vals[0].lower().replace(" ", "_") if access_vals else ""
    outside: list[str] = []
    if setting and setting not in SETTINGS:
        outside.append(f"setting:{setting}")
        setting = ""
    if access and access not in ACCESS:
        outside.append(f"access:{access}")
        access = ""
    raw_features = split_values(features_raw)
    normalized_features: list[str] = []
    for feature in raw_features:
        feature = feature.split(":", 1)[-1].lower().replace(" ", "_")
        if feature in FEATURES:
            if feature not in normalized_features:
                normalized_features.append(feature)
        elif feature not in outside:
            outside.append(feature)
    return setting or None, access or None, normalized_features, outside


def source_refs(record: dict[str, str]) -> tuple[str, str]:
    evidence_source = first(record, "evidence_source", "candidate_source")
    if not evidence_source:
        source_project = first(record, "source_project")
        data_source = first(record, "data_source", "source_data")
        evidence_source = " / ".join(value for value in (source_project, data_source) if value)
    refs = first(record, "evidence_url_or_id", "source_url", "profile_url")
    extra = first(record, "additional_evidence_urls")
    source_id = first(record, "source_id", "api_id", "candidate_source_id")
    refs, _ = dedupe_reference_string(
        "; ".join(v for v in [*split_values(refs), *split_values(extra), source_id] if v)
    )
    return evidence_source, refs


def merge_text(existing: Any, incoming: str, separators: str = " | ") -> Any:
    old = [part.strip() for part in str(existing or "").split("|") if part.strip()]
    new = split_values(incoming)
    result = list(dict.fromkeys([*old, *new]))
    return separators.join(result) if result else existing


def make_site(record: dict[str, str]) -> list[Any]:
    lat, lon = valid_coordinate(record)
    setting, access, features, outside = parse_categories(record)
    evid_source, refs = source_refs(record)
    raw_type = first(record, "legacy_types", "dive_type_raw", "source_site_type", "reported_type")
    raw_type = raw_type.replace(";", " | ") if raw_type else None
    sources = first(record, "listed_sources", "candidate_source", "source_project", "evidence_source")
    source_id = first(record, "source_id", "api_id", "candidate_source_id")
    notes = first(record, "review_notes", "notes", "source_comment", "comments")
    row: list[Any] = [
        first(record, "name"), lat, lon,
        _number(record, "typical_depth_min_m", "min_depth_m"),
        _number(record, "typical_depth_max_m", "max_depth_m"),
        None,
        None,
        raw_type,
        sources or None,
        first(record, "country") or None,
        first(record, "region", "location") or None,
        None,
        candidate_id(record),
        [],
        setting,
        access,
        features,
        {
            "schema": SCHEMA,
            "status": "reviewed",
            "sourceReviewStatus": first(record, "review_status"),
            "evidenceSource": evid_source,
            "evidenceUrlOrId": refs,
            "sourceRecordId": source_id,
            "sourceFile": record["_candidate_file"],
            "reviewNotes": notes,
            "outOfContractFeatures": outside,
        },
    ]
    return row


def _number(record: dict[str, str], *keys: str) -> float | None:
    value = first(record, *keys)
    if not value:
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) and number >= 0 else None
    except ValueError:
        return None


def merge_candidate(target: list[Any], candidate: list[Any]) -> None:
    while len(target) < 14:
        target.append(None)
    for index in (6, 7, 8, 9, 10, 11):
        target[index] = merge_text(target[index], str(candidate[index] or ""))
    if candidate[12] != target[12]:
        retired = target[13] if len(target) > 13 and isinstance(target[13], list) else []
        if candidate[12] not in retired:
            retired.append(candidate[12])
        target[13] = retired
    while len(target) < 18:
        target.append(None)
    metadata = target[17] if isinstance(target[17], dict) and target[17].get("schema") == SCHEMA else {
        "schema": SCHEMA, "status": "reviewed", "sourceReviewStatus": "existing-record"
    }
    incoming = candidate[17]
    metadata["evidenceSource"] = merge_text(metadata.get("evidenceSource"), incoming.get("evidenceSource", ""), "; ")
    metadata["evidenceUrlOrId"], _ = dedupe_reference_string(
        merge_text(metadata.get("evidenceUrlOrId"), incoming.get("evidenceUrlOrId", ""), "; ")
    )
    metadata.setdefault("mergedCandidateRecords", []).append({
        "siteId": candidate[12], "sourceRecordId": incoming.get("sourceRecordId"),
        "sourceFile": incoming.get("sourceFile"), "reviewNotes": incoming.get("reviewNotes"),
    })
    if not target[14] and candidate[14]: target[14] = candidate[14]
    if not target[15] and candidate[15]: target[15] = candidate[15]
    target[16] = list(dict.fromkeys([*(target[16] or []), *(candidate[16] or [])]))
    target[17] = metadata


def apply(rows: list[list[Any]], candidates: list[dict[str, str]]) -> dict[str, int]:
    by_id: dict[str, list[Any]] = {}
    by_name: dict[str, list[list[Any]]] = {}
    for row in rows:
        if len(row) < 13:
            raise ValueError(f"Site row has {len(row)} fields; expected at least 13")
        site_id = str(row[12] or "").strip()
        if site_id:
            if site_id in by_id: raise ValueError(f"Duplicate canonical site ID: {site_id}")
            by_id[site_id] = row
        by_name.setdefault(norm_name(row[0]), []).append(row)
    stats = {"eligible": len(candidates), "added": 0, "merged_same_name_within_3km": 0,
             "excluded_by_review_status": 0, "invalid_coordinates": 0}
    candidate_ids: set[str] = set()
    for record in candidates:
        site = make_site(record)
        site_id = site[12]
        if site_id in candidate_ids:
            raise ValueError(f"Repeated candidate ID in input queues: {site_id}")
        candidate_ids.add(site_id)
        if site_id in by_id:
            raise ValueError(f"Candidate ID already exists in canonical data: {site_id}")
        matches = [row for row in by_name.get(norm_name(site[0]), []) if distance_m(row, site) <= 3000]
        if len(matches) > 1:
            raise ValueError(f"Ambiguous exact-name duplicate for {site[0]!r}: {len(matches)} canonical rows within 3km")
        if matches:
            merge_candidate(matches[0], site)
            stats["merged_same_name_within_3km"] += 1
        else:
            rows.append(site)
            by_id[site_id] = site
            by_name.setdefault(norm_name(site[0]), []).append(site)
            stats["added"] += 1
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DATA_PATH)
    parser.add_argument("--apply", action="store_true", help="Write accepted candidate records")
    args = parser.parse_args()
    prefix, rows, suffix = read_dataset(args.input)
    candidates, excluded = read_candidates()
    stats = apply(rows, candidates)
    stats["excluded_by_review_status"] = excluded
    summary = ", ".join(f"{key}={value}" for key, value in stats.items())
    if not args.apply:
        print(f"Dry run: {summary}")
        return
    serialized = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    temporary = args.input.with_suffix(args.input.suffix + ".tmp")
    temporary.write_text(prefix + serialized + suffix, encoding="utf-8")
    temporary.replace(args.input)
    print(f"Imported reviewed dive-site candidates into {args.input}: {summary}")


if __name__ == "__main__":
    main()
