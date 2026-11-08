# Reviewed discovery hero photos

37 UUID-bound, locally integrated hero images replace illustrative fallbacks without changing page layout. Original resolution, exact Commons source/licence, creator, identity caveats, crop rectangles, original SHA256 and pending review statuses are in assignments.json. Each JPEG retains the exact applicable CC BY/CC BY-SA licence stated there; credit the recorded creator, original source and licence and disclose cropping/resizing. Licensing metadata is not proof of ownership.

combined-assignments.json is generated: unchanged historical three-image assignments plus these37. The JavaScript UUID allowlist is generated alongside it. Do not edit generated IDs independently. This separate route supports explicitly labelled surface/context photographs without falsely registering them as exact underwater/site photos.

Local authoring/evidence: data/image-application-hour-candidates-20261108/README.md. Regenerate with python -B data/image-application-hour-candidates-20261108/scripts/prepare.py after reviewing selection; test with node data/image-application-hour-candidates-20261108/test_pages.cjs. Authoring data and original source files remain local and are not committed automatically.

Owner requested local integration. No deployment or publication is authorized by this change; identity/rights human review remains separate. Prior source originals, pilot outputs and existing three-image assignments were preserved.

## Preview thumbnails

Run `python maintenance/build_reviewed_site_thumbnails.py` after updating the combined hero assignments. This produces40 optimized480×270 derivatives and the UUID/permalink lookup in `js/dive-site-reviewed-photo-catalog.js`. Do not copy these context photos into the personal/owned registry.

`js/dive-site-reviewed-thumbnails.js` supplies the map resolver and progressively replaces existing preview images on directory, related, dynamically loaded and cloned cards. It matches exact UUIDs or existing published slugs, never names/coordinates. It preserves a working image when a new derivative fails, and handles an old CDN failure during decode. Compact overlay labels/credits preserve card dimensions; full source/licence links are on the linked detail page and map/full preview. Existing personally owned exact-site photos retain priority in the map resolver. Unassigned sites retain existing images.

Regression checks: `npx playwright test tests/e2e/reviewed-site-photos.spec.js`. This file runs in the normal desktop/mobile matrix and covers all40 bindings, homonym/external link exclusions, cloned/dynamic cards, source reassignment, failure/decode races, actual region cards, map previews, labels and linked attribution. No network discovery or publication occurs.
