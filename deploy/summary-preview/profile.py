"""Single-file repair profile for the pinned node overlay engine."""
FAMILY = "proof-of-work-summary-preview-scoped-runtime-v1"
BASE_SOURCE_COMMIT = "e6a53e4d79a66eaac67735e609597555891c544a"
ACCEPTED_SHA = "5928497d742d714efe25df2d0a885d7ab86969782625a73b0b797e5d7e10863e"
API_SHA = "87dece8d9293654d0f32b0892bf5701fbe92ee28e4f70941d6c8b0f148938831"
NEW = frozenset()
INSTALL_ORDER = ["server/proof-api.mjs"]
ALLOWED = frozenset(INSTALL_ORDER)
install = engine_install
original_validate = validate_manifest
CANDIDATE_SHA = "c6d6d7061b28cdaeddf02613dfb77ba20481fc57e07d6add4b4f4f76f609ed5f"


def validate_manifest(manifest):
    candidates = original_validate(manifest)
    # Pinned result of replacing only compactTokenSummaryPayload in the accepted live file.
    require(sha(candidates[INSTALL_ORDER[0]]) == CANDIDATE_SHA, "Candidate exceeds approved API change")
    return candidates
