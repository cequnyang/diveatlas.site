# Dive-site summary descriptions

## Goal

Give divers a concise, useful description for each mapped site and make the
evidence behind its claims easy to inspect. Prefer a well-supported short
summary over a fuller paragraph built from guesses. The owner defines
`needs-source-review` in the current review workflow as reviewed; the summary
workflow must keep its own status so a source's review label is not mistaken
for approval of newly written prose.

## Coverage audit

Snapshot: 2026-10-16. Reproduce the current counts with
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
| Generated summary sidecar | 18,166 sites (96.56% of canonical dataset) | Includes 7,145 dated SSI profile snapshots; the audit identifies 97 records with an explicit first-hand diver source class. In total, 18,716 canonical sites do not yet have that kind of account summary. A further 647 sites have no published summary of any kind. 11,854 sites have one or more clickable URLs, with 6,312 named-source-only records |

Review-based descriptions remain a small, curated layer: Melissa’s Garden
uses two visitor reports; Frijoles and Pure Magic use published diver trip
reports; The Caves uses a visitor review; Perpendicular Wall uses a diver log;
Blue Corner, Barracuda Point Sipadan, Richelieu Rock, Tiger Beach, Alcyone,
Great Blue Hole - Belize, and Thistlegorm use published diver reports; and nine
other sites use matched community-profile observations. Cape Kri and Manta
Point, Nusa Penida, Cenote Angelita, the two catalog records for the Tulamben
Liberty wreck, and Palancar Bricks, Gardens, and Caves also use published diver
reports. Roca Partida, The Boiler, Cabo Pearce, Castle Rock, Crystal Rock,
Manta Alley, SS Yongala, Cod Hole, Bari Reef, Crystal Bay in Nusa Penida, and
Monad Shoal also use published diver reports. The same Malapascua trip report
supports Gato Island, North Point, Pantaw Pantaw, and Lighthouse Reef, including
a nearby Lighthouse catalog variant. Garden Eel Cove and two nearby catalog
variants use one matching visitor report. A 2002 Bonaire report adds short
visit notes for 1000 Steps, Jeff Davis Memorial, and La Machaca, plus a 2009
report for Tori’s Reef. A 2010 report adds observations for Karpata, Yellow
Submarine, ChaChaCha Beach, Oil Slick Leap, and Alice in Wonderland; a 2008
report describes Invisibles; a 2005 report mentions Red Slave; and a 2012
report describes Hilma Hooker. A 2026 first-person Bonaire account adds
observations for Joanne’s Sunchi, Salt Pier, Country Garden, and Angel City.
The report spells Leonora’s Reef as “Lenora’s Reef”; the
matching Bonaire site name supports that identity. Nearby catalog variants
share the 1000 Steps and La Machaca account notes. This brings the first-hand
review/account layer to 87 catalog records; several nearby or duplicate records
refer to the same sites. Roatan reports also describe Newman’s Wall, Calvin’s
Crack, and the Prince Albert wreck. Palau reports add observations for German
Channel, Ulong Channel, Blue Holes, and Chandelier Cave. First-person accounts
also add Aeolus Wreck and Alexander Springs; Aeolus carries a note that its
stored map point differs from another published wreck position. First-person
North Carolina wreck reports add the USS Schurz and Papoose, with conditions
clearly presented as observations from individual trips. Recent Whytecliff Park
logs add observations from local divers. A first-person freediving report adds
a lake-session account for Tasik Bandar Saujana Putra.
Five diver reviews for Coral Garden at Sapi Island show mixed opinions: four
call it good for one visit and one says there was little to see.
A Lanzarote instructor’s first-person Playa Grande report describes a sandy
plateau and reef wall with angel sharks, rays, octopuses, and nudibranchs.
The v147 archive contains many more profile descriptions, but
they are not all reviews; generic promotional copy and mismatched site
descriptions must be excluded. A missing account in this archive does not
prove that none exists elsewhere.

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
   7,145 sites receive a dated, explicitly labeled SSI snapshot summary for
   profile-reported depth or difficulty. Seventy-one additional site-specific source summaries have been added after identity and source checks.
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
   for 666 sites.
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
   The remaining 666 sites need either site-specific descriptive evidence or a clarified
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

### First-hand diver accounts and ratings

