# Dive-site depth range expansion — 2026-10-14

## Display rule

Show a **Depth range** only when both bounds are supported for the mapped site. Show a supported single bound as a partial range with **Unavailable** at the unknown end. If only the original positive scalar exists, keep it visible as **Recorded depth: X m** until a source confirms a range. A scalar alone is not a defensible range.

The 10,597 exact SSI `max_depth_m` matches remain source evidence about maxima, but they are no longer promoted to partial ranges in the interface. That promotion displayed **Unavailable – X m** for many sites and obscured their existing number. Their original scalar values remain in the raw dataset and are shown as recorded depth unless a reviewed range now applies.

## Current display snapshot

The display logic currently resolves 18,813 site records as:

| Display state | Sites |
|---|---:|
| Full depth range | 148 |
| Partial range with an unavailable bound | 19 |
| Recorded depth only | 15,903 |
| No recorded depth | 2,743 |

These totals include the existing 57 zero-depth corrections and 138 source-reviewed range supplements. The supplementary range file contains 136 complete ranges and 2 one-sided ranges. Individual decisions and evidence URLs are in [the CSV review register](dive-site-depth-range-expansion-2026-10-14.csv); the searchable [current website display snapshot](current-dive-site-depth-display-2026-10-14.html) lists every mapped site.

## New range research

Earlier source-review batches added 33 complete ranges: 20 British Virgin Islands sites and 13 Grenada sites. Later sections summarize additional Koh Tao, BVI, Miyakojima, and Yaeyama profiles; all decisions remain in the review register. The new values come from published local operator site profiles; confidence is Medium because these describe recreational dive profiles, not surveyed seabed limits. Site identity was checked against the mapped record, and ranges that conflicted with its recorded scalar or had ambiguous site scope were held back.

### British Virgin Islands

