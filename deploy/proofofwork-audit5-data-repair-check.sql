-- Read-only before/after evidence for the four approved audit-5 targets.
-- Run with writers stopped; compare BEFORE bootstrap resumes canonical writes.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '2s';
SET LOCAL work_mem = '16MB';
WITH targets(txid, event_id) AS (VALUES
  ('6ac53aca33541d60d6d58af03d4c27d09bbeaab3e3c016ee10d270aad578957c', 3607561::bigint),
  ('8eaa4098c631bded37ce40d88778cce53a6d00b2d4f3eb783d2b9713fc9951cc', 3621078::bigint),
  ('9e202c0fae0f3ab500325fc7a5326dda1d68c8500c85fe51cb18385e7d8aeab0', 3747805::bigint)
), migration AS MATERIALIZED (
 SELECT * FROM proof_indexer.meta WHERE key='workAmoV5Migration:livenet'
), seed AS MATERIALIZED (
 SELECT * FROM proof_indexer.ledger_snapshots WHERE network='livenet'
 AND payload->>'model'='canonical-work-amo-v5-h-minus-one-seed-evidence-v1'
), refs AS (
 SELECT payload->>'issuanceValueSnapshotId' id,'issuance' origin FROM proof_indexer.events
 WHERE network='livenet' AND COALESCE(payload->>'issuanceValueSnapshotId','')<>''
 UNION
 SELECT entry->'snapshot'->>'snapshotId','witness' FROM proof_indexer.meta rebuild
 JOIN proof_indexer.meta witness ON witness.key=rebuild.value->'verifierBinding'->>'witnessSetMetaKey'
 CROSS JOIN LATERAL jsonb_array_elements(COALESCE(witness.value->'entries','[]'::jsonb)) entry
 WHERE rebuild.key='canonical:rebuild' AND entry->>'disposition'='preserve'
 UNION SELECT snapshot_id,'seed-evidence' FROM seed
 UNION SELECT payload->'canonicalSummary'->>'snapshotId','seed-summary-provenance' FROM seed
 UNION SELECT jsonb_array_elements_text(COALESCE(value->'replayEvidence'->'seed'->'snapshotIds','[]'::jsonb)),'migration-seed-provenance' FROM migration
 UNION SELECT jsonb_array_elements_text(COALESCE(value->'replayEvidence'->'closing'->'snapshotIds','[]'::jsonb)),'migration-closing-provenance' FROM migration
), grouped AS (
 SELECT id,array_agg(DISTINCT origin ORDER BY origin) origins FROM refs
 WHERE COALESCE(id,'')<>'' GROUP BY id
), protected_rows AS MATERIALIZED (
 SELECT r.id AS snapshot_id,r.origins,s.snapshot_id IS NOT NULL resolved,
 CASE WHEN s.snapshot_id IS NULL THEN NULL ELSE encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') END row_sha256
 FROM grouped r LEFT JOIN proof_indexer.ledger_snapshots s ON s.network='livenet' AND s.snapshot_id=r.id
), transitions AS MATERIALIZED (
 SELECT t.*,b.canonical block_canonical,b.previous_block_hash canonical_previous_hash
 FROM proof_indexer.work_amo_block_transitions t
 JOIN proof_indexer.blocks b ON b.network=t.network AND b.height=t.block_height AND b.block_hash=t.block_hash
 WHERE t.network='livenet' AND t.block_height IN (959621,959804)
), event_hashes AS MATERIALIZED (
  SELECT e.event_id, encode(sha256(convert_to(
    CASE WHEN t.txid IS NOT NULL THEN
      jsonb_set(to_jsonb(e)-'updated_at','{payload}', e.payload-
        ARRAY['amountSubatoms','decimals','unitScale','amountStorageModel','precisionModel'])
    ELSE to_jsonb(e) END::text,'UTF8')),'hex') AS row_hash
  FROM proof_indexer.events e LEFT JOIN targets t ON t.txid=e.txid AND t.event_id=e.event_id
  WHERE e.network='livenet'
), invariant_hashes AS (
  SELECT 'eventsExceptApprovedMetadata' AS name, count(*) AS rows,
    encode(sha256(convert_to(COALESCE(string_agg(row_hash,'' ORDER BY event_id),''),'UTF8')),'hex') AS sha256
  FROM event_hashes
  UNION ALL
  SELECT 'creditBalances', count(*), encode(sha256(convert_to(COALESCE(string_agg(
    encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex'),'' ORDER BY token_id,address),''),'UTF8')),'hex')
  FROM proof_indexer.credit_balances b WHERE network='livenet'
  UNION ALL
  SELECT 'creditDefinitions', count(*), encode(sha256(convert_to(COALESCE(string_agg(
    encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex'),'' ORDER BY token_id),''),'UTF8')),'hex')
  FROM proof_indexer.credit_definitions d WHERE network='livenet'
  UNION ALL
  SELECT 'creditListings', count(*), encode(sha256(convert_to(COALESCE(string_agg(
    encode(sha256(convert_to(to_jsonb(l)::text,'UTF8')),'hex'),'' ORDER BY listing_id),''),'UTF8')),'hex')
  FROM proof_indexer.credit_listings l WHERE network='livenet'
  UNION ALL
  SELECT 'transitionCommitments', count(*), encode(sha256(convert_to(COALESCE(string_agg(
    encode(sha256(convert_to(jsonb_build_array(block_height,block_hash,previous_block_hash,model,
      state_commitment_model,work_token_state_model,opening_network_value_q8::text,closing_network_value_q8::text,
      opening_state_sha256,closing_state_sha256,event_set_sha256,protocol_record_count,raw_protocol_candidate_count,
      transaction_count,event_count,block_atomic,fee_once,invalid_zero,complete)::text,'UTF8')),'hex'),'' ORDER BY block_height),''),'UTF8')),'hex')
  FROM proof_indexer.work_amo_block_transitions WHERE network='livenet'
)
SELECT jsonb_build_object(
  'format','proofofwork-audit5-repair-evidence-v1',
  'capturedAt',clock_timestamp(),
  'database',current_database(),
  'otherDatabaseSessions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()),
  'aux',(SELECT jsonb_build_object(
    'txid',t.txid,'status',t.status,'blockHash',t.block_hash,'height',t.block_height,'blockIndex',t.block_index,
    'rawVin',jsonb_array_length(t.raw_tx->'vin'),'rawVout',jsonb_array_length(t.raw_tx->'vout'),
    'inputs',(SELECT COALESCE(jsonb_agg(jsonb_build_object('vin',vin,'prevTxid',prev_txid,'prevVout',prev_vout,
      'valueSats',value_sats::text) ORDER BY vin),'[]'::jsonb) FROM proof_indexer.tx_inputs WHERE network=t.network AND txid=t.txid),
    'outputs',(SELECT COALESCE(jsonb_agg(jsonb_build_object('vout',vout,'valueSats',value_sats::text,
      'scriptPubKey',scriptpubkey) ORDER BY vout),'[]'::jsonb) FROM proof_indexer.tx_outputs WHERE network=t.network AND txid=t.txid),
    'opReturnCount',(SELECT count(*) FROM proof_indexer.op_returns WHERE network=t.network AND txid=t.txid),
    'anchorLinks',(SELECT COALESCE(jsonb_agg(jsonb_build_object('txid',txid,'vout',vout,
      'spentByTxid',spent_by_txid,'spentByVin',spent_by_vin,'valueSats',value_sats::text,'scriptPubKey',scriptpubkey)
      ORDER BY txid,vout),'[]'::jsonb) FROM proof_indexer.tx_outputs WHERE network=t.network AND spent_by_txid=t.txid))
    FROM proof_indexer.transactions t WHERE t.network='livenet' AND t.txid='4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359'),
  'targetEvents',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.event_id) FROM proof_indexer.events e
    JOIN targets t ON t.txid=e.txid AND t.event_id=e.event_id WHERE e.network='livenet'),
  'missingZeroMetadataTxids',(SELECT COALESCE(jsonb_agg(e.txid ORDER BY e.txid),'[]'::jsonb)
    FROM proof_indexer.events e WHERE e.network='livenet' AND e.kind='token-listing-sealed-invalid'
    AND e.valid=false AND e.status='confirmed' AND e.amount_sats=0
    AND e.payload->>'reasonCode'='work-amo-v6-listing-already-sealed'
    AND e.payload#>>'{saleAuthorization,version}'='pwt-sale-v8'
    AND NOT (e.payload ? 'amountSubatoms')),
  'protectedSnapshots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY snapshot_id) FROM protected_rows p),
  -- These full-row hashes bind the separately verified immutable seed and
  -- bootstrap authority. The two old summary IDs remain provenance only.
  'historicalAuthorities',jsonb_build_object(
    'model','audit5-historical-authorities-v1',
    'seed',(SELECT jsonb_build_object('snapshotId',snapshot_id,
      'rowSha256',encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex')) FROM seed s),
    'migration',(SELECT jsonb_build_object('key',key,
      'rowSha256',encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')) FROM migration m),
    'transitions',(SELECT jsonb_agg(jsonb_build_object('blockHeight',t.block_height,'blockHash',t.block_hash,
      'rowSha256',encode(sha256(convert_to((to_jsonb(t)-ARRAY['block_canonical','canonical_previous_hash'])::text,'UTF8')),'hex'),
      'blockCanonical',t.block_canonical,'canonicalPreviousHash',t.canonical_previous_hash) ORDER BY t.block_height) FROM transitions t),
    'blocks',(SELECT jsonb_agg(jsonb_build_object('height',height,'hash',block_hash,
      'previousHash',previous_block_hash,'canonical',canonical) ORDER BY height,block_hash)
      FROM proof_indexer.blocks WHERE network='livenet' AND height IN(959620,959621,959804) AND canonical=true)),
  'invariants',(SELECT jsonb_agg(to_jsonb(h) ORDER BY name) FROM invariant_hashes h)
);
COMMIT;
