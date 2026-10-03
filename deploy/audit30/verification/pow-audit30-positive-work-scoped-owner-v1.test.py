#!/usr/bin/python3 -I -B
"""Pure source/custody contract fixtures; no native or production invocation."""
import base64,datetime,hashlib,importlib.util,json,pathlib,unittest
spec=importlib.util.spec_from_file_location('owner','/tmp/pow-audit30-positive-work-scoped-owner-v1.py');M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
F=M.load(pathlib.Path('/tmp/pow-audit30-postcutover-production-strict-v1.py').read_bytes())
def request(mode='shadow'):
 binding={'lease':{'path':str(F['ROOT']/'shadow-lease-v3-prepared.json'),'sha256':'a'*64},'strictAccepted':{'path':'/data/proofofwork-audit29-verify-launch-'+M.RELEASE+'-shadow-strict-v3/accepted-receipt.json','sha256':'b'*64}}if mode=='shadow'else{'cutover':{'path':'/data/proofofwork-audit29-cutover-'+M.RELEASE+'-accepted/009-final.json','sha256':'c'*64}}
 return {'schema':'pow-audit30-positive-scoped-owner-request-v1','mode':mode,'binding':binding,'supervisorBase64':base64.b64encode(pathlib.Path('/tmp/pow-audit30-postcutover-production-strict-v1.py').read_bytes()).decode(),'leafBase64':base64.b64encode(pathlib.Path('/tmp/pow-audit30-positive-work-scoped-leaf-v1.mjs').read_bytes()).decode()}
def leaf(mode='shadow'):
 predicates={str(i):True for i in range(16)}
 return {'schema':'pow-audit30-positive-work-complete-scoped-listings-v1','ok':True,'candidate':F['CANDIDATE'],'mode':mode,'network':'livenet','base':'http://127.0.0.1:18081'if mode=='shadow'else F['BASE'],'authority':'http://127.0.0.1:18081'if mode=='shadow'else F['AUTHORITY'],'productionMutation':False,'timerChanges':False,'privateContentsExported':False,'positiveWork':[{'status':200,'ready':True,'balanceVerified':True,'capacityVerified':True,'positiveConfirmed':True,'predicateCount':16,'predicates':predicates,'confirmedBalanceSubatoms':'1'}for _ in range(2)],'scopedListings':[{'symbol':s,'complete':True,'ready':True,'totalCount':0,'pages':[{'complete':True,'verifiedThrough':0}]}for s in ['POWB','INCB']]}
class Tests(unittest.TestCase):
 def test_exact_reviewed_two_mode_request_sources(self):
  for mode in ['shadow','production']:
   a,b=M.parse_request(request(mode));self.assertEqual(M.sha(a),M.SUPERVISOR_SHA);self.assertEqual(M.sha(b),M.LEAF_SHA)
 def test_tampered_source_and_unknown_scope_fail(self):
  for key in ['leafBase64','supervisorBase64']:
   r=request();r[key]=base64.b64encode(b'changed').decode()
   with self.assertRaises(ValueError):M.parse_request(r)
  r=request();r['binding']['cutover']=r['binding']['lease']
  with self.assertRaises(ValueError):M.parse_request(r)
 def test_all_positive_wallet_flags_and_sixteen_required(self):
  M.validate_leaf_result(leaf(),'shadow',F)
  for field in ['status','ready','balanceVerified','capacityVerified','positiveConfirmed','predicateCount','confirmedBalanceSubatoms']:
   r=leaf();r['positiveWork'][0][field]=503 if field=='status'else False
   with self.assertRaises(ValueError):M.validate_leaf_result(r,'shadow',F)
 def test_all_complete_scoped_books_required(self):
  r=leaf();r['scopedListings'][1]['complete']=False
  with self.assertRaises(ValueError):M.validate_leaf_result(r,'shadow',F)
  r=leaf();r['scopedListings'][0]['pages'][0]['verifiedThrough']=1
  with self.assertRaises(ValueError):M.validate_leaf_result(r,'shadow',F)
 def test_public_https_production_origin_exact(self):
  r=leaf('production');M.validate_leaf_result(r,'production',F);r['base']='http://127.0.0.1:8081'
  with self.assertRaises(ValueError):M.validate_leaf_result(r,'production',F)
 def test_fixed_private_helpers_and_bound_runtime_contracts(self):
  source=pathlib.Path(M.__file__).read_text()
  for fragment in ["V['readonly_plan']", "V['stream_child']", "ops['backup_install_window']", "V['operations_lock']", "F['fresh_capture']", "'--max-old-space-size=1024'", "env,account,330", "WHOLE=780", "'RuntimeMaxUSec')=='15min'", "'MemorySwapMax':'0'", "'CPUQuotaPerSecUSec':'1s'", "'TasksMax':'128'"]:
   self.assertIn(fragment,source)
  self.assertEqual(F['PINS']['private-verify.py'],'8a569828272b10abc8848dd01678a1a3b45002acd489802f89b6e056de3e0c1e')
  self.assertEqual(F['PINS']['private-env.py'],'99cbe9cd118c63b08480efd28c2ae7c059b5204daef8db08b896a38fc791d515')
if __name__=='__main__':unittest.main()
