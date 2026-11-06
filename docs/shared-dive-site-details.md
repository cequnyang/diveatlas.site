# Shared dive-site detail page

`/dive-site.html?id=<site-name>-<persistent UUID>` displays a dive site using one shared HTML
shell and a public JSON record. The shell, CSS and browser scripts live beside
`index.html` in GitHub. Production detail records and the full public recommendation
catalog live in the existing R2 data release, outside GitHub Pages. The catalog
uses a small manifest and 512 KiB maximum JSON shards; the browser loads every
shard before ranking so results still cover the full catalog. No new
Worker or database is required. The refreshed catalog uses a versioned `/v2/`
path so it can be added to the active immutable R2 release without replacing the
old catalog or detail records.

At the current catalog size, this produces roughly 14 shard requests. The browser
waits for all listed shards before ranking, so the full recommendation catalog
remains available to each filter.

The location hierarchy below a dive-site title links each recorded geography to
`/regions/`. That static browse page reads the generated
`/regions/area-index.json` from GitHub Pages and lists all public detail records
in the selected area, independent of the smaller SEO page pilot. Its search and
pagination operate over the complete area membership list; no additional R2
release is needed for the browse index.

This implements the browser-rendered option discussed in the design. A browser
Web Worker is unnecessary: ordinary JavaScript fetches the record and builds the
DOM. Cloudflare Workers rendering HTML before delivery would be a separate
implementation if every new URL needs search indexing and rich link previews.

## Preview and use

```powershell
npm run build:site-details
python -m http.server 8765 --bind 127.0.0.1
```

Open `/dive-site.html?id=tapor-tamiyam-cape-kri-raja-ampat-<UUID>` on that server.
The map popup's **View dive-site details** link supplies the name and persistent
ID. Related-site cards use the same shared page. Older links with only the UUID
continue to open and update their address to include the current English site
name. The UUID suffix selects the record; the readable prefix is generated from
the displayed site name. `npm run build:auth-preview` also generates and bundles these records in
`_site` for local testing; production builds omit the records when
`DATA_ASSET_BASE_URL` is set.

The page retains existing photo preview, language and theme controls, unit
conversion, sharing, monthly conditions and rating modules. Its recommendation
rail uses the same All, Nearby, Rating, Features and Difficulty filters as the
generated `/dive-sites/<slug>/` pages. The catalog includes every public detail
record with a non-empty name, unique stable ID and valid coordinates, independent
of the SEO page limit and its stricter content threshold. The exporter splits this
catalog into size-bounded shards so no recommendation file becomes a single large
download. The browser ranks category recommendations across that full catalog and
runs the more expensive Rating comparison only when that filter is opened. If the
catalog is unavailable, the detail record's small regional list remains as a fallback.
These page modules start after the record arrives because they inspect the DOM
at startup. Missing fields are omitted, illustrative photos remain labeled, and
failed detail requests present a retry action.

The language menu localizes fixed detail-page copy, accessibility labels, rating
and recommendation controls on both the shared page and generated SEO pages.
The rating-card logo lockup stays exactly `diveAtlas Rating` in every language.
Site names and summaries continue to use their separate translation catalogs;
unrecognized site and source values stay as recorded, while known normalized
category terms use the detail-page vocabulary. Traditional Chinese currently
reuses the Simplified Chinese translation mapping.

## Publish cloud data before deploying the page

Use the existing cloud release workflow, with its credentials in the process
environment. Do not commit generated records or credentials. Replace the example
release ID and asset URL with the active release configuration.

```powershell
npm run build:site-details
python tools/stage_data_release.py --release RELEASE_ID --dive-site-recommendations-only
./tools/upload_r2_data_release.ps1 `
  -ReleaseDirectory data/.build/r2/releases/RELEASE_ID `
  -AssetBaseUrl https://assets.diveatlas.site/releases/RELEASE_ID/ `
  -AppOrigin https://diveatlas.site -AppendExisting
python tools/verify_r2_data_release.py `
  --asset-base-url https://assets.diveatlas.site/releases/RELEASE_ID/ `
  --app-origin https://diveatlas.site --startup-assets-only --require-site-details
