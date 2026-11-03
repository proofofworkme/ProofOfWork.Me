"""Fresh receiver input compaction regression tests."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("input_compaction", Path(__file__).with_name("input_compaction.py"))
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def archive_fingerprint(root):
    rows = []
    for p in [root, *sorted(root.rglob("*"))]:
        s = p.stat(follow_symlinks=False)
        file = stat.S_ISREG(s.st_mode)
        rows.append([p.relative_to(root).as_posix(), "file" if file else "directory",
                     stat.S_IMODE(s.st_mode), s.st_uid, s.st_gid, s.st_size if file else 0,
                     hashlib.sha256(p.read_bytes()).hexdigest() if file else None])
    return {"entries": len(rows), "regularBytes": sum(row[5] for row in rows),
            "sha256": hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest()}


class CompactionTests(unittest.TestCase):
    def setUp(self):
        prior_umask = os.umask(0o022)
        self.addCleanup(os.umask, prior_umask)
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.parent = Path(self.work.name)
        self.root = self.parent / "proofofwork-ui-surfaces-0123456789ab-20261103T000000Z"
        self.files = []
        for i, surface in enumerate(("a", "a-b", "b")):
            leaf = self.root / "surfaces" / surface / "assets" / "shared.js"
            leaf.parent.mkdir(parents=True)
            leaf.write_bytes(b"unique asset body\n" * 32000)
            os.utime(leaf, ns=(1000 + i, 2000 + i))
            self.files.append(leaf)
        self.original = archive_fingerprint(self.root)
        self.journal = self.root.with_name(self.root.name + ".original-mtimes.json")
        self.owner = os.geteuid()

    def compact(self, **kwargs):
        return module.compact(self.root, self.original, self.owner, **kwargs)

    def test_disk_sharing_and_durable_original_times(self):
        directory_times = {p:p.stat().st_mtime_ns for p in self.root.rglob("*") if p.is_dir()}
        before = self.root.stat().st_ino
        result = self.compact()
        self.assertEqual(result["rootIdentity"][1], before)
        self.assertEqual(archive_fingerprint(self.root), self.original)
        self.assertEqual(result["aliasesCreated"], 2)
        self.assertEqual(result["regularInodes"], 1)
        self.assertEqual({p.stat().st_ino for p in self.files}, {self.files[0].stat().st_ino})
        self.assertEqual({p.stat().st_mtime_ns for p in self.files}, {2000})
        self.assertEqual({p:p.stat().st_mtime_ns for p in directory_times}, directory_times)
        data = self.journal.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), result["originalTimes"]["sha256"])
        recorded = {r[0]:r for r in json.loads(data)["entries"]}
        for i, p in enumerate(self.files):
            name = p.relative_to(self.root).as_posix()
            self.assertEqual(recorded[name], [name, 2000 + i, self.files[0].relative_to(self.root).as_posix()])
        verify = self.compact(check_only=True)
        self.assertEqual(verify, {**result, "aliasesCreated": 0})
        self.assertLess(result["allocatedBytes"], result["contentFingerprint"]["regularBytes"])
        with self.assertRaises(ValueError):
            self.compact()

    def test_mode_xattrs_and_bytes_determine_groups(self):
        os.chmod(self.files[1], 0o640)
        os.setxattr(self.files[2], "user.compaction", b"xattr test")
        other = self.files[0].with_name("different-content")
        other.write_bytes(b"other file")
        self.original = archive_fingerprint(self.root)
        r = self.compact()
        self.assertEqual(r["aliases"], 0)
        self.assertEqual(r["regularInodes"], 4)
        self.assertEqual(os.getxattr(self.files[2], "user.compaction"), b"xattr test")

    def test_mismatch_or_external_link_refuses_before_journal(self):
        os.link(self.files[-1], self.parent / "external")
        with self.assertRaisesRegex(ValueError, "outside"):
            self.compact()
        self.assertFalse(self.journal.exists())
        (self.parent / "external").unlink()
        self.files[-1].write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "closed inventory"):
            self.compact()
        self.assertFalse(self.journal.exists())

    def test_check_only_refuses_external_or_removed_internal_alias(self):
        self.compact()
        os.link(self.files[0], self.parent / "outside")
        with self.assertRaisesRegex(ValueError, "outside"):
            self.compact(check_only=True)
        (self.parent / "outside").unlink()
        self.files[-1].unlink()
        self.files[-1].write_bytes(self.files[0].read_bytes())
        os.utime(self.files[-1], ns=(1000, 2000))
        with self.assertRaises(ValueError):
            self.compact(check_only=True)

    def test_refuses_symlink_special_file_and_cross_mount(self):
        extra = self.files[0].with_name("extra")
        extra.symlink_to(self.files[-1])
        with self.assertRaisesRegex(ValueError, "Symlink"):
            self.compact()
        extra.unlink()
        os.mkfifo(extra)
        with self.assertRaisesRegex(ValueError, "special"):
            self.compact()
        extra.unlink()
        real = module._mount_id
        def changed_mount(fd):
            result = real(fd)
            return result + (os.fstat(fd).st_ino == self.files[0].stat().st_ino)
        with patch.object(module, "_mount_id", side_effect=changed_mount), self.assertRaisesRegex(ValueError, "mount"):
            self.compact()
        self.assertFalse(self.journal.exists())

    def test_failed_second_replace_keeps_original_evidence_without_false_completion(self):
        replace = os.replace
        count = 0
        def interrupted(*args, **kwargs):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError("Injected replace failure")
            return replace(*args, **kwargs)
        with patch.object(os, "replace", side_effect=interrupted), self.assertRaisesRegex(OSError, "Injected"):
            self.compact()
        self.assertTrue(self.journal.exists())
        self.assertFalse(list(self.root.rglob(".pow-input-link-*")))
        self.assertEqual(self.files[0].stat().st_nlink, 2)
        with self.assertRaises(ValueError):
            self.compact(check_only=True)
        with self.assertRaises(ValueError):
            self.compact()

    def test_byte_equality_rechecked_before_link(self):
        different = b"z" * self.files[-1].stat().st_size
        self.files[-1].write_bytes(different)
        original = module._file_digest
        digest = hashlib.sha256(self.files[0].read_bytes()).hexdigest()
        with patch.object(module, "_file_digest", return_value=digest):
            with self.assertRaisesRegex(ValueError, "bytes differ"):
                self.compact()
        self.assertEqual(self.files[-1].read_bytes(), different)
        self.assertIs(module._file_digest, original)

    def test_fresh_parent_is_required_and_journal_never_overwritten(self):
        self.journal.symlink_to(self.files[0])
        with self.assertRaises(FileExistsError):
            self.compact()
        self.assertEqual(self.files[0].stat().st_nlink, 1)
        alias = self.parent / "redirect"
        alias.symlink_to(self.parent)
        with self.assertRaises(OSError):
            module.compact(alias / self.root.name, self.original, self.owner)

    def test_expected_journal_pin_protects_original_alias_timestamp(self):
        receipt = self.compact()
        pin = receipt["originalTimes"]["sha256"]
        self.assertEqual(self.compact(check_only=True, journal_sha256=pin)["originalTimes"]["sha256"], pin)
        data = json.loads(self.journal.read_bytes())
        alias = next(row for row in data["entries"] if row[2] and row[0] != row[2])
        alias[1] += 1
        self.journal.write_bytes(json.dumps(data, separators=(",", ":")).encode() + b"\n")
        with self.assertRaisesRegex(ValueError, "pin differs"):
            self.compact(check_only=True, journal_sha256=pin)

    def test_source_replacement_during_link_fails_closed(self):
        link = os.link
        source = self.files[0]
        foreign = self.parent / "unrelated"
        foreign.write_bytes(b"foreign")
        def raced(*args, **kwargs):
            source.unlink()
            link(foreign, source)
            return link(*args, **kwargs)
        with patch.object(os, "link", side_effect=raced), self.assertRaises((OSError, ValueError)):
            self.compact()
        self.assertEqual(self.files[1].stat().st_nlink, 1)
        self.assertEqual(foreign.read_bytes(), b"foreign")
        self.assertEqual(foreign.stat().st_nlink, 2)
        self.assertFalse(list(self.root.rglob(".pow-input-link-*")))
        with self.assertRaises(ValueError):
            self.compact(check_only=True)


if __name__ == "__main__":
    unittest.main()
