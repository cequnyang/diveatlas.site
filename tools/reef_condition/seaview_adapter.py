#!/usr/bin/env python3
"""Convert the pinned UQ Seaview tabular archive to local canonical survey records.

The source archive is intentionally read in place: its 55 million-row classifier
annotation table and imagery are not needed for the two survey-level metrics.
Derived files default to data/.build so they cannot enter the Pages artifact.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import sqlite3
import statistics
import subprocess
import time
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TextIO


ROOT = Path(__file__).resolve().parents[2]
PROVIDER = "XL Catlin Seaview Survey"
DATASET_TITLE = "Seaview Survey Photo-quadrat and Image Classification Dataset"
DATASET_DOI = "10.14264/uql.2019.930"
DATASET_URL = "https://doi.org/10.14264/uql.2019.930"
ARCHIVE_URL = "http://data.qld.edu.au/public/Q1281/tabular-data.zip"
DATASET_RECORD_URL = "https://espace.library.uq.edu.au/view/UQ:734799"
PAPER_URL = "https://doi.org/10.1038/s41597-020-00698-6"
PAPER_CITATION = (
    "Rodriguez-Ramirez, A., González-Rivero, M., Beijbom, O., et al. (2020). "
    "A contemporary baseline record of the world’s coral reefs. Scientific Data, 7, 355. "
    "https://doi.org/10.1038/s41597-020-00698-6"
)
LICENSE_EVIDENCE = {
    "status": "conflicting",
    "repositoryRecord": "CC BY 3.0",
    "dataPaper": "CC BY 3.0",
    "uqDatasetGuide": "CC BY-NC-SA 4.0",
    "productionRedistributionApproved": False,
}
EXPECTED_ARCHIVE_BYTES = 357_966_014
# Locally computed for the exact Q1281/tabular-data.zip snapshot. The UQ index
# does not publish a checksum; this pins this research copy against drift.
EXPECTED_ARCHIVE_SHA256 = "2954427f0746cc2e3245955f62676066d0c2b94eab17ec87b50286ab0e5bf5c5"

DEFAULT_INPUT = ROOT / "data/.build/reef_condition/seaview/raw/tabular-data.zip"
DEFAULT_OUTPUT = ROOT / "data/.build/reef_condition/seaview/canonical.json.gz"
DEFAULT_METADATA = ROOT / "data/.build/reef_condition/seaview/metadata.json"
DEFAULT_REPORT = ROOT / "data/.build/reef_condition/seaview/conversion-report.json"
DEFAULT_MANIFEST = ROOT / "data/.build/reef_condition/seaview/snapshot-manifest.json"

SURVEYS_TABLE = "tabular-data/seaviewsurvey_surveys.csv"
LABELSETS_TABLE = "tabular-data/seaviewsurvey_labelsets.csv"
REGION_TABLES = {
    "Atlantic": "tabular-data/seaviewsurvey_reefcover_atlantic.csv",
    "Indian Ocean": "tabular-data/seaviewsurvey_reefcover_indianocean.csv",
    "Pacific Australia": "tabular-data/seaviewsurvey_reefcover_pacificaustralia.csv",
    "Pacific Hawaii": "tabular-data/seaviewsurvey_reefcover_pacifichawaii.csv",
    "Southeast Asia": "tabular-data/seaviewsurvey_reefcover_southeastasia.csv",
}
MISSING_TOKENS = frozenset({"", "na", "n/a", "nan", "null", "none", "nd"})
SURVEY_FIELDS = frozenset({
    "surveyid", "transectid", "surveydate", "ocean", "country", "folder_name",
    "lat_start", "lng_start", "lat_end", "lng_end", "pr_hard_coral", "pr_algae",
    "pr_soft_coral", "pr_oth_invert", "pr_other",
})
LABELSET_FIELDS = frozenset({"region", "label", "func_group", "label_name", "merged_label", "merged_name"})
QUADRAT_BASE_FIELDS = frozenset({"surveyid", "imageid", "quadratid", "lat", "lng"})


def is_missing(value: Any) -> bool:
    return value is None or str(value).strip().lower() in MISSING_TOKENS


def clean_text(value: Any) -> str | None:
    return None if is_missing(value) else str(value).strip()


def parse_fraction(value: Any) -> float | None:
    """Parse a source proportion and convert it to percent without null→zero."""
    if is_missing(value):
        return None
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError) as error:
        raise ValueError("not_numeric") from error
    if not math.isfinite(number) or not 0 <= number <= 1:
        raise ValueError("outside_fraction_range")
    return round(number * 100, 8)


def parse_source_date(value: Any) -> tuple[str | None, str, bool]:
    if is_missing(value):
        return None, "unknown", False
    text = str(value).strip()
    if len(text) != 8 or not text.isdigit():
        return None, "unknown", True
    try:
        parsed = datetime.strptime(text, "%Y%m%d").date()
    except ValueError:
        return None, "unknown", True
    return parsed.isoformat(), "day", False


def parse_coordinate(value: Any, low: float, high: float) -> float | None:
    if is_missing(value):
        return None
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and low <= number <= high else None


def spherical_midpoint(lat1: float, lon1: float, lat2: float, lon2: float) -> tuple[float, float]:
    """Return the great-circle midpoint; handles transects near the date line."""
    phi1, lam1, phi2, lam2 = map(math.radians, (lat1, lon1, lat2, lon2))
    x1, y1, z1 = math.cos(phi1) * math.cos(lam1), math.cos(phi1) * math.sin(lam1), math.sin(phi1)
    x2, y2, z2 = math.cos(phi2) * math.cos(lam2), math.cos(phi2) * math.sin(lam2), math.sin(phi2)
    x, y, z = x1 + x2, y1 + y2, z1 + z2
    magnitude = math.sqrt(x * x + y * y + z * z)
    if magnitude < 1e-12:
        raise ValueError("transect_endpoints_have_no_unique_midpoint")
    x, y, z = x / magnitude, y / magnitude, z / magnitude
    latitude = math.degrees(math.atan2(z, math.hypot(x, y)))
    longitude = ((math.degrees(math.atan2(y, x)) + 180) % 360) - 180
    return round(latitude, 8), round(longitude, 8)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lam = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return 6371.0088 * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0, 1 - a)))


def region_for_survey(ocean: str | None, country: str | None) -> str | None:
    if ocean == "ATL":
        return "Atlantic"
    if ocean == "IND":
        return "Indian Ocean"
    if ocean == "PAC" and country == "AUS":
        return "Pacific Australia"
    if ocean == "PAC" and country == "USA":
        return "Pacific Hawaii"
    if ocean == "PAC":
        return "Southeast Asia"
    return None


def _read_dict_rows(archive: zipfile.ZipFile, member: str) -> tuple[list[str], Any]:
    try:
        stream = archive.open(member)
    except KeyError as error:
        raise ValueError(f"Required source table is missing: {member}") from error
    wrapper = io.TextIOWrapper(stream, encoding="utf-8-sig", newline="")
    reader = csv.DictReader(wrapper)
    if not reader.fieldnames:
        wrapper.close()
        raise ValueError(f"Source table has no header row: {member}")
    return list(reader.fieldnames), (wrapper, reader)


def _rows(archive: zipfile.ZipFile, member: str, required: frozenset[str]) -> tuple[list[str], TextIO, Any]:
    fields, (wrapper, reader) = _read_dict_rows(archive, member)
    missing = sorted(required - set(fields))
    if missing:
        wrapper.close()
        raise ValueError(f"{member} is missing required columns: {missing}")
    return fields, wrapper, reader


def _macro_labels(archive: zipfile.ZipFile) -> dict[str, set[str]]:
    _, wrapper, reader = _rows(archive, LABELSETS_TABLE, LABELSET_FIELDS)
    result: dict[str, set[str]] = defaultdict(set)
    try:
        for row in reader:
            # The published functional group is broad "Algae". Only labels
            # explicitly merged into MALG are macroalgae; CCA/EAM remain out.
            if row["func_group"].strip() == "Algae" and row["merged_label"].strip() == "MALG":
                result[row["region"].strip()].add(row["label"].strip())
    finally:
        wrapper.close()
    return dict(result)


def _load_surveys(archive: zipfile.ZipFile, diagnostics: Counter[str]) -> tuple[dict[str, dict[str, Any]], Counter[str], list[dict[str, Any]]]:
    _, wrapper, reader = _rows(archive, SURVEYS_TABLE, SURVEY_FIELDS)
    surveys: dict[str, dict[str, Any]] = {}
    country_counts: Counter[str] = Counter()
    long_transect_warnings: list[dict[str, Any]] = []
    try:
        for row_number, row in enumerate(reader, start=1):
            diagnostics["sourceSurveyRows"] += 1
            survey_id = clean_text(row.get("surveyid"))
            if not survey_id:
                diagnostics["invalidSurveyId"] += 1
                continue
            if survey_id in surveys:
                diagnostics["duplicateSurveyIdRows"] += 1
                continue
            transect_id = clean_text(row.get("transectid"))
            if not transect_id:
                diagnostics["missingSourceSiteId"] += 1
                continue
            date_value, date_precision, invalid_date = parse_source_date(row.get("surveydate"))
            if invalid_date:
                diagnostics["invalidSurveyDateRows"] += 1
                continue
            coordinates = [
                parse_coordinate(row.get("lat_start"), -90, 90),
                parse_coordinate(row.get("lng_start"), -180, 180),
                parse_coordinate(row.get("lat_end"), -90, 90),
                parse_coordinate(row.get("lng_end"), -180, 180),
            ]
            if any(value is None for value in coordinates):
                diagnostics["missingOrInvalidTransectCoordinates"] += 1
                continue
            lat_start, lon_start, lat_end, lon_end = coordinates
            try:
                lat, lon = spherical_midpoint(lat_start, lon_start, lat_end, lon_end)
            except ValueError:
                diagnostics["invalidTransectGeometry"] += 1
                continue
            distance = haversine_km(lat_start, lon_start, lat_end, lon_end)
            if distance > 10:
                diagnostics["transectLengthOver10KmWarnings"] += 1
                long_transect_warnings.append({
                    "surveyId": survey_id,
                    "sourceSiteId": transect_id,
                    "countryCode": clean_text(row.get("country")),
                    "date": date_value,
                    "endpointDistanceKm": round(distance, 3),
                })
            hard_coral_fraction = None
            try:
                hard_coral_fraction = parse_fraction(row.get("pr_hard_coral"))
            except ValueError:
                diagnostics["invalidHardCoralFractions"] += 1
            ocean = clean_text(row.get("ocean"))
            country = clean_text(row.get("country"))
            region = region_for_survey(ocean, country)
            if region is None:
                diagnostics["unmappedSurveyRegion"] += 1
            country_counts[country or "unknown"] += 1
            surveys[survey_id] = {
                "surveyId": survey_id,
                "transectId": transect_id,
                "date": date_value,
                "datePrecision": date_precision,
                "ocean": ocean,
                "country": country,
                "region": region,
                "folderName": clean_text(row.get("folder_name")),
                "lat": lat,
                "lon": lon,
                "sourceEndpoints": {
                    "start": {"lat": lat_start, "lon": lon_start},
                    "end": {"lat": lat_end, "lon": lon_end},
                    "pointMethod": "great-circle midpoint of source transect endpoints",
                },
                "transectLengthKm": distance,
                "hardCoralCoverPct": hard_coral_fraction,
                "sourceRowNumber": row_number,
            }
    finally:
        wrapper.close()
    return surveys, country_counts, long_transect_warnings


def _collect_macroalgae(
    archive: zipfile.ZipFile,
    surveys: dict[str, dict[str, Any]],
    macro_labels: dict[str, set[str]],
    diagnostics: Counter[str],
) -> dict[str, dict[str, Any]]:
    connection = sqlite3.connect(":memory:")
    connection.execute("CREATE TABLE seen_quadrats (quadratid TEXT PRIMARY KEY)")
    connection.execute(
        "CREATE TABLE image_cover (surveyid TEXT, imageid TEXT, total_quadrats INTEGER, "
        "valid_quadrats INTEGER, macro_sum REAL, PRIMARY KEY (surveyid, imageid))"
    )
    try:
        for region, member in REGION_TABLES.items():
            labels = macro_labels.get(region, set())
            if not labels:
                raise ValueError(f"Labelset has no explicit macroalgae classes for {region}")
            fields, wrapper, reader = _rows(archive, member, QUADRAT_BASE_FIELDS)
            absent_labels = sorted(labels - set(fields))
            if absent_labels:
                wrapper.close()
                raise ValueError(f"{member} is missing macroalgae label columns: {absent_labels}")
            label_fields = sorted(labels)
            try:
                for row in reader:
                    diagnostics["sourceQuadratRows"] += 1
                    survey_id = clean_text(row.get("surveyid"))
                    image_id = clean_text(row.get("imageid"))
                    quadrat_id = clean_text(row.get("quadratid"))
                    if not survey_id or not image_id or not quadrat_id:
                        diagnostics["invalidQuadratIdentityRows"] += 1
                        if survey_id:
                            diagnostics[f"invalidMacroRowsForSurvey:{survey_id}"] += 1
                        continue
                    survey = surveys.get(survey_id)
                    if survey is None:
                        diagnostics["orphanQuadratRows"] += 1
                        continue
                    if survey["region"] != region:
                        diagnostics["surveyRegionTableMismatches"] += 1
                        diagnostics[f"invalidMacroRowsForSurvey:{survey_id}"] += 1
                        continue
                    inserted = connection.execute("INSERT OR IGNORE INTO seen_quadrats VALUES (?)", (quadrat_id,)).rowcount
                    if inserted == 0:
                        diagnostics["duplicateQuadratIds"] += 1
                        continue

                    fractions: list[float] = []
                    invalid_reason: str | None = None
                    try:
                        for field in label_fields:
                            value = parse_fraction(row.get(field))
                            if value is None:
                                invalid_reason = "missing_macroalgae_category"
                                break
                            fractions.append(value / 100)
                    except ValueError as error:
                        invalid_reason = str(error)
                    macro_fraction = sum(fractions) if invalid_reason is None else None
                    if macro_fraction is not None and macro_fraction > 1 + 1e-8:
                        invalid_reason = "macroalgae_fraction_over_100_percent"
                        macro_fraction = None
                    if invalid_reason:
                        diagnostics[f"invalidMacroQuadrat:{invalid_reason}"] += 1
                        diagnostics[f"invalidMacroRowsForSurvey:{survey_id}"] += 1
                        valid = 0
                        macro_fraction = 0.0
                    else:
                        valid = 1
                    connection.execute(
                        "INSERT INTO image_cover VALUES (?, ?, 1, ?, ?) "
                        "ON CONFLICT(surveyid, imageid) DO UPDATE SET "
                        "total_quadrats=total_quadrats+1, valid_quadrats=valid_quadrats+excluded.valid_quadrats, "
                        "macro_sum=macro_sum+excluded.macro_sum",
                        (survey_id, image_id, valid, macro_fraction),
                    )
                connection.commit()
            finally:
                wrapper.close()

        summaries: dict[str, dict[str, Any]] = {}
        query = connection.execute(
            "SELECT surveyid, SUM(total_quadrats), SUM(valid_quadrats), "
            "SUM(CASE WHEN valid_quadrats > 0 THEN macro_sum / valid_quadrats ELSE 0 END), "
            "COUNT(*), SUM(CASE WHEN valid_quadrats != total_quadrats THEN 1 ELSE 0 END) "
            "FROM image_cover GROUP BY surveyid"
        )
        for survey_id, quadrat_count, valid_quadrat_count, image_mean_sum, image_count, incomplete_images in query:
            invalid_rows = diagnostics.get(f"invalidMacroRowsForSurvey:{survey_id}", 0)
            fully_covered = invalid_rows == 0 and incomplete_images == 0 and image_count > 0 and valid_quadrat_count == quadrat_count
            value = round((image_mean_sum / image_count) * 100, 8) if fully_covered else None
            summaries[survey_id] = {
                "macroalgaeCoverPct": value,
                "imageCount": int(image_count),
                "quadratCount": int(quadrat_count),
                "validQuadratCount": int(valid_quadrat_count),
                "incompleteImageCount": int(incomplete_images),
            }
            if not fully_covered:
                diagnostics["partialOrMissingMacroSurveyCount"] += 1
        return summaries
    finally:
        connection.close()


def _record(survey: dict[str, Any], macro: dict[str, Any] | None) -> dict[str, Any]:
    hard_coral = survey["hardCoralCoverPct"]
    macroalgae = macro["macroalgaeCoverPct"] if macro else None
    image_count = macro["imageCount"] if macro else None
    return {
        "schemaVersion": 3,
        "id": f"seaview-uql-2019-930-survey-{survey['surveyId']}",
        "location": {
            "lat": survey["lat"],
            "lon": survey["lon"],
            "siteName": None,
            "region": survey["region"] or survey["ocean"],
            "country": survey["country"],
            "sourceSiteId": survey["transectId"],
        },
        "survey": {
            "date": survey["date"],
            "datePrecision": survey["datePrecision"],
            "managementRegime": None,
            "sampleId": survey["surveyId"],
            "sourceRowNumber": survey["sourceRowNumber"],
        },
        "protocols": [{
            "method": "SVII transect photo-quadrat survey with automated benthic image classification",
            "sourceMethod": "Source survey summary and region-specific automated classifier; VGG-D 16 methods described in the data paper",
            "sampleUnitCount": image_count,
            "depth": None,
            "dataPolicy": None,
            "metrics": {
                "hardCoralCover": {"valuePct": hard_coral, "sdPct": None, "basis": "benthic-cover"},
                "macroalgaeCover": {"valuePct": macroalgae, "sdPct": None, "basis": "benthic-cover"},
            },
        }],
        "quality": {"confidenceLevel": None},
        "provenance": {
            "provider": PROVIDER,
            "projectId": None,
            "sourceRecordId": survey["surveyId"],
            "projectName": "XL Catlin Seaview Survey Project",
            "suggestedCitation": PAPER_CITATION,
            "license": None,
            "sourceUrl": DATASET_URL,
            "sourceCoordinates": survey["sourceEndpoints"],
            "sourceMetricSemantics": {
                "hardCoralCover": "Source summary field pr_hard_coral; retained as hard coral cover, not relabeled live coral cover.",
                "macroalgaeCover": "Sum of source labelset categories merged_label=MALG; CCA, EAM/turf, broad pr_algae, and other algae classes excluded.",
            },
            "licenseReview": "Conflicting official license statements; local research only pending clarification.",
        },
    }


def _summary(values: list[float | None]) -> dict[str, Any]:
    present = [value for value in values if value is not None]
    return {
        "available": len(present),
        "missing": len(values) - len(present),
        "measuredZero": sum(value == 0 for value in present),
        "minPct": min(present) if present else None,
        "medianPct": statistics.median(present) if present else None,
        "maxPct": max(present) if present else None,
        "meanPct": round(statistics.mean(present), 6) if present else None,
    }


def _event_repeats(records: list[dict[str, Any]]) -> dict[str, Any]:
    counts: Counter[tuple[str, str]] = Counter()
    by_site: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        key = (record["provenance"]["provider"], record["location"]["sourceSiteId"])
        counts[key] += 1
        by_site[key].append(record)
    distribution = Counter()
    for count in counts.values():
        distribution[str(count)] += 1
    multi = [items for items in by_site.values() if len(items) > 1]
    repeat_spans = []
    for items in multi:
        dated = [datetime.strptime(item["survey"]["date"], "%Y-%m-%d").date()
                 for item in items if item["survey"]["date"]]
        if len(dated) >= 2:
            repeat_spans.append((max(dated) - min(dated)).days)
    examples = []
    for items in sorted(multi, key=lambda group: (len(group), group[0]["location"]["sourceSiteId"]), reverse=True)[:5]:
        dated = [datetime.strptime(item["survey"]["date"], "%Y-%m-%d").date()
                 for item in items if item["survey"]["date"]]
        examples.append({
            "sourceSiteId": items[0]["location"]["sourceSiteId"],
            "eventCount": len(items),
            "spanDays": (max(dated) - min(dated)).days if len(dated) >= 2 else None,
            "events": sorted([
                {"date": item["survey"]["date"], "sourceEventId": item["provenance"]["sourceRecordId"]}
                for item in items
            ], key=lambda item: item["date"] or ""),
        })
    return {
        "sourceSiteCount": len(counts),
        "singleSurveySites": distribution.get("1", 0),
        "twoSurveySites": distribution.get("2", 0),
        "threeOrMoreSurveySites": sum(value for count, value in distribution.items() if int(count) >= 3),
        "maximumSurveysPerSite": max(counts.values(), default=0),
        "surveyCountDistribution": dict(sorted(distribution.items(), key=lambda pair: int(pair[0]))),
        "repeatSiteDateSpanDays": {
            "sitesWithAtLeastTwoDates": len(repeat_spans),
            "min": min(repeat_spans) if repeat_spans else None,
            "median": statistics.median(repeat_spans) if repeat_spans else None,
            "max": max(repeat_spans) if repeat_spans else None,
        },
        "repeatExamples": examples,
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def adapt_archive(
    source_path: Path,
    *,
    generated_at: str | None = None,
    require_pinned_source: bool = True,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    source_path = Path(source_path)
    if not source_path.is_file():
        raise FileNotFoundError(f"Seaview source archive is missing: {source_path}")
    source_size = source_path.stat().st_size
    source_sha256 = _sha256(source_path)
    if require_pinned_source and (source_size != EXPECTED_ARCHIVE_BYTES or source_sha256 != EXPECTED_ARCHIVE_SHA256):
        raise ValueError("The local archive does not match the pinned UQ Q1281 tabular-data.zip snapshot.")

    generated_at = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    diagnostics: Counter[str] = Counter()
    try:
        archive = zipfile.ZipFile(source_path)
    except (OSError, zipfile.BadZipFile) as error:
        raise ValueError("The Seaview source is not a readable ZIP archive.") from error
    with archive:
        member_names = set(archive.namelist())
        if SURVEYS_TABLE not in member_names or LABELSETS_TABLE not in member_names:
            raise ValueError("The source archive does not contain the pinned survey and labelset tables.")
        required_cover_tables = set(REGION_TABLES.values())
        if not required_cover_tables.issubset(member_names):
            missing = sorted(required_cover_tables - member_names)
            raise ValueError(f"The source archive is missing regional cover tables: {missing}")
        surveys, country_counts, long_transect_warnings = _load_surveys(archive, diagnostics)
        macro_labels = _macro_labels(archive)
        macro_summaries = _collect_macroalgae(archive, surveys, macro_labels, diagnostics)
        records = [_record(survey, macro_summaries.get(survey_id)) for survey_id, survey in surveys.items()]

    dates = sorted(record["survey"]["date"] for record in records if record["survey"]["date"])
    date_precision = Counter(record["survey"]["datePrecision"] for record in records)
    hard_values = [record["protocols"][0]["metrics"]["hardCoralCover"]["valuePct"] for record in records]
    macro_values = [record["protocols"][0]["metrics"]["macroalgaeCover"]["valuePct"] for record in records]
    both_count = sum(left is not None and right is not None for left, right in zip(hard_values, macro_values))
    region_counts = Counter(record["location"]["region"] for record in records)
    observations = [record["provenance"]["sourceRecordId"] for record in records]
    survey_counts = Counter(observations)
    diagnostics["duplicateSourceSurveyIds"] = sum(max(0, count - 1) for count in survey_counts.values())
    invalid_rows = sum(value for key, value in diagnostics.items() if key in {
        "invalidSurveyId", "duplicateSurveyIdRows", "missingSourceSiteId", "invalidSurveyDateRows",
        "missingOrInvalidTransectCoordinates", "invalidTransectGeometry",
    })
    dataset = {
        "schemaVersion": 3,
        "metadata": {
            "provider": PROVIDER,
            "datasetType": "local-pilot",
            "eventCount": len(records),
            "sourceSiteCount": len({record["location"]["sourceSiteId"] for record in records}),
            "generatedAt": generated_at,
            "dateRange": {"from": dates[0] if dates else None, "to": dates[-1] if dates else None},
            "redistributionApproved": None,
            "datasetTitle": DATASET_TITLE,
            "sourceRelease": "UQ eSpace / Q1281 repository deposit (catalog issued 2019; paper published 2020)",
            "sourceDoi": DATASET_DOI,
            "sourceUrl": DATASET_URL,
            "sourceArchiveUrl": ARCHIVE_URL,
            "sourceArchiveName": "tabular-data.zip",
            "sourceArchiveBytes": source_size,
            "sourceArchiveSha256": source_sha256,
            "licenseReview": LICENSE_EVIDENCE,
            "attribution": PAPER_CITATION,
        },
        "records": records,
    }
    report = {
        "provider": PROVIDER,
        "datasetTitle": DATASET_TITLE,
        "sourceDoi": DATASET_DOI,
        "sourceRelease": "UQ eSpace / Q1281 repository deposit (catalog issued 2019; paper published 2020)",
        "sourceArchiveUrl": ARCHIVE_URL,
        "sourceArchiveBytes": source_size,
        "sourceArchiveSha256": source_sha256,
        "sourceSurveyRows": diagnostics.get("sourceSurveyRows", 0),
        "canonicalEvents": len(records),
        "validRecords": len(records),
        "invalidOrSkippedRecords": invalid_rows,
        "uniqueProviderScopedSites": len({record["location"]["sourceSiteId"] for record in records}),
        "countryCodeSurveyCounts": dict(sorted(country_counts.items())),
        "geographicRegions": dict(sorted(region_counts.items())),
        "dateRange": {"from": dates[0] if dates else None, "to": dates[-1] if dates else None},
        "datePrecisionCounts": dict(sorted(date_precision.items())),
        "depthAvailability": {"available": 0, "missing": len(records), "sourceMethodContext": "The guide describes a typical depth near 10 m, but the survey table has no per-survey depth; canonical depth remains null."},
        "metricCoverage": {
            "hardCoralCover": _summary(hard_values),
            "macroalgaeCover": _summary(macro_values),
            "eventsWithBoth": both_count,
        },
        "macroalgaeDerivation": {
            "sourceRule": "For each quadrat, sum label columns whose per-region labelset func_group is Algae and merged_label is MALG; average quadrats within each image, then average image means within the survey.",
            "excluded": ["broad pr_algae summary", "crustose coralline algae (CCA)", "epilithic algal matrix/turf (EAM)", "cyanobacteria", "other algae classes"],
            "labelCodesByRegion": {region: sorted(labels) for region, labels in sorted(macro_labels.items())},
            "sourceQuadratRows": diagnostics.get("sourceQuadratRows", 0),
            "partialOrMissingMacroSurveyCount": diagnostics.get("partialOrMissingMacroSurveyCount", 0),
        },
        "repeatSites": _event_repeats(records),
        "qualityChecks": {
            "duplicateSurveyIds": diagnostics.get("duplicateSurveyIdRows", 0),
            "duplicateQuadratIds": diagnostics.get("duplicateQuadratIds", 0),
            "missingOrInvalidTransectCoordinates": diagnostics.get("missingOrInvalidTransectCoordinates", 0),
            "invalidSurveyDates": diagnostics.get("invalidSurveyDateRows", 0),
            "invalidHardCoralFractions": diagnostics.get("invalidHardCoralFractions", 0),
            "over10KmTransectWarnings": diagnostics.get("transectLengthOver10KmWarnings", 0),
            "longTransectWarnings": long_transect_warnings,
            "sourceSurveyIdsUnique": diagnostics.get("duplicateSurveyIdRows", 0) == 0,
            "metricValuesAllWithin0To100": all(value is None or 0 <= value <= 100 for value in hard_values + macro_values),
            "recordValidation": "Pending validation by the DiveAtlas Reef Survey runtime schema validator.",
            "diagnosticCounts": dict(sorted((key, value) for key, value in diagnostics.items() if not key.startswith("invalidMacroRowsForSurvey:"))),
        },
        "licenseReview": LICENSE_EVIDENCE,
        "sourceFilesUsed": [SURVEYS_TABLE, LABELSETS_TABLE, *REGION_TABLES.values()],
        "largeAutomatedAnnotationTableRead": False,
    }

    return dataset, report, {
        "sourceFile": source_path.name,
        "sourceUrl": ARCHIVE_URL,
        "sourceDoi": DATASET_DOI,
        "sourceSizeBytes": source_size,
        "checksum": {"algorithm": "SHA-256", "value": source_sha256},
        "downloadedAt": datetime.fromtimestamp(source_path.stat().st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
        "generatedAt": generated_at,
        "licenseReview": LICENSE_EVIDENCE,
    }


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def validate_with_runtime_schema(dataset: dict[str, Any]) -> None:
    """Use DiveAtlas's canonical validator instead of duplicating its rules here."""
    validator = (
        "const schema=require('./js/reef-survey-schema.js');"
        "let text='';process.stdin.setEncoding('utf8');"
        "process.stdin.on('data',chunk=>text+=chunk);"
        "process.stdin.on('end',()=>{"
        "const result=schema.validateDataset(JSON.parse(text));"
        "if(!result.valid){console.error(result.errors.join('\\n'));process.exitCode=1;}"
        "});"
    )
    result = subprocess.run(
        ["node", "-e", validator],
        cwd=ROOT,
        input=json.dumps(dataset, ensure_ascii=False, separators=(",", ":")),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        detail = result.stderr.strip() or "Canonical dataset validation failed."
        raise ValueError(detail)


def build_ui_metadata(dataset: dict[str, Any], canonical_byte_size: int) -> dict[str, Any]:
    """Build a local-only sidecar for the gated map view without resolving the license conflict."""
    metadata = dataset["metadata"]
    return {
        "schemaVersion": 1,
        "provider": PROVIDER,
        "sourceDoi": DATASET_DOI,
        "sourceUrl": DATASET_URL,
        "citation": PAPER_CITATION,
        "dataUrl": "./data/.build/reef_condition/seaview/canonical.json.gz",
        "canonicalSchemaVersion": dataset["schemaVersion"],
        "generatedAt": metadata["generatedAt"],
        "eventCount": metadata["eventCount"],
        "siteCount": metadata["sourceSiteCount"],
        "dateRange": metadata["dateRange"],
        "datasetTitle": DATASET_TITLE,
        "methodology": "SVII transect photo-quadrat survey with automated benthic image classification",
        "displayStatus": "Seaview Survey · Local research",
        "displayExplanation": "License under clarification — local evaluation only. The repository record and bundled data guide state different license terms; production redistribution is not approved.",
        "licenseReview": metadata["licenseReview"],
        "licenseDisplay": "License under clarification — local evaluation only",
        "productionRedistributionApproved": False,
        "canonicalByteSize": canonical_byte_size,
    }


def write_outputs(
    source_path: Path,
    output_path: Path,
    report_path: Path,
    manifest_path: Path,
    *,
    metadata_path: Path = DEFAULT_METADATA,
    generated_at: str | None = None,
) -> dict[str, Any]:
    started_at = time.perf_counter()
    local_root = (ROOT / "data/.build/reef_condition/seaview").resolve()
    for output_path_candidate in (Path(output_path), Path(report_path), Path(manifest_path), Path(metadata_path)):
        resolved = output_path_candidate.resolve()
        if local_root not in resolved.parents:
            raise ValueError("Seaview outputs must remain under data/.build/reef_condition/seaview.")
    dataset, report, manifest = adapt_archive(source_path, generated_at=generated_at)
    # The browser and canonical contract are JS-owned; validating through that
    # implementation prevents the research adapter from drifting independently.
    validate_with_runtime_schema(dataset)
    report["qualityChecks"]["recordValidation"] = (
        "Validated by the DiveAtlas Reef Survey runtime schema validator before output was written."
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(dataset, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    output_path.write_bytes(gzip.compress(payload, mtime=0))
    report["canonicalOutput"] = str(output_path)
    report["canonicalUncompressedBytes"] = len(payload)
    report["canonicalOutputBytes"] = output_path.stat().st_size
    report["conversionAndCompressionSeconds"] = round(time.perf_counter() - started_at, 3)
    metadata = build_ui_metadata(dataset, output_path.stat().st_size)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    _write_json(metadata_path, metadata)
    _write_json(report_path, report)
    _write_json(manifest_path, manifest)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="local Q1281 tabular-data.zip archive")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="ignored local canonical gzip JSON output")
    parser.add_argument("--metadata", type=Path, default=DEFAULT_METADATA, help="ignored local UI metadata sidecar")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT, help="ignored local conversion report")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST, help="ignored local source snapshot manifest")
    parser.add_argument("--generated-at", help="ISO timestamp override for deterministic regeneration")
    args = parser.parse_args()
    report = write_outputs(args.input, args.output, args.report, args.manifest, metadata_path=args.metadata, generated_at=args.generated_at)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
