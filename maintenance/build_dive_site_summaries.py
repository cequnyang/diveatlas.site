#!/usr/bin/env python3
"""Build evidence-linked DiveAtlas summaries from reviewed data and profiles.

The generated copy intentionally describes only fields already reviewed in
the category workflow. It avoids turning profile metrics into current facts,
and retains source provenance in a separate sidecar keyed by stable site ID.
"""

from __future__ import annotations

import csv
import gzip
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CANONICAL = ROOT / "datasets/dive-sites.js"
REVIEW = ROOT / "artifacts/dive-site-category-review-consolidated-v154.csv"
REVIEW_FALLBACK = ROOT / "artifacts/dive-site-category-review-reviewed-v149.csv"
EVIDENCE = ROOT / "artifacts/dive-site-all-source-review-evidence-v147.csv"
OUTPUT = ROOT / "datasets/dive-site-summaries.json.gz"

SETTING = {"marine": "marine", "lake": "lake", "river": "river", "pool": "pool", "quarry": "quarry"}
ACCESS = {"shore": "shore", "boat": "boat", "shore_or_boat": "shore or boat"}
FEATURE = {
    "reef": "reef", "artificial_reef": "artificial reef", "pinnacle": "pinnacle",
    "wreck": "wreck", "wall": "wall", "cave": "cave", "cavern": "cavern",
    "drift": "drift", "muck": "muck", "sandy_bottom": "sandy bottom",
    "seagrass": "seagrass", "kelp": "kelp", "cenote": "cenote",
    "blue_hole": "blue hole", "thermal": "thermal feature", "arch": "arch",
    "reef_ridge": "reef ridge", "manta": "manta cleaning station",
}
FEATURE_SUMMARY = {
    "reef": "a reef", "artificial reef": "an artificial reef", "pinnacle": "a pinnacle",
    "wreck": "a wreck", "wall": "a wall", "cave": "a cave", "cavern": "a cavern",
    "drift": "drift diving", "muck": "muck diving", "sandy bottom": "a sandy bottom",
    "seagrass": "seagrass", "kelp": "kelp", "cenote": "a cenote",
    "blue hole": "a blue hole", "thermal feature": "a thermal feature", "arch": "an arch",
    "reef ridge": "a reef ridge", "manta cleaning station": "a manta cleaning station",
}
SUMMARY_RECORD_LIST_PATTERN = re.compile(
    r"\bthe\b[^.;]{0,160}\b(?:record|profile|listing|guide|page|database)\s+lists\b",
    re.IGNORECASE,
)
LISTED_SOURCE_LABELS = {
    "osm": "OpenStreetMap (listed source; direct record URL not retained)",
    "padi": "PADI (listed source; direct site URL not retained)",
    "ssi": "SSI MyDiveGuide (listed source; direct site URL not retained)",
    "opendivemap": "OpenDiveMap (listed source; direct site URL not retained)",
    "wikidata": "Wikidata (listed source; direct item URL not retained)",
}
CHICKEN_REEF_ID = "006c7db3-1715-4f23-bd45-14e62b4749c9"
CHICKEN_REEF = {
    "status": "published",
    "summaryReviewStatus": "source-checked",
    "language": "en",
    "authoringMethod": "AI-assisted synthesis from linked operator guides",
    "description": (
        "Off Kri Island, Chicken Reef is a submerged pinnacle with sloping reef and coral bommies. "
        "Dive operators report a maximum depth around 30 m and currents that can be moderate to strong; "
        "confirm the route and conditions with the local guide."
    ),
    "evidenceNote": "Depth reports differ: DiveAtlas currently lists 22 m, while La Galigo reports a maximum near 30 m.",
    "sources": [
        {
            "label": "La Galigo Liveaboard",
            "url": "https://www.lagaligoliveaboard.com/diving/raja-ampat/dive-site/chicken-reef/",
            "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
            "limitations": "Operator guidance; depth and current descriptions may vary by dive route and tide.",
            "claims": ["location", "topography", "depth", "current", "route"],
        },
        {
            "label": "Dive Concepts", "url": "https://diveconcepts.com/chicken-reef-raja-ampat",
            "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
            "limitations": "Operator guidance; conditions should be confirmed for the planned dive.",
            "claims": ["topography", "current"],
        },
    ],
}
PROFILE_SUMMARY_OVERRIDES = {
    "c2d4d619-1ed9-4b5a-8216-1b4af4ba860b": (
        "Blanck-Eck is described by a local contributor as a varied North German underwater landscape; the profile recommends diving when wind conditions are suitable.",
        "https://travel.padi.com/dive-site/germany/blanck-eck/",
    ),
    "190b24f9-c4f7-4e53-8658-f798f6a07a92": (
        "Brixham Breakwater Beach is described as a gently sloping beach dive. The PADI contributor mentions cuttlefish and pipefish among the marine life.",
        "https://travel.padi.com/dive-site/united-kingdom/brixham-breakwater-beach/",
    ),
    "8ed66de5-039b-4992-8634-3b4fa5599f71": (
        "Below the Cabo de Palos lighthouse, Cala Fría is a shore dive with rock formations to swim through and a reported maximum depth of 12 m.",
        "https://travel.padi.com/dive-site/spain/cala-fria/",
    ),
    "64d1824a-e36e-47ab-bb54-4f9efa29f0f2": (
        "The PADI contributor describes kelp forests and convenient entry at Casino Point Dive Park.",
        "https://travel.padi.com/dive-site/united-states-of-america-usa/casino-point-dive-park/",
    ),
    "5adffb75-d19f-4842-a7fd-bf5ed818a74d": (
        "Echinger Weiher is a quarry lake near Eching, north of Munich, created during motorway construction in 1965. The profile describes underwater vegetation, fish, and a spring that it says keeps the lake diveable in winter.",
        "https://travel.padi.com/dive-site/germany/echinger-weiher/",
    ),
    "6210694a-60a0-4853-a00b-384c8d22fad9": (
        "At Malaga Cove, the PADI contributor describes a path to the beach, a rocky entry near kelp, or a longer sandy entry. The profile advises checking parking hours and notes there are no facilities.",
        "https://travel.padi.com/dive-site/united-states-of-america-usa/malaga-cove/",
    ),
    "969f00c0-900d-4bbb-a0ba-28ec3755a3e9": (
        "The PADI profile for Mar Menuda describes seabed depths of 12–15 m and says routes may reach 32 m depending on the group's level. It notes seasonal marine-life sightings.",
        "https://travel.padi.com/dive-site/spain/mar-menuda/",
    ),
    "8d0440eb-f972-4fbe-8a88-86c04db791e6": (
        "The PADI contributor describes Outhouse Beach as a training site, with typically calm surface conditions and varied marine life.",
        "https://travel.padi.com/dive-site/guam/outhouse-beach/",
    ),
    "01692865-73fe-4cbe-a323-5be5d42c7bfd": (
        "The PADI contributor describes Playa de las Vistas as an easy-access beach dive with marine life close to shore, including cuttlefish.",
        "https://travel.padi.com/dive-site/spain/playa-de-las-vistas/",
    ),
    "a42c326d-baf8-46b8-9f7b-b1034570f531": (
        "Yanui Beach has hard coral over a sandy bottom, easy entry and exit, and generally little current. The maximum depth is 14 m.",
        "https://travel.padi.com/dive-site/thailand/yanui-beach/",
    ),
}

