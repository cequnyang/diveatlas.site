"""Build shared-photo preview metadata without creating image derivatives.

Usage: python maintenance/build_reviewed_site_photo_catalog.py
Requires existing reviewed hero assignments/assets; no network access.
"""
from pathlib import Path
import json
import re
import sys
from photo_assignment_publication import public_assignment

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.refresh_detail_photos import refresh
from tools.photo_asset_urls import photo_asset_url, photo_asset_available, photo_asset_size, write_browser_photo_map
from build_photo_site_directory import build as build_directory
ASSETS = ROOT / 'assets/dive-sites'


def build():
    write_browser_photo_map(ROOT)
    assignments = json.loads((ASSETS / 'assignments.json').read_text(encoding='utf-8'))
    catalog = []
    seen = set()
    for entry in assignments:
        if public_assignment(entry) != entry:
            raise ValueError('Private evidence paths belong in local review records, not published assignments')
        site_id = entry['site_id']
        if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', site_id) or site_id in seen:
            raise ValueError(f'Invalid or duplicate stable site UUID: {site_id}')
        seen.add(site_id)
        page = ROOT / 'dive-sites' / entry['slug'] / 'index.html'
        if f'data-site-id="{site_id}"' not in page.read_text(encoding='utf-8'):
            raise ValueError(f'Published permalink does not identify {site_id}')
        source = (ROOT / entry['hero'].lstrip('/')).resolve()
        # Several explicitly assigned records can share identical bytes. Storage
        # ownership does not imply a new geographic match or shared attribution.
        if not source.is_relative_to(ASSETS.resolve()) or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', source.parent.name):
            raise ValueError(f'Unexpected reviewed asset path: {source}')
        if not photo_asset_available(ROOT,entry['hero']):
            raise ValueError(f'Missing shared hero: {source}')
        creator, licence = entry['creator'], entry['licence']
        label = '' if entry.get('hide_context_label') else entry['label']
        links = [
            {'label': 'Source', 'url': entry['source_page']},
            {'label': licence, 'url': entry['licence_url']},
        ]
        for item in entry.get('creator_links', []):
            if item not in links:
                links.insert(0, item)
        if 'Diego Delso' in creator and not any(item['url'] == 'http://delso.photo' for item in links):
            links.insert(0, {'label': 'delso.photo', 'url': 'http://delso.photo'})
        photo = {
            'siteId': site_id, 'slug': entry['slug'],
            'src': photo_asset_url(ROOT, entry['hero']), 'fullSrc': photo_asset_url(ROOT, entry['hero']),
            'originalSha256': entry.get('original_sha256'),
            'alt': entry.get('alt', entry['name'] + ' — ' + label.lower() + ', as described by the source.'),
            'label': label, 'credit': (f'{label} · ' if label else '') + f'{creator} · {licence} · Cropped/resized',
            'creator': creator, 'license': licence, 'source': 'reviewed-context',
            'sourcePage': entry['source_page'], 'licenceUrl': entry['licence_url'], 'links': links,
            'locationConfidence': 'source-supported; not independently verified',
            'publication': 'NOT_AUTHORIZED',
        }
        if entry.get('attribution_detail'):
            photo['attributionDetail'] = entry['attribution_detail']
        additional = entry.get('additional_photos', [])
        if additional:
            # The first option always remains the current hero. Extra images
            # are preview choices, never replacements for cards or map markers.
            options = [dict(photo)]
            seen_sources = {entry['hero']}
            for item in additional:
                if public_assignment(item) != item:
                    raise ValueError('Private paths in additional-photo metadata')
                src = item['src']
                image_path = (ROOT / src.lstrip('/')).resolve()
                if not image_path.is_relative_to(ASSETS.resolve()) or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', image_path.parent.name) or not photo_asset_available(ROOT,src):
                    raise ValueError(f'Additional photo is missing or outside its UID: {src}')
                if src in seen_sources:
                    raise ValueError(f'Duplicate gallery image for {site_id}: {src}')
                seen_sources.add(src)
                extra_links = list(item.get('creator_links', [])) + [
                    {'label': 'Source', 'url': item['source_page']},
                    {'label': item['licence'], 'url': item['licence_url']},
                ]
                options.append({
                    'src': photo_asset_url(ROOT, src), 'fullSrc': photo_asset_url(ROOT, src), 'alt': item['alt'],
                    'creator': item['creator'], 'license': item['licence'],
                    'sourcePage': item['source_page'], 'licenceUrl': item['licence_url'],
                    'links': extra_links, 'label': item.get('label', ''),
                    'role': item.get('role', 'additional'),
                    'credit': item['creator'] + ' · ' + item['licence'] + ' · Resized',
                    **({'attributionDetail': item['attribution_detail']} if item.get('attribution_detail') else {}),
                })
            photo['photos'] = options
        catalog.append(photo)
    # This separate catalog must not enter DIVE_SITE_PHOTOS: that registry
    # asserts personal ownership and exact-site confidence, unlike context views.
    output = ROOT / 'js/dive-site-reviewed-photo-catalog.js'
    output.write_text('// Generated by maintenance/build_reviewed_site_photo_catalog.py; UUID-bound hero assignments.\n'
                      + 'export const reviewedPhotos = ' + json.dumps(catalog, ensure_ascii=False, indent=2) + ';\n',
                      encoding='utf-8')
    # The runtime catalog and first-render outputs must advance together.
    # Otherwise newly assigned photos flash an old illustration on arrival.
    refreshed = refresh()
    build_directory()
    print(json.dumps({'sites': len(catalog), 'detail_refresh': refreshed, 'shared_image_bytes': sum(photo_asset_size(ROOT,item['hero']) for item in assignments)}))


if __name__ == '__main__':
    build()
