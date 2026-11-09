"""Normalize opted-in photo assignments for both detail-page exporters."""

import json
if __package__:
    from .photo_asset_urls import photo_asset_url, photo_asset_available
else:
    from photo_asset_urls import photo_asset_url, photo_asset_available


def load_detail_photos(root):
    # Rollout membership is data, not renderer behavior. Assignments remain the
    # source of truth for image identity and attribution; opt-in is not a new
    # verification of rights or authorization to publish.
    rollout = json.loads((root / "datasets/detail-photo-rollout.json").read_text(encoding="utf-8"))
    assignments = json.loads((root / "assets/dive-sites/assignments.json").read_text(encoding="utf-8"))
    enabled = ([entry["site_id"] for entry in assignments if entry["role"] == "main"]
               if rollout.get("selection") == "all-main-assignments" else rollout["site_ids"])
    if len(enabled) != len(set(enabled)):
        raise ValueError("Duplicate detail photo assignment IDs")
    photos = {}
    for site_id in enabled:
        matches = [entry for entry in assignments if entry["site_id"] == site_id]
        if len(matches) != 1:
            raise ValueError(f"Expected one detail photo assignment for {site_id}")
        entry = matches[0]
        if entry["role"] != "main" or not photo_asset_available(root, entry['hero']):
            raise ValueError(f"Missing main detail photo for {site_id}")
        creator_links = list(entry.get("creator_links", []))
        if 'Diego Delso' in entry['creator'] and not any(link['url'] == 'http://delso.photo' for link in creator_links):
            creator_links.append({"label": "delso.photo", "url": "http://delso.photo"})
        if 'Woodym555' in entry['creator']:
            creator_links.extend([
                {"label": "Woodym555", "url": "https://commons.wikimedia.org/wiki/User:Woodym555"},
                {"label": "Fir0002", "url": "https://commons.wikimedia.org/wiki/User:Fir0002"},
            ])
        photos[site_id] = {
            "src": photo_asset_url(root, entry["hero"]), "alt": entry.get("alt") or f'{entry["name"]} — {entry["label"]}', "credit": entry["creator"],
            "source": "reviewed-assignment", "source_page": entry["source_page"],
            "licence": entry["licence"], "licence_url": entry["licence_url"],
            "label": entry["label"], "hide_context_label": entry.get("hide_context_label", False),
            "creator_links": creator_links,
        }
    return photos
