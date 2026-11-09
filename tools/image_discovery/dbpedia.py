"""Public DBpedia entity-image discovery; no Wikimedia API/Special dispatch.

This provider's robots/official endpoint policy is evaluated independently.
Images retain their individual original-source licences, not DBpedia's data licence.
"""
import hashlib,json,time,urllib.parse,urllib.request,urllib.error
import rep
from common import now
from store import control,set_control
from policy_probe import UA,NoRedirect

ENDPOINT='https://dbpedia.org/sparql'
def build_query(labels):
    values=' '.join(json.dumps(s,ensure_ascii=False)+'@en' for s in dict.fromkeys(labels))
    return ('PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX dbo: <http://dbpedia.org/ontology/> PREFIX foaf: <http://xmlns.com/foaf/0.1/> PREFIX geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> '
        +'SELECT DISTINCT ?entity ?label ?image ?lat ?lon ?article ?country WHERE { VALUES ?wanted { '+values+' } ?candidate rdfs:label ?wanted . OPTIONAL { ?candidate dbo:wikiPageRedirects ?target } BIND(COALESCE(?target,?candidate) AS ?entity) ?entity rdfs:label ?label . FILTER(lang(?label)="en") ?entity (foaf:depiction|dbo:thumbnail) ?image . OPTIONAL {?entity geo:lat ?lat; geo:long ?lon} OPTIONAL {?entity foaf:isPrimaryTopicOf ?article} OPTIONAL {?entity dbo:country ?country} } LIMIT 10')

def commons_file_page(image):
    # Parse an indexed filename; never request Special:FilePath or thumbnail endpoints.
    p=urllib.parse.urlsplit(image)
    if p.hostname!='commons.wikimedia.org' or not p.path.startswith('/wiki/Special:FilePath/'):return None
    name=urllib.parse.unquote(p.path.split('/wiki/Special:FilePath/',1)[1])
    if not name or '/' in name or '\\' in name or any(ord(c)<32 for c in name):return None
    return 'https://commons.wikimedia.org/wiki/File:'+urllib.parse.quote(name,safe="_:,()-.!'")

class EntitySearch:
    def __init__(self,db,run_dir,budget,send=None,sleep=time.sleep):
        self.db=db;self.h=run_dir;self.budget=budget;self.send=send or self.transport;self.sleep=sleep;self.last=0;self.rules=None;self.allowed_queries=set();self.spacing=2
    def transport(self,url):
        request=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'application/sparql-results+json, text/plain;q=0.8','Accept-Encoding':'identity'})
        try:r=urllib.request.build_opener(NoRedirect()).open(request,timeout=20)
        except urllib.error.HTTPError as e:r=e
        with r:
            body=r.read(2000001)
            if len(body)>2000000:raise ValueError('DBpedia2MB cap')
            return r.status,{k.lower():v for k,v in r.headers.items()},body
    def get(self,url,robots=False):
        p=urllib.parse.urlsplit(url)
        if p.scheme!='https' or p.netloc!='dbpedia.org' or p.fragment or p.path!=('/robots.txt' if robots else '/sparql'):raise ValueError('Not approved DBpedia endpoint')
        if control(self.db,'dbpedia_halted',False):raise ValueError('DBpedia circuit halted; do not retry/bypass')
        if control(self.db,'operational_request_count',0)>=self.budget['maximum_operational_requests_including_robots_assets']:raise ValueError('Frozen HTTP budget exhausted')
        if not robots:
            if url not in self.allowed_queries:raise ValueError('Unregistered query; only generated entity searches allowed')
            if self.rules is None:raise ValueError('Current robots required before query')
            if not self.rules.permits(url):raise ValueError('DBpedia robots denies exact query; no dispatch')
            if control(self.db,'dbpedia_search_count',0)>=self.budget['maximum_search_requests']:raise ValueError('Frozen search budget exhausted')
            set_control(self.db,'dbpedia_search_count',control(self.db,'dbpedia_search_count',0)+1)
        self.sleep(max(0,self.spacing-(time.monotonic()-self.last)))
        set_control(self.db,'operational_request_count',control(self.db,'operational_request_count',0)+1)
        record={'recorded_at':now(),'provider':'DBpedia','url':url,'purpose':'robots' if robots else 'entity_image_query'}
        try:
            status,headers,body=self.send(url);record.update(status=status,bytes=len(body),sha256=hashlib.sha256(body).hexdigest(),headers=headers)
            if status in [301,302,303,307,308,401,403,429]:set_control(self.db,'dbpedia_halted',True);raise ValueError('DBpedia denied/redirected; no follow or retry')
            if status!=200:
                record['error_body_excerpt']=body[:1000].decode('utf-8','replace')
                raise ValueError('DBpedia unavailable; no retry this evaluation')
            if robots:
                if b'<html' in body.lower():raise ValueError('Robots response is HTML, not policy')
                self.rules=rep.Robots(body.decode('utf-8-sig'));self.spacing=max(2,self.rules.delay)
            elif not self.rules.permits(url):raise ValueError('Post-response robots check denied')
            if 'no-store' not in headers.get('cache-control','').lower():(self.h/'cache'/record['sha256']).write_bytes(body)
            partial=('x-sparql-maxrows' in headers or headers.get('x-sql-state','00000')!='00000')
            return body,{'partial':partial,'headers':headers,'sha256':record['sha256']}
        except Exception as error:
            record['error']=str(error)
            if robots:set_control(self.db,'dbpedia_halted',True)
            raise
        finally:
            self.last=time.monotonic()
            with (self.h/'requests.jsonl').open('a',encoding='utf8') as f:f.write(json.dumps(record,ensure_ascii=False)+'\n')
    def search(self,labels):
        if self.rules is None:self.get('https://dbpedia.org/robots.txt',robots=True)
        query=build_query(labels);url=ENDPOINT+'?'+urllib.parse.urlencode({'query':query,'format':'application/sparql-results+json','timeout':'15000'})
        self.allowed_queries.add(url)
        body,evidence=self.get(url);return json.loads(body)['results']['bindings'],{'query':query,'url':url,**evidence}
