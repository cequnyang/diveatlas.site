"""Runtime directory is explicit; frozen pilots are never the write target."""
from pathlib import Path
import datetime,hashlib,json,os
ROOT=Path(__file__).resolve().parents[2]
H=Path(os.environ.get('DIVEATLAS_IMAGE_RUN',str(ROOT/'data/image-discovery-unconfigured'))).resolve()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def load(p):return json.loads(p.read_text(encoding='utf-8'))
def dump(p,x):
 # Replace snapshots atomically so interruption leaves a resumable old or new state.
 p=Path(p);temporary=p.with_suffix(p.suffix+'.tmp');temporary.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');temporary.replace(p)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def key(v):return hashlib.sha256(v.encode('utf-8')).hexdigest()
