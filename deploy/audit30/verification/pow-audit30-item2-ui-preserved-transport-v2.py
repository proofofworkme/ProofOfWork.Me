#!/usr/bin/python3 -I -B
"""Creation-only local requests and one source-pinned UI continuation dispatch per phase."""
import argparse
import ast
import base64
import hashlib
import types
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import threading
import time

OWNER=Path('/tmp/pow-audit30-item2-ui-preserved-continuation-v1.py')
OWNER_SHA='b5f2f246e77bec854de7dc0bff7d7be1dd25034864d8fc89b44354c0a3a64b77'
PLAN=Path('/tmp/pow-audit30-item2-ui-plan-current-v2.json')
PLAN_SHA='ebb2f481c499f5e25d0787fd59c537b4ebff30c2c6afc93959361370eda07104'
RELEASE='38ac6e2bff2a-20261003T190512Z'
HELPERS={'stager.py':Path('/tmp/pow-audit30-item2-ui-preserved-stager-v1.py'),
         'receiver.py':Path('/tmp/pow-audit30-item2-ui-preserved-source-receiver-v1.py'),
         'provenance.sh':Path('/tmp/pow-audit30-item2-ui-preserved-provenance-v1.sh'),
         'publisher.sh':Path('/tmp/pow-audit30-item2-ui-preserved-publisher-v1.sh')}
PHASES=('prepare','preserve-stage','source')

def identity(details):
 return (details.st_dev,details.st_ino,details.st_mode,details.st_uid,details.st_gid,details.st_nlink,details.st_size,details.st_mtime_ns,details.st_ctime_ns)

def read(path,sha,maximum):
 assert path.resolve()==path and path.is_file() and not path.is_symlink()
 with path.open('rb') as stream:
  before=os.fstat(stream.fileno());raw=stream.read(maximum+1);after=os.fstat(stream.fileno())
 assert identity(before)==identity(after)==identity(path.stat()) and len(raw)<=maximum and hashlib.sha256(raw).hexdigest()==sha
 return raw

def owner():
 raw=read(OWNER,OWNER_SHA,65536);ast.parse(raw)
 module=types.ModuleType('_preserved_ui_request_source')
 exec(compile(raw,str(OWNER),'exec'),module.__dict__)
 return raw,module

def local(path):
 assert path.is_absolute() and str(path).startswith('/tmp/') and path.resolve()==path
 assert path.parent.is_dir() and not path.parent.is_symlink()
 return path

def create_json(path,value):
 with local(path).open('x') as output:
  json.dump(value,output,sort_keys=True,separators=(',',':'));output.write('\n');output.flush();os.fsync(output.fileno())

def assemble(phase,path):
 _,module=owner();read(PLAN,PLAN_SHA,65536)
 value={'schema':'pow-audit30-item2-ui-preserved-continuation-request-v1','phase':phase,
        'planSha256':PLAN_SHA,'expectedPayloadFingerprint':module.EXPECTED_PAYLOAD,
        'helperSourcesBase64':{name:base64.b64encode(read(source,module.HELPER_PINS[name][0],128*1024)).decode() for name,source in HELPERS.items()}}
 module.request(json.dumps(value).encode(),phase)
 create_json(path,value)
 raw=path.read_bytes();assert raw.endswith(b'\n') and len(raw)<=768*1024
 return {'schema':'pow-audit30-item2-ui-preserved-request-created-v1','phase':phase,'path':str(path),
         'bytes':len(raw),'fileSha256':hashlib.sha256(raw).hexdigest(),'requestSha256':hashlib.sha256(raw[:-1]).hexdigest(),
         'ownerSha256':OWNER_SHA,'nativeInvocations':0}

def bootstrap(code,phase,request_sha):
 unit='proofofwork-audit30-item2-ui-preserved-'+RELEASE+'-'+phase+'-v1.service'
 packed=base64.b64encode(code).decode()
 return """import base64,hashlib,os,subprocess,sys
assert os.geteuid()==os.getegid()==0
code=base64.b64decode(%r,validate=True)
assert hashlib.sha256(code).hexdigest()==%r
unit=%r
fields=dict(line.split('=',1) for line in subprocess.check_output(['/usr/bin/systemctl','show',unit,'-p','LoadState','-p','ActiveState','-p','MainPID'],text=True,timeout=10).splitlines())
assert fields=={'LoadState':'not-found','ActiveState':'inactive','MainPID':'0'},'Exact owned unit namespace occupied; reconcile without retry'
argv=['/usr/bin/systemd-run','--unit='+unit,'--service-type=exec','--wait','--pipe','--property=User=root','--property=Group=root','--property=KillMode=control-group','--property=RuntimeMaxSec=20min','--property=TimeoutStopSec=30s','--property=MemoryMax=4G','--property=MemorySwapMax=0','--property=TasksMax=128','--property=UMask=0077','/usr/bin/python3','-I','-B','-c',code.decode(),%r,%r]
result=subprocess.run(argv,stdin=sys.stdin.buffer,timeout=1230)
raise SystemExit(result.returncode)
"""%(packed,OWNER_SHA,unit,phase,request_sha)

