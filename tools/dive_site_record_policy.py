"""Retain public source evidence and apply explicit, fail-closed identity reviews.

Name/proximity hints never establish identity. Imported rows remain untouched;
canonical views retain each member's observations and compatible UUID endpoints.
"""
from __future__ import annotations

import copy
import json
import math
import re
import unicodedata
from collections import Counter
from itertools import combinations
from pathlib import Path
from urllib.parse import urlsplit

REVIEWS = Path(__file__).with_name("dive_site_record_reviews.json")
SOURCE_FIELDS = ("label", "url", "referenceId", "retrievedAt", "snapshotDate",
                 "sourceClass", "limitations", "claims", "scope")
OBSERVATION_FIELDS = ("source", "url", "source_record_id", "retrieved_at", "snapshot_date",
                      "name", "lat", "lon", "difficulty", "difficulty_raw", "aliases")


def levels(value):
    values = value if isinstance(value, list) else re.split(r"\s*(?:\||,|;|\bto\b)\s*", str(value or ""), flags=re.I)
    return list(dict.fromkeys(str(item).strip() for item in values if str(item).strip()))


def names(value):
    # A comma or the word "to" can be part of a name, rather than a delimiter.
    values = value if isinstance(value, list) else str(value or "").split("|")
    return list(dict.fromkeys(str(item).strip() for item in values if str(item).strip()))


def level_key(value):
    return " | ".join(sorted({unicodedata.normalize("NFKC", item).casefold() for item in levels(value)}))


def source_url(value):
    if not isinstance(value, str):
        return ""
    try:
        parsed = urlsplit(value)
        return value if parsed.scheme in {"https", "http"} and parsed.netloc else ""
    except ValueError:
        return ""


def decode_sources(sources, *, defaults=None, snapshot=False):
    """Decode summary-v2 tuples: slot 2 is referenceId, NEVER a date.

    Keep declared source defaults (including dates) as recorded metadata; do not
    infer retrieval dates from labels, review dates, URLs or snapshot dates.
    """
    result = []
    for raw in sources:
        if isinstance(raw, list) and len(raw) >= 2:
            kind = "snapshot" if snapshot else "linked" if raw[1] else "named"
            source = {**(defaults or {}).get(kind, {}), "label": raw[0], "url": raw[1]}
            if len(raw) > 2:
                source["referenceId"] = raw[2]
            if len(raw) > 3:
                source["claims"] = raw[3]
        elif isinstance(raw, dict):
            source = raw
        else:
            continue
        result.append({field: copy.deepcopy(source[field]) for field in SOURCE_FIELDS if field in source})
    return result


def record_sources(row, summary):
    sources = decode_sources(summary.get("source_provenance", summary.get("sources", [])))
    for source in sources:
        source.setdefault("scope", "summary-reference")
    evidence = row[17] if len(row) > 17 and isinstance(row[17], dict) else {}
    refs = str(evidence.get("evidenceUrlOrId") or "")
    if refs or evidence.get("evidenceSource"):
        # Category citations do not authenticate unrelated depth/level fields.
        sources.append({"label": evidence.get("evidenceSource") or "Unlabeled category reference",
                        "referenceId": refs, "scope": "category-reference",
                        "url": refs if source_url(refs) and ";" not in refs else None,
                        "retrievedAt": evidence.get("retrievedAt")})
    return sources


def public_source_links(record):
    links = []
    for source in record.get("source_provenance", []):
        urls = [source.get("url"), *str(source.get("referenceId") or "").split(";")]
        for url in urls:
            url = source_url(url.strip() if isinstance(url, str) else url)
            if url and [source.get("label") or "Reference", url] not in links:
                links.append([source.get("label") or "Reference", url])
    for observation in record.get("observations", []):
        url = source_url(observation.get("url"))
        if url and [observation["source"], url] not in links:
            links.append([observation["source"], url])
    return links


def read_reviews():
    payload = json.loads(REVIEWS.read_text(encoding="utf-8"))
    if payload.get("schema") != "dive-site-record-reviews-v1":
        raise ValueError("Unsupported dive-site record review schema")
    return payload


def reviewed_observation(raw, site_id):
    if not isinstance(raw, dict) or not raw.get("source") or not raw.get("name"):
        raise ValueError("A reviewed observation needs a source and source-specific name")
    result = {field: copy.deepcopy(raw[field]) for field in OBSERVATION_FIELDS if field in raw}
    result["record_id"] = site_id
    result["depths"] = []
    for depth in raw.get("depths", []):
        try:
            valid = (not isinstance(depth["value"], bool) and math.isfinite(float(depth["value"]))
                     and float(depth["value"]) >= 0 and depth["meaning"] in {"maximum", "typical", "unknown"})
        except (KeyError, ValueError, TypeError):
            valid = False
        if not valid:
            raise ValueError("Reviewed depths require a finite value and maximum/typical/unknown meaning")
        result["depths"].append({field: copy.deepcopy(depth[field]) for field in ("value", "meaning", "field") if field in depth})
    return result


