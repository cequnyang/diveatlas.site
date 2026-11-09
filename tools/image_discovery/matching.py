"""Screening is deliberately weaker than identity or publication approval."""
import math,re,unicodedata,urllib.parse
from bs4 import BeautifulSoup,Comment
def norm(text):return ' '.join(re.findall(r'\w+',unicodedata.normalize('NFKC',str(text or '').replace('_',' ')).casefold()))
def phrase(text,value):return bool(norm(value) and (' '+norm(value)+' ') in (' '+norm(text)+' '))

def canonical_license(url):
 match=re.fullmatch(r'https?://creativecommons\.org/((?:licenses/by(?:-sa)?/(?:1\.0|2\.0|2\.5|3\.0|4\.0)|publicdomain/zero/1\.0))(?:/(?:deed\.[a-zA-Z_-]+)?)?',url or '')
 return 'https://creativecommons.org/'+match.group(1)+'/' if match else None
def compatible_license(url):return canonical_license(url) is not None

def parse_file(body,url):
 soup=BeautifulSoup(body,'html.parser',from_encoding='utf-8')
 for c in soup.find_all(string=lambda x:isinstance(x,Comment)):c.extract()
 def field(identifier):
  n=soup.find(id=identifier);row=n.find_parent('tr') if n else None;cells=row.find_all('td',recursive=False) if row else []
  return cells[-1].get_text(' ',strip=True) if len(cells)>1 else None
 media=soup.select_one('.fullMedia');text=media.get_text(' ',strip=True) if media else '';m=re.search(r'([\d,]+)\s*[×x]\s*([\d,]+)\s*pixels',text)
 dimensions=[int(x.replace(',','')) for x in m.groups()] if m else None
 size=re.search(r'file size:\s*([\d.]+)\s*(bytes|KB|MB)',text,re.I);original_bytes=int(float(size.group(1))*{'bytes':1,'kb':1024,'mb':1024**2}[size.group(2).lower()]) if size else None
 boxes=soup.select('.licensetpl');licences=sorted(set(urllib.parse.urljoin(url,a['href']) for b in boxes for a in b.find_all('a',href=True) if re.match(r'https?://creativecommons.org/(?:licenses|publicdomain)/',urllib.parse.urljoin(url,a['href']))))
 selected_source=next((u for u in licences if compatible_license(u)),None);selected=canonical_license(selected_source)
 original=media.find('a',href=True) if media else None
 geo=soup.select_one('.geo');coordinates=None
 if geo:
  numbers=re.findall(r'-?\d+(?:\.\d+)?',geo.get_text(' ',strip=True))
  if len(numbers)==2:
   values=list(map(float,numbers))
   if -90<=values[0]<=90 and -180<=values[1]<=180:coordinates=values
 title=soup.title.get_text(' ',strip=True).replace(' - Wikimedia Commons','') if soup.title else urllib.parse.unquote(url)
 creator=field('fileinfotpl_aut');description=field('fileinfotpl_desc');source=field('fileinfotpl_src')
 return {'source_page':url,'title':title,'description':description,'creator':creator,'source_credit':source,'licence_options':licences,'selected_licence_url':selected,'selected_licence_source_link':selected_source,'licence_section_text':' '.join(b.get_text(' ',strip=True) for b in boxes),'original_dimensions':dimensions,'dimension_evidence':text,'original_bytes_approx':original_bytes,'original_url':urllib.parse.urljoin(url,original['href']) if original else None,'camera_coordinates':coordinates,'ownership':'not established by licence metadata','required_credit':f'{title} — {creator or "creator unresolved"}; {selected or "licence unresolved"}; {url}. Source credit: {source or "not supplied"}. Preserve attribution and ShareAlike for adaptations where applicable; no endorsement.','extra_credit_link':'http://delso.photo' if 'Diego Delso' in str(creator) else None}

def distance_km(a,b):
 lat1,lon1,lat2,lon2=map(math.radians,[*a,*b]);x=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
 return 6371*2*math.asin(min(1,math.sqrt(x)))

MARINE=('dive','diving','underwater','wreck','reef','coral','lagoon','island','coast','beach','harbour','harbor','winch','fish','shore','pier','sea','bay')
IRRELEVANT=('portrait','road sign','welcome to california','hotel','street','butterfly','disambig','flag of','logo','map of')
