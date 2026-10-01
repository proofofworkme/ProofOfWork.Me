import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { compareCanonicalUtf8 } from "./canonical-order.mjs";
import { compareProofIndexRegistryPayloads } from "./db/proof-index-reader.mjs";

// Exercise production functions without starting the HTTP server or opening a
// database. In particular, the DB contract runs against a recording pool.
function functionsAt(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return new Map(parsed.statements.filter(ts.isFunctionDeclaration)
    .map((node) => [node.name.text, node.getText(parsed).replace(/^export\s+/u, "")]));
}
const apiFunctions = functionsAt("./proof-api.mjs");
const readerFunctions = functionsAt("./db/proof-index-reader.mjs");
function isolated(functions, names, globals = {}) {
  const context = vm.createContext({ Buffer, compareCanonicalUtf8, ...globals });
  vm.runInContext(names.map((name) => {
    assert.ok(functions.has(name), `missing production function ${name}`);
    return functions.get(name);
  }).join("\n"), context);
  return context;
}
const A = "a".repeat(64);
const B = "b".repeat(64);
const HASH = "c".repeat(64);
const OLD = "2026-09-01T01:02:03.000Z";
const NEW = "2026-10-01T01:02:03.000Z";
const seconds = (iso) => Date.parse(iso) / 1000;
const clean = (value) => JSON.parse(JSON.stringify(value));
function apiRuntime(extra = {}) {
  return isolated(apiFunctions, [
    "registryPayloadWithPendingObservationTimes", "registryPayloadWithIndexedPendingTimes",
    "compareRegistryRecordDisplayOrder", "compareActivityItems", "compareMarketplaceSales",
  ], {
    transactionConfirmed: (tx) => tx?.status?.confirmed === true,
    transactionTxid: (tx) => tx?.txid,
    freshDataUnavailableError: (message) => Object.assign(new Error(message), { statusCode: 503 }),
    ...extra,
  });
}
function row(txid = A, overrides = {}) {
  return {
    txid, kind: "id-register", id: txid.slice(0, 1),
    op_return_vout: 1, record_ordinal: 0,
    event_time: OLD, first_seen_at: OLD, created_at: NEW,
    ...overrides,
  };
}
function readerRuntime(rows, { checkpoints = [true, true] } = {}) {
  const queries = [];
  let fence = 0;
  const reader = isolated(readerFunctions, [
    "proofIndexPendingRegistryObservationTimes", "plausibleBitcoinEventTime", "dateIso",
  ], {
    BITCOIN_GENESIS_TIME_MS: Date.UTC(2009, 0, 3, 18, 15, 5),
    normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
    normalizedTxid: (value) => String(value ?? "").trim().toLowerCase(),
    objectRecord: (value) => value ?? {},
    rowNumber: (value, key) => Number(value?.[key]) || 0,
    proofIndexPool: () => ({ query: async (sql, params) => {
      queries.push({ sql, params });
      if (!/FROM proof_indexer\.ledger_snapshots/u.test(sql)) return { rows };
      const checkpoint = checkpoints[fence++];
      return { rows: [{ indexed_through_block: 969391,
        complete: true, block_hash: HASH,
        ...(typeof checkpoint === "boolean" ? { complete: checkpoint } : checkpoint),
      }] };
    } }),
  });
  return { reader, queries };
}
function transaction(txid = A, acceptedAt = NEW) {
  return { txid, _powCanonicalRpcHydration: true,
    status: { confirmed: false, mempool_time: seconds(acceptedAt) } };
}
function observation(txid = A, overrides = {}) {
  return { txid, kind: "id-register", id: txid.slice(0, 1),
    protocolVout: 1, recordOrdinal: 0, indexedEventTime: OLD,
    indexedFirstSeenAt: OLD, ...overrides };
}
function payload() {
  const pending = { txid: A, id: "a", confirmed: false, createdAt: NEW,
    amountSats: 1000, ownerAddress: "owner", receiveAddress: "receiver" };
  return { records: [pending], activity: [{ ...pending, kind: "id-register",
    protocolVout: 1, recordOrdinal: 0 }], listings: [], sales: [], pendingEvents: [] };
}

