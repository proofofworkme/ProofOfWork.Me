#!/usr/bin/python3
"""Construct one exact, compatibility-complete ProofOfWork UI release root."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import ctypes
import errno
import fcntl
from functools import partial
import hashlib
import importlib.machinery
import importlib.util
import json
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
    "boost",
    "code",
    "computer",
    "desktop",
    "dns",
    "growth",
    "id",
    "inception",
    "infinity",
    "jobs",
    "landing",
    "marketplace",
    "nft",
    "publish",
    "search",
    "token",
    "wallet",
    "work",
)
# Keep the accepted V3 vector and all historical families unchanged. Pages is
# the additional, exact V4 surface; archived V3 roots remain independently valid.
PAGES_SURFACES = tuple(sorted((*SURFACES, "pages")))
PERMISSION_SURFACES = tuple(sorted((*PAGES_SURFACES, "permission")))
PAY_SURFACES = tuple(sorted((*PERMISSION_SURFACES, "pay")))
PRE_JOBS_SURFACES = tuple(surface for surface in SURFACES if surface != "jobs")
PRE_CODE_SURFACES = tuple(surface for surface in PRE_JOBS_SURFACES if surface != "code")
PRE_SEARCH_SURFACES = tuple(surface for surface in PRE_CODE_SURFACES if surface != "search")
PRE_PUBLISH_SURFACES = tuple(surface for surface in PRE_JOBS_SURFACES if surface not in {"code", "publish", "search"})
LEGACY_SURFACES = tuple(surface for surface in PRE_JOBS_SURFACES if surface not in {"code", "dns", "publish", "search"})
PRE_BOOST_SURFACES = tuple(
    surface for surface in PRE_JOBS_SURFACES if surface not in {"code", "boost", "dns", "publish", "search"}
)
COMPATIBILITY_MODEL = "proofofwork-ui-prior-asset-closure-v1"
MAXIMUM_INDEX_BYTES = 2 * 1024 * 1024
MAXIMUM_ASSET_BYTES = 64 * 1024 * 1024
MAXIMUM_TOTAL_BYTES = 512 * 1024 * 1024
# The historical 16-surface split bundle had 560 reachable prior assets.
# The October 7 nineteen-root Code release has 1,045 (55 per surface).
# Count each served path separately and retain a finite ceiling above that
# measured set alongside the independent byte, edge and candidate limits.
# October 13 measurement of the live 22-surface closure: 1,540 paths.
# Keep 60 paths of headroom; byte, edge and candidate guards stay independent.
MAXIMUM_DEPENDENCIES = 1600
# The October 15 V5 graphs each have 5,346 distinct served-root/referrer/target
# edges. The finite 5,632 ceiling leaves 286 edges of headroom; independent
# served-path, raw-candidate and byte limits remain enforced.
MAXIMUM_REFERENCE_EDGES = 5632
# The November 15 current 064 V5 census has 1,628 served paths, 6,314
# distinct edges and 1,442,958 raw candidates. Keep its path ceiling and
# finite measured headroom; older surface families retain their limits.
V5_MAXIMUM_DEPENDENCIES = 1664
V5_MAXIMUM_REFERENCE_EDGES = 6400
V5_MAXIMUM_REFERENCE_CANDIDATES = 1507328
# The Pay V6 census has 1,794 served paths, 7,245 distinct edges and
# 1,558,551 raw candidates. Select these bounds only for the exact live V6
# family, including when V6 later becomes the prior release.
V6_MAXIMUM_DEPENDENCIES = 1856
V6_MAXIMUM_REFERENCE_EDGES = 7424
V6_MAXIMUM_REFERENCE_CANDIDATES = 1638400
# The prior 7afc0f95 graph has 1,311,044 raw candidates; the 75948039 article
# candidate has 1,313,796. The October 15 calibration used 1,376,256
# (62,460 headroom above that graph); every raw occurrence still counted.
# October 26 live A3 closure: 1,377,024 raw candidates across 22 roots.
# The 1,441,792 ceiling leaves 64,768 headroom; every occurrence still
# counts and all independent byte, edge, path and filesystem guards remain.
MAXIMUM_REFERENCE_CANDIDATES = 1441792
MAXIMUM_PAYLOAD_ENTRIES = 10000
MAXIMUM_PAYLOAD_BYTES = 1024 * 1024 * 1024
MANIFEST_NAME = ".proofofwork-ui-release"
TRANSPORT_EVIDENCE_ROOT = Path("/var/backups/proofofwork-ui/transport-evidence")

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


_capacity_module = None


AMO_AUTHORITY_ROOT = Path("/var/lib/proofofwork-ui-amo-stage")
AMO_HELPER_ROOT = Path("/usr/local/sbin")
AMO_PREDECESSORS = {
    "stager": "87ab4269461a91cf89ed50d6ddb81d116a35eb78f7cbcb6b4536946b5bbeb314",
    "publisher": "9aaba2b7378c1ddd38ad88a0d20322dd467d5dbd2393737ad1308349b350e22a",
}
AMO_HELPERS = {"publisher": "proofofwork-ui-release-publish", "stager": "proofofwork-ui-release-stage"}


def direct_file(path, *, mode=None, maximum=65536):
    """Read a single-link, owner-controlled record and bind the descriptor and attributes."""
    owner = os.geteuid()
    details = canonical_safe_regular_file(path, "AMO staging evidence", owner)
    if (details.st_gid != os.getegid() or details.st_nlink != 1 or not 0 < details.st_size <= maximum
            or (mode is not None and stat.S_IMODE(details.st_mode) != mode)):
        fail("AMO staging evidence has unexpected metadata.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_NOATIME)
    with os.fdopen(fd, "rb") as stream:
        if allocation_identity(os.fstat(fd)) != allocation_identity(details):
            fail("AMO evidence changed before opening.")
        raw = stream.read(maximum + 1)
        attrs = {name: hashlib.sha256(os.getxattr(fd, name)).hexdigest() for name in os.listxattr(fd)}
        if (len(raw) != details.st_size or allocation_identity(os.fstat(fd)) != allocation_identity(details)
                or allocation_identity(path.lstat()) != allocation_identity(details)):
            fail("AMO evidence changed during reading.")
    identity = [details.st_dev, details.st_ino, details.st_uid, details.st_gid, details.st_mode,
                details.st_nlink, details.st_size, details.st_mtime_ns]
    return raw, {"sha256": hashlib.sha256(raw).hexdigest(), "identity": identity, "xattrs": attrs}


def require_direct_approval(approval, expected):
    digests = {"sourceSha256", "surfacesSha256", "inventorySha256", "configSha256",
               "stateSha256", "buildReceiptSha256"}
    fields = digests | {"schema", "releaseId", "publicationAttempt", "commit", "tree", "pair", "helperHashes"}
    rid = r"[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z"
    if (type(approval) is not dict or set(approval) != fields or approval != expected
            or approval["schema"] != "pow-ui-amo-direct-stage-approval-v1"
            or not all(isinstance(approval[k], str) and re.fullmatch("[0-9a-f]{40}", approval[k])
                       for k in ("commit", "tree"))
            or type(approval["releaseId"]) is not str or not re.fullmatch(rid, approval["releaseId"])
            or not approval["releaseId"].startswith(approval["commit"][:12] + "-")
            or type(approval["publicationAttempt"]) is not str
            or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,30}", approval["publicationAttempt"])
            or approval["pair"] != {"current": "2084747c3f8c-20261118T181547Z",
                                     "previous": "9f18a0ce7032-20261118T004519Z"}
            or type(approval["helperHashes"]) is not dict or set(approval["helperHashes"]) != set(AMO_HELPERS)
            or not all(isinstance(v, str) and re.fullmatch("[0-9a-f]{64}", v)
                       for v in [*(approval[k] for k in digests), *approval["helperHashes"].values()])):
        fail("AMO direct staging authority differs from the exact approved release.")


def verify_active(binding):
    """Under the caller's deployment lock, check the terminal guarded install and both inode pairs."""
    if (not isinstance(binding, dict) or set(binding) != {"model", "approvalSha256"}
            or binding["model"] != "amo-direct-stage-v1"
            or type(binding["approvalSha256"]) is not str or not re.fullmatch("[0-9a-f]{64}", binding["approvalSha256"])):
        fail("Invalid AMO direct staging authority binding.")
    digest = binding["approvalSha256"]
    cycle = AMO_AUTHORITY_ROOT / digest
    dirs = {}
    for path in (AMO_AUTHORITY_ROOT, cycle, AMO_HELPER_ROOT):
        details = canonical_safe_directory(path, "AMO controller directory", os.geteuid())
        if details.st_gid != os.getegid() or path != AMO_HELPER_ROOT and stat.S_IMODE(details.st_mode) != 0o700:
            fail("AMO controller directory has unexpected metadata.")
        dirs[path] = allocation_identity(details)
    names = {"approval.json", "intent.json", "qualified.json", "installed.json", *AMO_HELPERS}
    if {p.name for p in cycle.iterdir()} != names:
        fail("AMO direct staging installation is incomplete or reversing.")
    paths = [*(cycle / name for name in names), *(AMO_HELPER_ROOT / name for name in AMO_HELPERS.values())]
    watched = {path: allocation_identity(path.lstat()) for path in paths}

    def record(name):
        raw, descriptor = direct_file(cycle / (name + ".json"), mode=0o600)
        return json.loads(raw), descriptor["sha256"]

    approval, actual = record("approval")
    if actual != digest:
        fail("AMO direct staging approval digest differs.")
    require_direct_approval(approval, approval)
    intent, intent_sha = record("intent")
    qualified, qualified_sha = record("qualified")
    installed, _ = record("installed")
    if (set(intent) != {"schema", "approvalSha256", "files"}
            or intent["schema"] != "pow-ui-amo-stage-intent-v1" or intent["approvalSha256"] != digest
            or set(intent["files"]) != set(AMO_HELPERS)
            or qualified != {"schema": "pow-ui-amo-stage-qualified-v1", "approvalSha256": digest, "intentSha256": intent_sha}
            or installed != {"schema": "pow-ui-amo-stage-installed-v1", "approvalSha256": digest,
                             "intentSha256": intent_sha, "qualificationSha256": qualified_sha}):
        fail("AMO direct staging qualification or installation receipt differs.")
    for helper, filename in AMO_HELPERS.items():
        _, before = direct_file(cycle / helper, mode=0o755, maximum=2 * 1024**2)
        _, after = direct_file(AMO_HELPER_ROOT / filename, mode=0o755, maximum=2 * 1024**2)
        if (before["sha256"] != AMO_PREDECESSORS[helper] or after["sha256"] != approval["helperHashes"][helper]
                or intent["files"][helper] != {"before": before, "after": after}
                or before["identity"][:2] == after["identity"][:2]):
            fail("AMO direct staging helper inode pair differs from the terminal installation.")
    if any(allocation_identity(path.lstat()) != value for path, value in {**dirs, **watched}.items()):
        fail("AMO direct staging installation or authority changed.")
    return approval


