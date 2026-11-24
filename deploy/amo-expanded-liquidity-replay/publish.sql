-- Per-block source and evidence are inputs from the hash-bound read-only qualification.
-- The old main pointer is immutable. Exchange only that pointer in the transaction;
-- keep its original row and the immutable archive/chunks. The ordinary native insert
-- trigger handles the corrected row and future idempotent retries.
DO $publish$
DECLARE
  request record;
  q jsonb;
  b jsonb;
  old_row proof_indexer.work_amo_block_transitions%ROWTYPE;
  archived jsonb;
  original jsonb;
  corrected jsonb;
  raw bytea;
  chunk bytea;
  digest bytea;
  parts jsonb;
  frame jsonb;
  n integer;
  changed integer;
BEGIN
  SELECT * INTO STRICT request FROM pg_temp.expanded_replay_input;
  q:=request.qualification;
  FOR b IN SELECT value FROM jsonb_array_elements(q->'blocks') LOOP
    SELECT * INTO STRICT old_row FROM proof_indexer.work_amo_block_transitions
      WHERE network='livenet' AND block_height=(b->>'height')::integer AND block_hash=b->>'hash';
    SELECT payload INTO STRICT archived FROM proof_indexer.work_transition_archive_v1
      WHERE network=old_row.network AND block_height=old_row.block_height AND block_hash=old_row.block_hash;
    original:=proof_indexer.reconstruct_work_transition_payload_v1(archived);
    IF encode(sha256(jsonb_send(to_jsonb(old_row))),'hex') IS DISTINCT FROM b->>'currentMainRowSha256'
      OR old_row.previous_block_hash IS DISTINCT FROM b->>'previousBlockHash'
      OR jsonb_build_object('protocolRecordCount',old_row.protocol_record_count,
                            'rawProtocolCandidateCount',old_row.raw_protocol_candidate_count,
                            'transactionCount',old_row.transaction_count,
                            'eventCount',old_row.event_count) IS DISTINCT FROM b->'protocolCounts'
      OR old_row.event_set_sha256 IS DISTINCT FROM b#>>'{oldEventSetCommitment,sha256}'
      OR original->'eventSetCommitment' IS DISTINCT FROM b->'oldEventSetCommitment'
      OR (old_row.complete AND old_row.block_atomic AND old_row.fee_once AND old_row.invalid_zero) IS NOT TRUE
      OR original ? 'expandedLiquidity' OR original->'transitionChainCommitment' IS DISTINCT FROM b->'oldTransitionChainCommitment'
      OR archived->>'sha256' IS DISTINCT FROM b->>'oldNativeSha256'
      OR encode(sha256(jsonb_send(original)),'hex') IS DISTINCT FROM b->>'oldNativeSha256'
      OR octet_length(jsonb_send(original)) IS DISTINCT FROM (b->>'oldNativeBytes')::integer
      OR proof_indexer.read_work_transition_payload_v1('livenet',old_row.block_height,old_row.block_hash,old_row.payload) IS DISTINCT FROM original
    THEN RAISE EXCEPTION 'Qualified original native transition differs at %',old_row.block_height; END IF;
    corrected:=original||(b->'replacementFields');
    raw:=jsonb_send(corrected);
    IF corrected->'eventSetCommitment' IS DISTINCT FROM b->'newEventSetCommitment'
      OR encode(sha256(raw),'hex') IS DISTINCT FROM b->>'newNativeSha256'
      OR octet_length(raw) IS DISTINCT FROM (b->>'newNativeBytes')::integer
    THEN RAISE EXCEPTION 'Qualified corrected native transition differs at %',old_row.block_height; END IF;
    parts:='[]'::jsonb;
    FOR n IN 0..((octet_length(raw)-1)/65536) LOOP
      chunk:=substring(raw FROM n*65536+1 FOR 65536);
      digest:=sha256(chunk);
      INSERT INTO proof_indexer.work_transition_chunks_v1(hash,data) VALUES(digest,chunk) ON CONFLICT DO NOTHING;
      IF NOT EXISTS(SELECT 1 FROM proof_indexer.work_transition_chunks_v1 WHERE hash=digest AND data=chunk)
      THEN RAISE EXCEPTION 'Native chunk collision'; END IF;
      parts:=parts||jsonb_build_array(encode(digest,'hex'));
    END LOOP;
    frame:=jsonb_build_object('model','audit31-native-jsonb-chunks-v1','sha256',b->>'newNativeSha256','bytes',octet_length(raw),'parts',parts);
    INSERT INTO proof_indexer.work_amo_expanded_liquidity_supersessions_v1
      (network,block_height,block_hash,incident_txid,qualification_sha256,manifest_sha256,source_commit,source_tree,
       through_height,through_hash,old_main,old_archive_sha256,new_manifest,replacement_fields,relational_bindings)
    VALUES('livenet',old_row.block_height,old_row.block_hash,q#>>'{declaration,txid}',request.qualification_sha,request.manifest_sha,
      q#>>'{sourceBinding,sourceCommit}',q#>>'{sourceBinding,sourceTree}',(q#>>'{tip,height}')::integer,q#>>'{tip,hash}',
      to_jsonb(old_row),b->>'oldNativeSha256',frame,b->'replacementFields',b->'relationalBindings');
    DELETE FROM proof_indexer.work_amo_block_transitions AS t WHERE network=old_row.network AND block_height=old_row.block_height
      AND block_hash=old_row.block_hash AND to_jsonb(t)=to_jsonb(old_row);
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'Canonical pointer changed during publication'; END IF;
    INSERT INTO proof_indexer.work_amo_block_transitions
      SELECT (jsonb_populate_record(old_row,jsonb_build_object('payload',corrected,
        'event_set_sha256',b#>>'{newEventSetCommitment,sha256}'))).*;
    IF old_row.block_height >= (SELECT max(block_height)-127 FROM proof_indexer.work_transition_archive_v1 WHERE network=old_row.network) THEN
      INSERT INTO proof_indexer.work_transition_hot_slots_v1(network,slot,block_height,block_hash,payload_sha256,payload)
      VALUES(old_row.network,mod(old_row.block_height,128),old_row.block_height,old_row.block_hash,b->>'newNativeSha256',corrected)
      ON CONFLICT(network,slot) DO UPDATE SET block_height=excluded.block_height,block_hash=excluded.block_hash,
        payload_sha256=excluded.payload_sha256,payload=excluded.payload;
    END IF;
  END LOOP;
END $publish$;
