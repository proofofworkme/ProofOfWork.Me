import { isDeepStrictEqual } from 'node:util';
import { permissionReadError } from '../permissions.mjs';

const hash = value => /^[a-f0-9]{64}$/u.test(value ?? '');
function fields(row) {
  return [Number(row.height ?? row.block_height), row.block_hash, row.previous_block_hash, row.model,
    row.complete, row.block_atomic, row.fee_once, row.invalid_zero, Number(row.protocol_record_count),
    Number(row.raw_protocol_candidate_count), row.storage_commitment ?? row.payload?.__powNativeStorage ?? null,
    row.payload?.blockDescriptorCommitment, row.payload?.replayDescriptorCommitment];
}

// Verify both immutable native frames against the old signed receipt and the selected transition.
// The index reader supplies the same repeatable-read transaction that provided the canonical block.
export async function permissionSupersession(client, network, old, row) {
  if (!old || Number(old.height) !== Number(row.height) || old.block_hash !== row.block_hash) {
    throw permissionReadError('Permission journal supersession crosses a fork.');
  }
  if (isDeepStrictEqual(fields(old), fields(row))) return null;
  const result = await client.query(`/* permission_native_supersession */
    WITH frames AS MATERIALIZED (
      SELECT s.*, a.payload AS original_manifest,
        proof_indexer.reconstruct_work_transition_payload_v1(a.payload) AS original,
        proof_indexer.reconstruct_work_transition_payload_v1(s.new_manifest) AS replacement
      FROM proof_indexer.work_batch_transition_supersessions_v1 s
      JOIN proof_indexer.work_transition_archive_v1 a USING (network,block_height,block_hash)
      WHERE s.network=$1 AND s.block_height=$2 AND s.block_hash=$3
    )
    SELECT d.old_main, d.source_commit, d.source_tree, d.manifest_sha256, d.qualification_sha256,
      d.old_archive_sha256, d.new_manifest->>'sha256' AS replacement_sha256,
      d.through_height, d.through_hash,
      (d.original_manifest->>'sha256'=d.old_archive_sha256 AND
       encode(sha256(jsonb_send(d.original)),'hex')=d.old_archive_sha256 AND
       proof_indexer.work_transition_metadata_v1(d.original)=(d.old_main->'payload')-'__powNativeStorage' AND
       encode(sha256(jsonb_send(d.replacement)),'hex')=d.new_manifest->>'sha256' AND
       d.replacement=d.original||d.replacement_fields AND
       t.payload->'__powNativeStorage'->>'sha256'=d.new_manifest->>'sha256' AND
       proof_indexer.read_work_transition_payload_v1(t.network,t.block_height,t.block_hash,t.payload)=d.replacement AND
       to_jsonb(t)-ARRAY['payload','created_at']=d.new_metadata AND t.created_at=(d.old_main->>'created_at')::timestamptz AND
       d.new_metadata-'event_set_sha256'=d.old_main-ARRAY['payload','created_at','event_set_sha256'] AND
       t.event_set_sha256=d.replacement->'eventSetCommitment'->>'sha256') IS TRUE AS verified
    FROM frames d JOIN proof_indexer.work_amo_block_transitions t USING (network,block_height,block_hash)
    JOIN proof_indexer.blocks boundary ON boundary.network=d.network AND boundary.canonical
      AND boundary.height=d.through_height AND boundary.block_hash=d.through_hash`, [network, row.height, row.block_hash]);
  const proof = result.rows[0];
  if (result.rows.length !== 1 || proof.verified !== true || !isDeepStrictEqual(fields(old), fields(proof.old_main)) ||
      !hash(proof.manifest_sha256) || !hash(proof.qualification_sha256) || !hash(proof.through_hash) ||
      !/^[a-f0-9]{40}$/u.test(proof.source_commit) || !/^[a-f0-9]{40}$/u.test(proof.source_tree) ||
      proof.old_archive_sha256 !== old.storage_commitment?.sha256 || proof.replacement_sha256 !== row.storage_commitment?.sha256) {
    throw permissionReadError('Permission native supersession provenance differs from the authenticated journal.');
  }
  const { old_main, verified, ...provenance } = proof;
  return provenance;
}
