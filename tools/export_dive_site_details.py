#!/usr/bin/env python3
"""Export public per-site JSON for the shared, browser-rendered detail page."""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

if __package__:
    from . import generate_seo_pages as seo
else:
    import generate_seo_pages as seo

ROOT, UUID_RE = seo.ROOT, seo.UUID_RE
load_rows, load_photos, load_summaries = seo.load_rows, seo.load_photos, seo.load_summaries
load_fallback_photos = seo.load_fallback_photos
fallback_photo_for_site, row_value = seo.fallback_photo_for_site, seo.row_value

DATA_PATH = Path("data/dive-site-details/v1")
RECOMMENDATIONS_PATH = Path("data/dive-site-details/v2/recommendations.json")
# 512 KiB keeps individual transfers moderate without creating per-site requests.
MAX_RECOMMENDATION_SHARD_BYTES = 512 * 1024


def public_records(rows, photos, summaries, fallback_base, fallback_photos):
    """Use an explicit public allowlist; never publish internal review notes."""
    counts = Counter(row_value(row, 12).lower() for row in rows)
    records = []
    for row in rows:
        site_id = row_value(row, 12).lower()
        if not UUID_RE.fullmatch(site_id) or counts[site_id] != 1 or not row_value(row, 0):
            continue
        lat, lon = row[1:3]
        if (isinstance(lat, bool) or isinstance(lon, bool)
                or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float))
                or not (-90 <= lat <= 90 and -180 <= lon <= 180)):
            continue
        reviewed = len(row) > 17 and isinstance(row[17], dict) and row[17].get("status") == "reviewed"
        categories = {key: row_value(row, index) if reviewed else ""
                      for key, index in (("setting", 14), ("access", 15), ("features", 16))}
        if not reviewed:
            categories["features"] = row_value(row, 7)
        legacy = row[13] if len(row) > 13 and isinstance(row[13], list) else []
        photo = next((photos[str(key).lower()] for key in [site_id, *legacy]
                      if str(key).lower() in photos), None)
        photo = photo or fallback_photo_for_site(
            site_id, categories["features"].split(" | "), fallback_base, fallback_photos)
        summary = summaries.get(site_id) or {}
        sources = []
        evidence = row[17] if reviewed else {}
        labels = str(evidence.get("evidenceSource") or "").split(";")
        for index, url in enumerate(str(evidence.get("evidenceUrlOrId") or "").split(";")):
            if url.strip().lower().startswith(("https://", "http://")):
                sources.append([labels[index].strip() if index < len(labels) else "Reference", url.strip()])
        sources.extend(source[:2] for source in summary.get("sources", [])
                       if isinstance(source, list) and len(source) >= 2)
        if not sources:
            providers = {"osm": "https://www.openstreetmap.org/", "padi": "https://www.padi.com/dive-sites/all/",
                         "ssi": "https://www.divessi.com/en/locator/divesites"}
            sources = [[token.strip().upper(), providers[token.strip().lower()]]
                       for token in row_value(row, 8).split("|") if token.strip().lower() in providers]
        country, region = row_value(row, 9), row_value(row, 10)
        location_nodes = seo.location_nodes(country, region)
        hierarchy = [str(node["label"]) for node in location_nodes]
        hierarchy_urls = [seo.area_browse_url(node) for node in location_nodes]
        records.append({
            "schema": "dive-site-detail-v1", "site_id": site_id,
            "name": row_value(row, 0), "lat": lat, "lon": lon,
            "country": country, "region": region, "location_hierarchy": hierarchy,
            "location_hierarchy_urls": hierarchy_urls,
            "region_url": hierarchy_urls[-1] if region and hierarchy_urls else "",
            "depth_min": row_value(row, 3), "depth_max": row_value(row, 4),
            "recorded_depth": row_value(row, 5), "difficulty": row_value(row, 6),
            "characteristics": row_value(row, 7),
            "aliases": row_value(row, 11), "categories": categories,
            "summary": summary.get("description", ""), "sources": sources,
            "photo": {key: photo.get(key, "") for key in ("src", "alt", "credit", "source")} if photo else None,
        })
    return records


def recommendation_catalog(candidates):
    """Publish every public detail record with enough identity and location data to recommend."""
    sites = []
    priority = {value: index for index, value in enumerate(seo.FALLBACK_FEATURE_PRIORITY)}
    for site in candidates:
        feature_values = [part.strip() for part in re.split(
            r"\s*(?:\||,|;)\s*", str(site["categories"].get("features") or site.get("characteristics") or ""))
            if part.strip()]
        features = sorted(feature_values, key=lambda value: priority.get(
            re.sub(r"[^a-z0-9]+", "_", value.casefold()).strip("_"), len(priority)))
        photo = site.get("photo") or {}
        recommendation = {
            "site_id": site["site_id"], "name": site["name"],
            "lat": site["lat"], "lon": site["lon"],
            "features": features[:2], "feature_values": feature_values,
        }
        for key in ("country", "region", "difficulty"):
            if site.get(key):
                recommendation[key] = site[key]
        if isinstance(photo, dict) and photo.get("src"):
            recommendation["photo"] = str(photo["src"])
        if isinstance(photo, dict) and photo.get("credit"):
            recommendation["photo_credit"] = str(photo["credit"])
        sites.append(recommendation)
    return {"schema": "dive-site-recommendations-v1", "sites": sites}


