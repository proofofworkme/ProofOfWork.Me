#!/usr/bin/python3
"""Read-only, integer allocation guards shared by UI deployment helpers.

There are deliberately no environment/CLI overrides for space or reserve values.
The root filesystem retains 10 GiB plus 64 MiB of concurrent-growth headroom;
separate allocation filesystems retain 64 MiB as well. Measurements charge the
full next copy, including sparse files and duplicate/hardlinked bytes.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import tarfile

ROOT_RESERVE_BYTES = 10 * 1024**3
GROWTH_RESERVE_BYTES = 64 * 1024**2
INODE_RESERVE = 128
MAX_ARCHIVE_ENTRIES = 10000
MAX_ARCHIVE_BYTES = 1024**3
MAX_TREE_ENTRIES = 100000


class CapacityError(RuntimeError):
    pass


def integer(value: int, label: str) -> int:
    if type(value) is not int or value < 0:
        raise CapacityError(f"{label} must be a nonnegative integer")
    return value


def rounded(size: int, block: int) -> int:
    integer(size, "Allocation size")
    if type(block) is not int or block < 1:
        raise CapacityError("Filesystem allocation block must be positive")
    return ((size + block - 1) // block) * block


def canonical_directory(path: Path) -> os.stat_result:
    details = path.lstat()
    if not stat.S_ISDIR(details.st_mode) or path.resolve() != path:
        raise CapacityError(f"Allocation target must be an existing canonical directory: {path}")
    return details


def allocation_block(path: Path) -> int:
    canonical_directory(path)
    value = os.statvfs(path)
    # f_frsize measures available bytes; f_bsize is the conservative IO/data
    # allocation unit when a filesystem reports a smaller fragment size.
    return max(integer(value.f_frsize, "Fragment size"), integer(value.f_bsize, "Block size"), 4096)


def entry_bytes(size: int, block: int, *, xattr_bytes: int = 0) -> int:
    # Four blocks cover directory/inode/extent and parent-directory metadata.
    # Charge attributes separately, including names and per-attribute overhead.
    return rounded(size, block) + 4 * block + rounded(xattr_bytes, block)


def check_capacity(path: Path, additional_bytes: int, additional_inodes: int, phase: str) -> dict:
    integer(additional_bytes, "Additional bytes")
    integer(additional_inodes, "Additional inodes")
    target = canonical_directory(path)
    root = canonical_directory(Path("/"))
    same_filesystem = target.st_dev == root.st_dev
    checks = []
    for target_path, extra_bytes, extra_inodes, reserve in (
        (Path("/"), additional_bytes if same_filesystem else 0,
         additional_inodes if same_filesystem else 0, ROOT_RESERVE_BYTES + GROWTH_RESERVE_BYTES),
        *(([(path, additional_bytes, additional_inodes, GROWTH_RESERVE_BYTES)]) if not same_filesystem else []),
    ):
        space = os.statvfs(target_path)
        available = integer(space.f_bavail, "Available blocks") * integer(space.f_frsize, "Fragment size")
        if space.f_frsize <= 0:
            raise CapacityError("Filesystem fragment size must be positive")
        inodes = integer(space.f_favail, "Available inodes")
        required = reserve + extra_bytes
        required_inodes = INODE_RESERVE + extra_inodes
        row = {"path": str(target_path), "availableBytes": available, "requiredBytes": required,
               "availableInodes": inodes, "requiredInodes": required_inodes}
        checks.append(row)
        if available < required or inodes < required_inodes:
            raise CapacityError("UI capacity refused " + json.dumps({"phase": phase, **row}, sort_keys=True))
    return {"status": "sufficient", "phase": phase, "allocationPath": str(path),
            "additionalBytes": additional_bytes, "additionalInodes": additional_inodes,
            "rootReserveBytes": ROOT_RESERVE_BYTES, "growthReserveBytes": GROWTH_RESERVE_BYTES,
            "checks": checks}


def identity(details: os.stat_result) -> tuple:
    return (details.st_dev, details.st_ino, details.st_mode, details.st_uid, details.st_gid,
            details.st_size, details.st_mtime_ns, details.st_ctime_ns, details.st_nlink)


def tree_bound(source: Path, destination: Path) -> dict:
    """Bound one cp --archive tree without crediting sparse extents or links."""
    if source.resolve() != source:
        raise CapacityError(f"Copy source must be canonical: {source}")
    block = allocation_block(destination)
    device = source.lstat().st_dev
    pending, snapshots = [source], []
    total, tar_bytes = 0, 10240
    while pending:
        path = pending.pop()
        details = path.lstat()
        if details.st_dev != device or not (stat.S_ISREG(details.st_mode) or stat.S_ISDIR(details.st_mode)):
            raise CapacityError(f"Copy source contains a link, special file or nested filesystem: {path}")
        snapshots.append((path, identity(details)))
        if len(snapshots) > MAX_TREE_ENTRIES:
            raise CapacityError("Copy source exceeds capacity entry bound")
        attributes = sum(len(os.fsencode(name)) + len(os.getxattr(path, name, follow_symlinks=False)) + 256
                         for name in os.listxattr(path, follow_symlinks=False))
        # Existing directory allocation is an additional conservative bound on
        # large directory indexes. Files always use full logical length.
        size = details.st_size if stat.S_ISREG(details.st_mode) else max(details.st_size, details.st_blocks * 512)
        total += entry_bytes(size, block, xattr_bytes=attributes)
        # Portable tar output must dereference any internal candidate links.
        # Charge every file's full content, conservative GNU/PAX path/attribute
        # headers and final record padding before bounding gzip expansion.
        relative_bytes = len(os.fsencode(path.relative_to(source))) + len(os.fsencode(source.name)) + 1
        tar_bytes += 4096 + 2 * rounded(relative_bytes + 1, 512) + rounded(attributes * 4, 512)
        if stat.S_ISREG(details.st_mode):
            tar_bytes += rounded(details.st_size, 512)
        if stat.S_ISDIR(details.st_mode):
            pending.extend(path.iterdir())
    for path, previous in snapshots:
        if identity(path.lstat()) != previous:
            raise CapacityError(f"Copy source changed during capacity measurement: {path}")
    tar_bytes = rounded(tar_bytes + 10240, 10240)
    gzip_upper = tar_bytes + (tar_bytes + 999) // 1000 + 65536
    return {"additionalBytes": total, "additionalInodes": len(snapshots),
            "archiveUpperBoundBytes": rounded(gzip_upper, block) + 3 * entry_bytes(0, block)}


def archive_bound(archive: Path, destination: Path) -> dict:
    """Bound validated regular/directory tar content before creating scratch."""
    block = allocation_block(destination)
    details = archive.lstat()
    if not stat.S_ISREG(details.st_mode) or archive.resolve() != archive:
        raise CapacityError("Capacity archive must be a canonical regular file")
    if details.st_size > MAX_ARCHIVE_BYTES + 16 * 1024**2:
        raise CapacityError("Capacity archive exceeds compressed size bound")
    members, paths, logical, total = 0, {}, 0, 0
    descriptor = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as handle:
        if identity(os.fstat(handle.fileno())) != identity(details):
            raise CapacityError("Capacity archive changed before measurement")
        with tarfile.open(fileobj=handle, mode="r|gz") as contents:
            for member in contents:
                members += 1
                if members > MAX_ARCHIVE_ENTRIES:
                    raise CapacityError("Capacity archive exceeds entry bound")
                name = member.name.rstrip("/")
                parts = PurePosixPath(name).parts
                if (not name or name.startswith("/") or "\\" in name or any(part in ("", ".", "..") for part in name.split("/"))
                        or len(os.fsencode(name)) > 4096 or any(ord(char) < 32 or ord(char) == 127 for char in name)):
                    raise CapacityError("Capacity archive contains an unsafe path")
                if not (member.isfile() or member.isdir()) or member.issparse():
                    raise CapacityError("Capacity archive contains a link, sparse or special entry")
                if name in paths and paths[name] != "implicit-directory":
                    raise CapacityError("Capacity archive contains a duplicate path")
                if name in paths and not member.isdir():
                    raise CapacityError("Capacity archive replaces a parent directory with a file")
                for index in range(1, len(parts)):
                    parent = "/".join(parts[:index])
                    if paths.get(parent) == "file":
                        raise CapacityError("Capacity archive places an entry below a file")
                    paths.setdefault(parent, "implicit-directory")
                paths[name] = "directory" if member.isdir() else "file"
                if len(paths) > MAX_ARCHIVE_ENTRIES:
                    raise CapacityError("Capacity archive exceeds expanded entry bound")
                size = integer(member.size, "Archive member size")
                if member.isdir() and size:
                    raise CapacityError("Capacity archive directory carries unexpected bytes")
                logical += size
                if logical > MAX_ARCHIVE_BYTES:
                    raise CapacityError("Capacity archive exceeds logical byte bound")
                total += rounded(size, block)
        if identity(os.fstat(handle.fileno())) != identity(details) or identity(archive.lstat()) != identity(details):
            raise CapacityError("Capacity archive changed during measurement")
    # One new extraction root, all explicit/implicit directories and files.
    entries = len(paths) + 1
    return {"additionalBytes": total + entries * 4 * block, "additionalInodes": entries}


def cli_integer(value: str) -> int:
    if not value.isascii() or not value.isdecimal():
        raise argparse.ArgumentTypeError("Expected nonnegative integer bytes/inodes")
    return int(value)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "check-copy", "check-archive", "check-pack", "budget"))
    parser.add_argument("--path", type=Path, required=True)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--additional-bytes", type=cli_integer, default=0)
    parser.add_argument("--additional-inodes", type=cli_integer, default=0)
    parser.add_argument("--phase", default="ui-allocation")
    args = parser.parse_args()
    if args.command == "budget":
        if args.source is None:
            parser.error("budget requires --source")
        result = tree_bound(args.source, args.path)
    else:
        bound = {"additionalBytes": 0, "additionalInodes": 0}
        if args.command == "check-archive":
            if args.archive is None:
                parser.error("check-archive requires --archive")
            bound = archive_bound(args.archive, args.path)
        elif args.command in ("check-copy", "check-pack"):
            if args.source is None:
                parser.error(f"{args.command} requires --source")
            tree = tree_bound(args.source, args.path)
            bound = ({"additionalBytes": tree["archiveUpperBoundBytes"], "additionalInodes": 3}
                     if args.command == "check-pack" else tree)
        result = check_capacity(args.path, bound["additionalBytes"] + args.additional_bytes,
                                bound["additionalInodes"] + args.additional_inodes, args.phase)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (CapacityError, OSError, tarfile.TarError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
