#!/usr/bin/env python3
"""Hash-bound handoff with no automatic retries; native runner is the authority.

This does not create activation approval. Review the manifest, checker and native
runner together. No release journal or successful checker permits replay of an
uncertain native dispatch. Native controllers alone own mutation/recovery limits.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

SHA = re.compile(r"[0-9a-f]{64}")
PATH = re.compile(r"/[A-Za-z0-9_./-]+")
MAX_METADATA = 16384
MAX_SOURCE = 256 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical_path(value):
    require(isinstance(value, str) and PATH.fullmatch(value), "Invalid absolute path")
    p = Path(value)
    require(str(p) == value and all(x not in (".", "..") for x in value.split("/")), "Noncanonical path")
    return p


def identity(st):
    return tuple(getattr(st, field) for field in ("st_dev", "st_ino", "st_mode", "st_nlink", "st_uid", "st_gid", "st_size", "st_mtime_ns", "st_ctime_ns"))


def reviewed(path, digest, limit):
    p = canonical_path(path)
    require(isinstance(digest, str) and SHA.fullmatch(digest), "Invalid source hash")
    parents = []
    for parent in reversed(p.parents):
        st = parent.lstat()
        require(stat.S_ISDIR(st.st_mode) and st.st_uid in (0, os.getuid()), "Untrusted source ancestor")
        writable = st.st_mode & 0o022
        require(not writable or (str(parent) in ("/tmp", "/var/tmp") and st.st_uid == 0 and stat.S_IMODE(st.st_mode) == 0o1777), "Writable source ancestor")
        parents.append((parent, identity(st)))
    before = p.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == os.getuid() and stat.S_IMODE(before.st_mode) == 0o600 and before.st_size <= limit, "Untrusted source file")
    with os.fdopen(os.open(p, os.O_RDONLY | os.O_NOFOLLOW), "rb") as source:
        require(identity(os.fstat(source.fileno())) == identity(before), "Source replaced")
        raw = source.read(limit + 1)
        require(identity(os.fstat(source.fileno())) == identity(before), "Source changed")
    require(len(raw) == before.st_size and identity(p.lstat()) == identity(before), "Source changed")
    # Ancestor directory times legitimately change with unrelated temporary files;
    # bind their device/inode/mode/ownership, not child-entry timestamps.
    for parent, old in parents:
        require(identity(parent.lstat())[:6] == old[:6], "Source ancestor replaced")
    require(hashlib.sha256(raw).hexdigest() == digest, "Source hash mismatch")
    return raw


def exact_json(raw):
    def pairs(rows):
        value = {}
        for key, item in rows:
            require(key not in value, "Duplicate JSON key")
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=pairs)


def specification(raw):
    value = exact_json(raw)
    require(isinstance(value, dict) and set(value) == {"format", "checker", "runner", "evidence", "ssh", "checkerTimeoutSeconds"}, "Wrong manifest fields")
    require(value["format"] == "pay-qualification-handoff-v1", "Wrong manifest format")
    for name in ("checker", "runner"):
        row = value[name]
        require(isinstance(row, dict) and set(row) == {"path", "sha256"}, "Wrong source descriptor")
        canonical_path(row["path"])
        require(isinstance(row["sha256"], str) and SHA.fullmatch(row["sha256"]), "Wrong source hash")
    canonical_path(value["evidence"])
    ssh = value["ssh"]
    require(isinstance(ssh, dict) and set(ssh) == {"account", "host", "identityFile"}, "Wrong SSH fields")
    require(isinstance(ssh["account"], str) and re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", ssh["account"]), "Wrong SSH account")
    require(isinstance(ssh["host"], str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}", ssh["host"]), "Wrong SSH host")
    canonical_path(ssh["identityFile"])
    require(type(value["checkerTimeoutSeconds"]) is int and 1 <= value["checkerTimeoutSeconds"] <= 8100, "Wrong checker timeout")
    return value


def metadata(raw, returncode, evidence):
    require(len(raw) <= MAX_METADATA and returncode == 0, "Checker failed; preserve VPS evidence")
    lines = raw.decode("utf-8").splitlines()
    require(len(lines) == 2 and lines[1] == "checker_exit=0 evidence_receiver_exit=0", "Both pipeline statuses must be zero")
    value = exact_json(lines[0])
    require(isinstance(value, dict) and set(value) == {"evidence", "bytes", "sha256"}, "Wrong metadata fields")
    require(value["evidence"] == evidence and type(value["bytes"]) is int and 0 < value["bytes"] <= 2 * 1024**2, "Wrong evidence location or size")
    require(isinstance(value["sha256"], str) and SHA.fullmatch(value["sha256"]), "Wrong evidence hash")
    return value


def checker_output(source, timeout, env):
    # All source bytes are reviewed before starting. A temporary file/FD is not
    # needed: Bash consumes the bounded script on stdin, as in the reviewed v4.
    child = subprocess.Popen(["/bin/bash"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, start_new_session=True)
    selector = selectors.DefaultSelector()
    output = bytearray()
    started = time.monotonic()
    try:
        os.set_blocking(child.stdin.fileno(), False)
        os.set_blocking(child.stdout.fileno(), False)
        selector.register(child.stdin, selectors.EVENT_WRITE)
        selector.register(child.stdout, selectors.EVENT_READ)
        sent = 0
        while selector.get_map():
            remaining = timeout - (time.monotonic() - started)
            require(remaining > 0, "Read-only checker timed out; native dispatch not started")
            for key, _ in selector.select(min(remaining, 1)):
                if key.fileobj is child.stdin:
                    try:
                        sent += os.write(child.stdin.fileno(), source[sent:sent + 4096])
                    except BrokenPipeError:
                        sent = len(source)
                    if sent == len(source):
                        selector.unregister(child.stdin)
                        child.stdin.close()
                else:
                    raw = os.read(child.stdout.fileno(), MAX_METADATA + 1 - len(output))
                    if not raw:
                        selector.unregister(child.stdout)
                        child.stdout.close()
                    else:
                        output.extend(raw)
                        require(len(output) <= MAX_METADATA, "Checker metadata overflow; native dispatch not started")
        remaining = timeout - (time.monotonic() - started)
        require(remaining > 0, "Checker timeout")
        return bytes(output), child.wait(timeout=remaining)
    except BaseException:
        # Only this owned read-only checker session; never a native mutation.
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                raise RuntimeError("Owned read-only checker still running; reconcile group " + str(child.pid)) from None
        else:
            raise RuntimeError("Read-only checker leader exited; reconcile descendants of observed group " + str(child.pid) + "; no native dispatch") from None
        raise
    finally:
        selector.close()
        for stream in (child.stdin, child.stdout):
            if not stream.closed:
                stream.close()


def native_command(value, digest):
    require(SHA.fullmatch(digest), "Invalid native evidence digest")
    ssh = value["ssh"]
    return ["/usr/bin/ssh", "-i", ssh["identityFile"], "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10", ssh["account"] + "@" + ssh["host"], "sudo -n /usr/bin/python3 -I -B - " + digest]


def execute(value, checker, runner):
    env = {"PATH": "/usr/bin:/bin", "HOME": str(Path.home()), "LC_ALL": "C"}
    raw, status = checker_output(checker, value["checkerTimeoutSeconds"], env)
    receipt = metadata(raw, status, value["evidence"])
    print(json.dumps({"phase": "checker-complete", "receipt": receipt, "nativeRunnerSha256": value["runner"]["sha256"]}), flush=True)
    print(json.dumps({"phase": "native-dispatch-starting", "uncertainOutcomeRequiresReconciliation": True}), flush=True)
    # No outer timeout/signal forwarding: native controller owns recovery. SSH
    # failure is ambiguous, never permission to rerun the mutation.
    try:
        result = subprocess.run(native_command(value, receipt["sha256"]), input=runner, env=env)
    except BaseException:
        print(json.dumps({"phase": "native-dispatch-uncertain", "doNotRetry": True}), flush=True)
        raise
    print(json.dumps({"phase": "native-dispatch-terminal" if result.returncode == 0 else "native-dispatch-uncertain", "exit": result.returncode, "nativeReceiptVerificationRequired": True, "doNotRetry": result.returncode != 0}), flush=True)
    return result.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest")
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--execute-reviewed-once", action="store_true", required=True)
    args = parser.parse_args()
    require(sys.flags.isolated, "Use python3 -I -B")
    value = specification(reviewed(args.manifest, args.manifest_sha256, MAX_METADATA))
    checker = reviewed(value["checker"]["path"], value["checker"]["sha256"], MAX_SOURCE)
    runner = reviewed(value["runner"]["path"], value["runner"]["sha256"], MAX_SOURCE)
    return execute(value, checker, runner)


if __name__ == "__main__":
    sys.exit(main())
