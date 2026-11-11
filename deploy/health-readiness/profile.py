"""Exact existing runtime scope for bounded wallet readiness admission."""
FAMILY = "proof-of-work-health-readiness-runtime-v1"
BASE_SOURCE_COMMIT = "d9fa69d9e1e466fde74c69fccd01f5606db1a84b"
ACCEPTED_SHA = "66d9614c8d821b62cea6014dbb37f0316470ed8db4d533d21886b50aba0393e7"
API_SHA = "997cc91ffe893e3c2f08915b97f32913922d5e52e61f8e9bf8434710d51d245f"
EXISTING = {
    "server/db/read-only-snapshot.mjs": "68559f94ede25461c25fe7e8fdf19789643331dad8b005b149960ed29f1183ae",
    "server/db/proof-index-reader.mjs": "be5f0fb1447ef8d22bb2100c7b0b8d318223e80838bb6ea9c2da2029e64027a9",
    "server/proof-api.mjs": API_SHA,
}
# Exact runtime bytes reproduced from canonical source and independently rehearsed.
AFTER = {
    "server/db/read-only-snapshot.mjs": "8495cdac8ef1c65dd9654413f254fc84f7f505d49dffce615ecc6047a8117a63",
    "server/db/proof-index-reader.mjs": "93256afae311a4db47ab13341071a6c9d3206ecca30d87dfc0a4b8ab331c285d",
    "server/proof-api.mjs": "2c70db06b9735db5c8a214f0abe923022fb7f9b389bf65854358a30e6337d549",
}
# Exact accepted/base/canonical/conflict bytes; no future merge authority.
MERGES = {
    "server/db/proof-index-reader.mjs": {
        "inputs": {
            "active": EXISTING["server/db/proof-index-reader.mjs"],
            "base": "a3996b4b57aced63ffcfa0fe59afff2fad18feff4e3ee483549744c5287d1dad",
            "canonical": "6273aedada164d00670f99f9f8132d8b5b1b98464a0abda093d505852f8ff842",
            "conflicted": "f97684a8c3dc7cf122c484c1a8219abb98c78a692216608c9aa71ce17f735715",
        },
        "returncode": 4, "conflictSides": [0, 2, 2, 2],
    },
    "server/proof-api.mjs": {
        "inputs": {
            "active": API_SHA,
            "base": "bc1f4fb353332cb9035aea16c01a88db4f962a072fb3fbef16b5e9ad16775b04",
            "canonical": "a8ae05d8e993437bd3b9160a7af226d32b106b30cc90a8435953f14c77973742",
            "conflicted": "335980b19007751d6eb9f93cdbbf8b7d9a4e87b9225f6ed2354326ac4f2a702c",
        },
        "returncode": 1, "conflictSides": [2],
    },
}
NEW = frozenset()
ALLOWED = frozenset(EXISTING)
INSTALL_ORDER = list(EXISTING)


def validate_manifest(manifest):
    require(manifest.get("format") == FAMILY and manifest.get("baselineHead") == BASELINE_HEAD
            and manifest.get("acceptedInventorySha256") == ACCEPTED_SHA, "Unexpected health repair baseline")
    candidates = validate_engine_manifest({**manifest, "format": "proof-of-work-amo-browse-scoped-runtime-v1"})
    require(set(AFTER) == set(EXISTING), "Health repair has not been reviewed")
    require([row["path"] for row in manifest["sources"]] == INSTALL_ORDER, "Unexpected health repair scope")
    for row in manifest["sources"]:
        require(row["before"] == EXISTING[row["path"]] and row["after"] == AFTER[row["path"]],
                "Unreviewed health repair bytes")
    return candidates