| Site | Range | Evidence |
|---|---:|---|
| Coral Gardens | 9.1–15.2 m | [Dive BVI](https://divebvi.com/dive-sites/) |
| Shark Point | 12.2–21.3 m | [Dive BVI](https://divebvi.com/dive-sites/) |
| Bronco Billy | 6.1–13.7 m | [Dive BVI](https://divebvi.com/dive-sites/) |
| Wall to Wall | 9.1–22.9 m | [Dive BVI](https://divebvi.com/dive-sites/) |
| Dry Rocks East | 9.1–24.4 m | [Dive BVI](https://divebvi.com/dive-sites/) |
| Markoe Point | 12.2–24.4 m | [Dive BVI](https://divebvi.com/dive-sites/) |
| Wreck Alley | 15.2–25.9 m | [Dive BVI](https://divebvi.com/dive-sites/) |
| The Chimney at Great Dog Island | 5–14 m | [BVI Diving](https://www.bvidiving.com/diving-the-chimney.html) |
| Alice in Wonderland, BVI | 10.7–24.4 m | [Dive BVI](https://divebvi.com/dive-sites/) |
| Ginger Steps | 9.1–27.4 m | [Dive BVI](https://divebvi.com/dive-sites/) |
| Carval Rock | 12.2–21.3 m | [Dive BVI](https://divebvi.com/dive-sites/) |
| Gingers Backside | 6.1–18.3 m | [Dive BVI](https://divebvi.com/dive-sites/) |
| Rainbow Canyons | 6.1–18.3 m | [Blue Water Divers](https://bluewaterdiversbvi.com/dive-sites/) |
| Vanishing Rock | 7.6–13.7 m | [Dive BVI](https://divebvi.com/dive-sites/) |
| Angelfish Reef | 9.1–24.4 m | [Blue Water Divers](https://bluewaterdiversbvi.com/dive-sites/) |
| RMS Rhone (Wreck) | 6.1–24.4 m | [Blue Water Divers](https://bluewaterdiversbvi.com/dive-sites/) |
| Brewer's East | 12.2–21.3 m | [Dive BVI](https://divebvi.com/dive-sites-old/) |
| Dolphin Rocks | 6.1–15.2 m | [Dive BVI](https://divebvi.com/dive-sites-old/) |
| Flintstones | 9.1–21.3 m | [Dive BVI](https://divebvi.com/dive-sites-old/) |
| Joe's Cave | 6.1–13.7 m | [Dive BVI](https://divebvi.com/dive-sites-old/) |

For Alice in Wonderland, the operator describes a 35–70 ft route in one profile, while an older listing describes the site edge dropping to about 80 ft. The broader 35–80 ft envelope is used and the discrepancy is recorded in the sidecar note. The Rhone entry is specifically the wreck profile off Salt Island. Joe's Cave's stored 14 m value is consistent with rounding the 45 ft operator limit to whole meters.

### Grenada

| Site | Range | Evidence |
|---|---:|---|
| Purple Rain | 6–25 m | [Eco Dive Grenada](https://www.ecodivegrenada.com/about-us/dive-sites/) |
| Shark Reef - Grenada | 10–20 m | [Eco Dive Grenada](https://www.ecodivegrenada.com/about-us/dive-sites/) |
| Northern Exposure | 6–23 m | [Eco Dive Grenada](https://www.ecodivegrenada.com/about-us/dive-sites/) |
| Flamingo Bay | 5–18 m | [Eco Dive Grenada](https://www.ecodivegrenada.com/about-us/dive-sites/) |
| Hema One | 28–33 m | [Eco Dive Grenada](https://www.ecodivegrenada.com/about-us/dive-sites/) |
| MV Shakem, wreck | 16–30 m | [Eco Dive Grenada](https://www.ecodivegrenada.com/about-us/dive-sites/) |
| Anina (Wreck) | 20–33 m | [Eco Dive Grenada](https://www.ecodivegrenada.com/about-us/dive-sites/) |
| Bianca C (Wreck) | 28–40 m | [Eco Dive Grenada](https://www.ecodivegrenada.com/about-us/dive-sites/) |
| Whibbles Reef | 15–30 m | [Eco Dive Grenada](https://www.ecodivegrenada.com/about-us/dive-sites/) |
| Windmill Shallows | 18–40 m | [Eco Dive Grenada](https://www.ecodivegrenada.com/about-us/dive-sites/) |
| Car Pile - Grenada | 25–40 m | [Eco Dive Grenada](https://www.ecodivegrenada.com/about-us/dive-sites/) |
| Buccaneer Molinere Bay (Wreck) | 18–25 m | [Eco Dive Grenada](https://www.ecodivegrenada.com/about-us/dive-sites/) |
| Boss Reef | 6–25 m | [Eco Dive Grenada](https://www.ecodivegrenada.com/about-us/dive-sites/) |

### Additional PADI-matched Grenada profiles

These two records were missing a numeric depth in the source data. The PADI profiles supply a range and publish coordinates exactly matching their mapped records; PADI credits Eco Dive for both profiles. Confidence remains Medium because these are recreational dive profiles, not surveyed seabed bounds.

| Site | Range | Evidence |
|---|---:|---|
| Happy Valley | 6–28 m | [PADI / Eco Dive](https://www.padi.com/dive-site/grenada/happy-valley/) |
| Kahonee | 10–15 m | [PADI / Eco Dive](https://www.padi.com/dive-site/grenada/kahonee/) |

## Koh Tao single-number depth research

This pass matched 30 scalar-only map records to named Koh Tao dive-site profiles. Hydronauts supplied a broad local operator list; AquaTao, Big Blue, PADI, Echo Divers, Goodtime, Black Turtle, Bophut, Island Travel, and coordinate-matched profiles were used where available to corroborate or widen published bounds. Where operators describe different routes, the applied value is the outer published recreational dive profile and the note records the difference. These are route/site profiles, not surveyed seabed limits. The original scalar column remains unchanged.

| Site | Range | Evidence |
|---|---:|---|
| Chumphon Pinnacle | 12–40 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Southwest Pinnacle | 6–30 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Green Rock | 5–30 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Red Rock | 1–22 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Hin Pee Wee | 5–30 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Twins | 5–20 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Japanese Gardens | 2–20 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| White Rock | 5–28 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Mango Bay | 2–18 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Aow Leuk | 2–16 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Tanote Bay | 5–20 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Shark Island | 5–30 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Pottery | 3–15 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Chalok Bay | 3–12 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Hin Ngam | 3–20 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Hin Wong Bay | 5–20 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Hin Wong Pinnacle | 10–32 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| HTMS Sattakut 742, Wreck | 18–31 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Mao Bay | 5–20 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| HTMS Hanhak Sattru 312, Wreck | 16–28 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Buddha Point | 3–12 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| King Kong | 5–18 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| HTMS Suphairin 313, Wreck | 11–28 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Lighthouse Pinnacle | 5–18 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Tao Tong | 5–18 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |
| Buoyancy World | 10–20 m | [local dive-site profiles](https://www.blackturtledive.com/koh-tao-dive-sites/buoyancy-world/) |
| Three Rocks | 5–12 m | [local dive-site profiles](https://www.aquatao.fr/content/sites_de_plongee.php) |
| Laem Thian Caves | 18–20 m | [local dive-site profiles](https://bophutdiving.com/leam-thian/) |
| Junkyard | 8–12 m | [local dive-site profiles](https://goodtimethailand.com/diving/buoyancy/) |
| No Name Pinnacle | 5–40 m | [local dive-site profiles](https://hydronautsdiving.com/koh-tao-dive-sites/) |

The separate **Laem Thian Bay** candidate remains held: Bophut lists 5–15 m for the bay, while the mapped record stores 16 m and a broader cape profile reaches 20 m. The record and its existing display therefore remain unchanged. The CSV review register records the conflict.

## Additional British Virgin Islands single-number profiles

A further pass matched seven scalar-only BVI records to named local or SSI/ScubaGo dive profiles. The ranges below include only records whose stored value falls within the published site range.

| Site | Range | Evidence |
|---|---:|---|
| Willy T (Wreck) | 10.7–19.8 m | [site profile](https://divebvi.com/dive-the-willy-t-wreck/) |
| Blue Chromis Reef | 6–15 m | [site profile](https://reefwander.com/diving/bvi-rms-rhone/blue-chromis-reef/) |
| Chromis Reef (middle) | 6.1–15.2 m | [site profile](https://www.scubago.com/en/explore/divesite/chromis-reef-middle-261151) |
| P.O.S. (Cockroach Island) | 4.6–24.4 m | [site profile](https://www.scubago.com/en/explore/divesite/p.o.s.-cockroach-island-180681) |
| Dip n Scrub | 6.1–18.3 m | [site profile](https://divebvi.com/dive-sites-old/) |
| Coral Gardens, Great Dog, BVI | 9.1–15.2 m | [site profile](https://divebvi.com/dive-sites-old/) |
| Devil’s Kitchen | 6.1–18.3 m | [site profile](https://divebvi.com/dive-sites-old/) |

Seven checked candidates remain held because the published upper bound falls below the mapped scalar: Chimney, Cistern Point, Diamond Reef, Invisibles, Monkey Point, Kodiak Queen, and Corridors. Their candidate evidence and the recorded values are in the CSV register; the website values were left untouched.

## Miyakojima single-number depth research

This pass added 14 complete ranges across 11 named Irabu/Shimoji sites. The source is Miyakojima Diving Aquatic Adventure, a local operator that publishes site-specific depth profiles. The English and Japanese map records for Antonio Gaudi, Cross Hole, and L-Shaped Arch refer to the same named sites and nearby coordinates, so each alias record receives the same sourced range. Original scalar values remain intact and each falls within its applied profile.

| Site | Range | Evidence |
|---|---:|---|
| The Devil’s Palace | 5–28 m | [Miyako operator: Shimoji sites](https://miyako-aquaticadventure.com/en/shimoji.html) |
| Antonio Gaudi (English and Japanese records) | 20–37 m | [Miyako operator: Shimoji sites](https://miyako-aquaticadventure.com/en/shimoji.html) |
| Tori Ike | 8–40 m | [Miyako operator: Shimoji sites](https://miyako-aquaticadventure.com/en/shimoji.html) |
| Nakanoshima Channel | 5–22 m | [Miyako operator: Shimoji sites](https://miyako-aquaticadventure.com/en/shimoji.html) |
| Nakanoshima Hole | 5–28 m | [Miyako operator: Shimoji sites](https://miyako-aquaticadventure.com/en/shimoji.html) |
| Mini Grotto | 5–23 m | [Miyako operator: Shimoji sites](https://miyako-aquaticadventure.com/en/shimoji.html) |
| Marine Lake | 5–20 m | [Miyako operator: Shimoji sites](https://miyako-aquaticadventure.com/en/shimoji.html) |
| Cross Hole (English and Japanese records) | 5–27 m | [Miyako operator: Irabu sites](https://miyako-aquaticadventure.com/en/irabu.html) |
| Snake Hole | 7–23 m | [Miyako operator: Irabu sites](https://miyako-aquaticadventure.com/en/irabu.html) |
| L-Shaped Arch (English and Japanese records) | 5–40 m | [Miyako operator: Irabu sites](https://miyako-aquaticadventure.com/en/irabu.html) |
| Shiratori / Siratorizaki | 8–30 m | [Miyako operator: Irabu sites](https://miyako-aquaticadventure.com/en/irabu.html) |

For Antonio Gaudi, the same operator describes the formation at 20–35 m and lists 37 m in the page’s depth field; the applied 20–37 m range preserves both published figures. Nakanoshima Hole’s profile lists 28 m and describes an entrance around 5 m. These are dive profiles, not surveyed seabed measurements.

## Yaeyama Islands single-number depth research

This pass added 13 complete ranges to scalar-only mapped records around Ishigaki, Kuroshima, Taketomi, and the Yonara Channel. Site identity was checked by name and location. SSI/ScubaGo and local Ishigaki profiles sometimes describe a normal route while another profile gives a wider site extent, so the applied bounds use the outer published profile and the notes preserve those differences.

| Site | Range | Evidence |
|---|---:|---|
| Manta Ray Scramble | 10–25 m | [SSI/ScubaGo](https://www.scubago.com/en/explore/divesite/manta-ray-scramble-283258), [Visit Okinawa](https://visitokinawajapan.com/discover/dive-sites-okinawa/yaeyama-islands-diving/) |
| Manta City Point | 5–25 m | [Reefwander](https://reefwander.com/diving/ishigaki/manta-city/), [Ishigaki site guide](https://ishigaki-tours.com/en/column/diving-spot) |
| Yonehara Reef | 5–30 m | [SSI MyDiveGuide](https://www.divessi.com/es/mydiveguide/divesite/yonehara-reef-japan-289487), [Reefwander](https://reefwander.com/diving/ishigaki/) |
| Sakieda Big Arch | 12–25 m | [SSI/ScubaGo](https://www.scubago.com/en/explore/divesite/sakieda-big-arch-644271), [Ishigaki site guide](https://ishigaki-tours.com/en/column/diving-spot) |
| Panari Big Corner | 5–20 m | [SSI/ScubaGo](https://www.scubago.com/en/explore/divesite/panari-big-corner-583027), [Ishigaki site guide](https://ishigaki-tours.com/en/column/diving-spot) |
| Kuroshima V-Drop | 5–30 m | [SSI/ScubaGo](https://www.scubago.com/en/explore/divesite/kuroshima-v-drop-224689) |
| Kuroshima Nakamoto Cave | 10–23 m | [SSI/ScubaGo](https://www.scubago.com/en/explore/divesite/kuroshima-nakamoto-cave-288773) |
| Sakuraguchi | 5–15 m | [SSI/ScubaGo](https://www.scubago.com/en/explore/divesite/sakuraguchi-844810) |
| Yonara Channel | 9–30 m | [SSI/ScubaGo](https://www.scubago.com/en/explore/divesite/yonara-channel-141574) |
| Osaki Batfish Reef | 10–20 m | [SSI/ScubaGo](https://www.scubago.com/en/explore/divesite/osaki-batfish-reef-776971) |
| Osaki Lion Fish Palace | 5–30 m | [SSI/ScubaGo](https://www.scubago.com/en/explore/divesite/osaki-lion-fish-palace-645631) |
| Osaki Hanagoi Reef | 5–35 m | [SSI/ScubaGo](https://www.scubago.com/en/explore/divesite/osaki-hanagoi-reef-697681), [Ishigaki site guide](https://ishigaki-tours.com/en/column/diving-spot) |
| Sukuji Gurukun Rock | 10–35 m | [SSI/ScubaGo Japanese profile](https://www.scubago.com/ja/explore/divesite/sukuji-gurukun-rock-705299), [Ishigaki site guide](https://ishigaki-tours.com/en/column/diving-spot) |

Sakieda Big Arch’s sources report 12–20 m and 15–25 m; the applied range covers both. The Ishigaki guide gives 10–20 m as the usual Osaki Hanagoi Reef profile, while SSI/ScubaGo publishes the broader 5–35 m site extent. The stored values for these 13 records all fall within the applied ranges.

## Malta, Gozo, and Comino single-number depth research

This pass added 25 full ranges to 25 scalar-only map records across Malta, Gozo, and Comino. Records were matched by their mapped site name and location; every stored scalar falls inside its applied range.

| Site | Range | Map records | Evidence |
|---|---:|---:|---|
| P31 Patrol Boat, Comino | 7–20 m | 2 | [local site profile](https://divemalta.com/dive-sites/comino/p31-patrol-boat/), [Visit Gozo](https://visitgozo.com/experience/diving/) |
| MV Karwela, Xatt l'Ahmar | 20–42 m | 4 | [local site profile](https://divemalta.com/dive-sites/gozo/mv-karwela/), [Visit Gozo](https://visitgozo.com/experience/diving/) |
| MV Cominoland, Xatt l'Ahmar | 32–40 m | 1 | [Visit Gozo](https://visitgozo.com/experience/diving/) |
| Um El Faroud, Wied iz-Zurrieq | 18–36 m | 3 | [local site profile](https://divemalta.com/dive-sites/south-malta/um-el-faroud/), [Watercolours Dive Centre](https://www.maltadiving.com/blog/diving-at-wied-iz-zurrieq/) |
| MV Rozi, Cirkewwa | 18–36 m | 2 | [site depth table](https://cronfa.swan.ac.uk/Record/cronfa59472/Download/59472__22485__016b804445e54616a44d6ce3193af3eb.pdf), [PADI](https://www.padi.com/dive-site/malta/rozi-cirkewwa-norte/), [Cirkewwa Marine Park](https://cirkewwamarinepark.mt/wrecks-and-divers-attractions/) |
| HMS Maori, Valletta | 9–16 m | 1 | [Malta dive-site profile](https://maltadives.com/sites/hmsmaori-valletta/en), [site depth table](https://cronfa.swan.ac.uk/Record/cronfa59472/Download/59472__22485__016b804445e54616a44d6ce3193af3eb.pdf) |
| Anchor Bay (Popeye Village), Malta | 10–18 m | 2 | [PDSA Malta](https://pdsa.org.mt/shore-dives/), [site depth table](https://cronfa.swan.ac.uk/Record/cronfa59472/Download/59472__22485__016b804445e54616a44d6ce3193af3eb.pdf), [Malta dive-site profile](https://maltadives.com/sites/anchorbay/en) |
| Ghar Lapsi, full shore-site envelope | 3–38 m | 1 | [local site profile](https://divemalta.com/dive-sites/south-malta/ghar-lapsi/), [PDSA Malta](https://pdsa.org.mt/shore-dives/) |
| Ghar Lapsi cavern | 3–12 m | 1 | [local site profile](https://divemalta.com/dive-sites/south-malta/ghar-lapsi/) |
| MV Imperial Eagle, Qawra | 18–42 m | 2 | [local site profile](https://divemalta.com/dive-sites/east-malta/imperial-eagle/), [Malta dive-site profile](https://maltadives.com/sites/mvimperialeagle/en) |
| Inland Sea tunnel, Gozo | 3–26 m | 1 | [local site profile](https://divemalta.com/dive-sites/gozo/inland-sea-tunnel/) |
| HMS Stubborn, Qawra | 45–56 m | 1 | [local technical site profile](https://divemalta.com/dive-sites/advanced-tec/hms-stubborn/) |
| X127 Lighter / Carolita, Malta | 5–25 m | 3 | [PADI profile](https://www.padi.com/dive-site/malta/x127-lighter-carolita/), [local wreck profile](https://divemalta.com/dive-sites/valletta/x127-lighter-wreck/) |
| Bristol Beaufighter, Malta | 35–38 m | 1 | [local wreck profile](https://divemalta.com/dive-sites/east-malta/bristol-beaufighter/), [Malta dive-site profile](https://maltadives.com/sites/bristolbeaufighter/en) |

Some profiles describe different routes within a named site. The table range uses the outer published envelope when the sources can be reconciled: Rozi sources give 18–32 m, a PADI maximum of 34 m, and 34–36 m for the Cirkewwa wrecks collectively; the local Karwela page reaches 20 m on the superstructure while Visit Gozo describes the top deck at 30 m and sand at 40–42 m; Anchor Bay sources include both a 12 m cove route and a wider 10–18 m site profile. Imperial Eagle's operator card describes a usual 30–42 m route, while its detailed wreck description places the wheelhouse at 18 m and the seabed at 42 m; the applied range covers the physical wreck. The broad Ghar Lapsi range includes the offshore Black John route; its cavern record has its own narrower range. These are published dive profiles, not surveyed seabed boundaries.

The report and CSV also retain unresolved cases. The whole Gozo Blue Hole profile is published as 5–60 m+ and Reqqa Point reaches 70 m+, so neither has a finite upper bound to enter as a complete numeric range. The P29 profile is listed as 18–40 m+, also open-ended. A second Cominoland record stores 41 m while Visit Gozo gives a 40 m maximum. The Cirkewwa Madonna/Sugar Loaf records have conflicting profile scopes, and one stored value is 25 m, outside a published 24 m bound. Tug 2 stores 19 m while the reviewed site table gives 12–18 m. One Bristol Beaufighter record stores 33 m against a 35–38 m profile. Their original scalar values remain visible pending better-matched evidence.

## Held candidates

The CSV retains earlier candidate reviews that were not applied, including Christ of the Abyss and Gozo Blue Hole, where the candidate represented a feature or route rather than a supported range for the mapped site. In this pass, the Eco Dive profiles for Veronica L and Tyrrel Bay conflict with the records' scalar depths, while Dragon Bay's broad reef/site scope does not resolve which duplicate point it describes. These remain unchanged. Laem Thian Bay is also held because the site-specific 5–15 m bay profile conflicts with its stored 16 m value; see the Koh Tao register entry.

## Interpretation limits

Published ranges reflect an operator's dive route, entry point, and recreational profile. They can vary with current, conditions, diver certification, and the part of a wreck or wall visited. They are not exhaustive bathymetric minimums or maximums. Preserve the source value and provenance when reviewing later candidates; do not infer a second bound from a scalar.
