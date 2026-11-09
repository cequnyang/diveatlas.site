"""Bounded REP evaluator extracted unchanged from the audited v4 closeout guard.

Only this parser is reused; no historical host/API permissions are imported.
Uncertain syntax fails closed. This is not a certified REP implementation.
"""
import re,urllib.parse
UA="DiveAtlasImageCoverage/0.1 (+https://diveatlas.site; AI-assisted local metadata review)"
class Blocked(Exception):pass
class Robots:
 """Bounded REP evaluator: longest agent/rule match, wildcard and end anchor.

 Unsupported pacing syntax fails closed rather than silently ignoring limits.
 This deliberately does not infer permission from missing/invalid robots.
 """
 def __init__(self,body):
  groups=[];agents=[];rules=[];delays=[];has_rule=False
  for raw in body.splitlines():
   line=raw.split('#',1)[0].strip()
   if not line:continue
   if ':' not in line:raise Blocked('unparseable robots line')
   key,value=(x.strip() for x in line.split(':',1));key=key.lower()
   if key=='user-agent':
    if has_rule:groups.append((agents,rules,delays));agents=[];rules=[];delays=[];has_rule=False
    if not value:raise Blocked('empty robots agent')
    agents.append(value.lower())
   elif key in ('allow','disallow','crawl-delay','request-rate'):
    if not agents:raise Blocked('robots directive before agent')
    has_rule=True
    if key in ('allow','disallow'):rules.append((key,value))
    else:
     try:
      if key=='crawl-delay':delay=float(value)
      else:
       count,seconds=map(int,value.split('/'));delay=seconds/count
      if not 0<=delay<=3600:raise ValueError()
      delays.append(delay)
     except (ValueError,ZeroDivisionError):raise Blocked('unsupported robots pacing syntax')
   elif key not in ('sitemap','host','clean-param','noindex','nofollow'):raise Blocked('unknown robots directive')
  if agents:groups.append((agents,rules,delays))
  product=UA.split('/',1)[0].lower();ranked=[]
  for agents,rules,delays in groups:
   scores=[0 if a=='*' else len(a) for a in agents if a=='*' or a in product]
   if scores:ranked.append((max(scores),rules,delays))
  if not ranked:raise Blocked('no applicable robots group; permission uncertain')
  score=max(g[0] for g in ranked)
  self.rules=[rule for rank,rules,delays in ranked if rank==score for rule in rules]
  self.delay=max([d for rank,rules,delays in ranked if rank==score for d in delays] or [0])
 def permits(self,url):
  p=urllib.parse.urlsplit(url);target=urllib.parse.unquote(p.path or '/')+('?' + urllib.parse.unquote(p.query) if p.query else '')
  matches=[]
  for kind,path in self.rules:
   if not path:continue
   pattern=urllib.parse.unquote(path);anchor=pattern.endswith('$')
   if anchor:pattern=pattern[:-1]
   regex='^'+re.escape(pattern).replace(r'\*','.*')+('$' if anchor else '')
   if re.search(regex,target):matches.append((len(pattern.replace('*','')),kind=='allow'))
  return max(matches)[1] if matches else True
