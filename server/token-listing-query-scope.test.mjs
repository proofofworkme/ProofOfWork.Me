import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenListingHistoryQueryScope } from "./token-listing-query-scope.mjs";

const listingId = "a".repeat(64);

test("exact listing txid searches use the bounded query scope", () => {
  assert.deepEqual(tokenListingHistoryQueryScope({ query: listingId }), {
    exactListingId: listingId,
    narrowToExactListing: true,
  });
  assert.deepEqual(
    tokenListingHistoryQueryScope({ query: listingId.toUpperCase() }),
    { exactListingId: listingId, narrowToExactListing: true },
  );
});

test("explicit listing IDs take precedence over ordinary search text", () => {
  assert.deepEqual(
    tokenListingHistoryQueryScope({ listingId, query: "Carbonz" }),
    { exactListingId: listingId, narrowToExactListing: true },
  );
});

test("ordinary searches and cursor pagination keep complete-book scope", () => {
  assert.deepEqual(tokenListingHistoryQueryScope({ query: "Carbonz" }), {
    exactListingId: "",
    narrowToExactListing: false,
  });
  assert.deepEqual(
    tokenListingHistoryQueryScope({ query: listingId, cursor: "cursor" }),
    { exactListingId: listingId, narrowToExactListing: false },
  );
});

test("malformed explicit listing IDs are rejected", () => {
  assert.throws(
    () => tokenListingHistoryQueryScope({ listingId: "not-a-txid" }),
    /64-character txid/u,
  );
});
