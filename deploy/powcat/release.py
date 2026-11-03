#!/usr/bin/python3 -I
"""Plan, apply, and accept a three-file powcat overlay on the node VPS."""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[2]
RUNTIME = Path("/opt/proofofwork-api")
PINS = {
    "amo-browse/scoped-node.py": "91b297647783207634b9795b367211c970a57170c1ef77694160d48236d1c6cd",
    "amo-browse/capture-node.py": "f114888325504e04831c7e893a02199020ccfd3d04f52fc6a741d4a8dcdb5f8c",
    "amo-browse/rollout-node.py": "1eb390ed2456d8ea27b56c4fe7e31b1fe73d18ad0afe80f5f0033675d7ab4a58",
    "monitoring-reconciliation/runtime_archive.py": "2e7891128c4808a034999cebedb367a7357ecbf13bd79528f5e9bb4968e129a6",
    "search/hold-node-timer.py": "3c89d0b5c14a01e8a5b1fe1df329f52bcf9b7a256ef0a0015830f0a92717b8c0",
}
sha = lambda data: hashlib.sha256(data).hexdigest()
encode64 = lambda data: base64.b64encode(data).decode()


def need(value, message):
    if not value:
        raise ValueError(message)


def pinned(path):
    raw = (REPO / "deploy" / path).read_bytes()
    need(sha(raw) == PINS[path], "Changed historical controller " + path)
    return raw


def namespace(raw):
    result = {"__name__": "_powcat_controller"}
    exec(compile(raw, "<committed-powcat-controller>", "exec"), result)
    return result


def controller():
    original = pinned("amo-browse/scoped-node.py")
    body, guard = original.rsplit(b"\nif __name__ == '__main__': main()", 1)
    need(not guard.strip(), "Unexpected historical controller footer")
    prefix = b"backup = BACKUPS/('amo-browse-'"
    need(body.count(prefix) == 1, "Unexpected backup location")
    body = body.replace(prefix, b"backup = BACKUPS/('powcat-'")
    profile = (REPO / "deploy/powcat/overlay.py").read_bytes()
    return body + b"\n" + profile + b"\nif __name__ == '__main__': main()\n"


def git(*args):
    return subprocess.check_output(["/usr/bin/git", "-c", f"safe.directory={REPO}", "-C", str(REPO), *args])


def source_fence(commit):
    need(re.fullmatch(r"[0-9a-f]{40}", commit) and git("rev-parse", "HEAD").decode().strip() == commit,
         "Require exact committed candidate checkout")
    need(not git("status", "--porcelain", "--untracked-files=all"), "Candidate checkout is dirty")
    for name in ["powcat/release.py", "powcat/overlay.py", *PINS]:
        need((REPO / "deploy" / name).read_bytes() == git("show", f"{commit}:deploy/{name}"),
             "Tool differs from committed source")


def private_path(path):
    need(path.is_absolute() and path.parent == Path("/tmp") and not os.path.lexists(path),
         "Use a new direct private VPS /tmp plan file")


def build_plan(args):
    private_path(args.output)
    code = controller()
    ns = namespace(code)
    git("merge-base", "--is-ancestor", ns["BASE_SOURCE_COMMIT"], args.commit)
    # Check the entire accepted live tree before capturing its exact active
    # source and metadata. No full runtime capture is written to disk.
    archival = namespace(pinned("monitoring-reconciliation/runtime_archive.py"))
    need(archival["load_verifier"]()()["ok"] is True, "Unhealthy accepted node source")
    captured = namespace(pinned("amo-browse/capture-node.py"))["capture"](code)
    need(captured["baselineHead"] == ns["BASELINE_HEAD"], "Runtime Git baseline changed")
    sources = captured["sources"]
    api = "server/proof-api.mjs"
    need(sources[api]["sha256"] == ns["API_SHA"] and not ns["NEW"].intersection(sources), "Changed runtime files")
    rows, metadata, candidates = [], {}, {}
    with tempfile.TemporaryDirectory(dir="/tmp", prefix="powcat-merge-") as scratch:
        p = Path(scratch)
        for name in sorted(ns["NEW"]) + [api]:
            candidate = git("show", f"{args.commit}:{name}")
            before = None
            if name == api:
                before = ns["API_SHA"]
                for label, data in [("active", base64.b64decode(sources[api]["base64"], validate=True)),
                                    ("base", git("show", ns["BASE_SOURCE_COMMIT"] + ":" + api)),
                                    ("candidate", candidate)]:
                    ns["durable"](p / label, data)
                candidate = subprocess.check_output(["git", "merge-file", "--stdout", "--diff3",
                                                      p / "active", p / "base", p / "candidate"])
            subprocess.run([captured["nodePath"], "--input-type=module", "--check"], input=candidate, check=True)
            rows.append({"path": name, "before": before, "after": sha(candidate), "base64": encode64(candidate)})
            candidates[name] = candidate
            metadata[name] = {key: sources[api][key] for key in ("uid", "gid", "mode")}
    release_id = args.commit[:12] + "-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    manifest = {"format": ns["FAMILY"], "sourceCommit": args.commit, "releaseId": release_id,
                "baseSourceCommit": ns["BASE_SOURCE_COMMIT"], "baselineHead": ns["BASELINE_HEAD"],
                "acceptedInventorySha256": ns["ACCEPTED_SHA"], "sources": rows, "sourceMetadata": metadata,
                "dependencies": {name: row["sha256"] for name, row in sources.items()},
                "services": list(ns["UNITS"]), "nodeSha256": captured["nodeSha256"],
                "gateway": captured["gateway"], "protectedServices": captured["protectedServices"],
                "searchHold": {"markerSha256": "0"*64, "bindings": {"releaseId": release_id, "attempt": "initial",
                                                                   "files": captured["searchFiles"]}}}
    ns["validate_manifest"](manifest)
    ns["fence"](RUNTIME, manifest, candidates)
    ns["metadata_fence"](RUNTIME, metadata)
    holder = pinned("search/hold-node-timer.py")
    plan = {"format": "powcat-rollout-v1", "releaseId": release_id, "sourceCommit": args.commit,
            "runtimeManifestTemplate": manifest, "controllerSha256": sha(code), "controllerBase64": encode64(code),
            "searchHoldControllerSha256": sha(holder), "searchHoldControllerBase64": encode64(holder)}
    raw = json.dumps(plan, sort_keys=True, separators=(",", ":")).encode()
    ns["durable"](args.output, raw)
    print(json.dumps({"plan": str(args.output), "sha256": sha(raw), "releaseId": release_id,
                      "sources": [{k: v for k, v in row.items() if k != "base64"} for row in rows]}), flush=True)


