#!/usr/bin/env python3
"""Small, disposable PostgreSQL cluster. Never connects to production."""
import argparse, copy, hashlib, importlib.util, json, os, pwd, shutil, subprocess, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument("--repository",type=Path,default=ROOT.parents[1])
parser.add_argument("--output-root",type=Path,required=True)
parser.add_argument("--derive-catalog",action="store_true")
parser.add_argument("--long-suffix",action="store_true")
args=parser.parse_args()
OUT=args.output_root
if os.geteuid()!=0 or OUT.exists() or not OUT.is_absolute() or OUT.resolve()!=OUT: raise RuntimeError("Fresh VPS private output root and root execution required")
OUT.mkdir(mode=0o700)
spec=importlib.util.spec_from_file_location("publisher",ROOT/"publish-replay.py")
pub=importlib.util.module_from_spec(spec);spec.loader.exec_module(pub)
PG=Path("/usr/lib/postgresql/16/bin"); uid=pwd.getpwnam("postgres").pw_uid;gid=pwd.getpwnam("postgres").pw_gid
cluster=Path(tempfile.mkdtemp(prefix="proofofwork-batch-native-fixture-",dir="/tmp"))
os.chown(cluster,uid,gid);os.chmod(cluster,0o700)
socket=cluster/"socket";socket.mkdir();os.chown(socket,uid,gid)
tablespace=cluster/"tablespace";tablespace.mkdir();os.chown(tablespace,uid,gid)
data=cluster/"data"; port=56439
def run(args,**kw):
 return subprocess.run(["runuser","-u","postgres","--",*map(str,args)],text=True,capture_output=True,**kw)
def sql(text, ok=True):
 r=run([PG/"psql","-X","-q","-A","-t","-h",socket,"-p",port,"-d","postgres","-v","ON_ERROR_STOP=1"],input="SET TIME ZONE 'UTC';\n"+text,timeout=120)
 if ok and r.returncode: raise RuntimeError(r.stderr[-4000:])
 if not ok and not r.returncode: raise AssertionError("Expected SQL rejection")
 return r.stdout
def rows(text): return [json.loads(x) for x in sql(text).splitlines() if x.strip()]
def val(text): return rows(text)[-1]
def lit(x): return pub.literal(pub.stable(x))+"::jsonb"
passed=[]
def check(name,fn): fn();passed.append(name);print("PASS "+name,flush=True)
baseline=json.loads((ROOT/"catalog-baseline.json").read_text())
archive=next(x for x in baseline["relations"] if x["name"]=="work_transition_archive_v1")
old_sha,old_query=pub.helper_contract((ROOT/"native-transition-storage-before.mjs").read_bytes())
runtime_helper=ROOT/"native-transition-storage.mjs" if (ROOT/"native-transition-storage.mjs").exists() else args.repository/"server/db/native-transition-storage.mjs"
expected_new_sha,new_query=pub.helper_contract(runtime_helper.read_bytes())
extension=(ROOT/"storage-extension.sql").read_text()
def catalog(query): return val("SET search_path=pg_catalog,pg_temp;"+query+";")
def snapshot():
 return val("""SELECT jsonb_build_object('main',(SELECT jsonb_agg(to_jsonb(t) ORDER BY block_height) FROM proof_indexer.work_amo_block_transitions t),
 'archive',(SELECT jsonb_agg(to_jsonb(t) ORDER BY block_height) FROM proof_indexer.work_transition_archive_v1 t),
 'chunks',(SELECT jsonb_agg(encode(hash,'hex') ORDER BY hash) FROM proof_indexer.work_transition_chunks_v1),
 'hot',(SELECT jsonb_agg(jsonb_build_array(network,slot,block_height,block_hash,payload_sha256) ORDER BY slot) FROM proof_indexer.work_transition_hot_slots_v1),
 'meta',(SELECT jsonb_agg(to_jsonb(t) ORDER BY key) FROM proof_indexer.meta t),
 'epoch',(SELECT n FROM proof_indexer.fixture_epoch),
 'supersessionExists',to_regclass('proof_indexer.work_batch_transition_supersessions_v1') IS NOT NULL);""")
