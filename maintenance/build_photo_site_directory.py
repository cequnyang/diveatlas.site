"""Build the local assigned-photo directory: python maintenance/build_photo_site_directory.py."""

import html
import json
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.detail_photo_data import load_detail_photos


def build():
    photos = load_detail_photos(ROOT)
    assignments = json.loads((ROOT / "assets/dive-sites/assignments.json").read_text(encoding="utf-8"))
    entries = sorted((entry for entry in assignments if entry["site_id"] in photos),
                     key=lambda entry: (entry.get("country", "").casefold(), entry["name"].casefold()))
    esc = html.escape
    cards = []
    for entry in entries:
        photo = photos[entry["site_id"]]
        static_url = f'dive-sites/{quote(entry["slug"])}/'
        shared_url = f'dive-site.html?id={entry["site_id"]}'
        creator_links = "".join(f' · <a href="{esc(link["url"])}" rel="noreferrer">{esc(link["label"])}</a>' for link in photo["creator_links"])
        cards.append(f'''<article class="card" data-country="{esc(entry.get('country', ''))}">
<a class="thumbnail" href="{static_url}" tabindex="-1" aria-hidden="true"><img src="{esc(photo['src'].lstrip('/'))}" alt="{esc(photo['alt'])}" loading="lazy" width="640" height="400"></a>
<div class="content"><p class="country">{esc(entry.get('country', ''))}</p><h2>{esc(entry['name'])}</h2>
<nav aria-label="Detail pages for {esc(entry['name'])}"><a href="{static_url}">Static detail ↗</a><a href="{shared_url}">Shared detail ↗</a></nav>
<p class="credit">{esc(photo['credit'])}{creator_links} · <a href="{esc(photo['source_page'])}" rel="noreferrer">Source</a> · <a href="{esc(photo['licence_url'])}" rel="noreferrer">{esc(photo['licence'])}</a> · Cropped/resized</p></div></article>''')
    countries = sorted({entry.get("country", "") for entry in entries if entry.get("country")})
    options = "".join(f'<option>{esc(country)}</option>' for country in countries)
    template = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>DiveAtlas · Sites with assigned photos</title>
<style>
:root{color-scheme:light;--blue:#3569db;--ink:#142d3c}*{box-sizing:border-box}body{margin:0;background:#f4f7fa;color:var(--ink);font:16px/1.5 system-ui,sans-serif}header,main{max-width:1440px;margin:auto;padding:32px}header{padding-bottom:12px}.brand{font-weight:800;color:var(--blue);font-size:22px;text-decoration:none}h1{font-size:clamp(30px,5vw,52px);line-height:1.12;margin:24px 0 16px;letter-spacing:-.035em}.intro{max-width:780px;color:#526575}.filters{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0 12px}label{display:grid;gap:6px;font-size:14px;font-weight:600}.search{flex:1;min-width:220px}input,select{font:inherit;padding:12px;border:1px solid #bdcad5;border-radius:10px;background:white;color:inherit;min-height:48px}select{max-width:100%}a{color:#235bc1}a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #ed9d29;outline-offset:3px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr));gap:24px}.card{background:white;border:1px solid #e1e7ee;border-radius:16px;overflow:hidden}.thumbnail{display:block;background:#dce9ef}.thumbnail img{display:block;width:100%;height:auto;aspect-ratio:8/5;object-fit:cover}.content{padding:20px}.country{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#62798a;margin:0 0 6px}h2{font-size:21px;line-height:1.25;margin:0 0 16px;overflow-wrap:anywhere}nav{display:flex;gap:16px;flex-wrap:wrap;font-weight:600;font-size:14px}.credit{font-size:12px;color:#627280;margin:20px 0 0;overflow-wrap:anywhere}.credit a{color:inherit}#count{color:#526575;font-size:14px}[hidden]{display:none!important}@media(max-width:600px){header,main{padding:20px}.filters>*{width:100%}.grid{gap:20px}}
</style></head><body><header><a class="brand" href="index.html">diveAtlas</a><h1>Sites with assigned photos</h1><p class="intro">Browse the __TOTAL__ dive sites using their assigned photo from the first detail-page render. This collection includes underwater, surface and nearby-context photographs.</p><div class="filters"><label class="search">Search sites<input id="search" type="search" placeholder="Site name, country or photographer…"></label><label>Country<select id="country"><option value="">All countries</option>__OPTIONS__</select></label></div><p id="count" role="status" aria-live="polite">__TOTAL__ sites</p></header><main><div class="grid">__CARDS__</div><p id="empty" hidden>No matching sites. Try another name or country.</p></main>
<script>
const search=document.getElementById('search'),country=document.getElementById('country');
const cards=Array.from(document.querySelectorAll('.card'),node=>({node,text:node.textContent.toLocaleLowerCase()}));
function filter(){const query=search.value.trim().toLocaleLowerCase();let count=0;for(const card of cards){const show=(!country.value||card.node.dataset.country===country.value)&&card.text.includes(query);card.node.hidden=!show;if(show)count++;}document.getElementById('count').textContent=`${count} of ${cards.length} sites`;document.getElementById('empty').hidden=count>0;}
search.addEventListener('input',filter);country.addEventListener('change',filter);
</script></body></html>'''
    output = template.replace("__TOTAL__", str(len(entries))).replace("__OPTIONS__", options).replace("__CARDS__", "\n".join(cards))
    (ROOT / "photo-dive-sites.html").write_text(output, encoding="utf-8")
    print(f"Built photo-dive-sites.html with {len(entries)} sites")


if __name__ == "__main__":
    build()
