"""Manually fetch, transform, and validate a tightly bounded MERMAID pilot."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from itertools import islice
from pathlib import Path
from typing import Any

from mermaid_adapter import SUPPORTED_METRICS, TransformError, adapt_event, classify_candidates


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIRECTORY = REPOSITORY_ROOT / "data" / ".build" / "reef_condition"
RAW_SNAPSHOT_PATH = OUTPUT_DIRECTORY / "mermaid-raw-snapshot.json"
DEFAULT_SITES = ("Cape Kri", "Yenbuba", "Friwen", "Arborek", "Arefi", "Sawandarek")
HARD_MAX_EVENTS = 50
HARD_MAX_PROJECT_EVENTS = 150
DEFAULT_MAX_EVENTS = 30
AUTH_MATERIAL_KEYS = frozenset({
    "authorization", "proxy-authorization", "headers", "api-key", "apikey",
    "access-token", "refresh-token", "id-token", "token", "client-secret",
})

NODE_VALIDATOR = r"""
const fs = require('node:fs');
const schema = require(process.argv[1]);
const records = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(records.map(record => schema.validateRecord(record))));
"""


class NoCredentialsAvailable(RuntimeError):
    """Raised before any data request when authenticated access is unavailable."""


def create_authenticated_client(sdk: Any, api_key: str | None) -> Any:
    """Build a client only from an API key or the SDK's non-interactive OAuth cache."""
    options = {"timeout": 30, "max_retries": 0}
    if api_key:
        return sdk.MermaidClient(api_key=api_key, **options)

    try:
        oauth = sdk.OAuth(interactive=False)
        # The SDK validates or silently refreshes its cached grant here. Discard
        # the returned token; only the OAuth object is passed to the client.
        oauth.access_token()
    except sdk.AuthFlowError:
        raise NoCredentialsAvailable from None
    except Exception:
        # Do not surface SDK/auth exceptions: some include response details.
        raise NoCredentialsAvailable from None
    return sdk.MermaidClient(auth=oauth, **options)


def _plain(item: Any) -> Any:
    if hasattr(item, "to_dict") and callable(item.to_dict):
        return _plain(item.to_dict(include_extra=True))
    if isinstance(item, dict):
        return {str(key): _plain(value) for key, value in item.items()}
    if isinstance(item, (list, tuple)):
        return [_plain(value) for value in item]
    if hasattr(item, "isoformat") and callable(item.isoformat):
        return item.isoformat()
    return item


def bounded_fetch(client: Any, sites: tuple[str, ...], max_events: int) -> list[dict[str, Any]]:
    """Read no more than one explicitly sized first page per exact site filter."""
    if not 1 <= max_events <= HARD_MAX_EVENTS:
        raise ValueError(f"max_events must be between 1 and {HARD_MAX_EVENTS}")
    if not sites:
        raise ValueError("at least one explicit site filter is required")
    page_size = max(1, math.ceil(max_events / len(sites)))
    fetched: list[dict[str, Any]] = []
    for site in sites:
        remaining = max_events - len(fetched)
        if remaining <= 0:
            break
        requested_limit = min(page_size, remaining)
        page = client.summary_sample_events.list(
            country_name="Indonesia",
            site_name=site,
            limit=requested_limit,
        )
        # islice stops before the SDK can request a subsequent page.
        for summary in islice(page, requested_limit):
            fetched.append(_plain(summary))
            if len(fetched) >= max_events:
                break
    return fetched


def site_query_parameters(sites: tuple[str, ...], max_events: int) -> list[dict[str, Any]]:
    page_size = max(1, math.ceil(max_events / len(sites)))
    remaining = max_events
    requests: list[dict[str, Any]] = []
    for site in sites:
        if remaining <= 0:
            break
        limit = min(page_size, remaining)
        requests.append({"country_name": "Indonesia", "site_name": site, "limit": limit})
        remaining -= limit
    return requests