def validate_reviews(reviews, by_id, counts):
    decisions = reviews.get("identities", [])
    for site_id in reviews.get("observations", {}):
        if site_id not in by_id or counts[site_id] != 1:
            raise ValueError("Observation review references a missing or ambiguous record")
    canonical = {key: key for key in by_id}
    seen_pairs, assigned = {}, set()
    for decision in decisions:
        ids, status = decision.get("site_ids", []), decision.get("status")
        if (not isinstance(ids, list) or len(ids) < 2 or not all(isinstance(key, str) for key in ids) or len(set(ids)) != len(ids)
                or any(key not in by_id or counts[key] != 1 for key in ids)):
            raise ValueError("Identity review must reference distinct, unique existing records")
        if status not in {"candidate", "confirmed", "distinct"} or not isinstance(decision.get("reason"), str) or not decision["reason"].strip():
            raise ValueError("Identity review needs a status and reason")
        if 'evidence' in decision and (not isinstance(decision['evidence'], list)
                or any(not isinstance(item, str) or not item.strip() for item in decision['evidence'])):
            raise ValueError("Identity evidence must be a list of nonempty references")
        for pair in combinations(sorted(ids), 2):
            if pair in seen_pairs:
                raise ValueError("Conflicting or repeated pairwise identity decisions")
            seen_pairs[pair] = status
        if status == "confirmed":
            evidence = decision.get("evidence")
            target = decision.get("canonical_id")
            if (target not in ids or assigned.intersection(ids) or not isinstance(evidence, list)
                    or not evidence or any(not isinstance(item, str) or not item.strip() for item in evidence)):
                raise ValueError("Confirmed identity needs a unique canonical member and nonempty evidence list")
            for key in ids:
                row = by_id[key]
                if (not row[0] or any(isinstance(v, bool) or not isinstance(v, (float, int))
                                    or not math.isfinite(v) for v in row[1:3])
                        or not -90 <= row[1] <= 90 or not -180 <= row[2] <= 180):
                    raise ValueError("Confirmed members must have exportable names and coordinates")
                canonical[key] = target
            assigned.update(ids)
    resolved_pairs = {}
    for (first, second), status in seen_pairs.items():
        if status == 'confirmed':
            continue
        if canonical[first] == canonical[second]:
            raise ValueError("A confirmed identity cannot also be candidate or distinct")
        pair = tuple(sorted((canonical[first], canonical[second])))
        if pair in resolved_pairs and resolved_pairs[pair] != status:
            raise ValueError("Identity decisions contradict one another across confirmed aliases")
        resolved_pairs[pair] = status
    return decisions


def observation_note(observation):
    depths = "; ".join(f"{item['value']} m ({item['meaning']})" for item in observation.get("depths", [])) or "not recorded"
    # Preserve ambiguous raw wording instead of presenting parsed endpoints as a
    # verified range of training/suitability levels.
    raw = observation.get("difficulty_raw", observation.get("difficulty"))
    labels = ", ".join(map(str, raw)) if isinstance(raw, list) else str(raw or "not recorded")
    return (f"{observation['source']}: {observation['name']}; "
            f"coordinates {observation.get('lat', 'unknown')}, {observation.get('lon', 'unknown')}; "
            f"recorded labels: {labels}; depth: {depths}. "
            f"Source URL: {observation.get('url') or 'not retained'}. "
            f"Source record ID: {observation.get('source_record_id') or 'not retained'}. "
            f"Retrieval date: {observation.get('retrieved_at') or 'unknown'}. "
            f"Snapshot date: {observation.get('snapshot_date') or 'unknown'}.")


