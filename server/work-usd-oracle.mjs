import { createHash, randomBytes } from "node:crypto";
import * as ecc from "@bitcoinerlab/secp256k1";

export const WORK_USD_ATTESTATION_VERSION = "pwa-inline-v1";
export const WORK_USD_ATTESTATION_MODEL =
  "canonical-work-usd-five-source-median-q8-v1";
export const WORK_USD_ATTESTATION_DOMAIN =
  "ProofOfWork.Me/WORK-USD-ATTESTATION/v1";
export const WORK_USD_SOURCE_SET_DOMAIN =
  "ProofOfWork.Me/WORK-USD-SOURCE-SET/v1";
export const WORK_USD_ORACLE_KEY_ID_DOMAIN =
  "ProofOfWork.Me/WORK-USD-ORACLE-KEY/v1";

export const WORK_USD_Q8_SCALE = 100_000_000n;
export const WORK_USD_ORACLE_MINIMUM_SOURCES = 3;
export const WORK_USD_ORACLE_FRESHNESS_WINDOW_MS = 120_000;
export const WORK_USD_ORACLE_MAX_SPREAD_BPS = 200;
export const WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS = 12;

export const WORK_USD_ORACLE_SOURCE_IDS = Object.freeze([
  "bitfinex",
  "bitflyer",
  "coinbase",
  "gemini",
  "kraken",
]);

const HEX_32_RE = /^[0-9a-f]{64}$/u;
const HEX_64_RE = /^[0-9a-f]{128}$/u;
const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/u;
const NETWORK_RE = /^[a-z][a-z0-9-]{0,31}$/u;
const POSITIVE_INTEGER_RE = /^[1-9][0-9]*$/u;
const DECIMAL_RE = /^[0-9]+(?:\.[0-9]+)?$/u;
const BASIS_POINT_SCALE = 10_000n;
const MAX_SOURCE_RESPONSE_BYTES = 65_536;

const SOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({
    sourceId: "bitfinex",
    url: "https://api-pub.bitfinex.com/v2/ticker/tBTCUSD",
    parseBody: (body) => jsonTopLevelArrayScalar(body, 6, "bitfinex"),
  }),
  Object.freeze({
    sourceId: "bitflyer",
    url: "https://api.bitflyer.com/v1/getticker?product_code=BTC_USD",
    parseBody: (body) => jsonPropertyScalar(body, "ltp", "bitflyer"),
  }),
  Object.freeze({
    sourceId: "coinbase",
    url: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
    parseBody: (body) => jsonPropertyScalar(body, "amount", "coinbase"),
  }),
  Object.freeze({
    sourceId: "gemini",
    url: "https://api.gemini.com/v1/pubticker/btcusd",
    parseBody: (body) => jsonPropertyScalar(body, "last", "gemini"),
  }),
  Object.freeze({
    sourceId: "kraken",
    url: "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
    parseBody: (body) => jsonArrayPropertyFirstScalar(body, "c", "kraken"),
  }),
]);

const SOURCE_KEYS = Object.freeze([
  "sourceId",
  "usdPer100mProofsQ8",
  "observedAtUnixMs",
]);

const ATTESTATION_KEYS = Object.freeze([
  "version",
  "model",
  "network",
  "declarationTxid",
  "oracleKeyId",
  "publicKey",
  "referenceBlockHeight",
  "referenceBlockHash",
  "validFromHeight",
  "validThroughHeight",
  "issuedAtUnixMs",
  "freshnessWindowMs",
  "maxSpreadBps",
  "minimumSources",
  "maxValidityBlocks",
  "usdPer100mProofsQ8",
  "sources",
  "sourceSetSha256",
  "attestationId",
  "signature",
]);

export class WorkUsdOracleError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "WorkUsdOracleError";
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new WorkUsdOracleError(code, message, options);
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

function sha256Hex(value) {
  return sha256(value).toString("hex");
}

function compareUtf8(left, right) {
  return Buffer.compare(
    Buffer.from(String(left), "utf8"),
    Buffer.from(String(right), "utf8"),
  );
}

