from __future__ import annotations

import tempfile
import unittest
from datetime import date
from pathlib import Path

import numpy as np

from tools.coral_heat_stress.build import ADJACENT_ALPHA, CONTEXT_ALPHA, MISSING, PALETTE, REEF_ALPHA, _current_tile_alpha, _release_name, build, classify_baa, maximum_baa_window, validate_category_array
from tools.coral_heat_stress.thermal_style import ALPHA as HISTORY_ALPHA, apply_common_display_mask


class CoralHeatStressBuildTests(unittest.TestCase):
    def test_current_palette_and_alpha_ladders_preserve_shared_hues_and_reinforce_severity(self):
        self.assertEqual(PALETTE[1].tolist(), [255, 235, 145])
        self.assertEqual(PALETTE[2].tolist(), [246, 177, 52])
        self.assertEqual(HISTORY_ALPHA, (0, 46, 61, 72, 87, 102, 115, 128))
        self.assertEqual(CONTEXT_ALPHA.tolist(), [14, 34, 60, 88, 118, 148, 178, 202])
        self.assertEqual(ADJACENT_ALPHA.tolist(), [26, 56, 90, 126, 162, 194, 220, 240])
        self.assertEqual(REEF_ALPHA.tolist(), [38, 78, 116, 154, 190, 218, 238, 250])
        self.assertTrue(np.all(np.diff(CONTEXT_ALPHA) > 0))
        self.assertTrue(np.all(np.diff(ADJACENT_ALPHA) > 0))
        self.assertTrue(np.all(np.diff(REEF_ALPHA) > 0))
        self.assertTrue(np.all(REEF_ALPHA >= CONTEXT_ALPHA))

    def test_current_tile_alpha_emphasizes_reef_and_keeps_missing_cells_transparent(self):
        categories = np.array([[0, 1, 2, 3, 7, MISSING]], dtype=np.uint8)
        adjacent = np.array([[False, False, True, False, False, False]])
        reef = np.array([[False, False, False, True, True, True]])
        self.assertEqual(_current_tile_alpha(categories, adjacent, reef).tolist(), [[14, 34, 90, 154, 250, 0]])

    def test_rebuild_release_name_sorts_after_any_existing_same_date_revision(self):
        with tempfile.TemporaryDirectory() as temporary:
            releases = Path(temporary)
            (releases / "20260928-p2-r081330").mkdir()
            name = _release_name(date(2026, 9, 28), releases)
            self.assertRegex(name, r"^20260928-p2-r\d{6}$")

    def test_common_display_mask_aligns_reversed_latitude_rows_and_limits_to_history_coverage(self):
        longitudes = -179.975 + np.arange(2) * 0.05
        mask = np.array([[True, False], [False, True]])
        mask_latitude = np.array([-0.025, 0.025])
        current_latitude = np.array([34.175, 0.025, -0.025, -34.175])
        values = np.arange(8, dtype=np.uint8).reshape(4, 2)
        rendered = apply_common_display_mask(values, current_latitude, mask, mask_latitude, longitudes)
        self.assertEqual(rendered.tolist(), [[255, 255], [255, 3], [4, 255], [255, 255]])

    def classify(self, hotspot: float, dhw: float) -> int:
        return int(classify_baa(np.array([round(hotspot * 100)]), np.array([round(dhw * 100)]))[0])

    def test_all_classification_boundaries(self):
        self.assertEqual(self.classify(0, 100), 0)
        self.assertEqual(self.classify(0.01, 100), 1)
        self.assertEqual(self.classify(0.99, 100), 1)
        self.assertEqual(self.classify(1, 0), 2)
        self.assertEqual(self.classify(1, 3.99), 2)
        self.assertEqual(self.classify(1, 4), 3)
        self.assertEqual(self.classify(1, 7.99), 3)
        self.assertEqual(self.classify(1, 8), 4)
        self.assertEqual(self.classify(1, 11.99), 4)
        self.assertEqual(self.classify(1, 12), 5)
        self.assertEqual(self.classify(1, 15.99), 5)
        self.assertEqual(self.classify(1, 16), 6)
        self.assertEqual(self.classify(1, 19.99), 6)
        self.assertEqual(self.classify(1, 20), 7)
        self.assertEqual(self.classify(1, 24), 7)

    def test_invalid_values_and_fill_values_are_missing(self):
        categories = classify_baa(
            np.array([np.nan, 100, -32768, 100]),
            np.array([0, np.nan, 100, -32768]),
        )
        self.assertTrue(np.all(categories == MISSING))

    def test_missing_days_are_ignored_but_all_missing_stays_missing(self):
        missing = np.array([MISSING], dtype=np.uint8)
        day1 = classify_baa(np.array([120]), np.array([1300]))
        result = maximum_baa_window([(np.array([120]), np.array([1300]), np.array([True])),
                                     (np.array([MISSING]), np.array([MISSING]), np.array([False]))])
        self.assertEqual(int(day1[0]), 5)
        self.assertEqual(int(result[0]), 5)
        self.assertEqual(int(maximum_baa_window([(missing, missing, np.array([False]))])[0]), MISSING)

    def test_maximum_is_taken_after_each_day_is_classified(self):
        result = maximum_baa_window([
            (np.array([120, 0]), np.array([1300, 2400]), np.array([True, True])),
            (np.array([100, 0]), np.array([300, 0]), np.array([True, True])),
        ])
        self.assertEqual(int(result[0]), 5)  # HotSpot 1.2 and DHW 13 is Alert Level 3.
        self.assertEqual(int(result[1]), 0)
        self.assertEqual(self.classify(1.2, 13), 5)  # Not clamped by legacy 0..4 mirror metadata.

    def test_category_validation_rejects_unknown_codes(self):
        validate_category_array(np.array([0, 7, 255], dtype=np.uint8))
        with self.assertRaisesRegex(ValueError, "0..7"):
            validate_category_array(np.array([8], dtype=np.uint8))

    def test_failed_preflight_preserves_published_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            output = root / "published"
            output.mkdir()
            metadata = output / "metadata.json"
            metadata.write_text('{"dataDate":"2026-09-28","version":"last-valid"}', encoding="utf-8")
            with self.assertRaises(FileNotFoundError):
                build(source, output)
            self.assertEqual(metadata.read_text(encoding="utf-8"), '{"dataDate":"2026-09-28","version":"last-valid"}')


if __name__ == "__main__":
    unittest.main()
