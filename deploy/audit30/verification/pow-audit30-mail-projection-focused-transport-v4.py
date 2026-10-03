#!/usr/bin/python3 -I
import hashlib,json,sys,types
from pathlib import Path
H=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');HP='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
B=Path('/tmp/pow-audit30-mail-projection-focused-bootstrap-v4.py');BP='967513f9742ab368ebb859d062bef2fd2967655b7c446b382affae6d69804e98'
R=Path('/tmp/pow-audit30-mail-projection-focused-request-v4.json');RP='8b66bc89b68a871158f233131622cc6d7c7fcbdeb7dd8490e79539105c75fb01'
def main():
 if not sys.flags.isolated or len(sys.argv)!=1:raise ValueError('Fixed isolated focused observation')
 raw=H.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HP:raise ValueError('Exact shared transport')
 m=types.ModuleType('reviewed_owned_transport');m.__file__=str(H);exec(compile(raw,str(H),'exec'),m.__dict__);b=m.bound(B,BP,4096);r=m.bound(R,RP,32768)
 result=m.execute(m.remote_command(b,RP),r,'/tmp/pow-audit30-mail-projection-focused-native-v4',180,stdout_cap=65536,stderr_cap=65536,bindings={'bootstrapSHA256':BP,'requestSHA256':RP,'utilitySHA256':HP,'childReadOnlyMaximumSeconds':90,'directDatabaseWrites':False,'apiRequests':0,'coreRequests':0})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
