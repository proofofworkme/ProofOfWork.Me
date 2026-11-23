import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { Block, Transaction } from "bitcoinjs-lib";
import { canonicalRawProtocolRecordSetFromTransaction } from "../../server/canonical-op-return.mjs";
import { expandedLiquidityForReplay, verifyExpandedLiquidityDeclaration } from "../../server/work-amo-expanded-liquidity.mjs";
import {
  workAmoV5CanonicalStateCommitment, workAmoV5CanonicalPayloadCommitment,
  workAmoV5EventSetCommitment,
} from "../../server/work-amo-v5.mjs";
import { WORK_AMO_V8_BLOCK_SEQUENCER_MODEL, WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL } from "../../server/work-amo-v8.mjs";
import { assertBaselineReplay, assertScalarSeal, RESOURCE_LIMITS, MAX_SUFFIX_BLOCKS } from "../work-batch-replay/preflight.mjs";

export const DECLARATION_PINS = Object.freeze({
  txid: "57eb549372f2318bfc3ade62c62e9e1092cd42702e9ffb5e2733659acc241f33",
  blockHeight: 977229,
  blockHash: "0000000000000000000113f979011a14bdcecdb509671b763fc60a02ebaccbc9",
  blockTransactionIndex: 591, protocolVout: 1, recordOrdinal: 0, registryPaymentVout: null,
  firstEligibleBlockOffset: 1, firstEligibleTransactionIndex: 0,
});

function requireEvidence(valid, reason) {
  if (!valid) throw new Error(`AMO expanded replay: ${reason}`);
}

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const digest = value => workAmoV5CanonicalPayloadCommitment(value).sha256;
const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const commit = value => typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);

function rawBytes(hex, label) {
  requireEvidence(typeof hex === "string" && hex.length > 0 && hex.length <= 8_000_000 &&
    hex.length % 2 === 0 && !/[^0-9a-f]/u.test(hex), label);
  return Buffer.from(hex, "hex");
}

function outputs(tx) {
  return tx.outs.map(out => {
    const value = Number(out.value);
    requireEvidence(Number.isSafeInteger(value) && value >= 0, "unrepresentable Bitcoin output");
    return { scriptpubkey: Buffer.from(out.script).toString("hex"), value };
  });
}

function inputs(tx) {
  return tx.ins.map(input => Transaction.isCoinbaseHash(input.hash)
    ? { coinbase: Buffer.from(input.script).toString("hex") }
    : { txid: Buffer.from(input.hash).reverse().toString("hex"), vout: input.index });
}

// Both transaction IDs are recomputed from Core bytes; the prevout and carrier
// used by the ordinary declaration verifier are derived from those bytes.
export function verifyReplayDeclaration(evidence) {
  const tx = Transaction.fromBuffer(rawBytes(evidence?.transaction?.hex, "declaration bytes unavailable"));
  const parent = Transaction.fromBuffer(rawBytes(evidence.prevoutTransactionHex, "declaration parent unavailable"));
  const vin = inputs(tx);
  requireEvidence(evidence.transaction.txid === DECLARATION_PINS.txid && tx.getId() === DECLARATION_PINS.txid &&
    Array.isArray(evidence.canonicalBlock?.tx) && vin.length === 1 &&
    vin[0].txid === parent.getId(), "declaration outpoint differs");
  vin[0].prevout = outputs(parent)[vin[0].vout];
  const verified = verifyExpandedLiquidityDeclaration(DECLARATION_PINS, {
    ...evidence, transaction: { ...evidence.transaction, txid: tx.getId(), vin, vout: outputs(tx) },
  });
  requireEvidence(verified, "canonical declaration or indexed position differs");
  return verified;
}

function fullBlock(raw, height, expectedHash, previousHash) {
  const bytes = rawBytes(raw, "serialized block unavailable or too large");
  const block = Block.fromBuffer(bytes);
  requireEvidence(block.getId() === expectedHash && block.toHex() === raw &&
    Buffer.from(block.prevHash).reverse().toString("hex") === previousHash && block.transactions?.length > 0,
    "canonical block bytes or previous hash differ");
  const transactions = block.transactions.map((tx, index) => {
    const row = { txid: tx.getId(), hex: tx.toHex(), _powBlockIndex: index, vin: inputs(tx), vout: outputs(tx) };
    const records = canonicalRawProtocolRecordSetFromTransaction(row);
    requireEvidence(records.rawProtocolCandidateCount === 0 && records.records.length === 0,
      `governed record at height ${height} outside empty-suffix scope`);
    return row;
  });
  return { bytes, blockHeaderHex: raw.slice(0, 160), blockTransactions: transactions };
}

