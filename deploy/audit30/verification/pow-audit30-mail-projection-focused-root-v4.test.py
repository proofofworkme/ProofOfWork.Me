import ast,copy,hashlib,json,pathlib,sys,unittest
from unittest.mock import patch
import tempfile,types,os,stat
P=pathlib.Path('/tmp/pow-audit30-mail-projection-focused-root-v4.py');N={'__name__':'_test','__file__':str(P)};exec(compile(P.read_bytes(),str(P),'exec'),N)
def fixtures():
 md=lambda kind:{'dev':'1','ino':'2','uid':0,'gid':112,'mode':0o750 if kind=='directory'else 0o440,'nlink':'1','bytes':'42','mtimeNs':'1','ctimeNs':'1'}
 entries=[{'path':name,'kind':'directory','metadata':md('directory')}for name in sorted(N['COPY_DIRS'])]+[{'path':name,'kind':'file','metadata':md('file'),'sha256':sha}for name,sha in N['COPY_MEMBERS'].items()]
 entries += [{'path':'fixture/'+str(i),'kind':'file','metadata':md('file'),'sha256':'a'*64}for i in range(6141-len(entries))]
 m={'schema':'pow-audit30-onhost-math-source-copy-v1','candidateRoot':'/opt/proofofwork-api-stage-3399d767103e-20261003T020420Z','sourceRoot':str(N['COPY']),'candidateAttestationSHA256':N['COPY_ATTEST'],'attestationBeforeSHA256':N['COPY_ATTEST'],'attestationAfterSHA256':N['COPY_ATTEST'],'entryCount':6141,'regularBytes':164382510,'entries':entries,'sourceBytesExact':True,'candidateUnchanged':True,'nativeReadabilityPassed':True,'privateRawStateCopied':False}
 c={'schema':'pow-audit30-source-copy-finalize-completed-v3','status':'completed','sourceCopyManifestSHA256':N['COPY_MANIFEST_SHA'],'priorAttemptRemainsFailed':True,'sourceTreeNotModified':True,'candidateUnchanged':True,'productionMutation':False,'privateRawStateCopied':False,'nativeReadability':{'receipt':{'uid':108,'gid':112,'entries':6141,'allSourceAndDependenciesReadable':True},'unit':'proofofwork-audit30-math-source-readability-v4.service','InvocationID':'fcea4496dea54ecb9b3f314b9746ce1e','ownedStop':{'unitStopVerified':True},'remainAfterExitStopped':True}}
 return m,c
