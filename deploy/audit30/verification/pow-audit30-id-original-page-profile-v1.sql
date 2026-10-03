\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';
SET LOCAL idle_in_transaction_session_timeout='15s';
SET LOCAL temp_file_limit='32MB';
SET LOCAL work_mem='8MB';
SELECT max(height) AS audit_tip FROM proof_indexer.blocks WHERE network='livenet' AND canonical=true \gset
SELECT max(block_height) AS pwid_height FROM proof_indexer.events WHERE network='livenet' AND protocol='pwid1' AND status='confirmed' AND block_height>960601 AND block_height<=:audit_tip \gset
SELECT jsonb_build_object('label','scope','transactionReadOnly',current_setting('transaction_read_only'),'tip',:audit_tip,'latestPwidHeight',:pwid_height,'maximumRowsPerPage',3,'snapshot',pg_current_snapshot()::text);
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
SELECT jsonb_build_object('label','initial-activation-page-original-explain');
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE audit30_id_original_page('livenet',959620,:audit_tip,3,960601,true);
SELECT jsonb_build_object('label','initial-latest-pwid-page-original-explain');
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE audit30_id_original_page('livenet',(:pwid_height-1),:audit_tip,3,960601,true);
DEALLOCATE audit30_id_original_page;
ROLLBACK;
