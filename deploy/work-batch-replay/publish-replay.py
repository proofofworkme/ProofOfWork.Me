#!/usr/bin/env python3
"""Exact incident proposal. Rendering is default; execution requires --execute.
One transaction installs the reviewed extension, publishes the qualified ordinary-event
suffix, and derives its activation marker. This never restores services."""
import argparse, base64, copy, hashlib, json, os, pwd, re, stat, subprocess, threading, urllib.request
from pathlib import Path

INCIDENT = "b7c620e48c2d725a143cecd7f7808036d89907124d410ba57d272d34e650cc28"
RUNTIME = Path("/opt/proofofwork-api")
TARGETS = (
 "scripts/backfill-proof-indexer.mjs", "server/db/native-transition-storage.mjs",
 "server/db/work-batch-reader.mjs", "server/proof-api.mjs",
 "server/work-amo-v5-raw.mjs", "server/work-batch-declaration.mjs",
)
def stable(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def sha(value): return hashlib.sha256(value).hexdigest()
def scalar_commitment(value):
 # Match preflight workAmoV5CanonicalPayloadCommitment; catalogs use bare SHA.
 return sha(stable({"model":"canonical-work-amo-payload-sha256-v1","value":value}).encode())
MAX_INPUT_BYTES=32*1024*1024
MAX_SQL_BYTES=128*1024*1024
MAX_NATIVE_BYTES=128*1024*1024
MAX_TOTAL_NATIVE_BYTES=8*1024*1024*1024
MAX_RAW_BYTES=2*1024*1024*1024
REPLACEMENT_FIELDS={"workBatchV1","transitionChainCommitment","replayRecords","replayDescriptorCommitment","traces","eventSetCommitment"}
def private_read(path, expected, limit=MAX_INPUT_BYTES, root_owned=True):
 p=Path(path)
 if p.resolve()!=p or not re.fullmatch(r"[0-9a-f]{64}", expected): raise ValueError("Invalid pinned input")
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  before=os.fstat(fd)
  if not stat.S_ISREG(before.st_mode) or (root_owned and before.st_uid!=0) or before.st_mode&0o022 or before.st_size>limit: raise ValueError("Unsafe pinned input")
  data=b""
  while True:
   part=os.read(fd,65536)
   if not part: break
   data+=part
  after=os.fstat(fd)
  if before!=after or sha(data)!=expected: raise ValueError("Pinned input changed")
  return data
 finally: os.close(fd)
def exclusive(path, data):
 p=Path(path)
 if p.resolve()!=p or p.parent.resolve()!=p.parent: raise ValueError("Noncanonical output")
 for parent in (p.parent,*p.parent.parents):
  info=parent.stat()
  if info.st_uid!=0 or info.st_mode&0o022:
   if str(parent)=="/tmp" and info.st_uid==0 and info.st_mode&stat.S_ISVTX: continue
   raise ValueError("Unsafe output ancestry")
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  pending=memoryview(data)
  while pending:
   written=os.write(fd,pending)
   if written<=0: raise OSError("Short output write")
   pending=pending[written:]
  os.fsync(fd)
 finally: os.close(fd)
def helper_contract(data):
 text=data.decode()
 expected=re.search(r'const EXPECTED_CONTRACT_SHA256 = ("[0-9a-f]{64}");',text)
 query=re.search(r'const CONTRACT_QUERY = ("(?:[^"\\]|\\.)*");',text)
 if not expected or not query: raise ValueError("Unsupported native helper")
 return json.loads(expected[1]),json.loads(query[1]).removesuffix(" AS storage_contract")
def validate_derived_closures(records, count, derived_count):
 raw=[r for r in records if r.get("rawCandidate") is True];children=[r for r in records if r.get("rawCandidate") is False]
 if len(raw)!=count or len(children)!=derived_count or len(raw)+len(children)!=len(records): raise ValueError("Replay candidate counts")
 descriptors=0
 for parent in raw:
  derived=parent.get("derived")
  if not isinstance(derived,list) or len(derived)>1: raise ValueError("Unsupported derived count")
  if not derived: continue
  descriptors+=1;descriptor=derived[0];witness=parent.get("rawWitness",{});parts=witness.get("rawRecordParts",[])
  if parent.get("protocol")!="pwt1" or parent.get("outcome",{}).get("semanticKind")!="token-sale" or parent["outcome"].get("valid") is not True or witness.get("model")!="canonical-raw-protocol-record-v1" or len(parts)!=1 or not parts[0].get("text","").startswith("pwt1:buy5:"): raise ValueError("Only existing buy5 closure is supported")
  position=parent["position"];projection={**position,"recordOrdinal":position["recordOrdinal"]+1}
  if descriptor.get("kind")!="token-listing-closed" or descriptor.get("derivedIndex")!=0 or any(descriptor.get(k) is not False for k in ("rawCandidate","economicDelta","chargesTransactionFee","claimsEconomicOutputs")) or descriptor.get("containerPosition")!=position or descriptor.get("materializationPosition")!=position or descriptor.get("projectionPosition")!=projection or descriptor.get("parentTransitionChainCommitmentAfter")!=parent.get("transitionChainCommitmentAfter"): raise ValueError("Derived closure descriptor")
  matches=[r for r in children if r.get("txid")==parent.get("txid") and r.get("parentPosition")==position]
  if len(matches)!=1: raise ValueError("Derived closure parent/child binding")
  child=matches[0];cw=child.get("rawWitness",{});output=child.get("output",{}).get("projection",{})
  if child.get("protocol")!="pwt1" or child.get("derived") is not True or child.get("outcome",{}).get("semanticKind")!="token-listing-closed" or child["outcome"].get("valid") is not True or child.get("chargesTransactionFee") is not False or child.get("position")!=projection or cw.get("model")!="canonical-work-amo-v5-derived-child-v1" or cw.get("parentProtocol")!="pwt1" or cw.get("parentPosition")!=position or cw.get("descriptor")!=descriptor or child.get("parentTransitionChainCommitmentAfter")!=parent.get("transitionChainCommitmentAfter") or any(output.get(k)!=v for k,v in descriptor.items()): raise ValueError("Derived closure child")
 if descriptors!=derived_count: raise ValueError("Orphan derived closure")
def validate_manifest(m, old_sha, new_sha):
 if m.get("format")!="work-batch-native-supersession-manifest-v1": raise ValueError("Manifest format")
 for k in ("qualificationSha256","nativeBridgeSha256"):
  if not re.fullmatch(r"[0-9a-f]{64}",m.get(k,"")): raise ValueError(k)
 for k in ("sourceCommit","sourceTree"):
  if not re.fullmatch(r"[0-9a-f]{40}",m.get(k,"")): raise ValueError(k)
 for key,pin in (("oldCatalog",old_sha),("newCatalog",new_sha)):
  if sha(stable(m[key]).encode())!=pin: raise ValueError("Catalog commitment")
 rows=m["rows"];cp=m["checkpoint"]
 if not 1<=len(rows)<=512 or cp["height"]!=973103+len(rows) or cp["hash"]!=rows[-1]["hash"]: raise ValueError("Suffix bounds")
 if m["anchor"]["height"]!=973103 or m["proposedMarker"]["declaration"]["txid"]!=INCIDENT: raise ValueError("Incident")
 totals={"nativePayloadBytes":0,"newNativePayloadBytes":0,"rawBlockBytes":0,"ordinaryRecords":0}
 for i,row in enumerate(rows,973104):
  if row["height"]!=i or set(row["replacementFields"])!=REPLACEMENT_FIELDS: raise ValueError("Replacement range")
  for key in ("oldNativeSha256","newNativeSha256","currentMainRowSha256"):
   if not re.fullmatch(r"[0-9a-f]{64}",row[key]): raise ValueError("Native digest")
  for key in ("oldNativeBytes","newNativeBytes"):
   if type(row[key]) is not int or not 2<=row[key]<=MAX_NATIVE_BYTES: raise ValueError("Native bytes")
  if row.get("nativePayloadBytes")!=row["oldNativeBytes"] or type(row["rawBlockBytes"]) is not int or not 1<=row["rawBlockBytes"]<=4_000_000: raise ValueError("Raw/native byte evidence")
  context=row["replacementFields"]["workBatchV1"]
  if context["activationHeight"]!=973104 or context["declaration"]["txid"]!=INCIDENT: raise ValueError("Authority context")
  scalar=row["oldScalarMetadata"];new_scalar=row["newScalarMetadata"];count=scalar["protocol_record_count"];transactions=scalar["transaction_count"]
  if type(count) is not int or not 0<=count<=1024 or type(transactions) is not int or not 0<=transactions<=count: raise ValueError("Ordinary record bound")
  events=row["eventCount"];derived=row["derivedEventCount"]
  if type(events) is not int or type(derived) is not int or not 0<=derived<=count or events!=count+derived or scalar["event_count"]!=events or scalar["raw_protocol_candidate_count"]!=count: raise ValueError("Raw/derived count evidence")
  if {k:v for k,v in scalar.items() if k!="event_set_sha256"}!={k:v for k,v in new_scalar.items() if k!="event_set_sha256"}: raise ValueError("Scalar change exceeds event-set provenance")
  for key,value in (("old",scalar),("new",new_scalar)):
   if scalar_commitment(value)!=row[key+"ScalarMetadataSha256"]: raise ValueError("Scalar commitment")
   event_set=row[key+"EventSetCommitment"]
   if event_set["sha256"]!=value["event_set_sha256"] or event_set["model"]!=value["event_set_model"] or event_set["payloadBytes"]!=value["event_set_payload_bytes"] or event_set["eventCount"]!=events or not re.fullmatch(r"[0-9a-f]{64}",event_set["sha256"]): raise ValueError("Event-set scalar binding")
  if {k:v for k,v in row["oldEventSetCommitment"].items() if k!="sha256"}!={k:v for k,v in row["newEventSetCommitment"].items() if k!="sha256"} or (derived==0 and row["oldEventSetCommitment"]!=row["newEventSetCommitment"]): raise ValueError("Event-set metadata change")
  bindings=row["relationalBindings"]
  if set(bindings)!={"eventCount","eventRowsSha256","recordCount","recordRowsSha256"} or type(bindings["eventCount"]) is not int or type(bindings["recordCount"]) is not int or bindings["eventCount"]!=events or bindings["recordCount"]!=count: raise ValueError("Relational counts")
  if any(not re.fullmatch(r"[0-9a-f]{64}",bindings[k]) for k in ("eventRowsSha256","recordRowsSha256")): raise ValueError("Relational digest")
  replacement=row["replacementFields"]
  if replacement["eventSetCommitment"]!=row["newEventSetCommitment"] or row.get("eventSetProvenanceOnly") is not True: raise ValueError("Event-set provenance evidence")
  if not isinstance(replacement["replayRecords"],list) or len(replacement["replayRecords"])!=events or not isinstance(replacement["traces"],list) or len(replacement["traces"])!=count+transactions: raise ValueError("Replay shape")
  validate_derived_closures(replacement["replayRecords"],count,derived)
  changed=row["allowedChangedFields"]
  if not isinstance(changed,list) or len(changed)!=len(set(changed)) or not {"workBatchV1","transitionChainCommitment"}<=set(changed)<=REPLACEMENT_FIELDS: raise ValueError("Changed field scope")
  totals["nativePayloadBytes"]+=row["oldNativeBytes"];totals["newNativePayloadBytes"]+=row["newNativeBytes"]
  totals["rawBlockBytes"]+=row["rawBlockBytes"];totals["ordinaryRecords"]+=count
 if totals!=m["resourceUsage"] or totals["ordinaryRecords"]>1024 or totals["rawBlockBytes"]>MAX_RAW_BYTES or max(totals["nativePayloadBytes"],totals["newNativePayloadBytes"])>MAX_TOTAL_NATIVE_BYTES: raise ValueError("Cumulative replay resource bound")
 if sorted(m["runtimeFiles"])!=list(TARGETS): raise ValueError("Runtime scope")

RELATIONAL_BINDINGS_SQL = 'WITH event_rows AS MATERIALIZED (\n SELECT e.event_id,to_jsonb(e) AS document FROM proof_indexer.events e\n JOIN proof_indexer.transactions t ON t.network=e.network AND t.txid=e.txid AND t.status=\'confirmed\' AND t.block_height=e.block_height\n JOIN proof_indexer.blocks b ON b.network=t.network AND b.height=t.block_height AND b.block_hash=t.block_hash AND b.canonical=true\n WHERE e.network=\'livenet\' AND e.status=\'confirmed\' AND e.block_height=$1 AND t.block_hash=$2 AND e.protocol=ANY(ARRAY[\'pwm1\',\'pwa1\',\'pwid1\',\'pwdns1\',\'pwb1\',\'pwt1\',\'pwc1\']::text[])\n),record_rows AS MATERIALIZED (\n SELECT t.block_index,r.txid,to_jsonb(r) AS document FROM proof_indexer.op_returns r\n JOIN proof_indexer.transactions t ON t.network=r.network AND t.txid=r.txid\n JOIN proof_indexer.blocks b ON b.network=t.network AND b.height=t.block_height AND b.block_hash=t.block_hash AND b.canonical=true\n WHERE t.network=\'livenet\' AND t.status=\'confirmed\' AND t.block_height=$1 AND t.block_hash=$2 AND r.protocol=ANY(ARRAY[\'pwm1\',\'pwa1\',\'pwid1\',\'pwdns1\',\'pwb1\',\'pwt1\',\'pwc1\']::text[])\n) SELECT (SELECT count(*)::int FROM event_rows) AS "eventCount",\n (SELECT encode(sha256(jsonb_send(COALESCE(jsonb_agg(document ORDER BY event_id),\'[]\'::jsonb))),\'hex\') FROM event_rows) AS "eventRowsSha256",\n (SELECT count(*)::int FROM record_rows) AS "recordCount",\n (SELECT encode(sha256(jsonb_send(COALESCE(jsonb_agg(document ORDER BY block_index,txid COLLATE "C",document::text COLLATE "C"),\'[]\'::jsonb))),\'hex\') FROM record_rows) AS "recordRowsSha256"'

SQL_BODY = r"""
DO $qualification$
DECLARE m jsonb := __MANIFEST__; qualified_block jsonb; current_transition proof_indexer.work_amo_block_transitions%ROWTYPE;
 a proof_indexer.work_transition_archive_v1%ROWTYPE; original jsonb; replacement jsonb;
 raw bytea; part bytea; digest bytea; parts jsonb; frame jsonb; oldrow jsonb;
 marker jsonb; scalar_expected jsonb; new_scalar_expected jsonb; affected integer; position integer; expected_parent text;
 published jsonb:='[]'::jsonb; relational jsonb; cache_hot boolean; old_bytes bigint:=0; new_bytes bigint:=0; ordinary_records integer:=0; qualified_height integer; qualified_hash text;
BEGIN
 IF current_database() IS DISTINCT FROM m->>'databaseName' OR current_setting('port')::integer IS DISTINCT FROM (m->'databaseEndpoint'->>'port')::integer
  OR current_setting('unix_socket_directories') IS DISTINCT FROM m->'databaseEndpoint'->>'unixSocketDirectories'
 THEN RAISE EXCEPTION 'Database endpoint drift';END IF;
 IF (SELECT value FROM proof_indexer.meta WHERE key='canonical:rebuild') IS DISTINCT FROM m->'checkpoint'->'rebuild'
  OR EXISTS(SELECT 1 FROM proof_indexer.meta WHERE key='canonical:fault' AND value IS DISTINCT FROM 'null'::jsonb)
  OR EXISTS(SELECT 1 FROM proof_indexer.meta WHERE key='work-batch-v1:activation:livenet')
 THEN RAISE EXCEPTION 'Checkpoint/marker drift'; END IF;
 IF (SELECT max(block_height) FROM proof_indexer.work_amo_block_transitions WHERE network='livenet') IS DISTINCT FROM (m->'checkpoint'->>'height')::integer
  OR NOT EXISTS(SELECT 1 FROM proof_indexer.ledger_snapshots WHERE network='livenet' AND snapshot_id=m->'checkpoint'->>'snapshotId'
   AND indexed_through_block=(m->'checkpoint'->>'height')::integer AND payload->>'indexedThroughBlockHash'=m->'checkpoint'->>'hash')
 THEN RAISE EXCEPTION 'Canonical head drift';END IF;
 IF NOT EXISTS(SELECT 1 FROM proof_indexer.work_amo_block_transitions WHERE network='livenet'
  AND block_height=973103 AND block_hash=m->'anchor'->>'hash'
  AND payload->'__powNativeStorage'->>'sha256'=m->'anchor'->>'nativeSha256')
 THEN RAISE EXCEPTION 'Anchor drift';END IF;
 IF jsonb_array_length(m->'rows') NOT BETWEEN 1 AND 512
  OR (m->'checkpoint'->>'height')::integer<>973103+jsonb_array_length(m->'rows')
  OR (m->'resourceUsage'->>'rawBlockBytes')::bigint NOT BETWEEN 1 AND 2147483648
 THEN RAISE EXCEPTION 'Suffix resource bounds';END IF;
 expected_parent:=m->'anchor'->>'hash';
 FOR qualified_block IN SELECT value FROM jsonb_array_elements(m->'rows') LOOP
  SELECT * INTO STRICT current_transition FROM proof_indexer.work_amo_block_transitions
   WHERE network='livenet' AND block_height=(qualified_block->>'height')::integer AND block_hash=qualified_block->>'hash';
  oldrow:=to_jsonb(current_transition);
  scalar_expected:=to_jsonb(jsonb_populate_record(NULL::proof_indexer.work_amo_block_transitions,qualified_block->'oldScalarMetadata'))-'payload';
  new_scalar_expected:=to_jsonb(jsonb_populate_record(NULL::proof_indexer.work_amo_block_transitions,qualified_block->'newScalarMetadata'))-'payload';
  IF new_scalar_expected-'event_set_sha256' IS DISTINCT FROM scalar_expected-'event_set_sha256'
   OR new_scalar_expected->>'event_set_sha256' IS DISTINCT FROM qualified_block#>>'{replacementFields,eventSetCommitment,sha256}'
   OR encode(sha256(jsonb_send(oldrow)),'hex') IS DISTINCT FROM qualified_block->>'currentMainRowSha256'
   OR oldrow-'payload' IS DISTINCT FROM scalar_expected OR current_transition.previous_block_hash IS DISTINCT FROM expected_parent
   OR NOT(current_transition.complete AND current_transition.block_atomic AND current_transition.fee_once AND current_transition.invalid_zero)
   OR current_transition.protocol_record_count NOT BETWEEN 0 AND 1024 OR current_transition.raw_protocol_candidate_count<>current_transition.protocol_record_count OR current_transition.event_count NOT BETWEEN current_transition.protocol_record_count AND 2*current_transition.protocol_record_count
   OR current_transition.payload ? 'workBatchV1'
   OR current_transition.payload->'__powNativeStorage'->>'sha256' IS DISTINCT FROM qualified_block->>'oldNativeSha256'
   OR NOT EXISTS(SELECT 1 FROM proof_indexer.blocks WHERE network=current_transition.network AND height=current_transition.block_height AND block_hash=current_transition.block_hash AND canonical=true)
  THEN RAISE EXCEPTION 'Old canonical row drift';END IF;
  qualified_height:=current_transition.block_height;qualified_hash:=current_transition.block_hash;
  SELECT to_jsonb(bindings) INTO relational FROM (__RELATIONAL_SQL__) bindings;
  IF relational IS DISTINCT FROM qualified_block->'relationalBindings'
   OR (relational->>'eventCount')::integer<>current_transition.event_count OR (relational->>'recordCount')::integer<>current_transition.protocol_record_count
  THEN RAISE EXCEPTION 'Ordinary relational suffix changed';END IF;
  SELECT * INTO STRICT a FROM proof_indexer.work_transition_archive_v1
   WHERE network=current_transition.network AND block_height=current_transition.block_height AND block_hash=current_transition.block_hash;
  IF a.payload->>'sha256' IS DISTINCT FROM qualified_block->>'oldNativeSha256' THEN RAISE EXCEPTION 'Archive drift';END IF;
  original:=proof_indexer.read_work_transition_payload_v1(current_transition.network,current_transition.block_height,current_transition.block_hash,current_transition.payload);
  IF original IS DISTINCT FROM proof_indexer.reconstruct_work_transition_payload_v1(a.payload)
   OR encode(sha256(jsonb_send(original)),'hex') IS DISTINCT FROM qualified_block->>'oldNativeSha256'
   OR octet_length(jsonb_send(original)) IS DISTINCT FROM (qualified_block->>'oldNativeBytes')::integer
  THEN RAISE EXCEPTION 'Old payload drift';END IF;
  replacement:=original||(qualified_block->'replacementFields');raw:=jsonb_send(replacement);
  IF replacement-ARRAY['workBatchV1','transitionChainCommitment','replayRecords','replayDescriptorCommitment','traces','eventSetCommitment'] IS DISTINCT FROM original-ARRAY['workBatchV1','transitionChainCommitment','replayRecords','replayDescriptorCommitment','traces','eventSetCommitment']
   OR encode(sha256(raw),'hex') IS DISTINCT FROM qualified_block->>'newNativeSha256'
   OR octet_length(raw) IS DISTINCT FROM (qualified_block->>'newNativeBytes')::integer
  THEN RAISE EXCEPTION 'Qualified native bridge mismatch';END IF;
  old_bytes:=old_bytes+(qualified_block->>'oldNativeBytes')::bigint;new_bytes:=new_bytes+octet_length(raw);ordinary_records:=ordinary_records+current_transition.protocol_record_count;
  IF (qualified_block->>'oldNativeBytes')::bigint NOT BETWEEN 2 AND 134217728 OR octet_length(raw) NOT BETWEEN 2 AND 134217728
   OR old_bytes>8589934592 OR new_bytes>8589934592 OR ordinary_records>1024
  THEN RAISE EXCEPTION 'Native resource bound exceeded';END IF;
  parts:='[]'::jsonb;
  FOR position IN 0..((octet_length(raw)-1)/65536) LOOP
   part:=substring(raw FROM position*65536+1 FOR 65536);digest:=sha256(part);
   INSERT INTO proof_indexer.work_transition_chunks_v1 VALUES(digest,part) ON CONFLICT DO NOTHING;
   IF NOT EXISTS(SELECT 1 FROM proof_indexer.work_transition_chunks_v1 WHERE hash=digest AND data=part) THEN RAISE EXCEPTION 'Chunk collision/corruption';END IF;
   parts:=parts||jsonb_build_array(encode(digest,'hex'));
  END LOOP;
  frame:=jsonb_build_object('model','audit31-native-jsonb-chunks-v1','bytes',octet_length(raw),'sha256',qualified_block->>'newNativeSha256','parts',parts);
  INSERT INTO proof_indexer.work_batch_transition_supersessions_v1
   (network,block_height,block_hash,incident_txid,qualification_sha256,manifest_sha256,source_commit,source_tree,through_height,through_hash,old_main,old_archive_sha256,new_metadata,new_manifest,replacement_fields,relational_bindings)
   VALUES(current_transition.network,current_transition.block_height,current_transition.block_hash,__INCIDENT__,m->>'qualificationSha256',__MANIFEST_SHA__,m->>'sourceCommit',m->>'sourceTree',(m->'checkpoint'->>'height')::integer,m->'checkpoint'->>'hash',oldrow,qualified_block->>'oldNativeSha256',new_scalar_expected-'created_at',frame,qualified_block->'replacementFields',relational);
  DELETE FROM proof_indexer.work_amo_block_transitions WHERE network=current_transition.network AND block_height=current_transition.block_height AND block_hash=current_transition.block_hash AND to_jsonb(work_amo_block_transitions)=oldrow;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Old row changed during publication';END IF;
  INSERT INTO proof_indexer.work_amo_block_transitions
   SELECT (jsonb_populate_record(NULL::proof_indexer.work_amo_block_transitions,oldrow||new_scalar_expected||jsonb_build_object('payload',replacement))).*;
  SELECT * INTO STRICT current_transition FROM proof_indexer.work_amo_block_transitions WHERE network=current_transition.network AND block_height=current_transition.block_height;
  cache_hot:=current_transition.block_height>=(m->'checkpoint'->>'height')::integer-127;
  IF to_jsonb(current_transition)-'payload' IS DISTINCT FROM new_scalar_expected
   OR current_transition.payload->'__powNativeStorage'->>'sha256' IS DISTINCT FROM qualified_block->>'newNativeSha256'
   OR proof_indexer.read_work_transition_payload_v1(current_transition.network,current_transition.block_height,current_transition.block_hash,current_transition.payload) IS DISTINCT FROM replacement
   OR NOT EXISTS(SELECT 1 FROM proof_indexer.work_transition_archive_v1 oldarchive WHERE oldarchive.network=current_transition.network AND oldarchive.block_hash=current_transition.block_hash AND to_jsonb(oldarchive)=to_jsonb(a))
   OR proof_indexer.read_work_transition_payload_v1(current_transition.network,current_transition.block_height,current_transition.block_hash,oldrow->'payload') IS DISTINCT FROM original
   OR (cache_hot AND NOT EXISTS(SELECT 1 FROM proof_indexer.work_transition_hot_slots_v1 WHERE network=current_transition.network AND slot=mod(current_transition.block_height,128) AND block_height=current_transition.block_height AND block_hash=current_transition.block_hash AND payload_sha256=qualified_block->>'newNativeSha256'))
   OR (NOT cache_hot AND EXISTS(SELECT 1 FROM proof_indexer.work_transition_hot_slots_v1 WHERE network=current_transition.network AND block_height=current_transition.block_height))
  THEN RAISE EXCEPTION 'Publication postcondition failed';END IF;
  IF current_transition.block_height=973104 THEN
   marker:=jsonb_build_object('model','canonical-work-batch-v1-activation-marker-v1','network','livenet','activationHeight',973104,
    'declaration',m->'proposedMarker'->'declaration','evidenceCommitment',replacement->'workBatchV1'->'evidenceCommitment',
    'activationBlock',jsonb_build_object('height',current_transition.block_height,'hash',current_transition.block_hash,'previousBlockHash',current_transition.previous_block_hash,'transitionChainCommitment',replacement->'transitionChainCommitment'));
   IF marker IS DISTINCT FROM m->'proposedMarker'
    OR (marker->'declaration') @> (replacement->'workBatchV1'->'declaration') IS NOT TRUE
   THEN RAISE EXCEPTION 'Derived activation marker mismatch';END IF;
  END IF;
  published:=published||jsonb_build_array(jsonb_build_object('height',current_transition.block_height,'hash',current_transition.block_hash,'oldNativeSha256',qualified_block->>'oldNativeSha256','newNativeSha256',qualified_block->>'newNativeSha256','originalArchiveRetained',true,'currentMetadataVerified',true,'originalScalarsPreserved',true,'currentScalarsQualified',true,'oldScalarMetadataSha256',qualified_block->>'oldScalarMetadataSha256','newScalarMetadataSha256',qualified_block->>'newScalarMetadataSha256','hotSlotVerified',true,'cacheMode',CASE WHEN cache_hot THEN 'hot' ELSE 'cold' END,'historicalReadVerified',true,'relationalRowsVerified',true));
  expected_parent:=current_transition.block_hash;
 END LOOP;
 IF old_bytes IS DISTINCT FROM (m->'resourceUsage'->>'nativePayloadBytes')::bigint
  OR new_bytes IS DISTINCT FROM (m->'resourceUsage'->>'newNativePayloadBytes')::bigint
  OR ordinary_records IS DISTINCT FROM (m->'resourceUsage'->>'ordinaryRecords')::integer
  OR EXISTS(SELECT 1 FROM proof_indexer.work_transition_hot_slots_v1 h
   LEFT JOIN proof_indexer.work_batch_transition_supersessions_v1 s ON s.network=h.network AND s.block_height=h.block_height AND s.block_hash=h.block_hash
   WHERE h.network='livenet' AND h.block_height BETWEEN 973104 AND (m->'checkpoint'->>'height')::integer
    AND (h.block_height<(m->'checkpoint'->>'height')::integer-127 OR s.new_manifest IS NULL OR h.payload_sha256<>s.new_manifest->>'sha256'))
 THEN RAISE EXCEPTION 'Final resource or hot-slot policy drift';END IF;
 IF expected_parent IS DISTINCT FROM m->'checkpoint'->>'hash' OR marker IS NULL THEN RAISE EXCEPTION 'Incomplete suffix';END IF;
 INSERT INTO proof_indexer.meta(key,value) VALUES('work-batch-v1:activation:livenet',marker);
 INSERT INTO replay_publication_result VALUES(jsonb_build_object('format','work-batch-native-supersession-result-v1','manifestSha256',__MANIFEST_SHA__,'qualificationSha256',m->>'qualificationSha256','blocks',published,'marker',marker,'originalArchivesRetained',true,'oldChunksRetained',true,'currentMetadataVerified',true,'markerVerified',true,'availabilityVerified',false));
END $qualification$;
"""
def literal(value): return "'"+value.replace("'","''")+"'"
def render_transaction(m, manifest_sha, extension, old_query, new_query):
 encoded=literal(stable(m))+"::jsonb"
 old_expected=literal(stable(m["oldCatalog"]))+"::jsonb"
 new_expected=literal(stable(m["newCatalog"]))+"::jsonb"
 body=SQL_BODY.replace("__RELATIONAL_SQL__",RELATIONAL_BINDINGS_SQL.replace("$1","qualified_height").replace("$2","qualified_hash")).replace("__MANIFEST__",encoded).replace("__INCIDENT__",literal(INCIDENT)).replace("__MANIFEST_SHA__",literal(manifest_sha))
 before=f"DO $catalog$ BEGIN IF ({old_query}) IS DISTINCT FROM {old_expected} THEN RAISE EXCEPTION 'Old catalog drift';END IF;END $catalog$;"
 after=f"DO $catalog$ BEGIN IF ({new_query}) IS DISTINCT FROM {new_expected} THEN RAISE EXCEPTION 'New catalog mismatch';END IF;END $catalog$;"
 return "\n".join([
  "\\set ON_ERROR_STOP on","BEGIN ISOLATION LEVEL SERIALIZABLE;","SET LOCAL search_path=pg_catalog,pg_temp;SET LOCAL TIME ZONE 'UTC';",
  "SET LOCAL statement_timeout='1200s';SET LOCAL lock_timeout='5s';",
  "SELECT pg_advisory_xact_lock(190725,973104);",
  "LOCK TABLE proof_indexer.work_amo_block_transitions,proof_indexer.blocks,proof_indexer.meta,proof_indexer.events,proof_indexer.transactions,proof_indexer.op_returns,proof_indexer.ledger_snapshots IN SHARE ROW EXCLUSIVE MODE;",
  before,extension,after,"CREATE TEMP TABLE replay_publication_result(result jsonb) ON COMMIT PRESERVE ROWS;",
  body,after,"COMMIT;","SELECT result FROM replay_publication_result;",""])
def verify_evidence(m, verify_runtime=True):
 pref=m["evidence"]["preflight"]
 q=json.loads(private_read(pref["path"],pref["sha256"]))
 if pref["sha256"]!=m["qualificationSha256"] or pref["sha256"]!=m["nativeBridgeSha256"]: raise ValueError("Evidence pin mismatch")
 if q.get("format")!="work-batch-bounded-reseal-qualification-v4" or q.get("qualified") is not True or q.get("earliestSelection",{}).get("verified") is not True: raise ValueError("Unqualified evidence")
 if q.get("mode")!="after-drain" or q.get("sourceState")!="committed" or any(q.get(k) is not True for k in ("ordinaryRelationalSuffixVerified","fullRawSuffixVerified","ordinaryDerivedClosuresVerified","noBatchLookingRecordsVerified")): raise ValueError("Publication requires drained committed qualification")
 if q.get("nativeCatalogSha256")!=sha(stable(m["oldCatalog"]).encode()): raise ValueError("Qualified catalog mismatch")
 declaration=q.get("declaration",{})
 expected={"txid":INCIDENT,"blockHeight":973103,"blockHash":"00000000000000000001fd3a7d7509d540d5e764e413d16acf9d07e090b8f47b","blockTransactionIndex":1621,"protocolVout":1,"recordOrdinal":0,"registryPaymentVout":2,"activationHeight":973104}
 if any(declaration.get(key)!=value for key,value in expected.items()) or declaration.get("signatureVerified") is not True or declaration.get("inputPrevoutsVerified")!=1: raise ValueError("Exact signed declaration evidence required")

 if q["resourceUsage"]!=m["resourceUsage"]: raise ValueError("Resource evidence mismatch")
 if q["blocks"]!=m["rows"] or q["proposedMarker"]!=m["proposedMarker"] or q["anchor"]!=m["anchor"]: raise ValueError("Evidence content mismatch")
 if q["checkpoint"]!={k:v for k,v in m["checkpoint"].items() if k!="rebuild"} or q["canonicalRebuild"]!=m["checkpoint"]["rebuild"]: raise ValueError("Qualification head mismatch")
 if q["sourceCommit"]!=m["sourceCommit"] or q["sourceTree"]!=m["sourceTree"] or q["runtimeSources"]!=m["runtimeFiles"] or q["databaseName"]!=m["databaseName"] or q["databaseEndpoint"]!=m["databaseEndpoint"]: raise ValueError("Source/database binding")
 for row in q["blocks"]:
  if any(row.get(k) is not True for k in ("baselineExactlyReproduced","compatibilityDeterministic","economicStateEqual","workGenericIdStateEqual","projectionEqual","eventsAndFeesEqual")): raise ValueError("Qualification failure")
  if row["rawProtocolCandidateCount"]!=row["oldScalarMetadata"]["raw_protocol_candidate_count"] or row["protocolRecordCount"]!=row["oldScalarMetadata"]["protocol_record_count"] or row["batchLookingCount"]!=0 or any(row.get(k) is not True for k in ("ordinaryEventSetVerified","ordinaryRecordsVerified","ordinaryDerivedClosuresVerified","eventSetProvenanceOnly")): raise ValueError("Ordinary qualification failure")
 if verify_runtime:
  for rel,pin in m["runtimeFiles"].items(): private_read(str(RUNTIME/rel),pin,20_000_000,root_owned=False)
def prepare_manifest(preflight, preflight_path, preflight_sha, old_catalog, new_catalog):
 return {
  "format":"work-batch-native-supersession-manifest-v1",
  "qualificationSha256":preflight_sha,"nativeBridgeSha256":preflight_sha,
  "sourceCommit":preflight["sourceCommit"],"sourceTree":preflight["sourceTree"],
  "sourceManifestSha256":preflight["sourceManifestSha256"],"runtimeFiles":preflight["runtimeSources"],
  "databaseName":preflight["databaseName"],"databaseEndpoint":preflight["databaseEndpoint"],"oldCatalog":old_catalog,"newCatalog":new_catalog,
  "checkpoint":{**preflight["checkpoint"],"rebuild":preflight["canonicalRebuild"]},
  "anchor":preflight["anchor"],"proposedMarker":preflight["proposedMarker"],"rows":preflight["blocks"],"resourceUsage":preflight["resourceUsage"],
  "evidence":{"preflight":{"path":preflight_path,"sha256":preflight_sha}},
 }
def database_endpoint_args(m, check_socket=True):
 endpoint=m["databaseEndpoint"];port=endpoint["port"];directory=endpoint["unixSocketDirectories"]
 if type(port) is not int or not 1<=port<=65535 or not isinstance(directory,str) or not re.fullmatch(r"/[A-Za-z0-9_/-]+",directory): raise ValueError("One exact local PostgreSQL socket directory required")
 if endpoint.get("serverAddress") not in (None,"127.0.0.1","::1") or endpoint.get("serverPort") not in (None,port): raise ValueError("Database is not the captured local endpoint")
 if check_socket:
  socket=Path(directory)/(".s.PGSQL."+str(port));info=socket.lstat();owner=pwd.getpwnam("postgres").pw_uid
  if not stat.S_ISSOCK(info.st_mode) or info.st_uid!=owner: raise ValueError("Unexpected PostgreSQL socket identity")
 return ["-h",directory,"-p",str(port)]
def verify_core_prefix(m, rpc=None):
 def request(method,params):
  try:
   url=os.environ["BITCOIN_RPC_URL"];user=os.environ["BITCOIN_RPC_USER"];password=os.environ["BITCOIN_RPC_PASSWORD"]
   authorization=base64.b64encode((user+":"+password).encode()).decode()
   req=urllib.request.Request(url,data=json.dumps({"jsonrpc":"1.0","id":"batch-replay-precommit","method":method,"params":params}).encode(),
    headers={"content-type":"application/json","authorization":"Basic "+authorization},method="POST")
   with urllib.request.urlopen(req,timeout=8) as response:data=response.read(1_000_001)
   if len(data)>1_000_000:raise ValueError("Response bound")
   body=json.loads(data)
   if body.get("error") is not None:raise ValueError("RPC error")
   return body["result"]
  except Exception:raise ValueError("First-party Core prefix verification unavailable") from None
 invoke=rpc or request
 for height,expected in ((973103,m["anchor"]["hash"]),(m["checkpoint"]["height"],m["checkpoint"]["hash"])):
  if invoke("getblockhash",[height])!=expected:raise ValueError("Canonical Core prefix changed before COMMIT")
def execute_staged(sql, argv, final_fence):
 suffix="COMMIT;\nSELECT result FROM replay_publication_result;\n"
 if sql.count(suffix)!=1 or not sql.endswith(suffix): raise ValueError("Transaction boundary")
 staged=sql[:-len(suffix)]+"\\echo WORK_BATCH_TRANSACTION_READY\n"
 proc=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
 error_parts=[];output_truncated=[False];error_bytes=[0]
 def collect_stderr():
  while True:
   chunk=proc.stderr.read(65536)
   if not chunk:break
   remaining=2*1024*1024-error_bytes[0];encoded=chunk.encode()
   if len(encoded)>remaining:output_truncated[0]=True
   kept=encoded[:max(0,remaining)];error_parts.append(kept.decode(errors="replace"));error_bytes[0]+=len(kept)
 thread=threading.Thread(target=collect_stderr,daemon=True);thread.start()
 output=[];output_bytes=0;commit_sent=False;fence_error=None
 def keep_output(chunk):
  nonlocal output_bytes
  remaining=2*1024*1024-output_bytes;encoded=chunk.encode()
  if len(encoded)>remaining:output_truncated[0]=True
  kept=encoded[:max(0,remaining)];output.append(kept.decode(errors="replace"));output_bytes+=len(kept)
 try:
  proc.stdin.write(staged);proc.stdin.flush()
  for line in proc.stdout:
   if line.strip()=="WORK_BATCH_TRANSACTION_READY":
    try:
     if output_truncated[0]:raise ValueError("Bounded database output exceeded")
     final_fence()
    except Exception as exc:
     fence_error=type(exc).__name__
     proc.stdin.write("ROLLBACK;\n\\quit\n");proc.stdin.close()
    else:
     # No commit instruction is sent until source/input fences pass again.
     proc.stdin.write(suffix);proc.stdin.close();commit_sent=True
    break
   keep_output(line)
  if not proc.stdin.closed:proc.stdin.close()
  while True:
   chunk=proc.stdout.read(65536)
   if not chunk:break
   keep_output(chunk)
  code=proc.wait();thread.join()
 finally:
  if not proc.stdin.closed:proc.stdin.close()
 return {"returncode":code,"stdout":"".join(output),"stderr":"".join(error_parts),"commitSent":commit_sent,"fenceError":fence_error,"outputTruncated":output_truncated[0]}
def main():
 p=argparse.ArgumentParser()
 for name in ("storage-sql","baseline-helper","runtime-helper"):
  p.add_argument("--"+name,required=True);p.add_argument("--"+name+"-sha256",required=True)
 p.add_argument("--manifest",required=True);p.add_argument("--manifest-sha256")
 p.add_argument("--receipt",required=True);p.add_argument("--database")
 p.add_argument("--preflight");p.add_argument("--preflight-sha256")
 p.add_argument("--old-catalog");p.add_argument("--old-catalog-sha256")
 p.add_argument("--new-catalog");p.add_argument("--new-catalog-sha256")
 p.add_argument("--render")
 mode=p.add_mutually_exclusive_group(required=True);mode.add_argument("--prepare",action="store_true");mode.add_argument("--execute",action="store_true")
 a=p.parse_args()
 extension=private_read(a.storage_sql,a.storage_sql_sha256).decode()
 old_sha,old_query=helper_contract(private_read(a.baseline_helper,a.baseline_helper_sha256))
 new_sha,new_query=helper_contract(private_read(a.runtime_helper,a.runtime_helper_sha256,root_owned=not Path(a.runtime_helper).is_relative_to(RUNTIME)))
 if a.prepare:
  if not a.render or not all((a.preflight,a.preflight_sha256,a.old_catalog,a.old_catalog_sha256,a.new_catalog,a.new_catalog_sha256)): raise ValueError("Preparation pins required")
  preflight=json.loads(private_read(a.preflight,a.preflight_sha256))
  m=prepare_manifest(preflight,a.preflight,a.preflight_sha256,json.loads(private_read(a.old_catalog,a.old_catalog_sha256)),json.loads(private_read(a.new_catalog,a.new_catalog_sha256)))
  data=(stable(m)+"\n").encode();manifest_sha=sha(data)
 else:
  if not a.manifest_sha256 or a.render: raise ValueError("Execution manifest pin required")
  data=private_read(a.manifest,a.manifest_sha256);manifest_sha=a.manifest_sha256;m=json.loads(data)
 validate_manifest(m,old_sha,new_sha);verify_evidence(m,verify_runtime=a.execute)
 endpoint_args=database_endpoint_args(m,check_socket=a.execute)
 sql=render_transaction(m,manifest_sha,extension,old_query,new_query)
 if len(data)>MAX_INPUT_BYTES or len(sql.encode())>MAX_SQL_BYTES: raise ValueError("Prepared artifact exceeds hard byte bound")
 base={"format":"work-batch-native-supersession-dispatch-v1","manifestSha256":manifest_sha,"sqlSha256":sha(sql.encode()),"availabilityVerified":False}
 if a.prepare:
  exclusive(a.manifest,data);exclusive(a.render,sql.encode())
  result={**base,"status":"rendered-only","manifestPath":a.manifest,"sqlPath":a.render,"committed":False}
  exclusive(a.receipt,(stable(result)+"\n").encode());print(stable(result));return
 if a.database!=m["databaseName"] or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_-]{0,62}",a.database or ""): raise ValueError("Exact database required")
 # Reserve uncertain outcome evidence before any subprocess. Never rewrite it.
 exclusive(a.receipt,(stable({**base,"status":"dispatch-started-outcome-unknown"})+"\n").encode())
 def final_fence():
  verify_core_prefix(m)
  database_endpoint_args(m)
  private_read(a.manifest,manifest_sha)
  private_read(a.storage_sql,a.storage_sql_sha256)
  private_read(a.baseline_helper,a.baseline_helper_sha256)
  private_read(a.runtime_helper,a.runtime_helper_sha256,root_owned=not Path(a.runtime_helper).is_relative_to(RUNTIME))
  verify_evidence(m)
 result=execute_staged(sql,["sudo","-n","-u","postgres","/usr/bin/psql","-X","-q","-A","-t",*endpoint_args,"-d",a.database,"-v","ON_ERROR_STOP=1"],final_fence)
 status="unconfirmed";native=None
 try:
  lines=[x for x in result["stdout"].splitlines() if x.strip()]
  native=json.loads(lines[-1]) if result["returncode"]==0 and result["commitSent"] and not result["outputTruncated"] else None
  if native and native.get("manifestSha256")==manifest_sha and native.get("originalArchivesRetained") is True and native.get("oldChunksRetained") is True:status="committed"
 except (ValueError,IndexError):native=None
 exclusive(a.receipt+".stdout.log",result["stdout"].encode())
 exclusive(a.receipt+".stderr.log",result["stderr"].encode())
 final={**base,"status":status,"committed":status=="committed","postconditionsVerified":status=="committed","returncode":result["returncode"],"commitSent":result["commitSent"],"fenceError":result["fenceError"],"outputTruncated":result["outputTruncated"],"stdoutSha256":sha(result["stdout"].encode()),"stderrSha256":sha(result["stderr"].encode()),"stdoutPath":a.receipt+".stdout.log","stderrPath":a.receipt+".stderr.log","result":native}
 exclusive(a.receipt+".result.json",(stable(final)+"\n").encode());print(stable(final))
 if status!="committed":raise SystemExit(1)
if __name__=="__main__":main()