OPERATOR_SUMMARY_OVERRIDES = {
    "0255ecd6-2873-4f57-a913-9a124ef6f115": {
        "description": (
            "Whytecliff Park is a shore-entry site in Howe Sound, with a sheltered inner cove and sloping or wall dives extending toward Queen Charlotte Channel. "
            "West Vancouver identifies it as a Saltwater Marine Protected Area and lists local marine life including rockfish, lingcod, anemones, and the occasional giant octopus."
        ),
        "evidenceNote": "The PADI profile exactly matches the atlas coordinates and describes the inner-cove and channel routes. The West Vancouver municipal park page independently confirms scuba access, the protected-area context, and marine-life examples; sightings are not guaranteed.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI profile and municipal park guidance",
        "sources": [
            {"label": "PADI: Whytecliff Park site profile", "url": "https://www.padi.com/dive-site/canada/whytecliff-park/", "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08", "limitations": "Coordinates exactly match the atlas. PADI describes shore entry, slopes and walls, the inner cove, and more advanced routes toward Queen Charlotte Channel.", "claims": ["site-identity", "location", "access", "topography", "route-context"]},
            {"label": "District of West Vancouver: Whytecliff Park", "url": "https://westvancouver.ca/parks-recreation/parks-trails/whytecliff-park", "sourceClass": "municipal-park-guidance", "retrievedAt": "2026-10-08", "limitations": "Official municipal page confirms scuba use and protected-area context; wildlife examples are not guaranteed sightings, and temporary restrictions may apply.", "claims": ["site-identity", "access", "protected-area", "marine-life-reported"]},
        ],
    },
    "0aab469f-5de3-4b12-beee-746c55eeefe4": {
        "description": (
            "Neufelder See - Strandbad is a shore-entry dive at an artificial freshwater lake south of Vienna. "
            "The regional tourism authority describes training platforms between 5 and 20 m and underwater guide lines; the lake reaches about 23 m, while visibility varies with weather and use."
        ),
        "evidenceNote": "PADI coordinates exactly match the atlas marker and describe the same lake's Strandbad entry. Burgenland Tourism provides official depth, visibility, training-platform, and guide-line context. PADI warns that visibility can deteriorate substantially with weather, bathing activity, or divers disturbing the bottom; no fixed visibility claim is made.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI profile and Burgenland Tourism dive guidance",
        "sources": [
            {"label": "PADI: Neufelder See - Strandbad profile", "url": "https://www.padi.com/dive-site/austria/neufelder-see/", "sourceClass": "PADI-site-profile", "retrievedAt": "2026-10-08", "limitations": "Coordinates exactly match the atlas. PADI describes a man-made bathing lake, shore entry, freshwater, and visibility that can vary from 4–10 m to near zero with conditions and bottom disturbance.", "claims": ["site-identity", "location", "setting", "access", "water-type", "visibility-variability"]},
            {"label": "Burgenland Tourism: Diving at Neufelder See", "url": "https://www.burgenland.info/erleben/sportlich-aktiv/im-wasser/wassersport/tauchen", "sourceClass": "official-regional-tourism-dive-guide", "retrievedAt": "2026-10-08", "limitations": "Regional tourism authority reports maximum lake depth around 23 m, guide lines, and training platforms between 5 and 20 m; route depths depend on the selected entry and dive plan.", "claims": ["site-identity", "depth", "training-features", "navigation-features", "access"]},
        ],
    },
    "08f5963a-2b7e-4c30-920f-eab269a89431": {
        "description": (
            "Dreimaster is an offshore wooden sailing-ship wreck east of Fehmarn, resting at about 26 m and reachable only by boat. "
            "A local wreck guide describes a largely intact hull with visible cargo holds, anchor winch, and mast stumps, with anemones covering the wreck."
        ),
        "evidenceNote": "A 2019–2024 wreck survey publishes the wreck's coordinates (54°28.063′N, 11°25.273′E), which convert to approximately 54.46772, 11.42122; this is about 2.5 km from the atlas marker at 54.4772, 11.4547. The offset is notable but the survey's distinctive Fehmarn Dreimaster identity aligns with the canonical name; keep the marker offset visible for later review. The survey places the wreck at 26 m and revised earlier size/date assumptions; a regional wreck guide describes condition and boat-only access.",
        "authoringMethod": "AI-assisted synthesis of a published wreck survey and regional dive-wreck guide",
        "sources": [
            {"label": "Wrackforscher: Dreimaster Fehmarn survey report (2019)", "url": "https://www.wrackforscher.de/wp-content/uploads/2020/09/Kampagne2019_DreimasterFehmarn_ExpedBericht.pdf", "sourceClass": "published-wreck-survey", "retrievedAt": "2026-10-08", "limitations": "Survey identifies the Fehmarn Dreimaster at 54°28.063′N, 11°25.273′E, about 2.5 km from the atlas marker, and reports 26 m depth. Its survey is the basis for identity and depth; the offset merits coordinate review.", "claims": ["site-identity", "location", "wreck", "depth", "history"]},
            {"label": "Tauchen in Schleswig-Holstein: Der Dreimaster - Fehmarn", "url": "https://tauchen-in-schleswig-holstein.de/wracks/", "sourceClass": "regional-wreck-dive-guide", "retrievedAt": "2026-10-08", "limitations": "Regional guide describes an approximately 26 m wreck, boat-only access, anemone growth, and visible wreck structures; verify route and conditions with the local operator.", "claims": ["wreck-condition", "access", "depth", "topography"]},
        ],
    },
    "0566eeed-4aaf-4ade-82bf-c6cc56c2cdc3": {
        "description": (
            "Dauin Coast is a regional dive-area marker representing more than 30 separate sites along Negros Oriental, rather than one individual reef route. "
            "The coordinate-matched PADI contributor describes the area’s mix of sandy slopes, small reef life, and boat or shore access; plan a specific site with a local operator."
        ),
        "evidenceNote": "The PADI profile exactly matches the atlas coordinates but explicitly covers over 30 different dive sites along the coast. It is summarized as a regional directory marker to preserve that scope; its broad 30 m maximum and dive-type list should not be read as attributes for every individual site. Nearby individual dive sites remain separately mapped.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI profile, explicitly scoped as a regional dive-area marker",
        "sources": [
            {"label": "PADI: Dauin Coast dive-area profile", "url": "https://www.padi.com/dive-site/philippines/dauin-coast/", "sourceClass": "PADI-contributor-regional-dive-guide", "retrievedAt": "2026-10-08", "limitations": "Coordinates exactly match the atlas, but the page describes more than 30 distinct sites along the Dauin coast; its depth, access types, habitats, and sightings do not characterize one specific route.", "claims": ["regional-site-identity", "regional-topography", "access-context", "marine-life-reported"]},
        ],
    },
    "323054ee-7b97-43cd-854f-1ce40485ca99": {
        "description": (
            "Kakaban Jellyfish Lake is an inland brackish marine lake on Kakaban Island, known for its stingless jellyfish. "
            "Indonesia's tourism ministry describes the lake as the island's defining feature; the local tourism authority states that scuba diving is prohibited in the lake, so this marker is for a non-scuba snorkeling attraction."
        ),
        "evidenceNote": "The canonical marker identifies the lake, but it is not a scuba dive site. The local tourism authority states scuba diving and fins are prohibited in the protected jellyfish lake; Indonesia Travel describes the island and lake attraction. Summary labels this as snorkeling/non-scuba so the atlas does not imply dive access.",
        "authoringMethod": "AI-assisted synthesis of official Indonesian tourism and local tourism-authority guidance",
        "sources": [
            {"label": "Indonesia Travel: Kakaban Island and Jellyfish Lake", "url": "https://www.indonesia.travel/th/en/destination/1/east-kalimantan/derawan-archipelago---kakaban-island", "sourceClass": "official-national-tourism-guide", "retrievedAt": "2026-10-08", "limitations": "National tourism authority describes the island and its marine lake attraction; activity permissions are taken from local tourism authority guidance.", "claims": ["site-identity", "setting", "jellyfish-lake"]},
            {"label": "Indonesian Ministry of Tourism tourism-village authority: Kakaban Jellyfish Lake", "url": "https://jadesta.kemenpar.go.id/atraksi/pulau_kakaban_danau_uburubur", "sourceClass": "official-local-tourism-guidance", "retrievedAt": "2026-10-08", "limitations": "Local tourism authority states scuba diving and fins are prohibited in the lake and lists visitor rules; follow current site staff instructions.", "claims": ["site-identity", "water-type", "snorkeling-only", "access-restrictions", "conservation"]},
        ],
    },
    "196532e8-9173-4f3d-bbdd-db5751585c98": {
        "description": (
            "Sardina del Norte is a shore-access dive bay at Gáldar on Gran Canaria's north coast. "
            "The island's tourism authority identifies the area as a scuba-diving destination with underwater fissures and caves; a local site guide describes volcanic reef routes and reports depths of roughly 4–25 m."
        ),
        "evidenceNote": "The site-specific guide's mapped point (28.154, -15.704) is about 0.6 km from the atlas marker, near the same named Sardina bay. The official Gran Canaria tourism page establishes the coastal dive area and fissures/caves; depth and route details are attributed to the local dive-site guide and should be confirmed with a local operator.",
        "authoringMethod": "AI-assisted synthesis of official Gran Canaria tourism guidance and a local site reference",
        "sources": [
            {"label": "Gran Canaria Official Tourism: diving in natural reserves", "url": "https://www.grancanaria.com/turismo/it/10-lugares-que-no-te-puedes-perder/proposte-originali/immersioni-nelle-riserve-naturali/", "sourceClass": "official-island-tourism-dive-guide", "retrievedAt": "2026-10-08", "limitations": "Identifies Sardina del Norte and Caleta Baja as coastal dive areas with underwater cave/fissure habitat; route-specific details and conditions are not provided.", "claims": ["site-identity", "regional-location", "topography", "cave-context"]},
            {"label": "BuceoMap: Sardina del Norte", "url": "https://centrosdebuceo.es/puntos-inmersion/sardina-del-norte/", "sourceClass": "local-dive-site-reference", "retrievedAt": "2026-10-08", "limitations": "Site guide point is about 0.6 km from the atlas marker but within the same Sardina bay. Its 4–25 m depth, shore access, and life descriptions are editorial site guidance, not a current conditions report.", "claims": ["site-identity", "access", "depth", "route-context", "marine-life-reported"]},
        ],
    },
    "0061b719-356f-4661-bf9b-6caa5ebbf227": {
        "description": (
            "Grand Makadi House Reef is a shore-access reef off Makadi Bay, with easy entry for training and night dives. "
            "It has vibrant coral, macro life, and a variety of reef fish."
        ),
        "evidenceNote": "The PADI contributor profile exactly matches the atlas coordinates and credits Aquarius Diving Club - Makadi. Aquarius's own current site guide describes direct shore access, training and night diving, and a 0–30 m range; no fixed depth is included in the summary because routes differ and the PADI profile's 40 m maximum is not corroborated by the operator site page.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI profile and credited local dive operator's site guide",
        "sources": [
            {"label": "PADI: Grand Makadi house reef profile (contributed by Aquarius Diving Club - Makadi)", "url": "https://www.padi.com/dive-site/egypt/grand-makadi-house-reef/", "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08", "limitations": "Coordinates exactly match the atlas. PADI lists a 40 m maximum, while Aquarius's own site guide lists 0–30 m; depth is omitted because the route-specific range is unresolved. Marine-life reports are contributor supplied.", "claims": ["site-identity", "location", "coral", "marine-life-reported", "access"]},
            {"label": "Aquarius Diving Club: Makadi Bay house reef", "url": "https://www.aquariusredsea.com/makadi/dive-sites.html", "sourceClass": "credited-local-dive-operator-guide", "retrievedAt": "2026-10-08", "limitations": "Operator describes direct beach access, training and night diving, with a published 0–30 m range; route and depth depend on the dive plan.", "claims": ["access", "use", "coral", "depth-context"]},
        ],
    },
    "134daa05-6334-4142-b7e4-d235b26180c9": {
        "description": (
            "Electric Beach, also called Kahe Point, is a shore-entry Oahu dive where warm-water outfall pipes and adjacent natural reef support coral and reef fish. "
            "The coordinate-matched PADI contributor describes the pipes as artificial-reef structures; wildlife sightings vary."
        ),
        "evidenceNote": "PADI's site profile exactly matches the atlas coordinates and identifies the site as Electric Beach/Kahe Point. Its structured maximum depth of 2 m appears inconsistent with the reef site and is omitted; the summary uses only its description of the pipes and adjacent reef. Hawaii state documents separately identify the thermal outfall as a popular dive site, but are not used for detailed route or condition claims.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile and Hawaii state environmental reporting",
        "sources": [
            {"label": "PADI: Electric Beach site profile (contributed by Hawaii Eco Divers)", "url": "https://www.padi.com/dive-site/united-states-of-america-usa/electric-beach/", "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08", "limitations": "Coordinates exactly match the atlas. The 2 m structured maximum is not used because it conflicts with the scale of the described outfall reef; wildlife sightings are source-reported, not guaranteed.", "claims": ["site-identity", "location", "access", "topography", "artificial-reef", "marine-life-reported"]},
            {"label": "Hawaii DLNR: Waianae baseline environmental study", "url": "https://files.hawaii.gov/dlnr/reports-to-the-legislature/2009/bd/BD09-WaianaeBaselineEnvironmentalStudyFeb09.pdf", "sourceClass": "official-state-environmental-report", "retrievedAt": "2026-10-08", "limitations": "Identifies the Kahe power-plant thermal outfall, locally known as Electric Beach, as a popular dive site; it is regional environmental reporting, not a dive-route or current-conditions guide.", "claims": ["site-identity", "thermal-outfall-context", "dive-use"]},
        ],
    },
    "0923b563-8773-4b6a-8b75-57e229695073": {
        "description": (
            "Cala Vidre is a shallow shore-access cove near l'Ametlla de Mar, with Posidonia seagrass meadows and rocky underwater formations. "
            "The site reaches about 8 m; divers have reported octopus, nudibranchs, and crabs."
        ),
        "evidenceNote": "The PADI profile coordinates exactly match the atlas and credits DSDivers Cambrils. The 8 m maximum and habitat or wildlife descriptions are contributor-reported; they are not a current-condition assessment or guarantee of sightings.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor site profile",
        "sources": [
            {"label": "PADI: Cala Vidre site profile (contributed by DSDivers Cambrils)", "url": "https://www.padi.com/dive-site/spain/cala-vidre/", "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08", "limitations": "Coordinates exactly match the atlas. The contributor reports shore access, Posidonia, rock formations, and an 8 m maximum; habitat and wildlife descriptions are not independently confirmed here.", "claims": ["site-identity", "location", "access", "topography", "habitat", "depth", "marine-life-reported"]},
        ],
    },
    "0235176f-5cad-461d-b931-64c7e4c332f8": {
        "description": (
            "Amphoras is a Sharm el-Sheikh reef dive with a sandy slope, coral pinnacles, and scattered amphora fragments from a historic shipwreck. "
            "Local operators describe drift routes along the slope; the Red Sea Diving College places amphora remains near 28 m and describes them as coral-encrusted."
        ),
        "evidenceNote": "The PADI contributor profile exactly matches the atlas coordinates and names the site Amphoras, but its structured 170 m maximum is implausible for this local reef profile and conflicts with operator descriptions; it is intentionally omitted. Two Sharm operators describe the sandy reef slope and amphora remains; the reported 25–30 m details are source guidance, not a planned depth.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI profile and two Sharm dive-operator guides",
        "sources": [
            {"label": "PADI: Amphoras Dive Site profile (contributed by Cinderella Eldawley Diving Center)", "url": "https://www.padi.com/dive-site/egypt/amphoras-dive-site/", "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08", "limitations": "Coordinates exactly match the atlas. PADI's structured 170 m maximum conflicts with local operator depth descriptions and is omitted from the summary; its type labels and marine-life list are contributor supplied.", "claims": ["site-identity", "location", "topography", "historical-feature"]},
            {"label": "Red Sea Diving College: Amphoras", "url": "https://redseacollege.com/%20all-dive-sites/amphoras-1/", "sourceClass": "local-dive-operator-site-guide", "retrievedAt": "2026-10-08", "limitations": "Operator describes a gentle reef slope and amphora cargo around 28 m; this reported depth may vary by route and is not a dive plan.", "claims": ["topography", "archaeological-feature", "depth", "access"]},
            {"label": "Emperor Divers: Sharm el-Sheikh Amphoras", "url": "https://www.emperordivers.com/day-diving-location-subpage/sharm-diving/", "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08", "limitations": "Operator describes a sandy slope beginning around 12 m, coral pinnacles, drift diving, and historical amphora remains; site conditions and routes vary.", "claims": ["topography", "access", "depth-context", "archaeological-feature"]},
        ],
    },
    "05edfa71-e4c2-4d64-9c35-ff974a837d10": {
        "description": (
            "Olowalu Beach is a shallow shore-entry dive in Maui, where a gently sloping sandy bottom leads to coral formations. "
            "It is used for training and refresher dives, with a reported maximum depth of 3 m."
        ),
        "evidenceNote": "PADI's site profile coordinates exactly match the atlas. The description and 3 m maximum are contributor-reported; the source's marine-life and visibility claims are not presented as guaranteed sightings or current conditions.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor site profile",
        "sources": [
            {"label": "PADI: Olowalu Beach site profile", "url": "https://www.padi.com/dive-site/united-states-of-america-usa/olowalu-beach/", "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08", "limitations": "Coordinates exactly match the atlas. The contributor reports shore access, a sloping sandy bottom, coral formations, training use, and a 3 m maximum; conditions and sightings can vary.", "claims": ["site-identity", "location", "access", "topography", "depth", "use"]},
        ],
    },
    "0d71c1c4-fb83-41f8-8b55-f05ee9f4d699": {
        "description": (
            "Cynthiana is a shore-accessible bay dive near Paphos, with two reefs, gullies, walls, overhangs, and swim-throughs described by the local PADI contributor. "
            "The contributor reports routes reaching 20 m and says the bay is used for introductory dives as well as other experience levels."
        ),
        "evidenceNote": "The PADI contributor profile coordinates exactly match the atlas marker and credits Abyss Dive Centre. A second PADI page titled Cynthiana Beach has different coordinates (about 7 km away), so only the exact-coordinate Cynthiana profile is used. Depth and route descriptions are source-reported, not a dive plan.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor site profile",
        "sources": [
            {"label": "PADI: Cynthiana site profile (contributed by Abyss Dive Centre)", "url": "https://www.padi.com/dive-site/cyprus/cynthiana/", "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08", "limitations": "Coordinates exactly match the atlas. The contributor describes two reefs, swim-throughs, gullies, walls, overhangs, and routes to 20 m; follow local guidance for the chosen route.", "claims": ["site-identity", "location", "access", "topography", "depth", "use", "marine-life-reported"]},
        ],
    },
    "2f9cfb27-b408-4665-aa68-39cd5f1c1270": {
        "description": (
            "Terme del Lacus is a submerged Roman bath complex within Baia's underwater archaeological park, with polychrome mosaic and marble floors. "
            "The remains lie about 4 m deep, and dives reach about 5 m."
        ),
        "evidenceNote": "The canonical marker is in the Baia underwater-park cluster and matches the official park's named Terme del Lacus dive site. The park's archaeology page reports about 4 m for the remains, while its dive booking page lists a 5 m maximum; both are source-reported site figures.",
        "authoringMethod": "AI-assisted synthesis of the archaeological park's site description and dive guidance",
        "sources": [
            {"label": "Submerged Archaeological Park of Baia: Terme del Lacus", "url": "https://parcoarcheologicosommersodibaia.it/en/the-dives/terme-del-mare/", "sourceClass": "official-archaeological-park-site-guide", "retrievedAt": "2026-10-08", "limitations": "The park describes mosaics, marble floors, thermal rooms, and remains at about 4 m; this is site guidance, not a dive plan.", "claims": ["site-identity", "archaeology", "topography", "depth"]},
            {"label": "Submerged Archaeological Park of Baia: Terme del Lacus dive information", "url": "https://www.parcoarcheologicosommersodibaia.it/en/the-dives/terme-del-mare/", "sourceClass": "official-park-dive-guide", "retrievedAt": "2026-10-08", "limitations": "Park dive information lists a 5 m maximum and low difficulty; these are published figures and can differ by route.", "claims": ["site-identity", "depth", "difficulty", "access-guidance"]},
        ],
    },
    "4805dde2-d4e8-4953-b163-2d5ed794d774": {
        "description": (
            "Villa con Ingresso a Protiro is a submerged Roman villa in Baia's archaeological park, with distinctive floor decoration and remains of the surrounding ancient street and shops. "
            "The local park dive operator describes a porticoed entrance and stone benches; the site reaches about 5 m."
        ),
        "evidenceNote": "The official park identifies Villa a Protiro among its dive sites and describes pavement decoration, a street, and adjacent tabernae; the operator gives the portico-and-benches detail. The canonical marker matches the named site. The 5 m figure is atlas metadata and is not used as a planned depth.",
        "authoringMethod": "AI-assisted synthesis of official archaeological-park and local dive-operator descriptions",
        "sources": [
            {"label": "Submerged Archaeological Park of Baia: visit the submerged park", "url": "https://www.parcoarcheologicosommersodibaia.it/en/visit-the-submerged-park-of-baia/", "sourceClass": "official-archaeological-park-guide", "retrievedAt": "2026-10-08", "limitations": "The park page describes the Villa a Protiro and surrounding archaeological remains at park scale; route details depend on the guided dive.", "claims": ["site-identity", "archaeology", "topography"]},
            {"label": "Subaia Diving Napoli: Baia park dive tour", "url": "https://www.subaia.com/diving-tour-in-the-submerged-archaeological-park-of-baia-single-immersion/", "sourceClass": "local-dive-operator-guide", "retrievedAt": "2026-10-08", "limitations": "Operator describes a porticoed entrance, two stone benches, and a 5 m depth; treat depth as published site guidance, not a dive plan.", "claims": ["site-identity", "topography", "depth", "archaeology"]},
        ],
    },
    "687f2133-db30-4048-b1c0-7e2a98aca94d": {
        "description": (
            "Portus Julius is the submerged remains of a Roman naval harbor at Baia, commissioned in 37 BC and once linked by a navigable canal to Lakes Lucrino and Averno. "
            "The archaeological park says divers can see harbor structures and mosaics between about 3 and 5 m depth."
        ),
        "evidenceNote": "The official park dive page matches the site's name and Baia location and supplies the harbor history, visible remains, and 3–5 m range. The atlas marker falls within the mapped Baia park area; published depth is not a route plan.",
        "authoringMethod": "AI-assisted synthesis of the official underwater archaeological park dive page",
        "sources": [
            {"label": "Submerged Archaeological Park of Baia: Portus Julius", "url": "https://www.parcoarcheologicosommersodibaia.it/en/the-dives/portus-julius/", "sourceClass": "official-archaeological-park-dive-guide", "retrievedAt": "2026-10-08", "limitations": "The park reports remains at 3–5 m and low difficulty; the actual route and conditions are set by authorized local guides.", "claims": ["site-identity", "history", "archaeology", "topography", "depth", "difficulty"]},
        ],
    },
    "d6716da8-6839-4093-9928-b3675ea006f8": {
        "description": (
            "Secca delle Fumose, also called Smoky Reef, is a volcanic underwater site in Baia's archaeological park, where submerged masonry pillars are surrounded by active seabed fumaroles and sulfur deposits. "
            "The park reports an average depth near 12 m and a maximum around 16 m."
        ),
        "evidenceNote": "The official park source calls this site Smoky Reef and describes pylons believed to have protected Portus Julius, colonized pillars, active volcanic gas vents, and sulfur on the seabed. The Italian official park also lists Secca delle Fumose as a dive site; its 12 m average and 16 m maximum are source-reported, not a dive plan.",
        "authoringMethod": "AI-assisted synthesis of official archaeological-park dive and site references",
        "sources": [
            {"label": "Submerged Archaeological Park of Baia: Smoky Reef", "url": "https://www.parcoarcheologicosommersodibaia.it/en/the-dives/smoky-reef/", "sourceClass": "official-archaeological-park-dive-guide", "retrievedAt": "2026-10-08", "limitations": "The English page names the site Smoky Reef and gives an average 12 m and maximum 16 m; confirm the route and conditions with an authorized guide.", "claims": ["site-identity", "archaeology", "geology", "topography", "depth"]},
            {"label": "Submerged Archaeological Park of Baia: dive-site list", "url": "https://www.parcoarcheologicosommersodibaia.it/le-immersioni/", "sourceClass": "official-archaeological-park-site-list", "retrievedAt": "2026-10-08", "limitations": "The Italian park list uses the canonical local name Secca delle Fumose; it identifies the named site but does not add route details.", "claims": ["site-identity"]},
        ],
    },
    "9ac8897a-0aae-4f1a-9371-2e9272c02fc2": {
        "description": (
            "Target Rock is a shallow, shore-accessible reef-and-muck dive inside Morro Bay, reached by a short walk and rocky entry. "
            "The PADI contributor reports 10–25 ft depths and tide-dependent access; a local diver's guide describes kelp and large boulders, with a slightly broader 5–30 ft range."
        ),
        "evidenceNote": "The PADI site coordinates exactly match the atlas marker. The local guide point is about 20 m away and describes the same Morro Bay Target Rock; its 5–30 ft range differs from PADI's 10–25 ft, and tidal conditions should be checked locally.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI profile and local diver's site guide",
        "sources": [
            {
                "label": "PADI: Target Rock site profile (contributed by Slo Ocean Currents)",
                "url": "https://www.padi.com/dive-site/united-states-of-america-usa/target-rock/",
                "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Coordinates exactly match the atlas. The contributor reports 10–25 ft and says the site is tide-dependent; conditions can change with tide.",
                "claims": ["site-identity", "location", "access", "topography", "depth", "tide"],
            },
            {
                "label": "Let's Dive: Morro Bay Target Rock",
                "url": "https://letsdive.app/sites/morro-bay-target-rock",
                "sourceClass": "local-diver-site-guide", "retrievedAt": "2026-10-08",
                "limitations": "Contributor-mapped point is about 20 m from the atlas marker. The guide describes the same bay-side rock and reports a broader 5–30 ft depth range; hazards and conditions require local confirmation.",
                "claims": ["site-identity", "location", "access", "topography", "depth", "hazards", "tide"],
            },
        ],
    },
    "0373f3e6-7bd4-4df1-ad34-112082f23931": {
        "description": (
            "Escafandra is an underwater diving-helmet statue on the sandy seabed near Wied iz-Zurrieq, described by local dive guides as a landmark about halfway to the Um El Faroud wreck. "
            "The statue is about a five-minute swim from shore. The dive site reaches 35 m, while a local guide places the helmet itself at about 28 m."
        ),
        "evidenceNote": "This canonical row shares the exact coordinates and apparent helmet-statue identity with ESCAFANDRA, Wied iz-Zurrieq (Sur). PADI pages credit the same Malta dive center; a local site guide independently describes the helmet landmark. The 28 m feature depth and 35 m site maximum are separate source-reported measures.",
        "authoringMethod": "AI-assisted synthesis of a coordinate-matched PADI profile and Malta dive-site guides",
        "sources": [
            {
                "label": "PADI: Escafandra site profile (contributed by DS Divers Malta)",
                "url": "https://www.padi.com/dive-site/malta/escafandra/",
                "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Coordinates exactly match both canonical Escafandra rows. The profile describes a five-minute swim from shore and lists a 35 m maximum but does not give the helmet's depth.",
                "claims": ["site-identity", "location", "access", "depth", "feature"],
            },
            {
                "label": "Malta Dive Sites: West Reef & Caves, Wied iz-Zurrieq",
                "url": "https://maltadives.com/sites/westreefcaves-wiedizzurrieq/en",
                "sourceClass": "local-dive-site-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local guide reports the helmet statue at about 28 m and as a navigation landmark to the nearby Um El Faroud; it covers the surrounding reef area as well.",
                "claims": ["feature", "depth", "route-context", "topography"],
            },
            {
                "label": "PADI: Escafandra, Wied iz-Zurrieq (Sur) profile",
                "url": "https://www.padi.com/dive-site/malta/escafandra-wied-iz-zurrieq-sur/",
                "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Duplicate-name PADI profile with the exact same coordinates; it describes the site as a five-minute swim from shore and lists 35 m maximum depth.",
                "claims": ["site-identity", "location", "access", "depth"],
            },
        ],
    },
    "22c2bb64-4ce0-4043-ba96-31b5b7c480e5": {
        "description": (
            "Escafandra is an underwater diving-helmet statue on the sandy seabed near Wied iz-Zurrieq, described by local dive guides as a landmark about halfway to the Um El Faroud wreck. "
            "The statue is about a five-minute swim from shore. The dive site reaches 35 m, while a local guide places the helmet itself at about 28 m."
        ),
        "evidenceNote": "This canonical row shares the exact coordinates and apparent helmet-statue identity with Escafandra. PADI pages credit the same Malta dive center; a local site guide independently describes the helmet landmark. The 28 m feature depth and 35 m site maximum are separate source-reported measures.",
        "authoringMethod": "AI-assisted synthesis of a coordinate-matched PADI profile and Malta dive-site guides",
        "sources": [
            {
                "label": "PADI: ESCAFANDRA, Wied iz-Zurrieq (Sur) profile (contributed by DS Divers Malta)",
                "url": "https://www.padi.com/dive-site/malta/escafandra-wied-iz-zurrieq-sur/",
                "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Coordinates exactly match both canonical Escafandra rows. The profile describes a five-minute swim from shore and lists a 35 m maximum but does not give the helmet's depth.",
                "claims": ["site-identity", "location", "access", "depth", "feature"],
            },
            {
                "label": "Malta Dive Sites: West Reef & Caves, Wied iz-Zurrieq",
                "url": "https://maltadives.com/sites/westreefcaves-wiedizzurrieq/en",
                "sourceClass": "local-dive-site-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local guide reports the helmet statue at about 28 m and as a navigation landmark to the nearby Um El Faroud; it covers the surrounding reef area as well.",
                "claims": ["feature", "depth", "route-context", "topography"],
            },
            {
                "label": "PADI: Escafandra site profile",
                "url": "https://www.padi.com/dive-site/malta/escafandra/",
                "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Duplicate-name PADI profile with the exact same coordinates; it describes the site as a five-minute swim from shore and lists 35 m maximum depth.",
                "claims": ["site-identity", "location", "access", "depth"],
            },
        ],
    },
    "578059b8-ae15-45d8-95ef-85ba2017a842": {
        "description": (
            "Mundoo Kandu is a boat-access channel dive in Laamu Atoll. A PADI contributor reports schools of fish, a manta cleaning station, and a maximum depth of 30 m. Advanced Open Water and drift-diving experience are recommended."
        ),
        "evidenceNote": "The PADI site profile coordinates exactly match the atlas marker. Marine-life sightings and site characterization are contributor-reported, not guarantees; current and route should be confirmed with the local dive team.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [
            {
                "label": "PADI: Mundoo Kandu dive-site profile",
                "url": "https://www.padi.com/dive-site/maldives/mundoo-kandu/",
                "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Coordinates exactly match the atlas marker. Description, marine-life sightings, 30 m maximum, and suggested training are contributor-reported; current conditions and route are not specified.",
                "claims": ["site-identity", "location", "channel", "access", "depth", "marine-life-reported", "training-guidance"],
            },
            {
                "label": "Mundoo Dive and Excursions: Laamu Atoll dive center",
                "url": "https://www.padi.com/dive-center/maldives/mundoo-dive-and-excursions/",
                "sourceClass": "PADI-dive-center-profile", "retrievedAt": "2026-10-08",
                "limitations": "Dive-center overview identifies Mundoo Kandu as a local channel site and describes strong currents across its local channels; it does not describe the specific route or this marker's conditions.",
                "claims": ["regional-location", "channel", "current-context", "local-access"],
            },
        ],
    },
    "51a1cfd4-a39b-425a-b180-5952c811f091": {
        "description": (
            "Neptune Islands is an offshore island group near the entrance to Spencer Gulf; South Australia’s Marine Parks guide describes remote islands rising from deep water, exposed to wind and waves, with seagrass, sandy and deep-water habitats. "
            "Access is by large boat from Port Lincoln, and the marine park is known for licensed great-white-shark cage-diving tours; this island-group marker does not identify one scuba route or mooring."
        ),
        "evidenceNote": "The PADI profile gives coordinates matching the atlas point and identifies the two-island-group site, but offers little underwater detail. The state marine-park guide supplies regional habitat and access context and describes cage-diving tourism; it does not establish a conventional scuba route at this marker.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI profile and South Australian Marine Parks guidance",
        "sources": [
            {
                "label": "PADI: Neptune Islands dive-site profile",
                "url": "https://www.padi.com/dive-site/australia/neptune-islands/",
                "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Coordinates match the atlas marker. The profile identifies the island groups but does not describe a specific underwater route, access procedure, or dive plan.",
                "claims": ["site-identity", "location", "island-group"],
            },
            {
                "label": "South Australian Marine Parks: Neptune Islands Group",
                "url": "https://www.marineparks.sa.gov.au/find-a-park/eyre-peninsula/neptune-islands",
                "sourceClass": "official-marine-park-guide", "retrievedAt": "2026-10-08",
                "limitations": "Describes the wider island-group marine park and general access, habitats, and licensed cage-diving tourism; not a scuba dive-site route guide.",
                "claims": ["regional-location", "offshore-access", "conditions-context", "habitat", "marine-life-reported", "cage-diving"],
            },
        ],
    },
    "89bcc2d9-e432-496c-ac34-5ec3ffdd4eb1": {
        "description": (
            "Cypress Spring is a freshwater spring on Holmes Creek, reached by boat, with a clear basin and a cavern described by its local dive-center contributor. "
            "That profile reports 30–35 ft for the spring and a cavern extending about 65 ft, but its structured maximum-depth field says 3 m; treat the measurements as unresolved and follow local access and training guidance."
        ),
        "evidenceNote": "The exact-coordinate PADI profile credits SEA Divers Scuba and supplies the descriptive details. Its narrative depth (30–35 ft) conflicts with the structured 3 m maximum; Hidden Rivers of Florida describes the basin as boat-access and says the cave should only be visited by trained and certified cavern divers.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI profile and a Florida springs/cave guide",
        "sources": [
            {
                "label": "PADI: Cypress Spring site profile (contributed by SEA Divers Scuba)",
                "url": "https://www.padi.com/dive-site/united-states-of-america-usa/cypress-spring/",
                "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Coordinates exactly match the atlas point. Narrative says the spring is 30–35 ft deep and a cavern extends about 65 ft; the structured maximum-depth field says 3 m.",
                "claims": ["site-identity", "location", "freshwater", "access", "depth", "cavern", "marine-life-reported"],
            },
            {
                "label": "Hidden Rivers of Florida: Cypress Spring",
                "url": "https://hiddenriversofflorida.com/cypress-spring/",
                "sourceClass": "Florida-spring-and-cave-guide", "retrievedAt": "2026-10-08",
                "limitations": "Guide describes the spring and associated cave system; it says the cave should only be visited by trained and certified cavern divers. Do not infer that its dimensions describe the PADI contributor's cavern measurement.",
                "claims": ["site-identity", "location", "freshwater", "boat-access", "cavern-training-limitations", "topography"],
            },
        ],
    },
    "9efab191-37d6-44e8-b96b-bdcd425e7aa5": {
        "description": (
            "La Madonna at Cirkewwa begins in a shallow lagoon and follows a reef drop to a small cave at about 18 m, where a Madonna statue was placed in 1987. "
            "Shore entry is available, and the site reaches up to 25 m."
        ),
        "evidenceNote": "The PADI profile's coordinates exactly match the atlas marker and credits DS Divers Malta. Its narrative places the statue cave at about 18 m while the structured profile and atlas list a 25 m maximum; those figures describe different depth measures.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [
            {
                "label": "PADI: La Madonna, Cirkewwa (Norte) (contributed by DS Divers Malta)",
                "url": "https://www.padi.com/dive-site/malta/la-madonna-cirkewwa-norte/",
                "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Contributor profile coordinates match the atlas marker. The narrative reports the statue cave at about 18 m; the structured maximum is 25 m. Access and depth should be confirmed locally.",
                "claims": ["site-identity", "location", "topography", "features", "history", "access", "depth"],
            },
            {
                "label": "Ċirkewwa Marine Park: wrecks and divers' attractions",
                "url": "https://cirkewwamarinepark.mt/wrecks-and-divers-attractions/",
                "sourceClass": "marine-park-site-guide", "retrievedAt": "2026-10-08",
                "limitations": "The park guide confirms the Madonna statue as one of the Cirkewwa diving attractions but describes the wider marine-park area rather than this specific entry route.",
                "claims": ["site-identity", "regional-location", "features"],
            },
        ],
    },
    "10f33892-1f4f-4fd7-b2f0-e7332529b19f": {
        "description": (
            "Fanning Springs is a freshwater spring basin where divers can explore the spring boil, limestone outcrops, fallen cypress logs, and sandy bottom. "
            "Published depth figures conflict: the atlas gives 20 m, while the PADI profile says 18–21 ft in its description and 2 m in its depth field. Confirm local depth information before planning."
        ),
        "evidenceNote": "The PADI profile's coordinates exactly match the atlas marker. Its narrative and structured depth field disagree with each other and with the atlas; all figures are stated with their source rather than resolved by inference.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI site profile and official Florida State Parks guidance",
        "sources": [
            {
                "label": "PADI: Fanning Springs State Park site profile",
                "url": "https://www.padi.com/dive-site/united-states-of-america-usa/fanning-springs-state-park/",
                "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Coordinates match the atlas marker. Narrative maximum depth is 18–21 ft while the structured maximum-depth field says 2 m; wildlife and seasonal closure information are source-reported.",
                "claims": ["site-identity", "location", "setting", "topography", "freshwater", "depth", "seasonal-access", "marine-life-reported"],
            },
            {
                "label": "Florida State Parks: Scuba at Fanning Springs",
                "url": "https://www.floridastateparks.org/learn/scuba-fanning-springs",
                "sourceClass": "official-park-guidance", "retrievedAt": "2026-10-08",
                "limitations": "Official park page establishes that scuba diving takes place at the spring but was not used to resolve the conflicting depth figures.",
                "claims": ["site-identity", "scuba-access"],
            },
        ],
    },
    "c6e09803-72eb-4cdd-ad4c-3ed8300cb0e9": {
        "description": (
            "Bjarnagjá is a lava ravine on Iceland’s Reykjanes Peninsula, filled mostly with fresh groundwater that mixes with seawater from the nearby coast. "
            "DIVE.IS describes sections with an overhead environment for divers with the appropriate training; its guide gives the ravine's depth as 18 m, while the atlas gives 20 m."
        ),
        "evidenceNote": "The PADI profile coordinate exactly matches the atlas marker and credits DIVE.IS. DIVE.IS gives 18 m in its narrative, whereas PADI's structured profile and the atlas list 20 m; the figures are retained as reported rather than reconciled.",
        "authoringMethod": "AI-assisted synthesis of a coordinate-matched PADI profile and the credited local dive operator's guide",
        "sources": [
            {
                "label": "PADI: Bjarnagjá dive-site profile (contributed by DIVE.IS)",
                "url": "https://www.padi.com/dive-site/iceland/bjarnagja/",
                "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Contributor profile gives exact site coordinates and structured site data; its description credits DIVE.IS and reports 18 m in text, with 20 m in the structured maximum-depth field.",
                "claims": ["site-identity", "location", "geology", "water-type", "access", "depth", "features"],
            },
            {
                "label": "DIVE.IS: Bjarnagjá dive site",
                "url": "https://www.dive.is/dive-sites/bjarnagja",
                "sourceClass": "dive-operator-site-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local operator's site guide; overhead sections require appropriate training and experience, as the guide states. Site conditions and access can change.",
                "claims": ["site-identity", "geology", "water-type", "depth", "overhead-environment", "training-limitations"],
            },
        ],
    },
    "3d4dff04-8a6e-455f-80f7-feee1abab1a6": {
        "description": (
            "El Palmer is a shore-entry dive from the beach near Aguadulce, reaching about 14 m. "
            "Aquatours describes the nearby Sierra de Gádor cliff dives as Posidonia over sand and rock, with collapsed rocks forming cracks and small caves."
        ),
        "evidenceNote": "The atlas point is within about 30 m of mapped El Palmer beach; the site profile supplies entry and depth details. Aquatours describes the adjacent cliff-diving area generally, not this exact route, so those seabed features are regional context.",
        "authoringMethod": "AI-assisted synthesis of a site profile, local operator guide, and mapped beach location",
        "sources": [
            {
                "label": "Diving.Voyage: El Palmer site profile",
                "url": "https://diving.voyage/dive-sites/el-palmer-892242",
                "sourceClass": "dive-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Site profile reports shore entry from the beach and 14 m maximum depth; no underwater route narrative is provided.",
                "claims": ["site-identity", "access", "depth"],
            },
            {
                "label": "Aquatours Almería: dive sites around Aguadulce",
                "url": "https://www.aquatoursalmeria.es/bucear-en-roquetas-de-mar-los-acantilados-de-la-sierra-de-gador-almeria-y-el-paraje-natural-punta-entinas-sabinar/puntos-de-inmersion/",
                "sourceClass": "dive-operator-regional-guide", "retrievedAt": "2026-10-08",
                "limitations": "Describes the Sierra de Gádor cliff-diving area generally rather than the El Palmer mooring or route; habitat features are regional context.",
                "claims": ["regional-location", "topography", "habitat", "features"],
            },
            {
                "label": "Mapcarta / OpenStreetMap: El Palmer beach",
                "url": "https://mapcarta.com/es/W1361676569",
                "sourceClass": "mapped-location", "retrievedAt": "2026-10-08",
                "limitations": "Mapped beach point is a geographic identity cross-check, not a dive-site condition source.",
                "claims": ["site-identity", "location"],
            },
        ],
    },
    "17d192d9-37b8-4890-8c1b-d9589df26b12": {
        "description": (
            "Dom João de Castro is an offshore volcanic seamount whose caldera and summit vents form the focus of the dive; the summit is reported at about 13 m. "
            "Boat trips take roughly 110–160 minutes. Dives reach about 60 m, with moderate to strong currents; the site suits experienced divers."
        ),
        "evidenceNote": "The official Azores dive-site profile names this bank and gives access, depth, current, and experience information. Its narrative reports a 13 m summit; confirm the route and conditions with the local operator.",
        "authoringMethod": "AI-assisted synthesis of the official Azores tourism dive-site profile",
        "sources": [
            {
                "label": "Azores Scuba Diving: Banco D. João de Castro",
                "url": "https://dive.visitazores.com/en/divespots/banco-d-joao-de-castro",
                "sourceClass": "official-tourism-dive-site-guide", "retrievedAt": "2026-10-08",
                "limitations": "Official tourism guide; access times, depth figures, currents, and wildlife descriptions are published site guidance, not a current trip report or dive plan.",
                "claims": ["site-identity", "geology", "access", "depth", "current", "experience-level", "marine-life-reported"],
            },
        ],
    },
    "95d28224-52a2-43af-87f6-23a6e05edc03": {
        "description": (
            "Chapeirão Faca Cega is a coral pinnacle cluster in Abrolhos with a hollow chamber nearly 20 m across and passages opening into the formation. "
            "DiveAtlas gives 24 m, while the SSI profile describes the chamber at about 25 m. Plan the overhead route with a local guide."
        ),
        "evidenceNote": "The SSI profile and Reefwander site point identify the same uniquely named Abrolhos site at the exact atlas coordinates. DiveAtlas lists 24 m; the source describes the chamber reaching about 25 m.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate SSI profile and linked site guide",
        "sources": [
            {
                "label": "SSI MyDiveGuide Abrolhos / Chapeirão Faca Cega profile",
                "url": "https://www.scubago.com/pt/explore/divesite/abrolhos-chapeiro-faca-cega-113595",
                "sourceClass": "SSI-dive-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "The SSI member profile reports a chamber depth near 25 m, one metre deeper than the atlas listing, and an approximate width; wildlife sightings are user-generated and are not presented as guarantees.",
                "claims": ["site-identity", "topography", "depth", "features", "marine-life-reported"],
            },
            {
                "label": "Reefwander Chapeirão Faca Cega guide",
                "url": "https://reefwander.com/diving/abrolhos/chapeirao-faca-cega/",
                "sourceClass": "dive-site-guide", "retrievedAt": "2026-10-08",
                "limitations": "The guide attributes the dive-site profile to ScubaGo/SSI and publishes the same coordinates; depth describes the chamber bottom, not a recommended dive plan.",
                "claims": ["site-identity", "location", "topography", "depth", "route-limitations"],
            },
        ],
    },
    "8610d632-8345-477b-97f3-2a230c708669": {
        "description": (
            "Talisay Point is a boat-access Moalboal site off Basdiot, about 1 km from Panagsama Beach. Local dive centers describe a sloping reef and wall with canyons and small caves; Neptune Diving gives a 5–15 m depth range and reports turtles in the area."
        ),
        "evidenceNote": "Neptune Diving's published coordinates are about 70 m from the atlas marker; a second Moalboal dive-center guide describes the same Talisay wall. Depths and wildlife reports are operator-provided.",
        "authoringMethod": "AI-assisted synthesis of two local Moalboal dive-center guides",
        "sources": [
            {
                "label": "Cebu Neptune Diving Adventure Talisay Point guide",
                "url": "https://www.neptunediving.com/talisay-point/",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Operator-reported site coordinates are approximately 70 m from the atlas marker; depth, visibility, current, and sightings are not guarantees.",
                "claims": ["site-identity", "location", "access", "topography", "depth", "marine-life-reported"],
            },
            {
                "label": "Pescador Diving Center Moalboal dive-site guide",
                "url": "https://pescadordivingcenter.com/dive-sites",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Regional operator guide describes Talisay but does not provide coordinates; its marine-life observations are not guarantees.",
                "claims": ["site-identity", "topography", "features", "marine-life-reported"],
            },
        ],
    },
    "a2049eb1-6faa-40fc-9000-88bd158dd71c": {
        "description": (
            "Tiger Reef is an offshore Dahab reef and wall dive reached by boat. The local Dahab guide describes routes around 10–30 m, commonly as a drift, with variable currents; PADI's exact-coordinate profile confirms the site identity and reef classification."
        ),
        "evidenceNote": "The PADI profile coordinates exactly match the atlas point. Route depth and current guidance come from a local guide and can change with conditions; Tiger Reef is distinct from Tiger Canyon.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI profile and local Dahab dive-site guide",
        "sources": [
            {
                "label": "PADI Tiger Reef site profile (contributed by Circle Divers Dahab)",
                "url": "https://www.padi.com/dive-site/egypt/tiger-reef/",
                "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "The short PADI profile confirms the exact site point and categories but does not provide route or condition details.",
                "claims": ["site-identity", "features"],
            },
            {
                "label": "Dahab101 Tiger Reef local guide",
                "url": "https://dahab101.com/dive-sites/tiger-reef",
                "sourceClass": "local-dive-site-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local guide reports typical route depths and variable conditions; these are not guaranteed and should be confirmed in the day's briefing.",
                "claims": ["access", "topography", "depth", "current", "route", "marine-life-reported"],
            },
        ],
    },
    "0fb73e76-0e8f-47fb-a528-8502ad34dcf5": {
        "description": (
            "Japanese Shipwreck is a wreck and reef dive with beach entry. A local Amed dive operator includes it on shore-dive trips, but the available profiles do not describe the wreck's condition or a specific route."
        ),
        "evidenceNote": "PADI's site point exactly matches the atlas marker; the local operator listing independently identifies Japanese Shipwreck as a shore-dive option in Amed.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI profile and Amed dive-operator listing",
        "sources": [
            {
                "label": "PADI Japanese Shipwreck site profile (contributed by Amed White Sand Divers)",
                "url": "https://www.padi.com/dive-site/indonesia/japanese-shipwreck/",
                "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "The contributor page supplies categories and coordinates but no narrative about wreck condition, history, or route.",
                "claims": ["site-identity", "features", "access"],
            },
            {
                "label": "PADI Adventures Amed shore-diving listing (Amed White Sand Divers)",
                "url": "https://travel.padi.com/dive-trip/bali/2-shore-dives-in-the-amed-area-12469/",
                "sourceClass": "dive-operator-activity", "retrievedAt": "2026-10-08",
                "limitations": "Operator activity page confirms Japanese Shipwreck as a shore-dive option but does not give a site briefing or wreck details.",
                "claims": ["site-identity", "access"],
            },
        ],
    },
    "698f468b-7461-43cc-ad50-1452d165fa39": {
        "description": (
            "Racha Noi is a white-sand dive site for wreck, beach, and ocean diving, reached by boat. "
            "The profile gives a 40 m maximum; it does not describe a specific route, so confirm route depth and conditions with a local guide."
        ),
        "evidenceNote": "PADI's profile coordinates exactly match the atlas point; the short description and listed maximum are contributor-provided.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI racha noi site profile",
            "url": "https://www.padi.com/dive-site/thailand/racha-noi/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "Brief member-contributed profile. Its 40 m figure is a listed site maximum, not a route recommendation; verify current conditions locally.",
            "claims": ["site-identity", "topography", "access", "features", "depth"],
        }],
    },
    "dad2a8bb-ea30-450b-a91d-c2ed0356e494": {
        "description": (
            "The Canyon is a shore-access Dahab dive that starts in a shallow sandy lagoon and descends into a narrow canyon, reported by PADI's contributor to begin around 20 m. "
            "The passage leads toward a coral dome with glassfish; the site's maximum depth is 40 m, though this is not a recommended route depth."
        ),
        "evidenceNote": "The PADI profile coordinates exactly match the atlas point; canyon dimensions and depth details are contributor-reported.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI The Canyon site profile",
            "url": "https://www.padi.com/dive-site/egypt/the-canyon-8/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "Member-contributed site description. The 40 m figure is a site maximum and does not describe a safe or suitable route for every diver.",
            "claims": ["site-identity", "access", "topography", "depth", "marine-life-reported"],
        }],
    },
    "9125d98e-62cd-417d-8f6a-36c3f12ed719": {
        "description": (
            "Anchor Point is a shore-entry training site with gently sloping areas and three sections of pinnacles, walls, and boulders. "
            "Kelp and nudibranchs are found around the reef, which reaches a maximum depth of about 30 m."
        ),
        "evidenceNote": "The PADI page coordinates exactly match the atlas point; the route and sightings are member-reported.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI Anchor Point site profile",
            "url": "https://www.padi.com/dive-site/united-kingdom/anchor-point/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "PADI member-contributed profile; marine-life reports and conditions vary.",
            "claims": ["site-identity", "access", "topography", "depth", "marine-life-reported"],
        }],
    },
    "3f088408-838f-4173-b41a-497769ccfef1": {
        "description": (
            "The Labyrinth is a boat-access dive site in Lombok where rock formations create a maze-like route. "
            "It has reef and wall diving, with a maximum depth of 30 m."
        ),
        "evidenceNote": "The PADI profile coordinates exactly match the atlas point; the maze-like route description is contributor-reported.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI The Labyrinth site profile",
            "url": "https://www.padi.com/dive-site/indonesia/the-labyrinth/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "The brief member-contributed description does not give a detailed route plan; confirm the route with the local boat guide.",
            "claims": ["site-identity", "access", "topography", "features", "depth"],
        }],
    },
    "2c06e8ef-4a4a-4dc4-aef1-1e9bd385fc96": {
        "description": (
            "Sandy Cove is a shore-entry Nova Scotia site with a gently sloping sandy bottom that transitions to gravel, cobble, granite boulders, and bedrock ridges. "
            "The local PADI contributor describes an easy training route, with sand around 9 m and a boulder route reaching about 12 m."
        ),
        "evidenceNote": "The PADI profile coordinates exactly match the atlas point; route depths are approximate contributor reports.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI Sandy Cove profile (contributed by East Coast Scuba & Watersports)",
            "url": "https://www.padi.com/dive-site/canada/sandy-cove/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "Local member-contributed description; route depths are approximate and conditions can vary.",
            "claims": ["site-identity", "access", "topography", "depth", "training-use"],
        }],
    },
    "d034025f-d9d1-4853-bcf5-895d518942bb": {
        "description": (
            "Princess Bay is a shore-entry Wellington reef site with two entry points. A PADI member-contributed guide describes rocky reef through weed to sand at about 8–10 m, "
            "with additional reef structure on the second route; the reported maximum depth is 18 m."
        ),
        "evidenceNote": "The PADI profile coordinates exactly match this atlas point; route depths and marine-life reports are member-contributed.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI Princess Bay profile (contributed by Dive HQ Wellington)",
            "url": "https://www.padi.com/dive-site/new-zealand/princess-bay/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "Local member-contributed route guide; reported depths and sightings vary by route and conditions.",
            "claims": ["site-identity", "access", "topography", "depth", "marine-life-reported"],
        }],
    },
    "3c8053a8-1c8b-4a68-adeb-8e17322aa92e": {
        "description": (
            "The Drop Off at Tulamben begins on a shallow reef and continues down a coral-covered wall. PADI's member-contributed profile reports the wall extends beyond 80 m, "
            "while DiveAtlas gives 30 m; confirm the planned route and depth with a local operator."
        ),
        "evidenceNote": "The PADI profile coordinates exactly match the atlas point; its reported wall depth (>80 m) differs from DiveAtlas's 30 m listing.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI Drop Off profile (contributed by Bali Dive Resort and Spa)",
            "url": "https://www.padi.com/dive-site/indonesia/drop-off-3/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "Member-contributed profile describes a wall beyond 80 m; this is not a recreational route recommendation and conflicts with the atlas's 30 m listing.",
            "claims": ["site-identity", "topography", "depth-conflict", "features"],
        }],
    },
    "b9dae2bb-a81c-499f-94c3-a6163cb057e3": {
        "description": (
            "At Mermaid Cove, a PADI member-contributed profile describes the submerged Emerald Princess statue at about 17 m and a concrete path that makes shore access possible. "
            "The page also classifies the site as a wall dive."
        ),
        "evidenceNote": "The PADI page coordinates exactly match the atlas record; the statue and depth details are member-reported.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI Mermaid Cove profile (contributed by Salish Sea Dive Inc.)",
            "url": "https://www.padi.com/de/tauchplatz/kanada/mermaid-cove/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "Member-contributed profile; the page is in German and its statue/depth details are source-reported.",
            "claims": ["site-identity", "access", "topography", "depth"],
        }],
    },
    "baff3fd1-cb64-45dd-bcdf-e3af1ffdfb26": {
        "description": (
            "Red Rock is a freshwater shore dive with a gently sloping, rocky start that becomes flatter and muddier with depth. "
            "The local PADI contributor reports vegetation ending around 5–7 m, a maximum depth of 11 m, and seasonal visibility of roughly 2–10 m."
        ),
        "evidenceNote": "The PADI profile coordinates exactly match the atlas point and credit a Kazakhstan dive center; the profile URL's country path says Russia.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI Red Rock profile (contributed by 2Mira Dive Center Kazakhstan)",
            "url": "https://www.padi.com/dive-site/russia/red-rock-3/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "The exact coordinates and contributor identify the site, but the PADI URL country path is inconsistent; bottom, visibility, and depth details are member-reported.",
            "claims": ["site-identity", "setting", "access", "topography", "depth", "visibility"],
        }],
    },
    "5d9cea11-be76-4edb-a5c4-c9c6460f4a20": {
        "description": (
            "Lighthouse is a central Dahab beach-access reef with large coral pinnacles and a saddle leading to a coral garden. "
            "Circle Divers describes a sloping sandy and seagrass approach with several route options; check the chosen profile with a local guide."
        ),
        "evidenceNote": "The PADI profile coordinates exactly match the atlas point. A local operator guide reports 0–30 m while DiveAtlas lists 18 m, so no depth is stated here.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI profile and local operator guide",
        "sources": [
            {
                "label": "PADI Lighthouse site profile (contributed by Circle Divers Dahab)",
                "url": "https://travel.padi.com/dive-site/egypt/lighthouse-3/",
                "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Exact-coordinate contributor profile; marine-life reports are observations, not guarantees.",
                "claims": ["site-identity", "topography", "features"],
            },
            {
                "label": "Circle Divers Dahab Lighthouse guide",
                "url": "https://www.circledivers.com/diving-in-dahab/dive-sites/lighthouse-dive-site-dahab",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local operator guide; it reports a 0–30 m profile that differs from DiveAtlas's 18 m listing, so that range is omitted from the summary.",
                "claims": ["site-identity", "access", "topography", "depth-conflict"],
            },
        ],
    },
    "3a57a92c-0e4a-4ac4-9f64-6e9750f4bc3a": {
        "description": (
            "At Pyramids near Amed, a local dive-center contributor describes artificial pyramid structures that have become reef habitat. "
            "Divers can enter from shore or by boat; the site reaches 40 m, and turtles have been reported."
        ),
        "evidenceNote": "The PADI contributor profile coordinates exactly match this atlas record; wildlife observations and the listed maximum are source-reported.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI Pyramids site profile (contributed by Ocean Dive League and Dive Culture)",
            "url": "https://www.padi.com/dive-site/indonesia/pyramids/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "PADI member-contributed profile; wildlife sightings and conditions vary, and the listed site maximum is not a route depth guarantee.",
            "claims": ["site-identity", "topography", "access", "depth", "marine-life-reported"],
        }],
    },
    "f5a83e08-859d-48cf-895b-0e1be29a862a": {
        "description": (
            "Koh Ma is described by a PADI member-contributed profile as a shelving reef around an island, descending from shallow coral into deeper black and soft corals. "
            "The profile reports reef fish and occasional pelagic fish, boat or shore entry, and a maximum depth of 25 m."
        ),
        "evidenceNote": "The PADI page uses the same Koh Ma name in Thailand and its coordinates are about 310 m from the atlas point; route details are source-reported.",
        "authoringMethod": "AI-assisted synthesis of a nearby same-name PADI contributor profile",
        "sources": [{
            "label": "PADI Koh Ma site profile",
            "url": "https://www.padi.com/dive-site/thailand/koh-ma/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "PADI member-contributed profile; the source point is approximately 310 m from the atlas marker, and marine-life reports are not guarantees.",
            "claims": ["site-identity", "topography", "access", "depth", "marine-life-reported"],
        }],
    },
    "93362254-7978-4dfe-835b-5759e4d2995d": {
        "description": (
            "PADI's local Maui dive-center profile describes Airport Beach as a shore-entry site with a shallow reef and a second reef around 80 ft for advanced divers. "
            "The same page gives a 24 ft maximum in its depth field, which conflicts with its description; verify the route and depth with a local operator."
        ),
        "evidenceNote": "The PADI profile coordinates exactly match the atlas point; its narrative reef depth (~80 ft) conflicts with its structured 24 ft maximum.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI Airport Beach profile (contributed by Dive Maui)",
            "url": "https://www.padi.com/dive-site/united-states-of-america-usa/airport-beach/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "The contributor page contradicts itself on depth; its marine-life and route descriptions are source-reported and conditions vary.",
            "claims": ["site-identity", "access", "topography", "depth-conflict", "marine-life-reported"],
        }],
    },
    "77d62a39-b6b9-462b-8762-650dd7643ee0": {
        "description": (
            "PADI's member-contributed profile describes Turtle Rock as a shore-entry reef dive, reached by following the reef to the rock. "
            "The site has a sandy bottom, a wall, and a reported maximum depth of 40 m. Sea turtle sightings are possible but not guaranteed."
        ),
        "evidenceNote": "The PADI page coordinates exactly match this Curaçao record; site details and sightings are member-reported.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI Turtle Rock site profile (contributed by Scubacao Diving Adventures)",
            "url": "https://www.padi.com/dive-site/curacao/turtle-rock-2/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "PADI member-contributed description; marine-life sightings and conditions are not guaranteed.",
            "claims": ["site-identity", "access", "features", "depth", "marine-life-reported"],
        }],
    },
    "f9ccc89c-b28e-4bca-a88d-739ed44cb8eb": {
        "description": (
            "At Aquarium in Musandam, PADI's local dive-center contributor describes reef sections with staghorn coral around 8 m and sand patches "
            "between shallow reef at 5–9 m and deeper reef at 15–20 m. The contributor notes that current can be strong at one corner, so confirm the route locally."
        ),
        "evidenceNote": "The PADI profile is about 0.8 km from the atlas point and has the same site name and country; exact marker placement may differ.",
        "authoringMethod": "AI-assisted synthesis of a nearby same-name PADI contributor profile",
        "sources": [{
            "label": "PADI Aquarium site profile (contributed by Musandam Discovery Diving)",
            "url": "https://www.padi.com/dive-site/oman/aquarium-7/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "PADI member-contributed guide; the source coordinate is approximately 0.8 km from the atlas marker, and current and route details vary.",
            "claims": ["site-identity", "topography", "depth", "current", "access"],
        }],
    },
    "687dc661-5c03-45c6-bdf5-8d8e23bdb337": {
        "description": (
            "Aliwal Shoal is a broad reef destination about 5 km off KwaZulu-Natal. PADI's member-contributed profile describes boat access, "
            "a range of shallow and deeper reef dives, and nearby wreck dives. The reported maximum depth is 40 m. The marker represents the wider shoal, not one fixed route."
        ),
        "evidenceNote": "The PADI page's coordinates exactly match this atlas record; its description covers the wider shoal and its varied dive sites.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI Aliwal Shoal site profile (contributed by Urban Dive and Aliwal Dive Centre)",
            "url": "https://www.padi.com/dive-site/south-africa/aliwal-shoal/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "PADI member-contributed profile for the wider shoal; the 40 m figure is a destination maximum, not a depth guarantee for every route.",
            "claims": ["site-identity", "location", "topography", "access", "depth"],
        }],
    },
    # The PADI profile is an exact normalized name/country and zero-offset
    # coordinate match. Two local Bodrum operators provide the route details;
    # keep them attributed because route depths and conditions are operator-reported.
    "e5c9a583-ed90-4386-8a99-89a58a04acfd": {
        "description": (
            "Local Bodrum dive operators describe Smugglers Bay on Black Island as a boat-access site with two routes along rocky walls. "
            "They report Posidonia meadows and amphorae on the sandy bottom; one operator describes the left route dropping to about 35 m, "
            "so confirm the route and conditions with the local guide."
        ),
        "evidenceNote": "Site identity is supported by an exact name/country and zero-offset PADI profile match; route details are reported by local Bodrum operators.",
        "sources": [
            {
                "label": "The Divers Club, Bodrum",
                "url": "https://www.thediversclub.com.tr/?dive-sites=smugglers-bay&lang=en",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local operator route guide; depths and site conditions are reported by the operator and should be confirmed before diving.",
                "claims": ["location", "access", "topography", "bottom", "depth"],
            },
            {
                "label": "Blue Escape Diving, Bodrum",
                "url": "https://www.blueescapediving.com/en/bodrum-dive-sites/smugglers-bay-bodrum",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local operator description; marine-life observations and conditions are not guaranteed for a particular dive.",
                "claims": ["location", "access", "topography", "marine-life-reported"],
            },
            {
                "label": "PADI Travel site profile (coordinate-matched review record)",
                "url": "https://travel.padi.com/dive-site/turkey/smagglers-bay/",
                "sourceClass": "contributor-site-profile", "retrievedAt": "2026-06-22",
                "limitations": "Used to confirm site identity only; the retained profile snapshot does not include a usable narrative description.",
                "claims": ["site-identity"],
            },
        ],
    },
    # These profiles were matched to the canonical site's unique name and
    # location context; the generated prose stays within linked operator guides.
    "9a7219e3-bf73-4939-856a-25bacca4ad5d": {
        "description": (
            "The King Cruiser is an 85 m passenger-ferry wreck between Phuket and Phi Phi that has become an artificial reef. "
            "Operator and local guides describe upper sections at roughly 16–18 m and the stern near 31–32 m. DiveAtlas gives 26 m, "
            "so confirm the planned route and depth reference with the boat guide."
        ),
        "evidenceNote": "Depth reports differ: DiveAtlas lists 26 m; local guides describe the stern near 31–32 m and upper sections around 16–18 m.",
        "sources": [
            {
                "label": "Indepth Dive Centre Phuket",
                "url": "https://www.idcphuket.com/scuba-diving/king-cruiser-phuket-wreck-diving/",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Operator guide; depth figures describe different parts of the wreck and can change as the structure deteriorates.",
                "claims": ["topography", "history", "depth", "access"],
            },
            {
                "label": "Phuket 101 local dive guide",
                "url": "https://www.phuket101.net/the-king-cruiser-wreck/",
                "sourceClass": "local-dive-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local guide, not an operator; depth and condition descriptions are time-sensitive.",
                "claims": ["topography", "history", "depth", "access"],
            },
        ],
    },
    "70a60f2e-b6da-4752-bade-757c9300cb7e": {
        "description": (
            "Go Dive Lanta identifies Koh Haa Neua #1, also called Koh Haa Neung, as a reef site with a wall and a chimney-like swim-through. "
            "Its guide gives a 3–30 m depth range; choose a route with the local operator."
        ),
        "evidenceNote": "The operator guide uses Koh Haa Neua, Koh Haa Neung, and island #1 as names for this site; depth is source-reported.",
        "sources": [
            {
                "label": "Go Dive Lanta",
                "url": "https://www.godive-lanta.com/koh-haa",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Operator destination guide; route details and depth range are reported and may vary by conditions.",
                "claims": ["site-identity", "topography", "depth"],
            },
            {
                "label": "Master Liveaboards Thailand itinerary guide",
                "url": "https://cloudfront.masterliveaboards.com/website-docs/Thailand-Myanmar/Itineraries/Southern-Thailand-Itinerary.pdf",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Liveaboard itinerary guide; route and depth details are source-reported and depend on the dive plan.",
                "claims": ["site-identity", "topography"],
            },
        ],
    },
    "b3ab9f2c-24b6-42f3-8464-76bb2f94582b": {
        "description": (
            "Local Koh Lanta operators identify Koh Haa #6 as Koh Haa Lek, a small pinnacle/islet connected underwater to Koh Haa Yai. "
            "Their guides describe a sloping reef and wall with coral, sea fans and barrel sponges; reported depths reach about 30 m."
        ),
        "evidenceNote": "The #6, Koh Haa Lek, and Koh Haa Hog names are used for the same small site in local operator guides; depth and marine-life notes are source-reported.",
        "sources": [
            {
                "label": "Go Dive Lanta",
                "url": "https://www.godive-lanta.com/koh-haa",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Operator destination guide; route details and depth range are reported and may vary by conditions.",
                "claims": ["site-identity", "topography", "depth", "marine-life-reported"],
            },
            {
                "label": "Apo Dhatu Divers",
                "url": "https://apo-dhatu-divers.com/en/dive-sites-koh-lanta/",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local operator guide; descriptions and conditions are source-reported, not guarantees for a particular dive.",
                "claims": ["site-identity", "topography", "depth", "marine-life-reported"],
            },
        ],
    },
    "3b0fc0b3-0803-4c75-bf82-23402d1e7549": {
        "description": (
            "Hin Bida, also recorded as Shark Point in DiveAtlas, is a submerged coral reef and pinnacle east of the Phi Phi Islands, "
            "with a rounded main body, southern projections and a surrounding sandy bottom. Local dive guides report depths around 5–22 m; "
            "confirm the route and conditions with the boat guide."
        ),
        "evidenceNote": "The Hin Bida name, Phi Phi location, and nearby site coordinates support this match. Operator guides report 5–20 m and 5–22 m depth ranges.",
        "sources": [
            {
                "label": "MV Giamani liveaboard guide",
                "url": "https://www.mvgiamani.com/thailand-dive-sites/phi-phi-islands-dive-sites/hin-bida/",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Liveaboard operator guide; depths, current, visibility and wildlife vary by conditions.",
                "claims": ["site-identity", "location", "topography", "depth"],
            },
            {
                "label": "Blue Rides dive-site guide",
                "url": "https://www.bluerides.com/dive-sites/hin-bida",
                "sourceClass": "dive-site-guide", "retrievedAt": "2026-10-08",
                "limitations": "Third-party guide; site conditions and depth figures should be checked with a local operator.",
                "claims": ["site-identity", "location", "topography", "depth"],
            },
        ],
    },
    "43dd0188-2e7c-4a31-a0f8-4e33a15491f2": {
        "description": (
            "Below Sharm el-Sheikh's El Fanar lighthouse, Ras Umm Sid drops from a coral plateau into a wall lined with large gorgonian sea fans. "
            "A local operator places the main fan growth around 14–28 m and describes shore or short-boat access; currents along the wall vary, "
            "so confirm the route with the guide."
        ),
        "evidenceNote": "A dive-guide page gives coordinates about 25 m from this atlas point and identifies the El Fanar lighthouse site; depth and access details are source-reported.",
        "sources": [
            {
                "label": "Aquarius Red Sea dive guide",
                "url": "https://www.aquariusredsea.com/red-sea-blog/ras-um-sid-sharm-diving-guide.html",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local operator guide; current, route, and depth depend on the day's conditions and dive plan.",
                "claims": ["site-identity", "topography", "depth", "access", "current"],
            },
            {
                "label": "DiveCodex Ras Umm Sid guide",
                "url": "https://divecodex.com/sites/ras-umm-sid",
                "sourceClass": "dive-site-guide", "retrievedAt": "2026-10-08",
                "limitations": "Third-party guide; the published coordinate is used to support site identity, while route and conditions should be checked locally.",
                "claims": ["site-identity", "location", "topography", "depth"],
            },
        ],
    },
    "9282e010-0644-4340-a3c0-31ac0e4c4722": {
        "description": (
            "PADI's member-contributed profile describes Tiger Beach off West End, Grand Bahama, as a shallow sand-bottom dive where divers observe tiger sharks and other large fish. "
            "It reports typical depths around 8–10 m and a maximum of 20 m; wildlife encounters are not guaranteed."
        ),
        "evidenceNote": "The PADI profile coordinates match this atlas record; depth and marine-life details are member-reported.",
        "sources": [
            {
                "label": "PADI Tiger Beach site profile",
                "url": "https://www.padi.com/dive-site/bahamas/tiger-beach/",
                "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Member-contributed profile; wildlife encounters and conditions vary, and are not guaranteed.",
                "claims": ["site-identity", "location", "topography", "depth", "marine-life-reported", "access"],
            },
        ],
    },
    "83f9705d-3b5c-4578-9248-81d940109f38": {
        "description": (
            "Eel Garden is a Dahab shore-entry site where a sandy slope meets a coral garden. Its namesake garden eels stand out of the sand and retreat when approached quickly; "
            "the local guide describes a recreational profile of roughly 5–25 m."
        ),
        "evidenceNote": "The guide describes the Dahab site; eel sightings and the depth profile are source-reported and may vary by route and conditions.",
        "sources": [
            {
                "label": "Dahab101 Eel Garden guide",
                "url": "https://dahab101.com/dive-sites/eel-garden",
                "sourceClass": "local-dive-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local site guide; marine-life observations and the recreational depth profile are not guarantees for a particular dive.",
                "claims": ["site-identity", "access", "topography", "depth", "marine-life-reported"],
            },
        ],
    },
    "7207af80-ff9f-4b4c-84f2-65a4058a9e6d": {
        "description": (
            "Stetson Bank has open sand and gravel flats, low parallel rocky ridges, and larger outcroppings with sponges, algae, and scattered corals. "
            "NOAA describes this terrain as less coral-covered than the East and West Flower Garden Banks; marine-life sightings vary."
        ),
        "evidenceNote": "The atlas marker (28.17, -94.3) falls within NOAA's published Stetson Bank boundary. The habitat description is sanctuary-wide site guidance, not a description of one specific mooring route.",
        "authoringMethod": "AI-assisted synthesis of NOAA sanctuary habitat guidance and official boundary coordinates",
        "sources": [
            {
                "label": "NOAA Flower Garden Banks: What Will I See at Stetson Bank?",
                "url": "https://flowergarden.noaa.gov/visiting/stetsonwwis.html",
                "sourceClass": "official-marine-sanctuary-guide", "retrievedAt": "2026-10-08",
                "limitations": "Describes habitat and possible wildlife across Stetson Bank; sightings are not guaranteed and details are not tied to a specific mooring route.",
                "claims": ["topography", "habitat", "marine-life-reported"],
            },
            {
                "label": "NOAA Flower Garden Banks: Stetson Bank boundary points",
                "url": "https://flowergarden.noaa.gov/visiting/boundaries.html",
                "sourceClass": "official-site-boundary", "retrievedAt": "2026-10-08",
                "limitations": "The boundary supports the named-bank identity and regional location; it does not identify an individual dive route or mooring.",
                "claims": ["site-identity", "location"],
            },
        ],
    },
    "2269ba6f-4a19-4682-9246-f1368bd7ee84": {
        "description": (
            "Eagle Ray Alley is described in the SSI MyDiveGuide profile as a shallow dive on Utila's southeastern wall, with a buoy and a nearby cave. "
            "Published depth figures range from 4–18 m to about 24 m, so confirm the route and depth with a local guide."
        ),
        "evidenceNote": "The atlas marker is near the southeast side of Utila, matching the SSI profile's location description. Depth reports differ, and marine-life sightings are contributor-reported rather than guaranteed.",
        "authoringMethod": "AI-assisted synthesis of SSI MyDiveGuide and dive-site profile details",
        "sources": [
            {
                "label": "SSI MyDiveGuide Eagle Ray Alley profile",
                "url": "https://www.scubago.com/es/explore/divesite/eagle-ray-alley-826742",
                "sourceClass": "SSI-dive-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Member-contributed site profile; lists 4–18 m and user-reported wildlife. This differs from Just Gotta Dive's listed maximum of about 24 m.",
                "claims": ["site-identity", "location", "topography", "features", "depth", "marine-life-reported"],
            },
            {
                "label": "Just Gotta Dive Eagle Ray Alley profile",
                "url": "https://www.justgottadive.com/dive_resources/dive_sites/eagle-ray-alley",
                "sourceClass": "dive-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Lists a maximum depth of about 24 m and boat access but does not publish a coordinate; its depth differs from SSI's 4–18 m range.",
                "claims": ["site-identity", "access", "features", "depth-conflict", "marine-life-reported"],
            },
        ],
    },
    "849369e7-0c30-4761-871b-9417d1ba6f97": {
        "description": (
            "El Faro is a beach-entry dive site on La Palma's southern coast. The official island tourism guide describes a volcanic rock-and-sand shore and seabed popular with divers; it notes that wave action is often moderate, so entry conditions should be checked locally."
        ),
        "evidenceNote": "The PADI profile coordinates exactly match the atlas marker and credits Black Sand Diving on La Palma; the official tourism page describes the same-named beach and its coastal setting.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI profile and official La Palma tourism guidance",
        "sources": [
            {
                "label": "PADI El Faro dive-site profile (contributed by Black Sand Diving - La Palma)",
                "url": "https://www.padi.com/dive-site/spain/el-faro/",
                "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "The brief member-contributed profile confirms the exact site location and beach dive type; its common-sighting list is not a guarantee.",
                "claims": ["site-identity", "location", "access", "marine-life-reported"],
            },
            {
                "label": "Visit La Palma: El Faro",
                "url": "https://visitlapalma.es/playas/la-palma/el-faro/",
                "sourceClass": "official-tourism-guide", "retrievedAt": "2026-10-08",
                "limitations": "Describes the named beach and general coastal conditions, not a specific underwater route; wave conditions vary on the day.",
                "claims": ["location", "topography", "habitat", "conditions"],
            },
        ],
    },
    "5503bbfd-b0f0-48bf-9a64-4f54e436ee68": {
        "description": (
            "Pirapama is a nineteenth-century steamer wreck lying on sand off Recife, with many sections still identifiable. "
            "A site guide places it at 19–23 m and describes a boat-and-shotline descent; the published position matches the atlas coordinates."
        ),
        "evidenceNote": "Reefwander publishes the same coordinates as the atlas marker and cites SSI MyDiveGuide for its dive-site data. The summary omits the sinking date because historical sources conflict.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate wreck guide with cited SSI site data",
        "sources": [{
            "label": "Reefwander Pirapama wreck guide",
            "url": "https://reefwander.com/diving/recife-wrecks/pirapama/",
            "sourceClass": "dive-site-wreck-guide", "retrievedAt": "2026-10-08",
            "limitations": "Third-party guide publishes the matching site position and cites SSI MyDiveGuide; historical sources disagree on the wreck's sinking date, which is omitted.",
            "claims": ["site-identity", "location", "topography", "depth", "access", "route"],
        }],
    },
    "e4589883-ca17-48b0-ac19-e2f0f0e7e78d": {
        "description": (
            "Tavarua Wall lies off Tavarua Island facing Cloudbreak. A local Fiji operator describes a steep outer-reef wall and a shallow swim-through near the mooring line."
        ),
        "evidenceNote": "The atlas marker is immediately off Tavarua Island, matching the SSI site profile and Subsurface Fiji's named Tavarua Wall description. Operator-reported visibility and wildlife are left out because they vary.",
        "authoringMethod": "AI-assisted synthesis of an SSI site profile and local Fiji dive-operator guide",
        "sources": [
            {
                "label": "SSI MyDiveGuide Tavarua Wall profile",
                "url": "https://www.scubago.com/en/explore/divesite/tavarua-wall-100012",
                "sourceClass": "SSI-dive-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Member-contributed profile describes the site off Tavarua facing Cloudbreak; wildlife reports are not guarantees.",
                "claims": ["site-identity", "location", "topography", "features", "marine-life-reported"],
            },
            {
                "label": "Subsurface Fiji: Tavarua Wall",
                "url": "https://fijidiving.com/faq",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Operator description supports the outer-reef wall setting; visibility and wildlife reports vary and are not included as guarantees.",
                "claims": ["site-identity", "topography", "features", "marine-life-reported"],
            },
        ],
    },
    "8d0ad1fb-0ac5-42f8-8fca-87cd88c78788": {
        "description": (
            "La Herradura is a saltwater beach dive with both shore and boat entry and a reported maximum depth of 52 m. "
            "A local dive center operates from the bay and nearby Punta de la Mona; treat this as a site limit, not a planned route."
        ),
        "evidenceNote": "The PADI profile coordinates exactly match the atlas marker. Its 52 m figure is explicitly a maximum; the local operator describes the broader bay and nearby sites rather than a single route at this marker.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI profile and local La Herradura dive-center guidance",
        "sources": [
            {
                "label": "PADI La Herradura dive-site profile",
                "url": "https://www.padi.com/dive-site/spain/la-herradura-2/",
                "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "The PADI page is member-contributed and lists 52 m as a site maximum; it does not describe a standard route or recommended depth.",
                "claims": ["site-identity", "location", "access", "depth"],
            },
            {
                "label": "Buceo Marina La Herradura dive-center guide",
                "url": "https://www.buceomarina.com/",
                "sourceClass": "local-dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "The operator describes its wider La Herradura and Punta de la Mona service area, not a single profile at the atlas marker.",
                "claims": ["regional-access", "site-context"],
            },
        ],
    },
    "f9e4d56c-4768-45f6-84be-04af3b8fb359": {
        "description": (
            "Sapi Only Garden Eel is a Sapi Island dive reached most commonly by boat from Kota Kinabalu; the SSI MyDiveGuide profile says shore entry is also possible. "
            "The profile describes garden eels and reef fish, which should be treated as reported sightings rather than guaranteed encounters."
        ),
        "evidenceNote": "The site-specific SSI profile places the dive on Sapi Island and names its distinguishing garden-eel habitat; sightings and access details are contributor-reported.",
        "authoringMethod": "AI-assisted synthesis of an SSI MyDiveGuide site profile",
        "sources": [{
            "label": "SSI MyDiveGuide Sapi Only Garden Eel profile",
            "url": "https://www.scubago.com/en/explore/divesite/sapi-only-garden-eel-935348",
            "sourceClass": "SSI-dive-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "Member-contributed profile; access and marine-life details are source-reported and conditions vary.",
            "claims": ["site-identity", "location", "access", "topography", "marine-life-reported"],
        }],
    },
    "28af540d-af6a-4efa-9c33-b83a9a9bc368": {
        "description": (
            "Pefkos is a shallow beach-entry site in Fokia Bay, just outside the village on Rhodes. "
            "The exact-coordinate PADI profile describes rock overhangs and swim-throughs and reports a 5–14 m depth range."
        ),
        "evidenceNote": "The PADI profile coordinates exactly match the atlas marker and credits Waterhoppers Diving Schools; its depth and marine-life descriptions are contributor-reported.",
        "authoringMethod": "AI-assisted synthesis of an exact-coordinate PADI contributor profile",
        "sources": [{
            "label": "PADI Pefkos dive-site profile (contributed by Waterhoppers Diving Schools)",
            "url": "https://www.padi.com/dive-site/greece/pefkos/",
            "sourceClass": "contributor-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "Member-contributed site description; the listed depth range and marine-life reports can vary by route and conditions.",
            "claims": ["site-identity", "location", "access", "topography", "features", "depth", "marine-life-reported"],
        }],
    },
    "93c07b53-a3fe-45b7-aecd-9a7d471e005d": {
        "description": (
            "Petit Malendure is described in the SSI MyDiveGuide profile as a shallow site with a sandy bottom, juvenile fish, and small creatures. "
            "The profile also reports morays and snappers in open water; sightings vary and are not guaranteed."
        ),
        "evidenceNote": "The SSI profile names Petit Malendure and lists a Bouillante dive center as serving the site, matching the atlas marker's location near Petit Malendure, Guadeloupe. Wildlife details are contributor-reported.",
        "authoringMethod": "AI-assisted synthesis of an SSI MyDiveGuide site profile",
        "sources": [{
            "label": "SSI MyDiveGuide Petit Malendure profile",
            "url": "https://www.scubago.com/en/explore/divesite/petit-malendure-352267",
            "sourceClass": "SSI-dive-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "Member-contributed profile describes a shallow site and possible sightings; wildlife is not guaranteed, and it does not specify a depth range.",
            "claims": ["site-identity", "location", "topography", "marine-life-reported"],
        }],
    },
    "6a82d9c7-7458-4ff9-b39c-b3e83171e484": {
        "description": (
            "YDT-15 is a former Navy dive tender sunk south of Pensacola in 2000 to form an artificial reef. "
            "Pensacola dive guides describe it as a partly collapsed wreck, with the top around 85 ft and the seabed near 100 ft; debris and marine life remain around the structure."
        ),
        "evidenceNote": "The atlas point is offshore south of Pensacola, consistent with the named YDT-15 site. The local charter guide gives a 100 ft bottom and 85 ft wreck top; the regional tourism authority independently lists YDT-14 and YDT-15 as nearby sister-ship wrecks.",
        "authoringMethod": "AI-assisted synthesis of a local dive-charter guide and Pensacola tourism authority wreck listing",
        "sources": [
            {
                "label": "Niuhi Dive Charters YDT-15 guide",
                "url": "https://niuhidivecharters.com/ydt-15",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local charter source; its depth figures describe the wreck and surrounding seabed and should not be treated as a planned depth profile.",
                "claims": ["site-identity", "location", "history", "topography", "depth", "marine-life-reported"],
            },
            {
                "label": "Visit Pensacola: Types of Diving in Pensacola",
                "url": "https://www.visitpensacola.com/things-to-do/outdoors/scuba-diving/types-of-diving-in-pensacola/",
                "sourceClass": "official-tourism-dive-guide", "retrievedAt": "2026-10-08",
                "limitations": "Regional guide identifies the sister-ship wrecks and broad site characteristics; it does not give the atlas marker's exact coordinates.",
                "claims": ["site-identity", "location", "features"],
            },
        ],
    },
    "b26d7ca8-b724-4858-94eb-6c26bd939053": {
        "description": (
            "Sliema Pitch Bay is a small, calm bay between Qui-Si-Sana Beach and Sliema Pitch. "
            "The SSI MyDiveGuide profile describes shallow water around 5–6 m, sandy patches at 10–14 m, and an anchor and cannon; marine-life observations are contributor-reported."
        ),
        "evidenceNote": "The canonical marker falls in Sliema, matching the named bay and the profile's nearby landmarks. The depth and underwater-object details come from the contributor profile; the site's exact route is not specified.",
        "authoringMethod": "AI-assisted synthesis of an SSI MyDiveGuide site profile",
        "sources": [{
            "label": "SSI MyDiveGuide Sliema Pitch Bay profile",
            "url": "https://www.scubago.com/en/explore/divesite/sliema-pitch-bay-849283",
            "sourceClass": "SSI-dive-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "Member-contributed profile; depth descriptions and marine-life reports are source-reported, and no fixed dive route is given.",
            "claims": ["site-identity", "location", "topography", "depth", "features", "marine-life-reported"],
        }],
    },
    "4c38d549-eb7d-402a-84a5-7b48f510fa16": {
        "description": (
            "Tie Dye Arch is a Y-shaped swim-through beneath the Poor Knights’ southern pinnacles, with colourful walls and large boulders on the floor. "
            "A dive-site guide places the arch floor near 16 m and notes possible current; the exposed pinnacles need calm sea conditions, and SSI reports the eastern end drops beyond 20 m."
        ),
        "evidenceNote": "The atlas marker is about 45 m from the published Tie Dye Arch coordinate. The two depth descriptions refer to different parts of the formation; current and sea-state suitability vary by conditions.",
        "authoringMethod": "AI-assisted synthesis of coordinate-matched dive-site guides",
        "sources": [
            {
                "label": "Global Dive: Poor Knights Tie Dye Arch",
                "url": "https://globaldive.net/poor-knights-tie-dye-arch",
                "sourceClass": "dive-operator-site-guide", "retrievedAt": "2026-10-08",
                "limitations": "Diver-authored operator guide; current, weather, marine life and depth descriptions are site-guide observations, not a live conditions report.",
                "claims": ["site-identity", "topography", "depth", "current-possible", "conditions-dependence"],
            },
            {
                "label": "SSI MyDiveGuide: Tie Dye Arch Poor Knights",
                "url": "https://www.scubago.com/en/explore/divesite/tie-dye-arch-poor-knights-510302",
                "sourceClass": "SSI-dive-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Contributor profile; reported depth applies to the eastern end of the formation and conditions are not current forecasts.",
                "claims": ["site-identity", "depth"],
            },
            {
                "label": "Wikivoyage: Diving the Poor Knights Islands",
                "url": "https://en.wikivoyage.org/wiki/Diving_the_Poor_Knights_Islands",
                "sourceClass": "dive-site-coordinate-index", "retrievedAt": "2026-10-08",
                "limitations": "Used only to cross-check the named site's published coordinate against the atlas marker.",
                "claims": ["site-identity", "location"],
            },
        ],
    },
    "af205e53-7de3-4d30-8836-a81ba16ced9c": {
        "description": (
            "La Ballena (Sonabia Whale) is a boat-access dive among rocky corridors and formations, with a reported depth span from 6 m to over 20 m. "
            "The SSI profile reports mild currents, fish, and invertebrates; conditions and wildlife sightings can vary."
        ),
        "evidenceNote": "The site-specific SSI profile matches the atlas name and Sonabia locality and identifies the nearby dive center. Its depth, current and wildlife details are contributor-reported; no fixed route or exact underwater point is provided.",
        "authoringMethod": "AI-assisted synthesis of an SSI MyDiveGuide site profile",
        "sources": [{
            "label": "SSI MyDiveGuide La Ballena, Sonabia",
            "url": "https://www.scubago.com/en/explore/divesite/la-ballena-sonabia-622123",
            "sourceClass": "SSI-dive-site-profile", "retrievedAt": "2026-10-08",
            "limitations": "Member-contributed profile; depth, current and marine-life reports are not independently verified or a live conditions report.",
            "claims": ["site-identity", "location", "access", "topography", "depth", "current-reported", "marine-life-reported"],
        }],
    },
    "85127910-d3d0-45b1-bf0b-a9dff4a22af9": {
        "description": (
            "4 Mile Reef runs perpendicular to the Sodwana Bay shoreline, with a large wall, sand patches, canyons, gullies, and coral bommies. "
            "A local dive operator describes extensive plate corals and schools of snapper, slinger, and fusilier; fish reports are operator observations."
        ),
        "evidenceNote": "The PADI profile coordinates match the atlas marker within about 5 m and identify boat entry. Pisces Diving provides the site-specific reef description; its depth figures vary between pages and are omitted here.",
        "authoringMethod": "AI-assisted synthesis of a coordinate-matched PADI profile and local operator guide",
        "sources": [
            {
                "label": "PADI 4 Mile Reef site profile",
                "url": "https://travel.padi.com/dive-site/south-africa/4-mile-reef/",
                "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "PADI member-contributed profile; its coordinates match the atlas marker, and marine-life records are contributor-reported.",
                "claims": ["site-identity", "location", "access", "topography", "marine-life-reported"],
            },
            {
                "label": "Pisces Diving Sodwana Bay: 4 Mile Reef",
                "url": "https://www.piscesdiving.co.za/post/four-mile-reef-16-30-metres",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local operator guide; depth ranges differ between its published pages, so no depth is repeated here. Conditions and sightings vary.",
                "claims": ["site-identity", "topography", "marine-life-reported"],
            },
        ],
    },
    "da7bbbe4-9292-4efc-b749-fbcf70629912": {
        "description": (
            "Tent Reef Deep is a small, steep-sided patch reef at the deeper end of Saba’s Tent Reef system, often paired with the shallower Tent Reef. "
            "SSI describes black coral and snapper and wrasse on deeper sections, with garden eels and stingrays in shallower areas; sightings are source-reported."
        ),
        "evidenceNote": "The SSI profile matches the named Saba site. Divers Alert Network independently distinguishes Tent Reef Deep from Tent Reef Wall and describes the deep reef sloping into open water; wildlife sightings are not guaranteed.",
        "authoringMethod": "AI-assisted synthesis of an SSI site profile and Divers Alert Network site account",
        "sources": [
            {
                "label": "SSI MyDiveGuide Tent Reef Deep profile",
                "url": "https://www.scubago.com/en/explore/divesite/tent-reef-deep-15417",
                "sourceClass": "SSI-dive-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "SSI contributor profile; marine-life reports and sightings are user-generated and not guarantees.",
                "claims": ["site-identity", "location", "topography", "marine-life-reported"],
            },
            {
                "label": "Divers Alert Network: Diving in Saba",
                "url": "https://dan.org/alert-diver/article/diving-in-saba/",
                "sourceClass": "dive-safety-editorial", "retrievedAt": "2026-10-08",
                "limitations": "First-person dive account and local-guide briefing; conditions and animal encounters vary.",
                "claims": ["site-identity", "topography", "depth-context", "marine-life-reported"],
            },
        ],
    },
    "51c2d081-b3c9-4671-9629-8713a8004c8f": {
        "description": (
            "The LuLu is a 271-foot retired coastal freighter sunk off Orange Beach in 2013 as Alabama’s first whole-ship artificial reef. "
            "A local dive operator reports the wreck between about 61 and 116 ft and describes access into its cargo hold; check current structure and penetration conditions with a local operator."
        ),
        "evidenceNote": "The Alabama Gulf Coast Reef & Restoration Foundation confirms the wreck and sinking; its published wheelhouse coordinate is about 580 m from the atlas marker, so the precise marker location is not confirmed. Depth and penetration details are operator-reported.",
        "authoringMethod": "AI-assisted synthesis of a reef-foundation wreck record and local dive-operator guide",
        "sources": [
            {
                "label": "Alabama Gulf Coast Reef & Restoration Foundation: Reef Projects",
                "url": "https://alabamagulfcoastreef.org/reef-projects/",
                "sourceClass": "regional-reef-foundation-record", "retrievedAt": "2026-10-08",
                "limitations": "Confirms the wreck, sinking, and published wheelhouse coordinate; that coordinate is about 580 m from the DiveAtlas marker.",
                "claims": ["site-identity", "location", "history", "artificial-reef"],
            },
            {
                "label": "MBT Divers: Specialty Offshore Dives",
                "url": "https://mbtdivers.com/dive-sites/specialty-offshore-dives",
                "sourceClass": "dive-operator-guide", "retrievedAt": "2026-10-08",
                "limitations": "Local operator site guide; depth and penetration details are reported by the operator and may change with wreck condition.",
                "claims": ["site-identity", "depth", "topography", "access", "route-limitations"],
            },
        ],
    },
    "099de3f9-6057-4b24-8956-11c07bb6df60": {
        "description": (
            "Greer Gut is one of Saba’s few true limestone coral reefs, with mushroom-shaped Honeycomb Plate and Sunray Lettuce corals; SSI describes a northerly route along a deeper wall. "
            "The Saba Conservation Foundation notes that diving on this Atlantic-facing side depends on suitable weather."
        ),
        "evidenceNote": "The canonical marker is about 120 m from Greer Gut’s named coordinate in a 2019 Saba Marine Park reef survey. The SSI profile supplies the site-specific coral and route details; the foundation describes conditions for the wider east-side area.",
        "authoringMethod": "AI-assisted synthesis of an SSI site profile, Saba Conservation Foundation guidance, and a coordinate-referenced reef survey",
        "sources": [
            {
                "label": "SSI MyDiveGuide Greer Gut profile",
                "url": "https://www.scubago.com/en/explore/divesite/greer-gut-15427",
                "sourceClass": "SSI-dive-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Contributor profile; route and possible fish encounters are not a guaranteed itinerary or current conditions report.",
                "claims": ["site-identity", "topography", "route", "marine-life-reported"],
            },
            {
                "label": "Saba Conservation Foundation: Dive Sites & Dive Operators",
                "url": "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
                "sourceClass": "official-marine-park-guide", "retrievedAt": "2026-10-08",
                "limitations": "Identifies Greer Gut as one of Saba’s true limestone reefs; its weather and habitat details describe the broader east-side dive area.",
                "claims": ["site-identity", "setting", "conditions-dependence", "topography"],
            },
            {
                "label": "SLU thesis: coral reef monitoring sites in Saba National Marine Park",
                "url": "https://stud.epsilon.slu.se/16547/1/homes_w_210315.pdf",
                "sourceClass": "academic-site-coordinate-survey", "retrievedAt": "2026-10-08",
                "limitations": "The 2019 survey names Greer Gut and gives the surveyed-site coordinate; it supports location identity, not current reef condition.",
                "claims": ["site-identity", "location"],
            },
        ],
    },
    "2732c575-a67a-4def-ad4e-054d9f0b7ebe": {
        "description": (
            "The S.S. Trevier was a Belgian grain steamer torpedoed in the North Sea in 1917. "
            "The wreck is now broken up, with its boilers and drive shaft among the recognizable remains; one North Sea cleanup dive also records a condenser and tide-driven current at the site."
        ),
        "evidenceNote": "The direct SSI profile matches the exact wreck name and describes its history and remaining structure. The separate dive-cleanup account is a first-person visit, so current and observed wreck details are not a live conditions report.",
        "authoringMethod": "AI-assisted synthesis of an SSI site profile and a North Sea wreck-cleanup dive account",
        "sources": [
            {
                "label": "SSI MyDiveGuide S.S. Trevier (Wreck) profile",
                "url": "https://www.scubago.com/nl/explore/divesite/s.s.-trevier-wreck-272562",
                "sourceClass": "SSI-dive-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "Member-contributed Dutch-language site profile; history and wreck condition are translated from the profile and not independently surveyed for this summary.",
                "claims": ["site-identity", "history", "topography"],
            },
            {
                "label": "Duik De Noordzee Schoon: cleanup dive at SS Trevier",
                "url": "https://www.duikdenoordzeeschoon.nl/duik-3-daagse-als-voorbereiding-op-expeditie-noordzee-2020/",
                "sourceClass": "wreck-cleanup-dive-account", "retrievedAt": "2026-10-08",
                "limitations": "First-person cleanup dive from July 2020; the observed current, visibility, and wreck condition apply to that visit only.",
                "claims": ["site-identity", "topography", "current-observed", "marine-life-reported"],
            },
        ],
    },
    "d9aeebac-f59c-4952-917b-ad9116787f82": {
        "description": (
            "Santorini Dive Center’s House Reef begins in shallow water just offshore and extends into the volcanic caldera. "
            "The operator describes colorful sponges, nudibranchs, groupers, barracuda, and schools of fish on the protected reef."
        ),
        "evidenceNote": "The PADI member profile credits Santorini Dive Center and places the marker within about 5 m of the canonical point. The detailed habitat and wildlife description comes from the operator; sightings are not guaranteed.",
        "authoringMethod": "AI-assisted synthesis of a coordinate-matched PADI profile and dive-center guide",
        "sources": [
            {
                "label": "PADI House Reef site profile, Santorini",
                "url": "https://www.padi.com/dive-site/greece/house-reef-2/",
                "sourceClass": "PADI-contributor-site-profile", "retrievedAt": "2026-10-08",
                "limitations": "The profile credits Santorini Dive Center and its coordinates match the atlas marker; the profile does not provide a descriptive narrative.",
                "claims": ["site-identity", "location", "features"],
            },
            {
                "label": "Santorini Dive Center: House Reef",
                "url": "https://www.divecenter.gr/articles/article-11-house-reef/",
                "sourceClass": "dive-operator-site-guide", "retrievedAt": "2026-10-08",
                "limitations": "The site operator describes its own reef; marine-life observations are not guarantees or a current conditions report.",
                "claims": ["site-identity", "topography", "features", "marine-life-reported"],
            },
        ],
    },
}


