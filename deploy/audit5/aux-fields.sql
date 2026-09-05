-- Exact same auxiliary transaction and its five already-recorded spend links.
-- Capture only while the independently verified stopped-writer guard holds.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SET LOCAL work_mem = '4MB';
SELECT jsonb_build_object(
  'format','audit5-exact-aux-fields-v1',
  'database',current_database(),
  'capturedAt',clock_timestamp(),
  'otherDatabaseSessions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()),
  'transaction',(SELECT to_jsonb(t) FROM proof_indexer.transactions t WHERE network='livenet' AND txid='4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359'),
  'inputs',(SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY vin),'[]'::jsonb) FROM proof_indexer.tx_inputs i WHERE network='livenet' AND txid='4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359'),
  'outputs',(SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY vout),'[]'::jsonb) FROM proof_indexer.tx_outputs o WHERE network='livenet' AND txid='4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359'),
  'opReturns',(SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY vout,output_index),'[]'::jsonb) FROM proof_indexer.op_returns o WHERE network='livenet' AND txid='4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359'),
  'parentOutputs',(SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.txid,o.vout),'[]'::jsonb)
    FROM proof_indexer.tx_outputs o JOIN (VALUES
      ('fc57450c502e054ecf23469d88f5249a578799da59d111fe234e50ca593c20e5',3),
      ('fc57450c502e054ecf23469d88f5249a578799da59d111fe234e50ca593c20e5',2),
      ('db836174bde97f027c85553e26af3b896b9d3f04745f32f6f99af631865c7bcc',2),
      ('488f31b5ac317123a2383e49eaf06fb6351f117e217bdeb9440795de431175a5',2),
      ('3c69d397b2ec43c8eb8a83409b7f2dc979f5b887a307f8a12e053b3ebc545a00',2),
      ('a8906b1f9bab7a791a5271a3e9276b8a91e0fb502a49235d4be0c1b8e8a27b79',2)
    ) expected(txid,vout) ON expected.txid=o.txid AND expected.vout=o.vout WHERE o.network='livenet'),
  'anchors',(SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY txid,vout),'[]'::jsonb) FROM proof_indexer.tx_outputs o WHERE network='livenet' AND spent_by_txid='4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359')
);
COMMIT;
