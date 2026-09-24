from pathlib import Path
import base64, gzip, json, math, shutil, sqlite3, time
import requests
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WORK = DATA / ".build"
REEF_PARTS = WORK / "reef_parts"
DATA.mkdir(exist_ok=True)
WORK.mkdir(exist_ok=True)
REEF_PARTS.mkdir(exist_ok=True)

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "DiveAtlas-local-data-builder/1.0"})

REEF_URL = (
    "https://services5.arcgis.com/W1uyphp8h2tna3qJ/ArcGIS/rest/services/"
    "WCMC008_CoralReefs2021_v4_1/FeatureServer/1/query"
)
OBIS_GRID = "https://api.obis.org/v3/occurrence/grid/6"
TAXA = ["Scleractinia", "Octocorallia", "Antipatharia", "Millepora"]
CORAL_STEP = 0.015625
CORAL_GRID_PYRAMID_STEPS = {
    3: 3.0,
    4: 1.5,
    5: 0.75,
    6: 0.375,
    7: 0.1875,
    8: 0.140625,
    9: 0.09375,
    10: 0.0625,
    11: 0.03125,
}

def get_json(url, params, retries=8, timeout=90):
    last = None
    for attempt in range(retries):
        try:
            r = SESSION.get(url, params=params, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            last = exc
            wait = min(30, 1.5 * (1.7 ** attempt))
            print("retry", attempt + 1, type(exc).__name__, str(exc)[:120], flush=True)
            time.sleep(wait)
    raise last

def write_gzip_js(payload, out_path, global_name):
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    packed = gzip.compress(raw, compresslevel=9)
    b64 = base64.b64encode(packed).decode("ascii")
    out_path.write_text(
        f'window.{global_name}="{b64}";\n',
        encoding="utf-8"
    )
    print(out_path.name, "json_MB", round(len(raw)/1048576,2),
          "gzip_MB", round(len(packed)/1048576,2), flush=True)

def geometry_bbox(coords):
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    stack = [coords]
    while stack:
        item = stack.pop()
        if not isinstance(item, list):
            continue
        if (
            len(item) >= 2
            and isinstance(item[0], (int, float))
            and isinstance(item[1], (int, float))
        ):
            x, y = float(item[0]), float(item[1])
            min_x, max_x = min(min_x, x), max(max_x, x)
            min_y, max_y = min(min_y, y), max(max_y, y)
        else:
            stack.extend(item)
    if min_x == float("inf"):
        return None
    return [min_x, min_y, max_x, max_y]

# Reef LOD simplification should remain visually faithful to the API geometry.
# The source query already uses maxAllowableOffset=0.0005°, so overview keeps
# that effective fidelity. Low zoom uses a sub-pixel 0.002° tolerance at Z7.
# min_span is intentionally zero: tiny reefs must not disappear merely to save
# rendering work; performance is handled by polygon-part batching + viewport culling.
REEF_OVERVIEW_TOLERANCE = 0.0005
REEF_OVERVIEW_MIN_SPAN = 0.0
REEF_LOW_TOLERANCE = 0.002
REEF_LOW_MIN_SPAN = 0.0
REEF_OVERVIEW_BATCH_DEGREES = 1.0
REEF_LOW_BATCH_DEGREES = 3.0

def perpendicular_distance_sq(point, start, end):
    x, y = point
    x1, y1 = start
    x2, y2 = end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return (x - x1) ** 2 + (y - y1) ** 2
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    qx, qy = x1 + t * dx, y1 + t * dy
    return (x - qx) ** 2 + (y - qy) ** 2

def simplify_line_rdp(points, tolerance):
    if len(points) <= 2:
        return points
    start, end = points[0], points[-1]
    max_distance = -1.0
    split_index = -1
    for index, point in enumerate(points[1:-1], 1):
        distance = perpendicular_distance_sq(point, start, end)
        if distance > max_distance:
            max_distance = distance
            split_index = index
    if max_distance > tolerance * tolerance:
        left = simplify_line_rdp(points[:split_index + 1], tolerance)
        right = simplify_line_rdp(points[split_index:], tolerance)
        return left[:-1] + right
    return [start, end]

def simplify_reef_ring(ring, tolerance, min_span):
    points = [
        (float(point[0]), float(point[1]))
        for point in ring
        if isinstance(point, list) and len(point) >= 2
    ]
    if len(points) < 4:
        return None

    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    if max(max(xs) - min(xs), max(ys) - min(ys)) < min_span:
        return None

    if points[0] == points[-1]:
        points = points[:-1]
    if len(points) < 3:
        return None

    center_x = sum(point[0] for point in points) / len(points)
    center_y = sum(point[1] for point in points) / len(points)
    pivot = max(
        range(len(points)),
        key=lambda index:
            (points[index][0] - center_x) ** 2 +
            (points[index][1] - center_y) ** 2
    )
    sequence = points[pivot:] + points[:pivot] + [points[pivot]]
    simplified = simplify_line_rdp(sequence, tolerance)
    if len(simplified) < 4:
        # Never drop a real reef because simplification collapses a small ring.
        # Retain its original geometry instead; viewport batching handles cost.
        simplified = sequence
    return [[round(x, 5), round(y, 5)] for x, y in simplified]

def simplify_reef_polygon(polygon, tolerance, min_span):
    if not polygon:
        return None
    exterior = simplify_reef_ring(
        polygon[0],
        tolerance,
        min_span
    )
    if not exterior:
        return None

    result = [exterior]
    for hole in polygon[1:]:
        simplified_hole = simplify_reef_ring(
            hole,
            tolerance,
            min_span * 2
        )
        if simplified_hole:
            result.append(simplified_hole)
    return result

def build_reef_lod(features, source, tolerance, min_span, lod_name):
    overview_features = []
    for feature in features:
        geometry = feature.get("geometry") or {}
        geometry_type = geometry.get("type")
        coordinates = geometry.get("coordinates") or []
        overview_geometry = None

        if geometry_type == "Polygon":
            polygon = simplify_reef_polygon(
                coordinates, tolerance, min_span
            )
            if polygon:
                overview_geometry = {
                    "type": "Polygon",
                    "coordinates": polygon
                }
        elif geometry_type == "MultiPolygon":
            polygons = []
            for polygon in coordinates:
                simplified = simplify_reef_polygon(
                    polygon, tolerance, min_span
                )
                if simplified:
                    polygons.append(simplified)
            if polygons:
                overview_geometry = {
                    "type": "MultiPolygon",
                    "coordinates": polygons
                }

        if not overview_geometry:
            continue

        overview_features.append({
            "type": "Feature",
            "properties": feature.get("properties") or {},
            "geometry": overview_geometry,
            "bbox": geometry_bbox(overview_geometry["coordinates"])
        })

    return {
        "v": 2,
        "source": source,
        "lod": lod_name,
        "tolerance": tolerance,
        "minSpan": min_span,
        "features": overview_features
    }

def batch_reef_lod(payload, cell_size):
    """Batch individual polygon parts into small spatial cells.

    MultiPolygon features can span very large regions. Batching at whole-feature
    level causes a viewport to pull in unrelated polygon parts simply because
    their shared feature bbox intersects the screen. Split to polygon parts
    first, then group by small geographic cells. Geometry is preserved; only
    storage/render partitioning changes.
    """
    groups = {}
    features = payload.get("features") or []
    wide_index = 0

    def add_polygon(polygon):
        nonlocal wide_index
        bbox = geometry_bbox(polygon)
        if not bbox:
            return

        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        if width > cell_size * 2 or height > cell_size * 2:
            key = ("wide", wide_index)
            wide_index += 1
        else:
            center_x = (bbox[0] + bbox[2]) / 2
            center_y = (bbox[1] + bbox[3]) / 2
            key = (
                math.floor((center_x + 180) / cell_size),
                math.floor((center_y + 90) / cell_size),
            )

        group = groups.setdefault(key, {
            "polygons": [],
            "west": float("inf"),
            "south": float("inf"),
            "east": float("-inf"),
            "north": float("-inf"),
        })
        group["polygons"].append(polygon)
        group["west"] = min(group["west"], bbox[0])
        group["south"] = min(group["south"], bbox[1])
        group["east"] = max(group["east"], bbox[2])
        group["north"] = max(group["north"], bbox[3])

    for feature in features:
        geometry = feature.get("geometry") or {}
        geometry_type = geometry.get("type")
        coordinates = geometry.get("coordinates") or []

        if geometry_type == "Polygon":
            add_polygon(coordinates)
        elif geometry_type == "MultiPolygon":
            for polygon in coordinates:
                add_polygon(polygon)

    batched = []
    for group in groups.values():
        if not group["polygons"]:
            continue
        batched.append({
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": group["polygons"],
            },
            "bbox": [
                group["west"],
                group["south"],
                group["east"],
                group["north"],
            ],
        })

    result = dict(payload)
    result["features"] = batched
    result["batchCellSize"] = cell_size
    result["batchMode"] = "polygon-parts"
    return result

