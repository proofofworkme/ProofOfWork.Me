import base64, copy, hashlib, importlib.util, io, json, os, pathlib, subprocess, tarfile, tempfile, unittest
from unittest.mock import patch
SPEC=importlib.util.spec_from_file_location('closure','/tmp/pow-audit30-pg-dependency-closure.py'); M=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(M)
class Tests(unittest.TestCase):
 def setUp(self): self.tmp=tempfile.TemporaryDirectory(); self.root=pathlib.Path(self.tmp.name)
 def tearDown(self): self.tmp.cleanup()
 def repo(self):
  r=self.root/'repo'; r.mkdir(); p=r/'node_modules/pg'; p.mkdir(parents=True); (p/'lib').mkdir(); (p/'lib/index.js').write_text("module.exports={Client:class Client{}}")
  q=r/'node_modules/dep'; q.mkdir(); (q/'index.js').write_text("module.exports=1")
  for d,name,deps,peer in [(p,'pg',{'dep':'1.0.0'},{'pg-native':'>=3'}),(q,'dep',{}, {'pg':'>=8'})]:
   (d/'package.json').write_text(json.dumps({'name':name,'version':'8.0.0' if name=='pg' else '1.0.0','dependencies':deps,'peerDependencies':peer,'peerDependenciesMeta':{'pg-native':{'optional':True}}}))
  lock={'lockfileVersion':3,'packages':{'node_modules/pg':{'version':'8.0.0','integrity':'sha512-test'},'node_modules/dep':{'version':'1.0.0','integrity':'sha512-test'}}}; (r/'package-lock.json').write_text(json.dumps(lock)); return r
 def artifact(self):
  r=self.repo(); out=self.root/'out'; result=M.build(r,out); return r,out,result,json.loads((out/'portable-manifest.json').read_bytes()),(out/'pg-dependencies.tar').read_bytes()
 def test_complete_graph_cycle_optional_and_fixed_entry(self):
  _,_,_,m,raw=self.artifact(); rows,b=M.verify_archive(raw,m); self.assertEqual(len(m['packages']),2); self.assertEqual(m['optionalAbsences'][0]['name'],'pg-native'); self.assertIn('pg/node_modules/dep/index.js',b); self.assertIn('pg/lib/index.js',b); self.assertEqual(m['logicalBytes'],sum(map(len,b.values())))
 def test_deterministic_archive(self):
  r,o,x,m,raw=self.artifact(); z=M.build(r,self.root/'out2'); self.assertEqual(z['archiveSHA256'],x['archiveSHA256']); self.assertEqual(z['manifestSHA256'],x['manifestSHA256'])
 def test_no_output_overwrite(self):
  r,o,_,_,_=self.artifact()
  with self.assertRaises(M.Refusal): M.build(r,o)
 def test_lock_version_drift(self):
  r=self.repo(); p=r/'node_modules/dep/package.json'; x=json.loads(p.read_text()); x['version']='2.0'; p.write_text(json.dumps(x))
  with self.assertRaisesRegex(M.Refusal,'differs lock'): M.build(r,self.root/'out')
 def test_required_missing(self):
  r=self.repo(); p=r/'node_modules/pg/package.json'; x=json.loads(p.read_text()); x['dependencies']['missing']='1'; p.write_text(json.dumps(x))
  with self.assertRaisesRegex(M.Refusal,'required dependency absent'): M.build(r,self.root/'out')
 def test_source_symlink(self):
  r=self.repo(); (r/'node_modules/pg/lib/alias').symlink_to('index.js')
  with self.assertRaises(M.Refusal): M.build(r,self.root/'out')
 def test_source_hardlink(self):
  r=self.repo(); os.link(r/'node_modules/pg/lib/index.js',r/'node_modules/pg/lib/alias')
  with self.assertRaises(M.Refusal): M.build(r,self.root/'out')
 def test_source_xattr(self):
  r=self.repo(); os.setxattr(r/'node_modules/pg/lib/index.js','user.fixture',b'x')
  with self.assertRaisesRegex(M.Refusal,'xattrs'): M.build(r,self.root/'out')
 def test_data_bound(self):
  r=self.repo()
  with patch.object(M,'MAX_BYTES',10),self.assertRaises(M.Refusal): M.build(r,self.root/'out')
 def test_records_tamper(self):
  _,_,_,m,raw=self.artifact(); m['records'][1]['path']='pg/../escape'; m['recordsSHA256']=M.sha(M.enc(m['records']))
  with self.assertRaises(M.Refusal): M.verify_archive(raw,m)
 def test_duplicate_member(self):
  _,_,_,m,raw=self.artifact(); m['records'].append(copy.deepcopy(m['records'][-1])); m['entryCount']+=1; m['recordsSHA256']=M.sha(M.enc(m['records']))
  with self.assertRaises(M.Refusal): M.verify_archive(raw,m)
 def test_corrupted_file(self):
  _,_,_,m,raw=self.artifact(); altered=raw.replace(b'module.exports=1',b'module.exports=2')
  with self.assertRaisesRegex(M.Refusal,'bytes differ'): M.verify_archive(altered,m)
 def test_alias_paths(self):
  for path in ['/etc/passwd','pg/./a','pg/../a','pg//a','pg\\a','']:
   with self.assertRaises(M.Refusal): M.safe_path(path)
 def test_stage_unknown_keys_before_creation(self):
  with patch.object(M.os,'mkdir') as mkdir,self.assertRaises(M.Refusal): M.stage({'schema':'x'})
  mkdir.assert_not_called()
 def test_genuine_staging_preserves_source_and_refuses_reuse(self):
  _,out,_,manifest,raw=self.artifact(); data_root=self.root/'data'; data_root.mkdir(); source_dir=data_root/'proofofwork-release-backups/audit30-mail-body-census-20261003T005716Z'; source_dir.mkdir(parents=True); source_dir.chmod(0o700)
  source=source_dir/'phase4-private-plan.json'; original=b'{"private": "\\n retained body ", "old": null}'; source.write_bytes(original); source.chmod(0o600)
  OrigPath=pathlib.Path; original_lstat=OrigPath.lstat; original_meta=M.meta
  def as_root(p,*args,**kwargs):
   st=original_lstat(p,*args,**kwargs)
   class View: pass
   x=View()
   for key in ['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns']:
    setattr(x,key,0 if key in ('st_uid','st_gid') else getattr(st,key))
   return x
  def root_meta(st):
   x=original_meta(st); x['uid']=x['gid']=0; return x
  def mapped_path(value):
   value=str(value)
   return data_root/value[len('/data/'): ] if value.startswith('/data/') else data_root if value=='/data' else OrigPath(value)
  with patch.object(OrigPath,'lstat',as_root),patch.object(M,'meta',root_meta),patch.object(M.pathlib,'Path',mapped_path),patch.object(M.os,'geteuid',return_value=0),patch.object(M.os,'getegid',return_value=0),patch.object(M.socket,'gethostname',return_value='fixture'):
   request=dict(schema='pow-audit30-pg-root-stage-request-v1',approvalSha256=M.APPROVAL,runId='20261003T010000Z',host='fixture',archiveBase64=base64.b64encode(raw).decode(),archiveSHA256=M.sha(raw),manifestBase64=base64.b64encode(M.enc(manifest)).decode(),manifestSHA256=M.sha(M.enc(manifest)),privatePlanSource=dict(path='/data/proofofwork-release-backups/audit30-mail-body-census-20261003T005716Z/phase4-private-plan.json',metadata=M.meta(source.lstat()),sha256=M.sha(original)))
   result=M.stage(request); self.assertEqual(result['dependencySource']['recordsSha256'],M.sha(M.enc(result['dependencySource']['records'])))
   with self.assertRaisesRegex(M.Refusal,'staging exists'): M.stage(request)
  target=data_root/'proofofwork-audit30-inspect-inputs-20261003T010000Z'; self.assertEqual(source.read_bytes(),original); self.assertEqual((target/'phase4-private-plan.json').read_bytes(),original)
  for current,dirs,files in os.walk(target):
   self.assertEqual(original_lstat(OrigPath(current)).st_mode&0o777,0o700)
   for name in files: self.assertEqual(original_lstat(OrigPath(current)/name).st_mode&0o777,0o600)
 def test_actual_cli_exit_zero_and_one(self):
  r=self.repo(); cmd=['/usr/bin/python3','-I','-B','/tmp/pow-audit30-pg-dependency-closure.py','build','--repository',str(r),'--output',str(self.root/'out')]
  a=subprocess.run(cmd,capture_output=True); self.assertEqual(a.returncode,0,a.stderr); self.assertEqual(json.loads(a.stdout)['packageCount'],2)
  b=subprocess.run(cmd,capture_output=True); self.assertEqual(b.returncode,1); self.assertFalse(json.loads(b.stdout)['ok'])
 def test_closure_native_node_load(self):
  _,out,_,m,raw=self.artifact(); rows,blobs=M.verify_archive(raw,m); dst=self.root/'tree'; dst.mkdir()
  for row in rows[1:]:
   p=dst/row['path']
   if row['kind']=='directory': p.mkdir()
   else: p.write_bytes(blobs[row['path']])
  a=subprocess.run(['/usr/bin/node','-e','const p=require(process.argv[1]); if(typeof p.Client!=="function")process.exit(1)',str(dst/'pg/lib/index.js')],capture_output=True); self.assertEqual(a.returncode,0,a.stderr)
if __name__=='__main__': unittest.main()
