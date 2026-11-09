"""Publish permitted display copies to immutable R2 keys, with local checkpoints.

python maintenance/upload_dive_site_photos_r2.py prepare
python maintenance/upload_dive_site_photos_r2.py upload

For later selected batches, preserve the original checkpoint and use:
python maintenance/upload_dive_site_photos_r2.py prepare --batch group004-20261109 --review data/image-group004-r2-20261109/hosting-review.json --work-dir data/image-group004-r2-20261109
Use the same arguments with `upload` to resume that frozen batch.

Existing environment credentials are used in memory, never saved. Explicit
rights-evidence holds stay local. Uploading never changes identity/credit fields.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
from collections import defaultdict
import argparse,base64,hashlib,json,os,re,sys,threading,time,urllib.request

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.photo_asset_urls import photo_asset_available,photo_asset_sha256,photo_asset_size,photo_asset_url
WORK=ROOT/'data/image-r2-migration-20261109'
BATCH=None
REVIEW=None
BASE='https://assets.diveatlas.site'
PREFIX='site-photos/v1/'
ACCOUNT='c0cbc007f637d7263a3be3b692b4dd63'
BUCKET='diveatlas-site'
BLOCK=re.compile(r'HELD|missing|uncertain reuse|complete.*absent|not recorded|unknown|all rights reserved|non.?commercial|by-nc',re.I)
read=lambda p:json.loads(p.read_text('utf8'))
def save(p,v):
 temp=p.with_suffix(p.suffix+'.tmp');temp.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n','utf8');temp.replace(p)
def prepare():
 assignments=read(ROOT/'assets/dive-sites/assignments.json')
 extras=read(ROOT/'assets/dive-sites/additional-preview-options.json')
 scope={p['src'] for p in extras if p.get('batch')==BATCH} if BATCH else None
 if BATCH:
  assert scope,'No active preview records for requested batch'
  assert REVIEW and REVIEW.is_file(),'A batch requires an explicit hosting review'
 review=read(REVIEW).get('assets',{}) if REVIEW else {}
 references=defaultdict(list)
 def add(src,licence,rights,credit,source):
  reasons=[]
  if not credit or not source:reasons.append('Missing creator/source evidence')
  if BLOCK.search(rights+' '+licence):reasons.append(rights or licence)
  references[src].append({'licence':licence,'rights':rights,'credit':credit,'source':source,'reasons':reasons})
 for e in assignments:
  add(e['hero'],e['licence'],e.get('rights_status',''),e['creator'],e['source_page'])
  for p in e.get('additional_photos',[]):add(p['src'],p['licence'],p.get('rights_status',''),p['creator'],p['source_page'])
 for p in extras:
  add(p['src'],p['credit'],p.get('rightsStatus',''),p['credit'],next((x['url'] for x in p['creditLinks'] if x['label']=='Source'),''))
 # Personal/owned photos remain in their separate exact-site registry.
 import sys
 sys.path.insert(0,str(ROOT/'tools'));import generate_seo_pages as seo
 personal={sid:p for sid,p in seo.load_photos().items() if p.get('source')=='personal'}
 public_map=ROOT/'datasets/dive-site-photo-r2.json'
 reverse={v['url']:k for k,v in read(public_map)['assets'].items()} if public_map.exists() else {}
 global_holds=read(public_map).get('held',{}) if public_map.exists() else {}
 for p in personal.values():add(reverse.get(p['src'],'/'+p['src'].lstrip('/')),'owned','Owner-provided personal photograph',p['credit'],'owner-provided')
 objects=[];held=[]
 for src,claims in sorted(references.items()):
  if scope is not None and src not in scope:continue
  local=(ROOT/src.lstrip('/')).resolve();assert local.is_relative_to((ROOT/'assets/dive-sites').resolve()) and photo_asset_available(ROOT,src)
  reasons=[reason for c in claims for reason in c['reasons']]
  if src in global_holds:reasons.append(global_holds[src]['reason'])
  if BATCH:
   assessment=review.get(src,{})
   if assessment.get('decision')!='include':reasons.append(assessment.get('reason','Missing batch-specific source/hosting review'))
  if reasons:held.append({'local':src,'reasons':sorted(set(reasons))});continue
  digest=photo_asset_sha256(ROOT,src);key=PREFIX+digest+local.suffix.lower()
  objects.append({'local':src,'sha256':digest,'key':key,'url':BASE+'/'+key,'bytes':photo_asset_size(ROOT,src),'content_type':'image/webp' if local.suffix.lower()=='.webp' else ('image/png' if local.suffix.lower()=='.png' else 'image/jpeg')})
 assert len({o['key'] for o in objects})==len(objects),'Deduplicate display copies before preparing uploads'
 plan={'schema':1,'bucket':BUCKET,'account_id':ACCOUNT,'public_base':BASE,'prefix':PREFIX,'objects':objects,'held':held,'bytes':sum(o['bytes'] for o in objects)}
 if BATCH:
  plan['batch']=BATCH
  plan['review_sha256']=hashlib.sha256(REVIEW.read_bytes()).hexdigest()
 WORK.mkdir(parents=True,exist_ok=True);path=WORK/'plan.json'
 if path.exists():assert read(path)==plan,'Frozen upload plan changed; create a new versioned migration'
 else:save(path,plan)
 print(json.dumps({'upload_images':len(objects),'upload_bytes':plan['bytes'],'held_local':len(held)}))
def upload():
 import boto3
 from botocore.config import Config
 from botocore.exceptions import ClientError
 assert os.environ['CLOUDFLARE_ACCOUNT_ID']==ACCOUNT and os.environ['CLOUDFLARE_R2_BUCKET']==BUCKET
 plan=read(WORK/'plan.json');assert plan['bucket']==BUCKET and plan['prefix']==PREFIX
 if BATCH:assert plan['batch']==BATCH and hashlib.sha256(REVIEW.read_bytes()).hexdigest()==plan['review_sha256'],'Frozen hosting review changed'
 if not plan['objects']:
  print(json.dumps({'verified_objects':0,'held_local':len(plan['held'])}));return
 client=boto3.client('s3',endpoint_url=f'https://{ACCOUNT}.r2.cloudflarestorage.com',aws_access_key_id=os.environ['CLOUDFLARE_R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['CLOUDFLARE_R2_SECRET_ACCESS_KEY'],region_name='auto',config=Config(retries={'mode':'standard','total_max_attempts':3},connect_timeout=15,read_timeout=60,max_pool_connections=4))
 state_path=WORK/'checkpoint.json';state=read(state_path) if state_path.exists() else {'verified':{},'requests':0,'payload_bytes_attempted':0,'failures':[]}
 lock=threading.Lock();stop=threading.Event();start=time.monotonic()
 def request(method,**kwargs):
  with lock:
   if state['requests']>=6000:raise RuntimeError('Migration request budget exceeded')
   state['requests']+=1
  try:response=getattr(client,method)(**kwargs)
  except ClientError as error:
   with lock:state['requests']+=error.response.get('ResponseMetadata',{}).get('RetryAttempts',0)
   raise
  with lock:state['requests']+=response.get('ResponseMetadata',{}).get('RetryAttempts',0)
  return response
 def head(item):
  r=request('head_object',Bucket=BUCKET,Key=item['key'])
  assert r['ContentLength']==item['bytes'] and r.get('Metadata',{}).get('sha256')==item['sha256'],'Remote content differs'
  assert r['ContentType']==item['content_type']
 def transfer(item):
  if stop.is_set():return
  path=ROOT/item['local'].lstrip('/')
  body=path.read_bytes() if path.is_file() else None
  if body is None:
   assert photo_asset_url(ROOT,item['local'])==item['url'],'Missing unuploaded source image'
  else:assert hashlib.sha256(body).hexdigest()==item['sha256']
  if body is not None and item['key'] not in state['verified']:
   try:
    with lock:state['payload_bytes_attempted']+=len(body)
    request('put_object',Bucket=BUCKET,Key=item['key'],Body=body,ContentType=item['content_type'],ContentMD5=base64.b64encode(hashlib.md5(body).digest()).decode(),Metadata={'sha256':item['sha256']},CacheControl='public,max-age=31536000,immutable',StorageClass='STANDARD',IfNoneMatch='*')
   except ClientError as error:
    if str(error.response.get('Error',{}).get('Code')) not in ['PreconditionFailed','412']:raise
  head(item)
  with lock:
   state['verified'][item['key']]={'bytes':item['bytes'],'sha256':item['sha256']};save(state_path,state)
 def public_get(item):
  req=urllib.request.Request(item['url'],headers={'User-Agent':'DiveAtlas-R2-Migration/1.0','Origin':'https://diveatlas.site'})
  with urllib.request.urlopen(req,timeout=45) as response:
   assert response.geturl()==item['url'],'Unexpected public asset redirect'
   data=response.read();assert hashlib.sha256(data).hexdigest()==item['sha256']
   return {'url':item['url'],'bytes':len(data),'sha256_verified':True,'cors':response.headers.get('Access-Control-Allow-Origin'),'cache_control':response.headers.get('Cache-Control')}
 # Check one upload and its actual custom-domain delivery before uploading the rest.
 first=plan['objects'][0];transfer(first);samples=[public_get(first)]
 with ThreadPoolExecutor(max_workers=4) as pool:
  futures={pool.submit(transfer,o):o for o in plan['objects'][1:]}
  for future in as_completed(futures):
   item=futures[future]
   try:future.result()
   except Exception as error:
    stop.set();code=error.response.get('Error',{}).get('Code') if isinstance(error,ClientError) else type(error).__name__
    with lock:state['failures'].append({'key':item['key'],'code':code});save(state_path,state)
   if len(state['verified'])%100==0:print(json.dumps({'verified':len(state['verified']),'total':len(plan['objects'])}),flush=True)
 if state['failures']:raise RuntimeError('Upload stopped; inspect sanitized checkpoint failures')
 assert len(state['verified'])==len(plan['objects'])
 stride=max(1,len(plan['objects'])//12)
 for item in plan['objects'][stride::stride]:samples.append(public_get(item))
 save(WORK/'public-checks.json',samples)
 mapping={'schema':1,'public_base':BASE,'assets':{o['local']:{'url':o['url'],'sha256':o['sha256'],'bytes':o['bytes']} for o in plan['objects']}}
 save(WORK/'verified-url-map.json',mapping)
 save(WORK/'upload-result.json',{'verified_objects':len(state['verified']),'stored_bytes':plan['bytes'],'s3_requests_including_reported_retries':state['requests'],'payload_bytes_attempted':state['payload_bytes_attempted'],'public_get_checks':len(samples),'held_local':len(plan['held']),'elapsed_seconds_this_run':round(time.monotonic()-start,2),'public_bucket':BUCKET})
 print(json.dumps(read(WORK/'upload-result.json')))
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['prepare','upload'])
 parser.add_argument('--batch',help='Only this active preview batch; requires its source-evidence review')
 parser.add_argument('--review',type=Path,help='Local include/hold decisions keyed by canonical local asset')
 parser.add_argument('--work-dir',type=Path,help='New versioned checkpoint directory under data/')
 args=parser.parse_args();BATCH=args.batch;REVIEW=args.review.resolve() if args.review else None
 if BATCH:assert REVIEW and REVIEW.is_file(),'A batch requires an explicit hosting review'
 if args.work_dir:
  WORK=args.work_dir.resolve();assert WORK.is_relative_to((ROOT/'data').resolve()),'Checkpoints must remain under private data/'
 prepare() if args.command=='prepare' else upload()
