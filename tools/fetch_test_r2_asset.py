#!/usr/bin/env python3
"""Fetch one published asset for the local Playwright test-site proxy.

The CI release preflight uses Python's urllib client successfully, while
Cloudflare challenges the Node fetch client used by the test server. This
small bridge preserves the upstream response status and headers for Node.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request


def main() -> int:
    if len(sys.argv) != 2:
        print("Expected one asset URL.", file=sys.stderr)
        return 2

    request = urllib.request.Request(
        sys.argv[1],
        headers={
            "Origin": "https://diveatlas.site",
            "User-Agent": "DiveAtlas-release-check/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status = response.status
            headers = {
                key.lower(): value
                for key, value in response.headers.items()
                if key.lower() in {"cache-control", "content-type", "content-encoding", "etag", "last-modified"}
            }
            body = response.read()
    except urllib.error.HTTPError as error:
        status = error.code
        headers = {
            key.lower(): value
            for key, value in error.headers.items()
            if key.lower() in {"cache-control", "content-type", "content-encoding", "etag", "last-modified"}
        }
        body = error.read()
    except Exception as error:  # noqa: BLE001 - report proxy failures to the caller
        print(f"R2 asset request failed: {error}", file=sys.stderr)
        return 2

    encoded_headers = json.dumps(headers, separators=(",", ":")).encode("utf-8")
    output = sys.stdout.buffer
    output.write(status.to_bytes(2, "big"))
    output.write(len(encoded_headers).to_bytes(4, "big"))
    output.write(encoded_headers)
    output.write(body)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
