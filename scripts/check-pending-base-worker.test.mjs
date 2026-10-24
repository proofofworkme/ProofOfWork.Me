import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import test from "node:test";
import { workAmoV5CanonicalPayloadCommitment } from "../server/work-amo-v5.mjs";
const source = readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
const laneSource = source.slice(source.indexOf("function createPendingBaseValidationLane("), source.indexOf("const pendingBaseValidationLane ="));
const stageError = (code, message, details) => Object.assign(new Error(message), { statusCode: 503, details: { code, ...details } });
const createLane = new Function("pendingWorkVerifierStageError", `${laneSource}; return createPendingBaseValidationLane;`)(stageError);
const workerSource = source.slice(source.indexOf("function startPendingBaseValidationWorker("), source.indexOf("function pendingWorkVerifierStageConfirmedBase(\n"));
const turn = () => new Promise(resolve => setImmediate(resolve));
class FakeWorker extends EventEmitter {
  sent = [];
  terminated = 0;
  postMessage(value) { this.sent.push(value); }
  ref() {}
  unref() {}
  async terminate() { this.terminated += 1; }
  reply(value) { this.emit("message", { id: this.sent.at(-1).id, type: "result", value }); }
}

test("one active validation and one queued validation; excess work fails closed", async () => {
  const worker = new FakeWorker(); const lane = createLane({ createWorker: () => worker });
  try {
    const one = lane.run(1, 2, 3), two = lane.run(4, 5, 6);
    await assert.rejects(lane.run(7, 8, 9), e => e.statusCode === 503 && e.details.reason === "queue-full");
    assert.equal(worker.sent.length, 1); worker.reply("first");
    assert.equal(await one, "first"); assert.equal(worker.sent.length, 2);
    worker.reply("second"); assert.equal(await two, "second");
  } finally { await lane.close(); }
});

test("validation errors preserve exact fail-closed status and evidence", async () => {
  const worker = new FakeWorker(); const lane = createLane({ createWorker: () => worker });
  try {
    const result = lane.run({}, {}, {});
    worker.emit("message", { id: worker.sent[0].id, type: "error", error: {
      name: "Error", message: "Conservation failed", statusCode: 503,
      details: { code: "PENDING_WORK_STAGE_BASE_CONSERVATION_INVALID", field: "supply" },
    } });
    await assert.rejects(result, e => e.statusCode === 503 && e.message === "Conservation failed" && e.details.field === "supply");
  } finally { await lane.close(); }
});

test("a timed-out worker is terminated before another can start", async () => {
  let release; const worker = new FakeWorker(); const next = new FakeWorker(); let created = 0;
  worker.terminate = () => new Promise(resolve => { release = resolve; });
  const lane = createLane({ createWorker: () => ++created === 1 ? worker : next, timeoutMs: 20 });
  const expired = assert.rejects(lane.run(1, 2, 3), e => e.statusCode === 503 && e.details.reason === "execution-deadline");
  await new Promise(resolve => setTimeout(resolve, 30));
  const queued = lane.run(4, 5, 6); assert.equal(created, 1); release();
  await expired; await turn(); assert.equal(created, 2); next.reply("recovered");
  assert.equal(await queued, "recovered"); await lane.close();
});

test("worker exit and invalid correlation fail closed without synchronous fallback", async () => {
  for (const fault of ["exit", "message"]) {
    const worker = new FakeWorker(); const lane = createLane({ createWorker: () => worker });
    const result = lane.run({}, {}, {});
    worker.emit(fault, fault === "exit" ? 1 : { id: 999, type: "result", value: "wrong" });
    await assert.rejects(result, e => e.statusCode === 503 && e.details.code === "PENDING_WORK_STAGE_CPU_UNAVAILABLE");
    assert.equal(worker.terminated, 1); await lane.close();
  }
});

test("CPU work runs off the caller event loop and returns the unchanged value", async () => {
  const lane = createLane({ createWorker: () => new Worker(`
    const { parentPort } = require('node:worker_threads');
    ${workerSource}
    startPendingBaseValidationWorker(parentPort, (payload, tip, commitment) => {
      const until = Date.now() + 150; while (Date.now() < until) {}
      if (payload.invalid) throw Object.assign(new Error('invalid'), { statusCode:503, details:{code:'BASE_INVALID'} });
      return { state: payload, tip, commitment };
    });`, { eval: true }) });
  let ticks = 0; const timer = setInterval(() => { ticks += 1; }, 10);
  try {
    const payload = { nested: [1, "proof", { amount: "2100000000000000000000" }] };
    assert.deepEqual(await lane.run(payload, { height: 972783 }, { sha256: "a".repeat(64) }), {
      state: payload, tip: { height: 972783 }, commitment: { sha256: "a".repeat(64) },
    });
    assert.ok(ticks >= 5, `caller was not responsive: ${ticks} ticks`);
    await assert.rejects(lane.run({ invalid: true }, {}, {}), e => e.statusCode === 503 && e.details.code === "BASE_INVALID");
  } finally { clearInterval(timer); await lane.close(); }
});


