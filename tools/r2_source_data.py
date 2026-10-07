"""Fetch checksum-verified source assets from the published R2 release."""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_CONFIG_URL = "https://diveatlas.site/js/data-assets-config.js"
SOURCE_PATHS = {
    "data/coral_records_snapshot.js",
    "data/fish_map_units.json.gz",
    "data/bathymetry_manifest.js",
    "data/coral_occurrence_manifest.js",
    "data/reef_raster_manifest.js",
    "data/reef_vector_manifest.js",
    "data/terrain_manifest.js",
    "data/temperature/metadata.json",
}
CONFIG_PATTERN = re.compile(r'^window\.DIVEATLAS_DATA_ASSET_BASE_URL = "([^"\r\n]+)";$', re.MULTILINE)


def _read_url(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "DiveAtlas-R2-source/1"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    except urllib.error.URLError as error:
        raise RuntimeError(f"Could not read DiveAtlas R2 source {url}: {error}") from error


def _asset_base_url(override: str | None = None) -> str:
    configured = override or os.environ.get("SOURCE_DATA_ASSET_BASE_URL") or os.environ.get("DATA_ASSET_BASE_URL")
    if not configured:
        local_config = ROOT / "_site/js/data-assets-config.js"
        if local_config.is_file():
            match = CONFIG_PATTERN.search(local_config.read_text(encoding="utf-8"))
            configured = match.group(1) if match else None
    if not configured:
        match = CONFIG_PATTERN.search(_read_url(PRODUCTION_CONFIG_URL).decode("utf-8"))
        configured = match.group(1) if match else None
    if not configured:
        raise RuntimeError("Could not find the current R2 release URL in DATA_ASSET_BASE_URL or the deployed site config.")

    parsed = urlsplit(configured)
    if (parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.query or
            parsed.fragment or not parsed.path.endswith("/")):
        raise ValueError("The R2 source URL must be an HTTPS release URL ending in '/'.")
    return configured


def resolve_r2_source_file(path: str, base_url: str | None = None) -> Path:
    """Return a checksum-verified local cache copy of a canonical R2 snapshot."""
    if path not in SOURCE_PATHS:
        raise ValueError(f"Unsupported R2 source asset path: {path}")
    base_url = _asset_base_url(base_url)
    release_id = urlsplit(base_url).path.rstrip("/").rsplit("/", 1)[-1]
    cache_root = ROOT / "data/.build/r2/source-cache" / release_id
    manifest_cache = cache_root / "release-manifest.json"
    # Release inventories may be appended in place; fetch a fresh copy instead
    # of trusting the old local cache or a CDN response cached as immutable.
    manifest_bytes = _read_url(base_url + f"release-manifest.json?cacheBust={time.time_ns()}")
    cache_root.mkdir(parents=True, exist_ok=True)
    temporary_manifest = manifest_cache.with_suffix(".json.tmp")
    temporary_manifest.write_bytes(manifest_bytes)
    temporary_manifest.replace(manifest_cache)
    manifest = json.loads(manifest_bytes)
    if manifest.get("format") != "diveatlas-browser-data-release" or manifest.get("schemaVersion") != 1:
        raise ValueError("The configured R2 source does not contain a supported release manifest.")
    entry = next((item for item in manifest.get("files", []) if item.get("path") == path), None)
    if not entry:
        raise ValueError(f"R2 release {release_id} does not contain {path}.")

    cache_path = cache_root / path
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    def matches(path_to_check: Path) -> bool:
        if not path_to_check.is_file() or path_to_check.stat().st_size != entry.get("bytes"):
            return False
        digest = hashlib.sha256(path_to_check.read_bytes()).hexdigest()
        return digest == entry.get("sha256")

    if matches(cache_path):
        return cache_path

    payload = _read_url(base_url + path)
    if len(payload) != entry.get("bytes") or hashlib.sha256(payload).hexdigest() != entry.get("sha256"):
        raise ValueError(f"R2 source failed its release-manifest checksum: {path}")
    temporary = cache_path.with_suffix(cache_path.suffix + ".tmp")
    temporary.write_bytes(payload)
    temporary.replace(cache_path)
    return cache_path
