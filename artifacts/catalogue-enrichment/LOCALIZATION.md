# Local guide language support

The draft guide overlay follows the page language selector, including Simplified and Traditional Chinese. It keeps the authored English source intact and restores it when English is selected.

Guide prose translates on demand. Evidence and planning notes translate when the sources disclosure is opened. Links, publisher names and license labels stay verbatim. Text is inserted as text nodes, never HTML. Missing or failed translations retain the English source.

The loopback draft server uses the installed `qwen3.5:4b` model through Ollama at `127.0.0.1:11434`. Translations are machine generated, not human reviewed. Initial generation can take over a minute on this machine. Exact-source SHA-256 caches live in the private `data/content-enrichment-local/v1/translations/` tree and are excluded from publication alongside the draft inputs.

Run `node tools/verify-guide-localization.cjs` for desktop/mobile switching checks with mocked translation transport. Run `node tools/verify-guide-localization-live.cjs` for the real cached Chinese Malpelo check after warming its translation with `node tools/check-local-guide-translation.cjs`. The tests start and close isolated temporary servers; they do not restart port 8765.

## Detail, map and recommendation consistency

On the draft server, matching detail pages use their exact-ID authored overview by default. Map popups show a three-line preview of that same text. Recommendation thumbnails and map galleries select media through the detail renderer's shared approval filter and map-first ordering. Sites without approved media retain their fallback images. Canonical IDs are resolved from destination pages for older slug-only recommendation links.

Run `node tools/verify-default-draft-details.cjs` to check all 1,710 local records and representative detail pages. Run `node tools/verify-map-guide-sync.cjs` for actual desktop/mobile map popups, `node tools/verify-map-guide-media.cjs` for approved media coverage, and `node tools/verify-recommendation-guide-photo.cjs` plus `node tools/verify-recommendation-media-coverage.cjs` for thumbnail parity. These checks require the existing private local records and media; neither those assets nor translation caches are committed or published.
