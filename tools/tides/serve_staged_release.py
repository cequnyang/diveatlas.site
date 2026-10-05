#!/usr/bin/env python3
"""Serve the local Tide staging tree with development-only CORS headers."""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "data/.build/tides/phase4-9/external-origin"


class TideAssetHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, allow_origin: str, **kwargs):
        self.allow_origin = allow_origin
        super().__init__(*args, directory=str(STAGING), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", self.allow_origin)
        self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        super().end_headers()


def loopback_origin(value: str) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or
            parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
        raise argparse.ArgumentTypeError("--allow-origin must be an HTTP loopback origin such as http://127.0.0.1:8765")
    return f"{parsed.scheme}://{parsed.netloc}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--allow-origin", type=loopback_origin, default="http://127.0.0.1:8765")
    args = parser.parse_args()
    if not (STAGING / "tides").is_dir():
        raise SystemExit("Stage assets first with: python tools/tides/stage_static_release.py")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(TideAssetHandler, allow_origin=args.allow_origin))
    print(f"Serving local Tide staging from {STAGING} at http://127.0.0.1:{args.port}/tides/")
    print(f"CORS is restricted to the loopback app origin {args.allow_origin}; Ctrl+C stops the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
