#!/usr/bin/env python3
"""Check an immutable Tide release through its public HTTP(S) origin."""

from __future__ import annotations

import argparse
import gzip
import json
import re
import urllib.error
import urllib.parse
import urllib.request

MAX_MANIFEST_BYTES = 8 * 1024 * 1024
IMMUTABLE_CACHE = re.compile(r"(?:^|,)\s*max-age=31536000\s*(?:,|$)", re.IGNORECASE)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def validate_origin(value: str, *, label: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme not in {"https", "http"} or not parsed.netloc or parsed.username or parsed.password or
            parsed.query or parsed.fragment or parsed.path not in {"", "/"}):
        raise ValueError(f"{label} must be an origin without credentials, path, query, or fragment")
    if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError(f"{label} must use HTTPS outside loopback")
    return f"{parsed.scheme}://{parsed.netloc}"


def open_no_redirect(request: urllib.request.Request):
    return urllib.request.build_opener(NoRedirect).open(request, timeout=30)


def fetch(url: str, app_origin: str, *, limit: int = 64 * 1024 * 1024) -> tuple[bytes, dict]:
    request = urllib.request.Request(url, headers={"Origin": app_origin, "Accept-Encoding": "identity"})
    try:
        response = open_no_redirect(request)
    except urllib.error.HTTPError as error:
        if 300 <= error.code < 400:
            raise ValueError(f"Unexpected redirect from {url}: HTTP {error.code}") from error
        raise
    with response:
        if response.geturl() != url:
            raise ValueError(f"Unexpected redirect from {url} to {response.geturl()}")
        cors = response.headers.get("Access-Control-Allow-Origin")
        if cors != app_origin:
            raise ValueError(f"CORS origin mismatch for {url}: expected configured app origin")
        cache = response.headers.get("Cache-Control", "")
        if not IMMUTABLE_CACHE.search(cache) or "immutable" not in cache.lower():
            raise ValueError(f"Immutable cache policy is missing for {url}")
        content = response.read(limit + 1)
        if len(content) > limit:
            raise ValueError(f"HTTP smoke response exceeded its size limit: {url}")
        return content, {"status": response.status, "contentType": response.headers.get("Content-Type"),
                         "cacheControl": cache, "corsOrigin": cors, "bytes": len(content)}


def run_http_smoke(asset_base_url: str, app_origin: str) -> dict:
    asset_base = urllib.parse.urljoin(asset_base_url.rstrip("/") + "/", "")
    parsed_base = urllib.parse.urlsplit(asset_base)
    if (parsed_base.scheme != "https" and parsed_base.hostname not in {"localhost", "127.0.0.1", "::1"}) or not asset_base.endswith("/tides/"):
        raise ValueError("Tide asset base URL must be HTTPS (except loopback) and end in the release /tides/ directory")

    manifest_url = urllib.parse.urljoin(asset_base, "../release-manifest.json")
    manifest_bytes, manifest_headers = fetch(manifest_url, app_origin, limit=MAX_MANIFEST_BYTES)
    if "json" not in (manifest_headers.get("contentType") or "").lower():
        raise ValueError("Release manifest did not use a JSON content type")
    manifest = json.loads(manifest_bytes.decode("utf-8"))
    if (manifest.get("format") != "diveatlas-tide-static-release" or manifest.get("schemaVersion") != 1 or
            manifest.get("basePath") != "tides/" or not isinstance(manifest.get("files"), list)):
        raise ValueError("The remote release manifest is not a supported DiveAtlas Tide release")
    listed = {item["path"]: item for item in manifest["files"]}
    requests = [{"url": manifest_url, **manifest_headers}]
    transferred = len(manifest_bytes)

    representatives = []
    for family in ("eot20-v1", "eot20-viz-v1", "timezones-2026d"):
        family_manifest = f"tides/{family}/manifest.json"
        if family_manifest not in listed:
            raise ValueError(f"Release manifest omits required family metadata: {family_manifest}")
        representatives.append(family_manifest)
        extension = ".bin.gz" if family != "timezones-2026d" else ".json.gz"
        candidates = sorted(path for path in listed if path.startswith(f"tides/{family}/") and path.endswith(extension))
        if not candidates:
            raise ValueError(f"Release manifest has no compressed sample asset for {family}")
        representatives.append(candidates[0])

    for path in representatives:
        content, headers = fetch(urllib.parse.urljoin(asset_base, path.removeprefix("tides/")), app_origin)
        item = listed[path]
        if len(content) != item["bytes"]:
            raise ValueError(f"Remote Tide asset byte size does not match its release manifest: {path}")
        if path.endswith(".gz"):
            decoded = gzip.decompress(content)
            if not decoded:
                raise ValueError(f"Remote compressed Tide asset decoded to an empty file: {path}")
        if path.endswith("/manifest.json"):
            json.loads(content.decode("utf-8"))
        requests.append({"path": path, **headers})
        transferred += len(content)

    missing_url = urllib.parse.urljoin(asset_base, "__diveatlas_missing_release_asset__/not-found.bin")
    missing_request = urllib.request.Request(missing_url, headers={"Origin": app_origin, "Accept-Encoding": "identity"})
    try:
        with open_no_redirect(missing_request) as response:
            raise ValueError(f"Missing-object check unexpectedly returned HTTP {response.status}")
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise ValueError(f"Missing-object request should return HTTP 404, got {error.code}") from error

    return {"release": manifest["release"], "manifestUrl": manifest_url, "assetBaseUrl": asset_base,
            "appOrigin": app_origin, "representativeAssets": requests[1:], "missingAssetStatus": 404,
            "requestCount": len(requests) + 1, "successfulBytes": transferred,
            "redirects": 0, "allChecksPassed": True}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset-base-url", required=True, help="public release URL ending in /<release>/tides/")
    parser.add_argument("--app-origin", required=True, help="exact DiveAtlas origin allowed by the bucket CORS policy")
    args = parser.parse_args()
    try:
        app_origin = validate_origin(args.app_origin, label="--app-origin")
        print(json.dumps(run_http_smoke(args.asset_base_url, app_origin), indent=2))
    except (OSError, urllib.error.URLError, urllib.error.HTTPError, ValueError, UnicodeDecodeError,
            json.JSONDecodeError, gzip.BadGzipFile) as error:
        raise SystemExit(f"Tide HTTP release verification failed: {error}") from error


if __name__ == "__main__":
    main()
