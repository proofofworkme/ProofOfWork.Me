import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import pg from "pg";
import { compareCanonicalUtf8 } from "../server/canonical-order.mjs";

const source = readFileSync(new URL("./backfill-proof-indexer.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("indexer.mjs", source, ts.ScriptTarget.Latest, true);
const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration)
  .map((node) => [node.name.text, node.getText(ast).replace(/^export\s+/u, "")]));
function runtime(names, globals = {}) {
  const context = vm.createContext({ Buffer, Date, Object, Map, compareCanonicalUtf8, ...globals });
  vm.runInContext(names.map((name) => {
    assert.ok(functions.has(name), name);
    return functions.get(name);
  }).join("\n"), context);
  return context;
}
const A = "a".repeat(64), B = "b".repeat(64), H = "c".repeat(64);
const OLD = "2026-09-16 11:37:09+00", FIRST = "2026-06-17 19:21:36.392203+00";
const NOW = "2026-10-14T16:00:00.000Z";
const PAYLOAD = "pwid1:r2:YWxpY2U:owner:owner";
const markers = () => ({ pendingWorkMintInspectionVersion: 1, pendingWorkMintAttemptCount: 0,
  pendingWorkMintRecoveryNeeded: false, pendingWorkMintResolvedInvalid: false,
  pendingProtocolResolvedInvalid: true });
const target = (changes = {}) => ({ txid: A, transaction_status: "pending", first_seen_at: FIRST,
  raw_tx: markers(), transaction_block_height: null, transaction_block_hash: null,
  transaction_block_index: null, transaction_block_time: null, event_id: "123", event_key: `pwid1:id-register:${A}:pending-position:1:0`,
  status: "dropped", valid: true, protocol: "pwid1", kind: "id-register", raw_payload: PAYLOAD,
  op_return_vout: 1, record_ordinal: 0, event_time: OLD, block_height: null, block_index: null,
  block_time: null, ...changes });
const item = (changes = {}) => ({ txid: A, status: "pending", confirmed: false, valid: true,
  protocol: "pwid1", kind: "id-register", payload: PAYLOAD, protocolVout: 1, recordOrdinal: 0,
  createdAt: NOW, ...changes });
const message = () => ({ prefix: "pwid1:", text: PAYLOAD, voutIndex: 1 });
const common = { NETWORK: "livenet", MEMPOOL_REVERIFY_ID_TXIDS: [A],
  itemTxid: (value) => value.txid, itemStatus: (value) => value.status ?? (value.confirmed ? "confirmed" : "pending") };
const clean = (value) => JSON.parse(JSON.stringify(value));

test("explicit repair allowlist rejects malformed, duplicate, and oversized requests", () => {
  const r = runtime(["parsePendingIdReverificationTxids"]);
  assert.deepEqual(clean(r.parsePendingIdReverificationTxids(`${B}, ${A.toUpperCase()}`)), [A, B]);
  assert.deepEqual(clean(r.parsePendingIdReverificationTxids(undefined)), []);
  for (const input of ["bad", `${A},bad`, `${A},${A.toUpperCase()}`, Array.from({ length: 17 }, (_, i) => i.toString(16).padStart(64, "0")).join(",")]) {
    assert.throws(() => r.parsePendingIdReverificationTxids(input), /at most 16 unique complete/u);
  }
});

test("repair preflight requires the complete exact allowlist with retained dropped ID evidence", async () => {
  const r = runtime(["pendingIdReverificationTargets"], common);
  const queries = [];
  const client = { query: async (...args) => { queries.push(args); return { rows: [target()] }; } };
  const result = await r.pendingIdReverificationTargets(client, { [A]: {} });
  assert.equal(result.size, 1);
  assert.equal(result.get(A).first_seen_at, FIRST);
  assert.match(queries[0][0], /first_seen_at::text/u, "retain PostgreSQL microseconds");
  assert.match(queries[0][0], /event_time::text/u);
  assert.deepEqual(clean(queries[0][1]), ["livenet", [A]]);
  assert.doesNotMatch(queries[0][0], /\b(?:UPDATE|DELETE|INSERT)\b/u);
  await assert.rejects(r.pendingIdReverificationTargets(client, {}), /absent from the current Core mempool/u);
  assert.equal(queries.length, 1, "missing Core member refuses before database lookup");
  for (const rows of [[], [target(), target()], [target({ txid: B })], [target({ event_id: null, status: null })]]) {
    await assert.rejects(r.pendingIdReverificationTargets({ query: async () => ({ rows }) }, { [A]: {} }));
  }
});

