from pathlib import Path
import hashlib,json,difflib,types
oldp=Path('/tmp/pow-audit30-coupled-pin-checker-promotion-v5.py');olds=oldp.read_text();assert hashlib.sha256(oldp.read_bytes()).hexdigest()=='7e878f987524dce2583b348964032af62491ce3cabcdc49adc359b36b7fc5bd4'
cold=Path('/tmp/pow-audit30-retention-protection-oct3-candidate-v1.py');cs=cold.read_text();assert hashlib.sha256(cold.read_bytes()).hexdigest()=='f40b25f46c86541766c3e8694cf677b551fe489887dab72b4084991100d308d0'
a='names==[EXPECTED_LOGICAL_PIN]';b="names==['proof_indexer-20260929T031853Z.dumpset',EXPECTED_LOGICAL_PIN]";assert cs.count(a)==1;cs=cs.replace(a,b)
cp=Path('/tmp/pow-audit30-retention-protection-oct3-dual-pin-candidate-v1.py');cp.write_text(cs);ch=hashlib.sha256(cp.read_bytes()).hexdigest()
s=olds.replace('Version5 survivor-specific source-only caller for the exact Oct3 logical pin + checker promotion.','Version6 source-only staged protection: retain Sep29 and add the exact Oct3 pin + checker.')
s=s.replace("NEW_PIN=b'proof_indexer-20261003T031852Z.dumpset\\n'","NEW_PIN=OLD_PIN+b'proof_indexer-20261003T031852Z.dumpset\\n'")
s=s.replace("NEW_CHECKER='f40b25f46c86541766c3e8694cf677b551fe489887dab72b4084991100d308d0'","NEW_CHECKER='"+ch+"'")
s=s.replace('retention-checker-oct3.py','retention-checker-oct3-dual-pin.py')
p=Path('/tmp/pow-audit30-coupled-pin-checker-promotion-v6.py');p.write_text(s)
for before,after,out in[(oldp,p,'/tmp/pow-audit30-coupled-pin-checker-promotion-v6.diff'),(cold,cp,'/tmp/pow-audit30-retention-protection-oct3-dual-pin-candidate-v1.diff')]:Path(out).write_text(''.join(difflib.unified_diff(before.read_text().splitlines(True),after.read_text().splitlines(True),fromfile=before.name,tofile=after.name)))
m=types.ModuleType('v6_constants');m.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),m.__dict__)
t=json.loads(Path('/tmp/pow-audit30-coupled-pin-checker-promotion-plan-template-v5.json').read_bytes());t['reviewedScopeSha256']=m.sha(m.canonical(m.SCOPE));Path('/tmp/pow-audit30-coupled-pin-checker-promotion-plan-template-v6.json').write_text(json.dumps(t,sort_keys=True,indent=2)+'\n')
test=Path('/tmp/pow-audit30-coupled-pin-checker-promotion-v5.test.py').read_text().replace('promotion-v5.py','promotion-v6.py').replace('plan-template-v5.json','plan-template-v6.json').replace('retention-protection-oct3-candidate-v1.py','retention-protection-oct3-dual-pin-candidate-v1.py').replace('test_candidate_exact_only_two_literals','test_candidate_exact_three_targeted_edits').replace("new.replace(b'proof_indexer-20261003T031852Z.dumpset'","new.replace(b\"names==['proof_indexer-20260929T031853Z.dumpset',EXPECTED_LOGICAL_PIN]\",b'names==[EXPECTED_LOGICAL_PIN]').replace(b'proof_indexer-20261003T031852Z.dumpset'").replace("replace('retention-checker-oct3.py','retention-checker-oct2.py')","replace('retention-checker-oct3-dual-pin.py','retention-checker-oct2.py')")
extra='''
 def dual_checker(self):
    c=types.ModuleType('dual_checker');c.__file__='/tmp/pow-audit30-retention-protection-oct3-dual-pin-candidate-v1.py';exec(compile(Path(c.__file__).read_bytes(),c.__file__,'exec'),c.__dict__);return c
 def test_staged_exact78bytes_retains_sep29_first_and_oct3_second(self):
    self.assertEqual(S.NEW_PIN,S.OLD_PIN+b'proof_indexer-20261003T031852Z.dumpset\\n');self.assertEqual(len(S.NEW_PIN),78);self.assertEqual(S.sha(S.NEW_PIN),'22f66cac8419985c544d4b41c6ea9cd400fc99805c588694a9a619a3f120d09b');self.assertEqual(S.NEW_PIN.splitlines(),[S.OLD_PIN.rstrip(b'\\n'),b'proof_indexer-20261003T031852Z.dumpset'])
 def test_checker_pair_rejects_extra_duplicate_order_missing_and_old_single(self):
    c=self.dual_checker();pin=dict(exists=True,regular=True,symlink=False,canonical=True,uid=0,mode=0o644,bytes=78);tool=dict(exists=True,regular=True,symlink=False,canonical=True,uid=0,mode=0o755);old='proof_indexer-20260929T031853Z.dumpset';new=c.EXPECTED_LOGICAL_PIN
    self.assertTrue(c.logical_pin_protection_is_valid(pin,[old,new],tool,c.EXPECTED_LOGICAL_BACKUP_TOOL_SHA256))
    for names in([new,old],[old],[new],[old,new,new],[old,old,new],[old,new,'proof_indexer-20261002T031851Z.dumpset']):self.assertFalse(c.logical_pin_protection_is_valid(pin,names,tool,c.EXPECTED_LOGICAL_BACKUP_TOOL_SHA256),names)
 def test_v6_only_constants_and_execute_candidate_filename_change(self):
    import ast
    old=ast.parse(Path('/tmp/pow-audit30-coupled-pin-checker-promotion-v5.py').read_bytes());new=ast.parse(P.read_bytes());func=lambda tree:{n.name:ast.dump(n,include_attributes=False)for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))};a,b=func(old),func(new);self.assertEqual(set(a),set(b));self.assertEqual({n for n in a if a[n]!=b[n]},{'execute'})
    restored=P.read_text().replace('retention-checker-oct3-dual-pin.py','retention-checker-oct3.py');r=func(ast.parse(restored));self.assertEqual(a,r)
 def test_candidate_other_function_asts_equal_v5_candidate(self):
    import ast
    old=ast.parse(Path('/tmp/pow-audit30-retention-protection-oct3-candidate-v1.py').read_bytes());new=ast.parse(Path('/tmp/pow-audit30-retention-protection-oct3-dual-pin-candidate-v1.py').read_bytes());func=lambda tree:{n.name:ast.dump(n,include_attributes=False)for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))};a,b=func(old),func(new);self.assertEqual(set(a),set(b));self.assertEqual({n for n in a if a[n]!=b[n]},{'logical_pin_protection_is_valid'})
'''
test=test.replace("if __name__=='__main__':unittest.main()",extra+"if __name__=='__main__':unittest.main()")
Path('/tmp/pow-audit30-coupled-pin-checker-promotion-v6.test.py').write_text(test)
for x in[p,cp,Path('/tmp/pow-audit30-coupled-pin-checker-promotion-plan-template-v6.json'),Path('/tmp/pow-audit30-coupled-pin-checker-promotion-v6.test.py')]:print(x,len(x.read_bytes()),hashlib.sha256(x.read_bytes()).hexdigest())
