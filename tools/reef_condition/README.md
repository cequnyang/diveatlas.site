# Reef Condition evidence workflows

# Local MERMAID Reef Condition pilot

This research tool verifies how bounded MERMAID public sample-event summaries map into Reef Survey schema v2. It does not run during site builds, does not call MERMAID from the browser, and never writes into production data. The production map view reads only `data/reef-condition/field-observations.json` through the field-observation provider; research snapshots and test fixtures are not runtime fallbacks.

The adapter is separate from the map view and the canonical validator. It retains recognized protocol summaries independently, preserves unsupported protocol names as `other` without interpreting their metrics, records field-level source-to-canonical diagnostics, and uses the existing JavaScript validator before writing any event to the local pilot dataset.

## Snapshot and replay a bounded project sample

The sampler can preserve the SDK-returned MERMAID event objects before adapting them. This keeps protocol summaries and original event fields available for later reproducible schema, temporal resolver, and map-view validation.

```powershell
# Authenticated, project-scoped cursor query; hard cap is 150 events.
python tools/reef_condition/sample_mermaid.py --project-id 827206ee-b6e8-4866-84ec-909fa37e7942 --max-events 150

# Bounded newest-first discovery across all countries; never more than 150 events.
python tools/reef_condition/sample_mermaid.py --global-sample --max-events 150

# Re-run the adapter and canonical validator offline from the saved raw events.
python tools/reef_condition/sample_mermaid.py --replay-snapshot data/.build/reef_condition/mermaid-raw-snapshot.json
python tools/reef_condition/sample_mermaid.py --replay-snapshot data/.build/reef_condition/global-sample-raw-snapshot.json
```

The standard raw snapshot is saved before transformation at `data/.build/reef_condition/mermaid-raw-snapshot.json`. The global discovery snapshot is stored separately at `data/.build/reef_condition/global-sample-raw-snapshot.json`, and its canonical records/report are written under `data/.build/reef_condition/global-sample/`. Snapshots preserve SDK event objects (date values serialized to ISO strings), snapshot version, UTC generation time, provider/source, query parameters, country/project/site scope, event count, and configured cap. Authentication headers and credentials are never copied from the client; snapshot writing rejects recognized credential/header fields. Project and global event queries use the SDK's lazy cursor/next-link iteration, disable retries through the shared client configuration, and stop at the requested cap. Offline replay makes no SDK or network request. The all-country mode is a newest-first discovery sample, not a random or representative sample and not a complete MERMAID export.

## Run the local pilot

Install the pinned SDK, then use either an API key or the SDK's cached OAuth login. OAuth login is a separate, explicit interactive step; the sampler never opens a browser by itself.

```powershell
python -m pip install -r tools/reef_condition/requirements.txt
# Option A: set MERMAID_API_KEY in this PowerShell process, or
# Option B: log in once through the official SDK (opens a browser)
python -c "import datamermaid; datamermaid.login()"

# Run in the same Windows user account and Python environment as the login
python tools/reef_condition/sample_mermaid.py --max-events 30
```

The sampler uses `MERMAID_API_KEY` when present; otherwise, it checks the SDK's cached OAuth credentials non-interactively and uses them only if the SDK can validate or silently refresh them. It never falls back to anonymous access. If neither credential is usable, it stops before requesting data and prints the OAuth login command above. MERMAID documentation differs on whether public summaries require credentials, so this pilot deliberately sends authenticated requests only. The default site-filtered sampler queries Indonesia plus explicit Raja Ampat site-name filters, requests at most 30 events across bounded first pages, disables retries, and retains its 50-event hard ceiling. Project and all-country discovery modes require explicit selection and are capped at 150 events. Both preserve a raw snapshot before transformation and never invoke `.to_df()`.

The local-only outputs are written under ignored `data/.build/reef_condition/`:

- `mermaid-pilot.json` — schema-v2 records that pass the canonical validator, with dataset-level provider, type, generation time, counts, date range, source-site identity coverage, and conservative redistribution metadata.
- `mermaid-pilot-report.json` — counts, candidate ambiguity, rejected events, and temporary transformation diagnostics.
- `mermaid-raw-snapshot.json` — versioned raw source events and safe query metadata for offline replay.

The current Reef Condition UI loads the production field-observation provider only when its tab is opened. It reads `data/reef-condition/field-observations.json`; until a validated production dataset is installed at that path, the layer reports unavailable. Research snapshots and test fixtures are not production fallbacks and remain outside the production data path.

