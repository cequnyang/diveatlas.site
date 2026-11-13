import unittest

from tools.export_dive_site_details import public_records, recommendation_catalog
from tools.prepare_pages import is_external_data_path
from pathlib import Path
from unittest.mock import patch
from tools import dive_site_record_policy as policy
from tools import generate_seo_pages as seo


class PublicDetailRecordsTest(unittest.TestCase):
    def setUp(self):
        # Synthetic subsets do not load repository-wide identity decisions.
        patcher = patch.object(policy, 'read_reviews', return_value={})
        patcher.start()
        self.addCleanup(patcher.stop)
        # CI has no ignored Natural Earth dataset. Supply the geography used by
        # these synthetic records while keeping the real hierarchy/link logic.
        geography = patch.object(seo, 'country_geographies', return_value={
            'indonesia': ('Asia', 'South-Eastern Asia'),
        })
        geography.start()
        self.addCleanup(geography.stop)

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

    def test_name_aliases_are_not_parsed_as_difficulty_ranges(self):
        row = self.row(); row[11] = "Reef to Island, East | 日本語の名前"
        record = public_records([row], {}, {}, "", {})[0]
        self.assertEqual(record['aliases'], row[11])
        self.assertEqual(record['observations'][0]['aliases'], row[11])

    def test_multiple_labels_and_unknown_depth_survive(self):
        row = self.row()
        row[6] = "Beginner | Advanced | Expert"
        record = public_records([row], {}, {}, "", {})[0]
        self.assertEqual(record["difficulty"], row[6])
        self.assertEqual(record["observations"][0]["depths"][0]["meaning"], "unknown")
        self.assertNotEqual(seo.recommendation_difficulty(record), "beginner")
        self.assertIn("not verified suitability", record["evidence_notes"][0])

    def test_missing_provenance_is_not_a_provider_homepage(self):
        record = public_records([self.row()], {}, {}, "", {})[0]
        self.assertIsNone(record["observations"][0]["url"])
        self.assertIsNone(record["observations"][0]["retrieved_at"])
        self.assertEqual(record["sources"], [["Public reference", "https://example.com/site"]])
        row = self.row(); row[17] = {}
        self.assertEqual(public_records([row], {}, {}, "", {})[0]["sources"], [])

    def identity_rows(self):
        first = self.row()
        second = self.row("2a532e42-9890-4ea9-b239-0f5fbb836317")
        second[0] = "Example reef east"; second[2] += 0.001
        return first, second

    def review(self, status):
        first, second = self.identity_rows()
        return {"identities": [{"status": status, "site_ids": [first[12], second[12]],
                "canonical_id": first[12], "reason": "Explicit fixture review", "evidence": ["https://example.com/review"]}]}

    def test_proximity_and_similar_names_do_not_merge_or_establish_conflict(self):
        rows = self.identity_rows()
        normalized = policy.normalize_records(rows, {}, {})
        self.assertEqual([normalized[row[12]]["canonical_id"] for row in rows], [row[12] for row in rows])
        self.assertFalse(any("Source observations differ" in note for record in normalized.values() for note in record["evidence_notes"]))
        normalized = policy.normalize_records(rows, {}, self.review("distinct"))
        self.assertTrue(all(record["identity_status"] == "separate" for record in normalized.values()))

    def test_importer_does_not_merge_even_identical_nearby_names(self):
        from maintenance.import_reviewed_dive_site_candidates import apply
        rows = [self.row()]
        candidate = {"site_id": "2a532e42-9890-4ea9-b239-0f5fbb836317", "name": rows[0][0],
                     "latitude": str(rows[0][1]), "longitude": str(rows[0][2] + 0.001),
                     "review_status": "needs-source-review", "_candidate_file": "fixture.csv"}
        stats = apply(rows, [candidate])
        self.assertEqual(len(rows), 2)
        self.assertEqual(stats["possible_identity_pairs"], 1)
        self.assertEqual(rows[0][13], [])

    def test_candidates_stay_separate(self):
        rows = self.identity_rows()
        normalized = policy.normalize_records(rows, {}, self.review("candidate"))
        self.assertEqual(normalized[rows[1][12]]["canonical_id"], rows[1][12])
        self.assertIn("remain separate", " ".join(normalized[rows[0][12]]["evidence_notes"]))
        self.assertNotIn(rows[1][0], normalized[rows[0][12]]["aliases"])

    def test_confirmed_aliases_retain_observations_and_old_ids(self):
        rows = list(self.identity_rows()); rows[1][0] = "日本語の名前"; rows[1][5] = 37
        rows[1][6] = "Advanced"
        reviews = self.review("confirmed")
        reviews["observations"] = {rows[0][12]: [{"source": "Operator", "url": "https://example.com/site",
            "name": rows[0][0], "difficulty": ["Expert"], "retrieved_at": "2026-01-01",
            "depths": [{"value": 26, "meaning": "maximum"}, {"value": 18, "meaning": "typical"}]}]}
        with patch.object(policy, "read_reviews", return_value=reviews):
            records = public_records(rows, {}, {}, "", {})
        self.assertEqual(len(records), 2)
        self.assertEqual(records[1]["site_id"], rows[1][12])
        self.assertEqual(records[1]["canonical_id"], rows[0][12])
        self.assertIn("日本語の名前", records[0]["aliases"])
        self.assertEqual(len(recommendation_catalog(records)["sites"]), 1)
        self.assertIn("unresolved", " ".join(records[0]["evidence_notes"]))
        self.assertIn("2026-01-01", " ".join(records[0]["evidence_notes"]))
        self.assertEqual(records[0]["observations"][1]["depths"][1]["meaning"], "typical")
        for record in records:
            record["slug"] = record["site_id"]
            record["characteristics"] = "reef"
        index = seo.build_recommendation_index(records)
        self.assertTrue(all(not group["nearby"] and not group["features"] and not group["difficulty"] for group in index.values()))

    def test_confirmed_same_coordinate_records_keep_old_static_slugs(self):
        rows = list(self.identity_rows()); rows[1][1:3] = rows[0][1:3]
        summaries = {row[12]: {"description": "Published summary"} for row in rows}
        with patch.object(policy, "read_reviews", return_value=self.review("confirmed")):
            candidates, _ = seo.validated_candidates(rows, {}, summaries, "", {})
        self.assertEqual(len(candidates), 2)
        alias = next(site for site in candidates if site['site_id'] == rows[1][12])
        self.assertEqual(alias['slug'], 'example-reef-east')
        self.assertEqual(alias['canonical_slug'], 'example-reef')
        self.assertEqual(alias['name'], rows[0][0])

    def test_existing_summary_conflicts_and_known_dates_are_preserved(self):
        row = self.row()
        summaries = {row[12]: {"description": "Published", "evidenceNote": "Source A reports 26 m; source B reports 37 m; route unverified.",
            "sources": [{"label": "Source A", "url": "https://example.com/a", "retrievedAt": "2026-06-22"}]}}
        record = public_records([row], {}, summaries, "", {})[0]
        self.assertIn(summaries[row[12]]["evidenceNote"], " ".join(record["evidence_notes"]))
        self.assertEqual(record["source_provenance"][0]["retrievedAt"], "2026-06-22")

    def test_confirmation_requires_evidence(self):
        reviews = self.review("confirmed"); reviews["identities"][0]["evidence"] = []
        with self.assertRaises(ValueError):
            policy.normalize_records(self.identity_rows(), {}, reviews)

    def test_rollout_photo_is_shared_by_json_and_static_export(self):
        from tools.detail_photo_data import load_detail_photos
        from tools.photo_asset_urls import photo_asset_url
        photos = load_detail_photos(seo.ROOT)
        self.assertGreater(len(photos), 1)
        import json
        assignments = json.loads((seo.ROOT / "assets/dive-sites/assignments.json").read_text(encoding="utf-8"))
        self.assertEqual(set(photos), {entry["site_id"] for entry in assignments if entry["role"] == "main"})
        for entry in assignments:
            if entry["role"] != "main":
                continue
            photo = photos[entry["site_id"]]
            self.assertEqual(photo["src"], photo_asset_url(seo.ROOT, entry["hero"]))
            self.assertEqual(photo["hide_context_label"], entry.get("hide_context_label", False))
            for link in entry.get("creator_links", []):
                self.assertIn(link, photo["creator_links"])
        row = self.row()
        row[12] = next(iter(photos))
        summaries = {row[12]: {"description": "A published pilot description"}}
        exported = public_records([row], photos, summaries, "", {})[0]
        candidates, _ = seo.validated_candidates([row], photos, summaries, "", {})
        site = candidates[0]
        recommendations = seo.build_recommendation_index(candidates)[row[12]]
        _, markup = seo.generate_site_page(site, {}, recommendations, "/candidates.json")
        self.assertEqual(exported["photo"], photos[row[12]])
        for key in ("src", "source_page", "licence_url"):
            self.assertIn(exported["photo"][key], markup)
        self.assertIn('loading="eager" fetchpriority="high"', markup)
        self.assertNotIn("Representative image", markup)

    def test_static_page_renders_the_same_evidence_and_all_levels(self):
        row = self.row(); row[5] = 26; row[6] = "Beginner | Advanced | Expert"
        records, _ = seo.validated_candidates([row], {}, {row[12]: {"description": "A summary"}}, "", {})
        site = records[0]
        recommendations = seo.build_recommendation_index(records)[row[12]]
        _, markup = seo.generate_site_page(site, {}, recommendations, "/candidates.json")
        self.assertIn("Recorded experience levels", markup)
        self.assertIn("Beginner | Advanced | Expert", markup)
        self.assertIn("unknown", markup)
        self.assertIn("Source evidence and uncertainty", markup)
        self.assertIn("not verified suitability", markup)
        self.assertNotIn("<dt>Difficulty</dt><dd>Beginner</dd>", markup)

    def test_static_page_keeps_same_depth_with_distinct_source_meanings(self):
        row = self.row(); row[3:6] = [None, None, 26]
        reviews = {'observations': {row[12]: [
            {'source': 'SSI', 'name': row[0], 'depths': [{'value': 26, 'meaning': 'maximum'}]}]}}
        with patch.object(policy, 'read_reviews', return_value=reviews):
            records, _ = seo.validated_candidates([row], {}, {}, '', {})
        site = records[0]
        recommendations = seo.build_recommendation_index(records)[row[12]]
        _, markup = seo.generate_site_page(site, {}, recommendations, "/candidates.json")
        self.assertIn("26 m (unknown)", markup)
        self.assertIn("26 m (maximum)", markup)

    def test_compact_reference_ids_are_never_retrieval_dates(self):
        row = self.row()
        summaries = {row[12]: {"sources": [["OSM", "", "node/123456"]]}}
        record = public_records([row], {}, summaries, "", {})[0]
        reference = record['source_provenance'][0]
        self.assertEqual(reference['referenceId'], 'node/123456')
        self.assertFalse(reference.get('retrievedAt'))
        self.assertNotIn('retrieval date: node/', ' '.join(record['evidence_notes']))

    def test_summary_decoder_preserves_defaults_ids_dates_and_dictionary_sources(self):
        import gzip
        import json
        import tempfile
        payload = {'schema': 'dive-site-summary-v2', 'defaults': {'status': 'published'},
                   'profileSnapshotDefaults': {'status': 'published'},
                   'sourceDefaults': {'snapshot': {'retrievedAt': '2026-06-22', 'sourceClass': 'snapshot'}},
                   'bySiteId': {self.row()[12]: {'type': 'profileSnapshot', 'description': 'Published',
                      'sources': [['SSI', 'https://example.com/ssi', '257960', ['depth']],
                                  {'label': 'Operator', 'url': 'https://example.com/operator',
                                   'retrievedAt': '2026-10-01', 'referenceId': 'operator/7'}]}}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'summaries.gz'
            path.write_bytes(gzip.compress(json.dumps(payload).encode('utf-8')))
            with patch.object(seo, 'SUMMARY_DATA', path):
                summaries = seo.load_summaries()
        record = public_records([self.row()], {}, summaries, '', {})[0]
        references = record['source_provenance']
        self.assertEqual(references[0]['referenceId'], '257960')
        self.assertEqual(references[0]['retrievedAt'], '2026-06-22')
        self.assertEqual(references[0]['claims'], ['depth'])
        self.assertIn(['Operator', 'https://example.com/operator'], record['sources'])
        self.assertIn('2026-10-01', ' '.join(record['evidence_notes']))

    def test_confirmed_identity_keeps_every_members_category_provenance(self):
        rows = list(self.identity_rows())
        rows[0][17].update(evidenceSource='Source A', evidenceUrlOrId='https://example.com/a', retrievedAt='2026-01-01')
        rows[1][17].update(evidenceSource='Source B', evidenceUrlOrId='node/123; https://example.com/b')
        with patch.object(policy, 'read_reviews', return_value=self.review('confirmed')):
            records = public_records(rows, {}, {}, '', {})
        for record in records:
            self.assertIn(['Source A', 'https://example.com/a'], record['sources'])
            self.assertIn(['Source B', 'https://example.com/b'], record['sources'])
            self.assertIn('node/123', ' '.join(record['evidence_notes']))
            self.assertIn('2026-01-01', ' '.join(record['evidence_notes']))

    def test_review_observations_are_allowlisted_and_keep_raw_labels(self):
        row = self.row(); row[6] = 'Beginner to Advanced'
        reviews = {'observations': {row[12]: [{'source': 'Operator', 'name': 'Original name',
            'difficulty': ['Expert'], 'sourceFile': 'private.csv', 'reviewNotes': 'PRIVATE',
            'depths': [{'value': 26, 'meaning': 'maximum', 'reviewNotes': 'PRIVATE'}]}]}}
        result = policy.normalize_records([row], {}, reviews)[row[12]]
        self.assertNotIn('PRIVATE', str(result))
        self.assertNotIn('private.csv', str(result))
        self.assertEqual(result['observations'][0]['difficulty_raw'], row[6])
        self.assertIn('Beginner to Advanced', ' '.join(result['evidence_notes']))

    def test_missing_or_ambiguous_identity_review_targets_fail_closed(self):
        first, second = self.identity_rows()
        with patch.object(policy, 'read_reviews', return_value=self.review('confirmed')):
            with self.assertRaises(ValueError):
                policy.normalize_records([first], {})
        with self.assertRaises(ValueError):
            policy.normalize_records([first, first, second], {}, self.review('confirmed'))
        with self.assertRaises(ValueError):
            policy.normalize_records([first], {}, {'observations': {second[12]: []}})

    def test_pairwise_contradictions_are_rejected_in_any_order(self):
        rows = list(self.identity_rows())
        third = self.row('3a532e42-9890-4ea9-b239-0f5fbb836317'); rows.append(third)
        confirmed = self.review('confirmed')['identities'][0]
        confirmed['site_ids'].append(third[12])
        for status in ['candidate', 'distinct']:
            conflicting = self.review(status)['identities'][0]
            for decisions in [[confirmed, conflicting], [conflicting, confirmed]]:
                with self.assertRaises(ValueError):
                    policy.normalize_records(rows, {}, {'identities': decisions})
        malformed = self.review('confirmed'); malformed['identities'][0]['evidence'] = 'not a list'
        with self.assertRaises(ValueError):
            policy.normalize_records(rows, {}, malformed)

    def test_contradictions_across_confirmed_aliases_are_rejected(self):
        rows = list(self.identity_rows())
        third = self.row('3a532e42-9890-4ea9-b239-0f5fbb836317'); rows.append(third)
        confirmed = self.review('confirmed')['identities'][0]
        decisions = [confirmed,
            {'status': 'distinct', 'site_ids': [rows[0][12], third[12]], 'reason': 'Distinct routes'},
            {'status': 'candidate', 'site_ids': [rows[1][12], third[12]], 'reason': 'Potential match'}]
        with self.assertRaises(ValueError):
            policy.normalize_records(rows, {}, {'identities': decisions})

    def test_typical_and_maximum_depths_are_not_an_invented_disagreement(self):
        row = self.row(); row[3:6] = [None, None, None]
        reviews = {'observations': {row[12]: [
            {'source': 'A', 'name': row[0], 'depths': [{'value': 18, 'meaning': 'typical'}]},
            {'source': 'B', 'name': row[0], 'depths': [{'value': 37, 'meaning': 'maximum'}]}]}}
        notes = policy.normalize_records([row], {}, reviews)[row[12]]['evidence_notes']
        self.assertFalse(any('disagree' in note for note in notes))
        reviews['observations'][row[12]].append({'source': 'C', 'name': row[0], 'depths': [{'value': 26, 'meaning': 'maximum'}]})
        notes = policy.normalize_records([row], {}, reviews)[row[12]]['evidence_notes']
        self.assertTrue(any('disagree' in note for note in notes))

    def test_distinct_review_is_retained_publicly(self):
        rows = self.identity_rows()
        normalized = policy.normalize_records(rows, {}, self.review('distinct'))
        self.assertIn('Reviewed identity: distinct', ' '.join(normalized[rows[0][12]]['evidence_notes']))

    def test_sparse_canonical_target_keeps_old_static_alias_link_usable(self):
        rows = list(self.identity_rows())
        rows[0][3:8] = [None, None, None, None, None]; rows[0][14:17] = [None, None, []]
        with patch.object(policy, 'read_reviews', return_value=self.review('confirmed')):
            candidates, _ = seo.validated_candidates(rows, {}, {}, '', {})
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]['slug'], 'example-reef-east')
        self.assertEqual(candidates[0]['canonical_url'], f"{seo.BASE_URL}/dive-site.html?id={rows[0][12]}")

    def test_full_static_build_keeps_confirmed_alias_pages_with_duplicate_metadata(self):
        import argparse
        import tempfile
        rows = list(self.identity_rows()); rows[1][1:3] = rows[0][1:3]
        summaries = {row[12]: {'description': 'Published'} for row in rows}
        rows[0][11] = ''  # Rank the alias first so a publication cap excludes its target.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(policy, 'read_reviews', return_value=self.review('confirmed')), \
                 patch.object(seo, 'load_rows', return_value=rows), \
                 patch.object(seo, 'load_summaries', return_value=summaries), \
                 patch.object(seo, 'load_photos', return_value={}), \
                 patch.object(seo, 'load_fallback_photos', return_value=('', {})), \
                 patch.object(seo, 'load_destination_photos', return_value={}), \
                 patch.object(seo, 'SITE_OUTPUT', root/'dive-sites'), \
                 patch.object(seo, 'REGION_OUTPUT', root/'regions'), \
                 patch.object(seo, 'SITEMAP', root/'sitemap.xml'):
                seo.build(argparse.Namespace(site_limit=None, region_limit=None))
            for slug in ['example-reef', 'example-reef-east']:
                page = (root/'dive-sites'/slug/'index.html').read_text(encoding='utf-8')
                self.assertIn('rel="canonical" href="https://diveatlas.site/dive-sites/example-reef/"', page)
                self.assertIn('Public reference', page)
            with patch.object(policy, 'read_reviews', return_value=self.review('confirmed')), \
                 patch.object(seo, 'load_rows', return_value=rows), \
                 patch.object(seo, 'load_summaries', return_value=summaries), \
                 patch.object(seo, 'load_photos', return_value={}), \
                 patch.object(seo, 'load_fallback_photos', return_value=('', {})), \
                 patch.object(seo, 'load_destination_photos', return_value={}), \
                 patch.object(seo, 'SITE_OUTPUT', root/'dive-sites'), \
                 patch.object(seo, 'REGION_OUTPUT', root/'regions'), \
                 patch.object(seo, 'SITEMAP', root/'sitemap.xml'):
                seo.build(argparse.Namespace(site_limit=1, region_limit=None))
            alias = (root/'dive-sites/example-reef-east/index.html').read_text(encoding='utf-8')
            self.assertIn(f'rel="canonical" href="{seo.BASE_URL}/dive-site.html?id={rows[0][12]}"', alias)
            self.assertFalse((root/'dive-sites/example-reef/index.html').exists())

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


