#!/usr/bin/python3 -I
"""One fixed closed postfailure observation via accepted shared transport; no service control."""
import hashlib,json,sys,types
from pathlib import Path
HELPER=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');HELPER_SHA='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e';SOURCE=Path('/tmp/pow-audit30-strict-shadow-postfailure-read-v1.py');SOURCE_SHA='4aac504273d7cdebf950fa7726be5d81167ba98bdaad24ba34afae1b4c354463'
def main():
 if not sys.flags.isolated or len(sys.argv)!=1:raise ValueError('Fixed isolated postfailure observation')
 raw=HELPER.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HELPER_SHA:raise ValueError('Exact shared transport')
 m=types.ModuleType('reviewed_owned_transport');m.__file__=str(HELPER);exec(compile(raw,str(HELPER),'exec'),m.__dict__);source=m.bound(SOURCE,SOURCE_SHA,16384);r=m.execute(m.remote_command(source),b'','/tmp/pow-audit30-strict-shadow-postfailure-native-v1',240,stdout_cap=65536,stderr_cap=65536,bindings={'sourceSha256':SOURCE_SHA,'utilitySha256':HELPER_SHA,'typedStdinBytes':0})
 print(json.dumps(r,sort_keys=True));return 0 if r['exitCode']==0 and r['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
