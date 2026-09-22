// Bounded, GET-only candidate HTTP comparisons plus fixed read-only Core RPCs.
// No credentials, DB writes, signing, repair, replay or production configuration.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = 'http://127.0.0.1:18081';
export const FIXTURE = '19JE7LS6TtQ4uSxu6ivJVZRiJyXXe8qEG3';
const HASH = /^[0-9a-f]{64}$/u;
const OMIT = ['workAmoV5ReplayOutput', 'workAmoV5ReplayRawWitness', 'workAmoV5RawScriptWitness'];
const WORK_ID = 'd4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8';
const WORK_CAP = 210000000000000000000000n;
const MAX_PAGES = 32;
const MAX_ROWS = 2000;
const MAX_BODY = 32 * 1024 * 1024;
const MAX_BYTES = 192 * 1024 * 1024;
const MAX_HTTP = 128;
const MAX_CORE = 2300;
const MAX_MS = 600_000;
const CORE_METHODS = ['getblockchaininfo', 'getrawmempool', 'gettxout', 'getrawtransaction'];
const CORE_CLI = '/usr/local/bin/bitcoin-cli';
const spawn = promisify(execFile);

export function requireFact(ok, code) {
  if (!ok) throw new Error(code);
}
export function canonicalJson(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
// The lifecycle reader creates these optional properties unconditionally.
// Its checkpoint serializer commits undefined as null; JSON.stringify omits
// undefined object properties on the wire. Reconstruct only those declared
// properties for digest verification, preserving wire rows and present values.
// Source: proof-index-reader.mjs lifecycle return; proof-api.mjs
// checkpointCursorCanonicalJson. This does not change either server contract.
export function listingCommitmentRecord(row) {
  const optional = ['buyerAddress', 'closedAt', 'saleTxid', 'saleAt', 'saleBlockHash', 'saleBlockHeight',
    'saleBlockIndex', 'saleProtocolVout', 'saleRecordOrdinal', 'saleTransactionBlockHeight'];
  return { ...Object.fromEntries(optional.map((key) => [key, null])), ...row };
}
export const digest = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const equal = (a, b, code) => requireFact(digest(a) === digest(b), code);
export function integer(value) {
  requireFact(typeof value === 'string' && /^(?:0|[1-9]\d*)$/u.test(value), 'NONCANONICAL_INTEGER');
  return BigInt(value);
}
export function decimalQ8(value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  requireFact(typeof text === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/u.test(text), 'NONCANONICAL_Q8_DECIMAL');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));
}
export function decodeCoreCliPayload(method, stdout) {
  // bitcoin-cli prints no stdout for gettxout's JSON null result. The caller
  // invokes this only after a successful CLI exit; a spent output stays null
  // so the existing semantic authority checks still refuse it.
  if (method === 'gettxout' && stdout.trim() === '') return null;
  let payload;
  try { payload = JSON.parse(stdout); }
  catch { throw new Error('CORE_RPC_RESPONSE_NOT_JSON'); }
  if (method === 'gettxout' && payload !== null) {
    requireFact(typeof payload === 'object' && !Array.isArray(payload), 'CORE_GETTXOUT_RESPONSE_SHAPE');
    const matches = [...stdout.matchAll(/"value"\s*:\s*(\d+(?:\.\d+)?)(?=\s*[,}])/gu)];
    requireFact(matches.length === 1, 'CORE_EXACT_VALUE_LEXEME_UNAVAILABLE');
    payload.exactValueProofs = decimalQ8(matches[0][1]).toString();
  }
  return payload;
}
function checkpoint(payload) {
  requireFact(Number.isSafeInteger(payload?.indexedThroughBlock) && payload.indexedThroughBlock > 0 &&
    HASH.test(payload.indexedThroughBlockHash ?? '') && typeof payload.snapshotId === 'string' && payload.snapshotId.length > 0,
  'MISSING_EXACT_CHECKPOINT');
  return [payload.indexedThroughBlock, payload.indexedThroughBlockHash, payload.snapshotId];
}
function sameCheckpoint(a, b) { equal(checkpoint(a), checkpoint(b), 'CHECKPOINT_CHANGED'); }
const units = (value) => integer(typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value);
export function apiBase(port) {
  requireFact(['18081', '8081'].includes(String(port)), 'NONPRIVATE_API_PORT');
  return `http://127.0.0.1:${port}`;
}
export function coreCliInvocation(method, args = []) {
  requireFact(CORE_METHODS.includes(method) && Array.isArray(args) && args.every((value) => typeof value === 'string'),
    'CORE_REQUEST_BUDGET_OR_METHOD');
  return [CORE_CLI, '-conf=/etc/bitcoin/bitcoin.conf', method, ...args];
}
export function coreCliExecFileInvocation(method, args = [], options = {}) {
  const [file, ...argv] = coreCliInvocation(method, args);
  return [file, argv, options];
}
function unique(rows, key) {
  const keys = rows.map((row) => String(row[key] ?? ''));
  requireFact(keys.every(Boolean) && new Set(keys).size === keys.length, 'DUPLICATE_OR_MISSING_IDENTITY');
  return keys;
}

