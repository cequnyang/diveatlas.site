#!/usr/bin/env python3
"""Build a source-linked, one-off scenic photo assignment for DiveAtlas areas.

The area hierarchy changes when the dive-site location index is rebuilt, so this
tool searches image catalogs from the current index instead of maintaining a
second list of area names. It stores remote thumbnail URLs to avoid adding
thousands of binary files to the repository; the manifest retains each source
page, author, and per-file license for attribution. A photo may show underwater
life, coast, wildlife, or a striking land or cityscape, but it must match the
area name, a named site in that area, or lie close to a recorded dive site.

Wikimedia is queried with maxlag, while Openverse is queried only for allowed
licenses and larger photographs. Candidate search results are checkpointed in
the user's temporary directory so an interrupted run can resume without
repeating completed API calls.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import email.utils
import http.client
import html
import json
import random
import re
import sys
import tempfile
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
AREA_INDEX = ROOT / "regions" / "area-index.json"
PILOT_MANIFEST = ROOT / "datasets" / "area-photo-pilot.json"
OUTPUT = ROOT / "datasets" / "area-photos.json"
CACHE = Path(tempfile.gettempdir()) / "diveatlas-area-photo-candidates-v1.json"
GEO_CACHE = Path(tempfile.gettempdir()) / "diveatlas-area-photo-geotagged-v4-pages500.json"
METADATA_CACHE = Path(tempfile.gettempdir()) / "diveatlas-area-photo-metadata-v1.json"
CATEGORY_CACHE = Path(tempfile.gettempdir()) / "diveatlas-area-photo-categories-v1.json"
OPENVERSE_CACHE = Path(tempfile.gettempdir()) / "diveatlas-area-photo-openverse-v1.json"
API = "https://commons.wikimedia.org/w/api.php"
OPENVERSE_API = "https://api.openverse.org/v1/images/"
OPENVERSE_PAGE_SIZE = 20
USER_AGENT = "DiveAtlasAreaPhotoGenerator/1.0 (https://diveatlas.site/) Python/3"
MIN_REQUEST_INTERVAL = 1.0  # Slow to one Commons request per second after repeated rate-limit responses.
MAX_CONCURRENCY = 3  # Wikimedia's client guidance caps concurrent requests at three.
SEARCH_LIMIT = 500
# Request more nearby files per anchor so scenic photos ranked below the first
# 48 distance results can still be considered after metadata and quality checks.
GEOSEARCH_LIMIT = 100
MAX_GEOSEARCH_PAGES = 5
SITE_SEARCH_TERMS = ("diving", "underwater", "reef", "coastline")
BATCH_SIZE = 40
MIN_PHOTO_QUALITY_SCORE = 8
GEOSEARCH_RADIUS_METERS = 10000
MIN_AESTHETIC_PROXY_SCORE = 22
EXPLICITLY_NON_SCENIC_MARKERS = (
    "festivus", "festival pole", "festival", "parade", "pride march",
    "gay pride", "political rally", "graduation ceremony", "wedding reception",
    "fish farm", "fish farming", "aquaculture", "turtle farm", "animal farm",
    "breeding pool at the turtle farm",
)
EXPLICIT_OFF_TOPIC_SCENE_MARKERS = (
    "aquarium", "zoo", "wildlife park", "museum specimen", "herbarium", "taxidermy",
    "dead animal", "dead seahorse", "carcass", "stranded animal", "fish trap",
    "birdhouse", "bird feeder", "town hall", "city hall", "municipal building",
    "government building", "church interior", "temple interior", "cathedral interior",
    "hotel room", "hotel interior", "lodge interior", "resort interior", "living room",
    "bedroom", "restaurant interior", "bar area", "interior design", "station concourse",
    "concert", "tournament", "sports event", "stadium", "war memorial", "war dead",
    "sea cadet", "training facility", "marine rescue unit", "tourist invasion",
    "no trespassing", "beach notice",
)


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def plain(value: Any) -> str:
    if value is None:
        return ""
    parser = TextExtractor()
    try:
        parser.feed(str(value))
        return re.sub(r"\s+", " ", html.unescape(" ".join(parser.parts))).strip()
    except Exception:
        return re.sub(r"\s+", " ", html.unescape(str(value))).strip()


def normalized(value: str) -> str:
    value = value.casefold()
    value = "".join(char for char in unicodedata.normalize("NFKD", value)
                    if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def contains_phrase(text: str, phrase: str) -> bool:
    # Callers pass normalized text and this helper is used in the hot candidate
    # loop; normalizing every metadata string for every subject term is costly.
    return f" {phrase} " in f" {text} "


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
                         encoding="utf-8")
    temporary.replace(path)


_last_request = 0.0
_request_lock = threading.Lock()


def api_get(params: dict[str, str]) -> dict[str, Any]:
    global _last_request
    last_failure = "no response"
    for attempt in range(9):
        with _request_lock:
            wait = MIN_REQUEST_INTERVAL - (time.monotonic() - _last_request)
            if wait > 0:
                time.sleep(wait)
            _last_request = time.monotonic()
        request_params = {**params, "format": "json", "maxlag": "5"}
        url = API + "?" + urllib.parse.urlencode(request_params)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                data = json.load(response)
        except urllib.error.HTTPError as exc:
            last_failure = f"HTTP {exc.code}"
            if exc.code == 429:
                retry_value = exc.headers.get("Retry-After", "5")
                try:
                    retry_after = float(retry_value)
                except ValueError:
                    retry_date = email.utils.parsedate_to_datetime(retry_value)
                    if retry_date.tzinfo is None:
                        retry_date = retry_date.replace(tzinfo=timezone.utc)
                    retry_after = max(0.0, (retry_date - datetime.now(timezone.utc)).total_seconds())
                time.sleep(max(retry_after, 5.0) + random.uniform(0.1, 0.8))
                continue
            if exc.code in (500, 502, 503, 504):
                time.sleep(min(2 ** attempt, 30) + random.uniform(0.1, 0.8))
                continue
            raise
        except (TimeoutError, ConnectionError, http.client.HTTPException, urllib.error.URLError):
            last_failure = "network timeout or connection error"
            time.sleep(min(2 ** attempt, 30) + random.uniform(0.1, 0.8))
            continue
        error = data.get("error", {})
        if error.get("code") == "maxlag":
            last_failure = f"maxlag {error.get('lag', 'unknown')}"
            time.sleep(max(float(error.get("lag", 5)), 5.0) + random.uniform(0.1, 0.8))
            continue
        if error:
            raise RuntimeError(f"Wikimedia API error: {error}")
        return data
    raise RuntimeError(f"Wikimedia API kept throttling or timing out after nine attempts; last failure: {last_failure}")


def display_parent(area: dict[str, Any], by_key: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    parent = area.get("parent")
    return by_key.get(parent) if isinstance(parent, str) else None


def query_for(area: dict[str, Any], by_key: dict[str, dict[str, Any]]) -> tuple[str, str]:
    parent = display_parent(area, by_key)
    label = str(area.get("label", "")).replace('"', " ").strip()
    parent_label = str(parent.get("label", "")).replace('"', " ").strip() if parent else ""
    query = f'filetype:bitmap "{label}"'
    if parent_label:
        query += f' "{parent_label}"'
    return query, parent_label


def candidate_search(area: dict[str, Any], query: str) -> list[dict[str, Any]]:
    params = {
        "action": "query",
        "generator": "search",
        "gsrsearch": query,
        "gsrnamespace": "6",
        "gsrlimit": str(SEARCH_LIMIT),
        "gsrprop": "snippet",
        "prop": "imageinfo",
        "iiprop": "url|size|mime",
    }
    data = api_get(params)
    pages = list(data.get("query", {}).get("pages", {}).values())
    output = []
    for page in pages:
        image = (page.get("imageinfo") or [{}])[0]
        if not image.get("descriptionurl"):
            continue
        if image.get("mime") not in {"image/jpeg", "image/png", "image/webp"}:
            continue
        width, height = int(image.get("width", 0)), int(image.get("height", 0))
        if max(width, height) < 640 or min(width, height) < 240:
            continue
        output.append({
            "title": page.get("title", ""),
            "snippet": plain(page.get("snippet", "")),
            "thumbnail": image.get("thumburl"),
            "sourcePage": image.get("descriptionurl"),
            "width": width,
            "height": height,
            "mime": image.get("mime"),
        })
    return output


def openverse_candidate_search(query: str, page: int = 1) -> list[dict[str, Any]] | None:
    """Search openly licensed large photos, keeping their source attribution data."""
    params = urllib.parse.urlencode({
        "q": query,
        "license": "by,by-sa,cc0,pdm",
        "page_size": str(OPENVERSE_PAGE_SIZE),
        "page": str(page),
        "extension": "jpg,jpeg,png,webp",
        "size": "large",
    })
    request = urllib.request.Request(
        f"{OPENVERSE_API}?{params}",
        headers={"User-Agent": USER_AGENT},
    )
    for attempt in range(2):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.load(response)
            return data.get("results", [])
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                try:
                    delay = float(exc.headers.get("Retry-After", "5"))
                except ValueError:
                    delay = 5.0
                time.sleep(max(2.0, min(delay, 15.0)) + random.uniform(0.1, 0.8))
            elif exc.code in (500, 502, 503, 504) and attempt == 0:
                time.sleep(2.0 + random.uniform(0.1, 0.8))
            else:
                return None
        except (TimeoutError, ConnectionError, http.client.HTTPException, urllib.error.URLError):
            if attempt == 0:
                time.sleep(1.0 + random.uniform(0.1, 0.8))
    return None


def commons_sha1_by_pageids(page_ids: list[str]) -> dict[str, str]:
    """Resolve Commons page IDs from Openverse to content hashes for deduplication."""
    hashes: dict[str, str] = {}
    unique_ids = list(dict.fromkeys(page_id for page_id in page_ids if page_id.isdigit()))
    for start in range(0, len(unique_ids), BATCH_SIZE):
        batch = unique_ids[start:start + BATCH_SIZE]
        data = api_get({
            "action": "query",
            "pageids": "|".join(batch),
            "prop": "imageinfo",
            "iiprop": "sha1",
        })
        for page_id, page in data.get("query", {}).get("pages", {}).items():
            image_info = (page.get("imageinfo") or [{}])[0]
            sha1 = image_info.get("sha1")
            if isinstance(sha1, str) and sha1:
                hashes[str(page_id)] = sha1
    return hashes


def openverse_records(item: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """Normalize an Openverse result into the manifest's attribution contract."""
    source = str(item.get("source", "")).strip().casefold()
    image_id = str(item.get("id", "")).strip()
    source_page = item.get("foreign_landing_url")
    thumbnail = item.get("thumbnail")
    title = plain(str(item.get("title") or ""))
    license_code = str(item.get("license", "")).strip().casefold()
    license_labels = {"by": "CC BY", "by-sa": "CC BY-SA", "cc0": "CC0", "pdm": "Public domain"}
    license_name = license_labels.get(license_code)
    if license_name and license_code in {"by", "by-sa"} and item.get("license_version"):
        license_name += f" {item['license_version']}"
    license_url = str(item.get("license_url", ""))
    width, height = int(item.get("width", 0)), int(item.get("height", 0))
    if (not image_id or not source_page or not thumbnail or not title or not license_name
            or not license_url or max(width, height) < 960 or min(width, height) < 360):
        return None

    raw_tags = item.get("tags", [])
    tag_names = [plain(str(tag.get("name") or "")) for tag in raw_tags
                 if isinstance(tag, dict) and tag.get("name")]
    location_tags = [plain(str(tag.get("name") or "")) for tag in raw_tags
                     if isinstance(tag, dict) and tag.get("name")
                     and str(tag.get("unstable__provider", "")).casefold() != "clarifai"]
    creator = plain(str(item.get("creator") or ""))
    description = plain(str(item.get("description") or ""))
    metadata_key = f"openverse:{image_id}"
    page_id = urllib.parse.parse_qs(
        urllib.parse.urlparse(str(source_page)).query
    ).get("curid", [""])[0] if source == "wikimedia" else ""
    source_provider = {
        "wikimedia": "Openverse (Wikimedia Commons)",
    }.get(source, f"Openverse ({source})" if source else "Openverse")
    metadata = {
        "width": width,
        "height": height,
        "thumburl": thumbnail,
        "descriptionurl": source_page,
        "sha1": None,
        "categories": tag_names,
        "_sourceProvider": source_provider,
        "extmetadata": {
            "LicenseShortName": {"value": license_name},
            "LicenseUrl": {"value": license_url},
            "ObjectName": {"value": title},
            "ImageDescription": {"value": description},
            "Artist": {"value": creator},
            "Attribution": {"value": creator},
        },
    }
    candidate = {
        "title": title,
        "metadataKey": metadata_key,
        "sourcePage": source_page,
        "thumbnail": thumbnail,
        "snippet": " ".join(location_tags),
        "openverseLocationText": " ".join(location_tags),
        "openverseId": image_id,
        "sourceImageUrl": item.get("url"),
        "sourceName": source,
        "commonsPageId": page_id,
    }
    return candidate, metadata


