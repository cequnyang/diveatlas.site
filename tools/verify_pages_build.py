#!/usr/bin/env python3
"""Smoke-check the static Pages artifact's Reef Condition production boundary."""

from __future__ import annotations

import argparse
import hashlib
import gzip
import json
import re
import struct
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
THERMAL_ROOT = Path("data/reef-condition/thermal-stress-history")
OCEAN_HEAT_ROOT = Path("data/reef-condition/ocean-heat-history")
TIDE_DATA_ROOT = Path("data/tides")
TIDE_DEPLOYMENT_CONFIG = Path("js/tides/deployment-config.js")
DATA_ASSET_CONFIG = Path("js/data-assets-config.js")
FORBIDDEN_PATHS = (
    Path("data/.build"),
    Path("analysis"),
    Path("data/reef-condition/seaview"),
    Path("js/reef-condition-seaview-local.js"),
    Path("js/reef-condition-local-research.js"),
    Path("js/reef-condition-phase4-6-local.js"),
    Path("data/reef-condition/phase4-6"),
    Path("data/coral-heat-stress"),
    Path("data/temperature/development-1deg"),
    Path("tests/fixtures"),
    Path("artifacts"),
    Path("reports"),
    Path("js/coral-heat-stress-view.js"),
    Path("js/coral-heat-history-view.js"),
    Path("js/coral-heat-stress-style.js"),
)


def verify(output: Path) -> dict:
    output = output.resolve()
    if output.parent != ROOT or output.name != "_site" or not (output / "index.html").is_file():
        raise ValueError("Expected a completed Pages artifact in the repository _site directory")
    for relative in FORBIDDEN_PATHS:
        if (output / relative).exists():
            raise ValueError(f"Non-production or retired data was copied into Pages output: {relative}")
    unexpected_seaview_paths = [
        path.relative_to(output)
        for path in output.rglob("*")
        if path.is_file() and any("seaview" in part.casefold() for part in path.relative_to(output).parts)
    ]
    if unexpected_seaview_paths:
        raise ValueError(f"Local-only Seaview asset was copied into Pages output: {unexpected_seaview_paths[:5]}")

    index_text = (output / "index.html").read_text(encoding="utf-8")
    if any(local_only_label in index_text for local_only_label in (
            "seaviewHardCoralCoverPct", "seaviewMacroalgaeCoverPct", "Seaview Survey")):
        raise ValueError("Pages index exposes a local-only Seaview metric selector")

    retired_reef_paths = (
        Path("data/reef-condition/historical-benthic"),
        Path("data/reef-survey-evidence-coverage.geojson.gz"),
        Path("data/reef-survey-evidence-coverage-metadata.json"),
    )
    if any((output / path).exists() for path in retired_reef_paths):
        raise ValueError("Removed Tebbett or Reef Survey Evidence assets were copied into Pages output")
    if "tebbett" in index_text.casefold() or "historicalhardcoralcoverpct" in index_text or "historicalmacroalgaecoverpct" in index_text:
        raise ValueError("Pages index still exposes a removed Tebbett Reef Condition metric")
    tides = verify_tide_assets(output)
    data_assets = verify_data_assets(output)

    metadata_path = output / THERMAL_ROOT / "metadata.json"
    if data_assets["mode"] == "external":
        if metadata_path.exists():
            raise ValueError("External data mode must omit bundled thermal-history data")
        metadata = {"periods": None}
        thermal = {"mode": "external"}
    elif not metadata_path.is_file():
        raise ValueError("Thermal-history metadata is missing from Pages output")
    else:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("attribution") != "NOAA Coral Reef Watch":
            raise ValueError("Thermal-history attribution is missing or unsupported")
        encoding = metadata.get("encoding", {})
        if (metadata.get("recentYears") != 10 or encoding.get("query_bytes_per_cell") != 38 or
                "DCHR v2" not in encoding.get("query_format", "") or "uint16 hundredths" not in encoding.get("query_format", "") or
                "maximum annual DHW in the recent decade" not in encoding.get("map_format", "")):
            raise ValueError("Thermal-history assets do not use the recent-maximum DCHR v2 contract")
        assets = metadata.get("assets", {})
        map_tiles = list((output / THERMAL_ROOT / "tiles" / "5").glob("*/*.png"))
        query_chunks = list((output / THERMAL_ROOT / "query").glob("*.bin.gz"))
        if len(map_tiles) != assets.get("mapTileCount") or len(query_chunks) != assets.get("queryTileCount"):
            raise ValueError("Thermal-history map tiles or query chunks are incomplete")
        thermal_files = [metadata_path, *map_tiles, *query_chunks]
        total_bytes = sum(path.stat().st_size for path in thermal_files)
        largest = max(thermal_files, key=lambda path: path.stat().st_size)
        expected_bytes = assets.get("totalBytes", 0) + metadata_path.stat().st_size
        if total_bytes != expected_bytes:
            raise ValueError("Thermal-history output byte count differs from its generated metadata")
        thermal = {"mode": "bundled", "bytes": total_bytes, "mapTileCount": len(map_tiles), "queryChunkCount": len(query_chunks)}

    netcdf_count = sum(1 for path in output.rglob("*") if path.is_file() and path.suffix.lower() in {".nc", ".netcdf"})
    if netcdf_count:
        raise ValueError(f"Pages output contains {netcdf_count} NetCDF source file(s)")
    ocean_heat = verify_ocean_heat_assets(output)
    dive_experience = ({"mode": "external"} if data_assets["mode"] == "external"
                       else verify_dive_experience_assets(output))
    return {
        "output": str(output),
        "period": metadata.get("periods"),
        "thermalHistory": thermal,
        "netcdfSourceFiles": netcdf_count,
        "forbiddenDirectoriesPresent": [],
        "oceanHeatHistory": ocean_heat,
        "diveExperienceOutlook": dive_experience,
        "tideAssets": tides,
        "dataAssets": data_assets,
    }