export function verifyCounts(full, projected) {
  sameCheckpoint(full, projected);
  requireFact(Array.isArray(full.records) && full.stats?.total === full.records.length &&
    full.collectionHasMore?.records !== true && full.records.every((row) => typeof row.confirmed === 'boolean'), 'INCOMPLETE_REGISTRY');
  const confirmed = full.records.filter((row) => row.confirmed).length;
  equal(projected.registryCounts, { model: 'proof-registry-counts-v1', complete: true,
    confirmedCount: confirmed, pendingCount: full.records.length - confirmed, totalCount: full.records.length }, 'COUNT_PROJECTION_CHANGED');
  requireFact(!('records' in projected) && !('listings' in projected), 'COUNTS_INCLUDED_FULL_ROWS');
  return projected.registryCounts;
}

export function verifyDirectory(full, projected) {
  sameCheckpoint(full, projected);
  requireFact(Array.isArray(full.tokens) && full.totalCounts?.tokens === full.tokens.length &&
    full.collectionHasMore?.tokens !== true, 'INCOMPLETE_FULL_DIRECTORY');
  unique(full.tokens, 'tokenId');
  equal(projected.directory, { model: 'proof-token-directory-v1', complete: true, totalCount: full.tokens.length }, 'DIRECTORY_QUALIFICATION');
  for (const key of ['tokens', 'stats', 'totalCounts', 'creationSats', 'provenance']) {
    equal(full[key] ?? null, projected[key] ?? null, `DIRECTORY_CHANGED_${key}`);
  }
  requireFact(projected.directoryOnly === true && projected.summaryOnly === true && projected.listingBookComplete === false,
    'DIRECTORY_MISSTATED_AUTHORITY');
  for (const key of ['activity', 'closedListings', 'holders', 'invalidEvents', 'listings', 'mints', 'sales', 'transfers']) {
    requireFact(Array.isArray(projected[key]) && projected[key].length === 0, 'DIRECTORY_HISTORY_NOT_OMITTED');
    const omitted = full.collectionHasMore?.[key] === true || (full[key]?.length ?? 0) > 0 || (full.totalCounts?.[key] ?? 0) > 0;
    requireFact(projected.collectionHasMore?.[key] === omitted, 'DIRECTORY_OMISSION_FLAG');
  }
  const work = full.tokens.find((row) => row.tokenId === WORK_ID);
  requireFact(work && integer(work.confirmedSupplySubatoms) === WORK_CAP, 'WORK_CAP_NOT_CONSERVED');
  return { count: full.tokens.length, definitionSha256: digest(full.tokens), workSupplySubatoms: WORK_CAP.toString() };
}

function bookFence(page) {
  const authority = page.listingAuthority;
  const projection = page.listingProjection;
  requireFact(authority?.model === 'proof-token-market-core-gettxout-v1' && authority.includeMempool === true &&
    authority.checkpoint?.height === page.indexedThroughBlock && authority.checkpoint?.blockHash === page.indexedThroughBlockHash &&
    HASH.test(authority.checkedOutpointsSha256 ?? '') &&
    [authority.checkedListingCount, authority.inputListingCount, authority.outputListingCount, authority.spentListingCount,
      authority.unspentListingCount].every((value) => Number.isSafeInteger(value) && value >= 0) &&
    authority.inputListingCount === authority.checkedListingCount && authority.outputListingCount === authority.unspentListingCount &&
    authority.spentListingCount + authority.unspentListingCount === authority.checkedListingCount, 'BOOK_CORE_AUTHORITY');
  requireFact(projection?.model === 'proof-token-market-cutover-after-core-v1' && HASH.test(projection.membershipSha256 ?? '') &&
    [projection.activeListingCount, projection.excludedByProtocolCount, projection.coreUnspentListingCount]
      .every((value) => Number.isSafeInteger(value) && value >= 0) &&
    projection.activeListingCount === page.totalCount && projection.coreUnspentListingCount === authority.unspentListingCount &&
    projection.activeListingCount + projection.excludedByProtocolCount === projection.coreUnspentListingCount,
  'BOOK_PROTOCOL_AUTHORITY');
  return [checkpoint(page), page.indexedAt, page.totalCount, authority.checkedOutpointsSha256,
    authority.checkedListingCount, authority.spentListingCount, authority.unspentListingCount, projection];
}

