#!/usr/bin/python3 -I
"""Repair-first stateless observation through the reviewed shared transport. Root GO required."""
import hashlib,json,sys,types
from pathlib import Path
HELPER=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');HELPER_SHA='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
BOOT=Path('/tmp/pow-audit30-repair-first-worker-observation-root-v1.py');BOOT_SHA='721d3359d368bf13f626567cde6cda8e8e9a5c400a9f32724641e096ea403f70'
REQUEST=Path('/tmp/pow-audit30-repair-first-worker-observation-request-v1.json');REQUEST_SHA='1c9c610d87a552cf3d3b0dab4bdd83e840848a4f7b687f06076871426a9464e9'
PREFIX='/tmp/pow-audit30-repair-first-worker-observation-native-v1'
def main():
 if not sys.flags.isolated or len(sys.argv)!=1:raise ValueError('Isolated fixed worker guard transport')
 h=HELPER.read_bytes()
 if len(h)>16384 or hashlib.sha256(h).hexdigest()!=HELPER_SHA:raise ValueError('Frozen shared owned transport')
 m=types.ModuleType('reviewed_owned_transport');m.__file__=str(HELPER);exec(compile(h,str(HELPER),'exec'),m.__dict__);source=m.bound(BOOT,BOOT_SHA,16384);raw=m.bound(REQUEST,REQUEST_SHA,65536)
 b=types.ModuleType('reviewed_worker_bootstrap');b.__file__=str(BOOT);exec(compile(source,str(BOOT),'exec'),b.__dict__);b.decode_request(raw)
 r=m.execute(m.remote_command(source),raw,PREFIX,240,stdout_cap=65536,stderr_cap=65536,bindings={'sourceSha256':BOOT_SHA,'requestSha256':REQUEST_SHA,'utilitySha256':HELPER_SHA,'requestBytes':len(raw),'originalGuardSourceSha256':'48001283affb80b3b027dcc93831074aee872fbee649fb14482c32b00eb1c76c','readonlyStatementMaximumSeconds':20})
 print(json.dumps(r,sort_keys=True));return 0 if r['exitCode']==0 and r['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
