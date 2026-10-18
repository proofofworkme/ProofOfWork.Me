#!/usr/bin/python3
"""Actual temporary-filesystem fixtures: corruption, holds, pointers and partial work."""
import hashlib
import fcntl
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

def load(name,filename):
    loader=importlib.machinery.SourceFileLoader(name,str(Path(__file__).with_name(filename)));spec=importlib.util.spec_from_loader(name,loader);m=importlib.util.module_from_spec(spec);loader.exec_module(m);return m
S=load('audit30_storage_test','ui-storage.py');P=load('audit30_policy_test','ui-release-policy.py')

class SnapshotGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.root=self.base/'root';self.root.mkdir(mode=0o700)
        self.file=self.root/'file';self.file.write_bytes(b'exact bytes');self.file.chmod(0o600)
    def tearDown(self):self.tmp.cleanup()
    def test_unchanged_complete_guard_reuses_hashes_and_preserves_xattrs_and_links(self):
        os.setxattr(self.file,'user.guard',b'\0\xff');(self.root/'link').symlink_to('file')
        full=S.snapshot(self.root,links=True)
        with patch.object(S,'hash_read',side_effect=AssertionError('Unchanged bytes were reread')):
            self.assertEqual(S.guard_snapshot(self.root,full,links=True),full)
    def test_same_size_write_restored_mtime_and_inode_replacement_refuse(self):
        full=S.snapshot(self.root);before=self.file.stat();self.file.write_bytes(b'other bytes');os.utime(self.file,ns=(before.st_atime_ns,before.st_mtime_ns))
        with self.assertRaises(ValueError):S.guard_snapshot(self.root,full)
        full=S.snapshot(self.root);replacement=self.base/'replacement';replacement.write_bytes(self.file.read_bytes());replacement.chmod(0o600);os.utime(replacement,ns=(self.file.stat().st_atime_ns,self.file.stat().st_mtime_ns));replacement.replace(self.file)
        with self.assertRaises(ValueError):S.guard_snapshot(self.root,full)
    def test_complete_entry_set_modes_and_xattrs_are_guarded(self):
        changes=[lambda:(self.root/'added').write_text('new'),lambda:self.file.unlink(),
                 lambda:self.file.chmod(0o400),lambda:os.setxattr(self.file,'user.guard',b'changed')]
        for change in changes:
            with self.subTest(change=change):
                for p in self.root.iterdir():p.unlink()
                self.file.write_bytes(b'exact bytes');self.file.chmod(0o600);full=S.snapshot(self.root);change()
                with self.assertRaises(ValueError):S.guard_snapshot(self.root,full)
    def test_symlink_target_and_forged_baseline_refuse(self):
        link=self.root/'link';link.symlink_to('file');full=S.snapshot(self.root,links=True);link.unlink();link.symlink_to('../outside')
        with self.assertRaises(ValueError):S.guard_snapshot(self.root,full,links=True)
        bad=dict(full,sha256='0'*64)
        with self.assertRaisesRegex(ValueError,'baseline'):S.guard_snapshot(self.root,bad,links=True)
    def test_mutation_between_walk_and_final_fence_refuses(self):
        full=S.snapshot(self.root);identity=S.identity;root_inode=self.root.stat().st_ino;changed=False
        def mutate_at_fence(info):
            nonlocal changed
            result=identity(info)
            if info.st_ino==root_inode and not changed:
                changed=True;before=self.file.stat();self.file.write_bytes(b'other bytes');os.utime(self.file,ns=(before.st_atime_ns,before.st_mtime_ns))
            return result
        with patch.object(S,'identity',side_effect=mutate_at_fence):
            with self.assertRaisesRegex(ValueError,'fence changed'):S.guard_snapshot(self.root,full)
    def test_new_entry_after_directory_enumeration_refuses(self):
        full=S.snapshot(self.root);attributes=S.attributes;changed=False
        def add_during_walk(path):
            nonlocal changed
            result=attributes(path)
            if Path(path)==self.file and not changed:changed=True;(self.root/'added').write_text('racing entry')
            return result
        with patch.object(S,'attributes',side_effect=add_during_walk):
            with self.assertRaises(ValueError):S.guard_snapshot(self.root,full)
    def test_new_owned_unlink_rehashes_shared_file_and_credit_is_not_reused(self):
        alias=self.base/'alias';os.link(self.file,alias);full=S.snapshot(self.root);info=self.file.stat();removed={(info.st_dev,info.st_ino):1};alias.unlink()
        with patch.object(S,'hash_read',wraps=S.hash_read) as reads:
            observed=S.guard_snapshot(self.root,full,removed);self.assertEqual([Path(c.args[0]) for c in reads.call_args_list],[self.file])
        with patch.object(S,'hash_read',side_effect=AssertionError('Old unlink was rehashed')):
            self.assertEqual(S.guard_snapshot(self.root,observed,removed,removed),observed)
        before=self.file.stat();self.file.write_bytes(b'exact bytes');os.utime(self.file,ns=(before.st_atime_ns,before.st_mtime_ns))
        with self.assertRaisesRegex(ValueError,'ctime'):S.guard_snapshot(self.root,observed,removed,removed)
        with self.assertRaisesRegex(ValueError,'regressed'):S.guard_snapshot(self.root,observed,{},removed)
    def test_owned_unlink_does_not_hide_concurrent_byte_mutation(self):
        alias=self.base/'alias';os.link(self.file,alias);full=S.snapshot(self.root);before=self.file.stat();alias.unlink();self.file.write_bytes(b'other bytes');os.utime(self.file,ns=(before.st_atime_ns,before.st_mtime_ns))
        with self.assertRaisesRegex(ValueError,'bytes, metadata'):S.guard_snapshot(self.root,full,{(before.st_dev,before.st_ino):1})
    def test_unowned_link_change_refuses(self):
        full=S.snapshot(self.root);os.link(self.file,self.base/'alias')
        with self.assertRaisesRegex(ValueError,'hardlink'):S.guard_snapshot(self.root,full)

