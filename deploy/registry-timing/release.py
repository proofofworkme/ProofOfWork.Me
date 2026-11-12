#!/usr/bin/python3 -I
"""Prepare the exact diagnostic overlay; ordinary rollout fences remain intact."""
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
    return (body.replace(prefix, b"backup = BACKUPS/('registry-timing-'")
            + b"\n" + (HERE / "profile.py").read_bytes()
            + b"\nif __name__ == '__main__': main()\n")


def source_fence(commit):
    original_source_fence(commit)
    for name in ("release.py", "profile.py"):
        if (HERE / name).read_bytes() != engine["git"]("show", f"{commit}:deploy/registry-timing/{name}"):
            raise RuntimeError("Registry timing tool differs from committed source")



def resolve_merge(ns, name, candidate, active, base, merge):
    """Permit only the reviewed complete-byte import relocation."""
    rule = ns.get("MERGES", {}).get(name)
    if rule is None:
        merge.check_returncode()
        return merge.stdout
    actual = {key: hashlib.sha256(raw).hexdigest() for key, raw in
              (("active", active), ("base", base), ("canonical", candidate), ("conflicted", merge.stdout))}
    if actual != rule["inputs"] or merge.returncode != rule["returncode"]:
        raise RuntimeError("Unreviewed registry timing merge inputs")
    if actual["active"] != ns["EXISTING"][name]:
        raise RuntimeError("Registry timing merge predecessor differs")
    result = merge.stdout
    for old, new in rule["replacements"]:
        old, new = old.encode(), new.encode()
        if not old or result.count(old) != 1:
            raise RuntimeError("Registry timing merge resolution differs")
        result = result.replace(old, new, 1)
    if hashlib.sha256(result).hexdigest() != ns["AFTER"].get(name):
        raise RuntimeError("Unreviewed registry timing merge result")
    return result


def registry_build_plan():
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
                                       build_plan=registry_build_plan())
    engine["main"]()