export async function inventory(io, path, kind, extra = {}) {
  const rows = [];
  const cursors = new Set();
  let cursor = '';
  let first;
  let fence;
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const params = new URLSearchParams({ network: 'livenet', limit: kind === 'boost' ? '100' : '200', ...extra });
    if (cursor) params.set('cursor', cursor);
    const page = await io.get(`${path}?${params}`);
    const currentFence = kind === 'book' ? [bookFence(page), page.itemProjection ?? null] :
      [checkpoint(page), page.indexedAt, page.totalCount, page.maxEventId ?? null, page.maxUpdatedAt ?? null,
        page.provenance ?? null, page.signalStats ?? null, page.valuationProvenance ?? null];
    requireFact(Array.isArray(page.items) && page.network === 'livenet' &&
      Number.isSafeInteger(page.totalCount) && page.totalCount >= 0 && page.totalCount <= MAX_ROWS &&
      page.start === rows.length && page.end === rows.length + page.items.length && page.end <= page.totalCount &&
      page.hasMore === (page.end < page.totalCount) && Boolean(page.nextCursor) === page.hasMore &&
      typeof page.nextCursor === 'string',
    'INCOMPLETE_OR_NONADVANCING_PAGE');
    if (kind === 'book') requireFact(page.source === 'proof-indexer-complete-core-reconciled-token-listings' &&
      page.kind === 'listings' && String(page.cursor ?? '') === cursor, 'WRONG_BOOK_SOURCE');
    if (kind === 'events') requireFact(page.source === 'proof-indexer-events' && String(page.cursor ?? '') === cursor &&
      page.emitted === page.end && Number.isSafeInteger(page.maxEventId) && page.maxEventId >= 0 &&
      typeof page.maxUpdatedAt === 'string', 'WRONG_EVENT_SOURCE');
    if (kind === 'boost') requireFact(page.complete === true && page.mode === 'timeline', 'INCOMPLETE_BOOST');
    if (!first) { first = page; fence = currentFence; }
    else equal(fence, currentFence, 'PAGED_CHECKPOINT_CHANGED');
    rows.push(...page.items);
    if (!page.hasMore) {
      requireFact(rows.length === page.totalCount, 'TRUNCATED_INVENTORY');
      unique(rows, kind === 'book' ? 'listingId' : 'eventId');
      return { first, rows, pages: pageIndex + 1 };
    }
    requireFact(page.items.length > 0 && !cursors.has(page.nextCursor), 'REPEATED_CURSOR');
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error('PAGE_BUDGET_EXCEEDED');
}

export function verifyBookPair(full, display) {
  equal(bookFence(full.first), bookFence(display.first), 'FULL_DISPLAY_BOOK_CHECKPOINT_CHANGED');
  equal(unique(full.rows, 'listingId'), unique(display.rows, 'listingId'), 'FULL_DISPLAY_MEMBERSHIP_CHANGED');
  const projection = display.first.itemProjection;
  requireFact(projection?.model === 'proof-token-listing-display-v1' && HASH.test(projection.fullMembershipSha256 ?? '') &&
    HASH.test(projection.fullSourceSha256 ?? ''), 'MISSING_FULL_BOOK_DIGESTS');
  const membership = digest(full.rows.map((item) => ({ item: listingCommitmentRecord(item), key: [String(item.listingId ?? item.txid ?? '').trim().toLowerCase(),
    Number(item.blockHeight ?? 0), Number(item.blockIndex ?? 0), Number(item.protocolVout ?? 0), Number(item.recordOrdinal ?? 0)] })));
  requireFact(projection.fullMembershipSha256 === membership && full.first.listingProjection.membershipSha256 === membership,
    'FULL_MEMBERSHIP_DIGEST_CHANGED');
  // The source hash includes historical/cutover-excluded rows absent from this
  // active book. Verify its binding to the full route's snapshot, not its content.
  requireFact(full.first.snapshotId === digest({ coreDigest: full.first.listingAuthority.checkedOutpointsSha256,
    coreHash: full.first.indexedThroughBlockHash, membershipSha256: membership,
    protocolMembershipSha256: membership, relationalHash: full.first.indexedThroughBlockHash,
    sourceSha256: projection.fullSourceSha256 }), 'FULL_SOURCE_SNAPSHOT_BINDING_CHANGED');
  let omittedBytes = 0;
  for (let index = 0; index < full.rows.length; index++) {
    const row = full.rows[index];
    const shown = display.rows[index];
    const evidence = shown.displayEvidence;
    requireFact(row.confirmed === true && row.network === 'livenet' && HASH.test(row.listingId), 'UNCONFIRMED_BOOK_ROW');
    requireFact(evidence?.model === projection.model && evidence.fullRecordSha256 === digest(listingCommitmentRecord(row)), 'FULL_RECORD_DIGEST_CHANGED');
    equal(evidence.omittedFields, OMIT.filter((key) => Object.hasOwn(row, key)), 'UNEXPECTED_OMITTED_FIELDS');
    const url = new URL(evidence.fullDetailPath, BASE);
    requireFact(url.origin === BASE && url.pathname === '/api/v1/token-history' && url.searchParams.get('kind') === 'listings' &&
      url.searchParams.get('network') === 'livenet' && typeof evidence.fullDetailPath === 'string' && evidence.fullDetailPath.startsWith('/api/v1/token-history?') &&
      url.searchParams.get('q') === row.listingId && url.searchParams.get('listingId') === row.listingId &&
      url.searchParams.get('projection') === 'full', 'WRONG_EXACT_EVIDENCE_REFERENCE');
    const expected = Object.fromEntries(Object.entries(row).filter(([key]) => !OMIT.includes(key)));
    const actual = Object.fromEntries(Object.entries(shown).filter(([key]) => key !== 'displayEvidence'));
    equal(expected, actual, 'SUBSTANTIVE_LISTING_FIELD_CHANGED');
    omittedBytes += Buffer.byteLength(JSON.stringify(row)) - Buffer.byteLength(JSON.stringify(shown));
  }
  return { listings: full.rows.length, fullRowsSha256: digest(full.rows), savedRowBytes: omittedBytes,
    sourceDigestQualification: 'Bound to full-route snapshot; excluded historical source rows are not independently replayed.' };
}

