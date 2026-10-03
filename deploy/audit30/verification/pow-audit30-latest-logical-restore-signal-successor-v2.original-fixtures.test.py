#!/usr/bin/python3 -I
"""Isolated fixtures. No PostgreSQL, systemd, SSH, or production invocation."""
from pathlib import Path
from contextlib import contextmanager, ExitStack
import copy
import datetime as dt
import errno
import hashlib
import importlib.machinery
import importlib.util
import json
import os
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

P=Path('/tmp/pow-audit30-latest-logical-restore-signal-successor-v2.py')
loader=importlib.machinery.SourceFileLoader('audit30_restore_fixture',str(P));spec=importlib.util.spec_from_loader(loader.name,loader);C=importlib.util.module_from_spec(spec);loader.exec_module(C)

GLOBALS=b"""-- pg_dumpall fixture
\\restrict fixtureToken
SET default_transaction_read_only = off;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
CREATE ROLE postgres;
ALTER ROLE postgres WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS;
CREATE ROLE proof_indexer;
ALTER ROLE proof_indexer WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS PASSWORD 'SCRAM-SHA-256$opaque-fixture';
ALTER ROLE proof_indexer SET statement_timeout TO '120s';
GRANT pg_monitor TO proof_indexer WITH INHERIT FALSE, SET TRUE GRANTED BY postgres;
CREATE TABLESPACE large_state OWNER proof_indexer LOCATION '/data/live-tablespace';
\\unrestrict fixtureToken
"""


def plan():
    ident=dict(device=1,inode=2,mode=0o600,uid=108,gid=112,bytes=12,mtimeNs=1,ctimeNs=1,nlink=1)
    return dict(schema=C.SCHEMA,approvalSha256=C.APPROVAL_SHA,controllerSha256='a'*64,
        runId='20261002T230000Z',host='fixture-node',job='/data/proofofwork-audit30-restore-20261002T230000Z',
        unit='proofofwork-audit30-logical-restore-20261002T230000Z.service',
        backup=dict(path=str(C.BACKUPS)+'/proof_indexer-20261002T031851Z.dumpset',directory={**ident,'mode':0o700,'nlink':2},members={n:{**ident,'sha256':str(i)*64} for i,n in enumerate(C.MEMBERS,1)}),
        backupLock=ident.copy(),toc=dict(sha256='b'*64,entries=197),
        backupWindow=dict(preflightAtUtc='2026-10-02T23:00:00+00:00',nextScheduledAtUtc='2026-10-03T03:18:51+00:00'),
        liveServices={n:dict(MainPID=str(100+i),InvocationID='a'*32) for i,n in enumerate(C.SERVICES)})


def managed_fixture():
    unit=plan()['unit'];name='restore-plan';directory=Path('/run/credentials')/unit
    source=Path('/data/immutable-private-tools/reviewed-plan.json');package=source.parent;p=directory/name
    base=dict(device=70,inode=2,mode=0o440,uid=0,gid=0,bytes=1402,mtimeNs=1,ctimeNs=1,nlink=1)
    rows={str(p):base,str(directory):{**base,'inode':1,'mode':0o550,'bytes':60,'nlink':2},str(source):{**base,'device':64514,'inode':3,'mode':0o600},str(package):{**base,'device':64514,'inode':4,'mode':0o750,'nlink':2}}
    object_path='/org/freedesktop/systemd1/unit/'+''.join(ch if ch.isalnum() else '_'+format(ord(ch),'02x') for ch in unit)
    return dict(unit=unit,name=name,path=p,directory=directory,source=source,package=package,rows=rows,
        euid=108,env=str(directory),cgroup='0::/system.slice/'+unit+'\n',inventory=[name],
        mount='878 747 0:70 / '+str(directory)+' ro,nosuid,nodev,noexec,relatime,nosymfollow shared:621 master:545 - tmpfs tmpfs rw,size=1024k,noswap\n',
        props=dict(User='postgres',ProtectSystem='strict',NoNewPrivileges='yes',CapabilityBoundingSet='',AmbientCapabilities=''),
        manager=dict(type='o',data=[object_path]),loaded=dict(type='a(ss)',data=[[name,str(source)]]),
        access={(str(p),os.R_OK):True,(str(p),os.W_OK):False,(str(directory),os.W_OK):False,(str(source),os.R_OK):False,(str(source),os.W_OK):False})


