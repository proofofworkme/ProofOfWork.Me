import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Duplex } from "node:stream";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import pg from "pg";
import { assertNativeTransitionStorageContract, nativeTransitionStorageContractSql } from "../../server/db/native-transition-storage.mjs";
import { nativeFunctionDefinitions, oldCatalogDigest, sha256, stableJson, supersessions } from "./storage.mjs";
import { declarationEvidence, scenario } from "./fixtures/replay.mjs";
import { permissionSupersession } from "../../server/db/permission-supersession.mjs";
import { expandedLiquidityReadiness } from "../../server/work-amo-expanded-liquidity.mjs";
import { publishExpandedLiquidityReplay } from "./publish.mjs";
import { checkRawQualification, publicationPeerClient } from "./publish-cli.mjs";
import { readDatabaseIdentity, readIndexTip, readPeerDatabaseIdentity, replayEvidence, runReadOnlyQualification, verifyOriginalRange } from "./preflight.mjs";

const run = promisify(execFile);
const socket = ["--host", "unix:///var/run/docker.sock"];
const image = "postgres:16-bookworm";
const source = path => readFile(new URL(path, import.meta.url), "utf8");
const docker = (...args) => run("docker", [...socket, ...args], { timeout: 30000 });

// PostgreSQL's binary wire stream crosses docker exec to the container's Unix
// socket. The fixture accepts no database URL, host port or host data volume.
function fixtureClient(id, readOnly = false) {
  if (!readOnly) return publicationPeerClient("postgres",5432,(program,port) =>
    spawn("docker",[...socket,"exec","-i",id,"perl","-e",program,String(port)],{stdio:["pipe","pipe","inherit"]}));
  const relay = `use IO::Socket::UNIX;
    my $s = IO::Socket::UNIX->new(Peer => '/var/run/postgresql/.s.PGSQL.5432') or die $!;
    my $child = fork(); die $! unless defined $child;
    my ($input, $output) = $child ? (*STDIN, $s) : ($s, *STDOUT);
    while (my $size = sysread($input, my $bytes, 65536)) {
      my $offset = 0;
      while ($offset < $size) {
        my $sent = syswrite($output, $bytes, $size - $offset, $offset);
        die $! unless $sent; $offset += $sent;
      }
    }
    if ($child) { shutdown($s, 1); waitpid($child, 0); }`;
  const child = spawn("docker", [...socket, "exec", "-i", id, "perl", "-e", relay], { stdio: ["pipe", "pipe", "inherit"] });
  const stream = Duplex.from({ writable: child.stdin, readable: child.stdout });
  stream.setNoDelay = () => {};
  stream.connect = () => queueMicrotask(() => stream.emit("connect"));
  return new pg.Client({ stream, host: "/var/run/postgresql", user: "fixture_api",
    database: "postgres", ssl: false, connectionTimeoutMillis: 10000,
    options: "-c default_transaction_read_only=on -c timezone=UTC" });
}

async function disposablePostgres(t) {
  const { stdout } = await docker("run", "--detach", "--rm", "--pull=never",
    "--network=none", "--read-only", "--user=postgres", "--memory=384m", "--cpus=1", "--pids-limit=64",
    "--tmpfs", "/tmp:mode=1777,size=32m", "--tmpfs", "/var/run/postgresql:mode=1777,size=2m",
    "--tmpfs", "/var/lib/postgresql/data:mode=1777,size=200m",
    "-e", "PGDATA=/var/lib/postgresql/data/fixture", "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    image, "postgres", "-c", "listen_addresses=", "-c", "shared_buffers=16MB");
  const id = stdout.trim();
  assert.match(id, /^[0-9a-f]{64}$/);
  t.after(() => docker("stop", "--time=5", id));
  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    try {
      await docker("exec", id, "sh", "-ec", 'test "$(cat /proc/1/comm)" = postgres && pg_isready -q -h /var/run/postgresql');
      ready = true;
    } catch { await delay(150); }
  }
  assert.ok(ready, "isolated PostgreSQL 16 fixture started");
  await docker("exec", id, "mkdir", "-m", "700", "/tmp/amo-tablespace");
  return id;
}

