#!/usr/bin/env python3
"""Verify the public R2 manifest, sample assets, caching, and exact-origin CORS."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit


REQUIRED_STARTUP_DATA = (
    "data/bathymetry_manifest.js",
    "data/coral_occurrence_manifest.js",
    "data/reef_raster_manifest.js",
    "data/reef_vector_manifest.js",
    "data/terrain_manifest.js",
    "data/temperature/metadata.json",
)


def get(url: str, origin: str) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(url, headers={"Origin": origin, "User-Agent": "DiveAtlas-release-check/1"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, {key.lower(): value for key, value in response.headers.items()}, response.read()
    except urllib.error.HTTPError as error:
        return error.code, {key.lower(): value for key, value in error.headers.items()}, error.read()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset-base-url", required=True, help="Public immutable release URL ending in /releases/<id>/")
    parser.add_argument("--app-origin", required=True, help="Exact HTTPS origin of the deployed app")
    parser.add_argument(
        "--startup-assets-only",
        "--startup-manifests-only",
        dest="startup_assets_only",
        action="store_true",
        help="Verify only the release inventory and the data assets required by startup layers",
    )
    args = parser.parse_args()
    base = args.asset_base_url
    origin = args.app_origin.rstrip("/")
    parsed_base, parsed_origin = urlsplit(base), urlsplit(origin)
    if (parsed_base.scheme != "https" or not parsed_base.netloc or parsed_base.query or parsed_base.fragment or
            not parsed_base.path.endswith("/") or parsed_origin.scheme != "https" or not parsed_origin.netloc or
            parsed_origin.path or parsed_origin.query or parsed_origin.fragment):
        raise SystemExit("Asset base and app origin must be valid HTTPS URLs; the asset base must end in '/'.")

    # The release inventory can now be extended in place. A unique query avoids
    # stale copies left by the former one-year immutable cache policy.
    status, headers, body = get(base + f"release-manifest.json?cacheBust={time.time_ns()}", origin)
    if status != 200:
        raise SystemExit(f"Public release manifest returned HTTP {status}.")
    if headers.get("access-control-allow-origin") != origin:
        raise SystemExit("R2 CORS did not allow the exact app origin.")
    manifest = json.loads(body)
    if manifest.get("format") != "diveatlas-browser-data-release" or manifest.get("schemaVersion") != 1:
        raise SystemExit("Public release manifest has an unsupported format.")
    files = manifest.get("files", [])
    if not files:
        raise SystemExit("Public release manifest contains no data files.")
    inventory = hashlib.sha256()
    seen_paths = set()
    for item in files:
        path = item.get("path")
        if not isinstance(path, str) or path in seen_paths or not isinstance(item.get("bytes"), int) or not isinstance(item.get("sha256"), str):
            raise SystemExit("Public release manifest contains an invalid or duplicate file entry.")
        seen_paths.add(path)
        inventory.update(f"{path}\0{item['bytes']}\0{item['sha256']}\n".encode("utf-8"))
    if (len(files) != manifest.get("fileCount") or sum(item["bytes"] for item in files) != manifest.get("totalBytes") or
            inventory.hexdigest() != manifest.get("inventorySha256")):
        raise SystemExit("Public release manifest inventory totals or checksum are inconsistent.")
    by_path = {item.get("path"): item for item in files}
    for required in REQUIRED_STARTUP_DATA:
        if required not in by_path:
            raise SystemExit(f"Public release inventory omits required startup asset: {required}")

    sampled = []
    if not args.startup_assets_only:
        seen_ext = set()
        for item in files:
            suffix = "." + item["path"].rsplit(".", 1)[-1] if "." in item["path"] else "(none)"
            if suffix not in seen_ext:
                seen_ext.add(suffix)
                sampled.append(item)
            if len(sampled) >= 6:
                break
        for item in sampled:
            status, headers, _ = get(base + item["path"], origin)
            if status != 200:
                raise SystemExit(f"Public sample asset returned HTTP {status}: {item['path']}")
            if headers.get("access-control-allow-origin") != origin:
                raise SystemExit(f"CORS failed for sample asset: {item['path']}")
            cache = headers.get("cache-control", "").lower()
            if "immutable" not in cache or "31536000" not in cache:
                raise SystemExit(f"Sample asset lacks the one-year immutable cache policy: {item['path']}")

    verified_startup_assets = []
    for path in REQUIRED_STARTUP_DATA:
        item = by_path[path]
        status, headers, payload = get(base + f"{path}?cacheBust={time.time_ns()}", origin)
        if status != 200:
            raise SystemExit(f"Startup manifest returned HTTP {status}: {path}")
        if headers.get("access-control-allow-origin") != origin:
            raise SystemExit(f"CORS failed for startup asset: {path}")
        if len(payload) != item.get("bytes") or hashlib.sha256(payload).hexdigest() != item.get("sha256"):
            raise SystemExit(f"Startup manifest does not match its release inventory checksum: {path}")
        cache = headers.get("cache-control", "").lower()
        if "immutable" not in cache or "31536000" not in cache:
            raise SystemExit(f"Startup asset lacks the one-year immutable cache policy: {path}")
        verified_startup_assets.append(path)

    if not args.startup_assets_only:
        missing_status, _, _ = get(base + "data/diveatlas-release-check-missing-object", origin)
        if missing_status != 404:
            raise SystemExit(f"Missing object should return HTTP 404, got {missing_status}.")
    print(json.dumps({"release": manifest.get("release"), "fileCount": manifest.get("fileCount"),
                      "totalBytes": manifest.get("totalBytes"), "sampledAssets": [item["path"] for item in sampled],
                      "verifiedStartupAssets": verified_startup_assets,
                      "cors": "passed", "cacheHeaders": "passed",
                      "missingObject": "404" if not args.startup_assets_only else None}, indent=2))


if __name__ == "__main__":
    main()
