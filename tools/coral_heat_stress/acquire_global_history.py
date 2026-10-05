"""Download NOAA's global annual DHW composites, resuming valid partial files."""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path

import netCDF4

SOURCE_DIRECTORY = "https://www.star.nesdis.noaa.gov/pub/sod/mecb/crw/data/5km/v3.1_op/nc/v1.0/annual/"
YEARS = tuple(range(2016, 2026))


def _name(year: int) -> str:
    return f"ct5km_dhw-max_v3.1_{year}.nc"


def _validate(path: Path, year: int) -> tuple[bool, dict]:
    try:
        with netCDF4.Dataset(path, "r") as dataset:
            variable = dataset.variables.get("degree_heating_week")
            if variable is None or variable.dimensions != ("time", "lat", "lon") or variable.shape != (1, 3600, 7200):
                return False, {}
            if not str(dataset.time_coverage_start).startswith(str(year)):
                return False, {}
            return True, {"fileBytes": path.stat().st_size, "product": str(dataset.id), "variable": variable.name}
    except (OSError, RuntimeError, KeyError, AttributeError):
        return False, {}


def _remote_length(url: str) -> int | None:
    request = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(request, timeout=60) as response:
        return int(response.headers["Content-Length"]) if response.headers.get("Content-Length") else None


def acquire(years: tuple[int, ...] = YEARS, output: Path = Path("data/.build/coral_heat_stress/global_annual_source")) -> list[dict]:
    if not years or len(set(years)) != len(years) or any(year < 2016 or year > 2025 for year in years):
        raise ValueError("This pilot acquires only the 2016–2025 NOAA annual DHW composites")
    output.mkdir(parents=True, exist_ok=True)
    results = []
    for year in years:
        name = _name(year)
        destination = output / name
        part = destination.with_suffix(destination.suffix + ".part")
        url = SOURCE_DIRECTORY + name
        expected = _remote_length(url)
        valid, detail = _validate(destination, year) if destination.exists() else (False, {})
        if valid and (expected is None or detail["fileBytes"] == expected):
            results.append({"year": year, "url": url, "status": "already-complete", **detail})
            continue
        if destination.exists() and not valid:
            destination.replace(part)
        offset = part.stat().st_size if part.exists() else 0
        if expected is not None and offset > expected:
            part.unlink()
            offset = 0
        headers = {"User-Agent": "DiveAtlas NOAA thermal history builder"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        request = urllib.request.Request(url, headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=120)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"NOAA download failed for {year}: HTTP {error.code}") from error
        with response:
            append = offset > 0 and response.status == 206 and response.headers.get("Content-Range", "").startswith(f"bytes {offset}-")
            mode = "ab" if append else "wb"
            with part.open(mode) as target:
                while chunk := response.read(1024 * 1024):
                    target.write(chunk)
        size = part.stat().st_size
        if expected is not None and size != expected:
            raise RuntimeError(f"NOAA file is incomplete for {year}: received {size} of {expected} bytes; rerun to resume")
        ok, detail = _validate(part, year)
        if not ok:
            raise RuntimeError(f"Downloaded NOAA NetCDF is invalid for {year}: {part}")
        part.replace(destination)
        manifest = {"year": year, "url": url, **detail, "contentLength": expected}
        destination.with_suffix(destination.suffix + ".source.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        results.append({"status": "downloaded", **manifest})
        print(f"{year}: {size:,} bytes, valid NetCDF", flush=True)
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--years", type=int, nargs="+", default=list(YEARS))
    parser.add_argument("--output", type=Path, default=Path("data/.build/coral_heat_stress/global_annual_source"))
    args = parser.parse_args()
    print(json.dumps(acquire(tuple(args.years), args.output), indent=2))


if __name__ == "__main__":
    main()
