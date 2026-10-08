import { assertCompleteIdReservations } from "../../shared/api/surfaceReadState";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";

export type CodeReservationPayload = {
  network?: BitcoinNetwork; source?: string; walletScoped?: boolean; authoritativeWallet?: boolean;
  collectionHasMore?: { listings?: boolean }; listings?: Record<string, unknown>[];
  records?: unknown[]; coverage?: { complete?: boolean }; summaryOnly?: boolean;
  totalCounts?: { listings?: number | null }; hasMore?: boolean; listingBookComplete?: boolean;
};
export function assertCodeRegistryReservations(payload: CodeReservationPayload) {
  assertCompleteIdReservations(payload);
  if (payload.coverage?.complete === false || !Array.isArray(payload.records)) {
    throw new Error("Complete registry reservation evidence is unavailable.");
  }
}
export function assertCodeCreditReservations(payload: CodeReservationPayload) {
  const count = payload.totalCounts?.listings;
  const authoritativeWalletBook = payload.authoritativeWallet === true && payload.walletScoped === true &&
    payload.source?.split("+").includes("proof-indexer-wallet-token-overlay") === true;
  if (!Array.isArray(payload.listings) || payload.collectionHasMore?.listings === true || payload.listingBookComplete === false ||
    (!authoritativeWalletBook && payload.listingBookComplete !== true && (payload.summaryOnly === true || payload.hasMore === true)) ||
    (count !== undefined && count !== null && (!Number.isSafeInteger(count) || count < 0 || count !== payload.listings.length))) {
    throw new Error("Complete wallet credit reservations are unavailable.");
  }
  // The fresh wallet overlay returns every active listing and fails on overflow.
  // Its summary flags describe omitted history, not an incomplete reservation book.
  // Explicit listing incompleteness and inconsistent counts still fail closed.
  if (payload.authoritativeWallet !== true || payload.walletScoped !== true || !payload.source?.trim()) {
    throw new Error("Fresh authoritative wallet credit reservations are unavailable.");
  }
}
