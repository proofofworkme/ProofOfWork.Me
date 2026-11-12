"""Exact single-function reader overlay; all other accepted runtime bytes survive."""
FAMILY = "proof-of-work-activity-fee-factor-runtime-v1"
BASE_SOURCE_COMMIT = "a04684f8f04251f4f378a8d58ba382049c7968cd"
ACCEPTED_SHA = "95c25e474c2344b061d31eb396184582d6fe3651f235074ad8d4d75e7784cd61"
API_SHA = "e6b2c9e8bfa6ad60f624481605ea7d76c1d781730dd8f2fabb8ca2d490ac8a6e"
EXISTING = {'server/db/proof-index-reader.mjs': '93256afae311a4db47ab13341071a6c9d3206ecca30d87dfc0a4b8ab331c285d'}
AFTER = {'server/db/proof-index-reader.mjs': '06c9023cae5a63fbb7b93f20ba7804d76abdf4af6a0bd72ecbea56fa6971018b'}
SPLICE = {'path': 'server/db/proof-index-reader.mjs', 'active': '93256afae311a4db47ab13341071a6c9d3206ecca30d87dfc0a4b8ab331c285d', 'base': '6273aedada164d00670f99f9f8132d8b5b1b98464a0abda093d505852f8ff842', 'canonical': 'cd41b9bf688914024718dde5ce2d91085c6b2864943dc88f699d9af8f2323ead', 'oldFunction': '677466f361374560775b02463a8550df33c2e9fa11fec08297eb3e5016f11717', 'newFunction': '48ac9a5918cca7c603858cd3726f9162acc0822440784a75f7e9a15136628c4c', 'after': '06c9023cae5a63fbb7b93f20ba7804d76abdf4af6a0bd72ecbea56fa6971018b'}
PRESERVED = {"server/proof-api.mjs": API_SHA, "server/db/read-only-snapshot.mjs": "8495cdac8ef1c65dd9654413f254fc84f7f505d49dffce615ecc6047a8117a63"}
NEW = frozenset()
ALLOWED = frozenset(EXISTING)
INSTALL_ORDER = ["server/db/proof-index-reader.mjs"]

def validate_manifest(manifest):
    require(manifest.get("format") == FAMILY and manifest.get("baselineHead") == BASELINE_HEAD
            and manifest.get("acceptedInventorySha256") == ACCEPTED_SHA, "Unexpected activity baseline")
    candidates = validate_engine_manifest({**manifest, "format": "proof-of-work-amo-browse-scoped-runtime-v1"})
    require(set(AFTER) == set(ALLOWED), "Activity result is not reviewed")
    require([row["path"] for row in manifest["sources"]] == INSTALL_ORDER, "Unexpected activity scope")
    for row in manifest["sources"]:
        require(row["before"] == EXISTING[row["path"]] and row["after"] == AFTER[row["path"]], "Unreviewed activity bytes")
    require(all(manifest["dependencies"].get(name) == digest for name, digest in PRESERVED.items()), "Accepted readiness foundation changed")
    return candidates
