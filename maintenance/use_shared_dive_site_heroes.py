"""Consolidate desktop, mobile and thumbnail derivatives into one shared image.

Usage: python maintenance/use_shared_dive_site_heroes.py
The desktop composition is retained byte-for-byte; no source download is needed.
"""
from pathlib import Path
import json
import re
from photo_assignment_publication import public_assignment

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'assets/dive-sites'


def migrate():
    manifest = BASE / 'assignments.json'
    rows = json.loads(manifest.read_text(encoding='utf-8'))
    moves = []
    obsolete = set()
    urls = {}
    for entry in rows:
        sid = entry['site_id']
        if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', sid):
            raise ValueError('Invalid site UID')
        directory = (BASE / sid).resolve()
        target = directory / 'hero.jpg'
        hero = '/' + target.relative_to(ROOT.resolve()).as_posix()
        if 'hero' in entry:
            if entry['hero'] != hero or not target.is_file():
                raise ValueError(f'Unexpected/missing shared hero: {sid}')
        else:
            directory = (BASE / sid).resolve()
            source = (ROOT / entry['desktop'].lstrip('/')).resolve()
            mobile = (ROOT / entry['mobile'].lstrip('/')).resolve()
            target = directory / 'hero.jpg'
            if source.parent != directory or mobile.parent != directory or not source.is_file() or not mobile.is_file() or target.exists():
                raise ValueError(f'Unexpected/missing source or occupied target: {sid}')
            moves.append((source, target))
            if mobile != source:
                obsolete.add(mobile)
            hero = '/' + target.relative_to(ROOT).as_posix()
            urls[entry.pop('desktop')] = hero
            entry.pop('mobile')
            entry['hero'] = hero
            entry['display_crop'] = 'Browser object-fit: cover, centered within the responsive hero frame.'
            if 'desktop_notice' in entry:
                entry['hero_notice'] = entry.pop('desktop_notice')
            entry.pop('mobile_notice', None)
            if 'crop_boxes' in entry:
                # Keep the retained derivative's source crop evidence, not the removed mobile crop.
                entry['hero_crop_box'] = entry.pop('crop_boxes')['desktop']
        thumbnail = directory / 'thumbnail.jpg'
        if thumbnail.is_file():
            obsolete.add(thumbnail)
        urls['/' + thumbnail.relative_to(ROOT.resolve()).as_posix()] = hero
    if not moves and not obsolete:
        raise ValueError('Shared image migration already applied; refusing to replay')
    catalog = ROOT / 'js/dive-site-reviewed-photo-catalog.js'
    content = catalog.read_text(encoding='utf-8')
    for old, new in urls.items():
        content = content.replace(json.dumps(old), json.dumps(new))
    # Validate every source before moving anything. The only deletions are the
    # redundant mobile files and UID-local thumbnails in the validated site folders.
    rows = [public_assignment(entry) for entry in rows]
    for source, target in moves:
        source.rename(target)
    manifest.write_text(json.dumps(rows, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    catalog.write_text(content, encoding='utf-8')
    for path in obsolete:
        path.unlink()
    print(json.dumps({'shared_heroes': len(moves), 'removed_derivatives': len(obsolete)}))


if __name__ == '__main__':
    migrate()
