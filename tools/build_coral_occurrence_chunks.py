import base64
import concurrent.futures
import gzip
import json
import math
import sqlite3
import threading
import time
from pathlib import Path

import requests

from build_local_data import DATA, WORK, CORAL_STEP, TAXA
from coral_qc import load_accepted_cells

OBIS_OCCURRENCE = "https://api.obis.org/v3/occurrence"
PAGE_SIZE = 10000
TASK_DEGREES = 10
CHUNK_DEGREES = 1
MAX_WORKERS = 24
DB_PATH = WORK / "coral_occurrences.sqlite"
GRID_DB = WORK / "coral_grid.sqlite"
OUT_DIR = DATA / "coral_occurrence_chunks"
MANIFEST_PATH = DATA / "coral_occurrence_manifest.js"
_thread_local = threading.local()
def session():
    value = getattr(_thread_local, "session", None)
    if value is None:
        value = requests.Session()
        value.headers.update({
            "User-Agent": "DiveAtlas-local-occurrence-builder/1.0"
        })
        _thread_local.session = value
    return value


def request_json(params, retries=8):
    last = None
    for attempt in range(retries):
        try:
            response = session().get(
                OBIS_OCCURRENCE,
                params=params,
                timeout=180
            )
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            last = exc
            time.sleep(min(25, 1.1 * (1.75 ** attempt)))
    raise last
def bbox_wkt(west, south, east, north):
    return (
        f"POLYGON (({west} {south},{east} {south},"
        f"{east} {north},{west} {north},"
        f"{west} {south}))"
    )


def normalize_lon(value):
    value = float(value)
    while value < -180:
        value += 360
    while value >= 180:
        value -= 360
    return value


def species_name(row):
    return str(
        row.get("species") or
        row.get("scientificName") or
        row.get("scientificname") or ""
    ).strip()
def load_valid_cells_and_tasks():
    valid_cells, raw_rows, qc = load_accepted_cells(GRID_DB, CORAL_STEP)
    rows = [row for row in raw_rows if (row[0], row[1]) in valid_cells]
    print("Coral inland QC", qc, flush=True)
    dense_boxes = set()
    sparse_boxes = set()
    for y, x, _ in rows:
        lat = (int(y) + 0.5) * CORAL_STEP - 90
        lon = (int(x) + 0.5) * CORAL_STEP - 180
        south10 = math.floor((lat + 90) / 10) * 10 - 90
        west10 = math.floor((lon + 180) / 10) * 10 - 180
        south30 = math.floor((lat + 90) / 30) * 30 - 90
        west30 = math.floor((lon + 180) / 30) * 30 - 180
        dense_boxes.add((int(west10), int(south10)))
        sparse_boxes.add((int(west30), int(south30)))

    tasks = set()
    for taxon in TAXA:
        boxes = dense_boxes if taxon in {
            "Scleractinia", "Octocorallia"
        } else sparse_boxes
        size = 10 if taxon in {
            "Scleractinia", "Octocorallia"
        } else 30
        for west, south in boxes:
            tasks.add((
                taxon, south, west,
                min(90, south + size),
                min(180, west + size)
            ))
    return valid_cells, sorted(tasks)
def open_db():
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.execute("""
      CREATE TABLE IF NOT EXISTS occurrence(
        id TEXT PRIMARY KEY,
        lat_i INTEGER NOT NULL,
        lng_i INTEGER NOT NULL,
        species TEXT NOT NULL,
        cy INTEGER NOT NULL,
        cx INTEGER NOT NULL
      )
    """)
    db.execute("""
      CREATE INDEX IF NOT EXISTS idx_occ_chunk
      ON occurrence(cy,cx)
    """)
    db.execute("""
      CREATE TABLE IF NOT EXISTS done(
        taxon TEXT NOT NULL,
        south INTEGER NOT NULL,
        west INTEGER NOT NULL,
        north INTEGER NOT NULL,
        east INTEGER NOT NULL,
        records INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(taxon,south,west,north,east)
      )
    """)
    db.commit()
    return db
def fetch_task(task, valid_cells):
    taxon, south, west, north, east = task
    geometry = bbox_wkt(west, south, east, north)
    after = ""
    fetched = 0
    kept = []

    while True:
        params = {
            "scientificname": taxon,
            "geometry": geometry,
            "size": str(PAGE_SIZE),
            "fields": (
                "id,decimalLatitude,decimalLongitude,"
                "species,scientificName,speciesid"
            )
        }
        if after:
            params["after"] = after
            params["total"] = "false"
        data = request_json(params)
        page = data.get("results") or []
        if not page:
            break
        for row in page:
            try:
                lat = float(
                    row.get("decimalLatitude",
                            row.get("decimallatitude"))
                )
                raw_lon = float(
                    row.get("decimalLongitude",
                            row.get("decimallongitude"))
                )
            except Exception:
                continue
            if not (south <= lat < north or (north == 90 and lat == 90)):
                continue
            if not (west <= raw_lon < east or
                    (east == 180 and raw_lon == 180)):
                continue

            lon = normalize_lon(raw_lon)
            y = math.floor((lat + 90) / CORAL_STEP)
            x = math.floor((lon + 180) / CORAL_STEP)
            if (int(y), int(x)) not in valid_cells:
                continue
            name = species_name(row)
            record_id = str(row.get("id") or "").strip()
            if not record_id:
                record_id = (
                    f"{taxon}:{lat:.6f}:{lon:.6f}:{name}"
                )
            lat_i = int(round(lat * 1_000_000))
            lng_i = int(round(lon * 1_000_000))
            cy = int(math.floor(lat + 90))
            cx = int(math.floor(lon + 180))
            kept.append((
                record_id, lat_i, lng_i, name, cy, cx
            ))

        fetched += len(page)
        if len(page) < PAGE_SIZE:
            break
        next_after = str(page[-1].get("id") or "")
        if not next_after or next_after == after:
            break
        after = next_after

    return task, fetched, kept
