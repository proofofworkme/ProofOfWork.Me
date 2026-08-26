#!/usr/bin/python3
"""Atomically exchange the live and release-scoped node checkouts."""

from __future__ import annotations

import argparse
import ctypes
import errno
import os
import re
import stat
import sys


PRODUCTION_OPT_ROOT = "/opt"
PRODUCTION_MOUNTINFO = "/proc/self/mountinfo"
LIVE_NAME = "proofofwork-api"
STAGE_PREFIX = "proofofwork-api-stage-"
RENAME_EXCHANGE = 2
RELEASE_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")


class ExchangeError(Exception):
    """A checked precondition or exchange verification failed."""

    def __init__(self, message: str, *, exit_code: int = 1) -> None:
        super().__init__(message)
        self.exit_code = exit_code


def path_has_unsafe_text(path: str) -> bool:
    return (
        not path
        or "\\" in path
        or any(ord(character) < 32 or ord(character) == 127 for character in path)
    )


def directory_identity(details: os.stat_result) -> tuple[int, int, int, int, int]:
    return (
        details.st_dev,
        details.st_ino,
        details.st_mode,
        details.st_uid,
        details.st_gid,
    )


def decode_mount_path(value: str) -> str:
    return (
        value.replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\012", "\n")
        .replace("\\134", "\\")
    )


def reject_nested_mounts(roots: tuple[str, str], mountinfo_path: str) -> None:
    try:
        details = os.lstat(mountinfo_path)
    except OSError as error:
        raise ExchangeError(
            f"Unable to inspect node exchange mount metadata: {error}"
        ) from error
    if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode):
        raise ExchangeError(
            f"Node exchange mount metadata must be a regular non-symlink file: {mountinfo_path}"
        )

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(mountinfo_path, flags)
    except OSError as error:
        raise ExchangeError(
            f"Unable to open node exchange mount metadata without following links: {error}"
        ) from error
    try:
        opened = os.fstat(descriptor)
        if directory_identity(opened) != directory_identity(details):
            raise ExchangeError("Node exchange mount metadata changed while it was opened.")
        with os.fdopen(descriptor, encoding="utf-8", closefd=False) as source:
            for line in source:
                fields = line.split()
                if len(fields) < 5:
                    raise ExchangeError("Node exchange mount metadata is malformed.")
                mount = os.path.realpath(decode_mount_path(fields[4]))
                for root in roots:
                    try:
                        nested = mount == root or os.path.commonpath((root, mount)) == root
                    except ValueError:
                        nested = False
                    if nested:
                        raise ExchangeError(
                            f"Node checkout contains mounted content at {mount}."
                        )
    except UnicodeError as error:
        raise ExchangeError("Node exchange mount metadata is not valid UTF-8.") from error
    finally:
        os.close(descriptor)


