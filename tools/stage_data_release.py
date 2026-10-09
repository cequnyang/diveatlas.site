#!/usr/bin/env python3
"""Stage browser data releases and checksum-verified manifest-only extensions."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

if __package__:
    from .prepare_pages import ROOT, R2_STARTUP_DATA_ASSETS, local_external_data_files
    from .r2_source_data import resolve_r2_source_file
else:
    from prepare_pages import ROOT, R2_STARTUP_DATA_ASSETS, local_external_data_files
    from r2_source_data import resolve_r2_source_file


RELEASES = ROOT / "data/.build/r2/releases"
RELEASE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
MANIFEST_NAME = "release-manifest.json"
R2_SOURCE_DATA_PATHS = (
    "data/coral_records_snapshot.js",
    "data/fish_map_units.json.gz",
)


def release_path_for_source(relative: Path) -> Path:
    """Keep runtime assets under data/, matching the app's R2 URL mapping."""
    if relative.parts and relative.parts[0] == "datasets":
        return Path("data", *relative.parts[1:])
    return relative


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


def selected_files(
    candidates: list[Path] | None = None,
    *,
    manifests_only: bool = False,
    temperature_metadata_only: bool = False,
    dive_site_catalog_only: bool = False,
    dive_site_search_assets_only: bool = False,
    environmental_query_only: bool = False,
) -> list[Path]:
    if dive_site_catalog_only:
        catalog = Path("datasets/dive-sites.js")
        return [catalog] if (ROOT / catalog).is_file() else []
    if dive_site_search_assets_only:
        sidecars = (
            Path("datasets/dive-site-search-locations.json.gz"),
            Path("datasets/dive-site-summaries.json.gz"),
        )
        return [path for path in sidecars if (ROOT / path).is_file()]
    if environmental_query_only:
        roots = (Path("data/temperature/query/v2"), Path("data/water_clarity/query/v2"))
        return sorted(path.relative_to(ROOT) for root in roots
                      for path in (ROOT / root).rglob("*") if path.is_file())
    if temperature_metadata_only:
        metadata = Path("datasets/temperature/metadata.json")
        return [metadata] if (ROOT / metadata).is_file() else []
    if manifests_only:
        return [path for path in R2_STARTUP_DATA_ASSETS if (ROOT / path).is_file()]
    # These two snapshots are sourced from the current R2 release, never from
    # local development copies or their former checked-in paths. Other data
    # remains sourced locally.
    selected = {
        relative for relative in (local_external_data_files() if candidates is None else candidates)
        if relative.as_posix() not in {
            "datasets/coral_records_snapshot.js",
            "datasets/fish_map_units.json.gz",
            *R2_SOURCE_DATA_PATHS,
        }
    }
    # Preserve the repository copies for development, but put release copies
    # alongside data payloads in R2.
    selected.update(path for path in R2_STARTUP_DATA_ASSETS if (ROOT / path).is_file())
    return sorted(selected)


def stage(
    release_id: str,
    destination_root: Path = RELEASES,
    source_data_asset_base_url: str | None = None,
    *,
    manifests_only: bool = False,
    temperature_metadata_only: bool = False,
    dive_site_catalog_only: bool = False,
    dive_site_search_assets_only: bool = False,
    environmental_query_only: bool = False,
) -> dict:
    if not RELEASE_ID_RE.fullmatch(release_id):
        raise ValueError("Release ID must be 1-64 letters, digits, dots, underscores, or hyphens and start with a letter or digit.")
    destination = (destination_root / release_id).resolve()
    if destination.exists():
        raise FileExistsError(f"Refusing to overwrite immutable data release: {destination}")
    if sum((manifests_only, temperature_metadata_only, dive_site_catalog_only,
            dive_site_search_assets_only, environmental_query_only)) > 1:
        raise ValueError("Choose only one R2 extension mode.")
    files = selected_files(
        manifests_only=manifests_only,
        temperature_metadata_only=temperature_metadata_only,
        dive_site_catalog_only=dive_site_catalog_only,
        dive_site_search_assets_only=dive_site_search_assets_only,
        environmental_query_only=environmental_query_only,
    )
    if not files:
        raise ValueError("No external production data files were found to stage.")

    destination.mkdir(parents=True)
    entries = []
    try:
        if dive_site_catalog_only:
            # R2 objects are immutable. Publish replacements under a new key
            # rather than overwriting the existing catalog in the active release.
            sources = [(Path("data/dive-sites-v3.js"), ROOT / "datasets/dive-sites.js")]
        elif dive_site_search_assets_only:
            # Keep sidecars versioned for long-lived cache headers in R2.
            sources = [
                (Path("data/dive-site-search-locations-v4.json.gz"), ROOT / "datasets/dive-site-search-locations.json.gz"),
                (Path("data/dive-site-summaries-v3.json.gz"), ROOT / "datasets/dive-site-summaries.json.gz"),
            ]
        else:
            sources = [(release_path_for_source(relative), ROOT / relative) for relative in files]
        if not manifests_only and not temperature_metadata_only and not dive_site_catalog_only and not dive_site_search_assets_only and not environmental_query_only:
            sources.extend(
                (Path(relative), resolve_r2_source_file(relative, source_data_asset_base_url))
                for relative in R2_SOURCE_DATA_PATHS
            )
        for release_relative, source in sources:
            target = destination / release_relative
            target.parent.mkdir(parents=True, exist_ok=True)
            byte_count, file_digest = copy_and_hash(source, target)
            entries.append({"path": release_relative.as_posix(), "bytes": byte_count, "sha256": file_digest})

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
    parser.add_argument("--release", required=True, help="release ID, for example 2026-10-05-v2")
    parser.add_argument("--releases-directory", type=Path, default=RELEASES)
    parser.add_argument(
        "--source-data-asset-base-url",
        default=None,
        help="existing immutable R2 release to copy the coral and fish snapshots from; defaults to SOURCE_DATA_ASSET_BASE_URL or DATA_ASSET_BASE_URL",
    )
    parser.add_argument(
        "--startup-data-only",
        "--manifests-only",
        dest="manifests_only",
        action="store_true",
        help="stage only the selected startup data assets for safe append to an existing release",
    )
    parser.add_argument(
        "--temperature-metadata-only",
        action="store_true",
        help="stage only the Temperature metadata for a safe additive update to an existing release",
    )
    parser.add_argument(
        "--dive-site-catalog-only",
        action="store_true",
        help="stage only the dive-site catalog for a safe additive update to an existing release",
    )
    parser.add_argument(
        "--dive-site-search-assets-only",
        action="store_true",
        help="stage only the compressed search and popup sidecars for a safe additive update to an existing release",
    )
    parser.add_argument(
        "--environmental-query-only",
        action="store_true",
        help="stage only the versioned v2 temperature and water-clarity query assets for additive review",
    )
    args = parser.parse_args()
    print(json.dumps(stage(args.release, args.releases_directory, args.source_data_asset_base_url,
                           manifests_only=args.manifests_only,
                           temperature_metadata_only=args.temperature_metadata_only,
                           dive_site_catalog_only=args.dive_site_catalog_only,
                           dive_site_search_assets_only=args.dive_site_search_assets_only,
                           environmental_query_only=args.environmental_query_only), indent=2))


if __name__ == "__main__":
    main()
