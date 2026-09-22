import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { apiBase, canonicalJson, compareCandidate, coreCliExecFileInvocation, coreCliInvocation, decimalQ8, decodeCoreCliPayload, digest, FIXTURE, integer, inventory, listingCommitmentRecord,
  verifyBonds, verifyBookPair, verifyBoost, verifyCounts, verifyDirectory, verifyWallet,
  verifyWalletListingScopes } from '../deploy/audit5/probe-candidate.mjs';
import { registryCountsProjection, tokenDirectoryProjection, tokenListingDisplayProjection } from '../server/read-projections.mjs';

const h = (n) => String(n).padStart(64, '0');
const WORK = 'd4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8';
const cp = { network: 'livenet', indexedThroughBlock: 100, indexedThroughBlockHash: h(1), snapshotId: 'snapshot', indexedAt: '2026-09-05T10:00:00Z' };
const clone = structuredClone;
const tokens = [
  { tokenId: WORK, ticker: 'WORK', confirmedSupplySubatoms: '210000000000000000000000' },
  { tokenId: h(21), ticker: 'POWB', confirmedSupply: '20' },
  { tokenId: h(22), ticker: 'INCB', confirmedSupply: '31' },
];
const directory = { ...cp, tokens, stats: {}, totalCounts: { tokens: 3, listings: 2 }, collectionHasMore: { tokens: false },
  creationSats: 546, provenance: { model: 'synthetic' }, listings: [{ listingId: h(2) }] };
const registry = { ...cp, records: [{ id: 'a', confirmed: true }, { id: 'b', confirmed: false }], stats: { total: 2 },
  listings: [], totalCounts: { listings: 0 }, collectionHasMore: { listings: false } };
const rows = [2, 3].map((n) => ({ listingId: h(n), txid: h(n), confirmed: true, network: 'livenet', tokenId: WORK,
  blockHeight: 99, blockIndex: n, protocolVout: 1, recordOrdinal: 0, sellerAddress: n === 2 ? FIXTURE : 'other', amountSubatoms: '10',
  saleAuthorization: { anchorType: 'sale-ticket-v1', anchorVout: 2, anchorValueSats: 546, anchorScriptPubKey: '0014ff' },
  workAmoV5ReplayOutput: { exact: '9007199254740993' }, workAmoV5RawScriptWitness: ['abcdef'], priceSats: '25000' }));
