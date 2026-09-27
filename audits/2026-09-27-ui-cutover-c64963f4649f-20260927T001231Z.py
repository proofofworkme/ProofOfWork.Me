#!/usr/bin/env python3
"""Pinned, rollback-checked publisher for the merged Audit 26 UI release."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

RELEASE = "c64963f4649f-20260927T001231Z"
COMMIT = "c64963f4649f021c3d91bf71ad1a3dcde37e6d2b"
TREE = "d5c2562fe3e0ccf88efba81f990c38bb14238e8e"
ARCHIVE_SHA256 = "e1b31e40724e7155a98115ffeab90d940ae67d9adc9f42395f9b1ae86ffbb40d"
PRIOR_COMMIT = "5970b26e610ba13412f8a4e68065f89e3f599fa3"
PRIOR_TREE = "e613a990501a59c856be4e9709252a64c04e2738"
PRIOR_ROOT = "proofofwork-www-pre-5970b26e610b-20260926T225712Z"
PRIOR_MANIFEST_SHA256 = "68efa009d0495c0a58da064035d12170d41a686984ca7081d8397706e22a8075"
PRIOR_ROOT_SHA256 = "b641ec763bffd2dbebba516c55a4227159639fc0609de87a392273451d188d88"
DEPLOY = Path("/var/tmp/proofofwork-deploy")
SOURCE = DEPLOY / f"proofofwork-ui-source-{RELEASE}"
ARCHIVE = Path("/var/backups/proofofwork-ui/releases") / f"proofofwork-ui-release-{RELEASE}.tgz"
ROLLBACKS = Path("/var/backups/proofofwork-ui/rollback-roots")
LOCK = Path("/run/proofofwork-ui/deploy.lock")
PROVENANCE = Path("/usr/local/sbin/proofofwork-ui-release-provenance")
RETAINED_ROOT = Path("/usr/local/sbin/proofofwork-ui-retained-root")
PUBLISH = Path("/usr/local/sbin/proofofwork-ui-release-publish")
RECEIPT = DEPLOY / f"audit26-ui-cutover-{RELEASE}"


LOCK_FD: int | None = None


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def run(label: str, command: list[str], *, cwd: Path | None = None) -> str:
    pass_fds = (LOCK_FD,) if LOCK_FD is not None else ()
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False, pass_fds=pass_fds)
    (RECEIPT / f"{label}.stdout").write_text(result.stdout)
    (RECEIPT / f"{label}.stderr").write_text(result.stderr)
    if result.returncode != 0:
        raise RuntimeError(f"{label} failed with exit {result.returncode}: {result.stderr[-2000:]}")
    return result.stdout.strip()


def main() -> None:
    require(os.geteuid() == 0, "Run this pinned publisher as root on the UI VPS")
    require(not RECEIPT.exists() and not RECEIPT.is_symlink(), "Release receipt path already exists")
    RECEIPT.mkdir(mode=0o700)
    require(SOURCE.is_dir() and not SOURCE.is_symlink(), "Pinned source checkout is missing or unsafe")
    require(ARCHIVE.is_file() and not ARCHIVE.is_symlink(), "Pinned release archive is missing or unsafe")
    require(subprocess.check_output(["git", "-C", str(SOURCE), "rev-parse", "HEAD"], text=True).strip() == COMMIT,
            "Source commit differs")
    require(subprocess.check_output(["git", "-C", str(SOURCE), "rev-parse", "HEAD^{tree}"], text=True).strip() == TREE,
            "Source tree differs")
    require(subprocess.run(["git", "-C", str(SOURCE), "symbolic-ref", "-q", "HEAD"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0,
            "Source checkout is not detached")
    require(not subprocess.check_output(["git", "-C", str(SOURCE), "status", "--porcelain", "--untracked-files=all"],
                                        text=True).strip(), "Source checkout is not clean")
    actual_archive_sha = hashlib.file_digest(ARCHIVE.open("rb"), "sha256").hexdigest()
    require(actual_archive_sha == ARCHIVE_SHA256, "Staged release archive digest differs")
    for repo_path, installed_path in (
        ("deploy/proofofwork-ui-release-publish.sh", PUBLISH),
        ("deploy/proofofwork-ui-release-provenance.sh", PROVENANCE),
        ("deploy/proofofwork-ui-retained-root.py", RETAINED_ROOT),
    ):
        require(Path(SOURCE, repo_path).read_bytes() == installed_path.read_bytes(),
                f"Installed UI helper differs from pinned source: {installed_path}")

    active = Path("/var/www/.proofofwork-ui-release").read_text().splitlines()
    require(f"commit={PRIOR_COMMIT}" in active and f"source_tree={PRIOR_TREE}" in active,
            "Active UI release changed after the approved preflight")
    roots = sorted(path.name for path in ROLLBACKS.glob("proofofwork-www-pre-*"))
    require(roots == [PRIOR_ROOT], f"Unexpected complete rollback roots: {roots}")

    lock_fd = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        import fcntl
        global LOCK_FD
        LOCK_FD = lock_fd
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.environ["POW_UI_DEPLOY_LOCK_FD"] = str(lock_fd)
        current = json.loads(run("prior-rollback", [str(RETAINED_ROOT), str(ROLLBACKS / PRIOR_ROOT)]))
        require(current.get("manifestSha256") == PRIOR_MANIFEST_SHA256 and
                current.get("treeSha256") == PRIOR_ROOT_SHA256 and
                current.get("classification") == "retain", "Retained rollback fingerprint changed")
        run("prior-provenance", [str(PROVENANCE), "verify-rollback"])
        classification = f"{PRIOR_ROOT}:{PRIOR_MANIFEST_SHA256}:{PRIOR_ROOT_SHA256}"
        run("publish", [str(PUBLISH), "--release-id", RELEASE, "--commit", COMMIT,
                         "--source-checkout", str(SOURCE), "--archive", str(ARCHIVE),
                         "--retain-rollback-root", classification])
        run("active-provenance", [str(PROVENANCE), "verify"])
        require(Path("/var/www/.proofofwork-ui-release").read_bytes() ==
                Path(str(ARCHIVE) + ".provenance").read_bytes(), "Active provenance differs from release archive")
        active = Path("/var/www/.proofofwork-ui-release").read_text().splitlines()
        require(f"commit={COMMIT}" in active and f"source_tree={TREE}" in active,
                "Active manifest differs from pinned build")
        require(Path(ROLLBACKS / f"proofofwork-www-pre-{RELEASE}").is_dir(),
                "Publisher did not preserve the prior active release as rollback")
        roots_after = sorted(path.name for path in ROLLBACKS.glob("proofofwork-www-pre-*"))
        require(roots_after == sorted([PRIOR_ROOT, f"proofofwork-www-pre-{RELEASE}"]),
                f"Unexpected rollback root set after publication: {roots_after}")
        new_root = json.loads(run("new-rollback", [str(RETAINED_ROOT),
                             str(ROLLBACKS / f"proofofwork-www-pre-{RELEASE}")]))
        free_bytes = int(subprocess.check_output(["df", "-B1", "--output=avail", "/"], text=True).splitlines()[1])
        require(free_bytes >= 10 * 1024**3, "UI root fell below the 10 GiB capacity reserve")
        print(json.dumps({"status":"verified","release":RELEASE,"commit":COMMIT,"tree":TREE,
                          "archiveSha256":actual_archive_sha,"priorRollback":current,
                          "newRollback":new_root,"freeBytes":free_bytes,
                          "receipt":str(RECEIPT)},sort_keys=True))
    finally:
        os.close(lock_fd)


if __name__ == "__main__":
    main()
