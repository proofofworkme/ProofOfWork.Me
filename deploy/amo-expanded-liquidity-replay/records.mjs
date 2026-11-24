import { isDeepStrictEqual as equal } from "node:util";
import {
  workAmoV5CanonicalPayloadCommitment,
  workAmoV5ConsensusEventKind,
  workAmoV5EventSetCommitment,
} from "../../server/work-amo-v5.mjs";

import { WORK_AMO_V8_BLOCK_SEQUENCER_MODEL } from "../../server/work-amo-v8.mjs";
import { WORK_SUBATOM_PROJECTION_MODEL } from "../../server/work-units.mjs";

const chainModel = "canonical-work-amo-raw-transition-chain-sha256-v1";
const positions = ["blockHeight", "blockTransactionIndex", "protocolVout", "recordOrdinal"];
const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const key = row => [row.txid, row.position.protocolVout, row.position.recordOrdinal].join(":");
const carrier = row => [row.txid, row.position.protocolVout].join(":");

function insist(condition, description) {
  if (!condition) throw new Error(`AMO replay materialization: ${description}`);
}

function order(a, b) {
  for (const field of positions) {
    const difference = a.position[field] - b.position[field];
    if (difference) return difference;
  }
  return 0;
}

function unique(rows, identity, label) {
  const indexed = new Map(rows.map(row => [identity(row), row]));
  insist(indexed.size === rows.length, `duplicate ${label}`);
  return indexed;
}

function chainHeader(chain) {
  insist(chain?.model === chainModel && hash(chain.sha256) && Number.isSafeInteger(chain.payloadBytes) &&
    chain.payloadBytes > 0 && Object.keys(chain).length === 3, "invalid transition-chain witness");
  return { model: chain.model, payloadBytes: chain.payloadBytes };
}

function chain(preimage) {
  const { sha256, payloadBytes } = workAmoV5CanonicalPayloadCommitment(preimage);
  return { model: chainModel, sha256, payloadBytes };
}

// The declaration is an additional field of the block-open preimage. Its encoded length can
// cross a power of ten, changing the number of bytes occupied by the *next* link's prior length.
function openingChain(frame) {
  const block = Object.fromEntries(["blockDescriptorCommitment", "blockDescriptorModel", "blockHash", "blockHeight",
    "blockTransactionCount", "previousBlockHash", "protocolRecordCount", "transactionCount"].map(k => [k, frame[k]]));
  const seed = { block, model: chainModel, openingStateCommitment: frame.openingStateCommitment };
  for (const k of ["inceptionHMinusOneWitness", "expandedLiquidity", "workBatchV1", "workMailBatchV1"]) {
    if (frame[k]) seed[k] = frame[k];
  }
  if (frame.workAmoV6 && frame.blockHeight >= frame.workAmoV6.activationHeight)
    seed.workAmoV6 = { activationHeight: frame.workAmoV6.activationHeight };
  if (frame.workAmoV8 && frame.blockHeight >= frame.workAmoV8.activationHeight) {
    seed.workAmoV8 = { activationHeight: frame.workAmoV8.activationHeight, amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
      blockSequencerModel: WORK_AMO_V8_BLOCK_SEQUENCER_MODEL };
  }
  return chain(seed);
}

function advance(priorCommitment, transition) {
  return chain({ model: chainModel, priorCommitment, transition });
}

function checkFeeLink(trace, predecessor) {
  const { transitionChainCommitmentAfter, ...transition } = trace;
  if (trace.valid) {
    insist(trace.reasonCode === "", "invalid valid-fee reason");
    delete transition.reasonCode;
  }
  insist(equal(advance(predecessor, transition), transitionChainCommitmentAfter), "fee chain preimage differs");
}

function checkClose(frame, previous) {
  const { genericTokenStateCommitment, idStateCommitment, tokenStateCommitment } = frame.closingSufficientState;
  const close = advance(previous, { closingStateCommitment: frame.closingStateCommitment, genericTokenStateCommitment,
    idStateCommitment, kind: "block-close", tokenStateCommitment });
  insist(equal(close, frame.transitionChainCommitment), "block-close chain preimage differs");
}