When a public first-hand trip report is available, prefer its site-specific
observations for the summary over generic category prose. Confirm that the
account describes a personal dive and that its named site and location match
the canonical stable ID. Keep opinions and sightings attributed to the diver,
combine only details supported by the cited accounts, and note that individual
observations do not establish typical or current conditions. A platform profile
or operator guide can add site facts, but it is not a diver review.

Keep snapshot ratings in `dive-site-review-ratings-v147.csv` and live checks in
the dated `dive-site-review-ratings-live-YYYY-MM-DD.csv` inventory. Its
`rating_count` is blank when the provider did not expose the number of ratings.
Logged dives and logged users are activity totals, not rating counts; provider
scores remain separate and are not averaged together. A rating alone does not
supply descriptive review text for the summary.

The audit counts 97 catalog records with an explicit first-hand diver source
class, including published
reports for sites such as Manta Alley, SS Yongala, Cod Hole, Bari Reef, Crystal
Bay, Monad Shoal, and the Bonaire, Palau, and Roatan sites above, plus site-matched
SSI-linked community accounts. Nearby aliases can share one source-backed note.
The live rating inventory contains 69 unique sites, with 22 site ratings added
across recent batches; rating counts stay blank when the provider did
not show them. Community profile accounts are attributed to a contributor because the export does not
verify each author’s identity or credentials. Ratings alone never qualify as
review text. Sites without a qualifying account in the inspected archive are
skipped; the archive does not cover every review site on the web, so absence
here does not mean no review exists elsewhere.

## Progress log

- 2026-10-16: Added first-person summaries for Aeolus Wreck and Alexander
  Springs, and recorded their SCUBAGO and Zentacle ratings. The Aeolus summary
  retains a location caveat because its stored point differs from a published
  wreck position. The current coverage audit reports 18,166 of 18,813 published
  summaries and 647 sites still without any published summary. It separately
  identifies 97 first-hand diver-account summaries, leaving 18,716 catalog
  sites without that kind of account summary. Added diver accounts for the
  USS Schurz and Papoose wrecks, recent local reports for Whytecliff Park, a
  2023 freediving account for Tasik Bandar Saujana Putra, five mixed reviews
  for Coral Garden, Sapi Island, a 2021 Playa Grande report, and a 2011
  first-person account for Servemar I, a 2024 Dauin Coast report, and a 2007
  Friedberger Baggersee review, recent Twiske community logs, and a May 2025
  Eichwald (Bruno) club-dive report and a 2018 Mainit review. Added a 2024
  Del Monte Beach club-dive report describing calm seas, 8–10-foot visibility,
  and a sailboat found by students on a later dive. Recorded New Venture's
  SCUBAGO 4/5 score; the page and search result disagreed on rating count, so
  the count is left blank. Recorded Lahami Bay - Hausriff Nord's SCUBAGO 4/5
  score and 433 ratings. Added a 2026 A-Frames report recording scallops,
  shrimp, langoustines, sea urchins, and crabs, and a 2011 Alastor wreck account
  describing the silty route line, crabs, blennies, and wrasse. Added an Alona
  Beach House Reef account describing its shore swim and reef wall, and a 2024
  report on the Dreimaster wreck. Added firsthand reports for New Venture and
  Port Beach. Added four firsthand Aquarius reviews and
  recorded its Zentacle 5/5 score from four reviews. Recorded the
  Tasik 4/5 (1,063 ratings), the
  Guraidhoo Lagoon 4/5 (195 ratings), Servemar 1 5/5 (263 ratings), the Dauin
  category scores, and individual 4/5 reviews for Friedberger and Eichwald;
  Coral Garden's category counts in the
  separate inventory; the category reviews have no numeric average.
  Checked La Croche aux Tacauds but excluded its sole visible 3/5 review because
  it is explicitly a snorkel review, not a scuba diver account.

- 2026-10-16: Added 12 Bonaire summaries from site-specific first-person
  accounts: one long-time diver’s 2026 account and Undercurrent visitor reports
  from 2005, 2008, 2010, and 2012. Added 10 matching SCUBAGO ratings to the
  separate inventory, with rating counts left blank when the provider did not
  expose them. The full audit still leaves 671 canonical sites without a
  published summary.

