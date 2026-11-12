"""Exact two-file diagnostic overlay; historical health scope remains immutable."""
FAMILY = "proof-of-work-registry-timing-runtime-v1"
BASE_SOURCE_COMMIT = "037f8db7edccb9c3613f04cc77d04fd45fb7c870"
ACCEPTED_SHA = "eb63a250dd00595fa83ab7ea86fc8bafdb501907ed92af5a4ffa754e01065766"
API_SHA = "2c70db06b9735db5c8a214f0abe923022fb7f9b389bf65854358a30e6337d549"
EXISTING = {
    "server/wallet-read-observation.mjs": "b43f41d320b4b4daa51551402b6d6c5b7b165a72cf2f2349ebfd667127bbd694",
    "server/proof-api.mjs": API_SHA,
}
# Exact diagnostic bytes reproduced over the preserved accepted runtime.
AFTER = {'server/wallet-read-observation.mjs': '1fc98beb1190be8b3a088ff483be45a319ad53a66c628faf4de81c206b2ff672', 'server/proof-api.mjs': 'f413129c55442dd8382b365c814cb0456ce477920adad5da8b89b2e4b48f0f08'}
# One import-location conflict is resolved only for these complete pinned bytes.
MERGES = {'server/proof-api.mjs': {'inputs': {'active': '2c70db06b9735db5c8a214f0abe923022fb7f9b389bf65854358a30e6337d549', 'base': 'a8ae05d8e993437bd3b9160a7af226d32b106b30cc90a8435953f14c77973742', 'canonical': 'ba7acdfec176dfc33fb1ef3922246cea157b3eeacbadb8ea2348cf85c91416e0', 'conflicted': 'a6134a71f17dd3275177b5495df2a1b057d1fa86395c3e7fd12f735f740266a2'}, 'returncode': 1, 'replacements': [('<<<<<<< ACTIVE\n||||||| BASE\nimport { isReadOnlySnapshotBudgetError } from "./db/read-only-snapshot.mjs";\nimport { createWalletReadCoalescer, walletReadIdentity, measurePrivatePhase, withPrivatePhaseTimings, privateReadContext } from "./wallet-read-observation.mjs";\nconst coalesceWalletRead = createWalletReadCoalescer();\n=======\nimport { isReadOnlySnapshotBudgetError } from "./db/read-only-snapshot.mjs";\nimport { privateRegistryObservationId, withPrivateRegistryObservation, measurePrivateRegistryPhase, measurePrivateRegistryPhaseSync, createWalletReadCoalescer, walletReadIdentity, measurePrivatePhase, withPrivatePhaseTimings, privateReadContext } from "./wallet-read-observation.mjs";\nconst coalesceWalletRead = createWalletReadCoalescer();\n>>>>>>> CANDIDATE\n', ''), ('import { createWalletReadCoalescer, walletReadIdentity, measurePrivatePhase, withPrivatePhaseTimings, observePrivateHttpRequest, setPrivateReadClass, privateReadContext } from "./wallet-read-observation.mjs";\n', 'import { privateRegistryObservationId, withPrivateRegistryObservation, measurePrivateRegistryPhase, measurePrivateRegistryPhaseSync, createWalletReadCoalescer, walletReadIdentity, measurePrivatePhase, withPrivatePhaseTimings, observePrivateHttpRequest, setPrivateReadClass, privateReadContext } from "./wallet-read-observation.mjs";\n')]}}
PRESERVED = {
    "server/db/read-only-snapshot.mjs": "8495cdac8ef1c65dd9654413f254fc84f7f505d49dffce615ecc6047a8117a63",
    "server/db/proof-index-reader.mjs": "93256afae311a4db47ab13341071a6c9d3206ecca30d87dfc0a4b8ab331c285d",
}
NEW = frozenset()
ALLOWED = frozenset(EXISTING)
INSTALL_ORDER = list(EXISTING)


def validate_manifest(manifest):
    require(manifest.get("format") == FAMILY and manifest.get("baselineHead") == BASELINE_HEAD
            and manifest.get("acceptedInventorySha256") == ACCEPTED_SHA,
            "Unexpected registry timing baseline")
    candidates = validate_engine_manifest({**manifest, "format": "proof-of-work-amo-browse-scoped-runtime-v1"})
    require(set(AFTER) == set(EXISTING), "Registry timing has not been reviewed")
    require([row["path"] for row in manifest["sources"]] == INSTALL_ORDER, "Unexpected registry timing scope")
    for row in manifest["sources"]:
        require(row["before"] == EXISTING[row["path"]] and row["after"] == AFTER[row["path"]],
                "Unreviewed registry timing bytes")
    require(all(manifest["dependencies"].get(name) == digest for name, digest in PRESERVED.items()),
            "Accepted readiness foundation changed")
    return candidates
