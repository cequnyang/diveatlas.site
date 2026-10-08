# Dive-site summary descriptions

## Goal

Give divers a concise, useful description for each mapped site and make the
evidence behind its claims easy to inspect. Prefer a well-supported short
summary over a fuller paragraph built from guesses. The owner defines
`needs-source-review` in the current review workflow as reviewed; the summary
workflow must keep its own status so a source's review label is not mistaken
for approval of newly written prose.

## Coverage audit

Snapshot: 2026-10-08. Reproduce the current counts with
`python maintenance/audit_dive_site_summary_coverage.py`.

| Dataset evidence | Sites or rows | Use |
| --- | ---: | --- |
| Canonical dive sites | 18,813 | Summary coverage denominator |
| Reviewed setting, access, or feature | 10,911 sites | Supports concise fact-based summaries |
| Reviewed feature | 9,046 sites | Supports a useful site-identity sentence |
| Depth value | 16,105 sites | Can supplement a summary when its meaning is clear |
| Reviewed category and depth | 8,424 sites | Stronger fact-based starting point |
| Direct URL in canonical evidence metadata | 4,405 sites | Direct citation already stored on the site row |
| Category, depth, and direct canonical URL | 3,550 sites | Best current source-backed batch for factual summaries |
| Latest source-evidence export (`v147`) | 68,200 rows / 11,982 matching sites | Contains URL-backed records; many rows are context or profile metrics, not descriptions |
| Extractable descriptive source text in `v147` | 3,520 sites, 3,519 with a URL | Candidate source material for richer summaries; each claim still needs source and limitation checks |
| Latest site-page adjudications (`v147`) | 47,365 rows / 11,580 matching sites | Field-level quotes and profile evidence; not every quote is narrative description |
| Generated summary sidecar | 18,139 sites (96.42% of canonical dataset) | 10,886 deterministic reviewed-category summaries, 7,168 dated SSI profile snapshots, and 85 site-specific source syntheses (14 cite operator guides); 11,808 sites have one or more clickable URLs, with 6,331 named-source-only records |

Environmental occurrence, reef proximity, bathymetry, ratings, logged-dives,
visibility snapshots, and aggregate wildlife counts do not by themselves
describe a named dive site. Source URLs are leads; only use a source for claims
it actually supports. Keep source limitations with the evidence.

## Phases

1. **Audit available evidence — complete.** Measure canonical attribute and
   reference coverage, then inspect the newest source-evidence exports by
   stable site ID. The audit script streams the large exports and does not
   rewrite them.
2. **Define the summary record and drafting rules — complete for v2.** Store
   summaries separately from the large site array, keyed by field `[12]`.
   Preserve the summary text, language, source references, source class,
   retrieval/snapshot date when known, limitations, and a summary-specific
   status (`draft`, `published`, or `withheld`). Do not reuse the upstream
   `review_status` as approval of generated prose. The sidecar uses shared
   defaults and compact source tuples inside gzip-compressed JSON; the
   canonical row layout is unchanged.
3. **Draft from existing evidence — broad batch complete.** The reproducible
   builder creates concise descriptions from reviewed setting, access, and
   feature fields, retaining all available public URLs or named source-record
   references. It skips rows explicitly marked `unreviewed`; the owner's
   `needs-source-review` state remains treated as reviewed. It omits depth and
   conditions from generated copy. Chicken Reef keeps its separately
   source-checked operator-guide description and visible depth discrepancy.
   The builder also emits access-only summaries when shore/boat entry is the
   only reviewed category. PADI contributor-profile summaries are added where site identity and descriptive evidence support them;
   7,168 sites receive a dated, explicitly labeled SSI snapshot summary for
   profile-reported depth or difficulty. Fifty-seven additional site-specific source summaries have been added after identity and source checks.
4. **Research evidence gaps in batches.** Use stable ID and coordinate/name
   match checks to attach additional operator or official references. Prioritize
   records with reviewed categories but no direct source link, and high-value
   sites with rich but single-source descriptions. Current pass added linked
   sources for Smugglers Bay, King Cruiser, Koh Haa Neua #1, Koh Haa #6,
   Hin Bida, Ras Umm Sid, Tiger Beach, Eel Garden, Turtle Rock, Aquarium,
   Aliwal Shoal, Pyramids, Koh Ma, Airport Beach, racha noi, Tiger Reef (Dahab), Japanese Shipwreck, Chapeirão Faca Cega, Talisay Point, Lighthouse (Dahab), Red
   Rock (Kazakhstan), Princess Bay (Wellington), Drop Off (Tulamben), Mermaid
   Cove, Anchor Point, The Labyrinth, Sandy Cove, The Canyon (Dahab),
   Stetson Bank, Eagle Ray Alley, El Faro (La Palma), Pirapama, and Tavarua
   Wall, La Herradura, Sapi Only Garden Eel, Pefkos, Petit Malendure, and
   YDT-15, Sliema Pitch Bay, Tie Dye Arch, La Ballena (Sonabia), 4 Mile Reef, Tent Reef Deep, The LuLu (Wreck), Greer Gut, S.S. Trevier, and Santorini House Reef. Exact or close
   coordinates and name/location agreement support identity; conflicts and
   source-reported conditions stay visible. This phase remains in progress
   for 674 sites.