## Mapping notes

- `benthicpit`, `benthiclit`, and `benthicpqt` retain separate hard-coral and macroalgae means/SDs. A missing category key becomes `null`, never zero.
- `bleachingqc` maps only documented colony-condition percentages. Recently-dead colonies remain within bleaching; no disease or generic mortality is inferred.
- Fractional `count_total_avg` values are not rounded into the canonical integer colony count. Missing licenses remain null. A `contact_link` is not treated as a stable event URL.
- Unknown source protocols remain in the canonical event with `method: "other"`, source method name, count, depth, and policy, but their metric payload is not interpreted.
- Event-level MERMAID depth mean/SD are repeated as context on each protocol summary because schema v2 stores depth at protocol level; the diagnostic report retains the corresponding top-level source fields.

## Source references

- [MERMAID Python client: public summary endpoint, lazy paging, page-size behavior, and extra-field preservation](https://data-mermaid.github.io/py-datamermaid/data/)
- [MERMAID Python client authentication: API keys, cached OAuth, and non-interactive credential checks](https://data-mermaid.github.io/py-datamermaid/authentication/)
- [MERMAID Terms of Service: API key, per-protocol data restrictions, and attribution](https://datamermaid.org/terms-of-service)
- [MERMAID protocol sharing policies](https://datamermaid.org/documentation/collect-project-data-sharing)

## Offline tests

```powershell
python -m unittest tests.unit.test_reef_condition_mermaid_adapter -v
node --test tests/unit/reef-survey-condition-view.test.js
```

These tests use synthetic MERMAID-shaped records and never contact the live service.

## Build a local Reef Survey Evidence grid

The offline generator resolves the latest available live-coral observation once per provider-scoped `sourceSiteId`, then summarizes those independent site observations into pointy hex cells using the median. It uses a Lambert cylindrical equal-area projection so a bounded cross-region sample can be compared without enumerating millions of empty grid cells. It writes compressed GeoJSON, SVG graticule previews, and a resolution/coverage report only under ignored `data/.build/reef_condition/`; it does not add a map layer or combine metrics.

```powershell
node tools/reef_condition/build_spatial_evidence.js `
  --input data/.build/reef_condition/global-sample/mermaid-pilot.json `
  --output-directory data/.build/reef_condition/global-sample/spatial `
  --reference-date 2026-10-02 `
  --resolutions-km 2,5,10
```

The input must contain canonical schema-v2 records, each with a stable `sourceSiteId`. The explicit reference date makes `ageDays` reproducible. Each output feature preserves contributing source site and record IDs, observation date range, evidence count, and site count. Null and ambiguous metrics do not create cells; measured zero remains eligible evidence. The report includes event-level metric availability, site-level resolver outcomes, and geographic coverage. The reported empty-area ratio estimates possible cells from the projected site bounding-box area expanded by one cell radius; it is not an estimate of reef habitat or geographic survey coverage.

The 2, 5, and 10 km values are experiment settings, not a selected production resolution. Do not publish these local outputs; validate candidate scale against broader canonical data and actual map views before frontend integration.

## Build metric-independent evidence coverage

This companion generator includes every validated canonical event, whether or not it contains any metric candidate. Events are counted separately from provider-scoped sites; records without a stable `sourceSiteId` still count as observations and are reported with unknown site identity rather than merged by name or coordinates. Each cell preserves site IDs, provider-scoped site identities, and source record IDs. No value or condition score is computed.

```powershell
node tools/reef_condition/build_evidence_coverage.js `
  --input data/.build/reef_condition/global-sample/mermaid-pilot.json `
  --output-directory data/.build/reef_condition/evidence-coverage `
  --reference-date 2026-10-02 `
  --resolutions-km 2,5,10
```

Outputs are compressed GeoJSON, neutral SVG previews, and a JSON resolution report under the ignored local build directory. `observationCount` includes repeated surveys; `sourceSiteCount` deduplicates by provider plus source site ID. Each cell's `oldestObservationDate` and `latestObservationDate` use only dated records, and `ageDays` is measured from the latest date to the explicit reference date (null when there is no dated record). The report's bounding-box empty-cell ratio is a coarse grid diagnostic, not reef or habitat coverage. These files are local research artifacts and must not be published as production assets.

\n