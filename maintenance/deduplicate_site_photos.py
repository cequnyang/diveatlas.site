"""Keep one byte-identical site image; preserve all per-site evidence and credits.

Usage: python maintenance/deduplicate_site_photos.py [--apply]
Only exact stored-file SHA256 equality permits sharing. A matching name, source
hash, similar composition or shared coordinates never justify deleting a file.
"""
from pathlib import Path
from collections import defaultdict
import argparse,hashlib,json,subprocess,datetime,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.photo_asset_urls import migrated_photo_paths,photo_asset_sha256
ASSETS=ROOT/'assets/dive-sites'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text('utf8'))
def save(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n','utf8')
def references(assignments,extras):
 for e in assignments:
  yield e,'hero'
  for p in e.get('additional_photos',[]):yield p,'src'
 for p in extras:yield p,'src'
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
 assignment_path=ASSETS/'assignments.json';extra_path=ASSETS/'additional-preview-options.json'
 assignments=read(assignment_path);extras=read(extra_path)
 before={p:sha(p) for p in [assignment_path,extra_path]}
 groups=defaultdict(set)
 for p in ASSETS.glob('*/*'):
  if p.suffix.lower() in {'.jpg','.png','.webp'}:groups[sha(p)].add('/'+p.relative_to(ROOT).as_posix())
 remote=migrated_photo_paths(ROOT)
 for src in remote:groups[photo_asset_sha256(ROOT,src)].add(src)
 # Prefer an existing hero path to avoid touching hero URLs unnecessarily. A
 # deterministic UUID/path order also makes repeated dry runs reproducible.
 canonical={p:min(paths,key=lambda s:(s not in remote,not s.endswith('/hero.jpg'),s)) for paths in groups.values() for p in paths}
 replacements={p:k for p,k in canonical.items() if p!=k}
 original_refs=[(obj,key,obj[key],photo_asset_sha256(ROOT,obj[key])) for obj,key in references(assignments,extras)]
 for obj,key,old,_ in original_refs:obj[key]=canonical[old]
 for e in assignments:
  urls=[e['hero'],*[p['src'] for p in e.get('additional_photos',[])]]
  if len(urls)!=len(set(urls)):raise ValueError('Identical images have separate attribution records; reconcile before deleting: '+e['site_id'])
 result={'duplicate_files':len(replacements),'duplicate_groups':sum(len(g)>1 for g in groups.values()),'bytes_saved':sum((ROOT/p.lstrip('/')).stat().st_size for p in replacements),'site_assignments':len(assignments),'preview_records':len(extras),'applied':args.apply}
 if args.apply and replacements:
  work=ROOT/'data'/('image-deduplication-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'));work.mkdir(parents=True,exist_ok=False)
  save(work/'assignments-before.json',read(assignment_path));save(work/'preview-options-before.json',read(extra_path));save(work/'replacements.json',replacements)
  assert all(sha(p)==v for p,v in before.items()),'Concurrent metadata update'
  save(assignment_path,assignments);save(extra_path,extras)
  (ROOT/'js/dive-site-additional-preview-photos.js').write_text('// Owner-selected additional preview options; never hero/thumbnail assignments.\nexport const additionalPreviewPhotos = '+json.dumps(extras,ensure_ascii=False,indent=2)+';\n','utf8')
  # Rebuild dependent static/shared/catalogue references before removing bytes.
  subprocess.run(['python','-B','maintenance/build_reviewed_site_photo_catalog.py'],cwd=ROOT,check=True)
  for obj,key,old,digest in original_refs:assert photo_asset_sha256(ROOT,obj[key])==digest,(old,obj[key])
  for old,new in replacements.items():
   source=(ROOT/old.lstrip('/')).resolve();keep=(ROOT/new.lstrip('/')).resolve()
   assert source.is_relative_to(ASSETS.resolve()) and keep.is_relative_to(ASSETS.resolve())
   assert sha(source)==photo_asset_sha256(ROOT,new)
   source.unlink()
  save(work/'result.json',result)
 print(json.dumps(result))
if __name__=='__main__':main()
