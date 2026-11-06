import unittest

from tools.site_header_assets import install_shared_header_assets
from tools.generate_seo_pages import page_shell


class SharedHeaderAssetsTests(unittest.TestCase):
    def test_build_covers_every_html_shape_and_is_idempotent(self):
        for document in ['<html><head></head><body>Page</body></html>',
                         '<html lang="en"><title>Legacy</title><h1>Page</h1></html>',
                         '<h1>Minimal page</h1>']:
            with self.subTest(document=document):
                result = install_shared_header_assets(document, '1.2.3')
                self.assertEqual(install_shared_header_assets(result, '1.2.3'), result)
                self.assertEqual(result.count('/js/site-header.js?v=1'), 1)
                self.assertEqual(result.count('/assets/site-header.css?v=1'), 1)
                upgraded = install_shared_header_assets(result, '2.0.0')
                self.assertIn('data-app-version="2.0.0"', upgraded)
                self.assertNotIn('data-app-version="1.2.3"', upgraded)

    def test_generator_includes_header_for_plain_pages_too(self):
        for kind in ['', 'seo-site-detail-layout', 'region-browser-page',
                     'site-directory-page', 'destination-directory-page']:
            with self.subTest(kind=kind):
                result = page_shell('Test', 'Description', 'https://diveatlas.site/test/', '<main>Body</main>', kind)
                self.assertIn('/js/site-header.js?v=1', result)
                self.assertIn('/assets/site-header.css?v=1', result)
                if kind != 'seo-site-detail-layout':
                    self.assertIn('/js/seo-page-controls.js?v=26', result)

    def test_cached_generated_pages_upgrade_controller_contract(self):
        old = ('<html><head></head><body>'
               '<script src="/js/seo-browse-header.js?v=2" defer></script>'
               '<script src="/js/seo-page-controls.js?v=24" defer></script>'
               '<script src="/js/seo-site-search.js?v=11" defer></script></body></html>')
        result = install_shared_header_assets(old, '1.2.3')
        self.assertNotIn('seo-browse-header.js', result)
        self.assertIn('seo-page-controls.js?v=26', result)
        self.assertIn('seo-site-search.js?v=13', result)
        self.assertEqual(result.count('/js/site-header.js?v=1'), 1)


if __name__ == '__main__':
    unittest.main()
