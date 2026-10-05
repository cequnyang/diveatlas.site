import csv
import io
import tempfile
import unittest
from unittest import mock
import zipfile
from pathlib import Path

from tools.reef_condition.seaview_adapter import (
    DATASET_DOI,
    PAPER_CITATION,
    REGION_TABLES,
    SURVEYS_TABLE,
    LABELSETS_TABLE,
    adapt_archive,
    build_ui_metadata,
    parse_fraction,
    spherical_midpoint,
    validate_with_runtime_schema,
    write_outputs,
)
from tools.prepare_pages import EXCLUDED_FILES, EXCLUDED_PATH_PREFIXES
from tools import verify_pages_build
from tools.verify_pages_build import FORBIDDEN_PATHS


SURVEY_FIELDS = [
    "surveyid", "transectid", "surveydate", "ocean", "country", "folder_name",
    "lat_start", "lng_start", "lat_end", "lng_end", "pr_hard_coral", "pr_algae",
    "pr_soft_coral", "pr_oth_invert", "pr_other",
]
LABELSET_FIELDS = ["region", "label", "func_group", "label_name", "merged_label", "merged_name"]
QUADRAT_FIELDS = ["surveyid", "imageid", "quadratid", "lat", "lng", "MACRO", "CCA", "TURF"]


def survey_row(survey_id, transect_id, date, hard_coral, *, start_lon="-61.0", end_lon="-60.99"):
    return {
        "surveyid": survey_id, "transectid": transect_id, "surveydate": date,
        "ocean": "ATL", "country": "ATG", "folder_name": f"ATL_ATG_{survey_id}_201209",
        "lat_start": "17.1", "lng_start": start_lon, "lat_end": "17.11", "lng_end": end_lon,
        "pr_hard_coral": hard_coral, "pr_algae": "0.5", "pr_soft_coral": "0.1",
        "pr_oth_invert": "0.1", "pr_other": "0.3",
    }


def quadrat_row(survey_id, image_id, quadrat_id, macro, cca="0", turf="0"):
    return {
        "surveyid": survey_id, "imageid": image_id, "quadratid": quadrat_id,
        "lat": "17.1", "lng": "-61.0", "MACRO": macro, "CCA": cca, "TURF": turf,
    }


