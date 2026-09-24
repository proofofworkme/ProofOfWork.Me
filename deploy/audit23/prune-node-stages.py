#!/usr/bin/python3 -I
"""Prove stale node stages have verified release archives; optionally prune only those copies."""
import sys
if not sys.flags.isolated:
    raise SystemExit("Use python3 -I")
import datetime
import hashlib
import json
import os
import pathlib
import pwd
import re
import shutil
import stat
import subprocess
import time

assert os.geteuid() == 0
mode = sys.argv[1] if len(sys.argv) == 2 else "--inspect"
if mode not in ("--inspect", "--apply"):
    raise SystemExit("Usage: prune-node-stages.py [--inspect|--apply]")
OPT = pathlib.Path("/opt")
LIVE = pathlib.Path("/opt/proofofwork-api")
KEEP = pathlib.Path("/opt/proofofwork-api-stage-1149633c2d1a-20260924T015319Z")
RELEASES = pathlib.Path("/data/proofofwork-release-backups/managed")
ATTESTOR = pathlib.Path("/var/tmp/proofofwork-deploy/audit23-tools/attest-node-stage.py")
REPORT = pathlib.Path("/data/proofofwork-audit23-node-stage-1149633-20260924T015319Z-" + mode[2:] + ".json")
PRUNE_LOG = pathlib.Path("/data/proofofwork-audit23-node-stage-1149633-20260924T015319Z-prune.jsonl")
LIVE_EXPECTED = [
    "1149633c2d1a5c62c4a800772daa79683e478796",
    "6071ed84ae3cad5a852ef3d4bb0c87c9d1d64e29",
    "6667",
    "198103142",
    "f1dc4a7b4c75eb48482b544cd720bb51d44ab079f5613ab320825f836405e8d4",
]
ROLLBACK_EXPECTED = [
    "58827586d1a313c6210c3ce599dd46269eeddebc",
    "c47c4cde389ccdb81628289984728e42d9500a6d",
    "6666",
    "198084934",
    "1e735bfba10a6ba3151b7d8a80054792788022c53a6d9de56f2b56e5d77a9d83",
]
STAGE_NAME = re.compile(r"proofofwork-api-stage-([0-9a-f]{7,64})-([0-9]{8}T[0-9]{6}Z)\Z")
ENV = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C", "GIT_OPTIONAL_LOCKS": "0"}


def run(args, timeout=180, cwd=None, env=None):
    result = subprocess.run(args, env=env or ENV, cwd=cwd, stdin=subprocess.DEVNULL,
                            capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f"{args[0]} exited {result.returncode}: {result.stderr[-1200:]}")
    return result.stdout.strip()


def attest(path):
    return run(["/usr/bin/python3", "-I", str(ATTESTOR), str(path)], 300).split("\t")


def parse_provenance(path):
    data = {}
    for line in path.read_text().splitlines():
        if "=" not in line:
            raise RuntimeError(f"Malformed release provenance: {path}")
        key, value = line.split("=", 1)
        if key in data:
            raise RuntimeError(f"Duplicate release provenance key: {path} {key}")
        data[key] = value
    if data.get("format") != "proof-of-work-node-release-provenance-v2":
        raise RuntimeError(f"Unexpected release provenance format: {path}")
    return data


def provenance_tuple(data):
    return [data.get("commit"), data.get("tree"), data.get("runtime_entry_count"),
            data.get("runtime_bytes"), data.get("runtime_sha256")]


def process_references(target):
    needle = str(target)
    found = []
    for proc in pathlib.Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        pid = int(proc.name)
        if pid == os.getpid():
            continue
        for field in ("cwd", "exe", "root"):
            try:
                value = os.readlink(proc / field).removesuffix(" (deleted)")
            except (FileNotFoundError, PermissionError, ProcessLookupError, OSError):
                continue
            if value == needle or value.startswith(needle + "/"):
                found.append({"pid": pid, "field": field, "path": value})
        try:
            command_line = (proc / "cmdline").read_bytes()
        except (FileNotFoundError, PermissionError, ProcessLookupError, OSError):
            command_line = b""
        if os.fsencode(needle) in command_line:
            found.append({"pid": pid, "field": "cmdline", "path": needle})
        fd_root = proc / "fd"
        try:
            descriptors = list(fd_root.iterdir())
        except (FileNotFoundError, PermissionError, ProcessLookupError, OSError):
            descriptors = []
        for descriptor in descriptors:
            try:
                value = os.readlink(descriptor).removesuffix(" (deleted)")
            except (FileNotFoundError, PermissionError, ProcessLookupError, OSError):
                continue
            if value == needle or value.startswith(needle + "/"):
                found.append({"pid": pid, "field": "fd", "path": value})
        try:
            mappings = (proc / "maps").read_text(errors="replace").splitlines()
        except (FileNotFoundError, PermissionError, ProcessLookupError, OSError):
            mappings = []
        for line in mappings:
            mapped = line.rsplit(None, 1)[-1].removesuffix(" (deleted)")
            if mapped == needle or mapped.startswith(needle + "/"):
                found.append({"pid": pid, "field": "maps", "path": mapped})
    return found


