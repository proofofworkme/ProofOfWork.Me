#!/usr/bin/python3 -I
"""Promote or restore the two committed streaming UI release tools under the deploy lock."""
import argparse
import base64
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import types
import sys

PREFIX = "proofofwork-ui-release-"
NAMES = (PREFIX + "provenance", PREFIX + "publish")
BEFORE = dict(zip(NAMES, (
    "822fb461c8a1d6d3174f47e448d8bd2c0ce548134358da409c97e46fde163215",
    "ce48b043182688839589b358ee96f88dc36ab7fed35e34a723765953d49a6536",
)))
BASE_COMMIT = "17f22bde4f94d9972974006e1603c28d1b20d2b9"
BIN = Path("/usr/local/sbin")
STORE = Path("/var/lib/proofofwork-ui-stream-tools")
LOCK = Path("/run/proofofwork-ui/deploy.lock")
ARCHIVES = Path("/var/backups/proofofwork-ui/releases")
CURRENT = "c3969c39c2b2-20261101T051206Z"
PREVIOUS = "dfa9a06dd45c-20261101T040107Z"
PAIR = ((Path("/var/www"), CURRENT, "2f2cafae1ca7a8ffa5458e7c87901eab4ce73b6fc29ea0f8879dc3fb32a16867"),
        (Path("/var/backups/proofofwork-ui/rollback-roots") / ("proofofwork-www-pre-" + CURRENT),
         PREVIOUS, "3f8730cb223b0c76c0e1bc6f6a98bbd4ef9ed482475b54788edf2583e1d81d09"))
GUARDS = {
    Path("/etc/proofofwork-retention/audit28.hold"): "e9aca6e22b1dc36b714ed663051f8bc20d9479efa4173474e0b6b771958ca6a4",
    Path("/etc/proofofwork-retention/audit28-held-review.json"): "c3bd35740d7fcc135839274c8228e38f7a45c23e33567743e0d77151b32451d9",
    Path("/var/lib/proofofwork-ui-retention/state.json"): "39ac234234cdc1b5446a2ad37f4e525be83788882f4d49125b2006690fe3bc23",
    BIN / "proofofwork-ui-capacity": "24fdd19ceb05f3c89ec45f871fe3daa93a061195132a15a3683ab3540fbe02d2",
    BIN / "proofofwork-ui-release-stage": "433ebd3f166f5e0f4ecab3f5ce8bff29a66db376fd5ded721421b48ef948eabf",
}
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C", "GIT_OPTIONAL_LOCKS": "0"}
SHA = re.compile(r"[0-9a-f]{64}\Z")
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def require(valid, message):
    if not valid:
        raise ValueError(message)


def identity(s):
    # renameat2 exchanges update ctime. File contents, ownership, mode and
    # original inode are still exact on either side of an exchange.
    return [s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode, s.st_nlink, s.st_size, s.st_mtime_ns]


def safe_read(path, limit=2*1024**2):
    require(path.is_absolute() and path.resolve(strict=True) == path, "Noncanonical input " + str(path))
    s = path.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid == s.st_gid == 0 and not s.st_mode & 0o7022
            and s.st_nlink == 1 and s.st_size <= limit, "Unsafe or oversized input " + str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOATIME | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        raw = stream.read(limit + 1)
        require(identity(s) == identity(os.fstat(stream.fileno())) == identity(path.lstat())
                and path.lstat().st_ctime_ns == s.st_ctime_ns and len(raw) == s.st_size,
                "Input changed during read " + str(path))
    return raw, identity(s)


def descriptor(path):
    raw, ident = safe_read(path)
    xattrs = {key: sha(os.getxattr(path, key, follow_symlinks=False))
              for key in os.listxattr(path, follow_symlinks=False)}
    return {"sha256": sha(raw), "identity": ident, "xattrs": xattrs}


