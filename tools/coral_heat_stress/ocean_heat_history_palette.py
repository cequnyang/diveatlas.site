"""Shared NOAA Marine Heatwave Watch category labels and map colors.

The RGB and alpha values match the candidate-A research raster. Keeping the
legend swatches and future offline tile builds on the same palette prevents
the UI from quietly describing different categories than the published map.
"""

from __future__ import annotations


CATEGORY_LABELS = (
    "No marine heatwave",
    "Moderate",
    "Strong",
    "Severe",
    "Extreme",
    "Beyond extreme",
)

CATEGORY_RGBA = (
    (86, 151, 172, 38),
    (244, 214, 100, 78),
    (244, 163, 76, 102),
    (225, 99, 66, 124),
    (180, 60, 75, 144),
    (112, 54, 124, 158),
)


def category_definitions() -> list[dict[str, int | str]]:
    return [
        {
            "code": code,
            "label": label,
            "color": "#%02x%02x%02x" % rgba[:3],
        }
        for code, (label, rgba) in enumerate(zip(CATEGORY_LABELS, CATEGORY_RGBA, strict=True))
    ]
