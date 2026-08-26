#!/usr/bin/python3
"""Construct one exact, compatibility-complete ProofOfWork UI release root."""

from __future__ import annotations

import argparse
import ctypes
import errno
import fcntl
import hashlib
import os
import re
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import TypedDict


SURFACES = (
    "activity",
    "browser",
    "computer",
    "desktop",
    "growth",
    "id",
    "inception",
    "infinity",
    "landing",
    "marketplace",
    "nft",
    "token",
    "wallet",
    "work",
)
COMPATIBILITY_MODEL = "proofofwork-ui-prior-asset-closure-v1"
MAXIMUM_INDEX_BYTES = 2 * 1024 * 1024
MAXIMUM_ASSET_BYTES = 64 * 1024 * 1024
MAXIMUM_TOTAL_BYTES = 512 * 1024 * 1024
MAXIMUM_DEPENDENCIES = 256
MAXIMUM_REFERENCE_EDGES = 4096
MAXIMUM_REFERENCE_CANDIDATES = 262144
MAXIMUM_PAYLOAD_ENTRIES = 10000
MAXIMUM_PAYLOAD_BYTES = 1024 * 1024 * 1024
MANIFEST_NAME = ".proofofwork-ui-release"

QUOTED_REFERENCE_PATTERN = re.compile(
    rb'''["'`](?P<reference>[^"'`?#\x00-\x20]+)'''
)
CSS_URL_PATTERN = re.compile(
    rb'''url\(\s*["']?(?P<reference>[^)"'?#\x00-\x20]+)''',
    re.IGNORECASE,
)
CSS_IMPORT_PATTERN = re.compile(
    rb'''@import\s+(?:url\(\s*)?["']?(?P<reference>[^)"';?#\x00-\x20]+)''',
    re.IGNORECASE,
)


class StageError(RuntimeError):
    pass


class PayloadBudget(TypedDict):
    label: str
    entries: int
    regular_bytes: int
    maximum_entries: int
    maximum_bytes: int


def fail(message: str) -> None:
    raise StageError(message)


def safe_release_id(value: str) -> bool:
    return re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", value) is not None


def path_is_canonical_directory(path: Path) -> bool:
    try:
        details = path.lstat()
    except FileNotFoundError:
        return False
    return (
        stat.S_ISDIR(details.st_mode)
        and not stat.S_ISLNK(details.st_mode)
        and Path(os.path.realpath(path)) == path
    )


def canonical_safe_directory(path: Path, label: str, expected_owner: int) -> os.stat_result:
    if not path_is_canonical_directory(path):
        fail(f"{label} must be a real canonical directory: {path}")
    details = path.lstat()
    if details.st_uid != expected_owner or details.st_mode & 0o7022:
        fail(f"{label} must be owner-controlled and not group/world writable: {path}")
    return details


def canonical_safe_regular_file(path: Path, label: str, expected_owner: int) -> os.stat_result:
    try:
        details = path.lstat()
    except FileNotFoundError as error:
        raise StageError(f"{label} is missing: {path}") from error
    if (
        not stat.S_ISREG(details.st_mode)
        or stat.S_ISLNK(details.st_mode)
        or Path(os.path.realpath(path)) != path
        or details.st_uid != expected_owner
        or details.st_mode & 0o7022
    ):
        fail(f"{label} must be an owner-controlled canonical regular file: {path}")
    return details


def mount_path(value: str) -> Path:
    return Path(
        value.replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\012", "\n")
        .replace("\\134", "\\")
    ).resolve()


def reject_nested_mounts(directory: Path, mountinfo: Path) -> None:
    try:
        mount_details = mountinfo.lstat()
    except FileNotFoundError as error:
        raise StageError(f"Mount metadata is missing: {mountinfo}") from error
    if not stat.S_ISREG(mount_details.st_mode) or stat.S_ISLNK(mount_details.st_mode):
        fail(f"Mount metadata must be a regular, non-symlink file: {mountinfo}")
    root = directory.resolve()
    with mountinfo.open(encoding="utf-8") as source:
        for line in source:
            fields = line.split()
            if len(fields) < 5:
                fail("Mount metadata contains a malformed record.")
            mounted = mount_path(fields[4])
            try:
                nested = mounted == root or os.path.commonpath((root, mounted)) == str(root)
            except ValueError:
                nested = False
            if nested:
                fail(f"UI release tree contains a nested mount: {mounted}")


def add_field(digest: "hashlib._Hash", value: bytes) -> None:
    digest.update(struct.pack(">Q", len(value)))
    digest.update(value)


def file_identity(details: os.stat_result) -> tuple[int, ...]:
    return (
        details.st_dev,
        details.st_ino,
        details.st_mode,
        details.st_uid,
        details.st_gid,
        details.st_size,
        details.st_mtime_ns,
        details.st_ctime_ns,
    )


