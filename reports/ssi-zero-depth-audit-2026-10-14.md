# Review of SSI zero-depth records

**Review date:** 2026-10-14  
**SSI snapshot:** the public MyDiveGuide harvest dated 2026-06-22, recorded in the local source-evidence bundle.  
**Scope:** the 58 harvested SSI records whose raw `maxDepth` is the string `"0"`.

## What the source data says

The zero appears to be a missing/default value in the public SSI profile snapshot, not a measured depth of zero: these 58 profiles are only 58 of 10,820 harvested SSI profiles, and many have site descriptions that independently report nonzero depth features. The evidence does **not** show whether SSI stored zero or the third-party harvesting/mapping step introduced it. The reliable correction at the data-model level is to treat the raw zero as unknown unless a site-specific source supplies a usable value.

Fifty-seven of the 58 SSI records match a stable DiveAtlas site UUID. One record, **kompleks Sukan Setiawangsa**, is not matched; Malaysia’s stadium authority identifies it as a pool ranging from 1.5 m to 5 m. This pool depth is not a missing DiveAtlas site match.

The `diveatlas_depthMid_before_m` column records the canonical midpoint before this update. The `applied_depth_*_m` columns show the values now supplied by the UUID-keyed override file, with the result each popup displays.

## Interpretation rule

The audit keeps four kinds of numbers separate: a site’s reported maximum, a reef/wall/feature contour, a typical route or training depth, and a pool’s physical depth. Seabed bathymetry, a pool length, a freediving line label, or a wall descending beyond 40 m is not automatically a safe scuba limit. “No single value” and “unknown” are intentional findings.

- **High confidence:** exact-site operator/official facility source gives a numeric depth.
- **Medium confidence:** exact SSI-linked profile gives a number or contour, but it is not independently surveyed or is a feature rather than a limit.
- **Low confidence:** source does not match the point unambiguously, is a secondary catalog, or identifies a facility without depth.
- **Unresolved/conflicting:** no defensible scalar, site identity needs confirmation, or sources disagree.

## Useful site-specific leads

- **Trabaan Pier:** local operator text reports 3–5 m on average and 6–7 m at spring tides. [SSI profile with Atlantic Scuba Adventures’ site description](https://www.divessi.com/en/mydiveguide/divesite/trabaan-pier-ireland-423238)
- **Baja Loca:** SB Divers’ profile says the site reaches 22 m. [SSI/ScubaGo profile](https://www.scubago.com/id/explore/divesite/baja-loca-402555)
- **Vaagali South:** DivePoint Rannalhi lists a 5–20 m range. [Operator dive-site sheet](https://divepoint-maldives.com/wp-content/uploads/2024/01/All-dive-sites-Rannalhi-compressed.pdf)
- **Mitsubishi G3M “Nell”:** DIVE Munda describes the wreck at about 6 m. [SSI/ScubaGo profile credited to DIVE Munda](https://www.scubago.com/id/forward-mdg/divesite/mitsubishi-g3m-nell-wreck-solomon-islands-285707)
- **Sète sites:** the local École de Plongée Sétoise gives Les Patates’ bottom at 14 m and Quilles Sud’s maximum at 10 m. [Operator site list](https://epsetoise.com/les-sites-de-plongee/)
- **Morro d’en Feliu:** operator ZOEA Mallorca lists 5–30 m. [Operator site page](https://zoeamallorca.com/en/morro-den-feliu/)
- **Old Wreck Head:** current PADI page says 5 m, while the local June 2026 PADI Travel evidence snapshot says 55 ft / 16.76 m. Keep this unresolved until the contributed record is corrected or confirmed. [Current PADI page](https://www.padi.com/dive-site/cayman-islands/old-wreck-head/)
- **Sohugan:** SSI’s profile says the rock rises from a seabed around 2,500 m deep; JMA describes the volcanic pinnacle. Neither is a scuba dive maximum. [SSI profile](https://www.divessi.com/en/mydiveguide/divesite/sohugan-japan-290292) · [JMA volcano sheet](https://www.data.jma.go.jp/vois/data/filing/souran_eng/volcanoes/069_sofugan.pdf)
- **Snorkeling-only listings:** Antikoufo, Asprokavos and Castle Toroni are presented as protected snorkeling areas. A scuba depth limit does not apply to those SSI entries. [Asprokavos profile](https://www.scubago.com/en/explore/divesite/asprokavos-snorkeling-888962) · [Toroni snorkeling guide](https://www.visit-halkidiki.gr/portfolio-view/snorkelling-in-toroni/)

## How to use the row-level file

The adjacent CSV contains all 58 SSI IDs, stable DiveAtlas UUIDs where matched, pre-update values, applied min/max/point depths, source semantics, confidence, and evidence links. The 24 source-backed records now have a numeric point, bound, or range in `datasets/dive-site-depth-overrides.js`; the other 33 matched records have null depth fields and display **Unavailable**. The conflicting Old Wreck Head value was cleared pending resolution. The unmatched Setiawangsa pool remains outside the DiveAtlas site dataset.

The map applies these corrections by stable UUID after loading the original site file. This keeps the harvested snapshot available for provenance while preventing its raw zero defaults from reaching the popup. No bathymetry value or neighboring-site depth was substituted.
