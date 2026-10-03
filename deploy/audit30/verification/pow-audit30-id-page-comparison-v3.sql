\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';
SET LOCAL idle_in_transaction_session_timeout='15s';
SET LOCAL temp_file_limit='32MB';
SET LOCAL work_mem='8MB';
SELECT max(height) AS audit_tip FROM proof_indexer.blocks WHERE network='livenet' AND canonical=true \gset
SELECT max(block_height) AS pwid_height FROM proof_indexer.events WHERE network='livenet' AND protocol='pwid1' AND status='confirmed' AND block_height>960601 AND block_height<=:audit_tip \gset
SELECT jsonb_build_object('label','scope','transactionReadOnly',current_setting('transaction_read_only')='on','snapshot',pg_current_snapshot()::text,'maximumRowsPerPage',3,'sameSnapshot',true);
PREPARE audit30_id_page_compare(text,bigint,bigint,int,bigint,boolean,text) AS WITH original_page AS MATERIALIZED (
SELECT
            transition.network,
            transition.block_height,
            lower(transition.block_hash) AS block_hash,
            lower(transition.previous_block_hash) AS previous_block_hash,
            lower(previous_block.block_hash) AS canonical_previous_block_hash,
            transition.model,
            transition.state_commitment_model,
            transition.work_token_state_model,
            transition.opening_network_value_q8::text,
            transition.closing_network_value_q8::text,
            transition.opening_state_sha256,
            transition.closing_state_sha256,
            transition.opening_state_payload_bytes,
            transition.closing_state_payload_bytes,
            transition.protocol_record_count,
            transition.raw_protocol_candidate_count,
            transition.transaction_count,
            transition.event_count,
            transition.event_set_model,
            transition.event_set_sha256,
            transition.event_set_payload_bytes,
            transition.block_atomic,
            transition.fee_once,
            transition.invalid_zero,
            transition.complete,
            CASE
              WHEN transition.block_height = $5
              THEN transition.payload
              WHEN transition.raw_protocol_candidate_count > 0
              THEN CASE
                WHEN CASE WHEN $6::boolean THEN jsonb_path_exists(
                      transition.payload,
                      '$.replayRecords[*] ? (@.protocol == "pwid1" && @.rawCandidate == true)'
                    ) ELSE false END
                THEN transition.payload
                ELSE transition.payload - ARRAY[
                  'openingSufficientState', 'closingSufficientState',
                  'closingTokenState', 'closingIdState',
                  'closingGenericTokenState', 'closingWorkProjection'
                ]::text[]
              END
              ELSE jsonb_build_object(
                'idRegistryAuditEnvelopeModel',
                  'proof-indexer-id-registry-column-transition-envelope-v1',
                'replayRecords', '[]'::jsonb,
                'rawProtocolCandidateCount',
                  transition.raw_protocol_candidate_count
              )
            END AS payload
          FROM proof_indexer.work_amo_block_transitions transition
          JOIN proof_indexer.blocks transition_block
            ON transition_block.network = transition.network
           AND transition_block.height = transition.block_height
           AND transition_block.block_hash = transition.block_hash
           AND transition_block.previous_block_hash =
             transition.previous_block_hash
           AND transition_block.canonical = true
          JOIN proof_indexer.blocks previous_block
            ON previous_block.network = transition.network
           AND previous_block.height = transition.block_height - 1
           AND previous_block.block_hash = transition.previous_block_hash
           AND previous_block.canonical = true
          WHERE transition.network = $1
            AND transition.block_height > $2
            AND transition.block_height <= $3
          ORDER BY transition.block_height
          LIMIT $4
), candidate_page AS MATERIALIZED (
WITH audit_page_keys AS MATERIALIZED (
  SELECT transition.network, transition.block_height
  FROM proof_indexer.work_amo_block_transitions transition
          JOIN proof_indexer.blocks transition_block
            ON transition_block.network = transition.network
           AND transition_block.height = transition.block_height
           AND transition_block.block_hash = transition.block_hash
           AND transition_block.previous_block_hash =
             transition.previous_block_hash
           AND transition_block.canonical = true
          JOIN proof_indexer.blocks previous_block
            ON previous_block.network = transition.network
           AND previous_block.height = transition.block_height - 1
           AND previous_block.block_hash = transition.previous_block_hash
           AND previous_block.canonical = true
          WHERE transition.network = $1
            AND transition.block_height > $2
            AND transition.block_height <= $3
          ORDER BY transition.block_height
          LIMIT $4
)
SELECT
            transition.network,
            transition.block_height,
            lower(transition.block_hash) AS block_hash,
            lower(transition.previous_block_hash) AS previous_block_hash,
            lower(previous_block.block_hash) AS canonical_previous_block_hash,
            transition.model,
            transition.state_commitment_model,
            transition.work_token_state_model,
            transition.opening_network_value_q8::text,
            transition.closing_network_value_q8::text,
            transition.opening_state_sha256,
            transition.closing_state_sha256,
            transition.opening_state_payload_bytes,
            transition.closing_state_payload_bytes,
            transition.protocol_record_count,
            transition.raw_protocol_candidate_count,
            transition.transaction_count,
            transition.event_count,
            transition.event_set_model,
            transition.event_set_sha256,
            transition.event_set_payload_bytes,
            transition.block_atomic,
            transition.fee_once,
            transition.invalid_zero,
            transition.complete,
            CASE
              WHEN transition.block_height = $5
              THEN transition.payload
              WHEN transition.raw_protocol_candidate_count > 0
              THEN CASE
                WHEN CASE WHEN $6::boolean THEN jsonb_path_exists(
                      transition.payload,
                      '$.replayRecords[*] ? (@.protocol == "pwid1" && @.rawCandidate == true)'
                    ) ELSE false END
                THEN transition.payload
                ELSE transition.payload - ARRAY[
                  'openingSufficientState', 'closingSufficientState',
                  'closingTokenState', 'closingIdState',
                  'closingGenericTokenState', 'closingWorkProjection'
                ]::text[]
              END
              ELSE jsonb_build_object(
                'idRegistryAuditEnvelopeModel',
                  'proof-indexer-id-registry-column-transition-envelope-v1',
                'replayRecords', '[]'::jsonb,
                'rawProtocolCandidateCount',
                  transition.raw_protocol_candidate_count
              )
            END AS payload
          FROM audit_page_keys
          JOIN proof_indexer.work_amo_block_transitions transition
            ON transition.network = audit_page_keys.network
           AND transition.block_height = audit_page_keys.block_height
          JOIN proof_indexer.blocks transition_block
            ON transition_block.network = transition.network
           AND transition_block.height = transition.block_height
           AND transition_block.block_hash = transition.block_hash
           AND transition_block.previous_block_hash =
             transition.previous_block_hash
           AND transition_block.canonical = true
          JOIN proof_indexer.blocks previous_block
            ON previous_block.network = transition.network
           AND previous_block.height = transition.block_height - 1
           AND previous_block.block_hash = transition.previous_block_hash
           AND previous_block.canonical = true
          WHERE transition.network = $1
            AND transition.block_height > $2
            AND transition.block_height <= $3
          ORDER BY transition.block_height
), paired AS MATERIALIZED (
 SELECT o.ordinal AS original_ordinal,c.ordinal AS candidate_ordinal,
        o.network AS original_network,c.network AS candidate_network,
        o.block_height AS original_height,c.block_height AS candidate_height,
        to_jsonb(ROW(o.network,o.block_height,o.block_hash,o.previous_block_hash,o.canonical_previous_block_hash,o.model,o.state_commitment_model,o.work_token_state_model,o.opening_network_value_q8,o.closing_network_value_q8,o.opening_state_sha256,o.closing_state_sha256,o.opening_state_payload_bytes,o.closing_state_payload_bytes,o.protocol_record_count,o.raw_protocol_candidate_count,o.transaction_count,o.event_count,o.event_set_model,o.event_set_sha256,o.event_set_payload_bytes,o.block_atomic,o.fee_once,o.invalid_zero,o.complete)) IS NOT DISTINCT FROM to_jsonb(ROW(c.network,c.block_height,c.block_hash,c.previous_block_hash,c.canonical_previous_block_hash,c.model,c.state_commitment_model,c.work_token_state_model,c.opening_network_value_q8,c.closing_network_value_q8,c.opening_state_sha256,c.closing_state_sha256,c.opening_state_payload_bytes,c.closing_state_payload_bytes,c.protocol_record_count,c.raw_protocol_candidate_count,c.transaction_count,c.event_count,c.event_set_model,c.event_set_sha256,c.event_set_payload_bytes,c.block_atomic,c.fee_once,c.invalid_zero,c.complete)) AS headers_equal,
        o.payload IS NOT DISTINCT FROM c.payload AS payload_jsonb_equal,
        o.payload::text IS NOT DISTINCT FROM c.payload::text AS payload_text_equal,
        sha256(convert_to(o.payload::text,'UTF8')) IS NOT DISTINCT FROM
          sha256(convert_to(c.payload::text,'UTF8')) AS payload_sha256_equal,
        encode(sha256(convert_to(to_jsonb(ROW(o.network,o.block_height,o.block_hash,o.previous_block_hash,o.canonical_previous_block_hash,o.model,o.state_commitment_model,o.work_token_state_model,o.opening_network_value_q8,o.closing_network_value_q8,o.opening_state_sha256,o.closing_state_sha256,o.opening_state_payload_bytes,o.closing_state_payload_bytes,o.protocol_record_count,o.raw_protocol_candidate_count,o.transaction_count,o.event_count,o.event_set_model,o.event_set_sha256,o.event_set_payload_bytes,o.block_atomic,o.fee_once,o.invalid_zero,o.complete))::text,'UTF8')),'hex') AS original_header_sha256,
        encode(sha256(convert_to(to_jsonb(ROW(c.network,c.block_height,c.block_hash,c.previous_block_hash,c.canonical_previous_block_hash,c.model,c.state_commitment_model,c.work_token_state_model,c.opening_network_value_q8,c.closing_network_value_q8,c.opening_state_sha256,c.closing_state_sha256,c.opening_state_payload_bytes,c.closing_state_payload_bytes,c.protocol_record_count,c.raw_protocol_candidate_count,c.transaction_count,c.event_count,c.event_set_model,c.event_set_sha256,c.event_set_payload_bytes,c.block_atomic,c.fee_once,c.invalid_zero,c.complete))::text,'UTF8')),'hex') AS candidate_header_sha256,
        encode(sha256(convert_to(o.payload::text,'UTF8')),'hex') AS original_payload_sha256,
        encode(sha256(convert_to(c.payload::text,'UTF8')),'hex') AS candidate_payload_sha256,
        octet_length(o.payload::text) AS original_payload_bytes,
        octet_length(c.payload::text) AS candidate_payload_bytes,
        o.block_height=$5 AS boundary_row,
        CASE WHEN o.block_height=$5 THEN
          o.payload IS NOT DISTINCT FROM raw.payload AND
          c.payload IS NOT DISTINCT FROM raw.payload ELSE true END AS boundary_full_payload_equal
 FROM (SELECT row_number() OVER (ORDER BY block_height,network) AS ordinal,o.* FROM original_page o) o
 FULL JOIN (SELECT row_number() OVER (ORDER BY block_height,network) AS ordinal,c.* FROM candidate_page c) c USING(ordinal)
 LEFT JOIN proof_indexer.work_amo_block_transitions raw
   ON raw.network=o.network AND raw.block_height=o.block_height AND o.block_height=$5
), summary AS MATERIALIZED (
 SELECT count(*) FILTER(WHERE original_ordinal IS NOT NULL) AS original_rows,
        count(*) FILTER(WHERE candidate_ordinal IS NOT NULL) AS candidate_rows,
        count(DISTINCT(original_network,original_height)) FILTER(WHERE original_ordinal IS NOT NULL) AS original_unique_keys,
        count(DISTINCT(candidate_network,candidate_height)) FILTER(WHERE candidate_ordinal IS NOT NULL) AS candidate_unique_keys,
        max(original_height)-min(original_height)+1=count(*) FILTER(WHERE original_ordinal IS NOT NULL) AS original_dense,
        max(candidate_height)-min(candidate_height)+1=count(*) FILTER(WHERE candidate_ordinal IS NOT NULL) AS candidate_dense,
        coalesce(bool_and(headers_equal),false) AS headers_equal,
        coalesce(bool_and(payload_jsonb_equal),false) AS payload_jsonb_equal,
        coalesce(bool_and(payload_text_equal),false) AS payload_text_equal,
        coalesce(bool_and(payload_sha256_equal),false) AS payload_sha256_equal,
        coalesce(bool_and(original_height IS NOT DISTINCT FROM candidate_height),false) AS ordered_heights_equal,
        coalesce(bool_and(original_ordinal IS NOT NULL AND candidate_ordinal IS NOT NULL),false) AS row_membership_equal,
        coalesce(jsonb_agg(jsonb_build_object('height',original_height,
          'headerSHA256',original_header_sha256,'payloadSHA256',original_payload_sha256,
          'payloadBytes',original_payload_bytes) ORDER BY original_ordinal)
          FILTER(WHERE original_ordinal IS NOT NULL),'[]'::jsonb) AS original_fingerprints,
        coalesce(jsonb_agg(jsonb_build_object('height',candidate_height,
          'headerSHA256',candidate_header_sha256,'payloadSHA256',candidate_payload_sha256,
          'payloadBytes',candidate_payload_bytes) ORDER BY candidate_ordinal)
          FILTER(WHERE candidate_ordinal IS NOT NULL),'[]'::jsonb) AS candidate_fingerprints,
        count(*) FILTER(WHERE boundary_row) AS boundary_rows,
        coalesce(bool_and(boundary_full_payload_equal),true) AS boundary_full_payload_equal
 FROM paired
)
SELECT jsonb_build_object('label',$7,'transactionReadOnly',current_setting('transaction_read_only')='on',
 'originalRows',original_rows,'candidateRows',candidate_rows,
 'originalUniqueKeys',original_unique_keys,'candidateUniqueKeys',candidate_unique_keys,
 'originalDense',original_dense,'candidateDense',candidate_dense,
 'headersEqual',headers_equal,'payloadJSONBEqual',payload_jsonb_equal,
 'payloadTextEqual',payload_text_equal,'payloadSHA256Equal',payload_sha256_equal,
 'orderedHeightsEqual',ordered_heights_equal,'rowMembershipEqual',row_membership_equal,
 'originalFingerprints',original_fingerprints,'candidateFingerprints',candidate_fingerprints,
 'boundaryRows',boundary_rows,'boundaryFullPayloadEqual',boundary_full_payload_equal)
