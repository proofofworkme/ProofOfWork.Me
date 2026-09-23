import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./proof-api.mjs", import.meta.url), "utf8");

function sourceBlock(startText, endText) {
  const start = source.indexOf(startText);
  assert.ok(start >= 0, `source start exists: ${startText}`);
  const end = source.indexOf(endText, start);
  assert.ok(end > start, `source end exists after ${startText}: ${endText}`);
  return source.slice(start, end);
}

const fallbackSource = sourceBlock(
  "async function fetchTransactionWithSourceFallback(",
  "\nfunction transactionLookupUnavailableError(",
);
const lookupUnavailableSource = sourceBlock(
  "function transactionLookupUnavailableError(",
  "\nasync function fetchPendingMailTransactionFromFirstParty(",
);
const definitions = [
  fallbackSource,
  lookupUnavailableSource,
  sourceBlock(
    "function transactionDetailStatusFromCanonical(",
    "\nconst INTERNAL_VERIFIER_STATE_TTL_MS",
  ),
].join("\n");

const txid = "a".repeat(64);
const unavailable = (message = "dependency unavailable") => {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
};

function loadStrictFallback(overrides = {}) {
  const createUnavailableError = vm.runInNewContext(
    `(freshDataUnavailableError, errorSummary) => {\n${lookupUnavailableSource}\nreturn transactionLookupUnavailableError;\n}`,
  );
  const lookupUnavailableError = createUnavailableError(
    unavailable,
    (error) => String(error?.message ?? error),
  );
  const factory = vm.runInNewContext(
    `(deps) => {\nconst fetchTransactionFromBitcoinRpc = deps.fetchTransactionFromBitcoinRpc;\nconst fetchTransactionFromElectrum = deps.fetchTransactionFromElectrum;\nconst fetchTransaction = deps.fetchTransaction;\nconst fetchTransactionFromPendingSources = deps.fetchTransactionFromPendingSources;\nconst transactionLookupUnavailableError = deps.transactionLookupUnavailableError;\n${fallbackSource}\nreturn fetchTransactionWithSourceFallback;\n}`,
  );
  return factory({ ...overrides, transactionLookupUnavailableError: lookupUnavailableError });
}

function loadApi(overrides = {}) {
  const context = vm.createContext({
    Date,
    errorSummary: (error) => String(error?.message ?? error),
    extractProtocolMemo: () => null,
    freshDataUnavailableError: unavailable,
    bitcoinCoreTxStatusPayload: async () => ({ absenceProven: true, status: "dropped" }),
    fetchTransaction: async () => null,
    fetchTransactionFromBitcoinRpc: async () => null,
    fetchTransactionFromElectrum: async () => null,
    fetchTransactionFromPendingSources: async () => null,
    transactionConfirmed: (tx) => tx?.status?.confirmed === true,
  });
  vm.runInContext(
    `${definitions}\nthis.api = { fetchTransactionWithSourceFallback, txPayload };`,
    context,
  );
  for (const [name, replacement] of Object.entries(overrides)) {
    assert.match(name, /^[A-Za-z_$][\w$]*$/u);
    context.__replacement = replacement;
    vm.runInContext(`${name} = __replacement;`, context);
  }
  delete context.__replacement;
  return { api: context.api, context };
}

test("canonical status source failures stay unavailable instead of becoming dropped", async () => {
  const { api } = loadApi({
    bitcoinCoreTxStatusPayload: async () => {
      const error = unavailable("Core timeout");
      error.details = { code: "TX_STATUS_UNAVAILABLE" };
      throw error;
    },
    fetchTransactionWithSourceFallback: async () => {
      assert.fail("transaction bytes must not bypass unavailable canonical status");
    },
  });

  await assert.rejects(
    api.txPayload(txid, "livenet"),
    (error) => error.statusCode === 503 && error.details?.code === "TX_STATUS_UNAVAILABLE",
  );
});

test("livenet true absence returns a dropped detail only with Core absence proof", async () => {
  let contentLookups = 0;
  const { api } = loadApi({
    bitcoinCoreTxStatusPayload: async () => ({
      absenceProven: true,
      confirmed: false,
      status: "dropped",
    }),
    fetchTransactionWithSourceFallback: async () => {
      contentLookups += 1;
      return null;
    },
  });

  const payload = await api.txPayload(txid, "livenet");
  assert.equal(payload.status, "dropped");
  assert.equal(payload.tx, null);
  assert.equal(contentLookups, 0);
});

