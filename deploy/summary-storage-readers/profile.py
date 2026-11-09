"""Additional reviewed scope for the hash-pinned source overlay installer."""
FAMILY = "proof-of-work-summary-storage-readers-scoped-runtime-v1"
BASE_SOURCE_COMMIT = "ac0d4373a09178228b36f51dc6f4dde4b8d9bc28"
ACCEPTED_SHA = "96213da3e3bdc800be17967cbf977a9ac9ec65adf89e972ca17005da598f1899"
API_SHA = "99311503bc4d0907b398951ba7d8fefd111086e6664de532af4110dbe77aa6c7"
EXISTING = {
    "scripts/backfill-proof-indexer.mjs": "20118fad364e4b92796a2d33b6c65a3f52320f330e1564561145448026ef0f4f",
    "server/proof-api.mjs": API_SHA,
    "server/db/proof-index-reader.mjs": "176d5ff850a770b590097bdcefd777a6ca7633eae7415bcd3427443578337391",
    "server/db/permission-reader.mjs": "8477080c4c581555868d2592e9e50ba80da25b7b9e3808234ae6acdd00152628",
    "server/permission-verification-store.mjs": "cee8642d4e4368741d00c5c8c1a969b9c5e327b8654b40151a825587bab27d2b",
    "server/permission-discovery.mjs": "35da3596150284d7f4f7f6e073ed9313a592b6f68170fe6c149127c5db6ff67b",
}
NEW = frozenset({"server/candidate-discovery-reorg.mjs", "server/canonical-summary-stream.mjs",
                 "server/db/permission-supersession.mjs", "server/db/work-transfer-projection-store.mjs"})
ALLOWED = NEW | EXISTING.keys()
INSTALL_ORDER = sorted(NEW) + sorted(EXISTING.keys() - {"server/proof-api.mjs", "scripts/backfill-proof-indexer.mjs"}) + [
    "scripts/backfill-proof-indexer.mjs", "server/proof-api.mjs"]
# Reviewed three-way compositions over the accepted node runtime.
EXPECTED_AFTER = {
    "scripts/backfill-proof-indexer.mjs": "7fa7eef004cedbe03077bade67af8d9b7b0f17f2f4885b70cf65ca7da6eee783",
    "server/proof-api.mjs": "997cc91ffe893e3c2f08915b97f32913922d5e52e61f8e9bf8434710d51d245f",
    "server/db/proof-index-reader.mjs": "a9514611ac1266ace0289c2c9eb055de946d33a30ec8815fef127422ddcc57d2",
    "server/db/permission-reader.mjs": "4b3f3b78603c256b6fac5fde96822ffa9eae600d6dc44aa51009d79d4043dacb",
    "server/permission-verification-store.mjs": "6e457f22390bc94662234e887b0f73842951d5b6d4df024a82bd414790dd3236",
    "server/permission-discovery.mjs": "4867a325cba547a5401b86736cf4dc63e67bfb86564fb36d31921e54bcbca727",
    "server/candidate-discovery-reorg.mjs": "9fc3ba373d312f983baa03b0925bf156aa11771fee90615ff7deb5feee6eb17e",
    "server/canonical-summary-stream.mjs": "d08b4eab917efbf75f66c471101d08f28e7395839dd956b28606eee478613d4c",
    "server/db/permission-supersession.mjs": "94f9dd43530c3613fce2242fdb7fbc3b70c7179d4ed01a4c7a1eb578eeb9b80b",
    "server/db/work-transfer-projection-store.mjs": "08db31ec901e6f6127434af8bd108024d4b554c84e9cd97310a9de4ac8b46e0e"
}
original_validate = validate_manifest


def validate_manifest(manifest):
    candidates = original_validate(manifest)
    require(set(EXPECTED_AFTER) == ALLOWED and [row["path"] for row in manifest["sources"]] == INSTALL_ORDER,
            "Unreviewed source closure")
    for row in manifest["sources"]:
        require(row["before"] == EXISTING.get(row["path"]) and row["after"] == EXPECTED_AFTER[row["path"]],
                "Unreviewed composed source: " + row["path"])
    return candidates
