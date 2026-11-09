"""Batch upload planning must not turn holds or unrelated selections public."""
import json,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from maintenance import upload_dive_site_photos_r2 as uploader

class BatchUploadPlanTests(unittest.TestCase):
 def run_plan(self,missing_review=False,change_review=False,global_hold=False):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);assets=root/'assets/dive-sites';assets.mkdir(parents=True);work=root/'data/fixture';review=root/'review.json'
   paths=[]
   for i in range(3):
    p=assets/str(i)/'hero.jpg';p.parent.mkdir();p.write_bytes(bytes([i+1])*20);paths.append('/'+p.relative_to(root).as_posix())
   entries=[{'hero':p,'licence':'CC BY 4.0','rights_status':'Recorded explicit source licence','creator':'Photographer','source_page':'https://example.com/photo'} for p in paths]
   extras=[{'src':p,'batch':'fixture' if i<2 else 'other','credit':'Photographer · CC BY 4.0','rightsStatus':'Recorded explicit source licence','creditLinks':[{'label':'Source','url':'https://example.com/photo'}]} for i,p in enumerate(paths)]
   (assets/'assignments.json').write_text(json.dumps(entries),'utf8');(assets/'additional-preview-options.json').write_text(json.dumps(extras),'utf8')
   decisions={paths[0]:{'decision':'include'}}
   if not missing_review:decisions[paths[1]]={'decision':'hold','reason':'Inferred creator; attribution unresolved'}
   review.write_text(json.dumps({'assets':decisions}),'utf8')
   if global_hold:
    (root/'datasets').mkdir();(root/'datasets/dive-site-photo-r2.json').write_text(json.dumps({'assets':{},'held':{paths[0]:{'reason':'Unresolved attribution'}}}),'utf8')
   with patch.multiple(uploader,ROOT=root,WORK=work,BATCH='fixture',REVIEW=review),patch.dict(sys.modules,{'generate_seo_pages':SimpleNamespace(load_photos=lambda:{})}):
    uploader.prepare();plan=json.loads((work/'plan.json').read_text('utf8'))
    self.assertEqual([o['local'] for o in plan['objects']],[] if global_hold else [paths[0]])
    self.assertEqual([o['local'] for o in plan['held']],paths[:2] if global_hold else [paths[1]])
    self.assertNotIn(paths[2],str(plan))
    if change_review:
     decisions[paths[1]]={'decision':'include'};review.write_text(json.dumps({'assets':decisions}),'utf8')
     with self.assertRaisesRegex(AssertionError,'Frozen upload plan changed'):uploader.prepare()
 def test_only_batch_members_with_explicit_include_enter_upload_plan(self):self.run_plan()
 def test_missing_review_is_a_hold(self):self.run_plan(missing_review=True)
 def test_frozen_plan_cannot_silently_expand(self):self.run_plan(change_review=True)
 def test_global_hold_cannot_be_overridden_by_batch_include(self):self.run_plan(global_hold=True)

if __name__=='__main__':unittest.main()