function book() {
  const membership = digest(rows.map((item) => ({ item: listingCommitmentRecord(item), key: [item.listingId, 99, item.blockIndex, 1, 0] })));
  const source = h(77), core = h(88);
  const first = { ...cp, source: 'proof-indexer-complete-core-reconciled-token-listings', kind: 'listings', totalCount: rows.length,
    start: 0, end: rows.length, cursor: '', hasMore: false, nextCursor: '',
    snapshotId: digest({ coreDigest: core, coreHash: h(1), membershipSha256: membership, protocolMembershipSha256: membership,
      relationalHash: h(1), sourceSha256: source }),
    listingAuthority: { model: 'proof-token-market-core-gettxout-v1', includeMempool: true, checkpoint: { height: 100, blockHash: h(1) },
      checkedOutpointsSha256: core, checkedListingCount: 3, inputListingCount: 3, outputListingCount: 2, spentListingCount: 1, unspentListingCount: 2 },
    listingProjection: { model: 'proof-token-market-cutover-after-core-v1', membershipSha256: membership,
      activeListingCount: 2, coreUnspentListingCount: 2, excludedByProtocolCount: 0 }, items: clone(rows) };
  const shown = rows.map((row) => tokenListingDisplayProjection(row, { fullRecordSha256: digest(listingCommitmentRecord(row)), network: 'livenet' }));
  return { full: { first, rows: clone(rows), pages: 1 }, display: { first: { ...first, items: shown,
    itemProjection: { model: 'proof-token-listing-display-v1', fullMembershipSha256: membership, fullSourceSha256: source } }, rows: shown, pages: 1 } };
}
const decimal = (n) => `${n / 100000000n}.${String(n % 100000000n).padStart(8, '0')}`;
function boosts() {
  const proof = 9007199254740993n;
  const work = 210000000000000000000000n;
  const events = [{ eventId: '1', txid: h(4), kind: 'boost-post', confirmed: true, valid: true, proofSignalSats: decimal(proof), workSignalSubatoms: work.toString() },
    { eventId: '2', txid: h(5), kind: 'boost-reply', confirmed: true, valid: true, proofSignalSats: '546' }];
  const values = [proof + 1n, 54600000000n];
  const feedRows = events.map((event, i) => ({ ...event, boostTxid: event.txid, currentOwnerAddress: FIXTURE, listing: i === 0 ? { txid: h(6) } : null,
    proofSignalQ8: (i ? 54600000000n : proof).toString(), proofSignalSatsExact: event.proofSignalSats,
    workSignalSubatoms: i ? '' : work.toString(), workSignalValueQ8: i ? '0' : '1', workSignalValueSatsExact: i ? '0' : '0.00000001',
    totalSignalQ8: values[i].toString(), totalSignalSatsExact: decimal(values[i]) }));
  const first = { ...cp, complete: true, mode: 'timeline', source: 'proof-indexer-events', totalCount: 2,
    signalStats: { proofSignalQ8: (proof + 54600000000n).toString(), proofSignalSatsExact: decimal(proof + 54600000000n),
      totalSignalQ8: (values[0] + values[1]).toString(), totalSignalSatsExact: decimal(values[0] + values[1]), workSignalSubatoms: work.toString() },
    valuationProvenance: { used: true, ...cp, networkValue: { networkValueQ8: '1' } },
    provenance: { ...cp, model: 'boost-complete-events-v1', eventCount: 2, totalCount: 2, maxEventId: 2, maxUpdatedAt: cp.indexedAt },
    items: feedRows, start: 0, end: 2, nextCursor: '', hasMore: false };
  return { feed: { first, rows: feedRows }, events: { first: { ...cp, source: 'proof-indexer-events', maxEventId: 2,
    maxUpdatedAt: cp.indexedAt, items: events, totalCount: 2, start: 0, end: 2, emitted: 2, cursor: '', nextCursor: '', hasMore: false }, rows: events },
  listings: { ...first, mode: 'listings', totalCount: 1, items: [feedRows[0]] }, floor: { ...cp, liveNetworkValueQ8: '1' } };
}
function bonds() {
  const infinity = { ...cp, stats: { confirmedSupply: '20' }, networkValueQ8: '2300000000', floorQ8: '115000000',
    actualValue: { networkValueQ8: '2300000000', networkValueSats: '23', floorQ8: '115000000', floorSats: '1.15',
      bondMintFlowSats: '20', bondTransferFeeSats: '1', bondMarketplaceMutationFeeSats: '1', bondSaleVolumeSats: '1', attachedWorkLiveValueQ8: '0' } };
  const inception = { ...cp, stats: { confirmedSupply: '31' }, networkValueQ8: '3250000000', floorQ8: '104838709',
    actualValue: { networkValueQ8: '3250000000', networkValueSats: '32.5', floorQ8: '104838709', floorSats: '1.04838709',
      issuanceValuationFixedAtSend: true, issuanceNetworkValueQ8: '3150000000', confirmedIssuanceUnits: '31', directProofIssuanceUnits: '1',
      attachedWorkIssuanceUnits: '30', issuanceDustQ8: '50000000', bondTransferFeeSats: '1', bondMarketplaceMutationFeeSats: '0', bondSaleVolumeSats: '0' } };
  return { infinity, inception };
}

