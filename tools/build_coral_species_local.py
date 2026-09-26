from pathlib import Path
import concurrent.futures
import json
import math
import sqlite3
import threading
import time

import requests

from build_local_data import (
    DATA, WORK, CORAL_STEP, TAXA,
    CORAL_GRID_PYRAMID_STEPS, write_gzip_js
)
from coral_qc import load_accepted_cells

OBIS_OCCURRENCE = "https://api.obis.org/v3/occurrence"
PAGE_SIZE = 10000
BOX_DEGREES = 10
MAX_WORKERS = 12
SPECIES_DB = WORK / "coral_species.sqlite"
GRID_DB = WORK / "coral_grid.sqlite"
_thread_local = threading.local()
def session():
    value = getattr(_thread_local, "session", None)
    if value is None:
        value = requests.Session()
        value.headers.update({
            "User-Agent": "DiveAtlas-local-species-builder/1.0"
        })
        _thread_local.session = value
    return value


def request_json(params, retries=7):
    last = None
    for attempt in range(retries):
        try:
            response = session().get(
                OBIS_OCCURRENCE,
                params=params,
                timeout=150
            )
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            last = exc
            time.sleep(min(20, 1.2 * (1.7 ** attempt)))
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
    name = str(row.get("species") or "").strip()
    if name:
        return name
    if row.get("speciesid") or row.get("speciesID"):
        return str(
            row.get("scientificName") or
            row.get("scientificname") or ""
        ).strip()
    return ""
