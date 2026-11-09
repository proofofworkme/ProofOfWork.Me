#!/usr/bin/python3 -I
"""Scoped successor to the accepted canonical storage/reader installation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
PRIOR_COMMIT = "42f99b237a386ff41e484012096eb458403405c7"
PRIOR = HERE.parent / "summary-storage-readers/release.py"
PRIOR_SHA = "81e8d1b3080a1871caec2e0ef634cf695bac860b2b8b98e3fb6872295d4a7a10"
PRIOR_DIR = "summary-storage-readers-42f99b237a38-20261109T022443Z-20261109T022938Z"
PRIOR_MANIFEST = "8a5139ccd80257bfe2155e109a3255a3b8527c4a4f16a864be1f85172427d597"
PRIOR_RECEIPT = "10c3dd02e7a75d90617731f9fb0d01ad7c8a0775a7f0ceffd4188904d1ddac69"
raw = PRIOR.read_bytes()
if hashlib.sha256(raw).hexdigest() != PRIOR_SHA:
    raise ValueError("Unreviewed predecessor controller")
prior = {"__name__":"_accepted_readers","__file__":str(PRIOR)}
exec(compile(raw,str(PRIOR),"exec"),prior)
engine, previous, pending = prior["engine"],prior["previous"],prior["pending"]
need,sha,lab = prior["need"],prior["sha"],prior["lab"]
SUITE = "server/canonical-summary-stream.test.mjs"


def controller():
    code=previous["original_controller"]()
    body,footer=code.rsplit(b"\nif __name__ == '__main__': main()",1)
    prefix=b"backup = BACKUPS/('powcat-'"
    need(not footer.strip() and body.count(prefix)==1,"Unexpected overlay controller")
    return body.replace(prefix,b"backup = BACKUPS/('summary-stream-length-'") + b"\n" + (HERE/"profile.py").read_bytes() + b"\nif __name__ == '__main__': main()\n"


engine["controller"]=previous["controller"]=prior["controller"]=controller
pending["SUITES"]=(SUITE,)


def predecessor(ns, installed=False):
    """Bind the live accepted inventory and the one completed archive to the actual 42f99 receipt."""
    archive=engine["namespace"](engine["pinned"]("monitoring-reconciliation/runtime_archive.py"))
    accepted=json.loads(archive["read"](archive["ACCEPTED"],ns["ACCEPTED_SHA"]))
    directory=archive["BASE"]/PRIOR_DIR
    manifest=json.loads(archive["read"](directory/"manifest.json",PRIOR_MANIFEST))
    receipt=json.loads(archive["read"](directory/"receipt.json",PRIOR_RECEIPT))
    old_profile=engine["namespace"](previous["original_controller"]().rsplit(b"\nif __name__ == '__main__': main()",1)[0] +
        b"\n" + engine["git"]("show", PRIOR_COMMIT+":deploy/summary-storage-readers/profile.py"))
    old_profile["validate_manifest"](manifest)
    archive["SOURCE_SCOPES"]={old_profile["FAMILY"]:(old_profile["ALLOWED"],old_profile["NEW"])}
    rows=archive["receipt_sources"](manifest,receipt,PRIOR_MANIFEST,PRIOR_COMMIT,directory,ns["BASELINE_HEAD"])
    by_path={entry["path"]:entry for entry in accepted["overlays"]}
    evidence=[{"path":str(directory/"manifest.json"),"sha256":PRIOR_MANIFEST},{"path":str(directory/"receipt.json"),"sha256":PRIOR_RECEIPT}]
    for name,row in rows.items():
        need(by_path[name]["sha256"] == row["after"] and by_path[name]["evidence"]==evidence,
             "Accepted source provenance differs for "+name)
        expected=ns["STREAM_AFTER"] if installed and name==ns["STREAM"] else row["after"]
        need(sha(ns["safe_read"](ns["ROOT"]/name)) == expected,"Unexpected physical runtime source "+name)
    completions=list(archive["BASE"].glob("runtime-latest-"+PRIOR_COMMIT[:12]+"-*/completion.json"))
    need(len(completions)==1,"Exactly one completed 42f99 release archive is required")
    path=completions[0]
    digest=sha(archive["read"](path))
    result=archive["previous_archive"](path,digest)
    acceptance=json.loads(archive["read"](path.parent/"source-acceptance.json"))
    need(result["sourceCommit"]==PRIOR_COMMIT and acceptance["sourceCommit"]==PRIOR_COMMIT and
         acceptance["manifest"]==str(directory/"manifest.json") and acceptance["beforeSha256"]==old_profile["ACCEPTED_SHA"] and
         acceptance["modifiedRuntimeSource"] is False,"Archive custody is not the verified 42f99 acceptance")
    held=json.loads(archive["read"](Path("/etc/proofofwork-retention/audit28-held-review.json"),
        "c3bd35740d7fcc135839274c8228e38f7a45c23e33567743e0d77151b32451d9"))
    archive["inventory"](held,accepted,result)
    return {"completion":str(path),"completionSha256":digest,"archiveSha256":result["archiveSha256"],
            "runtimeSha256":result["runtimeSha256"],"acceptedInventorySha256":ns["ACCEPTED_SHA"],
            "manifestSha256":PRIOR_MANIFEST,"receiptSha256":PRIOR_RECEIPT}


def rehearse(args):
    ns,manifest,candidates=previous["bound_plan"](args)
    raw=engine["git"]("show",args.commit+":"+ns["STREAM"])
    need(raw==candidates[ns["STREAM"]] and sha(raw)==ns["STREAM_AFTER"],"Suite would test different bytes")
    prior["committed"](SUITE,args.commit)
    pid=manifest["protectedServices"]["states"][ns["UNITS"][0]]["MainPID"]
    node=Path(os.readlink("/proc/"+pid+"/exe"))
    need(sha(ns["safe_read"](node,200*1024**2))==manifest["nodeSha256"],"Changed runtime Node")
    offline=pending["offline_suites"](node)
    ns["fence"](ns["ROOT"],manifest,candidates)
    return {"sourceCommit":args.commit,"planSha256":args.sha256,"candidateSha256":sha(raw),"offline":offline,
            "checkpoint":pending["healthy"](),"emergency":prior["emergency"]()}


def live_probe(args):
    base=prior["live_postflight"](args)
    _,node=prior["installed"](args)
    query=HERE/"check-live.mjs"
    prior["committed"](str(query.relative_to(engine["REPO"])),args.commit)
    point=base["checkpoint"]
    pid=subprocess.check_output(["systemctl","show","proofofwork-api","-p","MainPID","--value"],text=True,timeout=8).strip()
    entries=(Path("/proc")/pid/"environ").read_bytes().split(b"\0")
    token=next(v.partition(b"=")[2] for v in entries if v.startswith(b"POW_INTERNAL_VERIFIER_TOKEN="))
    start_us=time.time_ns()//1000
    proc=subprocess.run([str(node),str(query),str(point["height"]),point["hash"]],cwd=engine["REPO"],user="powadmin",group="powadmin",
        extra_groups=[],env={"PATH":"/usr/bin:/bin","POW_INTERNAL_VERIFIER_TOKEN":token.decode()},capture_output=True,timeout=165)
    need(proc.returncode==0,"Installed stream HTTP verification failed: "+proc.stderr[-600:].decode(errors="replace"))
    probe=json.loads(proc.stdout)
    need(probe.get("ok") and probe["height"]==point["height"] and probe["hash"]==point["hash"] and
         probe["receivedBytes"]==probe["contentLength"]>0,"Wrong root or counted stream bytes")
    matches=[]
    for attempt in range(5):
        since="@"+str(start_us//1_000_000)+"."+str(start_us%1_000_000).zfill(6)
        journal=subprocess.check_output(["journalctl","-u","proofofwork-api","--since",since,"--no-pager","-o","json","-n","500"],
                                        timeout=12)
        for line in journal.splitlines():
            record=json.loads(line)
            if record.get("_PID")!=pid: continue
            try: event=json.loads(record.get("MESSAGE",""))
            except ValueError: continue
            if (isinstance(event,dict) and event.get("event")=="http-response-observation" and event.get("method")=="GET" and
                    event.get("route")==probe["route"] and event.get("status")==200 and event.get("payloadBytes")==probe["contentLength"]):
                matches.append({"elapsedMs":event["elapsedMs"],"payloadBytes":event["payloadBytes"],"journalTime":record["__REALTIME_TIMESTAMP"]})
        if matches: break
        if attempt<4: time.sleep(1)
    need(matches,"No corresponding HTTP 200 byte observation in the installed API journal")
    closing=pending["healthy"]()
    need((closing["height"],closing["hash"])==(point["height"],point["hash"]),"Tip changed; repeat the read-only probe")
    return {"baseline":base,"stream":probe,"observations":matches}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest="mode",required=True)
    p=sub.add_parser("plan"); p.add_argument("commit"); p.add_argument("output",type=Path)
    for mode in ("rehearse","apply"):
        p=sub.add_parser(mode); p.add_argument("commit"); p.add_argument("plan",type=Path); p.add_argument("sha256")
    for mode in ("postflight","archive"):
        p=sub.add_parser(mode); p.add_argument("commit"); p.add_argument("receipt_dir",type=Path); p.add_argument("manifest_sha256")
    args=parser.parse_args()
    need(os.geteuid()==0 and sys.flags.isolated and not sys.flags.optimize and engine["RUNTIME"].resolve(strict=True)==engine["RUNTIME"]!=engine["REPO"],
         "Require isolated root Python in a separate clean NODE checkout")
    os.umask(0o077)
    engine["source_fence"](args.commit)
    for file in (Path(__file__).resolve(),HERE/"profile.py",HERE/"check-live.mjs",HERE/"check.test.py"):
        prior["committed"](str(file.relative_to(engine["REPO"])),args.commit)
    for file in (PRIOR,PRIOR.parent/"schema.py",PRIOR.parent/"profile.py"):
        need(file.read_bytes()==engine["git"]("show",PRIOR_COMMIT+":"+str(file.relative_to(engine["REPO"]))),"Changed predecessor source")
    ns=engine["namespace"](controller())
    binding=predecessor(ns,installed=args.mode in ("postflight","archive"))
    if args.mode=="plan":
        print(json.dumps({"predecessor":binding,"checkpoint":pending["healthy"](),"emergency":prior["emergency"]()}),flush=True)
        engine["build_plan"](args)
    elif args.mode in ("rehearse","apply"):
        proof={**rehearse(args),"predecessor":binding}
        path=args.plan.with_name(args.plan.name+"."+args.mode+"."+str(os.getpid())+".json")
        engine["private_path"](path); data=(json.dumps(proof,sort_keys=True)+"\n").encode();lab["save"](path,data)
        print(json.dumps({"proof":proof,"proofPath":str(path),"proofSha256":sha(data)}),flush=True)
        if args.mode=="apply": engine["apply_plan"](args)
    else:
        print(json.dumps({"postflight":live_probe(args)}),flush=True)
        if args.mode=="archive":
            args.previous_completion=Path(binding["completion"]);args.previous_completion_sha256=binding["completionSha256"]
            engine["archive"](args)


if __name__=="__main__":
    main()
