#!/usr/bin/env python3
"""Exercise V4 -> V5 Permission releases in temporary local roots only."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import tarfile
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
namespace = {"__name__": "permission_fixture_helpers", "__file__": str(ROOT / "scripts/check-ui-pages-release.py")}
exec(compile((ROOT / "scripts/check-ui-pages-release.py").read_bytes(), namespace["__file__"], "exec"), namespace)
PagesRelease = namespace["PagesRelease"]
stage, builder, write, module = (namespace[name] for name in ("stage", "builder", "write", "module"))
retention = module("permission_release_retention", ROOT / "deploy/proofofwork-ui-verified-retention.py")
retained_root = module("permission_release_retained_root", ROOT / "deploy/proofofwork-ui-retained-root.py")
https = module("permission_release_https", ROOT / "deploy/publish/https_smoke.py")


class PermissionRelease(unittest.TestCase):
    # Reuse the established owner-controlled fixture, not its V3/V4 test cases.
    setUp, tearDown = PagesRelease.setUp, PagesRelease.tearDown
    run_command, populate, archive, record = (getattr(PagesRelease, name) for name in ("run_command", "populate", "archive", "record"))
    stage = PagesRelease.stage

    def publish_args(self, release, archive):
        source = self.staging / ("proofofwork-ui-source-" + release)
        shutil.copytree(self.source, source)
        return [str(ROOT / "deploy/proofofwork-ui-release-publish.sh"), "--release-id", release,
                "--commit", self.commit, "--source-checkout", str(source), "--archive", str(archive),
                "--defer-verified-retention"]

    def manifest_fields(self, root=None):
        return dict(line.split("=", 1) for line in ((root or self.www) / ".proofofwork-ui-release").read_text().splitlines())

    def test_exact_v5_roots_and_build_host_switch_vector(self):
        self.assertEqual(len(stage.SURFACES), 20)
        self.assertEqual(len(stage.PAGES_SURFACES), 21)
        self.assertEqual(len(stage.PERMISSION_SURFACES), 22)
        self.assertEqual(set(stage.PERMISSION_SURFACES), set(stage.PAGES_SURFACES) | {"permission"})
        self.assertEqual(set(builder.PERMISSION_SURFACES) | {"nft"}, set(stage.PERMISSION_SURFACES))
        self.assertEqual(builder.PERMISSION_SURFACES["permission"], ("permission", "VITE_PERMISSION_ONLY"))
        self.assertEqual(builder.PERMISSION_SURFACES["pages"], ("pages", "VITE_PAGES_ONLY"))
        self.assertEqual(builder.PERMISSION_SURFACES["computer"], ("computer", None))
        environment = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"}
        with patch.object(builder.subprocess, "run") as invoked, contextlib.redirect_stdout(io.StringIO()):
            builder.build_focused_surfaces(self.source, self.base / "build-payload", builder.PERMISSION_SURFACES, environment, io.StringIO())
        self.assertEqual(invoked.call_count, 22)  # One shared tsc, 21 public bundles; NFT copies Computer.
        calls = invoked.call_args_list
        self.assertIn("typescript/bin/tsc", calls[0].args[0][1])
        switches = {switch for _, switch in builder.PERMISSION_SURFACES.values() if switch}
        for call, (surface, (host, switch)) in zip(calls[1:], builder.PERMISSION_SURFACES.items()):
            env = call.kwargs["env"]
            self.assertEqual(env["VITE_POW_API_BASE"], "https://" + host + ".proofofwork.me")
            self.assertEqual({key for key in switches if key in env}, {switch} if switch else set())
            self.assertEqual(call.args[0][-3:], ["--outDir", str(self.base / "build-payload/surfaces" / surface), "--emptyOutDir"])
        self.assertEqual(environment, {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"})
        payload = self.base / "payload"; payload.mkdir(mode=0o755)
        for surface in stage.SURFACES: (payload / surface).mkdir(mode=0o755)
        self.assertEqual(stage.payload_surface_names(payload), stage.SURFACES)
        (payload / "pages").mkdir(mode=0o755)
        self.assertEqual(stage.payload_surface_names(payload), stage.PAGES_SURFACES)
        (payload / "permission").mkdir(mode=0o755)
        self.assertEqual(stage.payload_surface_names(payload), stage.PERMISSION_SURFACES)
        (payload / "unknown").mkdir(mode=0o755)
        with self.assertRaisesRegex(stage.StageError, "exactly the V3 20 or V4 21 or V5 22"):
            stage.payload_surface_names(payload)

    def test_v5_publication_preserves_pages_closure_provenance_and_rollback(self):
        self.populate(self.www, stage.PAGES_SURFACES, managed=True)
        write(self.www / "operator-evidence/keep.txt", "preserve passthrough evidence\n")
        baseline = self.archive(self.www, stage.PAGES_SURFACES, self.baseline_id)
        self.record(self.baseline_id, baseline)
        self.run_command([self.provenance, "verify"])
        self.assertEqual(self.manifest_fields()["format"], "proofofwork-ui-release-v4")
        prior, identity = stage.tree_fingerprint(self.www), (self.www.stat().st_dev, self.www.stat().st_ino)
        candidate, _ = self.stage(self.release_id, stage.PERMISSION_SURFACES)
        self.assertEqual(stage.tree_fingerprint(self.www), prior)
        self.assertEqual(stage.live_surface_names(candidate), stage.PERMISSION_SURFACES)
        for surface in stage.PAGES_SURFACES:
            self.assertTrue((candidate / ("proofofwork-" + surface) / "assets/old.js").is_file(), surface)
        self.assertFalse((candidate / "proofofwork-permission/assets/old.js").exists())
        self.assertEqual((candidate / "proofofwork-pages/assets/old.js").read_bytes(), (self.www / "proofofwork-pages/assets/old.js").read_bytes())
        archive = self.archive(candidate, stage.PERMISSION_SURFACES, self.release_id)
        args = self.publish_args(self.release_id, archive)
        failure = self.run_command(args, {"POW_UI_PUBLISH_TEST_FAIL_AFTER_SWAP": "1"}, success=False)
        self.assertIn("Injected", failure.stderr)
        self.assertEqual(stage.tree_fingerprint(self.www), prior)
        self.assertEqual((self.www.stat().st_dev, self.www.stat().st_ino), identity)
        self.assertTrue(candidate.is_dir())
        self.run_command([self.provenance, "verify-rollback"])
        self.run_command(args)
        self.run_command([self.provenance, "verify"])
        manifest = (self.www / ".proofofwork-ui-release").read_text()
        fields = self.manifest_fields()
        self.assertEqual(fields["format"], "proofofwork-ui-release-v5")
        self.assertEqual(fields["commit"], self.commit)
        self.assertEqual({key.split(".")[1] for key in fields if key.startswith("surface.")}, set(stage.PERMISSION_SURFACES))
        self.assertEqual(sum(key.startswith("surface.") and key.endswith(".file_count") for key in fields), 22)
        self.assertEqual(fields["surface.permission.file_count"], "2")
        self.assertEqual(fields["surface.pages.file_count"], "3")
        self.assertEqual(Path(str(archive) + ".provenance").read_text(), manifest)
        self.assertEqual(retention.verified_release(self.www, self.archives)["format"], "proofofwork-ui-release-v5")
        rollback = self.rollbacks / ("proofofwork-www-pre-" + self.release_id)
        self.assertEqual(stage.tree_fingerprint(rollback), prior)
        self.run_command([self.provenance, "verify-rollback"], {"POW_UI_WWW_ROOT": str(rollback), "POW_UI_RETAINED_ROOT": "1"})
        self.assertEqual(retention.verified_release(rollback, self.archives)["format"], "proofofwork-ui-release-v4")
        future, _ = self.stage(self.commit[:12] + "-20261008T010003Z", stage.PERMISSION_SURFACES, tag="future")
        self.assertEqual((future / "proofofwork-pages/assets/new.js").read_bytes(), (self.www / "proofofwork-pages/assets/new.js").read_bytes())
        self.assertEqual((future / "proofofwork-permission/assets/new.js").read_bytes(), (self.www / "proofofwork-permission/assets/new.js").read_bytes())
        for index, family in enumerate((stage.SURFACES, stage.PAGES_SURFACES), 4):
            downgrade, rejected = self.stage(self.commit[:12] + f"-20261008T01000{index}Z", family, success=False)
            self.assertIn("drop a live Permission", rejected.stderr)
            self.assertFalse(downgrade.exists())
        shutil.rmtree(future / "proofofwork-permission")
        future_archive = self.archive(future, stage.PAGES_SURFACES, self.commit[:12] + "-20261008T010003Z")
        preserved = retained_root.fingerprint(rollback)
        classified = rollback.name + ":" + preserved["manifestSha256"] + ":" + preserved["treeSha256"]
        rejected = self.run_command(self.publish_args(self.commit[:12] + "-20261008T010003Z", future_archive) +
                                    ["--retain-rollback-root", classified], success=False)
        self.assertIn("drop the live Permission", rejected.stderr)

    def test_v5_missing_or_downgraded_manifest_evidence_is_rejected(self):
        self.populate(self.www, stage.PERMISSION_SURFACES, managed=True)
        archive = self.archive(self.www, stage.PERMISSION_SURFACES, self.baseline_id)
        self.record(self.baseline_id, archive)
        original = (self.www / ".proofofwork-ui-release").read_text()
        self.run_command([self.provenance, "verify"])
        manifest = self.www / ".proofofwork-ui-release"
        for version in ("v3", "v4"):
            manifest.write_text(original.replace("proofofwork-ui-release-v5", "proofofwork-ui-release-" + version))
            rejected = self.run_command([self.provenance, "verify"], success=False)
            self.assertIn("Pre-V5 UI release manifest cannot contain Permission", rejected.stderr)
            with self.assertRaisesRegex(ValueError, "Incomplete release surface coverage"):
                retention.verified_release(self.www, self.archives)
        manifest.write_text("\n".join(line for line in original.splitlines() if not line.startswith("surface.permission.")) + "\n")
        rejected = self.run_command([self.provenance, "verify"], success=False)
        self.assertIn("V5 UI release manifest is missing surface evidence: permission", rejected.stderr)
        with self.assertRaisesRegex(ValueError, "Incomplete release surface coverage"):
            retention.verified_release(self.www, self.archives)
        manifest.write_text(original)
        asset = self.www / "proofofwork-permission/assets/old.js"
        bytes_before = asset.read_bytes(); asset.write_bytes(b"corrupt permission bundle\n")
        self.run_command([self.provenance, "verify"], success=False)
        with self.assertRaisesRegex(ValueError, "Release surface fingerprint mismatch: permission"):
            retention.verified_release(self.www, self.archives)
        asset.write_bytes(bytes_before)
        self.run_command([self.provenance, "verify"])

    def test_historical_v3_v4_remain_valid_but_cannot_hide_permission_archive(self):
        for index, family in enumerate((stage.SURFACES, stage.PAGES_SURFACES)):
            with self.subTest(roots=len(family)):
                if index:
                    shutil.rmtree(self.www); self.www.mkdir(mode=0o755)
                self.populate(self.www, family, managed=True)
                release = self.commit[:12] + f"-20261008T01001{index}Z"
                archive = self.archive(self.www, family, release)
                self.record(release, archive)
                self.run_command([self.provenance, "verify"])
                self.assertEqual(self.manifest_fields()["format"], "proofofwork-ui-release-" + ("v3" if index == 0 else "v4"))
                self.assertEqual(retention.verified_release(self.www, self.archives)["format"], self.manifest_fields()["format"])
                self.populate(self.www, ("permission",), managed=True)
                self.run_command([self.provenance, "verify"], success=False)
                with self.assertRaisesRegex(ValueError, "Undeclared release surface: permission"):
                    retention.verified_release(self.www, self.archives)
                poisoned = self.archive(self.www, (*family, "permission"), self.commit[:12] + f"-20261008T01002{index}Z")
                shutil.rmtree(self.www / "proofofwork-permission")
                rejected = self.run_command([self.provenance, "record", "--release-id", self.commit[:12] + f"-20261008T01002{index}Z",
                    "--commit", self.commit, "--source-checkout", str(self.source), "--archive", str(poisoned)], success=False)
                self.assertIn("unexpected Permission payload without V5 evidence", rejected.stderr)
                self.assertFalse(Path(str(poisoned) + ".provenance").exists())

    def test_v5_https_checks_all21_public_hosts_and_refuses_missing_or_stale_permission(self):
        tree = self.run_command(["git", "-C", str(self.source), "rev-parse", "HEAD^{tree}"]).stdout.strip()
        path = self.base / ("proofofwork-ui-release-" + self.release_id + ".tgz")
        def prepare(*, omitted=(), omit_permission_source=False, permission_commit=None, version="v5"):
            with tarfile.open(path, "w:gz") as archive:
                for surface in stage.PERMISSION_SURFACES:
                    if surface in omitted: continue
                    members = [("index.html", (surface if surface != "nft" else "computer").encode())]
                    if surface != "nft" and not (surface == "permission" and omit_permission_source):
                        proof = {"format": "proof-of-work-ui-source-v1", "commit": permission_commit if surface == "permission" and permission_commit else self.commit,
                                 "tree": tree, "trackedDirty": False}
                        members.append(("source-provenance.json", (json.dumps(proof) + "\n").encode()))
                    for name, content in members:
                        member = tarfile.TarInfo("surfaces/" + surface + "/" + name); member.size = len(content); member.mode = 0o644
                        archive.addfile(member, io.BytesIO(content))
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            manifest = ("format=proofofwork-ui-release-" + version + "\nrelease_id=" + self.release_id + "\ncommit=" + self.commit +
                        "\nsource_tree=" + tree + "\narchive_name=" + path.name + "\narchive_sha256=" + digest + "\n").encode()
            (self.base / ".proofofwork-ui-release").write_bytes(manifest)
            Path(str(path) + ".provenance").write_bytes(manifest)
            Path(str(path) + ".sha256").write_text(digest + "  " + path.name + "\n")
            return types.SimpleNamespace(archive=str(path), release_id=self.release_id, commit=self.commit, tree=tree,
                                         archive_sha256=digest, workers=2, timeout=1)
        requests = []
        def compare(url, content, timeout, **kwargs): requests.append(url); return len(content)
        receipt = {"verifiedResponseBytes": 0, "archivedFilesChecked": 0, "hostnameRootsChecked": 0}
        with patch.dict(https.check.__globals__, compare_https=compare): https.check(prepare(), receipt)
        self.assertEqual(receipt["publicSurfaces"], 21)
        self.assertEqual(receipt["hostnameRootsChecked"], 21)
        self.assertEqual(receipt["archivedFilesChecked"], 42)
        self.assertEqual(receipt["sourceProvenanceSurfaces"], 21)
        self.assertIn("https://permission.proofofwork.me/", requests)
        self.assertIn("https://permission.proofofwork.me/index.html", requests)
        self.assertIn("https://permission.proofofwork.me/source-provenance.json", requests)
        for change in ({"omitted": ("permission",)}, {"omit_permission_source": True},
                       {"permission_commit": "0" * 40}, {"version": "v4"}):
            with self.subTest(change=change), patch.dict(https.check.__globals__, compare_https=unittest.mock.Mock()) as values:
                with self.assertRaises(ValueError): https.check(prepare(**change), {})
                values["compare_https"].assert_not_called()


del PagesRelease  # Do not rediscover the separately maintained V3/V4 test class.

if __name__ == "__main__":
    unittest.main(verbosity=2)
