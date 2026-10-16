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
import copy, hashlib, stat, tarfile
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
 def test_distinct_custody_and_restore_devices_each_require_reserve(self):
  model=C.custody_allocation([])
  def state(p):return dict(device=1 if p=='/custody' else 2,availableBytes=C.OFFHOST_RESERVE_BYTES-1 if p=='/restore' else C.OFFHOST_RESERVE_BYTES,availableInodes=C.OFFHOST_RESERVE_INODES)
  with self.assertRaisesRegex(ValueError,'capacity refused'):C.check_custody_capacity([],'/custody','/restore',observe=state)


suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in (FileGroupTests,ArtifactQualificationTests,ClosedOrdinaryAliasTests,OffhostCapacityTests))
result=unittest.TextTestRunner(verbosity=1).run(suite)
if not result.wasSuccessful():raise SystemExit(1)