- 2026-10-16: Audited the v147 SSI-linked source archive for first-person dive
  observations, then checked canonical name, country, and coordinates. Added
  attributed summaries for Abyss’ Triggerfish, Cenote Nicte Ha, Foggy Shark
  Cave, Jack-A-Dan West, No Viz Reef, Seaview, Wahoo, and Wrong Entry. General
  site-guide copy, operator-style marketing, and ratings without written
  observations were excluded. The source profile authors are not independently
  verified, so the popup and source note preserve that limitation.

- 2026-10-16: Added first-person accounts for Frijoles, Pure Magic, The Caves,
  and Perpendicular Wall after matching each report to the site name and
  location. The reports include one brief site mention, which remains explicit
  in its source limitation. Added each site's visible SCUBAGO score and rating
  count to the separate live-rating inventory.

- 2026-10-16: Added site-specific diver reports for Blue Corner, Barracuda
  Point Sipadan, and Richelieu Rock after matching each report to the canonical
  site identity. Recorded their current SCUBAGO scores and rating counts in the
  separate live-rating inventory; observations remain attributed to individual
  trips.

- 2026-10-16: Added first-person reports for Tiger Beach and Alcyone after
  matching the named sites and locations. Recorded Tiger Beach's current
  SCUBAGO score and rating count; the Alcyone SSI snapshot has a score but no
  rating count, so it remains in the snapshot inventory only.

- 2026-10-16: Added personal accounts for Great Blue Hole - Belize and
  Thistlegorm, matched to their Belize and Egypt catalog entries. Recorded the
  current SCUBAGO scores and rating counts in the live inventory; the Great Blue
  Hole account is explicitly labeled as a new diver's personal experience.

- 2026-10-16: Added concise Bonaire visit notes from a 2002 first-person report
  for 1000 Steps, Jeff Davis Memorial, Leonora’s Reef, and La Machaca, plus a
  2009 report for Tori’s Reef. Nearby 1000 Steps and La Machaca catalog variants
  share the matching note. Recorded SCUBAGO scores and available rating counts
  separately; Tori’s Reef and Leonora’s Reef listings exposed scores but no count.

- 2026-10-16: Added site-matched Roatan diver observations for Newman’s Wall,
  Calvin’s Crack, and the Prince Albert wreck from Undercurrent reports dated
  2004–2007. The Prince Albert SCUBAGO page displayed a 4.3/5 score and 1,976
  ratings; the other two site ratings were not found in the captured results.

- 2026-10-16: Added Palau accounts for German Channel, Ulong Channel, Blue Holes,
  and Chandelier Cave from published diver reports dated 2005–2023. A report
  matched Ulong Channel to the PADI-listed coordinates; a second same-named
  catalog marker is too far away to treat as the same site without more evidence.
  Recorded German Channel’s SCUBAGO score and rating count separately.

- 2026-10-16: Added first-person reports matched to Cape Kri and Manta Point,
  Nusa Penida. The Manta Point account records both manta sightings and the
  crowding the diver observed; added the current SCUBAGO scores and rating
  counts separately.

- 2026-10-16: Replaced Melissa’s Garden’s SSI editorial-guide paragraph with a
  synthesis of two visitor trip reports, explicitly labeling their coral and
  small-fish observations as individual accounts. Built a separate review-rating
  inventory for every canonical site from the SSI MyDiveGuide and SSI-linked
  OpenDiveMap evidence snapshots. Rating counts were absent, source log totals
  remain separate, and differing provider snapshots are preserved independently.

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
- 2026-10-16: Added a short Herradura account based on the contributor's
  description of looking for sharks near the marina and visiting the nearby
  Island of Snakes. The current SCUBAGO page showed 4 of 5 stars from 239
  ratings; this was added to the separate live-rating inventory. A same-named
  Rainbow Reef account mentioned Fiji's Somosomo Strait, so it was excluded
  from the Cayman Islands site. The v147 archive has 3,121 SSI-linked profile
  descriptions, but many are general site copy rather than diver accounts;
  each candidate needs content and identity checks. Absence from this archive
  does not prove no review exists elsewhere.

- 2026-10-16: Added a short 2017 Goitzschesee diver account: the visitor
  reported visibility up to 5 m, changing layers, and a training course with
  a mussel-covered caravan and small fish. The source says the reviewed dive
  center later closed and moved, so the summary is clearly limited to that
  historic visit. Recorded the current SCUBAGO five-star score from 190 ratings
  separately from the diver account.

