#!/usr/bin/python3 -I
"""Fixed future census transport; actual reviewed request and root GO are separate.

The template has null completion/intent/live-five fields and refuses before
exclusive captures or any SSH. All process, signal and custody behavior comes
from the unchanged reviewed1dedef transport; no remote retry or stop inference.
"""
import hashlib,json,re,sys,types
from pathlib import Path
H=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py')
HP='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
SOURCE=Path('/tmp/pow-audit30-onhost-math-safe-input-census-completion-v2.py')
SOURCE_SHA='670318f80fe3c357abec3c5d09808e5ca718251aab15ab9b1f76899dad54f9ba'
REQUEST=Path('/tmp/pow-audit30-onhost-math-safe-input-request-completion-v2.json')
PREFIX='/tmp/pow-audit30-onhost-math-safe-input-census-native-completion-v2'
CAP=1024**2
def library():
 raw=H.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HP:raise ValueError('Exact shared transport pin')
 m=types.ModuleType('reviewed_owned_transport');m.__file__=str(H);exec(compile(raw,str(H),'exec'),m.__dict__);return m
def inputs(h,m):
 if not isinstance(h,str)or re.fullmatch('[a-f0-9]{64}',h)is None:raise ValueError('SAFE_INPUT_OUTER_REQUEST_ARGUMENT')
 source=m.bound(SOURCE,SOURCE_SHA,65536);raw=m.bound(REQUEST,h,CAP)
 s=types.ModuleType('fixed_safe_census');s.__file__=str(SOURCE);exec(compile(source,str(SOURCE),'exec'),s.__dict__)
 r=s.parse(raw)
 if s.encoded(r)!=raw:raise ValueError('SAFE_INPUT_OUTER_CANONICAL_REQUEST')
 s.validate_request(r);return source,raw
def main():
 if not sys.flags.isolated or len(sys.argv)!=2:raise ValueError('Fixed isolated census SHA argument')
 m=library();h=sys.argv[1];source,raw=inputs(h,m)
 v=m.execute(m.remote_command(source,h),raw,PREFIX,240,stdout_cap=CAP,stderr_cap=CAP,bindings={'sourceSha256':SOURCE_SHA,'requestSha256':h,'sharedTransportSha256':HP,'remoteSqlCoreOrUnitControl':False,'remoteWrites':False,'privatePayloadExported':False})
 print(json.dumps(v,sort_keys=True));return 0 if v['exitCode']==0 and v['failure']is None else 1
if __name__=='__main__':
 try:code=main()
 except BaseException as e:print(json.dumps({'status':'refused','errorClass':type(e).__name__,'nativeCompletionClaimed':False}));code=1
 raise SystemExit(code)
