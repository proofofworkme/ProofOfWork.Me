-- LOCAL CANDIDATE ONLY. Production install/migration requires separate approval.
BEGIN;
SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='proof_indexer_transition_storage_owner') THEN
 CREATE ROLE proof_indexer_transition_storage_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
END IF; END$$;
GRANT USAGE ON SCHEMA proof_indexer TO proof_indexer_transition_storage_owner;
CREATE TABLE proof_indexer.work_transition_chunks_v1(hash bytea PRIMARY KEY,data bytea NOT NULL,CHECK(octet_length(data) BETWEEN 1 AND 65536),CHECK(hash=sha256(data))) TABLESPACE proof_indexer_large_state_v1;
CREATE TABLE proof_indexer.work_transition_archive_v1 (LIKE proof_indexer.work_amo_block_transitions INCLUDING DEFAULTS INCLUDING CONSTRAINTS) TABLESPACE proof_indexer_large_state_v1;
ALTER TABLE proof_indexer.work_transition_archive_v1 ADD PRIMARY KEY(network,block_hash);
CREATE INDEX work_transition_archive_height_v1 ON proof_indexer.work_transition_archive_v1(network,block_height);
CREATE FUNCTION proof_indexer.reject_work_transition_archive_mutation_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Immutable transition evidence'; END$$;
CREATE TRIGGER immutable_chunks BEFORE UPDATE OR DELETE ON proof_indexer.work_transition_chunks_v1 FOR EACH ROW EXECUTE FUNCTION proof_indexer.reject_work_transition_archive_mutation_v1();
CREATE TRIGGER immutable_frames BEFORE UPDATE OR DELETE ON proof_indexer.work_transition_archive_v1 FOR EACH ROW EXECUTE FUNCTION proof_indexer.reject_work_transition_archive_mutation_v1();
CREATE FUNCTION proof_indexer.reconstruct_work_transition_payload_v1(manifest jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE b bytea; expected bytea; n integer; c integer;
BEGIN
 IF manifest->>'model' IS DISTINCT FROM 'audit31-native-jsonb-chunks-v1' OR jsonb_typeof(manifest->'parts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Unknown native frame'; END IF;
 n:=(manifest->>'bytes')::integer;c:=jsonb_array_length(manifest->'parts');
 IF n<2 OR n>268435456 OR c<>((n+65535)/65536) THEN RAISE EXCEPTION 'Native envelope'; END IF;
 expected:=decode(manifest->>'sha256','hex');
 SELECT string_agg(ch.data,''::bytea ORDER BY p.ord) INTO b FROM jsonb_array_elements_text(manifest->'parts')WITH ORDINALITY p(hash,ord) JOIN proof_indexer.work_transition_chunks_v1 ch ON ch.hash=decode(p.hash,'hex') AND sha256(ch.data)=ch.hash;
 IF b IS NULL OR octet_length(b)<>n OR sha256(b)<>expected OR get_byte(b,0)<>1 THEN RAISE EXCEPTION 'Native missing/corrupt chunk';END IF;
 RETURN convert_from(substring(b FROM 2),'UTF8')::jsonb;
END$$;
CREATE VIEW proof_indexer.work_transition_archive_native_v1 AS SELECT "network","block_height","block_hash","previous_block_hash","model","state_commitment_model","opening_network_value_q8","closing_network_value_q8","opening_state_sha256","closing_state_sha256","opening_state_payload_bytes","closing_state_payload_bytes","protocol_record_count","raw_protocol_candidate_count","transaction_count","event_count","event_set_model","event_set_sha256","event_set_payload_bytes","block_atomic","fee_once","invalid_zero","complete",proof_indexer.reconstruct_work_transition_payload_v1(payload) AS payload,"created_at","work_token_state_model" FROM proof_indexer.work_transition_archive_v1;
CREATE FUNCTION proof_indexer.insert_work_transition_archive_native_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE raw bytea;part bytea;h bytea;parts jsonb:='[]'::jsonb;pos integer;manifest jsonb;
BEGIN
 raw:=jsonb_send(NEW.payload);
 IF octet_length(raw)>268435456 THEN RAISE EXCEPTION 'Native row envelope';END IF;
 FOR pos IN 0..((octet_length(raw)-1)/65536) LOOP
  part:=substring(raw FROM pos*65536+1 FOR 65536);h:=sha256(part);
  INSERT INTO proof_indexer.work_transition_chunks_v1 VALUES(h,part)ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM proof_indexer.work_transition_chunks_v1 WHERE hash=h AND data=part)THEN RAISE EXCEPTION 'Chunk collision/corruption';END IF;
  parts:=parts||jsonb_build_array(encode(h,'hex'));
 END LOOP;
 manifest:=jsonb_build_object('model','audit31-native-jsonb-chunks-v1','bytes',octet_length(raw),'sha256',encode(sha256(raw),'hex'),'parts',parts);
 INSERT INTO proof_indexer.work_transition_archive_v1("network","block_height","block_hash","previous_block_hash","model","state_commitment_model","opening_network_value_q8","closing_network_value_q8","opening_state_sha256","closing_state_sha256","opening_state_payload_bytes","closing_state_payload_bytes","protocol_record_count","raw_protocol_candidate_count","transaction_count","event_count","event_set_model","event_set_sha256","event_set_payload_bytes","block_atomic","fee_once","invalid_zero","complete","payload","created_at","work_token_state_model")VALUES(NEW."network",NEW."block_height",NEW."block_hash",NEW."previous_block_hash",NEW."model",NEW."state_commitment_model",NEW."opening_network_value_q8",NEW."closing_network_value_q8",NEW."opening_state_sha256",NEW."closing_state_sha256",NEW."opening_state_payload_bytes",NEW."closing_state_payload_bytes",NEW."protocol_record_count",NEW."raw_protocol_candidate_count",NEW."transaction_count",NEW."event_count",NEW."event_set_model",NEW."event_set_sha256",NEW."event_set_payload_bytes",NEW."block_atomic",NEW."fee_once",NEW."invalid_zero",NEW."complete",manifest,NEW."created_at",NEW."work_token_state_model")ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM proof_indexer.work_transition_archive_v1 f WHERE f.network=NEW.network AND f.block_height=NEW.block_height AND f.block_hash=NEW.block_hash AND f.payload->>'sha256'=manifest->>'sha256' AND ROW(f."network",f."block_height",f."block_hash",f."previous_block_hash",f."model",f."state_commitment_model",f."opening_network_value_q8",f."closing_network_value_q8",f."opening_state_sha256",f."closing_state_sha256",f."opening_state_payload_bytes",f."closing_state_payload_bytes",f."protocol_record_count",f."raw_protocol_candidate_count",f."transaction_count",f."event_count",f."event_set_model",f."event_set_sha256",f."event_set_payload_bytes",f."block_atomic",f."fee_once",f."invalid_zero",f."complete",f."work_token_state_model")IS NOT DISTINCT FROM ROW(NEW."network",NEW."block_height",NEW."block_hash",NEW."previous_block_hash",NEW."model",NEW."state_commitment_model",NEW."opening_network_value_q8",NEW."closing_network_value_q8",NEW."opening_state_sha256",NEW."closing_state_sha256",NEW."opening_state_payload_bytes",NEW."closing_state_payload_bytes",NEW."protocol_record_count",NEW."raw_protocol_candidate_count",NEW."transaction_count",NEW."event_count",NEW."event_set_model",NEW."event_set_sha256",NEW."event_set_payload_bytes",NEW."block_atomic",NEW."fee_once",NEW."invalid_zero",NEW."complete",NEW."work_token_state_model"))THEN RAISE EXCEPTION 'Conflicting canonical transition';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER insert_native INSTEAD OF INSERT ON proof_indexer.work_transition_archive_native_v1 FOR EACH ROW EXECUTE FUNCTION proof_indexer.insert_work_transition_archive_native_v1();