def bounded_project_fetch(client: Any, project_id: str, max_events: int) -> list[dict[str, Any]]:
    """Read one explicit project query through SDK cursor pagination, capped at 150 rows."""
    if not isinstance(project_id, str) or not project_id.strip():
        raise ValueError("project_id must be a non-empty string")
    if not 1 <= max_events <= HARD_MAX_PROJECT_EVENTS:
        raise ValueError(f"project max_events must be between 1 and {HARD_MAX_PROJECT_EVENTS}")
    page_size = min(25, max_events)
    listing = client.summary_sample_events.list(
        project_id=project_id,
        limit=page_size,
        ordering="-sample_date",
    )
    # islice follows only the SDK's next links and stops at the configured cap.
    return [_plain(event) for event in islice(listing, max_events)]


def bounded_global_fetch(client: Any, max_events: int) -> list[dict[str, Any]]:
    """Read a capped, newest-first global discovery sample through cursor pagination."""
    if not 1 <= max_events <= HARD_MAX_PROJECT_EVENTS:
        raise ValueError(f"global sample max_events must be between 1 and {HARD_MAX_PROJECT_EVENTS}")
    listing = client.summary_sample_events.list(limit=min(25, max_events), ordering="-sample_date")
    return [_plain(event) for event in islice(listing, max_events)]


