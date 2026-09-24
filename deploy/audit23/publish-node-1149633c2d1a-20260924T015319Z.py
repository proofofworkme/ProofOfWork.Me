#!/usr/bin/python3 -I
"""Pinned Audit 23 node cutover with atomic rollback and timer restoration."""
import sys

if not sys.flags.isolated:
    raise SystemExit("Use python3 -I")

import datetime
import hashlib
import json
import os
import pathlib
import subprocess
import time
import urllib.request

assert os.geteuid() == 0 and len(sys.argv) == 1
os.umask(0o077)

RELEASE = "1149633c2d1a-20260924T015319Z"
COMMIT = "1149633c2d1a5c62c4a800772daa79683e478796"
OLD = "58827586d1a313c6210c3ce599dd46269eeddebc"
TREE = "6071ed84ae3cad5a852ef3d4bb0c87c9d1d64e29"
RUNTIME = "f1dc4a7b4c75eb48482b544cd720bb51d44ab079f5613ab320825f836405e8d4"
LIVE = "/opt/proofofwork-api"
STAGE = LIVE + "-stage-" + RELEASE
OUT = pathlib.Path("/data/proofofwork-audit23-cutover-" + RELEASE)
TOOLS = pathlib.Path("/var/tmp/proofofwork-deploy/audit23-tools")
TIMERS = [
    "pg_basebackup@16-main.timer",
    "pg_compresswal@16-main.timer",
    "proofofwork-cache-prune.timer",
    "proofofwork-node-release-health.timer",
    "proofofwork-node-release-prune.timer",
    "proofofwork-postgres-logical-backup.timer",
    "proofofwork-postgres-query-health.timer",
    "proofofwork-worker-recovery-watch.timer",
]
APPS = [
    "proofofwork-api-wg.socket",
    "proofofwork-api-wg.service",
    "proofofwork-api.service",
    "proofofwork-indexer-worker.service",
]
KEEP = [
    "bitcoind.service",
    "electrs.service",
    "postgresql@16-main.service",
    "pg_receivewal@16-main.service",
]
ENV = {
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "LANG": "C.UTF-8",
    "GIT_OPTIONAL_LOCKS": "0",
}


