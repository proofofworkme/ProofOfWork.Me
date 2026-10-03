#!/usr/bin/python3 -I -B
"""Prepare exact accepted inputs locally; launch only on Root's separate command."""
import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

RELEASE='38ac6e2bff2a-20261003T042000Z'
ROOT='/data/proofofwork-release-backups/audit30-node-release-'+RELEASE
WRAPPER=Path('/tmp/pow-audit30-item2-node-cutover-v3.py')
WRAPPER_SHA='87f61f895d24e83d7c20037d7dae50ded7af014f5a0a2134e8cdd6a48936df3c'
GUARD_SHA='48001283affb80b3b027dcc93831074aee872fbee649fb14482c32b00eb1c76c'
SSH=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes',
     '-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87']

def need(v,m):
 if not v:raise ValueError(m)

def sha(raw):return hashlib.sha256(raw).hexdigest()

def raw_file(path,cap=4*1024**2):
 p=Path(path)
 need(p.is_absolute()and p.resolve(strict=True)==p and p.is_file()and not p.is_symlink()and p.stat().st_size<=cap,'LOCAL_FILE_BOUND')
 raw=p.read_bytes();need(len(raw)<=cap,'LOCAL_FILE_GROWTH');return raw

def create(path,raw):
 p=Path(path);need(p.is_absolute()and p.resolve()==p and str(p).startswith('/tmp/'),'LOCAL_OUTPUT_PATH')
 with p.open('xb')as f:f.write(raw);f.flush();os.fsync(f.fileno())

def output_path(path):
 p=Path(path);need(p.is_absolute()and p.resolve()==p and str(p).startswith('/tmp/'),'LOCAL_OUTPUT_PATH')
 return p

def accepted_inputs(accepted_raw,completed_raw,lease_raw,completed_remote,lease_remote):
 a=json.loads(accepted_raw);c=json.loads(completed_raw);l=json.loads(lease_raw)
 need(a.get('ok')is True and a.get('mode')=='shadow'and a.get('network')=='livenet'
      and a.get('base')==a.get('authority')=='http://127.0.0.1:18081'
      and a.get('candidate')=={'commit':'38ac6e2bff2ac16890724e5213346ef8a3ebd186','tree':'8b9b5e3cd47aa8e4204da717350a629176e30da6','runtimeSha256':'13035b6d1fbca1be9c03b1833f3abe578d4ae28331a341b3dea4301cc72b535c'}
      and all(a.get('gates',{}).get(k)is True for k in ('ids','events','parity')),'ALL_FRESH_STRICT_GATES_REQUIRED')
 age=(dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(a['completedAt'].replace('Z','+00:00'))).total_seconds()
 need(0<=age<=1800,'STRICT_AGE')
 fence=a.get('stableCheckpoint',{})
 need(type(fence.get('height'))is int and 0<=fence['height']<=9007199254740991
      and re.fullmatch('[0-9a-f]{64}',str(fence.get('hash','')))
      and a.get('privateLauncher',{}).get('scriptSha256')=='bbded71fa88cfc108c611b3beddd3a6c693b38477c356b682caed8985976abda','STRICT_FENCE_AND_DRIVER')
 need(c.get('schema')=='pow-audit30-strict-native-completed-v1'and c.get('returncode')==0
      and all(c.get(k)is True for k in ('stopped','timerRestored','liveFiveUnchanged','shadowUnchanged'))
      and c.get('acceptedReceiptSHA256')==sha(accepted_raw)
      and c.get('unit')==a.get('privateLauncher',{}).get('unit'),'COMPLETION_ACCEPTED_PAIR')
 need(c['unit']=='proofofwork-audit29-verify-'+RELEASE+'-shadow-strict-v3.service','FRESH_STRICT_V3_REQUIRED')
 accepted_remote=c.get('acceptedReceiptPath','')
 need(re.fullmatch(re.escape('/data/proofofwork-audit29-verify-launch-'+RELEASE+'-shadow-')+r'[a-z0-9-]+/accepted-receipt\.json',accepted_remote)
      and completed_remote.startswith(ROOT+'/')and lease_remote.startswith(ROOT+'/'),'REMOTE_RECEIPT_PATHS')
 need(l.get('schema')=='pow-audit30-node-readonly-shadow-prepared-v1'and l.get('ok')is True
      and l.get('health',{}).get('ready')is True and l.get('liveServicesUnchanged')is True,'ACCEPTED_LEASE_REQUIRED')
 return {'strictAccepted':{'path':accepted_remote,'sha256':sha(accepted_raw)},
         'strictCompleted':{'path':completed_remote,'sha256':sha(completed_raw)},
         'leaseReceipt':{'path':lease_remote,'sha256':sha(lease_raw)}}

