"""Build static, low-contrast GEBCO tiles for the DiveAtlas map.

The multi-gigabyte GEBCO source stays under data/.build. Only viewport-addressable
WebP surface tiles and transparent contour tiles are written to data/.
Requires rasterio, numpy, Pillow, and contourpy.
"""

from __future__ import annotations

import argparse
import gzip
import math
import json
import re
import zipfile
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.transform import from_bounds
from rasterio.warp import transform_bounds, reproject, Resampling


ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WORK = DATA / ".build"
SOURCE_URL = (
    "https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2026/"
    "ice_surface_elevation/geotiff/gebco_2026_geotiff.zip?download=1"
)
SOURCE_ZIP = WORK / "gebco_2026_geotiff.zip"
WEB_MERCATOR_LIMIT = 20037508.342789244
TILE = 256
ATLAS_TILES = 8
SURFACE_MIN_ZOOM = 3
SURFACE_MAX_ZOOM = 7
CONTOUR_MIN_ZOOM = 5
CONTOUR_MAX_ZOOM = 8
TERRAIN_MIN_ZOOM = 6
TERRAIN_MAX_ZOOM = 8
TERRAIN_CLASS_BREAKS_DEGREES = (2.0, 5.0, 10.0, 15.0, 25.0)
TERRAIN_SLOPE_BASE_ALPHA = (0, 5, 20, 64, 120, 166)
TERRAIN_LOW_ZOOM_MIN_SLOPE_DEGREES = 8.0
TERRAIN_CLASS_COLORS = (
    (112, 137, 132),
    (101, 139, 133),
    (82, 130, 123),
    (65, 116, 108),
    (51, 99, 92),
    (40, 82, 76)
)
OVERVIEW_FACTOR = 8
SAMPLE_BLOCK_PIXELS = 450
SAMPLE_REDUCTION = 2
SAMPLE_GRID_SIZE = SAMPLE_BLOCK_PIXELS // SAMPLE_REDUCTION


def fetch_source() -> Path:
    if SOURCE_ZIP.exists() and SOURCE_ZIP.stat().st_size > 100_000_000:
        return SOURCE_ZIP
    import requests

    WORK.mkdir(parents=True, exist_ok=True)
    temporary = SOURCE_ZIP.with_suffix(".partial")
    with requests.get(SOURCE_URL, stream=True, timeout=(30, 300)) as response:
        response.raise_for_status()
        with temporary.open("wb") as output:
            for chunk in response.iter_content(4 * 1024 * 1024):
                if chunk:
                    output.write(chunk)
    temporary.replace(SOURCE_ZIP)
    return SOURCE_ZIP


def source_rasters(source: Path):
    if source.is_dir():
        return [rasterio.open(path) for path in sorted(source.glob("*.tif"))]
    if source.suffix.lower() == ".zip":
        with zipfile.ZipFile(source) as archive:
            members = [name for name in archive.namelist()
                       if name.lower().endswith((".tif", ".tiff"))]
        if not members:
            raise RuntimeError("No GeoTIFF source tiles were found in the GEBCO archive")
        return [
            rasterio.open(f"/vsizip/{source.as_posix()}/{member}")
            for member in members
        ]
    return [rasterio.open(source)]


def extract_source_archive(source: Path) -> Path:
    """Unpack source GeoTIFFs for efficient repeated random window reads."""
    output = WORK / "gebco_2026_native"
    with zipfile.ZipFile(source) as archive:
        members = [name for name in archive.namelist()
                   if name.lower().endswith((".tif", ".tiff"))]
        expected = [output / Path(name).name for name in members]
        if len(expected) == 8 and all(
            path.exists() and path.stat().st_size == archive.getinfo(member).file_size
            for path, member in zip(expected, members)
        ):
            return output
        output.mkdir(parents=True, exist_ok=True)
        for member, target in zip(members, expected):
            if target.exists() and target.stat().st_size == archive.getinfo(member).file_size:
                continue
            temporary = target.with_suffix(target.suffix + ".partial")
            with archive.open(member) as compressed, temporary.open("wb") as extracted:
                while chunk := compressed.read(8 * 1024 * 1024):
                    extracted.write(chunk)
            temporary.replace(target)
            print(f"extracted native source {target.name}", flush=True)
    return output


