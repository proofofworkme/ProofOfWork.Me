#!/usr/bin/python3 -I
"""Plan, rehearse, apply or accept the scoped pending-discovery upgrade on NODE."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
PREVIOUS = HERE.parent / "summary-preview/release.py"
PREVIOUS_SHA = "0db422c70796b6827e730db8e21312abd2974d01ea12487f3dbc0d526816366a"
COMPLETION = Path("/data/proofofwork-release-backups/runtime-latest-6b5c5d62e640-20261103T165357Z/completion.json")
COMPLETION_SHA = "4241ef4ae9e6ae8c6435e163eeec239b679e702a16d0183ad9847e31efd31115"
LIVE_CHECK = "scripts/check-pending-discovery-live.mjs"
SUITES = ("server/pending-broadcast-hints.test.mjs", "scripts/check-pending-discovery-worker.test.mjs",
          "scripts/check-pending-log-publication.test.mjs")
raw = PREVIOUS.read_bytes()
if hashlib.sha256(raw).hexdigest() != PREVIOUS_SHA:
    raise ValueError("Changed predecessor release engine")
previous = {"__name__": "_accepted_preview_engine", "__file__": str(PREVIOUS)}
exec(compile(raw, str(PREVIOUS), "exec"), previous)
engine, lab = previous["engine"], previous["lab"]
need, sha = previous["require"], previous["sha"]


def controller():
    raw = previous["original_controller"]()
    body, footer = raw.rsplit(b"\nif __name__ == '__main__': main()", 1)
    prefix = b"backup = BACKUPS/('powcat-'"
    need(not footer.strip() and body.count(prefix) == 1, "Unexpected overlay controller")
    body = body.replace(prefix, b"backup = BACKUPS/('pending-discovery-'")
    return body + b"\n" + (HERE / "profile.py").read_bytes() + b"\nif __name__ == '__main__': main()\n"


# Use only the generic plan/manifest binding and archival dispatcher. The old
# incident capture and single-file rehearsal never run for this healthy upgrade.
previous["controller"] = engine["controller"] = controller


def healthy():
    state = previous["health"]()
    index, worker, node = (state["checks"][key] for key in ("index", "worker", "node"))
    summary = index["summarySnapshot"]
    height, digest = node["tipHeight"], node["bestBlockHash"]
    keys = {"growthSummary", "inceptionSummary", "infinitySummary", "logSummary",
            "marketplaceSummary", "tokenSummary", "workFloor", "workSummary"}
    need(state["ready"] is True and state["ok"] is True and node["ok"] is True and
         worker["proofReady"] is True and worker["consecutiveFailures"] == 0 and
         index["complete"] is True and index["checkpointCanonical"] is True and
         summary["ok"] is True and summary["eligible"] is True and set(summary["coverageByKey"]) == keys and
         all(v == height for v in summary["coverageByKey"].values()) and
         height == index["indexedThroughBlock"] == summary["indexedThroughBlock"] and
         digest == index["checkpointHash"] == index["canonicalCheckpointHash"] == summary["blockHash"],
         "Expected healthy exact-tip Core, scan, worker and eight-summary predecessor")
    return {"height": height, "hash": digest, "snapshotId": summary["snapshotId"]}


def stage_sources(out, ns, manifest, candidates):
    """Stage the import closure under a private namespace without creating a new live helper path."""
    root, total = ns["ROOT"], 0
    closure = ns["dependency_closure"](root, candidates)
    need(len(closure) <= 256 and ns["NEW"] <= closure, "Candidate outside bounded executable closure")
    view = out / "server"
    view.mkdir(); os.chmod(view, 0o755)
    for name in sorted(p for p in closure if p.startswith("server/")):
        if name in candidates:
            data = candidates[name]
        else:
            data = ns["safe_read"](root / name)
            need(sha(data) == manifest["dependencies"].get(name), "Unpinned staged module: " + name)
        if name == lab["API"]:
            adapted = lab["transform_api"](data)
            standard_tail = lab["TAIL"].encode()
            need(adapted.endswith(standard_tail), "Unexpected API rehearsal footer")
            data = adapted[:-len(standard_tail)] + (HERE / "proof.mjs").read_bytes()
        elif name == lab["POSTGRES"]:
            data = lab["transform_postgres"](data)
        total += len(data)
        need(total <= 48 * 1024**2, "Staged code exceeds bound")
        path = out / name
        path.parent.mkdir(parents=True, exist_ok=True)
        for parent in (path.parent, *path.parent.parents):
            if parent == out: break
            os.chmod(parent, 0o755)
        lab["save"](path, data, 0o644)
    worker = lab["transform_worker"](candidates[lab["WORKER"]])
    lab["save"](out / "worker.mjs", worker, 0o644)
    return [str(view) + ":" + str(root / "server"), str(out / "worker.mjs") + ":" + str(root / lab["WORKER"])]


def offline_suites(node):
    """Exercise committed queue and same-tip fixtures in a network-isolated process."""
    repo = engine["REPO"]
    for name in SUITES:
        need((repo / name).read_bytes() == engine["git"]("show", "HEAD:" + name), "Uncommitted pending fixture")
    argv = ["/usr/bin/systemd-run", "--pipe", "--wait", "--collect", "--quiet", "--service-type=exec",
            "--property=User=powadmin", "--property=Group=powadmin", "--property=PrivateNetwork=yes",
            "--property=PrivateTmp=yes", "--property=ProtectSystem=strict", "--property=ProtectHome=yes",
            "--property=PrivateDevices=yes", "--property=NoNewPrivileges=yes", "--property=CapabilityBoundingSet=",
            "--property=RuntimeMaxSec=300", "--property=CPUQuota=100%", "--property=MemoryMax=2G",
            "--property=MemorySwapMax=0", "--property=IOWeight=25", "--property=Nice=15",
            "--property=BindReadOnlyPaths=" + str(repo),
            "--property=WorkingDirectory=" + str(repo), str(node), "--test", "--test-concurrency=1", *SUITES]
    result = subprocess.run(argv, capture_output=True, timeout=330)
    need(result.returncode == 0, "Isolated pending/snapshot fixtures failed: " +
         (result.stdout + result.stderr)[-1000:].decode(errors="replace"))
    return {"suites": list(SUITES), "outputSha256": sha(result.stdout), "privateNetwork": True}


def rehearse(args):
    ns, manifest, candidates = previous["bound_plan"](args)
    start = healthy()
    root = ns["ROOT"]
    pid = manifest["protectedServices"]["states"][ns["UNITS"][0]]["MainPID"]
    node = Path(os.readlink("/proc/" + pid + "/exe"))
    need(node.is_absolute() and sha(ns["safe_read"](node, 200*1024**2)) == manifest["nodeSha256"], "Node differs")
    offline = offline_suites(node)
    with tempfile.TemporaryDirectory(prefix="pending-discovery-", dir="/tmp") as temp:
        out = Path(temp)
        mounts = stage_sources(out, ns, manifest, candidates)
        props = {key: ns["ctl"]("show", ns["UNITS"][0], "--value", "-p", key)
                 for key in ("Environment", "PassEnvironment", "UnsetEnvironment")}
        files = lab["environment_files"](ns["ctl"]("show", ns["UNITS"][0], "--value", "-p", "EnvironmentFiles"))
        cmd = lab["command"]({"runtimeManifestTemplate": manifest, "nodePath": str(node)}, out, props, files)
        original_binds = [arg for arg in cmd if arg.startswith("--property=BindReadOnlyPaths=")]
        need(len(original_binds) == 1, "Unexpected rehearsal bindings")
        cmd[cmd.index(original_binds[0])] = "--property=BindReadOnlyPaths=" + " ".join(mounts)
        cmd[1:2] = ["--wait", "--collect", "--quiet"]
        cmd[cmd.index("--property=RemainAfterExit=yes")] = "--property=RemainAfterExit=no"
        try:
            run = subprocess.run(cmd, capture_output=True, timeout=350)
        except subprocess.TimeoutExpired:
            raise ValueError("Read-only rehearsal exceeded the native limit") from None
        if run.returncode:
            # The inherited service environment must never be printed in an error.
            for key in ("stderr", "stdout"):
                if (out / key).is_file():
                    print((out / key).read_text(errors="replace")[-1200:], file=sys.stderr)
            raise ValueError("Pending discovery rehearsal failed")
        records = [json.loads(line) for line in (out / "stdout").read_text().splitlines()
                   if line.startswith('{"format":"pending-discovery-rehearsal-v1"')]
        need(len(records) == 1 and records[0]["ok"] is True and records[0]["published"] is False,
             "Missing bounded candidate proof")
    ns["fence"](root, manifest, candidates)
    return {"planSha256": args.sha256, "sourceCommit": args.commit,
            "sourceTree": engine["git"]("rev-parse", "HEAD^{tree}").decode().strip(),
            "candidateHashes": {name: sha(data) for name, data in candidates.items()},
            "predecessor": start, "offline": offline, "rehearsal": records[0], "closing": healthy()}


def request_json(request, limit, accepted=(200,)):
    try:
        response = urllib.request.urlopen(request, timeout=60)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        data = response.read(limit + 1)
        need(response.status in accepted and len(data) <= limit, "Read-only evidence HTTP response refused")
        return json.loads(data)


def live_postflight(args):
    ns = engine["namespace"](controller())
    archival = engine["namespace"](engine["pinned"]("monitoring-reconciliation/runtime_archive.py"))
    need(args.receipt_dir.parent == archival["BASE"] and args.receipt_dir.resolve(strict=True) == args.receipt_dir,
         "Require exact VPS release receipt directory")
    manifest = json.loads(archival["read"](args.receipt_dir / "manifest.json", args.manifest_sha256))
    candidates = ns["validate_manifest"](manifest)
    installed = json.loads(archival["read"](args.receipt_dir / "receipt.json"))
    need(manifest["sourceCommit"] == args.commit and installed.get("installed") is True and
         installed.get("rolledBack") is False and installed.get("manifestSha256") == args.manifest_sha256 and
         installed.get("sourceCommit") == args.commit and installed.get("completedAt") and
         all(sha(ns["safe_read"](ns["ROOT"] / name)) == sha(raw) for name, raw in candidates.items()),
         "Actual installed node source or completion receipt differs")
    start = healthy()
    pid = ns["ctl"]("show", ns["UNITS"][0], "--value", "-p", "MainPID")
    env = dict(v.split(b"=", 1) for v in (Path("/proc") / pid / "environ").read_bytes().split(b"\0") if b"=" in v)
    def local(path, auth=False, accepted=(200,)):
        req = urllib.request.Request("http://127.0.0.1:8081" + path)
        if auth:
            req.add_header("x-pow-internal-verifier", env[b"POW_INTERNAL_VERIFIER_TOKEN"].decode())
        return request_json(req, 8*1024**2, accepted)
    hints_path = "/api/v1/internal/pending-discovery-hints?network=livenet"
    local(hints_path, accepted=(404,))
    hints = local(hints_path, auth=True)
    ids = hints.get("txids")
    need(hints.get("model") == "accepted-broadcast-txid-hints-v1" and hints.get("network") == "livenet" and
         isinstance(ids, list) and len(ids) <= 256 and len(ids) == len(set(ids)) and all(isinstance(s, str) and ns["SHA"].fullmatch(s) for s in ids),
         "Invalid authenticated hints read")
    node = Path(os.readlink("/proc/" + pid + "/exe"))
    need(sha(ns["safe_read"](node, 200*1024**2)) == manifest["nodeSha256"], "Installed Node differs")
    check = engine["REPO"] / LIVE_CHECK
    need(check.read_bytes() == engine["git"]("show", args.commit + ":" + LIVE_CHECK), "Changed public Log acceptance")
    result = subprocess.run([str(node), str(check)], cwd=engine["REPO"], user="powadmin", group="powadmin",
                            extra_groups=[], env={"PATH": "/usr/bin:/bin", "POW_API_BASE": "http://127.0.0.1:8081"},
                            capture_output=True, timeout=180)
    need(result.returncode == 0, "Confirmed Mail / public Log postflight failed: " + result.stderr[-800:].decode(errors="replace"))
    witness = json.loads(result.stdout)
    need(witness.get("ok") is True and witness.get("snapshotId") == start["snapshotId"] and
         healthy() == start, "Canonical observation changed during postflight; repeat the read")
    return {"ok": True, "sourceCommit": args.commit, "manifestSha256": args.manifest_sha256, "checkpoint": start,
            "log": witness, "hintCount": len(ids), "anonymousHintReadDenied": True}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    commands = p.add_subparsers(dest="mode", required=True)
    plan = commands.add_parser("plan"); plan.add_argument("commit"); plan.add_argument("output", type=Path)
    for mode in ("rehearse", "apply"):
        sub = commands.add_parser(mode); sub.add_argument("commit"); sub.add_argument("plan", type=Path); sub.add_argument("sha256")
    for mode in ("postflight", "archive"):
        sub = commands.add_parser(mode); sub.add_argument("commit")
        sub.add_argument("receipt_dir", type=Path); sub.add_argument("manifest_sha256")
    args = p.parse_args()
    need(os.geteuid() == 0 and sys.flags.isolated and not sys.flags.optimize and
         engine["RUNTIME"].resolve(strict=True) == engine["RUNTIME"] != engine["REPO"],
         "Require isolated root Python in separate committed checkout on NODE")
    os.umask(0o077)
    engine["source_fence"](args.commit)
    for file in (Path(__file__).resolve(), HERE / "profile.py", HERE / "proof.mjs", PREVIOUS):
        need(file.read_bytes() == engine["git"]("show", args.commit + ":" + str(file.relative_to(engine["REPO"]))),
             "Release tooling differs from committed source: " + file.name)
    archival = engine["namespace"](engine["pinned"]("monitoring-reconciliation/runtime_archive.py"))
    archival["read"](COMPLETION, COMPLETION_SHA)
    if args.mode == "plan":
        print(json.dumps({"healthyPredecessor": healthy()}), flush=True)
        engine["build_plan"](args)
    elif args.mode in ("rehearse", "apply"):
        proof = rehearse(args)
        path = args.plan.with_name(args.plan.name + "." + args.mode + ".json")
        engine["private_path"](path)
        data = (json.dumps(proof, sort_keys=True) + "\n").encode()
        lab["save"](path, data)
        print(json.dumps({**proof, "proofPath": str(path), "proofSha256": sha(data)}), flush=True)
        if args.mode == "apply":
            engine["apply_plan"](args)
    else:
        print(json.dumps({"postflight": live_postflight(args)}), flush=True)
        if args.mode == "archive":
            args.previous_completion, args.previous_completion_sha256 = COMPLETION, COMPLETION_SHA
            engine["archive"](args)


if __name__ == "__main__":
    main()
