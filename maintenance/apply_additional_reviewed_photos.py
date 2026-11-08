"""Stage or apply explicitly reviewed additional photos, without network access.

Usage: python maintenance/apply_additional_reviewed_photos.py --decisions data/image-application-additional-20261108/decisions.json [--apply]
Staging writes only beside the decision file. Inspect crop sheets before --apply.
Context photographs stay separate from the registry that asserts exact identity.
"""
from pathlib import Path
import argparse, hashlib, json, re, shutil
from PIL import Image, ImageOps, ImageDraw
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
    source_run=source_path.parents[1]; state=load(source_run/'manifest.json'); sites={s['site_id']:s for s in packet['sites']}
    candidates={r['review_id']:r for r in packet['candidates']}; staged=work/'assets';staged.mkdir(exist_ok=True)
    target=ROOT/'assets/dive-sites/reviewed-20261108'; combined_path=ROOT/'assets/dive-sites/reviewed-discovery/combined-assignments.json'
    existing=load(combined_path); by_id={e['site_id']:e for e in existing}; entries=[]
    exact=(ROOT/'datasets/dive-site-photos.js').read_text(encoding='utf-8')
    for decision in decisions['decisions']:
        if decision['role']!='hero':continue
        r=candidates[decision['review_id']]; sid=decision['site_id'];a=r['assessment'];site=sites[sid]
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
        label=special.get(r['review_id'],label);creator=r['creator'];links=[]
        if 'Diego Delso' in creator:creator='Diego Delso';links=[{'label':'delso.photo','url':'http://delso.photo'}]
        if 'Anton Zelenov' in creator:creator='Photo: Anton Zelenov'
        if 'mccaffrey_uk' in creator:creator='mccaffrey_uk';links=[{'label':'Photographer','url':'https://www.flickr.com/photos/mccaffrey_uk/'}]
        boxes={};paths={}
        with Image.open(original) as image:
            im=ImageOps.exif_transpose(image).convert('RGB');w,h=im.size
            for variant,size in [('desktop',(1600,900)),('mobile',(900,675))]:
                ratio=size[0]/size[1];cw=min(w,round(h*ratio));ch=min(h,round(w/ratio));left=(w-cw)//2;top=(h-ch)//2;box=[left,top,left+cw,top+ch];boxes[variant]=box
                crop=im.crop(box);crop.thumbnail(size,Image.Resampling.LANCZOS);name=sid+'-'+variant+'.jpg';crop.save(staged/name,quality=88,optimize=True);paths[variant]='/'+(target/name).relative_to(ROOT).as_posix()
        entries.append({'site_id':sid,'name':site['name'],'country':site['country'],'slug':slug,'review_id':r['review_id'],'source_page':r['source_page'],'creator':creator,'creator_links':links,'licence':license_name,'licence_url':licence,'role':'main','label':label,'alt':site['name']+' — '+label.lower()+', as described by the source.','source_description':r['description'],'identity_status':a['evidence'],'rights_status':a['licence_review'],'human_review_status':'Owner requests suitable local assignments; AI source/crop assessment, not independent human identity or ownership verification.','publication_status':'NOT_AUTHORIZED','editorial_status':'Owner-authorized local assignment; not deployed','original_dimensions':r['dimensions'],'original_sha256':sha,'crop_boxes':boxes,'change_notice':'Cropped and resized from EXIF-oriented original; JPEG re-encoded; no colour/sharpness edits. Preserve credit, source and exact licence; applicable ShareAlike conditions remain.','source_review_manifest':decisions['source_manifest'],**paths})
    dump(work/'assignments.json',entries)
    for variant in ['desktop','mobile']:
        for offset in range(0,len(entries),12):
            batch=entries[offset:offset+12];sheet=Image.new('RGB',(1600,((len(batch)+3)//4)*300),'#edf3f5');draw=ImageDraw.Draw(sheet)
            for j,e in enumerate(batch):
                im=Image.open(staged/(e['site_id']+'-'+variant+'.jpg'));im.thumbnail((390,245));x=j%4*400;y=j//4*300;sheet.paste(im,(x,y));draw.text((x+3,y+248),e['review_id']+' '+e['slug'][:40],fill='black')
            sheet.save(work/'crops'/f'{variant}-{offset//12+1}.jpg',quality=90)
    if args.apply:
        preserve_explicit_photo_priority()
        target.mkdir(exist_ok=True)
        for e in entries:
            for variant in ['desktop','mobile']:shutil.copy2(staged/(e['site_id']+'-'+variant+'.jpg'),target)
        dump(target/'assignments.json',entries)
        combined=existing+[e for e in entries if e['site_id'] not in by_id];dump(combined_path,combined)
        (ROOT/'js/dive-site-reviewed-image-sites.js').write_text('// Generated from combined-assignments.json; context photos stay outside the exact-site registry.\nexport const reviewedSiteIds = '+json.dumps([e['site_id'] for e in combined],indent=2)+';\n',encoding='utf-8')
    print(json.dumps({'staged':len(entries),'applied':bool(args.apply)}))
if __name__=='__main__':main()