def load_canonical_sites() -> list[list[Any]]:
    text = CANONICAL.read_text(encoding="utf-8-sig")
    marker = re.search(r"window\.DIVE_SITES_DATA\s*=\s*", text)
    if not marker:
        raise ValueError(f"Missing DIVE_SITES_DATA in {CANONICAL}")
    sites, _ = json.JSONDecoder().raw_decode(text, marker.end())
    return sites


def clean_source_urls(value: str) -> list[str]:
    urls = [match.rstrip(".,)") for match in re.findall(r"https?://[^\s;]+", value or "")]
    if not urls:
        return []
    # When the review record lists both an API endpoint and its linked dive
    # guide, show the public guide first while retaining both references.
    public = [url for url in urls if "api.opendivemap.com" not in url.lower()]
    api = [url for url in urls if "api.opendivemap.com" in url.lower()]
    return list(dict.fromkeys(public + api))


def source_label_for(url: str | None, evidence_source: str) -> str:
    host = (re.sub(r"^https?://", "", url or "").split("/", 1)[0]).lower()
    if "divessi.com" in host:
        return "SSI MyDiveGuide"
    if "padi.com" in host:
        return "PADI"
    if "api.opendivemap.com" in host:
        return "OpenDiveMap API"
    return (evidence_source or "Reviewed category record").split(";")[0].strip()


