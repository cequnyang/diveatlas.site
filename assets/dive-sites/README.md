# Dive-site photos

All photos live under `assets/dive-sites/<siteId>/`, using the stable DiveAtlas UID. Keep original source archives outside this directory. Changing storage paths does not change photo identity, rights or approval status.

- `hero.webp`: verified user-provided photo, registered in `datasets/dive-site-photos.js`.
- `desktop.jpg`, `mobile.jpg`: reviewed detail-page hero derivatives; both variants may reference the same file when the composition is shared.
- `thumbnail.jpg`: map, directory and related-card preview.
- Other derivative names, optionally with a content-hash suffix: retained earlier compositions; do not overwrite them when adding a new image.

`assignments.json` at this directory root is the active reviewed-photo manifest and retains current credits and review metadata. `images.css` is shared presentation. Only UID photo folders belong here; historical batch records stay outside the published assets. Preserve creator, source, exact licence, crop notices and review caveats when changing an assignment.

Run `python maintenance/build_reviewed_site_thumbnails.py` to rebuild thumbnails and the browser catalog from active assignments. Apply additional explicitly selected images with `maintenance/apply_additional_reviewed_photos.py`; it writes directly to UID directories. Historical private batch scripts target the old layout and must be ported before reuse. `maintenance/organize_dive_site_photos.py` records the one-time migration; it refuses an already migrated tree.

A photo is requested only when its dive-site popup opens.

When a site has no verified user-provided photo, the popup uses an illustrative fallback from the public R2 feature-image catalog. It prefers a matching reviewed feature, then a matching legacy type; a stable site UUID selects among images of that type so the choice is consistent across visits. Sites without a matching type use a reef image as the general fallback. A verified user-provided photo always takes precedence. Fallback alt text and visible credits identify the image as illustrative and retain its source and license attribution.

After adding or changing feature images in R2, rebuild the browser catalog from the public image manifest:

```powershell
python scripts/build_dive_site_fallback_photo_catalog.py
```

Register each photo in `datasets/dive-site-photos.js`. The object key and its `siteId` must exactly match the DiveAtlas UUID in field `[12]` of the corresponding row in `datasets/dive-sites.js`. Include a meaningful `alt`, `credit`, `source`, `license`, and `locationConfidence: "exact"`; `capturedAt` is optional.

The original flattened source data provides source names such as `osm`, `padi`, and `ssi`, but no stable per-site source identifier. Each current record therefore has a DiveAtlas-owned UUID stored directly in the local dataset. These UUIDs are assigned once: preserve them when changing coordinates, names, translations, or other fields, and never regenerate them during a build. For newly imported records, assign a UUID once when adding the record and retain it in the dataset on future updates. Do not match photo metadata by names, coordinates, translations, or array order.

Records with the same normalized name (Unicode NFKC, case-insensitive and whitespace-normalized) within 3 km are possible identity candidates only. Preserve their separate rows and source evidence. Use `tools/dive_site_record_reviews.json` for explicit candidate, distinct or confirmed decisions; only an evidence-backed confirmed group selects a canonical ID. Historical retired UUIDs in optional field `[13]` preserve metadata lookup but do not independently establish identity, because earlier imports used heuristic merging. See `docs/shared-dive-site-details.md` for the review and compatibility contract.
