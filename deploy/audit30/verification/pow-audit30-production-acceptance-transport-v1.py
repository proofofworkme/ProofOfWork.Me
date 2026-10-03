#!/usr/bin/python3 -I -B
"""Local assembly; only Root separately invokes launch after exact source/input review.

Strict delegates unchanged 4eed supervisor once. Positive delegates unchanged
28bd owner once under its exact managed resource/cgroup contract. No retry.
"""
import argparse,base64,datetime as dt,hashlib,json,os,pathlib,re,shlex,subprocess,sys
RELEASE='38ac6e2bff2a-20261003T042000Z'
PINS={'strict':('pow-audit30-postcutover-production-strict-v1.py','4eed6eae5b5a4bd7cd5a29c500b90cdf748dda7ffaab4f90b79daeffc01ed6a4'),
      'positive':('pow-audit30-positive-work-scoped-owner-v1.py','28bd89f9e0e9abf953a579018d1224bc51b00a5615dc42812f321050ac598cd9')}
LEAF_SHA='42b7ccbe8c4bf22d05bc8b808dabad72cb2cb09455f1156c10cd313001fbea06'
SSH=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87']
def need(value,code):
 if not value:raise ValueError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def local(path,cap=262144):
 p=pathlib.Path(path);need(p.is_absolute()and p.resolve(strict=True)==p and p.is_file()and not p.is_symlink()and p.stat().st_size<=cap,'LOCAL_FILE');raw=p.read_bytes();need(len(raw)<=cap,'LOCAL_GROWTH');return raw
def output(path):
 p=pathlib.Path(path);need(p.is_absolute()and p.resolve()==p and str(p).startswith('/tmp/'),'LOCAL_OUTPUT');return p