function boundChains(before, after) {
  let oldPrevious = openingChain(before), newPrevious = openingChain(after);
  const bindings = new Map();
  insist(before.traces.length === after.traces.length, "chain trace count differs");
  for (const [i, trace] of before.traces.entries()) {
    const nextTrace = after.traces[i], oldLink = trace.transitionChainCommitmentAfter, newLink = nextTrace.transitionChainCommitmentAfter;
    chainHeader(oldLink);
    chainHeader(newLink);
    const delta = String(newPrevious.payloadBytes).length - String(oldPrevious.payloadBytes).length;
    insist(oldLink.payloadBytes + delta === newLink.payloadBytes && oldLink.sha256 !== newLink.sha256 &&
      !bindings.has(oldLink.sha256), "transition-chain witness length or digest did not rebind exactly");
    if (trace.kind === "transaction-fee") {
      checkFeeLink(trace, oldPrevious);
      checkFeeLink(nextTrace, newPrevious);
    }
    bindings.set(oldLink.sha256, { oldLink, newLink });
    oldPrevious = oldLink;
    newPrevious = newLink;
  }
  checkClose(before, oldPrevious);
  checkClose(after, newPrevious);
  return bindings;
}

function withoutParentChain(row) {
  const { parentTransitionChainCommitmentAfter, ...unchanged } = row;
  return { ...unchanged, parentTransitionChainCommitmentAfter: chainHeader(parentTransitionChainCommitmentAfter).model };
}

function ordinaryEvidence(row) {
  const { transitionChainCommitmentAfter, derived, ...unchanged } = row;
  const result = { ...unchanged, transitionChainCommitmentAfter: chainHeader(transitionChainCommitmentAfter).model };
  if (Object.hasOwn(row, "derived")) {
    insist(Array.isArray(derived), "invalid derived event list");
    for (const child of derived)
      insist(equal(child.parentTransitionChainCommitmentAfter, transitionChainCommitmentAfter), "detached derived witness");
    result.derived = derived.map(withoutParentChain);
  }
  return result;
}

function compareRows(before, after, bindings) {
  insist(before.length === after.length, "replay witness count differs");
  for (let i = 0; i < before.length; i++) {
    const oldLink = before[i].transitionChainCommitmentAfter, newLink = after[i].transitionChainCommitmentAfter;
    const bound = bindings.get(oldLink?.sha256);
    insist(bound && equal(bound.oldLink, oldLink) && equal(bound.newLink, newLink), "unbound replay witness");
    insist(equal(ordinaryEvidence(before[i]), ordinaryEvidence(after[i])), "economic or replay witness differs");
  }
}

function derivedRecord(parent, child) {
  const protocol = ["pwid1", "pwt1"].includes(child.protocol) ? child.protocol : "pwt1";
  const projection = { ...child, derived: true, kind: child.kind, position: child.projectionPosition,
    protocol, reasonCode: "", txid: parent.txid, valid: true };
  return {
    chargesTransactionFee: false, derived: true,
    outcome: { kind: workAmoV5ConsensusEventKind(protocol, true), reasonCode: "", semanticKind: child.kind, valid: true },
    output: { projection }, parentPosition: parent.position, position: child.projectionPosition, protocol, rawCandidate: false,
    rawWitness: { descriptor: child, model: "canonical-work-amo-v5-derived-child-v1", parentPosition: parent.position,
      parentProtocol: parent.protocol },
    parentTransitionChainCommitmentAfter: child.parentTransitionChainCommitmentAfter,
    stateDelta: { baseContributions: [], creditFixedQ8: "0", creditFixedSats: "0", economicOutputs: [] },
    transactionMinerFeeSats: parent.transactionMinerFeeSats, transactionProtocolRecordCount: parent.transactionProtocolRecordCount,
    txid: parent.txid,
  };
}

