"""Acquire monthly Copernicus ZSD source slices into the local build cache."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from build import DATASET_ID, ROOT, YEARS, MONTHS


def parse_bounds(value: str) -> tuple[float, float, float, float]:
    try:
        west, south, east, north = (float(part.strip()) for part in value.split(","))
    except Exception as error:
        raise argparse.ArgumentTypeError("bounds must be west,south,east,north") from error
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise argparse.ArgumentTypeError("bounds must describe a non-wrapping lon/lat box")
    return west, south, east, north


def acquire(output_dir: Path, years: tuple[int, ...], bounds: tuple[float, float, float, float] | None = None) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    for year in years:
        for month in MONTHS:
            date = f"{year}-{month:02d}-01"
            filename = f"{year}-{month:02d}.nc"
            output_path = output_dir / filename
            if output_path.is_file() and output_path.stat().st_size > 0:
                print(f"cached: {filename}", flush=True)
                continue
            command = [
                "copernicusmarine", "subset", "--dataset-id", DATASET_ID,
                "--variable", "ZSD", "--start-datetime", date,
                "--end-datetime", date, "--output-directory", str(output_dir),
                "--output-filename", filename,
            ]
            if bounds:
                west, south, east, north = bounds
                command += ["--minimum-longitude", str(west), "--maximum-longitude", str(east),
                            "--minimum-latitude", str(south), "--maximum-latitude", str(north)]
            print(f"acquiring: {filename}", flush=True)
            subprocess.run(command, check=True)
            if not output_path.is_file() or output_path.stat().st_size == 0:
                raise RuntimeError(f"Copernicus Marine completed without writing {output_path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data" / ".build" / "water_clarity" / "sources")
    parser.add_argument("--years", default="2016-2025", help="Inclusive year range such as 2016-2025")
    parser.add_argument("--bounds", type=parse_bounds, help="Optional test subset: west,south,east,north")
    args = parser.parse_args()
    try:
        first, last = (int(value) for value in args.years.split("-", 1))
        if first < 1997 or last > 2025 or first > last:
            raise ValueError("years must be an inclusive range within 1997-2025")
        acquire(args.output_dir, tuple(range(first, last + 1)), args.bounds)
    except FileNotFoundError as error:
        print("Copernicus Marine Toolbox CLI was not found. Install it, configure an account with `copernicusmarine login`, and retry.", file=sys.stderr)
        print(str(error), file=sys.stderr)
        return 1
    except Exception as error:
        print(f"water clarity acquisition failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
