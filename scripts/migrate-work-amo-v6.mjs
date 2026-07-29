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
  WORK_AMO_V6_ALLOWED_FACE_PROOFS,
  WORK_AMO_V6_AMOUNT_MODEL,
  WORK_AMO_V6_AUTH_VERSION,
  WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V6_BOND_TRANSITION_MODEL,
  WORK_AMO_V6_STATE_ORDER_MODEL,
  WORK_AMO_V6_UNIT_MODEL,
  WORK_AMO_V6_UNIT_WORK_ORACLE_MODEL,
} from "../server/work-amo-v6.mjs";
import {
  workAmoV6DeclarationCommitment,
} from "../server/work-amo-v6-declaration.mjs";

const { Pool } = pg;

export const WORK_AMO_V6_INDEX_MIGRATION_MODEL =
  "canonical-work-amo-v6-proof-native-index-migration-v1";
export const WORK_AMO_V6_INDEX_MIGRATION_META_KEY =
  "workAmoV6Migration:livenet";
export const WORK_AMO_V6_ACTIVATION_CONSTRAINT =
  "work_amo_v6_terms_activation";

const TXID_PATTERN = /^[0-9a-f]{64}$/u;
const HEX_BYTES_PATTERN = /^(?:[0-9a-f]{2})+$/u;
const BITCOIN_RPC_TIMEOUT_MS = 15_000;

function normalizedLower(value) {
  return String(value ?? "").trim().toLowerCase();
}

function optionalSafeInteger(value, minimum = 0) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

function configuredPins(env = process.env) {
  const declarationTxid = normalizedLower(
    env.WORK_AMO_V6_DECLARATION_TXID,
  );
  const declarationHeight = optionalSafeInteger(
    env.WORK_AMO_V6_DECLARATION_HEIGHT,
    1,
  );
  const declarationBlockHash = normalizedLower(
    env.WORK_AMO_V6_DECLARATION_BLOCK_HASH,
  );
  const declarationBlockIndex = optionalSafeInteger(
    env.WORK_AMO_V6_DECLARATION_BLOCK_INDEX,
    0,
  );
  const declarationMemoSha256 = normalizedLower(
    env.WORK_AMO_V6_DECLARATION_MEMO_SHA256,
  );
  const declarationMemoBytes = optionalSafeInteger(
    env.WORK_AMO_V6_DECLARATION_MEMO_BYTES,
    1,
  );
  const declarationProtocolVout = optionalSafeInteger(
    env.WORK_AMO_V6_DECLARATION_PROTOCOL_VOUT,
    0,
  );
  const declarationRecordOrdinal = optionalSafeInteger(
    env.WORK_AMO_V6_DECLARATION_RECORD_ORDINAL,
    0,
  );
  const declarationRegistryPaymentVout = optionalSafeInteger(
    env.WORK_AMO_V6_DECLARATION_REGISTRY_PAYMENT_VOUT,
    0,
  );
  const configuredActivationHeight = optionalSafeInteger(
    env.WORK_AMO_V6_ACTIVATION_HEIGHT,
    2,
  );
  const configured = [
    "WORK_AMO_V6_DECLARATION_TXID",
    "WORK_AMO_V6_DECLARATION_HEIGHT",
    "WORK_AMO_V6_DECLARATION_BLOCK_HASH",
    "WORK_AMO_V6_DECLARATION_BLOCK_INDEX",
    "WORK_AMO_V6_DECLARATION_MEMO_SHA256",
    "WORK_AMO_V6_DECLARATION_MEMO_BYTES",
    "WORK_AMO_V6_DECLARATION_PROTOCOL_VOUT",
    "WORK_AMO_V6_DECLARATION_RECORD_ORDINAL",
    "WORK_AMO_V6_DECLARATION_REGISTRY_PAYMENT_VOUT",
    "WORK_AMO_V6_ACTIVATION_HEIGHT",
  ].some((key) => String(env[key] ?? "").trim() !== "");
  if (!configured) {
    return { configured: false };
  }
  let declarationCommitment = null;
  try {
    declarationCommitment = workAmoV6DeclarationCommitment();
  } catch {
    declarationCommitment = null;
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
    !declarationCommitment ||
    declarationMemoBytes !==
      declarationCommitment.protocolRecordBytes ||
    declarationMemoSha256 !==
      declarationCommitment.protocolRecordSha256 ||
    (env.WORK_AMO_V6_ACTIVATION_HEIGHT !== undefined &&
      env.WORK_AMO_V6_ACTIVATION_HEIGHT !== "" &&
      (configuredActivationHeight === null ||
        configuredActivationHeight !== declarationHeight + 1))
  ) {
    throw new Error(
      "AMO V6 proof-native migration declaration pins are incomplete or inconsistent.",
    );
  }
  const activationHeight = declarationHeight + 1;
  return {
    activationHeight,
    configured: true,
    declarationBlockHash,
    declarationBlockIndex,
    declarationHeight,
    declarationMemoBytes,
    declarationMemoSha256,
    declarationProtocolRecord:
      declarationCommitment.protocolRecord,
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
  };
}