5. **Publish summaries and references — implemented.** Keep the summary
   sidecar separate from the canonical site rows. Load it on the first dive-site
   popup open, then cache it for later popups; opening the map or loading the
   dive-site layer no longer downloads this sidecar. The generated gzip JSON
   keeps the full index at about 0.96 MB on disk and on the wire (down from
   5.68 MB uncompressed, an 83% reduction). Render the summary and its linked
   URLs or named source-record references in the popup's
   collapsed Source control. Source URLs that also appear in the site's
   reviewed evidence are deduplicated.
6. **Verify coverage and integrity — current batch checked.** The repeatable
   audit reports coverage, source URLs, named-source records, duplicate or
   orphan IDs, empty descriptions, publication state, and sidecar size. Browser
   preview confirmed the deferred Chicken Reef summary appears in the popup,
   retains its depth discrepancy note, and leaves Source collapsed until
   opened. The current browser check also confirmed the Racha Noi, Tiger Reef,
   Japanese Shipwreck, Chapeirão Faca Cega, and Talisay Point summaries; each
   Source control starts collapsed and expands to its site-specific references.
   The remaining 674 sites need either site-specific descriptive evidence or a clarified
   category/source record before a factual narrative can be published.

## Drafting and publication rules

- Write one or two plain sentences. Lead with the site's distinctive
  structure or experience when an actual profile describes it.
- Label claims as source-reported when they are not independently confirmed.
- Do not turn a single depth point into a maximum/range, or platform averages
  into current conditions.
- Do not promise sightings, visibility, currents, or diver suitability. If
  sources disagree, keep the disagreement visible or omit the claim.
- Keep at least one site-specific URL when one exists. A provider homepage or
  environmental-context link is not a substitute for a site profile.
- Withhold descriptive copy when only the site name or unrelated regional data
  is available; keep the site and its source record in the atlas.

## Progress log

- 2026-10-08: Completed the repeatable source/attribute coverage audit and
  created the `dive-site-summary-v2` sidecar. Added one source-checked Chicken
  Reef summary with two operator references and an explicit depth discrepancy
  note. The popup renders published summaries and their citations in the
  collapsed Source disclosure. The sidecar is fetched only on the first popup
  open and reused for subsequent sites, keeping it off the initial map and
  dive-site-layer load path.
- 2026-10-08: Replaced the JavaScript sidecar with deterministic gzip-compressed
  JSON. The browser decompresses and parses it only after a dive-site popup
  opens; the builder and coverage audit now use the compressed asset directly.
  A local preview confirmed the Chicken Reef description still renders from
  the compressed file.
- 2026-10-08: Updated the builder to prefer consolidated category decisions
  (`v154`), with the earlier reviewed export (`v149`) as fallback where the
  consolidation has no row. Added eight site-specific summaries from profile, operator, or
  local guides: Smugglers Bay, King Cruiser, Koh Haa Neua #1, Koh Haa #6,
  Hin Bida, Ras Umm Sid, Tiger Beach, and Eel Garden. Each
  keeps direct links, source types, retrieval dates, claim scope, and
  limitations. The source list now suppresses a summary URL already shown by
  the reviewed evidence link. Browser preview confirmed the summaries and
  deduplicated references for Smugglers Bay and King Cruiser.
- 2026-10-08: Added six coordinate-checked PADI contributor summaries for
  Turtle Rock, Aquarium, Aliwal Shoal, Pyramids, Koh Ma, and Airport Beach.
  The Aquarium profile is about 0.8 km from the atlas marker; Koh Ma is about
  310 m away. Airport Beach's contradictory depth values are visible in the
  summary note.
