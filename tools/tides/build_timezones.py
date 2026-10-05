"""Partition timezone-boundary-builder GeoJSON into lazy, versioned 10-degree chunks."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "data/.build/tides/pydeps"))

from rasterio.windows import Window
from shapely.geometry import box, mapping, shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "data/.build/tides"
OUTPUT = ROOT / "data/tides/timezones-2026d"
ARCHIVE_URL = "https://github.com/evansiroky/timezone-boundary-builder/releases/download/2026d/timezones-with-oceans-now.geojson.zip"
ARCHIVE_SHA256 = "788ff3492b2e9fc624d89e9ee0d0f2c399b37ac18c0dc28d050cd616ce92cff1"
TILE_DEGREES = 10


def _download() -> tuple[bytes, str]:
    path = WORK / "timezones.geojson.zip"
    if not path.exists():
        request = urllib.request.Request(ARCHIVE_URL, headers={"User-Agent": "DiveAtlas timezone build/1.0"})
        with urllib.request.urlopen(request, timeout=90) as response:
            path.write_bytes(response.read())
    content = path.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    if digest != ARCHIVE_SHA256:
        raise ValueError(f"Timezone boundary archive checksum mismatch: {digest}")
    with zipfile.ZipFile(BytesIO(content)) as archive:
        member = next(name for name in archive.namelist() if name.endswith(".json"))
        return archive.read(member), digest


def _iterate_coords(value):
    if isinstance(value, (list, tuple)):
        if len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
            yield value[0], value[1]
        else:
            for child in value:
                yield from _iterate_coords(child)


def build() -> dict:
    raw, digest = _download()
    collection = json.loads(raw)
    features = [(feature["properties"]["tzid"], shape(feature["geometry"])) for feature in collection["features"]]
    chunks: dict[str, dict] = {}
    # Assign only polygon pieces that intersect a geographic bucket; point-in-polygon
    # on the browser then uses the original (unsimplified) boundary coordinates.
    for feature in collection["features"]:
        tzid = feature["properties"]["tzid"]
        polygon = shape(feature["geometry"])
        minx, miny, maxx, maxy = polygon.bounds
        x_start, x_end = math.floor((minx + 180) / TILE_DEGREES), math.floor((min(maxx, 179.999999) + 180) / TILE_DEGREES)
        y_start, y_end = math.floor((miny + 90) / TILE_DEGREES), math.floor((min(maxy, 89.999999) + 90) / TILE_DEGREES)
        for ty in range(max(0, y_start), min(18, y_end + 1)):
            for tx in range(max(0, x_start), min(36, x_end + 1)):
                west, south = -180 + tx * TILE_DEGREES, -90 + ty * TILE_DEGREES
                piece = polygon.intersection(box(west, south, west + TILE_DEGREES, south + TILE_DEGREES))
                if piece.is_empty or piece.area <= 0:
                    continue
                entry = chunks.setdefault(f"{ty}_{tx}", {"features": [], "bounds": [south, west, south + TILE_DEGREES, west + TILE_DEGREES]})
                entry["features"].append({"tzid": tzid, "geometry": mapping(piece)})
    published_bytes = 0
    for chunk_id, payload in chunks.items():
        data = json.dumps({"format": "TZN1", **payload}, separators=(",", ":")).encode()
        compressed = gzip.compress(data, compresslevel=9, mtime=0)
        target = OUTPUT / f"{chunk_id}.json.gz"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(compressed)
        payload["path"] = target.name
        payload["bytes"] = len(compressed)
        published_bytes += len(compressed)
    manifest = {
        "version": "tz-boundaries-2026d", "source": ARCHIVE_URL, "sha256": digest,
        "license": "https://opendatacommons.org/licenses/odbl/1-0/", "attribution": "Timezone boundary data © OpenStreetMap contributors; timezone-boundary-builder 2026d (ODbL)",
        "format": "gzip JSON MultiPolygon pieces clipped to 10-degree WGS84 buckets; point-in-polygon on original boundary vertices; includes ocean time zones and uses current boundaries",
        "timezoneRules": "The matching tzid is passed to Intl.DateTimeFormat; daylight-saving rules come from the browser's IANA Intl implementation.",
        "tileDegrees": TILE_DEGREES, "chunkTemplate": "{ty}_{tx}.json.gz", "chunkCount": len(chunks), "chunkBytes": published_bytes,
        "sourceArchiveBytes": (WORK / "timezones.geojson.zip").stat().st_size,
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf8")
    (OUTPUT / "manifest.js").unlink(missing_ok=True)
    print(json.dumps({"source_archive_bytes": manifest["sourceArchiveBytes"], "source_geojson_bytes": len(raw), "chunk_count": len(chunks), "chunk_bytes": published_bytes, "typical_chunk_bytes": int(sorted(x["bytes"] for x in chunks.values())[len(chunks)//2])}, indent=2))
    return manifest


if __name__ == "__main__":
    argparse.ArgumentParser(description=__doc__).parse_args()
    build()
