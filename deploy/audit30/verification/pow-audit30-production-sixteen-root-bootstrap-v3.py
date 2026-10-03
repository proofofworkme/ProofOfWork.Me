#!/usr/bin/python3 -I -B
"""Proposed exact-source bootstrap; no authority receipt or request is generated.
Execute only this reviewed source with JSON stdin after explicit final human approval.
The frozen root control independently refuses absent human/private/projection proof.
"""
import base64,hashlib,json,os,signal,sys,types
ROOT_SHA='b989a3f2395e7cbf13cb2d3dbd2d258a3fd21867131e41644c094772aba11168'
SCHEMA='pow-audit30-production-sixteen-root-envelope-v1'
def need(v,c):
 if not v:raise ValueError(c)
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'DUPLICATE_ENVELOPE_KEY');d[k]=v
 return d
def decode(raw):
 need(isinstance(raw,bytes)and len(raw)<=393216,'ROOT_ENVELOPE_CAP');v=json.loads(raw,object_pairs_hook=pairs);need(isinstance(v,dict)and set(v)=={'schema','rootControlBase64','request'}and v['schema']==SCHEMA,'ROOT_ENVELOPE_SCHEMA');source=base64.b64decode(v['rootControlBase64'],validate=True);need(len(source)<=49152 and hashlib.sha256(source).hexdigest()==ROOT_SHA,'ROOT_CONTROL_EXACT_BYTES');request=v['request'];need(isinstance(request,dict)and request.get('rootControlSHA256')==ROOT_SHA,'REQUEST_CONTROL_BINDING');data=json.dumps(request,sort_keys=True,separators=(',',':')).encode();need(len(data)<=262144,'ROOT_REQUEST_CAP');return source,data
def execute(source,data):
 module=types.ModuleType('approved_root_control');module.__file__='/reviewed/production-sixteen-root-control.py';exec(compile(source,module.__file__,'exec'),module.__dict__);module.ROOT_SOURCE_SHA256=ROOT_SHA
 class Input:
  def __init__(self,raw):
   import io
   self.buffer=io.BytesIO(raw)
 old_input=sys.stdin;handlers={s:signal.signal(s,lambda *_:(_ for _ in()).throw(module.Interrupted('Root production control interrupted')))for s in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP)}
 try:sys.stdin=Input(data);module.main()
 finally:
  sys.stdin=old_input
  for s,h in handlers.items():signal.signal(s,h)
def main():
 need(sys.flags.isolated and os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01','FIXED_ROOT_BOOTSTRAP');raw=sys.stdin.buffer.read(393217);source,data=decode(raw);execute(source,data);return 0
if __name__=='__main__':
 try:status=main()
 except BaseException as e:
  for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(s,signal.SIG_IGN)
  print(json.dumps(dict(schema='pow-audit30-production-sixteen-root-bootstrap-refused-v1',status='refused',errorClass=type(e).__name__,privateDetailsSuppressed=True,productionCommitOutcomeMustBeReconciled=True,automaticRetry=False,automaticInverse=False),sort_keys=True),file=sys.stderr);status=1
 sys.exit(status)