def summary_text(row: dict[str, str]) -> tuple[str, list[str]]:
    setting = SETTING.get((row.get("setting") or "").strip().lower())
    access = ACCESS.get((row.get("access") or "").strip().lower())
    features = []
    for token in re.split(r"[;,|]+", row.get("features") or ""):
        label = FEATURE.get(token.strip().lower())
        if label and label not in features:
            features.append(label)

    if not setting and not access and not features:
        return "", []

    location = ", ".join(dict.fromkeys(
        str(row.get(field) or "").strip() for field in ("region", "country")
        if str(row.get(field) or "").strip()
    ))
    site_text = f"{row['name']}" + (f" in {location}" if location else "")
    dive_type = f"{setting} dive site" if setting else "dive site"
    sentence = f"{site_text} is a {dive_type}"
    if features:
        feature_phrases = [FEATURE_SUMMARY.get(feature, feature) for feature in features]
        feature_text = ", ".join(feature_phrases[:-1]) + (
            f" and {feature_phrases[-1]}" if len(feature_phrases) > 1 else feature_phrases[0]
        )
        sentence += f" with {feature_text}"
    sentence += "."
    if access == "shore":
        sentence += " It is a shore-entry dive."
    elif access == "boat":
        sentence += " It is reached by boat."
    elif access == "shore or boat":
        sentence += " It can be reached from shore or by boat."
    claims = (["setting"] if setting else []) + (["access"] if access else []) + (["features"] if features else [])
    return sentence, claims


