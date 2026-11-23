#!/usr/bin/env python3
"""Qualify the existing private-stage scratch model using disposable directory layouts."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

DEPLOY = Path(__file__).resolve().parents[1]
MIB = 1024**2


def load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


phase = load(DEPLOY / "publish/phase_capacity.py")
native = load(DEPLOY / "proofofwork-ui-capacity.py")
sequence = load(DEPLOY / "publish/sequence_capacity.py")
stager = load(DEPLOY / "proofofwork-ui-release-stage.py")


def allocated(path):
    return native.check_deploy_scratch(path, 0, "fixture-measurement")["allocatedBytes"]


def layout(root, live_content, stage_content):
    # Independent snapshots of the two directory positions in release-publish.sh.
    # The candidate and old live never move during this test.
    scratch = root / "scratch"
    for tree, content in ((root / "www", live_content), (scratch / "stage", stage_content)):
        tree.mkdir(mode=0o700, parents=True)
        asset = tree / "asset"
        asset.write_bytes(content)
        asset.chmod(0o600)
    (scratch / "source").write_bytes(b"preserved source")
    (scratch / "input").write_bytes(b"preserved input")
    return scratch


def private_plan(candidate_bound, block):
    identity = {"releaseId": "a"*12 + "-20000101T000000Z", "commit": "a"*40, "tree": "b"*40}
    helpers = {name: {"sha256": str(index)*64}
               for index, name in enumerate(("stager", "provenance", "publisher"), 1)}
    request = {**identity, "model": "proof-ui-closed-input-v1", "surfacesSha256": "4"*64,
               "phaseSourceSha256": "5"*64, "inputCompactorSha256": "6"*64,
               "payloadFingerprint": "7"*64,
               "helperHashes": {name: value["sha256"] for name, value in helpers.items()}}
    archive = {"model": "closed-managed-archive-tar-gzip-v1", "hardDereference": True,
               "managedSurfaces": ["example"], "regularFiles": 1, "entries": 2,
               "logicalBytes": block, "archiveUpperBoundBytes": MIB}
    return {**identity, "inputStorage": "deploy-scratch-v1", "releaseFormat": "proofofwork-ui-release-v6",
            "managedSurfaces": archive["managedSurfaces"], "surfaces": {"sha256": request["surfacesSha256"]},
            "surfacesPayloadFingerprint": request["payloadFingerprint"], "publicationHelpers": helpers,
            "phaseCapacity": {"sha256": request["phaseSourceSha256"]},
            "inputCompactor": {"sha256": request["inputCompactorSha256"]},
            "oldLiveManifestSha256": "8"*64, "oldFullRootTreeSha256": "9"*64,
            "closedArchive": {"request": request, "archive": archive, "liveManifestSha256": "8"*64,
                              "liveTreeSha256": "9"*64, "privateStaging": {
                                  "model": "private-release-stage-v1", "blockSize": block,
                                  "compactInputUpperBytes": block, "finalCandidateUpperBytes": candidate_bound}},
            "admissions": {"source-receive": {"bytes": MIB, "inodes": 64},
                           "surfaces-receive": {"bytes": block*8, "inodes": 64}},
            "sourceAllocatedBytes": MIB, "stageArchiveUpperBoundBytes": MIB}


def direct_plan(ordinary, outgoing_bytes, outgoing_inodes):
    plan = copy.deepcopy(ordinary)
    pair = {"current": "2084747c3f8c-20261118T181547Z", "previous": "9f18a0ce7032-20261118T004519Z"}
    plan["privateStageRetention"] = {"previousPair": pair, "releaseId": plan["releaseId"]}
    plan["retentionLifecycle"] = {"pair": pair}
    plan["amoDirectStage"] = {"model": "amo-direct-stage-v1", "approvalSha256": "a"*64}
    evidence = plan["closedArchive"]
    evidence["request"]["amoDirectStage"] = True
    evidence["privateStaging"]["passthroughUpperBytes"] = evidence["privateStaging"]["blockSize"]
    evidence["amoDirectCapacity"] = {"model": "amo-direct-capacity-v1", "outgoingAllocatedBytes": outgoing_bytes,
                                     "outgoingUniqueInodes": outgoing_inodes, "outgoingIdentitySha256": "b"*64,
                                     "transientSurfaceUpperBytes": evidence["privateStaging"]["blockSize"]}
    return plan

class ExchangeScratch(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="amo-exchange-layout-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        block = native.allocation_block(root)
        self.candidate = os.urandom(block)
        self.old = os.urandom(64*block)
        self.before = layout(root / "before", self.old, self.candidate)
        self.after = layout(root / "after", self.candidate, self.old)
        self.before_bytes = allocated(self.before)
        self.after_bytes = allocated(self.after)
        self.assertGreater(self.after_bytes, self.before_bytes)

    def refusal(self, scratch, requested):
        with self.assertRaises(native.CapacityError) as caught:
            native.check_deploy_scratch(scratch, requested, "fixture-boundary")
        prefix = "UI deployment scratch review required "
        self.assertTrue(str(caught.exception).startswith(prefix))
        return json.loads(str(caught.exception)[len(prefix):])

    def test_private_publication_reservation_and_real_exchange_layout(self):
        candidate = self.before / "stage"
        live = self.before.parent / "www"
        # Inject the same imported capacity code into this disposable stager,
        # without assuming that a developer checkout has installed /sbin modes.
        with patch.object(stager, "_capacity_module", native):
            candidate_bound, _ = stager.candidate_allocation(candidate, os.geteuid())
        plan = private_plan(candidate_bound["additionalBytes"], native.allocation_block(candidate))
        census = {"limits": dict(sequence.LIMITS), "liveTree": native.tree_bound(live, self.before),
                  "availableBytes": 32 * 1024**3, "availableInodes": 100000,
                  "usage": {"backup": 0, "transport": 0, "scratch": 0}}
        required = sequence.requirements(plan, census)
        tail = required["privatePhasePeaks"]["source-and-publication"]["scratch"] + sequence.EVIDENCE_BYTES
        # The source and fixed charges persist in both positions. Replace the
        # modeled candidate (including its metadata cushion) with measured old live.
        swapped = tail - candidate_bound["additionalBytes"] + allocated(live)
        peak = required["additionalBytes"]["scratch"]
        self.assertGreater(swapped, peak)
        cap = census["limits"]["scratchBudgetBytes"]
        census["usage"]["scratch"] = cap - swapped + 1
        admitted = sequence.admit(required, census)
        self.assertEqual(admitted["headroom"]["scratch"], swapped - peak - 1)
        self.assertEqual(census["usage"]["scratch"] + swapped, cap + 1)

        # Repeat at the unmodified native six-GiB ceiling using an exact
        # additional reservation to stand in for unrelated retained bytes.
        exact = native.MAX_DEPLOY_SCRATCH_BYTES - self.after_bytes
        self.assertEqual(native.check_deploy_scratch(self.after, exact, "fixture-fit")["allocatedBytes"],
                         self.after_bytes)
        before = native.check_deploy_scratch(self.before, exact + 1, "fixture-before")
        self.assertEqual(before["maximumBytes"] - before["allocatedBytes"] - before["additionalBytes"],
                         self.after_bytes - self.before_bytes - 1)
        after = self.refusal(self.after, exact + 1)
        self.assertEqual(after["allocatedBytes"] + after["additionalBytes"], after["maximumBytes"] + 1)

    def test_direct_exchange_projection_enforces_independent_limits(self):
        old = self.before.parent / "www"
        block = native.allocation_block(old)
        bound = native.tree_bound(old, self.before)
        plan = private_plan(12 * block, block)
        census = {"limits": dict(sequence.LIMITS), "liveTree": bound,
                  "usage": {"backup": 0, "transport": 0, "scratch": 0}}
        ordinary = sequence.requirements(plan, census)
        result = sequence.requirements(direct_plan(plan, allocated(old), 2), census)
        added = result["additionalBytes"]
        self.assertEqual(added["scratch"], result["privatePhasePeaks"]["outgoing-in-scratch"]["scratch"]
                         + sequence.EVIDENCE_BYTES)
        self.assertEqual(added["root"], ordinary["additionalBytes"]["root"])
        self.assertEqual(result["additionalInodes"], ordinary["additionalInodes"])
        self.assertEqual(added["transport"], ordinary["additionalBytes"]["transport"])
        self.assertNotIn("scratchAllowanceBytes", result)
        for pool in census["usage"]:
            census["usage"][pool] = sequence.LIMITS[pool + "BudgetBytes"] - added[pool]
        census["availableBytes"] = (sequence.LIMITS["rootReserveBytes"] + sequence.LIMITS["growthReserveBytes"]
                                    + added["root"])
        census["availableInodes"] = sequence.LIMITS["inodeReserve"] + result["additionalInodes"]
        exact = sequence.admit(result, census)
        self.assertEqual(exact["headroom"], dict.fromkeys(("scratch", "backup", "transport", "root", "inodes"), 0))
        self.assertEqual(exact["cleanupCreditBytes"], 0)
        for metric, record, key, delta in [
                ("backup", census["usage"], "backup", 1), ("transport", census["usage"], "transport", 1),
                ("scratch", census["usage"], "scratch", 1), ("root", census, "availableBytes", -1),
                ("inodes", census, "availableInodes", -1)]:
            with self.subTest(metric=metric), patch.dict(record, {key: record[key] + delta}):
                with self.assertRaises(ValueError) as caught:
                    sequence.admit(result, census)
                deficits = json.loads(str(caught.exception).split(": ", 1)[1])["deficits"]
                self.assertEqual(deficits, {metric: 1})

    def test_exchange_projection_covers_both_backup_occupants_and_rejects_unbound_counts(self):
        old = self.before.parent / "www"
        block = native.allocation_block(old)
        bound = native.tree_bound(old, self.before)
        census = {"limits": dict(sequence.LIMITS), "liveTree": bound}
        for final, outgoing in [(2 * block, bound["additionalBytes"] + block),
                                (bound["additionalBytes"] + 2 * block, allocated(old))]:
            with self.subTest(final=final, outgoing=outgoing):
                plan = private_plan(final, block)
                ordinary = sequence.requirements(plan, census)
                projected = sequence.requirements(direct_plan(plan, outgoing, 2), census)
                backup_base = ordinary["additionalBytes"]["backup"] - bound["additionalBytes"]
                self.assertEqual(projected["additionalBytes"]["backup"], backup_base + max(outgoing, final))
                steady = projected["privatePhasePeaks"]["source-and-publication"]["scratch"]
                swapped = projected["privatePhasePeaks"]["outgoing-in-scratch"]["scratch"]
                self.assertEqual(swapped - steady, outgoing - final)
                self.assertGreaterEqual(projected["additionalBytes"]["scratch"],
                                        max(steady, swapped) + sequence.EVIDENCE_BYTES)
        for byte_count, inode_count in [(0, 2), (-1, 2), (True, 2), (4096, 0), (4096, 3), (4096, 1.5)]:
            with self.subTest(bytes=byte_count, inodes=inode_count), self.assertRaises(ValueError):
                sequence.requirements(direct_plan(plan, byte_count, inode_count), census)

    def test_outgoing_census_checks_allocations_aliases_and_identity(self):
        live = self.before.parent / "www"
        os.link(live / "asset", live / "alias")
        witness = phase.direct_outgoing_allocation(live)
        self.assertEqual(witness["outgoingAllocatedBytes"], allocated(live))
        self.assertEqual(witness["outgoingUniqueInodes"], 2)
        self.assertEqual(witness, phase.direct_outgoing_allocation(live))
        (live / "asset").chmod(0o644)
        self.assertNotEqual(witness["outgoingIdentitySha256"], phase.direct_outgoing_allocation(live)["outgoingIdentitySha256"])
        (live / "unsafe").symlink_to(live / "asset")
        with self.assertRaisesRegex(ValueError, 'Unsupported outgoing'):
            phase.direct_outgoing_allocation(live)

    def test_transient_prior_copy_and_mixed_release_inputs(self):
        live = self.before.parent / "www"
        block = native.allocation_block(live)
        row = {"kind": "file", "size": 7 * block, "xattrs": []}
        small = phase.direct_capacity_evidence({"pay": [row]}, {}, live, block)
        large = phase.direct_capacity_evidence({"pay": [row]}, {"pay": [row, row]}, live, block)
        self.assertGreaterEqual(large["transientSurfaceUpperBytes"] - small["transientSurfaceUpperBytes"], 14 * block)
        census = {"limits": dict(sequence.LIMITS), "liveTree": native.tree_bound(live, self.before)}
        plan = direct_plan(private_plan(12 * block, block), allocated(live), 2)
        plan["closedArchive"]["amoDirectCapacity"] = large
        result = sequence.requirements(plan, census)
        self.assertEqual(result["charges"]["candidateCopy"], 12 * block + large["transientSurfaceUpperBytes"])
        for container, key, value in [(plan, "amoDirectStage", {}),
                                      (plan["closedArchive"]["request"], "amoDirectStage", False),
                                      (plan["closedArchive"], "amoDirectCapacity", {}),
                                      (plan["retentionLifecycle"], "pair", {"current": "unrelated", "previous": "older"})]:
            with self.subTest(key=key), patch.dict(container, {key: value}), self.assertRaises(ValueError):
                sequence.requirements(plan, census)
        del plan["amoDirectStage"]
        with self.assertRaisesRegex(ValueError, "Incomplete AMO direct"):
            sequence.requirements(plan, census)

    def test_interrupted_exchange_cannot_close_ordinary_budget_with_zero_requested(self):
        # Scale only the numeric ceiling. du and the installed decision execute
        # against real files, without allocating six GiB to represent retained data.
        with patch.object(native, "MAX_DEPLOY_SCRATCH_BYTES", self.after_bytes - 1):
            before = native.check_deploy_scratch(self.before, 0, "fixture-original-position")
            self.assertGreater(before["maximumBytes"] - before["allocatedBytes"], 0)
            for requested in (0, 1):
                with self.subTest(requested=requested):
                    after = self.refusal(self.after, requested)
                    self.assertEqual(after["allocatedBytes"] - after["maximumBytes"], 1)
                    self.assertFalse(after["cleanupApproved"])
            # A successful restoration would have the separately measured first
            # layout. A failed attempt must be reconciled against its actual one.
            self.assertEqual(allocated(self.before), self.before_bytes)
        self.assertEqual((self.after / "stage/asset").read_bytes(), self.old)
        self.assertEqual((self.after.parent / "www/asset").read_bytes(), self.candidate)
        self.assertEqual(allocated(self.after), self.after_bytes)


if __name__ == "__main__":
    unittest.main()
