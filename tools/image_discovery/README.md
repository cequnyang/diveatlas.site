# Resumable site-image discovery

This workflow prepares published-site batches, collects metadata and permitted originals from individual Commons File/Category leads, deduplicates historical work, and creates an offline review gallery. It never changes website assignments, coordinates, prior pilots or approval statuses. It makes repeatable collection faster; it does **not** replace visual/identity judgement or provide a global search engine.

## Use

From the repository root:

```powershell
# Offline: verify current published inventory and freeze a bounded batch.
python -B tools/discover_site_images.py prepare --out data/image-discovery-next --limit 100 --minutes 60 --requests 300 --assets 100

# Live collection, explicitly requested by running this command; also resumes the SAME batch.
python -B tools/discover_site_images.py run --out data/image-discovery-next

# Offline output/status; open data/image-discovery-next/index.html.
python -B tools/discover_site_images.py gallery --out data/image-discovery-next
python -B tools/discover_site_images.py status --out data/image-discovery-next

# All tests use mocked endpoints and forbid live sockets.
python -B -m unittest discover -s tools/image_discovery -p "test_*.py"
```

`prepare` never overwrites an existing directory. `run` resumes persisted work and cannot change the frozen selection or reset budgets. A file lock prevents concurrent collectors; an interruption leaves atomic snapshots and durable request reservations. Interrupted requests remain unresolved rather than being silently retried. Each URL has a cumulative retry cap; exhausted or denied work remains visible. Production integration is a separate owner-authorized step.

Shared categories cache the unfiltered first-page file list; each site's names, aliases and explicit parent determine its own candidates. Older checkpoints containing only a filtered `selected` list cannot reconstruct that category. They report that a separate batch is required and do not replay the category request.

Each original attempt, including retries, reserves the full per-original read cap plus one overflow-detection byte against the cumulative transfer budget before dispatch. Completed responses replace that reservation with their actual byte count, including error and `no-store` responses. Interrupted or otherwise unknown transfers retain the full charge, including older request records with unknown byte counts. This conservative bound can stop collection while some nominal byte budget remains; approximate source sizes cannot guarantee a transfer cap.

## Where search leads come from

The current automatic route matches unique published site names/aliases to existing `datasets/area-photos.json` leads, excludes current reviewed/personal assignments, deduplicates earlier hourly-run source files and hashes, and selects a seeded country round-robin batch. This is an operational batch, not a representative sample. Metadata from an old assignment is only a lead, never an approval. Existing captions, coordinates, old scores or distance are not location proof. Parent context is allowed only when explicitly supplied with parent name and documentary evidence; it remains unreviewed.

To supply additional **permitted individual page** leads, use `prepare ... --leads leads.json`:

```json
[
  {
    "site_id": "<actual-published-UUID>",
    "source_page": "https://commons.wikimedia.org/wiki/File:<actual-file-title>.jpg",
    "basis": "exact_site",
    "evidence": "Where the candidate was found and what supports this site's identity"
  }
]
```

Allowed bases are `exact_site`, `alias`, `verified_parent`. A parent lead additionally needs `parent_name`. Category pages are allowed as explicit leads; only the first page is inspected and direct file titles with a site/alias/explicit-parent phrase are ranked. No first-alphabetical default, guessed category, pagination bypass or country-wide automatic assignment. A lack of suitable supplied/local leads is **needs search leads**, not evidence that no photo exists.

The recent research also used manually collected public web-index leads. Those searches are **not automated here**: Commons API/Special search, Openverse and Flickr API remain outside this client's allowlist. A genuinely broader automated search requires a separately permitted search provider/API; this script cannot invent that permission or use a browser/proxy/alternate host to replace a denial.

## Access and budgets

The identifying client remains `DiveAtlasImageCoverage/0.1 (+https://diveatlas.site; AI-assisted local metadata review)`. The transport/robots parser were extracted from the audited November8 collector; default source permissions are not broadened. `policy-baseline.json` is historical evidence, **not current provider permission**. Before collection each batch retrieves the three exact official terms/User-Agent/reuse documents through current robots checks and compares their raw hashes or reviewed policy-content fingerprints to that baseline. Fingerprints preserve article text, link destinations, image references and MediaWiki revision IDs while excluding generated server/request/cache metadata. Changed raw bodies must be available in the permitted cache and pass SHA256 integrity checks. Missing/ambiguous articles, substantive content/link/revision changes and unavailable bodies block content collection. Do not refresh the baseline merely to silence a block; real policy changes require review. Robots evidence is fetched for content hosts; uncertainty fails closed. Policy evidence expires after24hours.

Only HTTPS Commons File/Category URLs and original upload URLs extracted from permitted File pages can be dispatched. Redirects are not followed;401/403/429 halt the provider without retries. No paid endpoints, accounts, credentials, contact or provider bypass. Policy bootstrap reserves16 requests before sending; actual counts and elapsed time persist. Defaults: at most300 total HTTP requests including policy/robots/retries/assets,60 cumulative collection minutes,2second serial spacing,4 file pages/site,100 retained originals,18MB/original and750MB original-transfer cap. The CLI restricts batches to200 sites,650 requests and170 assets. Resume does not restore spent budget. Original transfers and orphan asset counts are reconciled from the durable log/files on restart.

