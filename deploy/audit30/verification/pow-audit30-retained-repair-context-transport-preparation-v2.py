#!/usr/bin/python3 -I
"""Fixed metadata context caller preparation; one separate Root GO is required."""
import hashlib,json,sys,types
from pathlib import Path
H=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');HP='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
N=Path('/tmp/pow-audit30-oct2-full-read-current-context-v2.py');NP='69179562d28eeabe1a6bcbf6ba2c506bf95e6d8ce02a79c20fc882dbe741b839'
R=Path('/tmp/pow-audit30-oct2-full-read-current-context-request-v2.json');RP='5b0957e3cce7fb5a64c4d82b58808faedc5d6c0147a874c22d938c05536d44dd'
PREFIX='/tmp/pow-audit30-retained-repair-context-native-v2'
def transport():
 raw=H.read_bytes()
 if len(raw)>16384 or hashlib.sha256(raw).hexdigest()!=HP:raise ValueError('Exact shared owned transport')
 m=types.ModuleType('reviewed_owned_transport');m.__file__=str(H);exec(compile(raw,str(H),'exec'),m.__dict__);return m
def main():
 if not sys.flags.isolated or len(sys.argv)!=1:raise ValueError('Fixed isolated metadata context caller')
 m=transport();source=m.bound(N,NP,8192);r=m.bound(R,RP,65536);c=types.ModuleType('reviewed_current_context');c.__file__=str(N);exec(compile(source,str(N),'exec'),c.__dict__);c.load_native(json.loads(r,object_pairs_hook=c.pairs))
 result=m.execute(m.remote_command(source),r,PREFIX,90,stdout_cap=65536,stderr_cap=65536,bindings={'contextSourceSha256':NP,'requestSha256':RP,'utilitySha256':HP,'managedSourceSha256':c.NATIVE_SHA,'rootMaximumSeconds':60,'contextAddressSpaceBytes':128*1024**2,'contextCpuSeconds':30,'metadataOnly':True,'historicalNamespaceOnly':c.RUN,'unitCreationOrControlPerformed':False,'fullBackupReadPerformed':False,'sqlExecuted':False,'bridgeBindingsNotModifiedByThisCaller':True,'bridgeAddressSpaceBytesDistinct':384*1024**2,'retirementAdmissionClaimed':False})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure'] is None else 1
if __name__=='__main__':raise SystemExit(main())
