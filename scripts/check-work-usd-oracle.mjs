import assert from "node:assert/strict";
import {
  WORK_USD_ATTESTATION_MODEL,
  WORK_USD_ORACLE_FRESHNESS_WINDOW_MS,
  WORK_USD_ORACLE_MAX_SPREAD_BPS,
  WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS,
  WORK_USD_ORACLE_MINIMUM_SOURCES,
  WORK_USD_ORACLE_SOURCE_IDS,
  WorkUsdOracleError,
  buildSignedWorkUsdAttestation,
  buildWorkUsdConsensus,
  canonicalWorkUsdAttestationPreimage,
  createWorkUsdSourceAdapters,
  deriveWorkUsdOracleIdentity,
  fetchWorkUsdSourceObservations,
  parseUsdPer100mProofsQ8,
  verifyWorkUsdAttestation,
  workUsdSourceSetSha256,
} from "../server/work-usd-oracle.mjs";

const issuedAtUnixMs = 1_800_000_000_000;
const declarationTxid = "ab".repeat(32);
const referenceBlockHash = "cd".repeat(32);
const privateKey = Buffer.from("01".padStart(64, "0"), "hex");
const wrongPrivateKey = Buffer.from("02".padStart(64, "0"), "hex");
const auxRand = Buffer.alloc(32, 7);
const sourceDecimals = Object.freeze({
  bitfinex: "100000.12500000",
  bitflyer: "100020.00",
  coinbase: "100010.5",
  gemini: "99990.75",
  kraken: "100030",
});

function expectCode(code, action) {
  assert.throws(
    action,
    (error) =>
      error instanceof WorkUsdOracleError &&
      error.code === code,
    `expected ${code}`,
  );
}

function observation(
  sourceId,
  decimal,
  observedAtUnixMs = issuedAtUnixMs - 1_000,
) {
  return {
    sourceId,
    usdPer100mProofsQ8: parseUsdPer100mProofsQ8(decimal),
    observedAtUnixMs,
  };
}

assert.equal(parseUsdPer100mProofsQ8("1"), "100000000");
assert.equal(parseUsdPer100mProofsQ8("00001.2"), "120000000");
assert.equal(parseUsdPer100mProofsQ8("63883.12345678"), "6388312345678");
assert.equal(
  parseUsdPer100mProofsQ8("63883.1234567800"),
  "6388312345678",
);
expectCode("work-usd-decimal", () => parseUsdPer100mProofsQ8("0"));
expectCode("work-usd-decimal", () => parseUsdPer100mProofsQ8("-1"));
expectCode("work-usd-decimal", () => parseUsdPer100mProofsQ8("1e5"));
expectCode("work-usd-decimal-precision", () =>
  parseUsdPer100mProofsQ8("1.000000001"),
);

const adapters = createWorkUsdSourceAdapters({
  coinbase: { url: "https://configured.invalid/coinbase" },
});
assert.deepEqual(
  adapters.map((adapter) => adapter.sourceId),
  WORK_USD_ORACLE_SOURCE_IDS,
);
assert.equal(adapters[2].url, "https://configured.invalid/coinbase");

const fixtureBodies = Object.freeze({
  bitfinex: "[1,2,3,4,5,6,100000.12500000,8,9,10]",
  bitflyer: '{"product_code":"BTC_USD","ltp":100020.00}',
  coinbase: '{"data":{"base":"BTC","currency":"USD","amount":"100010.5"}}',
  gemini: '{"bid":"99980","ask":"100000","last":"99990.75"}',
  kraken:
    '{"error":[],"result":{"XXBTZUSD":{"a":["1"],"c":["100030","1"]}}}',
});
let fetchCalls = 0;
const fetched = await fetchWorkUsdSourceObservations({
  adapters: createWorkUsdSourceAdapters(),
  fetchImpl: async (url, options) => {
    fetchCalls += 1;
    assert.equal(options.redirect, "error");
    const adapter = adapters.find((candidate) =>
      url.includes(candidate.sourceId),
    );
    const sourceId =
      adapter?.sourceId ??
      (url.includes("bitfinex")
        ? "bitfinex"
        : url.includes("bitflyer")
          ? "bitflyer"
          : url.includes("coinbase")
            ? "coinbase"
            : url.includes("gemini")
              ? "gemini"
              : "kraken");
    return {
      ok: true,
      text: async () => fixtureBodies[sourceId],
    };
  },
  nowUnixMs: () => issuedAtUnixMs,
});
assert.equal(fetchCalls, 5);
assert.equal(fetched.failures.length, 0);
assert.deepEqual(
  Object.fromEntries(
    fetched.observations.map((item) => [
      item.sourceId,
      item.usdPer100mProofsQ8,
    ]),
  ),
  Object.fromEntries(
    Object.entries(sourceDecimals).map(([sourceId, decimal]) => [
      sourceId,
      parseUsdPer100mProofsQ8(decimal),
    ]),
  ),
);