def prepare_global_overview(source: Path) -> Path:
    """Create a 2-minute global overview once to keep tile generation bounded."""
    output = WORK / "gebco_2026_2min"
    expected = 8
    if output.exists() and len(list(output.glob("*.tif"))) == expected:
        return output
    output.mkdir(parents=True, exist_ok=True)
    inputs = source_rasters(source)
    try:
        for index, dataset in enumerate(inputs):
            width = max(1, dataset.width // OVERVIEW_FACTOR)
            height = max(1, dataset.height // OVERVIEW_FACTOR)
            overview = dataset.read(
                1,
                out_shape=(height, width),
                resampling=Resampling.average
            )
            transform = dataset.transform * rasterio.Affine.scale(
                dataset.width / width, dataset.height / height
            )
            destination = output / f"gebco_2026_{index:02d}.tif"
            with rasterio.open(
                destination,
                "w",
                driver="GTiff",
                width=width,
                height=height,
                count=1,
                dtype=overview.dtype,
                crs=dataset.crs,
                transform=transform,
                nodata=dataset.nodata,
                compress="DEFLATE",
                predictor=2,
                tiled=True
            ) as target:
                target.write(overview, 1)
            print(f"prepared overview {index + 1}/{len(inputs)}", flush=True)
    finally:
        for dataset in inputs:
            dataset.close()
    return output


def write_depth_samples(datasets, output: Path, *, overwrite: bool = False):
    """Store click-only depth samples in small static 15-degree chunks."""
    for dataset in datasets:
        x0 = max(0, int(round((dataset.bounds.left + 180) / 15)))
        y0 = max(0, int(round((90 - dataset.bounds.top) / 15)))
        for row in range(6):
            for col in range(6):
                y_index = y0 + row
                x_index = x0 + col
                path = output / str(y_index) / f"{x_index}.bin.gz"
                if path.exists() and not overwrite:
                    continue
                window = rasterio.windows.Window(
                    col * SAMPLE_BLOCK_PIXELS, row * SAMPLE_BLOCK_PIXELS,
                    SAMPLE_BLOCK_PIXELS, SAMPLE_BLOCK_PIXELS
                )
                values = dataset.read(1, window=window, boundless=True).astype(np.float32)
                if values.shape != (SAMPLE_BLOCK_PIXELS, SAMPLE_BLOCK_PIXELS):
                    continue
                # Click inspection is spatially coarser than the rendered
                # overview so each fetched regional chunk stays compact.
                blocks = values.reshape(
                    SAMPLE_GRID_SIZE, SAMPLE_REDUCTION,
                    SAMPLE_GRID_SIZE, SAMPLE_REDUCTION
                )
                valid = np.isfinite(blocks)
                if dataset.nodata is not None:
                    valid &= blocks != dataset.nodata
                totals = np.where(valid, blocks, 0).sum(axis=(1, 3))
                counts = valid.sum(axis=(1, 3))
                reduced = np.full(
                    (SAMPLE_GRID_SIZE, SAMPLE_GRID_SIZE), -32768, dtype=np.float32
                )
                np.divide(totals, counts, out=reduced, where=counts > 0)
                path.parent.mkdir(parents=True, exist_ok=True)
                with gzip.open(path, "wb", compresslevel=6) as compressed:
                    compressed.write(
                        np.clip(np.rint(reduced), -32768, 32767)
                        .astype("<i2", copy=False).tobytes()
                    )


def write_manifest(surface_max_zoom: int, contour_max_zoom: int):
    manifest = {
        "version": "gebco2026-2min-surface-native15arcsec-contours-v2",
        "atlasTiles": ATLAS_TILES,
        "surfaceMinZoom": SURFACE_MIN_ZOOM,
        "surfaceMaxZoom": surface_max_zoom,
        "contourMinZoom": CONTOUR_MIN_ZOOM,
        "contourMaxZoom": contour_max_zoom,
        "terrainMinZoom": TERRAIN_MIN_ZOOM,
        "terrainMaxZoom": TERRAIN_MAX_ZOOM,
        "sampleChunkDegrees": 15,
        "sampleGridSize": SAMPLE_GRID_SIZE,
        "sampleGridSpacingMetres": 7408
    }
    target = DATA / "bathymetry_manifest.js"
    target.write_text(
        "window.DIVEATLAS_BATHYMETRY_MANIFEST=" +
        json.dumps(manifest, separators=(",", ":")) + ";\n",
        encoding="utf-8"
    )
    write_terrain_manifest()


def write_terrain_manifest():
    atlas_index = []
    tile_index = []
    terrain_dir = DATA / "terrain_tiles"
    if terrain_dir.exists():
        for path in terrain_dir.rglob("*.png"):
            try:
                z, atlas_x = int(path.parent.parent.name), int(path.parent.name)
                atlas_y = int(path.stem)
            except ValueError:
                continue
            pixels = np.asarray(Image.open(path))
            atlas_has_terrain = False
            for local_y in range(ATLAS_TILES):
                tile_y = atlas_y * ATLAS_TILES + local_y
                y0 = local_y * TILE
                for local_x in range(ATLAS_TILES):
                    x0 = local_x * TILE
                    if np.any(pixels[y0:y0 + TILE, x0:x0 + TILE] >= 2):
                        atlas_has_terrain = True
                        tile_index.append([
                            z,
                            atlas_x * ATLAS_TILES + local_x,
                            tile_y
                        ])
            if atlas_has_terrain:
                atlas_index.append([z, atlas_x, atlas_y])
    terrain_manifest = {
        "version": "gebco2026-horn-slope-overlay-native15arcsec-z6-z8-v3",
        "minZoom": TERRAIN_MIN_ZOOM,
        "maxZoom": TERRAIN_MAX_ZOOM,
        "atlasTiles": ATLAS_TILES,
        "atlases": sorted(atlas_index),
        "tiles": sorted(tile_index),
        "fallbackZoom": 7,
        "algorithm": "Horn 3x3",
        "classBreaksDegrees": TERRAIN_CLASS_BREAKS_DEGREES,
        "slopeAlpha": TERRAIN_SLOPE_BASE_ALPHA,
        "depthAttenuation": "none",
        "lowZoomMinSlopeDegrees": TERRAIN_LOW_ZOOM_MIN_SLOPE_DEGREES,
        "nativeZoomCoverage": "reef and dive-site neighborhoods with one-tile buffer",
        "localReliefMetres": None
    }
    (DATA / "terrain_manifest.js").write_text(
        "window.DIVEATLAS_TERRAIN_MANIFEST=" +
        json.dumps(terrain_manifest, separators=(",", ":")) + ";\n",
        encoding="utf-8"
    )


def source_tiles_for_bounds(datasets, bounds):
    west, south, east, north = bounds
    return [
        dataset for dataset in datasets
        if dataset.bounds.left < east and dataset.bounds.right > west
        and dataset.bounds.bottom < north and dataset.bounds.top > south
    ]


def read_mercator_tile(datasets, z: int, x: int, y: int, *, pad: int = 0):
    n = 1 << z
    span = 2 * WEB_MERCATOR_LIMIT / n
    left = -WEB_MERCATOR_LIMIT + x * span
    right = left + span
    top = WEB_MERCATOR_LIMIT - y * span
    bottom = top - span
    width = TILE + pad * 2
    resolution = span / TILE
    transform = from_bounds(
        left - pad * resolution, bottom - pad * resolution,
        right + pad * resolution, top + pad * resolution,
        width, width
    )
    geographic = transform_bounds(
        "EPSG:3857", "EPSG:4326", left, bottom, right, top,
        densify_pts=8
    )
    output = np.full((width, width), np.nan, dtype=np.float32)
    for dataset in source_tiles_for_bounds(datasets, geographic):
        reproject(
            source=rasterio.band(dataset, 1),
            destination=output,
            src_transform=dataset.transform,
            src_crs=dataset.crs,
            src_nodata=dataset.nodata,
            dst_transform=transform,
            dst_crs="EPSG:3857",
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
            init_dest_nodata=False
        )
    return output


def surface_image(elevation: np.ndarray) -> Image.Image:
    ocean = np.isfinite(elevation) & (elevation < 0)
    depth = np.maximum(0, -np.nan_to_num(elevation, nan=0.0))
    # A restrained ramp keeps this context layer legible without competing
    # with the brighter semantic colors used for coral and reef features.
    stops = np.array([0, 100, 500, 1500, 4000, 9000, 12000], dtype=np.float32)
    colors = np.array([
        [169, 190, 194], [146, 170, 177], [118, 145, 155],
        [91, 117, 130], [68, 91, 105], [52, 72, 86], [43, 61, 75]
    ], dtype=np.uint8)
    rgb = np.stack([
        np.interp(depth, stops, colors[:, channel]).astype(np.uint8)
        for channel in range(3)
    ], axis=-1)
    rgb[~ocean] = 0
    alpha = np.where(ocean, 255, 0).astype(np.uint8)
    return Image.fromarray(np.dstack((rgb, alpha)), "RGBA")


def contour_image(elevation: np.ndarray, z: int) -> Image.Image | None:
    try:
        import contourpy
    except ImportError as exc:
        raise RuntimeError("contourpy is required to build contour tiles") from exc
    values = -elevation
    if not np.isfinite(values).any():
        return None
    values = np.nan_to_num(values, nan=-1.0)
    # Keep low-zoom output sparse; Z8 is reprojected from GEBCO's native
    # 15-arc-second grid, whose roughly 463 m equatorial spacing does not
    # justify the former 200 m contour interval or any Z9+ assets.
    if z <= 5:
        levels = [1000, 2000, 4000, 6000]
    else:
        levels = [500, 1000, 2000, 4000, 6000]
    generator = contourpy.contour_generator(
        x=np.arange(values.shape[1], dtype=np.float32),
        y=np.arange(values.shape[0], dtype=np.float32),
        z=values,
        line_type="Separate"
    )
    image = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for level in levels:
        for line in generator.lines(level):
            if len(line) < 2:
                continue
            points = [(float(px - 1), float(py - 1)) for px, py in line]
            draw.line(points, fill=(104, 128, 139, 120), width=1)
    return image if image.getbbox() else None


def horn_slope_degrees(elevation: np.ndarray, pixel_size_x_m, pixel_size_y_m):
    """Horn 3x3 slope on a north-up grid with physical ground spacing per row."""
    z = elevation
    a, b, c = z[:-2, :-2], z[:-2, 1:-1], z[:-2, 2:]
    d, f = z[1:-1, :-2], z[1:-1, 2:]
    g, h, i = z[2:, :-2], z[2:, 1:-1], z[2:, 2:]
    dz_dx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * pixel_size_x_m)
    dz_dy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * pixel_size_y_m)
    return np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))


