# Phase 4-11: local baseline and coral evidence readiness

Reference date for age summaries: 2026-10-03. This report records the state of the local checkout and its generated `_site`; it does not change Dive Conditions scoring or Reef Condition semantics.

**Retirement note (2026-10):** Tebbett hard-coral and macroalgae layers and the Reef Survey Evidence coverage overlay were removed from the product after review found they were not suitable for the intended next result. Their production data, adapters, UI wiring, and build pipeline were removed. The historical measurements below are retained only to explain the earlier readiness assessment; they are not active layers or available product data. Seaview remains a separate local-only research feature with unresolved licensing.

## Local full-asset baseline

`npm run build` completed successfully with Tide in bundled mode. The generated `_site` contains 47,066 files totaling 1,166,170,286 bytes (about 1.166 GB). Build time was 142.7 seconds: 44.7 seconds selecting files and 98.0 seconds copying them. Tide contributes 5,907 files / 434,197,817 bytes. The generated `js/tides/deployment-config.js` sets `TIDE_ASSET_BASE_URL` to `null`, so Tide resolves to local assets. `python tools/verify_pages_build.py --output _site` passed; it found no source NetCDF files, forbidden research directories, or Seaview publication paths. It also verified the curated thermal-history, ocean-heat, and benthic production assets. The formerly published bleaching-occurrence source and its evidence-coverage contribution have since been retired.

The prior `_site` was preserved, not deleted, at `data/.build/local-baseline/phase4-11/preexisting-site` before rebuilding. The build and verification did not run R2, upload assets, or change deployment settings. External Tide configuration, staging, upload, and HTTP verification tooling remain present for later use. Cloud deployment remains deferred.

Run the local production-like build from the repository root with `npm run build`, then serve it with:

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory _site
```

Open `http://127.0.0.1:8765/`. Packaged DiveAtlas datasets and Tide do not require a cloud host. The basemap still uses online map tiles and needs internet access.

The local research mode is separate: serve the repository root with `python -m http.server 8765 --bind 127.0.0.1`, then open `http://127.0.0.1:8765/?reefConditionLocalResearch=1`. It requires local research artifacts under ignored `data/.build/`; Seaview remains local-only while its license conflict is unresolved. The generated `_site` excludes its dataset and does not expose the research provider.

## Smoke validation

The full local `_site` was served on localhost and checked with the focused desktop/mobile Playwright suites. At the time, coverage included the major environmental modes, Dive Conditions, Tide, Reef Condition fixtures/unavailable state, reef survey evidence, Tebbett, Ocean Heat History, and Reef Thermal Stress History. The Tebbett and Reef Survey Evidence product layers have since been retired as described above. `critical-contracts.spec.js` additionally exercised Dive Sites, reef/coral overlays, fish observations, contours, and popup interactions.

- JavaScript unit suite: 184 passed; map marker semantics contract passed.
- Python unit suite: 122 passed.
- `_site` focused browser run: 40 passed; one mobile Ocean Heat History run timed out before map initialization. The same test passed when rerun alone. Dive Conditions passed on desktop and mobile against `_site`.
- Source-tree focused browser run: 58 passed; one desktop Dive Conditions test reported that score data was unavailable at `-5, 130`. That failure did not reproduce against `_site`.
- Critical contracts against `_site`: 21 passed, 2 failed. One popup assertion received a Dive Conditions popup where the test expected a Coral grid popup; the other failed while Playwright was collecting trace artifacts (`ENOENT`). These are recorded as existing map/default-view or harness issues; no score or map behavior was changed.

The local Reef Condition Seaview browser check reported 860 events, 579 provider-scoped sites, 579 visible global sites, 86 at a dense local view, 417 ms first activation, and 127 ms metric switching in that test run. The shared bundle was requested once (64,069 bytes compressed) and reused for the metric switch. This is a local development check only, not production availability or global representativeness.

## Dryad RLS Australia gate

**DRYAD SOURCE FILES NOT AVAILABLE**

The expected `data/.build/reef_condition/dryad-rls-australia/` source package is absent. The only Dryad-named CSV in the ignored Phase 4-8 workstream folder is 122 bytes and contains an anti-bot challenge notice, not data. The nearby 646 KB CSV is BCO-DMO dataset 958181, a southwestern Puerto Rico 2018–2020 benthic dataset (its existing report identifies DOI `10.26008/1912/bco-dmo.958181.1`); it is not the requested Australian RLS release. No usable source CSV, README/codebook, R script, or `.neta` file for Dryad DOI `10.5061/dryad.xd2547dwf` was available. No adapter, reconstructed events, Australian coverage counts, 2024 counts, or Dryad UI provider was created.

## Coral evidence matrix

Age estimates use the latest dated eligible record per provider-scoped site and the reference date above. Year- and month-precision source dates are approximate and are not made more precise by this summary.

