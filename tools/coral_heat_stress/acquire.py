"""Download the latest common NOAA CRW v3.1 BAA, HotSpot, and DHW NetCDF files."""

from __future__ import annotations

import argparse
import re
import urllib.request
from datetime import date, timedelta
from pathlib import Path


BASE_URL = "https://www.star.nesdis.noaa.gov/pub/socd/mecb/crw/data/5km/v3.1_op/nc/v1.0/daily"
PRODUCTS = {
    "baa5-max-7d": "ct5km_baa5-max-7d_v3.1_",
    "hs": "ct5km_hs_v3.1_",
    "dhw": "ct5km_dhw_v3.1_",
}
FILE_DATE = re.compile(r"(\d{8})\.nc$")


def available_dates(product: str, year: int) -> set[date]:
    url = f"{BASE_URL}/{product}/{year}/"
    with urllib.request.urlopen(url, timeout=60) as response:
        page = response.read().decode("utf-8", errors="replace")
    prefix = PRODUCTS[product]
    found = set()
    for name in re.findall(r'href="([^"]+)"', page):
        if not name.startswith(prefix):
            continue
        match = FILE_DATE.search(name)
        if match:
            found.add(date.fromisoformat(f"{match.group(1)[:4]}-{match.group(1)[4:6]}-{match.group(1)[6:]}"))
    return found


def acquire(output: Path, *, force: bool = False) -> list[Path]:
    today = date.today()
    years = range(today.year - 1, today.year + 1)
    catalogues = {product: set().union(*(available_dates(product, year) for year in years)) for product in PRODUCTS}
    common = catalogues["baa5-max-7d"] & catalogues["hs"] & catalogues["dhw"]
    latest = max(common)
    window = [latest - timedelta(days=offset) for offset in range(6, -1, -1)]
    if not set(window) <= catalogues["hs"] or not set(window) <= catalogues["dhw"]:
        raise RuntimeError(f"NOAA source files do not provide seven consecutive days ending {latest}")
    output.mkdir(parents=True, exist_ok=True)
    paths = []
    downloads = [("baa5-max-7d", latest)] + [(product, day) for day in window for product in ("hs", "dhw")]
    for product, day in downloads:
        key = day.strftime("%Y%m%d")
        name = f"{PRODUCTS[product]}{key}.nc"
        target = output / name
        if target.exists() and not force and target.stat().st_size:
            paths.append(target)
            continue
        url = f"{BASE_URL}/{product}/{day.year}/{name}"
        temporary = target.with_suffix(target.suffix + ".part")
        request = urllib.request.Request(url, headers={"User-Agent": "DiveAtlas static data builder"})
        with urllib.request.urlopen(request, timeout=180) as response, temporary.open("wb") as stream:
            while chunk := response.read(1024 * 1024):
                stream.write(chunk)
        if not temporary.is_file() or temporary.stat().st_size == 0:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f"NOAA download is empty: {url}")
        temporary.replace(target)
        paths.append(target)
        print(f"Downloaded {name} ({target.stat().st_size:,} bytes)")
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("data/.build/coral_heat_stress/source"))
    parser.add_argument("--force", action="store_true", help="redownload source files even when cached")
    args = parser.parse_args()
    files = acquire(args.output_dir, force=args.force)
    print(f"Acquired {len(files)} NOAA files in {args.output_dir}")


if __name__ == "__main__":
    main()
