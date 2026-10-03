#!/usr/bin/python3 -I
import copy,hashlib,importlib.util,json,os,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
def imported(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
R=imported('readonly_reconcile','/tmp/pow-audit30-private-sixteen-reconcile-readonly-v1.py')
G=imported('exact_frozen_guard','/home/sixer/ProofOfWork.Me/deploy/audit30/restore-latest-logical.py')
T=imported('existing_private_fixtures','/tmp/pow-audit30-private-sixteen-supervisor-v3.test.py')
class Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  assert hashlib.sha256(Path(G.__file__).read_bytes()).hexdigest()=='26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e'
  T.Tests.setUpClass()
 @classmethod
 def tearDownClass(cls):T.Tests.tearDownClass()
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.path=self.base/'receipt.json';self.path.write_bytes(b'{"known":true}');self.path.chmod(0o600)
 def tearDown(self):self.tmp.cleanup()
 def test_exact_original_metadata_only_expected_reproduces_keyerror(self):
  with self.assertRaisesRegex(KeyError,'sha256'):G.hash_file(self.path,G.metadata(self.path),65536)
 def test_actual_frozen_unknown_digest_and_pinned_second_read_succeed(self):
  m=G.metadata(self.path);h=G.hash_file(self.path,None,65536)
  self.assertEqual(h,hashlib.sha256(self.path.read_bytes()).hexdigest());self.assertEqual(G.metadata(self.path),m);self.assertEqual(G.hash_file(self.path,m|{'sha256':h},65536),h)
 def test_actual_frozen_second_read_refuses_changed_bytes_or_metadata(self):
  m=G.metadata(self.path);h=G.hash_file(self.path,None,65536);self.path.write_bytes(b'{"known":false}')
  with self.assertRaises(ValueError):G.hash_file(self.path,m|{'sha256':h},65536)
 def test_actual_frozen_wrong_digest_refuses(self):
  with self.assertRaises(ValueError):G.hash_file(self.path,G.metadata(self.path)|{'sha256':'0'*64},65536)
 def test_actual_frozen_symlink_and_hardlink_refuse(self):
  alias=self.base/'alias';alias.symlink_to(self.path)
  with self.assertRaises(ValueError):G.hash_file(alias,None,65536)
  alias.unlink();os.link(self.path,alias)
  with self.assertRaises(ValueError):G.hash_file(self.path,None,65536)
 def unknown(self,path):
  p=types.SimpleNamespace(G=G,I=T.P.I);real_meta=G.metadata
  with patch.object(G,'metadata',side_effect=lambda x:real_meta(x)|{'uid':108,'gid':112}),patch.object(p.I,'G',G):return R.unknown_json(p,path)
 def test_real_unknown_json_binds_digest_metadata_and_rejects_duplicate_keys(self):
  value,binding=self.unknown(self.path);self.assertEqual(value,{'known':True});self.assertEqual(binding['sha256'],hashlib.sha256(self.path.read_bytes()).hexdigest())
  self.path.write_bytes(b'{"known":true,"known":false}')
  with self.assertRaisesRegex(ValueError,'Duplicate'):self.unknown(self.path)
 def test_real_unknown_reader_refuses_discovery_to_secondread_drift(self):
  actual=G.hash_file;calls=0
  def changed(path,*args,**kw):
   nonlocal calls
   result=actual(path,*args,**kw);calls+=1
   if calls==1:path.write_bytes(b'{"known":false}')
   return result
  with patch.object(G,'hash_file',side_effect=changed),self.assertRaisesRegex(ValueError,'metadata drift'):self.unknown(self.path)
 def verifier(self):
  raw=Path('/tmp/pow-audit30-private-sixteen-supervisor-v3.py').read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),R.SOURCE_SHA);self.assertEqual(raw.count(R.OLD.encode()),1)
  p=types.ModuleType('corrected_definitions');p.__file__=str(self.base/'controller.py');exec(compile(raw.replace(R.OLD.encode(),R.NEW.encode()),p.__file__,'exec'),p.__dict__);p.G=G;p.I=T.P.I;p.S=T.P.S;return p
 def fixture(self):
  p=self.verifier();t=T.Tests();plan,v,rows,targetsha=t.proof_fixture();p.TARGETS_SHA=targetsha;p.WORK=self.base
  fingerprint=lambda count,sha:dict(count=count,logical_bytes='100',sha256=sha*64)
  initial=dict(meta=fingerprint(1,'3'),queue=fingerprint(0,'4'),shards=fingerprint(64,'5'))
  middle=copy.deepcopy(initial);middle['shards']['sha256']='6'*64
  final=copy.deepcopy(initial);final['shards']['sha256']='7'*64
  for operation,a,b in [('apply',initial,middle),('inverse',middle,final)]:
   row=rows[operation+'-completed.json'];row['wholeMilliseconds']=100;v[operation+'ReceiptSHA256']=p.sha(p.encoded(row));j=rows[operation+'-commit-intent.json'];j.update(beforeJournal=copy.deepcopy(a),afterJournal=copy.deepcopy(b),operationalShard=row['operationalShard'],operationalEpochBefore=row['operationalEpochBefore'],operationalEpochAfter=row['operationalEpochAfter'])
  # New apply raw SHA is bound by the separate inverse admission, exactly as the
  # real producer does. Private plan/admission source pins stay fixture-only.
  a=rows['private-sixteen-write-admission.json'];rows['inverse-completed.json']['admissionSHA256']=p.sha(p.encoded(a|{'operation':'inverse','priorAcknowledgedApplyReceiptSHA256':v['applyReceiptSHA256']}));v['inverseReceiptSHA256']=p.sha(p.encoded(rows['inverse-completed.json']));return p,plan,v,rows
 def write(self,p,rows):
  for name,row in rows.items():
   path=self.base/name;path.write_bytes(p.encoded(row));path.chmod(0o600)
 def proof(self,p,plan,v,rows):
  self.write(p,rows);real_meta=G.metadata;real_read=p.I.read_json
  def projected_meta(path):
   # Role mapping only for local unprivileged fixtures. The exact frozen hash
   # helper, FD/path checks, bytes and mutation checks all remain real.
   return real_meta(path)|{'uid':108,'gid':112}
  def read(path,h,**kw):
   if Path(path).name in('phase4-private-plan.json','private-sixteen-write-admission.json'):return(rows[Path(path).name],{})
   return real_read(path,h,**kw)
  with patch.object(G,'metadata',side_effect=projected_meta),patch.object(p.I,'G',G),patch.object(p.I,'read_json',side_effect=read):return p.proof_result(v,plan,self.base)
 def test_complete_saved_acknowledgements_use_actual_hash_helper(self):
  p,plan,v,rows=self.fixture();self.assertEqual(self.proof(p,plan,v,rows),v);self.assertTrue(R.journals(p,rows)['journalBetweenCommitsExact'])
 def test_missing_acknowledgement_refuses(self):
  p,plan,v,rows=self.fixture();rows['inverse-completed.json']['commitAcknowledged']=False;v['inverseReceiptSHA256']=p.sha(p.encoded(rows['inverse-completed.json']))
  with self.assertRaises(ValueError):self.proof(p,plan,v,rows)
 def test_cross_transaction_mail_drift_refuses(self):
  p,plan,v,rows=self.fixture();rows['inverse-commit-intent.json']['afterMail']=rows['inverse-commit-intent.json']['afterMail']|{'sha256':'e'*64}
  with self.assertRaisesRegex(ValueError,'not restored'):self.proof(p,plan,v,rows)
 def test_wrong_target_order_refuses(self):
  p,plan,v,rows=self.fixture();rows['inverse-completed.json']['orderedTargetTxids'].reverse();v['inverseReceiptSHA256']=p.sha(p.encoded(rows['inverse-completed.json']))
  with self.assertRaises(ValueError):self.proof(p,plan,v,rows)
 def test_readiness_journal_drift_unknown_fields_or_wrong_epoch_refuse(self):
  p,_,_,rows=self.fixture()
  for mutate in [lambda r:r['inverse-commit-intent.json']['beforeJournal']['meta'].update(sha256='e'*64),lambda r:r['apply-commit-intent.json'].update(unexpected=True),lambda r:r['inverse-commit-intent.json'].update(operationalEpochAfter='9'),lambda r:r['apply-commit-intent.json']['afterJournal']['queue'].update(count=1)]:
   r=copy.deepcopy(rows);mutate(r)
   with self.subTest(mutate=mutate),self.assertRaises(ValueError):R.journals(p,r)
 def test_true_integer_and_original45second_bound(self):
  p,_,_,rows=self.fixture()
  for x in(True,-1,45001):
   r=copy.deepcopy(rows);r['apply-completed.json']['wholeMilliseconds']=x
   with self.subTest(x=x),self.assertRaises(ValueError):R.journals(p,r)
 def test_incorrect_original_source_correction_contract_refuses(self):
  raw=Path('/tmp/pow-audit30-private-sixteen-supervisor-v3.py').read_bytes();self.assertEqual(raw.count(R.OLD.encode()),1);self.assertNotIn(R.NEW.encode(),raw)
  self.assertNotEqual(hashlib.sha256(raw.replace(R.OLD.encode(),R.NEW.encode())).hexdigest(),R.SOURCE_SHA)
if __name__=='__main__':unittest.main()