REMOTE=r'''
import base64,hashlib,json,os,pathlib,re,subprocess,sys
need=lambda v,m: None if v else (_ for _ in ()).throw(ValueError(m))
need(os.geteuid()==os.getegid()==0 and sys.flags.isolated,'ROOT_ISOLATED')
raw=sys.stdin.buffer.read(131073);need(len(raw)<=131072 and hashlib.sha256(raw).hexdigest()==sys.argv[1],'ENVELOPE_SHA')
e=json.loads(raw);need(e['schema']=='pow-audit30-item2-node-launch-envelope-v1','ENVELOPE_SCHEMA')
source=base64.b64decode(e['wrapperBase64'],validate=True);request=base64.b64decode(e['requestBase64'],validate=True)
need(len(source)==29020 and hashlib.sha256(source).hexdigest()=='87f61f895d24e83d7c20037d7dae50ded7af014f5a0a2134e8cdd6a48936df3c','WRAPPER_SHA')
need(hashlib.sha256(request).hexdigest()==e['requestSHA256'],'REQUEST_SHA')
q=json.loads(request);need(re.fullmatch('[a-z0-9][a-z0-9-]{0,24}',q['attempt'])and q['attempt']!='initial','ATTEMPT')
unit='proofofwork-audit29-release-38ac6e2bff2a-20261003T042000Z-node-'+q['attempt']+'.service'
env={'PATH':'/usr/bin:/bin','LC_ALL':'C','TZ':'UTC'}
s=subprocess.run(['/usr/bin/systemctl','show',unit,'--property=LoadState,MainPID'],env=env,capture_output=True,timeout=10,check=True)
need(not s.stderr and len(s.stdout)<=65536,'UNIT_READ')
fields=dict(x.split('=',1)for x in s.stdout.decode().splitlines()if '='in x)
need(fields.get('LoadState')=='not-found'and fields.get('MainPID','0')=='0','UNIT_EXISTS')
need(not os.path.lexists('/data/proofofwork-audit29-cutover-38ac6e2bff2a-20261003T042000Z-'+q['attempt'])and not os.path.lexists('/data/proofofwork-release-backups/audit30-node-release-38ac6e2bff2a-20261003T042000Z/item2-cutover-admission-'+q['attempt']),'RECEIPT_NAMESPACE_EXISTS')
# Passive SQL scheduling before the 30min controller lease begins. It does not
# invoke guard/main, stop a service, acquire the deploy/backup lock, or write DB.
n={'__name__':'_passive_prelaunch_only','__file__':'/reviewed/item2-node-cutover.py'}
exec(compile(source,n['__file__'],'exec'),n)
idle=n['idle_window']();print(json.dumps({'schema':'pow-audit30-item2-prelaunch-idle-v1','idle':idle,'controllerInvocationsSoFar':0}),flush=True)
bootstrap="import base64,hashlib,sys; s=base64.b64decode("+repr(e['wrapperBase64'])+",validate=True); assert hashlib.sha256(s).hexdigest()=='87f61f895d24e83d7c20037d7dae50ded7af014f5a0a2134e8cdd6a48936df3c'; sys.argv=['/reviewed/item2-node-cutover.py',"+repr(e['requestSHA256'])+"]; exec(compile(s,'/reviewed/item2-node-cutover.py','exec'),{'__name__':'__main__','__file__':'/reviewed/item2-node-cutover.py'})"
properties=['User=root','Group=root','RuntimeMaxSec=30min','TimeoutStopSec=30s','KillMode=control-group','MemoryMax=4G','MemorySwapMax=0','CPUQuota=100%','TasksMax=128','UMask=0077','Restart=no']
argv=['/usr/bin/systemd-run','--quiet','--wait','--pipe','--unit='+unit,'--service-type=exec',*['--property='+p for p in properties],'/usr/bin/env','-i','PATH=/usr/bin:/bin','LC_ALL=C','TZ=UTC','/usr/bin/python3','-I','-B','-c',bootstrap]
# Exactly one launch. The frozen wrapper repeats native preflight, passive
# scheduling, fresh480 guard and ownership/lifetime checks before R.main once.
r=subprocess.run(argv,input=request,env=env,capture_output=True,timeout=1860)
need(len(r.stdout)<=65536 and len(r.stderr)<=65536,'CONTROLLER_OUTPUT_CAP')
sys.stdout.buffer.write(r.stdout);sys.stdout.buffer.flush();sys.stderr.buffer.write(r.stderr);sys.stderr.buffer.flush()
sys.exit(r.returncode)
'''

