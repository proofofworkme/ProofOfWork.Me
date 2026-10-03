#!/usr/bin/python3 -I
"""Root-reviewed once-only fixed read-only retained-dependency observation."""
import hashlib,json,sys,types
from pathlib import Path
T=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py')
TH='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
B=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-bootstrap-v3.py')
BH='3a2a6d2caaa694eed6e96b2f7a5e4626a2d66e14b8d33123674b48266b423437'
R=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-request-v3.json')
RH='f73c32dd5d7b62ea614720cef32a69564967b060527925769b338e611f19d86c'
S=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-v3.py')
SH='e821dec229bb409c4b90a93a8a17db21722af520362862826b2ec388766e76f2'
P=Path('/tmp/pow-audit30-independent-fresh-bridge-promotion-request-binding-review-v1.json')
PH='2de795a3a15b70be70f23a5a6deb516a5f15c0f35591b6ce09e2d3d9ea690369'
def main():
    assert sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1
    raw=T.read_bytes();assert len(raw)==8396 and hashlib.sha256(raw).hexdigest()==TH
    m=types.ModuleType('root_reviewed_owned_transport');m.__file__=str(T);exec(compile(raw,str(T),'exec'),m.__dict__)
    bootstrap=m.bound(B,BH,32768);request=m.bound(R,RH,131072);source=m.bound(S,SH,20000);m.bound(P,PH,16384)
    c=types.ModuleType('root_reviewed_bridge_definitions');c.__file__=str(S);exec(compile(source,str(S),'exec'),c.__dict__);c.decode(request)
    result=m.execute(m.remote_command(bootstrap,RH),request,'/tmp/pow-audit30-retained-repair-dependency-bridge-native-v3',90,stdout_cap=65536,stderr_cap=65536,bindings={'rootOnceReadonlyGo':True,'sourceSha256':SH,'bootstrapSha256':BH,'requestSha256':RH,'peerRequestBindingSha256':PH,'contextStdoutSha256':'6915ba8a73a823fa648b49054760778723a36a3a7e5455bc5f8f027374f186d3','rootWorkSeconds':60,'rootAddressSpaceBytes':384*1024**2,'definitionsOnly':True,'sqlExecuted':False,'coreRequests':0,'clusterPathsRead':False,'productionMutation':False,'retirementAuthority':False})
    print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