test("repair preflight refuses current projections, canonical authority, malformed clocks, and WORK involvement", async () => {
  const r = runtime(["pendingIdReverificationTargets"], common);
  for (const changes of [
    { status: "pending" }, { transaction_status: "confirmed" }, { status: "orphaned" }, { valid: false },
    { protocol: "pwt1" }, { kind: "id-event-invalid" }, { raw_payload: "" }, { op_return_vout: null },
    { record_ordinal: -1 }, { event_time: "bad" }, { first_seen_at: null }, { first_seen_at: "1970-01-01" },
    { block_height: 1 }, { block_index: 0 }, { block_time: NOW }, { transaction_block_hash: H },
    ...[ { canonicalBlockScan: {} }, { pendingWorkMintAttemptCount: 1 }, { pendingWorkMintAttemptCount: "0" },
      { pendingWorkMintRecoveryNeeded: true }, { pendingWorkMintResolvedInvalid: true },
      { pendingProtocolResolvedInvalid: false }, { pendingWorkMintInspectionVersion: 0 } ]
      .map((raw) => ({ raw_tx: { ...markers(), ...raw } })),
  ]) {
    await assert.rejects(r.pendingIdReverificationTargets({ query: async () => ({ rows: [target(changes)] }) }, { [A]: {} }),
      /preconditions differ/u, JSON.stringify(changes));
  }
});

test("a corrected verifier must match the exact retained ID identity before markers can clear", () => {
  const r = runtime(["assertPendingIdReverificationItems"], common);
  r.assertPendingIdReverificationItems(target(), [message()], [{ item: item() }]);
  for (const replacement of [null, item({ valid: false }), item({ protocol: "pwt1" }), item({ kind: "id-transfer" }),
    item({ txid: B }), item({ status: "confirmed" }), item({ payload: `${PAYLOAD}:changed` }),
    item({ protocolVout: 2 }), item({ recordOrdinal: 1 })]) {
    assert.throws(() => r.assertPendingIdReverificationItems(target(), [message()], replacement ? [{ item: replacement }] : []),
      /exact valid retained PWID/u);
  }
  assert.throws(() => r.assertPendingIdReverificationItems(target(), [message(), { prefix: "pwt1:" }], [{ item: item() }]));
  assert.throws(() => r.assertPendingIdReverificationItems(target(), [{ ...message(), text: "changed" }], [{ item: item() }]));
});

function scanFixture({ invalid = false, canonical = false, absence = false, lockedDrift = false, restoredMismatch = false, rpcUnavailable = false } = {}) {
  const trace = [];
  let targetReads = 0, memberReads = 0;
  const client = { query: async (sql) => {
    trace.push(sql.trim().slice(0, 70));
    if (sql.includes("SELECT t.txid, t.status AS transaction_status")) {
      targetReads += 1;
      return { rows: [target(lockedDrift && targetReads > 1 ? { event_time: NOW } : {})] };
    }
    if (sql.includes("SELECT e.event_id FROM proof_indexer.events e")) return { rows: restoredMismatch ? [] : [{ event_id: "123" }] };
    return { rows: [] };
  } };
  const r = runtime(["pendingIdReverificationTargets", "assertPendingIdReverificationItems", "backfillMempoolScanSource"], {
    ...common, BITCOIN_RPC_URL: "http://127.0.0.1:8332", console: { error: () => {} }, WORK_AMO_V8_DECLARATION_PINS_CONFIGURED: true,
    WORK_PROJECTION_STATE_Q16: "q16", currentWorkProjectionState: () => { throw new Error("unrelated WORK projection read"); },
    bitcoinRpc: async (method) => {
      trace.push(method);
      if (method === "getrawmempool") {
        if (rpcUnavailable) throw new Error("Core unavailable");
        return { [A]: { time: 1 }, [B]: { time: 2 } };
      }
      if (method === "getmempoolentry") {
        memberReads += 1;
        if (absence && memberReads === 2) throw new Error("left mempool");
        return { time: 1 };
      }
      throw new Error(method);
    }, canonicalMempoolTxidSnapshot: (value) => value,
    mempoolScanState: async () => ({ processedTxids: [A, B], cursor: null, priorityCursor: null }),
    MEMPOOL_SCAN_MAX_TXIDS: 16, MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS: 16, MEMPOOL_SCAN_SEEN_LIMIT: 100,
    MEMPOOL_SCAN_BUDGET_MS: 60000, isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(value),
    knownMempoolRecoveryTxids: () => { throw new Error("unrelated recovery selection"); },
    plannedMempoolScanCandidates: () => { throw new Error("unrelated candidate selection"); },
    mempoolScanTimeBudgetReached: () => false, mempoolScanCursorForEntry: () => null,
    freshRawTransactionFromCore: async (txid) => { assert.equal(txid, A); trace.push("fresh-Core"); return { txid }; },
    transactionHasConfirmedBlockEvidence: () => false, protocolMessagesFromTx: () => [message()],
    pendingWorkMintAttemptCount: () => 0, storePendingWorkMintAttemptPreinspection: async () => 0,
    pendingCoreMarketplaceVerifierNeeded: () => false, transactionWithInputPrevouts: async (tx) => tx,
    PENDING_ONLY_BACKFILL: true, BACKFILL_PROCESS_STARTED_AT_MS: Date.now(), PENDING_ONLY_CHILD_TIMEOUT_MS: 180000,
    PENDING_ONLY_PERSISTENCE_HEADROOM_MS: 1000,
    preparedProtocolItemsForTx: async () => { trace.push("corrected-verifier"); return [{ item: item({ valid: !invalid }) }]; },
    pendingWorkMintDecision: () => null, pendingWorkMintVerifierResolved: () => false,
    pendingTransactionWriteItem: (prepared) => prepared[0].item,
    upsertTransaction: async () => { trace.push("transaction-row-lock"); },
    lockedCanonicalTransactionForMempool: async () => canonical,
    storePendingWorkMintInspection: async (...args) => { assert.equal(args.at(-1), false); trace.push("clear-invalid-marker"); },
    reconcilePendingWorkMintDecision: async () => ({ persistInvalid: false }),
    persistPreparedProtocolItems: async () => { trace.push("persist-valid-ID"); return { indexed: 1, skipped: 0 }; },
  });
  return { run: () => r.backfillMempoolScanSource(client, { label: "mempool-scan" }), trace };
}