MELISSAS_GARDEN_SUMMARY = {
    "status": "published",
    "summaryReviewStatus": "firsthand-report-synthesis",
    "language": "en",
    "authoringMethod": "AI-assisted synthesis of two first-hand diver trip reports",
    "description": "Divers describe colorful coral and plenty of small fish, including anthias.",
    "sources": [
        {
            "label": "Diver trip report: Kri, Raja Ampat",
            "url": "https://www.reddit.com/r/backpacking/comments/1bk2vhx/trip_report_kri_raja_ampat_indonesia/",
            "sourceClass": "firsthand-diver-trip-report",
            "retrievedAt": "2026-10-16",
            "limitations": "The author describes a personal week of diving in Raja Ampat. Their account is subjective and does not establish typical conditions or guaranteed sightings.",
            "claims": ["site-identity", "coral-experience", "small-fish-reported"],
        },
        {
            "label": "Diver account: Melissa’s Garden, Raja Ampat",
            "url": "https://www.reddit.com/r/scuba/comments/1g8buzg/",
            "sourceClass": "firsthand-diver-account",
            "retrievedAt": "2026-10-16",
            "limitations": "The author reports a week of diving in Raja Ampat and describes this site as sprawling, with small fish such as anthias. This is one visitor’s account, not a current conditions report.",
            "claims": ["site-identity", "site-scale-reported", "small-fish-reported"],
        },
    ],
}

