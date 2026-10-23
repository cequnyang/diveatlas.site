# DiveAtlas dive-site detail pages

For the shared browser-rendered page (`dive-site.html?id=<UUID>`) and per-site R2
data publication, see [Shared dive-site detail page](../docs/shared-dive-site-details.md).
The generator maintains individual indexed detail pages, crawlable site and destination directories, and the complete area browser.

The generator publishes factual, server-readable HTML detail pages for every dive-site record that passes the content gate, plus destination pages and a complete interactive area browser. Each indexed page has a canonical URL and source links; the area browser uses a compact generated index so people can browse the full map catalog without loading the map application or its large datasets.

## Generate the indexed catalog

From the repository root:

```powershell
python tools/generate_seo_pages.py
```

The default build writes every indexed site and destination page that passes the content gates, plus `/dive-sites/` and `/regions/` browse pages, a content-hashed `/dive-sites/recommendation-candidates-<hash>.json`, `/regions/area-index.json`, and `sitemap.xml`. To preview a smaller SEO output, pass limits such as `--site-limit 5 --region-limit 2`; those limits only affect that build. The `dive-sites/` and `regions/` trees are generator-owned and are rebuilt on every run; keep hand-authored content outside those directories. Directory pages link to generated pages using ordinary HTML anchors, and both directory URLs and all generated detail and destination pages are listed in the sitemap. The homepage menu links to the site and destination directories in its static HTML. The generator replaces the root sitemap from URLs it successfully writes.

## Inputs and record fields

- `datasets/dive-sites.js`: `window.DIVE_SITES_DATA` row arrays. Field indexes are name `[0]`, latitude `[1]`, longitude `[2]`, depth minimum `[3]`, depth maximum `[4]`, recorded depth when no range exists `[5]`, difficulty `[6]`, site types `[7]`, provider keys `[8]`, country `[9]`, region/locality `[10]`, aliases `[11]`, persistent UUID `[12]`, optional retired UUIDs `[13]`, and reviewed setting/access/features `[14]`–`[16]` when metadata `[17]` has status `reviewed`.
- `datasets/dive-site-photos.js`: UUID-keyed exact-site photo metadata. Only owned personal images with exact location confidence, alt text, and a local WebP asset are eligible; legacy UUIDs are respected.
- `datasets/dive-site-fallback-photos.js`: curated illustrative images used by the map popup when no exact-site photo exists. The generator selects the same feature group and stable image as the popup, keeps the illustrative warning, and shows the photo credit.
- `datasets/area-photos.json`: attributed photo assignments for matched entries in `/regions/area-index.json`. Assignments use a unique source image per area; the browser leaves unmatched entries without a photo instead of inheriting a regional representative. Each card links to the image source and license.
- `datasets/dive-site-summaries.json.gz`: published English site summaries and their references, keyed by persistent UUID. The generator applies the same publication defaults as the map popup.

The SEO page generator itself does not call external APIs, reverse geocoding, map JavaScript, coral snapshots, or tile loaders. Summary text and record-specific source links come from the local published summary and reviewed metadata datasets. The separate area-photo refresh workflow is described below.

## Selection and content thresholds

A site page requires a nonempty, non-corrupt name; a unique persistent UUID; valid latitude and longitude; at least country or region context; coordinates unique across the source dataset; a linked source; and at least three populated content blocks among published summary, recorded depth, difficulty, recorded site features, reviewed setting, and reviewed access. Names, coordinates, aliases, sources, and photos do not count as content blocks: they identify or support a page but do not describe the dive site. Records below this bar remain in the full interactive map catalog but are omitted from SEO detail pages, directories, and the sitemap. Missing facts are omitted from each page instead of being shown as empty fields. Selection sorts by available factual attributes, then by normalized name and recorded location for reproducibility.

Region grouping uses only exact recorded `country` and `region` values. A destination page requires at least 3 site pages that pass the site content gate; smaller groups remain available in the full area browser and do not receive an indexed destination page. When both values exist, its stable path is `/regions/<country-slug>/<region-slug>/`; the country prefix distinguishes same-named regions. If country is absent but a region value is present, the path is `/regions/<region-slug>/`. Destinations are selected by site-page count, then by country and region name.

The generator rejects missing or malformed IDs, invalid coordinates, all records in exact-coordinate duplicate groups, names containing Unicode replacement/control characters, missing location context, missing linked sources, and records below the substantive-content threshold. It never infers a country or region from coordinates. Preview limits do not weaken these quality gates.

## Area photo assignments

Openverse searches default to two result pages; `--openverse-pages 3` searches a third page only when page two is full. The option accepts 1–5 pages and preserves the same license, place-evidence, and duplicate-photo filters.