def digest_regular_file(
    path: Path,
    expected: os.stat_result,
    *,
    capture: bool = False,
) -> tuple[bytes, bytes]:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    digest = hashlib.sha256()
    captured: list[bytes] = []
    try:
        if file_identity(os.fstat(descriptor)) != file_identity(expected):
            fail(f"File changed during hashing: {path}")
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            if capture:
                captured.append(chunk)
        if file_identity(os.fstat(descriptor)) != file_identity(expected):
            fail(f"File changed during hashing: {path}")
    finally:
        os.close(descriptor)
    return digest.digest(), b"".join(captured)


def safe_relative(relative: str, label: str) -> None:
    if (
        not relative
        or relative.startswith("/")
        or "\\" in relative
        or any(part in ("", ".", "..") for part in relative.split("/"))
        or any(ord(character) < 32 or ord(character) == 127 for character in relative)
    ):
        fail(f"Unsafe {label} path: {relative!r}")


def validate_payload_limits(
    label: str,
    entry_count: int,
    regular_bytes: int,
    maximum_entries: int,
    maximum_bytes: int,
) -> None:
    if entry_count > maximum_entries or regular_bytes > maximum_bytes:
        fail(
            f"{label} exceeds the entry-count or 1 GiB archive safety limit: "
            f"entries={entry_count}/{maximum_entries} "
            f"bytes={regular_bytes}/{maximum_bytes}"
        )


def charge_payload_budget(
    details: os.stat_result,
    aggregate_budget: PayloadBudget | None,
) -> None:
    if aggregate_budget is None:
        return
    aggregate_budget["entries"] += 1
    if stat.S_ISREG(details.st_mode):
        aggregate_budget["regular_bytes"] += details.st_size
    validate_payload_limits(
        aggregate_budget["label"],
        aggregate_budget["entries"],
        aggregate_budget["regular_bytes"],
        aggregate_budget["maximum_entries"],
        aggregate_budget["maximum_bytes"],
    )


def tree_fingerprint(
    root: Path,
    *,
    excluded_top_level: set[str] | None = None,
    require_public: bool = False,
    expected_owner: int | None = None,
    aggregate_budget: PayloadBudget | None = None,
) -> tuple[int, int, str]:
    excluded = excluded_top_level or set()
    root = root.resolve()
    root_details = root.lstat()
    root_device = root_details.st_dev
    digest = hashlib.sha256()
    count = 0
    regular_bytes = 0

    def record(relative: str, kind: bytes, details: os.stat_result, evidence: bytes = b"") -> None:
        nonlocal count
        add_field(digest, os.fsencode(relative))
        add_field(digest, kind)
        add_field(digest, f"{stat.S_IMODE(details.st_mode):04o}".encode("ascii"))
        add_field(digest, str(details.st_uid).encode("ascii"))
        add_field(digest, str(details.st_gid).encode("ascii"))
        add_field(digest, evidence)
        count += 1

    def walk(directory: Path, relative_directory: str = "") -> None:
        nonlocal regular_bytes
        try:
            entries = sorted(os.scandir(directory), key=lambda entry: os.fsencode(entry.name))
        except OSError as error:
            raise StageError(f"Unable to enumerate UI release tree: {directory}: {error}") from error
        for entry in entries:
            if not relative_directory and entry.name in excluded:
                continue
            relative = entry.name if not relative_directory else f"{relative_directory}/{entry.name}"
            safe_relative(relative, "UI release")
            details = entry.stat(follow_symlinks=False)
            if details.st_dev != root_device:
                fail(f"UI release tree crosses a filesystem boundary: {entry.path}")
            if not stat.S_ISDIR(details.st_mode) and not stat.S_ISREG(details.st_mode):
                fail(f"UI release tree contains an unsupported file type: {entry.path}")
            charge_payload_budget(details, aggregate_budget)
            if expected_owner is not None and details.st_uid != expected_owner:
                fail(f"UI release tree contains foreign-owned content: {entry.path}")
            if details.st_mode & 0o7022:
                fail(f"UI release tree contains an unsafe writable or special mode: {entry.path}")
            if stat.S_ISDIR(details.st_mode):
                if require_public and stat.S_IMODE(details.st_mode) & 0o005 != 0o005:
                    fail(f"UI release directory is not publicly readable by the web server: {entry.path}")
                record(relative, b"directory", details)
                walk(Path(entry.path), relative)
            elif stat.S_ISREG(details.st_mode):
                if require_public and stat.S_IMODE(details.st_mode) & 0o004 != 0o004:
                    fail(f"UI release file is not publicly readable by the web server: {entry.path}")
                file_digest, _ = digest_regular_file(Path(entry.path), details)
                regular_bytes += details.st_size
                record(relative, b"file", details, file_digest)

    if expected_owner is not None and root_details.st_uid != expected_owner:
        fail(f"UI release tree contains a foreign-owned root: {root}")
    if root_details.st_mode & 0o7022:
        fail(f"UI release root contains an unsafe writable or special mode: {root}")
    if require_public and stat.S_IMODE(root_details.st_mode) & 0o005 != 0o005:
        fail(f"UI release root is not publicly readable by the web server: {root}")
    charge_payload_budget(root_details, aggregate_budget)
    record(".", b"directory", root_details)
    walk(root)
    return count, regular_bytes, digest.hexdigest()


