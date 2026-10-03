#!/usr/bin/python3 -I
"""Pinned one production identity query. Root and peer native GO remain separate."""
import hashlib,json,sys,types
from pathlib import Path
H=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');HP='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
S=Path('/tmp/pow-audit30-production-pg-identity-readonly-v1.py');SP='73b0951f338909824a794973502c13cd44921140ac601d053bd2e9165c8b2110'
R=Path('/tmp/pow-audit30-production-pg-identity-readonly-request-v1.json');RP='a282861e4708eca86254dda7ecec906a84e97ad89d4f9e789ff8d027699bcb63'
def main():
 if not sys.flags.isolated or len(sys.argv)!=1:raise ValueError('Fixed isolated diagnostic caller')
 raw=H.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HP:raise ValueError('Exact shared owned transport')
 m=types.ModuleType('reviewed_owned_transport');m.__file__=str(H);exec(compile(raw,str(H),'exec'),m.__dict__);source=m.bound(S,SP,32768);request=m.bound(R,RP,65536)
 d=types.ModuleType('reviewed_journal_diagnostic');d.__file__=str(S);exec(compile(source,str(S),'exec'),d.__dict__);d.decode(request)
 result=m.execute(m.remote_command(source,RP),request,'/tmp/pow-audit30-production-pg-identity-readonly-native-v1',90,stdout_cap=65536,stderr_cap=65536,bindings={'sourceSHA256':SP,'requestSHA256':RP,'utilitySHA256':HP,'rootWholeSeconds':60,'inheritedAddressSpaceBytes':128*1024**2,'sourceOnlyGOStillSeparate':True,'unitCreationOrControl':False,'fixedReadOnlyIdentityQueries':1,'serverStatementSeconds':5,'serverLockSeconds':2,'serverIdleSeconds':10,'clientWholeSeconds':20,'rootCPUSeconds':30,'coreRequests':0,'sizingResultAccepted':False,'noUnitOrEvidenceDirectory':True})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
