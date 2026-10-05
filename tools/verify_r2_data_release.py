#!/usr/bin/env python3
"""Verify the public R2 manifest, sample assets, caching, and exact-origin CORS."""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from urllib.parse import urlsplit


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
    args = parser.parse_args()
    base = args.asset_base_url
    origin = args.app_origin.rstrip("/")
    parsed_base, parsed_origin = urlsplit(base), urlsplit(origin)
    if (parsed_base.scheme != "https" or not parsed_base.netloc or parsed_base.query or parsed_base.fragment or
            not parsed_base.path.endswith("/") or parsed_origin.scheme != "https" or not parsed_origin.netloc or
            parsed_origin.path or parsed_origin.query or parsed_origin.fragment):
        raise SystemExit("Asset base and app origin must be valid HTTPS URLs; the asset base must end in '/'.")

    status, headers, body = get(base + "release-manifest.json", origin)
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

    sampled = []
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

    missing_status, _, _ = get(base + "data/diveatlas-release-check-missing-object", origin)
    if missing_status != 404:
        raise SystemExit(f"Missing object should return HTTP 404, got {missing_status}.")
    print(json.dumps({"release": manifest.get("release"), "fileCount": manifest.get("fileCount"),
                      "totalBytes": manifest.get("totalBytes"), "sampledAssets": [item["path"] for item in sampled],
                      "cors": "passed", "cacheHeaders": "passed", "missingObject": "404"}, indent=2))


if __name__ == "__main__":
    main()