async function installAcceptedStorage(client) {
  const { rows: [version] } = await client.query("SELECT current_setting('server_version_num')::int AS major");
  assert.equal(Math.trunc(version.major / 10000), 16);
  // The historical installation appended work_token_state_model to an existing
  // relation. Use its recorded physical column order and constraints.
  const baseline = JSON.parse(await source("../work-batch-replay/catalog-baseline.json"));
  const archive = baseline.relations.find(r => r.name === "work_transition_archive_v1");
  const columns = archive.columns.map(([name, type, required, , , initial]) =>
    `"${name}" ${type}${required ? " NOT NULL" : ""}${initial ? " DEFAULT " + initial : ""}`);
  await client.query("CREATE TABLESPACE proof_indexer_large_state_v1 LOCATION '/tmp/amo-tablespace'");
  await client.query(`
    CREATE ROLE proof_indexer NOLOGIN;
    CREATE ROLE fixture_api LOGIN IN ROLE proof_indexer;
    REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC;
    CREATE SCHEMA proof_indexer AUTHORIZATION proof_indexer;
    CREATE TABLE proof_indexer.work_amo_block_transitions (${columns.join(",")}, PRIMARY KEY(network,block_height), UNIQUE(network,block_hash));
    ALTER TABLE proof_indexer.work_amo_block_transitions OWNER TO proof_indexer;
    CREATE FUNCTION proof_indexer.reject_work_amo_block_transitions_update() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Immutable transition';END$$;
    CREATE TRIGGER work_amo_block_transitions_immutable BEFORE UPDATE ON proof_indexer.work_amo_block_transitions FOR EACH ROW EXECUTE FUNCTION proof_indexer.reject_work_amo_block_transitions_update();
    CREATE FUNCTION proof_indexer.enqueue_livenet_readiness_epoch() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL;END$$;
    CREATE TRIGGER readiness_epoch_work_amo_block_transitions AFTER INSERT OR DELETE OR UPDATE OR TRUNCATE ON proof_indexer.work_amo_block_transitions FOR EACH STATEMENT EXECUTE FUNCTION proof_indexer.enqueue_livenet_readiness_epoch();
    ALTER TABLE proof_indexer.work_amo_block_transitions ENABLE ALWAYS TRIGGER readiness_epoch_work_amo_block_transitions;`);
  for (const [name, kind, , definition] of archive.constraints) {
    if (kind === "c") await client.query(`ALTER TABLE proof_indexer.work_amo_block_transitions ADD CONSTRAINT "${name}" ${definition}`);
  }
  await client.query(await source("../../server/db/fixtures/native-runtime-storage-v2.sql"));
  await client.query(await source("../work-batch-replay/storage-extension.sql"));
}

const one = async (client, sql, params) => {
  const result = await client.query(sql, params);
  assert.equal(result.rows.length, 1);
  return result.rows[0];
};
const nativeRow = (client, h) => one(client, `SELECT t.*, t.block_height AS height,
  t.payload->'__powNativeStorage' AS storage_commitment, decoded.frame AS decoded,
  encode(sha256(jsonb_send(to_jsonb(t))), 'hex') AS current_main_row_sha256,
  encode(sha256(jsonb_send(decoded.frame)), 'hex') AS native_sha256, octet_length(jsonb_send(decoded.frame)) AS native_bytes
  FROM proof_indexer.work_amo_block_transitions t
  CROSS JOIN LATERAL (SELECT proof_indexer.read_work_transition_payload_v1(t.network,t.block_height,t.block_hash,t.payload) AS frame) decoded
  WHERE t.network='livenet' AND t.block_height=$1`, [h]);

