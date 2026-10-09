"""Build the compact local country and maritime lookup files used by the map."""

from __future__ import annotations

import argparse
import gzip
import json
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import shapefile


COUNTRIES_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
    "geojson/ne_50m_admin_0_countries.geojson"
)
EEZ_URL = "https://zenodo.org/records/16355917/files/World_EEZ_v12_20231025_LR.zip?download=1"
COUNTRY_NAME_FIELDS = {
    "en": "NAME_EN", "zh": "NAME_ZH", "ja": "NAME_JA", "fr": "NAME_FR",
    "de": "NAME_DE", "nl": "NAME_NL", "it": "NAME_IT", "ru": "NAME_RU",
    "pt": "NAME_PT", "sv": "NAME_SV", "no": "NAME_NO", "es": "NAME_ES",
    "ko": "NAME_KO", "id": "NAME_ID",
}
EEZ_SIMPLIFY_TOLERANCE_DEGREES = 0.01


def simplify_open_line(points: list[list[float]], tolerance: float) -> list[list[float]]:
    if len(points) <= 2:
        return points
    tolerance_squared = tolerance * tolerance
    keep = {0, len(points) - 1}
    pending = [(0, len(points) - 1)]
    while pending:
        start_index, end_index = pending.pop()
        start = points[start_index]
        end = points[end_index]
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        segment_length_squared = dx * dx + dy * dy
        farthest_index = None
        farthest_distance_squared = tolerance_squared
        for index in range(start_index + 1, end_index):
            point = points[index]
            if segment_length_squared:
                ratio = max(0, min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / segment_length_squared))
                nearest_x = start[0] + ratio * dx
                nearest_y = start[1] + ratio * dy
                distance_squared = (point[0] - nearest_x) ** 2 + (point[1] - nearest_y) ** 2
            else:
                distance_squared = (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2
            if distance_squared > farthest_distance_squared:
                farthest_index = index
                farthest_distance_squared = distance_squared
        if farthest_index is not None:
            keep.add(farthest_index)
            pending.extend(((start_index, farthest_index), (farthest_index, end_index)))
    return [points[index] for index in sorted(keep)]


def simplify_ring(ring: list[list[float]]) -> list[list[float]]:
    points = [[round(point[0], 4), round(point[1], 4)] for point in ring[:-1]]
    if len(points) < 4:
        return points + [points[0]]
    anchor_index = max(range(1, len(points)), key=lambda index: (points[index][0] - points[0][0]) ** 2 + (points[index][1] - points[0][1]) ** 2)
    first_arc = simplify_open_line(points[:anchor_index + 1], EEZ_SIMPLIFY_TOLERANCE_DEGREES)
    second_arc = simplify_open_line(points[anchor_index:] + [points[0]], EEZ_SIMPLIFY_TOLERANCE_DEGREES)
    simplified = first_arc[:-1] + second_arc[:-1]
    if len(simplified) < 3:
        return points + [points[0]]
    return simplified + [simplified[0]]


def simplify_geometry(geometry: dict) -> dict:
    geometry_type = geometry["type"]
    coordinates = geometry["coordinates"]
    if geometry_type == "Polygon":
        simplified = [[simplify_ring(ring) for ring in coordinates]]
        return {"type": "MultiPolygon", "coordinates": simplified}
    if geometry_type == "MultiPolygon":
        return {"type": geometry_type, "coordinates": [
            [simplify_ring(ring) for ring in polygon]
            for polygon in coordinates
        ]}
    raise ValueError(f"Unsupported maritime geometry type: {geometry_type}")


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "DiveAtlas boundary data builder"})
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as output:
        output.write(response.read())


def write_gzip_json(destination: Path, value: object) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as output:
        with gzip.GzipFile(fileobj=output, mode="wb", compresslevel=9, mtime=0) as compressed:
            compressed.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def build(output_dir: Path, countries_source: Path | None = None, eez_shapefile: Path | None = None) -> None:
    with tempfile.TemporaryDirectory(prefix="diveatlas-boundaries-") as temporary:
        temporary_dir = Path(temporary)
        if countries_source is None:
            countries_source = temporary_dir / "countries.geojson"
            download(COUNTRIES_URL, countries_source)
        if eez_shapefile is None:
            eez_archive = temporary_dir / "world-eez.zip"
            eez_dir = temporary_dir / "eez"
            download(EEZ_URL, eez_archive)
            with zipfile.ZipFile(eez_archive) as archive:
                archive.extractall(eez_dir)
            eez_shapefile = next(eez_dir.rglob("eez_v12_lowres.shp"))

        source_countries = json.loads(countries_source.read_text(encoding="utf-8"))
        slim_countries = []
        iso_to_country = {}
        for feature in source_countries["features"]:
            properties = feature["properties"]
            country = {
                "name": properties.get("ADMIN") or properties.get("NAME"),
                "sovereign": properties.get("SOVEREIGNT"),
                "iso": properties.get("ISO_A3"),
                "region": properties.get("REGION_UN"),
                "names": {
                    language: properties[field]
                    for language, field in COUNTRY_NAME_FIELDS.items()
                    if properties.get(field)
                },
            }
            slim_countries.append({"type": "Feature", "properties": country, "geometry": feature["geometry"]})
            if country["iso"] and country["iso"] != "-99":
                iso_to_country[country["iso"]] = country

        reader = shapefile.Reader(str(eez_shapefile), encoding="utf-8")
        fields = [field[0] for field in reader.fields[1:]]
        zones = []
        for shape, record in zip(reader.shapes(), reader.records()):
            if not shape.points:
                continue
            row = dict(zip(fields, record))
            sovereigns = [row.get(f"SOVEREIGN{index}") for index in range(1, 4)]
            territories = [row.get(f"TERRITORY{index}") for index in range(1, 4)]
            sovereign_isos = [row.get(f"ISO_SOV{index}") for index in range(1, 4)]
            zones.append({
                "type": "Feature",
                "properties": {
                    "kind": row.get("POL_TYPE"),
                    "name": row.get("GEONAME"),
                    "territories": [value for value in territories if value],
                    "sovereigns": [value for value in sovereigns if value],
                    "sovereignIsos": [value for value in sovereign_isos if value],
                },
                "geometry": simplify_geometry(shape.__geo_interface__),
            })

        write_gzip_json(output_dir / "country-boundaries.geojson.gz", {
            "type": "FeatureCollection", "features": slim_countries,
        })
        write_gzip_json(output_dir / "maritime-zones-v12.geojson.gz", {
            "type": "FeatureCollection", "features": zones,
            "countries": iso_to_country,
        })


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("datasets"))
    parser.add_argument("--countries-geojson", type=Path)
    parser.add_argument("--eez-shapefile", type=Path)
    arguments = parser.parse_args()
    build(
        arguments.output_dir.resolve(),
        arguments.countries_geojson.resolve() if arguments.countries_geojson else None,
        arguments.eez_shapefile.resolve() if arguments.eez_shapefile else None,
    )


if __name__ == "__main__":
    main()