def surface_fingerprint(
    root: Path,
    surface: str,
    expected_owner: int,
    aggregate_budget: PayloadBudget | None = None,
) -> tuple[int, int, str]:
    directory = root / f"proofofwork-{surface}"
    canonical_safe_directory(directory, f"UI surface {surface}", expected_owner)
    return tree_fingerprint(
        directory,
        require_public=True,
        expected_owner=expected_owner,
        aggregate_budget=aggregate_budget,
    )


def payload_surface_fingerprint(
    surfaces_root: Path,
    surface: str,
    expected_owner: int,
    aggregate_budget: PayloadBudget | None = None,
) -> tuple[int, int, str]:
    directory = surfaces_root / surface
    canonical_safe_directory(directory, f"New-build UI surface {surface}", expected_owner)
    return tree_fingerprint(
        directory,
        require_public=True,
        expected_owner=expected_owner,
        aggregate_budget=aggregate_budget,
    )


def managed_fingerprint(root: Path, expected_owner: int) -> tuple[tuple[str, tuple[int, int, str]], ...]:
    return tuple(
        (surface, surface_fingerprint(root, surface, expected_owner))
        for surface in SURFACES
    )


def new_payload_budget(
    label: str,
    maximum_entries: int,
    maximum_bytes: int,
) -> PayloadBudget:
    budget = {
        "label": label,
        # The eventual archive also contains its one common `surfaces/` root.
        "entries": 1,
        "regular_bytes": 0,
        "maximum_entries": maximum_entries,
        "maximum_bytes": maximum_bytes,
    }
    validate_payload_limits(label, 1, 0, maximum_entries, maximum_bytes)
    return budget


def bounded_payload_fingerprint(
    surfaces_root: Path,
    expected_owner: int,
    maximum_entries: int,
    maximum_bytes: int,
) -> tuple[tuple[tuple[str, tuple[int, int, str]], ...], int, int]:
    budget = new_payload_budget(
        "Incoming managed UI payload",
        maximum_entries,
        maximum_bytes,
    )
    fingerprints = tuple(
        (
            surface,
            payload_surface_fingerprint(
                surfaces_root,
                surface,
                expected_owner,
                aggregate_budget=budget,
            ),
        )
        for surface in SURFACES
    )
    return fingerprints, budget["entries"], budget["regular_bytes"]


def bounded_managed_fingerprint(
    root: Path,
    expected_owner: int,
    maximum_entries: int,
    maximum_bytes: int,
    label: str,
) -> tuple[tuple[tuple[str, tuple[int, int, str]], ...], int, int]:
    budget = new_payload_budget(label, maximum_entries, maximum_bytes)
    fingerprints = tuple(
        (
            surface,
            surface_fingerprint(
                root,
                surface,
                expected_owner,
                aggregate_budget=budget,
            ),
        )
        for surface in SURFACES
    )
    return fingerprints, budget["entries"], budget["regular_bytes"]


def passthrough_fingerprint(root: Path) -> tuple[int, int, str]:
    excluded = {MANIFEST_NAME, *(f"proofofwork-{surface}" for surface in SURFACES)}
    return tree_fingerprint(root, excluded_top_level=excluded)


def validate_surface_index(directory: Path) -> None:
    index = directory / "index.html"
    details = canonical_safe_regular_file(index, "UI surface index", os.geteuid())
    if details.st_size > MAXIMUM_INDEX_BYTES:
        fail(f"UI surface index exceeds validation bound: {index}")
    _, index_bytes = digest_regular_file(index, details, capture=True)
    asset_references = sorted(set(re.findall(rb"/assets/[A-Za-z0-9._/-]+", index_bytes)))
    if not asset_references:
        fail(f"UI surface index has no local asset references: {directory}")
    for raw_reference in asset_references:
        reference = raw_reference.decode("ascii")
        if ".." in reference:
            fail(f"UI surface index references an unsafe asset: {directory}{reference}")
        asset = directory.joinpath(*reference.removeprefix("/").split("/"))
        canonical_safe_regular_file(asset, "UI surface index asset", os.geteuid())