def checked_parent(path: str, *, allow_test_roots: bool) -> tuple[int, os.stat_result]:
    if (
        not os.path.isabs(path)
        or path == "/"
        or path != os.path.normpath(path)
        or path_has_unsafe_text(path)
    ):
        raise ExchangeError(f"Node checkout parent is not an exact safe absolute path: {path}")
    try:
        details = os.lstat(path)
    except OSError as error:
        raise ExchangeError(f"Unable to inspect node checkout parent {path}: {error}") from error
    if (
        not stat.S_ISDIR(details.st_mode)
        or stat.S_ISLNK(details.st_mode)
        or os.path.realpath(path) != path
    ):
        raise ExchangeError(f"Node checkout parent must be a real canonical directory: {path}")
    expected_owner = os.geteuid()
    if details.st_uid != expected_owner or stat.S_IMODE(details.st_mode) & 0o7022:
        qualifier = "test " if allow_test_roots else ""
        raise ExchangeError(
            f"Node checkout {qualifier}parent must be owner-controlled and not group/world writable: {path}"
        )

    # The parent descriptor is also the durability boundary after renameat2,
    # so it must be a real readable directory descriptor rather than O_PATH.
    flags = (
        os.O_RDONLY
        | os.O_DIRECTORY
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ExchangeError(
            f"Unable to open node checkout parent without following links: {error}"
        ) from error
    opened = os.fstat(descriptor)
    if directory_identity(opened) != directory_identity(details):
        os.close(descriptor)
        raise ExchangeError("Node checkout parent changed while it was opened.")
    return descriptor, opened


def checked_child(
    parent_descriptor: int,
    parent_path: str,
    name: str,
    label: str,
) -> tuple[int, os.stat_result]:
    if (
        not name
        or name in (".", "..")
        or "/" in name
        or path_has_unsafe_text(name)
    ):
        raise ExchangeError(f"{label} name is not an exact safe basename.")
    path = os.path.join(parent_path, name)
    try:
        details = os.stat(name, dir_fd=parent_descriptor, follow_symlinks=False)
    except OSError as error:
        raise ExchangeError(f"Unable to inspect {label} {path}: {error}") from error
    if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode):
        raise ExchangeError(f"{label} must be a real non-symlink directory: {path}")
    if os.path.realpath(path) != path:
        raise ExchangeError(f"{label} path is not canonical: {path}")
    if stat.S_IMODE(details.st_mode) & 0o7022:
        raise ExchangeError(f"{label} has an unsafe mode: {path}")

    flags = (
        getattr(os, "O_PATH", os.O_RDONLY)
        | os.O_DIRECTORY
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        descriptor = os.open(name, flags, dir_fd=parent_descriptor)
    except OSError as error:
        raise ExchangeError(f"Unable to bind {label} without following links: {error}") from error
    opened = os.fstat(descriptor)
    if directory_identity(opened) != directory_identity(details):
        os.close(descriptor)
        raise ExchangeError(f"{label} changed while it was opened.")
    return descriptor, opened


def stat_child(parent_descriptor: int, name: str) -> os.stat_result:
    return os.stat(name, dir_fd=parent_descriptor, follow_symlinks=False)


def assert_identity(
    actual: os.stat_result,
    expected: os.stat_result,
    message: str,
    *,
    exit_code: int = 1,
) -> None:
    if directory_identity(actual) != directory_identity(expected):
        raise ExchangeError(message, exit_code=exit_code)


def rename_exchange(parent_descriptor: int, left_name: str, right_name: str) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise ExchangeError("renameat2(RENAME_EXCHANGE) is unavailable in libc.")
    renameat2.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    renameat2.restype = ctypes.c_int
    result = renameat2(
        parent_descriptor,
        os.fsencode(left_name),
        parent_descriptor,
        os.fsencode(right_name),
        RENAME_EXCHANGE,
    )
    if result == 0:
        return
    error_number = ctypes.get_errno()
    description = os.strerror(error_number)
    if error_number in (errno.ENOSYS, errno.EINVAL, errno.EOPNOTSUPP, errno.EXDEV):
        raise ExchangeError(
            f"renameat2(RENAME_EXCHANGE) is unsupported for these node checkouts: {description}"
        )
    raise ExchangeError(f"renameat2(RENAME_EXCHANGE) failed: {description}")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Atomically exchange one exact release-scoped node checkout.",
        allow_abbrev=False,
    )
    parser.add_argument("--release-id", required=True)
    return parser.parse_args()


