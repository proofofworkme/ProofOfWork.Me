import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkAmoV6Attestor,
  readWorkAmoV6OraclePrivateKeyFile,
} from "../server/work-amo-v6-attestor.mjs";
import {
  WORK_USD_ORACLE_SOURCE_IDS,
  createWorkUsdSourceAdapters,
} from "../server/work-usd-oracle.mjs";

const privateKey = "01".repeat(32);
const declarationTxid = "11".repeat(32);
const referenceBlockHash = "22".repeat(32);
const replacedBlockHash = "33".repeat(32);
const referenceBlockHeight = 1_000_000;
let now = 1_785_585_600_000;

const adapters = createWorkUsdSourceAdapters(
  Object.fromEntries(
    WORK_USD_ORACLE_SOURCE_IDS.map((sourceId) => [
      sourceId,
      {
        parseBody: (body) => String(body).trim(),
        url: `mock://${sourceId}`,
      },
    ]),
  ),
);

function sourceIdFromUrl(url) {
  const sourceId = String(url).replace(/^mock:\/\//u, "");
  assert.ok(WORK_USD_ORACLE_SOURCE_IDS.includes(sourceId));
  return sourceId;
}

function mockFetch({
  calls,
  failing = () => false,
} = {}) {
  return async (url) => {
    const sourceId = sourceIdFromUrl(url);
    calls.push(sourceId);
    if (failing(sourceId)) {
      throw new Error(`mock ${sourceId} unavailable`);
    }
    const sourceIndex =
      WORK_USD_ORACLE_SOURCE_IDS.indexOf(sourceId);
    return {
      ok: true,
      async text() {
        return String(60_000 + sourceIndex);
      },
    };
  };
}

const capturedConsole = [];
const originalConsole = {
  error: console.error,
  info: console.info,
  log: console.log,
  warn: console.warn,
};
for (const method of Object.keys(originalConsole)) {
  console[method] = (...values) => {
    capturedConsole.push(
      values.map((value) => String(value)).join(" "),
    );
  };
}

let cachedAttestor;
let advancingClockAttestor;
let staleAttestor;
let reorgAttestor;
let exhaustedWindowAttestor;
let cacheResult;
let staleFailure;
let reorgFailure;
let exhaustedWindowFailure;
let credentialDirectory;
try {
  credentialDirectory = await mkdtemp(
    join(tmpdir(), "work-amo-v6-attestor-"),
  );
  const credentialPath = join(
    credentialDirectory,
    "oracle-key",
  );
  await writeFile(credentialPath, `${privateKey}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const credentialBytes =
    await readWorkAmoV6OraclePrivateKeyFile(credentialPath);
  const cacheCalls = [];
  cachedAttestor = createWorkAmoV6Attestor({
    adapters,
    declarationTxid,
    fetchImpl: mockFetch({ calls: cacheCalls }),
    getCanonicalBlockHash: async () =>
      referenceBlockHash,
    getCanonicalTip: async () => ({
      hash: referenceBlockHash,
      height: referenceBlockHeight,
    }),
    nowUnixMs: () => now,
    privateKey: credentialBytes,
  });
  credentialBytes.fill(0);
  const first = await cachedAttestor.attestation();
  const second = await cachedAttestor.attestation();
  assert.strictEqual(
    second,
    first,
    "a reusable quote must be returned from the in-memory cache",
  );
  assert.equal(cacheCalls.length, 5);
  assert.deepEqual(
    cacheCalls.sort(),
    [...WORK_USD_ORACLE_SOURCE_IDS],
  );
  cacheResult = {
    attestation: first.attestation,
    identity: cachedAttestor.identity,
    policy: cachedAttestor.policy,
  };

  let advancingNow = now;
  const advancingClockCalls = [];
  advancingClockAttestor = createWorkAmoV6Attestor({
    adapters,
    declarationTxid,
    fetchImpl: mockFetch({
      calls: advancingClockCalls,
    }),
    getCanonicalBlockHash: async () =>
      referenceBlockHash,
    getCanonicalTip: async () => ({
      hash: referenceBlockHash,
      height: referenceBlockHeight,
    }),
    nowUnixMs: () => {
      advancingNow += 1;
      return advancingNow;
    },
    privateKey,
  });
  assert.ok(
    (await advancingClockAttestor.attestation()).attestation
      .attestationId,
    "observations completed after poll start must not be treated as future",
  );
  assert.equal(advancingClockCalls.length, 5);

  let failSources = false;
  const staleCalls = [];
  staleAttestor = createWorkAmoV6Attestor({
    adapters,
    declarationTxid,
    fetchImpl: mockFetch({
      calls: staleCalls,
      failing: (sourceId) =>
        failSources &&
        !["bitfinex", "coinbase"].includes(sourceId),
    }),
    getCanonicalBlockHash: async () =>
      referenceBlockHash,
    getCanonicalTip: async () => ({
      hash: referenceBlockHash,
      height: referenceBlockHeight,
    }),
    nowUnixMs: () => now,
    privateKey,
  });
  const fresh = await staleAttestor.attestation();
  assert.equal(staleCalls.length, 5);
  failSources = true;
  now += 30_001;
  try {
    await staleAttestor.attestation();
    assert.fail(
      "an expired cache with only two sources must not fall back",
    );
  } catch (error) {
    staleFailure = {
      code: String(error?.code ?? ""),
      message: String(error?.message ?? ""),
    };
    assert.equal(error?.code, "work-usd-quorum");
  }
  assert.equal(staleCalls.length, 10);
  assert.ok(fresh.attestation.attestationId);

  const reorgCalls = [];
  reorgAttestor = createWorkAmoV6Attestor({
    adapters,
    declarationTxid,
    fetchImpl: mockFetch({ calls: reorgCalls }),
    getCanonicalBlockHash: async () =>
      replacedBlockHash,
    getCanonicalTip: async () => ({
      hash: referenceBlockHash,
      height: referenceBlockHeight,
    }),
    nowUnixMs: () => now,
    privateKey,
  });
  try {
    await reorgAttestor.attestation();
    assert.fail(
      "a changed reference block must reject attestation issuance",
    );
  } catch (error) {
    reorgFailure = {
      code: String(error?.code ?? ""),
      message: String(error?.message ?? ""),
    };
    assert.equal(
      error?.code,
      "work-amo-v6-attestor-anchor-changed",
    );
  }
  assert.equal(reorgCalls.length, 5);

  let tipCalls = 0;
  const exhaustedWindowCalls = [];
  exhaustedWindowAttestor = createWorkAmoV6Attestor({
    adapters,
    declarationTxid,
    fetchImpl: mockFetch({
      calls: exhaustedWindowCalls,
    }),
    getCanonicalBlockHash: async () =>
      referenceBlockHash,
    getCanonicalTip: async () => {
      tipCalls += 1;
      return {
        hash: referenceBlockHash,
        height:
          tipCalls === 1
            ? referenceBlockHeight
            : referenceBlockHeight + 12,
      };
    },
    nowUnixMs: () => now,
    privateKey,
  });
  try {
    await exhaustedWindowAttestor.attestation();
    assert.fail(
      "an attestation whose next-block window elapsed during polling must fail",
    );
  } catch (error) {
    exhaustedWindowFailure = {
      code: String(error?.code ?? ""),
      message: String(error?.message ?? ""),
    };
    assert.equal(
      error?.code,
      "work-amo-v6-attestor-window-exhausted",
    );
  }
  assert.equal(exhaustedWindowCalls.length, 5);
} finally {
  cachedAttestor?.destroy();
  advancingClockAttestor?.destroy();
  staleAttestor?.destroy();
  reorgAttestor?.destroy();
  exhaustedWindowAttestor?.destroy();
  if (credentialDirectory) {
    await rm(credentialDirectory, {
      force: true,
      recursive: true,
    });
  }
  for (const [method, implementation] of Object.entries(
    originalConsole,
  )) {
    console[method] = implementation;
  }
}

const publicOutput = JSON.stringify({
  cacheResult,
  capturedConsole,
  exhaustedWindowFailure,
  reorgFailure,
  staleFailure,
});
assert.equal(
  publicOutput.includes(privateKey),
  false,
  "the private key must never appear in a response, error, or log",
);
assert.equal(
  capturedConsole.length,
  0,
  "the attestor must not write source or secret diagnostics to stdout/stderr",
);

console.log(
  JSON.stringify(
    {
      cacheReused: true,
      cachedSourcePolls: 5,
      exhaustedWindowFailureCode:
        exhaustedWindowFailure.code,
      noSecretOutput: true,
      quorumFailureCode: staleFailure.code,
      reorgFailureCode: reorgFailure.code,
      staleFallbackRejected: true,
      valid: true,
    },
    null,
    2,
  ),
);
