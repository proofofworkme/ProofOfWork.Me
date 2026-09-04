import {
  FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Buffer } from "buffer";
import {
  ArrowUpRight,
  Heart,
  MessageCircle,
  RefreshCw,
  Repeat2,
  Search,
  Send,
  Share2,
  ShoppingBag,
  SlidersHorizontal,
  Tag,
  UserMinus,
  UserPlus,
  UserCircle,
  X,
  Zap,
} from "lucide-react";
import {
  COMPUTER_APP_URL,
  ID_APP_URL,
  LOCAL_COMPUTER_APP_URL,
  LOCAL_ID_APP_URL,
  LOCAL_MARKETPLACE_APP_URL,
  MARKETPLACE_APP_URL,
} from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { explorerTxUrl } from "../../shared/bitcoin/networks";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { AppHeader } from "../../shared/components/AppHeader";
import {
  AppStatusRow,
  type AppStatusState,
} from "../../shared/components/AppStatusRow";
import { SocialFooter } from "../../shared/components/SocialFooter";
import { formatDate, shortAddress } from "../../functions";
import {
  formatWorkAmount,
  workAtomsFromDecimal,
  workSubatomsFromCanonicalString,
} from "../../workAmount";
import {
  BOOST_ACTION_REGISTRY_FEE_SATS,
  BOOST_LISTING_ANCHOR_VALUE_SATS,
  boostIdentityIntentMessage,
  boostItemTxid,
  boostListingAnchorOutpoints,
  boostListingForItem,
  boostMarketplaceListingsFromItems,
  boostPostText,
  boostProfileRouteValue,
  boostRouteHref,
  boostSaleAuthorizationDraft,
  buildBoostActionPayload,
  buildBoostFollowPayload,
  buildBoostListingPayload,
  buildBoostProfilePayload,
  buildBoostReplyPayload,
  idsOwnedByAddress,
  loadBoostIdentityIntent,
  normalizeBoostId,
  saveBoostIdentityIntent,
  type BoostFeedItem,
  type BoostFeedPayload,
  type BoostFollowAction,
  type BoostIdentityIntent,
  type BoostPaidAction,
  type BoostProfileTab,
  type BoostTimelineMode,
  type PowIdRecordLike,
} from "./boostProtocol";
import {
  assertActiveWalletAddress,
  buildBoostPaymentPsbt,
  dataCarrierBytesForPayload,
  ensureWalletNetwork,
  fetchReservedAmoAnchorOutpoints,
  isValidBitcoinAddress,
  scriptForAddress,
  signAndBroadcastBoostPsbt,
} from "./boostWallet";
import "./boost.css";

type BoostSortMode = "value" | "newest" | "oldest";
type BoostValueWindow = "hour" | "day" | "week" | "all";

type BoostActionBusy =
  | ""
  | "connect"
  | "follow"
  | "identity"
  | "like"
  | "list"
  | "profile"
  | "reboost"
  | "reply"
  | "unfollow";

type RegistryApiPayload = {
  record?: PowIdRecordLike | null;
  records?: PowIdRecordLike[];
};

type BoostRootProps = {
  embedded?: boolean;
  initialAddress?: string;
  initialNetwork?: BitcoinNetwork;
  onComposeBoost?: () => void;
};

const VALUE_WINDOWS: Array<{ label: string; value: BoostValueWindow }> = [
  { label: "Hour", value: "hour" },
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "All", value: "all" },
];

const SORT_MODES: Array<{ label: string; value: BoostSortMode }> = [
  { label: "Value", value: "value" },
  { label: "Newest", value: "newest" },
  { label: "Oldest", value: "oldest" },
];

const TIMELINE_MODES: Array<{ label: string; value: BoostTimelineMode }> = [
  { label: "For You", value: "all" },
  { label: "Following", value: "following" },
];

const PROFILE_TABS: Array<{ label: string; value: BoostProfileTab }> = [
  { label: "Boosts", value: "boosts" },
  { label: "Replies", value: "replies" },
  { label: "Purchased", value: "purchased" },
  { label: "Likes", value: "likes" },
  { label: "Replies To", value: "replies-to" },
];

const DEFAULT_FEE_RATE = 1;
const DEFAULT_LIST_PRICE_SATS = 1_000;

function initialSearchParam(name: string) {
  if (typeof window === "undefined") {
    return "";
  }
  return new URLSearchParams(window.location.search).get(name)?.trim() ?? "";
}

function initialProfileTab(): BoostProfileTab {
  const tab = initialSearchParam("profileTab").toLowerCase();
  return PROFILE_TABS.some((option) => option.value === tab)
    ? (tab as BoostProfileTab)
    : "boosts";
}

function formatProofs(value: number | string | undefined) {
  const proofs = Number(value ?? 0);
  if (!Number.isFinite(proofs) || proofs <= 0) {
    return "0 proofs";
  }
  const wholeProofs = Math.trunc(proofs);
  const whole = Math.abs(proofs - wholeProofs) < Number.EPSILON;
  return `${proofs.toLocaleString(undefined, {
    maximumFractionDigits: whole ? 0 : 8,
    minimumFractionDigits: 0,
  })} proofs`;
}

function formatUsd(value: number | undefined) {
  const usd = Number(value);
  if (!Number.isFinite(usd) || usd <= 0) {
    return "$0.00";
  }
  return usd.toLocaleString(undefined, {
    currency: "USD",
    maximumFractionDigits: usd >= 1 ? 2 : 6,
    minimumFractionDigits: 2,
    style: "currency",
  });
}

function boostOwnerAddress(item: BoostFeedItem) {
  return (item.currentOwnerAddress || item.authorAddress || "").trim();
}

function boostAuthorAddress(item: BoostFeedItem) {
  return item.authorAddress.trim();
}

function boostAuthorId(item: BoostFeedItem) {
  return normalizeBoostId(item.authorId || item.profile?.id || "");
}

function boostAuthorAddressKey(item: BoostFeedItem) {
  return boostAuthorAddress(item).toLowerCase();
}

function boostTotalSignalSats(item: BoostFeedItem) {
  const total = Number(item.totalSignalSats ?? item.signalSats);
  return Number.isFinite(total) ? Math.max(0, total) : item.proofSignalSats;
}

function boostProofSignalSats(item: BoostFeedItem) {
  const signal = Number(item.proofSignalSats);
  return Number.isFinite(signal) ? Math.max(0, signal) : 0;
}

function boostTotalSignalUsd(item: BoostFeedItem) {
  const total = Number(item.totalSignalUsd ?? item.signalUsd);
  return Number.isFinite(total) ? Math.max(0, total) : 0;
}