function exactObject(value, expectedKeys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail("work-usd-shape", `${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...expectedKeys].sort(compareUtf8);
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      "work-usd-shape",
      `${label} must contain exactly: ${expectedKeys.join(", ")}`,
    );
  }
  return value;
}

function safeInteger(value, label, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(
      "work-usd-integer",
      `${label} must be a safe integer greater than or equal to ${minimum}`,
    );
  }
  return value;
}

function positiveInteger(value, label) {
  return safeInteger(value, label, { minimum: 1 });
}

function lowercaseHex(value, pattern, label) {
  const normalized = String(value ?? "");
  if (!pattern.test(normalized)) {
    fail("work-usd-hex", `${label} must be canonical lowercase hex`);
  }
  return normalized;
}

function positiveQ8String(value, label = "usdPer100mProofsQ8") {
  const normalized = String(value ?? "");
  if (
    normalized.length > 64 ||
    !POSITIVE_INTEGER_RE.test(normalized)
  ) {
    fail(
      "work-usd-q8",
      `${label} must be a positive canonical integer string`,
    );
  }
  return normalized;
}

function sourceId(value) {
  const normalized = String(value ?? "");
  if (!SOURCE_ID_RE.test(normalized)) {
    fail("work-usd-source-id", "sourceId must be canonical lowercase ASCII");
  }
  return normalized;
}

function networkName(value) {
  const normalized = String(value ?? "");
  if (!NETWORK_RE.test(normalized)) {
    fail("work-usd-network", "network must be canonical lowercase ASCII");
  }
  return normalized;
}

function normalizePrivateKey(value) {
  let privateKey;
  if (typeof value === "string" && HEX_32_RE.test(value)) {
    privateKey = Buffer.from(value, "hex");
  } else if (value instanceof Uint8Array && value.byteLength === 32) {
    privateKey = Buffer.from(value);
  } else {
    fail(
      "work-usd-private-key",
      "privateKey must be a 32-byte Uint8Array or lowercase hex string",
    );
  }
  if (!ecc.isPrivate(privateKey)) {
    privateKey.fill(0);
    fail("work-usd-private-key", "privateKey is not a valid secp256k1 scalar");
  }
  return privateKey;
}

function normalizeAuxRand(value) {
  if (value === undefined) {
    return randomBytes(32);
  }
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) {
    fail("work-usd-aux-rand", "auxRand must be a 32-byte Uint8Array");
  }
  return Buffer.from(value);
}

function decodeJsonScalarToken(token, label) {
  const normalized = String(token ?? "").trim();
  if (normalized.startsWith('"')) {
    let decoded;
    try {
      decoded = JSON.parse(normalized);
    } catch (error) {
      fail("work-usd-source-json", `${label} contains invalid JSON`, {
        cause: error,
      });
    }
    if (typeof decoded !== "string") {
      fail("work-usd-source-json", `${label} price must be scalar`);
    }
    return decoded;
  }
  if (!/^-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u.test(normalized)) {
    fail("work-usd-source-json", `${label} price must be a JSON scalar`);
  }
  return normalized;
}

function jsonPropertyScalar(body, key, source) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = String(body ?? "").match(
    new RegExp(
      `"${escapedKey}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|-?[0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)`,
      "u",
    ),
  );
  if (!match) {
    fail(
      "work-usd-source-shape",
      `${source} response does not contain ${key}`,
    );
  }
  return decodeJsonScalarToken(match[1], source);
}

function jsonArrayPropertyFirstScalar(body, key, source) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = String(body ?? "").match(
    new RegExp(
      `"${escapedKey}"\\s*:\\s*\\[\\s*("(?:\\\\.|[^"\\\\])*"|-?[0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)`,
      "u",
    ),
  );
  if (!match) {
    fail(
      "work-usd-source-shape",
      `${source} response does not contain ${key}[0]`,
    );
  }
  return decodeJsonScalarToken(match[1], source);
}

function splitTopLevelJsonArray(body, source) {
  const text = String(body ?? "").trim();
  if (!text.startsWith("[") || !text.endsWith("]")) {
    fail("work-usd-source-shape", `${source} response must be a JSON array`);
  }
  const items = [];
  let start = 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 1; index < text.length - 1; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "[" || character === "{") {
      depth += 1;
    } else if (character === "]" || character === "}") {
      depth -= 1;
      if (depth < 0) {
        fail("work-usd-source-json", `${source} response is malformed`);
      }
    } else if (character === "," && depth === 0) {
      items.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (inString || escaped || depth !== 0) {
    fail("work-usd-source-json", `${source} response is malformed`);
  }
  items.push(text.slice(start, -1).trim());
  return items;
}

function jsonTopLevelArrayScalar(body, index, source) {
  const values = splitTopLevelJsonArray(body, source);
  if (index >= values.length || !values[index]) {
    fail(
      "work-usd-source-shape",
      `${source} response does not contain array index ${index}`,
    );
  }
  return decodeJsonScalarToken(values[index], source);
}

