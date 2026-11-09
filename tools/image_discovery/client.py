"""Durable, bounded Commons metadata client. Search endpoints remain denied."""
import datetime,email.utils,hashlib,json,time,urllib.error,urllib.parse,urllib.request
import rep
from common import H,now,load,key
from store import control,set_control
from policy_probe import UA,NoRedirect
rep.UA=UA

class Blocked(Exception):pass
class Deferred(Exception):pass

class Client:
 def __init__(self,db,plan,send=None,sleep=time.sleep,clock=time.monotonic):
  self.db=db;self.plan=plan;self.budget=plan['budget'];self.send=send or self.transport;self.sleep=sleep;self.clock=clock;self.start=clock();self.last=0;self.rules={};self.memory={};self.allowed_files=set();self.allowed_originals={};self.halted=control(db,'halted_hosts',{});self.categories={r['url'] for r in plan['category_routes']}
 def log(self,value):
  with (H/'requests.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps({'recorded_at':now(),**value})+'\n')
 def policy(self,url,robots=False):
  p=urllib.parse.urlsplit(url);host=p.hostname or ''
  if p.scheme!='https' or p.username or p.password or p.port not in (None,443) or p.fragment or host.endswith('.') or any(ord(c)<33 for c in url):raise Blocked('invalid/ambiguous authority or URL')
  if host not in ('commons.wikimedia.org','upload.wikimedia.org'):raise Blocked('unreviewed/denied provider; no alternate route')
  decoded=p.path
  for _ in range(4):decoded=urllib.parse.unquote(decoded)
  if '%' in decoded or '\\' in decoded or any(ord(c)<32 for c in decoded) or any(part in ('.','..') for part in decoded.split('/')):raise Blocked('ambiguous encoded path')
  if host in self.halted:raise Blocked('persisted provider circuit: '+str(self.halted[host]))
  if robots and p.path=='/robots.txt' and not p.query:return host
  if url in self.categories and not p.query and p.path.startswith('/wiki/Category:'):return host
  if url in self.allowed_files and not p.query and p.path.startswith('/wiki/File:'):return host
  if url in self.allowed_originals and host=='upload.wikimedia.org':return host
  raise Blocked('target outside current declared category/file/original route; API/search never granted')
 def halt(self,host,reason):self.halted[host]=reason;set_control(self.db,'halted_hosts',self.halted)
 def transport(self,url,headers):
  limit=self.budget['maximum_original_bytes'] if url in self.allowed_originals else self.budget['maximum_metadata_body_bytes']
  request=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Encoding':'identity',**headers})
  try:response=urllib.request.build_opener(NoRedirect()).open(request,timeout=self.budget['request_timeout_seconds'])
  except urllib.error.HTTPError as error:response=error
  with response:
   body=response.read(limit+1)
   if len(body)>limit:raise Blocked('response size cap exceeded')
   return response.code,{k.lower():v for k,v in response.headers.items()},body
 def remaining(self):return self.budget['maximum_active_seconds']-control(self.db,'active_seconds',0)-(self.clock()-self.start)
 def original_bytes(self):
  return self.db.execute("SELECT coalesce(sum(coalesce(bytes,?)),0) FROM requests WHERE purpose='original'",(self.budget['maximum_original_bytes']+1,)).fetchone()[0]
 def dispatch(self,url,purpose,headers=None):
  host=self.policy(url,robots=purpose=='robots');count=control(self.db,'operational_request_count',0)
  if count>=self.budget['maximum_operational_http_requests_including_robots_retries_assets'] or self.remaining()<20:raise Deferred('frozen request/time budget exhausted; no new dispatch')
  # Reserve the transport's full read cap, including its overflow sentinel. Unknown
  # transfers keep this charge after a crash/error; approximate metadata is no cap.
  reservation=self.budget['maximum_original_bytes']+1 if purpose=='original' else 0
  if reservation and self.original_bytes()+reservation>self.budget['maximum_original_total_bytes']:raise Deferred('original total-byte budget exhausted; no new dispatch')
  self.sleep(max(0,self.budget['minimum_spacing_seconds']-(self.clock()-self.last)));set_control(self.db,'operational_request_count',count+1)
  previous=self.db.execute('SELECT count(*) FROM requests WHERE url=?',(url,)).fetchone()[0]
  self.db.execute('INSERT INTO requests(url,purpose,attempt,started_at,bytes) VALUES(?,?,?,?,?)',(url,purpose,previous+1,now(),reservation));rid=self.db.execute('SELECT last_insert_rowid()').fetchone()[0];self.db.commit();start=self.clock()
  try:
   status,response_headers,body=self.send(url,headers or {})
   self.db.execute('UPDATE requests SET bytes=? WHERE request_id=?',(len(body),rid));self.db.commit()
   if len(body)>(self.budget['maximum_original_bytes'] if url in self.allowed_originals else self.budget['maximum_metadata_body_bytes']):raise Blocked('response size cap exceeded')
   digest=hashlib.sha256(body).hexdigest();record={'kind':'HTTP','phase':'operational','url':url,'purpose':purpose,'status':status,'bytes':len(body),'sha256':digest,'elapsed_seconds':self.clock()-start,'cache_control':response_headers.get('cache-control')}
   self.db.execute('UPDATE requests SET status=?,bytes=?,detail=? WHERE request_id=?',(str(status),len(body),json.dumps(record),rid));self.db.commit();self.log(record)
   if status in (401,403,429):self.halt(host,'HTTP '+str(status)+'; no retry')
   return status,response_headers,body
  except Exception as error:
   self.db.execute('UPDATE requests SET status=?,detail=? WHERE request_id=?',('transport_failed',str(error),rid));self.db.commit();self.log({'kind':'HTTP','phase':'operational','url':url,'purpose':purpose,'status':'transport_failed','error':str(error),'elapsed_seconds':self.clock()-start});raise
  finally:self.last=self.clock()
 def robots(self,host):
  if host in self.rules:return self.rules[host]
  try:
   status,headers,body=self.dispatch('https://'+host+'/robots.txt','robots')
   if status!=200 or b'<html' in body.lower():raise Blocked('robots unavailable/redirected; fail closed')
   rules=rep.Robots(body.decode('utf-8-sig'));self.budget['minimum_spacing_seconds']=max(self.budget['minimum_spacing_seconds'],rules.delay);self.rules[host]=rules;return rules
  except Deferred:raise
  except Exception as error:self.halt(host,'uncertain robots: '+str(error));raise Blocked('robots uncertain; provider stopped') from error
 def get(self,url,asset=False):
  if url in self.memory:raise Blocked('URL already processed this run; reuse parsed facts instead of another dispatch')
  host=self.policy(url)
  if not self.robots(host).permits(url):raise Blocked('current robots denies target; no request sent')
  history=control(self.db,'http_cache',{});cached=history.get(url);headers={}
  if cached:
   if cached.get('etag'):headers['If-None-Match']=cached['etag']
   elif cached.get('last_modified'):headers['If-Modified-Since']=cached['last_modified']
  attempts=self.db.execute('SELECT count(*) FROM requests WHERE url=?',(url,)).fetchone()[0]
  if attempts>=2:raise Blocked('persistent URL retry cap reached')
  while attempts<2:
   attempts+=1
   try:status,received,body=self.dispatch(url,'original' if asset else 'metadata',headers)
   except (Blocked,Deferred):raise
   except Exception:
    status,received,body=503,{},b''
   if status in (301,302,303,307,308):self.halt(host,'redirect requires separate review; not followed');raise Blocked('redirect not followed; no alternate resource')
   if status in (401,403,429):raise Blocked('provider stopped after access/rate denial')
   if status in (502,503,504):
    retries=control(self.db,'retry_count',0)
    if attempts>=2 or retries>=2:raise Deferred('transient failure retained; retry budget consumed')
    delay=2.0
    if received.get('retry-after'):
     try:delay=max(delay,float(received['retry-after']))
     except ValueError:
      try:delay=max(delay,email.utils.parsedate_to_datetime(received['retry-after']).timestamp()-datetime.datetime.now(datetime.timezone.utc).timestamp())
      except Exception:raise Deferred('unparseable Retry-After; do not guess')
    if delay>self.remaining()-20 or delay>30:raise Deferred('Retry-After exceeds remaining bounded run; no retry dispatched')
    set_control(self.db,'retry_count',retries+1);self.sleep(delay);continue
   if status==304:
    if not cached or not (H/'cache'/cached['sha256']).exists():raise Blocked('304 without permitted stored body')
    body=(H/'cache'/cached['sha256']).read_bytes()
   elif status!=200:raise Blocked('HTTP '+str(status)+'; no replacement/retry')
   if not self.robots(host).permits(url):raise Blocked('post-response robots recheck denied')
   if status==200 and 'no-store' not in received.get('cache-control','').lower():
    digest=hashlib.sha256(body).hexdigest();(H/'cache'/digest).write_bytes(body);history[url]={'sha256':digest,'etag':received.get('etag'),'last_modified':received.get('last-modified'),'cache_control':received.get('cache-control'),'checked_at':now()};set_control(self.db,'http_cache',history)
   if asset and 'no-store' in received.get('cache-control','').lower():raise Blocked('asset no-store response; not retained or redistributed')
   self.memory[url]=True;return body,'conditional current' if status==304 else 'current fetched'
  raise Deferred('retry limit')
 def close(self):set_control(self.db,'active_seconds',control(self.db,'active_seconds',0)+(self.clock()-self.start))