class DetailPhotoRefreshTest(unittest.TestCase):
    def test_photo_render_does_not_load_country_boundaries(self):
        site = {"site_id": "example", "name": "Example", "lat": 1, "lon": 2,
                "photo": {"src": "/hero.jpg", "alt": "Example photo", "credit": "Owner", "source": "personal"}}
        with patch.object(seo, 'country_geographies', side_effect=AssertionError('Photo refresh must not load geography')):
            fragment = seo.render_site_photo(site)
        self.assertIn('src="/hero.jpg"', fragment)
        self.assertIn('<figcaption>Owner</figcaption>', fragment)


    def test_refresh_preserves_unrelated_content_and_is_repeatable(self):
        import json
        import tempfile
        from tools import refresh_detail_photos as refresh_module
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            assignments = root / "assets/dive-sites/assignments.json"
            assignments.parent.mkdir(parents=True)
            assignments.write_text(json.dumps([{"site_id": "example", "slug": "example"}]))
            page = root / "dive-sites/example/index.html"
            page.parent.mkdir(parents=True)
            page.write_text('<main data-site-id="example"><div class="site-photo-feature"><figure>old</figure><aside>map</aside></div><p>facts</p></main>')
            record_path = root / refresh_module.details.DATA_PATH / "example.json"
            record_path.parent.mkdir(parents=True)
            record_path.write_text(json.dumps({"site_id": "example", "photo": {}, "related": ["keep"], "identity_urls": ["keep"]}))
            photo = {"source": "reviewed-assignment", "src": "/hero.jpg"}
            with patch.object(seo, 'load_photos', return_value={"example": photo}), \
                 patch.object(seo, 'load_rows', return_value=[]), \
                 patch.object(seo, 'load_summaries', return_value={}), \
                 patch.object(seo, 'load_fallback_photos', return_value=("", {})), \
                 patch.object(seo, 'validated_candidates', return_value=([{"site_id": "example"}], {})), \
                 patch.object(seo, 'render_site_photo', return_value='<div class="site-photo-feature"><figure>new</figure>'):
                result = refresh_module.refresh(root)
                self.assertEqual(result["static_updated"], 1)
                self.assertEqual(result["shared_updated"], 1)
                self.assertIn('<aside>map</aside></div><p>facts</p>', page.read_text())
                record = json.loads(record_path.read_text())
                self.assertEqual(record["photo"], photo)
                self.assertEqual(record["related"], ["keep"])
                self.assertEqual(record["identity_urls"], ["keep"])
                self.assertEqual(refresh_module.refresh(root), {"sites": 1, "static_updated": 0, "shared_updated": 0})
                # External releases do not have local detail JSON. Refreshing
                # their static photo must not read or recreate that record.
                record_path.unlink()
                self.assertEqual(refresh_module.refresh(root, include_shared_records=False),
                                 {"sites": 1, "static_updated": 0, "shared_updated": 0})
                self.assertFalse(record_path.exists())
                record_path.write_text(json.dumps(record))
                # An incomplete batch must fail before writing an earlier page.
                before = page.read_bytes()
                assignments.write_text(json.dumps([{"site_id": "example", "slug": "example"}, {"site_id": "example", "slug": "missing"}]))
                with self.assertRaises(FileNotFoundError):
                    refresh_module.refresh(root)
                self.assertEqual(page.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