REEF_VECTOR_CHUNK_DEGREES = 1.0
REEF_RASTER_MIN_ZOOM = 3
REEF_RASTER_MAX_ZOOM = 7


def reef_polygon_parts(features):
    polygons = []
    for feature in features:
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        if geometry.get("type") == "Polygon":
            if coordinates:
                polygons.append(coordinates)
        elif geometry.get("type") == "MultiPolygon":
            polygons.extend(polygon for polygon in coordinates if polygon)
    return polygons


def build_reef_vector_chunks(features, source):
    """Write exact cached source geometry as lazy local JS chunks."""
    out_dir = DATA / "reef_vector_chunks"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    groups = {}
    wide_index = 0

    for polygon in reef_polygon_parts(features):
        bbox = geometry_bbox(polygon)
        if not bbox:
            continue

        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        if (
            width > REEF_VECTOR_CHUNK_DEGREES * 2 or
            height > REEF_VECTOR_CHUNK_DEGREES * 2
        ):
            key = ("wide", wide_index)
            wide_index += 1
        else:
            center_x = (bbox[0] + bbox[2]) / 2
            center_y = (bbox[1] + bbox[3]) / 2
            key = (
                math.floor(
                    (center_x + 180) / REEF_VECTOR_CHUNK_DEGREES
                ),
                math.floor(
                    (center_y + 90) / REEF_VECTOR_CHUNK_DEGREES
                ),
            )

        group = groups.setdefault(key, {
            "polygons": [],
            "bbox": [
                float("inf"), float("inf"),
                float("-inf"), float("-inf")
            ],
        })
        group["polygons"].append(polygon)
        group["bbox"][0] = min(group["bbox"][0], bbox[0])
        group["bbox"][1] = min(group["bbox"][1], bbox[1])
        group["bbox"][2] = max(group["bbox"][2], bbox[2])
        group["bbox"][3] = max(group["bbox"][3], bbox[3])

    manifest = []
    for index, group in enumerate(groups.values()):
        chunk_id = f"{index:05d}"
        feature = {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": group["polygons"],
            },
            "bbox": group["bbox"],
        }
        raw = json.dumps(
            feature,
            separators=(",", ":"),
            ensure_ascii=False
        ).encode("utf-8")
        encoded = base64.b64encode(
            gzip.compress(raw, compresslevel=6)
        ).decode("ascii")
        (out_dir / f"{chunk_id}.js").write_text(
            "window.DIVEATLAS_REEF_VECTOR_CHUNKS="
            "window.DIVEATLAS_REEF_VECTOR_CHUNKS||{};"
            f'window.DIVEATLAS_REEF_VECTOR_CHUNKS["{chunk_id}"]='
            f'"{encoded}";\n',
            encoding="utf-8"
        )
        manifest.append([chunk_id, group["bbox"]])

    manifest_payload = {
        "v": 1,
        "source": source,
        "cell": REEF_VECTOR_CHUNK_DEGREES,
        "chunks": manifest,
    }
    (DATA / "reef_vector_manifest.js").write_text(
        "window.DIVEATLAS_REEF_VECTOR_MANIFEST=" +
        json.dumps(
            manifest_payload,
            separators=(",", ":"),
            ensure_ascii=False
        ) +
        ";\n",
        encoding="utf-8"
    )
    print("reef vector chunks", len(manifest), flush=True)


