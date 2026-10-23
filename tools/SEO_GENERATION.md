# DiveAtlas dive-site detail pages

For the shared browser-rendered page (`dive-site.html?id=<UUID>`) and per-site R2
data publication, see [Shared dive-site detail page](../docs/shared-dive-site-details.md).
The generator maintains individual indexed detail pages and the complete area browser without publishing directory-level landing pages.

The generator publishes factual HTML detail pages for a capped DiveAtlas search-indexing pilot, plus a complete interactive area browser. The pilot pages are ordinary server-readable HTML with canonical URLs and useful links; the area browser uses a compact generated index so people can browse every public dive-site record without loading the map application or its large datasets.

## Generate the pilot

From the repository root:

```powershell
python tools/generate_seo_pages.py
```

The default build writes up to 100 indexed site pages and 10 pilot region pages, plus `/regions/browse.html`, `/regions/area-index.json`, and `sitemap.xml`. The area index covers every public record with a unique stable ID, valid coordinates, and a nonempty name; the pilot caps do not limit area listings. To preview a smaller SEO output, pass limits such as `--site-limit 5 --region-limit 2`. The `dive-sites/` and `regions/` trees are generator-owned and are rebuilt on every run; keep hand-authored content outside those directories. The generator writes dive-site and region detail pages, but no root `index.html` landing pages for those directories. It also replaces the root sitemap from the URLs it successfully writes.

## Inputs and record fields

- `datasets/dive-sites.js`: `window.DIVE_SITES_DATA` row arrays. Field indexes are name `[0]`, latitude `[1]`, longitude `[2]`, depth minimum `[3]`, depth maximum `[4]`, recorded depth when no range exists `[5]`, difficulty `[6]`, site types `[7]`, provider keys `[8]`, country `[9]`, region/locality `[10]`, aliases `[11]`, persistent UUID `[12]`, optional retired UUIDs `[13]`, and reviewed setting/access/features `[14]`–`[16]` when metadata `[17]` has status `reviewed`.
- `datasets/dive-site-photos.js`: UUID-keyed exact-site photo metadata. Only owned personal images with exact location confidence, alt text, and a local WebP asset are eligible; legacy UUIDs are respected.
- `datasets/dive-site-fallback-photos.js`: curated illustrative images used by the map popup when no exact-site photo exists. The generator selects the same feature group and stable image as the popup, keeps the illustrative warning, and shows the photo credit.
- `datasets/area-photos.json`: attributed photo assignments for matched entries in `/regions/area-index.json`. Assignments use a unique source image per area; the browser leaves unmatched entries without a photo instead of inheriting a regional representative. Each card links to the image source and license.
- `datasets/dive-site-summaries.json.gz`: published English site summaries and their references, keyed by persistent UUID. The generator applies the same publication defaults as the map popup.

The SEO page generator itself does not call external APIs, reverse geocoding, map JavaScript, coral snapshots, or tile loaders. Summary text and record-specific source links come from the local published summary and reviewed metadata datasets. The separate area-photo refresh workflow is described below.

## Selection and content thresholds

A site page requires a nonempty, non-corrupt name; a unique persistent UUID; valid latitude and longitude; at least country or region context; coordinates unique across the source dataset; and at least two available factual attributes among depth (range or single recorded value), difficulty, site type/reviewed categories/published summary, aliases, providers, and an exact-site photo. The default cap is 100. Selection sorts first by number of these available attributes, then by normalized name and recorded location for reproducibility.

Region grouping uses only exact recorded `country` and `region` values. A region page requires at least 3 site pages in the current generated pilot and is capped at 10 groups. When both values exist, its stable path is `/regions/<country-slug>/<region-slug>/`; the country prefix distinguishes same-named regions. If country is absent but a region value is present, the path is `/regions/<region-slug>/`. Regions are selected by site-page count, then by country and region name.

The generator rejects missing or malformed IDs, invalid coordinates, all records in exact-coordinate duplicate groups, names containing Unicode replacement/control characters, missing location context and records below the factual-attribute threshold. It never infers a country or region from coordinates. Missing fields are omitted from page sections.

## Area photo assignments

Openverse searches default to two result pages; `--openverse-pages 3` searches a third page only when page two is full. The option accepts 1–5 pages and preserves the same license, place-evidence, and duplicate-photo filters.

