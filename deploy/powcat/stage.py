#!/usr/bin/python3 -I
"""Run a bounded, separate v5 Search/discovery projection from the exact accepted candidate plan."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ENGINE = importlib.util.spec_from_file_location("powcat_release", HERE / "release.py")
release = importlib.util.module_from_spec(ENGINE)
ENGINE.loader.exec_module(release)
release.DISCOVERY = True
ROOT = Path("/var/lib/proofofwork-powcat-stage")
NODE = Path("/opt/node-v24.18.0-linux-x64/bin/node")
WORKER = "scripts/backfill-proof-indexer.mjs"
SEARCH = "scripts/backfill-proof-search.mjs"
PROOF = "deploy/powcat/stage-proof.mjs"
SHARED = "server/search-generation-sharing.mjs"
NATIVE = {SEARCH: "7f52a01e705fff7ec4740428a248fee71f8266f905854557cb38ddb53bb3f7cb",
          SHARED: "457a3484c9e88dc33c96ae3f26455125b6755bc09943adae844066bca6c505f7"}
NEED = release.need


def module_sources(ns, candidates, manifest):
    # Traverse only the reviewed workers' executable dependencies. Native
    # saved-generation sharing is part of the accepted runtime, even where
    # the Git checkout's historical reader and builder have simpler contents.
    ns["ENTRYPOINTS"] = (WORKER, SEARCH, "server/db/search-reader.mjs", "server/db/powcat-activity.mjs",
                         "server/db/code-reader.mjs")
    paths = ns["dependency_closure"](release.RUNTIME, candidates) | ns["ROOT_JSON"]
    NEED(len(paths) <= 256 and set(NATIVE) <= paths, "Unexpected native staging closure")
    result = {}
    for p in sorted(paths):
        if p in candidates:
            result[p] = candidates[p]
        else:
            raw = ns["safe_read"](release.RUNTIME / p)
            NEED(ns["sha"](raw) == manifest["dependencies"].get(p), "Unpinned staged dependency: " + p)
            result[p] = raw
    for p, digest in NATIVE.items():
        NEED(ns["sha"](result[p]) == digest, "Native Search dependency mismatch: " + p)
    return result


def directory(path):
    info = path.lstat()
    NEED(path.resolve(strict=True) == path and stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
         and not info.st_mode & 0o7022, "Unsafe staging directory")


def create_file(path, raw):
    with os.fdopen(os.open(path, os.O_NOFOLLOW | os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644), "wb") as f:
        f.write(raw); f.flush(); os.fsync(f.fileno())


def stage_sources(args):
    release.source_fence(args.commit)
    for path in ("deploy/powcat/stage.py", PROOF):
        NEED((release.REPO / path).read_bytes() == release.git("show", args.commit + ":" + path), "Staging tool changed")
    arch = release.namespace(release.pinned("monitoring-reconciliation/runtime_archive.py"))
    plan = json.loads(arch["read"](args.plan, args.sha256))
    controller = release.controller()
    NEED(plan["sourceCommit"] == args.commit and base64.b64decode(plan["controllerBase64"], validate=True) == controller
         and plan["controllerSha256"] == release.sha(controller), "Unbound staged plan")
    ns = release.namespace(controller)
    manifest = plan["runtimeManifestTemplate"]
    candidates = ns["validate_manifest"](manifest)
    NEED(manifest["sourceCommit"] == args.commit and manifest["format"] == "proof-of-work-powcat-discovery-scoped-runtime-v1",
         "Wrong committed discovery manifest")
    ns["fence"](release.RUNTIME, manifest, candidates)
    ns["metadata_fence"](release.RUNTIME, manifest["sourceMetadata"])
    NEED(plan["nodePath"] == str(NODE) and release.sha(ns["safe_read"](NODE, 200*1024**2)) == manifest["nodeSha256"],
         "Runtime Node executable changed")
    sources = module_sources(ns, candidates, manifest)
    sources[PROOF] = release.git("show", args.commit + ":" + PROOF)
    NEED(sum(map(len, sources.values())) < 48*1024**2, "Candidate source closure is too large")
    directory(ROOT.parent)
    ROOT.mkdir(mode=0o755, exist_ok=True)
    directory(ROOT)
    path = ROOT / args.sha256
    proof = {"commit": args.commit, "planSha256": args.sha256, "sourceHashes": {p: release.sha(b) for p,b in sources.items()}}
    if not os.path.lexists(path):
        path.mkdir(mode=0o755)
        for name, raw in sources.items():
            out = path / name; out.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            create_file(out, raw)
        libs = release.RUNTIME / "node_modules"
        NEED(libs.resolve(strict=True) == libs and libs.is_dir(), "Unsafe runtime dependencies")
        os.symlink(libs, path / "node_modules")
        create_file(path / "stage.json", (json.dumps(proof,sort_keys=True)+"\n").encode())
    directory(path)
    NEED(json.loads(ns["safe_read"](path / "stage.json")) == proof, "Stage receipt differs")
    NEED(os.readlink(path / "node_modules") == str(release.RUNTIME/"node_modules"), "Staged dependencies differ")
    observed = set()
    for parent, directories, files in os.walk(path, followlinks=False):
        directory(Path(parent))
        for d in directories:
            if (Path(parent)/d).is_symlink():
                NEED(Path(parent)/d == path/"node_modules", "Unexpected staged link")
        for f in files:
            p = Path(parent)/f
            name = str(p.relative_to(path))
            if name != "stage.json": observed.add(name)
    NEED(observed == set(sources), "Unexpected or missing staged source")
    for name, candidate in sources.items():
        NEED(ns["safe_read"](path / name) == candidate, "Stage source drift: " + name)
    return path


def command(mode, path):
    env = ["/etc/proofofwork-api/proof-indexer-db.env", "/etc/proofofwork-api/bitcoin-rpc.env"]
    # Both computations need only the DB + Core read transport. The API's
    # internal-verifier credentials are unnecessary for these two exclusive modes.
    flags = [f"--property=EnvironmentFile={f}" for f in env]
    args = {"files": [WORKER, "--bootstrap-powcat"],
            "search": [SEARCH, "--once", "--batch-size=200", "--max-batches=20", "--budget-ms=30000"],
            "verify": [PROOF]}[mode]
    return ["/usr/bin/systemd-run", "--quiet", "--pipe", "--wait", "--collect", "--service-type=exec",
            "--property=User=powadmin", "--property=Group=powadmin", "--property=NoNewPrivileges=true",
            "--property=PrivateDevices=true", "--property=PrivateTmp=true", "--property=ProtectSystem=strict",
            "--property=ProtectHome=true", "--property=CapabilityBoundingSet=", "--property=MemorySwapMax=0",
            "--property=MemoryMax=512M", "--property=CPUQuota=100%", "--property=IOWeight=25",
            "--property=IOSchedulingClass=idle", "--property=Nice=10", "--property=RuntimeMaxSec=300",
            "--property=LimitCORE=0", f"--property=WorkingDirectory={path}", *flags, "--setenv=NETWORK=livenet",
            "--setenv=POW_INDEX_DB_POOL_MAX=1", "--setenv=POW_INDEX_DB_STATEMENT_TIMEOUT_MS=15000",
            "--setenv=POW_INDEX_POWCAT_MAX_BLOCKS=96", str(NODE), str(path / args[0]), *args[1:]]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare","files","search","verify"))
    parser.add_argument("commit"); parser.add_argument("plan",type=Path); parser.add_argument("sha256")
    args = parser.parse_args()
    NEED(os.geteuid() == 0 and sys.flags.isolated and re.fullmatch(r"[0-9a-f]{64}",args.sha256),
         "Use isolated root Python on node VPS against an approved plan SHA")
    os.umask(0o022)
    path = stage_sources(args)
    if args.mode == "prepare":
        print(json.dumps({"ok":True,"stage":str(path),"commit":args.commit,"planSha256":args.sha256}))
    else:
        subprocess.run(command(args.mode,path),check=True,timeout=330)


if __name__ == "__main__":
    main()