def load_site_rows() -> dict[str, list[Any]]:
    source = (ROOT / "datasets" / "dive-sites.js").read_text(encoding="utf-8-sig")
    if "=" not in source:
        raise ValueError("Could not find the dive-site dataset assignment")
    rows = json.loads(source.split("=", 1)[1].rsplit(";", 1)[0])
    return {str(row[12]).casefold(): row for row in rows
            if isinstance(row, list) and len(row) > 12 and row[12]}


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance for the site's coordinate and a Commons geotag."""
    from math import asin, cos, radians, sin, sqrt

    phi1, phi2 = radians(lat1), radians(lat2)
    dphi, dlambda = radians(lat2 - lat1), radians(lon2 - lon1)
    h = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    return 6371.0088 * 2 * asin(min(1.0, sqrt(h)))


def area_site_anchors(area: dict[str, Any], area_payload: dict[str, Any],
                      rows_by_id: dict[str, list[Any]], limit: int) -> list[dict[str, Any]]:
    """Pick spatially spread, real dive-site coordinates represented by an area."""
    sites = area_payload.get("sites", [])
    candidates: list[dict[str, Any]] = []
    seen_coords: set[tuple[float, float]] = set()
    for index in area.get("site_indices", []):
        if not isinstance(index, int) or index < 0 or index >= len(sites):
            continue
        site = sites[index]
        row = rows_by_id.get(str(site.get("site_id", "")).casefold())
        if not row or not isinstance(row[1], (int, float)) or not isinstance(row[2], (int, float)):
            continue
        lat, lon = float(row[1]), float(row[2])
        coord_key = (round(lat, 5), round(lon, 5))
        if coord_key in seen_coords:
            continue
        seen_coords.add(coord_key)
        candidates.append({
            "siteId": str(row[12]),
            "siteName": str(row[0]),
            "lat": lat,
            "lon": lon,
        })
    if len(candidates) <= limit:
        return candidates

    # Start at the geographic median, then add the farthest remaining sites.
    # This samples both the center and edges of large areas without assigning
    # every area the same first alphabetic dive site.
    lats = sorted(site["lat"] for site in candidates)
    lons = sorted(site["lon"] for site in candidates)
    median_lat = lats[len(lats) // 2]
    median_lon = lons[len(lons) // 2]
    chosen = [min(candidates, key=lambda site: distance_km(
        median_lat, median_lon, site["lat"], site["lon"]))]
    while len(chosen) < limit:
        next_site = max((site for site in candidates if site not in chosen), key=lambda site: min(
            distance_km(site["lat"], site["lon"], selected["lat"], selected["lon"])
            for selected in chosen))
        chosen.append(next_site)
    return chosen


def geotagged_candidate_search(anchor: dict[str, Any]) -> list[dict[str, Any]]:
    params: dict[str, str] = {
        "action": "query",
        "generator": "geosearch",
        "ggscoord": f"{anchor['lat']}|{anchor['lon']}",
        "ggsradius": str(GEOSEARCH_RADIUS_METERS),
        "ggsnamespace": "6",
        "ggslimit": str(GEOSEARCH_LIMIT),
        "prop": "imageinfo|coordinates",
        "iiprop": "url|size|mime",
        "iiurlwidth": "960",
    }
    output = []
    for _ in range(MAX_GEOSEARCH_PAGES):
        data = api_get(params)
        for page in data.get("query", {}).get("pages", {}).values():
            image = (page.get("imageinfo") or [{}])[0]
            coords = page.get("coordinates") or []
            if not image.get("descriptionurl") or not coords:
                continue
            if image.get("mime") not in {"image/jpeg", "image/png", "image/webp"}:
                continue
            width, height = int(image.get("width", 0)), int(image.get("height", 0))
            if max(width, height) < 960 or min(width, height) < 360:
                continue
            try:
                geo_lat, geo_lon = float(coords[0]["lat"]), float(coords[0]["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            distance = distance_km(anchor["lat"], anchor["lon"], geo_lat, geo_lon)
            if distance > GEOSEARCH_RADIUS_METERS / 1000:
                continue
            output.append({
                "title": page.get("title", ""),
                "thumbnail": image.get("thumburl"),
                "sourcePage": image.get("descriptionurl"),
                "width": width,
                "height": height,
                "mime": image.get("mime"),
                "matchType": "site-within-area",
                "matchingDiveSite": anchor["siteName"],
                "matchingSiteId": anchor["siteId"],
                "geoDistanceKm": round(distance, 2),
                "geoCoordinates": [geo_lat, geo_lon],
            })
        continuation = data.get("continue")
        if not isinstance(continuation, dict):
            break
        params.update({str(key): str(value) for key, value in continuation.items()})
    return output


def search_score(area: dict[str, Any], candidate: dict[str, Any], parent_label: str) -> tuple[int, bool]:
    label = normalized(str(area.get("label", "")))
    parent = normalized(parent_label)
    title = normalized(candidate.get("title", "").replace("File:", ""))
    snippet = normalized(candidate.get("snippet", ""))
    all_text = f" {title} {snippet} "
    meaningful = [word for word in label.split() if len(word) > 2 and word not in {"and", "the", "of", "island", "islands"}]
    score = 0
    if label and f" {label} " in f" {title} ":
        score += 100
    elif label and f" {label} " in f" {snippet} ":
        score += 80
    if meaningful:
        found = sum(1 for word in meaningful if f" {word} " in all_text)
        score += int(40 * found / len(meaningful))
        if found == len(meaningful):
            score += 20
    if parent and parent in all_text:
        score += 8
    travel_terms = ("reef", "underwater", "scuba", "diving", "dive site", "beach", "island", "coast",
                    "bay", "wreck", "lake", "cave", "ocean", "sea", "snorkel", "coral")
    score += min(12, sum(2 for term in travel_terms if term in all_text))
    avoid_terms = ("location map", "outline map", "blank map", "flag of", "coat of arms", "logo", "icon")
    if any(term in title for term in avoid_terms):
        score -= 80
    exact = bool(label and (f" {label} " in f" {title} " or f" {label} " in f" {snippet} "))
    if len(meaningful) == 1 and len(meaningful[0]) < 5:
        exact = exact and bool(parent and parent in all_text)
    return score, exact


def site_name_search_evidence(candidate: dict[str, Any], parent_label: str) -> tuple[int, str, bool] | None:
    """Accept a file only when it names a dive site represented by the area."""
    site_name = normalized(str(candidate.get("siteSearchName", "")))
    if not site_name:
        return None
    title = normalized(str(candidate.get("title", "")).removeprefix("File:"))
    snippet = normalized(str(candidate.get("snippet", "")))
    combined = f" {title} {snippet} "
    in_title = f" {site_name} " in f" {title} "
    in_snippet = f" {site_name} " in f" {snippet} "
    if not (in_title or in_snippet):
        return None

    # Generic site names such as "Blue Hole" need visible parent-area context.
    generic_terms = {"bay", "blue", "cave", "channel", "garden", "hole", "point",
                     "pinnacle", "reef", "rock", "rocks", "wall"}
    site_words = [word for word in site_name.split() if word not in {"the", "of", "at"}]
    generic_name = len(site_words) <= 2 and any(word in generic_terms for word in site_words)
    parent = normalized(parent_label)
    if generic_name and (not parent or f" {parent} " not in combined):
        return None
    if not in_title and (not parent or f" {parent} " not in combined):
        return None
    return (100 if in_title else 80), str(candidate.get("siteSearchName", "")), in_title


def title_names_area(area_label: Any, file_title: Any) -> bool:
    """Use an exact area-name phrase in a Commons file title as place evidence."""
    label = normalized(str(area_label or ""))
    title = normalized(str(file_title or "").removeprefix("File:"))
    return bool(label and f" {label} " in f" {title} ")


def openverse_search_aliases(area: dict[str, Any]) -> list[str]:
    """Search the complete area label and its named place components."""
    label = str(area.get("label", "")).strip()
    generic = {
        "arch", "bay", "beach", "blue", "boulder", "breakwater", "cave", "channel", "city", "cove", "dive",
        "east", "east side", "harbor", "head", "island", "islands", "islet", "islets",
        "hole", "lagoon", "ledge", "lighthouse", "lighthouse point", "marker", "middle bay",
        "north", "north side", "north wall", "pass", "pinnacle", "point", "power lines",
        "reef", "rock", "rocks", "shoal", "shoals", "south", "south side", "south wall",
        "turtle", "wall", "wreck",
    }
    parts = re.split(r"\s*,\s*|\s+[-–—]\s+", label)
    aliases = []
    for alias in [label, *parts]:
        alias = alias.strip()
        key = normalized(alias)
        if not key or key in generic:
            continue
        if all(word in generic for word in key.split()):
            continue
        if alias not in aliases:
            aliases.append(alias)
    return aliases


def openverse_place_evidence(area: dict[str, Any], candidate: dict[str, Any]) -> tuple[int, str, bool] | None:
    """Require an Openverse result's title or human-applied tags to name this place."""
    alias = str(candidate.get("openverseMatchAlias", ""))
    normalized_alias = normalized(alias)
    if not normalized_alias or normalized_alias not in normalized(str(area.get("label", ""))):
        return None
    title = normalized(str(candidate.get("title", "")))
    tags = normalized(str(candidate.get("openverseLocationText", "")))
    in_title = f" {normalized_alias} " in f" {title} "
    in_tags = f" {normalized_alias} " in f" {tags} "
    if not in_tags:
        compact_alias = re.sub(r"[^a-z0-9]", "", normalized_alias)
        compact_tags = re.sub(r"[^a-z0-9]", "", tags)
        in_tags = bool(compact_alias and compact_alias in compact_tags)
    if not (in_title or in_tags):
        return None
    # Common names need a second, more local phrase to disambiguate the place.
    ambiguous = {"barkley island", "dundas island", "maud island", "turtle rock", "boulder city"}
    if normalized_alias in ambiguous:
        other_names = [normalized(name) for name in openverse_search_aliases(area)
                       if normalized(name) != normalized_alias]
        has_local_context = any(
            f" {name} " in f" {title} {tags} "
            or re.sub(r"[^a-z0-9]", "", name) in re.sub(r"[^a-z0-9]", "", tags)
            for name in other_names
        )
        if not has_local_context:
            return None
    return (100 if in_title else 80), alias, in_title


def photo_quality_score(fields: dict[str, str]) -> int | None:
    """Reject maps and data graphics; prefer underwater and destination photos."""
    text = normalized(" ".join((fields.get("title", ""), fields.get("description", ""),
                                fields.get("categories", ""))))
    if explicitly_non_scenic(text):
        return None
    excluded = (
        " map ", " atlas ", " orthographic ", " satellite ", " infographic ",
        " chart ", " graph ", " diagram ", " life expectancy ", " population density ",
        " license plate ", " weather map ", " weather chart ", " flood map ",
        " road map ", " topographic map ", " location map ", " administrative divisions ",
        " geoscheme ", " flag of ", " coat of arms ", " logo ", " icon ", " seal of ",
        " data visualization ", " election results ", " climate graph ", " painting ",
        " painter ", " peintre ", " drawing ", " illustration ", " artwork ",
        " art installation ", " installation view ", " portrait ", " sculpture ",
        " statue ", " museum ", " artifact ", " antiquity ", " archaeological ",
        " timeline ", " demographic ", " poster ", " license plate ", " plaque ",
        " postage stamp ", " military ", " defense ", " prime minister ",
        " politician ", " official visit ", " press conference ", " weapons handling ",
        " military exercise ", "naval blockade", " car ", " automobile ", " bus ",
        " truck ", " vehicle ", " railway disaster ", " rail disaster ",
        " journal ", " newspaper ", " magazine ", " front page ", " book cover ",
        " title page ", " publication ", " manuscript ", " document scan ",
        " information ", " hatchery ", " student protest ",
        " political protest ", " campaign ", " rugby ", " football match ", " soccer ",
        " skatepark ", " airport terminal ", " train station ", " railway station ",
        " university library ", " air force commander ",
        " coast guard ", " maritime security ", " military operation ", " navy personnel ",
        " naval patrol ", " astronaut ", " space shuttle ", " space telescope ",
        " hubble space telescope ", " spacecraft ", " outer space ", " orbit of earth ",
        " golf tournament ", " golf club ", " professional golf ", " sports event ",
        " championship game ", " concert ", " music festival ", " stadium ",
        " subway station ", " metro station ", " station concourse ", " railway platform ",
        " beach rules ", " parking lot ", " parking area ", " event venue ",
        " hotel room ", " hotel interior ", " hotel lobby ", " hotel suite ",
        " lodge interior ", " resort interior ", " living room ", " bedroom ",
        " dining room ", " bar area ", " restaurant interior ", " indoor pool ",
        " room interior ", " interior design ", " apartment interior ",
    )
    padded = f" {text} "
    if any(term in padded for term in excluded):
        return None
    scenic_terms = {
        "underwater": 32, "scuba": 32, "diving": 32, "diver": 30, "reef": 30,
        "coral": 28, "marine life": 26, "fish": 18, "whale shark": 28, "manta": 24,
        "turtle": 18, "shipwreck": 20, "wreck": 16, "snorkel": 20, "beach": 14,
        "coast": 12, "coastal": 14, "island": 10, "ocean": 10, "sea": 10,
        "bay": 10, "shore": 10, "landscape": 8, "waterfall": 8, "harbor": 6,
        "port": 6, "waterfront": 8, "cityscape": 8, "skyline": 8,
        "mountain": 8, "volcano": 8, "canyon": 8, "lagoon": 10, "atoll": 10,
        "cove": 8, "cliff": 8, "forest": 8, "rainforest": 8, "nature": 8,
        "wildlife": 8, "mountains": 8, "desert": 8, "glacier": 8, "lake": 8,
        "river": 6, "village": 8, "old town": 8, "scenic": 8, "tropical": 8,
        "panorama": 8, "scenery": 8, "countryside": 8, "city view": 8,
        "national park": 10, "nature reserve": 8,
    }
    return sum(weight for term, weight in scenic_terms.items() if contains_phrase(text, term))


def explicitly_non_scenic(normalized_text: str) -> bool:
    """Exclude event and commercial-farm subjects that can be geotagged locally."""
    return any(contains_phrase(normalized_text, normalized(term))
               for term in EXPLICITLY_NON_SCENIC_MARKERS)


def explicitly_off_topic_scene(fields: dict[str, str]) -> bool:
    """Reject clearly unrelated subjects even when a geotag is locally accurate."""
    combined = normalized(" ".join((fields.get("title", ""), fields.get("description", ""),
                                     fields.get("categories", ""))))
    return any(contains_phrase(combined, term)
               for term in EXPLICIT_OFF_TOPIC_SCENE_MARKERS)


def photo_scene_class(fields: dict[str, str]) -> str | None:
    """Require a scenic, natural, or destination subject tied to the area."""
    display_text = normalized(" ".join((fields.get("title", ""), fields.get("description", ""))))
    category_text = normalized(fields.get("categories", ""))
    combined = f" {display_text} {category_text} "
    if explicitly_non_scenic(combined):
        return None
    marine_terms = (
        "underwater", "scuba", "diving", "diver", "reef", "coral", "marine life",
        "fish", "fishes", "whale", "dolphin", "shark", "manta ray", "stingray",
        "sea turtle", "shipwreck", "wreck", "snorkel", "sea lion", "sealion",
        "seal colony", "penguin", "seagrass", "sea grass", "kelp forest", "cenote",
        "blue hole", "cave diving", "underwater cave",
    )
    coastal_terms = (
        "beach", "coast", "coastal", "coastline", "seaside", "seascape", "island",
        "ocean", "sea", "bay", "shore", "waterfront", "harbor", "port", "lagoon",
        "atoll", "cove", "lake", "waterfall", "river", "cenote", "blue hole",
        "underwater cave", "cave diving", "sunset over water",
    )
    regional_scenery_terms = (
        "landscape", "mountain", "mountains", "volcano", "forest", "rainforest",
        "jungle", "waterfall", "river", "lake", "desert", "glacier", "iceberg",
        "canyon", "valley", "cliff", "cave", "geyser", "hot spring", "national park",
        "nature reserve", "wildlife", "fauna", "flora", "flower", "bird", "mammal",
        "reptile", "animal", "geology", "landform", "scenery", "nature", "scenic",
        "panorama", "tropical", "savanna", "savannah", "swamp", "wetland", "field",
        "plains", "sand dune", "dunes", "countryside", "village", "old town",
        "historic district", "cityscape", "skyline", "city view", "lighthouse",
    )
    if explicitly_off_topic_scene(fields):
        return None
    if any(contains_phrase(combined, term) for term in marine_terms):
        return "underwater-or-marine-life"
    if any(contains_phrase(combined, term) for term in coastal_terms):
        return "coastal-or-water-landscape"
    if any(contains_phrase(combined, term) for term in regional_scenery_terms):
        return "regional-landscape-or-wildlife"
    return None


def photo_aesthetic_proxy_score(fields: dict[str, str], width: int, height: int) -> int:
    """Rank likely visual polish using Commons human curation and image craft proxies.

    This is a shortlist score, not a claim that software can certify beauty. A
    human-curated Commons quality category is stronger evidence than resolution;
    the manifest records automated picks as unreviewed until a person inspects them.
    """
    categories = normalized(fields.get("categories", ""))
    text = normalized(" ".join((fields.get("title", ""), fields.get("description", ""))))
    score = 0
    rejected_quality = any(term in categories for term in (
        "declined quality images", "rejected quality images", "declined featured picture",
    ))
    if rejected_quality:
        return 0
    if contains_phrase(categories, "featured picture") or contains_phrase(categories, "picture of the day"):
        score += 100
    if not rejected_quality and (contains_phrase(categories, "quality image")
                                 or contains_phrase(categories, "quality images")):
        score += 80
    if contains_phrase(categories, "valued image") or contains_phrase(categories, "valued images"):
        score += 60

    longest, shortest = max(width, height), min(width, height)
    megapixels = width * height / 1_000_000
    if longest >= 4000:
        score += 14
    elif longest >= 2400:
        score += 10
    elif longest >= 1600:
        score += 6
    if shortest >= 1200:
        score += 8
    elif shortest >= 800:
        score += 4
    if megapixels >= 8:
        score += 6
    elif megapixels >= 3:
        score += 3

    ratio = longest / max(1, shortest)
    if 1.25 <= ratio <= 2.1:
        score += 5
    elif ratio <= 2.6:
        score += 2

    if any(contains_phrase(text, term) for term in (
        "panorama", "colorful", "colourful", "vibrant", "sunrise", "sunset",
        "coral garden", "coral wall", "school of fish", "manta ray", "whale shark",
    )):
        score += 5
    return score


def metadata_for(titles: list[str]) -> dict[str, dict[str, Any]]:
    cache = read_json(METADATA_CACHE, {})
    result: dict[str, dict[str, Any]] = {title: info for title, info in cache.items() if info}

    def fetch_batch(batch: list[str]) -> dict[str, dict[str, Any]]:
        try:
            data = api_get({
                "action": "query",
                "titles": "|".join(batch),
                "prop": "imageinfo",
                "iiprop": "url|size|mime|sha1|extmetadata",
                "iiurlwidth": "960",
            })
        except urllib.error.HTTPError as exc:
            if exc.code != 414 or len(batch) <= 1:
                raise
            # Very long Commons filenames can push a URL over the server limit;
            # split that request without discarding the other files in it.
            middle = len(batch) // 2
            return {**fetch_batch(batch[:middle]), **fetch_batch(batch[middle:])}
        except RuntimeError as exc:
            recoverable = (
                "urlparamnormal" in str(exc)
                or "network timeout or connection error" in str(exc)
            )
            if not recoverable:
                raise
            # One oversized or transiently slow file can fail a whole batch.
            # Split it so neighboring candidates can still be checked.
            if len(batch) == 1:
                return {}
            middle = len(batch) // 2
            return {**fetch_batch(batch[:middle]), **fetch_batch(batch[middle:])}
        batch_result = {}
        for page in data.get("query", {}).get("pages", {}).values():
            info = (page.get("imageinfo") or [{}])[0]
            if info:
                batch_result[page.get("title", "")] = info
        return batch_result

    pending_titles = [title for title in titles if title not in cache]
    batches = [pending_titles[start:start + BATCH_SIZE]
               for start in range(0, len(pending_titles), BATCH_SIZE)]
    print(f"Attribution metadata: reusing {len(titles) - len(pending_titles):,} cached files; "
          f"fetching {len(pending_titles):,}", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as pool:
        futures = {pool.submit(fetch_batch, batch): batch for batch in batches}
        for completed, future in enumerate(concurrent.futures.as_completed(futures), 1):
            batch = futures[future]
            batch_result = future.result()
            result.update(batch_result)
            for title in batch:
                cache[title] = batch_result.get(title, {})
            if completed % 20 == 0 or completed == len(futures):
                write_json(METADATA_CACHE, cache)
            if completed % 10 == 0 or completed == len(futures):
                print(f"Attribution metadata: {completed:,}/{len(futures):,} batches",
                      flush=True)
    write_json(METADATA_CACHE, cache)
    return result


def accepted_license(meta: dict[str, Any]) -> tuple[str, str] | None:
    fields = meta.get("extmetadata", {})
    name = plain(fields.get("LicenseShortName", {}).get("value", ""))
    url = plain(fields.get("LicenseUrl", {}).get("value", ""))
    n = normalized(name)
    if "nc" in n.split() or "nd" in n.split():
        return None
    if n.startswith("cc0") or "public domain" in n or n in {"pd", "pd old", "pd art"}:
        return name, url
    if n.startswith("cc by") and ("sa" in n.split() or "by" in n.split()) and not ("nc" in n.split() or "nd" in n.split()):
        return name, url
    return None


def metadata_text(meta: dict[str, Any]) -> dict[str, str]:
    fields = meta.get("extmetadata", {})
    result = {key: plain(fields.get(field, {}).get("value", "")) for key, field in {
        "title": "ObjectName",
        "description": "ImageDescription",
        "categories": "Categories",
        "creator": "Artist",
        "credit": "Credit",
        "attribution": "Attribution",
    }.items()}
    categories = meta.get("categories")
    if isinstance(categories, list) and categories:
        result["categories"] = " ".join(plain(category) for category in categories if category)
    return result


def category_metadata_for(titles: list[str]) -> dict[str, list[str]]:
    """Fetch Commons page categories so scene checks use the file's actual taxonomy."""
    cache = read_json(CATEGORY_CACHE, {})
    result = {title: categories for title, categories in cache.items()
              if isinstance(categories, list)}

    def title_key(title: str) -> str:
        return title.replace("_", " ").casefold()

    def fetch_batch(batch: list[str]) -> dict[str, list[str]]:
        try:
            data = api_get({
                "action": "query",
                "titles": "|".join(batch),
                "prop": "categories",
                "cllimit": "50",
            })
        except urllib.error.HTTPError as exc:
            if exc.code != 414 or len(batch) <= 1:
                raise
            # A small number of unusually long Commons filenames can make a
            # batch URL exceed the server limit; split only that batch.
            middle = len(batch) // 2
            return {**fetch_batch(batch[:middle]), **fetch_batch(batch[middle:])}
        except RuntimeError as exc:
            if "network timeout or connection error" not in str(exc):
                raise
            if len(batch) == 1:
                return {batch[0]: []}
            middle = len(batch) // 2
            return {**fetch_batch(batch[:middle]), **fetch_batch(batch[middle:])}
        pages = data.get("query", {}).get("pages", {}).values()
        by_key = {
            title_key(str(page.get("title", ""))): [
                str(category.get("title", ""))
                for category in page.get("categories", [])
                if category.get("title")
            ]
            for page in pages
        }
        return {title: by_key.get(title_key(title), []) for title in batch}

    pending = [title for title in titles if title not in cache]
    batches = [pending[start:start + BATCH_SIZE]
               for start in range(0, len(pending), BATCH_SIZE)]
    print(f"Commons categories: reusing {len(titles) - len(pending):,}; "
          f"fetching {len(pending):,} files", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as pool:
        futures = {pool.submit(fetch_batch, batch): batch for batch in batches}
        for completed, future in enumerate(concurrent.futures.as_completed(futures), 1):
            batch = futures[future]
            batch_result = future.result()
            result.update(batch_result)
            cache.update(batch_result)
            if completed % 20 == 0 or completed == len(futures):
                write_json(CATEGORY_CACHE, cache)
            if completed % 20 == 0 or completed == len(futures):
                print(f"Commons categories: {completed:,}/{len(futures):,} batches", flush=True)
    write_json(CATEGORY_CACHE, cache)
    return result


def source_page_file_title(entry: dict[str, Any]) -> str:
    source_page = entry.get("sourcePage", "")
    if not isinstance(source_page, str):
        return ""
    path = urllib.parse.urlparse(source_page).path
    if "/wiki/" not in path:
        return ""
    return urllib.parse.unquote(path.split("/wiki/", 1)[1])


def revalidate_existing_photos(entries: dict[str, dict[str, Any]],
                               metadata: dict[str, dict[str, Any]],
                               rejections: Counter[str]) -> dict[str, dict[str, Any]]:
    """Apply current source, scene, and beauty rules to preserved assignments."""
    retained = {}
    for key, entry in entries.items():
        if entry.get("selectionStatus") == "editorially-reviewed-pilot":
            retained[key] = entry
            continue
        stored_text = normalized(" ".join((
            str(entry.get("photoTitle", "")), str(entry.get("photoDescription", ""))
        )))
        if explicitly_non_scenic(stored_text):
            rejections["preserved_explicit_non_scenic_subject"] += 1
            continue
        geo_distance = entry.get("geoDistanceKm")
        is_nearby_geotag = (
            entry.get("matchType") == "site-within-area"
            and geo_distance is not None
            and float(geo_distance)
            <= GEOSEARCH_RADIUS_METERS / 1000
        )
        is_site_name_match = (
            entry.get("matchType") == "site-within-area"
            and entry.get("selectionStatus") == "automated-site-name-candidate-unreviewed"
            and entry.get("matchingDiveSite")
        )
        is_openverse_assignment = (
            entry.get("selectionStatus") == "automated-openverse-candidate-unreviewed"
        )
        is_openverse_place_match = False
        if is_openverse_assignment:
            area_for_photo = {"label": entry.get("label", "")}
            stored_candidate = {
                "title": entry.get("photoTitle", ""),
                "openverseLocationText": entry.get("openverseLocationText", ""),
            }
            is_openverse_place_match = any(
                openverse_place_evidence(area_for_photo, {
                    **stored_candidate,
                    "openverseMatchAlias": alias,
                })
                for alias in openverse_search_aliases(area_for_photo)
            )
        stored_scene = entry.get("photoSceneClass")
        is_area_title_match = (
            entry.get("matchType") == "area-specific"
            and title_names_area(entry.get("label"), source_page_file_title(entry))
        )
        is_unclassified_location_match = (
            (stored_scene == "site-geotagged-visual-candidate" and is_nearby_geotag)
            or (stored_scene == "area-name-visual-candidate" and is_area_title_match)
        )
        stored_quality_floor = (
            0 if is_unclassified_location_match
            or (stored_scene == "openverse-place-name-visual-candidate" and is_openverse_place_match)
            else 6 if is_nearby_geotag else MIN_PHOTO_QUALITY_SCORE
        )
        # Assignments already selected under this policy carry their measured
        # source, scene, quality, and beauty evidence. Keep those stable while
        # expanding coverage; repeatedly re-running metadata heuristics can
        # otherwise evict good photos when Commons metadata changes or is sparse.
        if (
            entry.get("photoAestheticStatus") == "automated-curation-and-image-quality-proxy-unreviewed"
            and int(entry.get("photoAestheticScore") or 0) >= MIN_AESTHETIC_PROXY_SCORE
            and int(entry.get("photoQualityScore") or 0) >= stored_quality_floor
            and entry.get("photoSceneClass")
            and (stored_scene not in {"site-geotagged-visual-candidate", "area-name-visual-candidate"}
                 or is_unclassified_location_match)
            and (stored_scene != "site-name-visual-candidate" or is_site_name_match)
            and (not is_openverse_assignment or is_openverse_place_match)
            and entry.get("sourcePage")
            and entry.get("license")
        ):
            retained[key] = entry
            continue
        title = source_page_file_title(entry)
        info = metadata.get(title, {})
        fields = metadata_text(info) if info else {}
        if not fields.get("title"):
            fields["title"] = entry.get("photoTitle", "")
        license_data = accepted_license(info) if info else None
        width, height = int(info.get("width", 0)), int(info.get("height", 0))
        quality_score = photo_quality_score(fields)
        scene_class = photo_scene_class(fields)
        if (not scene_class and is_nearby_geotag and quality_score is not None
                and not explicitly_off_topic_scene(fields)):
            scene_class = "site-geotagged-visual-candidate"
        elif (not scene_class and is_site_name_match and quality_score is not None
              and quality_score >= MIN_PHOTO_QUALITY_SCORE
              and not explicitly_off_topic_scene(fields)):
            scene_class = "site-name-visual-candidate"
        elif (not scene_class and is_area_title_match and quality_score is not None
              and not explicitly_off_topic_scene(fields)):
            scene_class = "area-name-visual-candidate"
        min_quality = (
            0 if scene_class in {"site-geotagged-visual-candidate", "area-name-visual-candidate"}
            else 6 if is_nearby_geotag else MIN_PHOTO_QUALITY_SCORE
        )
        aesthetic_score = photo_aesthetic_proxy_score(fields, width, height)
        invalid_reason = next((reason for reason, invalid in (
            ("preserved_metadata_missing", not info),
            ("preserved_license_not_accepted", bool(info) and not license_data),
            ("preserved_explicit_ai_generation_marker", bool(info) and has_ai_generation_marker(fields)),
            ("preserved_scene_not_underwater_or_coastal", bool(info) and not scene_class),
            ("preserved_photo_quality_too_low", quality_score is None or quality_score < min_quality),
            ("preserved_aesthetic_proxy_too_low", aesthetic_score < MIN_AESTHETIC_PROXY_SCORE),
        ) if invalid), None)
        if invalid_reason:
            rejections[invalid_reason] += 1
            continue
        entry = dict(entry)
        entry["photoQualityScore"] = quality_score
        entry["photoAestheticScore"] = aesthetic_score
        entry["photoSceneClass"] = scene_class
        retained[key] = entry
    return retained


def has_ai_generation_marker(fields: dict[str, str]) -> bool:
    """Exclude files whose Commons text explicitly identifies AI generation."""
    text = normalized(" ".join(fields.values()))
    markers = (
        "ai generated", "generated by ai", "generated with ai",
        "artificial intelligence generated", "generative ai",
        "midjourney", "stable diffusion", "dall e", "flux ai",
        "firefly generated", "synthography", "synthetic image",
        "computer generated image",
    )
    return any(marker in text for marker in markers)


def pilot_entries() -> dict[str, dict[str, Any]]:
    data = read_json(PILOT_MANIFEST, {})
    return {entry.get("areaKey"): entry for entry in data.get("entries", []) if entry.get("areaKey")}


def choose_direct_entries(areas: list[dict[str, Any]], searches: dict[str, list[dict[str, Any]]],
                          site_searches: dict[str, list[dict[str, Any]]],
                          openverse_searches: dict[str, list[dict[str, Any]]],
                          geo_searches: dict[str, list[dict[str, Any]]],
                          by_key: dict[str, dict[str, Any]], metadata: dict[str, dict[str, Any]],
                          pilots: dict[str, dict[str, Any]],
                          rejections: Counter[str]) -> dict[str, dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for area in areas:
        key = area["key"]
        pilot = pilots.get(key)
        if pilot:
            selected[key] = {
                **pilot,
                "matchType": pilot.get("matchType", "area-specific"),
                "selectionStatus": "editorially-reviewed-pilot",
                "aiReviewStatus": pilot.get("aiReviewStatus", "editorially-reviewed-source-photo"),
                "matchEvidence": pilot.get("matchNotes", "Editorially reviewed pilot photo."),
                "photoQualityScore": 100,
                "photoAestheticScore": 100,
                "photoAestheticStatus": "editorially-reviewed-pilot",
                "contentSha1": pilot.get("contentSha1"),
                "photoOriginArea": area.get("label"),
            }
            continue
        query = [(candidate, False) for candidate in searches.get(key, [])]
        query.extend((candidate, False) for candidate in site_searches.get(key, []))
        query.extend((candidate, False) for candidate in openverse_searches.get(key, []))
        query.extend((candidate, True) for candidate in geo_searches.get(key, []))
        parent = display_parent(area, by_key)
        parent_label = parent.get("label", "") if parent else ""
        ranked_candidates = []
        for candidate, geotagged in query:
            info = metadata.get(candidate.get("metadataKey") or candidate.get("title", ""), {})
            license_data = accepted_license(info)
            if not info:
                rejections["missing_file_metadata"] += 1
                continue
            if not license_data:
                rejections["license_not_accepted"] += 1
                continue
            width, height = int(info.get("width", 0)), int(info.get("height", 0))
            image_url = info.get("thumburl") or candidate.get("thumbnail")
            source_page = info.get("descriptionurl") or candidate.get("sourcePage")
            if not image_url or not source_page or max(width, height) < 640 or min(width, height) < 240:
                rejections["missing_thumbnail_or_dimensions"] += 1
                continue
            fields = metadata_text(info)
            if not fields.get("title"):
                fields["title"] = candidate.get("title", "").removeprefix("File:")
            if has_ai_generation_marker(fields):
                rejections["explicit_ai_generation_marker"] += 1
                continue
            scene_class = photo_scene_class(fields)
            if geotagged:
                distance = float(candidate.get("geoDistanceKm", GEOSEARCH_RADIUS_METERS / 1000))
                if distance > GEOSEARCH_RADIUS_METERS / 1000:
                    rejections["outside_site_radius"] += 1
                    continue
                quality_score = photo_quality_score(fields)
                if not scene_class:
                    if explicitly_off_topic_scene(fields) or quality_score is None:
                        rejections["not_scenic_or_destination_scene"] += 1
                        continue
                    # Local geotags already tie the image to a real dive site.
                    # Sparse captions should not hide a usable view, but clear
                    # off-topic subjects remain excluded and beauty still gates it.
                    scene_class = "site-geotagged-visual-candidate"
                score = max(0, 100 - round(distance * 15))
                match_evidence = (
                    f"Commons geotag is {distance:.2f} km from {candidate.get('matchingDiveSite')}, "
                    "a named dive site listed within this area; sparse scenic description is allowed "
                    "because the geotag supplies the place match."
                )
                match_type = "site-within-area"
            else:
                site_evidence = site_name_search_evidence(candidate, parent_label)
                openverse_evidence = openverse_place_evidence(area, candidate)
                if site_evidence:
                    score, _site_name, site_name_in_title = site_evidence
                    if not scene_class:
                        quality_score = photo_quality_score(fields)
                        if (not site_name_in_title or explicitly_off_topic_scene(fields)
                                or quality_score is None or quality_score < MIN_PHOTO_QUALITY_SCORE):
                            rejections["not_scenic_or_destination_scene"] += 1
                            continue
                        scene_class = "site-name-visual-candidate"
                    match_evidence = (
                        f"Commons file title or description names {site_evidence[1]}, "
                        "a dive site listed within this area."
                    )
                    match_type = "site-within-area"
                elif openverse_evidence:
                    score, matched_alias, _alias_in_title = openverse_evidence
                    if not scene_class:
                        quality_score = photo_quality_score(fields)
                        aesthetic_for_sparse = photo_aesthetic_proxy_score(fields, width, height)
                        if (explicitly_off_topic_scene(fields) or quality_score is None
                                or (quality_score < MIN_PHOTO_QUALITY_SCORE
                                    and aesthetic_for_sparse < 30)):
                            rejections["not_scenic_or_destination_scene"] += 1
                            continue
                        scene_class = "openverse-place-name-visual-candidate"
                    match_evidence = (
                        f"Openverse title or source tags name {matched_alias}, "
                        f"a place component of {area.get('label')}."
                    )
                    match_type = "area-specific"
                else:
                    score, exact = search_score(area, candidate, parent_label)
                    if not exact or score < 55:
                        rejections["not_area_name_match"] += 1
                        continue
                    exact_title_match = title_names_area(area.get("label"), candidate.get("title", ""))
                if not scene_class:
                    if not site_evidence and not openverse_evidence:
                        quality_score = photo_quality_score(fields)
                        if (not exact_title_match or explicitly_off_topic_scene(fields)
                                or quality_score is None):
                            rejections["not_scenic_or_destination_scene"] += 1
                            continue
                        scene_class = "area-name-visual-candidate"
                if not site_evidence and not openverse_evidence:
                    match_evidence = (
                        "Exact area name occurs in the Commons file title; this supplies place evidence "
                        "even when scene wording is sparse."
                        if exact_title_match else
                        "Area name occurs in the Commons file description; scenic context supports the match."
                    )
                    match_type = "area-specific"
            license_name, license_url = license_data
            if not geotagged:
                quality_score = photo_quality_score(fields)
            min_quality = (
                0 if scene_class in {"site-geotagged-visual-candidate", "area-name-visual-candidate",
                                     "openverse-place-name-visual-candidate"}
                else 6 if geotagged else MIN_PHOTO_QUALITY_SCORE
            )
            if quality_score is None:
                rejections["non_photo_or_excluded_subject"] += 1
                continue
            if quality_score < min_quality:
                rejections["weak_scenic_metadata"] += 1
                continue
            aesthetic_score = photo_aesthetic_proxy_score(fields, width, height)
            if aesthetic_score < MIN_AESTHETIC_PROXY_SCORE:
                rejections["weak_aesthetic_proxy"] += 1
                continue
            creator = fields.get("creator") or fields.get("attribution") or ""
            if not creator and not license_name.casefold().startswith("cc0") and "public domain" not in license_name.casefold():
                rejections["missing_creator_attribution"] += 1
                continue
            creator = creator or "Unknown author (public-domain file)"
            photo_title = fields.get("title") or candidate.get("title", "").removeprefix("File:")
            photo_description = fields.get("description", "")
            src_label = plain(str(area.get("label", "")))
            # Favor human-curated visual quality, then place accuracy. A water
            # scene gets a modest tie-break bonus because it fits dive-area pages;
            # a stronger local landscape can still outrank a weaker reef photo.
            scene_bonus = {
                "underwater-or-marine-life": 24,
                "coastal-or-water-landscape": 12,
            }.get(scene_class, 0)
            rank = aesthetic_score * 6 + score * 1.5 + quality_score * 0.5 + scene_bonus
            ranked_candidates.append((rank, score, quality_score, aesthetic_score, scene_class,
                                      match_type, match_evidence, candidate, info,
                                      image_url, source_page, fields, license_name, license_url, creator, photo_title,
                                      photo_description, src_label))
        ranked_candidates.sort(key=lambda item: (item[0], item[3], item[2], item[1]), reverse=True)
        if ranked_candidates:
            def manifest_entry(item: tuple[Any, ...]) -> dict[str, Any]:
                (_, score, quality_score, aesthetic_score, scene_class, match_type, match_evidence,
                 candidate, info, image_url, source_page, fields,
                 license_name, license_url, creator, photo_title, photo_description, src_label) = item
                width, height = int(info.get("width", 0)), int(info.get("height", 0))
                return {
                    "areaKey": key,
                    "kind": area.get("kind"),
                    "label": area.get("label"),
                    "parentLabel": parent_label or None,
                    "siteCount": len(area.get("site_indices", [])),
                    "matchType": match_type,
                    "matchEvidence": match_evidence,
                    "aiReviewStatus": "no-ai-generation-marker-found-in-source-metadata",
                    "matchScore": score,
                    "photoQualityScore": quality_score,
                    "photoAestheticScore": aesthetic_score,
                    "photoAestheticStatus": "automated-curation-and-image-quality-proxy-unreviewed",
                    "photoSceneClass": scene_class,
                    "contentSha1": info.get("sha1"),
                    "matchingDiveSite": candidate.get("matchingDiveSite") or candidate.get("siteSearchName"),
                    "geoDistanceKm": candidate.get("geoDistanceKm"),
                    "src": image_url,
                    "alt": photo_description or photo_title or f"Photo associated with {src_label}; see the source page for location details.",
                    "photoTitle": photo_title,
                    "photoDescription": photo_description,
                    "creator": creator,
                    "credit": f"{creator} / {info.get('_sourceProvider', 'Wikimedia Commons')}",
                    "sourceProvider": info.get("_sourceProvider", "Wikimedia Commons"),
                    "sourcePage": source_page,
                    "license": license_name,
                    "licenseUrl": license_url,
                    "selectionStatus": (
                        "automated-openverse-candidate-unreviewed"
                        if candidate.get("metadataKey", "").startswith("openverse:")
                        else "automated-geotagged-candidate-unreviewed"
                        if match_type == "site-within-area" and candidate.get("geoDistanceKm") is not None
                        else "automated-site-name-candidate-unreviewed"
                        if match_type == "site-within-area" and candidate.get("siteSearchName")
                        else "automated-candidate-unreviewed"
                    ),
                    "photoOriginArea": area.get("label"),
                    **({
                        "openverseMatchAlias": candidate.get("openverseMatchAlias"),
                        "openverseLocationText": candidate.get("openverseLocationText"),
                    } if candidate.get("metadataKey", "").startswith("openverse:") else {}),
                    "assetNote": f"{info.get('_sourceProvider', 'Wikimedia Commons')} "
                                 f"{width}×{height} source; displayed thumbnail URL.",
                }

            options = [manifest_entry(item) for item in ranked_candidates]
            selected[key] = options[0]
            if len(options) > 1:
                # Deduplication can take the next-ranked qualifying image instead
                # of leaving an area blank because its first choice is reused.
                selected[key]["_rankedAlternates"] = options[1:]
    return selected


def unique_source_photos(areas: list[dict[str, Any]],
                        selected: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Assign distinct source files, falling back to each area's next-ranked candidate."""
    area_by_key = {area["key"]: area for area in areas}
    ranked = sorted(selected.items(), key=lambda item: (
        item[1].get("selectionStatus") != "editorially-reviewed-pilot",
        -int(item[1].get("photoAestheticScore") or 0),
        -int(item[1].get("photoQualityScore") or 0),
        -int(item[1].get("matchScore") or 0),
        -len(area_by_key.get(item[0], {}).get("site_indices", [])),
        item[0],
    ))
    unique: dict[str, dict[str, Any]] = {}
    used_sources: set[str] = set()
    for key, primary in ranked:
        options = [primary, *primary.get("_rankedAlternates", [])]
        for photo in options:
            source = photo.get("sourcePage")
            content_hash = photo.get("contentSha1")
            unique_key = f"sha1:{content_hash}" if isinstance(content_hash, str) and content_hash else source
            if not isinstance(unique_key, str) or not unique_key or unique_key in used_sources:
                continue
            used_sources.add(unique_key)
            assigned = dict(photo)
            assigned.pop("_rankedAlternates", None)
            unique[key] = assigned
            break
    return unique


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Ignore cached Commons search results and start over")
    parser.add_argument("--geo-anchors", type=int, default=2,
                        help="Geotag search locations per area, spread across its dive sites (default: 2)")
    parser.add_argument("--no-geotagged", action="store_true",
                        help="Use title search only; skip the nearby dive-site photo search")
    parser.add_argument("--expand-existing", action="store_true",
                        help="Preserve current assignments and search only areas still without photos")
    parser.add_argument("--broad-title-search", action="store_true",
                        help="Search unmatched area names without a parent qualifier for extra Commons recall")
    parser.add_argument("--site-name-search", action="store_true",
                        help="Search for names of dive sites listed in unmatched areas")
    parser.add_argument("--site-name-anchors", type=int, default=5,
                        help="Spatially spread dive-site names to search per unmatched area (default: 5)")
    parser.add_argument("--openverse-search", action="store_true",
                        help="Search large openly licensed Openverse photos for unmatched area names")
    parser.add_argument("--openverse-pages", type=int, default=2, metavar="N",
                        help="Search up to N Openverse result pages per query (1-5, default: 2)")
    args = parser.parse_args()
    if args.geo_anchors < 1 or args.geo_anchors > 10:
        parser.error("--geo-anchors must be from 1 to 10")
    if args.site_name_anchors < 1 or args.site_name_anchors > 10:
        parser.error("--site-name-anchors must be from 1 to 10")
    if args.openverse_pages < 1 or args.openverse_pages > 5:
        parser.error("--openverse-pages must be from 1 to 5")
    area_payload = read_json(AREA_INDEX, None)
    if not area_payload or area_payload.get("schema") != "dive-site-region-index-v1":
        print(f"Generate the area index first: {AREA_INDEX}", file=sys.stderr)
        return 2
    areas = area_payload.get("areas", [])
    by_key = {area["key"]: area for area in areas if isinstance(area.get("key"), str)}
    if len(by_key) != len(areas):
        raise RuntimeError("The area index has missing or duplicate keys")
    previous_payload = read_json(OUTPUT, {}) if args.expand_existing else {}
    existing_photos = {
        entry["areaKey"]: entry
        for entry in previous_payload.get("entries", [])
        if isinstance(entry, dict) and entry.get("areaKey") in by_key and entry.get("src")
    }
    if args.expand_existing:
        print(f"Preserving {len(existing_photos):,} existing photo assignments; "
              f"searching {len(areas) - len(existing_photos):,} unmatched areas", flush=True)

    cache = {} if args.refresh else read_json(CACHE, {})
    searches: dict[str, list[dict[str, Any]]] = {}
    pending = []
    for area in areas:
        key = area["key"]
        if args.expand_existing and key in existing_photos:
            searches[key] = []
            continue
        query, _ = query_for(area, by_key)
        cache_key = f"{area['key']}::{query}::limit{SEARCH_LIMIT}"
        if cache_key in cache:
            searches[key] = cache[cache_key]
        else:
            pending.append((area, query, cache_key))
    print(f"Commons search: resuming {len(searches):,} cached areas; {len(pending):,} remain",
          flush=True)
    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as pool:
        # Keep the queue bounded so progress and checkpoints remain responsive
        # while still allowing two simultaneous read requests.
        for batch_start in range(0, len(pending), 40):
            batch = pending[batch_start:batch_start + 40]
            futures = {pool.submit(candidate_search, area, query): (area, cache_key)
                       for area, query, cache_key in batch}
            for future in concurrent.futures.as_completed(futures):
                area, cache_key = futures[future]
                cache[cache_key] = future.result()
                searches[area["key"]] = cache[cache_key]
                completed += 1
                if completed % 20 == 0:
                    write_json(CACHE, cache)
                total_done = len(areas) - len(pending) + completed
                if total_done % 10 == 0 or total_done == len(areas):
                    print(f"Commons search: {total_done:,}/{len(areas):,} areas; {sum(bool(v) for v in searches.values()):,} have image candidates",
                          flush=True)
    write_json(CACHE, cache)

    if args.broad_title_search:
        broad_searches: dict[str, list[dict[str, Any]]] = {}
        broad_pending = []
        for area in areas:
            if args.expand_existing and area["key"] in existing_photos:
                continue
            label = str(area.get("label", "")).replace('"', " ").strip()
            query = f'filetype:bitmap "{label}"'
            cache_key = f"broad-title::{area['key']}::{query}::limit{SEARCH_LIMIT}"
            if cache_key in cache:
                broad_searches[area["key"]] = cache[cache_key]
            else:
                broad_pending.append((area, query, cache_key))
        print(f"Commons broad title search: resuming {len(broad_searches):,} cached areas; "
              f"{len(broad_pending):,} remain", flush=True)
        completed = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as pool:
            for batch_start in range(0, len(broad_pending), 40):
                batch = broad_pending[batch_start:batch_start + 40]
                futures = {pool.submit(candidate_search, area, query): (area, cache_key)
                           for area, query, cache_key in batch}
                for future in concurrent.futures.as_completed(futures):
                    area, cache_key = futures[future]
                    cache[cache_key] = future.result()
                    broad_searches[area["key"]] = cache[cache_key]
                    completed += 1
                    if completed % 20 == 0:
                        write_json(CACHE, cache)
                    if completed % 20 == 0 or completed == len(broad_pending):
                        print(f"Commons broad title search: {completed:,}/{len(broad_pending):,} areas; "
                              f"{sum(bool(v) for v in broad_searches.values()):,} have image candidates",
                              flush=True)
        write_json(CACHE, cache)
        for key, candidates in broad_searches.items():
            known_titles = {item.get("title") for item in searches.get(key, [])}
            searches.setdefault(key, []).extend(
                item for item in candidates if item.get("title") not in known_titles
            )

    rows_by_id = load_site_rows() if (args.site_name_search or not args.no_geotagged) else {}
    site_searches: dict[str, list[dict[str, Any]]] = {area["key"]: [] for area in areas}
    if args.site_name_search:
        site_search_links: dict[str, list[tuple[str, str, str]]] = {}
        site_pending: dict[str, tuple[dict[str, Any], str]] = {}
        for area in areas:
            if args.expand_existing and area["key"] in existing_photos:
                continue
            anchors = area_site_anchors(area, area_payload, rows_by_id, args.site_name_anchors)
            for anchor in anchors:
                site_name = str(anchor.get("siteName", "")).strip()
                if not site_name:
                    continue
                quoted_name = site_name.replace('"', " ")
                queries = [
                    (f'filetype:bitmap "{quoted_name}"', "base"),
                    *(
                        (f'filetype:bitmap "{quoted_name}" {term}', term)
                        for term in SITE_SEARCH_TERMS
                    ),
                ]
                for query, qualifier in queries:
                    cache_key = (
                        f"site-name::{normalized(site_name)}::{qualifier}::limit{SEARCH_LIMIT}"
                    )
                    site_search_links.setdefault(area["key"], []).append(
                        (cache_key, site_name, str(anchor.get("siteId", "")))
                    )
                    if cache_key not in cache:
                        site_pending.setdefault(cache_key, (area, query))
        unique_site_queries = {cache_key for links in site_search_links.values()
                               for cache_key, _site_name, _site_id in links}
        cached_site_queries = sum(cache_key in cache for cache_key in unique_site_queries)
        print(f"Commons dive-site-name search: resuming "
              f"{cached_site_queries:,}/{len(unique_site_queries):,} cached unique queries; "
              f"{len(site_pending):,} unique queries remain", flush=True)
        completed = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as pool:
            pending_items = list(site_pending.items())
            for batch_start in range(0, len(pending_items), 40):
                batch = pending_items[batch_start:batch_start + 40]
                futures = {
                    pool.submit(candidate_search, area, query): (cache_key, area)
                    for cache_key, (area, query) in batch
                }
                for future in concurrent.futures.as_completed(futures):
                    cache_key, _area = futures[future]
                    cache[cache_key] = future.result()
                    completed += 1
                    if completed % 20 == 0:
                        write_json(CACHE, cache)
                    if completed % 20 == 0 or completed == len(site_pending):
                        print(f"Commons dive-site-name search: "
                              f"{completed:,}/{len(site_pending):,} unique queries; "
                              f"{sum(bool(cache[key]) for key in site_pending if key in cache):,} "
                              "completed queries have image candidates",
                              flush=True)
        write_json(CACHE, cache)
        for area_key, links in site_search_links.items():
            seen_candidates: set[tuple[str, str]] = set()
            for cache_key, site_name, site_id in links:
                for candidate in cache.get(cache_key, []):
                    identity = (str(candidate.get("title", "")), site_name)
                    if identity in seen_candidates:
                        continue
                    seen_candidates.add(identity)
                    site_searches[area_key].append({
                        **candidate,
                        "siteSearchName": site_name,
                        "siteSearchSiteId": site_id,
                    })

    openverse_searches: dict[str, list[dict[str, Any]]] = {area["key"]: [] for area in areas}
    openverse_metadata: dict[str, dict[str, Any]] = {}
    if args.openverse_search:
        openverse_cache = read_json(OPENVERSE_CACHE, {})
        openverse_links: dict[str, list[tuple[str, str]]] = {}
        openverse_pending: dict[str, tuple[str, dict[str, Any]]] = {}
        for area in areas:
            if args.expand_existing and area["key"] in existing_photos:
                continue
            for alias in openverse_search_aliases(area):
                cache_key = f"place::{normalized(alias)}::cc-large-v1"
                openverse_links.setdefault(area["key"], []).append((cache_key, alias))
                if cache_key not in openverse_cache:
                    openverse_pending.setdefault(cache_key, (alias, area))
        unique_openverse_queries = {cache_key for links in openverse_links.values()
                                    for cache_key, _alias in links}
        cached_openverse_queries = sum(key in openverse_cache for key in unique_openverse_queries)
        print(f"Openverse place search: resuming "
              f"{cached_openverse_queries:,}/{len(unique_openverse_queries):,} cached queries; "
              f"{len(openverse_pending):,} remain", flush=True)
        completed = 0
        failed_openverse_queries = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            pending_items = list(openverse_pending.items())
            for batch_start in range(0, len(pending_items), 40):
                batch = pending_items[batch_start:batch_start + 40]
                futures = {
                    pool.submit(openverse_candidate_search, alias): cache_key
                    for cache_key, (alias, _area) in batch
                }
                for future in concurrent.futures.as_completed(futures):
                    cache_key = futures[future]
                    try:
                        results = future.result()
                    except Exception:
                        results = None
                    if results is None:
                        failed_openverse_queries += 1
                    else:
                        openverse_cache[cache_key] = results
                    completed += 1
                    if completed % 20 == 0:
                        write_json(OPENVERSE_CACHE, openverse_cache)
                    if completed % 20 == 0 or completed == len(openverse_pending):
                        found = sum(bool(openverse_cache[key]) for key in openverse_pending
                                    if key in openverse_cache)
                        print(f"Openverse place search: {completed:,}/{len(openverse_pending):,} "
                              f"queries; {found:,} completed queries have image candidates; "
                              f"{failed_openverse_queries:,} failed and remain retryable",
                              flush=True)
        write_json(OPENVERSE_CACHE, openverse_cache)

        for page_number in range(2, args.openverse_pages + 1):
            page_pending: dict[str, tuple[str, str]] = {}
            previous_page = page_number - 1
            for area_key, links in openverse_links.items():
                for first_page_key, alias in list(links):
                    if previous_page == 1:
                        prior_key = first_page_key
                    else:
                        prior_key = (f"place::{normalized(alias)}::page"
                                     f"{previous_page}::cc-large-v1")
                    if len(openverse_cache.get(prior_key, [])) != OPENVERSE_PAGE_SIZE:
                        continue
                    page_key = (f"place::{normalized(alias)}::page"
                                f"{page_number}::cc-large-v1")
                    if (page_key, alias) not in links:
                        links.append((page_key, alias))
                    if page_key not in openverse_cache:
                        page_pending.setdefault(page_key, (alias, by_key[area_key]))
            if page_pending:
                print(f"Openverse place search: fetching page {page_number} for "
                      f"{len(page_pending):,} full previous-page queries", flush=True)
            completed = 0
            failed_page_queries = 0
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                pending_items = list(page_pending.items())
                for batch_start in range(0, len(pending_items), 40):
                    batch = pending_items[batch_start:batch_start + 40]
                    futures = {
                        pool.submit(openverse_candidate_search, alias, page_number): cache_key
                        for cache_key, (alias, _area) in batch
                    }
                    for future in concurrent.futures.as_completed(futures):
                        cache_key = futures[future]
                        try:
                            results = future.result()
                        except Exception:
                            results = None
                        if results is None:
                            failed_page_queries += 1
                        else:
                            openverse_cache[cache_key] = results
                        completed += 1
                        if completed % 20 == 0:
                            write_json(OPENVERSE_CACHE, openverse_cache)
                        if completed % 20 == 0 or completed == len(page_pending):
                            print(f"Openverse page {page_number} search: "
                                  f"{completed:,}/{len(page_pending):,}; "
                                  f"{failed_page_queries:,} failed and remain retryable",
                                  flush=True)
            write_json(OPENVERSE_CACHE, openverse_cache)
        for area_key, links in openverse_links.items():
            seen_openverse: set[tuple[str, str]] = set()
            for cache_key, alias in links:
                for item in openverse_cache.get(cache_key, []):
                    records = openverse_records(item)
                    if records is None:
                        continue
                    candidate, info = records
                    identity = (candidate["openverseId"], alias)
                    if identity in seen_openverse:
                        continue
                    seen_openverse.add(identity)
                    candidate["openverseMatchAlias"] = alias
                    openverse_searches[area_key].append(candidate)
                    openverse_metadata[candidate["metadataKey"]] = info
        commons_openverse_keys = {
            candidate["metadataKey"]: candidate["commonsPageId"]
            for candidates in openverse_searches.values()
            for candidate in candidates
            if candidate.get("commonsPageId")
        }
        if commons_openverse_keys:
            print(f"Resolving Commons hashes for {len(commons_openverse_keys):,} "
                  "Openverse-indexed files", flush=True)
            hashes = commons_sha1_by_pageids(list(commons_openverse_keys.values()))
            for metadata_key, page_id in commons_openverse_keys.items():
                if page_id in hashes:
                    openverse_metadata[metadata_key]["sha1"] = hashes[page_id]

    geo_searches: dict[str, list[dict[str, Any]]] = {area["key"]: [] for area in areas}
    geo_area_hits = 0
    if not args.no_geotagged:
        pilots = pilot_entries()
        geo_cache = {} if args.refresh else read_json(GEO_CACHE, {})
        anchors_by_area: dict[str, list[dict[str, Any]]] = {}
        pending_geo: dict[str, dict[str, Any]] = {}
        for area in areas:
            if area["key"] in pilots or area["key"] in existing_photos:
                continue
            anchors = area_site_anchors(area, area_payload, rows_by_id, args.geo_anchors)
            anchors_by_area[area["key"]] = anchors
            for anchor in anchors:
                cache_key = f"{anchor['lat']:.5f}|{anchor['lon']:.5f}"
                if cache_key not in geo_cache:
                    pending_geo.setdefault(cache_key, anchor)
        print(f"Commons geotag search: resuming {len(geo_cache):,} cached site coordinates; "
              f"{len(pending_geo):,} new coordinates across {len(anchors_by_area):,} areas",
              flush=True)
        completed = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as pool:
            for batch_start in range(0, len(pending_geo), 40):
                batch = list(pending_geo.items())[batch_start:batch_start + 40]
                futures = {pool.submit(geotagged_candidate_search, anchor): (cache_key, anchor)
                           for cache_key, anchor in batch}
                for future in concurrent.futures.as_completed(futures):
                    cache_key, _anchor = futures[future]
                    geo_cache[cache_key] = future.result()
                    completed += 1
                    if completed % 20 == 0:
                        write_json(GEO_CACHE, geo_cache)
                    if completed % 20 == 0 or completed == len(pending_geo):
                        print(f"Commons geotag search: {len(geo_cache):,} cached coordinates; "
                              f"{sum(bool(items) for items in geo_cache.values()):,} have nearby photo candidates",
                              flush=True)
        write_json(GEO_CACHE, geo_cache)
        for area_key, anchors in anchors_by_area.items():
            by_source: dict[str, dict[str, Any]] = {}
            for anchor in anchors:
                cache_key = f"{anchor['lat']:.5f}|{anchor['lon']:.5f}"
                for cached in geo_cache.get(cache_key, []):
                    candidate = dict(cached)
                    coords = candidate.get("geoCoordinates") or []
                    if len(coords) != 2:
                        continue
                    candidate["matchingDiveSite"] = anchor["siteName"]
                    candidate["matchingSiteId"] = anchor["siteId"]
                    candidate["geoDistanceKm"] = round(distance_km(
                        anchor["lat"], anchor["lon"], float(coords[0]), float(coords[1])), 2)
                    source = candidate.get("sourcePage") or candidate.get("title")
                    previous = by_source.get(source)
                    if previous is None or candidate["geoDistanceKm"] < previous["geoDistanceKm"]:
                        by_source[source] = candidate
            geo_searches[area_key] = list(by_source.values())
        geo_area_hits = sum(bool(items) for items in geo_searches.values())
        print(f"Commons geotag candidates: {geo_area_hits:,}/{len(areas):,} areas",
              flush=True)

    candidate_titles = []
    for area in areas:
        _, parent_label = query_for(area, by_key)
        ranked = sorted(searches.get(area["key"], []),
                        key=lambda item: search_score(area, item, parent_label)[0], reverse=True)
        candidate_titles.extend(item["title"] for item in ranked[:SEARCH_LIMIT])
        candidate_titles.extend(item["title"] for item in site_searches.get(area["key"], []))
        geo_ranked = sorted(geo_searches.get(area["key"], []),
                            key=lambda item: (float(item.get("geoDistanceKm", 999)),
                                              -(int(item.get("width", 0)) * int(item.get("height", 0)))))
        candidate_titles.extend(item["title"] for item in geo_ranked[:GEOSEARCH_LIMIT * args.geo_anchors])
    candidate_titles.extend(source_page_file_title(entry) for entry in existing_photos.values())
    candidate_titles = [title for title in candidate_titles if title]
    candidate_titles = list(dict.fromkeys(candidate_titles))
    print(f"Fetching attribution for {len(candidate_titles):,} candidate files", flush=True)
    metadata = metadata_for(candidate_titles)
    categories = category_metadata_for(candidate_titles)
    for title, info in metadata.items():
        if title in categories:
            info["categories"] = categories[title]
    metadata.update(openverse_metadata)

    pilots = pilot_entries()
    candidate_rejections: Counter[str] = Counter()
    if existing_photos:
        before_revalidation = len(existing_photos)
        existing_photos = revalidate_existing_photos(existing_photos, metadata, candidate_rejections)
        print(f"Revalidated existing photos: kept {len(existing_photos):,}/{before_revalidation:,}", flush=True)
    direct = choose_direct_entries(areas, searches, site_searches, openverse_searches, geo_searches,
                                   by_key, metadata, pilots,
                                   candidate_rejections)
    direct.update(existing_photos)
    unique_photos = unique_source_photos(areas, direct)
    entries = [unique_photos[area["key"]] for area in areas if area["key"] in unique_photos]
    match_counts: dict[str, int] = {}
    selection_status_counts: dict[str, int] = {}
    ai_review_status_counts: dict[str, int] = {}
    aesthetic_status_counts: dict[str, int] = {}
    for entry in entries:
        match_counts[entry["matchType"]] = match_counts.get(entry["matchType"], 0) + 1
        selection_status = entry.get("selectionStatus", "unknown")
        selection_status_counts[selection_status] = selection_status_counts.get(selection_status, 0) + 1
        ai_status = entry.get("aiReviewStatus", "unknown")
        ai_review_status_counts[ai_status] = ai_review_status_counts.get(ai_status, 0) + 1
        aesthetic_status = entry.get("photoAestheticStatus", "unknown")
        aesthetic_status_counts[aesthetic_status] = aesthetic_status_counts.get(aesthetic_status, 0) + 1
    payload = {
        "schema": "dive-site-area-photo-manifest-v1",
        "status": "partial-unique-area-photo-coverage",
        "retrievedOn": date.today().isoformat(),
        "areaIndexSchema": area_payload.get("schema"),
        "areaCount": len(areas),
        "assignmentCount": len(entries),
        "searchProvider": "Wikimedia Commons and Openverse" if args.openverse_search else "Wikimedia Commons",
        "searchMode": "expand-existing" if args.expand_existing else "full-refresh",
        "geotagSearchedAreaCount": len(anchors_by_area) if not args.no_geotagged else 0,
        "searchPolicy": "Rate-limited Commons title search plus geotag and dive-site-name searches for named dive sites within each area; optional Openverse searches query large photos under accepted open licenses. A photo can show underwater life, coastline, wildlife, or a scenic land or cityscape. A geotag within 10 km of a named dive site, an exact area-name phrase, a named dive-site phrase, or an Openverse title/source tag matching a named area component can establish place even when scene wording is sparse; generic or homonymous place names require a second local phrase. Clear off-topic subjects remain excluded. Description-only matches still need scenic or destination context. Candidates must pass minimum-dimension, aesthetic-proxy, accepted-license, attribution, and explicit AI-generation-marker checks. Underwater and coastal scenes receive a ranking preference. Each image content hash or source page is assigned at most once.",
        "selectionNote": "Unmatched areas have no photo. Geotagged files within 10 km of a named dive site, exact area or dive-site title phrases, and Openverse results whose title or human-applied source tags name a place component can qualify despite sparse scene descriptions. Generic and homonymous names need additional local context. Description-only matches still need scenic context. Visual beauty and exact subject relevance need human review. The aesthetic score favors Commons-curated image categories, high resolution, and strong landscape framing; it is a shortlist signal, not a guarantee of beauty. Automated picks remain unreviewed until a person inspects each image. Absence of an AI-generation marker is not proof a file was human-made.",
        "matchedAreaCount": len(entries),
        "coveragePercent": round(len(entries) * 100 / len(areas), 1) if areas else 0,
        "uniqueSourcePhotoCount": len({entry.get("sourcePage") for entry in entries if entry.get("sourcePage")}),
        "areasWithGeotagCandidates": geo_area_hits,
        "preDedupSelectedAreaCount": len(direct),
        "duplicateImageAssignmentsRemoved": len(direct) - len(unique_photos),
        "matchCounts": match_counts,
        "selectionStatusCounts": selection_status_counts,
        "aiReviewStatusCounts": ai_review_status_counts,
        "aestheticStatusCounts": aesthetic_status_counts,
        "candidateRejectionCounts": dict(candidate_rejections),
        "entries": entries,
    }
    write_json(OUTPUT, payload)
    print(f"Wrote {len(entries):,}/{len(areas):,} areas with distinct source photos ({payload['coveragePercent']}%); unmatched areas have no photo.", flush=True)
    print("Assignment types: " + ", ".join(f"{key}={value:,}" for key, value in match_counts.items()), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
