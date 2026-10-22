import importlib.util,sys,tempfile,os,io,json
from pathlib import Path
os.umask(0o077)
r=Path(__file__).resolve().parents[1]
def load(n,p):
 s=importlib.util.spec_from_file_location(n,r/p);m=importlib.util.module_from_spec(s);sys.modules[n]=m;s.loader.exec_module(m);return m
E=load('custodyE','deploy/ui-retention/inventory.py');W=load('custodyW','deploy/ui-retention/removal.py')
with tempfile.TemporaryDirectory() as t:
 root=Path(t);p=root/'source';p.mkdir();(p/'a').write_bytes(b'unique');(p/'link').symlink_to('a')
 try:E.inventory(p,os.geteuid());raise AssertionError('strict allowed missing manifest/link')
 except ValueError:pass
 # First read stabilizes atime for intentionally exercised symlink.
 os.readlink(p/'link')
 inv=E.inventory(p,os.geteuid(),require_manifest=False,allow_symlinks=True);expected=dict(inv['fingerprint'],inventory=inv['records'])
 archive=root/'custody.tgz'
 with archive.open('wb') as out:E.archive_root(p,expected,out,os.geteuid(),require_manifest=False,allow_symlinks=True)
 got=E.extract_verify(archive,expected,root/'restored');assert got['modeTimesXattrsRestored']; E.verify_restored(root/'restored',expected)
 fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY);actions=[]
 try:W.delete_tree(fd,p.name,expected,lambda stage,row:actions.append([stage,row]))
 finally:os.close(fd)
 assert not p.exists() and (root/'restored/a').read_bytes()==b'unique'
 p.mkdir();(p/'escape').symlink_to('/etc/passwd')
 try:E.inventory(p,os.geteuid(),require_manifest=False,allow_symlinks=True);raise AssertionError('escape accepted')
 except ValueError:pass
 print('Generic custody restore, deletion, strict default and escaping-link refusal passed')

# Exercise the new modules with the established byte/metadata, adversarial
# archive, ancestor replacement and dependency-reference fixtures as well.
import unittest
suite_module=load('retention_safety_fixtures','deploy/pages/check-ui-storage.test.py')
suite_module.export=E
suite_module.load=lambda name,filename: W if filename=='ui-storage.py' else E
suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(getattr(suite_module,name))
                         for name in ('ArchiveTests','DeleteTests','ReferenceTests','LoadedUnitTests'))
result=unittest.TextTestRunner(verbosity=1).run(suite)
if not result.wasSuccessful():raise SystemExit(1)


# Selective custody fixtures never touch production or invoke a remote command.
import copy, hashlib, stat, tarfile, struct, time, types
from unittest.mock import patch
C=load('custody_controller','deploy/ui-retention/custody.py');C.load_helpers();C.E=E;C.W=W


class FileGroupTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)
  self.parent=self.base/'releases';self.parent.mkdir();self.primary=self.parent/'release.tgz'
  self.names=sorted('release.tgz'+s for s in ('','.sha256','.provenance'))
  for name in self.names:(self.parent/name).write_bytes(('exact '+name).encode())
  (self.parent/'unique-evidence.json').write_text('keep');(self.parent/'other').mkdir()
  os.setxattr(self.primary,'user.custody',b'metadata')
  self.inv=E.inventory_file_group(self.primary,self.names,os.geteuid());self.expected=C.expected({'inventory':self.inv})
 def remove(self,expected=None,hook=None):
  fd=os.open(self.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOATIME)
  try:return W.delete_file_group(fd,expected or self.expected,lambda *args:None,hook)
  finally:os.close(fd)
 def test_exact_export_restore_and_selective_retirement(self):
  archive=self.base/'custody.tgz'
  with archive.open('wb') as sink:E.archive_root(self.primary,self.expected,sink,os.geteuid())
  restored=E.extract_verify(archive,self.expected,self.base/'restore')
  self.assertEqual(restored['sourceRoot'],str(self.primary));self.assertEqual(restored['inventorySha256'],E.inventory_sha(self.inv['records']))
  self.assertEqual(self.remove(),3);self.assertTrue(self.parent.is_dir());self.assertTrue((self.parent/'other').is_dir());self.assertEqual((self.parent/'unique-evidence.json').read_text(),'keep')
  E.verify_restored(self.base/'restore',self.expected)
 def test_missing_group_member_refuses_before_any_unlink(self):
  (self.parent/self.names[-1]).unlink()
  with self.assertRaises(FileNotFoundError):self.remove()
  self.assertTrue(self.primary.exists())
 def test_external_hardlink_refuses(self):
  os.link(self.primary,self.base/'outside')
  with self.assertRaises(ValueError):E.inventory_file_group(self.primary,self.names,os.geteuid())
 def test_metadata_drift_refuses(self):
  os.setxattr(self.primary,'user.changed',b'drift')
  with self.assertRaises(ValueError):self.remove()
  self.assertTrue(self.primary.exists())
 def test_substituted_member_after_intent_refuses(self):
  def hook(phase,row):
   if phase=='before-unlink':
    p=self.parent/row['path'];p.rename(self.base/'preserved-original');p.write_bytes(b'replacement')
  with self.assertRaises(ValueError):self.remove(hook=hook)
  self.assertEqual(self.primary.read_bytes(),b'replacement')
 def test_parent_replacement_refuses(self):
  fd=os.open(self.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:
   self.parent.rename(self.base/'old');self.parent.mkdir()
   with self.assertRaises(ValueError):W.delete_file_group(fd,self.expected,lambda *args:None)
  finally:os.close(fd)
 def test_multiple_groups_retain_shared_parent(self):
  second=self.parent/'second.tgz';names=sorted('second.tgz'+s for s in ('','.sha256','.provenance'))
  for name in names:(self.parent/name).write_bytes(b'second')
  inv=E.inventory_file_group(second,names,os.geteuid());expected=C.expected({'inventory':inv})
  self.remove();self.remove(expected);self.assertTrue((self.parent/'unique-evidence.json').exists())
 def test_restore_rejects_added_unrelated_member(self):
  archive=self.base/'custody.tgz'
  with archive.open('wb') as sink:E.archive_root(self.primary,self.expected,sink,os.geteuid())
  E.extract_verify(archive,self.expected,self.base/'restore');(self.base/'restore/extra').write_text('no')
  with self.assertRaises(ValueError):E.verify_restored(self.base/'restore',self.expected)
 def custody_record(self):
  custody=self.base/'custody';custody.mkdir();key=hashlib.sha256(str(self.primary).encode()).hexdigest()[:16]
  archive=custody/(key+'.tgz');plan=self.base/'plan.json';plan.write_text('{"exact":"plan"}')
  with archive.open('wb') as sink:E.archive_root(self.primary,self.expected,sink,os.geteuid())
  restored=E.extract_verify(archive,self.expected,self.base/'restore');(custody/(key+'.inventory.json')).write_bytes(C.encoded(self.expected))
  record=dict(ok=True,sourcePath=str(self.primary),archivePath=str(archive),archiveSha256=C.digest(archive),inventorySha256=E.inventory_sha(self.inv['records']),sourceInventory=self.expected,restoration=restored,planSha256=C.digest(plan))
  return {'path':str(self.primary),'inventory':self.inv},record,plan,custody
 def test_custody_binds_exact_source_plan_inventory_archive_and_restore(self):
  row,record,plan,custody=self.custody_record();C.verify_custody(row,record,plan,custody)
  for change in ('source','plan','inventory','archive','restoration'):
   bad=copy.deepcopy(record)
   if change=='source':bad['sourcePath']+='/other'
   elif change=='plan':bad['planSha256']='0'*64
   elif change=='inventory':bad['sourceInventory']['inventory'][0]['identity']['st_mode']^=0o100
   elif change=='archive':bad['archiveSha256']='0'*64
   else:bad['restoration']['ownerRestored']=False
   with self.subTest(change=change),self.assertRaises(ValueError):C.verify_custody(row,bad,plan,custody)
 def test_archive_corruption_refuses_custody_reuse(self):
  row,record,plan,custody=self.custody_record();Path(record['archivePath']).write_bytes(b'corrupt')
  with self.assertRaises(ValueError):C.verify_custody(row,record,plan,custody)
 def completion_fixture(self):
  name='proofofwork-ui-release-'+'a'*12+'-20261010T010203Z.tgz'
  for suffix in ('','.sha256','.provenance'):(self.parent/('release.tgz'+suffix)).rename(self.parent/(name+suffix))
  primary=self.parent/name;inv=E.inventory_file_group(primary,sorted(name+s for s in ('','.sha256','.provenance')),os.geteuid());source=C.expected({'inventory':inv})
  row=dict(path=str(primary),eligible=True,retirementMethod='custody',inventory=inv)
  plan=dict(candidates=[row]);plan_sha=E.digest(C.encoded(plan));key=hashlib.sha256(str(primary).encode()).hexdigest()[:16]
  receipt=self.base/'cleanup-evidence'/('bounded-retention-'+plan_sha[:12]+'-'+key);receipt.mkdir(parents=True)
  archive=self.base/'preserved.tgz'
  with archive.open('wb') as sink:E.archive_root(primary,source,sink,os.geteuid())
  restoration=E.extract_verify(archive,source,self.base/'restored')
  custody=dict(ok=True,sourcePath=str(primary),sourceInventory=source,inventorySha256=E.inventory_sha(inv['records']),archiveSha256=C.digest(archive),planSha256=plan_sha,restoration=restoration)
  (receipt/'intent.json').write_bytes(C.encoded(dict(plan={},row=row,custody=custody)))
  journal=W.Journal(receipt/'actions.jsonl');fd=os.open(self.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:count=W.delete_file_group(fd,source,journal)
  finally:journal.close();os.close(fd)
  completed=dict(ok=True,path=str(primary),receipt=str(receipt),actions=count,custody=custody,protectedPairVerified=True)
  (receipt/'completed.json').write_bytes(C.encoded(completed));result=dict(ok=True,completed=[completed],planSha256=plan_sha)
  return plan,plan_sha,result,receipt,primary
 def test_terminal_validator_requires_durable_complete_actions_and_absence(self):
  plan,sha,result,receipt,primary=self.completion_fixture()
  with patch.object(C,'BASE',self.base),patch.object(C,'fence'),patch.object(C,'discover',return_value=[]):
   self.assertTrue(C.verify_final_result(plan,sha,result,E.digest(C.encoded(result)))['ok'])
   primary.write_bytes(b'reappeared')
   with self.assertRaisesRegex(ValueError,'reappeared'):C.verify_final_result(plan,sha,result,E.digest(C.encoded(result)))
 def test_terminal_validator_rejects_partial_journal_and_remaining_bulk(self):
  plan,sha,result,receipt,primary=self.completion_fixture()
  with patch.object(C,'BASE',self.base),patch.object(C,'fence'),patch.object(C,'discover',return_value=[self.base/'other']),patch.object(C,'qualify_candidate',return_value={'eligible':True}):
   with self.assertRaisesRegex(ValueError,'remain'):C.verify_final_result(plan,sha,result,E.digest(C.encoded(result)))
  log=receipt/'actions.jsonl';log.write_bytes(b'\n'.join(log.read_bytes().splitlines()[:-1])+b'\n')
  with patch.object(C,'BASE',self.base),patch.object(C,'fence'),patch.object(C,'discover',return_value=[]):
   with self.assertRaisesRegex(ValueError,'partial'):C.verify_final_result(plan,sha,result,E.digest(C.encoded(result)))


class ArtifactQualificationTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)
  self.backups=self.base/'backups';self.scratch=self.base/'scratch';self.scratch.mkdir();self.backups.mkdir()
  for name in ('transport-evidence','rollback-roots','releases'):(self.backups/name).mkdir()
  self.rid='a'*12+'-20261010T010203Z';self.commit='a'*40;self.tree='b'*40;self.held=[]
  self.plan={'current':{'release_id':'f'*12+'-20261016T010203Z'},'prior':{'release_id':'e'*12+'-20261015T010203Z'},'priorRoot':str(self.backups/'rollback-roots/prior'),'lifecycle':{'fixture':True},'closure':{'protectedPaths':[],'ordinaryEligiblePaths':[],'admittedReleaseIds':[]}}
  self.addCleanup(patch.stopall);patch.object(C,'BASE',self.backups).start();patch.object(C,'SCRATCH',self.scratch).start()
  original=E.read_regular
  def read(path,*args,**kwargs):
   if str(path)=='/etc/proofofwork-retention/audit28-held-review.json':return json.dumps({'retain':self.held}).encode(),None
   return original(path,*args,**kwargs)
  patch.object(E,'read_regular',side_effect=read).start()
 def publication(self):
  p=self.scratch/('recovery-publish-'+self.rid+'-initial');p.mkdir()
  common=dict(attempt='initial',releaseId=self.rid,commit=self.commit,tree=self.tree)
  (p/'intent.json').write_text(json.dumps(dict(common,planSha256='c'*64)))
  log=('ui_release_publish status=published release_id='+self.rid+' commit='+self.commit+' rollback_root=/retained\n').encode();(p/'publisher.log').write_bytes(log)
  (p/'receipt.json').write_text(json.dumps(dict(common,exitCode=0,failure=None,evidence=str(p),capturedLogBytes=len(log),publisherLogSha256=hashlib.sha256(log).hexdigest())))
  return p
 def surfaces(self):
  parent=self.backups/'transport-evidence'/self.rid;parent.mkdir();p=parent/('proofofwork-ui-surfaces-'+self.rid);p.mkdir();(p/'surfaces').mkdir();(p/'surfaces/code').mkdir();(p/'surfaces/code/index.html').write_text('exact')
  inv=E.inventory(p,os.geteuid(),require_manifest=False);fp=C.payload_fingerprint(inv)
  common=dict(releaseId=self.rid,planSha256='c'*64,preservedPath=str(p),payloadFingerprint=fp,historicalDeletion=False)
  receiver=dict(status='verified',kind='surfaces',releaseId=self.rid,archiveSha256='d'*64,compressedBytes=123,entries=fp['entries'],logicalBytes=fp['regularBytes'],extractedRoot=str(self.scratch/p.name))
  (parent/'incoming-intent.json').write_text(json.dumps(dict(common,oldPath=str(self.scratch/p.name))))
  (parent/'incoming-receipt.json').write_text(json.dumps(dict(common,format='proof-of-work-ui-incoming-evidence-v1',commit=self.commit,tree=self.tree,receiverReceipt=receiver,movePreservedInodes=True,allPriorEvidencePreserved=True)))
  return p,inv
 def test_surface_fingerprint_matches_transport_path_order_and_detects_tampering(self):
  root=self.base/'payload';root.mkdir();(root/'landing').mkdir()
  (root/'landing/index.html').write_bytes(b'index');(root/'landing-banner.svg').write_bytes(b'banner')
  (root/'landing.json').write_bytes(b'metadata')
  # Independent producer algorithm: the exact ordering used by remote_transport.
  rows=[]
  for path in [root,*sorted(root.rglob('*'))]:
   info=path.lstat();kind='directory' if path.is_dir() else 'file'
   rows.append([path.relative_to(root).as_posix(),kind,stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid,
                info.st_size if kind=='file' else 0,hashlib.sha256(path.read_bytes()).hexdigest() if kind=='file' else None])
  receipt=dict(sha256=hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest(),entries=len(rows),regularBytes=sum(row[5] for row in rows))
  self.assertNotEqual(rows,sorted(rows,key=lambda row:row[0]))
  inventory=E.inventory(root,os.geteuid(),require_manifest=False)
  self.assertEqual(C.payload_fingerprint(inventory),receipt)
  inventory['records'].reverse()
  self.assertEqual(C.payload_fingerprint(inventory),receipt)
  for field,value in [('sha256','0'*64),('st_mode',0o100640),('st_size',999)]:
   changed=copy.deepcopy(inventory);member=next(row for row in changed['records'] if row['kind']=='file')
   (member if field=='sha256' else member['identity'])[field]=value
   self.assertNotEqual(C.payload_fingerprint(changed),receipt)
 def managed_archive(self):
  primary=self.backups/'releases'/('proofofwork-ui-release-'+self.rid+'.tgz')
  fields=dict(format='proofofwork-ui-release-v5',release_id=self.rid,commit=self.commit,source_tree=self.tree,archive_name=primary.name)
  with tarfile.open(primary,'w:gz') as archive:
   for name in ['surfaces',*['surfaces/'+s for s in sorted(C.R.PERMISSION_SURFACES)]]:
    member=tarfile.TarInfo(name);member.type=tarfile.DIRTYPE;member.mode=0o755;member.uid=os.geteuid();member.gid=os.getegid();archive.addfile(member)
   for surface in sorted(C.R.PERMISSION_SURFACES):
    raw=('surface '+surface).encode();member=tarfile.TarInfo('surfaces/'+surface+'/index.html');member.size=len(raw);member.mode=0o644;member.uid=os.geteuid();member.gid=os.getegid();archive.addfile(member,io.BytesIO(raw))
    fields['surface.'+surface+'.sha256']=hashlib.sha256(b'index.html\0'+b'644\0'+hashlib.sha256(raw).hexdigest().encode()+b'\n').hexdigest();fields['surface.'+surface+'.file_count']='1'
  fields['archive_sha256']=C.digest(primary)
  Path(str(primary)+'.sha256').write_text(fields['archive_sha256']+'  '+primary.name+'\n')
  Path(str(primary)+'.provenance').write_text(''.join(k+'='+v+'\n' for k,v in fields.items()))
  names=sorted(primary.name+s for s in ('','.sha256','.provenance'));inv=E.inventory_file_group(primary,names,os.geteuid())
  return primary,inv
 def test_surface_copy_requires_exact_receipts_and_terminal_publication(self):
  p,inv=self.surfaces();self.publication();proof=C.artifact_proof(p,self.plan,inv)
  self.assertEqual(proof['releaseId'],self.rid);self.assertEqual(len(proof['bindings']),2)
  self.assertEqual(C.artifact(p),('preserved-surfaces',self.rid))
 def test_no_terminal_receipt_never_qualifies_by_age(self):
  p,inv=self.surfaces()
  with self.assertRaisesRegex(ValueError,'terminal publication'):C.artifact_proof(p,self.plan,inv)
 def test_pending_attempt_blocks_even_with_prior_success(self):
  p,inv=self.surfaces();self.publication();q=self.scratch/('recovery-publish-'+self.rid+'-retry');q.mkdir();(q/'intent.json').write_text('{}')
  with self.assertRaisesRegex(ValueError,'terminal receipt'):C.artifact_proof(p,self.plan,inv)
 def test_receiver_content_mismatch_refuses(self):
  p,inv=self.surfaces();self.publication();(p/'surfaces/code/index.html').write_text('changed')
  changed=E.inventory(p,os.geteuid(),require_manifest=False)
  with self.assertRaisesRegex(ValueError,'Receiver/payload'):C.artifact_proof(p,self.plan,changed)
 def test_current_prior_source_dependencies_refuse(self):
  p,inv=self.surfaces();self.plan['closure']['protectedPaths']=[str(p.parent)]
  with self.assertRaisesRegex(ValueError,'dependency graph'):C.scope(p,self.plan)
 def test_held_ancestor_never_inherits_ordinary_exception(self):
  p,inv=self.surfaces();self.held=[dict(path=str(p.parent),role='ui',retentionClass='managed-ui-recovery-container',decision='retain')]
  self.plan['closure']['ordinaryEligiblePaths']=[str(p)]
  with self.assertRaisesRegex(ValueError,'held path'):C.scope(p,self.plan)
 def test_exact_ordinary_root_container_exception(self):
  p=self.backups/'rollback-roots'/('proofofwork-www-pre-'+self.rid);p.mkdir()
  self.held=[dict(path=str(p.parent),role='ui',retentionClass='managed-ui-recovery-container',decision='retain')]
  with self.assertRaises(ValueError):C.scope(p,self.plan)
  self.plan['closure']['ordinaryEligiblePaths']=[dict(path=str(p),kind='rollback-root')]
  self.assertTrue(C.scope(p,self.plan)[2])
  self.held.append(dict(path=str(p/'unique'),role='ui',decision='retain'))
  with self.assertRaises(ValueError):C.scope(p,self.plan)
 def test_parent_evidence_directory_and_mismatched_release_are_outside_scope(self):
  p,inv=self.surfaces()
  for q in (p.parent,p.parent/('proofofwork-ui-surfaces-'+'b'*12+'-20261010T010203Z')):
   with self.assertRaisesRegex(ValueError,'allowlist'):C.artifact(q)
 def test_missing_new_lifecycle_binding_refuses(self):
  p,inv=self.surfaces();del self.plan['lifecycle']
  with self.assertRaisesRegex(ValueError,'lifecycle binding'):C.scope(p,self.plan)
 def test_exact_archive_group_sidecar_hold_refuses(self):
  p=self.backups/'releases'/('proofofwork-ui-release-'+self.rid+'.tgz');p.write_bytes(b'archive')
  self.held=[dict(path=str(p)+'.provenance',role='ui',decision='retain')]
  with self.assertRaisesRegex(ValueError,'held path'):C.scope(p,self.plan)
 def test_ordinary_archive_group_preserves_complete_verified_payload(self):
  p,inv=self.managed_archive();self.plan['closure']['ordinaryEligiblePaths']=[str(p)+s for s in ('','.sha256','.provenance')]
  self.held=[dict(path=str(p.parent),role='ui',decision='retain',retentionClass='managed-ui-recovery-container')]
  proof=C.artifact_proof(p,self.plan,inv);self.assertEqual(proof['archiveSha256'],C.digest(p));self.assertIsNone(proof['terminalPublication'])
 def test_unadmitted_archive_requires_positive_publication_and_no_retained_root(self):
  p,inv=self.managed_archive();self.publication()
  with patch.object(C.R,'manifest',return_value={'archive_name':'another.tgz'}):
   self.assertIsNotNone(C.artifact_proof(p,self.plan,inv)['terminalPublication'])
  with patch.object(C.R,'manifest',return_value={'archive_name':p.name}):
   with self.assertRaisesRegex(ValueError,'still depends'):C.artifact_proof(p,self.plan,inv)
 def test_unadmitted_archive_never_inherits_managed_container_exception(self):
  p,inv=self.managed_archive();self.publication();self.held=[dict(path=str(p.parent),role='ui',decision='retain',retentionClass='managed-ui-recovery-container')]
  with self.assertRaisesRegex(ValueError,'held path'):C.artifact_proof(p,self.plan,inv)
 def test_archive_missing_sidecar_or_wrong_checksum_refuses(self):
  p,inv=self.managed_archive();self.plan['closure']['ordinaryEligiblePaths']=[str(p)+s for s in ('','.sha256','.provenance')]
  Path(str(p)+'.sha256').write_text('0'*64+'  '+p.name+'\n')
  with self.assertRaisesRegex(ValueError,'checksum sidecar'):C.artifact_proof(p,self.plan,inv)
  Path(str(p)+'.sha256').unlink()
  with self.assertRaises(FileNotFoundError):E.inventory_file_group(p,sorted(p.name+s for s in ('','.sha256','.provenance')),os.geteuid())
 def test_failed_only_stage_stays_resumable_in_lifecycle(self):
  p=self.scratch/('proofofwork-www-stage-'+self.rid);p.mkdir();(p/'candidate.html').write_text('resume')
  inv=E.inventory(p,os.geteuid(),require_manifest=False)
  with self.assertRaisesRegex(ValueError,'terminal publication'):C.artifact_proof(p,self.plan,inv)
  self.assertTrue((p/'candidate.html').exists())
 def test_three_successive_surface_copy_cycles_keep_pair_and_receipts(self):
  paths=[]
  for number,letter in enumerate('abcde'):
   self.rid=letter*12+'-20261010T010203Z';self.commit=letter*40
   path,inv=self.surfaces();self.publication();paths.append(path)
   self.plan['current']['release_id']=self.rid
   if number:self.plan['prior']['release_id']=paths[-2].parent.name
   self.plan['closure']['protectedPaths']=[str(p) for p in paths[-2:]]
   for protected in paths[-2:]:
    with self.assertRaises(ValueError):C.scope(protected,self.plan)
   for old in paths[:-2]:
    if not old.exists():continue
    observed=E.inventory(old,os.geteuid(),require_manifest=False);C.artifact_proof(old,self.plan,observed)
    expected=C.expected({'inventory':observed});archive=self.base/(old.parent.name+'.custody.tgz')
    with archive.open('wb') as sink:E.archive_root(old,expected,sink,os.geteuid(),require_manifest=False)
    E.extract_verify(archive,expected,self.base/('restore-'+old.parent.name))
    fd=os.open(old.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:W.delete_tree(fd,old.name,expected,lambda *args:None)
    finally:os.close(fd)
    self.assertTrue((old.parent/'incoming-intent.json').exists());self.assertTrue((old.parent/'incoming-receipt.json').exists())
   self.assertEqual(sum(p.exists() for p in paths),min(2,len(paths)))


class ClosedOrdinaryAliasTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)
  self.old=self.base/'ordinary';self.live=self.base/'live';self.prior=self.base/'prior'
  for p in (self.old,self.live,self.prior):p.mkdir()
  (self.old/'one').write_bytes(b'exact shared payload');os.link(self.old/'one',self.old/'two');os.link(self.old/'one',self.live/'shared')
  self.inv=E.inventory(self.old,os.geteuid(),require_manifest=False)
  self.plan={'closure':dict(index={'path':'/immutable/index.json','sha256':'a'*64},protectedReleaseIds=['current','prior'],pair={k:{'snapshot':C.A.snapshot(p)} for k,p in [('current',self.live),('previous',self.prior)]},ordinaryEligibleSnapshots=[dict(path=str(self.old),kind='rollback-root',snapshot=C.A.snapshot(self.old))])}
  self.proof=C.closed_alias_proof(self.old,self.plan,self.inv);self.expected=C.expected(dict(inventory=self.inv,externalLinkClosure=self.proof))
 def test_default_export_still_refuses_and_exact_ordinary_export_restores_internal_links(self):
  with self.assertRaisesRegex(ValueError,'external hardlink'):E.archive_root(self.old,self.expected,io.BytesIO(),os.geteuid(),require_manifest=False)
  archive=self.base/'ordinary.tgz'
  with archive.open('wb') as sink:E.archive_root(self.old,self.expected,sink,os.geteuid(),require_manifest=False,ordinary_closed_aliases=True)
  restored=E.extract_verify(archive,self.expected,self.base/'restored')
  self.assertEqual((self.base/'restored/one').stat().st_ino,(self.base/'restored/two').stat().st_ino)
  self.assertEqual((self.base/'restored/one').stat().st_nlink,2)
  self.assertEqual(restored['externalLinkClosureSha256'],E.digest(E.encoded(self.proof)));self.assertTrue(restored['externalAliasesRetainedAsEvidence'])
  self.assertEqual((self.live/'shared').stat().st_nlink,3)
 def test_unknown_alias_refuses_even_opted_in(self):
  os.link(self.old/'one',self.base/'unknown')
  with self.assertRaises(ValueError):C.closed_alias_proof(self.old,self.plan,E.inventory(self.old,os.geteuid(),require_manifest=False))
  with self.assertRaises(ValueError):E.archive_root(self.old,self.expected,io.BytesIO(),os.geteuid(),require_manifest=False,ordinary_closed_aliases=True)
 def test_changed_alias_path_or_missing_alias_refuses(self):
  (self.live/'shared').rename(self.live/'moved')
  with self.assertRaises(FileNotFoundError):E.verify_closed_aliases(self.old,self.inv['records'],self.proof)
 def test_new_link_during_export_refuses(self):
  sink=io.BytesIO();original=E.assert_stable
  def changed(root,records):os.link(self.old/'one',self.base/'late');return original(root,records)
  with patch.object(E,'assert_stable',side_effect=changed):
   with self.assertRaises(ValueError):E.archive_root(self.old,self.expected,sink,os.geteuid(),require_manifest=False,ordinary_closed_aliases=True)
 def test_generic_retirement_still_refuses_closed_alias_roots(self):
  fd=os.open(self.base,os.O_RDONLY|os.O_DIRECTORY)
  try:
   with self.assertRaisesRegex(ValueError,'external hardlinks'):W.delete_tree(fd,self.old.name,self.expected,lambda *args:None)
  finally:os.close(fd)
  self.assertTrue((self.live/'shared').exists())


class OffhostCapacityTests(unittest.TestCase):
 def test_exact_fit_and_one_byte_or_inode_over_shared_filesystem(self):
  row={'inventory':{'fingerprint':dict(format='test',regularBytes=100), 'records':[dict(path='a',kind='file')]}}
  model=C.custody_allocation([row]);needed=model['archiveBytes']+model['restoreBytes'];inodes=model['archiveInodes']+model['restoreInodes']
  state=dict(device=1,availableBytes=needed+C.OFFHOST_RESERVE_BYTES,availableInodes=inodes+C.OFFHOST_RESERVE_INODES)
  self.assertTrue(C.check_custody_capacity([row],'/custody','/restore',observe=lambda p:state)['ok'])
  for field in ('availableBytes','availableInodes'):
   bad=dict(state);bad[field]-=1
   with self.assertRaisesRegex(ValueError,'capacity refused'):C.check_custody_capacity([row],'/custody','/restore',observe=lambda p:bad)
 def test_sealed_archives_are_not_charged_again_before_restore(self):
  rows=[{'inventory':{'fingerprint':dict(format='test',regularBytes=1000000), 'records':[dict(path='a',kind='file')]}} for _ in range(3)]
  initial=C.custody_allocation(rows);remaining=C.custody_allocation(rows,archives_existing=True)
  self.assertGreater(initial['archiveBytes'],remaining['archiveBytes'])
  self.assertEqual(initial['restoreBytes'],remaining['restoreBytes'])
  self.assertGreater(remaining['archiveBytes'],0) # Future receipts/metadata stay reserved.
  needed=remaining['archiveBytes']+remaining['restoreBytes'];inodes=remaining['archiveInodes']+remaining['restoreInodes']
  state=dict(device=1,availableBytes=needed+C.OFFHOST_RESERVE_BYTES,availableInodes=inodes+C.OFFHOST_RESERVE_INODES)
  self.assertTrue(C.check_custody_capacity(rows,'/custody','/restore',archives_existing=True,observe=lambda p:state)['ok'])
  with self.assertRaisesRegex(ValueError,'capacity refused'):C.check_custody_capacity(rows,'/custody','/restore',observe=lambda p:state)
  state['availableBytes']-=1
  with self.assertRaisesRegex(ValueError,'capacity refused'):C.check_custody_capacity(rows,'/custody','/restore',archives_existing=True,observe=lambda p:state)
 def test_distinct_custody_and_restore_devices_each_require_reserve(self):
  model=C.custody_allocation([])
  def state(p):return dict(device=1 if p=='/custody' else 2,availableBytes=C.OFFHOST_RESERVE_BYTES-1 if p=='/restore' else C.OFFHOST_RESERVE_BYTES,availableInodes=C.OFFHOST_RESERVE_INODES)
  with self.assertRaisesRegex(ValueError,'capacity refused'):C.check_custody_capacity([],'/custody','/restore',observe=state)


class BatchPreservationTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)
  self.rows=[]
  for number in range(3):
   root=self.base/('source'+str(number));root.mkdir();(root/'content').write_bytes(('unique '+str(number)).encode())
   inv=E.inventory(root,os.geteuid(),require_manifest=False)
   self.rows.append(dict(path=str(root),eligible=True,retirementMethod='custody',artifactClass='preserved-source',inventory=inv))
  self.plan=dict(candidates=self.rows);self.plan_sha=E.digest(C.encoded(self.plan));self.custody=self.base/'custody';self.custody.mkdir()
 def stream(self):
  output=io.BytesIO();original=E.archive_root
  def archive(root,expected,sink,**kw):return original(root,expected,sink,os.geteuid(),**kw)
  with patch.object(C,'fence') as fence,patch.object(C.A,'require_execution_lock',return_value={'fd':99}),patch.object(C,'batch_guards',return_value={}),patch.object(C,'guard_batch'),patch.object(C,'check_references'),patch.object(C,'scope',return_value=('preserved-source',None,False)),patch.object(C,'row_inventory',side_effect=lambda p,k:E.inventory(p,os.geteuid(),require_manifest=False)),patch.object(E,'archive_root',side_effect=archive):
   C.remote_export_batch(dict(plan=self.plan,planSha256=self.plan_sha),output,99)
   self.assertEqual([c.kwargs for c in fence.call_args_list],[{'full':True},{'full':True}])
  return output.getvalue()
 def receive(self,raw):return C.receive_batch(io.BytesIO(raw),self.plan,self.custody,time.monotonic()+10)
 def rewrite(self,raw,change):
  source=io.BytesIO(raw[len(C.BATCH_MAGIC):]);out=io.BytesIO();out.write(C.BATCH_MAGIC);number=0
  while source.tell()<len(raw)-len(C.BATCH_MAGIC):
   kind,value=C.read_batch_frame(source,time.monotonic()+10)
   replacement=change(number,kind,value);number+=1
   if replacement is not None:kind,value=replacement
   C.batch_frame(out,kind,C.encoded(value) if kind==b'J' else value)
  return out.getvalue()
 def test_real_archives_stream_and_restore_with_only_two_full_fences(self):
  result=self.receive(self.stream());self.assertEqual(result['count'],3)
  self.assertFalse((self.custody/'batch-exported.json').exists())
  for number,row in enumerate(self.rows):
   key=hashlib.sha256(row['path'].encode()).hexdigest()[:16];archive=self.custody/(key+'.tgz')
   E.extract_verify(archive,C.expected(row),self.base/('restored'+str(number)))
   self.assertEqual((self.base/('restored'+str(number))/'content').read_bytes(),('unique '+str(number)).encode())
 def test_truncated_stream_never_has_a_batch_seal(self):
  with self.assertRaisesRegex(ValueError,'truncated'):self.receive(self.stream()[:-7])
  self.assertFalse((self.custody/'batch-exported.json').exists())
 def test_trailing_bytes_refuse_even_after_a_valid_seal(self):
  with self.assertRaises(ValueError):self.receive(self.stream()+b'extra')
 def test_wrong_object_order_refuses_before_archive_creation(self):
  raw=self.rewrite(self.stream(),lambda n,k,v:(k,dict(v,index=2)) if k==b'J' and v.get('type')=='object-start' and v['index']==0 else None)
  with self.assertRaisesRegex(ValueError,'ordering'):self.receive(raw)
  self.assertFalse(list(self.custody.glob('*.tgz')))
 def test_data_corruption_refuses_before_restore(self):
  changed=[False]
  def corrupt(n,k,v):
   if k==b'D' and not changed[0]:changed[0]=True;return k,bytes([v[0]^1])+v[1:]
  with self.assertRaisesRegex(ValueError,'proof differs'):self.receive(self.rewrite(self.stream(),corrupt))
 def test_changed_final_manifest_refuses(self):
  raw=self.rewrite(self.stream(),lambda n,k,v:(k,dict(v,objectManifestSha256='0'*64)) if k==b'J' and v.get('type')=='batch-complete' else None)
  with self.assertRaisesRegex(ValueError,'final custody batch seal'):self.receive(raw)
 def test_oversized_frame_is_refused_before_payload_allocation(self):
  raw=C.BATCH_MAGIC+b'J'+struct.pack('>I',C.BATCH_JSON+1)
  with self.assertRaisesRegex(ValueError,'oversized'):self.receive(raw)
 def test_duplicate_plan_paths_and_pool_expansion_refuse(self):
  with self.assertRaisesRegex(ValueError,'Duplicate'):C.batch_rows(dict(candidates=[self.rows[0],self.rows[0]]))
  with patch.object(C,'BATCH_BYTES',1),self.assertRaisesRegex(ValueError,'retained-pool'):C.batch_rows(self.plan)
 def test_closed_empty_batch_is_exact(self):
  self.plan={'candidates':[]};self.rows=[];self.plan_sha=E.digest(C.encoded(self.plan))
  self.assertEqual(self.receive(self.stream())['objects'],[])
 def test_exact_complete_dependency_metadata_guards_refuse_xattr_drift(self):
  path=Path(self.rows[0]['path']);fp=C.A.snapshot(path,links=True);guards={str(path):fp}
  with patch.object(C,'fence'):
   C.guard_batch({},guards)
   os.setxattr(path/'content','user.changed',b'new')
   with self.assertRaises(ValueError):C.guard_batch({},guards)
 def test_new_dependency_member_refuses(self):
  path=Path(self.rows[0]['path']);guards={str(path):C.A.snapshot(path,links=True)}
  (path/'new').write_bytes(b'drift')
  with patch.object(C,'fence'),self.assertRaises(ValueError):C.guard_batch({},guards)
 def test_streamed_member_hash_must_match_inventory(self):
  row=self.rows[0];bad=copy.deepcopy(row['inventory']);next(r for r in bad['records'] if r['kind']=='file')['sha256']='0'*64
  expected=dict(bad['fingerprint'],inventory=bad['records'])
  with patch.object(E,'inventory',return_value=bad),self.assertRaisesRegex(ValueError,'Streamed archive member bytes differ'):
   E.archive_root(Path(row['path']),expected,io.BytesIO(),os.geteuid(),require_manifest=False)
 def test_nonzero_process_exit_after_seal_leaves_partial_evidence_only(self):
  raw=self.stream();fake=types.SimpleNamespace(stdin=io.BytesIO(),stdout=io.BytesIO(raw),wait=lambda **kw:1,poll=lambda:1)
  with patch.object(C.subprocess,'Popen',return_value=fake),patch.object(C,'launcher',return_value=b'approved request'),patch.object(C,'check_custody_capacity'),self.assertRaisesRegex(ValueError,'exit successfully'):
   C.export_batch(self.plan,self.custody,self.base)
  self.assertTrue((self.custody/'batch-intent.json').exists());self.assertTrue((self.custody/'batch-failure.json').exists())
  self.assertFalse((self.custody/'batch-exported.json').exists());self.assertFalse(list(self.custody.glob('*.inventory.json')))
 def test_partial_batch_cannot_resume_automatically(self):
  (self.custody/'batch-intent.json').write_bytes(b'{}');path=self.base/'plan.json';path.write_bytes(C.encoded(self.plan))
  with patch.object(C,'check_custody_capacity') as capacity,self.assertRaisesRegex(ValueError,'no automatic resume'):
   C.preserve(path,self.custody,True)
  capacity.assert_not_called()
 def test_read_deadline_is_bounded(self):
  with self.assertRaisesRegex(ValueError,'deadline'):C.read_exact(io.BytesIO(),1,time.monotonic()-1)
 def test_receipt_graph_includes_split_intent_binding_and_prior_index(self):
  evidence=self.base/'cleanup-evidence';evidence.mkdir()
  def store(name,value):
   p=evidence/name;p.write_bytes(C.encoded(value));return dict(path=str(p),sha256=C.digest(p))
  prior=store('prior-index.json',{'history':[]});intent=store('ordinary-intent.json',{'plan':{'admissionIndex':prior}})
  completed=store('ordinary-completed.json',dict(intentPath=intent['path'],intentSha256=intent['sha256']))
  index=store('index.json',dict(completedRetirements=[completed]));approval=store('approval.json',{'authorized':True})
  protected=C.A.snapshot(Path(self.rows[0]['path']),links=True)
  with patch.object(C,'BASE',self.base):
   guards=C.batch_guards(dict(closure={'protected':protected},lifecycle=dict(index=index,approval=approval)))
  self.assertEqual(set(guards),{protected['path'],prior['path'],intent['path'],completed['path'],index['path'],approval['path']})
 def test_protected_archive_and_sidecars_receive_intermediate_guards(self):
  protected=C.A.snapshot(Path(self.rows[0]['path']),links=True)
  files=[]
  for suffix in ('','.sha256','.provenance'):
   p=self.base/('protected.tgz'+suffix);p.write_bytes(('exact '+suffix).encode());files.append(str(p))
  plan=dict(closure=dict(protected=protected,protectedPaths=files))
  guards=C.batch_guards(plan);self.assertEqual(set(guards),{protected['path'],*files})
  with patch.object(C,'fence'):C.guard_batch(plan,guards)
  os.setxattr(files[1],'user.changed',b'drift')
  with patch.object(C,'fence'),self.assertRaises(ValueError):C.guard_batch(plan,guards)
 def test_reference_members_are_derived_even_when_row_members_are_empty(self):
  rows=[dict(path='/approved/source',members=[]),dict(path='/approved/archive.tgz',members=['/wrong'])]
  with patch.object(C,'scope',side_effect=[('preserved-source',None,False),('managed-archive-group',None,True)]):
   self.assertEqual(C.batch_members(rows,{}),['/approved/source','/approved/archive.tgz','/approved/archive.tgz.sha256','/approved/archive.tgz.provenance'])
 def test_real_execution_lock_is_required_before_export(self):
  with self.assertRaises(ValueError):C.remote_export_batch(dict(plan=self.plan,planSha256=self.plan_sha),io.BytesIO(),None)


class RetirementBudgetTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)
  self.root=self.base/'source';self.root.mkdir();(self.root/'file').write_bytes(b'unique')
  self.inventory=E.inventory(self.root,os.geteuid(),require_manifest=False)
  self.row=dict(path=str(self.root),inventory=self.inventory,eligible=True)
  self.source=C.expected(self.row);self.frame=dict(custody={'sourceInventory':self.source},row=self.row)
 def test_exact_budget_accepts_and_one_byte_over_refuses(self):
  total=C.retirement_capacity(self.frame,self.source)['totalBytes']
  with patch.object(C,'RETIREMENT_RECEIPT_BYTES',total):self.assertEqual(C.retirement_capacity(self.frame,self.source)['totalBytes'],total)
  with patch.object(C,'RETIREMENT_RECEIPT_BYTES',total-1),self.assertRaisesRegex(ValueError,'32 MiB'):C.retirement_capacity(self.frame,self.source)
 def test_journal_ceiling_is_independent_and_unchanged(self):
  for invalid in (0,True,16*1024**2+1):
   with patch.object(W,'journal_capacity_bound',return_value=invalid),self.assertRaisesRegex(ValueError,'16 MiB'):C.retirement_capacity(self.frame,self.source)
 def test_auxiliary_reservation_is_full_and_failure_message_is_bounded(self):
  bound=C.retirement_capacity(self.frame,self.source)
  self.assertEqual(bound['auxiliaryBytes'],256*1024)
  raw=C.encoded(dict(error=C.bounded_error(ValueError('\U0001f600'*100000)),manualReconciliationRequired=True))
  self.assertLessEqual(len(raw),C.RETIREMENT_FAILURE_BYTES);self.assertIn(b'truncated',raw)
 def test_remote_writer_uses_enforced_bound_and_preserves_receipt_schema(self):
  import contextlib
  evidence=self.base/'cleanup-evidence';evidence.mkdir()
  custody=dict(ok=True,sourcePath=str(self.root),sourceInventory=self.source,inventorySha256=E.inventory_sha(self.inventory['records']),restoration=dict(ownerRestored=True,modeTimesXattrsRestored=True,internalHardlinksRestored=True))
  frame=dict(plan={},row=self.row,custody=custody,operationId='fixture')
  original=W.Journal;calls=[]
  def journal(path,**kwargs):calls.append(kwargs);return original(path,**kwargs)
  with patch.object(C,'BASE',self.base),patch.object(C.os,'geteuid',return_value=0),patch.object(E,'lock_existing',side_effect=lambda:os.open(self.base,os.O_RDONLY|os.O_DIRECTORY)),patch.object(C,'scope',return_value=('preserved-source',None,False)),patch.object(C,'fence'),patch.object(C,'check_references'),patch.object(C,'row_inventory',return_value=self.inventory),patch.object(C.subprocess,'run'),patch.object(W,'Journal',side_effect=journal),contextlib.redirect_stdout(io.StringIO()):
   C.remote_operation('retire',frame)
  receipt=evidence/'bounded-retention-fixture'
  self.assertEqual(calls,[dict(expected_root=self.source)]);self.assertFalse(self.root.exists())
  self.assertEqual(json.loads((receipt/'intent.json').read_bytes()),frame)
  completed=json.loads((receipt/'completed.json').read_bytes())
  self.assertEqual(set(completed),{'ok','path','actions','custody','beforeAvailableBytes','afterAvailableBytes','receipt','protectedPairVerified'})
  self.assertLessEqual((receipt/'actions.jsonl').stat().st_size,W.journal_capacity_bound(self.source))
 def test_remote_failure_evidence_is_bounded_and_does_not_erase_intent(self):
  self.base.joinpath('cleanup-evidence').mkdir()
  custody=dict(ok=True,sourcePath=str(self.root),sourceInventory=self.source,inventorySha256=E.inventory_sha(self.inventory['records']),restoration=dict(ownerRestored=True,modeTimesXattrsRestored=True,internalHardlinksRestored=True))
  frame=dict(plan={},row=self.row,custody=custody,operationId='fixture')
  with patch.object(C,'BASE',self.base),patch.object(C.os,'geteuid',return_value=0),patch.object(E,'lock_existing',side_effect=lambda:os.open(self.base,os.O_RDONLY|os.O_DIRECTORY)),patch.object(C,'scope',return_value=('preserved-source',None,False)),patch.object(C,'fence'),patch.object(C,'check_references'),patch.object(C,'row_inventory',return_value=self.inventory),patch.object(C.subprocess,'run'),patch.object(W,'delete_tree',side_effect=ValueError('\U0001f600'*100000)),self.assertRaises(ValueError):
   C.remote_operation('retire',frame)
  receipt=self.base/'cleanup-evidence/bounded-retention-fixture';failure=receipt/'failure.json'
  self.assertTrue((receipt/'intent.json').exists());self.assertFalse((receipt/'completed.json').exists());self.assertTrue(self.root.exists())
  self.assertLessEqual(failure.stat().st_size,C.RETIREMENT_FAILURE_BYTES)
  self.assertEqual(set(json.loads(failure.read_bytes())),{'error','manualReconciliationRequired'})


class RetirementDiagnosticsTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name);self.attempt=self.base/'attempt'
  self.frame=dict(operationId='exact-operation',row=dict(path='/approved/source'),custody=dict(planSha256='a'*64))
  self.response=dict(ok=True,path='/approved/source',receipt=str(C.BASE/'cleanup-evidence/bounded-retention-exact-operation'))
 def invoke(self,script,*,timeout=5,payload=b'approved request'):
  with patch.object(C,'SSH',[sys.executable,'-c',script]),patch.object(C,'launcher',return_value=payload):
   return C.retirement_request(self.frame,self.attempt,timeout=timeout)
 def outcome(self):
  value=json.loads((self.attempt/'outcome.json').read_bytes())
  self.assertEqual(value['request']['sha256'],C.digest(self.attempt/'request.json'))
  for stream in value['streams'].values():
   self.assertEqual(stream['sha256'],C.digest(stream['path']));self.assertEqual(stream['bytes'],Path(stream['path']).stat().st_size)
  return value
 def test_success_streams_concurrently_and_binds_sources_request_and_hashes(self):
  response=dict(self.response,extra='x'*131072);payload=b'p'*1024**2
  script="import os,sys,json;os.write(2,b'warning'*18000);data=sys.stdin.buffer.read();assert len(data)==1048576;print(json.dumps(dict("+repr(self.response)+",extra='x'*131072)))"
  self.assertEqual(self.invoke(script,payload=payload),response)
  result=self.outcome();self.assertTrue(result['commandSucceeded']);self.assertFalse(result['manualReconciliationRequired']);self.assertEqual(result['requestBytesWritten'],len(payload))
  request=json.loads((self.attempt/'request.json').read_bytes());self.assertEqual(request['implementationSources'],C.launcher_source_pins());self.assertEqual(request['launcherSha256'],hashlib.sha256(payload).hexdigest());self.assertEqual(request['frameSha256'],E.digest(C.encoded(self.frame)))
 def test_nonzero_exit_keeps_both_logs_and_refuses_implicit_retry(self):
  with self.assertRaisesRegex(ValueError,'outcome.json'):self.invoke("import os,sys;sys.stdin.buffer.read();os.write(1,b'partial');os.write(2,b'exact refusal');sys.exit(7)")
  result=self.outcome();self.assertEqual(result['exitCode'],7);self.assertTrue(result['manualReconciliationRequired'])
  self.assertEqual((self.attempt/'stdout.log').read_bytes(),b'partial');self.assertEqual((self.attempt/'stderr.log').read_bytes(),b'exact refusal')
  before={p.name:p.read_bytes() for p in self.attempt.iterdir()}
  with patch.object(C.subprocess,'Popen') as launch,self.assertRaisesRegex(ValueError,'never retry blindly'):self.invoke('raise Exception()')
  launch.assert_not_called();self.assertEqual(before,{p.name:p.read_bytes() for p in self.attempt.iterdir()})
 def test_timeout_durably_keeps_partial_diagnostics_and_unknown_remote_outcome(self):
  with self.assertRaises(ValueError):self.invoke("import os,sys,time;sys.stdin.buffer.read();os.write(2,b'before timeout');time.sleep(10)",timeout=0.2)
  result=self.outcome();self.assertTrue(result['timedOut']);self.assertTrue(result['manualReconciliationRequired']);self.assertFalse(result['commandSucceeded']);self.assertEqual((self.attempt/'stderr.log').read_bytes(),b'before timeout')
 def test_bounded_output_preserves_prefix_and_overflow_diagnostic(self):
  with patch.object(C,'RETIREMENT_STDERR_BYTES',1024),self.assertRaises(ValueError):self.invoke("import os,sys;sys.stdin.buffer.read();os.write(2,b'x'*4096)")
  result=self.outcome();self.assertEqual(result['streams']['stderr']['bytes'],1024);self.assertTrue(result['streams']['stderr']['truncated']);self.assertGreater(result['streams']['stderr']['observedBytes'],1024);self.assertIn('diagnostic limit',result['failure'])
 def test_malformed_response_is_recorded_before_raising(self):
  with self.assertRaises(ValueError):self.invoke("import sys;sys.stdin.buffer.read();print('not json')")
  result=self.outcome();self.assertEqual(result['exitCode'],0);self.assertFalse(result['responseValidated']);self.assertTrue(result['manualReconciliationRequired'])
 def test_wrong_source_response_refuses(self):
  response=dict(self.response,path='/different/source')
  with self.assertRaises(ValueError):self.invoke("import sys;sys.stdin.buffer.read();print("+repr(json.dumps(response))+")")
  self.assertFalse(self.outcome()['commandSucceeded'])
 def test_spawn_failure_is_recorded_without_remote_invocation(self):
  with patch.object(C.subprocess,'Popen',side_effect=FileNotFoundError('missing ssh')),self.assertRaises(ValueError):self.invoke('')
  result=self.outcome();self.assertFalse(result['started']);self.assertIsNone(result['exitCode']);self.assertFalse(result['manualReconciliationRequired'])
 def test_launcher_source_drift_refuses_before_launch(self):
  pins=C.launcher_source_pins();pins[0]['sha256']='0'*64
  with self.assertRaisesRegex(ValueError,'source changed'):C.launcher('retire',self.frame,expected_sources=pins)
 def test_reviewed_source_pins_must_match_each_dispatch(self):
  pins=C.launcher_source_pins();pins[0]['sha256']='0'*64
  with patch.object(C.subprocess,'Popen') as launch,self.assertRaisesRegex(ValueError,'reviewed source pins'):
   C.retirement_request(self.frame,self.attempt,expected_sources=pins)
  launch.assert_not_called();self.assertFalse(self.attempt.exists())
 def test_first_failed_invocation_stops_the_sequence(self):
  custody=self.base/'custody';custody.mkdir();rows=[dict(path='/source/'+str(n),eligible=True) for n in range(3)]
  plan=self.base/'plan.json';plan.write_bytes(C.encoded(dict(candidates=rows)))
  for row in rows:(custody/(hashlib.sha256(row['path'].encode()).hexdigest()[:16]+'.json')).write_bytes(C.encoded(dict(restoration=dict(restoredPath='/restored'))))
  check=types.SimpleNamespace(check_returncode=lambda:None)
  with patch.object(C,'verify_custody',return_value=Path('/archive')),patch.object(C,'restored_check',return_value=check),patch.object(C,'retirement_request',side_effect=ValueError('refusal')) as invoke,self.assertRaises(ValueError):
   C.retire(plan,custody,self.base/'result.json')
  self.assertEqual(invoke.call_count,1);self.assertEqual(invoke.call_args.args[0]['row']['path'],'/source/0');self.assertFalse((self.base/'result.json').exists())


