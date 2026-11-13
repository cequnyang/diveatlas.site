"""Offline regressions for shared-hero migration and future photo imports."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import patch
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'maintenance'))
SID = '11111111-2222-3333-4444-555555555555'


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'maintenance' / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf-8')


class SharedHeroTests(unittest.TestCase):
    def test_publication_keeps_rights_evidence_and_filters_nested_private_locators(self):
        publication = module('photo_assignment_publication')
        entry = {'source_review_manifest': 'data/private/review.json',
                 'original_archive': r'data\private\original.jpg',
                 'source_page': 'https://example.org/data/photo',
                 'previous_review_assessment': {'source_provenance': r'data\private\run', 'identity': 'uncertain'},
                 'rights_status': 'Human review pending'}
        result = publication.public_assignment(entry)
        self.assertNotIn('source_review_manifest', result)
        self.assertNotIn('original_archive', result)
        self.assertEqual(result['previous_review_assessment'], {'identity': 'uncertain'})
        self.assertEqual(result['source_page'], entry['source_page'])
        self.assertEqual(result['rights_status'], entry['rights_status'])
        self.assertIn('source_provenance', entry['previous_review_assessment'])
        with self.assertRaises(ValueError):
            publication.public_assignment({'unexpected_field': 'data/private/file'})
    def test_existing_shared_hero_is_reused_when_removing_its_thumbnail(self):
        migration = module('use_shared_dive_site_heroes')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); base = root / 'assets/dive-sites'; site = base / SID
            site.mkdir(parents=True)
            (site / 'hero.jpg').write_bytes(b'unchanged hero')
            (site / 'thumbnail.jpg').write_bytes(b'obsolete thumbnail')
            hero = f'/assets/dive-sites/{SID}/hero.jpg'
            entry = {'site_id': SID, 'hero': hero, 'creator': 'Fixture'}
            dump(base / 'assignments.json', [entry])
            catalog = root / 'js/dive-site-reviewed-photo-catalog.js'; catalog.parent.mkdir()
            catalog.write_text(json.dumps({'src': f'/assets/dive-sites/{SID}/thumbnail.jpg', 'fullSrc': hero}))
            with patch.object(migration, 'ROOT', root), patch.object(migration, 'BASE', base), patch.object(migration, 'refresh_photo_outputs') as refresh_outputs:
                migration.migrate()
                refresh_outputs.assert_called_once()
            self.assertEqual(json.loads((base / 'assignments.json').read_text(encoding='utf-8')), [entry])
            self.assertEqual((site / 'hero.jpg').read_bytes(), b'unchanged hero')
            self.assertEqual(list(site.iterdir()), [site / 'hero.jpg'])
            self.assertEqual(json.loads(catalog.read_text(encoding='utf-8')), {'src': hero, 'fullSrc': hero})

    def test_migration_preserves_hero_and_credits_removes_derivatives_and_rejects_replay(self):
        migration = module('use_shared_dive_site_heroes')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); base = root / 'assets/dive-sites'; site = base / SID
            site.mkdir(parents=True)
            for name in ['desktop', 'mobile', 'thumbnail']:
                (site / (name + '.jpg')).write_bytes(name.encode())
            entry = {'site_id': SID, 'desktop': f'/assets/dive-sites/{SID}/desktop.jpg',
                     'mobile': f'/assets/dive-sites/{SID}/mobile.jpg', 'creator': 'Fixture',
                     'original_archive': 'data/private/original.jpg',
                     'source_review_manifest': 'data/private/review.json',
                     'licence_url': 'https://creativecommons.org/licenses/by/4.0/',
                     'crop_boxes': {'desktop': [0, 0, 1600, 900], 'mobile': [0, 0, 900, 675]}}
            dump(base / 'assignments.json', [entry])
            catalog = root / 'js/dive-site-reviewed-photo-catalog.js'
            catalog.parent.mkdir(); catalog.write_text(json.dumps({'fullSrc': entry['desktop']}))
            with patch.object(migration, 'ROOT', root), patch.object(migration, 'BASE', base), patch.object(migration, 'refresh_photo_outputs') as refresh_outputs:
                migration.migrate()
                refresh_outputs.assert_called_once()
                with self.assertRaises(ValueError): migration.migrate()
            result = json.loads((base / 'assignments.json').read_text(encoding='utf-8'))[0]
            self.assertEqual((site / 'hero.jpg').read_bytes(), b'desktop')
            self.assertFalse((site / 'thumbnail.jpg').exists())
            self.assertFalse((site / 'mobile.jpg').exists())
            self.assertEqual(result['hero_crop_box'], entry['crop_boxes']['desktop'])
            self.assertEqual(result['creator'], entry['creator'])
            self.assertEqual(result['licence_url'], entry['licence_url'])
            self.assertNotIn('original_archive', result)
            self.assertNotIn('source_review_manifest', result)
            self.assertEqual(json.loads(catalog.read_text(encoding='utf-8'))['fullSrc'], result['hero'])

    def test_import_and_catalog_builder_use_only_one_full_composition_image(self):
        importer = module('apply_additional_reviewed_photos')
        builder = module('build_reviewed_site_photo_catalog')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); base = root / 'assets/dive-sites'; run = root / 'data/run'; work = root / 'data/decisions'
            run.mkdir(parents=True); (work / 'crops').mkdir(parents=True); (root / 'js').mkdir()
            original = run / 'original.jpg'; Image.new('RGB', (2000, 1500), 'blue').save(original)
            digest = hashlib.sha256(original.read_bytes()).hexdigest()
            site = {'site_id': SID, 'name': 'Fixture Reef', 'country': 'Test', 'slug': 'fixture'}
            candidate = {'review_id': 'fixture', 'file_id': 'file', 'assessment': {'site_id': SID,
                         'visual_type': 'underwater', 'evidence': 'Fixture caption', 'licence_review': 'Fixture licence'},
                         'dimensions': [2000, 1500], 'original_sha256': digest, 'creator': 'Fixture Creator',
                         'licence': 'https://creativecommons.org/licenses/by/4.0/', 'source_page': 'https://example.org/photo', 'description': 'Fixture reef'}
            dump(run / 'review/manifest.json', {'sites': [site], 'candidates': [candidate]})
            dump(run / 'manifest.json', {'files': {'file': {'asset': 'original.jpg'}}})
            decision = work / 'decisions.json'
            dump(decision, {'source_manifest': 'data/run/review/manifest.json', 'decisions': [{'role': 'hero', 'site_id': SID, 'review_id': 'fixture'}]})
            dump(base / 'assignments.json', [])
            page = root / 'dive-sites/fixture/index.html'; page.parent.mkdir(parents=True)
            page.write_text(f'<main data-site-id="{SID}">')
            dataset = root / 'datasets/dive-site-photos.js'; dataset.parent.mkdir(); dataset.write_text('{}')
            with patch.object(importer, 'ROOT', root), patch('build_reviewed_site_photo_catalog.build') as rebuild, patch('sys.argv', ['importer', '--decisions', str(decision), '--apply']):
                importer.main()
                rebuild.assert_called_once()
            hero_digest = hashlib.sha256((base / SID / 'hero.jpg').read_bytes()).hexdigest()
            with patch.object(builder, 'ROOT', root), patch.object(builder, 'ASSETS', base), patch.object(builder, 'refresh', return_value={}) as refresh, patch.object(builder, 'build_directory'):
                builder.build()
                builder.build()
                self.assertEqual(refresh.call_count, 2)
            self.assertEqual(hashlib.sha256((base / SID / 'hero.jpg').read_bytes()).hexdigest(), hero_digest)
            entry = json.loads((base / 'assignments.json').read_text(encoding='utf-8'))[0]
            self.assertEqual(entry['hero'], f'/assets/dive-sites/{SID}/hero.jpg')
            catalog=(root/'js/dive-site-reviewed-photo-catalog.js').read_text(encoding='utf-8')
            self.assertNotIn('thumbnail.jpg',catalog)
            self.assertIn(entry['hero'],catalog)
            self.assertNotIn('mobile', entry); self.assertNotIn('desktop', entry)
            self.assertNotIn('source_review_manifest', entry)
            self.assertNotIn('original_archive', entry)
            private_entry = json.loads((work/'assignments.json').read_text(encoding='utf-8'))[0]
            self.assertEqual(private_entry['source_review_manifest'], 'data/run/review/manifest.json')
            with Image.open(base / SID / 'hero.jpg') as image: self.assertEqual(image.size, (1600, 1200))
            self.assertEqual(sorted(p.name for p in (base / SID).iterdir()), ['hero.jpg'])


if __name__ == '__main__':
    unittest.main()
