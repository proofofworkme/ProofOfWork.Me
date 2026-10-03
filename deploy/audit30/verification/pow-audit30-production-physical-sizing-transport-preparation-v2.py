#!/usr/bin/python3 -I
"""Source-only caller. RP must bind a separately reviewed fresh request before use."""
import hashlib,json,re,sys,types
from pathlib import Path
H=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');HP='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
B=Path('/tmp/pow-audit30-production-physical-sizing-bootstrap-v2.py');BP='86f2e6d7f61d3f3235f084fcf0ab294da32b685ed026e7e22ec7368433d28905'
N=Path('/tmp/pow-audit30-production-physical-sizing-native-v2.py');NP='84a09e2bda07f672562074f8236cfd30eb9613df672232a371810721bd41e493'
R=Path('/tmp/pow-audit30-production-physical-sizing-request-v2.json');RP=None
def main():
 if not sys.flags.isolated or len(sys.argv)!=1 or not isinstance(RP,str)or not re.fullmatch('[a-f0-9]{64}',RP):raise ValueError('Separately reviewed fresh request remains absent')
 raw=H.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HP:raise ValueError('Exact shared owned transport')
 m=types.ModuleType('reviewed_owned_transport');m.__file__=str(H);exec(compile(raw,str(H),'exec'),m.__dict__)
 b=m.bound(B,BP,32768);r=m.bound(R,RP,65536);source=m.bound(N,NP,16384);n=types.ModuleType('reviewed_physical_size_root');n.__file__=str(N);exec(compile(source,str(N),'exec'),n.__dict__);n.decode(r)
 result=m.execute(m.remote_command(b,RP),r,'/tmp/pow-audit30-production-physical-sizing-native-v2',600,stdout_cap=1048576,stderr_cap=65536,bindings={'bootstrapSHA256':BP,'requestSHA256':RP,'nativeSourceSHA256':NP,'utilitySHA256':HP,'rootWorkMaximumSeconds':420,'nativeUnitMaximumSeconds':360,'leafMaximumSeconds':150,'serverStatementMaximumSeconds':15,'serverLockMaximumSeconds':2,'clientUnitCapsDoNotConstrainProductionBackends':True,'directDatabaseWrites':False,'slotOrBackupCreation':False,'apiRequests':0,'coreRequests':0})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