- 2026-10-08: Added nine coordinate-matched PADI contributor summaries for Lighthouse (Dahab), Red Rock (Kazakhstan), Princess Bay (Wellington), Drop Off (Tulamben), Mermaid Cove, Anchor Point, The Labyrinth, Sandy Cove, and The Canyon (Dahab). Source-reported depth conflicts and limitations remain visible in the individual records.
- 2026-10-08: Added racha noi from a PADI contributor profile whose coordinates exactly match the atlas point. The summary keeps only the profile's white-sand description, listed entry/type details, and attributed maximum; its text notes the lack of route detail.
- 2026-10-08: Added evidence-linked summaries for Tiger Reef (Dahab) and Japanese Shipwreck (Amed). Tiger Reef combines its exact-coordinate PADI profile with a local guide describing boat access, reef/wall routes, and variable current. Japanese Shipwreck combines its exact-coordinate PADI category profile with an Amed operator shore-dive listing; its sources do not establish wreck condition or a fixed route.
- 2026-10-08: Added Chapeirão Faca Cega and Talisay Point from matched dive-site profiles and local operator guides. Chapeirão Faca Cega's source gives the same coordinates as the atlas marker and describes its coral chamber and passages; Talisay Point's operator coordinates are about 70 m from the marker, and two Moalboal dive-center guides describe the wall site.
- 2026-10-08: Added Stetson Bank using NOAA's sanctuary habitat guide and published boundary coordinates. The canonical marker falls within NOAA's Stetson Bank boundary; the description covers the bank's sand/gravel flats, exposed rocky ridges, and mixed sponge/algae/coral outcroppings. NOAA's wildlife observations remain explicitly non-guaranteed, and the source note clarifies that the guide is not tied to one mooring route.
- 2026-10-08: Added Eagle Ray Alley from an SSI MyDiveGuide site profile and a second dive-site profile. The summary reports the SSI 4–18 m range and makes the conflicting ~24 m maximum in the second profile explicit; wildlife observations remain attributed. Added El Faro (La Palma) using an exact-coordinate PADI profile and the island's official tourism guide to establish the beach/volcanic-coast context and variable wave conditions.
- 2026-10-08: Added Pirapama using an exact-coordinate wreck guide; its historical date is withheld because sources conflict. Added Tavarua Wall using an SSI site profile and Subsurface Fiji's operator description, limited to the wall and shallow swim-through features.
- 2026-10-08: Added La Herradura from a PADI profile whose coordinates exactly match the atlas point, with local operator context and an explicit maximum-depth limitation. Added Sapi Only Garden Eel from its SSI profile, retaining the source's boat/shore access details and attributing wildlife reports.
- 2026-10-08: Added Pefkos from a PADI contributor profile whose coordinates exactly match the atlas marker. The summary retains the source's bay setting, overhangs, swim-throughs, and reported 5–14 m range.
- 2026-10-08: Added Petit Malendure from its SSI site profile, describing its shallow sandy site and attributing the reported fish and small-creature sightings.
- 2026-10-08: Added YDT-15 using a local Pensacola charter guide and Visit Pensacola's wreck guide. The summary identifies the former Navy dive tender, artificial-reef use, partial collapse, and reported depth figures with a limitation that distinguishes site maximum from a dive plan.
- 2026-10-08: Added Sliema Pitch Bay from its SSI profile, retaining the shallow-bay setting, reported sandy depth patches, and listed underwater objects with contributor-source caveats.
- 2026-10-08: Added Tie Dye Arch from coordinate-matched Poor Knights dive guides, retaining its swim-through structure, condition dependence, and separate depth reports for the arch floor and eastern end. Added La Ballena (Sonabia) from its SSI site profile, with boat access, source-reported depth and conditions, and wildlife attribution.
- 2026-10-08: Added 4 Mile Reef from a coordinate-matched PADI contributor profile and Pisces Diving guide, omitting conflicting published depth values. Added Tent Reef Deep from its SSI profile and a Divers Alert Network dive account, keeping wildlife sightings attributed.
- 2026-10-08: Added The LuLu (Wreck) using an Alabama reef-foundation record and a local operator guide. The site description retains the published marker-coordinate offset and attributes depth and penetration details to the operator.
- 2026-10-08: Added Greer Gut using its SSI profile, Saba Conservation Foundation guidance, and an academic 2019 survey coordinate. The description distinguishes its limestone reef from Saba's common volcanic structures and notes that conditions on the exposed side depend on weather.
- 2026-10-08: Added S.S. Trevier from an SSI wreck profile and a North Sea cleanup-dive account, attributing the single-visit current observation. Added Santorini House Reef from a coordinate-matched PADI profile and the operating dive center's site guide.
- 2026-10-08: Added Dom João de Castro using the official Azores tourism dive-site profile for its volcanic seamount identity, boat access, depth, current, and experience-level guidance. Added El Palmer using a coordinate-matched beach point, a site profile for shore entry and depth, and Aquatours' regional seabed guide, with that broader scope stated in the evidence note.
- 2026-10-08: Added Bjarnagjá from an exact-coordinate PADI profile credited to local operator DIVE.IS and the operator's own site guide. The description states the profile's 18 m narrative versus its 20 m structured maximum/atlas listing, and preserves the training caveat for overhead sections.
- 2026-10-08: Added Fanning Springs State Park from a coordinate-matched PADI profile and official Florida State Parks guidance. The narrative distinguishes the site features and preserves conflicting depth figures from the atlas and PADI's narrative/structured fields.
- 2026-10-08: Added La Madonna at Cirkewwa from an exact-coordinate PADI contributor profile and the Ċirkewwa Marine Park guide, keeping the cave depth distinct from the profile's maximum. Added Cypress Spring from an exact-coordinate PADI profile and a Florida spring/cave guide, preserving the conflicting depth field and cave-training limitation.
- 2026-10-08: Added Neptune Islands using an exact-coordinate PADI profile and South Australian Marine Parks guidance, explicitly treating the map point as an island-group marker and distinguishing cage-diving tourism from a scuba route. Added Mundoo Kandu from an exact-coordinate PADI site profile and its local dive-center profile, attributing fauna and depth details to the contributor and retaining the current/route caveat.
- 2026-10-08: Added both canonical Escafandra rows at Wied iz-Zurrieq, which share the same marker and helmet-statue identity, using their coordinate-matched PADI contributor profiles and local guides. The summary distinguishes the helmet's reported depth from the maximum for the overall dive site. Added Target Rock from an exact-coordinate PADI profile and a local diver guide, preserving the different published shallow-depth ranges and tide caveat.
- 2026-10-08: Added Terme del Lacus, Villa con Ingresso a Protiro, Portus Julius, and Secca delle Fumose using the Submerged Archaeological Park of Baia's individual dive descriptions and official park material. The summaries describe submerged Roman structures and mosaics, or the volcanic pylons and fumaroles at Secca delle Fumose; source-reported depths remain attributed.
- 2026-10-08: Added Amphoras (Sharm el-Sheikh), Olowalu Beach, and Cynthiana from coordinate-matched PADI profiles plus local operator context for Amphoras. The implausible PADI 170 m maximum for Amphoras is explicitly withheld; Cynthiana's similarly named but distant profile is excluded from its evidence.
- 2026-10-08: Added Grand Makadi House Reef, Electric Beach, and Cala Vidre from exact-coordinate PADI profiles, with a local operator reference for Grand Makadi and Hawaii state context for Electric Beach. Uncorroborated or implausible profile depth maxima are omitted from the first two summaries.
- 2026-10-08: Refreshed the coverage audit. It now contains 18,139 of 18,813
  sites (96.42%), with 11,808 records carrying one or more public URLs and
  6,331 carrying named-source provenance without a direct URL. The sidecar is
  962,950 bytes and loads only on the first opened dive-site popup. The remaining 674
  sites have no summary because current category fields or source exports do
  not support a useful factual description yet. Legacy type tags remain
  separate from summary claims unless a source supports the specific details.