class CompletionConfigTransitionTests(unittest.TestCase):
 def setUp(self):
  self.records={};self.transitions=[];self.serial=10
  self.identity={k:1 for k in E.STAT_FIELDS};self.identity.update(st_mode=stat.S_IFREG|0o600,st_uid=0,st_gid=0,st_nlink=1)
  self.evidence=C.BASE/'cleanup-evidence';self.config={'schema':'pow-ui-retention-lifecycle-config-v1','scopeApprovalSha256':C.REPAIR_APPROVAL_SHA,'statePath':str(C.LIFECYCLE_STATE),'generation':0}
  self.current=self.hold(self.config);self.other=dict(path='/etc/proofofwork-retention/held.json',sha256='a'*64,identity=dict(self.identity),xattrs={})
  self.plan=dict(holds=[copy.deepcopy(self.current),copy.deepcopy(self.other)],timers={'exact':'timers'},candidates=[],lifecycle=dict(index={'path':str(self.evidence/'index.json'),'sha256':'b'*64}))
  self.plan_binding=self.put(self.evidence/'cycle-custody-plan.json',self.plan);self.plan_sha=self.plan_binding['sha256']
  self.result=dict(ok=True,planSha256=self.plan_sha,completed=[]);self.result_binding=self.put(self.evidence/'cycle-custody-result.json',self.result);self.result_sha=self.result_binding['sha256']
  phase=dict(operation='complete-cycle',configSha256=E.digest(C.encoded(self.config)));self.phase=self.put(self.evidence/'cycle-intent.json',phase)
  self.state=dict(schema='pow-ui-retention-lifecycle-state-v1',configSha256=phase['configSha256'],revision=12,status='complete',pending=None,activePhase=None,
   index=self.plan['lifecycle']['index'],completedContext={'pair':'same','guards':'exact'},lastIntent=self.phase,
   lastCompleted=dict(cycleId='cycle1',custodyPlan=self.plan_binding,custodyResult=self.result_binding))
  self.phase_receipt=self.put(self.evidence/'cycle-completed.json',dict(ok=True,retentionComplete=True,intent=self.phase,stateSha256=E.digest(C.encoded(self.state)),stateRevision=12,index=self.state['index'],cycleId='cycle1'))
  self.add_upgrade()
  self.addCleanup(patch.stopall)
  patch.object(C,'record',side_effect=self.read).start();patch.object(E,'hold_snapshot',side_effect=lambda:copy.deepcopy([self.current,self.other])).start()
  patch.object(E,'timer_snapshot',return_value=self.plan['timers']).start();patch.object(E,'xattrs',return_value={}).start()
  patch.object(C,'protected_fence').start();patch.object(C,'discover',return_value=[]).start()
 def put(self,path,value):
  raw=C.encoded(value);self.records[str(path)]=raw;return dict(path=str(path),sha256=E.digest(raw))
 def read(self,path,maximum=8*1024**2):
  raw=self.records[str(path)];self.assertLessEqual(len(raw),maximum)
  ident=self.current['identity'] if str(path)==str(C.LIFECYCLE_CONFIG) else self.identity
  return raw,dict(path=str(path),sha256=E.digest(raw),identity=copy.deepcopy(ident))
 def hold(self,config):
  self.serial+=1;ident=dict(self.identity,st_ino=self.serial,st_mtime_ns=self.serial,st_ctime_ns=self.serial,st_size=len(C.encoded(config)))
  return dict(path=str(C.LIFECYCLE_CONFIG),sha256=E.digest(C.encoded(config)),identity=ident,xattrs={})
 def add_upgrade(self):
  old=copy.deepcopy(self.state);old_config=copy.deepcopy(self.config);number=len(self.transitions)+1
  manifest={'generation':number};package=E.digest(C.encoded(manifest));journal=self.evidence/('ui-lifecycle-upgrade-'+package)
  self.config=dict(old_config,generation=number,package=dict(path=str(self.evidence/('ui-lifecycle-tools-'+package)),sha256=package));config_sha=E.digest(C.encoded(self.config))
  prior_config=self.put(journal/'prior-config.json',old_config);prior_state=self.put(journal/'prior-state.json',old)
  review=dict(state=old,stateSha256=prior_state['sha256'],context=old['completedContext'],lastCompleted=old['lastCompleted'],fullCompletionVerified=True,completionIntent=self.phase,completionReceipt=self.phase_receipt)
  plan=dict(schema='pow-ui-retention-upgrade-plan-v1',scopeApprovalSha256=C.REPAIR_APPROVAL_SHA,request=dict(mode='completed-cycle',configSha256=prior_config['sha256'],stateSha256=prior_state['sha256']),
   payload=dict(config=self.config,configSha256=config_sha,manifest=manifest),before=dict(completedReview=review,configBase64=C.base64.b64encode(C.encoded(old_config)).decode(),stateBase64=C.base64.b64encode(C.encoded(old)).decode()))
  upgrade=dict(intentPath=str(journal/'intent.json'),completionPath=str(journal/'completed.json'),priorConfigSha256=prior_config['sha256'],priorStateSha256=prior_state['sha256'],supersededCycleId=None,preservedCompletedCycleId='cycle1')
  if number>1:upgrade['statusVerificationPath']=str(journal/'verified.json')
  template=dict(old,configSha256=config_sha,revision=old['revision']+2,lastUpgrade=upgrade)
  intent=self.put(journal/'intent.json',dict(schema='pow-ui-retention-upgrade-intent-v1',plan=plan,stateTemplate=template,stateTemplateSha256=E.digest(C.encoded(template)),disposition='completed-cycle-preserved',freshPreparationRequired=False))
  self.state=dict(template,lastUpgrade=dict(upgrade,intentSha256=intent['sha256']))
  proof=dict(context=old['completedContext'],index=old['index'],lastCompleted=old['lastCompleted'],custodyLifecycle=self.plan['lifecycle'],fullCompletionVerified=True)
  if number>1:proof['verifiedConfigTransitions']=copy.deepcopy(self.transitions)
  receipt=dict(schema='pow-ui-retention-upgrade-completed-v1',ok=True,intent=intent,config=dict(path=str(C.LIFECYCLE_CONFIG),sha256=config_sha),state=dict(path=str(C.LIFECYCLE_STATE),sha256=E.digest(C.encoded(self.state))),stateRevision=self.state['revision'],
   priorConfig=prior_config,priorState=prior_state,supersededCycleId=None,preservedCompletedCycleId='cycle1',index=old['index'],freshPreparationRequired=False,retentionComplete=True,publicationHealthy=True,priorPackageAndPhaseEvidencePreserved=True,priorHelpersHoldsAndTimersPreserved=True,completionVerification=proof)
  completed=self.put(journal/'completed.json',receipt);self.transitions.append(dict(intent=intent,completed=completed));self.current=self.hold(self.config);self.put(C.LIFECYCLE_CONFIG,self.config)
 def verify(self,transitions=None):
  return C.verify_final_result(self.plan,self.plan_sha,self.result,self.result_sha,config_transitions=self.transitions if transitions is None else transitions)
 def change_record(self,binding,change):
  value=json.loads(self.records[binding['path']]);change(value);updated=self.put(binding['path'],value);binding['sha256']=updated['sha256']
 def test_single_sealed_upgrade_accepts_without_rewriting_plan(self):
  original=C.encoded(self.plan);result=self.verify();self.assertTrue(result['ok']);self.assertFalse(result['holdsAndTimersUnchanged']);self.assertTrue(result['holdsAndTimersVerified']);self.assertEqual(original,C.encoded(self.plan))
 def test_access_time_repair_remains_bound_in_normal_post_upgrade_status(self):
  link=self.transitions[0];intent=json.loads(self.records[link['intent']['path']]);request=intent['plan']['request'];review=intent['plan']['before']['completedReview']
  before=copy.deepcopy(self.plan['holds'][0]);current=copy.deepcopy(before);current['identity']['st_atime_ns']+=1
  access=dict(schema='pow-ui-completed-config-access-time-v1',configSha256=request['configSha256'],stateSha256=request['stateSha256'],cycleId='cycle1',planSha256=self.plan_sha,resultSha256=self.result_sha,before=before,current=current)
  raw=C.encoded(dict(accessTimeReconciliation=access));request.update(mode='completed-config-repair',guardRefusal=dict(base64=C.base64.b64encode(raw).decode(),binding=dict(path='/reviewed/refusal.json',sha256=E.digest(raw))))
  review['accessTimeReconciliation']=access
  link['intent']=self.put(link['intent']['path'],intent);self.state['lastUpgrade']['intentSha256']=link['intent']['sha256']
  completed=json.loads(self.records[link['completed']['path']]);completed['intent']=link['intent'];completed['state']['sha256']=E.digest(C.encoded(self.state));completed['completionVerification']['verifiedAccessTimeReconciliation']=access
  link['completed']=self.put(link['completed']['path'],completed)
  self.assertTrue(self.verify()['ok'])
  original=copy.deepcopy(link['completed']);saved=self.records[original['path']]
  for mutation in (lambda p:p.pop('verifiedAccessTimeReconciliation'),lambda p:p['verifiedAccessTimeReconciliation'].update(stateSha256='f'*64)):
   value=json.loads(saved);mutation(value['completionVerification']);link['completed']=self.put(original['path'],value)
   with self.assertRaisesRegex(ValueError,'access-time'):self.verify()
   link['completed']=copy.deepcopy(original);self.records[original['path']]=saved
 def test_multiple_complete_preserving_upgrades_join(self):
  self.add_upgrade();self.assertTrue(self.verify()['ok'])
 def test_wrong_status_seal_path_refuses(self):
  self.add_upgrade();binding=self.transitions[-1]['intent']
  self.change_record(binding,lambda r:r['stateTemplate']['lastUpgrade'].update(statusVerificationPath='/unrelated/verified.json'))
  with self.assertRaisesRegex(ValueError,'completed state'):self.verify()
 def test_strict_writer_fence_still_refuses_same_config_change(self):
  with self.assertRaisesRegex(ValueError,'holds/timers'):C.fence(self.plan,full=True)
  with self.assertRaises(TypeError):C.fence(self.plan,config_transitions=self.transitions)
 def test_default_completion_still_refuses_config_change(self):
  with self.assertRaisesRegex(ValueError,'holds/timers'):self.verify([])
 def test_missing_reordered_duplicate_and_overlong_chains_refuse(self):
  self.add_upgrade()
  for chain in (self.transitions[1:],list(reversed(self.transitions)),[self.transitions[0]]*2,[self.transitions[0]]*17):
   with self.subTest(chain=len(chain)),self.assertRaises(ValueError):self.verify(chain)
 def test_unsealed_upgrade_refuses(self):
  del self.records[self.transitions[0]['completed']['path']]
  with self.assertRaises(KeyError):self.verify()
 def test_wrong_upgrade_binding_hash_refuses(self):
  self.transitions[0]['intent']['sha256']='0'*64
  with self.assertRaisesRegex(ValueError,'hash/bound'):self.verify()
 def test_unrelated_config_bytes_refuse(self):
  self.config['unapproved']=True;self.current=self.hold(self.config);self.put(C.LIFECYCLE_CONFIG,self.config)
  with self.assertRaisesRegex(ValueError,'endpoint'):self.verify()
 def test_unrelated_hold_and_timer_changes_refuse(self):
  self.other['identity']['st_ino']+=1
  with self.assertRaisesRegex(ValueError,'non-config'):self.verify()
  self.other['identity']['st_ino']-=1
  with patch.object(E,'timer_snapshot',return_value={'changed':True}),self.assertRaisesRegex(ValueError,'holds/timers'):self.verify()
 def test_config_duplicate_missing_xattrs_permissions_and_device_refuse(self):
  for modify in (lambda r:r['identity'].update(st_mode=stat.S_IFREG|0o644),lambda r:r['identity'].update(st_uid=1),lambda r:r['identity'].update(st_nlink=2),lambda r:r['identity'].update(st_dev=99),lambda r:r.update(xattrs={'user.x':'changed'})):
   prior=copy.deepcopy(self.current);modify(self.current)
   with self.subTest(row=self.current),self.assertRaises(ValueError):self.verify()
   self.current=prior
  for holds in ([self.other],[self.current,self.current,self.other]):
   with patch.object(E,'hold_snapshot',return_value=holds),self.assertRaisesRegex(ValueError,'missing or duplicated'):self.verify()
 def test_completed_cycle_index_context_and_flags_cannot_be_substituted(self):
  binding=self.transitions[0]['completed'];original=copy.deepcopy(binding);raw=self.records[binding['path']]
  for change in (lambda r:r.update(retentionComplete=False),lambda r:r.update(preservedCompletedCycleId='different'),lambda r:r['completionVerification'].update(index={'other':True}),lambda r:r['completionVerification'].update(context={'changed':True}),lambda r:r['completionVerification']['lastCompleted']['custodyResult'].update(sha256='e'*64)):
   self.change_record(binding,change)
   with self.assertRaises(ValueError):self.verify()
   binding.update(original);self.records[binding['path']]=raw
 def test_proposed_uninstalled_config_is_not_accepted(self):
  old_current=copy.deepcopy(self.current);old_raw=self.records[str(C.LIFECYCLE_CONFIG)];self.add_upgrade();self.current=old_current;self.records[str(C.LIFECYCLE_CONFIG)]=old_raw
  with self.assertRaisesRegex(ValueError,'endpoint'):self.verify()
 def test_original_terminal_phase_is_required(self):
  value=json.loads(self.records[self.phase_receipt['path']]);value['retentionComplete']=False;self.records[self.phase_receipt['path']]=C.encoded(value)
  with self.assertRaisesRegex(ValueError,'hash/bound'):self.verify()
 def test_hold_replacement_between_entry_and_exit_refuses(self):
  first=copy.deepcopy([self.current,self.other]);second=copy.deepcopy(first);second[0]['identity']['st_ino']+=1
  calls=0
  def holds():
   nonlocal calls
   calls+=1
   if calls>1:self.current=second[0]
   return first if calls==1 else second
  with patch.object(E,'hold_snapshot',side_effect=holds),self.assertRaisesRegex(ValueError,'during verification'):self.verify()
 def test_invalid_transition_argument_refuses(self):
  with self.assertRaisesRegex(ValueError,'argument'):self.verify({'from':'old','to':'new'})



