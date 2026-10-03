#!/usr/bin/python3 -I
"""Pinned source-only journal diagnostic caller. One Root native GO remains separate."""
import hashlib,json,sys,types
from pathlib import Path
H=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');HP='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
S=Path('/tmp/pow-audit30-logical-backup-journal-bounded-v1.py');SP='2ee1325efd52165b50af455b9ace39f6b377757237a5bdf427eb4cbcaee117fa'
R=Path('/tmp/pow-audit30-logical-backup-rotation-readonly-request-v3.json');RP='a20fa1719319c9a5c0059471bcff75bbe101ee502727dd594ea1615125972c00'
def main():
 if not sys.flags.isolated or len(sys.argv)!=1:raise ValueError('Fixed isolated diagnostic caller')
 raw=H.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HP:raise ValueError('Exact shared owned transport')
 m=types.ModuleType('reviewed_owned_transport');m.__file__=str(H);exec(compile(raw,str(H),'exec'),m.__dict__);source=m.bound(S,SP,32768);request=m.bound(R,RP,65536)
 d=types.ModuleType('reviewed_journal_diagnostic');d.__file__=str(S);exec(compile(source,str(S),'exec'),d.__dict__);d.C.load(json.loads(request,object_pairs_hook=d.C.pairs))
 result=m.execute(m.remote_command(source,RP),request,'/tmp/pow-audit30-logical-backup-journal-bounded-native-v1',120,stdout_cap=65536,stderr_cap=65536,bindings={'sourceSHA256':SP,'requestSHA256':RP,'utilitySHA256':HP,'rootWholeSeconds':90,'inheritedAddressSpaceBytes':1024*1024**2,'fixedJournalWholeSeconds':20,'sourceOnlyGOStillSeparate':True,'unitCreationOrControl':False,'sqlExecuted':False,'coreRequests':0,'rotationPASSClaimed':False})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