def assemble(args):
 source=raw_file(WRAPPER,65536);need(sha(source)==WRAPPER_SHA,'WRAPPER_PIN')
 accepted=raw_file(args.strict_accepted);completed=raw_file(args.strict_completed);lease=raw_file(args.lease)
 refs=accepted_inputs(accepted,completed,lease,args.completed_remote_path,args.lease_remote_path)
 need(re.fullmatch('[a-z0-9][a-z0-9-]{0,24}',args.attempt)and args.attempt=='item2-v3'
      and re.fullmatch(r'\d{8}T\d{6}Z',args.guard_run_id),'FRESH_NAMESPACE')
 envelope=json.loads(raw_file('/tmp/pow-audit30-resume-mail16-envelope.json'))
 guard=envelope['request']['guardBase64'];need(sha(base64.b64decode(guard,validate=True))==GUARD_SHA,'GUARD_PIN')
 quiet=json.loads(raw_file(args.quiet_units,65536));need(type(quiet)is list,'QUIET_UNIT_LIST')
 q={'schema':'pow-audit30-item2-node-cutover-request-v3','attempt':args.attempt,'guardRunId':args.guard_run_id,
    'guardBase64':guard,'quietUnits':quiet,**refs}
 # Exact prior failure custody; do not infer a completed stop from current absence alone.
 n={'__name__':'_local_prior_lease_evidence','__file__':str(WRAPPER)}
 exec(compile(source,str(WRAPPER),'exec'),n)
 q['priorLeaseStop']={};records={}
 local_names={'failed':'failed','observation':'failure-observation','bindings':'bindings','request':'request'}
 for key,(name,pin)in n['PRIOR_PINS'].items():
  local='/tmp/pow-audit30-item2-cutover-v1-exact-'+local_names[key]+'.json'
  prior_raw=raw_file(local);need(sha(prior_raw)==pin,'PRIOR_STOP_LOCAL_PIN')
  records[key]=json.loads(prior_raw)
  q['priorLeaseStop'][key]={'path':str(n['PRIOR_ADMISSION']/name),'sha256':pin}
 for unit in records['request']['quietUnits']+['proofofwork-audit29-release-'+RELEASE+'-node-item2-v1.service']:
  if unit not in quiet:quiet.append(unit)
 n['prior_lease_stop_evidence'](q,records,json.loads(lease)['unit'])
 q['priorNativeFailure']={};native_records={}
 for key,(name,pin)in n['NATIVE_V2_PINS'].items():
  local='/tmp/pow-audit30-node-v2-exact-v2-'+name
  native_raw=raw_file(local);need(sha(native_raw)==pin,'PRIOR_NATIVE_LOCAL_PIN')
  native_records[key]=json.loads(native_raw);q['priorNativeFailure'][key]={'path':str(n['NATIVE_V2']/name),'sha256':pin}
 n['prior_native_v2_evidence'](native_records)
 shadow_raw=raw_file('/tmp/pow-audit30-canonical-old-shadow-state-v1.json')
 q['canonicalFailedShadow']={'base64':base64.b64encode(shadow_raw).decode(),'sha256':sha(shadow_raw)}
 n['canonical_failed_evidence'](q['canonicalFailedShadow'])
 for unit in ['proofofwork-audit29-release-'+RELEASE+'-node-item2-v2.service']:
  if unit not in quiet:quiet.append(unit)
 request=(json.dumps(q,sort_keys=True,separators=(',',':'))+'\n').encode()
 e={'schema':'pow-audit30-item2-node-launch-envelope-v1','wrapperBase64':base64.b64encode(source).decode(),
    'requestBase64':base64.b64encode(request).decode(),'requestSHA256':sha(request),'wrapperSHA256':WRAPPER_SHA}
 raw=(json.dumps(e,sort_keys=True,separators=(',',':'))+'\n').encode();need(len(raw)<=131072,'ENVELOPE_CAP')
 create(args.request_output,request);create(args.envelope_output,raw)
 print(json.dumps({'status':'prepared-not-launched','request':{'path':args.request_output,'bytes':len(request),'sha256':sha(request)},
    'envelope':{'path':args.envelope_output,'bytes':len(raw),'sha256':sha(raw)},'wrapperSHA256':WRAPPER_SHA,
    'canonicalUnit':'proofofwork-audit29-release-'+RELEASE+'-node-'+args.attempt+'.service',
    'strictAccepted':refs['strictAccepted'],'productionInvocations':0},sort_keys=True))

