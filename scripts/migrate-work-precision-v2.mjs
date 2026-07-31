import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  canonicalProtocolCandidateFromOutput,
} from "../server/canonical-op-return.mjs";
import {
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
} from "../server/work-amo-v5.mjs";
import {
  workAmoV6CanonicalTokenStateCommitment,
} from "../server/work-amo-v6.mjs";
import {
  WORK_AMO_V7_AUTH_VERSION,
  WORK_AMO_V7_DECIMALS,
  WORK_AMO_V7_GLOBAL_PRECISION_MODEL,
  WORK_AMO_V7_MAX_SUPPLY_SUBATOMS,
  WORK_AMO_V7_MINT_AMOUNT_SUBATOMS,
  WORK_AMO_V7_PRECISION_MIGRATION_MODEL,
  WORK_AMO_V7_TRANSFER_VERSION,
  workAmoV7CanonicalTokenStateCommitment,
  workAmoV7CanonicalTokenStatePreimage,
} from "../server/work-amo-v7.mjs";
import {
  workAmoV7DeclarationCommitment,
} from "../server/work-amo-v7-declaration.mjs";
import {
  WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
  WORK_LEGACY_DECIMALS,
  WORK_LEGACY_UNIT_SCALE_TEXT,
  WORK_PRECISION_V2_MIGRATION_META_KEY,
  WORK_SUBATOM_CONVERSION_FACTOR,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_SUBATOM_UNIT_SCALE_TEXT,
  WORK_TOKEN_ID,
  legacyWorkAtomsToSubatoms,
  withWorkSubatomPrecisionMetadata,
} from "../server/work-units.mjs";

const { Pool } = pg;

export const WORK_PRECISION_V2_MIGRATION_MODEL =
  "canonical-work-q8-to-q16-migration-v1";
export const WORK_PRECISION_V2_ACTIVATION_CONSTRAINT =
  "work_amo_v7_terms_activation";
export const WORK_PRECISION_V2_V6_DEACTIVATION_CONSTRAINT =
  "work_amo_v6_terms_deactivation";
export const WORK_PRECISION_V2_EVIDENCE_MODEL =
  "canonical-work-precision-v2-declaration-core-index-evidence-v1";
export const WORK_PRECISION_V2_EVIDENCE_DOMAIN =
  "ProofOfWork.Me/WORK-PRECISION-V2-DECLARATION-EVIDENCE/v1";

const WORK_MAX_SUPPLY_ATOMS = "2100000000000000";
const WORK_MINT_AMOUNT_ATOMS = "100000000000";
const TXID_PATTERN = /^[0-9a-f]{64}$/u;
const HEX_BYTES_PATTERN = /^(?:[0-9a-f]{2})+$/u;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const SIGNED_INTEGER_PATTERN = /^-?(?:0|[1-9][0-9]*)$/u;
const BITCOIN_RPC_TIMEOUT_MS = 15_000;

function normalizedLower(value) {
  return String(value ?? "").trim().toLowerCase();
}

