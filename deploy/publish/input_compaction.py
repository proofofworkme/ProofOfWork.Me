"""Compact a fresh, locked UI receiver payload. No link may escape that payload."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat


_PAYLOAD = re.compile(r"proofofwork-ui-surfaces-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z")
_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
_FILE = os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_NOATIME
_JOURNAL_LIMIT = 4 * 1024**2


def _require(ok, message):
    if not ok:
        raise ValueError(message)


def _encoded(value):
    return json.dumps(value, separators=(",", ":")).encode()


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _identity(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink,
            s.st_size, s.st_blocks, s.st_mtime_ns, s.st_ctime_ns)


@contextlib.contextmanager
def _fd(name, flags, parent=None):
    descriptor = os.open(name, flags, dir_fd=parent)
    try:
        yield descriptor
    finally:
        os.close(descriptor)


@contextlib.contextmanager
def _absolute_directory(path):
    _require(path.is_absolute() and ".." not in path.parts, "Noncanonical directory")
    with contextlib.ExitStack() as handles:
        fd = handles.enter_context(_fd("/", _DIR))
        for name in path.parts[1:]:
            fd = handles.enter_context(_fd(name, _DIR, fd))
        yield fd


def _mount_id(fd):
    values = [line.split()[1] for line in Path(f"/proc/self/fdinfo/{fd}").read_text().splitlines()
              if line.startswith("mnt_id:")]
    _require(len(values) == 1, "Mount identity unavailable")
    return int(values[0])


def _attrs(fd):
    values = []
    total = 0
    for key in sorted(os.listxattr(fd)):
        value = os.getxattr(fd, key)
        total += len(os.fsencode(key)) + len(value)
        _require(total <= 256 * 1024, "Entry xattr limit")
        values.append((key, value.hex()))
    return tuple(values)


def _file_digest(fd, before):
    digest = hashlib.sha256()
    offset = 0
    while offset < before.st_size:
        chunk = os.pread(fd, min(1024**2, before.st_size - offset), offset)
        _require(chunk, "File truncated during read")
        digest.update(chunk)
        offset += len(chunk)
    _require(_identity(os.fstat(fd)) == _identity(before), "File changed during hashing")
    return digest.hexdigest()


def _same_bytes(left, right, size):
    for offset in range(0, size, 1024**2):
        length = min(size - offset, 1024**2)
        a = os.pread(left, length, offset)
        b = os.pread(right, length, offset)
        _require(len(a) == len(b) == length and a == b, "File bytes differ despite matching digest")


def _stat_at(parent, name):
    return os.stat(name, dir_fd=parent, follow_symlinks=False)


def _scan(root_fd, owner):
    """Use the same ordered, literal rows as the archive/receiver commitment."""
    stats, attrs, hashes = {}, {}, {}
    seen_dirs = set()
    logical = xattr_bytes = 0
    mount = _mount_id(root_fd)
    device = os.fstat(root_fd).st_dev

    def visit(fd, rel):
        nonlocal logical, xattr_bytes
        s = os.fstat(fd)
        _require(s.st_dev == device and _mount_id(fd) == mount, "Nested mount in payload")
        _require(s.st_uid == owner and s.st_gid == owner and not s.st_mode & 0o7022,
                 "Unsafe payload owner or mode")
        _require(len(stats) < 30000, "Payload entry limit")
        stats[rel] = s
        attrs[rel] = _attrs(fd)
        xattr_bytes += sum(len(os.fsencode(key)) + len(value) // 2 for key, value in attrs[rel])
        _require(xattr_bytes <= 16 * 1024**2, "Payload xattr limit")
        if stat.S_ISDIR(s.st_mode):
            key = (s.st_dev, s.st_ino)
            _require(key not in seen_dirs, "Aliased directory")
            seen_dirs.add(key)
            names = []
            with os.scandir(fd) as entries:
                for entry in entries:
                    _require(len(names) + len(stats) < 30000, "Payload directory entry limit")
                    names.append(entry.name)
            if rel == ".":
                _require(names == ["surfaces"], "Expected only the received surfaces directory")
            if rel == "surfaces":
                _require(names, "Empty surfaces directory")
            for name in sorted(names):
                _require(all(ord(ch) >= 32 and ord(ch) != 127 for ch in name)
                         and "\\" not in name, "Unsafe payload name")
                path = name if rel == "." else rel + "/" + name
                _require(len(os.fsencode(path)) <= 4096 and path.count("/") < 64, "Payload path limit")
                before = _stat_at(fd, name)
                directory = stat.S_ISDIR(before.st_mode)
                _require(directory or (stat.S_ISREG(before.st_mode) and rel not in (".", "surfaces")),
                         "Symlink, special file or invalid surface in payload")
                with _fd(name, _DIR | os.O_NOATIME if directory else _FILE, fd) as child:
                    _require(_identity(os.fstat(child)) == _identity(before), "Payload entry changed at open")
                    visit(child, path)
                _require(_identity(_stat_at(fd, name)) == _identity(before), "Payload entry replaced")
        else:
            _require(s.st_size <= 96 * 1024**2, "Oversized payload file")
            logical += s.st_size
            _require(logical <= 512 * 1024**2, "Payload byte limit")
            hashes[rel] = _file_digest(fd, s)
        _require(_identity(os.fstat(fd)) == _identity(s), "Payload changed while scanning")

    visit(root_fd, ".")
    rows = [[name, "directory" if stat.S_ISDIR(s.st_mode) else "file", stat.S_IMODE(s.st_mode),
             s.st_uid, s.st_gid, s.st_size if name in hashes else 0, hashes.get(name)]
            for name, s in stats.items()]
    fingerprint = {"sha256": _sha(_encoded(rows)), "entries": len(rows), "regularBytes": logical}
    return stats, attrs, hashes, fingerprint


def _layout(stats, attrs, hashes):
    classes, canonical, inodes = {}, {}, {}
    for name, digest in hashes.items():
        s = stats[name]
        key = (digest, s.st_size, s.st_mode, s.st_uid, s.st_gid, attrs[name])
        canonical[name] = classes.setdefault(key, name)
        inodes.setdefault((s.st_dev, s.st_ino), []).append(name)
    for names in inodes.values():
        _require(all(stats[n].st_nlink == len(names) for n in names), "Regular link outside payload")
    return canonical, inodes


@contextlib.contextmanager
def _parent(root, relative, stats):
    with contextlib.ExitStack() as stack:
        parent = root
        mount = _mount_id(root)
        parts = relative.split("/")
        for i, name in enumerate(parts[:-1]):
            parent = stack.enter_context(_fd(name, _DIR | os.O_NOATIME, parent))
            _require(_mount_id(parent) == mount
                     and _identity(os.fstat(parent)) == _identity(stats["/".join(parts[:i+1])]),
                     "Payload ancestor changed")
        yield parent, parts[-1]


def _alias(root, source, target, stats):
    with _parent(root, source, stats) as (sp, sn), _parent(root, target, stats) as (tp, tn), \
            _fd(sn, _FILE, sp) as src, _fd(tn, _FILE, tp) as dst:
        ss, ts = os.fstat(src), os.fstat(dst)
        _require(_mount_id(src) == _mount_id(dst) == _mount_id(root)
                 and _identity(ss) == _identity(stats[source]) and _identity(ts) == _identity(stats[target])
                 and ts.st_nlink == 1 and ss.st_ino != ts.st_ino, "Changed source or target inode")
        _same_bytes(src, dst, ss.st_size)
        _require(_identity(os.fstat(src)) == _identity(ss) == _identity(_stat_at(sp, sn))
                 and _identity(os.fstat(dst)) == _identity(ts) == _identity(_stat_at(tp, tn)),
                 "File changed during alias comparison")
        parent_before = os.fstat(tp)
        temp = ".pow-input-link-" + secrets.token_hex(16)
        # linkat follows only this process's pinned file descriptor. A raced
        # pathname can never create a temporary alias to a replacement object.
        os.link(f"/proc/self/fd/{src}", temp, dst_dir_fd=tp, follow_symlinks=True)
        try:
            ss_linked = os.fstat(src)
            _require(_identity(ss_linked) == _identity(_stat_at(tp, temp)) == _identity(_stat_at(sp, sn))
                     and ss_linked.st_nlink == ss.st_nlink + 1
                     and _identity(ss_linked)[:5] == _identity(ss)[:5]
                     and _identity(ss_linked)[6:9] == _identity(ss)[6:9]
                     and _identity(_stat_at(tp, tn)) == _identity(ts), "Alias race before replacement")
            os.replace(temp, tn, src_dir_fd=tp, dst_dir_fd=tp)
            source_after = os.fstat(src)
            _require(_identity(source_after) == _identity(_stat_at(tp, tn)) == _identity(_stat_at(sp, sn))
                     and source_after.st_nlink == ss.st_nlink + 1 and os.fstat(dst).st_nlink == 0,
                     "Unexpected alias replacement")
            os.fsync(src)
            os.utime(tp, ns=(parent_before.st_atime_ns, parent_before.st_mtime_ns))
            os.fsync(tp)
            stats[source] = source_after
            stats[target] = source_after
            stats[target.rsplit("/", 1)[0]] = os.fstat(tp)
        finally:
            try:
                leftover = _stat_at(tp, temp)
            except FileNotFoundError:
                pass
            else:
                if (leftover.st_dev, leftover.st_ino) == (ss.st_dev, ss.st_ino):
                    os.unlink(temp, dir_fd=tp)
                    os.fsync(tp)


def _times(path, value, check_only, owner):
    with _absolute_directory(path.parent) as parent:
        d = os.fstat(parent)
        _require(d.st_uid == owner and d.st_gid == owner and not d.st_mode & 0o7022,
                 "Unsafe timestamp journal parent")
        if check_only:
            with _fd(path.name, _FILE, parent) as descriptor:
                s = os.fstat(descriptor)
                _require(stat.S_ISREG(s.st_mode) and s.st_uid == owner and s.st_gid == owner
                         and s.st_nlink == 1 and stat.S_IMODE(s.st_mode) == 0o600 and s.st_size <= _JOURNAL_LIMIT,
                         "Unsafe timestamp journal")
                with os.fdopen(os.dup(descriptor), "rb") as stream:
                    raw = stream.read(_JOURNAL_LIMIT + 1)
                _require(len(raw) == s.st_size and _identity(s) == _identity(os.fstat(descriptor))
                         == _identity(_stat_at(parent, path.name)), "Timestamp journal changed")
            saved = json.loads(raw)
            _require(raw == _encoded(saved) + b"\n", "Noncanonical timestamp journal")
        else:
            saved = value
            raw = _encoded(saved) + b"\n"
            _require(len(raw) <= _JOURNAL_LIMIT, "Original timestamp evidence exceeds limit")
            descriptor = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 0o600, dir_fd=parent)
            with os.fdopen(descriptor, "wb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.fsync(parent)
    return saved, {"name": path.name, "sha256": _sha(raw), "bytes": len(raw)}


def compact(root, expected_fingerprint, owner=0, check_only=False, *, journal_path=None, journal_sha256=None):
    """Under the receiver/deploy lock, compact once or verify a finished received tree.

    File bytes, owner, permission bits and xattrs are exact. Duplicate paths share
    the first path's mtime; original per-path mtimes are journaled before linking.
    A failed first attempt cannot resume by calling the mutator again.
    """
    root = Path(root)
    _require(_PAYLOAD.fullmatch(root.name) and type(owner) is int and type(check_only) is bool,
             "Expected a release-specific received payload")
    _require(journal_sha256 is None or check_only and re.fullmatch(r"[0-9a-f]{64}", journal_sha256),
             "Unexpected timestamp journal pin")
    journal = Path(journal_path) if journal_path is not None else root.with_name(root.name + ".original-mtimes.json")
    _require(journal.name == root.name + ".original-mtimes.json" and not journal.is_relative_to(root),
             "Timestamp journal must be separate and release-bound")
    with _absolute_directory(root.parent) as base, _fd(root.name, _DIR | os.O_NOATIME, base) as fd:
        def anchored():
            # Re-open the complete path as well as checking its anchored parent.
            with _absolute_directory(root) as reopened:
                _require(_identity(os.fstat(fd)) == _identity(os.fstat(reopened)) == _identity(_stat_at(base, root.name))
                         and _mount_id(fd) == _mount_id(base) == _mount_id(reopened), "Payload anchor changed")

        anchored()
        stats, attrs, hashes, fingerprint = _scan(fd, owner)
        _require(fingerprint == expected_fingerprint, "Received content differs from closed inventory")
        canonical, inodes = _layout(stats, attrs, hashes)
        root_id = [stats["."].st_dev, stats["."].st_ino]
        if not check_only:
            _require(all(len(names) == 1 for names in inodes.values()), "Fresh receiver input contains aliases")
        rows = [[name, s.st_mtime_ns, canonical.get(name)] for name, s in stats.items()]
        journal_head = {"format": "pow-ui-input-original-mtimes-v1", "payload": root.name,
                        "rootIdentity": root_id, "contentFingerprint": fingerprint}
        saved, times = _times(journal, {**journal_head, "entries": rows}, check_only, owner)
        _require(journal_sha256 in (None, times["sha256"]), "Timestamp journal pin differs")
        _require(isinstance(saved, dict) and set(saved) == {*journal_head, "entries"}
                 and all(saved[k] == v for k, v in journal_head.items()), "Journal describes different input")
        saved_rows = saved["entries"]
        _require(isinstance(saved_rows, list) and len(saved_rows) == len(rows), "Timestamp entry count differs")
        original = {}
        for row, actual in zip(saved_rows, rows):
            _require(isinstance(row, list) and len(row) == 3 and row[0] == actual[0] and row[2] == actual[2]
                     and type(row[1]) is int, "Timestamp path or alias map differs")
            original[row[0]] = row[1]
        created = 0
        if not check_only:
            for target, source in canonical.items():
                if target != source:
                    anchored()
                    _alias(fd, source, target, stats)
                    created += 1
        current, final_attrs, final_hashes, after = _scan(fd, owner)
        final_canonical, final_inodes = _layout(current, final_attrs, final_hashes)
        _require(after == fingerprint and final_canonical == canonical and final_attrs == attrs,
                 "Content or metadata changed during compaction")
        for name, s in current.items():
            representative = canonical.get(name, name)
            _require(_identity(s) == _identity(stats[representative])
                     and s.st_ino == current[representative].st_ino and s.st_mtime_ns == original[representative],
                     "Incomplete aliases or changed canonical timestamp")
            if name != ".":
                with _parent(fd, name, current) as (parent, child):
                    _require(_identity(_stat_at(parent, child)) == _identity(s), "Final entry identity changed")
        _require(_times(journal, None, True, owner)[1] == times, "Timestamp journal replaced")
        anchored()
        unique = {(s.st_dev, s.st_ino): s for s in current.values()}
        block = os.fstatvfs(fd).f_frsize
        _require(block > 0, "Invalid allocation block")
        allocated = sum(s.st_blocks * 512 for s in unique.values())
        charged = sum(max(s.st_blocks * 512, ((s.st_size + block - 1) // block) * block)
                      for s in unique.values()) + block * len(current)
        topology = _sha(_encoded([[name, rep] for name, rep in canonical.items()]))
        identity = _sha(_encoded([[n, _identity(s), final_attrs[n]] for n, s in current.items()]))
        return {"format": "pow-ui-received-input-compaction-v1", "contentFingerprint": after,
                "rootIdentity": root_id, "uniqueInodes": len(unique), "regularInodes": len(final_inodes),
                "aliases": len(final_hashes) - len(final_inodes), "aliasesCreated": created,
                "allocatedBytes": allocated, "chargedBytes": charged, "topologySha256": topology,
                "identitySha256": identity, "originalTimes": times}