function boostWorkSignalValueSats(item: BoostFeedItem) {
  const value = Number(item.workSignalValueSats);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function boostWorkSignalSubatoms(item: BoostFeedItem) {
  const subatoms = workSubatomsFromCanonicalString(item.workSignalSubatoms);
  if (subatoms !== null) {
    return subatoms;
  }
  return workAtomsFromDecimal(item.workSignal ?? "") ?? 0n;
}

function formatWorkSignal(subatoms: bigint) {
  return subatoms > 0n ? `${formatWorkAmount(subatoms, true)} WORK` : "0 WORK";
}

function authorLabel(
  item: BoostFeedItem,
  activeIdentity: BoostIdentityIntent | undefined,
  activeAddress: string,
) {
  const activeWalletOwnsPost =
    activeIdentity &&
    activeAddress &&
    item.authorAddress.trim().toLowerCase() ===
      activeAddress.trim().toLowerCase();
  if (activeWalletOwnsPost) {
    return `${activeIdentity.id}@proofofwork.me`;
  }
  return item.authorId || item.profile?.id
    ? `${item.authorId ?? item.profile?.id}@proofofwork.me`
    : shortAddress(item.authorAddress);
}

function ownerLabel(item: BoostFeedItem) {
  return item.currentOwnerId
    ? `${item.currentOwnerId}@proofofwork.me`
    : item.currentOwnerAddress
      ? shortAddress(item.currentOwnerAddress)
      : item.authorId || item.profile?.id
        ? `${item.authorId ?? item.profile?.id}@proofofwork.me`
        : shortAddress(item.authorAddress);
}

function followerLabel(count: number | undefined) {
  const total = Number(count ?? 0);
  return `${Number.isFinite(total) ? Math.max(0, total).toLocaleString() : "0"} follower${
    total === 1 ? "" : "s"
  }`;
}

function followingLabel(count: number | undefined) {
  const total = Number(count ?? 0);
  return `${Number.isFinite(total) ? Math.max(0, total).toLocaleString() : "0"} following`;
}

function profileSubjectDisplay(payload: BoostFeedPayload | undefined) {
  return (
    payload?.profileSubject?.displayName ||
    payload?.profileSubject?.id ||
    payload?.profileSubject?.address ||
    payload?.profile ||
    "Boost profile"
  );
}

function profileSubjectHandle(payload: BoostFeedPayload | undefined) {
  const subject = payload?.profileSubject;
  if (!subject) {
    return "";
  }
  return subject.id
    ? `@${subject.id}`
    : subject.address
      ? `@${shortAddress(subject.address)}`
      : "";
}

function profileSubjectAvatarText(payload: BoostFeedPayload | undefined) {
  return profileSubjectDisplay(payload).slice(0, 2).toUpperCase();
}

function profileEmptyTitle(tab: BoostProfileTab) {
  return {
    boosts: "No profile boosts yet",
    likes: "No liked boosts yet",
    purchased: "No purchased boosts yet",
    replies: "No profile replies yet",
    "replies-to": "No replies to this profile yet",
  }[tab];
}

function boostProfileHref(value: string) {
  return boostRouteHref("/", { boost: "1", profile: value });
}

function boostAmoHref(boostTxid?: string) {
  return boostRouteHref(
    appHref(MARKETPLACE_APP_URL, LOCAL_MARKETPLACE_APP_URL),
    { boost: boostTxid, tab: "boosts" },
  );
}

function boostShareUrl(item: BoostFeedItem, network: BitcoinNetwork) {
  const postText = item.text.trim();
  const txLink = explorerTxUrl(item.txid, network);
  const text = [postText, txLink, "$WORK $POWB $INCB"]
    .filter(Boolean)
    .join("\n");
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

function actionLabel(kind: string) {
  const normalized = kind.replace(/^boost-/u, "");
  if (normalized === "repost") return "reboost";
  return normalized || "post";
}

function avatarText(item: BoostFeedItem) {
  const label = item.authorId || item.profile?.id || item.authorAddress || "Boost";
  return label.slice(0, 2).toUpperCase();
}

function moveBoostTabFocus(event: KeyboardEvent<HTMLButtonElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    return;
  }

  const tablist = event.currentTarget.closest<HTMLElement>("[role='tablist']");
  const tabs = Array.from(
    tablist?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? [],
  );
  const currentIndex = tabs.indexOf(event.currentTarget);
  if (currentIndex < 0 || tabs.length === 0) {
    return;
  }

  event.preventDefault();
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

function confirmDustFeeAbsorption({
  dustFeeSats,
  feeRate,
  feeSats,
}: {
  dustFeeSats?: number;
  feeRate: number;
  feeSats: number;
}) {
  const extraFeeSats = Math.max(0, Math.floor(dustFeeSats ?? 0));
  if (extraFeeSats <= 0) {
    return true;
  }
  return window.confirm(
    [
      `${extraFeeSats.toLocaleString()} proofs of below-dust change will be added to the miner fee.`,
      `Selected fee rate: ${feeRate} sat/vB.`,
      `Estimated fee: ${feeSats.toLocaleString()} proofs.`,
      "Use a larger confirmed UTXO or batch payments to avoid this. Continue signing?",
    ].join("\n\n"),
  );
}

function BoostAvatar({ item }: { item: BoostFeedItem }) {
  const imageUrl = item.profile?.image?.url;
  if (imageUrl) {
    return (
      <img alt="" className="boost-avatar" loading="lazy" src={imageUrl} />
    );
  }

  return (
    <div className="boost-avatar boost-avatar-fallback" aria-hidden="true">
      {avatarText(item)}
    </div>
  );
}

function BoostPost({
  actionBusy,
  activeAddress,
  activeIdentity,
  item,
  network,
  onFollow,
  onLike,
  onList,
  onReboost,
  onReply,
}: {
  actionBusy: BoostActionBusy;
  activeAddress: string;
  activeIdentity?: BoostIdentityIntent;
  item: BoostFeedItem;
  network: BitcoinNetwork;
  onFollow: (action: BoostFollowAction, item: BoostFeedItem) => void;
  onLike: (item: BoostFeedItem) => void;
  onList: (item: BoostFeedItem) => void;
  onReboost: (item: BoostFeedItem) => void;
  onReply: (item: BoostFeedItem) => void;
}) {
  const txHref = explorerTxUrl(item.txid, network);
  const shareHref = boostShareUrl(item, network);
  const profileValue = boostProfileRouteValue(item);
  const boostTxid = boostItemTxid(item);
  const listing = boostListingForItem(item);
  const ownerAddress = boostOwnerAddress(item);
  const authorAddress = boostAuthorAddress(item);
  const authorId = boostAuthorId(item);
  const totalSignalSats = boostTotalSignalSats(item);
  const workSignalValueSats = boostWorkSignalValueSats(item);
  const workSignalSubatoms = boostWorkSignalSubatoms(item);
  const connectedOwner =
    activeAddress &&
    ownerAddress &&
      activeAddress.trim().toLowerCase() === ownerAddress.trim().toLowerCase();
  const connectedAuthor =
    activeAddress &&
    authorAddress &&
    activeAddress.trim().toLowerCase() === authorAddress.toLowerCase();
  const actionsLocked = Boolean(actionBusy);
  const followAction: BoostFollowAction = item.viewerFollowsAuthor
    ? "unfollow"
    : "follow";
  const FollowIcon = followAction === "follow" ? UserPlus : UserMinus;

  return (
    <article className="boost-post">
      <BoostAvatar item={item} />
      <div className="boost-post-body">
        <div className="boost-post-head">
          <div className="boost-author-line">
            {profileValue ? (
              <a className="boost-author" href={boostProfileHref(profileValue)}>
                {authorLabel(item, activeIdentity, activeAddress)}
              </a>
            ) : (
              <span className="boost-author">
                {authorLabel(item, activeIdentity, activeAddress)}
              </span>
            )}
            <span>@{authorId || shortAddress(authorAddress)}</span>
            <span>{formatDate(item.createdAt)}</span>
          </div>
          <div className="boost-post-head-actions">
            <strong>{formatProofs(totalSignalSats)}</strong>
            {!connectedAuthor && authorAddress ? (
              <button
                className="secondary small boost-follow-button"
                disabled={actionsLocked}
                onClick={() => onFollow(followAction, item)}
                title={
                  followAction === "follow"
                    ? "Follow with proof signal"
                    : "Unfollow with Boost registry fee"
                }
                type="button"
              >
                <span className="button-content">
                  <FollowIcon size={15} />
                  <span>{followAction === "follow" ? "Follow" : "Unfollow"}</span>
                </span>
              </button>
            ) : null}
          </div>
        </div>

        {item.text ? <p className="boost-post-text">{item.text}</p> : null}

        <a
          className="boost-proof-frame"
          href={txHref}
          rel="noreferrer"
          target="_blank"
        >
          <div>
            <span>ProofFrame</span>
            <strong>{item.media?.name ?? "Boost proof record"}</strong>
          </div>
          <p>
            {item.media?.mime
              ? `${item.media.mime} · ${shortAddress(item.media.sha256 ?? boostTxid)}`
              : `pwb1 · ${shortAddress(boostTxid || item.txid)} · Owner ${ownerLabel(item)}`}
          </p>
        </a>

        <div className="boost-signal-row">
          <span>Total USD {formatUsd(boostTotalSignalUsd(item))}</span>
          <span>Proof {formatProofs(boostProofSignalSats(item))}</span>
          {workSignalSubatoms > 0n ? (
            <span>
              WORK {formatWorkAmount(workSignalSubatoms, true)}{" "}
              {`(${formatProofs(workSignalValueSats)})`}
            </span>
          ) : null}
          <span>{actionLabel(item.kind)}</span>
          <span>Owner {ownerLabel(item)}</span>
          <span>{followerLabel(item.followerCount)}</span>
        </div>

        <div className="boost-actions">
          <button
            className="secondary small"
            disabled={actionsLocked}
            onClick={() => onReply(item)}
            title="Reply with 546-proof Boost action"
            type="button"
          >
            <span className="button-content">
              <MessageCircle size={15} />
              <span>{item.replyCount ?? 0}</span>
            </span>
          </button>
          <button
            className="secondary small"
            disabled={actionsLocked}
            onClick={() => onLike(item)}
            title="Like with 546-proof Boost action"
            type="button"
          >
            <span className="button-content">
              <Heart size={15} />
              <span>{item.likeCount ?? 0}</span>
            </span>
          </button>
          <button
            className="secondary small"
            disabled={actionsLocked}
            onClick={() => onReboost(item)}
            title="Reboost with 546-proof Boost action"
            type="button"
          >
            <span className="button-content">
              <Repeat2 size={15} />
              <span>{item.reboostCount ?? 0}</span>
            </span>
          </button>
          {listing ? (
            <a
              className="secondary small link-button"
              href={boostAmoHref(boostTxid)}
            >
              <span className="button-content">
                <ShoppingBag size={15} />
                <span>{formatProofs(listing.priceSats)}</span>
              </span>
            </a>
          ) : connectedOwner ? (
            <button
              className="secondary small"
              disabled={actionsLocked}
              onClick={() => onList(item)}
              title="List this Boost in AMO"
              type="button"
            >
              <span className="button-content">
                <Tag size={15} />
                <span>List</span>
              </span>
            </button>
          ) : null}
          <a
            className="secondary small link-button"
            href={shareHref}
            rel="noreferrer"
            target="_blank"
          >
            <span className="button-content">
              <Share2 size={15} />
              <span>Share</span>
            </span>
          </a>
          <a
            className="secondary small link-button"
            href={txHref}
            rel="noreferrer"
            target="_blank"
          >
            <span className="button-content">
              <ArrowUpRight size={15} />
              <span>TX</span>
            </span>
          </a>
        </div>
      </div>
    </article>
  );
}

export default function BoostRoot({
  embedded = false,
  initialAddress = "",
  initialNetwork = "livenet",
  onComposeBoost,
}: BoostRootProps = {}) {
  const [network, setNetwork] = useState<BitcoinNetwork>(initialNetwork);
  const [sortMode, setSortMode] = useState<BoostSortMode>("value");
  const [valueWindow, setValueWindow] = useState<BoostValueWindow>("all");
  const [timelineMode, setTimelineMode] =
    useState<BoostTimelineMode>("all");
  const [profileRouteValue] = useState(() => initialSearchParam("profile"));
  const [profileLookup, setProfileLookup] = useState(profileRouteValue);
  const [profileTab, setProfileTab] =
    useState<BoostProfileTab>(initialProfileTab);
  const [listQuery] = useState(() => initialSearchParam("list"));
  const [searchQuery, setSearchQuery] = useState("");
  const [payload, setPayload] = useState<BoostFeedPayload | undefined>();
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<BoostActionBusy>("");
  const [hasUnisat, setHasUnisat] = useState(() => Boolean(window.unisat));
  const [address, setAddress] = useState(initialAddress);
  const [boostRegistryAddress, setBoostRegistryAddress] = useState("");
  const [ownedIds, setOwnedIds] = useState<PowIdRecordLike[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState("");
  const [activeIdentity, setActiveIdentity] = useState<
    BoostIdentityIntent | undefined
  >();
  const [replyTarget, setReplyTarget] = useState<BoostFeedItem | undefined>();
  const [replyText, setReplyText] = useState("");
  const [listingTarget, setListingTarget] = useState<
    BoostFeedItem | undefined
  >();
  const [listingPriceSats, setListingPriceSats] = useState(
    DEFAULT_LIST_PRICE_SATS,
  );
  const [feeRate, setFeeRate] = useState(DEFAULT_FEE_RATE);
  const [toolsOpen, setToolsOpen] = useState(false);
  const boostSurfaceRef = useRef<HTMLDivElement>(null);
  const toolsPanelRef = useRef<HTMLElement>(null);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);
  const toolsInvokerRef = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<AppStatusState>({
    tone: "idle",
    text: "",
  });

  const items = useMemo(() => payload?.items ?? [], [payload]);
  const activeMarketListings = useMemo(
    () => boostMarketplaceListingsFromItems(items),
    [items],
  );
  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return items;
    }
    return items.filter((item) =>
      [
        item.text,
        item.authorId,
        item.profile?.id,
        item.authorAddress,
        item.currentOwnerId,
        item.currentOwnerAddress,
        item.txid,
        item.boostTxid,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [items, searchQuery]);
  const suggestedProfiles = useMemo(() => {
    const activeAddress = address.trim().toLowerCase();
    const byAddress = new Map<string, BoostFeedItem>();
    for (const item of items) {
      const authorAddress = boostAuthorAddress(item);
      const key = authorAddress.toLowerCase();
      if (!key || key === activeAddress || item.viewerFollowsAuthor) {
        continue;
      }
      const current = byAddress.get(key);
      if (
        !current ||
        Number(item.followerCount ?? 0) > Number(current.followerCount ?? 0)
      ) {
        byAddress.set(key, item);
      }
    }
    return [...byAddress.values()].slice(0, 4);
  }, [address, items]);
  const topSignalItems = useMemo(() => visibleItems.slice(0, 3), [visibleItems]);
  const isProfileView = Boolean(profileRouteValue.trim());
  const profileSubject = payload?.profileSubject;
  const profileSubjectAddress = profileSubject?.address ?? "";
  const profileSubjectId = normalizeBoostId(profileSubject?.id ?? "");
  const profileSelfView = Boolean(
    address.trim() &&
    profileSubjectAddress.trim() &&
      address.trim().toLowerCase() ===
        profileSubjectAddress.trim().toLowerCase(),
  );
  const profileFollowAction: BoostFollowAction = profileSubject?.viewerFollowsProfile
    ? "unfollow"
    : "follow";
  const profileWorkSignalSubatoms =
    workSubatomsFromCanonicalString(profileSubject?.workSignalSubatoms) ?? 0n;

  async function loadBoostRegistryAndIds(walletAddress: string) {
    const [boostPayload, registryPayload] = await Promise.all([
      fetchProofApiJson<RegistryApiPayload>(
        "/api/v1/ids/boost?current=1&fresh=1",
        "livenet",
      ).catch(() => null),
      fetchProofApiJson<RegistryApiPayload>(
        "/api/v1/registry?fresh=1",
        "livenet",
      ),
    ]);
    const boostRecord =
      boostPayload?.record ??
      registryPayload.records?.find(
        (record) => normalizeBoostId(record.id) === "boost",
      );
    const registryReceiveAddress =
      boostRecord?.receiveAddress || boostRecord?.ownerAddress || "";
    setBoostRegistryAddress(registryReceiveAddress);
    const owned = idsOwnedByAddress(
      registryPayload.records ?? [],
      walletAddress,
      "livenet",
    );
    setOwnedIds(owned);
    const storedIdentity = loadBoostIdentityIntent(walletAddress, "livenet");
    setActiveIdentity(storedIdentity);
    setSelectedIdentityId(
      storedIdentity?.id || normalizeBoostId(owned[0]?.id ?? ""),
    );
    return registryReceiveAddress;
  }

  async function connectWallet() {
    if (!window.unisat) {
      setHasUnisat(false);
      setStatus({ tone: "bad", text: "UniSat is not installed." });
      return "";
    }

    setActionBusy("connect");
    setStatus({ tone: "idle", text: "Opening UniSat..." });
    try {
      const accounts = window.unisat.requestAccounts
        ? await window.unisat.requestAccounts()
        : await window.unisat.getAccounts?.();
      const firstAddress = accounts?.[0] ?? "";
      if (!firstAddress) {
        throw new Error("UniSat did not return an address.");
      }
      const verifiedAddress = await ensureWalletNetwork(
        window.unisat,
        "livenet",
        firstAddress,
      );
      setAddress(verifiedAddress);
      setNetwork("livenet");
      const registryAddress = await loadBoostRegistryAndIds(verifiedAddress);
      setStatus({
        tone: registryAddress ? "good" : "idle",
        text: registryAddress
          ? `${shortAddress(verifiedAddress)} connected. Boost actions ready.`
          : `${shortAddress(verifiedAddress)} connected. boost@proofofwork.me is not confirmed yet.`,
      });
      return verifiedAddress;
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : "Could not connect UniSat.",
      });
      return "";
    } finally {
      setActionBusy("");
    }
  }

  function disconnectWallet() {
    setAddress("");
    setOwnedIds([]);
    setActiveIdentity(undefined);
    setSelectedIdentityId("");
    setStatus({ tone: "idle", text: "Wallet disconnected." });
  }

  async function ensureBoostWriterReady() {
    if (!window.unisat) {
      setHasUnisat(false);
      throw new Error("Install UniSat before signing Boost actions.");
    }
    let writerAddress = address;
    if (!writerAddress) {
      writerAddress = await connectWallet();
    }
    if (!writerAddress) {
      throw new Error("Connect UniSat before signing Boost actions.");
    }
    if (!window.unisat.signPsbt) {
      throw new Error("UniSat signPsbt is not available.");
    }
    await ensureWalletNetwork(window.unisat, "livenet", writerAddress);
    setNetwork("livenet");
    let registryAddress = boostRegistryAddress;
    if (!registryAddress) {
      registryAddress = await loadBoostRegistryAndIds(writerAddress);
    }
    if (!registryAddress) {
      throw new Error(
        "boost@proofofwork.me does not have a confirmed receiver yet.",
      );
    }
    return { registryAddress, walletAddress: writerAddress };
  }

  async function broadcastBoostPayload({
    action,
    paymentLabel,
    payments,
    postProtocolPayments,
    protocolPayload,
    walletAddress,
  }: {
    action: BoostActionBusy;
    paymentLabel: string;
    payments: Array<{ address: string; amountSats: number }>;
    postProtocolPayments?: Array<{ address: string; amountSats: number }>;
    protocolPayload: string;
    walletAddress: string;
  }) {
    setActionBusy(action);
    setStatus({ tone: "idle", text: `Preparing ${paymentLabel}...` });
    try {
      const reservedOutpoints = await fetchReservedAmoAnchorOutpoints(
        walletAddress,
        "livenet",
        boostListingAnchorOutpoints(items),
      );
      const paymentPsbt = await buildBoostPaymentPsbt({
        excludeOutpoints: reservedOutpoints,
        feeRate,
        fromAddress: walletAddress,
        network: "livenet",
        payments,
        postProtocolPayments,
        protocolPayloads: [protocolPayload],
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: "Boost transaction canceled." });
        return;
      }
      await assertActiveWalletAddress(window.unisat!, walletAddress);
      setStatus({
        tone: "idle",
        text: `Waiting for UniSat signature. Fee estimate: ${paymentPsbt.feeSats.toLocaleString()} proofs.`,
      });
      const broadcast = await signAndBroadcastBoostPsbt({
        inputCount: paymentPsbt.inputCount,
        network: "livenet",
        psbtHex: paymentPsbt.psbtHex,
        signInputIndexes: paymentPsbt.walletInputIndexes,
        signingAddress: walletAddress,
        wallet: window.unisat!,
      });
      setStatus({
        links: [
          {
            ariaLabel: "View Boost transaction",
            href: broadcast.url,
            text: "View TX",
            title: "View TX",
          },
        ],
        text: `${paymentLabel} broadcast: ${shortAddress(broadcast.txid)}.`,
        tone: "good",
      });
      void refresh();
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : `${paymentLabel} failed.`,
      });
    } finally {
      setActionBusy("");
    }
  }

  async function publishPaidAction(action: BoostPaidAction, item: BoostFeedItem) {
    const targetTxid = boostItemTxid(item);
    if (!targetTxid) {
      setStatus({ tone: "bad", text: "Boost action target is missing." });
      return;
    }
    const label = action === "like" ? "Boost like" : "Boost reboost";
    try {
      const ready = await ensureBoostWriterReady();
      await broadcastBoostPayload({
        action,
        paymentLabel: label,
        payments: [
          {
            address: ready.registryAddress,
            amountSats: BOOST_ACTION_REGISTRY_FEE_SATS,
          },
        ],
        protocolPayload: buildBoostActionPayload(action, targetTxid),
        walletAddress: ready.walletAddress,
      });
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : `${label} failed.`,
      });
    }
  }

  async function publishFollowTarget(
    action: BoostFollowAction,
    targetAddress: string,
    targetId?: string,
  ) {
    const label = action === "follow" ? "Boost follow" : "Boost unfollow";
    if (!targetAddress || !isValidBitcoinAddress(targetAddress, "livenet")) {
      setStatus({ tone: "bad", text: "Boost follow target is invalid." });
      return;
    }
    if (
      address &&
      targetAddress.trim().toLowerCase() === address.trim().toLowerCase()
    ) {
      setStatus({ tone: "bad", text: "Choose another Boost profile to follow." });
      return;
    }
    try {
      const ready = await ensureBoostWriterReady();
      await broadcastBoostPayload({
        action,
        paymentLabel: label,
        payments: [
          {
            address: ready.registryAddress,
            amountSats: BOOST_ACTION_REGISTRY_FEE_SATS,
          },
          ...(action === "follow"
            ? [
                {
                  address: targetAddress,
                  amountSats: BOOST_ACTION_REGISTRY_FEE_SATS,
                },
              ]
            : []),
        ],
        protocolPayload: buildBoostFollowPayload(action, {
          targetAddress,
          targetId,
        }),
        walletAddress: ready.walletAddress,
      });
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : `${label} failed.`,
      });
    }
  }

  async function publishFollowAction(
    action: BoostFollowAction,
    item: BoostFeedItem,
  ) {
    await publishFollowTarget(action, boostAuthorAddress(item), boostAuthorId(item));
  }

  function openProfileRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextProfile = profileLookup.trim();
    if (!nextProfile) {
      return;
    }
    window.location.href = boostProfileHref(nextProfile);
  }

  function selectProfileTab(nextTab: BoostProfileTab) {
    setProfileTab(nextTab);
    if (!profileRouteValue.trim()) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("boost", "1");
    url.searchParams.set("profile", profileRouteValue.trim());
    url.searchParams.set("profileTab", nextTab);
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  }

  async function publishReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!replyTarget) {
      return;
    }
    try {
      const ready = await ensureBoostWriterReady();
      await broadcastBoostPayload({
        action: "reply",
        paymentLabel: "Boost reply",
        payments: [
          {
            address: ready.registryAddress,
            amountSats: BOOST_ACTION_REGISTRY_FEE_SATS,
          },
        ],
        protocolPayload: buildBoostReplyPayload({
          profileId: activeIdentity?.id,
          targetTxid: boostItemTxid(replyTarget),
          text: replyText,
        }),
        walletAddress: ready.walletAddress,
      });
      setReplyTarget(undefined);
      setReplyText("");
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : "Boost reply failed.",
      });
    }
  }

  async function publishListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!listingTarget) {
      return;
    }
    try {
      const ready = await ensureBoostWriterReady();
      const ownerAddress = boostOwnerAddress(listingTarget);
      if (
        ownerAddress.trim().toLowerCase() !==
        ready.walletAddress.trim().toLowerCase()
      ) {
        throw new Error("Only the current Boost owner can list this Boost.");
      }
      const priceSats = Math.floor(listingPriceSats);
      if (!Number.isSafeInteger(priceSats) || priceSats < 1) {
        throw new Error("Enter a Boost listing price of at least 1 proof.");
      }
      if (!isValidBitcoinAddress(ready.registryAddress, "livenet")) {
        throw new Error("boost@proofofwork.me receiver is not a valid address.");
      }
      const sellerPublicKey =
        (await window.unisat?.getPublicKey?.().catch(() => "")) ?? "";
      const authorization = boostSaleAuthorizationDraft({
        anchorScriptPubKey: Buffer.from(
          scriptForAddress(ready.walletAddress, "livenet", "Boost sale ticket"),
        ).toString("hex"),
        boostTxid: boostItemTxid(listingTarget),
        priceSats,
        sellerAddress: ready.walletAddress,
        sellerPublicKey,
      });
      const protocolPayload = buildBoostListingPayload(authorization);
      if (dataCarrierBytesForPayload(protocolPayload) > 100_000) {
        throw new Error("Boost listing OP_RETURN is over 100 KB.");
      }
      await broadcastBoostPayload({
        action: "list",
        paymentLabel: "Boost listing",
        payments: [
          {
            address: ready.registryAddress,
            amountSats: BOOST_ACTION_REGISTRY_FEE_SATS,
          },
        ],
        postProtocolPayments: [
          {
            address: ready.walletAddress,
            amountSats: BOOST_LISTING_ANCHOR_VALUE_SATS,
          },
        ],
        protocolPayload,
        walletAddress: ready.walletAddress,
      });
      setListingTarget(undefined);
      setListingPriceSats(DEFAULT_LIST_PRICE_SATS);
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : "Boost listing failed.",
      });
    }
  }

  async function signIdentityIntent() {
    if (!window.unisat) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }
    if (!window.unisat.signMessage) {
      setStatus({ tone: "bad", text: "UniSat signMessage is not available." });
      return;
    }
    const profileId = normalizeBoostId(selectedIdentityId);
    if (!profileId) {
      setStatus({ tone: "bad", text: "Choose one confirmed ID." });
      return;
    }
    const ownsSelectedId = ownedIds.some(
      (record) => normalizeBoostId(record.id) === profileId,
    );
    if (!ownsSelectedId) {
      setStatus({
        tone: "bad",
        text: `${profileId}@proofofwork.me is not owned by this wallet.`,
      });
      return;
    }
    setActionBusy("identity");
    try {
      await ensureWalletNetwork(window.unisat, "livenet", address);
      const createdAt = new Date().toISOString();
      const message = boostIdentityIntentMessage({
        address,
        createdAt,
        id: profileId,
        network: "livenet",
      });
      const signature = await window.unisat.signMessage(message);
      const intent = {
        address,
        createdAt,
        id: profileId,
        message,
        network: "livenet" as const,
        signature,
      };
      saveBoostIdentityIntent(intent);
      setActiveIdentity(intent);
      setStatus({
        tone: "good",
        text: `${profileId}@proofofwork.me selected for Boost.`,
      });
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : "ID intent signing failed.",
      });
    } finally {
      setActionBusy("");
    }
  }

  async function publishProfileIntent() {
    if (!activeIdentity) {
      setStatus({ tone: "bad", text: "Sign an ID intent first." });
      return;
    }
    try {
      const ready = await ensureBoostWriterReady();
      await broadcastBoostPayload({
        action: "profile",
        paymentLabel: "Boost profile",
        payments: [
          {
            address: ready.walletAddress,
            amountSats: BOOST_ACTION_REGISTRY_FEE_SATS,
          },
        ],
        protocolPayload: buildBoostProfilePayload({
          id: activeIdentity.id,
          intent: activeIdentity,
        }),
        walletAddress: ready.walletAddress,
      });
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : "Boost profile failed.",
      });
    }
  }

  const refresh = async () => {
    setBusy(true);
    setStatus({ tone: "idle", text: "Refreshing Boost..." });
    try {
      const params = new URLSearchParams({
        limit: "50",
        sort: sortMode,
        window: valueWindow,
      });
      if (address.trim()) {
        params.set("viewer", address.trim());
      }
      if (profileRouteValue.trim()) {
        params.set("profile", profileRouteValue.trim());
        params.set("profileTab", profileTab);
      } else {
        params.set("view", timelineMode);
      }
      const nextPayload = await fetchProofApiJson<BoostFeedPayload>(
        `/api/v1/boost?${params.toString()}`,
        network,
        { timeoutMs: 60_000 },
      );
      setPayload(nextPayload);
      const total = Number(
        nextPayload.totalCount ?? nextPayload.items?.length ?? 0,
      );
      setStatus({
        tone: "good",
        text: `Boost indexed ${total.toLocaleString()} record${total === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : "Boost refresh failed.",
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [
    address,
    network,
    profileRouteValue,
    profileTab,
    sortMode,
    timelineMode,
    valueWindow,
  ]);

  useEffect(() => {
    setNetwork(initialNetwork);
  }, [initialNetwork]);

  useEffect(() => {
    const nextAddress = initialAddress.trim();
    if (!nextAddress || nextAddress === address) {
      return;
    }
    setAddress(nextAddress);
    void loadBoostRegistryAndIds(nextAddress).catch((error) =>
      setStatus({
        tone: "bad",
        text:
          error instanceof Error
            ? error.message
            : "Boost identity state could not be loaded.",
      }),
    );
  }, [initialAddress]);

  useEffect(() => {
    const detectWallet = () => setHasUnisat(Boolean(window.unisat));
    detectWallet();
    const interval = window.setInterval(detectWallet, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!window.unisat?.on) {
      return;
    }
    const syncWallet = () => {
      void (async () => {
        const accounts = await window.unisat?.getAccounts?.().catch(() => []);
        const nextAddress = accounts?.[0] ?? "";
        setAddress(nextAddress);
        if (nextAddress) {
          await loadBoostRegistryAndIds(nextAddress);
        } else {
          setOwnedIds([]);
          setActiveIdentity(undefined);
          setSelectedIdentityId("");
        }
      })().catch((error) =>
        setStatus({
          tone: "bad",
          text:
            error instanceof Error
              ? error.message
              : "Wallet state could not be verified.",
        }),
      );
    };
    window.unisat.on("accountsChanged", syncWallet);
    window.unisat.on("networkChanged", syncWallet);
    window.unisat.on("chainChanged", syncWallet);
    return () => {
      window.unisat?.removeListener?.("accountsChanged", syncWallet);
      window.unisat?.removeListener?.("networkChanged", syncWallet);
      window.unisat?.removeListener?.("chainChanged", syncWallet);
    };
  }, []);

  useEffect(() => {
    if (!listQuery || listingTarget || items.length === 0) {
      return;
    }
    const target = items.find((item) => boostItemTxid(item) === listQuery);
    if (target) {
      setListingTarget(target);
    }
  }, [items, listQuery, listingTarget]);

  useEffect(() => {
    if (!toolsOpen) {
      return;
    }

    const panel = toolsPanelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel
      ?.querySelector<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      )
      ?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setToolsOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panel) {
        return;
      }
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const invoker = toolsInvokerRef.current;
      if (invoker?.isConnected) {
        invoker.focus();
      } else {
        toolsTriggerRef.current?.focus();
      }
      toolsInvokerRef.current = null;
    };
  }, [toolsOpen]);

  useEffect(() => {
    const surface = boostSurfaceRef.current;
    if (!surface) {
      return;
    }

    const closeDesktopDrawer = () => {
      if (surface.getBoundingClientRect().width > 760) {
        setToolsOpen(false);
      }
    };
    closeDesktopDrawer();
    const observer = new ResizeObserver(closeDesktopDrawer);
    observer.observe(surface);
    window.addEventListener("resize", closeDesktopDrawer);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", closeDesktopDrawer);
    };
  }, []);

  const headerSignalStats = useMemo(() => {
    return visibleItems.reduce(
      (totals, item) => ({
        proofSignalSats: totals.proofSignalSats + boostProofSignalSats(item),
        totalSignalSats: totals.totalSignalSats + boostTotalSignalSats(item),
        totalSignalUsd: totals.totalSignalUsd + boostTotalSignalUsd(item),
        workSignalSubatoms:
          totals.workSignalSubatoms + boostWorkSignalSubatoms(item),
      }),
      {
        proofSignalSats: 0,
        totalSignalSats: 0,
        totalSignalUsd: 0,
        workSignalSubatoms: 0n,
      },
    );
  }, [visibleItems]);

  const accountStats = [
    ...(address
      ? [
          {
            label: "Wallet",
            value: shortAddress(address),
            tone: "strong" as const,
          },
        ]
      : []),
    {
      detail: "Proof-equivalent signal from proofs plus attached WORK value.",
      label: "Total Signal",
      value: formatProofs(headerSignalStats.totalSignalSats),
      tone: "strong" as const,
    },
    {
      detail: "Direct proof signal only.",
      label: "Proof Signal",
      value: formatProofs(headerSignalStats.proofSignalSats),
    },
    {
      detail: "Attached WORK signal only.",
      label: "WORK Signal",
      value: formatWorkSignal(headerSignalStats.workSignalSubatoms),
    },
    {
      detail: "Total USD value from proof signal plus attached WORK.",
      label: "Total USD",
      value: formatUsd(headerSignalStats.totalSignalUsd),
    },
    {
      label: "Posts",
      value: visibleItems.length.toLocaleString(),
    },
    {
      label: "Listings",
      value: activeMarketListings.length.toLocaleString(),
    },
  ];

  function openTools() {
    toolsInvokerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setToolsOpen(true);
  }

  function openToolsForCompactSurface() {
    const surfaceWidth = boostSurfaceRef.current?.getBoundingClientRect().width;
    if ((surfaceWidth ?? window.innerWidth) <= 760) {
      openTools();
    }
  }

  return (
    <div
      className={
        embedded
          ? "boost-public-app boost-embedded-app"
          : "mail-app boost-public-app"
      }
      ref={boostSurfaceRef}
    >
      {embedded ? null : (
        <AppHeader
          accountStats={accountStats}
          address={address}
          busy={busy || Boolean(actionBusy)}
          connectWallet={() => void connectWallet()}
          disconnectWallet={disconnectWallet}
          hasUnisat={hasUnisat}
          network={network}
          onNetworkChange={setNetwork}
          onRefresh={() => void refresh()}
          subtitle="Proof-ranked social signal"
          title="Boost"
        />
      )}
      <AppStatusRow persistent status={status} />

      <div
        aria-label={embedded ? undefined : "Boost timeline"}
        className={
          embedded
            ? "boost-shell boost-shell-instrument is-embedded"
            : "boost-shell boost-shell-instrument"
        }
        role={embedded ? undefined : "main"}
      >
        {toolsOpen ? (
          <button
            aria-label="Close Boost tools"
            className="boost-tools-backdrop"
            onClick={() => setToolsOpen(false)}
            type="button"
          />
        ) : null}
        <aside
          aria-label="Boost tools"
          aria-modal={toolsOpen || undefined}
          className={toolsOpen ? "boost-sidebar is-open" : "boost-sidebar"}
          id="boost-tools-panel"
          ref={toolsPanelRef}
          role={toolsOpen ? "dialog" : undefined}
        >
          <div className="boost-sidebar-mobile-head">
            <div>
              <span>Boost controls</span>
              <strong>Identity & discovery</strong>
            </div>
            <button
              aria-label="Close Boost tools"
              className="secondary small"
              onClick={() => setToolsOpen(false)}
              type="button"
            >
              <X size={17} />
            </button>
          </div>
          <div className="boost-compose-panel">
            {onComposeBoost ? (
              <button
                className="primary"
                onClick={onComposeBoost}
                type="button"
              >
                <span className="button-content">
                  <Zap size={16} />
                  <span>Post From Mail</span>
                </span>
              </button>
            ) : (
              <a
                className="primary link-button"
                href={appHref(COMPUTER_APP_URL, LOCAL_COMPUTER_APP_URL)}
              >
                <span className="button-content">
                  <Zap size={16} />
                  <span>Post From Mail</span>
                </span>
              </a>
            )}
            <a
              className="secondary link-button"
              href={appHref(ID_APP_URL, LOCAL_ID_APP_URL)}
            >
              <span className="button-content">
                <UserCircle size={16} />
                <span>Get ID</span>
              </span>
            </a>
          </div>

          <section className="boost-action-panel">
            <div className="boost-action-panel-head">
              <strong>Identity</strong>
              {activeIdentity ? (
                <span>{activeIdentity.id}@proofofwork.me</span>
              ) : null}
            </div>
            {address ? (
              ownedIds.length > 0 ? (
                <>
                  <label>
                    ID
                    <select
                      onChange={(event) =>
                        setSelectedIdentityId(event.target.value)
                      }
                      value={selectedIdentityId}
                    >
                      {ownedIds.map((record) => {
                        const id = normalizeBoostId(record.id);
                        return (
                          <option key={id} value={id}>
                            {id}@proofofwork.me
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <div className="boost-action-buttons">
                    <button
                      className="secondary small"
                      disabled={Boolean(actionBusy) || !selectedIdentityId}
                      onClick={() => void signIdentityIntent()}
                      type="button"
                    >
                      <span className="button-content">
                        <UserCircle size={15} />
                        <span>
                          {actionBusy === "identity" ? "Signing" : "Sign ID"}
                        </span>
                      </span>
                    </button>
                    <button
                      className="secondary small"
                      disabled={Boolean(actionBusy) || !activeIdentity}
                      onClick={() => void publishProfileIntent()}
                      type="button"
                    >
                      <span className="button-content">
                        <Send size={15} />
                        <span>
                          {actionBusy === "profile" ? "Publishing" : "Publish"}
                        </span>
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                <p className="field-note">This wallet has no confirmed IDs.</p>
              )
            ) : (
              <button
                className="secondary small"
                disabled={Boolean(actionBusy)}
                onClick={() => void connectWallet()}
                type="button"
              >
                <span className="button-content">
                  <UserCircle size={15} />
                  <span>Connect</span>
                </span>
              </button>
            )}
          </section>

          {replyTarget ? (
            <form className="boost-action-panel" onSubmit={publishReply}>
              <div className="boost-action-panel-head">
                <strong>Reply</strong>
                <button
                  aria-label="Close reply"
                  className="secondary small"
                  onClick={() => setReplyTarget(undefined)}
                  type="button"
                >
                  <X size={15} />
                </button>
              </div>
              <textarea
                maxLength={140}
                onChange={(event) => setReplyText(event.target.value)}
                placeholder="Reply"
                value={replyText}
              />
              <div className="counter">
                {boostPostText(replyText).length.toLocaleString()} / 140
              </div>
              <button
                className="primary"
                disabled={Boolean(actionBusy) || !replyText.trim()}
                type="submit"
              >
                <span className="button-content">
                  <Send size={15} />
                  <span>{actionBusy === "reply" ? "Replying" : "Reply"}</span>
                </span>
              </button>
            </form>
          ) : null}

          {listingTarget ? (
            <form className="boost-action-panel" onSubmit={publishListing}>
              <div className="boost-action-panel-head">
                <strong>List Boost</strong>
                <button
                  aria-label="Close listing"
                  className="secondary small"
                  onClick={() => setListingTarget(undefined)}
                  type="button"
                >
                  <X size={15} />
                </button>
              </div>
              <label>
                Price proofs
                <input
                  min={1}
                  onChange={(event) =>
                    setListingPriceSats(Number(event.target.value))
                  }
                  step={1}
                  type="number"
                  value={listingPriceSats}
                />
              </label>
              <label>
                Fee sat/vB
                <input
                  min={1}
                  onChange={(event) => setFeeRate(Number(event.target.value))}
                  step={1}
                  type="number"
                  value={feeRate}
                />
              </label>
              <button
                className="primary"
                disabled={Boolean(actionBusy)}
                type="submit"
              >
                <span className="button-content">
                  <Tag size={15} />
                  <span>{actionBusy === "list" ? "Listing" : "List"}</span>
                </span>
              </button>
            </form>
          ) : null}

          <label className="boost-search">
            <Search size={15} />
            <input
              autoComplete="off"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search Boost"
              value={searchQuery}
            />
          </label>

          <form className="boost-profile-filter" onSubmit={openProfileRoute}>
            <label>
              Profile
              <input
                autoComplete="off"
                onChange={(event) => setProfileLookup(event.target.value)}
                placeholder="address or id"
                value={profileLookup}
              />
            </label>
            <button
              className="secondary small"
              disabled={!profileLookup.trim()}
              type="submit"
            >
              <span className="button-content">
                <Search size={15} />
                <span>View</span>
              </span>
            </button>
          </form>

          <a className="secondary link-button" href={boostAmoHref()}>
            <span className="button-content">
              <ShoppingBag size={16} />
              <span>Boost AMO</span>
            </span>
          </a>
        </aside>

        <section className="boost-feed-panel">
          {isProfileView ? (
            <div className="boost-profile-head">
              <div className="boost-profile-cover" />
              <div className="boost-profile-main">
                {profileSubject?.profile?.image?.url ? (
                  <img
                    alt=""
                    className="boost-profile-avatar"
                    loading="lazy"
                    src={profileSubject.profile.image.url}
                  />
                ) : (
                  <div
                    className="boost-profile-avatar boost-avatar-fallback"
                    aria-hidden="true"
                  >
                    {profileSubjectAvatarText(payload)}
                  </div>
                )}
                <div className="boost-profile-copy">
                  <a
                    className="secondary small link-button"
                    href={boostRouteHref("/", { boost: "1" })}
                  >
                    Timeline
                  </a>
                  <h2>{profileSubjectDisplay(payload)}</h2>
                  <p>{profileSubjectHandle(payload) || profileRouteValue}</p>
                  <div className="boost-profile-stats">
                    <span>{followerLabel(profileSubject?.followerCount)}</span>
                    <span>{followingLabel(profileSubject?.followingCount)}</span>
                    <span>{formatProofs(profileSubject?.totalSignalSats)} signal</span>
                    {profileWorkSignalSubatoms > 0n ? (
                      <span>{formatWorkSignal(profileWorkSignalSubatoms)}</span>
                    ) : null}
                  </div>
                </div>
                {!profileSelfView && profileSubjectAddress ? (
                  <button
                    className="secondary small boost-follow-button"
                    disabled={Boolean(actionBusy)}
                    onClick={() =>
                      void publishFollowTarget(
                        profileFollowAction,
                        profileSubjectAddress,
                        profileSubjectId,
                      )
                    }
                    type="button"
                  >
                    <span className="button-content">
                      {profileFollowAction === "follow" ? (
                        <UserPlus size={15} />
                      ) : (
                        <UserMinus size={15} />
                      )}
                      <span>
                        {profileFollowAction === "follow"
                          ? "Follow"
                          : "Unfollow"}
                      </span>
                    </span>
                  </button>
                ) : null}
              </div>
              <div
                className="boost-profile-tabs"
                aria-label="Boost profile tabs"
                role="tablist"
              >
                {PROFILE_TABS.map((option) => (
                  <button
                    aria-controls="boost-profile-panel"
                    aria-selected={profileTab === option.value}
                    id={`boost-profile-tab-${option.value}`}
                    key={option.value}
                    onKeyDown={moveBoostTabFocus}
                    onClick={() => selectProfileTab(option.value)}
                    role="tab"
                    tabIndex={profileTab === option.value ? 0 : -1}
                    type="button"
                  >
                    <span>{option.label}</span>
                    <strong>{payload?.profileTabs?.[option.value] ?? 0}</strong>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="boost-timeline-head">
              <div
                className="boost-timeline-tabs"
                aria-label="Boost timeline"
                role="tablist"
              >
                {TIMELINE_MODES.map((option) => (
                  <button
                    aria-controls="boost-timeline-panel"
                    aria-selected={timelineMode === option.value}
                    id={`boost-timeline-tab-${option.value}`}
                    key={option.value}
                    onKeyDown={moveBoostTabFocus}
                    onClick={() => setTimelineMode(option.value)}
                    role="tab"
                    tabIndex={timelineMode === option.value ? 0 : -1}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="boost-composer-strip">
                <div
                  className="boost-avatar boost-avatar-fallback"
                  aria-hidden="true"
                >
                  {address ? shortAddress(address).slice(0, 2).toUpperCase() : "Po"}
                </div>
                {onComposeBoost ? (
                  <button
                    className="boost-composer-prompt"
                    onClick={onComposeBoost}
                    type="button"
                  >
                    What's happening?
                  </button>
                ) : (
                  <a
                    className="boost-composer-prompt"
                    href={appHref(COMPUTER_APP_URL, LOCAL_COMPUTER_APP_URL)}
                  >
                    What's happening?
                  </a>
                )}
              </div>
            </div>
          )}
          <div className="boost-feed-toolbar">
            <button
              aria-controls="boost-tools-panel"
              aria-expanded={toolsOpen}
              className="secondary small boost-tools-trigger"
              onClick={openTools}
              ref={toolsTriggerRef}
              type="button"
            >
              <span className="button-content">
                <SlidersHorizontal size={15} />
                <span>Tools</span>
              </span>
            </button>
            <div className="network-tabs" aria-label="Boost value window">
              {VALUE_WINDOWS.map((option) => (
                <button
                  aria-pressed={valueWindow === option.value}
                  key={option.value}
                  onClick={() => setValueWindow(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="network-tabs" aria-label="Boost sort">
              {SORT_MODES.map((option) => (
                <button
                  aria-pressed={sortMode === option.value}
                  key={option.value}
                  onClick={() => setSortMode(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              className="secondary small"
              disabled={busy}
              onClick={() => void refresh()}
              type="button"
            >
              <span className="button-content">
                <RefreshCw className={busy ? "refresh-spin" : ""} size={15} />
                <span>{busy ? "Refreshing" : "Refresh"}</span>
              </span>
            </button>
          </div>

          <div
            aria-labelledby={
              isProfileView
                ? `boost-profile-tab-${profileTab}`
                : `boost-timeline-tab-${timelineMode}`
            }
            className="boost-feed"
            id={isProfileView ? "boost-profile-panel" : "boost-timeline-panel"}
            role="tabpanel"
            tabIndex={0}
          >
            {visibleItems.length > 0 ? (
              visibleItems.map((item) => (
                <BoostPost
                  actionBusy={actionBusy}
                  activeAddress={address}
                  activeIdentity={activeIdentity}
                  item={item}
                  key={`${item.kind}-${item.txid}`}
                  network={network}
                  onFollow={(followAction, boostItem) =>
                    void publishFollowAction(followAction, boostItem)
                  }
                  onLike={(boostItem) =>
                    void publishPaidAction("like", boostItem)
                  }
                  onList={(boostItem) => {
                    setListingTarget(boostItem);
                    openToolsForCompactSurface();
                  }}
                  onReboost={(boostItem) =>
                    void publishPaidAction("reboost", boostItem)
                  }
                  onReply={(boostItem) => {
                    setReplyTarget(boostItem);
                    setReplyText("");
                    openToolsForCompactSurface();
                  }}
                />
              ))
            ) : (
              <div className="boost-empty">
                <Zap size={28} />
                <h2>
                  {isProfileView
                    ? profileEmptyTitle(profileTab)
                    : timelineMode === "following"
                    ? address
                      ? "No followed Boosts yet"
                      : "Connect to load Following"
                    : "No confirmed Boost posts indexed yet"}
                </h2>
              </div>
            )}
          </div>
        </section>

        <aside className="boost-right-rail" aria-label="Boost discovery">
          <section className="boost-rail-panel">
            <div className="boost-rail-head">
              <strong>{isProfileView ? "Profile Signal" : "Signal Now"}</strong>
              <span>{formatDate(payload?.indexedAt ?? new Date().toISOString())}</span>
            </div>
            <div className="boost-rail-stats">
              <span>
                <strong>
                  {formatProofs(
                    isProfileView
                      ? profileSubject?.totalSignalSats
                      : headerSignalStats.totalSignalSats,
                  )}
                </strong>
                Total
              </span>
              <span>
                <strong>
                  {formatProofs(
                    isProfileView
                      ? profileSubject?.proofSignalSats
                      : headerSignalStats.proofSignalSats,
                  )}
                </strong>
                Proof
              </span>
              <span>
                <strong>
                  {isProfileView
                    ? (profileSubject?.followerCount ?? 0)
                    : (payload?.graph?.followingCount ?? 0)}
                </strong>
                {isProfileView ? "Followers" : "Following"}
              </span>
            </div>
          </section>

          <section className="boost-rail-panel">
            <div className="boost-rail-head">
              <strong>Top Boosts</strong>
              <a href={boostAmoHref()}>AMO</a>
            </div>
            <div className="boost-rail-list">
              {topSignalItems.length > 0 ? (
                topSignalItems.map((item) => (
                  <a
                    href={explorerTxUrl(item.txid, network)}
                    key={`top-${item.txid}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <strong>{authorLabel(item, activeIdentity, address)}</strong>
                    <span>{formatProofs(boostTotalSignalSats(item))}</span>
                  </a>
                ))
              ) : (
                <span>No Boost signal yet.</span>
              )}
            </div>
          </section>

          <section className="boost-rail-panel">
            <div className="boost-rail-head">
              <strong>Who To Follow</strong>
              <span>{suggestedProfiles.length}</span>
            </div>
            <div className="boost-rail-list">
              {suggestedProfiles.length > 0 ? (
                suggestedProfiles.map((item) => (
                  <button
                    disabled={Boolean(actionBusy)}
                    key={`follow-${boostAuthorAddressKey(item)}`}
                    onClick={() => void publishFollowAction("follow", item)}
                    type="button"
                  >
                    <span>
                      <strong>{authorLabel(item, activeIdentity, address)}</strong>
                      {followerLabel(item.followerCount)}
                    </span>
                    <UserPlus size={15} />
                  </button>
                ))
              ) : (
                <span>Connect and refresh to find active Boost profiles.</span>
              )}
            </div>
          </section>

          {activeMarketListings.length > 0 ? (
            <section className="boost-rail-panel">
              <div className="boost-rail-head">
                <strong>Listed Boosts</strong>
                <span>{activeMarketListings.length}</span>
              </div>
              <div className="boost-rail-list">
                {activeMarketListings.slice(0, 3).map((listing) => (
                  <a
                    href={boostAmoHref(listing.boostTxid)}
                    key={`listing-${listing.listingId}`}
                  >
                    <strong>{shortAddress(listing.boostTxid)}</strong>
                    <span>{formatProofs(listing.priceSats)}</span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {embedded ? null : <SocialFooter compact />}
    </div>
  );
}