export function verifyBoost(feed, events, listings, floor) {
  sameCheckpoint(feed.first, events.first);
  sameCheckpoint(feed.first, listings);
  sameCheckpoint(feed.first, floor);
  for (const payload of [feed.first, listings]) {
    const provenance = payload.provenance;
    requireFact(provenance?.model === 'boost-complete-events-v1' && provenance.eventCount === events.rows.length &&
      provenance.totalCount === events.rows.length && provenance.maxEventId === events.first.maxEventId &&
      provenance.maxUpdatedAt === events.first.maxUpdatedAt, 'BOOST_COMPLETE_SOURCE_FENCE_CHANGED');
    sameCheckpoint(provenance, events.first);
  }
  const valid = events.rows.filter((row) => row.confirmed === true && row.valid !== false);
  const visible = valid.filter((row) => ['boost-post', 'boost-reply', 'boost-reboost'].includes(row.kind));
  equal(unique(feed.rows, 'eventId').sort(), unique(visible, 'eventId').sort(), 'BOOST_VISIBLE_EVENT_INVENTORY_CHANGED');
  const source = new Map(visible.map((row) => [String(row.eventId), row]));
  const exactNetwork = integer(floor.liveNetworkValueQ8 ?? floor.actualValue?.liveNetworkValueQ8 ?? floor.networkValueQ8 ?? floor.actualValue?.networkValueQ8);
  let proofTotal = 0n;
  let total = 0n;
  let workTotal = 0n;
  let previous;
  for (const row of feed.rows) {
    const original = source.get(String(row.eventId));
    const proof = decimalQ8(original.proofSignalSats ?? original.signalSats ?? original.amountSats ?? original.proofs ?? 0);
    const work = integer(String(original.workSignalSubatoms ?? original.workSignalAtoms ?? original.workSignal ?? '0') || '0');
    const workValue = work * exactNetwork / WORK_CAP;
    requireFact(row.confirmed === true && row.txid === original.txid && row.kind === original.kind, 'BOOST_EVENT_BINDING');
    requireFact(integer(row.proofSignalQ8) === proof && decimalQ8(row.proofSignalSatsExact) === proof &&
      integer(row.workSignalValueQ8) === workValue && decimalQ8(row.workSignalValueSatsExact) === workValue &&
      integer(row.totalSignalQ8) === proof + workValue && decimalQ8(row.totalSignalSatsExact) === proof + workValue &&
      integer(row.workSignalSubatoms || '0') === work, 'BOOST_EXACT_SIGNAL_CHANGED');
    requireFact(previous === undefined || previous >= proof + workValue, 'BOOST_Q8_ORDER_CHANGED');
    previous = proof + workValue;
    proofTotal += proof; total += proof + workValue; workTotal += work;
  }
  const stats = feed.first.signalStats;
  requireFact(integer(stats.proofSignalQ8) === proofTotal && integer(stats.totalSignalQ8) === total &&
    decimalQ8(stats.proofSignalSatsExact) === proofTotal && decimalQ8(stats.totalSignalSatsExact) === total &&
    integer(stats.workSignalSubatoms) === workTotal, 'BOOST_AGGREGATE_CHANGED');
  requireFact(listings.complete === true && listings.mode === 'listings' && listings.hasMore === false && !listings.nextCursor &&
    listings.totalCount === listings.items.length, 'INCOMPLETE_BOOST_LISTINGS');
  const expectedListings = feed.rows.filter((row) => row.kind === 'boost-post' && row.boostTxid === row.txid && row.listing);
  equal(unique(expectedListings, 'eventId').sort(), unique(listings.items, 'eventId').sort(), 'BOOST_LISTING_DISCOVERY_CHANGED');
  for (const row of listings.items) {
    const matching = expectedListings.find((item) => String(item.eventId) === String(row.eventId));
    equal([row.listing, row.totalSignalQ8, row.currentOwnerAddress],
      [matching.listing, matching.totalSignalQ8, matching.currentOwnerAddress], 'BOOST_LISTING_FIELDS_CHANGED');
  }
  if (workTotal > 0n) {
    const valuation = feed.first.valuationProvenance;
    requireFact(valuation?.used === true && valuation.snapshotId === floor.snapshotId &&
      valuation.indexedThroughBlock === floor.indexedThroughBlock && valuation.indexedThroughBlockHash === floor.indexedThroughBlockHash &&
      integer(valuation.networkValue.networkValueQ8) === exactNetwork, 'BOOST_VALUATION_CHECKPOINT_CHANGED');
  }
  return { events: events.rows.length, visibleRecords: feed.rows.length, activeListings: listings.items.length,
    proofSignalQ8: proofTotal.toString(), totalSignalQ8: total.toString(), workSubatoms: workTotal.toString(),
    listingQualification: 'Complete active discovery compared to complete feed annotations; no independent lifecycle reducer replay.' };
}

