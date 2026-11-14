import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as bitcoin from 'bitcoinjs-lib';
import { paidFixtures, workAmount, payer, issuer, hashForHeight } from './pay-test-fixtures.mjs';
import { PAY_ACTIVATION_HEIGHT } from '../src/shared/protocol/pay.mjs';
import { replayPayTransactions, payStats } from './pay.mjs';
import { canonicalRawProtocolRecordSetFromTransaction } from './canonical-op-return.mjs';
import { WORK_AMO_V5_STATE_COMMITMENT_MODEL, WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL, WORK_AMO_V5_BASE_STATE_FIELDS } from './work-amo-v5.mjs';
import { WORK_AMO_V8_BLOCK_SEQUENCER_MODEL, workAmoV8CanonicalTokenStateCommitment } from './work-amo-v8.mjs';
import { replayWorkAmoV5RawBlock, normalizeWorkAmoV5RawGenericState, normalizeWorkAmoV5RawIdState,
  normalizeWorkAmoV5RawWorkState, workAmoV5RawGenericStateCommitment, workAmoV5RawIdStateCommitment } from './work-amo-v5-raw.mjs';

test('actual raw Q16 engine settles a signed Pay record once and exposes unfunded transfer rejection', () => {
  const amount = workAmount('1'), [invoice, payment] = paidFixtures(amount), height = PAY_ACTIVATION_HEIGHT + 1;
  const serial = bitcoin.Transaction.fromHex(payment.hex), parent = hashForHeight(PAY_ACTIVATION_HEIGHT);
  payment._powBlockIndex = 1;
  const coinbase = new bitcoin.Transaction(); coinbase.version = 2;
  coinbase.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from('0401010101','hex')); coinbase.addOutput(Buffer.from('51','hex'), 0n);
  const coinbaseEnvelope = { txid: coinbase.getId(), hex: coinbase.toHex(), version: 2, locktime: 0, _powBlockIndex: 0,
    vin: [{ coinbase: '0401010101', sequence: 0xffffffff }], vout: [{ scriptpubkey: '51', value: '0' }] };
  const block = new bitcoin.Block(); block.version = 1; block.prevHash = Buffer.from(parent, 'hex').reverse();
  block.merkleRoot = bitcoin.Block.calculateMerkleRoot([coinbase, serial]); block.timestamp = 1700000000; block.bits = 0x1d00ffff; block.nonce = 0;
  const blockHash = block.getId(); payment.status.block_hash = blockHash;
  const raw = canonicalRawProtocolRecordSetFromTransaction(payment).records;
  const fee = (BigInt(payment.vin[0].prevout.value) - payment.vout.reduce((sum, output) => sum + BigInt(output.value), 0n)).toString();
  const records = raw.map(record => ({ ...record, position: { blockHeight: height, blockHash, blockTransactionIndex: 1,
    protocolVout: record.protocolVout, recordOrdinal: record.recordOrdinal }, transactionMinerFeeSats: fee,
    transactionProtocolRecordCount: raw.length, rawPayloadHex: record.rawRecordParts.map(part => part.payloadHex).join(''),
    rawScriptPubKeyHex: record.rawRecordParts[0].scriptPubKeyHex, tx: payment, txid: payment.txid }));
  const generic = normalizeWorkAmoV5RawGenericState({ holders: [], listings: [], tokens: [] });
  const ids = normalizeWorkAmoV5RawIdState({ records: [], listings: [] });
  const funded = normalizeWorkAmoV5RawWorkState({ amountStorageModel: 'work-subatoms-v2', confirmedSupplySubatoms: '1',
    holders: [{ address: payer, balanceSubatoms: '1' }], listings: [] });
  const empty = normalizeWorkAmoV5RawWorkState({ amountStorageModel: 'work-subatoms-v2', confirmedSupplySubatoms: '0', holders: [], listings: [] });
  for (const openingWorkState of [funded, empty]) {
    const replay = replayWorkAmoV5RawBlock({ blockHeaderHex: block.toHex(true), blockTransactions: [coinbaseEnvelope, payment], expectedBlockHash: blockHash,
      expectedBlockHeight: height, expectedPreviousBlockHash: parent, records, openingGenericState: generic, openingIdState: ids, openingWorkState,
      workAmoV8: { activationHeight: 960601 }, openingEconomicState: { model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL, network: 'livenet',
        baseState: Object.fromEntries(WORK_AMO_V5_BASE_STATE_FIELDS.map(field => [field, '0'])), creditFixedQ8: '1000000000',
        creditMovementFrozenValueQ8: '0', movements: [], networkValueQ8: '1000000000', quoteHead: null,
        throughBlockHeight: height - 1, throughBlockHash: parent, genericTokenStateCommitment: workAmoV5RawGenericStateCommitment(generic),
        idStateCommitment: workAmoV5RawIdStateCommitment(ids), tokenStateCommitment: workAmoV8CanonicalTokenStateCommitment(openingWorkState) } });
    const witnesses = replay.events.map(event => ({ txid: event.txid, protocol: event.protocol, rawCandidate: true, position: event.position,
      outcome: { valid: event.valid, kind: `${event.protocol}-${event.valid ? 'valid' : 'invalid'}`, reasonCode: event.reasonCode }, output: event.output,
      rawWitness: records.find(record => record.protocol === event.protocol).payload, stateDelta: event.stateDelta,
      transitionChainCommitmentAfter: event.transitionChainCommitmentAfter }));
    const traces = witnesses.map(witness => ({ ...witness, kind: 'protocol-record', valid: witness.outcome.valid, reasonCode: witness.outcome.reasonCode }));
    const work = witnesses.find(item => item.protocol === 'pwt1'), mail = witnesses.find(item => item.protocol === 'pwm1');
    const transition = { block_height: height, block_hash: blockHash, model: WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
      state_commitment_model: WORK_AMO_V5_STATE_COMMITMENT_MODEL, event_set_model: WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL,
      complete: true, block_atomic: true, fee_once: true, invalid_zero: true, payload: { transitionChainModel: replay.transitionChainModel,
        transitionChainCommitment: replay.transitionChainCommitment, replayRecords: witnesses, traces } };
    const mailRows = [{ txid: payment.txid, protocol: 'pwm1', status: 'confirmed', valid: mail.outcome.valid, block_height: height, block_index: 1,
      op_return_vout: 1, record_ordinal: 0, raw_payload: raw.find(item => item.protocol === 'pwm1').message,
      payload: { _workAmoV5ReplayBound: true, workAmoV5RawCandidate: true } }];
    payment._payMailEvidence = { rows: mailRows, transition };
    payment._payWorkSettlementEvidence = [{ network: 'livenet', txid: payment.txid, protocol: 'pwt1', kind: 'token-transfer', status: 'confirmed', valid: work.outcome.valid,
      block_height: height, block_hash: blockHash, block_index: 1, op_return_vout: 3, record_ordinal: 0, raw_payload: raw.find(item => item.protocol === 'pwt1').message,
      payload: { confirmed: true, valid: work.outcome.valid, _workAmoV5ReplayBound: true, workAmoV5RawCandidate: true,
        workAmoV5ReplayOutcome: work.outcome, workAmoV5ReplayOutput: work.output, workAmoV5ReplayRawWitness: work.rawWitness }, mailEvents: mailRows, transition }];
    const state = replayPayTransactions([invoice, payment]);
    assert.equal(state.invoices[0].status, openingWorkState === funded ? 'paid' : 'open');
    assert.equal(payStats(state).paidWorkSubatoms, openingWorkState === funded ? '1' : '0');
    if (openingWorkState === funded) {
      assert.equal(replay.workState.holders.find(holder => holder.address === issuer).balanceSubatoms, '1');
      assert.equal(replay.events.filter(event => event.protocol === 'pwt1').length, 1);
    } else assert.equal(state.events[1].validationErrors[0], 'pay-work-transfer-canonically-rejected');
  }
});