# These nine SSI-linked profiles contain first-person dive accounts or
# site-specific observations from community contributors.
DIVER_REVIEW_SUMMARY_OVERRIDES = {
    "095635cd-45a1-4bf3-91e2-585cb16a3c05": (
        "Divers report nudibranchs and pygmy seahorses in the shallows.",
        "https://www.divessi.com/mydiveguide/divesite/abyss-triggerfish-solomon-islands-323960",
    ),
    "190410c1-6450-42b7-ba69-c6f93ad910a9": (
        "Divers have reported eels and blind fish in the cave.",
        "https://www.divessi.com/mydiveguide/divesite/cenote-nicte-ha-nic-te-mexico-244956",
    ),
    "d19a2031-018a-4ad1-9a03-0e0725a52497": (
        "Divers have reported grey nurse sharks in the cave.",
        "https://www.divessi.com/mydiveguide/divesite/foggy-shark-cave-australia-9857",
    ),
    "df0048e9-cbfc-41c0-8382-3314611e818b": (
        "Divers have seen devil rays here, along with small reef fish.",
        "https://www.divessi.com/mydiveguide/divesite/jack-a-dan-west-carriacou-grenada-241916",
    ),
    "e57c53c7-5801-4410-9173-763c64450eff": (
        "Divers report low visibility over a muddy pinnacle, with small marine life.",
        "https://www.divessi.com/mydiveguide/divesite/no-viz-reef-fiji-356919",
    ),
    "730dd457-9753-4ce4-b6a0-e4fe9a995bbc": (
        "Divers report octopuses, frogfish, scorpionfish, rays, and turtles.",
        "https://www.divessi.com/mydiveguide/divesite/seaview-carriacou-tropical-hill-grenada-235883",
    ),
    "98bb60aa-62f5-4806-b0ef-e973fb5b28b3": (
        "Divers report reef fish, moray eels, and turtles among steep rock faces.",
        "https://www.divessi.com/mydiveguide/divesite/wahoo-panama-560326",
    ),
    "2b41e05e-4704-4bb2-9bf9-7e68c58023f2": (
        "Divers report coral, sponges, tuna, blacktip sharks, and batfish.",
        "https://www.divessi.com/mydiveguide/divesite/wrong-entry-indonesia-812025",
    ),
    "3e8313c1-cac1-4cb7-9092-cb49b9417056": (
        "A diver describes looking for sharks near the marina and visiting the nearby Island of Snakes.",
        "https://www.scubago.com/en/explore/divesite/herradura-133857",
    ),
}

