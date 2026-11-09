"""Move legacy photo batches into stable UID directories without re-encoding.

Run once from any directory: python maintenance/organize_dive_site_photos.py
Keep active assignments and image bytes; discard superseded batch manifests/notes.
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'assets/dive-sites'
UID = r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}'


def organize():
    combined = BASE / 'reviewed-discovery/combined-assignments.json'
    if not combined.exists():
        raise ValueError('Legacy combined manifest missing; migration already applied or inputs unavailable')
    batches = sorted(p for p in BASE.iterdir() if p.is_dir() and p.name.startswith('reviewed'))
    moves = {}
    claimed = {}
    obsolete = []

    def register(source, target):
        source = source.resolve(); target = target.resolve()
        if not source.is_relative_to(BASE.resolve()) or not target.is_relative_to(BASE.resolve()):
            raise ValueError('Photo move escaped assets/dive-sites')
        if source in moves:
            return
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if target in claimed or target.exists():
            # Preserve older compositions rather than overwriting the active hero.
            target = target.with_name(target.stem + '-' + digest[:16] + target.suffix)
        if target in claimed or target.exists():
            raise ValueError(f'Conflicting destination: {target}')
        moves[source] = target; claimed[target] = digest

    manifests = [combined] + [p for batch in batches for p in sorted(batch.glob('*.json')) if p != combined]
    for manifest in manifests:
        for entry in json.loads(manifest.read_text(encoding='utf-8')):
            sid = entry['site_id']
            if not re.fullmatch(UID, sid):
                raise ValueError(f'Invalid site UID: {sid}')
            for role in ('desktop', 'mobile'):
                if entry.get(role):
                    source = ROOT / entry[role].lstrip('/')
                    register(source, BASE / sid / (role + source.suffix))
    for batch in batches:
        for source in sorted(batch.glob('*.jpg')):
            if source.resolve() in moves:
                continue
            match = re.fullmatch('(' + UID + r')-(.+)\.jpg', source.name)
            if not match:
                raise ValueError(f'Photo has no UID mapping: {source}')
            register(source, BASE / match[1] / (match[2] + '.jpg'))
    for batch in batches:
        for source in batch.iterdir():
            if source.resolve() in moves:
                continue
            if source == combined:
                register(source, BASE / 'assignments.json')
            elif source.name == 'images.css':
                register(source, BASE / 'images.css')
            elif source.suffix in ('.json', '.md'):
                obsolete.append(source.resolve())
            else:
                raise ValueError(f'Unclassified batch file: {source}')
    replacements = {
        '/' + source.relative_to(ROOT).as_posix(): '/' + target.relative_to(ROOT).as_posix()
        for source, target in moves.items()
    }
    # All mapping and collision checks precede the first filesystem mutation.
    for source, target in moves.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        source.rename(target)
        if hashlib.sha256(target.read_bytes()).hexdigest() != claimed[target]:
            raise ValueError(f'Content changed during move: {target}')
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    texts = {ROOT / p for p in tracked if p and Path(p).suffix in ('.js', '.json', '.html', '.css', '.md', '.py') and not p.startswith(('dive-sites/', 'regions/'))}
    texts.update(target for target in moves.values() if target.suffix in ('.json', '.md', '.css'))
    for path in sorted(texts):
        if not path.is_file() or path.resolve() == Path(__file__).resolve():
            continue
        before = path.read_text(encoding='utf-8')
        # One-pass substitution avoids rewriting a new destination a second time.
        after = re.sub(r'/?assets/dive-sites/reviewed[^\s\"\'<>`)*;,?]*',
                       lambda m: replacements.get('/' + m[0].lstrip('/'), '/' + m[0].lstrip('/'))[0 if m[0].startswith('/') else 1:], before)
        if after != before:
            path.write_text(after, encoding='utf-8')
    for source in obsolete:
        if not source.is_relative_to(BASE.resolve()):
            raise ValueError('Obsolete metadata escaped assets/dive-sites')
        source.unlink()
    for batch in batches:
        batch.rmdir()
    print(json.dumps({'moved_files': len(moves), 'photos': sum(p.suffix == '.jpg' for p in moves), 'image_bytes_preserved': True}))


if __name__ == '__main__':
    organize()