const oversized = await fetchWorkUsdSourceObservations({
  adapters: createWorkUsdSourceAdapters(),
  fetchImpl: async () =>
    new Response("0".repeat(65_537), {
      status: 200,
    }),
  nowUnixMs: () => issuedAtUnixMs,
});
assert.equal(oversized.observations.length, 0);
assert.equal(oversized.failures.length, 5);
assert.ok(
  oversized.failures.every(
    (failure) => failure.code === "work-usd-source-size",
  ),
);

const injected = await fetchWorkUsdSourceObservations({
  pollAdapter: async (adapter) => {
    if (adapter.sourceId === "bitflyer") {
      throw new Error("offline");
    }
    return {
      decimal: sourceDecimals[adapter.sourceId],
      observedAtUnixMs: issuedAtUnixMs,
      privateKey: "must-not-escape",
    };
  },
  fetchImpl: () => {
    throw new Error("fetch must not run under injected poller");
  },
  nowUnixMs: () => {
    throw new Error("injected observation time must be used");
  },
});
assert.equal(injected.observations.length, 4);
assert.equal(injected.failures.length, 1);
assert.equal(injected.failures[0].sourceId, "bitflyer");
assert.equal(JSON.stringify(injected).includes("must-not-escape"), false);

const fiveObservations = Object.entries(sourceDecimals).map(
  ([sourceId, decimal]) => observation(sourceId, decimal),
);
const consensus = buildWorkUsdConsensus({
  observations: [...fiveObservations].reverse(),
  issuedAtUnixMs,
});
assert.deepEqual(
  consensus.sources.map((source) => source.sourceId),
  WORK_USD_ORACLE_SOURCE_IDS,
);
assert.equal(
  consensus.usdPer100mProofsQ8,
  parseUsdPer100mProofsQ8("100010.5"),
);
assert.equal(
  consensus.sourceSetSha256,
  workUsdSourceSetSha256(consensus.sources),
);

const evenConsensus = buildWorkUsdConsensus({
  observations: [
    observation("bitfinex", "100"),
    observation("bitflyer", "100.5"),
    observation("coinbase", "101"),
    observation("gemini", "101.5"),
  ],
  issuedAtUnixMs,
});
assert.equal(
  evenConsensus.usdPer100mProofsQ8,
  "10075000000",
  "even median must floor the exact integer midpoint",
);

expectCode("work-usd-quorum", () =>
  buildWorkUsdConsensus({
    observations: [
      observation("bitfinex", "100"),
      observation("bitflyer", "101"),
    ],
    issuedAtUnixMs,
  }),
);
expectCode("work-usd-quorum", () =>
  buildWorkUsdConsensus({
    observations: [
      observation("bitfinex", "100"),
      observation(
        "bitflyer",
        "101",
        issuedAtUnixMs -
          WORK_USD_ORACLE_FRESHNESS_WINDOW_MS -
          1,
      ),
      observation("coinbase", "102"),
    ],
    issuedAtUnixMs,
  }),
);
expectCode("work-usd-source-duplicate", () =>
  buildWorkUsdConsensus({
    observations: [
      observation("bitfinex", "100"),
      observation("bitfinex", "101"),
      observation("coinbase", "102"),
    ],
    issuedAtUnixMs,
  }),
);
expectCode("work-usd-spread", () =>
  buildWorkUsdConsensus({
    observations: [
      observation("bitfinex", "100"),
      observation("bitflyer", "100"),
      observation("coinbase", "200"),
    ],
    issuedAtUnixMs,
  }),
);

const identity = deriveWorkUsdOracleIdentity(privateKey);
assert.equal(identity.publicKey.length, 64);
assert.equal(identity.oracleKeyId.length, 64);
assert.equal("privateKey" in identity, false);
assert.equal(JSON.stringify(identity).includes(privateKey.toString("hex")), false);

