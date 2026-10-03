"""Read-only production evidence collection and HTTPS byte verification."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("plan")
parser.add_argument("publish_log")
parser.add_argument("destination")
args = parser.parse_args()
plan_path = pathlib.Path(args.plan)
publish_path = pathlib.Path(args.publish_log)
assert plan_path.stat().st_size <= 65536
assert publish_path.stat().st_size <= 8 * 1024**2
plan = json.loads(plan_path.read_text())
release, commit, tree = (plan[k] for k in ("releaseId", "commit", "tree"))
assert re.fullmatch(r"[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z", release)
assert re.fullmatch(r"[0-9a-f]{40}", commit)
assert re.fullmatch(r"[0-9a-f]{40}", tree)
assert release.startswith(commit[:12] + "-")
rows = []
for line in publish_path.read_text().splitlines():
    try:
        value = json.loads(line)
    except json.JSONDecodeError:
        continue
    if isinstance(value, dict):
        rows.append(value)
receipts = [r for r in rows if r.get("releaseId") == release and "exitCode" in r]
assert len(receipts) == 1
receipt = receipts[0]
assert receipt["commit"] == commit and receipt["tree"] == tree
assert receipt["exitCode"] == 0 and receipt["failure"] is None
proofs = [r for r in rows if r.get("ok") is True and r.get("allPriorRootsPreserved") is True]
assert len(proofs) == 1
proof = proofs[0]
assert re.fullmatch(r"[0-9a-f]{64}", proof["archiveSha256"])
assert re.fullmatch(r"[0-9a-f]{64}", proof["manifestSha256"])
destination = pathlib.Path(args.destination)
assert destination.is_absolute()
destination.mkdir(mode=0o700)
assert destination.resolve() == destination
archive = "proofofwork-ui-release-" + release + ".tgz"
paths = ["/var/backups/proofofwork-ui/releases/" + archive + suffix
         for suffix in ("", ".sha256", ".provenance")]
paths.append("/var/www/.proofofwork-ui-release")
command = ["scp", "-i", "/home/sixer/.ssh/proofofwork_me_ed25519",
           "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
           "-o", "StrictHostKeyChecking=yes"]
command += ["root@77.42.91.106:" + path for path in paths]
command.append(str(destination) + "/")
subprocess.run(command, check=True, timeout=600)
for path in destination.iterdir():
    assert path.is_file() and not path.is_symlink()
    path.chmod(0o600)
archive_path = destination / archive
assert archive_path.stat().st_size <= 2 * 1024**3
with archive_path.open("rb") as source:
    assert hashlib.file_digest(source, "sha256").hexdigest() == proof["archiveSha256"]
manifest = (destination / ".proofofwork-ui-release").read_bytes()
assert len(manifest) <= 65536
assert hashlib.sha256(manifest).hexdigest() == proof["manifestSha256"]
assert manifest == (destination / (archive + ".provenance")).read_bytes()
helper = pathlib.Path(__file__).with_name("https_smoke.py")
assert hashlib.sha256(helper.read_bytes()).hexdigest() == plan["httpsSmokeSha256"]
subprocess.run(["/usr/bin/python3", "-I", "-B", str(helper), str(archive_path),
                release, commit, tree, proof["archiveSha256"],
                "--receipt", str(destination / "https-smoke-receipt.json"),
                "--workers", "8", "--timeout", "30", "--overall-timeout", "900"],
               check=True, timeout=930)
