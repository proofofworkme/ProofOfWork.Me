import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as bitcoin from 'bitcoinjs-lib';
import * as jobs from '../src/shared/protocol/jobs.mjs';

const id = n => n.toString(16).padStart(64, '0');
const owner = 'bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e';
const recipient = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const tokenId = jobs.JOBS_WORK_TOKEN_ID;
const now = Date.parse('2026-10-09T12:00:00Z');
const scale = 10_000_000_000_000_000n;
const storage = (() => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), clear: () => values.clear() };
})();
async function loadClient(path, imports = {}, extras = {}) {
  const source = await readFile(path, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw new Error(`Unexpected test dependency: ${name}`);
  }, URLSearchParams, localStorage: storage, ...extras }, { filename: path });
  return exports;
}
const amount = await loadClient('src/workAmount.ts');
const capacity = await loadClient('src/shared/work/canonicalWorkCapacity.ts');
const recovery = await loadClient('src/shared/wallet/actionRecovery.ts');
let response, requests, duringRead;
const adapter = await loadClient('src/features/jobs/jobsWorkCapacity.ts', {
  '../../workAmount': amount,
  '../../shared/work/canonicalWorkCapacity': capacity,
  '../../shared/wallet/actionRecovery': recovery,
  '../../shared/protocol/jobs.mjs': jobs,
  '../../shared/api/proofApiClient': { fetchProofApiJson: async (...args) => {
    requests.push(args); duringRead?.(); return structuredClone(response);
  } },
});