export function parseUsdPer100mProofsQ8(value) {
  const decimal = String(value ?? "").trim();
  if (
    decimal.length > 96 ||
    !DECIMAL_RE.test(decimal)
  ) {
    fail(
      "work-usd-decimal",
      "USD price must be a positive base-10 decimal string without exponent notation",
    );
  }
  const [wholeRaw, fractionRaw = ""] = decimal.split(".");
  const whole = wholeRaw.replace(/^0+(?=[0-9])/u, "");
  if (whole.length > 64) {
    fail("work-usd-decimal", "USD price exceeds the protocol integer bound");
  }
  const significantFraction = fractionRaw.slice(0, 8);
  const discardedFraction = fractionRaw.slice(8);
  if (discardedFraction && /[1-9]/u.test(discardedFraction)) {
    fail(
      "work-usd-decimal-precision",
      "USD price has precision smaller than one Q8 unit",
    );
  }
  const q8 =
    BigInt(whole) * WORK_USD_Q8_SCALE +
    BigInt(significantFraction.padEnd(8, "0") || "0");
  if (q8 <= 0n) {
    fail("work-usd-decimal", "USD price must be greater than zero");
  }
  return q8.toString();
}

export function createWorkUsdSourceAdapters(overrides = {}) {
  if (
    !overrides ||
    typeof overrides !== "object" ||
    Array.isArray(overrides)
  ) {
    fail("work-usd-source-config", "source overrides must be an object");
  }
  const unknown = Object.keys(overrides).filter(
    (key) => !WORK_USD_ORACLE_SOURCE_IDS.includes(key),
  );
  if (unknown.length > 0) {
    fail(
      "work-usd-source-config",
      `unknown source override: ${unknown.sort(compareUtf8).join(", ")}`,
    );
  }
  return Object.freeze(
    SOURCE_DEFINITIONS.map((definition) => {
      const override = overrides[definition.sourceId] ?? {};
      if (
        !override ||
        typeof override !== "object" ||
        Array.isArray(override)
      ) {
        fail(
          "work-usd-source-config",
          `${definition.sourceId} override must be an object`,
        );
      }
      const url = String(override.url ?? definition.url).trim();
      if (!url) {
        fail(
          "work-usd-source-config",
          `${definition.sourceId} URL must not be empty`,
        );
      }
      const parseBody = override.parseBody ?? definition.parseBody;
      if (typeof parseBody !== "function") {
        fail(
          "work-usd-source-config",
          `${definition.sourceId} parseBody must be a function`,
        );
      }
      return Object.freeze({
        sourceId: definition.sourceId,
        url,
        headers: Object.freeze({ ...(override.headers ?? {}) }),
        parseBody,
      });
    }),
  );
}