def validate_exact_surfaces_root(
    surfaces_root: Path,
    expected_owner: int,
    maximum_entries: int,
    maximum_bytes: int,
) -> tuple[tuple[tuple[str, tuple[int, int, str]], ...], int, int]:
    actual = {entry.name for entry in os.scandir(surfaces_root)}
    expected = set(SURFACES)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        fail(f"New-build surfaces root must contain exactly 14 surfaces; missing={missing} extra={extra}")
    fingerprints, entry_count, regular_bytes = bounded_payload_fingerprint(
        surfaces_root,
        expected_owner,
        maximum_entries,
        maximum_bytes,
    )
    for surface in SURFACES:
        validate_surface_index(surfaces_root / surface)
    fingerprint_by_surface = dict(fingerprints)
    if fingerprint_by_surface["computer"] != fingerprint_by_surface["nft"]:
        fail("NFT compatibility alias must exactly match Computer paths, types, bytes, modes, and ownership.")
    return fingerprints, entry_count, regular_bytes


def resolve_reference(surface_root: Path, current_path: Path, reference_bytes: bytes) -> str | None:
    try:
        reference = reference_bytes.decode("ascii")
    except UnicodeDecodeError:
        return None
    if "\\" in reference or any(ord(character) < 32 or ord(character) == 127 for character in reference):
        return None
    assets_root = surface_root / "assets"
    if reference.startswith("/assets/"):
        resolved = assets_root / reference.removeprefix("/assets/")
    elif reference.startswith("assets/"):
        resolved = surface_root / reference
    elif reference.startswith("//") or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", reference):
        return None
    elif reference.startswith("/"):
        resolved = surface_root / reference.removeprefix("/")
    else:
        resolved = current_path.parent / reference
    resolved = Path(os.path.normpath(resolved))
    try:
        if os.path.commonpath((surface_root, resolved)) != str(surface_root):
            return None
    except ValueError:
        return None
    relative = os.path.relpath(resolved, surface_root).replace(os.sep, "/")
    try:
        safe_relative(relative, "compatibility dependency")
    except StageError:
        return None
    live_path = surface_root.joinpath(*relative.split("/"))
    if not os.path.lexists(live_path):
        return None
    details = live_path.lstat()
    if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode):
        return None
    return relative


def dependency_references(
    surface_root: Path,
    current_path: Path,
    content: bytes,
    counters: dict[str, int],
) -> list[str]:
    references: list[str] = []
    patterns = [QUOTED_REFERENCE_PATTERN]
    if current_path.suffix.lower() == ".css":
        patterns.extend((CSS_URL_PATTERN, CSS_IMPORT_PATTERN))
    for pattern in patterns:
        for match in pattern.finditer(content):
            counters["reference_candidates"] += 1
            if counters["reference_candidates"] > MAXIMUM_REFERENCE_CANDIDATES:
                fail("Prior UI compatibility reference-candidate bound exceeded.")
            relative = resolve_reference(surface_root, current_path, match.group("reference"))
            if relative is not None:
                counters["reference_edges"] += 1
                if counters["reference_edges"] > MAXIMUM_REFERENCE_EDGES:
                    fail("Prior UI compatibility reference-edge bound exceeded.")
                references.append(relative)
    return references


def ensure_stage_parent_directories(
    live_surface: Path,
    stage_surface: Path,
    relative: str,
) -> None:
    parts = relative.split("/")[:-1]
    live_cursor = live_surface
    stage_cursor = stage_surface
    for part in parts:
        live_cursor /= part
        stage_cursor /= part
        live_details = live_cursor.lstat()
        if not stat.S_ISDIR(live_details.st_mode) or stat.S_ISLNK(live_details.st_mode):
            fail(f"Prior UI compatibility parent is not a real directory: {live_cursor}")
        if os.path.lexists(stage_cursor):
            stage_details = stage_cursor.lstat()
            if not stat.S_ISDIR(stage_details.st_mode) or stat.S_ISLNK(stage_details.st_mode):
                fail(f"Staged UI compatibility parent is not a real directory: {stage_cursor}")
            continue
        os.mkdir(stage_cursor, stat.S_IMODE(live_details.st_mode))
        if os.geteuid() == 0:
            os.chown(stage_cursor, live_details.st_uid, live_details.st_gid)
        os.chmod(stage_cursor, stat.S_IMODE(live_details.st_mode))
        os.utime(stage_cursor, ns=(live_details.st_atime_ns, live_details.st_mtime_ns))


