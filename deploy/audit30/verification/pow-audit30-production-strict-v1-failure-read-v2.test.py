#!/usr/bin/python3 -I -B
import ast,copy,datetime,re,importlib.util,pathlib,unittest
P=pathlib.Path('/tmp/pow-audit30-production-strict-v1-failure-read-v2.py')
s=importlib.util.spec_from_file_location('failure_projection_fixture',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Projection(unittest.TestCase):
 def receipt(self):
  return {'format':'audit29-candidate-readonly-v1','candidate':m.CANDIDATE,'ok':False,'mode':'production','network':'livenet','base':'https://api.proofofwork.me','authority':'http://127.0.0.1:8081','gates':{'ids':True,'events':False,'parity':False},'failure':'CORE_CHECKPOINT_MOVED','originalFailure':'STRICT_GATE_FAILED','needsAttention':'moving-checkpoint-preserve-attempt-before-bounded-retry','checkpointBefore':{'height':1,'hash':'a'*64},'checkpointAfter':{'height':2,'hash':'b'*64},'gateReceipts':{},'environment':{'secret':'never-export'}}
 def test_fence_and_original_failure_preserved(self):
  row=m.driver(self.receipt());self.assertEqual(row['failure'],'CORE_CHECKPOINT_MOVED');self.assertEqual(row['originalFailure'],'STRICT_GATE_FAILED');self.assertNotIn('environment',row)
 def test_false_warning_and_error_remain_distinct(self):
  row=m.gate({'checks':[{'name':'warning-label','ok':False,'severity':'warning'},{'name':'error-label','ok':False,'severity':'error'},{'name':'All Events Pass','ok':True,'severity':'error'}]});self.assertEqual(row['observedCheckCount'],3);self.assertEqual([x['severity']for x in row['failedChecks']],['warning','error'])
 def test_nonpublic_check_name_is_hash_only(self):
  row=m.gate({'checks':[{'name':'private\ntext','ok':False,'severity':'error'}]})['failedChecks'][0];self.assertNotIn('name',row);self.assertFalse(row['nameExported'])
 def test_candidate_or_boolean_mismatch_refuses(self):
  for key,value in [('candidate',{}),('gates',{'ids':1,'events':False,'parity':False})]:
   row=self.receipt();row[key]=value
   with self.assertRaises(ValueError):m.driver(row)
 def test_raw_http_payload_is_omitted(self):
  row=m.reads([{'route':'/api/v1/token','status':503,'bytes':123,'sha256':'c'*64,'payload':{'secret':'never-export'}}]);self.assertEqual(set(row[0]),{'route','status','bytes','sha256'});self.assertEqual(row[0]['status'],503)
 def test_positive_failure_keeps_only_closed_metadata(self):
  row={'schema':'pow-audit30-positive-work-complete-scoped-listings-v1','candidate':m.CANDIDATE,'ok':False,'mode':'production','network':'livenet','base':'https://api.proofofwork.me','authority':'http://127.0.0.1:8081','privateContentsExported':False,'failure':'SOURCE_HELPER_OR_TRANSPORT_REFUSED','errorClass':'Error','reads':[],'positiveWork':[],'scopedListings':[],'secret':'never-export'}
  result=m.positive(row);self.assertEqual(result['completedWalletReadCount'],0);self.assertNotIn('secret',result)
 def test_optional_timer_flag_preserves_null_and_rejects_payload(self):
  for value in(None,True,False):self.assertIs(m.optional_flag(value),value)
  for value in('private',{'private':'text'}):
   with self.assertRaises(ValueError):m.optional_flag(value)
 def test_timer_grammar_matches_exact_frozen_ops_generated_token(self):
  tree=ast.parse(P.read_text());patterns=[x.args[0].value for x in ast.walk(tree) if isinstance(x,ast.Call) and isinstance(x.func,ast.Attribute) and x.func.attr=='fullmatch' and x.args and isinstance(x.args[0],ast.Constant) and isinstance(x.args[0].value,str) and x.args[0].value.startswith('backup-window-')]
  self.assertEqual(len(patterns),1);pattern=patterns[0]
  token=datetime.datetime(2026,10,3,20,3,42,947626,tzinfo=datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
  self.assertTrue(re.fullmatch(pattern,'backup-window-'+token+'.restored.json'))
  for name in ['backup-window-20261003T200342Z.restored.json','backup-window-20261003T200342_947626Z.restored.json','backup-window-20261003T200342.947626Z.restored.json.extra']:
   self.assertIsNone(re.fullmatch(pattern,name))
if __name__=='__main__':unittest.main()
