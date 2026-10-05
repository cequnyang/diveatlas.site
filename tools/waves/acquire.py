"""Download the published global monthly wave climatology to an ignored folder."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import copernicusmarine


PRODUCT_ID = "GLOBAL_MULTIYEAR_WAV_001_032"
DATASET_ID = "cmems_mod_glo_wav_my_0.2deg-climatology_P1M-m"
PRODUCT_URL = "https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_WAV_001_032/services"
MANUAL_URL = "https://documentation.marine.copernicus.eu/PUM/CMEMS-GLO-PUM-001-032.pdf"
PERIOD_SOURCE = "Current Copernicus Marine dataset title and NetCDF climatology_bounds; see tools/waves/README.md for the manual discrepancy."
EXPECTED_VARIABLES = {
    "VHM0": {"standard_name": "sea_surface_wave_significant_height", "units": "m"},
    "VTM02": {
        "standard_name": "sea_surface_wave_mean_period_from_variance_spectral_density_second_frequency_moment",
        "units": "s",
    },
}


def inspect_catalogue() -> dict:
    catalogue = copernicusmarine.describe(dataset_id=DATASET_ID, disable_progress_bar=True)
    products = [product for product in catalogue.products if product.product_id == PRODUCT_ID]
    if len(products) != 1:
        raise ValueError(f"catalogue did not resolve exactly one product {PRODUCT_ID}")
    datasets = [dataset for dataset in products[0].datasets if dataset.dataset_id == DATASET_ID]
    if len(datasets) != 1:
        raise ValueError(f"product {PRODUCT_ID} did not resolve exactly one dataset {DATASET_ID}")
    dataset = datasets[0]
    if not dataset.versions or not dataset.versions[0].parts:
        raise ValueError(f"dataset {DATASET_ID} has no published version/part")
    version = dataset.versions[0]
    part = next((candidate for candidate in version.parts if candidate.name == "default"), version.parts[0])
    variables = {}
    time_coordinate = None
    latitude_coordinate = None
    longitude_coordinate = None
    for service in part.services:
        for variable in service.variables:
            if variable.short_name in EXPECTED_VARIABLES:
                variables[variable.short_name] = {
                    "standard_name": variable.standard_name,
                    "units": variable.units,
                }
    coordinates = part.get_coordinates()
    time_coordinate = coordinates.get("time", (None,))[0]
    latitude_coordinate = coordinates.get("latitude", (None,))[0]
    longitude_coordinate = coordinates.get("longitude", (None,))[0]
    if variables != EXPECTED_VARIABLES:
        raise ValueError(f"catalogue variables are {variables!r}, expected exactly {EXPECTED_VARIABLES!r}")
    if not time_coordinate or not latitude_coordinate or not longitude_coordinate:
        raise ValueError("catalogue did not expose time, latitude, and longitude coordinates")
    timestamps = [int(value) for value in time_coordinate.values or []]
    if len(timestamps) != 12:
        raise ValueError("catalogue climatology must expose exactly 12 month-of-year timestamps")
    return {
        "schema_version": 1,
        "product_id": PRODUCT_ID,
        "dataset_id": DATASET_ID,
        "dataset_name": dataset.dataset_name,
        "release": version.label,
        "part": part.name,
        "toolbox_version": copernicusmarine.__version__,
        "variables": variables,
        "coordinates": {
            "time_units": time_coordinate.coordinate_unit,
            "time_values_unix_ms": timestamps,
            "latitude": {
                "units": latitude_coordinate.coordinate_unit,
                "minimum": latitude_coordinate.minimum_value,
                "maximum": latitude_coordinate.maximum_value,
                "step": latitude_coordinate.step,
                "chunk_length": latitude_coordinate.chunking_length,
            },
            "longitude": {
                "units": longitude_coordinate.coordinate_unit,
                "minimum": longitude_coordinate.minimum_value,
                "maximum": longitude_coordinate.maximum_value,
                "step": longitude_coordinate.step,
                "chunk_length": longitude_coordinate.chunking_length,
            },
        },
        "product_url": PRODUCT_URL,
        "manual_url": MANUAL_URL,
        "climatology_period_source": PERIOD_SOURCE,
        "attribution": "Generated using E.U. Copernicus Marine Service Information; DOI: 10.48670/moi-00022.",
    }


def acquire(output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    catalogue = inspect_catalogue()
    (output_dir / "source_catalogue.json").write_text(
        json.dumps(catalogue, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    list_name = "source-files.txt"
    copernicusmarine.get(
        dataset_id=DATASET_ID,
        dataset_version=catalogue["release"],
        dataset_part=catalogue["part"],
        create_file_list=list_name,
        output_directory=output_dir,
        disable_progress_bar=False,
    )
    file_list = output_dir / list_name
    if not file_list.is_file():
        raise FileNotFoundError(f"Copernicus Toolbox did not create {file_list}")
    result = copernicusmarine.get(
        dataset_id=DATASET_ID,
        dataset_version=catalogue["release"],
        dataset_part=catalogue["part"],
        file_list=file_list,
        output_directory=output_dir / "downloads",
        skip_existing=True,
        disable_progress_bar=False,
    )
    downloaded = [Path(item.file_path) for item in result.files if getattr(item, "file_path", None)]
    if not downloaded:
        downloaded = list((output_dir / "downloads").rglob("*.nc"))
    if len(downloaded) != 1 or not downloaded[0].is_file() or downloaded[0].stat().st_size == 0:
        raise RuntimeError(f"Expected one non-empty global NetCDF climatology; found {downloaded!r}")
    return downloaded[0]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("data/.build/waves/source"))
    parser.add_argument("--describe-only", action="store_true", help="write the live catalogue, without downloading")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    catalogue = inspect_catalogue()
    (args.output_dir / "source_catalogue.json").write_text(
        json.dumps(catalogue, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    if args.describe_only:
        print(json.dumps(catalogue, indent=2))
        return
    source = acquire(args.output_dir)
    print(f"Downloaded {source} ({source.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
