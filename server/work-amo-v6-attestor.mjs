import { readFile, stat } from "node:fs/promises";
import {
  WORK_USD_ORACLE_FRESHNESS_WINDOW_MS,
  WORK_USD_ORACLE_MAX_SPREAD_BPS,
  WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS,
  WORK_USD_ORACLE_MINIMUM_SOURCES,
  buildSignedWorkUsdAttestation,
  buildWorkUsdConsensus,
  createWorkUsdSourceAdapters,
  deriveWorkUsdOracleIdentity,
  fetchWorkUsdSourceObservations,
  verifyWorkUsdAttestation,
} from "./work-usd-oracle.mjs";

const PRIVATE_KEY_PATTERN = /^[0-9a-f]{64}$/u;
const TXID_PATTERN = /^[0-9a-f]{64}$/u;
const BLOCK_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_SOURCE_TIMEOUT_MS = 8_000;

export class WorkAmoV6AttestorError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "WorkAmoV6AttestorError";
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new WorkAmoV6AttestorError(code, message, options);
}

function canonicalPrivateKey(value) {
  if (
    value instanceof Uint8Array &&
    value.byteLength === 32
  ) {
    return Buffer.from(value);
  }
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (PRIVATE_KEY_PATTERN.test(text)) {
      return Buffer.from(text, "hex");
    }
  }
  fail(
    "work-amo-v6-private-key-invalid",
    "the WORK AMO V6 oracle credential must contain one 32-byte private key",
  );
}

function canonicalTxid(value, label) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!TXID_PATTERN.test(text)) {
    fail("work-amo-v6-attestor-config-invalid", `${label} is invalid`);
  }
  return text;
}

function canonicalPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(
      "work-amo-v6-attestor-config-invalid",
      `${label} must be a positive safe integer`,
    );
  }
  return value;
}

function canonicalTip(value) {
  const height = Number(value?.height);
  const hash = String(value?.hash ?? "").trim().toLowerCase();
  if (
    !Number.isSafeInteger(height) ||
    height < 1 ||
    !BLOCK_HASH_PATTERN.test(hash)
  ) {
    fail(
      "work-amo-v6-canonical-tip-unavailable",
      "the canonical ProofOfWork tip is unavailable",
    );
  }
  return { hash, height };
}

export async function readWorkAmoV6OraclePrivateKeyFile(filePath) {
  const path = String(filePath ?? "").trim();
  if (!path) {
    fail(
      "work-amo-v6-private-key-unavailable",
      "the WORK AMO V6 oracle credential path is not configured",
    );
  }
  let metadata;
  let raw;
  try {
    [metadata, raw] = await Promise.all([
      stat(path),
      readFile(path, "utf8"),
    ]);
  } catch (cause) {
    fail(
      "work-amo-v6-private-key-unavailable",
      "the WORK AMO V6 oracle credential could not be read",
      { cause },
    );
  }
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o077) !== 0
  ) {
    fail(
      "work-amo-v6-private-key-permissions",
      "the WORK AMO V6 oracle credential must be a private regular file",
    );
  }
  return canonicalPrivateKey(raw);
}

function publicAttestorFailure(error) {
  const code =
    error instanceof WorkAmoV6AttestorError
      ? error.code
      : typeof error?.code === "string"
        ? error.code
        : "work-amo-v6-attestation-unavailable";
  return {
    code,
    message:
      code === "work-usd-quorum"
        ? "The live price attestor does not currently have three fresh sources."
        : code === "work-usd-spread"
          ? "The live price sources currently disagree beyond the protocol limit."
          : "A fresh canonical AMO price attestation is temporarily unavailable.",
  };
}

/**
 * Creates the isolated live attestor used by the public quote endpoint.
 *
 * The caller supplies canonical chain readers so this module cannot silently
 * fall back to display prices or another node. The private key controls no
 * funds and is never included in responses, diagnostics, or serialized state.
 */
