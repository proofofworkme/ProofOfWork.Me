#!/usr/bin/python3 -I
import hashlib,json,sys,types
from pathlib import Path
H=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');HP='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
B=Path('/tmp/pow-audit30-mail-projection-focused-bootstrap-v5.py');BP='96d67f74cb512e3ae0183d1639c929b25fd537d1b85bb488c96fe10247dd0cd9'
R=Path('/tmp/pow-audit30-mail-projection-focused-request-v5.json');RP='9446ef433d6ede178fac1fa86d98c94ae2ab251441d73b2b6e75dbf3ac69879e'
def main():
 if not sys.flags.isolated or len(sys.argv)!=1:raise ValueError('Fixed isolated focused observation')
 raw=H.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HP:raise ValueError('Exact shared transport')
 m=types.ModuleType('reviewed_owned_transport');m.__file__=str(H);exec(compile(raw,str(H),'exec'),m.__dict__);b=m.bound(B,BP,4096);r=m.bound(R,RP,32768)
 result=m.execute(m.remote_command(b,RP),r,'/tmp/pow-audit30-mail-projection-focused-native-v5',180,stdout_cap=65536,stderr_cap=65536,bindings={'bootstrapSHA256':BP,'requestSHA256':RP,'utilitySHA256':HP,'childReadOnlyMaximumSeconds':90,'directDatabaseWrites':False,'apiRequests':0,'coreRequests':0})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