test("scoped scan verifies only approved IDs before mutating markers and does not publish unrelated WORK/cursor state", async () => {
  const fixture = scanFixture();
  const result = clean(await fixture.run());
  assert.deepEqual(result.txids, [A]);
  assert.equal(result.indexed, 1);
  assert.equal(result.q16PendingRequired, false);
  assert.equal(fixture.trace.filter((entry) => entry === "getmempoolentry").length, 2);
  assert.ok(fixture.trace.indexOf("corrected-verifier") < fixture.trace.indexOf("transaction-row-lock"));
  assert.ok(fixture.trace.indexOf("transaction-row-lock") < fixture.trace.indexOf("clear-invalid-marker"));
  assert.equal(fixture.trace.at(-1), "COMMIT");
});

test("scoped scan fails explicitly when the initial Core sample is unavailable", async () => {
  const fixture = scanFixture({ rpcUnavailable: true });
  await assert.rejects(fixture.run(), /Core unavailable/u);
  assert.ok(!fixture.trace.includes("clear-invalid-marker"));
});

test("scoped scan never clears invalid decisions and rolls back canonical races, changed observations, absence, or failed restore", async () => {
  for (const options of [{ invalid: true }, { canonical: true }, { absence: true }, { lockedDrift: true }, { restoredMismatch: true }]) {
    const fixture = scanFixture(options);
    await assert.rejects(fixture.run(), /revalidation is incomplete/u);
    assert.ok(!fixture.trace.includes("COMMIT"));
    if (options.invalid || options.canonical || options.lockedDrift) assert.ok(!fixture.trace.includes("clear-invalid-marker"));
    if (!options.invalid) assert.ok(fixture.trace.includes("ROLLBACK"));
  }
});

function eventRuntime(extra = {}) {
  return runtime(["upsertEvent", "stableEventKey"], {
    ...common, WORK_AMO_V5_ACTIVATION_HEIGHT: 959621, PROOF_INDEX_RENDERED_MAIL_KINDS: [],
    canonicalProtocolItemForPostgres: (value) => value, eventKind: (value) => value.kind,
    workMarketV2EventIsActionBound: () => true, normalizedEventItem: (value) => value,
    workProjectionItem: (value) => value, normalizedLowerText: (value) => value.toLowerCase(),
    protocolForItem: (value) => value.protocol, stableEventKeyKind: (_, kind) => kind,
    itemTime: (value) => value.blockTime ?? value.createdAt,
    upsertTransaction: async () => ({ confirmed: false }), numberOrNull: (value) => value ?? null,
    reconcileLegacyPendingEventPosition: async () => ({ canonicalConfirmed: false }),
    amountSats: () => 1000, dataBytes: () => PAYLOAD.length, ...extra,
  });
}

