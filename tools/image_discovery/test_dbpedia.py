import pathlib,tempfile,unittest
from dbpedia import EntitySearch,commons_file_page,build_query
from store import connect,control
class DBpediaTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.h=pathlib.Path(self.temp.name);(self.h/'cache').mkdir();self.db=connect(self.h/'queue.sqlite');self.calls=[]
    def tearDown(self):self.db.close();self.temp.cleanup()
    def client(self,robots=b'User-agent: *\nAllow: /',status=200,headers=None):
        def send(url):
            self.calls.append(url)
            return (200,{},robots) if url.endswith('/robots.txt') else (status,headers or {},b'{"results":{"bindings":[]}}')
        return EntitySearch(self.db,self.h,{'maximum_operational_requests_including_robots_assets':120,'maximum_search_requests':20},send=send,sleep=lambda n:None)
    def test_exact_entity_query_permitted(self):self.assertEqual(self.client().search(['Fixture'])[0],[]);self.assertEqual(len(self.calls),2)
    def test_robots_denial_stops_before_search(self):
        with self.assertRaises(ValueError):self.client(robots=b'User-agent: *\nDisallow: /sparql').search(['Fixture'])
        self.assertEqual(len(self.calls),1)
    def test_redirect_halts_no_follow(self):
        c=self.client(status=302)
        with self.assertRaises(ValueError):c.search(['Fixture'])
        with self.assertRaises(ValueError):c.search(['Other'])
        self.assertEqual(len(self.calls),2)
    def test_partial_results_visible(self):self.assertTrue(self.client(headers={'x-sql-state':'S1TAT'}).search(['Fixture'])[1]['partial'])
    def test_unregistered_or_other_provider_denied(self):
        c=self.client()
        for u in ['https://dbpedia.org/sparql?query=arbitrary','https://commons.wikimedia.org/w/api.php','https://query.wikidata.org/sparql']:
            with self.assertRaises(ValueError):c.get(u)
        self.assertEqual(self.calls,[])
    def test_special_url_parsed_not_requested(self):
        self.assertEqual(commons_file_page('http://commons.wikimedia.org/wiki/Special:FilePath/Test.jpg?width=300'),'https://commons.wikimedia.org/wiki/File:Test.jpg')
        self.assertIsNone(commons_file_page('https://other.example/Test.jpg'))
    def test_quoted_label_not_query_code(self):self.assertIn('\\"',build_query(['a"b']))
if __name__=='__main__':unittest.main()