def capacity_helper():
    """Load only the owner-controlled sibling shipped with this stager."""
    global _capacity_module
    if _capacity_module is None:
        parent = Path(__file__).resolve().parent
        candidates = (parent / "proofofwork-ui-capacity.py", parent / "proofofwork-ui-capacity")
        path = next((candidate for candidate in candidates if candidate.exists()), candidates[0])
        canonical_safe_regular_file(path, "UI capacity helper", os.geteuid())
        # Production helpers share root-owned /usr/local/sbin. An unprivileged
        # source checkout can have group-writable repository directories, like
        # the stager itself; this does not change any capacity policy.
        if os.geteuid() == 0 and os.environ.get("POW_UI_ALLOW_TEST_ROOTS", "") != "1":
            canonical_safe_directory(parent, "UI capacity helper parent", 0)
        loader = importlib.machinery.SourceFileLoader("proofofwork_ui_capacity", str(path))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec)
        # Do not create __pycache__ alongside installed production helpers.
        exec(compile(path.read_bytes(), str(path), "exec"), module.__dict__)
        _capacity_module = module
    return _capacity_module


def capacity_guard(path: Path, additional_bytes: int, additional_inodes: int, phase: str, *, enforce_retention: bool = True) -> None:
    helper = capacity_helper()
    try:
        helper.check_capacity(path, additional_bytes, additional_inodes, phase, enforce_retention=enforce_retention)
    except (helper.CapacityError, OSError) as error:
        raise StageError(str(error)) from error


def copy_capacity_guard(source: Path, destination_parent: Path, phase: str, extra_entries: int = 0, *,
                        scratch_budget: bool = False, scratch_root: Path | None = None) -> None:
    helper = capacity_helper()
    try:
        bound = helper.tree_bound(source, destination_parent)
        block = helper.allocation_block(destination_parent)
        if scratch_budget or scratch_root is not None:
            helper.check_deploy_scratch(scratch_root or destination_parent, bound["additionalBytes"] +
                                        extra_entries * helper.entry_bytes(0, block), phase)
    except (helper.CapacityError, OSError, subprocess.SubprocessError, UnicodeError) as error:
        raise StageError(str(error)) from error
    capacity_guard(destination_parent, bound["additionalBytes"] + extra_entries * helper.entry_bytes(0, block),
                   bound["additionalInodes"] + extra_entries, phase)


class PayloadBudget(TypedDict):
    label: str
    entries: int
    regular_bytes: int
    maximum_entries: int
    maximum_bytes: int