function nativeSeal(row, decoded, result, height, blockHash, empty) {
  requireEvidence(row?.block_height === height && row.block_hash === blockHash && row.network === "livenet" &&
    row.model === WORK_AMO_V8_BLOCK_SEQUENCER_MODEL && row.work_token_state_model === WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL &&
    row.complete === true && row.fee_once === true && row.invalid_zero === true && row.block_atomic === true &&
    hash(row.current_main_row_sha256) && hash(row.native_sha256) &&
    row.payload?.__powNativeStorage?.model === "proof-indexer-native-transition-chunks-v1" &&
    row.payload.__powNativeStorage.sha256 === row.native_sha256 && result?.sha256 === row.native_sha256 &&
    Number.isSafeInteger(result.bytes) && result.bytes > 0 && result.bytes <= RESOURCE_LIMITS.maxNativePayloadBytesPerBlock &&
    String(result.bytes) === String(row.native_bytes) && !Object.hasOwn(decoded, "expandedLiquidity"),
    "original native row, frame or scalar seal differs");
  assertScalarSeal(row, decoded, workAmoV5CanonicalStateCommitment, workAmoV5CanonicalPayloadCommitment,
    { empty, eventSetCommitment: workAmoV5EventSetCommitment });
  requireEvidence(decoded.openingNetworkValueQ8 === decoded.openingSufficientState.networkValueQ8 &&
    decoded.closingNetworkValueQ8 === decoded.closingSufficientState.networkValueQ8 &&
    decoded.closingSufficientState.throughBlockHeight === height &&
    decoded.closingSufficientState.throughBlockHash === blockHash, "native economic checkpoint differs");
}

function replayInput(old, prior, header, transactions) {
  // Batch gates return a commitment with the authentication flags removed. Its
  // exact historical contents must be reproduced by baseline replay and match
  // the authenticated stored chain commitment before either result is usable.
  const historicalBatch = value => value && { ...value, canonical: true, confirmed: true, evidenceComplete: true };
  return {
    blockHeaderHex: header, blockTransactions: transactions, records: [],
    expectedBlockHeight: old.blockHeight, expectedBlockHash: old.blockHash, expectedPreviousBlockHash: old.previousBlockHash,
    openingEconomicState: prior.closingSufficientState, openingWorkState: prior.closingTokenState,
    openingGenericState: prior.closingGenericTokenState, openingIdState: prior.closingIdState,
    workAmoV6: old.workAmoV6, workAmoV8: old.workAmoV8, referenceBlockWitnesses: old.referenceBlockWitnesses,
    workBatchV1: historicalBatch(old.workBatchV1), workMailBatchV1: historicalBatch(old.workMailBatchV1),
  };
}

function equivalentResult(baseline, candidate, declaration) {
  const { transitionChainCommitment: oldChain, ...old } = baseline;
  const { transitionChainCommitment: newChain, expandedLiquidity, ...next } = candidate;
  requireEvidence(equal(expandedLiquidity, declaration) && equal(old, next), "economic, event, fee or state replay differs");
  requireEvidence(oldChain?.model === "canonical-work-amo-raw-transition-chain-sha256-v1" &&
    newChain?.model === oldChain.model && hash(oldChain.sha256) && hash(newChain.sha256) &&
    oldChain.sha256 !== newChain.sha256 && Number.isSafeInteger(newChain.payloadBytes) &&
    newChain.payloadBytes > 0, "transition chain was not independently rebound");
}