class T(unittest.TestCase):
 def test_good_exact_prior_scope(self):
  m,c=fixtures();self.assertEqual(len(N['copy_scope'](m,c)),6141)
 def bad(self,f):
  m,c=fixtures();f(m,c)
  with self.assertRaises(N['Refused']):N['copy_scope'](m,c)
 def test_manifest_source_identity(self):self.bad(lambda m,c:m.update(sourceRoot='/other'))
 def test_manifest_counts(self):self.bad(lambda m,c:m.update(entryCount=6140))
 def test_duplicate_manifest_path(self):self.bad(lambda m,c:m['entries'][-1].update(path=m['entries'][0]['path']))
 def test_outside_manifest_path(self):self.bad(lambda m,c:m['entries'][-1].update(path='../secret'))
 def test_wrong_member_sha(self):self.bad(lambda m,c:next(r for r in m['entries']if r['path']=='node_modules/pg/lib/index.js').update(sha256='a'*64))
 def test_wrong_member_owner(self):self.bad(lambda m,c:next(r for r in m['entries']if r['path']=='node_modules/pg/lib/index.js')['metadata'].update(uid=1000))
 def test_wrong_member_mode(self):self.bad(lambda m,c:next(r for r in m['entries']if r['path']=='node_modules/pg/lib/index.js')['metadata'].update(mode=0o640))
 def test_missing_dep(self):self.bad(lambda m,c:next(r for r in m['entries']if r['path']=='node_modules/pg/lib/index.js').update(path='another.js'))
 def test_wrong_directory(self):self.bad(lambda m,c:next(r for r in m['entries']if r['path']=='node_modules').update(kind='symlink'))
 def test_prior_not_stopped(self):self.bad(lambda m,c:c['nativeReadability']['ownedStop'].update(unitStopVerified=False))
 def test_prior_readability_incomplete(self):self.bad(lambda m,c:c['nativeReadability']['receipt'].update(entries=1))
 def test_private_state_copy(self):self.bad(lambda m,c:m.update(privateRawStateCopied=True))
 def test_child_failure_closed(self):
  v={'schema':'pow-audit30-focused-mail-leaf-refused-v4','code':'42501','errorClass':'Error'};self.assertEqual(N['child_failure'](json.dumps(v).encode()),v)
 def test_child_failure_private_message_refused(self):
  for v in [{'message':'secret'}, {'schema':'pow-audit30-focused-mail-leaf-refused-v4','code':'SECRET','errorClass':'Error'}, {'schema':'pow-audit30-focused-mail-leaf-refused-v4','code':'57014','errorClass':'SecretClass'}, 'PRIVATE']:
   self.assertEqual(N['child_failure'](json.dumps(v).encode()),{'code':'UNCLASSIFIED_CHILD_FAILURE'})
 def test_original_severities(self):
  v={'format':'audit29-candidate-readonly-v1','mode':'shadow','failure':'STRICT_GATE_FAILED','gateReceipts':{'parity':{'checks':[{'name':n,'ok':False,'severity':'error'if n=='rendered-mail-projection-semantic-parity'else 'warning'}for n in N['FAIL_NAMES']]+[{'name':'ok','ok':True,'severity':'error'}]*99}}};r=N['severity'](v);self.assertEqual((r['blockingErrorCount'],r['historicalWarningCount']),(1,2))
 def test_path_only_leaf_reversal(self):
  old=pathlib.Path('/tmp/pow-audit30-mail-projection-focused-leaf-v2.mjs').read_bytes();new=pathlib.Path('/tmp/pow-audit30-mail-projection-focused-leaf-v4.mjs').read_bytes();a=b'/opt/proofofwork-api-stage-38ac6e2bff2a-20261003T042000Z';b=str(N['MODULE_PACKAGE']).encode();self.assertEqual(new.count(b),2);self.assertEqual(new.replace(b,a),old);self.assertEqual(hashlib.sha256(new).hexdigest(),N['LEAF_PIN'])
 def test_sql_and_resource_limits_preserved(self):
  s=P.read_text();self.assertIn('cwd=MODULE_PACKAGE,env=env,user=database_account.pw_uid',s);self.assertIn("'--max-old-space-size=256'",s);self.assertIn('timeout=90',s);self.assertIn("b'postgresql:///proof_indexer?host=%2Fvar%2Frun%2Fpostgresql&port=5432&user=postgres'",s);self.assertIn("copy_bindings(h)==graph",s);self.assertNotIn('chmod(CWD',s);self.assertNotIn('copyfile',s)
 def test_before_db_copy_admission(self):
  t=ast.parse(P.read_bytes());fn=next(n for n in t.body if isinstance(n,ast.FunctionDef)and n.name=='main');i=next(i for i,n in enumerate(fn.body)if isinstance(n,ast.Expr)and isinstance(n.value,ast.Call)and isinstance(n.value.func,ast.Attribute)and n.value.func.attr=='mkdir');s=ast.unparse(ast.Module(body=fn.body[:i],type_ignores=[]));self.assertIn('graph = copy_bindings(h)',s);self.assertNotIn('Popen',s);self.assertNotIn('.mkdir',s)
