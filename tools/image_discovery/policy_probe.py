"""Policy bootstrap only: exact official docs and robots, never search endpoints."""
from pathlib import Path
import datetime,hashlib,json,time,urllib.parse,urllib.request,urllib.error
import rep
from common import H
UA='DiveAtlasImageCoverage/0.1 (+https://diveatlas.site; AI-assisted local metadata review)'
rep.UA=UA
DOCS=[
 'https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia',
 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use',
 'https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy']
HOSTS={urllib.parse.urlsplit(u).hostname for u in DOCS}

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def log(value):
 with (H/'requests.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps({'recorded_at':now(),**value})+'\n')

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def fetch(url):
 request=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Encoding':'identity'})
 try:response=urllib.request.build_opener(NoRedirect()).open(request,timeout=20)
 except urllib.error.HTTPError as error:response=error
 with response:
  body=response.read(2_000_001)
  if len(body)>2_000_000:raise ValueError('2 MB policy response cap')
  return response.code,{k.lower():v for k,v in response.headers.items()},body

class Probe:
 def __init__(self,send=fetch,spacing=1.5):self.send=send;self.spacing=spacing;self.robots={};self.halted=set();self.last=0;self.calls=0
 def raw(self,url):
  if self.calls>=16:raise ValueError('policy request budget exhausted')
  time.sleep(max(0,self.spacing-(time.monotonic()-self.last)));start=time.monotonic();self.calls+=1
  try:
   status,headers,body=self.send(url);digest=hashlib.sha256(body).hexdigest()
   log({'kind':'HTTP','phase':'policy bootstrap','url':url,'status':status,'bytes':len(body),'sha256':digest,'cache_control':headers.get('cache-control'),'elapsed_seconds':time.monotonic()-start})
   if 'no-store' not in headers.get('cache-control','').lower():(H/'cache'/digest).write_bytes(body)
   return status,headers,body,digest
  except Exception as error:
   log({'kind':'HTTP','phase':'policy bootstrap','url':url,'status':'transport_failed','error':str(error),'elapsed_seconds':time.monotonic()-start});raise
  finally:self.last=time.monotonic()
 def rules(self,host):
  if host not in HOSTS or host in self.halted:raise ValueError('unapproved or halted policy host')
  if host in self.robots:return self.robots[host]
  try:
   status,headers,body,digest=self.raw('https://'+host+'/robots.txt')
   if status!=200 or b'<html' in body.lower():raise ValueError('robots uncertain/redirected; no follow')
   rules=rep.Robots(body.decode('utf-8-sig'));self.spacing=max(self.spacing,rules.delay);self.robots[host]=rules
   return rules
  except Exception:self.halted.add(host);raise
 def get(self,url):
  if url not in DOCS:raise ValueError('not an approved policy document')
  host=urllib.parse.urlsplit(url).hostname
  if not self.rules(host).permits(url):raise ValueError('robots denies document')
  try:status,headers,body,digest=self.raw(url)
  except Exception:self.halted.add(host);raise
  if status in (301,302,303,307,308,401,403,429):self.halted.add(host)
  if status!=200:raise ValueError('document unavailable; no retry or redirect')
  if not self.rules(host).permits(url):raise ValueError('final rule check denied')
  return digest

def main():
 if (H/'evidence/source-policy-probe.json').exists():raise SystemExit('Existing policy probe retained; do not repeatedly probe.')
 p=Probe();results=[]
 for url in DOCS:
  try:results.append({'url':url,'status':'retrieved','sha256':p.get(url)})
  except Exception as error:results.append({'url':url,'status':'unresolved','reason':str(error)})
 targets=['https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srsearch=Silfra','https://commons.wikimedia.org/w/api.php?action=query&format=json&list=geosearch&gscoord=64.2552%7C-21.117&gsnamespace=6','https://commons.wikimedia.org/wiki/Special:MediaSearch?type=image&search=Silfra','https://commons.wikimedia.org/wiki/Special:Search?search=Silfra','https://commons.wikimedia.org/wiki/Category:Silfra','https://commons.wikimedia.org/wiki/File:SCUBA_Silfra.jpg']
 decisions=[]
 for url in targets:
  try:decisions.append({'url':url,'robots_permits':p.rules('commons.wikimedia.org').permits(url),'endpoint_dispatched':False})
  except Exception as error:decisions.append({'url':url,'robots_permits':False,'reason':str(error),'endpoint_dispatched':False})
 output={'checked_at':now(),'user_agent':UA,'documents':results,'target_rule_checks_only':decisions,'http_requests':p.calls,'limits':'Robots bootstrap and exact official documents only. No API/search endpoint request sent. Openverse/Flickr not investigated or contacted.'}
 (H/'evidence/source-policy-probe.json').write_text(json.dumps(output,indent=2),encoding='utf-8');print(json.dumps(output))

if __name__=='__main__':main()
