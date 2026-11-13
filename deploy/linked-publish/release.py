#!/usr/bin/python3 -I
"""Prepare the exact linked Publish overlay; ordinary rollout fences remain intact."""
import ast
import os
import json
import base64
import hashlib
import runpy
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent / "powcat/release.py"
ENGINE_SHA = "bff08af2cf46467ec633f744674052678bd69931c6c485dd15b3efba03d86a96"
if hashlib.sha256(ENGINE.read_bytes()).hexdigest() != ENGINE_SHA:
    raise RuntimeError("Unexpected scoped node release engine")
engine = runpy.run_path(str(ENGINE))
original_controller = engine["controller"]
original_source_fence = engine["source_fence"]


def controller():
    body, footer = original_controller().rsplit(b"\nif __name__ == '__main__': main()", 1)
    prefix = b"backup = BACKUPS/('powcat-'"
    if footer.strip() or body.count(prefix) != 1:
        raise RuntimeError("Unexpected node controller")
    syntax = b"        subprocess.run([str(node),'--check',str(candidate)],check=True,capture_output=True,timeout=30)"
    if body.count(syntax) != 1:
        raise RuntimeError("Unexpected runtime syntax validator")
    body = body.replace(syntax, b"        if row['path'] != 'server/sql/proof-search-linked-publish-v1.sql':\n" + b"    " + syntax)
    admission = b"m = json.loads(raw); candidates = validate_manifest(m)"
    if body.count(admission) != 1:
        raise RuntimeError("Unexpected controller admission sequence")
    body = body.replace(admission, admission + b"; validate_linked_stage(m.get('linkedStage'), m['sourceCommit'], m.get('linkedPlanSha256'), ROOT)")
    gateway = b"    for unit in GATEWAY:\n"
    if body.count(gateway) != 1:
        raise RuntimeError("Unexpected public gateway restore sequence")
    body = body.replace(gateway, b"    require_linked_writer_off()\n" + gateway)
    return (body.replace(prefix, b"backup = BACKUPS/('linked-publish-'")
            + b"\n" + (HERE / "profile.py").read_bytes()
            + b"\n" + (HERE / "stage-contract.py").read_bytes()
            + b"\n" + (HERE / "preinstall.py").read_bytes()
            + b"\nif __name__ == '__main__': main()\n")


def source_fence(commit):
    original_source_fence(commit)
    for name in ("release.py", "profile.py", "stage-contract.py", "coordinator.py", "stage.py", "stage.mjs", "phases.py", "pin-serving.mjs", "qualification.py", "preinstall.py", "census.mjs"):
        if (HERE / name).read_bytes() != engine["git"]("show", f"{commit}:deploy/linked-publish/{name}"):
            raise RuntimeError("Linked Publish tool differs from committed source")



def resolve_merge(ns, name, candidate, active, base, merge):
    """Permit only the reviewed complete-byte import union."""
    rule = ns.get("MERGES", {}).get(name)
    if rule is None:
        merge.check_returncode()
        return merge.stdout
    actual = {key: hashlib.sha256(raw).hexdigest() for key, raw in
              (("active", active), ("base", base), ("canonical", candidate), ("conflicted", merge.stdout))}
    if actual != rule["inputs"] or merge.returncode != rule["returncode"]:
        raise RuntimeError("Unreviewed linked Publish merge inputs")
    if actual["active"] != ns["EXISTING"][name]:
        raise RuntimeError("Linked Publish merge predecessor differs")
    result = candidate if rule.get("useReviewedCanonical") else merge.stdout
    for old, new in rule["replacements"]:
        old, new = old.encode(), new.encode()
        if not old or result.count(old) != 1:
            raise RuntimeError("Linked Publish merge resolution differs")
        result = result.replace(old, new, 1)
    if hashlib.sha256(result).hexdigest() != ns["AFTER"].get(name):
        raise RuntimeError("Unreviewed linked Publish merge result")
    return result


def audit_build_plan():
    raw = ENGINE.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ENGINE_SHA:
        raise RuntimeError("Unexpected scoped node release engine")
    text = raw.decode()
    function = next(node for node in ast.parse(text).body
                    if isinstance(node, ast.FunctionDef) and node.name == "build_plan")
    source = ast.get_source_segment(text, function)
    old = "                    merge.check_returncode()\n                    candidate = merge.stdout"
    new = ("                    candidate = resolve_merge(ns, name, candidate, "
           "base64.b64decode(sources[name]['base64'], validate=True), "
           "(p / 'base').read_bytes(), merge)")
    if source.count(old) != 1:
        raise RuntimeError("Unexpected scoped merge planner")
    namespace = dict(engine["main"].__globals__)
    namespace.update(controller=controller, source_fence=source_fence, resolve_merge=resolve_merge)
    syntax = '            subprocess.run([captured["nodePath"], "--input-type=module", "--check"], input=candidate, check=True)'
    if source.count(syntax) != 1:
        raise RuntimeError("Unexpected plan syntax validator")
    source = source.replace(syntax, '            if name != "server/sql/proof-search-linked-publish-v1.sql":\n    ' + syntax)
    exec(compile(source.replace(old, new), str(ENGINE), "exec"), namespace)
    return namespace["build_plan"]


def qualified_apply(args):
    # No bypass switch: exact final evidence is mandatory before touching live state.
    path = os.environ.get('POW_LINKED_RELEASE_QUALIFICATION_PATH')
    digest = os.environ.get('POW_LINKED_RELEASE_QUALIFICATION_SHA256')
    if not path or not digest or args is None:
        raise RuntimeError("Linked Publish apply is disabled until final root-reconciled qualification is supplied.")
    archival = engine['namespace'](engine['pinned']('monitoring-reconciliation/runtime_archive.py'))
    raw = archival['read'](args.plan, args.sha256)
    plan = json.loads(raw)
    code, holder = controller(), engine['pinned']('search/hold-node-timer.py')
    if not (plan.get('format') == 'powcat-rollout-v1' and plan.get('sourceCommit') == args.commit
            and base64.b64decode(plan['controllerBase64'], validate=True) == code
            and plan['controllerSha256'] == hashlib.sha256(code).hexdigest()
            and base64.b64decode(plan['searchHoldControllerBase64'], validate=True) == holder
            and plan['searchHoldControllerSha256'] == hashlib.sha256(holder).hexdigest()):
        raise RuntimeError('Wrong reviewed linked Publish plan')
    plan['planSha256'] = args.sha256
    tree = engine['git']('rev-parse', args.commit + '^{tree}').decode().strip()
    qualify = runpy.run_path(str(HERE / 'qualification.py'))
    qualify['read_release_qualification'](path, digest, plan, tree)
    coordinator = runpy.run_path(str(HERE / 'coordinator.py'))
    return coordinator['coordinate'](globals(), plan, args.sha256)


blocked_apply = qualified_apply


if __name__ == "__main__":
    engine["main"].__globals__.update(controller=controller, source_fence=source_fence,
                                       build_plan=audit_build_plan(), apply_plan=qualified_apply)
    engine["main"]()
