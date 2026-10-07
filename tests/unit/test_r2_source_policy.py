from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import prepare_pages
import stage_data_release


class R2SourcePolicyTests(unittest.TestCase):
    def test_pages_builder_bundles_snapshots_only_for_local_builds(self) -> None:
        local_paths = {
            Path("data/coral_records_snapshot.js"),
            Path("data/fish_map_units.json.gz"),
            Path("datasets/temperature/metadata.json"),
        }

        self.assertTrue(local_paths.issubset(prepare_pages.EXTERNAL_DATA_ROOTS))
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            for relative in local_paths:
                local_file = temporary_root / relative
                local_file.parent.mkdir(parents=True, exist_ok=True)
                local_file.write_bytes(b"local-only test fixture")

            with (
                patch.object(prepare_pages, "ROOT", temporary_root),
                patch.object(prepare_pages, "EXTERNAL_DATA_ROOTS", local_paths),
                patch.object(prepare_pages.subprocess, "run", return_value=SimpleNamespace(stdout=b"")),
            ):
                local_build_files = prepare_pages.tracked_and_untracked_site_files(externalize_data=False)
                production_build_files = prepare_pages.tracked_and_untracked_site_files(externalize_data=True)

        self.assertEqual(set(local_build_files), local_paths)
        self.assertTrue(local_paths.isdisjoint(production_build_files))

    def test_release_staging_skips_former_github_snapshot_paths(self) -> None:
        former_paths = [
            Path("datasets/coral_records_snapshot.js"),
            Path("datasets/fish_map_units.json.gz"),
            Path("data/coral_records_snapshot.js"),
            Path("data/fish_map_units.json.gz"),
            Path("data/temperature/query/example.bin"),
        ]

        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch.object(stage_data_release, "ROOT", Path(temporary_directory)):
                selected = stage_data_release.selected_files(former_paths)
        self.assertEqual(selected, [Path("data/temperature/query/example.bin")])
        self.assertEqual(
            set(stage_data_release.R2_SOURCE_DATA_PATHS),
            {
                "data/coral_records_snapshot.js",
                "data/fish_map_units.json.gz",
            },
        )

    def test_score_map_builder_has_no_local_snapshot_file_paths(self) -> None:
        source = (ROOT / "tools/build_dive_conditions_score_map.js").read_text(encoding="utf-8")

        self.assertNotIn("datasets/coral_records_snapshot.js", source)
        self.assertNotIn("datasets/fish_map_units.json.gz", source)
        self.assertIn("data/coral_records_snapshot.js", source)
        self.assertIn("data/fish_map_units.json.gz", source)

    def test_app_uses_r2_object_paths_without_dataset_path_rewriting(self) -> None:
        index = (ROOT / "index.html").read_text(encoding="utf-8")
        asset_loader = (ROOT / "js/data-assets.js").read_text(encoding="utf-8")
        test_server = (ROOT / "tools/serve_test_site.js").read_text(encoding="utf-8")

        self.assertIn("data/coral_records_snapshot.js?v=83", index)
        self.assertIn("data/fish_map_units.json.gz?v=1", index)
        self.assertNotIn("datasets/coral_records_snapshot.js", index)
        self.assertNotIn("datasets/fish_map_units.json.gz", index)
        self.assertNotIn("assetPath.startsWith('datasets/')", asset_loader)
        self.assertNotIn("releaseSegments", test_server)

if __name__ == "__main__":
    unittest.main()
