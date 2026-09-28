import tempfile
import unittest
from io import StringIO
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

from tools.temperature.build import (
    colorize,
    build_query_dataset,
    acquisition_candidates,
    download_source,
    depth_level_index,
    parse_ascii_level,
    PERIOD_CONFIG,
    NormalizedTemperatureGrid,
    TemperatureSourceMetadata,
    SOURCE_CONFIG,
    source_filename,
    nearest_indices,
    tile_pixel_coordinates,
    tile_range,
    write_tile,
    query_chunk_index,
)


class TemperatureBuildTests(unittest.TestCase):
    def test_circular_nearest_indices_support_both_longitude_conventions_and_dateline(self):
        signed_longitudes = np.array([-179.5, -170.5, -10.5, 0.5, 9.5, 169.5, 179.5])
        targets = np.array([190.0, 350.0, 10.0, 170.0, 180.0])
        expected_indices = np.array([1, 2, 4, 5, 0])

        np.testing.assert_array_equal(
            nearest_indices(signed_longitudes, targets, circular=True),
            expected_indices,
        )
        np.testing.assert_array_equal(
            nearest_indices(np.mod(signed_longitudes, 360.0), targets, circular=True),
            expected_indices,
        )

    def test_query_chunk_coordinates_support_source_resolution_and_north_to_south_order(self):
        latitude = np.array([1.5, 0.5, -0.5, -1.5])
        longitude = np.arange(0.5, 20.0, 1.0)
        lat_step, lon_step, rows, columns, lat_indices, lon_indices = query_chunk_index(latitude, longitude, 1.0)
        self.assertEqual((lat_step, lon_step), (1.0, 1.0))
        self.assertEqual((rows, columns), (10, 10))
        np.testing.assert_array_equal(lat_indices, [0, 1, 2, 3])
        np.testing.assert_array_equal(lon_indices[:3], [0, 1, 2])

    def test_query_chunks_keep_month_and_depth_values_and_masked_cells(self):
        from unittest.mock import patch
        import gzip
        import json
        import struct

        lat = np.array([1.5, 0.5, -0.5, -1.5])
        lon = np.arange(0.5, 20.0, 1.0)
        depths = np.array([0.0, 5.0, 20.0])
        values = np.ma.array(np.full((3, len(lat), len(lon)), 27.25, dtype=np.float32))
        values.mask = np.zeros(values.shape, dtype=bool)
        values.mask[2, 1, 1] = True
        valid = ~np.ma.getmaskarray(values)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch('tools.temperature.build.read_query_month', return_value=(depths, lat, lon, values, valid)):
                metadata = build_query_dataset({9: (Path('fixture.nc'), 'local', '')}, output, '1.0', 'decav')
            self.assertEqual(metadata['available_months'], [9])
            self.assertEqual(metadata['available_depths_m'], [0.0, 5.0, 20.0])
            chunk = {'rows': 4, 'columns': 12, 'data_row_start': 0, 'data_column_start': 19,
                     'uncompressed_bytes': 1 * 3 * 4 * 12 * 2}
            compressed = (output / 'query' / 'chunks' / 'r00_c00.i16.gz').read_bytes()
            raw = gzip.decompress(compressed)
            self.assertLessEqual(len(compressed), metadata['chunk_size_summary']['compressed_max_bytes'])
            self.assertEqual(len(raw), chunk['uncompressed_bytes'])
            self.assertEqual(struct.unpack_from('<h', raw, 0)[0], 2725)
            local_column = (1 - chunk['data_column_start'] + 20) % 20
            missing_offset = ((2 * chunk['rows'] + (1 - chunk['data_row_start'])) * chunk['columns'] + local_column) * 2
            self.assertEqual(struct.unpack_from('<h', raw, missing_offset)[0], -32768)
            saved = json.loads((output / 'query' / 'metadata.json').read_text(encoding='utf-8'))
            self.assertEqual(saved['format_version'], 1)
            self.assertEqual(saved['value_encoding']['dimensions'], ['month', 'depth', 'latitude', 'longitude'])

    def test_test_region_covers_eastern_indonesia_and_west_papua_at_native_zoom(self):
        xs, ys = tile_range({"west": 126, "east": 143, "south": -12, "north": 3}, 2)
        self.assertEqual(list(xs), [3])
        self.assertEqual(list(ys), [1, 2])

    def test_official_resolution_profiles_remain_separate(self):
        self.assertEqual(SOURCE_CONFIG["1.0"]["profile"], "development-1deg")
        self.assertEqual(SOURCE_CONFIG["1.0"]["max_native_zoom"], 2)
        self.assertIn("1955-2022", PERIOD_CONFIG["decav"]["description"])
        self.assertEqual(SOURCE_CONFIG["1.0"]["grid_code"], "01")
        self.assertEqual(SOURCE_CONFIG["0.25"]["profile"], "production-0.25deg")
        self.assertEqual(SOURCE_CONFIG["0.25"]["max_native_zoom"], 3)
        self.assertIn("1991-2020", PERIOD_CONFIG["decav91C0"]["description"])

    def test_ascii_name_and_official_depth_index_select_20m_level_five(self):
        self.assertEqual(source_filename("1.0", "decav", 9, "ascii-gzip"), "woa23_decav_t09an01.dat.gz")
        self.assertEqual(depth_level_index(20), 4)

    def test_gdex_access_order_and_noaa_ascii_fallback_are_explicit(self):
        gdex = acquisition_candidates(9, "1.0", "decav", "gdex")
        self.assertIn("osdf-data.gdex.ucar.edu/ncar/gdex/d285000/woa23_netcdf/woa23_decav_t09_01.nc", gdex[0][1])
        self.assertIn("tds.gdex.ucar.edu/thredds/fileServer/", gdex[1][1])
        noaa = acquisition_candidates(9, "1.0", "decav", "noaa")
        self.assertEqual(noaa[0][0], "ascii-gzip")
        self.assertEqual(noaa[0][1], "https://www.ncei.noaa.gov/data/oceans/woa/WOA23/DATA/temperature/ascii/decav/1.00/woa23_decav_t09an01.dat.gz")

    def test_validated_cache_is_reused_without_network_access(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "woa23_decav_t09_01.nc"
            source.write_bytes(b"cached test source")
            source.with_name(source.name + ".source.json").write_text(
                '{"provider":"gdex","url":"https://example.invalid/source"}', encoding="utf-8"
            )
            with patch("tools.temperature.build.validate_source_file") as validate, \
                    patch("tools.temperature.build.urlopen", side_effect=AssertionError("network must not be used")):
                result = download_source(9, "1.0", "decav", Path(directory), "auto")
            validate.assert_called_once_with(source, "1.0", "decav", 9)
            self.assertEqual(result, (source, "gdex", "https://example.invalid/source"))

    def test_remote_download_is_validated_cached_and_reused(self):
        class Response(BytesIO):
            status = 200

        payload = b"synthetic transport payload for the downloader contract " * 32
        url = "https://example.invalid/woa23_decav_t09_01.nc"
        with tempfile.TemporaryDirectory() as directory:
            with patch("tools.temperature.build.acquisition_candidates", return_value=[("netcdf", url)]), \
                    patch("tools.temperature.build.urlopen", return_value=Response(payload)) as open_url, \
                    patch("tools.temperature.build.validate_source_file") as validate:
                path, provider, fetched_url = download_source(9, "1.0", "decav", Path(directory), "gdex")
                self.assertEqual(path.read_bytes(), payload)
                self.assertEqual((provider, fetched_url), ("gdex", url))
                validate.assert_called_once_with(path, "1.0", "decav", 9)
                receipt = path.with_name(path.name + ".source.json")
                self.assertIn('"provider": "gdex"', receipt.read_text(encoding="utf-8"))

            with patch("tools.temperature.build.validate_source_file"), \
                    patch("tools.temperature.build.urlopen", side_effect=AssertionError("cached source should avoid network")) as retry_url:
                reused = download_source(9, "1.0", "decav", Path(directory), "auto")
            retry_url.assert_not_called()
            self.assertEqual(reused, (path, "gdex", url))

    def test_compact_ascii_parser_extracts_selected_level_and_masks_sentinel(self):
        lines = []
        for level in range(57):
            for line in range(2):
                values = [" 12.5000"] * 10
                if level == 4 and line == 0:
                    values[1] = "-99.9999"
                    values[2] = " 13.2500"
                lines.append("".join(values) + "\n")
        grid = parse_ascii_level(StringIO("".join(lines)), depth_level_index(20), (2, 10))
        self.assertEqual(grid.shape, (2, 10))
        self.assertEqual(float(grid[0, 0]), 12.5)
        self.assertTrue(bool(np.ma.getmaskarray(grid)[0, 1]))
        self.assertEqual(float(grid[0, 2]), 13.25)

    def test_masked_source_cells_remain_transparent_and_valid_cells_are_colored(self):
        lon, lat = tile_pixel_coordinates(3, 6, 4)
        # Build a tiny synthetic source grid around one water pixel and mask its
        # neighbor to exercise the writer's no-interpolation/mask behavior.
        source_lon = np.array([lon[20], lon[21]])
        source_lat = np.array([lat[20], lat[21]])
        values = np.ma.array([[26.0, 26.0], [26.0, 26.0]], mask=[[False, True], [False, True]])
        normalized = NormalizedTemperatureGrid(
            longitude=source_lon, latitude=source_lat, depth=20, month=9,
            temperature_c=values, valid_mask=~np.ma.getmaskarray(values),
            metadata=TemperatureSourceMetadata(
                source_name="test", source_product="test WOA23", climatology_period="decav",
                source_resolution=1, source_type="analyzed mean", source_url="test://source",
                generated_at="test",
            ),
        )
        with tempfile.TemporaryDirectory() as directory:
            tile = Path(directory) / "8" / "6" / "4.png"
            stats = write_tile(normalized, tile, 3, 6, 4)
            self.assertGreater(stats["valid_pixels"], 0)
            self.assertGreater(stats["transparent_pixels"], 0)
            rgba = np.asarray(Image.open(tile).convert("RGBA"))
            self.assertTrue(np.any(rgba[:, :, 3] == 0))
            self.assertTrue(np.any(rgba[:, :, 3] > 0))

    def test_invalid_pixels_are_transparent_without_zero_temperature_fallback(self):
        rgba = colorize(np.array([[0.0, 28.0]], dtype=np.float32), np.array([[False, True]]))
        self.assertEqual(int(rgba[0, 0, 3]), 0)
        self.assertEqual(int(rgba[0, 1, 3]), 220)


if __name__ == "__main__":
    unittest.main()
