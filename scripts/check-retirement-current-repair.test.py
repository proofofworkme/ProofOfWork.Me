#!/usr/bin/env python3
"""Closed-reader boundaries and genuine synthetic native repaired-edge validation."""
import importlib.util
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
C=load('current_consumer_test',ROOT/'scripts/retirement-current-evidence.py')
R=C.load_receipt_module()
P=C.load_module('repair_test_paths',ROOT/'deploy/ui-retention/failed_prepare_repair.py')
class ClosedReaders(unittest.TestCase):
 def readers(self,rows=None,absent=None):return C.lifecycle_readers(R,rows or {},absent or [],{})
 def test_unknown_path_rejected(self):
  with self.assertRaises(ValueError):self.readers({'/etc/passwd':b'x'})
 def test_missing_is_not_absence(self):
  raw,*_=self.readers()
  with self.assertRaises(ValueError):raw(P.JOURNAL+'/intent.json')
 def test_absence_requires_consumption(self):
  path=P.JOURNAL+'/verified.json';raw,_,_,done=self.readers(absent=[path])
  with self.assertRaises(ValueError):done()
  with self.assertRaises(FileNotFoundError):raw(path)
  done()
 def test_absence_cannot_hide_evidence(self):
  path=P.JOURNAL+'/verified.json'
  with self.assertRaises(ValueError):self.readers({path:b'{}'},[path])
 def test_arbitrary_or_duplicate_absence_rejected(self):
  for paths in (['/etc/passwd'],[P.JOURNAL+'/verified.json']*2):
   with self.assertRaises(ValueError):self.readers(absent=paths)
 def test_publication_never_falls_back(self):
  _,_,publication,_=self.readers()
  path,(digest,_) = next(iter(R._REPAIR_PUBLICATION_FILES.items()))
  with self.assertRaises(ValueError):publication(path,digest)
  with self.assertRaises(ValueError):publication(path,'0'*64)
 def test_unused_row_rejected(self):
  *_,done=self.readers({P.JOURNAL+'/intent.json':b'{}'})
  with self.assertRaises(ValueError):done()
 def test_native_repaired_chain_and_seal(self):
  # Existing synthetic fixture varies authority pins only; validator algebra is unchanged.
  path=ROOT/'deploy/ui-retention/check-failed-prepare-repair.test.py'
  namespace={'__file__':str(path),'__name__':'closed_repair_fixture'}
  exec(compile(path.read_text().replace("/old-index.json","/audit30-policy-admission-index-test.json"),str(path),'exec'),namespace)
  fixture=namespace['EdgeTests']();fixture.setUp()
  try:
   native=namespace['R'];rows={p:native.encoded(v) for p,v in fixture.files.items()}
   absent=[native.BASE+'/ui-lifecycle-release-'+native.RELEASE+s for s in ('-ordinary-plan.json','-completed.json')]
   raw,bound,_,done=self.readers(rows,absent)
   def reader(path,expected=None):
    data=bound(path,expected) if expected is not None else raw(path)
    return C.dual_json(data),C.RET_digest(data)
   edge=native.verify_edge(fixture.state,fixture.config_sha,fixture.config,reader)
   self.assertEqual(edge['configSha256'],fixture.config_sha);done()
   rows[native.JOURNAL+'/verified.json']=b'{}'
   with self.assertRaises(ValueError):native.verify_edge(fixture.state,fixture.config_sha,fixture.config,reader)
  finally:fixture.tearDown()
 def test_native_prepared_reader_successor_closed_chain(self):
  path=ROOT/'deploy/ui-retention/check-prepared-reader-successor.test.py'
  namespace={'__file__':str(path),'__name__':'closed_successor_fixture'}
  source=path.read_text().replace("source=source.replace(","source=source.replace('/old-index.json','/audit30-policy-admission-index-test.json')\nsource=source.replace(",1)
  exec(compile(source,str(path),'exec'),namespace)
  fixture=namespace['Tests']();fixture.setUp()
  try:
   native=namespace['F'];rows={p:native.encoded(v) for p,v in fixture.files.items()}
   absent=[native.BASE+'/ui-lifecycle-release-'+native.RELEASE+s for s in ('-ordinary-plan.json','-completed.json')]+[native.JOURNAL+'/verified.json']
   raw,bound,_,done=self.readers(rows,absent)
   def reader(path,expected=None):
    data=bound(path,expected) if expected is not None else raw(path)
    return C.dual_json(data),C.RET_digest(data)
   edge=native.verify_edge(fixture.state,fixture.config_sha,fixture.config,reader)
   self.assertEqual(edge['priorConfigSha256'],native.PIN['config']);done()
   for path in (native.READER_JOURNAL+'/verified.json',native.READER_JOURNAL+'/installed.json'):
    saved=rows.pop(path)
    with self.assertRaises(ValueError):native.verify_edge(fixture.state,fixture.config_sha,fixture.config,reader)
    rows[path]=saved
   raw2,bound2,_,_=self.readers(rows,absent[:-1])
   def missing_absence_reader(path,expected=None):
    data=bound2(path,expected) if expected is not None else raw2(path)
    return C.dual_json(data),C.RET_digest(data)
   with self.assertRaises(ValueError):native.verify_edge(fixture.state,fixture.config_sha,fixture.config,missing_absence_reader)
  finally:fixture.tearDown()
 def test_generated_collector_traversal_to_closed_consumer(self):
  import base64,hashlib,os,pathlib,re,stat,subprocess,textwrap,types
  from unittest.mock import patch
  program=subprocess.check_output([os.environ.get('NODE','node'),'--input-type=module','-e',
   "import {retirementCurrentReadProgram as p} from './scripts/retirement-evidence.mjs';process.stdout.write(p)"],cwd=ROOT,text=True)
  path=ROOT/'deploy/ui-retention/check-prepared-reader-successor.test.py'
  ns={'__file__':str(path),'__name__':'collector_successor_fixture'}
  source=path.read_text().replace("source=source.replace(","source=source.replace('/old-index.json','/audit30-policy-admission-index-test.json')\nsource=source.replace(",1)
  exec(compile(source,str(path),'exec'),ns)
  f=ns['Tests']();f.setUp()
  try:
   native=ns['F']
   def read(path,expected=None):
    if path not in f.files:raise FileNotFoundError(path)
    value=f.files[path];raw=native.encoded(value);digest=native.sha(raw)
    if expected is not None:self.assertEqual(digest,expected)
    return {'path':path,'base64':base64.b64encode(raw).decode(),'sha256':digest},value
   result={'lifecycleEvidence':[],'lifecycleAbsentPaths':[]}
   env={'result':result,'lifecycle_rows':{},'read':read,'root':native.BASE+'/',
    'repair_namespace':vars(native),'publication_pins':R._REPAIR_PUBLICATION_FILES,
    'pathlib':pathlib,'re':re,'os':os,'stat':stat,'ancestor':lambda *_:None,
    'config':f.config,'state':f.state,'trusted':{'configSha256':f.config_sha},'anchor':{'sha256':native.PIN['config']}}
   definitions=program[program.index('absent_allowed='):program.index('transition_binding=')]
   traversal=textwrap.dedent(program[program.index(' cfg,st,config_sha='):program.index("for path in result['lifecycleAbsentPaths']")])
   # Only filesystem transport/metadata is synthetic. Exact generated traversal,
   # path allowlists and native proof/seal algebra execute without substitution.
   info=types.SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=0,st_gid=0)
   with patch.object(os.path,'lexists',lambda p:str(p) in f.files),patch.object(Path,'lstat',lambda *_:info),patch.object(Path,'resolve',lambda p,**_:p):
    exec(compile(definitions+traversal,'<generated-collector-traversal>','exec'),env)
   rows={r['path']:base64.b64decode(r['base64']) for r in result['lifecycleEvidence']}
   raw,bound,_,done=self.readers(rows,result['lifecycleAbsentPaths'])
   def closed(path,expected=None):
    data=bound(path,expected) if expected is not None else raw(path)
    return C.dual_json(data),C.RET_digest(data)
   edge=native.verify_edge(f.state,f.config_sha,f.config,closed)
   self.assertEqual(edge['priorConfigSha256'],native.PIN['config']);done()
   self.assertEqual(len(result['lifecycleAbsentPaths']),3)
  finally:f.tearDown()
 def test_ordinary_current_seal_still_required(self):
  from unittest.mock import patch
  fixture=load('ordinary_closed_fixture',ROOT/'deploy/ui-retention/check-retirement-package-upgrade.test.py')
  with fixture.Ancestry() as f:
   f.upgrade(1)
   rows={p:raw for p,raw in f.fixture.files.items() if '/ui-lifecycle-upgrade-' in p}
   external={p:(lambda raw=raw:raw) for p,raw in f.fixture.files.items() if p not in rows}
   raw,bound,publication,_=C.lifecycle_readers(fixture.R,rows,[],external)
   with patch.object(fixture.R,'read_raw_bound',raw),patch.object(fixture.R,'read_bound',bound),patch.object(fixture.R,'read_repair_publication_bound',publication):
    f.verify()
    seal=f.state['lastUpgrade']['statusVerificationPath'];saved=rows.pop(seal)
    with self.assertRaises(ValueError):f.verify()
    rows[seal]=b'{}'
    with self.assertRaises(ValueError):f.verify()
    rows[seal]=saved;f.verify()
if __name__=='__main__':unittest.main()
