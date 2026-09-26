# DiveAtlas static SEO page pilot

The generator publishes factual HTML pages for a limited set of dive sites and data-backed region groups. These pages give crawlers ordinary HTML, canonical URLs and crawlable links without loading the map application or its datasets. The pilot is selected by record completeness; it is not a popularity ranking.

## Generate the pilot

From the repository root:

```powershell
python tools/generate_seo_pages.py
```

The default build writes up to 20 site pages and 10 region pages, plus both browse indexes and `sitemap.xml`. To preview a smaller output, pass limits such as `--site-limit 5 --region-limit 2`. The `dive-sites/` and `regions/` trees are generator-owned and are rebuilt on every run; keep hand-authored content outside those directories. The generator also replaces the root sitemap from the URLs it successfully writes.

## Inputs and record fields

- `data/dive-sites.js`: `window.DIVE_SITES_DATA` row arrays. Field indexes are name `[0]`, latitude `[1]`, longitude `[2]`, depth minimum `[3]`, depth maximum `[4]`, difficulty `[6]`, site characteristics `[7]`, listed data-source providers `[8]`, country `[9]`, region/locality `[10]`, aliases `[11]`, persistent UUID `[12]`, and optional retired UUIDs `[13]`. Field `[5]` has no confirmed meaning in the page runtime and is deliberately ignored.
- `data/dive-site-photos.js`: UUID-keyed photo metadata. A photo is included only when its UUID matches the site, its location confidence is `exact`, it has alt text, and the referenced local image exists.

No external API, reverse geocoding, generated prose, map JavaScript, coral snapshot, or tile loader is used.

## Selection and content thresholds

A site page requires a nonempty, non-corrupt name; a unique persistent UUID; valid latitude and longitude; at least country or region context; coordinates unique across the source dataset; and at least two available factual attributes among recorded depth bounds, difficulty, site characteristics, aliases, listed source providers, and a verified local photo. The default cap is 20. Selection sorts first by number of these available attributes, then by normalized name and recorded location for reproducibility.

Region grouping uses only exact recorded `country` and `region` values. A region page requires at least 3 site pages in the current generated pilot and is capped at 10 groups. When both values exist, its stable path is `/regions/<country-slug>/<region-slug>/`; the country prefix distinguishes same-named regions. If country is absent but a region value is present, the path is `/regions/<region-slug>/`. Regions are selected by site-page count, then by country and region name.

The generator rejects missing or malformed IDs, invalid coordinates, all records in exact-coordinate duplicate groups, names containing Unicode replacement/control characters, missing location context and records below the factual-attribute threshold. It never infers a country or region from coordinates. Missing fields are omitted from page sections.

## Slugs and duplicate protection

Slugs are lowercase ASCII produced from Unicode NFKD normalization and punctuation folding. Names with no ASCII transliteration use a stable `site-<UUID-prefix>` fallback. Duplicate names receive recorded region/country context; any remaining collision receives the persistent UUID prefix. Collision detection considers the full eligible candidate set, not the current limit, so expanding the cap does not change existing site slugs. Duplicate coordinates are rejected rather than assigned separate pages. Generated page titles and descriptions are checked for uniqueness before output.

## Page and sitemap output

- `/dive-sites/` links to every generated pilot site.
- `/dive-sites/<slug>/` contains static title, description, canonical, one H1, recorded facts, optional verified photo, region link and a link to the existing map deep link `/?site=<UUID>`.
- `/regions/` links to every generated region group.
- `/regions/<country>/<region>/` includes the generated site count, site links, calculated coordinate bounds, map link and same-country pilot region links where available.
- `sitemap.xml` contains the homepage and only the browse/detail URLs successfully generated in that run. It does not add resource files or unsupported `lastmod` values.

The pages share the small `/assets/seo.css` stylesheet and do not load Leaflet, MapLibre, or map data. Homepage links to both browse indexes are in the existing menu disclosure; its short explanation describes the map's recorded layers and avoids claims about current dive conditions.

## Expand after reviewing the pilot

Review page accuracy, source attribution, duplicate handling and search-engine indexing before expanding. Then raise `--site-limit` gradually (for example, 50, then 100); region pages remain limited to groups with at least three included site pages. Check generated output and repository/static-hosting limits before publishing a larger batch. The command-line limits avoid code edits for routine expansion, while the default caps keep the checked-in pilot small.