FROM summary;
EXECUTE audit30_id_page_compare('livenet',959620,:audit_tip,3,960601,true,'activation-initial-comparison');
EXECUTE audit30_id_page_compare('livenet',959620,:audit_tip,3,960601,false,'activation-final-comparison');
EXECUTE audit30_id_page_compare('livenet',960600,:audit_tip,3,960601,true,'migration-initial-comparison');
EXECUTE audit30_id_page_compare('livenet',960600,:audit_tip,3,960601,false,'migration-final-comparison');
EXECUTE audit30_id_page_compare('livenet',(:pwid_height-1),:audit_tip,3,960601,true,'latest-pwid-initial-comparison');
EXECUTE audit30_id_page_compare('livenet',(:pwid_height-1),:audit_tip,3,960601,false,'latest-pwid-final-comparison');
DEALLOCATE audit30_id_page_compare;
PREPARE audit30_id_original_page(text,bigint,bigint,int,bigint,boolean) AS SELECT
            transition.network,
            transition.block_height,
            lower(transition.block_hash) AS block_hash,
            lower(transition.previous_block_hash) AS previous_block_hash,
            lower(previous_block.block_hash) AS canonical_previous_block_hash,
            transition.model,
            transition.state_commitment_model,
            transition.work_token_state_model,
            transition.opening_network_value_q8::text,
            transition.closing_network_value_q8::text,
            transition.opening_state_sha256,
            transition.closing_state_sha256,
            transition.opening_state_payload_bytes,
            transition.closing_state_payload_bytes,
            transition.protocol_record_count,
            transition.raw_protocol_candidate_count,
            transition.transaction_count,
            transition.event_count,
            transition.event_set_model,
            transition.event_set_sha256,
            transition.event_set_payload_bytes,
            transition.block_atomic,
            transition.fee_once,
            transition.invalid_zero,
            transition.complete,
            CASE
              WHEN transition.block_height = $5
              THEN transition.payload
              WHEN transition.raw_protocol_candidate_count > 0
              THEN CASE
                WHEN CASE WHEN $6::boolean THEN jsonb_path_exists(
                      transition.payload,
                      '$.replayRecords[*] ? (@.protocol == "pwid1" && @.rawCandidate == true)'
                    ) ELSE false END
                THEN transition.payload
                ELSE transition.payload - ARRAY[
                  'openingSufficientState', 'closingSufficientState',
                  'closingTokenState', 'closingIdState',
                  'closingGenericTokenState', 'closingWorkProjection'
                ]::text[]
              END
              ELSE jsonb_build_object(
                'idRegistryAuditEnvelopeModel',
                  'proof-indexer-id-registry-column-transition-envelope-v1',
                'replayRecords', '[]'::jsonb,
                'rawProtocolCandidateCount',
                  transition.raw_protocol_candidate_count
              )
            END AS payload
          FROM proof_indexer.work_amo_block_transitions transition
          JOIN proof_indexer.blocks transition_block
            ON transition_block.network = transition.network
           AND transition_block.height = transition.block_height
           AND transition_block.block_hash = transition.block_hash
           AND transition_block.previous_block_hash =
             transition.previous_block_hash
           AND transition_block.canonical = true
          JOIN proof_indexer.blocks previous_block
            ON previous_block.network = transition.network
           AND previous_block.height = transition.block_height - 1
           AND previous_block.block_hash = transition.previous_block_hash
           AND previous_block.canonical = true
          WHERE transition.network = $1
            AND transition.block_height > $2
            AND transition.block_height <= $3
          ORDER BY transition.block_height
          LIMIT $4;