- 2026-10-16: Added a short account of a 2020 first scuba dive in Rousoum
  Bay, based on a visitor review of Alonissos Seacolours Dive Center. It says
  the try dive began in shallow water before moving deeper; it is one visitor’s
  experience, not a report of typical conditions. A site-specific rating was
  not found, so no rating was added.

- 2026-10-16: Recorded nine SCUBAGO site scores for Port-Louis, Guadeloupe,
  including Eden, Caye Ronde, Patates, and other nearby named sites. The
  displayed scores did not include rating totals, so counts were left blank.

- 2026-10-16: Added a short False Entrance summary from a 2024 firsthand
  trip report. The diver described deep canyons, trevally, soft corals, and
  that dive’s slight current and 0.5 m swell. The trip report says the author
  is a local diver with 738 dives; these details describe one visit, not current
  conditions. No site rating was found in the inspected source.
- 2026-10-16: Replaced the generic Cynthiana summary for the catalog record
  near Paphos with a short summary of five diver reviews. The second same-named
  record is several kilometres away and was not matched. Recorded the five
  reviews’ qualitative labels; the source gives no combined numeric score.
- 2026-10-16: Screened Otomi Beach, Burns Point, La Croche aux Tacauds,
  Veleiro Orca, and Terence Bay Wharf. The results were site profiles or
  operator guides rather than firsthand scuba reviews, a snorkel-only review,
  or a wreck report whose coordinates did not match the catalog; no summaries
  were added for these candidates.
- 2026-10-16: Improved the Neufelder See summary with an exact-coordinate
  match and a 2002 firsthand Taucher.Net report. Recorded its 11 posted reviews,
  but no combined numerical score was displayed. The account covers several
  lake entry points, not only the Strandbad entry.
- 2026-10-16: Added a short Tisvildeleje night-dive account from a 2013
  Baracuda magazine article describing one August 2012 dive and its sightings.
  The report documents that visit only; no site rating was found.
- 2026-10-16: Added a concise Genève-Plage site-map summary from a 2026
  underwater map made by an SSI Divemaster trainee and dive buddy. The map
  marks seagrass, a pipe, and an artificial coral reef, with depths reaching
  6 m. It is documented as diver-created topography, not a narrative review;
  no site rating was found.
- 2026-10-16: Screened more catalog candidates. A Dinah’s Beach article
  identifies the planned shallow muck dive but does not describe the dive
  itself. Thalassa House Reef search results exposed anonymous, generic review
  snippets that could not be verified as real diver accounts. Results for
  Cala Punta Santa Ana, Nugal izvor - Mali Gaj, and Santa Martha Bay did not
  surface a qualifying first-hand review matched to those catalog sites. No
  summaries or ratings were added from those leads.
- 2026-10-16: Added a short firsthand report for Nugal izvor - Mali Gaj from
  local dive instructor Bojan Runtic. His 2026 post places a thermal spring
  around 3 m in a wall crevice and contrasts its approximate winter temperature
  with the surrounding water. The catalog and PADI coordinates match exactly.
  No site rating was shown by the inspected source.
- 2026-10-16: Replaced generic SSI-linked community summaries for Cenote
  Nicte Ha and Seaview, Carriacou with named firsthand reports. Indira
  Pranabudi’s 2024 Nicte Ha account describes a shallow cavern loop, lily pads,
  sunbeams, and a silty floor; Luana Haller’s 2015 Carriacou field study reports
  stronger current and fewer lionfish at Seaview than at nearby Barrel. The
  existing SCUBAGO ratings remain in the separate inventory: Nicte Ha 5/5 from
  684 ratings and Seaview 4/5 from 134 ratings.
- 2026-10-16: Added a short Palancar Horseshoe summary from Chris Sullivan's
  first-person 2007 and 2009 dive logs. They describe light current on one visit
  and sightings of rays, a turtle, grouper, and a reef memorial. The inventory
  records the SSI profile's 5/5 score; no rating count was available.
- 2026-10-16: Added a short Lahami Bay Hausriff South summary from a
  2019 dive-club report covering the house reefs, including Banana Reef. The
  account describes clear water, reef life, turtles, and rays from that trip.
  Recorded the direct SCUBAGO three-star score; language versions disagreed
  on the rating count, so the count remains blank.
