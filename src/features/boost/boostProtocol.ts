import { encodeTextBase64Url } from "../../shared/utils/encoding";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";

export const BOOST_ACTION_REGISTRY_FEE_SATS = 546;
export const BOOST_LISTING_ANCHOR_VALUE_SATS = 546;
export const BOOST_LISTING_ANCHOR_VOUT = 2;
export const BOOST_POST_MAX_CHARS = 140;
export const BOOST_PROTOCOL_PREFIX = "pwb1:";
export const BOOST_PROFILE_INTENT_STORAGE_KEY =
  "proofofwork.boost.profileIntent.v1";
export const BOOST_SALE_AUTH_VERSION = "pwb-sale-v1";

export type BoostPaidAction = "like" | "reboost";
export type BoostFollowAction = "follow" | "unfollow";
export type BoostFeedMode = "timeline" | "profile";
export type BoostProfileTab =
  | "boosts"
  | "replies"
  | "purchased"
  | "likes"
  | "replies-to";
export type BoostTimelineMode = "all" | "following";

export type BoostProfile = {
  address: string;
  id?: string;
  image?: {
    mime?: string;
    name?: string;
    sha256?: string;
    txid?: string;
    url?: string;
  };
  name?: string;
  profileId?: string;
};

export type BoostFeedItem = {
  actionCount?: number;
  authorAddress: string;
  authorDisplay?: string;
  authorId?: string;
  boostTxid?: string;
  confirmed: boolean;
  createdAt: string;
  currentOwnerAddress?: string;
  currentOwnerId?: string;
  followerCount?: number;
  followingCount?: number;
  kind: string;
  listing?: {
    listingTxid?: string;
    priceSats?: number;
    sellerAddress?: string;
  } | null;
  listingPriceSats?: number;
  media?: {
    mime?: string;
    name?: string;
    sha256?: string;
    size?: number;
  };
  proofSignalSats: number;
  proofSignalUsd?: number;
  replyCount?: number;
  reboostCount?: number;
  likeCount?: number;
  network?: BitcoinNetwork;
  signalSats?: number;
  signalUsd?: number;
  targetTxid?: string;
  text: string;
  totalSignalQ8?: string;
  totalSignalSats?: number;
  totalSignalSatsExact?: string;
  totalSignalUsd?: number;
  txid: string;
  viewerFollowsAuthor?: boolean;
  workSignal?: string;
  workSignalSubatoms?: string;
  workSignalUsd?: number;
  workSignalValueQ8?: string;
  workSignalValueSats?: number;
  workSignalValueSatsExact?: string;
  profile?: BoostProfile;
};

export type BoostFeedPayload = {
  btcUsd?: number;
  graph?: {
    followingCount?: number;
    viewerAddress?: string;
  };
  indexedAt?: string;
  items?: BoostFeedItem[];
  mode?: BoostFeedMode;
  network?: BitcoinNetwork;
  profile?: string;
  profileSubject?: {
    address?: string;
    displayName?: string;
    followerCount?: number;
    followingCount?: number;
    id?: string;
    profile?: BoostProfile;
    proofSignalSats?: number;
    purchasedCount?: number;
    query: string;
    replyCount?: number;
    repliesToCount?: number;
    boostCount?: number;
    likeCount?: number;
    totalSignalSats?: number;
    totalSignalUsd?: number;
    viewerFollowsProfile?: boolean;
    workSignalSubatoms?: string;
  };
  profileTab?: BoostProfileTab;
  profileTabs?: Record<BoostProfileTab, number>;
  source?: string;
  stats?: {
    confirmed?: number;
    pending?: number;
    total?: number;
  };
  totalCount?: number;
  view?: BoostTimelineMode;
};

export type BoostFollowTarget = {
  targetAddress: string;
  targetId?: string;
};

export type BoostIdentityIntent = {
  address: string;
  createdAt: string;
  id: string;
  message: string;
  network: BitcoinNetwork;
  signature: string;
};

export type BoostSaleAuthorization = {
  anchorScriptPubKey?: string;
  anchorSigHashType?: number;
  anchorType?: string;
  anchorValueSats: number;
  anchorVout: number;
  boostTxid: string;
  buyerAddress?: string;
  expiresAt?: string;
  nonce: string;
  priceSats: number;
  saleTicketValueSats: number;
  saleTicketVout: number;
  sellerAddress: string;
  sellerPublicKey?: string;
  version: typeof BOOST_SALE_AUTH_VERSION;
};

