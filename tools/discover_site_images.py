"""Bounded offline preparation, guarded collection and offline gallery; never assignment."""
from pathlib import Path
import argparse, datetime, hashlib, html, io, json, os, random, re, sys, time, urllib.parse
ROOT=Path(__file__).resolve().parents[1]

def arguments():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['prepare','run','gallery','status','check-policy'])
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--limit',type=int,default=100)
    p.add_argument('--seed',type=int,default=20261108)
    p.add_argument('--minutes',type=int,default=60)
    p.add_argument('--requests',type=int,default=300)
    p.add_argument('--assets',type=int,default=100)
    p.add_argument('--leads',type=Path,help='Optional JSON list of site_id,source_page,basis,evidence; no search endpoints')
    return p.parse_args()

def published_inventory():
    # Use the same read-only validation boundary as the published directory.
    import generate_seo_pages as g
    rows=g.load_rows();base,fallback=g.load_fallback_photos()
    candidates,rejected=g.validated_candidates(rows,g.load_photos(),g.load_summaries(),base,fallback)
    ids={s['site_id']:s for s in candidates};slugs={}
    for page in (ROOT/'dive-sites').glob('*/index.html'):
        text=page.read_text(encoding='utf-8');match=re.search(r'<main[^>]+data-site-id="([a-f0-9-]{36})"',text)
        if match and match[1] in ids:slugs[match[1]]=page.parent.name
    output=[]
    for sid,site in sorted(ids.items()):
        if sid not in slugs:continue
        lat,lon=float(site['lat']),float(site['lon']);flags=[]
        if not(-90<=lat<=90 and -180<=lon<=180):flags.append('out-of-bounds')
        if lat==0 and lon==0:flags.append('null-island')
        if round(lat,2)==lat and round(lon,2)==lon:flags.append('coarse-two-decimal')
        output.append({'site_id':sid,'name':site['name'],'aliases':[x.strip() for x in str(site.get('aliases','')).split('|') if x.strip()], 'country':site['country'],'region':site.get('region',''),'lat':lat,'lon':lon,'slug':slugs[sid],'coordinate_flags':flags})
    from collections import Counter
    coordinates=Counter((s['lat'],s['lon']) for s in output)
    for site in output:
        if coordinates[site['lat'],site['lon']]>1:site['coordinate_flags'].append('shared-coordinate')
    return output,{'raw_records':len(rows),'validated_published_records':len(candidates),'physical_mapped_pages':len(output),'excluded':dict(rejected)}

def permitted_lead(url):
    p=urllib.parse.urlsplit(url)
    return (p.scheme=='https' and p.netloc=='commons.wikimedia.org' and not p.query and not p.fragment and p.path.startswith(('/wiki/File:','/wiki/Category:')))

