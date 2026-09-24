#!/usr/bin/python3 -I
"""Pin and apply the already-reviewed bounded mempool container log override."""
import sys
if not sys.flags.isolated:
    raise SystemExit("Use python3 -I")
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import time
import urllib.request

assert os.geteuid() == 0 and len(sys.argv) == 1
os.umask(0o077)
BASE = "/opt/mempool/docker-compose.yml"
OVERRIDE = "/opt/mempool/proofofwork-log-rotation.override.yml"
WORKDIR = "/opt/mempool"
OUT = pathlib.Path("/data/proofofwork-audit23-mempool-log-rotation-20260924T023000Z")
EXPECTED = {
    "mempool-api-1": "ad45828e4979bd0815a72ab5b2bf3fe772f0ff712e50be2307f36f092ea666bd",
    "mempool-db-1": "aae5f7c0d81117bb6f4574db443aaf9d74270a4d9e7ff20e5edfeb61efdbc03e",
    "mempool-web-1": "18517f0e1cf57ad018ccb593af00ebf170d0d48820850a2bbc1634a9bfbcbdc4",
}
MOUNTS = {
    "mempool-api-1": {("/data/mempool/cache", "/backend/cache")},
    "mempool-db-1": {("/data/mempool/mysql", "/var/lib/mysql")},
}
ENV = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"}