async function defaultPollAdapter(adapter, { fetchImpl, timeoutMs }) {
  if (typeof fetchImpl !== "function") {
    fail("work-usd-fetch", "a fetch implementation is required");
  }
  const response = await fetchImpl(adapter.url, {
    headers: adapter.headers,
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response || response.ok !== true || typeof response.text !== "function") {
    fail(
      "work-usd-fetch-status",
      `${adapter.sourceId} returned an unsuccessful response`,
    );
  }
  let body = "";
  if (typeof response.body?.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let receivedBytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        receivedBytes += chunk.value.byteLength;
        if (receivedBytes > MAX_SOURCE_RESPONSE_BYTES) {
          try {
            await reader.cancel();
          } catch {
            // The size failure below remains authoritative.
          }
          fail(
            "work-usd-source-size",
            `${adapter.sourceId} response exceeds the source-size limit`,
          );
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  } else {
    body = await response.text();
    if (
      Buffer.byteLength(body, "utf8") >
      MAX_SOURCE_RESPONSE_BYTES
    ) {
      fail(
        "work-usd-source-size",
        `${adapter.sourceId} response exceeds the source-size limit`,
      );
    }
  }
  return { decimal: adapter.parseBody(body) };
}

export async function fetchWorkUsdSourceObservations({
  adapters = createWorkUsdSourceAdapters(),
  fetchImpl = globalThis.fetch,
  pollAdapter = defaultPollAdapter,
  nowUnixMs = () => Date.now(),
  timeoutMs = 8_000,
} = {}) {
  if (!Array.isArray(adapters) || adapters.length !== 5) {
    fail("work-usd-source-config", "exactly five source adapters are required");
  }
  if (typeof pollAdapter !== "function") {
    fail("work-usd-source-config", "pollAdapter must be a function");
  }
  if (typeof nowUnixMs !== "function") {
    fail("work-usd-clock", "nowUnixMs must be a function");
  }
  positiveInteger(timeoutMs, "timeoutMs");
  const adapterIds = adapters.map((adapter) => sourceId(adapter?.sourceId));
  if (
    new Set(adapterIds).size !== 5 ||
    [...adapterIds].sort(compareUtf8).some(
      (id, index) => id !== WORK_USD_ORACLE_SOURCE_IDS[index],
    )
  ) {
    fail(
      "work-usd-source-config",
      "adapters must contain each approved source exactly once",
    );
  }

  const results = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        const polled = await pollAdapter(adapter, {
          fetchImpl,
          timeoutMs,
        });
        const decimal =
          typeof polled === "string"
            ? polled
            : polled?.decimal ??
              (polled?.body === undefined
                ? undefined
                : adapter.parseBody(polled.body));
        const observedAtUnixMs =
          polled &&
          typeof polled === "object" &&
          polled.observedAtUnixMs !== undefined
            ? polled.observedAtUnixMs
            : nowUnixMs();
        safeInteger(
          observedAtUnixMs,
          `${adapter.sourceId}.observedAtUnixMs`,
          { minimum: 1 },
        );
        return {
          ok: true,
          observation: {
            sourceId: adapter.sourceId,
            usdPer100mProofsQ8: parseUsdPer100mProofsQ8(decimal),
            observedAtUnixMs,
          },
        };
      } catch (error) {
        return {
          ok: false,
          failure: {
            sourceId: adapter.sourceId,
            code:
              error instanceof WorkUsdOracleError
                ? error.code
                : "work-usd-source-failed",
            message:
              error instanceof Error
                ? error.message
                : "source polling failed",
          },
        };
      }
    }),
  );

  const observations = results
    .filter((result) => result.ok)
    .map((result) => Object.freeze(result.observation))
    .sort((left, right) => compareUtf8(left.sourceId, right.sourceId));
  const failures = results
    .filter((result) => !result.ok)
    .map((result) => Object.freeze(result.failure))
    .sort((left, right) => compareUtf8(left.sourceId, right.sourceId));
  return Object.freeze({
    observations: Object.freeze(observations),
    failures: Object.freeze(failures),
  });
}

function normalizeAllowedSourceIds(value) {
  if (!Array.isArray(value) || value.length !== 5) {
    fail("work-usd-policy", "allowedSourceIds must contain five source IDs");
  }
  const normalized = value.map(sourceId).sort(compareUtf8);
  if (new Set(normalized).size !== 5) {
    fail("work-usd-policy", "allowedSourceIds must be distinct");
  }
  return normalized;
}

function normalizeObservation(value, label = "source observation") {
  exactObject(value, SOURCE_KEYS, label);
  return {
    sourceId: sourceId(value.sourceId),
    usdPer100mProofsQ8: positiveQ8String(
      value.usdPer100mProofsQ8,
      `${label}.usdPer100mProofsQ8`,
    ),
    observedAtUnixMs: safeInteger(
      value.observedAtUnixMs,
      `${label}.observedAtUnixMs`,
      { minimum: 1 },
    ),
  };
}

function canonicalSources(sources) {
  return sources.map((source) => ({
    sourceId: source.sourceId,
    usdPer100mProofsQ8: source.usdPer100mProofsQ8,
    observedAtUnixMs: source.observedAtUnixMs,
  }));
}

export function workUsdSourceSetSha256(sources) {
  const normalized = sources.map((source, index) =>
    normalizeObservation(source, `sources[${index}]`),
  );
  normalized.sort((left, right) => compareUtf8(left.sourceId, right.sourceId));
  if (new Set(normalized.map((source) => source.sourceId)).size !== normalized.length) {
    fail("work-usd-source-duplicate", "source observations must be distinct");
  }
  return sha256Hex(
    Buffer.from(
      `${WORK_USD_SOURCE_SET_DOMAIN}\n${JSON.stringify(
        canonicalSources(normalized),
      )}`,
      "utf8",
    ),
  );
}

function medianQ8(values) {
  const sorted = values.map(BigInt).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2n;
}

