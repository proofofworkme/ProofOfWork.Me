"""Additional exact scope for the linked-file discovery release. Used on the node VPS."""
FAMILY = "proof-of-work-powcat-discovery-scoped-runtime-v1"
BASE_SOURCE_COMMIT = "17f22bde4f94d9972974006e1603c28d1b20d2b9"
ACCEPTED_SHA = "e81e8308520d7c47095823824c41078c4a55da8f726e59db6a4af01e76a6d9f3"
EXISTING = {
    "src/shared/protocol/codeRepository.mjs": "98021446324da7a633b62f7d8467e5729ef05d9c061735dc5f12fc77a70acea9",
    "server/code-repositories.mjs": "284a867481edf4ccc55944ea628ac967eca8f65252b99a00cc543de1260df333",
    "server/db/code-reader.mjs": "ccf0a6b39496e76670cb7ef4f581b464165451847877cc6df97285c1b9232bf1",
    "server/proof-index-event-relations.mjs": "271d54b8f4a77f2c7cba21ada5e019726d80f0720533fc28856cace772117511",
    "scripts/backfill-proof-indexer.mjs": "e5b0e63e7d8e6d4ebfa09d1cd8aefc12944a9fe6df5db72eebd4916b54d3cbaf",
    "server/db/proof-index-reader.mjs": "f5044729ae53014705641025d99c12219b2559bd4c5a94c15fcfaae6b0d67f16",
    "server/db/search-reader.mjs": "e09664218b78aeb2364db8fab7083065665bfa5092cb79761a28cc75b96195e6",
    "server/search-projection.mjs": "6c6e1cdb027828a2cbd8966dd821e0b459855882eaeaaa03cdfc8f8a3a7e5e97",
    "server/proof-api.mjs": "c626b0d8bc7632832f09aedeb7f9fd8997410061ee3b8984b914a4f42d8b05e4",
    "src/shared/protocol/powcat1.mjs": "e6143e8aab0f450953e7faa84153c5665210f504ce3b909dcf35423286e309fd",
}
NEW = frozenset({"server/db/powcat-activity.mjs", "server/search-powcat.mjs", "server/powcat-index.mjs",
                 "src/shared/protocol/powcatMail.mjs"})
API_SHA = EXISTING["server/proof-api.mjs"]
ALLOWED = NEW | EXISTING.keys()
INSTALL_ORDER = sorted(NEW) + sorted(EXISTING.keys() - {"server/proof-api.mjs"}) + ["server/proof-api.mjs"]
validate_powcat_manifest = validate_manifest


def merge_search_coverage(raw):
    # Keep the accepted generation-sharing query, including its base parameter
    # and effective-documents CTE. Insert the typed aggregates from v5.
    begin, end = b"<<<<<<< ACTIVE\n", b">>>>>>> CANDIDATE\n"
    require(raw.count(begin) == raw.count(end) == 1, "Unreviewed Search merge conflict")
    before, _, rest = raw.partition(begin)
    conflict, _, after = rest.partition(end)
    require(sha(conflict) == "3228160671780e7f4142f1b3510f4efc5bae364b31c380a84899f20f63249234",
            "Search merge differs from reviewed coverage query")
    active, rest = conflict.split(b"||||||| BASE\n")
    _, candidate = rest.split(b"=======\n")
    aggregates = candidate[candidate.index(b" AS count,"):candidate.index(b"    FROM proof_indexer.search_documents")]
    merged = before + active.replace(b" AS count\n", aggregates) + after
    require(sha(merged) == "e1b3a0dd621fed27e7c49327e5a5b667b3187a8017c255ae41fcca0bc32a503d",
            "Unexpected composed Search reader")
    return merged


def validate_manifest(manifest):
    candidates = validate_powcat_manifest(manifest)
    require([row["path"] for row in manifest["sources"]] == INSTALL_ORDER, "Unexpected discovery scope or order")
    for row in manifest["sources"]:
        require(row["before"] == EXISTING.get(row["path"]), "Unexpected accepted discovery source")
    return candidates
