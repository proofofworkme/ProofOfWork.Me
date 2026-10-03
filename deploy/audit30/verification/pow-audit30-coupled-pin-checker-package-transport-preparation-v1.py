#!/usr/bin/python3 -I
"""Unexecuted caller; actual approved request and separate Root GO are absent."""
import hashlib,json,re,sys,types
from pathlib import Path
H=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');HP='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
B=Path('/tmp/pow-audit30-coupled-pin-checker-package-bootstrap-v1.py');BP='9ab89e78425903054b9343266c0e22c61fcccf29cf18641be1cedc2a46924d73'
S=Path('/tmp/pow-audit30-coupled-pin-checker-package-creator-v1.py');SP='8056f85ba5e5d45057df5233e7ed4cb880aa2687f6d8895a8ed647ff2902b9ff'
R=Path('/tmp/pow-audit30-coupled-pin-checker-package-request-v1.json');RP=None
def main():
 if not sys.flags.isolated or len(sys.argv)!=1 or not isinstance(RP,str)or not re.fullmatch('[a-f0-9]{64}',RP):raise ValueError('Actual human-approved package request remains absent')
 raw=H.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HP:raise ValueError('Exact shared owned transport')
 m=types.ModuleType('owned_transport');m.__file__=str(H);exec(compile(raw,str(H),'exec'),m.__dict__);boot=m.bound(B,BP,32768);request=m.bound(R,RP,524288);source=m.bound(S,SP,32768);c=types.ModuleType('inert_creator');c.__file__=str(S);exec(compile(source,str(S),'exec'),c.__dict__);c.decode(request)
 result=m.execute(m.remote_command(boot,RP),request,'/tmp/pow-audit30-coupled-pin-checker-package-native-v1',150,stdout_cap=65536,stderr_cap=65536,bindings={'bootstrapSHA256':BP,'requestSHA256':RP,'creatorSHA256':SP,'sharedTransportSHA256':HP,'rootMaximumSeconds':120,'rootAddressSpaceBytes':128*1024**2,'creationOnly':True,'promotionExecuted':False,'deletionAuthorized':False,'sqlExecuted':False,'coreRequests':0})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
