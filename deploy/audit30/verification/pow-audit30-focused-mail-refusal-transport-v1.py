#!/usr/bin/python3 -I
import hashlib,json,sys,types
from pathlib import Path
H=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');HP='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
B=Path('/tmp/pow-audit30-focused-mail-refusal-bootstrap-v1.py');BP='d8f719a2c1a677cd8cd5d6df07e33f3f44c54cccb0c0c5ebc06504ddd63d9bc1'
R=Path('/tmp/pow-audit30-mail-projection-focused-request-v2.json');RP='9ed745006112c8b6c7eb105b1794278531d148231c1ff5dc74eeeac2c750a08d'
def main():
 if not sys.flags.isolated or len(sys.argv)!=1:raise ValueError('Fixed isolated focused observation')
 raw=H.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HP:raise ValueError('Exact shared transport')
 m=types.ModuleType('reviewed_owned_transport');m.__file__=str(H);exec(compile(raw,str(H),'exec'),m.__dict__);b=m.bound(B,BP,8192);r=m.bound(R,RP,32768)
 result=m.execute(m.remote_command(b,RP),r,'/tmp/pow-audit30-focused-mail-refusal-native-v1',120,stdout_cap=65536,stderr_cap=65536,bindings={'bootstrapSHA256':BP,'requestSHA256':RP,'utilitySHA256':HP,'childLaunches':0,'directDatabaseWrites':False,'apiRequests':0,'coreRequests':0})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
