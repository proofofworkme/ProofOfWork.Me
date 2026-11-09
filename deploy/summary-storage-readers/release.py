#!/usr/bin/python3 -I
"""Plan, migrate, rehearse, install and verify the canonical summary and product reader release."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request

HERE = Path(__file__).resolve().parent
PRECEDING = HERE.parent / "pending-discovery/release.py"
PRECEDING_SHA = "27b70a5817b0388f7daf8bcc6a7e678cf0d00eeb7a30284c725c8a2a1f2c8986"
raw = PRECEDING.read_bytes()
if hashlib.sha256(raw).hexdigest() != PRECEDING_SHA:
    raise ValueError("Changed accepted predecessor release engine")
pending = {"__name__":"_accepted_pending", "__file__":str(PRECEDING)}
exec(compile(raw,str(PRECEDING),"exec"), pending)
previous, engine, lab = pending["previous"], pending["engine"], pending["lab"]
need, sha = pending["need"], pending["sha"]
COMPLETION = Path("/data/proofofwork-release-backups/runtime-latest-ac0d4373a091-20261103T173738Z/completion.json")
COMPLETION_SHA = "4c82a1bfad023872bdafbcb9b03241da4158c520f19ebf5042e83f1141cbd18e"
EMERGENCY = Path("/data/proofofwork-summary-budget-evidence-20261109T014445Z")
RECEIPTS = {"preflight.json":"acbe6a221d146aa8c07073efe0d192a86889048589ba00f0dc8978dd5ee0961e",
            "applied.json":"3db4273ae5593a374e41dc4e7432c86f54c2a566c608a077a6647d20286e8493",
            "postflight.json":"404dff0be634466ce2513186f68c75530f4e0bc07133eb0dd508d37a0e5c909e"}
DROP_INS = {"zzzz-h7-canonical-summary-budget.conf":"194c345e5647de4a95cfd2a1820b1f7700c8e47e81b6f95f06bc3c68bed36cd7",
            "zzzzzz-canonical-summary-budget.conf":"6659a36b5fedce6cba80eff47c2c95240fa9a1a63234075d7ae4ab673700614e"}
BUDGET = {b"POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_MAX_BYTES":b"33554432",
          b"POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_SQL_TEXT_MAX_BYTES":b"37748736"}
LIVE_CHECK = "scripts/check-work-storage-readers-live.mjs"
SUITES = ("server/canonical-summary-stream.test.mjs","server/candidate-discovery-reorg.test.mjs","server/db/work-transfer-projection-store.test.mjs",
          "server/db/permission-reader.test.mjs", "server/permission-verification-store.test.mjs")
schema = {"__name__":"_qualified_schema","need":need,"sha":sha}
exec(compile((HERE/"schema.py").read_bytes(),str(HERE/"schema.py"),"exec"),schema)


def controller():
    code = previous["original_controller"]()
    body, footer = code.rsplit(b"\nif __name__ == '__main__': main()",1)
    prefix = b"backup = BACKUPS/('powcat-'"
    need(not footer.strip() and body.count(prefix)==1,"Unexpected pinned overlay controller")
    return body.replace(prefix,b"backup = BACKUPS/('summary-storage-readers-'") + b"\n" + (HERE/"profile.py").read_bytes() + b"\nif __name__ == '__main__': main()\n"


previous["controller"] = engine["controller"] = controller
pending["HERE"] = HERE
pending["SUITES"] = SUITES


def emergency():
    archival = engine["namespace"](engine["pinned"]("monitoring-reconciliation/runtime_archive.py"))
    for name, digest in RECEIPTS.items():
        archival["read"](EMERGENCY / name, digest)
    for service in ("proofofwork-api","proofofwork-indexer-worker"):
        unit = service + ".service"
        for name, digest in DROP_INS.items():
            path = Path("/etc/systemd/system") / (unit + ".d") / name
            need(sha(path.read_bytes()) == digest, "Accepted service budget drop-in differs")
        pid = subprocess.check_output(["systemctl","show",unit,"--property=MainPID","--value"],text=True,timeout=8).strip()
        need(pid.isdigit() and int(pid)>1,"Inactive service " + unit)
        env = dict(row.split(b"=",1) for row in (Path("/proc")/pid/"environ").read_bytes().split(b"\0") if b"=" in row)
        need(all(env.get(k)==v for k,v in BUDGET.items()),"Running service lacks accepted emergency limits")
    return {"nativeReceipts":RECEIPTS,"serviceDropIns":DROP_INS,"compactBytes":33554432,"sqlBytes":37748736}


def committed(name, commit):
    data = engine["git"]("show", commit + ":" + name)
    need((engine["REPO"]/name).read_bytes() == data, "Changed committed file " + name)
    return data


def sandbox_proof(ns, manifest, candidates, node, permission=False):
    with tempfile.TemporaryDirectory(prefix="summary-storage-readers-",dir="/tmp") as temp:
        out = Path(temp)
        mounts = pending["stage_sources"](out,ns,manifest,candidates)
        worker = out/"worker.mjs"
        worker.chmod(0o600)
        with worker.open("ab") as stream:
            stream.write(b"\nexport {assertCanonicalSummarySnapshotStorageBudget,canonicalSummarySnapshotPayload,"
                         b"exactWorkQ16CanonicalSummaryState,publicLogRelationalFingerprint,summarySnapshotTotals};\n")
        worker.chmod(0o644)
        props = {k:ns["ctl"]("show",ns["UNITS"][0],"--value","-p",k) for k in ("Environment","PassEnvironment","UnsetEnvironment")}
        files = lab["environment_files"](ns["ctl"]("show",ns["UNITS"][0],"--value","-p","EnvironmentFiles"))
        cmd = lab["command"]({"runtimeManifestTemplate":manifest,"nodePath":str(node)},out,props,files)
        binds = [v for v in cmd if v.startswith("--property=BindReadOnlyPaths=")]
        need(len(binds)==1,"Unexpected sandbox bindings")
        cmd[cmd.index(binds[0])] = "--property=BindReadOnlyPaths="+" ".join(mounts)
        cmd[1:2] = ["--wait","--collect","--quiet"]
        cmd[cmd.index("--property=RemainAfterExit=yes")] = "--property=RemainAfterExit=no"
        if permission:
            cmd.append("--rehearse-permission-journal")
        result = subprocess.run(cmd,capture_output=True,timeout=350)
        if result.returncode:
            reason = (out/"stderr").read_text(errors="replace")[-1000:] if (out/"stderr").is_file() else ""
            raise ValueError("Read-only native rehearsal failed: " + reason)
        rows = [json.loads(line) for line in (out/"stdout").read_text().splitlines() if line.startswith("{")]
        if permission:
            hits = [row for row in rows if row.get("published") is False and row.get("sourceCount")==142]
            need(len(hits)==1 and hits[0].get("replayed")==142 and hits[0].get("descriptorChanges")==5 and
                 hits[0].get("retainedThrough")==973103 and hits[0].get("through")==973245 and hits[0].get("suffixCarriers")==0 and
                 hits[0].get("predecessorSha256")=="52410665528e3cad3217aff51fad76cd77192b6a5140706ac23d7561d888ebda" and
                 hits[0].get("witnessSha256")=="12ba37f1f4e7972e60e3039069322acb4863c0af7cc8a87155b3070b72f2f5ab" and
                 hits[0].get("indexWitnessSha256")=="906ea74f10d59bc79bcbbd7f53ac79865bdf59e466003ea06fa5dc7b8562fd5d",
                 "Missing exact real Permission suffix proof")
            report=hits[0]
            evidence={key:value for key,value in report.items() if key not in ("published","evidenceSha256")}
            need(sha(json.dumps(evidence,separators=(",",":"),ensure_ascii=False).encode())==report["evidenceSha256"],
                 "Permission checkpoint-bound evidence digest differs")
        else:
            hits = [row for row in rows if row.get("format")=="summary-storage-readers-rehearsal-v1"]
            need(len(hits)==1 and hits[0]["ok"] and hits[0]["published"] is False and len(hits[0]["families"])==4,
                 "Missing exact summary and product recovery proof")
        return hits[0]


def rehearse(args):
    ns, manifest, candidates = previous["bound_plan"](args)
    start = pending["healthy"]()
    physical = schema["storage_state"]()
    need(physical["exists"],"Run the separately qualified schema migration before the source rehearsal")
    pid = manifest["protectedServices"]["states"][ns["UNITS"][0]]["MainPID"]
    node = Path(os.readlink("/proc/"+pid+"/exe"))
    need(sha(ns["safe_read"](node,200*1024**2)) == manifest["nodeSha256"],"Changed native Node runtime")
    offline = pending["offline_suites"](node)
    summary = sandbox_proof(ns,manifest,candidates,node)
    permission = sandbox_proof(ns,manifest,candidates,node,permission=True)
    need(permission["checkpoint"] == {"height":start["height"],"blockHash":start["hash"]},
         "Permission and summary rehearsals used different canonical checkpoints")
    ns["fence"](ns["ROOT"],manifest,candidates)
    closing = pending["healthy"]()
    need((summary["height"],summary["hash"]) == (start["height"],start["hash"]) == (closing["height"],closing["hash"]),
         "Tip moved during rehearsal; repeat against a stable checkpoint")
    return {"planSha256":args.sha256,"sourceCommit":args.commit,"releaseId":manifest["releaseId"],"predecessor":start,
            "candidateHashes":{k:sha(v) for k,v in candidates.items()},"offline":offline,"summary":summary,"permission":permission,
            "schema":physical,"emergency":emergency()}


def installed(args):
    ns = engine["namespace"](controller())
    archival = engine["namespace"](engine["pinned"]("monitoring-reconciliation/runtime_archive.py"))
    need(args.receipt_dir.parent == archival["BASE"] and args.receipt_dir.resolve(strict=True) == args.receipt_dir,
         "Require exact VPS release receipt directory")
    manifest = json.loads(archival["read"](args.receipt_dir/"manifest.json",args.manifest_sha256))
    candidates = ns["validate_manifest"](manifest)
    receipt = json.loads(archival["read"](args.receipt_dir/"receipt.json"))
    need(manifest["sourceCommit"] == args.commit == receipt["sourceCommit"] and receipt.get("installed") is True and
         receipt.get("rolledBack") is False and receipt["manifestSha256"] == args.manifest_sha256 and receipt.get("completedAt") and
         all(sha(ns["safe_read"](ns["ROOT"]/name)) == sha(raw) for name,raw in candidates.items()),"Installed source receipt differs")
    pid = ns["ctl"]("show",ns["UNITS"][0],"--value","-p","MainPID")
    node = Path(os.readlink("/proc/"+pid+"/exe"))
    need(sha(ns["safe_read"](node,200*1024**2)) == manifest["nodeSha256"],"Installed Node differs")
    return manifest, node


def catch_up(args):
    manifest,node = installed(args)
    emergency()
    pid = subprocess.check_output(["systemctl","show","proofofwork-indexer-worker","-p","MainPID","--value"],text=True,timeout=8).strip()
    source = (Path("/proc")/pid/"environ").read_bytes().split(b"\0")
    keys = {"BITCOIN_RPC_URL","BITCOIN_RPC_USER","BITCOIN_RPC_PASSWORD","POW_INDEX_DATABASE_URL","PROOF_INDEX_DATABASE_URL","DATABASE_URL"}
    env = {k:v for k,v in (row.decode().split("=",1) for row in source if b"=" in row) if k in keys}
    env.update(PATH="/usr/bin:/bin",POW_INDEX_CODE_BOOTSTRAP_MAX_BLOCKS="16",POW_INDEX_JOBS_BOOTSTRAP_MAX_BLOCKS="16",
               POW_INDEX_DB_APP_NAME="summary-storage-readers-recovery")
    source_path = engine["RUNTIME"]/"scripts/backfill-proof-indexer.mjs"
    need(sha(source_path.read_bytes()) == next(r["after"] for r in manifest["sources"] if r["path"]=="scripts/backfill-proof-indexer.mjs"),
         "Installed worker changed before recovery")
    steps = {}
    for product in ("code","jobs"):
        key=product+":candidate-discovery"
        query="SELECT value FROM proof_indexer.meta WHERE key='"+key+"'"
        def read_marker():
            marker=schema["select"](query)
            if marker.get("recoveryEvidenceKey"):
                need(marker["recoveryEvidenceKey"].startswith(key+":reorg:") and not marker.get("blockedCandidates"),
                     "Product recovery has unresolved evidence")
            return marker
        for attempt in range(64):
            marker=read_marker()
            point=pending["healthy"]()
            if (marker["complete"] and marker["indexedThroughBlock"]==point["height"] and
                    marker["indexedThroughBlockHash"]==point["hash"] and marker.get("recoveryEvidenceKey")):
                steps[product]={"passes":attempt,"height":point["height"],"hash":point["hash"],"evidenceKey":marker["recoveryEvidenceKey"]}
                break
            need(marker.get("recoveryEvidenceKey") or (marker["indexedThroughBlock"]==974400 and
                 marker["indexedThroughBlockHash"]=="000000000000000000005c1f917e558adf7d182c64a5f397241bbae68829be6c"),
                 "Refusing unrelated product recovery")
            proc=subprocess.run([str(node),str(source_path),"--bootstrap-"+product+"-candidates","--recover-discovery-reorg"],
                user="powadmin",group="powadmin",extra_groups=[],cwd=engine["RUNTIME"],env=env,capture_output=True,timeout=75)
            if proc.returncode:
                if b"discovery bootstrap is active" in proc.stderr:
                    import time
                    time.sleep(1)
                    continue
                raise ValueError("Product recovery refused: "+proc.stderr[-700:].decode(errors="replace"))
            report=json.loads(proc.stdout)[product+"Discovery"]
            need(report.get("recoveryEvidenceKey") and not report.get("blockedCandidates") and report.get("scannedBlocks",0)<=16,
                 "Invalid supervised product batch result")
        else:
            raise ValueError("Bounded "+product+" catch-up requires another qualified pass")
    return steps


def live_postflight(args):
    manifest,node = installed(args)
    before = pending["healthy"]()
    committed(LIVE_CHECK,args.commit)
    check = subprocess.run([str(node),str(engine["REPO"]/LIVE_CHECK)],cwd=engine["REPO"],user="powadmin",group="powadmin",
        extra_groups=[],env={"PATH":"/usr/bin:/bin","POW_API_BASE":"http://127.0.0.1:8081"},capture_output=True,timeout=240)
    need(check.returncode==0,"Combined live check failed: "+check.stderr.decode(errors="replace")[-900:])
    check_result = json.loads(check.stdout)
    need(check_result.get("ok") is True,"Missing successful real combined reader response")
    after = pending["healthy"]()
    need(before == after,"Checkpoint changed; repeat the public read-only postflight")
    schema_state=schema["storage_state"]()
    need(schema_state["exists"],"Missing physical projection page catalog")
    return {"sourceCommit":manifest["sourceCommit"],"manifestSha256":args.manifest_sha256,"checkpoint":after,
            "schema":schema_state,"emergency":emergency(),"public":check_result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode",required=True)
    p = sub.add_parser("plan"); p.add_argument("commit"); p.add_argument("output",type=Path)
    for mode in ("migrate","rehearse","apply"):
        p=sub.add_parser(mode); p.add_argument("commit"); p.add_argument("plan",type=Path); p.add_argument("sha256")
    for mode in ("catch-up","postflight","archive"):
        p=sub.add_parser(mode); p.add_argument("commit"); p.add_argument("receipt_dir",type=Path); p.add_argument("manifest_sha256")
    args=parser.parse_args()
    need(os.geteuid()==0 and sys.flags.isolated and not sys.flags.optimize and engine["RUNTIME"].resolve(strict=True)==engine["RUNTIME"]!=engine["REPO"],
         "Require isolated root Python in a separate committed node checkout")
    os.umask(0o077)
    engine["source_fence"](args.commit)
    for file in (Path(__file__).resolve(),HERE/"profile.py",HERE/"schema.py",HERE/"proof.mjs",PRECEDING):
        committed(str(file.relative_to(engine["REPO"])),args.commit)
    ddl=committed(schema["MIGRATION"],args.commit)
    need(sha(ddl)==schema["MIGRATION_SHA"],"Unreviewed migration bytes")
    archival=engine["namespace"](engine["pinned"]("monitoring-reconciliation/runtime_archive.py"))
    archival["read"](COMPLETION,COMPLETION_SHA)
    if args.mode=="plan":
        print(json.dumps({"predecessor":pending["healthy"](),"schema":schema["storage_state"](),"emergency":emergency()}),flush=True)
        engine["build_plan"](args)
    elif args.mode=="migrate":
        previous["bound_plan"](args); emergency()
        print(json.dumps({"planSha256":args.sha256,"sourceCommit":args.commit,"migration":schema["migrate"](ddl)}),flush=True)
    elif args.mode in ("rehearse","apply"):
        proof=rehearse(args)
        path=args.plan.with_name(args.plan.name+"."+args.mode+"."+str(os.getpid())+".json")
        engine["private_path"](path); data=(json.dumps(proof,sort_keys=True)+"\n").encode(); lab["save"](path,data)
        print(json.dumps({"proofPath":str(path),"proofSha256":sha(data),"proof":proof}),flush=True)
        if args.mode=="apply":
            engine["apply_plan"](args)
    elif args.mode=="catch-up":
        print(json.dumps({"catchUp":catch_up(args)}),flush=True)
    else:
        print(json.dumps({"postflight":live_postflight(args)}),flush=True)
        if args.mode=="archive":
            args.previous_completion,args.previous_completion_sha256=COMPLETION,COMPLETION_SHA
            engine["archive"](args)


if __name__=="__main__":
    main()
