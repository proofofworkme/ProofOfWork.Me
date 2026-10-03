#!/usr/bin/python3
"""One separately Root-authorized run transport. No retry or implied next step."""
import hashlib,json,sys,types
from pathlib import Path
T_PATH=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');T_SHA='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
SOURCE=Path('/tmp/pow-audit30-production-sixteen-root-bootstrap-v3.py');SOURCE_SHA='eac18d7cdc8570875e55e36672d6419c857aa9e7fff7c1cbe8f92263bf25f1d4';REQUEST=Path('/tmp/pow-audit30-body-run-envelope-20261003T145500Z-v1.json');REQUEST_SHA='37b3d8e58fcca371ec952c12207efbe2b2a9feb58b755452b69616346fc252a6';PREFIX=Path('/tmp/pow-audit30-body-run-native-20261003t145500z-v1');DEADLINE=420;REQUEST_CAP=393216
def main():
 if len(sys.argv)!=1:raise ValueError('NO_EXTRA_ARGV')
 raw=T_PATH.read_bytes()
 if len(raw)>12288 or hashlib.sha256(raw).hexdigest()!=T_SHA:raise ValueError('EXACT_SHARED_TRANSPORT_PIN')
 T=types.ModuleType('frozen_owned_transport');T.__file__=str(T_PATH);exec(compile(raw,str(T_PATH),'exec'),T.__dict__)
 source=T.bound(SOURCE,SOURCE_SHA,49152);request=T.bound(REQUEST,REQUEST_SHA,REQUEST_CAP)
 result=T.execute(T.remote_command(source),request,PREFIX,DEADLINE,stdout_cap=65536,stderr_cap=65536,bindings={'sourceSHA256':SOURCE_SHA,'requestSHA256':REQUEST_SHA,'transportSHA256':T_SHA,'operation':'run','nativeStopNotInferredFromTransport':True})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':sys.exit(main())