Run `python tools/generate_area_photo_manifest.py --geo-anchors 10 --expand-existing --broad-title-search --site-name-search --openverse-search` to expand the current 1,620-area photo manifest. The script searches Wikimedia Commons by area and dive-site names, searches near recorded dive-site coordinates, and can query multiple pages of larger Openverse photos under CC BY, CC BY-SA, CC0 or public-domain licenses. It requires location evidence from an exact area-name phrase, a named dive-site phrase, a human-applied Openverse title/tag matching a named part of the area, or a Commons geotag within 10 km of a listed dive site. Generic or homonymous place components require a second local phrase. Openverse-indexed Commons files have their Commons page hashes resolved so duplicates across catalogs are removed. `--no-geotagged` skips coordinate search, `--geo-anchors` accepts 1–10 spatially spread locations per area (default 2), `--broad-title-search` searches area names without a parent qualifier, `--site-name-search` searches listed dive sites (up to 10 per area; default 5), `--openverse-search` adds large-photo searches by area-name components, `--expand-existing` preserves current assignments and searches only areas without photos, and `--refresh` ignores the temporary candidate and geotag caches. Requests use descriptive User-Agents and cache files in the operating system temporary directory so interrupted runs can resume. The manifest stores source-linked thumbnail URLs, creators and per-file licenses without adding image binaries to the repository. Candidates must have an accepted reuse license and attribution, adequate dimensions and an aesthetic-proxy score, and no explicit AI-generation marker. Clear off-topic subjects remain excluded. Underwater and marine-life photos rank ahead of coast and water landscapes, which rank ahead of other regional landscapes and wildlife. The selector tries each area's next-best qualifying image when its top choice is already assigned elsewhere, keeping source photos unique. Unmatched areas stay photo-free rather than inheriting a generic parent image. The aesthetic score is a shortlist proxy, not visual editorial approval; automated candidates still need inspection for beauty, exact subject relevance, and AI-generation indicators. Absence of an AI marker does not prove a file was human-made.

## Slugs and duplicate protection

Slugs are lowercase ASCII produced from Unicode NFKD normalization and punctuation folding. Names with no ASCII transliteration use a stable `site-<UUID-prefix>` fallback. Duplicate names receive recorded region/country context; any remaining collision receives the persistent UUID prefix. Collision detection considers the full eligible candidate set, not the current limit, so expanding the cap does not change existing site slugs. Duplicate coordinates are rejected rather than assigned separate pages. Generated page titles and descriptions are checked for uniqueness before output.

## Page and sitemap output

- `/dive-sites/<slug>/` contains an individual generated pilot dive-site page.
- `/dive-sites/<slug>/` contains static title, description, canonical, one H1, recorded facts, optional verified photo, region link and coordinates that open the exact point in Google Maps.
- `/regions/<country>/<region>/` contains an individual generated region page.
- `/regions/<country>/<region>/` includes the generated site count, site links, calculated coordinate bounds, map link and same-country pilot region links where available.
- `/regions/browse.html?area=...` lists all public dive sites matching a recorded continent, subregion, country, or local region. The page supports search and pagination and reads its membership lists from `/regions/area-index.json`; the query-based browser is `noindex` and is not added to the SEO sitemap.
- `sitemap.xml` contains the homepage and only the browse/detail URLs successfully generated in that run. It does not add resource files or unsupported `lastmod` values.

Detail pages use the shared `/assets/seo.css` stylesheet and do not load Leaflet, MapLibre, or map data. Their typography, surface colors, blue action color, panel width, corner radius and spacing follow the tutorial dialog in `index.html`; the header uses the same DiveAtlas SVG logo and includes a language selector, persistent light/dark toggle, and Google sign-in link. Language preference is shared with the map; available localized summaries and site names use the existing translation datasets. They present the site name and recorded location, exact-site or clearly marked illustrative photo, published site summary, coordinates, recorded depth, difficulty, reviewed setting/access/features (or the source site type when reviewed categories are absent), aliases, and available linked sources. Coordinates open Google Maps at the recorded point. Missing fields are omitted; summaries are included only when published, and no current-condition claims are generated. A small Schema.org `Place` record exposes only the name and coordinates already shown on the page.

## Expand after reviewing the pilot

Review page accuracy, source attribution, duplicate handling and search-engine indexing before expanding beyond the initial 100. The current dataset has many more records than this initial batch; having a stable ID and coordinates alone is not enough to justify publishing a thin page. Region pages remain limited to groups with at least three included site pages. Check generated output and repository/static-hosting limits before publishing a larger batch. The command-line limits avoid code edits for routine expansion.
