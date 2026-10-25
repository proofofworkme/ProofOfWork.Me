import { createHash } from "node:crypto";
import { createAmoBrowseSnapshotStore } from "../../server/amo-browse-snapshot.mjs";

export const BROWSE_ASSETS = {
  work: "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
  powb: "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562",
  incb: "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d",
};
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Synthetic public browser fixtures only: these markers exercise rendering and
// never represent node evidence or authorize signing against a real service.
export function browseFixtureCandidate(input, items = input.token?.listings ?? []) {
  const height = input.indexedThroughBlock ?? input.workFloor?.indexedThroughBlock ?? 973079;
  const hash = input.indexedThroughBlockHash ?? input.workFloor?.indexedThroughBlockHash ?? "b".repeat(64);
  const indexedAt = input.indexedAt ?? new Date().toISOString();
  const snapshotId = input.snapshotId ?? "amo-browse-browser-fixture";
  const checkpoint = { height, blockHash: hash };
  const metadata = { indexedAt, indexedThroughBlock: height, indexedThroughBlockHash: hash, snapshotId };
  const summary = { ...input, ...metadata, network: "livenet",
    registry: { ...input.registry, ...metadata }, token: { ...input.token, ...metadata },
    workFloor: { ...input.workFloor, ...metadata },
    provenance: { ...metadata, coherent: true, ready: true, served: "exact-tip" },
    // Synthetic prices for fixtures which do not provide bond valuation data.
    browseBondReferences: Object.fromEntries([BROWSE_ASSETS.powb, BROWSE_ASSETS.incb].map((id) => [id, {
      ...metadata, displayOnly: true, floorQ8: "100000000", floorSats: "1", ...input.browseBondReferences?.[id],
    }])),
  };
  const projected = items.map(item => ({ ...item, displayEvidence: {
    model: "proof-token-listing-display-v2", fullRecordSha256: item.displayEvidence?.fullRecordSha256 ?? digest(item), omittedFields: [],
    fullDetailPath: `/api/v1/token-history?kind=listings&network=livenet&projection=full&q=${item.listingId}&listingId=${item.listingId}`,
  } }));
  const membership = digest(projected);
  return { summary, checkpoint, observedAt: new Date().toISOString(), book: {
    ...metadata, items: projected, totalCount: projected.length, start: 0, end: projected.length,
    hasMore: false, snapshotId: membership,
    listingAuthority: { model: "proof-token-market-core-gettxout-v1", includeMempool: true,
      checkpoint, checkedOutpointsSha256: membership, checkedListingCount: items.length,
      inputListingCount: items.length, outputListingCount: items.length, spentListingCount: 0,
      unspentListingCount: items.length },
    listingProjection: { scope: "complete-book", activeListingCount: items.length,
      membershipSha256: membership, coreUnspentListingCount: items.length, excludedByProtocolCount: 0 },
    itemProjection: { model: "proof-token-listing-display-v2", fullSourceSha256: membership, fullMembershipSha256: membership },
  } };
}

export function createAmoBrowseFixture(source) {
  let signature = "";
  let candidate;
  let failure;
  const store = createAmoBrowseSnapshotStore({ build: async () => candidate,
    assets: BROWSE_ASSETS, minimumRefreshMs: 0,
    // Existing responsive fixtures deliberately exceed the live 5,000-row cap.
    // Only this synthetic store expands the budget; production stays bounded.
    maxListings: 10_000, maxNodes: 2_000_000, maxBytes: 128 * 1024 * 1024,
    onError: error => { failure = error; },
    isSealed: item => item.confirmed === true && item.sealConfirmed === true && Boolean(item.saleAuthorization?.anchorSignature),
  });
  return async (url, override) => {
    const input = override ?? (typeof source === "function" ? await source(url) : source);
    const next = digest(input);
    if (next !== signature) {
      candidate = browseFixtureCandidate(input.summary ?? input, input.items ?? input.token?.listings);
      if (!await store.refresh()) throw new Error(`Invalid AMO browsing fixture: ${failure?.message ?? "unknown source failure"}`);
      signature = next;
    }
    return store.read(url.searchParams);
  };
}
