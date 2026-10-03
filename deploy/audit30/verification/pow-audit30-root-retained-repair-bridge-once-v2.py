#!/usr/bin/python3 -I
"""Root-reviewed once-only fixed read-only retained-dependency observation."""
import hashlib,json,sys,types
from pathlib import Path
T=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py')
TH='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
B=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-bootstrap-v2.py')
BH='230fd581ad97b596a0a716eb331fff7cec1ad0ef76dd460d1873aee9e1172e8f'
R=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-request-v2.json')
RH='340f422c1ba7b1b9756726afc4cafab43f845ef11571ac0221d8083af9aeac44'
S=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-v2.py')
SH='75643490cfb52f800b73dc0aa38fdcbb7e74dbbc0ab8f811733d946fefb6ff4e'
P=Path('/tmp/pow-audit30-independent-retained-repair-request-binding-review-v2.json')
PH='216a93cbc729276cc332d4a82bd3fbe3ad7090d0c2e771fb078e7e286b0234e0'
def main():
    assert sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1
    raw=T.read_bytes();assert len(raw)==8396 and hashlib.sha256(raw).hexdigest()==TH
    m=types.ModuleType('root_reviewed_owned_transport');m.__file__=str(T);exec(compile(raw,str(T),'exec'),m.__dict__)
    bootstrap=m.bound(B,BH,32768);request=m.bound(R,RH,131072);source=m.bound(S,SH,20000);m.bound(P,PH,16384)
    c=types.ModuleType('root_reviewed_bridge_definitions');c.__file__=str(S);exec(compile(source,str(S),'exec'),c.__dict__);c.decode(request)
    result=m.execute(m.remote_command(bootstrap,RH),request,'/tmp/pow-audit30-retained-repair-dependency-bridge-native-v2',90,stdout_cap=65536,stderr_cap=65536,bindings={'rootOnceReadonlyGo':True,'sourceSha256':SH,'bootstrapSha256':BH,'requestSha256':RH,'peerRequestBindingSha256':PH,'contextStdoutSha256':'b78fe2459c2b6b4568423f01f2e4acb25922224027d9e5cd82059d56c60d82cf','rootWorkSeconds':60,'rootAddressSpaceBytes':384*1024**2,'definitionsOnly':True,'sqlExecuted':False,'coreRequests':0,'clusterPathsRead':False,'productionMutation':False,'retirementAuthority':False})
    print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
