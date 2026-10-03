#!/usr/bin/python3 -I
"""Root-reviewed once-only fixed read-only retained-dependency observation."""
import hashlib,json,sys,types
from pathlib import Path
T=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py')
TH='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
B=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-bootstrap-v4.py')
BH='2b036f39e8f76bfa0a6f50f9054393442744c4b3d8a08a00a74a1f6d0d29a6f0'
R=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-request-current3-v4.json')
RH='cfcc84161e368e5fe7fed2e7c7d9e2a9d7d85d8c418c2dd1f7615b89eeda653d'
S=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-v4.py')
SH='f07f5b8971b98f98013a56da1e054bbf786fac8ee02cafbf4ed1308d9ad0768b'
P=Path('/tmp/pow-audit30-independent-retained-repair-bridge-source-review-v4.json')
PH='a36e8d3011fe63b748beb29b349d7a073e5ee5b24a12324f3bf833704f630d9d'
def main():
    assert sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1
    raw=T.read_bytes();assert len(raw)==8396 and hashlib.sha256(raw).hexdigest()==TH
    m=types.ModuleType('root_reviewed_owned_transport');m.__file__=str(T);exec(compile(raw,str(T),'exec'),m.__dict__)
    bootstrap=m.bound(B,BH,32768);request=m.bound(R,RH,131072);source=m.bound(S,SH,20000);m.bound(P,PH,16384)
    c=types.ModuleType('root_reviewed_bridge_definitions');c.__file__=str(S);exec(compile(source,str(S),'exec'),c.__dict__);c.decode(request)
    result=m.execute(m.remote_command(bootstrap,RH),request,'/tmp/pow-audit30-retained-repair-dependency-bridge-native-current3-v4',90,stdout_cap=65536,stderr_cap=65536,bindings={'rootOnceReadonlyGo':True,'sourceSha256':SH,'bootstrapSha256':BH,'requestSha256':RH,'peerRequestBindingSha256':PH,'contextStdoutSha256':'92d976261c28b0c6782d2c15ec9b5c9217cd19f1d4034db9b89946e15de6ffac','rootWorkSeconds':60,'rootAddressSpaceBytes':384*1024**2,'definitionsOnly':True,'sqlExecuted':False,'coreRequests':0,'clusterPathsRead':False,'productionMutation':False,'retirementAuthority':False})
    print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