// This compact historical control uses the recorded WORK Batch scalar metadata
// with small synthetic frames, both physically stored through native PG triggers.
async function seedHistoricalBatch(client) {
  const historical = JSON.parse(await source("../work-batch-replay/storage-case-fixture.json")).rows[1];
  const s = historical.oldScalarMetadata;
  const id = historical.replacementFields.workBatchV1.declaration.txid;
  const eventSetCommitment = { model:s.event_set_model, sha256:s.event_set_sha256,
    payloadBytes:s.event_set_payload_bytes, eventCount:s.event_count };
  const replayDescriptorCommitment = { model:"fixture", sha256:"c".repeat(64), payloadBytes:61 };
  const fields = { ...historical.replacementFields, replayRecords:[], traces:[], replayDescriptorCommitment, eventSetCommitment };
  const original = { replayRecords:[], traces:[], replayDescriptorCommitment, eventSetCommitment,
    transitionChainCommitment:{...fields.transitionChainCommitment,sha256:"a".repeat(64)} };
  const insert = payload => client.query(`INSERT INTO proof_indexer.work_amo_block_transitions
    SELECT (jsonb_populate_record(NULL::proof_indexer.work_amo_block_transitions,$1::jsonb)).*`, [JSON.stringify({...s,payload})]);
  await client.query("INSERT INTO proof_indexer.blocks(network,height,block_hash) VALUES ('livenet',$1,$2)", [s.block_height,s.block_hash]);
  await insert(original);
  const old = await nativeRow(client,s.block_height);
  const corrected = {...original,...fields};
  await client.query(`WITH raw AS (SELECT jsonb_send($1::jsonb) AS b),
    chunk AS (INSERT INTO proof_indexer.work_transition_chunks_v1(hash,data) SELECT sha256(b),b FROM raw ON CONFLICT DO NOTHING)
    INSERT INTO proof_indexer.work_batch_transition_supersessions_v1
      (network,block_height,block_hash,incident_txid,qualification_sha256,manifest_sha256,source_commit,source_tree,
       through_height,through_hash,old_main,old_archive_sha256,new_metadata,new_manifest,replacement_fields,relational_bindings)
    SELECT t.network,t.block_height,t.block_hash,$2,repeat('d',64),repeat('f',64),repeat('a',40),repeat('b',40),t.block_height,
      t.block_hash,to_jsonb(t),t.payload#>>'{__powNativeStorage,sha256}',to_jsonb(t)-ARRAY['payload','created_at'],
      jsonb_build_object('model','audit31-native-jsonb-chunks-v1','bytes',octet_length(b),'sha256',encode(sha256(b),'hex'),
        'parts',jsonb_build_array(encode(sha256(b),'hex'))),$3::jsonb,
      jsonb_build_object('eventCount',0,'recordCount',0,'eventRowsSha256',encode(sha256(jsonb_send('[]'::jsonb)),'hex'),
        'recordRowsSha256',encode(sha256(jsonb_send('[]'::jsonb)),'hex'))
    FROM proof_indexer.work_amo_block_transitions t CROSS JOIN raw WHERE t.network='livenet' AND t.block_height=$4`,
    [JSON.stringify(corrected),id,JSON.stringify(fields),s.block_height]);
  await client.query("DELETE FROM proof_indexer.work_amo_block_transitions WHERE network='livenet' AND block_height=$1", [s.block_height]);
  await insert(corrected);
  return { old, current:await nativeRow(client,s.block_height) };
}