def launch(args):
 need(re.fullmatch('[0-9a-f]{64}',args.envelope_sha256),'REVIEWED_ENVELOPE_SHA')
 raw=raw_file(args.envelope,131072);need(sha(raw)==args.envelope_sha256,'ENVELOPE_PIN')
 # Creation-only local custody. Root alone invokes this subcommand after review.
 stdout=output_path(args.stdout);stderr=output_path(args.stderr);output_path(args.transport_output)
 need(len({str(stdout),str(stderr),args.transport_output})==3,'OUTPUT_PATHS_DISTINCT')
 need(not any(os.path.lexists(p)for p in (stdout,stderr,args.transport_output)),'OUTPUT_NAMESPACE_EXISTS')
 error=None;code=None;start=dt.datetime.now(dt.timezone.utc)
 try:
  with stdout.open('xb')as out,stderr.open('xb')as err:
   r=subprocess.run(SSH+[shlex.join(['/usr/bin/sudo','-n','/usr/bin/python3','-I','-B','-c',REMOTE,args.envelope_sha256])],
        input=raw,stdout=out,stderr=err,timeout=2070)
   code=r.returncode
 except BaseException as exc:error=type(exc).__name__
 def observed(path):
  p=Path(path)
  return {'path':str(p),'exists':p.exists(),'bytes':p.stat().st_size if p.exists()else None,
          'sha256':sha(p.read_bytes())if p.exists()else None}
 result={'schema':'pow-audit30-item2-node-launch-transport-v1','exitCode':code,'errorClass':error,
   'atUtc':dt.datetime.now(dt.timezone.utc).isoformat(),'elapsedSeconds':(dt.datetime.now(dt.timezone.utc)-start).total_seconds(),
   'envelopeSHA256':args.envelope_sha256,'automaticRetry':False,'outcomeRequiresReceiptReconciliation':True,
   'stdout':observed(stdout),'stderr':observed(stderr)}
 create(args.transport_output,(json.dumps(result,sort_keys=True)+'\n').encode());print(json.dumps(result,sort_keys=True))
 if code!=0:sys.exit(1)

def main():
 p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
 a=sub.add_parser('assemble')
 for name in ('strict-accepted','strict-completed','lease','completed-remote-path','lease-remote-path','quiet-units','attempt','guard-run-id','request-output','envelope-output'):a.add_argument('--'+name,required=True)
 a=sub.add_parser('launch')
 for name in ('envelope','envelope-sha256','stdout','stderr','transport-output'):a.add_argument('--'+name,required=True)
 args=p.parse_args();assemble(args)if args.command=='assemble'else launch(args)

if __name__=='__main__':main()
