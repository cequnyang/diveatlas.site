"""Shared BAA/DHW map display tokens and NOAA reef-relevance display mask."""

from __future__ import annotations

import json
from pathlib import Path

import netCDF4
import numpy as np

HISTORY_SOURCE = Path("data/.build/coral_heat_stress/history_source/noaa_crw_thermal_history_annual_history_v3.7.0_1985-2025.nc")
TOKEN_PATH = Path(__file__).resolve().parents[2] / "data" / "coral-heat-stress" / "thermal-style.json"
TOKENS = json.loads(TOKEN_PATH.read_text(encoding="utf-8"))
COLORS = tuple(TOKENS["colors"])
ALPHA = tuple(TOKENS["alpha"])
CATEGORY_COLORS = tuple(tuple(int(color[index:index + 2], 16) for index in (1, 3, 5)) for color in COLORS)
CATEGORY_ALPHA = tuple(int(value) for value in ALPHA)
CURRENT_CONTEXT_ALPHA = tuple(int(value) for value in TOKENS["currentContextAlpha"])
CURRENT_ADJACENT_ALPHA = tuple(int(value) for value in TOKENS["currentAdjacentAlpha"])
CURRENT_REEF_ALPHA = tuple(int(value) for value in TOKENS["currentReefAlpha"])
HISTORY_COLORS = tuple(COLORS[index] for index in TOKENS["historyColorCategories"])
HISTORY_ALPHA = tuple(int(ALPHA[index]) for index in TOKENS["historyAlphaCategories"])
HISTORY_CONTEXT_ALPHA = tuple(int(value) for value in TOKENS["historyContextAlpha"])
HISTORY_REEF_ALPHA = tuple(int(value) for value in TOKENS["historyReefAlpha"])


def read_history_display_mask(source: Path = HISTORY_SOURCE) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Read NOAA's analyzed reef-plus-buffer mask used by the existing maps."""
    return _read_history_mask("mask", source)


def read_history_reef_mask(source: Path = HISTORY_SOURCE) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Read NOAA's reef footprint for visual emphasis on the global annual pilot."""
    return _read_history_mask("reef_mask", source)


def _read_history_mask(variable_name: str, source: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    dataset = netCDF4.Dataset(source, "r")
    try:
        required = (variable_name, "lat", "lon")
        if any(name not in dataset.variables for name in required):
            raise ValueError(f"NOAA history source lacks {variable_name} or coordinates")
        mask = np.asarray(dataset.variables[variable_name][:], dtype=np.uint8) == 1
        latitude = np.asarray(dataset.variables["lat"][:], dtype=np.float64)
        longitude = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
        return mask, latitude, longitude
    finally:
        dataset.close()


def apply_common_display_mask(values: np.ndarray, latitude: np.ndarray, mask: np.ndarray,
                              mask_latitude: np.ndarray, mask_longitude: np.ndarray) -> np.ndarray:
    """Return a display-only masked grid; fail if grids do not align cell-for-cell."""
    if values.shape[1] != len(mask_longitude):
        raise ValueError("Current and history longitude widths differ")
    # NOAA stores float32 centers with minor rounding; both global products share -179.975 + 0.05*n.
    current_lon = -179.975 + np.arange(values.shape[1], dtype=np.float64) * 0.05
    if not np.allclose(current_lon, mask_longitude, atol=2e-5, rtol=0):
        raise ValueError("Current and history longitude centers differ; refusing to resample display mask")
    rows = np.asarray(latitude, dtype=np.float64)
    history_rows = np.rint((rows - float(mask_latitude[0])) / 0.05).astype(np.int64)
    in_history = (history_rows >= 0) & (history_rows < len(mask_latitude))
    aligned = np.zeros(rows.shape, dtype=bool)
    aligned[in_history] = np.isclose(
        mask_latitude[history_rows[in_history]], rows[in_history], atol=2e-5, rtol=0
    )
    latitude_min = float(np.min(mask_latitude))
    latitude_max = float(np.max(mask_latitude))
    inside_product = (rows >= latitude_min - 2e-5) & (rows <= latitude_max + 2e-5)
    if np.any(inside_product & ~aligned):
        raise ValueError("Current and history latitude centers differ; refusing to resample display mask")
    display_mask = np.zeros(values.shape, dtype=bool)
    display_mask[aligned] = mask[history_rows[aligned]]
    result = np.asarray(values).copy()
    result[~display_mask] = 255
    return result