def normalize_records(rows, summaries, reviews=None):
    reviews = read_reviews() if reviews is None else reviews
    by_id = {str(row[12]).lower(): row for row in rows if len(row) > 12}
    counts = Counter(str(row[12]).lower() for row in rows if len(row) > 12)
    decisions = validate_reviews(reviews, by_id, counts)
    result = {}
    for site_id, row in by_id.items():
        summary = summaries.get(site_id) or {}
        observation = {
            "record_id": site_id,
            "source": "Imported record (listed providers: " + str(row[8] or "unknown") + ")",
            "url": None, "retrieved_at": None, "name": row[0], "lat": row[1], "lon": row[2],
            "difficulty": levels(row[6]), "difficulty_raw": row[6], "aliases": row[11],
            "depths": [{"value": row[index], "meaning": "unknown", "field": field}
                       for index, field in ((3, "depth_min"), (4, "depth_max"), (5, "recorded_depth"))
                       if row[index] is not None and row[index] != ""],
        }
        observations = [observation, *(reviewed_observation(raw, site_id)
                        for raw in reviews.get("observations", {}).get(site_id, []))]
        result[site_id] = {"canonical_id": site_id, "identity_status": "separate",
                           "identity_members": [site_id], "observations": observations,
                           "source_provenance": record_sources(row, summary), "identity_candidates": [],
                           "identity_decisions": [],
                           "summary_evidence_notes": [summary['evidenceNote']] if summary.get('evidenceNote') else [],
                           "aliases": " | ".join(dict.fromkeys([*names(row[11]),
                               *(o['name'] for o in observations if o['name'] != row[0])]))}
    for decision in decisions:
        ids, status = decision["site_ids"], decision["status"]
        public_decision = {field: copy.deepcopy(decision[field]) for field in
                           ("status", "site_ids", "canonical_id", "reason", "evidence") if field in decision}
        for key in ids:
            result[key]["identity_decisions"].append(public_decision)
        if status == "confirmed":
            observations = [item for key in ids for item in result[key]["observations"]]
            sources = [item for key in ids for item in result[key]["source_provenance"]]
            aliases = list(dict.fromkeys(name for key in ids for name in [by_id[key][0], *names(result[key]['aliases'])]))
            summary_notes = [note for key in ids for note in result[key]['summary_evidence_notes']]
            for key in ids:
                result[key].update(canonical_id=decision["canonical_id"], identity_status="confirmed",
                                   identity_members=list(ids), observations=observations, source_provenance=sources,
                                   summary_evidence_notes=summary_notes, aliases=" | ".join(aliases))
        elif status == "candidate":
            for key in ids:
                result[key]["identity_candidates"].extend({"site_id": other, "name": by_id[other][0],
                    "reason": decision["reason"]} for other in ids if other != key)
    for record in result.values():
        notes = ["Recorded experience labels are source reports, not verified suitability. Depth alone does not establish difficulty."]
        for decision in record["identity_decisions"]:
            if decision["status"] != "candidate":
                notes.append(f"Reviewed identity: {decision['status']}; records {', '.join(decision['site_ids'])}. "
                             f"{decision['reason']} Evidence: {'; '.join(decision.get('evidence', [])) or 'not retained'}.")
        notes.extend(observation_note(observation) for observation in record["observations"])
        notes.extend("Source summary note: " + note for note in record['summary_evidence_notes'])
        for source in record['source_provenance']:
            notes.append(f"Reference ({source.get('scope', 'unspecified')}): {source.get('label') or 'unlabeled'}; "
                         f"URL: {source.get('url') or 'not retained'}; reference ID: {source.get('referenceId') or 'not retained'}; "
                         f"recorded retrieval date: {source.get('retrievedAt') or 'unknown'}. "
                         f"{source.get('limitations') or ''}")
        for candidate in record["identity_candidates"]:
            notes.append(f"Possible related record: {candidate['name']} ({candidate['site_id']}). {candidate['reason']} "
                         "These records remain separate; differences are not an established same-site conflict.")
            notes.extend("Separate candidate observation — " + observation_note(observation)
                         for observation in result[candidate['site_id']]['observations'])
        # Different semantic meanings are not disagreements: a typical dive can
        # legitimately be shallower than a maximum. Unknown values are not comparable.
        values_by_meaning = {}
        for observation in record['observations']:
            for depth in observation.get('depths', []):
                if depth['meaning'] != 'unknown':
                    values_by_meaning.setdefault(depth['meaning'], set()).add(float(depth['value']))
        known_conflict = any(len(values) > 1 for values in values_by_meaning.values())
        difficulty_sets = {level_key(o.get('difficulty')) for o in record['observations'] if o.get('difficulty')}
        if known_conflict or len(difficulty_sets) > 1:
            notes.append("Source observations disagree in comparable depths or experience labels. The reports above remain unresolved; "
                         "route, depth meaning and suitability have not been verified. Values are not averaged.")
        if any(depth['meaning'] == 'unknown' for o in record['observations'] for depth in o.get('depths', [])):
            notes.append("Some depth meanings are unknown; these values cannot establish a same-depth disagreement or a typical dive depth.")
        record['evidence_notes'] = notes
        labels = {}
        for observation in record['observations']:
            for label in levels(observation.get('difficulty')):
                labels.setdefault(unicodedata.normalize('NFKC', label).casefold(), label)
        record['recorded_levels'] = list(labels.values())
    return result


def canonicalize_views(records, *, allow_missing=False):
    """Keep every UUID addressable; a missing canonical view is a build error."""
    by_id = {record['site_id']: record for record in records}
    for record in records:
        canonical = by_id.get(record.get('canonical_id'))
        if canonical is None and not allow_missing:
            raise ValueError('Confirmed canonical record is not exportable')
        if canonical and canonical is not record:
            for field in ('name', 'lat', 'lon', 'country', 'region', 'location_hierarchy',
                          'location_hierarchy_urls', 'region_url', 'summary', 'categories', 'photo'):
                if field in canonical:
                    record[field] = copy.deepcopy(canonical[field])
            if 'slug' in canonical:
                record['canonical_slug'] = canonical['slug']
    return records
