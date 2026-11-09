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


def guards(*, live_only=False):
    for path, expected in GUARDS.items():
        limit = 64 * 1024**2 if path == Path("/var/lib/proofofwork-ui-retention/state.json") else 2 * 1024**2
        require(sha(safe_read(path, limit)[0]) == expected, "Preserved guard changed " + str(path))
    manifests = {}
    for root, rid, expected in (PAIR[:1] if live_only else PAIR):
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


# November 9 publisher-only continuation of the independently recorded e27 installation.
SUCCESSOR_SCHEMA = "pow-ui-publisher-successor-v1"
SUCCESSOR_BASE = "e27ae192edd87d933b91fac592376a2fb6d154ee"
SUCCESSOR_TREE = "bd55a6b7e9a96e6e32a2890d886f9c32274b6255"
SUCCESSOR_AFTER = "96a7445b9d58aea4daf80b5a46e24311604d0e8416cdce02e6ee614360d2c5f4"
SUCCESSOR_STORAGE_SHA = "c59a81df819be42a5b2c5cafcbb9dc578f739f69de22599c56780cfe2fe5cede"
SUCCESSOR_PRIOR_STORE = Path("/var/lib/proofofwork-ui-private-stage-tools")
SUCCESSOR_EVIDENCE = Path("/tmp/pow-ui-e27ae192.WwX0Hp5r")
SUCCESSOR_LIFECYCLE = {
    "config": "71f99aa6f48ac6d0f14f4d1649b5985847fbe7255b3ae02845c6c6742e92d49c",
    "state": "7cf680f91d17a0a7bbcfabf2f8fa0aa3f67f78823d1c551afcc7606752234891",
}
SUCCESSOR_RECEIPTS = {
    "intent.json": ("5867406f4a0402a45f4d5681384a794b95bd996758fff569682a3cb4cb81ffde", 141845, 1984, 1793727920423037966),
    "qualified.json": ("1e52128837cef1961abc10020f2326ccf60e84b41fcad1ad9915b482eff6c486", 141846, 595, 1793728116061751702),
    "installed.json": ("edd06c4f422180b0ff5d2a70df5b5b9a9dceef44db8c00bdf91895f057b9af37", 141849, 662, 1793728579761604465),
    "prepare.json": ("6b99c47efcf23d19b98e957d00f821bee45743f89c578663acbb3b498128018a", 141783, 572, 1793728116068752335),
    "apply.json": ("9b0158e91b5797729c5003bf91003ba9190b657fa1e6d34f40e4af5e1bba9859", 141847, 567, 1793728579767604986),
    "helper-status.json": ("9f676b5e9071aa0ecc74affa4413d025863b73d0c95f47088445bce2dc08a2e2", 141850, 568, 1793728871950176401),
}
SUCCESSOR_DEVICE = 2049
SUCCESSOR_PRIOR_INODE = 132751
SUCCESSOR_EVIDENCE_INODE = 133132
SUCCESSOR_STAGER_CTIME = 1793728407950143263
SUCCESSOR_ADMISSIONS = {
    "archive": (Path("/var/backups/proofofwork-ui/cleanup-evidence/audit30-policy-admission-release-c3969c39c2b2-20261101T051206Z.json"),
                "d28d8784520421497e228c38ab8a06bc5569ce3b45bb778d354ab60613a51c3b", 769213, 1298895, 1793516065022913103),
    "root": (Path("/var/backups/proofofwork-ui/cleanup-evidence/audit30-policy-admission-release-54088ca155bc-20261103T032112Z.json"),
             "910b4232f582eb0ac4c23411d38cbf3b90d3c095d4ad60cb06d4f1cddf08d8f3", 778499, 1444010, 1793685226068150926),
}
SUCCESSOR_FALLBACK = {
    Path("/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-54088ca155bc-20261103T032112Z"):
        "30753986c138b165e7b93bdef6e24ce84d79594f41c280ea5fabfc35859ce514",
    ARCHIVES / ("proofofwork-ui-release-" + CURRENT + ".tgz"):
        "6df3f6fbe4739b27d11b4dc3e96c706f0ece2af82c004e70e79753352e685ce7",
    ARCHIVES / ("proofofwork-ui-release-" + CURRENT + ".tgz.sha256"):
        "cfc09b7c39923e5a470d18b8af912c5c364a643b8cabc76d39105690a8a23b59",
    ARCHIVES / ("proofofwork-ui-release-" + CURRENT + ".tgz.provenance"):
        "249d2a9353aab877e5457e9a996e3e68f8f95cc1702fc82b55099aa8a767346f",
}