def run(args, timeout=90):
    result = subprocess.run(
        args,
        env=ENV,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(
            "Command failed: "
            + args[0]
            + " exit="
            + str(result.returncode)
            + " stderr="
            + result.stderr[:1000]
        )
    return result.stdout.strip()


def state(unit):
    return dict(
        value.split("=", 1)
        for value in run(
            ["systemctl", "show", unit, "-p", "LoadState", "-p", "ActiveState", "-p", "MainPID", "-p", "UnitFileState"]
        ).splitlines()
    )


def stopped(fields):
    return fields.get("ActiveState") == "inactive" and fields.get("MainPID", "0") == "0"


def save(name, data):
    with (OUT / name).open("x", encoding="utf-8") as destination:
        json.dump(data, destination, indent=2, sort_keys=True)
        destination.write("\n")
        destination.flush()
        os.fsync(destination.fileno())


def attest(path):
    return run(["/usr/bin/python3", "-I", str(TOOLS / "attest-node.py"), path], 180).split()


def keep_unchanged(before):
    assert all(state(unit) == before[unit] for unit in KEEP), "Full-node or database authority service changed"


def ready():
    for _ in range(36):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8081/health", timeout=15) as response:
                data = json.load(response)
            if data.get("ready") is True and data.get("lagBlocks") == 0:
                return data
        except Exception:
            pass
        time.sleep(5)
    raise RuntimeError("Production readiness did not recover within the 180-second bound")


def stop_apps():
    for unit in (
        "proofofwork-api-wg.socket",
        "proofofwork-api-wg.service",
        "proofofwork-indexer-worker.service",
        "proofofwork-api.service",
    ):
        run(["systemctl", "stop", unit], 180)
    assert all(stopped(state(unit)) for unit in APPS)


assert hashlib.sha256(pathlib.Path("/usr/local/sbin/proofofwork-node-release-exchange").read_bytes()).hexdigest() == (
    "2c8ae0549a707640c3a11a8b6a03fd888c9ef4e5fbe6afded7b7d3866f1754c5"
)
assert hashlib.sha256((TOOLS / "attest-node.py").read_bytes()).hexdigest() == (
    "4bec20fa1e5931636e3bfc84f617f005a7b1b71e752dc7f7c9b8bea23014be38"
)
assert not OUT.exists(), "Cutover evidence path already exists; refusing to overwrite it"
OUT.mkdir(mode=0o700)

baseline = {unit: state(unit) for unit in TIMERS + APPS + KEEP}
assert all(baseline[unit]["ActiveState"] == "active" for unit in KEEP + APPS)
assert all(baseline[unit]["ActiveState"] in ("active", "inactive") for unit in TIMERS)
assert all(
    state(unit.replace(".timer", ".service"))["ActiveState"]
    not in ("active", "activating", "deactivating")
    for unit in TIMERS
), "A maintenance task is active"

old_attestation = attest(LIVE)
new_attestation = attest(STAGE)
assert old_attestation[0] == OLD, "Live node changed after preflight"
assert new_attestation[0:2] == [COMMIT, TREE] and new_attestation[-1] == RUNTIME
root_identities = {
    path: {"device": os.stat(path).st_dev, "inode": os.stat(path).st_ino}
    for path in (LIVE, STAGE)
}
save(
    "before.json",
    {
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "release": RELEASE,
        "units": baseline,
        "oldAttestation": old_attestation,
        "newAttestation": new_attestation,
        "rootIdentities": root_identities,
        "candidateGateEvidence": [
            "candidate read-only API shadow health and consistency passed at Core height 968338 (25/25)",
            "candidate full marketplace pagination and lifecycle regression passed",
            "local exact-Q8, live-data, API-truth, and recovery gates passed",
        ],
    },
)

selected_timers = [unit for unit in TIMERS if baseline[unit]["ActiveState"] == "active"]
phase = "before-stop"
success = False
try:
    run(["systemctl", "stop", *selected_timers])
    assert all(state(unit)["ActiveState"] == "inactive" for unit in selected_timers)

    shadow = state("proofofwork-audit23-shadow-1149633c2d1a-20260924T015319Z.service")
    if shadow["LoadState"] == "loaded":
        run(["systemctl", "stop", "proofofwork-audit23-shadow-1149633c2d1a-20260924T015319Z.service"])
    else:
        assert shadow["LoadState"] == "not-found" and stopped(shadow)

    phase = "stopping"
    stop_apps()
    assert not run(["ss", "-ltnH", "sport = :8081 or sport = :18081"])

    for proc in pathlib.Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            cwd = os.readlink(proc / "cwd")
        except (FileNotFoundError, ProcessLookupError):
            continue
        assert not any(cwd == root or cwd.startswith(root + "/") for root in (LIVE, STAGE)), (
            "A process still has a live or candidate checkout as its working directory"
        )

    for attempt in range(46):
        sessions = run(
            [
                "sudo",
                "-n",
                "-u",
                "postgres",
                "psql",
                "-X",
                "-qAt",
                "-v",
                "ON_ERROR_STOP=1",
                "-d",
                "proof_indexer",
                "-c",
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()",
            ],
            15,
        )
        if sessions == "0":
            break
        if attempt < 45:
            time.sleep(1)
    assert sessions == "0", "Database sessions did not drain after API and worker stop"
    save("drain.json", {"waitSeconds": attempt, "remainingSessions": int(sessions)})
    keep_unchanged(baseline)
    assert attest(LIVE) == old_attestation and attest(STAGE) == new_attestation

    run(["sync", "-f", LIVE])
    run(["sync", "-f", STAGE])
    phase = "exchange-uncertain"
    exchange = run(
        ["/usr/local/sbin/proofofwork-node-release-exchange", "--release-id", RELEASE]
    )
    assert "status=exchanged" in exchange
    phase = "exchanged"
    save("exchange.json", {"result": exchange})
    assert attest(LIVE) == new_attestation and attest(STAGE) == old_attestation
    phase = "verified-exchange"

    request = pathlib.Path(
        "/var/tmp/proofofwork-deploy/proofofwork-node-release-"
        "1149633-20260924T015319Z.tgz"
    )
    with request.open("xb") as destination:
        destination.write(b"Audit 23 publisher request; reconstruct evidence from the exact attested live checkout.\n")
        destination.flush()
        os.fsync(destination.fileno())
    publisher = run(
        ["/usr/local/sbin/proofofwork-node-release-publish", str(request)], 600
    )
    save("archive.json", {"result": publisher})

    run(["systemctl", "start", "proofofwork-api.service", "proofofwork-indexer-worker.service"])
    health = ready()
    run(["systemctl", "start", "proofofwork-api-wg.socket", "proofofwork-api-wg.service"])
    assert all(state(unit)["ActiveState"] == "active" for unit in APPS)
    keep_unchanged(baseline)
    save(
        "after.json",
        {
            "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "units": {unit: state(unit) for unit in APPS + KEEP},
            "health": health,
            "attestation": attest(LIVE),
        },
    )
    success = True
    phase = "complete"
except Exception as error:
    save(
        "failure.json",
        {
            "phase": phase,
            "error": str(error),
            "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        },
    )
    if phase == "verified-exchange":
        stop_apps()
        assert attest(LIVE) == new_attestation and attest(STAGE) == old_attestation
        rollback = run(
            ["/usr/local/sbin/proofofwork-node-release-exchange", "--release-id", RELEASE]
        )
        assert "status=exchanged" in rollback
        assert attest(LIVE) == old_attestation and attest(STAGE) == new_attestation
        keep_unchanged(baseline)
        save("rollback.json", {"result": rollback, "live": attest(LIVE), "stage": attest(STAGE)})
        phase = "rolled-back"
    if phase in ("before-stop", "stopping", "rolled-back"):
        run(["systemctl", "start", *APPS])
        recovered = ready()
        assert all(state(unit)["ActiveState"] == "active" for unit in APPS)
        keep_unchanged(baseline)
        if phase == "rolled-back":
            save("recovered-old.json", {"health": recovered, "live": attest(LIVE)})
    raise
finally:
    if phase not in ("exchange-uncertain", "exchanged"):
        run(["systemctl", "start", *selected_timers])
        save("timers-restored.json", {unit: state(unit) for unit in TIMERS})

print(json.dumps({"ok": success, "phase": phase, "commit": COMMIT, "receipt": str(OUT)}))