def prepare(a):
    from common import H,load,dump,sha,now
    from matching import norm
    if H.exists():raise ValueError('Output directory already exists; use run/status/gallery to resume, never reset a pilot.')
    if not(1<=a.limit<=200 and 1<=a.minutes<=60 and 16<=a.requests<=650 and 0<=a.assets<=170):raise ValueError('Bounds:1..200 sites,1..60 minutes,16..650 requests,0..170 originals')
    sites,inventory=published_inventory();assigned=load(ROOT/'assets/dive-sites/assignments.json')
    exact=set(re.findall(r'"([a-f0-9-]{36})"\s*:',(ROOT/'datasets/dive-site-photos.js').read_text(encoding='utf-8')));excluded=exact|{e['site_id'] for e in assigned}
    available=[s for s in sites if s['site_id'] not in excluded];by_id={s['site_id']:s for s in available}
    by_name={}
    for s in available:
        for n in [s['name'],*s['aliases']]:by_name.setdefault(norm(n),set()).add(s['site_id'])
    ledger={};history_inputs=[]
    for p in sorted((ROOT/'data').glob('image-discovery-hour-*/manifest.json')):
        history=load(p);history_inputs.append({'path':str(p.relative_to(ROOT)),'sha256':sha(p)})
        for fid,f in history.get('files',{}).items():ledger[fid]={'status':f.get('status'),'sha256':f.get('sha256'),'origin':str(p.relative_to(ROOT))}
    leads=[]
    for entry in load(ROOT/'datasets/area-photos.json')['entries']:
        ids=by_name.get(norm(entry.get('matchingDiveSite','')),set());url=entry.get('sourcePage','')
        if len(ids)==1 and permitted_lead(url):leads.append({'site_id':next(iter(ids)),'source_page':url,'basis':'historical_named_site_lead','evidence':'Recorded matchingDiveSite: '+entry['matchingDiveSite']+'; old match is NOT identity/reuse approval.'})
    if a.leads:
        for lead in load(a.leads):
            if lead.get('site_id') not in by_id or not permitted_lead(lead.get('source_page','')) or not lead.get('evidence'):raise ValueError('Invalid supplied lead or nonpublished/already-assigned UUID')
            if lead.get('basis') not in ['exact_site','alias','verified_parent']:raise ValueError('Supplied basis must be exact_site, alias or verified_parent')
            if lead['basis']=='verified_parent' and not lead.get('parent_name'):raise ValueError('Parent lead needs parent_name and documented evidence')
            leads.append(lead)
    dedup={}
    for lead in leads:
        pair=(lead['site_id'],lead['source_page'])
        if pair not in dedup:dedup[pair]=lead
        elif lead.get('basis')!='historical_named_site_lead':dedup[pair]={**lead,'historical_lead_evidence':dedup[pair]}
    leads=list(dedup.values());with_leads={l['site_id'] for l in leads};rng=random.Random(a.seed)
    # Country round-robin prevents a large local source pool dominating the batch.
    buckets={}
    for s in available:
        if s['site_id'] in with_leads:buckets.setdefault(s['country'],[]).append(s)
    for country,bucket in buckets.items():rng.shuffle(bucket)
    selected=[]
    while buckets and len(selected)<a.limit:
        for country in sorted(list(buckets)):
            selected.append(buckets[country].pop())
            if not buckets[country]:del buckets[country]
            if len(selected)>=a.limit:break
    chosen={s['site_id'] for s in selected};leads=[l for l in leads if l['site_id'] in chosen]
    order={s['site_id']:i for i,s in enumerate(selected)}
    leads.sort(key=lambda l:({'exact_site':0,'alias':1,'historical_named_site_lead':2,'verified_parent':3}.get(l.get('basis'),4),order[l['site_id']],'/wiki/Category:' in l['source_page'],l['source_page']))
    H.mkdir(parents=True)
    for folder in ['cache','evidence','private-audit','assets','previews']:(H/folder).mkdir()
    baseline=load(ROOT/'tools/image_discovery/policy-baseline.json')
    docs={d['url']:d['sha256'] for d in baseline['documents'] if d['status']=='retrieved'}
    plan={'schema':'diveatlas-image-discovery-v1','created_at':now(),'seed':a.seed,'inventory':inventory,'raw_sha256':sha(ROOT/'datasets/dive-sites.js'),'inventory_sha256':hashlib.sha256(json.dumps(sites,sort_keys=True).encode()).hexdigest(),'sites':selected,'leads':leads,'history_inputs':history_inputs,'policy_baseline':docs,'budget':{'maximum_active_seconds':a.minutes*60,'maximum_operational_http_requests_including_robots_retries_assets':a.requests,'maximum_original_assets':a.assets,'maximum_original_bytes':18000000,'maximum_metadata_body_bytes':2000000,'minimum_spacing_seconds':2,'request_timeout_seconds':20,'maximum_original_total_bytes':750000000,'maximum_file_pages_per_site':4},'category_routes':[{'url':l['source_page']} for l in leads if '/wiki/Category:' in l['source_page']],'limits':'Local leads and supplied permitted individual Commons pages only. No API/global web-index search. Matching is screening; no automatic identity/visual/reuse/publication approval.'}
    dump(H/'plan.json',plan);dump(H/'freeze.json',{'plan_sha256':sha(H/'plan.json')});dump(H/'prior-files.json',ledger)
    dump(H/'state.json',{'files':{},'sites':{s['site_id']:{'candidate_ids':[],'outcome':'queued'} for s in selected},'categories':{},'original_bytes':0,'original_count':0})
    dump(H/'evidence/unselected.json',{'published_inventory':inventory,'eligible_unassigned':len(available),'selected':len(selected),'eligible_without_existing_or_supplied_leads':len(available)-len(with_leads),'reason':'Needs permitted search leads; not searched and not a no-images claim.'})
    print(json.dumps({'prepared_sites':len(selected),'lead_count':len(leads),'inventory':inventory,'network_requests':0,'out':str(H)}))