class CandidateManagedDeduplicator:
    """Share exact files only inside this private, newly constructed candidate.

    This never registers source/live/passthrough paths. Pre-existing hardlinks
    are rejected, so every registered inode starts as an independent copy.
    Directory-descriptor traversal and O_NOFOLLOW keep all links and atomic
    replacements inside the candidate even if an entry changes during a read.
    """

    def __init__(self, root: Path, expected_owner: int):
        self.root = root
        self.owner = expected_owner
        parent = canonical_safe_directory(root.parent, "Private candidate parent", expected_owner)
        if stat.S_IMODE(parent.st_mode) != 0o700:
            fail("Managed deduplication requires a private 0700 candidate parent.")
        details = canonical_safe_directory(root, "Deduplication candidate", expected_owner)
        self.root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        if file_identity(os.fstat(self.root_fd)) != file_identity(details):
            os.close(self.root_fd)
            fail("Deduplication candidate changed while opening.")
        self.root_identity = (details.st_dev, details.st_ino)
        self.records: dict[tuple, dict] = {}
        self.paths: dict[str, dict] = {}
        self.linked_files = 0
        self.saved_bytes = 0
        self.admitted_surface = None
        self.admitted_links_remaining = 0

    def close(self) -> None:
        os.close(self.root_fd)

    def validate_details(self, details: os.stat_result, relative: str) -> None:
        if details.st_dev != self.root_identity[0]:
            fail(f"Managed deduplication crosses a filesystem boundary: {relative}")
        if details.st_uid != self.owner or details.st_mode & 0o7022:
            fail(f"Managed deduplication encountered unsafe ownership or mode: {relative}")

    @contextmanager
    def open_directory(self, relative: str):
        safe_relative(relative, "managed deduplication directory")
        descriptors = [os.dup(self.root_fd)]
        try:
            for part in relative.split("/"):
                descriptor = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                     dir_fd=descriptors[-1])
                descriptors.append(descriptor)
                self.validate_details(os.fstat(descriptor), relative)
            yield descriptors[-1]
        except OSError as error:
            raise StageError(f"Unable to safely open managed directory {relative}: {error}") from error
        finally:
            for descriptor in reversed(descriptors):
                os.close(descriptor)

    @contextmanager
    def open_file(self, relative: str):
        safe_relative(relative, "managed deduplication")
        parts = relative.split("/")
        if len(parts) < 2 or parts[0] not in {f"proofofwork-{surface}" for surface in PAY_SURFACES}:
            fail(f"Managed deduplication path is outside managed surfaces: {relative}")
        root_details = self.root.lstat()
        if (root_details.st_dev, root_details.st_ino) != self.root_identity:
            fail("Managed deduplication candidate root changed.")
        descriptors = [os.dup(self.root_fd)]
        try:
            for part in parts[:-1]:
                descriptor = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                     dir_fd=descriptors[-1])
                descriptors.append(descriptor)
                self.validate_details(os.fstat(descriptor), relative)
            parent_fd = descriptors[-1]
            descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                                 dir_fd=parent_fd)
            descriptors.append(descriptor)
            details = os.fstat(descriptor)
            self.validate_details(details, relative)
            if not stat.S_ISREG(details.st_mode):
                fail(f"Managed deduplication requires a regular file: {relative}")
            if file_identity(os.stat(parts[-1], dir_fd=parent_fd, follow_symlinks=False)) != file_identity(details):
                fail(f"Managed deduplication entry changed while opening: {relative}")
            yield parent_fd, parts[-1], descriptor, details
        except OSError as error:
            raise StageError(f"Unable to safely deduplicate managed file {relative}: {error}") from error
        finally:
            for descriptor in reversed(descriptors):
                os.close(descriptor)

    @staticmethod
    def hash_file(descriptor: int, expected: os.stat_result, relative: str) -> bytes:
        digest = hashlib.sha256()
        offset = 0
        while True:
            chunk = os.pread(descriptor, 1024 * 1024, offset)
            if not chunk:
                break
            digest.update(chunk)
            offset += len(chunk)
        if file_identity(os.fstat(descriptor)) != file_identity(expected):
            fail(f"Managed file changed during deduplication hashing: {relative}")
        return digest.digest()

    def add_file(self, relative: str) -> None:
        with self.open_file(relative) as (target_parent, target_name, target_fd, target_details):
            registered = self.paths.get(relative)
            if registered is not None:
                if (file_identity(target_details) != registered["identity"] or
                        target_details.st_nlink != registered["links"]):
                    fail(f"Registered managed file changed: {relative}")
                return
            if target_details.st_nlink != 1:
                fail(f"Managed deduplication refuses pre-existing hardlinks: {relative}")
            digest = self.hash_file(target_fd, target_details, relative)
            # Include every public byte/metadata fingerprint field and xattrs.
            # Separate surface builds can give identical chunks different
            # mtimes; aliases adopt the first candidate copy's mtime. No live
            # or source timestamp is changed, and timestamps are not provenance.
            key = (target_details.st_size, stat.S_IMODE(target_details.st_mode),
                   target_details.st_uid, target_details.st_gid,
                   tuple((name, os.getxattr(target_fd, name)) for name in sorted(os.listxattr(target_fd))), digest)
            if file_identity(os.fstat(target_fd)) != file_identity(target_details):
                fail(f"Managed file metadata changed during deduplication: {relative}")
            source = self.records.get(key)
            if source is None:
                source = {"path": relative, "identity": file_identity(target_details), "links": 1}
                self.records[key] = source
                self.paths[relative] = source
                return
            with self.open_file(source["path"]) as (source_parent, source_name, source_fd, source_details):
                if (file_identity(source_details) != source["identity"] or
                        source_details.st_nlink != source["links"]):
                    fail(f"Managed deduplication source changed: {source['path']}")
                if self.hash_file(source_fd, source_details, source["path"]) != digest:
                    fail("Managed deduplication source digest changed.")
                for offset in range(0, target_details.st_size, 1024 * 1024):
                    if os.pread(source_fd, 1024 * 1024, offset) != os.pread(target_fd, 1024 * 1024, offset):
                        fail("Managed deduplication digest collision or concurrent byte change.")
                for parent, name, descriptor, expected in (
                    (source_parent, source_name, source_fd, source_details),
                    (target_parent, target_name, target_fd, target_details),
                ):
                    if (file_identity(os.fstat(descriptor)) != file_identity(expected) or
                            file_identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) != file_identity(expected)):
                        fail("Managed deduplication file changed before linking.")
                if self.admitted_surface == relative.split("/", 1)[0]:
                    if self.admitted_links_remaining <= 0:
                        fail("Deduplication exceeded its admitted metadata bound.")
                    self.admitted_links_remaining -= 1
                temporary = f".proofofwork-dedup-{os.urandom(16).hex()}"
                capacity_guard(self.root, capacity_helper().entry_bytes(0, capacity_helper().allocation_block(self.root)),
                               1, "stage-dedup-link",
                               enforce_retention=self.admitted_surface != relative.split("/", 1)[0])
                created = False
                try:
                    os.link(source_name, temporary, src_dir_fd=source_parent,
                            dst_dir_fd=target_parent, follow_symlinks=False)
                    created = True
                    linked = os.stat(temporary, dir_fd=target_parent, follow_symlinks=False)
                    if (not stat.S_ISREG(linked.st_mode) or
                            (linked.st_dev, linked.st_ino) != (source_details.st_dev, source_details.st_ino) or
                            file_identity(os.fstat(source_fd))[:-1] != file_identity(source_details)[:-1] or
                            file_identity(os.stat(target_name, dir_fd=target_parent, follow_symlinks=False)) != file_identity(target_details)):
                        fail("Managed deduplication link identity changed before replacement.")
                    os.replace(temporary, target_name, src_dir_fd=target_parent, dst_dir_fd=target_parent)
                    created = False
                    final_source = os.fstat(source_fd)
                    final_target = os.stat(target_name, dir_fd=target_parent, follow_symlinks=False)
                    if (file_identity(final_source) != file_identity(final_target) or
                            file_identity(final_source)[:-1] != file_identity(source_details)[:-1] or
                            final_source.st_nlink != source["links"] + 1 or os.fstat(target_fd).st_nlink != 0):
                        fail("Managed deduplication identity changed during replacement.")
                    if self.hash_file(source_fd, final_source, source["path"]) != digest:
                        fail("Managed deduplication bytes changed during replacement.")
                    source["identity"] = file_identity(final_source)
                    source["links"] += 1
                    self.paths[relative] = source
                    self.linked_files += 1
                    self.saved_bytes += target_details.st_size
                finally:
                    if created:
                        os.unlink(temporary, dir_fd=target_parent)

    def add_surface(self, surface: str) -> None:
        if surface not in PAY_SURFACES:
            fail(f"Unknown managed deduplication surface: {surface}")
        before = surface_fingerprint(self.root, surface, self.owner)
        relative_root = f"proofofwork-{surface}"

        def walk(relative: str) -> None:
            # Enumerate through the anchored descriptor; each leaf is reopened
            # without following links and checked again immediately before use.
            with self.open_directory(relative) as descriptor:
                for entry in sorted(os.scandir(descriptor), key=lambda entry: os.fsencode(entry.name)):
                    child = f"{relative}/{entry.name}"
                    details = entry.stat(follow_symlinks=False)
                    self.validate_details(details, child)
                    if stat.S_ISDIR(details.st_mode):
                        walk(child)
                    elif stat.S_ISREG(details.st_mode):
                        self.add_file(child)
                    else:
                        fail(f"Managed deduplication encountered an unsupported file: {child}")

        # Reserve every entry's worst-case metadata growth before the bounded
        # walk. Link replacements can leave directory allocation behind, so do
        # not rely on data savings or merely reserve one transient link.
        if self.admitted_surface is not None:
            fail("Nested deduplication admission is not allowed.")
        helper = capacity_helper()
        bound = helper.tree_bound(self.root / relative_root, self.root)
        metadata_bytes = bound["additionalInodes"] * helper.entry_bytes(0, helper.allocation_block(self.root))
        capacity_guard(self.root, metadata_bytes, bound["additionalInodes"], "stage-dedup-surface-admit")
        self.admitted_surface = relative_root
        self.admitted_links_remaining = bound["additionalInodes"]
        try:
            walk(relative_root)
        finally:
            self.admitted_surface = None
            self.admitted_links_remaining = 0
        capacity_guard(self.root, 0, 0, "stage-dedup-surface-complete")
        if surface_fingerprint(self.root, surface, self.owner) != before:
            fail(f"Managed deduplication changed a surface byte/metadata fingerprint: {surface}")


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


def reject_nested_mounts(
    directory: Path, mountinfo: Path, *, protected_ancestors: tuple[Path, ...] = ()
) -> None:
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
            if nested or mounted in protected_ancestors:
                fail(f"UI release tree contains a nested mount: {mounted}")


def validate_preserved_surfaces_root(
    surfaces_root: Path,
    release_id: str,
    expected_owner: int,
    expected_group: int,
    expected_device: int,
    mountinfo: Path,
) -> None:
    """Admit only the exact release input with safe, same-device ancestors."""
    release_root = TRANSPORT_EVIDENCE_ROOT / release_id
    expected = release_root / f"proofofwork-ui-surfaces-{release_id}" / "surfaces"
    if surfaces_root != expected:
        fail(f"Preserved surfaces must use the exact release-bound path: {expected}")
    backup_root = TRANSPORT_EVIDENCE_ROOT.parent.parent
    ancestors = tuple(reversed(surfaces_root.parents[: len(surfaces_root.parts) - len(backup_root.parts)]))
    for directory in (*ancestors, surfaces_root):
        details = canonical_safe_directory(directory, "Preserved UI input ancestor", expected_owner)
        if details.st_gid != expected_group or details.st_dev != expected_device:
            fail(f"Preserved UI input ancestors must use the expected group and filesystem: {directory}")
    reject_nested_mounts(release_root, mountinfo, protected_ancestors=ancestors)


