import copy,hashlib,importlib.util,json,types,unittest
from pathlib import Path
P=Path('/tmp/pow-audit30-retirement-custody-public-outcome-reader-v1.py');sp=importlib.util.spec_from_file_location('s',P);S=importlib.util.module_from_spec(sp);sp.loader.exec_module(S)
CP=Path('/tmp/pow-audit30-retirement-cluster-closure-v1.py');C=types.ModuleType('c');exec(compile(CP.read_bytes(),str(CP),'exec'),C.__dict__)
def fixture():
 targets=[];ct=[]
 for target in C.TARGETS:
  names=list(C.MEMBERS)if target==C.TARGETS[-1]else['PG_VERSION']
  rows=[dict(path=target,kind='directory',allocatedBytes=4096,bytes=4096)]
  hs=[]
  for n in names:
   row=dict(path=target+'/'+n,kind='file',allocatedBytes=4096,bytes=C.MEMBERS[n][0]if target==C.TARGETS[-1]else 2);rows.append(row);hs.append(dict(path=row['path'],sha256=C.MEMBERS[n][1]if target==C.TARGETS[-1]else'a'*64,metadataSha256=S.sha(S.enc(row))))
  a=C.allocation(rows);targets.append(dict(path=target,records=rows,metadataSha256=S.sha(S.enc(rows)),**a));ct.append(dict(path=target,fullFileHashes=hs,fullFileHashesSha256=S.sha(S.enc(hs)),metadataSha256=S.sha(S.enc(rows)),allRegularBytesHashed=True,**a))
 reader=dict(processes=7,fdEntries=3,metadataBytes=200,mountNamespaces=2,matches=[],vanishedProcesses=[],fdCloseRaces=0,qualifiedKernelThreads=2,completeForObservedLiveProcesses=True,qualification='Endpoints only')
 retained=[]
 for job in C.JOBS:
  rows=[dict(path=job+'/receipt.json',kind='file',allocatedBytes=4096,bytes=33)];hs=[dict(path=rows[0]['path'],sha256='b'*64)];retained.append(dict(jobRoot=job,excludedDeletionCandidate=job+'/cluster',metadataRecords=rows,metadataRecordsSha256=S.sha(S.enc(rows)),fullFileHashes=hs,fullFileHashesSha256=S.sha(S.enc(hs)),allThesePathsMustSurviveAnyClusterOnlyRetirement=True,**C.allocation(rows)))
 before=dict(schema='pow-audit30-retirement-root-custody-census-v1',targets=targets,retainedNonClusterEvidence=retained,privateControls=[],liveFive={},processReaders=reader,capacity={})
 result=dict(endpointsEqual=True,custodyOnly=True,deletionReady=False,continuousReadersExcluded=False,recoveryEquivalenceProven=False,allDependenciesClosed=False,source7=dict(completeRelativePathsEqual=True,fullFileBytesEqual=True,metadataEqual=True,sourceNeverStartedByThisTool=True,sourceSHA256='f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572'))
 done=dict(schema='pow-audit30-retirement-closure-native-outcome-v1',status='passed',failure=None,cleanup=dict(verified=True,ownedInvocation='a'*32),result=result,productionMutation=False,pinChanged=False,deletionAuthorized=False,autoRetry=False)
 content=dict(schema='pow-audit30-retirement-content-custody-v1',rootBeforeSha256=S.FILES['root-before.json'][1],planSha256=S.FILES['content-plan.json'][1],targets=ct,capacity={},actualResources={})
 plan=dict(rootBeforeSha256=S.FILES['root-before.json'][1],unit=S.UNIT)
 return {'completed.json':done,'root-before.json':before,'root-after.json':copy.deepcopy(before),'content.json':content,'content-plan.json':plan}
class Tests(unittest.TestCase):
 def test_valid_counts_and_retained_evidence(self):
  r=S.summarize(fixture(),C);self.assertEqual(len(r['targets']),4);self.assertEqual(r['targets'][-1]['regularFileCount'],3);self.assertEqual(len(r['retainedNonClusterEvidence']),3);self.assertEqual(r['source7']['sourceSHA256'],C.COLLECTOR_SHA if hasattr(C,'COLLECTOR_SHA')else'f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572')
 def test_missing_file_hash_refuses(self):
  v=fixture();v['content.json']['targets'][0]['fullFileHashes']=[]
  with self.assertRaises(S.Refused):S.summarize(v,C)
 def test_duplicate_hash_refuses(self):
  v=fixture();r=v['content.json']['targets'][0];r['fullFileHashes']*=2;r['fullFileHashesSha256']=S.sha(S.enc(r['fullFileHashes']))
  with self.assertRaises(S.Refused):S.summarize(v,C)
 def test_endpoint_drift_refuses(self):
  v=fixture();v['root-after.json']['targets'][0]['allocatedBytes']+=1
  with self.assertRaises(S.Refused):S.summarize(v,C)
 def test_reader_hit_refuses(self):
  v=fixture();v['root-after.json']['processReaders']['matches']=[{'pid':99}]
  with self.assertRaises(S.Refused):S.summarize(v,C)
 def test_old_dump_known_hash_must_match(self):
  v=fixture();r=v['content.json']['targets'][-1];r['fullFileHashes'][0]['sha256']='c'*64;r['fullFileHashesSha256']=S.sha(S.enc(r['fullFileHashes']))
  with self.assertRaises(S.Refused):S.summarize(v,C)
 def test_recovery_or_deletion_claim_refuses(self):
  for k in('deletionReady','recoveryEquivalenceProven','allDependenciesClosed','continuousReadersExcluded'):
   v=fixture();v['completed.json']['result'][k]=True
   with self.assertRaises(S.Refused):S.summarize(v,C)
 def test_source_seal_mismatch_refuses(self):
  v=fixture();v['completed.json']['result']['source7']['sourceSHA256']='d'*64
  with self.assertRaises(S.Refused):S.summarize(v,C)
 def test_retained_evidence_must_be_explicitly_preserved(self):
  v=fixture();v['root-before.json']['retainedNonClusterEvidence'][0]['allThesePathsMustSurviveAnyClusterOnlyRetirement']=False;v['root-after.json']=copy.deepcopy(v['root-before.json'])
  with self.assertRaises(S.Refused):S.summarize(v,C)
if __name__=='__main__':unittest.main()
