#!/usr/bin/python3 -I -B
"""Root-invoked, one read-only remote export with creation-only local custody."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

SOURCE=Path('/tmp/pow-audit30-mail-html-refusal-public-read-remote-v1.py')
PIN='fd2bdec9881bbc5a9377d2508cc95c81db38440fddc8cbbb500fd2539d660cff'
SSH=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes',
     '-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87']
BOOT="import hashlib,sys; s=sys.stdin.buffer.read(65537); assert len(s)==4017 and hashlib.sha256(s).hexdigest()=='"+PIN+"'; exec(compile(s,'/reviewed/mail-html-refusal-public-reader.py','exec'),{'__name__':'__main__','__file__':'/reviewed/mail-html-refusal-public-reader.py'})"

def need(value,code):
 if not value:raise ValueError(code)

def path(value):
 p=Path(value)
 need(p.is_absolute()and p.resolve()==p and str(p).startswith('/tmp/'),'LOCAL_OUTPUT_PATH')
 return p

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 for key in ('source-sha256','stdout','stderr','transport-output'):parser.add_argument('--'+key,required=True)
 args=parser.parse_args();need(args.source_sha256==PIN,'ROOT_REVIEWED_SOURCE_SHA')
 need(SOURCE.resolve(strict=True)==SOURCE and SOURCE.is_file()and not SOURCE.is_symlink(),'SOURCE_PATH')
 source=SOURCE.read_bytes();need(len(source)==4017 and hashlib.sha256(source).hexdigest()==PIN,'SOURCE_PIN')
 out=path(args.stdout);err=path(args.stderr);transport=path(args.transport_output)
 need(len({out,err,transport})==3 and not any(os.path.lexists(p)for p in (out,err,transport)),'LOCAL_OUTPUT_NAMESPACE')
 started=datetime.datetime.now(datetime.timezone.utc);code=None;error=None
 try:
  with out.open('xb')as stdout,err.open('xb')as stderr:
   result=subprocess.run(SSH+[shlex.join(['/usr/bin/sudo','-n','/usr/bin/python3','-I','-B','-c',BOOT])],
       input=source,stdout=stdout,stderr=stderr,timeout=180)
   code=result.returncode
 except BaseException as exc:error=type(exc).__name__
 def custody(p):
  raw=p.read_bytes()if p.exists()else None
  return {'path':str(p),'bytes':len(raw)if raw is not None else None,'sha256':hashlib.sha256(raw).hexdigest()if raw is not None else None}
 value={'schema':'pow-audit30-mail-html-refusal-read-transport-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'sourceSHA256':PIN,'returncode':code,'errorClass':error,'stdout':custody(out),'stderr':custody(err),
        'elapsedSeconds':(datetime.datetime.now(datetime.timezone.utc)-started).total_seconds(),
        'automaticRetry':False,'remoteMutations':False}
 raw=(json.dumps(value,sort_keys=True)+'\n').encode()
 with transport.open('xb')as target:target.write(raw);target.flush();os.fsync(target.fileno())
 print(json.dumps(value,sort_keys=True));sys.exit(0 if code==0 and error is None else 1)

if __name__=='__main__':main()
