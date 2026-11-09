"""Generated HTML changes must not mask real policy changes."""
import datetime,hashlib,json,pathlib,tempfile,unittest
from policy_content import fingerprint,verify
URL='https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use'
PROSE='Permission must follow robots and provider terms. '+('Policy text remains binding. '*6)
def body(server='a',prose=PROSE,href='/wiki/Policy:Other',revision=123):
    return ('<html><script>var server="'+server+'"; var config={"wgRevisionId":'+str(revision)+'};</script><div class="mw-parser-output"><p>'+prose+'</p><a href="'+href+'">Reference</a><!-- cache '+server+' --></div></html>').encode()
class PolicyContentTests(unittest.TestCase):
    def test_server_runtime_and_cache_comments_ignored(self):self.assertEqual(fingerprint(body('a'),URL),fingerprint(body('b'),URL))
    def test_policy_text_change_detected(self):self.assertNotEqual(fingerprint(body(),URL),fingerprint(body(prose=PROSE+'Commercial automation forbidden.'),URL))
    def test_link_destination_change_detected(self):self.assertNotEqual(fingerprint(body(),URL),fingerprint(body(href='/wiki/Different_policy'),URL))
    def test_revision_change_detected(self):self.assertNotEqual(fingerprint(body(),URL),fingerprint(body(revision=124),URL))
    def test_missing_article_fails_closed(self):
        with self.assertRaises(ValueError):fingerprint(b'<html>unavailable</html>',URL)
    def test_ambiguous_article_fails_closed(self):
        with self.assertRaises(ValueError):fingerprint(body()+b'<div class="mw-parser-output">extra</div>',URL)
    def fixture(self,root):
        (root/'cache').mkdir();old=body();new=body('b');oldhash=hashlib.sha256(old).hexdigest();newhash=hashlib.sha256(new).hexdigest();(root/'cache'/newhash).write_bytes(new)
        baseline={'user_agent':'fixture','documents':[{'url':URL,'sha256':oldhash,'content_fingerprint':fingerprint(old,URL)}]};path=root/'baseline.json';path.write_text(json.dumps(baseline));plan={'policy_baseline':{URL:oldhash}};probe={'user_agent':'fixture','checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'documents':[{'url':URL,'status':'retrieved','sha256':newhash}]};return path,plan,probe,newhash
    def test_changed_html_same_content_accepted_with_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            r=pathlib.Path(d);path,plan,probe,digest=self.fixture(r);self.assertEqual(verify(plan,probe,r,path,[URL])['network_requests'],0)
    def test_missing_cached_body_not_approved(self):
        with tempfile.TemporaryDirectory() as d:
            r=pathlib.Path(d);path,plan,probe,digest=self.fixture(r);(r/'cache'/digest).unlink()
            with self.assertRaises(ValueError):verify(plan,probe,r,path,[URL])
    def test_body_integrity_failure_not_approved(self):
        with tempfile.TemporaryDirectory() as d:
            r=pathlib.Path(d);path,plan,probe,digest=self.fixture(r);(r/'cache'/digest).write_bytes(body(prose=PROSE+'changed'))
            with self.assertRaises(ValueError):verify(plan,probe,r,path,[URL])
    def test_frozen_baseline_mismatch_not_approved(self):
        with tempfile.TemporaryDirectory() as d:
            r=pathlib.Path(d);path,plan,probe,digest=self.fixture(r);plan['policy_baseline'][URL]='different-reviewed-baseline'
            with self.assertRaises(ValueError):verify(plan,probe,r,path,[URL])
if __name__=='__main__':unittest.main()
