#!/usr/bin/env python3
"""Audit canonical site attributes and reusable source descriptions by ID.

Streams the large, untracked review exports instead of copying or modifying
them. Counts are coverage indicators, not proof that every source claim is
accurate or publishable.
"""

from __future__ import annotations

import csv
import gzip
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "datasets/dive-sites.js"
SUMMARY_DATA = ROOT / "datasets/dive-site-summaries.json.gz"
ARTIFACTS = ROOT / "artifacts"
EVIDENCE = ARTIFACTS / "dive-site-all-source-review-evidence-v147.csv"
ADJUDICATIONS = ARTIFACTS / "site-page-adjudications-v147.csv"
SCHEMA = "dive-site-category-v1"


def load_sites() -> list[list[Any]]:
    text = DATA.read_text(encoding="utf-8-sig")
    marker = re.search(r"window\.DIVE_SITES_DATA\s*=\s*", text)
    if not marker:
        raise ValueError(f"Could not find DIVE_SITES_DATA in {DATA}")
    sites, _ = json.JSONDecoder().raw_decode(text, marker.end())
    if not isinstance(sites, list) or any(not isinstance(site, list) for site in sites):
        raise ValueError("DIVE_SITES_DATA is not an array of site rows")
    return sites


def extract_description_values(value: Any, key: str = "") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for child_key, child in value.items():
            found.extend(extract_description_values(child, child_key))
    elif isinstance(value, list):
        for child in value:
            found.extend(extract_description_values(child, key))
    elif isinstance(value, str):
        key_lower = key.casefold()
        if any(token in key_lower for token in ("description", "topography", "site_profile", "site_info")):
            cleaned = " ".join(value.split())
            if len(cleaned) >= 50:
                found.append(cleaned)
    return found


def has_description_text(row: dict[str, str]) -> bool:
    notes = " ".join((row.get("source_description_or_notes") or "").split())
    # Generic snapshot caveats and field inventories are not site narratives.
    explicit = re.search(
        r"(?:Profile )?Description:\s*(.+?)(?:\s+(?:Wildlife|Community-maintained|OpenDiveMap structured profile fields)\s*:|$)",
        notes,
        re.IGNORECASE,
    )
    if explicit and len(explicit.group(1).strip()) >= 50:
        return True
    try:
        raw_fields = json.loads(row.get("source_fields_raw") or "null")
    except (json.JSONDecodeError, TypeError):
        return False
    return bool(extract_description_values(raw_fields))


def has_http_reference(*values: str) -> bool:
    return any(re.search(r"https?://[^\s;\]]+", value or "", re.IGNORECASE) for value in values)


