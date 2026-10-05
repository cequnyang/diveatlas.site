# Dive Experience Outlook

## What it does

Dive Experience Outlook is a monthly map view and location inspector for the expected recreational experience. It combines the existing monthly physical-condition samplers with the current fish-abundance outlook and NOAA thermal-stress history. A user can inspect an overall score, confidence, available-dimension count, key reasons, and the supporting source detail.

## Why it matters

Experience score, evidence confidence, and score completeness answer different questions. They stay separate in the model and UI. Distance to survey observations can reduce evidence strength without directly lowering the experience score. A cell with no ecological support does not receive a combined score; it may still show a separately labeled physical Dive Conditions result.

Fish values are relative categories, not exact global fish density. The available NRMN target is based on positive recorded survey units; missing encounters have not been reconstructed as zero. Thermal stress is historical context and is not evidence that bleaching or coral mortality occurred. The provisional experience labels are not dive-safety categories.

## How to use it

Choose **Dive Experience** in the Layers view selector, choose one of the 12 months, then select an ocean location. The map colors show score and use modest opacity variation for evidence and completeness. The inspector provides:

- the overall score and provisional label when both scoring groups have support;
- confidence and the number of available scoring dimensions;
- deterministic key reasons derived from the available values;
- separate physical and reef/ecological sections;
- expanded source, spatial-support, and temporal details.

The view is enabled by default. Set `window.DIVEATLAS_FEATURE_FLAGS.diveExperienceOutlook = false` before the application initializes to disable it. For local checks, `?diveExperienceOutlook=0` also hides the view. No Outlook module or score data are requested until the view is selected; the selected month is loaded lazily and the two most recently used month grids are cached.

## Scoring configuration

**Scoring map v5:** the production Dive Experience layer uses the versioned `v3` runtime package generated from the seven-dimension model and guides below. Each scored dimension has seven documented stages.

The scoring model uses 100 points across seven dimensions:

| Group | Group weight | Dimension weights |
| --- | ---: | --- |
| Dive conditions / physical experience | 65 | Clarity 20, current 15, waves 15, water temperature 15 |
| Reef / ecological experience | 35 | Reef habitat & coral evidence 15, fish abundance outlook 10, thermal stress history 10 |

Coral Records also remains a zero-weight support field. Observed bleaching and Macroalgae Cover are removed from the scoring bucket. The new dimension is a distinct evidence index: mapped Reef extent share of sampled wet cell and Coral Records relative rank, converted by seven fixed bands per component and averaged equally. It is not percent live cover or reef condition. Both inputs are required. Missing weight is redistributed only within its own group; physical dimensions never inherit missing ecological weight. A combined score requires both groups, the configured minimum active-dimension count, and minimum completeness. With no ecological evidence, the combined result and combined-map cell stay unavailable while the physical fallback can be shown independently when its minimums are met.

Overall labels are centrally configured as Excellent at 85+, Good at 70–84, Fair at 55–69, and Challenging below 55. Physical labels use separate comfort wording (Comfortable, Favorable, Mixed, Demanding). Confidence thresholds are High at 0.75+, Moderate at 0.40+, Limited at 0.20+, and Low below 0.20. Confidence is evidence strength, not a probability. Completeness is displayed as a dimension count.

## Runtime data and rebuild

The previous `v1` and `v2` runtime packages remain available as rollback points. The website loads `data/dive-experience-outlook/v3/`, which contains the guide-aligned scoring weights, monthly grids, and explicit missing-data estimation policy. Temperature beyond the 25 km production support limit remains unavailable until the analysis-only 100 km fallback passes spatially blocked validation; an estimated value affects confidence, not its rubric score.

See the [ocean missing-data estimation guide](ocean-missing-data-estimation-guide.md) for the dimension-specific fallback and validation rules.

After regenerating an accepted analysis prototype, build static spatial support and publish the runtime package, then create the Pages site:

```sh
node tools/build_dive_experience_outlook_prototype.js --map --all-months
node tools/build_dive_experience_support.js
node tools/publish_dive_experience_outlook.js
npm run build
```

These commands require complete local analysis inputs under `analysis/`; they do not fetch new data. The map builder writes analysis output separately, and the publisher consumes its complete 12-month grid into a new runtime version without replacing earlier packages. The versioned manifest records asset sizes and hashes, grid encoding, month coverage, score weights, thresholds, source semantics, and estimation limits. Research inputs and local-only Seaview material are not part of the runtime package.

## Implementation and checks

- `js/dive-experience-model.js` owns group weights, thresholds, support requirements, confidence, completeness, and deterministic reasons.
- `js/dive-experience-outlook-map.js` decodes month/static assets, samples masked locations, and renders reversed-Viridis score tiles with the accepted evidence/completeness opacity function (yellow low, dark purple-blue high).
- `js/dive-conditions-service.js` remains the source for physical-condition sampling and provenance.
- `tools/build_dive_experience_support.js` and `tools/publish_dive_experience_outlook.js` prepare the runtime package.
- `tools/verify_pages_build.py` enforces its production boundary.

Focused checks:

```sh
node --test tests/unit/dive-experience-model.test.js tests/unit/dive-conditions-model.test.js tests/unit/dive-experience-outlook-map.test.js
npx playwright test tests/e2e/dive-experience-outlook.spec.js
npm run build
```

The browser check covers lazy loading, month switching, static ecological values, location/map stability, physical-only fallback, and the rollout flag in desktop Chromium and mobile touch Chromium.
