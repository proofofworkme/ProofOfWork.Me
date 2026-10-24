import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  createWalletReadCoalescer, walletReadIdentity,
  measurePrivatePhase, withPrivatePhaseTimings,
} from "../server/wallet-read-observation.mjs";

const reader = ts.createSourceFile("reader.mjs", readFileSync("server/db/proof-index-reader.mjs", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const api = ts.createSourceFile("api.mjs", readFileSync("server/proof-api.mjs", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function declaration(ast, name) {
  const nodes = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(nodes.length, 1, name);
  return nodes[0];
}
function source(ast, name) { return declaration(ast, name).getText(ast).replace(/^export\s+/u, ""); }
function functions(ast, names, context) {
  return new vm.Script(`${names.map((name) => source(ast, name)).join("\n")}\n({${names.join(",")}})`).runInContext(context);
}
const HASH = "a".repeat(64);
const plain = (value) => JSON.parse(JSON.stringify(value));
const refusals = ["work-q16-reader-pins-unavailable", "work-q16-readiness-unavailable", "work-q16-payload-inexact", "work-q16-checkpoint-mismatch"];
const overlayNode = declaration(reader, "proofIndexWalletTokenOverlayPayload");
let unavailableCallback;
function findCallback(node) {
  if (ts.isPropertyAssignment(node) && node.name?.getText(reader) === "onUnavailable") {
    assert.equal(unavailableCallback, undefined);
    unavailableCallback = node.initializer.getText(reader);
  }
  ts.forEachChild(node, findCallback);
}
findCallback(overlayNode);
assert.ok(unavailableCallback);

function proofFixture() {
  const warnings = [];
  const snapshotScope = {};
  let failure = "work-q16-readiness-unavailable", audits = 0;
  const payload = { tokens: [{ tokenId: "work", amountStorageModel: "q16" }],
    source: "proof-indexer-wallet-token-overlay", indexedThroughBlock: 100, indexedThroughBlockHash: HASH };
  const context = vm.createContext({
    walletProofReadinessFailures: new WeakSet(),
    walletReadSnapshot: { getStore: () => snapshotScope },
    console: { warn: (value) => warnings.push(JSON.parse(value)) },
    WORK_SUBATOM_PROJECTION_MODEL: "q16",
    configuredWorkPrecisionV2ReaderPins: () => failure === refusals[0] ? null : { activationHeight: 1 },
    proofIndexWorkAmoV8ActivationLatch: async () => ({ reached: true }),
    isWorkTokenId: (value) => value === "work",
    workPrecisionV2ProjectCurrentPayload: (value) => value,
    proofIndexWorkPrecisionV2MigrationReadiness: async () => {
      audits++;
      return { ready: failure !== refusals[1], active: true, evidenceComplete: true,
        parityReady: true, pendingReady: true, replayReady: true,
        tipHeight: failure === refusals[3] ? 101 : 100, tipHash: HASH,
        pendingValidThrough: new Date(Date.now() + 60000).toISOString(), membershipSnapshot: {} };
    },
    workPrecisionV2CanonicalSummaryBootstrapReady: () => false,
    workPrecisionV2CurrentPayloadIsExact: () => failure !== refusals[2],
    normalizedLowerText: (value) => String(value ?? "").toLowerCase(),
  });
  const helpers = functions(reader, ["isProofIndexWalletReadinessUnavailable", "reportWalletTokenOverlayUnavailable", "payloadWithCurrentWorkPrecisionReadPolicy"], context);
  Object.assign(context, helpers);
  const run = async (options = {}) => {
    // Execute the callback wired by the actual overlay, not a copied callback.
    context.options = options; context.scope = "work";
    const onUnavailable = new vm.Script(`(${unavailableCallback})`).runInContext(context);
    return helpers.payloadWithCurrentWorkPrecisionReadPolicy("livenet", payload, {
      onUnavailable, requireExactCheckpoint: true, requireSupplyEnvelope: false,
    });
  };
  return { ...helpers, context, run, payload, warnings, snapshotScope, audits: () => audits,
    fail: (reason) => { failure = reason; } };
}

test("only explicit proof refusals opt into the existing generic wallet 503; diagnostics stay private", async () => {
  for (const reason of refusals) {
    const proof = proofFixture(); proof.fail(reason);
    await assert.rejects(proof.run({ rejectProofReadinessFailure: true }), (error) => {
      assert.equal(proof.isProofIndexWalletReadinessUnavailable(error), true);
      assert.equal(error.statusCode, 503);
      assert.equal(error.message, "Fresh wallet credit state is temporarily unavailable for work.");
      assert.deepEqual(plain(error.details), { code: "CANONICAL_WALLET_INDEX_UNAVAILABLE", requiredSource: "proof-indexer-wallet-token-overlay" });
      assert.doesNotMatch(JSON.stringify(error), /pendingReadiness|checkpoint-mismatch|pins-unavailable|payload-inexact/u);
      return true;
    });
    assert.equal(proof.warnings.length, 1);
    assert.equal(proof.warnings[0].warning, reason);
    assert.equal(proof.warnings[0].event, "wallet-token-overlay-unavailable");
  }
});

test("default readers keep null refusals and public-looking errors cannot forge the private brand", async () => {
  for (const options of [{}, { rejectProofReadinessFailure: false }, { rejectProofReadinessFailure: "true" }]) {
    const proof = proofFixture();
    for (const reason of refusals) { proof.fail(reason); assert.equal(await proof.run(options), null); }
    assert.equal(proof.warnings.length, refusals.length);
  }
  const proof = proofFixture();
  for (const value of [null, undefined, Error("ordinary"), { statusCode: 503, details: { code: "CANONICAL_WALLET_INDEX_UNAVAILABLE" } }]) {
    assert.equal(proof.isProofIndexWalletReadinessUnavailable(value), false);
  }
  assert.doesNotThrow(() => proof.reportWalletTokenOverlayUnavailable({ reason: "wallet-checkpoint-unavailable" }, "work", { rejectProofReadinessFailure: true }));
});

const snapshotUrl = new URL("../server/db/read-only-snapshot.mjs", import.meta.url);
const snapshotModule = existsSync(snapshotUrl) ? await import(snapshotUrl.href) : null;
const hasOwnedSnapshot = source(api, "proofIndexWalletScopedTokenPayloadForRead").includes("proofIndexWithWalletReadSnapshot");
if (process.env.POW_REQUIRE_WALLET_SNAPSHOT_INTEGRATION === "1") {
  assert.ok(snapshotModule && hasOwnedSnapshot, "merged runtime snapshot integration is required");
}

function apiFixture({ ordinary = false, disabled = false, databaseError = false, snapshot = false } = {}) {
  const proof = proofFixture(), calls = { fallback: 0, overlay: 0, snapshots: 0, releases: 0 }, sql = [];
  const errors = [];
  const fallback = Error("ordinary legacy fallback reached");
  const context = vm.createContext({
    console: { error: (value) => errors.push(value), warn() {} },
    isProofIndexWalletReadinessUnavailable: proof.isProofIndexWalletReadinessUnavailable,
    proofIndexReadFeatureEnabled: () => !disabled,
    normalizeTokenScope: (value) => value, WORK_TOKEN_ID: "work", WORK_SUBATOM_PROJECTION_MODEL: "q16",
    WALLET_SCOPED_INDEX_WAIT_MS: 15000,
    WALLET_SCOPED_TOKEN_IN_FLIGHT_MAX_ENTRIES: 4, WALLET_SCOPED_TOKEN_IN_FLIGHT: new Map(),
    walletScopedTokenCacheKey: () => "fixture", cachedWalletScopedTokenPayload: () => null,
    freshDataUnavailableError: (message) => Object.assign(Error(message), { statusCode: 503 }),
    walletScopedWorkPayloadWithQ16Supply: (value) => value, workQ16PayloadWithoutOrphanPriceAliases: (value) => value,
    walletScopedPayloadUsesAuthoritativeOverlay: () => true,
    walletScopedPayloadWithIndexedEnrichment: async (value) => value,
    rememberWalletScopedTokenPayload: (_key, value) => value,
    currentProofIndexTokenPayloadForRead: async () => { calls.fallback++; throw fallback; },
    tokenPayloadForRead: async () => { calls.fallback++; throw fallback; },
    TOKEN_ADDRESS_HINT_LIVE_WAIT_MS: 100, WORK_TOKEN_LIVE_RECOVERY_WAIT_MS: 100,
    proofIndexWalletTokenOverlayPayload: async (_network, _scope, _addresses, options) => {
      calls.overlay++;
      assert.equal(options.rejectProofReadinessFailure, true);
      if (databaseError) throw Error("ordinary database failure");
      if (ordinary) return null;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return proof.run(options);
    },
    walletTokenOverlayHasExactCheckpoint: () => true,
    walletOverlayWithCanonicalWorkSupply: async (value) => value,
    walletScopedTokenPayloadFromOverlay: (value) => value,
    walletTokenPayloadMissingDefinitions: () => [], walletPayloadWithCanonicalWorkCapacities: async (value) => value,
    errorSummary: (error) => `${error.name}: ${error.message}`,
    coalesceWalletRead: createWalletReadCoalescer({ observer: () => {} }), walletReadIdentity,
    measurePrivatePhase, withPrivatePhaseTimings: (run) => withPrivatePhaseTimings(run, () => {}),
    isWorkTokenId: (value) => value === "work", privateReadContext: () => ({}),
    isReadOnlySnapshotBudgetError: (error) => snapshotModule?.isReadOnlySnapshotBudgetError(error) === true,
    proofIndexWithWalletReadSnapshot: async (run, options) => {
      calls.snapshots++;
      delete proof.snapshotScope.pendingReadiness;
      if (!snapshot) return run();
      const pool = { connect: async () => ({
        query: async (text) => { sql.push(text); return { rows: [] }; },
        release: () => { calls.releases++; },
      }) };
      return snapshotModule.withReadOnlySnapshot(pool, run, options);
    },
    proofIndexWalletReadSnapshotPendingProof: () => proof.snapshotScope.pendingReadiness ?? null,
    bitcoinRpc: async () => ({ ok: true, result: [] }), workQ16PendingMembershipSnapshotReady: () => true,
    canonicalPublicReadGate: async () => ({}), walletTokenOverlayMatchesCanonicalFreshGate: () => true,
  });
  const helpers = functions(api, ["walletScopedTokenSingleFlight", "proofIndexWalletScopedTokenPayloadForRead", "walletScopedTokenPayload"], context);
  Object.assign(context, helpers);
  return { proof, calls, sql, fallback, errors,
    read: (network = "livenet") => helpers.walletScopedTokenPayload(network, "work", ["account"], { requireCurrent: false }),
    direct: () => helpers.proofIndexWalletScopedTokenPayloadForRead("livenet", "work", ["account"], "test", {}),
  };
}

test("a cached-mode wallet stops after one failed canonical proof and the next request audits afresh", async () => {
  const fixture = apiFixture();
  await assert.rejects(fixture.read(), (error) => fixture.proof.isProofIndexWalletReadinessUnavailable(error));
  assert.equal(fixture.calls.fallback, 0); assert.equal(fixture.calls.overlay, 1); assert.equal(fixture.proof.audits(), 1);
  fixture.proof.fail(null);
  assert.equal((await fixture.read()).authoritativeWallet, true, fixture.errors.join("\n"));
  assert.equal(fixture.errors.length, 0);
  assert.equal(fixture.calls.overlay, 2); assert.equal(fixture.proof.audits(), 2);
});

test("ordinary missing data, database errors, disabled readers and other networks retain fallback", async () => {
  for (const [options, network, overlays] of [
    [{ ordinary: true }, "livenet", 1], [{ databaseError: true }, "livenet", 1],
    [{ disabled: true }, "livenet", 0], [{}, "testnet", 0],
  ]) {
    const fixture = apiFixture(options);
    await assert.rejects(fixture.read(network), (error) => error === fixture.fallback);
    assert.equal(fixture.calls.fallback, 1); assert.equal(fixture.calls.overlay, overlays);
  }
});

test("merged owned snapshot rolls back a branded refusal for all joiners and cleans up for a fresh retry", {
  skip: !(snapshotModule && hasOwnedSnapshot),
}, async () => {
  const fixture = apiFixture({ snapshot: true });
  const results = await Promise.allSettled([fixture.direct(), fixture.direct(), fixture.direct()]);
  assert.ok(results.every((result) => result.status === "rejected" && fixture.proof.isProofIndexWalletReadinessUnavailable(result.reason)));
  assert.equal(results[0].reason, results[1].reason);
  assert.equal(fixture.calls.overlay, 1); assert.equal(fixture.calls.snapshots, 1); assert.equal(fixture.calls.releases, 1);
  assert.equal(fixture.sql.filter((text) => text === "ROLLBACK").length, 1);
  assert.equal(fixture.sql.filter((text) => text === "COMMIT").length, 0);
  assert.equal(fixture.calls.fallback, 0);
  fixture.proof.fail(null);
  assert.ok(await fixture.direct(), fixture.errors.join("\n"));
  assert.equal(fixture.errors.length, 0);
  assert.equal(fixture.calls.overlay, 2); assert.equal(fixture.calls.snapshots, 2); assert.equal(fixture.calls.releases, 2);
  assert.equal(fixture.sql.filter((text) => text === "COMMIT").length, 1);
});
