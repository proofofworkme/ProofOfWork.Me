#!/usr/bin/python3 -I
"""LOCAL-only creation of exact fixed619 code/requests from new live-five proof.
Never SSH or contact API. Actual source/request/managed-unit review remains required.
"""
import argparse, base64, hashlib, json, os, re, stat, sys, types
from pathlib import Path
NATIVE=Path('/tmp/pow-audit30-mail-api-native-v1.py')
NATIVE_SHA='7d9c5b3d1af3f3a14ee72f693090ac80997500e9009c1d2f098def520ffb382e'
COLLECTOR=Path('/tmp/pow-audit30-mail-api-population-v2.py')
UTILITY=Path('/tmp/pow-audit30-treasury-native-v7.py')

def need(v,m):
 if not v:raise ValueError(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def pairs(a):
 d={}
 for k,v in a:need(k not in d,'Duplicate JSON key');d[k]=v
 return d
def bound(p,h,maximum=65536):
 p=Path(p);s=p.lstat();identity=lambda x:(x.st_dev,x.st_ino,x.st_mode,x.st_uid,x.st_gid,x.st_nlink,x.st_size,x.st_mtime_ns,x.st_ctime_ns)
 need(p.parent==Path('/tmp')and p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_size<=maximum and re.fullmatch('[0-9a-f]{64}',h),'Bounded local input')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  need(identity(os.fstat(f.fileno()))==identity(s),'FD identity');raw=f.read(maximum+1);need(identity(os.fstat(f.fileno()))==identity(s),'Input read drift')
 need(identity(p.lstat())==identity(s)and len(raw)<=maximum and sha(raw)==h,'Input hash/path drift');return raw
def native():
 raw=bound(NATIVE,NATIVE_SHA);m=types.ModuleType('fixed_native');m.__file__=str(NATIVE);exec(compile(raw,str(NATIVE),'exec'),m.__dict__);return m
def assemble(stage,rid,live):
 M=native();child={'schema':'pow-audit30-mail-api-population-request-v1','approvalSha256':M.APPROVAL,
                  'stage':stage,'runId':rid,'sourceSha256':M.COLLECTOR_SHA,'liveFive':live}
 code=bound(COLLECTOR,M.COLLECTOR_SHA);utility=bound(UTILITY,M.UTILITY_SHA);raw=encoded(child)
 values={}
 for mode in ('prepare','run'):
  v={'schema':'pow-audit30-mail-api-native-request-v1','approvalSha256':M.APPROVAL,'mode':mode,
     'collectorBase64':base64.b64encode(code).decode(),'utilityBase64':base64.b64encode(utility).decode(),
     'collectorRequestBase64':base64.b64encode(raw).decode(),'collectorRequestSha256':sha(raw)}
  M.request(v);values[mode]=v
 return child,values
def write(p,raw):
 p=Path(p);need(p.parent==Path('/tmp')and p.resolve(strict=False)==p,'Exclusive /tmp output')
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 fd=os.open('/tmp',os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
 return {'path':str(p),'bytes':len(raw),'sha256':sha(raw)}
def main():
 need(sys.flags.isolated,'Isolated LOCAL assembler');a=argparse.ArgumentParser();a.add_argument('--stage',required=True,choices=['baseline','after']);a.add_argument('--run-id',required=True);a.add_argument('--live-five',required=True);a.add_argument('--live-five-sha256',required=True);a.add_argument('--output-prefix',required=True);p=a.parse_args()
 # This file is an exact five-unit tuple map extracted by root from a fresh
 # separately reviewed metadata capture. It is not a fabricated live probe.
 raw=bound(p.live_five,p.live_five_sha256);live=json.loads(raw,object_pairs_hook=pairs)
 child,values=assemble(p.stage,p.run_id,live);out=[write(p.output_prefix+'.collector-request.json',encoded(child))]
 out += [write(p.output_prefix+'.'+mode+'-request.json',encoded(values[mode]))for mode in ('prepare','run')]
 print(json.dumps({'status':'assembled-for-root-review','files':out,'liveFiveSourceSha256':p.live_five_sha256,
                   'nativeSourceSha256':NATIVE_SHA,'nativeCallsMade':False,'launchApproved':False},sort_keys=True))
if __name__=='__main__':main()
