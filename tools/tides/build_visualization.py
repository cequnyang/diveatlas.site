"""Build the legacy coarse, ocean-masked EOT20 map derivative.

The active map now samples the native 0.125-degree model via
``js/tides/model-loader.js``; this derivative remains for reproducible
comparison and is not loaded by the active map.
"""

from __future__ import annotations

import gzip
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data/tides/eot20-v1/coeff"
OUTPUT = ROOT / "data/tides/eot20-viz-v1"
CONSTITUENTS = 17
COEFFICIENT_BYTES = 1 + CONSTITUENTS * 8
SOURCE_HEADER = struct.Struct("<4sBBHHHdd")
OUTPUT_HEADER = struct.Struct("<4sBBHHHddd")
CHUNK_DEGREES = 30
SOURCE_STEP = 0.125
VISUAL_STEP = 1.0


def read_source(ty: int, tx: int):
    path = SOURCE / f"{ty}_{tx}.bin.gz"
    if not path.exists():
        return None
    raw = gzip.decompress(path.read_bytes())
    magic, version, count, rows, columns, record_size, lat0, lon0 = SOURCE_HEADER.unpack_from(raw)
    if magic != b"EOT1" or version != 1 or count != CONSTITUENTS or record_size != COEFFICIENT_BYTES:
        raise ValueError(f"Unexpected source chunk format: {path}")
    expected = SOURCE_HEADER.size + rows * columns * record_size
    if len(raw) != expected:
        raise ValueError(f"Truncated source chunk: {path}")
    return rows, columns, lat0, lon0, memoryview(raw)[SOURCE_HEADER.size:]


def build_tile(ty: int, tx: int) -> dict:
    south, west = -90 + ty * CHUNK_DEGREES, -180 + tx * CHUNK_DEGREES
    visual_lat0 = max(-90, south - 2)
    visual_lon0 = west - 2
    lat1 = min(90, south + CHUNK_DEGREES + 2)
    lon1 = west + CHUNK_DEGREES + 2
    rows = round((lat1 - visual_lat0) / VISUAL_STEP) + 1
    columns = round((lon1 - visual_lon0) / VISUAL_STEP) + 1
    chunks = {}
    records = bytearray(rows * columns * COEFFICIENT_BYTES)
    valid_count = 0
    for row in range(rows):
        lat = visual_lat0 + row * VISUAL_STEP
        for column in range(columns):
            lon = visual_lon0 + column * VISUAL_STEP
            source_ty = min(35, max(0, math.floor((lat + 90) / 5)))
            source_tx = math.floor((((lon + 180) % 360) / 5))
            key = (source_ty, source_tx)
            if key not in chunks:
                chunks[key] = read_source(*key)
            chunk = chunks[key]
            if chunk is None:
                continue
            source_rows, source_columns, source_lat0, source_lon0, data = chunk
            sy = round((lat - source_lat0) / SOURCE_STEP)
            source_lon = lon
            if source_tx == 71 and source_lon < source_lon0:
                source_lon += 360
            elif source_tx == 0 and source_lon > source_lon0 + 360:
                source_lon -= 360
            sx = round((source_lon - source_lon0) / SOURCE_STEP)
            if not (0 <= sy < source_rows and 0 <= sx < source_columns):
                continue
            source_offset = (sy * source_columns + sx) * COEFFICIENT_BYTES
            if data[source_offset] != 1:
                continue
            destination = (row * columns + column) * COEFFICIENT_BYTES
            records[destination:destination + COEFFICIENT_BYTES] = data[source_offset:source_offset + COEFFICIENT_BYTES]
            valid_count += 1
    header = OUTPUT_HEADER.pack(b"TVZ1", 1, CONSTITUENTS, rows, columns, COEFFICIENT_BYTES, float(visual_lat0), float(visual_lon0), VISUAL_STEP)
    path = OUTPUT / "chunks" / f"{ty}_{tx}.bin.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip.compress(header + records, compresslevel=9, mtime=0))
    return {"path": f"chunks/{ty}_{tx}.bin.gz", "rows": rows, "columns": columns, "validNodes": valid_count, "bytes": path.stat().st_size}


def main() -> None:
    tiles = {}
    for ty in range(6):
        for tx in range(12):
            key = f"{ty}_{tx}"
            tiles[key] = build_tile(ty, tx)
            print(f"Built {key}: {tiles[key]['validNodes']:,} wet nodes, {tiles[key]['bytes']:,} compressed bytes")
    files = list((OUTPUT / "chunks").glob("*.bin.gz"))
    manifest = {
        "version": "eot20-viz-v1", "model": "EOT20", "gridResolutionDegrees": VISUAL_STEP,
        "sourceResolutionDegrees": 0.125, "tileDegrees": CHUNK_DEGREES, "constituents": CONSTITUENTS,
        "chunkTemplate": "chunks/{ty}_{tx}.bin.gz", "tiles": tiles,
        "chunkCount": len(files), "publishedBytes": sum(path.stat().st_size for path in files),
        "encoding": "gzip TVZ1 v1; validity byte + 17 little-endian float32 (Re,Im) coefficient pairs in cm",
        "validity": "Copied only from valid native EOT20 nodes whose GEBCO 3x3 water neighborhood is ocean; drawing also requires four valid visual-grid nodes.",
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Visualization ready: {manifest['chunkCount']} chunks, {manifest['publishedBytes']:,} bytes")


if __name__ == "__main__":
    main()
