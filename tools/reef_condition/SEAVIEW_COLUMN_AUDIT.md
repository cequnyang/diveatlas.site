# Seaview benthic table audit

## Dataset and legal status

The local pilot reads the University of Queensland release **Seaview Survey Photo-quadrat and Image Classification Dataset**, DOI [`10.14264/uql.2019.930`](https://doi.org/10.14264/uql.2019.930), from the Q1281 `tabular-data.zip` archive. The record was issued in 2019; the associated data paper was published in 2020. The archive used here is 357,966,014 bytes (HTTP `Last-Modified: 2019-12-09`) with locally computed SHA-256 `2954427f0746cc2e3245955f62676066d0c2b94eab17ec87b50286ab0e5bf5c5`. UQ does not publish a checksum for this archive, so the adapter pins the checksum of this observed snapshot.

The dataset record and the peer-reviewed data paper describe the dataset as CC BY 3.0. The UQ dataset guide accompanying the same release says CC BY-NC-SA 4.0. Those statements conflict. The adapter records `license: null` and a review status of `conflicting`; generated records and reports stay under ignored `data/.build/reef_condition/seaview/`. No Seaview derivative is included in Pages, and the Pages verifier rejects a `data/reef-condition/seaview` production path until the license is clarified.

Recommended citation from the data paper:

> Rodriguez-Ramirez, A., González-Rivero, M., Beijbom, O., et al. (2020). A contemporary baseline record of the world’s coral reefs. *Scientific Data*, 7, 355. https://doi.org/10.1038/s41597-020-00698-6

## Source table inventory and field mapping

| Source table / fields | Source meaning | DiveAtlas treatment |
| --- | --- | --- |
| `seaviewsurvey_surveys.csv`: `surveyid` | One survey at a transect at one date; unique event key | Canonical event ID and `provenance.sourceRecordId` |
| `transectid` | Transect location; repeats when the location is revisited | `location.sourceSiteId`; identity remains provider + source ID |
| `surveydate` | Survey completion date, `YYYYMMDD` | Exact ISO day; invalid dates reject the row; blank dates become null |
| `ocean`, `country` | Source region and three-letter country/territory code | Retained as region and country code; no inferred name normalization |
| `folder_name` | Archive folder reference | Audited, not used as site identity or display name |
| `lat_start`, `lng_start`, `lat_end`, `lng_end` | Transect endpoints | Canonical point is the great-circle midpoint; endpoints and the method are retained in provenance |
| `pr_hard_coral` | Survey-level proportional cover of the source group “hard coral” | Multiplied by 100 and mapped to additive `hardCoralCover`; never relabeled “live coral cover” |
| `pr_algae` | Survey-level broad algae group | Excluded; this group includes more than macroalgae |
| `pr_soft_coral`, `pr_oth_invert`, `pr_other` | Other broad survey groups | Audited and excluded from this metric release |
| `seaviewsurvey_labelsets.csv`: `region`, `label`, `func_group`, `label_name`, `merged_label`, `merged_name`, `description_examples` | Regional label definitions and their functional grouping | Used to select only labels with `func_group=Algae` and `merged_label=MALG` |
| Each `seaviewsurvey_reefcover_*.csv`: `surveyid`, `imageid`, `quadratid` | Event, source image, and photo-quadrat hierarchy | Used to retain survey identity and aggregate samples at the documented levels |
| Regional cover `lat`, `lng` | Photo-quadrat coordinates | Audited; not substituted for the transect-level survey point |
| Regional cover label columns | Proportional classified cover for each regional benthic label | Only regional `MALG` classes contribute to macroalgae; proportions are converted to percent |
| `seaviewsurvey_quadrats.csv`: survey/image/quadrat IDs | Relational key table | Audited but not needed by the adapter because the regional cover tables already carry these IDs |
| `seaviewsurvey_annotations.csv` (`quadratid`, `y`, `x`, `label`) | 55.2 million automated image-classification annotations | Not read; it is not needed for source survey hard coral or the derived macroalgae summaries |

The regional macroalgae label codes used by the adapter are:

- Atlantic: `Dict`, `ERHD`, `Hali`, `Lvar`, `MLAG`
- Indian Ocean: `MACR_Cal_H`, `MACR_Fil_A`, `MACR_Fol_O`
- Pacific Australia: `MAENR`, `MALG`
- Pacific Hawaii: `MALGAE`
- Southeast Asia: `MACR_Cal_H`, `MACR_Cal_P`, `MACR_Fil_A`, `MACR_Fol_B`, `MACR_Fol_F`, `MACR_Fol_O`, `MACR_Fol_P`, `MACR_GLOB`

The `Unc` label is an “Unclear” benthic class, not a confidence field. No survey-level confidence estimate or per-survey depth is present in the selected summary table. The guide describes a typical survey depth around 10 m, but canonical depth remains null instead of assigning that general value to every event.

## Metric semantics and aggregation

The source’s survey summary reports **hard coral**, which is the user-facing name retained in the canonical metric. The source material does not justify silently treating it as identical to all sources’ “live coral cover.” The published summary is used directly for this metric.

The source’s main **algae** group is not macroalgae. For macroalgae, the adapter sums only label columns defined by the regional labelset as `MALG` for each quadrat, averages quadrats within an image, and averages image values within a survey. This follows the paper’s documented two-stage averaging, then group aggregation. CCA, EAM/turf, cyanobacteria, broad `pr_algae`, and other algal classes are excluded. No cross-site or cross-event averaging occurs.

Both source cover fields are proportions from 0 to 1. Conversion to percentage is deterministic (`fraction × 100`); numeric zero stays zero, while a missing category makes the affected macroalgae survey unavailable rather than zero. Protocol sample count is the number of parent images used; depth and confidence remain null. There is one photo-quadrat method per event, so this pilot produces no protocol ambiguity.

## Observed local conversion and validation

- 860 source survey rows became 860 canonical events; none were rejected.
- The regional cover files contain 1,082,324 quadrat rows.
- 579 provider-scoped transect sites: 380 with one survey, 140 with two, 36 with three, and 23 with four (maximum four). The 199 repeated sites with at least two dates span 1–1,851 days (median 1,323 days).
- Date range: 2012-09-16 through 2018-06-18; all 860 source dates have day precision.
- The source summary has 22 distinct country/territory codes. The data paper states 23 countries or territories; that discrepancy is retained for follow-up rather than inferred away.
- All 860 events have hard coral and macroalgae values. Hard coral: 0.1–71.1%, median 15.205%, mean 16.676872%; no measured zero. Macroalgae: 0–64.084043%, median 1.060346%, mean 4.255963%; one measured zero. No source values were null or outside the 0–100% range after conversion.
- No dates, source event IDs, source site IDs, or endpoint coordinates were invalid or duplicated. One transect (survey/site ID `20032`, MEX, 2013-08-16) has source endpoint distance 20.714 km, far longer than the guide’s usual 1.5–2.0 km; it is retained and flagged, not silently removed.
- All 579 provider + transect groups resolve uniquely for both metrics using the existing JavaScript temporal resolver. The latest selected event and age are calculated independently for each metric; in this release both are available on every event, so each site selects the same latest survey for both. With reference date 2026-10-03, resolved observation ages are 3,029–5,126 days (median 4,386 days).
- The runtime schema validates all 860 canonical records before the generator writes them. Conversion and compression take 18.282 seconds on the local machine; canonical JSON is 1,536,314 bytes uncompressed and 64,069 bytes gzipped. This is an ignored research artifact, not a production asset. The original measurement dates are not altered.

The source paper describes five broad reef regions, and the local rows are distributed across Atlantic, Indian Ocean, Pacific Australia, Pacific Hawaii, and Southeast Asia. This geographically broad but deliberately selected survey program is not a globally representative sample.

## Reproduction

After placing the official archive at `data/.build/reef_condition/seaview/raw/tabular-data.zip`, run:

```powershell
python tools/reef_condition/seaview_adapter.py
python -m unittest tests.unit.test_seaview_adapter -v
```

The converter reads the survey summary, labelsets, and five regional cover tables directly from the ZIP. It does not extract the raw archive, read the large automated annotation table, download imagery, or write to a production data directory. The fixed source checksum prevents a later, silently changed archive from being treated as this same snapshot.

## Readiness for later scoring

Hard coral cover is technically ingestible and repeatedly observed, but it is not ready for a score: the exact “hard coral” versus “live coral” equivalence needs a source-owner/scientific decision, observations are old, and region-specific classifiers need comparability review. Macroalgae is technically derivable from explicit regional macroalgae classes and has repeat coverage, but it is sparse in magnitude, based on regional labelsets/classifiers, and also old. Neither metric should be weighted or extrapolated from this pilot. Production UI, screenshots, and Pages assets remain blocked pending authoritative license clarification.