ALTER VIEW proof_indexer.work_transition_archive_native_v1 ALTER COLUMN created_at SET DEFAULT now();


CREATE TABLE proof_indexer.work_transition_hot_slots_v1(
 network text NOT NULL,slot smallint NOT NULL CHECK(slot BETWEEN 0 AND 127),
 block_height integer NOT NULL,block_hash text NOT NULL,payload_sha256 text NOT NULL,
 payload jsonb NOT NULL,PRIMARY KEY(network,slot),CHECK(slot=mod(block_height,128))) TABLESPACE proof_indexer_large_state_v1;
CREATE FUNCTION proof_indexer.work_transition_metadata_v1(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
 SELECT (p-ARRAY['openingSufficientState','closingSufficientState','closingTokenState','closingIdState','closingGenericTokenState','closingWorkProjection']::text[])
  ||CASE WHEN (p->'closingSufficientState') ? 'tokenStateCommitment'
  THEN jsonb_build_object('closingSufficientState',jsonb_build_object('tokenStateCommitment',p->'closingSufficientState'->'tokenStateCommitment')) ELSE '{}'::jsonb END
$$;
CREATE FUNCTION proof_indexer.verify_work_transition_hot_slot_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE expected text;
BEGIN
 SELECT payload->>'sha256' INTO expected FROM proof_indexer.work_transition_archive_v1 WHERE network=NEW.network AND block_height=NEW.block_height AND block_hash=NEW.block_hash;
 IF expected IS NULL OR NEW.payload_sha256 IS DISTINCT FROM expected OR encode(sha256(jsonb_send(NEW.payload)),'hex') IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Unverified native transition hot slot';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER work_transition_hot_slot_verified_v1 BEFORE INSERT OR UPDATE ON proof_indexer.work_transition_hot_slots_v1 FOR EACH ROW EXECUTE FUNCTION proof_indexer.verify_work_transition_hot_slot_v1();
CREATE TRIGGER work_transition_hot_slot_protected_v1 BEFORE DELETE ON proof_indexer.work_transition_hot_slots_v1 FOR EACH ROW EXECUTE FUNCTION proof_indexer.reject_work_transition_archive_mutation_v1();
CREATE FUNCTION proof_indexer.encode_native_work_transition_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE manifest jsonb; native_timestamp timestamptz;
BEGIN
 IF NEW.payload ? '__powNativeStorage' THEN RAISE EXCEPTION 'Native storage envelope cannot be supplied as protocol evidence';END IF;
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
END$$;
CREATE TRIGGER work_transition_native_encoded_v1 BEFORE INSERT ON proof_indexer.work_amo_block_transitions FOR EACH ROW EXECUTE FUNCTION proof_indexer.encode_native_work_transition_v1();
CREATE FUNCTION proof_indexer.read_work_transition_payload_v1(n text,h integer,bh text,p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
DECLARE original jsonb; manifest jsonb;
BEGIN
 -- Native rows remain valid during local operator staging; all existing native
 -- consumer proof gates still run. Encoded rows require the exact model/hash.
 IF NOT(p ? '__powNativeStorage') THEN RETURN p;END IF;
 IF p->'__powNativeStorage'->>'model' IS DISTINCT FROM 'proof-indexer-native-transition-chunks-v1' THEN RAISE EXCEPTION 'Unknown native transition storage model';END IF;
 SELECT payload INTO manifest FROM proof_indexer.work_transition_archive_v1 WHERE network=n AND block_height=h AND block_hash=bh;
 IF manifest IS NULL OR manifest->>'sha256' IS DISTINCT FROM p->'__powNativeStorage'->>'sha256' THEN RAISE EXCEPTION 'Missing or stale native transition frame';END IF;
 SELECT payload INTO original FROM proof_indexer.work_transition_hot_slots_v1 WHERE network=n AND slot=mod(h,128) AND block_height=h AND block_hash=bh AND payload_sha256=manifest->>'sha256';
 IF original IS NULL THEN original:=proof_indexer.reconstruct_work_transition_payload_v1(manifest);END IF;
 IF proof_indexer.work_transition_metadata_v1(original) IS DISTINCT FROM p-'__powNativeStorage' THEN RAISE EXCEPTION 'Native transition metadata mismatch';END IF;
 RETURN original;
END$$;
ALTER FUNCTION proof_indexer.reject_work_transition_archive_mutation_v1() OWNER TO proof_indexer_transition_storage_owner;
REVOKE ALL ON FUNCTION proof_indexer.reject_work_transition_archive_mutation_v1() FROM PUBLIC;
ALTER FUNCTION proof_indexer.reject_work_transition_archive_mutation_v1() SET search_path=pg_catalog,pg_temp;
ALTER FUNCTION proof_indexer.reconstruct_work_transition_payload_v1(jsonb) OWNER TO proof_indexer_transition_storage_owner;
REVOKE ALL ON FUNCTION proof_indexer.reconstruct_work_transition_payload_v1(jsonb) FROM PUBLIC;
ALTER FUNCTION proof_indexer.reconstruct_work_transition_payload_v1(jsonb) SET search_path=pg_catalog,pg_temp;
ALTER FUNCTION proof_indexer.insert_work_transition_archive_native_v1() OWNER TO proof_indexer_transition_storage_owner;
REVOKE ALL ON FUNCTION proof_indexer.insert_work_transition_archive_native_v1() FROM PUBLIC;
ALTER FUNCTION proof_indexer.insert_work_transition_archive_native_v1() SET search_path=pg_catalog,pg_temp;
ALTER FUNCTION proof_indexer.work_transition_metadata_v1(jsonb) OWNER TO proof_indexer_transition_storage_owner;
REVOKE ALL ON FUNCTION proof_indexer.work_transition_metadata_v1(jsonb) FROM PUBLIC;
ALTER FUNCTION proof_indexer.work_transition_metadata_v1(jsonb) SET search_path=pg_catalog,pg_temp;
ALTER FUNCTION proof_indexer.verify_work_transition_hot_slot_v1() OWNER TO proof_indexer_transition_storage_owner;
REVOKE ALL ON FUNCTION proof_indexer.verify_work_transition_hot_slot_v1() FROM PUBLIC;
ALTER FUNCTION proof_indexer.verify_work_transition_hot_slot_v1() SET search_path=pg_catalog,pg_temp;
ALTER FUNCTION proof_indexer.encode_native_work_transition_v1() OWNER TO proof_indexer_transition_storage_owner;
REVOKE ALL ON FUNCTION proof_indexer.encode_native_work_transition_v1() FROM PUBLIC;
ALTER FUNCTION proof_indexer.encode_native_work_transition_v1() SET search_path=pg_catalog,pg_temp;
ALTER FUNCTION proof_indexer.read_work_transition_payload_v1(text,integer,text,jsonb) OWNER TO proof_indexer_transition_storage_owner;
REVOKE ALL ON FUNCTION proof_indexer.read_work_transition_payload_v1(text,integer,text,jsonb) FROM PUBLIC;
ALTER FUNCTION proof_indexer.read_work_transition_payload_v1(text,integer,text,jsonb) SET search_path=pg_catalog,pg_temp;
ALTER TABLE proof_indexer.work_transition_chunks_v1 OWNER TO proof_indexer_transition_storage_owner;
REVOKE ALL ON proof_indexer.work_transition_chunks_v1 FROM PUBLIC;
GRANT SELECT ON proof_indexer.work_transition_chunks_v1 TO proof_indexer;
ALTER TABLE proof_indexer.work_transition_archive_v1 OWNER TO proof_indexer_transition_storage_owner;
REVOKE ALL ON proof_indexer.work_transition_archive_v1 FROM PUBLIC;
GRANT SELECT ON proof_indexer.work_transition_archive_v1 TO proof_indexer;
ALTER VIEW proof_indexer.work_transition_archive_native_v1 OWNER TO proof_indexer_transition_storage_owner;
REVOKE ALL ON proof_indexer.work_transition_archive_native_v1 FROM PUBLIC;
GRANT SELECT ON proof_indexer.work_transition_archive_native_v1 TO proof_indexer;
ALTER TABLE proof_indexer.work_transition_hot_slots_v1 OWNER TO proof_indexer_transition_storage_owner;
REVOKE ALL ON proof_indexer.work_transition_hot_slots_v1 FROM PUBLIC;
GRANT SELECT ON proof_indexer.work_transition_hot_slots_v1 TO proof_indexer;
GRANT EXECUTE ON FUNCTION proof_indexer.work_transition_metadata_v1(jsonb) TO proof_indexer;
GRANT EXECUTE ON FUNCTION proof_indexer.read_work_transition_payload_v1(text,integer,text,jsonb) TO proof_indexer;
GRANT EXECUTE ON FUNCTION proof_indexer.reconstruct_work_transition_payload_v1(jsonb) TO proof_indexer;
COMMIT;