def run(phase,request_path,stem):
 code,module=owner();plan=json.loads(read(PLAN,PLAN_SHA,65536))
 request_raw=local(request_path).read_bytes()
 assert request_raw.endswith(b'\n') and len(request_raw)<=768*1024
 module.request(request_raw[:-1],phase);request_sha=hashlib.sha256(request_raw[:-1]).hexdigest()
 bundle=None
 if phase=='source':
  bundle=Path(plan['localBundles']['source']);assert bundle.resolve()==bundle and bundle.is_file() and not bundle.is_symlink()
  with bundle.open('rb') as input:
   before=os.fstat(input.fileno());assert before.st_size==plan['source']['compressedBytes']
   assert hashlib.file_digest(input,'sha256').hexdigest()==plan['source']['sha256']
   assert identity(before)==identity(os.fstat(input.fileno()))==identity(bundle.stat())
   bundle_identity=identity(before)
 paths={suffix:local(Path(str(stem)+'.'+suffix)) for suffix in ('stdout','stderr','json')}
 assert all(not os.path.lexists(path) for path in paths.values())
 native=bootstrap(code,phase,request_sha)
 ssh=['ssh','-i','/home/sixer/.ssh/proofofwork_me_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','root@77.42.91.106',shlex.join(['/usr/bin/python3','-I','-B','-c',native])]
 errors=[];start=time.monotonic();unknown=False
 with paths['stdout'].open('xb') as stdout,paths['stderr'].open('xb') as stderr:
  process=subprocess.Popen(ssh,stdin=subprocess.PIPE,stdout=stdout,stderr=stderr)
  def feed():
   try:
    process.stdin.write(request_raw)
    if bundle:
     with bundle.open('rb') as input:
      before=os.fstat(input.fileno());assert identity(before)==identity(bundle.stat())==bundle_identity
      while block:=input.read(65536):process.stdin.write(block)
      assert identity(before)==identity(os.fstat(input.fileno()))==identity(bundle.stat())==bundle_identity
    process.stdin.close()
   except BaseException as error:
    errors.append(type(error).__name__)
    try:process.stdin.close()
    except OSError:pass
  feeder=threading.Thread(target=feed,daemon=True);feeder.start()
  try:code=process.wait(timeout=1260)
  except subprocess.TimeoutExpired:
   unknown=True;process.kill();code=process.wait(timeout=15)
  feeder.join(timeout=10)
  assert not feeder.is_alive(),'Local input feeder remains active; preserve evidence and reconcile'
  stdout.flush();os.fsync(stdout.fileno());stderr.flush();os.fsync(stderr.fileno())
 report={'schema':'pow-audit30-item2-ui-preserved-native-transport-v1','phase':phase,'releaseId':RELEASE,
         'ownerSha256':OWNER_SHA,'planSha256':PLAN_SHA,'requestSha256':request_sha,
         'requestFileSha256':hashlib.sha256(request_raw).hexdigest(),'exitCode':code,'elapsedSeconds':round(time.monotonic()-start,6),
         'unknownOutcome':unknown,'localInputErrors':errors,'automaticRetry':False,
         'stdout':{'path':str(paths['stdout']),'bytes':paths['stdout'].stat().st_size,'sha256':hashlib.sha256(paths['stdout'].read_bytes()).hexdigest()},
         'stderr':{'path':str(paths['stderr']),'bytes':paths['stderr'].stat().st_size,'sha256':hashlib.sha256(paths['stderr'].read_bytes()).hexdigest()}}
 create_json(paths['json'],report)
 assert not unknown and code==0 and not errors,'One native attempt failed or is unknown; reconcile preserved receipt, do not retry'
 return report

def main():
 parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='mode',required=True)
 assemble_parser=sub.add_parser('assemble');assemble_parser.add_argument('phase',choices=PHASES);assemble_parser.add_argument('request',type=Path)
 run_parser=sub.add_parser('run');run_parser.add_argument('phase',choices=PHASES);run_parser.add_argument('request',type=Path);run_parser.add_argument('stem',type=Path)
 args=parser.parse_args();os.umask(0o077)
 print(json.dumps(assemble(args.phase,args.request) if args.mode=='assemble' else run(args.phase,args.request,args.stem),sort_keys=True))

if __name__=='__main__':main()