Original creator, compatible exact CC0/BY/BY-SA licence/version, dimensions, approximate size and source-linked original URL are checked **before** original dispatch. NC/ND/ARR/missing evidence, conflicting coordinates and obvious map/diagram captions are held. A compatible licence label is not proof of ownership, upstream permission or suitability. Originals are validated by format/dimensions, exact SHA256-deduplicated, and reviewed previews are resized/EXIF-oriented only. `no-store` responses are not cached; `no-store` originals are not retained. Caching, conditional requests, rate controls and bounded retries follow the extracted guard; unsupported robots syntax blocks rather than guesses. No automated visual/hero approval.

## Outputs and review

Each new run contains frozen `plan.json`/`freeze.json`, historical file ledger, append-only `requests.jsonl`, SQLite request counters, atomic `state.json`, metadata/evidence, permitted original assets, previews, combined `manifest.json` and offline `index.html`. Every selected site retains an outcome. Candidate fields separately record identity, visual usefulness, licence evidence, human review and publication authorization. All newly collected candidates remain unresolved/not reviewed/NOT_AUTHORIZED. Verify original sharpness and desktop/mobile crops, exact-versus-context identity, attribution and source-chain rights before adopting anything. No-result cases are bounded-route outcomes, not catalogue coverage estimates.

No raw dataset is sent to a provider. Public source URLs are the only content targets; data, cache, policy bodies, inventory and logs stay inside the ignored run directory. Do not add those directories to Git automatically. Keep public-source metadata separate from original private datasets when sharing a review package.

## Local prerequisites and verification

Use the existing repository, local datasets/public pages, `tools/generate_seo_pages.py` and prior source evidence where available. Tested on Windows/PowerShell with Python3.11. The installed versions used for the smoke run are pinned in `requirements.txt`; if needed, install them with `python -m pip install -r tools/image_discovery/requirements.txt`. This task did not install anything.

Implementation verification:29 offline tests passed, including full mocked metadata-to-original-to-gallery collection and a no-replay resume; denied API/provider paths, robots failures, redirects,429, no-store, retries, budgets, licence exclusions, dimensions-before-download, frozen-plan changes and changed policy evidence. The20-site demo was prepared from the verified18,813 raw /16,571 published inventory with **zero live requests**. A live collection run of this extracted command has not yet been performed; prior-pilot live results do not substitute for that check. No new source route or current provider permission is claimed.

## Diagnosing a stopped policy check without requests

`python -B tools/discover_site_images.py check-policy --out data/image-discovery-next` compares already saved policy responses, writes `evidence/policy-content-verification.json`, and makes zero requests. The November8 real response pair had identical Terms of Use and User-Agent articles/revisions but different generated server/cache bytes. Regression tests cover both that benign case and substantive changes. The frozen plan, original body hashes, logs, counters and route restrictions remain unchanged. After a successful check, use the ordinary `run` command to resume the same batch; do not delete the directory or reset budgets. Failed checks print a concise safe-stop message rather than an unnecessary traceback.

## Validated new discovery source: DBpedia

`dbpedia.py` queries DBpedia's own documented public entity SPARQL service. Current robots allows `/sparql`; no account/key or charge is required. Only internally generated exact-label queries are permitted. It checks partial-result headers, serial pacing/robots delays, a shared request counter, redirects/denials and a provider circuit. It parses indexed Commons filenames without requesting Special:FilePath or a Wikimedia search API. Each image still requires the existing individual File-page/original guard and individual rights/identity review. DBpedia is a Wikimedia-derived metadata index, not an independent image collection or a media licence.

The frozen evaluation is `data/image-search-source-evaluation-20261108/plan.json`; resume/reproduce checkpoints with `python -B data/image-search-source-evaluation-20261108/scripts/run.py`. Its20 searches are already complete; resume will not replay them or reset the budget. Results:8 source-supported photos for8 sites (4 main-image review candidates,4 supporting-only),4 HTTP500 search failures, no production assignment. See its REPORT.md and review-package/index.html. Do not rerun the old local-lead100-site batch expecting it to use this provider: that frozen plan remains unchanged. The main CLI still defaults to the historical-lead route; this new provider has only this20-site evaluation authorization, not an unattended inventory rollout.

DBpedia API/metadata use evidence: https://www.dbpedia.org/resources/sparql/ . Metadata attribution/licence: DBpedia/Wikimedia contributors, CC BY-SA3.0/GFDL; linked images retain their separately recorded creator/licence. No query is sent to denied Commons/Wikidata/iNaturalist search endpoints. Future batches need separately frozen sites, queries and limits and an exclusion ledger including this evaluation's new source files. The prototype's generic map/SVG prefilter and CC-URL-only parser need improvement before expansion; IGO/public-domain variants are held rather than silently approved.
