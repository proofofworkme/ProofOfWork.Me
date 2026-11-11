#!/usr/bin/python3 -I
"""Ship only the reviewed wallet-readiness runtime over its accepted overlays."""
import ast
import hashlib
import runpy
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent / "powcat/release.py"
ENGINE_SHA = "bff08af2cf46467ec633f744674052678bd69931c6c485dd15b3efba03d86a96"
if hashlib.sha256(ENGINE.read_bytes()).hexdigest() != ENGINE_SHA:
    raise RuntimeError("Unexpected scoped node release engine")
engine = runpy.run_path(str(ENGINE))
original_controller = engine["controller"]
original_git = engine["git"]
original_source_fence = engine["source_fence"]


def controller():
    body, footer = original_controller().rsplit(b"\nif __name__ == '__main__': main()", 1)
    prefix = b"backup = BACKUPS/('powcat-'"
    if footer.strip() or body.count(prefix) != 1:
        raise RuntimeError("Unexpected node controller")
    return (body.replace(prefix, b"backup = BACKUPS/('health-readiness-'")
            + b"\n" + (HERE / "profile.py").read_bytes()
            + b"\nif __name__ == '__main__': main()\n")


def git(*args):
    ns = engine["namespace"](controller())
    # This accepted runtime dependency predates its inclusion in Git. Its exact
    # installed bytes, not an invented historical blob, are the merge base.
    name = "server/db/read-only-snapshot.mjs"
    if args == ("show", ns["BASE_SOURCE_COMMIT"] + ":" + name):
        raw = ns["safe_read"](ns["ROOT"] / name)
        if ns["sha"](raw) != ns["EXISTING"][name]:
            raise RuntimeError("Accepted snapshot dependency changed")
        return raw
    return original_git(*args)


def source_fence(commit):
    original_source_fence(commit)
    for name in ("release.py", "profile.py"):
        path = HERE / name
        if path.read_bytes() != original_git("show", f"{commit}:deploy/health-readiness/{name}"):
            raise RuntimeError("Health release tool differs from committed source")


def normalize_reviewed_merge(name, raw, sides):
    """Normalize the reviewed overlay's duplicate definitions and helper order.

    Called only after every input and the complete conflict output are pinned.
    The final complete byte hash is independently required by resolve_merge.
    """
    text = raw.decode()
    pattern = re.compile(r"<<<<<<< ACTIVE\n(.*?)\|\|\|\|\|\|\| BASE\n(.*?)=======\n(.*?)>>>>>>> CANDIDATE\n", re.S)
    matches = list(pattern.finditer(text))
    if len(matches) != len(sides) or any(side not in (0, 2) for side in sides):
        raise RuntimeError("Unexpected health conflict structure")
    for match, side in reversed(list(zip(matches, sides))):
        text = text[:match.start()] + match.group(side + 1) + text[match.end():]

    def take(start, end):
        nonlocal text
        if text.count(start) != 1 or text.count(end) != 1:
            raise RuntimeError("Unexpected health helper boundary")
        left, right = text.index(start), text.index(end)
        if right <= left:
            raise RuntimeError("Reversed health helper boundary")
        value = text[left:right]
        text = text[:left] + text[right:]
        return value

    if name == "server/db/proof-index-reader.mjs":
        # Accepted runtime already owns snapshot context/pending witness helpers.
        # Canonical includes those foundations at EOF, so remove only that exact
        # duplicated suffix, not the original accepted implementations.
        marker = "const walletReadSnapshot = new WalletRequestAsyncLocalStorage();\n"
        if text.count(marker) != 1:
            raise RuntimeError("Unexpected duplicate snapshot boundary")
        text = text[:text.index(marker)]
        block = take("function walletPreflightReadinessMap(scope, name, shared) {\n",
                     "export async function proofIndexWithWalletRequestReadiness(read) {")
        comment = ("// Shared work contains only public, account-independent readiness proof. The\n"
                   "// per-wallet snapshot and every Core/mempool closing fence remain independent.\n")
        declaration = "const walletReadinessPreflights = new Map();\n"
        if block.count(comment + declaration) != 1:
            raise RuntimeError("Unexpected preflight declaration")
        block = declaration + block.replace(comment + declaration, "", 1)
        queue_comment = ("// Cancellation removes queued work. A running audit owns the sole slot until\n"
                         "// its real cleanup settles; rejecting a caller never releases it prematurely.\n")
        queue = take(queue_comment,
                     "async function workPrecisionV2MigrationFullAuditWithBound({")
        text += block + queue.removeprefix(queue_comment).rstrip() + "\n"
    elif name == "server/proof-api.mjs":
        duplicate = ('import { isReadOnlySnapshotBudgetError } from "./db/read-only-snapshot.mjs";\n'
                     'import { createWalletReadCoalescer, walletReadIdentity, measurePrivatePhase, withPrivatePhaseTimings, privateReadContext } from "./wallet-read-observation.mjs";\n'
                     'const coalesceWalletRead = createWalletReadCoalescer();\n')
        prefix = "#!/usr/bin/env node\n" + duplicate
        if not text.startswith(prefix):
            raise RuntimeError("Unexpected duplicate API prelude")
        text = "#!/usr/bin/env node\n" + text[len(prefix):]
        imports = ("  proofIndexPrepareWalletReadiness,\n"
                   "  proofIndexWithWalletReadSnapshot,\n"
                   "  proofIndexWalletReadSnapshotPendingProof,\n")
        if text.count(imports) != 1:
            raise RuntimeError("Unexpected duplicate API imports")
        text = text.replace(imports, "  proofIndexPrepareWalletReadiness,\n", 1)
    else:
        raise RuntimeError("Unreviewed structural health merge")
    return text.encode()


