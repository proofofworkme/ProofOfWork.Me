"""Limit installation to the accepted worker plus the reviewed repair."""
FAMILY = "proof-of-work-pending-event-publication-v1"
BASE_SOURCE_COMMIT = "c525f87bb4f0f43bdda8a165d5567dca3f182d4e"
ACCEPTED_SHA = "d1ba2ef983eafc5c8f650917425e6ea6ae1f017fb686fdff03b4979c4099a27c"
API_SHA = "997cc91ffe893e3c2f08915b97f32913922d5e52e61f8e9bf8434710d51d245f"
WORKER = "scripts/backfill-proof-indexer.mjs"
EXISTING = {WORKER: "d9d2cac623b26a63d4659ab716b25a1bd0081ec3c71f7b0aba1d5d02e9083535"}
AFTER = "561380ac6f872e930cbb3659fdb07bd04c125aca192f90bec509d402001af4d2"
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
