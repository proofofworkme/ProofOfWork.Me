-- Private reviewed-candidate proposal only. Never run outside the dedicated publisher.
CREATE TABLE proof_indexer.work_batch_transition_supersessions_v1 (
 network text NOT NULL CHECK(network='livenet'),
 block_height integer NOT NULL CHECK(block_height>=973104),
 block_hash text NOT NULL CHECK(block_hash~'^[0-9a-f]{64}$'),
 incident_txid text NOT NULL CHECK(incident_txid='b7c620e48c2d725a143cecd7f7808036d89907124d410ba57d272d34e650cc28'),
 qualification_sha256 text NOT NULL CHECK(qualification_sha256~'^[0-9a-f]{64}$'),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256~'^[0-9a-f]{64}$'),
 source_commit text NOT NULL CHECK(source_commit~'^[0-9a-f]{40}$'),
 source_tree text NOT NULL CHECK(source_tree~'^[0-9a-f]{40}$'),
 through_height integer NOT NULL CHECK(through_height BETWEEN 973104 AND 973615 AND block_height<=through_height),
 through_hash text NOT NULL CHECK(through_hash~'^[0-9a-f]{64}$'),
 old_main jsonb NOT NULL CHECK(jsonb_typeof(old_main)='object' AND old_main ?& ARRAY['network','block_height','block_hash','previous_block_hash','model','state_commitment_model','opening_network_value_q8','closing_network_value_q8','opening_state_sha256','closing_state_sha256','opening_state_payload_bytes','closing_state_payload_bytes','protocol_record_count','raw_protocol_candidate_count','transaction_count','event_count','event_set_model','event_set_sha256','event_set_payload_bytes','block_atomic','fee_once','invalid_zero','complete','payload','created_at','work_token_state_model'] AND old_main-ARRAY['network','block_height','block_hash','previous_block_hash','model','state_commitment_model','opening_network_value_q8','closing_network_value_q8','opening_state_sha256','closing_state_sha256','opening_state_payload_bytes','closing_state_payload_bytes','protocol_record_count','raw_protocol_candidate_count','transaction_count','event_count','event_set_model','event_set_sha256','event_set_payload_bytes','block_atomic','fee_once','invalid_zero','complete','payload','created_at','work_token_state_model']='{}'::jsonb),
 old_archive_sha256 text NOT NULL CHECK(old_archive_sha256~'^[0-9a-f]{64}$'),
 new_metadata jsonb NOT NULL CHECK(jsonb_typeof(new_metadata)='object'),
 new_manifest jsonb NOT NULL CHECK((new_manifest->>'model'='audit31-native-jsonb-chunks-v1' AND new_manifest->>'sha256'~'^[0-9a-f]{64}$' AND jsonb_typeof(new_manifest->'parts')='array') IS TRUE),
 replacement_fields jsonb NOT NULL CHECK((jsonb_typeof(replacement_fields)='object' AND replacement_fields ?& ARRAY['workBatchV1','transitionChainCommitment','replayRecords','replayDescriptorCommitment','traces','eventSetCommitment'] AND replacement_fields-ARRAY['workBatchV1','transitionChainCommitment','replayRecords','replayDescriptorCommitment','traces','eventSetCommitment']='{}'::jsonb
 AND jsonb_typeof(replacement_fields->'replayRecords')='array' AND jsonb_array_length(replacement_fields->'replayRecords')<=2048
 AND jsonb_typeof(replacement_fields->'traces')='array' AND jsonb_array_length(replacement_fields->'traces')<=2048
 AND jsonb_typeof(replacement_fields->'replayDescriptorCommitment')='object'
 AND jsonb_typeof(replacement_fields->'eventSetCommitment')='object'
 AND jsonb_typeof(replacement_fields->'transitionChainCommitment')='object') IS TRUE),
 relational_bindings jsonb NOT NULL CHECK((jsonb_typeof(relational_bindings)='object'
 AND relational_bindings ?& ARRAY['eventCount','eventRowsSha256','recordCount','recordRowsSha256']
 AND relational_bindings-ARRAY['eventCount','eventRowsSha256','recordCount','recordRowsSha256']='{}'::jsonb
 AND (relational_bindings->>'recordCount')::integer BETWEEN 0 AND 1024
 AND (relational_bindings->>'eventCount')::integer BETWEEN (relational_bindings->>'recordCount')::integer AND 2*(relational_bindings->>'recordCount')::integer
 AND relational_bindings->>'eventRowsSha256'~'^[0-9a-f]{64}$'
 AND relational_bindings->>'recordRowsSha256'~'^[0-9a-f]{64}$') IS TRUE),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(network,block_hash),
 UNIQUE(network,block_height),
 CHECK((old_main->>'network'=network AND (old_main->>'block_height')::integer=block_height AND old_main->>'block_hash'=block_hash) IS TRUE),
 CHECK((old_main->'payload'->'__powNativeStorage'->>'model'='proof-indexer-native-transition-chunks-v1' AND old_main->'payload'->'__powNativeStorage'->>'sha256'=old_archive_sha256) IS TRUE),
 CHECK((new_metadata-'event_set_sha256'=old_main-ARRAY['payload','created_at','event_set_sha256']
  AND new_metadata->>'event_set_sha256'=replacement_fields->'eventSetCommitment'->>'sha256'
  AND new_metadata->>'event_set_sha256'~'^[0-9a-f]{64}$') IS TRUE),
 CHECK((replacement_fields->'workBatchV1'->'declaration'->>'txid'=incident_txid) IS TRUE),
 CHECK(((replacement_fields->'workBatchV1'->>'activationHeight')::integer=973104) IS TRUE)
) TABLESPACE proof_indexer_large_state_v1;
CREATE TRIGGER immutable_work_batch_supersession_v1 BEFORE UPDATE OR DELETE ON proof_indexer.work_batch_transition_supersessions_v1 FOR EACH ROW EXECUTE FUNCTION proof_indexer.reject_work_transition_archive_mutation_v1();
ALTER TABLE proof_indexer.work_batch_transition_supersessions_v1 OWNER TO proof_indexer_transition_storage_owner;
REVOKE ALL ON proof_indexer.work_batch_transition_supersessions_v1 FROM PUBLIC;
GRANT SELECT ON proof_indexer.work_batch_transition_supersessions_v1 TO proof_indexer;

