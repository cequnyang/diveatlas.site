"""Acquire one explicitly versioned NOAA Coral Reef Watch Thermal History source."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import shutil
import threading
import urllib.request
from pathlib import Path


VERSION = "3.7.0"
RANGE_CHUNK_SIZE = 32 * 1024 * 1024
RANGE_WORKERS = 6
SOURCE_BASE = "https://www.star.nesdis.noaa.gov/pub/socd/mecb/crw/data/thermal_history/v3.7/annual_history"
FILENAME = "noaa_crw_thermal_history_annual_history_v3.7.0_1985%E2%80%932025.nc"
SOURCE_URL = f"{SOURCE_BASE}/{FILENAME}"


def acquire(output: Path, *, force: bool = False) -> Path:
    output.mkdir(parents=True, exist_ok=True)
    target = output / "noaa_crw_thermal_history_annual_history_v3.7.0_1985-2025.nc"
    request = urllib.request.Request(SOURCE_URL, method="HEAD", headers={"User-Agent": "DiveAtlas static data builder"})
    with urllib.request.urlopen(request, timeout=60) as response:
        expected_size = int(response.headers["Content-Length"])
        etag = response.headers.get("ETag", "").strip('"')
        last_modified = response.headers.get("Last-Modified", "")
    receipt = target.with_suffix(target.suffix + ".source.json")
    if target.is_file() and target.stat().st_size == expected_size and not force:
        return target

    partial = target.with_suffix(target.suffix + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > expected_size or force:
        partial.unlink(missing_ok=True)
        offset = 0
    ranges = [
        (start, min(start + RANGE_CHUNK_SIZE, expected_size) - 1)
        for start in range(offset, expected_size, RANGE_CHUNK_SIZE)
    ]
    progress_lock = threading.Lock()
    completed = 0

    def fetch_range(start: int, end: int) -> tuple[Path, int]:
        nonlocal completed
        chunk_path = output / f"{target.name}.range-{start}-{end}.part"
        expected_chunk_size = end - start + 1
        if chunk_path.is_file() and chunk_path.stat().st_size == expected_chunk_size:
            with progress_lock:
                completed += expected_chunk_size
            return chunk_path, expected_chunk_size
        chunk_path.unlink(missing_ok=True)
        request_headers = {
            "User-Agent": "DiveAtlas static data builder",
            "Range": f"bytes={start}-{end}",
        }
        request = urllib.request.Request(SOURCE_URL, headers=request_headers)
        with urllib.request.urlopen(request, timeout=240) as response:
            if response.status != 206:
                raise RuntimeError(f"NOAA did not honor byte range {start}-{end} (HTTP {response.status})")
            content_range = response.headers.get("Content-Range", "")
            if content_range != f"bytes {start}-{end}/{expected_size}":
                raise RuntimeError(f"NOAA returned unexpected Content-Range for {start}-{end}: {content_range!r}")
            response_etag = response.headers.get("ETag", "").strip('"')
            if etag and response_etag and response_etag != etag:
                raise RuntimeError("NOAA source ETag changed during ranged acquisition")
            count = 0
            with chunk_path.open("wb") as stream:
                while data := response.read(1024 * 1024):
                    stream.write(data)
                    count += len(data)
            if count != expected_chunk_size:
                chunk_path.unlink(missing_ok=True)
                raise RuntimeError(f"NOAA range size mismatch for {start}-{end}: expected {expected_chunk_size}, got {count}")
        with progress_lock:
            completed += expected_chunk_size
            print(f"Downloaded/resumed {offset + completed:,} / {expected_size:,} bytes ({(offset + completed) / expected_size:.1%})", flush=True)
        return chunk_path, expected_chunk_size

    chunks = {}
    if ranges:
        with ThreadPoolExecutor(max_workers=RANGE_WORKERS) as pool:
            futures = {pool.submit(fetch_range, start, end): start for start, end in ranges}
            for future in as_completed(futures):
                path, size = future.result()
                chunks[futures[future]] = path

    assembling = output / f"{target.name}.assembling"
    partial.touch(exist_ok=True)
    with partial.open("rb") as prefix, assembling.open("wb") as stream:
        shutil.copyfileobj(prefix, stream, length=8 * 1024 * 1024)
        for start, _end in ranges:
            with chunks[start].open("rb") as chunk:
                shutil.copyfileobj(chunk, stream, length=8 * 1024 * 1024)
    if assembling.stat().st_size != expected_size:
        raise RuntimeError(f"Assembled NOAA source size mismatch: expected {expected_size:,}, got {assembling.stat().st_size:,}")
    assembling.replace(partial)
    for chunk in chunks.values():
        chunk.unlink(missing_ok=True)
    if not partial.is_file() or partial.stat().st_size != expected_size:
        raise RuntimeError(f"NOAA source size mismatch: expected {expected_size:,} bytes, got {partial.stat().st_size if partial.exists() else 0:,}")
    partial.replace(target)
    receipt.write_text(json.dumps({"version": VERSION, "url": SOURCE_URL, "sizeBytes": expected_size, "etag": etag, "lastModified": last_modified}, indent=2) + "\n", encoding="utf-8")
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("data/.build/coral_heat_stress/history_source"))
    parser.add_argument("--force", action="store_true", help="download even when a complete NOAA file already exists")
    args = parser.parse_args()
    path = acquire(args.output_dir, force=args.force)
    print(f"Verified-size NOAA Thermal History v{VERSION} source: {path} ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
