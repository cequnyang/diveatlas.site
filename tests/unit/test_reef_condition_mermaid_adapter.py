import json
import contextlib
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools" / "reef_condition"
sys.path.insert(0, str(TOOLS))

from mermaid_adapter import TransformError, adapt_event, classify_candidates  # noqa: E402
from sample_mermaid import (  # noqa: E402
    NoCredentialsAvailable,
    OUTPUT_DIRECTORY,
    bounded_fetch,
    bounded_global_fetch,
    bounded_project_fetch,
    build_raw_snapshot,
    create_authenticated_client,
    main,
    read_raw_snapshot,
    replay_snapshot,
    run_pilot,
    save_raw_snapshot,
    site_query_parameters,
)


def source_event(event_id="event-1", protocols=None):
    return {
        "sample_event_id": event_id,
        "sample_date": "2024-03-01",
        "site_id": "site-1",
        "site_name": "Cape Kri",
        "latitude": -0.55,
        "longitude": 130.6,
        "country_name": "Indonesia",
        "depth_avg": 8.0,
        "depth_sd": 1.0,
        "project_id": "project-1",
        "project_name": "Raja Ampat monitoring",
        "management_id": "management-1",
        "management_name": "No take",
        "suggested_citation": "MERMAID suggested citation",
        "contact_link": "https://datamermaid.org/",  # Not treated as an event source URL.
        "protocols": protocols if protocols is not None else {
            "benthicpit": {
                "sample_unit_count": 2,
                "percent_cover_benthic_category_avg": {"Hard coral": 0},
                "percent_cover_benthic_category_sd": {"Hard coral": 0},
            }
        },
        "data_policy_benthicpit": "public summary",
    }