const attestation = buildSignedWorkUsdAttestation({
  consensus,
  network: "livenet",
  declarationTxid,
  referenceBlockHeight: 1_000,
  referenceBlockHash,
  validThroughHeight: 1_012,
  privateKey,
  auxRand,
});
assert.equal(attestation.model, WORK_USD_ATTESTATION_MODEL);
assert.equal(attestation.oracleKeyId, identity.oracleKeyId);
assert.equal(attestation.publicKey, identity.publicKey);
assert.equal(attestation.referenceBlockHeight, 1_000);
assert.equal(attestation.validFromHeight, 1_001);
assert.equal(attestation.validThroughHeight, 1_012);
assert.equal(attestation.maxValidityBlocks, WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS);
assert.equal(attestation.signature.length, 128);
assert.equal(attestation.attestationId.length, 64);
assert.equal(
  JSON.stringify(attestation).includes(privateKey.toString("hex")),
  false,
);
assert.equal(
  canonicalWorkUsdAttestationPreimage(attestation).includes(
    Buffer.from(attestation.signature, "utf8"),
  ),
  false,
);

const verifyOptions = {
  expectedNetwork: "livenet",
  expectedDeclarationTxid: declarationTxid,
  expectedOracleKeyId: identity.oracleKeyId,
  expectedPublicKey: identity.publicKey,
  expectedModel: WORK_USD_ATTESTATION_MODEL,
  expectedFreshnessWindowMs: WORK_USD_ORACLE_FRESHNESS_WINDOW_MS,
  expectedMaxSpreadBps: WORK_USD_ORACLE_MAX_SPREAD_BPS,
  expectedMinimumSources: WORK_USD_ORACLE_MINIMUM_SOURCES,
  expectedMaxValidityBlocks: WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS,
  blockHeight: 1_001,
  expectedReferenceBlockHeight: 1_000,
  expectedReferenceBlockHash: referenceBlockHash,
};
const verified = verifyWorkUsdAttestation(attestation, verifyOptions);
assert.equal(verified.valid, true);
assert.equal(verified.attestationId, attestation.attestationId);
assert.equal(
  verified.usdPer100mProofsQ8,
  consensus.usdPer100mProofsQ8,
);

const tamperedPrice = {
  ...attestation,
  usdPer100mProofsQ8: (
    BigInt(attestation.usdPer100mProofsQ8) + 1n
  ).toString(),
};
expectCode("work-usd-consensus", () =>
  verifyWorkUsdAttestation(tamperedPrice, verifyOptions),
);
const tamperedSource = {
  ...attestation,
  sources: attestation.sources.map((source, index) =>
    index === 0
      ? {
          ...source,
          usdPer100mProofsQ8: (
            BigInt(source.usdPer100mProofsQ8) + 1n
          ).toString(),
        }
      : source,
  ),
};
expectCode("work-usd-consensus", () =>
  verifyWorkUsdAttestation(tamperedSource, verifyOptions),
);
const tamperedAnchor = {
  ...attestation,
  referenceBlockHash: "ef".repeat(32),
};
expectCode("work-usd-anchor", () =>
  verifyWorkUsdAttestation(tamperedAnchor, verifyOptions),
);
const tamperedSignature = {
  ...attestation,
  signature: `${attestation.signature.slice(0, -2)}00`,
};
expectCode("work-usd-signature", () =>
  verifyWorkUsdAttestation(tamperedSignature, verifyOptions),
);

const wrongIdentity = deriveWorkUsdOracleIdentity(wrongPrivateKey);
expectCode("work-usd-key-id", () =>
  verifyWorkUsdAttestation(attestation, {
    ...verifyOptions,
    expectedPublicKey: wrongIdentity.publicKey,
  }),
);
expectCode("work-usd-validity", () =>
  verifyWorkUsdAttestation(attestation, {
    ...verifyOptions,
    blockHeight: 1_013,
  }),
);
expectCode("work-usd-validity", () =>
  buildSignedWorkUsdAttestation({
    consensus,
    network: "livenet",
    declarationTxid,
    referenceBlockHeight: 1_000,
    referenceBlockHash,
    validThroughHeight: 1_013,
    privateKey,
    auxRand,
  }),
);

console.log("WORK USD oracle checks passed");