const postgresUrl = process.env.POW_TEST_POSTGRES_URL;
test("real PostgreSQL retains exact dropped-ID clocks, rejects mismatched provenance, and recovers only missing pending projections", { skip: !postgresUrl }, async () => {
  // Only an isolated disposable test database is supported: never point this at a service DB.
  const client = new pg.Client({ connectionString: postgresUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA proof_indexer;
      CREATE TABLE proof_indexer.events (
        event_id bigserial PRIMARY KEY, network text, event_key text, txid text, protocol text, kind text,
        status text, valid boolean, validation_errors text[], amount_sats bigint, data_bytes integer,
        block_height integer, block_time timestamptz, event_time timestamptz, raw_payload text, payload jsonb,
        op_return_vout integer, block_index integer, record_ordinal integer, updated_at timestamptz,
        UNIQUE(network,event_key));
      CREATE TABLE proof_indexer.transactions (
        network text, txid text, status text, first_seen_at timestamptz, last_seen_at timestamptz,
        confirmed_at timestamptz, dropped_at timestamptz, dropped_reason text, replaced_by_txid text,
        block_hash text, block_height integer, block_index integer, block_time timestamptz, source text,
        raw_tx jsonb, updated_at timestamptz, UNIQUE(network,txid));
      CREATE TABLE proof_indexer.blocks (network text, block_hash text, height integer, canonical boolean);`);
    const queries = [];
    const r = eventRuntime();
    await r.upsertEvent({ query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } }, "registry-pending", item());
    assert.equal(queries.length, 1);
    const { sql, params } = queries[0];
    const first = [...params]; first[5] = "dropped"; first[12] = OLD;
    await client.query(sql, first);
    await client.query(sql, params);
    let row = (await client.query("SELECT * FROM proof_indexer.events")).rows[0];
    assert.equal(row.status, "pending");
    assert.equal(row.event_time.toISOString(), new Date(OLD).toISOString());
    for (const change of ["raw_payload = 'changed'", "block_height = 1", "block_time = now()", "block_index = 0", "valid = false", "op_return_vout = 2", "record_ordinal = 1", "status = 'orphaned'", "event_time = '1970-01-01'"]) {
      await client.query("DELETE FROM proof_indexer.events");
      await client.query(sql, first);
      await client.query(`UPDATE proof_indexer.events SET ${change}`);
      await client.query(sql, params);
      row = (await client.query("SELECT * FROM proof_indexer.events")).rows[0];
      assert.equal(row.event_time.toISOString(), NOW, change);
    }
    const txRuntime = runtime(["upsertTransaction"], { ...common,
      itemTime: (value) => value.createdAt, numberOrNull: (value) => value ?? null });
    await client.query(`INSERT INTO proof_indexer.transactions(network,txid,status,first_seen_at,raw_tx)
      VALUES ('livenet',$1,'pending',$2::timestamptz,$3)`, [A, FIRST, markers()]);
    await txRuntime.upsertTransaction(client, item(), A, "pending", "mempool-scan");
    const firstSeen = (await client.query("SELECT first_seen_at::text FROM proof_indexer.transactions")).rows[0].first_seen_at;
    assert.match(firstSeen, /\.392203/u);
    await client.query("DELETE FROM proof_indexer.events");
    await client.query(sql, first);
    const recovery = runtime(["knownMempoolRecoveryTxids", "mempoolRecoveryTxidsFromRows"], {
      ...common, WORK_TOKEN_ID: B, WORK_TOKEN_MINT_AMOUNT: 1000, WORK_TOKEN_MAX_SUPPLY: 21000000,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(value),
    });
    assert.deepEqual(clean(await recovery.knownMempoolRecoveryTxids(client, { [A]: {} })), [], "terminal-invalid remains suppressed");
    await client.query(`UPDATE proof_indexer.transactions SET raw_tx = raw_tx || '{"pendingProtocolResolvedInvalid":false}'::jsonb`);
    assert.deepEqual(clean(await recovery.knownMempoolRecoveryTxids(client, { [A]: {} })), [A], "a dropped historical event cannot count as a current pending projection");
    await client.query(sql, params);
    assert.deepEqual(clean(await recovery.knownMempoolRecoveryTxids(client, { [A]: {} })), [], "restored pending row needs no further recovery");
    assert.deepEqual(clean(await recovery.knownMempoolRecoveryTxids(client, {})), []);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
