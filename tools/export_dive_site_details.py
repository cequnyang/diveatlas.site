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
RECOMMENDATIONS_PATH = DATA_PATH / "recommendations.json"


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
        geography = seo.country_geographies().get(seo.normalized_place_name(country)) if country else None
        if not geography and region:
            geography = seo.country_geographies().get(seo.normalized_place_name(region))
        hierarchy, seen_places = [], set()
        for value in [*(geography or ()), country, region]:
            key = seo.normalized_place_name(value)
            if value and key not in seen_places:
                hierarchy.append(value)
                seen_places.add(key)
        records.append({
            "schema": "dive-site-detail-v1", "site_id": site_id,
            "name": row_value(row, 0), "lat": lat, "lon": lon,
            "country": country, "region": region, "location_hierarchy": hierarchy,
            "depth_min": row_value(row, 3), "depth_max": row_value(row, 4),
            "recorded_depth": row_value(row, 5), "difficulty": row_value(row, 6),
            "characteristics": row_value(row, 7),
            "aliases": row_value(row, 11), "categories": categories,
            "summary": summary.get("description", ""), "sources": sources,
            "photo": {key: photo.get(key, "") for key in ("src", "alt", "credit", "source")} if photo else None,
        })
    return records


def recommendation_catalog(candidates):
    """Publish the same bounded, eligible candidate pool used by static SEO pages."""
    sites = []
    priority = {value: index for index, value in enumerate(seo.FALLBACK_FEATURE_PRIORITY)}
    for site in candidates[:seo.DEFAULT_SITE_LIMIT]:
        feature_values = [part.strip() for part in re.split(
            r"\s*(?:\||,|;)\s*", str(site["categories"].get("features") or site.get("characteristics") or ""))
            if part.strip()]
        features = sorted(feature_values, key=lambda value: priority.get(
            re.sub(r"[^a-z0-9]+", "_", value.casefold()).strip("_"), len(priority)))
        photo = site.get("photo") or {}
        sites.append({
            "site_id": site["site_id"], "name": site["name"], "slug": site["slug"],
            "lat": site["lat"], "lon": site["lon"], "country": site["country"],
            "region": site["region"], "difficulty": site["difficulty"],
            "features": features[:2], "feature_values": feature_values,
            "photo": str(photo.get("src", "")) if isinstance(photo, dict) else "",
            "photo_credit": str(photo.get("credit", "")) if isinstance(photo, dict) else "",
        })
    return {"schema": "dive-site-recommendations-v1", "sites": sites}


def export(output: Path) -> dict:
    base, fallback = load_fallback_photos()
    rows, photos, summaries = load_rows(), load_photos(), load_summaries()
    records = public_records(rows, photos, summaries, base, fallback)
    candidates, _ = seo.validated_candidates(rows, photos, summaries, base, fallback)
    selected = candidates[:seo.DEFAULT_SITE_LIMIT]
    region_counts = Counter((str(site["country"]).casefold(), str(site["region"]).casefold())
                            for site in selected if site["region"])
    region_names = {(str(site["country"]).casefold(), str(site["region"]).casefold()):
                    (str(site["country"]), str(site["region"]))
                    for site in selected if site["region"]}
    eligible_regions = [key for key, count in region_counts.items() if count >= seo.MIN_SITES_PER_REGION]
    eligible_regions.sort(key=lambda key: (-region_counts[key], key[0], key[1]))
    region_urls = {key: seo.region_path(*region_names[key]) for key in eligible_regions[:seo.DEFAULT_REGION_LIMIT]}
    for record in records:
        record["region_url"] = region_urls.get((record["country"].casefold(), record["region"].casefold()))
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
    catalog = recommendation_catalog(selected)
    (output / RECOMMENDATIONS_PATH).write_text(
        json.dumps(catalog,
                   ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    # Remove stale records only inside this exporter-owned version directory.
    current = {record["site_id"] for record in records}
    for previous in destination.glob("*.json"):
        if UUID_RE.fullmatch(previous.stem) and previous.stem not in current:
            previous.unlink()
    return {"site_count": len(records), "recommendation_site_count": len(catalog["sites"]),
            "directory": str(destination)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT)
    args = parser.parse_args()
    print(json.dumps(export(args.output.resolve())))