def directory(path, private=False):
    s = path.lstat()
    require(path.resolve(strict=True) == path and stat.S_ISDIR(s.st_mode) and s.st_uid == s.st_gid == 0
            and not s.st_mode & 0o7022 and (not private or stat.S_IMODE(s.st_mode) == 0o700),
            "Unsafe directory " + str(path))


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def root_dir(path):
    directory(path.parent)
    if not os.path.lexists(path):
        path.mkdir(mode=0o700)
        sync_dir(path.parent)
    directory(path, private=True)


def create(path, raw, mode=0o600):
    with os.fdopen(os.open(path, os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_WRONLY, mode), "wb") as f:
        os.fchmod(f.fileno(), mode)
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())
    sync_dir(path.parent)


def record(path, value):
    create(path, (json.dumps(value, sort_keys=True) + "\n").encode())


def read_record(path):
    return json.loads(safe_read(path)[0])


def guards():
    for path, expected in GUARDS.items():
        limit = 64 * 1024**2 if path == Path("/var/lib/proofofwork-ui-retention/state.json") else 2 * 1024**2
        require(sha(safe_read(path, limit)[0]) == expected, "Preserved guard changed " + str(path))
    manifests = {}
    for root, rid, expected in PAIR:
        directory(root)
        manifest, ident = safe_read(root / ".proofofwork-ui-release")
        values = dict(line.split("=", 1) for line in manifest.decode().splitlines())
        require(values["release_id"] == rid and values["archive_sha256"] == expected
                and values["archive_name"] == "proofofwork-ui-release-" + rid + ".tgz", "Wrong protected release")
        manifests[rid] = {"sha256": sha(manifest), "identity": ident}
    return manifests


PRIVATE_SCHEMA = "pow-ui-private-stage-tools-v1"
PRIVATE_AFTER = {
    PREFIX + "stage": "0874f8689fbcd062c44a54745a049cfc44f71a54f6404fdcc65f10e80f1994ee",
    PREFIX + "publish": "da943404eaf57911e15f9c7595e1c9d0474d04edf6e6434371827557fb89a0bd",
}
PHASE_SHA = "69544e6ac32f658d342759928794e4857c2826a7b850dabdaf38b8d0ad986b85"

def private_stage_profile(frame):
    """Select the November 3 pair once, in the isolated process for this command."""
    global NAMES, BEFORE, BASE_COMMIT, STORE, PAIR, GUARDS
    require(set(frame["retentionPins"]) == {"config", "state"}
            and all(SHA.fullmatch(value) for value in frame["retentionPins"].values()),
            "Explicit lifecycle config and state pins are required")
    NAMES = tuple(PRIVATE_AFTER)
    BEFORE = {NAMES[0]: "433ebd3f166f5e0f4ecab3f5ce8bff29a66db376fd5ded721421b48ef948eabf",
              NAMES[1]: "5170812052f7ac61869a56e4e03cad7a4049604ab343e61c72961f9b6dde3818"}
    BASE_COMMIT = "6b5c5d62e640f06a289b387851bae9f0c44de6ae"
    STORE = Path("/var/lib/proofofwork-ui-private-stage-tools")
    current = "54088ca155bc-20261103T032112Z"
    prior = "c3969c39c2b2-20261101T051206Z"
    PAIR = ((Path("/var/www"), current, "68c547a8715b0bee00232549ec15a2461a60757a40b998b7d6a98465a14ffd93"),
            (Path("/var/backups/proofofwork-ui/rollback-roots") / ("proofofwork-www-pre-" + current),
             prior, "2f2cafae1ca7a8ffa5458e7c87901eab4ce73b6fc29ea0f8879dc3fb32a16867"))
    GUARDS = {**GUARDS, BIN / (PREFIX + "provenance"):
              "82a8aa6c05b2efe6191db6c46c3eef6956d2f923b5b7154c2e1f2c202044091d",
              BIN / "proofofwork-ui-retained-root":
              "6421d58ec8a2259cc21512679db05654b2a138a6e6f56d3656c0287b934ddd9e",
              Path("/etc/proofofwork-retention/ui-lifecycle.json"): frame["retentionPins"]["config"],
              Path("/var/lib/proofofwork-ui-retention/state.json"): frame["retentionPins"]["state"]}
    GUARDS.pop(BIN / (PREFIX + "stage"), None)