- 2026-10-08 (initial batch): Added `maintenance/build_dive_site_summaries.py` and generated
  10,887 evidence-linked category summaries by combining the reviewed category export
  with canonical rows whose category metadata is marked reviewed. Each
  generated sentence only restates reviewed setting, access, and feature
  labels; category-export rows marked unreviewed are skipped, all source URLs or named
  source-record references are retained, and unsupported depth/current/
  wildlife claims are omitted. This initial batch was later expanded with
  dated third-party profile snapshots and site-specific operator summaries;
  the current coverage and sidecar size are recorded above.
- 2026-10-08: Audited the uncovered IDs against `site-page-adjudications-v147`
  and the full source-evidence export. Only 10 uncovered canonical sites had
  extractable narrative descriptions with a direct site URL; added concise,
  attributed summaries for those profiles with the v147 snapshot limitation.
  The remaining source rows were mainly profile metrics, survey context, or
  weakly attributed/AI-assisted category suggestions, which do not support
  reliable public copy on their own.
- 2026-10-08: Browser-checked Chicken Reef and a category-only popup. The
  profile prose and depth conflict render, the Source control starts collapsed,
  and expanding it exposes operator links. A source-only record displays its
  named provenance alongside the retained OpenStreetMap link. Updated the
  repeatable audit to report the current sidecar's summary and citation counts.
