import tempfile
import unittest
from pathlib import Path

import numpy as np
from netCDF4 import Dataset

from tools.water_clarity.build import (
    NODATA,
    QUANTIZATION_MAX_METRES,
    normalize_month_stack,
    quantize,
    write_query_chunks,
    build,
)


def write_fixture(path: Path, values: np.ndarray) -> None:
    with Dataset(path, "w") as dataset:
        dataset.createDimension("lat", 2)
        dataset.createDimension("lon", 4)
        dataset.createDimension("time", 1)
        latitude = dataset.createVariable("lat", "f4", ("lat",))
        longitude = dataset.createVariable("lon", "f4", ("lon",))
        latitude[:] = [1.0, -1.0]
        longitude[:] = [0.0, 90.0, 180.0, 270.0]
        zsd = dataset.createVariable("ZSD", "f4", ("time", "lat", "lon"), fill_value=-9999.0)
        zsd[0, :, :] = values


class WaterClarityBuildTests(unittest.TestCase):
    def test_coordinates_are_sorted_and_longitudes_normalized(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "2016-01.nc"
            values = np.array([[10, 20, 30, 40], [50, 60, 70, 80]], dtype=np.float32)
            write_fixture(path, values)
            latitude, longitude, data, stats = normalize_month_stack([path])
            np.testing.assert_array_equal(latitude, [-1, 1])
            np.testing.assert_array_equal(longitude, [-180, -90, 0, 90])
            np.testing.assert_array_equal(data[0], [70, 80, 50, 60])
            self.assertEqual(stats["observations"], 1)

    def test_climatology_uses_per_cell_median_and_preserves_missing_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = []
            samples = [
                [[10, -9999, 30, 40], [50, 60, 70, 80]],
                [[14, 20, 34, 50], [50, 62, 68, 90]],
                [[12, 25, 32, 45], [55, 64, 72, 100]],
            ]
            for sample in samples:
                sample[0][1] = -9999
            for index, values in enumerate(samples):
                path = root / f"201{6 + index}-01.nc"
                write_fixture(path, np.asarray(values, dtype=np.float32))
                files.append(path)
            latitude, longitude, median, stats = normalize_month_stack(files)
            self.assertEqual(float(median[0, 0]), 70)
            self.assertEqual(float(median[1, 2]), 12)
            self.assertTrue(np.isnan(median[1, 3]))
            self.assertEqual(stats["observations"], 3)
            self.assertGreater(stats["no_data_percent"], 0)

    def test_quantization_round_trip_and_clipping_are_explicit(self):
        encoded, clipped = quantize(np.array([[0, 3.26, np.nan, QUANTIZATION_MAX_METRES + 5]]))
        self.assertEqual(encoded[0, 0], 0)
        self.assertEqual(encoded[0, 1], 7)
        self.assertEqual(encoded[0, 2], NODATA)
        self.assertEqual(float(encoded[0, 1]) * 0.5, 3.5)
        self.assertEqual(encoded[0, 3], NODATA - 1)
        self.assertEqual(clipped, 1)

    def test_numeric_chunks_encode_all_months_and_record_dimensions(self):
        latitude = np.array([-0.5, 0.5])
        longitude = np.array([-1.5, -0.5, 0.5, 1.5])
        months = {month: np.full((2, 4), month, dtype=np.uint8) for month in range(1, 13)}
        months[1][0, 0] = NODATA
        with tempfile.TemporaryDirectory() as directory:
            metadata = write_query_chunks(months, latitude, longitude, Path(directory))
            self.assertEqual(metadata["chunk_size_summary"]["count"], 1)
            descriptor = metadata["chunks"][0]
            self.assertEqual((descriptor["rows"], descriptor["columns"]), (2, 4))
            import gzip
            raw = gzip.decompress((Path(directory) / "query" / "chunks" / descriptor["file"]).read_bytes())
            self.assertEqual(len(raw), 12 * 2 * 4)
            self.assertEqual(raw[0], NODATA)
            self.assertEqual(raw[2 * 4], 2)

    def test_sample_build_writes_metadata_and_rejects_sample_as_production(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "sources"
            output = root / "output"
            source.mkdir()
            for year in range(2016, 2026):
                for month in range(1, 13):
                    write_fixture(source / f"{year}-{month:02d}.nc", np.full((2, 4), month, dtype=np.float32))
            metadata = build(source, output, render=False, scope="sample")
            self.assertEqual(metadata["designation"], "development-sample")
            self.assertEqual(metadata["available_months"], list(range(1, 13)))
            self.assertEqual(metadata["value_encoding"]["missing_sentinel"], 255)
            self.assertTrue((output / "query" / "chunks" / "r00_c00.u8.gz").is_file())
            with self.assertRaisesRegex(ValueError, "global latitude and longitude coverage"):
                build(source, root / "production", render=False)


if __name__ == "__main__":
    unittest.main()