def graph_proof(stager_bytes, phase_bytes):
    """Use the exact candidate's parser and planner against both served trees without altering access times."""
    require(sha(stager_bytes) == PRIVATE_AFTER[PREFIX + "stage"] and sha(phase_bytes) == PHASE_SHA,
            "Unapproved closure code")
    stager = types.ModuleType("candidate_stager")
    phase = types.ModuleType("candidate_phase")
    for module, data in ((stager, stager_bytes), (phase, phase_bytes)):
        exec(compile(data, module.__name__, "exec"), module.__dict__)
    def open_readonly(path, flags, *args):
        require(not flags & (os.O_ACCMODE | os.O_CREAT | os.O_TRUNC), "Closure must remain read-only")
        return os.open(path, flags | os.O_NOATIME, *args)
    readonly = types.SimpleNamespace(**{**vars(os), "open": open_readonly})
    stager.os = phase.os = readonly
    result = {}
    for root, rid, _ in PAIR:
        surfaces = stager.live_surface_names(root)
        require(surfaces == stager.PERMISSION_SURFACES, "Wrong prior surface family")
        _, _, counts, digest = phase.prior_compatibility(root, surfaces, stager, {s: [] for s in surfaces})
        require(SHA.fullmatch(digest) and counts["dependencies"] > 0, "Empty prior graph")
        result[rid] = {"counts": counts, "referencesSha256": digest}
    require(result[PAIR[0][1]]["counts"] == {"dependencies": 1650, "reference_edges": 6182,
            "reference_candidates": 1417130, "total_bytes": 93483071}, "Changed live prior-asset closure")
    return result

def checked_frame(frame):
    private = frame["schema"] == PRIVATE_SCHEMA
    keys = {"schema", "commit", "tree", "files"}
    require(set(frame) == (keys | {"retentionPins", "phaseSource"} if private else keys)
            and (private or frame["schema"] == "pow-ui-stream-tools-v1"), "Wrong source frame")
    if private:
        private_stage_profile(frame)
        require(sha(base64.b64decode(frame["phaseSource"], validate=True)) == PHASE_SHA, "Unapproved phase source")
    for key in ("commit", "tree"):
        require(isinstance(frame[key], str) and re.fullmatch(r"[0-9a-f]{40}", frame[key]), "Invalid Git pin")
    require(set(frame["files"]) == set(NAMES), "Expanded tool scope")
    raw = {}
    for name in NAMES:
        row = frame["files"][name]
        require(set(row) == {"base64", "sha256"} and SHA.fullmatch(row["sha256"]), "Invalid helper descriptor")
        raw[name] = base64.b64decode(row["base64"], validate=True)
        require(0 < len(raw[name]) <= 512*1024 and sha(raw[name]) == row["sha256"] != BEFORE[name],
                "Candidate helper mismatch")
        if private:
            require(sha(raw[name]) == PRIVATE_AFTER[name], "Candidate differs from reviewed private-stage source")
        if private and name == PREFIX + "stage":
            compile(raw[name], name, "exec")
        else:
            require(b"pow-ui-stream-archive-verification-v1" in raw[name], "Missing streaming verifier capability")
            subprocess.run(["/usr/bin/bash", "-n"], input=raw[name], env=ENV, check=True, timeout=10)
    return raw


def exchange(left, right):
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.renameat2(-100, os.fsencode(left), -100, os.fsencode(right), 2):
        raise OSError(ctypes.get_errno(), "Atomic helper inode exchange failed")
    sync_dir(left.parent)
    sync_dir(right.parent)