def store_task(db, task, fetched, rows):
    if rows:
        db.executemany("""
          INSERT OR IGNORE INTO occurrence(
            id,lat_i,lng_i,species,cy,cx
          ) VALUES(?,?,?,?,?,?)
        """, rows)
    db.execute("""
      INSERT OR REPLACE INTO done(
        taxon,south,west,north,east,records
      ) VALUES(?,?,?,?,?,?)
    """, (*task, int(fetched)))
    db.commit()


def download_occurrences():
    valid_cells, tasks = load_valid_cells_and_tasks()
    db = open_db()
    done = {
        tuple(row)
        for row in db.execute(
            "SELECT taxon,south,west,north,east FROM done"
        )
    }
    pending = [task for task in tasks if task not in done]
    print(
        "occurrence tasks", len(pending),
        "done", len(done),
        "all", len(tasks),
        flush=True
    )
    failures = []
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=MAX_WORKERS
    ) as pool:
        futures = {
            pool.submit(fetch_task, task, valid_cells): task
            for task in pending
        }
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            task = futures[future]
            completed += 1
            try:
                _, fetched, rows = future.result()
                store_task(db, task, fetched, rows)
                if fetched or completed % 20 == 0:
                    print(
                        f"[{completed}/{len(pending)}]",
                        task,
                        "fetched", fetched,
                        "kept", len(rows),
                        flush=True
                    )
            except Exception as exc:
                failures.append((task, repr(exc)))
                print("FAILED", task, repr(exc), flush=True)
    db.close()
    if failures:
        print("failed tasks", len(failures), flush=True)
        raise SystemExit(2)
def write_chunk(key, rows, species_to_id):
    payload = [
        [
            int(lat_i),
            int(lng_i),
            int(species_to_id.get(name, -1))
        ]
        for lat_i, lng_i, name in rows
    ]
    raw = json.dumps(
        payload,
        separators=(",", ":"),
        ensure_ascii=False
    ).encode("utf-8")
    packed = gzip.compress(raw, compresslevel=9)
    encoded = base64.b64encode(packed).decode("ascii")
    file_name = key.replace(":", "_") + ".js"
    target = OUT_DIR / file_name
    target.write_text(
        "window.DIVEATLAS_CORAL_OCCURRENCE_CHUNKS="
        "window.DIVEATLAS_CORAL_OCCURRENCE_CHUNKS||{};"
        f'window.DIVEATLAS_CORAL_OCCURRENCE_CHUNKS["{key}"]='
        f'"{encoded}";\n',
        encoding="utf-8"
    )
    return file_name, len(rows), len(raw), len(packed)
def export_chunks():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.js"):
        old.unlink()

    db = sqlite3.connect(DB_PATH)
    valid_cells, _, qc = load_accepted_cells(GRID_DB, CORAL_STEP)
    print("Coral occurrence export QC", qc, flush=True)
    species_set = set()
    for cy, cx, lat_i, lng_i, name in db.execute(
        "SELECT cy,cx,lat_i,lng_i,species FROM occurrence"
    ):
        lat, lon = lat_i / 1_000_000, lng_i / 1_000_000
        key = (math.floor((lat + 90) / CORAL_STEP),
               math.floor((lon + 180) / CORAL_STEP))
        if key in valid_cells and name:
            species_set.add(name)
    species = sorted(species_set)
    species_to_id = {
        name: index for index, name in enumerate(species)
    }

    manifest = {}
    total = 0
    raw_total = 0
    packed_total = 0
    current_key = None
    current_rows = []
    cursor = db.execute("""
      SELECT cy,cx,lat_i,lng_i,species
      FROM occurrence
      ORDER BY cy,cx,id
    """)
    skipped_occurrences = 0
    for cy, cx, lat_i, lng_i, name in cursor:
        lat, lon = lat_i / 1_000_000, lng_i / 1_000_000
        base_key = (math.floor((lat + 90) / CORAL_STEP),
                    math.floor((lon + 180) / CORAL_STEP))
        if base_key not in valid_cells:
            skipped_occurrences += 1
            continue
        key = f"{int(cy)}:{int(cx)}"
        if current_key is not None and key != current_key:
            file_name, count, raw_size, packed_size = write_chunk(
                current_key,
                current_rows,
                species_to_id
            )
            manifest[current_key] = [file_name, count]
            total += count
            raw_total += raw_size
            packed_total += packed_size
            current_rows = []
        current_key = key
        current_rows.append((lat_i, lng_i, name))

    if current_key is not None:
        file_name, count, raw_size, packed_size = write_chunk(
            current_key,
            current_rows,
            species_to_id
        )
        manifest[current_key] = [file_name, count]
        total += count
        raw_total += raw_size
        packed_total += packed_size
    db.close()
    payload = {
        "v": 1,
        "chunkDegrees": CHUNK_DEGREES,
        "species": species,
        "chunks": manifest,
        "records": total
    }
    MANIFEST_PATH.write_text(
        "window.DIVEATLAS_CORAL_OCCURRENCE_MANIFEST="
        + json.dumps(
            payload,
            separators=(",", ":"),
            ensure_ascii=False
        )
        + ";\n",
        encoding="utf-8"
    )
    print(
        "exported chunks", len(manifest),
        "species", len(species),
        "records", total,
        "skipped inland occurrences", skipped_occurrences,
        "raw_MB", round(raw_total / 1048576, 2),
        "gzip_MB", round(packed_total / 1048576, 2),
        flush=True
    )


def main():
    download_occurrences()
    export_chunks()


if __name__ == "__main__":
    main()
