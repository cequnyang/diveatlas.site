"""Fetch the official EOT20 archive from SEANOE and extract ocean constituents."""

from __future__ import annotations

import hashlib
import json
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data/.build/tides/source"
URL = "https://www.seanoe.org/data/00683/79489/data/85762.zip"
EXPECTED_SHA256 = "bced7af7eb7c34896d4fd04680a751cc9f5a4c7a3c03852997d9263d61e07018"


def fetch() -> dict:
    SOURCE.mkdir(parents=True, exist_ok=True)
    archive = SOURCE / "85762.zip"
    if not archive.exists():
        request = urllib.request.Request(URL, headers={"User-Agent": "DiveAtlas EOT20 build/1.0"})
        with urllib.request.urlopen(request, timeout=120) as response, archive.open("wb") as output:
            while block := response.read(1024 * 1024):
                output.write(block)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if EXPECTED_SHA256 and digest != EXPECTED_SHA256:
        raise ValueError(f"EOT20 source SHA-256 mismatch: {digest}")
    with zipfile.ZipFile(archive) as outer:
        bad = outer.testzip()
        if bad:
            raise ValueError(f"Corrupt member in official archive: {bad}")
        member = next((name for name in outer.namelist() if name.endswith("ocean_tides.zip")), None)
        if not member:
            raise ValueError("Official archive does not include ocean_tides.zip")
        ocean_zip = SOURCE / "ocean_tides.zip"
        if not ocean_zip.exists():
            with outer.open(member) as source, ocean_zip.open("wb") as output:
                while block := source.read(1024 * 1024):
                    output.write(block)
    destination = SOURCE / "EOT20/ocean_tides"
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ocean_zip) as inner:
        bad = inner.testzip()
        if bad:
            raise ValueError(f"Corrupt ocean member in official archive: {bad}")
        for name in inner.namelist():
            if name.lower().endswith(".nc") and not Path(name).name.startswith("._"):
                target = destination / Path(name).name
                if not target.exists():
                    with inner.open(name) as source, target.open("wb") as output:
                        while block := source.read(1024 * 1024):
                            output.write(block)
    report = {
        "source_url": URL,
        "archive": archive.name,
        "bytes": archive.stat().st_size,
        "sha256": digest,
        "downloaded_at_utc": datetime.fromtimestamp(archive.stat().st_mtime, timezone.utc).isoformat(),
        "ocean_archive": ocean_zip.name,
        "netcdf_files": sorted(path.name for path in destination.glob("*.nc") if not path.name.startswith("._")),
    }
    (SOURCE / "fetch-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    fetch()
