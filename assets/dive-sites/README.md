# Dive-site photos

All photos live under `assets/dive-sites/<siteId>/`, using the stable DiveAtlas UID. Keep original source archives outside this directory. Changing storage paths does not change photo identity, rights or approval status.

- `hero.webp`: verified user-provided photo, registered in `datasets/dive-site-photos.js`.
- `hero.jpg`: one reviewed image shared by desktop/mobile heroes, map popups, directory cards and related cards. The browser crops it to the existing frame using centered `object-fit: cover`; the enlarged preview shows the full stored composition.

`assignments.json` at this directory root is the active reviewed-photo manifest and retains current credits and review metadata. `images.css` is shared presentation. Only UID photo folders belong here; historical batch records stay outside the published assets. Preserve creator, source, exact licence, crop notices and review caveats when changing an assignment.

Published assignments must not contain private `source_review_manifest` or `original_archive` paths. The importer retains local provenance in `assignments.json` beside the private decision file, and publishes source-page links, creator/licence evidence and available original hashes. Run `npm run check:dataset-paths` before publishing; assets cannot reference the local research tree.

Run `python maintenance/build_reviewed_site_photo_catalog.py` to rebuild the browser catalog without generating image derivatives from active assignments. Apply additional explicitly selected images with `maintenance/apply_additional_reviewed_photos.py`; it writes directly to UID directories. Historical private batch scripts target the old layout and must be ported before reuse. `maintenance/organize_dive_site_photos.py` records the one-time migration; it refuses an already migrated tree.

Reviewed assignments use a single `hero` URL. Existing heroes preserve the former desktop composition byte-for-byte; separate mobile crops were removed by `maintenance/use_shared_dive_site_heroes.py`. Future imports resize the full EXIF-oriented source composition to fit within 1600×1600 without pre-cropping. Cards and map popups use that same hero URL and crop it within their frames; no separate thumbnail file is generated. This reduces stored derivatives but makes small previews download the full image. Browser cropping changes presentation, not downloaded file size. Preserve the recorded source crop evidence for older heroes; browser cropping cannot restore content outside those stored images.

A photo is requested only when its dive-site popup opens.

When a site has no verified user-provided photo, the popup uses an illustrative fallback from the public R2 feature-image catalog. It prefers a matching reviewed feature, then a matching legacy type; a stable site UUID selects among images of that type so the choice is consistent across visits. Sites without a matching type use a reef image as the general fallback. A verified user-provided photo always takes precedence. Fallback alt text and visible credits identify the image as illustrative and retain its source and license attribution.

After adding or changing feature images in R2, rebuild the browser catalog from the public image manifest:

```powershell
python scripts/build_dive_site_fallback_photo_catalog.py
```

Register each photo in `datasets/dive-site-photos.js`. The object key and its `siteId` must exactly match the DiveAtlas UUID in field `[12]` of the corresponding row in `datasets/dive-sites.js`. Include a meaningful `alt`, `credit`, `source`, `license`, and `locationConfidence: "exact"`; `capturedAt` is optional.

The original flattened source data provides source names such as `osm`, `padi`, and `ssi`, but no stable per-site source identifier. Each current record therefore has a DiveAtlas-owned UUID stored directly in the local dataset. These UUIDs are assigned once: preserve them when changing coordinates, names, translations, or other fields, and never regenerate them during a build. For newly imported records, assign a UUID once when adding the record and retain it in the dataset on future updates. Do not match photo metadata by names, coordinates, translations, or array order.

Records with the same normalized name (Unicode NFKC, case-insensitive and whitespace-normalized) within 3 km are possible identity candidates only. Preserve their separate rows and source evidence. Use `tools/dive_site_record_reviews.json` for explicit candidate, distinct or confirmed decisions; only an evidence-backed confirmed group selects a canonical ID. Historical retired UUIDs in optional field `[13]` preserve metadata lookup but do not independently establish identity, because earlier imports used heuristic merging. See `docs/shared-dive-site-details.md` for the review and compatibility contract.