def verify_data_assets(output: Path) -> dict:
    """Ensure external production mode carries no second copy of large data."""
    config = output / DATA_ASSET_CONFIG
    if not config.is_file():
        raise ValueError("Generated data asset configuration is missing")
    match = re.search(r"^window\.DIVEATLAS_DATA_ASSET_BASE_URL = (null|\"[^\"\r\n]*\");$", config.read_text(encoding="utf-8"), re.MULTILINE)
    if not match:
        raise ValueError("Generated data asset configuration has an unsupported format")
    base_url = None if match.group(1) == "null" else json.loads(match.group(1))
    runtime = output / "js/data-assets.js"
    if not runtime.is_file():
        raise ValueError("Data asset URL resolver is missing from the Pages artifact")
    if base_url is None:
        return {"mode": "bundled", "baseUrl": None}
    parsed = urlsplit(base_url)
    if (parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.query or
            parsed.fragment or not parsed.path.endswith("/")):
        raise ValueError("External data asset base URL is invalid")
    try:
        from prepare_pages import EXTERNAL_DATA_ROOTS
    except ImportError:
        import sys
        sys.path.insert(0, str(ROOT / "tools"))
        from prepare_pages import EXTERNAL_DATA_ROOTS
    bundled = [path.as_posix() for path in EXTERNAL_DATA_ROOTS if (output / path).exists()]
    if bundled:
        raise ValueError(f"External data mode still bundles large runtime assets: {bundled[:10]}")
    for manifest in ("bathymetry_manifest.js", "terrain_manifest.js", "reef_vector_manifest.js", "reef_raster_manifest.js", "coral_occurrence_manifest.js"):
        if not (output / "data" / manifest).is_file():
            raise ValueError(f"Startup manifest is missing from Pages artifact: data/{manifest}")
    return {"mode": "external", "baseUrl": base_url, "bundledLargeDataRoots": []}


def verify_tide_assets(output: Path) -> dict:
    """Ensure the Tide runtime config agrees with whether the data is bundled."""
    config = output / TIDE_DEPLOYMENT_CONFIG
    if not config.is_file():
        raise ValueError("Tide deployment config is missing from Pages output")
    match = re.search(r"^export const TIDE_ASSET_BASE_URL = (null|\"[^\"\r\n]*\");$", config.read_text(encoding="utf-8"), re.MULTILINE)
    if not match:
        raise ValueError("Tide deployment config has an unsupported format")
    base_url = None if match.group(1) == "null" else json.loads(match.group(1))
    local_tree = output / TIDE_DATA_ROOT
    if base_url is None:
        required = [local_tree / name / "manifest.json" for name in ("eot20-v1", "eot20-viz-v1", "timezones-2026d")]
        if any(not path.is_file() for path in required):
            raise ValueError("Bundled Tide mode is selected but one or more versioned data manifests are missing")
        files = [path for path in local_tree.rglob("*") if path.is_file()]
        return {"mode": "bundled", "fileCount": len(files), "totalBytes": sum(path.stat().st_size for path in files)}

    parsed = urlsplit(base_url)
    if (parsed.scheme not in {"https", "http"} or not parsed.netloc or parsed.username or parsed.password or
            parsed.query or parsed.fragment or not parsed.path.endswith("/")):
        raise ValueError("External Tide asset base URL is invalid or not normalized")
    if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("External Tide assets must use HTTPS outside local loopback development")
    if local_tree.exists():
        raise ValueError("External Tide mode must not include the bundled data/tides tree")
    return {"mode": "external", "baseUrl": base_url, "bundledFiles": 0, "bundledBytes": 0}


