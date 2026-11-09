"""Resolve only verified R2 migrations; assignment identity/credits stay local."""
import json,re,hashlib
from functools import lru_cache

@lru_cache(maxsize=8)
def _manifest(root):
 path=root/'datasets/dive-site-photo-r2.json'
 return json.loads(path.read_text('utf8')) if path.exists() else {}

@lru_cache(maxsize=8)
def _mapping(root):
 manifest=_manifest(root)
 if not manifest.get('enabled',True):return {}
 result={}
 for src,item in manifest.get('assets',{}).items():
  if src in manifest.get('held',{}):continue
  if not src.startswith('/assets/dive-sites/') or '..' in src.split('/'):
   raise ValueError('Invalid local photo asset mapping')
  url=item['url']
  if not re.fullmatch(r'https://assets\.diveatlas\.site/site-photos/v1/[a-f0-9]{64}\.(?:jpg|webp|png)',url) or item['sha256'] not in url:
   raise ValueError('Unexpected R2 photo destination')
  result[src]=url
 return result

def photo_asset_url(root,src):
 key='/'+src.lstrip('/') if isinstance(src,str) and not src.startswith(('https://','http://')) else src
 return _mapping(root).get(key,src)

def migrated_photo_paths(root):
 return frozenset(_mapping(root))

def rollback_photo_files(root):
 """An explicit local-URL rollback can package ignored backups when present."""
 manifest=_manifest(root)
 if manifest.get('enabled',True):return []
 return [src.lstrip('/') for src in manifest.get('assets',{}) if (root/src.lstrip('/')).is_file()]

def photo_asset_available(root,src):
 """A verified remote object is sufficient; ignored backups are optional."""
 return (root/src.lstrip('/')).is_file() or '/'+src.lstrip('/') in _mapping(root)

def photo_asset_size(root,src):
 local=root/src.lstrip('/')
 if local.is_file():return local.stat().st_size
 key='/'+src.lstrip('/')
 if key not in _mapping(root):raise FileNotFoundError(local)
 size=_manifest(root)['assets'][key].get('bytes')
 if not isinstance(size,int) or size<=0:raise ValueError('Missing verified R2 image size')
 return size

def photo_asset_sha256(root,src):
 local=root/src.lstrip('/')
 if local.is_file():return hashlib.sha256(local.read_bytes()).hexdigest()
 key='/'+src.lstrip('/')
 if key not in _mapping(root):raise FileNotFoundError(local)
 return _manifest(root)['assets'][key]['sha256']

def write_storage_ignores(root):
 # Ignore even during a deliberate local-URL rollback: backups are not source.
 keys=sorted(_manifest(root).get('assets',{}))
 for src in keys:
  if not src.startswith('/assets/dive-sites/') or '..' in src.split('/'):
   raise ValueError('Invalid backup ignore path')
 path=root/'assets/dive-sites/.gitignore';path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text('# Generated from datasets/dive-site-photo-r2.json.\n# Verified R2 payloads are optional ignored local backups, not Git source.\n'+''.join(src.removeprefix('/assets/dive-sites')+'\n' for src in keys),'utf8')

def write_browser_photo_map(root):
 write_storage_ignores(root)
 mapping=_mapping(root)
 path=root/'js/dive-site-photo-asset-urls.js';path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text('// Generated from verified R2 mappings; local originals remain for rollback.\nconst urls = '+json.dumps(mapping,ensure_ascii=False,indent=2)+';\nexport function photoAssetUrl(src) {\n  const key = typeof src === "string" && !/^https?:\\/\\//i.test(src) ? "/" + src.replace(/^\\/+/, "") : src;\n  return urls[key] || src;\n}\n','utf8')
