#!/usr/bin/python3 -I -B
"""Exact inverse byte comparisons and existing canonical production origin admission."""
import ast,hashlib,importlib.util,pathlib,unittest
B=pathlib.Path('/tmp')
S='24136b6787754a2f9958b2a48ede208fcf8c9b546dbef7a4fb9be2033f8df1a9'
L='ba9d8f33b315e297dcf9239dffe943de275cc3dc2c2de67b5ae58ad02b14c18c'
O='cc345910263fcc788a2548253ee5fa21a59f50620eb99fc779d9684b82a320f1'
T='c16fd09ea1a164b630d483be481b09993ae83c29763b7e3124021c2b3cccbbe1'
class ExactDiff(unittest.TestCase):
 def reverse(self,stem,ext,pin,replacements):
  old=(B/(stem+'-v1.'+ext)).read_bytes();new=(B/(stem+'-v2.'+ext)).read_bytes();self.assertEqual(hashlib.sha256(new).hexdigest(),pin)
  for a,b,count in replacements:
   self.assertEqual(new.count(a.encode()),count);new=new.replace(a.encode(),b.encode())
  self.assertEqual(new,old)
  if ext=='py':self.assertEqual(ast.dump(ast.parse(new),include_attributes=False),ast.dump(ast.parse(old),include_attributes=False))
 def test_strict_only_canonical_origin_and_unique_production_namespace(self):
  self.reverse('pow-audit30-postcutover-production-strict','py',S,[('https://computer.proofofwork.me','https://api.proofofwork.me',1),('production-strict-v2','production-strict-v1',3)])
 def test_leaf_only_one_production_url(self):
  self.reverse('pow-audit30-positive-work-scoped-leaf','mjs',L,[('https://computer.proofofwork.me','https://api.proofofwork.me',1)])
 def test_owner_only_exact_links_lengths_and_production_paths(self):
  self.reverse('pow-audit30-positive-work-scoped-owner','py',O,[(S,'4eed6eae5b5a4bd7cd5a29c500b90cdf748dda7ffaab4f90b79daeffc01ed6a4',1),(L,'42b7ccbe8c4bf22d05bc8b808dabad72cb2cb09455f1156c10cd313001fbea06',1),('len(leaf)==37077','len(leaf)==37072',1),('postcutover-production-strict-v2.py','postcutover-production-strict-v1.py',1),("unit='proofofwork-audit30-positive-scoped-'+RELEASE+'-'+mode+('-v1.service'if mode=='shadow'else'-v2.service')","unit='proofofwork-audit30-positive-scoped-'+RELEASE+'-'+mode+'-v1.service'",1),("token=RELEASE+'-'+mode+('-v1'if mode=='shadow'else'-v2')","token=RELEASE+'-'+mode+'-v1'",1)])
 def test_transport_only_source_links_and_unique_positive_namespace(self):
  self.reverse('pow-audit30-production-acceptance-transport','py',T,[('postcutover-production-strict-v2.py','postcutover-production-strict-v1.py',2),('positive-work-scoped-owner-v2.py','positive-work-scoped-owner-v1.py',2),('positive-work-scoped-leaf-v2.mjs','positive-work-scoped-leaf-v1.mjs',1),(S,'4eed6eae5b5a4bd7cd5a29c500b90cdf748dda7ffaab4f90b79daeffc01ed6a4',2),(O,'28bd89f9e0e9abf953a579018d1224bc51b00a5615dc42812f321050ac598cd9',3),(L,'42b7ccbe8c4bf22d05bc8b808dabad72cb2cb09455f1156c10cd313001fbea06',1),("+'-production-v2.service'","+'-production-v1.service'",1),("+'-production-v2')","+'-production-v1')",1)])
 def test_computer_is_existing_installed_private_verifier_production_allowlist(self):
  source=pathlib.Path('/home/sixer/ProofOfWork.Me/deploy/audit29/private-verify.py');self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),'8a569828272b10abc8848dd01678a1a3b45002acd489802f89b6e056de3e0c1e')
  spec=importlib.util.spec_from_file_location('exact_private_verify',source);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  cwd,authority=m.role('production','38ac6e2bff2a-20261003T042000Z','https://computer.proofofwork.me')
  self.assertEqual(str(cwd),'/opt/proofofwork-api');self.assertEqual(authority,'http://127.0.0.1:8081')
if __name__=='__main__':unittest.main()
