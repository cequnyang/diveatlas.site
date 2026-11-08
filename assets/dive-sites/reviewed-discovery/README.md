# Reviewed discovery hero photos

37 UUID-bound, locally integrated hero images replace illustrative fallbacks without changing page layout. Original resolution, exact Commons source/licence, creator, identity caveats, crop rectangles, original SHA256 and pending review statuses are in assignments.json. Each JPEG retains the exact applicable CC BY/CC BY-SA licence stated there; credit the recorded creator, original source and licence and disclose cropping/resizing. Licensing metadata is not proof of ownership.

assignments.json retains this historical37-image batch. combined-assignments.json combines the historical three-image assignments, these37 and later explicitly reviewed batches. The JavaScript UUID allowlist is generated alongside it. Do not edit generated IDs independently. This separate route supports explicitly labelled surface/context photographs without falsely registering them as exact underwater/site photos.

Local authoring/evidence: data/image-application-hour-candidates-20261108/README.md. Regenerate with python -B data/image-application-hour-candidates-20261108/scripts/prepare.py after reviewing selection; test with node data/image-application-hour-candidates-20261108/test_pages.cjs. Authoring data and original source files remain local and are not committed automatically.

Owner requested local integration. No deployment or publication is authorized by this change; identity/rights human review remains separate. Prior source originals, pilot outputs and existing three-image assignments were preserved.

## Preview thumbnails

Run `python maintenance/build_reviewed_site_thumbnails.py` after updating the combined hero assignments. This produces optimized480×270 derivatives for every combined assignment and the UUID/permalink lookup in `js/dive-site-reviewed-photo-catalog.js`. Do not copy these context photos into the personal/owned registry.

`js/dive-site-reviewed-thumbnails.js` supplies the map resolver and progressively replaces existing preview images on directory, related, dynamically loaded and cloned cards. It matches exact UUIDs or existing published slugs, never names/coordinates. It preserves a working image when a new derivative fails, and handles an old CDN failure during decode. Compact overlay labels/credits preserve card dimensions; full source/licence links are on the linked detail page and map/full preview. Existing personally owned exact-site photos retain priority in the map resolver. Unassigned sites retain existing images.

Regression checks: `npx playwright test tests/e2e/reviewed-site-photos.spec.js`. This file runs in the normal desktop/mobile matrix and covers every combined binding, homonym/external link exclusions, cloned/dynamic cards, source reassignment, failure/decode races, actual region cards, map previews, labels and linked attribution. No network discovery or publication occurs.


## Additional November 8 batch

After that additional batch, the combined manifest contained99 local assignments: the previous40 unchanged entries and59 newly screened entries. The new source-specific manifest and118 desktop/mobile derivatives are in `assets/dive-sites/reviewed-20261108/`. Nine supporting-only candidates and32 uncertain/visually unsuitable leads are deliberately unassigned. Surface/context labels do not claim independent location verification.

Apply/reproduce this additive batch with `python maintenance/apply_additional_reviewed_photos.py --decisions data/image-application-additional-20261108/decisions.json --apply`, then run the thumbnail builder above. Omit `--apply` to stage crop sheets only. The decision file and original source archive are local prerequisites. Do not rerun the historical37-photo preparation script over the combined manifest: that historical script only knows its original batch. Existing entries are preserved; the additive script refuses a different image for an already-assigned UUID.

The active local enrichment renderer yields to explicit reviewed UUID choices for heroes, map images and recommendation thumbnails. This prevents two renderers from repeatedly replacing one another. Full source/licence links, requested creator links, exact CC versions and crop notices remain attached. The split-level El Pit image is labelled Above/below-water rather than surface-only.


## Three DBpedia-discovered assignments

Current combined total:102. The owner explicitly selected Aliwal Shoal, Cozumel and Loch Long from the20-site evaluation; the99 previous entries remain unchanged. New6 hero derivatives and source-specific assignments are in `assets/dive-sites/reviewed-dbpedia-20261108/`; new thumbnails use the same shared catalog. Loch Long is labelled Surface view. The underwater labels name Cathedral/Aliwal Shoal and Cozumel marine park without asserting independent marker verification. Supporting-only and NASA candidates remain unassigned.

Reproduce with `python maintenance/apply_additional_reviewed_photos.py --decisions data/image-application-dbpedia-20261108/decisions.json --apply`, then run the shared thumbnail builder. The adapter reads the new evaluation format without changing its source evidence. An explicit asset_directory isolates each batch. When resuming, metadata/credits may refresh only the selected UUIDs with identical original SHA256; different originals still fail and all other assignments are preserved.

Credits include Peter Southwood (Pbsouthwood), Matthew T Rader with the requested https://matthewtrader.com link, and Balon Greyjoy. Exact CC BY-SA3.0/4.0 links and cropped/resized notices remain visible. The source-specific manifest preserves the complete recorded licence-attribution text. No deployment or publication is authorized.

## Second hourly discovery application

Current combined total:119 local assignments. Seventeen of the20 provisional main candidates from data/image-discovery-hour-20261108-v2 were selected after source-evidence and desktop/mobile crop review. Rummu quarry, Bouley Bay and Maskali Island were skipped for unresolved coordinate/geography/identity evidence. All16 supporting-only photos remain outside this batch. The102 prior assignments and thumbnail bytes are unchanged. New desktop/mobile assets and source-specific assignments are under ssets/dive-sites/reviewed-hour-v2-20261108/. Every new assignment is labelled Surface view or Nearby surface view, with creator, exact source/licence links and crop/resize notices. No deployment/publication is authorized.

Local review decisions, source adapter and reproducible application script: data/image-application-hour-v2-20261108/. Source originals and pilot evidence remain unchanged. The personal/exact-site registry is not modified.

## Broader local landscape reassessment

Current combined total:127. All69 historical rejected images were reassessed under the owner-approved landscape/village/park standard:8 were selected for local heroes and thumbnails,4 retained as supporting-only,3 held for identity/geography,54 remain rejected. Earlier119 assignments and thumbnail hashes are unchanged. New photos: Tent Reef Deep (Windwardside Saba village scenery), Hateruma Island, Kohamajima Island (Mount Ufu-daki), Stoke Beach (view of Burgh Island from near the beach), Saint-Prex village, Ruskeala Marble Quarry shaft entrance, fields near Portroe Quarry and Lake Shikotsu park. These are explicitly labelled nearby scenery/island landscape, not underwater or independently verified exact dive locations.

Assets and source-specific metadata: ssets/dive-sites/reviewed-landscapes-20261108/. All69 item decisions and historical reasons are preserved separately under data/image-recheck-landscapes-20261108/. No original pilot data was rewritten; no deployment/publication is authorized.