// Extract the actual Computer evaluator and its relevant helper declarations.
// No copy of its canonical arithmetic is used as the differential oracle.
const appSource = await readFile('src/App.tsx', 'utf8');
const appAst = ts.createSourceFile('src/App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = [
  'tokenRequiresCanonicalWorkCapacity', 'isWorkToken', 'workRecordAtoms', 'tokenRecordAmountAtoms',
  'tokenHolderMatchesDefinition', 'tokenTransferSpendabilityKey', 'mergeTokenTransfersForSpendability',
  'tokenListingStateKey', 'tokenListingIsCanonicalCutoverRelic', 'tokenClosedListingConfirmedForSpendability',
  'tokenSaleAuthorizationUsesSpendableSaleTicketAnchor', 'tokenSaleAuthorizationUsesSaleTicketAnchor',
  'tokenListingHasSpendableSaleTicketAnchor', 'tokenListingHasConfirmedSaleTicketSeal',
  'tokenListingHasSaleTicketSeal', 'tokenListingHasPendingSaleTicketSeal', 'tokenListingSealRank',
  'mergeTokenListingRecord', 'mergeTokenListingsById', 'activeTokenListingsExcludingClosed',
  'tokenListingsWithPreservedLocalPending', 'workListingAmountDeferredUntilConfirmation', 'tokenListingIsExpired',
  'validPublicKeyHex', 'validSignatureHex', 'isWorkMarketSaleAuthorizationVersion',
  'isWorkMarketLegacyPriceAuthorizationVersion', 'isWorkAmoV8Authorization', 'tokenSpendabilityForWallet',
];
const constants = [
  'ID_LISTING_TICKET_ANCHOR_TYPE', 'ID_LISTING_ANCHOR_VALUE_SATS', 'ID_LISTING_ANCHOR_VOUT', 'ID_LISTING_ANCHOR_SIGHASH_TYPE',
  'TOKEN_LISTING_ANCHOR_TYPE', 'TOKEN_LISTING_ANCHOR_VALUE_SATS', 'TOKEN_LISTING_ANCHOR_VOUT', 'TOKEN_LISTING_ANCHOR_SIGHASH_TYPE',
  'TOKEN_SALE_AUTH_VERSION', 'TOKEN_SALE_AUTH_VERSION_ATOMS', 'TOKEN_SALE_AUTH_WORK_MARKET_V2_VERSION',
  'TOKEN_SALE_AUTH_WORK_CONFIRMATION_FLOOR_VERSION', 'TOKEN_SALE_AUTH_WORK_AMO_UNIT_VERSION',
  'TOKEN_SALE_AUTH_WORK_AMO_PROOF_UNIT_VERSION', 'TOKEN_SALE_AUTH_WORK_AMO_SUBATOM_VERSION',
  'WORK_TOKEN_AMOUNT_STORAGE_MODEL', 'WORK_TOKEN_PRECISION_MODEL',
];
const declarations = new Map();
for (const statement of appAst.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name) declarations.set(statement.name.text, statement.getText(appAst));
  if (ts.isVariableStatement(statement)) for (const decl of statement.declarationList.declarations) {
    if (ts.isIdentifier(decl.name)) declarations.set(decl.name.text, `const ${decl.getText(appAst)};`);
  }
}
const extracted = [...constants, ...functions].map(name => {
  assert.ok(declarations.has(name), `Existing Computer declaration ${name} must remain available for differential testing`);
  return declarations.get(name);
}).join('\n') + '\nexports.evaluate = tokenSpendabilityForWallet;';
const reference = {};
class FrozenDate extends Date { static now() { return now; } }
vm.runInNewContext(ts.transpileModule(extracted, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports: reference, bitcoin, Date: FrozenDate, WORK_TOKEN_ID: tokenId, WORK_TOKEN_TICKER: 'WORK',
  ...amount, ...capacity,
  normalizeTokenTicker: value => value.trim().toUpperCase(),
  isBondTokenDefinition: () => false,
  // These display/noncanonical computations are overwritten by the extracted
  // canonical receipt branch. Local listings are empty in this fresh-read adapter.
  tokenReservedBalanceFor: () => 0, tokenReservedBalanceAtomsFor: () => 0n,
  exactIntegerNumber: value => Number(value), exactIntegerBigInt: value => BigInt(value),
  tokenListingShouldSurviveRefresh: () => { throw new Error('No local listings expected in fresh wallet differential'); },
});
const token = { tokenId, ticker: 'WORK', network: 'livenet', amountStorageModel: 'work-subatoms-v2' };
function payload({ confirmed = 10n * scale, reservations = [], bound = undefined, ...changes } = {}) {
  const reserved = reservations.reduce((total, row) => total + BigInt(row.amountSubatoms), 0n);
  const value = {
    network: 'livenet', authoritativeWallet: true, walletScoped: true, summaryOnly: true,
    source: 'proof-indexer-wallet-token-overlay+proof-indexer-wallet-address-state',
    indexedThroughBlock: 970500, indexedThroughBlockHash: id(970500), tokenScope: tokenId,
    holders: [{ tokenId, address: owner, balanceSubatoms: confirmed.toString() }],
    listings: [], closedListings: [], transfers: [], sales: [],
    canonicalWorkCapacities: [{ model: 'canonical-work-wallet-capacity-v1', network: 'livenet', address: owner, tokenId,
      indexedThroughBlock: 970500, indexedThroughBlockHash: id(970500), confirmedBalanceSubatoms: confirmed.toString(),
      reservedBalanceSubatoms: reserved.toString(), transferableBalanceSubatoms: (confirmed - reserved).toString(), reservations,
      ...(bound ? { pendingListingNetworkValueQ8: bound.network, pendingListingReserveSubatoms: bound.reserve } : {}),
      tokenStateCommitment: { model: 'canonical-work-amo-payload-sha256-v1', sha256: id(70), payloadBytes: 100 } }],
    ...changes,
  };
  return value;
}
function listing(n, { version = 'pwt-sale-v6', ...changes } = {}) {
  return { network: 'livenet', listingId: id(n), sellerAddress: owner, registryAddress: 'registry', tokenId,
    confirmed: false, amountSubatoms: scale.toString(), saleAuthorization: { version, anchorType: 'sale-ticket-v1', anchorVout: 2,
      anchorValueSats: 546, anchorSigHashType: 131, anchorScriptPubKey: '0014abcd',
      sellerPublicKey: `02${'A'.repeat(64)}`, anchorTxid: id(n), anchorSignature: 'aa'.repeat(36) }, ...changes };
}
function transfer(n, changes = {}) {
  return { network: 'livenet', tokenId, txid: id(n), senderAddress: owner, recipientAddress: recipient,
    amountSubatoms: scale.toString(), confirmed: false, ...changes };
}
function sale(n, changes = {}) {
  return { network: 'livenet', tokenId, txid: id(n), sellerAddress: owner, listingId: id(n + 100),
    amountSubatoms: scale.toString(), confirmed: false, ...changes };
}
function differential(value, expected) {
  const actual = adapter.jobsWorkCapacityFromPayload(value, owner, now);
  const existing = reference.evaluate(owner, token, value);
  for (const [ours, theirs] of [['spendableSubatoms', 'spendableBalanceSubatoms'], ['reservedSubatoms', 'reservedBalanceSubatoms'], ['pendingOutgoingSubatoms', 'pendingOutgoingSubatoms']]) {
    assert.equal(actual[ours].toString(), existing[theirs], `${ours} must agree with current Computer evaluator`);
  }
  assert.equal(actual.pendingWorkListingAmountUnknown, existing.pendingWorkListingAmountUnknown);
  if (expected !== undefined) assert.equal(actual.spendableSubatoms, expected);
  return actual;
}
test('fresh Jobs WORK capacity agrees with Computer for confirmed reservations and last-subatom outgoing pressure', () => {
  differential(payload(), 10n * scale);
  differential(payload({ reservations: [{ listingId: id(1), amountSubatoms: (2n * scale).toString() }],
    transfers: [transfer(2, { amountSubatoms: (scale + 1n).toString() })] }), 7n * scale - 1n);
  differential(payload({ transfers: [transfer(2, { senderAddress: recipient, recipientAddress: owner }), transfer(3, { recipientAddress: owner })] }), 10n * scale);
  differential(payload({ transfers: [transfer(2, { amountSubatoms: (12n * scale).toString() })] }), 0n);
});
test('same-source duplicate debits survive while confirmed duplicate suppresses their pending group', () => {
  differential(payload({ transfers: [transfer(1), transfer(1)] }), 8n * scale);
  differential(payload({ transfers: [transfer(1), transfer(1, { confirmed: true })] }), 10n * scale);
  // Historical Q8 keys fold recipient spelling; native Q16 keys retain it.
  // A legacy/native pair must follow Computer's conservative separate groups.
  differential(payload({ transfers: [transfer(1, { confirmed: true, amountSubatoms: undefined, amountAtoms: '100000000', amount: '1' }), transfer(1)] }), 9n * scale);
  differential(payload({ transfers: [transfer(1, { confirmed: true, amountSubatoms: undefined, amountAtoms: '100000000', amount: '1' }),
    transfer(1, { amountSubatoms: undefined, amountAtoms: '100000000', amount: '1' })] }), 10n * scale);
  differential(payload({ transfers: [transfer(1, { confirmed: true, amountSubatoms: undefined, amount: 'unreadable' })] }), 10n * scale);
  differential(payload({ transfers: [transfer(1, { amountSubatoms: undefined, amountAtoms: '100000000', amount: '1' })] }), 9n * scale);
});
test('canonical WORK retains exact holder and recipient spelling from Computer', () => {
  differential(payload({ transfers: [transfer(1, { recipientAddress: owner.toUpperCase() })] }), 9n * scale);
  differential(payload({ holders: [{ tokenId, address: owner, balanceSubatoms: (10n * scale).toString() },
    { tokenId, address: owner.toUpperCase(), balanceSubatoms: scale.toString() }] }), 10n * scale);
  const uppercaseOnly = payload({ holders: [{ tokenId, address: owner.toUpperCase(), balanceSubatoms: (10n * scale).toString() }] });
  assert.throws(() => reference.evaluate(owner, token, uppercaseOnly));
  assert.throws(() => adapter.jobsWorkCapacityFromPayload(uppercaseOnly, owner, now));
});
test('uncovered pending sales debit once and canonical reservation IDs prevent sale double-counting', () => {
  differential(payload({ sales: [sale(1), sale(1)] }), 9n * scale);
  differential(payload({ sales: [sale(1), sale(1, { confirmed: true })] }), 10n * scale);
  differential(payload({ reservations: [{ listingId: id(101), amountSubatoms: scale.toString() }], sales: [sale(1)] }), 9n * scale);
  differential(payload({ listings: [listing(101)], sales: [sale(1)] }), 9n * scale);
});
test('pending V8 listings use exactly the existing capacity bound and unknown amounts fail closed', () => {
  const network = '10000000000000000000';
  const reserve = 25000n * (21000000n * scale) * 100000000n / BigInt(network);
  const l = listing(1, { version: 'pwt-sale-v8', amountSubatoms: undefined, amount: '99', estimate: { estimateOnly: true } });
  differential(payload({ bound: { network, reserve: reserve.toString() }, listings: [l] }), 10n * scale - reserve);
  differential(payload({ listings: [l] }), 0n);
  differential(payload({ listings: [listing(1, { amountSubatoms: undefined, estimate: { estimateOnly: true } })] }), 0n);
  differential(payload({ listings: [{ ...l, saleAuthorization: { ...l.saleAuthorization, expiresAt: '2026-10-08T00:00:00Z' } }] }), 10n * scale);
});
test('pending closes preserve confirmed reservation and strongest sale-ticket seal', () => {
  const open = { ...listing(1), sealConfirmed: true, confirmed: true };
  const close = { ...listing(1), closedConfirmed: false, saleAuthorization: {} };
  differential(payload({ reservations: [{ listingId: id(1), amountSubatoms: scale.toString() }], listings: [open], closedListings: [close] }), 9n * scale);
  const xonly = listing(2); xonly.saleAuthorization.sellerPublicKey = 'F'.repeat(64);
  differential(payload({ listings: [xonly] }), 9n * scale);
  differential(payload({ listings: [listing(2)], closedListings: [{ ...listing(2), closedConfirmed: true }] }), 10n * scale);
});
test('missing exact pending transfer, sale and listing amounts reject in both evaluators', () => {
  for (const changes of [
    { transfers: [transfer(1, { amountSubatoms: undefined, amount: 'unreadable' })] },
    { transfers: [transfer(1, { amountSubatoms: '1', amountAtoms: '1' })] },
    { sales: [sale(1, { amountSubatoms: undefined, amount: 'unreadable' })] },
    { listings: [listing(1, { amountSubatoms: undefined, amount: 'unreadable' })] },
  ]) {
    const value = payload(changes);
    assert.throws(() => reference.evaluate(owner, token, value));
    assert.throws(() => adapter.jobsWorkCapacityFromPayload(value, owner, now));
  }
  assert.throws(() => adapter.jobsWorkCapacityFromPayload(payload({ transfers: [transfer(1, { amountSubatoms: undefined, amount: 0.1 })] }), owner, now), /exact amount/);
});
test('wallet authority and collection completeness are bound to one exact response', () => {
  for (const change of [{ authoritativeWallet: false }, { walletScoped: false }, { network: 'testnet' }, { source: 'other' },
    { indexedThroughBlockHash: id(4) }, { transfers: undefined }, { sales: undefined }, { listings: undefined },
    { closedListings: undefined }, { holders: undefined }, { collectionHasMore: { transfers: true } },
    { totalCounts: { sales: 1 } }, { checkpointComplete: false }, { listingBookComplete: false },
    { tokenScope: id(4) }, { transfers: [transfer(1, { network: 'testnet' })] },
    { holders: [{ tokenId, address: owner, balanceSubatoms: '100' }] }]) {
    assert.throws(() => adapter.jobsWorkCapacityFromPayload(payload(change), owner, now));
  }
  differential(payload({ totalCounts: { holders: 1, listings: 0, sales: 0, closedListings: 0, transfers: 0 }, collectionHasMore: { mints: true } }), 10n * scale);
});
function receipt(n, changes = {}) {
  return { txid: id(n), address: owner, network: 'livenet', title: 'Accept job', key: `jobs:accept:${id(10)}`,
    createdAt: '2026-10-09T00:00:00Z', status: 'unknown', fields: [
      ['Jobs draft', JSON.stringify({ action: 'accept', rewardAsset: 'WORK' })],
      ['Jobs reviewed reward', JSON.stringify({ asset: 'WORK', token: tokenId, amountSubatoms: '1' })],
    ], ...changes };
}
function receipts(rows) { storage.clear(); storage.setItem(recovery.ACTION_RECEIPTS_KEY, JSON.stringify(rows)); }
test('unknown/pending local WORK accepts hold wallet and exclude only exact current signed txid', () => {
  for (const status of ['unknown', 'pending']) {
    receipts([receipt(1, { status })]);
    assert.throws(() => adapter.assertNoUnresolvedJobsWorkAcceptance(storage, owner), /earlier signed WORK/);
    adapter.assertNoUnresolvedJobsWorkAcceptance(storage, owner, id(1));
    assert.throws(() => adapter.assertNoUnresolvedJobsWorkAcceptance(storage, owner, id(2)), /earlier signed WORK/);
    receipts([receipt(1, { status }), receipt(2, { status })]);
    assert.throws(() => adapter.assertNoUnresolvedJobsWorkAcceptance(storage, owner, id(1)), /earlier signed WORK/);
  }
  receipts([receipt(1, { fields: [['Jobs draft', JSON.stringify({ action: 'accept', rewardAsset: 'WORK' })]] })]);
  assert.throws(() => adapter.assertNoUnresolvedJobsWorkAcceptance(storage, owner), /earlier signed WORK/);
});
test('terminal, other-wallet, other-network and proof accepts remain recoverable without WORK hold', () => {
  for (const change of [{ status: 'confirmed' }, { status: 'dropped' }, { address: recipient }, { network: 'testnet' },
    { fields: [['Jobs draft', JSON.stringify({ action: 'accept' })]] },
    { fields: [['Jobs draft', JSON.stringify({ action: 'accept', rewardAsset: 'proofs' })], ['Jobs reviewed reward', JSON.stringify({ asset: 'proofs', amountSats: '546' })]] }]) {
    receipts([receipt(1, change)]);
    adapter.assertNoUnresolvedJobsWorkAcceptance(storage, owner);
  }
});
test('malformed unresolved recovery evidence fails closed and is preserved', () => {
  for (const fields of [[], [['Jobs draft', 'unreadable']], [['Jobs draft', JSON.stringify({ action: 'accept' })], ['Jobs reviewed reward', 'bad']],
    [['Jobs draft', JSON.stringify({ action: 'accept' })], ['Jobs reviewed reward', JSON.stringify({ asset: 'WORK', token: id(3), amountSubatoms: '1' })]]]) {
    receipts([receipt(1, { fields })]);
    const before = storage.getItem(recovery.ACTION_RECEIPTS_KEY);
    assert.throws(() => adapter.assertNoUnresolvedJobsWorkAcceptance(storage, owner));
    assert.equal(storage.getItem(recovery.ACTION_RECEIPTS_KEY), before);
  }
  storage.setItem(recovery.ACTION_RECEIPTS_KEY, 'bad');
  assert.throws(() => adapter.assertNoUnresolvedJobsWorkAcceptance(storage, owner));
  assert.throws(() => adapter.assertNoUnresolvedJobsWorkAcceptance(storage, owner, 'not-a-txid'), /invalid current/);
});
test('capacity fetch binds one fresh wallet response and rechecks receipts that arrive during it', async () => {
  receipts([]); requests = []; response = payload(); duringRead = undefined;
  assert.equal((await adapter.fetchJobsWorkCapacity(owner)).spendableSubatoms, 10n * scale);
  assert.equal(requests.length, 1);
  const params = new URL(requests[0][0], 'https://local.test').searchParams;
  assert.equal(params.get('wallet'), '1'); assert.equal(params.get('fresh'), '1');
  assert.equal(params.get('asset'), tokenId); assert.equal(params.get('address'), owner); assert.equal(requests[0][1], 'livenet');
  duringRead = () => receipts([receipt(1)]);
  await assert.rejects(adapter.fetchJobsWorkCapacity(owner), /earlier signed WORK/);
  duringRead = undefined;
  assert.equal((await adapter.fetchJobsWorkCapacity(owner, { ownSignedTxid: id(1) })).spendableSubatoms, 10n * scale);
  receipts([]);
});
