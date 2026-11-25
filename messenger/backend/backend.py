"""M9.3 local-only synthetic review service. No live contacts or sending."""
import json, os, hmac, sqlite3, uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from contextlib import closing
from pathlib import Path

FIELDS = ('id','revision','name','channel','recipient','subject','draft')

def snapshot(row):
    return {k: row[k] for k in FIELDS}

class Store:
    def __init__(self, path):
        self.path = path
        with closing(self.connect()) as db, db:
            db.executescript('''CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, name TEXT NOT NULL, channel TEXT NOT NULL, recipient TEXT NOT NULL, subject TEXT, draft TEXT NOT NULL, state TEXT NOT NULL, suppressed INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS audit(request_id TEXT PRIMARY KEY, item_id TEXT NOT NULL, decision TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL);''')
            for n in range(1,4):
                db.execute('INSERT OR IGNORE INTO queue VALUES(?,?,?,?,?,?,?,?,?)',(f'demo-{n}',0,f'Fictional business {n}','email',f'demo{n}@example.invalid','Demo enquiry','NorthLight Studios synthetic preview. Reply STOP to opt out.','PENDING',0))
    def connect(self):
        db=sqlite3.connect(self.path,timeout=5); db.row_factory=sqlite3.Row; return db
    def next(self, db):
        row=db.execute("SELECT * FROM queue WHERE state='PENDING' AND suppressed=0 AND recipient LIKE '%@example.invalid' AND NOT EXISTS(SELECT 1 FROM queue q WHERE q.recipient=queue.recipient AND q.suppressed=1) ORDER BY id LIMIT 1").fetchone()
        return snapshot(row) if row else None
    def get(self):
        with closing(self.connect()) as db:
            return {'item':self.next(db),'sendAllowed':False,'mode':'synthetic'}
    def decide(self, shown, decision, request_id):
        if not isinstance(shown,dict) or set(shown)!=set(FIELDS) or decision not in ('APPROVE','DISAPPROVE') or not isinstance(request_id,str) or not 1<=len(request_id)<=100:
            return 400,{'status':'INVALID_REQUEST'}
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            prior=db.execute('SELECT * FROM audit WHERE request_id=?',(request_id,)).fetchone()
            if prior:
                if prior['decision']!=decision or json.loads(prior['snapshot'])!=shown: return 409,{'status':'REQUEST_CONFLICT'}
                return 200,{'status':'SAVED','next':self.next(db),'sendAllowed':False}
            current=self.next(db)
            if current is None or shown!=current: return 409,{'status':'STALE_OR_BLOCKED'}
            db.execute('UPDATE queue SET state=?,revision=revision+1 WHERE id=?',('APPROVED' if decision=='APPROVE' else 'DISAPPROVED',shown['id']))
            db.execute('INSERT INTO audit VALUES(?,?,?,?,?)',(request_id,shown['id'],decision,json.dumps(shown),datetime.now(timezone.utc).isoformat()))
            return 200,{'status':'SAVED','next':self.next(db),'sendAllowed':False}
    def counts(self):
        with closing(self.connect()) as db:
            return {**{r['state']:r['n'] for r in db.execute('SELECT state,COUNT(*) n FROM queue GROUP BY state')},'decisions':db.execute('SELECT COUNT(*) FROM audit').fetchone()[0],'sendAllowed':False}

def make_handler(store, token):
    if len(token)<32: raise ValueError('Set a random token of at least 32 characters')
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def reply(self,status,payload):
            body=json.dumps(payload).encode(); self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
        def authorized(self):
            return hmac.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+token).encode())
        def do_GET(self):
            if not self.authorized(): return self.reply(401,{'status':'UNAUTHORIZED'})
            if self.path=='/api/next': return self.reply(200,store.get())
            if self.path=='/api/counts': return self.reply(200,store.counts())
            return self.reply(404,{'status':'NOT_FOUND'})
        def do_POST(self):
            if not self.authorized(): return self.reply(401,{'status':'UNAUTHORIZED'})
            if self.path!='/api/decision': return self.reply(404,{'status':'NOT_FOUND'})
            try:
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=16384: return self.reply(400,{'status':'INVALID_SIZE'})
                data=json.loads(self.rfile.read(size))
                if not isinstance(data,dict): raise ValueError()
                code,result=store.decide(data.get('shown'),data.get('decision'),data.get('requestId'))
                return self.reply(code,result)
            except (ValueError,TypeError): return self.reply(400,{'status':'INVALID_REQUEST'})
            except sqlite3.Error: return self.reply(503,{'status':'STORE_UNAVAILABLE'})
    return Handler

if __name__=='__main__':
    token=os.environ.get('NORTHLIGHT_REVIEW_TOKEN','')
    if len(token)<32: raise SystemExit('Set NORTHLIGHT_REVIEW_TOKEN to a random secret of at least 32 characters.')
    path=Path(os.environ.get('NORTHLIGHT_DEMO_DB',str(Path.home()/'.northlight-demo'/'review.sqlite3')))
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if not path.exists(): path.touch(mode=0o600)
    server=ThreadingHTTPServer(('127.0.0.1',8765),make_handler(Store(path),token)); print('Synthetic review API: http://127.0.0.1:8765 (local only)'); server.serve_forever()
