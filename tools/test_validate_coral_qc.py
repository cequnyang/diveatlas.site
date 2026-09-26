"""Focused regression tests for the offline Coral QC guardrail gates."""

from __future__ import annotations

import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from validate_coral_qc import (
    BASELINE,
    CORAL_STEP,
    CONTROL_BOUNDS,
    _check_controls,
    metric_guardrails,
    occurrence_cell_violation,
    pyramid_level_errors,
    queensland_regression_errors,
)


def summary(raw_cells: int, rejected_cells: int, raw_records: int, rejected_records: int) -> dict:
    return {
        "totalBaseCells": raw_cells,
        "acceptedBaseCells": raw_cells - rejected_cells,
        "rejectedBaseCells": rejected_cells,
        "totalRecords": raw_records,
        "recordsInAcceptedCells": raw_records - rejected_records,
        "recordsInRejectedCells": rejected_records,
        "rejectedCellPercent": 100 * rejected_cells / raw_cells,
        "rejectedRecordPercent": 100 * rejected_records / raw_records,
    }


class CoralQcValidationTests(unittest.TestCase):
    def test_base_and_pyramid_cell_metrics_use_distinct_names(self) -> None:
        self.assertNotIn("zoomCells", BASELINE)
        self.assertEqual(BASELINE["aggregatedCellsByZoom"]["11"], 99_417)

    def test_b_queensland_cell_regression(self) -> None:
        row = {"y": 4408, "x": 20656, "records": 59,
               "observedPoint": {"latitude": -21.11666, "longitude": 142.76667},
               "rejectionReason": "deep_inland_gt_50km", "distanceToCoastKm": 441.1}
        key = (4408, 20656)
        step = 0.03125
        parent = (int((-21.11666 + 90) // step), int((142.76667 + 180) // step))
        errors, found_parent = queensland_regression_errors(
            row, {key: 59}, {key}, set(), set(), step,
        )
        self.assertEqual(errors, [])
        self.assertEqual(found_parent, parent)
        reintroduced_errors, _ = queensland_regression_errors(
            row, {key: 59}, {key}, {key}, set(), step,
        )
        self.assertTrue(any("appears in production snapshot" in item for item in reintroduced_errors))
        leaked_errors, _ = queensland_regression_errors(
            row, {key: 59}, {key}, set(), {parent}, step,
        )
        self.assertTrue(any("Z11 parent" in item for item in leaked_errors))

    def test_c_impossible_rejection_ratio_fails(self) -> None:
        failures, _ = metric_guardrails(summary(100_000, 1_000, 1_000_000, 5_100))
        self.assertTrue(any("0.5% hard limit" in item for item in failures))

    def test_d_missing_positive_control_is_detectable(self) -> None:
        control = CONTROL_BOUNDS["Raja Ampat"]
        lat = (control[0] + control[1]) / 2
        lon = (control[2] + control[3]) / 2
        y = int((lat + 90) / CORAL_STEP)
        x = int((lon + 180) / CORAL_STEP)
        found = _check_controls({(y, x): [y, x, 3, [0]]})
        self.assertGreater(found["Raja Ampat"], 0)
        found_after_overfilter = _check_controls({})
        self.assertEqual(found_after_overfilter["Raja Ampat"], 0)

    def test_e_occurrence_point_in_rejected_cell_fails(self) -> None:
        y, x = 4408, 20656
        lat = (y + 0.5) * CORAL_STEP - 90
        lon = (x + 0.5) * CORAL_STEP - 180
        self.assertEqual(occurrence_cell_violation(lat, lon, set(), {(y, x)}), (y, x))

    def test_f_pyramid_mutation_is_detectable(self) -> None:
        base = {(1000, 1000): [1000, 1000, 7, [0, 1]]}
        step = CORAL_STEP
        py, px = int((1000.5 * CORAL_STEP) / step), int((1000.5 * CORAL_STEP) / step)
        level = {"step": step, "cells": [[py, px, 7, [0, 1]]]}
        self.assertEqual(pyramid_level_errors(base, level, 7, 7, step), [])
        level["cells"][0][2] = 8
        self.assertTrue(pyramid_level_errors(base, level, 7, 7, step))

    def test_g_coherent_drift_warns_without_failing(self) -> None:
        failures, warnings = metric_guardrails(summary(100_000, 1_200, 1_000_000, 4_000))
        self.assertEqual(failures, [])
        self.assertTrue(warnings)


if __name__ == "__main__":
    unittest.main()
