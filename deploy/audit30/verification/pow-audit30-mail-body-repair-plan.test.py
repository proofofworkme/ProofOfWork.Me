#!/usr/bin/python3 -I
import base64,copy,hashlib,importlib.util,json,os,pathlib,tempfile,unittest
P=pathlib.Path('/tmp/pow-audit30-mail-body-repair-plan.py');s=importlib.util.spec_from_file_location('builder',P);B=importlib.util.module_from_spec(s);s.loader.exec_module(B)
C=B.load_census('/tmp/pow-audit30-mail-body-census.py');WRAP='a'*64;ENGINE='c'*64
spec=importlib.util.spec_from_file_location('fixture','/tmp/pow-audit30-mail-body-census.test.py');F=importlib.util.module_from_spec(spec);spec.loader.exec_module(F)
def make(rows=None,mutate=None):
 rows=rows or [F.row()]
 rows=copy.deepcopy(rows)
 for i,r in enumerate(rows):
  r['txid']=format(i+1,'064x');r['mail']['txid']=r['txid'];r['events'][0].update(network='livenet',txid=r['txid'],valid=True,protocol='pwm1');r['events'][0]['payload']['txid']=r['txid']
 snapshot=dict(phase='snapshot',transactionReadOnly='on',snapshot='1:2:',atUtc='2026-10-03T00:00:00+00:00',canonicalTip=dict(height=100,hash='b'*64),meta=[],mailRows=len(rows),renderedEventRows=len(rows))
 class Core:
  def verify(self,r,ops):return dict(blockHash=r['transaction']['blockHash'],blockHeight=r['transaction']['blockHeight'],blockIndex=r['transaction']['blockIndex'],coreScriptsBound=True)
 pubrows=[C.census_record(r,Core()) for r in rows];counts={}
 for r in pubrows:
  counts[r['status']]=counts.get(r['status'],0)+1
  for k,v in [('repairCandidates',r['bodyOnlyRepairCandidate']),('byteDifferences',not r['storedBytesEqualRaw']),('nullEmptyEquivalent',r['nullEmptyByteEquivalent'])]:counts[k]=counts.get(k,0)+int(v)
 pub=dict(schema='pow-audit30-mail-body-census-v1',ok=True,coreVerified=True,errors=[],sourceSha256=B.FROZEN_SHA,snapshot={k:v for k,v in snapshot.items() if k!='meta'}|{'metaSha256':C.h(C.canonical([]))},rows=pubrows,counts=counts,allStoredBodiesByteExact=counts.get('byteDifferences',0)==0,coreTipBefore=dict(blocks=100,bestblockhash='b'*64),coreTipAfter=dict(blocks=100,bestblockhash='b'*64))
 head=dict(phase='private-capture-header',schema='pow-audit30-mail-private-sql-lines-v1',frozenCensusSHA256=B.FROZEN_SHA,wrapperSHA256=WRAP,sqlSHA256=B.sha(C.SQL.replace("SET LOCAL statement_timeout='60s';","SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='60s';",1).encode()))
 rawrows=[B.encoded(snapshot)]+[B.encoded(dict(phase='row',**r)) for r in rows]
 env=[head]+[dict(phase='private-sql-line',recordBase64=base64.b64encode(r).decode(),recordSHA256=B.sha(r)) for r in rawrows]
 publicbytes=B.encoded(pub);env.append(dict(phase='private-capture-footer',status='complete',records=len(rawrows),publicCensusBase64=base64.b64encode(publicbytes).decode(),publicCensusSHA256=B.sha(publicbytes)))
 if mutate:mutate(env,pub,rows)
 return b'\n'.join(B.encoded(x) for x in env)+b'\n'
def edit_public(env,fn):
 p=B.parse(base64.b64decode(env[-1]['publicCensusBase64']));fn(p);b=B.encoded(p);env[-1]['publicCensusBase64']=base64.b64encode(b).decode();env[-1]['publicCensusSHA256']=B.sha(b)
