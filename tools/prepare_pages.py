#!/usr/bin/env python3
"""Validate local index references and assemble the static GitHub Pages artifact."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_PARTS = {
    ".git",
    ".github",
    "docs",
    "node_modules",
    "tests",
    "tools",
    "__pycache__",
    "artifacts",
    "reports",
    "analysis",
}
EXCLUDED_FILES = {
    ".gitignore",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "DESIGN.md",
    "README.md",
    "package.json",
    "package-lock.json",
    "playwright.config.js",
    "coral-heat-stress-view.js",
    "coral-heat-history-view.js",
    "coral-heat-stress-style.js",
    "reef-condition-seaview-local.js",
    "reef-condition-local-research.js",
    "reef-condition-phase4-6-local.js",
    "reef-survey-evidence-view.js",
    "reef-condition-benthic-evidence.js",
    "reef-survey-evidence-coverage.geojson.gz",
    "reef-survey-evidence-coverage-metadata.json",
}
EXCLUDED_PATH_PREFIXES = {
    Path("data/.build"),
    Path("data/coral-heat-stress"),
    Path("data/reef-condition/seaview"),
    # Retired from Reef Condition; ignore stale local bundles during Pages assembly.
    Path("data/reef-condition/historical-benthic"),
    # The app reads the active 0.25-degree WOA profile from metadata; this
    # 1-degree profile is retained for development comparisons only.
    Path("data/temperature/development-1deg"),
}
MHW_PRODUCTION_ROOT = Path("data/reef-condition/ocean-heat-history")
TIDE_DATA_ROOT = Path("data/tides")
TIDE_DEPLOYMENT_CONFIG = Path("js/tides/deployment-config.js")
EXTERNAL_DATA_ROOTS = {
    Path("data/bathymetry_tiles"),
    # Local builds bundle these ignored working copies; production builds omit
    # them because DATA_ASSET_BASE_URL routes requests to the R2 release.
    Path("data/coral_records_snapshot.js"),
    Path("data/coral_occurrence_chunks"),
    Path("data/currents"),
    Path("data/depth_contour_tiles"),
    Path("data/depth_samples"),
    Path("data/dive-experience-outlook/v3"),
    Path("datasets/dive-sites.js"),
    Path("data/fish_map_units.json.gz"),
    Path("data/reef_tiles"),
    Path("data/reef_vector_chunks"),
    Path("data/temperature/production-0.25deg"),
    Path("data/temperature/query"),
    Path("data/terrain_tiles"),
    Path("data/tides"),
    Path("data/water_clarity"),
    Path("data/waves"),
    Path("data/reef-condition/thermal-stress-history"),
    Path("data/reef-condition/ocean-heat-history"),
}


def is_curated_ocean_heat_asset(relative: Path) -> bool:
    """Limit Pages to the one metadata, tile, and query layout the app reads."""
    if relative == MHW_PRODUCTION_ROOT / "metadata.json":
        return True
    try:
        parts = relative.relative_to(MHW_PRODUCTION_ROOT).parts
    except ValueError:
        return False
    if len(parts) == 4 and parts[0] == "tiles" and parts[3].endswith(".png"):
        try:
            zoom, column, row = int(parts[1]), int(parts[2]), int(Path(parts[3]).stem)
        except ValueError:
            return False
        return 0 <= zoom <= 5 and 0 <= column < 2**zoom and 0 <= row < 2**zoom and Path(parts[3]).suffix == ".png"
    if len(parts) == 2 and parts[0] == "query" and parts[1].endswith(".bin.gz"):
        stem = parts[1][:-7]
        try:
            column, row = (int(value) for value in stem.split("_"))
        except (ValueError, TypeError):
            return False
        return column >= 0 and row >= 0
    return False


def is_excluded_path(relative: Path) -> bool:
    return any(relative == prefix or prefix in relative.parents for prefix in EXCLUDED_PATH_PREFIXES)


def is_tide_data_path(relative: Path) -> bool:
    return relative == TIDE_DATA_ROOT or TIDE_DATA_ROOT in relative.parents


def normalize_tide_asset_base_url(value: str | None) -> str | None:
    """Validate the deployment-owned, cross-origin root for the versioned Tide release."""
    if value is None or not value.strip():
        return None
    value = value.strip()
    parsed = urlsplit(value)
    if parsed.scheme not in {"https", "http"} or not parsed.netloc:
        raise ValueError("TIDE_ASSET_BASE_URL must be an absolute HTTPS URL; HTTP is allowed only on loopback for local prototypes.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("TIDE_ASSET_BASE_URL cannot include credentials, a query, or a fragment.")
    loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not loopback:
        raise ValueError("Cross-origin Tide assets must use HTTPS (HTTP is allowed only on loopback for local development).")
    path = parsed.path or "/"
    if not path.endswith("/"):
        path += "/"
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def normalize_data_asset_base_url(value: str | None) -> str | None:
    """Validate the production root for versioned browser-loaded data."""
    if value is None or not value.strip():
        return None
    value = value.strip()
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("DATA_ASSET_BASE_URL must be an absolute HTTPS URL.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("DATA_ASSET_BASE_URL cannot include credentials, a query, or a fragment.")
    path = parsed.path or "/"
    if not path.endswith("/"):
        path += "/"
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def is_external_data_path(relative: Path) -> bool:
    return any(relative == root or root in relative.parents for root in EXTERNAL_DATA_ROOTS)


def local_external_data_files() -> list[Path]:
    """Enumerate local runtime payloads independently of Git tracking or ignore rules."""
    files: set[Path] = set()
    for root in EXTERNAL_DATA_ROOTS:
        source = ROOT / root
        if source.is_file():
            candidates = [source]
        elif source.is_dir():
            candidates = source.rglob("*")
        else:
            continue
        for candidate in candidates:
            if not candidate.is_file() or any(part.startswith(".") for part in candidate.relative_to(ROOT).parts):
                continue
            relative = candidate.relative_to(ROOT)
            if root == MHW_PRODUCTION_ROOT or MHW_PRODUCTION_ROOT in root.parents:
                if not is_curated_ocean_heat_asset(relative):
                    continue
            files.add(relative)
    return sorted(files)


class LocalReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        for name in ("href", "src"):
            value = values.get(name)
            if value:
                self.references.append(value)


def tracked_and_untracked_site_files(*, externalize_tides: bool = False, externalize_data: bool = False) -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
    )
    paths = []
    for raw in result.stdout.split(b"\0"):
        if not raw:
            continue
        relative = Path(raw.decode("utf-8"))
        if externalize_data and (is_external_data_path(relative) or is_tide_data_path(relative)):
            continue
        if externalize_tides and is_tide_data_path(relative):
            continue
        if relative == TIDE_DEPLOYMENT_CONFIG:
            continue
        if relative == Path("js/data-assets-config.js"):
            continue
        if any(part in EXCLUDED_PARTS for part in relative.parts):
            continue
        if (relative == MHW_PRODUCTION_ROOT or MHW_PRODUCTION_ROOT in relative.parents) and not is_curated_ocean_heat_asset(relative):
            continue
        if is_excluded_path(relative):
            continue
        if relative.name in EXCLUDED_FILES or relative.name.startswith(".codex"):
            continue
        source = ROOT / relative
        if source.is_file():
            paths.append(relative)
    if not externalize_data:
        paths.extend(path for path in local_external_data_files() if path not in paths)
    return paths


def validate_index(output: Path) -> None:
    index = output / "index.html"
    if not index.is_file():
        raise SystemExit("Static artifact is missing index.html")
    parser = LocalReferenceParser()
    parser.feed(index.read_text(encoding="utf-8"))
    missing = []
    for reference in parser.references:
        parsed = urlsplit(reference)
        if parsed.scheme or parsed.netloc or reference.startswith(("#", "data:")):
            continue
        local_path = (output / parsed.path.lstrip("/")).resolve()
        if output.resolve() not in local_path.parents and local_path != output.resolve():
            missing.append(reference)
        elif not local_path.exists():
            missing.append(reference)
    if missing:
        raise SystemExit("Static artifact has missing local references: " + ", ".join(missing[:20]))


def normalize_app_version(value: str | None) -> str:
    if value is None:
        # Local builds follow the latest deployed tag; package.json is the initial version baseline.
        tags = subprocess.run(
            ["git", "tag", "--list", "v[0-9]*", "--sort=-version:refname"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()
        if tags:
            value = tags[0].removeprefix("v")
        else:
            package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
            value = str(package.get("version", ""))
    version = value.strip().removeprefix("v")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("APP_VERSION must be a semantic version in major.minor.patch form.")
    return version


def render_app_version(index_path: Path, version: str) -> None:
    """Write the release version into the menu label in the deployable copy."""
    index = index_path.read_text(encoding="utf-8")
    pattern = re.compile(
        r'(<div class="top-menu-version" data-version=")[^"]+'
        r'(" aria-label="DiveAtlas version )[^"]+(">)v[^<]*(</div>)'
    )
    rendered, replacements = pattern.subn(
        rf'\g<1>{version}\g<2>{version}\g<3>v{version}\g<4>',
        index,
    )
    if replacements != 1:
        raise SystemExit("Expected exactly one top-menu version label in index.html")
    index_path.write_text(rendered, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="_site", help="artifact folder (default: _site)")
    parser.add_argument(
        "--tide-asset-base-url",
        default=os.environ.get("TIDE_ASSET_BASE_URL"),
        help="deployment-owned HTTPS root for externally hosted Tide data; omit to bundle local Tide assets",
    )
    parser.add_argument(
        "--data-asset-base-url",
        default=os.environ.get("DATA_ASSET_BASE_URL"),
        help="deployment-owned HTTPS root for all versioned browser data; omit to bundle app-relative data",
    )
    parser.add_argument(
        "--app-version",
        default=os.environ.get("APP_VERSION"),
        help="version displayed in the top menu (defaults to package.json)",
    )
    parser.add_argument(
        "--skip-external-data",
        action="store_true",
        help="omit the large local data payloads for a lightweight, local-only preview (not a deployable build)",
    )
    args = parser.parse_args()

    try:
        tide_asset_base_url = normalize_tide_asset_base_url(args.tide_asset_base_url)
        data_asset_base_url = normalize_data_asset_base_url(args.data_asset_base_url)
        app_version = normalize_app_version(args.app_version)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    if data_asset_base_url and not tide_asset_base_url:
        tide_asset_base_url = urlsplit(data_asset_base_url)._replace(
            path=f"{urlsplit(data_asset_base_url).path}data/tides/"
        ).geturl()

    output = (ROOT / args.output).resolve()
    if output.parent != ROOT or output.name != "_site":
        raise SystemExit("The build output must be the repository's _site directory")

    started_at = time.perf_counter()
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    selection_started = time.perf_counter()
    paths = tracked_and_untracked_site_files(
        externalize_tides=args.skip_external_data or tide_asset_base_url is not None or data_asset_base_url is not None,
        externalize_data=args.skip_external_data or data_asset_base_url is not None,
    )
    selection_seconds = time.perf_counter() - selection_started
    copy_started = time.perf_counter()
    total_bytes = 0
    for relative in paths:
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, destination)
        total_bytes += destination.stat().st_size

    render_app_version(output / "index.html", app_version)
    copy_seconds = time.perf_counter() - copy_started

    deployment_config = output / TIDE_DEPLOYMENT_CONFIG
    deployment_config.parent.mkdir(parents=True, exist_ok=True)
    deployment_config.write_text(
        "// Generated by tools/prepare_pages.py; set only through deployment configuration.\n"
        f"export const TIDE_ASSET_BASE_URL = {json.dumps(tide_asset_base_url)};\n",
        encoding="utf-8",
    )
    total_bytes += deployment_config.stat().st_size

    data_assets_config = output / Path("js/data-assets-config.js")
    data_assets_config.write_text(
        "// Generated by tools/prepare_pages.py; set only through deployment configuration.\n"
        f"window.DIVEATLAS_DATA_ASSET_BASE_URL = {json.dumps(data_asset_base_url)};\n",
        encoding="utf-8",
    )
    total_bytes += data_assets_config.stat().st_size
    data_assets_runtime = output / Path("js/data-assets.js")
    total_bytes += data_assets_runtime.stat().st_size

    validation_started = time.perf_counter()
    validate_index(output)
    validation_seconds = time.perf_counter() - validation_started
    print(
        f"Static site artifact ready: {len(paths) + 2:,} files, {total_bytes:,} bytes "
        f"({total_bytes / 1_000_000:.1f} MB) at {output}; "
        f"selection {selection_seconds:.1f}s, copy {copy_seconds:.1f}s, "
        f"validation {validation_seconds:.1f}s, total {time.perf_counter() - started_at:.1f}s; "
        f"Tide mode {'omitted (local preview)' if args.skip_external_data else 'external' if tide_asset_base_url else 'bundled'}; "
        f"data mode {'omitted (local preview)' if args.skip_external_data else 'external' if data_asset_base_url else 'bundled'}"
    )


if __name__ == "__main__":
    main()