def apply_plan(args):
    archival = namespace(pinned("monitoring-reconciliation/runtime_archive.py"))
    raw = archival["read"](args.plan, args.sha256)
    plan = json.loads(raw)
    code = controller()
    holder = pinned("search/hold-node-timer.py")
    need(plan["format"] == "powcat-rollout-v1" and plan["sourceCommit"] == args.commit
         and base64.b64decode(plan["controllerBase64"], validate=True) == code and plan["controllerSha256"] == sha(code)
         and base64.b64decode(plan["searchHoldControllerBase64"], validate=True) == holder
         and plan["searchHoldControllerSha256"] == sha(holder), "Wrong reviewed rollout plan")
    ns = namespace(code)
    ns["validate_manifest"](plan["runtimeManifestTemplate"])
    # The historical supervisor accepts one envelope type. It independently
    # validates the actual nested powcat manifest through the bound controller.
    supervisor = namespace(pinned("amo-browse/rollout-node.py"))
    supervisor["rollout"]({**plan, "format": "proof-of-work-amo-browse-rollout-plan-v1"})


def archive(args):
    ns = namespace(controller())
    engine = namespace(pinned("monitoring-reconciliation/runtime_archive.py"))
    receipt_raw = engine["read"](args.receipt_dir / "manifest.json", args.manifest_sha256)
    manifest = json.loads(receipt_raw)
    ns["validate_manifest"](manifest)
    need(manifest["sourceCommit"] == args.commit, "Wrong completed source commit")
    engine["read"](engine["ACCEPTED"], ns["ACCEPTED_SHA"])
    engine["SOURCE_SCOPES"] = {ns["FAMILY"]: (ns["ALLOWED"], ns["NEW"])}
    sys.argv[1:] = ["--receipt-dir", str(args.receipt_dir), "--manifest-sha256", args.manifest_sha256,
                    "--source-commit", args.commit, "--previous-completion", str(args.previous_completion),
                    "--previous-completion-sha256", args.previous_completion_sha256, "--create-and-retain-latest"]
    engine["main"]()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(required=True)
    p = subs.add_parser("plan")
    p.add_argument("commit"); p.add_argument("output", type=Path); p.set_defaults(run=build_plan)
    p = subs.add_parser("apply")
    p.add_argument("commit"); p.add_argument("plan", type=Path); p.add_argument("sha256"); p.set_defaults(run=apply_plan)
    p = subs.add_parser("archive")
    p.add_argument("commit"); p.add_argument("receipt_dir", type=Path); p.add_argument("manifest_sha256")
    p.add_argument("previous_completion", type=Path); p.add_argument("previous_completion_sha256"); p.set_defaults(run=archive)
    args = parser.parse_args()
    need(os.geteuid() == 0 and sys.flags.isolated and RUNTIME.resolve(strict=True) == RUNTIME
         and RUNTIME != REPO, "Require isolated root invocation on the node VPS from separate source")
    os.umask(0o077)
    source_fence(args.commit)
    args.run(args)


if __name__ == "__main__":
    main()
