#!/usr/bin/python3 -I
"""Prepare the exact activity fee factoring overlay; ordinary rollout fences remain intact."""
import ast
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
    return (body.replace(prefix, b"backup = BACKUPS/('activity-fee-factor-'")
            + b"\n" + (HERE / "profile.py").read_bytes()
            + b"\nif __name__ == '__main__': main()\n")


def source_fence(commit):
    original_source_fence(commit)
    for name in ("release.py", "profile.py"):
        if (HERE / name).read_bytes() != engine["git"]("show", f"{commit}:deploy/activity-fee-factor/{name}"):
            raise RuntimeError("Activity fee factoring tool differs from committed source")



def resolve_merge(ns, name, candidate, active, base, merge):
    """Ignore merge output: only the exact reviewed function may replace itself."""
    rule = ns["SPLICE"]
    digest = lambda raw: hashlib.sha256(raw).hexdigest()
    if name != rule["path"] or any(digest(raw) != rule[key] for key, raw in
            (("active", active), ("base", base), ("canonical", candidate))):
        raise RuntimeError("Unreviewed activity splice inputs")
    def parts(raw):
        start = b"export async function proofIndexCanonicalActivityPayload("
        end = b"\nfunction eventHistoryFilters("
        if raw.count(start) != 1 or raw.count(end) != 1:
            raise RuntimeError("Unexpected activity function boundaries")
        a = raw.index(start); b = raw.index(end, a)
        return raw[:a], raw[a:b], raw[b:]
    prefix, old, suffix = parts(active)
    _, baseline, _ = parts(base)
    _, new, _ = parts(candidate)
    if baseline != old:
        raise RuntimeError("Activity baseline function differs from accepted runtime")
    if digest(old) != rule["oldFunction"] or digest(new) != rule["newFunction"]:
        raise RuntimeError("Unreviewed activity function")
    result = prefix + new + suffix
    if digest(result) != rule["after"] or digest(result) != ns["AFTER"][name]:
        raise RuntimeError("Unreviewed activity splice result")
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
    exec(compile(source.replace(old, new), str(ENGINE), "exec"), namespace)
    return namespace["build_plan"]


if __name__ == "__main__":
    engine["main"].__globals__.update(controller=controller, source_fence=source_fence,
                                       build_plan=audit_build_plan())
    engine["main"]()