started=False
try:
 r=run([PG/"initdb","-D",data,"-A","trust","--no-locale","--encoding=UTF8"],timeout=30)
 if r.returncode: raise RuntimeError("Fixture initdb failed")
 r=run([PG/"pg_ctl","-D",data,"-l",cluster/"postgres.log","-o",f"-F -h '' -k {socket} -p {port}","-w","start"],timeout=30)
 if r.returncode: raise RuntimeError("Fixture start failed")
 started=True
 cols=[]
 for name,typ,notnull,storage,compression,default in archive["columns"]:
  cols.append('"'+name+'" '+typ+(" NOT NULL" if notnull else "")+(" DEFAULT "+default if default else ""))
 bootstrap="""
 CREATE ROLE proof_indexer NOLOGIN;
 CREATE SCHEMA proof_indexer AUTHORIZATION proof_indexer;
 CREATE TABLESPACE proof_indexer_large_state_v1 LOCATION '__TABLESPACE__';
 CREATE TABLE proof_indexer.blocks(network text, height integer, block_hash text,canonical boolean,PRIMARY KEY(network,block_hash));
 CREATE TABLE proof_indexer.meta(key text PRIMARY KEY,value jsonb,updated_at timestamptz DEFAULT now());
 CREATE TABLE proof_indexer.transactions(network text,txid text,status text,block_height integer,block_hash text,block_index integer,PRIMARY KEY(network,txid));
 CREATE TABLE proof_indexer.events(network text,status text,block_height integer,event_id bigint,txid text,protocol text,payload jsonb);
 CREATE TABLE proof_indexer.op_returns(network text,txid text,protocol text,payload text);
 CREATE TABLE proof_indexer.ledger_snapshots(network text,snapshot_id text,indexed_through_block integer,payload jsonb);
 CREATE TABLE proof_indexer.fixture_epoch(n integer); INSERT INTO proof_indexer.fixture_epoch VALUES(0);
 CREATE TABLE proof_indexer.work_amo_block_transitions(__COLUMNS__,PRIMARY KEY(network,block_height),UNIQUE(network,block_hash));
 ALTER TABLE proof_indexer.work_amo_block_transitions OWNER TO proof_indexer;
 CREATE FUNCTION proof_indexer.reject_work_amo_block_transitions_update() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Immutable transition';END$$;
 CREATE TRIGGER work_amo_block_transitions_immutable BEFORE UPDATE ON proof_indexer.work_amo_block_transitions FOR EACH ROW EXECUTE FUNCTION proof_indexer.reject_work_amo_block_transitions_update();
 CREATE FUNCTION proof_indexer.enqueue_livenet_readiness_epoch() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE proof_indexer.fixture_epoch SET n=n+1;RETURN NULL;END$$;
 CREATE TRIGGER readiness_epoch_work_amo_block_transitions AFTER INSERT OR DELETE OR UPDATE OR TRUNCATE ON proof_indexer.work_amo_block_transitions FOR EACH STATEMENT EXECUTE FUNCTION proof_indexer.enqueue_livenet_readiness_epoch();
 ALTER TABLE proof_indexer.work_amo_block_transitions ENABLE ALWAYS TRIGGER readiness_epoch_work_amo_block_transitions;
 """
 bootstrap=bootstrap.replace("__TABLESPACE__",str(tablespace)).replace("__COLUMNS__",",".join(cols))
 sql(bootstrap)
 for name,kind,valid,definition in archive["constraints"]:
  if kind=="c": sql('ALTER TABLE proof_indexer.work_amo_block_transitions ADD CONSTRAINT "'+name+'" '+definition+";")
 fixture=(args.repository/"server/db/fixtures/native-runtime-storage-v2.sql").read_text()
 if pub.sha(fixture.encode())!="01a95d76c606dad1dc9c3f40b9ea6002f7e8ad408c984536b8eb90b8594f9c16": raise RuntimeError("Native fixture changed")
 sql(fixture)
 actual=catalog(old_query)
 check("fixture reproduces exact accepted native catalog",lambda: (None if actual==baseline else (_ for _ in ()).throw(AssertionError("Baseline catalog mismatch"))))
 q=json.loads((ROOT/"storage-case-fixture.json").read_text())
 bridge={"rows":copy.deepcopy(q["rows"])}
 if args.long_suffix:
  bridge["rows"]=[{**copy.deepcopy(q["rows"][0]),"height":height,"hash":hashlib.sha256(str(height).encode()).hexdigest()} for height in range(973104,973233)]
 end_height=bridge["rows"][-1]["height"]
 hashes=[q["anchor"]["hash"]]+[r["hash"] for r in bridge["rows"]]
 payloads=[]; originals=[]
 for idx,height in enumerate(range(973103,end_height+1)):
  scalar=copy.deepcopy(bridge["rows"][max(0,idx-1)]["unchangedScalarMetadata"])
  scalar.update(block_height=height,block_hash=hashes[idx],previous_block_hash=hashes[idx-1] if idx else "1"*64,created_at="2026-10-25T18:00:00.123456Z")
  payload={"model":"fixture-transition","height":height,"rawProtocolCandidateCount":0,"protocolRecordCount":0,
   "transitionChainCommitment":{"model":"canonical-work-amo-raw-transition-chain-sha256-v1","sha256":hashlib.sha256(str(idx).encode()).hexdigest(),"payloadBytes":1025},
   "closingSufficientState":{"padding":"a"*140000},"openingSufficientState":{"padding":"b"*10000},
   "closingTokenState":{"balances":{"fixture":"100"}},"replayRecords":[],"traces":[],
   "replayDescriptorCommitment":{"model":"canonical-work-amo-replay-descriptor-commitment-v1","sha256":"2"*64,"payloadBytes":999}}
  if height==973104:
   scalar.update(protocol_record_count=1,raw_protocol_candidate_count=1,event_count=1,transaction_count=1)
   witness={"model":"canonical-work-amo-raw-transition-chain-sha256-v1","sha256":"2"*64,"payloadBytes":1025}
   record={"derived":[],"rawCandidate":True,"outcome":{"kind":"token-listing-sealed","valid":True},"output":{"amount":"5"},"position":{"blockHeight":height,"blockTransactionIndex":1,"protocolVout":1,"recordOrdinal":0},"protocol":"pwt1","rawWitness":"pwt1:seal5:fixture","stateDelta":{"balance":"unchanged"},"transitionChainCommitmentAfter":witness,"transactionMinerFeeSats":"546","transactionProtocolRecordCount":1,"txid":"5"*64}
   payload.update(rawProtocolCandidateCount=1,protocolRecordCount=1,replayRecords=[record],traces=[
    {"kind":"protocol-record","position":record["position"],"txid":record["txid"],"stateDelta":record["stateDelta"],"transitionChainCommitmentAfter":witness},
    {"kind":"transaction-fee","txid":record["txid"],"minerFeeSats":"546","transitionChainCommitmentAfter":witness}])
   sql("INSERT INTO proof_indexer.transactions VALUES('livenet',repeat('5',64),'confirmed',"+str(height)+","+pub.literal(hashes[idx])+",1);INSERT INTO proof_indexer.events VALUES('livenet','confirmed',"+str(height)+",1,repeat('5',64),'pwt1','{"+'"kind":"token-listing-sealed"'+ "}'::jsonb);INSERT INTO proof_indexer.op_returns VALUES('livenet',repeat('5',64),'pwt1','pwt1:seal5:fixture');")
  payloads.append(payload)
  sql("INSERT INTO proof_indexer.blocks VALUES('livenet',"+str(height)+","+pub.literal(hashes[idx])+",true);"+
      "INSERT INTO proof_indexer.work_amo_block_transitions SELECT (jsonb_populate_record(NULL::proof_indexer.work_amo_block_transitions,"+lit({**scalar,"payload":payload})+")).*;")
 rebuild={"network":"livenet","indexedThroughBlock":end_height,"indexedThroughBlockHash":hashes[-1],"status":"active"}
 sql("INSERT INTO proof_indexer.meta VALUES('canonical:rebuild',"+lit(rebuild)+",now());INSERT INTO proof_indexer.ledger_snapshots VALUES('livenet','fixture-head',"+str(end_height)+","+lit({"indexedThroughBlockHash":hashes[-1]})+");")
 old_state=snapshot()
 newcat=val("BEGIN;SET LOCAL search_path=pg_catalog,pg_temp;"+extension+new_query+";ROLLBACK;")
 newhash=pub.sha(pub.stable(newcat).encode())
 if args.derive_catalog:
  (OUT/"catalog-after.json").write_text(json.dumps(newcat,indent=2)+"\n")
  (OUT/"contract-sha256.txt").write_text(newhash+"\n")
  print("DERIVED_CONTRACT "+newhash,flush=True)
  raise SystemExit(0)
 assert newhash==expected_new_sha, "Pinned replacement native contract"
 assert newcat==json.loads((ROOT/"catalog-after.json").read_text()), "Pinned replacement catalog map"
 m={"format":"work-batch-native-supersession-manifest-v1","qualificationSha256":"a"*64,"nativeBridgeSha256":"b"*64,
 "sourceCommit":"c"*40,"sourceTree":"d"*40,"databaseName":"postgres","databaseEndpoint":{"port":port,"unixSocketDirectories":str(socket),"serverAddress":None,"serverPort":None},"oldCatalog":baseline,"newCatalog":newcat,
 "runtimeFiles":dict.fromkeys(pub.TARGETS,"e"*64),"checkpoint":{"height":end_height,"hash":hashes[-1],"snapshotId":"fixture-head","rebuild":rebuild},
 "anchor":{**q["anchor"],"nativeSha256":old_state["main"][0]["payload"]["__powNativeStorage"]["sha256"]},"proposedMarker":copy.deepcopy(q["proposedMarker"]),"rows":[]}
 for idx,br in enumerate(bridge["rows"],1):
  row=copy.deepcopy(br);row["unchangedScalarMetadata"]={k:v for k,v in old_state["main"][idx].items() if k!="payload"}
  row["currentMainRowSha256"]=val("SELECT to_jsonb(encode(sha256(jsonb_send(to_jsonb(t))),'hex')) FROM proof_indexer.work_amo_block_transitions t WHERE block_height="+str(row["height"])+";")
  row["oldNativeSha256"]=old_state["main"][idx]["payload"]["__powNativeStorage"]["sha256"]
  row["replacementFields"].update({key:copy.deepcopy(payloads[idx][key]) for key in ("replayRecords","traces","replayDescriptorCommitment")})
  if row["replacementFields"]["replayRecords"]:
   for field in ("replayRecords","traces"):
    for item in row["replacementFields"][field]:item["transitionChainCommitmentAfter"]["sha256"]="7"*64
   row["replacementFields"]["replayDescriptorCommitment"]["sha256"]="8"*64
  row["allowedChangedFields"]=[key for key in pub.REPLACEMENT_FIELDS if payloads[idx].get(key)!=row["replacementFields"][key]]
  row["oldNativeBytes"]=val("SELECT octet_length(jsonb_send("+lit(payloads[idx])+"));")
  row["nativePayloadBytes"]=row["oldNativeBytes"];row["rawBlockBytes"]=1000
  row["relationalBindings"]=val("SELECT to_jsonb(bindings) FROM ("+pub.RELATIONAL_BINDINGS_SQL.replace("$1",str(row["height"])).replace("$2",pub.literal(row["hash"]))+") bindings;")
  replacement={**payloads[idx],**row["replacementFields"]}
  n=val("SELECT jsonb_build_object('sha256',encode(sha256(jsonb_send("+lit(replacement)+")),'hex'),'bytes',octet_length(jsonb_send("+lit(replacement)+")));")
  row["newNativeSha256"]=n["sha256"];row["newNativeBytes"]=n["bytes"];m["rows"].append(row)
 m["proposedMarker"]["activationBlock"]["hash"]=m["rows"][0]["hash"]
 m["proposedMarker"]["activationBlock"]["transitionChainCommitment"]=m["rows"][0]["replacementFields"]["transitionChainCommitment"]
 m["resourceUsage"]={"nativePayloadBytes":sum(r["oldNativeBytes"] for r in m["rows"]),"newNativePayloadBytes":sum(r["newNativeBytes"] for r in m["rows"]),"rawBlockBytes":sum(r["rawBlockBytes"] for r in m["rows"]),"ordinaryRecords":sum(r["unchangedScalarMetadata"]["protocol_record_count"] for r in m["rows"])}
 pub.validate_manifest(m,old_sha,newhash)
 def render(x): return pub.render_transaction(x,pub.sha(pub.stable(x).encode()),extension,old_query,new_query)
 if not args.long_suffix:
  sql(render(m).replace("COMMIT;\nSELECT result FROM replay_publication_result;","SELECT result FROM replay_publication_result;\nROLLBACK;"))
  assert snapshot()==old_state
  check("valid ordinary witness publication reaches postconditions before rollback",lambda:None)
 if args.long_suffix:
  result=val(render(m))
  assert len(result["blocks"])==129
  assert result["blocks"][0]["cacheMode"]=="cold" and all(x["cacheMode"]=="hot" for x in result["blocks"][1:])
  slots=val("SELECT jsonb_agg(block_height ORDER BY block_height) FROM proof_indexer.work_transition_hot_slots_v1 WHERE network='livenet';")
  assert slots==list(range(973105,973233))
  check("129-block publication retains exactly latest 128 verified hot slots",lambda:None)
  first=m["rows"][0]
  for pointer,expected in ((old_state["main"][1]["payload"],payloads[1]),(val("SELECT payload FROM proof_indexer.work_amo_block_transitions WHERE block_height=973104;"),{**payloads[1],**first["replacementFields"]})):
   assert val("SELECT proof_indexer.read_work_transition_payload_v1('livenet',973104,"+pub.literal(first["hash"])+","+lit(pointer)+");")==expected
  check("oldest ordinary-event block reconstructs both exact digests without any hot slot",lambda:None)
  after=snapshot();assert after["archive"]==old_state["archive"] and set(old_state["chunks"])<=set(after["chunks"])
  check("129-block publication preserves every original archive and chunk",lambda:None)
  receipt={"format":"isolated-native-supersession-long-fixture-v2","passed":len(passed),"tests":passed,"blocks":129,"baselineContractSha256":old_sha,"replacementContractSha256":newhash,"productionConnectionUsed":False}
  (OUT/"fixture-result.json").write_text(json.dumps(receipt,indent=2)+"\n")
  print(json.dumps(receipt),flush=True);raise SystemExit(0)
 def refused(name,mutator,extra=None):
  bad=copy.deepcopy(m);mutator(bad)
  text=render(bad)
  if extra: text=text.replace("COMMIT;\nSELECT result",extra+"\nCOMMIT;\nSELECT result")
  sql(text,ok=False)
  assert snapshot()==old_state,name
  assert catalog(old_query)==baseline,name
  passed.append(name);print("PASS "+name,flush=True)
 refused("wrong old catalog aborts DDL and data",lambda x:x["oldCatalog"]["role"].update(canLogin=True))
 refused("wrong new catalog aborts DDL and data",lambda x:x["newCatalog"]["role"].update(canLogin=True))
 refused("checkpoint drift aborts atomically",lambda x:x["checkpoint"]["rebuild"].update(indexedThroughBlock=1))
 refused("tip height drift aborts atomically",lambda x:x["checkpoint"].update(height=973106))
 refused("tip hash drift aborts atomically",lambda x:x["checkpoint"].update(hash="f"*64))
 refused("anchor native digest drift aborts atomically",lambda x:x["anchor"].update(nativeSha256="f"*64))
 refused("old scalar change aborts atomically",lambda x:x["rows"][0]["unchangedScalarMetadata"].update(event_count=2))
 refused("complete current main row drift aborts atomically",lambda x:x["rows"][0].update(currentMainRowSha256="f"*64))
 refused("old native digest change aborts atomically",lambda x:x["rows"][0].update(oldNativeSha256="f"*64))
 refused("second block native mismatch rolls back first replacement and chunks",lambda x:x["rows"][1].update(newNativeSha256="f"*64))
 refused("new payload byte mismatch aborts atomically",lambda x:x["rows"][0].update(newNativeBytes=1))
 refused("unqualified extra payload field aborts native bridge",lambda x:x["rows"][0]["replacementFields"].update(freeBalance="100"))
 def refused_witness(name,mutator):
  def update(x):
   mutator(x["rows"][0]["replacementFields"])
   row=x["rows"][0];payload={**payloads[1],**row["replacementFields"]}
   native=val("SELECT jsonb_build_object('sha256',encode(sha256(jsonb_send("+lit(payload)+")),'hex'),'bytes',octet_length(jsonb_send("+lit(payload)+")));")
   x["resourceUsage"]["newNativePayloadBytes"]+=native["bytes"]-row["newNativeBytes"]
   row["newNativeSha256"]=native["sha256"];row["newNativeBytes"]=native["bytes"]
  refused(name,update)
 for label,mutation in [
  ("ordinary output",lambda f:f["replayRecords"][0]["output"].update(amount="6")),
  ("raw witness",lambda f:f["replayRecords"][0].update(rawWitness="pwt1:batch1:forged")),
  ("state delta",lambda f:f["replayRecords"][0]["stateDelta"].update(balance="created")),
  ("position",lambda f:f["replayRecords"][0]["position"].update(protocolVout=2)),
  ("miner fee",lambda f:f["replayRecords"][0].update(transactionMinerFeeSats="0")),
  ("validity",lambda f:f["replayRecords"][0]["outcome"].update(valid=False)),
  ("derived child",lambda f:f["replayRecords"][0].update(derived=[{"kind":"token-transfer"}])),
  ("raw candidate",lambda f:f["replayRecords"][0].update(rawCandidate=False)),
  ("chain witness model",lambda f:f["replayRecords"][0]["transitionChainCommitmentAfter"].update(model="other")),
  ("chain witness bytes",lambda f:f["replayRecords"][0]["transitionChainCommitmentAfter"].update(payloadBytes=999)),
  ("missing chain witness",lambda f:f["replayRecords"][0].pop("transitionChainCommitmentAfter")),
  ("trace amount",lambda f:f["traces"][1].update(minerFeeSats="0")),
  ("trace order",lambda f:f["traces"].reverse()),
  ("descriptor metadata",lambda f:f["replayDescriptorCommitment"].update(payloadBytes=1)),
  ("top chain metadata",lambda f:f["transitionChainCommitment"].update(payloadBytes=1)),
 ]:refused_witness(label+" change with matching new native hash still aborts",mutation)
 refused("relational row digest mismatch refuses",lambda x:x["rows"][0]["relationalBindings"].update(eventRowsSha256="f"*64))
 for label,mutation in [
  ("event row content", "UPDATE proof_indexer.events SET payload=payload||'{"+'"changed":true'+ "}'::jsonb WHERE event_id=1"),
  ("record row content", "UPDATE proof_indexer.op_returns SET payload='pwt1:seal5:changed'"),
 ]:
  text=render(m).replace("DO $qualification$",mutation+";\nDO $qualification$",1)
  sql(text,ok=False);assert snapshot()==old_state and catalog(old_query)==baseline
  check(label+" drift under lock aborts without rewriting original history",lambda:None)
 refused("marker chain mismatch rolls back complete suffix",lambda x:x["proposedMarker"]["activationBlock"]["transitionChainCommitment"].update(sha256="f"*64))
 refused("late failure rolls back schema marker rows and chunks",lambda x:None,"DO $$ BEGIN RAISE EXCEPTION 'after publication';END $$;")
 sql("INSERT INTO proof_indexer.events VALUES('livenet','confirmed',973104,2,repeat('5',64),'pwt1','{}'::jsonb);")
 bad_state=snapshot()
 sql(render(m),ok=False)
 assert snapshot()==bad_state
 sql("DELETE FROM proof_indexer.events WHERE event_id=2;")
 check("unexpected governed event refuses without changing storage",lambda:None)
 # Exercise the actual staged transport: source drift after SQL preparation must
 # abort schema/data before COMMIT, not merely be detected after publication.
 argv=["runuser","-u","postgres","--",str(PG/"psql"),"-X","-q","-A","-t","-h",str(socket),"-p",str(port),"-d","postgres","-v","ON_ERROR_STOP=1"]
 fence_path=OUT/"fixture-precommit-source.txt";fence_path.write_text("pinned")
 fence_pin=pub.sha(fence_path.read_bytes())
 def changed_source():
  fence_path.write_text("drift")
  pub.private_read(str(fence_path),fence_pin)
 rejected=pub.execute_staged(render(m),argv,changed_source)
 assert rejected["commitSent"] is False and rejected["fenceError"]=="ValueError"
 assert snapshot()==old_state and catalog(old_query)==baseline
 check("actual staged transport aborts source drift before COMMIT including DDL",lambda:None)
 def reorg_fence():pub.verify_core_prefix(m,lambda method,params:"f"*64)
 reorg=pub.execute_staged(render(m),argv,reorg_fence)
 assert reorg["commitSent"] is False and reorg["fenceError"]=="ValueError" and snapshot()==old_state
 check("Core prefix reorg immediately before COMMIT rolls back all schema and data",lambda:None)
 pub.verify_core_prefix(m,lambda method,params:m["anchor"]["hash"] if params==[973103] else m["checkpoint"]["hash"])
 check("unchanged fixed Core prefix remains valid despite later tip growth",lambda:None)
 assert pub.database_endpoint_args(m)==["-h",str(socket),"-p",str(port)]
 wrong_endpoint=copy.deepcopy(m);wrong_endpoint["databaseEndpoint"]["serverPort"]=port+1
 try:pub.database_endpoint_args(wrong_endpoint);raise AssertionError("Wrong endpoint accepted")
 except ValueError:pass
 check("publisher routes only to exact captured local PostgreSQL endpoint",lambda:None)

 combined={**m,"qualified":True,"mode":"after-drain","sourceState":"committed","format":"work-batch-bounded-reseal-qualification-v3","ordinaryRelationalSuffixVerified":True,"fullRawSuffixVerified":True,"noDerivedEventsVerified":True,"noBatchLookingRecordsVerified":True,"declaration":q["declaration"],"nativeCatalogSha256":old_sha,"earliestSelection":{"verified":True},"sourceManifestSha256":"f"*64,
  "databaseName":"postgres","runtimeSources":m["runtimeFiles"],"canonicalRebuild":rebuild,
  "checkpoint":{k:v for k,v in m["checkpoint"].items() if k!="rebuild"},"blocks":copy.deepcopy(m["rows"])}
 for row in combined["blocks"]:
  row.update(baselineExactlyReproduced=True,compatibilityDeterministic=True,economicStateEqual=True,workGenericIdStateEqual=True,projectionEqual=True,eventsAndFeesEqual=True,rawProtocolCandidateCount=row["unchangedScalarMetadata"]["raw_protocol_candidate_count"],protocolRecordCount=row["unchangedScalarMetadata"]["protocol_record_count"],batchLookingCount=0,ordinaryEventSetVerified=True,ordinaryRecordsVerified=True,noDerivedEventsVerified=True)
 pre=OUT/"fixture-combined-preflight.json";pre.write_text(pub.stable(combined))
 prepared=pub.prepare_manifest(combined,str(pre),pub.sha(pre.read_bytes()),baseline,newcat)
 pub.validate_manifest(prepared,old_sha,newhash);pub.verify_evidence(prepared,verify_runtime=False)
 check("combined preflight prepares exact source checkpoint native manifest",lambda:None)
 changed=copy.deepcopy(prepared);changed["runtimeFiles"]["server/proof-api.mjs"]="a"*64
 try:pub.verify_evidence(changed,verify_runtime=False);raise AssertionError("Changed source plan accepted")
 except ValueError:pass
 check("preflight/source plan mismatch rejects before SQL",lambda:None)
 for label,mutator in [
  ("before-drain receipt",lambda x:x.update(mode="before-drain")),
  ("uncommitted source",lambda x:x.update(sourceState="scratch")),
  ("missing relational proof",lambda x:x.pop("ordinaryRelationalSuffixVerified")),
  ("unverified signature",lambda x:x["declaration"].update(signatureVerified=False)),
  ("wrong declaration output",lambda x:x["declaration"].update(registryPaymentVout=1)),
  ("missing ordinary event proof",lambda x:x["blocks"][0].pop("ordinaryEventSetVerified")),
 ]:
  bad=copy.deepcopy(combined);mutator(bad);pre.write_text(pub.stable(bad))
  bad_manifest=pub.prepare_manifest(bad,str(pre),pub.sha(pre.read_bytes()),baseline,newcat)
  try:pub.verify_evidence(bad_manifest,verify_runtime=False);raise AssertionError("Unqualified publication accepted")
  except ValueError:pass
  check(label+" refuses independently at publisher",lambda:None)
 pre.write_text(pub.stable(combined))

 for label,mutation in [
  ("over512 blocks",lambda x:x.update(rows=x["rows"]*257)),
  ("over128MiB native",lambda x:x["rows"][0].update(newNativeBytes=pub.MAX_NATIVE_BYTES+1)),
  ("over1024 records",lambda x:x["rows"][0]["unchangedScalarMetadata"].update(protocol_record_count=1025)),
  ("resource receipt mismatch",lambda x:x["resourceUsage"].update(rawBlockBytes=1)),
  ("extra replacement field",lambda x:x["rows"][0]["replacementFields"].update(freeBalance="1")),
 ]:
  bad=copy.deepcopy(m);mutation(bad)
  try:pub.validate_manifest(bad,old_sha,newhash);raise AssertionError("Resource/scope violation accepted")
  except ValueError:pass
  check(label+" refuses before SQL",lambda:None)
 def bounded_rows(count,native_bytes):
  candidate=copy.deepcopy(m);candidate["rows"]=[]
  for index in range(count):
   row=copy.deepcopy(m["rows"][1]);row["height"]=973104+index;row["hash"]=hashlib.sha256(str(index).encode()).hexdigest()
   row["oldNativeBytes"]=native_bytes;row["nativePayloadBytes"]=native_bytes;row["newNativeBytes"]=native_bytes
   candidate["rows"].append(row)
  candidate["checkpoint"].update(height=973103+count,hash=candidate["rows"][-1]["hash"])
  candidate["resourceUsage"]={"nativePayloadBytes":count*native_bytes,"newNativePayloadBytes":count*native_bytes,"rawBlockBytes":count*1000,"ordinaryRecords":0}
  return candidate
 boundary=bounded_rows(64,pub.MAX_NATIVE_BYTES);pub.validate_manifest(boundary,old_sha,newhash)
 check("exact 8GiB cumulative native admission ceiling is inclusive without payload allocation",lambda:None)
 for key in ("oldNativeBytes","newNativeBytes"):
  bad=bounded_rows(65,pub.MAX_NATIVE_BYTES)
  if key=="oldNativeBytes":
   for row in bad["rows"]:row["newNativeBytes"]=1000
   bad["resourceUsage"]["newNativePayloadBytes"]=65000
  else:
   for row in bad["rows"]:row["oldNativeBytes"]=row["nativePayloadBytes"]=1000
   bad["resourceUsage"]["nativePayloadBytes"]=65000
  try:pub.validate_manifest(bad,old_sha,newhash);raise AssertionError("Cumulative native bound accepted")
  except ValueError:pass
  check(key+" independently enforces cumulative 8GiB limit",lambda:None)
 fence_calls=[]
 accepted=pub.execute_staged(render(m),argv,lambda:fence_calls.append(True))
 assert accepted["returncode"]==0 and accepted["commitSent"] and fence_calls==[True]
 result=json.loads([x for x in accepted["stdout"].splitlines() if x.strip()][-1]);new_state=snapshot()
 assert result["originalArchivesRetained"] and result["oldChunksRetained"]
 check("qualified ordinary-event and empty block publication commits",lambda:None)
 assert [{k:v for k,v in r.items() if k!="payload"} for r in new_state["main"]]==[{k:v for k,v in r.items() if k!="payload"} for r in old_state["main"]]
 check("all original scalars including exact created_at are preserved",lambda:None)
 assert new_state["archive"]==old_state["archive"]
 assert set(old_state["chunks"])<=set(new_state["chunks"])
 check("original archive rows and every old content chunk remain unchanged",lambda:None)
 assert new_state["epoch"]==old_state["epoch"]+4
 check("ordinary readiness epoch trigger fires for every delete and insert",lambda:None)
 versions=val("SELECT jsonb_agg(to_jsonb(s) ORDER BY block_height) FROM proof_indexer.work_batch_transition_supersessions_v1 s;")
 assert [v["old_main"] for v in versions]==old_state["main"][1:]
 check("immutable supersession preserves exact old main metadata",lambda:None)
 for idx,row in enumerate(m["rows"],1):
  historical=val("SELECT proof_indexer.read_work_transition_payload_v1('livenet',"+str(row["height"])+","+pub.literal(row["hash"])+","+lit(old_state["main"][idx]["payload"])+");")
  assert historical==payloads[idx]
  current=val("SELECT proof_indexer.read_work_transition_payload_v1(network,block_height,block_hash,payload) FROM proof_indexer.work_amo_block_transitions WHERE block_height="+str(row["height"])+";")
  assert current=={**payloads[idx],**row["replacementFields"]}
 check("both exact original digest and newly selected digest reconstruct",lambda:None)
 for query in [
  "DELETE FROM proof_indexer.work_batch_transition_supersessions_v1;",
  "UPDATE proof_indexer.work_batch_transition_supersessions_v1 SET source_commit=repeat('f',40);",
  "DELETE FROM proof_indexer.work_transition_archive_v1;",
  "DELETE FROM proof_indexer.work_transition_chunks_v1;",
  "UPDATE proof_indexer.work_transition_hot_slots_v1 SET payload_sha256=repeat('f',64) WHERE block_height=973104;",
  "SET ROLE proof_indexer;INSERT INTO proof_indexer.work_batch_transition_supersessions_v1 SELECT * FROM proof_indexer.work_batch_transition_supersessions_v1;",
 ]: sql(query,ok=False)
 check("immutable old/new evidence and app-role privileges remain enforced",lambda:None)
 # CHECK constraints must reject missing JSON fields rather than accept NULL.
 for removed in ("payload","network","block_height","block_hash"):
  broken=copy.deepcopy(versions[0]);broken["old_main"].pop(removed)
  broken["new_metadata"]={k:v for k,v in broken["old_main"].items() if k not in ("payload","created_at")}
  sql("DO $$ BEGIN INSERT INTO proof_indexer.work_batch_transition_supersessions_v1 SELECT (jsonb_populate_record(NULL::proof_indexer.work_batch_transition_supersessions_v1,"+lit(broken)+")).*;RAISE EXCEPTION 'missing field accepted';EXCEPTION WHEN check_violation THEN NULL;END $$;")
 for removed in ("sha256","model"):
  broken=copy.deepcopy(versions[0]);broken["old_main"]["payload"]["__powNativeStorage"].pop(removed)
  sql("DO $$ BEGIN INSERT INTO proof_indexer.work_batch_transition_supersessions_v1 SELECT (jsonb_populate_record(NULL::proof_indexer.work_batch_transition_supersessions_v1,"+lit(broken)+")).*;RAISE EXCEPTION 'missing pointer accepted';EXCEPTION WHEN check_violation THEN NULL;END $$;")
 check("required old-row and native-pointer fields reject SQL NULL",lambda:None)
 # Evict replacement hot slots through ordinary, fully verified future inserts.
 for idx,row in enumerate(m["rows"],1):
  height=row["height"]+128;hash_value=("8" if idx==1 else "9")*64
  scalar=copy.deepcopy(row["unchangedScalarMetadata"]);scalar.update(block_height=height,block_hash=hash_value)
  future={"model":"fixture-future-transition","height":height,"closingSufficientState":{"future":True}}
  sql("INSERT INTO proof_indexer.blocks VALUES('livenet',"+str(height)+","+pub.literal(hash_value)+",true);INSERT INTO proof_indexer.work_amo_block_transitions SELECT (jsonb_populate_record(NULL::proof_indexer.work_amo_block_transitions,"+lit({**scalar,"payload":future})+")).*;")
  hot=val("SELECT to_jsonb(h) - 'payload' FROM proof_indexer.work_transition_hot_slots_v1 h WHERE network='livenet' AND slot=mod("+str(row["height"])+",128);")
  assert hot["block_height"]==height and hot["payload_sha256"]!=row["newNativeSha256"]
  for pointer,expected in ((old_state["main"][idx]["payload"],payloads[idx]),(new_state["main"][idx]["payload"],{**payloads[idx],**row["replacementFields"]})):
   full=val("SELECT proof_indexer.read_work_transition_payload_v1('livenet',"+str(row["height"])+","+pub.literal(row["hash"])+","+lit(pointer)+");")
   assert full==expected
 check("cache-miss reconstruction verifies both original and replacement digests",lambda:None)
 restored=val((ROOT/"verify-supersessions.sql").read_text())
 assert restored["rowCount"]==2 and restored["allOriginalAndReplacementFramesVerified"] is True
 assert all(r["original_verified"] and r["replacement_verified"] and r["currently_selected"] and r["current_metadata_verified"] for r in restored["rows"])
 check("successor restore readcheck verifies both immutable versions and current metadata",lambda:None)

 after=catalog(new_query)
 assert after==newcat
 oldfunc={x["name"]:x for x in baseline["functions"]};newfunc={x["name"]:x for x in after["functions"]}
 assert {n for n in oldfunc if oldfunc[n]!=newfunc[n]}=={"encode_native_work_transition_v1","read_work_transition_payload_v1","verify_work_transition_hot_slot_v1"}
 for rel in baseline["relations"]: assert rel==next(x for x in after["relations"] if x["name"]==rel["name"])
 assert baseline["canonicalEncodingTrigger"]==after["canonicalEncodingTrigger"] and baseline["role"]==after["role"]
 check("all original relation trigger grant definitions unchanged; only three reviewed functions change",lambda:None)
 p=OUT/"fixture-pin.txt";p.write_text("original");pin=pub.sha(p.read_bytes());assert pub.private_read(str(p),pin)==b"original";p.write_text("drift")
 try:pub.private_read(str(p),pin);raise AssertionError("Source drift accepted")
 except ValueError:pass
 check("source input digest drift fails before SQL dispatch",lambda:None)
 receipt={"format":"isolated-native-supersession-fixture-v1","passed":len(passed),"tests":passed,"baselineContractSha256":old_sha,"replacementContractSha256":newhash,"productionConnectionUsed":False,"fixturesOnly":True}
 (OUT/"fixture-result.json").write_text(json.dumps(receipt,indent=2)+"\n")
 print(json.dumps(receipt),flush=True)
finally:
 if started:
  r=run([PG/"pg_ctl","-D",data,"-m","fast","-w","stop"],timeout=30)
  if r.returncode: raise RuntimeError("Fixture shutdown failed; scratch retained")
 if cluster.exists() and cluster.name.startswith("proofofwork-batch-native-fixture-") and cluster.stat().st_uid==uid:
  shutil.rmtree(cluster)