def create(path,raw):
 p=output(path)
 with p.open('xb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
def binding(path,pin):
 need(re.fullmatch(re.escape('/data/proofofwork-audit29-cutover-'+RELEASE)+r'-[a-z0-9][a-z0-9-]{0,24}/[0-9]{3}-final\.json',path)and re.fullmatch('[0-9a-f]{64}',pin),'EXACT_CUTOVER_BINDING');return {'path':path,'sha256':pin}
def assemble_value(kind,cutover):
 source=local('/tmp/'+PINS[kind][0],65536);need(sha(source)==PINS[kind][1],'REVIEWED_SOURCE_CHANGED')
 if kind=='strict':request={'schema':'pow-audit30-production-strict-transport-request-v1','binding':cutover}
 else:
  supervisor=local('/tmp/'+PINS['strict'][0],65536);leaf=local('/tmp/pow-audit30-positive-work-scoped-leaf-v1.mjs',65536)
  need(sha(supervisor)==PINS['strict'][1]and sha(leaf)==LEAF_SHA,'REVIEWED_HELPER_CHANGED')
  request={'schema':'pow-audit30-positive-scoped-owner-request-v1','mode':'production','binding':{'cutover':cutover},'supervisorBase64':base64.b64encode(supervisor).decode(),'leafBase64':base64.b64encode(leaf).decode()}
 raw=(json.dumps(request,sort_keys=True,separators=(',',':'))+'\n').encode()
 envelope={'schema':'pow-audit30-production-acceptance-envelope-v1','kind':kind,'sourceBase64':base64.b64encode(source).decode(),'requestBase64':base64.b64encode(raw).decode(),'requestSHA256':sha(raw),'sourceSHA256':sha(source)}
 return raw,(json.dumps(envelope,sort_keys=True,separators=(',',':'))+'\n').encode()

REMOTE=r'''
import base64,hashlib,json,os,pathlib,re,subprocess,sys
need=lambda v,m: None if v else (_ for _ in ()).throw(ValueError(m))
need(os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0 and sys.flags.isolated,'ROOT_ISOLATED')
raw=sys.stdin.buffer.read(262145);need(len(raw)<=262144 and hashlib.sha256(raw).hexdigest()==sys.argv[1],'ENVELOPE_SHA')
e=json.loads(raw);need(set(e)=={'schema','kind','sourceBase64','requestBase64','requestSHA256','sourceSHA256'}and e['schema']=='pow-audit30-production-acceptance-envelope-v1'and e['kind']in ['strict','positive'],'ENVELOPE_SCOPE')
pins={'strict':'4eed6eae5b5a4bd7cd5a29c500b90cdf748dda7ffaab4f90b79daeffc01ed6a4','positive':'28bd89f9e0e9abf953a579018d1224bc51b00a5615dc42812f321050ac598cd9'}
source=base64.b64decode(e['sourceBase64'],validate=True);request=base64.b64decode(e['requestBase64'],validate=True)
need(len(source)<=65536 and hashlib.sha256(source).hexdigest()==e['sourceSHA256']==pins[e['kind']]and len(request)<=131072 and hashlib.sha256(request).hexdigest()==e['requestSHA256'],'PINNED_SOURCE_AND_REQUEST')
q=json.loads(request);release='38ac6e2bff2a-20261003T042000Z';env={'PATH':'/usr/bin:/bin','LC_ALL':'C','TZ':'UTC','GIT_OPTIONAL_LOCKS':'0'}
if e['kind']=='strict':
 need(set(q)=={'schema','binding'}and q['schema']=='pow-audit30-production-strict-transport-request-v1','STRICT_REQUEST_SCOPE')
 n={'__name__':'_reviewed_production_strict','__file__':'/reviewed/postcutover-production-strict-v1.py'}
 exec(compile(source,n['__file__'],'exec'),n)
 # The unchanged supervisor admits its one canonical absent strict unit, invokes
 # only installed8a569, and owns cleanup/restoration. No new deadline or gate.
 result=n['main'](q['binding']);print(json.dumps(result,sort_keys=True));sys.exit(0)
need(q.get('schema')=='pow-audit30-positive-scoped-owner-request-v1'and q.get('mode')=='production','POSITIVE_PRODUCTION_SCOPE')
unit='proofofwork-audit30-positive-scoped-'+release+'-production-v1.service'
p=subprocess.run(['/usr/bin/systemctl','show',unit,'--property=LoadState,MainPID'],env=env,capture_output=True,timeout=10)
need(p.returncode==0 and not p.stderr and len(p.stdout)<=4096,'POSITIVE_UNIT_READ')
row=dict(x.split('=',1)for x in p.stdout.decode().splitlines()if '='in x)
need(row.get('LoadState')=='not-found'and row.get('MainPID','0')=='0','POSITIVE_UNIT_EXISTS')
for prefix in ['proofofwork-audit30-positive-scoped-','proofofwork-audit30-positive-scoped-source-','proofofwork-audit30-positive-scoped-output-']:
 need(not os.path.lexists('/data/'+prefix+release+'-production-v1'),'POSITIVE_NAMESPACE_EXISTS')
bootstrap="import base64,hashlib,sys; s=base64.b64decode("+repr(e['sourceBase64'])+",validate=True); assert hashlib.sha256(s).hexdigest()=='28bd89f9e0e9abf953a579018d1224bc51b00a5615dc42812f321050ac598cd9'; sys.argv=['/reviewed/positive-work-scoped-owner-v1.py',"+repr(e['requestSHA256'])+"]; exec(compile(s,sys.argv[0],'exec'),{'__name__':'__main__','__file__':sys.argv[0]})"
properties=['User=root','Group=root','RuntimeMaxSec=15min','TimeoutStopSec=30s','KillMode=control-group','MemoryMax=4G','MemorySwapMax=0','CPUQuota=100%','TasksMax=128','UMask=0077','Restart=no']
argv=['/usr/bin/systemd-run','--quiet','--wait','--pipe','--unit='+unit,'--service-type=exec',*['--property='+p for p in properties],'/usr/bin/env','-i','PATH=/usr/bin:/bin','LC_ALL=C','TZ=UTC','/usr/bin/python3','-I','-B','-c',bootstrap]
r=subprocess.run(argv,input=request,env=env,capture_output=True,timeout=960)
need(len(r.stdout)<=65536 and len(r.stderr)<=65536,'POSITIVE_OUTPUT_CAP')
sys.stdout.buffer.write(r.stdout);sys.stdout.buffer.flush();sys.stderr.buffer.write(r.stderr);sys.stderr.buffer.flush();sys.exit(r.returncode)
'''

def assemble(args):
 cutover=binding(args.cutover_path,args.cutover_sha256);raw,envelope=assemble_value(args.kind,cutover)
 need(len(envelope)<=262144,'ENVELOPE_CAP');create(args.request_output,raw);create(args.envelope_output,envelope)
 print(json.dumps({'status':'prepared-not-launched','kind':args.kind,'sourceSHA256':PINS[args.kind][1],'request':{'path':args.request_output,'bytes':len(raw),'sha256':sha(raw)},'envelope':{'path':args.envelope_output,'bytes':len(envelope),'sha256':sha(envelope)},'cutover':cutover,'nativeInvocations':0},sort_keys=True))
def launch(args):
 need(re.fullmatch('[0-9a-f]{64}',args.envelope_sha256),'REVIEWED_ENVELOPE_SHA');raw=local(args.envelope);need(sha(raw)==args.envelope_sha256,'ENVELOPE_CHANGED');e=json.loads(raw);need(e.get('kind')in PINS,'KIND_REQUIRED')
 paths=[output(p)for p in [args.stdout,args.stderr,args.transport_output]];need(len(set(paths))==3 and not any(os.path.lexists(p)for p in paths),'LOCAL_NAMESPACE_EXISTS')
 start=dt.datetime.now(dt.timezone.utc);code=None;error=None
 try:
  with paths[0].open('xb')as out,paths[1].open('xb')as err:
   result=subprocess.run(SSH+[shlex.join(['/usr/bin/sudo','-n','/usr/bin/python3','-I','-B','-c',REMOTE,args.envelope_sha256])],input=raw,stdout=out,stderr=err,timeout=1500 if e['kind']=='strict'else 1020);code=result.returncode
 except BaseException as caught:error=type(caught).__name__
 observed=[]
 for p in paths[:2]:
  observed.append({'path':str(p),'exists':p.exists(),'bytes':p.stat().st_size if p.exists()else None,'sha256':sha(p.read_bytes())if p.exists()else None})
 report={'schema':'pow-audit30-production-acceptance-transport-v1','kind':e['kind'],'exitCode':code,'errorClass':error,'envelopeSHA256':args.envelope_sha256,'sourceSHA256':PINS[e['kind']][1],'atUtc':dt.datetime.now(dt.timezone.utc).isoformat(),'elapsedSeconds':(dt.datetime.now(dt.timezone.utc)-start).total_seconds(),'automaticRetry':False,'outcomeRequiresReceiptReconciliation':True,'stdout':observed[0],'stderr':observed[1]}
 create(args.transport_output,(json.dumps(report,sort_keys=True)+'\n').encode());print(json.dumps(report,sort_keys=True))
 if code!=0:sys.exit(1)
def main():
 p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
 a=sub.add_parser('assemble');a.add_argument('--kind',choices=list(PINS),required=True)
 for name in ['cutover-path','cutover-sha256','request-output','envelope-output']:a.add_argument('--'+name,required=True)
 a=sub.add_parser('launch')
 for name in ['envelope','envelope-sha256','stdout','stderr','transport-output']:a.add_argument('--'+name,required=True)
 args=p.parse_args();assemble(args)if args.command=='assemble'else launch(args)
if __name__=='__main__':main()
