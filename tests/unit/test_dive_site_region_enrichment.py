import unittest

from tools.enrich_dive_site_regions import suggest_regions


def row(name, lat, lon, region="", aliases="", country=""):
    return [name, lat, lon, None, None, None, None, "", "osm", country,
            region, aliases, f"00000000-0000-4000-8000-{len(name):012d}"]


class RegionEnrichmentTest(unittest.TestCase):
    def test_patches_only_when_three_distinct_nearby_sites_agree(self):
        target = row("Unknown reef", 0, 0, country="Indonesia")
        peers = [
            row("North reef", 0.005, 0, "Raja Ampat"),
            row("West reef", 0, 0.005, "Raja Ampat"),
            row("East reef", -0.005, 0, "Raja Ampat"),
            row("Remote reef", 10, 10, "Bali"),
        ]

        suggestion = next(item for item in suggest_regions([target, *peers])
                          if item["site_name"] == "Unknown reef")

        self.assertEqual(suggestion["status"], "auto_patch")
        self.assertEqual(suggestion["candidate_region"], "Raja Ampat")
        self.assertEqual(suggestion["neighbor_count"], 3)
        self.assertEqual(target[9], "Indonesia")
        self.assertEqual(target[10], "")

    def test_conflicting_neighbors_are_left_for_review(self):
        target = row("Unknown reef", 0, 0)
        peers = [
            row("North reef", 0.005, 0, "Raja Ampat"),
            row("West reef", 0, 0.005, "Raja Ampat"),
            row("East reef", -0.005, 0, "Bali"),
        ]

        suggestion = next(item for item in suggest_regions([target, *peers])
                          if item["site_name"] == "Unknown reef")

        self.assertEqual(suggestion["status"], "review")
        self.assertEqual(target[10], "")

    def test_aliases_do_not_count_the_same_neighbor_twice(self):
        target = row("Unknown reef", 0, 0)
        first = row("Bommies North", 0.005, 0, "Raja Ampat", aliases="North Bommies")
        duplicate = row("North Bommies", 0.006, 0, "Raja Ampat", aliases="Bommies North")
        other = row("West reef", 0, 0.005, "Raja Ampat")

        suggestion = next(item for item in suggest_regions([target, first, duplicate, other])
                          if item["site_name"] == "Unknown reef")

        self.assertEqual(suggestion["status"], "review")
        self.assertEqual(suggestion["neighbor_count"], 2)


if __name__ == "__main__":
    unittest.main()