def preserved_input_receipt(surfaces_root: Path, release_id: str, expected_sha: str, owner: int) -> dict:
    if not re.fullmatch("[0-9a-f]{64}", expected_sha):
        fail("Preserved staging requires an exact incoming receipt SHA256.")
    receipt = TRANSPORT_EVIDENCE_ROOT / release_id / "incoming-receipt.json"
    details = canonical_safe_regular_file(receipt, "Preserved incoming receipt", owner)
    if details.st_gid != os.getegid() or details.st_nlink != 1 or details.st_size > 65536:
        fail("Preserved incoming receipt metadata is unsafe.")
    descriptor = os.open(receipt, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    with os.fdopen(descriptor, "rb") as source:
        raw = source.read(65537)
        if allocation_identity(os.fstat(source.fileno())) != allocation_identity(details):
            fail("Preserved incoming receipt changed while reading.")
    if allocation_identity(receipt.lstat()) != allocation_identity(details) or hashlib.sha256(raw).hexdigest() != expected_sha:
        fail("Preserved incoming receipt changed or its hash differs.")
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as error:
        raise StageError("Preserved incoming receipt is invalid JSON.") from error
    payload = surfaces_root.parent
    paths, pending, input_snapshot = [], [payload], {}
    while pending:
        path = pending.pop()
        if len(paths) >= MAXIMUM_PAYLOAD_ENTRIES + 2:
            fail("Preserved incoming payload exceeds the entry bound.")
        entry = path.lstat()
        input_snapshot[path] = allocation_identity(entry)
        paths.append(path)
        if stat.S_ISDIR(entry.st_mode) and path.resolve() == path:
            for child in path.iterdir():
                if len(paths) + len(pending) >= MAXIMUM_PAYLOAD_ENTRIES + 2:
                    fail("Preserved incoming payload exceeds the entry bound.")
                pending.append(child)
    rows = []
    for path in [payload, *sorted(path for path in paths if path != payload)]:
        s = path.lstat()
        if len(rows) >= MAXIMUM_PAYLOAD_ENTRIES + 2 or path.resolve() != path:
            fail("Preserved incoming payload exceeds bounds or contains an alias.")
        if s.st_uid != owner or s.st_gid != os.getegid() or s.st_mode & 0o7022 or s.st_dev != details.st_dev:
            fail("Preserved incoming payload metadata is unsafe.")
        digest = None
        if stat.S_ISREG(s.st_mode) and s.st_nlink == 1:
            digest, _ = digest_regular_file(path, s)
            digest = digest.hex()
        elif not stat.S_ISDIR(s.st_mode):
            fail("Preserved incoming payload contains a link or unsupported entry.")
        rows.append([path.relative_to(payload).as_posix(), "directory" if stat.S_ISDIR(s.st_mode) else "file",
                     stat.S_IMODE(s.st_mode), s.st_uid, s.st_gid, s.st_size if digest else 0, digest])
    if any(allocation_identity(path.lstat()) != expected for path, expected in input_snapshot.items()):
        fail("Preserved incoming payload changed during verification.")
    fingerprint = {"sha256": hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest(),
                   "entries": len(rows), "regularBytes": sum(row[5] for row in rows)}
    if (value.get("format") != "proof-of-work-ui-incoming-evidence-v1"
            or value.get("releaseId") != release_id or value.get("preservedPath") != str(payload)
            or value.get("payloadFingerprint") != fingerprint
            or value.get("movePreservedInodes") is not True or value.get("historicalDeletion") is not False):
        fail("Preserved incoming receipt does not bind the exact validated payload.")
    return value


def allocation_identity(details: os.stat_result) -> tuple:
    return tuple(getattr(details, key) for key in ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid",
        "st_nlink", "st_size", "st_blocks", "st_mtime_ns", "st_ctime_ns"))


def candidate_allocation(root: Path, owner: int) -> tuple[dict, dict]:
    """Charge completed candidate inodes once, plus conservative entry metadata."""
    helper = capacity_helper(); block = helper.allocation_block(root)
    device = root.lstat().st_dev
    snapshots, aliases, unique, attribute_bytes = {}, {}, {}, 0
    pending = [root]
    while pending:
        path = pending.pop(); details = path.lstat()
        if len(snapshots) >= helper.MAX_TREE_ENTRIES:
            fail("Completed candidate allocation entry bound exceeded.")
        if details.st_dev != device or details.st_mode & 0o7022:
            fail("Completed candidate allocation mode or device is unsafe.")
        attrs = ()
        if stat.S_ISDIR(details.st_mode):
            if not path_is_canonical_directory(path):
                fail("Completed candidate allocation directory is not canonical.")
            for child in path.iterdir():
                if len(snapshots) + len(pending) + 1 >= helper.MAX_TREE_ENTRIES:
                    fail("Completed candidate allocation entry bound exceeded.")
                pending.append(child)
            attrs = tuple((name, os.getxattr(path, name, follow_symlinks=False)) for name in sorted(os.listxattr(path, follow_symlinks=False)))
        elif stat.S_ISREG(details.st_mode):
            if path.resolve() != path:
                fail("Completed candidate allocation file is not canonical.")
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_NOATIME)
            try:
                if allocation_identity(os.fstat(fd)) != allocation_identity(details):
                    fail("Completed candidate changed before allocation inspection.")
                attrs = tuple((name, os.getxattr(fd, name)) for name in sorted(os.listxattr(fd)))
                if allocation_identity(os.fstat(fd)) != allocation_identity(details):
                    fail("Completed candidate changed during allocation inspection.")
            finally:
                os.close(fd)
        else:
            # Match existing passthrough fingerprints: regular files/directories.
            fail("Completed candidate allocation contains an unsupported entry.")
        if allocation_identity(path.lstat()) != allocation_identity(details):
            fail("Completed candidate changed during allocation inspection.")
        snapshots[path] = (allocation_identity(details), attrs)
        inode = (details.st_dev, details.st_ino)
        aliases[inode] = aliases.get(inode, 0) + 1
        unique[inode] = max(details.st_blocks * 512, helper.rounded(details.st_size, block))
        attribute_bytes += sum(len(os.fsencode(name)) + len(value) + block for name, value in attrs)
    for identity, _ in snapshots.values():
        if not stat.S_ISDIR(identity[2]) and aliases[identity[:2]] != identity[5]:
            fail("Completed candidate allocation has a hardlink outside the private candidate.")
    overhead = (len(snapshots) + 4) * helper.entry_bytes(0, block) + helper.rounded(attribute_bytes, block)
    report = {"model": "completed-candidate-unique-inodes-v1", "entries": len(snapshots),
              "uniqueInodes": len(unique), "allocatedOrRoundedBytes": sum(unique.values()),
              "metadataOverheadBytes": overhead, "additionalBytes": sum(unique.values()) + overhead}
    verify_candidate_allocation(snapshots)
    return report, snapshots


def verify_candidate_allocation(snapshots: dict) -> None:
    for path, (expected, attrs) in snapshots.items():
        if allocation_identity(path.lstat()) != expected:
            fail("Completed candidate changed after allocation measurement.")
        if stat.S_ISREG(expected[2]):
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_NOATIME)
            try:
                current = tuple((name, os.getxattr(fd, name)) for name in sorted(os.listxattr(fd)))
                if allocation_identity(os.fstat(fd)) != expected or current != attrs:
                    fail("Completed candidate attributes changed after allocation measurement.")
            finally:
                os.close(fd)
        elif stat.S_ISDIR(expected[2]):
            current = tuple((name, os.getxattr(path, name, follow_symlinks=False)) for name in sorted(os.listxattr(path, follow_symlinks=False)))
            if current != attrs or allocation_identity(path.lstat()) != expected:
                fail("Completed candidate directory changed after allocation measurement.")


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


def live_surface_names(root: Path) -> tuple[str, ...]:
    if os.path.lexists(root / "proofofwork-pay"):
        return PAY_SURFACES
    if os.path.lexists(root / "proofofwork-permission"):
        return PERMISSION_SURFACES
    if os.path.lexists(root / "proofofwork-pages"):
        return PAGES_SURFACES
    boost = root / "proofofwork-boost"
    if not os.path.lexists(boost):
        return PRE_BOOST_SURFACES
    dns = root / "proofofwork-dns"
    if not os.path.lexists(dns):
        return LEGACY_SURFACES
    if not os.path.lexists(root / "proofofwork-publish"):
        return PRE_PUBLISH_SURFACES
    if not os.path.lexists(root / "proofofwork-search"):
        return PRE_SEARCH_SURFACES
    if not os.path.lexists(root / "proofofwork-code"):
        return PRE_CODE_SURFACES
    if not os.path.lexists(root / "proofofwork-jobs"):
        return PRE_JOBS_SURFACES
    return SURFACES


