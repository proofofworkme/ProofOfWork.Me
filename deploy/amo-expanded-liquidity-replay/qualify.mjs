import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { performance } from "node:perf_hooks";
import { compareReplay } from "./records.mjs";
import { MAX_GOVERNED_ROWS_PER_BLOCK, verifyRelationalEvidence } from "./relations.mjs";
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

export const MAX_TIP_REFRESHES = 9;
export const MAX_CATCH_UP_MILLISECONDS = 4 * 60 * 60 * 1000;

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

// Decode the entire Core block before using the index. A transaction can have
// several PWM carriers for a single logical record. Only governed transactions
// need prevouts, but every transaction stays in the canonical block envelope.
async function fullBlock(raw, height, expectedHash, previousHash, readParentTransaction, budget) {
  const bytes = rawBytes(raw, "serialized block unavailable or too large");
  const block = Block.fromBuffer(bytes);
  requireEvidence(block.getId() === expectedHash && block.toHex() === raw &&
    Buffer.from(block.prevHash).reverse().toString("hex") === previousHash && block.transactions?.length > 0,
    "canonical block bytes or previous hash differ");
  const transactions = [], records = [];
  let candidateOutputs = 0, governedTransactions = 0;
  for (const [index, tx] of block.transactions.entries()) {
    const row = { txid: tx.getId(), hex: tx.toHex(), _powBlockIndex: index, vin: inputs(tx), vout: outputs(tx) };
    transactions.push(row);
    const parsed = canonicalRawProtocolRecordSetFromTransaction(row);
    candidateOutputs += parsed.rawProtocolCandidateCount;
    if (!parsed.records.length) continue;
    budget.records += parsed.records.length;
    requireEvidence(budget.records <= RESOURCE_LIMITS.maxOrdinaryRecords && candidateOutputs <= MAX_GOVERNED_ROWS_PER_BLOCK, "governed record budget exceeded");
    requireEvidence(index > 0 && typeof readParentTransaction === "function", "governed record requires authenticated prevouts");
    governedTransactions++;
    row.status = { confirmed: true, block_height: height, block_hash: expectedHash, block_time: block.timestamp };
    row._powCanonicalRpcHydration = true;
    let inputValue = 0n;
    const parents = new Map();
    for (const [i, input] of row.vin.entries()) {
      requireEvidence(hash(input.txid), "governed input outpoint missing");
      if (!parents.has(input.txid)) {
        const parentBytes = rawBytes(await readParentTransaction(input.txid), "governed parent bytes unavailable");
        budget.parentBytes += parentBytes.length;
        requireEvidence(budget.parentBytes <= RESOURCE_LIMITS.maxRawBlockBytes, "governed prevout budget exceeded");
        const parent = Transaction.fromBuffer(parentBytes);
        requireEvidence(parent.getId() === input.txid, "governed parent txid mismatch");
        parents.set(input.txid, outputs(parent));
      }
      input.prevout = parents.get(input.txid)[input.vout];
      requireEvidence(input.prevout, "governed prevout missing");
      input.scriptsig = Buffer.from(tx.ins[i].script).toString("hex");
      input.sequence = tx.ins[i].sequence;
      input.witness = tx.ins[i].witness.map(part => Buffer.from(part).toString("hex"));
      inputValue += BigInt(input.prevout.value);
    }
    const fee = inputValue - row.vout.reduce((sum, output) => sum + BigInt(output.value), 0n);
    requireEvidence(fee >= 0n, "governed transaction fee is negative");
    for (const record of parsed.records) {
      const position = { blockHeight: height, blockHash: expectedHash, blockTransactionIndex: index,
        protocolVout: record.protocolVout, recordOrdinal: record.recordOrdinal };
      records.push({ ...record, position, tx: row, txid: row.txid, transactionMinerFeeSats: fee.toString(),
        transactionProtocolRecordCount: parsed.records.length });
    }
  }
  return { bytes, blockHeaderHex: raw.slice(0, 160), blockTransactions: transactions, records, candidateOutputs, governedTransactions };
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

function replayInput(old, prior, core) {
  // Batch gates return a commitment with the authentication flags removed. Its
  // exact historical contents must be reproduced by baseline replay and match
  // the authenticated stored chain commitment before either result is usable.
  const historicalBatch = value => value && { ...value, canonical: true, confirmed: true, evidenceComplete: true };
  return {
    blockHeaderHex: core.blockHeaderHex, blockTransactions: core.blockTransactions, records: core.records,
    inceptionHMinusOneWitness: old.inceptionHMinusOneWitness,
    expectedBlockHeight: old.blockHeight, expectedBlockHash: old.blockHash, expectedPreviousBlockHash: old.previousBlockHash,
    openingEconomicState: prior.closingSufficientState, openingWorkState: prior.closingTokenState,
    openingGenericState: prior.closingGenericTokenState, openingIdState: prior.closingIdState,
    workAmoV6: old.workAmoV6, workAmoV8: old.workAmoV8, referenceBlockWitnesses: old.referenceBlockWitnesses,
    workBatchV1: historicalBatch(old.workBatchV1), workMailBatchV1: historicalBatch(old.workMailBatchV1),
  };
}

const projectionPosition = (txid, p) => [p.blockHash, txid, p.blockTransactionIndex, p.protocolVout, p.recordOrdinal].join(":");

// Only batch containers and their projected transfers retain a replay-chain
// reference across later blocks. Match each differing reference to the exact
// event that both engines reproduced at the same canonical position.
export function verifyWorkProjection(before, after, baseline, candidate, bindings) {
  for (const [i, event] of baseline.events.entries()) {
    if (!event.valid || !["batch", "mail-batch"].includes(event.parsed?.kind)) continue;
    const next = candidate.events[i];
    bindings.set(projectionPosition(event.txid, event.position), {
      key: "transitionChainCommitmentAfter", old: event.transitionChainCommitmentAfter, next: next.transitionChainCommitmentAfter,
    });
    for (const child of event.derived) {
      bindings.set(projectionPosition(event.txid, child.projectionPosition), {
        key: "parentTransitionChainCommitmentAfter", old: event.transitionChainCommitmentAfter, next: next.transitionChainCommitmentAfter,
      });
    }
  }
  const expected = { ...before };
  for (const [collection, key] of [["transfers", "parentTransitionChainCommitmentAfter"], ["transferBatches", "transitionChainCommitmentAfter"]]) {
    if (!bindings.size || !Array.isArray(before[collection])) continue;
    expected[collection] = before[collection].map(row => {
      const pos = { ...row, blockTransactionIndex: row.blockIndex };
      const bound = bindings.get(projectionPosition(row.txid, pos));
      if (!bound) return row;
      requireEvidence(bound.key === key && equal(row[key], bound.old),
        "incumbent WORK projection provenance differs from its replayed event");
      return { ...row, [key]: bound.next };
    });
  }
  requireEvidence(equal(expected, after), "WORK projection or its replay provenance differs");
}

// readTransition returns an incumbent native preflight row with its actual
// decoded frame. nativeDigest uses PostgreSQL jsonb_send on this same database.
// sources.readBinding must fence the actually loaded historical and candidate
// import/dependency closures at the beginning and end of the read-only snapshot.
export async function qualifyExpandedLiquidityReplay({
  tip, sources, readTip, refreshTip, readCanonicalHash, readRawBlock, readParentTransaction, readDeclarationEvidence, readTransition, readRelations, nativeDigest,
}) {
  const from = DECLARATION_PINS.blockHeight + 1;
  function checkedTip(value) {
    requireEvidence(value && Number.isSafeInteger(value.height) && value.height >= from &&
      value.height - from < MAX_SUFFIX_BLOCKS && hash(value.hash), "explicit canonical suffix required");
    return { height: value.height, hash: value.hash };
  }
  let target = checkedTip(tip);
  requireEvidence(refreshTip === undefined || typeof refreshTip === "function", "invalid snapshot refresher");
  const deadline = performance.now() + MAX_CATCH_UP_MILLISECONDS;
  function checkDeadline() {
    requireEvidence(!refreshTip || performance.now() <= deadline, "qualification time budget exceeded");
  }
  const sourceBinding = structuredClone(sources.binding);
  requireEvidence(commit(sourceBinding.sourceCommit) && commit(sourceBinding.sourceTree) &&
    hash(sourceBinding.baselineSourceSha256) && hash(sourceBinding.candidateSourceSha256) &&
    sourceBinding.baselineSourceSha256 !== sourceBinding.candidateSourceSha256 && hash(sourceBinding.dependencySha256) &&
    equal(await sources.readBinding(), sourceBinding), "source/dependency bindings unavailable");
  requireEvidence(equal(await readTip(), target), "initial Core/index tip differs");
  const declaration = verifyReplayDeclaration(await readDeclarationEvidence());
  requireEvidence(await readCanonicalHash(DECLARATION_PINS.blockHeight) === DECLARATION_PINS.blockHash, "declaration reorg");
  const anchorRow = await readTransition(DECLARATION_PINS.blockHeight, DECLARATION_PINS.blockHash);
  let prior = anchorRow.decoded;
  const anchorDigest = await nativeDigest(prior);
  nativeSeal(anchorRow, prior, anchorDigest, DECLARATION_PINS.blockHeight, DECLARATION_PINS.blockHash, false);
  const anchor = { height: DECLARATION_PINS.blockHeight, hash: DECLARATION_PINS.blockHash,
    currentMainRowSha256: anchorRow.current_main_row_sha256, oldNativeSha256: anchorRow.native_sha256 };
  const blocks = [];
  const budget = { records: 0, parentBytes: 0 };
  const projectionBindings = new Map();
  let priorOriginal = prior;
  let totalOld = 0, totalNew = 0, totalRaw = 0, receiptBytes = 0;
  // Keep replay states, replacement fields and cumulative resource accounting private to this invocation.
  // A new read-only snapshot gets only the evidence necessary to authenticate the completed prefix.
  const witnessed = new Map([[target.height, target.hash]]);
  let liveHead = target;
  let refreshes = 0;
  function remember(value) {
    requireEvidence(!witnessed.has(value.height) || witnessed.get(value.height) === value.hash,
      "previously observed checkpoint changed");
    witnessed.set(value.height, value.hash);
  }
  function observeTip(value) {
    const head = checkedTip(value);
    requireEvidence(head.height >= liveHead.height, "Core/index tip moved backwards");
    remember(head);
    liveHead = head;
  }
  async function nextTarget() {
    for (;;) {
      checkDeadline();
      let snapshotTip = target;
      if (refreshTip) {
        requireEvidence(++refreshes <= MAX_TIP_REFRESHES, "snapshot refresh budget exceeded");
        const oldestSnapshotHeight = liveHead.height;
        const prefix = structuredClone({ anchor: { ...anchor, oldNativeBytes: anchorDigest.bytes },
          tip: target, declaration, sourceBinding, blocks: blocks.map(row => ({
            height: row.height, hash: row.hash, currentMainRowSha256: row.currentMainRowSha256,
            oldNativeSha256: row.oldNativeSha256, oldNativeBytes: row.oldNativeBytes, relationalBindings: row.relationalBindings,
          })) });
        let observing = true;
        try {
          snapshotTip = checkedTip(await refreshTip(prefix, value => {
            requireEvidence(observing, "snapshot observation is closed");
            observeTip(value);
          }, checkDeadline));
        } finally {
          observing = false;
        }
        requireEvidence(snapshotTip.height >= oldestSnapshotHeight, "fresh snapshot moved backwards");
        remember(snapshotTip);
      }
      for (const row of [anchor, ...blocks]) {
        checkDeadline();
        requireEvidence(await readCanonicalHash(row.height) === row.hash, "canonical range changed during replay");
      }
      // A snapshot may have opened before the live head observed in its fresh-session checks.
      // Those intervening checkpoints must still be ancestors, including ones beyond the replayed rows.
      for (const [height, expected] of witnessed) {
        if (height <= target.height) continue;
        checkDeadline();
        requireEvidence(await readCanonicalHash(height) === expected, "observed checkpoint is no longer canonical");
      }
      requireEvidence(equal(verifyReplayDeclaration(await readDeclarationEvidence()), declaration) &&
        equal(await sources.readBinding(), sourceBinding), "final declaration, source or tip changed");
      const latest = await readTip();
      checkDeadline();
      if (!refreshTip) {
        requireEvidence(equal(latest, target), "final declaration, source or tip changed");
        return target;
      }
      observeTip(latest);
      requireEvidence(liveHead.height >= snapshotTip.height, "Core/index tip behind fresh snapshot");
      if (snapshotTip.height > target.height || equal(snapshotTip, liveHead)) return snapshotTip;
      // No new rows are visible in this snapshot. Rotate before attempting to read the new live head.
    }
  }
  for (let height = from; height <= target.height; height++) {
    checkDeadline();
    const blockHash = await readCanonicalHash(height);
    requireEvidence(hash(blockHash), "canonical block unavailable");
    if (witnessed.has(height)) requireEvidence(witnessed.get(height) === blockHash, "previously observed checkpoint changed");
    const previousBlockHash = prior.blockHash;
    const row = await readTransition(height, blockHash);
    const old = row.decoded;
    const oldNative = await nativeDigest(old);
    nativeSeal(row, old, oldNative, height, blockHash, row.protocol_record_count === 0);
    requireEvidence(old.previousBlockHash === previousBlockHash && equal(old.openingSufficientState, prior.closingSufficientState) &&
      equal(old.openingStateCommitment, prior.closingStateCommitment),
      "discontinuous opening state");
    const core = await fullBlock(await readRawBlock(blockHash), height, blockHash, previousBlockHash, readParentTransaction, budget);
    requireEvidence(core.records.length === row.protocol_record_count && core.candidateOutputs === row.raw_protocol_candidate_count &&
      core.governedTransactions === row.transaction_count, "governed record counts differ from Core");
    totalRaw += core.bytes.length; totalOld += oldNative.bytes;
    requireEvidence(totalRaw <= RESOURCE_LIMITS.maxRawBlockBytes && totalOld <= RESOURCE_LIMITS.maxNativePayloadBytes, "suffix budget exceeded");
    const input = replayInput(old, prior, core);
    // The immutable original commits the oracle as part of the raw transition.
    // Use it only when the historical sequencer requests an authenticated H-1 witness.
    if (old.inceptionHMinusOneWitness) {
      let required = false;
      try { sources.baselineRaw.replayWorkAmoV5RawBlock({ ...input, inceptionHMinusOneWitness: null }); }
      catch (error) {
        if (error.message !== "work-amo-incb-h-minus-one-witness-required") throw error;
        required = true;
      }
      requireEvidence(required, "unexpected stored INCB oracle");
    }
    const baseline = sources.baselineRaw.replayWorkAmoV5RawBlock(input);
    assertBaselineReplay(baseline, old);
    requireEvidence(equal(baseline.workBatchV1, old.workBatchV1) && equal(baseline.workMailBatchV1, old.workMailBatchV1) && equal(baseline.inceptionHMinusOneWitness, old.inceptionHMinusOneWitness),
      "historical batch context differs");
    const inherited = await expandedLiquidityForReplay({
      blockHeight: height, previousBlockHash, priorTransition: { payload: prior },
      configuredPins: height === from ? DECLARATION_PINS : null, readBoundary: async () => declaration,
    });
    requireEvidence(equal(inherited, declaration), "previous corrected transition cannot confer the declaration");
    const nextInput = { ...input, expandedLiquidity: inherited };
    const next = sources.candidateRaw.replayWorkAmoV5RawBlock(nextInput);
    requireEvidence(equal(next, sources.candidateRaw.replayWorkAmoV5RawBlock(nextInput)), "candidate replay is nondeterministic");
    const materialized = compareReplay(baseline, next, declaration, old);
    requireEvidence(equal({ ...old.eventSetCommitment, sha256: materialized.eventSetCommitment.sha256 },
      materialized.eventSetCommitment), "event-set size, count or model differs");
    const relationalBindings = verifyRelationalEvidence(await readRelations(height, blockHash),
      { height, hash: blockHash, records: core.records, replayRecords: old.replayRecords });
    const before = sources.baselineRaw.projectWorkAmoV5RawEvents(priorOriginal.closingWorkProjection, baseline.events, baseline.workState);
    requireEvidence(equal(before, old.closingWorkProjection), "incumbent WORK projection differs");
    const after = sources.candidateRaw.projectWorkAmoV5RawEvents(prior.closingWorkProjection, next.events, next.workState);
    verifyWorkProjection(before, after, baseline, next, projectionBindings);
    const replacementFields = { expandedLiquidity: next.expandedLiquidity, transitionChainCommitment: next.transitionChainCommitment,
      ...(core.records.length ? materialized : {}), ...(!equal(before, after) ? { closingWorkProjection: after } : {}) };
    const corrected = { ...old, ...replacementFields };
    const proposed = await nativeDigest(corrected);
    totalNew += proposed.bytes;
    requireEvidence(hash(proposed.sha256) && proposed.sha256 !== oldNative.sha256 && Number.isSafeInteger(proposed.bytes) &&
      proposed.bytes > 0 && proposed.bytes <= RESOURCE_LIMITS.maxNativePayloadBytesPerBlock &&
      totalNew <= RESOURCE_LIMITS.maxNativePayloadBytes, "corrected native frame or suffix budget invalid");
    blocks.push({ height, hash: blockHash, previousBlockHash, currentMainRowSha256: row.current_main_row_sha256,
      oldNativeSha256: oldNative.sha256, newNativeSha256: proposed.sha256, oldNativeBytes: oldNative.bytes, newNativeBytes: proposed.bytes,
      protocolCounts: { protocolRecordCount: core.records.length, rawProtocolCandidateCount: core.candidateOutputs,
        transactionCount: core.governedTransactions, eventCount: old.eventCount },
      oldEventSetCommitment: old.eventSetCommitment, newEventSetCommitment: materialized.eventSetCommitment,
      oldTransitionChainCommitment: baseline.transitionChainCommitment, newTransitionChainCommitment: next.transitionChainCommitment,
      oldPayloadCommitment: digest(old), newPayloadCommitment: digest(corrected), relationalBindings,
      rawBlockSha256: sha(core.bytes), rawBlockBytes: core.bytes.length, replacementFields });
    receiptBytes += Buffer.byteLength(JSON.stringify(blocks.at(-1))) + 1;
    requireEvidence(receiptBytes <= RESOURCE_LIMITS.maxQualificationReceiptBytes, "qualification receipt budget exceeded");
    priorOriginal = old;
    prior = corrected;
    if (height === target.height) {
      requireEvidence(blockHash === target.hash, "last block differs from requested tip");
      target = await nextTarget();
    }
  }
  return { format: "work-amo-expanded-liquidity-replay-qualification-v2", qualified: true, declaration, anchor, tip: target,
    sourceBinding, blocks };
}