@contextmanager
def managed_environment(f, drift=False):
    counts={}
    def meta(p):
        key=str(p);counts[key]=counts.get(key,0)+1;r=copy.deepcopy(f['rows'][key])
        if drift and key==str(f['source']) and counts[key]>1:r['inode']+=1
        return r
    def text(p,*_a,**_k):
        if str(p)=='/proc/self/cgroup':return f['cgroup']
        if str(p)=='/proc/self/mountinfo':return f['mount']
        raise AssertionError('Unexpected read')
    def command(argv,**_kwargs):
        if 'GetUnit' in argv:return C.canonical(f['manager'])
        if 'LoadCredential' in argv:return C.canonical(f['loaded'])
        raise AssertionError('Unexpected command')
    directories={str(f['directory']),str(f['package'])}
    with ExitStack() as stack:
        patches=[patch.object(C,'__file__',str(f['package']/'restore-latest-logical.py')),
            patch.object(C,'canonical_path',lambda p:Path(p)),patch.object(C,'metadata',meta),
            patch.object(C.os,'geteuid',return_value=f['euid']),patch.object(C.pwd,'getpwnam',return_value=SimpleNamespace(pw_uid=108)),
            patch.dict(C.os.environ,{'CREDENTIALS_DIRECTORY':f['env']}),patch.object(Path,'read_text',text),
            patch.object(Path,'lstat',lambda p:SimpleNamespace(st_mode=(stat.S_IFDIR if str(p) in directories else stat.S_IFREG)|f['rows'][str(p)]['mode'])),
            patch.object(Path,'is_dir',lambda p:str(p) in directories),patch.object(C.os,'listdir',return_value=f['inventory']),
            patch.object(C.os,'access',lambda p,mode:f['access'].get((str(p),mode),False)),
            patch.object(C,'system_properties',lambda *_:copy.deepcopy(f['props'])),patch.object(C,'command',command)]
        for p in patches:stack.enter_context(p)
        yield


