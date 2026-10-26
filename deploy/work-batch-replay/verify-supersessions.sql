-- Read-only successor check for this bounded incident (at most 512 block versions).
-- Pair with the pinned native contract and Core/marker/checkpoint qualification.
-- Historical restore verifiers remain historical; no old archive is rewritten.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL statement_timeout='1200s';
WITH verified AS MATERIALIZED (
 SELECT d.network,d.block_height,d.block_hash,d.qualification_sha256,d.manifest_sha256,
  d.old_archive_sha256,d.new_manifest->>'sha256' AS replacement_sha256,
  (d.original_manifest->>'sha256'=d.old_archive_sha256
   AND encode(sha256(jsonb_send(d.original_payload)),'hex')=d.old_archive_sha256
   AND proof_indexer.work_transition_metadata_v1(d.original_payload)=(d.old_main->'payload')-'__powNativeStorage') IS TRUE AS original_verified,
  (encode(sha256(jsonb_send(d.replacement_payload)),'hex')=d.new_manifest->>'sha256'
   AND d.replacement_payload=d.original_payload||d.replacement_fields) IS TRUE AS replacement_verified,
  (t.block_hash=d.block_hash) AS currently_selected,
  CASE WHEN t.block_hash=d.block_hash THEN
   t.payload->'__powNativeStorage'->>'sha256'=d.new_manifest->>'sha256'
   AND proof_indexer.read_work_transition_payload_v1(t.network,t.block_height,t.block_hash,t.payload)=d.replacement_payload
   AND to_jsonb(t)-'payload'=d.old_main-'payload'
  ELSE NULL END AS current_metadata_verified
 FROM proof_indexer.work_batch_transition_supersessions_v1 s
 LEFT JOIN proof_indexer.work_transition_archive_v1 a
  ON a.network=s.network AND a.block_height=s.block_height AND a.block_hash=s.block_hash
 CROSS JOIN LATERAL (
  SELECT s.*,a.payload AS original_manifest,
   proof_indexer.reconstruct_work_transition_payload_v1(a.payload) AS original_payload,
   proof_indexer.reconstruct_work_transition_payload_v1(s.new_manifest) AS replacement_payload
  OFFSET 0
 ) d
 LEFT JOIN proof_indexer.work_amo_block_transitions t
  ON t.network=d.network AND t.block_height=d.block_height
)
SELECT jsonb_build_object('format','work-batch-supersession-restore-readcheck-v1',
 'rows',COALESCE(jsonb_agg(to_jsonb(verified) ORDER BY block_height),'[]'::jsonb),
 'rowCount',count(*),'allOriginalAndReplacementFramesVerified',COALESCE(bool_and(original_verified AND replacement_verified),false))
FROM verified;
ROLLBACK;
