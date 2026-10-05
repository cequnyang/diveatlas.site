"""Inspect EOT20 NetCDF metadata, grid, fill values, and phase convention."""

from __future__ import annotations

import json
from pathlib import Path

import netCDF4
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data/.build/tides/source/EOT20/ocean_tides"


def inspect() -> dict:
    paths = sorted(path for path in SOURCE.glob("*_ocean_eot20.nc") if not path.name.startswith("._"))
    if len(paths) != 17:
        raise FileNotFoundError(f"Expected 17 ocean constituent NetCDF files under {SOURCE}; found {len(paths)}")
    report = {"file_count": len(paths), "constituents": [], "files": []}
    for path in paths:
        name = path.name.split("_", 1)[0].upper()
        with netCDF4.Dataset(path) as ds:
            lat, lon = ds.variables["lat"][:], ds.variables["lon"][:]
            amplitude = ds.variables["amplitude"]
            phase = ds.variables["phase"]
            real = ds.variables["real"]
            imag = ds.variables["imag"]
            # The all-grid sample checks EOT20's stored complex convention independently.
            a = amplitude[500:501, 1500:1510]
            p = np.deg2rad(phase[500:501, 1500:1510])
            r = real[500:501, 1500:1510]
            i = imag[500:501, 1500:1510]
            valid = ~np.ma.getmaskarray(a)
            phase_error = float(np.max(np.abs(np.asarray(r)[valid] - (np.asarray(a)[valid] * np.cos(p[valid]))))) if valid.any() else None
            report["constituents"].append(name)
            report["files"].append({
                "name": path.name,
                "bytes": path.stat().st_size,
                "dimensions": {dimension: len(ds.dimensions[dimension]) for dimension in ds.dimensions},
                "latitude": [float(lat[0]), float(lat[-1]), float(np.median(np.diff(lat)))],
                "longitude": [float(lon[0]), float(lon[-1]), float(np.median(np.diff(lon)))],
                "variables": {key: {"dimensions": list(ds.variables[key].dimensions), "units": getattr(ds.variables[key], "units", None), "fill": str(getattr(ds.variables[key], "_FillValue", None))}
                              for key in ("amplitude", "phase", "real", "imag")},
                "masked_amplitude_cells": int(np.ma.getmaskarray(amplitude[:]).sum()),
                "complex_reconstruction_max_error_cm": phase_error,
                "product_version": getattr(ds, "product_version", None),
                "history": getattr(ds, "history", None),
            })
    report["constituents"].sort()
    print("EOT20 DATA INSPECTION (before asset generation)")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    inspect()
