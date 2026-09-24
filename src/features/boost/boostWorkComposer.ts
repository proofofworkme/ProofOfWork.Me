import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import {
  canonicalWorkCapacityAddress,
  requireCanonicalWorkCapacity,
  type CanonicalWorkCapacity,
} from "../../shared/work/canonicalWorkCapacity";
import { workSubatomsFromCanonicalString } from "../../workAmount";

export const BOOST_WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
export const BOOST_WORK_REGISTRY_ADDRESS = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
export const BOOST_WORK_MUTATION_PROOFS = 546;

type WalletWorkPayload = {
  authoritativeWallet?: boolean;
  canonicalWorkCapacities?: CanonicalWorkCapacity[];
  holders?: Array<{
    address?: string;
    balanceSubatoms?: string;
    tokenId?: string;
  }>;
  indexedThroughBlock?: number;
  indexedThroughBlockHash?: string;
  listings?: Array<Record<string, unknown>>;
  source?: string;
  walletScoped?: boolean;
};

type WorkFloorPayload = {
  workAmoV8?: {
    version?: string;
    pinsRequested?: boolean;
    pinsConfigured?: boolean;
    protocolReady?: boolean;
    writeAdmission?: boolean;
    activation?: {
      active?: boolean;
      evidenceComplete?: boolean;
      reached?: boolean;
      tipVerified?: boolean;
    };
  };
};

export type BoostWorkCapacity = {
  anchorOutpoints: Array<{ txid: string; vout: number }>;
  spendableSubatoms: bigint;
};

function listingAnchorOutpoints(listings: WalletWorkPayload["listings"]) {
  const outpoints = new Map<string, { txid: string; vout: number }>();
  for (const listing of listings ?? []) {
    const authorization = listing.saleAuthorization &&
      typeof listing.saleAuthorization === "object" &&
      !Array.isArray(listing.saleAuthorization)
        ? listing.saleAuthorization as Record<string, unknown>
        : {};
    const txid = String(authorization.anchorTxid ?? listing.listingId ?? "")
      .trim().toLowerCase();
    const vout = Number(authorization.anchorVout ?? authorization.saleTicketVout ?? 2);
    if (/^[0-9a-f]{64}$/u.test(txid) && Number.isSafeInteger(vout) && vout >= 0) {
      outpoints.set(`${txid}:${vout}`, { txid, vout });
    }
  }
  return [...outpoints.values()];
}

export async function fetchBoostWorkCapacity(address: string): Promise<BoostWorkCapacity> {
  const params = new URLSearchParams({
    address,
    asset: BOOST_WORK_TOKEN_ID,
    fresh: "1",
    wallet: "1",
  });
  const payload = await fetchProofApiJson<WalletWorkPayload>(
    `/api/v1/token?${params.toString()}`,
    "livenet",
  );
  if (payload.authoritativeWallet !== true ||
      payload.walletScoped !== true ||
      !String(payload.source ?? "").includes("proof-indexer-wallet-token-overlay")) {
    throw new Error("The ProofOfWork index could not verify this WORK wallet balance.");
  }
  const walletAddress = canonicalWorkCapacityAddress(address);
  const holders = (payload.holders ?? []).filter((holder) =>
    canonicalWorkCapacityAddress(String(holder.address ?? "")) === walletAddress &&
    String(holder.tokenId ?? "").toLowerCase() === BOOST_WORK_TOKEN_ID);
  if (holders.length === 0 &&
      !(payload.canonicalWorkCapacities ?? []).some((capacity) =>
        capacity.address === walletAddress)) {
    return {
      anchorOutpoints: listingAnchorOutpoints(payload.listings),
      spendableSubatoms: 0n,
    };
  }
  if (holders.length !== 1) {
    throw new Error("Canonical WORK holder state is unavailable.");
  }
  const balance = workSubatomsFromCanonicalString(holders[0].balanceSubatoms);
  if (balance === null) {
    throw new Error("Canonical WORK holder amount is unavailable.");
  }
  const capacity = requireCanonicalWorkCapacity(payload.canonicalWorkCapacities, {
    address,
    network: "livenet",
    tokenId: BOOST_WORK_TOKEN_ID,
    indexedThroughBlock: payload.indexedThroughBlock,
    indexedThroughBlockHash: payload.indexedThroughBlockHash,
    confirmedBalanceSubatoms: balance,
  });
  return {
    anchorOutpoints: listingAnchorOutpoints(payload.listings),
    spendableSubatoms: capacity.transferable,
  };
}

export async function requireBoostWorkWriteAdmission() {
  const quote = await fetchProofApiJson<WorkFloorPayload>(
    "/api/v1/work-floor?fresh=1",
    "livenet",
  );
  const status = quote.workAmoV8;
  if (status?.version !== "pwt-sale-v8" ||
      (status.pinsRequested === true && status.pinsConfigured !== true) ||
      status.activation?.active !== true ||
      status.activation?.reached !== true ||
      status.activation?.tipVerified !== true ||
      status.activation?.evidenceComplete !== true ||
      status.protocolReady !== true ||
      status.writeAdmission !== true) {
    throw new Error("WORK Q16 transfer admission is unavailable. No transaction was created.");
  }
}

export function buildBoostWorkSendPayload(amountSubatoms: bigint, address: string) {
  if (amountSubatoms <= 0n || !address.trim()) {
    throw new Error("A positive WORK signal and recipient are required.");
  }
  return `pwt1:send3:${BOOST_WORK_TOKEN_ID}:${amountSubatoms}:${address.trim()}`;
}
