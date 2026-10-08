#!/usr/bin/env python3
"""Offline storage custody/retirement tests; never contact production.

Fixtures use this process's numeric owner and temporary paths. Production
proposal and direct-approval hashes remain immutable controller constants.
"""
import copy
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


export = load('pages_ui_storage_export', 'ui-storage-export.py')


class ApprovalTests(unittest.TestCase):
    def setUp(self):
        self.proposal = {'schema': 'proof-of-work-pages-ui-storage-proposal-v1',
            'status': 'proposal-only-unapproved',
            'selectedRoots': [{'root': path} for path in export.ROOT_PATHS],
            'protected': {'current': {'root': export.LIVE}, 'immediatePrior': {'root': export.PRIOR}}}

    def approve(self, proposal_sha):
        return {'schema': 'proof-of-work-pages-ui-storage-human-approval-v1',
            'authority': 'direct-human-user-reply-in-current-Codex-conversation',
            'answer': 'Approve this exact plan', 'proposalSha256': proposal_sha,
            'selectedRootPaths': list(export.ROOT_PATHS)}

    def test_production_hashes_and_exact_five_paths_are_immutable(self):
        self.assertEqual(export.PROPOSAL_SHA, 'b7ec857468f3c425fa9bed1f366bf2313536913e3d62b18a8246ccd29f68f591')
        self.assertEqual(export.APPROVAL_SHA, '4971f117af5947b69014583a1c3194b25d27147dfaa5f1b3defd40c64ba11385')
        self.assertEqual(export.ROOT_PATHS, [
            '/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-01ec4968caa9-20261007T150110Z',
            '/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-13ddf6d7f401-20261007T030045Z',
            '/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-19cc93a7c97f-20261007T161406Z',
            '/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-471a30c41991-20261004T122500Z',
            '/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-7bad9495d118-20261006T180919Z'])
        self.assertNotIn(export.LIVE, export.ROOT_PATHS)
        self.assertNotIn(export.PRIOR, export.ROOT_PATHS)

    def test_valid_shape_with_wrong_raw_hash_never_authorizes(self):
        for validator, value in ((export.validate_proposal, self.proposal),
                                 (export.validate_approval, self.approve(export.PROPOSAL_SHA))):
            with self.assertRaises(ValueError): validator(export.encoded(value))

    def test_hash_bound_portable_shape_has_exact_scope(self):
        raw = export.encoded(self.proposal); proposal_sha = export.digest(raw)
        approval = self.approve(proposal_sha); approval_raw = export.encoded(approval)
        with patch.object(export, 'PROPOSAL_SHA', proposal_sha), patch.object(export, 'APPROVAL_SHA', export.digest(approval_raw)):
            self.assertEqual(export.validate_proposal(raw), self.proposal)
            self.assertEqual(export.validate_approval(approval_raw), approval)

    def test_extra_missing_duplicate_reordered_or_foreign_root_refuses(self):
        for mutation in ('extra', 'missing', 'duplicate', 'reordered', 'foreign'):
            with self.subTest(mutation=mutation):
                proposal = copy.deepcopy(self.proposal)
                roots = proposal['selectedRoots']
                if mutation == 'extra': roots.append({'root': '/var/backups/unapproved'})
                elif mutation == 'missing': roots.pop()
                elif mutation == 'duplicate': roots[0] = roots[1]
                elif mutation == 'reordered': roots.reverse()
                else: roots[0]['root'] = '/var/www'
                raw = export.encoded(proposal)
                with patch.object(export, 'PROPOSAL_SHA', export.digest(raw)):
                    with self.assertRaises(ValueError): export.validate_proposal(raw)

    def test_changed_current_or_immediate_prior_pair_refuses(self):
        for name in ('current', 'immediatePrior'):
            with self.subTest(name=name):
                proposal = copy.deepcopy(self.proposal)
                proposal['protected'][name]['root'] = export.ROOT_PATHS[0]
                raw = export.encoded(proposal)
                with patch.object(export, 'PROPOSAL_SHA', export.digest(raw)):
                    with self.assertRaises(ValueError): export.validate_proposal(raw)

    def test_direct_approval_cannot_change_answer_authority_hash_or_scope(self):
        for field, value in (('answer', 'Approve a broader plan'), ('authority', 'automated-agent'),
                             ('proposalSha256', '0' * 64), ('selectedRootPaths', [export.LIVE])):
            with self.subTest(field=field):
                approval = self.approve(export.PROPOSAL_SHA); approval[field] = value
                raw = export.encoded(approval)
                with patch.object(export, 'APPROVAL_SHA', export.digest(raw)):
                    with self.assertRaises(ValueError): export.validate_approval(raw)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pages-ui-storage-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name)
        self.root = self.base / 'retained'
        self.root.mkdir(mode=0o750)
        (self.root / 'assets').mkdir(mode=0o710)
        (self.root / 'passthrough').mkdir(mode=0o750)
        (self.root / '.proofofwork-ui-release').write_bytes(b'{"releaseId":"older-accepted-root"}\n')
        self.source = self.root / 'assets' / 'index.js'
        self.source.write_bytes(b'// exact accepted source\n' + bytes(range(256)) * 257)
        self.link = self.root / 'passthrough' / 'shared.js'
        os.link(self.source, self.link)
        (self.root / 'passthrough' / 'unmanaged.bin').write_bytes(bytes(range(255, -1, -1)))
        (self.root / '.proofofwork-ui-release').chmod(0o644)
        (self.root / 'passthrough' / 'unmanaged.bin').chmod(0o644)
        os.setxattr(self.source, 'user.proof.pages', b'accepted\x00metadata\xff')
        self.source.chmod(0o440)
        os.setxattr(self.root, 'user.proof.root', b'root-custody')
        self.atime = 1700000000123456789
        self.mtime = 1700000000987654321
        for path in (self.root / '.proofofwork-ui-release', self.source,
                     self.root / 'passthrough' / 'unmanaged.bin',
                     self.root / 'assets', self.root / 'passthrough', self.root):
            os.utime(path, ns=(self.atime, self.mtime))
        self.expected = self.expected_root(self.root)

    def expected_root(self, root):
        observed = export.inventory(root, owner=os.geteuid())
        return {**observed['fingerprint'], 'inventory': observed['records']}

    def archive(self, expected=None):
        sink = io.BytesIO()
        receipt = export.archive_root(self.root, expected or self.expected, sink, owner=os.geteuid())
        raw = sink.getvalue()
        path = self.base / ('archive-' + str(len(list(self.base.glob('archive-*')))) + '.tar.gz')
        path.write_bytes(raw)
        return path, raw, receipt

    def assert_refused(self, callback):
        with self.assertRaises((ValueError, OSError, EOFError, tarfile.TarError)):
            callback()

    def test_actual_archive_restore_preserves_every_record_and_metadata(self):
        archive, raw, receipt = self.archive()
        self.assertEqual(receipt['archiveSha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(receipt['archiveBytes'], len(raw))
        self.assertGreater(receipt['archiveBytes'], 0)
        restored = self.base / 'restored'
        export.extract_verify(archive, self.expected, restored, owner_required=True)
        for original in self.expected['inventory']:
            path = restored if original['path'] == '.' else restored / original['path']
            info = path.lstat()
            expected = original['identity']
            self.assertEqual(stat.S_IMODE(info.st_mode), stat.S_IMODE(expected['st_mode']))
            self.assertEqual(info.st_uid, expected['st_uid'])
            self.assertEqual(info.st_gid, expected['st_gid'])
            self.assertEqual(info.st_atime_ns, expected['st_atime_ns'])
            self.assertEqual(info.st_mtime_ns, expected['st_mtime_ns'])
            self.assertEqual(set(os.listxattr(path)), {row[0] for row in original['xattrs']})
        restored_source = restored / 'assets' / 'index.js'
        restored_link = restored / 'passthrough' / 'shared.js'
        self.assertEqual(restored_source.stat().st_ino, restored_link.stat().st_ino)
        self.assertEqual(restored_source.stat().st_nlink, 2)
        self.assertNotEqual(restored_source.stat().st_ino, self.source.stat().st_ino)
        self.assertEqual(os.getxattr(restored_source, 'user.proof.pages'), b'accepted\x00metadata\xff')
        self.assertEqual(os.getxattr(restored, 'user.proof.root'), b'root-custody')
        self.assertEqual((restored / 'passthrough' / 'unmanaged.bin').read_bytes(), bytes(range(255, -1, -1)))
        self.assertEqual((restored / '.proofofwork-ui-release').read_bytes(), b'{"releaseId":"older-accepted-root"}\n')

    def test_inventory_never_changes_source_access_or_modification_time(self):
        paths = [self.root if row['path'] == '.' else self.root / row['path'] for row in self.expected['inventory']]
        before = {p: (p.lstat().st_atime_ns, p.lstat().st_mtime_ns) for p in paths}
        current = export.inventory(self.root, owner=os.geteuid())
        export.assert_inventory(current, self.expected, exact_identity=True)
        after = {p: (p.lstat().st_atime_ns, p.lstat().st_mtime_ns) for p in before}
        self.assertEqual(after, before)

    def test_content_drift_refuses_before_archive_output(self):
        self.source.chmod(0o640)
        self.source.write_bytes(b'changed accepted runtime')
        sink = io.BytesIO()
        self.assert_refused(lambda: export.archive_root(self.root, self.expected, sink, owner=os.geteuid()))
        self.assertEqual(sink.getvalue(), b'')

    def test_metadata_drift_refuses_before_archive_output(self):
        for change in ('mode', 'timestamp', 'xattr'):
            with self.subTest(change=change):
                before = self.expected_root(self.root)
                if change == 'mode': self.source.chmod(0o600)
                elif change == 'timestamp': os.utime(self.source, ns=(self.atime, self.mtime + 1))
                else: os.setxattr(self.source, 'user.proof.extra', b'drift')
                sink = io.BytesIO()
                self.assert_refused(lambda: export.archive_root(self.root, before, sink, owner=os.geteuid()))
                self.assertEqual(sink.getvalue(), b'')

    def test_same_bytes_replaced_inode_does_not_pass_source_identity_fence(self):
        replacement = self.root / 'assets' / 'replacement'
        original, _ = export.read_regular(self.source)
        replacement.write_bytes(original)
        os.setxattr(replacement, 'user.proof.pages', b'accepted\x00metadata\xff')
        replacement.chmod(0o440)
        os.utime(replacement, ns=(self.atime, self.mtime))
        os.replace(replacement, self.source)
        current = export.inventory(self.root, owner=os.geteuid())
        export.assert_inventory(current, self.expected, exact_identity=False)
        self.assert_refused(lambda: export.assert_inventory(current, self.expected, exact_identity=True))

    def test_added_or_removed_passthrough_member_refuses(self):
        for change in ('extra', 'missing'):
            with self.subTest(change=change):
                if change == 'extra': (self.root / 'unapproved').write_bytes(b'unapproved')
                else: (self.root / 'passthrough' / 'unmanaged.bin').unlink()
                self.assert_refused(lambda: export.assert_inventory(export.inventory(self.root, owner=os.geteuid()),
                                                                   self.expected, exact_identity=True))

    def test_external_hardlink_is_never_archivable_as_closed_custody(self):
        os.link(self.source, self.base / 'outside-selected-root')
        expected = self.expected_root(self.root)
        sink = io.BytesIO()
        self.assert_refused(lambda: export.archive_root(self.root, expected, sink, owner=os.geteuid()))
        self.assertEqual(sink.getvalue(), b'')

    def test_symlink_or_special_file_refuses_without_following(self):
        outside = self.base / 'outside'; outside.write_bytes(b'preserve')
        os.symlink(outside, self.root / 'symlink')
        self.assert_refused(lambda: export.inventory(self.root, owner=os.geteuid()))
        (self.root / 'symlink').unlink()
        os.mkfifo(self.root / 'special')
        self.assert_refused(lambda: export.inventory(self.root, owner=os.geteuid()))
        self.assertEqual(outside.read_bytes(), b'preserve')

    def test_root_symlink_and_wrong_numeric_owner_refuse(self):
        alias = self.base / 'root-alias'
        alias.symlink_to(self.root, target_is_directory=True)
        self.assert_refused(lambda: export.inventory(alias, owner=os.geteuid()))
        self.assert_refused(lambda: export.inventory(self.root, owner=os.geteuid() + 1))

    def test_archive_stream_failure_keeps_original_root_and_no_success_receipt(self):
        class InterruptedSink:
            def write(self, value):
                raise OSError('fixture stream interrupted')
            def flush(self): pass
        with self.assertRaises(OSError):
            export.archive_root(self.root, self.expected, InterruptedSink(), owner=os.geteuid())
        export.assert_inventory(export.inventory(self.root, owner=os.geteuid()), self.expected, exact_identity=True)

    def test_changed_root_while_streaming_is_not_valid_custody(self):
        source = self.root
        class ChangingSink(io.BytesIO):
            def write(inner, value):
                if inner.tell() == 0:
                    os.setxattr(source, 'user.proof.during-export', b'changed')
                return super().write(value)
        self.assert_refused(lambda: export.archive_root(self.root, self.expected, ChangingSink(), owner=os.geteuid()))

    def test_truncated_archive_never_claims_verified_restoration(self):
        archive, raw, _ = self.archive()
        archive.write_bytes(raw[:len(raw) // 2])
        self.assert_refused(lambda: export.extract_verify(archive, self.expected, self.base / 'truncated-restore'))

    def test_valid_gzip_with_corrupted_file_content_cannot_verify(self):
        archive, _, _ = self.archive()
        corrupted = self.base / 'corrupted-content.tar.gz'
        with tarfile.open(archive, 'r:gz') as source, tarfile.open(corrupted, 'w:gz', format=tarfile.PAX_FORMAT) as sink:
            for row in source:
                data = source.extractfile(row).read() if row.isfile() else None
                if row.name == 'assets/index.js': data = b'X' + data[1:]
                sink.addfile(row, io.BytesIO(data) if data is not None else None)
        self.assert_refused(lambda: export.extract_verify(corrupted, self.expected, self.base / 'corrupt-restore'))

    def test_duplicate_expected_member_is_not_accepted_as_complete_archive(self):
        archive, _, _ = self.archive()
        duplicate = self.base / 'duplicate-member.tar.gz'
        with tarfile.open(archive, 'r:gz') as source, tarfile.open(duplicate, 'w:gz', format=tarfile.PAX_FORMAT) as sink:
            for row in source:
                data = source.extractfile(row).read() if row.isfile() else None
                sink.addfile(row, io.BytesIO(data) if data is not None else None)
                if row.name == '.proofofwork-ui-release': sink.addfile(row, io.BytesIO(data))
        self.assert_refused(lambda: export.extract_verify(duplicate, self.expected, self.base / 'duplicate-restore'))

    def test_restore_requires_fresh_output_and_does_not_overwrite_custody(self):
        archive, _, _ = self.archive()
        output = self.base / 'existing'; output.mkdir()
        marker = output / 'preserve'; marker.write_bytes(b'existing evidence')
        self.assert_refused(lambda: export.extract_verify(archive, self.expected, output))
        self.assertEqual(marker.read_bytes(), b'existing evidence')

    def test_tampered_expected_bytes_or_metadata_cannot_verify(self):
        archive, _, _ = self.archive()
        for change in ('sha256', 'mtime', 'xattr'):
            with self.subTest(change=change):
                expected = copy.deepcopy(self.expected)
                row = next(x for x in expected['inventory'] if x['path'] == 'assets/index.js')
                if change == 'sha256': row['sha256'] = '0' * 64
                elif change == 'mtime': row['identity']['st_mtime_ns'] += 1
                else: row['xattrs'] = []
                self.assert_refused(lambda: export.extract_verify(archive, expected, self.base / ('tampered-' + change)))

    def test_malicious_archive_members_never_escape_fresh_output(self):
        outside = self.base / 'escaped'
        for kind in ('traversal', 'absolute', 'symlink', 'hardlink', 'fifo', 'duplicate'):
            with self.subTest(kind=kind):
                archive = self.base / ('malicious-' + kind + '.tar.gz')
                with tarfile.open(archive, 'w:gz', format=tarfile.PAX_FORMAT) as stream:
                    member = tarfile.TarInfo('../escaped' if kind == 'traversal' else str(outside) if kind == 'absolute' else 'unapproved')
                    if kind == 'symlink': member.type = tarfile.SYMTYPE; member.linkname = str(outside)
                    elif kind == 'hardlink': member.type = tarfile.LNKTYPE; member.linkname = '../escaped'
                    elif kind == 'fifo': member.type = tarfile.FIFOTYPE
                    else: member.size = 5
                    stream.addfile(member, io.BytesIO(b'owned') if member.isfile() else None)
                    if kind == 'duplicate': stream.addfile(member, io.BytesIO(b'owned'))
                self.assert_refused(lambda: export.extract_verify(archive, self.expected, self.base / ('malicious-output-' + kind)))
                self.assertFalse(outside.exists())


class CustodyTests(unittest.TestCase):
    """Exercise local custody orchestration with a fully local export stream."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pages-ui-custody-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name)
        self.sources = self.base / 'sources'; self.sources.mkdir(mode=0o700)
        rows = []
        for index, name in enumerate(export.ROOT_NAMES):
            root = self.sources / name; root.mkdir(mode=0o750)
            for filename, content in (('.proofofwork-ui-release', b'{"old":true}\n'),
                                      ('unmanaged.bin', bytes([index]) * 73)):
                path = root / filename; path.write_bytes(content); path.chmod(0o640)
                os.utime(path, ns=(1700000000123456789, 1700000000987654321))
            os.setxattr(root / 'unmanaged.bin', 'user.proof.custody', bytes([index, 0, 255]))
            os.utime(root, ns=(1700000000123456789, 1700000000987654321))
            current = export.inventory(root, owner=os.geteuid())
            rows.append({**current['fingerprint'], 'inventory': current['records']})
        self.proposal = {'schema': 'proof-of-work-pages-ui-storage-proposal-v1',
            'status': 'proposal-only-unapproved', 'selectedRoots': rows,
            'protected': {'current': {'root': export.LIVE}, 'immediatePrior': {'root': export.PRIOR}}}
        self.proposal_raw = export.encoded(self.proposal)
        self.proposal_sha = export.digest(self.proposal_raw)
        self.approval = {'schema': 'proof-of-work-pages-ui-storage-human-approval-v1',
            'authority': 'direct-human-user-reply-in-current-Codex-conversation',
            'answer': 'Approve this exact plan', 'proposalSha256': self.proposal_sha,
            'selectedRootPaths': [r['root'] for r in rows]}
        self.approval_raw = export.encoded(self.approval)
        for name, value in (('PROPOSAL_SHA', self.proposal_sha),
                            ('APPROVAL_SHA', export.digest(self.approval_raw)),
                            ('ROOT_PATHS', self.approval['selectedRootPaths'])):
            handle = patch.object(export, name, value); handle.start(); self.addCleanup(handle.stop)
        self.proposal_path = self.base / 'proposal.json'; self.proposal_path.write_bytes(self.proposal_raw)
        self.approval_path = self.base / 'approval.json'; self.approval_path.write_bytes(self.approval_raw)
        self.output = self.base / 'custody'
        self.calls = 0

    def local_process(self, args, **kwargs):
        """Replace SSH transport only; exercise the actual bounded archiver."""
        self.assertEqual(args[:len(export.SSH)], export.SSH)
        row = self.proposal['selectedRoots'][self.calls]; self.calls += 1
        owner = self
        class Process:
            returncode = 0
            def communicate(inner, program, timeout):
                with os.fdopen(os.dup(kwargs['stdout']), 'wb') as stream:
                    receipt = export.archive_root(row['root'], row, stream, owner=os.geteuid())
                receipt.update(schema='proof-of-work-pages-ui-export-v1', proposalSha256=export.PROPOSAL_SHA,
                               approvalSha256=export.APPROVAL_SHA, sourceRoot=row['root'])
                return None, export.encoded(receipt)
            def kill(inner): owner.fail('Unexpected automatic transport kill')
            def wait(inner, **unused): return 0
        return Process()

    def exported(self):
        with patch.object(export.subprocess, 'Popen', side_effect=self.local_process), contextlib.redirect_stdout(io.StringIO()):
            result = export.export_all(self.proposal_path, self.approval_path, self.output)
        self.assertEqual(self.calls, 5)
        return result

    def verify(self):
        with contextlib.redirect_stdout(io.StringIO()): return export.verify_all(self.output)

    def test_all_five_verified_archives_have_source_and_restoration_custody(self):
        index = self.exported(); custody = self.verify()
        self.assertEqual(len(index['exports']), 5)
        self.assertEqual(len(custody['restorations']), 5)
        self.assertEqual(custody['exportIndexSha256'], export.digest((self.output / 'export-index.json').read_bytes()))
        self.assertEqual(custody['restorationRecipeSha256'], export.digest((self.output / 'restoration-recipe.json').read_bytes()))
        self.assertEqual(custody['exports'], index['exports'])
        for expected, receipt in zip(self.proposal['selectedRoots'], custody['restorations']):
            self.assertEqual(receipt['sourceRoot'], expected['root'])
            self.assertEqual(receipt['inventorySha256'], export.inventory_sha(expected['inventory']))
            self.assertTrue(receipt['ownerRestored'] and receipt['modeTimesXattrsRestored'] and receipt['internalHardlinksRestored'])
        with self.assertRaises(ValueError): self.verify()
        self.assertTrue((self.output / 'custody.json').is_file())

    def test_saved_archive_drift_cannot_create_custody_receipt(self):
        index = self.exported()
        archive = pathlib.Path(index['exports'][0]['archivePath'])
        archive.write_bytes(archive.read_bytes() + b'changed after export')
        with self.assertRaises(ValueError): self.verify()
        self.assertFalse((self.output / 'custody.json').exists())
        self.assertTrue(archive.exists())

    def test_exporter_source_drift_cannot_create_custody_receipt(self):
        self.exported()
        (self.output / 'exporter.py').write_bytes(b'changed verifier')
        with self.assertRaises(ValueError): self.verify()
        self.assertFalse((self.output / 'custody.json').exists())

    def test_reordered_export_identity_never_becomes_custody(self):
        index = self.exported(); index['exports'].reverse()
        (self.output / 'export-index.json').write_bytes(export.encoded(index))
        with self.assertRaises(ValueError): self.verify()
        self.assertFalse((self.output / 'custody.json').exists())

    def test_partial_restoration_keeps_evidence_and_refuses_automatic_retry(self):
        self.exported(); original = export.extract_verify; calls = []
        def fail_second(*args, **kwargs):
            calls.append(args)
            if len(calls) == 2: raise OSError('fixture restoration interrupted')
            return original(*args, **kwargs)
        with patch.object(export, 'extract_verify', side_effect=fail_second):
            with self.assertRaises(OSError): self.verify()
        self.assertFalse((self.output / 'custody.json').exists())
        self.assertTrue((self.output / (export.ROOT_NAMES[0] + '.restoration.json')).exists())
        with self.assertRaises(ValueError): self.verify()
        self.assertEqual(len(list(self.output.glob('*.tgz'))), 5)

    def test_failed_export_preserves_partial_stream_and_refuses_automatic_retry(self):
        def fail_second(args, **kwargs):
            if self.calls == 0: return self.local_process(args, **kwargs)
            self.calls += 1
            class FailedProcess:
                returncode = 1
                def communicate(inner, program, timeout):
                    os.write(kwargs['stdout'], b'partial failed archive')
                    return None, b'fixture bounded exporter failure\n'
            return FailedProcess()
        with patch.object(export.subprocess, 'Popen', side_effect=fail_second), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(ValueError): export.export_all(self.proposal_path, self.approval_path, self.output)
            with self.assertRaises(ValueError): export.export_all(self.proposal_path, self.approval_path, self.output)
        self.assertEqual(self.calls, 2)
        self.assertFalse((self.output / 'export-index.json').exists())
        self.assertFalse((self.output / 'custody.json').exists())
        self.assertEqual((self.output / (export.ROOT_NAMES[1] + '.tgz')).read_bytes(), b'partial failed archive')
        self.assertEqual((self.output / '1.export.stderr').read_bytes(), b'fixture bounded exporter failure\n')
        for row in self.proposal['selectedRoots']:
            export.assert_inventory(export.inventory(row['root'], owner=os.geteuid()), row)

    def test_exclusive_evidence_write_never_overwrites_or_follows_symlink(self):
        path = self.base / 'immutable.json'
        export.save_new(path, b'first complete evidence')
        with self.assertRaises(FileExistsError): export.save_new(path, b'replacement')
        self.assertEqual(path.read_bytes(), b'first complete evidence')
        link = self.base / 'evidence-alias'; link.symlink_to(path)
        with self.assertRaises(OSError): export.save_new(link, b'replacement')
        self.assertEqual(path.read_bytes(), b'first complete evidence')

    def test_mount_at_root_or_below_root_refuses(self):
        mountinfo = self.base / 'mountinfo'
        mountinfo.write_text('25 1 8:1 / / rw - ext4 /dev/fixture rw\n')
        paths = self.approval['selectedRootPaths']
        self.assertEqual(export.no_mounts(paths, mountinfo), export.digest(mountinfo.read_bytes()))
        for mount in (paths[0], paths[0] + '/nested'):
            mountinfo.write_text('25 1 8:1 / / rw - ext4 /dev/fixture rw\n26 25 0:1 / ' + mount + ' rw - tmpfs fixture rw\n')
            with self.assertRaises(ValueError): export.no_mounts(paths, mountinfo)


class GlobalFenceTests(unittest.TestCase):
    """Use real trees/holds/helpers while replacing only root identity/systemctl."""
    def setUp(self):
        CustodyTests.setUp(self)
        self.fixture_owner = os.geteuid()
        self.live = self.base / 'live'
        self.prior = self.sources / pathlib.Path(export.PRIOR).name
        for root in (self.live, self.prior):
            root.mkdir(mode=0o750)
            marker = root / '.proofofwork-ui-release'
            marker.write_bytes(b'{"protected":true}\n'); marker.chmod(0o640)
            observed = export.inventory(root, owner=self.fixture_owner)
            key = 'current' if root == self.live else 'immediatePrior'
            self.proposal['protected'][key] = {**observed['fingerprint'], 'inventory': observed['records']}
        self.holds = self.base / 'retention'; self.holds.mkdir(mode=0o700)
        self.hold = self.holds / 'approved.hold'; self.hold.write_bytes(b'unchanged hold'); self.hold.chmod(0o600)
        self.proposal['protected']['holds'] = export.hold_snapshot(self.holds)
        self.helper = self.base / 'installed-helper'
        self.helper.write_bytes(b'accepted release helper'); self.helper.chmod(0o600)
        raw, info = export.read_regular(self.helper)
        self.proposal['currentHelpers'] = {'fixture-helper': dict(path=str(self.helper),
            sha256=export.digest(raw), mode=oct(stat.S_IMODE(info.st_mode)), uid=info.st_uid,
            gid=info.st_gid, identity=export.identity(info))}
        self.timer_stdout = b'proof-ui-retention.timer masked\n'
        def timer_run(args, **kwargs):
            self.assertEqual(args[:2], ['/usr/bin/systemctl', 'list-unit-files'])
            return subprocess.CompletedProcess(args, 0, self.timer_stdout, b'')
        run = patch.object(export.subprocess, 'run', side_effect=timer_run); run.start(); self.addCleanup(run.stop)
        self.proposal['protected']['timerUnitStates'] = export.timer_snapshot()
        inventory = export.inventory; hold_snapshot = export.hold_snapshot
        for name, replacement in (('inventory', lambda root: inventory(root, owner=self.fixture_owner)),
                                  ('hold_snapshot', lambda: hold_snapshot(self.holds)),
                                  ('no_mounts', lambda paths: 'a' * 64),
                                  ('BASE', str(self.sources) + '/'), ('PRIOR', str(self.prior))):
            handle = patch.object(export, name, replacement); handle.start(); self.addCleanup(handle.stop)
        for name in ('geteuid', 'getegid'):
            handle = patch.object(export.os, name, return_value=0); handle.start(); self.addCleanup(handle.stop)

    def test_complete_selected_current_prior_helper_hold_and_mask_fence(self):
        result = export.production_fence(self.proposal)
        self.assertEqual(len(result['roots']), 7)
        self.assertEqual(result['holds'], self.proposal['protected']['holds'])
        self.assertEqual(result['timers'], self.proposal['protected']['timerUnitStates'])

    def test_changed_current_or_prior_content_refuses(self):
        for key in ('current', 'immediatePrior'):
            with self.subTest(key=key):
                export.production_fence(self.proposal)
                root = pathlib.Path(self.proposal['protected'][key]['root'])
                marker = root / '.proofofwork-ui-release'; before = marker.read_bytes()
                # Reading the fixture here changes atime; use the next exact
                # observed identity as the guarded starting point.
                observed = export.inventory(root)
                self.proposal['protected'][key] = {**observed['fingerprint'], 'inventory': observed['records']}
                marker.write_bytes(b'changed protected root')
                with self.assertRaises(ValueError): export.production_fence(self.proposal)
                marker.write_bytes(before)
                observed = export.inventory(root)
                self.proposal['protected'][key] = {**observed['fingerprint'], 'inventory': observed['records']}

    def test_changed_selected_root_refuses(self):
        (pathlib.Path(self.proposal['selectedRoots'][0]['root']) / 'unmanaged.bin').write_bytes(b'changed selected root')
        with self.assertRaises(ValueError): export.production_fence(self.proposal)

    def test_changed_installed_helper_refuses(self):
        self.helper.write_bytes(b'changed installed helper')
        with self.assertRaises(ValueError): export.production_fence(self.proposal)

    def test_changed_hold_bytes_or_metadata_refuses(self):
        self.hold.write_bytes(b'changed hold')
        with self.assertRaises(ValueError): export.production_fence(self.proposal)

    def test_changed_timer_mask_refuses(self):
        self.timer_stdout = b'proof-ui-retention.timer enabled\n'
        with self.assertRaises(ValueError): export.production_fence(self.proposal)

    def test_extra_rollback_namespace_root_refuses(self):
        (self.sources / 'unapproved-rollback').mkdir(mode=0o700)
        with self.assertRaises(ValueError): export.production_fence(self.proposal)


class DeleteTests(unittest.TestCase):
    setUp = ArchiveTests.setUp
    expected_root = ArchiveTests.expected_root

    def delete(self, journal, hook=None):
        writer = load('pages_ui_storage_writer', 'ui-storage.py')
        fd = os.open(self.base, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NOATIME)
        try: return writer.delete_tree(fd, self.root.name, self.expected, journal, action_hook=hook)
        finally: os.close(fd)

    def test_retirement_uses_descriptor_relative_unlink_and_preserves_other_tree(self):
        writer = load('pages_ui_storage_writer', 'ui-storage.py')
        outside = self.base / 'preserve'; outside.write_bytes(b'other evidence')
        actions = []; calls = []; unlink = os.unlink; rmdir = os.rmdir
        def relative_only(function, name, *args, **kwargs):
            self.assertIsInstance(kwargs.get('dir_fd'), int)
            self.assertFalse(pathlib.Path(name).is_absolute())
            self.assertNotIn('/', name)
            calls.append(name)
            return function(name, *args, **kwargs)
        fd = os.open(self.base, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NOATIME)
        try:
            with patch.object(writer.os, 'unlink', side_effect=lambda name, *a, **k: relative_only(unlink, name, *a, **k)), \
                    patch.object(writer.os, 'rmdir', side_effect=lambda name, *a, **k: relative_only(rmdir, name, *a, **k)):
                writer.delete_tree(fd, self.root.name, self.expected, lambda stage, action: actions.append((stage, action)))
        finally: os.close(fd)
        self.assertFalse(self.root.exists())
        self.assertEqual(outside.read_bytes(), b'other evidence')
        self.assertEqual(len(calls), len(self.expected['inventory']))
        self.assertTrue(actions)

    def test_changed_source_refuses_before_unlinking_that_member(self):
        self.source.chmod(0o640); self.source.write_bytes(b'changed source')
        writer = load('pages_ui_storage_writer', 'ui-storage.py')
        unlink = os.unlink; removed = []
        def tracked(name, *args, **kwargs):
            self.assertNotEqual(name, self.source.name)
            removed.append(name)
            return unlink(name, *args, **kwargs)
        with patch.object(writer.os, 'unlink', side_effect=tracked):
            with self.assertRaises((ValueError, OSError)): self.delete(lambda stage, action: None)
        self.assertTrue(self.source.exists())

    def test_unapproved_member_refuses_without_any_unlink(self):
        extra = self.root / 'unapproved'; extra.write_bytes(b'preserve unapproved source')
        writer = load('pages_ui_storage_writer', 'ui-storage.py')
        with patch.object(writer.os, 'unlink', side_effect=AssertionError('Unexpected destructive action')):
            with self.assertRaises((ValueError, OSError)): self.delete(lambda stage, action: None)
        self.assertEqual(extra.read_bytes(), b'preserve unapproved source')

    def test_root_replaced_by_symlink_never_follows_or_removes_target(self):
        outside = self.base / 'outside-root'; outside.mkdir()
        marker = outside / 'preserve'; marker.write_bytes(b'outside evidence')
        self.root.rename(self.base / 'original-retained')
        self.root.symlink_to(outside, target_is_directory=True)
        with self.assertRaises((ValueError, OSError)): self.delete(lambda stage, action: None)
        self.assertEqual(marker.read_bytes(), b'outside evidence')
        self.assertTrue((self.base / 'original-retained' / '.proofofwork-ui-release').exists())

    def test_opened_nested_directory_moved_outside_scope_keeps_its_leaf(self):
        moved = self.base / 'detached-assets'; invoked = []
        def detach(phase, action):
            if phase == 'before-unlink' and action['path'] == 'assets/index.js':
                (self.root / 'assets').rename(moved); invoked.append(action)
        with self.assertRaises((ValueError, OSError)):
            self.delete(lambda stage, action: None, detach)
        self.assertEqual(len(invoked), 1)
        self.assertTrue((moved / 'index.js').exists())
        self.assertEqual(os.getxattr(moved / 'index.js', 'user.proof.pages'), b'accepted\x00metadata\xff')


class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.writer = load('pages_ui_storage_writer', 'ui-storage.py')
        self.temp = tempfile.TemporaryDirectory(prefix='pages-ui-reference-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name)
        self.root = self.base / 'selected'; self.root.mkdir(mode=0o700)
        self.proc = self.base / 'proc'; self.proc.mkdir(mode=0o700)
        self.pid = self.proc / '12345'; self.pid.mkdir(mode=0o700)
        (self.pid / 'fd').mkdir(mode=0o700)
        for name in ('cwd', 'root', 'exe'): (self.pid / name).symlink_to('/')
        (self.pid / 'maps').write_bytes(b'')
        (self.pid / 'cmdline').write_bytes(b'/usr/bin/fixture-service\x00')
        (self.pid / 'mountinfo').write_text('25 1 8:1 / / rw - ext4 /dev/fixture rw\n')
        self.config = self.base / 'config'; self.config.mkdir(mode=0o700)
        (self.config / 'site.conf').write_text('root /var/www\n')

    def check(self):
        return self.writer.check_references([str(self.root)], proc_root=self.proc,
                                            config_roots=(self.config,), ignore_pid=-1)

    def test_unreferenced_complete_process_and_config_view_passes(self):
        self.check()

    def test_open_fd_in_selected_root_refuses(self):
        (self.pid / 'fd' / '7').symlink_to(self.root / 'accepted.js')
        with self.assertRaises(ValueError): self.check()

    def test_deleted_but_still_open_fd_refuses(self):
        (self.pid / 'fd' / '7').symlink_to(str(self.root / 'accepted.js') + ' (deleted)')
        with self.assertRaises(ValueError): self.check()

    def test_process_cwd_root_or_executable_reference_refuses(self):
        for name in ('cwd', 'root', 'exe'):
            with self.subTest(name=name):
                link = self.pid / name; link.unlink(); link.symlink_to(self.root)
                with self.assertRaises(ValueError): self.check()
                link.unlink(); link.symlink_to('/')

    def test_memory_map_reference_refuses(self):
        (self.pid / 'maps').write_text('1000-2000 r--p 00000000 08:01 1 ' + str(self.root / 'accepted.js') + '\n')
        with self.assertRaises(ValueError): self.check()

    def test_process_command_reference_refuses(self):
        (self.pid / 'cmdline').write_bytes(b'/usr/bin/fixture-service\x00--root\x00' + str(self.root).encode() + b'\x00')
        with self.assertRaises(ValueError): self.check()

    def test_process_bind_mount_source_or_target_reference_refuses(self):
        for source, target in ((str(self.root), '/isolated'), ('/', str(self.root))):
            with self.subTest(source=source, target=target):
                (self.pid / 'mountinfo').write_text('25 1 8:1 / / rw - ext4 /dev/fixture rw\n26 25 8:1 ' + source + ' ' + target + ' rw - ext4 /dev/fixture rw\n')
                with self.assertRaises(ValueError): self.check()

    def test_configuration_reference_refuses(self):
        (self.config / 'site.conf').write_text('root ' + str(self.root) + '\n')
        with self.assertRaises(ValueError): self.check()

    def test_resolved_configuration_symlink_bytes_are_checked(self):
        outside_config = self.base / 'loaded-unit.service'
        outside_config.write_text('[Service]\nWorkingDirectory=' + str(self.root) + '\n')
        (self.config / 'accepted-unit.service').symlink_to(outside_config)
        with self.assertRaises(ValueError): self.check()

    def test_loaded_native_or_transient_unit_and_dropin_reference_refuses(self):
        for name in ('native.service', 'transient.service', 'override.conf'):
            with self.subTest(name=name):
                source = self.base / name; source.write_text('[Service]\nExecStart=/usr/bin/service --root ' + str(self.root) + '\n')
                with self.assertRaises(ValueError):
                    self.writer.check_references([str(self.root)], proc_root=self.proc,
                        config_roots=(self.config,), ignore_pid=-1, loaded_paths=[str(source)])


class RetirementTests(unittest.TestCase):
    local_process = CustodyTests.local_process
    exported = CustodyTests.exported
    verify = CustodyTests.verify

    def setUp(self):
        CustodyTests.setUp(self)
        self.exported(); self.custody = self.verify()
        self.writer = load('pages_ui_storage_writer', 'ui-storage.py')
        self.live = self.base / 'live'
        self.prior = self.sources / pathlib.Path(self.writer.E.PRIOR).name
        for root in (self.live, self.prior):
            root.mkdir(mode=0o750)
            marker = root / '.proofofwork-ui-release'; marker.write_bytes(b'{"protected":true}\n'); marker.chmod(0o640)
            observed = self.writer.E.inventory(root, os.geteuid())
            key = 'current' if root == self.live else 'immediatePrior'
            self.proposal['protected'][key] = {**observed['fingerprint'], 'inventory': observed['records']}
        self.evidence = self.base / 'retirement-evidence'; self.evidence.mkdir(mode=0o700)
        self.lock = self.base / 'deploy.lock'; self.lock.write_bytes(b''); self.lock.chmod(0o600)
        self.proposal['deployLock'] = dict(path=str(self.lock), identity=export.identity(self.lock.lstat()),
            exclusive=True, nonblocking=True, readOnlyDescriptor=True)
        self.retention = self.base / 'retention'; self.retention.mkdir(mode=0o700)
        self.layout = self.writer.Layout(live=self.live, rollback_parent=self.sources, evidence=self.evidence,
            lock=self.lock, retention_dir=self.retention, proc_root=self.base / 'unused-proc',
            config_roots=(), production=False)
        self.guard_calls = []; self.reference_calls = []; self.capacity_calls = []

    def fence(self, remaining):
        self.guard_calls.append(list(remaining))
        expected = [self.proposal['protected']['current'], self.proposal['protected']['immediatePrior']]
        expected += [r for r in self.proposal['selectedRoots'] if r['root'] in remaining]
        for row in expected:
            self.writer.E.assert_inventory(self.writer.E.inventory(row['root'], os.geteuid()), row)
        self.assertEqual(self.writer.E.names(self.sources),
            sorted([pathlib.Path(p).name for p in remaining] + [self.prior.name]))

    def references(self, remaining):
        self.reference_calls.append(list(remaining))
        return {'fixtureCompleteReferenceView': True, 'remainingRoots': list(remaining)}

    def capacity(self):
        self.capacity_calls.append(True)

    def retire(self, **overrides):
        args = dict(fence=self.fence, reference_check=self.references, capacity_check=self.capacity,
                    execution_id='fixture-first', proposal_raw=self.proposal_raw,
                    approval_raw=self.approval_raw, custody_raw=export.encoded(self.custody))
        args.update(overrides)
        return self.writer.retire_exact(self.proposal, self.approval, self.custody, self.layout, **args)

    def receipt(self):
        paths = list(self.evidence.glob('pages-five-roots-b7ec8574-*'))
        self.assertEqual(len(paths), 1)
        return paths[0]

    def test_exact_five_roots_retire_with_complete_receipts_and_verified_guards(self):
        original_protected = copy.deepcopy(self.proposal['protected'])
        archive_hashes = {p: export.digest(export.read_regular(p)[0]) for p in self.output.glob('*.tgz')}
        result = self.retire()
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(len(result['completed']), 5)
        self.assertEqual(result['remaining'], [])
        self.assertEqual(result['measuredAvailableBytesDelta'], result['availableBytes'] - result['beforeAvailableBytes'])
        self.assertEqual(result['measuredAvailableInodesDelta'], result['availableInodes'] - result['beforeAvailableInodes'])
        self.assertTrue(result['measurementQualification'])
        self.assertEqual(self.writer.E.names(self.sources), [self.prior.name])
        self.assertEqual(self.proposal['protected'], original_protected)
        self.assertEqual(self.reference_calls[0], [r['root'] for r in self.proposal['selectedRoots']])
        self.assertEqual(self.reference_calls[-1], [])
        self.assertTrue(self.capacity_calls)
        for key in ('current', 'immediatePrior'):
            row = original_protected[key]
            self.writer.E.assert_inventory(self.writer.E.inventory(row['root'], os.geteuid()), row)
        for path, expected_hash in archive_hashes.items(): self.assertEqual(export.digest(export.read_regular(path)[0]), expected_hash)
        receipt = self.receipt()
        self.assertTrue((receipt / 'intent.json').is_file() and (receipt / 'completed.json').is_file())
        self.assertFalse((receipt / 'failure.json').exists())
        self.assertEqual(len(list(receipt.glob('partial-*.json'))), 5)
        journal = [json.loads(line) for line in (receipt / 'actions.jsonl').read_text().splitlines()]
        completed = [line for line in journal if line['stage'] == 'completed']
        self.assertEqual(len(completed), result['journalCompletedActions'])
        self.assertEqual(len(completed), sum(r['entries'] for r in self.proposal['selectedRoots']))

    def test_initial_root_drift_refuses_before_any_destructive_action_or_intent(self):
        row = self.proposal['selectedRoots'][0]
        (pathlib.Path(row['root']) / 'unmanaged.bin').write_bytes(b'changed before guard')
        with patch.object(self.writer.os, 'unlink', side_effect=AssertionError('Unexpected destructive action')):
            with self.assertRaises(ValueError): self.retire()
        self.assertEqual(self.writer.E.names(self.evidence), [])
        self.assertTrue(all(pathlib.Path(r['root']).exists() for r in self.proposal['selectedRoots']))

    def test_reference_or_capacity_refusal_never_creates_intent_or_deletes(self):
        for override in ('reference_check', 'capacity_check'):
            with self.subTest(override=override):
                def refuse(*args): raise ValueError('fixture protected admission refused')
                with self.assertRaises(ValueError): self.retire(**{override: refuse})
                self.assertEqual(self.writer.E.names(self.evidence), [])
                self.assertTrue(all(pathlib.Path(r['root']).exists() for r in self.proposal['selectedRoots']))

    def test_interruption_after_unlink_preserves_intent_failure_and_refuses_retry(self):
        interrupted = []
        def stop(phase, action):
            if phase == 'after-unlink':
                interrupted.append(action)
                raise InterruptedError('fixture signal after destructive action')
        with self.assertRaises(InterruptedError): self.retire(action_hook=stop)
        self.assertEqual(len(interrupted), 1)
        receipt = self.receipt(); failure = json.loads((receipt / 'failure.json').read_text())
        self.assertEqual(failure['status'], 'failed')
        self.assertTrue(failure['reconciliationRequired'])
        self.assertFalse(failure['automaticRetryAllowed'])
        self.assertTrue(failure['deployLockObservations'])
        self.assertEqual(failure['deployLockObservations'][0]['capturedIdentity'], self.proposal['deployLock']['identity'])
        self.assertFalse((receipt / 'completed.json').exists())
        self.assertTrue((receipt / 'intent.json').exists())
        self.assertTrue((receipt / 'actions.jsonl').read_text().strip())
        original_entries = sum(r['entries'] for r in self.proposal['selectedRoots'])
        remaining_entries = sum(len(export.inventory(r['root'], os.geteuid())['records'])
                                if (pathlib.Path(r['root']) / '.proofofwork-ui-release').exists() else
                                1 + len(list(pathlib.Path(r['root']).iterdir())) for r in self.proposal['selectedRoots'])
        self.assertEqual(remaining_entries, original_entries - 1)
        with self.assertRaises(ValueError): self.retire(execution_id='fixture-second')
        self.assertEqual(self.receipt(), receipt)

    def test_completed_first_root_then_guard_drift_preserves_partial_receipt(self):
        first = self.proposal['selectedRoots'][0]['root']; second = self.proposal['selectedRoots'][1]['root']
        def drift(phase, action):
            if phase == 'after-unlink' and action['root'] == first and action['path'] == '.':
                (pathlib.Path(second) / 'unmanaged.bin').write_bytes(b'changed between exact roots')
        with self.assertRaises(ValueError): self.retire(action_hook=drift)
        receipt = self.receipt(); failure = json.loads((receipt / 'failure.json').read_text())
        self.assertEqual([r['root'] for r in failure['completed']], [first])
        self.assertEqual(failure['remaining'], [r['root'] for r in self.proposal['selectedRoots'][1:]])
        self.assertFalse(pathlib.Path(first).exists())
        self.assertTrue((receipt / 'partial-1.json').exists())
        self.assertFalse((receipt / 'completed.json').exists())
        self.assertTrue(all(pathlib.Path(r['root']).exists() for r in self.proposal['selectedRoots'][1:]))

    def test_entry_replaced_after_intent_is_not_unlinked(self):
        replacements = []
        def replace(phase, action):
            if phase == 'before-unlink' and not replacements:
                target = pathlib.Path(action['root']) / action['path']
                target.unlink(); target.write_bytes(b'unapproved replacement'); target.chmod(0o640)
                replacements.append(target)
        with self.assertRaises(ValueError): self.retire(action_hook=replace)
        self.assertEqual(replacements[0].read_bytes(), b'unapproved replacement')
        self.assertFalse((self.receipt() / 'completed.json').exists())

    def test_parent_root_replaced_after_intent_never_mutates_detached_tree(self):
        replacements = []
        def detach(phase, action):
            if phase == 'before-unlink' and not replacements:
                root = pathlib.Path(action['root']); moved = self.sources / 'detached-original-root'
                root.rename(moved); root.mkdir(mode=0o750)
                (root / 'preserve').write_bytes(b'replacement root evidence')
                replacements.extend([root, moved])
        with self.assertRaises(ValueError): self.retire(action_hook=detach)
        root, moved = replacements
        self.assertEqual((root / 'preserve').read_bytes(), b'replacement root evidence')
        self.assertTrue((moved / '.proofofwork-ui-release').exists())
        self.assertTrue((moved / 'unmanaged.bin').exists())
        self.assertFalse((self.receipt() / 'completed.json').exists())

    def test_lock_contention_never_deletes_or_creates_intent(self):
        import fcntl
        held = os.open(self.lock, os.O_RDONLY); fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            with self.assertRaises(BlockingIOError): self.retire()
        finally: os.close(held)
        self.assertEqual(self.writer.E.names(self.evidence), [])
        self.assertTrue(all(pathlib.Path(r['root']).exists() for r in self.proposal['selectedRoots']))

    def test_receipt_namespace_appearing_during_lock_acquisition_refuses(self):
        import fcntl
        original = fcntl.flock
        competing = self.evidence / 'pages-five-roots-b7ec8574-already-started'
        def acquire_then_publish(fd, operation):
            original(fd, operation); competing.mkdir(mode=0o700)
        with patch.object(fcntl, 'flock', side_effect=acquire_then_publish):
            with self.assertRaises(ValueError): self.retire()
        self.assertEqual(self.writer.E.names(self.evidence), [competing.name])
        self.assertTrue(all(pathlib.Path(r['root']).exists() for r in self.proposal['selectedRoots']))

    def test_replaced_lock_inode_while_original_is_locked_never_starts(self):
        import fcntl
        held = os.open(self.lock, os.O_RDONLY); fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        replacement = self.base / 'replacement-lock'; replacement.write_bytes(b''); replacement.chmod(0o600)
        os.replace(replacement, self.lock)
        try:
            with self.assertRaises(ValueError): self.retire()
        finally: os.close(held)
        self.assertEqual(self.writer.E.names(self.evidence), [])
        self.assertTrue(all(pathlib.Path(r['root']).exists() for r in self.proposal['selectedRoots']))

    def test_replaced_lock_path_after_first_root_prevents_further_deletion(self):
        first = self.proposal['selectedRoots'][0]['root']
        def replace(phase, action):
            if phase == 'after-unlink' and action['root'] == first and action['path'] == '.':
                new = self.base / 'replacement-lock'; new.write_bytes(b''); new.chmod(0o600)
                os.replace(new, self.lock)
        with self.assertRaises(ValueError): self.retire(action_hook=replace)
        failure = json.loads((self.receipt() / 'failure.json').read_text())
        self.assertEqual([r['root'] for r in failure['completed']], [first])
        self.assertTrue((self.receipt() / 'partial-1.json').exists())
        self.assertFalse((self.receipt() / 'completed.json').exists())
        self.assertTrue(all(pathlib.Path(r['root']).exists() for r in self.proposal['selectedRoots'][1:]))

    def assert_lock_evidence(self, observations, captured):
        self.assertTrue(observations)
        allowed = {'st_mtime_ns', 'st_ctime_ns'}
        for observed in observations:
            self.assertEqual(observed['path'], str(self.lock))
            self.assertEqual(observed['capturedIdentity'], captured)
            self.assertEqual(set(observed['qualifiedCoordinationTimestampFields']), allowed)
            self.assertTrue(observed['qualification'])
            for identity in (observed['acquiredIdentity'], observed['currentIdentity']):
                self.assertEqual(set(identity), set(captured))
                self.assertEqual({k: v for k, v in identity.items() if k not in allowed},
                                 {k: v for k, v in captured.items() if k not in allowed})

    def advance_lock_times(self):
        before = self.writer.E.identity(self.lock.lstat())
        os.utime(self.lock, ns=(before['st_atime_ns'], before['st_mtime_ns'] + 1000000))
        # The accepted installed helper chmods the same empty lock before flock.
        os.chmod(self.lock, 0o600)
        current = self.writer.E.identity(self.lock.lstat())
        self.assertGreater(current['st_mtime_ns'], before['st_mtime_ns'])
        self.assertGreater(current['st_ctime_ns'], before['st_ctime_ns'])
        self.assertEqual({k: v for k, v in current.items() if k not in ('st_mtime_ns', 'st_ctime_ns')},
                         {k: v for k, v in before.items() if k not in ('st_mtime_ns', 'st_ctime_ns')})
        return current

    def test_same_empty_lock_timestamp_advance_has_explicit_intent_and_result_evidence(self):
        captured = copy.deepcopy(self.proposal['deployLock']['identity'])
        acquired = self.advance_lock_times()
        result = self.retire()
        intent = json.loads((self.receipt() / 'intent.json').read_bytes())
        self.assert_lock_evidence(intent['deployLockObservations'], captured)
        self.assert_lock_evidence(result['deployLockObservations'], captured)
        self.assertEqual(result['deployLockObservations'][:len(intent['deployLockObservations'])], intent['deployLockObservations'])
        self.assertEqual(result['deployLockObservations'][0]['acquiredIdentity'], acquired)
        self.assertEqual(result['deployLockObservations'][0]['currentIdentity'], acquired)
        self.assertEqual(result['status'], 'completed')

    def test_same_held_lock_timestamp_advance_is_qualified_on_later_guards(self):
        captured = copy.deepcopy(self.proposal['deployLock']['identity'])
        first = self.proposal['selectedRoots'][0]['root']; advanced = []
        def advance(phase, action):
            if phase == 'after-unlink' and action['root'] == first and action['path'] == '.':
                advanced.append(self.advance_lock_times())
        result = self.retire(action_hook=advance)
        self.assertEqual(len(advanced), 1)
        self.assert_lock_evidence(result['deployLockObservations'], captured)
        self.assertTrue(any(row['currentIdentity'] == advanced[0] for row in result['deployLockObservations']))
        self.assertEqual(result['status'], 'completed')

    def test_real_noncoordination_lock_drift_refuses_before_intent(self):
        captured = copy.deepcopy(self.proposal['deployLock']['identity'])
        alias = self.base / 'external-lock-alias'
        for mutation in ('mode', 'nlink', 'payload', 'atime'):
            with self.subTest(mutation=mutation):
                descriptor = os.open(self.lock, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
                try:
                    self.writer.lock_observation(self.lock, descriptor, self.proposal['deployLock'],
                                                 self.writer.E.identity(os.fstat(descriptor)))
                finally: os.close(descriptor)
                if mutation == 'mode': self.lock.chmod(0o640)
                elif mutation == 'nlink': os.link(self.lock, alias)
                elif mutation == 'payload': self.lock.write_bytes(b'unapproved mutable coordination payload')
                else: os.utime(self.lock, ns=(captured['st_atime_ns'] + 1, self.lock.lstat().st_mtime_ns))
                with self.assertRaises(ValueError): self.retire()
                self.assertEqual(self.writer.E.names(self.evidence), [])
                self.assertTrue(all(pathlib.Path(r['root']).exists() for r in self.proposal['selectedRoots']))
                if mutation == 'mode': self.lock.chmod(0o600)
                elif mutation == 'nlink': alias.unlink()
                elif mutation == 'payload': self.lock.write_bytes(b'')
                else: os.utime(self.lock, ns=(captured['st_atime_ns'], self.lock.lstat().st_mtime_ns))

    def test_coordination_timestamp_exception_never_relaxes_root_metadata(self):
        row = self.proposal['selectedRoots'][0]
        root = pathlib.Path(row['root']); identity = row['inventory'][0]['identity']
        os.utime(root, ns=(identity['st_atime_ns'], identity['st_mtime_ns'] + 1))
        with self.assertRaises(ValueError): self.retire()
        self.assertEqual(self.writer.E.names(self.evidence), [])
        self.assertTrue(all(pathlib.Path(r['root']).exists() for r in self.proposal['selectedRoots']))

    def valid_custody_metadata(self):
        custody = copy.deepcopy(self.custody); e = self.writer.E
        durable = pathlib.Path('/home/approved-offhost-custody')
        custody['durableDirectory'] = str(durable)
        custody['proposalSha256'] = e.PROPOSAL_SHA; custody['approvalSha256'] = e.APPROVAL_SHA
        for row, saved, restored in zip(self.proposal['selectedRoots'], custody['exports'], custody['restorations']):
            path = str(durable / (pathlib.Path(row['root']).name + '.tgz'))
            saved.update(proposalSha256=e.PROPOSAL_SHA, approvalSha256=e.APPROVAL_SHA, archivePath=path)
            restored.update(archivePath=path, restoredPath=str(durable / 'restored' / pathlib.Path(row['root']).name),
                            uidMap='0 1000 1', gidMap='0 1000 1')
        self.writer.validate_custody(custody, self.proposal)
        return custody

    def test_strict_custody_bindings_refuse_tampered_archive_metadata_and_source(self):
        custody = self.valid_custody_metadata(); durable = pathlib.Path(custody['durableDirectory'])
        for mutation in ('incomplete', 'sha', 'metadata', 'owner', 'hardlinks', 'archive-path', 'namespace',
                         'source', 'ordering', 'header', 'fingerprint', 'inventory', 'nondurable', 'dotpath'):
            with self.subTest(mutation=mutation):
                changed = copy.deepcopy(custody)
                if mutation == 'incomplete': changed['restorations'].pop()
                elif mutation == 'sha': changed['exports'][0]['archiveSha256'] = '0' * 64
                elif mutation == 'metadata': changed['restorations'][0]['modeTimesXattrsRestored'] = False
                elif mutation == 'owner': changed['restorations'][0]['ownerRestored'] = False
                elif mutation == 'hardlinks': changed['restorations'][0]['internalHardlinksRestored'] = False
                elif mutation == 'archive-path': changed['exports'][0]['archivePath'] = str(durable / 'foreign.tgz')
                elif mutation == 'namespace': changed['restorations'][0]['uidMap'] = '1000 1000 1'
                elif mutation == 'source': changed['exporterSha256'] = 'bad-source-hash'
                elif mutation == 'header': changed['schema'] = 'unapproved-custody-v2'
                elif mutation == 'fingerprint': changed['exports'][0]['fingerprint']['treeSha256'] = '0' * 64
                elif mutation == 'inventory': changed['restorations'][0]['inventorySha256'] = '0' * 64
                elif mutation == 'nondurable': changed['durableDirectory'] = '/var/tmp/custody'
                elif mutation == 'dotpath': changed['durableDirectory'] = '/home/../tmp/custody'
                else: changed['exports'].reverse()
                with self.assertRaises(ValueError): self.writer.validate_custody(changed, self.proposal)

    def test_production_retirement_never_accepts_fixture_guard_overrides(self):
        proposal = copy.deepcopy(self.proposal); e = self.writer.E
        for row, path in zip(proposal['selectedRoots'], e.ROOT_PATHS): row['root'] = path
        proposal['protected']['current']['root'] = e.LIVE
        proposal['protected']['immediatePrior']['root'] = e.PRIOR
        with patch.object(self.writer.os, 'geteuid', return_value=0), patch.object(self.writer.os, 'getegid', return_value=0):
            with self.assertRaises(ValueError):
                self.writer.retire_exact(proposal, {}, {}, self.writer.Layout(), fence=lambda paths: None)

    def test_retirement_request_binds_writer_exporter_and_exact_raw_custody(self):
        import base64
        e = self.writer.E
        proposal_raw = e.encoded(self.proposal); proposal_sha = e.digest(proposal_raw)
        approval = copy.deepcopy(self.approval); approval['proposalSha256'] = proposal_sha
        approval_raw = e.encoded(approval); approval_sha = e.digest(approval_raw)
        source_sha = e.digest(e.read_regular(pathlib.Path(__file__).with_name('ui-storage-export.py'))[0])
        custody = self.valid_custody_metadata()
        custody['proposalSha256'] = proposal_sha; custody['approvalSha256'] = approval_sha
        for row in custody['exports']: row.update(proposalSha256=proposal_sha, approvalSha256=approval_sha)
        custody_raw = e.encoded(custody)
        request = dict(schema='proof-of-work-pages-ui-retirement-request-v1',
            proposalRawBase64=base64.b64encode(proposal_raw).decode(), approvalRawBase64=base64.b64encode(approval_raw).decode(),
            custodyRawBase64=base64.b64encode(custody_raw).decode(), custodySha256=e.digest(custody_raw),
            writerSha256='a' * 64, exporterSha256=source_sha, executionId='fixture-request')
        with patch.object(e, 'PROPOSAL_SHA', proposal_sha), patch.object(e, 'APPROVAL_SHA', approval_sha), \
                patch.object(e, 'ROOT_PATHS', [r['root'] for r in self.proposal['selectedRoots']]), \
                patch.object(e, 'LIVE', str(self.live)), patch.object(e, 'PRIOR', str(self.prior)):
            parsed = self.writer.decode_request(e.encoded(request), 'a' * 64, source_sha)
            self.assertEqual(parsed[1], self.proposal)
            self.assertEqual(parsed[2], approval)
            self.assertEqual(parsed[3], custody)
            for mutation in ('writer', 'exporter', 'custody-sha', 'custody-bytes', 'source', 'header'):
                with self.subTest(mutation=mutation):
                    changed = copy.deepcopy(request)
                    if mutation == 'writer': changed['writerSha256'] = 'b' * 64
                    elif mutation == 'exporter': changed['exporterSha256'] = 'b' * 64
                    elif mutation == 'custody-sha': changed['custodySha256'] = '0' * 64
                    elif mutation == 'custody-bytes': changed['custodyRawBase64'] = base64.b64encode(custody_raw + b' ').decode()
                    elif mutation == 'header': changed['schema'] = 'broader-retirement-request-v2'
                    else:
                        altered = copy.deepcopy(custody); altered['exporterSha256'] = 'b' * 64
                        raw = e.encoded(altered); changed['custodyRawBase64'] = base64.b64encode(raw).decode(); changed['custodySha256'] = e.digest(raw)
                    with self.assertRaises(ValueError): self.writer.decode_request(e.encoded(changed), 'a' * 64, source_sha)


class LoadedUnitTests(unittest.TestCase):
    def setUp(self):
        self.writer = load('pages_ui_storage_writer', 'ui-storage.py')

    def test_root_escaped_and_opaque_unit_names_are_positional_after_separator(self):
        units = ['-.mount', '-.slice', r'dev-disk-by\x2duuid-accepted.device',
                 r'var-lib-accepted\x2droot.mount', '--property=UnsafeOverride']
        units += [f'fixture-{index}.service' for index in range(252)]
        batches = []; expected = set()
        def systemctl(args, **kwargs):
            self.assertEqual(args[0], '/usr/bin/systemctl')
            self.assertTrue(kwargs['check'])
            if args[1] == 'list-units':
                self.assertEqual(args[2:], ['--all', '--plain', '--no-legend', '--no-pager'])
                return subprocess.CompletedProcess(args, 0, ''.join(f'{unit} loaded active running Fixture\n' for unit in units).encode(), b'')
            self.assertEqual(args[:4], ['/usr/bin/systemctl', 'show', '--property=Id,FragmentPath,DropInPaths', '--'])
            batch = args[4:]; batches.append(batch)
            self.assertLessEqual(len(batch), 128)
            rows = []
            for unit in batch:
                # Devices and some generated root units have no fragment.
                fragment = '/run/systemd/transient/' + unit if unit.startswith('fixture-') else ''
                dropin = '/etc/systemd/system/accepted.service.d/override.conf'
                if fragment: expected.add(fragment)
                expected.add(dropin)
                rows.extend(['Id=' + unit, 'FragmentPath=' + fragment, 'DropInPaths=' + dropin, ''])
            return subprocess.CompletedProcess(args, 0, '\n'.join(rows).encode(), b'')
        with patch.object(self.writer.subprocess, 'run', side_effect=systemctl):
            observed = self.writer.loaded_unit_paths()
        self.assertEqual([unit for batch in batches for unit in batch], units)
        self.assertEqual([len(batch) for batch in batches], [128, 128, 1])
        self.assertEqual(observed, sorted(expected))

    def test_loaded_unit_inventory_count_and_raw_byte_bounds_remain_enforced(self):
        for mutation in ('count', 'bytes'):
            with self.subTest(mutation=mutation):
                output = (''.join(f'fixture-{index}.service loaded active running Fixture\n' for index in range(8193)).encode()
                          if mutation == 'count' else b'x' * (2 * 1024 * 1024 + 1))
                calls = []
                def systemctl(args, **kwargs):
                    calls.append(args)
                    self.assertEqual(args[1], 'list-units')
                    return subprocess.CompletedProcess(args, 0, output, b'')
                with patch.object(self.writer.subprocess, 'run', side_effect=systemctl):
                    with self.assertRaises(ValueError): self.writer.loaded_unit_paths()
                self.assertEqual(len(calls), 1)

    def test_loaded_unit_property_output_byte_bound_remains_enforced(self):
        def systemctl(args, **kwargs):
            output = b'-.mount loaded active mounted Root\n' if args[1] == 'list-units' else b'x' * (2 * 1024 * 1024 + 1)
            if args[1] == 'show': self.assertEqual(args[-2:], ['--', '-.mount'])
            return subprocess.CompletedProcess(args, 0, output, b'')
        with patch.object(self.writer.subprocess, 'run', side_effect=systemctl):
            with self.assertRaises(ValueError): self.writer.loaded_unit_paths()


class LockObservationTests(unittest.TestCase):
    def setUp(self):
        self.writer = load('pages_ui_storage_writer', 'ui-storage.py')
        self.temp = tempfile.TemporaryDirectory(prefix='pages-ui-lock-observation-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name)
        self.lock = self.base / 'deploy.lock'; self.lock.write_bytes(b''); self.lock.chmod(0o600)
        self.fd = os.open(self.lock, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
        self.addCleanup(os.close, self.fd)
        self.acquired = self.writer.E.identity(os.fstat(self.fd))
        self.census = {'path': str(self.lock), 'identity': copy.deepcopy(self.acquired)}

    def test_every_captured_and_acquired_non_timestamp_identity_field_stays_exact(self):
        self.writer.lock_observation(self.lock, self.fd, self.census, self.acquired)
        for field in set(self.writer.E.STAT_FIELDS) - {'st_mtime_ns', 'st_ctime_ns'}:
            for where in ('captured', 'acquired'):
                with self.subTest(field=field, where=where):
                    census = copy.deepcopy(self.census); acquired = copy.deepcopy(self.acquired)
                    target = census['identity'] if where == 'captured' else acquired
                    target[field] += 1
                    with self.assertRaises(ValueError):
                        self.writer.lock_observation(self.lock, self.fd, census, acquired)

    def test_incomplete_identity_path_or_descriptor_binding_never_qualifies(self):
        for mutation in ('missing-captured', 'extra-captured', 'missing-acquired', 'census-path', 'descriptor-path'):
            with self.subTest(mutation=mutation):
                census = copy.deepcopy(self.census); acquired = copy.deepcopy(self.acquired); path = self.lock
                if mutation == 'missing-captured': census['identity'].pop('st_atime_ns')
                elif mutation == 'extra-captured': census['identity']['unapproved'] = 0
                elif mutation == 'missing-acquired': acquired.pop('st_mtime_ns')
                elif mutation == 'census-path': census['path'] = str(self.base / 'different-lock')
                else:
                    path = self.base / 'different-lock'; path.write_bytes(b''); path.chmod(0o600)
                with self.assertRaises(ValueError): self.writer.lock_observation(path, self.fd, census, acquired)


class DispatcherTests(unittest.TestCase):
    def test_root_namespace_dispatch_uses_operator_trust_store_and_strict_host_key_check(self):
        import base64
        import shlex
        writer = load('pages_ui_storage_writer', 'ui-storage.py'); e = writer.E
        with tempfile.TemporaryDirectory(prefix='pages-ui-dispatch-test-') as temporary:
            base = pathlib.Path(temporary)
            request_path = base / 'request.json'; request_raw = b'{"fixture":"bound-request"}\n'
            request_path.write_bytes(request_raw); request_path.chmod(0o600)
            log = base / 'dispatch.json'
            custody = {'durableDirectory': str(base / 'fixture-custody')}; custody_raw = e.encoded(custody)
            request = {'executionId': 'fixture-knownhosts', 'custodySha256': e.digest(custody_raw)}
            source, _ = e.read_regular(pathlib.Path(__file__).with_name('ui-storage.py'))
            exporter_source, _ = e.read_regular(pathlib.Path(__file__).with_name('ui-storage-export.py'))
            self.assertEqual(e.digest(exporter_source), '098924a20c920c26167cc30b7f961496f86a7da4a9c7209c834b31bfbc1955c3')
            parsed = (request, {}, {}, custody, b'{}', b'{}', custody_raw)
            fresh = ({}, {}, custody, b'{}', b'{}', custody_raw)
            called = []
            def dispatch(args, **kwargs):
                called.append(args)
                self.assertEqual(args[:-4], e.SSH[:-1])
                self.assertEqual(args[-4:-2], ['-o', 'UserKnownHostsFile=/home/sixer/.ssh/known_hosts'])
                self.assertEqual(args[-2], 'root@77.42.91.106')
                self.assertIn('StrictHostKeyChecking=yes', args)
                self.assertIn('IdentitiesOnly=yes', args)
                self.assertIn('BatchMode=yes', args)
                self.assertEqual(args[args.index('-i') + 1], '/home/sixer/.ssh/proofofwork_me_ed25519')
                self.assertNotIn('StrictHostKeyChecking=no', args)
                command = shlex.split(args[-1])
                self.assertEqual(command[0], '/usr/bin/systemd-run')
                self.assertIn('--unit=pages-storage-b7ec8574-fixture-knownhosts', command)
                self.assertEqual(command[-4:], ['/usr/bin/python3', '-I', '-B', '-'])
                program = kwargs['input']
                self.assertIsInstance(program, bytes)
                self.assertIn(base64.b64encode(source), program)
                self.assertIn(base64.b64encode(exporter_source), program)
                self.assertIn(base64.b64encode(request_raw), program)
                self.assertIn(e.digest(source).encode(), program)
                self.assertIn(e.digest(exporter_source).encode(), program)
                return subprocess.CompletedProcess(args, 0, b'{"status":"fixture-dispatched"}\n', b'')
            # Reproduce the namespace's root identity while all transport is
            # intercepted; full-suite unshare runs also exercise actual UID0.
            with patch.object(writer.os, 'geteuid', return_value=0), \
                    patch.object(writer, 'decode_request', return_value=parsed), \
                    patch.object(writer, 'verify_custody_directory', return_value=fresh), \
                    patch.object(writer.subprocess, 'run', side_effect=dispatch):
                result = writer.apply(request_path, log)
            self.assertEqual(result, {'status': 'fixture-dispatched'})
            self.assertEqual(len(called), 1)
            receipt = json.loads(log.read_bytes())
            self.assertEqual(receipt['returnCode'], 0)
            self.assertEqual(receipt['requestSha256'], e.digest(request_raw))


if __name__ == '__main__':
    unittest.main()