test("unverified termination closes admission and cannot spawn a replacement", async () => {
  const worker = new FakeWorker(); let created = 0;
  worker.terminate = async () => { throw new Error("termination failed"); };
  const lane = createLane({ createWorker: () => { created += 1; return worker; } });
  const active = assert.rejects(lane.run(1, 2, 3), e => e.statusCode === 503);
  const queued = assert.rejects(lane.run(4, 5, 6), e => e.details.reason === "termination-unverified");
  worker.emit("error", new Error("worker failed"));
  await Promise.all([active, queued]);
  await assert.rejects(lane.run(7, 8, 9), e => e.details.reason === "closed");
  assert.equal(created, 1); await lane.close();
});

function declaration(name, next) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.lastIndexOf("\n", source.indexOf(`function ${next}(`, start));
  assert.ok(start >= 0 && end > start, `missing ${name}`);
  return source.slice(start, end);
}

function confirmedBaseFixture({ legacyClone = false, rejectConservation = false, rejectCommitment = false } = {}) {
  const tokenId = "a".repeat(64), blockHash = "b".repeat(64);
  const definition = {
    amountStorageModel: "q16", decimals: 16, maxSupplySubatoms: "1000",
    mintAmountSubatoms: "10", precisionModel: "precision-v2",
    registryAddress: "registry", ticker: "WORK", tokenId, unitScale: "10000000000000000",
  };
  const commitment = { model: "canonical-work-amo-payload-sha256-v1", payloadBytes: 7, sha256: "c".repeat(64) };
  const event = (digit) => ({
    confirmed: true, txid: digit.repeat(64), tokenId, network: "livenet",
    blockHash, blockHeight: 9, blockIndex: 1, protocolVout: 0, recordOrdinal: 0,
    evidence: { nested: [{ label: "original", omitted: undefined }] },
    pendingEvidence: { ignored: true },
  });
  const listing = (digit, closed = false) => ({
    ...event(digit), listingId: digit.repeat(64), registryAddress: "registry",
    sellerAddress: "seller", listingAuthorization: { version: "v8", proof: { field: "bound" } },
    frozenTerms: { terms: ["exact"] },
    ...(closed ? { closedConfirmed: true, closedTxid: "f".repeat(64), closedBlockHash: blockHash,
      closedBlockHeight: 10, closedBlockIndex: 0, closedProtocolVout: 1, closedRecordOrdinal: 0 } : {}),
  });
  const payload = {
    source: "proof-indexer-token-state-tables", network: "livenet",
    indexedThroughBlock: 10, indexedThroughBlockHash: blockHash,
    tokens: [structuredClone(definition)],
    holders: [{ tokenId, address: "holder", balanceSubatoms: "10", amountStorageModel: "q16", precisionModel: "precision-v2" }],
    mints: [event("1")], transfers: [event("2")], invalidEvents: [{ ...event("3"), valid: false }],
    listings: [listing("4")], closedListings: [listing("5", true)], sales: [event("6")],
  };
  const dependencies = {
    proofIndexTokenStateTablesSource: value => value === "proof-indexer-token-state-tables",
    workPrecisionV2CurrentPayloadIsExact: value => value.forceInexact !== true,
    WORK_AMO_V8_ACTIVATION_HEIGHT: 1, WORK_SUBATOM_PROJECTION_MODEL: "q16",
    WORK_PRECISION_V2_MODEL: "precision-v2", WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS: "registry",
    WORK_TOKEN_TICKER: "WORK", WORK_TOKEN_ID: tokenId, WORK_TOKEN_MAX_SUPPLY_SUBATOMS: 1000n,
    WORK_SUBATOM_DECIMALS: 16, WORK_SUBATOM_UNIT_SCALE_TEXT: definition.unitScale,
    WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL: commitment.model,
    TOKEN_SALE_AUTH_WORK_AMO_V8_VERSION: "v8", PENDING_WORK_STAGE_SEAL_FIELDS: [], PENDING_WORK_STAGE_CLOSE_FIELDS: [],
    isWorkTokenId: value => value === tokenId,
    canonicalWorkTokenDefinition: () => structuredClone(definition),
    canonicalWorkSubatomsText: value => /^\d+$/u.test(String(value)) ? String(value) : "",
    isValidBitcoinAddress: value => typeof value === "string" && value.length > 0,
    workBalanceFieldsFromSubatoms: value => ({ balance: String(value), balanceSubatoms: String(value) }),
    formatWorkSubatoms: value => String(value), compareCanonicalUtf8: (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)),
    canonicalVerifierItemPosition: (value, fields) => ({
      blockHash: value[fields.blockHashField ?? "blockHash"],
      blockHeight: value[fields.blockHeightField ?? "blockHeight"],
      blockIndex: value[fields.blockIndexField ?? "blockIndex"],
      protocolVout: value[fields.protocolVoutField ?? "protocolVout"],
      recordOrdinal: value[fields.recordOrdinalField ?? "recordOrdinal"],
    }),
    pendingWorkVerifierStageError: stageError, errorSummary: error => error.message,
    pendingWorkVerifierStageCollapseExactLegacyInvalidSibling: values => values,
    pendingWorkVerifierStageDeleteFields: (value, fields) => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))),
    pendingWorkVerifierStageCanonicalCutoverRelic: () => false,
    pendingWorkVerifierStageCanonicalOutpointClose: () => null,
    tokenSaleAuthorizationDraft: value => value,
    validateWorkAmoV8StaticAuthorization: authorization => ({ valid: true, authorization }),
    pendingWorkVerifierStageConfirmedV8Listing: value => value,
    tokenTablePayloadHasConservedBalances: () => !rejectConservation,
    workAmoV8CanonicalTokenStateCommitment: () => {
      if (rejectCommitment) throw new Error("invalid V8 state");
      return commitment;
    },
    workAmoV5CanonicalPayloadCommitment,
  };
  let base = declaration("pendingWorkVerifierStageConfirmedBase", "pendingWorkVerifierStageCoreAuthority");
  if (legacyClone) {
    base = base.replace("const state = {", "const state = pendingWorkVerifierStageJsonClone({")
      .replace("unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,\n  };", "unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,\n  });");
  }
  const helpers = [
    declaration("pendingWorkVerifierStageJsonClone", "pendingWorkVerifierStageWithoutPendingFields"),
    declaration("pendingWorkVerifierStageWithoutPendingFields", "pendingWorkVerifierStageConfirmedItem"),
    declaration("pendingWorkVerifierStageConfirmedItem", "pendingWorkVerifierStageCanonicalOutpointClose"),
    declaration("pendingWorkVerifierStageSortUniqueItems", "pendingWorkVerifierStageCollapseExactLegacyInvalidSibling"),
    declaration("pendingWorkVerifierStageConfirmedListing", "pendingWorkVerifierStageConfirmedTransitionCommitment"),
  ].join("\n");
  const validate = new Function(...Object.keys(dependencies), `${helpers}\n${base}\nreturn pendingWorkVerifierStageConfirmedBase;`)(...Object.values(dependencies));
  return { payload, tip: { height: 10, blockHash }, commitment, validate };
}