def unwrap_reef_ring(ring):
    result = []
    previous = None
    offset = 0.0

    for point in ring:
        if not isinstance(point, list) or len(point) < 2:
            continue
        lon = float(point[0])
        lat = max(
            -85.05112878,
            min(85.05112878, float(point[1]))
        )

        if previous is not None:
            candidate = lon + offset
            while candidate - previous > 180:
                offset -= 360
                candidate = lon + offset
            while candidate - previous < -180:
                offset += 360
                candidate = lon + offset
            lon = candidate
        else:
            lon += offset

        result.append((lon, lat))
        previous = lon

    return result


def project_web_mercator_pixel(point, zoom):
    lon, lat = point
    world_size = 256 * (1 << zoom)
    x = (lon + 180.0) / 360.0 * world_size
    sin_lat = math.sin(math.radians(lat))
    y = (
        0.5 -
        math.log((1 + sin_lat) / (1 - sin_lat)) /
        (4 * math.pi)
    ) * world_size
    return x, y


def build_reef_raster_tiles(features):
    """Rasterize exact source polygons at Z3-Z7 for low-zoom fidelity/speed."""
    out_dir = DATA / "reef_tiles"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    polygons = reef_polygon_parts(features)

    for zoom in range(REEF_RASTER_MIN_ZOOM, REEF_RASTER_MAX_ZOOM + 1):
        started = time.time()
        tile_count = 1 << zoom
        masks = {}

        for polygon in polygons:
            rings = [
                unwrap_reef_ring(ring)
                for ring in polygon
                if ring
            ]
            rings = [ring for ring in rings if len(ring) >= 3]
            if not rings:
                continue

            projected = [
                [project_web_mercator_pixel(point, zoom) for point in ring]
                for ring in rings
            ]
            exterior = projected[0]
            xs = [point[0] for point in exterior]
            ys = [point[1] for point in exterior]
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)

            tile_x_start = math.floor(min_x / 256)
            tile_x_end = math.floor(max_x / 256)
            tile_y_start = max(0, math.floor(min_y / 256))
            tile_y_end = min(
                tile_count - 1,
                math.floor(max_y / 256)
            )
            if tile_y_end < tile_y_start:
                continue

            # A real reef that is sub-pixel at this zoom should remain visible
            # as a pixel rather than being deleted from the low-zoom map.
            tiny = (
                max_x - min_x < 0.8 and
                max_y - min_y < 0.8
            )

            for tile_x in range(tile_x_start, tile_x_end + 1):
                origin_x = tile_x * 256
                output_x = tile_x % tile_count

                for tile_y in range(tile_y_start, tile_y_end + 1):
                    key = (output_x, tile_y)
                    mask = masks.get(key)
                    if mask is None:
                        mask = Image.new("L", (256, 256), 0)
                        masks[key] = mask
                    draw = ImageDraw.Draw(mask)

                    if tiny:
                        center_x = (min_x + max_x) / 2 - origin_x
                        center_y = (
                            (min_y + max_y) / 2 -
                            tile_y * 256
                        )
                        draw.rectangle(
                            [
                                int(center_x), int(center_y),
                                int(center_x) + 1, int(center_y) + 1
                            ],
                            fill=255
                        )
                        continue

                    draw.polygon(
                        [
                            (x - origin_x, y - tile_y * 256)
                            for x, y in exterior
                        ],
                        fill=255
                    )
                    for hole in projected[1:]:
                        draw.polygon(
                            [
                                (x - origin_x, y - tile_y * 256)
                                for x, y in hole
                            ],
                            fill=0
                        )

        zoom_dir = out_dir / str(zoom)
        zoom_dir.mkdir(parents=True)
        written = 0

        for (tile_x, tile_y), mask in masks.items():
            if mask.getbbox() is None:
                continue

            dilated = mask.filter(ImageFilter.MaxFilter(3))
            edge = ImageChops.subtract(dilated, mask)

            image = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
            outline = Image.new(
                "RGBA", (256, 256), (0, 109, 115, 255)
            )
            outline.putalpha(edge)
            fill = Image.new(
                "RGBA", (256, 256), (23, 198, 179, 255)
            )
            fill.putalpha(mask)
            image.alpha_composite(outline)
            image.alpha_composite(fill)

            x_dir = zoom_dir / str(tile_x)
            x_dir.mkdir(parents=True, exist_ok=True)
            image.save(
                x_dir / f"{tile_y}.png",
                compress_level=6
            )
            written += 1

        print(
            "reef raster",
            "z", zoom,
            "tiles", written,
            "seconds", round(time.time() - started, 1),
            flush=True
        )


