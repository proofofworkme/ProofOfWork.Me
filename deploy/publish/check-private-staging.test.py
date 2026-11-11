#!/usr/bin/env python3
"""Native private staging rehearsal using synthetic bundles and a detached fixture repository."""
import ast
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace
import tarfile
import tempfile
import unittest
import zlib

DEPLOY = Path(__file__).resolve().parents[1]


def load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


receiver = load(DEPLOY / "audit5/stream-ui-bundle.py")
release = load(DEPLOY / "publish/release.py")
compactor = load(DEPLOY / "publish/input_compaction.py")
stage = load(DEPLOY / "proofofwork-ui-release-stage.py")
phase = load(DEPLOY / "publish/phase_capacity.py")


def run(args, *, env=None, cwd=None, check=True):
    return subprocess.run(args, env=env, cwd=cwd, capture_output=True, text=True, check=check, timeout=180)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def pack(tree, path, top):
    with tarfile.open(path, "w:gz", dereference=True) as archive:
        archive.add(tree, arcname=top)


class NativePrivateStaging(unittest.TestCase):
    def setUp(self):
        old_umask = os.umask(0o022)
        self.addCleanup(os.umask, old_umask)
        self.work = tempfile.TemporaryDirectory(prefix="pow-private-stage-fixture-")
        self.addCleanup(self.work.cleanup)
        self.base = Path(self.work.name).resolve()
        self.live = self.base / "live"
        self.scratch = self.base / "scratch"
        self.archives = self.base / "backups/releases"
        self.tools = self.base / "tools"
        self.lock = self.base / "locks/deploy.lock"
        for p in (self.live, self.scratch, self.tools, self.archives,
                  self.base / "backups/transport-evidence", self.lock.parent):
            p.mkdir(parents=True, mode=0o700, exist_ok=True)
        self.lock.touch(mode=0o600)
        # Relocate only the production capacity helper's hardcoded roots.
        # Its reserve, inode, scratch and retention checks execute unchanged.
        capacity = (DEPLOY / "proofofwork-ui-capacity.py").read_text()
        for native, fixture in (("/var/backups/proofofwork-ui", self.base / "backups"),
                                ("/var/tmp/proofofwork-deploy", self.scratch),
                                ("/var/www", self.live), ("/run/proofofwork-ui", self.lock.parent)):
            self.assertIn('"' + native, capacity)
            capacity = capacity.replace('"' + native, '"' + str(fixture))
        (self.tools / "proofofwork-ui-capacity.py").write_text(capacity)
        (self.tools / "proofofwork-ui-release-stage.py").write_bytes((DEPLOY / "proofofwork-ui-release-stage.py").read_bytes())
        for p in self.tools.iterdir():
            p.chmod(0o700)
        self.env = {**os.environ, "POW_UI_ALLOW_TEST_ROOTS": "1", "POW_UI_STAGE_WWW_ROOT": str(self.live),
                    "POW_UI_STAGE_STAGING_ROOT": str(self.scratch), "POW_UI_DEPLOY_LOCK": str(self.lock),
                    "POW_UI_RELEASE_ARCHIVE_ROOT": str(self.archives), "POW_UI_STAGED_ROOT": "1",
                    "POW_UI_CAPACITY_SCRIPT": str(self.tools / "proofofwork-ui-capacity.py")}
        self.env.pop("POW_UI_DEPLOY_LOCK_FD", None)
        self.source = self.base / "build-source"
        self.source.mkdir()
        def git(*args):
            return run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                        "-c", "commit.gpgsign=false", *args], cwd=self.source).stdout.strip()
        git("init", "-q")
        (self.source / ".gitignore").write_text("node_modules/\n")
        (self.source / "entry.js").write_text("export const fixture = true;\n")
        git("add", ".gitignore", "entry.js")
        git("commit", "-qm", "synthetic staging fixture")
        self.commit = git("rev-parse", "HEAD")
        git("checkout", "--detach", self.commit)
        (self.source / "node_modules").mkdir()
        (self.source / "node_modules/fixture.js").write_bytes(b"fixture dependency")
        self.rid = self.commit[:12] + "-20261103T000000Z"
        self.payload = self.base / "payload"
        data = (b"// same content inside each surface and across roots\n" * 127)
        for name in stage.PERMISSION_SURFACES:
            for root, script in ((self.live / ("proofofwork-" + name), "old.js"),
                                 (self.payload / "surfaces" / name, "new.js")):
                (root / "assets").mkdir(parents=True)
                (root / "index.html").write_text('<script src="/assets/' + script + '"></script>')
                (root / "assets" / script).write_bytes(data if script == "new.js" else b"old dependency")
                if script == "new.js":
                    (root / "assets/equal.js").write_bytes(data)
        (self.live / "passthrough.txt").write_text("keep the live passthrough")
        for root in (self.live, self.payload, self.source):
            for p in root.rglob("*"):
                # The surface receiver rejects group/other writes, including in the Git checkout.
                p.chmod((p.stat().st_mode & 0o755) if root == self.source else 0o755 if p.is_dir() else 0o644)

    def receive(self, kind, tree):
        top = f"proofofwork-ui-{kind}-{self.rid}"
        path = self.base / (kind + ".tgz")
        pack(tree, path, top)
        with path.open("rb") as stream:
            receipt = receiver.receive(kind, self.rid, path.stat().st_size, digest(path), stream,
                                       self.scratch, self.lock, owner=os.geteuid())
        self.assertEqual(receipt["status"], "verified")
        return path, Path(receipt["extractedRoot"])

    def incoming(self):
        path, root = self.receive("surfaces", self.payload)
        packed = bytearray()
        fingerprint = release.bundle_payload_fingerprint(path, self.rid, stage.PERMISSION_SURFACES, packed)
        if os.geteuid() != 0:
            # Unprivileged fixture only: production receiver normalizes to root:root.
            self.assertEqual(os.geteuid(), os.getegid())
            rows = json.loads(zlib.decompress(packed))
            for row in rows:
                row[3:5] = [os.geteuid(), os.getegid()]
            fingerprint["sha256"] = hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest()
        receipt = compactor.compact(root, fingerprint, owner=os.geteuid())
        self.assertGreater(receipt["aliases"], 22)
        def check():
            return compactor.compact(root, fingerprint, owner=os.geteuid(), check_only=True,
                                     journal_sha256=receipt["originalTimes"]["sha256"])
        self.assertEqual(check(), dict(receipt, aliasesCreated=0))
        return root, check, fingerprint

    def source_and_publish(self, archive, incoming, fingerprint, compact, allocation):
        """Exercise the normal source phase with its own globals, then the publication handoff."""
        attempt = "initial"
        identity = {"releaseId": self.rid, "commit": self.commit,
                    "tree": run(["git", "rev-parse", "HEAD^{tree}"], cwd=self.source).stdout.strip()}
        source_root = self.scratch / ("proofofwork-ui-source-" + self.rid)
        source_bundle = self.base / "source.tgz"
        pack(self.source, source_bundle, source_root.name)
        stage_out = self.scratch / ("recovery-transport-" + self.rid + "-surfaces-stage-" + attempt)
        source_out = self.scratch / ("recovery-transport-" + self.rid + "-source-" + attempt)
        stage_out.mkdir()
        source_out.mkdir()
        evidence = self.archives.parent / "transport-evidence"
        release_evidence = evidence / self.rid
        release_evidence.mkdir()

        def helper(text):
            data = text.encode()
            return {"sha256": hashlib.sha256(data).hexdigest(),
                    "compressedSource": base64.b64encode(zlib.compress(data)).decode()}

        # Run the shipped helpers with our fixture owner's UID and actual staged tree.
        # Substitute only the installed stager lookup, whose host lock is tested separately.
        stager_path = self.tools / "proofofwork-ui-release-stage.py"
        verifier_text = (DEPLOY / "publish/phase_capacity.py").read_text() + (
            "\ndef locked_installed_stager(expected, lock_fd):\n"
            " import runpy, types\n"
            f" path = Path({str(stager_path)!r})\n"
            " assert hashlib.sha256(path.read_bytes()).hexdigest() == expected\n"
            " return types.SimpleNamespace(**runpy.run_path(str(path)))\n")
        compact_text = (DEPLOY / "publish/input_compaction.py").read_text().replace(
            "expected_fingerprint, owner=0", "expected_fingerprint, owner=os.geteuid()")
        compactor_record, phase_record = helper(compact_text), helper(verifier_text)
        helpers = {"stager": {"sha256": digest(stager_path)},
                   "provenance": {"path": str(DEPLOY / "proofofwork-ui-release-provenance.sh")},
                   "capacity": {"path": str(self.tools / "proofofwork-ui-capacity.py")}}
        plan = {**identity, "publicationAttempt": attempt, "preservedSourceCheckout": str(source_root),
                "inputStorage": "deploy-scratch-v1", "surfacesPayloadFingerprint": fingerprint,
                "inputCompactor": compactor_record, "phaseCapacity": phase_record, "publicationHelpers": helpers,
                "wrapperSourceSha256": {"input_compaction.py": compactor_record["sha256"],
                                        "phase_capacity.py": phase_record["sha256"]},
                "closedArchive": {"request": {"inputCompactorSha256": compactor_record["sha256"],
                                              "phaseSourceSha256": phase_record["sha256"]},
                                  "privateStaging": {"compactInputUpperBytes": 32 * 1024**2,
                                                     "finalCandidateUpperBytes": 32 * 1024**2}},
                "privateStageRetention": {"model": "private-stage-zero-retirement-v1", "wouldRetire": [],
                                          "releaseId": self.rid, "previousPair": {}, "stateSha256": "a"*64},
                "retentionLifecycle": {"pair": {}, "state": {"sha256": "a"*64}}, "retainedRoots": [],
                "source": {"compressedBytes": source_bundle.stat().st_size, "sha256": digest(source_bundle)},
                "admissions": {"source-receive": {"bytes": source_bundle.stat().st_size, "inodes": 100}}}
        plan_sha = hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()

        def fixture_bound(path, expected=None, maximum=2*1024**3):
            data = Path(path).read_bytes()
            self.assertLessEqual(len(data), maximum)
            if expected is not None:
                self.assertEqual(hashlib.sha256(data).hexdigest(), expected)
            return data

        def record(path):
            data = fixture_bound(path)
            return data, hashlib.sha256(data).hexdigest()

        def program(nodes, path, context):
            exec(compile(ast.Module(nodes, type_ignores=[]), str(path), "exec"), context)

        def assigned(node, name):
            return isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets)

        transport = DEPLOY / "publish/remote_transport.py"
        nodes = ast.parse(transport.read_bytes()).body
        # The exact terminal emitted after real receive, compaction, stage and archive.
        emit = next(n for n in ast.walk(ast.Module(nodes, [])) if isinstance(n, ast.Expr)
                    and isinstance(n.value, ast.Call) and isinstance(n.value.func, ast.Name)
                    and n.value.func.id == "durable_json" and isinstance(n.value.args[-1], ast.Dict)
                    and any(isinstance(k, ast.Constant) and k.value == "managedArchive" for k in n.value.args[-1].keys))
        state = {"__name__": "_fixture_transport", "Path": Path, "json": json, "hashlib": hashlib, "os": os,
                 "sys": sys, "subprocess": subprocess, "time": time, "zlib": zlib, "base64": base64,
                 "BASE": self.scratch, "ARCHIVES": self.archives, "EVIDENCE": evidence,
                 "EVIDENCE_RESERVE": 32*1024**2, "RECEIVE_TIMEOUT_SECONDS": 2700,
                 "release": self.rid, "p": plan, "plan_sha": plan_sha, "phase": "surfaces-stage",
                 "private_staging": True, "helpers": helpers, "scratch_inputs": True,
                 "out": stage_out, "preserved": incoming, "archive": archive,
                 "archive_sha": digest(archive), "archive_work": self.archives, "model": {},
                 "input_before": fingerprint, "compact_input": compact, "measured": allocation,
                 "surfaces_root": incoming/"surfaces", "input_parent": self.scratch, "evidence_root": release_evidence,
                 "phase_capacity_source": verifier_text, "tools": self.tools, "retained": [],
                 "live": {}, "namespace": {"fingerprint": lambda path: {}}, "env": self.env}
        program([n for n in nodes if isinstance(n, ast.FunctionDef) and
                 n.name in ("durable_json", "sync", "planned_helper")], transport, state)
        program([emit], transport, state)
        stage_receipt = stage_out/"receipt.json"
        stage_bytes = stage_receipt.read_bytes()
        prior = json.loads(stage_bytes)
        self.assertEqual({key: prior.get(key) for key in identity}, identity)

        def invocation(argv, name, *, source=None, length=0, timeout, extra=None):
            if source is not None:
                self.assertEqual(argv[-4:], ["source", self.rid, str(source_bundle.stat().st_size), digest(source_bundle)])
                receiver.receive("source", self.rid, length, digest(source_bundle), source, self.scratch,
                                 self.lock, owner=os.geteuid())
                return
            if name == "candidate-provenance.log":
                argv = ["/usr/bin/bash", *argv]
            result = run(argv, env={**self.env, **(extra or {})})
            (source_out/name).write_text(result.stdout)

        # All statements in the source dispatch execute in their native order,
        # including stage binding, predecessor verification, receiver and terminal.
        private_setup = next(n for n in nodes if isinstance(n, ast.If) and isinstance(n.test, ast.Name)
                             and n.test.id == "private_staging")
        start = next(i for i,n in enumerate(nodes) if assigned(n, "kind"))
        state.update(out=source_out, phase="source", run=invocation, bounded_record=record, bound=fixture_bound,
                     validate_evidence_ancestors=lambda *args, **kwargs: release_evidence,
                     directory=lambda p: self.assertTrue(p.is_dir()), capacity=lambda *args, **kwargs: None)
        with self.lock.open("rb") as lock, source_bundle.open("rb") as stream:
            state.update(lock_fd=lock.fileno(), sys=SimpleNamespace(stdin=SimpleNamespace(buffer=stream)))
            program([private_setup], transport, state)
            # A retained terminal from before commit/tree were emitted must refuse before reading a byte.
            for missing in ("commit", "tree"):
                changed = dict(prior)
                changed.pop(missing)
                stage_receipt.write_text(json.dumps(changed))
                with self.assertRaisesRegex(ValueError, "preceding verified receipt"):
                    program(nodes[start:], transport, state)
                self.assertEqual(stream.tell(), 0)
                self.assertFalse(source_root.exists())
            stage_receipt.write_bytes(stage_bytes)
            program(nodes[start:], transport, state)
            source_receipt = source_out/"receipt.json"
            proof = json.loads(source_receipt.read_bytes())
            self.assertEqual(proof["verifiedStageReceiptSha256"], digest(stage_receipt))
            self.assertTrue(proof["candidateProvenanceVerified"] and proof["detachedSourceClean"])
            self.assertEqual(proof["receiverReceiptSha256"], digest(self.scratch/("audit5-stream-source-"+self.rid+".json")))

            # Run the publisher's private revalidation, clean Git checks and durable
            # intent up to the publisher child. All path substitutions use this fixture.
            publisher = DEPLOY / "publish/publish.py"
            import pathlib
            pub = ast.parse(publisher.read_text().replace("/var/tmp/proofofwork-deploy", str(self.scratch))).body
            first = next(i for i,n in enumerate(pub) if isinstance(n, ast.If) and ast.unparse(n.test)=="'inputCompactor' in plan")
            end = next(i for i,n in enumerate(pub) if assigned(n, "archive"))
            context = {**state, "reviewed_forecast": __import__("runpy").run_path(str(DEPLOY / "publish/publication_admission.py"))["reviewed_forecast"], "pathlib": pathlib, "plan": plan, "attempt": attempt, "fd": lock.fileno(),
                       "commit": self.commit, "tree": plan["tree"], "load_bound": fixture_bound}
            # Re-hashing only the source receipt cannot authenticate a changed stage receipt.
            stage_receipt.write_bytes(stage_bytes + b" ")
            with self.assertRaises(AssertionError):
                program(pub[first:end], publisher, context)
            stage_receipt.write_bytes(stage_bytes)
            source_bytes = source_receipt.read_bytes()
            source_receipt.write_text(json.dumps({**proof, "tree": "0"*40}))
            with self.assertRaises(AssertionError):
                program(pub[first:end], publisher, context)
            source_receipt.write_bytes(source_bytes)
            self.assertFalse((self.scratch / ("recovery-publish-" + self.rid + "-" + attempt)).exists())
            program(pub[first:end], publisher, context)
            intent = json.loads((context["out"]/"intent.json").read_bytes())
            self.assertEqual(intent["verifiedStageReceiptSha256"], digest(stage_receipt))
            self.assertEqual(intent["verifiedSourceReceiptSha256"], digest(source_receipt))
        return source_root, plan, plan_sha, prior

    def test_receive_compact_stage_archive_and_source(self):
        root, recheck, fingerprint = self.incoming()
        incoming = root / "surfaces"
        staged = self.scratch / ("proofofwork-www-stage-" + self.rid)
        result = run([sys.executable, "-I", "-B", str(self.tools / "proofofwork-ui-release-stage.py"),
                      "--release-id", self.rid, "--surfaces-root", str(incoming), "--stage-root", str(staged),
                      "--deduplicate-managed-files"], env=self.env, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("status=staged", result.stdout)
        received_asset = incoming / "computer/assets/new.js"
        staged_asset = staged / "proofofwork-computer/assets/new.js"
        self.assertTrue(received_asset.samefile(incoming / "permission/assets/equal.js"))
        self.assertTrue(staged_asset.samefile(staged / "proofofwork-permission/assets/equal.js"))
        self.assertFalse(staged_asset.samefile(received_asset))
        self.assertEqual((staged / "passthrough.txt").read_text(), "keep the live passthrough")
        self.assertEqual((staged / "proofofwork-permission/assets/old.js").read_bytes(), b"old dependency")
        self.assertEqual(recheck()["format"], "pow-ui-received-input-compaction-v1")
        def compact_checkpoint():
            value = recheck()
            value.pop("aliasesCreated")
            return value
        def stage_checkpoint():
            return phase.private_stage_receipt(staged, fixture_stager, 32 * 1024**2)
        fixture_stager = load(self.tools / "proofofwork-ui-release-stage.py")
        archive = self.archives / ("proofofwork-ui-release-" + self.rid + ".tgz")
        top = self.base / "archive-base"
        (top / "surfaces").mkdir(parents=True)
        run(["/usr/bin/tar", "--sort=name", "--create", "--gzip", "--hard-dereference", "--file", str(archive),
             "--transform=s|^proofofwork-|surfaces/|", "--directory", str(top), "surfaces", "--directory", str(staged),
             *["proofofwork-" + n for n in stage.PERMISSION_SURFACES]])
        Path(str(archive) + ".sha256").write_text(digest(archive) + "  " + archive.name + "\n")
        source, plan, plan_sha, prior = self.source_and_publish(
            archive, root, fingerprint, compact_checkpoint(), stage_checkpoint())
        def verify_predecessor():
            phase.verify_private_predecessor(plan, plan_sha, prior, compact_checkpoint(), stage_checkpoint())
        command = ["/usr/bin/bash", str(DEPLOY / "proofofwork-ui-release-provenance.sh"), "verify-candidate",
                   "--release-id", self.rid, "--commit", self.commit, "--source-checkout", str(source), "--archive", str(archive)]
        env = {**self.env, "POW_UI_WWW_ROOT": str(staged)}
        good = run(command, env=env, check=False)
        self.assertEqual(good.returncode, 0, good.stderr)
        self.assertIn("ui_release_candidate status=verified", good.stdout)
        (source / "entry.js").write_bytes(b"different tracked bytes")
        rejected = run(command, env=env, check=False)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("tracked bytes differ from Git", rejected.stderr)
        # Even unchanged bytes cannot borrow an inode from outside the stage.
        outside = self.base / "external-stage-alias"
        os.link(staged_asset, outside)
        with self.assertRaisesRegex(fixture_stager.StageError, "hardlink outside"):
            verify_predecessor()
        outside.unlink()
        staged_asset.write_bytes(b"altered after staging")
        with self.assertRaisesRegex(ValueError, "preceding verified receipt"):
            verify_predecessor()

    def test_modified_received_path_and_external_alias_fail_closed(self):
        root, recheck, _ = self.incoming()
        target = root / "surfaces/computer/assets/new.js"
        outside = self.base / "unexpected-alias"
        os.link(target, outside)
        with self.assertRaisesRegex(ValueError, "outside"):
            recheck()
        outside.unlink()
        target.write_bytes(b"changed within a received path")
        with self.assertRaisesRegex(ValueError, "inventory"):
            recheck()


if __name__ == "__main__":
    unittest.main()