async function seedTransitions(client, id) {
  const fixture = scenario();
  // Use the exact production table shapes queried by the publisher, including
  // projection foreign keys. Preserve the previously installed physical archive.
  const schema = await source("../../server/sql/proof-indexer-v1.sql");
  for (const table of ["meta","blocks","transactions","tx_outputs","op_returns","events","ledger_snapshots"]) {
    const start = schema.indexOf("CREATE TABLE IF NOT EXISTS proof_indexer." + table + " (");
    const end = schema.indexOf("\n);", start);
    assert.ok(start >= 0 && end > start);
    await client.query(schema.slice(start, end + 3));
    await client.query("GRANT SELECT ON proof_indexer." + table + " TO proof_indexer");
  }
  for (const [h, row] of fixture.rows) {
    await client.query("INSERT INTO proof_indexer.blocks(network,height,block_hash,previous_block_hash) VALUES ('livenet',$1,$2,$3)",
      [h,row.block_hash,row.previous_block_hash]);
    await client.query(`INSERT INTO proof_indexer.work_amo_block_transitions
      SELECT (jsonb_populate_record(NULL::proof_indexer.work_amo_block_transitions,$1::jsonb)).*`,
      [JSON.stringify({ ...row, payload:row.decoded, created_at:"2026-11-22T15:00:00.123456Z" })]);
  }
  const tip = fixture.options.tip;
  const { indexedPosition:pos, transaction, prevoutTransactionHex, canonicalBlock } = declarationEvidence;
  await client.query("INSERT INTO proof_indexer.transactions(network,txid,status,block_hash,block_height,block_index) VALUES ('livenet',$1,'confirmed',$2,$3,$4)",
    [pos.txid,pos.blockHash,pos.blockHeight,pos.blockIndex]);
  await client.query("INSERT INTO proof_indexer.meta(key,value) VALUES ('canonical:rebuild',$1::jsonb)",
    [JSON.stringify({ network:"livenet",status:"complete",active:false,complete:true,indexedThroughBlock:tip.height,indexedThroughBlockHash:tip.hash })]);
  assert.deepEqual(await readIndexTip(client), tip);
  const rpc = async (method, params) => {
    if (method === "getblockchaininfo") return {chain:"main",blocks:tip.height,bestblockhash:tip.hash,initialblockdownload:false};
    if (method === "getblockhash") return fixture.hashes.get(params[0]);
    if (method === "getblock") return params[1] === 0 ? fixture.blocks.get(params[0]) : canonicalBlock;
    assert.equal(method,"getrawtransaction");
    return {txid:params[0],hex:params[0] === pos.txid ? transaction.hex : prevoutTransactionHex,
      confirmations:1,blockhash:pos.blockHash};
  };
  const q = await runReadOnlyQualification({ client:fixtureClient(id,true), freshClient:fixtureClient(id,true),
    rpc, sources:fixture.options.sources, tip, readPeer:api => readPeerDatabaseIdentity(client,api) });
  return { q, fixture, rpc };
}

const snapshot = async client => one(client, `SELECT
  (SELECT encode(sha256(jsonb_send(jsonb_agg(to_jsonb(t) ORDER BY block_height))),'hex') FROM proof_indexer.work_amo_block_transitions t) AS main,
  (SELECT encode(sha256(jsonb_send(jsonb_agg(to_jsonb(a) ORDER BY block_height))),'hex') FROM proof_indexer.work_transition_archive_v1 a) AS archive,
  (SELECT array_agg(encode(sha256(data),'hex') ORDER BY hash) FROM proof_indexer.work_transition_chunks_v1) AS chunks,
  (SELECT encode(sha256(jsonb_send(jsonb_agg(to_jsonb(s) ORDER BY slot))),'hex') FROM proof_indexer.work_transition_hot_slots_v1 s) AS hot,
  (SELECT encode(sha256(jsonb_send(jsonb_agg(to_jsonb(s) ORDER BY block_height))),'hex') FROM proof_indexer.work_batch_transition_supersessions_v1 s) AS batch_receipts,
  to_regclass('proof_indexer.work_amo_expanded_liquidity_supersessions_v1')::text AS expanded_table`);