def _assert_no_auth_material(value: Any, path: str = "snapshot") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized = str(key).casefold().replace("_", "-")
            contains_auth_material = (
                normalized in AUTH_MATERIAL_KEYS
                or "token" in normalized
                or "authorization" in normalized
                or normalized.endswith("-headers")
                or normalized.endswith("-api-key")
                or "client-secret" in normalized
            )
            if contains_auth_material:
                raise ValueError(f"Authentication material is not allowed in raw snapshots ({path}.{key}).")
            _assert_no_auth_material(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _assert_no_auth_material(nested, f"{path}[{index}]")


def build_raw_snapshot(
    source_events: list[dict[str, Any]],
    query_parameters: list[dict[str, Any]],
    *,
    project_id: str | None = None,
    site_filters: tuple[str, ...] | None = None,
    country_filter: str | None = "Indonesia",
    dataset_name: str = "mermaid-pilot",
    maximum_events: int,
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Preserve JSON-shaped MERMAID event responses and safe query provenance."""
    events = _plain(source_events)
    snapshot = {
        "snapshotVersion": 1,
        "metadata": {
            "generatedAt": generated_at or datetime.now(timezone.utc).isoformat(),
            "provider": "MERMAID",
            "source": "MERMAID summary_sample_events.list",
            "queryParameters": _plain(query_parameters),
            "projectId": project_id,
            "siteFilters": list(site_filters) if site_filters is not None else None,
            "countryFilter": country_filter,
            "datasetName": dataset_name,
            "maximumEvents": maximum_events,
            "eventCount": len(events),
        },
        "events": events,
    }
    _assert_no_auth_material(snapshot)
    return snapshot


def save_raw_snapshot(snapshot: dict[str, Any], path: Path = RAW_SNAPSHOT_PATH) -> None:
    """Write only into the local research output tree; snapshots are never publish assets."""
    output_root = OUTPUT_DIRECTORY.resolve()
    target = path.resolve()
    if target != output_root and output_root not in target.parents:
        raise ValueError("Raw snapshot outputs must stay under data/.build/reef_condition/.")
    _assert_no_auth_material(snapshot)
    _atomic_json(target, snapshot)


def read_raw_snapshot(path: Path) -> dict[str, Any]:
    snapshot = json.loads(path.read_text(encoding="utf-8"))
    _assert_no_auth_material(snapshot)
    if not isinstance(snapshot, dict) or snapshot.get("snapshotVersion") != 1:
        raise ValueError("Unsupported raw snapshot format.")
    metadata = snapshot.get("metadata")
    events = snapshot.get("events")
    if not isinstance(metadata, dict) or metadata.get("provider") != "MERMAID":
        raise ValueError("Raw snapshot provider metadata is invalid.")
    if not isinstance(events, list) or metadata.get("eventCount") != len(events):
        raise ValueError("Raw snapshot event count does not match its events.")
    if not isinstance(metadata.get("queryParameters"), list):
        raise ValueError("Raw snapshot query parameters are missing.")
    if not isinstance(metadata.get("maximumEvents"), int) or metadata["maximumEvents"] < len(events):
        raise ValueError("Raw snapshot maximum event count is invalid.")
    dataset_name = metadata.get("datasetName", "mermaid-pilot")
    if not isinstance(dataset_name, str) or not re.fullmatch(r"[a-z0-9-]{1,50}", dataset_name):
        raise ValueError("Raw snapshot dataset name is invalid.")
    country_filter = metadata.get("countryFilter", "Indonesia")
    if country_filter is not None and not isinstance(country_filter, str):
        raise ValueError("Raw snapshot country filter is invalid.")
    if any(not isinstance(event, dict) for event in events):
        raise ValueError("Raw snapshot events must be objects.")
    return snapshot


def validate_with_canonical_schema(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    completed = subprocess.run(
        ["node", "-e", NODE_VALIDATOR, str(REPOSITORY_ROOT / "js" / "reef-survey-schema.js")],
        cwd=REPOSITORY_ROOT,
        input=json.dumps(records, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode:
        raise RuntimeError(f"Canonical schema validation could not run: {completed.stderr.strip()}")
    try:
        results = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Canonical schema validator returned unreadable output") from error
    if not isinstance(results, list) or len(results) != len(records):
        raise RuntimeError("Canonical schema validator returned a mismatched result count")
    return results


def _source_value_for_error(error: str, record: dict[str, Any], diagnostics: list[dict[str, Any]], raw: dict[str, Any]) -> Any:
    path = error.split(" must be ", 1)[0]
    for item in diagnostics:
        if item.get("canonicalPath") == path:
            return item.get("sourceValue")
    source_paths = {
        "location.lat": "latitude",
        "location.lon": "longitude",
        "location.siteName": "site_name",
        "location.country": "country_name",
        "survey.date": "sample_date",
        "survey.managementRegime": "management_name",
        "provenance.projectId": "project_id",
        "provenance.projectName": "project_name",
        "provenance.suggestedCitation": "suggested_citation",
        "provenance.sourceRecordId": "sample_event_id",
    }
    source_key = source_paths.get(path)
    return raw.get(source_key) if source_key else None


def _metric_report(records: list[dict[str, Any]]) -> dict[str, Any]:
    report: dict[str, Any] = {}
    ambiguity_combinations: dict[str, Counter[str]] = {metric: Counter() for metric in SUPPORTED_METRICS}
    for metric in SUPPORTED_METRICS:
        states = Counter()
        zero_count = 0
        for record in records:
            state, candidates = classify_candidates(record, metric)
            states[state] += 1
            zero_count += sum(candidate["value"] == 0 for candidate in candidates)
            if state == "AMBIGUOUS":
                combination = " + ".join(sorted(str(candidate["method"]) for candidate in candidates))
                ambiguity_combinations[metric][combination] += 1
        event_count = len(records)
        missing = states["MISSING"]
        report[metric] = {
            "candidateStateCounts": {state: states[state] for state in ("MISSING", "UNIQUE", "AMBIGUOUS")},
            "missingRate": missing / event_count if event_count else None,
            "measuredNumericZeroes": zero_count,
            "ambiguousProtocolCombinations": dict(ambiguity_combinations[metric]),
        }
    return report


def _summarize(records: list[dict[str, Any]], fetched: int, transformed: int, invalid: int, skipped: int) -> dict[str, Any]:
    source_sites = {
        (record["provenance"]["provider"], record["location"].get("sourceSiteId"))
        for record in records
        if record["location"].get("sourceSiteId")
    }
    site_names = {record["location"]["siteName"] for record in records if record["location"]["siteName"]}
    dates = sorted(record["survey"]["date"] for record in records if record["survey"]["date"])
    countries = Counter(record["location"]["country"] for record in records if record["location"]["country"])
    coordinates = [(record["location"]["lat"], record["location"]["lon"]) for record in records]
    protocol_events = Counter()
    protocol_names = set()
    for record in records:
        event_methods = set()
        for protocol in record["protocols"]:
            source_method = protocol["sourceMethod"]
            protocol_names.add(source_method)
            event_methods.add(source_method)
        protocol_events.update(event_methods)
    partial = 0
    relevant_protocols = {"benthicpit", "benthiclit", "benthicpqt", "bleachingqc"}
    multiple_relevant = 0
    for record in records:
        has_value = [classify_candidates(record, metric)[0] != "MISSING" for metric in SUPPORTED_METRICS]
        if any(has_value) and not all(has_value):
            partial += 1
        if len({protocol["sourceMethod"] for protocol in record["protocols"] if protocol["sourceMethod"] in relevant_protocols}) > 1:
            multiple_relevant += 1
    return {
        "fetched": fetched,
        "transformed": transformed,
        "valid": len(records),
        "invalid": invalid,
        "skipped": skipped,
        "partiallyPopulated": partial,
        "uniqueSites": len(source_sites),
        "uniqueSiteNames": len(site_names),
        "recordsMissingSourceSiteId": sum(not record["location"].get("sourceSiteId") for record in records),
        "geographicCoverage": {
            "countries": dict(sorted(countries.items())),
            "latitudeBounds": {"min": min((point[0] for point in coordinates), default=None), "max": max((point[0] for point in coordinates), default=None)},
            "longitudeBounds": {"min": min((point[1] for point in coordinates), default=None), "max": max((point[1] for point in coordinates), default=None)},
        },
        "dateRange": {"from": dates[0], "to": dates[-1]} if dates else {"from": None, "to": None},
        "protocolSourceNames": sorted(protocol_names),
        "eventsWithPIT": protocol_events["benthicpit"],
        "eventsWithLIT": protocol_events["benthiclit"],
        "eventsWithPQT": protocol_events["benthicpqt"],
        "eventsWithBleaching": protocol_events["bleachingqc"],
        "eventsWithMultipleRelevantProtocols": multiple_relevant,
        "metrics": _metric_report(records),
    }


def run_pilot(
    source_events: list[dict[str, Any]],
    output_directory: Path = OUTPUT_DIRECTORY,
    sites: tuple[str, ...] | None = DEFAULT_SITES,
    max_events: int | None = None,
    project_id: str | None = None,
    country_filter: str | None = "Indonesia",
) -> dict[str, Any]:
    fetched = len(source_events)
    skipped = 0
    transformed_records: list[dict[str, Any]] = []
    transformed_source: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for source_event in source_events:
        source_id = source_event.get("sample_event_id") if isinstance(source_event, dict) else None
        source_site = source_event.get("site_name") if isinstance(source_event, dict) else None
        source_country = source_event.get("country_name") if isinstance(source_event, dict) else None
        country_mismatch = country_filter is not None and isinstance(source_country, str) and source_country.casefold() != country_filter.casefold()
        site_mismatch = sites is not None and isinstance(source_site, str) and source_site.casefold() not in {site.casefold() for site in sites}
        if country_mismatch or site_mismatch:
            skipped += 1
            rejected.append({
                "sampleEventId": source_id,
                "status": "skipped",
                "path": "country_name/site_name",
                "sourceValue": {"country_name": source_country, "site_name": source_site},
                "reason": "The response did not match the requested Indonesia site filters.",
            })
            continue
        if isinstance(source_id, str) and source_id in seen_ids:
            skipped += 1
            rejected.append({"sampleEventId": source_id, "status": "skipped", "reason": "Duplicate source event ID returned by overlapping site filters."})
            continue
        if isinstance(source_id, str):
            seen_ids.add(source_id)
        try:
            record, event_diagnostics = adapt_event(source_event)
            transformed_records.append(record)
            transformed_source.append(source_event)
            diagnostics.extend(event_diagnostics)
        except TransformError as error:
            rejected.append({"status": "invalid", **error.as_dict()})

    validation = validate_with_canonical_schema(transformed_records)
    valid_records: list[dict[str, Any]] = []
    invalid_count = sum(item.get("status") == "invalid" for item in rejected)
    for record, source_event, event_diagnostics, result in zip(
        transformed_records,
        transformed_source,
        _diagnostics_by_event(diagnostics),
        validation,
        strict=True,
    ):
        if result.get("valid"):
            valid_records.append(record)
            continue
        invalid_count += 1
        rejected.append({
            "sampleEventId": record["provenance"]["sourceRecordId"],
            "status": "invalid",
            "errors": [{
                "path": error.split(" must be ", 1)[0],
                "reason": error,
                "sourceValue": _source_value_for_error(error, record, event_diagnostics, source_event),
            } for error in result.get("errors", [])],
        })

    report = {
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "scope": {"country": country_filter, "siteFilters": list(sites) if sites is not None else None, "projectId": project_id, "maximumEvents": max_events},
        "counts": _summarize(valid_records, fetched, len(transformed_records), invalid_count, skipped),
        "rejectedEvents": rejected,
        "transformDiagnostics": diagnostics,
        "unmappedSourceFields": sorted({
            f"{item.get('protocol')}.{item.get('sourceField')}"
            for item in diagnostics
            if item.get("status") == "unmapped-source-field"
        }),
        "unexpectedSourceMethods": sorted({
            protocol["sourceMethod"]
            for record in valid_records
            for protocol in record["protocols"]
            if protocol["method"] == "other"
        }),
    }
    output_directory.mkdir(parents=True, exist_ok=True)
    source_site_ids = {
        (record["provenance"]["provider"], record["location"]["sourceSiteId"])
        for record in valid_records
        if record["location"].get("sourceSiteId")
    }
    source_site_count = len(source_site_ids) if all(record["location"].get("sourceSiteId") for record in valid_records) else None
    dates = sorted(record["survey"]["date"] for record in valid_records if record["survey"]["date"])
    dataset = {
        "schemaVersion": 2,
        "metadata": {
            "provider": "MERMAID",
            "datasetType": "local-pilot",
            "generatedAt": report["retrievedAt"],
            "eventCount": len(valid_records),
            "sourceSiteCount": source_site_count,
            "sourceSiteIdCoverage": "complete" if source_site_count is not None else "incomplete",
            "dateRange": {"from": dates[0], "to": dates[-1]} if dates else {"from": None, "to": None},
            "redistributionApproved": False,
            "redistributionStatus": "unresolved",
        },
        "records": valid_records,
    }
    _atomic_json(output_directory / "mermaid-pilot.json", dataset)
    _atomic_json(output_directory / "mermaid-pilot-report.json", report)
    return report


def replay_snapshot(path: Path, output_directory: Path | None = None) -> dict[str, Any]:
    """Replay a saved raw snapshot through the unchanged adapter and schema validation path."""
    snapshot = read_raw_snapshot(path)
    metadata = snapshot["metadata"]
    saved_sites = metadata.get("siteFilters")
    sites = tuple(saved_sites) if saved_sites is not None else None
    dataset_name = metadata.get("datasetName", "mermaid-pilot")
    if output_directory is None:
        output_directory = OUTPUT_DIRECTORY if dataset_name == "mermaid-pilot" else OUTPUT_DIRECTORY / dataset_name
    return run_pilot(
        snapshot["events"],
        output_directory=output_directory,
        sites=sites,
        max_events=metadata["maximumEvents"],
        project_id=metadata.get("projectId"),
        country_filter=metadata.get("countryFilter", "Indonesia"),
    )


def _diagnostics_by_event(diagnostics: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    grouped: dict[Any, list[dict[str, Any]]] = {}
    for item in diagnostics:
        grouped.setdefault(item.get("sampleEventId"), []).append(item)
    return list(grouped.values())


def _atomic_json(path: Path, payload: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    json.loads(temporary.read_text(encoding="utf-8"))
    temporary.replace(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", action="append", dest="sites", help="Exact Indonesia site name; repeat to add filters.")
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--project-id", help="Bounded project-scoped cursor query (maximum 150 events).")
    scope.add_argument("--global-sample", action="store_true", help="Bounded newest-first all-country cursor sample (maximum 150 events).")
    scope.add_argument("--replay-snapshot", type=Path, help="Offline replay of a previously saved raw snapshot; makes no API request.")
    parser.add_argument("--max-events", type=int, default=DEFAULT_MAX_EVENTS, help=f"Event cap; site mode 1–{HARD_MAX_EVENTS}, project/global mode 1–{HARD_MAX_PROJECT_EVENTS}; default {DEFAULT_MAX_EVENTS}.")
    args = parser.parse_args(argv)

    if args.replay_snapshot:
        try:
            snapshot = read_raw_snapshot(args.replay_snapshot)
            report = replay_snapshot(args.replay_snapshot)
        except Exception as error:
            print(f"Raw snapshot replay failed ({type(error).__name__}); details were suppressed.", file=sys.stderr)
            return 1
        print(json.dumps(report["counts"], ensure_ascii=False, indent=2))
        result_directory = OUTPUT_DIRECTORY if snapshot["metadata"].get("datasetName", "mermaid-pilot") == "mermaid-pilot" else OUTPUT_DIRECTORY / snapshot["metadata"]["datasetName"]
        print(f"Canonical dataset: {result_directory / 'mermaid-pilot.json'}")
        print(f"Local report: {result_directory / 'mermaid-pilot-report.json'}")
        return 1 if report["counts"]["invalid"] else 0

    maximum = HARD_MAX_PROJECT_EVENTS if args.project_id or args.global_sample else HARD_MAX_EVENTS
    if not 1 <= args.max_events <= maximum:
        parser.error(f"--max-events must be between 1 and {maximum}")
    if (args.project_id or args.global_sample) and args.sites:
        parser.error("--project-id/--global-sample cannot be combined with --site filters")
    api_key = os.environ.get("MERMAID_API_KEY", "").strip()
    try:
        import datamermaid
    except ImportError as error:
        parser.error("Install the pinned client with: python -m pip install -r tools/reef_condition/requirements.txt")
        raise error

    try:
        client = create_authenticated_client(datamermaid, api_key or None)
    except NoCredentialsAvailable:
        parser.error(
            'No MERMAID credentials available. Run:\n'
            'python -c "import datamermaid; datamermaid.login()"\n'
            "then rerun this sampler."
        )
    except Exception as error:
        print(f"MERMAID client initialization failed ({type(error).__name__}); details were suppressed.", file=sys.stderr)
        return 1

    sites = tuple(args.sites or DEFAULT_SITES) if not args.project_id and not args.global_sample else None
    country_filter = None if args.global_sample else "Indonesia"
    dataset_name = "global-sample" if args.global_sample else "mermaid-pilot"
    try:
        with client:
            if args.global_sample:
                source_events = bounded_global_fetch(client, args.max_events)
                requests = [{"limit": min(25, args.max_events), "ordering": "-sample_date"}]
                site_filters = None
            elif args.project_id:
                source_events = bounded_project_fetch(client, args.project_id, args.max_events)
                requests = [{"project_id": args.project_id, "limit": min(25, args.max_events), "ordering": "-sample_date"}]
                site_filters = None
            else:
                source_events = bounded_fetch(client, sites, args.max_events)
                requests = site_query_parameters(sites, args.max_events)
                site_filters = sites
            snapshot = build_raw_snapshot(
                source_events,
                requests,
                project_id=args.project_id,
                site_filters=site_filters,
                country_filter=country_filter,
                dataset_name=dataset_name,
                maximum_events=args.max_events,
            )
            snapshot_path = RAW_SNAPSHOT_PATH if dataset_name == "mermaid-pilot" else OUTPUT_DIRECTORY / f"{dataset_name}-raw-snapshot.json"
            save_raw_snapshot(snapshot, snapshot_path)
            report = run_pilot(
                source_events,
                output_directory=OUTPUT_DIRECTORY if dataset_name == "mermaid-pilot" else OUTPUT_DIRECTORY / dataset_name,
                sites=sites,
                max_events=args.max_events,
                project_id=args.project_id,
                country_filter=country_filter,
            )
    except Exception as error:
        # Never print exception text from auth or HTTP libraries; it may embed
        # request headers or credential-bearing response details.
        print(f"MERMAID pilot stopped ({type(error).__name__}); details were suppressed.", file=sys.stderr)
        return 1
    print(json.dumps(report["counts"], ensure_ascii=False, indent=2))
    print(f"Raw snapshot: {snapshot_path}")
    result_directory = OUTPUT_DIRECTORY if dataset_name == "mermaid-pilot" else OUTPUT_DIRECTORY / dataset_name
    print(f"Local dataset: {result_directory / 'mermaid-pilot.json'}")
    print(f"Local report: {result_directory / 'mermaid-pilot-report.json'}")
    return 1 if report["counts"]["invalid"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
