"""Profile appended to the hash-pinned node source overlay engine."""
FAMILY = "proof-of-work-pending-discovery-scoped-runtime-v1"
BASE_SOURCE_COMMIT = "6b5c5d62e640f06a289b387851bae9f0c44de6ae"
ACCEPTED_SHA = "e0b88282bbdc0c4353f1d2451f81840d938c71b666efc43de59a56975d5f1ab9"
API_SHA = "c6d6d7061b28cdaeddf02613dfb77ba20481fc57e07d6add4b4f4f76f609ed5f"
EXISTING = {
    "scripts/backfill-proof-indexer.mjs": "c2a4db21e5fbf6d7283fb03bbaf1efa251d39d0b10f69ab4fd6be7fc976c3d51",
    "server/proof-api.mjs": API_SHA,
}
NEW = frozenset({"server/pending-broadcast-hints.mjs", "server/pending-mempool-discovery.mjs"})
ALLOWED = NEW | EXISTING.keys()
INSTALL_ORDER = sorted(NEW) + ["scripts/backfill-proof-indexer.mjs", "server/proof-api.mjs"]
# Pin the composition after both public producers and the worker reader are fixed.
# An incomplete review cannot produce or apply a plan.
EXPECTED_AFTER = {
    "scripts/backfill-proof-indexer.mjs": "20118fad364e4b92796a2d33b6c65a3f52320f330e1564561145448026ef0f4f",
    "server/proof-api.mjs": "99311503bc4d0907b398951ba7d8fefd111086e6664de532af4110dbe77aa6c7",
    "server/pending-broadcast-hints.mjs": "0f180dd79422533706feb344cc0a0798fd3ffba65a543de72d30dd3dfcb86ee7",
    "server/pending-mempool-discovery.mjs": "ec2c7c5218367e47fa0b398d5417ef72ebd30a54e7e7b2042741ae82834b771c",
}
original_validate = validate_manifest


def validate_manifest(manifest):
    candidates = original_validate(manifest)
    require(set(EXPECTED_AFTER) == ALLOWED and [row["path"] for row in manifest["sources"]] == INSTALL_ORDER,
            "Incomplete or expanded pending discovery release")
    for row in manifest["sources"]:
        require(row["before"] == EXISTING.get(row["path"]) and row["after"] == EXPECTED_AFTER[row["path"]],
                "Unreviewed pending source composition: " + row["path"])
    return candidates
