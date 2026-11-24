-- Bind the original accepted row and a separately qualified corrected frame.
-- Only the published declaration's canonical suffix is eligible.
CREATE TABLE proof_indexer.work_amo_expanded_liquidity_supersessions_v1 (
  network text NOT NULL CHECK (network = 'livenet'),
  block_height integer NOT NULL CHECK (block_height >= 977230),
  block_hash text NOT NULL CHECK (block_hash ~ '^[0-9a-f]{64}$'),
  incident_txid text NOT NULL CHECK (incident_txid = '57eb549372f2318bfc3ade62c62e9e1092cd42702e9ffb5e2733659acc241f33'),
  qualification_sha256 text NOT NULL CHECK (qualification_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  source_commit text NOT NULL CHECK (source_commit ~ '^[0-9a-f]{40}$'),
  source_tree text NOT NULL CHECK (source_tree ~ '^[0-9a-f]{40}$'),
  through_height integer NOT NULL CHECK (through_height >= block_height),
  through_hash text NOT NULL CHECK (through_hash ~ '^[0-9a-f]{64}$'),
  old_main jsonb NOT NULL,
  old_archive_sha256 text NOT NULL CHECK (old_archive_sha256 ~ '^[0-9a-f]{64}$'),
  new_manifest jsonb NOT NULL,
  replacement_fields jsonb NOT NULL,
  relational_bindings jsonb NOT NULL,
  PRIMARY KEY (network, block_height, block_hash),
  CHECK ((old_main->>'network' = network AND (old_main->>'block_height')::integer = block_height
    AND old_main->>'block_hash' = block_hash AND old_main->>'complete' = 'true'
    AND (old_main->>'protocol_record_count')::integer >= 0 AND (old_main->>'event_count')::integer >= (old_main->>'protocol_record_count')::integer
    AND (old_main->>'raw_protocol_candidate_count')::integer >= 0 AND (old_main->>'transaction_count')::integer >= 0
    AND old_main->'block_atomic' = 'true'::jsonb AND old_main->'fee_once' = 'true'::jsonb AND old_main->'invalid_zero' = 'true'::jsonb
    AND old_main#>>'{payload,__powNativeStorage,model}' = 'proof-indexer-native-transition-chunks-v1'
    AND old_main#>>'{payload,__powNativeStorage,sha256}' = old_archive_sha256) IS TRUE),
  CHECK ((new_manifest->>'model' = 'audit31-native-jsonb-chunks-v1'
    AND new_manifest->>'sha256' ~ '^[0-9a-f]{64}$' AND new_manifest->>'sha256' <> old_archive_sha256
    AND jsonb_typeof(new_manifest->'parts') = 'array' AND (new_manifest->>'bytes')::integer BETWEEN 2 AND 134217728) IS TRUE),
  CHECK ((jsonb_typeof(replacement_fields) = 'object'
    AND replacement_fields ?& ARRAY['expandedLiquidity','transitionChainCommitment']
    AND CASE WHEN old_main->'protocol_record_count' = '0'::jsonb THEN
      replacement_fields - ARRAY['expandedLiquidity','transitionChainCommitment','closingWorkProjection'] = '{}'::jsonb
      AND old_main->'event_count' = '0'::jsonb AND old_main->'transaction_count' = '0'::jsonb AND old_main->'raw_protocol_candidate_count' = '0'::jsonb
    ELSE replacement_fields ?& ARRAY['replayRecords','traces','eventSetCommitment','replayDescriptorCommitment']
      AND replacement_fields - ARRAY['expandedLiquidity','transitionChainCommitment','closingWorkProjection','replayRecords','traces','eventSetCommitment','replayDescriptorCommitment'] = '{}'::jsonb END
    AND replacement_fields#>>'{expandedLiquidity,txid}' = incident_txid
    AND replacement_fields#>>'{expandedLiquidity,blockHash}' = '0000000000000000000113f979011a14bdcecdb509671b763fc60a02ebaccbc9'
    AND replacement_fields#>'{expandedLiquidity,registryPaymentVout}' = 'null'::jsonb
    AND replacement_fields#>>'{transitionChainCommitment,model}' = 'canonical-work-amo-raw-transition-chain-sha256-v1'
    AND replacement_fields#>>'{transitionChainCommitment,sha256}' ~ '^[0-9a-f]{64}$') IS TRUE),
  CHECK ((jsonb_typeof(relational_bindings) = 'object'
    AND relational_bindings ?& ARRAY['recordCount','eventCount','recordRowsSha256','eventRowsSha256']
    AND relational_bindings - ARRAY['recordCount','eventCount','recordRowsSha256','eventRowsSha256'] = '{}'::jsonb
    AND jsonb_typeof(relational_bindings->'recordCount') = 'number' AND (relational_bindings->>'recordCount')::integer >= 0
    AND jsonb_typeof(relational_bindings->'eventCount') = 'number' AND (relational_bindings->>'eventCount')::integer >= 0
    AND relational_bindings->>'recordRowsSha256' ~ '^[0-9a-f]{64}$' AND relational_bindings->>'eventRowsSha256' ~ '^[0-9a-f]{64}$') IS TRUE)
) TABLESPACE proof_indexer_large_state_v1;
ALTER TABLE proof_indexer.work_amo_expanded_liquidity_supersessions_v1 OWNER TO proof_indexer_transition_storage_owner;
REVOKE ALL ON proof_indexer.work_amo_expanded_liquidity_supersessions_v1 FROM PUBLIC;
GRANT SELECT ON proof_indexer.work_amo_expanded_liquidity_supersessions_v1 TO proof_indexer;
CREATE TRIGGER immutable_work_amo_expanded_liquidity_supersession_v1 BEFORE UPDATE OR DELETE
ON proof_indexer.work_amo_expanded_liquidity_supersessions_v1 FOR EACH ROW
EXECUTE FUNCTION proof_indexer.reject_work_transition_archive_mutation_v1();