def run(args, timeout=90, cwd=None):
    result = subprocess.run(args, env=ENV, cwd=cwd, stdin=subprocess.DEVNULL,
                            capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed with exit {result.returncode}: {result.stderr[-1200:]}")
    return result.stdout.strip()


def sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def inspect(name):
    return json.loads(run(["docker", "inspect", name]))[0]


def summary(name):
    item = inspect(name)
    state = item["State"]
    health = state.get("Health", {}).get("Status", "none")
    return {
        "name": name,
        "id": item["Id"],
        "image": item["Config"]["Image"],
        "imageId": item["Image"],
        "status": state["Status"],
        "health": health,
        "project": item["Config"].get("Labels", {}).get("com.docker.compose.project"),
        "service": item["Config"].get("Labels", {}).get("com.docker.compose.service"),
        "configFiles": item["Config"].get("Labels", {}).get("com.docker.compose.project.config_files"),
        "mounts": sorted((m["Source"], m["Destination"]) for m in item.get("Mounts", [])),
        "logPath": item.get("LogPath"),
        "logConfig": item["HostConfig"].get("LogConfig", {}),
    }


def assert_mounts(container):
    got = set(map(tuple, container["mounts"]))
    assert got == MOUNTS[container["name"]], (container["name"], got)
    for source, _ in got:
        assert pathlib.Path(source).is_dir(), source


def capped(container):
    config = container["logConfig"]
    assert config.get("Type") == "json-file", (container["name"], config)
    assert config.get("Config") == {"max-file": "4", "max-size": "25m"}, (container["name"], config)


def wait_healthy(name, image_id, timeout=180):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            current = summary(name)
            last = current
            if current["status"] == "running" and current["health"] == "healthy":
                assert current["imageId"] == image_id, (name, current["imageId"], image_id)
                return current
        except (subprocess.SubprocessError, RuntimeError, AssertionError):
            pass
        time.sleep(2)
    raise RuntimeError(f"{name} did not become healthy within {timeout}s; last={last}")


def archive_stopped_log(name, old):
    source = pathlib.Path(old["logPath"])
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(source, flags)
    try:
        before = os.fstat(fd)
        assert os.path.isfile(source) and before.st_size >= 0
        target = OUT / (name + ".json.log")
        outfd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        digest = hashlib.sha256()
        size = 0
        try:
            while True:
                block = os.read(fd, 1024 * 1024)
                if not block:
                    break
                digest.update(block)
                size += len(block)
                view = memoryview(block)
                while view:
                    written = os.write(outfd, view)
                    view = view[written:]
            os.fsync(outfd)
        finally:
            os.close(outfd)
        after = os.fstat(fd)
        assert before.st_size == after.st_size == size
        assert before.st_ino == after.st_ino and before.st_mtime_ns == after.st_mtime_ns
        return {"originalPath": str(source), "archivePath": str(target), "bytes": size,
                "sha256": digest.hexdigest(), "stableWhileCopied": True}
    finally:
        os.close(fd)


def verify_tip_api():
    with urllib.request.urlopen("http://127.0.0.1:8080/api/blocks/tip/height", timeout=5) as response:
        body = response.read(64).decode("ascii").strip()
    assert body.isdigit() and int(body) > 0, body
    return int(body)


def restore_previous_runtime(old):
    # The API and DB were originally created from BASE only; recreate that exact
    # runtime config with the same pinned images and bind mounts if recovery is needed.
    for name in ("mempool-db-1", "mempool-api-1"):
        try:
            current = summary(name)
        except Exception:
            current = {"status": "absent", "health": "none", "logConfig": {}}
        if current["status"] != "running" or current["health"] != "healthy" or current["logConfig"].get("Config"):
            service = "db" if name == "mempool-db-1" else "api"
            run(["docker", "compose", "-p", "mempool", "-f", BASE,
                 "up", "-d", "--no-deps", "--force-recreate", "--pull", "never", service], 240, WORKDIR)
            wait_healthy(name, old[name]["imageId"], 180)
    assert verify_tip_api() > 0


assert not OUT.exists(), "Evidence directory already exists"
for path in (BASE, OVERRIDE):
    assert pathlib.Path(path).is_file() and not pathlib.Path(path).is_symlink()
compose = ["docker", "compose", "-p", "mempool", "-f", BASE, "-f", OVERRIDE]
config = json.loads(run(compose + ["config", "--format", "json"], 60, WORKDIR))
for service in ("api", "db", "web"):
    logging = config["services"][service].get("logging", {})
    assert logging.get("driver") == "json-file"
    assert logging.get("options") == {"max-size": "25m", "max-file": "4"}
assert {p: shutil.disk_usage(p).free for p in ("/", "/data")}["/"] > 5 * 1024**3
assert shutil.disk_usage("/data").free > 20 * 1024**3
old = {name: summary(name) for name in EXPECTED}
for name, record in old.items():
    assert record["id"].startswith(EXPECTED[name])
    assert record["project"] == "mempool" and record["service"] == name.removesuffix("-1").removeprefix("mempool-")
    assert record["status"] == "running" and record["health"] == "healthy"
    assert_mounts(record) if name in MOUNTS else None
    assert pathlib.Path(record["logPath"]).is_file()
assert old["mempool-api-1"]["logConfig"].get("Config") == {}
assert old["mempool-db-1"]["logConfig"].get("Config") == {}
capped(old["mempool-web-1"])
assert "docker-compose.yml" in old["mempool-api-1"]["configFiles"]
assert "proofofwork-log-rotation.override.yml" not in old["mempool-api-1"]["configFiles"]
assert "docker-compose.yml" in old["mempool-db-1"]["configFiles"]
assert "proofofwork-log-rotation.override.yml" not in old["mempool-db-1"]["configFiles"]

before = {
    "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "composeFiles": {BASE: sha(BASE), OVERRIDE: sha(OVERRIDE)},
    "effectiveLogOptions": {s: config["services"][s]["logging"] for s in ("api", "db", "web")},
    "containers": old,
    "dataDirectories": {"apiCache": "/data/mempool/cache", "dbData": "/data/mempool/mysql"},
    "apiTipHeight": verify_tip_api(),
    "action": "Recreate only mempool db and api with existing 25m x 4 json-file override; preserve original raw logs first; no volume/image changes.",
}
assert not OUT.exists(), "Evidence directory appeared during preflight"
OUT.mkdir(mode=0o700)
with (OUT / "before.json").open("x", encoding="utf-8") as f:
    json.dump(before, f, indent=2, sort_keys=True); f.write("\n"); f.flush(); os.fsync(f.fileno())
override_copy = OUT / "proofofwork-log-rotation.override.yml"
shutil.copyfile(OVERRIDE, override_copy)
os.chmod(override_copy, 0o600)

phase = "before-stop"
archived = {}
try:
    phase = "stopping-api"
    run(["docker", "stop", "--time", "30", "mempool-api-1"], 45)
    assert inspect("mempool-api-1")["State"]["Status"] == "exited"
    archived["mempool-api-1"] = archive_stopped_log("mempool-api-1", old["mempool-api-1"])
    phase = "stopping-db"
    run(["docker", "stop", "--time", "60", "mempool-db-1"], 75)
    assert inspect("mempool-db-1")["State"]["Status"] == "exited"
    archived["mempool-db-1"] = archive_stopped_log("mempool-db-1", old["mempool-db-1"])
    with (OUT / "preserved-logs.json").open("x", encoding="utf-8") as f:
        json.dump(archived, f, indent=2, sort_keys=True); f.write("\n"); f.flush(); os.fsync(f.fileno())
    phase = "recreating-db"
    run(compose + ["up", "-d", "--no-deps", "--force-recreate", "--pull", "never", "db"], 240, WORKDIR)
    db_after = wait_healthy("mempool-db-1", old["mempool-db-1"]["imageId"])
    assert_mounts(db_after); capped(db_after)
    phase = "recreating-api"
    run(compose + ["up", "-d", "--no-deps", "--force-recreate", "--pull", "never", "api"], 240, WORKDIR)
    api_after = wait_healthy("mempool-api-1", old["mempool-api-1"]["imageId"])
    assert_mounts(api_after); capped(api_after)
    web_after = summary("mempool-web-1")
    assert web_after["id"] == old["mempool-web-1"]["id"] and web_after["health"] == "healthy"
    capped(web_after)
    tip = verify_tip_api()
    after = {
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "containers": {name: summary(name) for name in EXPECTED},
        "apiTipHeight": tip,
        "originalLogs": archived,
        "allLogConfigsBounded": True,
        "sameImages": all(summary(name)["imageId"] == old[name]["imageId"] for name in EXPECTED),
        "samePersistentMounts": True,
        "overrideSha256": sha(OVERRIDE),
        "diskFreeBytes": {p: shutil.disk_usage(p).free for p in ("/", "/data")},
    }
    with (OUT / "after.json").open("x", encoding="utf-8") as f:
        json.dump(after, f, indent=2, sort_keys=True); f.write("\n"); f.flush(); os.fsync(f.fileno())
    phase = "complete"
except Exception as error:
    (OUT / "failure.json").write_text(json.dumps({"phase": phase, "error": str(error),
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat()}, indent=2, sort_keys=True) + "\n")
    (OUT / "failure.json").chmod(0o600)
    # Roll back to the prior base-only container config while keeping bind mounts and images pinned.
    restore_previous_runtime(old)
    (OUT / "rollback.json").write_text(json.dumps({"at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "runtime": {name: summary(name) for name in EXPECTED}, "apiTipHeight": verify_tip_api(),
        "restoredBaseOnlyRuntime": True}, indent=2, sort_keys=True) + "\n")
    (OUT / "rollback.json").chmod(0o600)
    raise

print(json.dumps({"ok": phase == "complete", "phase": phase, "receipt": str(OUT),
                  "apiTipHeight": tip, "oldLogsPreserved": archived,
                  "boundedContainers": ["mempool-web-1", "mempool-api-1", "mempool-db-1"]}))