function optionalSafeInteger(value, minimum = 0) {
  const raw = String(value ?? "");
  if (raw === "") {
    return null;
  }
  if (!UNSIGNED_INTEGER_PATTERN.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum
    ? parsed
    : null;
}

function canonicalConfiguredHash(value) {
  const raw = String(value ?? "");
  return TXID_PATTERN.test(raw) ? raw : "";
}

function exactInteger(value, { signed = false } = {}) {
  const text = String(value ?? "").trim();
  const pattern = signed
    ? SIGNED_INTEGER_PATTERN
    : UNSIGNED_INTEGER_PATTERN;
  if (!pattern.test(text) || text === "-0") {
    throw new TypeError("WORK migration values must be canonical integers.");
  }
  return BigInt(text).toString();
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${stableJson(value[key])}`,
        )
        .join(",")
    }}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalWorkPrecisionV2Rows(
  rows,
  {
    amountField,
    keyField,
    pendingField = "",
  },
) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      amount: exactInteger(row?.[amountField]),
      key: String(row?.[keyField] ?? ""),
      ...(pendingField
        ? {
            pending: exactInteger(row?.[pendingField], {
              signed: true,
            }),
          }
        : {}),
    }))
    .sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.key, "utf8"),
        Buffer.from(right.key, "utf8"),
      ),
    );
}

export function workPrecisionV2RowsCommitment(rows, options) {
  const canonical = canonicalWorkPrecisionV2Rows(rows, options);
  const payload = stableJson(canonical);
  return Object.freeze({
    count: canonical.length,
    payloadBytes: Buffer.byteLength(payload, "utf8"),
    sha256: sha256Hex(Buffer.from(payload, "utf8")),
  });
}

export function scaleWorkPrecisionV2Rows(
  rows,
  {
    amountField,
    keyField,
    pendingField = "",
  },
) {
  return canonicalWorkPrecisionV2Rows(rows, {
    amountField,
    keyField,
    pendingField,
  }).map((row) => ({
    amount: legacyWorkAtomsToSubatoms(row.amount, {
      allowZero: true,
    }),
    key: row.key,
    ...(pendingField
      ? {
          pending: (
            BigInt(row.pending) * WORK_SUBATOM_CONVERSION_FACTOR
          ).toString(),
        }
      : {}),
  }));
}

export function verifyWorkPrecisionV2RowsConserved(
  legacyRows,
  subatomRows,
  options,
) {
  const expected = scaleWorkPrecisionV2Rows(legacyRows, options);
  const actual = canonicalWorkPrecisionV2Rows(subatomRows, options);
  if (stableJson(expected) !== stableJson(actual)) {
    throw new Error(
      "WORK Q8-to-Q16 row conservation failed exact integer comparison.",
    );
  }
  return true;
}

export function scaleWorkPrecisionV2TokenState(legacyTokenState) {
  const legacyCommitment =
    workAmoV6CanonicalTokenStateCommitment(legacyTokenState);
  const holders = (Array.isArray(legacyTokenState?.holders)
    ? legacyTokenState.holders
    : []).map((holder) => ({
    address: holder.address,
    balanceSubatoms: legacyWorkAtomsToSubatoms(
      holder.balanceAtoms,
    ),
  }));
  const listings = (Array.isArray(legacyTokenState?.listings)
    ? legacyTokenState.listings
    : []).map((listing) => ({
    amountSubatoms: legacyWorkAtomsToSubatoms(
      listing.amountAtoms,
    ),
    frozenTerms: listing.frozenTerms,
    listingAuthorization: listing.listingAuthorization,
    listingId: listing.listingId,
    priceSats: listing.priceSats,
    saleAuthorization: listing.saleAuthorization,
    sellerAddress: listing.sellerAddress,
  }));
  const subatomState = workAmoV7CanonicalTokenStatePreimage({
    confirmedSupplySubatoms: legacyWorkAtomsToSubatoms(
      legacyTokenState.confirmedSupplyAtoms,
      { allowZero: true },
    ),
    holders,
    listings,
  });
  return Object.freeze({
    legacyCommitment,
    legacyTokenState,
    subatomCommitment:
      workAmoV7CanonicalTokenStateCommitment(subatomState),
    subatomState,
  });
}

export function configuredWorkPrecisionV2Pins(
  env = process.env,
  declarationCommitment = workAmoV7DeclarationCommitment(),
) {
  const prefix = "WORK_AMO_V7_";
  const declarationTxid = canonicalConfiguredHash(
    env[`${prefix}DECLARATION_TXID`],
  );
  const declarationHeight = optionalSafeInteger(
    env[`${prefix}DECLARATION_HEIGHT`],
    1,
  );
  const declarationBlockHash = canonicalConfiguredHash(
    env[`${prefix}DECLARATION_BLOCK_HASH`],
  );
  const declarationBlockIndex = optionalSafeInteger(
    env[`${prefix}DECLARATION_BLOCK_INDEX`],
  );
  const declarationMemoSha256 = canonicalConfiguredHash(
    env[`${prefix}DECLARATION_MEMO_SHA256`],
  );
  const declarationMemoBytes = optionalSafeInteger(
    env[`${prefix}DECLARATION_MEMO_BYTES`],
    1,
  );
  const declarationProtocolVout = optionalSafeInteger(
    env[`${prefix}DECLARATION_PROTOCOL_VOUT`],
  );
  const declarationRecordOrdinal = optionalSafeInteger(
    env[`${prefix}DECLARATION_RECORD_ORDINAL`],
  );
  const declarationRegistryPaymentVout = optionalSafeInteger(
    env[`${prefix}DECLARATION_REGISTRY_PAYMENT_VOUT`],
  );
  const configuredActivationHeight = optionalSafeInteger(
    env[`${prefix}ACTIVATION_HEIGHT`],
    2,
  );
  const keys = [
    "DECLARATION_TXID",
    "DECLARATION_HEIGHT",
    "DECLARATION_BLOCK_HASH",
    "DECLARATION_BLOCK_INDEX",
    "DECLARATION_MEMO_SHA256",
    "DECLARATION_MEMO_BYTES",
    "DECLARATION_PROTOCOL_VOUT",
    "DECLARATION_RECORD_ORDINAL",
    "DECLARATION_REGISTRY_PAYMENT_VOUT",
    "ACTIVATION_HEIGHT",
  ];
  if (
    !keys.some(
      (key) => String(env[`${prefix}${key}`] ?? "") !== "",
    )
  ) {
    return Object.freeze({ configured: false });
  }
  if (
    !TXID_PATTERN.test(declarationTxid) ||
    declarationHeight === null ||
    !TXID_PATTERN.test(declarationBlockHash) ||
    declarationBlockIndex === null ||
    !TXID_PATTERN.test(declarationMemoSha256) ||
    declarationMemoBytes === null ||
    declarationProtocolVout === null ||
    declarationRecordOrdinal !== 0 ||
    declarationRegistryPaymentVout === null ||
    declarationMemoBytes !==
      declarationCommitment.protocolRecordBytes ||
    declarationMemoSha256 !==
      declarationCommitment.protocolRecordSha256 ||
    configuredActivationHeight !== declarationHeight + 1
  ) {
    throw new Error(
      "WORK precision V2 declaration pins are incomplete or inconsistent.",
    );
  }
  return Object.freeze({
    activationHeight: declarationHeight + 1,
    configured: true,
    declarationBlockHash,
    declarationBlockIndex,
    declarationHeight,
    declarationMemoBytes,
    declarationMemoSha256,
    declarationProtocolRecord: declarationCommitment.protocolRecord,
    declarationProtocolRecordBytes:
      declarationCommitment.protocolRecordBytes,
    declarationProtocolRecordSha256:
      declarationCommitment.protocolRecordSha256,
    declarationProtocolVout,
    declarationRecordOrdinal,
    declarationRegistryPaymentVout,
    declarationTextBytes: declarationCommitment.payloadBytes,
    declarationTextSha256: declarationCommitment.payloadSha256,
    declarationTxid,
  });
}

function canonicalCoreValueSats(value) {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(8)
      : String(value ?? "").trim();
  const match = /^([0-9]+)(?:\.([0-9]{0,8}))?$/u.exec(text);
  if (!match) {
    throw new Error(
      "Core returned a non-canonical declaration output value.",
    );
  }
  return (
    BigInt(match[1]) * 100_000_000n +
    BigInt(String(match[2] ?? "").padEnd(8, "0"))
  );
}

function coreOutputAddress(output) {
  return String(
    output?.scriptPubKey?.address ??
      output?.scriptpubkey_address ??
      output?.scriptPubKey?.addresses?.[0] ??
      "",
  ).trim();
}

async function canonicalBitcoinRpc(env, method, params = []) {
  const rpcUrl = String(env.BITCOIN_RPC_URL ?? "").trim();
  const rpcUser = String(env.BITCOIN_RPC_USER ?? "").trim();
  const rpcPassword = String(env.BITCOIN_RPC_PASSWORD ?? "").trim();
  if (!rpcUrl) {
    throw new Error(
      "BITCOIN_RPC_URL is required for WORK precision V2 evidence.",
    );
  }
  const headers = { "content-type": "application/json" };
  if (rpcUser || rpcPassword) {
    headers.authorization = `Basic ${Buffer.from(
      `${rpcUser}:${rpcPassword}`,
    ).toString("base64")}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    BITCOIN_RPC_TIMEOUT_MS,
  );
  try {
    const response = await fetch(rpcUrl, {
      body: JSON.stringify({
        id: `work-precision-v2-${method}`,
        jsonrpc: "1.0",
        method,
        params,
      }),
      headers,
      method: "POST",
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
      throw new Error(
        `Core RPC ${method} failed: ${
          payload?.error?.message ?? response.status
        }`,
      );
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

function declarationEvidenceCommitment(facts) {
  const committed = {
    authorityScriptPubKey: facts.authorityScriptPubKey,
    blockHash: facts.blockHash,
    blockHeight: facts.blockHeight,
    blockTransactionIndex: facts.blockTransactionIndex,
    inputCount: facts.inputCount,
    outputCount: facts.outputCount,
    payloadBytes: facts.payloadBytes,
    payloadSha256: facts.payloadSha256,
    protocol: facts.protocol,
    protocolVout: facts.protocolVout,
    recordOrdinal: facts.recordOrdinal,
    registryAddress: facts.registryAddress,
    registryPaymentSats: facts.registryPaymentSats,
    registryPaymentVout: facts.registryPaymentVout,
    txid: facts.txid,
  };
  return Object.freeze({
    ...committed,
    commitmentSha256: sha256Hex(
      Buffer.from(
        `${WORK_PRECISION_V2_EVIDENCE_DOMAIN}\n${JSON.stringify(committed)}`,
        "utf8",
      ),
    ),
    model: WORK_PRECISION_V2_EVIDENCE_MODEL,
  });
}

function exactDeclarationFacts(facts, pins, source) {
  const normalized = {
    authorityScriptPubKey: normalizedLower(
      facts.authorityScriptPubKey,
    ),
    blockHash: normalizedLower(facts.blockHash),
    blockHeight: Number(facts.blockHeight),
    blockTransactionIndex: Number(facts.blockTransactionIndex),
    inputCount: Number(facts.inputCount),
    outputCount: Number(facts.outputCount),
    payloadBytes: Number(facts.payloadBytes),
    payloadSha256: normalizedLower(facts.payloadSha256),
    protocol: normalizedLower(facts.protocol),
    protocolVout: Number(facts.protocolVout),
    recordOrdinal: Number(facts.recordOrdinal),
    registryAddress: String(facts.registryAddress ?? "").trim(),
    registryPaymentSats: exactInteger(facts.registryPaymentSats),
    registryPaymentVout: Number(facts.registryPaymentVout),
    txid: normalizedLower(facts.txid),
  };
  if (
    normalized.txid !== pins.declarationTxid ||
    normalized.blockHash !== pins.declarationBlockHash ||
    normalized.blockHeight !== pins.declarationHeight ||
    normalized.blockTransactionIndex !== pins.declarationBlockIndex ||
    normalized.payloadSha256 !== pins.declarationMemoSha256 ||
    normalized.payloadBytes !== pins.declarationMemoBytes ||
    normalized.protocolVout !== pins.declarationProtocolVout ||
    normalized.recordOrdinal !== pins.declarationRecordOrdinal ||
    normalized.registryPaymentVout !==
      pins.declarationRegistryPaymentVout ||
    normalized.authorityScriptPubKey !==
      WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY ||
    normalized.registryAddress !==
      WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS ||
    BigInt(normalized.registryPaymentSats) <
      BigInt(WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS) ||
    normalized.inputCount < 1 ||
    normalized.outputCount < 1 ||
    normalized.protocol !== "pwm1"
  ) {
    throw new Error(
      `WORK precision V2 ${source} declaration evidence mismatch.`,
    );
  }
  return normalized;
}

export async function indexedWorkPrecisionV2DeclarationEvidence(
  client,
  pins,
) {
  const result = await client.query(
    `
      SELECT
        tx.txid,
        tx.block_hash,
        tx.block_height,
        tx.block_index,
        COALESCE(
          tx.raw_tx #>> '{vin,0,prevout,scriptPubKey,hex}',
          tx.raw_tx #>> '{vin,0,prevout,scriptpubkey}',
          ''
        ) AS authority_scriptpubkey,
        (SELECT count(*)::integer FROM proof_indexer.tx_inputs i
          WHERE i.network = tx.network AND i.txid = tx.txid) AS input_count,
        (SELECT count(*)::integer FROM proof_indexer.tx_outputs o
          WHERE o.network = tx.network AND o.txid = tx.txid) AS output_count,
        carrier.protocol,
        carrier.payload_text,
        carrier.payload_hex,
        carrier.data_bytes,
        registry.address AS registry_address,
        registry.value_sats::text AS registry_payment_sats
      FROM proof_indexer.transactions tx
      JOIN proof_indexer.blocks block
        ON block.network = tx.network
       AND block.block_hash = tx.block_hash
       AND block.height = tx.block_height
       AND block.canonical = true
      JOIN proof_indexer.op_returns carrier
        ON carrier.network = tx.network
       AND carrier.txid = tx.txid
       AND carrier.vout = $5
       AND carrier.output_index = $6
      JOIN proof_indexer.tx_outputs registry
        ON registry.network = tx.network
       AND registry.txid = tx.txid
       AND registry.vout = $7
      WHERE tx.network = 'livenet'
        AND tx.txid = $1
        AND tx.status = 'confirmed'
        AND tx.block_height = $2
        AND lower(tx.block_hash) = $3
        AND tx.block_index = $4
      LIMIT 2
    `,
    [
      pins.declarationTxid,
      pins.declarationHeight,
      pins.declarationBlockHash,
      pins.declarationBlockIndex,
      pins.declarationProtocolVout,
      pins.declarationRecordOrdinal,
      pins.declarationRegistryPaymentVout,
    ],
  );
  if (result.rows.length !== 1) {
    throw new Error(
      "WORK precision V2 declaration is not one confirmed canonical indexed record.",
    );
  }
  const row = result.rows[0];
  const payloadHex = normalizedLower(row.payload_hex);
  if (!HEX_BYTES_PATTERN.test(payloadHex)) {
    throw new Error(
      "WORK precision V2 indexed declaration payload bytes are unavailable.",
    );
  }
  const payload = Buffer.from(payloadHex, "hex");
  if (
    !payload.equals(Buffer.from(pins.declarationProtocolRecord, "utf8")) ||
    row.payload_text !== pins.declarationProtocolRecord ||
    Number(row.data_bytes) !== payload.length
  ) {
    throw new Error(
      "WORK precision V2 indexed declaration payload is not exact.",
    );
  }
  return exactDeclarationFacts(
    {
      authorityScriptPubKey: row.authority_scriptpubkey,
      blockHash: row.block_hash,
      blockHeight: row.block_height,
      blockTransactionIndex: row.block_index,
      inputCount: row.input_count,
      outputCount: row.output_count,
      payloadBytes: payload.length,
      payloadSha256: sha256Hex(payload),
      protocol: row.protocol,
      protocolVout: pins.declarationProtocolVout,
      recordOrdinal: pins.declarationRecordOrdinal,
      registryAddress: row.registry_address,
      registryPaymentSats: row.registry_payment_sats,
      registryPaymentVout: pins.declarationRegistryPaymentVout,
      txid: row.txid,
    },
    pins,
    "proof-index",
  );
}

export async function coreWorkPrecisionV2DeclarationEvidence(
  pins,
  rpc,
) {
  const canonicalBlockHash = normalizedLower(
    await rpc("getblockhash", [pins.declarationHeight]),
  );
  if (canonicalBlockHash !== pins.declarationBlockHash) {
    throw new Error(
      "WORK precision V2 declaration block is not canonical in Core.",
    );
  }
  const block = await rpc("getblock", [canonicalBlockHash, 2]);
  const declarationTx = block?.tx?.[pins.declarationBlockIndex];
  if (
    normalizedLower(block?.hash) !== canonicalBlockHash ||
    Number(block?.height) !== pins.declarationHeight ||
    normalizedLower(declarationTx?.txid) !== pins.declarationTxid
  ) {
    throw new Error(
      "WORK precision V2 declaration Core block position is not exact.",
    );
  }
  const inputs = Array.isArray(declarationTx?.vin)
    ? declarationTx.vin
    : [];
  const outputs = Array.isArray(declarationTx?.vout)
    ? declarationTx.vout
    : [];
  const firstInput = inputs[0];
  let previousOutput = firstInput?.prevout;
  if (!previousOutput?.scriptPubKey && !previousOutput?.scriptpubkey) {
    const previousTx = await rpc("getrawtransaction", [
      normalizedLower(firstInput?.txid),
      true,
    ]);
    previousOutput = previousTx?.vout?.[Number(firstInput?.vout)];
  }
  const authorityScriptPubKey = normalizedLower(
    previousOutput?.scriptPubKey?.hex ??
      previousOutput?.scriptpubkey,
  );
  const protocolCandidate = canonicalProtocolCandidateFromOutput(
    outputs[pins.declarationProtocolVout],
  );
  const payloadHex = normalizedLower(protocolCandidate?.payloadHex);
  if (
    protocolCandidate?.decodeValid !== true ||
    !HEX_BYTES_PATTERN.test(payloadHex)
  ) {
    throw new Error(
      "WORK precision V2 Core declaration payload is not canonical UTF-8.",
    );
  }
  const payload = Buffer.from(payloadHex, "hex");
  if (!payload.equals(Buffer.from(pins.declarationProtocolRecord, "utf8"))) {
    throw new Error(
      "WORK precision V2 Core declaration payload is not exact.",
    );
  }
  const registryOutput =
    outputs[pins.declarationRegistryPaymentVout];
  return exactDeclarationFacts(
    {
      authorityScriptPubKey,
      blockHash: canonicalBlockHash,
      blockHeight: pins.declarationHeight,
      blockTransactionIndex: pins.declarationBlockIndex,
      inputCount: inputs.length,
      outputCount: outputs.length,
      payloadBytes: payload.length,
      payloadSha256: sha256Hex(payload),
      protocol: String(protocolCandidate.prefix ?? "").replace(/:$/u, ""),
      protocolVout: pins.declarationProtocolVout,
      recordOrdinal: pins.declarationRecordOrdinal,
      registryAddress: coreOutputAddress(registryOutput),
      registryPaymentSats:
        canonicalCoreValueSats(registryOutput?.value).toString(),
      registryPaymentVout: pins.declarationRegistryPaymentVout,
      txid: declarationTx.txid,
    },
    pins,
    "Core",
  );
}

export function exactWorkPrecisionV2DeclarationEvidence(
  indexedEvidence,
  coreEvidence,
) {
  if (stableJson(indexedEvidence) !== stableJson(coreEvidence)) {
    throw new Error(
      "WORK precision V2 Core and proof-index declaration evidence diverge.",
    );
  }
  return Object.freeze({
    ...declarationEvidenceCommitment(coreEvidence),
    coreVerified: true,
    evidenceComplete: true,
    indexVerified: true,
  });
}

async function exactCoreTipEvidence(rpc) {
  const beforeHeight = Number(await rpc("getblockcount", []));
  if (!Number.isSafeInteger(beforeHeight) || beforeHeight < 1) {
    throw new Error("Core returned an invalid WORK migration tip height.");
  }
  const [bestHashValue, heightHashValue, afterHeightValue] =
    await Promise.all([
      rpc("getbestblockhash", []),
      rpc("getblockhash", [beforeHeight]),
      rpc("getblockcount", []),
    ]);
  const afterHeight = Number(afterHeightValue);
  const bestHash = normalizedLower(bestHashValue);
  const heightHash = normalizedLower(heightHashValue);
  if (
    afterHeight !== beforeHeight ||
    !/^[0-9a-f]{64}$/u.test(bestHash) ||
    heightHash !== bestHash
  ) {
    throw new Error(
      "Core tip changed while WORK precision migration evidence was read.",
    );
  }
  return Object.freeze({
    hash: bestHash,
    height: beforeHeight,
  });
}

async function constraintDefinition(client, tableName, constraintName) {
  const result = await client.query(
    `
      SELECT pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = to_regclass($1)
        AND constraint_row.conname = $2
      LIMIT 1
    `,
    [`proof_indexer.${tableName}`, constraintName],
  );
  return String(result.rows[0]?.definition ?? "");
}

export function workPrecisionV2ConstraintAudit(definitions) {
  const source =
    definitions &&
    typeof definitions === "object" &&
    !Array.isArray(definitions)
      ? definitions
      : {};
  const definitionPrecision = String(
    source.definitionPrecision ?? "",
  );
  const v6Values = String(source.v6Values ?? "");
  const v6Deactivation = String(
    source.v6Deactivation ?? "",
  );
  const v7Values = String(source.v7Values ?? "");
  const transitionModels = String(
    source.transitionModels ?? "",
  );
  const hasIntegerLiteral = (definition, value) =>
    new RegExp(`(?:^|[^0-9])${value}(?:[^0-9]|$)`, "u").test(
      definition,
    );
  return Object.freeze({
    definitionPrecisionReady:
      definitionPrecision.includes("work-atoms-v1") &&
      definitionPrecision.includes("work-subatoms-v2") &&
      hasIntegerLiteral(
        definitionPrecision,
        "10000000000000000",
      ),
    v6Q8Ready:
      v6Values.includes("2100000000000000") &&
      !v6Values.includes("210000000000000000000000") &&
      !hasIntegerLiteral(v6Values, "10000000000000000"),
    v6DeactivationInstalled:
      /listing_block_height\s*<\s*[1-9][0-9]*/u.test(
        v6Deactivation,
      ),
    v7Q16Ready:
      v7Values.includes("210000000000000000000000") &&
      hasIntegerLiteral(v7Values, "10000000000000000"),
    v7TransitionReady:
      transitionModels.includes(
        "canonical-work-amo-full-position-block-sequencer-v3",
      ) &&
      transitionModels.includes(
        "canonical-work-token-state-subatoms-v2",
      ),
  });
}

export async function auditWorkPrecisionV2Schema(client) {
  const relationResult = await client.query(
    `
      SELECT
        to_regclass('proof_indexer.work_amo_v6_listing_terms') IS NOT NULL
          AS v6_terms_ready,
        to_regclass('proof_indexer.work_amo_v7_listing_terms') IS NOT NULL
          AS v7_terms_ready,
        EXISTS (
          SELECT 1
          FROM pg_trigger trigger_row
          JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
          JOIN pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND relation.relname = 'work_amo_v7_listing_terms'
            AND trigger_row.tgname =
              'work_amo_v7_listing_terms_immutable'
            AND trigger_row.tgenabled <> 'D'
            AND trigger_row.tgisinternal = false
        ) AS v7_immutable_ready,
        EXISTS (
          SELECT 1
          FROM pg_trigger trigger_row
          JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
          JOIN pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND relation.relname = 'meta'
            AND trigger_row.tgname =
              'work_precision_v2_marker_immutable'
            AND trigger_row.tgenabled <> 'D'
            AND trigger_row.tgisinternal = false
        ) AS marker_immutable_ready
    `,
  );
  const definitions = {
    definitionPrecision: await constraintDefinition(
      client,
      "credit_definitions",
      "credit_definitions_work_precision",
    ),
    v6Values: await constraintDefinition(
      client,
      "work_amo_v6_listing_terms",
      "work_amo_v6_terms_values",
    ),
    v6Deactivation: await constraintDefinition(
      client,
      "work_amo_v6_listing_terms",
      WORK_PRECISION_V2_V6_DEACTIVATION_CONSTRAINT,
    ),
    v7Values: await constraintDefinition(
      client,
      "work_amo_v7_listing_terms",
      "work_amo_v7_terms_values",
    ),
    transitionModels: await constraintDefinition(
      client,
      "work_amo_block_transitions",
      "work_amo_block_transitions_models",
    ),
  };
  const constraints = workPrecisionV2ConstraintAudit(definitions);
  const row = relationResult.rows[0] ?? {};
  const ready =
    row.v6_terms_ready === true &&
    row.v7_terms_ready === true &&
    row.v7_immutable_ready === true &&
    row.marker_immutable_ready === true &&
    constraints.definitionPrecisionReady &&
    constraints.v6Q8Ready &&
    constraints.v7Q16Ready &&
    constraints.v7TransitionReady;
  return Object.freeze({
    ...constraints,
    markerImmutableReady: row.marker_immutable_ready === true,
    ready,
    v6TermsReady: row.v6_terms_ready === true,
    v7ImmutableReady: row.v7_immutable_ready === true,
    v7TermsReady: row.v7_terms_ready === true,
  });
}

function definitionPrecisionState(row) {
  const metadata =
    row?.metadata &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
      ? row.metadata
      : {};
  const q8 =
    String(row?.max_supply ?? "") === WORK_MAX_SUPPLY_ATOMS &&
    String(row?.mint_amount ?? "") === WORK_MINT_AMOUNT_ATOMS &&
    metadata.amountStorageModel ===
      WORK_LEGACY_ATOMIC_PROJECTION_MODEL &&
    Number(metadata.decimals) === WORK_LEGACY_DECIMALS &&
    String(metadata.unitScale ?? "") === WORK_LEGACY_UNIT_SCALE_TEXT;
  const q16 =
    String(row?.max_supply ?? "") ===
      WORK_AMO_V7_MAX_SUPPLY_SUBATOMS.toString() &&
    String(row?.mint_amount ?? "") ===
      WORK_AMO_V7_MINT_AMOUNT_SUBATOMS.toString() &&
    metadata.amountStorageModel === WORK_SUBATOM_PROJECTION_MODEL &&
    Number(metadata.decimals) === WORK_AMO_V7_DECIMALS &&
    String(metadata.unitScale ?? "") ===
      WORK_SUBATOM_UNIT_SCALE_TEXT &&
    metadata.precisionModel === WORK_AMO_V7_GLOBAL_PRECISION_MODEL;
  return q8 ? "q8" : q16 ? "q16" : "invalid";
}

async function readMigrationState(client) {
  const [definitionResult, balanceResult, listingResult] =
    await Promise.all([
      client.query(
        `
          SELECT max_supply::text, mint_amount::text, metadata
          FROM proof_indexer.credit_definitions
          WHERE network = 'livenet' AND token_id = $1
          LIMIT 2
        `,
        [WORK_TOKEN_ID],
      ),
      client.query(
        `
          SELECT
            address,
            confirmed_balance::text AS confirmed_balance,
            pending_delta::text AS pending_delta
          FROM proof_indexer.credit_balances
          WHERE network = 'livenet' AND token_id = $1
          ORDER BY address ASC
        `,
        [WORK_TOKEN_ID],
      ),
      client.query(
        `
          SELECT
            listing_id,
            amount::text AS amount
          FROM proof_indexer.credit_listings
          WHERE network = 'livenet' AND token_id = $1
          ORDER BY listing_id ASC
        `,
        [WORK_TOKEN_ID],
      ),
    ]);
  if (definitionResult.rows.length !== 1) {
    throw new Error(
      "WORK precision migration requires one canonical WORK definition.",
    );
  }
  return {
    balances: balanceResult.rows,
    definition: definitionResult.rows[0],
    listings: listingResult.rows,
  };
}

async function readWorkPrecisionV2ActivationOpening(
  client,
  pins,
) {
  const result = await client.query(
    `
      SELECT
        transition.block_hash,
        transition.block_height,
        transition.model,
        transition.payload,
        transition.closing_state_sha256,
        transition.closing_state_payload_bytes
      FROM proof_indexer.work_amo_block_transitions transition
      JOIN proof_indexer.blocks block
        ON block.network = transition.network
       AND block.block_hash = transition.block_hash
       AND block.height = transition.block_height
       AND block.canonical = true
      WHERE transition.network = 'livenet'
        AND transition.block_height = $1
        AND transition.block_hash = $2
        AND transition.complete = true
      LIMIT 2
    `,
    [pins.declarationHeight, pins.declarationBlockHash],
  );
  if (result.rows.length !== 1) {
    throw new Error(
      "WORK precision migration requires the exact canonical declaration-height closing transition.",
    );
  }
  const row = result.rows[0];
  const payload =
    row.payload &&
    typeof row.payload === "object" &&
    !Array.isArray(row.payload)
      ? row.payload
      : {};
  const legacyTokenState = payload.closingTokenState;
  const scaled = scaleWorkPrecisionV2TokenState(legacyTokenState);
  const committedTokenState = payload?.closingSufficientState
    ?.tokenStateCommitment;
  if (
    row.model !==
      "canonical-work-amo-full-position-block-sequencer-v2" ||
    Number(row.block_height) !== pins.declarationHeight ||
    normalizedLower(row.block_hash) !== pins.declarationBlockHash ||
    committedTokenState?.sha256 !==
      scaled.legacyCommitment.sha256 ||
    Number(committedTokenState?.payloadBytes) !==
      scaled.legacyCommitment.payloadBytes
  ) {
    throw new Error(
      "WORK precision activation opening does not bind the exact V6 declaration-height closing token state.",
    );
  }
  return Object.freeze({
    declarationClosingStateSha256: String(
      row.closing_state_sha256 ?? "",
    ),
    declarationClosingStatePayloadBytes: Number(
      row.closing_state_payload_bytes,
    ),
    declarationTransitionModel: row.model,
    ...scaled,
  });
}

function stateCommitments(state, { includePending = true } = {}) {
  return Object.freeze({
    balances: workPrecisionV2RowsCommitment(state.balances, {
      amountField: "confirmed_balance",
      keyField: "address",
      pendingField: includePending ? "pending_delta" : "",
    }),
    listings: workPrecisionV2RowsCommitment(state.listings, {
      amountField: "amount",
      keyField: "listing_id",
    }),
  });
}

function scaledState(state, { includePending = true } = {}) {
  return {
    balances: scaleWorkPrecisionV2Rows(state.balances, {
      amountField: "confirmed_balance",
      keyField: "address",
      pendingField: includePending ? "pending_delta" : "",
    }).map((row) => ({
      address: row.key,
      confirmed_balance: row.amount,
      ...(includePending ? { pending_delta: row.pending } : {}),
    })),
    listings: scaleWorkPrecisionV2Rows(state.listings, {
      amountField: "amount",
      keyField: "listing_id",
    }).map((row) => ({
      amount: row.amount,
      listing_id: row.key,
    })),
  };
}

function migrationStateFromLegacyTokenState(tokenState) {
  return {
    balances: tokenState.holders.map((holder) => ({
      address: holder.address,
      confirmed_balance: holder.balanceAtoms,
      pending_delta: "0",
    })),
    listings: tokenState.listings.map((listing) => ({
      amount: listing.amountAtoms,
      listing_id: listing.listingId,
    })),
  };
}

function markerInvariant(marker) {
  const value = { ...(marker ?? {}) };
  delete value.completedAt;
  delete value.updatedAt;
  return value;
}

export function workPrecisionV2MarkerMatches(stored, expected) {
  return Boolean(
    stored &&
      expected &&
      Number.isFinite(Date.parse(String(stored.completedAt ?? ""))) &&
      Number.isFinite(Date.parse(String(stored.updatedAt ?? ""))) &&
      stableJson(markerInvariant(stored)) ===
        stableJson(markerInvariant(expected)),
  );
}

export async function runWorkPrecisionV2Migration(
  client,
  {
    apply = false,
    env = process.env,
    rpc = null,
  } = {},
) {
  const pins = configuredWorkPrecisionV2Pins(env);
  const schema = await auditWorkPrecisionV2Schema(client);
  if (!schema.ready) {
    throw new Error(
      "WORK precision V2 schema is incomplete; apply proof-indexer-v1.sql first.",
    );
  }
  const markerResult = await client.query(
    `
      SELECT value
      FROM proof_indexer.meta
      WHERE key = $1
      LIMIT 2
    `,
    [WORK_PRECISION_V2_MIGRATION_META_KEY],
  );
  if (markerResult.rows.length > 1) {
    throw new Error("WORK precision V2 migration marker is not unique.");
  }
  const existingMarker = markerResult.rows[0]?.value ?? null;
  if (
    existingMarker &&
    existingMarker.model !== WORK_PRECISION_V2_MIGRATION_MODEL
  ) {
    throw new Error(
      "An incompatible WORK precision migration marker already exists.",
    );
  }
  const initialState = await readMigrationState(client);
  const initialPrecision = definitionPrecisionState(
    initialState.definition,
  );
  if (!pins.configured) {
    if (apply) {
      throw new Error(
        "WORK precision V2 migration apply waits for confirmed declaration pins.",
      );
    }
    return {
      applied: false,
      marker: existingMarker,
      precision: initialPrecision,
      schema,
      status: "awaiting-declaration",
    };
  }
  const rpcCall =
    typeof rpc === "function"
      ? rpc
      : (method, params = []) =>
          canonicalBitcoinRpc(env, method, params);
  const [indexedEvidence, coreEvidence, coreTip] =
    await Promise.all([
      indexedWorkPrecisionV2DeclarationEvidence(client, pins),
      coreWorkPrecisionV2DeclarationEvidence(pins, rpcCall),
      exactCoreTipEvidence(rpcCall),
    ]);
  const declarationEvidence =
    exactWorkPrecisionV2DeclarationEvidence(
      indexedEvidence,
      coreEvidence,
    );
  if (coreTip.height < pins.activationHeight) {
    throw new Error(
      "WORK precision V2 activation block has not been confirmed.",
    );
  }
  const activationOpening =
    await readWorkPrecisionV2ActivationOpening(client, pins);
  const activationLegacyState =
    migrationStateFromLegacyTokenState(
      activationOpening.legacyTokenState,
    );
  const expectedScaledState = scaledState(activationLegacyState, {
    includePending: false,
  });
  const before = stateCommitments(activationLegacyState, {
    includePending: false,
  });
  const after = stateCommitments(expectedScaledState, {
    includePending: false,
  });
  const markerTimestamp =
    existingMarker?.completedAt ?? new Date().toISOString();
  const migrationAlreadyComplete = initialPrecision === "q16";
  const marker = {
    activationHeight: pins.activationHeight,
    activationOpening: {
      declarationClosingStatePayloadBytes:
        activationOpening.declarationClosingStatePayloadBytes,
      declarationClosingStateSha256:
        activationOpening.declarationClosingStateSha256,
      declarationTransitionModel:
        activationOpening.declarationTransitionModel,
      legacyTokenStateCommitment:
        activationOpening.legacyCommitment,
      subatomTokenStateCommitment:
        activationOpening.subatomCommitment,
    },
    after,
    before,
    completedAt:
      apply || migrationAlreadyComplete ? markerTimestamp : null,
    conversionFactor: WORK_SUBATOM_CONVERSION_FACTOR.toString(),
    declarationBlockHash: pins.declarationBlockHash,
    declarationBlockIndex: pins.declarationBlockIndex,
    declarationEvidence,
    declarationHeight: pins.declarationHeight,
    declarationMemoBytes: pins.declarationMemoBytes,
    declarationMemoSha256: pins.declarationMemoSha256,
    declarationProtocolVout: pins.declarationProtocolVout,
    declarationRecordOrdinal: pins.declarationRecordOrdinal,
    declarationRegistryPaymentVout:
      pins.declarationRegistryPaymentVout,
    declarationTextBytes: pins.declarationTextBytes,
    declarationTextSha256: pins.declarationTextSha256,
    declarationTxid: pins.declarationTxid,
    decimals: WORK_AMO_V7_DECIMALS,
    globalPrecisionModel: WORK_AMO_V7_GLOBAL_PRECISION_MODEL,
    derivedProjectionPolicy:
      "invalidate-and-replay-from-activation",
    legacyDecimals: WORK_LEGACY_DECIMALS,
    legacyProjectionModel: WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
    maxSupplySubatoms:
      WORK_AMO_V7_MAX_SUPPLY_SUBATOMS.toString(),
    mintAmountSubatoms:
      WORK_AMO_V7_MINT_AMOUNT_SUBATOMS.toString(),
    migrationModel: WORK_AMO_V7_PRECISION_MIGRATION_MODEL,
    model: WORK_PRECISION_V2_MIGRATION_MODEL,
    network: "livenet",
    projectionModel: WORK_SUBATOM_PROJECTION_MODEL,
    rawConfirmedHistoryMutation: "none",
    replayFromHeight: pins.activationHeight,
    snapshotPolicy:
      "preserve-preactivation-canonical-invalidate-wrong-era-derived-require-post-migration-current-snapshot",
    status:
      apply || migrationAlreadyComplete
        ? "complete"
        : "ready-to-apply",
    transferVersion: WORK_AMO_V7_TRANSFER_VERSION,
    unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,
    updatedAt: markerTimestamp,
    version: WORK_AMO_V7_AUTH_VERSION,
  };
  if (initialPrecision === "q16") {
    if (
      !existingMarker ||
      !workPrecisionV2MarkerMatches(existingMarker, marker)
    ) {
      throw new Error(
        "WORK Q16 storage does not bind the exact configured activation-opening migration marker.",
      );
    }
    const currentConstraint = await constraintDefinition(
      client,
      "work_amo_v7_listing_terms",
      WORK_PRECISION_V2_ACTIVATION_CONSTRAINT,
    );
    const currentV6Constraint = await constraintDefinition(
      client,
      "work_amo_v6_listing_terms",
      WORK_PRECISION_V2_V6_DEACTIVATION_CONSTRAINT,
    );
    if (
      !currentConstraint.includes(
        `listing_block_height >= ${pins.activationHeight}`,
      ) ||
      !currentV6Constraint.includes(
        `listing_block_height < ${pins.activationHeight}`,
      )
    ) {
      throw new Error(
        "WORK Q16 storage is missing an exact V6/V7 activation boundary constraint.",
      );
    }
    return {
      applied: false,
      marker: existingMarker,
      precision: "q16",
      schema,
      status: "complete",
    };
  }
  if (initialPrecision !== "q8") {
    throw new Error(
      "WORK definition is neither exact historical Q8 nor canonical Q16.",
    );
  }
  if (existingMarker) {
    throw new Error(
      "WORK precision marker exists while canonical storage is still Q8.",
    );
  }
  if (!apply) {
    return {
      applied: false,
      declarationEvidence,
      marker,
      precision: "q8",
      schema,
      status: "ready-to-apply",
    };
  }

  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [WORK_PRECISION_V2_MIGRATION_META_KEY],
    );
    await client.query(
      `
        LOCK TABLE
          proof_indexer.blocks,
          proof_indexer.transactions,
          proof_indexer.tx_inputs,
          proof_indexer.tx_outputs,
          proof_indexer.op_returns,
          proof_indexer.events,
          proof_indexer.credit_definitions,
          proof_indexer.credit_balances,
          proof_indexer.credit_listings,
          proof_indexer.work_amo_listing_terms,
          proof_indexer.work_amo_v6_listing_terms,
          proof_indexer.work_amo_v7_listing_terms,
          proof_indexer.work_amo_block_transitions,
          proof_indexer.ledger_snapshots,
          proof_indexer.meta
        IN SHARE ROW EXCLUSIVE MODE
      `,
    );
    const lockedState = await readMigrationState(client);
    if (
      definitionPrecisionState(lockedState.definition) !== "q8"
    ) {
      throw new Error(
        "WORK definition changed before precision migration lock.",
      );
    }
    const lockedIndexedEvidence =
      await indexedWorkPrecisionV2DeclarationEvidence(client, pins);
    const lockedActivationOpening =
      await readWorkPrecisionV2ActivationOpening(client, pins);
    const lockedCoreEvidence =
      await coreWorkPrecisionV2DeclarationEvidence(pins, rpcCall);
    const lockedDeclarationEvidence =
      exactWorkPrecisionV2DeclarationEvidence(
        lockedIndexedEvidence,
        lockedCoreEvidence,
      );
    const lockedCoreTip = await exactCoreTipEvidence(rpcCall);
    const lockedIndexTipResult = await client.query(
      `
        SELECT height, block_hash
        FROM proof_indexer.blocks
        WHERE network = 'livenet' AND canonical = true
        ORDER BY height DESC
        LIMIT 2
      `,
    );
    const lockedIndexTip = lockedIndexTipResult.rows[0];
    if (
      stableJson(lockedDeclarationEvidence) !==
        stableJson(declarationEvidence) ||
      stableJson(lockedActivationOpening) !==
        stableJson(activationOpening) ||
      lockedCoreTip.height !== coreTip.height ||
      lockedCoreTip.hash !== coreTip.hash ||
      lockedIndexTipResult.rows.length < 1 ||
      Number(lockedIndexTip?.height) !== lockedCoreTip.height ||
      normalizedLower(lockedIndexTip?.block_hash) !==
        lockedCoreTip.hash
    ) {
      throw new Error(
        "WORK precision migration evidence, activation opening, or exact index/Core tip changed after transactional locks.",
      );
    }
    const existingActivationConstraint = await constraintDefinition(
      client,
      "work_amo_v7_listing_terms",
      WORK_PRECISION_V2_ACTIVATION_CONSTRAINT,
    );
    const existingV6DeactivationConstraint =
      await constraintDefinition(
        client,
        "work_amo_v6_listing_terms",
        WORK_PRECISION_V2_V6_DEACTIVATION_CONSTRAINT,
      );
    if (
      existingActivationConstraint &&
      !existingActivationConstraint.includes(
        `listing_block_height >= ${pins.activationHeight}`,
      )
    ) {
      throw new Error(
        "WORK AMO V7 activation constraint has a different height.",
      );
    }
    if (!existingActivationConstraint) {
      await client.query(
        `
          ALTER TABLE proof_indexer.work_amo_v7_listing_terms
          ADD CONSTRAINT ${WORK_PRECISION_V2_ACTIVATION_CONSTRAINT}
          CHECK (listing_block_height >= ${pins.activationHeight})
          NOT VALID
        `,
      );
      await client.query(
        `
          ALTER TABLE proof_indexer.work_amo_v7_listing_terms
          VALIDATE CONSTRAINT ${WORK_PRECISION_V2_ACTIVATION_CONSTRAINT}
        `,
      );
    }
    if (
      existingV6DeactivationConstraint &&
      !existingV6DeactivationConstraint.includes(
        `listing_block_height < ${pins.activationHeight}`,
      )
    ) {
      throw new Error(
        "WORK AMO V6 deactivation constraint has a different height.",
      );
    }
    if (!existingV6DeactivationConstraint) {
      await client.query(
        `
          ALTER TABLE proof_indexer.work_amo_v6_listing_terms
          ADD CONSTRAINT ${WORK_PRECISION_V2_V6_DEACTIVATION_CONSTRAINT}
          CHECK (listing_block_height < ${pins.activationHeight})
          NOT VALID
        `,
      );
      await client.query(
        `
          ALTER TABLE proof_indexer.work_amo_v6_listing_terms
          VALIDATE CONSTRAINT ${WORK_PRECISION_V2_V6_DEACTIVATION_CONSTRAINT}
        `,
      );
    }
    await client.query(
      `
        DELETE FROM proof_indexer.events event
        WHERE event.network = 'livenet'
          AND event.protocol = 'pwt1'
          AND (
            event.status <> 'confirmed'
            OR event.block_height >= $2
          )
          AND lower(COALESCE(
            NULLIF(event.payload->>'tokenId', ''),
            NULLIF(event.payload#>>'{saleAuthorization,tokenId}', ''),
            NULLIF(event.payload#>>'{listingAuthorization,tokenId}', ''),
            NULLIF(event.payload#>>'{actionAuthorization,tokenId}', ''),
            ''
          )) = $1
      `,
      [WORK_TOKEN_ID, pins.activationHeight],
    );
    await client.query(
      `
        DELETE FROM proof_indexer.credit_listings listing
        WHERE listing.network = 'livenet'
          AND listing.token_id = $1
          AND (
            listing.status IN ('pending', 'dropped', 'orphaned')
            OR NOT EXISTS (
              SELECT 1
              FROM proof_indexer.transactions listing_tx
              WHERE listing_tx.network = listing.network
                AND listing_tx.txid = listing.listing_id
                AND listing_tx.status = 'confirmed'
                AND listing_tx.block_height < $2
            )
          )
      `,
      [WORK_TOKEN_ID, pins.activationHeight],
    );
    await client.query(
      `
        DELETE FROM proof_indexer.meta
        WHERE key = 'workQ16PendingRebuild:livenet'
      `,
    );
    await client.query(
      `
        DELETE FROM proof_indexer.ledger_snapshots snapshot
        WHERE snapshot.network = 'livenet'
          AND snapshot.indexed_through_block >= $1
          AND COALESCE(snapshot.payload->>'model', '') <>
            'canonical-work-amo-v5-h-minus-one-seed-evidence-v1'
          AND NOT EXISTS (
            SELECT 1
            FROM proof_indexer.events evidence_event
            WHERE evidence_event.network = snapshot.network
              AND evidence_event.status = 'confirmed'
              AND evidence_event.payload::text LIKE
                ('%' || snapshot.snapshot_id || '%')
          )
          AND NOT EXISTS (
            SELECT 1
            FROM proof_indexer.meta evidence_meta
            WHERE evidence_meta.key = 'workAmoV5Migration:livenet'
              AND evidence_meta.value::text LIKE
              ('%' || snapshot.snapshot_id || '%')
          )
      `,
      [pins.activationHeight],
    );
    await client.query(
      `
        DELETE FROM proof_indexer.credit_balances
        WHERE network = 'livenet' AND token_id = $1
      `,
      [WORK_TOKEN_ID],
    );
    await client.query(
      `
        INSERT INTO proof_indexer.credit_balances (
          network,
          token_id,
          address,
          confirmed_balance,
          pending_delta,
          updated_at
        )
        SELECT
          'livenet',
          $1,
          opening.address,
          opening.confirmed_balance::numeric,
          0,
          now()
        FROM jsonb_to_recordset($2::jsonb) AS opening(
          address text,
          confirmed_balance text
        )
      `,
      [WORK_TOKEN_ID, JSON.stringify(expectedScaledState.balances)],
    );
    await client.query(
      `
        WITH opening AS (
          SELECT *
          FROM jsonb_to_recordset($3::jsonb) AS item(
            listing_id text,
            amount text
          )
        )
        UPDATE proof_indexer.credit_listings listing
        SET
          amount = opening.amount::numeric,
          buyer_address = NULL,
          close_txid = NULL,
          seal_txid = (
            SELECT lower(COALESCE(
              NULLIF(seal.payload->>'sealTxid', ''),
              seal.txid
            ))
            FROM proof_indexer.events seal
            WHERE seal.network = listing.network
              AND seal.kind = 'token-listing-sealed'
              AND seal.status = 'confirmed'
              AND seal.valid = true
              AND seal.block_height <= $2
              AND lower(COALESCE(
                seal.payload->>'listingId',
                ''
              )) = listing.listing_id
            ORDER BY
              seal.block_height DESC,
              seal.block_index DESC,
              seal.op_return_vout DESC,
              seal.record_ordinal DESC
            LIMIT 1
          ),
          payload = CASE
            WHEN EXISTS (
              SELECT 1
              FROM proof_indexer.events seal
              WHERE seal.network = listing.network
                AND seal.kind = 'token-listing-sealed'
                AND seal.status = 'confirmed'
                AND seal.valid = true
                AND seal.block_height <= $2
                AND lower(COALESCE(
                  seal.payload->>'listingId',
                  ''
                )) = listing.listing_id
            )
            THEN listing.payload
            ELSE listing.payload - ARRAY[
              'actionAuthorization',
              'buyerAddress',
              'sealAt',
              'sealBlockHeight',
              'sealBlockIndex',
              'sealConfirmed',
              'sealDataBytes',
              'sealMinerFeeSats',
              'sealProtocolVout',
              'sealRecordOrdinal',
              'sealTxid'
            ]::text[]
          END,
          status = CASE
            WHEN EXISTS (
              SELECT 1
              FROM proof_indexer.events seal
              WHERE seal.network = listing.network
                AND seal.kind = 'token-listing-sealed'
                AND seal.status = 'confirmed'
                AND seal.valid = true
                AND seal.block_height <= $2
                AND lower(COALESCE(
                  seal.payload->>'listingId',
                  ''
                )) = listing.listing_id
            )
            THEN 'sealing'
            ELSE 'active'
          END,
          updated_at = now()
        FROM opening
        WHERE listing.network = 'livenet'
          AND listing.token_id = $1
          AND listing.listing_id = opening.listing_id
      `,
      [
        WORK_TOKEN_ID,
        pins.declarationHeight,
        JSON.stringify(expectedScaledState.listings),
      ],
    );
    const openingListingCount = await client.query(
      `
        SELECT count(*)::integer AS count
        FROM proof_indexer.credit_listings listing
        JOIN jsonb_to_recordset($2::jsonb) AS opening(
          listing_id text,
          amount text
        ) ON opening.listing_id = listing.listing_id
        WHERE listing.network = 'livenet'
          AND listing.token_id = $1
          AND listing.amount = opening.amount::numeric
          AND listing.status IN ('active', 'sealing')
      `,
      [WORK_TOKEN_ID, JSON.stringify(expectedScaledState.listings)],
    );
    if (
      Number(openingListingCount.rows[0]?.count ?? 0) !==
        expectedScaledState.listings.length
    ) {
      throw new Error(
        "WORK activation-opening listing projection is incomplete.",
      );
    }
    await client.query(
      `
        UPDATE proof_indexer.credit_listings listing
        SET status = 'orphaned', updated_at = now()
        FROM proof_indexer.transactions listing_tx
        WHERE listing.network = 'livenet'
          AND listing.token_id = $1
          AND listing.status IN ('pending', 'active', 'sealing')
          AND listing_tx.network = listing.network
          AND listing_tx.txid = listing.listing_id
          AND (
            listing_tx.block_height >= $2
            OR listing_tx.status <> 'confirmed'
          )
      `,
      [WORK_TOKEN_ID, pins.activationHeight],
    );
    const {
      maxSupplyAtoms: _legacyMaxSupplyAtoms,
      mintAmountAtoms: _legacyMintAmountAtoms,
      ...legacyDefinitionMetadata
    } = lockedState.definition.metadata;
    void _legacyMaxSupplyAtoms;
    void _legacyMintAmountAtoms;
    const metadata = withWorkSubatomPrecisionMetadata({
      ...legacyDefinitionMetadata,
      maxSupplySubatoms:
        WORK_AMO_V7_MAX_SUPPLY_SUBATOMS.toString(),
      mintAmountSubatoms:
        WORK_AMO_V7_MINT_AMOUNT_SUBATOMS.toString(),
      precisionMigrationModel:
        WORK_PRECISION_V2_MIGRATION_MODEL,
      precisionModel: WORK_AMO_V7_GLOBAL_PRECISION_MODEL,
    });
    await client.query(
      `
        UPDATE proof_indexer.credit_definitions
        SET
          max_supply = $2::numeric,
          mint_amount = $3::numeric,
          metadata = $4::jsonb
        WHERE network = 'livenet'
          AND token_id = $1
          AND max_supply = $5::numeric
          AND mint_amount = $6::numeric
      `,
      [
        WORK_TOKEN_ID,
        WORK_AMO_V7_MAX_SUPPLY_SUBATOMS.toString(),
        WORK_AMO_V7_MINT_AMOUNT_SUBATOMS.toString(),
        JSON.stringify(metadata),
        WORK_MAX_SUPPLY_ATOMS,
        WORK_MINT_AMOUNT_ATOMS,
      ],
    );
    await client.query(
      `
        DELETE FROM proof_indexer.work_amo_block_transitions
        WHERE network = 'livenet' AND block_height >= $1
      `,
      [pins.activationHeight],
    );
    const migratedState = await readMigrationState(client);
    if (definitionPrecisionState(migratedState.definition) !== "q16") {
      throw new Error(
        "WORK definition did not reach exact canonical Q16 storage.",
      );
    }
    verifyWorkPrecisionV2RowsConserved(
      activationLegacyState.balances,
      migratedState.balances,
      {
        amountField: "confirmed_balance",
        keyField: "address",
      },
    );
    const migratedOpeningListings = await client.query(
      `
        SELECT listing.listing_id, listing.amount::text AS amount
        FROM proof_indexer.credit_listings listing
        JOIN jsonb_to_recordset($2::jsonb) AS opening(
          listing_id text,
          amount text
        ) ON opening.listing_id = listing.listing_id
        WHERE listing.network = 'livenet'
          AND listing.token_id = $1
        ORDER BY listing.listing_id ASC
      `,
      [WORK_TOKEN_ID, JSON.stringify(expectedScaledState.listings)],
    );
    verifyWorkPrecisionV2RowsConserved(
      activationLegacyState.listings,
      migratedOpeningListings.rows,
      {
        amountField: "amount",
        keyField: "listing_id",
      },
    );
    if (
      stableJson(
        stateCommitments(
          {
            balances: migratedState.balances,
            listings: migratedOpeningListings.rows,
          },
          { includePending: false },
        ),
      ) !== stableJson(after)
    ) {
      throw new Error(
        "WORK Q16 state commitments do not match the exact scaled state.",
      );
    }
    await client.query(
      `
        INSERT INTO proof_indexer.meta (key, value, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (key) DO NOTHING
      `,
      [
        WORK_PRECISION_V2_MIGRATION_META_KEY,
        JSON.stringify(marker),
      ],
    );
    const storedMarkerResult = await client.query(
      `
        SELECT value
        FROM proof_indexer.meta
        WHERE key = $1
        LIMIT 2
      `,
      [WORK_PRECISION_V2_MIGRATION_META_KEY],
    );
    if (
      storedMarkerResult.rows.length !== 1 ||
      !workPrecisionV2MarkerMatches(
        storedMarkerResult.rows[0]?.value,
        marker,
      )
    ) {
      throw new Error(
        "Immutable WORK precision V2 migration marker conflicts.",
      );
    }
    await client.query("COMMIT");
    return {
      applied: true,
      marker: storedMarkerResult.rows[0].value,
      precision: "q16",
      schema,
      status: "complete",
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function main() {
  const connectionString = String(
    process.env.POW_INDEX_DATABASE_URL ?? "",
  ).trim();
  if (!connectionString) {
    throw new Error("POW_INDEX_DATABASE_URL is required.");
  }
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    const result = await runWorkPrecisionV2Migration(client, {
      apply:
        process.env.WORK_PRECISION_V2_MIGRATION_APPLY === "1",
    });
    console.log(JSON.stringify(result));
  } finally {
    client.release();
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  await main();
}
