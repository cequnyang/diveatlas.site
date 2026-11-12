import unittest
from unittest.mock import patch

from tools import generate_seo_pages as seo


class DestinationOverviewTests(unittest.TestCase):
    def setUp(self):
        geography = patch.object(seo, 'country_geographies', return_value={
            'indonesia': ('Asia', 'South-Eastern Asia'),
        })
        geography.start()
        self.addCleanup(geography.stop)
        self.sites = [dict(name=name, slug=slug, lat=-0.5, lon=130.5,
                           region='Raja Ampat', country='Indonesia', categories={'features':'Reef'})
                      for name, slug in [('Cape Kri', 'tapor-tamiyam-cape-kri-raja-ampat'),
                                         ('Blue Magic', 'blue-magic'), ('Arborek Jetty', 'arborek-jetty')]]
        self.group = dict(country='Indonesia', region='Raja Ampat', sites=self.sites)

    def test_only_raja_ampat_landing_gets_editorial_overview(self):
        with patch.object(seo, 'destination_photo_figure', return_value='<figure>Existing photo</figure>'):
            _, landing = seo.generate_region_page(self.group, [self.group], {})
            other = {**self.group, 'region': 'Komodo National Park'}
            _, ordinary = seo.generate_region_page(other, [other], {})
        self.assertIn('data-scroll-wheel', landing)
        self.assertIn('Existing photo', landing)
        self.assertIn('id="siteTitleShareButton"', landing)
        self.assertIn('aria-label="Share this destination"', landing)
        self.assertNotIn('destination-site-list', landing)
        self.assertNotIn('related-destination-list', landing)
        self.assertEqual(landing.count('class="site-recommendations__card"'), 3)
        self.assertIn('cinematic-pilot__recommendations--immersion', landing)
        self.assertIn('seo-list-card-ratings.js', landing)
        self.assertNotIn('data-scroll-wheel', ordinary)
        self.assertIn('data-condition-profile="unavailable"', ordinary)
        self.assertIn('A starting selection', ordinary)
        self.assertIn('href="/regions/?area=%5B%22asia%22%2C%22south-eastern%20asia%22%2C%22indonesia%22%2C%22komodo%20national%20park%22%5D" data-destination-text="exploreMore"', ordinary)
        self.assertIn('data-destination-text="exploreMore"', landing)
        self.assertIn('No sourced destination-level data', ordinary)
        self.assertNotIn('~29°C', ordinary)
        self.assertNotIn('rajaampatbiodiversity.com', ordinary)
        self.assertNotIn('destination-month-control', ordinary)
        self.assertEqual(ordinary.count('class="site-recommendations__card"'), 3)

    def test_starting_selection_covers_features_and_ignores_input_order(self):
        from tools.destination_overview import starting_sites
        sites = [dict(name=name, slug=name, features=features) for name, features in
                 [('A', ['reef']), ('B', ['reef']), ('C', ['wall']), ('D', ['wreck'])]]
        selected = starting_sites(sites, lambda site: site['features'])
        self.assertEqual([site['name'] for site in selected], ['A', 'C', 'D'])
        self.assertEqual(selected, starting_sites(list(reversed(sites)), lambda site: site['features']))

    def test_map_keys_distinguish_same_named_destinations(self):
        from tools.destination_overview import destination_map_key
        self.assertNotEqual(destination_map_key('/regions/a/island/'), destination_map_key('/regions/b/island/'))
        self.assertEqual(destination_map_key('/regions/indonesia/raja-ampat/'), 'raja-ampat')

    def test_published_map_does_not_require_local_image(self):
        from pathlib import Path
        exists = Path.exists
        def without_cache(path):
            return False if 'destination-maps' in path.parts else exists(path)
        with patch.object(Path, 'exists', without_cache), patch.object(Path, 'is_file', return_value=False):
            with patch.object(seo, 'destination_photo_figure', return_value=''):
                group = {**self.group, 'path': '/regions/indonesia/raja-ampat/'}
                _, landing = seo.generate_region_page(group, [group], {})
        self.assertIn('src="https://assets.diveatlas.site/assets/destination-maps/', landing)
        self.assertIn('https://www.openstreetmap.org/copyright', landing)

    def test_directory_continuation_stays_crawlable_without_overview(self):
        group = {**self.group, 'sites': self.sites * 11}
        with patch.object(seo, 'destination_photo_figure', return_value=''):
            _, landing = seo.generate_region_page(group, [group], {})
            _, continuation = seo.generate_region_page(group, [group], {}, site_page=2)
        self.assertNotIn('href="#sites-heading"', landing)
        self.assertNotIn('data-scroll-wheel', continuation)
        self.assertIn('Page 2 of 2', continuation)
        self.assertIn('https://diveatlas.site/regions/indonesia/raja-ampat/sites/page/2/', continuation)


if __name__ == '__main__':
    unittest.main()