def resolve_merge(ns, name, candidate, active, base, merge):
    """Resolve only an explicitly reviewed exact merge; never guess a side."""
    rules = ns.get("MERGES", {})
    rule = rules.get(name)
    if rule is None:
        merge.check_returncode()
        return merge.stdout
    digest = lambda raw: hashlib.sha256(raw).hexdigest()
    actual = {"active": digest(active), "base": digest(base),
              "canonical": digest(candidate), "conflicted": digest(merge.stdout)}
    if actual != rule["inputs"] or merge.returncode != rule["returncode"]:
        raise RuntimeError("Unreviewed health merge inputs: " + name)
    if actual["active"] != ns["EXISTING"][name]:
        raise RuntimeError("Health merge predecessor differs: " + name)
    result = (normalize_reviewed_merge(name, merge.stdout, rule["conflictSides"])
              if "conflictSides" in rule else merge.stdout)
    for old, new in rule.get("replacements", []):
        old, new = old.encode(), new.encode()
        if not old or result.count(old) != 1:
            raise RuntimeError("Health merge resolution differs: " + name)
        result = result.replace(old, new, 1)
    if digest(result) != ns["AFTER"].get(name):
        raise RuntimeError("Unreviewed health merge result: " + name)
    return result


def health_build_plan():
    # The complete original engine is hash-pinned above. Replace exactly its
    # merge-result handling; preserve capture, lineage, metadata and all fences.
    raw = ENGINE.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ENGINE_SHA:
        raise RuntimeError("Unexpected scoped node release engine")
    text = raw.decode()
    tree = ast.parse(text)
    function = next(node for node in tree.body
                    if isinstance(node, ast.FunctionDef) and node.name == "build_plan")
    source = ast.get_source_segment(text, function)
    old = "                    merge.check_returncode()\n                    candidate = merge.stdout"
    new = ("                    candidate = resolve_merge(ns, name, candidate, "
           "base64.b64decode(sources[name]['base64'], validate=True), "
           "(p / 'base').read_bytes(), merge)")
    if source.count(old) != 1:
        raise RuntimeError("Unexpected scoped merge planner")
    namespace = dict(engine["main"].__globals__)
    namespace.update(controller=controller, git=git, source_fence=source_fence,
                     resolve_merge=resolve_merge)
    exec(compile(source.replace(old, new), str(ENGINE), "exec"), namespace)
    return namespace["build_plan"]


if __name__ == "__main__":
    namespace = engine["main"].__globals__
    namespace.update(controller=controller, git=git, source_fence=source_fence,
                     build_plan=health_build_plan())
    engine["main"]()