class Test(unittest.TestCase):
 def test_candidate_exact_private_preimage_and_public_no_body(self):
  p=B.build(make(),C,WRAP,ENGINE);self.assertEqual(p['targets'][0]['oldBody'],'x');self.assertEqual(p['targets'][0]['newBody'],' x\n');self.assertEqual(p['manifest']['targetCount'],1);self.assertNotIn('sender_address',B.encoded(p['manifest']).decode());self.assertNotIn('subject',B.encoded(p['manifest']).decode());self.assertNotIn(' x\\n',B.encoded(p['manifest']).decode());self.assertFalse(p['manifest']['productionApplyApproved']);self.assertEqual(p['manifestSHA256'],B.sha(B.encoded(p['manifest'])))
 def test_whitespace_null_genuine_inverse_preimage(self):
  p=B.build(make([F.row('\n',None)]),C,WRAP,ENGINE);self.assertIsNone(p['targets'][0]['oldBody']);self.assertEqual(p['targets'][0]['newBody'],'\n')
 def test_null_empty_pending_nontrim_are_not_targets(self):
  p=B.build(make([F.row('',None),F.row('',''),F.row(status='pending'),F.row(stored='other')]),C,WRAP,ENGINE);self.assertEqual(p['targets'],[]);self.assertEqual(p['manifest']['populationRows'],4)
 def test_forms_preserve_literal_subject_and_kind(self):
  for kind in C.KINDS:
   r=F.row(' Subject: literal\r\n','Subject: literal');r['events'][0]['kind']=kind;r['events'][0]['payload']['kind']=kind
   p=B.build(make([r]),C,WRAP,ENGINE);self.assertEqual(p['targets'][0]['newBody'],' Subject: literal\r\n');self.assertEqual(p['manifest']['targets'][0]['proof']['kind'],kind)
 def test_capture_and_public_digest_tamper_refuse(self):
  for f in [lambda e,p,r:e[1].update(recordSHA256='0'*64),lambda e,p,r:e[-1].update(publicCensusSHA256='0'*64)]:
   with self.assertRaises(ValueError):B.build(make(mutate=f),C,WRAP,ENGINE)
 def test_failure_or_no_core_cannot_plan(self):
  for f in [lambda e,p,r:e[-1].update(status='failed'),lambda e,p,r:edit_public(e,lambda p:p.update(coreVerified=False)),lambda e,p,r:edit_public(e,lambda p:p.update(ok=False))]:
   with self.assertRaises(ValueError):B.build(make(mutate=f),C,WRAP,ENGINE)
 def test_public_rehashed_false_eligibility_or_core_proof_refuse(self):
  for f in [lambda p:p['rows'][0].update(bodyOnlyRepairCandidate=False),lambda p:p['rows'][0]['canonicalCore'].update(blockHash='f'*64),lambda p:p['counts'].update(repairCandidates=0),lambda p:p['snapshot'].update(mailRows=2)]:
   with self.assertRaises(ValueError):B.build(make(mutate=lambda e,p,r:edit_public(e,f)),C,WRAP,ENGINE)
 def test_wrong_sources_refuse(self):
  for f in [lambda e,p,r:e[0].update(wrapperSHA256='f'*64),lambda e,p,r:e[0].update(frozenCensusSHA256='f'*64),lambda e,p,r:e[0].update(sqlSHA256='f'*64)]:
   with self.assertRaisesRegex(ValueError,'CAPTURE_SOURCE_BINDING'):B.build(make(mutate=f),C,WRAP,ENGINE)
 def test_duplicate_keys_refuse(self):
  with self.assertRaisesRegex(ValueError,'DUPLICATE_JSON_KEY'):B.parse(b'{"a":1,"a":2}')
 def test_capture_order_duplicate_population_refuse(self):
  raw=make([F.row(),F.row()]);env=[B.parse(x) for x in raw.splitlines()];env[2],env[3]=env[3],env[2]
  with self.assertRaises(ValueError):B.build(b'\n'.join(B.encoded(x) for x in env)+b'\n',C,WRAP,ENGINE)
 def test_exact_source_json_number_lexeme_survives(self):
  raw=make();env=[B.parse(x) for x in raw.splitlines()];line=base64.b64decode(env[2]['recordBase64']);line=line[:-1]+b',"wide":9007199254740993.1234567890123456789}';env[2]['recordBase64']=base64.b64encode(line).decode();env[2]['recordSHA256']=B.sha(line)
  p=B.build(b'\n'.join(B.encoded(x) for x in env)+b'\n',C,WRAP,ENGINE);self.assertIn(b'9007199254740993.1234567890123456789',base64.b64decode(p['sourceRows'][0]['recordBase64']))
 def test_genuine_private_read_old_atime_without_false_refusal(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'private';p.write_bytes(b'exact');p.chmod(0o600);os.utime(p,ns=(1,p.stat().st_mtime_ns));before=p.stat()
   self.assertEqual(B.private_read(str(p),B.sha(b'exact'),False),b'exact');self.assertEqual(p.stat().st_atime_ns,1);self.assertEqual(p.stat().st_mtime_ns,before.st_mtime_ns)
 def test_private_content_drift_hash_refuses_even_same_length(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'private';p.write_bytes(b'wrong');p.chmod(0o600)
   with self.assertRaisesRegex(ValueError,'PRIVATE_FILE_CHANGED'):B.private_read(str(p),B.sha(b'exact'),False)
 def test_target_bound_no_partial_plan(self):
  with unittest.mock.patch.object(B,'MAX_TARGETS',0):
   with self.assertRaisesRegex(ValueError,'TARGET_COUNT_BOUND'):B.build(make(),C,WRAP,ENGINE)
if __name__=='__main__':
 import unittest.mock
 unittest.main()
