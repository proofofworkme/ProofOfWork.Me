#!/usr/bin/python3 -I
"""Root-reviewed once-only fixed read-only retained-dependency observation."""
import hashlib,json,sys,types
from pathlib import Path
T=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py')
TH='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
B=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-bootstrap-v5.py')
BH='4e0cfdf0fd7ce87312810fb11bf1027194c955afd6ced18a9f2b50c44e9f8972'
R=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-request-current4-v5.json')
RH='cb88b80632bdfb31dc192f9404a53086afcfff3b78154c03c4d434ce5ff0a9f8'
S=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-v5.py')
SH='b8605128bd99a2b64ab13f1c33a3b5d6907802df8e453c31a93fbbd9a308d5b6'
P=Path('/tmp/pow-audit30-independent-retained-repair-bridge-source-review-v5.json')
PH='880983270ae09082fee9091024654e52c2d4f153b2d2a61476c64659c9093c5f'
def main():
    assert sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1
    raw=T.read_bytes();assert len(raw)==8396 and hashlib.sha256(raw).hexdigest()==TH
    m=types.ModuleType('root_reviewed_owned_transport');m.__file__=str(T);exec(compile(raw,str(T),'exec'),m.__dict__)
    bootstrap=m.bound(B,BH,32768);request=m.bound(R,RH,131072);source=m.bound(S,SH,20000);m.bound(P,PH,16384)
    c=types.ModuleType('root_reviewed_bridge_definitions');c.__file__=str(S);exec(compile(source,str(S),'exec'),c.__dict__);c.decode(request)
    result=m.execute(m.remote_command(bootstrap,RH),request,'/tmp/pow-audit30-retained-repair-dependency-bridge-native-current4-v5',90,stdout_cap=65536,stderr_cap=65536,bindings={'rootOnceReadonlyGo':True,'sourceSha256':SH,'bootstrapSha256':BH,'requestSha256':RH,'peerRequestBindingSha256':PH,'contextStdoutSha256':'92d976261c28b0c6782d2c15ec9b5c9217cd19f1d4034db9b89946e15de6ffac','rootWorkSeconds':60,'rootAddressSpaceBytes':384*1024**2,'definitionsOnly':True,'sqlExecuted':False,'coreRequests':0,'clusterPathsRead':False,'productionMutation':False,'retirementAuthority':False})
    print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
