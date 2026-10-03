#!/usr/bin/python3 -I -B
"""Bounded repeatable-read mail verification; no database or service mutation."""
import base64,datetime,hashlib,json,os,resource,signal,stat,subprocess,sys,time
from pathlib import Path
NODE=Path('/opt/node-v24.18.0-linux-x64/bin/node')
PACKAGE=Path('/usr/local/lib/proofofwork-audit30-mail-projection-focused-v5')
MANIFEST=Path('/data/proofofwork-release-backups/audit30-mail-body-census-20261003T011506Z/proposed-body-only-manifest.json')
LEAF_SHA='ac37be8c62908ca09e965fa04f219247652f1b52377c51951e14dbcd786a6708'
PINS={NODE:'41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c',MANIFEST:'8d5d347aea2d398d75e69631f90b3efdd1c3254cfdbf3864015199b078699c50',PACKAGE/'server/db/postgres.mjs':'2b959860e0513907447459c1b196bfaaf81fba5131bfa050e528f911c18e616c',PACKAGE/'server/proof-index-mail-projection.mjs':'bc3c4efa87e3a9b7c0918d340d5626ca08491d7c6695f8951ce2c817c88f900c',Path('/usr/local/lib/proofofwork-audit30-onhost-math/v2/source/node_modules/pg/lib/index.js'):'3fad6e6d3d976edbabe0cbc9e1d39f4340bcb719bbbb186a0d3a24f3dbd4a94c'}
UNITS=('bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service','proofofwork-postgres-logical-backup.timer')
ENV={'PATH':'/opt/node-v24.18.0-linux-x64/bin:/usr/bin:/bin','LC_ALL':'C','TZ':'UTC','NETWORK':'livenet','NODE_DISABLE_COMPILE_CACHE':'1','POW_INDEX_DATABASE_URL':'postgresql:///proof_indexer?host=%2Fvar%2Frun%2Fpostgresql&port=5432&user=postgres','POW_INDEX_DB_STATEMENT_TIMEOUT_MS':'20000','POW_INDEX_DB_POOL_MAX':'1','POW_INDEX_DB_APP_NAME':'audit30-focused-mail-readonly','POW_INDEX_DB_CONNECT_TIMEOUT_MS':'10000'}
def sha(b):return hashlib.sha256(b).hexdigest()
def meta(p):
 s=p.lstat();assert p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode) and s.st_nlink==1
 return (s.st_dev,s.st_ino,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def sources():
 out={}
 for p,pin in PINS.items():
  before=meta(p);b=p.read_bytes();assert sha(b)==pin and meta(p)==before
  out[str(p)]=before
 return out
def services():
 r=subprocess.run(['/usr/bin/systemctl','show',*UNITS,'--property=Id','--property=ActiveState','--property=SubState','--property=MainPID','--property=InvocationID','--property=NextElapseUSecRealtime'],capture_output=True,timeout=8,env={'PATH':'/usr/bin:/bin','LC_ALL':'C','TZ':'UTC'},check=True)
 assert not r.stderr and len(r.stdout)<16384
 return r.stdout.decode('ascii')
def main():
 assert sys.flags.isolated and os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01'
 raw=sys.stdin.buffer.read(16385);assert len(raw)<=16384
 leaf=base64.b64decode(json.loads(raw)['leafBase64'],validate=True);assert sha(leaf)==LEAF_SHA
 before=sources();units=services();manifest=json.loads(MANIFEST.read_bytes());known=[t['txid'] for t in manifest['targets']];assert manifest['targetCount']==len(known)==len(set(known))==16
 code=leaf+b'\nconsole.log(JSON.stringify(await run('+json.dumps(known).encode()+b')));\n'
 def limits():
  resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(1024**2,1024**2))
 p=None;started=time.monotonic()
 try:
  p=subprocess.Popen([str(NODE),'--max-old-space-size=256','--input-type=module','-'],cwd=PACKAGE,env=ENV,user=108,group=112,extra_groups=[],umask=0o077,preexec_fn=limits,start_new_session=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  out,err=p.communicate(code,timeout=90);assert len(out)<=65536 and len(err)<=65536 and p.returncode==0 and not err
  value=json.loads(out);assert value['readOnly'] is True and value['nativeUid']==108 and value['nativeGid']==112 and value['moduleGraphReadableBeforeDatabase'] is True
  assert sources()==before and services()==units
  result={'schema':'audit30-mail16-fresh-readonly-parity-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'leafSha256':LEAF_SHA,'sourcePins':{str(k):v for k,v in PINS.items()},'freshMailProjection':value,'childStopped':True,'childExitCode':p.returncode,'liveFiveAndTimerUnchanged':True,'elapsedSeconds':round(time.monotonic()-started,6),'directDatabaseWrites':False,'apiRequests':0,'coreRequests':0}
  print(json.dumps(result,sort_keys=True))
 finally:
  if p is not None:
   if p.poll() is None:
    os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
   for stream in (p.stdin,p.stdout,p.stderr):
    if stream is not None:stream.close()
if __name__=='__main__':
 try:main()
 except BaseException as e:
  print(json.dumps({'status':'read-only-verification-refused','errorClass':type(e).__name__,'reasonSha256':sha(str(e).encode()),'privateContentsSuppressed':True,'directDatabaseWrites':False}),file=sys.stderr);sys.exit(1)