def build_reef_static_assets(features, source):
    build_reef_vector_chunks(features, source)
    build_reef_raster_tiles(features)


def build_reef():
    ids_path = WORK / "reef_ids.json"
    if ids_path.exists():
        ids = json.loads(ids_path.read_text())
    else:
        data = get_json(REEF_URL, {
            "where": "1=1",
            "returnIdsOnly": "true",
            "f": "json"
        })
        ids = data.get("objectIds") or []
        ids_path.write_text(json.dumps(ids))
    print("reef IDs", len(ids), flush=True)

    chunk_size = 100
    for pos in range(0, len(ids), chunk_size):
        part = REEF_PARTS / f"{pos//chunk_size:05d}.json"
        if part.exists():
            continue
        chunk = ids[pos:pos+chunk_size]
        data = get_json(REEF_URL, {
            "objectIds": ",".join(map(str, chunk)),
            "outFields": "FID,NAME",
            "returnGeometry": "true",
            "outSR": "4326",
            "geometryPrecision": "5",
            "maxAllowableOffset": "0.0005",
            "f": "geojson"
        })
        features = data.get("features") or []
        part.write_text(json.dumps(features, separators=(",", ":"), ensure_ascii=False),
                        encoding="utf-8")
        print("reef", min(pos+chunk_size, len(ids)), "/", len(ids), flush=True)
        time.sleep(0.05)

    features = []
    for part in sorted(REEF_PARTS.glob("*.json")):
        features.extend(json.loads(part.read_text(encoding="utf-8")))

    for feature in features:
        geometry = feature.get("geometry") or {}
        bbox = geometry_bbox(geometry.get("coordinates"))
        if bbox:
            feature["bbox"] = bbox

    source = "UNEP-WCMC WCMC-008 v4.1"
    # Runtime rendering uses exact cached source geometry:
    # - Z3-Z7: build-time local raster tiles
    # - Z8+: viewport-lazy exact vector chunks
    # The legacy simplified low/overview snapshots are intentionally no longer
    # generated because fidelity should not be traded for interaction speed.
    build_reef_static_assets(features, source)
    print(
        "reef features", len(features),
        "polygon parts", len(reef_polygon_parts(features)),
        flush=True
    )

