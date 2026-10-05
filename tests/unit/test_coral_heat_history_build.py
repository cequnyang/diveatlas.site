import gzip
import tempfile
import unittest
from pathlib import Path

import numpy as np

from tools.coral_heat_stress.build_history import (
    MAP_COLORS,
    MAP_ALPHA,
    POINT_HEADER,
    _validate_point_tile,
    _write_point_tiles,
    dhw_map_bins,
)
from tools.coral_heat_stress.build_global_history import CONTEXT_ALPHA, REEF_ALPHA


class CoralHeatStressHistoryBuildTests(unittest.TestCase):
    def test_history_dhw_bins_share_current_severity_tokens(self):
        self.assertEqual(MAP_COLORS[1].tolist(), [255, 235, 145])
        self.assertEqual(MAP_COLORS[2].tolist(), [246, 177, 52])
        self.assertEqual(MAP_COLORS[3].tolist(), [240, 111, 31])
        self.assertEqual(MAP_COLORS[6].tolist(), [105, 35, 132])
        self.assertEqual(MAP_ALPHA.tolist(), [0, 46, 61, 72, 87, 102, 128])
        self.assertEqual(CONTEXT_ALPHA.tolist(), [0, 42, 74, 104, 136, 166, 194])
        self.assertEqual(REEF_ALPHA.tolist(), [0, 88, 124, 160, 196, 226, 250])

    def test_continuous_dhw_bins_preserve_transparent_zero_and_threshold_edges(self):
        values = np.array([[0, 0.1, 3.999, 4, 7.999, 8, 12, 16, 20, 38.2571]], dtype=np.float32)
        bins = dhw_map_bins(values, np.ones(values.shape, dtype=bool))
        self.assertEqual(bins.tolist(), [[0, 1, 1, 2, 2, 3, 4, 5, 6, 6]])
        self.assertEqual(MAP_COLORS[6].tolist(), [105, 35, 132])

    def test_missing_and_unanalyzed_values_remain_transparent_not_zero(self):
        fill = np.float32(9.96921e36)
        values = np.array([[0, fill, np.nan, 8]], dtype=np.float32)
        mask = np.array([[True, True, True, False]])
        self.assertEqual(dhw_map_bins(values, mask).tolist(), [[0, 0, 0, 0]])

    def test_dhw_bin_validation_rejects_negative_values_and_shape_mismatch(self):
        with self.assertRaisesRegex(ValueError, "negative"):
            dhw_map_bins(np.array([[-0.01]], dtype=np.float32), np.array([[True]]))
        with self.assertRaisesRegex(ValueError, "same shape"):
            dhw_map_bins(np.array([[1]], dtype=np.float32), np.array([True]))

    def test_sparse_point_tile_retains_source_float32_and_missing_nan(self):
        years = [1985, 1986, 1987]
        rows = np.array([0, 0], dtype=np.int64)
        columns = np.array([0, 1], dtype=np.int64)
        series = np.array([[0.0, 1.1443, 38.257137], [np.nan, 4.0042, np.nan]], dtype="<f4")
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            count, total = _write_point_tiles(series, rows, columns, years, output)
            self.assertEqual((count, total > 0), (174, True))
            path = output / "0_0.bin.gz"
            decompressed = gzip.decompress(path.read_bytes())
            magic, version, tile_size, year_count, column, row, record_count = POINT_HEADER.unpack_from(decompressed)
            self.assertEqual((magic, version, tile_size, year_count, column, row, record_count), (b"DCHH", 1, 256, 3, 0, 0, 2))
            decoded = np.frombuffer(decompressed, dtype="<f4", count=3, offset=POINT_HEADER.size + 2)
            np.testing.assert_array_equal(decoded, series[0])
            self.assertEqual(_validate_point_tile(path, years, 0, 0), 2)


if __name__ == "__main__":
    unittest.main()