test('exact parsing and numeric loopback port admission', () => {
  assert.equal(integer('9007199254740993'), 9007199254740993n);
  assert.equal(decimalQ8('90071992.54740993'), 9007199254740993n);
  for (const bad of [1.1, 9007199254740992, '-1', '01', '1e2']) assert.throws(() => integer(bad));
  for (const bad of ['1.000000001', '-0', '1e2', 0.1]) assert.throws(() => decimalQ8(bad));
  assert.equal(apiBase('8081'), 'http://127.0.0.1:8081');
  assert.equal(apiBase('18081'), 'http://127.0.0.1:18081');
  for (const bad of ['443', '18081/path', 'https://example.com']) assert.throws(() => apiBase(bad));
});
test('Core invocation is direct, read-only, and restricted to fixed methods', () => {
  assert.deepEqual(coreCliInvocation('getblockchaininfo'), ['/usr/local/bin/bitcoin-cli',
    '-conf=/etc/bitcoin/bitcoin.conf', 'getblockchaininfo']);
  assert.deepEqual(coreCliInvocation('gettxout', ['a'.repeat(64), '0', 'true']), ['/usr/local/bin/bitcoin-cli',
    '-conf=/etc/bitcoin/bitcoin.conf', 'gettxout', 'a'.repeat(64), '0', 'true']);
  const options = { timeout: 15_000, encoding: 'utf8' };
  assert.deepEqual(coreCliExecFileInvocation('getblockchaininfo', [], options), ['/usr/local/bin/bitcoin-cli',
    ['-conf=/etc/bitcoin/bitcoin.conf', 'getblockchaininfo'], options]);
  assert.deepEqual(coreCliExecFileInvocation('gettxout', ['a'.repeat(64), '0', 'true'], options),
    ['/usr/local/bin/bitcoin-cli', ['-conf=/etc/bitcoin/bitcoin.conf', 'gettxout', 'a'.repeat(64), '0', 'true'], options]);
  assert.throws(() => coreCliInvocation('sendtoaddress', ['dummy', '1']), /CORE_REQUEST_BUDGET_OR_METHOD/u);
  assert.throws(() => coreCliInvocation('gettxout', ['a'.repeat(64), 0, 'true']), /CORE_REQUEST_BUDGET_OR_METHOD/u);
});
test('successful gettxout CLI null differs from malformed or empty other RPC output', () => {
  for (const empty of ['', ' \n\t', 'null\n']) assert.equal(decodeCoreCliPayload('gettxout', empty), null);
  for (const method of ['getblockchaininfo', 'getrawmempool', 'getrawtransaction']) {
    for (const bad of ['', ' \n', '{bad']) {
      assert.throws(() => decodeCoreCliPayload(method, bad), /CORE_RPC_RESPONSE_NOT_JSON/u);
    }
  }
  assert.throws(() => decodeCoreCliPayload('gettxout', '{bad'), /CORE_RPC_RESPONSE_NOT_JSON/u);
  for (const scalar of ['0', 'false', '[]', '"null"']) {
    assert.throws(() => decodeCoreCliPayload('gettxout', scalar), /CORE_GETTXOUT_RESPONSE_SHAPE/u);
  }
});
test('Core value decoding preserves zero and exact decimal lexemes without floating-point conversion', () => {
  for (const [value, proofs] of [['0', '0'], ['0.00000546', '546'], ['0.00011409', '11409'],
    ['90071992.54740993', '9007199254740993']]) {
    assert.equal(decodeCoreCliPayload('gettxout', `{"value":${value}}`).exactValueProofs, proofs);
  }
  for (const bad of ['{}', '{"value":1e-8}', '{"value":0.000000001}', '{"value":1,"nested":{"value":2}}']) {
    assert.throws(() => decodeCoreCliPayload('gettxout', bad));
  }
});
test('counts compare real projection with complete source and reject truncation', () => {
  assert.equal(verifyCounts(registry, registryCountsProjection(registry)).pendingCount, 1);
  assert.throws(() => verifyCounts({ ...registry, stats: { total: 3 } }, registryCountsProjection(registry)));
  assert.throws(() => verifyCounts(registry, { ...registryCountsProjection(registry), snapshotId: 'different' }));
});
test('directory verifies full exact definitions, cap, omission flags and authority qualification', () => {
  const shown = tokenDirectoryProjection(directory);
  assert.equal(verifyDirectory(directory, shown).count, 3);
  const changed = clone(shown); changed.tokens[0].confirmedSupplySubatoms = '210000000000000000000001';
  assert.throws(() => verifyDirectory(directory, changed), /DIRECTORY_CHANGED_tokens/u);
  assert.throws(() => verifyDirectory(directory, { ...shown, listingBookComplete: true }));
  assert.throws(() => verifyDirectory(directory, { ...shown, collectionHasMore: { ...shown.collectionHasMore, listings: false } }));
});
test('book recomputes full row and membership hashes and binds historical source hash', () => {
  const { full, display } = book();
  assert.equal(verifyBookPair(full, display).listings, 2);
  for (const mutate of [
    (v) => { v.rows[0].priceSats = '24999'; },
    (v) => { v.rows[0].displayEvidence.fullDetailPath = v.rows[0].displayEvidence.fullDetailPath.replace('&listingId=', '&wrong='); },
    (v) => { v.first.itemProjection.fullMembershipSha256 = h(91); },
    (v) => { v.first.itemProjection.fullSourceSha256 = h(92); },
  ]) { const changed = clone(display); mutate(changed); assert.throws(() => verifyBookPair(full, changed)); }
});
test('commitment reconstructs only declared wire omissions and preserves present values', () => {
  const source = { ...listingCommitmentRecord(rows[0]), buyerAddress: 'public-buyer', saleTxid: undefined, saleAt: undefined };
  const wire = JSON.parse(JSON.stringify(source));
  assert.equal(Object.hasOwn(wire, 'saleTxid'), false);
  assert.equal(digest(listingCommitmentRecord(wire)), digest(source));
  assert.equal(listingCommitmentRecord(wire).buyerAddress, 'public-buyer');
  assert.equal(Object.hasOwn(wire, 'saleTxid'), false, 'wire object remains unchanged');
  assert.notEqual(digest(listingCommitmentRecord({ ...wire, buyerAddress: 'wrong-buyer' })), digest(source));
  assert.notEqual(digest(listingCommitmentRecord({ ...wire, saleTxid: 'wrong' })), digest(source));
  const { full, display } = book();
  display.rows[0].displayEvidence.fullRecordSha256 = h(99);
  assert.throws(() => verifyBookPair(full, display), /FULL_RECORD_DIGEST_CHANGED/u);
});
test('pagination exhausts continuation and rejects same-height event update or projection mutation', async () => {
  const b = boosts();
  const pages = [0, 1].map((i) => ({ ...b.events.first, items: [b.events.rows[i]], start: i, end: i + 1, emitted: i + 1,
    hasMore: i === 0, nextCursor: i === 0 ? 'next' : '', cursor: i === 0 ? '' : 'next' }));
  let reads = 0;
  assert.equal((await inventory({ get: async () => pages[reads++] }, '/api/v1/events', 'events')).rows.length, 2);
  for (const mutate of [(p) => { p.maxUpdatedAt = 'changed'; }, (p) => { p.maxEventId++; }, (p) => { p.snapshotId = 'changed'; },
    (p) => { p.end = 1; }, (p) => { p.items[0].eventId = '1'; }]) {
    const changed = clone(pages); mutate(changed[1]); reads = 0;
    await assert.rejects(inventory({ get: async () => changed[reads++] }, '/api/v1/events', 'events'));
  }
  const { display } = book();
  const bookPages = [0, 1].map((i) => ({ ...clone(display.first), items: [display.rows[i]], start: i, end: i + 1,
    hasMore: i === 0, nextCursor: i === 0 ? 'next' : '', cursor: i === 0 ? '' : 'next' }));
  bookPages[1].itemProjection.fullSourceSha256 = h(90); reads = 0;
  await assert.rejects(inventory({ get: async () => bookPages[reads++] }, '/api/v1/token-history', 'book'), /PAGED_CHECKPOINT_CHANGED/u);
});
test('Boost exact signals and aggregate preserve adjacent above-safe values, source identity and valuation', () => {
  const b = boosts();
  assert.equal(verifyBoost(b.feed, b.events, b.listings, b.floor).activeListings, 1);
  for (const mutate of [(x) => { x.feed.rows[0].totalSignalQ8 = '9007199254740993'; },
    (x) => { x.feed.first.signalStats.totalSignalQ8 = '0'; },
    (x) => { x.feed.first.valuationProvenance.snapshotId = 'wrong'; },
    (x) => { x.feed.first.provenance.maxEventId++; },
    (x) => { x.listings.items = []; x.listings.totalCount = 0; },
    (x) => { x.feed.rows.reverse(); }]) {
    const x = clone(b); mutate(x); assert.throws(() => verifyBoost(x.feed, x.events, x.listings, x.floor));
  }
});
test('bond exact quotient and fixed issuance dust identities reject one-subunit drift', () => {
  const { infinity, inception } = bonds();
  assert.equal(verifyBonds(directory, infinity, inception).INCB.supply, '31');
  const changed = clone(inception); changed.actualValue.issuanceDustQ8 = '50000001';
  assert.throws(() => verifyBonds(directory, infinity, changed), /INCB_FIXED_ISSUANCE_CHANGED/u);
});
test('historical durable bond samples pass exact arithmetic as historical fixtures only', async () => {
  const historic = JSON.parse(await readFile(new URL('../audits/2026-09-05-production-health-data-event-storage-audit-5.evidence.json', import.meta.url)));
  const infinity = historic.checkpointResponses[4].payload, inception = historic.checkpointResponses[5].payload;
  const definitions = { ...infinity, tokens: [{ ticker: 'POWB', confirmedSupply: infinity.stats.confirmedSupply },
    { ticker: 'INCB', confirmedSupply: inception.stats.confirmedSupply }] };
  assert.equal(verifyBonds(definitions, infinity, inception).INCB.supply, '224847713398447926');
});