def frozen():
    from common import H,load,sha
    plan=load(H/'plan.json')
    if plan.get('schema')!='diveatlas-image-discovery-v1' or sha(H/'plan.json')!=load(H/'freeze.json')['plan_sha256']:raise ValueError('Frozen plan changed; refusing reset/dispatch')
    if sha(ROOT/'datasets/dive-sites.js')!=plan['raw_sha256']:raise ValueError('Inventory changed; prepare a separate new batch')
    return plan

def run(a):
    from contextlib import closing
    from store import connect
    frozen()
    with closing(connect()) as db:
        collect(a,db)

def collect(a,db):
    from common import H,load,dump,sha,now
    import policy_probe
    from client import Client,Blocked,Deferred
    from store import connect,control,set_control,file_key
    from matching import parse_file,compatible_license,phrase,distance_km
    from bs4 import BeautifulSoup
    from PIL import Image,ImageOps
    plan=frozen();state=load(H/'state.json');prior=load(H/'prior-files.json');budget=plan['budget']
    transferred=db.execute("SELECT coalesce(sum(coalesce(bytes,?)),0) FROM requests WHERE purpose='original'",(budget['maximum_original_bytes']+1,)).fetchone()[0]
    state['original_bytes']=max(state['original_bytes'],transferred)
    state['original_count']=max(state['original_count'],len(list((H/'assets').iterdir())))
    # An exclusive lock is process-scoped; interruption cannot leave a stale lock.
    policy_path=H/'evidence/source-policy-probe.json'
    if not policy_path.exists():
        before=control(db,'operational_request_count',0)
        if budget['maximum_operational_http_requests_including_robots_retries_assets']-before<16:raise ValueError('Insufficient budget for policy bootstrap')
        set_control(db,'operational_request_count',before+16)  # Reserve before dispatch; interruption cannot restore spent budget.
        started=time.monotonic()
        try:policy_probe.main()
        finally:set_control(db,'active_seconds',control(db,'active_seconds',0)+time.monotonic()-started)
        probe=load(policy_path);set_control(db,'operational_request_count',before+probe['http_requests'])
    probe=load(policy_path)
    from policy_content import verify
    verification=verify(plan,probe,H,ROOT/'tools/image_discovery/policy-baseline.json',policy_probe.DOCS)
    dump(H/'evidence/policy-content-verification.json',verification)
    # The total elapsed budget includes bootstrap and every resumed collection segment.
    client=Client(db,plan);sites={s['site_id']:s for s in plan['sites']};hashes={f['sha256'] for f in state['files'].values() if f.get('sha256')}|{f['sha256'] for f in prior.values() if f.get('sha256')}
    def save():dump(H/'state.json',state)
    def file(lead,url):
        sid=lead['site_id'];site=sites[sid];fid=file_key(url);assignment=state['sites'][sid]
        if fid not in assignment['candidate_ids']:assignment['candidate_ids'].append(fid)
        if fid in state['files']:
            record=state['files'][fid]
            if sid not in record.setdefault('site_ids',[]):record['site_ids'].append(sid)
            save();return
        if len(assignment['candidate_ids'])>budget['maximum_file_pages_per_site']:
            assignment['outcome']='file-page budget exhausted';state['files'].setdefault(fid,{'source_page':url,'status':'per-site file-page budget exhausted; not dispatched'});save();return
        if fid in prior:state['files'][fid]={'source_page':url,'status':'previously inspected; not redispatched','prior':prior[fid]};save();return
        record={'source_page':url,'site_ids':[sid],'lead_evidence':lead,'status':'metadata request reserved','identity':'unresolved','visual_usefulness':'not reviewed','rights':'unresolved','human_review':'not performed','publication':'NOT_AUTHORIZED'};state['files'][fid]=record;save()
        try:
            client.allowed_files.add(url);body,fresh=client.get(url);m=parse_file(body,url);m['retrieved_at']=now();m['source_body_sha256']=hashlib.sha256(body).hexdigest();record['metadata']=m;record['status']='metadata checked; review needed'
            cues=[site['name'],*site['aliases']]
            if lead.get('basis')=='verified_parent':cues.append(lead['parent_name'])
            text=str(m.get('title',''))+' '+str(m.get('description',''));matched=any(phrase(text,c) for c in cues)
            camera=m.get('camera_coordinates');record['screen']={'name_or_explicit_parent_in_source':matched,'camera_to_record_km':round(distance_km([site['lat'],site['lon']],camera),3) if camera else None,'coordinate_flags':site['coordinate_flags'],'limitations':'Screening only; source caption/proximity is not independently verified identity or visual usefulness.'}
            dims=m['original_dimensions'];size=m['original_bytes_approx']
            if re.search(r'\b(map|chart|diagram|illustration|bathymetry|sonar)\b',text,re.I):record['status']='non-photographic/ambiguous source; original not requested';return
            if not matched:record['status']='unresolved source identity; original not requested';return
            if not(m['creator'] and compatible_license(m['selected_licence_url']) and dims and size and 0<size<=budget['maximum_original_bytes'] and m['original_url']):record['status']='unresolved creator/licence/dimensions/size; original not requested';return
            record['rights']='compatible licence metadata recorded; ownership/upstream rights and human review unresolved'
            if state['original_count']>=budget['maximum_original_assets']:record['status']='original asset budget reached';return
            state['original_bytes']=client.original_bytes()
            if state['original_bytes']+budget['maximum_original_bytes']+1>budget['maximum_original_total_bytes']:record['status']='original total-byte budget reached';return
            if record['screen']['camera_to_record_km'] is not None and record['screen']['camera_to_record_km']>30:record['status']='coordinate conflict; original not requested';return
            # Persist dispatch intent; a crash never automatically repeats that asset request.
            record['asset_request_reserved']=True;save();client.allowed_originals[m['original_url']]=m;original,_=client.get(m['original_url'],asset=True);state['original_bytes']=client.original_bytes()
            if state['original_bytes']>budget['maximum_original_total_bytes']:record['status']='actual original bytes exceed retention budget; not retained';return
            image=Image.open(io.BytesIO(original));image.verify();image=Image.open(io.BytesIO(original));assert dims in [list(image.size),list(ImageOps.exif_transpose(image).size)]
            assert image.format in ['JPEG','MPO','PNG','WEBP']
            digest=hashlib.sha256(original).hexdigest()
            if digest in hashes:record['status']='duplicate original; not a new image';return
            hashes.add(digest);asset=H/'assets'/(digest+'.'+('png' if image.format=='PNG' else 'webp' if image.format=='WEBP' else 'jpg'));asset.write_bytes(original)
            preview=ImageOps.exif_transpose(image).convert('RGB');preview.thumbnail((1100,800),Image.Resampling.LANCZOS);target=H/'previews'/(digest+'.jpg');preview.save(target,quality=86,optimize=True)
            record.update(asset=asset.relative_to(H).as_posix(),preview=target.relative_to(H).as_posix(),preview_notice='Resized and EXIF-oriented only; no crop or colour/sharpness edits. Preserve exact source licence and attribution.',sha256=digest,status='downloaded; identity/visual/rights human review pending');state['original_count']+=1
        except Deferred:raise
        except Exception as error:record['status']='unresolved: '+str(error)
        finally:
            state['original_bytes']=client.original_bytes();save()
    try:
        for lead in plan['leads']:
            url=lead['source_page'];sid=lead['site_id']
            if not permitted_lead(url):raise ValueError('Invalid frozen source URL')
            if '/wiki/File:' in url:file(lead,url)
            elif url not in state['categories']:
                state['categories'][url]={'status':'request reserved','selected':[]};save()
                try:
                    body,_=client.get(url);soup=BeautifulSoup(body,'html.parser');urls=[]
                    for link in soup.select('.gallerytext a[href], .galleryfilename a[href]'):
                        u=urllib.parse.urljoin(url,link['href'])
                        if permitted_lead(u) and '/wiki/File:' in u and u not in urls:urls.append(u)
                    # Cache source facts, not one site's selection: categories may be shared.
                    state['categories'][url]={'status':'checked first page only; global availability unknown','file_urls':urls};save()
                except Deferred:raise
                except Exception as error:
                    state['categories'][url]['status']='unresolved: '+str(error);save()
            category=state['categories'].get(url,{})
            if category and 'file_urls' not in category:
                # Old checkpoints contain a lossy site-specific list. Do not treat it
                # as the full category or silently replay a historical request.
                state['sites'][sid]['outcome']='category file list unavailable; separate batch required';save();continue
            names=[sites[sid]['name'],*sites[sid]['aliases']]
            if lead.get('basis')=='verified_parent':names.append(lead['parent_name'])
            urls=[u for u in category.get('file_urls',[]) if any(phrase(urllib.parse.unquote(u),n) for n in names)]
            urls.sort(key=lambda u:(-sum(phrase(urllib.parse.unquote(u),n) for n in names),u))
            for u in urls[:budget['maximum_file_pages_per_site']]:file(lead,u)
            state['sites'][sid]['outcome']='candidate review pending' if state['sites'][sid]['candidate_ids'] else 'no file under bounded permitted lead';save()
    except Deferred as error:state['stop_reason']=str(error)
    finally:
        client.close();state['checkpoint_at']=now();save()
    gallery(a)

