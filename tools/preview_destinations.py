"""Regenerate destination landing pages only; preserve site pages and pagination.

python -m tools.preview_destinations
node tools/render_destination_map.cjs --all
python -m tools.preview_destinations
"""
import json
from pathlib import Path
from . import generate_seo_pages as seo
from .destination_overview import destination_map_key


def main():
    fallback_base, fallbacks = seo.load_fallback_photos()
    candidates, _ = seo.validated_candidates(seo.load_rows(), seo.load_photos(), seo.load_summaries(), fallback_base, fallbacks)
    groups = seo.destination_groups(candidates)
    photos = seo.load_destination_photos(groups)
    jobs = []
    for group in groups:
        _, content = seo.generate_region_page(group, groups, photos[group['path']])
        target = seo.ROOT / group['path'].lstrip('/') / 'index.html'
        target.parent.mkdir(parents=True, exist_ok=True)
        seo.write_page(target, content)
        jobs.append({'key':destination_map_key(group['path']), 'name':group['region'], 'path':group['path'],
                     'sites':[{'lat':site['lat'], 'lon':site['lon']} for site in group['sites']]})
    output = seo.ROOT / 'artifacts/destination-layout-rollout-20261111'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'map-jobs.json').write_text(json.dumps(jobs,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Updated {len(groups)} destination landing pages; queued {len(jobs)} static map views.')


if __name__ == '__main__':
    main()