def matching_archives(identity, provenances):
    matches = []
    for provenance_path, data in provenances:
        if provenance_tuple(data) != identity:
            continue
        name = data.get("archive", "")
        if not name or pathlib.Path(name).name != name:
            continue
        archive = RELEASES / name
        checksum = RELEASES / (name + ".sha256")
        if not archive.is_file() or archive.is_symlink() or not checksum.is_file() or checksum.is_symlink():
            continue
        expected_digest = data.get("archive_sha256", "")
        checksum_text = checksum.read_text().strip()
        if checksum_text != f"{expected_digest}  {name}":
            continue
        run(["/usr/bin/sha256sum", "--check", "--strict", "--status", checksum.name], 300, cwd=RELEASES)
        matches.append({"archive": name, "sha256": expected_digest,
                        "provenance": provenance_path.name})
    return matches


def health_report(threshold):
    env = {**ENV, "POW_RELEASE_MAX_CHECKOUT_COUNT": str(threshold)}
    result = subprocess.run(["/usr/local/sbin/proofofwork-node-release-health"], env=env,
                            stdin=subprocess.DEVNULL, capture_output=True, text=True,
                            timeout=1800, check=False)
    output = result.stdout + result.stderr
    match = re.search(r"archives=(\d+) verified=(\d+) unverified=(\d+).*provenance=(\d+) current_provenance=(\d+) opt_checkouts=(\d+)", output)
    if not match:
        raise RuntimeError("Node release-health result could not be parsed: " + output[-1500:])
    summary = dict(zip(("archives", "verified", "unverified", "provenance", "currentProvenance", "checkouts"), map(int, match.groups())))
    if result.returncode not in (0, 1) or summary["archives"] != summary["verified"] or summary["unverified"] != 0:
        raise RuntimeError("Node release archives are not all verified: " + output[-1500:])
    return {"returncode": result.returncode, "summary": summary, "output": output[-2500:]}


assert LIVE.is_dir() and not LIVE.is_symlink() and os.path.realpath(LIVE) == str(LIVE)
assert KEEP.is_dir() and not KEEP.is_symlink() and os.path.realpath(KEEP) == str(KEEP)
assert not REPORT.exists() and not REPORT.is_symlink(), "Inventory receipt already exists"
assert not PRUNE_LOG.exists() and not PRUNE_LOG.is_symlink(), "Prune log already exists"
live_identity = attest(LIVE)
rollback_identity = attest(KEEP)
assert live_identity == LIVE_EXPECTED, "Live release changed; refusing stage cleanup"
assert rollback_identity == ROLLBACK_EXPECTED, "Last verified rollback changed; refusing stage cleanup"
archive_health = health_report(100)
provenances = []
for sidecar in sorted(RELEASES.glob("*.tgz.provenance")):
    if sidecar.is_symlink() or not sidecar.is_file():
        raise RuntimeError(f"Unsafe release provenance: {sidecar}")
    provenances.append((sidecar, parse_provenance(sidecar)))
assert len(provenances) == archive_health["summary"]["archives"]
live_archives = matching_archives(live_identity, provenances)
rollback_archives = matching_archives(rollback_identity, provenances)
assert live_archives, "No verified archive exactly matches current live release"
assert rollback_archives, "No verified archive exactly matches the preserved immediate rollback"

stage_paths = sorted(OPT.glob("proofofwork-api-stage-*"), key=lambda p: p.name)
checkout_directories = sorted(
    (path for path in OPT.glob("proofofwork-api*") if path.is_dir() or path.is_symlink()),
    key=lambda p: p.name,
)
assert all(path.is_dir() and not path.is_symlink() and os.path.realpath(path) == str(path)
           for path in checkout_directories)
