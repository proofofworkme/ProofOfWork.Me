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