Run `python tools/generate_area_photo_manifest.py --geo-anchors 10 --expand-existing --broad-title-search --site-name-search --openverse-search` to expand the current 1,620-area photo manifest. The script searches Wikimedia Commons by area and dive-site names, searches near recorded dive-site coordinates, and can query multiple pages of larger Openverse photos under CC BY, CC BY-SA, CC0 or public-domain licenses. It requires location evidence from an exact area-name phrase, a named dive-site phrase, a human-applied Openverse title/tag matching a named part of the area, or a Commons geotag within 10 km of a listed dive site. Generic or homonymous place components require a second local phrase. Openverse-indexed Commons files have their Commons page hashes resolved so duplicates across catalogs are removed. `--no-geotagged` skips coordinate search, `--geo-anchors` accepts 1–10 spatially spread locations per area (default 2), `--broad-title-search` searches area names without a parent qualifier, `--site-name-search` searches listed dive sites (up to 10 per area; default 5), `--openverse-search` adds large-photo searches by area-name components, `--expand-existing` preserves current assignments and searches only areas without photos, and `--refresh` ignores the temporary candidate and geotag caches. Requests use descriptive User-Agents and cache files in the operating system temporary directory so interrupted runs can resume. The manifest stores source-linked thumbnail URLs, creators and per-file licenses without adding image binaries to the repository. Candidates must have an accepted reuse license and attribution, adequate dimensions and an aesthetic-proxy score, and no explicit AI-generation marker. Clear off-topic subjects remain excluded. Underwater and marine-life photos rank ahead of coast and water landscapes, which rank ahead of other regional landscapes and wildlife. The selector tries each area's next-best qualifying image when its top choice is already assigned elsewhere, keeping source photos unique. Unmatched areas stay photo-free rather than inheriting a generic parent image. The aesthetic score is a shortlist proxy, not visual editorial approval; automated candidates still need inspection for beauty, exact subject relevance, and AI-generation indicators. Absence of an AI marker does not prove a file was human-made.

## Slugs and duplicate protection

Slugs are lowercase ASCII produced from Unicode NFKD normalization and punctuation folding. Names with no ASCII transliteration use a stable `site-<UUID-prefix>` fallback. Duplicate names receive recorded region/country context; any remaining collision receives the persistent UUID prefix. Collision detection considers the full eligible candidate set, not the current limit, so expanding the cap does not change existing site slugs. Duplicate coordinates are rejected rather than assigned separate pages. Generated page titles and descriptions are checked for uniqueness before output.

## Page and sitemap output

- `/dive-sites/<slug>/` contains an individual generated dive-site page that passed the content gate.
- `/dive-sites/` lists every generated dive-site page, sorted by recorded country, region, and site name.
- `/regions/` is the area browser. Its expandable Destination pages section retains static links to each generated destination page so discovery does not depend on JavaScript.
- `/dive-sites/<slug>/` contains static title, description, canonical, one H1, recorded facts, optional verified photo, region link and coordinates that open the exact point in Google Maps.
- `/regions/<country>/<region>/` contains an individual generated region page.
- `/regions/<country>/<region>/` includes the generated site count, site links, calculated coordinate bounds, map link and same-country destination links where available.
- `/dive-sites/recommendation-candidates-<hash>.json` is a shared list used only when a visitor opens the rating recommendations. Pages reference it by URL instead of duplicating the full candidate list in every HTML file; its content hash avoids stale-cache mismatches when the published set changes.
- Nearby, feature, and difficulty cards use exact recorded destination groups. Rating comparisons load the shared catalog on demand, then sample up to the 512 geographically closest published sites to keep the interaction bounded.
- `/regions/?area=...` lists all public dive sites matching a recorded continent, subregion, country, or local region. The page supports search and pagination and reads its membership lists from `/regions/area-index.json`; filtered views set `noindex,follow` while the root directory remains indexable and is not added to the SEO sitemap.
- `sitemap.xml` contains the homepage and only the browse/detail URLs successfully generated in that run. It does not add resource files or unsupported `lastmod` values.

Detail pages use the shared `/assets/seo.css` stylesheet and do not load Leaflet, MapLibre, or map data. Their typography, surface colors, blue action color, panel width, corner radius and spacing follow the tutorial dialog in `index.html`; the header uses the same DiveAtlas SVG logo and includes a language selector, persistent light/dark toggle, and Google sign-in link. Language preference is shared with the map; available localized summaries and site names use the existing translation datasets. They present the site name and recorded location, exact-site or clearly marked illustrative photo, published site summary, coordinates, recorded depth, difficulty, reviewed setting/access/features (or the source site type when reviewed categories are absent), aliases, and available linked sources. Coordinates open Google Maps at the recorded point. Missing fields are omitted; summaries are included only when published, and no current-condition claims are generated. A small Schema.org `Place` record exposes only the name and coordinates already shown on the page.

## Review the generated catalog

Review page accuracy, source attribution, duplicate handling, generated output size, and search-engine indexing before deployment. The content gate deliberately leaves sparse records out of the SEO index even when they remain visible in the interactive catalog. Region pages require at least three qualifying site pages to avoid near-empty destination pages. Command-line limits support smaller previews without code edits.