def gallery(a):
    from common import H,load,dump
    plan=frozen();state=load(H/'state.json');cards=[];sites={s['site_id']:s for s in plan['sites']};escape=html.escape
    for sid,s in sites.items():
        items=[]
        for fid in state['sites'][sid]['candidate_ids']:
            record=state['files'].get(fid,{});m=record.get('metadata',{});preview=record.get('preview');image='<img src="'+escape(preview)+'" alt="Unreviewed source image">' if preview else ''
            extra='<a href="http://delso.photo">delso.photo</a>' if m.get('extra_credit_link') else ''
            items.append(image+'<p>'+escape(record.get('status','unresolved'))+'</p><p>'+escape(str(m.get('description','')))+'</p><p>'+escape(str(m.get('required_credit','Rights unresolved')))+'</p><p>Original dimensions: '+escape(str(m.get('original_dimensions','unresolved')))+' · Identity: unresolved · Visual usefulness: not reviewed · Human review: not performed · Publication: NOT AUTHORIZED</p>'+extra+'<a href="'+escape(record.get('source_page',''))+'">Source</a> · <a href="'+escape(str(m.get('selected_licence_url') or record.get('source_page','')))+'">Licence evidence</a>')
        cards.append('<article><h2>'+escape(s['name'])+'</h2><p>'+escape(s['country'])+' · '+escape(sid)+'</p><p>'+escape(state['sites'][sid]['outcome'])+'</p>'+''.join(items or ['No candidate; needs permitted search leads.'])+'</article>')
    page='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DiveAtlas candidate review</title><style>body{font:16px system-ui;margin:20px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:20px}article{padding:16px;background:#edf4f6;min-width:0}img{max-width:100%;height:240px;object-fit:contain}p,a{overflow-wrap:anywhere}</style><h1>Unreviewed discovery candidates</h1><p>No image is identity-verified, visually accepted, human approved or publication-authorized. Captions/proximity and licence metadata are evidence, not approval. Previews resized/EXIF-oriented only; not cropped.</p><main>'+''.join(cards)+'</main>'
    (H/'index.html').write_text(page,encoding='utf-8');dump(H/'manifest.json',{'plan':plan,'results':state});print(json.dumps({'sites':len(sites),'originals':state['original_count'],'gallery':str(H/'index.html')}))

def main():
    a=arguments();os.environ['DIVEATLAS_IMAGE_RUN']=str(a.out.resolve());sys.path.insert(0,str(ROOT/'tools/image_discovery'))
    if a.command=='prepare':prepare(a)
    elif a.command=='run':
        # OS-level advisory lock protects budgets/checkpoints across simultaneous runs.
        from common import H
        from filelock import FileLock
        if not (H/'freeze.json').is_file():raise ValueError('Prepare a new batch before run')
        with FileLock(str(H/'run.lock'),timeout=0):run(a)
    elif a.command=='gallery':gallery(a)
    elif a.command=='check-policy':
        from common import H,load,dump
        from policy_content import verify
        import policy_probe
        result=verify(frozen(),load(H/'evidence/source-policy-probe.json'),H,ROOT/'tools/image_discovery/policy-baseline.json',policy_probe.DOCS)
        dump(H/'evidence/policy-content-verification.json',result)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    else:
        from common import H,load
        plan=frozen();print(json.dumps({'sites':len(plan['sites']),'state':load(H/'state.json')},ensure_ascii=False,indent=2))
if __name__=='__main__':
    try:main()
    except ValueError as error:raise SystemExit('Stopped safely: '+str(error)) from None