class Package(unittest.TestCase):
 def test_actual_source_inventory_missing_api_modules(self):
  b=pathlib.Path('/tmp/pow-audit30-onhost-math-source-inventory-native-full-v1.json').read_bytes();self.assertEqual(hashlib.sha256(b).hexdigest(),'aae198d18b0f5b347f25022f4c141b546aebf5f62d32e21cd72443ede5edd642');v=json.loads(b);names={r['path']for r in v['entries']};self.assertEqual(v['entryCount'],6141);self.assertNotIn('server/db/postgres.mjs',names);self.assertNotIn('server/proof-index-mail-projection.mjs',names);self.assertIn('node_modules/pg/lib/index.js',names)
 def test_api_additions_cannot_masquerade_as_math_manifest(self):
  m,c=fixtures();m['entries'][-1].update(path='server/db/postgres.mjs')
  with self.assertRaisesRegex(N['Refused'],'COPY_API_MODULE_ABSENCE_CONTRACT'):N['copy_scope'](m,c)
 def test_actual_new_files_symlink_and_collision_without_privilege_changes(self):
  with tempfile.TemporaryDirectory(prefix='audit30-focused-package-fixture-')as t:
   parent=pathlib.Path(t);pkg=parent/'new';dep=parent/'dependency';dep.mkdir();(dep/'node_modules').mkdir();oldP,oldC=N['MODULE_PACKAGE'],N['COPY'];N['MODULE_PACKAGE']=pkg;N['COPY']=dep
   original=pathlib.Path.lstat
   def stamped(p):
    s=original(p)
    if p==parent or p==pkg or pkg in p.parents:return types.SimpleNamespace(**{k:getattr(s,k)for k in ['st_dev','st_ino','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']},st_uid=0,st_gid=112)
    return s
   raw={name:(pathlib.Path('/home/sixer/ProofOfWork.Me')/name).read_bytes()for name in N['MODULE_MEMBERS']};self.assertTrue(all(hashlib.sha256(raw[n]).hexdigest()==h for n,h in N['MODULE_MEMBERS'].items()))
   def read(p,owner,**kw):
    self.assertEqual((owner,kw['mode'],kw['group']),(0,0o440,112));b=p.read_bytes();self.assertEqual(hashlib.sha256(b).hexdigest(),kw['expected']);return b
   try:
    with patch.object(pathlib.Path,'lstat',stamped),patch.object(os,'chown'),patch.object(os,'fchown'),patch.object(os,'lchown'):
     N['prepare_modules'](raw);proof=N['module_bindings']({'read':read});self.assertEqual(len(proof['entries']),6)
     for n,b in raw.items():self.assertEqual((pkg/n).read_bytes(),b);self.assertEqual(stat.S_IMODE(original(pkg/n).st_mode),0o440)
     for d in [pkg,pkg/'server',pkg/'server/db']:self.assertEqual(stat.S_IMODE(original(d).st_mode),0o750)
     self.assertEqual(os.readlink(pkg/'node_modules'),str(dep/'node_modules'))
     with self.assertRaisesRegex(N['Refused'],'MODULE_PACKAGE_EXISTS'):N['prepare_modules'](raw)
     (pkg/'node_modules').unlink();(pkg/'node_modules').symlink_to(parent)
     with self.assertRaisesRegex(N['Refused'],'MODULE_DEPENDENCY_LINK'):N['module_bindings']({'read':read})
   finally:N['MODULE_PACKAGE']=oldP;N['COPY']=oldC
 def test_no_original_or_copy_permission_mutation(self):
  source=P.read_text();tree=ast.parse(source);f=next(x for x in tree.body if isinstance(x,ast.FunctionDef)and x.name=='prepare_modules');s=ast.unparse(f);self.assertNotIn('CWD',s);self.assertNotIn('COPY_PACKAGE',s);self.assertEqual(s.count('os.chmod'),1);self.assertIn('O_EXCL',s);self.assertIn('sync_dir(parent)',s)

if __name__=='__main__':unittest.main()
