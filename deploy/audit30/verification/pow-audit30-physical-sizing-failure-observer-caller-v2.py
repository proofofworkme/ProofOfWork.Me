#!/usr/bin/python3 -I
"""Pinned fixed sizing failure observer. One Root read-only GO remains separate."""
import hashlib,json,sys,types
from pathlib import Path
H=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');HP='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
S=Path('/tmp/pow-audit30-physical-sizing-failure-observer-v2.py');SP='dda2f87913b45c2d8054ff2cd0ec9b790b547ecb54a4b40218f598c9fa4545df'
R=Path('/tmp/pow-audit30-production-physical-sizing-request-v3.json');RP='776b518a08f9bcd0c86500d6b8f9115430d6140422495d74d74b610ba5123013'
def main():
 if not sys.flags.isolated or len(sys.argv)!=1:raise ValueError('Fixed isolated diagnostic caller')
 raw=H.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HP:raise ValueError('Exact shared owned transport')
 m=types.ModuleType('reviewed_owned_transport');m.__file__=str(H);exec(compile(raw,str(H),'exec'),m.__dict__);source=m.bound(S,SP,32768);request=m.bound(R,RP,65536)
 d=types.ModuleType('reviewed_journal_diagnostic');d.__file__=str(S);exec(compile(source,str(S),'exec'),d.__dict__);d.N.decode(request)
 result=m.execute(m.remote_command(source,RP),request,'/tmp/pow-audit30-physical-sizing-failure-observer-native-v2',90,stdout_cap=65536,stderr_cap=65536,bindings={'sourceSHA256':SP,'requestSHA256':RP,'utilitySHA256':HP,'rootWholeSeconds':60,'inheritedAddressSpaceBytes':128*1024**2,'sourceOnlyGOStillSeparate':True,'unitCreationOrControl':False,'sqlExecuted':False,'coreRequests':0,'sizingResultAccepted':False})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