def load_summary_metrics(canonical_ids: set[str]) -> dict[str, int]:
    if not SUMMARY_DATA.exists():
        return {}
    duplicate_ids = 0

    def track_duplicate_ids(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        nonlocal duplicate_ids
        result: dict[str, Any] = {}
        seen_ids: set[str] = set()
        for key, value in pairs:
            if re.fullmatch(r"[0-9a-f-]{36}", key, re.IGNORECASE):
                site_id = key.lower()
                if site_id in seen_ids:
                    duplicate_ids += 1
                seen_ids.add(site_id)
            result[key] = value
        return result

    payload = json.loads(
        gzip.decompress(SUMMARY_DATA.read_bytes()),
        object_pairs_hook=track_duplicate_ids,
    )
    defaults = payload.get("defaults") or {}
    snapshot_defaults = payload.get("profileSnapshotDefaults") or defaults
    summaries: dict[str, dict[str, Any]] = {
        str(site_id).lower(): summary
        for site_id, summary in (payload.get("bySiteId") or {}).items()
    }

    records_with_url = 0
    url_count = 0
    invalid_url_count = 0
    source_only = 0
    no_source_records = 0
    unpublished_records = 0
    no_description_records = 0
    unmatched_ids = 0
    contributor_profile_summaries = 0
    operator_summaries = 0
    profile_snapshot_summaries = 0
    for site_id, summary in summaries.items():
        if site_id not in canonical_ids:
            unmatched_ids += 1
        sources = summary.get("sources") or []
        no_source_records += not bool(sources)
        urls = [
            source[1] if isinstance(source, list) and len(source) > 1 else source.get("url", "")
            for source in sources
            if isinstance(source, (dict, list))
        ]
        valid_urls = []
        for url in urls:
            if not url:
                continue
            parsed = urlparse(str(url))
            if parsed.scheme.lower() in {"http", "https"} and parsed.netloc and not re.search(r"\s", str(url)):
                valid_urls.append(str(url))
            else:
                invalid_url_count += 1
        record_url_count = len(valid_urls)
        records_with_url += bool(record_url_count)
        url_count += record_url_count
        source_only += bool(sources and not record_url_count)
        effective_defaults = snapshot_defaults if summary.get("type") == "profileSnapshot" else defaults
        status = summary.get("status") or effective_defaults.get("status")
        unpublished_records += status != "published"
        no_description_records += not bool((summary.get("description") or "").strip())
        source_classes = {
            source.get("sourceClass", "")
            for source in sources
            if isinstance(source, dict)
        }
        contributor_profile_summaries += "contributor-site-profile" in source_classes
        operator_summaries += "dive-operator-guide" in source_classes
        profile_snapshot_summaries += summary.get("type") == "profileSnapshot"

    return {
        "published_summary_records": len(summaries),
        "summary_records_with_public_url": records_with_url,
        "summary_public_url_count": url_count,
        "summary_invalid_public_url_count": invalid_url_count,
        "summary_records_with_named_sources_only": source_only,
        "summary_records_without_sources": no_source_records,
        "summary_records_without_descriptions": no_description_records,
        "summary_records_not_published": unpublished_records,
        "summary_ids_not_in_canonical_dataset": unmatched_ids,
        "duplicate_summary_ids": duplicate_ids,
        "contributor_profile_summary_records": contributor_profile_summaries,
        "operator_guide_summary_records": operator_summaries,
        "profile_snapshot_summary_records": profile_snapshot_summaries,
    }


def main() -> None:
    sites = load_sites()
    ids = {str(site[12]).strip() for site in sites if len(site) > 12 and site[12]}
    counts: Counter[str] = Counter()
    category_ids: set[str] = set()
    feature_ids: set[str] = set()
    depth_ids: set[str] = set()
    direct_url_ids: set[str] = set()
    category_url_ids: set[str] = set()
    category_depth_url_ids: set[str] = set()

    for site in sites:
        counts["canonical_sites"] += 1
        setting = bool(len(site) > 14 and site[14])
        access = bool(len(site) > 15 and site[15])
        features = bool(len(site) > 16 and site[16])
        category = setting or access or features
        depth = any(len(site) > index and site[index] not in (None, "") for index in (3, 4, 5))
        metadata = site[17] if len(site) > 17 and isinstance(site[17], dict) else {}
        refs = str(metadata.get("evidenceUrlOrId") or "")
        has_url = any(value.strip().startswith(("http://", "https://")) for value in refs.split(";"))
        site_id = str(site[12]).strip() if len(site) > 12 else ""
        if category:
            category_ids.add(site_id)
        if features:
            feature_ids.add(site_id)
        if depth:
            depth_ids.add(site_id)
        if has_url:
            direct_url_ids.add(site_id)
        if category and has_url:
            category_url_ids.add(site_id)
        if category and depth and has_url:
            category_depth_url_ids.add(site_id)

    counts.update({
        "sites_with_reviewed_categories": len(category_ids),
        "sites_with_reviewed_features": len(feature_ids),
        "sites_with_depth_value": len(depth_ids),
        "sites_with_direct_evidence_url": len(direct_url_ids),
        "sites_with_category_and_direct_url": len(category_url_ids),
        "sites_with_category_depth_and_direct_url": len(category_depth_url_ids),
    })

    described_ids: set[str] = set()
    direct_described_ids: set[str] = set()
    evidence_url_ids: set[str] = set()
    evidence_rows = 0
    evidence_site_ids: set[str] = set()
    evidence_classes: Counter[str] = Counter()
    if EVIDENCE.exists():
        with EVIDENCE.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                evidence_rows += 1
                site_id = (row.get("site_id") or "").strip()
                if site_id not in ids:
                    continue
                evidence_site_ids.add(site_id)
                evidence_classes[row.get("evidence_class", "").strip()] += 1
                has_url = has_http_reference(row.get("source_url", ""), row.get("source_citation_url", ""))
                if has_url:
                    evidence_url_ids.add(site_id)
                if has_description_text(row):
                    described_ids.add(site_id)
                    if has_url:
                        direct_described_ids.add(site_id)

    counts["latest_source_evidence_rows"] = evidence_rows
    counts["sites_with_latest_source_evidence"] = len(evidence_site_ids)
    counts["sites_with_http_reference_in_latest_source_evidence"] = len(evidence_url_ids)
    counts["sites_with_extractable_site_description"] = len(described_ids)
    counts["sites_with_extractable_description_and_url"] = len(direct_described_ids)

    adjudication_rows = 0
    adjudication_site_ids: set[str] = set()
    quote_site_ids: set[str] = set()
    profile_detail_site_ids: set[str] = set()
    adjudication_url_ids: set[str] = set()
    if ADJUDICATIONS.exists():
        with ADJUDICATIONS.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                adjudication_rows += 1
                site_id = (row.get("site_id") or "").strip()
                if site_id not in ids:
                    continue
                adjudication_site_ids.add(site_id)
                if has_http_reference(row.get("source_url", "")):
                    adjudication_url_ids.add(site_id)
                if (row.get("source_quote") or "").strip():
                    quote_site_ids.add(site_id)
                if "profile" in (row.get("field") or "").casefold():
                    profile_detail_site_ids.add(site_id)
    counts["latest_site_page_adjudication_rows"] = adjudication_rows
    counts["sites_with_adjudication_evidence"] = len(adjudication_site_ids)
    counts["sites_with_http_adjudication_url"] = len(adjudication_url_ids)
    counts["sites_with_source_quotes"] = len(quote_site_ids)
    counts["sites_with_profile_detail_evidence"] = len(profile_detail_site_ids)

    summary_metrics = load_summary_metrics(ids)
    summary_count = summary_metrics.get("published_summary_records", 0)
    summary_metrics["canonical_sites_without_summary"] = max(0, len(ids) - summary_count)
    summary_metrics["summary_coverage_percent"] = round(summary_count * 100 / len(ids), 2) if ids else 0
    summary_metrics["sidecar_size_bytes"] = SUMMARY_DATA.stat().st_size if SUMMARY_DATA.exists() else 0

    print(json.dumps({
        "counts": counts,
        "summary_metrics": summary_metrics,
        "evidence_classes_top_15": evidence_classes.most_common(15),
        "interpretation": [
            "Extractable source text is a candidate for drafting, not automatically approved prose.",
            "Evidence classes include environmental context and source limitations; these do not support a dive-site description by themselves.",
            "A URL is a lead, not proof that every summary claim is supported by that page.",
        ],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
