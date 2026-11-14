/** Public deterministic fixture keys, never a funded wallet or production receipt. */
import * as bitcoin from 'bitcoinjs-lib';
import { encodePayRecord, PAY_ACTIVATION_HEIGHT, PAY_WORK_TOKEN_ID, PAY_WORK_REGISTRY_ADDRESS } from '../src/shared/protocol/pay.mjs';
import { canonicalRawProtocolRecordSetFromTransaction } from './canonical-op-return.mjs';
import { fixtureKeys, fixtureOwner, fixtureCarrier, signPermissionFixture } from './permission-test-fixtures.mjs';
import { WORK_AMO_V5_STATE_COMMITMENT_MODEL, WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL } from './work-amo-v5.mjs';
import { WORK_AMO_V8_BLOCK_SEQUENCER_MODEL } from './work-amo-v8.mjs';
import { WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL } from './work-amo-v5-raw.mjs';
export { fixtureKeys, fixtureOwner, fixtureCarrier, signPermissionFixture };
export const issuer = fixtureOwner(fixtureKeys[0]).address;
export const payer = fixtureOwner(fixtureKeys[1]).address;
export const hashForHeight = height => height.toString(16).padStart(64, '0');
export const proofAmount = (amountSats = '1200') => ({ asset: 'proofs', amountSats });
export const workAmount = (amountSubatoms = '10000000000000001') => ({ asset: 'WORK', token: PAY_WORK_TOKEN_ID, amountSubatoms });
export const invoiceMetadata = (overrides = {}) => ({ v: 1, title: 'A complete page', description: 'Exact scope\n', recipient: issuer, amount: proofAmount(), reference: null, ...overrides });
function output(recipient, value) { return { scriptpubkey_address: recipient, scriptpubkey: Buffer.from(bitcoin.address.toOutputScript(recipient)).toString('hex'), value }; }
export function attachPayMailEvidence(tx, valid = true) {
  const mail = canonicalRawProtocolRecordSetFromTransaction(tx).records.find(item => item.protocol === 'pwm1');
  const position = { blockHeight: tx.status.block_height, blockHash: tx.status.block_hash, blockTransactionIndex: tx.blockTransactionIndex, protocolVout: mail.protocolVout, recordOrdinal: 0 };
  const row = { txid: tx.txid, protocol: 'pwm1', status: 'confirmed', valid, block_height: position.blockHeight,
    block_index: position.blockTransactionIndex, op_return_vout: mail.protocolVout, record_ordinal: 0, raw_payload: mail.message,
    payload: { _workAmoV5ReplayBound: true, workAmoV5RawCandidate: true } };
  const witness = { txid: tx.txid, protocol: 'pwm1', rawCandidate: true, position, outcome: { valid }, rawWitness: { rawRecordParts: mail.rawRecordParts } };
  const transition = { block_height: position.blockHeight, block_hash: position.blockHash,
    complete: true, block_atomic: true, fee_once: true, invalid_zero: true, payload: { replayRecords: [witness] } };
  tx._payMailEvidence = { rows: [row], transition }; return tx;
}
export function payFixture({ nonce = 1, action = 'invoice', metadata = invoiceMetadata(), key = fixtureKeys[0],
  recipient = fixtureOwner(key).address, payment = '546', height = PAY_ACTIVATION_HEIGHT, index = 1, confirmed = true,
  work = null, types, outputs = null } = {}) {
  const owner = fixtureOwner(key), body = encodePayRecord(action, metadata);
  const vout = [...(outputs ?? [output(recipient, payment)]), { scriptpubkey: fixtureCarrier('pwm1:m:' + body), value: '0' }];
  if (work) vout.push(output(PAY_WORK_REGISTRY_ADDRESS, '546'),
    { scriptpubkey: fixtureCarrier(`pwt1:send3:${PAY_WORK_TOKEN_ID}:${work.amountSubatoms}:${recipient}`), value: '0' });
  const tx = { version: 2, locktime: 0, vin: [{ txid: BigInt(nonce).toString(16).padStart(64,'0'), vout: 0, sequence: 0xfffffffd, scriptsig: '',
    prevout: { scriptpubkey_address: owner.address, scriptpubkey: owner.script, value: '1000000' } }], vout,
    status: { confirmed, ...(confirmed ? { block_height: height, block_hash: hashForHeight(height) } : {}) }, blockTransactionIndex: index,
    timestamp: new Date(1700000000000 + nonce * 1000).toISOString() };
  signPermissionFixture(tx, { keys: [key], types });
  if (confirmed) { attachPayMailEvidence(tx); if (work) attachPayWorkEvidence(tx); }
  return tx;
}
export function paidFixtures(amount = proofAmount()) {
  const invoice = payFixture({ metadata: invoiceMetadata({ amount }) });
  const payment = payFixture({ nonce: 2, action: 'pay', metadata: { v: 1, invoice: invoice.txid }, key: fixtureKeys[1], recipient: issuer,
    payment: amount.asset === 'proofs' ? amount.amountSats : '546', height: PAY_ACTIVATION_HEIGHT + 1, work: amount.asset === 'WORK' ? amount : null });
  return [invoice, payment];
}
export function attachPayWorkEvidence(transaction) {
  const senderAddress = transaction.vin[0].prevout.scriptpubkey_address;
  const raw = canonicalRawProtocolRecordSetFromTransaction(transaction).records;
  const record = raw.find(item=>item.protocol==='pwt1'), mail = raw.find(item=>item.protocol==='pwm1');
  const parts = record.message.split(':'), amountSubatoms = parts[3], recipientAddress = parts[4];
  const position = { blockHeight:transaction.status.block_height,blockHash:transaction.status.block_hash,
    blockTransactionIndex:transaction.blockTransactionIndex,protocolVout:record.protocolVout,recordOrdinal:0 };
  const commitment = {model:WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,payloadBytes:100,sha256:'7'.repeat(64)};
  const projection = {txid:transaction.txid,protocol:'pwt1',kind:'token-transfer',valid:true,position,
    senderAddress:senderAddress,recipientAddress,tokenId:PAY_WORK_TOKEN_ID,amountSubatoms,
    parsed:{kind:'send',amountVersion:'send3',tokenId:PAY_WORK_TOKEN_ID,amountSubatoms,recipientAddress,payload:record.message}};
  const stateDelta = {baseContributions:[{field:'tokenTransferFlowSats',value:'546'}],creditFixedSats:'546',
    economicOutputs:[{address:PAY_WORK_REGISTRY_ADDRESS,attributedSats:'546',outputSats:'546',role:'pwt-token-registry',vout:record.protocolVout-1}],
    movement:{amountStorageModel:'work-subatoms-v2',amountSubatoms,identity:`transfer:${transaction.txid}:${record.protocolVout}:0`}};
  const witness={txid:transaction.txid,protocol:'pwt1',rawCandidate:true,position,outcome:{valid:true,kind:'pwt1-valid',reasonCode:''},
    output:{amountSubatoms,senderAddress:senderAddress,recipientAddress,tokenId:PAY_WORK_TOKEN_ID,projection},
    rawWitness:{model:'canonical-raw-protocol-record-v1',rawRecordParts:record.rawRecordParts},stateDelta,transitionChainCommitmentAfter:commitment};
  const mailWitness={txid:transaction.txid,protocol:'pwm1',rawCandidate:true,
    position:{...position,protocolVout:mail.protocolVout},outcome:{valid:true},rawWitness:{rawRecordParts:mail.rawRecordParts}};
  const trace={txid:transaction.txid,kind:'protocol-record',position,valid:true,reasonCode:'',output:witness.output,
    rawWitness:witness.rawWitness,stateDelta,transitionChainCommitmentAfter:commitment};
  const mailEvents=[{txid:transaction.txid,protocol:'pwm1',status:'confirmed',valid:true,block_height:position.blockHeight,
    block_index:position.blockTransactionIndex,op_return_vout:mail.protocolVout,record_ordinal:0,raw_payload:mail.message,
    payload:{_workAmoV5ReplayBound:true,workAmoV5RawCandidate:true}}];
  transaction._payWorkSettlementEvidence=[{network:'livenet',txid:transaction.txid,protocol:'pwt1',kind:'token-transfer',status:'confirmed',valid:true,
    block_height:position.blockHeight,block_hash:position.blockHash,block_index:position.blockTransactionIndex,op_return_vout:record.protocolVout,
    record_ordinal:0,raw_payload:record.message,payload:{confirmed:true,valid:true,_workAmoV5ReplayBound:true,workAmoV5RawCandidate:true,
      workAmoV5ReplayOutcome:witness.outcome,workAmoV5ReplayOutput:witness.output,workAmoV5ReplayRawWitness:witness.rawWitness},mailEvents,
    transition:{block_height:position.blockHeight,block_hash:position.blockHash,model:WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
      state_commitment_model:WORK_AMO_V5_STATE_COMMITMENT_MODEL,event_set_model:WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL,
      complete:true,block_atomic:true,fee_once:true,invalid_zero:true,payload:{transitionChainModel:WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
        transitionChainCommitment:commitment,replayRecords:[mailWitness,witness],traces:[trace]}}}];
}