# Published first-person accounts are kept separate from community-profile
# observations so each source's publisher, date, and limits remain explicit.
DIVER_ACCOUNT_SUMMARY_OVERRIDES = {
    "028c3686-aed6-4b02-bb9e-3330f905f00e": {
        "description": "Local dive instructor Bojan Runtic reports a thermal spring in a wall crevice at about 3 m. He describes water near 25°C at the spring in winter, when surrounding water was 12–14°C, plus reddish rock and abundant marine life.",
        "url": "https://more-sub-makarska.hr/2026/03/14/nugal-termalni-izvor/",
        "label": "Bojan Runtic’s firsthand Nugal spring report (2026)",
        "sourceClass": "firsthand-diver-report",
        "retrievedAt": "2026-10-16",
        "limitations": "One local instructor’s March 2026 post; temperatures are approximate observations and do not establish typical year-round conditions.",
    },
    "190410c1-6450-42b7-ba69-c6f93ad910a9": {
        "description": "On a 2024 dive, Indira Pranabudi describes a shallow route around Nicte Ha’s cavern and open pool, with lily pads and sunbeams in clear water. She says it reached about 20 ft (6 m) and notes the silty floor calls for careful buoyancy.",
        "url": "https://indirapranabudi.com/blog/cenote-diving-yucatan/",
        "label": "Indira Pranabudi’s firsthand Nicte Ha dive report (2024)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "One diver’s 2024 trip and route; depth, light, and visibility describe that visit, not typical or current conditions.",
    },
    "7c71b426-85da-4286-bc2a-efcfb35e25eb": {
        "description": "Chris Sullivan's dive logs describe light current at Palancar Horseshoe, with an electric ray, a turtle, and a reef memorial on one visit; on another he saw a stingray and large grouper.",
        "url": "https://deepstop.wordpress.com/tag/palancar-horseshoe/",
        "label": "Chris Sullivan's Palancar Horseshoe dive logs (2007 and 2009)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "Two visits by one diver in 2007 and 2009; wildlife and current observations describe those dives, not typical or current conditions.",
    },
    "04651263-3ca8-4555-b2af-05eb59d2c9f3": {
        "description": "A 2026 dive map made during SSI Divemaster training charts shallow features off Genève-Plage, including seagrass, a pipe, and an artificial coral reef; its marked depths reach 6 m.",
        "url": "https://scubajacs.com/wp-content/uploads/sites/6/2026/08/Geneve-Plage-Dive-Map-2026.pdf",
        "label": "Scuba Jac’s diver-created site map: Genève-Plage (2026)",
        "sourceClass": "firsthand-diver-topography",
        "retrievedAt": "2026-10-16",
        "limitations": "Created during SSI Divemaster training in spring 2026 with a dive buddy. It is a site map, not a narrative review or current-conditions report; mapped features and depths may not describe every route.",
    },
    "730dd457-9753-4ce4-b6a0-e4fe9a995bbc": {
        "description": "In a 2015 field study, diver Luana Haller compared Seaview with nearby Barrel. Her account reports stronger current at Seaview and fewer lionfish there than at Barrel.",
        "url": "https://www.caribbeancompass.com/online/november15compass_online.pdf",
        "label": "Luana Haller’s firsthand Carriacou dive study (2015)",
        "sourceClass": "firsthand-diver-research-report",
        "retrievedAt": "2026-10-16",
        "limitations": "One student’s field project during a three-week July 2015 visit; observations compare two sites and do not establish current or typical conditions.",
    },
    "0e0eb010-bcf4-422b-8594-d2aa6d06dafd": {
        "description": "A night-dive report from Tisvildeleje describes dense mysid shrimp, flatfish, sea scorpions, weeverfish, sand eels, and herring.",
        "url": "https://www.baracudaturudvalg.dk/baracuda_bladet/baracuda_okt_2013_web_udgave.pdf",
        "label": "Baracuda magazine firsthand dive report: Tisvildeleje (2013)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "The article describes one night dive from August 2012; the wildlife sightings describe that visit, not typical conditions.",
    },
    "0aab469f-5de3-4b12-beee-746c55eeefe4": {
        "description": "A 2002 diver report describes linked training platforms, a small boat wreck, and many crayfish, carp, pike, and perch. The author notes that carp can stir up the visibility.",
        "url": "https://taucher.net/tauchplatz-neufelder_see__neufeld_leitha-bericht-hlz13732",
        "label": "Taucher.Net diver report: Neufelder See (2002)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "The report covers the lake and several entry points, not only the Strandbad entry; sightings and conditions are from one 2002 account.",
    },
    "64f8bdca-4327-4490-85bd-6afea6a4d164": {
        "description": "Five diver reviews rate Cynthiana from good to exceptional. Logged dives reached 6–12 m, with visibility ranging from average to excellent.",
        "url": "https://www.scubadiving.place/divesite/cynthiana",
        "label": "Scuba Diving Place diver reviews: Cynthiana, Cyprus (5 reviews)",
        "sourceClass": "firsthand-diver-review-collection",
        "retrievedAt": "2026-10-16",
        "limitations": "The five reviews are undated and describe individual dives; depth and visibility are not current or typical conditions. The matching catalog record is the Cynthiana site near Paphos; a separate same-named catalog record is farther away and was not matched.",
    },
    "20be0200-86c4-48f7-b88a-4256aa009310": {
        "description": "A 2024 diver described False Entrance’s deep canyons, a school of trevally, and large red and yellow soft corals. The report noted slight current and a 0.5 m swell on that dive.",
        "url": "https://cairnsdiveadventures.com.au/review/mike-ball-coral-sea-cod-hole-expedition-5-night-trip-review/",
        "label": "Cairns Dive Adventures diver trip report: False Entrance (2024)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One diver’s 31 August 2024 visit; sightings and conditions describe that dive, not current or typical conditions.",
    },
    "b24899e5-e346-431a-8153-1d11fde4ab32": {
        "description": "A 2019 dive-club report describes clear water over Lahami’s healthy house reefs, with turtles and several kinds of rays. Divers reached Banana Reef by following a line through the seagrass.",
        "url": "https://tauchfreunde-duesseldorf.com/2019/06/14/tauchurlaub-ganz-im-sueden-aegyptens-lahami-bay/",
        "label": "Tauchfreunde e.V. diver report: Lahami Bay (2019)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "A single group’s 2019 trip report covering the house reefs; the conditions and sightings describe that visit, not current conditions.",
    },
    "0023cddb-3a63-4d2a-858d-1d892b93babd": {
        "description": "A visitor described a first scuba dive in Rousoum Bay, starting in the shallows before heading into deeper water.",
        "url": "https://www.tripadvisor.co.uk/Attraction_Review-g1187882-d6958991-Reviews-or40-Alonissos_Seacolours_Dive_Center-Patitiri_Alonnisos_Sporades.html",
        "label": "Tripadvisor diver review: Rousoum Bay (2020)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2020 account in a dive-center review; it describes a try dive in Rousoum Bay and gives no typical or current site conditions.",
    },
    "655dbb14-5af4-4e9e-828c-f1cdb7d6b1f1": {
        "description": "A 2017 diver reported up to 5 m visibility, changing layers, and an underwater training course with a mussel-covered caravan and small fish.",
        "url": "https://taucher.net/tauchbasis-tauchlehrerausbildungszentrum_am_bernsteinsee_goitzsche-faz14206",
        "label": "Taucher.Net diver review: Goitzschesee (2017)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visit in 2017; conditions describe that dive, not the lake today. The reviewed dive center is now closed and had moved, though the diver account explicitly describes dives in Goitzschesee.",
    },
    "2ffd53f2-20d1-49d8-8308-ed49dda62056": {
        "description": "A diver enjoyed Garden Eel Cove’s coral and marine life, including several kinds of eels, before the night manta dive.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Hawaii/KonaHonuDivers_BigIsland_report_2597.html",
        "label": "Undercurrent diver review: Garden Eel Cove, Kona (2006)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one visitor’s account from 2006; the sightings and impressions describe that trip, not typical or current conditions.",
    },
    "741df9e4-117d-45d5-8844-901c4cddeb44": {
        "description": "A diver enjoyed Garden Eel Cove’s coral and marine life, including several kinds of eels, before the night manta dive.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Hawaii/KonaHonuDivers_BigIsland_report_2597.html",
        "label": "Undercurrent diver review: Manta Ray Heaven, Garden Eel Cove (2006)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one visitor’s account from 2006; the sightings and impressions describe that trip, not typical or current conditions. This catalog name appears to identify Garden Eel Cove, a nearby variant record.",
    },
    "0681ad40-fbd1-42f3-a515-c0f9b6708a9b": {
        "description": "A diver enjoyed Garden Eel Cove’s coral and marine life, including several kinds of eels, before the night manta dive.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Hawaii/KonaHonuDivers_BigIsland_report_2597.html",
        "label": "Undercurrent diver review: Manta Dive-Garden Eel Cove, Kona (2006)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one visitor’s account from 2006; the sightings and impressions describe that trip, not typical or current conditions. This catalog name appears to identify Garden Eel Cove, a nearby variant record.",
    },
    "a8039b55-bb7b-4652-9544-079c0b855091": {
        "description": "A diver described two memorable dives on the Yongala, with dense schools of juvenile fish, trevally and large groupers around the coral-covered wreck.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Australia/YongalaDive_NorthQueensland_report_11573.html",
        "label": "Undercurrent diver review: SS Yongala Wreck, Australia (2021)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s account from 2021; wildlife and conditions describe those dives, not typical or current conditions.",
    },
    "355e4281-b48a-441b-a457-189193a0012f": {
        "description": "A diver called the Cod Hole dive great fun, with friendly potato cod.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Australia/MikeBallsSupersport_GreatBarrierReef_report_1360.html",
        "label": "Undercurrent diver review: Cod Hole, Ribbon Reef No. 10 (2004)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2004 account; cod encounters and site conditions are not guaranteed or current. Two other canonical records at the same coordinates appear to name this same site.",
    },
    "1d7ce8c2-a1fa-4625-9a75-299c7df4aa55": {
        "description": "A diver called the Cod Hole dive great fun, with friendly potato cod.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Australia/MikeBallsSupersport_GreatBarrierReef_report_1360.html",
        "label": "Undercurrent diver review: Cod Hole, Ribbon Reef No. 10 (2004)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2004 account; cod encounters and site conditions are not guaranteed or current. Two other canonical records at the same coordinates appear to name this same site.",
    },
    "ae1d2912-00a7-46bc-861c-fb7af1da979f": {
        "description": "A diver called the Cod Hole dive great fun, with friendly potato cod.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Australia/MikeBallsSupersport_GreatBarrierReef_report_1360.html",
        "label": "Undercurrent diver review: Cod Hole, Ribbon Reef No. 10 (2004)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2004 account; cod encounters and site conditions are not guaranteed or current. Two other canonical records at the same coordinates appear to name this same site.",
    },
    "d0d02e01-2667-460b-9371-ca0dcd2f69c0": {
        "description": "A diver saw large schools of fish and sharks at Castle Rock during a Komodo liveaboard trip.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Indonesia/Arenui_Komodo_report_8277.html",
        "label": "Undercurrent diver review: Castle Rock, Komodo (2015)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s 2015 liveaboard account; sightings describe that trip and are not guaranteed or current conditions.",
    },
    "3b9f386a-25fd-4023-9015-d378f3944898": {
        "description": "A diver saw large schools of fish and sharks at Crystal Rock during a Komodo liveaboard trip.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Indonesia/Arenui_Komodo_report_8277.html",
        "label": "Undercurrent diver review: Crystal Rock, Komodo (2015)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s 2015 liveaboard account; sightings describe that trip and are not guaranteed or current conditions.",
    },
    "877fd63c-7f3f-47af-9c7a-d64058c92fbb": {
        "description": "A diver reported nine or more mantas on a Manta Alley dive, with rays all around the group.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Indonesia/MermaidII_Komodo_report_7774.html",
        "label": "Undercurrent diver review: Manta Alley, Komodo (2014)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This describes one liveaboard visit in 2014; manta sightings and water conditions vary and are not guaranteed or current.",
    },
    "1d9aa78c-0eea-4a69-b62c-36599bffaf0f": {
        "description": "A diver described close mantas swimming alongside the group during their ascent and safety stop at Roca Partida.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Mexico_Western/SolmarV_RevillagigedoIslands_report_3126.html",
        "label": "Undercurrent diver review: Roca Partida, Revillagigedo (2006)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one group’s account from 2006; wildlife encounters describe that trip and are not guaranteed or current conditions.",
    },
    "6f0fc8c7-33d7-4d1c-9334-54df149e9f12": {
        "description": "One diver had three quiet dives at The Boiler, then saw three large mantas make repeated passes on the last.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Mexico_Western/MVValentina_SocorroIslands_report_10793.html",
        "label": "Undercurrent diver review: The Boiler, San Benedicto (2018)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s account from 2018; the sightings show how encounters varied across that trip and are not current conditions.",
    },
    "26a67277-4455-43ac-98d9-7328b6c381cd": {
        "description": "A diver described close manta encounters at Cabo Pearce, along with dolphins and false killer whales.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Mexico_Western/NautilusExplorer_report_12978.html",
        "label": "Undercurrent diver review: Cabo Pearce, Socorro (2024)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s account from May 2024; sightings describe that trip and are not guaranteed or current conditions.",
    },
    "ba870135-1544-4147-816e-f52534dbbbe5": {
        "description": "A diver drifted over Palancar Bricks in little current, enjoying the formations, turtles and large parrotfish.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Cozumel/ScubaClubCozumel_report_10394.html",
        "label": "Undercurrent diver review: Palancar Bricks, Cozumel (2018)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s account from one 2018 visit; the current and wildlife describe that dive, not typical or present conditions.",
    },
    "2629512d-8477-4c08-b917-3b73bf021c7d": {
        "description": "A repeat visitor called Palancar Gardens colorful and reported seeing turtles on every dive during that trip.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Cozumel/DivePalancar_report_5552.html",
        "label": "Undercurrent diver review: Palancar Gardens, Cozumel (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One repeat visitor’s 2010 account; the sightings and impressions describe that trip, not typical or current conditions.",
    },
    "ab8ba4f7-e048-46b6-8bb2-b2d6d2e63a0a": {
        "description": "A repeat visitor said Palancar Caves looked colorful and reported turtles on every dive during that trip.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Cozumel/DivePalancar_report_5552.html",
        "label": "Undercurrent diver review: Palancar Caves, Cozumel (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One repeat visitor’s 2010 account; the sightings and impressions describe that trip, not typical or current conditions.",
    },
    "593e81e7-2241-4259-a3be-3a1318fc95e5": {
        "description": "A diver described descending through clear water to a sulfur cloud, with tree debris and steep rock walls below.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Cozumel/DiveMike_PlayaDelCarmen_report_883.html",
        "label": "Undercurrent diver review: Cenote Angelita, Mexico (2003)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s account from 2003; the described route and conditions are from that visit, not a current report.",
    },
    "5f413050-4dc0-4728-8aef-ae6c42e6e8d3": {
        "description": "A diver described the Liberty wreck sloping from its shallow stern toward a deeper bow, with swim-throughs and abundant marine life.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Indonesia/ZenDive_report_8331.html",
        "label": "Undercurrent diver review: USAT Liberty Wreck, Tulamben (2015)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s account from 2015; the route, entry and marine life describe that visit, not current conditions.",
    },
    "11982658-8c28-4873-99df-1943c3d8c9e4": {
        "description": "A diver described the Liberty wreck sloping from its shallow stern toward a deeper bow, with swim-throughs and abundant marine life.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Indonesia/ZenDive_report_8331.html",
        "label": "Undercurrent diver review: USS Liberty Wreck, Tulamben (2015)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This canonical record appears to identify the same Tulamben wreck as USAT Liberty Wreck; the source describes one diver’s 2015 visit, not current conditions.",
    },
    "a7ced4d1-f0e1-486c-b524-d08036c9673a": {
        "description": "A diver hooked in at Cape Kri and watched barracuda, trevally, sharks and other large fish pass in the current.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Indonesia/PapuaExplorers_RajaAmpat_report_12964.html",
        "label": "Undercurrent diver review: Cape Kri, Raja Ampat (2024)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s account from 2024; the wildlife and current describe that dive, not typical or current conditions.",
    },
    "49d0d556-0f04-4829-9e8f-5938cf0a013c": {
        "description": "A diver reported manta rays at Manta Point’s cleaning station, but found the site crowded with 10–15 boats.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Indonesia/LegendDivingLembongan_NusaPenidaBali_report_9459.html",
        "label": "Undercurrent diver review: Manta Point, Nusa Penida (2017)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This account describes one trip in 2017; its sightings and boat traffic are not a current conditions report.",
    },
    "9b18e578-9032-4a0d-b4ea-ee8a6642b4eb": {
        "description": "A diver described descending among the Great Blue Hole’s stalactites and seeing reef sharks in the deep blue.",
        "url": "https://squid-rhombus-gmpl.squarespace.com/blog/diving-the-great-blue-hole-experience-belize",
        "label": "Jhanielle Brown diver’s account: Great Blue Hole, Belize (2023)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "The author describes this as a personal milestone and a new diver’s experience. Depth and wildlife sightings are from one visit, not a recommendation or typical conditions.",
    },
    "24578a6d-215e-4d04-8c74-334bddbc60d7": {
        "description": "A diver described exploring the Thistlegorm’s holds among jeeps, motorcycles, trucks and other wartime cargo, with fish around the wreck.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Red_Sea/RedSeaDivingCollege_SharmElSheikh_report_897.html",
        "label": "Undercurrent diver review: Thistlegorm, Egypt (2003)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s account from 2003; wreck access and marine life describe that visit, not current conditions.",
    },
    "a62bfc37-a53a-4b78-9c6f-85786339b3db": {
        "description": "A diver described shallow dives at Tiger Beach, with tiger sharks circling near the group.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Bahamas/Aggressor_TigerBeach_report_12622.html",
        "label": "Undercurrent diver review: Tiger Beach, Bahamas (2023)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This describes one diver’s trip in 2023, including baited shark dives; sightings and conditions are not guaranteed or typical.",
    },
    "45488ac1-44ce-43f0-af6a-0c1f8bd5e79b": {
        "description": "A diver described hooking in at Alcyone in strong current and watching large schools of hammerhead sharks pass.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Costa_Rica/SeaHunter_CocosIsland_report_771.html",
        "label": "Undercurrent diver review: Alcyone, Cocos Island (2003)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s account from 2003; currents and wildlife sightings describe that trip, not typical or current conditions.",
    },
    "61a22e99-8852-4828-b7da-8d37b8d9692b": {
        "description": "A diver hooked in at Blue Corner and watched thresher and reef sharks nearby.",
        "url": "https://undercurrent.org/UCnow/dive_magazine/2025/PalauRoyalResort202508.html",
        "label": "Undercurrent diver trip report: Blue Corner, Palau (2025)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "This describes one diver’s visit in 2025; sightings and current conditions are not typical or guaranteed.",
    },
    "e10c7269-113a-46a5-8b2f-307ffcfced94": {
        "description": "One diver saw thousands of barracuda at Barracuda Point, along with groupers, moray eels, frogfish, and rainbow runners.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Malaysia/BorneoDivers_Sipadan_report_11071.html",
        "label": "Undercurrent diver review: Barracuda Point, Sipadan (2019)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s account from 2019; wildlife sightings and conditions describe that dive, not typical or current conditions. A separate 2015 report describes fewer barracuda and poor deep visibility on another visit.",
    },
    "f6733ae9-4d50-46ca-826f-547980d22bb6": {
        "description": "Divers enjoyed Bari Reef’s coral and abundant fish, including French angelfish at several life stages, squid, and octopuses.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Bonaire/BonaireDiveandAdventure_report_5212.html",
        "label": "Undercurrent diver review: Bari Reef, Bonaire (2009)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one visitor group’s account from 2009; the sightings and reef impressions describe those dives, not current conditions.",
    },
    "06c2add5-bd53-46a4-bba1-d7a83cddba18": {
        "description": "One diver saw two sunfish circle in the shallows after a cold, strong-current dive at Crystal Bay.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Indonesia/AquaMarineDiving_BaliNusaPenida_report_6250.html",
        "label": "Undercurrent diver review: Crystal Bay, Nusa Penida (2011)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s 2011 visit; the temperature, current and wildlife describe that dive, not typical or current conditions.",
    },
    "81db1656-6a38-4dba-b862-c34ea950b640": {
        "description": "A diver saw two thresher sharks pass close by during an early-morning dive at Monad Shoal.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Philippines/ExoticDivers_Malapascua_report_5730.html",
        "label": "Undercurrent diver review: Monad Shoal, Malapascua (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s 2010 visit; thresher shark sightings are not guaranteed on every dive.",
    },
    "28723050-6b11-4cd5-96ca-079cade21b9d": {
        "description": "A diver spotted seahorses, pipefish, nudibranchs, and shrimp at Pantaw Pantaw.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Philippines/ExoticDivers_Malapascua_report_5730.html",
        "label": "Undercurrent diver review: Pantaw Pantaw, Malapascua (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s 2010 visit; the sightings describe that dive, not typical or current conditions.",
    },
    "363f10f2-08ec-4104-8c41-314d92eee66a": {
        "description": "A diver found frogfish, nudibranchs, squat shrimp, and mantis shrimp at North Point.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Philippines/ExoticDivers_Malapascua_report_5730.html",
        "label": "Undercurrent diver review: North Point, Malapascua (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s 2010 visit; the sightings describe that dive, not typical or current conditions.",
    },
    "7015f625-541c-4f52-aee6-b0895a61d919": {
        "description": "A diver saw sleeping whitetip sharks in Gato Island’s cave, along with shrimp, pipefish, clownfish, and nudibranchs.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Philippines/ExoticDivers_Malapascua_report_5730.html",
        "label": "Undercurrent diver review: Gato Island, Philippines (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s 2010 visit; wildlife sightings describe that trip, not typical or current conditions.",
    },
    "d951f380-f88b-4b14-b5f5-3fa93efde503": {
        "description": "On a night dive at Lighthouse Reef, a diver saw mandarin fish, seahorses, nudibranchs, scorpionfish, and spider crabs.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Philippines/ExoticDivers_Malapascua_report_5730.html",
        "label": "Undercurrent diver review: Lighthouse Reef, Malapascua (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s 2010 night dive; the sightings describe that dive, not typical or current conditions.",
    },
    "1be73a7c-3428-4d0d-aa87-318ff60d8adc": {
        "description": "On a night dive at Lighthouse Reef, a diver saw mandarin fish, seahorses, nudibranchs, scorpionfish, and spider crabs.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Philippines/ExoticDivers_Malapascua_report_5730.html",
        "label": "Undercurrent diver review: Lighthouse Reef, Malapascua (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s 2010 night dive; this nearby catalog record appears to be a variant of Lighthouse Reef. The sightings describe that dive, not typical or current conditions.",
    },
    "f4bfa66e-f254-42dd-923f-9cbe4d3ef5ba": {
        "description": "A diver praised the wide variety of fish at 1000 Steps.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Bonaire/CaptainDonsHabitat_NA_report_68.html",
        "label": "Undercurrent diver review: 1000 Steps, Bonaire (2002)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2002 impression; the report uses 1000 Steps, which is the nearby catalog variant of Thousand Steps.",
    },
    "42b4a729-b55a-4ea1-b18c-d56e5409bbe7": {
        "description": "A diver praised the wide variety of fish at 1000 Steps.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Bonaire/CaptainDonsHabitat_NA_report_68.html",
        "label": "Undercurrent diver review: 1000 Steps, Bonaire (2002)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2002 impression; this catalog record is a nearby variant of Thousand Steps.",
    },
    "66f47a24-bbe4-4b89-aac0-8ef152122792": {
        "description": "A diver thought the large eel they saw might have been at Jeff Davis Memorial.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Bonaire/CaptainDonsHabitat_NA_report_68.html",
        "label": "Undercurrent diver review: Jeff Davis Memorial, Bonaire (2002)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2002 sighting; this describes that dive, not typical or current marine life.",
    },
    "8ca68906-d0cf-4784-86ba-099b40374258": {
        "description": "A visitor said Leonora’s Reef had a lot of color.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Bonaire/CaptainDonsHabitat_NA_report_68.html",
        "label": "Undercurrent diver review: Lenora’s Reef, Bonaire (2002)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "The review spells the name Lenora’s Reef; the catalog and local references use Leonora’s Reef. This is one visitor’s brief 2002 impression.",
    },
    "8cc7dbfc-873b-4b94-9367-2b0a414b5bb6": {
        "description": "A diver called La Machaca a great dive and saw seahorses there more than once.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Bonaire/CaptainDonsHabitat_NA_report_68.html",
        "label": "Undercurrent diver review: La Machaca, Bonaire (2002)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2002 impression and sightings; they describe that trip, not typical or current conditions.",
    },
    "1a676090-3237-4d1a-969d-c5209ed9b790": {
        "description": "A diver called La Machaca a great dive and saw seahorses there more than once.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Bonaire/CaptainDonsHabitat_NA_report_68.html",
        "label": "Undercurrent diver review: La Machaca, Bonaire (2002)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2002 impression and sightings; this nearby catalog record appears to be a variant of La Machaca.",
    },
    "bb2e06a3-8071-477a-ad5e-5f469fdf8aa9": {
        "description": "A diver enjoyed Tori’s Reef and its large schools of small fish.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Bonaire/BonaireDiveandAdventure_report_5212.html",
        "label": "Undercurrent diver review: Tori’s Reef, Bonaire (2009)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one visitor group’s 2009 impression; fish sightings describe those dives, not current conditions.",
    },
    "80122551-61df-4154-9294-de82b7c45e9d": {
        "description": "A long-time Bonaire diver described large sponges and soft corals at Joanne’s Sunchi and recalled seeing a seahorse and loggerhead turtle.",
        "url": "https://www.undercurrent.org/UCnow/dive_magazine/2026/BonaireDutchWestIndies202608.html",
        "label": "Undercurrent diver account: Bonaire (2026)",
        "sourceClass": "firsthand-diver-account",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one long-time visitor’s account; sightings describe their visits and are not guaranteed or current conditions.",
    },
    "a58307c8-02f3-4d75-a94e-6bc6adc5b468": {
        "description": "A long-time Bonaire diver praised Salt Pier’s sponge-covered pilings and schools of grunts, barracuda, and bar jacks in the afternoon light.",
        "url": "https://www.undercurrent.org/UCnow/dive_magazine/2026/BonaireDutchWestIndies202608.html",
        "label": "Undercurrent diver account: Bonaire (2026)",
        "sourceClass": "firsthand-diver-account",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one long-time visitor’s account; wildlife sightings and conditions vary by visit.",
    },
    "d1392200-defe-4b01-a767-f2999348a5bc": {
        "description": "A diver praised Karpata’s sand chutes and large coral formations, but found the surge too strong on a second attempt.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Bonaire/BonaireDiveandAdventure_report_5747.html",
        "label": "Undercurrent diver review: Karpata, Bonaire (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This describes one visitor group’s dives in 2010; surge and conditions vary by visit.",
    },
    "c32be679-d0b0-4e44-8994-f4bfaf20c8b4": {
        "description": "A long-time Bonaire diver described soft-coral gardens and staghorn coral teeming with fish around Country Garden.",
        "url": "https://www.undercurrent.org/UCnow/dive_magazine/2026/BonaireDutchWestIndies202608.html",
        "label": "Undercurrent diver account: Bonaire (2026)",
        "sourceClass": "firsthand-diver-account",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one long-time visitor’s account; it describes their observations, not current reef conditions.",
    },
    "4b7b01ce-96dc-4551-948f-e3ab877cb053": {
        "description": "A long-time Bonaire diver described Angel City’s double reef and a school of schoolmaster snappers near shallow coral-restoration trees.",
        "url": "https://www.undercurrent.org/UCnow/dive_magazine/2026/BonaireDutchWestIndies202608.html",
        "label": "Undercurrent diver account: Bonaire (2026)",
        "sourceClass": "firsthand-diver-account",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one long-time visitor’s account; wildlife and reef conditions vary by visit.",
    },
    "24d2e826-405c-4a31-b839-092c163cb0c0": {
        "description": "A visitor group saw a large eagle ray near the end of their dive at Alice in Wonderland.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Bonaire/BonaireDiveandAdventure_report_5747.html",
        "label": "Undercurrent diver review: Alice in Wonderland, Bonaire (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one group’s 2010 sighting; wildlife encounters are not guaranteed.",
    },
    "406cc8dc-62cf-4f05-bc04-77ade4c30a74": {
        "description": "A diver called Oil Slick Leap a fun dive and spotted an octopus near the ladder.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Bonaire/BonaireDiveandAdventure_report_5747.html",
        "label": "Undercurrent diver review: Oil Slick Leap, Bonaire (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This describes one diver’s 2010 visit; wildlife sightings are not guaranteed.",
    },
    "6b6f8181-efc9-4ac1-8d50-626a9e16b61a": {
        "description": "A diver found a dark red frogfish near an anemone and saw a permit fish at Yellow Submarine.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Bonaire/BonaireDiveandAdventure_report_5747.html",
        "label": "Undercurrent diver review: Yellow Submarine, Bonaire (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "These are sightings from one visitor group’s 2010 trip; wildlife encounters are not guaranteed.",
    },
    "3d2b1b68-d40f-4a9b-9fc1-2ae5cbd038b1": {
        "description": "A diver spotted a large grouper resting beside the big anchor at ChaChaCha Beach.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Bonaire/BonaireDiveandAdventure_report_5747.html",
        "label": "Undercurrent diver review: ChaChaCha Beach, Bonaire (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one visitor group’s 2010 sighting; wildlife encounters are not guaranteed.",
    },
    "aa8ff57e-eb71-4fed-8364-4b586ce4ccf9": {
        "description": "A diver’s favorite site, Invisibles had two garden-eel fields and a school of small barracuda that stayed with the group.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Bonaire/BuddyDive_report_4439.html",
        "label": "Undercurrent diver review: Invisibles, Bonaire (2008)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This describes one visitor’s 2008 trip; wildlife and conditions vary by visit.",
    },
    "a0005094-194b-4b02-ac1e-1adde4def1f4": {
        "description": "A diver reported a large lobster, a green eel by the wheelhouse, and territorial sergeant majors on the Hilma Hooker wreck.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Bonaire/BuddyDiveResort_report_6472.html",
        "label": "Undercurrent diver review: Hilma Hooker, Bonaire (2012)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one visitor’s 2012 account; the source page may require a subscription and sightings are not guaranteed.",
    },
    "7ea08fd0-ff4e-4ef9-9dab-26c0932f862f": {
        "description": "A diver listed Red Slave among Bonaire’s must-do dives and praised its soft corals.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Bonaire/CaptDonsHabitat_report_1872.html",
        "label": "Undercurrent diver review: Capt. Don’s Habitat, Bonaire (2005)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one visitor’s brief 2005 impression; reef conditions may have changed.",
    },
    "977f72e5-782e-4753-b0ef-fb8d097e812c": {
        "description": "A diver called Newman’s Wall a fun, easy dive.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Honduras/CoCoView_Roatan_report_1779.html",
        "label": "Undercurrent diver review: Newman’s Wall, Roatan (2005)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2005 impression; it describes that dive, not current conditions.",
    },
    "2cb01a24-7f3b-47ca-8fcd-73c68425b6bd": {
        "description": "A diver singled out Calvin’s Crack for its coral, sponges, and critters.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Honduras/CoCoView_Roatan_report_1281.html",
        "label": "Undercurrent diver review: Calvin’s Crack, Roatan (2004)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2004 impression; it describes that trip, not current conditions.",
    },
    "e44e6ae9-f0f3-48ed-8bf7-969892143d2b": {
        "description": "A diver described the Prince Albert wreck as a good shore dive, a short swim from the resort.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Honduras/CocoView_Roatan_report_3431.html",
        "label": "Undercurrent diver review: Prince Albert wreck, Roatan (2007)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2007 impression; access and site conditions may have changed.",
    },
    "cb29a9de-db08-48ae-8f10-ba1c1bb8b6fb": {
        "description": "A diver saw a manta at German Channel.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Micronesia/AggressorFleet_Palau_report_12153.html",
        "label": "Undercurrent diver review: German Channel, Palau (2022)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One diver’s 2022 sighting; manta rays are not guaranteed on every dive.",
    },
    "a3d18792-219f-4eea-b7e6-36a899cac8a8": {
        "description": "A diver saw a large bait ball of mackerel with sharks and other fish at Ulong Channel.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Micronesia/SamsTours_Palau_report_4696.html",
        "label": "Undercurrent diver review: Ulong Channel, Palau (2009)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2009 dive; fish and shark activity vary by visit and conditions.",
    },
    "3f69938a-7d51-4ffb-a7ab-63146ec23a50": {
        "description": "A diver called Blue Holes beautiful and enjoyed looking up as other divers descended through the openings.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Micronesia/Sams_Palau_report_1613.html",
        "label": "Undercurrent diver review: Blue Holes, Palau (2005)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2005 impression; it describes that dive, not current conditions.",
    },
    "cc412948-05b6-40de-9b85-ce790292b9d1": {
        "description": "A diver found Chandelier Cave crowded and could not reach its last chamber.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Micronesia/BlackPearlPalau_Palau_report_12357.html",
        "label": "Undercurrent diver review: Chandelier Cave, Palau (2023)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One diver’s 2023 visit; the crowding and route describe that particular dive.",
    },
    "9869acd0-1a28-4e88-b91f-e588eb28fb29": {
        "description": "A diver described strong current, soft coral and abundant marine life at Richelieu Rock, with many boats at the site.",
        "url": "https://undercurrent.org/UCnow/dive_reviews/Thailand/KhaoLakScubaAdventures_AndamanSea_report_9383.html",
        "label": "Undercurrent diver review: Richelieu Rock, Thailand (2015)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This account describes one visit in 2015, including its crowding and conditions; these are not current or typical conditions.",
    },
    "610a0295-a064-4166-af44-f23d0c28ee63": {
        "description": "One diver reported a drift past reef fish and a whitetip shark resting under a ledge.",
        "url": "https://www.undercurrent.org/UCnow/dive_magazine/2006/ScubaCoiba200603.html",
        "label": "Undercurrent diver trip report: Frijoles, Coiba (2006)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s account from a trip reported in 2006. Its sightings and conditions describe that visit, not typical or current conditions.",
    },
    "8917bc6e-91ce-4e71-a4f6-d25e79215b36": {
        "description": "One diver called Pure Magic one of two incredible sites on a 2010 Ra Divers trip.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Fiji_and_Tuvalu/RaDivers_fiji_report_5448.html",
        "label": "Undercurrent diver review: Ra Divers, Fiji (2010)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "The review mentions Pure Magic as one of two sites but gives no separate description of that dive. This is one visitor’s impression from 2010.",
    },
    "3abfe9a0-6284-4a94-9f05-ecd91d3a5987": {
        "description": "A diver praised the coral and described a double dive at The Caves as a great morning out.",
        "url": "https://www.tripadvisor.com.au/Attraction_Review-g261638-d7031854-Reviews-or30-Sunreef_Mooloolaba-Mooloolaba_Sunshine_Coast_Queensland.html",
        "label": "Tripadvisor diver review: The Caves, Mooloolaba (2021)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "This operator review specifically mentions a double dive at The Caves. The coral praise is the visitor’s view of that trip, not a claim about typical conditions.",
    },
    "28f54cd4-96d0-4246-b811-e8991f1f989f": {
        "description": "A diver describes an overhang opening onto a wall covered with soft coral and sea fans, with morays and reef fish nearby.",
        "url": "https://www.nigelmarshphotography.com/blog-posts/christmas-island-divelog",
        "label": "Nigel Marsh diver’s log: Perpendicular Wall, Christmas Island",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s account from a Christmas Island trip; sightings describe that visit and are not a current conditions report.",
    },
    "db454677-9ed8-4639-9a98-c8e86ee5bdee": {
        "description": "A diver described Aeolus as a fish-filled wreck dive with sand tiger sharks around the hull.",
        "url": "https://www.scubago.com/en/explore/divesite/aeolus-wreck-80484",
        "label": "SCUBAGO diver account: Aeolus Wreck, North Carolina",
        "sourceClass": "firsthand-diver-account",
        "retrievedAt": "2026-10-16",
        "limitations": "The account is first-person, but the author’s identity is not independently verified. DiveAtlas’s stored coordinate differs by about 9 km from another published position for the wreck, so the mapped point needs review.",
    },
    "b6105f43-5480-4414-b9c8-a9762e07802c": {
        "description": "A diver described Alexander Springs as a relaxed beginner dive, with clear blue water, rock formations, and freshwater life.",
        "url": "https://www.zentacle.com/Beach/109/alexander-springs",
        "label": "Zentacle diver review: Alexander Springs, Florida (2022)",
        "sourceClass": "firsthand-diver-review",
        "retrievedAt": "2026-10-16",
        "limitations": "One visitor’s 2022 account; visibility, wildlife, and conditions describe that visit, not current conditions.",
    },
    "90dd6bb7-d955-444a-9161-2bb7b7365206": {
        "description": "A diver reported sand tiger sharks over the Schurz, with schools of baitfish around the wreck.",
        "url": "https://www.undercurrent.org/UCnow/dive_magazine/2018/OlympusDiveCenter201810.html",
        "label": "Undercurrent diver report: USS Schurz, North Carolina (2018)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "One diver’s 2018 visit; the wreck features were also corroborated by NOAA, but wildlife and visibility describe that trip and are not a current conditions report.",
    },
    "ed685338-b3a1-4ba4-93f9-54bcbbc93135": {
        "description": "A diver found dense schools of fish around the Papoose wreck, with sand tiger sharks cruising along the hull.",
        "url": "https://www.advanceddivermagazine.com/papoose.html",
        "label": "Advanced Diver Magazine first-person report: Papoose Wreck, North Carolina",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "A technical diver’s single rebreather trip; marine life and wreck conditions describe that visit, not typical or current conditions. The wreck is commonly called Papoose by divers, although its historical vessel identification has been revised.",
    },
    "0255ecd6-2873-4f57-a913-9a124ef6f115": {
        "description": "Recent local dive reports describe cloud sponges, crabs, sea stars, and a giant Pacific octopus among Whytecliff Park’s rocky reefs.",
        "url": "https://pnwdiving.com/whytecliff-park",
        "label": "PNW Diving reports: Whytecliff Park, British Columbia (2026)",
        "sourceClass": "firsthand-diver-reports",
        "retrievedAt": "2026-10-16",
        "limitations": "Synthesis of several user-submitted local dive logs from 2026; individual sightings and conditions vary. The page matches the West Vancouver park named in the catalog.",
    },
    "48e0702d-a5a8-460b-855c-d782924a53fa": {
        "description": "A freediver described a dark lake session with a noticeable thermocline and reached about 21 metres on one breath.",
        "url": "https://cleffairy.com/freediving-at-bandar-saujana-putra-lake-on-chinese-valentines-day/",
        "label": "First-person freediving report: Tasik Bandar Saujana Putra (2023)",
        "sourceClass": "firsthand-freediver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "One freediver’s 2023 report; the 21 m figure is her personal performance, not a measured site depth or a typical condition.",
    },
    "0015fde6-d347-4d1e-ab2a-ff6caabc1c88": {
        "description": "Four of five diver reviews call Coral Garden a good one-time dive; one reviewer says there was little to see.",
        "url": "https://scubadiving.place/divesite/coral-garden-sapi-island",
        "label": "Scuba Diving Place diver reviews: Coral Garden, Sapi Island",
        "sourceClass": "community-diver-reviews",
        "retrievedAt": "2026-10-16",
        "limitations": "The page lists five reviews under the matching site name, but does not show review dates or independently verified reviewer credentials. This small set of opinions is not a representative or current site rating.",
    },
    "aef3c883-2892-4380-b7b3-cd5a0d544f55": {
        "description": "A Lanzarote dive instructor describes Playa Grande’s sandy plateau and reef wall, with angel sharks and rays over the sand and octopuses and nudibranchs among the reef.",
        "url": "https://divernet.com/fb/DIVER_0521_FB/files/downloads/DIVER_0521.pdf",
        "label": "DIVER magazine first-person report: Playa Grande, Lanzarote (2021)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "A 2021 first-person account by the owner and instructor at Euro-Divers Lanzarote, which PADI credits on the coordinate-matched Playa Grande profile. Sightings describe that diver’s visits and are not a current wildlife survey.",
    },
    "7de729a8-13a1-4092-b230-a441c2deb3e6": {
        "description": "A diver explored the bow of the Servemar I wreck at about 24 metres during a Recife wreck-park trip.",
        "url": "https://viajandopatagonia.blogspot.com/2011/12/mergulho-recife-pernambuco.html",
        "label": "First-person Recife wreck-diving report: Servemar I (2011)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "The 2011 report describes one of six dives on a multi-wreck trip and shows the diver near the bow at 24 metres; this is a visit detail, not a measured or typical site depth.",
    },
    "0566eeed-4aaf-4ade-82bf-c6cc56c2cdc3": {
        "description": "A 2024 diver report describes muck diving along Dauin’s coast, with coral-covered artificial structures and small marine life; boat rides were short and currents mild on that trip.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Philippines/AtmosphereResortSpa_DumagueteDauinCoast_report_13013.html",
        "label": "Undercurrent first-person dive report: Dauin Coast (2024)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "The contributor describes a multi-day stay at Atmosphere Resort and dives at several sites along the coast, not only the catalog point. Conditions and wildlife observations are from that trip; the ratings are category-specific and are not an overall site score.",
    },
    "051b46c2-b58d-403e-8cbb-0e3a3e4ae274": {
        "description": "A diver reported dense fish schools beneath the water-ski hut and enjoyed the lake’s plants and underwater gullies; visibility was 5–8 metres on that 2007 visit.",
        "url": "https://taucher.net/tauchplatz-friedberger_see-bericht-hlz33028",
        "label": "Taucher.Net first-person dive review: Friedberger See (2007)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one diver’s 2007 visit, not a current conditions report. The reviewer profile lists SSI AOWD and 165 dives; visibility and fish observations are specific to that visit.",
    },
    "00615317-7d35-4884-ac56-f42850a43687": {
        "description": "Twiske dive logs report pike, perch, and eels around its object routes, while visibility often improves below the murky surface layer.",
        "url": "https://www.duikersgids.nl/duikstekken/onderwaterpark-twiske",
        "label": "Duikersgids community dive logs: Onderwaterpark Twiske",
        "sourceClass": "first-person-community-dive-logs",
        "retrievedAt": "2026-10-16",
        "limitations": "The source lists Oostzaanzijde and Stootersplas among the site’s aliases. The summary draws on multiple user logs, whose visibility and wildlife observations vary by visit.",
    },
    "071eb157-5695-48d2-be27-77421f78314e": {
        "description": "A 2025 club-diving report from Eichwald (Bruno) records perch, pike, frog spawn, and a burbot; some divers in the group visited the wreck.",
        "url": "https://s7c962d432aff94d5.jimcontent.com/download/version/1746991308/module/11161283619/name/Bericht_Bruno_Mai_25.pdf",
        "label": "First-person club dive report: Eichwald (Bruno), May 2025",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "The report describes a two-dive club outing in rainy weather; sightings are from that day, and not every diver visited the wreck.",
    },
    "0be737b8-9941-451c-a017-1d98ff8b76a1": {
        "description": "A diver called Mainit their favorite local Dauin site, describing black sand that gives way to coral bommies and abundant fish.",
        "url": "https://www.undercurrent.org/UCnow/dive_reviews/Philippines/SeaExplorersPhilippines_Dauin_report_10150.html",
        "label": "Undercurrent first-person report: Mainit, Dauin (2018)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "The contributor's 2018 report covers several Dauin sites; only the described terrain and fish life are specifically attributed to Mainit. Category ratings in the report apply to Dauin overall, not this individual site.",
    },
    "092ea625-75e6-463f-97cf-88b87b7cff38": {
        "description": "A 2024 club dive had calm seas and 8–10 feet of visibility; divers later found the sunken sailboat.",
        "url": "https://aquatutus.org/content.aspx?club_id=664669&item_id=101770&page_id=5",
        "label": "Aqua Tutus first-person club dive report: Del Monte Beach (2024)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "The visibility and sea conditions describe this club outing only. The sailboat was found during a later dive by students, not by the report's author.",
    },
    "d1ec9a57-06a4-47cd-9aa7-b7d8e9f77947": {
        "description": "On a 2026 visit, a diver saw scallops, shrimp, langoustines, sea urchins, and crabs around A-Frames.",
        "url": "https://jumpsaildive.com/2026/08/31/first-dives-in-scotland/",
        "label": "Jump – Sail – Dive first-person report: Finnart Pier (A-Frames), 2026",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "The report describes two short training dives by one diver; marine-life sightings are from that visit only.",
    },
    "bbecd76f-32bf-40df-ba18-f0c30546f034": {
        "description": "A local diver describes a silty, low-visibility line to the Alastor wreck, with crabs and blennies along the route and wrasse around the hull.",
        "url": "https://iarediver.blogspot.com/2011/06/alastor-ringhaddy-ropes-aliens.html",
        "label": "I Are Diver first-person wreck report: Alastor, Ringhaddy (2011)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "This is one local diver's account from 2011. Visibility, marine life, and wreck condition may have changed since then.",
    },
    "d3d7b900-2bf2-44f4-bfb8-aa18dd03218d": {
        "description": "A 2001 dive account describes a short swim to the reef wall, explored at about 10–12 metres before it drops to around 25 metres.",
        "url": "https://www.gotouring.com/razzledazzle/articles/diving.html",
        "label": "Razzle Dazzle first-person dive account: Alona Beach House Reef (2001)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "The article describes a first dive by one member of the traveling pair in 2001; depth and reef descriptions are from that visit.",
    },
    "08f5963a-2b7e-4c30-920f-eab269a89431": {
        "description": "A 2024 dive report found the Dreimaster at 26 metres; visibility cleared below 8 metres, and anemones covered the well-preserved wreck.",
        "url": "https://www.tauchen.de/reise/ab-ins-gruene-tauchen-um-die-ostseeinsel-fehmarn/",
        "label": "TAUCHEN first-person dive report: Dreimaster, Fehmarn (2024)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "The article describes one August visit in calm weather; depth, visibility, and marine life are from that dive only.",
    },
    "e4cfe5ac-e086-412e-a1c9-964b9819bed7": {
        "description": "Divers describe a medium swim from shore to the reef, where one reviewer saw many eels; another began a drift dive from Aquarius toward Angel City.",
        "url": "https://www.zentacle.com/Beach/125/aquarius",
        "label": "Zentacle first-person dive reviews: Aquarius, Bonaire",
        "sourceClass": "firsthand-diver-review-collection",
        "retrievedAt": "2026-10-16",
        "limitations": "The page combines individual reviews written between 2002 and 2021. Animal sightings and route details are visit-specific; the 2021 review notes a longer swim than nearby sites.",
    },
    "3f1045d4-a8f2-4837-86df-a33784ad962e": {
        "description": "A 2021 trip report describes two dives on the New Venture in flat seas, with no current, excellent visibility, and 74°F water.",
        "url": "https://www.flickr.com/photos/steelreefs/albums/72157719377274292",
        "label": "Harry’s Dive Shop first-person trip report: New Venture (June 2021)",
        "sourceClass": "firsthand-diver-trip-report",
        "retrievedAt": "2026-10-16",
        "limitations": "The conditions describe one two-dive trip in June 2021, not typical or current conditions.",
    },
    "94b7b405-9561-4ca5-9fc3-cd49fe621f7f": {
        "description": "Port Beach diver logs show visibility ranging from near zero to 20 metres; reports also mention weedy sea dragons and leatherjackets.",
        "url": "https://vis.report/PRT",
        "label": "Vis.Report first-person condition logs: Port Beach, Fremantle",
        "sourceClass": "firsthand-community-dive-logs",
        "retrievedAt": "2026-10-16",
        "limitations": "The source aggregates individual logged visits from 2022–2025; visibility, sea state, and wildlife vary by visit. The catalog site and log page share the Port Beach name and Fremantle location.",
    },
}