test("one bounded SELECT retains event and indexed first-seen clocks separately", async () => {
  const { reader, queries } = readerRuntime([row(), row(B, { first_seen_at: NEW })]);
  const result = clean(await reader.proofIndexPendingRegistryObservationTimes("livenet", [B, A, A]));
  assert.equal(queries.length, 1);
  assert.deepEqual(clean(queries[0].params), ["livenet", [A, B]]);
  assert.match(queries[0].sql, /e\.txid = ANY\(\$2::text\[\]\)/u);
  assert.match(queries[0].sql, /e\.status = 'pending' AND t\.status = 'pending'/u);
  assert.doesNotMatch(queries[0].sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
  assert.equal(result[0].indexedEventTime, OLD);
  assert.equal(result[0].indexedFirstSeenAt, OLD);
  assert.equal(result[1].indexedEventTime, OLD);
  assert.equal(result[1].indexedFirstSeenAt, NEW,
    "an indexed first-seen difference must not overwrite retained event history");
});

test("invalid bounds and implausible times fail without inventing a wall-clock date", async () => {
  const { reader, queries } = readerRuntime([row(A, { event_time: null, created_at: null })]);
  assert.deepEqual(clean(await reader.proofIndexPendingRegistryObservationTimes("livenet", [])), []);
  for (const txids of [["not-a-txid"], Array(501).fill(A)]) {
    await assert.rejects(reader.proofIndexPendingRegistryObservationTimes("livenet", txids));
  }
  assert.equal(queries.length, 0);
  await assert.rejects(reader.proofIndexPendingRegistryObservationTimes("livenet", [A]),
    /no retained plausible observation time/u);
});

test("exact pending observation lookup rejects either side of a changing canonical checkpoint", async () => {
  const options = { expectedHeight: 969391, expectedHash: HASH };
  for (const checkpoints of [
    [false, true], [true, false],
    [{ indexed_through_block: 969390 }, true],
    [true, { block_hash: "d".repeat(64) }],
  ]) {
    const { reader, queries } = readerRuntime([row()], { checkpoints });
    assert.equal(await reader.proofIndexPendingRegistryObservationTimes("livenet", [A], options), null);
    assert.equal(queries.length, checkpoints[0] === true ? 3 : 1);
    assert.ok(queries.every(({ sql }) => !/count\(/u.test(sql)),
      "the exact checkpoint fence must not count unrelated confirmed rows");
  }
  const { reader, queries } = readerRuntime([row()]);
  await assert.rejects(reader.proofIndexPendingRegistryObservationTimes("livenet", [A],
    { expectedHeight: 0, expectedHash: HASH }), /invalid checkpoint/u);
  assert.equal(queries.length, 0);
  assert.equal((await reader.proofIndexPendingRegistryObservationTimes("livenet", [A], options)).length, 1);
});

test("narrow checkpoint reads retain the original scan selection and nullish hash precedence", async () => {
  const { reader, queries } = readerRuntime([row()]);
  await reader.proofIndexPendingRegistryObservationTimes("livenet", [A],
    { expectedHeight: 969391, expectedHash: HASH });
  const selector = (sql) => sql.slice(sql.indexOf("FROM proof_indexer.ledger_snapshots"))
    .split("LIMIT 1")[0].replace(/\s+/gu, "");
  const broad = readerFunctions.get("latestProofIndexScanMetadata");
  assert.equal(selector(queries[0].sql), selector(broad),
    "scalar fences must select precisely the same newest hashed block-scan row");
  assert.match(queries[0].sql, /COALESCE\(payload->>'indexedThroughBlockHash',\s*payload->>'blockHash'\)/u,
    "an empty primary hash remains invalid rather than silently using its fallback");
});

test("the actual indexed event and registration projections preserve their existing timestamp source", () => {
  const reader = isolated(readerFunctions, [
    "eventRowPayload", "pendingIdRegistryStateFromActivity", "idRegistryProtocolFeeSats",
    "plausibleBitcoinEventTime", "dateIso", "compareHistoryItems", "itemCreatedAtMs",
  ], {
    BITCOIN_GENESIS_TIME_MS: Date.UTC(2009, 0, 3, 18, 15, 5),
    ID_REGISTRATION_PRICE_SATS: 1000, ID_MUTATION_PRICE_SATS: 546,
    normalizedText: (value) => String(value ?? "").trim(),
    normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
    normalizedTxid: (value) => String(value ?? "").trim().toLowerCase(),
    canonicalEventPayload: (value) => value,
    normalizeEventPayload: (value) => value,
    canonicalEventIdentityDetails: () => ({}),
    eventPayloadParticipants: () => [],
    rowNumber: (value, key) => Number(value?.[key]) || 0,
  });
  const input = { ...row(), protocol: "pwid1", status: "pending", valid: true,
    transaction_first_seen_at: "2026-06-17T19:21:36.392203Z",
    payload: { kind: "id-register", id: "a", ownerAddress: "owner", receiveAddress: "receiver",
      createdAt: NEW, amountSats: 999999 } };
  const before = structuredClone(input);
  const pending = reader.eventRowPayload(input, "livenet");
  assert.equal(pending.createdAt, OLD);
  assert.equal(pending.indexedEventTime, OLD);
  assert.equal(pending.indexedFirstSeenAt, "2026-06-17T19:21:36.392Z");
  assert.equal(pending.createdAtSource, "proof-indexer-retained-event-time");
  assert.equal(pending.amountSats, 1000, "payload aliases cannot overwrite the fixed registration fee");
  const record = reader.pendingIdRegistryStateFromActivity([pending], "livenet").pendingRecords[0];
  assert.equal(record.createdAt, OLD);
  assert.equal(record.indexedFirstSeenAt, pending.indexedFirstSeenAt);
  const confirmed = reader.eventRowPayload({ ...input, status: "confirmed" }, "livenet");
  assert.equal(confirmed.createdAt, OLD);
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.indexedFirstSeenAt, undefined,
    "pending observation metadata must not replace a confirmed date");
  assert.deepEqual(input, before);
});

test("readmission changes Core admission while persisted display time and confirmed records remain intact", () => {
  const api = apiRuntime();
  const original = payload();
  const confirmed = { txid: B, id: "confirmed", confirmed: true, createdAt: OLD, blockHeight: 1 };
  original.records.push(confirmed);
  original.activity.push({ ...confirmed, kind: "id-register" });
  const before = structuredClone(original);
  const first = api.registryPayloadWithPendingObservationTimes(original, [transaction(A, OLD)], [observation()],
    { requireIndexed: true });
  const readmitted = api.registryPayloadWithPendingObservationTimes(original, [transaction()], [observation()],
    { requireIndexed: true });
  const pending = readmitted.records.find((item) => !item.confirmed);
  assert.equal(pending.createdAt, OLD);
  assert.equal(pending.indexedFirstSeenAt, OLD);
  assert.equal(pending.mempoolAcceptedAt, NEW);
  assert.equal(pending.mempoolAcceptedAtSource, "bitcoin-core-getmempoolentry");
  assert.equal(first.records.find((item) => !item.confirmed).mempoolAcceptedAt, OLD);
  assert.equal(readmitted.records.find((item) => item.confirmed), confirmed);
  assert.deepEqual(original, before);
  assert.deepEqual(clean(compareProofIndexRegistryPayloads(first, readmitted)).pending,
    { activity: [], listings: [], records: [], sales: [] },
    "the volatile Core admission clock is independently fenced, not indexed event identity");
  const drift = clean(readmitted);
  drift.records.find((item) => !item.confirmed).createdAt = NEW;
  assert.notEqual(compareProofIndexRegistryPayloads(first, drift).pending.records.length, 0,
    "retained timestamp parity must remain enforced");
});

test("missing and ambiguous retained observations fail strict parity; absent index keeps an explicit fallback", () => {
  const api = apiRuntime();
  for (const observations of [null, [], [observation(), observation()]]) {
    assert.throws(() => api.registryPayloadWithPendingObservationTimes(payload(), [transaction()], observations,
      { requireIndexed: true }), (error) => error.statusCode === 503);
  }
  const unindexed = api.registryPayloadWithPendingObservationTimes(payload(), [transaction()], null);
  assert.equal(unindexed.records[0].createdAt, NEW);
  assert.equal(unindexed.records[0].createdAtSource, "transaction-mempool-time");
  assert.equal(unindexed.records[0].indexedFirstSeenAt, undefined);
});

test("equal retained times use deterministic UTF-8 txid display ordering without changing protocol positions", () => {
  const api = apiRuntime();
  const input = payload();
  input.records.push({ ...input.records[0], txid: B, id: "b" });
  input.activity.push({ ...input.activity[0], txid: B, id: "b" });
  const output = api.registryPayloadWithPendingObservationTimes(input,
    [transaction(A), transaction(B)], [observation(), observation(B)], { requireIndexed: true });
  assert.deepEqual(clean(output.records.map((item) => item.txid)), [B, A]);
  assert.deepEqual(clean(output.activity.map((item) => item.txid)), [B, A]);
  assert.deepEqual(clean(output.activity.map((item) => [item.protocolVout, item.recordOrdinal])), [[1, 0], [1, 0]]);
});

test("async enrichment uses one bounded lookup after resolution and propagates exact fences", async () => {
  const calls = [];
  const api = apiRuntime({ proofIndexPendingRegistryObservationTimes: async (...args) => {
    calls.push(args); return [observation()];
  } });
  const input = payload();
  input.records[0].expiresAt = "2026-09-15T00:00:00Z";
  const options = { requireIndexed: true, expectedHeight: 969391, expectedHash: HASH };
  const output = await api.registryPayloadWithIndexedPendingTimes(input, [transaction()], "livenet", options);
  assert.equal(calls.length, 1);
  assert.deepEqual(clean(calls[0]), ["livenet", [A], options]);
  assert.equal(output.records[0].expiresAt, input.records[0].expiresAt);
  assert.equal(output.records[0].amountSats, 1000);
  assert.equal(output.records[0].ownerAddress, "owner");
  assert.equal(output.records[0].receiveAddress, "receiver");
  assert.equal(input.records[0].createdAt, NEW, "the resolver input clock remains unchanged");
  const empty = { records: [], activity: [], sales: [], pendingEvents: [] };
  assert.equal(await api.registryPayloadWithIndexedPendingTimes(empty, [], "livenet", options), empty);
  assert.equal(calls.length, 1);
});

test("the actual exact-current ID route returns matching scalar and array pending observations", async () => {
  const api = apiRuntime();
  const original = payload();
  original.record = original.records[0];
  const pending = api.registryPayloadWithPendingObservationTimes(original, [transaction()], [observation()],
    { requireIndexed: true });
  assert.equal(pending.record.createdAt, pending.records[0].createdAt);
  assert.equal(pending.record.mempoolAcceptedAt, NEW);
  const source = readFileSync(new URL("./proof-api.mjs", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("proof-api.mjs", source, ts.ScriptTarget.Latest, true);
  let route;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(parsed).includes('pathParts[2] === "ids"') &&
        node.thenStatement.getText(parsed).includes("proofIndexIdRecordPayload")) route = node.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(route, "the exact current-ID route must remain inspectable");
  let response;
  const globals = {
    pathParts: ["api", "v1", "ids", "a"], network: "livenet",
    url: new URL("http://127.0.0.1:8081/api/v1/ids/a?current=1&fresh=1"),
    normalizePowId: (value) => String(value ?? "").toLowerCase(), response: {},
    proofIndexIdRecordPayload: async () => ({ ...original, source: "proof-index:registry-id" }),
    proveCurrentIdAbsence: async () => ({ ...pending, source: "first-party-pending" }),
    exactIdRecordsWithIndexedConfirmation: (value) => value.records,
    mergedSourceLabel: (...values) => values.filter(Boolean).join("+"),
    jsonResponse: (_response, status, value) => { response = { status, value }; },
  };
  const context = vm.createContext(globals);
  vm.runInContext(`async function exactCurrentRoute() { ${route} }`, context);
  await context.exactCurrentRoute();
  assert.equal(response.status, 200);
  assert.equal(response.value.record, response.value.records[0]);
  assert.equal(response.value.record.createdAt, OLD);
  assert.equal(response.value.record.indexedEventTime, OLD);
  assert.equal(response.value.record.mempoolAcceptedAt, NEW);
  assert.equal(response.value.record.mempoolAcceptedAtSource, "bitcoin-core-getmempoolentry");
  assert.equal(response.value.status, "pending");
  assert.equal(response.value.routable, false);
  assert.equal(original.record.createdAt, NEW);
});

test("pending update/list/seal/buy retain status, terms, ownership and exact multi-record identity", () => {
  const api = apiRuntime();
  const kinds = ["id-register", "id-update", "id-list", "id-seal", "id-buy"];
  const activities = kinds.map((kind, protocolVout) => ({
    txid: A, id: "a", kind, protocolVout, recordOrdinal: 0,
    confirmed: false, valid: true, status: "pending", dropped: false,
    createdAt: NEW, amountSats: kind === "id-register" ? 1000 : 546,
    ownerAddress: "owner", receiveAddress: "receiver", sellerAddress: "seller",
    buyerAddress: "buyer", priceSats: 10000, listingId: B,
    saleAuthorization: { expiresAt: "2026-09-15T00:00:00Z", nonce: "retained" },
  }));
  const observations = activities.map((item) => observation(A, {
    kind: item.kind, protocolVout: item.protocolVout,
    // A seal can derive its ID from the confirmed listing rather than its
    // stored raw payload. Its physical tuple remains the exact identity.
    ...(item.kind === "id-seal" ? { id: "" } : {}),
  }));
  const input = { records: [{ ...activities[0] }], activity: activities,
    pendingEvents: activities.slice(1).map((item) => ({ ...item,
      kind: { "id-update": "update", "id-list": "list", "id-seal": "seal", "id-buy": "marketTransfer" }[item.kind],
    })), sales: [{ ...activities[4] }], listings: [] };
  const original = structuredClone(input);
  const result = api.registryPayloadWithPendingObservationTimes(input,
    [transaction()], observations, { requireIndexed: true });
  assert.deepEqual(input, original);
  for (const item of result.activity) {
    const originalItem = original.activity.find((value) => value.protocolVout === item.protocolVout);
    for (const key of Object.keys(originalItem).filter((key) => key !== "createdAt")) {
      assert.deepEqual(clean(item[key]), clean(originalItem[key]), `${item.kind}.${key}`);
    }
    assert.equal(item.createdAt, OLD);
    assert.equal(item.mempoolAcceptedAt, NEW);
  }
  assert.equal(result.pendingEvents.length, 4);
  assert.equal(result.sales[0].amountSats, 546);
  assert.equal(result.sales[0].priceSats, 10000);
  const wrongPosition = structuredClone(observations);
  wrongPosition[2].protocolVout++;
  assert.throws(() => api.registryPayloadWithPendingObservationTimes(input,
    [transaction()], wrongPosition, { requireIndexed: true }), (error) => error.statusCode === 503);
});

test("22 observed carriers do not require timestamps for rejected attempts outside the 20 accepted winners", async () => {
  const accepted = Array.from({ length: 20 }, (_, index) => {
    const txid = (index + 1).toString(16).padStart(64, "0");
    return { txid, id: `id${index}`, confirmed: false, kind: "id-register",
      protocolVout: 1, recordOrdinal: 0, valid: true, createdAt: NEW };
  });
  const invalid = { txid: A, id: "rejected", confirmed: false, valid: false,
    kind: "id-register", createdAt: OLD, status: "pending", reasonCode: "duplicate-id" };
  const dropped = { txid: B, id: "dropped", confirmed: false, dropped: true,
    kind: "id-register", createdAt: OLD, status: "dropped" };
  const calls = [];
  const api = apiRuntime({ proofIndexPendingRegistryObservationTimes: async (_network, txids) => {
    calls.push(txids);
    return accepted.map((item) => observation(item.txid, { id: item.id }));
  } });
  const input = { records: accepted, activity: [...accepted, invalid, dropped],
    pendingEvents: [], sales: [], listings: [] };
  const result = await api.registryPayloadWithIndexedPendingTimes(input,
    [...accepted.map((item) => transaction(item.txid)), transaction(A), transaction(B)],
    "livenet", { requireIndexed: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 20);
  assert.ok(!calls[0].includes(A) && !calls[0].includes(B));
  assert.equal(result.activity.find((item) => item.txid === A), invalid);
  assert.equal(result.activity.find((item) => item.txid === B), dropped);
  assert.equal(invalid.status, "pending");
  assert.equal(dropped.status, "dropped");
  assert.equal(result.records.length, 20);
});

test("wallet Q16 unavailable diagnostics identify the failed gate and preserve fail-closed results", async () => {
  const completeReadiness = { ready: true, active: true, evidenceComplete: true,
    parityReady: true, pendingReady: true, replayReady: true,
    tipHeight: 969391, tipHash: HASH };
  const cases = [
    { pins: null, reason: "work-q16-reader-pins-unavailable" },
    { readiness: { ...completeReadiness, pendingReady: false },
      reason: "work-q16-readiness-unavailable" },
    { exact: false, reason: "work-q16-payload-inexact" },
    { readiness: { ...completeReadiness, tipHeight: 969392 },
      reason: "work-q16-checkpoint-mismatch" },
    { readiness: { ...completeReadiness, tipHash: "d".repeat(64) },
      reason: "work-q16-checkpoint-mismatch" },
    { reason: null },
  ];
  for (const fixture of cases) {
    const diagnostics = [];
    let exactCalls = 0;
    const reader = isolated(readerFunctions, ["payloadWithCurrentWorkPrecisionReadPolicy"], {
      WORK_SUBATOM_PROJECTION_MODEL: "work-subatoms-v2",
      isWorkTokenId: (value) => value === "work",
      configuredWorkPrecisionV2ReaderPins: () => fixture.pins === null
        ? null : { activationHeight: 969000 },
      proofIndexWorkAmoV8ActivationLatch: async () => null,
      workPrecisionV2ProjectCurrentPayload: (value) => value,
      proofIndexWorkPrecisionV2MigrationReadiness: async () =>
        fixture.readiness ?? completeReadiness,
      workPrecisionV2CanonicalSummaryBootstrapReady: () => false,
      workPrecisionV2CurrentPayloadIsExact: () => { exactCalls++; return fixture.exact !== false; },
      normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
    });
    const input = { indexedThroughBlock: 969391, indexedThroughBlockHash: HASH,
      tokens: [{ tokenId: "work", amountStorageModel: "work-subatoms-v2" }],
      source: "proof-indexer-wallet-token-overlay" };
    const result = await reader.payloadWithCurrentWorkPrecisionReadPolicy("livenet", input, {
      requireExactCheckpoint: true, requireSupplyEnvelope: false,
      onUnavailable: (details) => diagnostics.push(clean(details)),
    });
    if (fixture.reason) {
      assert.equal(result, null, fixture.reason);
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0].reason, fixture.reason);
      assert.ok(Object.keys(diagnostics[0]).every((key) => [
        "reason", "active", "evidenceComplete", "parityReady", "pendingReady",
        "replayReady", "ready", "payloadExact", "payloadHeight", "readinessHeight",
        "hashesMatch",
      ].includes(key)), "diagnostics must not expose payloads, addresses, credentials or queries");
    } else {
      assert.equal(result, input);
      assert.deepEqual(diagnostics, []);
    }
    if (fixture.reason === "work-q16-readiness-unavailable") {
      assert.equal(exactCalls, 0, "failed readiness must retain its original short-circuit behavior");
      assert.equal(diagnostics[0].payloadExact, null, "unevaluated exactness must not be labeled false");
    }
  }
});