function fakeIO() {
  const { full, display } = book(), b = boosts(), bond = bonds();
  const utxos = [{ txid: h(2), vout: 2, value: 546, status: { confirmed: true } },
    { txid: h(10), vout: 0, value: 10000, status: { confirmed: true } }];
  const wallet = { ...cp, holders: [{ tokenId: WORK, address: FIXTURE, balanceSubatoms: '100' }], listings: [rows[0]] };
  const calls = [];
  return { calls, utxos, wallet, async get(path) {
    calls.push(path); const url = new URL(path, 'http://127.0.0.1:18081');
    if (url.pathname.startsWith('/health')) return { available: true, ready: true, lagBlocks: 0 };
    if (url.pathname === '/api/v1/registry') return registry;
    if (url.pathname === '/api/v1/registry-summary') return registryCountsProjection(registry);
    if (url.pathname === '/api/v1/token-summary') return url.searchParams.has('projection') ? tokenDirectoryProjection(directory) : directory;
    if (url.pathname === '/api/v1/token-history') {
      if (url.searchParams.has('listingId')) return { totalCount: 1, items: rows.filter((r) => r.listingId === url.searchParams.get('listingId')) };
      return url.searchParams.get('projection') === 'display-v1' ? display.first : full.first;
    }
    if (url.pathname.endsWith('/utxo')) return utxos;
    if (url.pathname === '/api/v1/token') return wallet;
    if (url.pathname === '/api/v1/events') return b.events.first;
    if (url.pathname === '/api/v1/boost') return url.searchParams.has('listings') ? b.listings : b.feed.first;
    if (url.pathname === '/api/v1/work-floor') return b.floor;
    if (url.pathname === '/api/v1/infinity-summary') return bond.infinity;
    if (url.pathname === '/api/v1/inception-summary') return bond.inception;
    throw Error('UNEXPECTED_FAKE_GET');
  }, async core(method, args) {
    if (method === 'getblockchaininfo') return { blocks: 100, bestblockhash: h(1) };
    if (method === 'getrawmempool') return { mempool_sequence: 50 };
    if (method === 'gettxout') return { bestblock: h(1), confirmations: 1, exactValueProofs: args[0] === h(10) ? '10000' : '546',
      scriptPubKey: { address: FIXTURE, hex: '0014ff' } };
    if (method === 'getrawtransaction') return { txid: args[0], blockhash: h(1), confirmations: 1, vout: [{ scriptPubKey: { hex: '6a08707762313a' } }] };
    throw Error('UNEXPECTED_FAKE_CORE');
  } };
}
test('complete orchestration qualifies current smaller inventories and public wallet reservations', async () => {
  const io = fakeIO();
  const result = await compareCandidate(io);
  assert.equal(result.book.independentCoreAnchors, 2);
  assert.equal(result.directory.count, 3);
  assert.equal(result.wallet.reservedProofs, '546');
  assert.equal(result.wallet.availableProofs, '10000');
  assert.equal(result.wallet.remainingWORKSubatoms, '90');
  assert.equal(result.boost.rawCarrierSamples, 2);
  assert.equal(result.core.mempoolSequenceStable, true);
});
function pendingWalletFixture() {
  const io = fakeIO();
  io.wallet.listings = clone(io.wallet.listings);
  const listing = { listingId: h(12), txid: h(12), tokenId: WORK, sellerAddress: FIXTURE,
    network: 'livenet', confirmed: false, status: 'pending', estimateOnly: true,
    saleAuthorization: { version: 'pwt-sale-v8', anchorType: 'sale-ticket-v1', anchorVout: 2,
      anchorValueSats: 546, anchorScriptPubKey: '0014ff', network: 'livenet', tokenId: WORK, sellerAddress: FIXTURE } };
  io.wallet.listings.push(listing);
  io.utxos.push({ txid: listing.txid, vout: 2, value: 546, status: { confirmed: false } });
  const core = io.core;
  const ticket = { bestblock: h(1), confirmations: 0, exactValueProofs: '546',
    scriptPubKey: { address: FIXTURE, hex: '0014ff' } };
  io.core = async (method, args) => {
    if (method === 'gettxout' && args[0] === listing.txid) {
      assert.deepEqual(args, [listing.txid, '2', 'true']);
      return ticket;
    }
    // A pending listing may arrive after the initial mempool sample. Its later
    // gettxout witness is independent evidence, not an atomic membership claim.
    if (method === 'getrawmempool') return { mempool_sequence: 50, txids: [] };
    return core(method, args);
  };
  return { io, listing, ticket };
}
test('wallet separates confirmed reservations from later Core-witnessed pending estimates', async () => {
  const { io } = pendingWalletFixture();
  const result = await compareCandidate(io);
  assert.equal(result.wallet.confirmedListingCount, 1);
  assert.equal(result.wallet.pendingListingCount, 1);
  assert.equal(result.wallet.pendingTicketWitnesses[0].confirmations, 0);
  assert.equal(result.wallet.pendingTicketWitnesses[0].valueProofs, '546');
  assert.equal(result.wallet.pendingProofs, '546');
  assert.equal(result.wallet.reservedProofs, '546');
  assert.equal(result.wallet.availableProofs, '10000');
  assert.equal(result.wallet.reservedWORKSubatoms, '10');
  assert.equal(result.wallet.remainingWORKSubatoms, '90');
  assert.match(result.wallet.pendingQualification, /no atomic mempool snapshot or confirmed WORK amount/u);
});
test('pending rows cannot hide missing or extra confirmed wallet listings', async () => {
  for (const mutate of [
    (io) => { io.wallet.listings.shift(); },
    (io) => { io.wallet.listings.unshift({ ...clone(rows[0]), listingId: h(13), txid: h(13) }); },
    (io) => { io.wallet.listings.push(clone(io.wallet.listings[1])); },
  ]) {
    const { io } = pendingWalletFixture(); mutate(io);
    await assert.rejects(verifyWalletListingScopes(io, io.wallet.listings, [rows[0]], { bestblockhash: h(1) }),
      /WALLET_LISTING_MEMBERSHIP_CHANGED|DUPLICATE_OR_MISSING_IDENTITY/u);
  }
});
test('wallet rejects ambiguous labels, confirmed amounts on estimates and wrong pending scope', async () => {
  for (const mutate of [
    (row) => { delete row.confirmed; }, (row) => { row.confirmed = true; },
    (row) => { row.status = 'listed'; }, (row) => { row.estimateOnly = false; },
    (row) => { row.amountSubatoms = '0'; }, (row) => { row.amountAtoms = '1'; },
    (row) => { row.amount = '0.1'; }, (row) => { row.blockHeight = 100; },
    (row) => { row.txid = h(13); }, (row) => { row.tokenId = h(21); },
    (row) => { row.saleAuthorization.version = 'pwt-sale-v5'; },
    (row) => { row.saleAuthorization.anchorVout = -1; },
    (row) => { row.saleAuthorization.anchorValueSats = 547; },
    (row) => { row.saleAuthorization.sellerAddress = 'other'; },
  ]) {
    const { io, listing } = pendingWalletFixture(); mutate(listing);
    await assert.rejects(verifyWalletListingScopes(io, io.wallet.listings, [rows[0]], { bestblockhash: h(1) }));
  }
});
test('pending ticket proof rejects spent, confirmed, wrong-checkpoint or altered outputs', async () => {
  for (const replacement of [null, { confirmations: 1 }, { bestblock: h(99) },
    { exactValueProofs: '547' }, { scriptPubKey: { address: FIXTURE, hex: '0014ee' } },
    { scriptPubKey: { address: 'other', hex: '0014ff' } }]) {
    const { io, ticket } = pendingWalletFixture();
    io.core = async (method, args) => {
      assert.equal(method, 'gettxout'); assert.deepEqual(args, [h(12), '2', 'true']);
      return replacement === null ? null : { ...ticket, ...replacement };
    };
    await assert.rejects(verifyWalletListingScopes(io, io.wallet.listings, [rows[0]], { bestblockhash: h(1) }),
      /WALLET_PENDING_CORE_TICKET_MISMATCH/u);
  }
});
test('wallet negative reservation, spent outputs and moving Core tip fail explicitly', async () => {
  const io = fakeIO(), { full } = book();
  io.wallet.holders[0].balanceSubatoms = '9';
  await assert.rejects(verifyWallet(io, registry, full, { blocks: 100, bestblockhash: h(1) }), /WALLET_FIXTURE_PRECONDITION_UNMET/u);
  const spent = fakeIO(), core = spent.core;
  spent.core = async (method, args) => method === 'gettxout' ? null : core(method, args);
  await assert.rejects(compareCandidate(spent), /CORE_ANCHOR_MISMATCH/u);
  const moving = fakeIO(), raw = moving.core; let count = 0;
  moving.core = async (method, args) => method === 'getblockchaininfo' && ++count > 1 ? { blocks: 101, bestblockhash: h(9) } : raw(method, args);
  await assert.rejects(compareCandidate(moving), /CORE_TIP_CHANGED/u);
});
test('saved empty gettxout stdout reaches explicit wallet spent-output refusal', async () => {
  const io = fakeIO();
  io.core = async (method) => {
    assert.equal(method, 'gettxout');
    return decodeCoreCliPayload(method, '');
  };
  await assert.rejects(verifyWallet(io, registry, book().full, { blocks: 100, bestblockhash: h(1) }),
    /WALLET_CORE_UTXO_MISMATCH/u);
});
test('unrelated mempool change is recorded without an atomic snapshot claim', async () => {
  const io = fakeIO(), raw = io.core; let sequence = 0;
  io.core = async (method, args) => method === 'getrawmempool' ? { mempool_sequence: ++sequence } : raw(method, args);
  const result = await compareCandidate(io);
  assert.equal(result.core.mempoolSequenceStable, false);
  assert.match(result.qualification, /no exhaustive historical replay, atomic mempool snapshot/u);
});
