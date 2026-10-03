#!/usr/bin/python3 -I
import hashlib, importlib.util, json, os, stat, tempfile, time, unittest
from pathlib import Path
from unittest import mock

PATH = Path('/tmp/pow-audit30-retirement-cluster-closure-v1.py')
spec = importlib.util.spec_from_file_location('closure', PATH)
C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)


def mountline(device='0:1', root='/', point='/'):
    return f'1 0 {device} {root} {point} rw - ext4 /dev/fake rw\n'.encode()


def proc_stat(start=123, flags=0):
    tail = [b'S'] + [b'0'] * 19
    tail[6] = str(flags).encode(); tail[19] = str(start).encode()
    return b'123 (name with ) parentheses) ' + b' '.join(tail)


class ClosureTests(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory(prefix='pow-audit30-closure-fixture-')
        self.base = Path(self.t.name); self.cluster = self.base / 'cluster'; self.cluster.mkdir(mode=0o700)
        self.file = self.cluster / 'data'; self.file.write_bytes(b'\x00\xffexact\n'); self.file.chmod(0o600)
        self.pg = mock.patch.multiple(C, PG_UID=os.geteuid(), PG_GID=os.getegid(), DEADLINE=time.monotonic() + 60)
        self.pg.start(); self.tick = mock.patch.object(C, 'periodic', lambda: C.tick()); self.tick.start()
        self.device = f'{os.major(self.file.stat().st_dev)}:{os.minor(self.file.stat().st_dev)}'
        self.mount = mountline(self.device)

    def tearDown(self):
        self.tick.stop(); self.pg.stop(); self.t.cleanup()

    def records(self):
        return C.walk(self.cluster, self.mount)

    def plan(self):
        return {'schema': 'pow-audit30-retirement-content-readonly-plan-v1', 'approvalSha256': C.APPROVAL,
                'host': C.HOST, 'unit': 'proofofwork-audit30-retirement-content-20261003T050000Z.service',
                'rootBeforeSha256': 'a' * 64, 'liveFive': {k: {} for k in C.LIVE},
                'targets': [{'path': p, 'metadataSha256': 'b' * 64} for p in C.TARGETS]}

    def fake_proc(self):
        proc = self.base / 'proc'; (proc / 'self').mkdir(parents=True); (proc / 'self/mountinfo').write_bytes(self.mount)
        p = proc / '123'; p.mkdir(); (p / 'stat').write_bytes(proc_stat()); (p / 'cmdline').write_bytes(b'/bin/sleep\x0010\x00')
        (p / 'maps').write_bytes(b''); (p / 'mountinfo').write_bytes(self.mount); (p / 'fd').mkdir(); (p / 'ns').mkdir()
        for key in ('cwd', 'root', 'exe'): (p / key).symlink_to('/unrelated')
        (p / 'ns/mnt').symlink_to('mnt:[1]')
        return proc, p

    def readers(self, proc):
        with mock.patch.object(C, 'TARGETS', (str(self.cluster), '/fixed/old.dumpset')):
            return C.proc_readers({str(self.cluster): self.records()}, proc)

    def test_exact_regular_bytes_noatime(self):
        os.utime(self.file, ns=(1, self.file.stat().st_mtime_ns)); before = C.metadata(self.file)
        self.assertEqual(C.read_hash(self.file, before), hashlib.sha256(self.file.read_bytes()).hexdigest())
        # read_bytes above is allowed to advance atime; hash alone was fenced without atime.
        self.assertEqual(C.metadata(self.file), before)

    def test_hash_does_not_advance_atime(self):
        os.utime(self.file, ns=(1, self.file.stat().st_mtime_ns)); before = self.file.stat().st_atime_ns
        C.read_hash(self.file, C.metadata(self.file)); self.assertEqual(self.file.stat().st_atime_ns, before)

    def test_symlink_refused(self):
        (self.cluster / 'link').symlink_to('data')
        with self.assertRaises(C.Refused): self.records()

    def test_hardlink_refused(self):
        os.link(self.file, self.base / 'shared')
        with self.assertRaises(C.Refused): self.records()

    def test_unsafe_mode_refused(self):
        self.file.chmod(0o622)
        with self.assertRaises(C.Refused): self.records()

    def test_xattr_refused(self):
        with mock.patch.object(C.os, 'listxattr', return_value=['user.unique']):
            with self.assertRaises(C.Refused): self.records()

    def test_entry_bound_refused(self):
        with mock.patch.object(C, 'MAX_ENTRIES', 1):
            with self.assertRaises(C.Refused): self.records()

    def test_nested_mount_refused(self):
        with self.assertRaises(C.Refused): C.walk(self.cluster, self.mount + mountline(self.device, '/', str(self.cluster / 'data')))

    def test_hash_metadata_drift(self):
        row = C.metadata(self.file); self.file.write_bytes(b'changed')
        with self.assertRaises(C.Refused): C.read_hash(self.file, row)

    def test_hash_midread_drift(self):
        original = C.os.read; changed = False
        def read(fd, cap):
            nonlocal changed
            result = original(fd, cap)
            if result and not changed:
                changed = True; self.file.write_bytes(b'changed!')
            return result
        with mock.patch.object(C.os, 'read', read):
            with self.assertRaises(C.Refused): C.read_hash(self.file, C.metadata(self.file))

    def test_full_tree_stable_manifest(self):
        a = self.records(); b = self.records(); self.assertEqual(a, b)
        self.assertEqual(C.allocation(a)['regularBytes'], 8)

    def test_mount_ancestor_alias(self):
        host = C.mounts(mountline('8:1', '/', '/data'))
        other = C.mounts(mountline('8:1', '/', '/alias'))
        matches = C.mount_aliases(host, other, ['/data/job/cluster'])
        self.assertEqual(matches[0]['kind'], 'ancestor-mount-alias')

    def test_mount_subtree_alias(self):
        host = C.mounts(mountline('8:1', '/', '/data'))
        other = C.mounts(mountline('8:1', '/job/cluster/base', '/alias'))
        self.assertEqual(C.mount_aliases(host, other, ['/data/job/cluster'])[0]['kind'], 'subtree-mount-alias')

    def test_canonical_mount_not_alias(self):
        host = C.mounts(mountline('8:1', '/', '/data'))
        self.assertEqual(C.mount_aliases(host, host, ['/data/job/cluster']), [])

    def test_namespace_escape_decoded(self):
        self.assertEqual(C.mounts(mountline('8:1', '/', '/space\\040path'))[0]['mountpoint'], '/space path')

    def test_proc_unrelated_complete(self):
        proc, _ = self.fake_proc(); out = self.readers(proc)
        self.assertFalse(out['candidateReadersObserved']); self.assertTrue(out['completeForObservedLiveProcesses'])

    def test_proc_fd_direct_candidate(self):
        proc, p = self.fake_proc(); (p / 'fd/3').symlink_to(self.file)
        out = self.readers(proc); self.assertTrue(out['candidateReadersObserved'])
        self.assertEqual(out['matches'][0]['surface'], 'fd/3')

    def test_proc_fd_inode_alias(self):
        proc, p = self.fake_proc(); fd = os.open(self.file, os.O_RDONLY)
        try:
            (p / 'fd/3').symlink_to('/proc/self/fd/' + str(fd))
            out = self.readers(proc); self.assertTrue(out['candidateReadersObserved'])
            self.assertEqual(out['matches'][0]['targets'], [str(self.cluster)])
        finally: os.close(fd)

    def test_proc_map_inode_only(self):
        proc, p = self.fake_proc(); s = self.file.stat()
        (p / 'maps').write_text(f'0-1 r--p 0000 {os.major(s.st_dev):02x}:{os.minor(s.st_dev):02x} {s.st_ino} /alias\n')
        self.assertEqual(self.readers(proc)['matches'][0]['surface'], 'maps')

    def test_proc_cmdline_candidate(self):
        proc, p = self.fake_proc(); (p / 'cmdline').write_bytes(b'postgres\x00-D\x00' + str(self.cluster).encode() + b'\x00')
        self.assertEqual(self.readers(proc)['matches'][0]['surface'], 'cmdline')

    def test_proc_permission_denial_is_not_absence(self):
        proc, p = self.fake_proc(); readlink = C.os.readlink
        def deny(path):
            if Path(path) == p / 'cwd': raise PermissionError('fixture')
            return readlink(path)
        with mock.patch.object(C.os, 'readlink', deny):
            with self.assertRaises(C.Refused): self.readers(proc)

    def test_proc_live_surface_missing_is_not_absence(self):
        proc, p = self.fake_proc(); (p / 'exe').unlink()
        with self.assertRaises(C.Refused): self.readers(proc)

    def test_proc_metadata_cap(self):
        proc, p = self.fake_proc(); (p / 'cmdline').write_bytes(b'x' * 100)
        with mock.patch.object(C, 'MAX_PROC_FILE', 32):
            with self.assertRaises(C.Refused): self.readers(proc)

    def test_kernel_thread_qualification(self):
        proc, p = self.fake_proc(); (p / 'stat').write_bytes(proc_stat(flags=0x200000)); (p / 'cmdline').write_bytes(b'')
        out = self.readers(proc); self.assertEqual(out['qualifiedKernelThreads'], 1)
        (p / 'cmdline').write_bytes(b'not-kernel')
        with self.assertRaises(C.Refused): self.readers(proc)

    def test_deleted_pointer_matches(self):
        self.assertEqual(C.pointer_hits(str(self.file) + ' (deleted)', [str(self.cluster)]), [str(self.cluster)])
        self.assertEqual(C.pointer_hits(str(self.cluster) + '-other', [str(self.cluster)]), [])

    def test_plan_exact_order_and_scope(self):
        plan = self.plan(); C.validate_plan(plan); plan['targets'].reverse()
        with self.assertRaises(C.Refused): C.validate_plan(plan)

    def test_plan_duplicate_scope_refused(self):
        plan = self.plan(); plan['targets'][1] = plan['targets'][0].copy()
        with self.assertRaises(C.Refused): C.validate_plan(plan)

    def test_plan_new_path_and_fields_refused(self):
        plan = self.plan(); plan['targets'][0]['path'] = '/data/live'
        with self.assertRaises(C.Refused): C.validate_plan(plan)
        plan = self.plan(); plan['apply'] = True
        with self.assertRaises(C.Refused): C.validate_plan(plan)

    def test_plan_calendar_refused(self):
        plan = self.plan(); plan['unit'] = 'proofofwork-audit30-retirement-content-20260230T050000Z.service'
        with self.assertRaises((C.Refused, ValueError)): C.validate_plan(plan)

    def test_duplicate_json_refused(self):
        with self.assertRaises(C.Refused): C.parse(b'{"a":1,"a":2}')

    def test_retained_evidence_hashes_every_noncluster_file(self):
        evidence = self.base / 'receipt.json'; evidence.write_bytes(b'{"historical":true}'); evidence.chmod(0o600)
        out = C.retained_evidence(str(self.base), self.mount)
        self.assertEqual([r['path'] for r in out['fullFileHashes']], [str(evidence)])
        self.assertTrue(out['allThesePathsMustSurviveAnyClusterOnlyRetirement'])
        self.assertNotIn(str(self.file), [r['path'] for r in out['metadataRecords']])

    def test_retained_evidence_byte_bound(self):
        evidence = self.base / 'receipt'; evidence.write_bytes(b'long evidence'); evidence.chmod(0o600)
        with mock.patch.object(C, 'MAX_RETAINED_EVIDENCE_BYTES', 1):
            with self.assertRaises(C.Refused): C.retained_evidence(str(self.base), self.mount)

    def test_runtime_refuses_weak_unit_before_hash(self):
        plan = self.plan()
        with mock.patch.object(C.os, 'geteuid', return_value=108), mock.patch.object(C.os, 'getegid', return_value=112), \
             mock.patch.object(C.Path, 'read_text', return_value='0::/system.slice/' + plan['unit'] + '\n'), \
             mock.patch.object(C, 'properties', return_value={'MemoryMax': 'infinity'}):
            with self.assertRaises(C.Refused): C.hash_runtime(plan)

    def test_runtime_refuses_wrong_role(self):
        with mock.patch.object(C.os, 'geteuid', return_value=0):
            with self.assertRaises(C.Refused): C.hash_runtime(self.plan())

    def test_source_has_no_mutator_entrypoint(self):
        raw = PATH.read_text()
        for token in ('os.unlink(', 'os.rename(', 'os.chmod(', 'os.chown(', 'pg_ctl', "'start'", "'stop'", 'CREATE DATABASE', 'DELETE FROM'):
            self.assertNotIn(token, raw)


if __name__ == '__main__': unittest.main()
