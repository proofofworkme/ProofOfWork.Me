import base64
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tarfile
import tempfile
import unittest

SOURCE = Path(__file__).with_name('transport-relocation-controller.py')
spec = importlib.util.spec_from_file_location('controller', SOURCE)
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)

class ProposalGuards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='browser-dns-six-fixture-')
        self.base = Path(self.tmp.name) / 'transport'
        self.base.mkdir(mode=0o700)
        for name in C.TARGETS:
            root = self.base / name
            root.mkdir(parents=True, mode=0o700)
            (root / 'nested').mkdir(mode=0o700)
            (root / 'nested/data').write_bytes(('fixture:' + name).encode())
            (root / 'nested/data').chmod(0o600)
            os.utime(root / 'nested/data', ns=(1700000000000000001, 1700000000000000123))
            os.setxattr(root / 'nested/data', 'user.pow-custody', b'fixture-metadata')
            (root / 'inside').symlink_to('nested/data')
        for name in C.RELEASES:
            parent = self.base / name
            (parent / 'incoming-receipt.json').write_text('canonical receipt')
            (parent / 'archive-base').mkdir(mode=0o700)
            (parent / 'archive-base/marker').write_text('archive base')
        (self.base / C.FOREIGN).mkdir(mode=0o700)
        (self.base / C.FOREIGN / 'foreign').write_text('foreign selected by Permission')
        self.rows = C.census(self.base, C.TARGETS)
        self.archive = Path(self.tmp.name) / 'fixture.tgz'
        subprocess.run(['/usr/bin/tar', '--format=pax', '--numeric-owner', '--xattrs', '--acls', '--atime-preserve=system',
                        '-czf', str(self.archive), '-C', str(self.base), *C.TARGETS], check=True)

    def tearDown(self):
        self.tmp.cleanup()

    def protected(self):
        return [(str(p.relative_to(self.base)), p.read_bytes()) for p in sorted(self.base.rglob('*'))
                if p.is_file() and not p.is_symlink() and not any(str(p).startswith(str(self.base / t) + '/') for t in C.TARGETS)]

    def test_exact_backup_and_restore_bytes_metadata_xattrs_topology(self):
        C.validate_rows(self.rows, production=False)
        C.verify_tar(self.archive, self.rows)
        restore = Path(self.tmp.name) / 'restore'
        restore.mkdir(mode=0o700)
        C.restore_verified_targets(restore, self.archive, self.rows, lambda: None)
        C.compare_restored(restore, self.rows)

    def test_exact_removal_preserves_all_siblings_and_foreign(self):
        before = self.protected()
        receipts = []
        def protected_check():
            self.assertEqual(before, self.protected())
        C.remove_verified_targets(self.base, self.rows, protected_check, lambda *event: receipts.append(event))
        self.assertEqual(before, self.protected())
        self.assertFalse(any((self.base / t).exists() for t in C.TARGETS))
        self.assertEqual(len(receipts), 12)

    def test_source_content_drift_refuses_before_any_removal(self):
        (self.base / C.TARGETS[0] / 'nested/data').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'Source drift'):
            C.remove_verified_targets(self.base, self.rows, lambda: None)
        self.assertTrue(all((self.base / t).exists() for t in C.TARGETS))

    def test_metadata_mode_and_xattr_drift_refuse(self):
        p = self.base / C.TARGETS[0] / 'nested/data'
        os.setxattr(p, 'user.pow-custody', b'changed')
        with self.assertRaisesRegex(ValueError, 'Source drift'):
            C.remove_verified_targets(self.base, self.rows, lambda: None)

    def test_unreviewed_entry_injected_after_census_survives(self):
        extra = self.base / C.TARGETS[0] / 'unreviewed'
        def hook(target, stage, count):
            if stage == 'before' and target == C.TARGETS[0]:
                extra.write_text('must survive')
        with self.assertRaises(OSError):
            C.remove_verified_targets(self.base, self.rows, lambda: None, hook)
        self.assertEqual(extra.read_text(), 'must survive')
        self.assertTrue((self.base / C.TARGETS[1]).exists())

    def test_file_replaced_at_unlink_boundary_refuses(self):
        file = self.base / C.TARGETS[0] / 'nested/data'
        def hook(target, stage, count):
            if stage == 'before' and target == C.TARGETS[0]:
                file.unlink()
                file.write_text('replacement')
        with self.assertRaisesRegex(ValueError, 'identity drift'):
            C.remove_verified_targets(self.base, self.rows, lambda: None, hook)
        self.assertEqual(file.read_text(), 'replacement')

    def test_protected_drift_refuses_before_removal(self):
        def drift():
            raise ValueError('Protected current Permission root drift')
        with self.assertRaisesRegex(ValueError, 'Protected'):
            C.remove_verified_targets(self.base, self.rows, drift)
        self.assertTrue(all((self.base / t).exists() for t in C.TARGETS))

    def test_restore_existing_target_refuses(self):
        with self.assertRaisesRegex(ValueError, 'must be empty'):
            C.restore_verified_targets(self.base, self.archive, self.rows, lambda: None)

    def test_restore_parent_symlink_refuses(self):
        restore = Path(self.tmp.name) / 'restore-with-link'
        outside = Path(self.tmp.name) / 'outside'
        restore.mkdir(mode=0o700)
        outside.mkdir(mode=0o700)
        (restore / C.RELEASES[0]).symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'must be empty'):
            C.restore_verified_targets(restore, self.archive, self.rows, lambda: None)
        self.assertEqual(list(outside.iterdir()), [])

    def test_tar_member_omission_refuses(self):
        path = Path(self.tmp.name) / 'empty.tgz'
        with tarfile.open(path, 'w:gz'):
            pass
        with self.assertRaisesRegex(ValueError, 'omitted'):
            C.verify_tar(path, self.rows)

    def test_tar_unexpected_member_and_traversal_refuse(self):
        path = Path(self.tmp.name) / 'unsafe.tgz'
        with tarfile.open(path, 'w:gz') as out:
            member = tarfile.TarInfo('../outside')
            member.size = 3
            out.addfile(member, io.BytesIO(b'bad'))
        with self.assertRaisesRegex(ValueError, 'traversal'):
            C.verify_tar(path, self.rows)

    def test_tar_hardlink_refuses(self):
        path = Path(self.tmp.name) / 'hardlink.tgz'
        row = next(row for row in self.rows if row['kind'] == 'file')
        with tarfile.open(path, 'w:gz', format=tarfile.PAX_FORMAT) as out:
            member = tarfile.TarInfo(row['path'])
            member.type = tarfile.LNKTYPE
            member.linkname = row['path']
            member.mode, member.uid, member.gid = row['mode'], row['uid'], row['gid']
            member.pax_headers = {'mtime': str(row['mtimeNs'] / 1e9), 'SCHILY.xattr.user.pow-custody': 'fixture-metadata'}
            out.addfile(member)
        with self.assertRaises(ValueError):
            C.verify_tar(path, self.rows)

    def test_row_unsafe_path_duplicate_foreign_and_hardlink_refuse(self):
        for change in ('unsafe', 'duplicate', 'foreign', 'hardlink'):
            rows = copy.deepcopy(self.rows)
            if change == 'unsafe':
                rows[0]['path'] = '../escape'
                rows.sort(key=lambda row: row['path'])
            elif change == 'duplicate':
                rows.insert(0, copy.deepcopy(rows[0]))
            elif change == 'foreign':
                rows[0]['path'] = C.FOREIGN
                rows.sort(key=lambda row: row['path'])
            else:
                next(row for row in rows if row['kind'] == 'file')['links'] = 2
            with self.subTest(change=change), self.assertRaises(ValueError):
                C.validate_rows(rows, production=False)

    def test_tar_xattrs_and_mtime_drift_refuse(self):
        for field in ('xattrs', 'mtimeNs'):
            rows = copy.deepcopy(self.rows)
            row = next(row for row in rows if row['kind'] == 'file')
            if field == 'xattrs':
                row['xattrs'] = {}
            else:
                row['mtimeNs'] += 1
            with self.subTest(field=field), self.assertRaises(ValueError):
                C.verify_tar(self.archive, rows)

    def test_missing_actual_custody_proof_refuses(self):
        with self.assertRaisesRegex(ValueError, 'Actual verified'):
            C.require_custody({'sourceRowsSha256': 'a' * 64}, {})

    def test_protected_absolute_symlinks_recorded_without_following(self):
        root = Path(self.tmp.name) / 'systemd'
        root.mkdir(mode=0o700)
        (root / 'unit.service').symlink_to('/usr/lib/systemd/system/existing.service')
        rows = C.census(root.parent, (root.name,), closed_symlinks=False)
        self.assertEqual(rows[-1]['target'], '/usr/lib/systemd/system/existing.service')
        with self.assertRaisesRegex(ValueError, 'Escaping'):
            C.census(root.parent, (root.name,))


    def test_creation_only_receipt_preserves_prior_bytes(self):
        root=Path(self.tmp.name)/'receipts';root.mkdir(mode=0o700)
        C.create_receipt(root,'first.json',{'status':'before'})
        data=(root/'first.json').read_bytes()
        self.assertEqual(json.loads(data),{'status':'before'})
        self.assertEqual(stat.S_IMODE((root/'first.json').stat().st_mode),0o600)
        with self.assertRaises(FileExistsError):C.create_receipt(root,'first.json',{'status':'overwrite'})
        self.assertEqual((root/'first.json').read_bytes(),data)

    def test_no_replace_atomic_rename_preserves_existing_target(self):
        root=Path(self.tmp.name)/'rename';root.mkdir(mode=0o700)
        (root/'source').mkdir();(root/'source/a').write_text('backup')
        (root/'target').mkdir();(root/'target/b').write_text('existing')
        fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
        try:
            with self.assertRaises(FileExistsError):C.rename_no_replace(fd,'source',fd,'target')
            self.assertEqual((root/'target/b').read_text(),'existing')
            self.assertEqual((root/'source/a').read_text(),'backup')
        finally:os.close(fd)

    def test_full_no_replace_restore_preserves_retained_receipts(self):
        before=self.protected()
        C.remove_verified_targets(self.base,self.rows,lambda:None)
        stage=Path(self.tmp.name)/'stage';stage.mkdir(mode=0o700)
        events=[]
        C.dispatch_restore(self.base,stage,self.archive,self.rows,lambda:None,lambda *e:events.append(e),original_owner=False,capacity_admission=False)
        C.compare_restored(self.base,self.rows)
        self.assertEqual(before,self.protected())
        self.assertEqual(len(events),12)

    def test_restore_new_target_at_rename_boundary_survives(self):
        C.remove_verified_targets(self.base,self.rows,lambda:None)
        stage=Path(self.tmp.name)/'stage';stage.mkdir(mode=0o700)
        def receipt(target,phase,count):
            if phase=='before' and target==C.TARGETS[0]:
                p=self.base/target;p.mkdir();(p/'unreviewed').write_text('preserve')
        with self.assertRaises(FileExistsError):C.dispatch_restore(self.base,stage,self.archive,self.rows,lambda:None,receipt,original_owner=False,capacity_admission=False)
        self.assertEqual((self.base/C.TARGETS[0]/'unreviewed').read_text(),'preserve')
        self.assertTrue((stage/C.TARGETS[0]).exists())

    def test_restore_staging_entry_injected_at_rename_boundary_refuses(self):
        C.remove_verified_targets(self.base,self.rows,lambda:None)
        stage=Path(self.tmp.name)/'stage';stage.mkdir(mode=0o700)
        def receipt(target,phase,count):
            if phase=='before' and target==C.TARGETS[0]:(stage/target/'new').write_text('must refuse')
        with self.assertRaisesRegex(ValueError,'rename boundary'):C.dispatch_restore(self.base,stage,self.archive,self.rows,lambda:None,receipt,original_owner=False,capacity_admission=False)
        self.assertFalse((self.base/C.TARGETS[0]).exists())
        self.assertEqual((stage/C.TARGETS[0]/'new').read_text(),'must refuse')

    def test_restore_parent_symlink_rejects_without_external_write(self):
        C.remove_verified_targets(self.base,self.rows,lambda:None)
        outside=Path(self.tmp.name)/'outside2';outside.mkdir()
        import shutil
        shutil.rmtree(self.base/C.RELEASES[0]);(self.base/C.RELEASES[0]).symlink_to(outside,target_is_directory=True)
        stage=Path(self.tmp.name)/'stage';stage.mkdir(mode=0o700)
        with self.assertRaises((ValueError,OSError)):C.dispatch_restore(self.base,stage,self.archive,self.rows,lambda:None,lambda *e:None,original_owner=False,capacity_admission=False)
        self.assertEqual(list(outside.iterdir()),[])


    def test_restore_capacity_byte_and_inode_reserves(self):
        from types import SimpleNamespace
        fs=SimpleNamespace(f_frsize=4096,f_bavail=4000000,f_favail=100000)
        admitted=C.restore_capacity(self.base,self.rows,500,fs)
        self.assertEqual(admitted['inboundArchiveBoundBytes'],4096)
        self.assertEqual(admitted['reserveBytes'],10*1024**3+64*1024**2)
        fs.f_bavail=100
        with self.assertRaisesRegex(ValueError,'capacity'):C.restore_capacity(self.base,self.rows,500,fs)
        fs.f_bavail=4000000;fs.f_favail=10
        with self.assertRaisesRegex(ValueError,'inode'):C.restore_capacity(self.base,self.rows,500,fs)


    def test_directory_xattrs_added_after_census_refuse(self):
        target=self.base/C.TARGETS[0]
        def receipt(name,phase,count):
            if name==C.TARGETS[0] and phase=='before':os.setxattr(target/'nested','user.unreviewed',b'preserve')
        with self.assertRaisesRegex(ValueError,'directory xattrs'):C.remove_verified_targets(self.base,self.rows,lambda:None,receipt)
        self.assertEqual(os.getxattr(target/'nested','user.unreviewed'),b'preserve')

    def test_base_relocated_after_census_refuses_before_delete(self):
        moved=Path(self.tmp.name)/'moved'
        def receipt(name,phase,count):
            if name==C.TARGETS[0] and phase=='before':self.base.rename(moved)
        with self.assertRaises((ValueError,FileNotFoundError)):C.remove_verified_targets(self.base,self.rows,lambda:None,receipt)
        self.assertEqual((moved/C.TARGETS[0]/'nested/data').read_bytes(),('fixture:'+C.TARGETS[0]).encode())

    def test_release_parent_relocated_after_census_refuses_before_delete(self):
        moved=self.base/'moved-release'
        def receipt(name,phase,count):
            if name==C.TARGETS[0] and phase=='before':(self.base/C.RELEASES[0]).rename(moved)
        with self.assertRaises((ValueError,FileNotFoundError)):C.remove_verified_targets(self.base,self.rows,lambda:None,receipt)
        self.assertEqual((moved/Path(C.TARGETS[0]).name/'nested/data').read_bytes(),('fixture:'+C.TARGETS[0]).encode())


    def test_restore_parent_relocated_at_rename_boundary_preserves_stage(self):
        C.remove_verified_targets(self.base,self.rows,lambda:None)
        stage=Path(self.tmp.name)/'stage';stage.mkdir(mode=0o700)
        moved=self.base/'relocated-parent'
        def receipt(name,phase,count):
            if name==C.TARGETS[0] and phase=='before':
                (self.base/C.RELEASES[0]).rename(moved);(self.base/C.RELEASES[0]).mkdir()
        with self.assertRaisesRegex(ValueError,'parent pathname'):C.dispatch_restore(self.base,stage,self.archive,self.rows,lambda:None,receipt,original_owner=False,capacity_admission=False)
        self.assertFalse((moved/Path(C.TARGETS[0]).name).exists())
        self.assertTrue((stage/C.TARGETS[0]/'nested/data').exists())

    def test_restore_base_relocated_at_rename_boundary_preserves_stage(self):
        C.remove_verified_targets(self.base,self.rows,lambda:None)
        stage=Path(self.tmp.name)/'stage';stage.mkdir(mode=0o700)
        moved=Path(self.tmp.name)/'relocated-base'
        def receipt(name,phase,count):
            if name==C.TARGETS[0] and phase=='before':
                self.base.rename(moved);self.base.mkdir()
        with self.assertRaisesRegex(ValueError,'base pathname'):C.dispatch_restore(self.base,stage,self.archive,self.rows,lambda:None,receipt,original_owner=False,capacity_admission=False)
        self.assertFalse((moved/C.TARGETS[0]).exists())
        self.assertTrue((stage/C.TARGETS[0]/'nested/data').exists())

if __name__ == '__main__':
    unittest.main(verbosity=2)