PREPARE audit30_id_candidate_page(text,bigint,bigint,int,bigint,boolean) AS WITH audit_page_keys AS MATERIALIZED (
  SELECT transition.network, transition.block_height
  FROM proof_indexer.work_amo_block_transitions transition
          JOIN proof_indexer.blocks transition_block
            ON transition_block.network = transition.network
           AND transition_block.height = transition.block_height
           AND transition_block.block_hash = transition.block_hash
           AND transition_block.previous_block_hash =
             transition.previous_block_hash
           AND transition_block.canonical = true
          JOIN proof_indexer.blocks previous_block
            ON previous_block.network = transition.network
           AND previous_block.height = transition.block_height - 1
           AND previous_block.block_hash = transition.previous_block_hash
           AND previous_block.canonical = true
          WHERE transition.network = $1
            AND transition.block_height > $2
            AND transition.block_height <= $3
          ORDER BY transition.block_height
          LIMIT $4
)
SELECT
            transition.network,
            transition.block_height,
            lower(transition.block_hash) AS block_hash,
            lower(transition.previous_block_hash) AS previous_block_hash,
            lower(previous_block.block_hash) AS canonical_previous_block_hash,
            transition.model,
            transition.state_commitment_model,
            transition.work_token_state_model,
            transition.opening_network_value_q8::text,
            transition.closing_network_value_q8::text,
            transition.opening_state_sha256,
            transition.closing_state_sha256,
            transition.opening_state_payload_bytes,
            transition.closing_state_payload_bytes,
            transition.protocol_record_count,
            transition.raw_protocol_candidate_count,
            transition.transaction_count,
            transition.event_count,
            transition.event_set_model,
            transition.event_set_sha256,
            transition.event_set_payload_bytes,
            transition.block_atomic,
            transition.fee_once,
            transition.invalid_zero,
            transition.complete,
            CASE
              WHEN transition.block_height = $5
              THEN transition.payload
              WHEN transition.raw_protocol_candidate_count > 0
              THEN CASE
                WHEN CASE WHEN $6::boolean THEN jsonb_path_exists(
                      transition.payload,
                      '$.replayRecords[*] ? (@.protocol == "pwid1" && @.rawCandidate == true)'
                    ) ELSE false END
                THEN transition.payload
                ELSE transition.payload - ARRAY[
                  'openingSufficientState', 'closingSufficientState',
                  'closingTokenState', 'closingIdState',
                  'closingGenericTokenState', 'closingWorkProjection'
                ]::text[]
              END
              ELSE jsonb_build_object(
                'idRegistryAuditEnvelopeModel',
                  'proof-indexer-id-registry-column-transition-envelope-v1',
                'replayRecords', '[]'::jsonb,
                'rawProtocolCandidateCount',
                  transition.raw_protocol_candidate_count
              )
            END AS payload
          FROM audit_page_keys
          JOIN proof_indexer.work_amo_block_transitions transition
            ON transition.network = audit_page_keys.network
           AND transition.block_height = audit_page_keys.block_height
          JOIN proof_indexer.blocks transition_block
            ON transition_block.network = transition.network
           AND transition_block.height = transition.block_height
           AND transition_block.block_hash = transition.block_hash
           AND transition_block.previous_block_hash =
             transition.previous_block_hash
           AND transition_block.canonical = true
          JOIN proof_indexer.blocks previous_block
            ON previous_block.network = transition.network
           AND previous_block.height = transition.block_height - 1
           AND previous_block.block_hash = transition.previous_block_hash
           AND previous_block.canonical = true
          WHERE transition.network = $1
            AND transition.block_height > $2
            AND transition.block_height <= $3
          ORDER BY transition.block_height;
SELECT jsonb_build_object('label','activation-original-explain');
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE audit30_id_original_page('livenet',959620,:audit_tip,3,960601,true);
SELECT jsonb_build_object('label','activation-candidate-explain');
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE audit30_id_candidate_page('livenet',959620,:audit_tip,3,960601,true);
DEALLOCATE audit30_id_original_page;
DEALLOCATE audit30_id_candidate_page;
ROLLBACK;
