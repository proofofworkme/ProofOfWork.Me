#!/usr/bin/python3 -I
"""Private Git/source fixtures only; no live capture, services, RPC or database."""
import base64, copy, hashlib, importlib.util, json, os, pathlib, subprocess, tempfile, types, unittest
from unittest.mock import patch

HERE=pathlib.Path(__file__).resolve().parent
CONTROL=pathlib.Path(os.environ.get('WORK_BATCH_REPLAY_CONTROLLER_TEST_DIRECTORY',str(HERE)))
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path)
 value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
generator=load('source_generator',HERE/'prepare-source-manifest.py')
controller=load('source_generator_controller',CONTROL/'scoped-node.py')
release=load('source_generator_release',CONTROL/'release.py')
PRODUCTION_BASE=generator.BASE
PRODUCTION_OLD=generator.OLD_HELPER
def sha(raw):return hashlib.sha256(raw).hexdigest()

class SourceManifestTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.root=pathlib.Path(self.temp.name);self.root.chmod(0o700)
  self.repo=self.root/'repository';self.repo.mkdir(mode=0o700)
  self.toolroot=self.repo/'deploy/work-batch-replay';self.toolroot.mkdir(parents=True)
  for name in ('release.py','capture-node.py','scoped-node.py','rollout-node.py'):
   self.write(self.toolroot/name,(CONTROL/name).read_bytes())
  for name in ('preflight.mjs','publish-replay.py','storage-extension.sql','catalog-baseline.json','catalog-after.json'):
   self.write(self.toolroot/name,b'// fixture tool\n')
  self.write(self.repo/'deploy/search/hold-node-timer.py',b'# fixture holder\n')
  names={p for _,p in generator.ROLES.values()}|generator.TARGETS|{controller.METADATA_TEMPLATE}
  for name in names-{'server/db/native-transition-storage.mjs'}:
   self.write(self.repo/name,b'export const fixture = 1;\n')
  self.write(self.repo/'server/work-amo-v5-raw.mjs',
   b'import "../scripts/replay-dependency.mjs";\nimport "./payload.json" with { type: "json" };\nexport const era = "old";\n')
  self.write(self.repo/'scripts/replay-dependency.mjs',
   b'import "../src/features/identity/replay-address.mjs";\nexport const dep = 1;\n')
  self.write(self.repo/'src/features/identity/replay-address.mjs',b'export const address = "fixture";\n')
  self.write(self.repo/'server/payload.json',b'{"fixture":true}\n')
  self.write(self.repo/'package.json',b'{"type":"module"}\n')
  self.write(self.repo/'package-lock.json',b'{"lockfileVersion":3}\n')
  self.git('init','-q');self.git('config','user.name','Isolated fixture')
  self.git('config','user.email','fixture@example.invalid')
  self.git('add','.');self.git('commit','-qm','fixture base')
  self.base=self.git('rev-parse','HEAD').decode().strip()
  self.before={str(p.relative_to(self.repo)):p.read_bytes() for p in self.repo.rglob('*')
   if p.is_file() and '.git' not in p.relative_to(self.repo).parts and not str(p.relative_to(self.repo)).startswith('deploy/')}
  self.old=b'export const acceptedOldHelper = 1;\n'
  self.before['server/db/native-transition-storage.mjs']=self.old
  # Accepted runtime-only API/backfill comments survive actual three-way composition.
  for name in ('server/proof-api.mjs','scripts/backfill-proof-indexer.mjs'):
   self.before[name]+=b'// accepted runtime overlay\n'
  raw=self.repo/'server/work-amo-v5-raw.mjs';raw.write_bytes(raw.read_bytes().replace(b'"old"',b'"new"'))
  self.write(self.repo/'server/db/native-transition-storage.mjs',b'export const newHelper = 2;\n')
  self.git('add','.');self.git('commit','-qm','fixture compatible source')
  self.commit=self.git('rev-parse','HEAD').decode().strip();self.tree=self.git('rev-parse','HEAD^{tree}').decode().strip()
  for obj,key,value in ((generator,'BASE',self.base),(generator,'OLD_HELPER',sha(self.old)),
                       (controller,'BASE_SOURCE_COMMIT',self.base),
                       (controller,'ACCEPTED_OVERLAY_BASES',{'server/db/native-transition-storage.mjs':sha(self.old)})):
   p=patch.object(obj,key,value);p.start();self.addCleanup(p.stop)
  self.node=self.root/'node';self.write(self.node,b'fixture-node-only-hash')
  self.modules=self.root/'installed-dependencies';self.modules.mkdir(mode=0o700)
  sources={}
  for name,raw in self.before.items():
   sources[name]={'base64':base64.b64encode(raw).decode(),'sha256':sha(raw),'uid':0,'gid':0,'mode':0o600}
  capture={'format':'proof-of-work-work-batch-replay-runtime-capture-v1','root':'/opt/proofofwork-api',
   'controllerSha256':sha((self.toolroot/'scoped-node.py').read_bytes()),
   'baselineHead':self.base,'nodePath':str(self.node),'nodeSha256':sha(self.node.read_bytes()),'sources':sources}
  self.capture=self.root/'capture.json';self.write(self.capture,json.dumps(capture).encode())
  self.compose_root=self.root/'composition'
  args=types.SimpleNamespace(repository=self.repo,commit=self.commit,base_commit=self.base,
   capture=self.capture,output=self.compose_root,release_id=self.commit[:12]+'-20261025T000000Z',reviewed_merges=None)
  actual_run=subprocess.run
  def run(argv,**kwargs):
   if argv[0]==str(self.node):return subprocess.CompletedProcess(argv,0,b'',b'')
   return actual_run(argv,**kwargs)
  with patch.object(release,'ROOT',self.toolroot),patch.object(release,'controller',return_value=controller),\
       patch.object(release,'node_context'),patch.object(release.subprocess,'run',side_effect=run),patch('builtins.print'):
   release.plan(args,compose_only=True)
  self.composition=self.compose_root/'composition.json'
  self.args=types.SimpleNamespace(source_root=self.repo,source_commit=self.commit,source_tree=self.tree,
   composition=self.composition,composition_sha256=sha(self.composition.read_bytes()),capture=self.capture,
   node_path=self.node,node_modules=self.modules,output_root=self.root/'staged')
 def write(self,path,raw):
  path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);path.write_bytes(raw);path.chmod(0o600)
 def git(self,*args):
  return subprocess.check_output(['/usr/bin/git','-C',str(self.repo),*args],stderr=subprocess.PIPE)
 def composition_change(self,fn,rehash=True):
  value=json.loads(self.composition.read_bytes());fn(value)
  self.write(self.composition,json.dumps(value).encode())
  if rehash:self.args.composition_sha256=sha(self.composition.read_bytes())
 def test_actual_compose_output_stages_exact_git_closure_and_retains_api_overlay(self):
  result=generator.build(self.args);m=json.loads(pathlib.Path(result['path']).read_bytes())
  self.assertFalse(result['productionMutation'])
  self.assertEqual(m['maxSuffixBlocks'],512)
  self.assertEqual(m['resourceLimits'],{'maxNativePayloadBytes':8589934592,
      'maxRawBlockBytes':2147483648,'maxNativePayloadBytesPerBlock':134217728,
      'maxQualificationReceiptBytes':33554432,'maxOrdinaryRecords':1024})
  self.assertEqual(m['compositionManifestSha256'],self.args.composition_sha256)
  self.assertEqual(m['sourceCommit'],self.commit);self.assertEqual(m['baselineSourceCommit'],self.base)
  for group in ('baseline','compatible'):
   self.assertIn(group+'/server/payload.json',m['files'])
   self.assertIn(group+'/scripts/replay-dependency.mjs',m['files'])
   self.assertIn(group+'/src/features/identity/replay-address.mjs',m['files'])
  self.assertEqual(m['files'][m['modules']['nativeStorage']]['sha256'],sha(self.old))
  self.assertNotEqual(m['runtimeSources']['server/proof-api.mjs'],sha(self.git('show',self.commit+':server/proof-api.mjs')))
  self.assertEqual(m['runtimeSources']['server/proof-api.mjs'],sha(self.before['server/proof-api.mjs']))
  for name,entry in m['files'].items():
   self.assertEqual(sha((self.args.output_root/name).read_bytes()),entry['sha256'])
   if 'commit' in entry['origin']:
    self.assertEqual(self.git('rev-parse',entry['origin']['commit']+':'+entry['origin']['path']).decode().strip(),entry['origin']['blob'])
 def test_composition_hash_drift_refuses_before_staging(self):
  self.composition_change(lambda c:c.update(releaseId='changed'),rehash=False)
  with self.assertRaisesRegex(ValueError,'Input changed'):generator.build(self.args)
  self.assertFalse(self.args.output_root.exists())
 def test_capture_drift_and_identity_refuse(self):
  value=json.loads(self.capture.read_bytes());value['root']='/not-live-runtime'
  self.write(self.capture,json.dumps(value).encode())
  with self.assertRaisesRegex(ValueError,'Input changed'):generator.build(self.args)
  self.composition_change(lambda c:c.update(captureSha256=sha(self.capture.read_bytes())))
  with self.assertRaisesRegex(ValueError,'Capture identity'):generator.build(self.args)
 def test_composition_before_cannot_replace_captured_identity(self):
  name='server/proof-api.mjs';foreign=b'// different accepted runtime\nexport {};\n'
  self.write(self.compose_root/'captured-runtime'/name,foreign)
  def mutate(c):
   next(r for r in c['sources'] if r['path']==name)['before']=sha(foreign)
   next(r for r in c['reviews'] if r['path']==name)['before']=sha(foreign)
  self.composition_change(mutate)
  with self.assertRaisesRegex(ValueError,'capture before pin'):generator.build(self.args)
 def test_wrong_git_base_provenance_refuses(self):
  self.composition_change(lambda c:c['reviews'][0].update(baseSha256='f'*64))
  with self.assertRaisesRegex(ValueError,'base provenance'):generator.build(self.args)
 def test_changed_candidate_bytes_refuse(self):
  c=json.loads(self.composition.read_bytes());p=pathlib.Path(c['candidates']['server/proof-api.mjs']['path'])
  self.write(p,b'changed')
  with self.assertRaisesRegex(ValueError,'Input changed'):generator.build(self.args)
 def test_uncommitted_merged_reducer_is_never_imported(self):
  name='server/work-amo-v5-raw.mjs';merged=self.git('show',self.commit+':'+name)+b'// uncommitted reducer change\n'
  def mutate(c):
   row=next(r for r in c['sources'] if r['path']==name);row['after']=sha(merged)
   v=next(r for r in c['reviews'] if r['path']==name);v['after']=sha(merged)
   c['candidates'][name]['sha256']=sha(merged);self.write(pathlib.Path(c['candidates'][name]['path']),merged)
  self.composition_change(mutate)
  with self.assertRaisesRegex(ValueError,'Replay import differs'):generator.build(self.args)
 def test_changed_imported_script_capture_hash_refuses(self):
  value=json.loads(self.capture.read_bytes());value['sources']['scripts/replay-dependency.mjs']['sha256']='e'*64
  self.write(self.capture,json.dumps(value).encode())
  self.composition_change(lambda c:c.update(captureSha256=sha(self.capture.read_bytes())))
  with self.assertRaisesRegex(ValueError,'Replay import differs'):generator.build(self.args)
 def test_changed_imported_json_capture_hash_refuses(self):
  value=json.loads(self.capture.read_bytes());value['sources']['server/payload.json']['sha256']='e'*64
  self.write(self.capture,json.dumps(value).encode())
  self.composition_change(lambda c:c.update(captureSha256=sha(self.capture.read_bytes())))
  with self.assertRaisesRegex(ValueError,'Replay import differs'):generator.build(self.args)
 def test_native_baseline_and_node_hash_cannot_drift(self):
  self.write(self.compose_root/'captured-runtime/server/db/native-transition-storage.mjs',b'wrong native')
  with self.assertRaisesRegex(ValueError,'Input changed'):generator.build(self.args)
  self.write(self.compose_root/'captured-runtime/server/db/native-transition-storage.mjs',self.old)
  self.write(self.node,b'wrong node')
  with self.assertRaisesRegex(ValueError,'Node capture changed'):generator.build(self.args)
 def test_dirty_git_source_refuses(self):
  self.write(self.repo/'server/work-amo-v5.mjs',b'export const dirty = 1;\n')
  with self.assertRaisesRegex(ValueError,'Committed source changed'):generator.build(self.args)
 def test_exact_production_pins_and_unsafe_paths(self):
  self.assertEqual(PRODUCTION_BASE,'eb0a2cf01b5173e14c710ed48c1a98b8d0a9ddee')
  self.assertEqual(PRODUCTION_OLD,'7e3393953864a68cdd72f43b7f3ae8e7eb4a24502ff2b260320790ee9be7f584')
  for path in ('../escape','a/../b','/absolute','a\\b','a\nb','a\x00b'):
   with self.assertRaises(ValueError):generator.relative(path)