def split_recommendation_catalog(catalog, max_bytes=MAX_RECOMMENDATION_SHARD_BYTES):
    """Split the full catalog into independently cacheable, size-bounded JSON files."""
    schema = catalog["schema"]
    prefix = '{"schema":' + json.dumps(schema) + ',"sites":['
    suffix = "]}\n"
    base_size = len(prefix.encode("utf-8")) + len(suffix.encode("utf-8"))
    groups, current, current_size = [], [], base_size
    for site in catalog["sites"]:
        serialized = json.dumps(site, ensure_ascii=False, separators=(",", ":"))
        serialized_size = len(serialized.encode("utf-8"))
        next_size = current_size + (1 if current else 0) + serialized_size
        if current and next_size > max_bytes:
            groups.append(current)
            current, current_size = [], base_size
            next_size = current_size + serialized_size
        if next_size > max_bytes:
            raise ValueError(f"Recommendation record exceeds the {max_bytes}-byte shard limit.")
        current.append(serialized)
        current_size = next_size
    if current:
        groups.append(current)

    shard_payloads, shards = {}, []
    for index, group in enumerate(groups, start=1):
        filename = f"recommendations-{index:04d}.json"
        payload = prefix + ",".join(group) + suffix
        payload_bytes = len(payload.encode("utf-8"))
        if payload_bytes > max_bytes:
            raise ValueError(f"Generated recommendation shard exceeds the {max_bytes}-byte limit.")
        shard_payloads[filename] = payload
        shards.append({"file": filename, "site_count": len(group), "bytes": payload_bytes})
    manifest = {
        "schema": "dive-site-recommendation-manifest-v1",
        "site_count": len(catalog["sites"]),
        "shards": shards,
    }
    return manifest, shard_payloads


def export(output: Path) -> dict:
    base, fallback = load_fallback_photos()
    rows, photos, summaries = load_rows(), load_photos(), load_summaries()
    records = public_records(rows, photos, summaries, base, fallback)
    candidates, _ = seo.validated_candidates(rows, photos, summaries, base, fallback)
    selected = candidates[:seo.DEFAULT_SITE_LIMIT]
    groups = defaultdict(list)
    for record in sorted(records, key=lambda value: (value["name"].casefold(), value["site_id"])):
        groups[(record["country"], record["region"])].append(record)
    destination = output / DATA_PATH
    destination.mkdir(parents=True, exist_ok=True)
    for record in records:
        # Bound recommendation payloads and export time; this is a regional
        # discovery list, not a claim about distance or diving suitability.
        record["related"] = [
            {key: other[key] for key in ("site_id", "name", "region", "photo")}
            for other in groups[(record["country"], record["region"])][:9]
            if other["site_id"] != record["site_id"]
        ][:8] if record["region"] else []
        (destination / f"{record['site_id']}.json").write_text(
            json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    # SEO pages intentionally stay capped; recommendations use the complete
    # public detail set so they don't inherit that search-indexing limit.
    catalog = recommendation_catalog(records)
    catalog_manifest, shard_payloads = split_recommendation_catalog(catalog)
    recommendation_destination = output / RECOMMENDATIONS_PATH.parent
    recommendation_destination.mkdir(parents=True, exist_ok=True)
    for filename, payload in shard_payloads.items():
        (recommendation_destination / filename).write_bytes(payload.encode("utf-8"))
    (output / RECOMMENDATIONS_PATH).write_text(
        json.dumps(catalog_manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    # Remove stale records only inside this exporter-owned version directory.
    current = {record["site_id"] for record in records}
    for previous in destination.glob("*.json"):
        if UUID_RE.fullmatch(previous.stem) and previous.stem not in current:
            previous.unlink()
    for previous in recommendation_destination.glob("recommendations-*.json"):
        if re.fullmatch(r"recommendations-\d{4}\.json", previous.name) and previous.name not in shard_payloads:
            previous.unlink()
    return {"site_count": len(records), "recommendation_site_count": len(catalog["sites"]),
            "recommendation_shard_count": len(shard_payloads),
            "directory": str(destination)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT)
    args = parser.parse_args()
    print(json.dumps(export(args.output.resolve())))