class StorageTests(unittest.TestCase):
    def setUp(self):
        self.old_umask=os.umask(0o077)
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.l=S.Layout(self.base)
        for p in [self.l.live,self.l.roots,self.l.archives,self.l.scratch,self.l.evidence,self.l.target.parent,self.l.lock.parent,self.l.units,self.l.held.parent,self.l.capacity.parent]:p.mkdir(parents=True,exist_ok=True)
        self.l.lock.write_text('');self.l.capacity.write_text('# safe capacity fixture\n');self.l.hold.write_text('generic hold remains\n')
        configs={}
        for name in ('/etc/logrotate.d/rsyslog','/etc/logrotate.d/ufw'):
            path=self.base/name.lstrip('/');path.parent.mkdir(parents=True,exist_ok=True);path.write_text('hourly\nrotate 48\ncompress\ndelaycompress\n');configs[name]=S.hash_read(path)[0]
        self.rotation_patch=patch.object(S,'ROTATION_CONFIG_PINS',configs);self.rotation_patch.start();self.addCleanup(self.rotation_patch.stop)
        rows=[dict(role='ui',path=p,decision='retain',retentionClass='managed-ui-recovery-container',releaseGate='exact proof and explicit scoped approval') for p in ['/var/backups/proofofwork-ui/releases','/var/backups/proofofwork-ui/rollback-roots']]
        self.review=dict(retain=rows);self.write_review()
        for n in ('proofofwork-ui-release-prune.timer','proofofwork-ui-storage-prune.timer'):(self.l.units/n).symlink_to('/dev/null')
        self.old_held,self.old_hold=S.HELD_SHA,S.HOLD_SHA;S.HOLD_SHA=hashlib.sha256(self.l.hold.read_bytes()).hexdigest();self.update_held()
        self.current='26500e4d2ff7-20261002T054938Z';self.previous='835e30258d23-20261002T052338Z'
        self.release(self.l.live,self.current);self.release(self.l.roots/('proofofwork-www-pre-'+self.current),self.previous)
        for rid,contained in zip(S.ROOT_IDS,S.ARCHIVE_IDS):self.release(self.l.roots/('proofofwork-www-pre-'+rid),contained)
        for rid in [self.current,self.previous,*S.SOURCE_IDS]:
            p=self.l.scratch/('proofofwork-ui-source-'+rid);p.mkdir();(p/'.git').mkdir();(p/'.git'/'config').write_text('preserve this unique metadata\n');(p/'tracked.txt').write_text('source\n');(p/'node_modules').mkdir();(p/'node_modules'/'ignored.bin').write_bytes(b'preserve dependencies\x00')
        self.dependency_provenance(self.l.live,self.current);self.dependency_provenance(self.l.roots/('proofofwork-www-pre-'+self.current),self.previous)
        self.l.refs=[]
        def source(path):
            rid=path.name.removeprefix('proofofwork-ui-source-');return dict(head=rid.split('-')[0]+'0'*28,tree='1'*40,statusSha256='x',ignoredNodeModulesLines=1)
        self.source_patch=patch.object(S,'source_pointers',side_effect=source);self.source_patch.start();self.capacity_patch=patch.object(S,'capacity');self.capacity_patch.start()
        self.auth='a'*64
    def tearDown(self):
        self.source_patch.stop();self.capacity_patch.stop();S.HELD_SHA=self.old_held;S.HOLD_SHA=self.old_hold;self.tmp.cleanup();os.umask(self.old_umask)
    def write_review(self):self.l.held.write_text(json.dumps(self.review,sort_keys=True))
    def update_held(self):S.HELD_SHA=hashlib.sha256(self.l.held.read_bytes()).hexdigest()
    def release(self,root,rid,surfaces=None,release_format='proofofwork-ui-release-v3'):
        surfaces=S.SURFACES if surfaces is None else sorted(surfaces)
        root.mkdir(exist_ok=True);fields=dict(format=release_format,release_id=rid,commit=rid.split('-')[0]+'0'*28,source_tree='1'*40,archive_name='proofofwork-ui-release-'+rid+'.tgz')
        for name in surfaces:
            p=root/('proofofwork-'+name);p.mkdir(mode=0o755);p.chmod(0o755);f=p/'index.html';f.write_text('surface '+name);f.chmod(0o644);h=hashlib.sha256();h.update(b'index.html\x00644\x00'+hashlib.sha256(f.read_bytes()).hexdigest().encode()+b'\n');fields['surface.'+name+'.sha256']=h.hexdigest();fields['surface.'+name+'.file_count']='1'
        archive=self.l.archives/fields['archive_name']
        # Do not overwrite a retained archive when another root contains that release.
        if not archive.exists():
            with tarfile.open(archive,'w:gz') as t:
                info=tarfile.TarInfo('surfaces');info.type=tarfile.DIRTYPE;info.mode=0o700;info.uid=os.getuid();info.gid=os.getgid();t.addfile(info)
                for name in surfaces:t.add(root/('proofofwork-'+name),arcname='surfaces/'+name)
            fields['archive_sha256']=hashlib.sha256(archive.read_bytes()).hexdigest()
            mb=''.join(k+'='+v+'\n' for k,v in fields.items()).encode();Path(str(archive)+'.sha256').write_text(fields['archive_sha256']+'  '+archive.name+'\n');Path(str(archive)+'.provenance').write_bytes(mb)
        else:
            mb=Path(str(archive)+'.provenance').read_bytes()
        (root/'.proofofwork-ui-release').write_bytes(mb)
    def plan(self):return S.create_plan(self.l,'cleanup',self.auth)
    def dependency_provenance(self,root,rid):
        dependency=S.dependency_fingerprint(S.snapshot(self.l.scratch/('proofofwork-ui-source-'+rid),links=True));fields=dict(l.split('=',1) for l in (root/'.proofofwork-ui-release').read_text().splitlines());fields.update(source_dependency_model=dependency['model'],source_dependency_entry_count=str(dependency['entryCount']),source_dependency_bytes=str(dependency['regularBytes']),source_dependency_sha256=dependency['sha256']);raw=''.join(k+'='+v+'\n' for k,v in fields.items());(root/'.proofofwork-ui-release').write_text(raw);(self.l.archives/(fields['archive_name']+'.provenance')).write_text(raw)
    def test_canonical_dependency_heredoc_parity(self):
        p=self.base/'canonical-source';n=p/'node_modules';n.mkdir(parents=True);n.chmod(0o755)
        for name in ('a','é'):(n/name).mkdir(mode=0o755);(n/name).chmod(0o755)
        for name,data,mode in [('a/binary',b'\0\xff\n',0o644),('tool',b'#!/bin/sh\n',0o755),('é/file',b'utf8-dir\n',0o644)]:
            q=n/name;q.write_bytes(data);q.chmod(mode)
        (n/'relative').symlink_to('a/binary')
        canonical=Path(__file__).resolve().parents[1]/'proofofwork-ui-release-provenance.sh'
        body=canonical.read_text().split('attest_source_dependencies() {',1)[1].split("<<'PY'\n",1)[1].split('\nPY\n',1)[0]
        out=subprocess.run(['/usr/bin/python3','-I','-B','-',str(p)],input=body,text=True,capture_output=True,check=True,timeout=30).stdout.strip().split('\t')
        actual=S.dependency_fingerprint(S.snapshot(p,links=True));self.assertEqual(out,[str(actual['entryCount']),str(actual['regularBytes']),actual['sha256']]);self.assertEqual(out[:2],['7','22'])
        if os.getuid()==1000 and os.getgid()==1000:self.assertEqual(out[2],'6f17f895f60abdcd311f44782a74945f0591ec2fab36b7db4071447ff927ca7c')
    def cleanup(self):
        plan=self.plan();out=S.execute(plan,S.digest(plan),self.l,True);return dict(path=out['receiptPath'],sha256=out['receiptSha256'])
    def reconciliation_fixture(self):
        families=['auth.log','kern.log','syslog','ufw.log'];logs=self.base/'var/log';logs.mkdir(parents=True)
        for family in families:
            for suffix in ['','.1',*['.'+str(n)+'.gz' for n in range(2,49)]]:
                (logs/(family+suffix)).write_text(family+suffix+' preserved log bytes\n');self.review['retain'].append(dict(role='ui',path='/var/log/'+family+suffix,decision='retain'))
        self.write_review();self.update_held();original=self.plan()
        old=self.l.evidence/'audit30-private-fixture';old.mkdir();controller=old/'ui-storage.py';controller.write_bytes(Path(S.__file__).read_bytes())
        planpath=self.l.evidence/'audit30-original-plan.json';S.durable(planpath,original);planhash=S.hash_read(planpath,S.MAX_JSON)[0]
        intentpath=self.l.evidence/'audit30-cleanup-original-intent.json';S.durable(intentpath,dict(schema='pow-audit30-ui-storage-intent-v1',status='approved-intent',plan=original,planSha256=planhash));intenthash=S.hash_read(intentpath,S.MAX_JSON)[0]
        completed=[]
        for row in original['delete'][:38]:
            path=Path(row['path']);shutil.rmtree(path) if row['kind']=='rollback-root' else path.unlink();completed.append(dict(path=str(path),outcome='retired',snapshotSha256=row['snapshot']['sha256'],atUtc=S.utc()))
        for family in families:
            (logs/(family+'.48.gz')).unlink()
            for n in range(47,1,-1):(logs/(family+'.'+str(n)+'.gz')).rename(logs/(family+'.'+str(n+1)+'.gz'))
            (logs/(family+'.1')).unlink();(logs/(family+'.2.gz')).write_bytes(b'new compressed previous .1 fixture')
            (logs/family).rename(logs/(family+'.1'));(logs/family).write_text('new active log\n')
        failedpath=self.l.evidence/'audit30-cleanup-original-038-failed.json';S.durable(failedpath,dict(schema='pow-audit30-ui-storage-progress-v1',status='failed',planSha256=planhash,intentPath=str(intentpath),intentSha256=intenthash,phase='immediate-before-retirement',currentPath=original['delete'][38]['path'],holdsAndMasksUnchanged=False,missingHeldPaths=original['safeguards']['missingHeldPaths'],completed=completed));failedhash=S.hash_read(failedpath,S.MAX_JSON)[0]
        evidence=self.l.evidence/'audit30-log-rotation-evidence-v1.json';S.durable(evidence,dict(verifiedConfiguredRoutineRotation=True));configs={}
        for name in ['/etc/logrotate.d/rsyslog','/etc/logrotate.d/ufw']:
            config=self.base/name.lstrip('/');config.parent.mkdir(parents=True,exist_ok=True);config.write_text('hourly\nrotate 48\ncompress\ndelaycompress\n');configs[name]=S.hash_read(config)[0]
        pins=dict(originalPlan=planhash,originalIntent=intenthash,failedReceipt=failedhash,originalController=S.hash_read(controller)[0],rotationEvidence=S.hash_read(evidence)[0]);pinpatch=patch.object(S,'RECONCILIATION_PINS',pins);pinpatch.start();self.addCleanup(pinpatch.stop);configpatch=patch.object(S,'ROTATION_CONFIG_PINS',configs);configpatch.start();self.addCleanup(configpatch.stop)
        after,_=S.safeguards(self.l);differences=[dict(guard='heldCensus',path=l['path'],expected=l,actual=r) for l,r in zip(original['safeguards']['heldCensus'],after['heldCensus']) if l!=r]
        value=dict(schema='pow-audit30-cleanup-reconciliation-review-v1',host='77.42.91.106',scopeApprovalSha256=self.auth,classification='configured-logrotate-inode-replacement',originalPlan=dict(path=str(planpath),sha256=planhash),originalIntent=dict(path=str(intentpath),sha256=intenthash),failedReceipt=dict(path=str(failedpath),sha256=failedhash),originalController=dict(path=str(controller),sha256=pins['originalController']),afterGuards=after,approvedDifference=differences,rotationEvidence=[dict(path=str(evidence),sha256=pins['rotationEvidence'])],rotationConfigFiles=[dict(path=str(self.base/p.lstrip('/')),sha256=h) for p,h in configs.items()])
        reviewpath=self.l.evidence/'audit30-cleanup-reconciliation-review-v1.json';S.durable(reviewpath,value);reviewhash=S.hash_read(reviewpath)[0];pins['reviewManifest']=reviewhash;return dict(path=str(reviewpath),sha256=reviewhash),original
    def test_explicit_rotation_reconciliation_retires_only_original_two(self):
        binding,original=self.reconciliation_fixture();plan=S.create_reconciliation_plan(self.l,self.auth,binding);S.validate_plan(plan,self.l,'cleanup',self.auth)
        self.assertEqual(plan['delete'],original['delete']);self.assertEqual(len(plan['delete']),40)
        out=S.execute(plan,S.digest(plan),self.l,True);self.assertEqual(out['completedCount'],40)
        receipt=json.loads(Path(out['receiptPath']).read_bytes());self.assertEqual(receipt['completed'][:38],json.loads(Path(json.loads(Path(binding['path']).read_bytes())['failedReceipt']['path']).read_bytes())['completed']);self.assertTrue(receipt['holdsAndMasksUnchanged']);self.assertEqual(receipt['reconciliation'],binding)
        self.assertEqual(S.cleanup_prerequisite(Path(out['receiptPath']),out['receiptSha256'],self.l,self.auth)['planSha256'],S.digest(plan));self.assertTrue(self.l.live.exists());self.assertTrue(self.l.hold.exists())
    def test_reconciliation_reappeared_prefix_and_changed_remaining_refuse(self):
        binding,original=self.reconciliation_fixture();path=Path(original['delete'][0]['path']);path.mkdir()
        with self.assertRaisesRegex(ValueError,'reappeared'):S.create_reconciliation_plan(self.l,self.auth,binding)
        path.rmdir();Path(original['delete'][39]['path']).write_text('changed remaining evidence')
        with self.assertRaises(ValueError):S.create_reconciliation_plan(self.l,self.auth,binding)
    def test_reconciliation_wrong_original_receipt_pin_refuses(self):
        binding,_=self.reconciliation_fixture();value=json.loads(Path(binding['path']).read_bytes());value['failedReceipt']['sha256']='0'*64;path=self.l.evidence/'audit30-cleanup-reconciliation-review-bad.json';S.durable(path,value)
        with self.assertRaisesRegex(ValueError,'version pin'):S.create_reconciliation_plan(self.l,self.auth,dict(path=str(path),sha256=S.hash_read(path)[0]))
    def test_reconciliation_extra_guard_or_incomplete_delta_refuses(self):
        binding,_=self.reconciliation_fixture();value=json.loads(Path(binding['path']).read_bytes());value['afterGuards']['masks'][0]['inode']+=1;path=self.l.evidence/'audit30-cleanup-reconciliation-review-extra.json';S.durable(path,value)
        h=S.hash_read(path)[0]
        with patch.dict(S.RECONCILIATION_PINS,reviewManifest=h):
            with self.assertRaisesRegex(ValueError,'expansion'):S.create_reconciliation_plan(self.l,self.auth,dict(path=str(path),sha256=h))
        value=json.loads(Path(binding['path']).read_bytes());value['approvedDifference'].pop();path=self.l.evidence/'audit30-cleanup-reconciliation-review-incomplete.json';S.durable(path,value)
        h=S.hash_read(path)[0]
        with patch.dict(S.RECONCILIATION_PINS,reviewManifest=h):
            with self.assertRaisesRegex(ValueError,'196'):S.create_reconciliation_plan(self.l,self.auth,dict(path=str(path),sha256=h))
    def test_reconciliation_alternate_active_log_baseline_manifest_refused(self):
        binding,_=self.reconciliation_fixture();value=json.loads(Path(binding['path']).read_bytes());active=self.base/'var/log/auth.log';new=active.with_name('replacement-active');new.write_text('unrelated replacement log');new.replace(active);new_inode=active.lstat().st_ino
        next(r for r in value['afterGuards']['heldCensus'] if r['path']==str(active))['inode']=new_inode
        next(r for r in value['approvedDifference'] if r['path']==str(active))['actual']['inode']=new_inode
        path=self.l.evidence/'audit30-cleanup-reconciliation-review-alternate.json';S.durable(path,value)
        with self.assertRaisesRegex(ValueError,'review version pin'):S.create_reconciliation_plan(self.l,self.auth,dict(path=str(path),sha256=S.hash_read(path)[0]))
    def test_reconciliation_rechecks_guard_config_review_and_live_refs(self):
        binding,original=self.reconciliation_fixture();plan=S.create_reconciliation_plan(self.l,self.auth,binding)
        config=self.base/'etc/logrotate.d/ufw';before=config.read_bytes();config.write_text('unreviewed changed configuration')
        with self.assertRaisesRegex(ValueError,'rotation authority'):S.execute(plan,S.digest(plan),self.l,True)
        config.write_bytes(before);configref=self.base/'runtime-reference';configref.write_text(original['delete'][38]['path']);self.l.refs=[configref]
        with self.assertRaisesRegex(ValueError,'Active/configuration'):S.execute(plan,S.digest(plan),self.l,True)
        self.assertTrue(all(os.path.lexists(r['path']) for r in original['delete'][38:]))
    def test_reconciliation_cannot_expand_plan_or_ignore_later_rotation(self):
        binding,_=self.reconciliation_fixture();plan=S.create_reconciliation_plan(self.l,self.auth,binding);plan['delete'][38]['snapshot']['entries'][0]['size']+=1
        with self.assertRaisesRegex(ValueError,'rewrote'):S.execute(plan,S.digest(plan),self.l,True)
        plan=S.create_reconciliation_plan(self.l,self.auth,binding);active=self.base/'var/log/auth.log';new=active.with_name('new-active');new.write_text('later rotation');new.replace(active)
        with self.assertRaisesRegex(ValueError,'census changed'):S.execute(plan,S.digest(plan),self.l,True)
    def test_reconciliation_wrong_review_sha_and_remaining_mode_refuse(self):
        binding,original=self.reconciliation_fixture()
        with self.assertRaises(ValueError):S.create_reconciliation_plan(self.l,self.auth,dict(binding,sha256='0'*64))
        Path(original['delete'][38]['path']).chmod(0o400)
        with self.assertRaises(ValueError):S.create_reconciliation_plan(self.l,self.auth,binding)
    def test_reconciliation_changed_protected_source_refuses(self):
        binding,_=self.reconciliation_fixture();plan=S.create_reconciliation_plan(self.l,self.auth,binding);source=Path(plan['protected']['sources'][0]['path']);(source/'tracked.txt').write_text('unreviewed source modification')
        with self.assertRaises(ValueError):S.execute(plan,S.digest(plan),self.l,True)
        self.assertTrue(all(os.path.lexists(r['path']) for r in plan['delete'][38:]))
    def test_reconciliation_changed_retained_archive_refuses(self):
        binding,_=self.reconciliation_fixture();plan=S.create_reconciliation_plan(self.l,self.auth,binding);archive=self.l.archives/plan['protected']['current']['fields']['archive_name'];archive.write_bytes(b'corrupt retained recovery archive')
        with self.assertRaises(ValueError):S.execute(plan,S.digest(plan),self.l,True)
        self.assertTrue(all(os.path.lexists(r['path']) for r in plan['delete'][38:]))
    def test_reconciliation_same_bytes_replaced_retained_archive_refuses(self):
        binding,_=self.reconciliation_fixture();plan=S.create_reconciliation_plan(self.l,self.auth,binding);archive=self.l.archives/plan['protected']['current']['fields']['archive_name'];before=archive.stat();new=archive.with_name('same-bytes-replacement');new.write_bytes(archive.read_bytes());new.chmod(before.st_mode&0o777);os.utime(new,ns=(before.st_atime_ns,before.st_mtime_ns));new.replace(archive)
        with self.assertRaisesRegex(ValueError,'inode changed'):S.execute(plan,S.digest(plan),self.l,True)
    def test_reconciliation_guard_config_drift_after_intent_has_failed_38_receipt(self):
        binding,_=self.reconciliation_fixture();plan=S.create_reconciliation_plan(self.l,self.auth,binding);durable=S.durable
        def change_after_intent(path,value):
            durable(path,value)
            if value.get('status')=='approved-intent':(self.base/'etc/logrotate.d/ufw').write_text('configuration changed after intent')
        with patch.object(S,'durable',side_effect=change_after_intent):
            with self.assertRaisesRegex(ValueError,'rotation authority'):S.execute(plan,S.digest(plan),self.l,True)
        new=[p for p in self.l.evidence.glob('*-038-failed.json') if 'original' not in p.name];self.assertEqual(len(new),1);receipt=json.loads(new[0].read_bytes());self.assertEqual(len(receipt['completed']),38);self.assertEqual(receipt['guardBaseline'],'fresh-explicitly-reconciled-plan');self.assertTrue(Path(receipt['intentPath']).exists());self.assertTrue(all(os.path.lexists(r['path']) for r in plan['delete'][38:]))
    def test_reconciliation_nonlog_and_mask_drift_refuse(self):
        binding,_=self.reconciliation_fixture();plan=S.create_reconciliation_plan(self.l,self.auth,binding);before=self.l.roots.stat().st_mode&0o777;self.l.roots.chmod(0o755 if before!=0o755 else 0o700)
        with self.assertRaises(ValueError):S.execute(plan,S.digest(plan),self.l,True)
        self.l.roots.chmod(before);mask=self.l.units/'proofofwork-ui-release-prune.timer';mask.unlink();mask.symlink_to('/tmp/unreviewed-mask')
        with self.assertRaisesRegex(ValueError,'mask changed'):S.execute(plan,S.digest(plan),self.l,True)
    def test_cleanup_prerequisite_requires_order_snapshot_and_completion_guard(self):
        done=self.cleanup();value=json.loads(Path(done['path']).read_bytes())
        for index,changed in enumerate([dict(value,completed=value['completed'][::-1]),dict(value,holdsAndMasksUnchanged=False),dict(value,completed=[dict(value['completed'][0],snapshotSha256='0'*64),*value['completed'][1:]])]):
            path=self.l.evidence/('audit30-forged-completion-'+str(index)+'.json');S.durable(path,changed)
            with self.assertRaisesRegex(ValueError,'unfenced'):S.cleanup_prerequisite(path,S.hash_read(path)[0],self.l,self.auth)
    def test_actual_sigterm_after_reconciled_39_preserves_failure_no_auto_retry(self):
        code=r'''
import importlib.machinery,importlib.util,json,os,signal,sys
from pathlib import Path
loader=importlib.machinery.SourceFileLoader('reconcile_signal_fixture',sys.argv[1]);spec=importlib.util.spec_from_loader(loader.name,loader);m=importlib.util.module_from_spec(spec);loader.exec_module(m)
t=m.StorageTests();t.setUp()
try:
 binding,original=t.reconciliation_fixture();plan=m.S.create_reconciliation_plan(t.l,t.auth,binding);durable=m.S.durable;signalled=False
 def interrupt_after_39(path,value):
  global signalled
  durable(path,value)
  if not signalled and value.get('status')=='partial' and len(value.get('completed',[]))==39:
   signalled=True;os.kill(os.getpid(),signal.SIGTERM)
 m.S.durable=interrupt_after_39
 try:m.S.execute(plan,m.S.digest(plan),t.l,True)
 except InterruptedError:pass
 failed=list(t.l.evidence.glob('*-039-failed.json'));assert len(failed)==1;value=json.loads(failed[0].read_bytes());assert value['errorClass']=='InterruptedError' and len(value['completed'])==39 and value['holdsAndMasksUnchanged'] is True and value['guardBaseline']=='fresh-explicitly-reconciled-plan'
 assert not Path(original['delete'][38]['path']).exists() and Path(original['delete'][39]['path']).exists()
 try:m.S.create_reconciliation_plan(t.l,t.auth,binding)
 except (ValueError,OSError):pass
 else:raise AssertionError('Absence silently admitted another resume')
 print(json.dumps({'actualSigtermAfter39':True,'failedEvidencePreserved':True,'automaticRetryRefused':True}))
finally:t.tearDown()
'''
        out=subprocess.run(['/usr/bin/python3','-I','-B','-c',code,str(Path(__file__).resolve())],capture_output=True,text=True,timeout=45);self.assertEqual(out.returncode,0,out.stderr);self.assertEqual(json.loads(out.stdout),dict(actualSigtermAfter39=True,failedEvidencePreserved=True,automaticRetryRefused=True))
    def citation_manifest(self,kind,candidates,files):
        pair=S.protected_pair(self.l,{});evidence=self.l.evidence/'audit30-semantic-fixture.json'
        if not evidence.exists():S.durable(evidence,dict(classification='Historical release evidence; no active dependencies'))
        rows=[]
        for source,relative in files:
            raw=(source/relative).read_bytes();citations=[]
            for target,offset in S.path_occurrences(raw,candidates):
                start=raw.rfind(b'\n',0,offset)+1;end=raw.find(b'\n',offset);end=len(raw) if end<0 else end+1
                citations.append(dict(target=target,byteOffset=offset,line=raw.count(b'\n',0,offset)+1,lineSha256=hashlib.sha256(raw[start:end]).hexdigest(),classification='historical-release-evidence'))
            rows.append(dict(sourcePath=str(source),relativePath=relative,sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw),gitBlobSha1=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),citations=citations))
        value=dict(schema='pow-audit30-historical-citation-review-v1',host='77.42.91.106',scopeApprovalSha256=self.auth,operationKind=kind,candidatePaths=candidates,protectedSources=[dict(path=r['path'],head=r['git']['head'],tree=r['git']['tree']) for r in pair['sources']],reviewEvidence=[dict(path=str(evidence),sha256=S.hash_read(evidence,S.MAX_JSON)[0])],files=rows)
        p=self.l.evidence/('audit30-citation-review-'+str(len(list(self.l.evidence.glob('audit30-citation-review-*'))))+'.json');S.durable(p,value);return dict(path=str(p),sha256=S.hash_read(p,S.MAX_JSON)[0])
    def fake_blob(self,source,relative,head):
        raw=(source/relative).read_bytes();return hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    def test_exact_cleanup_and_preserved_pair(self):
        plan=self.plan();self.assertEqual(len(plan['delete']),40);self.assertEqual(len(plan['heldBoundaries']),40)
        S.validate_plan(plan,self.l,'cleanup',self.auth);out=S.execute(plan,S.digest(plan),self.l,True)
        self.assertEqual(out['completedCount'],40);self.assertTrue(self.l.live.exists());self.assertTrue((self.l.roots/('proofofwork-www-pre-'+self.current)).exists());self.assertTrue(self.l.hold.exists());self.assertEqual(os.readlink(self.l.units/'proofofwork-ui-release-prune.timer'),'/dev/null')
    def test_expanded_partial_duplicate_scope_refused(self):
        plan=self.plan()
        for rows in [plan['delete'][:-1],plan['delete']+[plan['delete'][0]],plan['delete'][::-1]]:
            changed=dict(plan,delete=rows)
            with self.assertRaises(ValueError):S.validate_plan(changed,self.l,'cleanup',self.auth)
    def test_changed_file_blocks_before_any_removal(self):
        plan=self.plan();p=Path(plan['delete'][0]['path'])/'proofofwork-work'/'index.html';p.write_text('corrupt')
        with self.assertRaises(ValueError):S.execute(plan,S.digest(plan),self.l,True)
        self.assertTrue(all(os.path.lexists(r['path']) for r in plan['delete']));self.assertEqual(list(self.l.evidence.iterdir()),[])
    def test_unique_passthrough_refuses(self):
        (self.l.roots/('proofofwork-www-pre-'+S.ROOT_IDS[0])/'unique-evidence.txt').write_text('must survive')
        with self.assertRaisesRegex(ValueError,'Unique non-release'):self.plan()
    def test_individually_held_descendant_refuses(self):
        self.review['retain'].append(dict(role='ui',path='/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-'+S.ROOT_IDS[0]+'/evidence',decision='retain'));self.write_review();self.update_held()
        with self.assertRaisesRegex(ValueError,'Individually held'):self.plan()
    def test_hold_or_mask_change_refuses(self):
        plan=self.plan();self.l.hold.write_text('changed')
        with self.assertRaisesRegex(ValueError,'hold changed'):S.execute(plan,S.digest(plan),self.l)
    def test_archive_checksum_is_not_payload_proof(self):
        p=self.l.archives/('proofofwork-ui-release-'+S.ARCHIVE_IDS[0]+'.tgz')
        with tarfile.open(p,'w:gz') as t:
            info=tarfile.TarInfo('surfaces');info.type=tarfile.DIRTYPE;info.mode=0o755;t.addfile(info)
        old=Path(str(p)+'.provenance').read_text();newhash=hashlib.sha256(p.read_bytes()).hexdigest();fields=dict(l.split('=',1) for l in old.splitlines());fields['archive_sha256']=newhash;raw=''.join(k+'='+v+'\n' for k,v in fields.items());Path(str(p)+'.provenance').write_text(raw);Path(str(p)+'.sha256').write_text(newhash+'  '+p.name+'\n')
        root=self.l.roots/('proofofwork-www-pre-'+S.ROOT_IDS[0]);(root/'.proofofwork-ui-release').write_text(raw)
        with self.assertRaises(ValueError):self.plan()
    def test_inode_replacement_refuses(self):
        p=self.base/'single';p.write_text('same bytes');before=S.snapshot(p);q=self.base/'replacement';q.write_text('same bytes');os.utime(q,ns=(p.stat().st_atime_ns,p.stat().st_mtime_ns));q.replace(p)
        with self.assertRaises(ValueError):S.match_snapshot(S.snapshot(p),before)
    def test_known_hardlink_unlink_and_unknown_unlink(self):
        p=self.base/'file';q=self.base/'link';p.write_text('shared');os.link(p,q);before=S.snapshot(p);q.unlink();actual=S.snapshot(p)
        with self.assertRaisesRegex(ValueError,'hardlink'):S.match_snapshot(actual,before)
        r=before['entries'][0];S.match_snapshot(actual,before,{(r['device'],r['inode']):1})
    def test_live_fd_and_operator_pointer_refuse(self):
        p=self.base/'operator.sh';candidate=str(self.l.roots/('proofofwork-www-pre-'+S.ROOT_IDS[0]));p.write_text('use '+candidate)
        with self.assertRaisesRegex(ValueError,'references'):S.references([candidate],[p],proc=self.base/'no-proc')
        inbound=self.base/'inbound';inbound.symlink_to(candidate)
        with self.assertRaisesRegex(ValueError,'references'):S.references([candidate],[inbound],proc=self.base/'no-proc')
    def test_reference_budget_and_per_root_census(self):
        one=self.base/'scan-one';two=self.base/'scan-two';one.mkdir();two.mkdir();(one/'small').write_bytes(b'1234');(two/'small').write_bytes(b'5678');(two/'large').write_bytes(b'x'*(1024**2+1));(two/'node_modules').mkdir();(two/'node_modules'/'excluded').write_bytes(b'stay excluded')
        out=S.references([], [one,two],proc=self.base/'no-proc',byte_limit=8)
        self.assertEqual(out['bytesRead'],8);self.assertEqual(out['entryLimit'],100000);self.assertEqual(out['perFileByteLimit'],1024**2);self.assertEqual([r['bytesRead'] for r in out['perRoot']],[0,4,4]);self.assertEqual(out['perRoot'][2]['skippedLargeFiles'],1);self.assertEqual(out['perRoot'][2]['skippedPayloadDirectories'],1)
        with self.assertRaisesRegex(ValueError,'byte bound: limit=7 consumed=8'):S.references([], [one,two],proc=self.base/'no-proc',byte_limit=7)
    def test_escaped_regex_preserves_substring_and_process_pointer_semantics(self):
        candidate=str(self.base/'literal[1].root');operator=self.base/'operator';operator.write_text('prefix '+candidate+'-suffix')
        with self.assertRaisesRegex(ValueError,'content-pointer'):S.references([candidate],[operator],proc=self.base/'no-proc')
        operator.write_text(candidate.replace('[1]','1').replace('.root','Xroot'));S.references([candidate],[operator],proc=self.base/'no-proc');S.references([], [operator],proc=self.base/'no-proc')
        proc=self.base/'fake-proc';process=proc/'123';process.mkdir(parents=True);(process/'cwd').symlink_to(candidate);(process/'cmdline').write_bytes(b'command');(process/'maps').write_bytes(os.fsencode(candidate)+b' (deleted)');(process/'mountinfo').write_bytes(b'mount')
        with self.assertRaisesRegex(ValueError,'path-pointer'):S.references([candidate],[],proc=proc)
        (process/'cwd').unlink()
        with self.assertRaisesRegex(ValueError,'content-pointer'):S.references([candidate],[],proc=proc)
    def test_process_mapping_read_bound_refuses(self):
        proc=self.base/'fake-proc';process=proc/'123';process.mkdir(parents=True);(process/'maps').write_bytes(b'x'*(1024**2+1))
        with self.assertRaisesRegex(ValueError,'per-file byte bound'):S.references([],[],proc=proc)
    def test_exact_historical_citation_plan_and_byte_tamper(self):
        source=self.l.scratch/('proofofwork-ui-source-'+self.current);target=self.l.exact()[0]['path'];doc=source/'OP_RETURN_INFRASTRUCTURE.md';doc.write_text('Historical release receipt: '+target+'\n');self.l.refs=[]
        with self.assertRaisesRegex(ValueError,'references'):self.plan()
        binding=self.citation_manifest('cleanup',[r['path'] for r in self.l.exact()],[(source,doc.name)])
        with patch.object(S,'git_document_blob',side_effect=self.fake_blob):
            plan=S.create_plan(self.l,'cleanup',self.auth,citation_review=binding);self.assertEqual(len(plan['references']['qualifiedHistoricalMatches']),1);self.assertEqual(plan['citationReview'],binding);S.execute(plan,S.digest(plan),self.l,False)
            doc.write_text(doc.read_text()+'unreviewed edit\n')
            with self.assertRaisesRegex(ValueError,'bytes/Git blob'):S.execute(plan,S.digest(plan),self.l,True)
        self.assertTrue(all(os.path.lexists(r['path']) for r in self.l.exact()))
    def test_citation_scope_occurrence_context_and_review_hash_refuse(self):
        source=self.l.scratch/('proofofwork-ui-source-'+self.current);target=self.l.exact()[0]['path'];doc=source/'OP_RETURN_INFRASTRUCTURE.md';doc.write_text('Historical '+target+'\nHistorical '+target+'\n');binding=self.citation_manifest('cleanup',[r['path'] for r in self.l.exact()],[(source,doc.name)]);pair=S.protected_pair(self.l,{});original=json.loads(Path(binding['path']).read_text())
        with patch.object(S,'git_document_blob',side_effect=self.fake_blob):
            for mutate in [lambda v:v['candidatePaths'].pop(),lambda v:v['protectedSources'][0].update(head='f'*40),lambda v:v['files'][0]['citations'].pop(),lambda v:v['files'][0]['citations'][0].update(lineSha256='f'*64),lambda v:v['files'][0]['citations'][0].update(classification='active-config')]:
                value=json.loads(json.dumps(original));mutate(value);Path(binding['path']).write_text(json.dumps(value));h=S.hash_read(Path(binding['path']),S.MAX_JSON)[0]
                with self.assertRaises(ValueError):S.load_citation_review(dict(path=binding['path'],sha256=h),self.l,pair,'cleanup',[r['path'] for r in self.l.exact()],self.auth)
            with self.assertRaisesRegex(ValueError,'hash differs'):S.load_citation_review(binding,self.l,pair,'cleanup',[r['path'] for r in self.l.exact()],self.auth)
    def test_citation_never_qualifies_config_symlink_or_process_match(self):
        source=self.l.scratch/('proofofwork-ui-source-'+self.current);target=self.l.exact()[0]['path'];doc=source/'OP_RETURN_INFRASTRUCTURE.md';doc.write_text('Historical '+target+'\n');binding=self.citation_manifest('cleanup',[r['path'] for r in self.l.exact()],[(source,doc.name)])
        with patch.object(S,'git_document_blob',side_effect=self.fake_blob):
            admitted=S.load_citation_review(binding,self.l,S.protected_pair(self.l,{}),'cleanup',[r['path'] for r in self.l.exact()],self.auth);config=self.base/'installed-config';config.write_text(target)
            with self.assertRaisesRegex(ValueError,'references'):S.references([target],[config,source],proc=self.base/'no-proc',reviewed_files=admitted)
            with self.assertRaisesRegex(ValueError,'references'):S.references([target],[doc],proc=self.base/'no-proc',reviewed_files=admitted)
            config.unlink();config.symlink_to(target)
            with self.assertRaisesRegex(ValueError,'references'):S.references([target],[config,source],proc=self.base/'no-proc',reviewed_files=admitted)
            proc=self.base/'fake-proc';process=proc/'123';process.mkdir(parents=True);(process/'maps').write_text(target)
            with self.assertRaisesRegex(ValueError,'references'):S.references([target],[source],proc=proc,reviewed_files=admitted)
            value=json.loads(Path(binding['path']).read_text());value['files'][0]['relativePath']='.env';Path(binding['path']).write_text(json.dumps(value));bad=dict(path=binding['path'],sha256=S.hash_read(Path(binding['path']),S.MAX_JSON)[0])
            with self.assertRaisesRegex(ValueError,'allowed protected-source document'):S.load_citation_review(bad,self.l,S.protected_pair(self.l,{}),'cleanup',[r['path'] for r in self.l.exact()],self.auth)
    def test_reviewed_document_alias_and_active_usage_always_refuse(self):
        source=self.l.scratch/('proofofwork-ui-source-'+self.current);target=self.l.exact()[0]['path'];doc=source/'OP_RETURN_INFRASTRUCTURE.md';doc.write_text('Historical '+target+'\n');binding=self.citation_manifest('cleanup',[r['path'] for r in self.l.exact()],[(source,doc.name)])
        with patch.object(S,'git_document_blob',side_effect=self.fake_blob):
            admitted=S.load_citation_review(binding,self.l,S.protected_pair(self.l,{}),'cleanup',[r['path'] for r in self.l.exact()],self.auth);outside=self.base/'outside-scan';outside.mkdir();chain=outside/'alias';chain.symlink_to(doc);config=self.base/'installed-config.json';config.symlink_to(chain)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-pointer'):S.references([target],[config,source],proc=self.base/'no-proc',reviewed_files=admitted)
            config.unlink();config.symlink_to(source)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-pointer'):S.references([target],[config,source],proc=self.base/'no-proc',reviewed_files=admitted)
            config.unlink();config.write_text('read '+str(doc))
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-content-pointer'):S.references([target],[config,source],proc=self.base/'no-proc',reviewed_files=admitted)
            config.unlink();proc=self.base/'fake-proc';process=proc/'123';process.mkdir(parents=True);(process/'fd').mkdir();(process/'fd'/'7').symlink_to(doc)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-pointer'):S.references([target],[source],proc=proc,reviewed_files=admitted)
            (process/'fd'/'7').unlink();(process/'fd'/'7').symlink_to(chain)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-pointer'):S.references([target],[source],proc=proc,reviewed_files=admitted)
            (process/'fd'/'7').unlink();(process/'cwd').symlink_to(source)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-pointer'):S.references([target],[source],proc=proc,reviewed_files=admitted)
            (process/'cwd').unlink();(process/'exe').symlink_to(doc)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-pointer'):S.references([target],[source],proc=proc,reviewed_files=admitted)
            (process/'exe').unlink();(process/'maps').write_text(str(doc))
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-content-pointer'):S.references([target],[source],proc=proc,reviewed_files=admitted)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-content-pointer'):S.references([],[source],proc=proc,reviewed_files=admitted)
            config.write_text(str(doc))
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-content-pointer'):S.references([],[config,source],proc=self.base/'no-proc',reviewed_files=admitted)
            config.unlink()
            (process/'maps').unlink();(process/'root').symlink_to('/')
            out=S.references([target],[source],proc=proc,reviewed_files=admitted);self.assertEqual(len(out['qualifiedHistoricalMatches']),1)
    def test_committed_document_blob_is_exact_and_nonexecutable(self):
        p=self.base/'git-document';subprocess.run(['git','init','-q',str(p)],check=True);doc=p/'OP_RETURN_INFRASTRUCTURE.md';doc.write_text('Historical record\n');subprocess.run(['git','-C',str(p),'add',doc.name],check=True);subprocess.run(['git','-C',str(p),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],check=True);head=subprocess.check_output(['git','-C',str(p),'rev-parse','HEAD'],text=True).strip();self.assertEqual(S.git_document_blob(p,doc.name,head),self.fake_blob(p,doc.name,head));doc.chmod(0o755);subprocess.run(['git','-C',str(p),'add',doc.name],check=True);subprocess.run(['git','-C',str(p),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','exec fixture'],check=True);head=subprocess.check_output(['git','-C',str(p),'rev-parse','HEAD'],text=True).strip()
        with self.assertRaisesRegex(ValueError,'regular committed document'):S.git_document_blob(p,doc.name,head)
    def test_preservation_requires_completed_cleanup(self):
        with self.assertRaisesRegex(ValueError,'cleanup prerequisite'):S.create_plan(self.l,'preserve-sources',self.auth)
    def test_whole_source_preservation_and_inverse(self):
        done=self.cleanup();plan=S.create_plan(self.l,'preserve-sources',self.auth,prerequisite=done);out=S.execute(plan,S.digest(plan),self.l,True)
        for r in plan['moves']:
            self.assertFalse(os.path.lexists(r['source']));self.assertTrue(Path(r['target']).exists());self.assertEqual((Path(r['target'])/'.git'/'config').read_text(),'preserve this unique metadata\n');S.match_snapshot(S.snapshot(Path(r['target']),links=True),r['snapshot'],relocation=True)
        inverse=S.create_plan(self.l,'inverse-preservation',self.auth,inverse_receipt=dict(path=out['receiptPath'],sha256=out['receiptSha256']));S.execute(inverse,S.digest(inverse),self.l,True)
        self.assertTrue(all(Path(r['source']).exists() for r in self.l.moves()))
    def test_source_absolute_symlink_and_xattr_corruption(self):
        p=self.base/'source';p.mkdir();(p/'file').write_text('x');(p/'link').symlink_to(str(p/'file'))
        with self.assertRaisesRegex(ValueError,'Absolute'):S.snapshot(p,links=True)
        (p/'link').unlink();os.setxattr(p/'file','user.audit30',b'preserve');before=S.snapshot(p);os.setxattr(p/'file','user.audit30',b'changed')
        with self.assertRaises(ValueError):S.match_snapshot(S.snapshot(p),before)
    def test_partial_deletion_failure_has_durable_receipt(self):
        plan=self.plan();real=S.shutil.rmtree;count=0
        def fail_second(*args,**kwargs):
            nonlocal count
            count+=1
            if count==2:raise OSError('fixture interrupted')
            return real(*args,**kwargs)
        with patch.object(S.shutil,'rmtree',side_effect=fail_second):
            with self.assertRaises(OSError):S.execute(plan,S.digest(plan),self.l,True)
        failures=list(self.l.evidence.glob('*failed.json'));self.assertEqual(len(failures),1);r=json.loads(failures[0].read_text());self.assertEqual(len(r['completed']),1);self.assertEqual(r['status'],'failed');self.assertTrue(Path(plan['delete'][1]['path']).exists())
    def test_git_alternates_and_dirty_status_refuse(self):
        self.source_patch.stop();p=self.base/'git-source';subprocess.run(['git','init','-q',str(p)],check=True);(p/'file').write_text('one');subprocess.run(['git','-C',str(p),'add','file'],check=True);subprocess.run(['git','-C',str(p),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],check=True)
        S.source_pointers(p);(p/'.git'/'objects'/'info'/'alternates').write_text('/external')
        with self.assertRaisesRegex(ValueError,'external'):S.source_pointers(p)
        (p/'.git'/'objects'/'info'/'alternates').unlink();(p/'file').write_text('two')
        with self.assertRaisesRegex(ValueError,'local changes'):S.source_pointers(p)
        self.source_patch.start()
    def test_git_configuration_and_index_flags_refuse(self):
        self.source_patch.stop();p=self.base/'git-source';subprocess.run(['git','init','-q',str(p)],check=True);(p/'file').write_text('one');subprocess.run(['git','-C',str(p),'add','file'],check=True);subprocess.run(['git','-C',str(p),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],check=True)
        subprocess.run(['git','-C',str(p),'config','core.worktree',str(p)],check=True)
        with self.assertRaisesRegex(ValueError,'configuration pointer'):S.source_pointers(p)
        subprocess.run(['git','-C',str(p),'config','--unset','core.worktree'],check=True);subprocess.run(['git','-C',str(p),'update-index','--assume-unchanged','file'],check=True)
        with self.assertRaisesRegex(ValueError,'index flags'):S.source_pointers(p)
    def test_promisor_dependencies_refuse_before_git_status(self):
        self.source_patch.stop();p=self.base/'promisor-source';subprocess.run(['git','init','-q',str(p)],check=True);(p/'file').write_text('one');subprocess.run(['git','-C',str(p),'add','file'],check=True);subprocess.run(['git','-C',str(p),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],check=True)
        for key,value in [('extensions.partialclone','origin'),('remote.origin.promisor','true'),('remote.origin.partialclonefilter','blob:none')]:
            subprocess.run(['git','-C',str(p),'config',key,value],check=True)
            with self.assertRaisesRegex(ValueError,'configuration pointer'):S.source_pointers(p)
            subprocess.run(['git','-C',str(p),'config','--unset',key],check=True)
        (p/'.git'/'objects'/'pack'/'fixture.promisor').write_text('')
        with self.assertRaisesRegex(ValueError,'promisor objects'):S.source_pointers(p)
        self.source_patch.start()
    def test_git_filter_driver_refused_before_any_execution(self):
        self.source_patch.stop();p=self.base/'filter-source';subprocess.run(['git','init','-q',str(p)],check=True);(p/'file').write_text('one');(p/'.gitattributes').write_text('file filter=audit30\n');subprocess.run(['git','-C',str(p),'add','.'],check=True);subprocess.run(['git','-C',str(p),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],check=True)
        sentinel=self.base/'must-not-exist';subprocess.run(['git','-C',str(p),'config','filter.audit30.clean','touch '+str(sentinel)+'; cat'],check=True)
        # Force a content check; the dangerous filter must be refused before status.
        (p/'file').write_text('one')
        with self.assertRaisesRegex(ValueError,'configuration pointer'):S.source_pointers(p)
        self.assertFalse(sentinel.exists());self.source_patch.start()
    def policy_index(self,admissions,retirements=None):
        rows=[]
        for i,a in enumerate(admissions):
            p=self.l.evidence/('audit30-policy-admission-'+str(i)+'.json')
            if not p.exists():S.durable(p,a)
            rows.append(dict(path=str(p),sha256=S.hash_read(p,S.MAX_JSON)[0]))
        value=dict(schema='pow-audit30-ui-admission-index-v1',scopeApprovalSha256=self.auth,admissions=rows,completedRetirements=retirements or [])
        p=self.l.evidence/('audit30-policy-index-'+str(len(list(self.l.evidence.glob('audit30-policy-index-*'))))+'.json');S.durable(p,value);return dict(path=str(p),sha256=S.hash_read(p,S.MAX_JSON)[0])
    def publish_policy_fixture(self,rid,surfaces=None,release_format='proofofwork-ui-release-v3'):
        os.rename(self.l.live,self.l.roots/('proofofwork-www-pre-'+rid));self.release(self.l.live,rid,surfaces,release_format);source=self.l.scratch/('proofofwork-ui-source-'+rid);source.mkdir();(source/'.git').mkdir();(source/'source').write_text('new immutable source');(source/'node_modules').mkdir();(source/'node_modules'/'dep').write_text('new verified runtime');self.dependency_provenance(self.l.live,rid)
    def future_completion_fixture(self):
        pp=patch.object(P,'S',S);pp.start();self.addCleanup(pp.stop)
        bootstrap=P.admission(self.l,self.auth,True);index=self.policy_index([bootstrap]);self.publish_policy_fixture('abcdef123456-20261002T220000Z');added=P.admission(self.l,self.auth,False,index);index=self.policy_index([bootstrap,added]);scope=P.policy_scope(index,self.l,self.auth);plan=S.create_plan(self.l,'future-retention',self.auth,scope);out=S.execute(plan,S.digest(plan),self.l,True);done=json.loads(Path(out['receiptPath']).read_bytes());intent=json.loads(Path(done['intentPath']).read_bytes());return [bootstrap,added],index,plan,out,done,intent

    def policy_record(self,prefix,value):
        p=self.l.evidence/(prefix+str(len(list(self.l.evidence.iterdir())))+'.json');S.durable(p,value)
        return dict(path=str(p),sha256=S.hash_read(p,S.MAX_JSON)[0])

    def migration_fixture(self,legacy=True,missing=False,shared=False,xattrs=False,shared_protected=False):
        pp=patch.object(P,'S',S);pp.start();self.addCleanup(pp.stop)
        old=patch.object(S,'APPROVAL_SHA',self.auth);old.start();self.addCleanup(old.stop)
        prior=self.policy_index([P.admission(self.l,self.auth,True)])
        first='aaaaaa000001-20261016T010000Z';second='aaaaaa000002-20261016T020000Z'
        self.publish_policy_fixture(first,S.V4_SURFACES,'proofofwork-ui-release-v4')
        self.publish_policy_fixture(second,S.V5_SURFACES,'proofofwork-ui-release-v5')
        # Production now retains these exact dependencies inside release evidence.
        for rid in (first,second):
            old_path,new_path=S.source_locations(self.l,rid);new_path.parent.mkdir(parents=True);os.rename(old_path,new_path)
        paths=[]
        if legacy:
            paths=[dict(path=str(self.l.roots/('proofofwork-www-pre-'+rid)),kind='rollback-root') for rid in (self.current,first)]
            paths += [dict(path=str(self.l.archives/('proofofwork-ui-release-'+rid+'.tgz'))+suffix,kind=kind) for rid in (self.current,self.previous) for suffix,kind in (('','managed-release-archive'),('.sha256','archive-sidecar'),('.provenance','archive-sidecar'))]
            paths.sort(key=lambda r:(r['kind']!='rollback-root',r['path']))
        if missing:(self.l.archives/('proofofwork-ui-release-'+self.current+'.tgz')).unlink()
        if shared:
            left=self.l.roots/('proofofwork-www-pre-'+self.current)/'proofofwork-work/index.html'
            right=self.l.roots/('proofofwork-www-pre-'+first)/'proofofwork-work/index.html'
            left.unlink();os.link(right,left)
        if shared_protected:
            left=self.l.roots/('proofofwork-www-pre-'+self.current)/'proofofwork-work/index.html'
            left.unlink();os.link(self.l.live/'proofofwork-work/index.html',left)
        if xattrs:
            os.setxattr(self.l.roots/('proofofwork-www-pre-'+self.current)/'proofofwork-work/index.html','user.custody-test',b'\x00\xffbinary attributes')
            os.setxattr(self.l.archives/('proofofwork-ui-release-'+self.current+'.tgz'),'user.custody-test',b'\x00\xffarchive attributes')
        review=P.migration_review(self.l,S.REPAIR_APPROVAL_SHA,prior,paths)
        review_binding=self.policy_record('audit30-policy-migration-review-',review)
        migration=P.migration_admission(self.l,S.REPAIR_APPROVAL_SHA,review_binding)
        migration_binding=self.policy_record('audit30-policy-migration-',migration)
        anchor_binding=self.policy_record('audit30-policy-admission-migration-',migration['anchor'])
        value=dict(schema=P.INDEX_V2,scopeApprovalSha256=S.REPAIR_APPROVAL_SHA,migration=migration_binding,admissions=[anchor_binding],completedRetirements=[])
        index=self.policy_record('audit30-policy-admission-index-v2-',value)
        return prior,review,migration,value,index

    def test_complete_format_aware_roots_archives_and_undeclared_surfaces(self):
        families=[('proofofwork-ui-release-v3',v) for v in sorted(S.V3_SURFACE_FAMILIES,key=len)]+[('proofofwork-ui-release-v4',S.V4_SURFACES),('proofofwork-ui-release-v5',S.V5_SURFACES)]
        for number,(fmt,surfaces) in enumerate(families,1):
            rid=f'{number:012x}-20261016T000000Z';root=self.base/('format-'+str(number));self.release(root,rid,surfaces,fmt)
            proof=S.release_proof(root,self.l,{})
            self.assertEqual(S.declared_surfaces(proof['fields']),surfaces)
            self.assertEqual(S.standalone_archive_proof(self.l.archives/proof['fields']['archive_name'])['payloadSha256'],S.archive_proof(self.l.archives/proof['fields']['archive_name'],proof['fields'],(root/'.proofofwork-ui-release').read_bytes())['payloadSha256'])
        root=self.base/'format-8';(root/'proofofwork-permission').mkdir()
        with self.assertRaisesRegex(ValueError,'Undeclared'):S.release_proof(root,self.l,{})

    def test_format_specific_missing_counts_and_missing_archive_content_refuse(self):
        rid='bbbbbb000001-20261016T000000Z';root=self.base/'v5';self.release(root,rid,S.V5_SURFACES,'proofofwork-ui-release-v5')
        fields,_,raw=S.manifest(root)
        for change in ({'surface.permission.file_count':None},{'surface.permission.sha256':'f'*63},{'format':'proofofwork-ui-release-v4'},{'surface.fake.sha256':'f'*64}):
            bad=dict(fields)
            for key,value in change.items():
                if value is None:bad.pop(key)
                else:bad[key]=value
            with self.assertRaises(ValueError):S.declared_surfaces(bad)
        (root/'proofofwork-permission'/'index.html').unlink()
        with self.assertRaisesRegex(ValueError,'content/count'):S.release_proof(root,self.l,{})

    def test_migration_admits_exact_old_ordinary_assets_without_historical_fiction(self):
        prior,review,migration,value,index=self.migration_fixture()
        old_bytes=Path(prior['path']).read_bytes();scope=P.policy_scope(index,self.l,S.REPAIR_APPROVAL_SHA)
        self.assertEqual(len(scope['eligible']),8);self.assertEqual(scope['eligible'],review['legacyOrdinaryPaths'])
        closure=P.custody_closure(index['path'],index['sha256'],self.l,S.REPAIR_APPROVAL_SHA)
        self.assertEqual(closure['ordinaryEligiblePaths'],scope['eligible']);self.assertEqual(len(closure['ordinaryEligibleSnapshots']),8)
        self.assertEqual(len(closure['admittedReleaseIds']),2)
        self.assertEqual(Path(prior['path']).read_bytes(),old_bytes)
        self.assertTrue(all('/transport-evidence/' in r['path'] for r in closure['pair']['sources']))
        plan=S.create_plan(self.l,'future-retention',S.REPAIR_APPROVAL_SHA,scope)
        out=S.execute(plan,S.digest(plan),self.l,True)
        value['completedRetirements']=[dict(path=out['receiptPath'],sha256=out['receiptSha256'])]
        updated=self.policy_record('audit30-policy-admission-index-v2-',value)
        self.assertEqual(P.policy_scope(updated,self.l,S.REPAIR_APPROVAL_SHA)['eligible'],[])
        self.assertEqual(len(P.load_index(updated['path'],updated['sha256'],self.l,S.REPAIR_APPROVAL_SHA)['retired']),8)

    def test_migration_preserves_unresolved_missing_history_and_rejects_erasure(self):
        _,review,migration,value,index=self.migration_fixture(legacy=False,missing=True)
        closure=P.custody_closure(index['path'],index['sha256'],self.l,S.REPAIR_APPROVAL_SHA)
        self.assertEqual(len(closure['historicalObligations']),1);self.assertEqual(closure['ordinaryEligiblePaths'],[])
        bad=json.loads(json.dumps(review));bad['historicalAssetCensus']=[r for r in bad['historicalAssetCensus'] if r['status']!='unresolved-missing-historical-object']
        migration['review']=self.policy_record('audit30-policy-migration-review-',bad)
        value['migration']=self.policy_record('audit30-policy-migration-',migration)
        forged=self.policy_record('audit30-policy-admission-index-v2-',value)
        with self.assertRaisesRegex(ValueError,'omitted historical'):P.load_index(forged['path'],forged['sha256'],self.l,S.REPAIR_APPROVAL_SHA)

    def test_repair_receipt_preserves_frozen_and_observed_known_hardlink_evidence(self):
        _,_,_,value,index=self.migration_fixture(shared=True)
        scope=P.policy_scope(index,self.l,S.REPAIR_APPROVAL_SHA);plan=S.create_plan(self.l,'future-retention',S.REPAIR_APPROVAL_SHA,scope)
        out=S.execute(plan,S.digest(plan),self.l,True);done=json.loads(Path(out['receiptPath']).read_bytes())
        self.assertTrue(any(row['snapshotSha256']!=row['observedSnapshotSha256'] for row in done['completed']))
        self.assertEqual([r['snapshotSha256'] for r in done['completed']],[r['snapshot']['sha256'] for r in plan['delete']])
        value['completedRetirements'].append(dict(path=out['receiptPath'],sha256=out['receiptSha256']))
        updated=self.policy_record('audit30-policy-admission-index-v2-',value)
        self.assertEqual(P.policy_scope(updated,self.l,S.REPAIR_APPROVAL_SHA)['eligible'],[])

    def ordinary_execution_plan(self,**options):
        _,_,_,_,index=self.migration_fixture(**options)
        return S.create_plan(self.l,'future-retention',S.REPAIR_APPROVAL_SHA,P.policy_scope(index,self.l,S.REPAIR_APPROVAL_SHA))

    def execute_locked(self,plan):
        fd=S.lock(self.l)
        try:return S.execute(plan,S.digest(plan),self.l,True,lock_fd=fd)
        finally:os.close(fd)

    def rotating_logs(self,extra=()):
        paths=sorted(S.rotating_log_paths(self.l))+[str(self.base/'var/log'/name) for name in extra]
        for name in paths:
            path=Path(name);path.parent.mkdir(parents=True,exist_ok=True);path.write_text('retained log\n');path.chmod(0o640)
            self.review['retain'].append(dict(role='ui',path='/'+str(path.relative_to(self.base)),decision='retain'))
        self.write_review();self.update_held();return [Path(name) for name in paths]

    def rotate_logs(self):
        for family in ('auth.log','kern.log','syslog','ufw.log'):
            logs=self.base/'var/log';(logs/(family+'.48.gz')).unlink()
            for number in range(47,1,-1):(logs/(family+'.'+str(number)+'.gz')).rename(logs/(family+'.'+str(number+1)+'.gz'))
            (logs/(family+'.1')).unlink();(logs/(family+'.2.gz')).write_text('compressed log\n');(logs/(family+'.2.gz')).chmod(0o640)
            (logs/family).rename(logs/(family+'.1'));(logs/family).write_text('fresh active log\n');(logs/family).chmod(0o640)

    def test_approved_rotation_model_keeps_legacy_strict_and_observations_separate(self):
        self.rotating_logs();legacy,_=S.safeguards(self.l);current,_=S.safeguards(self.l,model=S.ROTATING_LOG_GUARD_MODEL)
        before=S.rotating_log_observations(self.l,current);self.assertEqual(len(before),196);self.assertEqual(len(current['rotationConfigs']),2)
        self.assertEqual(S.modeled_guards(self.l,legacy,S.ROTATING_LOG_GUARD_MODEL),current)
        self.assertTrue(all('inode' not in row for row in current['heldCensus'] if row['path'] in S.rotating_log_paths(self.l)))
        self.rotate_logs();S.compare_guards(self.l,current,[])
        self.assertNotEqual(before,S.rotating_log_observations(self.l,current))
        with self.assertRaisesRegex(ValueError,'census changed'):S.compare_guards(self.l,legacy,[])
        with self.assertRaisesRegex(ValueError,'Unsupported'):S.safeguards(self.l,model='unknown-model')
        original=self.plan();original['safeguards']=current
        with self.assertRaisesRegex(ValueError,'approved repair scope'):S.validate_plan(original,self.l,'cleanup',self.auth)

    def test_rotation_during_ordinary_retirement_retains_descriptive_inode_evidence(self):
        self.rotating_logs();plan=self.ordinary_execution_plan();durable=S.durable;rotated=False
        def write(path,value):
            nonlocal rotated
            durable(path,value)
            if value.get('status')=='partial' and not rotated:rotated=True;self.rotate_logs()
        with patch.object(S,'durable',side_effect=write):out=self.execute_locked(plan)
        receipt=json.loads(Path(out['receiptPath']).read_bytes())
        self.assertTrue(rotated);self.assertTrue(receipt['holdsAndMasksUnchanged']);self.assertEqual(out['completedCount'],len(plan['delete']))
        self.assertNotEqual(plan['heldLogObservations'],receipt['heldLogObservations'])
        self.assertEqual(len(receipt['heldLogObservations']),196)

    def test_rotation_model_refuses_absence_type_owner_device_mode_and_config_drift(self):
        self.rotating_logs();expected,_=S.safeguards(self.l,model=S.ROTATING_LOG_GUARD_MODEL);log=self.base/'var/log/auth.log'
        raw,_=S.safeguards(self.l)
        for field in ('uid','gid','device','mode'):
            changed=json.loads(json.dumps(raw));row=next(row for row in changed['heldCensus'] if row['path']==str(log));row[field]+=1
            altered=S.modeled_guards(self.l,changed,S.ROTATING_LOG_GUARD_MODEL)
            with self.assertRaisesRegex(ValueError,'census changed'):S.compare_guards(self.l,altered,[])
        log.unlink()
        with self.assertRaisesRegex(ValueError,'absent or not regular'):S.compare_guards(self.l,expected,[])
        log.symlink_to(self.base/'var/log/syslog')
        with self.assertRaisesRegex(ValueError,'absent or not regular'):S.compare_guards(self.l,expected,[])
        log.unlink();log.mkdir()
        with self.assertRaisesRegex(ValueError,'absent or not regular'):S.compare_guards(self.l,expected,[])
        log.rmdir();log.write_text('log\n');log.chmod(0o640)
        for config in expected['rotationConfigs']:
            path=Path(config['path']);before=path.read_bytes();path.write_bytes(before+b'changed')
            with self.assertRaisesRegex(ValueError,'rotation configuration changed'):S.compare_guards(self.l,expected,[])
            path.write_bytes(before)

    def test_rotation_model_keeps_unknown_logs_holds_masks_and_release_inodes_exact(self):
        self.rotating_logs(extra=('auth.log.49.gz','other.log'));expected,_=S.safeguards(self.l,model=S.ROTATING_LOG_GUARD_MODEL)
        for name in ('auth.log.49.gz','other.log'):
            log=self.base/'var/log'/name;replacement=log.with_name('replacement');replacement.write_bytes(log.read_bytes());replacement.chmod(0o640);replacement.replace(log)
            with self.assertRaisesRegex(ValueError,'census changed'):S.compare_guards(self.l,expected,[])
            expected,_=S.safeguards(self.l,model=S.ROTATING_LOG_GUARD_MODEL)
        self.review['retain'].append(dict(role='ui',path='/var/log/new.log',decision='retain'));self.write_review()
        with self.assertRaises(ValueError):S.compare_guards(self.l,expected,[])
        self.review['retain'].pop();self.write_review()
        mask=self.l.units/'proofofwork-ui-release-prune.timer';mask.unlink();mask.write_text('unexpected unmask')
        with self.assertRaisesRegex(ValueError,'mask changed'):S.compare_guards(self.l,expected,[])
        mask.unlink();mask.symlink_to('/dev/null')
        plan=self.ordinary_execution_plan();path=Path(plan['protected']['current']['path'])/'proofofwork-work/index.html'
        old=path.stat();replacement=path.with_name('replacement');replacement.write_bytes(path.read_bytes());replacement.chmod(old.st_mode&0o777);os.utime(replacement,ns=(old.st_atime_ns,old.st_mtime_ns));replacement.replace(path)
        with self.assertRaises(ValueError):self.execute_locked(plan)

    def test_ordinary_execution_full_protected_bytes_only_at_start_and_end(self):
        plan=self.ordinary_execution_plan();protected={str(self.l.archives/plan['protected'][k]['fields']['archive_name']) for k in ('current','previous')}
        lock=S.lock(self.l)
        try:
            with patch.object(S,'archive_proof',wraps=S.archive_proof) as archives,patch.object(S,'snapshot',wraps=S.snapshot) as snapshots:
                out=S.execute(plan,S.digest(plan),self.l,True,lock_fd=lock)
        finally:os.close(lock)
        self.assertEqual(out['completedCount'],len(plan['delete']))
        for path in protected:self.assertEqual(sum(str(c.args[0])==path for c in archives.call_args_list),2)
        for source in plan['protected']['sources']:
            self.assertEqual(sum(str(c.args[0])==source['path'] for c in snapshots.call_args_list),2)
        # Every selected object is still fully read at initial validation and
        # again immediately before its own deletion, independent of the guards.
        for row in plan['delete']:self.assertGreaterEqual(sum(str(c.args[0])==row['path'] for c in snapshots.call_args_list),2)

    def test_ordinary_guard_refuses_protected_mutation_after_first_deletion(self):
        plan=self.ordinary_execution_plan();source=Path(plan['protected']['sources'][0]['path'])/'source';durable=S.durable
        def mutate_after_one(path,value):
            durable(path,value)
            if value.get('status')=='partial' and len(value['completed'])==1:
                before=source.stat();source.write_bytes(b'x'*before.st_size);os.utime(source,ns=(before.st_atime_ns,before.st_mtime_ns))
        with patch.object(S,'durable',side_effect=mutate_after_one):
            with self.assertRaises(ValueError):self.execute_locked(plan)
        failed=json.loads(next(self.l.evidence.glob('*-001-failed.json')).read_bytes())
        self.assertEqual(len(failed['completed']),1);self.assertTrue(Path(plan['delete'][1]['path']).exists())

    def test_ordinary_guard_refuses_new_protected_entry_before_first_deletion(self):
        plan=self.ordinary_execution_plan();durable=S.durable
        def mutate_after_intent(path,value):
            durable(path,value)
            if value.get('status')=='approved-intent':(Path(plan['protected']['sources'][0]['path'])/'new-entry').write_text('raced source')
        with patch.object(S,'durable',side_effect=mutate_after_intent):
            with self.assertRaises(ValueError):self.execute_locked(plan)
        self.assertTrue(all(Path(r['path']).exists() for r in plan['delete']))
        self.assertTrue(list(self.l.evidence.glob('*-000-failed.json')))

    def test_ordinary_selected_candidate_is_not_served_from_metadata_cache(self):
        plan=self.ordinary_execution_plan();durable=S.durable;candidate=Path(plan['delete'][1]['path'])/'proofofwork-work/index.html'
        def mutate_candidate(path,value):
            durable(path,value)
            if value.get('status')=='partial' and len(value['completed'])==1:
                before=candidate.stat();candidate.write_bytes(b'x'*before.st_size);os.utime(candidate,ns=(before.st_atime_ns,before.st_mtime_ns))
        with patch.object(S,'durable',side_effect=mutate_candidate):
            with self.assertRaises(ValueError):self.execute_locked(plan)
        self.assertTrue(candidate.exists());self.assertTrue(list(self.l.evidence.glob('*-001-failed.json')))

    def test_ordinary_completion_performs_fresh_full_protected_verification(self):
        plan=self.ordinary_execution_plan();release_proof=S.release_proof;current_calls=0
        def mutate_before_final_full(root,layout,cache):
            nonlocal current_calls
            if Path(root)==self.l.live:
                current_calls+=1
                if current_calls==2:
                    p=self.l.live/'proofofwork-work/index.html';before=p.stat();p.write_bytes(b'x'*before.st_size);os.utime(p,ns=(before.st_atime_ns,before.st_mtime_ns))
            return release_proof(root,layout,cache)
        with patch.object(S,'release_proof',side_effect=mutate_before_final_full):
            with self.assertRaises(ValueError):self.execute_locked(plan)
        self.assertEqual(current_calls,2);self.assertFalse(list(self.l.evidence.glob('*-completed.json')))
        failure=json.loads(next(self.l.evidence.glob('*-failed.json')).read_bytes());self.assertEqual(len(failure['completed']),len(plan['delete']))

    def test_ordinary_full_proofs_are_not_reused_across_execute_calls(self):
        plan=self.ordinary_execution_plan();path=str(self.l.archives/plan['protected']['current']['fields']['archive_name'])
        with patch.object(S,'archive_proof',wraps=S.archive_proof) as archives:
            for _ in range(2):self.assertEqual(S.execute(plan,S.digest(plan),self.l,False)['status'],'verified')
        self.assertEqual(sum(str(c.args[0])==path for c in archives.call_args_list),2)

    def test_ordinary_unlocked_execute_keeps_full_per_object_verification(self):
        plan=self.ordinary_execution_plan();path=str(self.l.archives/plan['protected']['current']['fields']['archive_name'])
        with patch.object(S,'archive_proof',wraps=S.archive_proof) as archives,patch.object(S,'guard_snapshot',side_effect=AssertionError('Unbound reuse')):
            self.assertEqual(S.execute(plan,S.digest(plan),self.l,True)['completedCount'],len(plan['delete']))
        self.assertEqual(sum(str(c.args[0])==path for c in archives.call_args_list),len(plan['delete'])+2)

    def test_ordinary_lock_loss_after_intent_refuses_without_reacquiring(self):
        plan=self.ordinary_execution_plan();fd=S.lock(self.l);durable=S.durable
        def release_after_intent(path,value):
            durable(path,value)
            if value.get('status')=='approved-intent':fcntl.flock(fd,fcntl.LOCK_UN)
        try:
            with patch.object(S,'durable',side_effect=release_after_intent):
                with self.assertRaisesRegex(ValueError,'continuously held'):S.execute(plan,S.digest(plan),self.l,True,lock_fd=fd)
            self.assertTrue(all(Path(r['path']).exists() for r in plan['delete']))
            other=S.lock(self.l);os.close(other)  # The failed guard did not silently reacquire it.
        finally:os.close(fd)

    def test_ordinary_explicit_unlocked_or_wrong_descriptor_refuses_before_intent(self):
        plan=self.ordinary_execution_plan()
        for path in (self.l.lock,self.l.capacity):
            with path.open('rb') as opened:
                with self.assertRaises(ValueError):S.execute(plan,S.digest(plan),self.l,True,lock_fd=opened.fileno())
        self.assertFalse(list(self.l.evidence.glob('audit30-future-retention-*-intent.json')))

    def test_ordinary_lock_path_replacement_refuses_cached_proofs(self):
        plan=self.ordinary_execution_plan();fd=S.lock(self.l);durable=S.durable
        def replace_after_intent(path,value):
            durable(path,value)
            if value.get('status')=='approved-intent':self.l.lock.unlink();self.l.lock.write_text('replacement lock')
        try:
            with patch.object(S,'durable',side_effect=replace_after_intent):
                with self.assertRaisesRegex(ValueError,'lock descriptor or pathname changed'):S.execute(plan,S.digest(plan),self.l,True,lock_fd=fd)
        finally:os.close(fd)
        self.assertTrue(all(Path(r['path']).exists() for r in plan['delete']))

    def test_ordinary_guard_rehashes_protected_shared_inode_after_owned_unlink(self):
        plan=self.ordinary_execution_plan(shared_protected=True);shared=self.l.live/'proofofwork-work/index.html'
        with patch.object(S,'hash_read',wraps=S.hash_read) as reads:self.execute_locked(plan)
        self.assertEqual(sum(Path(c.args[0])==shared for c in reads.call_args_list),3)  # Start, owned unlink, final.

    def test_ordinary_prior_unlink_does_not_excuse_later_protected_ctime_change(self):
        plan=self.ordinary_execution_plan(shared_protected=True);shared=self.l.live/'proofofwork-work/index.html';durable=S.durable
        def mutate_after_two(path,value):
            durable(path,value)
            if value.get('status')=='partial' and len(value['completed'])==2:
                before=shared.stat();shared.write_bytes(shared.read_bytes());os.utime(shared,ns=(before.st_atime_ns,before.st_mtime_ns))
        with patch.object(S,'durable',side_effect=mutate_after_two):
            with self.assertRaisesRegex(ValueError,'ctime'):self.execute_locked(plan)
        self.assertTrue(Path(plan['delete'][2]['path']).exists());self.assertTrue(list(self.l.evidence.glob('*-002-failed.json')))

    def test_migration_review_staleness_protected_and_held_expansion_refuse(self):
        prior,review,_,_,_=self.migration_fixture()
        bad=json.loads(json.dumps(review));bad['protected']['current']['fields']['commit']='f'*40
        with self.assertRaisesRegex(ValueError,'changed after exact review'):P.migration_admission(self.l,S.REPAIR_APPROVAL_SHA,self.policy_record('audit30-policy-migration-review-',bad))
        protected=[dict(path=review['protected']['previous']['path'],kind='rollback-root')]
        with self.assertRaisesRegex(ValueError,'protected'):P.migration_review(self.l,S.REPAIR_APPROVAL_SHA,prior,protected)
        self.review['retain'].append(dict(role='ui',path=review['legacyOrdinaryPaths'][0]['path'].removeprefix(str(self.base)),decision='retain'));self.write_review();self.update_held()
        with self.assertRaisesRegex(ValueError,'Individually held'):P.migration_review(self.l,S.REPAIR_APPROVAL_SHA,prior,review['legacyOrdinaryPaths'])

    def test_migration_incomplete_archive_and_unapproved_ancestor_refuse(self):
        prior,review,_,_,_=self.migration_fixture()
        paths=[r for r in review['legacyOrdinaryPaths'] if not r['path'].endswith('.provenance')]
        with self.assertRaisesRegex(ValueError,'incomplete'):P.migration_review(self.l,S.REPAIR_APPROVAL_SHA,prior,paths)
        self.review['retain'].append(dict(role='ui',path='/var/backups/proofofwork-ui',decision='retain'));self.write_review();self.update_held()
        with self.assertRaisesRegex(ValueError,'Unapproved held ancestor'):P.migration_review(self.l,S.REPAIR_APPROVAL_SHA,prior,review['legacyOrdinaryPaths'])

    def test_migration_and_three_future_cycles_keep_only_one_admitted_rollback(self):
        _,_,_,value,index=self.migration_fixture()
        for number in range(3):
            scope=P.policy_scope(index,self.l,S.REPAIR_APPROVAL_SHA);plan=S.create_plan(self.l,'future-retention',S.REPAIR_APPROVAL_SHA,scope);out=S.execute(plan,S.digest(plan),self.l,True)
            value['completedRetirements'].append(dict(path=out['receiptPath'],sha256=out['receiptSha256']))
            index=self.policy_record('audit30-policy-admission-index-v2-',value)
            data=P.load_index(index['path'],index['sha256'],self.l,S.REPAIR_APPROVAL_SHA)
            self.assertEqual(sum(os.path.lexists(p) for p in data['roots']),1)
            self.assertEqual(sum(os.path.lexists(p) for p in data['assets']),6)
            if number==2:break
            self.publish_policy_fixture(f'aaaaaa00000{number+3}-20261016T0{number+3}0000Z',S.V5_SURFACES,'proofofwork-ui-release-v5')
            with self.assertRaisesRegex(ValueError,'latest verified admission'):P.policy_scope(index,self.l,S.REPAIR_APPROVAL_SHA)
            a=P.admission(self.l,S.REPAIR_APPROVAL_SHA,False,index);value['admissions'].append(self.policy_record('audit30-policy-admission-',a))
            index=self.policy_record('audit30-policy-admission-index-v2-',value)

    def ordinary_custody_fixture(self,xattrs=False):
        _,_,_,_,index=self.migration_fixture(xattrs=xattrs)
        scope=P.policy_scope(index,self.l,S.REPAIR_APPROVAL_SHA);plan=S.create_plan(self.l,'future-retention',S.REPAIR_APPROVAL_SHA,scope)
        loader=importlib.machinery.SourceFileLoader('ordinary_custody_inventory',str(Path(__file__).resolve().parents[1]/'ui-retention/inventory.py'))
        spec=importlib.util.spec_from_loader(loader.name,loader);E=importlib.util.module_from_spec(spec);loader.exec_module(E)
        groups={};objects=[];custody=self.base/'independent-custody';custody.mkdir()
        for row in plan['delete']:
            p=Path(row['path']);root=row['kind']=='rollback-root'
            primary=p if root or row['kind']=='managed-release-archive' else Path(str(p).removesuffix('.sha256').removesuffix('.provenance'))
            key=str(primary)
            if key not in groups:
                inv=E.inventory(primary,os.geteuid()) if root else E.inventory_file_group(primary,sorted(primary.name+suffix for suffix in ('','.sha256','.provenance')),os.geteuid())
                source=dict(inv['fingerprint'],inventory=inv['records'])
                if not root:source['parent']=inv['parent']
                archive=custody/(str(len(groups))+'.tgz')
                with archive.open('wb') as output:exported=E.archive_root(primary,source,output,os.geteuid())
                restored=E.extract_verify(archive,source,custody/(str(len(groups))+'-restored'))
                E.verify_restored(custody/(str(len(groups))+'-restored'),source)
                record=dict(ok=True,sourcePath=key,sourceInventory=source,archivePath=str(archive),archiveSha256=exported['archiveSha256'],inventorySha256=exported['inventorySha256'],restoration=restored,planSha256='e'*64)
                groups[key]=(self.policy_record('ui-retention-custody-record-',record),record)
            binding,record=groups[key]
            objects.append(dict(path=row['path'],snapshotSha256=row['snapshot']['sha256'],custody=binding,sourceMember='.' if root else p.name,
                archiveSha256=record['archiveSha256'],inventorySha256=record['inventorySha256'],custodyPlanSha256=record['planSha256'],independentRestorationVerified=True))
        proof=dict(schema='pow-ui-retention-ordinary-custody-proof-v1',scopeApprovalSha256=S.REPAIR_APPROVAL_SHA,admissionIndex=index,
            planSha256=S.digest(plan),protectedReleaseIds=sorted(plan['protected'][k]['fields']['release_id'] for k in ('current','previous')),objects=objects)
        return plan,proof

    def test_ordinary_custody_gate_verifies_real_restored_roots_and_closed_file_groups(self):
        plan,proof=self.ordinary_custody_fixture()
        binding=self.policy_record('ui-retention-custody-proof-',proof)
        self.assertEqual(P.verify_custody_proof(binding,plan,self.l,S.REPAIR_APPROVAL_SHA),proof)
        self.assertEqual(len(proof['objects']),8)
        self.assertEqual(len({r['custody']['path'] for r in proof['objects']}),4)

    def test_ordinary_custody_gate_preserves_binary_xattrs_between_inventory_encodings(self):
        plan,proof=self.ordinary_custody_fixture(xattrs=True)
        self.assertTrue(any(r['xattrs'] for row in plan['delete'] for r in row['snapshot']['entries']))
        P.verify_custody_proof(self.policy_record('ui-retention-custody-proof-',proof),plan,self.l,S.REPAIR_APPROVAL_SHA)
        for value in ([['x','00 FF']],[['x','FF']],[['x','xx']],[['x','00'],['x','00']]):
            with self.assertRaises(ValueError):P.custody_xattrs(value)

    def test_ordinary_custody_gate_rejects_partial_reordered_wrong_plan_or_member(self):
        plan,proof=self.ordinary_custody_fixture()
        changes=[dict(proof,objects=proof['objects'][:-1]),dict(proof,objects=proof['objects'][::-1]),dict(proof,planSha256='f'*64),dict(proof,protectedReleaseIds=[])]
        for value in changes:
            with self.assertRaises(ValueError):P.verify_custody_proof(self.policy_record('ui-retention-custody-proof-',value),plan,self.l,S.REPAIR_APPROVAL_SHA)
        bad=json.loads(json.dumps(proof));bad['objects'][-1]['sourceMember']='unrelated.provenance'
        with self.assertRaisesRegex(ValueError,'exact planned member'):P.verify_custody_proof(self.policy_record('ui-retention-custody-proof-',bad),plan,self.l,S.REPAIR_APPROVAL_SHA)

    def test_ordinary_custody_gate_rejects_forged_metadata_and_boolean_only_restore(self):
        plan,proof=self.ordinary_custody_fixture();first=proof['objects'][0]
        record=json.loads(Path(first['custody']['path']).read_bytes())
        for mutate in ('restore','metadata','inventory','archive'):
            bad=json.loads(json.dumps(proof));changed=json.loads(json.dumps(record))
            if mutate=='restore':changed['restoration']['ownerRestored']=False
            elif mutate=='metadata':
                changed['sourceInventory']['inventory'][0]['identity']['st_uid']+=1
                sha=hashlib.sha256(S.encoded(changed['sourceInventory']['inventory'])+b'\n').hexdigest()
                changed['inventorySha256']=sha;changed['restoration']['inventorySha256']=sha;bad['objects'][0]['inventorySha256']=sha
            elif mutate=='inventory':changed.pop('sourceInventory')
            else:changed['archiveSha256']='f'*64
            bad['objects'][0]['custody']=self.policy_record('ui-retention-custody-record-',changed)
            with self.assertRaises(ValueError):P.verify_custody_proof(self.policy_record('ui-retention-custody-proof-',bad),plan,self.l,S.REPAIR_APPROVAL_SHA)

    def test_ordinary_external_hardlinks_require_exact_closed_alias_and_restore_evidence(self):
        _,_,_,_,index=self.migration_fixture(shared=True,xattrs=True)
        plan=S.create_plan(self.l,'future-retention',S.REPAIR_APPROVAL_SHA,P.policy_scope(index,self.l,S.REPAIR_APPROVAL_SHA))
        loader=importlib.machinery.SourceFileLoader('closed_alias_inventory',str(Path(__file__).resolve().parents[1]/'ui-retention/inventory.py'))
        spec=importlib.util.spec_from_loader(loader.name,loader);E=importlib.util.module_from_spec(spec);loader.exec_module(E)
        root=Path(plan['delete'][0]['path']);inv=E.inventory(root,os.geteuid());source=dict(inv['fingerprint'],inventory=inv['records'])
        with self.assertRaisesRegex(ValueError,'External hardlinks'):P.verify_external_link_closure(source,{},plan)
        roots=[plan['protected'][k]['snapshot'] for k in ('current','previous')]+[r['snapshot'] for r in plan['delete'] if r['kind']=='rollback-root']
        row=next(r for r in source['inventory'] if r['kind']=='file' and r['identity']['st_nlink']>1);identity=row['identity']
        aliases=sorted(str(Path(r['path'])/entry['path']) for r in roots for entry in r['entries'] if entry['kind']=='file' and (entry['device'],entry['inode'])==(identity['st_dev'],identity['st_ino']))
        closure=dict(schema='pow-ui-ordinary-export-hardlink-closure-v1',sourceRoot=str(root),policyIndex=index,
            protectedReleaseIds=sorted(plan['protected'][k]['fields']['release_id'] for k in ('current','previous')),
            verifiedRoots=sorted((dict(path=r['path'],snapshotSha256=r['sha256']) for r in roots),key=lambda r:r['path']),
            groups=[dict(device=identity['st_dev'],inode=identity['st_ino'],identity=identity,xattrs=row['xattrs'],sha256=row['sha256'],aliases=aliases)])
        source['externalLinkClosure']=closure
        restored=dict(externalLinkClosureSha256=hashlib.sha256(S.encoded(closure)+b'\n').hexdigest(),externalAliasesRetainedAsEvidence=True)
        P.verify_external_link_closure(source,restored,plan)
        for change in ('alias','root','index','protected','bytes','identity','missing','restore'):
            bad=json.loads(json.dumps(source));changed=bad['externalLinkClosure'];rest=dict(restored)
            if change=='alias':changed['groups'][0]['aliases'][-1]='/outside/unknown'
            elif change=='root':changed['verifiedRoots'][0]['snapshotSha256']='f'*64
            elif change=='index':changed['policyIndex']['sha256']='f'*64
            elif change=='protected':changed['protectedReleaseIds']=[]
            elif change=='bytes':changed['groups'][0]['sha256']='f'*64
            elif change=='identity':changed['groups'][0]['identity']['st_nlink']+=1
            elif change=='missing':changed['groups']=[]
            else:rest['externalAliasesRetainedAsEvidence']=False
            rest['externalLinkClosureSha256']=hashlib.sha256(S.encoded(changed)+b'\n').hexdigest()
            with self.assertRaises(ValueError):P.verify_external_link_closure(bad,rest,plan)

    def test_standalone_legacy_archive_full_payload_proof_and_partial_group_refusal(self):
        prior,review,_,_,_=self.migration_fixture()
        archive_rows=[r for r in review['legacyOrdinaryPaths'] if r['kind']!='rollback-root']
        standalone=P.migration_review(self.l,S.REPAIR_APPROVAL_SHA,prior,archive_rows)
        migration=P.migration_admission(self.l,S.REPAIR_APPROVAL_SHA,self.policy_record('audit30-policy-migration-review-',standalone))
        value=dict(schema=P.INDEX_V2,scopeApprovalSha256=S.REPAIR_APPROVAL_SHA,migration=self.policy_record('audit30-policy-migration-',migration),
            admissions=[self.policy_record('audit30-policy-admission-migration-',migration['anchor'])],completedRetirements=[])
        index=self.policy_record('audit30-policy-admission-index-v2-',value);scope=P.policy_scope(index,self.l,S.REPAIR_APPROVAL_SHA)
        self.assertEqual(len(scope['eligible']),6);self.assertEqual(len(scope['qualifiedArchiveProofs']),2)
        plan=S.create_plan(self.l,'future-retention',S.REPAIR_APPROVAL_SHA,scope);self.assertEqual(len(plan['delete']),6)
        archive=Path(archive_rows[0]['path']);archive.write_bytes(b'not a valid recovery archive')
        with self.assertRaises(ValueError):P.policy_scope(index,self.l,S.REPAIR_APPROVAL_SHA)

    def test_repair_receipt_envelope_is_bounded_and_uses_existing_retirement_gate(self):
        self.capacity_patch.stop()
        try:
            with patch.object(S.subprocess,'run') as run:
                S.capacity(self.l,'audit30-retirement-evidence',32*1024**2,retirement=True)
                self.assertEqual(run.call_args.args[0][-3:],['check-retirement','--path',str(self.l.evidence)])
                S.capacity(self.l,'audit30-retirement-evidence',32*1024**2+1,retirement=True)
                normal=run.call_args_list[-2].args[0]
                self.assertEqual(normal[4:9],['check','--path',str(self.l.evidence),'--additional-bytes',str(32*1024**2+1)])
                self.assertIn('check-scratch',run.call_args.args[0])
                for phase,size,scratch in [('audit30-retirement-evidence',0,0),('source-receive',1,0),('audit30-retirement-evidence',1,1)]:
                    with self.assertRaisesRegex(ValueError,'exact phase'):S.capacity(self.l,phase,size,scratch,retirement=True)
                self.assertEqual(run.call_count,3)
        finally:self.capacity_patch.start()

    def test_actual_repair_cli_migration_records_and_apply_custody_gate(self):
        import contextlib,io,types
        prior,review,migration,value,index=self.migration_fixture()
        def command(arguments):
            with patch.object(P,'os',types.SimpleNamespace(geteuid=lambda:0,nice=lambda n:None,path=os.path,close=os.close)),patch.object(S,'Layout',return_value=self.l),patch.object(S,'approval'),patch('sys.argv',['ui-release-policy.py',*arguments,'--approval',str(self.l.evidence/'authority.json'),'--approval-sha256',S.REPAIR_APPROVAL_SHA]):
                output=io.StringIO()
                with contextlib.redirect_stdout(output):P.main()
                return json.loads(output.getvalue())
        out=command(['admit-migration','--migration-review',migration['review']['path'],'--migration-review-sha256',migration['review']['sha256'],'--record'])
        self.assertEqual(out['status'],'migrated')
        data=P.load_index(out['index']['path'],out['index']['sha256'],self.l,S.REPAIR_APPROVAL_SHA)
        self.assertEqual(data['admissions'][0]['retainedPair'],review['retainedPair'])
        scope=P.policy_scope(out['index'],self.l,S.REPAIR_APPROVAL_SHA);plan=S.create_plan(self.l,'future-retention',S.REPAIR_APPROVAL_SHA,scope)
        path=self.l.evidence/'exact-plan.json';path.write_bytes(S.encoded(plan))
        with patch.object(S,'execute',side_effect=AssertionError('Writer must not run without custody')) as execute:
            with self.assertRaisesRegex(ValueError,'requires complete independently restored'):
                command(['apply','--index',out['index']['path'],'--index-sha256',out['index']['sha256'],'--plan',str(path),'--plan-sha256',S.digest(plan)])
            execute.assert_not_called()
    def forged_future_completion(self,admissions,done,intent=None):
        stamp=str(len(list(self.l.evidence.glob('audit30-forged-*'))))
        if intent is not None:
            path=self.l.evidence/('audit30-forged-intent-'+stamp+'.json');S.durable(path,intent);done['intentPath']=str(path);done['intentSha256']=S.hash_read(path,S.MAX_JSON)[0]
        path=self.l.evidence/('audit30-forged-completion-'+stamp+'.json');S.durable(path,done);return self.policy_index(admissions,[dict(path=str(path),sha256=S.hash_read(path,S.MAX_JSON)[0])])
    def test_future_reader_rejects_false_guard_snapshot_order_duplicate_and_missing(self):
        admissions,index,plan,out,good,intent=self.future_completion_fixture()
        variants=[]
        for guard in [False,None,1]:variants.append(dict(good,holdsAndMasksUnchanged=guard))
        variants.extend([dict(good,completed=good['completed'][::-1]),dict(good,completed=[good['completed'][0],*good['completed'][2:],good['completed'][0]]),dict(good,completed=[dict(good['completed'][0],snapshotSha256='0'*64),*good['completed'][1:]]),dict(good,completed=[{k:v for k,v in good['completed'][0].items() if k!='snapshotSha256'},*good['completed'][1:]]),dict(good,phase='retirement'),dict(good,guardBaselinePlanSha256='0'*64),dict(good,guardBaseline='fresh-explicitly-reconciled-plan'),dict(good,errorClass='ValueError'),{k:v for k,v in good.items() if k!='errorClass'},dict(good,missingHeldPaths=['silently changed held obligation'])])
        for changed in variants:
            with self.assertRaises(ValueError):P.policy_scope(self.forged_future_completion(admissions,changed),self.l,self.auth)
        valid=self.policy_index(admissions,[dict(path=out['receiptPath'],sha256=out['receiptSha256'])]);self.assertEqual(P.policy_scope(valid,self.l,self.auth)['eligible'],[])
    def test_future_reader_rejects_claimed_digest_and_intent_authority_changes(self):
        admissions,index,plan,out,good,intent=self.future_completion_fixture()
        for field,value in [('schema','unapproved-intent-v1'),('status','unapproved-intent'),('planSha256','e'*64)]:
            bad=json.loads(json.dumps(intent));bad[field]=value;done=dict(good)
            if field=='planSha256':done.update(planSha256=value,guardBaselinePlanSha256=value)
            with self.assertRaises(ValueError):P.policy_scope(self.forged_future_completion(admissions,done,bad),self.l,self.auth)
        for field,value in [('kind','cleanup'),('host','wrong-host'),('scopeApprovalSha256','b'*64),('controllerSha256','e'*64)]:
            bad=json.loads(json.dumps(intent));bad['plan'][field]=value;h=S.digest(bad['plan']);bad['planSha256']=h;done=dict(good,planSha256=h,guardBaselinePlanSha256=h)
            with self.assertRaises(ValueError):P.policy_scope(self.forged_future_completion(admissions,done,bad),self.l,self.auth)
    def test_future_reader_preserves_nonempty_historical_missing_obligations(self):
        self.review['retain'].append(dict(role='ui',path='/var/tmp/proofofwork-deploy/unresolved-historical-evidence.json',decision='retain'));self.write_review();self.update_held();admissions,index,plan,out,good,intent=self.future_completion_fixture();self.assertEqual(len(good['missingHeldPaths']),1)
        with self.assertRaisesRegex(ValueError,'obligations'):P.policy_scope(self.forged_future_completion(admissions,dict(good,missingHeldPaths=[])),self.l,self.auth)
        valid=self.policy_index(admissions,[dict(path=out['receiptPath'],sha256=out['receiptSha256'])]);self.assertEqual(P.policy_scope(valid,self.l,self.auth)['eligible'],[])
    def test_future_reader_rejects_wrong_index_lineage_and_unadmitted_path(self):
        admissions,index,plan,out,good,intent=self.future_completion_fixture();source=json.loads(Path(index['path']).read_bytes())
        for changed_source in [dict(source,admissions=source['admissions'][::-1]),dict(source,admissions=source['admissions'][:1]),dict(source,completedRetirements=[dict(path=out['receiptPath'],sha256=out['receiptSha256'])])]:
            path=self.l.evidence/('audit30-forged-source-index-'+str(len(list(self.l.evidence.glob('audit30-forged-source-index-*'))))+'.json');S.durable(path,changed_source);bad=json.loads(json.dumps(intent));bad['plan']['policyScope']['admissionIndex']=dict(path=str(path),sha256=S.hash_read(path)[0]);h=S.digest(bad['plan']);bad['planSha256']=h
            with self.assertRaises(ValueError):P.policy_scope(self.forged_future_completion(admissions,dict(good,planSha256=h,guardBaselinePlanSha256=h),bad),self.l,self.auth)
        bad=json.loads(json.dumps(intent));extra=json.loads(json.dumps(bad['plan']['delete'][0]));extra['path']=str(self.l.roots/'proofofwork-www-pre-0123456789ab-20261002T223000Z');extra['snapshot']['path']=extra['path'];bad['plan']['delete'].append(extra);bad['plan']['policyScope']['eligible'].append(dict(path=extra['path'],kind=extra['kind']));h=S.digest(bad['plan']);bad['planSha256']=h;done=dict(good,planSha256=h,guardBaselinePlanSha256=h,currentPath=extra['path'],completed=[*good['completed'],dict(path=extra['path'],outcome='retired',snapshotSha256=extra['snapshot']['sha256'])])
        with self.assertRaisesRegex(ValueError,'derive'):P.policy_scope(self.forged_future_completion(admissions,done,bad),self.l,self.auth)
    def test_future_valid_second_admission_retirement_and_duplicate_history(self):
        admissions,index,plan,out,good,intent=self.future_completion_fixture();retirements=[dict(path=out['receiptPath'],sha256=out['receiptSha256'])];index=self.policy_index(admissions,retirements);self.publish_policy_fixture('fedcba654321-20261002T230000Z');added=P.admission(self.l,self.auth,False,index);admissions.append(added);index=self.policy_index(admissions,retirements);scope=P.policy_scope(index,self.l,self.auth);self.assertEqual(len(scope['eligible']),4);next_plan=S.create_plan(self.l,'future-retention',self.auth,scope);next_out=S.execute(next_plan,S.digest(next_plan),self.l,True);next_row=dict(path=next_out['receiptPath'],sha256=next_out['receiptSha256']);finished=self.policy_index(admissions,[*retirements,next_row]);self.assertEqual(P.policy_scope(finished,self.l,self.auth)['eligible'],[])
        with self.assertRaisesRegex(ValueError,'Duplicate'):P.policy_scope(self.policy_index(admissions,[*retirements,next_row,next_row]),self.l,self.auth)
    def test_future_reader_rejects_coherent_current_and_prior_archive_retirement_forgery(self):
        admissions,index,plan,out,good,intent=self.future_completion_fixture()
        for protected in ('current','previous'):
            bad=json.loads(json.dumps(intent));forged=bad['plan'];rid=forged['protected'][protected]['fields']['release_id'];forged['protected'][protected]['fields']['archive_name']='malformed-'+protected+'-name.tgz'
            archive=next(r for a in admissions for r in a['archives'] if Path(r['path']).name=='proofofwork-ui-release-'+rid+'.tgz');rows=list(forged['delete'])
            for fp in [archive['snapshot'],*archive['sidecars']]:rows.append(dict(path=fp['path'],kind='managed-release-archive' if fp['path'].endswith('.tgz') else 'archive-sidecar',snapshot=fp))
            rows.sort(key=lambda r:(r['kind']!='rollback-root',r['path']));forged['delete']=rows;forged['policyScope']['eligible']=[dict(path=r['path'],kind=r['kind']) for r in rows];h=S.digest(forged);bad['planSha256']=h;done=dict(good,planSha256=h,guardBaselinePlanSha256=h,currentPath=rows[-1]['path'],completed=[dict(path=r['path'],outcome='retired',snapshotSha256=r['snapshot']['sha256']) for r in rows]);ix=self.forged_future_completion(admissions,done,bad)
            # Exact admitted asset snapshots and coherent canonical claims cannot
            # turn either retained release's recovery archive into retired history.
            with self.assertRaisesRegex(ValueError,'archive name'):P.load_index(ix['path'],ix['sha256'],self.l,self.auth)
            self.assertTrue(Path(archive['path']).exists())
    def test_future_producer_refuses_stale_index_before_plan_and_accepts_new_admission(self):
        with patch.object(P,'S',S):
            bootstrap=P.admission(self.l,self.auth,True);stale=self.policy_index([bootstrap]);self.publish_policy_fixture('abcdef123456-20261002T220000Z');before={str(p):S.snapshot(p)['sha256'] for p in [*self.l.roots.iterdir(),*self.l.archives.iterdir()]}
            with patch.object(S,'execute',side_effect=AssertionError('Stale index must not reach any writer')):
                with self.assertRaisesRegex(ValueError,'latest verified admission'):S.execute(S.create_plan(self.l,'future-retention',self.auth,P.policy_scope(stale,self.l,self.auth)),self.auth,self.l,True)
            self.assertEqual(before,{str(p):S.snapshot(p)['sha256'] for p in [*self.l.roots.iterdir(),*self.l.archives.iterdir()]})
            added=P.admission(self.l,self.auth,False,stale);fresh=self.policy_index([bootstrap,added]);self.assertEqual(len(P.policy_scope(fresh,self.l,self.auth)['eligible']),4)
    def test_actual_policy_cli_canonical_stdout_verification_and_completion(self):
        code=r'''
import hashlib,importlib.machinery,importlib.util,io,json,os,sys,types
from pathlib import Path
from unittest.mock import patch
loader=importlib.machinery.SourceFileLoader('policy_cli_fixture',sys.argv[1]);spec=importlib.util.spec_from_loader(loader.name,loader);m=importlib.util.module_from_spec(spec);loader.exec_module(m);t=m.StorageTests();t.setUp()
try:
 with patch.object(m.P,'S',m.S),patch.object(m.P,'os',types.SimpleNamespace(geteuid=lambda:0,nice=lambda n:None,path=os.path,close=os.close)),patch.object(m.S,'approval'):
  bootstrap=m.P.admission(t.l,t.auth,True);index=t.policy_index([bootstrap]);t.publish_policy_fixture('abcdef123456-20261002T220000Z');added=m.P.admission(t.l,t.auth,False,index);index=t.policy_index([bootstrap,added])
  def command(kind,extra=None):
   sys.argv=['ui-release-policy.py',kind,'--approval',str(t.l.evidence/'fixture-approval.json'),'--approval-sha256',t.auth,'--index',index['path'],'--index-sha256',index['sha256'],*(extra or [])];buffer=io.BytesIO();output=io.TextIOWrapper(buffer,encoding='utf-8')
   with patch.object(m.P.S,'Layout',return_value=t.l),patch('sys.stdout',output):m.P.main()
   output.flush();raw=buffer.getvalue();output.detach();return raw
  raw=command('plan');plan=json.loads(raw);assert raw==m.S.encoded(plan) and not raw.endswith(b'\n');h=hashlib.sha256(raw).hexdigest();assert h==m.S.digest(plan)
  path=t.l.evidence/'audit30-cli-canonical-plan.json';path.write_bytes(raw);spaced=t.l.evidence/'audit30-cli-noncanonical-plan.json';spaced.write_text(json.dumps(plan,sort_keys=True)+'\n')
  with patch.object(m.S,'execute',side_effect=AssertionError('No writer may run for noncanonical bytes')):
   try:command('apply',['--plan',str(spaced),'--plan-sha256',m.S.hash_read(spaced,m.S.MAX_JSON)[0]])
   except ValueError as e:assert 'canonical' in str(e)
   else:raise AssertionError('Noncanonical CLI plan admitted')
  verified=json.loads(command('verify',['--plan',str(path),'--plan-sha256',h]));assert verified['status']=='verified'
  done=json.loads(command('apply',['--plan',str(path),'--plan-sha256',h]));receipt=json.loads(Path(done['receiptPath']).read_bytes());assert receipt['planSha256']==h and receipt['guardBaselinePlanSha256']==h
  final=t.policy_index([bootstrap,added],[dict(path=done['receiptPath'],sha256=done['receiptSha256'])]);assert m.P.policy_scope(final,t.l,t.auth)['eligible']==[]
 print(json.dumps({'actualCliCanonicalBytes':True,'rawShaEqualsEmbeddedDigest':True,'noncanonicalRefusedBeforeWriter':True,'validVerifyApplyAndReader':True}))
finally:t.tearDown()
'''
        out=subprocess.run(['/usr/bin/python3','-I','-B','-c',code,str(Path(__file__).resolve())],capture_output=True,text=True,timeout=60);self.assertEqual(out.returncode,0,out.stderr);self.assertEqual(json.loads(out.stdout),dict(actualCliCanonicalBytes=True,rawShaEqualsEmbeddedDigest=True,noncanonicalRefusedBeforeWriter=True,validVerifyApplyAndReader=True))
    def test_future_bootstrap_chain_exact_policy_and_missing_loss(self):
        with patch.object(P,'S',S):
            bootstrap=P.admission(self.l,self.auth,True);index=self.policy_index([bootstrap])
            self.assertEqual(P.policy_scope(index,self.l,self.auth)['eligible'],[])
            new='abcdef123456-20261002T220000Z';os.rename(self.l.live,self.l.roots/('proofofwork-www-pre-'+new));self.release(self.l.live,new)
            src=self.l.scratch/('proofofwork-ui-source-'+new);src.mkdir();(src/'.git').mkdir();(src/'source').write_text('new source')
            (src/'node_modules').mkdir();(src/'node_modules'/'dep').write_text('new runtime');self.dependency_provenance(self.l.live,new)
            added=P.admission(self.l,self.auth,False,index);index=self.policy_index([bootstrap,added]);scope=P.policy_scope(index,self.l,self.auth);self.assertEqual(len(scope['eligible']),4)
            self.assertTrue(all(self.previous in r['path'] or r['kind']=='rollback-root' for r in scope['eligible']))
            plan=S.create_plan(self.l,'future-retention',self.auth,scope);out=S.execute(plan,S.digest(plan),self.l,True)
            with self.assertRaisesRegex(ValueError,'Unreconciled missing'):P.policy_scope(index,self.l,self.auth)
            updated=self.policy_index([bootstrap,added],[dict(path=out['receiptPath'],sha256=out['receiptSha256'])]);self.assertEqual(P.policy_scope(updated,self.l,self.auth)['eligible'],[])
            self.assertTrue((self.l.roots/('proofofwork-www-pre-'+S.ROOT_IDS[0])).exists());self.assertTrue((self.l.scratch/('proofofwork-ui-source-'+self.previous)).exists())
    def test_future_rejects_forged_history_or_partial_assets(self):
        with patch.object(P,'S',S):
            bootstrap=P.admission(self.l,self.auth,True);bad=json.loads(json.dumps(bootstrap));bad['archives']=bad['archives'][:1]
            index=self.policy_index([bad])
            with self.assertRaisesRegex(ValueError,'Partial'):P.policy_scope(index,self.l,self.auth)
    def test_postpublication_policy_requires_fresh_exact_citation_review(self):
        with patch.object(P,'S',S),patch.object(S,'git_document_blob',side_effect=self.fake_blob):
            old_source=self.l.scratch/('proofofwork-ui-source-'+self.current);(old_source/'OP_RETURN_INFRASTRUCTURE.md').write_text('Historical '+self.l.exact()[0]['path']+'\n');old=self.citation_manifest('cleanup',[r['path'] for r in self.l.exact()],[(old_source,'OP_RETURN_INFRASTRUCTURE.md')]);bootstrap=P.admission(self.l,self.auth,True);index=self.policy_index([bootstrap])
            new='abcdef123456-20261002T220000Z';os.rename(self.l.live,self.l.roots/('proofofwork-www-pre-'+new));self.release(self.l.live,new);source=self.l.scratch/('proofofwork-ui-source-'+new);source.mkdir();(source/'.git').mkdir();(source/'node_modules').mkdir();(source/'node_modules'/'dep').write_text('new runtime');self.dependency_provenance(self.l.live,new);added=P.admission(self.l,self.auth,False,index);index=self.policy_index([bootstrap,added]);scope=P.policy_scope(index,self.l,self.auth);targets=[r['path'] for r in scope['eligible']];(source/'audits').mkdir();doc=source/'audits'/'release.md';doc.write_text('Historical verified prior recovery: '+targets[0]+'\nHistorical archive: '+next(p for p in targets if p.endswith('.tgz'))+'\n')
            with self.assertRaisesRegex(ValueError,'references'):S.create_plan(self.l,'future-retention',self.auth,scope)
            with self.assertRaisesRegex(ValueError,'scope/source/approval'):S.create_plan(self.l,'future-retention',self.auth,scope,citation_review=old)
            binding=self.citation_manifest('future-retention',targets,[(source,'audits/release.md')]);plan=S.create_plan(self.l,'future-retention',self.auth,scope,citation_review=binding);self.assertEqual(len(plan['references']['qualifiedHistoricalMatches']),1);out=S.execute(plan,S.digest(plan),self.l,True);self.assertEqual(out['completedCount'],4);self.assertTrue(doc.exists());self.assertEqual(doc.read_text().count('Historical'),2)

    def test_shared_protected_inode_survives_complete_cleanup(self):
        shared=self.l.live/'proofofwork-work'/'index.html';old=self.l.roots/('proofofwork-www-pre-'+S.ROOT_IDS[0])/'proofofwork-work'/'index.html';old.unlink();os.link(shared,old)
        plan=self.plan();S.execute(plan,S.digest(plan),self.l,True);self.assertEqual(shared.read_text(),'surface work');self.assertEqual(shared.stat().st_nlink,1)
    def test_atomic_rename_never_overwrites_existing_target(self):
        p=self.base/'original';q=self.base/'occupied';p.mkdir();q.mkdir();(p/'bytes').write_text('preserve')
        with self.assertRaises(OSError):S.rename_no_replace(p,q)
        self.assertTrue(p.exists());self.assertTrue(q.exists());self.assertTrue((p/'bytes').exists())
    def test_runtime_provenance_mismatch_refuses(self):
        (self.l.scratch/('proofofwork-ui-source-'+self.current)/'node_modules'/'ignored.bin').write_bytes(b'altered')
        with self.assertRaisesRegex(ValueError,'runtime dependencies differ'):self.plan()
    def test_malformed_archive_directory_mode_refuses(self):
        root=self.l.roots/('proofofwork-www-pre-'+S.ROOT_IDS[0]);fields,_,_=S.manifest(root);p=self.l.archives/fields['archive_name']
        with tarfile.open(p,'w:gz') as t:
            info=tarfile.TarInfo('surfaces');info.type=tarfile.DIRTYPE;info.mode=0o700;info.uid=os.getuid();info.gid=os.getgid();t.addfile(info)
            for name in S.SURFACES:
                def alter(member):
                    if member.isdir():member.mode=0o777
                    return member
                t.add(root/('proofofwork-'+name),arcname='surfaces/'+name,filter=alter)
        fields['archive_sha256']=hashlib.sha256(p.read_bytes()).hexdigest();raw=''.join(k+'='+v+'\n' for k,v in fields.items());(root/'.proofofwork-ui-release').write_text(raw);Path(str(p)+'.provenance').write_text(raw);Path(str(p)+'.sha256').write_text(fields['archive_sha256']+'  '+p.name+'\n')
        with self.assertRaisesRegex(ValueError,'directory mode'):self.plan()
    def test_canonical_private_archive_wrapper_and_refusals(self):
        # Retained production265 uses0700 surfaces wrapper and0755 rendered dirs.
        root=self.l.live;fields,_,_=S.manifest(root);p=self.l.archives/fields['archive_name']
        for mode,uid,gid,accept in [(0o700,os.getuid(),os.getgid(),True),(0o755,os.getuid(),os.getgid(),True),(0o000,os.getuid(),os.getgid(),False),(0o777,os.getuid(),os.getgid(),False),(0o700,os.getuid()+1,os.getgid(),False),(0o700,os.getuid(),os.getgid()+1,False)]:
            with tarfile.open(p,'w:gz') as t:
                info=tarfile.TarInfo('surfaces');info.type=tarfile.DIRTYPE;info.mode=mode;info.uid=uid;info.gid=gid;t.addfile(info)
                for name in S.SURFACES:t.add(root/('proofofwork-'+name),arcname='surfaces/'+name)
            fields['archive_sha256']=hashlib.sha256(p.read_bytes()).hexdigest();raw=''.join(k+'='+v+'\n' for k,v in fields.items());(root/'.proofofwork-ui-release').write_text(raw);Path(str(p)+'.provenance').write_text(raw);Path(str(p)+'.sha256').write_text(fields['archive_sha256']+'  '+p.name+'\n')
            if accept:S.release_proof(root,self.l,{})
            else:
                with self.assertRaisesRegex(ValueError,'surfaces archive root'):S.release_proof(root,self.l,{})
    def test_actual_sigterm_after_rename_preserves_inverse_evidence(self):
        code=r'''
import importlib.machinery,importlib.util,json,os,signal,sys
from pathlib import Path
loader=importlib.machinery.SourceFileLoader('signal_fixture',sys.argv[1]);spec=importlib.util.spec_from_loader(loader.name,loader);m=importlib.util.module_from_spec(spec);loader.exec_module(m)
t=m.StorageTests();t.setUp()
try:
 done=t.cleanup();plan=m.S.create_plan(t.l,'preserve-sources',t.auth,prerequisite=done);rename=m.S.rename_no_replace;count=0
 def interrupt_after_move(left,right):
  global count
  rename(left,right);count+=1
  if count==1:os.kill(os.getpid(),signal.SIGTERM)
 m.S.rename_no_replace=interrupt_after_move
 try:m.S.execute(plan,m.S.digest(plan),t.l,True)
 except InterruptedError:pass
 failed=sorted(t.l.evidence.glob('*preserve-sources*failed.json'))[-1];value=json.loads(failed.read_text());assert value['errorClass']=='InterruptedError' and value['completed']==[]
 inverse=m.S.create_plan(t.l,'inverse-preservation',t.auth,inverse_receipt=dict(path=str(failed),sha256=m.S.hash_read(failed,m.S.MAX_JSON)[0]));assert len(inverse['moves'])==1;m.S.execute(inverse,m.S.digest(inverse),t.l,True)
 assert all(Path(r['source']).exists() and not Path(r['target']).exists() for r in t.l.moves());print(json.dumps({'gracefulSignalFailedReceipt':True,'inverseRecovered':True}))
finally:t.tearDown()
'''
        out=subprocess.run(['/usr/bin/python3','-I','-B','-c',code,str(Path(__file__).resolve())],capture_output=True,text=True,timeout=45)
        self.assertEqual(out.returncode,0,out.stderr);self.assertEqual(json.loads(out.stdout),dict(gracefulSignalFailedReceipt=True,inverseRecovered=True))


if __name__=='__main__':unittest.main()