export async function auditWorkAmoV6IndexSchema(client) {
  const readiness = await client.query(
    `
      SELECT
        to_regclass('proof_indexer.work_amo_v6_listing_terms') IS NOT NULL
          AS listing_terms_ready,
        to_regclass('proof_indexer.work_amo_v6_attestations') IS NULL
          AS legacy_attestations_absent,
        to_regprocedure(
          'proof_indexer.valid_work_amo_v6_sources(jsonb,integer,bigint,integer)'
        ) IS NULL AS legacy_source_validator_absent
    `,
  );
  const readyRow = readiness.rows[0] ?? {};
  if (
    readyRow.listing_terms_ready !== true ||
    readyRow.legacy_attestations_absent !== true ||
    readyRow.legacy_source_validator_absent !== true
  ) {
    return {
      canonicalIndexesReady: false,
      immutableTriggersReady: false,
      invalidListingPolicyCount: 0,
      legacyOracleArtifactsAbsent:
        readyRow.legacy_attestations_absent === true &&
        readyRow.legacy_source_validator_absent === true,
      listingTermsCount: 0,
      listingTermsReady: readyRow.listing_terms_ready === true,
      proofNativeColumnsReady: false,
      policyConstraintsReady: false,
      ready: false,
    };
  }
  const result = await client.query(
    `
      SELECT
        (
          SELECT count(*) = 2
          FROM pg_trigger trigger_row
          JOIN pg_class relation
            ON relation.oid = trigger_row.tgrelid
          JOIN pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND (
              (
                relation.relname = 'work_amo_v6_listing_terms'
                AND trigger_row.tgname =
                  'work_amo_v6_listing_terms_immutable'
              )
              OR (
                relation.relname = 'meta'
                AND trigger_row.tgname =
                  'work_amo_v6_migration_marker_immutable'
              )
            )
            AND trigger_row.tgenabled <> 'D'
            AND trigger_row.tgisinternal = false
        ) AS immutable_triggers_ready,
        EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'proof_indexer'
            AND indexname =
              'work_amo_v6_listing_terms_position_uidx'
        ) AS canonical_indexes_ready,
        (
          SELECT count(*) = 4
          FROM pg_constraint constraint_row
          JOIN pg_class relation
            ON relation.oid = constraint_row.conrelid
          JOIN pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND relation.relname = 'work_amo_v6_listing_terms'
            AND constraint_row.contype = 'c'
            AND constraint_row.convalidated = true
            AND constraint_row.conname IN (
              'work_amo_v6_terms_identity',
              'work_amo_v6_terms_values',
              'work_amo_v6_terms_positions',
              'work_amo_v6_terms_frozen_payload'
            )
        ) AS policy_constraints_ready,
        (
          SELECT count(*) = 17
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'work_amo_v6_listing_terms'
            AND column_name IN (
              'listing_id',
              'listing_txid',
              'token_id',
              'authorization_version',
              'unit_face_proofs',
              'unit_amount_atoms',
              'unit_price_sats',
              'unit_minimum_price_sats',
              'listing_network_value_before_q8',
              'listing_block_height',
              'listing_block_hash',
              'listing_block_index',
              'listing_protocol_vout',
              'listing_record_ordinal',
              'listing_bond_contribution_q8',
              'listing_network_value_after_q8',
              'frozen_terms'
            )
        ) AND (
          SELECT count(*) = 19
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'work_amo_v6_listing_terms'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'work_amo_v6_listing_terms'
            AND (
              column_name = 'unit_face_usd_cents'
              OR column_name LIKE 'unit_usd_%'
            )
        ) AS proof_native_columns_ready,
        (
          SELECT count(*)::integer
          FROM proof_indexer.work_amo_v6_listing_terms
        ) AS listing_terms_count,
        (
          SELECT count(*)::integer
          FROM proof_indexer.work_amo_v6_listing_terms
          WHERE authorization_version <> $1
             OR unit_face_proofs <> ALL($2::integer[])
             OR unit_price_sats <> unit_face_proofs
             OR unit_minimum_price_sats <= 0
             OR unit_minimum_price_sats > unit_price_sats
        ) AS invalid_listing_policy_count
    `,
    [
      WORK_AMO_V6_AUTH_VERSION,
      WORK_AMO_V6_ALLOWED_FACE_PROOFS,
    ],
  );
  const row = result.rows[0] ?? {};
  const ready =
    row.immutable_triggers_ready === true &&
    row.canonical_indexes_ready === true &&
    row.policy_constraints_ready === true &&
    row.proof_native_columns_ready === true &&
    Number(row.invalid_listing_policy_count) === 0;
  return {
    canonicalIndexesReady: row.canonical_indexes_ready === true,
    immutableTriggersReady: row.immutable_triggers_ready === true,
    invalidListingPolicyCount: Number(
      row.invalid_listing_policy_count ?? 0,
    ),
    legacyOracleArtifactsAbsent: true,
    listingTermsCount: Number(row.listing_terms_count ?? 0),
    listingTermsReady: true,
    proofNativeColumnsReady: row.proof_native_columns_ready === true,
    policyConstraintsReady: row.policy_constraints_ready === true,
    ready,
  };
}
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalCoreBtcValueSats(value) {
  const text =
    typeof value === "number"
      ? Number.isFinite(value)
        ? value.toFixed(8)
        : ""
      : String(value ?? "").trim();
  const match = /^([0-9]+)(?:\.([0-9]{0,8}))?$/u.exec(text);
  if (!match) {
    throw new Error("Core returned a non-canonical declaration output value.");
  }
  const sats =
    BigInt(match[1]) * 100_000_000n +
    BigInt((match[2] ?? "").padEnd(8, "0"));
  if (sats > 2_100_000_000_000_000n) {
    throw new Error("Core returned an out-of-range declaration output value.");
  }
  return sats;
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
      "BITCOIN_RPC_URL is required for exact AMO V6 declaration evidence.",
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
        id: `work-amo-v6-migration-${method}`,
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
  return {
    ...committed,
    commitmentSha256: sha256Hex(
      Buffer.from(
        `ProofOfWork.Me/WORK-AMO-V6-DECLARATION-EVIDENCE/v1\n${
          JSON.stringify(committed)
        }`,
        "utf8",
      ),
    ),
    model: "canonical-work-amo-v6-declaration-core-index-evidence-v1",
  };
}