def write_csv(archive, name, fields, rows):
    text = io.StringIO(newline="")
    writer = csv.DictWriter(text, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    archive.writestr(name, text.getvalue().encode("utf-8"))


class SeaviewAdapterTests(unittest.TestCase):
    def make_archive(self, directory):
        path = Path(directory) / "sanitized-seaview.zip"
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            write_csv(archive, SURVEYS_TABLE, SURVEY_FIELDS, [
                survey_row("10001", "site-a", "20120916", "0.25", start_lon="179.9", end_lon="-179.9"),
                survey_row("10002", "site-a", "20130917", "0"),
                survey_row("20001", "site-b", "", "0.5"),
                survey_row("bad-date", "site-c", "20190230", "0.2"),
            ])
            labels = []
            for region in REGION_TABLES:
                labels.extend([
                    {"region": region, "label": "MACRO", "func_group": "Algae", "label_name": "Macroalgae", "merged_label": "MALG", "merged_name": "Macroalgae"},
                    {"region": region, "label": "CCA", "func_group": "Algae", "label_name": "Crustose Coralline Algae", "merged_label": "CCA", "merged_name": "CCA"},
                    {"region": region, "label": "TURF", "func_group": "Algae", "label_name": "Turf algae", "merged_label": "EAM", "merged_name": "Epilithic Algal Matrix"},
                ])
            write_csv(archive, LABELSETS_TABLE, LABELSET_FIELDS, labels)
            write_csv(archive, REGION_TABLES["Atlantic"], QUADRAT_FIELDS, [
                quadrat_row("10001", "image-1", "q-1", "0.1", "0.5", "0.1"),
                quadrat_row("10001", "image-1", "q-2", "0.3", "0.1", "0.5"),
                quadrat_row("10001", "image-2", "q-3", "0.8"),
                quadrat_row("10002", "image-3", "q-4", "0"),
                quadrat_row("20001", "image-4", "q-5", ""),
            ])
            for region, table in REGION_TABLES.items():
                if region != "Atlantic":
                    write_csv(archive, table, QUADRAT_FIELDS, [])
        return path

    def test_fraction_zero_missing_invalid_and_great_circle_midpoint(self):
        self.assertEqual(parse_fraction("0"), 0)
        self.assertIsNone(parse_fraction(""))
        self.assertEqual(parse_fraction("0.347"), 34.7)
        with self.assertRaisesRegex(ValueError, "outside_fraction_range"):
            parse_fraction("1.01")
        with self.assertRaisesRegex(ValueError, "outside_fraction_range"):
            parse_fraction("-0.01")
        lat, lon = spherical_midpoint(0, 179.9, 0, -179.9)
        self.assertAlmostEqual(lat, 0)
        self.assertAlmostEqual(abs(lon), 180)

    def test_canonical_conversion_preserves_source_hierarchy_and_metric_semantics(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.make_archive(directory)
            dataset, report, manifest = adapt_archive(
                source, generated_at="2026-10-02T00:00:00Z", require_pinned_source=False
            )

        self.assertEqual(dataset["schemaVersion"], 3)
        self.assertEqual(dataset["metadata"]["sourceDoi"], DATASET_DOI)
        self.assertIsNone(dataset["metadata"]["redistributionApproved"])
        self.assertEqual(len(dataset["records"]), 3)
        first, second, undated = dataset["records"]
        hard = first["protocols"][0]["metrics"]["hardCoralCover"]["valuePct"]
        macro = first["protocols"][0]["metrics"]["macroalgaeCover"]["valuePct"]
        self.assertEqual(hard, 25)
        self.assertEqual(macro, 50)
        self.assertEqual(first["protocols"][0]["sampleUnitCount"], 2)
        self.assertEqual(first["location"]["sourceSiteId"], "site-a")
        self.assertEqual(first["provenance"]["sourceRecordId"], "10001")
        self.assertIsNone(first["provenance"]["license"])
        self.assertEqual(first["provenance"]["suggestedCitation"], PAPER_CITATION)
        self.assertEqual(first["provenance"]["sourceUrl"], "https://doi.org/10.14264/uql.2019.930")
        self.assertIn("not relabeled live coral", first["provenance"]["sourceMetricSemantics"]["hardCoralCover"])
        self.assertEqual(first["protocols"][0]["method"], "SVII transect photo-quadrat survey with automated benthic image classification")
        self.assertEqual(second["protocols"][0]["metrics"]["hardCoralCover"]["valuePct"], 0)
        self.assertEqual(second["protocols"][0]["metrics"]["macroalgaeCover"]["valuePct"], 0)
        self.assertIsNone(undated["survey"]["date"])
        self.assertEqual(undated["survey"]["datePrecision"], "unknown")
        self.assertIsNone(undated["protocols"][0]["metrics"]["macroalgaeCover"]["valuePct"])
        self.assertEqual(report["repeatSites"]["twoSurveySites"], 1)
        self.assertEqual(report["repeatSites"]["repeatSiteDateSpanDays"]["sitesWithAtLeastTwoDates"], 1)
        self.assertEqual(report["repeatSites"]["repeatSiteDateSpanDays"]["min"], 366)
        self.assertEqual(report["qualityChecks"]["invalidSurveyDates"], 1)
        self.assertEqual(report["metricCoverage"]["hardCoralCover"]["measuredZero"], 1)
        self.assertEqual(report["metricCoverage"]["macroalgaeCover"]["measuredZero"], 1)
        self.assertEqual(report["licenseReview"]["status"], "conflicting")
        self.assertFalse(report["licenseReview"]["productionRedistributionApproved"])
        self.assertEqual(manifest["checksum"]["algorithm"], "SHA-256")

    def test_local_ui_metadata_keeps_the_license_conflict_unresolved(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.make_archive(directory)
            dataset, _, _ = adapt_archive(source, generated_at="2026-10-02T00:00:00Z", require_pinned_source=False)
        metadata = build_ui_metadata(dataset, 1234)
        self.assertEqual(metadata["canonicalSchemaVersion"], 3)
        self.assertEqual(metadata["eventCount"], 3)
        self.assertEqual(metadata["siteCount"], 2)
        self.assertEqual(metadata["dataUrl"], "./data/.build/reef_condition/seaview/canonical.json.gz")
        self.assertEqual(metadata["licenseReview"]["status"], "conflicting")
        self.assertFalse(metadata["productionRedistributionApproved"])
        self.assertEqual(metadata["licenseDisplay"], "License under clarification — local evaluation only")

    def test_generated_records_pass_runtime_canonical_validator(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.make_archive(directory)
            dataset, _, _ = adapt_archive(source, require_pinned_source=False)
        validate_with_runtime_schema(dataset)

    def test_runtime_canonical_validator_rejects_out_of_range_percentages(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.make_archive(directory)
            dataset, _, _ = adapt_archive(source, require_pinned_source=False)
        dataset["records"][0]["protocols"][0]["metrics"]["hardCoralCover"]["valuePct"] = 100.01
        with self.assertRaisesRegex(ValueError, "valuePct"):
            validate_with_runtime_schema(dataset)

    def test_pinned_source_guard_rejects_unmatched_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.make_archive(directory)
            with self.assertRaisesRegex(ValueError, "does not match the pinned"):
                adapt_archive(source)

    def test_local_research_data_cannot_enter_pages_output(self):
        research_root = Path("data/.build")
        seaview_root = Path("data/reef-condition/seaview")
        local_module = Path("js/reef-condition-seaview-local.js")
        self.assertIn(research_root, EXCLUDED_PATH_PREFIXES)
        self.assertIn(seaview_root, EXCLUDED_PATH_PREFIXES)
        self.assertIn(seaview_root, FORBIDDEN_PATHS)
        self.assertIn(local_module.name, EXCLUDED_FILES)
        self.assertIn(local_module, verify_pages_build.FORBIDDEN_PATHS)
        generic_local_module = Path("js/reef-condition-local-research.js")
        self.assertIn(generic_local_module.name, EXCLUDED_FILES)
        self.assertIn(generic_local_module, verify_pages_build.FORBIDDEN_PATHS)

    def test_pages_verifier_rejects_a_seaview_path_in_a_production_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "_site"
            output.mkdir()
            (output / "index.html").write_text("<html></html>", encoding="utf-8")
            with mock.patch.object(verify_pages_build, "ROOT", Path(directory).resolve()):
                forbidden = output / "data/reef-condition/seaview/canonical.json.gz"
                forbidden.parent.mkdir(parents=True)
                forbidden.write_bytes(b"forbidden")
                with self.assertRaisesRegex(ValueError, r"data[\\/]reef-condition[\\/]seaview"):
                    verify_pages_build.verify(output)
                forbidden.unlink()
                forbidden.parent.rmdir()
                (output / "data/reef-condition").rmdir()
                (output / "data").rmdir()
                misplaced = output / "data/research/Seaview-observations.json"
                misplaced.parent.mkdir(parents=True, exist_ok=True)
                misplaced.write_text("forbidden", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "Local-only Seaview asset"):
                    verify_pages_build.verify(output)

    def test_adapter_refuses_outputs_outside_ignored_local_research_root(self):
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory)
            with self.assertRaisesRegex(ValueError, "must remain under data/.build"):
                write_outputs(
                    output_root / "not-read.zip",
                    output_root / "canonical.json.gz",
                    output_root / "report.json",
                    output_root / "manifest.json",
                )


if __name__ == "__main__":
    unittest.main()