def open_species_db():
    db = sqlite3.connect(SPECIES_DB)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.execute("""
      CREATE TABLE IF NOT EXISTS cell_species(
        y INTEGER NOT NULL,
        x INTEGER NOT NULL,
        species TEXT NOT NULL,
        PRIMARY KEY(y,x,species)
      )
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
def occupied_boxes_and_cells():
    accepted, raw_rows, qc = load_accepted_cells(GRID_DB, CORAL_STEP)
    rows = [row for row in raw_rows if (row[0], row[1]) in accepted]
    print("Coral inland QC", qc, flush=True)

    valid_cells = {(int(y), int(x)) for y, x, _ in rows}
    boxes = set()
    for y, x, _ in rows:
        lat = (int(y) + 0.5) * CORAL_STEP - 90
        lon = (int(x) + 0.5) * CORAL_STEP - 180
        south = math.floor((lat + 90) / BOX_DEGREES) * BOX_DEGREES - 90
        west = math.floor((lon + 180) / BOX_DEGREES) * BOX_DEGREES - 180
        boxes.add((int(west), int(south)))

    return rows, valid_cells, sorted(boxes)


def task_key(taxon, west, south, box_degrees=BOX_DEGREES):
    return (
        taxon, south, west,
        min(90, south + box_degrees),
        min(180, west + box_degrees)
    )


def grouped_boxes(boxes, box_degrees):
    grouped = set()
    for west, south in boxes:
        grouped_west = (
            math.floor((west + 180) / box_degrees) *
            box_degrees - 180
        )
        grouped_south = (
            math.floor((south + 90) / box_degrees) *
            box_degrees - 90
        )
        grouped.add((int(grouped_west), int(grouped_south)))
    return sorted(grouped)
def fetch_task(task, valid_cells):
    taxon, south, west, north, east = task
    geometry = bbox_wkt(west, south, east, north)
    after = ""
    total = None
    fetched = 0
    cell_names = {}

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
        if total is None:
            try:
                total = int(data.get("total"))
            except Exception:
                total = None

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

            if not (south <= lat < north or
                    (north == 90 and lat == 90)):
                continue
            if not (west <= raw_lon < east or
                    (east == 180 and raw_lon == 180)):
                continue
            name = species_name(row)
            if not name:
                continue

            lon = normalize_lon(raw_lon)
            y = math.floor((lat + 90) / CORAL_STEP)
            x = math.floor((lon + 180) / CORAL_STEP)
            key = (int(y), int(x))
            if key not in valid_cells:
                continue
            cell_names.setdefault(key, set()).add(name)

        fetched += len(page)
        if len(page) < PAGE_SIZE:
            break
        next_after = page[-1].get("id")
        if not next_after or str(next_after) == after:
            break
        after = str(next_after)

    return task, fetched, total, cell_names


def existing_done(db):
    return {
        (taxon, south, west, north, east)
        for taxon, south, west, north, east
        in db.execute(
            "SELECT taxon,south,west,north,east FROM done"
        )
    }
def store_task(db, task, fetched, cell_names):
    rows = [
        (y, x, name)
        for (y, x), names in cell_names.items()
        for name in names
    ]
    if rows:
        db.executemany(
            "INSERT OR IGNORE INTO cell_species(y,x,species) "
            "VALUES(?,?,?)",
            rows
        )
    db.execute(
        "INSERT OR REPLACE INTO done("
        "taxon,south,west,north,east,records"
        ") VALUES(?,?,?,?,?,?)",
        (*task, int(fetched))
    )
    db.commit()


def download_species_index():
    base_rows, valid_cells, boxes = occupied_boxes_and_cells()
    db = open_species_db()
    done = existing_done(db)
    tasks = []
    dense_taxa = {"Scleractinia", "Octocorallia"}
    coarse_boxes = grouped_boxes(boxes, 30)

    for taxon in TAXA:
        if taxon in dense_taxa:
            taxon_boxes = boxes
            box_degrees = BOX_DEGREES
        else:
            taxon_boxes = coarse_boxes
            box_degrees = 30

        for west, south in taxon_boxes:
            key = task_key(
                taxon,
                west,
                south,
                box_degrees
            )
            if key not in done:
                tasks.append(key)
    print(
        "species tasks",
        len(tasks),
        "done",
        len(done),
        "boxes",
        len(boxes),
        flush=True
    )
    failures = []

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=MAX_WORKERS
    ) as pool:
        future_map = {
            pool.submit(fetch_task, task, valid_cells): task
            for task in tasks
        }
        completed = 0
        for future in concurrent.futures.as_completed(future_map):
            task = future_map[future]
            completed += 1
            try:
                _, fetched, total, cell_names = future.result()
                store_task(db, task, fetched, cell_names)
                if fetched or completed % 25 == 0:
                    print(
                        f"[{completed}/{len(tasks)}]",
                        task,
                        "rows", fetched,
                        "total", total,
                        "cells", len(cell_names),
                        flush=True
                    )
            except Exception as exc:
                failures.append((task, repr(exc)))
                print(
                    "FAILED", task,
                    type(exc).__name__,
                    str(exc)[:180],
                    flush=True
                )

    db.close()
    if failures:
        print("failed tasks", len(failures), flush=True)
        for item in failures[:30]:
            print(item, flush=True)
        raise SystemExit(2)
    return base_rows


def load_cell_species(valid_cells):
    db = sqlite3.connect(SPECIES_DB)
    result = {}
    all_names = set()
    for y, x, name in db.execute(
        "SELECT y,x,species FROM cell_species ORDER BY y,x,species"
    ):
        if (int(y), int(x)) not in valid_cells:
            continue
        result.setdefault((int(y), int(x)), []).append(name)
        all_names.add(name)
    db.close()
    names = sorted(all_names)
    name_to_id = {name: index for index, name in enumerate(names)}
    ids = {
        key: [name_to_id[name] for name in values]
        for key, values in result.items()
    }
    return names, ids
def build_pyramid(base_rows, cell_species_ids):
    pyramid = {}
    for zoom, step in CORAL_GRID_PYRAMID_STEPS.items():
        grouped = {}
        for y, x, records in base_rows:
            lat = (int(y) + 0.5) * CORAL_STEP - 90
            lon = (int(x) + 0.5) * CORAL_STEP - 180
            gy = math.floor((lat + 90) / step)
            gx = math.floor((lon + 180) / step)
            entry = grouped.setdefault(
                (int(gy), int(gx)),
                [0, set()]
            )
            entry[0] += int(records)
            entry[1].update(
                cell_species_ids.get((int(y), int(x)), ())
            )

        pyramid[str(zoom)] = {
            "step": step,
            "cells": [
                [gy, gx, values[0], sorted(values[1])]
                for (gy, gx), values in sorted(grouped.items())
            ]
        }
    return pyramid


def export_snapshot(base_rows):
    valid_cells = {(int(y), int(x)) for y, x, _ in base_rows}
    species, cell_species_ids = load_cell_species(valid_cells)
    cells = [
        [
            int(y),
            int(x),
            int(records),
            cell_species_ids.get((int(y), int(x)), [])
        ]
        for y, x, records in base_rows
    ]
    total_records = sum(row[2] for row in cells)
    with_species = sum(1 for row in cells if row[3])
    payload = {
        "v": 3,
        "source": (
            "OBIS combined coral taxa, local precision-6 grid "
            "+ local species index"
        ),
        "taxa": TAXA,
        "step": CORAL_STEP,
        "records": total_records,
        "species": species,
        "cells": cells,
        "gridPyramid": build_pyramid(
            base_rows,
            cell_species_ids
        )
    }
    write_gzip_js(
        payload,
        DATA / "coral_records_snapshot.js",
        "DIVEATLAS_CORAL_SNAPSHOT"
    )
    print(
        "species", len(species),
        "base_cells", len(cells),
        "cells_with_species", with_species,
        "records", total_records,
        flush=True
    )
def main():
    base_rows = download_species_index()
    export_snapshot(base_rows)


if __name__ == "__main__":
    main()
