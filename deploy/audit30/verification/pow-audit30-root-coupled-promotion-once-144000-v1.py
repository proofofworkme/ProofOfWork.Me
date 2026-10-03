import hashlib,json,shlex,sys,types
from pathlib import Path
T=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');TH='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
C=Path('/tmp/pow-audit30-coupled-pin-checker-package-native-144000-v1.stdout');CH='5f9a8bb610f3ad8dbe17c74c3fbd6c277f437289faaa69a30e73ad2572b602f0'
G=Path('/tmp/pow-audit30-direct-human-approval-20261003T142900Z.json');GH='184065046a3b6031ca0b47e5e1932321bab2672298a7da1fc9654c6d3a3fec49'
PS='7d50940fe5c2087cdc169fc14e27c006220dce12b91d2b15bcbb2bc4b9a6c2ee';SS='dfa403996e776a8ed192a024848b06f71b5fa041a24bf5b9687ff04ce3714535'
def main():
 assert sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1
 raw=T.read_bytes();assert len(raw)==8396 and hashlib.sha256(raw).hexdigest()==TH
 m=types.ModuleType('owned_transport');m.__file__=str(T);exec(compile(raw,str(T),'exec'),m.__dict__)
 c=json.loads(m.bound(C,CH,8192));g=json.loads(m.bound(G,GH,8192));assert g['status']=='approved' and g['authority']=='human' and g['additionalDeletionApproved']is False
 pkg='/usr/local/lib/proofofwork-audit30-pin-promotion/20261003T144000Z'
 argv=['/usr/bin/python3','-I','-B',pkg+'/promotion.py','--plan',pkg+'/plan.json','--plan-sha256',PS,'--self-sha256',SS]
 assert c['status']=='prepared-only' and c['promotionExecuted']is False and c['requestSha256']=='f91ba6037c3a24e3b92ee2c9218ded603998c6c0c443e0702d7a5ef7c17d3c1a' and c['planSha256']==PS and c['nextCommand']==argv
 result=m.execute(m.SSH+['sudo -n '+shlex.join(argv)],b'','/tmp/pow-audit30-coupled-pin-checker-promotion-native-144000-v1',150,stdout_cap=65536,stderr_cap=65536,bindings={'actualDirectHumanProvenanceSHA256':GH,'actualCreatorStdoutSHA256':CH,'planSHA256':PS,'controllerSHA256':SS,'approvalSHA256':'46c60e55ab4b95a4b0f51d2efa17969466417c0ad53b8542a0de26667825b089','rootGO':True,'exactTwoFilePromotionAuthorized':True,'knownByteFailureInverseAuthorized':True,'additionalDeletionAuthorized':False,'recoveryActivationAuthorized':False,'productionDatabaseMutationRequested':False})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