export function buildWorkUsdConsensus({
  observations,
  issuedAtUnixMs,
  freshnessWindowMs = WORK_USD_ORACLE_FRESHNESS_WINDOW_MS,
  maxSpreadBps = WORK_USD_ORACLE_MAX_SPREAD_BPS,
  minimumSources = WORK_USD_ORACLE_MINIMUM_SOURCES,
  allowedSourceIds = WORK_USD_ORACLE_SOURCE_IDS,
} = {}) {
  if (!Array.isArray(observations)) {
    fail("work-usd-observations", "observations must be an array");
  }
  safeInteger(issuedAtUnixMs, "issuedAtUnixMs", { minimum: 1 });
  positiveInteger(freshnessWindowMs, "freshnessWindowMs");
  safeInteger(maxSpreadBps, "maxSpreadBps", { minimum: 0 });
  if (maxSpreadBps > 10_000) {
    fail("work-usd-policy", "maxSpreadBps must not exceed 10000");
  }
  positiveInteger(minimumSources, "minimumSources");
  if (minimumSources < 3 || minimumSources > 5) {
    fail("work-usd-policy", "minimumSources must be between 3 and 5");
  }
  const allowed = normalizeAllowedSourceIds(allowedSourceIds);
  const normalized = observations.map((observation, index) =>
    normalizeObservation(observation, `observations[${index}]`),
  );
  const ids = normalized.map((observation) => observation.sourceId);
  if (new Set(ids).size !== ids.length) {
    fail("work-usd-source-duplicate", "source observations must be distinct");
  }
  for (const id of ids) {
    if (!allowed.includes(id)) {
      fail("work-usd-source-unapproved", `unapproved source: ${id}`);
    }
  }
  const fresh = normalized
    .filter((observation) => {
      const age = issuedAtUnixMs - observation.observedAtUnixMs;
      return age >= 0 && age <= freshnessWindowMs;
    })
    .sort((left, right) => compareUtf8(left.sourceId, right.sourceId));
  if (fresh.length < minimumSources) {
    fail(
      "work-usd-quorum",
      `only ${fresh.length} distinct fresh sources; ${minimumSources} required`,
    );
  }
  const median = medianQ8(
    fresh.map((observation) => observation.usdPer100mProofsQ8),
  );
  const q8Values = fresh.map((observation) =>
    BigInt(observation.usdPer100mProofsQ8),
  );
  const minimum = q8Values.reduce((left, right) =>
    left < right ? left : right,
  );
  const maximum = q8Values.reduce((left, right) =>
    left > right ? left : right,
  );
  if (
    (maximum - minimum) * BASIS_POINT_SCALE >
    median * BigInt(maxSpreadBps)
  ) {
    fail(
      "work-usd-spread",
      "fresh source spread exceeds the declared basis-point limit",
    );
  }
  const sources = Object.freeze(
    canonicalSources(fresh).map((source) => Object.freeze(source)),
  );
  return Object.freeze({
    issuedAtUnixMs,
    freshnessWindowMs,
    maxSpreadBps,
    minimumSources,
    usdPer100mProofsQ8: median.toString(),
    sources,
    sourceSetSha256: workUsdSourceSetSha256(sources),
  });
}

export function workUsdOracleKeyIdFromPublicKey(publicKeyInput) {
  const publicKey = lowercaseHex(
    publicKeyInput,
    HEX_32_RE,
    "publicKey",
  );
  return sha256Hex(
    Buffer.concat([
      Buffer.from(`${WORK_USD_ORACLE_KEY_ID_DOMAIN}\n`, "utf8"),
      Buffer.from(publicKey, "hex"),
    ]),
  );
}

export function deriveWorkUsdOracleIdentity(privateKeyInput) {
  const privateKey = normalizePrivateKey(privateKeyInput);
  try {
    const publicKey = Buffer.from(
      ecc.xOnlyPointFromScalar(privateKey),
    ).toString("hex");
    return Object.freeze({
      publicKey,
      oracleKeyId: workUsdOracleKeyIdFromPublicKey(publicKey),
    });
  } finally {
    privateKey.fill(0);
  }
}

function unsignedAttestation(attestation) {
  return {
    version: attestation.version,
    model: attestation.model,
    network: attestation.network,
    declarationTxid: attestation.declarationTxid,
    oracleKeyId: attestation.oracleKeyId,
    publicKey: attestation.publicKey,
    referenceBlockHeight: attestation.referenceBlockHeight,
    referenceBlockHash: attestation.referenceBlockHash,
    validFromHeight: attestation.validFromHeight,
    validThroughHeight: attestation.validThroughHeight,
    issuedAtUnixMs: attestation.issuedAtUnixMs,
    freshnessWindowMs: attestation.freshnessWindowMs,
    maxSpreadBps: attestation.maxSpreadBps,
    minimumSources: attestation.minimumSources,
    maxValidityBlocks: attestation.maxValidityBlocks,
    usdPer100mProofsQ8: attestation.usdPer100mProofsQ8,
    sources: canonicalSources(attestation.sources),
    sourceSetSha256: attestation.sourceSetSha256,
  };
}

