#!/usr/bin/python3 -I
"""Root once-only fixed read-only proposal-state capture; no promotion."""
import hashlib,json,sys,types
from pathlib import Path
T=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');TH='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
S=Path('/tmp/pow-audit30-coupled-promotion-state-observer-v1.py');SH='47b822552521ccff65a8e1b32157091d01d0a68130971bd2da402102b20c5dec'
R=Path('/tmp/pow-audit30-coupled-promotion-state-observer-request-v1.json');RH='da4794e527239dda342afb318cae726a4fa36116a53322cf609ed86d8557d928'
P=Path('/tmp/pow-audit30-independent-coupled-promotion-state-observer-source-review-v1.json');PH='879c3f9b341370ec693b8d79d0f9c4f0b1ce503ebd4d7b1527c52be01acdd009'
def main():
 assert sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1
 raw=T.read_bytes();assert len(raw)==8396 and hashlib.sha256(raw).hexdigest()==TH
 m=types.ModuleType('root_owned_transport');m.__file__=str(T);exec(compile(raw,str(T),'exec'),m.__dict__)
 source=m.bound(S,SH,65536);request=m.bound(R,RH,32768);m.bound(P,PH,8192)
 d=types.ModuleType('root_readonly_state_definitions');d.__file__=str(S);exec(compile(source,str(S),'exec'),d.__dict__);d.M=d.load_v5();d.validate_request(json.loads(request))
 result=m.execute(m.remote_command(source),request,'/tmp/pow-audit30-coupled-promotion-state-observer-native-v1',90,stdout_cap=65536,stderr_cap=65536,bindings={'rootOnceReadonlyGo':True,'sourceSha256':SH,'requestSha256':RH,'sourcePeerSha256':PH,'contextStdoutSha256':'92d976261c28b0c6782d2c15ec9b5c9217cd19f1d4034db9b89946e15de6ffac','wholeSeconds':60,'checkerSeconds':20,'cpuSeconds':30,'addressSpaceBytes':268435456,'rootFixturesPassed':15,'definitionsOnlyV5':True,'singlePinV5ActionWithdrawn':True,'productionMutation':False,'promotionAuthorized':False,'additionalDeletion':False,'recoveryActivation':False})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure'] is None else 1
if __name__=='__main__':raise SystemExit(main())
