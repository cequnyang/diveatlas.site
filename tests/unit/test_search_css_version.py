import re
import unittest
from pathlib import Path

from tools.site_header_assets import install_shared_header_assets


class SearchCssReleaseTests(unittest.TestCase):
    def test_built_map_and_header_bootstrap_use_source_search_css_version(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / "index.html").read_text(encoding="utf-8")
        built = install_shared_header_assets(source, "test")
        runtime = (root / "js/site-header.js").read_text(encoding="utf-8")
        pattern = r"(?<![\w-])/?assets/search-results-menu\.css\?v=(\d+)"
        versions = re.findall(pattern, source)
        self.assertEqual(len(versions), 1)
        self.assertEqual(re.findall(pattern, built), versions)
        self.assertEqual(re.findall(pattern, runtime), versions)
        self.assertGreater(int(versions[0]), 24)