function objectIdentities(value, found = new Set()) {
  if (!value || typeof value !== "object" || found.has(value)) return found;
  found.add(value);
  for (const child of Object.values(value)) objectIdentities(child, found);
  return found;
}

test("confirmed-base assembly retains exact legacy state and commitment bytes without input aliases", () => {
  const current = confirmedBaseFixture(), previous = confirmedBaseFixture({ legacyClone: true });
  const result = current.validate(current.payload, current.tip, current.commitment);
  const legacy = previous.validate(previous.payload, previous.tip, previous.commitment);
  assert.deepEqual(result, legacy);
  assert.equal(JSON.stringify(result.state), JSON.stringify(legacy.state));
  const inputs = objectIdentities(current.payload);
  for (const value of objectIdentities(result.state)) assert.equal(inputs.has(value), false, "confirmed state aliases an input object");
});

test("confirmed-base event, listing, holder and definition objects remain detached in both directions", () => {
  const fixture = confirmedBaseFixture();
  const result = fixture.validate(fixture.payload, fixture.tip, fixture.commitment);
  const original = structuredClone(fixture.payload);
  for (const name of ["mints", "transfers", "invalidEvents", "listings", "closedListings", "sales"]) {
    result.state[name][0].evidence.nested[0].label = "output-only";
    fixture.payload[name][0].evidence.nested.push({ label: "input-only" });
    assert.equal(result.state[name][0].evidence.nested.length, 1);
    assert.equal(fixture.payload[name][0].evidence.nested[0].label, "original");
  }
  result.state.listings[0].listingAuthorization.proof.field = "output-only";
  assert.equal(fixture.payload.listings[0].listingAuthorization.proof.field, "bound");
  fixture.payload.closedListings[0].frozenTerms.terms.push("input-only");
  assert.deepEqual(result.state.closedListings[0].frozenTerms.terms, ["exact"]);
  result.state.holders[0].address = "output-only";
  result.state.tokens[0].ticker = "output-only";
  assert.equal(fixture.payload.holders[0].address, original.holders[0].address);
  assert.equal(fixture.payload.tokens[0].ticker, original.tokens[0].ticker);
});

test("removing the redundant clone preserves exact position, duplicate, conservation and commitment refusals", () => {
  for (const mutate of [
    value => { value.forceInexact = true; },
    value => { value.mints[0].blockHash = "invalid"; },
    value => { value.mints.push(structuredClone(value.mints[0])); },
    value => { value.holders[0].balanceSubatoms = "0"; },
  ]) {
    const fixture = confirmedBaseFixture(); mutate(fixture.payload);
    assert.throws(() => fixture.validate(fixture.payload, fixture.tip, fixture.commitment), error => error.statusCode === 503);
  }
  for (const options of [{ rejectConservation: true }, { rejectCommitment: true }]) {
    const fixture = confirmedBaseFixture(options);
    assert.throws(() => fixture.validate(fixture.payload, fixture.tip, fixture.commitment), error => error.statusCode === 503);
  }
});