export function verifyBonds(directory, infinity, inception) {
  const result = {};
  for (const [ticker, summary] of [['POWB', infinity], ['INCB', inception]]) {
    sameCheckpoint(directory, summary);
    const token = directory.tokens.find((row) => row.ticker === ticker);
    const supply = units(summary.stats?.confirmedSupply);
    const actual = summary.actualValue;
    const network = integer(summary.networkValueQ8);
    const floor = integer(summary.floorQ8);
    requireFact(token && units(token.confirmedSupply) === supply && supply > 0n && floor === network / supply,
      'BOND_SUPPLY_OR_QUOTIENT_CHANGED');
    requireFact(integer(actual.networkValueQ8) === network && decimalQ8(actual.networkValueSats) === network &&
      integer(actual.floorQ8) === floor && decimalQ8(actual.floorSats) === floor, 'BOND_EXACT_RENDER_CHANGED');
    const fees = units(actual.bondTransferFeeSats) + units(actual.bondMarketplaceMutationFeeSats) + units(actual.bondSaleVolumeSats);
    if (ticker === 'POWB') {
      requireFact((units(actual.bondMintFlowSats) + fees) * 100000000n + integer(actual.attachedWorkLiveValueQ8) === network,
        'POWB_COMPONENTS_CHANGED');
    } else {
      requireFact(actual.issuanceValuationFixedAtSend === true &&
        integer(actual.issuanceNetworkValueQ8) + fees * 100000000n === network &&
        units(actual.confirmedIssuanceUnits) === supply &&
        units(actual.directProofIssuanceUnits) + units(actual.attachedWorkIssuanceUnits) === supply &&
        supply * 100000000n + integer(actual.issuanceDustQ8) === integer(actual.issuanceNetworkValueQ8),
      'INCB_FIXED_ISSUANCE_CHANGED');
    }
    result[ticker] = { supply: supply.toString(), networkValueQ8: network.toString(), floorQ8: floor.toString() };
  }
  return result;
}

export async function verifyWalletListingScopes(io, listings, confirmedBookListings, before) {
  requireFact(Array.isArray(listings) && listings.length <= MAX_ROWS, 'WALLET_LISTING_BUDGET');
  const scoped = listings.filter((row) => row.sellerAddress === FIXTURE);
  unique(scoped, 'listingId');
  const confirmed = [];
  const pending = [];
  for (const row of scoped) {
    requireFact(row.tokenId === WORK_ID && HASH.test(row.listingId ?? ''), 'WALLET_LISTING_SCOPE');
    if (row.confirmed === true) {
      requireFact(row.status !== 'pending' && row.estimateOnly !== true, 'WALLET_LISTING_CONFIRMATION_CONFLICT');
      confirmed.push(row);
    } else {
      requireFact(row.confirmed === false && row.status === 'pending' && row.estimateOnly === true &&
        row.network === 'livenet' && row.txid === row.listingId &&
        ['blockHeight', 'blockHash', 'blockIndex', 'amount', 'amountAtoms', 'amountSubatoms']
          .every((key) => row[key] == null), 'WALLET_PENDING_LISTING_NOT_ESTIMATE');
      pending.push(row);
    }
  }
  // Wallet recovery deliberately includes pending estimates. They cannot replace
  // confirmed book membership or contribute to confirmed WORK reservations.
  equal(unique(confirmedBookListings, 'listingId').sort(), unique(confirmed, 'listingId').sort(),
    'WALLET_LISTING_MEMBERSHIP_CHANGED');
  const witnesses = [];
  for (const row of pending) {
    const auth = row.saleAuthorization;
    requireFact(auth?.version === 'pwt-sale-v8' && auth.anchorType === 'sale-ticket-v1' &&
      auth.network === 'livenet' && auth.tokenId === WORK_ID && auth.sellerAddress === FIXTURE &&
      Number.isSafeInteger(auth.anchorVout) && auth.anchorVout >= 0 && units(auth.anchorValueSats) === 546n &&
      typeof auth.anchorScriptPubKey === 'string' && /^(?:[0-9a-f]{2})+$/u.test(auth.anchorScriptPubKey),
    'WALLET_PENDING_ANCHOR_INVALID');
    const output = await io.core('gettxout', [row.listingId, String(auth.anchorVout), 'true']);
    requireFact(output && output.bestblock === before.bestblockhash && output.confirmations === 0 &&
      output.exactValueProofs === '546' && output.scriptPubKey?.hex === auth.anchorScriptPubKey &&
      (output.scriptPubKey?.address === FIXTURE || output.scriptPubKey?.addresses?.includes(FIXTURE)),
    'WALLET_PENDING_CORE_TICKET_MISMATCH');
    witnesses.push({ listingId: row.listingId, anchorVout: auth.anchorVout, valueProofs: output.exactValueProofs,
      scriptPubKey: output.scriptPubKey.hex, bestblock: output.bestblock, confirmations: 0 });
  }
  return { confirmedListingCount: confirmed.length, pendingListingCount: pending.length,
    pendingTicketWitnesses: witnesses, pendingTicketWitnessSha256: digest(witnesses),
    pendingQualification: 'Each pending ticket was unconfirmed and unspent in Core with includeMempool=true when checked; no atomic mempool snapshot or confirmed WORK amount is implied.' };
}

