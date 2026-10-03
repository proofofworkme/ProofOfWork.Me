#!/usr/bin/python3 -I
"""LOCAL fixed-source bounded metadata-only transport. Requires separate root GO.
No SQL/Core/API/service action, full cluster hashing or retirement authority.
"""
import hashlib, json, sys, types
from pathlib import Path
HELPER=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py')
HELPER_SHA='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
SOURCE='/tmp/pow-audit30-retirement-dependency-readonly-census-v3.py'
SOURCE_SHA='6e4f83a69cc1e3f7e27f56223330d15e3a2d9fe81df248b4b7a4ccca11cf52ea'
def main():
 if not sys.flags.isolated or len(sys.argv)!=1:raise ValueError('Isolated fixed local transport')
 raw=HELPER.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HELPER_SHA:raise ValueError('Frozen transport utility')
 M=types.ModuleType('reviewed_transport');M.__file__=str(HELPER);exec(compile(raw,str(HELPER),'exec'),M.__dict__)
 source=M.bound(SOURCE,SOURCE_SHA,16384)
 result=M.execute(M.remote_command(source),b'', '/tmp/pow-audit30-retirement-dependency-native-v4',110,
                  stdout_cap=32*1024**2,stderr_cap=1024**2,
                  bindings={'sourceSha256':SOURCE_SHA,'utilitySha256':HELPER_SHA,'typedStdinBytes':0})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