// The raw sequencer allocates child ordinals after all raw ordinals for a transaction/output.
// Materialization may occur at an earlier attachment position, independently of its projection.
function completeRecords(raw) {
  const nextOrdinal = new Map();
  for (const [i, row] of raw.entries()) {
    insist(row.rawCandidate === true && hash(row.txid) && hash(row.position.blockHash) &&
      positions.every(field => Number.isSafeInteger(row.position[field]) && row.position[field] >= 0) &&
      row.position.blockHeight > 0 && (i === 0 || order(raw[i - 1], row) < 0), "raw position or order differs");
    nextOrdinal.set(carrier(row), Math.max(nextOrdinal.get(carrier(row)) ?? 0, row.position.recordOrdinal + 1));
  }
  const children = [];
  for (const parent of raw) {
    ordinaryEvidence(parent);
    for (const [i, child] of parent.derived.entries()) {
      const ordinal = nextOrdinal.get(carrier(parent));
      const projected = { ...parent.position, recordOrdinal: ordinal };
      insist(parent.outcome.valid === true && child.derivedIndex === i && equal(child.containerPosition, parent.position) &&
        equal(child.materializationPosition, child.attachmentAppliedAtPosition ?? parent.position) &&
        equal(child.projectionPosition, projected) && child.derivedId === [parent.txid, ...positions.map(f => projected[f])].join(":") &&
        child.rawCandidate === false && child.chargesTransactionFee === false &&
        child.claimsEconomicOutputs === false && child.economicDelta === false, "derived position, identity or economic flags differ");
      nextOrdinal.set(carrier(parent), ordinal + 1);
      children.push(derivedRecord(parent, child));
    }
  }
  return [...raw, ...children].sort(order);
}

export function replayEventSetCommitment(replayRecords) {
  return workAmoV5EventSetCommitment(replayRecords.map(record => ({
    kind: record.outcome.kind, outcome: record.outcome, payload: record.rawWitness, position: record.position,
    protocol: record.protocol, reasonCode: record.outcome.reasonCode, stateDelta: record.stateDelta,
    transactionMinerFeeSats: record.transactionMinerFeeSats, txid: record.txid, valid: record.outcome.valid,
  })));
}

function recordTrace(record, outcome) {
  return {
    bondContributionQ8: outcome.bondContributionQ8 ?? "0", kind: "protocol-record",
    networkValueAfterQ8: outcome.networkValueAfterQ8, networkValueBeforeQ8: outcome.networkValueBeforeQ8,
    output: record.output, position: record.position, rawWitness: record.rawWitness, reasonCode: record.outcome.reasonCode,
    stateDelta: record.stateDelta, transitionChainCommitmentAfter: record.transitionChainCommitmentAfter,
    txid: record.txid, valid: record.outcome.valid,
  };
}