def build() -> dict[str, Any]:
    canonical_sites = load_canonical_sites()
    canonical_ids = {str(row[12]).strip().lower() for row in canonical_sites if len(row) > 12 and row[12]}
    by_id: dict[str, Any] = {}
    # Prefer the latest consolidated decisions. Keep v149 as a fallback because
    # consolidation intentionally contains only rows with completed category
    # decisions; other reviewed canonical rows can still carry usable fields.
    for review_path in (REVIEW, REVIEW_FALLBACK):
        with review_path.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                site_id = (row.get("site_id") or "").strip().lower()
                if site_id not in canonical_ids or site_id in by_id:
                    continue
                # The user's workflow defines needs-source-review as reviewed.
                # Keep explicitly unreviewed category rows out of generated copy.
                if (row.get("review_status") or "").strip().lower() == "unreviewed":
                    continue
                description, claims = summary_text(row)
                urls = clean_source_urls(row.get("evidence_url_or_id") or "")
                reference_id = (row.get("evidence_url_or_id") or "").strip() if not urls else ""
                if not description:
                    continue
                evidence_source = row.get("evidence_source") or ""
                if urls:
                    sources = [{
                        "label": source_label_for(url, evidence_source),
                        "url": url,
                        "sourceClass": "reviewed-site-reference",
                        "limitations": "Provenance was recorded in the reviewed category export; it supports the listed category evidence, not unlisted site conditions.",
                        "claims": claims,
                    } for url in urls]
                else:
                    source_label = evidence_source.split(";")[0].strip() or "Reviewed category record"
                    sources = [{
                        "label": source_label,
                        "referenceId": reference_id,
                        "sourceClass": "reviewed-site-reference",
                        "limitations": "Provenance was recorded in the reviewed category export; it supports the listed category evidence, not unlisted site conditions.",
                        "claims": claims,
                    }]
                by_id[site_id] = {
                    "status": "published",
                    "summaryReviewStatus": "generated-from-reviewed-attributes",
                    "language": "en",
                    "authoringMethod": "Deterministic summary of reviewed DiveAtlas categories",
                    "description": description,
                    "evidenceNote": "Summary reflects reviewed setting, access, and feature labels; details not present in those fields are omitted.",
                    "sources": sources,
                }

    # The evidence export contains linked references for only part of the
    # reviewed category inventory. Use canonical reviewed metadata for the
    # remaining category summaries, keeping named source/record provenance
    # even when no public URL was recorded.
    for site in canonical_sites:
        if len(site) <= 17:
            continue
        site_id = str(site[12] or "").strip().lower()
        metadata = site[17] if isinstance(site[17], dict) else {}
        if (
            not site_id or site_id in by_id
            or metadata.get("schema") != "dive-site-category-v1"
            or metadata.get("status") != "reviewed"
        ):
            continue
        categories = {
            "site_id": site_id,
            "name": str(site[0] or "Dive site"),
            "setting": str(site[14] or ""),
            "access": str(site[15] or ""),
            "features": ";".join(str(item) for item in (site[16] or []) if item),
        }
        description, claims = summary_text(categories)
        if not description:
            continue
        raw_refs = str(metadata.get("evidenceUrlOrId") or "")
        urls = clean_source_urls(raw_refs)
        labels = [part.strip() for part in str(metadata.get("evidenceSource") or "").split(";") if part.strip()]
        record_ids = [part.strip() for part in raw_refs.split(";") if part.strip() and not part.strip().startswith(("http://", "https://"))]
        source_file = str(metadata.get("sourceFile") or "").strip()
        record_id = str(metadata.get("sourceRecordId") or "").strip()
        sources: list[dict[str, Any]] = []
        if urls:
            for index, url in enumerate(urls):
                sources.append({
                    "label": source_label_for(url, labels[min(index, len(labels) - 1)] if labels else "Reviewed category record"),
                    "url": url,
                    "sourceClass": "reviewed-site-reference",
                    "limitations": "Canonical reviewed category metadata; this reference supports the recorded categories, not unlisted site conditions.",
                    "claims": claims,
                })
        else:
            references = record_ids or ([record_id] if record_id else [])
            if source_file:
                references = [f"{item} ({source_file})" for item in references] or [source_file]
            if labels == ["existing reviewed legacy type field [7]"]:
                listed_sources = [part.strip().lower() for part in re.split(r"[|;,]+", str(site[8] or "")) if part.strip()]
                labels = [LISTED_SOURCE_LABELS[source] for source in listed_sources if source in LISTED_SOURCE_LABELS]
            for index, label in enumerate(labels or ["Reviewed DiveAtlas category record (direct source not retained)"]):
                source: dict[str, Any] = {
                    "label": label,
                    "sourceClass": "reviewed-site-reference",
                    "limitations": "Canonical reviewed category metadata; this reference supports the recorded categories, not unlisted site conditions.",
                    "claims": claims,
                }
                if references:
                    source["referenceId"] = references[min(index, len(references) - 1)]
                sources.append(source)
        if not sources:
            continue
        by_id[site_id] = {
            "status": "published",
            "summaryReviewStatus": "generated-from-reviewed-attributes",
            "language": "en",
            "authoringMethod": "Deterministic summary of reviewed DiveAtlas categories",
            "description": description,
            "evidenceNote": "Summary reflects reviewed setting, access, and feature labels; details not present in those fields are omitted.",
            "sources": sources,
        }

    # Add a site-specific description where the published profile contains
    # useful narrative beyond the categories already captured in the record.
    melissas_garden_id = "6c4e81de-9648-404c-8a32-69db89707e5c"
    if melissas_garden_id not in canonical_ids:
        raise ValueError("Melissa’s Garden stable ID is missing from canonical data")
    by_id[melissas_garden_id] = MELISSAS_GARDEN_SUMMARY

    # A small set of uncovered sites has narrative profile evidence but no
    # reviewed categories. Keep those summaries attributed to the contributor
    # and attach the exact site page; do not infer omitted categories.
    for site_id, (description, url) in PROFILE_SUMMARY_OVERRIDES.items():
        if site_id not in canonical_ids:
            continue
        by_id[site_id] = {
            "status": "published",
            "summaryReviewStatus": "source-checked-synthesis",
            "language": "en",
            "authoringMethod": "AI-assisted synthesis of v147 review-exported PADI profile text",
            "description": description,
            "evidenceNote": "Based on a member-contributed profile captured in review export v147; not independently confirmed. Conditions and sightings may vary.",
            "sources": [{
                "label": "PADI member-contributed site profile",
                "url": url,
                "sourceClass": "contributor-site-profile",
                "snapshotVersion": "v147",
                "limitations": "Review export recorded this as a live PADI contributor profile. Its description is source-reported and may not reflect current local conditions.",
                "claims": ["site-description"],
            }],
        }

    # Apply site-specific operator summaries only where identity is independently
    # tied to the canonical record and the linked operator pages describe that site.
    for site_id, summary in OPERATOR_SUMMARY_OVERRIDES.items():
        if site_id not in canonical_ids:
            continue
        by_id[site_id] = {
            "status": "published",
            "summaryReviewStatus": "source-checked-synthesis",
            "language": "en",
            "authoringMethod": "AI-assisted synthesis from linked site and operator guides",
            **summary,
        }

    # For sites without categories or narrative copy, a direct SSI profile
    # snapshot can still support a useful, explicitly dated depth/difficulty
    # statement. Require the review export's exact name/country and zero-meter
    # coordinate match so similarly named sites cannot leak into the atlas.
    accepted_ssi_matches = {
        (
            "SSI MyDiveGuide / harvested public SSI locator",
            "unique exact country/name; coordinate offset 0.0 m",
        ),
        (
            "SSI MyDiveGuide public profile snapshot",
            "unique normalized country/name; closest queue point 0.0m",
        ),
    }
    with EVIDENCE.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            site_id = (row.get("site_id") or "").strip().lower()
            if (
                site_id not in canonical_ids or site_id in by_id
                or (row.get("source"), row.get("source_match_audit")) not in accepted_ssi_matches
            ):
                continue
            try:
                profile = json.loads(row.get("source_fields_raw") or "null")
            except json.JSONDecodeError:
                continue
            if not isinstance(profile, dict):
                continue
            raw_depth = profile.get("maxDepth", profile.get("depth"))
            try:
                depth = float(raw_depth)
            except (TypeError, ValueError):
                depth = 0
            depth_text = f"maximum depth of {depth:g} m" if depth > 0 else ""

            raw_levels = profile.get("level") or profile.get("difficulty") or []
            if isinstance(raw_levels, str):
                raw_levels = re.split(r"[,;|]+", raw_levels)
            if not isinstance(raw_levels, list):
                raw_levels = []
            levels = []
            for value in raw_levels:
                level = str(value).strip().casefold()
                if level in {"beginner", "intermediate", "advanced", "expert"} and level not in levels:
                    levels.append(level)
            if not depth_text and not levels:
                continue
            clauses = []
            claims = []
            if depth_text:
                clauses.append(f"gives a {depth_text}")
                claims.append("max_depth")
            if levels:
                level_text = ", ".join(levels[:-1]) + (f" and {levels[-1]}" if len(levels) > 1 else levels[0])
                clauses.append(f"marks it for {level_text} divers")
                claims.append("difficulty")

            url = clean_source_urls(row.get("source_url") or profile.get("url") or "")
            if not url or "divessi.com" not in url[0].lower():
                continue
            by_id[site_id] = {
                "status": "published",
                "summaryReviewStatus": "source-snapshot-synthesis",
                "language": "en",
                "authoringMethod": "Summary from a coordinate-matched SSI profile snapshot",
                "description": f"SSI's profile from 22 June 2026 { ' and '.join(clauses) }.",
                "sources": [{
                    "label": "SSI MyDiveGuide profile (snapshot 2026-06-22)",
                    "url": url[0],
                    "sourceClass": "third-party-profile-snapshot",
                    "retrievedAt": "2026-06-22",
                    "limitations": "Third-party snapshot of the public SSI locator. Values are profile-reported; depth definitions can vary. Verify on the linked SSI page and with local operators.",
                    "claims": claims,
                }],
            }

    # Keep the manually source-checked example with richer operator detail.
    if CHICKEN_REEF_ID not in canonical_ids:
        raise ValueError("Chicken Reef stable ID is missing from canonical data")
    by_id[CHICKEN_REEF_ID] = CHICKEN_REEF

    # Prefer a matched first-person contributor account over the generic
    # category/profile summary, while keeping observations attributed and
    # avoiding claims that the contributor's identity was verified.
    for site_id, (description, url) in DIVER_REVIEW_SUMMARY_OVERRIDES.items():
        if site_id not in canonical_ids:
            raise ValueError(f"First-hand summary site ID is missing: {site_id}")
        by_id[site_id] = {
            "status": "published",
            "summaryReviewStatus": "first-person-community-account-synthesis",
            "language": "en",
            "authoringMethod": "AI-assisted synthesis of a first-person SSI-linked community profile",
            "description": description,
            "evidenceNote": "A first-person observation appears in the SSI-linked community profile. The profile author’s identity and diving credentials are not independently verified; sightings and conditions are individual reports.",
            "sources": [{
                "label": "SSI MyDiveGuide community profile (snapshot 2026-10-07)",
                "url": url,
                "sourceClass": "first-person-community-dive-account",
                "retrievedAt": "2026-10-07",
                "limitations": "Community-maintained profile matched to the canonical site by exact country/name and coordinates. First-person wording supports an account of experience but does not independently verify the author's identity, credentials, or whether conditions remain current.",
                "claims": ["first-person-dive-observation"],
            }],
        }

    for site_id, account in DIVER_ACCOUNT_SUMMARY_OVERRIDES.items():
        if site_id not in canonical_ids:
            raise ValueError(f"First-hand trip-report site ID is missing: {site_id}")
        by_id[site_id] = {
            "status": "published",
            "summaryReviewStatus": "firsthand-diver-account-synthesis",
            "language": "en",
            "authoringMethod": "AI-assisted synthesis of a published first-person diver account",
            "description": account["description"],
            "evidenceNote": account["limitations"],
            "sources": [{
                "label": account["label"],
                "url": account["url"],
                "sourceClass": account["sourceClass"],
                "retrievedAt": account["retrievedAt"],
                "limitations": account["limitations"],
                "claims": ["firsthand-dive-observation", "site-identity"],
            }],
        }
    return dict(sorted(by_id.items()))


def main() -> None:
    records = build()
    defaults = {
        "status": "published",
        "summaryReviewStatus": "generated-from-reviewed-attributes",
        "language": "en",
        "authoringMethod": "Deterministic summary of reviewed DiveAtlas categories",
    }
    source_defaults = {
        "linked": {
            "sourceClass": "reviewed-site-reference",
            "limitations": "Recorded in the reviewed category export; this reference supports the listed categories, not unlisted site conditions.",
        },
        "named": {
            "sourceClass": "reviewed-category-provenance",
            "limitations": "The reviewed category record retains this source name without a direct site URL; it is provenance, not an independently inspectable citation.",
        },
        "snapshot": {
            "sourceClass": "third-party-profile-snapshot",
            "retrievedAt": "2026-06-22",
            "limitations": "Third-party snapshot of the public SSI locator. Values are profile-reported; depth definitions can vary. Verify on the linked SSI page and with local operators.",
        },
    }
    by_site_id = {}
    for site_id, entry in records.items():
        if entry.get("authoringMethod") == defaults["authoringMethod"]:
            compact = {
                "description": entry["description"],
                "sources": [[
                    source.get("label", ""),
                    source.get("url", ""),
                    source.get("referenceId", ""),
                ] for source in entry["sources"]],
            }
        elif entry.get("authoringMethod") == "Summary from a coordinate-matched SSI profile snapshot":
            compact = {
                "type": "profileSnapshot",
                "description": entry["description"],
                "sources": [[
                    source.get("label", ""),
                    source.get("url", ""),
                    source.get("referenceId", ""),
                    source.get("claims", []),
                ] for source in entry["sources"]],
            }
        else:
            compact = entry
        by_site_id[site_id] = compact

    leftover_list_phrases = [
        site_id for site_id, summary in by_site_id.items()
        if SUMMARY_RECORD_LIST_PATTERN.search(summary.get("description", ""))
    ]
    if leftover_list_phrases:
        raise ValueError(
            "Summary copy still uses a record-list template for site IDs: "
            + ", ".join(leftover_list_phrases[:10])
        )

    payload = {
        "schema": "dive-site-summary-v2",
        "defaults": defaults,
        "profileSnapshotDefaults": {
            "status": "published",
            "summaryReviewStatus": "source-snapshot-synthesis",
            "language": "en",
            "authoringMethod": "Summary from a coordinate-matched SSI profile snapshot",
        },
        "sourceDefaults": source_defaults,
        "bySiteId": by_site_id,
    }
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    compressed = gzip.compress(encoded, compresslevel=9, mtime=0)
    OUTPUT.write_bytes(compressed)
    print(
        f"Wrote {len(records):,} summaries to {OUTPUT} "
        f"({len(encoded):,} JSON bytes -> {len(compressed):,} gzip bytes)"
    )


if __name__ == "__main__":
    main()
