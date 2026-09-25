# Dive-site photos

Store optimized WebP images under `assets/dive-sites/<siteId>/hero.webp`. Keep the original files elsewhere. A photo is requested only when its dive-site popup opens.

Register each photo in `data/dive-site-photos.js`. The object key and its `siteId` must exactly match the DiveAtlas UUID in field `[12]` of the corresponding row in `data/dive-sites.js`. Include a meaningful `alt`, `credit`, `source`, `license`, and `locationConfidence: "exact"`; `capturedAt` is optional.

The original flattened source data provides source names such as `osm`, `padi`, and `ssi`, but no stable per-site source identifier. Each current record therefore has a DiveAtlas-owned UUID stored directly in the local dataset. These UUIDs are assigned once: preserve them when changing coordinates, names, translations, or other fields, and never regenerate them during a build. For newly imported records, assign a UUID once when adding the record and retain it in the dataset on future updates. Do not match photo metadata by names, coordinates, translations, or array order.

Records with the same normalized name (Unicode NFKC, case-insensitive, and whitespace-normalized) and coordinates within 3 km are treated as duplicates and represented by one row. The retained row keeps one existing UUID as its canonical ID; any retired UUIDs are stored in optional field `[13]` so metadata already keyed to those IDs remains addressable. The selected row's coordinates are retained, while source/type/skill/region/alias values are combined. Do not apply this rule to similar-but-different names or proximity alone.