def positions(journal, intent):
    result = {}
    for name in NAMES:
        live, retained = descriptor(BIN / name), descriptor(journal / name)
        pair = intent["files"][name]
        if live == pair["before"] and retained == pair["after"]:
            result[name] = "before"
        elif live == pair["after"] and retained == pair["before"]:
            result[name] = "after"
        else:
            raise ValueError("Unrecognized helper bytes/inode " + name)
    return result


def transition(journal, intent, wanted):
    order = NAMES if wanted == "after" else reversed(NAMES)
    for name in order:
        if positions(journal, intent)[name] != wanted:
            exchange(BIN / name, journal / name)
            require(positions(journal, intent)[name] == wanted, "Exchange did not retain exact inodes")


def verify_pair(path, lock_fd, *, payload=False):
    proofs = {}
    for root, rid, archive_sha in PAIR:
        env = {**ENV, "POW_UI_DEPLOY_LOCK_FD": str(lock_fd), "POW_UI_WWW_ROOT": str(root)}
        if root != PAIR[0][0]:
            env["POW_UI_RETAINED_ROOT"] = "1"
        command = ["verify", "--archive-payload"] if payload else ["verify-rollback"]
        p = subprocess.run(["/usr/bin/bash", str(path), *command], env=env, pass_fds=(lock_fd,),
                           stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=900)
        require(p.returncode == 0 and archive_sha.encode() in p.stdout and rid.encode() in p.stdout,
                " ".join(command) + " refused " + rid + ": " + p.stderr[-600:].decode(errors="replace"))
        proofs[rid] = {"command": command, "archiveSha256": archive_sha, "outputSha256": sha(p.stdout)}
    return proofs


def check_proof(proofs, command):
    require(isinstance(proofs, dict) and set(proofs) == {rid for _, rid, _ in PAIR}, "Missing release proof")
    for _, rid, digest in PAIR:
        p = proofs[rid]
        require(set(p) == {"command", "archiveSha256", "outputSha256"}
                and p["command"] == command and p["archiveSha256"] == digest and SHA.fullmatch(p["outputSha256"]),
                "Incomplete or changed release proof")


