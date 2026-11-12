import unittest

from tools.site_header_assets import install_shared_header_assets, install_initial_detail_appearance
from tools.generate_seo_pages import page_shell


class SharedHeaderAssetsTests(unittest.TestCase):
    def test_permalink_initial_layout_is_final_before_runtime_and_idempotent(self):
        original = ('<html><head></head><body class="seo-site-detail-layout">'
                    '<main class="detail-page" data-site-id="example"><section class="site-hero">'
                    '<button class="site-photo-preview-trigger"><img src="photo.webp" loading="lazy"></button>'
                    '<aside class="site-photo-gallery-rail"><section>Rating</section><a href="/?site=example">Map</a></aside>'
                    '<div class="hero-copy">Title</div></section><div class="site-intro-detail">Summary</div>'
                    '<img src="thumbnail.webp" loading="lazy"></main></body></html>')
        result = install_initial_detail_appearance(original)
        self.assertEqual(install_initial_detail_appearance(result), result)
        self.assertIn('class="seo-site-detail-layout cinematic-pilot"', result)
        self.assertIn('<main id="detailPage"', result)
        self.assertIn('dive-site-cinematic-pilot.css?v=118', result)
        self.assertIn('src="photo.webp" loading="eager" fetchpriority="high"', result)
        self.assertIn('src="thumbnail.webp" loading="lazy"', result)
        self.assertLess(result.index('Title</div></section>'), result.index('<aside'))
        self.assertLess(result.index('</aside>'), result.index('class="site-intro-detail"'))
        self.assertIn('href="/?site=example"', result)

    def test_build_covers_every_html_shape_and_is_idempotent(self):
        for document in ['<html><head></head><body>Page</body></html>',
                         '<html lang="en"><title>Legacy</title><h1>Page</h1></html>',
                         '<h1>Minimal page</h1>']:
            with self.subTest(document=document):
                result = install_shared_header_assets(document, '1.2.3')
                self.assertEqual(install_shared_header_assets(result, '1.2.3'), result)
                self.assertEqual(result.count('/js/site-header.js?v=6'), 1)
                self.assertEqual(result.count('/assets/site-header.css?v=12'), 1)
                self.assertEqual(result.count('/assets/search-results-menu.css?v=1'), 1)
                upgraded = install_shared_header_assets(result, '2.0.0')
                self.assertIn('data-app-version="2.0.0"', upgraded)
                self.assertNotIn('data-app-version="1.2.3"', upgraded)

    def test_generator_includes_header_for_plain_pages_too(self):
        for kind in ['', 'seo-site-detail-layout', 'region-browser-page',
                     'site-directory-page', 'destination-directory-page']:
            with self.subTest(kind=kind):
                result = page_shell('Test', 'Description', 'https://diveatlas.site/test/', '<main>Body</main>', kind)
                self.assertIn('/js/site-header.js?v=6', result)
                self.assertIn('/assets/site-header.css?v=12', result)
                if kind != 'seo-site-detail-layout':
                    self.assertIn('/js/seo-page-controls.js?v=38', result)

    def test_cached_generated_pages_upgrade_controller_contract(self):
        old = ('<html><head><link rel="stylesheet" href="/assets/seo-site-search.css?v=11">'
               '<link rel="stylesheet" href="/assets/search-results-menu.css?v=0"></head><body>'
               '<script src="/js/seo-browse-header.js?v=2" defer></script>'
               '<script src="/js/seo-page-controls.js?v=24" defer></script>'
               '<script src="/js/seo-site-search.js?v=11" defer></script></body></html>')
        result = install_shared_header_assets(old, '1.2.3')
        self.assertNotIn('seo-browse-header.js', result)
        self.assertIn('seo-page-controls.js?v=38', result)
        self.assertIn('seo-site-search.js?v=16', result)
        self.assertIn('seo-site-search.css?v=13', result)
        self.assertEqual(result.count('/assets/search-results-menu.css?v=1'), 1)
        self.assertNotIn('search-results-menu.css?v=0', result)
        self.assertEqual(result.count('/js/site-header.js?v=6'), 1)

    def test_cached_detail_pages_upgrade_glass_and_chart_assets(self):
        old = ('<html><head><link rel="stylesheet" href="/assets/seo.css?v=200"></head>'
               '<body><script src="/js/dive-conditions-chart.js?v=53"></script></body></html>')
        result = install_shared_header_assets(old, '1.2.3')
        self.assertIn('/assets/seo.css?v=207', result)
        self.assertIn('/js/dive-conditions-chart.js?v=56', result)
        self.assertEqual(install_shared_header_assets(result, '1.2.3'), result)


if __name__ == '__main__':
    unittest.main()