def verify_dive_experience_assets(output: Path) -> dict:
    """Validate the deliberately small, versioned consumer runtime package."""
    root = Path("data/dive-experience-outlook/v3")
    package = output / root
    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        raise ValueError("Dive Experience Outlook runtime manifest is missing from Pages output")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (manifest.get("format") != "diveatlas-dive-experience-outlook" or manifest.get("schemaVersion") != 1 or
            not all(isinstance(manifest.get(key), str) and manifest[key] for key in ("scoringVersion", "thresholdVersion", "dataVersion"))):
        raise ValueError("Dive Experience Outlook version metadata is missing or unsupported")
    grid = manifest.get("grid", {})
    # These registration fields control score lookup at cell centers, while
    # missingValue keeps transparent cells distinct from the lowest score.
    if grid != {"west": -180, "south": -85, "step": 0.5, "width": 720, "height": 340,
                "cellCenterOffset": 0.25, "missingValue": 255}:
        raise ValueError("Dive Experience Outlook must use the validated global 0.5-degree grid")
    scoring = manifest.get("scoring", {})
    estimation = manifest.get("oceanMissingDataEstimation", {})
    temperature_estimation = estimation.get("temperature", {})
    if (estimation.get("guide") != "docs/ocean-missing-data-estimation-guide.md" or
            temperature_estimation.get("estimateBeforeScoring") is not True or
            temperature_estimation.get("estimatedValuesReduceConfidence") is not True or
            temperature_estimation.get("estimatedValuesReduceScore") is not False or
            "analysis-only" not in temperature_estimation.get("beyondNativeSupport", "")):
        raise ValueError("Dive Experience missing-data estimation metadata is missing or invalid")
    if scoring.get("overallThresholds") != {"excellent": 85, "good": 70, "fair": 55}:
        raise ValueError("Dive Experience Outlook label thresholds changed without an approved version update")
    if scoring.get("physicalConditionThresholds") != {"comfortable": 85, "favorable": 70, "mixed": 55}:
        raise ValueError("Dive Conditions fallback labels changed without an approved version update")
    groups = scoring.get("groups", [])
    if [(group.get("id"), group.get("weight")) for group in groups] != [
            ("physicalExperience", 65), ("reefEcologicalExperience", 35)]:
        raise ValueError("Dive Experience Outlook block weights do not match the accepted model")
    dimensions = {dimension.get("id"): dimension for dimension in scoring.get("dimensions", [])}
    expected_weights = {"waterClarity": 20, "current": 15, "waveHeight": 15, "waterTemperature": 15,
                        "reefHabitatCoralEvidence": 15, "fishDensity": 10, "thermalStressHistory": 10}
    if any(dimensions.get(name, {}).get("weight") != weight for name, weight in expected_weights.items()):
        raise ValueError("Dive Experience Outlook dimension weights do not match the accepted model")
    if any(dimensions.get(name, {}).get("isScoreDimension") is not True for name in expected_weights):
        raise ValueError("Dive Experience Outlook must identify each weighted dimension for cell decoding")
    if dimensions.get("coralRecords", {}).get("weight") != 0 or dimensions.get("coralRecords", {}).get("isScoreDimension") is not False:
        raise ValueError("Coral Records must remain a zero-weight supporting source, not a separate score dimension")
    if any(name in dimensions for name in ("liveCoralCover", "observedBleaching", "macroalgaeCover")):
        raise ValueError("Removed reef dimensions must not be republished as scoring dimensions")
    if not dimensions.get("fishDensity", {}).get("enabled") or not dimensions.get("thermalStressHistory", {}).get("enabled"):
        raise ValueError("Production-ready ecological dimensions are missing from the runtime score model")
    physical_bands = scoring.get("physicalDimensionScoreBands", {})
    if any(len(physical_bands.get(name, [])) < 6 for name in ("temperature", "clarity", "current", "waves")):
        raise ValueError("Each active physical dimension must publish at least six explicit score bands")
    if len(scoring.get("fishOutlookBands", [])) < 6 or len(scoring.get("thermalHistoryExperienceHeuristic", [])) < 6:
        raise ValueError("Active ecological dimensions must publish at least six score bands")

    month_assets = manifest.get("months", [])
    if len(month_assets) != 12 or [month.get("month") for month in month_assets] != list(range(1, 13)):
        raise ValueError("Dive Experience Outlook must publish all 12 monthly grids")
    expected_files = {"manifest.json", "ocean-mask.bin.gz", "static-support.bin.gz", *[month["asset"] for month in month_assets]}
    actual_files = {path.name for path in package.iterdir() if path.is_file()}
    if actual_files != expected_files:
        raise ValueError(f"Unexpected or missing Dive Experience runtime files: expected {sorted(expected_files)}, got {sorted(actual_files)}")
    file_hashes = manifest.get("files", {})
    if set(file_hashes) != expected_files - {"manifest.json"}:
        raise ValueError("Dive Experience Outlook file digests do not enumerate every runtime data asset")

    cell_count = 720 * 340
    def unpack_grid(name: str, magic: bytes, version: int, bytes_per_cell: int) -> bytes:
        packed = (package / name).read_bytes()
        digest = hashlib.sha256(packed).hexdigest()
        if digest != file_hashes.get(name, {}).get("sha256"):
            raise ValueError(f"Dive Experience Outlook asset digest mismatch: {name}")
        data = gzip.decompress(packed)
        if (len(data) != 16 + cell_count * bytes_per_cell or data[:4] != magic or data[4] != version or
                struct.unpack_from("<HHHhh", data, 6) != (720, 340, 50, -1800, -850)):
            raise ValueError(f"Dive Experience Outlook grid header or size is invalid: {name}")
        return data

    mask = unpack_grid("ocean-mask.bin.gz", b"DAOM", 1, 8)
    if mask[5] != 8:
        raise ValueError("Dive Experience ocean mask must retain its 8 by 8 subcell format")
    support = unpack_grid("static-support.bin.gz", b"DAES", 1, 20)
    if manifest.get("encoding", {}).get("staticSupport", {}).get("bytesPerCell") != 20:
        raise ValueError("Dive Experience static support schema does not match the encoded asset")
    support_fields = {field.get("id") for field in manifest["encoding"]["staticSupport"].get("fields", [])}
    if not {"fishExperienceScore", "fishTier", "fishNearestObservationDistance", "fishSupportingSiteCount",
            "fishEffectiveSupport", "thermalStressScore", "meanAnnualMaximumDhw", "thermalSampleDistance"}.issubset(support_fields):
        raise ValueError("Dive Experience spatial-support fields are incomplete")
    if "fish_abundance" in json.dumps(manifest).lower() and "fish abundance outlook" not in json.dumps(manifest).lower():
        raise ValueError("Unexpected fish-density data was included in the runtime manifest")

    monthly_bytes = 0
    for month in month_assets:
        name = month["asset"]
        data = unpack_grid(name, b"DAEO", 3, 10)
        if data[5] != month["month"]:
            raise ValueError(f"Dive Experience month number does not match its grid: {name}")
        scores = data[16:16 + cell_count]
        physical = data[16 + cell_count:16 + 2 * cell_count]
        scored_count = sum(value <= 100 for value in scores)
        physical_count = sum(value <= 100 for value in physical)
        fallback_count = sum(1 for score, conditions in zip(scores, physical) if score > 100 and conditions <= 100)
        if (scored_count != month.get("scoredCells") or physical_count != month.get("physicalConditionCells") or
                fallback_count != month.get("physicalFallbackOnlyCells")):
            raise ValueError(f"Dive Experience cell-coverage counts differ from the month manifest: {name}")
        monthly_bytes += (package / name).stat().st_size
    runtime_assets = [package / name for name in expected_files if name != "manifest.json"]
    total_bytes = sum(path.stat().st_size for path in runtime_assets) + manifest_path.stat().st_size
    return {"scoringVersion": manifest["scoringVersion"], "thresholdVersion": manifest["thresholdVersion"],
            "dataVersion": manifest["dataVersion"], "monthCount": len(month_assets), "monthlyGridBytes": monthly_bytes,
            "allRuntimeBytes": total_bytes, "scoredCellsByMonth": {str(month["month"]): month["scoredCells"] for month in month_assets},
            "fishRawDensityIncluded": False, "reefEvidenceIsNotLiveCoralCover": True}


