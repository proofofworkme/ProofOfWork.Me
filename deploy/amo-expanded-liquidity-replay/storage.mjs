import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const baseline = JSON.parse(readFileSync(new URL("../work-batch-replay/catalog-after.json", import.meta.url), "utf8"));
export const supersessions = "proof_indexer.work_amo_expanded_liquidity_supersessions_v1";
export function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const oldCatalogDigest = "ac0520bdee6d21ac5f4cc62aed0bd724319cccc776048496c32309e13968b23f";
if (sha256(stableJson(baseline)) !== oldCatalogDigest) throw Error("Unexpected native storage predecessor");

// Preserve each historical function in full after this narrowly scoped branch.
// Read-through matches the requested hash so a retained original remains readable.
const witnessChecks = readFileSync(new URL("./native-witnesses.sql", import.meta.url), "utf8");
const beforeOriginal = {
  encode_native_work_transition_v1: `
 IF NEW.network='livenet' AND NEW.block_height>=977230 THEN
  DECLARE revision proof_indexer.work_amo_expanded_liquidity_supersessions_v1%ROWTYPE;
          original_frame jsonb;
  BEGIN
   SELECT * INTO revision FROM proof_indexer.work_amo_expanded_liquidity_supersessions_v1
    WHERE network=NEW.network AND block_height=NEW.block_height AND block_hash=NEW.block_hash;
   IF FOUND THEN
    IF (to_jsonb(NEW)-ARRAY['payload','created_at','event_set_sha256']) IS DISTINCT FROM (revision.old_main-ARRAY['payload','created_at','event_set_sha256'])
     OR NEW.payload ? '__powNativeStorage'
     OR NEW.event_set_sha256 IS DISTINCT FROM NEW.payload#>>'{eventSetCommitment,sha256}'
     OR encode(sha256(jsonb_send(NEW.payload)),'hex') IS DISTINCT FROM revision.new_manifest->>'sha256'
     OR NEW.payload IS DISTINCT FROM proof_indexer.reconstruct_work_transition_payload_v1(revision.new_manifest)
    THEN RAISE EXCEPTION 'Conflicting expanded liquidity transition'; END IF;
    SELECT proof_indexer.reconstruct_work_transition_payload_v1(a.payload) INTO STRICT original_frame
     FROM proof_indexer.work_transition_archive_v1 a
     WHERE a.network=NEW.network AND a.block_height=NEW.block_height AND a.block_hash=NEW.block_hash
       AND a.payload->>'sha256'=revision.old_archive_sha256;
    IF original_frame ? 'expandedLiquidity' OR NEW.payload IS DISTINCT FROM (original_frame || revision.replacement_fields)
     OR revision.old_main->>'event_set_sha256' IS DISTINCT FROM original_frame#>>'{eventSetCommitment,sha256}'
    THEN RAISE EXCEPTION 'Expanded replay frame is not bound to its immutable original'; END IF;
${witnessChecks}
    NEW.created_at := (revision.old_main->>'created_at')::timestamptz;
    NEW.payload := proof_indexer.work_transition_metadata_v1(NEW.payload) || jsonb_build_object('__powNativeStorage',
      jsonb_build_object('model','proof-indexer-native-transition-chunks-v1','sha256',revision.new_manifest->>'sha256'));
    RETURN NEW;
   END IF;
  END;
 END IF;`,
  read_work_transition_payload_v1: `
 IF n='livenet' AND h>=977230 AND p ? '__powNativeStorage' THEN
  SELECT new_manifest INTO manifest FROM proof_indexer.work_amo_expanded_liquidity_supersessions_v1
   WHERE network=n AND block_height=h AND block_hash=bh AND new_manifest->>'sha256'=p#>>'{__powNativeStorage,sha256}';
  IF FOUND THEN
   IF p#>>'{__powNativeStorage,model}' IS DISTINCT FROM 'proof-indexer-native-transition-chunks-v1'
   THEN RAISE EXCEPTION 'Unknown expanded liquidity storage envelope'; END IF;
   SELECT payload INTO original FROM proof_indexer.work_transition_hot_slots_v1
    WHERE network=n AND slot=mod(h,128) AND block_height=h AND block_hash=bh AND payload_sha256=manifest->>'sha256';
   IF original IS NULL THEN original:=proof_indexer.reconstruct_work_transition_payload_v1(manifest); END IF;
   IF proof_indexer.work_transition_metadata_v1(original) IS DISTINCT FROM p-'__powNativeStorage'
    OR encode(sha256(jsonb_send(original)),'hex') IS DISTINCT FROM manifest->>'sha256'
   THEN RAISE EXCEPTION 'Invalid expanded liquidity native frame'; END IF;
   RETURN original;
  END IF;
 END IF;`,
  verify_work_transition_hot_slot_v1: `
 IF NEW.network='livenet' AND NEW.block_height>=977230 THEN
  SELECT new_manifest->>'sha256' INTO expected FROM proof_indexer.work_amo_expanded_liquidity_supersessions_v1
   WHERE network=NEW.network AND block_height=NEW.block_height AND block_hash=NEW.block_hash;
  IF FOUND THEN
   IF NEW.slot IS DISTINCT FROM mod(NEW.block_height,128) OR NEW.payload_sha256 IS DISTINCT FROM expected
    OR encode(sha256(jsonb_send(NEW.payload)),'hex') IS DISTINCT FROM expected
   THEN RAISE EXCEPTION 'Unverified expanded liquidity hot slot'; END IF;
   RETURN NEW;
  END IF;
 END IF;`
};

export const nativeFunctionDefinitions = [];
for (const fn of baseline.functions) {
  const addition = beforeOriginal[fn.name];
  if (!addition) continue;
  if (!fn.definition.includes("\nBEGIN\n")) throw Error("Unrecognized native function " + fn.name);
  nativeFunctionDefinitions.push(fn.definition.replace("\nBEGIN\n", () => "\nBEGIN" + addition + "\n"));
}
if (nativeFunctionDefinitions.length !== 3) throw Error("Incomplete native storage contract");
