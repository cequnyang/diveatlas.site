"""Transform one MERMAID public summary event into canonical Reef Survey v2."""

from __future__ import annotations

from datetime import date, datetime
from math import isfinite
from typing import Any


SCHEMA_VERSION = 2
SOURCE_PROVIDER = "MERMAID"
PROTOCOL_METHODS = {
    "benthicpit": "PIT",
    "benthiclit": "LIT",
    "benthicpqt": "PQT",
    "bleachingqc": "BLEACHING",
}
BENTHIC_PROTOCOLS = frozenset({"benthicpit", "benthiclit", "benthicpqt"})
SUPPORTED_METRICS = ("liveCoralCover", "macroalgaeCover", "bleaching")


class TransformError(ValueError):
    """A source event could not be structurally transformed without guessing."""

    def __init__(self, sample_event_id: Any, source_path: str, source_value: Any, reason: str):
        super().__init__(reason)
        self.sample_event_id = sample_event_id
        self.source_path = source_path
        self.source_value = source_value
        self.reason = reason

    def as_dict(self) -> dict[str, Any]:
        return {
            "sampleEventId": self.sample_event_id,
            "path": self.source_path,
            "sourceValue": self.source_value,
            "reason": self.reason,
        }


def _plain(value: Any) -> Any:
    """Convert SDK date-like values and nested SDK records to JSON-shaped values."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "to_dict") and callable(value.to_dict):
        return _plain(value.to_dict(include_extra=True))
    if isinstance(value, dict):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    return value


def _finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value)


def _date_value(value: Any) -> Any:
    value = _plain(value)
    if value is None or isinstance(value, str):
        return value
    return value


def _get_policy(event: dict[str, Any], source_method: str) -> tuple[str | None, Any]:
    key = f"data_policy_{source_method}"
    value = event.get(key)
    # Policy codes are not translated without the corresponding MERMAID vocabulary.
    return (value if isinstance(value, str) else None), value


def _benthic_metric(
    protocol: dict[str, Any],
    metric_key: str,
    category: str,
    diagnostics: list[dict[str, Any]],
    sample_event_id: Any,
    source_method: str,
    protocol_index: int,
) -> dict[str, Any]:
    average_field = "percent_cover_benthic_category_avg"
    sd_field = "percent_cover_benthic_category_sd"
    averages = protocol.get(average_field)
    deviations = protocol.get(sd_field)
    averages = averages if isinstance(averages, dict) else {}
    deviations = deviations if isinstance(deviations, dict) else {}
    raw_value = averages.get(category)
    raw_sd = deviations.get(category)
    value = raw_value if _finite_number(raw_value) else None
    sd = raw_sd if _finite_number(raw_sd) else None
    diagnostics.append({
        "sampleEventId": sample_event_id,
        "protocol": source_method,
        "metric": metric_key,
        "canonicalPath": f"protocols[{protocol_index}].metrics.{metric_key}.valuePct",
        "sourceField": f"protocols.{source_method}.{average_field}[{category!r}]",
        "sourceValue": raw_value,
        "canonicalValue": value,
        "status": "mapped" if value is not None else "missing-or-unusable",
        "reason": None if value is not None else "Category absent or source value is not a finite number; retained as null.",
    })
    diagnostics.append({
        "sampleEventId": sample_event_id,
        "protocol": source_method,
        "metric": metric_key,
        "canonicalPath": f"protocols[{protocol_index}].metrics.{metric_key}.sdPct",
        "sourceField": f"protocols.{source_method}.{sd_field}[{category!r}]",
        "sourceValue": raw_sd,
        "canonicalValue": sd,
        "status": "mapped" if sd is not None else "missing-or-unusable",
        "reason": None if sd is not None else "No finite SD was supplied; retained as null.",
    })
    return {"valuePct": value, "sdPct": sd, "basis": "benthic-cover"}


def _bleaching_metric(
    protocol: dict[str, Any], diagnostics: list[dict[str, Any]], sample_event_id: Any, protocol_index: int
) -> dict[str, Any]:
    colony_summary = protocol.get("colonies_bleached")
    if not isinstance(colony_summary, dict):
        colony_summary = protocol
    source_fields = {
        "bleachedColoniesPct": "percent_bleached_avg",
        "paleColoniesPct": "percent_pale_avg",
        "normalColoniesPct": "percent_normal_avg",
        "recentlyDeadColoniesPct": "percent_dead_avg",
    }
    metrics: dict[str, Any] = {"basis": "coral-colonies"}
    for canonical_key, source_field in source_fields.items():
        raw_value = colony_summary.get(source_field)
        value = raw_value if _finite_number(raw_value) else None
        metrics[canonical_key] = value
        diagnostics.append({
            "sampleEventId": sample_event_id,
            "protocol": "bleachingqc",
            "metric": canonical_key,
            "canonicalPath": f"protocols[{protocol_index}].metrics.bleaching.{canonical_key}",
            "sourceField": f"protocols.bleachingqc.colonies_bleached.{source_field}" if colony_summary is not protocol else f"protocols.bleachingqc.{source_field}",
            "sourceValue": raw_value,
            "canonicalValue": value,
            "status": "mapped" if value is not None else "missing-or-unusable",
            "reason": None if value is not None else "No finite percentage was supplied; retained as null.",
        })

    raw_count = colony_summary.get("count_total_avg")
    if isinstance(raw_count, bool) or not _finite_number(raw_count) or not float(raw_count).is_integer():
        colony_count = None
        reason = "Source average is not an integer count; it was not rounded."
        status = "missing-or-unusable" if raw_count is None else "not-mapped"
    else:
        colony_count = int(raw_count)
        reason = None
        status = "mapped"
    metrics["colonyCount"] = colony_count
    diagnostics.append({
        "sampleEventId": sample_event_id,
        "protocol": "bleachingqc",
        "metric": "colonyCount",
        "canonicalPath": f"protocols[{protocol_index}].metrics.bleaching.colonyCount",
        "sourceField": "protocols.bleachingqc.colonies_bleached.count_total_avg" if colony_summary is not protocol else "protocols.bleachingqc.count_total_avg",
        "sourceValue": raw_count,
        "canonicalValue": colony_count,
        "status": status,
        "reason": reason,
    })
    return metrics


def _record_unmapped_fields(
    source_summary: dict[str, Any], source_method: str, sample_event_id: Any, diagnostics: list[dict[str, Any]]
) -> None:
    nested_unmapped: list[tuple[str, Any]] = []
    if source_method in BENTHIC_PROTOCOLS:
        known_fields = {
            "sample_unit_count",
            "percent_cover_benthic_category_avg",
            "percent_cover_benthic_category_sd",
        }
    elif source_method == "bleachingqc":
        known_fields = {
            "sample_unit_count", "colonies_bleached", "quadrat_benthic_percent",
            "percent_bleached_avg", "percent_pale_avg", "percent_normal_avg",
            "percent_dead_avg", "count_total_avg",
        }
        colony_fields = {
            "percent_bleached_avg", "percent_pale_avg", "percent_normal_avg",
            "percent_dead_avg", "count_total_avg",
        }
        colonies = source_summary.get("colonies_bleached")
        if isinstance(colonies, dict):
            nested_unmapped.extend((f"colonies_bleached.{key}", value) for key, value in colonies.items() if key not in colony_fields)
        quadrat_benthic = source_summary.get("quadrat_benthic_percent")
        if isinstance(quadrat_benthic, dict):
            nested_unmapped.append(("quadrat_benthic_percent", quadrat_benthic))
    else:
        known_fields = {"sample_unit_count"}

    unmapped = [(key, value) for key, value in source_summary.items() if key not in known_fields]
    unmapped.extend(nested_unmapped)
    for key, value in unmapped:
        if isinstance(value, dict):
            value_summary: Any = {"keys": sorted(value)}
        elif isinstance(value, (list, tuple)):
            value_summary = {"itemCount": len(value)}
        else:
            value_summary = {"type": type(value).__name__}
        diagnostics.append({
            "sampleEventId": sample_event_id,
            "protocol": source_method,
            "metric": None,
            "canonicalPath": None,
            "sourceField": f"protocols.{source_method}.{key}",
            "sourceValue": value_summary,
            "canonicalValue": None,
            "status": "unmapped-source-field",
            "reason": "Field is retained in the local report for semantic review; it is not mapped into schema v2.",
        })


def adapt_event(source_event: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Return one schema-v2 event plus local-only field-level transformation diagnostics."""
    event = _plain(source_event)
    if not isinstance(event, dict):
        raise TransformError(None, "record", event, "Summary sample event must be an object.")
    sample_event_id = event.get("sample_event_id")
    if not isinstance(sample_event_id, str) or not sample_event_id.strip():
        raise TransformError(sample_event_id, "sample_event_id", sample_event_id, "A non-empty event identifier is required.")
    source_protocols = event.get("protocols")
    if not isinstance(source_protocols, dict):
        raise TransformError(sample_event_id, "protocols", source_protocols, "Protocol summaries must be an object.")

    diagnostics: list[dict[str, Any]] = []
    protocols: list[dict[str, Any]] = []
    for protocol_index, (source_method, source_summary) in enumerate(source_protocols.items()):
        if not isinstance(source_summary, dict):
            raise TransformError(sample_event_id, f"protocols.{source_method}", source_summary, "Protocol summary must be an object.")
        normalized_method = PROTOCOL_METHODS.get(source_method, "other")
        policy, raw_policy = _get_policy(event, source_method)
        protocol: dict[str, Any] = {
            "method": normalized_method,
            "sourceMethod": source_method,
            "sampleUnitCount": source_summary.get("sample_unit_count"),
            "depth": {
                "meanM": event.get("depth_avg"),
                "sdM": event.get("depth_sd"),
            },
            "metrics": {},
            "dataPolicy": policy,
        }
        diagnostics.extend([
            {
                "sampleEventId": sample_event_id,
                "protocol": source_method,
                "metric": None,
                "canonicalPath": f"protocols[{protocol_index}].sampleUnitCount",
                "sourceField": f"protocols.{source_method}.sample_unit_count",
                "sourceValue": source_summary.get("sample_unit_count"),
                "canonicalValue": protocol["sampleUnitCount"],
                "status": "mapped" if protocol["sampleUnitCount"] is not None else "missing",
                "reason": None,
            },
            {
                "sampleEventId": sample_event_id,
                "protocol": source_method,
                "metric": None,
                "canonicalPath": f"protocols[{protocol_index}].depth.meanM",
                "sourceField": "depth_avg",
                "sourceValue": event.get("depth_avg"),
                "canonicalValue": event.get("depth_avg"),
                "status": "mapped" if event.get("depth_avg") is not None else "missing",
                "reason": None,
            },
            {
                "sampleEventId": sample_event_id,
                "protocol": source_method,
                "metric": None,
                "canonicalPath": f"protocols[{protocol_index}].depth.sdM",
                "sourceField": "depth_sd",
                "sourceValue": event.get("depth_sd"),
                "canonicalValue": event.get("depth_sd"),
                "status": "mapped" if event.get("depth_sd") is not None else "missing",
                "reason": None,
            },
        ])
        diagnostics.append({
            "sampleEventId": sample_event_id,
            "protocol": source_method,
            "metric": None,
            "canonicalPath": f"protocols[{protocol_index}].dataPolicy",
            "sourceField": f"data_policy_{source_method}",
            "sourceValue": raw_policy,
            "canonicalValue": policy,
            "status": "mapped" if policy is not None else "missing-or-unmapped",
            "reason": None if policy is not None or raw_policy is None else "Non-string policy code was not interpreted without its controlled vocabulary.",
        })
        if source_method in BENTHIC_PROTOCOLS:
            protocol["metrics"]["liveCoralCover"] = _benthic_metric(
                source_summary, "liveCoralCover", "Hard coral", diagnostics, sample_event_id, source_method, protocol_index
            )
            protocol["metrics"]["macroalgaeCover"] = _benthic_metric(
                source_summary, "macroalgaeCover", "Macroalgae", diagnostics, sample_event_id, source_method, protocol_index
            )
        elif source_method == "bleachingqc":
            protocol["metrics"]["bleaching"] = _bleaching_metric(source_summary, diagnostics, sample_event_id, protocol_index)
        else:
            diagnostics.append({
                "sampleEventId": sample_event_id,
                "protocol": source_method,
                "metric": None,
                "sourceField": f"protocols.{source_method}",
                "sourceValue": sorted(source_summary),
                "canonicalValue": None,
                "status": "retained-as-other",
                "reason": "Protocol is retained by name and count, but no metric semantics are mapped.",
            })
        _record_unmapped_fields(source_summary, source_method, sample_event_id, diagnostics)
        protocols.append(protocol)

    raw_license = event.get("license")
    license_value = raw_license if isinstance(raw_license, str) else None
    record = {
        "schemaVersion": SCHEMA_VERSION,
        "id": f"mermaid:{sample_event_id}",
        "location": {
            "lat": event.get("latitude"),
            "lon": event.get("longitude"),
            "siteName": event.get("site_name"),
            "sourceSiteId": event.get("site_id"),
            "region": None,
            "country": event.get("country_name"),
        },
        "survey": {
            "date": _date_value(event.get("sample_date")),
            "managementRegime": event.get("management_name"),
        },
        "protocols": protocols,
        "quality": {"confidenceLevel": None},
        "provenance": {
            "provider": SOURCE_PROVIDER,
            "projectId": event.get("project_id"),
            "sourceRecordId": sample_event_id,
            "projectName": event.get("project_name"),
            "suggestedCitation": event.get("suggested_citation"),
            "license": license_value,
            "sourceUrl": event.get("sample_event_url") if isinstance(event.get("sample_event_url"), str) else None,
        },
    }
    diagnostics.append({
        "sampleEventId": sample_event_id,
        "protocol": None,
        "metric": None,
        "canonicalPath": "provenance.license",
        "sourceField": "license",
        "sourceValue": raw_license,
        "canonicalValue": license_value,
        "status": "mapped" if license_value is not None else "not-inferred",
        "reason": None if license_value is not None else "No explicit license was supplied; license remains null.",
    })
    diagnostics.append({
        "sampleEventId": sample_event_id,
        "protocol": None,
        "metric": None,
        "canonicalPath": "location.sourceSiteId",
        "sourceField": "site_id",
        "sourceValue": event.get("site_id"),
        "canonicalValue": event.get("site_id"),
        "status": "mapped" if event.get("site_id") is not None else "missing",
        "reason": None,
    })
    diagnostics.extend([
        {
            "sampleEventId": sample_event_id,
            "protocol": None,
            "metric": None,
            "canonicalPath": "provenance.projectId",
            "sourceField": "project_id",
            "sourceValue": event.get("project_id"),
            "canonicalValue": event.get("project_id"),
            "status": "mapped" if event.get("project_id") is not None else "missing",
            "reason": None,
        },
        {
            "sampleEventId": sample_event_id,
            "protocol": None,
            "metric": None,
            "canonicalPath": "provenance.projectName",
            "sourceField": "project_name",
            "sourceValue": event.get("project_name"),
            "canonicalValue": event.get("project_name"),
            "status": "mapped" if event.get("project_name") is not None else "missing",
            "reason": None,
        },
        {
            "sampleEventId": sample_event_id,
            "protocol": None,
            "metric": None,
            "canonicalPath": "provenance.suggestedCitation",
            "sourceField": "suggested_citation",
            "sourceValue": event.get("suggested_citation"),
            "canonicalValue": event.get("suggested_citation"),
            "status": "mapped" if event.get("suggested_citation") is not None else "missing",
            "reason": None,
        },
        {
            "sampleEventId": sample_event_id,
            "protocol": None,
            "metric": None,
            "canonicalPath": "provenance.sourceUrl",
            "sourceField": "sample_event_url",
            "sourceValue": event.get("sample_event_url"),
            "canonicalValue": record["provenance"]["sourceUrl"],
            "status": "mapped" if record["provenance"]["sourceUrl"] is not None else "not-present",
            "reason": None if record["provenance"]["sourceUrl"] is not None else "No explicit sample-event URL was supplied.",
        },
    ])
    known_event_fields = {
        "sample_event_id", "sample_date", "site_id", "site_name", "site_notes", "latitude", "longitude",
        "country_id", "country_name", "reef_type", "reef_zone", "reef_exposure", "depth_avg", "depth_sd",
        "project_id", "project_name", "project_notes", "project_includes_gfcr", "project_admins", "tags", "observers",
        "management_id", "management_name", "management_est_year", "management_size", "management_parties",
        "management_compliance", "management_rules", "management_notes", "protocols", "contact_link",
        "suggested_citation", "license", "sample_event_url",
    }
    for key, value in event.items():
        if key in known_event_fields or key.startswith("data_policy_"):
            continue
        if isinstance(value, dict):
            source_shape: Any = {"keys": sorted(value)}
        elif isinstance(value, (list, tuple)):
            source_shape = {"itemCount": len(value)}
        else:
            source_shape = {"type": type(value).__name__}
        diagnostics.append({
            "sampleEventId": sample_event_id,
            "protocol": None,
            "metric": None,
            "canonicalPath": None,
            "sourceField": key,
            "sourceValue": source_shape,
            "canonicalValue": None,
            "status": "unmapped-source-field",
            "reason": "Unrecognized event-level field retained by name and shape for local review.",
        })
    if event.get("contact_link") is not None:
        diagnostics.append({
            "sampleEventId": sample_event_id,
            "protocol": None,
            "metric": None,
            "canonicalPath": None,
            "sourceField": "contact_link",
            "sourceValue": event.get("contact_link"),
            "canonicalValue": None,
            "status": "not-mapped",
            "reason": "Contact link is not assumed to be a stable URL for this sample event.",
        })
    return record, diagnostics


def classify_candidates(record: dict[str, Any], metric_key: str) -> tuple[str, list[dict[str, Any]]]:
    """Classify all non-null, compatible protocol candidates without selecting one."""
    candidates: list[dict[str, Any]] = []
    for protocol in record.get("protocols", []):
        metric = protocol.get("metrics", {}).get(metric_key)
        if not isinstance(metric, dict):
            continue
        if metric_key in {"liveCoralCover", "macroalgaeCover"}:
            value = metric.get("valuePct")
            basis = "benthic-cover"
        elif metric_key == "bleaching":
            value = metric.get("bleachedColoniesPct")
            basis = "coral-colonies"
        else:
            continue
        if metric.get("basis") != basis or value is None:
            continue
        candidates.append({"method": protocol.get("method"), "sourceMethod": protocol.get("sourceMethod"), "value": value})
    state = "MISSING" if not candidates else "UNIQUE" if len(candidates) == 1 else "AMBIGUOUS"
    return state, candidates