def verify_ocean_heat_assets(output: Path) -> dict:
    """Verify the published MHW provider contains only its curated payload."""
    if (output / DATA_ASSET_CONFIG).is_file() and "= \"" in (output / DATA_ASSET_CONFIG).read_text(encoding="utf-8"):
        if (output / OCEAN_HEAT_ROOT).exists():
            raise ValueError("External data mode must omit Ocean Heat History assets")
        return {"mode": "external"}
    metadata_path = output / OCEAN_HEAT_ROOT / "metadata.json"
    if not metadata_path.is_file():
        raise ValueError("Ocean Heat History metadata is missing from Pages output")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    period = metadata.get("sourcePeriod", {})
    query = metadata.get("query", {})
    assets = metadata.get("assets", {})
    expected_labels = ["No marine heatwave", "Moderate", "Strong", "Severe", "Extreme", "Beyond extreme"]
    if (metadata.get("schemaVersion") != 1 or metadata.get("provider") != "NOAA Coral Reef Watch" or
            metadata.get("product") != "Marine Heatwave Watch" or metadata.get("productVersion") != "1.0.1" or
            metadata.get("attribution") != "NOAA Coral Reef Watch" or
            period.get("endYear", 0) - period.get("startYear", 0) != 9 or period.get("completeYears") != 10 or
            query.get("format") != "MHW1" or query.get("tileSizeCells") != 128 or query.get("bytesPerCell") != 15 or
            [item.get("label") for item in metadata.get("categories", [])] != expected_labels):
        raise ValueError("Ocean Heat History metadata does not match the validated NOAA MHW contract")

    try:
        from prepare_pages import is_curated_ocean_heat_asset
    except ImportError:
        import sys
        sys.path.insert(0, str(ROOT / "tools"))
        from prepare_pages import is_curated_ocean_heat_asset

    product_root = output / OCEAN_HEAT_ROOT
    all_files = [path for path in product_root.rglob("*") if path.is_file()]
    invalid = [path.relative_to(output) for path in all_files
               if not is_curated_ocean_heat_asset(OCEAN_HEAT_ROOT / path.relative_to(product_root))]
    if invalid:
        raise ValueError(f"Non-production Ocean Heat History asset(s) are present: {invalid[:5]}")
    map_tiles = list((product_root / "tiles").rglob("*.png"))
    query_chunks = list((product_root / "query").glob("*.bin.gz"))
    if (len(map_tiles) != assets.get("mapTileCount") or len(map_tiles) != 1365 or
            len(query_chunks) != assets.get("queryChunkCount") or len(query_chunks) != 72):
        raise ValueError("Ocean Heat History map tiles or 128-cell query chunks are incomplete")
    product_files = [metadata_path, *map_tiles, *query_chunks]
    total_bytes = sum(path.stat().st_size for path in product_files)
    map_bytes = sum(path.stat().st_size for path in map_tiles)
    query_bytes = sum(path.stat().st_size for path in query_chunks)
    if (total_bytes != assets.get("totalBytes") or map_bytes != assets.get("mapTileBytes") or
            query_bytes != assets.get("queryBytes") or metadata_path.stat().st_size != assets.get("metadataBytes")):
        raise ValueError("Ocean Heat History byte totals do not match its generated metadata")
    largest = max(product_files, key=lambda path: path.stat().st_size)
    return {
        "period": period,
        "productVersion": metadata.get("productVersion"),
        "mapTileCount": len(map_tiles),
        "mapTileBytes": map_bytes,
        "queryChunkCount": len(query_chunks),
        "queryBytes": query_bytes,
        "metadataBytes": metadata_path.stat().st_size,
        "totalBytes": total_bytes,
        "largestAsset": str(largest.relative_to(output)),
        "largestAssetBytes": largest.stat().st_size,
        "onlyCuratedAssets": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("_site"))
    args = parser.parse_args()
    print(json.dumps(verify(args.output), indent=2))


if __name__ == "__main__":
    main()
