#!/usr/bin/env python3
"""Verify the public R2 manifest, sample assets, caching, and browser-readable CORS."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import re
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
DETAIL_RECORD_PATH_RE = re.compile(
    r"data/dive-site-details/v1/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json",
    re.IGNORECASE,
)
RECOMMENDATIONS_MANIFEST_PATH = "data/dive-site-details/v2/recommendations.json"
RECOMMENDATIONS_PREFIX = "data/dive-site-details/v2/"
RECOMMENDATION_SHARD_RE = re.compile(r"recommendations-\d{4}\.json")
# Must match the exporter so oversized shards cannot pass release verification.
MAX_RECOMMENDATION_SHARD_BYTES = 512 * 1024


def get(url: str, origin: str) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(url, headers={"Origin": origin, "User-Agent": "DiveAtlas-release-check/1"})
    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read()
                expected_bytes = response.headers.get("content-length")
                if expected_bytes is not None and len(body) != int(expected_bytes):
                    raise http.client.IncompleteRead(body, int(expected_bytes) - len(body))
                return response.status, {key.lower(): value for key, value in response.headers.items()}, body
        except urllib.error.HTTPError as error:
            return error.code, {key.lower(): value for key, value in error.headers.items()}, error.read()
        except (http.client.IncompleteRead, TimeoutError, urllib.error.URLError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(attempt + 1)
    raise OSError(f"Could not read complete public asset after 3 attempts: {url}") from last_error


def cors_allows_origin(headers: dict[str, str], origin: str) -> bool:
    allowed_origin = headers.get("access-control-allow-origin", "").strip()
    if allowed_origin == origin:
        return True
    # These public assets are fetched without credentials. A wildcard also lets
    # local development servers read images into the share-preview canvas.
    return allowed_origin == "*" and headers.get("access-control-allow-credentials", "").lower() != "true"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset-base-url", required=True, help="Public immutable release URL ending in /releases/<id>/")
    parser.add_argument("--app-origin", required=True, help="Exact HTTPS origin of the deployed app")
    parser.add_argument("--require-site-details", action="store_true", help="Require and verify a shared-page detail record")
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
    if not cors_allows_origin(headers, origin):
        raise SystemExit("R2 CORS did not allow the app origin or anonymous public access.")
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
    verified_recommendation_shards = []
    if args.require_site_details:
        detail = next((item for item in files if isinstance(item.get("path"), str)
                       and DETAIL_RECORD_PATH_RE.fullmatch(item["path"])), None)
        if not detail:
            raise SystemExit("Publish per-site detail JSON before deploying the shared detail page.")
        # Avoid edge copies left by an earlier write to an object intended to be immutable.
        status, headers, payload = get(base + f"{detail['path']}?cacheBust={time.time_ns()}", origin)
        if status != 200 or not cors_allows_origin(headers, origin):
            raise SystemExit("The shared-page detail sample is not browser-readable.")
        if len(payload) != detail["bytes"] or hashlib.sha256(payload).hexdigest() != detail["sha256"]:
            raise SystemExit("The shared-page detail sample differs from its release inventory.")
        record = json.loads(payload)
        if record.get("schema") != "dive-site-detail-v1" or not detail["path"].endswith(f"/{record.get('site_id')}.json"):
            raise SystemExit("The shared-page detail sample has an invalid schema or ID.")
        recommendations = by_path.get(RECOMMENDATIONS_MANIFEST_PATH)
        if not recommendations:
            raise SystemExit("Publish the dive-site recommendation catalog before deploying the shared detail page.")
        status, headers, payload = get(base + recommendations["path"], origin)
        if status != 200 or not cors_allows_origin(headers, origin):
            raise SystemExit("The shared-page recommendation catalog is not browser-readable.")
        if len(payload) != recommendations["bytes"] or hashlib.sha256(payload).hexdigest() != recommendations["sha256"]:
            raise SystemExit("The recommendation catalog differs from its release inventory.")
        catalog = json.loads(payload)
        if catalog.get("schema") == "dive-site-recommendations-v1" and isinstance(catalog.get("sites"), list):
            # Older immutable releases used one catalog file; continue to verify them.
            pass
        elif (catalog.get("schema") == "dive-site-recommendation-manifest-v1"
              and isinstance(catalog.get("site_count"), int) and catalog["site_count"] >= 0
              and isinstance(catalog.get("shards"), list)):
            shard_files = set()
            declared_sites = 0
            for shard in catalog["shards"]:
                filename = shard.get("file") if isinstance(shard, dict) else None
                site_count = shard.get("site_count") if isinstance(shard, dict) else None
                byte_count = shard.get("bytes") if isinstance(shard, dict) else None
                if (not isinstance(filename, str) or not RECOMMENDATION_SHARD_RE.fullmatch(filename)
                        or filename in shard_files or not isinstance(site_count, int) or site_count < 1
                        or not isinstance(byte_count, int) or byte_count < 1
                        or byte_count > MAX_RECOMMENDATION_SHARD_BYTES):
                    raise SystemExit("The recommendation manifest contains an invalid shard entry.")
                shard_files.add(filename)
                declared_sites += site_count
                shard_path = f"{RECOMMENDATIONS_PREFIX}{filename}"
                shard_item = by_path.get(shard_path)
                if not shard_item:
                    raise SystemExit(f"Recommendation shard is missing from the release inventory: {shard_path}")
                stored_byte_count = shard_item.get("bytes")
                # Earlier Windows text-mode exports added CR before the final LF; verify actual stored bytes below.
                if (not isinstance(stored_byte_count, int) or stored_byte_count > MAX_RECOMMENDATION_SHARD_BYTES
                        or stored_byte_count not in (byte_count, byte_count + 1)):
                    raise SystemExit(f"Recommendation shard size metadata is inconsistent: {shard_path}")
                status, headers, shard_payload = get(base + shard_path, origin)
                if status != 200 or not cors_allows_origin(headers, origin):
                    raise SystemExit(f"Recommendation shard is not browser-readable: {shard_path}")
                if (len(shard_payload) != stored_byte_count or hashlib.sha256(shard_payload).hexdigest() != shard_item["sha256"]
                        or len(shard_payload) > MAX_RECOMMENDATION_SHARD_BYTES):
                    raise SystemExit(f"Recommendation shard differs from its release inventory: {shard_path}")
                shard_catalog = json.loads(shard_payload)
                if (shard_catalog.get("schema") != "dive-site-recommendations-v1"
                        or not isinstance(shard_catalog.get("sites"), list)
                        or len(shard_catalog["sites"]) != site_count):
                    raise SystemExit(f"Recommendation shard has an invalid schema or site count: {shard_path}")
                verified_recommendation_shards.append(shard_path)
            if declared_sites != catalog["site_count"]:
                raise SystemExit("Recommendation shard site counts do not match the manifest.")
        else:
            raise SystemExit("The shared-page recommendation catalog has an invalid schema.")
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
            if not cors_allows_origin(headers, origin):
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
        if not cors_allows_origin(headers, origin):
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
                      "verifiedRecommendationShards": verified_recommendation_shards,
                      "cors": "passed", "cacheHeaders": "passed",
                      "missingObject": "404" if not args.startup_assets_only else None}, indent=2))


if __name__ == "__main__":
    main()
