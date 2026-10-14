#!/usr/bin/env python3
"""Build the browser catalog for illustrative dive-site photos from the public R2 manifest."""

from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_URL = "https://assets.diveatlas.site/share-preview/manifest.json"
ASSET_BASE_URL = "https://assets.diveatlas.site/"
FEATURE_PREFIX = "share-preview/v1/features/"
OUTPUT_PATH = ROOT / "datasets/dive-site-fallback-photos.js"


def normalize_feature(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def build_catalog(images: list[dict[str, object]]) -> dict[str, list[dict[str, str]]]:
    groups: dict[str, list[dict[str, str]]] = {}
    seen_keys: set[str] = set()

    for image in images:
        key = str(image.get("key") or "").strip()
        if not key.startswith(FEATURE_PREFIX) or ".." in key.split("/") or key in seen_keys:
            continue
        feature = normalize_feature(str(image.get("feature") or ""))
        if not feature:
            continue

        creator = str(image.get("creator") or "").strip()
        provider = str(image.get("provider") or "").strip()
        license_name = str(image.get("license") or "").strip()
        credit = " · ".join(part for part in (creator, license_name, provider) if part)
        alt = str(image.get("alt") or "").strip()
        if not credit or not alt:
            continue

        groups.setdefault(feature, []).append({
            "key": key,
            "alt": alt,
            "credit": credit,
            "title": str(image.get("title") or ""),
            "creator": creator,
            "provider": provider,
            "license": license_name,
            "licenseUrl": str(image.get("licenseUrl") or ""),
            "sourcePage": str(image.get("sourcePage") or ""),
        })
        seen_keys.add(key)

    for feature_images in groups.values():
        feature_images.sort(key=lambda image: image["key"])
    return dict(sorted(groups.items()))


def main() -> int:
    request = urllib.request.Request(
        MANIFEST_URL,
        headers={"User-Agent": "DiveAtlasFallbackPhotoCatalog/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        manifest = json.loads(response.read())

    groups = build_catalog(manifest.get("images", []))
    image_count = sum(len(images) for images in groups.values())
    if not image_count or "reef" not in groups:
        raise SystemExit("The public R2 manifest did not contain a usable feature catalog with reef fallbacks.")

    output = (
        "/* Curated R2 feature images. Keep source, alt text, and license attribution with each object. */\n"
        f"window.DIVE_SITE_FALLBACK_PHOTO_BASE = {json.dumps(ASSET_BASE_URL)};\n"
        "window.DIVE_SITE_FALLBACK_PHOTOS = "
        + json.dumps(groups, ensure_ascii=False, indent=2)
        + ";\n"
    )
    OUTPUT_PATH.write_text(output, encoding="utf-8", newline="\n")
    print(f"Wrote {OUTPUT_PATH.relative_to(ROOT)}: {image_count} images across {len(groups)} feature groups.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
