"""Exact four-file audit overlay, preserving all other accepted runtime bytes."""
FAMILY = "proof-of-work-audit-remediation-runtime-v1"
BASE_SOURCE_COMMIT = "7eaad7ffc0961db2cb67fe0bcd83a8477938941e"
ACCEPTED_SHA = "5af96ecdda0d91b12d9c2b3f8a750c8ce9653364f01ae42dc8106ee36d9a55d2"
EXISTING = {'server/proof-api.mjs': 'f413129c55442dd8382b365c814cb0456ce477920adad5da8b89b2e4b48f0f08', 'server/wallet-read-observation.mjs': '1fc98beb1190be8b3a088ff483be45a319ad53a66c628faf4de81c206b2ff672', 'scripts/backfill-proof-indexer.mjs': 'ebdb4dd5792eb0f69f4dff62ed0f11255b927f7e5e8ca14ff604239b4ef55957'}
API_SHA = EXISTING["server/proof-api.mjs"]
AFTER = {'server/proof-api.mjs': 'e6b2c9e8bfa6ad60f624481605ea7d76c1d781730dd8f2fabb8ca2d490ac8a6e', 'server/wallet-read-observation.mjs': 'ceb49004512b350b832eaba2dfca4a6f8a8b2a63d9b2ef50fdda74ee49dfdbf5', 'scripts/backfill-proof-indexer.mjs': 'c21562b00123901c616e8c1cc5d740495011d5b0860c8a2b77a3953e6e2284ab', 'server/pwid-rejection-projection.mjs': '1c8a60bb1ef37d2fbf39f1508dbda381be3268cc2f1c3d473ea786d25051fc4d'}
MERGES = {'scripts/backfill-proof-indexer.mjs': {'inputs': {'active': 'ebdb4dd5792eb0f69f4dff62ed0f11255b927f7e5e8ca14ff604239b4ef55957', 'base': '3e5680c3fd8ee175dc091cc78651409dc908be6706f96f645678fd07545186ad', 'canonical': '82eeccab020addb6249ceb4a07dd70308f6090fb712161316f0cfcfcbc8d597d', 'conflicted': '56a6784f7249c8dbd4b82ec9ebe74cd6f2bd0b086632b274a27e0cad21ea8f09'}, 'returncode': 1, 'replacements': [('<<<<<<< ACTIVE\nimport { assertNativeTransitionStorageContract } from \'../server/db/native-transition-storage.mjs\';\nimport { measurePrivatePhase } from "../server/wallet-read-observation.mjs";\n||||||| BASE\n=======\nimport { canonicalPwidRejectionProjection } from "../server/pwid-rejection-projection.mjs";\n>>>>>>> CANDIDATE\n', 'import { assertNativeTransitionStorageContract } from \'../server/db/native-transition-storage.mjs\';\nimport { measurePrivatePhase } from "../server/wallet-read-observation.mjs";\nimport { canonicalPwidRejectionProjection } from "../server/pwid-rejection-projection.mjs";\n')]}}
PRESERVED = {
    "server/db/read-only-snapshot.mjs": "8495cdac8ef1c65dd9654413f254fc84f7f505d49dffce615ecc6047a8117a63",
    "server/db/proof-index-reader.mjs": "93256afae311a4db47ab13341071a6c9d3206ecca30d87dfc0a4b8ab331c285d",
}
NEW = frozenset({"server/pwid-rejection-projection.mjs"})
ALLOWED = frozenset(EXISTING) | NEW
INSTALL_ORDER = ["server/pwid-rejection-projection.mjs", "server/wallet-read-observation.mjs", "scripts/backfill-proof-indexer.mjs", "server/proof-api.mjs"]


def validate_manifest(manifest):
    require(manifest.get("format") == FAMILY and manifest.get("baselineHead") == BASELINE_HEAD
            and manifest.get("acceptedInventorySha256") == ACCEPTED_SHA,
            "Unexpected audit remediation baseline")
    candidates = validate_engine_manifest({**manifest, "format": "proof-of-work-amo-browse-scoped-runtime-v1"})
    require(set(AFTER) == set(ALLOWED), "Audit remediation has not been reviewed")
    require([row["path"] for row in manifest["sources"]] == INSTALL_ORDER, "Unexpected audit remediation scope")
    for row in manifest["sources"]:
        require(row["before"] == EXISTING.get(row["path"]) and row["after"] == AFTER[row["path"]],
                "Unreviewed audit remediation bytes")
    require(all(manifest["dependencies"].get(name) == digest for name, digest in PRESERVED.items()),
            "Accepted readiness foundation changed")
    return candidates
