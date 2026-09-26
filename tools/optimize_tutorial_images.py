#!/usr/bin/env python3
"""Rebuild DiveAtlas Tutorial WebP assets from preserved source images.

The source directory defaults to a sibling of the static site so the original
photos are preserved without being published by the repository-root website:

  D:/Project/diveatlas-source-assets/tutorial/{bubbles,previews}-original

Run with --source-root to use another local source archive. Pillow is the only
runtime dependency; output sizes, crops, quality, and metadata handling are
fixed here so repeated runs produce the same production dimensions/settings.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_ROOT = ROOT.parent / "diveatlas-source-assets" / "tutorial"
BUBBLE_SIZE = 320
BUBBLE_QUALITY = 80
PREVIEW_MAX_WIDTH = 720
PREVIEW_QUALITY = 84

# Normalized focal points for square crops. The hammerhead focal point is
# shifted right so its face and body stay in the 1:1 supporting-photo frame.
BUBBLE_FOCAL_POINTS = {
    "coral-records.webp": (0.50, 0.50),
    "dive-sites.webp": (0.50, 0.50),
    "fish-density.webp": (0.55, 0.57),
    "reef-extent.webp": (0.50, 0.50),
}


def square_focal_crop(image: Image.Image, focus: tuple[float, float]) -> Image.Image:
    width, height = image.size
    side = min(width, height)
    focus_x = max(0.0, min(1.0, focus[0])) * width
    focus_y = max(0.0, min(1.0, focus[1])) * height
    left = round(max(0, min(width - side, focus_x - side / 2)))
    top = round(max(0, min(height - side, focus_y - side / 2)))
    return image.crop((left, top, left + side, top + side))


def save_webp(image: Image.Image, destination: Path, quality: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Rebuilding from RGB pixels drops EXIF, XMP, and source ICC metadata.
    image.convert("RGB").save(
        destination,
        format="WEBP",
        quality=quality,
        method=6,
        exact=True,
    )


def optimize_bubbles(source_root: Path) -> None:
    source_dir = source_root / "bubbles-original"
    output_dir = ROOT / "assets" / "tutorial" / "bubbles"
    for filename, focal in BUBBLE_FOCAL_POINTS.items():
        source = source_dir / filename
        if not source.is_file():
            raise FileNotFoundError(f"Missing preserved bubble source: {source}")
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            image = square_focal_crop(image, focal).resize(
                (BUBBLE_SIZE, BUBBLE_SIZE), Image.Resampling.LANCZOS
            )
            save_webp(image, output_dir / filename, BUBBLE_QUALITY)


def optimize_previews(source_root: Path) -> None:
    source_dir = source_root / "previews-original"
    output_dir = ROOT / "assets" / "tutorial" / "previews"
    sources = sorted(source_dir.glob("*"))
    if not sources:
        raise FileNotFoundError(f"No preserved preview sources found under {source_dir}")
    for source in sources:
        if not source.is_file():
            continue
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            if image.width > PREVIEW_MAX_WIDTH:
                height = round(image.height * PREVIEW_MAX_WIDTH / image.width)
                image = image.resize(
                    (PREVIEW_MAX_WIDTH, height), Image.Resampling.LANCZOS
                )
            save_webp(image, output_dir / source.name, PREVIEW_QUALITY)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-root",
        type=Path,
        default=DEFAULT_SOURCE_ROOT,
        help="folder containing bubbles-original/ and previews-original/",
    )
    parser.add_argument(
        "--preset",
        choices=("all", "bubble", "preview"),
        default="all",
        help="explicit asset preset to rebuild (default: all)",
    )
    args = parser.parse_args()
    source_root = args.source_root.resolve()
    if args.preset in ("all", "bubble"):
        optimize_bubbles(source_root)
    if args.preset in ("all", "preview"):
        optimize_previews(source_root)


if __name__ == "__main__":
    main()