export async function verifyWallet(io, registry, book, before) {
  requireFact(Array.isArray(registry.listings) && registry.collectionHasMore?.listings !== true &&
    (registry.totalCounts?.listings == null || registry.totalCounts.listings === registry.listings.length), 'INCOMPLETE_ID_RESERVATIONS');
  const utxos = await io.get(`/api/v1/address/${FIXTURE}/utxo?network=livenet`);
  requireFact(Array.isArray(utxos) && utxos.length <= 250, 'WALLET_UTXO_BUDGET');
  const anchors = new Map();
  for (const row of [...registry.listings, ...book.rows].filter((item) => item.sellerAddress === FIXTURE)) {
    const auth = row.saleAuthorization;
    if (!auth || !Number.isSafeInteger(auth.anchorVout)) continue; // historical forms have no ticket
    const txid = auth.anchorType === 'seller-utxo-v1' ? auth.anchorTxid : row.listingId;
    requireFact(HASH.test(txid ?? '') && auth.anchorVout >= 0, 'WALLET_INVALID_RESERVATION');
    anchors.set(`${txid}:${auth.anchorVout}`, row);
  }
  let confirmed = 0n; let pending = 0n; let reserved = 0n; let spendable = 0n; let protectedCount = 0; let availableCount = 0;
  const seen = new Set();
  for (const row of utxos) {
    const key = `${row.txid}:${row.vout}`;
    requireFact(HASH.test(row.txid ?? '') && Number.isSafeInteger(row.vout) && row.vout >= 0 &&
      typeof row.status?.confirmed === 'boolean' && !seen.has(key), 'WALLET_UTXO_IDENTITY');
    seen.add(key);
    const amount = units(row.value);
    const output = await io.core('gettxout', [row.txid, String(row.vout), 'true']);
    requireFact(output && output.bestblock === before.bestblockhash && output.exactValueProofs === amount.toString() &&
      (output.confirmations > 0) === row.status.confirmed &&
      (output.scriptPubKey?.address === FIXTURE || output.scriptPubKey?.addresses?.includes(FIXTURE)), 'WALLET_CORE_UTXO_MISMATCH');
    if (!row.status.confirmed) { pending += amount; continue; }
    confirmed += amount;
    if (amount < 546n) continue;
    if (anchors.has(key)) { reserved += amount; protectedCount++; }
    else { spendable += amount; availableCount++; }
  }
  const wallet = await io.get(`/api/v1/token?network=livenet&wallet=1&address=${FIXTURE}&asset=${WORK_ID}`);
  requireFact(wallet.indexedThroughBlock === before.blocks && wallet.indexedThroughBlockHash === before.bestblockhash &&
    Array.isArray(wallet.holders) && Array.isArray(wallet.listings) && wallet.collectionHasMore?.listings !== true, 'WALLET_SOURCE_CHECKPOINT');
  const holder = wallet.holders.find((row) => row.address === FIXTURE && row.tokenId === WORK_ID);
  requireFact(holder, 'WALLET_CONFIRMED_HOLDER_MISSING');
  const balance = integer(holder.balanceSubatoms);
  const workListings = book.rows.filter((row) => row.sellerAddress === FIXTURE && row.tokenId === WORK_ID);
  const listingScopes = await verifyWalletListingScopes(io, wallet.listings, workListings, before);
  const workReserved = workListings.reduce((total, row) => total + integer(row.amountSubatoms), 0n);
  requireFact(balance >= workReserved && availableCount >= 1, 'WALLET_FIXTURE_PRECONDITION_UNMET');
  const finalUtxos = await io.get(`/api/v1/address/${FIXTURE}/utxo?network=livenet`);
  const utxoKey = (rows) => rows.map((row) => [row.txid, row.vout, row.value, row.status.confirmed]).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  equal(utxoKey(utxos), utxoKey(finalUtxos), 'WALLET_MEMBERSHIP_CHANGED_DURING_CORE_CHECKS');
  return { address: FIXTURE, utxos: utxos.length, confirmedProofs: confirmed.toString(), pendingProofs: pending.toString(),
    reservedProofs: reserved.toString(), availableProofs: spendable.toString(), protectedCount, availableCount,
    confirmedWORKSubatoms: balance.toString(), reservedWORKSubatoms: workReserved.toString(), remainingWORKSubatoms: (balance - workReserved).toString(),
    ...listingScopes,
    qualification: 'Public API inventory checked against current Core; wallet-provider exclusions, whole-chain address completeness, and transaction construction/signing are not proven.' };
}

