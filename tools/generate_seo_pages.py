#!/usr/bin/env python3
"""Build factual static DiveAtlas dive-site and region pages from local records."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import html
import heapq
import json
import math
import re
import shutil
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://diveatlas.site"
SITE_DATA = ROOT / "datasets" / "dive-sites.js"
COUNTRY_BOUNDARIES = ROOT / "datasets" / "country-boundaries-50m.geojson"
PHOTO_DATA = ROOT / "datasets" / "dive-site-photos.js"
FALLBACK_PHOTO_DATA = ROOT / "datasets" / "dive-site-fallback-photos.js"
SUMMARY_DATA = ROOT / "datasets" / "dive-site-summaries.json.gz"
AREA_PHOTO_DATA = ROOT / "datasets" / "area-photos.json"
DESTINATION_PHOTO_ASSIGNMENTS = ROOT / "datasets" / "destination-photo-assignments.json"
AREA_PHOTO_R2_BASE_URL = "https://assets.diveatlas.site/preview/"
PUBLIC_DOMAIN_LICENSE_URL = "https://commons.wikimedia.org/wiki/Commons:Licensing#Public_domain"
SITEMAP = ROOT / "sitemap.xml"
SITE_OUTPUT = ROOT / "dive-sites"
REGION_OUTPUT = ROOT / "regions"
MIN_SITES_PER_REGION = 3
MIN_SITE_CONTENT_BLOCKS = 3
LIST_PAGE_SIZE = 30
RELATED_SITE_LIMIT = 100
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def slug_base(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text).strip("-")
    return slug


def region_path(country: str, region: str) -> str:
    region_slug = slug_base(region)
    country_slug = slug_base(country)
    return f"/regions/{country_slug}/{region_slug}/" if country_slug else f"/regions/{region_slug}/"


def normalized_place_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(character for character in normalized.casefold() if not unicodedata.combining(character))


@lru_cache(maxsize=1)
def country_geographies() -> dict[str, tuple[str, str]]:
    """Read Natural Earth country context once so page locations share its macro-region names."""
    data = json.loads(COUNTRY_BOUNDARIES.read_text(encoding="utf-8"))
    result: dict[str, tuple[str, str]] = {}
    for feature in data.get("features", []):
        properties = feature.get("properties", {})
        continent = str(properties.get("CONTINENT") or "").strip()
        subregion = str(properties.get("SUBREGION") or "").strip()
        # Natural Earth groups some island countries under open ocean; UN region data is a
        # better continent fallback for display when there is no mainland continent label.
        if continent.casefold().startswith("seven seas"):
            continent = str(properties.get("REGION_UN") or "").strip()
        geography = (continent, subregion)
        for key in ("NAME", "ADMIN", "NAME_EN", "NAME_LONG", "FORMAL_EN"):
            value = str(properties.get(key) or "").strip()
            if value:
                result[normalized_place_name(value)] = geography
    # DiveAtlas records use these common territory spellings; Natural Earth stores
    # the Virgin Islands under its formal name and the Dutch Caribbean as separate islands.
    result[normalized_place_name("Virgin Islands, British")] = ("North America", "Caribbean")
    result[normalized_place_name("Bonaire, Sint Eustatius and Saba")] = ("North America", "Caribbean")
    return result


def area_key(labels: list[str]) -> str:
    """Build the same stable key in Python and in the shared-page JavaScript fallback."""
    normalized = ["".join(character for character in unicodedata.normalize("NFKD", value).lower()
                          if not unicodedata.combining(character)) for value in labels]
    return json.dumps(normalized,
                      ensure_ascii=False, separators=(",", ":"))


def location_nodes(country: str, region: str) -> list[dict[str, str | None]]:
    """Return only recorded location names, enriched with bundled country groupings."""
    country, region = country.strip(), region.strip()
    geography = country_geographies().get(normalized_place_name(country)) if country else None
    region_is_country = False
    # Some legacy rows store a country in the region field. Promote it only on
    # an exact match in the bundled country lookup, never from coordinates.
    if not geography and region:
        geography = country_geographies().get(normalized_place_name(region))
        region_is_country = bool(geography) and not country

    nodes: list[dict[str, str | None]] = []
    labels: list[str] = []

    def add(kind: str, label: str) -> None:
        if not label or normalized_place_name(label) in {normalized_place_name(value) for value in labels}:
            return
        labels.append(label)
        nodes.append({
            "kind": kind,
            "label": label,
            "key": area_key(labels),
            "parent": nodes[-1]["key"] if nodes else None,
        })

    if geography:
        add("continent", geography[0])
        add("subregion", geography[1])
    country_label = region if region_is_country and not country else country
    add("country", country_label)
    if region and not region_is_country and normalized_place_name(region) != normalized_place_name(country_label):
        add("place", region)
    return nodes


def area_browse_url(node: dict[str, str | None]) -> str:
    return "/regions/?area=" + quote(str(node["key"]), safe="")


def destination_breadcrumbs(country: str, region: str) -> str:
    nodes = location_nodes(country, region)
    items = ['<a href="/regions/">Regions</a>']
    for index, node in enumerate(nodes):
        current = ' aria-current="page"' if index == len(nodes) - 1 else ""
        items.append('<span aria-hidden="true">/</span>')
        items.append(
            f'<a href="{html_text(area_browse_url(node))}"{current}>{html_text(node["label"])}</a>'
        )
    return '<nav class="breadcrumbs" aria-label="Breadcrumb">' + "".join(items) + "</nav>"


def html_text(value: object) -> str:
    return html.escape(str(value), quote=True)


def load_rows() -> list[list[object]]:
    source = SITE_DATA.read_text(encoding="utf-8-sig")
    if "=" not in source:
        raise ValueError("Could not find the dive-site dataset assignment")
    rows = json.loads(source.split("=", 1)[1].rsplit(";", 1)[0])
    if not isinstance(rows, list):
        raise ValueError("Dive-site data must be a row array")
    return rows


def load_photos() -> dict[str, dict[str, str]]:
    source = PHOTO_DATA.read_text(encoding="utf-8-sig")
    photos: dict[str, dict[str, str]] = {}
    record_re = re.compile(r'^\s*"([0-9a-f-]{36})"\s*:\s*\{([^{}]*)\}', re.M | re.I)
    field_re = re.compile(r'\b(src|alt|credit|source|license|locationConfidence)\s*:\s*"((?:\\.|[^"\\])*)"')
    for match in record_re.finditer(source):
        fields = {key: json.loads('"' + value + '"') for key, value in field_re.findall(match.group(2))}
        image = fields.get("src", "")
        image_path = ROOT / image
        local_webp = re.fullmatch(r"assets/dive-sites/[A-Za-z0-9._/-]+\.webp", image, re.I) and ".." not in image.split("/")
        if (
            fields.get("source") == "personal"
            and fields.get("license") == "owned"
            and fields.get("locationConfidence") == "exact"
            and fields.get("alt")
            and fields.get("credit")
            and local_webp
            and image_path.is_file()
        ):
            photos[match.group(1).lower()] = fields
    return photos


def load_destination_photos(groups: list[dict[str, object]]) -> dict[str, dict[str, str]]:
    """Resolve explicit destination assignments to their credited R2 WebP copies."""
    assignments_payload = json.loads(DESTINATION_PHOTO_ASSIGNMENTS.read_text(encoding="utf-8"))
    if assignments_payload.get("schema") != "diveatlas-destination-photo-assignments-v1":
        raise ValueError("Unsupported destination photo assignment dataset")
    assignment_rows = assignments_payload.get("entries")
    if not isinstance(assignment_rows, list):
        raise ValueError("Destination photo assignments must contain an entries list")

    photo_payload = json.loads(AREA_PHOTO_DATA.read_text(encoding="utf-8"))
    if photo_payload.get("schema") != "dive-site-area-photo-manifest-v1":
        raise ValueError("Unsupported area photo manifest for destination assignments")
    area_photos: dict[str, dict[str, str]] = {}
    for raw_photo in photo_payload.get("entries", []):
        if not isinstance(raw_photo, dict):
            continue
        key = str(raw_photo.get("areaKey", ""))
        if key in area_photos:
            raise ValueError(f"Duplicate area photo key in destination source manifest: {key}")
        area_photos[key] = raw_photo

    assignments: dict[str, dict[str, str]] = {}
    for raw_assignment in assignment_rows:
        if not isinstance(raw_assignment, dict):
            raise ValueError("Destination photo assignment must be an object")
        path = str(raw_assignment.get("path", ""))
        area_key = str(raw_assignment.get("areaKey", ""))
        source_page = str(raw_assignment.get("sourcePage", ""))
        if not path.startswith("/regions/") or not path.endswith("/"):
            raise ValueError(f"Invalid destination path in photo assignments: {path!r}")
        if path in assignments:
            raise ValueError(f"Duplicate destination photo assignment: {path}")
        photo = area_photos.get(area_key)
        if not photo or str(photo.get("sourcePage", "")) != source_page:
            raise ValueError(f"Destination photo source does not match the area photo manifest: {path}")

        src = str(photo.get("src", ""))
        credit = str(photo.get("credit", "")).strip()
        source_page = str(photo.get("sourcePage", "")).strip()
        license_name = str(photo.get("license", "")).strip()
        license_url = str(photo.get("licenseUrl", "")).strip()
        if not license_url and license_name.casefold().startswith("public domain"):
            license_url = PUBLIC_DOMAIN_LICENSE_URL
        elif license_url.startswith("http://creativecommons.org/"):
            license_url = "https://" + license_url.removeprefix("http://")
        title = str(photo.get("photoTitle") or photo.get("title") or "").strip()
        alt = str(photo.get("alt") or photo.get("photoDescription") or title).strip()
        if not (src and title and alt and credit and license_name):
            raise ValueError(f"Destination photo is missing title, alt text, credit, or license: {path}")
        if not source_page.startswith("https://") or not license_url.startswith("https://"):
            raise ValueError(f"Destination photo source and license must use HTTPS: {path}")

        ai_review_status = str(photo.get("aiReviewStatus", ""))
        if re.search(r"(?:ai[- ]generated|generated[- ]by[- ]ai)", ai_review_status, re.I):
            raise ValueError(f"Destination photo carries an AI-generation marker: {path}")

        # Match prepare_area_photos_r2.py::object_key_for so generated HTML can
        # reference the already-published object without fetching a runtime manifest.
        object_identity = f"{area_key}\n{src}".encode("utf-8")
        r2_key = f"objects/{hashlib.sha256(object_identity).hexdigest()}.webp"
        assignments[path] = {
            "src": AREA_PHOTO_R2_BASE_URL + r2_key,
            "alt": alt,
            "title": title,
            "credit": credit,
            "source_page": source_page,
            "license": license_name,
            "license_url": license_url,
            "ai_review_status": ai_review_status,
            "selection_status": str(photo.get("selectionStatus", "")),
            "source_provider": str(photo.get("sourceProvider", "")),
        }

    expected_paths = {str(group["path"]) for group in groups}
    assigned_paths = set(assignments)
    missing = sorted(expected_paths - assigned_paths)
    stale = sorted(assigned_paths - expected_paths)
    if missing or stale:
        details = []
        if missing:
            details.append(f"missing {len(missing)} assignment(s), first: {missing[0]}")
        if stale:
            details.append(f"stale {len(stale)} assignment(s), first: {stale[0]}")
        raise ValueError("Destination photo map does not cover the generated destinations: " + "; ".join(details))
    return assignments


def load_summaries() -> dict[str, dict[str, object]]:
    payload = json.loads(gzip.decompress(SUMMARY_DATA.read_bytes()))
    if payload.get("schema") != "dive-site-summary-v2":
        raise ValueError("Unsupported dive-site summary dataset")
    summaries = {}
    for site_id, raw_summary in payload.get("bySiteId", {}).items():
        defaults = payload.get("profileSnapshotDefaults", {}) if raw_summary.get("type") == "profileSnapshot" else payload.get("defaults", {})
        summary = {**defaults, **raw_summary}
        if summary.get("status") == "published" and summary.get("description"):
            summaries[str(site_id).lower()] = summary
    return summaries


def load_fallback_photos() -> tuple[str, dict[str, list[dict[str, str]]]]:
    source = FALLBACK_PHOTO_DATA.read_text(encoding="utf-8-sig")
    base_match = re.search(r'window\.DIVE_SITE_FALLBACK_PHOTO_BASE\s*=\s*("(?:\\.|[^"\\])*")\s*;', source)
    photos_match = re.search(r'window\.DIVE_SITE_FALLBACK_PHOTOS\s*=\s*(\{.*?\})\s*;', source, re.S)
    if not base_match or not photos_match:
        raise ValueError("Could not parse dive-site fallback photo data")
    base = json.loads(base_match.group(1))
    photos = json.loads(photos_match.group(1))
    return base, photos


FALLBACK_FEATURE_PRIORITY = [
    "wreck", "cave", "cavern", "artificial_reef", "manta", "muck", "kelp",
    "seamount", "pinnacle", "channel", "drift", "wall", "boulder",
    "sandy_bottom", "archaeological", "reef",
]


def fallback_photo_for_site(
    site_id: str,
    feature_values: list[str],
    fallback_base: str,
    photos_by_feature: dict[str, list[dict[str, str]]],
) -> dict[str, str] | None:
    available = {
        re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
        for value in feature_values
        if re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_") in photos_by_feature
    }
    feature = next((value for value in FALLBACK_FEATURE_PRIORITY if value in available), None)
    feature = feature or ("reef" if photos_by_feature.get("reef") else next(iter(photos_by_feature), None))
    choices = photos_by_feature.get(feature, []) if feature else []
    if not choices:
        return None
    # Match the map popup's FNV-1a choice so the same illustrative photo appears in both places.
    hash_value = 2166136261
    for character in f"{site_id}:{feature}":
        code_point = ord(character)
        if code_point > 0xFFFF:
            code_point -= 0x10000
            units = (0xD800 + (code_point >> 10), 0xDC00 + (code_point & 0x3FF))
        else:
            units = (code_point,)
        for unit in units:
            hash_value ^= unit
            hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    image = choices[hash_value % len(choices)]
    key = str(image.get("key", ""))
    if not key.startswith("share-preview/v1/features/") or ".." in key.split("/"):
        return None
    return {**image, "src": fallback_base.rstrip("/") + "/" + key, "source": "illustrative-fallback"}


def row_value(row: list[object], index: int) -> str:
    if index >= len(row) or row[index] is None:
        return ""
    if isinstance(row[index], list):
        return " | ".join(str(value).strip() for value in row[index] if str(value).strip())
    return str(row[index]).strip()


def validated_candidates(
    rows: list[list[object]],
    photos: dict[str, dict[str, str]],
    summaries: dict[str, dict[str, object]],
    fallback_photo_base: str,
    fallback_photos: dict[str, list[dict[str, str]]],
) -> tuple[list[dict[str, object]], dict[str, int]]:
    id_counts = Counter(row_value(row, 12).lower() for row in rows if row_value(row, 12))
    coord_counts = Counter((row[1], row[2]) for row in rows if len(row) > 2)
    rejected = Counter()
    candidates: list[dict[str, object]] = []

    for row in rows:
        name = row_value(row, 0)
        site_id = row_value(row, 12).lower()
        country = row_value(row, 9)
        region = row_value(row, 10)
        if not name:
            rejected["missing_name"] += 1
            continue
        if "\ufffd" in name or any(unicodedata.category(char) == "Cc" for char in name):
            rejected["invalid_name_encoding"] += 1
            continue
        if not UUID_RE.fullmatch(site_id) or id_counts[site_id] != 1:
            rejected["missing_or_duplicate_stable_id"] += 1
            continue
        lat, lon = row[1], row[2]
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            rejected["invalid_coordinates"] += 1
            continue
        if coord_counts[(lat, lon)] != 1:
            rejected["duplicate_coordinates"] += 1
            continue
        if not country and not region:
            rejected["missing_location_context"] += 1
            continue

        legacy_ids = row[13] if len(row) > 13 and isinstance(row[13], list) else []
        photo = next((photos.get(str(photo_id).lower()) for photo_id in [site_id, *legacy_ids] if photos.get(str(photo_id).lower())), None)
        depth_min, depth_max = row_value(row, 3), row_value(row, 4)
        difficulty, characteristics = row_value(row, 6), row_value(row, 7)
        aliases, sources = row_value(row, 11), row_value(row, 8)
        reviewed = row[17] if len(row) > 17 and isinstance(row[17], dict) and row[17].get("status") == "reviewed" else None
        categories = {
            "setting": row_value(row, 14),
            "access": row_value(row, 15),
            "features": row_value(row, 16),
        } if reviewed else {"setting": "", "access": "", "features": characteristics}
        page_photo = photo or fallback_photo_for_site(
            site_id,
            categories["features"].split(" | ") if reviewed and categories["features"] else characteristics.split(" | "),
            fallback_photo_base,
            fallback_photos,
        )
        summary = summaries.get(site_id)
        attributes = [
            bool(depth_min or depth_max or row_value(row, 5)),
            bool(difficulty),
            bool(characteristics or any(categories.values()) or summary),
            bool(aliases),
            bool(sources),
            bool(photo),
        ]
        score = sum(attributes)
        if score < 2:
            rejected["insufficient_factual_attributes"] += 1
            continue
        content_block_count = sum((
            bool(summary),
            bool(depth_min or depth_max or row_value(row, 5)),
            bool(difficulty),
            bool(characteristics or categories["features"]),
            bool(categories["setting"]),
            bool(categories["access"]),
        ))
        if not sources:
            rejected["missing_linked_source"] += 1
            continue
        if content_block_count < MIN_SITE_CONTENT_BLOCKS:
            rejected["insufficient_substantive_content"] += 1
            continue
        candidates.append({
            "name": name,
            "lat": lat,
            "lon": lon,
            "site_id": site_id,
            "country": country,
            "region": region,
            "depth_min": depth_min,
            "depth_max": depth_max,
            "recorded_depth": row_value(row, 5),
            "difficulty": difficulty,
            "characteristics": characteristics,
            "categories": categories,
            "aliases": aliases,
            "sources": sources,
            "evidence": reviewed or {},
            "summary": summary,
            "photo": page_photo,
            "score": score,
            "content_block_count": content_block_count,
            "row": row,
        })

    # Resolve collisions against the full eligible pool, not only a preview cap,
    # so adding more published records does not rename existing pages.
    slug_counts = Counter(slug_base(str(site["name"])) for site in candidates)
    used_slugs: set[str] = set()
    for site in candidates:
        base = slug_base(str(site["name"])) or f"site-{str(site['site_id'])[:8]}"
        if slug_counts[slug_base(str(site["name"]))] > 1:
            place = "-".join(filter(None, (slug_base(str(site["region"])), slug_base(str(site["country"])))))
            base = f"{base}-{place}" if place else base
        if base in used_slugs:
            base = f"{base}-{str(site['site_id'])[:8]}"
        # Even collision suffixes are checked, rather than silently overwriting.
        if base in used_slugs:
            raise ValueError(f"Unresolved site slug collision: {base}")
        used_slugs.add(base)
        site["slug"] = base

    candidates.sort(key=lambda site: (-int(site["score"]), str(site["name"]).casefold(), str(site["country"]).casefold(), str(site["region"]).casefold(), float(site["lat"]), float(site["lon"]), str(site["site_id"])))
    return candidates, dict(rejected)


def seo_site_search_markup() -> str:
    return '''<div class="top-menu-search-slot seo-site-search-slot" id="seoSiteSearchSlot">
  <div class="search-float" id="seoSiteSearchSection">
    <div class="dive-search">
      <div class="dive-search-box">
        <button class="dive-search-icon" id="seoSiteSearchToggle" type="button" aria-label="Search dive sites" title="Search dive sites" aria-controls="seoSiteSearchInput" aria-expanded="false"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="6.75" cy="6.75" r="4.25"></circle><path d="M10.4 10.4 14 14"></path></svg></button>
        <input class="dive-search-input" id="seoSiteSearchInput" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="seoSiteSearchResultsScroll" placeholder="Where Will You Dive Next?" aria-label="Where Will You Dive Next?">
        <button class="dive-search-clear" id="seoSiteSearchClear" type="button" title="Clear search" aria-label="Clear search"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 0 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg></button>
        <button class="dive-search-filter-toggle" id="seoSiteSearchFilterToggle" type="button" aria-label="Search filters" title="Search filters" aria-controls="seoSiteSearchFilterControls" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 7h10.1M18.9 7H21M3 17h2.1M10.9 17H21"></path><circle cx="16" cy="7" r="2.9"></circle><circle cx="8" cy="17" r="2.9"></circle></svg></button>
      </div>
      <div class="dive-search-results" id="seoSiteSearchResults" aria-busy="false">
        <div class="dive-search-results-scroll" id="seoSiteSearchResultsScroll" role="listbox" aria-label="Dive-site search results"></div>
        <div class="dive-search-filter-controls" id="seoSiteSearchFilterControls" role="group" aria-label="Dive-site filters" hidden>
          <label class="dive-search-filter-field"><span id="seoSiteSearchCountryLabel">Country</span><select id="seoSiteSearchCountry" aria-labelledby="seoSiteSearchCountryLabel"><option value="">Any country</option></select></label>
          <label class="dive-search-filter-field"><span id="seoSiteSearchDifficultyLabel">Difficulty</span><select id="seoSiteSearchDifficulty" aria-labelledby="seoSiteSearchDifficultyLabel"><option value="">Any difficulty</option></select></label>
          <label class="dive-search-filter-field"><span id="seoSiteSearchFeatureLabel">Feature</span><select id="seoSiteSearchFeature" aria-labelledby="seoSiteSearchFeatureLabel"><option value="">Any feature</option></select></label>
          <button class="dive-search-filter-clear" id="seoSiteSearchFilterClear" type="button" hidden>Clear All</button>
        </div>
        <button class="dive-search-results-handle" id="seoSiteSearchResultsHandle" type="button" aria-label="Close dive-site search" title="Drag up to close"></button>
      </div>
    </div>
  </div>
</div>'''


SITE_FOOTER_TEMPLATE = '''<footer class="site-detail-footer"><a class="site-footer-brand" href="/" aria-label="DiveAtlas home"><img src="/assets/diveatlas-logo.svg?v=3" alt="DiveAtlas"></a><nav class="site-footer-share" aria-label="{share_label}">
  <a data-footer-share="instagram" href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer" aria-label="Copy link for Instagram" title="Instagram"><span class="share-action-icon share-action-icon--instagram" aria-hidden="true"><img src="/assets/share-platforms/instagram-glyph.png" alt=""></span></a>
  <a data-footer-share="facebook" href="#" target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook" title="Facebook"><span class="share-action-icon share-action-icon--facebook" aria-hidden="true"><svg viewBox="0 0 24 24"><path class="share-mark" d="M13.4 21v-8h2.7l.4-3.1h-3.1v-2c0-.9.3-1.5 1.6-1.5h1.7V3.6c-.3 0-1.4-.1-2.6-.1-2.6 0-4.4 1.6-4.4 4.5v1.9H7v3.1h2.7v8h3.7Z"/></svg></span></a>
  <a data-footer-share="whatsapp" href="#" target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" title="WhatsApp"><span class="share-action-icon share-action-icon--whatsapp" aria-hidden="true"><svg viewBox="0 0 24 24"><path class="share-mark" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg></span></a>
  <a data-footer-share="x" href="#" target="_blank" rel="noopener noreferrer" aria-label="Share on X" title="X"><span class="share-action-icon share-action-icon--x" aria-hidden="true"><svg viewBox="0 0 24 24"><path class="share-mark" d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></svg></span></a>
  <a data-footer-share="reddit" href="#" target="_blank" rel="noopener noreferrer" aria-label="Share on Reddit" title="Reddit"><span class="share-action-icon share-action-icon--reddit" aria-hidden="true"><svg viewBox="0 0 24 24"><path class="share-mark" d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z"/></svg></span></a>
</nav></footer>'''


def site_footer_markup(share_label: str = "Share this page") -> str:
    return SITE_FOOTER_TEMPLATE.replace("{share_label}", html_text(share_label))


def page_shell(title: str, description: str, canonical: str, body: str, body_class: str = "") -> str:
    body_classes = body_class.split()
    has_browse_header = bool({"region-browser-page", "region-destination-page"} & set(body_classes))
    has_site_detail = "seo-site-detail-layout" in body_classes
    has_site_directory = "site-directory-page" in body_classes
    if has_browse_header and "seo-browse-layout" not in body_classes:
        body_classes.append("seo-browse-layout")
    body_class_attr = f' class="{html_text(" ".join(body_classes))}"' if body_classes else ""
    if has_site_directory:
        region_browse_styles_version = "28"
    elif "region-area-browser-page" in body_classes:
        region_browse_styles_version = "27"
    elif "destination-directory-page" in body_classes:
        region_browse_styles_version = "32"
    elif {"region-browser-page", "region-destination-page"} & set(body_classes):
        region_browse_styles_version = "26"
    else:
        region_browse_styles_version = "9"
    seo_styles_version = "183"
    browse_head_assets = '''  <link rel="stylesheet" href="/assets/seo-site-search.css?v=8">
    <link rel="stylesheet" href="/assets/seo-browse-header.css?v=4">
''' if has_browse_header else ""
    detail_search_head_assets = '  <link rel="stylesheet" href="/assets/seo-site-search.css?v=9">\n' if has_site_detail else ""
    browse_body_scripts = "\n" + '''<script src="/js/data-assets-config.js"></script>
<script src="/js/data-assets.js"></script>
<script src="/js/seo-browse-header.js?v=1" defer></script>
<script src="/js/seo-page-controls.js?v=23" defer></script>
<script src="/js/seo-site-search.js?v=10" defer></script>
<script src="/js/seo-search-catalog-loader.js?v=1" defer></script>'''.strip() if has_browse_header else ""
    directory_rating_script = '\n<script src="/js/seo-list-card-ratings.js?v=1" defer></script>' if has_site_directory else ""
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html_text(title)}</title>
  <meta name="description" content="{html_text(description)}">
  <link rel="canonical" href="{html_text(canonical)}">
  <link rel="icon" href="/assets/favicon-brand.ico" type="image/x-icon">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@17..18,400..700&amp;display=swap">
  <link rel="stylesheet" href="/assets/dive-photo-preview.css?v=1">
  <script>try {{ if (localStorage.getItem('global-coral-map-theme') === 'dark') document.documentElement.dataset.theme = 'dark'; }} catch (_) {{}}</script>
  <link rel="stylesheet" href="/assets/seo.css?v={seo_styles_version}">
  <link rel="stylesheet" href="/assets/region-browse.css?v={region_browse_styles_version}">
{detail_search_head_assets}{browse_head_assets}</head>
<body{body_class_attr}>
{body}{browse_body_scripts}{directory_rating_script}
</body>
</html>
'''


def item_list(items: list[dict[str, object]], render_item) -> str:
    return "\n".join(f"      <li>{render_item(item)}</li>" for item in items)


def list_page_count(total: int) -> int:
    return max(1, (total + LIST_PAGE_SIZE - 1) // LIST_PAGE_SIZE)


def pagination_nav(page: int, page_count: int, total: int, first_url: str,
                   continuation_prefix: str, label: str) -> str:
    if page_count <= 1:
        return ""
    previous_url = first_url if page == 2 else f"{continuation_prefix}/page/{page - 1}/"
    next_url = f"{continuation_prefix}/page/{page + 1}/"
    start = (page - 1) * LIST_PAGE_SIZE + 1
    end = min(page * LIST_PAGE_SIZE, total)
    previous_link = (
        f'<a href="{html_text(previous_url)}" aria-label="Previous page">Previous</a>'
        if page > 1 else '<span aria-disabled="true">Previous</span>'
    )
    next_link = (
        f'<a href="{html_text(next_url)}" aria-label="Next page">Next</a>'
        if page < page_count else '<span aria-disabled="true">Next</span>'
    )
    return (
        f'<nav class="region-list-pagination" aria-label="{html_text(label)}">'
        f'{previous_link}'
        f'<span aria-current="page">Page {page:,} of {page_count:,} · '
        f'showing {start:,}–{end:,} of {total:,}</span>'
        f'{next_link}</nav>'
    )


def public_region_index(rows: list[list[object]]) -> dict[str, object]:
    """Index every public detail record by recorded geography, independent of the SEO content gate."""
    id_counts = Counter(row_value(row, 12).lower() for row in rows if row_value(row, 12))
    sites: list[dict[str, object]] = []
    for row in rows:
        site_id, name = row_value(row, 12).lower(), row_value(row, 0)
        latitude, longitude = row[1:3] if len(row) > 2 else (None, None)
        if (not UUID_RE.fullmatch(site_id) or id_counts[site_id] != 1 or not name
                or isinstance(latitude, bool) or isinstance(longitude, bool)
                or not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float))
                or not math.isfinite(latitude) or not math.isfinite(longitude)
                or not -90 <= latitude <= 90 or not -180 <= longitude <= 180):
            continue
        sites.append({"site_id": site_id, "name": name,
                      "country": row_value(row, 9), "region": row_value(row, 10),
                      "lat": float(latitude), "lon": float(longitude)})
    sites.sort(key=lambda site: (str(site["name"]).casefold(), str(site["site_id"])))

    areas: dict[str, dict[str, object]] = {}
    for index, site in enumerate(sites):
        for node in location_nodes(site["country"], site["region"]):
            key = str(node["key"])
            area = areas.setdefault(key, {
                "key": key, "kind": node["kind"], "label": node["label"],
                "parent": node["parent"], "site_indices": [],
            })
            area["site_indices"].append(index)
    ordered_areas = sorted(areas.values(), key=lambda area: (
        str(area["kind"]), str(area["label"]).casefold(), str(area["key"])))
    return {"schema": "dive-site-region-index-v1", "site_count": len(sites),
            "areas": ordered_areas, "sites": sites}


def destination_photo_caption(photo: dict[str, str], compact: bool = False) -> str:
    title_link = (
        f'<a href="{html_text(photo["source_page"])}" target="_blank" '
        f'rel="noopener noreferrer">{html_text(photo["title"])}</a>'
    )
    license_link = (
        f'<a href="{html_text(photo["license_url"])}" target="_blank" '
        f'rel="license noopener noreferrer">{html_text(photo["license"])}</a>'
    )
    if compact:
        return (
            f'<span class="destination-photo__title">{title_link}</span>'
            '<span class="destination-photo__separator" aria-hidden="true"> · </span>'
            f'<span class="destination-photo__credit">{html_text(photo["credit"])}</span>'
            '<span class="destination-photo__separator" aria-hidden="true"> · </span>'
            '<span class="destination-photo__change">WebP conversion</span>'
            '<span class="destination-photo__separator" aria-hidden="true"> · </span>'
            f'<span class="destination-photo__terms">{license_link}</span>'
        )
    return (
        f'<span class="destination-photo__title">{title_link}</span>'
        f'<span class="destination-photo__credit">{html_text(photo["credit"])}</span>'
        f'<span class="destination-photo__terms">WebP version re-encoded for web delivery · reuse terms: {license_link}</span>'
    )


def destination_photo_card(group: dict[str, object], photo: dict[str, str]) -> str:
    path = str(group["path"])
    region = str(group["region"])
    country = str(group["country"])
    site_count = len(group["sites"])
    return f'''<article class="destination-photo-card">
  <div class="destination-photo-card__image">
    <a class="destination-photo-card__image-link" href="{html_text(path)}" aria-label="Open {html_text(region)} destination page"><img src="{html_text(photo["src"])}" alt="{html_text(photo["alt"])}" loading="lazy" decoding="async"></a>
  </div>
  <div class="destination-photo-card__caption">
    <h3><a href="{html_text(path)}">{html_text(region)}</a></h3>
    <p class="destination-photo-card__place">{html_text(country)} · {site_count} dive sites</p>
  </div>
</article>'''


def destination_photo_figure(photo: dict[str, str]) -> str:
    return f'''<figure class="destination-photo-detail">
  <div class="destination-photo-detail__frame">
    <img src="{html_text(photo["src"])}" alt="{html_text(photo["alt"])}" loading="lazy" decoding="async">
    <div class="destination-photo-credit-overlay">{destination_photo_caption(photo, compact=True)}</div>
  </div>
</figure>'''


def region_browser_page(groups: list[dict[str, object]], photos_by_path: dict[str, dict[str, str]], page: int = 1) -> str:
    directory = region_directory_page(groups, photos_by_path, page)
    destination_content = re.search(r'<main class="region-browser">(.*?)</main>', directory, re.S).group(1)
    is_region_index = page == 1
    destination_directory = (
        f'  <section id="destinationDirectory">{destination_content}</section>'
        if not is_region_index else ""
    )
    region_browser_state = " open" if is_region_index else ""
    region_heading = "Dive Site Regions" if is_region_index else "Browse dive sites by area"
    body = f'''<header class="site-header"><a href="/" class="brand"><img src="/assets/diveatlas-logo.svg?v=3" alt="DiveAtlas"></a></header>
<main class="region-browser">
{destination_directory}
  <details class="region-area-browser" id="regionAreaBrowser"{region_browser_state}>
    <summary>Browse dive sites by area</summary>
    <div class="region-area-browser__content">
      <h1 id="regionPageTitle">{region_heading}</h1>
      <nav class="breadcrumbs" id="regionPageBreadcrumbs" aria-label="Breadcrumb" hidden></nav>
      <p id="regionPageStatus" class="region-browser__scope" role="status" aria-live="polite">Loading area photos and dive-site locations…</p>
      <article class="region-area-feature" id="regionAreaPhoto" hidden>
        <figure class="destination-photo-detail">
          <div class="destination-photo-detail__frame region-area-card__frame">
            <img id="regionAreaPhotoImage" alt="">
            <div class="destination-photo-credit-overlay" id="regionAreaPhotoAttribution" hidden></div>
          </div>
        </figure>
        <p class="destination-description" id="regionAreaDescription"></p>
        <p><a id="regionAreaMapLink" href="/">View this area on the interactive map</a></p>
      </article>
      <section class="region-photo-gallery" id="regionAreaSection" aria-label="Areas" hidden>
        <ul class="site-list" id="regionAreaList"></ul>
      </section>
      <section class="site-recommendations region-site-recommendations" id="regionSiteSection" aria-labelledby="regionSiteHeading" hidden>
        <h2 id="regionSiteHeading">Dive sites</h2>
        <p class="coordinates" id="regionSiteCount" aria-live="polite"></p>
        <ul class="site-list" id="regionSiteList"></ul>
      </section>
    </div>
  </details>
</main>
{site_footer_markup()}
<script src="/js/region-browse.js?v=32" defer></script>'''
    page_title = "Dive Site Regions | DiveAtlas" if is_region_index else f"Dive Sites by Destination - Page {page} | DiveAtlas"
    page_url = f"{BASE_URL}/regions/" if page == 1 else f"{BASE_URL}/regions/page/{page}/"
    page_start = (page - 1) * LIST_PAGE_SIZE + 1
    page_end = min(page * LIST_PAGE_SIZE, len(groups))
    description = (
        f"Browse DiveAtlas destination pages {page_start} to {page_end} of {len(groups)}, "
        "with source-linked photos and recorded dive-site counts."
        if not is_region_index else
        "Browse mapped dive sites by region, country, and destination using recorded location data."
    )
    page = page_shell(
        page_title,
        description,
        page_url,
        body,
        body_class="region-browser-page region-area-browser-page" + (" region-index-page" if is_region_index else ""),
    )
    return page.replace('</head>', '<script>if (new URLSearchParams(location.search).has("area")) { document.documentElement.classList.add("region-area-detail-page"); const meta = document.createElement("meta"); meta.name = "robots"; meta.content = "noindex,follow"; document.head.append(meta); }</script>\n</head>', 1)


def recommendation_feature_tokens(candidate: dict[str, object]) -> list[str]:
    value = str(candidate["categories"].get("features") or candidate.get("characteristics") or "")
    return [part.strip() for part in re.split(r"\s*(?:\||,|;)\s*", value) if part.strip()]


def recommendation_major_features(candidate: dict[str, object]) -> list[str]:
    priority = {value: index for index, value in enumerate(FALLBACK_FEATURE_PRIORITY)}
    indexed = list(enumerate(recommendation_feature_tokens(candidate)))
    indexed.sort(key=lambda pair: (
        priority.get(re.sub(r"[^a-z0-9]+", "_", pair[1].casefold()).strip("_"), len(priority)),
        pair[0],
    ))
    return [value for _, value in indexed[:2]]


def recommendation_card_link(candidate: dict[str, object]) -> str:
    photo = candidate.get("photo") or {}
    photo_src = ""
    photo_credit = ""
    if isinstance(photo, dict):
        source = str(photo.get("src") or "")
        photo_src = source if re.match(r"^https?://", source, re.I) else "/" + source.lstrip("/") if source else ""
        photo_credit = str(photo.get("credit", ""))
    photo_title = f' title="{html_text(photo_credit)}"' if photo_credit else ""
    image = (
        f'<img class="site-recommendations__image" src="{html_text(photo_src)}" alt="" loading="lazy" decoding="async"{photo_title}>'
        if photo_src else '<span class="site-recommendations__image site-recommendations__image--placeholder" aria-hidden="true"></span>'
    )
    feature_markup = "".join(
        f'<span class="site-recommendations__feature">{html_text(feature)}</span>'
        for feature in recommendation_major_features(candidate)
    ) or '<span class="site-recommendations__feature site-recommendations__feature--empty">Features unavailable</span>'
    location = str(candidate.get("region") or candidate.get("country") or "")
    return (
        f'<a class="site-recommendations__card" data-recommendation-card data-rating-lat="{float(candidate["lat"]):.6f}" '
        f'data-rating-lng="{float(candidate["lon"]):.6f}" href="/dive-sites/{quote(str(candidate["slug"]))}/">'
        f'{image}<span class="site-recommendations__card-body">'
        f'<span class="site-recommendations__name" title="{html_text(candidate["name"])}">{html_text(candidate["name"])}</span>'
        f'<span class="site-recommendations__meta"><span class="site-recommendations__location">{html_text(location)}</span>'
        f'<span class="site-recommendations__rating" aria-label="DiveAtlas rating">Rating loading</span></span>'
        f'<span class="site-recommendations__features" aria-label="Recorded features">{feature_markup}</span>'
        f'</span></a>'
    )


def recommendation_difficulty(candidate: dict[str, object]) -> str:
    levels = [value.strip() for value in re.split(
        r"\s*(?:\||,|;|\bto\b)\s*", str(candidate.get("difficulty") or ""), flags=re.I
    ) if value.strip()]
    ranks = {"beginner": 0, "intermediate": 1, "advanced": 2, "expert": 3}
    recognized = [value for value in levels if value.casefold() in ranks]
    return min(recognized, key=lambda value: ranks[value.casefold()]).casefold() if recognized else ""


def recommendation_distance(site: dict[str, object], candidate: dict[str, object]) -> float:
    latitude_delta = float(candidate["lat"]) - float(site["lat"])
    longitude_delta = (float(candidate["lon"]) - float(site["lon"])) * math.cos(float(site["lat"]) * math.pi / 180)
    return latitude_delta ** 2 + longitude_delta ** 2


def build_recommendation_index(sites: list[dict[str, object]]) -> dict[str, dict[str, object]]:
    """Pre-index by recorded destination so full-catalog recommendations stay bounded."""
    by_place: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
    features_by_id: dict[str, list[str]] = {}
    difficulty_by_id: dict[str, str] = {}

    for candidate in sites:
        site_id = str(candidate["site_id"])
        region = str(candidate["region"])
        if region:
            by_place[(str(candidate["country"]).casefold(), region.casefold())].append(candidate)
        features = recommendation_feature_tokens(candidate)
        features_by_id[site_id] = features
        difficulty_by_id[site_id] = recommendation_difficulty(candidate)

    result: dict[str, dict[str, object]] = {}
    for site in sites:
        site_id = str(site["site_id"])
        place_key = (str(site["country"]).casefold(), str(site["region"]).casefold())
        nearby_pool = by_place.get(place_key, []) if site["region"] else []
        nearest_key = lambda candidate: (
            recommendation_distance(site, candidate),
            str(candidate["name"]).casefold(),
            str(candidate["site_id"]),
        )
        nearby = heapq.nsmallest(3, (item for item in nearby_pool if item["site_id"] != site_id), key=nearest_key)

        primary_features = features_by_id[site_id][:2]
        primary_keys = {feature.casefold() for feature in primary_features}
        feature_matches = heapq.nsmallest(
            3,
            (candidate for candidate in nearby_pool
             if candidate["site_id"] != site_id and primary_keys.intersection(
                 value.casefold() for value in features_by_id[str(candidate["site_id"])]
             )),
            key=lambda candidate: (
                -len(primary_keys.intersection(value.casefold() for value in features_by_id[str(candidate["site_id"])])),
                recommendation_distance(site, candidate),
                str(candidate["name"]).casefold(),
                str(candidate["site_id"]),
            ),
        )

        difficulty = difficulty_by_id[site_id]
        difficulty_matches = heapq.nsmallest(
            3,
            (candidate for candidate in nearby_pool
             if candidate["site_id"] != site_id and difficulty
             and difficulty_by_id[str(candidate["site_id"])] == difficulty),
            key=nearest_key,
        )
        result[site_id] = {
            "nearby": nearby,
            "features": feature_matches,
            "difficulty": difficulty_matches,
            "primary_features": primary_features,
            "difficulty_level": difficulty,
        }
    return result


def generate_site_page(
    site: dict[str, object],
    regions: dict[tuple[str, str], dict[str, object]],
    recommendations: dict[str, object],
    rating_candidates_url: str,
) -> tuple[str, str]:
    slug = str(site["slug"])
    canonical_url = f"{BASE_URL}/dive-sites/{quote(slug)}/"
    name, country, region = str(site["name"]), str(site["country"]), str(site["region"])
    location = ", ".join(value for value in (region, country) if value)
    site_breadcrumbs_markup = destination_breadcrumbs(country, region)
    coordinate_text = f"{float(site['lat']):.5f}, {float(site['lon']):.5f}"
    context = f" in {location}" if location else ""
    title_base = f"{name} Dive Site{f' in {location}' if location else ''} | DiveAtlas"
    depth_min, depth_max = str(site["depth_min"] or ""), str(site["depth_max"] or "")
    try:
        same_recorded_depth = bool(depth_min and depth_max and float(depth_min) == float(depth_max))
    except ValueError:
        same_recorded_depth = False
    search_details = []
    if site["characteristics"]:
        search_details.append(f"recorded features: {str(site['characteristics']).replace(' | ', ', ')}")
    if site["depth_min"] or site["depth_max"]:
        search_depth = depth_min if same_recorded_depth else "–".join(value for value in (depth_min, depth_max) if value)
        search_details.append(f"recorded depth: {search_depth} m")
    elif site["recorded_depth"]:
        search_details.append(f"recorded depth: {site['recorded_depth']} m")
    if site["difficulty"]:
        search_details.append(f"listed diver levels: {site['difficulty']}")
    detail_summary = f" Recorded details include {'; '.join(search_details[:2])}." if search_details else ""
    description = f"Explore {name}{context} on DiveAtlas.{detail_summary} View mapped coordinates ({coordinate_text}) and site details."
    place_key = (country.casefold(), region.casefold())
    region_entry = regions.get(place_key)
    facts: list[str] = []
    # Keep this order aligned with the interactive detail view: map, features, difficulty; depth, setting, access.
    # Use the Commons thumbnail rendition: the source SVG embeds 19 PNGs and is about 4.3 MB.
    facts.append(f'<div class="fact fact-coordinates"><dt>Coordinates</dt><dd><a class="coordinate-map-button" href="https://www.google.com/maps/search/?api=1&amp;query={float(site["lat"]):.5f}%2C{float(site["lon"]):.5f}" target="_blank" rel="noopener noreferrer" aria-label="Open coordinates {html_text(coordinate_text)} in Google Maps" title="Open in Google Maps"><img src="/assets/google-maps-icon-2026.png?v=1" alt="" width="22" height="22"><span>Open in Google Maps</span></a></dd></div>')
    if site["categories"]["features"]:
        feature_tokens = [part.strip().replace("_", " ") for part in site["categories"]["features"].split("|") if part.strip()]
        feature_text = " · ".join(feature_tokens)
        facts.append(f'<div class="fact fact-features"><dt>Features</dt><dd>{html_text(feature_text)}</dd></div>')
    if site["difficulty"]:
        levels = [value.strip() for value in re.split(r"\s*(?:\||,|;|\bto\b)\s*", str(site["difficulty"]), flags=re.I) if value.strip()]
        ranks = {"beginner": 0, "intermediate": 1, "advanced": 2, "expert": 3}
        recognized = [value for value in levels if value.casefold() in ranks]
        difficulty = min(recognized, key=lambda value: ranks[value.casefold()]) if recognized else str(site["difficulty"])
        facts.append(f'<div class="fact"><dt>Difficulty</dt><dd>{html_text(difficulty)}</dd></div>')
    if site["depth_min"] or site["depth_max"]:
        depth = depth_min if same_recorded_depth else "–".join(value for value in (depth_min, depth_max) if value)
        label = "Recorded depth" if same_recorded_depth else "Recorded depth range"
        facts.append(f'<div class="fact"><dt>{label}</dt><dd data-depth-min="{html_text(depth_min)}" data-depth-max="{html_text(depth_max)}">{html_text(depth)} m</dd></div>')
    elif site["recorded_depth"]:
        facts.append(f'<div class="fact"><dt>Recorded depth</dt><dd data-depth-min="{html_text(site["recorded_depth"])}" data-depth-max="{html_text(site["recorded_depth"])}">{html_text(site["recorded_depth"])} m</dd></div>')
    def category_text(value: str) -> str:
        return " · ".join(part.strip().replace("_", " ") for part in value.split("|") if part.strip())

    for label, key in (("Setting", "setting"), ("Access", "access")):
        if site["categories"][key]:
            fact_class = " fact-setting" if label == "Setting" else ""
            facts.append(f'<div class="fact{fact_class}"><dt>{label}</dt><dd>{html_text(category_text(site["categories"][key]))}</dd></div>')
    intro_detail_parts = []
    if site["aliases"]:
        intro_detail_parts.append(f'<strong>Also recorded as:</strong> <span data-i18n-ignore>{html_text(site["aliases"])}</span>.')
    summary = site["summary"]
    if summary:
        intro_detail_parts.append(f'<span data-seo-summary>{html_text(summary["description"])}</span>')
    intro_details_markup = f'<p class="site-intro-detail">{"<br>".join(intro_detail_parts)}</p>' if intro_detail_parts else ""

    def recommendation_card(candidate: dict[str, object]) -> str:
        return f'<li>{recommendation_card_link(candidate)}</li>'

    def recommendation_group(key: str, candidates: list[dict[str, object]], *, empty_text: str) -> str:
        if candidates:
            items = "".join(recommendation_card(candidate) for candidate in candidates[:3])
        else:
            items = f'<li class="site-recommendations__empty">{html_text(empty_text)}</li>'
        return (
            f'<section class="site-recommendations__group" data-recommendation-group="{html_text(key)}">'
            f'<ul>{items}</ul></section>'
        )

    nearby_sites = recommendations["nearby"]
    primary_features = recommendations["primary_features"]
    feature_matches = recommendations["features"]
    difficulty_matches = recommendations["difficulty"]
    current_difficulty = recommendations["difficulty_level"]
    rating_group = (
        f'<section class="site-recommendations__group" data-recommendation-group="rating">'
        f'<ul data-recommendation-rating-candidates-src="{html_text(rating_candidates_url)}" aria-live="polite">'
        f'<li class="site-recommendations__empty">Checking this month’s ratings…</li></ul></section>'
    )
    feature_values_markup = (
        f'<span class="site-recommendations__feature-values"> · {html_text(" · ".join(primary_features))}</span>'
        if primary_features else ""
    )
    recommendation_groups = [
        recommendation_group("nearby", nearby_sites, empty_text="No nearby sites are available in this published set."),
        rating_group,
        recommendation_group("features", feature_matches,
            empty_text="No sites match the recorded features." if primary_features else "No primary features are recorded for this site."),
        recommendation_group("difficulty", difficulty_matches,
            empty_text="No sites with the same recorded difficulty are available." if current_difficulty else "Difficulty is not recorded for this site."),
    ]
    recommendation_tabs = (
        '<div class="site-recommendations__tabs" hidden>'
        '<button class="site-recommendations__scroll" type="button" data-recommendation-scroll="-1" aria-label="Scroll recommendation filters left"><span class="site-recommendations__scroll-glyph" aria-hidden="true">‹</span></button>'
        '<div class="site-recommendations__tablist" role="tablist" aria-label="Recommendation filters" tabindex="0">'
        '<button type="button" role="tab" id="recommendation-tab-all" aria-controls="recommendation-panel" aria-selected="true" data-recommendation-tab="all">All</button>'
        '<button type="button" role="tab" id="recommendation-tab-nearby" aria-controls="recommendation-panel" aria-selected="false" data-recommendation-tab="nearby" tabindex="-1">Nearby</button>'
        '<button type="button" role="tab" id="recommendation-tab-rating" aria-controls="recommendation-panel" aria-selected="false" data-recommendation-tab="rating" tabindex="-1">Rating</button>'
        f'<button type="button" role="tab" id="recommendation-tab-features" aria-controls="recommendation-panel" aria-selected="false" data-recommendation-tab="features" tabindex="-1">Features{feature_values_markup}</button>'
        '<button type="button" role="tab" id="recommendation-tab-difficulty" aria-controls="recommendation-panel" aria-selected="false" data-recommendation-tab="difficulty" tabindex="-1">Difficulty</button>'
        '</div>'
        '<button class="site-recommendations__scroll" type="button" data-recommendation-scroll="1" aria-label="Scroll recommendation filters right"><span class="site-recommendations__scroll-glyph" aria-hidden="true">›</span></button>'
        '</div>'
    )
    recommendation_markup = (
        '<aside class="site-recommendations" aria-label="Dive site recommendations">'
        + recommendation_tabs + '<div class="site-recommendations__content" id="recommendation-panel" data-recommendation-content>'
        + "".join(recommendation_groups) + "</div></aside>"
    )

    source_links: list[tuple[str, str]] = []
    evidence = site["evidence"]
    evidence_names = [value.strip() for value in str(evidence.get("evidenceSource", "")).split(";") if value.strip()]
    evidence_refs = [value.strip() for value in str(evidence.get("evidenceUrlOrId", "")).split(";") if re.match(r"^https?://", value.strip(), re.I)]
    if evidence_refs:
        evidence_label = " · ".join(evidence_names) if len(evidence_names) != len(evidence_refs) else ""
        source_links.extend((evidence_label or (evidence_names[index] if index < len(evidence_names) else f"Reference {index + 1}"), ref) for index, ref in enumerate(evidence_refs))
    summary_sources = summary.get("sources", []) if summary else []
    for source in summary_sources:
        if isinstance(source, list) and len(source) > 1 and re.match(r"^https?://", str(source[1]), re.I):
            source_links.append((str(source[0]), str(source[1])))
    known_urls = {url.rstrip("/").casefold() for _, url in source_links}
    if not source_links:
        provider_urls = {
            "osm": "https://www.openstreetmap.org/",
            "padi": "https://www.padi.com/dive-sites/all/",
            "ssi": "https://www.divessi.com/en/locator/divesites",
        }
        for token in str(site["sources"]).split("|"):
            label = token.strip()
            url = provider_urls.get(label.casefold())
            if url and url.rstrip("/").casefold() not in known_urls:
                source_links.append((label.upper() if label.casefold() in {"osm", "ssi"} else label.upper(), url))
                known_urls.add(url.rstrip("/").casefold())
    else:
        # The popup hides generic provider links whenever record-specific references exist.
        source_links = [(label, url) for label, url in source_links if url.rstrip("/").casefold() not in {
            "https://www.openstreetmap.org", "https://www.padi.com/dive-sites/all", "https://www.divessi.com/en/locator/divesites"
        }]
    unique_sources: list[tuple[str, str]] = []
    seen_source_urls: set[str] = set()
    for label, source_url in source_links:
        key = source_url.rstrip("/").casefold()
        if key not in seen_source_urls:
            unique_sources.append((label, source_url))
            seen_source_urls.add(key)
    sources_markup = ""
    if unique_sources:
        source_items = "".join(f'<li><a href="{html_text(source_url)}" target="_blank" rel="noopener noreferrer">{html_text(label)}</a></li>' for label, source_url in unique_sources)
        sources_markup = f'<section class="detail-section source-section" aria-labelledby="sources-heading"><h2 id="sources-heading">Sources:</h2><ul class="source-list">{source_items}</ul></section>'

    photo_markup = ""
    photo = site["photo"]
    if photo:
        image_url = str(photo["src"]) if re.match(r"^https?://", str(photo["src"]), re.I) else "/" + str(photo["src"]).lstrip("/")
        credit_text = f'Illustrative image · {photo.get("credit", "")}' if photo.get("source") == "illustrative-fallback" else photo.get("credit", "")
        credit = f'<figcaption>{html_text(credit_text)}</figcaption>' if credit_text else ""
        upload_label = ""
        if photo.get("source") == "illustrative-fallback":
            upload_url = f'/?addPhoto=1&amp;site={html_text(site["site_id"])}&amp;lat={float(site["lat"]):.6f}&amp;lng={float(site["lon"]):.6f}&amp;z=14'
            upload_label = (
                f'<a class="site-photo-upload-label" href="{upload_url}" target="_blank" rel="noopener noreferrer" '
                f'aria-label="Been diving here? Share a real photo.">'
                f'<span class="site-photo-upload-label__rest">Representative image · not this dive site</span>'
                f'<svg class="site-photo-upload-label__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
                f'<path d="M4 7.5h3l1.5-2h7l1.5 2h3A1.5 1.5 0 0 1 21.5 9v9A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z"/>'
                f'<circle cx="12" cy="13" r="3.25"/></svg>'
                f'<span class="site-photo-upload-label__action">Been diving here? Share a real photo.</span></a>'
                f'<span class="site-photo-upload-label-mobile">Representative image · not this dive site</span>'
                f'<a class="site-photo-upload-button" href="{upload_url}" target="_blank" rel="noopener noreferrer" aria-label="Share a real photo">'
                f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
                f'<path d="M4 7.5h3l1.5-2h7l1.5 2h3A1.5 1.5 0 0 1 21.5 9v9A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z"/>'
                f'<circle cx="12" cy="13" r="3.25"/></svg><span>Share a real photo</span></a>'
            )
        safe_image_url = html_text(image_url)
        safe_photo_alt = html_text(photo["alt"])
        photo_markup = (
            f'<div class="site-photo-feature"><figure class="site-photo site-photo-gallery">'
            f'<div class="site-photo-gallery-main{" site-photo-gallery-main--photo-upload" if upload_label else ""}"><button class="site-photo-preview-trigger" type="button" aria-label="Open full-size photo preview">'
            f'<img src="{safe_image_url}" alt="{safe_photo_alt}" loading="lazy"></button>{upload_label}{credit}</div>'
            f'</figure><aside class="site-photo-gallery-rail" aria-label="Dive site actions">'
            f'<section class="site-photo-gallery-rating" data-rating-lat="{float(site["lat"]):.6f}" data-rating-lng="{float(site["lon"]):.6f}" aria-label="diveAtlas Rating" tabindex="0">'
            f'<div class="site-photo-gallery-rating__brand"><img src="/assets/diveatlas-logo.svg?v=3" alt=""><span data-i18n-ignore>Rating</span></div>'
            f'<p class="site-photo-gallery-rating__score" role="status" aria-live="polite" data-status="loading">Loading rating…</p>'
            f'<div class="site-photo-gallery-rating__trend"><p class="site-photo-gallery-rating__trend-title">Monthly Rating</p><div class="site-photo-gallery-rating__trend-chart" role="img" aria-label="Monthly dive-site rating scores"></div></div>'
            f'</section>'
            f'<div class="site-photo-gallery-map">'
            f'<iframe class="site-photo-gallery-map__embed" title="Google Maps preview for {html_text(name)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" tabindex="-1" aria-hidden="true" src="https://www.google.com/maps?q={float(site["lat"]):.6f}%2C{float(site["lon"]):.6f}&amp;z=12&amp;output=embed"></iframe>'
            f'<a class="site-photo-gallery-map__mask" href="/?site={html_text(site["site_id"])}&amp;lat={float(site["lat"]):.6f}&amp;lng={float(site["lon"]):.6f}&amp;z=14" aria-label="View {html_text(name)} on the DiveAtlas map"></a>'
            f'<a class="site-photo-gallery-map__cta" href="/?site={html_text(site["site_id"])}&amp;lat={float(site["lat"]):.6f}&amp;lng={float(site["lon"]):.6f}&amp;z=14" aria-label="View {html_text(name)} on the DiveAtlas map">View on map</a>'
            f'</div></aside></div>'
        )

    photo_class = "has-photo" if photo else "no-photo"
    json_ld = json.dumps({
        "@context": "https://schema.org",
        "@type": "Place",
        "name": name,
        "url": canonical_url,
        "geo": {"@type": "GeoCoordinates", "latitude": site["lat"], "longitude": site["lon"]},
        **({"address": {"@type": "PostalAddress", "addressCountry": country}} if country else {}),
    }, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    controls = '''<div class="top-menu-controls seo-top-menu-controls" aria-label="Page settings">
      <button class="top-menu-share" id="seoShareButton" type="button" aria-label="Share this dive site" title="Share this dive site"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15V3m0 0L7 8m5-5 5 5M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg></button>
      <button class="top-menu-theme" id="seoThemeButton" type="button" title="Toggle page theme" aria-label="Toggle page theme" aria-pressed="false"><span class="theme-mode-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.7"/><path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9"/></svg></span><span class="theme-mode-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M12.8 10.2A5.8 5.8 0 0 1 5.8 3.1a5.8 5.8 0 1 0 7 7.1Z"/></svg></span></button>
      <div class="seo-language-menu"><button class="top-menu-menu-button top-menu-lang-trigger" id="seoLanguageButton" type="button" aria-label="Language" aria-haspopup="menu" aria-expanded="false" aria-controls="seoLanguageDropdown"><span id="seoLanguageLabel">EN</span><svg class="language-chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="language-globe-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2.8 10h14.4M10 2.5c2 2 3 4.5 3 7.5s-1 5.5-3 7.5c-2-2-3-4.5-3-7.5s1-5.5 3-7.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="top-menu-dropdown seo-language-dropdown" id="seoLanguageDropdown" role="menu" aria-label="Language" hidden></div>
      <label class="sr-only" for="seoLanguageSelect">Language</label><select class="sr-only-select" id="seoLanguageSelect" aria-label="Language" tabindex="-1" aria-hidden="true"><option value="en">EN</option><option value="zh">简体中文</option><option value="zh-TW">繁體中文</option><option value="es">ES</option><option value="de">DE</option><option value="fr">FR</option><option value="ja">日本語</option><option value="pt">PT</option><option value="it">IT</option><option value="ru">RU</option><option value="ko">한국어</option><option value="nl">NL</option><option value="id">ID</option><option value="sv">SV</option><option value="no">NO</option></select></div>
      <div class="top-menu-menu seo-menu-wrap"><button class="top-menu-menu-button" id="seoMenuButton" type="button" title="Menu" aria-label="Menu" aria-expanded="false" aria-controls="seoMenuDropdown"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button><div class="top-menu-dropdown seo-menu-dropdown" id="seoMenuDropdown" hidden><div class="top-menu-page-header">Menu</div><div class="seo-menu-account" role="status">Account sign-in is unavailable</div><div class="top-menu-about-wrap seo-menu-about-wrap"><button class="top-menu-dropdown-item" id="seoAboutButton" type="button" aria-expanded="false" aria-controls="seoAboutDetails">About</button><div class="top-menu-about-tooltip" id="seoAboutDetails" hidden><p>DiveAtlas is an interactive map for exploring dive sites and regions alongside reef extent, coral and fish records, bathymetry, and ocean conditions.</p><p class="top-menu-about-copyright">© 2026 DiveAtlas. Original DiveAtlas code, text, and design; third-party materials remain under their own terms.</p></div></div><button class="top-menu-dropdown-item" id="seoContactButton" type="button">Contact</button><div class="top-menu-version" data-version="0.0.1" aria-label="DiveAtlas version 0.0.1">v0.0.1</div></div></div>
    </div>'''
    body = f'''<header class="site-header"><a href="/" class="brand"><img src="/assets/diveatlas-logo.svg?v=3" alt="DiveAtlas"></a>{seo_site_search_markup()}{controls}</header>
<div class="seo-menu-backdrop" id="seoMenuBackdrop" hidden></div>
<main class="detail-page {photo_class}" data-site-id="{html_text(site["site_id"])}">
  <section class="site-hero" aria-labelledby="site-title">
    {photo_markup}
    <div class="hero-copy">{site_breadcrumbs_markup}<div class="site-title-row"><h1 id="site-title" data-seo-site-name>{html_text(name)}</h1><button class="site-title-share" id="siteTitleShareButton" type="button" aria-label="Share this dive site" title="Share this dive site"><svg class="site-title-share-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15V3m0 0L7 8m5-5 5 5M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg></button></div>
    </div>
  </section>
  {intro_details_markup}
  <section class="detail-section facts-section" aria-label="Dive details"><dl class="fact-grid">{''.join(facts)}</dl></section>
  {sources_markup}
  <aside class="data-note"><span class="note-icon" aria-hidden="true"></span><p>Recorded details may not reflect current conditions. Check local guidance before diving.</p></aside>
</main>
{recommendation_markup}
{site_footer_markup("Share this dive site")}

<div class="seo-share-modal" id="seoShareModal" hidden><div class="seo-modal-backdrop" data-seo-share-close></div><section class="seo-dialog seo-share-dialog" role="dialog" aria-modal="true" aria-labelledby="seoShareTitle"><div class="seo-dialog-header"><h2 id="seoShareTitle">Share this dive site</h2><button class="seo-dialog-close" type="button" aria-label="Close" data-seo-share-close>×</button></div><p class="seo-share-url" id="seoShareUrl"></p><div class="seo-share-actions"><button type="button" class="seo-primary-button" id="seoCopyLinkButton">Copy link</button><button type="button" class="seo-secondary-button" id="seoNativeShareButton">More options</button><a id="seoShareFacebook" target="_blank" rel="noopener noreferrer">Facebook</a><a id="seoShareWhatsapp" target="_blank" rel="noopener noreferrer">WhatsApp</a><a id="seoShareX" target="_blank" rel="noopener noreferrer">X</a><a id="seoShareReddit" target="_blank" rel="noopener noreferrer">Reddit</a><a id="seoShareTelegram" target="_blank" rel="noopener noreferrer">Telegram</a><a id="seoShareLine" target="_blank" rel="noopener noreferrer">LINE</a><a id="seoShareEmail">Email</a></div><p class="seo-dialog-status" id="seoShareStatus" role="status" aria-live="polite"></p></section></div>
<div class="seo-contact-modal" id="seoContactModal" hidden><div class="seo-modal-backdrop" data-seo-contact-close></div><section class="seo-dialog" role="dialog" aria-modal="true" aria-labelledby="seoContactTitle"><div class="seo-dialog-header"><div><h2 id="seoContactTitle">Contact DiveAtlas</h2><p>Send a message to the DiveAtlas maintainer.</p></div><button class="seo-dialog-close" type="button" aria-label="Close" data-seo-contact-close>×</button></div><form id="seoContactForm" class="seo-contact-form" novalidate><label>Name <small>(optional)</small><input name="name" id="seoContactName" maxlength="100" autocomplete="name"></label><label>Email<input name="email" id="seoContactEmail" type="email" maxlength="254" autocomplete="email" required></label><label>Subject <small>(optional)</small><input name="subject" id="seoContactSubject" maxlength="150"></label><label>Message<textarea name="message" id="seoContactMessage" maxlength="5000" required></textarea></label><label class="seo-honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><div id="seoContactTurnstile"></div><p class="seo-dialog-status" id="seoContactStatus" role="status" aria-live="polite"></p><div class="seo-dialog-actions"><button class="seo-secondary-button" type="button" data-seo-contact-close>Cancel</button><button class="seo-primary-button" type="submit">Send message</button></div></form></section></div>
<script type="application/ld+json">{json_ld}</script>
<script src="/datasets/dive-site-name-translations.js?v=1" defer></script><script src="/js/dive-site-name-localization.js?v=1" defer></script><script src="/js/dive-site-summary-translations.js?v=1" defer></script><script src="/js/dive-photo-preview.js?v=1" defer></script><script src="/js/seo-page-controls.js?v=23" defer></script><script src="/js/dive-conditions-chart.js?v=51" defer></script><script src="/js/site-recommendations.js?v=13" defer></script><script src="/js/data-assets-config.js" defer></script><script src="/js/data-assets.js" defer></script><script src="/js/seo-site-search.js?v=11" defer></script><script src="/js/seo-search-catalog-loader.js?v=1" defer></script><script src="/js/dive-site-rating-card.js?v=21" defer></script>'''
    html = page_shell(title_base, description, canonical_url, body, "seo-site-detail-layout")
    return title_base, html


def generate_region_page(
    group: dict[str, object],
    groups: list[dict[str, object]],
    photo: dict[str, str],
    site_page: int = 1,
    related_page: int = 1,
) -> tuple[str, str]:
    country, region = str(group["country"]), str(group["region"])
    path = region_path(country, region)
    url = f"{BASE_URL}{path}"
    breadcrumbs = destination_breadcrumbs(country, region)
    sites = list(group["sites"])
    title_base = f"Dive Sites in {region}, {country} | DiveAtlas" if country else f"Dive Sites in {region} | DiveAtlas"
    country_suffix = f", {country}" if country else ""
    site_page_count = list_page_count(len(sites))
    site_page = min(max(site_page, 1), site_page_count)
    site_start = (site_page - 1) * LIST_PAGE_SIZE
    visible_sites = sites[site_start:site_start + LIST_PAGE_SIZE]
    latitudes = [float(site["lat"]) for site in sites]
    longitudes = [float(site["lon"]) for site in sites]
    bounds = f"{min(latitudes):.5f} to {max(latitudes):.5f} latitude; {min(longitudes):.5f} to {max(longitudes):.5f} longitude"
    site_items = item_list(visible_sites, lambda site: f'<a href="/dive-sites/{quote(str(site["slug"]))}/">{html_text(site["name"])}</a> <span class="coordinates">({float(site["lat"]):.5f}, {float(site["lon"]):.5f})</span>')
    site_navigation = pagination_nav(
        site_page, site_page_count, len(sites), path,
        f"{path.rstrip('/')}/sites", "Dive-site pages",
    )
    related = [other for other in groups if other is not group and str(other["country"]).casefold() == country.casefold()]
    related_page_count = list_page_count(len(related))
    related_page = min(max(related_page, 1), related_page_count)
    related_start = (related_page - 1) * LIST_PAGE_SIZE
    visible_related = related[related_start:related_start + LIST_PAGE_SIZE]
    related_markup = ""
    if related:
        related_navigation = pagination_nav(
            related_page, related_page_count, len(related), path,
            f"{path.rstrip('/')}/related", "Related destinations",
        )
        related_markup = '<section aria-labelledby="related-heading"><h2 id="related-heading">Other dive-site destinations in this country</h2><ul class="related-destination-list">' + item_list(visible_related, lambda other: f'<a href="{html_text(other["path"])}">{html_text(other["region"])}</a>') + '</ul>' + related_navigation + '</section>'

    if site_page > 1:
        title = title_base.removesuffix(" | DiveAtlas") + f" - Dive sites page {site_page} | DiveAtlas"
        canonical = f"{url.rstrip('/')}/sites/page/{site_page}/"
        description = f"Page {site_page} of {site_page_count} lists dive-site profiles in {region}{country_suffix} on DiveAtlas."
    elif related_page > 1:
        title = title_base.removesuffix(" | DiveAtlas") + f" - Related destinations page {related_page} | DiveAtlas"
        canonical = f"{url.rstrip('/')}/related/page/{related_page}/"
        related_start = (related_page - 1) * LIST_PAGE_SIZE + 1
        related_end = min(related_page * LIST_PAGE_SIZE, len(related))
        description = f"Page {related_page} of {related_page_count} lists related destinations {related_start} to {related_end} in {country or region} on DiveAtlas."
    else:
        title = title_base
        canonical = url
        description = f"Browse {len(sites)} published dive-site profiles mapped in {region}{country_suffix}. Compare recorded locations and available site details on DiveAtlas."
    body = f'''<header class="site-header"><a href="/" class="brand"><img src="/assets/diveatlas-logo.svg?v=3" alt="DiveAtlas"></a></header>
<main>
  <h1>Dive Sites in {html_text(region)}</h1>
  {breadcrumbs}
  {destination_photo_figure(photo)}
  <p class="destination-description">This page lists {len(sites)} dive sites with recorded country and region fields matching this destination. The coordinate range is {html_text(bounds)}.</p>
  <p><a href="{html_text(BASE_URL)}/?lat={sum(latitudes)/len(latitudes):.5f}&amp;lng={sum(longitudes)/len(longitudes):.5f}&amp;z=7&amp;layers=dive">View this area on the interactive map</a></p>
  <section aria-labelledby="sites-heading"><h2 id="sites-heading">Dive sites ({len(sites)})</h2><ul class="site-list destination-site-list">{site_items}</ul>{site_navigation}</section>
  {related_markup}
</main>
{site_footer_markup()}'''
    return title, page_shell(title, description, canonical, body, body_class="region-destination-page")


def site_directory_page(sites: list[dict[str, object]], page: int = 1) -> str:
    ordered_sites = sorted(sites, key=lambda site: (
        str(site["country"]).casefold(), str(site["region"]).casefold(),
        str(site["name"]).casefold(), str(site["site_id"])))
    total = len(ordered_sites)
    page_count = list_page_count(total)
    page = min(max(page, 1), page_count)
    start = (page - 1) * LIST_PAGE_SIZE
    visible_sites = ordered_sites[start:start + LIST_PAGE_SIZE]
    site_items = item_list(visible_sites, recommendation_card_link)
    body = f'''<header class="site-header"><a href="/" class="brand"><img src="/assets/diveatlas-logo.svg?v=3" alt="DiveAtlas"></a></header>
<main class="region-browser">
  <p class="eyebrow">DiveAtlas dive sites</p>
  <h1>Explore dive sites</h1>
  <p class="lead">Browse mapped dive sites with recorded locations and available details. Each profile links its listed facts to the available source information.</p>
  <p><a href="/regions/">Browse dive sites by destination</a></p>
  <section class="site-recommendations site-directory-recommendations" aria-labelledby="sites-heading"><h2 id="sites-heading">Dive sites ({total})</h2><div class="site-recommendations__content"><ul class="site-recommendations__combined dive-site-directory-list">{site_items}</ul></div>{pagination_nav(page, page_count, total, "/dive-sites/", "/dive-sites", "Dive-site pages")}</section>
</main>
{site_footer_markup()}'''
    title = "Dive Site Directory | DiveAtlas" if page == 1 else f"Dive Site Directory - Page {page} | DiveAtlas"
    canonical = f"{BASE_URL}/dive-sites/" if page == 1 else f"{BASE_URL}/dive-sites/page/{page}/"
    return page_shell(
        title,
        f"Browse page {page} of {page_count} in the {total} mapped dive-site profiles on DiveAtlas.",
        canonical,
        body,
        body_class="region-browser-page site-directory-page",
    )


def region_directory_page(
    groups: list[dict[str, object]],
    photos_by_path: dict[str, dict[str, str]],
    page: int = 1,
) -> str:
    total = len(groups)
    page_count = list_page_count(total)
    page = min(max(page, 1), page_count)
    start = (page - 1) * LIST_PAGE_SIZE
    visible_groups = groups[start:start + LIST_PAGE_SIZE]
    region_items = item_list(visible_groups, lambda group: destination_photo_card(
        group, photos_by_path[str(group["path"])]
    ))
    body = f'''<header class="site-header"><a href="/" class="brand"><img src="/assets/diveatlas-logo.svg?v=3" alt="DiveAtlas"></a></header>
<main class="region-browser">
  <h1>Dive sites by destination</h1>
  <p class="lead">Explore destination pages grouped from recorded dive-site locations. Full photo source, creator, and license details appear with each destination image.</p>
  <section aria-labelledby="regions-heading"><h2 id="regions-heading">Destinations ({total})</h2><ul class="destination-photo-list">{region_items}</ul>{pagination_nav(page, page_count, total, "/regions/", "/regions", "Destination pages")}</section>
  <p><a href="/dive-sites/">Browse all published dive-site profiles</a></p>
</main>
{site_footer_markup()}'''
    return page_shell(
        "Dive Sites by Destination | DiveAtlas",
        f"Browse DiveAtlas dive-site destination pages across {len(groups)} regions, with links to mapped sites and the full area browser.",
        f"{BASE_URL}/regions/",
        body,
        body_class="region-browser-page",
    )


def write_page(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    normalized = "\n".join(line.rstrip() for line in content.splitlines()) + "\n"
    path.write_text(normalized, encoding="utf-8", newline="\n")


def build(args: argparse.Namespace) -> dict[str, object]:
    rows, photos, summaries = load_rows(), load_photos(), load_summaries()
    area_index = public_region_index(rows)
    fallback_photo_base, fallback_photos = load_fallback_photos()
    candidates, rejected = validated_candidates(rows, photos, summaries, fallback_photo_base, fallback_photos)
    selected = candidates if args.site_limit is None else candidates[:args.site_limit]
    recommendations = build_recommendation_index(selected)

    rating_candidates = []
    for candidate in selected:
        photo = candidate.get("photo") or {}
        photo_src = str(photo.get("src", "")) if isinstance(photo, dict) else ""
        if photo_src and not re.match(r"^https?://", photo_src, re.I):
            photo_src = "/" + photo_src.lstrip("/")
        rating_candidates.append({
            "site_id": str(candidate["site_id"]),
            "name": str(candidate["name"]),
            "slug": str(candidate["slug"]),
            "detail_url": f'/dive-sites/{quote(str(candidate["slug"]))}/',
            "region": str(candidate["region"]),
            "lat": float(candidate["lat"]),
            "lon": float(candidate["lon"]),
            "photo": photo_src,
            "photo_credit": str(photo.get("credit", "")) if isinstance(photo, dict) else "",
            "features": recommendation_major_features(candidate),
        })
    rating_payload = json.dumps(rating_candidates, ensure_ascii=False, separators=(",", ":"))
    rating_filename = f"recommendation-candidates-{hashlib.sha256(rating_payload.encode('utf-8')).hexdigest()[:12]}.json"
    rating_candidates_url = f"/dive-sites/{rating_filename}"

    buckets: dict[tuple[str, str], dict[str, object]] = {}
    for site in selected:
        country, region = str(site["country"]), str(site["region"])
        if not region:
            continue
        key = (country.casefold(), region.casefold())
        bucket = buckets.setdefault(key, {"country": country, "region": region, "sites": []})
        bucket["sites"].append(site)
    eligible_regions = [group for group in buckets.values() if len(group["sites"]) >= MIN_SITES_PER_REGION]
    eligible_regions.sort(key=lambda group: (-len(group["sites"]), str(group["country"]).casefold(), str(group["region"]).casefold()))
    path_counts = Counter(region_path(str(group["country"]), str(group["region"])) for group in eligible_regions)
    for group in eligible_regions:
        path = region_path(str(group["country"]), str(group["region"]))
        if path_counts[path] > 1:
            suffix = hashlib.sha256(
                f'{group["country"]}\0{group["region"]}'.encode("utf-8")
            ).hexdigest()[:8]
            path = f"{path.rstrip('/')}-{suffix}/"
        group["path"] = path
    if len({str(group["path"]) for group in eligible_regions}) != len(eligible_regions):
        raise ValueError("Destination URL collision after applying deterministic suffixes")
    destination_photos_by_path = load_destination_photos(eligible_regions)
    regions = eligible_regions if args.region_limit is None else eligible_regions[:args.region_limit]
    region_by_place = {(str(group["country"]).casefold(), str(group["region"]).casefold()): group for group in regions}

    # The two output trees are generator-owned. This makes lower future limits
    # remove stale pages rather than leave URLs behind in the sitemap.
    for output in (SITE_OUTPUT, REGION_OUTPUT):
        if output.exists():
            shutil.rmtree(output)
    SITE_OUTPUT.mkdir()
    REGION_OUTPUT.mkdir()
    (SITE_OUTPUT / rating_filename).write_text(rating_payload + "\n", encoding="utf-8", newline="\n")

    sitemap_urls = [f"{BASE_URL}/", f"{BASE_URL}/dive-sites/", f"{BASE_URL}/regions/"]
    titles: set[str] = set()
    descriptions: set[str] = set()
    for site in selected:
        title, content = generate_site_page(
            site, region_by_place, recommendations[str(site["site_id"])], rating_candidates_url
        )
        if title in titles:
            place = ", ".join(value for value in (str(site["region"]), str(site["country"])) if value)
            title = f"{site['name']} in {place} ({float(site['lat']):.5f}, {float(site['lon']):.5f}) | DiveAtlas"
            content = content.replace(re.search(r"<title>.*?</title>", content, re.S).group(0), f"<title>{html_text(title)}</title>", 1)
        if title in titles:
            raise ValueError(f"Duplicate generated title: {title}")
        titles.add(title)
        canonical = f"{BASE_URL}/dive-sites/{quote(str(site['slug']))}/"
        description = re.search(r'<meta name="description" content="([^"]*)">', content).group(1)
        if description in descriptions:
            raise ValueError(f"Duplicate generated description for {canonical}")
        descriptions.add(description)
        write_page(SITE_OUTPUT / str(site["slug"]) / "index.html", content)
        sitemap_urls.append(canonical)

    site_directory_pages = list_page_count(len(selected))
    write_page(SITE_OUTPUT / "index.html", site_directory_page(selected))
    for page in range(2, site_directory_pages + 1):
        write_page(SITE_OUTPUT / "page" / str(page) / "index.html", site_directory_page(selected, page))
        sitemap_urls.append(f"{BASE_URL}/dive-sites/page/{page}/")

    destination_directory_pages = list_page_count(len(regions))
    write_page(REGION_OUTPUT / "index.html", region_browser_page(regions, destination_photos_by_path))
    for page in range(2, destination_directory_pages + 1):
        write_page(REGION_OUTPUT / "page" / str(page) / "index.html",
                   region_browser_page(regions, destination_photos_by_path, page))
        sitemap_urls.append(f"{BASE_URL}/regions/page/{page}/")
    (REGION_OUTPUT / "area-index.json").write_text(
        json.dumps(area_index, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8", newline="\n")

    for group in regions:
        title, content = generate_region_page(
            group,
            regions,
            destination_photos_by_path[str(group["path"])],
        )
        if title in titles:
            raise ValueError(f"Duplicate generated title: {title}")
        titles.add(title)
        write_page(ROOT / str(group["path"]).lstrip("/") / "index.html", content)
        sitemap_urls.append(f"{BASE_URL}{str(group['path'])}")

        region_output = ROOT / str(group["path"]).lstrip("/")
        site_pages = list_page_count(len(group["sites"]))
        for page in range(2, site_pages + 1):
            page_title, page_content = generate_region_page(
                group, regions, destination_photos_by_path[str(group["path"])], site_page=page,
            )
            if page_title in titles:
                raise ValueError(f"Duplicate generated title: {page_title}")
            titles.add(page_title)
            write_page(region_output / "sites" / "page" / str(page) / "index.html", page_content)
            sitemap_urls.append(f"{BASE_URL}{str(group['path']).rstrip('/')}/sites/page/{page}/")

        related_count = sum(
            1 for other in regions if other is not group
            and str(other["country"]).casefold() == str(group["country"]).casefold()
        )
        related_pages = list_page_count(related_count)
        for page in range(2, related_pages + 1):
            page_title, page_content = generate_region_page(
                group, regions, destination_photos_by_path[str(group["path"])], related_page=page,
            )
            if page_title in titles:
                raise ValueError(f"Duplicate generated title: {page_title}")
            titles.add(page_title)
            write_page(region_output / "related" / "page" / str(page) / "index.html", page_content)
            sitemap_urls.append(f"{BASE_URL}{str(group['path']).rstrip('/')}/related/page/{page}/")

    if len(sitemap_urls) != len(set(sitemap_urls)):
        raise ValueError("Duplicate URL in generated sitemap")

    # Build XML using the standard sitemap namespace; no fabricated freshness fields.
    namespace = "http://www.sitemaps.org/schemas/sitemap/0.9"
    ET.register_namespace("", namespace)
    urlset = ET.Element(f"{{{namespace}}}urlset")
    for url in sitemap_urls:
        ET.SubElement(ET.SubElement(urlset, f"{{{namespace}}}url"), f"{{{namespace}}}loc").text = url
    ET.indent(urlset, space="  ")
    xml = ET.tostring(urlset, encoding="unicode", xml_declaration=False)
    SITEMAP.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + xml + "\n", encoding="utf-8", newline="\n")

    return {
        "site_count": len(selected),
        "region_count": len(regions),
        "destination_photo_count": len(regions),
        "destination_photo_unique_source_count": len({
            destination_photos_by_path[str(group["path"])]["source_page"] for group in regions
        }),
        "destination_photo_review_status_counts": dict(Counter(
            destination_photos_by_path[str(group["path"])]["ai_review_status"] for group in regions
        )),
        "area_count": len(area_index["areas"]),
        "area_site_count": area_index["site_count"],
        "candidate_count": len(candidates),
        "rejected": rejected,
        "content_block_threshold": MIN_SITE_CONTENT_BLOCKS,
        "sitemap_url_count": len(sitemap_urls),
        "first_site_url": f"{BASE_URL}/dive-sites/{selected[0]['slug']}/" if selected else None,
        "first_region_url": f"{BASE_URL}{regions[0]['path']}" if regions else None,
        "region_threshold": MIN_SITES_PER_REGION,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-limit", type=int, default=None,
                        help="cap published site pages (default: all records passing the content gate)")
    parser.add_argument("--region-limit", type=int, default=None,
                        help="cap published region pages (default: all groups passing the site-count gate)")
    args = parser.parse_args()
    if (args.site_limit is not None and args.site_limit < 0) or (args.region_limit is not None and args.region_limit < 0):
        parser.error("limits must be zero or greater")
    print(json.dumps(build(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
