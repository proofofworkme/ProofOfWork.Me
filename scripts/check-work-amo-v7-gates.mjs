#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const apiSource = readFileSync("server/proof-api.mjs", "utf8");
const backfillSource = readFileSync(
  "scripts/backfill-proof-indexer.mjs",
  "utf8",
);

function topLevelFunctionSource(source, name) {
  const startPattern = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`,
    "mu",
  );
  const startMatch = startPattern.exec(source);
  if (!startMatch) {
    throw new Error(`Could not find ${name}.`);
  }
  const rest = source.slice(startMatch.index + startMatch[0].length);
  const nextMatch =
    /\n(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/mu.exec(
      rest,
    );
  const end = nextMatch
    ? startMatch.index + startMatch[0].length + nextMatch.index
    : source.length;
  return source
    .slice(startMatch.index, end)
    .trim()
    .replace(/^export\s+/u, "");
}

function isolatedFunctions(
  source,
  names,
  globals = {},
  stateSource = "",
) {
  const context = vm.createContext({
    Buffer,
    Map,
    console,
    ...globals,
  });
  const definitions = names
    .map((name) => topLevelFunctionSource(source, name))
    .join("\n\n");
  const exports = names
    .map((name) => `${JSON.stringify(name)}: ${name}`)
    .join(",");
  new vm.Script(
    `${stateSource}\n${definitions}\nthis.__checkedFunctions = {${exports}};`,
  ).runInContext(context);
  return context.__checkedFunctions;
}

function broadcastAdmissionFixture() {
  const workTokenId = "work-token";
  const registryAddress = "work-registry";
  const readyMetadata = Object.freeze({
    activation: {
      reached: true,
      tipVerified: true,
    },
    declarationDiscoveryReady: true,
    evidenceComplete: true,
    legacyWriteEmbargo: false,
    protocolReady: true,
    writeAdmission: true,
  });
  const { assertWorkMarketplaceBroadcastAllowed } = isolatedFunctions(
    apiSource,
    ["assertWorkMarketplaceBroadcastAllowed"],
    {
      TOKEN_DELIST_ACTION: "delist5",
      TOKEN_LIST_ACTION: "list5",
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      TOKEN_SEND_SUBATOMS_ACTION: "send3",
      PROTOCOL_PREFIX: "pwm1:",
      WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS: registryAddress,
      WORK_AMO_V6_DECLARATION_PINS_CONFIGURED: true,
      WORK_AMO_V7_DECLARATION_PINS_CONFIGURED: true,
      WORK_AMO_V7_DECLARATION_PINS_REQUESTED: true,
      WORK_AMO_V7_DECLARATION_PIN_STATE: "configured",
      WORK_TOKEN_ID: workTokenId,
      WORK_TOKEN_MINT_AMOUNT: "1000",
      WORK_TOKEN_MINT_PRICE_SATS: 1000,
      decodedOpReturnMessages: ([output]) =>
        Array.isArray(output?.messages) ? output.messages : [],
      decodedProtocolMessages: ([output], prefix) =>
        (Array.isArray(output?.messages) ? output.messages : [])
          .filter((message) => message.startsWith(prefix)),
      parseTokenPayload: (message) => {
        if (message === "pwt1:send3:work") {
          return {
            amountVersion: "send3",
            kind: "send",
            tokenId: workTokenId,
          };
        }
        if (message === "pwt1:send2:work") {
          return {
            amountVersion: "send2",
            kind: "send",
            tokenId: workTokenId,
          };
        }
        if (message === "pwt1:send3:other") {
          return {
            amountVersion: "send3",
            kind: "send",
            tokenId: "other-token",
          };
        }
        return null;
      },
      selectWorkAmoV5DistinctRegistryPayment: (
        outputs,
        {
          protocolVout,
          registryAddress: expectedRegistry,
          requiredSats,
          requireBeforeProtocol,
          claimedVouts = [],
        },
      ) => {
        const claimed = new Set(claimedVouts);
        const matches = outputs.filter(
          (output) =>
            output.address === expectedRegistry &&
            Number.isSafeInteger(output.valueSats) &&
            output.valueSats >= requiredSats &&
            !claimed.has(output.protocolVout) &&
            (
              requireBeforeProtocol !== true ||
              output.protocolVout < protocolVout
            ),
        );
        return matches.length > 0
          ? {
              registryPaymentSats: matches[0].valueSats,
              registryPaymentVout: matches[0].protocolVout,
            }
          : null;
      },
      signedTransactionOutputs: (fixture) => fixture,
      signedWorkAmoEconomicOutputs: (outputs) =>
        outputs.map((output, protocolVout) => ({
          ...output,
          protocolVout,
        })),
      signedWorkMarketplaceWriteActions: async () => [],
      workAmoV7Metadata: async () => readyMetadata,
    },
  );
  const transaction = (
    registryPaymentSats,
    messages,
    {
      protocolBeforePayment = [],
      protocolAfterPayment = [],
    } = {},
  ) => [
    ...protocolBeforePayment.map((message) => ({
      messages: [message],
    })),
    ...(Array.isArray(registryPaymentSats)
      ? registryPaymentSats
      : [registryPaymentSats]
    ).map((valueSats) => ({
      address: registryAddress,
      valueSats,
    })),
    ...protocolAfterPayment.map((message) => ({
      messages: [message],
    })),
    ...messages.map((message) => ({ messages: [message] })),
  ];
  return {
    assertWorkMarketplaceBroadcastAllowed,
    transaction,
  };
}

{
  const { assertWorkMarketplaceBroadcastAllowed, transaction } =
    broadcastAdmissionFixture();
  await assert.doesNotReject(
    assertWorkMarketplaceBroadcastAllowed(
      transaction(
        1_092,
        ["pwt1:send3:work", "pwt1:send3:work"],
        { protocolBeforePayment: ["pwm1:m:mail"] },
      ),
      "livenet",
    ),
    "two canonical send3 records must accept one exact 546*n payment",
  );
  await assert.doesNotReject(
    assertWorkMarketplaceBroadcastAllowed(
      transaction(600, ["pwt1:send3:work"]),
      "livenet",
    ),
    "one transfer retains the historical >=546 payment rule",
  );
  await assert.doesNotReject(
    assertWorkMarketplaceBroadcastAllowed(
      transaction(
        [546, 546],
        ["pwt1:send3:work", "pwt1:send3:work"],
      ),
      "livenet",
    ),
    "two distinct registry outputs remain valid",
  );
  await assert.rejects(
    assertWorkMarketplaceBroadcastAllowed(
      transaction(
        546,
        ["pwt1:send3:work", "pwt1:send3:work"],
      ),
      "livenet",
    ),
    (error) =>
      error?.details?.code ===
      "WORK_AMO_V7_TRANSFER_SHAPE_INVALID",
    "an underpaid aggregate registry output must fail closed",
  );
  await assert.rejects(
    assertWorkMarketplaceBroadcastAllowed(
      transaction(
        1_093,
        ["pwt1:send3:work", "pwt1:send3:work"],
      ),
      "livenet",
    ),
    (error) =>
      error?.details?.code ===
      "WORK_AMO_V7_TRANSFER_SHAPE_INVALID",
    "multi-transfer aggregate payment must be exact",
  );
  await assert.rejects(
    assertWorkMarketplaceBroadcastAllowed(
      transaction(1_092, [
        "pwt1:send3:work",
        "pwt1:send3:work",
        "pwt1:send3:other",
      ]),
      "livenet",
    ),
    (error) =>
      error?.details?.code ===
      "WORK_AMO_V7_TRANSFER_SHAPE_INVALID",
    "a mixed pwt record set must not reuse the WORK aggregate payment",
  );
  await assert.rejects(
    assertWorkMarketplaceBroadcastAllowed(
      transaction(
        1_092,
        ["pwt1:send3:work", "pwt1:send3:work"],
        { protocolAfterPayment: ["pwm1:m:late-mail"] },
      ),
      "livenet",
    ),
    (error) =>
      error?.details?.code ===
      "WORK_AMO_V7_TRANSFER_SHAPE_INVALID",
    "an aggregate payment cannot fund transfers around a later mail envelope",
  );
  await assert.rejects(
    assertWorkMarketplaceBroadcastAllowed(
      transaction(
        1_092,
        ["pwt1:send3:work", "pwt1:send3:work"],
        { protocolBeforePayment: ["pwa1:usd1:forbidden"] },
      ),
      "livenet",
    ),
    (error) =>
      error?.details?.code ===
      "WORK_AMO_V7_TRANSFER_SHAPE_INVALID",
    "aggregate WORK transfers permit only an earlier PWM envelope",
  );
}

{
  const calls = { discovery: 0 };
  const { workAmoV7ReplayPrecisionOptions } = isolatedFunctions(
    apiSource,
    ["workAmoV7ReplayPrecisionOptions"],
    {
      WORK_ATOMIC_PROJECTION_MODEL: "work-atoms-v1",
      WORK_SUBATOM_PROJECTION_MODEL: "work-subatoms-v2",
      discoverExactWorkAmoV7Declaration: async () => {
        calls.discovery += 1;
        return {
          checked: true,
          declaration: null,
        };
      },
      freshDataUnavailableError: (message) => new Error(message),
      proofIndexWorkAmoV7ActivationLatch: async () => ({
        markerReady: true,
        pins: {
          activationHeight: 101,
        },
        reached: true,
      }),
    },
  );
  const current = await workAmoV7ReplayPrecisionOptions(
    "livenet",
    102,
  );
  assert.equal(current.workAmoV7ActivationHeight, 101);
  assert.equal(
    current.workAmountStorageModel,
    "work-subatoms-v2",
  );
  const historical = await workAmoV7ReplayPrecisionOptions(
    "livenet",
    100,
  );
  assert.equal(historical.workAmoV7ActivationHeight, 101);
  assert.equal(
    historical.workAmountStorageModel,
    "work-atoms-v1",
  );
  assert.equal(
    calls.discovery,
    0,
    "the persistent activation latch must remain authoritative without env pins",
  );
}

const declarationCommitment = Object.freeze({
  protocolRecord: "pwm1:m:work-amo-v7-declaration",
  protocolRecordBytes: 34,
  protocolRecordSha256: "9".repeat(64),
});
const authorityScriptPubKey = "a".repeat(44);
const declarationRegistry = "work-registry";
const minimumDeclarationPayment = 1_000;
const canonicalTipHash = "f".repeat(64);

function declarationCandidate({
  blockHeight,
  blockIndex,
  duplicateCarrier = false,
  txid,
}) {
  const blockHash = blockHeight.toString(16).padStart(64, "0");
  const vout = [
    {
      address: declarationRegistry,
      value: minimumDeclarationPayment,
    },
    { message: declarationCommitment.protocolRecord },
  ];
  if (duplicateCarrier) {
    vout.push({ message: declarationCommitment.protocolRecord });
  }
  return {
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    txid,
    vin: [
      {
        prevout: {
          scriptpubkey: authorityScriptPubKey,
        },
      },
    ],
    vout,
  };
}

function declarationPins(candidate) {
  return {
    activationHeight: candidate.blockHeight + 1,
    authorityScriptPubKey,
    blockHash: candidate.blockHash,
    blockHeight: candidate.blockHeight,
    blockTransactionIndex: candidate.blockIndex,
    minimumPaymentSats: minimumDeclarationPayment,
    payloadBytes: declarationCommitment.protocolRecordBytes,
    payloadSha256: declarationCommitment.protocolRecordSha256,
    protocolVout: 1,
    recordOrdinal: 0,
    registryAddress: declarationRegistry,
    registryPaymentVout: 0,
    txid: candidate.txid,
  };
}

function apiDeclarationDiscoveryFixture(configured, candidates) {
  const byTxid = new Map(
    candidates.map((candidate) => [candidate.txid, candidate]),
  );
  const byHash = new Map(
    candidates.map((candidate) => [
      candidate.blockHash,
      candidate,
    ]),
  );
  return isolatedFunctions(
    apiSource,
    [
      "workAmoV7DeclarationsEqual",
      "discoverExactWorkAmoV7Declaration",
    ],
    {
      TX_FETCH_CONCURRENCY: 4,
      WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY:
        authorityScriptPubKey,
      WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS:
        minimumDeclarationPayment,
      WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS:
        declarationRegistry,
      WORK_AMO_V7_EXPECTED_DECLARATION_COMMITMENT:
        declarationCommitment,
      addressFromVout: (output) => output?.address ?? "",
      bitcoinRpc: async (method, params) => {
        if (method === "getblockcount") {
          return { ok: true, result: 500 };
        }
        if (method === "getbestblockhash") {
          return { ok: true, result: canonicalTipHash };
        }
        if (method === "getblockhash") {
          const candidate = candidates.find(
            (entry) => entry.blockHeight === Number(params?.[0]),
          );
          return {
            ok: Boolean(candidate),
            result: candidate?.blockHash ?? "",
          };
        }
        throw new Error(`Unexpected RPC method ${method}.`);
      },
      configuredWorkAmoV7Declaration: () => configured,
      decodedOpReturnAt: (outputs, vout) =>
        outputs?.[vout]?.message ?? "",
      errorSummary: (error) => String(error?.message ?? error),
      fetchCoreBlockTxidIndex: async (blockHash) => {
        const candidate = byHash.get(blockHash);
        return new Map(
          candidate
            ? [[candidate.txid, candidate.blockIndex]]
            : [],
        );
      },
      fetchRegistryTransactions: async () => candidates,
      fetchTransactionFromBitcoinRpc: async (txid) =>
        byTxid.get(txid) ?? null,
      mapWithConcurrency: async (items, _limit, mapper) =>
        Promise.all(items.map(mapper)),
      transactionBlockHash: (transaction) =>
        transaction?.blockHash ?? "",
      transactionBlockHeight: (transaction) =>
        transaction?.blockHeight ?? null,
      transactionConfirmed: (transaction) =>
        transaction?.confirmed === true,
      transactionTxid: (transaction) => transaction?.txid ?? "",
      workAmoV7DeclarationEvidenceFromTransaction: () => ({
        evidenceComplete: true,
      }),
    },
    `
      let workAmoV7DiscoveredDeclaration = null;
      let workAmoV7DeclarationEmbargoLatch = false;
      let workAmoV7DeclarationDiscoveryCache = {
        checked: false,
        declaration: null,
        error: "",
        expiresAt: 0,
        network: "",
        tipHash: "",
        tipHeight: 0,
      };
    `,
  ).discoverExactWorkAmoV7Declaration;
}

{
  const earliest = declarationCandidate({
    blockHeight: 100,
    blockIndex: 9,
    txid: "1".repeat(64),
  });
  const later = declarationCandidate({
    blockHeight: 101,
    blockIndex: 0,
    txid: "2".repeat(64),
  });
  const configuredLater = apiDeclarationDiscoveryFixture(
    declarationPins(later),
    [later, earliest],
  );
  const conflict = await configuredLater("livenet", {
    force: true,
  });
  assert.equal(conflict.checked, false);
  assert.match(
    conflict.error,
    /configured-pins-conflict-with-earliest-canonical-declaration/u,
  );

  const configuredEarliest = apiDeclarationDiscoveryFixture(
    declarationPins(earliest),
    [later, earliest],
  );
  const discovered = await configuredEarliest("livenet", {
    force: true,
  });
  assert.equal(discovered.checked, true);
  assert.equal(discovered.declaration?.txid, earliest.txid);

  const ambiguous = declarationCandidate({
    blockHeight: 102,
    blockIndex: 3,
    duplicateCarrier: true,
    txid: "3".repeat(64),
  });
  const configuredAmbiguous = apiDeclarationDiscoveryFixture(
    declarationPins(ambiguous),
    [ambiguous],
  );
  const ambiguousResult = await configuredAmbiguous("livenet", {
    force: true,
  });
  assert.equal(ambiguousResult.checked, false);
  assert.match(
    ambiguousResult.error,
    /configured-pins-conflict-with-earliest-canonical-declaration/u,
  );
}

function indexedPins(candidate) {
  return {
    activationHeight: candidate.block_height + 1,
    declarationBlockHash: candidate.block_hash,
    declarationBlockIndex: candidate.block_index,
    declarationHeight: candidate.block_height,
    declarationMemoBytes: candidate.data_bytes,
    declarationMemoSha256:
      declarationCommitment.protocolRecordSha256,
    declarationProtocolVout: candidate.protocol_vout,
    declarationRecordOrdinal: candidate.record_ordinal,
    declarationRegistryPaymentVout:
      candidate.registry_payment_vout,
    declarationTxid: candidate.txid,
  };
}

function indexDeclarationDiscoveryFixture(configured) {
  return isolatedFunctions(
    backfillSource,
    [
      "exactWorkAmoV7DeclarationPins",
      "discoverIndexedWorkAmoV7DeclarationPins",
    ],
    {
      NETWORK: "livenet",
      WORK_AMO_USD_QUOTE_AUTHORITY_SCRIPTPUBKEY:
        authorityScriptPubKey,
      WORK_AMO_USD_QUOTE_REGISTRY_ADDRESS:
        declarationRegistry,
      WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS:
        minimumDeclarationPayment,
      WORK_AMO_V7_EXPECTED_DECLARATION_COMMITMENT:
        declarationCommitment,
      canonicalJsonText: (value) => JSON.stringify(value),
      configuredWorkAmoV7DeclarationPins: () => configured,
      normalizedLowerText: (value) =>
        String(value ?? "").trim().toLowerCase(),
      objectValue: (value) =>
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
          ? value
          : {},
    },
  ).discoverIndexedWorkAmoV7DeclarationPins;
}

{
  const exactRow = {
    block_hash: "4".repeat(64),
    block_height: 200,
    block_index: 7,
    data_bytes: declarationCommitment.protocolRecordBytes,
    exact_carrier_count: 1,
    protocol_vout: 1,
    record_ordinal: 0,
    registry_payment_count: 1,
    registry_payment_vout: 0,
    txid: "5".repeat(64),
  };
  let queryCount = 0;
  let capturedSql = "";
  const configured = indexedPins(exactRow);
  const discoverExact =
    indexDeclarationDiscoveryFixture(configured);
  const result = await discoverExact({
    query: async (sql) => {
      queryCount += 1;
      capturedSql = sql;
      return { rows: [exactRow] };
    },
  });
  assert.equal(queryCount, 1);
  assert.equal(result.declarationTxid, exactRow.txid);
  assert.match(
    capturedSql,
    /ORDER BY\s+tx\.block_height ASC,\s+tx\.block_index ASC,\s+carrier\.vout ASC,\s+carrier\.output_index ASC[\s\S]*LIMIT 2/iu,
  );

  const discoverConflict = indexDeclarationDiscoveryFixture({
    ...configured,
    declarationTxid: "6".repeat(64),
  });
  await assert.rejects(
    discoverConflict({
      query: async () => ({ rows: [exactRow] }),
    }),
    /conflict with the earliest exact indexed declaration/u,
  );

  const discoverAmbiguous =
    indexDeclarationDiscoveryFixture(configured);
  await assert.rejects(
    discoverAmbiguous({
      query: async () => ({
        rows: [{
          ...exactRow,
          exact_carrier_count: 2,
        }],
      }),
    }),
    /ambiguous carrier or registry-payment evidence/u,
  );
}

console.log(
  "WORK AMO V7 gate regressions passed: aggregate transfer admission, persistent Q16 replay, and canonical declaration discovery.",
);
