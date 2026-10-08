# Dive-site category contract

## Purpose

The `type` values in `datasets/dive-sites.js` currently combine environment, entry method, underwater features, and dive conditions. This contract separates those meanings so category coverage can be measured and later used in search without treating unlike facts as interchangeable.

This is a classification contract, not a claim that existing source tags are all accurate. Do not infer a category solely from a site name or nearby geography.

## Categories

Each site may have zero or one `setting`, zero or one `access`, and zero or more `features`.

### Setting

Describes the body of water or facility where the dive takes place.

Allowed values:

- `marine` — sea or ocean
- `lake`
- `river`
- `spring` — freshwater spring or spring basin
- `pool` — purpose-built pool or indoor dive facility
- `quarry` — flooded quarry; retain this as a setting because it is a distinct inland dive venue
- `unknown` — evidence does not establish the setting

A confirmed inland site should use its specific setting (`lake`, `river`, `spring`, `pool`, or `quarry`) rather than `marine`. Do not infer `pool` from a dive center name or `quarry` from an inland location.

### Access

Describes how divers enter the water for a normal dive at the site.

Allowed values:

- `shore` — entry from land, including beach, rocky shore, or shore platform
- `boat` — normal access requires a boat
- `both` — both shore and boat access are supported for this named site
- `unknown` — source does not establish the normal entry method

`Beach` can support `shore` only when the tagged record describes the entry point, not merely a beach near an offshore site. `Beach` plus a reef or wreck does not by itself prove shore access. Do not infer `boat` just because the site is offshore or remote; require a source that describes access.

### Features

Describes underwater structure or a notable dive condition. Features are multi-valued.

| Existing type label | Normalized feature |
| --- | --- |
| `reef`, `artificial_reef` | `reef` or `artificial_reef` respectively |
| `wall` | `wall` |
| `wreck` | `wreck` |
| `cave`, `cavern` | preserve the distinction as `cave` and `cavern` |
| `pinnacle`, `seamount`, `boulder` | preserve as `pinnacle`, `seamount`, `boulder` |
| `channel` | `channel` |
| `sandy bottom` | `sandy_bottom` |
| `kelp` | `kelp` |
| `muck` | `muck` |
| `drift` | `drift` (condition/style, not a setting or access method) |
| `archaeological` | `archaeological` |
| `manta` | `manta` (wildlife attraction, not a physical feature) |
| `ocean` | setting `marine`; do not retain as a feature |
| `lake`, `river`, `spring`, `pool`, `quarry` | corresponding setting; do not retain as features |
| `beach` | possible access evidence; never a feature by itself |
| `bay`, `fjord`, `sea loch` | geographic descriptor; do not map automatically to a setting, access, or feature |

## Mapping and evidence rules

1. Preserve the raw source labels and source names during migration. Normalization must not overwrite the only copy of the imported values.
2. Add a normalized value only when the source record supports that specific meaning. A source-level tag may be evidence, but ambiguous or contradictory combinations need review.
3. Do not use `unknown` as a literal asserted fact if the storage model can represent an absent value. In reports and UI, absent means unknown.
4. Multiple labels can map to different facets. For example, `Beach | Reef | Wreck` may support `features: [reef, wreck]`; it supports `access: shore` only if the source confirms that beach is the dive entry.
5. Contradictory settings (`ocean` and `pool`, for example), unusually broad tag sets, or labels with inconsistent real-world meaning must be flagged for source review rather than resolved by a precedence rule.
6. Keep provenance per normalized value where possible: source name, source record ID or URL, retrieval date, and review status. The current `osm | padi | ssi` source list does not identify which source supplied each value, so it cannot independently establish field-level provenance.
7. A site can remain uncategorized. Do not substitute popularity, region, nearby reef layers, or model output for site-specific evidence.

## Applying this contract to the current data

The current `datasets/dive-sites.js` layout stores its pipe-separated legacy type string in field `[7]`; the map currently displays those terms as one flat list. Keep that field intact during category migration. The appended fields are:

- `[14]` normalized setting, or `null` when unsupported
- `[15]` normalized access, or `null` when unsupported
- `[16]` normalized features as an array of contract values
- `[17]` provenance and review metadata, including source, evidence URL/ID, and review status

The persistent DiveAtlas ID remains in `[12]`; retired IDs remain in `[13]`. The appended fields must not shift or overwrite either identity field. The app may continue displaying the legacy field until its category UI is deliberately migrated.

Generate a review queue for records whose field `[7]` and reviewed metadata are blank:

```powershell
python docs/export_dive_site_category_review.py
```

The default output is `artifacts/dive-site-category-review.csv`. Each row includes the stable DiveAtlas ID, site name/location, listed source names, empty normalized fields, and columns for evidence and review status. Fill categories only after checking a source record; record the source and URL or source ID. Use semicolons to separate multiple `features`. Allowed settings are `marine`, `lake`, `river`, `spring`, `pool`, and `quarry`; allowed access values are `shore`, `boat`, and `both`. Leave unsupported fields blank and keep records with unresolved evidence marked `unreviewed` or `needs-source-review`.

The CSV is a working review queue. Reconcile reviewed values by stable ID, preserve field `[7]`, and retain per-record source provenance in field `[17]`. The current source list alone (`osm | padi | ssi`) is not enough to verify a particular category value. For the reviewed category import, the owner defines upstream `review_status=needs-source-review` as reviewed; preserve that literal upstream value in provenance while storing `status=reviewed`. Rows marked `unreviewed` remain untouched.

The reviewed import can be reproduced with:

```powershell
python maintenance/migrate_dive_site_reviewed_categories.py --apply
```

Run without `--apply` to preview counts without changing the dataset.

Evidence URLs and source-record IDs in field `[17].evidenceUrlOrId` should be
unique within each site record. Keep the first spelling of a repeated
reference and preserve the complete `evidenceSource` provenance. The same
reference may appear on different sites when it supports each site's record.
Audit and clean existing rows with:

```powershell
python maintenance/dedupe_dive_site_references.py --apply
```

Run without `--apply` to review the affected site count first.