CREATE OR REPLACE FUNCTION proof_indexer.encode_native_work_transition_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE manifest jsonb; native_timestamp timestamptz; replacement proof_indexer.work_batch_transition_supersessions_v1%ROWTYPE;
 original jsonb; old_item jsonb; new_item jsonb; field text; ordinal integer;
 old_clean jsonb; new_clean jsonb; old_parent jsonb; new_parent jsonb;
 old_descriptor jsonb; new_descriptor jsonb; old_witness jsonb; new_witness jsonb;
 witness_path text[]; paths text[][]; raw_count integer:=0; child_count integer:=0; parent_count integer;
BEGIN
 IF NEW.payload ? '__powNativeStorage' THEN RAISE EXCEPTION 'Native storage envelope cannot be supplied as protocol evidence';END IF;
 -- The only alternate interpretation is an immutable, prequalified incident row.
 SELECT * INTO replacement FROM proof_indexer.work_batch_transition_supersessions_v1
 WHERE network=NEW.network AND block_height=NEW.block_height AND block_hash=NEW.block_hash;
 IF FOUND THEN
  IF to_jsonb(NEW)-ARRAY['payload','created_at'] IS DISTINCT FROM replacement.new_metadata
   OR encode(sha256(jsonb_send(NEW.payload)),'hex') IS DISTINCT FROM replacement.new_manifest->>'sha256'
   OR NEW.payload IS DISTINCT FROM proof_indexer.reconstruct_work_transition_payload_v1(replacement.new_manifest)
   OR NEW.payload->'workBatchV1' IS DISTINCT FROM replacement.replacement_fields->'workBatchV1'
   OR NEW.payload->'transitionChainCommitment' IS DISTINCT FROM replacement.replacement_fields->'transitionChainCommitment'
  THEN RAISE EXCEPTION 'Unqualified batch transition interpretation';END IF;
  SELECT proof_indexer.reconstruct_work_transition_payload_v1(a.payload) INTO STRICT original
   FROM proof_indexer.work_transition_archive_v1 a
   WHERE a.network=NEW.network AND a.block_height=NEW.block_height AND a.block_hash=NEW.block_hash
    AND a.payload->>'sha256'=replacement.old_archive_sha256;
  IF original ? 'workBatchV1' OR NEW.payload IS DISTINCT FROM original||replacement.replacement_fields
   OR jsonb_array_length(NEW.payload->'replayRecords') IS DISTINCT FROM NEW.event_count
   OR NEW.raw_protocol_candidate_count IS DISTINCT FROM NEW.protocol_record_count
   OR NEW.event_count NOT BETWEEN NEW.protocol_record_count AND 2*NEW.protocol_record_count
   OR NEW.event_count IS DISTINCT FROM (replacement.relational_bindings->>'eventCount')::integer
   OR NEW.protocol_record_count IS DISTINCT FROM (replacement.relational_bindings->>'recordCount')::integer
   OR jsonb_array_length(NEW.payload->'traces') IS DISTINCT FROM NEW.protocol_record_count+NEW.transaction_count
   OR NEW.event_set_sha256 IS DISTINCT FROM NEW.payload->'eventSetCommitment'->>'sha256'
   OR replacement.old_main->>'event_set_sha256' IS DISTINCT FROM original->'eventSetCommitment'->>'sha256'
   OR NEW.event_set_model IS DISTINCT FROM NEW.payload->'eventSetCommitment'->>'model'
   OR NEW.event_set_payload_bytes IS DISTINCT FROM (NEW.payload->'eventSetCommitment'->>'payloadBytes')::integer
   OR NEW.event_count IS DISTINCT FROM (NEW.payload->'eventSetCommitment'->>'eventCount')::integer
  THEN RAISE EXCEPTION 'Unsupported replay interpretation shape';END IF;
  FOREACH field IN ARRAY ARRAY['transitionChainCommitment','replayDescriptorCommitment','eventSetCommitment'] LOOP
   IF (jsonb_typeof(original->field)='object' AND jsonb_typeof(NEW.payload->field)='object'
    AND (original->field)-'sha256'=(NEW.payload->field)-'sha256'
    AND original->field->>'sha256'~'^[0-9a-f]{64}$'
    AND NEW.payload->field->>'sha256'~'^[0-9a-f]{64}$') IS NOT TRUE
   THEN RAISE EXCEPTION 'Replay commitment metadata changed';END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['replayRecords','traces'] LOOP
   IF jsonb_typeof(original->field) IS DISTINCT FROM 'array'
    OR jsonb_array_length(original->field) IS DISTINCT FROM jsonb_array_length(NEW.payload->field)
   THEN RAISE EXCEPTION 'Replay array shape changed';END IF;
   FOR ordinal IN 0..jsonb_array_length(original->field)-1 LOOP
    old_item:=original->field->ordinal;new_item:=NEW.payload->field->ordinal;
    old_clean:=old_item;new_clean:=new_item;
    IF field='traces' THEN
     IF (old_item->>'kind'=ANY(ARRAY['protocol-record','transaction-fee'])) IS NOT TRUE
     THEN RAISE EXCEPTION 'Unsupported replay trace';END IF;
     paths:=ARRAY[ARRAY['transitionChainCommitmentAfter']];
    ELSIF old_item->'rawCandidate'='true'::jsonb THEN
     raw_count:=raw_count+1;
     IF (old_item->>'protocol'=ANY(ARRAY['pwm1','pwa1','pwid1','pwdns1','pwb1','pwt1','pwc1'])
      AND jsonb_typeof(old_item->'derived')='array' AND jsonb_array_length(old_item->'derived') BETWEEN 0 AND 1) IS NOT TRUE
     THEN RAISE EXCEPTION 'Unsupported raw replay record';END IF;
     paths:=ARRAY[ARRAY['transitionChainCommitmentAfter']];
     IF jsonb_array_length(old_item->'derived')=1 THEN
      old_descriptor:=old_item->'derived'->0;new_descriptor:=new_item->'derived'->0;
      IF (old_item->>'protocol'='pwt1' AND old_item#>>'{outcome,semanticKind}'='token-sale'
       AND old_item#>'{outcome,valid}'='true'::jsonb
       AND old_item#>>'{rawWitness,model}'='canonical-raw-protocol-record-v1'
       AND jsonb_array_length(old_item#>'{rawWitness,rawRecordParts}')=1
       AND old_item#>>'{rawWitness,rawRecordParts,0,text}' LIKE 'pwt1:buy5:%'
       AND old_descriptor->>'kind'='token-listing-closed' AND old_descriptor->'derivedIndex'='0'::jsonb
       AND old_descriptor->'rawCandidate'='false'::jsonb AND old_descriptor->'economicDelta'='false'::jsonb
       AND old_descriptor->'chargesTransactionFee'='false'::jsonb AND old_descriptor->'claimsEconomicOutputs'='false'::jsonb
       AND old_descriptor->'containerPosition'=old_item->'position'
       AND old_descriptor->'materializationPosition'=old_item->'position'
       AND (old_descriptor->'projectionPosition')-'recordOrdinal'=(old_item->'position')-'recordOrdinal'
       AND (old_descriptor#>>'{projectionPosition,recordOrdinal}')::integer=(old_item#>>'{position,recordOrdinal}')::integer+1
       AND old_descriptor->'parentTransitionChainCommitmentAfter'=old_item->'transitionChainCommitmentAfter'
       AND new_descriptor->'parentTransitionChainCommitmentAfter'=new_item->'transitionChainCommitmentAfter') IS NOT TRUE
      THEN RAISE EXCEPTION 'Unsupported derived closure parent';END IF;
      SELECT count(*) INTO parent_count FROM jsonb_array_elements(NEW.payload->'replayRecords') c
       WHERE c->'rawCandidate'='false'::jsonb AND c->>'txid'=new_item->>'txid' AND c->'parentPosition'=new_item->'position'
        AND c#>'{rawWitness,descriptor}'=new_descriptor;
      IF parent_count<>1 THEN RAISE EXCEPTION 'Derived closure child is not unique';END IF;
      old_witness:=old_descriptor->'parentTransitionChainCommitmentAfter';new_witness:=new_descriptor->'parentTransitionChainCommitmentAfter';
      IF (old_witness-'sha256'=new_witness-'sha256'
       AND old_witness->>'sha256'~'^[0-9a-f]{64}$' AND new_witness->>'sha256'~'^[0-9a-f]{64}$') IS NOT TRUE
      THEN RAISE EXCEPTION 'Derived closure witness metadata changed';END IF;
      old_clean:=old_clean#-'{derived,0,parentTransitionChainCommitmentAfter,sha256}';
      new_clean:=new_clean#-'{derived,0,parentTransitionChainCommitmentAfter,sha256}';
     END IF;
    ELSIF old_item->'rawCandidate'='false'::jsonb THEN
     child_count:=child_count+1;
     SELECT count(*) INTO parent_count FROM jsonb_array_elements(NEW.payload->'replayRecords') p
      WHERE p->'rawCandidate'='true'::jsonb AND p->>'txid'=new_item->>'txid' AND p->'position'=new_item->'parentPosition';
     IF parent_count<>1 THEN RAISE EXCEPTION 'Derived closure parent is not unique';END IF;
     SELECT p INTO STRICT new_parent FROM jsonb_array_elements(NEW.payload->'replayRecords') p
      WHERE p->'rawCandidate'='true'::jsonb AND p->>'txid'=new_item->>'txid' AND p->'position'=new_item->'parentPosition';
     SELECT p INTO STRICT old_parent FROM jsonb_array_elements(original->'replayRecords') p
      WHERE p->'rawCandidate'='true'::jsonb AND p->>'txid'=old_item->>'txid' AND p->'position'=old_item->'parentPosition';
     old_descriptor:=old_parent->'derived'->0;new_descriptor:=new_parent->'derived'->0;
     IF (old_item->>'protocol'='pwt1' AND old_item->'derived'='true'::jsonb
      AND old_item#>>'{outcome,semanticKind}'='token-listing-closed'
      AND old_item#>'{outcome,valid}'='true'::jsonb AND old_item->'chargesTransactionFee'='false'::jsonb
      AND old_item#>>'{rawWitness,model}'='canonical-work-amo-v5-derived-child-v1'
      AND old_item#>>'{rawWitness,parentProtocol}'='pwt1'
      AND old_item#>'{rawWitness,parentPosition}'=old_item->'parentPosition'
      AND new_item#>'{rawWitness,descriptor}'=new_descriptor AND old_item#>'{rawWitness,descriptor}'=old_descriptor
      AND old_item->'position'=old_descriptor->'projectionPosition' AND new_item->'position'=new_descriptor->'projectionPosition'
      AND (old_item#>'{output,projection}') @> old_descriptor AND (new_item#>'{output,projection}') @> new_descriptor
      AND old_item->'parentTransitionChainCommitmentAfter'=old_parent->'transitionChainCommitmentAfter'
      AND new_item->'parentTransitionChainCommitmentAfter'=new_parent->'transitionChainCommitmentAfter') IS NOT TRUE
     THEN RAISE EXCEPTION 'Unsupported derived listing closure';END IF;
     old_clean:=old_clean#-'{parentTransitionChainCommitmentAfter,sha256}'#-'{rawWitness,descriptor,parentTransitionChainCommitmentAfter,sha256}'#-'{output,projection,parentTransitionChainCommitmentAfter,sha256}';
     new_clean:=new_clean#-'{parentTransitionChainCommitmentAfter,sha256}'#-'{rawWitness,descriptor,parentTransitionChainCommitmentAfter,sha256}'#-'{output,projection,parentTransitionChainCommitmentAfter,sha256}';
     paths:=ARRAY[ARRAY['parentTransitionChainCommitmentAfter']];
    ELSE RAISE EXCEPTION 'Replay raw-candidate flag changed';END IF;
    FOREACH witness_path SLICE 1 IN ARRAY paths LOOP
     old_witness:=old_item#>witness_path;new_witness:=new_item#>witness_path;
     IF (jsonb_typeof(old_witness)='object' AND jsonb_typeof(new_witness)='object'
      AND old_witness-'sha256'=new_witness-'sha256'
      AND old_witness->>'sha256'~'^[0-9a-f]{64}$' AND new_witness->>'sha256'~'^[0-9a-f]{64}$') IS NOT TRUE
     THEN RAISE EXCEPTION 'Replay witness metadata changed';END IF;
     old_clean:=old_clean#-(witness_path||'sha256'::text);new_clean:=new_clean#-(witness_path||'sha256'::text);
    END LOOP;
    IF (jsonb_typeof(old_item)='object' AND jsonb_typeof(new_item)='object' AND old_clean=new_clean) IS NOT TRUE
    THEN RAISE EXCEPTION 'Replay record or trace changed beyond qualified witnesses';END IF;
   END LOOP;
  END LOOP;
  IF raw_count<>NEW.protocol_record_count OR child_count<>NEW.event_count-NEW.protocol_record_count
   OR (child_count=0 AND original->'eventSetCommitment' IS DISTINCT FROM NEW.payload->'eventSetCommitment')
  THEN RAISE EXCEPTION 'Replay raw/derived counts differ';END IF;
  NEW.created_at:=(replacement.old_main->>'created_at')::timestamptz;
  IF NEW.block_height >= (SELECT max(block_height) FROM proof_indexer.work_transition_archive_v1 WHERE network=NEW.network)-127
   AND NOT EXISTS(SELECT 1 FROM proof_indexer.work_transition_hot_slots_v1 WHERE network=NEW.network AND slot=mod(NEW.block_height,128) AND block_height=NEW.block_height AND block_hash=NEW.block_hash AND payload_sha256=replacement.new_manifest->>'sha256') THEN
   INSERT INTO proof_indexer.work_transition_hot_slots_v1 VALUES(NEW.network,mod(NEW.block_height,128),NEW.block_height,NEW.block_hash,replacement.new_manifest->>'sha256',NEW.payload)
   ON CONFLICT(network,slot) DO UPDATE SET block_height=EXCLUDED.block_height,block_hash=EXCLUDED.block_hash,payload_sha256=EXCLUDED.payload_sha256,payload=EXCLUDED.payload;
  END IF;
  NEW.payload:=proof_indexer.work_transition_metadata_v1(NEW.payload)||jsonb_build_object('__powNativeStorage',jsonb_build_object('model','proof-indexer-native-transition-chunks-v1','sha256',replacement.new_manifest->>'sha256'));
  RETURN NEW;
 END IF;
 INSERT INTO proof_indexer.work_transition_archive_native_v1("network","block_height","block_hash","previous_block_hash","model","state_commitment_model","opening_network_value_q8","closing_network_value_q8","opening_state_sha256","closing_state_sha256","opening_state_payload_bytes","closing_state_payload_bytes","protocol_record_count","raw_protocol_candidate_count","transaction_count","event_count","event_set_model","event_set_sha256","event_set_payload_bytes","block_atomic","fee_once","invalid_zero","complete","payload","created_at","work_token_state_model")VALUES(NEW."network",NEW."block_height",NEW."block_hash",NEW."previous_block_hash",NEW."model",NEW."state_commitment_model",NEW."opening_network_value_q8",NEW."closing_network_value_q8",NEW."opening_state_sha256",NEW."closing_state_sha256",NEW."opening_state_payload_bytes",NEW."closing_state_payload_bytes",NEW."protocol_record_count",NEW."raw_protocol_candidate_count",NEW."transaction_count",NEW."event_count",NEW."event_set_model",NEW."event_set_sha256",NEW."event_set_payload_bytes",NEW."block_atomic",NEW."fee_once",NEW."invalid_zero",NEW."complete",NEW."payload",NEW."created_at",NEW."work_token_state_model" );
 SELECT payload,created_at INTO manifest,native_timestamp FROM proof_indexer.work_transition_archive_v1 WHERE network=NEW.network AND block_height=NEW.block_height AND block_hash=NEW.block_hash;
 NEW.created_at:=native_timestamp;
 -- A derived cache never changes the immutable archive or publication order.
 -- Historical warmup first fills the immutable archive. Large-payload cache
 -- admission is confined to its latest 128 heights; identical retries do not
 -- generate another heap/TOAST version. Older/fork records remain lossless.
 IF NEW.block_height >= (SELECT max(block_height) FROM proof_indexer.work_transition_archive_v1 WHERE network=NEW.network)-127
 AND NOT EXISTS(SELECT 1 FROM proof_indexer.work_transition_hot_slots_v1 WHERE network=NEW.network AND slot=mod(NEW.block_height,128) AND block_height=NEW.block_height AND block_hash=NEW.block_hash AND payload_sha256=manifest->>'sha256') THEN
 INSERT INTO proof_indexer.work_transition_hot_slots_v1 VALUES(NEW.network,mod(NEW.block_height,128),NEW.block_height,NEW.block_hash,manifest->>'sha256',NEW.payload)
 ON CONFLICT(network,slot) DO UPDATE SET block_height=EXCLUDED.block_height,block_hash=EXCLUDED.block_hash,payload_sha256=EXCLUDED.payload_sha256,payload=EXCLUDED.payload;
 END IF;
 NEW.payload:=proof_indexer.work_transition_metadata_v1(NEW.payload)||jsonb_build_object('__powNativeStorage',jsonb_build_object('model','proof-indexer-native-transition-chunks-v1','sha256',manifest->>'sha256'));
 RETURN NEW;
END$function$
;
CREATE OR REPLACE FUNCTION proof_indexer.read_work_transition_payload_v1(n text, h integer, bh text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE original jsonb; manifest jsonb;
BEGIN
 -- Native rows remain valid during local operator staging; all existing native
 -- consumer proof gates still run. Encoded rows require the exact model/hash.
 IF NOT(p ? '__powNativeStorage') THEN RETURN p;END IF;
 IF p->'__powNativeStorage'->>'model' IS DISTINCT FROM 'proof-indexer-native-transition-chunks-v1' THEN RAISE EXCEPTION 'Unknown native transition storage model';END IF;
 SELECT new_manifest INTO manifest FROM proof_indexer.work_batch_transition_supersessions_v1
 WHERE network=n AND block_height=h AND block_hash=bh AND new_manifest->>'sha256'=p->'__powNativeStorage'->>'sha256';
 IF NOT FOUND THEN
 SELECT payload INTO manifest FROM proof_indexer.work_transition_archive_v1 WHERE network=n AND block_height=h AND block_hash=bh;
 END IF;
 IF manifest IS NULL OR manifest->>'sha256' IS DISTINCT FROM p->'__powNativeStorage'->>'sha256' THEN RAISE EXCEPTION 'Missing or stale native transition frame';END IF;
 SELECT payload INTO original FROM proof_indexer.work_transition_hot_slots_v1 WHERE network=n AND slot=mod(h,128) AND block_height=h AND block_hash=bh AND payload_sha256=manifest->>'sha256';
 IF original IS NULL THEN original:=proof_indexer.reconstruct_work_transition_payload_v1(manifest);END IF;
 IF proof_indexer.work_transition_metadata_v1(original) IS DISTINCT FROM p-'__powNativeStorage' THEN RAISE EXCEPTION 'Native transition metadata mismatch';END IF;
 RETURN original;
END$function$
;
CREATE OR REPLACE FUNCTION proof_indexer.verify_work_transition_hot_slot_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE expected text;
BEGIN
 SELECT new_manifest->>'sha256' INTO expected FROM proof_indexer.work_batch_transition_supersessions_v1
 WHERE network=NEW.network AND block_height=NEW.block_height AND block_hash=NEW.block_hash;
 IF NOT FOUND THEN
 SELECT payload->>'sha256' INTO expected FROM proof_indexer.work_transition_archive_v1 WHERE network=NEW.network AND block_height=NEW.block_height AND block_hash=NEW.block_hash;
 END IF;
 IF expected IS NULL OR NEW.payload_sha256 IS DISTINCT FROM expected OR encode(sha256(jsonb_send(NEW.payload)),'hex') IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Unverified native transition hot slot';END IF;
 RETURN NEW;
END$function$
;