test("expanded AMO publication on disposable PostgreSQL 16", async t => {
  const id = await disposablePostgres(t);
  const client = fixtureClient(id);
  await client.connect();
  let reader;
  try {
    await installAcceptedStorage(client);
    await assertNativeTransitionStorageContract(client);
    const { q, fixture, rpc } = await seedTransitions(client,id);
    reader = fixtureClient(id,true);
    await reader.connect();
    await checkRawQualification(q,replayEvidence({client:reader,freshClient:reader,rpc}));
    await t.test("the restricted API role binds its own connection through the independent postgres peer", async () => {
      assert.equal((await one(reader,"SELECT current_user")).current_user,"fixture_api");
      await assert.rejects(reader.query("SELECT * FROM pg_control_system()"),/permission denied/);
      assert.deepEqual(await readDatabaseIdentity(reader,api => readPeerDatabaseIdentity(client,api)),q.databaseIdentity);
      await assert.rejects(readDatabaseIdentity(reader,async api => {
        const peer = await readPeerDatabaseIdentity(client,api);
        peer.apiBackend.startedUs = "1";
        return peer;
      }),/database-peer-backend-mismatch/);
    });
    const batch = await seedHistoricalBatch(client);
    const before = await snapshot(client);
    assert.equal(q.blocks.length, 2);
    const admission = async (overrides = {}) => {
      const frames = [];
      const result = await expandedLiquidityReadiness({ declaration:q.declaration, tipHeight:q.tip.height, tipHash:q.tip.hash,
        baseAdmissionReady:true, writesEnabled:true, readSchema:async () => true,
        readCanonicalHash:fixture.options.readCanonicalHash, readTip:async () => ({ height:q.tip.height,blockHash:q.tip.hash }),
        readTransition:async (height,hash) => {
          frames.push(height);
          return (await reader.query(`SELECT t.payload FROM proof_indexer.work_amo_block_transitions t
            JOIN proof_indexer.blocks b ON b.network=t.network AND b.height=t.block_height AND b.block_hash=t.block_hash AND b.canonical
            WHERE t.network='livenet' AND t.block_height=$1 AND t.block_hash=$2`, [height,hash])).rows[0];
        }, ...overrides });
      assert.deepEqual(frames,[q.blocks[0].height,q.tip.height]);
      return result;
    };
    const initiallyClosed = await admission();
    assert.equal(initiallyClosed.listingWritesEnabled,false);
    assert.equal(initiallyClosed.reasonCode,"work-amo-expanded-liquidity-replay-unavailable");
    const publish = (mode, qualification = q, overrides = {}) => {
      const qualificationBytes = Buffer.from(JSON.stringify(qualification));
      return publishExpandedLiquidityReplay({ client, mode, qualificationBytes, qualificationSha256:sha256(qualificationBytes),
        readTip:fixture.options.readTip, readCanonicalHash:fixture.options.readCanonicalHash,
        verifySource:async binding => stableJson(binding) === stableJson(await fixture.options.sources.readBinding()), ...overrides });
    };
    const catalog = async () => (await client.query("SELECT " + nativeTransitionStorageContractSql() + " AS catalog")).rows[0].catalog;
    assert.equal(sha256(stableJson(await catalog())), oldCatalogDigest);
    await client.query("BEGIN");
    try {
      await client.query(await source("./extension.sql"));
      for (const definition of nativeFunctionDefinitions) await client.query(definition);
      const current = await catalog();
      t.diagnostic("PostgreSQL 16 successor catalog SHA-256 " + sha256(stableJson(current)));
      assert.ok(current.relations.some(relation => relation.name === supersessions.split(".")[1]),
        "runtime catalog covers expanded receipt ownership, ACL, columns, constraints and triggers");
    } finally { await client.query("ROLLBACK"); }
    assert.deepEqual(await snapshot(client), before);
    await t.test("wrong declaration, missing block, wrong database, or changed source cannot publish", async () => {
      for (const change of [c => { c.declaration.txid = "f".repeat(64); }, c => { c.blocks.splice(0,1); },
        c => { c.databaseIdentity.systemIdentifier = "1"; }, c => { c.sourceBinding.sourceTree = "e".repeat(40); }]) {
        const changed = structuredClone(q);
        change(changed);
        await assert.rejects(publish("publish", changed), /declaration or anchor|incomplete suffix|wrong database|source\/dependency/);
        assert.deepEqual(await snapshot(client), before);
      }
    });
    await t.test("rehearsal rolls back pointer exchange, new chunks, hot frames, receipts and DDL", async () => {
      const result = await publish("rehearse");
      assert.equal(result.committed, false);
      assert.equal(result.blocks, q.blocks.length);
      assert.deepEqual(await snapshot(client), before);
      assert.equal(sha256(stableJson(await catalog())), oldCatalogDigest);
    });
    await t.test("a conflicting second corrected frame rolls back the first frame and all DDL", async () => {
      const conflict = structuredClone(q);
      conflict.blocks[1].newNativeSha256 = "9".repeat(64);
      await assert.rejects(publish("publish", conflict), /corrected native transition differs at 977231/i);
      assert.deepEqual(await snapshot(client), before);
    });
    await t.test("reorg at the final Core fence restores the complete original state", async () => {
      let reads = 0;
      await assert.rejects(publish("publish", q, { readTip:async () => ++reads === 1 ? q.tip : {...q.tip,hash:"8".repeat(64)} }),
        /Core\/index tip differs/);
      assert.equal(reads, 2);
      assert.deepEqual(await snapshot(client), before);
    });
    await t.test("a conflicting canonical index tip closes preflight and publication", async () => {
      await client.query("UPDATE proof_indexer.blocks SET canonical=false WHERE block_hash=$1", [q.tip.hash]);
      try {
        await assert.rejects(readIndexTip(client),/expected one evidence row/);
        await assert.rejects(publish("publish"),/canonical checkpoint drift/);
      } finally { await client.query("UPDATE proof_indexer.blocks SET canonical=true WHERE block_hash=$1", [q.tip.hash]); }
      assert.deepEqual(await snapshot(client),before);
    });
    const original = new Map();
    for (const b of q.blocks) original.set(b.height, await nativeRow(client, b.height));
    const result = await publish("publish");
    assert.equal(result.alreadyPublished, false);
    assert.equal(result.committed, true);
    const after = await snapshot(client);
    t.diagnostic("Synthetic publication " + JSON.stringify({tip:q.tip,blocks:q.blocks.map(b => ({
      height:b.height,hash:b.hash,oldTransition:b.oldTransitionChainCommitment.sha256,newTransition:b.newTransitionChainCommitment.sha256,
      oldNative:b.oldNativeSha256,newNative:b.newNativeSha256
    }))}));
    await assertNativeTransitionStorageContract(client);
    assert.equal(after.archive, before.archive);
    assert.ok(before.chunks.every(hash => after.chunks.includes(hash)));
    assert.notEqual(after.main, before.main);
    assert.notEqual(after.hot, before.hot);
    assert.equal(after.expanded_table, supersessions);
    await t.test("native first and tip metadata open fresh List only with the matching tip, schema and switch", async () => {
      const ready = await admission();
      assert.equal(ready.replayReady,true);
      assert.equal(ready.listingWritesEnabled,true);
      for (const [change,reason] of [
        [{readTip:async () => ({height:q.tip.height,blockHash:q.anchor.hash})},"work-amo-expanded-liquidity-tip-changed"],
        [{readSchema:async () => false},"work-amo-expanded-liquidity-schema-unavailable"],
        [{writesEnabled:false},"work-amo-expanded-liquidity-writes-paused"],
      ]) {
        const closed = await admission(change);
        assert.equal(closed.listingWritesEnabled,false);
        assert.equal(closed.reasonCode,reason);
      }
    });
    await t.test("the populated historical WORK Batch receipt still proves both native frames", async () => {
      assert.match(before.batch_receipts, /^[a-f0-9]{64}$/);
      assert.equal(after.batch_receipts, before.batch_receipts);
      const row = await nativeRow(client,batch.old.height);
      assert.deepEqual(row,batch.current);
      const proof = await permissionSupersession(reader,"livenet",batch.old,row);
      assert.equal(proof.replacement_sha256,batch.current.native_sha256);
      assert.equal(proof.old_archive_sha256,batch.old.native_sha256);
      const {old} = await one(client,"SELECT proof_indexer.read_work_transition_payload_v1('livenet',$1,$2,$3::jsonb) AS old",
        [row.height,row.block_hash,JSON.stringify(batch.old.payload)]);
      assert.deepEqual(old,batch.old.decoded);
    });
    await t.test("both stored payloads reconstruct and Permission proves the effective receipt", async () => {
      for (const b of q.blocks) {
        const old = original.get(b.height), current = await nativeRow(client, b.height);
        assert.equal(old.native_sha256, b.oldNativeSha256);
        assert.equal(current.native_sha256, b.newNativeSha256);
        assert.deepEqual(current.decoded, {...old.decoded,...b.replacementFields});
        const { decoded } = await one(client, "SELECT proof_indexer.read_work_transition_payload_v1('livenet',$1,$2,$3::jsonb) AS decoded",
          [b.height,b.hash,JSON.stringify(old.payload)]);
        assert.deepEqual(decoded, old.decoded);
        const verified = await permissionSupersession(reader, "livenet", old, current);
        assert.equal(verified.old_archive_sha256, b.oldNativeSha256);
        assert.equal(verified.replacement_sha256, b.newNativeSha256);
        assert.equal(verified.manifest_sha256, result.manifestSha256);
        await assert.rejects(permissionSupersession(client, "livenet", {...old,block_hash:"f".repeat(64)}, current), /fork/);
      }
    });
    await t.test("cold native frames and Permission agree across database session time zones", async () => {
      await client.query("BEGIN");
      try {
        // Two ordinary future native inserts naturally rotate these hot slots.
        for (const b of q.blocks) {
          const previous = original.get(b.height), height = b.height + 128;
          const hash = sha256(Buffer.from("future cache fixture " + height));
          const payload = {...previous.decoded,blockHeight:height,blockHash:hash};
          await client.query(`INSERT INTO proof_indexer.work_amo_block_transitions
            SELECT (jsonb_populate_record(NULL::proof_indexer.work_amo_block_transitions,$1::jsonb)).*`,
            [JSON.stringify({...previous,block_height:height,block_hash:hash,payload})]);
        }
        assert.equal((await one(client,"SELECT count(*)::int AS n FROM proof_indexer.work_transition_hot_slots_v1 WHERE block_height BETWEEN $1 AND $2",
          [q.blocks[0].height,q.tip.height])).n,0);
        await client.query("SET LOCAL ROLE fixture_api");
        await client.query("SET LOCAL TIME ZONE 'America/Toronto'");
        for (const b of q.blocks) {
          const current = await nativeRow(client,b.height);
          assert.equal(current.native_sha256,b.newNativeSha256);
          const witness = await permissionSupersession(client,"livenet",original.get(b.height),current);
          assert.equal(witness.replacement_sha256,b.newNativeSha256);
        }
      } finally { await client.query("ROLLBACK"); }
      assert.deepEqual(await snapshot(client),after);
      await assert.rejects(verifyOriginalRange(client,q),/original native evidence changed/);
    });
    await t.test("identical publish and verify retries are read-only, conflicting receipts fail", async () => {
      for (const mode of ["publish","verify"]) {
        const retry = await publish(mode);
        assert.equal(retry.alreadyPublished, true);
        assert.equal(retry.manifestSha256, result.manifestSha256);
        assert.deepEqual(await snapshot(client), after);
      }
      const conflict = structuredClone(q);
      conflict.blocks[0].rawBlockSha256 = "5".repeat(64);
      await assert.rejects(publish("publish", conflict), /persistent publication evidence differs/);
      assert.deepEqual(await snapshot(client), after);
    });
    await t.test("receipts and originals are immutable and limited to the qualified declaration", async () => {
      await assert.rejects(client.query("UPDATE " + supersessions + " SET source_commit=source_commit"), /immutable/i);
      await assert.rejects(client.query("DELETE FROM " + supersessions), /immutable/i);
      await assert.rejects(client.query("UPDATE proof_indexer.work_transition_archive_v1 SET payload=payload"), /immutable/i);
      await assert.rejects(client.query(`INSERT INTO ${supersessions} SELECT
        (jsonb_populate_record(s, jsonb_build_object('incident_txid',repeat('0',64)))).* FROM ${supersessions} s LIMIT 1`),
        /violates check constraint/);
      await client.query("SET ROLE proof_indexer");
      try { await assert.rejects(client.query("DELETE FROM " + supersessions), /permission denied/); }
      finally { await client.query("RESET ROLE"); }
      assert.deepEqual(await snapshot(client), after);
    });
    await t.test("runtime and publisher reject either ACL or immutable-trigger drift", async () => {
      await assertNativeTransitionStorageContract(client);
      for (const [damage, restore] of [
        ["REVOKE SELECT ON " + supersessions + " FROM proof_indexer", "GRANT SELECT ON " + supersessions + " TO proof_indexer"],
        ["ALTER TABLE " + supersessions + " DISABLE TRIGGER immutable_work_amo_expanded_liquidity_supersession_v1",
          "ALTER TABLE " + supersessions + " ENABLE TRIGGER immutable_work_amo_expanded_liquidity_supersession_v1"],
      ]) {
        await client.query(damage);
        try {
          await assert.rejects(assertNativeTransitionStorageContract(client), /storage is unavailable/);
          await assert.rejects(publish("verify"), /unexpected native storage predecessor/);
        } finally { await client.query(restore); }
        await assertNativeTransitionStorageContract(client);
      }
    });
  } finally {
    if (reader) await reader.end();
    await client.end();
  }
});