def copy_prior_file(
    source: Path,
    source_details: os.stat_result,
    destination: Path,
    expected_digest: bytes,
) -> None:
    source_fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    destination_fd: int | None = None
    created_identity: tuple[int, int] | None = None
    copied_digest = hashlib.sha256()
    try:
        if file_identity(os.fstat(source_fd)) != file_identity(source_details):
            fail(f"Prior UI compatibility dependency changed before copying: {source}")
        destination_fd = os.open(
            destination,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_NOFOLLOW", 0),
            stat.S_IMODE(source_details.st_mode),
        )
        opened_destination = os.fstat(destination_fd)
        created_identity = (opened_destination.st_dev, opened_destination.st_ino)
        while True:
            chunk = os.read(source_fd, 1024 * 1024)
            if not chunk:
                break
            copied_digest.update(chunk)
            view = memoryview(chunk)
            while view:
                written = os.write(destination_fd, view)
                if written < 1:
                    fail(f"Prior UI compatibility dependency copy made no progress: {source}")
                view = view[written:]
        if file_identity(os.fstat(source_fd)) != file_identity(source_details):
            fail(f"Prior UI compatibility dependency changed while copying: {source}")
        if copied_digest.digest() != expected_digest:
            fail(f"Prior UI compatibility dependency digest changed while copying: {source}")
        if os.geteuid() == 0:
            os.fchown(destination_fd, source_details.st_uid, source_details.st_gid)
        os.fchmod(destination_fd, stat.S_IMODE(source_details.st_mode))
        os.fsync(destination_fd)
    except BaseException:
        if destination_fd is not None:
            os.close(destination_fd)
            destination_fd = None
        if created_identity is not None:
            try:
                actual = destination.lstat()
                if (actual.st_dev, actual.st_ino) == created_identity:
                    destination.unlink()
            except FileNotFoundError:
                pass
        raise
    finally:
        os.close(source_fd)
        if destination_fd is not None:
            os.close(destination_fd)
    os.utime(
        destination,
        ns=(source_details.st_atime_ns, source_details.st_mtime_ns),
        follow_symlinks=False,
    )


def copy_prior_asset_compatibility(live_root: Path, stage_root: Path) -> tuple[int, int]:
    counters = {
        "dependencies": 0,
        "reference_edges": 0,
        "reference_candidates": 0,
        "total_bytes": 0,
    }
    for surface in SURFACES:
        surface_relative = f"proofofwork-{surface}"
        live_surface = live_root / surface_relative
        stage_surface = stage_root / surface_relative
        live_index = live_surface / "index.html"
        index_details = live_index.lstat()
        if (
            not stat.S_ISREG(index_details.st_mode)
            or stat.S_ISLNK(index_details.st_mode)
            or Path(os.path.realpath(live_index)) != live_index
        ):
            fail(f"Prior UI index is not a canonical regular file: {surface}")
        if index_details.st_size > MAXIMUM_INDEX_BYTES:
            fail(f"Prior UI index exceeds compatibility bound: {surface}")
        _, index_bytes = digest_regular_file(live_index, index_details, capture=True)
        pending = dependency_references(live_surface, live_index, index_bytes, counters)
        visited: set[str] = set()
        while pending:
            surface_dependency = pending.pop()
            if surface_dependency in visited:
                continue
            visited.add(surface_dependency)
            counters["dependencies"] += 1
            if counters["dependencies"] > MAXIMUM_DEPENDENCIES:
                fail("Prior UI compatibility dependency bound exceeded.")
            live_asset = live_surface.joinpath(*surface_dependency.split("/"))
            if Path(os.path.realpath(live_asset)) != live_asset:
                fail(f"Prior UI compatibility dependency is not canonical: {surface}/{surface_dependency}")
            live_details = live_asset.lstat()
            if not stat.S_ISREG(live_details.st_mode) or stat.S_ISLNK(live_details.st_mode):
                fail(f"Prior UI compatibility dependency is not a regular file: {surface}/{surface_dependency}")
            if live_details.st_size > MAXIMUM_ASSET_BYTES:
                fail(f"Prior UI compatibility dependency exceeds per-file bound: {surface}/{surface_dependency}")
            counters["total_bytes"] += live_details.st_size
            if counters["total_bytes"] > MAXIMUM_TOTAL_BYTES:
                fail("Prior UI compatibility dependency byte bound exceeded.")
            capture_dependency = Path(surface_dependency).suffix.lower() in (".css", ".js", ".mjs")
            live_digest, dependency_bytes = digest_regular_file(
                live_asset,
                live_details,
                capture=capture_dependency,
            )
            stage_asset = stage_surface.joinpath(*surface_dependency.split("/"))
            if os.path.lexists(stage_asset):
                if Path(os.path.realpath(stage_asset)) != stage_asset:
                    fail(f"Staged UI compatibility dependency is not canonical: {surface}/{surface_dependency}")
                stage_details = stage_asset.lstat()
                if not stat.S_ISREG(stage_details.st_mode) or stat.S_ISLNK(stage_details.st_mode):
                    fail(f"Staged UI compatibility dependency is not a regular file: {surface}/{surface_dependency}")
                stage_digest, _ = digest_regular_file(stage_asset, stage_details)
                if stage_details.st_size != live_details.st_size or stage_digest != live_digest:
                    fail(f"Staged UI compatibility dependency collision differs from prior bytes: {surface}/{surface_dependency}")
            else:
                ensure_stage_parent_directories(live_surface, stage_surface, surface_dependency)
                copy_prior_file(live_asset, live_details, stage_asset, live_digest)
            if capture_dependency:
                pending.extend(
                    dependency_references(live_surface, live_asset, dependency_bytes, counters)
                )
    return counters["dependencies"], counters["total_bytes"]


