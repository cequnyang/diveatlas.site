#!/usr/bin/env python3
"""Stage the browser-served datasets as a verified, immutable R2 release."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from prepare_pages import ROOT, local_external_data_files


RELEASES = ROOT / "data/.build/r2/releases"
RELEASE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
MANIFEST_NAME = "release-manifest.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy_and_hash(source: Path, target: Path) -> tuple[int, str]:
    """Hash the exact bytes written while copying, avoiding repeated large reads."""
    digest = hashlib.sha256()
    byte_count = 0
    with source.open("rb") as input_stream, target.open("wb") as output_stream:
        for chunk in iter(lambda: input_stream.read(1024 * 1024), b""):
            output_stream.write(chunk)
            digest.update(chunk)
            byte_count += len(chunk)
    shutil.copystat(source, target)
    return byte_count, digest.hexdigest()


def selected_files() -> list[Path]:
    return local_external_data_files()


def stage(release_id: str, destination_root: Path = RELEASES) -> dict:
    if not RELEASE_ID_RE.fullmatch(release_id):
        raise ValueError("Release ID must be 1-64 letters, digits, dots, underscores, or hyphens and start with a letter or digit.")
    destination = (destination_root / release_id).resolve()
    if destination.exists():
        raise FileExistsError(f"Refusing to overwrite immutable data release: {destination}")
    files = selected_files()
    if not files:
        raise ValueError("No external production data files were found to stage.")

    destination.mkdir(parents=True)
    entries = []
    try:
        for relative in files:
            source = ROOT / relative
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            byte_count, file_digest = copy_and_hash(source, target)
            entries.append({"path": relative.as_posix(), "bytes": byte_count, "sha256": file_digest})

        inventory = hashlib.sha256()
        for item in entries:
            inventory.update(f"{item['path']}\0{item['bytes']}\0{item['sha256']}\n".encode("utf-8"))
        manifest = {
            "format": "diveatlas-browser-data-release",
            "schemaVersion": 1,
            "release": release_id,
            "createdAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "fileCount": len(entries),
            "totalBytes": sum(item["bytes"] for item in entries),
            "inventorySha256": inventory.hexdigest(),
            "files": entries,
        }
        (destination / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return {"releaseDirectory": str(destination), "fileCount": len(entries), "totalBytes": manifest["totalBytes"], "inventorySha256": manifest["inventorySha256"]}
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise


def verify_release(release_root: Path) -> dict:
    manifest_path = release_root / MANIFEST_NAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format") != "diveatlas-browser-data-release" or manifest.get("schemaVersion") != 1:
        raise ValueError("Unsupported R2 data release manifest.")
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        raise ValueError("R2 data release has no files.")
    inventory = hashlib.sha256()
    expected = set()
    for item in entries:
        relative = item.get("path", "")
        path = Path(relative)
        if not relative.startswith("data/") or path.is_absolute() or ".." in path.parts or "\\" in relative or relative in expected:
            raise ValueError(f"Unsafe or duplicate R2 release path: {relative}")
        expected.add(relative)
        target = release_root / path
        if not target.is_file() or target.stat().st_size != item.get("bytes") or sha256_file(target) != item.get("sha256"):
            raise ValueError(f"Staged R2 object is missing or failed its SHA-256 check: {relative}")
        inventory.update(f"{relative}\0{item['bytes']}\0{item['sha256']}\n".encode("utf-8"))
    actual = {path.relative_to(release_root).as_posix() for path in release_root.rglob("*") if path.is_file() and path.name != MANIFEST_NAME}
    if actual != expected or len(entries) != manifest.get("fileCount") or sum(item["bytes"] for item in entries) != manifest.get("totalBytes") or inventory.hexdigest() != manifest.get("inventorySha256"):
        raise ValueError("R2 data release inventory is incomplete or inconsistent.")
    package = release_root / "data/dive-experience-outlook/v3"
    if package.is_dir():
        try:
            from verify_pages_build import verify_dive_experience_assets
        except ImportError:
            import sys
            sys.path.insert(0, str(ROOT / "tools"))
            from verify_pages_build import verify_dive_experience_assets
        verify_dive_experience_assets(release_root)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True, help="immutable release ID, for example 2026-10-05")
    parser.add_argument("--releases-directory", type=Path, default=RELEASES)
    args = parser.parse_args()
    print(json.dumps(stage(args.release, args.releases_directory), indent=2))


if __name__ == "__main__":
    main()
