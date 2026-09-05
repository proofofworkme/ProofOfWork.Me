#!/usr/bin/python3 -I
"""Exact audit-5 operations targets; default read-only, with private receipts."""
import sys
if __name__ == "__main__" and not sys.flags.isolated:
    raise SystemExit("Run the installer with python3 -I to isolate root imports")

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess


TARGETS = {
    "node": [
        ("proofofwork-release-prune.sh", "/usr/local/sbin/proofofwork-release-prune", "0755"),
        ("proofofwork-node-release-health.service", "/etc/systemd/system/proofofwork-node-release-health.service", "0644"),
        ("proofofwork-node-release-prune.service", "/etc/systemd/system/proofofwork-node-release-prune.service", "0644"),
    ],
    "ui": [
        ("proofofwork-ui-release-provenance.sh", "/usr/local/sbin/proofofwork-ui-release-provenance", "0755"),
        ("proofofwork-ui-release-stage.py", "/usr/local/sbin/proofofwork-ui-release-stage", "0755"),
        ("proofofwork-ui-release-publish.sh", "/usr/local/sbin/proofofwork-ui-release-publish", "0755"),
        ("proofofwork-ui-retained-root.py", "/usr/local/sbin/proofofwork-ui-retained-root", "0755"),
        ("proofofwork-release-prune.sh", "/usr/local/sbin/proofofwork-release-prune", "0755"),
        ("proofofwork-ui-storage-health.sh", "/usr/local/sbin/proofofwork-ui-storage-health", "0755"),
        ("proofofwork-ui-release-prune.service", "/etc/systemd/system/proofofwork-ui-release-prune.service", "0644"),
        ("proofofwork-ui-storage-health.service", "/etc/systemd/system/proofofwork-ui-storage-health.service", "0644"),
        ("apport-disable.conf", "/etc/default/apport", "0644"),
        ("apport-hardening.conf", "/etc/systemd/system/apport.service.d/hardening.conf", "0644"),
        ("coredump-disable-sysctl.conf", "/etc/sysctl.d/99-proofofwork-disable-coredumps.conf", "0644"),
    ],
}
TIMERS = {
    "node": ["proofofwork-node-release-health.timer", "proofofwork-node-release-prune.timer"],
    "ui": ["proofofwork-ui-release-provenance.timer", "proofofwork-ui-release-prune.timer", "proofofwork-ui-storage-health.timer"],
}
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def directory(path, *, allow_run_mount=False):
    """No symlink or subordinate mount; only the exact sticky /var/tmp exception."""
    path = Path(path)
    require(path.is_absolute(), "directory is not absolute")
    for member in reversed([path, *path.parents]):
        info = member.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0, f"unsafe directory: {member}")
        allowed = member == Path("/var/tmp") and stat.S_IMODE(info.st_mode) == 0o1777
        require(allowed or not info.st_mode & 0o7022, f"writable directory: {member}")
        permitted_mount = member == Path("/") or (allow_run_mount and member == Path("/run"))
        require(permitted_mount or not os.path.ismount(member), f"nested mount: {member}")


def read_file(path):
    directory(Path(path).parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1
                and not before.st_mode & 0o7022 and before.st_size <= 1048576, f"unsafe file: {path}")
        payload = b""
        while len(payload) <= before.st_size:
            block = os.read(fd, min(65536, before.st_size + 1 - len(payload)))
            if not block:
                break
            payload += block
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                and len(payload) == before.st_size, f"file changed during read: {path}")
        return payload, {"sha256": hashlib.sha256(payload).hexdigest(), "uid": before.st_uid,
                         "gid": before.st_gid, "mode": oct(stat.S_IMODE(before.st_mode)), "bytes": len(payload)}
    finally:
        os.close(fd)


def target_state(path):
    path = Path(path)
    if os.path.lexists(path):
        return read_file(path)[1]
    parent = path.parent
    if not parent.exists():
        require(parent == Path("/etc/systemd/system/apport.service.d"), "unexpected missing parent")
        directory(parent.parent)
    else:
        directory(parent)
    return {"exists": False, "symlink": False}


def validate_manifest(manifest, host, commit):
    require(manifest.get("format") == "audit5-operations-install-review-v1"
            and manifest.get("sourceCommit") == commit, "manifest format/commit mismatch")
    files = manifest["hosts"][host]["files"]
    expected = [("deploy/" + source, target, mode) for source, target, mode in TARGETS[host]]
    require([(entry["source"], entry["destination"], entry["mode"]) for entry in files] == expected,
            "exact target list mismatch")
    for entry in files:
        require(re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]) and 0 < entry["bytes"] <= 1048576,
                "invalid source digest/size")
    return files


def run(argv):
    result = subprocess.run(argv, env=ENV, capture_output=True, text=True, timeout=90)
    require(result.returncode == 0, f"command failed: {argv[0:2]}: {result.stderr.strip()}")
    return result.stdout.strip()


