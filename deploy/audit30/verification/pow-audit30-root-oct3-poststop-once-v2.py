import hashlib,json,sys,types
from pathlib import Path
T=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py')
TH='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
S=Path('/tmp/pow-audit30-oct3-restore-poststop-observer-v2.py')
SH='a55a22e74d75c74954954d2cf79827c91f3240065bafb7581c4c5015ef0095ae'
P=Path('/tmp/pow-audit30-independent-oct3-poststop-source-review-v2.json')
PH='7eaf4a8bf4aed8ca6f96fad7584c7600b5f84f6f9e4eca62c756606ca85af830'
def main():
 assert sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1
 raw=T.read_bytes();assert len(raw)==8396 and hashlib.sha256(raw).hexdigest()==TH
 m=types.ModuleType('root_bound_transport');m.__file__=str(T);exec(compile(raw,str(T),'exec'),m.__dict__)
 source=m.bound(S,SH,8192);m.bound(P,PH,8192)
 result=m.execute(m.remote_command(source),b'','/tmp/pow-audit30-oct3-restore-poststop-native-v2',75,stdout_cap=65536,stderr_cap=65536,bindings={'rootOnceReadOnlyGo':True,'sourceSha256':SH,'sourcePeerSha256':PH,'rootTests':12,'rootTestSeconds':.150,'actualRestoreStdoutSha256':'3a53ab1325bf9110445da746452a24865e6069fa9e7fdbe0e28b09af2f1574ba','restorePlanSha256':'6f87050e6b44c74cd6c6ba61fb9c8c922ba8436ee4111e31c1e8bcd3f1d8cfee','unitControlRequested':False,'sqlExecuted':False,'productionMutation':False,'additionalDeletionAuthorized':False})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