class DependencyLockTests(unittest.TestCase):
 def fixture(self):
  source={'name':'fixture','version':'1','lockfileVersion':3,'requires':True,'packages':{'':{'name':'fixture','license':'MIT','dependencies':{'pg':'^8.0.0'}},'node_modules/pg':{'version':'8.0.0','integrity':'fixed'},'node_modules/dev-only':{'version':'1','dev':True}}}
  runtime=copy.deepcopy(source);runtime['packages'][''].pop('license');runtime['packages']['']['dependencies'][generator.FONT]='^5.3.0';runtime['packages']['node_modules/'+generator.FONT]={'version':'5.3.0','integrity':'font'}
  installed={k:copy.deepcopy(v) for k,v in runtime.items() if k!='packages'};installed['packages']={k:copy.deepcopy(v) for k,v in runtime['packages'].items() if k not in ('','node_modules/dev-only')}
  return source,runtime,installed
 def test_exact_lock_fast_path_is_unchanged(self):
  with patch.object(generator,'read',side_effect=AssertionError('must not read compatibility evidence')):
   self.assertIsNone(generator.dependency_lock_evidence(b'{}',b'{}',pathlib.Path('/unused'),pathlib.Path('/unused'),{}))
 def test_fixed_pair_rejects_unreviewed_lock_bytes(self):
  with self.assertRaisesRegex(ValueError,'Dependency lock differs'):
   generator.dependency_lock_evidence(b'{}',b'{"other":true}',pathlib.Path('/unused'),pathlib.Path('/unused'),{})
 def test_font_only_delta_accepts_without_modifying_inputs(self):
  values=self.fixture();before=copy.deepcopy(values)
  self.assertTrue(generator.font_only_lock_semantics(*values));self.assertEqual(values,before)
 def test_every_other_root_and_package_change_refuses(self):
  changes=[lambda s,r,i:r['packages']['node_modules/pg'].update(version='9'),lambda s,r,i:r['packages'][''].update(engines={'node':'other'}),lambda s,r,i:r.update(requires=False),lambda s,r,i:r['packages']['node_modules/'+generator.FONT].update(version='5.4.0'),lambda s,r,i:r['packages']['']['dependencies'].update({generator.FONT:'^5.4.0'}),lambda s,r,i:r['packages'][''].update(license='MIT'),lambda s,r,i:i['packages']['node_modules/pg'].update(integrity='other'),lambda s,r,i:i['packages'].update({'node_modules/foreign':{'version':'1'}}),lambda s,r,i:i['packages'].pop('node_modules/pg'),lambda s,r,i:i['packages']['node_modules/'+generator.FONT].update(integrity='other')]
  for change in changes:
   values=self.fixture();change(*values)
   with self.assertRaises(ValueError):generator.font_only_lock_semantics(*values)
 def test_production_lock_authority_is_exact(self):
  self.assertEqual(generator.A3_LOCK_PINS,{'source':'77170945a8cbc8a94c3e6d63b2faef6516317de6a1ad3e894ec363f77c243b14','runtime':'1f6d39daa9d62f3ce75e804333f04031a934f6f50690734df7f00effb7f3f4b6','installed':'2463141898c4cbc3b775420a89e8ae71b12e9d82cf0bc39fd154922a332256aa'})
  self.assertEqual(set(generator.A3_LOCK_EVIDENCE),{'plan','postInstall','completion'})

if __name__=='__main__':unittest.main()
