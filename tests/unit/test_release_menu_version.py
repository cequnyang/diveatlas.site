import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tools.prepare_pages import render_app_version


class ReleaseMenuVersionTests(unittest.TestCase):
    def test_release_version_updates_static_and_javascript_menus(self):
        menu = '<div class="top-menu-version" data-version="0.0.1" aria-label="DiveAtlas version 0.0.1">v0.0.1</div>'
        with TemporaryDirectory() as directory:
            for name, content in [('dive-site.html', menu), ('seo-browse-header.js', f'const menu = `{menu}`;')]:
                with self.subTest(name=name):
                    path = Path(directory) / name
                    path.write_text(content, encoding="utf-8")
                    render_app_version(path, '1.2.3', required=False)
                    rendered = path.read_text(encoding="utf-8")
                    self.assertNotIn('0.0.1', rendered)
                    self.assertIn('data-version="1.2.3"', rendered)
                    self.assertIn('DiveAtlas version 1.2.3', rendered)
                    self.assertIn('>v1.2.3</div>', rendered)

    def test_optional_version_render_leaves_pages_without_menu_unchanged(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'other.html'
            path.write_text('<p>No menu</p>', encoding="utf-8")
            render_app_version(path, '1.2.3', required=False)
            self.assertEqual(path.read_text(encoding="utf-8"), '<p>No menu</p>')
            with self.assertRaises(SystemExit):
                render_app_version(path, '1.2.3')


if __name__ == "__main__":
    unittest.main()