export function createWorkAmoV6Attestor({
  privateKey: privateKeyInput,
  declarationTxid,
  getCanonicalTip,
  getCanonicalBlockHash,
  network = "livenet",
  adapters = createWorkUsdSourceAdapters(),
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  sourceTimeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  nowUnixMs = () => Date.now(),
} = {}) {
  const privateKey = canonicalPrivateKey(privateKeyInput);
  const normalizedDeclarationTxid = canonicalTxid(
    declarationTxid,
    "declarationTxid",
  );
  if (
    String(network).trim().toLowerCase() !== "livenet" ||
    typeof getCanonicalTip !== "function" ||
    typeof getCanonicalBlockHash !== "function" ||
    typeof nowUnixMs !== "function"
  ) {
    privateKey.fill(0);
    fail(
      "work-amo-v6-attestor-config-invalid",
      "the attestor requires livenet canonical chain readers",
    );
  }
  canonicalPositiveInteger(cacheTtlMs, "cacheTtlMs");
  canonicalPositiveInteger(sourceTimeoutMs, "sourceTimeoutMs");
  const identity = deriveWorkUsdOracleIdentity(privateKey);
  let cached = null;
  let inflight = null;
  let destroyed = false;

  const assertAvailable = () => {
    if (destroyed) {
      fail(
        "work-amo-v6-attestor-destroyed",
        "the WORK AMO V6 attestor has been destroyed",
      );
    }
  };

  const cachedAttestationIfUsable = async (tip, now) => {
    if (
      !cached ||
      now - cached.createdAtUnixMs > cacheTtlMs ||
      now - cached.attestation.issuedAtUnixMs >
        WORK_USD_ORACLE_FRESHNESS_WINDOW_MS ||
      tip.height >= cached.attestation.validThroughHeight
    ) {
      return null;
    }
    const canonicalHash = String(
      await getCanonicalBlockHash(
        cached.attestation.referenceBlockHeight,
      ),
    ).trim().toLowerCase();
    return canonicalHash === cached.attestation.referenceBlockHash
      ? cached
      : null;
  };

  const issue = async () => {
    assertAvailable();
    const openingTip = canonicalTip(await getCanonicalTip());
    const requestedAtUnixMs = Number(nowUnixMs());
    if (!Number.isSafeInteger(requestedAtUnixMs) || requestedAtUnixMs < 1) {
      fail(
        "work-amo-v6-attestor-clock-invalid",
        "the attestor clock is unavailable",
      );
    }
    const reusable = await cachedAttestationIfUsable(
      openingTip,
      requestedAtUnixMs,
    );
    if (reusable) {
      return reusable;
    }
    const polled = await fetchWorkUsdSourceObservations({
      adapters,
      fetchImpl,
      nowUnixMs,
      timeoutMs: sourceTimeoutMs,
    });
    const issuedAtUnixMs = Number(nowUnixMs());
    if (!Number.isSafeInteger(issuedAtUnixMs) || issuedAtUnixMs < 1) {
      fail(
        "work-amo-v6-attestor-clock-invalid",
        "the attestor clock is unavailable",
      );
    }
    const consensus = buildWorkUsdConsensus({
      observations: polled.observations,
      issuedAtUnixMs,
      freshnessWindowMs: WORK_USD_ORACLE_FRESHNESS_WINDOW_MS,
      maxSpreadBps: WORK_USD_ORACLE_MAX_SPREAD_BPS,
      minimumSources: WORK_USD_ORACLE_MINIMUM_SOURCES,
    });
    const attestation = buildSignedWorkUsdAttestation({
      consensus,
      declarationTxid: normalizedDeclarationTxid,
      maxValidityBlocks: WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS,
      network: "livenet",
      privateKey,
      referenceBlockHash: openingTip.hash,
      referenceBlockHeight: openingTip.height,
      validFromHeight: openingTip.height + 1,
      validThroughHeight:
        openingTip.height + WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS,
    });
    const closingTip = canonicalTip(await getCanonicalTip());
    const canonicalReferenceHash = String(
      await getCanonicalBlockHash(openingTip.height),
    ).trim().toLowerCase();
    if (
      closingTip.height < openingTip.height ||
      canonicalReferenceHash !== openingTip.hash
    ) {
      fail(
        "work-amo-v6-attestor-anchor-changed",
        "the canonical reference block changed during attestation",
      );
    }
    if (closingTip.height >= attestation.validThroughHeight) {
      fail(
        "work-amo-v6-attestor-window-exhausted",
        "the attestation validity window elapsed during source polling",
      );
    }
    verifyWorkUsdAttestation(attestation, {
      blockHeight: closingTip.height + 1,
      expectedDeclarationTxid: normalizedDeclarationTxid,
      expectedFreshnessWindowMs:
        WORK_USD_ORACLE_FRESHNESS_WINDOW_MS,
      expectedMaxSpreadBps: WORK_USD_ORACLE_MAX_SPREAD_BPS,
      expectedMaxValidityBlocks:
        WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS,
      expectedMinimumSources: WORK_USD_ORACLE_MINIMUM_SOURCES,
      expectedNetwork: "livenet",
      expectedOracleKeyId: identity.oracleKeyId,
      expectedPublicKey: identity.publicKey,
      expectedReferenceBlockHash: openingTip.hash,
      expectedReferenceBlockHeight: openingTip.height,
    });
    cached = Object.freeze({
      attestation,
      createdAtUnixMs: issuedAtUnixMs,
      failures: polled.failures,
      referenceTip: openingTip,
      sourceCount: attestation.sources.length,
    });
    return cached;
  };

  return Object.freeze({
    identity,
    policy: Object.freeze({
      declarationTxid: normalizedDeclarationTxid,
      freshnessWindowMs: WORK_USD_ORACLE_FRESHNESS_WINDOW_MS,
      maxSpreadBps: WORK_USD_ORACLE_MAX_SPREAD_BPS,
      maxValidityBlocks: WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS,
      minimumSources: WORK_USD_ORACLE_MINIMUM_SOURCES,
      oracleKeyId: identity.oracleKeyId,
      publicKey: identity.publicKey,
    }),
    async attestation() {
      assertAvailable();
      if (!inflight) {
        inflight = issue().finally(() => {
          inflight = null;
        });
      }
      try {
        return await inflight;
      } catch (error) {
        const publicFailure = publicAttestorFailure(error);
        const wrapped = new WorkAmoV6AttestorError(
          publicFailure.code,
          publicFailure.message,
          { cause: error },
        );
        throw wrapped;
      }
    },
    destroy() {
      if (!destroyed) {
        destroyed = true;
        cached = null;
        privateKey.fill(0);
      }
    },
  });
}
