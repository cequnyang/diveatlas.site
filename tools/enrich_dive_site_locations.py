#!/usr/bin/env python3
"""Fill missing dive-site country and region fields from bundled geography data.

The lookup follows DiveAtlas' local location labels: Natural Earth land polygons
first, then a uniquely assigned Marine Regions EEZ. It never substitutes the
nearest coastline for an offshore coordinate. Finer regions come from the
existing Natural Earth admin-1 and marine-area point-in-polygon sidecar.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SITE_DATA = ROOT / "datasets" / "dive-sites.js"
LOCATION_SIDECAR = ROOT / "datasets" / "dive-site-search-locations.json.gz"
LAND_BOUNDARIES = ROOT / "datasets" / "country-boundaries.geojson.gz"
MARITIME_BOUNDARIES = ROOT / "datasets" / "maritime-zones-v12.geojson.gz"
DEFAULT_REPORT = ROOT / "reports" / "dive-site-location-enrichment.csv"
GRID_DEGREES = 5.0
GRID_COLUMNS = int(360 / GRID_DEGREES)
COUNTRY_NAME_EQUIVALENTS = {
    "czechia": "czechia", "czech republic": "czechia",
    "united states": "united states of america", "united states of america": "united states of america",
    "russian federation": "russia", "russia": "russia",
    "iran": "iran", "iran islamic republic of": "iran",
    "laos": "laos", "lao peoples democratic republic": "laos",
    "ivory coast": "cote d ivoire", "cote d ivoire": "cote d ivoire",
}


def normalized(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text.casefold()).split())


def same_place(left: object, right: object) -> bool:
    left_key, right_key = normalized(left), normalized(right)
    return (left_key == right_key or
            COUNTRY_NAME_EQUIVALENTS.get(left_key, left_key)
            == COUNTRY_NAME_EQUIVALENTS.get(right_key, right_key))


def valid_coordinates(row: list[object]) -> bool:
    return (len(row) > 12 and isinstance(row[1], (int, float))
            and isinstance(row[2], (int, float))
            and math.isfinite(row[1]) and math.isfinite(row[2])
            and -90 <= row[1] <= 90 and -180 <= row[2] <= 180)


def point_in_ring(longitude: float, latitude: float, ring: list[list[float]]) -> bool:
    """Match the browser lookup, including coordinates that fall on a border."""
    if len(ring) < 3:
        return False
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = float(previous[0]), float(previous[1])
        x2, y2 = float(current[0]), float(current[1])
        cross = (latitude - y1) * (x2 - x1) - (longitude - x1) * (y2 - y1)
        if (abs(cross) <= 1e-10
                and min(x1, x2) - 1e-10 <= longitude <= max(x1, x2) + 1e-10
                and min(y1, y2) - 1e-10 <= latitude <= max(y1, y2) + 1e-10):
            return True
        if (y1 > latitude) != (y2 > latitude):
            crossing_x = (x2 - x1) * (latitude - y1) / (y2 - y1) + x1
            if longitude < crossing_x:
                inside = not inside
        previous = current
    return inside


def cell_for(longitude: float, latitude: float) -> tuple[int, int]:
    x = min(int(math.floor((longitude + 180.0) / GRID_DEGREES)), GRID_COLUMNS - 1)
    y = min(max(int(math.floor((latitude + 90.0) / GRID_DEGREES)), 0), 35)
    return x, y


def polygon_rings(geometry: dict[str, Any]) -> list[list[list[float]]]:
    if geometry.get("type") == "Polygon":
        return [geometry.get("coordinates", [[]])[0]] if geometry.get("coordinates") else []
    if geometry.get("type") == "MultiPolygon":
        return [polygon[0] for polygon in geometry.get("coordinates", []) if polygon]
    return []


class PolygonIndex:
    """Grid-index polygon shells so the 10k+ record pass tests few vertices."""

    def __init__(self, features: list[dict[str, Any]]):
        self.features = features
        self.parts: list[tuple[int, list[list[float]], tuple[float, float, float, float]]] = []
        self.grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        self.wide: list[int] = []
        for feature_index, feature in enumerate(features):
            for ring in polygon_rings(feature.get("geometry") or {}):
                if len(ring) < 3:
                    continue
                xs = [float(point[0]) for point in ring]
                ys = [float(point[1]) for point in ring]
                bbox = min(xs), min(ys), max(xs), max(ys)
                part_index = len(self.parts)
                self.parts.append((feature_index, ring, bbox))
                min_x, min_y, max_x, max_y = bbox
                if max_x - min_x > 180:
                    self.wide.append(part_index)
                    continue
                low_x, low_y = cell_for(min_x, min_y)
                high_x, high_y = cell_for(max_x, max_y)
                covered = (high_x - low_x + 1) * (high_y - low_y + 1)
                if covered > (GRID_COLUMNS * 36) // 4:
                    self.wide.append(part_index)
                    continue
                for x in range(low_x, high_x + 1):
                    for y in range(low_y, high_y + 1):
                        self.grid[(x, y)].append(part_index)

    def matching_features(self, longitude: float, latitude: float) -> list[dict[str, Any]]:
        longitude = ((longitude + 180) % 360) - 180
        candidates = set(self.wide)
        candidates.update(self.grid.get(cell_for(longitude, latitude), ()))
        matches: dict[int, dict[str, Any]] = {}
        for part_index in candidates:
            feature_index, ring, bbox = self.parts[part_index]
            min_x, min_y, max_x, max_y = bbox
            if (min_x - 1e-9 <= longitude <= max_x + 1e-9
                    and min_y - 1e-9 <= latitude <= max_y + 1e-9
                    and point_in_ring(longitude, latitude, ring)):
                matches[feature_index] = self.features[feature_index]
        return [matches[index] for index in sorted(matches)]


class CountryLookup:
    def __init__(self, land: list[dict[str, Any]], maritime: dict[str, Any]):
        self.land = PolygonIndex(land)
        self.zones = PolygonIndex(maritime.get("features", []))
        self.countries = maritime.get("countries", {})

    def resolve(self, latitude: float, longitude: float) -> tuple[str, str]:
        longitude = ((longitude + 180) % 360) - 180
        land_matches = self.land.matching_features(longitude, latitude)
        if land_matches:
            names = {str((feature.get("properties") or {}).get("name") or "").strip()
                     for feature in land_matches}
            names.discard("")
            if len(names) == 1:
                return next(iter(names)), "Natural Earth land polygon"
            return "", "ambiguous land boundary"

        zones = self.zones.matching_features(longitude, latitude)
        properties = [feature.get("properties") or {} for feature in zones]
        if any(item.get("kind") == "Overlapping claim" for item in properties):
            return "", "overlapping maritime claim"
        if any(item.get("kind") == "Joint regime" for item in properties):
            return "", "joint maritime regime"
        sovereigns = {
            str(iso)
            for item in properties if item.get("kind") == "200NM"
            for iso in item.get("sovereignIsos", []) if iso
        }
        if len(sovereigns) != 1:
            return "", "outside a unique national EEZ" if not sovereigns else "multiple EEZ sovereigns"
        country = self.countries.get(next(iter(sovereigns)), {})
        name = str(country.get("name") or "").strip()
        if name:
            return name, "Marine Regions unique EEZ"
        sovereign_names = {
            str(value).strip()
            for item in properties if item.get("kind") == "200NM"
            for value in item.get("sovereigns", []) if str(value).strip()
        }
        if len(sovereign_names) == 1:
            return next(iter(sovereign_names)), "Marine Regions unique EEZ sovereign name"
        return "", "EEZ country name unavailable"


def read_rows(path: Path) -> tuple[str, list[list[object]], int, int]:
    source = path.read_text(encoding="utf-8-sig")
    assignment = source.find("=")
    if assignment < 0:
        raise ValueError(f"Could not find dataset assignment in {path}")
    start = assignment + 1
    rows, consumed = json.JSONDecoder().raw_decode(source[start:])
    if not isinstance(rows, list):
        raise ValueError("Dive-site data must be an array")
    return source, rows, start, consumed


def read_location_inputs(sidecar_path: Path, land_path: Path, maritime_path: Path) -> tuple[dict[str, Any], CountryLookup]:
    with gzip.open(sidecar_path, "rt", encoding="utf-8") as source:
        sidecar = json.load(source).get("bySiteId", {})
    with gzip.open(land_path, "rt", encoding="utf-8") as source:
        land = json.load(source).get("features", [])
    with gzip.open(maritime_path, "rt", encoding="utf-8") as source:
        maritime = json.load(source)
    return sidecar, CountryLookup(land, maritime)


def choose_region(row: list[object], location: dict[str, Any], country_name: str = "") -> tuple[str, str]:
    country_names = [row[9] if len(row) > 9 else "", country_name]
    province_values = location.get("stateProvince") or []
    province_provenance = str(location.get("_provenance", {}).get("stateProvince") or "")
    if "point-in-polygon" in province_provenance:
        # The sidecar stores a selected polygon's primary name followed by its
        # aliases, not multiple competing polygon matches.
        provinces = [str(value).strip() for value in province_values if str(value).strip()
                     and not any(same_place(value, country) for country in country_names if country)]
        if provinces:
            province = provinces[0]
            return province, "Natural Earth admin-1 point-in-polygon"
    return "", "no admin-1 polygon match"


def marine_area_context(location: dict[str, Any]) -> str:
    """Retain useful sea names in the audit without treating them as local regions."""
    values = []
    seen = set()
    for value in location.get("oceanArea") or []:
        label = str(value or "").strip()
        key = normalized(label)
        if key and key not in seen:
            values.append(label)
            seen.add(key)
    return " | ".join(values)


def audit_rows(rows: list[list[object]], sidecar: dict[str, Any], lookup: CountryLookup) -> list[dict[str, Any]]:
    results = []
    for index, row in enumerate(rows):
        if len(row) <= 12 or (str(row[9] or "").strip() and str(row[10] or "").strip()):
            continue
        site_id = str(row[12] or "").strip()
        location = sidecar.get(site_id, {})
        country_before = str(row[9] or "").strip() if len(row) > 9 else ""
        region_before = str(row[10] or "").strip() if len(row) > 10 else ""
        admin_country = str(location.get("_provenance", {}).get("adminCountry") or "").strip()
        admin_country_source = "Natural Earth admin-1 point-in-polygon" if admin_country else ""
        if country_before:
            coordinate_country, coordinate_source = "", "not queried; record already has a country"
            candidate_country, country_source, country_status = country_before, "existing record", "already_present"
        else:
            coordinate_country, coordinate_source = (lookup.resolve(float(row[1]), float(row[2]))
                                                      if valid_coordinates(row) else ("", "invalid coordinates"))
            if coordinate_country and admin_country and not same_place(coordinate_country, admin_country):
                # The site-page field uses the same sovereign/location lookup as the
                # map popup; keep its result and expose the higher-resolution admin-1
                # disagreement for review rather than silently substituting it.
                candidate_country, country_source = coordinate_country, coordinate_source
                country_status = "resolved_coordinate_admin1_conflict"
            elif coordinate_country:
                candidate_country, country_source, country_status = coordinate_country, coordinate_source, "resolved"
            elif admin_country:
                candidate_country, country_source, country_status = admin_country, admin_country_source, "resolved_admin1"
            else:
                candidate_country, country_source, country_status = "", coordinate_source, "unresolved"

        if region_before:
            candidate_region, region_source, region_status = region_before, "existing record", "already_present"
        else:
            candidate_region, region_source = choose_region(row, location, candidate_country)
            region_status = "resolved" if candidate_region else "unresolved"

        results.append({
            "index": index, "site_id": site_id, "site_name": str(row[0] or ""),
            "latitude": row[1] if valid_coordinates(row) else "",
            "longitude": row[2] if valid_coordinates(row) else "",
            "country_before": country_before, "candidate_country": candidate_country,
            "coordinate_country": coordinate_country, "coordinate_country_source": coordinate_source,
            "admin_country": admin_country, "admin_country_source": admin_country_source,
            "country_source": country_source, "country_status": country_status,
            "region_before": region_before, "candidate_region": candidate_region,
            "region_source": region_source, "region_status": region_status,
            "marine_area_context": marine_area_context(location),
        })
    return results


def write_report(path: Path, results: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["site_id", "site_name", "latitude", "longitude", "country_before",
              "coordinate_country", "coordinate_country_source", "admin_country",
              "admin_country_source", "candidate_country", "country_source", "country_status", "region_before",
              "candidate_region", "region_source", "region_status", "marine_area_context"]
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows({key: row[key] for key in fields} for row in results)


def write_rows(path: Path, source: str, rows: list[list[object]], start: int, consumed: int) -> None:
    replacement = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    path.write_bytes((source[:start] + replacement + source[start + consumed:]).encode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write resolved missing country and region fields")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--dataset", type=Path, default=SITE_DATA)
    parser.add_argument("--sidecar", type=Path, default=LOCATION_SIDECAR)
    parser.add_argument("--land-boundaries", type=Path, default=LAND_BOUNDARIES)
    parser.add_argument("--maritime-boundaries", type=Path, default=MARITIME_BOUNDARIES)
    args = parser.parse_args()

    source, rows, start, consumed = read_rows(args.dataset)
    sidecar, lookup = read_location_inputs(args.sidecar, args.land_boundaries, args.maritime_boundaries)
    results = audit_rows(rows, sidecar, lookup)
    write_report(args.report, results)
    country_patches = [item for item in results if not item["country_before"] and item["candidate_country"]]
    region_patches = [item for item in results if not item["region_before"] and item["candidate_region"]]
    if args.apply:
        for item in results:
            row = rows[int(item["index"])]
            if not str(row[9] or "").strip() and item["candidate_country"]:
                row[9] = item["candidate_country"]
            if not str(row[10] or "").strip() and item["candidate_region"]:
                row[10] = item["candidate_region"]
        write_rows(args.dataset, source, rows, start, consumed)

    country_statuses = Counter(str(item["country_status"]) for item in results)
    region_statuses = Counter(str(item["region_status"]) for item in results)
    action = "Patched" if args.apply else "Would patch"
    print(f"Incomplete-location records audited: {len(results)}")
    print(f"{action} country fields: {len(country_patches)}; region fields: {len(region_patches)}")
    print(f"Country outcomes: {dict(sorted(country_statuses.items()))}")
    print(f"Region outcomes: {dict(sorted(region_statuses.items()))}")
    print(f"Review report: {args.report}")


if __name__ == "__main__":
    main()
