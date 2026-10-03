// Pure fixtures: no production reads, native actions, socket binds or DB writes.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ASSETS, WORK, ADDRESS, decimalQ16, helpers, validateSources, verifyPositiveWork }
  from './pow-audit30-positive-work-scoped-leaf-v2.mjs';
const HASH = 'a'.repeat(64); const HASH2 = 'b'.repeat(64);
const tip = { height: 969752, hash: HASH };
const model = { decimals: 16, unitScale: '10000000000000000', amountStorageModel: 'work-subatoms-v2',
  precisionModel: 'canonical-work-subatoms-v2' };
function wallet() {
  return { ...model, network: 'livenet', authoritativeWallet: true, checkpointComplete: true,
    indexedThroughBlock: tip.height, indexedThroughBlockHash: tip.hash, snapshotId: 'c'.repeat(24),
    tokens: [{ ...model, tokenId: WORK }],
    holders: [{ address: ADDRESS, tokenId: WORK, balanceSubatoms: '10000000000000001',
      balance: '1.0000000000000001', pendingDeltaSubatoms: '-1', pendingDelta: '-0.0000000000000001' }],
    canonicalWorkCapacities: [{ model: 'canonical-work-wallet-capacity-v1', network: 'livenet',
      address: ADDRESS, tokenId: WORK, indexedThroughBlock: tip.height, indexedThroughBlockHash: tip.hash,
      confirmedBalanceSubatoms: '10000000000000001', transferableBalanceSubatoms: '10000000000000000',
      reservedBalanceSubatoms: '1', reservations: [{ listingId: '1'.repeat(64), amountSubatoms: '1' }] }] };
}
const check = (payload) => verifyPositiveWork(200, payload, tip, tip);
test('exact candidate sources and all ten AST extraction bindings remain unchanged', async () => {
  const binding = await validateSources('/home/sixer/ProofOfWork.Me');
  assert.equal(binding.helpers.length, 10);
  assert.equal(binding.helpers.find((v) => v.name === 'fetchCompleteTokenListings').sha256,
    'ecc31902e89f2b14d8f5e8719b7f1b03ddc88a90ab44a4c6196c0e508ded370f');
  assert.equal(binding.helpers.find((v) => v.name === 'listingDisplayProjectionFingerprint').sha256,
    '94f6f7cdc87a570fbf2ed6dbcfb5745c4c832bee229210643e1c1fa92c69ab47');
});
test('positive exact Q16 wallet passes all sixteen predicates and both verification flags', () => {
  const v = check(wallet()); assert.equal(v.predicateCount, 16);
  assert.equal(Object.values(v.predicates).every(Boolean), true);
  assert.equal(v.ready && v.balanceVerified && v.capacityVerified && v.positiveConfirmed, true);
  assert.equal(v.confirmedBalanceSubatoms, '10000000000000001');
});
test('qualified existing 503 remains unresolved and cannot pass the positive collector', () => {
  const payload = { ok: false, error: `Fresh wallet credit state is temporarily unavailable for ${WORK}.`,
    details: { code: 'CANONICAL_WALLET_INDEX_UNAVAILABLE', requiredSource: 'proof-indexer-wallet-token-overlay' } };
  assert.equal(helpers().verifyFencedWalletRead(503, payload, ADDRESS, tip, tip).ready, false);
  assert.throws(() => verifyPositiveWork(503, payload, tip, tip), /http-200-required/u);
});
test('moving Core and stale API checkpoint are refused', () => {
  assert.throws(() => verifyPositiveWork(200, wallet(), tip, { height: tip.height + 1, hash: HASH2 }), /stable-core-fence/u);
  const v = wallet(); v.indexedThroughBlock--; assert.throws(() => check(v), /exact-current-checkpoint/u);
});
test('authority and checkpoint completeness must be literal true', () => {
  for (const key of ['authoritativeWallet', 'checkpointComplete']) {
    const v = wallet(); v[key] = 1; assert.throws(() => check(v));
  }
});
test('Q16 token and envelope cannot silently regress to decimal Q8 or numeric scale', () => {
  const a = wallet(); a.decimals = 8; assert.throws(() => check(a), /envelope-q16-model/u);
  const b = wallet(); b.tokens[0].unitScale = 1e16; assert.throws(() => check(b), /one-canonical-q16-token/u);
});
test('duplicate scoped holders and capacities are refused', () => {
  const a = wallet(); a.holders.push({ ...a.holders[0] }); assert.throws(() => check(a), /one-exact-holder/u);
  const b = wallet(); b.canonicalWorkCapacities.push({ ...b.canonicalWorkCapacities[0] });
  assert.throws(() => check(b), /one-exact-capacity/u);
});
test('capacity model and network remain mandatory', () => {
  const a = wallet(); a.canonicalWorkCapacities[0].network = 'testnet'; assert.throws(() => check(a), /capacity-scope/u);
});
test('zero confirmed balance cannot satisfy positive work', () => {
  const a = wallet(); a.canonicalWorkCapacities[0].confirmedBalanceSubatoms = '0';
  a.holders[0].balanceSubatoms = '0'; assert.throws(() => check(a), /positive-confirmed-exact-holder/u);
});
test('use exact subatoms and refuse numeric or inexact aliases', () => {
  const a = wallet(); a.canonicalWorkCapacities[0].confirmedBalanceSubatoms = 10000000000000000;
  assert.throws(() => check(a), /NONCANONICAL_Q16_INTEGER/u);
  const b = wallet(); b.canonicalWorkCapacities[0].confirmedBalance = '1';
  assert.equal(check(b).confirmedBalanceSubatoms, '10000000000000001');
});
test('conservation and decimal precision are independently checked', () => {
  const a = wallet(); a.canonicalWorkCapacities[0].transferableBalanceSubatoms = '9999999999999999';
  assert.throws(() => check(a), /exact-q16-conservation/u);
  const b = wallet(); b.holders[0].balance = '1'; assert.throws(() => check(b), /holder-decimals/u);
  assert.equal(decimalQ16('0'), 0n); assert.equal(decimalQ16('1.5'), 15000000000000000n);
  assert.throws(() => decimalQ16('0.00000000000000001'), /NONCANONICAL_Q16_DECIMAL/u);
  assert.throws(() => decimalQ16('-0'), /NEGATIVE_ZERO/u);
});
test('duplicate, unsorted, incorrect or zero reservation amounts are refused', () => {
  for (const mutate of [v => v.reservations.push({ ...v.reservations[0] }),
    v => v.reservations[0].amountSubatoms = '2', v => v.reservations[0].amountSubatoms = '0']) {
    const a = wallet(); mutate(a.canonicalWorkCapacities[0]); assert.throws(() => check(a), /reservation-conservation/u);
  }
});
function page(items = [], count = items.length, extra = {}) {
  return { kind: 'listings', network: 'livenet', source: 'proof-indexer-complete-core-reconciled-token-listings',
    indexedAt: '2026-10-03T19:00:00Z', indexedThroughBlock: tip.height, indexedThroughBlockHash: tip.hash,
    snapshotId: HASH2, totalCount: count, cursor: '', start: 0, end: items.length, limit: 200, page: 0,
    pageCount: Math.max(1, Math.ceil(count / 200)), hasMore: false, nextCursor: '', items,
    listingAuthority: { model: 'proof-token-market-core-gettxout-v1', includeMempool: true,
      checkpoint: { height: tip.height, blockHash: tip.hash }, checkedOutpointsSha256: HASH,
      checkedListingCount: count, inputListingCount: count, outputListingCount: count,
      spentListingCount: 0, unspentListingCount: count },
    listingProjection: { model: 'proof-token-market-cutover-after-core-v1', membershipSha256: HASH,
      activeListingCount: count, coreUnspentListingCount: count, excludedByProtocolCount: 0 },
    itemProjection: { model: 'proof-token-listing-display-v2', fullMembershipSha256: HASH, fullSourceSha256: HASH2 }, ...extra };
}
function listing(index, asset = ASSETS.POWB) {
  const id = index.toString(16).padStart(64, '0');
  return { listingId: id, tokenId: asset, network: 'livenet', confirmed: true,
    displayEvidence: { model: 'proof-token-listing-display-v2', fullRecordSha256: HASH,
      omittedFields: ['payload'], fullDetailPath: `/api/v1/token-history?kind=listings&projection=full&q=${id}&listingId=${id}` } };
}
async function scoped(pages, asset = ASSETS.POWB) {
  let calls = 0; const h = helpers(async () => { assert.ok(calls < pages.length); return pages[calls++]; });
  const result = await h.fetchCompleteTokenListings('livenet', { fresh: true, tokenScope: asset });
  return { result, calls };
}
test('complete scoped POWB and empty INCB use exact retained App helper semantics', async () => {
  assert.equal((await scoped([page([listing(1)])])).result.totalCount, 1);
  assert.equal((await scoped([page()], ASSETS.INCB)).result.totalCount, 0);
});
test('two pages bind complete unique membership and stable checkpoint/authority/projection', async () => {
  const items = Array.from({ length: 201 }, (_, index) => listing(index + 1));
  const first = page(items.slice(0, 200), 201, { hasMore: true, nextCursor: 'next' });
  const second = page(items.slice(200), 201, { cursor: 'next', start: 200, end: 201, page: 1 });
  const { result, calls } = await scoped([first, second]); assert.equal(calls, 2); assert.equal(result.items.length, 201);
  const drift = structuredClone(second); drift.snapshotId = 'd'.repeat(64);
  await assert.rejects(scoped([first, drift]), /changed checkpoints/u);
});
test('duplicate listings, wrong asset, unavailable outpoint authority and wrong totals fail closed', async () => {
  await assert.rejects(scoped([page([listing(1), listing(1)])]), /repeated listing/u);
  await assert.rejects(scoped([page([listing(1, ASSETS.INCB)])]), /lacks exact checkpoint/u);
  const a = page([listing(1)]); a.listingAuthority.includeMempool = false;
  await assert.rejects(scoped([a]), /lacks exact checkpoint/u);
  await assert.rejects(scoped([page([listing(1)], 2)]), /lacks exact checkpoint/u);
});
test('display membership evidence and exact detail reference remain mandatory', async () => {
  const a = listing(1); a.displayEvidence.fullDetailPath = '/api/v1/token-history?kind=listings&projection=full&q=bad&listingId=bad';
  await assert.rejects(scoped([page([a])]), /does not match its ID/u);
  const b = page([listing(1)]); b.itemProjection.fullSourceSha256 = '';
  await assert.rejects(scoped([b]), /lacks full evidence digests/u);
});
