"""Refresh assigned photos in existing detail outputs without rebuilding unrelated content.

Usage: python tools/refresh_detail_photos.py
Missing indexed pages fail explicitly: this refresh must not bypass content gates.
"""

import json
import re
from pathlib import Path

if __package__:
    from . import generate_seo_pages as seo
    from . import export_dive_site_details as details
else:
    import generate_seo_pages as seo
    import export_dive_site_details as details


def refresh(root=None, *, include_shared_records=True):
    root = Path(root) if root else seo.ROOT
    photos = seo.load_photos()
    assignments = json.loads((root / "assets/dive-sites/assignments.json").read_text(encoding="utf-8"))
    selected = [entry for entry in assignments if photos.get(entry["site_id"], {}).get("source") == "reviewed-assignment"]
    rows, summaries = seo.load_rows(), seo.load_summaries()
    base, fallback = seo.load_fallback_photos()
    candidates, _ = seo.validated_candidates(rows, photos, summaries, base, fallback)
    sites = {site["site_id"]: site for site in candidates}
    selected.extend({"site_id": site_id, "slug": sites[site_id]["slug"]}
                    for site_id, photo in photos.items()
                    if photo.get("source") == "personal" and site_id in sites)
    # Prepare every update before writing, so malformed/missing pages do not
    # leave a partially refreshed batch. Keep maps and recommendations intact.
    updates = []
    counts = {"static_updated": 0, "shared_updated": 0, "sites": len(selected)}
    pattern = re.compile(r'<div class="site-photo-feature"><figure\b.*?</figure>', re.S)
    for entry in selected:
        site_id = entry["site_id"]
        path = root / "dive-sites" / entry["slug"] / "index.html"
        if site_id not in sites:
            raise ValueError(f"Assigned photo site does not pass the indexed-page gate: {site_id}")
        old = path.read_text(encoding="utf-8")
        if f'data-site-id="{site_id}"' not in old:
            raise ValueError(f"Wrong site identity in {path}")
        generated = seo.render_site_photo(sites[site_id])
        fragment = pattern.search(generated)
        if not fragment:
            raise ValueError(f"Missing generated hero for {site_id}")
        new, count = pattern.subn(lambda _: fragment.group(), old, count=1)
        if count != 1:
            raise ValueError(f"Missing existing hero for {site_id}")
        if new != old:
            updates.append((path, new))
            counts["static_updated"] += 1
        # Production detail records belong to the verified external R2 release.
        # A static-photo refresh must neither require nor rewrite local copies.
        if not include_shared_records:
            continue
        record_path = root / details.DATA_PATH / f"{site_id}.json"
        record = json.loads(record_path.read_text(encoding="utf-8"))
        if record.get("site_id") != site_id:
            raise ValueError(f"Wrong shared record identity in {record_path}")
        if record.get("photo") != photos[site_id]:
            record["photo"] = photos[site_id]
            updates.append((record_path, json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"))
            counts["shared_updated"] += 1
    for path, content in updates:
        path.write_text(content, encoding="utf-8")
    return counts


if __name__ == "__main__":
    print(json.dumps(refresh()))
