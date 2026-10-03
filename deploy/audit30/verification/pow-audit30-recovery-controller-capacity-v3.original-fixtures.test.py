#!/usr/bin/python3 -I
"""Pure local proposal safety gates; no PostgreSQL, systemd or network calls."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch, Mock

HERE=Path('/home/sixer/ProofOfWork.Me/deploy/audit30/recovery')
s=importlib.util.spec_from_file_location('recovery_candidate',Path('/tmp/pow-audit30-recovery-controller-capacity-v3.py'))
C=importlib.util.module_from_spec(s);s.loader.exec_module(C)
g=importlib.util.spec_from_file_location('frozen_restore_guard',HERE.parent/'restore-latest-logical.py')
G=importlib.util.module_from_spec(g);g.loader.exec_module(G)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name)
        identity={k:0 for k in C.meta(Path(__file__))};identity.update(mode=0o644,nlink=1)
        self.p=dict(schema=C.SCHEMA,phaseApprovalSha256=C.PHASE_APPROVAL,
          activationApprovalSha256='a'*64,activationScope='new-audit30-root-slot-wal-one-base-only',
          sourceSha256='b'*64,guardSha256='c'*64,runId='20261003T001500Z',host='pow-bitcoin-01',
          mode='receivewal',unit='proofofwork-audit30-receivewal.service',root=str(C.ROOT),
          rootIdentity=dict(device=1,inode=2,uid=108,gid=112,mode=0o700),
          evidence=str(C.ROOT/'evidence'/'receivewal-20261003T001500Z'),systemIdentifier='12345',
          timeline=1,walSegmentBytes=16*1024**2,tablespaces=[dict(oid=123,path='/data/proofofwork-postgres-tablespaces/proof_indexer')],
          initialSlotRestartLsn='0/1000000',slotReservationReceiptSha256='f'*64,
          protectedFiles=[dict(path=name,sha256='d'*64,metadata=identity.copy()) for name in sorted(C.PRESERVED_PATHS)],liveServices={},
          backupWindow=dict(preflightAtUtc='2026-10-03T00:00:00+00:00',nextScheduledAtUtc='2026-10-03T03:18:48+00:00'),backupLock=None,baseAdmissionLock=None)
        self.p['liveServices']={name:dict(MainPID='123',InvocationID='1'*32) for name in G.SERVICES}

    def row(self):
        return dict(systemIdentifier='12345',timeline=1,segmentBytes=16*1024**2,walLevel='replica',
          slotCapMB='16384',archiveMode='off',synchronousNames='',tablespaces=self.p['tablespaces'],
          slot=dict(slot_type='physical',temporary=False,active=True,active_pid=555,restart_lsn='0/1000000',wal_status='reserved',safe_wal_size=16*C.GIB),
          receiver=dict(application_name=C.APPLICATION,client_addr=None,state='streaming',flush_lsn='0/2000000',replyAgeSeconds=1),primaryFlushLsn='0/2000010')

    def test_strict_scope_and_activation_gate(self):
        self.assertEqual(C.validate_plan(self.p),self.p)
        for key,value in [('activationApprovalSha256',None),('root','/var/backups/postgresql'),('mode','expire'),('unit','pg_receivewal@16-main.service'),('evidence','/data/old-job'),('rootIdentity',{}),('tablespaces',[dict(oid=1,path='/var/lib/postgresql')]),('phaseApprovalSha256','f'*64)]:
            p=copy.deepcopy(self.p);p[key]=value
            with self.subTest(key=key),self.assertRaises((ValueError,TypeError)):C.validate_plan(p)
        p=copy.deepcopy(self.p);p['extra']='auto-delete'
        with self.assertRaises(ValueError):C.validate_plan(p)

    def test_duplicate_json_refused(self):
        with self.assertRaises(ValueError):json.loads('{"unit":"a","unit":"b"}',object_pairs_hook=C.pairs)

    def test_missing_native_authority_and_boolean_metadata_refuse(self):
        p=copy.deepcopy(self.p);p['protectedFiles'].pop()
        with self.assertRaises(ValueError):C.validate_plan(p)
        p=copy.deepcopy(self.p);p['protectedFiles'][0]['metadata']['inode']=True
        with self.assertRaises(ValueError):C.validate_plan(p)

    def test_backup_lock_same_inode_owner_mode_and_collision_refusal(self):
        import fcntl
        p=self.base/'backup-lock';p.touch(mode=0o600);expected=C.meta(p)
        who=type('P',(),{'pw_uid':os.geteuid(),'pw_gid':os.getegid()})()
        with patch.object(C,'BACKUP_LOCK',p),patch.object(C.pwd,'getpwnam',return_value=who):
            fd=C.open_backup_lock(expected);os.close(fd)
            forged=dict(expected,inode=expected['inode']+1)
            with self.assertRaises(ValueError):C.open_backup_lock(forged)
            exclusive=os.open(p,os.O_RDONLY)
            try:
                fcntl.flock(exclusive,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with self.assertRaises(BlockingIOError):C.open_backup_lock(expected)
            finally:os.close(exclusive)

    def test_managed_unit_weakenings_refuse(self):
        desired={**C.PROPERTIES,'ReadWritePaths':str(C.ROOT),'ReadOnlyPaths':C.SOCKET,'RuntimeMaxUSec':'infinity','InaccessiblePaths':' '.join(C.DENIED)}
        with patch.object(C.os,'geteuid',return_value=108),patch.object(C.pwd,'getpwnam',return_value=type('P',(),{'pw_uid':108})()),patch.object(C.os,'uname',return_value=type('U',(),{'nodename':self.p['host']})()),patch.object(Path,'read_text',return_value='0::/system.slice/'+self.p['unit']),patch.object(C,'namespace_fence'):
            with patch.object(C,'props',return_value=desired):C.runtime_fence(self.p)
            for key,value in [('MemoryMax','infinity'),('CPUQuotaPerSecUSec','infinity'),('Restart','always'),('InaccessiblePaths',''),('ReadWritePaths','/data'),('Slice','system-other.slice')]:
                altered=dict(desired);altered[key]=value
                with self.subTest(key=key),patch.object(C,'props',return_value=altered),self.assertRaises(ValueError):C.runtime_fence(self.p)

    def test_input_symlink_and_write_permissions_refused(self):
        p=self.base/'input';p.write_bytes(b'known');p.chmod(0o600)
        self.assertEqual(C.safe_file(p),b'known')
        link=self.base/'alias';link.symlink_to(p)
        with self.assertRaises(ValueError):C.safe_file(link)
        p.chmod(0o666)
        with self.assertRaises(ValueError):C.safe_file(p)
        p.chmod(0o600)
        with self.assertRaises(ValueError):C.safe_file(p,maximum=4)

    def test_native_managed_credential_calls_attestor_and_rehashes(self):
        raw=C.encoded(self.p);sha=hashlib.sha256(raw).hexdigest()
        path=Path('/run/credentials/'+self.p['unit']+'/recovery-plan')
        info=dict(C.meta(Path(__file__)),uid=0,gid=0,mode=0o440,bytes=len(raw));guard=Mock()
        with patch.object(C,'safe_file',return_value=raw),patch.object(C,'meta',return_value=info),patch.object(C,'load_guard',return_value=guard):
            self.assertEqual(C.read_plan(path,sha),self.p)
        guard.validate_managed_credential.assert_called_once_with(path,self.p['unit'],'recovery-plan',HERE/'reviewed-plan.json')
        with patch.object(C,'safe_file',side_effect=[raw,raw+b' ']),patch.object(C,'meta',return_value=info),patch.object(C,'load_guard',return_value=Mock()),self.assertRaises(ValueError):C.read_plan(path,sha)
        for changes in [dict(uid=108),dict(gid=112),dict(mode=0o400)]:
            bad={**info,**changes}
            with self.subTest(changes=changes),patch.object(C,'safe_file',return_value=raw),patch.object(C,'meta',return_value=bad),patch.object(C,'load_guard') as load,self.assertRaises(ValueError):
                C.read_plan(path,sha)
            load.assert_not_called()

    def test_package_hash_mismatch_refuses_before_import(self):
        raw=b'different-controller';info=dict(C.meta(Path(__file__)),uid=0,gid=0,mode=0o755)
        with patch.object(C,'safe_file',return_value=raw),patch.object(C,'meta',return_value=info),patch.object(C.importlib.util,'spec_from_file_location') as load,self.assertRaises(ValueError):C.load_guard(self.p)
        load.assert_not_called()

    def test_receiver_argv_never_loop_no_slot_create_or_primary_quorum(self):
        args=C.receiver_argv()
        for token in ('--synchronous','--no-loop','--no-password','--slot='+C.SLOT):self.assertIn(token,args)
        self.assertNotIn('--create-slot',args);self.assertNotIn('--no-sync',args)
        self.assertIn('application_name='+C.APPLICATION,args[1])
        self.assertIn('host=/run/postgresql',args[1])

    def test_base_maps_every_tablespace_and_preserves_failed_bytes(self):
        args=C.base_argv(self.p)
        self.assertIn('--no-clean',args);self.assertIn('--manifest-checksums=SHA256',args)
        self.assertIn('--wal-method=stream',args)
        self.assertEqual([a for a in args if a.startswith('--tablespace-mapping=')],['--tablespace-mapping=/data/proofofwork-postgres-tablespaces/proof_indexer='+str(C.ROOT/'bases'/self.p['runId']/'tablespaces'/'123')])
        self.assertFalse(any(a.startswith('--slot=') or a=='--no-sync' or a=='--write-recovery-conf' for a in args))

    def test_slot_identity_lost_stale_and_sync_quorum_refuse(self):
        row=self.row()
        with patch.object(C,'live_query',return_value=row):self.assertEqual(C.cluster_fence(self.p,True),row)
        cases=[('timeline',2),('slotCapMB','-1'),('archiveMode','on'),('systemIdentifier','999'),('synchronousNames','ANY 1 (*)'),('synchronousNames','FIRST 1 (pow_audit30_receivewal)')]
        for key,value in cases:
            broken=copy.deepcopy(row);broken[key]=value
            with self.subTest(key=key,value=value),patch.object(C,'live_query',return_value=broken),self.assertRaises(ValueError):C.cluster_fence(self.p,True)
        for key,value in [('wal_status','lost'),('wal_status','unreserved'),('slot_type','logical'),('temporary',True),('safe_wal_size',None),('active',False)]:
            broken=copy.deepcopy(row);broken['slot'][key]=value
            with self.subTest(key=key,value=value),patch.object(C,'live_query',return_value=broken),self.assertRaises(ValueError):C.cluster_fence(self.p,True)
        for key,value in [('client_addr','127.0.0.1'),('application_name','other'),('replyAgeSeconds',31),('flush_lsn','0/3000000'),('state','catchup')]:
            broken=copy.deepcopy(row);broken['receiver'][key]=value
            with self.subTest(key=key,value=value),patch.object(C,'live_query',return_value=broken),self.assertRaises(ValueError):C.cluster_fence(self.p,True)

    def test_exact_complete_wal_interval_and_partial_refusal(self):
        size=16*1024**2;files={C.segment_name(i,1,size):size for i in range(1,4)}
        result=C.coverage(files,'0/1000010','0/3000001',1,size)
        self.assertEqual(result['completeSegments'],3);self.assertFalse(result['partialSegmentsAccepted'])
        missing=dict(files);del missing[C.segment_name(2,1,size)];missing[C.segment_name(2,1,size)+'.partial']=size
        with self.assertRaises(ValueError):C.coverage(missing,'0/1000010','0/3000001',1,size)
        truncated=dict(files);truncated[C.segment_name(2,1,size)]=size-1
        with self.assertRaises(ValueError):C.coverage(truncated,'0/1000010','0/3000001',1,size)
        with self.assertRaises(ValueError):C.coverage(files,'0/1000010','0/3000001',2,size)
        with self.assertRaises(ValueError):C.coverage(files,'0/3000001','0/1000010',1,size)

    def test_lsn_geometry_not_decimal_or_overflow(self):
        self.assertEqual(C.lsn('1/0'),2**32)
        for value in ('1/100000000','100000000/0','a/1','1','1/-1'):
            with self.subTest(value=value),self.assertRaises(ValueError):C.lsn(value)
        self.assertEqual(C.segment_name(256,1,16*1024**2),'000000010000000100000000')

    def test_resource_bound_fails_before_health_claim(self):
        class FS:
            f_bavail=500*C.GIB;f_frsize=1
        with patch.object(C,'roots_fence'),patch.object(C,'authority_fence'),patch.object(C,'cluster_fence',return_value=self.row()),patch.object(C,'wal_inventory',return_value={}),patch.object(C.os,'statvfs',return_value=FS()):
            with patch.object(C,'bounded_allocation',side_effect=[1,C.WAL_MAX+1,2]),self.assertRaises(ValueError):C.storage(self.p)
            with patch.object(C,'bounded_allocation',side_effect=[C.BASE_MAX+1,1,2]),self.assertRaises(ValueError):C.storage(self.p)
            small=FS();small.f_bavail=C.DATA_MIN-1
            with patch.object(C,'bounded_allocation',return_value=1),patch.object(C.os,'statvfs',return_value=small),self.assertRaises(ValueError):C.storage(self.p)

    def test_closed_archive_gap_is_detected_despite_active_slot(self):
        row=self.row();row['receiver']['flush_lsn']='0/4000001';row['primaryFlushLsn']='0/4000001'
        size=self.p['walSegmentBytes'];files={C.segment_name(i,1,size):size for i in (1,2,3)}
        self.assertEqual(C.closed_coverage(self.p,row,files)['completeSegments'],3)
        del files[C.segment_name(2,1,size)]
        with self.assertRaises(ValueError):C.closed_coverage(self.p,row,files)
        row['receiver']['flush_lsn']='0/1000020'
        self.assertEqual(C.closed_coverage(self.p,row,{})['completeSegments'],0)

    def test_wal_symlink_truncated_and_unknown_entries_refuse(self):
        root=self.base/'archive-root';(root/'wal').mkdir(parents=True)
        who=type('P',(),{'pw_uid':os.geteuid(),'pw_gid':os.getegid()})();p=copy.deepcopy(self.p);p['walSegmentBytes']=1024**2
        name=C.segment_name(1,1,p['walSegmentBytes']);f=root/'wal'/name;f.touch(mode=0o600)
        with f.open('r+b') as data:data.truncate(p['walSegmentBytes'])
        with patch.object(C,'ROOT',root),patch.object(C.pwd,'getpwnam',return_value=who),patch.object(C.time,'sleep'):
            self.assertEqual(C.wal_inventory(p),{name:p['walSegmentBytes']})
            f.unlink();f.symlink_to(self.base/'outside')
            with self.assertRaises(ValueError):C.wal_inventory(p)
            f.unlink();f.write_bytes(b'short');f.chmod(0o600)
            with self.assertRaises(ValueError):C.wal_inventory(p)

    def test_real_watcher_sigkill_during_receiver_supervision(self):
        job=self.base/'job';job.mkdir();watch=G.Watchdog(job,sample=lambda _:dict(fake='local'),interval=.01);watch.start()
        child=subprocess.Popen([sys.executable,'-I','-B','-c','import time;time.sleep(30)'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        with (job/'stderr').open('xb') as err:
            os.kill(watch.pid,signal.SIGKILL);started=time.monotonic()
            try:
                with self.assertRaises(ValueError):C.supervise_receiver(child,watch,err,interval=.01)
                self.assertLess(time.monotonic()-started,2)
            finally:
                C.stop_child(child)
                try:watch.stop()
                except (ValueError,ChildProcessError):pass
        self.assertIsNotNone(child.poll())

    def test_receiver_exit_zero_still_requires_new_continuity_proof(self):
        class Healthy:
            def assert_alive(self):pass
        child=subprocess.Popen([sys.executable,'-I','-B','-c','pass'],start_new_session=True);child.wait()
        with (self.base/'stderr').open('xb') as err,self.assertRaises(ValueError):C.supervise_receiver(child,Healthy(),err,interval=.01)

    def test_failed_base_capture_preserves_new_target_and_durable_failure(self):
        p=copy.deepcopy(self.p);p['mode']='basebackup';p['unit']='proofofwork-audit30-basebackup@'+p['runId']+'.service'
        root=self.base/'new-root';(root/'bases').mkdir(parents=True);job=self.base/'evidence';job.mkdir();p['evidence']=str(job)
        lockfile=self.base/'lock';lockfile.touch();fd=os.open(lockfile,os.O_RDONLY)
        basefd=os.open(lockfile,os.O_RDONLY)
        guard=Mock();guard.utc=G.utc;guard.durable=G.durable
        runner=Mock();runner.run.side_effect=TimeoutError('local bounded capture fixture');guard.Runner.return_value=runner
        with patch.object(C,'ROOT',root),patch.object(C,'runtime_fence'),patch.object(C,'roots_fence'),patch.object(C,'authority_fence'),patch.object(C,'load_guard',return_value=guard),patch.object(C,'open_base_lock',return_value=basefd),patch.object(C,'open_backup_lock',return_value=fd),patch.object(C,'storage'),patch.object(C,'cluster_fence',return_value=self.row()),patch.object(C,'stop_child',side_effect=ProcessLookupError('local stop race')),self.assertRaises(TimeoutError):C.execute(p,'f'*64)
        self.assertTrue((root/'bases'/p['runId']/'tablespaces').is_dir())
        failed=json.loads((job/'failed-or-stopped.json').read_bytes())
        self.assertEqual(failed['phase'],'base-capture');self.assertTrue(failed['jobRetained'])
        self.assertFalse(failed['oldDataDeleted']);self.assertFalse(failed['slotDropped']);self.assertFalse(failed['automaticRetry'])
        self.assertEqual(failed['cleanupErrors'],[dict(subject='receiver',errorClass='ProcessLookupError')]);self.assertTrue(failed['unitCgroupStopRequired'])
        guard.Watchdog.return_value.stop.assert_called_once()
        with self.assertRaises(OSError):os.fstat(fd)
        with self.assertRaises(OSError):os.fstat(basefd)

    def test_unit_and_sql_proposals_have_no_native_expiry_install_or_restart(self):
        for name in ('proofofwork-audit30-receivewal.service','proofofwork-audit30-basebackup@.service'):
            text=(HERE/name).read_text()
            for line in ('Restart=no','ProtectSystem=strict','PrivateNetwork=true','RestrictAddressFamilies=AF_UNIX','CapabilityBoundingSet=','MemoryMax=2G','CPUQuota=50%','Slice=system.slice'):self.assertIn(line,text)
            self.assertNotIn('[Install]',text.replace('# No [Install]','').replace('# One explicit run. No [Install]',''))
            self.assertFalse(any(token in text for token in ('ExecStart=/usr/bin/pg_backupcluster','expirebasebackups','Restart=always','WantedBy=')))
            self.assertIn('Requisite=postgresql@16-main.service',text);self.assertNotIn('Requires=',text)
            self.assertIn('/reviewed-plan.json',text)
        sql=(HERE/'reserve-slot.sql').read_text()
        self.assertIn("pg_create_physical_replication_slot('pow_audit30_receivewal', true)",sql)
        self.assertNotIn('pg_drop_replication_slot',sql);self.assertNotIn('ALTER SYSTEM',sql.split('-- Keep')[0])


    def actual_operator_signal(self, operator_signal):
        # Exercise execute's actual ordinary handler while frozen26c Runner
        # waits in DefaultSelector. No systemd, PostgreSQL or remote access.
        p=copy.deepcopy(self.p);p['mode']='basebackup'
        p['unit']='proofofwork-audit30-basebackup@'+p['runId']+'.service'
        root=self.base/'signal-root';(root/'bases').mkdir(parents=True)
        job=self.base/'signal-evidence';job.mkdir();p['evidence']=str(job)
        lockfile=self.base/'signal-lock';lockfile.touch()
        fd=os.open(lockfile,os.O_RDONLY);basefd=os.open(lockfile,os.O_RDONLY)
        child_pid=job/'literal-child.pid';helper=[]
        class LocalRunner:
            def __init__(self, private_job, watcher, started):
                self.actual=G.Runner(private_job,watcher,started)
            def run(self, _argv, phase, **_kwargs):
                pid=os.fork()
                if pid==0:
                    time.sleep(.06);os.kill(os.getppid(),operator_signal);os._exit(0)
                helper.append(pid)
                script='import os,time,pathlib;pathlib.Path('+repr(str(child_pid))+').write_text(str(os.getpid()));time.sleep(30)'
                return self.actual.run([sys.executable,'-I','-B','-c',script],phase,timeout=2)
        guard=Mock();guard.utc=G.utc;guard.durable=G.durable;guard.Runner=LocalRunner
        guard.Watchdog.return_value.assert_alive=lambda:None
        original={s:signal.getsignal(s) for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
        started=time.monotonic()
        try:
            with patch.object(C,'ROOT',root),patch.object(C,'runtime_fence'),patch.object(C,'roots_fence'),patch.object(C,'authority_fence'),patch.object(C,'load_guard',return_value=guard),patch.object(C,'open_base_lock',return_value=basefd),patch.object(C,'open_backup_lock',return_value=fd),patch.object(C,'storage'),patch.object(C,'cluster_fence',return_value=self.row()),self.assertRaises(C.RecoveryInterrupted):
                C.execute(p,'f'*64)
        finally:
            handlers={sig:signal.getsignal(sig) for sig in original}
            for sig in handlers:signal.signal(sig,signal.SIG_IGN)
            try:
                for pid in helper:
                    found,_status=os.waitpid(pid,os.WNOHANG)
                    if found==0:
                        os.kill(pid,signal.SIGKILL);os.waitpid(pid,0)
            finally:
                for sig,handler in handlers.items():signal.signal(sig,handler)
        self.assertLess(time.monotonic()-started,1)
        failure=json.loads((job/'failed-or-stopped.json').read_bytes())
        self.assertEqual(failure['errorClass'],'RecoveryInterrupted')
        self.assertEqual(failure['phase'],'base-capture')
        self.assertFalse(failure['automaticRetry']);self.assertFalse(failure['oldDataDeleted'])
        self.assertFalse(failure['slotDropped']);self.assertEqual(failure['cleanupErrors'],[])
        self.assertFalse((job/'completed.json').exists())
        self.assertTrue((root/'bases'/p['runId']/'tablespaces').is_dir())
        self.assertTrue(child_pid.exists())
        with self.assertRaises(ProcessLookupError):os.kill(int(child_pid.read_text()),0)
        for s,h in original.items():self.assertEqual(signal.getsignal(s),h)
        for closed in (fd,basefd):
            with self.assertRaises(OSError):os.fstat(closed)
        guard.Watchdog.return_value.stop.assert_called_once()

    def test_actual_sigint_propagates_refuses_and_reaps_literal_child(self):
        self.actual_operator_signal(signal.SIGINT)

    def test_actual_sigterm_propagates_refuses_and_reaps_literal_child(self):
        self.actual_operator_signal(signal.SIGTERM)


if __name__=='__main__':unittest.main()