test("provider not-found cannot imply dropped without Core absence proof", async () => {
  const { api } = loadApi({
    bitcoinCoreTxStatusPayload: async () => null,
    fetchTransactionWithSourceFallback: async () => null,
  });

  await assert.rejects(
    api.txPayload(txid, "testnet"),
    (error) =>
      error.statusCode === 503 &&
      error.details?.code === "TX_DETAIL_UNAVAILABLE",
  );
});

test("fresh pending status replaces a warm cached confirmed status", async () => {
  const staleConfirmed = {
    status: { confirmed: true, block_hash: "old-branch", block_height: 900 },
    txid,
    vout: [],
  };
  let optionsSeen;
  const { api } = loadApi({
    bitcoinCoreTxStatusPayload: async () => ({
      confirmed: false,
      mempoolFirstSeenAt: "2026-09-22T00:00:00.000Z",
      status: "pending",
    }),
    fetchTransactionWithSourceFallback: async (_txid, _network, options) => {
      optionsSeen = options;
      return staleConfirmed;
    },
  });

  const payload = await api.txPayload(txid, "livenet");
  assert.equal(optionsSeen.strictAvailability, true);
  assert.equal(optionsSeen.cacheResult, false);
  assert.equal(payload.confirmed, false);
  assert.equal(payload.status, "pending");
  assert.equal(payload.tx.status.confirmed, false);
  assert.equal(payload.tx.status.mempool_time, Math.floor(Date.parse("2026-09-22T00:00:00.000Z") / 1000));
  assert.equal("block_hash" in payload.tx.status, false);
  assert.equal("block_height" in payload.tx.status, false);
});

test("fresh canonical block replaces an older cached confirmation", async () => {
  const { api } = loadApi({
    bitcoinCoreTxStatusPayload: async () => ({
      blockHash: "new-branch",
      blockHeight: 968202,
      blockTime: "2026-09-22T00:00:00.000Z",
      confirmed: true,
      status: "confirmed",
    }),
    fetchTransactionWithSourceFallback: async () => ({
      status: { confirmed: true, block_hash: "old-branch", block_height: 900 },
      txid,
      vout: [],
    }),
  });

  const payload = await api.txPayload(txid, "livenet");
  assert.equal(payload.confirmed, true);
  assert.equal(payload.tx.status.block_hash, "new-branch");
  assert.equal(payload.tx.status.block_height, 968202);
  assert.equal(payload.tx.status.block_time, Math.floor(Date.parse("2026-09-22T00:00:00.000Z") / 1000));
});

test("strict source fallback returns 503 when every provider times out", async () => {
  const calls = [];
  const timeout = (name) => async (_txid, _network, options) => {
    calls.push({ name, strict: options?.strictAvailability });
    throw new Error(`${name} timeout`);
  };
  const fallback = loadStrictFallback({
    fetchTransaction: timeout("mempool"),
    fetchTransactionFromBitcoinRpc: timeout("core"),
    fetchTransactionFromElectrum: timeout("electrum"),
    fetchTransactionFromPendingSources: timeout("pending"),
  });

  await assert.rejects(
    fallback(txid, "testnet", {
      bypassCache: true,
      cacheResult: false,
      strictAvailability: true,
    }),
    (error) => error.statusCode === 503 && error.details?.code === "TX_DETAIL_UNAVAILABLE",
  );
  assert.deepEqual(calls.map(({ name }) => name), ["core", "electrum", "mempool", "pending"]);
  assert.ok(calls.every(({ strict }) => strict === true));
});

test("strict source fallback preserves true absence when all sources return not found", async () => {
  const fallback = loadStrictFallback({
    fetchTransaction: async () => null,
    fetchTransactionFromBitcoinRpc: async () => null,
    fetchTransactionFromElectrum: async () => null,
    fetchTransactionFromPendingSources: async () => null,
  });

  assert.equal(
    await fallback(txid, "testnet", { strictAvailability: true }),
    null,
  );
});
