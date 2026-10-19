# DiveAtlas dive-site detail pages

The generator publishes factual HTML detail pages for DiveAtlas dive sites, plus browseable region indexes. Each page is ordinary server-readable HTML with a canonical URL and useful links; it does not load the map application or its large datasets. This provides a direct landing page for people searching for a named dive site and a calmer, focused way to review the recorded facts before opening the map.

## Generate the pilot

From the repository root:

```powershell
python tools/generate_seo_pages.py
```

The default build writes up to 100 site pages and 10 region pages, plus both browse indexes and `sitemap.xml`. To preview a smaller output, pass limits such as `--site-limit 5 --region-limit 2`. The `dive-sites/` and `regions/` trees are generator-owned and are rebuilt on every run; keep hand-authored content outside those directories. The generator also replaces the root sitemap from the URLs it successfully writes.

## Inputs and record fields

- `datasets/dive-sites.js`: `window.DIVE_SITES_DATA` row arrays. Field indexes are name `[0]`, latitude `[1]`, longitude `[2]`, depth minimum `[3]`, depth maximum `[4]`, recorded depth when no range exists `[5]`, difficulty `[6]`, site types `[7]`, provider keys `[8]`, country `[9]`, region/locality `[10]`, aliases `[11]`, persistent UUID `[12]`, optional retired UUIDs `[13]`, and reviewed setting/access/features `[14]`–`[16]` when metadata `[17]` has status `reviewed`.
- `datasets/dive-site-photos.js`: UUID-keyed exact-site photo metadata. Only owned personal images with exact location confidence, alt text, and a local WebP asset are eligible; legacy UUIDs are respected.
- `datasets/dive-site-fallback-photos.js`: curated illustrative images used by the map popup when no exact-site photo exists. The generator selects the same feature group and stable image as the popup, keeps the illustrative warning, and shows the photo credit.
- `datasets/dive-site-summaries.json.gz`: published English site summaries and their references, keyed by persistent UUID. The generator applies the same publication defaults as the map popup.

No external API, reverse geocoding, map JavaScript, coral snapshot, or tile loader is used. Summary text and record-specific source links come from the local published summary and reviewed metadata datasets.

## Selection and content thresholds

A site page requires a nonempty, non-corrupt name; a unique persistent UUID; valid latitude and longitude; at least country or region context; coordinates unique across the source dataset; and at least two available factual attributes among depth (range or single recorded value), difficulty, site type/reviewed categories/published summary, aliases, providers, and an exact-site photo. The default cap is 100. Selection sorts first by number of these available attributes, then by normalized name and recorded location for reproducibility.

Region grouping uses only exact recorded `country` and `region` values. A region page requires at least 3 site pages in the current generated pilot and is capped at 10 groups. When both values exist, its stable path is `/regions/<country-slug>/<region-slug>/`; the country prefix distinguishes same-named regions. If country is absent but a region value is present, the path is `/regions/<region-slug>/`. Regions are selected by site-page count, then by country and region name.

The generator rejects missing or malformed IDs, invalid coordinates, all records in exact-coordinate duplicate groups, names containing Unicode replacement/control characters, missing location context and records below the factual-attribute threshold. It never infers a country or region from coordinates. Missing fields are omitted from page sections.

## Slugs and duplicate protection

Slugs are lowercase ASCII produced from Unicode NFKD normalization and punctuation folding. Names with no ASCII transliteration use a stable `site-<UUID-prefix>` fallback. Duplicate names receive recorded region/country context; any remaining collision receives the persistent UUID prefix. Collision detection considers the full eligible candidate set, not the current limit, so expanding the cap does not change existing site slugs. Duplicate coordinates are rejected rather than assigned separate pages. Generated page titles and descriptions are checked for uniqueness before output.

## Page and sitemap output

- `/dive-sites/` links to every generated pilot site.
- `/dive-sites/<slug>/` contains static title, description, canonical, one H1, recorded facts, optional verified photo, region link and coordinates that open the exact point in Google Maps.
- `/regions/` links to every generated region group.
- `/regions/<country>/<region>/` includes the generated site count, site links, calculated coordinate bounds, map link and same-country pilot region links where available.
- `sitemap.xml` contains the homepage and only the browse/detail URLs successfully generated in that run. It does not add resource files or unsupported `lastmod` values.

Detail pages use the shared `/assets/seo.css` stylesheet and do not load Leaflet, MapLibre, or map data. Their typography, surface colors, blue action color, panel width, corner radius and spacing follow the tutorial dialog in `index.html`; the header uses the same DiveAtlas SVG logo and includes a language selector, persistent light/dark toggle, and Google sign-in link. Language preference is shared with the map; available localized summaries and site names use the existing translation datasets. They present the site name and recorded location, exact-site or clearly marked illustrative photo, published site summary, coordinates, recorded depth, difficulty, reviewed setting/access/features (or the source site type when reviewed categories are absent), aliases, and available linked sources. Coordinates open Google Maps at the recorded point. Missing fields are omitted; summaries are included only when published, and no current-condition claims are generated. A small Schema.org `Place` record exposes only the name and coordinates already shown on the page.

## Expand after reviewing the pilot

Review page accuracy, source attribution, duplicate handling and search-engine indexing before expanding beyond the initial 100. The current dataset has many more records than this initial batch; having a stable ID and coordinates alone is not enough to justify publishing a thin page. Region pages remain limited to groups with at least three included site pages. Check generated output and repository/static-hosting limits before publishing a larger batch. The command-line limits avoid code edits for routine expansion.