export function canonicalWorkUsdAttestationPreimage(attestation) {
  return Buffer.from(
    `${WORK_USD_ATTESTATION_DOMAIN}\n${JSON.stringify(
      unsignedAttestation(attestation),
    )}`,
    "utf8",
  );
}

function normalizeAttestation(value) {
  exactObject(value, ATTESTATION_KEYS, "attestation");
  const sources = value.sources;
  if (!Array.isArray(sources)) {
    fail("work-usd-shape", "attestation.sources must be an array");
  }
  const normalizedSources = sources.map((source, index) =>
    normalizeObservation(source, `attestation.sources[${index}]`),
  );
  if (
    normalizedSources.some(
      (source, index) =>
        index > 0 &&
        compareUtf8(normalizedSources[index - 1].sourceId, source.sourceId) >=
          0,
    )
  ) {
    fail(
      "work-usd-source-order",
      "attestation sources must be strictly ordered by sourceId",
    );
  }
  return {
    version: String(value.version ?? ""),
    model: String(value.model ?? ""),
    network: networkName(value.network),
    declarationTxid: lowercaseHex(
      value.declarationTxid,
      HEX_32_RE,
      "declarationTxid",
    ),
    oracleKeyId: lowercaseHex(
      value.oracleKeyId,
      HEX_32_RE,
      "oracleKeyId",
    ),
    publicKey: lowercaseHex(value.publicKey, HEX_32_RE, "publicKey"),
    referenceBlockHeight: safeInteger(
      value.referenceBlockHeight,
      "referenceBlockHeight",
    ),
    referenceBlockHash: lowercaseHex(
      value.referenceBlockHash,
      HEX_32_RE,
      "referenceBlockHash",
    ),
    validFromHeight: safeInteger(
      value.validFromHeight,
      "validFromHeight",
      { minimum: 1 },
    ),
    validThroughHeight: safeInteger(
      value.validThroughHeight,
      "validThroughHeight",
      { minimum: 1 },
    ),
    issuedAtUnixMs: safeInteger(
      value.issuedAtUnixMs,
      "issuedAtUnixMs",
      { minimum: 1 },
    ),
    freshnessWindowMs: positiveInteger(
      value.freshnessWindowMs,
      "freshnessWindowMs",
    ),
    maxSpreadBps: safeInteger(value.maxSpreadBps, "maxSpreadBps"),
    minimumSources: positiveInteger(
      value.minimumSources,
      "minimumSources",
    ),
    maxValidityBlocks: positiveInteger(
      value.maxValidityBlocks,
      "maxValidityBlocks",
    ),
    usdPer100mProofsQ8: positiveQ8String(
      value.usdPer100mProofsQ8,
    ),
    sources: normalizedSources,
    sourceSetSha256: lowercaseHex(
      value.sourceSetSha256,
      HEX_32_RE,
      "sourceSetSha256",
    ),
    attestationId: lowercaseHex(
      value.attestationId,
      HEX_32_RE,
      "attestationId",
    ),
    signature: lowercaseHex(value.signature, HEX_64_RE, "signature"),
  };
}

function normalizeConsensusForSigning(consensus) {
  if (!consensus || typeof consensus !== "object" || Array.isArray(consensus)) {
    fail("work-usd-consensus", "consensus must be an object");
  }
  const rebuilt = buildWorkUsdConsensus({
    observations: consensus.sources,
    issuedAtUnixMs: consensus.issuedAtUnixMs,
    freshnessWindowMs: consensus.freshnessWindowMs,
    maxSpreadBps: consensus.maxSpreadBps,
    minimumSources: consensus.minimumSources,
  });
  if (
    rebuilt.usdPer100mProofsQ8 !==
      String(consensus.usdPer100mProofsQ8 ?? "") ||
    rebuilt.sourceSetSha256 !== String(consensus.sourceSetSha256 ?? "")
  ) {
    fail(
      "work-usd-consensus",
      "consensus price or source-set commitment is not canonical",
    );
  }
  return rebuilt;
}