def payload_surface_names(root: Path) -> tuple[str, ...]:
    actual = {entry.name for entry in os.scandir(root)}
    for surfaces in (SURFACES, PAGES_SURFACES, PERMISSION_SURFACES, PAY_SURFACES):
        if actual == set(surfaces):
            return surfaces
    fail("New-build surfaces root must contain exactly the V3 20 or V4 21 or V5 22 or V6 23 surfaces; "
         f"received={sorted(actual)}")


def managed_fingerprint(
    root: Path,
    expected_owner: int,
    surfaces: tuple[str, ...] = SURFACES,
) -> tuple[tuple[str, tuple[int, int, str]], ...]:
    return tuple(
        (surface, surface_fingerprint(root, surface, expected_owner))
        for surface in surfaces
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
    surfaces: tuple[str, ...] = SURFACES,
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
        for surface in surfaces
    )
    return fingerprints, budget["entries"], budget["regular_bytes"]


def bounded_managed_fingerprint(
    root: Path,
    expected_owner: int,
    maximum_entries: int,
    maximum_bytes: int,
    label: str,
    surfaces: tuple[str, ...] = SURFACES,
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
        for surface in surfaces
    )
    return fingerprints, budget["entries"], budget["regular_bytes"]


def passthrough_fingerprint(root: Path) -> tuple[int, int, str]:
    excluded = {MANIFEST_NAME, *(f"proofofwork-{surface}" for surface in PAY_SURFACES)}
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
    surfaces = payload_surface_names(surfaces_root)
    fingerprints, entry_count, regular_bytes = bounded_payload_fingerprint(
        surfaces_root,
        expected_owner,
        maximum_entries,
        maximum_bytes,
        surfaces,
    )
    for surface in surfaces:
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
    # Publication replaces these generated root navigation documents. Route
    # literals are not immutable dependencies; Pages runner and nested HTML stay exact.
    if relative in ("index.html", "app.html", "noindex-app.html", "404.html"):
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
    *,
    edge_limit: int | None = None,
    candidate_limit: int | None = None,
) -> list[str]:
    if edge_limit is None:
        edge_limit = MAXIMUM_REFERENCE_EDGES
    if candidate_limit is None:
        candidate_limit = MAXIMUM_REFERENCE_CANDIDATES
    references: list[str] = []
    # Repeated literals and overlapping CSS patterns describe the same directed
    # edge from this referrer. Every raw match still consumes the candidate cap.
    seen_targets: set[str] = set()
    patterns = [QUOTED_REFERENCE_PATTERN]
    if current_path.suffix.lower() == ".css":
        patterns.extend((CSS_URL_PATTERN, CSS_IMPORT_PATTERN))
    for pattern in patterns:
        for match in pattern.finditer(content):
            counters["reference_candidates"] += 1
            if counters["reference_candidates"] > candidate_limit:
                fail("Prior UI compatibility reference-candidate bound exceeded.")
            relative = resolve_reference(surface_root, current_path, match.group("reference"))
            if relative is not None and relative not in seen_targets:
                seen_targets.add(relative)
                counters["reference_edges"] += 1
                if counters["reference_edges"] > edge_limit:
                    fail("Prior UI compatibility reference-edge bound exceeded.")
                references.append(relative)
    return references


def prior_asset_parser(surfaces):
    family = tuple(sorted(surfaces))
    if family == PAY_SURFACES:
        return V6_MAXIMUM_DEPENDENCIES, partial(
            dependency_references,
            edge_limit=V6_MAXIMUM_REFERENCE_EDGES,
            candidate_limit=V6_MAXIMUM_REFERENCE_CANDIDATES,
        )
    if family == PERMISSION_SURFACES:
        return V5_MAXIMUM_DEPENDENCIES, partial(
            dependency_references,
            edge_limit=V5_MAXIMUM_REFERENCE_EDGES,
            candidate_limit=V5_MAXIMUM_REFERENCE_CANDIDATES,
        )
    return MAXIMUM_DEPENDENCIES, dependency_references


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
        capacity_guard(stage_cursor.parent,
                       capacity_helper().entry_bytes(0, capacity_helper().allocation_block(stage_cursor.parent)),
                       1, "stage-compatibility-directory")
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
    copy_capacity_guard(source, destination.parent, "stage-compatibility-file")
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


def copy_prior_asset_compatibility(
    live_root: Path,
    stage_root: Path,
    surfaces: tuple[str, ...] = SURFACES,
    deduplicator: CandidateManagedDeduplicator | None = None,
) -> tuple[int, int]:
    dependency_limit, parse_references = prior_asset_parser(surfaces)
    counters = {
        "dependencies": 0,
        "reference_edges": 0,
        "reference_candidates": 0,
        "total_bytes": 0,
    }
    for surface in surfaces:
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
        pending = parse_references(live_surface, live_index, index_bytes, counters)
        visited: set[str] = set()
        while pending:
            surface_dependency = pending.pop()
            if surface_dependency in visited:
                continue
            visited.add(surface_dependency)
            counters["dependencies"] += 1
            if counters["dependencies"] > dependency_limit:
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
                    parse_references(live_surface, live_asset, dependency_bytes, counters)
                )
        if deduplicator is not None:
            deduplicator.add_surface(surface)
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


def direct_plan_fields(plan):
    """Reconstruct the complete installer approval from independently bound release inputs."""
    request = plan['closedArchive']['request']
    direct = request['amoDirectScope']
    binding = plan['amoDirectStage']
    if (binding != {'model': 'amo-direct-stage-v1', 'approvalSha256': direct['approvalSha256']}
            or not re.fullmatch(r'[0-9a-f]{64}', binding['approvalSha256'])
            or set(direct) != {'approvalSha256', 'attempt', 'sourceSha256', 'buildReceiptSha256'}
            or request.get('amoDirectStage') is not True
            or plan['inputStorage'] != 'deploy-scratch-v1' or 'inputCompactorSha256' not in request
            or plan['releaseFormat'] != 'proofofwork-ui-release-v6'
            or request['releaseId'] != plan['releaseId'] or request['commit'] != plan['commit']
            or request['tree'] != plan['tree'] or request['surfacesSha256'] != plan['surfaces']['sha256']
            or direct['attempt'] != plan['publicationAttempt'] or direct['sourceSha256'] != plan['source']['sha256']
            or direct['buildReceiptSha256'] != plan['buildReceiptSha256']
            or plan['commit'] == 'ace27010a8e44886c0c22cf9fe5c98509d28f1bb'):
        raise ValueError('Direct staging requires the exact closed AMO successor and attempt')
    lifecycle = plan['retentionLifecycle']
    return {'schema': 'pow-ui-amo-direct-stage-approval-v1',
            'releaseId': plan['releaseId'], 'publicationAttempt': plan['publicationAttempt'],
            'commit': plan['commit'], 'tree': plan['tree'], 'sourceSha256': plan['source']['sha256'],
            'surfacesSha256': plan['surfaces']['sha256'], 'inventorySha256': request['inventorySha256'],
            'buildReceiptSha256': plan['buildReceiptSha256'], 'pair': lifecycle['pair'],
            'configSha256': lifecycle['config']['sha256'], 'stateSha256': lifecycle['state']['sha256'],
            'helperHashes': {key: plan['publicationHelpers'][key]['sha256'] for key in ('stager', 'publisher')}}


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build an exact release-bound full /var/www candidate.",
    )
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--surfaces-root", required=True)
    parser.add_argument("--stage-root", required=True)
    parser.add_argument(
        "--deduplicate-managed-files", action="store_true",
        help="Hardlink identical fresh candidate managed files internally; never link to another release or the source payload.",
    )
    parser.add_argument("--preserved-build-attempt", help="Build one completed candidate in this exact release evidence pool before scratch admission.")
    parser.add_argument("--preserved-input-receipt-sha256", help="Exact SHA256 of the immutable current-release incoming receipt.")
    parser.add_argument("--direct-plan-sha256", help="SHA256 of the installed receiver's sealed AMO release plan.")
    parser.add_argument("--direct-attempt", help="Exact attempt of the sealed AMO release plan.")
    return parser.parse_args()


