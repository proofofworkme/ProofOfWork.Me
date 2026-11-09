"""Pin all producers and readers of the pending event projection."""
FAMILY = "proof-of-work-pending-event-publication-v1"
BASE_SOURCE_COMMIT = "c4f119104f519083f0dc9f818fad745243b930dc"
ACCEPTED_SHA = "001456c148aac1c143337598e06c7bc93babefe8dd4d2b9978f03eb56811c65a"
API_SHA = "997cc91ffe893e3c2f08915b97f32913922d5e52e61f8e9bf8434710d51d245f"
EXISTING = {
    "server/work-q16-pending-projection.mjs": "e97b8cf4d4c7232483bc383cdd1522cd230499f0d8d2c87a616723c94cea2ace",
    "scripts/backfill-proof-indexer.mjs": "561380ac6f872e930cbb3659fdb07bd04c125aca192f90bec509d402001af4d2",
    "scripts/run-proof-indexer-worker.mjs": "7f43fb67ccd615f7c7488c09cd92a84183e6ee7092754292ebc6ab3423047706",
    "server/db/proof-index-reader.mjs": "a9514611ac1266ace0289c2c9eb055de946d33a30ec8815fef127422ddcc57d2",
}
AFTER = {
    "server/work-q16-pending-projection.mjs": "1b871d95bbe7f7b9918fd035afacbd56e96e41aa6706a78f8e1f702fe0e28580",
    "scripts/backfill-proof-indexer.mjs": "ebdb4dd5792eb0f69f4dff62ed0f11255b927f7e5e8ca14ff604239b4ef55957",
    "scripts/run-proof-indexer-worker.mjs": "e63d354f0812de155667da1ab03e01d10fc87126290032e16e5625dd9c8d5b55",
    "server/db/proof-index-reader.mjs": "be5f0fb1447ef8d22bb2100c7b0b8d318223e80838bb6ea9c2da2029e64027a9",
}
NEW = frozenset()
ALLOWED = frozenset(EXISTING)
INSTALL_ORDER = list(EXISTING)


def validate_manifest(manifest):
    require(manifest.get("format") == FAMILY and manifest.get("baselineHead") == BASELINE_HEAD
            and manifest.get("acceptedInventorySha256") == ACCEPTED_SHA, "Unexpected node baseline")
    candidates = validate_engine_manifest({**manifest, "format": "proof-of-work-amo-browse-scoped-runtime-v1"})
    require([row["path"] for row in manifest["sources"]] == INSTALL_ORDER
            and manifest["dependencies"].get("server/proof-api.mjs") == API_SHA, "Unexpected repair scope")
    for row in manifest["sources"]:
        require(row["before"] == EXISTING[row["path"]] and row["after"] == AFTER[row["path"]], "Unexpected runtime bytes")
    return candidates
