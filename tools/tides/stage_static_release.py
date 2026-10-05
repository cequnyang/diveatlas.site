#!/usr/bin/env python3
"""Create an immutable, checksummed Tide release for a separate static origin."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data/tides"
RELEASES = ROOT / "data/.build/tides/phase4-10/releases"
FAMILIES = ("eot20-v1", "eot20-viz-v1", "timezones-2026d")
RELEASE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def family_summary(name: str, manifest: dict, files: list[dict]) -> dict:
    digest = hashlib.sha256()
    for item in files:
        line = f"{item['path']}\0{item['bytes']}\0{item['sha256']}\n".encode("utf-8")
        digest.update(line)
    result = {
        "version": manifest.get("version"),
        "fileCount": len(files),
        "totalBytes": sum(item["bytes"] for item in files),
        "inventorySha256": digest.hexdigest(),
    }
    for key in ("model", "productVersion", "gridResolutionDegrees", "tileDegrees", "chunkCount", "assetCount", "publishedBytes", "sourceGrid", "validity"):
        if key in manifest:
            result[key] = manifest[key]
    return result


def build_manifest(source: Path, release_id: str, generated_at: str) -> dict:
    files: list[dict] = []
    families: dict[str, dict] = {}
    for family in FAMILIES:
        family_root = source / family
        source_manifest = family_root / "manifest.json"
        if not source_manifest.is_file():
            raise ValueError(f"Tide release is incomplete: missing {family}/manifest.json")
        metadata = json.loads(source_manifest.read_text(encoding="utf-8"))
        family_files = []
        for path in sorted(family_root.rglob("*")):
            if path.is_symlink():
                raise ValueError(f"Tide release cannot contain symlinks: {path.relative_to(source)}")
            if not path.is_file():
                continue
            relative = f"tides/{path.relative_to(source).as_posix()}"
            item = {"path": relative, "bytes": path.stat().st_size, "sha256": sha256_file(path)}
            files.append(item)
            family_files.append(item)
        families[family] = family_summary(family, metadata, family_files)

    inventory = hashlib.sha256()
    for item in files:
        inventory.update(f"{item['path']}\0{item['bytes']}\0{item['sha256']}\n".encode("utf-8"))

    eot_manifest = json.loads((source / "eot20-v1/manifest.json").read_text(encoding="utf-8"))
    tz_manifest = json.loads((source / "timezones-2026d/manifest.json").read_text(encoding="utf-8"))
    return {
        "format": "diveatlas-tide-static-release",
        "schemaVersion": 1,
        "release": release_id,
        "generatedAt": generated_at,
        "basePath": "tides/",
        "cacheControl": "public, max-age=31536000, immutable",
        "cors": {"methods": ["GET"], "credentials": False, "origin": "deployment-configured exact DiveAtlas origin"},
        "fileCount": len(files),
        "totalBytes": sum(item["bytes"] for item in files),
        "inventorySha256": inventory.hexdigest(),
        "assetFamilies": families,
        "sourceCoverage": {
            "eot20GridResolutionDegrees": eot_manifest.get("gridResolutionDegrees"),
            "eot20SourceGrid": eot_manifest.get("sourceGrid"),
            "eot20TimeMetadata": eot_manifest.get("timeRange", eot_manifest.get("time")),
            "timezoneVersion": tz_manifest.get("version"),
        },
        "files": files,
    }


def verify_release(release_root: Path) -> dict:
    manifest_path = release_root / "release-manifest.json"
    if not manifest_path.is_file():
        raise ValueError("Staged release is missing release-manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format") != "diveatlas-tide-static-release" or manifest.get("schemaVersion") != 1:
        raise ValueError("Unsupported Tide release manifest")
    listed = manifest.get("files")
    if not isinstance(listed, list) or not listed:
        raise ValueError("Tide release manifest has no file inventory")
    expected: dict[str, dict] = {}
    aggregate = hashlib.sha256()
    for item in listed:
        relative = item.get("path")
        if not isinstance(relative, str) or relative.startswith("/") or ".." in Path(relative).parts or "\\" in relative:
            raise ValueError("Tide release manifest contains an unsafe asset path")
        if relative in expected:
            raise ValueError(f"Duplicate Tide release manifest path: {relative}")
        expected[relative] = item
        aggregate.update(f"{relative}\0{item.get('bytes')}\0{item.get('sha256')}\n".encode("utf-8"))
        path = release_root / Path(relative)
        if not path.is_file() or path.stat().st_size != item.get("bytes") or sha256_file(path) != item.get("sha256"):
            raise ValueError(f"Staged Tide asset is missing or failed integrity validation: {relative}")
    actual = {path.relative_to(release_root / "tides").as_posix() for path in (release_root / "tides").rglob("*") if path.is_file()}
    expected_local = {Path(path).relative_to("tides").as_posix() for path in expected}
    if actual != expected_local:
        raise ValueError("Staged Tide file set differs from its release manifest")
    if len(listed) != manifest.get("fileCount") or sum(item["bytes"] for item in listed) != manifest.get("totalBytes") or aggregate.hexdigest() != manifest.get("inventorySha256"):
        raise ValueError("Tide release aggregate inventory does not match its manifest")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True, help="immutable URL-safe release id, for example 2026-10-03")
    parser.add_argument("--source", type=Path, default=SOURCE, help="Tide asset tree containing the three versioned families")
    parser.add_argument("--releases-directory", type=Path, default=RELEASES)
    args = parser.parse_args()
    if not RELEASE_ID_RE.fullmatch(args.release):
        raise SystemExit("--release must contain 1-64 letters, digits, dots, underscores, or hyphens and start with a letter or digit")
    source = args.source.resolve()
    target = (args.releases_directory / args.release).resolve()
    if not source.is_dir():
        raise SystemExit(f"Tide assets do not exist: {source}")
    if target.exists():
        raise SystemExit(f"Refusing to overwrite immutable staged release: {target}")
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    try:
        manifest = build_manifest(source, args.release, generated_at)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        raise SystemExit(str(error)) from error

    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        (target / "tides").parent.mkdir(parents=True, exist_ok=False)
        shutil.copytree(source, target / "tides", symlinks=True)
        (target / "release-manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        headers = "\n".join(
            f"/tides/{family}/*\n  Cache-Control: public, max-age=31536000, immutable\n" for family in FAMILIES
        )
        (target / "_headers-example.txt").write_text(
            "# Reference only. Object stores do not consume this file; use object metadata for cache control.\n" + headers,
            encoding="utf-8",
        )
        verified = verify_release(target)
    except Exception:
        shutil.rmtree(target, ignore_errors=True)
        raise

    output = {
        "release": verified["release"],
        "releaseDirectory": str(target),
        "manifestSha256": sha256_file(target / "release-manifest.json"),
        "fileCount": verified["fileCount"],
        "totalBytes": verified["totalBytes"],
        "inventorySha256": verified["inventorySha256"],
        "familySummaries": verified["assetFamilies"],
        "localIntegrityVerified": True,
        "uploaded": False,
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