def coral_db():
    db = sqlite3.connect(WORK / "coral_grid.sqlite")
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.execute("""
      CREATE TABLE IF NOT EXISTS cells(
        y INTEGER NOT NULL,
        x INTEGER NOT NULL,
        records INTEGER NOT NULL,
        PRIMARY KEY(y,x)
      )
    """)
    db.execute("""
      CREATE TABLE IF NOT EXISTS done(
        taxon TEXT NOT NULL,
        south REAL NOT NULL,
        west REAL NOT NULL,
        north REAL NOT NULL,
        east REAL NOT NULL,
        PRIMARY KEY(taxon,south,west,north,east)
      )
    """)
    db.commit()
    return db

def bbox_wkt(w,s,e,n):
    return f"POLYGON (({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))"

def normalize_lon(lon):
    while lon < -180: lon += 360
    while lon >= 180: lon -= 360
    return lon
def process_coral_box(db, taxon, west, south, east, north, depth=0):
    done = db.execute(
        "SELECT 1 FROM done WHERE taxon=? AND south=? AND west=? AND north=? AND east=?",
        (taxon,south,west,north,east)
    ).fetchone()
    if done:
        return

    try:
        data = get_json(OBIS_GRID, {
            "scientificname": taxon,
            "geometry": bbox_wkt(west,south,east,north)
        }, retries=7, timeout=120)
        features = data.get("features") or []
    except Exception as exc:
        if depth < 4 and (east-west > 3 or north-south > 3):
            features = None
        else:
            raise

    if features is None or len(features) >= 99500:
        midx = (west + east) / 2
        midy = (south + north) / 2
        for w,s,e,n in [
            (west,south,midx,midy),(midx,south,east,midy),
            (west,midy,midx,north),(midx,midy,east,north)
        ]:
            process_coral_box(db,taxon,w,s,e,n,depth+1)
        db.execute(
            "INSERT OR IGNORE INTO done VALUES(?,?,?,?,?)",
            (taxon,south,west,north,east)
        )
        db.commit()
        return

    agg = {}
    for f in features:
        ring = ((f.get("geometry") or {}).get("coordinates") or [[]])[0]
        if not ring:
            continue
        xs = [float(p[0]) for p in ring if len(p) >= 2]
        ys = [float(p[1]) for p in ring if len(p) >= 2]
        if not xs or not ys:
            continue
        lon = normalize_lon((min(xs)+max(xs))/2)
        lat = (min(ys)+max(ys))/2

        # half-open box ownership avoids double counting border cells
        if not (west <= lon < east and south <= lat < north):
            if east == 180 and abs(lon-180) < 1e-9: pass
            elif north == 90 and abs(lat-90) < 1e-9: pass
            else: continue

        props = f.get("properties") or {}
        count = int(props.get("n") or props.get("count") or 0)
        if count <= 0:
            continue
        y = math.floor((lat + 90) / CORAL_STEP)
        x = math.floor((lon + 180) / CORAL_STEP)
        agg[(y,x)] = agg.get((y,x),0) + count

    rows = [(y,x,c) for (y,x),c in agg.items()]
    db.executemany("""
      INSERT INTO cells(y,x,records) VALUES(?,?,?)
      ON CONFLICT(y,x) DO UPDATE SET records=records+excluded.records
    """, rows)
    db.execute(
        "INSERT OR IGNORE INTO done VALUES(?,?,?,?,?)",
        (taxon,south,west,north,east)
    )
    db.commit()
    print("coral", taxon, f"[{west},{south},{east},{north}]",
          "features", len(features), "bins", len(rows), flush=True)
    time.sleep(0.08)

