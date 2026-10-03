#!/usr/bin/python3
"""One Root-authorized fixed read-only reconciliation; never retry the body run."""
import hashlib,json,sys,types
from pathlib import Path
T_PATH=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');T_SHA='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
SOURCE=Path('/tmp/pow-audit30-body-run-reconciliation-readonly-152000-v1.py');SOURCE_SHA='4830e876f8cfd2c2130c079630b20560c5ac78231732328bbbf652208cacb901';REQUEST=Path('/tmp/pow-audit30-body-run-envelope-20261003T152000Z-v1.json');REQUEST_SHA='f97ce8dbd4cdc00ad4f591a02aee4ec99478cb2e4fb9e96742d43802e5a95b31';PREFIX=Path('/tmp/pow-audit30-body-run-reconciliation-native-152000-v1')
def main():
 if len(sys.argv)!=1:raise ValueError('NO_EXTRA_ARGV')
 raw=T_PATH.read_bytes()
 if len(raw)>12288 or hashlib.sha256(raw).hexdigest()!=T_SHA:raise ValueError('EXACT_SHARED_TRANSPORT_PIN')
 T=types.ModuleType('frozen_owned_transport');T.__file__=str(T_PATH);exec(compile(raw,str(T_PATH),'exec'),T.__dict__)
 source=T.bound(SOURCE,SOURCE_SHA,16384);request=T.bound(REQUEST,REQUEST_SHA,196608)
 r=T.execute(T.remote_command(source),request,PREFIX,90,stdout_cap=65536,stderr_cap=65536,bindings={'sourceSHA256':SOURCE_SHA,'requestSHA256':REQUEST_SHA,'transportSHA256':T_SHA,'readonlyReconciliationOnly':True,'nativeStopNotInferredFromTransport':True})
 print(json.dumps(r,sort_keys=True));return 0 if r['exitCode']==0 and r['failure']is None else 1
if __name__=='__main__':sys.exit(main())
