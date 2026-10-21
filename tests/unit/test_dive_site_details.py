import unittest

from tools.export_dive_site_details import public_records, recommendation_catalog
from tools.prepare_pages import is_external_data_path
from pathlib import Path


class PublicDetailRecordsTest(unittest.TestCase):
    def row(self, site_id="1a532e42-9890-4ea9-b239-0f5fbb836317"):
        return ["Example reef", -0.55, 130.7, 12, 25, None, "Beginner", "reef", "PADI",
                "Indonesia", "Raja Ampat", "Alias", site_id, [], "marine", "boat", ["reef"],
                {"status": "reviewed", "reviewNotes": "INTERNAL NOTE", "sourceFile": "private.csv",
                 "evidenceSource": "Public reference", "evidenceUrlOrId": "https://example.com/site"}]

    def test_only_public_fields_and_published_summary_are_exported(self):
        row = self.row()
        records = public_records([row], {}, {row[12]: {"description": "Published summary", "reviewNotes": "PRIVATE"}}, "", {})
        self.assertEqual(records[0]["summary"], "Published summary")
        self.assertEqual(records[0]["categories"]["features"], "reef")
        self.assertEqual(records[0]["sources"], [["Public reference", "https://example.com/site"]])
        self.assertEqual(records[0]["location_hierarchy"], ["Asia", "South-Eastern Asia", "Indonesia", "Raja Ampat"])
        self.assertNotIn("reviewNotes", str(records))
        self.assertNotIn("private.csv", str(records))

    def test_duplicate_ids_and_invalid_coordinates_do_not_create_pages(self):
        row = self.row()
        self.assertEqual(public_records([row, row], {}, {}, "", {}), [])
        for latitude in [True, float("nan"), 91]:
            row[1] = latitude
            self.assertEqual(public_records([row], {}, {}, "", {}), [])

    def test_data_is_externalized_in_production(self):
        self.assertTrue(is_external_data_path(Path("data/dive-site-details/v1/example.json")))
        self.assertFalse(is_external_data_path(Path("dive-site.html")))

    def test_recommendation_catalog_uses_the_static_page_candidate_shape(self):
        catalog = recommendation_catalog([{
            "site_id": self.row()[12], "name": "Example reef", "slug": "example-reef",
            "lat": -0.55, "lon": 130.7, "country": "Indonesia", "region": "Raja Ampat",
            "difficulty": "Beginner", "categories": {"features": "reef | wall"},
            "characteristics": "reef", "photo": {"src": "/reef.webp", "credit": "Photographer"},
        }])
        self.assertEqual(catalog["schema"], "dive-site-recommendations-v1")
        self.assertEqual(catalog["sites"][0]["features"], ["wall", "reef"])
        self.assertEqual(catalog["sites"][0]["feature_values"], ["reef", "wall"])
        self.assertEqual(catalog["sites"][0]["photo"], "/reef.webp")


if __name__ == "__main__":
    unittest.main()