export async function compareCandidate(io) {
  const before = await io.core('getblockchaininfo');
  const mempoolBefore = await io.core('getrawmempool', ['false', 'true']);
  const live = await io.get('/health/live?network=livenet');
  const health = await io.get('/health?network=livenet');
  requireFact(live.available === true && health.ready === true && health.lagBlocks === 0, 'CANDIDATE_NOT_READY');
  const registry = await io.get('/api/v1/registry?network=livenet');
  const counts = await io.get('/api/v1/registry-summary?network=livenet&projection=counts-v1');
  const fullDirectory = await io.get('/api/v1/token-summary?network=livenet');
  const compactDirectory = await io.get('/api/v1/token-summary?network=livenet&compact=1');
  const directory = await io.get('/api/v1/token-summary?network=livenet&compact=1&projection=directory-v1');
  sameCheckpoint(fullDirectory, compactDirectory);
  equal(fullDirectory.tokens, compactDirectory.tokens, 'FULL_COMPACT_DEFINITIONS_CHANGED');
  const result = { counts: verifyCounts(registry, counts), directory: verifyDirectory(compactDirectory, directory) };
  const full = await inventory(io, '/api/v1/token-history', 'book', { kind: 'listings', projection: 'full' });
  const display = await inventory(io, '/api/v1/token-history', 'book', { kind: 'listings', projection: 'display-v1' });
  result.book = verifyBookPair(full, display);
  const checked = [];
  for (const row of full.rows) {
    const authorization = row.saleAuthorization;
    requireFact(authorization?.anchorType === 'sale-ticket-v1' && Number.isSafeInteger(authorization.anchorVout) &&
      authorization.anchorVout >= 0 && HASH.test(row.listingId), 'INVALID_LISTING_ANCHOR');
    const output = await io.core('gettxout', [row.listingId, String(authorization.anchorVout), 'true']);
    requireFact(output && output.bestblock === before.bestblockhash && output.confirmations > 0 &&
      output.exactValueProofs === String(authorization.anchorValueSats) &&
      output.scriptPubKey?.hex === authorization.anchorScriptPubKey, 'CORE_ANCHOR_MISMATCH');
    checked.push([row.listingId, authorization.anchorVout, output.exactValueProofs, output.scriptPubKey.hex]);
  }
  result.book.independentCoreAnchors = checked.length;
  result.book.independentCoreSha256 = digest(checked);
  result.wallet = await verifyWallet(io, registry, full, before);
  for (const row of display.rows.slice(0, 3)) {
    const detail = await io.get(row.displayEvidence.fullDetailPath);
    requireFact(detail.totalCount === 1 && detail.items?.length === 1 &&
      digest(listingCommitmentRecord(detail.items[0])) === row.displayEvidence.fullRecordSha256, 'FULL_DETAIL_REFERENCE_MISMATCH');
  }
  // Recheck current complete Core membership after all individual RPCs. An
  // unrelated mempool sequence change is recorded, not mistaken for data loss.
  const finalBook = await io.get('/api/v1/token-history?network=livenet&kind=listings&projection=display-v1&limit=200&fresh=1');
  equal(bookFence(full.first), bookFence(finalBook), 'BOOK_CHANGED_DURING_CORE_CHECKS');
  const events = await inventory(io, '/api/v1/events', 'events', { protocol: 'pwb1', status: 'confirmed' });
  const feed = await inventory(io, '/api/v1/boost', 'boost', { sort: 'value', window: 'all' });
  const boostListings = await io.get('/api/v1/boost?network=livenet&listings=1');
  const floor = await io.get('/api/v1/work-floor?network=livenet');
  const infinity = await io.get('/api/v1/infinity-summary?network=livenet');
  const inception = await io.get('/api/v1/inception-summary?network=livenet');
  result.bonds = verifyBonds(directory, infinity, inception);
  result.boost = verifyBoost(feed, events, boostListings, floor);
  let rawSamples = 0;
  for (const txid of [...new Set(feed.rows.map((row) => row.txid))].slice(0, 8)) {
    const raw = await io.core('getrawtransaction', [txid, 'true']);
    requireFact(raw.txid === txid && raw.confirmations > 0 && HASH.test(raw.blockhash ?? '') &&
      raw.vout?.some((output) => /^6a/u.test(output.scriptPubKey?.hex ?? '') && output.scriptPubKey.hex.includes('707762313a')),
    'BOOST_RAW_CONFIRMED_CARRIER_MISMATCH');
    rawSamples++;
  }
  result.boost.rawCarrierSamples = rawSamples;
  const finalHealth = await io.get('/health?network=livenet');
  requireFact(finalHealth.ready === true && finalHealth.lagBlocks === 0, 'CANDIDATE_FINAL_NOT_READY');
  const after = await io.core('getblockchaininfo');
  const mempoolAfter = await io.core('getrawmempool', ['false', 'true']);
  requireFact(before.blocks === after.blocks && before.bestblockhash === after.bestblockhash, 'CORE_TIP_CHANGED');
  requireFact([mempoolBefore.mempool_sequence, mempoolAfter.mempool_sequence].every((n) => Number.isSafeInteger(n) && n >= 0),
    'MISSING_MEMPOOL_SEQUENCE_FENCE');
  for (const payload of [registry, counts, fullDirectory, directory, full.first, display.first, events.first, feed.first, floor]) {
    const [height, hash] = checkpoint(payload);
    requireFact(height === after.blocks && hash === after.bestblockhash, 'API_NOT_AT_CORE_CHECKPOINT');
  }
  return { ...result, core: { height: after.blocks, hash: after.bestblockhash,
    mempoolSequenceBefore: mempoolBefore.mempool_sequence, mempoolSequenceAfter: mempoolAfter.mempool_sequence,
    mempoolSequenceStable: mempoolBefore.mempool_sequence === mempoolAfter.mempool_sequence },
  qualification: 'Current confirmed inventories and sampled raw carriers; no exhaustive historical replay, atomic mempool snapshot, or signing proof. Prior604/238 counts are historical baselines, never expected current counts.' };
}

