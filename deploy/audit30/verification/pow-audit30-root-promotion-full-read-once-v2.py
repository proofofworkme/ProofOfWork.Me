import hashlib,json,sys,types
from pathlib import Path
T=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');TH='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
N=Path('/tmp/pow-audit30-promotion-full-read-native-v1.py');NH='d07cb8d37eb2920578a2db009030b79ab27100345258e5b72f341f3d88ed54e8'
R=Path('/tmp/pow-audit30-promotion-full-read-request-v1.json');RH='b9b7fb0c49b677e708efdf3d908908ec70697a8866534f24ab0f52dea2f3d750'
P=Path('/tmp/pow-audit30-independent-fresh-bridge-promotion-request-binding-review-v1.json');PH='2de795a3a15b70be70f23a5a6deb516a5f15c0f35591b6ce09e2d3d9ea690369'
def main():
 assert sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1
 raw=T.read_bytes();assert len(raw)==8396 and hashlib.sha256(raw).hexdigest()==TH
 m=types.ModuleType('root_exact_owned_transport');m.__file__=str(T);exec(compile(raw,str(T),'exec'),m.__dict__)
 source=m.bound(N,NH,32768);request=m.bound(R,RH,32768);m.bound(P,PH,8192)
 d=types.ModuleType('root_exact_promotion_full_read');d.__file__=str(N);exec(compile(source,str(N),'exec'),d.__dict__);d.decode_request(request)
 result=m.execute(m.remote_command(source,RH),request,'/tmp/pow-audit30-promotion-full-read-native-120000-v2',480,stdout_cap=2097152,stderr_cap=65536,bindings={'rootOnceReadonlyGo':True,'sourceSha256':NH,'requestSha256':RH,'requestBindingPeerSha256':PH,'sourcePeerSha256':'e828fa397f74d582895bdc7bcbf43276f122adfb8e36f263c8032a458da4cfbc','actualContextStdoutSha256':'6915ba8a73a823fa648b49054760778723a36a3a7e5455bc5f8f027374f186d3','acceptedRestoreRootReviewSha256':'fbac8b76c0ce44de997c8585cd6031354fe8bcd722ee09f0b02ec94f05d6a9ba','unitSeconds':360,'rootSeconds':420,'unitCpuPercent':25,'unitMemoryMaxBytes':134217728,'unitSwapMaxBytes':0,'fullReadLeafSha256':d.SOURCE_SHA,'pinChangeRequested':False,'checkerChangeRequested':False,'recoveryActivationRequested':False,'additionalDeletionAuthorized':False,'productionMutation':False})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