export function buildSignedWorkUsdAttestation({
  consensus,
  network,
  declarationTxid,
  referenceBlockHeight,
  referenceBlockHash,
  validFromHeight = referenceBlockHeight + 1,
  validThroughHeight,
  maxValidityBlocks = WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS,
  privateKey: privateKeyInput,
  auxRand: auxRandInput,
} = {}) {
  const normalizedConsensus = normalizeConsensusForSigning(consensus);
  const normalizedNetwork = networkName(network);
  const normalizedDeclarationTxid = lowercaseHex(
    declarationTxid,
    HEX_32_RE,
    "declarationTxid",
  );
  safeInteger(referenceBlockHeight, "referenceBlockHeight");
  const normalizedReferenceBlockHash = lowercaseHex(
    referenceBlockHash,
    HEX_32_RE,
    "referenceBlockHash",
  );
  positiveInteger(validFromHeight, "validFromHeight");
  positiveInteger(validThroughHeight, "validThroughHeight");
  positiveInteger(maxValidityBlocks, "maxValidityBlocks");
  if (validFromHeight !== referenceBlockHeight + 1) {
    fail(
      "work-usd-validity",
      "validFromHeight must equal referenceBlockHeight + 1",
    );
  }
  if (
    validThroughHeight < validFromHeight ||
    validThroughHeight >
      referenceBlockHeight + maxValidityBlocks
  ) {
    fail(
      "work-usd-validity",
      "validThroughHeight is outside the declared validity window",
    );
  }
  const privateKey = normalizePrivateKey(privateKeyInput);
  const auxRand = normalizeAuxRand(auxRandInput);
  try {
    const publicKey = Buffer.from(
      ecc.xOnlyPointFromScalar(privateKey),
    ).toString("hex");
    const oracleKeyId = workUsdOracleKeyIdFromPublicKey(publicKey);
    const unsigned = {
      version: WORK_USD_ATTESTATION_VERSION,
      model: WORK_USD_ATTESTATION_MODEL,
      network: normalizedNetwork,
      declarationTxid: normalizedDeclarationTxid,
      oracleKeyId,
      publicKey,
      referenceBlockHeight,
      referenceBlockHash: normalizedReferenceBlockHash,
      validFromHeight,
      validThroughHeight,
      issuedAtUnixMs: normalizedConsensus.issuedAtUnixMs,
      freshnessWindowMs: normalizedConsensus.freshnessWindowMs,
      maxSpreadBps: normalizedConsensus.maxSpreadBps,
      minimumSources: normalizedConsensus.minimumSources,
      maxValidityBlocks,
      usdPer100mProofsQ8:
        normalizedConsensus.usdPer100mProofsQ8,
      sources: normalizedConsensus.sources,
      sourceSetSha256: normalizedConsensus.sourceSetSha256,
    };
    const digest = sha256(canonicalWorkUsdAttestationPreimage(unsigned));
    const attestationId = digest.toString("hex");
    const signature = Buffer.from(
      ecc.signSchnorr(digest, privateKey, auxRand),
    ).toString("hex");
    return Object.freeze({
      ...unsigned,
      sources: Object.freeze(
        unsigned.sources.map((source) => Object.freeze({ ...source })),
      ),
      attestationId,
      signature,
    });
  } finally {
    privateKey.fill(0);
    auxRand.fill(0);
  }
}

function expectedHex(value, pattern, label) {
  if (value === undefined) {
    fail("work-usd-verifier-policy", `${label} must be pinned by the verifier`);
  }
  return lowercaseHex(value, pattern, label);
}