function ioFor(outputDirectory, receipts, base) {
  const started = Date.now();
  let totalBytes = 0;
  let httpCalls = 0;
  let coreCalls = 0;
  const remaining = () => {
    const left = MAX_MS - (Date.now() - started);
    requireFact(left > 0, 'PROBE_TIME_BUDGET_EXCEEDED');
    return left;
  };
  async function save(kind, request, raw, status) {
    const name = `${String(receipts.length).padStart(4, '0')}-${kind}.json.gz`;
    await writeFile(`${outputDirectory}/${name}`, gzipSync(raw), { flag: 'wx', mode: 0o600 });
    receipts.push({ kind, request, status, file: name, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') });
  }
  return {
    async get(path) {
      const url = new URL(path, base);
      requireFact(url.origin === base && (url.pathname.startsWith('/api/v1/') || ['/health', '/health/live'].includes(url.pathname)), 'NONPRIVATE_API_REQUEST');
      requireFact(++httpCalls <= MAX_HTTP, 'HTTP_REQUEST_BUDGET_EXCEEDED');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(60_000, remaining()));
      try {
        const response = await fetch(url, { method: 'GET', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json' } });
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length; totalBytes += chunk.length;
          requireFact(size <= MAX_BODY && totalBytes <= MAX_BYTES, 'HTTP_BYTE_BUDGET_EXCEEDED');
          chunks.push(Buffer.from(chunk));
        }
        const raw = Buffer.concat(chunks);
        await save('http', url.pathname + url.search, raw, response.status);
        requireFact(response.status === 200, `CANDIDATE_HTTP_${response.status}`);
        return JSON.parse(raw.toString('utf8'));
      } finally { clearTimeout(timer); }
    },
    async core(method, args = []) {
      requireFact(CORE_METHODS.includes(method) && ++coreCalls <= MAX_CORE,
        'CORE_REQUEST_BUDGET_OR_METHOD');
      const { stdout } = await spawn(...coreCliExecFileInvocation(method, args,
        { timeout: Math.min(15_000, remaining()), maxBuffer: MAX_BODY,
          encoding: 'utf8', env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' } }));
      const raw = Buffer.from(stdout);
      totalBytes += raw.length;
      requireFact(totalBytes <= MAX_BYTES, 'CORE_BYTE_BUDGET_EXCEEDED');
      await save('core', [method, ...args], raw, 0);
      return decodeCoreCliPayload(method, stdout);
    },
  };
}

async function main() {
  requireFact(process.version === 'v24.18.0', 'PINNED_NODE_24_REQUIRED');
  requireFact(userInfo().username === 'bitcoin', 'BITCOIN_USER_REQUIRED');
  const args = process.argv.slice(2);
  requireFact(args.length === 5 && args[0] === '--run' && args[1] === '--output' && args[3] === '--api-port',
    'USAGE_--run_--output_FRESH_ABSOLUTE_DIRECTORY_--api-port_18081_OR_8081');
  const base = apiBase(args[4]);
  const output = resolve(args[2]);
  requireFact(output === args[2] && await realpath(dirname(output)) === dirname(output), 'OUTPUT_PARENT_NOT_CANONICAL');
  await mkdir(output, { mode: 0o700 });
  const receipts = [];
  const report = { format: 'audit5-candidate-http-core-v1', startedAt: new Date().toISOString(), base,
    limits: { pages: MAX_PAGES, rows: MAX_ROWS, totalBytes: MAX_BYTES, httpRequests: MAX_HTTP, coreRequests: MAX_CORE, milliseconds: MAX_MS }, receipts };
  try {
    report.result = await compareCandidate(ioFor(output, receipts, base));
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.failure = /^[A-Z0-9_]+$/u.test(error?.message ?? '') ? error.message : 'BOUNDED_PROBE_FAILED';
    report.qualification = 'Do not treat503,409 or a moving checkpoint as data loss. Preserve this attempt and review before a new bounded run.';
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeFile(`${output}/receipt.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ ok: report.ok, output, failure: report.failure ?? null }) + '\n');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { process.stderr.write('candidate_probe status=refused\n'); process.exitCode = 1; });
}
