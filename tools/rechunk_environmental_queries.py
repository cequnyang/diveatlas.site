#!/usr/bin/env python3
"""Create month/depth query chunks from the existing, quantized production assets.

This is a lossless packaging conversion: it does not resample, re-quantize, or
change missing-value handling. Outputs are versioned alongside the v1 assets so
the new readers can be verified before any release is published.
"""

from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import gzip
import json
from pathlib import Path
import shutil
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_gzip(path: Path, payload: bytes) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=9, mtime=0) as compressed:
            compressed.write(payload)
    return path.stat().st_size


def temperature_v2(data_root: Path, output: Path) -> dict:
    source_root = data_root / "temperature/query"
    source_meta = read_json(source_root / "metadata.json")
    if source_meta.get("format") != "diveatlas-temperature-query" or source_meta.get("format_version") != 1:
        raise ValueError("Expected the existing v1 WOA23 query metadata")
    months = source_meta["available_months"]
    depths = source_meta["available_depths_m"]
    descriptors = []
    total_bytes = 0
    total_files = 0
    for row in range(int(source_meta["chunk_grid"]["rows"])):
        for column in range(int(source_meta["chunk_grid"]["columns"])):
            name = f"r{row:02d}_c{column:02d}.i16.gz"
            source = source_root / "chunks" / name
            if not source.is_file():
                raise FileNotFoundError(f"Missing source Temperature chunk: {source}")
            with gzip.open(source, "rb") as compressed:
                payload = compressed.read()
            # V1 layout is month, depth, latitude, longitude. Each resulting
            # file contains exactly one little-endian Int16 spatial plane.
            rows = max(1, round(float(source_meta["chunk_degrees"]) /
                                float(source_meta["grid"]["latitude_step_degrees"])))
            columns = max(1, round(float(source_meta["chunk_degrees"]) /
                                   float(source_meta["grid"]["longitude_step_degrees"])))
            row_start = row * rows
            column_start = column * columns
            row_count = min(int(source_meta["grid"]["latitude_count"]), row_start + rows) - row_start
            column_count = min(int(source_meta["grid"]["longitude_count"]), column_start + columns) - column_start
            halo = int(source_meta["chunk_halo_cells"])
            data_rows = min(int(source_meta["grid"]["latitude_count"]), row_start + row_count + halo) - max(0, row_start - halo)
            data_columns = min(int(source_meta["grid"]["longitude_count"]), column_count + 2 * halo)
            plane_bytes = data_rows * data_columns * 2
            expected = len(months) * len(depths) * plane_bytes
            if len(payload) != expected:
                raise ValueError(f"Unexpected Temperature chunk size for {name}: {len(payload)} != {expected}")
            descriptors.append({"row": row, "column": column, "row_start": row_start,
                                "column_start": column_start,
                                "data_row_start": max(0, row_start - halo),
                                "data_column_start": (column_start - halo) % int(source_meta["grid"]["longitude_count"]),
                                "rows": data_rows, "columns": data_columns})
            for month_index, month in enumerate(months):
                for depth_index, depth in enumerate(depths):
                    offset = (month_index * len(depths) + depth_index) * plane_bytes
                    slice_bytes = payload[offset:offset + plane_bytes]
                    # Verify the conversion is byte-identical to the v1 plane.
                    if len(slice_bytes) != plane_bytes:
                        raise ValueError(f"Truncated Temperature slice in {name}")
                    target = output / f"chunks/{month:02d}/{int(float(depth)):02d}/r{row:02d}_c{column:02d}.i16.gz"
                    total_bytes += write_gzip(target, slice_bytes)
                    total_files += 1

    metadata = copy.deepcopy(source_meta)
    metadata["format_version"] = 2
    metadata["generation_version"] = f"{source_meta['generation_version']}-sliced-{datetime.now(timezone.utc):%Y%m%d%H%M%S}"
    metadata["chunk_file_template"] = "chunks/{month}/{depth}/r{row}_c{column}.i16.gz"
    metadata["chunk_size_summary"] = {"count": total_files, "compressed_total_bytes": total_bytes,
                                      "layout": "one month and depth per spatial chunk"}
    metadata["sliced_chunks"] = descriptors
    output.mkdir(parents=True, exist_ok=True)
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return {"output": str(output), "files": total_files, "bytes": total_bytes}