export function verifyWorkUsdAttestation(
  candidate,
  {
    expectedNetwork,
    expectedDeclarationTxid,
    expectedOracleKeyId,
    expectedPublicKey,
    expectedModel = WORK_USD_ATTESTATION_MODEL,
    expectedFreshnessWindowMs = WORK_USD_ORACLE_FRESHNESS_WINDOW_MS,
    expectedMaxSpreadBps = WORK_USD_ORACLE_MAX_SPREAD_BPS,
    expectedMinimumSources = WORK_USD_ORACLE_MINIMUM_SOURCES,
    expectedMaxValidityBlocks = WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS,
    allowedSourceIds = WORK_USD_ORACLE_SOURCE_IDS,
    blockHeight,
    expectedReferenceBlockHeight,
    expectedReferenceBlockHash,
  } = {},
) {
  const attestation = normalizeAttestation(candidate);
  const pinnedNetwork = networkName(expectedNetwork);
  const pinnedDeclarationTxid = expectedHex(
    expectedDeclarationTxid,
    HEX_32_RE,
    "expectedDeclarationTxid",
  );
  const pinnedPublicKey = expectedHex(
    expectedPublicKey,
    HEX_32_RE,
    "expectedPublicKey",
  );
  if (!ecc.isXOnlyPoint(Buffer.from(pinnedPublicKey, "hex"))) {
    fail("work-usd-public-key", "expectedPublicKey is not an x-only point");
  }
  const derivedKeyId = workUsdOracleKeyIdFromPublicKey(
    pinnedPublicKey,
  );
  const pinnedKeyId =
    expectedOracleKeyId === undefined
      ? derivedKeyId
      : expectedHex(
          expectedOracleKeyId,
          HEX_32_RE,
          "expectedOracleKeyId",
        );
  if (pinnedKeyId !== derivedKeyId) {
    fail(
      "work-usd-key-id",
      "expectedOracleKeyId does not match expectedPublicKey",
    );
  }
  if (
    attestation.version !== WORK_USD_ATTESTATION_VERSION ||
    attestation.model !== expectedModel ||
    attestation.network !== pinnedNetwork ||
    attestation.declarationTxid !== pinnedDeclarationTxid ||
    attestation.publicKey !== pinnedPublicKey ||
    attestation.oracleKeyId !== pinnedKeyId
  ) {
    fail(
      "work-usd-attestation-policy",
      "attestation identity or declaration policy does not match",
    );
  }
  positiveInteger(
    expectedFreshnessWindowMs,
    "expectedFreshnessWindowMs",
  );
  safeInteger(expectedMaxSpreadBps, "expectedMaxSpreadBps");
  positiveInteger(expectedMinimumSources, "expectedMinimumSources");
  positiveInteger(
    expectedMaxValidityBlocks,
    "expectedMaxValidityBlocks",
  );
  if (
    attestation.freshnessWindowMs !== expectedFreshnessWindowMs ||
    attestation.maxSpreadBps !== expectedMaxSpreadBps ||
    attestation.minimumSources !== expectedMinimumSources ||
    attestation.maxValidityBlocks !== expectedMaxValidityBlocks
  ) {
    fail(
      "work-usd-attestation-policy",
      "attestation source or validity policy does not match",
    );
  }
  if (
    attestation.validFromHeight !==
      attestation.referenceBlockHeight + 1 ||
    attestation.validThroughHeight < attestation.validFromHeight ||
    attestation.validThroughHeight >
      attestation.referenceBlockHeight +
        attestation.maxValidityBlocks
  ) {
    fail("work-usd-validity", "attestation validity window is invalid");
  }
  if (
    expectedReferenceBlockHeight !== undefined &&
    attestation.referenceBlockHeight !==
      safeInteger(
        expectedReferenceBlockHeight,
        "expectedReferenceBlockHeight",
      )
  ) {
    fail("work-usd-anchor", "reference block height does not match");
  }
  if (
    expectedReferenceBlockHash !== undefined &&
    attestation.referenceBlockHash !==
      lowercaseHex(
        expectedReferenceBlockHash,
        HEX_32_RE,
        "expectedReferenceBlockHash",
      )
  ) {
    fail("work-usd-anchor", "reference block hash does not match");
  }
  if (blockHeight !== undefined) {
    safeInteger(blockHeight, "blockHeight");
    if (
      blockHeight < attestation.validFromHeight ||
      blockHeight > attestation.validThroughHeight
    ) {
      fail(
        "work-usd-validity",
        "attestation is not valid at the supplied block height",
      );
    }
  }
  const rebuilt = buildWorkUsdConsensus({
    observations: attestation.sources,
    issuedAtUnixMs: attestation.issuedAtUnixMs,
    freshnessWindowMs: attestation.freshnessWindowMs,
    maxSpreadBps: attestation.maxSpreadBps,
    minimumSources: attestation.minimumSources,
    allowedSourceIds,
  });
  if (
    rebuilt.sources.length !== attestation.sources.length ||
    rebuilt.usdPer100mProofsQ8 !==
      attestation.usdPer100mProofsQ8 ||
    rebuilt.sourceSetSha256 !== attestation.sourceSetSha256
  ) {
    fail(
      "work-usd-consensus",
      "attestation price or source-set commitment is not canonical",
    );
  }
  const calculatedId = sha256Hex(
    canonicalWorkUsdAttestationPreimage(attestation),
  );
  if (calculatedId !== attestation.attestationId) {
    fail("work-usd-attestation-id", "attestationId does not match payload");
  }
  let signatureValid = false;
  try {
    signatureValid = ecc.verifySchnorr(
      Buffer.from(attestation.attestationId, "hex"),
      Buffer.from(attestation.publicKey, "hex"),
      Buffer.from(attestation.signature, "hex"),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    fail("work-usd-signature", "attestation signature is invalid");
  }
  const frozenAttestation = Object.freeze({
    ...attestation,
    sources: Object.freeze(
      attestation.sources.map((source) => Object.freeze({ ...source })),
    ),
  });
  return Object.freeze({
    valid: true,
    attestation: frozenAttestation,
    attestationId: frozenAttestation.attestationId,
    usdPer100mProofsQ8:
      frozenAttestation.usdPer100mProofsQ8,
  });
}