export type BoostMarketplaceListing = {
  boostTxid: string;
  confirmed: boolean;
  createdAt: string;
  listingId: string;
  network: BitcoinNetwork;
  priceSats: number;
  sellerAddress: string;
  text: string;
  txid: string;
};

export type PowIdRecordLike = {
  confirmed?: boolean;
  id: string;
  network?: BitcoinNetwork;
  ownerAddress: string;
  receiveAddress?: string;
};

export function normalizeBoostTxid(value: unknown) {
  const txid = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/u.test(txid) ? txid : "";
}

export function normalizeBoostId(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/u, "")
    .replace(/@proofofwork\.me$/u, "");
}

export function boostPostText(value: string) {
  return value.trim().slice(0, BOOST_POST_MAX_CHARS);
}

export function buildBoostActionPayload(action: BoostPaidAction, targetTxid: string) {
  const txid = normalizeBoostTxid(targetTxid);
  if (!txid) {
    throw new Error("Boost action target txid is invalid.");
  }
  return `${BOOST_PROTOCOL_PREFIX}${action}:${txid}`;
}

export function buildBoostFollowPayload(
  action: BoostFollowAction,
  { targetAddress, targetId }: BoostFollowTarget,
) {
  const address = targetAddress.trim();
  if (!address) {
    throw new Error("Choose a Boost profile to follow.");
  }
  const target = {
    v: 1,
    targetAddress: address,
    ...(normalizeBoostId(targetId) ? { targetId: normalizeBoostId(targetId) } : {}),
  };
  return `${BOOST_PROTOCOL_PREFIX}${action}:${encodeTextBase64Url(JSON.stringify(target))}`;
}

export function buildBoostReplyPayload({
  profileId,
  targetTxid,
  text,
}: {
  profileId?: string;
  targetTxid: string;
  text: string;
}) {
  const txid = normalizeBoostTxid(targetTxid);
  if (!txid) {
    throw new Error("Boost reply target txid is invalid.");
  }
  const post = {
    v: 1,
    text: boostPostText(text),
    ...(normalizeBoostId(profileId) ? { profileId: normalizeBoostId(profileId) } : {}),
  };
  if (!post.text) {
    throw new Error("Enter a Boost reply.");
  }
  return `${BOOST_PROTOCOL_PREFIX}reply:${txid}:${encodeTextBase64Url(JSON.stringify(post))}`;
}

export function boostSaleAuthorizationDraft({
  anchorScriptPubKey,
  buyerAddress,
  boostTxid,
  priceSats,
  sellerAddress,
  sellerPublicKey,
}: {
  anchorScriptPubKey?: string;
  buyerAddress?: string;
  boostTxid: string;
  priceSats: number;
  sellerAddress: string;
  sellerPublicKey?: string;
}): BoostSaleAuthorization {
  const normalizedBoostTxid = normalizeBoostTxid(boostTxid);
  if (!normalizedBoostTxid) {
    throw new Error("Boost listing needs a valid Boost txid.");
  }
  const normalizedPrice = Math.floor(priceSats);
  if (!Number.isSafeInteger(normalizedPrice) || normalizedPrice < 1) {
    throw new Error("Boost listing price must be at least 1 proof.");
  }
  return {
    anchorScriptPubKey,
    anchorSigHashType: 0x83,
    anchorType: "sale-ticket-v1",
    anchorValueSats: BOOST_LISTING_ANCHOR_VALUE_SATS,
    anchorVout: BOOST_LISTING_ANCHOR_VOUT,
    boostTxid: normalizedBoostTxid,
    buyerAddress: buyerAddress?.trim() || undefined,
    nonce: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
    priceSats: normalizedPrice,
    saleTicketValueSats: BOOST_LISTING_ANCHOR_VALUE_SATS,
    saleTicketVout: BOOST_LISTING_ANCHOR_VOUT,
    sellerAddress: sellerAddress.trim(),
    sellerPublicKey: sellerPublicKey?.trim().toLowerCase() || undefined,
    version: BOOST_SALE_AUTH_VERSION,
  };
}

export function buildBoostListingPayload(authorization: BoostSaleAuthorization) {
  return `${BOOST_PROTOCOL_PREFIX}list5:${encodeTextBase64Url(JSON.stringify(authorization))}`;
}

