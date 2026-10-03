#!/usr/bin/python3 -I
"""Exact strict request through already reviewed owned transport. Root native GO required."""
import hashlib,json,sys,types
from pathlib import Path
HELPER=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');HELPER_SHA='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
BOOT=Path('/tmp/pow-audit30-strict-shadow-native-bootstrap-v1.py');BOOT_SHA='e6d22f961e3ef883aed4ebfa96b781382b4ffb2ec81b417430612d65635529d9'
REQUEST=Path('/tmp/pow-audit30-strict-shadow-native-request-v1.json');REQUEST_SHA='706d751d8b3474e0ff7722ae1e012aed60466620ea8f4bf728e9b192c6b28d7a'
PREFIX='/tmp/pow-audit30-strict-shadow-native-v1'
def load_helper():
 raw=HELPER.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HELPER_SHA:raise ValueError('Frozen shared owned transport')
 m=types.ModuleType('reviewed_owned_transport');m.__file__=str(HELPER);exec(compile(raw,str(HELPER),'exec'),m.__dict__);return m
def main():
 if not sys.flags.isolated or len(sys.argv)!=1:raise ValueError('Isolated fixed strict transport')
 m=load_helper();source=m.bound(BOOT,BOOT_SHA,16384);raw=m.bound(REQUEST,REQUEST_SHA,262144)
 b=types.ModuleType('reviewed_strict_bootstrap');b.__file__=str(BOOT);exec(compile(source,str(BOOT),'exec'),b.__dict__);b.source_bytes(json.loads(raw))
 r=m.execute(m.remote_command(source),raw,PREFIX,1350,stdout_cap=65536,stderr_cap=65536,bindings={'sourceSha256':BOOT_SHA,'requestSha256':REQUEST_SHA,'utilitySha256':HELPER_SHA,'requestBytes':len(raw),'managedStrictMaximumSeconds':1200,'rootSupervisorMaximumSeconds':1320})
 print(json.dumps(r,sort_keys=True));return 0 if r['exitCode']==0 and r['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