def run_locked(phase, frame, lock_fd):
    raw = checked_frame(frame)
    manifest_fence = guards()
    private = frame["schema"] == PRIVATE_SCHEMA
    if private:
        manifest_fence["lifecyclePins"] = frame["retentionPins"]
        manifest_fence["graphProof"] = graph_proof(raw[PREFIX + "stage"], base64.b64decode(frame["phaseSource"], validate=True))
    def unchanged():
        return guards() == {k: v for k, v in manifest_fence.items() if k not in ("lifecyclePins", "graphProof")}
    directory(BIN); directory(ARCHIVES)
    if phase == "prepare":
        root_dir(STORE)
    else:
        directory(STORE, private=True)
    require(BIN.stat().st_dev == STORE.stat().st_dev, "Journal must share the filesystem for exact rollback")
    journal = STORE / frame["commit"]
    intent_path = journal / "intent.json"
    if phase == "prepare" and not os.path.lexists(journal):
        baseline = {n: descriptor(BIN / n) for n in NAMES}
        require(all(v["sha256"] == BEFORE[n] and stat.S_IMODE(v["identity"][4]) == 0o755 for n, v in baseline.items()),
                "Installed tools differ from accepted Git baseline")
        capacity = BIN / "proofofwork-ui-capacity"
        subprocess.run(["/usr/bin/python3", "-I", "-B", str(capacity), "check", "--path", str(STORE),
                        "--additional-bytes", "1048576", "--additional-inodes", "16", "--phase", "ui-stream-tools"],
                       env=ENV, check=True, timeout=120, stdout=subprocess.DEVNULL)
        root_dir(journal)
        for name in NAMES:
            create(journal / name, raw[name], 0o755)
            require(descriptor(journal / name)["xattrs"] == baseline[name]["xattrs"],
                    "Staged helper security attributes differ from installed source")
        record(intent_path, {"schema": frame["schema"], "commit": frame["commit"], "tree": frame["tree"],
                             "manifests": manifest_fence, "files": {
                                 n: {"before": baseline[n], "after": descriptor(journal / n)} for n in NAMES}})
    directory(journal, private=True)
    intent = read_record(intent_path)
    require(intent["schema"] == frame["schema"] and intent["commit"] == frame["commit"]
            and intent["tree"] == frame["tree"] and intent["manifests"] == manifest_fence
            and set(intent["files"]) == set(NAMES) and all(intent["files"][n]["before"]["sha256"] == BEFORE[n]
            and intent["files"][n]["after"]["sha256"] == frame["files"][n]["sha256"] for n in NAMES),
            "Release context or staged files changed")
    state = positions(journal, intent)
    prepared, completed, rolled_back = [journal / f for f in ("qualified.json", "installed.json", "rolled-back.json")]
    if phase == "prepare" and not prepared.exists():
        require(all(v == "before" for v in state.values()), "Partial promotion before qualification")
        proof = verify_pair(BIN / (PREFIX + "provenance") if private else journal / NAMES[0], lock_fd, payload=True)
        check_proof(proof, ["verify", "--archive-payload"])
        require(unchanged() and positions(journal, intent) == state, "Qualification context changed")
        record(prepared, {"intentSha256": descriptor(intent_path)["sha256"], "archives": proof})
    elif phase in ("apply", "rollback"):
        qualification = read_record(prepared)
        require(qualification["intentSha256"] == descriptor(intent_path)["sha256"], "Unqualified helpers")
        check_proof(qualification["archives"], ["verify", "--archive-payload"])
        if phase == "apply":
            require(not rolled_back.exists(), "A rolled-back release needs new review")
            try:
                transition(journal, intent, "after")
                if not completed.exists():
                    proof = verify_pair(BIN / (PREFIX + "provenance") if private else BIN / NAMES[0], lock_fd)
                    check_proof(proof, ["verify-rollback"])
                    require(unchanged(), "Preserved context changed during installation")
                    record(completed, {"intentSha256": descriptor(intent_path)["sha256"], "archives": proof,
                                       "qualificationSha256": descriptor(prepared)["sha256"]})
                else:
                    prior = read_record(completed)
                    require(prior["intentSha256"] == descriptor(intent_path)["sha256"]
                            and prior["qualificationSha256"] == descriptor(prepared)["sha256"], "Changed installed receipt")
                    check_proof(prior["archives"], ["verify-rollback"])
            except BaseException:
                transition(journal, intent, "before")
                if not rolled_back.exists():
                    record(rolled_back, {"intentSha256": descriptor(intent_path)["sha256"], "reason": "apply-failed"})
                raise
        else:
            transition(journal, intent, "before")
            if not rolled_back.exists():
                record(rolled_back, {"intentSha256": descriptor(intent_path)["sha256"], "reason": "explicit-rollback"})
    return {"ok": True, "phase": phase, "journal": str(journal), "commit": frame["commit"],
            "qualified": prepared.exists(), "installedReceipt": completed.exists(), "rollbackReceipt": rolled_back.exists(),
            "positions": positions(journal, intent), "files": {n: descriptor(BIN / n)["sha256"] for n in NAMES}}


