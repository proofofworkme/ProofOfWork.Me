"""Only the existing canonical-summary stream module may change."""
FAMILY = "proof-of-work-summary-stream-content-length-v1"
BASE_SOURCE_COMMIT = "42f99b237a386ff41e484012096eb458403405c7"
ACCEPTED_SHA = "440ffa00700feff9313b87bc19608e1dbf46ab09e0a1ddcb097735a363a5c9bc"
API_SHA = "997cc91ffe893e3c2f08915b97f32913922d5e52e61f8e9bf8434710d51d245f"
STREAM = "server/canonical-summary-stream.mjs"
EXISTING = {STREAM: "d08b4eab917efbf75f66c471101d08f28e7395839dd956b28606eee478613d4c"}
STREAM_AFTER = "181e6e03e65bfdbde7bd243a34cb8901c5e1c2166fb5e88ee7164710be784355"
ALLOWED = frozenset(EXISTING)
NEW = frozenset()
INSTALL_ORDER = [STREAM]


def validate_manifest(manifest):
    require(manifest.get("format") == FAMILY and manifest.get("baselineHead") == BASELINE_HEAD and
            manifest.get("acceptedInventorySha256") == ACCEPTED_SHA, "Unexpected accepted predecessor")
    candidate = validate_engine_manifest({**manifest, "format": "proof-of-work-amo-browse-scoped-runtime-v1"})
    row, = manifest["sources"]
    require(row["path"] == STREAM and row["before"] == EXISTING[STREAM] and row["after"] == STREAM_AFTER and
            manifest["dependencies"].get("server/proof-api.mjs") == API_SHA, "Unreviewed stream composition")
    return candidate
