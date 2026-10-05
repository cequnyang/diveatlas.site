#!/usr/bin/env python3
"""Publish only validated Candidate A tiles, query chunks, and metadata.

The source is the ignored local historical-analysis artifact. This step does
not contact NOAA: it creates a curated site asset tree and rechunks click
records from 256 to 128 cells so a popup reads one smaller deterministic
region without changing the visual tile pyramid.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import shutil
import statistics
import struct
import sys
from datetime import date
from pathlib import Path

try:
    from .ocean_heat_history_palette import CATEGORY_LABELS, category_definitions
except ImportError:  # Direct script execution sets sys.path to this tool directory.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from ocean_heat_history_palette import CATEGORY_LABELS, category_definitions


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "data/.build/reef_condition/ocean-heat-history-prototype"
DEFAULT_OUTPUT = ROOT / "data/reef-condition/ocean-heat-history"
SOURCE_QUERY_SIZE = 256
PRODUCTION_QUERY_SIZE = 128
QUERY_HEADER = struct.Struct("<4sHH")
QUERY_MAGIC = b"MHW1"
QUERY_BYTES_PER_CELL = 15
QUERY_FIELDS = (
    "worstCategory", "worstDayIndex", "marineHeatwaveDays", "strongOrWorseDays",
    "severeOrWorseDays", "extremeOrWorseDays", "longestEpisodeDays", "validDays",
)
PRODUCTION_MAP_TILE_COUNT = sum(4**zoom for zoom in range(6))


def size_summary(paths: list[Path]) -> dict[str, int | float]:
    sizes = sorted(path.stat().st_size for path in paths)
    if not sizes:
        return {"count": 0, "medianBytes": 0, "p90Bytes": 0, "maxBytes": 0}
    p90_index = max(0, math.ceil(0.9 * len(sizes)) - 1)
    return {
        "count": len(sizes),
        "medianBytes": statistics.median(sizes),
        "p90Bytes": sizes[p90_index],
        "maxBytes": sizes[-1],
    }


def _read_source_chunk(path: Path, expected_column: int, expected_row: int, source_size: int) -> bytes:
    raw = gzip.decompress(path.read_bytes())
    expected_length = QUERY_HEADER.size + source_size * source_size * QUERY_BYTES_PER_CELL
    if len(raw) != expected_length:
        raise ValueError(f"Invalid MHW query chunk size: {path.name}")
    magic, column, row = QUERY_HEADER.unpack_from(raw)
    if (magic, column, row) != (QUERY_MAGIC, expected_column, expected_row):
        raise ValueError(f"MHW query header does not match its filename: {path.name}")
    return raw


def rechunk_query_chunks(
    source_dir: Path,
    output_dir: Path,
    *,
    grid_width: int,
    grid_height: int,
    source_size: int = SOURCE_QUERY_SIZE,
    target_size: int = PRODUCTION_QUERY_SIZE,
) -> dict[str, object]:
    """Copy packed MHW records unchanged into smaller, validated query chunks."""
    if min(grid_width, grid_height, source_size, target_size) < 1 or source_size % target_size:
        raise ValueError("Query grid and chunk sizes must be positive, with target size dividing source size")
    output_dir.mkdir(parents=True, exist_ok=True)
    source_columns = math.ceil(grid_width / source_size)
    source_rows = math.ceil(grid_height / source_size)
    source_paths = sorted(source_dir.glob("*.bin.gz"))
    expected_source_count = source_columns * source_rows
    if len(source_paths) != expected_source_count:
        raise ValueError(f"Expected {expected_source_count} source MHW query chunks, found {len(source_paths)}")
    source_index = {path.name: path for path in source_paths}
    if len(source_index) != expected_source_count:
        raise ValueError("Source MHW query chunk names are not unique")

    source_stats = size_summary(source_paths)
    source_stride = source_size * QUERY_BYTES_PER_CELL
    target_row_bytes = target_size * QUERY_BYTES_PER_CELL
    subdivisions = source_size // target_size
    output_paths: list[Path] = []
    for source_row in range(source_rows):
        for source_column in range(source_columns):
            filename = f"{source_column}_{source_row}.bin.gz"
            if filename not in source_index:
                raise ValueError(f"Missing source MHW query chunk: {filename}")
            raw = _read_source_chunk(source_index[filename], source_column, source_row, source_size)
            for sub_y in range(subdivisions):
                target_row = source_row * subdivisions + sub_y
                if target_row * target_size >= grid_height:
                    continue
                for sub_x in range(subdivisions):
                    target_column = source_column * subdivisions + sub_x
                    if target_column * target_size >= grid_width:
                        continue
                    rows = []
                    for local_y in range(target_size):
                        source_y = sub_y * target_size + local_y
                        source_x = sub_x * target_size
                        offset = QUERY_HEADER.size + source_y * source_stride + source_x * QUERY_BYTES_PER_CELL
                        rows.append(raw[offset:offset + target_row_bytes])
                    payload = QUERY_HEADER.pack(QUERY_MAGIC, target_column, target_row) + b"".join(rows)
                    destination = output_dir / f"{target_column}_{target_row}.bin.gz"
                    destination.write_bytes(gzip.compress(payload, compresslevel=8, mtime=0))
                    output_paths.append(destination)

    expected_output_count = math.ceil(grid_width / target_size) * math.ceil(grid_height / target_size)
    if len(output_paths) != expected_output_count:
        raise ValueError(f"Expected {expected_output_count} output MHW query chunks, wrote {len(output_paths)}")
    return {
        "source": source_stats,
        "output": size_summary(output_paths),
        "paths": output_paths,
    }


def _validate_source_metadata(metadata: dict) -> tuple[dict, dict, dict]:
    period = metadata.get("sourcePeriod", {})
    display_grid = metadata.get("displayGrid", {})
    query = metadata.get("query", {})
    start = period.get("start")
    end = period.get("end")
    try:
        start_date = date.fromisoformat(start)
        end_date = date.fromisoformat(end)
    except (TypeError, ValueError) as error:
        raise ValueError("Research artifact has an invalid source period") from error
    complete_years = end_date.year - start_date.year + 1
    if (metadata.get("prototype") is not True or metadata.get("provider") != "NOAA Coral Reef Watch" or
            metadata.get("productVersion") != "1.0.1" or metadata.get("sourceVariable") != "heatwave_category" or
            period.get("startYear") != start_date.year or period.get("endYear") != end_date.year or
            period.get("completeYears") != complete_years or complete_years != 10 or
            start_date.isoformat() != f"{start_date.year}-01-01" or
            end_date.isoformat() != f"{end_date.year}-12-31" or
            metadata.get("categories") != list(CATEGORY_LABELS) or
            display_grid.get("width") != 1440 or display_grid.get("height") != 720 or
            display_grid.get("stepDegrees") != 0.25 or
            query.get("template") != "query/{column}_{row}.bin.gz" or
            query.get("header", "").split(" + ")[0] != "MHW1" or
            query.get("tileSize") != SOURCE_QUERY_SIZE or
            query.get("recordFields") != ["worst", "worst_day", "mhw_days", "strong_days", "severe_days", "extreme_days", "longest_run", "valid_days"]):
        raise ValueError("Research artifact does not match the validated 10-year NOAA MHW Candidate A contract")
    candidate_a = metadata.get("candidateA", {})
    if candidate_a.get("tileTemplate") != "candidate-a/tiles/{z}/{x}/{y}.png" or candidate_a.get("tileMaxZoom") != 5:
        raise ValueError("Research artifact does not contain the validated Candidate A tile pyramid")
    return period, display_grid, candidate_a


def _production_metadata(source: dict, period: dict, display_grid: dict,
                         map_paths: list[Path], query_paths: list[Path]) -> dict:
    start_year = period["startYear"]
    end_year = period["endYear"]
    product_version = source["productVersion"]
    version = f"crw-mhw-{product_version}-{start_year}-{end_year}-worst-category"
    map_bytes = sum(path.stat().st_size for path in map_paths)
    query_bytes = sum(path.stat().st_size for path in query_paths)
    metadata = {
        "schemaVersion": 1,
        "provider": "NOAA Coral Reef Watch",
        "product": "Marine Heatwave Watch",
        "productVersion": product_version,
        "sourceVariable": source["sourceVariable"],
        "metric": "Worst marine heatwave category",
        "sourceUrl": source["sourceUrl"],
        "attribution": source["attribution"],
        "sourcePeriod": {
            "start": period["start"], "end": period["end"],
            "startYear": start_year, "endYear": end_year,
            "completeYears": period["completeYears"],
        },
        "displayGrid": {
            "width": display_grid["width"], "height": display_grid["height"],
            "longitudeMin": -179.875, "latitudeMin": -89.875,
            "stepDegrees": display_grid["stepDegrees"], "rowOrder": "south-to-north",
        },
        "semantics": source["semantics"],
        "temporalSpatialSemantics": source["temporalSpatialSemantics"],
        "categories": category_definitions(),
        "assetBase": "./data/reef-condition/ocean-heat-history",
        "tileTemplate": "tiles/{z}/{x}/{y}.png",
        "tileMinZoom": 0,
        "tileMaxNativeZoom": 5,
        "queryTileTemplate": "query/{column}_{row}.bin.gz",
        "query": {
            "format": "MHW1",
            "headerBytes": QUERY_HEADER.size,
            "tileSizeCells": PRODUCTION_QUERY_SIZE,
            "bytesPerCell": QUERY_BYTES_PER_CELL,
            "fields": list(QUERY_FIELDS),
            "missingValue": 255,
        },
        "version": version,
        "generatedAt": source.get("generatedAt"),
        "assets": {
            "mapTileCount": len(map_paths), "mapTileBytes": map_bytes,
            "queryChunkCount": len(query_paths), "queryBytes": query_bytes,
            "metadataBytes": 0, "totalBytes": 0,
        },
    }
    for _ in range(5):
        encoded = json.dumps(metadata, indent=2, ensure_ascii=False) + "\n"
        metadata["assets"]["metadataBytes"] = len(encoded.encode("utf-8"))
        metadata["assets"]["totalBytes"] = map_bytes + query_bytes + metadata["assets"]["metadataBytes"]
        updated = json.dumps(metadata, indent=2, ensure_ascii=False) + "\n"
        if len(updated.encode("utf-8")) == metadata["assets"]["metadataBytes"]:
            return metadata
    raise RuntimeError("Could not stabilize production metadata byte totals")


def publish(source_dir: Path, output_dir: Path) -> dict:
    source_path = source_dir / "metadata.json"
    source = json.loads(source_path.read_text(encoding="utf-8"))
    period, display_grid, candidate_a = _validate_source_metadata(source)
    source_tiles_dir = source_dir / "candidate-a" / "tiles"
    map_sources = sorted(source_tiles_dir.glob("*/*/*.png"), key=lambda path: tuple(map(int, path.relative_to(source_tiles_dir).parts[:-1])) + (int(path.stem),))
    if len(map_sources) != candidate_a.get("tileCount") or len(map_sources) != PRODUCTION_MAP_TILE_COUNT:
        raise ValueError("Candidate A tile pyramid is incomplete")
    for tile in map_sources:
        relative = tile.relative_to(source_tiles_dir)
        if len(relative.parts) != 3 or not (0 <= int(relative.parts[0]) <= 5):
            raise ValueError(f"Unexpected Candidate A tile path: {relative}")

    source_query = source_dir / "query"
    if output_dir.exists():
        allowed = {"metadata.json", "tiles", "query"}
        unexpected = [child.name for child in output_dir.iterdir() if child.name not in allowed]
        if unexpected:
            raise ValueError(f"Refusing to replace unexpected files in production data directory: {unexpected}")
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)
    map_paths = []
    for source_tile in map_sources:
        target = output_dir / "tiles" / source_tile.relative_to(source_tiles_dir)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_tile, target)
        map_paths.append(target)
    query_stats = rechunk_query_chunks(
        source_query, output_dir / "query",
        grid_width=display_grid["width"], grid_height=display_grid["height"],
    )
    query_paths = query_stats["paths"]
    metadata = _production_metadata(source, period, display_grid, map_paths, query_paths)
    (output_dir / "metadata.json").write_bytes(
        (json.dumps(metadata, indent=2, ensure_ascii=False) + "\n").encode("utf-8"),
    )
    return {
        "output": str(output_dir),
        "period": metadata["sourcePeriod"],
        "productVersion": metadata["productVersion"],
        "mapTiles": len(map_paths),
        "mapBytes": metadata["assets"]["mapTileBytes"],
        "queryChunks": len(query_paths),
        "queryBytes": metadata["assets"]["queryBytes"],
        "metadataBytes": metadata["assets"]["metadataBytes"],
        "totalBytes": metadata["assets"]["totalBytes"],
        "queryChunkComparison": {
            "source256Cell": {key: value for key, value in query_stats["source"].items()},
            "production128Cell": {key: value for key, value in query_stats["output"].items()},
        },
        "publishedPaths": ["metadata.json", "tiles/**/*.png", "query/*.bin.gz"],
        "excludedResearchPaths": ["candidate-b", "source daily files", "checkpoints", "prototype HTML"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    output = args.output.resolve()
    if output != DEFAULT_OUTPUT.resolve():
        raise SystemExit(f"Production output is restricted to {DEFAULT_OUTPUT}")
    print(json.dumps(publish(args.source.resolve(), output), indent=2))


if __name__ == "__main__":
    main()
