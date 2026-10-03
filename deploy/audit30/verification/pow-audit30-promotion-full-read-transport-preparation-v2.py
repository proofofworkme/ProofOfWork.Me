import hashlib,json,sys,types
from pathlib import Path
T=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');TH='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
N=Path('/tmp/pow-audit30-promotion-full-read-native-v2.py');NH='0cac910d1b74513499911fce6fabcf745442a6c3ba93b4c5d3c7fcf0e6ad9e15'
R=Path('/tmp/pow-audit30-promotion-full-read-request-144000-v2.json');RH='fc319aa87b59622363741fd751353b10a055ba31343fcdb09a849ee6279ea021'
C=Path('/tmp/pow-audit30-retained-repair-context-native-142900-v1.stdout');CH='fd12f5bfb20ee9532facf54b0798888790911cdc5f007b616bddaf57a2b6d48e'
def main():
 assert sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1
 raw=T.read_bytes();assert len(raw)==8396 and hashlib.sha256(raw).hexdigest()==TH
 m=types.ModuleType('exact_owned_transport');m.__file__=str(T);exec(compile(raw,str(T),'exec'),m.__dict__)
 source=m.bound(N,NH,32768);request=m.bound(R,RH,32768);context=m.bound(C,CH,8192)
 v=json.loads(context);r=json.loads(request);assert r['expectedLive']==v['expectedLive']and r['expectedProtection']==v['expectedProtection']
 d=types.ModuleType('exact_promotion_full_read');d.__file__=str(N);exec(compile(source,str(N),'exec'),d.__dict__);d.decode_request(request)
 result=m.execute(m.remote_command(source,RH),request,'/tmp/pow-audit30-promotion-full-read-native-144000-v2',480,stdout_cap=2097152,stderr_cap=65536,bindings={'sourceSha256':NH,'requestSha256':RH,'actualContextStdoutSha256':CH,'unitSeconds':360,'rootSeconds':420,'unitCpuPercent':25,'unitMemoryMaxBytes':134217728,'unitSwapMaxBytes':0,'fullReadLeafSha256':d.SOURCE_SHA,'pinChangeRequested':False,'checkerChangeRequested':False,'recoveryActivationRequested':False,'additionalDeletionAuthorized':False,'productionMutation':False})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