def run_checked(arguments: list[str]) -> None:
    result = subprocess.run(arguments, check=False)
    if result.returncode != 0:
        fail(f"Command failed with status {result.returncode}: {' '.join(arguments)}")


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def rename_directory_noreplace(source: Path, destination: Path) -> None:
    source_details = source.lstat()
    if not stat.S_ISDIR(source_details.st_mode) or stat.S_ISLNK(source_details.st_mode):
        fail(f"UI stage publication source is not a real directory: {source}")
    library = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(library, "renameat2", None)
    if renameat2 is None:
        fail("renameat2(RENAME_NOREPLACE) is unavailable in libc.")
    renameat2.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    renameat2.restype = ctypes.c_int
    result = renameat2(
        -100,
        os.fsencode(source),
        -100,
        os.fsencode(destination),
        1,
    )
    if result != 0:
        error = ctypes.get_errno()
        if error in (errno.EEXIST, errno.ENOTEMPTY):
            fail(f"UI stage root appeared concurrently: {destination}")
        if error in (errno.ENOSYS, errno.EINVAL, errno.EOPNOTSUPP, errno.EXDEV):
            fail(
                "renameat2(RENAME_NOREPLACE) cannot atomically publish the UI stage: "
                f"{os.strerror(error)}"
            )
        fail(f"Unable to atomically publish the UI stage: {os.strerror(error)}")
    published_details = destination.lstat()
    if (
        published_details.st_dev,
        published_details.st_ino,
    ) != (
        source_details.st_dev,
        source_details.st_ino,
    ):
        fail("Published UI stage identity changed during atomic publication.")


def acquire_deploy_lock(lock_path: Path, allow_test_roots: bool) -> int:
    expected_owner = os.geteuid()
    parent = lock_path.parent
    canonical_safe_directory(parent, "UI deployment lock parent", expected_owner)
    if os.path.lexists(lock_path):
        canonical_safe_regular_file(lock_path, "UI deployment lock", expected_owner)
    inherited = os.environ.get("POW_UI_DEPLOY_LOCK_FD", "")
    if inherited:
        if not inherited.isdigit() or int(inherited) < 3:
            fail("Inherited UI deployment lock descriptor is invalid.")
        descriptor = int(inherited)
        descriptor_path = Path(f"/proc/self/fd/{descriptor}")
        if not descriptor_path.exists() or Path(os.path.realpath(descriptor_path)) != lock_path:
            fail("Inherited UI deployment lock descriptor is invalid.")
    else:
        descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        os.fchmod(descriptor, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        if not inherited:
            os.close(descriptor)
        raise StageError(f"Another UI deployment or cleanup operation holds {lock_path}.") from error
    return descriptor


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build an exact release-bound full /var/www candidate.",
    )
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--surfaces-root", required=True)
    parser.add_argument("--stage-root", required=True)
    return parser.parse_args()


def configured_payload_limits(allow_test_roots: bool) -> tuple[int, int]:
    entries_override = os.environ.get(
        "POW_UI_STAGE_TEST_MAXIMUM_PAYLOAD_ENTRIES",
        "",
    )
    bytes_override = os.environ.get(
        "POW_UI_STAGE_TEST_MAXIMUM_PAYLOAD_BYTES",
        "",
    )
    if (entries_override or bytes_override) and not allow_test_roots:
        fail("UI payload-limit overrides require POW_UI_ALLOW_TEST_ROOTS=1.")
    maximum_entries = MAXIMUM_PAYLOAD_ENTRIES
    maximum_bytes = MAXIMUM_PAYLOAD_BYTES
    if entries_override:
        if not entries_override.isdigit() or int(entries_override) < 1:
            fail("Test UI payload entry limit must be a positive integer.")
        maximum_entries = int(entries_override)
    if bytes_override:
        if not bytes_override.isdigit():
            fail("Test UI payload byte limit must be a nonnegative integer.")
        maximum_bytes = int(bytes_override)
    return maximum_entries, maximum_bytes


