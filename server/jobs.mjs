import { createHash } from 'node:crypto';
import { parseJobBody, jobRewardFromMetadata, normalizeJobReward, JOBS_ACTIVATION_HEIGHT, JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH,
  JOBS_V2_ACTIVATION_HEIGHT, JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH, JOBS_WORK_TOKEN_ID, JOBS_WORK_REGISTRY_ADDRESS } from '../src/shared/protocol/jobs.mjs';
import { decodeCanonicalOpReturnOutput, canonicalRawProtocolRecordSetFromTransaction } from './canonical-op-return.mjs';
import { exactCodeOutputProofs } from './code-repositories.mjs';
import { WORK_AMO_V5_STATE_COMMITMENT_MODEL, WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL } from './work-amo-v5.mjs';
import { WORK_AMO_V8_BLOCK_SEQUENCER_MODEL } from './work-amo-v8.mjs';
import { WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL } from './work-amo-v5-raw.mjs';

export const JOBS_DISCOVERY_MODEL = 'canonical-jobs-candidate-discovery-v1';
export const JOBS_DISCOVERY_META_KEY = 'jobs:candidate-discovery';
export const JOBS_SNAPSHOT_MODEL = 'proof-jobs-snapshot-v1';
export const JOBS_DISCOVERY_EMPTY_SHA256 = createHash('sha256').update('ProofOfWork.Me/Jobs/candidate-discovery/v1\n').digest('hex');
const TXID = /^[0-9a-f]{64}$/u;
const markerHex = Buffer.from('pwm1:m:pwj1:', 'ascii').toString('hex');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const isJobsCandidatePart = decoded => decoded.payloadHex.startsWith(markerHex);
export function jobsCandidateParts(tx) {
  return (tx.vout ?? []).map((output, vout) => ({ vout, decoded: decodeCanonicalOpReturnOutput(output) })).filter(item => isJobsCandidatePart(item.decoded));
}
export function advanceJobsCandidateDigest(prior, tx) {
  return sha256(Buffer.from(JSON.stringify({ prior, txid: tx.txid, height: tx.status?.block_height ?? tx.height,
    hash: tx.status?.block_hash ?? tx._powBlockHash, index: tx.blockTransactionIndex ?? tx._powBlockIndex,
    candidates: jobsCandidateParts(tx).map(item => ({ vout: item.vout, script: item.decoded.scriptPubKeyHex })) })));
}
/** Jobs owns no new economic event: close the existing aggregate PWM witness. */
export function jobsCandidateEventClosure(tx, rows, position, transition) {
  const record = canonicalRawProtocolRecordSetFromTransaction(tx).records.find(item => item.protocol === 'pwm1');
  if (!record || !jobsCandidateParts(tx).length || !transition || Number(transition.block_height) !== position.blockHeight || transition.block_hash !== position.blockHash) return false;
  const records = rows.filter(row => row.txid === tx.txid && row.protocol === 'pwm1');
  const witnesses = (transition.payload?.replayRecords ?? []).filter(item => item.txid === tx.txid && item.protocol === 'pwm1' && item.rawCandidate === true);
  if (records.length !== 1 || witnesses.length !== 1) return false;
  const row = records[0], witness = witnesses[0];
  return row.status === 'confirmed' && Number(row.block_height) === position.blockHeight && Number(row.block_index) === position.blockTransactionIndex &&
    Number(row.op_return_vout) === record.protocolVout && Number(row.record_ordinal) === 0 && row.raw_payload === record.message &&
    row.payload?._workAmoV5ReplayBound === true && row.payload?.workAmoV5RawCandidate === true &&
    witness.position?.blockHeight === position.blockHeight && witness.position?.blockHash === position.blockHash &&
    witness.position?.blockTransactionIndex === position.blockTransactionIndex && witness.position?.protocolVout === record.protocolVout &&
    witness.position?.recordOrdinal === 0 && witness.outcome?.valid === row.valid &&
    sameEvidence(witness.rawWitness?.rawRecordParts, record.rawRecordParts);
}
function address(output) { return output?.scriptpubkey_address ?? output?.scriptPubKey?.address ?? output?.address ?? ''; }
const exactProofReward = reward => reward?.asset === 'proofs' ? reward.amountSats : '0';
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
export function verifyJobsWorkSettlement(tx, event, workerAddress, reward) {
  const fail = reason => ({ valid: false, reason });
  const normalized = normalizeJobReward(reward), transfer = event.workTransfer;
  if (!event.confirmed || event.metadata?.v !== 2 || normalized?.asset !== 'WORK' || !transfer ||
      transfer.token !== normalized.token || transfer.amountSubatoms !== normalized.amountSubatoms || transfer.recipientAddress !== workerAddress) {
    return fail('jobs-agreed-work-payment-mismatch');
  }
  const evidenceRows = tx?._jobsWorkSettlementEvidence;
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
      mailRows.length !== 1 || mailRows[0]?.valid !== true || !jobsCandidateEventClosure(tx, mailRows,
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
function decodeBase64(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/u.test(text)) return null;
  const bytes = Buffer.from(text, 'base64url');
  return bytes.toString('base64url') === text ? bytes : null;
}
function attachment(records) {
  const parts = records.filter(item => item.text.startsWith('pwm1:a:'));
  if (!parts.length) return null;
  let metadata, total; const chunks = new Map();
  for (const item of parts) {
    const match = /^pwm1:a:([^:]+):([^:]+):([1-9]\d*):([0-9a-f]{64}):(0|[1-9]\d*)\/([1-9]\d*):([A-Za-z0-9_-]*)$/u.exec(item.text);
    if (!match) throw new Error('jobs-attachment-malformed');
    const mime = decodeBase64(match[1]), name = decodeBase64(match[2]), index = Number(match[5]), count = Number(match[6]);
    const decode = new TextDecoder('utf-8', { fatal: true });
    if (!mime || !name) throw new Error('jobs-attachment-metadata-invalid');
    const next = { mime: decode.decode(mime), name: decode.decode(name), size: Number(match[3]), sha256: match[4] };
    if (!next.mime || !next.name || next.mime.includes('\0') || next.name.includes('\0') || next.size > 60000 ||
        !Number.isSafeInteger(index) || !Number.isSafeInteger(count) || count > 1000 || index >= count || chunks.has(index) ||
        (metadata && (JSON.stringify(metadata) !== JSON.stringify(next) || count !== total))) throw new Error('jobs-attachment-ambiguous');
    metadata = next; total = count; chunks.set(index, match[7]);
  }
  if (chunks.size !== total) throw new Error('jobs-attachment-incomplete');
  const bytes = decodeBase64(Array.from({ length: total }, (_, index) => chunks.get(index)).join(''));
  if (!bytes || bytes.length !== metadata.size || sha256(bytes) !== metadata.sha256) throw new Error('jobs-attachment-bytes-unverified');
  return metadata;
}

/** Raw scripts and hydrated input prevouts are authority; content stays untrusted. */
export function verifyJobsTransaction(tx) {
  const candidates = jobsCandidateParts(tx);
  if (!candidates.length) return null;
  const decoded = tx.vout.map((output, vout) => ({ ...decodeCanonicalOpReturnOutput(output), vout }));
  const carriers = decoded.filter(item => item.scriptPubKeyHex.startsWith('6a'));
  const pwm = carriers.filter(item => item.prefix === 'pwm1:');
  const messages = pwm.filter(item => item.decodeValid && item.text.startsWith('pwm1:m:'));
  const first = candidates[0], parsed = first.decoded.decodeValid ? parseJobBody(first.decoded.text.slice(7)) : null;
  const workCarriers = carriers.filter(item => item.prefix === 'pwt1:');
  let workTransfer;
  const errors = []; const reject = reason => { if (!errors.includes(reason)) errors.push(reason); };
  if (!TXID.test(tx.txid)) reject('jobs-txid-invalid');
  if (candidates.length !== 1 || messages.length !== 1) reject('jobs-body-ambiguous');
  if (!parsed) reject('jobs-metadata-invalid');
  const workAcceptance = parsed?.metadata.v === 2 && parsed?.action === 'accept';
  if (decoded.some(item => !item.scriptPubKeyHex) || carriers.some(item => !item.decodeValid ||
      (item.prefix !== 'pwm1:' && !(workAcceptance && item.prefix === 'pwt1:')))) reject('jobs-raw-carrier-invalid');
  if (workCarriers.length) {
    const transfer = workCarriers.length === 1 && /^pwt1:send3:([0-9a-f]{64}):([1-9]\d*):([^:]+)$/u.exec(workCarriers[0].text);
    const reward = transfer && normalizeJobReward({ asset: 'WORK', token: transfer[1], amountSubatoms: transfer[2] });
    const lastMailVout = pwm.at(-1)?.vout ?? -1;
    const registryOutputs = transfer ? tx.vout.map((output, vout) => ({ output, vout })).filter(item =>
      item.vout > lastMailVout && item.vout < workCarriers[0].vout && address(item.output) === JOBS_WORK_REGISTRY_ADDRESS) : [];
    if (!workAcceptance || !reward || lastMailVout >= workCarriers[0].vout || registryOutputs.length !== 1 ||
        exactCodeOutputProofs(registryOutputs[0].output) !== '546') reject('jobs-work-transfer-shape-invalid');
    else workTransfer = { token: reward.token, amountSubatoms: reward.amountSubatoms, recipientAddress: transfer[3],
      rawPayload: workCarriers[0].text, protocolVout: workCarriers[0].vout, registryVout: registryOutputs[0].vout };
  }
  const carrierBytes = carriers.reduce((sum, item) => sum + item.scriptPubKeyHex.length / 2, 0);
  if (carrierBytes > 100000) reject('jobs-carrier-budget-exceeded');
  if (pwm.some(item => !/^pwm1:(?:m|s|r|a):/u.test(item.text))) reject('jobs-mail-envelope-invalid');
  const subjects = pwm.filter(item => item.text.startsWith('pwm1:s:'));
  if (subjects.length > 1 || subjects.some(item => {
    const bytes = decodeBase64(item.text.slice(7));
    try { return !bytes || new TextDecoder('utf-8', { fatal: true }).decode(bytes).includes('\0'); } catch { return true; }
  })) reject('jobs-mail-subject-invalid');
  const replies = pwm.filter(item => item.text.startsWith('pwm1:r:'));
  if (replies.length > 1 || replies.some(item => !TXID.test(item.text.slice(7)))) reject('jobs-mail-reply-invalid');
  let deliveryAttachment;
  try { deliveryAttachment = attachment(pwm); } catch (error) { reject(error.message.startsWith('jobs-') ? error.message : 'jobs-attachment-metadata-invalid'); }
  if (parsed?.action !== 'deliver' && pwm.some(item => item.text.startsWith('pwm1:a:'))) reject('jobs-unexpected-attachment');
  const inputs = Array.isArray(tx.vin) ? tx.vin : [];
  const addresses = inputs.map(input => address(input.prevout ?? input.previousOutput));
  const authorAddress = addresses[0] ?? '';
  if (!authorAddress || inputs.length === 0 || inputs.some(input => input.coinbase) || addresses.some(value => value !== authorAddress)) reject('jobs-input-authority-unavailable');
  const payments = new Map();
  tx.vout.forEach((output, index) => {
    const value = exactCodeOutputProofs(output);
    if (value === null) reject('jobs-output-value-invalid');
    else if (decoded[index].scriptPubKeyHex.startsWith('6a') && value !== '0') reject('jobs-funded-carrier-invalid');
    else if (index < (pwm[0]?.vout ?? 0) && address(output)) payments.set(address(output), (payments.get(address(output)) ?? 0n) + BigInt(value));
  });
  const confirmed = tx.status?.confirmed === true;
  const blockHeight = tx.status?.block_height, blockHash = tx.status?.block_hash, blockTransactionIndex = tx.blockTransactionIndex;
  if (confirmed && (!Number.isSafeInteger(blockHeight) || blockHeight < 1 || !TXID.test(blockHash ?? '') ||
      !Number.isSafeInteger(blockTransactionIndex) || blockTransactionIndex < 0)) reject('jobs-canonical-position-unavailable');
  if (confirmed && Number.isSafeInteger(blockHeight) && blockHeight < JOBS_ACTIVATION_HEIGHT) reject('jobs-before-activation');
  if (confirmed && parsed?.metadata.v === 2 && Number.isSafeInteger(blockHeight) && blockHeight < JOBS_V2_ACTIVATION_HEIGHT) reject('jobs-v2-before-activation');
  const metadata = parsed?.metadata ?? null;
  return { txid: tx.txid, protocol: 'pwm1', app: 'Jobs', action: parsed?.action ?? 'invalid', kind: `jobs-${parsed?.action ?? 'invalid'}`,
    authorAddress, metadata, jobTxid: parsed?.action === 'brief' ? tx.txid : metadata?.job ?? '',
    confirmed, status: confirmed ? 'confirmed' : 'pending', blockHeight, blockHash, blockTransactionIndex,
    blockTime: tx.timestamp ?? null, protocolVout: first.vout, recordOrdinal: 0, rawBody: first.decoded.decodeValid ? first.decoded.text.slice(7) : '',
    payments: Object.fromEntries([...payments].map(([key, value]) => [key, value.toString()])),
    amountSats: [...payments.values()].reduce((sum, value) => sum + value, 0n).toString(), carrierBytes,
    valid: errors.length === 0, applied: false, validationErrors: errors,
    ...(workTransfer ? { workTransfer } : {}),
    ...(deliveryAttachment ? { attachment: { ...deliveryAttachment, txid: tx.txid } } : {}) };
}

export function replayJobsTransactions(transactions) {
  const transactionsById = new Map(transactions.map(tx => [tx.txid, tx]));
  const events = transactions.map(verifyJobsTransaction).filter(Boolean).sort((a, b) => Number(b.confirmed) - Number(a.confirmed) ||
    (a.confirmed ? a.blockHeight - b.blockHeight || a.blockTransactionIndex - b.blockTransactionIndex || a.protocolVout - b.protocolVout : a.txid.localeCompare(b.txid)));
  const jobs = new Map(), byTxid = new Map(), positions = new Set(), hashes = new Map();
  for (const event of events) {
    if (byTxid.has(event.txid)) throw jobsReadError('Jobs replay contains duplicate transaction evidence.');
    byTxid.set(event.txid, event);
    if (event.confirmed && !event.validationErrors.includes('jobs-canonical-position-unavailable')) {
      const slot = `${event.blockHeight}:${event.blockTransactionIndex}`;
      if (positions.has(slot) || (hashes.has(event.blockHeight) && hashes.get(event.blockHeight) !== event.blockHash)) throw jobsReadError('Jobs replay contains ambiguous canonical positions.');
      positions.add(slot); hashes.set(event.blockHeight, event.blockHash);
    }
    if (!event.confirmed || !event.valid) continue;
    const reject = reason => { event.valid = false; event.validationErrors.push(reason); };
    const payment = target => BigInt(event.payments[target] ?? '0');
    if (event.action === 'brief') {
      if (payment(event.authorAddress) < 546n) { reject('jobs-self-payment-insufficient'); continue; }
      const value = event.metadata;
      const reward = jobRewardFromMetadata(value);
      jobs.set(event.txid, { txid: event.txid, title: value.title, brief: value.scope, scope: value.scope,
        offeredReward: reward, reward, paidReward: null, offeredRewardSats: exactProofReward(reward), rewardSats: exactProofReward(reward), requesterAddress: event.authorAddress,
        status: 'open', headTxid: event.txid, workerAddress: '', proposalTxid: '', assignmentTxid: '', deliveryTxid: '',
        acceptanceTxid: '', paymentTxid: '', paidSats: '0', blockHeight: event.blockHeight, blockHash: event.blockHash,
        blockTransactionIndex: event.blockTransactionIndex, blockTime: event.blockTime });
      event.applied = true; continue;
    }
    const job = jobs.get(event.jobTxid);
    if (!job) { reject('jobs-brief-unavailable'); continue; }
    if (['paid', 'cancelled'].includes(job.status)) { reject('jobs-already-closed'); continue; }
    const value = event.metadata;
    if (event.action === 'propose') {
      if (job.status !== 'open' || event.authorAddress === job.requesterAddress) { reject('jobs-proposal-not-allowed'); continue; }
      if (payment(job.requesterAddress) < 546n) { reject('jobs-requester-payment-insufficient'); continue; }
      event.applied = true; continue;
    }
    if (event.action !== 'deliver' && event.authorAddress !== job.requesterAddress) { reject('jobs-requester-authority-mismatch'); continue; }
    if (event.action === 'assign') {
      const proposal = byTxid.get(value.proposal);
      if (job.status !== 'open' || proposal?.action !== 'propose' || proposal.jobTxid !== job.txid || !proposal.applied) { reject('jobs-proposal-unavailable'); continue; }
      if (payment(proposal.authorAddress) < 546n) { reject('jobs-worker-payment-insufficient'); continue; }
      const reward = jobRewardFromMetadata(proposal.metadata);
      if (reward.asset === 'WORK' && value.v !== 2) { reject('jobs-work-version-required'); continue; }
      Object.assign(job, { status: 'assigned', workerAddress: proposal.authorAddress, proposalTxid: proposal.txid,
        assignmentTxid: event.txid, scope: proposal.metadata.scope, reward, rewardSats: exactProofReward(reward) });
    } else if (event.action === 'deliver') {
      if (!['assigned', 'delivered'].includes(job.status) || event.authorAddress !== job.workerAddress || value.assignment !== job.assignmentTxid) { reject('jobs-worker-authority-mismatch'); continue; }
      if (payment(job.requesterAddress) < 546n) { reject('jobs-requester-payment-insufficient'); continue; }
      Object.assign(job, { status: 'delivered', deliveryTxid: event.txid });
    } else if (event.action === 'accept') {
      if (job.status !== 'delivered' || value.delivery !== job.deliveryTxid) { reject('jobs-delivery-stale'); continue; }
      if (job.reward.asset === 'WORK') {
        if (payment(job.workerAddress) < 546n) { reject('jobs-worker-payment-insufficient'); continue; }
        const settlement = verifyJobsWorkSettlement(transactionsById.get(event.txid), event, job.workerAddress, job.reward);
        if (!settlement.valid) { reject(settlement.reason); continue; }
        event.workSettlement = settlement;
      } else {
        if (event.workTransfer) { reject('jobs-unexpected-work-transfer'); continue; }
        if (payment(job.workerAddress) !== BigInt(job.rewardSats)) { reject('jobs-agreed-payment-mismatch'); continue; }
      }
      Object.assign(job, { status: 'paid', acceptanceTxid: event.txid, paymentTxid: event.txid, paidSats: job.rewardSats, paidReward: { ...job.reward },
        ...(event.workSettlement ? { workSettlement: event.workSettlement } : {}) });
    } else if (event.action === 'cancel') {
      if (payment(job.requesterAddress) < 546n) { reject('jobs-self-payment-insufficient'); continue; }
      job.status = 'cancelled';
    }
    job.headTxid = event.txid; event.applied = true;
  }
  return { jobs: [...jobs.values()], events };
}

export function jobsReadError(message, statusCode = 503, code = 'JOBS_UNAVAILABLE') { return Object.assign(new Error(message), { statusCode, details: { code } }); }
const token = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function decodeToken(value) {
  try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); if (value.length > 4096 || token(parsed) !== value) throw new Error(); return parsed; }
  catch { throw jobsReadError('Jobs continuation is invalid; restart the read.', 400, 'JOBS_CURSOR_INVALID'); }
}
export function jobsSnapshotRequest(params, network) {
  const continuation = params.get('cursor') ? decodeToken(params.get('cursor')) : null;
  const explicit = params.get('snapshot'), snapshot = continuation?.snapshot ?? (explicit ? decodeToken(explicit) : null);
  if (snapshot && (snapshot.model !== JOBS_SNAPSHOT_MODEL || snapshot.network !== network || !Number.isSafeInteger(snapshot.checkpointHeight) || snapshot.checkpointHeight < 1 || !TXID.test(snapshot.checkpointHash))) throw jobsReadError('Jobs snapshot is invalid.', 400, 'JOBS_SNAPSHOT_INVALID');
  if (continuation && (!Number.isSafeInteger(continuation.offset) || continuation.offset < 0 || (explicit && token(snapshot) !== explicit))) throw jobsReadError('Jobs cursor is invalid.', 400, 'JOBS_CURSOR_INVALID');
  return { snapshot, continuation };
}
export function createJobsSnapshot({ network, checkpointHeight, checkpointHash, transactions, generatedAt, v2Ready = false }) {
  if (!Number.isSafeInteger(checkpointHeight) || checkpointHeight < 1 || !TXID.test(checkpointHash)) throw jobsReadError('Jobs has no exact canonical checkpoint.');
  const confirmed = replayJobsTransactions(transactions.filter(tx => tx.status?.confirmed === true));
  const observed = replayJobsTransactions(transactions);
  const snapshot = { model: JOBS_SNAPSHOT_MODEL, network, checkpointHeight, checkpointHash };
  return { ...confirmed, pendingEvents: observed.events.filter(event => !event.confirmed), snapshot: { ...snapshot, id: token(snapshot) }, generatedAt, v2Ready };
}
function envelope(state) {
  return { network: state.snapshot.network, snapshot: state.snapshot, snapshotId: state.snapshot.id,
    activationHeight: JOBS_ACTIVATION_HEIGHT, activationPreviousBlockHash: JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH,
    versions: { supported: [1, 2], current: 2, v2ActivationHeight: JOBS_V2_ACTIVATION_HEIGHT,
      v2ActivationPreviousBlockHash: JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH, v2Ready: state.v2Ready === true },
    indexedThroughBlock: state.snapshot.checkpointHeight, indexedThroughBlockHash: state.snapshot.checkpointHash,
    generatedAt: state.generatedAt, complete: true, source: 'proof-indexer-exact-canonical-jobs-replay', pendingComplete: false,
    pendingBestEffort: true, pendingWarnings: state.pendingWarnings ?? [] };
}
export function jobsStats(state) {
  const count = status => state.jobs.filter(job => job.status === status).length;
  const applied = action => state.events.filter(event => event.applied && event.action === action).length;
  return { jobs: state.jobs.length, open: count('open'), assigned: count('assigned'), delivered: count('delivered'), paid: count('paid'),
    cancelled: count('cancelled'), proposals: applied('propose'), deliveries: applied('deliver'), acceptedPayments: applied('accept'),
    paidProofs: state.jobs.reduce((sum, job) => sum + BigInt(job.paidSats), 0n).toString(), events: state.events.length,
    paidWorkSubatoms: state.jobs.reduce((sum, job) => sum + BigInt(job.paidReward?.asset === 'WORK' ? job.paidReward.amountSubatoms : '0'), 0n).toString(),
    invalidEvents: state.events.filter(event => !event.valid).length };
}
export function jobsPayload(state, params = new URLSearchParams()) {
  const { continuation } = jobsSnapshotRequest(params, state.snapshot.network);
  const addressFilter = params.get('address') ?? '', q = (params.get('q') ?? '').toLowerCase(), status = params.get('status') ?? '';
  if (status && !['open', 'assigned', 'delivered', 'paid', 'cancelled'].includes(status)) throw jobsReadError('Jobs status filter is invalid.', 400, 'JOBS_STATUS_INVALID');
  const scope = JSON.stringify(['jobs', addressFilter, q, status]);
  if (continuation && continuation.scope !== scope) throw jobsReadError('Jobs cursor belongs to another query.', 400, 'JOBS_CURSOR_SCOPE');
  const limitText = params.get('limit') ?? '30';
  if (!/^[1-9]\d{0,2}$/u.test(limitText) || Number(limitText) > 200) throw jobsReadError('Jobs limit must be from 1 to 200.', 400, 'JOBS_LIMIT_INVALID');
  const involved = new Set(state.events.filter(event => event.applied && event.authorAddress === addressFilter).map(event => event.jobTxid));
  const jobs = state.jobs.filter(job => (!addressFilter || job.requesterAddress === addressFilter || job.workerAddress === addressFilter || involved.has(job.txid)) &&
    (!status || job.status === status) && (!q || `${job.title}\n${job.brief}\n${job.scope}\n${job.txid}\n${job.requesterAddress}\n${job.workerAddress}`.toLowerCase().includes(q))).reverse();
  const offset = continuation?.offset ?? 0, limit = Number(limitText);
  if (offset > jobs.length) throw jobsReadError('Jobs cursor exceeds the snapshot.', 400, 'JOBS_CURSOR_INVALID');
  const values = jobs.slice(offset, offset + limit), hasMore = offset + values.length < jobs.length;
  const { id, ...snapshot } = state.snapshot;
  return { ...envelope(state), jobs: values, stats: jobsStats(state), pagination: { limit, total: jobs.length, hasMore,
    nextCursor: hasMore ? token({ snapshot, scope, offset: offset + values.length }) : null }, pendingEvents: state.pendingEvents };
}
export function jobPayload(state, params = new URLSearchParams()) {
  const txid = params.get('job') ?? '';
  if (!TXID.test(txid)) throw jobsReadError('Job must be its brief transaction ID.', 400, 'JOBS_JOB_INVALID');
  const job = state.jobs.find(item => item.txid === txid);
  if (!job) throw jobsReadError('Job is absent from this confirmed snapshot.', 404, 'JOBS_JOB_NOT_FOUND');
  const events = state.events.filter(event => event.jobTxid === txid);
  if (Buffer.byteLength(JSON.stringify(events)) > 8 * 1024 * 1024) throw jobsReadError('Jobs history exceeds the verified response bound; it cannot be presented as complete.');
  return { ...envelope(state), job, events, eventsComplete: true, proposalsComplete: true, deliveriesComplete: true,
    proposals: events.filter(event => event.action === 'propose' && event.applied), deliveries: events.filter(event => event.action === 'deliver' && event.applied),
    pendingEvents: state.pendingEvents.filter(event => event.jobTxid === txid) };
}
export function jobsLogPayloadHasCandidates(payload) {
  return [payload?.items, payload?.events, payload?.activity].some(items => Array.isArray(items) && items.some(item =>
    item?.protocol === 'pwm1' && (String(item.memo ?? item.body ?? '').startsWith('pwj1:') || /(?:^|\n)pwm1:m:pwj1:/u.test(String(item.payload ?? item.rawPayload ?? '')))));
}
export function qualifyJobsLogPayload(payload, events, checkpoint, unavailable = '') {
  const byTxid = new Map(events.map(event => [event.txid, event]));
  const qualify = item => {
    if (item?.protocol !== 'pwm1') return item;
    const event = byTxid.get(item.txid);
    if (!event && !String(item.memo ?? item.body ?? '').startsWith('pwj1:') && !/(?:^|\n)pwm1:m:pwj1:/u.test(String(item.payload ?? item.rawPayload ?? ''))) return item;
    return { ...item, jobs: event && event.confirmed ? { ready: true, action: event.action, jobTxid: event.jobTxid,
      authorAddress: event.authorAddress, valid: event.valid, applied: event.applied, validationErrors: event.validationErrors,
      model: 'canonical-jobs-lifecycle-replay-v1', ...checkpoint } : { ready: false, reason: unavailable || 'pending-best-effort' } };
  };
  return { ...payload, ...(Array.isArray(payload?.items) ? { items: payload.items.map(qualify) } : {}),
    ...(Array.isArray(payload?.events) ? { events: payload.events.map(qualify) } : {}),
    ...(Array.isArray(payload?.activity) ? { activity: payload.activity.map(qualify) } : {}) };
}