def successor_profile(frame):
    global NAMES, BEFORE, BASE_COMMIT, STORE
    require(frame["retentionPins"] == SUCCESSOR_LIFECYCLE, "Unreviewed successor lifecycle")
    private_stage_profile(frame)
    NAMES = (PREFIX + "publish",)
    BEFORE = {NAMES[0]: PRIVATE_AFTER[NAMES[0]]}
    BASE_COMMIT = SUCCESSOR_BASE
    STORE = Path("/var/lib/proofofwork-ui-publisher-successor-tools")


def successor_predecessor(journal, intent=None):
    old = SUCCESSOR_PRIOR_STORE / SUCCESSOR_BASE
    directory(SUCCESSOR_PRIOR_STORE, private=True)
    for path, inode in ((old, SUCCESSOR_PRIOR_INODE), (SUCCESSOR_EVIDENCE, SUCCESSOR_EVIDENCE_INODE)):
        directory(path, private=True)
        details = path.stat()
        require((details.st_dev, details.st_ino) == (SUCCESSOR_DEVICE, inode), "Replaced predecessor evidence directory")
    require(not os.path.lexists(old / "rolled-back.json"), "Predecessor was rolled back")
    receipts = {}
    for name, (digest, ino, size, stamp) in SUCCESSOR_RECEIPTS.items():
        location = old if name in ("intent.json", "qualified.json", "installed.json") else SUCCESSOR_EVIDENCE
        path = location / name
        raw, observed = safe_read(path)
        require(sha(raw) == digest and observed == [SUCCESSOR_DEVICE, ino, 0, 0, stat.S_IFREG | 0o600, 1, size, stamp]
                and path.lstat().st_ctime_ns == stamp, "Replaced original evidence " + name)
        receipts[name] = json.loads(raw)
    original = receipts["intent.json"]
    require(original["schema"] == PRIVATE_SCHEMA and original["commit"] == SUCCESSOR_BASE
            and original["tree"] == SUCCESSOR_TREE and set(original["files"]) == set(PRIVATE_AFTER),
            "Wrong original private-stage intent")
    prepare = receipts["qualified.json"]
    installed = receipts["installed.json"]
    require(prepare["intentSha256"] == installed["intentSha256"] == SUCCESSOR_RECEIPTS["intent.json"][0]
            and installed["qualificationSha256"] == SUCCESSOR_RECEIPTS["qualified.json"][0],
            "Original qualification or installation binding changed")
    check_proof(prepare["archives"], ["verify", "--archive-payload"])
    check_proof(installed["archives"], ["verify-rollback"])
    for file, action, side in (("prepare.json", "prepare", "before"), ("apply.json", "apply", "after"),
                               ("helper-status.json", "status", "after")):
        receipt = receipts[file]
        require(receipt["ok"] is True and receipt["phase"] == action and receipt["commit"] == SUCCESSOR_BASE
                and receipt["journal"] == str(old) and receipt["qualified"] is True
                and receipt["installedReceipt"] is (side == "after") and receipt["rollbackReceipt"] is False
                and receipt["positions"] == {n: side for n in PRIVATE_AFTER}
                and receipt["files"] == {n: original["files"][n][side]["sha256"] for n in PRIVATE_AFTER},
                "Original operator receipt differs: " + file)
    stage, pub = PREFIX + "stage", PREFIX + "publish"
    for name in (stage, pub):
        pair = original["files"][name]
        require(pair["after"]["sha256"] == PRIVATE_AFTER[name] and descriptor(old / name) == pair["before"],
                "Changed retained predecessor helper " + name)
    require(descriptor(BIN / stage) == original["files"][stage]["after"]
            and (BIN / stage).lstat().st_ctime_ns == SUCCESSOR_STAGER_CTIME, "Predecessor stager inode changed")
    publisher = BIN / pub
    if intent is not None and positions(journal, intent)[pub] == "after":
        publisher = journal / pub
    require(descriptor(publisher) == original["files"][pub]["after"], "Predecessor publisher inode changed")
    return {"commit": SUCCESSOR_BASE, "tree": SUCCESSOR_TREE,
            "receipts": {k: row[0] for k, row in SUCCESSOR_RECEIPTS.items()},
            "files": {n: original["files"][n]["after"] for n in PRIVATE_AFTER}, "manifests": original["manifests"]}


