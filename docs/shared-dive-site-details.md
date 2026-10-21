# Shared dive-site detail page

`/dive-site.html?id=<site-name>-<persistent UUID>` displays a dive site using one shared HTML
shell and one small public JSON record. The shell, CSS and browser scripts live
beside `index.html` in GitHub. Production records live in the existing R2 data
release, outside GitHub Pages. No new Worker or database is required.

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
conversion, sharing, monthly conditions and rating modules. These modules start
after the record arrives because they inspect the page at startup. Missing fields
are omitted, illustrative photos remain labeled, and failed requests present a
retry action. Regional discovery cards are bounded to eight sites; they do not
claim nearest distance or matching ratings.

## Publish cloud data before deploying the page

Use the existing cloud release workflow, with its credentials in the process
environment. Do not commit generated records or credentials. Replace the example
release ID and asset URL with the active release configuration.

```powershell
npm run build:site-details
python tools/stage_data_release.py --release RELEASE_ID --dive-site-details-only
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
requires a detail record in the release so a page-only deployment cannot silently
enable links to missing data. R2 must allow anonymous cross-origin GET requests
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

Browser contracts cover two IDs sharing one shell, configured cloud URLs, theme
controls, chart startup, regional navigation, invalid IDs, missing records,
wrong-ID responses, retry recovery and escaped content on desktop and mobile.
They isolate record loading from environmental data availability. Verify an
actual published record and environmental data separately before claiming live
deployment success.