def exclusive_write(path, payload, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, "wb", closefd=False) as output:
            output.write(payload)
            output.flush()
            os.fsync(fd)
    finally:
        os.close(fd)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def ui_lock():
    lock = Path("/run/proofofwork-ui/deploy.lock")
    directory(lock.parent, allow_run_mount=True)
    expected = lock.lstat()
    require(stat.S_ISREG(expected.st_mode) and expected.st_uid == 0
            and not expected.st_mode & 0o7022, "unsafe deployment lock")
    inherited = os.environ.get("POW_UI_DEPLOY_LOCK_FD")
    fd = os.dup(int(inherited)) if inherited is not None else os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        actual = os.fstat(fd)
        require((expected.st_dev, expected.st_ino) == (actual.st_dev, actual.st_ino), "deployment lock identity mismatch")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd
    except Exception:
        os.close(fd)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host", choices=TARGETS)
    parser.add_argument("release_id")
    parser.add_argument("commit")
    parser.add_argument("manifest_sha256")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    require(os.geteuid() == 0 and re.fullmatch(r"[0-9a-f]{40}", args.commit)
            and re.fullmatch(r"[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z", args.release_id)
            and args.release_id[:12] == args.commit[:12]
            and re.fullmatch(r"[0-9a-f]{64}", args.manifest_sha256), "invalid invocation")
    os.umask(0o077)
    source = Path("/var/tmp/proofofwork-audit5-ops-source-" + args.release_id)
    raw, metadata = read_file(source / "ops-install-manifest.json")
    require(metadata["sha256"] == args.manifest_sha256, "manifest hash mismatch")
    files = validate_manifest(json.loads(raw), args.host, args.commit)
    payloads = {}
    for entry in files:
        payload, info = read_file(source / entry["source"])
        require(info["sha256"] == entry["sha256"] and info["bytes"] == entry["bytes"], "new source hash/size mismatch")
        require(target_state(entry["destination"]) == entry["installedBefore"], "installed target changed since review")
        payloads[entry["destination"]] = payload
    require(os.statvfs("/").f_bavail * os.statvfs("/").f_frsize >= 10737418240 + 67108864,
            "root free-space floor/reserve violated")
    timers = {timer: run(["systemctl", "show", timer, "--property=ActiveState,UnitFileState"]) for timer in TIMERS[args.host]}
    if not args.apply:
        print(json.dumps({"status": "verified-dry-run", "host": args.host, "release": args.release_id,
                          "targets": len(files), "timersBefore": timers}))
        return
    receipt = Path("/var/tmp/proofofwork-audit5-ops-install-" + args.release_id + "-" + args.host)
    directory(receipt.parent)
    receipt.mkdir(mode=0o700)  # Existing evidence is never overwritten.
    exclusive_write(receipt / "manifest.json", raw)
    exclusive_write(receipt / "timers-before.json", json.dumps(timers, indent=2).encode())
    if args.host == "ui":
        exclusive_write(receipt / "core-sysctl-before.txt", run(["sysctl", "kernel.core_pattern", "kernel.core_pipe_limit", "fs.suid_dumpable"]).encode())
        exclusive_write(receipt / "apport-before.txt", run(["systemctl", "show", "apport.service", "--property=ActiveState,UnitFileState,LimitCORE"]).encode())
    sync_directory(receipt)
    # Stop only maintenance timers. A running verifier makes lock acquisition fail
    # safely; the receipt retains the exact prior timer states for coordination.
    run(["systemctl", "stop", *TIMERS[args.host]])
    lock_fd = ui_lock() if args.host == "ui" else None
    try:
        for timer in TIMERS[args.host]:
            state = run(["systemctl", "show", timer[:-6] + ".service", "--property=ActiveState", "--value"])
            require(state in {"inactive", "failed"}, "maintenance service still running")
        for index, entry in enumerate(files):
            target = Path(entry["destination"])
            require(target_state(target) == entry["installedBefore"], "target drift after lock")
            if target.exists():
                previous, _ = read_file(target)
                exclusive_write(receipt / (str(index) + ".before"), previous)
                sync_directory(receipt)
            if not target.parent.exists():
                target.parent.mkdir(mode=0o755)
            temporary = target.parent / ("." + target.name + ".audit5-" + args.release_id)
            exclusive_write(temporary, payloads[str(target)], int(entry["mode"], 8))
            os.chown(temporary, 0, 0)
            os.chmod(temporary, int(entry["mode"], 8))
            require(target_state(target) == entry["installedBefore"], "target drift before replacement")
            os.replace(temporary, target)
            sync_directory(target.parent)
            require(read_file(target)[1]["sha256"] == entry["sha256"], "installed hash mismatch")
            exclusive_write(receipt / (str(index) + ".installed.json"), json.dumps(entry).encode())
        run(["systemctl", "daemon-reload"])
        if args.host == "ui":
            run(["systemctl", "disable", "--now", "apport.service"])
            run(["sysctl", "-p", "/etc/sysctl.d/99-proofofwork-disable-coredumps.conf"])
        for timer, state in timers.items():
            if "ActiveState=active" in state.splitlines() and timer != "proofofwork-ui-release-provenance.timer":
                run(["systemctl", "start", timer])
        result = {"status": "installed", "host": args.host, "release": args.release_id, "commit": args.commit,
                  "manifestSha256": args.manifest_sha256, "targets": len(files),
                  "provenanceTimerHeld": args.host == "ui", "oneshotsExplicitlyInvoked": False}
        exclusive_write(receipt / "completed.json", json.dumps(result, indent=2).encode())
        sync_directory(receipt)
        print(json.dumps({**result, "receipt": str(receipt)}))
    finally:
        if lock_fd is not None:
            os.close(lock_fd)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("audit5_ops_install status=failed_preserved error=" + str(error), file=sys.stderr)
        sys.exit(1)