| Provider | Metric and observed extent | Freshness / repeats | Method and semantic boundary | Rights and status | Readiness caveat |
|---|---|---|---|---|---|
| Tebbett et al. global compilation | Hard coral and macroalgae; 1,336 events, 1,201 derived site identities; 1977–2018; global compilation | 109 repeat sites, maximum 4 events; median selected age 5,573 days (~15.3 years) | 83 publications / six monitoring databases with varied methods; `HardCoral` remains distinct from live coral; `Macroalgae` excludes `TurfBare` | Exact Figshare v1 release states CC BY 4.0; production derivative | Broad historical visualization support; stale and method-heterogeneous for a score |
| Seaview Survey | Hard coral (`pr_hard_coral`) and MALG-only macroalgae; 860 events, 579 transect sites; 2012–2018 | 199 sites repeat; maximum 4; latest-selected age median 4,386 days (~12.0 years) | Image-classifier-derived benthic survey; hard coral is not relabeled live coral; broad algae, turf/EAM, CCA and other groups excluded from macroalgae | Repository/paper says CC BY 3.0; accompanying UQ guide says CC BY-NC-SA 4.0. Conflict unresolved; local-only | Visualization is measurable and repeat-supported, but age, region-specific labelsets, and unresolved rights prevent score admission |
| Dryad Reef Life Survey Australia | Not assessed; no usable source package for the requested DOI was present | No observations reconstructed | The proposed source is a hard-coral `start_cover` / `end_cover` time-couplet dataset, but no source rows were available to verify endpoint identity or consistency | Reported as CC0 in the project brief; no data ingested | Blocked on obtaining and validating the exact official source files; no metadata-derived event counts used |

The prior Tebbett source review and production notes were retired with the adapter and data assets. The [Seaview column audit](SEAVIEW_COLUMN_AUDIT.md) remains because Seaview is a separate local-only research source. Historical Tebbett values in this readiness report describe the earlier evaluation only; no corresponding production dataset or UI is retained.

## Measurement, freshness, and comparability policy

Keep measured value, date/freshness, spatial support, method, provenance, and any future confidence estimate as separate evidence attributes. A historical percentage remains the reported measurement; do not age-correct it into a predicted current value.

Freshness choices:

- **Hard age bands** are easy to explain but introduce arbitrary cutoffs and abrupt changes at each boundary.
- **Continuous decay** avoids steps but needs a defensible half-life or decay constant; otherwise it gives unsupported precision and never fully removes old evidence.
- **Metric/provider-specific freshness rules** can reflect differences among benthic cover, bleaching reports, and other evidence, but require source-specific validation and sensitivity analysis.

For now, the defensible choice is to show exact source date/precision and a plainly approximate age, without applying a score penalty. If a future scoring design needs freshness, evaluate metric/provider-specific rules first and publish their assumptions. No confidence score is inferred here; survey freshness and confidence are separate.

Cross-provider comparison:

- **Historical Tebbett assessment vs a future RLS hard-coral release:** this comparison is retained as research context only. Tebbett's input methods were heterogeneous; the RLS source was unavailable, so no direct comparison was established. Tebbett is no longer integrated.
- **Historical Tebbett assessment vs Seaview hard coral or macroalgae:** this comparison is retained as research context only. Metric labels had some overlap, but source measurement and aggregation methods differed; Seaview remains legally local-only. Tebbett is no longer integrated.
- Do not pool provider rows or deduplicate across sources based only on coordinates, dates, or values. Retain provider/source IDs, citations, and method; any future cross-source matching should be provenance-preserving and reviewable.

Thermal evidence should be one eventual semantic pressure dimension, not two independent score weights. Keep the map products separate: reef-specific NOAA DHW is the preferred coral-relevant accumulated exposure where it is available; broad NOAA MHW history is contextual support/fallback. Neither confirms bleaching or mortality, and their values are not blended.

## Candidate score-input readiness (qualitative only)

These labels are evidence-readiness judgments, not code changes or proposed weights.

| Candidate | Status | Basis and caveat |
|---|---|---|
| Water temperature | READY WITH CAVEATS | Production WOA23 monthly climatology, 1991–2020, 0.25°; broad and consistent, but typical historical values rather than current conditions. |
| Water clarity | READY WITH CAVEATS | Production Copernicus satellite climatology, 2016–2025, ~4 km; recent relative to the other climatologies, but optical coverage/masking and coastal interpretation need to remain explicit. |
| Current | READY WITH CAVEATS | Production GLORYS monthly climatology, 1993–2016; coarse regional flow support cannot resolve local reef passes or channels. |
| Wave height | READY WITH CAVEATS | Production Copernicus WAVERYS climatology, 1993–2020, 0.2°; useful regional context, not local entry or safety conditions. |
| Fish density | NOT READY | Survey observations are not a globally complete census/denominator. Existing outlook summaries are explicitly relative and do not include raw fish density as a complete gridded input. |
| Thermal pressure | READY WITH CAVEATS | Two production historical products exist, but they overlap conceptually. Choose one pressure representation with explicit period, coverage, and freshness rules; never interpret either as biological damage. |
| Coral cover | NOT READY | The former Tebbett source was removed from the product because it was not suitable for the intended result. No sufficiently recent, broadly supported compatible source is currently admitted. |
| Macroalgae | NOT READY | The former Tebbett source was removed from the product because it was not suitable for the intended result. Seaview remains older and legally unresolved/local-only. |

## Recommended next step

**A. Obtain/validate the official Dryad RLS Australia source files.** This directly addresses the missing-input blocker for the only identified recent broad Australian hard-coral lead. After exact source files and their release identity are present locally, first audit pair/couplet endpoints and repeated-survey consistency; do not start score design until the evidence can be checked from the source rows.