class CompletionConfigAccessTimeTests(unittest.TestCase):
 def setUp(self):
  ident={k:1 for k in E.STAT_FIELDS};ident.update(st_mode=stat.S_IFREG|0o600,st_uid=0,st_gid=0,st_nlink=1,st_atime_ns=100)
  self.before=dict(path=str(C.LIFECYCLE_CONFIG),sha256='a'*64,identity=ident,xattrs=[])
  self.current=copy.deepcopy(self.before);self.current['identity']['st_atime_ns']=200
  self.other=dict(path='/etc/proofofwork-retention/other.json',sha256='b'*64,identity=dict(ident),xattrs=[])
  self.plan=dict(holds=[self.before,self.other],timers={'exact':'timers'},candidates=[],lifecycle={'exact':'authority'})
  self.plan_sha=E.digest(C.encoded(self.plan));self.result=dict(ok=True,planSha256=self.plan_sha,completed=[]);self.result_sha=E.digest(C.encoded(self.result))
  self.proof=dict(schema='pow-ui-completed-config-access-time-v1',configSha256='a'*64,stateSha256='c'*64,cycleId='completed-cycle',planSha256=self.plan_sha,resultSha256=self.result_sha,before=copy.deepcopy(self.before),current=copy.deepcopy(self.current))
  self.addCleanup(patch.stopall)
  patch.object(E,'hold_snapshot',side_effect=lambda:copy.deepcopy([self.current,self.other])).start()
  patch.object(E,'timer_snapshot',return_value=self.plan['timers']).start()
  patch.object(C,'protected_fence').start();patch.object(C,'discover',return_value=[]).start()
 def verify(self,proof=None):
  return C.verify_final_result(self.plan,self.plan_sha,self.result,self.result_sha,config_access_time_reconciliation=self.proof if proof is None else proof)
 def test_exact_observed_atime_passes_without_rewriting_any_evidence(self):
  before=C.encoded(dict(plan=self.plan,result=self.result,proof=self.proof));out=self.verify()
  self.assertTrue(out['ok']);self.assertFalse(out['holdsAndTimersUnchanged']);self.assertTrue(out['holdsAndTimersVerified'])
  self.assertEqual(out['verifiedAccessTimeReconciliation'],self.proof)
  self.assertEqual(before,C.encoded(dict(plan=self.plan,result=self.result,proof=self.proof)))
 def test_default_completion_and_writer_remain_strict(self):
  with self.assertRaisesRegex(ValueError,'holds/timers'):C.verify_final_result(self.plan,self.plan_sha,self.result,self.result_sha)
  with self.assertRaisesRegex(ValueError,'holds/timers'):C.fence(self.plan,full=True)
  with self.assertRaises(TypeError):C.fence(self.plan,access_time_reconciliation=self.proof)
 def test_every_non_atime_identity_field_remains_exact(self):
  for key in E.STAT_FIELDS:
   if key=='st_atime_ns':continue
   proof=copy.deepcopy(self.proof);proof['current']['identity'][key]+=1
   with self.subTest(field=key),self.assertRaises(ValueError):self.verify(proof)
 def test_hash_path_xattrs_and_other_holds_cannot_change(self):
  for key,value in [('sha256','d'*64),('path','/etc/other.json'),('xattrs',[['user.changed','00']])]:
   proof=copy.deepcopy(self.proof);proof['current'][key]=value
   with self.subTest(field=key),self.assertRaises(ValueError):self.verify(proof)
  self.other['identity']['st_ino']+=1
  # The original plan remains independent of the live snapshot.
  self.plan['holds'][1]=dict(self.other,identity=dict(self.other['identity'],st_ino=self.other['identity']['st_ino']-1))
  with self.assertRaisesRegex(ValueError,'another hold'):self.verify()
 def test_only_exact_forward_integer_access_time_is_accepted(self):
  for value in (99,100,201,200.0,True,'200'):
   proof=copy.deepcopy(self.proof);proof['current']['identity']['st_atime_ns']=value
   with self.subTest(value=value),self.assertRaises((ValueError,TypeError)):self.verify(proof)
 def test_plan_result_config_and_original_hold_bindings_remain_exact(self):
  for key in ('planSha256','resultSha256','configSha256'):
   proof=copy.deepcopy(self.proof);proof[key]='f'*64
   with self.subTest(field=key),self.assertRaises(ValueError):self.verify(proof)
  proof=copy.deepcopy(self.proof);proof['before']['identity']['st_atime_ns']=99
  with self.assertRaisesRegex(ValueError,'Original config hold'):self.verify(proof)
 def test_timer_drift_and_combined_transition_proofs_refuse(self):
  with patch.object(E,'timer_snapshot',return_value={'changed':True}),self.assertRaisesRegex(ValueError,'timers'):self.verify()
  with self.assertRaisesRegex(ValueError,'combine config transitions'):
   C.verify_final_result(self.plan,self.plan_sha,self.result,self.result_sha,config_transitions=[{}],config_access_time_reconciliation=self.proof)
 def test_further_access_time_change_between_fences_refuses(self):
  first=copy.deepcopy([self.current,self.other]);second=copy.deepcopy(first);second[0]['identity']['st_atime_ns']+=1
  with patch.object(E,'hold_snapshot',side_effect=[first,second]),self.assertRaisesRegex(ValueError,'Observed config access time'):self.verify()
 def test_missing_duplicated_or_extra_hold_rows_refuse(self):
  for holds in ([self.other],[self.current,self.current,self.other],[self.current,self.other,dict(self.other,path='/extra')]):
   with patch.object(E,'hold_snapshot',return_value=holds),self.assertRaises(ValueError):self.verify()

suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in (FileGroupTests,ArtifactQualificationTests,ClosedOrdinaryAliasTests,OffhostCapacityTests,BatchPreservationTests,RetirementBudgetTests,RetirementDiagnosticsTests,CompletionConfigTransitionTests,CompletionConfigAccessTimeTests))
result=unittest.TextTestRunner(verbosity=1).run(suite)
if not result.wasSuccessful():raise SystemExit(1)