class RestoreTests(unittest.TestCase):
    def test_strict_plan_positive_and_scope_mutations(self):
        self.assertEqual(C.validate_plan(plan()),plan())
        variants=[lambda p:p.update(approvalSha256='f'*64),lambda p:p.update(job='/var/lib/postgresql/16/main'),lambda p:p.update(unit='postgresql@16-main.service'),lambda p:p.update(runId='20260231T230000Z'),lambda p:p['backup'].update(path='/tmp/unapproved.dumpset'),lambda p:p['backup']['members'].pop('globals.sql'),lambda p:p.update(extraCleanup=True),lambda p:p['liveServices'].pop(C.SERVICES[0]),lambda p:p['backup']['members']['globals.sql'].update(nlink=2),lambda p:p['backup']['members']['globals.sql'].update(mode=0o666)]
        for change in variants:
            p=plan();change(p)
            with self.subTest(p=p),self.assertRaises(ValueError):C.validate_plan(p)

    def test_credential_hash_location_mode_and_owner(self):
        p=plan();raw=C.canonical(p);sha=hashlib.sha256(raw).hexdigest()
        correct=Path('/run/credentials')/p['unit']/'restore-plan'
        ident=dict(uid=0,mode=0o440,bytes=len(raw))
        def attest(path,unit,name,source):
            if Path(path)!=correct:raise ValueError('Forged credential location')
        with patch.object(C,'canonical_path',lambda path:Path(path)),patch.object(C,'metadata',lambda _:ident.copy()),patch.object(Path,'read_bytes',lambda _:raw),patch.object(C,'validate_managed_credential',attest):
            self.assertEqual(C.read_plan(correct,sha,True),p)
            with self.assertRaises(ValueError):C.read_plan('/tmp/forged-credential',sha,True)
            with self.assertRaises(ValueError):C.read_plan(correct,'f'*64,True)
            ident['mode']=0o600
            with self.assertRaises(ValueError):C.read_plan(correct,sha,True)
            ident.update(mode=0o440,uid=1)
            with self.assertRaises(ValueError):C.read_plan(correct,sha,True)

    def test_original_root600_branch_is_unchanged(self):
        p=plan();raw=C.canonical(p);sha=hashlib.sha256(raw).hexdigest();ident=dict(uid=0,mode=0o600,bytes=len(raw))
        with patch.object(C,'canonical_path',lambda path:Path(path)),patch.object(C,'metadata',lambda _:ident.copy()),patch.object(Path,'read_bytes',lambda _:raw),patch.object(C,'validate_managed_credential',side_effect=AssertionError('Root branch must not attest service credentials')):
            self.assertEqual(C.read_plan('/data/root-plan.json',sha),p)
            for k,v in [('uid',108),('mode',0o440),('bytes',65537)]:
                old=ident[k];ident[k]=v
                with self.subTest(k=k),self.assertRaises(ValueError):C.read_plan('/data/root-plan.json',sha)
                ident[k]=old

    def test_native_root440_managed_credential_full_binding(self):
        f=managed_fixture()
        with managed_environment(f):
            got=C.validate_managed_credential(f['path'],f['unit'],f['name'],f['source'])
            self.assertTrue(got['readonlyCredential']);self.assertTrue(got['typedLoadCredentialBound'])

    def test_native_credential_false_authority_and_namespace_shapes_refuse(self):
        mutations=[lambda f:f['rows'][str(f['path'])].update(uid=108),lambda f:f['rows'][str(f['path'])].update(gid=112),
            lambda f:f['rows'][str(f['path'])].update(mode=0o400),lambda f:f['rows'][str(f['path'])].update(nlink=2),
            lambda f:f['rows'][str(f['directory'])].update(mode=0o750),lambda f:f['rows'][str(f['directory'])].update(gid=112),
            lambda f:f['rows'][str(f['source'])].update(mode=0o640),lambda f:f['rows'][str(f['source'])].update(uid=108),
            lambda f:f['rows'][str(f['source'])].update(bytes=1403),lambda f:f['rows'][str(f['package'])].update(mode=0o770),
            lambda f:f.update(env='/tmp/forged-credentials'),lambda f:f.update(cgroup=f['cgroup'].replace('.service','.service-extra')),
            lambda f:f.update(euid=0),lambda f:f.update(inventory=[f['name'],'other']),
            lambda f:f['access'].update({(str(f['path']),os.W_OK):True}),lambda f:f['access'].update({(str(f['source']),os.R_OK):True}),
            lambda f:f['props'].update(ProtectSystem='full'),lambda f:f['props'].update(AmbientCapabilities='CAP_FOWNER'),
            lambda f:f.update(mount=f['mount'].replace(' ro,',' rw,')),lambda f:f.update(mount=f['mount'].replace(',nosymfollow','')),
            lambda f:f.update(mount=f['mount'].replace('0:70','0:71')),lambda f:f.update(mount=f['mount'].replace('- tmpfs tmpfs','- ext4 /dev/sda')),
            lambda f:f.update(mount=f['mount']+f['mount']),lambda f:f.update(mount=''),
            lambda f:f.update(manager=dict(type='o',data=['/forged/unit'])),lambda f:f.update(loaded=dict(type='s',data='[unprintable]')),
            lambda f:f['loaded']['data'].append(['other',str(f['source'])]),lambda f:f['loaded']['data'][0].__setitem__(1,'/etc/unapproved-plan.json'),
            lambda f:f['loaded']['data'][0].__setitem__(0,'wrong-name')]
        for i,change in enumerate(mutations):
            f=managed_fixture();change(f)
            with self.subTest(case=i),managed_environment(f),self.assertRaises(ValueError):C.validate_managed_credential(f['path'],f['unit'],f['name'],f['source'])

    def test_native_credential_attestation_detects_identity_drift(self):
        f=managed_fixture()
        with managed_environment(f,drift=True),self.assertRaises(ValueError):C.validate_managed_credential(f['path'],f['unit'],f['name'],f['source'])

    def test_hash_metadata_symlink_and_content_tampering(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'input';p.write_bytes(b'bound input');p.chmod(0o600)
            row={**C.metadata(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
            self.assertEqual(C.hash_file(p,row),row['sha256'])
            p.write_bytes(b'changed data')
            with self.assertRaises(ValueError):C.hash_file(p,row)
            link=Path(td)/'alias';link.symlink_to(p)
            with self.assertRaises(ValueError):C.hash_file(link)

    def test_root_source_read_does_not_require_fowner_capability(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'root-owned-source';p.write_bytes(b'controller');p.chmod(0o644)
            original=os.open;flags=[]
            def open_file(path,flag,*args):
                flags.append(flag)
                if flag&os.O_NOATIME:raise PermissionError(errno.EPERM,'fixture root-owned inode')
                return original(path,flag,*args)
            with patch.object(C.os,'open',open_file):
                self.assertEqual(C.hash_file(p,no_atime=False),hashlib.sha256(b'controller').hexdigest())
                with self.assertRaises(PermissionError):C.hash_file(p)
            self.assertFalse(flags[0]&os.O_NOATIME)

    def test_new_job_symlink_refuses_before_any_command(self):
        with tempfile.TemporaryDirectory() as td:
            base=Path(td);(base/'real').mkdir();(base/'alias').symlink_to(base/'real',target_is_directory=True)
            p=plan();p['job']=str(base/'alias')
            with patch.object(C,'command',side_effect=AssertionError('No commands allowed')),self.assertRaises(ValueError):C.execute(p,'a'*64)

    def test_actual_private_unit_properties_fail_closed(self):
        p=plan();props={**C.UNIT_PROPERTIES,'ReadWritePaths':p['job'],'ReadOnlyPaths':str(C.BACKUPS),'InaccessiblePaths':' '.join(C.UNIT_INACCESSIBLE)}
        original=Path.read_text
        def text(path,*args,**kwargs):return '0::/system.slice/'+p['unit']+'\n' if str(path)=='/proc/self/cgroup' else original(path,*args,**kwargs)
        with patch.object(C.pwd,'getpwnam',return_value=SimpleNamespace(pw_uid=os.geteuid())),patch.object(C.os,'uname',return_value=SimpleNamespace(nodename=p['host'])),patch.object(Path,'read_text',text),patch.object(C,'system_properties',lambda *_:props.copy()),patch.object(C.os,'listdir',side_effect=PermissionError):
            self.assertEqual(C.check_runtime(p)['PrivateNetwork'],'yes')
            for name,bad in [('PrivateNetwork','no'),('ProtectSystem','full'),('MemoryMax','infinity'),('ReadWritePaths','/data'),('RestrictAddressFamilies','AF_UNIX AF_INET'),('RuntimeMaxUSec','infinity')]:
                original_value=props[name];props[name]=bad
                with self.subTest(name=name),self.assertRaises(ValueError):C.check_runtime(p)
                props[name]=original_value
            props['InaccessiblePaths']=' '.join(C.INACCESSIBLE)
            with self.assertRaises(ValueError):C.check_runtime(p)

    def test_absent_optional_path_appearing_stops_storage_guard(self):
        def listdir(path):
            if path.endswith('/physical'):return []
            raise PermissionError()
        with patch.object(C.os,'listdir',listdir),self.assertRaises(ValueError):C.storage_sample(Path('/tmp/fixture'))

    def test_storage_thresholds_and_bounded_du_retry(self):
        with patch.object(C.os,'listdir',side_effect=PermissionError),patch.object(C,'allocation',return_value=C.MAXIMUM+1),patch.object(C.os,'statvfs',return_value=SimpleNamespace(f_bavail=C.DATA_FLOOR+C.MAXIMUM,f_frsize=1)),self.assertRaises(ValueError):C.storage_sample(Path('/tmp/fixture'))
        with patch.object(C,'command',side_effect=[RuntimeError(),b'123\t/tmp/fixture\n']),patch.object(C.time,'sleep'):
            self.assertEqual(C.allocation('/tmp/fixture'),123)
        with patch.object(C,'command',side_effect=RuntimeError()),patch.object(C.time,'sleep'),self.assertRaises(ValueError):C.allocation('/tmp/fixture')

    def test_backup_window_real_timer_must_match_and_clear_full_budget(self):
        p=plan();now=dt.datetime.fromisoformat(p['backupWindow']['preflightAtUtc'])
        def props(unit,_):return {'ActiveState':'inactive'} if unit.endswith('.service') else {'ActiveState':'active','NextElapseUSecRealtime':'Sat 2026-10-03 03:18:51 UTC'}
        with patch.object(C,'system_properties',props):
            C.check_window(p,now)
            with self.assertRaises(ValueError):C.check_window(p,now+dt.timedelta(minutes=16))
            p['backupWindow']['nextScheduledAtUtc']=(now+dt.timedelta(minutes=120)).isoformat()
            with self.assertRaises(ValueError):C.check_window(p,now)

    def test_roles_full_flags_password_config_and_membership(self):
        sql,roles,grants,excluded=C.role_globals(GLOBALS)
        self.assertEqual(excluded,1);self.assertNotIn(b'CREATE TABLESPACE',sql)
        self.assertNotIn(b'CREATE ROLE postgres;',sql)
        self.assertEqual(roles['proof_indexer']['rolpassword'],'SCRAM-SHA-256$opaque-fixture')
        self.assertEqual(roles['proof_indexer']['rolconfig'],['statement_timeout=120s'])
        self.assertEqual(grants,[dict(role='pg_monitor',member='proof_indexer',grantor='postgres',admin_option=False,inherit_option=False,set_option=True)])

    def test_pg16_role_catalog_global_settings_mapping_and_exact_refusals(self):
        _,roles,_,_=C.role_globals(GLOBALS)
        actual=dict(unsupportedSettings=0,roles=[dict(rolname=n,**v) for n,v in roles.items()])
        actual['roles'].append(dict(rolname='pg_monitor',**{**roles['postgres'],'rolconfig':None}))
        C.verify_role_catalog(actual,roles)
        self.assertEqual(actual['roles'][1]['rolconfig'],['statement_timeout=120s'])
        self.assertIsNone(actual['roles'][0]['rolconfig'])
        # The catalog query binds PG16 settings by role OID and global scope;
        # it must never read a nonexistent pg_authid.rolconfig column.
        self.assertIn('s.setconfig AS rolconfig',C.ROLE_CATALOG_SQL)
        self.assertIn('s.setrole = a.oid AND s.setdatabase = 0',C.ROLE_CATALOG_SQL)
        self.assertNotIn('a.rolconfig',C.ROLE_CATALOG_SQL)
        variants=[lambda a:a.update(unsupportedSettings=1),lambda a:a.update(unsupportedSettings=True),
            lambda a:a['roles'][1].update(rolconfig=None),lambda a:a['roles'][1].update(rolconfig=['statement_timeout=121s']),
            lambda a:a['roles'][1].update(rolpassword='different'),lambda a:a['roles'][1].update(rolvaliduntil='infinity'),
            lambda a:a['roles'][2].update(rolconfig=['work_mem=16MB']),lambda a:a['roles'].append(copy.deepcopy(a['roles'][0])),
            lambda a:a['roles'].pop(1),lambda a:a.update(extra=True)]
        for i,change in enumerate(variants):
            a=copy.deepcopy(actual);change(a)
            with self.subTest(case=i),self.assertRaises(ValueError):C.verify_role_catalog(a,roles)

    def test_per_database_role_settings_remain_unsupported_source_grammar(self):
        with self.assertRaises(ValueError):
            C.role_globals(GLOBALS+b"ALTER ROLE proof_indexer IN DATABASE proof_indexer SET statement_timeout TO '120s';")

    def test_globals_unsupported_or_injected_constructs_refuse(self):
        for suffix in [b'COPY anything TO PROGRAM \'touch /tmp/sentinel\';',b'\\connect production\n',b'ALTER ROLE proof_indexer SET session_preload_libraries TO \'untrusted\';',b'CREATE ROLE postgres;',b'GRANT pg_monitor TO proof_indexer WITH SET TRUE, SET FALSE;',b"ALTER ROLE proof_indexer WITH PASSWORD 'unterminated;"]:
            with self.subTest(suffix=suffix),self.assertRaises(ValueError):C.role_globals(GLOBALS+suffix)

    def test_globals_multiline_literal_meta_command_is_preserved(self):
        suffix=b"COMMENT ON ROLE proof_indexer IS 'before\n\\restrict literal-text\nafter';\n"
        sql,*_=C.role_globals(GLOBALS+suffix)
        self.assertIn(suffix.strip(),sql)
        with self.assertRaises(ValueError):C.role_globals(GLOBALS.replace(b'\\unrestrict fixtureToken',b'\\unrestrict wrongToken'))

    def test_schema_security_owners_acls_defaults_and_body_nonspoofing(self):
        sql=b"""\\restrict token
CREATE FUNCTION proof_indexer.fixture() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
GRANT ALL ON TABLE fake TO attacker;
END;
$$;
ALTER TABLE proof_indexer.events OWNER TO proof_indexer;
GRANT SELECT ON TABLE proof_indexer.events TO reader;
ALTER DEFAULT PRIVILEGES FOR ROLE proof_indexer IN SCHEMA proof_indexer GRANT SELECT ON TABLES TO reader;
\\unrestrict token
"""
        result=C.security_statements(sql)
        self.assertEqual(len(result),3);self.assertFalse(any('attacker' in r for r in result))
        self.assertNotEqual(result,C.security_statements(sql.replace(b'OWNER TO proof_indexer',b'OWNER TO attacker')))
        self.assertNotEqual(result,C.security_statements(sql.replace(b'GRANT SELECT ON TABLE proof_indexer.events TO reader;',b'REVOKE SELECT ON TABLE proof_indexer.events FROM reader;')))
        with self.assertRaises(ValueError):C.security_statements(sql.replace(b'\\unrestrict token',b'\\unrestrict forged'))

    def test_copy_hash_exact_multiset_preserves_duplicates(self):
        a=C.RowHashes();b=C.RowHashes();c=C.RowHashes()
        for r in [b'1\talpha',b'2\tbeta',b'1\talpha']:a.add(r)
        for r in [b'1\talpha',b'1\talpha',b'2\tbeta']:b.add(r)
        for r in [b'1\talpha',b'2\tbeta']:c.add(r)
        self.assertEqual(a.receipt(),b.receipt());self.assertNotEqual(a.receipt(),c.receipt())

    def test_backup_copy_full_inventory_quoted_names_and_sequence(self):
        c=C.BackupCopy()
        for row in [b'COPY "proof_indexer"."events" (event_id, "status") FROM stdin;',b'1\tconfirmed',b'\\.',b"SELECT pg_catalog.setval('proof_indexer.events_event_id_seq', 100, true);"]:c.line(row)
        c.complete();self.assertEqual(c.tables['proof_indexer.events']['columns'],['event_id','status']);self.assertEqual(c.sequences['proof_indexer.events_event_id_seq']['last_value'],100)
        with self.assertRaises(ValueError):c.line(b'COPY public.live (value) FROM stdin;')
        with self.assertRaises(ValueError):c.line(b'COPY proof_indexer.events (event_id, status) FROM stdin;')
        with self.assertRaises(ValueError):C.BackupCopy().complete()

    def test_actual_watchdog_sigkill_during_foreground_is_promptly_detected(self):
        with tempfile.TemporaryDirectory() as td:
            job=Path(td);w=C.Watchdog(job,sample=lambda _:dict(atUtc=C.utc(),fixture=True),interval=.02);w.start()
            runner=C.Runner(job,w);timer=threading.Timer(.15,lambda:os.kill(w.pid,signal.SIGKILL));timer.start();started=time.monotonic()
            try:
                with self.assertRaisesRegex(ValueError,'watchdog lost'):runner.run([sys.executable,'-I','-B','-c','import time;time.sleep(10)'],'fake-work',timeout=20)
                self.assertLess(time.monotonic()-started,2)
                self.assertTrue((job/'storage-samples.jsonl').exists())
                C.durable(job/'failed.json',dict(reason='watchdog-lost',jobRetained=True))
            finally:
                timer.join()
                with self.assertRaises(ValueError):w.stop()
            self.assertTrue((job/'failed.json').exists());self.assertFalse((job/'watchdog-stop-requested.json').exists())

    def test_watchdog_death_during_large_stdin_cannot_hide(self):
        with tempfile.TemporaryDirectory() as td:
            job=Path(td);w=C.Watchdog(job,sample=lambda _:dict(fixture=True),interval=.02);w.start();runner=C.Runner(job,w)
            timer=threading.Timer(.15,lambda:os.kill(w.pid,signal.SIGKILL));timer.start()
            try:
                with self.assertRaisesRegex(ValueError,'watchdog lost'):runner.run([sys.executable,'-I','-B','-c','import time;time.sleep(10)'],'blocked-stdin',stdin=b'x'*(1024**2),timeout=20)
            finally:
                timer.join()
                with self.assertRaises(ValueError):w.stop()

    def test_watchdog_intentional_shutdown_has_no_failure_marker(self):
        with tempfile.TemporaryDirectory() as td:
            job=Path(td);w=C.Watchdog(job,sample=lambda _:dict(fixture=True),interval=.02);w.start();time.sleep(.05);w.assert_alive();w.stop()
            self.assertFalse((job/'resource-failure.json').exists())

    def test_failed_watchdog_cannot_be_blessed_at_completion(self):
        with tempfile.TemporaryDirectory() as td:
            job=Path(td)
            def failure(_):raise ValueError('final-fence storage failure')
            w=C.Watchdog(job,sample=failure,interval=.02);w.start()
            deadline=time.monotonic()+2
            while not (job/'resource-failure.json').exists() and time.monotonic()<deadline:time.sleep(.01)
            self.assertTrue((job/'resource-failure.json').exists())
            with self.assertRaises(ValueError):w.stop()
            self.assertFalse((job/'watchdog-stop-requested.json').exists())

    def test_sample_failure_after_stop_marker_is_not_intentional_success(self):
        with tempfile.TemporaryDirectory() as td:
            job=Path(td)
            def failure_after_marker(_):
                deadline=time.monotonic()+2
                while not (job/'watchdog-stop-requested.json').exists() and time.monotonic()<deadline:time.sleep(.01)
                raise ValueError('storage failure raced with stop marker')
            w=C.Watchdog(job,sample=failure_after_marker,interval=.02);w.start()
            with self.assertRaises(ValueError):w.stop()
            self.assertTrue((job/'resource-failure.json').exists())

    def test_exact_credit_oracle_has_no_float_rounding_or_zero_cap_confusion(self):
        work='d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8'
        source=dict(malformedConfirmedMintAmounts=0,unjoinedConfirmedMintTokens=0,unjoinedNonzeroConfirmedBalances=0,nonintegerOrNonfiniteBalanceRows=0)
        row=dict(tokenId=work,ticker='WORK',balance='210000000000000000000000',minimum='0',noninteger=0,mintedHuman='21000000',maxSupply='21000000')
        self.assertTrue(C.credit_invariants([row],source)['confirmedMintConservation'])
        for field,value in [('balance','209999999999999999999999'),('minimum','-1'),('noninteger',1),('maxSupply','20999999')]:
            bad={**row,field:value}
            with self.subTest(field=field),self.assertRaises(ValueError):C.credit_invariants([bad],source)
        bond=dict(tokenId='a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562',ticker='POWB',balance='1234567890123456789012345678901234567890',minimum='0',noninteger=0,mintedHuman='1234567890123456789012345678901234567890',maxSupply='0')
        self.assertTrue(C.credit_invariants([row,bond],source)['confirmedMintConservation'])
        for bad in [{**bond,'tokenId':'b'*64},{**bond,'ticker':'unapproved-zero-cap'},{**row,'ticker':'fakeWORK'}]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):C.credit_invariants([row,bad] if bad['tokenId']!=work else [bad],source)
        with self.assertRaises(ValueError):C.credit_invariants([bond],source)
        incb={**bond,'tokenId':'3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d','ticker':'INCB'}
        self.assertTrue(C.credit_invariants([row,bond,incb],source)['confirmedMintConservation'])
        with self.assertRaises(ValueError):C.credit_invariants([row,{**incb,'ticker':'POWB'}],source)

    def test_credit_source_population_omissions_cannot_be_hidden(self):
        row=dict(tokenId=C.WORK_TOKEN_ID,ticker='WORK',balance='10000000000000000',minimum='0',noninteger=0,mintedHuman='1',maxSupply='21000000')
        clean=dict(malformedConfirmedMintAmounts=0,unjoinedConfirmedMintTokens=0,unjoinedNonzeroConfirmedBalances=0,nonintegerOrNonfiniteBalanceRows=0)
        for key in clean:
            for value in [1,-1,False,'0',0.0]:
                with self.subTest(key=key,value=value),self.assertRaises(ValueError):C.credit_invariants([row],{**clean,key:value})
            missing=clean.copy();del missing[key]
            with self.assertRaises(ValueError):C.credit_invariants([row],missing)
        with self.assertRaises(ValueError):C.credit_invariants([row],{**clean,'unreviewedException':0})
        with self.assertRaises(ValueError):C.credit_invariants([row],None)

    def test_private_stop_requires_private_identity_and_never_live_pid(self):
        with tempfile.TemporaryDirectory() as td:
            job=Path(td);(job/'cluster').mkdir();(job/'socket').mkdir();(job/'cluster'/'postmaster.pid').write_text('123\n'+str(job/'cluster')+'\n')
            with patch.object(C,'private_postmaster',return_value=dict(pid=123,startTicks=1,dataDirectory=str(job/'cluster'))),patch.object(C,'command') as command:
                with self.assertRaises(ValueError):C.stop_private(job,dict(pid=999,startTicks=1,dataDirectory=str(job/'cluster')))
                command.assert_not_called();C.stop_private(job,None);self.assertIn(str(job/'cluster'),command.call_args[0][0])


if __name__=='__main__':unittest.main()
