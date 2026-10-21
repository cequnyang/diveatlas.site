#!/usr/bin/env python3
"""Suggest and optionally fill missing destination regions from nearby labeled sites."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SITE_DATA = ROOT / "datasets" / "dive-sites.js"
DEFAULT_REPORT = ROOT / "reports" / "dive-site-region-enrichment.csv"
RADIUS_KM = 5.0
MIN_PEERS = 3
MIN_CONSENSUS = 0.8
CELL_DEGREES = 0.1
EARTH_RADIUS_KM = 6371.0088


def normalized(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).casefold()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def valid_coordinates(row: list[object]) -> bool:
    return (len(row) > 12 and isinstance(row[1], (int, float))
            and isinstance(row[2], (int, float))
            and math.isfinite(row[1]) and math.isfinite(row[2])
            and -90 <= row[1] <= 90 and -180 <= row[2] <= 180)


def distance_km(a: list[object], b: list[object]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[1], a[2], b[1], b[2]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(min(1.0, value)))


def identity_keys(row: list[object]) -> set[str]:
    values = [row[0]]
    if len(row) > 11:
        values.extend(re.split(r"\s*[|;]\s*", str(row[11] or "")))
    return {key for value in values if (key := normalized(value))}


def has_local_region(row: list[object]) -> bool:
    """Country-level labels do not provide evidence for a local destination."""
    region = normalized(row[10] if len(row) > 10 else "")
    country = normalized(row[9] if len(row) > 9 else "")
    return bool(region and region != country)


def cell_for(row: list[object]) -> tuple[int, int]:
    lat, lon = float(row[1]), float(row[2])
    lat_cell = math.floor((lat + 90) / CELL_DEGREES)
    lon_cell = math.floor(((lon + 180) % 360) / CELL_DEGREES)
    return lat_cell, lon_cell


def nearby_indices(row: list[object], buckets: dict[tuple[int, int], list[int]],
                   row_count: int, radius_km: float) -> set[int]:
    lat_cell, lon_cell = cell_for(row)
    lat_steps = math.ceil(radius_km / (110.574 * CELL_DEGREES)) + 1
    cosine = abs(math.cos(math.radians(float(row[1]))))
    if cosine < 0.01:
        lon_cells = range(3600)
    else:
        lon_steps = math.ceil(radius_km / (111.320 * cosine * CELL_DEGREES)) + 1
        lon_cells = {(lon_cell + offset) % 3600 for offset in range(-lon_steps, lon_steps + 1)}
    found: set[int] = set()
    for lat_offset in range(-lat_steps, lat_steps + 1):
        candidate_lat = lat_cell + lat_offset
        if not 0 <= candidate_lat <= 1800:
            continue
        for candidate_lon in lon_cells:
            found.update(buckets.get((candidate_lat, candidate_lon), ()))
    return {index for index in found if index < row_count}


def suggest_regions(rows: list[list[object]], radius_km: float = RADIUS_KM,
                    min_peers: int = MIN_PEERS,
                    min_consensus: float = MIN_CONSENSUS) -> list[dict[str, object]]:
    """Return evidence-backed suggestions; never changes rows or non-region fields."""
    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        if valid_coordinates(row) and has_local_region(row):
            buckets[cell_for(row)].append(index)

    results = []
    for index, row in enumerate(rows):
        if not valid_coordinates(row) or str(row[10] or "").strip():
            continue

        peers = []
        seen_identities: set[str] = set()
        for peer_index in nearby_indices(row, buckets, len(rows), radius_km):
            peer = rows[peer_index]
            if peer_index == index:
                continue
            distance = distance_km(row, peer)
            if distance > radius_km:
                continue
            keys = identity_keys(peer)
            if not keys or keys & seen_identities:
                continue
            seen_identities.update(keys)
            peers.append((distance, peer))
        peers.sort(key=lambda item: (item[0], str(item[1][0]).casefold(), str(item[1][12])))

        labels = Counter(normalized(peer[10]) for _, peer in peers)
        display_labels: dict[str, str] = {}
        for _, peer in peers:
            display_labels.setdefault(normalized(peer[10]), str(peer[10]).strip())
        ordered = labels.most_common()
        candidate_key, agreeing = ordered[0] if ordered else ("", 0)
        consensus = agreeing / len(peers) if peers else 0.0
        target_country = normalized(row[9] if len(row) > 9 else "")
        decisive = (len(peers) >= min_peers and agreeing >= min_peers
                    and consensus >= min_consensus
                    and (len(ordered) == 1 or agreeing > ordered[1][1])
                    and candidate_key != target_country)
        evidence = [
            f"{peer[0]} [{peer[12]}] {distance:.2f} km → {str(peer[10]).strip()}"
            for distance, peer in peers if normalized(peer[10]) == candidate_key
        ][:5]
        results.append({
            "index": index,
            "site_id": str(row[12]),
            "site_name": str(row[0]),
            "candidate_region": display_labels.get(candidate_key, ""),
            "status": "auto_patch" if decisive else ("review" if peers else "no_nearby_evidence"),
            "neighbor_count": len(peers),
            "agreeing_count": agreeing,
            "consensus": consensus,
            "radius_km": radius_km,
            "evidence": "; ".join(evidence),
        })
    return results


def load_dataset(path: Path) -> tuple[str, list[list[object]], int, int]:
    source = path.read_text(encoding="utf-8-sig")
    assignment = source.find("=")
    if assignment < 0:
        raise ValueError(f"Could not find dataset assignment in {path}")
    start = assignment + 1
    rows, consumed = json.JSONDecoder().raw_decode(source[start:])
    if not isinstance(rows, list):
        raise ValueError("Dive-site data must be an array")
    return source, rows, start, consumed


def write_dataset(path: Path, source: str, rows: list[list[object]], start: int, consumed: int) -> None:
    replacement = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    path.write_bytes((source[:start] + replacement + source[start + consumed:]).encode("utf-8"))


def write_report(path: Path, suggestions: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["site_id", "site_name", "candidate_region", "status", "neighbor_count",
              "agreeing_count", "consensus", "radius_km", "evidence"]
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for suggestion in suggestions:
            writer.writerow({key: suggestion[key] for key in fields})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true",
                        help="fill only high-consensus region suggestions in the source dataset")
    parser.add_argument("--radius-km", type=float, default=RADIUS_KM)
    parser.add_argument("--min-peers", type=int, default=MIN_PEERS)
    parser.add_argument("--min-consensus", type=float, default=MIN_CONSENSUS)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--dataset", type=Path, default=SITE_DATA)
    args = parser.parse_args()
    if args.radius_km <= 0 or args.min_peers < 2 or not 0.5 < args.min_consensus <= 1:
        parser.error("Use a positive radius, at least two peers, and consensus in (0.5, 1].")

    source, rows, start, consumed = load_dataset(args.dataset)
    suggestions = suggest_regions(rows, args.radius_km, args.min_peers, args.min_consensus)
    write_report(args.report, suggestions)
    patchable = [item for item in suggestions if item["status"] == "auto_patch"]
    if args.apply:
        for item in patchable:
            rows[int(item["index"])][10] = item["candidate_region"]
        write_dataset(args.dataset, source, rows, start, consumed)

    counts = Counter(str(item["status"]) for item in suggestions)
    action = "Patched" if args.apply else "Would patch"
    print(f"Missing-region rows audited: {len(suggestions)}")
    print(f"{action} high-confidence rows: {len(patchable)}")
    print(f"Needs review: {counts['review']}; no nearby evidence: {counts['no_nearby_evidence']}")
    print(f"Evidence report: {args.report}")


if __name__ == "__main__":
    main()
