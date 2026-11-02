# Ocean missing-data estimation guide

## Purpose

This guide defines when a missing ocean dimension may be estimated for Dive Experience scoring. The goal is to recover defensible coverage without turning absent, invalid, or failed data into invented measurements.

## Classify the gap first

Keep these states separate:

- **Measured zero:** the source explicitly reports zero; preserve it as a value.
- **Missing source cell:** the source has no valid value at the requested location/time/depth; consider only a documented estimator.
- **Land or non-ocean cell:** do not estimate an ocean condition or paint an experience score.
- **Technical failure:** a request, decode, or service failure is not environmental missingness. Retry or report the failure; do not trigger an estimate from it.

## Estimation sequence

1. Use the direct, valid source value matching the requested dimension, month, depth, and units.
2. Apply only that source's documented native-grid or nearest-cell fallback, within its existing supported distance.
3. If that produces no value, allow a dimension-specific regional estimate only when its method and support limits are documented and validated for the relevant ocean regions and season.
4. Estimate the raw environmental measurement first, then apply the existing dimension score rubric. Never estimate a score directly.
5. If the estimate lacks compatible, independent support or falls outside validated limits, leave the dimension unavailable. Do not substitute zero, a global average, or a value borrowed from an incompatible season/depth.

## Evidence and confidence

Every estimated value must retain provenance, source/version, requested and sampled coordinates, distance, month/depth, method, support count or effective support, and validation status. Label estimates in the inspector. Set evidence and spatial support based on source quality and validated applicability. Confidence may decrease for weaker or more distant support; the dimension score is determined by its estimated raw value and the existing rubric. Confidence must not be applied again as a score penalty.

Do not count nearby cells from the same gridded product as independent sources. Do not count an estimate derived from another estimate as new evidence. Keep score confidence separate from score completeness.

## Validation and release

Before a regional method is enabled in production, evaluate it with spatially blocked holdouts that prevent nearby train and test cells from leaking information. Report error, bias, coverage, and error versus distance, with relevant seasonal and regional breakdowns. Set the maximum distance and minimum support from those results rather than convenience.

Until the method passes that validation, it may run in an analysis-only comparison but must not affect published map scores. Preserve previous runtime packages when publishing a scoring or estimation-policy change.

## Current water-temperature policy

- Production uses the nearest valid WOA23 monthly 5 m cell within the existing 25 km support limit.
- The Water TEMP map may render nearby same-month, same-depth WOA23 cells within 25 km over missing pixels, but only on bathymetry-mask-confirmed ocean pixels. These map-only fills are drawn with lower opacity so they remain visibly distinct from original source-grid values; they do not establish additional independent evidence or extend the score sampler's radius.
- A missing or invalid WOA23 cell beyond that supported limit remains unavailable in production.
- The nearest same-month, same-depth WOA23 value within 100 km may be evaluated as an analysis-only regional estimate. It is not production-supported until the blocked validation above is completed.
- If enabled after validation, the sampled temperature is scored with the documented temperature rubric, marked as an estimate, and assigned confidence according to its validated spatial support. It does not receive an extra score discount.