def terrain_class_image(elevation: np.ndarray, z: int, x: int, y: int):
    """Return a transparent, compact palette image for one source tile."""
    valid = np.isfinite(elevation)
    ocean_stencil = (
        valid[:-2, :-2] & (elevation[:-2, :-2] < 0) &
        valid[:-2, 1:-1] & (elevation[:-2, 1:-1] < 0) &
        valid[:-2, 2:] & (elevation[:-2, 2:] < 0) &
        valid[1:-1, :-2] & (elevation[1:-1, :-2] < 0) &
        valid[1:-1, 1:-1] & (elevation[1:-1, 1:-1] < 0) &
        valid[1:-1, 2:] & (elevation[1:-1, 2:] < 0) &
        valid[2:, :-2] & (elevation[2:, :-2] < 0) &
        valid[2:, 1:-1] & (elevation[2:, 1:-1] < 0) &
        valid[2:, 2:] & (elevation[2:, 2:] < 0)
    )
    n = 1 << z
    rows = (y * TILE + np.arange(-1, TILE + 1) + 0.5) / (TILE * n)
    latitude = np.arctan(np.sinh(np.pi * (1.0 - 2.0 * rows)))
    ground_spacing = (2.0 * WEB_MERCATOR_LIMIT / (n * TILE)) * np.cos(latitude)
    slope = horn_slope_degrees(
        elevation,
        ground_spacing[1:-1, None],
        ground_spacing[1:-1, None]
    )
    valid_slope = ocean_stencil & np.isfinite(slope)
    # Palette indices encode only slope class. Absolute depth must not hide a
    # steep wall, and lower zooms filter gentle classes instead of fading all pixels.
    classes = np.zeros((TILE, TILE), dtype=np.uint8)
    slope_class = np.digitize(
        slope[valid_slope], TERRAIN_CLASS_BREAKS_DEGREES, right=False
    ) - 1
    visible = slope_class >= 0
    if z <= 7:
        visible &= slope[valid_slope] >= TERRAIN_LOW_ZOOM_MIN_SLOPE_DEGREES
    if np.any(visible):
        valid_positions = np.flatnonzero(valid_slope)
        classes.ravel()[valid_positions[visible]] = 2 + slope_class[visible]
    if not np.any(classes >= 2):
        return None

    image = Image.fromarray(classes, mode="P")
    image.putpalette(terrain_palette())
    image.info["transparency"] = terrain_transparency(z)
    return image