def direct_tree_snapshot(root):
    """Capture same-filesystem entry identities and xattrs in canonical path order."""
    base = root.lstat()
    pending, rows = [root], {}
    attribute_bytes = 0
    while pending:
        path = pending.pop()
        s = path.lstat()
        if (s.st_dev != base.st_dev or path.resolve() != path or s.st_mode & 0o7022
                or not (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode))):
            fail("Unsupported AMO direct staging source.")
        rel = path.relative_to(root)
        attrs = tuple((name, os.getxattr(path, name, follow_symlinks=False).hex())
                      for name in sorted(os.listxattr(path, follow_symlinks=False)))
        attribute_bytes += sum(len(os.fsencode(name)) + len(value) // 2 for name, value in attrs)
        if attribute_bytes > 16 * 1024**2:
            fail("AMO staging source attribute evidence exceeds its memory bound.")
        rows[rel] = (allocation_identity(s), attrs)
        if stat.S_ISDIR(s.st_mode):
            for child in path.iterdir():
                if len(pending) + len(rows) >= 50000:
                    fail("AMO direct staging source exceeds its entry bound.")
                pending.append(child)
    for rel, (identity, _) in rows.items():
        if allocation_identity((root / rel).lstat()) != identity:
            fail("AMO direct staging source changed during measurement.")
    return rows


def direct_live_census(rows):
    unique = {i[:2]: i[7] * 512 for i, _ in rows.values()}
    # Match phase_capacity.snapshot_identity exactly (nlink follows ctime).
    witness = [[str(rel), [i[k] for k in (0, 1, 2, 3, 4, 6, 8, 9, 5, 7)]]
               for rel, (i, _) in sorted(rows.items())]
    return {"outgoingAllocatedBytes": sum(unique.values()), "outgoingUniqueInodes": len(unique),
            "outgoingIdentitySha256": hashlib.sha256(json.dumps(witness, separators=(",", ":")).encode()).hexdigest()}


def direct_seed(live, candidate, live_rows):
    """Seed only independent passthrough copies, preserving metadata and internal alias groups."""
    excluded = {MANIFEST_NAME, *("proofofwork-" + surface for surface in PAY_SURFACES)}
    selected = {rel: row for rel, row in live_rows.items() if not rel.parts or rel.parts[0] not in excluded}
    sources = sorted(live / rel for rel in selected if len(rel.parts) == 1)
    candidate.mkdir(mode=0o700)
    if sources:
        run_checked(["/usr/bin/cp", "--archive", "--one-file-system", "--target-directory", str(candidate),
                     "--", *map(str, sources)])
    src = live.lstat()
    dst = candidate.lstat()
    if (dst.st_uid, dst.st_gid) != (src.st_uid, src.st_gid):
        os.chown(candidate, src.st_uid, src.st_gid, follow_symlinks=False)
    # A private parent's default ACL may create extra access or default ACL
    # xattrs. Remove only attributes of this newly created root that are absent
    # at the source. Verify exact root and descendant attributes after copystat.
    for name in set(os.listxattr(candidate)) - set(os.listxattr(live)):
        os.removexattr(candidate, name)
    shutil.copystat(live, candidate, follow_symlinks=False)
    copied = direct_tree_snapshot(candidate)
    if copied.keys() != selected.keys():
        fail("AMO direct staging passthrough path set differs.")
    forward, reverse = {}, {}
    for rel, (old, attrs) in selected.items():
        new, observed = copied[rel]
        if new[2:5] != old[2:5] or new[8] != old[8] or observed != attrs:
            fail("AMO direct staging passthrough metadata differs.")
        if stat.S_ISREG(old[2]):
            if (new[6] != old[6] or old[:2] == new[:2]
                    or forward.setdefault(old[:2], new[:2]) != new[:2]
                    or reverse.setdefault(new[:2], old[:2]) != old[:2]):
                fail("AMO direct staging passthrough aliases or size differ.")


def require_direct_receiver_lock(lock):
    """A direct stage may only inherit the receiver's existing exclusive flock."""
    value = os.environ.get("POW_UI_DEPLOY_LOCK_FD", "")
    if not value.isdecimal() or int(value) < 3:
        fail("AMO direct staging requires the receiver's inherited exclusive lock.")
    fd, owner = int(value), os.getppid()
    s = canonical_safe_regular_file(lock, "UI deployment lock", os.geteuid())
    if (owner <= 1 or s.st_nlink != 1 or s.st_gid != os.getegid()
            or allocation_identity(os.fstat(fd)) != allocation_identity(s)):
        fail("AMO direct staging receiver lock identity differs.")
    device = [os.major(s.st_dev), os.minor(s.st_dev), s.st_ino]
    for process in ("self", str(owner)):
        proc = Path("/proc", process)
        if allocation_identity((proc / "fd" / str(fd)).stat()) != allocation_identity(s):
            fail("AMO direct staging receiver lock descriptor differs.")
        rows = [row.split() for row in (proc / "fdinfo" / str(fd)).read_text().splitlines()
                if row.startswith("lock:")]
        if (len(rows) != 1 or len(rows[0]) != 9 or rows[0][2:6] != ["FLOCK", "ADVISORY", "WRITE", str(owner)]
                or rows[0][7:] != ["0", "EOF"] or
                [int(part, base) for part, base in zip(rows[0][6].split(":"), (16, 16, 10))] != device):
            fail("AMO direct staging requires the receiver's inherited exclusive lock.")


def direct_stage_context(args, live, surfaces, staging):
    """Rebind the locked receiver's sealed plan, fresh intent and compact input before allocation."""
    attempt = args.direct_attempt
    if (not os.environ.get("POW_UI_DEPLOY_LOCK_FD") or not args.deduplicate_managed_files
            or args.preserved_build_attempt or not re.fullmatch("[a-z0-9][a-z0-9-]{0,30}", attempt)
            or not re.fullmatch("[0-9a-f]{64}", args.direct_plan_sha256)):
        fail("AMO direct staging requires the exact locked private receiver context.")
    release = args.release_id
    plan_path = staging / f"recovery-plan-{release}-{attempt}.json"
    raw, record = direct_file(plan_path)
    if record["sha256"] != args.direct_plan_sha256:
        fail("AMO direct staging sealed plan digest differs.")
    plan = json.loads(raw)
    binding = plan["amoDirectStage"]
    approval = verify_active(binding)
    require_direct_approval(approval, direct_plan_fields(plan))
    closed = plan["closedArchive"]
    if (plan["releaseId"] != release or plan["publicationAttempt"] != attempt
            or plan["inputStorage"] != "deploy-scratch-v1" or plan["releaseFormat"] != "proofofwork-ui-release-v6"
            or closed["request"].get("amoDirectStage") is not True or "inputCompactor" not in plan
            or plan["publicationHelpers"]["stager"]["sha256"] != direct_file(Path(__file__).resolve(), maximum=2*1024**2)[1]["sha256"]
            or live_surface_names(live) != PAY_SURFACES or payload_surface_names(surfaces) != PAY_SURFACES
            or any(k in plan for k in ("resumeSurfaces", "preservedCapacityResume", "preservedStageResume"))
            or surfaces != staging / f"proofofwork-ui-surfaces-{release}" / "surfaces"):
        fail("AMO direct staging differs from the bound fresh V6 release.")
    identity = {k: plan[k] for k in ("releaseId", "commit", "tree")}
    evidence = staging / f"recovery-transport-{release}-surfaces-stage-{attempt}"
    intent_path = evidence / "intent.json"
    receipt_path = TRANSPORT_EVIDENCE_ROOT / release / "incoming-receipt.json"
    intent_raw, intent_record = direct_file(intent_path)
    receipt_raw, receipt_record = direct_file(receipt_path)
    intent, receipt = json.loads(intent_raw), json.loads(receipt_raw)
    if (any(value.get(k) != v for value in (receipt, intent) for k, v in identity.items())
            or receipt["planSha256"] != record["sha256"] or intent["planSha256"] != record["sha256"]
            or intent.get("continuousParentLock") is not True or intent.get("phase") != "surfaces-stage"
            or intent.get("retentionDeferred") is not True or receipt["preservedPath"] != str(surfaces.parent)
            or receipt["receiverReceipt"]["archiveSha256"] != approval["surfacesSha256"]
            or receipt["payloadFingerprint"] != plan["surfacesPayloadFingerprint"]):
        fail("AMO direct staging lacks the exact locked incoming receipt and intent.")
    compact = receipt["compactInput"]
    limits = closed["privateStaging"]
    if (compact["contentFingerprint"] != receipt["payloadFingerprint"] or compact["chargedBytes"] +
            compact["originalTimes"]["bytes"] > limits["compactInputUpperBytes"]):
        fail("AMO direct staging compact input exceeds its authorization.")
    inputs = direct_tree_snapshot(surfaces.parent)
    compact_rows = [[str(rel), i, attrs] for rel, (i, attrs) in sorted(inputs.items())]
    compact_sha = hashlib.sha256(json.dumps(compact_rows, separators=(",", ":")).encode()).hexdigest()
    if compact_sha != compact["identitySha256"]:
        fail("AMO direct staging compact input changed.")
    live_rows = direct_tree_snapshot(live)
    if direct_file(live / MANIFEST_NAME)[1]["sha256"] != plan["oldLiveManifestSha256"]:
        fail("AMO direct staging outgoing manifest differs.")
    block = os.statvfs(live).f_frsize
    if block != limits["blockSize"] or not 512 <= block <= 65536:
        fail("AMO direct staging allocation block differs.")
    # Match the closed inventory's per-entry prospective-copy charge. Do not
    # discount existing aliases, preallocation, metadata or retained root ACLs.
    seed_upper = 0
    excluded = {MANIFEST_NAME, *("proofofwork-" + surface for surface in PAY_SURFACES)}
    rounded = capacity_helper().rounded
    for rel, (i, attrs) in live_rows.items():
        if rel.parts and rel.parts[0] in excluded:
            continue
        attr_bytes = sum(block + len(os.fsencode(name)) + len(value) // 2 for name, value in attrs)
        seed_upper += max(rounded(i[6], block), i[7] * 512) + 4 * block + rounded(attr_bytes, block)
    if seed_upper != limits["passthroughUpperBytes"]:
        fail("AMO direct staging passthrough bound differs.")
    measured = direct_live_census(live_rows)
    cap = closed["amoDirectCapacity"]
    if any(cap.get(k) != v for k, v in measured.items()):
        fail("AMO direct staging outgoing root changed.")
    requirements = plan["wholeSequenceAdmission"]["requirements"]
    final = limits["finalCandidateUpperBytes"]
    peak = final + max(cap["transientSurfaceUpperBytes"], plan["admissions"]["surfaces-receive"]["bytes"])
    if ("scratchAllowanceBytes" in requirements or type(peak) is not int or type(final) is not int
            or not 0 < final < peak or requirements["charges"]["candidateCopy"] != peak):
        fail("AMO direct staging construction bound differs from the admitted sequence.")
    return {"plan": plan, "binding": binding, "approval": approval, "live": live_rows, "input": inputs,
            "records": {plan_path: record, intent_path: intent_record, receipt_path: receipt_record},
            "peak": peak, "final": final, "inodes": requirements["additionalInodes"]}


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
    direct = arguments.direct_plan_sha256 is not None
    if direct != (arguments.direct_attempt is not None) or direct and not os.environ.get("POW_UI_DEPLOY_LOCK_FD"):
        fail("AMO direct staging requires both sealed plan options and an inherited deployment lock.")
    preserved_build = arguments.preserved_build_attempt is not None
    if preserved_build != (arguments.preserved_input_receipt_sha256 is not None):
        fail("Preserved candidate build requires both exact attempt and incoming receipt SHA256.")
    if preserved_build and not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,30}", arguments.preserved_build_attempt):
        fail("Preserved candidate build requires a safe exact attempt.")
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
    preserved_surfaces_root = (
        TRANSPORT_EVIDENCE_ROOT / arguments.release_id
        / f"proofofwork-ui-surfaces-{arguments.release_id}" / "surfaces"
    )
    expected_stage_root = staging_root / f"proofofwork-www-stage-{arguments.release_id}"
    if surfaces_root not in (expected_surfaces_root, preserved_surfaces_root):
        fail("Surfaces root must use an exact release-bound staging or transport-evidence path.")
    if preserved_build and surfaces_root != preserved_surfaces_root:
        fail("Preserved candidate build requires the exact preserved release input.")
    if stage_root != expected_stage_root:
        fail(f"Stage root must use the exact release-bound path: {expected_stage_root}")
    if os.path.lexists(stage_root):
        fail(f"Refusing to replace an existing UI stage root: {stage_root}")

    www_details = canonical_safe_directory(www_root, "UI root", expected_owner)
    staging_details = canonical_safe_directory(staging_root, "UI staging root", expected_owner)
    canonical_safe_directory(surfaces_root, "New-build UI surfaces root", expected_owner)
    if www_details.st_dev != staging_details.st_dev:
        fail("UI live and staged roots must share one filesystem.")
    if surfaces_root == preserved_surfaces_root:
        validate_preserved_surfaces_root(
            surfaces_root, arguments.release_id, expected_owner,
            os.getegid() if allow_test_roots else 0, www_details.st_dev, mountinfo,
        )
    reject_nested_mounts(www_root, mountinfo)
    reject_nested_mounts(surfaces_root, mountinfo)
    incoming_surfaces = payload_surface_names(surfaces_root)
    validate_exact_surfaces_root(
        surfaces_root,
        expected_owner,
        maximum_payload_entries,
        maximum_payload_bytes,
    )

    if direct:
        require_direct_receiver_lock(deploy_lock)
    lock_descriptor = acquire_deploy_lock(deploy_lock, allow_test_roots)
    temporary_parent: Path | None = None
    private_identity = None
    deduplicator: CandidateManagedDeduplicator | None = None
    try:
        root_identity = (www_details.st_dev, www_details.st_ino)
        root_metadata = (
            stat.S_IMODE(www_details.st_mode),
            www_details.st_uid,
            www_details.st_gid,
        )
        live_surfaces = live_surface_names(www_root)
        if "pay" in live_surfaces and "pay" not in incoming_surfaces:
            fail("A payload cannot drop a live Pay product; use its verified rollback capability.")
        if "permission" in live_surfaces and "permission" not in incoming_surfaces:
            fail("A payload cannot drop a live Permission product; use its verified rollback capability.")
        if "pages" in live_surfaces and "pages" not in incoming_surfaces:
            fail("A V3 payload cannot replace a live V4 Pages release; use its verified rollback capability.")
        live_managed_before = managed_fingerprint(
            www_root,
            expected_owner,
            live_surfaces,
        )
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
            incoming_surfaces,
        )

        direct_context = direct_stage_context(arguments, www_root, surfaces_root, staging_root) if direct else None
        # Guard before creating private scratch, then refresh immediately before
        # every real copy. Do not assume future deduplication or removals reclaim
        # any bytes; only a new statvfs measurement can observe released space.
        if preserved_build:
            validate_preserved_surfaces_root(surfaces_root, arguments.release_id, expected_owner,
                os.getegid() if allow_test_roots else 0, www_details.st_dev, mountinfo)
            preserved_input_receipt(surfaces_root, arguments.release_id,
                arguments.preserved_input_receipt_sha256, expected_owner)
            reject_nested_mounts(staging_root, mountinfo)
            evidence_parent = TRANSPORT_EVIDENCE_ROOT / arguments.release_id
            temporary_parent = evidence_parent / f".proofofwork-ui-stage-{arguments.release_id}.{arguments.preserved_build_attempt}"
            if os.path.lexists(temporary_parent):
                fail("Refusing an occupied preserved candidate attempt namespace.")
            # The original full logical-copy guard charges the real allocation
            # filesystem. No deduplication savings enter a pre-copy guard.
            copy_capacity_guard(www_root, evidence_parent, "stage-private-root", extra_entries=2)
            temporary_parent.mkdir(mode=0o700)
            private = temporary_parent.lstat()
            private_identity = (private.st_dev, private.st_ino, private.st_uid, private.st_gid, stat.S_IMODE(private.st_mode))
            fsync_directory(evidence_parent)
        elif direct:
            # The receiver holds the deployment lock continuously. A failed
            # construction retains this attempt-specific namespace for reconciliation.
            peak = direct_context["peak"]
            helper = capacity_helper()
            helper.check_deploy_scratch(staging_root, peak, "stage-direct-construction")
            capacity_guard(staging_root, peak, direct_context["inodes"], "stage-direct-construction")
            temporary_parent = staging_root / f".proofofwork-ui-stage-{arguments.release_id}.{arguments.direct_attempt}"
            temporary_parent.mkdir(mode=0o700)
            fsync_directory(staging_root)
        else:
            copy_capacity_guard(www_root, staging_root, "stage-private-root", extra_entries=2, scratch_budget=True)
            temporary_parent = Path(
                tempfile.mkdtemp(
                    prefix=f".proofofwork-ui-stage-{arguments.release_id}.",
                    dir=staging_root,
                )
            )
        candidate = temporary_parent / "candidate"
        if direct:
            direct_seed(www_root, candidate, direct_context["live"])
        else:
            copy_capacity_guard(www_root, temporary_parent, "stage-live-copy")
            run_checked(["/usr/bin/cp", "--archive", "--one-file-system", "--", str(www_root), str(candidate)])
        copied_manifest = candidate / MANIFEST_NAME
        if os.path.lexists(copied_manifest):
            details = copied_manifest.lstat()
            if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode):
                fail("Copied UI release manifest is not a regular file.")
            copied_manifest.unlink()

        if arguments.deduplicate_managed_files:
            deduplicator = CandidateManagedDeduplicator(candidate, expected_owner)

        for surface in incoming_surfaces:
            destination = candidate / f"proofofwork-{surface}"
            if not direct and surface in live_surfaces and not path_is_canonical_directory(destination):
                fail(f"Copied managed UI root is not a canonical directory: {destination}")
            if not direct and surface in live_surfaces:
                shutil.rmtree(destination)
            elif os.path.lexists(destination):
                fail(f"Copied new managed UI root unexpectedly exists: {destination}")
            copy_capacity_guard(surfaces_root / surface, candidate, f"stage-incoming-{surface}",
                                scratch_root=staging_root if direct else None)
            run_checked(
                [
                    "/usr/bin/cp",
                    "--archive",
                    # A compact input can share inodes inside its own tree.
                    # The candidate's deduplicator verifies its own aliases.
                    "--no-preserve=links",
                    "--one-file-system",
                    "--",
                    str(surfaces_root / surface),
                    str(destination),
                ]
            )
            if deduplicator is not None:
                deduplicator.add_surface(surface)

        candidate_payload_copy, _, _ = bounded_managed_fingerprint(
            candidate,
            expected_owner,
            maximum_payload_entries,
            maximum_payload_bytes,
            "Copied incoming managed UI payload",
            incoming_surfaces,
        )
        if candidate_payload_copy != payload_before:
            fail("Staged new-build surface copy differs from the validated payload.")
        current_payload, _, _ = bounded_payload_fingerprint(
            surfaces_root,
            expected_owner,
            maximum_payload_entries,
            maximum_payload_bytes,
            incoming_surfaces,
        )
        if current_payload != payload_before:
            fail("New-build UI surfaces changed while they were copied.")

        dependency_count, dependency_bytes = copy_prior_asset_compatibility(
            www_root,
            candidate,
            live_surfaces,
            deduplicator,
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
            incoming_surfaces,
        )
        for surface in incoming_surfaces:
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
            incoming_surfaces,
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
        if live_surface_names(www_root) != live_surfaces:
            fail("Live managed UI surface set changed while staging.")
        if (
            managed_fingerprint(www_root, expected_owner, live_surfaces)
            != live_managed_before
        ):
            fail("Live managed UI surfaces changed while staging.")
        if passthrough_fingerprint(www_root) != live_passthrough_before:
            fail("Live non-release /var/www content changed while staging.")
        if os.path.lexists(stage_root):
            fail(f"UI stage root appeared concurrently: {stage_root}")

        if direct:
            if (direct_tree_snapshot(www_root) != direct_context["live"]
                    or direct_tree_snapshot(surfaces_root.parent) != direct_context["input"]):
                fail("AMO direct staging sources changed during construction.")
            allocation, direct_snapshot = candidate_allocation(candidate, expected_owner)
            if allocation["additionalBytes"] > direct_context["final"]:
                fail("AMO direct staging completed candidate exceeds its approved bound.")
        if preserved_build:
            validate_preserved_surfaces_root(surfaces_root, arguments.release_id, expected_owner,
                os.getegid() if allow_test_roots else 0, www_details.st_dev, mountinfo)
            private = canonical_safe_directory(temporary_parent, "Preserved candidate private parent", expected_owner)
            if (private.st_dev, private.st_ino, private.st_uid, private.st_gid, stat.S_IMODE(private.st_mode)) != private_identity:
                fail("Preserved candidate private parent identity changed.")
            allocation, snapshots = candidate_allocation(candidate, expected_owner)
            allocation.update({"releaseId": arguments.release_id, "attempt": arguments.preserved_build_attempt,
                "incomingReceiptSha256": arguments.preserved_input_receipt_sha256,
                "candidate": str(candidate), "stageRoot": str(stage_root), "historicalDeletion": False})
            report_path = temporary_parent / "completed-candidate-allocation.json"
            # The report is outside the candidate but remains durable evidence.
            capacity_guard(temporary_parent, 65536, 1, "stage-allocation-evidence")
            with report_path.open("x") as output:
                os.fchmod(output.fileno(), 0o600)
                json.dump(allocation, output, sort_keys=True); output.write("\n")
                output.flush(); os.fsync(output.fileno())
            fsync_directory(temporary_parent)
            run_checked(["/usr/bin/sync", "--file-system", str(candidate)])
            preserved_input_receipt(surfaces_root, arguments.release_id,
                arguments.preserved_input_receipt_sha256, expected_owner)
            validate_preserved_surfaces_root(surfaces_root, arguments.release_id, expected_owner,
                os.getegid() if allow_test_roots else 0, www_details.st_dev, mountinfo)
            private = canonical_safe_directory(temporary_parent, "Preserved candidate private parent", expected_owner)
            if (private.st_dev, private.st_ino, private.st_uid, private.st_gid, stat.S_IMODE(private.st_mode)) != private_identity:
                fail("Preserved candidate private parent identity changed before rename.")
            reject_nested_mounts(staging_root, mountinfo)
            try:
                capacity_helper().check_deploy_scratch(staging_root, allocation["additionalBytes"],
                    "stage-completed-candidate-admission")
            except (capacity_helper().CapacityError, OSError, subprocess.SubprocessError, UnicodeError) as error:
                raise StageError(str(error)) from error
            capacity_guard(staging_root, capacity_helper().entry_bytes(0, capacity_helper().allocation_block(staging_root)),
                           1, "stage-atomic-publication")
            verify_candidate_allocation(snapshots)
            if os.path.lexists(stage_root):
                fail("UI stage root appeared after completed candidate admission.")
        else:
            capacity_guard(staging_root,
                           capacity_helper().entry_bytes(0, capacity_helper().allocation_block(staging_root)),
                           1, "stage-atomic-publication")
            run_checked(["/usr/bin/sync", "--file-system", str(candidate)])
        if direct:
            verify_candidate_allocation(direct_snapshot)
            require_direct_receiver_lock(deploy_lock)
            require_direct_approval(verify_active(direct_context["binding"]), direct_context["approval"])
            for path, record in direct_context["records"].items():
                if direct_file(path)[1] != record:
                    fail("AMO direct staging receiver evidence changed before rename.")
        rename_directory_noreplace(candidate, stage_root)
        if preserved_build:
            translated = {}
            for original_path, (expected, attrs) in snapshots.items():
                published_path = stage_root / original_path.relative_to(candidate)
                if original_path == candidate:
                    current = allocation_identity(published_path.lstat())
                    # rename changes only the moved directory's ctime.
                    if current[:-1] != expected[:-1]:
                        fail("Completed candidate root changed during no-replace rename.")
                    expected = current
                translated[published_path] = (expected, attrs)
            verify_candidate_allocation(translated)
        # Never remove the release-bound stage after this atomic publication;
        # a later durability or final-validation error leaves exact bytes for
        # explicit operator retry or classification.
        fsync_directory(staging_root)
        fsync_directory(temporary_parent)
        if not preserved_build:
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
            f"deduplicated_files={deduplicator.linked_files if deduplicator else 0} "
            f"deduplicated_bytes={deduplicator.saved_bytes if deduplicator else 0} "
            f"candidate_storage={'release-evidence-v1' if preserved_build else 'deploy-scratch'} "
            f"stage_root={stage_root}"
            + (f" constructor=amo-direct-stage-v1 direct_plan_sha256={arguments.direct_plan_sha256}" if direct else "")
        )
        return 0
    finally:
        try:
            if deduplicator is not None:
                deduplicator.close()
            if not preserved_build and not direct and temporary_parent is not None and temporary_parent.exists():
                shutil.rmtree(temporary_parent)
            # An opted-in current-release candidate and its report are retained
            # after every failure; no previous evidence namespace is cleaned.
        finally:
            if not os.environ.get("POW_UI_DEPLOY_LOCK_FD"):
                os.close(lock_descriptor)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except StageError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
