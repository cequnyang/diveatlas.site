from __future__ import annotations

import gzip
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "coral_heat_stress"))

from publish_ocean_heat_history import (  # noqa: E402
    QUERY_HEADER,
    QUERY_BYTES_PER_CELL,
    rechunk_query_chunks,
)
from tools.prepare_pages import MHW_PRODUCTION_ROOT, is_curated_ocean_heat_asset  # noqa: E402
from tools.verify_pages_build import verify_ocean_heat_assets  # noqa: E402


class OceanHeatHistoryPublishTests(unittest.TestCase):
    def test_query_rechunking_preserves_record_bytes_and_changes_only_partition(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            output = root / "output"
            source.mkdir()
            records = []
            for row in range(4):
                row_records = []
                for column in range(4):
                    record = bytes([column % 6]) + struct.pack(
                        "<7H", row * 4 + column, 20, 18, 12, 4, 9, 3653,
                    )
                    self.assertEqual(len(record), QUERY_BYTES_PER_CELL)
                    row_records.append(record)
                records.append(row_records)
            raw = bytearray(QUERY_HEADER.pack(b"MHW1", 0, 0))
            raw.extend(b"".join(record for row in records for record in row))
            (source / "0_0.bin.gz").write_bytes(gzip.compress(raw, mtime=0))

            result = rechunk_query_chunks(
                source, output, grid_width=4, grid_height=4, source_size=4, target_size=2,
            )

            self.assertEqual(result["source"]["count"], 1)
            self.assertEqual(result["output"]["count"], 4)
            self.assertEqual(len(result["paths"]), 4)
            for tile_row in range(2):
                for tile_column in range(2):
                    path = output / f"{tile_column}_{tile_row}.bin.gz"
                    payload = gzip.decompress(path.read_bytes())
                    magic, column, row = QUERY_HEADER.unpack_from(payload)
                    self.assertEqual((magic, column, row), (b"MHW1", tile_column, tile_row))
                    expected = b"".join(
                        records[tile_row * 2 + inner_y][tile_column * 2 + inner_x]
                        for inner_y in range(2)
                        for inner_x in range(2)
                    )
                    self.assertEqual(payload[QUERY_HEADER.size:], expected)

    def test_pages_allowlist_accepts_only_metadata_map_tiles_and_query_chunks(self) -> None:
        self.assertTrue(is_curated_ocean_heat_asset(MHW_PRODUCTION_ROOT / "metadata.json"))
        self.assertTrue(is_curated_ocean_heat_asset(MHW_PRODUCTION_ROOT / "tiles/5/31/17.png"))
        self.assertTrue(is_curated_ocean_heat_asset(MHW_PRODUCTION_ROOT / "query/11_5.bin.gz"))
        for path in (
            MHW_PRODUCTION_ROOT / "candidate-b/tiles/0/0/0.png",
            MHW_PRODUCTION_ROOT / "source/daily.nc",
            MHW_PRODUCTION_ROOT / "prototype.html",
            MHW_PRODUCTION_ROOT / "query/1_2.bin",
            MHW_PRODUCTION_ROOT / "tiles/6/0/0.png",
        ):
            self.assertFalse(is_curated_ocean_heat_asset(path), path)

    def test_pages_verifier_rejects_non_curated_files_under_ocean_heat_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            root = site / MHW_PRODUCTION_ROOT
            (root / "tiles").mkdir(parents=True)
            (root / "query").mkdir()
            for zoom in range(6):
                for column in range(2**zoom):
                    for row in range(2**zoom):
                        (root / "tiles" / str(zoom) / str(column)).mkdir(parents=True, exist_ok=True)
                        (root / "tiles" / str(zoom) / str(column) / f"{row}.png").touch()
            for column in range(12):
                for row in range(6):
                    (root / "query" / f"{column}_{row}.bin.gz").touch()
            metadata = {
                "schemaVersion": 1,
                "provider": "NOAA Coral Reef Watch",
                "product": "Marine Heatwave Watch",
                "productVersion": "1.0.1",
                "attribution": "NOAA Coral Reef Watch",
                "sourcePeriod": {"startYear": 2016, "endYear": 2025, "completeYears": 10},
                "query": {"format": "MHW1", "tileSizeCells": 128, "bytesPerCell": 15},
                "categories": [{"label": label} for label in (
                    "No marine heatwave", "Moderate", "Strong", "Severe", "Extreme", "Beyond extreme",
                )],
                "assets": {
                    "mapTileCount": 1365, "mapTileBytes": 0,
                    "queryChunkCount": 72, "queryBytes": 0,
                    "metadataBytes": 0, "totalBytes": 0,
                },
            }
            metadata_path = root / "metadata.json"
            for _ in range(5):
                encoded = json.dumps(metadata, indent=2) + "\n"
                metadata["assets"]["metadataBytes"] = len(encoded.encode())
                metadata["assets"]["totalBytes"] = metadata["assets"]["metadataBytes"]
                if len((json.dumps(metadata, indent=2) + "\n").encode()) == metadata["assets"]["metadataBytes"]:
                    break
            metadata_path.write_bytes((json.dumps(metadata, indent=2) + "\n").encode("utf-8"))

            result = verify_ocean_heat_assets(site)
            self.assertTrue(result["onlyCuratedAssets"])
            self.assertEqual(result["mapTileCount"], 1365)
            self.assertEqual(result["queryChunkCount"], 72)

            extra = root / "candidate-b" / "tiles" / "0" / "0" / "0.png"
            extra.parent.mkdir(parents=True)
            extra.touch()
            with self.assertRaisesRegex(ValueError, "Non-production Ocean Heat History"):
                verify_ocean_heat_assets(site)


if __name__ == "__main__":
    unittest.main()