def terrain_palette():
    palette = [0] * 768
    for slope_index, color in enumerate(TERRAIN_CLASS_COLORS):
        index = 2 + slope_index
        palette[index * 3:index * 3 + 3] = color
    return palette


def terrain_transparency(z: int):
    transparency = bytearray(256)
    for slope_index, base_alpha in enumerate(TERRAIN_SLOPE_BASE_ALPHA):
        transparency[2 + slope_index] = base_alpha
    return bytes(transparency)


def validate_horn_slope():
    """Guard the gradient math with flat and constant-plane fixtures."""
    spacing = 10.0
    flat = np.zeros((5, 5), dtype=np.float64)
    if not np.allclose(horn_slope_degrees(flat, spacing, spacing), 0.0, atol=1e-8):
        raise RuntimeError("Flat synthetic terrain did not produce zero slope")
    gradient = np.tile(np.arange(5, dtype=np.float64) * spacing * math.tan(math.radians(10)), (5, 1))
    if not np.allclose(horn_slope_degrees(gradient, spacing, spacing), 10.0, atol=1e-8):
        raise RuntimeError("Constant synthetic gradient did not produce 10 degrees")
    step = np.zeros((5, 5), dtype=np.float64)
    step[:, 3:] = 100.0
    if not np.max(horn_slope_degrees(step, spacing, spacing)) > 60.0:
        raise RuntimeError("Sharp synthetic terrain did not produce a steep slope")

    coastal = np.full((TILE + 2, TILE + 2), -100.0, dtype=np.float32)
    coastal[:, TILE // 2 + 1:] = 100.0
    if terrain_class_image(coastal, 6, 32, 32) is not None:
        raise RuntimeError("A land boundary produced a false ocean slope class")
    nodata = np.full((TILE + 2, TILE + 2), -100.0, dtype=np.float32)
    nodata[TILE // 2, TILE // 2] = np.nan
    if terrain_class_image(nodata, 6, 32, 32) is not None:
        raise RuntimeError("A NoData boundary produced a false ocean slope class")
    alpha = terrain_transparency(8)
    if tuple(alpha[2:2 + len(TERRAIN_SLOPE_BASE_ALPHA)]) != TERRAIN_SLOPE_BASE_ALPHA:
        raise RuntimeError("Terrain transparency does not preserve the six slope classes")
    low_zoom = terrain_class_image(np.full((TILE + 2, TILE + 2), -100.0), 6, 32, 32)
    if low_zoom is not None:
        raise RuntimeError("Low zoom did not filter flat seafloor")
    print("Horn slope fixtures: flat=0°, constant=10°, sharp>60°; land and NoData edges masked", flush=True)


def terrain_tile_range(bounds, z: int):
    west, south, east, north = bounds
    n = 1 << z
    lat_limit = 85.0511287798066
    south = max(-lat_limit, min(lat_limit, south))
    north = max(-lat_limit, min(lat_limit, north))
    if east < west:
        east += 360
    x0 = int(math.floor((west + 180) / 360 * n))
    x1 = int(math.floor((east + 180) / 360 * n))
    def tile_y(latitude):
        radians = math.radians(latitude)
        return int(math.floor((1 - math.asinh(math.tan(radians)) / math.pi) / 2 * n))
    y0 = max(0, tile_y(north))
    y1 = min(n - 1, tile_y(south))
    return range(x0, x1 + 1), range(y0, y1 + 1)


def terrain_detail_tile_coordinates(z: int = 8, radius: int = 1):
    """Use native-detail tiles only around mapped reefs and existing dive sites."""
    reef_manifest = DATA / "reef_raster_manifest.js"
    dive_sites = DATA / "dive-sites.js"
    if not reef_manifest.exists() or not dive_sites.exists():
        raise RuntimeError(
            "Z8 terrain coverage needs data/reef_raster_manifest.js and data/dive-sites.js"
        )
    manifest_text = reef_manifest.read_text(encoding="utf-8")
    manifest = json.loads(manifest_text[manifest_text.index("{"):manifest_text.rindex("}") + 1])
    if manifest.get("v") != 1:
        raise RuntimeError("Unsupported reef raster manifest version for Z8 terrain selection")

    n = 1 << z
    coordinates = set()

    def add_neighborhood(tile_x: int, tile_y: int):
        for dy in range(-radius, radius + 1):
            y = tile_y + dy
            if not 0 <= y < n:
                continue
            for dx in range(-radius, radius + 1):
                coordinates.add(((tile_x + dx) % n, y))

    parent_zoom = z - 1
    for tile_z, tile_x, tile_y in manifest.get("tiles", []):
        if tile_z != parent_zoom:
            continue
        for child_y in (tile_y * 2, tile_y * 2 + 1):
            for child_x in (tile_x * 2, tile_x * 2 + 1):
                add_neighborhood(child_x, child_y)

    dive_text = dive_sites.read_text(encoding="utf-8")
    match = re.search(r"window\.DIVE_SITES_DATA\s*=\s*(\[.*\]);\s*$", dive_text, re.DOTALL)
    if not match:
        raise RuntimeError("Could not parse the existing DiveAtlas dive-site dataset")
    records = json.loads(match.group(1))
    for record in records:
        try:
            latitude, longitude = float(record[1]), float(record[2])
        except (IndexError, TypeError, ValueError):
            continue
        if not math.isfinite(latitude) or not math.isfinite(longitude):
            continue
        latitude = max(-85.0511287798066, min(85.0511287798066, latitude))
        tile_x = int(math.floor((longitude + 180) / 360 * n)) % n
        radians = math.radians(latitude)
        tile_y = int(math.floor((1 - math.asinh(math.tan(radians)) / math.pi) / 2 * n))
        add_neighborhood(tile_x, tile_y)
    return coordinates


def write_terrain_tiles(datasets, output: Path, min_zoom: int, max_zoom: int,
                        bounds=None, detail_coordinates=None):
    """Build palette PNG atlases from Horn classes, keeping source rasters offline."""
    tile_count = 0
    atlas_count = 0
    for z in range(min_zoom, max_zoom + 1):
        written_paths = set()
        n = 1 << z
        atlas_n = math.ceil(n / ATLAS_TILES)
        selected_coordinates = None
        if bounds:
            x_values, y_values = terrain_tile_range(bounds, z)
            selected_coordinates = {
                (x, y) for x in x_values for y in y_values
            }
            atlas_xs = sorted({x // ATLAS_TILES for x in x_values})
            atlas_ys = sorted({y // ATLAS_TILES for y in y_values})
            atlas_coordinates = ((ax, ay) for ay in atlas_ys for ax in atlas_xs)
        elif detail_coordinates is not None:
            selected_coordinates = detail_coordinates
            atlas_coordinates = sorted({
                (x // ATLAS_TILES, y // ATLAS_TILES)
                for x, y in selected_coordinates
            }, key=lambda item: (item[1], item[0]))
        else:
            atlas_coordinates = ((ax, ay) for ay in range(atlas_n) for ax in range(atlas_n))

        for atlas_x, atlas_y in atlas_coordinates:
            atlas = Image.new("P", (TILE * ATLAS_TILES, TILE * ATLAS_TILES), 0)
            first_x = atlas_x * ATLAS_TILES
            first_y = atlas_y * ATLAS_TILES
            for local_y in range(ATLAS_TILES):
                y = first_y + local_y
                if y >= n:
                    break
                for local_x in range(ATLAS_TILES):
                    x = first_x + local_x
                    if x >= n:
                        break
                    if selected_coordinates is not None and (x, y) not in selected_coordinates:
                        continue
                    elevation = read_mercator_tile(datasets, z, x, y, pad=1)
                    image = terrain_class_image(elevation, z, x, y)
                    if image is not None:
                        atlas.paste(image, (local_x * TILE, local_y * TILE))
                        tile_count += 1
            if atlas.getbbox():
                atlas.putpalette(terrain_palette())
                atlas.info["transparency"] = terrain_transparency(z)
                path = output / str(z) / str(atlas_x) / f"{atlas_y}.png"
                path.parent.mkdir(parents=True, exist_ok=True)
                atlas.save(path, optimize=True)
                written_paths.add(path.resolve())
                atlas_count += 1
        if bounds is None:
            zoom_dir = output / str(z)
            if zoom_dir.exists():
                for stale_path in zoom_dir.rglob("*.png"):
                    if stale_path.resolve() not in written_paths:
                        stale_path.unlink()
                for directory in sorted(
                    (path for path in zoom_dir.rglob("*") if path.is_dir()),
                    key=lambda path: len(path.parts), reverse=True
                ):
                    try:
                        directory.rmdir()
                    except OSError:
                        pass
        print(f"terrain zoom {z}: {tile_count:,} non-flat tiles in {atlas_count:,} atlases", flush=True)


def write_tiles(datasets, output: Path, min_zoom: int, max_zoom: int,
                contours: bool = False):
    tile_count = 0
    atlas_count = 0
    extension = "png" if contours else "webp"
    for z in range(min_zoom, max_zoom + 1):
        n = 1 << z
        atlas_n = math.ceil(n / ATLAS_TILES)
        for atlas_y in range(atlas_n):
            for atlas_x in range(atlas_n):
                atlas = Image.new(
                    "RGBA",
                    (TILE * ATLAS_TILES, TILE * ATLAS_TILES),
                    (0, 0, 0, 0)
                )
                first_x = atlas_x * ATLAS_TILES
                first_y = atlas_y * ATLAS_TILES
                for local_y in range(ATLAS_TILES):
                    y = first_y + local_y
                    if y >= n:
                        break
                    for local_x in range(ATLAS_TILES):
                        x = first_x + local_x
                        if x >= n:
                            break
                        elevation = read_mercator_tile(
                            datasets, z, x, y, pad=1 if contours else 0
                        )
                        image = contour_image(elevation, z) if contours else surface_image(elevation)
                        if image is None:
                            continue
                        if image.size != (TILE, TILE):
                            image = image.crop((1, 1, TILE + 1, TILE + 1))
                        atlas.paste(image, (local_x * TILE, local_y * TILE))
                        tile_count += 1

                if atlas.getbbox():
                    path = output / str(z) / str(atlas_x) / f"{atlas_y}.{extension}"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    if contours:
                        atlas.save(path, optimize=True)
                    else:
                        atlas.save(path, "WEBP", quality=82, method=4)
                    atlas_count += 1
        print(
            f"zoom {z}: packed {tile_count:,} tiles into {atlas_count:,} atlases",
            flush=True
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="GEBCO global GeoTIFF or ZIP; downloads GEBCO_2026 if omitted")
    parser.add_argument("--contours-only", action="store_true")
    parser.add_argument("--terrain-only", action="store_true")
    parser.add_argument("--terrain-bounds", type=str, help="Limit terrain generation to west,south,east,north for regional validation")
    parser.add_argument("--skip-terrain", action="store_true")
    parser.add_argument("--test-slope", action="store_true", help="Run synthetic Horn slope checks and exit")
    parser.add_argument("--manifest-only", action="store_true")
    parser.add_argument("--samples-only", action="store_true")
    parser.add_argument("--surface-max-zoom", type=int, default=SURFACE_MAX_ZOOM)
    parser.add_argument("--skip-contours", action="store_true")
    parser.add_argument("--skip-samples", action="store_true")
    parser.add_argument("--max-contour-zoom", type=int, default=CONTOUR_MAX_ZOOM)
    args = parser.parse_args()
    if args.test_slope:
        validate_horn_slope()
        return
    terrain_bounds = None
    if args.terrain_bounds:
        try:
            terrain_bounds = tuple(float(value) for value in args.terrain_bounds.split(","))
        except ValueError as exc:
            raise SystemExit("--terrain-bounds must be west,south,east,north") from exc
        if len(terrain_bounds) != 4 or terrain_bounds[1] >= terrain_bounds[3]:
            raise SystemExit("--terrain-bounds must be west,south,east,north with south < north")
    surface_max_zoom = min(args.surface_max_zoom, SURFACE_MAX_ZOOM)
    contour_max_zoom = min(args.max_contour_zoom, CONTOUR_MAX_ZOOM)
    write_manifest(surface_max_zoom, contour_max_zoom)
    if args.manifest_only:
        return
    source = args.source or fetch_source()
    validate_horn_slope()
    with rasterio.Env(GDAL_CACHEMAX=128):
        overview = prepare_global_overview(source) if source.suffix.lower() == ".zip" else source
        datasets = source_rasters(overview)
        try:
            if args.terrain_only:
                if TERRAIN_MIN_ZOOM <= 7:
                    write_terrain_tiles(
                        datasets, DATA / "terrain_tiles",
                        TERRAIN_MIN_ZOOM, min(7, TERRAIN_MAX_ZOOM),
                        bounds=terrain_bounds
                    )
                if TERRAIN_MAX_ZOOM >= 8:
                    native_path = (
                        extract_source_archive(source)
                        if source.suffix.lower() == ".zip"
                        else source
                    )
                    native_datasets = source_rasters(native_path)
                    try:
                        detail_coordinates = (
                            None if terrain_bounds else terrain_detail_tile_coordinates(8)
                        )
                        write_terrain_tiles(
                            native_datasets, DATA / "terrain_tiles", 8, 8,
                            bounds=terrain_bounds,
                            detail_coordinates=detail_coordinates
                        )
                    finally:
                        if native_datasets is not datasets:
                            for dataset in native_datasets:
                                dataset.close()
                write_terrain_manifest()
                return
            if not args.skip_samples or args.samples_only:
                write_depth_samples(
                    datasets, DATA / "depth_samples", overwrite=args.samples_only
                )
            if args.samples_only:
                return
            if not args.contours_only:
                write_tiles(
                    datasets, DATA / "bathymetry_tiles",
                    SURFACE_MIN_ZOOM, surface_max_zoom
                )
            if not args.skip_terrain and not args.contours_only:
                write_terrain_tiles(
                    datasets, DATA / "terrain_tiles",
                    TERRAIN_MIN_ZOOM, min(7, TERRAIN_MAX_ZOOM)
                )
                if TERRAIN_MAX_ZOOM >= 8:
                    native_datasets = (
                        source_rasters(extract_source_archive(source))
                        if source.suffix.lower() == ".zip"
                        else datasets
                    )
                    try:
                        detail_coordinates = terrain_detail_tile_coordinates(8)
                        write_terrain_tiles(
                            native_datasets, DATA / "terrain_tiles", 8, 8,
                            detail_coordinates=detail_coordinates
                        )
                    finally:
                        if native_datasets is not datasets:
                            for dataset in native_datasets:
                                dataset.close()
                write_terrain_manifest()
            if not args.skip_contours:
                contour_output = DATA / "depth_contour_tiles"
                overview_max_zoom = min(contour_max_zoom, 7)
                if CONTOUR_MIN_ZOOM <= overview_max_zoom:
                    write_tiles(
                        datasets, contour_output,
                        CONTOUR_MIN_ZOOM, overview_max_zoom,
                        contours=True
                    )

                if contour_max_zoom >= 8:
                    # Z8 approaches GEBCO's native grid spacing. Build it
                    # directly from the source archive rather than enlarging
                    # the averaged overview used by the lower LODs.
                    native_datasets = (
                        source_rasters(extract_source_archive(source))
                        if source.suffix.lower() == ".zip"
                        else datasets
                    )
                    try:
                        write_tiles(
                            native_datasets, contour_output, 8, 8,
                            contours=True
                        )
                    finally:
                        if native_datasets is not datasets:
                            for dataset in native_datasets:
                                dataset.close()
        finally:
            for dataset in datasets:
                dataset.close()


if __name__ == "__main__":
    main()
