"""Limit installation to the accepted worker plus the reviewed repair."""
FAMILY = "proof-of-work-pending-event-publication-v1"
BASE_SOURCE_COMMIT = "69c31f4e1dcd6b0bbc0f07b43e94818c98b658f6"
ACCEPTED_SHA = "c526c6531f4aa679a59d3bf8a181315cc0cdced27030b631cff1176a3739655a"
API_SHA = "997cc91ffe893e3c2f08915b97f32913922d5e52e61f8e9bf8434710d51d245f"
WORKER = "scripts/backfill-proof-indexer.mjs"
EXISTING = {WORKER: "7fa7eef004cedbe03077bade67af8d9b7b0f17f2f4885b70cf65ca7da6eee783"}
AFTER = "d9d2cac623b26a63d4659ab716b25a1bd0081ec3c71f7b0aba1d5d02e9083535"
NEW = frozenset()
ALLOWED = frozenset(EXISTING)
INSTALL_ORDER = [WORKER]


def validate_manifest(manifest):
    require(manifest.get("format") == FAMILY and manifest.get("baselineHead") == BASELINE_HEAD
            and manifest.get("acceptedInventorySha256") == ACCEPTED_SHA, "Unexpected node baseline")
    candidates = validate_engine_manifest({**manifest, "format": "proof-of-work-amo-browse-scoped-runtime-v1"})
    row, = manifest["sources"]
    require(row["path"] == WORKER and row["before"] == EXISTING[WORKER] and row["after"] == AFTER
            and manifest["dependencies"].get("server/proof-api.mjs") == API_SHA, "Unexpected worker repair")
    return candidates