def run() -> int:
    arguments = parse_arguments()
    if not RELEASE_ID_PATTERN.fullmatch(arguments.release_id):
        print(
            "Release id must use 1-128 safe filename characters.",
            file=sys.stderr,
        )
        return 64

    allow_test_value = os.environ.get("POW_NODE_EXCHANGE_ALLOW_TEST_ROOTS", "")
    if allow_test_value not in ("", "1"):
        print("POW_NODE_EXCHANGE_ALLOW_TEST_ROOTS must be unset or 1.", file=sys.stderr)
        return 64
    allow_test_roots = allow_test_value == "1"
    opt_root = os.environ.get("POW_NODE_EXCHANGE_OPT_ROOT", PRODUCTION_OPT_ROOT)
    mountinfo_path = os.environ.get(
        "POW_NODE_EXCHANGE_MOUNTINFO_PATH", PRODUCTION_MOUNTINFO
    )
    if not allow_test_roots and (
        opt_root != PRODUCTION_OPT_ROOT or mountinfo_path != PRODUCTION_MOUNTINFO
    ):
        print(
            "Non-production node exchange paths require POW_NODE_EXCHANGE_ALLOW_TEST_ROOTS=1.",
            file=sys.stderr,
        )
        return 64
    if os.geteuid() != 0 and not allow_test_roots:
        print("Node checkout exchange must run as root.", file=sys.stderr)
        return 77

    stage_name = f"{STAGE_PREFIX}{arguments.release_id}"
    live_path = os.path.join(opt_root, LIVE_NAME)
    stage_path = os.path.join(opt_root, stage_name)
    parent_descriptor = -1
    live_descriptor = -1
    stage_descriptor = -1
    exchanged = False
    try:
        parent_descriptor, parent_before = checked_parent(
            opt_root, allow_test_roots=allow_test_roots
        )
        live_descriptor, live_before = checked_child(
            parent_descriptor, opt_root, LIVE_NAME, "Live node checkout"
        )
        stage_descriptor, stage_before = checked_child(
            parent_descriptor, opt_root, stage_name, "Staged node checkout"
        )
        if live_before.st_dev != parent_before.st_dev or stage_before.st_dev != parent_before.st_dev:
            raise ExchangeError(
                "Live, staged, and parent node checkout directories must share one filesystem."
            )
        if live_before.st_ino == stage_before.st_ino:
            raise ExchangeError("Live and staged node checkout identities must be distinct.")
        if (
            live_before.st_uid,
            live_before.st_gid,
            stat.S_IMODE(live_before.st_mode),
        ) != (
            stage_before.st_uid,
            stage_before.st_gid,
            stat.S_IMODE(stage_before.st_mode),
        ):
            raise ExchangeError(
                "Live and staged node checkout root ownership and mode must match exactly."
            )

        reject_nested_mounts((live_path, stage_path), mountinfo_path)

        assert_identity(
            os.stat(opt_root, follow_symlinks=False),
            parent_before,
            "Node checkout parent path changed before exchange.",
        )
        assert_identity(
            stat_child(parent_descriptor, LIVE_NAME),
            live_before,
            "Live node checkout changed before exchange.",
        )
        assert_identity(
            stat_child(parent_descriptor, stage_name),
            stage_before,
            "Staged node checkout changed before exchange.",
        )
        assert_identity(
            os.fstat(live_descriptor),
            live_before,
            "Live node checkout descriptor changed before exchange.",
        )
        assert_identity(
            os.fstat(stage_descriptor),
            stage_before,
            "Staged node checkout descriptor changed before exchange.",
        )

        rename_exchange(parent_descriptor, LIVE_NAME, stage_name)
        exchanged = True

        assert_identity(
            stat_child(parent_descriptor, LIVE_NAME),
            stage_before,
            "Atomic exchange completed but the live path does not hold the staged checkout.",
            exit_code=70,
        )
        assert_identity(
            stat_child(parent_descriptor, stage_name),
            live_before,
            "Atomic exchange completed but the stage path does not hold the prior live checkout.",
            exit_code=70,
        )
        assert_identity(
            os.fstat(live_descriptor),
            live_before,
            "Prior live checkout descriptor changed during exchange.",
            exit_code=70,
        )
        assert_identity(
            os.fstat(stage_descriptor),
            stage_before,
            "Staged checkout descriptor changed during exchange.",
            exit_code=70,
        )
        assert_identity(
            os.stat(opt_root, follow_symlinks=False),
            parent_before,
            "Node checkout parent path changed during exchange.",
            exit_code=70,
        )
        try:
            os.fsync(parent_descriptor)
        except OSError as error:
            raise ExchangeError(
                f"Atomic exchange completed but parent-directory fsync failed: {error}",
                exit_code=70,
            ) from error
        assert_identity(
            stat_child(parent_descriptor, LIVE_NAME),
            stage_before,
            "Live node checkout identity changed after exchange durability sync.",
            exit_code=70,
        )
        assert_identity(
            stat_child(parent_descriptor, stage_name),
            live_before,
            "Rollback node checkout identity changed after exchange durability sync.",
            exit_code=70,
        )
    except ExchangeError as error:
        if exchanged:
            print(
                "CRITICAL: node checkout exchange reached the rename syscall but did not "
                f"complete verified durable publication: {error}",
                file=sys.stderr,
            )
            return 70
        print(f"Node checkout exchange refused: {error}", file=sys.stderr)
        return error.exit_code
    except OSError as error:
        if exchanged:
            print(
                "CRITICAL: node checkout exchange reached the rename syscall but failed "
                f"during post-exchange verification: {error}",
                file=sys.stderr,
            )
            return 70
        print(f"Node checkout exchange refused after an operating-system error: {error}", file=sys.stderr)
        return 1
    finally:
        for descriptor in (stage_descriptor, live_descriptor, parent_descriptor):
            if descriptor >= 0:
                os.close(descriptor)

    print(
        "node_release_exchange status=exchanged "
        f"release_id={arguments.release_id} live={live_path} rollback={stage_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
