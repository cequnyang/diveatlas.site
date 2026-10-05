"""Compare EOT20 browser predictions with NOAA station harmonic predictions."""

from __future__ import annotations

import gzip
import json
import math
import struct
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data/tides/eot20-v1"
NAMES = ["2N2", "J1", "K1", "K2", "M2", "M4", "MF", "MM", "N2", "O1", "P1", "Q1", "S1", "S2", "SA", "SSA", "T2"]
STATIONS = [
    ("9414290", "San Francisco", 37.806305, -122.46589, "US west coast / mixed"),
    ("9447130", "Seattle", 47.60264, -122.33930, "US northwest / mixed"),
    ("8724580", "Key West", 24.55570, -81.80790, "Florida Keys / mixed"),
    ("8518750", "The Battery", 40.700554, -74.01417, "New York / semidiurnal"),
    ("1611400", "Nawiliwili", 21.95440, -159.35610, "Hawaii / mixed"),
    ("8771450", "Galveston Pier 21", 29.31000, -94.79330, "Gulf shelf / diurnal"),
    ("9410170", "San Diego", 32.715557, -117.17667, "US west coast / mixed"),
    ("9449880", "Friday Harbor", 48.545277, -123.01250, "Salish Sea / complex coast"),
    ("9455920", "Anchorage", 61.23750, -149.89040, "Alaska / high range"),
    ("1612340", "Honolulu", 21.303333, -157.86453, "Hawaii / island"),
    ("8410140", "Eastport", 44.90461, -66.98289, "Bay of Fundy / high tidal range"),
    ("1770000", "Pago Pago", -14.28000, -170.69000, "American Samoa / near dateline"),
]
BEGIN = "20240101"
MAX_REFERENCE_OFFSET_KM = 20.0
RECORD = 1 + 17 * 8


def nearest_wet_node(lat: float, lon: float):
    ty0 = max(0, min(35, math.floor((lat + 90) / 5)))
    tx0 = math.floor((((lon + 180) % 360) / 5))
    candidates = []
    for ty in range(max(0, ty0 - 1), min(35, ty0 + 1) + 1):
        for delta_x in (-1, 0, 1):
            tx = (tx0 + delta_x) % 72
            path = DATA / "coeff" / f"{ty}_{tx}.bin.gz"
            if not path.exists():
                continue
            raw = gzip.decompress(path.read_bytes())
            magic, version, count, rows, cols, record_size = struct.unpack_from("<4sBBHHH", raw)
            if magic != b"EOT1" or version != 1 or count != len(NAMES) or record_size != RECORD:
                raise ValueError(f"Unexpected EOT20 chunk encoding: {path}")
            lat0, lon0 = struct.unpack_from("<dd", raw, 12)
            for row in range(rows):
                node_lat = lat0 + row * 0.125
                if abs(node_lat - lat) > 0.25:
                    continue
                for col in range(cols):
                    offset = 28 + (row * cols + col) * record_size
                    if raw[offset] != 1:
                        continue
                    node_lon = ((lon0 + col * 0.125 + 180) % 360) - 180
                    dlat = math.radians(node_lat - lat)
                    dlon = math.radians(((node_lon - lon + 180) % 360) - 180)
                    hav = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat)) * math.cos(math.radians(node_lat)) * math.sin(dlon / 2) ** 2
                    distance = 6371 * 2 * math.asin(math.sqrt(hav))
                    if distance > MAX_REFERENCE_OFFSET_KM:
                        continue
                    coeffs = [list(struct.unpack_from("<ff", raw, offset + 1 + index * 8)) for index in range(len(NAMES))]
                    candidates.append((distance, node_lat, node_lon, coeffs))
    return min(candidates, default=None, key=lambda item: item[0])


def turning_points(values):
    result = []
    for index in range(1, len(values) - 1):
        if values[index] >= values[index - 1] and values[index] > values[index + 1]:
            result.append(("high", index))
        elif values[index] <= values[index - 1] and values[index] < values[index + 1]:
            result.append(("low", index))
    return result


def main():
    records = []
    for station, name, lat, lon, regime in STATIONS:
        model_point = nearest_wet_node(lat, lon)
        if model_point is None:
            records.append({"station": station, "name": name, "regime": regime, "status": "no wet EOT20 node within 20 km"})
            continue
        distance, model_lat, model_lon, coeffs = model_point
        response = requests.get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter", params={
            "begin_date": BEGIN, "end_date": "20240102", "station": station, "product": "predictions",
            "datum": "MSL", "time_zone": "gmt", "units": "metric", "interval": "h", "format": "json",
        }, timeout=45)
        response.raise_for_status()
        payload = response.json()
        if "predictions" not in payload:
            records.append({"station": station, "name": name, "regime": regime, "status": payload.get("error", "NOAA prediction unavailable")})
            continue
        references = payload["predictions"]
        timestamps = [int(datetime.strptime(item["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc).timestamp() * 1000) for item in references]
        reference_values = [float(item["v"]) for item in references]
        request = {"times": timestamps, "coefficients": coeffs}
        js = """
          import { predictHarmonic } from './js/tides/astronomy.js';
          let input=''; for await (const part of process.stdin) input += part;
          const {times, coefficients}=JSON.parse(input);
          process.stdout.write(JSON.stringify(times.map(time=>predictHarmonic(coefficients,time))));
        """
        run = subprocess.run(["node", "--input-type=module", "-e", js], cwd=ROOT,
                             input=json.dumps(request), text=True, capture_output=True, check=True)
        model_values = json.loads(run.stdout)
        count = min(len(model_values), len(reference_values))
        delta = np.asarray(model_values[:count]) - np.asarray(reference_values[:count])
        model_turns = turning_points(model_values[:count])
        reference_turns = turning_points(reference_values[:count])
        timing_errors = []
        for kind, reference_index in reference_turns:
            available = [abs(index - reference_index) for model_kind, index in model_turns if model_kind == kind]
            if available:
                timing_errors.append(min(available))
        records.append({
            "station": station, "name": name, "regime": regime, "status": "compared",
            "reference_coordinate": [lat, lon], "eot20_coordinate": [model_lat, model_lon],
            "model_reference_offset_km": round(distance, 2), "sample_count_hourly": count,
            "rmse_m": round(float(np.sqrt(np.mean(delta ** 2))), 4), "mean_bias_m": round(float(np.mean(delta)), 4),
            "max_abs_difference_m": round(float(np.max(np.abs(delta))), 4),
            "matched_turning_point_count": len(timing_errors),
            "median_turning_time_error_hours": round(float(np.median(timing_errors)), 2) if timing_errors else None,
        })
    report = {
        "reference": "NOAA CO-OPS official harmonic predictions API, product=predictions, datum=MSL, GMT, metric, hourly",
        "reference_url": "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter",
        "model": "EOT20 17-constituent coefficients from generated float32 static chunks; browser astronomy.js predictor",
        "date_utc": "2024-01-01 through 2024-01-02", "max_model_reference_offset_km": MAX_REFERENCE_OFFSET_KM,
        "limitations": "NOAA station predictions are an independent station-specific harmonic reference. EOT20 values are sampled at the nearest wet grid node (up to 20 km away); this is a regional diagnostic, not a station-level accuracy claim. NOAA and EOT20 constituent sets and epoch/reference choices differ.",
        "stations": records,
    }
    output = ROOT / "tools/tides/noaa-validation-report.json"
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(json.dumps(report, indent=2))
    compared = [item for item in records if item["status"] == "compared"]
    if not compared:
        raise SystemExit("No NOAA station locations had a valid nearby Tide asset.")


if __name__ == "__main__":
    main()
