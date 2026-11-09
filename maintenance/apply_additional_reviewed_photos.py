"""Stage or apply explicitly reviewed additional photos, without network access.

Usage: python maintenance/apply_additional_reviewed_photos.py --decisions data/image-application-additional-20261108/decisions.json [--apply]
Staging writes only beside the decision file. Inspect crop sheets before --apply.
Context photographs stay separate from the registry that asserts exact identity.
"""
from pathlib import Path
import argparse, hashlib, json, re, shutil
from PIL import Image, ImageOps, ImageDraw
from photo_assignment_publication import public_assignment
ROOT = Path(__file__).resolve().parents[1]
def load(p): return json.loads(p.read_text(encoding='utf-8'))
def dump(p, value): p.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
def preserve_explicit_photo_priority():
    # The private guide renderer is a local generated artifact, not a tracked
    # production bundle. Reapply these narrow guards when regenerating this batch.
    renderer=ROOT/'artifacts/catalogue-enrichment/renderer.js'
    if not renderer.exists():return
    text=renderer.read_text(encoding='utf-8')
    replacements=[
        ("function leadWithApprovedPhoto(page, record) {", "function leadWithApprovedPhoto(page, record) {\n    // Explicit UUID-bound hero choices take priority over the older local guide media.\n    if (page.dataset.reviewedImages || window.DiveAtlasReviewedPhotos?.get(record.site_id)) return;"),
        ("if(!photos.length||popup.dataset.guidePhoto===id)return;", "if(!photos.length||popup.dataset.guidePhoto===id||window.DiveAtlasReviewedPhotos?.get(id))return;"),
        ("if(!record||!card.isConnected||card.href!==href.href)return;", "if(!record||!card.isConnected||card.href!==href.href)return;\n          if(card.dataset.reviewedThumbnail||window.DiveAtlasReviewedPhotos?.get(id))return;")]
    for old,new in replacements:
        if new in text:continue
        if text.count(old)!=1:raise ValueError('Local guide renderer changed; review photo precedence before patching')
        text=text.replace(old,new)
    renderer.write_text(text,encoding='utf-8')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--decisions',type=Path,required=True)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args(); decision_path=args.decisions.resolve(); work=decision_path.parent
    decisions=load(decision_path); source_path=ROOT/decisions['source_manifest']; packet=load(source_path)
    source_run=source_path.parents[1]; state=load(source_run/'manifest.json')
    if 'candidate_files' in packet:
        # Both review formats carry the same source facts; normalize only the
        # adapter shape, preserving the original evidence packet untouched.
        sites={r['site']['site_id']:r['site'] for r in packet['candidate_files']}
        candidates={r['file_id']:{'review_id':r['file_id'],'file_id':r['file_id'],
            'assessment':{'site_id':r['site_id'],'visual_type':r['review']['visual_type'],
                'evidence':r['review']['identity_evidence'],'licence_review':r['review']['licence_evidence']},
            'dimensions':r['metadata']['original_dimensions'],'original_sha256':r['sha256'],
            'creator':r['review']['creator_display'],'licence':r['metadata']['selected_licence_url'],
            'source_page':r['source_page'],'description':r['metadata']['description'],
            'licence_evidence_text':r['metadata'].get('licence_section_text')}
            for r in packet['candidate_files'] if r['review']['decision']=='CANDIDATE' and r['review']['proposed_role']=='main-image review candidate'}
    else:
        sites={s['site_id']:s for s in packet['sites']}
        candidates={r['review_id']:r for r in packet['candidates']}
    staged=work/'assets';staged.mkdir(exist_ok=True)
    # Batch evidence stays beside the private decision file, outside published assets.
    target=ROOT/'assets/dive-sites'
    combined_path=ROOT/'assets/dive-sites/assignments.json'
    existing=load(combined_path); by_id={e['site_id']:e for e in existing}; entries=[]
    exact=(ROOT/'datasets/dive-site-photos.js').read_text(encoding='utf-8')
    for decision in decisions['decisions']:
        if decision['role']!='hero':continue
        r=candidates[decision['review_id']]; sid=decision['site_id'];a=r['assessment'];site=sites[sid]
        if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',sid):raise ValueError('Invalid stable site UUID')
        assert sid==a['site_id'] and sid not in exact
        assert 'supporting' not in a['visual_type'] and r['dimensions'][0]>=1200 and r['dimensions'][1]>=675
        slug=site['slug']; page=ROOT/'dive-sites'/slug/'index.html'
        assert 'data-site-id="'+sid+'"' in page.read_text(encoding='utf-8'),(sid,slug)
        original=source_run/state['files'][r['file_id']]['asset'];sha=hashlib.sha256(original.read_bytes()).hexdigest()
        assert sha==r['original_sha256']
        if sid in by_id:assert by_id[sid].get('original_sha256')==sha,'Refuse to replace pre-existing assignment'
        licence=r['licence'];match=re.search(r'/licenses/(by(?:-sa)?)/(\d\.\d)/',licence)
        assert match or '/publicdomain/zero/' in licence
        license_name='CC '+match[1].upper()+' '+match[2] if match else 'CC0 1.0'
        typ=a['visual_type'];label='Underwater view' if 'underwater' in typ else ('Nearby surface context' if any(k in typ for k in ['nearby','destination']) else 'Surface view')
        special={'c023':'Nearby surface context · Langebaan Lagoon','c057':'Surface view · Bounty Beach, Malapascua','c062':'Nearby surface context · Gili Meno beach','c083':'Surface context · Tabarca coast','c089':'Above/below-water view','c109':'Surface view · Baie Ternay beach','c110':'Surface view · Punta Veleros beach','c114':'Surface view · Santa Marta Bay','c115':'Surface context · Kallithea shoreline','c117':'Surface context · Hillsborough beach','c125':'Surface view · Ao Kuerk, Ko Similan','c127':'Surface wreck view · 2014','c129':'Surface context · Telegraph Island','c132':'Surface view · Lake Geneva, Vevey','c135':'Surface context · Lac de Nantua','c136':'Nearby surface context · Mahahual Beach','c137':'Nearby surface context · Sabang beach','c141':'Nearby surface context · Point Lonsdale beach','c144':'Surface context · Cape Opat','c151':'Surface view · Pyramid landmark','c167':'Surface wreck view · 2006','c181':'Surface view · Ama Beach, Zamami','c247':'Surface context · Gili Air west-side beach','c253':'Surface context · Bare Island bridge','c260':'Surface context · Amedee Island','c268':'Surface context · Platte-Taille lake/dam','c275':'Surface cave-entry view'}
        label=decision.get('label',special.get(r['review_id'],label));creator=decision.get('creator',r['creator']);links=list(decision.get('creator_links',[]))
        if 'Diego Delso' in creator:creator='Diego Delso';links=[{'label':'delso.photo','url':'http://delso.photo'}]
        if 'Anton Zelenov' in creator:creator='Photo: Anton Zelenov'
        if 'mccaffrey_uk' in creator:creator='mccaffrey_uk';links=[{'label':'Photographer','url':'https://www.flickr.com/photos/mccaffrey_uk/'}]
        with Image.open(original) as image:
            hero=ImageOps.exif_transpose(image).convert('RGB')
            # Preserve the source composition: responsive hero frames crop in CSS.
            hero.thumbnail((1600,1600),Image.Resampling.LANCZOS)
            hero.save(staged/(sid+'-hero.jpg'),quality=88,optimize=True)
        hero_path='/'+(target/sid/'hero.jpg').relative_to(ROOT).as_posix()
        entries.append({'site_id':sid,'name':site['name'],'country':site['country'],'slug':slug,'review_id':r['review_id'],'source_page':r['source_page'],'creator':creator,'creator_links':links,'licence':license_name,'licence_url':licence,'role':'main','label':label,'alt':site['name']+' — '+label.lower()+', as described by the source.','source_description':r['description'],'licence_evidence_text':r.get('licence_evidence_text'),'identity_status':a['evidence'],'rights_status':a['licence_review'],'human_review_status':'Owner requests suitable local assignments; AI source/crop assessment, not independent human identity or ownership verification.','publication_status':'NOT_AUTHORIZED','editorial_status':'Owner-authorized local assignment; not deployed','original_dimensions':r['dimensions'],'original_sha256':sha,'change_notice':'Full EXIF-oriented composition resized and JPEG re-encoded; no colour/sharpness edits. Hero frames crop in the browser. Preserve credit, source and exact licence; applicable ShareAlike conditions remain.','source_review_manifest':decisions['source_manifest'],'hero':hero_path})
    dump(work/'assignments.json',entries)
    for variant in ['hero']:
        for offset in range(0,len(entries),12):
            batch=entries[offset:offset+12];sheet=Image.new('RGB',(1600,((len(batch)+3)//4)*300),'#edf3f5');draw=ImageDraw.Draw(sheet)
            for j,e in enumerate(batch):
                im=Image.open(staged/(e['site_id']+'-'+variant+'.jpg'));im.thumbnail((390,245));x=j%4*400;y=j//4*300;sheet.paste(im,(x,y));draw.text((x+3,y+248),e['review_id']+' '+e['slug'][:40],fill='black')
            sheet.save(work/'crops'/f'{variant}-{offset//12+1}.jpg',quality=90)
    if args.apply:
        preserve_explicit_photo_priority()
        for e in entries:
            site_target=target/e['site_id'];site_target.mkdir(exist_ok=True)
            shutil.copy2(staged/(e['site_id']+'-hero.jpg'),site_target/'hero.jpg')
        # A resumed, explicitly selected batch may correct credits for the SAME original.
        # Other batches remain byte-for-byte values; different originals were rejected above.
        refreshed={e['site_id']:e for e in entries}
        combined=[refreshed.get(e['site_id'],e) for e in existing]+[e for e in entries if e['site_id'] not in by_id]
        # Local evidence paths remain in work/assignments.json. Published assets
        # cannot reference the ignored research tree; retain public source/rights evidence.
        public=[public_assignment(e) for e in combined]
        dump(combined_path,public)
        (ROOT/'js/dive-site-reviewed-image-sites.js').write_text('// Generated from combined-assignments.json; context photos stay outside the exact-site registry.\nexport const reviewedSiteIds = '+json.dumps([e['site_id'] for e in combined],indent=2)+';\n',encoding='utf-8')
    print(json.dumps({'staged':len(entries),'applied':bool(args.apply)}))
if __name__=='__main__':main()
