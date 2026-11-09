"""Local metadata queue; unique stable IDs and file keys prevent replay inflation."""
import json,sqlite3,unicodedata,urllib.parse
from common import H,now,key

def file_key(url):
 p=urllib.parse.urlsplit(url or '')
 if p.hostname=='commons.wikimedia.org' and p.path.startswith('/wiki/File:'):
  return 'commons:'+unicodedata.normalize('NFC',urllib.parse.unquote(p.path[len('/wiki/File:'):]).replace('_',' '))
 return 'legacy:'+key(url or 'unresolved')

def connect(path=None):
 db=sqlite3.connect(path or H/'private-audit/queue.sqlite');db.row_factory=sqlite3.Row;db.execute('PRAGMA foreign_keys=ON')
 db.executescript('''
 CREATE TABLE IF NOT EXISTS requests(request_id INTEGER PRIMARY KEY AUTOINCREMENT,url TEXT NOT NULL,purpose TEXT,attempt INTEGER,started_at TEXT,status TEXT,bytes INTEGER,detail TEXT);
 CREATE TABLE IF NOT EXISTS control(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 ''');return db

def control(db,name,default=None):
 row=db.execute('SELECT value FROM control WHERE key=?',(name,)).fetchone();return json.loads(row[0]) if row else default
def set_control(db,name,value):db.execute('INSERT OR REPLACE INTO control VALUES(?,?)',(name,json.dumps(value)));db.commit()