function exactDeclarationFacts(facts, pins, source) {
  const normalized = {
    authorityScriptPubKey: normalizedLower(facts.authorityScriptPubKey),
    blockHash: normalizedLower(facts.blockHash),
    blockHeight: Number(facts.blockHeight),
    blockTransactionIndex: Number(facts.blockTransactionIndex),
    evidenceComplete: facts.evidenceComplete === true,
    inputCount: Number(facts.inputCount),
    outputCount: Number(facts.outputCount),
    payloadBytes: Number(facts.payloadBytes),
    payloadSha256: normalizedLower(facts.payloadSha256),
    protocol: normalizedLower(facts.protocol),
    protocolVout: Number(facts.protocolVout),
    recordOrdinal: Number(facts.recordOrdinal),
    registryAddress: String(facts.registryAddress ?? "").trim(),
    registryPaymentSats: String(facts.registryPaymentSats ?? "").trim(),
    registryPaymentVout: Number(facts.registryPaymentVout),
    source,
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
    !/^[1-9][0-9]*$/u.test(normalized.registryPaymentSats) ||
    BigInt(normalized.registryPaymentSats) <
      BigInt(WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS) ||
    normalized.inputCount < 1 ||
    normalized.outputCount < 1 ||
    normalized.protocol !== "pwm1" ||
    normalized.evidenceComplete !== true
  ) {
    throw new Error(
      `AMO V6 ${source} declaration evidence mismatch: ${
        JSON.stringify(normalized)
      }`,
    );
  }
  return normalized;
}