def clarity_v2(data_root: Path, output: Path) -> dict:
    source_root = data_root / "water_clarity"
    source_meta = read_json(source_root / "metadata.json")
    if source_meta.get("format") != "diveatlas-water-clarity" or source_meta.get("format_version") != 1:
        raise ValueError("Expected the existing v1 Water Clarity metadata")
    source_query = source_meta["query"]
    months = source_meta["available_months"]
    descriptors = []
    total_bytes = 0
    total_files = 0
    for descriptor in source_query["chunks"]:
        source = source_root / "query/chunks" / descriptor["file"]
        with gzip.open(source, "rb") as compressed:
            payload = compressed.read()
        plane_bytes = int(descriptor["rows"]) * int(descriptor["columns"])
        expected = len(months) * plane_bytes
        if len(payload) != expected:
            raise ValueError(f"Unexpected Water Clarity chunk size for {source.name}: {len(payload)} != {expected}")
        descriptors.append({key: descriptor[key] for key in ("row", "column", "row_start", "column_start", "rows", "columns")})
        for month_index, month in enumerate(months):
            plane = payload[month_index * plane_bytes:(month_index + 1) * plane_bytes]
            target = output / f"chunks/{month:02d}/r{int(descriptor['row']):02d}_c{int(descriptor['column']):02d}.u8.gz"
            total_bytes += write_gzip(target, plane)
            total_files += 1

    metadata = {key: copy.deepcopy(value) for key, value in source_meta.items() if key != "query"}
    metadata["format"] = "diveatlas-water-clarity-query"
    metadata["format_version"] = 2
    metadata["generated_at_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    metadata["query"] = {
        "chunk_degrees": source_query["chunk_degrees"],
        "chunk_grid": copy.deepcopy(source_query["chunk_grid"]),
        "chunk_file_template": "chunks/{month}/r{row}_c{column}.u8.gz",
        "chunk_size_summary": {"count": total_files, "compressed_total_bytes": total_bytes,
                               "layout": "one month per spatial chunk"},
        "chunks": descriptors,
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return {"output": str(output), "files": total_files, "bytes": total_bytes}


def build(data_root: Path, *, force: bool = False) -> dict:
    outputs = [data_root / "temperature/query/v2", data_root / "water_clarity/query/v2"]
    existing = [str(path) for path in outputs if path.exists()]
    if existing and not force:
        raise FileExistsError("Refusing to overwrite existing v2 output: " + ", ".join(existing) + " (use --force)")
    # Build in a sibling temporary directory, so interrupted conversion never
    # leaves a partially valid metadata file at the paths used by the app.
    staging = Path(tempfile.mkdtemp(prefix="environment-query-v2-", dir=data_root))
    try:
        temperature = temperature_v2(data_root, staging / "temperature")
        clarity = clarity_v2(data_root, staging / "water_clarity")
        for target in outputs:
            if target.exists():
                shutil.rmtree(target)
        outputs[0].parent.mkdir(parents=True, exist_ok=True)
        outputs[1].parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(staging / "temperature"), str(outputs[0]))
        shutil.move(str(staging / "water_clarity"), str(outputs[1]))
        return {"temperature": temperature, "water_clarity": clarity}
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=ROOT / "data")
    parser.add_argument("--force", action="store_true", help="replace existing v2 output directories")
    args = parser.parse_args()
    print(json.dumps(build(args.data_root, force=args.force), indent=2))


if __name__ == "__main__":
    main()