class AdapterTests(unittest.TestCase):
    def test_api_key_authentication_remains_supported(self):
        calls = []
        secret = "api-key-test-secret"

        class FakeClient:
            def __init__(self, **kwargs):
                calls.append(kwargs)

        class FakeOAuth:
            def __init__(self, **kwargs):
                raise AssertionError("OAuth must not be constructed when an API key exists")

        sdk = SimpleNamespace(MermaidClient=FakeClient, OAuth=FakeOAuth)
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            client = create_authenticated_client(sdk, secret)
        self.assertIsInstance(client, FakeClient)
        self.assertEqual(calls, [{"api_key": secret, "timeout": 30, "max_retries": 0}])
        self.assertNotIn(secret, stdout.getvalue() + stderr.getvalue())

    def test_valid_cached_oauth_is_checked_non_interactively_and_used_by_client(self):
        calls = []

        class FakeOAuth:
            def __init__(self, **kwargs):
                calls.append(("oauth", kwargs))

            def access_token(self):
                calls.append(("token-check",))
                return "oauth-access-token-test-secret"

        oauth_instances = []

        class FakeClient:
            def __init__(self, **kwargs):
                calls.append(("client", kwargs))
                self.kwargs = kwargs

        def oauth_factory(**kwargs):
            calls.append(("oauth", kwargs))
            oauth = FakeOAuth(**kwargs)
            oauth_instances.append(oauth)
            return oauth

        sdk = SimpleNamespace(
            MermaidClient=FakeClient,
            OAuth=oauth_factory,
            AuthFlowError=type("AuthFlowError", (Exception,), {}),
        )
        client = create_authenticated_client(sdk, None)
        self.assertIsInstance(client, FakeClient)
        self.assertIs(client.kwargs["auth"], oauth_instances[0])
        self.assertEqual(client.kwargs["max_retries"], 0)
        self.assertIn(("oauth", {"interactive": False}), calls)

    def test_no_credentials_stops_with_safe_login_instruction_before_data_request(self):
        secret_marker = "cached-oauth-secret-marker"
        requests = []

        class AuthFlowError(Exception):
            pass

        class FakeOAuth:
            def __init__(self, **kwargs):
                self.interactive = kwargs["interactive"]

            def access_token(self):
                raise AuthFlowError(secret_marker)

        class FakeClient:
            def __init__(self, **kwargs):
                requests.append("client-created")

        sdk = SimpleNamespace(MermaidClient=FakeClient, OAuth=FakeOAuth, AuthFlowError=AuthFlowError)
        stderr = io.StringIO()
        with patch.dict(sys.modules, {"datamermaid": sdk}), patch.dict(os.environ, {"MERMAID_API_KEY": ""}):
            with contextlib.redirect_stderr(stderr), self.assertRaises(SystemExit):
                main(["--max-events", "30"])
        self.assertEqual(requests, [])
        self.assertIn("No MERMAID credentials available", stderr.getvalue())
        self.assertIn("datamermaid.login()", stderr.getvalue())
        self.assertNotIn(secret_marker, stderr.getvalue())

    def test_oauth_credential_contents_are_not_logged(self):
        access_token = "oauth-access-token-test-secret"

        class AuthFlowError(Exception):
            pass

        class FakeOAuth:
            def __init__(self, **kwargs):
                pass

            def access_token(self):
                raise AuthFlowError(access_token)

        sdk = SimpleNamespace(MermaidClient=object, OAuth=FakeOAuth, AuthFlowError=AuthFlowError)
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            with self.assertRaises(NoCredentialsAvailable):
                create_authenticated_client(sdk, None)
        self.assertNotIn(access_token, stderr.getvalue())

    def test_pit_maps_hard_coral_macroalgae_sd_zero_and_missing_without_inference(self):
        source = source_event()
        record, diagnostics = adapt_event(source)
        protocol = record["protocols"][0]
        self.assertEqual(protocol["method"], "PIT")
        self.assertEqual(protocol["sourceMethod"], "benthicpit")
        self.assertEqual(protocol["sampleUnitCount"], 2)
        self.assertEqual(protocol["depth"], {"meanM": 8.0, "sdM": 1.0})
        self.assertEqual(protocol["metrics"]["liveCoralCover"], {
            "valuePct": 0, "sdPct": 0, "basis": "benthic-cover"
        })
        self.assertEqual(protocol["metrics"]["macroalgaeCover"], {
            "valuePct": None, "sdPct": None, "basis": "benthic-cover"
        })
        macro_diagnostic = next(item for item in diagnostics if item["metric"] == "macroalgaeCover" and item["canonicalPath"].endswith("valuePct"))
        self.assertEqual(macro_diagnostic["sourceValue"], None)
        self.assertEqual(macro_diagnostic["canonicalValue"], None)

    def test_multiple_benthic_protocols_remain_separate_and_ambiguous(self):
        protocols = {
            "benthicpit": {"sample_unit_count": 2, "percent_cover_benthic_category_avg": {"Hard coral": 40}},
            "benthiclit": {"sample_unit_count": 3, "percent_cover_benthic_category_avg": {"Hard coral": 60}},
        }
        record, _ = adapt_event(source_event(protocols=protocols))
        self.assertEqual([item["method"] for item in record["protocols"]], ["PIT", "LIT"])
        status, candidates = classify_candidates(record, "liveCoralCover")
        self.assertEqual(status, "AMBIGUOUS")
        self.assertEqual([candidate["value"] for candidate in candidates], [40, 60])
        self.assertEqual([candidate["method"] for candidate in candidates], ["PIT", "LIT"])

    def test_bleaching_categories_and_colony_count_are_preserved(self):
        protocols = {"bleachingqc": {
            "sample_unit_count": 1,
            "colonies_bleached": {
                "percent_bleached_avg": 20,
                "percent_pale_avg": 10,
                "percent_normal_avg": 65,
                "percent_dead_avg": 5,
                "count_total_avg": 40.0,
            },
            "quadrat_benthic_percent": {"percent_hard_avg_avg": 72.0, "percent_algae_avg_avg": 0.0},
        }}
        record, diagnostics = adapt_event(source_event(protocols=protocols))
        bleaching = record["protocols"][0]["metrics"]["bleaching"]
        self.assertEqual(bleaching, {
            "bleachedColoniesPct": 20,
            "paleColoniesPct": 10,
            "normalColoniesPct": 65,
            "recentlyDeadColoniesPct": 5,
            "colonyCount": 40,
            "basis": "coral-colonies",
        })
        self.assertNotIn("mortality", record["protocols"][0]["metrics"])
        self.assertNotIn("disease", record["protocols"][0]["metrics"])
        self.assertTrue(any(
            item["sourceField"] == "protocols.bleachingqc.quadrat_benthic_percent"
            and item["status"] == "unmapped-source-field"
            for item in diagnostics
        ))

    def test_provenance_policy_and_validator_contract(self):
        record, _ = adapt_event(source_event())
        self.assertEqual(record["schemaVersion"], 2)
        self.assertEqual(record["provenance"]["provider"], "MERMAID")
        self.assertEqual(record["provenance"]["sourceRecordId"], "event-1")
        self.assertEqual(record["location"]["sourceSiteId"], "site-1")
        self.assertEqual(record["provenance"]["projectId"], "project-1")
        self.assertEqual(record["provenance"]["projectName"], "Raja Ampat monitoring")
        self.assertEqual(record["provenance"]["suggestedCitation"], "MERMAID suggested citation")
        self.assertIsNone(record["provenance"]["license"])
        self.assertIsNone(record["provenance"]["sourceUrl"])
        self.assertEqual(record["protocols"][0]["dataPolicy"], "public summary")
        with tempfile.TemporaryDirectory() as temp:
            report = run_pilot([source_event()], Path(temp))
            dataset = json.loads((Path(temp) / "mermaid-pilot.json").read_text(encoding="utf-8"))
        self.assertEqual(report["counts"]["valid"], 1)
        self.assertEqual(report["counts"]["invalid"], 0)
        self.assertEqual(dataset["metadata"]["datasetType"], "local-pilot")
        self.assertEqual(dataset["metadata"]["sourceSiteCount"], 1)

    def test_source_site_id_is_nullable_and_not_inferred_from_site_name(self):
        source = source_event()
        source["site_id"] = None
        record, diagnostics = adapt_event(source)
        self.assertIsNone(record["location"]["sourceSiteId"])
        self.assertTrue(any(item["canonicalPath"] == "location.sourceSiteId" and item["status"] == "missing" for item in diagnostics))

    def test_explicit_license_and_stable_source_url_are_the_only_values_mapped(self):
        source = source_event()
        source["license"] = "Explicit license value"
        source["sample_event_url"] = "https://example.org/events/event-1"
        record, _ = adapt_event(source)
        self.assertEqual(record["provenance"]["license"], "Explicit license value")
        self.assertEqual(record["provenance"]["sourceUrl"], "https://example.org/events/event-1")

    def test_fractional_colony_average_is_not_rounded_into_an_integer_count(self):
        record, diagnostics = adapt_event(source_event(protocols={"bleachingqc": {
            "colonies_bleached": {"count_total_avg": 3.5, "percent_bleached_avg": 0}
        }}))
        self.assertIsNone(record["protocols"][0]["metrics"]["bleaching"]["colonyCount"])
        count = next(item for item in diagnostics if item["metric"] == "colonyCount")
        self.assertEqual(count["sourceValue"], 3.5)
        self.assertEqual(count["canonicalValue"], None)
        self.assertIn("not rounded", count["reason"])

    def test_unsupported_protocol_is_retained_as_other_without_interpreting_metrics(self):
        record, diagnostics = adapt_event(source_event(protocols={"beltfish": {"sample_unit_count": 3, "biomass_kgha_avg": 5}}))
        self.assertEqual(record["protocols"][0]["method"], "other")
        self.assertEqual(record["protocols"][0]["sourceMethod"], "beltfish")
        self.assertEqual(record["protocols"][0]["metrics"], {})
        self.assertTrue(any(item["status"] == "retained-as-other" for item in diagnostics))

    def test_malformed_source_event_has_path_value_and_reason(self):
        with self.assertRaises(TransformError) as caught:
            adapt_event({"sample_event_id": "broken", "protocols": []})
        self.assertEqual(caught.exception.source_path, "protocols")
        self.assertEqual(caught.exception.source_value, [])
        self.assertIn("must be an object", caught.exception.reason)

    def test_bounded_fetch_uses_country_and_site_filters_and_stops_at_cap(self):
        class FakeResource:
            def __init__(self):
                self.calls = []

            def list(self, **filters):
                self.calls.append(filters)
                site = filters["site_name"]
                return [source_event(f"{site}-{index}") for index in range(20)]

        class FakeClient:
            def __init__(self):
                self.summary_sample_events = FakeResource()

        client = FakeClient()
        fetched = bounded_fetch(client, ("Cape Kri", "Yenbuba"), 7)
        self.assertEqual(len(fetched), 7)
        self.assertEqual(client.summary_sample_events.calls[0]["country_name"], "Indonesia")
        self.assertEqual(client.summary_sample_events.calls[0]["site_name"], "Cape Kri")
        self.assertEqual(client.summary_sample_events.calls[0]["limit"], 4)
        self.assertEqual(client.summary_sample_events.calls[1]["limit"], 3)

    def test_project_fetch_uses_cursor_listing_and_stops_at_explicit_cap(self):
        class FakeResource:
            def __init__(self):
                self.calls = []
                self.yielded = 0

            def list(self, **filters):
                self.calls.append(filters)

                def rows():
                    for index in range(200):
                        self.yielded += 1
                        yield source_event(f"project-{index}")

                return rows()

        class FakeClient:
            def __init__(self):
                self.summary_sample_events = FakeResource()

        client = FakeClient()
        fetched = bounded_project_fetch(client, "project-1", 102)
        self.assertEqual(len(fetched), 102)
        self.assertEqual(client.summary_sample_events.yielded, 102)
        self.assertEqual(client.summary_sample_events.calls, [{
            "project_id": "project-1", "limit": 25, "ordering": "-sample_date"
        }])

    def test_global_fetch_uses_cursor_listing_and_stops_at_explicit_cap(self):
        class FakeResource:
            def __init__(self):
                self.calls = []
                self.yielded = 0

            def list(self, **filters):
                self.calls.append(filters)
                def rows():
                    for index in range(200):
                        self.yielded += 1
                        yield source_event(f"global-{index}")
                return rows()

        class FakeClient:
            def __init__(self):
                self.summary_sample_events = FakeResource()

        client = FakeClient()
        fetched = bounded_global_fetch(client, 31)
        self.assertEqual(len(fetched), 31)
        self.assertEqual(client.summary_sample_events.yielded, 31)
        self.assertEqual(client.summary_sample_events.calls, [{"limit": 25, "ordering": "-sample_date"}])

    def test_global_scope_keeps_non_indonesia_records_and_reports_stable_site_coverage(self):
        event = source_event("global-site")
        event["country_name"] = "Philippines"
        with tempfile.TemporaryDirectory() as temp:
            report = run_pilot([event], Path(temp), sites=None, country_filter=None)
        self.assertEqual(report["counts"]["valid"], 1)
        self.assertEqual(report["counts"]["uniqueSites"], 1)
        self.assertEqual(report["counts"]["geographicCoverage"]["countries"], {"Philippines": 1})

    def test_snapshot_query_metadata_matches_bounded_site_requests(self):
        self.assertEqual(site_query_parameters(("Cape Kri", "Yenbuba"), 7), [
            {"country_name": "Indonesia", "site_name": "Cape Kri", "limit": 4},
            {"country_name": "Indonesia", "site_name": "Yenbuba", "limit": 3},
        ])

    def test_sanitized_raw_snapshot_replays_through_adapter_to_canonical_records(self):
        source = source_event("offline-raw-fixture")
        snapshot = build_raw_snapshot(
            [source],
            [{"project_id": "fixture-project", "limit": 1, "ordering": "-sample_date"}],
            project_id="fixture-project",
            maximum_events=1,
            generated_at="2026-10-02T00:00:00+00:00",
        )
        self.assertEqual(snapshot["events"], [source], "snapshot retains the source event shape")
        self.assertEqual(snapshot["metadata"]["eventCount"], 1)
        self.assertEqual(snapshot["metadata"]["provider"], "MERMAID")
        self.assertEqual(snapshot["metadata"]["source"], "MERMAID summary_sample_events.list")
        self.assertEqual(snapshot["metadata"]["generatedAt"], "2026-10-02T00:00:00+00:00")
        self.assertEqual(snapshot["metadata"]["queryParameters"][0]["project_id"], "fixture-project")

        global_snapshot = build_raw_snapshot(
            [source], [{"limit": 1, "ordering": "-sample_date"}],
            country_filter=None, dataset_name="global-sample", maximum_events=1,
        )
        self.assertIsNone(global_snapshot["metadata"]["countryFilter"])
        self.assertEqual(global_snapshot["metadata"]["datasetName"], "global-sample")

        with tempfile.TemporaryDirectory(dir=OUTPUT_DIRECTORY) as temp:
            snapshot_path = Path(temp) / "raw-snapshot.json"
            save_raw_snapshot(snapshot, snapshot_path)
            replayed = read_raw_snapshot(snapshot_path)
            self.assertEqual(replayed["events"], [source], "JSON replay preserves the raw event structure")
            canonical_output = Path(temp) / "canonical-output"
            with patch("sample_mermaid.OUTPUT_DIRECTORY", canonical_output), contextlib.redirect_stdout(io.StringIO()):
                exit_code = main(["--replay-snapshot", str(snapshot_path)])
            dataset = json.loads((canonical_output / "mermaid-pilot.json").read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        record = dataset["records"][0]
        self.assertEqual(record["schemaVersion"], 2)
        self.assertEqual(record["provenance"]["provider"], "MERMAID")
        self.assertEqual(record["provenance"]["sourceRecordId"], "offline-raw-fixture")
        self.assertEqual(record["location"]["sourceSiteId"], "site-1")
        protocol = record["protocols"][0]
        self.assertEqual(protocol["sourceMethod"], "benthicpit")
        self.assertEqual(protocol["metrics"]["liveCoralCover"]["valuePct"], 0)
        self.assertIsNone(protocol["metrics"]["macroalgaeCover"]["valuePct"])

    def test_global_snapshot_replay_keeps_world_sample_separate_from_raja_ampat_pilot(self):
        event = source_event("global-replay")
        event["country_name"] = "Fiji"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch("sample_mermaid.OUTPUT_DIRECTORY", root):
                snapshot = build_raw_snapshot(
                    [event], [{"limit": 1, "ordering": "-sample_date"}],
                    country_filter=None, dataset_name="global-sample", maximum_events=1,
                )
                snapshot_path = root / "global-sample-raw-snapshot.json"
                save_raw_snapshot(snapshot, snapshot_path)
                report = replay_snapshot(snapshot_path)
                dataset_path = root / "global-sample" / "mermaid-pilot.json"
            dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
        self.assertEqual(report["counts"]["valid"], 1)
        self.assertEqual(report["counts"]["geographicCoverage"]["countries"], {"Fiji": 1})
        self.assertEqual(dataset["records"][0]["location"]["country"], "Fiji")

    def test_raw_snapshot_rejects_authentication_material_and_external_output_paths(self):
        for credential_key in ("authorization", "api_key", "oauth_access_token", "request_headers"):
            with self.subTest(credential_key=credential_key), self.assertRaisesRegex(ValueError, "Authentication material"):
                build_raw_snapshot([{"sample_event_id": "x", credential_key: "secret"}], [], maximum_events=1)
        snapshot = build_raw_snapshot([source_event()], [], maximum_events=1)
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError, "under data/.build/reef_condition"):
                save_raw_snapshot(snapshot, Path(temp) / "outside.json")

    def test_run_pilot_reports_invalid_ambiguous_and_skipped_duplicate_events(self):
        ambiguous = source_event("ambiguous", {
            "benthicpit": {"percent_cover_benthic_category_avg": {"Hard coral": 20}},
            "benthiclit": {"percent_cover_benthic_category_avg": {"Hard coral": 30}},
        })
        invalid = source_event("invalid")
        invalid["latitude"] = 100
        rows = [source_event("unique"), ambiguous, invalid, source_event("unique")]
        with tempfile.TemporaryDirectory() as temp:
            report = run_pilot(rows, Path(temp))
            output = json.loads((Path(temp) / "mermaid-pilot.json").read_text(encoding="utf-8"))
            details = json.loads((Path(temp) / "mermaid-pilot-report.json").read_text(encoding="utf-8"))
        self.assertEqual(report["counts"]["fetched"], 4)
        self.assertEqual(report["counts"]["valid"], 2)
        self.assertEqual(report["counts"]["invalid"], 1)
        self.assertEqual(report["counts"]["skipped"], 1)
        self.assertEqual(report["counts"]["metrics"]["liveCoralCover"]["candidateStateCounts"]["AMBIGUOUS"], 1)
        self.assertEqual(report["counts"]["metrics"]["liveCoralCover"]["ambiguousProtocolCombinations"], {"LIT + PIT": 1})
        self.assertEqual(len(output["records"]), 2)
        invalid_entry = next(error for error in details["rejectedEvents"] if error.get("status") == "invalid")
        self.assertEqual(invalid_entry["errors"][0]["path"], "location.lat")
        self.assertEqual(invalid_entry["errors"][0]["sourceValue"], 100)


if __name__ == "__main__":
    unittest.main()