export async function indexedWorkAmoV6DeclarationEvidence(client, pins) {
  const result = await client.query(
    `
      SELECT
        declaration_tx.txid,
        declaration_tx.status,
        declaration_tx.block_hash,
        declaration_tx.block_height,
        declaration_tx.block_index,
        COALESCE(
          declaration_tx.raw_tx #>>
            '{vin,0,prevout,scriptPubKey,hex}',
          declaration_tx.raw_tx #>>
            '{vin,0,prevout,scriptpubkey}',
          ''
        ) AS authority_scriptpubkey,
        (
          SELECT count(*)::integer
          FROM proof_indexer.tx_inputs declaration_input
          WHERE declaration_input.network = declaration_tx.network
            AND declaration_input.txid = declaration_tx.txid
        ) AS input_count,
        (
          SELECT count(*)::integer
          FROM proof_indexer.tx_outputs declaration_output
          WHERE declaration_output.network = declaration_tx.network
            AND declaration_output.txid = declaration_tx.txid
        ) AS output_count,
        (
          SELECT count(*)::integer
          FROM proof_indexer.op_returns declaration_protocol
          WHERE declaration_protocol.network = declaration_tx.network
            AND declaration_protocol.txid = declaration_tx.txid
            AND declaration_protocol.vout = $5
            AND declaration_protocol.output_index = $6
        ) AS protocol_count,
        (
          SELECT declaration_protocol.protocol
          FROM proof_indexer.op_returns declaration_protocol
          WHERE declaration_protocol.network = declaration_tx.network
            AND declaration_protocol.txid = declaration_tx.txid
            AND declaration_protocol.vout = $5
            AND declaration_protocol.output_index = $6
          LIMIT 1
        ) AS protocol,
        (
          SELECT declaration_protocol.payload_hex
          FROM proof_indexer.op_returns declaration_protocol
          WHERE declaration_protocol.network = declaration_tx.network
            AND declaration_protocol.txid = declaration_tx.txid
            AND declaration_protocol.vout = $5
            AND declaration_protocol.output_index = $6
          LIMIT 1
        ) AS payload_hex,
        (
          SELECT count(*)::integer
          FROM proof_indexer.events declaration_event
          WHERE declaration_event.network = declaration_tx.network
            AND declaration_event.txid = declaration_tx.txid
            AND declaration_event.status = 'confirmed'
            AND declaration_event.valid = true
            AND declaration_event.block_height =
              declaration_tx.block_height
            AND declaration_event.block_index =
              declaration_tx.block_index
            AND declaration_event.op_return_vout = $5
            AND declaration_event.record_ordinal = $6
            AND declaration_event.protocol = 'pwm1'
            AND declaration_event.raw_payload = $8
        ) AS indexed_event_count,
        (
          SELECT count(*)::integer
          FROM proof_indexer.tx_outputs registry_output
          WHERE registry_output.network = declaration_tx.network
            AND registry_output.txid = declaration_tx.txid
            AND registry_output.vout = $7
        ) AS registry_output_count,
        (
          SELECT registry_output.address
          FROM proof_indexer.tx_outputs registry_output
          WHERE registry_output.network = declaration_tx.network
            AND registry_output.txid = declaration_tx.txid
            AND registry_output.vout = $7
          LIMIT 1
        ) AS registry_address,
        (
          SELECT registry_output.value_sats::text
          FROM proof_indexer.tx_outputs registry_output
          WHERE registry_output.network = declaration_tx.network
            AND registry_output.txid = declaration_tx.txid
            AND registry_output.vout = $7
          LIMIT 1
        ) AS registry_payment_sats
      FROM proof_indexer.transactions declaration_tx
      JOIN proof_indexer.blocks block
        ON block.network = declaration_tx.network
       AND block.block_hash = declaration_tx.block_hash
       AND block.height = declaration_tx.block_height
       AND block.canonical = true
      WHERE declaration_tx.network = 'livenet'
        AND declaration_tx.txid = $1
        AND declaration_tx.status = 'confirmed'
        AND declaration_tx.block_height = $2
        AND lower(declaration_tx.block_hash) = $3
        AND declaration_tx.block_index = $4
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
      pins.declarationProtocolRecord,
    ],
  );
  if (result.rows.length !== 1) {
    throw new Error(
      "AMO V6 declaration pins do not match one confirmed canonical indexed transaction.",
    );
  }
  const row = result.rows[0];
  const payloadHex = normalizedLower(row.payload_hex);
  if (!HEX_BYTES_PATTERN.test(payloadHex)) {
    throw new Error(
      "AMO V6 indexed declaration payload bytes are unavailable.",
    );
  }
  const payload = Buffer.from(payloadHex, "hex");
  if (
    !payload.equals(
      Buffer.from(pins.declarationProtocolRecord, "utf8"),
    )
  ) {
    throw new Error(
      "AMO V6 indexed declaration is not the generated protocol record.",
    );
  }
  return exactDeclarationFacts(
    {
      authorityScriptPubKey: row.authority_scriptpubkey,
      blockHash: row.block_hash,
      blockHeight: row.block_height,
      blockTransactionIndex: row.block_index,
      evidenceComplete:
        row.status === "confirmed" &&
        Number(row.protocol_count) === 1 &&
        Number(row.indexed_event_count) === 1 &&
        Number(row.registry_output_count) === 1,
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

export async function coreWorkAmoV6DeclarationEvidence(
  pins,
  rpc,
) {
  const canonicalBlockHash = normalizedLower(
    await rpc("getblockhash", [pins.declarationHeight]),
  );
  if (canonicalBlockHash !== pins.declarationBlockHash) {
    throw new Error(
      "AMO V6 declaration block is no longer canonical in Core.",
    );
  }
  const block = await rpc("getblock", [canonicalBlockHash, 2]);
  const transactions = Array.isArray(block?.tx) ? block.tx : [];
  const declarationTx = transactions[pins.declarationBlockIndex];
  if (
    normalizedLower(block?.hash) !== canonicalBlockHash ||
    Number(block?.height) !== pins.declarationHeight ||
    !declarationTx ||
    typeof declarationTx !== "object" ||
    normalizedLower(declarationTx.txid) !== pins.declarationTxid
  ) {
    throw new Error(
      "AMO V6 declaration Core block position does not match the pins.",
    );
  }
  const inputs = Array.isArray(declarationTx.vin)
    ? declarationTx.vin
    : [];
  const outputs = Array.isArray(declarationTx.vout)
    ? declarationTx.vout
    : [];
  const firstInput = inputs[0];
  if (
    !firstInput ||
    typeof firstInput !== "object" ||
    typeof firstInput.coinbase === "string"
  ) {
    throw new Error("AMO V6 declaration authority input is unavailable.");
  }
  let previousOutput = firstInput.prevout;
  if (!previousOutput?.scriptPubKey && !previousOutput?.scriptpubkey) {
    const previousTxid = normalizedLower(firstInput.txid);
    const previousVout = Number(firstInput.vout);
    if (
      !TXID_PATTERN.test(previousTxid) ||
      !Number.isSafeInteger(previousVout) ||
      previousVout < 0
    ) {
      throw new Error(
        "AMO V6 declaration authority prevout is invalid.",
      );
    }
    const previousTx = await rpc("getrawtransaction", [
      previousTxid,
      true,
    ]);
    previousOutput = previousTx?.vout?.[previousVout];
  }
  const authorityScriptPubKey = normalizedLower(
    previousOutput?.scriptPubKey?.hex ??
      previousOutput?.scriptpubkey,
  );
  const protocolOutput = outputs[pins.declarationProtocolVout];
  const protocolCandidate =
    canonicalProtocolCandidateFromOutput(protocolOutput);
  const payloadHex = normalizedLower(protocolCandidate?.payloadHex);
  if (
    protocolCandidate?.decodeValid !== true ||
    !HEX_BYTES_PATTERN.test(payloadHex)
  ) {
    throw new Error(
      "AMO V6 declaration Core OP_RETURN payload is not canonical UTF-8.",
    );
  }
  const payload = Buffer.from(payloadHex, "hex");
  if (
    !payload.equals(
      Buffer.from(pins.declarationProtocolRecord, "utf8"),
    )
  ) {
    throw new Error(
      "AMO V6 Core declaration is not the generated protocol record.",
    );
  }
  const registryOutput =
    outputs[pins.declarationRegistryPaymentVout];
  const registryPaymentSats = canonicalCoreBtcValueSats(
    registryOutput?.value,
  );
  return exactDeclarationFacts(
    {
      authorityScriptPubKey,
      blockHash: canonicalBlockHash,
      blockHeight: pins.declarationHeight,
      blockTransactionIndex: pins.declarationBlockIndex,
      evidenceComplete: true,
      inputCount: inputs.length,
      outputCount: outputs.length,
      payloadBytes: payload.length,
      payloadSha256: sha256Hex(payload),
      protocol: String(protocolCandidate.prefix ?? "").replace(/:$/u, ""),
      protocolVout: pins.declarationProtocolVout,
      recordOrdinal: pins.declarationRecordOrdinal,
      registryAddress: coreOutputAddress(registryOutput),
      registryPaymentSats: registryPaymentSats.toString(),
      registryPaymentVout: pins.declarationRegistryPaymentVout,
      txid: declarationTx.txid,
    },
    pins,
    "Core",
  );
}

export function exactWorkAmoV6DeclarationEvidence(
  indexedEvidence,
  coreEvidence,
) {
  const fields = [
    "authorityScriptPubKey",
    "blockHash",
    "blockHeight",
    "blockTransactionIndex",
    "inputCount",
    "outputCount",
    "payloadBytes",
    "payloadSha256",
    "protocol",
    "protocolVout",
    "recordOrdinal",
    "registryAddress",
    "registryPaymentSats",
    "registryPaymentVout",
    "txid",
  ];
  if (
    fields.some(
      (field) => indexedEvidence?.[field] !== coreEvidence?.[field],
    )
  ) {
    throw new Error(
      "AMO V6 Core and proof-index declaration evidence diverge.",
    );
  }
  return {
    ...declarationEvidenceCommitment(coreEvidence),
    coreVerified: true,
    evidenceComplete: true,
    indexVerified: true,
  };
}

async function constraintDefinition(client, tableName, constraintName) {
  const result = await client.query(
    `
      SELECT pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid =
        to_regclass($1)
        AND constraint_row.conname = $2
      LIMIT 1
    `,
    [`proof_indexer.${tableName}`, constraintName],
  );
  return String(result.rows[0]?.definition ?? "");
}

function activationConstraintMatches(definition, activationHeight) {
  return Boolean(
    definition &&
      definition.includes(
        `listing_block_height >= ${activationHeight}`,
      ),
  );
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
  return JSON.stringify(value);
}

function storedMarkerMatchesExpected(stored, expected) {
  if (
    !stored ||
    typeof stored !== "object" ||
    Array.isArray(stored) ||
    typeof stored.completedAt !== "string" ||
    !Number.isFinite(Date.parse(stored.completedAt)) ||
    typeof stored.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(stored.updatedAt))
  ) {
    return false;
  }
  const storedInvariant = { ...stored };
  const expectedInvariant = { ...expected };
  delete storedInvariant.completedAt;
  delete storedInvariant.updatedAt;
  delete expectedInvariant.completedAt;
  delete expectedInvariant.updatedAt;
  return stableJson(storedInvariant) === stableJson(expectedInvariant);
}

export async function runWorkAmoV6IndexMigration(
  client,
  {
    apply = false,
    env = process.env,
    rpc = null,
  } = {},
) {
  const pins = configuredPins(env);
  const rpcCall =
    typeof rpc === "function"
      ? rpc
      : (method, params = []) =>
          canonicalBitcoinRpc(env, method, params);
  const audit = await auditWorkAmoV6IndexSchema(client);
  if (!audit.ready) {
    throw new Error(
      "Proof-native AMO V6 index schema is incomplete; apply proof-indexer-v1.sql first.",
    );
  }
  const existingMarker = await client.query(
    `
      SELECT value
      FROM proof_indexer.meta
      WHERE key = $1
      LIMIT 2
    `,
    [WORK_AMO_V6_INDEX_MIGRATION_META_KEY],
  );
  if (existingMarker.rows.length > 1) {
    throw new Error("AMO V6 migration marker is not unique.");
  }
  const existingMarkerValue = existingMarker.rows[0]?.value ?? null;
  if (
    existingMarkerValue &&
    existingMarkerValue.model !== WORK_AMO_V6_INDEX_MIGRATION_MODEL
  ) {
    throw new Error(
      "An incompatible AMO V6 migration marker already exists.",
    );
  }
  if (!pins.configured) {
    if (apply) {
      throw new Error(
        "Proof-native AMO V6 index migration apply waits for the confirmed declaration pins.",
      );
    }
    return {
      applied: false,
      audit,
      marker: existingMarkerValue,
      status: existingMarkerValue
        ? "declaration-pins-required"
        : "awaiting-declaration",
    };
  }
  const indexedDeclarationEvidence =
    await indexedWorkAmoV6DeclarationEvidence(
      client,
      pins,
    );
  const coreDeclarationEvidence =
    await coreWorkAmoV6DeclarationEvidence(
      pins,
      rpcCall,
    );
  const declarationEvidence = exactWorkAmoV6DeclarationEvidence(
    indexedDeclarationEvidence,
    coreDeclarationEvidence,
  );
  if (declarationEvidence.evidenceComplete !== true) {
    throw new Error(
      "Proof-native AMO V6 declaration does not have complete Core/index evidence.",
    );
  }
  const existingActivationConstraint = await constraintDefinition(
    client,
    "work_amo_v6_listing_terms",
    WORK_AMO_V6_ACTIVATION_CONSTRAINT,
  );
  if (
    existingActivationConstraint &&
    !activationConstraintMatches(
      existingActivationConstraint,
      pins.activationHeight,
    )
  ) {
    throw new Error(
      "AMO V6 activation constraint exists with a different height.",
    );
  }
  const markerTimestamp = new Date().toISOString();
  const marker = {
    activationHeight: pins.activationHeight,
    amountModel: WORK_AMO_V6_AMOUNT_MODEL,
    blockSequencerModel: WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,
    bondTransitionModel: WORK_AMO_V6_BOND_TRANSITION_MODEL,
    completedAt: apply ? markerTimestamp : null,
    declarationBlockHash: pins.declarationBlockHash,
    declarationBlockIndex: pins.declarationBlockIndex,
    declarationEvidence,
    declarationHeight: pins.declarationHeight,
    declarationMemoBytes: pins.declarationMemoBytes,
    declarationMemoSha256: pins.declarationMemoSha256,
    declarationProtocolRecordBytes:
      pins.declarationProtocolRecordBytes,
    declarationProtocolRecordSha256:
      pins.declarationProtocolRecordSha256,
    declarationProtocolVout: pins.declarationProtocolVout,
    declarationRecordOrdinal: pins.declarationRecordOrdinal,
    declarationRegistryAddress:
      WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    declarationRegistryMinimumPaymentSats:
      WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
    declarationRegistryPaymentVout:
      pins.declarationRegistryPaymentVout,
    declarationTextBytes: pins.declarationTextBytes,
    declarationTextSha256: pins.declarationTextSha256,
    declarationTxid: pins.declarationTxid,
    facesProofs: [...WORK_AMO_V6_ALLOWED_FACE_PROOFS],
    model: WORK_AMO_V6_INDEX_MIGRATION_MODEL,
    network: "livenet",
    stateOrderModel: WORK_AMO_V6_STATE_ORDER_MODEL,
    status: apply ? "complete" : "ready-to-apply",
    unitModel: WORK_AMO_V6_UNIT_MODEL,
    unitWorkOracleModel: WORK_AMO_V6_UNIT_WORK_ORACLE_MODEL,
    updatedAt: markerTimestamp,
    version: WORK_AMO_V6_AUTH_VERSION,
  };
  if (!apply) {
    return {
      applied: false,
      audit,
      declarationCanonical: true,
      declarationEvidence,
      marker,
      status: "ready-to-apply",
      wouldInstallActivationConstraint: !existingActivationConstraint,
    };
  }

  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [WORK_AMO_V6_INDEX_MIGRATION_META_KEY],
    );
    const transactionIndexedEvidence =
      await indexedWorkAmoV6DeclarationEvidence(client, pins);
    const transactionCoreEvidence =
      await coreWorkAmoV6DeclarationEvidence(pins, rpcCall);
    const transactionDeclarationEvidence =
      exactWorkAmoV6DeclarationEvidence(
        transactionIndexedEvidence,
        transactionCoreEvidence,
      );
    if (
      transactionDeclarationEvidence.commitmentSha256 !==
        declarationEvidence.commitmentSha256 ||
      transactionDeclarationEvidence.evidenceComplete !== true
    ) {
      throw new Error(
        "AMO V6 declaration evidence changed before migration apply.",
      );
    }
    const transactionMarker = await client.query(
      `
        SELECT value
        FROM proof_indexer.meta
        WHERE key = $1
        LIMIT 2
      `,
      [WORK_AMO_V6_INDEX_MIGRATION_META_KEY],
    );
    if (
      transactionMarker.rows.length > 1 ||
      (
        transactionMarker.rows.length === 1 &&
        transactionMarker.rows[0]?.value?.model !==
          WORK_AMO_V6_INDEX_MIGRATION_MODEL
      )
    ) {
      throw new Error(
        "An incompatible AMO V6 migration marker appeared during apply.",
      );
    }
    if (
      !(await constraintDefinition(
        client,
        "work_amo_v6_listing_terms",
        WORK_AMO_V6_ACTIVATION_CONSTRAINT,
      ))
    ) {
      await client.query(
        `
          ALTER TABLE proof_indexer.work_amo_v6_listing_terms
          ADD CONSTRAINT ${WORK_AMO_V6_ACTIVATION_CONSTRAINT}
          CHECK (listing_block_height >= ${pins.activationHeight})
          NOT VALID
        `,
      );
      await client.query(
        `
          ALTER TABLE proof_indexer.work_amo_v6_listing_terms
          VALIDATE CONSTRAINT ${WORK_AMO_V6_ACTIVATION_CONSTRAINT}
        `,
      );
    }
    const installedActivation = await constraintDefinition(
      client,
      "work_amo_v6_listing_terms",
      WORK_AMO_V6_ACTIVATION_CONSTRAINT,
    );
    if (
      !activationConstraintMatches(
        installedActivation,
        pins.activationHeight,
      )
    ) {
      throw new Error(
        "AMO V6 activation constraint is not exact.",
      );
    }
    const finalAudit = await auditWorkAmoV6IndexSchema(client);
    if (!finalAudit.ready) {
      throw new Error(
        "Proof-native AMO V6 index schema changed during migration.",
      );
    }
    await client.query(
      `
        INSERT INTO proof_indexer.meta (key, value, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (key)
        DO NOTHING
      `,
      [WORK_AMO_V6_INDEX_MIGRATION_META_KEY, JSON.stringify(marker)],
    );
    const storedMarkerResult = await client.query(
      `
        SELECT value
        FROM proof_indexer.meta
        WHERE key = $1
        LIMIT 2
      `,
      [WORK_AMO_V6_INDEX_MIGRATION_META_KEY],
    );
    const storedMarker = storedMarkerResult.rows[0]?.value ?? null;
    if (
      storedMarkerResult.rows.length !== 1 ||
      !storedMarkerMatchesExpected(storedMarker, marker)
    ) {
      throw new Error(
        "Immutable proof-native AMO V6 declaration/index marker conflicts with the exact evidence.",
      );
    }
    await client.query("COMMIT");
    return {
      applied: true,
      audit: finalAudit,
      declarationCanonical: true,
      marker: storedMarker,
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
    const result = await runWorkAmoV6IndexMigration(client, {
      apply: process.env.WORK_AMO_V6_MIGRATION_APPLY === "1",
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
