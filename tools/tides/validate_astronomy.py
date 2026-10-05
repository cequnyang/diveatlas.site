"""Compare browser harmonic arguments and nodal terms against PyTMD FES mode."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
VENV_SITE = ROOT / "data/.build/tides/.venv/Lib/site-packages"
sys.path.insert(0, str(VENV_SITE))
from pyTMD import constituents  # noqa: E402

NAMES = ["2n2", "j1", "k1", "k2", "m2", "m4", "mf", "mm", "n2", "o1", "p1", "q1", "s1", "s2", "sa", "ssa", "t2"]
TIMES = ["2024-01-01T06:00:00Z", "2026-09-30T12:00:00Z"]


def main() -> None:
    timestamps = [int(np.datetime64(value).astype("datetime64[ms]").astype(np.int64)) for value in TIMES]
    mjd = np.asarray(timestamps, dtype=np.float64) / 86_400_000 + 40_587
    pu, pf, G = constituents.arguments(mjd, NAMES, corrections="FES")
    expected = [[float(pf[t, i] * np.cos(np.deg2rad(G[t, i]) + pu[t, i])) for i in range(len(NAMES))]
                for t in range(len(TIMES))]
    payload = json.dumps({"timestamps": timestamps, "expected": expected})
    script = """
      import { predictHarmonic, CONSTITUENTS } from './js/tides/astronomy.js';
      let input = ''; for await (const part of process.stdin) input += part;
      const { timestamps } = JSON.parse(input);
      const output = timestamps.map(time => CONSTITUENTS.map((_, index) => {
        const coefficients = CONSTITUENTS.map(() => [0, 0]);
        coefficients[index] = [1, 0];
        return predictHarmonic(coefficients, time) * 100;
      }));
      process.stdout.write(JSON.stringify(output));
    """
    result = subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT, input=payload,
                            text=True, capture_output=True, check=True)
    actual = np.asarray(json.loads(result.stdout))
    errors = np.abs(actual - np.asarray(expected))
    report = {"reference": "PyTMD 3.0.9 constituents.arguments(corrections='FES')",
              "dates_utc": TIMES, "constituent_count": len(NAMES), "cases": int(errors.size),
              "max_abs_error_cm": float(errors.max()), "rms_error_cm": float(np.sqrt(np.mean(errors ** 2))),
              "tolerance_cm": 0.001, "pass": bool(errors.max() <= 0.001)}
    print(json.dumps(report, indent=2))
    if not report["pass"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