// Mirrors completeWorkAmoV5BlockProjection. Keep evidence in the JSON shape in which PostgreSQL stores it.
export function materializeReplay(replay) {
  const events = unique(replay.events, key, "event");
  const fees = unique(replay.feeTransitions, fee => fee.txid, "transaction fee");
  insist(replay.outcomes instanceof Map && replay.outcomes.size === events.size && replay.records.length === events.size &&
    events.size === replay.protocolRecordCount && fees.size === replay.transactionCount, "missing record, outcome or fee");
  const raw = replay.records.map(record => {
    const id = key(record), event = events.get(id), outcome = replay.outcomes.get(id);
    insist(event && outcome && event.protocol === record.protocol && equal(event.position, record.position) &&
      equal(event.transitionChainCommitmentAfter, outcome.transitionChainCommitmentAfter) &&
      equal(event.derived, outcome.derived), "record and outcome differ");
    const kind = workAmoV5ConsensusEventKind(record.protocol, event.valid);
    insist(kind, "unknown consensus event kind");
    return {
      derived: event.derived, rawCandidate: true,
      outcome: { kind, reasonCode: event.valid ? "" : event.reasonCode, semanticKind: event.semanticKind, valid: event.valid },
      output: event.output, position: record.position, protocol: record.protocol, rawWitness: record.payload,
      stateDelta: event.stateDelta, transitionChainCommitmentAfter: event.transitionChainCommitmentAfter,
      transactionMinerFeeSats: record.transactionMinerFeeSats, transactionProtocolRecordCount: record.transactionProtocolRecordCount,
      txid: record.txid,
    };
  });
  const traces = [];
  for (const [i, record] of raw.entries()) {
    traces.push(recordTrace(record, replay.outcomes.get(key(record))));
    if (raw[i + 1]?.txid === record.txid) continue;
    const fee = fees.get(record.txid);
    insist(fee && fee.transactionMinerFeeSats === record.transactionMinerFeeSats, "missing or inconsistent transaction fee");
    chainHeader(fee.transitionChainCommitmentAfter);
    traces.push({ ...fee, kind: "transaction-fee", reasonCode: fee.valid ? "" : "work-amo-v5-invalid-only-transaction" });
    fees.delete(record.txid);
  }
  const replayRecords = completeRecords(raw);
  insist(fees.size === 0 && replayRecords.length === raw.length + replay.derivedEventCount, "unmatched fee or derived record");
  return JSON.parse(JSON.stringify({ replayRecords, traces,
    replayDescriptorCommitment: workAmoV5CanonicalPayloadCommitment(replayRecords),
    eventSetCommitment: replayEventSetCommitment(replayRecords) }));
}

function checkedNativeRows(data) {
  const raw = data.replayRecords.filter(record => record.rawCandidate === true);
  insist(equal(completeRecords(raw), data.replayRecords), "derived native records differ from their parents");
  let traceIndex = 0;
  for (const [i, record] of raw.entries()) {
    const trace = data.traces[traceIndex++];
    insist(trace && equal(trace, recordTrace(record, trace)), "native record trace differs from its record");
    if (raw[i + 1]?.txid === record.txid) continue;
    const fee = data.traces[traceIndex++];
    insist(fee?.kind === "transaction-fee" && fee.txid === record.txid &&
      fee.transactionMinerFeeSats === record.transactionMinerFeeSats, "missing transaction fee trace");
  }
  insist(traceIndex === data.traces.length, "extra native trace");
  return raw;
}

// Derived native rows are reconstructed on each side, including each copy of the parent's actual witness.
// The trace sequence binds every allowed witness change before those fields are excluded from semantic comparison.
export function assertReplayMaterializationOnly(original, corrected) {
  const next = { ...original, ...corrected };
  const bindings = boundChains(original, next);
  compareRows(checkedNativeRows(original), checkedNativeRows(next), bindings);
  compareRows(original.traces, next.traces, bindings);
  return bindings;
}

export function compareReplay(baseline, candidate, declaration, old) {
  const original = materializeReplay(baseline), corrected = materializeReplay(candidate);
  for (const field of Object.keys(original))
    insist(equal(original[field], old[field]), `baseline differs from stored ${field}`);
  const bindings = assertReplayMaterializationOnly(old, { ...corrected, expandedLiquidity: declaration,
    transitionChainCommitment: candidate.transitionChainCommitment });
  const { events, feeTransitions, outcomes, transitionChainCommitment, ...stable } = baseline;
  const { events: nextEvents, feeTransitions: nextFees, outcomes: nextOutcomes, transitionChainCommitment: nextChain,
    expandedLiquidity, ...nextStable } = candidate;
  insist(declaration && equal(expandedLiquidity, declaration) && !Object.hasOwn(stable, "expandedLiquidity") &&
    equal(stable, nextStable), "declaration or non-witness replay state differs");
  compareRows(events, nextEvents, bindings);
  compareRows(feeTransitions, nextFees, bindings);
  insist(equal([...outcomes.keys()], [...nextOutcomes.keys()]), "outcome keys or order differ");
  compareRows([...outcomes.values()], [...nextOutcomes.values()], bindings);
  insist(equal(transitionChainCommitment, old.transitionChainCommitment) && transitionChainCommitment.sha256 !== nextChain.sha256,
    "final transition chain did not rebind");
  return corrected;
}
