#!/usr/bin/python3 -I
"""Source-only fixed caller; reviewed fresh request and one Root GO remain absent."""
import hashlib,json,re,sys,types
from pathlib import Path
H=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');HP='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
B=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-bootstrap-v3.py');BP='3a2a6d2caaa694eed6e96b2f7a5e4626a2d66e14b8d33123674b48266b423437'
N=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-v3.py');NP='e821dec229bb409c4b90a93a8a17db21722af520362862826b2ec388766e76f2'
R=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-request-v3.json');RP=None
def transport():
 raw=H.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HP:raise ValueError('Exact shared owned transport')
 m=types.ModuleType('reviewed_owned_transport');m.__file__=str(H);exec(compile(raw,str(H),'exec'),m.__dict__);return m
def main():
 if not sys.flags.isolated or len(sys.argv)!=1 or not isinstance(RP,str)or not re.fullmatch('[a-f0-9]{64}',RP):raise ValueError('Separately reviewed fresh bridge request remains absent')
 m=transport();b=m.bound(B,BP,32768);r=m.bound(R,RP,131072);source=m.bound(N,NP,20000);n=types.ModuleType('reviewed_retained_bridge');n.__file__=str(N);exec(compile(source,str(N),'exec'),n.__dict__);n.decode(r)
 result=m.execute(m.remote_command(b,RP),r,'/tmp/pow-audit30-retained-repair-dependency-bridge-native-v3',90,stdout_cap=65536,stderr_cap=65536,bindings={'bootstrapSHA256':BP,'requestSHA256':RP,'bridgeSourceSHA256':NP,'utilitySHA256':HP,'rootWorkMaximumSeconds':60,'ownedMetadataChildCleanupMaximumSeconds':3,'addressSpaceBytes':384*1024**2,'definitionsOnly':True,'productionDataMutationRequested':False,'apiRequests':0,'coreRequests':0,'sqlExecuted':False,'clusterPathsRead':False,'retirementAdmissionClaimed':False})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
