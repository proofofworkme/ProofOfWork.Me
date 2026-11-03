#!/usr/bin/python3 -I
"""Node-only API repair using the existing powcat overlay, rehearsal sandbox and retention controllers."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
DEPLOY = HERE.parent
PLAN_ENGINE = DEPLOY / "powcat/release.py"
LAB_ENGINE = DEPLOY / "work-batch-reader-recovery/rehearsal.py"


def require(ok, error):
    if not ok:
        raise ValueError(error)


def load(path, digest):
    source = path.read_bytes()
    require(hashlib.sha256(source).hexdigest() == digest, "Changed controller " + path.name)
    context = {"__name__": "_summary_preview_controller", "__file__": str(path)}
    exec(compile(source, str(path), "exec"), context)
    return context


engine = load(PLAN_ENGINE, "bff08af2cf46467ec633f744674052678bd69931c6c485dd15b3efba03d86a96")
lab = load(LAB_ENGINE, "5e018ea150ca59c8db40d466a42729d17ed44297663f157f56a777fe89c73f4f")
original_controller = engine["controller"]
sha = engine["sha"]


def controller():
    code = original_controller()
    prefix, footer = code.rsplit(b"\nif __name__ == '__main__': main()", 1)
    require(not footer.strip(), "Unexpected overlay controller footer")
    prefix = prefix.replace(b"backup = BACKUPS/('powcat-'", b"backup = BACKUPS/('summary-preview-'")
    return prefix + b"\n" + (HERE / "profile.py").read_bytes() + b"\nif __name__ == '__main__': main()\n"


engine["controller"] = controller


def health():
    try:
        result = urllib.request.urlopen("http://127.0.0.1:8081/health", timeout=30)
    except urllib.error.HTTPError as error:
        require(error.code == 503, "Unexpected health response")
        result = error
    with result:
        return json.loads(result.read(1024 * 1024))


def capture_incident():
    state = health()
    checks = state["checks"]
    index, node = checks["index"], checks["node"]
    summary = index["summarySnapshot"]
    require(node["ok"] is True and index["complete"] is True and index["checkpointCanonical"] is True and
            re.fullmatch("[a-f0-9]{64}", index["checkpointHash"]) and
            index["checkpointHash"] == index["canonicalCheckpointHash"] and
            index["indexedThroughBlock"] <= node["tipHeight"] and
            summary["eligible"] is True and summary["ok"] is False and
            summary["snapshotId"] == "b2ed28726418ad3de236dc28" and
            summary["indexedThroughBlock"] == 974402 < index["indexedThroughBlock"],
            "Current scan or last-good publication differs from incident")
    pattern = r"Canonical summary snapshot is ([0-9]+) bytes; the storage budget is 20971520 bytes"
    logs = subprocess.check_output(["journalctl", "-b", "-u", "proofofwork-indexer-worker.service",
                                    "--since=-4 hours", "--no-pager", "-n", "1", "-o", "cat",
                                    "--grep", "Canonical summary snapshot is"], text=True, timeout=20)
    match = re.search(pattern, logs)
    require(match and int(match[1]) > 20971520, "Current publication budget error is unverified")
    return {"tipHeight": node["tipHeight"], "tipHash": node["bestBlockHash"],
            "scanHeight": index["indexedThroughBlock"], "scanHash": index["checkpointHash"],
            "lastGoodSnapshot": summary["snapshotId"], "lastGoodHeight": summary["indexedThroughBlock"],
            "rejectedCompactBytes": int(match[1]), "compactLimit": 20971520}


def require_recovered():
    state = health()
    index = state["checks"]["index"]
    summary = index["summarySnapshot"]
    node = state["checks"]["node"]
    height, digest = node["tipHeight"], node["bestBlockHash"]
    keys = {"growthSummary", "inceptionSummary", "infinitySummary", "logSummary",
            "marketplaceSummary", "tokenSummary", "workFloor", "workSummary"}
    require(state["ok"] is True and state["ready"] is True and node["ok"] is True and
            index["complete"] is True and index["checkpointCanonical"] is True and
            height == index["indexedThroughBlock"] == summary["indexedThroughBlock"] and
            digest == index["canonicalCheckpointHash"] == index["checkpointHash"] == summary["blockHash"] and
            summary["ok"] is True and summary["eligible"] is True and
            all(summary["coverageByKey"].get(key) == height for key in keys),
            "Exact-tip publication has not recovered")


def bound_plan(args):
    archive = engine["namespace"](engine["pinned"]("monitoring-reconciliation/runtime_archive.py"))
    plan = json.loads(archive["read"](args.plan, args.sha256))
    code = controller()
    require(plan["sourceCommit"] == args.commit and plan["controllerSha256"] == sha(code),
            "Wrong plan or candidate identity")
    ns = engine["namespace"](code)
    manifest = plan["runtimeManifestTemplate"]
    candidates = ns["validate_manifest"](manifest)
    require(manifest["sourceCommit"] == args.commit and manifest["releaseId"] == plan["releaseId"],
            "Wrong manifest binding")
    ns["fence"](ns["ROOT"], manifest, candidates)
    ns["metadata_fence"](ns["ROOT"], manifest["sourceMetadata"])
    return ns, manifest, candidates


def rehearse(args):
    """Run the real candidate bundle under read-only PostgreSQL, guarded RPC and read-only bind mounts."""
    ns, manifest, candidates = bound_plan(args)
    root = ns["ROOT"]
    evidence = capture_incident()
    node = Path(os.readlink("/proc/" + manifest["protectedServices"]["states"][ns["UNITS"][0]]["MainPID"] + "/exe"))
    require(node.is_absolute() and sha(ns["safe_read"](node, 200 * 1024**2)) == manifest["nodeSha256"],
            "Runtime Node changed")
    tail = (HERE / "proof.mjs").read_bytes()
    adapter = lab["transform_api"](candidates[lab["API"]])
    require(adapter.endswith(lab["TAIL"].encode()), "Unexpected rehearsal startup transform")
    with tempfile.TemporaryDirectory(prefix="summary-preview-", dir="/tmp") as work:
        out = Path(work)
        for key, data in [
            ("api", adapter[:-len(lab["TAIL"].encode())] + tail),
            ("worker", lab["transform_worker"](ns["safe_read"](root / lab["WORKER"]))
             + b"\nexport {assertCanonicalSummarySnapshotStorageBudget, canonicalSummarySnapshotPayload, "
               b"exactWorkQ16CanonicalSummaryState, publicLogRelationalFingerprint, summarySnapshotTotals};\n"),
            ("postgres", lab["transform_postgres"](ns["safe_read"](root / lab["POSTGRES"]))),
            ("reader", ns["safe_read"](root / lab["READER"])),
        ]:
            lab["save"](out / (key + ".mjs"), data, 0o644)
        props = {key: ns["ctl"]("show", ns["UNITS"][0], "--value", "-p", key)
                 for key in ("Environment", "PassEnvironment", "UnsetEnvironment")}
        files = lab["environment_files"](ns["ctl"]("show", ns["UNITS"][0], "--value", "-p", "EnvironmentFiles"))
        cmd = lab["command"]({"runtimeManifestTemplate": manifest, "nodePath": str(node)}, out, props, files)
        cmd[1:2] = ["--wait", "--collect", "--quiet"]
        cmd[cmd.index("--property=RemainAfterExit=yes")] = "--property=RemainAfterExit=no"
        # Run once synchronously. Never print inherited service environment values.
        try:
            run = subprocess.run(cmd, capture_output=True, timeout=350)
        except subprocess.TimeoutExpired:
            raise ValueError("Read-only rehearsal exceeded its native time limit") from None
        if run.returncode:
            for stream in ("stderr", "stdout"):
                if (out / stream).is_file():
                    print((out / stream).read_text(errors="replace")[-1600:], file=sys.stderr)
            raise ValueError("Read-only bundle rehearsal failed")
        records = [json.loads(line) for line in (out / "stdout").read_text().splitlines()
                   if line.startswith('{"format":"summary-preview-rehearsal-v1"')]
        require(len(records) == 1 and records[0]["ok"] is True and records[0]["published"] is False,
                "Missing terminal rehearsal proof")
    ns["fence"](root, manifest, candidates)
    return {"planSha256": args.sha256, "sourceCommit": args.commit, "incident": evidence,
            "candidateSha256": manifest["sources"][0]["after"], "rehearsal": records[0]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    p = sub.add_parser("plan"); p.add_argument("commit"); p.add_argument("output", type=Path)
    for operation in ("rehearse", "apply"):
        p = sub.add_parser(operation); p.add_argument("commit")
        p.add_argument("plan", type=Path); p.add_argument("sha256")
    p = sub.add_parser("archive"); p.add_argument("commit"); p.add_argument("receipt_dir", type=Path)
    p.add_argument("manifest_sha256"); p.add_argument("previous_completion", type=Path)
    p.add_argument("previous_completion_sha256")
    args = parser.parse_args()
    require(os.geteuid() == 0 and sys.flags.isolated and engine["RUNTIME"].resolve(strict=True) == engine["RUNTIME"]
            and engine["RUNTIME"] != engine["REPO"], "Use isolated root Python on node VPS in clean release checkout")
    os.umask(0o077)
    engine["source_fence"](args.commit)
    for path in (Path(__file__).resolve(), HERE / "profile.py", HERE / "proof.mjs", PLAN_ENGINE, LAB_ENGINE):
        require(path.read_bytes() == engine["git"]("show", args.commit + ":" + str(path.relative_to(engine["REPO"]))),
                "Changed committed release helper")
    if args.mode == "plan":
        print(json.dumps({"incident": capture_incident()}), flush=True)
        engine["build_plan"](args)
    elif args.mode in ("rehearse", "apply"):
        proof = rehearse(args)
        receipt = args.plan.with_name(args.plan.name + "." + args.mode + ".json")
        engine["private_path"](receipt)
        raw = (json.dumps(proof, sort_keys=True) + "\n").encode()
        lab["save"](receipt, raw)
        print(json.dumps({**proof, "proofPath": str(receipt), "proofSha256": sha(raw)}), flush=True)
        if args.mode == "apply":
            engine["apply_plan"](args)
    else:
        require_recovered()
        engine["archive"](args)


if __name__ == "__main__":
    main()
