from __future__ import annotations

import unittest

from tools.enrich_dive_site_locations import (
    CountryLookup, audit_rows, choose_region, marine_area_context,
)


def polygon(minimum: float, maximum: float) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [[
            [minimum, minimum], [maximum, minimum], [maximum, maximum],
            [minimum, maximum], [minimum, minimum],
        ]],
    }


class CountryLookupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.lookup = CountryLookup(
            [{"properties": {"name": "Landia"}, "geometry": polygon(-2, 2)}],
            {
                "features": [
                    {"properties": {"kind": "200NM", "sovereignIsos": ["SEA"]}, "geometry": polygon(8, 12)},
                    {"properties": {"kind": "Overlapping claim", "sovereignIsos": ["SEA", "LAND"]}, "geometry": polygon(18, 22)},
                ],
                "countries": {"SEA": {"name": "Sealand"}},
            },
        )

    def test_land_polygon_resolves_before_maritime_zones(self) -> None:
        self.assertEqual(self.lookup.resolve(0, 0), ("Landia", "Natural Earth land polygon"))

    def test_unique_eez_resolves_offshore_country(self) -> None:
        self.assertEqual(self.lookup.resolve(10, 10), ("Sealand", "Marine Regions unique EEZ"))

    def test_unique_eez_uses_sovereign_name_when_iso_index_has_no_entry(self) -> None:
        lookup = CountryLookup(
            [],
            {
                "features": [{"properties": {
                    "kind": "200NM", "sovereignIsos": ["FRA"], "sovereigns": ["France"],
                }, "geometry": polygon(8, 12)}],
                "countries": {},
            },
        )
        self.assertEqual(lookup.resolve(10, 10), ("France", "Marine Regions unique EEZ sovereign name"))

    def test_overlapping_claim_is_left_unassigned(self) -> None:
        self.assertEqual(self.lookup.resolve(20, 20), ("", "overlapping maritime claim"))

    def test_open_ocean_does_not_use_nearest_country(self) -> None:
        self.assertEqual(self.lookup.resolve(40, 40), ("", "outside a unique national EEZ"))


class RegionSelectionTests(unittest.TestCase):
    def test_unique_admin_region_takes_priority_over_marine_area(self) -> None:
        location = {
            "stateProvince": ["Central Province"],
            "oceanArea": ["Coastal Sea"],
            "_provenance": {"stateProvince": "Natural Earth 10m admin-1 point-in-polygon"},
        }
        self.assertEqual(
            choose_region(["Site", 1.0, 2.0, None, None, None, None, "", "", "Landia", ""], location),
            ("Central Province", "Natural Earth admin-1 point-in-polygon"),
        )

    def test_primary_admin_region_name_is_used_before_its_aliases(self) -> None:
        location = {
            "stateProvince": ["North Province", "South Province"],
            "oceanArea": ["Coastal Sea"],
            "_provenance": {"stateProvince": "Natural Earth 10m admin-1 point-in-polygon"},
        }
        self.assertEqual(
            choose_region(["Site", 1.0, 2.0, None, None, None, None, "", "", "Landia", ""], location),
            ("North Province", "Natural Earth admin-1 point-in-polygon"),
        )

    def test_marine_area_is_context_not_a_local_region(self) -> None:
        location = {"stateProvince": [], "oceanArea": ["Gulf of Example"], "_provenance": {}}
        self.assertEqual(
            choose_region(["Site", 1.0, 2.0, None, None, None, None, "", "", "Landia", ""], location),
            ("", "no admin-1 polygon match"),
        )
        self.assertEqual(marine_area_context({"oceanArea": ["Gulf of Example", "Gulf of Example"]}), "Gulf of Example")

    def test_country_name_is_not_repeated_as_a_region(self) -> None:
        location = {
            "stateProvince": ["Czech Republic"],
            "_provenance": {"stateProvince": "Natural Earth 10m admin-1 point-in-polygon"},
        }
        self.assertEqual(choose_region(["Site", 1.0, 2.0, None, None, None, None, "", "", "", ""], location, "Czechia"), ("", "no admin-1 polygon match"))

    def test_existing_location_values_are_not_included_for_patching(self) -> None:
        row = ["Existing", 0.0, 0.0, None, None, None, None, "", "", "Landia", "Known Bay", "", "site-1"]
        lookup = CountryLookup([], {"features": [], "countries": {}})
        self.assertEqual(audit_rows([row], {}, lookup), [])


if __name__ == "__main__":
    unittest.main()