def build_coral_grid_pyramid(cells):
    pyramid = {}
    for zoom, step in CORAL_GRID_PYRAMID_STEPS.items():
        grouped = {}
        for y, x, records in cells:
            lat = (y + 0.5) * CORAL_STEP - 90
            lon = (x + 0.5) * CORAL_STEP - 180
            gy = math.floor((lat + 90) / step)
            gx = math.floor((lon + 180) / step)
            grouped[(gy, gx)] = grouped.get((gy, gx), 0) + records

        pyramid[str(zoom)] = {
            "step": step,
            "cells": [
                [gy, gx, records]
                for (gy, gx), records in sorted(grouped.items())
            ]
        }
    return pyramid

def build_coral():
    db = coral_db()
    for taxon in TAXA:
        for south in range(-90, 90, 30):
            north = min(90, south + 30)
            for west in range(-180, 180, 30):
                east = min(180, west + 30)
                process_coral_box(db,taxon,west,south,east,north)

    cells = [
        [int(y), int(x), int(records)]
        for y,x,records in db.execute(
            "SELECT y,x,records FROM cells ORDER BY y,x"
        )
    ]
    total_records = sum(row[2] for row in cells)
    grid_pyramid = build_coral_grid_pyramid(cells)
    payload = {
        "v": 2,
        "source": "OBIS combined coral taxa, local precision-6 grid",
        "taxa": TAXA,
        "step": CORAL_STEP,
        "records": total_records,
        "cells": cells,
        "gridPyramid": grid_pyramid
    }
    write_gzip_js(payload, DATA / "coral_records_snapshot.js",
                  "DIVEATLAS_CORAL_SNAPSHOT")
    print("coral cells", len(cells), "records", total_records, flush=True)
    db.close()

if __name__ == "__main__":
    import argparse, subprocess, sys
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "target",
        choices=["reef","coral","coral-grid","coral-species","all"]
    )
    args = ap.parse_args()
    if args.target in ("reef","all"):
        build_reef()
    if args.target in ("coral","coral-grid","all"):
        build_coral()
    if args.target in ("coral","coral-species","all"):
        subprocess.run(
            [
                sys.executable,
                str(ROOT / "tools" / "build_coral_species_local.py")
            ],
            check=True
        )