def main() -> int:
    arguments = parse_arguments()
    allow_test_roots = os.environ.get("POW_UI_ALLOW_TEST_ROOTS", "") == "1"
    expected_owner = os.geteuid()
    if expected_owner != 0 and not allow_test_roots:
        fail("UI release staging must run as root.")
    if not safe_release_id(arguments.release_id):
        fail("Release id must use 1-128 safe filename characters.")
    maximum_payload_entries, maximum_payload_bytes = configured_payload_limits(
        allow_test_roots
    )

    www_root = Path(os.environ.get("POW_UI_STAGE_WWW_ROOT", "/var/www"))
    staging_root = Path(
        os.environ.get("POW_UI_STAGE_STAGING_ROOT", "/var/tmp/proofofwork-deploy")
    )
    deploy_lock = Path(
        os.environ.get("POW_UI_DEPLOY_LOCK", "/run/proofofwork-ui/deploy.lock")
    )
    mountinfo = Path(os.environ.get("POW_UI_MOUNTINFO_PATH", "/proc/self/mountinfo"))
    surfaces_root = Path(arguments.surfaces_root)
    stage_root = Path(arguments.stage_root)

    if not allow_test_roots and (
        www_root != Path("/var/www")
        or staging_root != Path("/var/tmp/proofofwork-deploy")
        or deploy_lock != Path("/run/proofofwork-ui/deploy.lock")
        or mountinfo != Path("/proc/self/mountinfo")
    ):
        fail("Non-production UI staging paths require POW_UI_ALLOW_TEST_ROOTS=1.")
    expected_surfaces_root = (
        staging_root / f"proofofwork-ui-surfaces-{arguments.release_id}" / "surfaces"
    )
    expected_stage_root = staging_root / f"proofofwork-www-stage-{arguments.release_id}"
    if surfaces_root != expected_surfaces_root:
        fail(f"Surfaces root must use the exact release-bound path: {expected_surfaces_root}")
    if stage_root != expected_stage_root:
        fail(f"Stage root must use the exact release-bound path: {expected_stage_root}")
    if os.path.lexists(stage_root):
        fail(f"Refusing to replace an existing UI stage root: {stage_root}")

    www_details = canonical_safe_directory(www_root, "UI root", expected_owner)
    staging_details = canonical_safe_directory(staging_root, "UI staging root", expected_owner)
    canonical_safe_directory(surfaces_root, "New-build UI surfaces root", expected_owner)
    if www_details.st_dev != staging_details.st_dev:
        fail("UI live and staged roots must share one filesystem.")
    reject_nested_mounts(www_root, mountinfo)
    reject_nested_mounts(surfaces_root, mountinfo)
    validate_exact_surfaces_root(
        surfaces_root,
        expected_owner,
        maximum_payload_entries,
        maximum_payload_bytes,
    )

    lock_descriptor = acquire_deploy_lock(deploy_lock, allow_test_roots)
    temporary_parent: Path | None = None
    try:
        root_identity = (www_details.st_dev, www_details.st_ino)
        root_metadata = (
            stat.S_IMODE(www_details.st_mode),
            www_details.st_uid,
            www_details.st_gid,
        )
        live_managed_before = managed_fingerprint(www_root, expected_owner)
        live_passthrough_before = passthrough_fingerprint(www_root)
        (
            payload_before,
            payload_entry_count,
            payload_regular_bytes,
        ) = bounded_payload_fingerprint(
            surfaces_root,
            expected_owner,
            maximum_payload_entries,
            maximum_payload_bytes,
        )

        temporary_parent = Path(
            tempfile.mkdtemp(
                prefix=f".proofofwork-ui-stage-{arguments.release_id}.",
                dir=staging_root,
            )
        )
        candidate = temporary_parent / "candidate"
        run_checked(
            [
                "/usr/bin/cp",
                "--archive",
                "--one-file-system",
                "--",
                str(www_root),
                str(candidate),
            ]
        )
        copied_manifest = candidate / MANIFEST_NAME
        if os.path.lexists(copied_manifest):
            details = copied_manifest.lstat()
            if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode):
                fail("Copied UI release manifest is not a regular file.")
            copied_manifest.unlink()

        for surface in SURFACES:
            destination = candidate / f"proofofwork-{surface}"
            if not path_is_canonical_directory(destination):
                fail(f"Copied managed UI root is not a canonical directory: {destination}")
            shutil.rmtree(destination)
            run_checked(
                [
                    "/usr/bin/cp",
                    "--archive",
                    "--one-file-system",
                    "--",
                    str(surfaces_root / surface),
                    str(destination),
                ]
            )

        candidate_payload_copy, _, _ = bounded_managed_fingerprint(
            candidate,
            expected_owner,
            maximum_payload_entries,
            maximum_payload_bytes,
            "Copied incoming managed UI payload",
        )
        if candidate_payload_copy != payload_before:
            fail("Staged new-build surface copy differs from the validated payload.")
        current_payload, _, _ = bounded_payload_fingerprint(
            surfaces_root,
            expected_owner,
            maximum_payload_entries,
            maximum_payload_bytes,
        )
        if current_payload != payload_before:
            fail("New-build UI surfaces changed while they were copied.")

        dependency_count, dependency_bytes = copy_prior_asset_compatibility(
            www_root,
            candidate,
        )

        candidate_details = canonical_safe_directory(candidate, "Staged UI root", expected_owner)
        candidate_metadata = (
            stat.S_IMODE(candidate_details.st_mode),
            candidate_details.st_uid,
            candidate_details.st_gid,
        )
        if candidate_metadata != root_metadata:
            fail("Staged UI root does not preserve live /var/www mode, uid, and gid.")
        if os.path.lexists(candidate / MANIFEST_NAME):
            fail("Staged UI root unexpectedly contains an active release manifest.")
        (
            final_managed_fingerprint,
            final_entry_count,
            final_regular_bytes,
        ) = bounded_managed_fingerprint(
            candidate,
            expected_owner,
            maximum_payload_entries,
            maximum_payload_bytes,
            "Final compatibility-complete managed UI payload",
        )
        for surface in SURFACES:
            validate_surface_index(candidate / f"proofofwork-{surface}")
        final_fingerprint_by_surface = dict(final_managed_fingerprint)
        if final_fingerprint_by_surface["computer"] != final_fingerprint_by_surface["nft"]:
            fail("Staged NFT compatibility alias differs from staged Computer.")
        if passthrough_fingerprint(candidate) != live_passthrough_before:
            fail("Staged UI root does not preserve every non-release /var/www path, mode, owner, and byte.")
        current_payload, _, _ = bounded_payload_fingerprint(
            surfaces_root,
            expected_owner,
            maximum_payload_entries,
            maximum_payload_bytes,
        )
        if current_payload != payload_before:
            fail("New-build UI surfaces changed while staging.")
        current_www = www_root.lstat()
        if (current_www.st_dev, current_www.st_ino) != root_identity:
            fail("Live /var/www identity changed while staging.")
        if (
            stat.S_IMODE(current_www.st_mode),
            current_www.st_uid,
            current_www.st_gid,
        ) != root_metadata:
            fail("Live /var/www metadata changed while staging.")
        if managed_fingerprint(www_root, expected_owner) != live_managed_before:
            fail("Live managed UI surfaces changed while staging.")
        if passthrough_fingerprint(www_root) != live_passthrough_before:
            fail("Live non-release /var/www content changed while staging.")
        if os.path.lexists(stage_root):
            fail(f"UI stage root appeared concurrently: {stage_root}")

        run_checked(["/usr/bin/sync", "--file-system", str(candidate)])
        rename_directory_noreplace(candidate, stage_root)
        # Never remove the release-bound stage after this atomic publication;
        # a later durability or final-validation error leaves exact bytes for
        # explicit operator retry or classification.
        fsync_directory(staging_root)
        temporary_parent.rmdir()
        temporary_parent = None

        final_details = canonical_safe_directory(stage_root, "Published UI stage root", expected_owner)
        if (
            stat.S_IMODE(final_details.st_mode),
            final_details.st_uid,
            final_details.st_gid,
        ) != root_metadata:
            fail("Final UI stage root metadata changed during publication.")
        if os.path.lexists(stage_root / MANIFEST_NAME):
            fail("Final UI stage root contains an active release manifest.")
        print(
            "ui_release_stage "
            f"status=staged release_id={arguments.release_id} "
            f"compatibility_model={COMPATIBILITY_MODEL} "
            f"dependencies={dependency_count} bytes={dependency_bytes} "
            f"payload_entries={payload_entry_count} "
            f"payload_bytes={payload_regular_bytes} "
            f"final_entries={final_entry_count} "
            f"final_bytes={final_regular_bytes} "
            f"stage_root={stage_root}"
        )
        return 0
    finally:
        try:
            if temporary_parent is not None and temporary_parent.exists():
                shutil.rmtree(temporary_parent)
        finally:
            if not os.environ.get("POW_UI_DEPLOY_LOCK_FD"):
                os.close(lock_descriptor)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except StageError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