export function buildBoostProfilePayload({
  id,
  intent,
  name,
}: {
  id: string;
  intent?: BoostIdentityIntent;
  name?: string;
}) {
  const profileId = normalizeBoostId(id);
  if (!profileId) {
    throw new Error("Choose a confirmed ProofOfWork ID.");
  }
  const profile = {
    id: profileId,
    name: name?.trim() || `${profileId}@proofofwork.me`,
    profileId,
    ...(intent
      ? {
          intent: {
            address: intent.address,
            createdAt: intent.createdAt,
            message: intent.message,
            network: intent.network,
            signature: intent.signature,
          },
        }
      : {}),
  };
  return `${BOOST_PROTOCOL_PREFIX}profile:${encodeTextBase64Url(JSON.stringify(profile))}`;
}

export function boostIdentityIntentMessage({
  address,
  createdAt = new Date().toISOString(),
  id,
  network,
}: {
  address: string;
  createdAt?: string;
  id: string;
  network: BitcoinNetwork;
}) {
  return [
    "ProofOfWork.Me Boost profile intent",
    `network:${network}`,
    `address:${address.trim()}`,
    `id:${normalizeBoostId(id)}@proofofwork.me`,
    `createdAt:${createdAt}`,
  ].join("\n");
}

function profileIntentMap() {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(BOOST_PROFILE_INTENT_STORAGE_KEY) ?? "{}",
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, BoostIdentityIntent>)
      : {};
  } catch {
    return {};
  }
}

function profileIntentKey(address: string, network: BitcoinNetwork) {
  return `${network}:${address.trim().toLowerCase()}`;
}

export function loadBoostIdentityIntent(
  address: string,
  network: BitcoinNetwork,
) {
  return profileIntentMap()[profileIntentKey(address, network)];
}

export function saveBoostIdentityIntent(intent: BoostIdentityIntent) {
  if (typeof window === "undefined") {
    return;
  }
  const next = {
    ...profileIntentMap(),
    [profileIntentKey(intent.address, intent.network)]: intent,
  };
  window.localStorage.setItem(
    BOOST_PROFILE_INTENT_STORAGE_KEY,
    JSON.stringify(next),
  );
}

export function idsOwnedByAddress(
  records: PowIdRecordLike[],
  address: string,
  network: BitcoinNetwork,
) {
  const normalizedAddress = address.trim().toLowerCase();
  if (!normalizedAddress) {
    return [];
  }
  return records
    .filter(
      (record) =>
        record.confirmed !== false &&
        normalizeBoostId(record.id) &&
        record.ownerAddress.trim().toLowerCase() === normalizedAddress &&
        (!record.network || record.network === network),
    )
    .sort((left, right) =>
      normalizeBoostId(left.id).localeCompare(normalizeBoostId(right.id)),
    );
}

export function boostRouteHref(
  baseHref: string,
  params: Record<string, string | undefined>,
) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value?.trim()) {
      searchParams.set(key, value.trim());
    }
  }
  const query = searchParams.toString();
  if (!query) {
    return baseHref;
  }
  return `${baseHref}${baseHref.includes("?") ? "&" : "?"}${query}`;
}

export function boostProfileRouteValue(item: BoostFeedItem) {
  return (
    item.authorId ||
    item.profile?.id ||
    item.authorAddress ||
    item.currentOwnerId ||
    item.currentOwnerAddress ||
    ""
  ).trim();
}

export function boostItemTxid(item: BoostFeedItem) {
  return normalizeBoostTxid(item.boostTxid || item.txid);
}

export function boostListingForItem(item: BoostFeedItem) {
  const priceSats = Math.max(
    0,
    Math.floor(Number(item.listingPriceSats ?? item.listing?.priceSats ?? 0)),
  );
  const listingId = normalizeBoostTxid(item.listing?.listingTxid ?? "");
  return priceSats > 0 && listingId
    ? {
        listingId,
        priceSats,
        sellerAddress: item.listing?.sellerAddress ?? item.currentOwnerAddress ?? "",
      }
    : null;
}

export function boostMarketplaceListingsFromItems(
  items: BoostFeedItem[],
): BoostMarketplaceListing[] {
  return items.flatMap((item) => {
    const listing = boostListingForItem(item);
    const boostTxid = boostItemTxid(item);
    if (!listing || !boostTxid) {
      return [];
    }
    return [
      {
        boostTxid,
        confirmed: item.confirmed !== false,
        createdAt: item.createdAt,
        listingId: listing.listingId,
        network: item.network ?? "livenet",
        priceSats: listing.priceSats,
        sellerAddress: listing.sellerAddress,
        text: item.text,
        txid: item.txid,
      },
    ];
  });
}

export function boostListingAnchorOutpoints(items: BoostFeedItem[]) {
  return boostMarketplaceListingsFromItems(items).map((listing) => ({
    txid: listing.listingId,
    vout: BOOST_LISTING_ANCHOR_VOUT,
  }));
}