```

Staging refuses to overwrite an existing local staging directory. If that release
was already staged, use `--releases-directory` with a separate staging parent,
then pass its `RELEASE_ID` directory to the uploader. Upload is additive and
refuses to overwrite published records. Future record revisions must use a new
release or a new versioned data directory and matching browser path.

After public data verification passes, deploy the GitHub Pages changes using the
existing workflow and its `DATA_ASSET_BASE_URL` variable. The deployment check
requires both a detail record and the shared recommendation manifest with every
listed shard in the release so a page-only deployment cannot silently enable links
or filters without their data. R2 must allow anonymous cross-origin GET requests
from the site; no browser credentials are sent.

The exporter shares the map/static generator's photo and published-summary
selection. It writes an explicit allowlist of public fields, excluding internal
review notes and source filenames, and rejects duplicate IDs and invalid
coordinates. Direct detail access allows sparse records; it does not apply the
stricter eligibility threshold used to publish an indexed SEO page.

## Existing links and search

Existing `/dive-sites/<slug>/` pages remain available during migration. No old
pages, canonical tags, sitemap entries or indexed addresses are removed. New
ID-based pages use `noindex,follow` so the generic HTML shell and failure states
do not compete with those indexed pages. JavaScript sets a per-ID title,
description, canonical URL and Place record after loading. Services that do not
execute JavaScript will see generic metadata. Complete removal of the old pages
requires a separate redirect and indexing migration; this change does not claim
that migration is complete.

## Verification

```powershell
python -m unittest tests.unit.test_dive_site_details -v
node --test tests/unit/dive-conditions-service-metadata.test.js
npx playwright test dive-site-detail.spec.js
```

The Node metadata test is maintainer-only and excluded from the Git checkout; the Python and browser tests above are available in the repository.

Browser contracts cover two IDs sharing one shell, configured cloud URLs, theme
controls, chart startup, regional navigation, invalid IDs, missing records,
wrong-ID responses, retry recovery and escaped content on desktop and mobile.
They isolate record loading from environmental data availability. Verify an
actual published record and environmental data separately before claiming live
deployment success.


## Conflicting records and identity reviews

Detail exports and indexed-page generation use `tools/dive_site_record_policy.py`.
The browser also enhances older indexed pages from the exported record, avoiding a
rewrite of the entire published page tree. If that record is unavailable or from
an older release, legacy single-level badges become explicitly unverified.
The shared page and new static builds display all recorded experience labels;
these labels are reports, not independently verified suitability. Difficulty
recommendations compare complete normalized label sets, and search filters match
any individual recorded level. No depth-based difficulty inference is made.

Each public record retains structured `observations` and readable `evidence_notes`.
Imported flattened depth fields have `meaning: "unknown"`, even if their field
names contain min/max: that schema alone does not establish what a source measured.
Reviewed observations may explicitly use `maximum` or `typical`. Values remain
separate; neither conflicts nor differently defined depths are averaged. Source
URLs and retrieval dates remain null when missing. A snapshot date is a separate
fact and never becomes an invented retrieval date. Provider directory homepages
are no longer manufactured as record citations. Public exports exclude internal
review notes and source file names.

`tools/dive_site_record_reviews.json` holds additive field evidence and explicit
identity decisions, independently of raw datasets. Entries in `identities` require
`site_ids`, `status` (`candidate`, `distinct`, or `confirmed`), and a review `reason`.
A confirmed entry additionally requires an `evidence` list and a `canonical_id`
that belongs to the group. Overlapping confirmed groups and missing IDs fail the
build. Add language names to retained observations or imported aliases. Confirmed
views retain every observation and all names as searchable aliases. Old UUID
endpoints remain addressable with canonical metadata; existing indexed slugs stay
available. Catalogs publish one entry per confirmed identity and recommendations
exclude every member of the current identity, including rating candidates. The
rating calculation is unchanged.

Name similarity and proximity are review hints only. They never confirm an
identity; the historical retired-ID field is also insufficient because earlier
imports used heuristic deduplication. Candidate differences are explicitly labeled
as differences between separate records, not established same-site conflicts.
A `distinct` review keeps the records separate. Do not rewrite imported datasets
to express any of these review decisions.

The Antonio Gaudi pair remains a candidate. Local evidence in
`artifacts/dive-site-all-source-review-evidence-v147.csv` retains SSI record 257960,
its exact source coordinates, the 2026-06-22 third-party snapshot, `maxDepth: 26`
and all three levels. The corresponding local harvest originals are
`artifacts/divesites-harvest-sites_ssi.geojson` and
`artifacts/divesites-harvest-details-sites_ssi.json`. The Japanese imported row
retains 37 m, Advanced, cave and its romanized alias; its direct OSM identifier,
URL, retrieval date and depth definition are absent. The checked review export
contains no matching Japanese UUID. Shared identity, route equivalence and the
reason for different depths require human review. The live SSI page was consulted
but its accessible text did not expose those profile metrics, so it does not
independently verify the snapshot or establish the relationship.

Run `python -m unittest tests.unit.test_dive_site_details -v` and
`npx playwright test dive-site-detail.spec.js` for focused regression coverage.
`npm run test:interactions` remains the aggregate check, with
`npm run check:dataset-paths` as the separate dataset policy gate.

The importer now emits `identity_candidates` with both stable IDs for nearby
same-name pairs and retains both complete rows. It never invokes the previous
field-merging path. Review those hints before adding identity decisions. Existing
published `evidenceNote` conflict text and source retrieval dates are carried into
the public evidence section; missing dates stay unknown.


### Provenance and compatibility validation

Summary-v2 compact source arrays are `[label, url, referenceId, claims?]`.
The third item is never a retrieval date. The decoder retains the declared
`sourceDefaults`, explicit dictionary citations, reference IDs, claims and
limitations in public `source_provenance`. Dates supplied by that metadata are
labeled as recorded retrieval dates, not new fetches or independently verified
dates. For example, the summary snapshot defaults declare 2026-06-22, while the
separately inspected SSI observation retains that date as a snapshot date and
leaves its own retrieval date unknown. Category references retain their scope;
they do not authenticate the imported depth or experience fields.

Review references to missing or ambiguous IDs fail closed even in the default
repository configuration. Confirmed groups require nonempty evidence lists;
pairwise contradictions are rejected in either order, including contradictions
between different aliases of an already confirmed identity. Distinct decisions
remain public. Reviewed observations and citations use explicit public field
allowlists, and raw experience wording is retained separately from search tokens.
Typical and maximum depths are different measurements, not a conflict merely
because their numbers differ. Unknown depth semantics are not comparable.

The exporter keeps each original source-row UUID endpoint and combines source
citations without overwriting member observations. Shared old-UUID links render
the confirmed canonical identity, preserve other query parameters and fragments,
and survive reload. Canonical IDs also own map/contribution links. Unconfirmed
metadata cannot redirect an old ID. Static aliases retain their original slugs;
canonical and alias pages may share metadata without failing duplicate checks.
If the canonical member is outside the SEO content gate or publication limit,
the alias canonical points to its valid shared UUID endpoint instead of an absent
static page. No historical retired UUID is treated as confirmed solely because
it appears in the heuristic retired-ID field.

Already generated indexed pages refresh existing evidence, category citations
and canonical identity metadata when newer exported evidence is available.
Explicit identity URL membership removes their old self-recommendation links,
including cards added later. If the data request fails, existing server-rendered
evidence is retained. These compatibility checks do not use names or coordinates
to infer identity and do not modify the rating calculation or map failure logic.

The browser presents provenance in a native, initially collapsed disclosure. A short localized source-details line stays visible, with an unresolved marker when applicable. The full explanation and source records appear inside the disclosure. Generated explanations and field labels follow Chinese/English selection; source names, raw experience labels, URLs, IDs, dates and numeric values are retained. Switching back to English restores the original notes. An untyped depth is omitted from the compact facts only when that same value has an explicitly recorded maximum or typical meaning; both observations remain in the evidence. Unknown depth meanings use the shared info icon and an overlay tooltip, without changing the fact grid layout.

## Shared glass controls

`assets/liquid-glass.css` owns the translucent material for header search, mobile photo upload, footer social buttons, and the monthly-rating popup in both themes. `assets/seo.css` imports it for generated and shared detail pages and browse headers; the map entry point loads it directly. All use the same tokens. Component styles retain sizing, placement, icons, and focus behavior.

To reuse the material, add `class="glass-surface"` to a control or its decorative surface, then supply its dimensions, radius, text color, and keyboard focus indicator in the component stylesheet. For example: `<button class="glass-surface my-control">Explore</button>`. Keep labels fully opaque; apply glass to the surface rather than setting opacity on the whole control. Current legacy controls are explicitly mapped in the shared stylesheet so their markup and event handlers remain intact.

Adjust the `--glass-*` tokens there to refine the material across controls. The tint remains when backdrop blur is unsupported. Default controls use opaque panels and no blur under reduced-transparency preferences. The explicitly tuned detail photo and chart surfaces retain their requested tint, and the chart retains its requested blur. Reduced-motion preferences disable material transitions. This is a CSS interpretation of Apple’s material guidance, not native optical refraction.

The shared top-bar layout, lifecycle, and build coverage are documented in [Shared site header](shared-site-header.md).
