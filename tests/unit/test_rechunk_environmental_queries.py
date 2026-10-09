import gzip
import json
from pathlib import Path
import struct
import tempfile
import unittest

from scripts.rechunk_environmental_queries import clarity_v2, temperature_v2
from tools import stage_data_release


class RechunkEnvironmentalQueriesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "data"
        (self.root / "temperature/query/chunks").mkdir(parents=True)
        (self.root / "water_clarity/query/chunks").mkdir(parents=True)

    def tearDown(self):
        self.temp.cleanup()

    def test_temperature_slices_are_byte_identical_and_addressed_by_month_depth(self):
        source = self.root / "temperature/query"
        metadata = {
            "format": "diveatlas-temperature-query", "format_version": 1,
            "generation_version": "fixture", "available_months": [8, 9],
            "available_depths_m": [5.0, 10.0], "chunk_degrees": 2,
            "chunk_halo_cells": 0, "chunk_grid": {"rows": 1, "columns": 1},
            "grid": {"latitude_count": 1, "longitude_count": 2,
                     "latitude_step_degrees": 1, "longitude_step_degrees": 1},
            "value_encoding": {"dtype": "int16", "byte_order": "little"},
        }
        (source / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
        values = [100, 101, 200, 201, 300, 301, 400, 401]
        raw = struct.pack("<8h", *values)
        with gzip.open(source / "chunks/r00_c00.i16.gz", "wb") as target:
            target.write(raw)

        output = self.root / "temperature/query/v2"
        result = temperature_v2(self.root, output)
        self.assertEqual(result["files"], 4)
        for month_index, month in enumerate((8, 9)):
            for depth_index, depth in enumerate((5, 10)):
                index = month_index * 4 + depth_index * 2
                target = output / f"chunks/{month:02d}/{depth:02d}/r00_c00.i16.gz"
                with gzip.open(target, "rb") as source_file:
                    self.assertEqual(source_file.read(), struct.pack("<2h", *values[index:index + 2]))
        converted = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(converted["format_version"], 2)
        self.assertIn("{month}/{depth}", converted["chunk_file_template"])

    def test_clarity_slices_are_byte_identical_and_addressed_by_month(self):
        source = self.root / "water_clarity"
        metadata = {
            "format": "diveatlas-water-clarity", "format_version": 1,
            "generated_at_utc": "fixture", "available_months": [8, 9],
            "grid": {"latitude_count": 1, "longitude_count": 2},
            "value_encoding": {"dtype": "uint8", "scale_m": 0.5, "missing_sentinel": 255},
            "query": {"chunk_degrees": 2, "chunk_grid": {"rows": 1, "columns": 1},
                      "chunks": [{"row": 0, "column": 0, "file": "r00_c00.u8.gz",
                                  "row_start": 0, "column_start": 0, "rows": 1, "columns": 2}]},
        }
        (source / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
        with gzip.open(source / "query/chunks/r00_c00.u8.gz", "wb") as target:
            target.write(bytes((1, 2, 3, 4)))

        output = self.root / "water_clarity/query/v2"
        result = clarity_v2(self.root, output)
        self.assertEqual(result["files"], 2)
        for month, expected in ((8, bytes((1, 2))), (9, bytes((3, 4)))):
            target = output / f"chunks/{month:02d}/r00_c00.u8.gz"
            with gzip.open(target, "rb") as source_file:
                self.assertEqual(source_file.read(), expected)
        converted = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(converted["format_version"], 2)
        self.assertIn("{month}", converted["query"]["chunk_file_template"])

    def test_environmental_extension_stages_only_v2_assets_with_a_verified_inventory(self):
        temp_meta = self.root / "data/temperature/query/v2/metadata.json"
        clarity_meta = self.root / "data/water_clarity/query/v2/metadata.json"
        temp_meta.parent.mkdir(parents=True)
        clarity_meta.parent.mkdir(parents=True)
        temp_meta.write_text("temperature-v2", encoding="utf-8")
        clarity_meta.write_text("clarity-v2", encoding="utf-8")
        previous_root = stage_data_release.ROOT
        stage_data_release.ROOT = self.root
        try:
            staged = stage_data_release.stage(
                "fixture", self.root / "releases", environmental_query_only=True
            )
            release_root = Path(staged["releaseDirectory"])
            manifest = stage_data_release.verify_release(release_root)
        finally:
            stage_data_release.ROOT = previous_root
        self.assertEqual(manifest["fileCount"], 2)
        self.assertEqual({item["path"] for item in manifest["files"]}, {
            "data/temperature/query/v2/metadata.json",
            "data/water_clarity/query/v2/metadata.json",
        })


if __name__ == "__main__":
    unittest.main()