def remote(phase, frame):
    require(os.geteuid() == 0 and sys.flags.isolated, "Use isolated root Python on the UI host")
    require(phase in ("prepare", "apply", "rollback", "status"), "Unknown install phase")
    os.umask(0o077)
    directory(LOCK.parent, private=True)
    fd = os.open(LOCK, os.O_NOATIME | os.O_NOFOLLOW | os.O_RDONLY | os.O_NONBLOCK)
    try:
        s = os.fstat(fd)
        require(stat.S_ISREG(s.st_mode) and s.st_uid == s.st_gid == 0 and stat.S_IMODE(s.st_mode) == 0o600
                and s.st_nlink == 1 and s.st_size == 0 and identity(s) == identity(LOCK.lstat()), "Unsafe deployment lock")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = run_locked(phase, frame, fd)
        require(identity(os.fstat(fd)) == identity(LOCK.lstat()) == identity(s), "Deployment lock changed")
        return result
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "apply", "rollback", "status"))
    parser.add_argument("commit")
    parser.add_argument("--private-stage", action="store_true")
    parser.add_argument("--state-sha256")
    parser.add_argument("--config-sha256")
    args = parser.parse_args()
    require(re.fullmatch(r"[0-9a-f]{40}", args.commit), "Full Git commit required")
    repo = Path(__file__).resolve().parents[2]
    git = ["/usr/bin/git", "-C", str(repo)]
    options = {}
    if args.private_stage:
        require(os.geteuid() == 0 and sys.flags.isolated, "Private staging runs only from the release checkout on the UI host")
        require(subprocess.check_output([*git, "rev-parse", "HEAD"], text=True).strip() == args.commit,
                "Private-stage checkout must be at the exact approved release")
        require(args.state_sha256 and args.config_sha256, "Both lifecycle hashes are required")
        options["retentionPins"] = {"state": args.state_sha256, "config": args.config_sha256}
        private_stage_profile(options)
        phase = subprocess.check_output([*git, "show", args.commit + ":deploy/publish/phase_capacity.py"])
        options["phaseSource"] = base64.b64encode(phase).decode()
    else:
        require(not args.state_sha256 and not args.config_sha256, "Unexpected lifecycle pins")
    subprocess.run([*git, "merge-base", "--is-ancestor", BASE_COMMIT, args.commit], check=True)
    self_raw = subprocess.check_output([*git, "show", args.commit + ":deploy/ui-stream-tools/installer.py"])
    require(self_raw == Path(__file__).read_bytes(), "Installer differs from reviewed commit")
    frame = {**options, "schema": PRIVATE_SCHEMA if args.private_stage else "pow-ui-stream-tools-v1", "commit": args.commit,
             "tree": subprocess.check_output([*git, "rev-parse", args.commit + "^{tree}"], text=True).strip(), "files": {}}
    for n in NAMES:
        suffix = ".py" if n == PREFIX + "stage" else ".sh"
        data = subprocess.check_output([*git, "show", args.commit + ":deploy/" + n + suffix])
        frame["files"][n] = {"base64": base64.b64encode(data).decode(), "sha256": sha(data)}
    checked_frame(frame)
    if args.private_stage:
        print(json.dumps(remote(args.action, frame)), flush=True)
        return
    # The remote command is fixed. The exact committed installer and two source
    # helpers travel on stdin, avoiding argv size limits and shell evaluation.
    boot = "import sys,json,base64,hashlib;s=json.load(sys.stdin);b=base64.b64decode(s['code'],validate=True);assert hashlib.sha256(b).hexdigest()=='" + sha(self_raw) + "';n={'__name__':'_reviewed'};exec(compile(b,'installer.py','exec'),n);print(json.dumps(n['remote'](s['phase'],s['frame'])),flush=True)"
    import shlex
    command = shlex.join(["/usr/bin/systemd-run", "--quiet", "--wait", "--pipe", "--collect",
                          "--property=CPUQuota=125%", "--property=MemoryMax=768M", "--property=IOWeight=30",
                          "--property=Nice=8", "/usr/bin/python3", "-I", "-B", "-c", boot])
    payload = {"code": base64.b64encode(self_raw).decode(), "phase": args.action, "frame": frame}
    subprocess.run(["ssh", "-i", str(Path.home() / ".ssh/proofofwork_me_ed25519"), "-o", "BatchMode=yes",
                    "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "root@77.42.91.106", command],
                   input=json.dumps(payload).encode(), check=True)


if __name__ == "__main__":
    main()
