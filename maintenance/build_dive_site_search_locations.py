#!/usr/bin/env python3
"""Build a provenance-aware location sidecar for dive-site search.

The canonical site rows do not have separate ocean, province, and common-area
columns. This generator derives those search fields from Natural Earth marine
and admin-1 polygons, while keeping existing aliases and locality labels tied
to their original fields. Polygon-derived labels are only assigned when a
site point falls inside a source polygon; no nearest-area guessing is used.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import math
import os
import re
import struct
import urllib.request
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SITE_DATA_PATH = ROOT / "datasets" / "dive-sites.js"
OUTPUT_PATH = ROOT / "datasets" / "dive-site-search-locations.json.gz"
MARINE_URL = "https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_geography_marine_polys.zip"
ADMIN1_URL = "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip"

MARINE_CLASSES = {
    "bay", "channel", "fjord", "gulf", "inlet", "lagoon", "ocean",
    "sea", "sound", "strait",
}


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(character for character in text if not unicodedata.combining(character))
    return re.sub(r"[^\w]+", " ", text.casefold(), flags=re.UNICODE).strip()


def split_labels(value: Any) -> list[str]:
    labels = []
    for part in str(value or "").split("|"):
        label = " ".join(part.strip().split())
        if label and normalize(label) not in {normalize(existing) for existing in labels}:
            labels.append(label)
    return labels


def read_sites(path: Path) -> list[list[Any]]:
    text = path.read_text(encoding="utf-8")
    match = re.search(r"window\.DIVE_SITES_DATA\s*=\s*(\[.*\])\s*;?\s*$", text, re.S)
    if not match:
        raise ValueError(f"Could not parse site array from {path}")
    sites = json.loads(match.group(1))
    if not isinstance(sites, list) or any(not isinstance(site, list) for site in sites):
        raise ValueError("Dive-site dataset is not an array of row arrays")
    return sites


def download_source(url: str, cache_dir: Path, refresh: bool) -> tuple[bytes, str]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / url.rsplit("/", 1)[-1]
    if refresh or not path.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "DiveAtlas search location builder"})
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = response.read()
        path.write_bytes(payload)
    else:
        payload = path.read_bytes()
    return payload, hashlib.sha256(payload).hexdigest()


def decode_dbf_value(raw: bytes, encoding: str) -> str:
    try:
        return raw.decode(encoding).strip("\x00 \t\r\n")
    except (LookupError, UnicodeDecodeError):
        try:
            return raw.decode("utf-8").strip("\x00 \t\r\n")
        except UnicodeDecodeError:
            return raw.decode("cp1252", errors="replace").strip("\x00 \t\r\n")


def read_dbf(payload: bytes, encoding_hint: str = "utf-8") -> list[dict[str, str]]:
    if len(payload) < 32:
        raise ValueError("Invalid DBF header")
    record_count = struct.unpack_from("<I", payload, 4)[0]
    header_length = struct.unpack_from("<H", payload, 8)[0]
    record_length = struct.unpack_from("<H", payload, 10)[0]
    fields: list[tuple[str, int]] = []
    cursor = 32
    while cursor < header_length and payload[cursor] != 0x0D:
        descriptor = payload[cursor:cursor + 32]
        name = descriptor[:11].split(b"\0", 1)[0].decode("ascii", errors="replace")
        fields.append((name, descriptor[16]))
        cursor += 32

    rows: list[dict[str, str]] = []
    for row_index in range(record_count):
        offset = header_length + row_index * record_length
        if offset + record_length > len(payload):
            raise ValueError("DBF row extends past end of file")
        deleted = payload[offset:offset + 1] == b"*"
        offset += 1
        row: dict[str, str] = {}
        for name, length in fields:
            row[name] = decode_dbf_value(payload[offset:offset + length], encoding_hint)
            offset += length
        if not deleted:
            rows.append(row)
    return rows


def read_polygon_shapes(payload: bytes) -> list[dict[str, Any]]:
    if len(payload) < 100:
        raise ValueError("Invalid shapefile header")
    features: list[dict[str, Any]] = []
    cursor = 100
    while cursor + 8 <= len(payload):
        content_words = struct.unpack_from(">I", payload, cursor + 4)[0]
        content_start = cursor + 8
        content_end = content_start + content_words * 2
        content = payload[content_start:content_end]
        if len(content) < 44:
            cursor = content_end
            continue
        shape_type = struct.unpack_from("<I", content, 0)[0]
        if shape_type not in (5, 15, 25):
            cursor = content_end
            continue

        min_x, min_y, max_x, max_y = struct.unpack_from("<4d", content, 4)
        part_count, point_count = struct.unpack_from("<2I", content, 36)
        part_offset = 44
        parts = list(struct.unpack_from(f"<{part_count}I", content, part_offset)) if part_count else []
        point_offset = part_offset + part_count * 4
        points: list[tuple[float, float]] = []
        for point_index in range(point_count):
            x, y = struct.unpack_from("<2d", content, point_offset + point_index * 16)
            points.append((x, y))
        rings = []
        for part_index, start in enumerate(parts):
            end = parts[part_index + 1] if part_index + 1 < len(parts) else point_count
            if end > start:
                rings.append(points[start:end])
        if rings:
            features.append({
                "bbox": (min_x, min_y, max_x, max_y),
                "rings": rings,
            })
        cursor = content_end
    return features


def geometry_contains(longitude: float, latitude: float, feature: dict[str, Any]) -> bool:
    """Test one already-bbox-filtered polygon; avoid repeating its bbox check."""
    inside = False
    for ring in feature["rings"]:
        if point_in_ring(longitude, latitude, ring):
            inside = not inside
    return inside


def read_natural_earth_zip(payload: bytes, stem: str) -> tuple[list[dict[str, Any]], str]:
    archive = zipfile.ZipFile(io.BytesIO(payload))
    names = archive.namelist()
    dbf_name = next((name for name in names if name.lower().endswith(f"{stem}.dbf")), None)
    shp_name = next((name for name in names if name.lower().endswith(f"{stem}.shp")), None)
    if not dbf_name or not shp_name:
        raise ValueError(f"Archive does not contain {stem}.shp and {stem}.dbf")
    cpg_name = next((name for name in names if name.lower().endswith(f"{stem}.cpg")), None)
    encoding = archive.read(cpg_name).decode("ascii", errors="ignore").strip() if cpg_name else "utf-8"
    attributes = read_dbf(archive.read(dbf_name), encoding or "utf-8")
    shapes = read_polygon_shapes(archive.read(shp_name))
    if len(attributes) != len(shapes):
        raise ValueError(f"Shape/attribute count mismatch for {stem}: {len(shapes)} vs {len(attributes)}")
    return [{**shape, "properties": row} for shape, row in zip(shapes, attributes)] , encoding


def cell_for(longitude: float, latitude: float, cell_size: float) -> tuple[int, int]:
    x = min(int(math.floor((longitude + 180.0) / cell_size)), int(360 / cell_size) - 1)
    y = min(max(int(math.floor((latitude + 90.0) / cell_size)), 0), int(180 / cell_size) - 1)
    return x, y


def make_spatial_index(features: list[dict[str, Any]], cell_size: float = 5.0) -> tuple[dict[tuple[int, int], list[int]], list[int]]:
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    wide_features: list[int] = []
    columns = int(360 / cell_size)
    rows = int(180 / cell_size)
    for feature_index, feature in enumerate(features):
        min_x, min_y, max_x, max_y = feature["bbox"]
        if max_x - min_x > 180:
            wide_features.append(feature_index)
            continue
        low_x, low_y = cell_for(min_x, min_y, cell_size)
        high_x, high_y = cell_for(max_x, max_y, cell_size)
        covered = (high_x - low_x + 1) * (high_y - low_y + 1)
        if covered > (columns * rows) // 4:
            wide_features.append(feature_index)
            continue
        for x in range(low_x, high_x + 1):
            for y in range(low_y, high_y + 1):
                grid[(x, y)].append(feature_index)
    return grid, wide_features


def point_on_segment(x: float, y: float, a: tuple[float, float], b: tuple[float, float]) -> bool:
    cross = (y - a[1]) * (b[0] - a[0]) - (x - a[0]) * (b[1] - a[1])
    if abs(cross) > 1e-10:
        return False
    return min(a[0], b[0]) - 1e-10 <= x <= max(a[0], b[0]) + 1e-10 and min(a[1], b[1]) - 1e-10 <= y <= max(a[1], b[1]) + 1e-10


def point_in_ring(longitude: float, latitude: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    previous = ring[-1]
    for current in ring:
        if point_on_segment(longitude, latitude, previous, current):
            return True
        x1, y1 = previous
        x2, y2 = current
        if (y1 > latitude) != (y2 > latitude):
            crossing_x = (x2 - x1) * (latitude - y1) / (y2 - y1) + x1
            if longitude < crossing_x:
                inside = not inside
        previous = current
    return inside


def point_in_shape(longitude: float, latitude: float, feature: dict[str, Any]) -> bool:
    min_x, min_y, max_x, max_y = feature["bbox"]
    if not (min_x - 1e-9 <= longitude <= max_x + 1e-9 and min_y - 1e-9 <= latitude <= max_y + 1e-9):
        return False
    return sum(point_in_ring(longitude, latitude, ring) for ring in feature["rings"]) % 2 == 1


def properties_for_feature(feature: dict[str, Any], marine: bool) -> dict[str, str]:
    props = feature["properties"]
    if marine:
        return {
            "name": props.get("name_en") or props.get("name") or "",
            "aliases": props.get("namealt") or "",
            "class": props.get("featurecla") or "",
        }
    return {
        "name": props.get("name_en") or props.get("name") or "",
        "aliases": " | ".join(filter(None, [props.get("name_alt", ""), props.get("name_local", "")])),
        "country": props.get("admin") or props.get("geonunit") or "",
    }


def query_features(
    longitude: float,
    latitude: float,
    features: list[dict[str, Any]],
    spatial_index: tuple[dict[tuple[int, int], list[int]], list[int]],
    cell_size: float = 5.0,
) -> list[int]:
    grid, wide_features = spatial_index
    candidates = set(wide_features)
    candidates.update(grid.get(cell_for(longitude, latitude, cell_size), ()))
    matches = []
    for index in candidates:
        feature = features[index]
        min_x, min_y, max_x, max_y = feature["bbox"]
        if min_x - 1e-9 <= longitude <= max_x + 1e-9 and min_y - 1e-9 <= latitude <= max_y + 1e-9:
            if geometry_contains(longitude, latitude, feature):
                matches.append(index)
    return matches


def feature_labels(feature: dict[str, Any], marine: bool) -> list[str]:
    values = properties_for_feature(feature, marine)
    labels = [values["name"]]
    labels.extend(split_labels(values["aliases"]))
    result = []
    seen: set[str] = set()
    for label in labels:
        key = normalize(label)
        if key and key not in seen:
            result.append(label)
            seen.add(key)
    return result


def select_admin1(
    site: list[Any],
    features: list[dict[str, Any]],
    spatial_index: tuple[dict[tuple[int, int], list[int]], list[int]],
    feature_labels_by_index: list[list[str]],
) -> tuple[list[str], str, str]:
    region_names = split_labels(site[10] if len(site) > 10 else "")
    region_keys = {normalize(value) for value in region_names}
    country_key = normalize(site[9] if len(site) > 9 else "")

    coordinate_matches: list[int] = []
    try:
        latitude, longitude = float(site[1]), float(site[2])
        if math.isfinite(latitude) and math.isfinite(longitude):
            coordinate_matches = query_features(longitude, latitude, features, spatial_index)
    except (TypeError, ValueError, IndexError):
        pass

    if coordinate_matches:
        def match_priority(index: int) -> tuple[int, int, int, str]:
            props = features[index]["properties"]
            source_country_key = normalize(props.get("admin") or props.get("geonunit") or "")
            country_match = 0 if country_key and source_country_key == country_key else 1
            region_match = 0 if region_keys.intersection(normalize(label) for label in feature_labels_by_index[index]) else 1
            min_x, min_y, max_x, max_y = features[index]["bbox"]
            bbox_area = max(0.0, max_x - min_x) * max(0.0, max_y - min_y)
            return country_match, region_match, int(bbox_area * 1000), normalize(feature_labels_by_index[index][0])

        selected_index = min(coordinate_matches, key=match_priority)
        labels = feature_labels_by_index[selected_index]
        return labels, "point-in-polygon", features[selected_index]["properties"].get("admin", "")

    region_matches = []
    if region_keys:
        for index, feature in enumerate(features):
            source_country_key = normalize(feature["properties"].get("admin") or feature["properties"].get("geonunit") or "")
            if country_key != source_country_key:
                continue
            if region_keys.intersection(normalize(label) for label in feature_labels_by_index[index]):
                region_matches.append(index)
    if len(region_matches) == 1:
        selected_index = region_matches[0]
        return feature_labels_by_index[selected_index], "exact-region-name", features[selected_index]["properties"].get("admin", "")
    return [], "", ""


def build_locations(sites: list[list[Any]], marine_features: list[dict[str, Any]], admin_features: list[dict[str, Any]], hashes: dict[str, str]) -> dict[str, Any]:
    marine_features = [
        feature for feature in marine_features
        if feature["properties"].get("featurecla", "").casefold() in MARINE_CLASSES
        and (feature["properties"].get("name_en") or feature["properties"].get("name"))
    ]
    marine_labels = [feature_labels(feature, marine=True) for feature in marine_features]
    marine_names = {normalize(label) for labels in marine_labels for label in labels}
    admin_labels = [feature_labels(feature, marine=False) for feature in admin_features]

    marine_index = make_spatial_index(marine_features)
    admin_index = make_spatial_index(admin_features)
    by_site_id: dict[str, dict[str, list[str]]] = {}
    covered_marine = covered_admin1 = 0

    for site in sites:
        site_id = str(site[12] if len(site) > 12 else "").strip()
        if not site_id:
            continue

        marine_matches: list[int] = []
        try:
            latitude, longitude = float(site[1]), float(site[2])
            if math.isfinite(latitude) and math.isfinite(longitude):
                marine_matches = query_features(longitude, latitude, marine_features, marine_index)
        except (TypeError, ValueError, IndexError):
            pass
        ocean_areas = []
        seen_ocean: set[str] = set()
        for feature_index in sorted(marine_matches, key=lambda index: (normalize(marine_features[index]["properties"].get("featurecla", "")), normalize(marine_labels[index][0]))):
            for label in marine_labels[feature_index]:
                key = normalize(label)
                if key not in seen_ocean:
                    ocean_areas.append(label)
                    seen_ocean.add(key)
        if ocean_areas:
            covered_marine += 1

        provinces, admin_method, source_country = select_admin1(site, admin_features, admin_index, admin_labels)
        if provinces:
            covered_admin1 += 1

        country_key = normalize(site[9] if len(site) > 9 else "")
        province_keys = {normalize(label) for label in provinces}
        common_areas = []
        for label in split_labels(site[10] if len(site) > 10 else ""):
            key = normalize(label)
            if key == country_key or key in marine_names or key in province_keys:
                continue
            common_areas.append(label)

        position_names = []
        site_name_key = normalize(site[0] if site else "")
        seen_position: set[str] = set()
        for label in split_labels(site[11] if len(site) > 11 else ""):
            key = normalize(label)
            if key != site_name_key and key not in seen_position:
                position_names.append(label)
                seen_position.add(key)

        by_site_id[site_id] = {
            "oceanArea": ocean_areas,
            "positionName": position_names,
            "stateProvince": provinces,
            "commonArea": common_areas,
            "_provenance": {
                "oceanArea": "Natural Earth 10m marine-area polygon point-in-polygon",
                "positionName": "DiveAtlas dive-site field [11] aliases",
                "stateProvince": f"Natural Earth 10m admin-1 {admin_method}" if admin_method else "",
                "commonArea": "DiveAtlas dive-site field [10] region/locality after excluding exact country, marine-feature, and assigned admin-1 labels",
                "adminCountry": source_country,
            },
        }

    return {
        "_meta": {
            "schema": "dive-site-search-locations-v1",
            "description": "Separate geographic match fields for dive-site search. Missing labels remain empty.",
            "sources": {
                "marine": {
                    "name": "Natural Earth 10m Geography Marine Polygons",
                    "version": "5.1.0",
                    "url": MARINE_URL,
                    "sha256": hashes["marine"],
                    "classes": sorted(MARINE_CLASSES),
                    "method": "Point-in-polygon; only named ocean, sea, gulf, bay, strait, channel, sound, fjord, inlet, and lagoon features are indexed.",
                },
                "admin1": {
                    "name": "Natural Earth 10m Admin 1 States/Provinces",
                    "version": "5.1.1",
                    "url": ADMIN1_URL,
                    "sha256": hashes["admin1"],
                    "method": "Point-in-polygon, or one exact same-country match from the existing region label when the point is offshore.",
                },
                "positionName": "Existing DiveAtlas aliases in site field [11]; retained as supplied.",
                "commonArea": "Existing DiveAtlas region/locality in site field [10]; exact country, marine-feature, and assigned admin-1 duplicates are separated into their own fields.",
            },
            "records": len(by_site_id),
            "coverage": {
                "oceanArea": covered_marine,
                "stateProvince": covered_admin1,
                "positionName": sum(bool(row["positionName"]) for row in by_site_id.values()),
                "commonArea": sum(bool(row["commonArea"]) for row in by_site_id.values()),
            },
        },
        "bySiteId": by_site_id,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=Path(os.environ.get("TEMP", "/tmp")) / "diveatlas-search-geography")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--refresh", action="store_true", help="Redownload Natural Earth archives instead of using the local cache")
    args = parser.parse_args()

    sites = read_sites(SITE_DATA_PATH)
    marine_zip, marine_hash = download_source(MARINE_URL, args.cache_dir, args.refresh)
    admin_zip, admin_hash = download_source(ADMIN1_URL, args.cache_dir, args.refresh)
    marine_features, _ = read_natural_earth_zip(marine_zip, "ne_10m_geography_marine_polys")
    admin_features, _ = read_natural_earth_zip(admin_zip, "ne_10m_admin_1_states_provinces")
    locations = build_locations(sites, marine_features, admin_features, {"marine": marine_hash, "admin1": admin_hash})

    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(locations, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with args.output.open("wb") as raw_file:
        with gzip.GzipFile(fileobj=raw_file, mode="wb", mtime=0, compresslevel=9) as compressed:
            compressed.write(payload)

    meta = locations["_meta"]
    print(json.dumps({"output": str(args.output), "compressedBytes": args.output.stat().st_size, **meta["coverage"], "records": meta["records"]}, indent=2))


if __name__ == "__main__":
    main()
