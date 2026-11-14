/** Shared strict accepted WORK settlement. No decoded transfer or cached balance is payment evidence. */
import { normalizeJobReward, JOBS_WORK_TOKEN_ID, JOBS_WORK_REGISTRY_ADDRESS } from '../src/shared/protocol/jobs.mjs';
import { canonicalRawProtocolRecordSetFromTransaction } from './canonical-op-return.mjs';
import { exactCodeOutputProofs } from './code-repositories.mjs';
import { WORK_AMO_V5_STATE_COMMITMENT_MODEL, WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL } from './work-amo-v5.mjs';
import { WORK_AMO_V8_BLOCK_SEQUENCER_MODEL } from './work-amo-v8.mjs';
import { WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL } from './work-amo-v5-raw.mjs';
const TXID = /^[0-9a-f]{64}$/u;
const address = output => output?.scriptpubkey_address ?? output?.scriptPubKey?.address ?? output?.address ?? '';
const canonicalObject = value => Array.isArray(value) ? value.map(canonicalObject) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalObject(value[key])])) : value;
const sameEvidence = (left, right) => JSON.stringify(canonicalObject(left)) === JSON.stringify(canonicalObject(right));
function samePosition(value, expected) {
  return value && ['blockHeight', 'blockHash', 'blockTransactionIndex', 'protocolVout', 'recordOrdinal'].every(key => value[key] === expected[key]);
}
function chainCommitment(value) {
  return value?.model === WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL && Number.isSafeInteger(value.payloadBytes) &&
    value.payloadBytes > 0 && TXID.test(value.sha256 ?? '');
}
/** A send3-shaped carrier is intent. Only an accepted canonical replay proves settlement. */
export function verifyMailWorkSettlement(tx, event, workerAddress, reward, { evidenceKey, candidateEventClosure, reasonPrefix = 'mail' }) {
  const fail = reason => ({ valid: false, reason: reason.replace(/^jobs-/, `${reasonPrefix}-`) });
  const normalized = normalizeJobReward(reward), transfer = event.workTransfer;
  if (!event.confirmed || normalized?.asset !== 'WORK' || !transfer ||
      transfer.token !== normalized.token || transfer.amountSubatoms !== normalized.amountSubatoms || transfer.recipientAddress !== workerAddress) {
    return fail('jobs-agreed-work-payment-mismatch');
  }
  const evidenceRows = tx?.[evidenceKey];
  if (!Array.isArray(evidenceRows) || evidenceRows.length !== 1) return fail('jobs-work-settlement-evidence-unavailable');
  const row = evidenceRows[0];
  if (!row || typeof row !== 'object') return fail('jobs-work-settlement-evidence-unavailable');
  const payload = row.payload, transition = row.transition, witnessPayload = transition?.payload;
  const position = { blockHeight: event.blockHeight, blockHash: event.blockHash, blockTransactionIndex: event.blockTransactionIndex,
    protocolVout: transfer.protocolVout, recordOrdinal: 0 };
  const rows = Array.isArray(witnessPayload?.replayRecords) ? witnessPayload.replayRecords : [];
  const traces = Array.isArray(witnessPayload?.traces) ? witnessPayload.traces : [];
  const witnesses = rows.filter(item => item?.txid === event.txid && item.protocol === 'pwt1');
  const matchingTraces = traces.filter(item => item?.txid === event.txid && item.kind === 'protocol-record' && samePosition(item.position, position));
  const witness = witnesses.length === 1 ? witnesses[0] : null, trace = matchingTraces.length === 1 ? matchingTraces[0] : null;
  const projection = witness?.output?.projection, outcome = payload?.workAmoV5ReplayOutcome;
  const rawRecord = canonicalRawProtocolRecordSetFromTransaction(tx).records.find(item => item.protocol === 'pwt1' && item.protocolVout === transfer.protocolVout);
  const mailRows = Array.isArray(row.mailEvents) ? row.mailEvents : [];
  if (row.network !== 'livenet' || row.txid !== event.txid || row.protocol !== 'pwt1' || row.kind !== 'token-transfer' ||
      row.status !== 'confirmed' || row.valid !== true || Number(row.block_height) !== position.blockHeight ||
      row.block_hash !== position.blockHash || Number(row.block_index) !== position.blockTransactionIndex ||
      Number(row.op_return_vout) !== position.protocolVout || Number(row.record_ordinal) !== 0 || row.raw_payload !== transfer.rawPayload ||
      payload?.confirmed !== true || payload?.valid !== true || payload?._workAmoV5ReplayBound !== true || payload?.workAmoV5RawCandidate !== true ||
      outcome?.valid !== true || outcome.kind !== 'pwt1-valid' || outcome.reasonCode !== '' ||
      !sameEvidence(payload?.workAmoV5ReplayOutput, witness?.output) || !sameEvidence(payload?.workAmoV5ReplayRawWitness, witness?.rawWitness) ||
      transition?.block_height !== position.blockHeight || transition.block_hash !== position.blockHash ||
      transition.model !== WORK_AMO_V8_BLOCK_SEQUENCER_MODEL || transition.state_commitment_model !== WORK_AMO_V5_STATE_COMMITMENT_MODEL ||
      transition.event_set_model !== WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL || transition.complete !== true || transition.block_atomic !== true ||
      transition.fee_once !== true || transition.invalid_zero !== true || witnessPayload?.transitionChainModel !== WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL ||
      !chainCommitment(witnessPayload?.transitionChainCommitment) || !chainCommitment(witness?.transitionChainCommitmentAfter) ||
      !sameEvidence(witness?.transitionChainCommitmentAfter, trace?.transitionChainCommitmentAfter) ||
      witness?.rawCandidate !== true || witness.outcome?.valid !== true || witness.outcome.kind !== 'pwt1-valid' || witness.outcome.reasonCode !== '' ||
      !samePosition(witness.position, position) || !rawRecord || !sameEvidence(witness.rawWitness?.rawRecordParts, rawRecord.rawRecordParts) ||
      projection?.txid !== event.txid || projection.protocol !== 'pwt1' || projection.kind !== 'token-transfer' || projection.valid !== true ||
      !samePosition(projection.position, position) || projection.tokenId !== JOBS_WORK_TOKEN_ID || projection.senderAddress !== event.authorAddress ||
      projection.recipientAddress !== workerAddress || projection.amountSubatoms !== normalized.amountSubatoms ||
      projection.parsed?.kind !== 'send' || projection.parsed.amountVersion !== 'send3' || projection.parsed.tokenId !== JOBS_WORK_TOKEN_ID ||
      projection.parsed.recipientAddress !== workerAddress || projection.parsed.amountSubatoms !== normalized.amountSubatoms ||
      projection.parsed.payload !== transfer.rawPayload || trace?.valid !== true || trace.reasonCode !== '' ||
      !sameEvidence(trace.output, witness.output) || !sameEvidence(trace.rawWitness, witness.rawWitness) || !sameEvidence(trace.stateDelta, witness.stateDelta) ||
      mailRows.length !== 1 || mailRows[0]?.valid !== true || !candidateEventClosure(tx, mailRows,
        { blockHeight: event.blockHeight, blockHash: event.blockHash, blockTransactionIndex: event.blockTransactionIndex }, transition)) {
    return fail('jobs-work-settlement-evidence-mismatch');
  }
  const delta = witness.stateDelta, registry = tx.vout[transfer.registryVout];
  if (!sameEvidence(delta?.baseContributions, [{ field: 'tokenTransferFlowSats', value: '546' }]) || delta?.creditFixedSats !== '546' ||
      delta?.movement?.amountStorageModel !== 'work-subatoms-v2' || delta.movement.amountSubatoms !== normalized.amountSubatoms ||
      delta.movement.identity !== `transfer:${event.txid}:${transfer.protocolVout}:0` ||
      !sameEvidence(delta.economicOutputs, [{ address: JOBS_WORK_REGISTRY_ADDRESS, attributedSats: '546', outputSats: '546',
        role: 'pwt-token-registry', vout: transfer.registryVout }]) || address(registry) !== JOBS_WORK_REGISTRY_ADDRESS || exactCodeOutputProofs(registry) !== '546') {
    return fail('jobs-work-registry-attribution-mismatch');
  }
  return { valid: true, reward: normalized, paymentTxid: event.txid, protocolVout: transfer.protocolVout, registryVout: transfer.registryVout,
    source: 'canonical-work-send3-relational-raw-replay', blockHeight: event.blockHeight, blockHash: event.blockHash,
    blockTransactionIndex: event.blockTransactionIndex, transitionChainCommitment: witness.transitionChainCommitmentAfter };
}