def successor_admission_inodes():
    for path, _, ino, size, stamp in SUCCESSOR_ADMISSIONS.values():
        s = path.lstat()
        require((s.st_dev, s.st_ino, s.st_mode, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
                == (SUCCESSOR_DEVICE, ino, stat.S_IFREG | 0o600, 1, size, stamp, stamp),
                "Original fallback admission inode changed: " + str(path))


def successor_admissions():
    admitted = {}
    successor_admission_inodes()
    for kind, (path, digest, _, size, _) in SUCCESSOR_ADMISSIONS.items():
        require(size <= 64 * 1024**2, "Fallback admission exceeds the read bound")
        raw = safe_read(path, size)[0]
        require(sha(raw) == digest, "Original fallback admission hash changed: " + str(path))
        doc = json.loads(raw)
        if kind == "root":
            root, = doc["roots"]
            snapshots = [root["snapshot"]]
        else:
            archive, = doc["archives"]
            snapshots = [archive["snapshot"], *archive["sidecars"]]
        for snapshot in snapshots:
            member = Path(snapshot["path"])
            canonical = json.dumps(snapshot["entries"], sort_keys=True, separators=(",", ":")).encode()
            require(member not in admitted and sha(canonical) == snapshot["sha256"], "Invalid original fallback snapshot")
            admitted[member] = snapshot["sha256"]
    require(admitted == SUCCESSOR_FALLBACK, "Four-object scope differs from original admissions")
    successor_admission_inodes()


class PhysicalFallback(dict):
    def __init__(self, observed, snapshots):
        super().__init__(observed)
        self.entries = []
        for path, snapshot in snapshots.items():
            for row in snapshot["entries"]:
                kind = stat.S_IFDIR if row["kind"] == "directory" else stat.S_IFREG
                expected = (row["device"], row["inode"], kind | row["mode"], row["uid"], row["gid"],
                            row["size"], row["mtimeNs"], row["ctimeNs"], row["links"])
                self.entries.append((path / row["path"], expected))

    def recheck(self):
        successor_admission_inodes()
        for path, expected in self.entries:
            s = path.lstat()
            actual = (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_size,
                      s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)
            require(actual == expected, "Physical fallback entry changed: " + str(path))


def successor_fallback(storage_bytes):
    require(sha(storage_bytes) == SUCCESSOR_STORAGE_SHA, "Unreviewed fallback snapshot verifier")
    successor_admissions()
    source = types.ModuleType("original_ui_storage")
    source.__file__ = "/bound/deploy/audit30/ui-storage.py"
    exec(compile(storage_bytes, source.__file__, "exec"), source.__dict__)
    try:
        snapshots = {path: source.snapshot(path) for path in SUCCESSOR_FALLBACK}
        observed = {str(path): source.guard_snapshot(path, snapshot)["sha256"] for path, snapshot in snapshots.items()}
    finally:
        if source._snapshot_clock is not None:
            source._snapshot_clock.close()
    require(observed == {str(path): h for path, h in SUCCESSOR_FALLBACK.items()},
            "One of the four retained fallback objects changed")
    return PhysicalFallback(observed, snapshots)


def graph_proof(stager_bytes, phase_bytes, *, live_only=False):
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
    for root, rid, _ in (PAIR[:1] if live_only else PAIR):
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
    successor = frame["schema"] == SUCCESSOR_SCHEMA
    keys = {"schema", "commit", "tree", "files"}
    if private or successor:
        keys.update(("retentionPins", "phaseSource"))
    if successor:
        keys.add("storageSource")
    require(set(frame) == keys and (private or successor or frame["schema"] == "pow-ui-stream-tools-v1"), "Wrong source frame")
    if private or successor:
        if successor:
            successor_profile(frame)
            require(sha(base64.b64decode(frame["storageSource"], validate=True)) == SUCCESSOR_STORAGE_SHA,
                    "Changed historical storage verifier")
            require(frame["commit"] != SUCCESSOR_BASE, "Successor must follow the verified predecessor")
        else:
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
        if successor:
            require(sha(raw[name]) == SUCCESSOR_AFTER, "Publisher differs from the reviewed successor")
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


def transition(journal, intent, wanted, before_exchange=None):
    order = NAMES if wanted == "after" else reversed(NAMES)
    for name in order:
        if positions(journal, intent)[name] != wanted:
            if before_exchange:
                before_exchange()
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



def successor_create(path, raw, mode):
    # Link only a complete, durable inode. A crash while writing leaves no pathname.
    directory(path.parent, private=True)
    parent = os.open(path.parent, os.O_DIRECTORY | os.O_NOFOLLOW | os.O_RDONLY)
    try:
        fd = os.open(".", os.O_TMPFILE | os.O_RDWR, mode, dir_fd=parent)
        with os.fdopen(fd, "wb") as out:
            os.fchmod(fd, mode)
            out.write(raw)
            out.flush()
            os.fsync(fd)
            os.link("/proc/self/fd/" + str(fd), path.name, dst_dir_fd=parent, follow_symlinks=True)
            os.fsync(parent)
    finally:
        os.close(parent)


def successor_record(path, value):
    successor_create(path, (json.dumps(value, sort_keys=True) + "\n").encode(), 0o600)


def successor_locked(phase, frame, lock_fd, raw):
    publisher, = NAMES
    directory(BIN)
    directory(ARCHIVES)
    journal = STORE / frame["commit"]
    intent_path = journal / "intent.json"
    qualified = journal / "qualified.json"
    completed = journal / "installed.json"
    reversing = journal / "rollback-intent.json"
    reversed_path = journal / "rolled-back.json"
    storage = base64.b64decode(frame["storageSource"], validate=True)
    phase_source = base64.b64decode(frame["phaseSource"], validate=True)
    intent = None
    retained = None

    def final_check():
        successor_predecessor(journal, intent)
        retained.recheck()

    def fence():
        nonlocal retained
        predecessor = successor_predecessor(journal, intent)
        manifest = guards()
        manifest["lifecyclePins"] = frame["retentionPins"]
        manifest["graphProof"] = graph_proof(safe_read(BIN / (PREFIX + "stage"))[0], phase_source)
        require(manifest == predecessor["manifests"], "Protected release context differs from original evidence")
        retained = successor_fallback(storage)
        require(successor_predecessor(journal, intent) == predecessor and guards() ==
                {k: v for k, v in manifest.items() if k not in ("lifecyclePins", "graphProof")},
                "Publisher or protected context changed during checks")
        retained.recheck()
        return {"predecessor": predecessor, "retained": dict(retained)}

    if os.path.lexists(STORE):
        directory(STORE, private=True)
    if os.path.lexists(journal):
        directory(journal, private=True)
        allowed = {publisher, intent_path.name, qualified.name, completed.name, reversing.name, reversed_path.name}
        require(set(os.listdir(journal)) <= allowed, "Unknown successor journal entry")
        if os.path.lexists(intent_path):
            intent = read_record(intent_path)
    # An interrupted helper exchange can always restore its exact predecessor.
    # Qualification and positions are verified below before this path can write.
    restoring = (phase == "rollback" and intent is not None and os.path.lexists(qualified)
                 and (os.path.lexists(reversing) or positions(journal, intent)[publisher] == "after"))
    if restoring:
        baseline = {"predecessor": successor_predecessor(journal, intent),
                    "retained": {str(path): digest for path, digest in SUCCESSOR_FALLBACK.items()}}
    else:
        baseline = fence()
    if intent is None and phase == "status":
        require(not any(os.path.lexists(p) for p in (qualified, completed, reversing, reversed_path)),
                "Receipts without an intent")
        if os.path.lexists(journal / publisher):
            candidate = descriptor(journal / publisher)
            require(candidate["sha256"] == SUCCESSOR_AFTER and stat.S_IMODE(candidate["identity"][4]) == 0o755
                    and candidate["xattrs"] == baseline["predecessor"]["files"][publisher]["xattrs"],
                    "Unrecognized interrupted preparation")
        final_check()
        return {"ok": True, "phase": phase, "journal": str(journal), "commit": frame["commit"],
                "prepared": False, "interruptedPreparation": os.path.lexists(journal)}
    if intent is None:
        require(phase == "prepare", "Prepare the reviewed publisher before changing it")
        capacity = BIN / "proofofwork-ui-capacity"
        subprocess.run(["/usr/bin/python3", "-I", "-B", str(capacity), "check", "--path", str(STORE.parent),
                        "--additional-bytes", "1048576", "--additional-inodes", "16",
                        "--phase", "ui-publisher-successor"], env=ENV, check=True, timeout=120, stdout=subprocess.DEVNULL)
        root_dir(STORE)
        require(BIN.stat().st_dev == STORE.stat().st_dev, "Journal must share the helper filesystem")
        root_dir(journal)
        require(set(os.listdir(journal)) <= {publisher}, "Unknown partial preparation")
        before = baseline["predecessor"]["files"][publisher]
        if not os.path.lexists(journal / publisher):
            successor_create(journal / publisher, raw[publisher], 0o755)
        after = descriptor(journal / publisher)
        require(after["sha256"] == SUCCESSOR_AFTER and stat.S_IMODE(after["identity"][4]) == 0o755
                and after["xattrs"] == before["xattrs"], "Partial candidate differs from reviewed helper")
        intent = {"schema": frame["schema"], "commit": frame["commit"], "tree": frame["tree"], "baseline": baseline,
                  "files": {publisher: {"before": before, "after": after}}}
        successor_record(intent_path, intent)
    require(intent["schema"] == frame["schema"] and intent["commit"] == frame["commit"]
            and intent["tree"] == frame["tree"] and intent["baseline"] == baseline
            and set(intent["files"]) == {publisher} and intent["files"][publisher]["before"] == baseline["predecessor"]["files"][publisher]
            and intent["files"][publisher]["after"]["sha256"] == SUCCESSOR_AFTER, "Successor journal binding changed")
    state = positions(journal, intent)[publisher]
    provenance = BIN / (PREFIX + "provenance")
    intent_id = descriptor(intent_path)
    qualification = None
    if os.path.lexists(qualified):
        qualification = read_record(qualified)
        require(qualification["intent"] == intent_id, "Unbound successor qualification")
        check_proof(qualification["archives"], ["verify", "--archive-payload"])
    elif phase == "prepare":
        require(state == "before", "Unqualified publisher was exchanged")
        archives = verify_pair(provenance, lock_fd, payload=True)
        check_proof(archives, ["verify", "--archive-payload"])
        require(fence() == baseline and positions(journal, intent)[publisher] == "before",
                "Qualification context changed")
        qualification = {"intent": intent_id, "archives": archives}
        final_check()
        successor_record(qualified, qualification)
    require(qualification is not None or phase == "status", "Missing successor qualification")
    if qualification is None:
        require(state == "before" and not any(os.path.lexists(p) for p in (completed, reversing, reversed_path)),
                "Activity before qualification")
    qual_id = descriptor(qualified) if qualification is not None else None
    if os.path.lexists(completed):
        installed = read_record(completed)
        require(installed["intent"] == intent_id and installed["qualification"] == qual_id, "Unbound installed receipt")
        check_proof(installed["archives"], ["verify-rollback"])
        require(state == "after" or os.path.lexists(reversing), "Installed publisher unexpectedly reverted")
    reversal = {"intent": intent_id, "qualification": qual_id}
    if os.path.lexists(reversing):
        require(read_record(reversing) == reversal, "Changed rollback intent")
    if phase == "status" and os.path.lexists(reversing) and not os.path.lexists(reversed_path):
        raise ValueError("Rollback is pending; finish the retained fallback verification")
    if os.path.lexists(reversed_path):
        require(state == "before" and os.path.lexists(reversing)
                and read_record(reversed_path) == {"rollbackIntent": descriptor(reversing)}, "Changed rollback receipt")

    def restore_authority():
        # Only the four original fallback objects can fail during restoration.
        # A newer lifecycle or live release cannot authorize this older installer.
        original = successor_predecessor(journal, intent)
        successor_admissions()
        rid = PAIR[0][1]
        live = {rid: original["manifests"][rid]}
        require(guards(live_only=True) == live, "Stale lifecycle or live release for publisher restoration")
        graph = graph_proof(safe_read(BIN / (PREFIX + "stage"))[0], phase_source, live_only=True)
        require(graph == {rid: original["manifests"]["graphProof"][rid]}
                and guards(live_only=True) == live and successor_predecessor(journal, intent) == original,
                "Live release authority changed during publisher restoration")
        successor_admission_inodes()

    def restore():
        restore_authority()
        if not os.path.lexists(reversing):
            successor_record(reversing, reversal)
        # Fallback drift blocks publication and every terminal receipt. Only a
        # reverse exchange may restore the original admitted publisher through drift.
        transition(journal, intent, "before", restore_authority)
        require(fence() == baseline and positions(journal, intent)[publisher] == "before", "Restored context changed")
        if not os.path.lexists(reversed_path):
            rollback_id = descriptor(reversing)
            final_check()
            successor_record(reversed_path, {"rollbackIntent": rollback_id})

    if phase == "apply":
        require(not os.path.lexists(reversing), "A rolled-back publisher needs new review")
        if not os.path.lexists(completed):
            require(fence() == baseline, "Context changed immediately before publisher exchange")
            try:
                transition(journal, intent, "after", final_check)
                archives = verify_pair(provenance, lock_fd)
                check_proof(archives, ["verify-rollback"])
                require(fence() == baseline and positions(journal, intent)[publisher] == "after", "Installed context changed")
                final_check()
                successor_record(completed, {"intent": intent_id, "qualification": qual_id, "archives": archives})
            except BaseException:
                if positions(journal, intent)[publisher] == "after":
                    restore()
                raise
    elif phase == "rollback":
        if not restoring:
            require(fence() == baseline, "Context changed immediately before rollback")
        restore()
    state = positions(journal, intent)
    files = {publisher: descriptor(BIN / publisher)["sha256"]}
    final_check()
    return {"ok": True, "phase": phase, "commit": frame["commit"], "journal": str(journal),
            "qualified": qualification is not None, "installedReceipt": os.path.lexists(completed),
            "rollbackReceipt": os.path.lexists(reversed_path), "positions": state, "files": files}


def run_locked(phase, frame, lock_fd):
    raw = checked_frame(frame)
    if frame["schema"] == SUCCESSOR_SCHEMA:
        return successor_locked(phase, frame, lock_fd, raw)
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
    profiles = parser.add_mutually_exclusive_group()
    profiles.add_argument("--private-stage", action="store_true")
    profiles.add_argument("--publisher-successor", action="store_true")
    parser.add_argument("--state-sha256")
    parser.add_argument("--config-sha256")
    args = parser.parse_args()
    require(re.fullmatch(r"[0-9a-f]{40}", args.commit), "Full Git commit required")
    repo = Path(__file__).resolve().parents[2]
    git = ["/usr/bin/git", "-C", str(repo)]
    options = {}
    if args.private_stage or args.publisher_successor:
        require(os.geteuid() == 0 and sys.flags.isolated, "Private staging runs only from the release checkout on the UI host")
        require(subprocess.check_output([*git, "rev-parse", "HEAD"], text=True).strip() == args.commit,
                "Private-stage checkout must be at the exact approved release")
        require(args.state_sha256 and args.config_sha256, "Both lifecycle hashes are required")
        options["retentionPins"] = {"state": args.state_sha256, "config": args.config_sha256}
        if args.publisher_successor:
            successor_profile(options)
            storage = subprocess.check_output([*git, "show", SUCCESSOR_BASE + ":deploy/audit30/ui-storage.py"])
            options["storageSource"] = base64.b64encode(storage).decode()
        else:
            private_stage_profile(options)
        phase = subprocess.check_output([*git, "show", args.commit + ":deploy/publish/phase_capacity.py"])
        options["phaseSource"] = base64.b64encode(phase).decode()
    else:
        require(not args.state_sha256 and not args.config_sha256, "Unexpected lifecycle pins")
    subprocess.run([*git, "merge-base", "--is-ancestor", BASE_COMMIT, args.commit], check=True)
    self_raw = subprocess.check_output([*git, "show", args.commit + ":deploy/ui-stream-tools/installer.py"])
    require(self_raw == Path(__file__).read_bytes(), "Installer differs from reviewed commit")
    schema = SUCCESSOR_SCHEMA if args.publisher_successor else PRIVATE_SCHEMA if args.private_stage else "pow-ui-stream-tools-v1"
    frame = {**options, "schema": schema, "commit": args.commit,
             "tree": subprocess.check_output([*git, "rev-parse", args.commit + "^{tree}"], text=True).strip(), "files": {}}
    for n in NAMES:
        suffix = ".py" if n == PREFIX + "stage" else ".sh"
        data = subprocess.check_output([*git, "show", args.commit + ":deploy/" + n + suffix])
        frame["files"][n] = {"base64": base64.b64encode(data).decode(), "sha256": sha(data)}
    checked_frame(frame)
    if args.private_stage or args.publisher_successor:
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