// readTransition returns an incumbent native preflight row with its actual
// decoded frame. nativeDigest uses PostgreSQL jsonb_send on this same database.
// sources.readBinding must fence the actually loaded historical and candidate
// import/dependency closures at the beginning and end of the read-only snapshot.
export async function qualifyExpandedLiquidityReplay({
  tip, sources, readTip, readCanonicalHash, readRawBlock, readDeclarationEvidence, readTransition, readRelations, nativeDigest,
}) {
  const from = DECLARATION_PINS.blockHeight + 1;
  requireEvidence(tip && Number.isSafeInteger(tip.height) && tip.height >= from &&
    tip.height - from < MAX_SUFFIX_BLOCKS && hash(tip.hash), "explicit canonical suffix required");
  const sourceBinding = structuredClone(sources.binding);
  requireEvidence(commit(sourceBinding.sourceCommit) && commit(sourceBinding.sourceTree) &&
    hash(sourceBinding.baselineSourceSha256) && hash(sourceBinding.candidateSourceSha256) &&
    sourceBinding.baselineSourceSha256 !== sourceBinding.candidateSourceSha256 && hash(sourceBinding.dependencySha256) &&
    equal(await sources.readBinding(), sourceBinding), "source/dependency bindings unavailable");
  requireEvidence(equal(await readTip(), tip), "initial Core/index tip differs");
  const declaration = verifyReplayDeclaration(await readDeclarationEvidence());
  requireEvidence(await readCanonicalHash(DECLARATION_PINS.blockHeight) === DECLARATION_PINS.blockHash, "declaration reorg");
  const anchorRow = await readTransition(DECLARATION_PINS.blockHeight, DECLARATION_PINS.blockHash);
  let prior = anchorRow.decoded;
  nativeSeal(anchorRow, prior, await nativeDigest(prior), DECLARATION_PINS.blockHeight, DECLARATION_PINS.blockHash, false);
  const anchor = { height: DECLARATION_PINS.blockHeight, hash: DECLARATION_PINS.blockHash,
    currentMainRowSha256: anchorRow.current_main_row_sha256, oldNativeSha256: anchorRow.native_sha256 };
  const blocks = [];
  const emptyRelationsHash = sha(Buffer.from([1, 0x5b, 0x5d])); // PostgreSQL jsonb_send('[]'::jsonb)
  let totalOld = 0, totalNew = 0, totalRaw = 0;
  for (let height = from; height <= tip.height; height++) {
    const blockHash = await readCanonicalHash(height);
    requireEvidence(hash(blockHash), "canonical block unavailable");
    const previousBlockHash = prior.blockHash;
    const row = await readTransition(height, blockHash);
    const old = row.decoded;
    const oldNative = await nativeDigest(old);
    nativeSeal(row, old, oldNative, height, blockHash, true);
    requireEvidence(old.previousBlockHash === previousBlockHash && equal(old.openingSufficientState, prior.closingSufficientState) &&
      equal(old.openingStateCommitment, prior.closingStateCommitment) && !Object.hasOwn(old, "inceptionHMinusOneWitness"),
      "discontinuous opening state or unexpected oracle");
    const relationalBindings = await readRelations(height, blockHash);
    requireEvidence(relationalBindings?.recordCount === 0 && relationalBindings.eventCount === 0 &&
      relationalBindings.recordRowsSha256 === emptyRelationsHash && relationalBindings.eventRowsSha256 === emptyRelationsHash, "governed relational rows differ");
    const core = fullBlock(await readRawBlock(blockHash), height, blockHash, previousBlockHash);
    totalRaw += core.bytes.length; totalOld += oldNative.bytes;
    requireEvidence(totalRaw <= RESOURCE_LIMITS.maxRawBlockBytes && totalOld <= RESOURCE_LIMITS.maxNativePayloadBytes, "suffix budget exceeded");
    const input = replayInput(old, prior, core.blockHeaderHex, core.blockTransactions);
    const baseline = sources.baselineRaw.replayWorkAmoV5RawBlock(input);
    assertBaselineReplay(baseline, old);
    requireEvidence(equal(baseline.workBatchV1, old.workBatchV1) && equal(baseline.workMailBatchV1, old.workMailBatchV1),
      "historical batch context differs");
    const inherited = await expandedLiquidityForReplay({
      blockHeight: height, previousBlockHash, priorTransition: { payload: prior },
      configuredPins: height === from ? DECLARATION_PINS : null, readBoundary: async () => declaration,
    });
    requireEvidence(equal(inherited, declaration), "previous corrected transition cannot confer the declaration");
    const nextInput = { ...input, expandedLiquidity: inherited };
    const next = sources.candidateRaw.replayWorkAmoV5RawBlock(nextInput);
    requireEvidence(equal(next, sources.candidateRaw.replayWorkAmoV5RawBlock(nextInput)), "candidate replay is nondeterministic");
    equivalentResult(baseline, next, declaration);
    const project = (module, replay) => module.projectWorkAmoV5RawEvents(prior.closingWorkProjection, replay.events, replay.workState);
    requireEvidence(equal(project(sources.baselineRaw, baseline), old.closingWorkProjection) &&
      equal(project(sources.candidateRaw, next), old.closingWorkProjection), "historic WORK listings or projections differ");
    const replacementFields = { expandedLiquidity: next.expandedLiquidity, transitionChainCommitment: next.transitionChainCommitment };
    const corrected = { ...old, ...replacementFields };
    const proposed = await nativeDigest(corrected);
    totalNew += proposed.bytes;
    requireEvidence(hash(proposed.sha256) && proposed.sha256 !== oldNative.sha256 && Number.isSafeInteger(proposed.bytes) &&
      proposed.bytes > 0 && proposed.bytes <= RESOURCE_LIMITS.maxNativePayloadBytesPerBlock &&
      totalNew <= RESOURCE_LIMITS.maxNativePayloadBytes, "corrected native frame or suffix budget invalid");
    blocks.push({ height, hash: blockHash, previousBlockHash, currentMainRowSha256: row.current_main_row_sha256,
      oldNativeSha256: oldNative.sha256, newNativeSha256: proposed.sha256, oldNativeBytes: oldNative.bytes, newNativeBytes: proposed.bytes,
      oldTransitionChainCommitment: baseline.transitionChainCommitment, newTransitionChainCommitment: next.transitionChainCommitment,
      oldPayloadCommitment: digest(old), newPayloadCommitment: digest(corrected), relationalBindings,
      rawBlockSha256: sha(core.bytes), rawBlockBytes: core.bytes.length, replacementFields });
    prior = corrected;
  }
  requireEvidence(blocks.at(-1).hash === tip.hash, "last block differs from requested tip");
  for (const row of [anchor, ...blocks]) {
    requireEvidence(await readCanonicalHash(row.height) === row.hash, "canonical range changed during replay");
  }
  requireEvidence(equal(verifyReplayDeclaration(await readDeclarationEvidence()), declaration) &&
    equal(await sources.readBinding(), sourceBinding) && equal(await readTip(), tip), "final declaration, source or tip changed");
  return { format: "work-amo-expanded-liquidity-replay-qualification-v1", qualified: true, declaration, anchor, tip,
    sourceBinding, blocks };
}
