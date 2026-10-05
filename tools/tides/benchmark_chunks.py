"""Profile geographic chunk construction on a selected area without publishing."""

from __future__ import annotations

import argparse
import gzip
import math
import struct
import time
from pathlib import Path

import netCDF4
import numpy as np
import rasterio
from rasterio.transform import rowcol

from build_assets import CONSTITUENTS, GEBCO, SOURCE, _ocean_mask_for_tile, _tile_bounds, _tile_id, _write_chunk


def run(lat: float, lon: float) -> dict:
    datasets = [rasterio.open(path) for path in sorted(GEBCO.glob("gebco_2026_*.tif"))]
    y, x = _tile_id(lat, lon)
    with netCDF4.Dataset(SOURCE / "M2_ocean_eot20.nc") as ds:
        latitude, longitude = ds.variables["lat"][:], ds.variables["lon"][:]
    mask = _ocean_mask_for_tile(y, x, datasets)
    payload = 0
    started = time.perf_counter()
    try:
        for ds in datasets:
            if ds.bounds.left <= ((lon + 180) % 360 - 180) < ds.bounds.right and ds.bounds.bottom <= lat < ds.bounds.top:
                row, col = rowcol(ds.transform, ((lon + 180) % 360 - 180), lat)
                values = ds.read(1, window=rasterio.windows.Window(col - 1, row - 1, 3, 3))
                break
        wet = bool(values.size == 9 and np.all(values < 0))
    finally:
        for ds in datasets:
            ds.close()
    return {"tile": f"{y}_{x}", "mask_shape": list(mask.shape), "point_gebco_neighborhood_wet": wet, "mask_build_seconds": round(time.perf_counter() - started, 3)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lat", type=float, default=47.60264)
    parser.add_argument("--lon", type=float, default=-122.3393)
    args = parser.parse_args()
    print(run(args.lat, args.lon))
