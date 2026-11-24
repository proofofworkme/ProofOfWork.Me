-- Within the native encoder, original_frame is reconstructed from the immutable
-- archive. Only chain witness hashes may differ within its records and projections.
DECLARE
  field text;
  witness_key text;
  old_item jsonb;
  new_item jsonb;
  old_witness jsonb;
  new_witness jsonb;
  descriptor jsonb;
  descriptor_count integer := 0;
  raw_count integer := 0;
  child_count integer := 0;
  changed_child boolean := false;
  slot bigint;
  record_map jsonb;
  pair jsonb;
  previous_projection jsonb;
  previous_original_projection jsonb;
  expected_length_change integer;
  descriptor_length_change integer := 0;
  witness_copies integer;
BEGIN
 IF jsonb_array_length(NEW.payload->'replayRecords') IS DISTINCT FROM NEW.event_count
    OR jsonb_array_length(NEW.payload->'traces') IS DISTINCT FROM NEW.protocol_record_count+NEW.transaction_count
    OR NEW.event_set_model IS DISTINCT FROM NEW.payload#>>'{eventSetCommitment,model}'
    OR NEW.event_set_payload_bytes IS DISTINCT FROM (NEW.payload#>>'{eventSetCommitment,payloadBytes}')::integer
    OR NEW.event_count IS DISTINCT FROM (NEW.payload#>>'{eventSetCommitment,eventCount}')::integer
 THEN RAISE EXCEPTION 'Expanded replay scalar/record cardinality differs'; END IF;
 FOREACH field IN ARRAY ARRAY['eventSetCommitment','replayDescriptorCommitment'] LOOP
   old_witness := original_frame->field;
   new_witness := NEW.payload->field;
   IF (old_witness-ARRAY['sha256','payloadBytes'] = new_witness-ARRAY['sha256','payloadBytes']
       AND old_witness->>'sha256' ~ '^[0-9a-f]{64}$' AND new_witness->>'sha256' ~ '^[0-9a-f]{64}$') IS NOT TRUE
   THEN RAISE EXCEPTION 'Expanded replay commitment metadata differs'; END IF;
 END LOOP;
 SELECT jsonb_object_agg(jsonb_build_array(o->'txid',o->'position')::text,jsonb_build_array(o,n))
   INTO record_map FROM ROWS FROM(jsonb_array_elements(original_frame->'replayRecords'),
                                   jsonb_array_elements(NEW.payload->'replayRecords')) r(o,n);
 IF (SELECT count(*) FROM jsonb_object_keys(record_map)) <> NEW.event_count
 THEN RAISE EXCEPTION 'Expanded replay record position is not unique'; END IF;
 FOR old_item,new_item IN SELECT * FROM ROWS FROM(jsonb_array_elements(original_frame->'replayRecords'),
                                                   jsonb_array_elements(NEW.payload->'replayRecords')) LOOP
   IF old_item->'rawCandidate' = 'true'::jsonb THEN
     raw_count := raw_count+1;
     witness_copies := 1+jsonb_array_length(old_item->'derived');
     witness_key := 'transitionChainCommitmentAfter';
     IF (jsonb_typeof(old_item->'derived')='array'
         AND jsonb_array_length(old_item->'derived')=jsonb_array_length(new_item->'derived')) IS NOT TRUE
     THEN RAISE EXCEPTION 'Expanded replay child count differs'; END IF;
     FOR descriptor,slot IN SELECT * FROM jsonb_array_elements(old_item->'derived') WITH ORDINALITY LOOP
       descriptor_count := descriptor_count+1;
       IF (descriptor->'containerPosition'=old_item->'position' AND descriptor->'derivedIndex'=to_jsonb(slot-1)
           AND descriptor->'parentTransitionChainCommitmentAfter'=old_item->witness_key
           AND jsonb_set(descriptor,'{parentTransitionChainCommitmentAfter}',new_item->witness_key,false)
             = new_item->'derived'->(slot::integer-1)) IS NOT TRUE
       THEN RAISE EXCEPTION 'Expanded replay linked descriptor differs'; END IF;
     END LOOP;
     old_item := old_item-'derived';
     new_item := new_item-'derived';
   ELSIF old_item->'rawCandidate' = 'false'::jsonb THEN
     child_count := child_count+1;
     witness_copies := 3;
     witness_key := 'parentTransitionChainCommitmentAfter';
     pair := record_map->(jsonb_build_array(old_item->'txid',old_item->'parentPosition')::text);
     descriptor := old_item#>'{rawWitness,descriptor}';
     slot := (descriptor->>'derivedIndex')::integer;
     IF (pair->0->'rawCandidate'='true'::jsonb AND pair->1->'rawCandidate'='true'::jsonb
         AND slot >= 0 AND descriptor = pair->0->'derived'->(slot::integer)
         AND new_item#>'{rawWitness,descriptor}'=pair->1->'derived'->(slot::integer)
         AND old_item#>>'{rawWitness,model}'='canonical-work-amo-v5-derived-child-v1'
         AND descriptor->'projectionPosition'=old_item->'position'
         AND old_item#>'{rawWitness,parentPosition}'=old_item->'parentPosition'
         AND old_item#>'{rawWitness,parentProtocol}'=pair->0->'protocol'
         AND old_item->'chargesTransactionFee'='false'::jsonb AND old_item->'derived'='true'::jsonb
         AND descriptor->'rawCandidate'='false'::jsonb AND descriptor->'economicDelta'='false'::jsonb
         AND descriptor->'chargesTransactionFee'='false'::jsonb AND descriptor->'claimsEconomicOutputs'='false'::jsonb
         AND old_item->witness_key=pair->0->'transitionChainCommitmentAfter'
         AND new_item->witness_key=pair->1->'transitionChainCommitmentAfter'
         AND (old_item#>'{output,projection}') @> descriptor
         AND (new_item#>'{output,projection}') @> (new_item#>'{rawWitness,descriptor}')) IS NOT TRUE
     THEN RAISE EXCEPTION 'Expanded replay derived event lost its unique parent'; END IF;
     changed_child := changed_child OR old_item->witness_key <> new_item->witness_key;
     old_item := old_item#-'{output,projection,parentTransitionChainCommitmentAfter}'#-'{rawWitness,descriptor}';
     new_item := new_item#-'{output,projection,parentTransitionChainCommitmentAfter}'#-'{rawWitness,descriptor}';
   ELSE RAISE EXCEPTION 'Expanded replay raw/derived flag differs'; END IF;
   old_witness := old_item->witness_key;
   new_witness := new_item->witness_key;
   IF (old_witness-ARRAY['sha256','payloadBytes']=new_witness-ARRAY['sha256','payloadBytes'] AND old_witness->>'sha256' ~ '^[0-9a-f]{64}$'
       AND new_witness->>'sha256' ~ '^[0-9a-f]{64}$' AND old_item-witness_key=new_item-witness_key) IS NOT TRUE
   THEN RAISE EXCEPTION 'Expanded replay record changed beyond its chain witness'; END IF;
   descriptor_length_change := descriptor_length_change+witness_copies*(length(new_witness->>'payloadBytes')-length(old_witness->>'payloadBytes'));
 END LOOP;
 IF (NEW.payload#>>'{replayDescriptorCommitment,payloadBytes}')::integer IS DISTINCT FROM
      (original_frame#>>'{replayDescriptorCommitment,payloadBytes}')::integer+descriptor_length_change
    OR raw_count<>NEW.protocol_record_count OR child_count<>descriptor_count OR raw_count+child_count<>NEW.event_count
    OR (NOT changed_child AND original_frame->'eventSetCommitment' IS DISTINCT FROM NEW.payload->'eventSetCommitment')
 THEN RAISE EXCEPTION 'Expanded replay event set lacks linked derived evidence'; END IF;
 -- Each canonical preimage embeds its prior commitment. Hashes are fixed-width;
 -- its decimal payloadBytes is the only possible input-length change. Include
 -- the block-close commitment in the same sequence. Qualification separately
 -- reproduces the initial seed and every intermediate from raw Core bytes.
 FOR old_item,new_item,slot IN SELECT o,n,ord FROM ROWS FROM(jsonb_array_elements(original_frame->'traces'),
                                      jsonb_array_elements(NEW.payload->'traces')) WITH ORDINALITY r(o,n,ord)
   UNION ALL SELECT jsonb_build_object('kind','block-close','transitionChainCommitmentAfter',original_frame->'transitionChainCommitment'),
                    jsonb_build_object('kind','block-close','transitionChainCommitmentAfter',NEW.payload->'transitionChainCommitment'),NULL::bigint
   ORDER BY 3 NULLS LAST LOOP
   old_witness := old_item->'transitionChainCommitmentAfter';
   new_witness := new_item->'transitionChainCommitmentAfter';
   IF ((slot IS NULL OR old_item->>'kind' IN ('protocol-record','transaction-fee'))
       AND old_item-'transitionChainCommitmentAfter'=new_item-'transitionChainCommitmentAfter'
       AND old_witness-ARRAY['sha256','payloadBytes']=jsonb_build_object('model','canonical-work-amo-raw-transition-chain-sha256-v1')
       AND new_witness-ARRAY['sha256','payloadBytes']=old_witness-ARRAY['sha256','payloadBytes']
       AND old_witness->>'sha256' ~ '^[0-9a-f]{64}$' AND new_witness->>'sha256' ~ '^[0-9a-f]{64}$'
       AND old_witness->>'sha256' <> new_witness->>'sha256'
       AND jsonb_typeof(old_witness->'payloadBytes')='number' AND jsonb_typeof(new_witness->'payloadBytes')='number'
       AND old_witness->>'payloadBytes' ~ '^[1-9][0-9]{0,8}$' AND new_witness->>'payloadBytes' ~ '^[1-9][0-9]{0,8}$'
       AND CASE WHEN expected_length_change IS NULL THEN abs((new_witness->>'payloadBytes')::integer-(old_witness->>'payloadBytes')::integer)<=1
          ELSE (new_witness->>'payloadBytes')::integer=(old_witness->>'payloadBytes')::integer+expected_length_change END) IS NOT TRUE
   THEN RAISE EXCEPTION 'Expanded replay trace changed beyond its bound chain witness'; END IF;
   expected_length_change := length(new_witness->>'payloadBytes')-length(old_witness->>'payloadBytes');
   IF old_item->>'kind'='protocol-record' THEN
     pair := record_map->(jsonb_build_array(old_item->'txid',old_item->'position')::text);
     IF pair->0->'transitionChainCommitmentAfter' IS DISTINCT FROM old_witness
        OR pair->1->'transitionChainCommitmentAfter' IS DISTINCT FROM new_witness
     THEN RAISE EXCEPTION 'Expanded replay trace detached from its unique raw record'; END IF;
   END IF;
 END LOOP;
 IF revision.replacement_fields ? 'closingWorkProjection' THEN
   IF original_frame->'closingWorkProjection' IS NOT DISTINCT FROM NEW.payload->'closingWorkProjection'
      OR ((original_frame->'closingWorkProjection')-ARRAY['transferBatches','transfers'])
       IS DISTINCT FROM ((NEW.payload->'closingWorkProjection')-ARRAY['transferBatches','transfers'])
   THEN RAISE EXCEPTION 'Expanded replay changes unsupported projection fields'; END IF;
   IF NEW.block_height>977230 THEN
     -- The prior receipt is already bound to the same incident, source and pinned tip.
     SELECT r.replacement_fields->'closingWorkProjection',
            proof_indexer.reconstruct_work_transition_payload_v1(a.payload)->'closingWorkProjection'
       INTO STRICT previous_projection,previous_original_projection
       FROM proof_indexer.work_amo_expanded_liquidity_supersessions_v1 r
       JOIN proof_indexer.work_transition_archive_v1 a USING (network,block_height,block_hash)
       WHERE a.payload->>'sha256'=r.old_archive_sha256 AND r.network=NEW.network AND r.block_height=NEW.block_height-1 AND r.block_hash=NEW.previous_block_hash
         AND r.qualification_sha256=revision.qualification_sha256 AND r.manifest_sha256=revision.manifest_sha256;
   END IF;
   FOREACH field IN ARRAY ARRAY['transferBatches','transfers'] LOOP
     IF original_frame->'closingWorkProjection'->field IS NOT DISTINCT FROM NEW.payload->'closingWorkProjection'->field THEN CONTINUE; END IF;
     IF (jsonb_typeof(original_frame->'closingWorkProjection'->field)='array'
         AND jsonb_array_length(original_frame->'closingWorkProjection'->field)=jsonb_array_length(NEW.payload->'closingWorkProjection'->field)) IS NOT TRUE
     THEN RAISE EXCEPTION 'Expanded replay projection array shape changed'; END IF;
     witness_key := CASE field WHEN 'transferBatches' THEN 'transitionChainCommitmentAfter' ELSE 'parentTransitionChainCommitmentAfter' END;
     FOR old_item,new_item,slot IN SELECT * FROM ROWS FROM(jsonb_array_elements(original_frame->'closingWorkProjection'->field),
                                      jsonb_array_elements(NEW.payload->'closingWorkProjection'->field)) WITH ORDINALITY LOOP
       IF old_item=new_item THEN CONTINUE; END IF;
       IF (old_item-witness_key=new_item-witness_key AND (old_item->witness_key)-ARRAY['sha256','payloadBytes']=(new_item->witness_key)-ARRAY['sha256','payloadBytes']
           AND old_item->witness_key->>'sha256' ~ '^[0-9a-f]{64}$' AND new_item->witness_key->>'sha256' ~ '^[0-9a-f]{64}$') IS NOT TRUE
       THEN RAISE EXCEPTION 'Expanded replay changes projection economics or position'; END IF;
       IF new_item->'blockHeight'=to_jsonb(NEW.block_height) AND new_item->>'blockHash'=NEW.block_hash THEN
         pair := record_map->(jsonb_build_array(new_item->'txid',jsonb_build_object(
           'blockHash',NEW.block_hash,'blockHeight',NEW.block_height,'blockTransactionIndex',new_item->'blockIndex',
           'protocolVout',new_item->'protocolVout','recordOrdinal',new_item->'recordOrdinal'))::text);
         IF (pair->0->witness_key=old_item->witness_key AND pair->1->witness_key=new_item->witness_key
             AND pair->1->>'protocol'='pwt1' AND pair->1#>'{outcome,valid}'='true'::jsonb
             AND (field='transferBatches' AND pair->1->'rawCandidate'='true'::jsonb AND pair->1#>>'{outcome,semanticKind}'='token-transfer-batch'
               OR field='transfers' AND pair->1->'rawCandidate'='false'::jsonb AND pair->1#>>'{outcome,semanticKind}'='token-transfer'
                 AND new_item->'derivedId'=pair->1#>'{rawWitness,descriptor,derivedId}')) IS NOT TRUE
         THEN RAISE EXCEPTION 'Expanded replay projected witness is not bound to its event'; END IF;
       ELSIF (new_item->>'blockHeight')::integer NOT BETWEEN 977230 AND NEW.block_height-1
          OR old_item IS DISTINCT FROM previous_original_projection->field->(slot::integer-1)
          OR new_item IS DISTINCT FROM previous_projection->field->(slot::integer-1)
       THEN RAISE EXCEPTION 'Expanded replay projection does not carry prior qualified provenance'; END IF;
     END LOOP;
   END LOOP;
 END IF;
END;
