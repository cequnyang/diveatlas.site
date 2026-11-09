"""Offline regressions: no test may open a network socket."""
import copy, datetime, io, json, pathlib, socket, tempfile, unittest
from unittest.mock import patch
import client,store,policy_probe
from client import Client,Blocked,Deferred
from matching import parse_file,compatible_license,phrase,distance_km
CAT='https://commons.wikimedia.org/wiki/Category:Fixture'
FILE='https://commons.wikimedia.org/wiki/File:Fixture.jpg'
ROBOTS='https://commons.wikimedia.org/robots.txt'
class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.h=pathlib.Path(self.temp.name)
        for d in ['cache','private-audit']:(self.h/d).mkdir()
        self.patches=[patch.object(client,'H',self.h),patch.object(store,'H',self.h),patch.object(policy_probe,'H',self.h),patch.object(socket,'create_connection',side_effect=AssertionError('Live network forbidden in tests'))]
        for p in self.patches:p.start()
        self.db=store.connect();self.calls=[]
        self.plan={'category_routes':[{'url':CAT}],'budget':{'maximum_active_seconds':3600,'maximum_operational_http_requests_including_robots_retries_assets':20,'maximum_original_bytes':1000,'maximum_original_total_bytes':10000,'maximum_metadata_body_bytes':2000,'minimum_spacing_seconds':0,'request_timeout_seconds':20}}
    def tearDown(self):
        self.db.close()
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
    def make(self,responses=None):
        def send(url,headers):
            self.calls.append(url)
            if responses and url in responses:return responses[url]
            return (200,{},b'User-agent: *\nAllow: /\n') if url.endswith('/robots.txt') else (200,{},b'fixture')
        c=Client(self.db,copy.deepcopy(self.plan),send=send,sleep=lambda n:None);c.allowed_files.add(FILE);return c
    def test_declared_direct_file_allowed(self):
        self.assertEqual(self.make().get(FILE)[0],b'fixture');self.assertEqual(self.calls,[ROBOTS,FILE])
    def test_denied_endpoints_never_dispatched(self):
        c=self.make()
        for u in ['https://commons.wikimedia.org/w/api.php?action=query','https://commons.wikimedia.org/wiki/Special:Search','https://api.openverse.org/v1/images/','https://api.flickr.com/services/rest/','https://other.example/wiki/File:Fixture.jpg']:
            with self.assertRaises(Blocked):c.get(u)
        self.assertEqual(self.calls,[])
    def test_robots_disallow_preflight(self):
        c=self.make({ROBOTS:(200,{},b'User-agent: *\nDisallow: /wiki/File:')})
        with self.assertRaises(Blocked):c.get(FILE)
        self.assertEqual(self.calls,[ROBOTS])
    def test_unavailable_robots_persists_halt(self):
        c=self.make({ROBOTS:(503,{},b'no')})
        with self.assertRaises(Blocked):c.get(FILE)
        with self.assertRaises(Blocked):self.make().get(FILE)
        self.assertEqual(self.calls,[ROBOTS])
    def test_redirect_not_followed_and_halts_provider(self):
        c=self.make({FILE:(302,{'location':'https://other.example/private'},b'')})
        with self.assertRaises(Blocked):c.get(FILE)
        with self.assertRaises(Blocked):c.get(CAT)
        self.assertEqual(self.calls,[ROBOTS,FILE])
    def test_rate_denial_no_retry(self):
        c=self.make({FILE:(429,{'retry-after':'60'},b'')})
        with self.assertRaises(Blocked):c.get(FILE)
        self.assertEqual(self.calls,[ROBOTS,FILE])
    def test_persistent_request_budget(self):
        store.set_control(self.db,'operational_request_count',20)
        with self.assertRaises(Deferred):self.make().get(FILE)
        self.assertEqual(self.calls,[])
    def test_no_store_asset_not_retained(self):
        asset='https://upload.wikimedia.org/wikipedia/commons/a/ab/Fixture.jpg';c=self.make({asset:(200,{'cache-control':'no-store'},b'bytes')});c.allowed_originals[asset]={}
        with self.assertRaises(Blocked):c.get(asset,asset=True)
        self.assertEqual(list((self.h/'cache').iterdir()),[])
    def test_duplicate_url_no_repeat(self):
        c=self.make();c.get(FILE)
        with self.assertRaises(Blocked):c.get(FILE)
        self.assertEqual(self.calls,[ROBOTS,FILE])
    def test_no_store_bytes_block_next_original_in_same_run(self):
        asset='https://upload.wikimedia.org/first.jpg';other='https://upload.wikimedia.org/second.jpg'
        c=self.make({asset:(200,{'cache-control':'no-store'},b'x'*600)})
        c.budget['maximum_original_total_bytes']=1500;c.allowed_originals.update({asset:{},other:{}})
        with self.assertRaises(Blocked):c.get(asset,asset=True)
        with self.assertRaises(Deferred):c.get(other,asset=True)
        self.assertEqual(c.original_bytes(),600);self.assertNotIn(other,self.calls)
    def test_retry_reserves_full_cap_against_remaining_bytes(self):
        asset='https://upload.wikimedia.org/first.jpg';c=self.make({asset:(503,{},b'x'*600)})
        c.budget['maximum_original_total_bytes']=1500;c.allowed_originals[asset]={}
        with self.assertRaises(Deferred):c.get(asset,asset=True)
        self.assertEqual(self.calls.count(asset),1);self.assertEqual(c.original_bytes(),600)
    def test_retry_can_use_exact_remaining_reservation(self):
        asset='https://upload.wikimedia.org/first.jpg';c=self.make()
        c.budget['maximum_original_total_bytes']=1601;c.allowed_originals[asset]={}
        responses=iter([(503,{},b'x'*600),(200,{},b'y'*900)])
        original_send=c.send
        def send(url,headers):
            if url==asset:
                self.calls.append(url);return next(responses)
            return original_send(url,headers)
        c.send=send
        self.assertEqual(c.get(asset,asset=True)[0],b'y'*900)
        self.assertEqual(self.calls.count(asset),2);self.assertEqual(c.original_bytes(),1500)
    def test_unknown_transfer_reservation_survives_resume(self):
        asset='https://upload.wikimedia.org/first.jpg'
        c=self.make();c.budget['maximum_original_total_bytes']=1500;c.allowed_originals[asset]={}
        c.robots('upload.wikimedia.org')
        c.send=lambda *args: (_ for _ in ()).throw(OSError('interrupted read'))
        with self.assertRaises(Deferred):c.get(asset,asset=True)
        self.assertEqual(c.original_bytes(),1001)
        resumed=self.make();resumed.budget['maximum_original_total_bytes']=1500;resumed.allowed_originals[asset]={}
        before=list(self.calls)
        with self.assertRaises(Deferred):resumed.get(asset,asset=True)
        self.assertEqual(self.calls.count(asset),before.count(asset))
    def test_legacy_unknown_transfer_is_charged_conservatively(self):
        self.db.execute("INSERT INTO requests(url,purpose) VALUES(?, 'original')",('https://upload.wikimedia.org/old.jpg',));self.db.commit()
        c=self.make();self.assertEqual(c.original_bytes(),1001)
    def test_oversized_response_consumes_transfer_budget(self):
        asset='https://upload.wikimedia.org/large.jpg';c=self.make({asset:(200,{},b'x'*1001)})
        c.budget['maximum_original_total_bytes']=1500;c.allowed_originals[asset]={}
        with self.assertRaises(Blocked):c.get(asset,asset=True)
        self.assertEqual(c.original_bytes(),1001)
    def test_encoded_escape_denied(self):
        c=self.make();url='https://commons.wikimedia.org/wiki/File:Fixture/%252e%252e/secret';c.allowed_files.add(url)
        with self.assertRaises(Blocked):c.get(url)
        self.assertEqual(self.calls,[])
    def test_licence_exclusions(self):
        for u in ['https://creativecommons.org/licenses/by-nc/4.0/','https://creativecommons.org/licenses/by-nd/4.0/','All rights reserved','']:self.assertFalse(compatible_license(u))
        self.assertTrue(compatible_license('https://creativecommons.org/licenses/by-sa/1.0/'))
    def test_name_is_screen_not_homonym_proof(self):
        self.assertTrue(phrase('Blue Hole Gozo Malta','Blue Hole'))
        self.assertFalse(phrase('Blue Holes Bahamas','Blue Hole'))
        self.assertGreater(distance_km([36.05,14.19],[17.3,-87.5]),1000)
    def test_originals_not_allowed_by_host_alone(self):
        with self.assertRaises(Blocked):self.make().get('https://upload.wikimedia.org/wikipedia/commons/a/ab/unknown.jpg',asset=True)
        self.assertEqual(self.calls,[])
    def test_retry_cap_is_cumulative(self):
        c=self.make({FILE:(503,{},b'')})
        with self.assertRaises(Deferred):c.get(FILE)
        self.assertEqual(self.calls.count(FILE),2)
        with self.assertRaises(Blocked):self.make().get(FILE)
        self.assertEqual(self.calls.count(FILE),2)
    def workflow_fixture(self,caption='Fixture Reef',licence='by-sa',dimensions=True):
        import sys
        sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
        import discover_site_images as workflow,common
        from PIL import Image
        image=Image.new('RGB',(1200,800),'blue');buffer=io.BytesIO();image.save(buffer,format='JPEG');original=buffer.getvalue()
        asset='https://upload.wikimedia.org/wikipedia/commons/a/ab/Fixture.jpg'
        media=f'<div class="fullMedia"><a href="{asset}">Original file (1,200 × 800 pixels, file size:18 KB)</a></div>' if dimensions else ''
        page=f'<html><title>File:Fixture Reef.jpg</title>{media}<table><tr><td id="fileinfotpl_aut">Author</td><td>Fixture Creator</td></tr><tr><td id="fileinfotpl_desc">Description</td><td>{caption}</td></tr></table><div class="licensetpl"><a href="https://creativecommons.org/licenses/{licence}/4.0/">Licence</a></div></html>'.encode()
        site={'site_id':'fixture','name':'Fixture Reef','aliases':[],'country':'Test','region':'','lat':1,'lon':1,'slug':'fixture','coordinate_flags':[]}
        plan={'schema':'diveatlas-image-discovery-v1','raw_sha256':common.sha(workflow.ROOT/'datasets/dive-sites.js'),'sites':[site],'leads':[{'site_id':'fixture','source_page':FILE,'basis':'exact_site','evidence':'Test fixture'}],'category_routes':[],'budget':{**self.plan['budget'],'maximum_original_bytes':18000000,'maximum_metadata_body_bytes':2000000,'maximum_original_assets':1,'maximum_original_total_bytes':750000000,'maximum_file_pages_per_site':4},'policy_baseline':{u:'fixture' for u in policy_probe.DOCS}}
        for d in ['assets','previews','evidence']:(self.h/d).mkdir(exist_ok=True)
        common.dump(self.h/'plan.json',plan);common.dump(self.h/'freeze.json',{'plan_sha256':common.sha(self.h/'plan.json')});common.dump(self.h/'prior-files.json',{})
        common.dump(self.h/'state.json',{'files':{},'sites':{'fixture':{'candidate_ids':[],'outcome':'queued'}},'categories':{},'original_bytes':0,'original_count':0})
        common.dump(self.h/'evidence/source-policy-probe.json',{'checked_at':common.now(),'user_agent':policy_probe.UA,'http_requests':0,'documents':[{'url':u,'status':'retrieved','sha256':'fixture'} for u in policy_probe.DOCS]})
        def transport(this,url,headers):
            self.calls.append(url)
            if url.endswith('/robots.txt'):return 200,{},b'User-agent: *\\nAllow: /\\n'.replace(b'\\n',b'\n')
            if url==FILE:return 200,{},page
            if url==asset:return 200,{},original
            raise AssertionError('Unexpected endpoint '+url)
        return workflow,common,transport,asset
    def test_complete_collection_and_resume_without_replay(self):
        workflow,common,transport,asset=self.workflow_fixture()
        with patch.object(common,'H',self.h),patch.object(Client,'transport',transport):
            workflow.run(None);first=list(self.calls);workflow.run(None)
        self.assertEqual(first,self.calls);state=common.load(self.h/'state.json');self.assertEqual(state['original_count'],1)
        record=next(iter(state['files'].values()));self.assertEqual(record['identity'],'unresolved');self.assertEqual(record['publication'],'NOT_AUTHORIZED');self.assertTrue((self.h/record['preview']).exists());self.assertEqual(self.calls.count(asset),1)
    def test_dimensions_before_original_dispatch(self):
        workflow,common,transport,asset=self.workflow_fixture(dimensions=False)
        with patch.object(common,'H',self.h),patch.object(Client,'transport',transport):workflow.run(None)
        self.assertNotIn(asset,self.calls)
    def test_shared_category_selects_each_site_and_resumes_without_replay(self):
        workflow,common,transport,asset=self.workflow_fixture(dimensions=False)
        plan=common.load(self.h/'plan.json');second={**plan['sites'][0],'site_id':'second','name':'Other Reef'}
        plan['sites'].append(second);plan['category_routes']=[{'url':CAT}]
        plan['leads']=[{'site_id':s['site_id'],'source_page':CAT,'basis':'exact_site','evidence':'Fixture'} for s in plan['sites']]
        common.dump(self.h/'plan.json',plan);common.dump(self.h/'freeze.json',{'plan_sha256':common.sha(self.h/'plan.json')})
        state=common.load(self.h/'state.json');state['sites']['second']={'candidate_ids':[],'outcome':'queued'};common.dump(self.h/'state.json',state)
        urls=[FILE.replace('Fixture.jpg','Fixture_Reef.jpg'),FILE.replace('Fixture.jpg','Other_Reef.jpg')]
        def send(this,url,headers):
            if url==CAT:
                self.calls.append(url)
                return 200,{},(''.join('<div class="gallerytext"><a href="'+u+'">file</a></div>' for u in urls)).encode()
            if url in urls:
                self.calls.append(url);return 200,{},b'<title>No original</title>'
            return transport(this,url,headers)
        with patch.object(common,'H',self.h),patch.object(Client,'transport',send):
            workflow.run(None);first=list(self.calls);workflow.run(None)
        state=common.load(self.h/'state.json')
        self.assertEqual(state['categories'][CAT]['file_urls'],urls)
        for sid,url in zip(['fixture','second'],urls):
            self.assertEqual(state['sites'][sid]['candidate_ids'],[store.file_key(url)])
        self.assertEqual(self.calls.count(CAT),1);self.assertEqual(first,self.calls)
    def test_legacy_category_checkpoint_does_not_reuse_filtered_selection(self):
        workflow,common,transport,asset=self.workflow_fixture(dimensions=False)
        plan=common.load(self.h/'plan.json');plan['category_routes']=[{'url':CAT}];plan['leads'][0]['source_page']=CAT
        common.dump(self.h/'plan.json',plan);common.dump(self.h/'freeze.json',{'plan_sha256':common.sha(self.h/'plan.json')})
        state=common.load(self.h/'state.json');state['categories'][CAT]={'status':'checked','selected':[FILE]};common.dump(self.h/'state.json',state)
        with patch.object(common,'H',self.h),patch.object(Client,'transport',transport):workflow.run(None)
        state=common.load(self.h/'state.json')
        self.assertEqual(self.calls,[]);self.assertEqual(state['sites']['fixture']['candidate_ids'],[])
        self.assertIn('separate batch required',state['sites']['fixture']['outcome'])
    def test_noncommercial_before_original_dispatch(self):
        workflow,common,transport,asset=self.workflow_fixture(licence='by-nc')
        with patch.object(common,'H',self.h),patch.object(Client,'transport',transport):workflow.run(None)
        self.assertNotIn(asset,self.calls)
    def test_frozen_plan_tampering_no_dispatch(self):
        workflow,common,transport,asset=self.workflow_fixture();plan=common.load(self.h/'plan.json');plan['sites'][0]['name']='Changed';common.dump(self.h/'plan.json',plan)
        with patch.object(common,'H',self.h),patch.object(Client,'transport',transport):
            with self.assertRaises(ValueError):workflow.run(None)
        self.assertEqual(self.calls,[])
    def test_changed_policy_no_content_dispatch(self):
        workflow,common,transport,asset=self.workflow_fixture();probe=common.load(self.h/'evidence/source-policy-probe.json');probe['documents'][0]['sha256']='changed';common.dump(self.h/'evidence/source-policy-probe.json',probe)
        with patch.object(common,'H',self.h),patch.object(Client,'transport',transport):
            with self.assertRaises(ValueError):workflow.run(None)
        self.assertEqual(self.calls,[])
if __name__=='__main__':unittest.main()
