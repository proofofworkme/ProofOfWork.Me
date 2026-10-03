#!/usr/bin/python3 -I -B
"""Read only two explicitly public mail-refusal files; hash private stderr only."""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

ROOT=Path('/data/proofofwork-release-backups/audit30-mail-api-html-after-20261003T200200Z')
UNIT='proofofwork-audit30-mail-api-html-after-20261003T200200Z.service'
FIVE={
 'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),
 'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),
 'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),
 'proofofwork-api.service':('3372731','546739c810df48d4956961b0931b6fc5'),
 'proofofwork-indexer-worker.service':('3372743','b2dc36ef816c4311b4c9aa0740d781a9'),
}

def need(value,code):
 if not value:raise ValueError(code)

def stamp(s):
 return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)

def read(path,cap):
 s=path.lstat();need(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode)
      and s.st_uid==s.st_gid==0 and s.st_nlink==1 and s.st_size<=cap,'PUBLIC_FILE_SHAPE')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  need(stamp(os.fstat(fd))==stamp(s),'PUBLIC_OPEN_DRIFT');raw=os.read(fd,cap+1)
  need(len(raw)==s.st_size and stamp(os.fstat(fd))==stamp(s)==stamp(path.lstat()),'PUBLIC_READ_DRIFT')
 finally:os.close(fd)
 return raw,stamp(s)

def state(unit):
 result=subprocess.run(['/usr/bin/systemctl','show',unit,
     '--property=LoadState,ActiveState,SubState,MainPID,InvocationID,Result'],
     env={'PATH':'/usr/bin:/bin','LC_ALL':'C','TZ':'UTC'},capture_output=True,timeout=15)
 need(result.returncode==0 and not result.stderr and len(result.stdout)<=65536,'UNIT_READ')
 return dict(line.split('=',1)for line in result.stdout.decode().splitlines()if '='in line)

def five():
 result={unit:state(unit)for unit in FIVE}
 for unit,(pid,inv)in FIVE.items():
  need(result[unit].get('ActiveState')=='active'and result[unit].get('MainPID')==pid
       and result[unit].get('InvocationID')==inv,'LIVE_FIVE_DRIFT')
 return result

def main():
 need(sys.flags.isolated and os.geteuid()==os.getegid()==0,'ROOT_ISOLATED')
 before=five();receipts={};stamps={};values={}
 for name in ('failed.json','public-result.json'):
  raw,s=read(ROOT/name,256*1024);value=json.loads(raw);values[name]=value;stamps[ROOT/name]=s
  if name=='failed.json':
   need(value.get('schema')=='pow-audit30-mail-api-native-outcome-v1'and value.get('status')=='failed'
        and value.get('productionMutation')is False,'PUBLIC_NATIVE_FAILED_SCHEMA')
  else:
   need(value.get('schema')=='pow-audit30-mail-api-population-refusal-v1'
        and value.get('privatePayloadExported')is False and value.get('productionMutation')is False,'PUBLIC_COLLECTOR_REFUSAL_SCHEMA')
   partial=value.get('partialResult')
   need(partial is None or (type(partial)is dict and partial.get('addressesExported')is False
        and partial.get('privatePayloadExported')is False),'PRIVATE_PARTIAL_RESULT_REFUSED')
  receipts[name]={'path':str(ROOT/name),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
                  'base64':base64.b64encode(raw).decode()}
 stderr,s=read(ROOT/'stderr.log',65536);stamps[ROOT/'stderr.log']=s
 stderr_proof={'path':str(ROOT/'stderr.log'),'bytes':len(stderr),'sha256':hashlib.sha256(stderr).hexdigest(),
               'rawExported':False}
 after=five();need(before==after,'LIVE_FIVE_CHANGED_DURING_READ')
 for path,old in stamps.items():need(stamp(path.lstat())==old,'PUBLIC_CUSTODY_DRIFT')
 print(json.dumps({'schema':'pow-audit30-mail-html-refusal-public-export-v1',
       'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'receipts':receipts,
       'stderrHashOnly':stderr_proof,'unitState':state(UNIT),'liveFive':after,'liveFiveUnchanged':True,
       'privateBodiesOrAddressesExported':False,'productionMutationsPerformedByReader':False},sort_keys=True))

if __name__=='__main__':main()