assert set(checkout_directories) == {LIVE, *stage_paths}
assert KEEP in stage_paths
records = []
for path in stage_paths:
    match = STAGE_NAME.fullmatch(path.name)
    if not match:
        raise RuntimeError(f"Unexpected node stage name; preserve for review: {path.name}")
    is_current_rollback = path == KEEP
    details = os.stat(path, follow_symlinks=False)
    if (details.st_uid, details.st_gid) != (pwd.getpwnam("powadmin").pw_uid, pwd.getpwnam("powadmin").pw_gid):
        raise RuntimeError(f"Unexpected stage ownership; preserve: {path.name}")
    if details.st_mode & 0o7022:
        raise RuntimeError(f"Unsafe stage mode; preserve: {path.name}")
    references = process_references(path)
    size = int(run(["/usr/bin/du", "--summarize", "--bytes", "--one-file-system", "--", str(path)]).split()[0])
    if is_current_rollback:
        assert not references, f"A process still references the preserved rollback: {references[:2]}"
        identity = attest(path)
        assert identity == ROLLBACK_EXPECTED
        records.append({"path": str(path), "name": path.name, "identity": identity,
                        "bytes": size, "currentRollback": True,
                        "matchingArchives": rollback_archives,
                        "processReferences": references,
                        "disposition": "preserve-last-verified-rollback"})
        continue
    if references:
        records.append({"path": str(path), "name": path.name, "identity": None,
                        "bytes": size, "currentRollback": False, "matchingArchives": [],
                        "processReferences": references,
                        "disposition": "preserve-process-reference"})
        continue
    try:
        identity = attest(path)
        matches = matching_archives(identity, provenances)
        if not matches:
            raise RuntimeError("no verified release archive exactly matches this checkout")
    except Exception as error:
        records.append({"path": str(path), "name": path.name, "identity": None,
                        "bytes": size, "currentRollback": False, "matchingArchives": [],
                        "processReferences": [],
                        "disposition": "preserve-unproven",
                        "reason": str(error)})
        continue
    records.append({"path": str(path), "name": path.name, "identity": identity,
                    "bytes": size, "currentRollback": False,
                    "matchingArchives": matches, "processReferences": [],
                    "disposition": "safe-redundant-checkout"})

safe = [item for item in records if item["disposition"] == "safe-redundant-checkout"]
report = {
    "format": "proof-of-work-audit23-node-stage-inventory-v1",
    "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "mode": mode,
    "live": {"path": str(LIVE), "identity": live_identity, "matchingArchives": live_archives},
    "preservedRollback": {"path": str(KEEP), "identity": rollback_identity,
                           "matchingArchives": rollback_archives},
    "archiveHealth": archive_health,
    "stageCount": len(records),
    "safeToRemoveCount": len(safe),
    "safeToRemoveBytes": sum(item["bytes"] for item in safe),
    "preserveUnprovenCount": sum(item["disposition"] == "preserve-unproven" for item in records),
    "preservedBytes": next(item["bytes"] for item in records if item["currentRollback"]),
    "stages": records,
    "actions": [],
}
with REPORT.open("x", encoding="utf-8") as destination:
    os.chmod(REPORT, 0o600)
    json.dump(report, destination, indent=2, sort_keys=True)
    destination.write("\n")
    destination.flush()
    os.fsync(destination.fileno())

if mode == "--apply":
    opt_fd = os.open(OPT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        with PRUNE_LOG.open("x", encoding="utf-8") as log:
            os.chmod(PRUNE_LOG, 0o600)
            for item in safe:
                path = pathlib.Path(item["path"])
                name = path.name
                assert path.parent == OPT and path != LIVE and path != KEEP
                identity_now = attest(path)
                assert identity_now == item["identity"], f"Stage changed after proof: {name}"
                assert matching_archives(identity_now, provenances), f"Verified archive changed: {name}"
                assert not process_references(path), f"A process began using stage: {name}"
                details = os.stat(name, dir_fd=opt_fd, follow_symlinks=False)
                assert stat.S_ISDIR(details.st_mode) and not stat.S_ISLNK(details.st_mode)
                assert (details.st_dev, details.st_ino) == (os.stat(path, follow_symlinks=False).st_dev, os.stat(path, follow_symlinks=False).st_ino)
                shutil.rmtree(name, dir_fd=opt_fd)
                os.fsync(opt_fd)
                event = {"at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                         "removed": name, "bytes": item["bytes"], "identity": identity_now,
                         "matchingArchives": item["matchingArchives"]}
                log.write(json.dumps(event, sort_keys=True) + "\n")
                log.flush()
                os.fsync(log.fileno())
                report["actions"].append(event)
        os.close(opt_fd)
        opt_fd = -1
    finally:
        if opt_fd >= 0:
            os.close(opt_fd)
    post = health_report(9)
    assert post["summary"]["checkouts"] == archive_health["summary"]["checkouts"] - len(report["actions"])
    assert attest(LIVE) == LIVE_EXPECTED and attest(KEEP) == ROLLBACK_EXPECTED
    report["postCleanupReleaseHealth"] = post
    report["checkoutLimitWarningRemains"] = post["summary"]["checkouts"] > 9
    report["removedCount"] = len(report["actions"])
    report["removedBytes"] = sum(item["bytes"] for item in report["actions"])
    with REPORT.open("w", encoding="utf-8") as destination:
        os.chmod(REPORT, 0o600)
        json.dump(report, destination, indent=2, sort_keys=True)
        destination.write("\n")
        destination.flush()
        os.fsync(destination.fileno())

print(json.dumps({"mode": mode, "report": str(REPORT), "stages": len(records),
                  "safeToRemove": len(safe), "safeToRemoveBytes": report["safeToRemoveBytes"],
                  "removed": report.get("removedCount", 0),
                  "preservedRollback": str(KEEP),
                  "archiveHealth": archive_health["summary"],
                  "postCleanupHealth": report.get("postCleanupReleaseHealth", {}).get("summary")}))
