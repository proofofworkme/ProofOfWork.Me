#!/usr/bin/python3 -I
"""Root-reviewed once-only fixed read-only retained-dependency observation."""
import hashlib,json,sys,types
from pathlib import Path
T=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py')
TH='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
B=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-bootstrap-v3.py')
BH='3a2a6d2caaa694eed6e96b2f7a5e4626a2d66e14b8d33123674b48266b423437'
R=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-request-current2-v3.json')
RH='cd8911fe048dea68b9bc31c355c77c0807ca2e52e088d6a6ce79269a3e3e08ad'
S=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-v3.py')
SH='e821dec229bb409c4b90a93a8a17db21722af520362862826b2ec388766e76f2'
P=Path('/tmp/pow-audit30-independent-current2-request-binding-review-v1.json')
PH='d42e6fa1bc6cc59fd3d82e8e8fad24f1218f9b6c3d117227f0818c0ee15528cc'
def main():
    assert sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1
    raw=T.read_bytes();assert len(raw)==8396 and hashlib.sha256(raw).hexdigest()==TH
    m=types.ModuleType('root_reviewed_owned_transport');m.__file__=str(T);exec(compile(raw,str(T),'exec'),m.__dict__)
    bootstrap=m.bound(B,BH,32768);request=m.bound(R,RH,131072);source=m.bound(S,SH,20000);m.bound(P,PH,16384)
    c=types.ModuleType('root_reviewed_bridge_definitions');c.__file__=str(S);exec(compile(source,str(S),'exec'),c.__dict__);c.decode(request)
    result=m.execute(m.remote_command(bootstrap,RH),request,'/tmp/pow-audit30-retained-repair-dependency-bridge-native-current2-v3',90,stdout_cap=65536,stderr_cap=65536,bindings={'rootOnceReadonlyGo':True,'sourceSha256':SH,'bootstrapSha256':BH,'requestSha256':RH,'peerRequestBindingSha256':PH,'contextStdoutSha256':'ba2aeb80552cbba4d2737a69120c3906368c019a5661a90ab9f00ae428dc21b4','rootWorkSeconds':60,'rootAddressSpaceBytes':384*1024**2,'definitionsOnly':True,'sqlExecuted':False,'coreRequests':0,'clusterPathsRead':False,'productionMutation':False,'retirementAuthority':False})
    print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
