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
  ArrowLeft,
  Clock,
  Heart,
  MessageCircle,
  Paperclip,
  Quote,
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
  ID_APP_URL,
  LOCAL_ID_APP_URL,
  LOCAL_MARKETPLACE_APP_URL,
  MARKETPLACE_APP_URL,
} from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { explorerTxUrl } from "../../shared/bitcoin/networks";
import {
  attachmentFromFile,
  buildAttachmentPayloads,
  MAX_ATTACHMENT_BYTES,
  type MailAttachment,
} from "../../shared/protocol/mailAttachment";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { AppHeader } from "../../shared/components/AppHeader";
import {
  AppStatusRow,
  type AppStatusState,
} from "../../shared/components/AppStatusRow";
import { FeeRateControl } from "../../shared/components/FeeRateControl";
import { SocialFooter } from "../../shared/components/SocialFooter";
import { formatBytes, formatDate, shortAddress } from "../../functions";
import { formatExactDecimal } from "../../exactAmount";
import { boostSignalQ8, formatBoostSignal } from "./boostAmounts";
import { createBoostReadLifecycle } from "./boostReadLifecycle";
import { boostMediaUrl } from "./boostMedia";
import {
  BOOST_WORK_MUTATION_PROOFS,
  BOOST_WORK_REGISTRY_ADDRESS,
  buildBoostWorkSendPayload,
  fetchBoostWorkCapacity,
  requireBoostWorkWriteAdmission,
} from "./boostWorkComposer";
import {
  formatWorkAmount,
  workAtomsFromDecimal,
  workSubatomsFromCanonicalString,
} from "../../workAmount";
import {
  BOOST_ACTION_PAYMENT_SATS,
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
  buildBoostPostPayload,
  buildBoostProfilePayload,
  buildBoostReplyPayload,
  buildBoostTransferPayload,
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
  type BoostSpentOutpoint,
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
  | "post"
  | "reboost"
  | "reply"
  | "transfer"
  | "unfollow";

type PendingBoostPaidAction = {
  action: BoostPaidAction;
  item: BoostFeedItem;
};

type RegistryApiPayload = {
  record?: PowIdRecordLike | null;
  records?: PowIdRecordLike[];
};

type BoostOptimisticAction = {
  likeDelta?: number;
  liked?: boolean;
  reboostDelta?: number;
  reboosted?: boolean;
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
  return `${formatExactDecimal(value ?? 0)} proofs`;
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
  return boostAuthorAddress(item);
}

function boostTotalSignalQ8(item: BoostFeedItem) {
  return boostSignalQ8(item.totalSignalQ8, item.totalSignalSatsExact,
    item.totalSignalSats ?? item.signalSats ?? item.proofSignalSats);
}

function boostProofSignalQ8(item: BoostFeedItem) {
  return boostSignalQ8(item.proofSignalQ8, item.proofSignalSatsExact, item.proofSignalSats);
}

function boostTotalSignalUsd(item: BoostFeedItem) {
  const total = Number(item.totalSignalUsd ?? item.signalUsd);
  return Number.isFinite(total) ? Math.max(0, total) : 0;
}

function boostWorkSignalValueQ8(item: BoostFeedItem) {
  return boostSignalQ8(item.workSignalValueQ8, item.workSignalValueSatsExact, item.workSignalValueSats ?? 0);
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
    item.authorAddress.trim() ===
      activeAddress.trim();
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
  const sharedPost = item.reboostedPost ?? item;
  const postText = sharedPost.text.trim();
  const txLink = explorerTxUrl(sharedPost.txid, network);
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

const BOOST_MEDIA_MAX_CONCURRENT = 4;
let boostMediaActive = 0;
const boostMediaQueue: Array<{
  resolve: (release: () => void) => void;
  reject: (reason?: unknown) => void;
  signal: AbortSignal;
}> = [];

function pumpBoostMediaQueue() {
  while (boostMediaActive < BOOST_MEDIA_MAX_CONCURRENT && boostMediaQueue.length) {
    const next = boostMediaQueue.shift();
    if (!next || next.signal.aborted) {
      next?.reject(next.signal.reason);
      continue;
    }
    boostMediaActive += 1;
    next.resolve(() => {
      boostMediaActive = Math.max(0, boostMediaActive - 1);
      pumpBoostMediaQueue();
    });
  }
}

function acquireBoostMediaSlot(signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<() => void>((resolve, reject) => {
    boostMediaQueue.push({ resolve, reject, signal });
    pumpBoostMediaQueue();
  });
}

function BoostMedia({ item, network }: { item: BoostFeedItem; network: BitcoinNetwork }) {
  const [mediaUrl, setMediaUrl] = useState(
    item.media?.source === "same-tx-pwm1-attachment" ? "" : item.media?.url ?? "",
  );
  const [mediaError, setMediaError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setMediaUrl(item.media?.source === "same-tx-pwm1-attachment" ? "" : item.media?.url ?? "");
    setMediaError(false);
    if (!item.media || !/^(?:image|video)\//iu.test(item.media.mime ?? "") ||
        (item.media.url && item.media.source !== "same-tx-pwm1-attachment")) {
      return () => controller.abort();
    }
    void acquireBoostMediaSlot(controller.signal)
      .then(async (release) => {
        try {
          const payload = await fetchProofApiJson<{ attachment?: {
            data?: string; mime?: string; name?: string; sha256?: string; size?: number;
          } }>(
            `/api/v1/tx/${encodeURIComponent(item.boostTxid || item.txid)}`,
            network,
            { signal: controller.signal, timeoutMs: 30_000 },
          );
          if (!controller.signal.aborted) {
            const url = boostMediaUrl(item.media, payload.attachment);
            if (url) setMediaUrl(url);
            else setMediaError(true);
          }
        } catch {
          if (!controller.signal.aborted) setMediaError(true);
        } finally {
          release();
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [item.boostTxid, item.media?.url, item.media?.mime, item.media?.name,
    item.media?.sha256, item.media?.size, item.media?.source, item.txid, network]);

  if (!mediaUrl || mediaError) return null;
  return item.media?.mime?.toLowerCase().startsWith("video/") ? (
    <video className="boost-post-media" controls preload="metadata" src={mediaUrl} />
  ) : (
    <img className="boost-post-media" alt={item.media?.name || "Boost media"} loading="lazy" src={mediaUrl} />
  );
}

function ReboostedPost({
  network,
  onOpenOriginal,
  post,
}: {
  network: BitcoinNetwork;
  onOpenOriginal: (post: BoostFeedItem) => void;
  post?: BoostFeedItem;
}) {
  if (!post) {
    return (
      <div className="boost-reboosted-post boost-reboosted-post-missing" data-testid="reboosted-post">
        <Repeat2 aria-hidden="true" size={16} />
        <div>
          <strong>Original post unavailable</strong>
          <span>The canonical Boost history has not exposed the referenced post yet.</span>
        </div>
      </div>
    );
  }

  const txHref = explorerTxUrl(post.txid, network);
  const profileValue = boostProfileRouteValue(post);

  return (
    <div
      className="boost-reboosted-post"
      data-testid="reboosted-post"
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("a,button,input,textarea,select")) return;
        event.stopPropagation();
        onOpenOriginal(post);
      }}
    >
      <div className="boost-reboosted-label">
        <Repeat2 aria-hidden="true" size={15} />
        <span>Reboosted post</span>
        <button
          className="secondary small boost-open-original"
          onClick={(event) => {
            event.stopPropagation();
            onOpenOriginal(post);
          }}
          type="button"
        >
          Open original Boost
        </button>
      </div>
      <div className="boost-reboosted-post-grid">
        <BoostAvatar item={post} />
        <div className="boost-reboosted-post-body">
          <div className="boost-reboosted-post-author-line">
            {profileValue ? (
              <a className="boost-author" href={boostProfileHref(profileValue)}>
                {authorLabel(post, undefined, "")}
              </a>
            ) : (
              <span className="boost-author">
                {authorLabel(post, undefined, "")}
              </span>
            )}
            <span>@{boostAuthorId(post) || shortAddress(post.authorAddress)}</span>
            <span>{formatDate(post.createdAt)}</span>
          </div>
          {post.text ? <p className="boost-post-text">{post.text}</p> : null}
          {post.media?.mime && /^(?:image|video)\//iu.test(post.media.mime) ? (
            <BoostMedia item={post} network={network} />
          ) : null}
          <div className="boost-reboosted-signal">
            <span>Original Boost signal</span>
            <strong>{formatBoostSignal(boostProofSignalQ8(post))}</strong>
          </div>
          <a
            className="boost-proof-frame"
            href={txHref}
            rel="noreferrer"
            target="_blank"
          >
            <div>
              <span>Original ProofFrame</span>
              <strong>{post.media?.name ?? "Boost proof record"}</strong>
            </div>
            <p>
              {post.media?.mime
                ? `${post.media.mime} · ${shortAddress(post.media.sha256 ?? post.boostTxid ?? post.txid)}`
                : `pwb1 · ${shortAddress(post.boostTxid || post.txid)} · Owner ${ownerLabel(post)}`}
            </p>
          </a>
        </div>
      </div>
    </div>
  );
}

function QuotedPost({
  network,
  post,
}: {
  network: BitcoinNetwork;
  post?: BoostFeedItem;
}) {
  if (!post) return null;
  return (
    <div className="boost-quoted-post" data-testid="quoted-post">
      <div className="boost-quoted-post-head">
        <Quote aria-hidden="true" size={15} />
        <span>Quoted Boost</span>
      </div>
      <strong>{authorLabel(post, undefined, "")}</strong>
      <span className="boost-quoted-post-handle">
        @{boostAuthorId(post) || shortAddress(post.authorAddress)}
      </span>
      {post.text ? <p>{post.text}</p> : null}
      <a
        className="boost-proof-frame"
        href={explorerTxUrl(post.txid, network)}
        rel="noreferrer"
        target="_blank"
      >
        <span>Open quoted ProofFrame</span>
        <ArrowUpRight aria-hidden="true" size={14} />
      </a>
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
  onOpen,
  onOpenOriginal,
  onReboost,
  onReboostMenu,
  onQuote,
  onReply,
  onTransfer,
  reboostMenuOpen,
}: {
  actionBusy: BoostActionBusy;
  activeAddress: string;
  activeIdentity?: BoostIdentityIntent;
  item: BoostFeedItem;
  network: BitcoinNetwork;
  onFollow: (action: BoostFollowAction, item: BoostFeedItem) => void;
  onLike: (item: BoostFeedItem) => void;
  onList: (item: BoostFeedItem) => void;
  onOpen: (item: BoostFeedItem) => void;
  onOpenOriginal: (item: BoostFeedItem) => void;
  onReboost: (item: BoostFeedItem) => void;
  onReboostMenu: (item: BoostFeedItem) => void;
  onQuote: (item: BoostFeedItem) => void;
  onReply: (item: BoostFeedItem) => void;
  onTransfer: (item: BoostFeedItem) => void;
  reboostMenuOpen: boolean;
}) {
  const txHref = explorerTxUrl(item.txid, network);
  const shareHref = boostShareUrl(item, network);
  const profileValue = boostProfileRouteValue(item);
  const boostTxid = boostItemTxid(item);
  const isReboost = item.kind === "boost-reboost";
  const listing = boostListingForItem(item);
  const ownerAddress = boostOwnerAddress(item);
  const authorAddress = boostAuthorAddress(item);
  const authorId = boostAuthorId(item);
  const totalSignalQ8 = boostTotalSignalQ8(item);
  const signalIncrementQ8 = boostSignalQ8(
    item.signalIncrementQ8,
    item.signalIncrementSatsExact,
    item.signalIncrementSats ?? 0,
  );
  const actionSignalQ8 = boostSignalQ8(
    item.actionSignalQ8,
    item.actionSignalSatsExact,
    item.actionSignalSats ?? 0,
  );
  const isPaidAction = item.kind === "boost-reboost" || item.kind === "boost-reply";
  const displayedSignalQ8 = isPaidAction ? actionSignalQ8 : totalSignalQ8;
  const displayedProofSignalQ8 = isPaidAction ? actionSignalQ8 : boostProofSignalQ8(item);
  const workSignalValueQ8 = boostWorkSignalValueQ8(item);
  const workSignalSubatoms = boostWorkSignalSubatoms(item);
  const connectedOwner =
    activeAddress &&
    ownerAddress &&
      activeAddress.trim() === ownerAddress.trim();
  const connectedAuthor =
    activeAddress &&
    authorAddress &&
    activeAddress.trim() === authorAddress;
  const actionsLocked = Boolean(actionBusy);
  const followAction: BoostFollowAction = item.viewerFollowsAuthor
    ? "unfollow"
    : "follow";
  const FollowIcon = followAction === "follow" ? UserPlus : UserMinus;
  const likeActive = item.viewerLiked === true;
  const reboostActive = item.viewerReboosted === true;

  return (
    <article
      className="boost-post"
      data-testid="boost-post"
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("a,button,input,textarea,select")) return;
        onOpen(item);
      }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
          event.preventDefault();
          onOpen(item);
        }
      }}
      tabIndex={0}
    >
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
            {isReboost ? <span className="boost-post-action">reboosted</span> : null}
            <span>@{authorId || shortAddress(authorAddress)}</span>
            <span>{formatDate(item.createdAt)}</span>
          </div>
          <div className="boost-post-head-actions">
            <strong>{isPaidAction ? "Action signal " : ""}{formatBoostSignal(displayedSignalQ8)}</strong>
            {!connectedAuthor && authorAddress ? (
              <button
                className="secondary small boost-follow-button"
                disabled={actionsLocked}
                onClick={() => onFollow(followAction, item)}
                title={
                  followAction === "follow"
                    ? "Follow with proof signal"
                    : "Unfollow with proof signal"
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

        {isReboost ? (
          <ReboostedPost network={network} onOpenOriginal={onOpenOriginal} post={item.reboostedPost} />
        ) : (
          <>
            {item.text ? <p className="boost-post-text">{item.text}</p> : null}

            {item.media?.mime && /^(?:image|video)\//iu.test(item.media.mime) ? (
              <BoostMedia item={item} network={network} />
            ) : null}

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
          </>
        )}
        {!isReboost ? <QuotedPost network={network} post={item.quotedPost} /> : null}

        <div className="boost-signal-row">
          <span>Total USD {formatUsd(boostTotalSignalUsd(item))}</span>
          <span>Proof {formatBoostSignal(displayedProofSignalQ8)}</span>
          {signalIncrementQ8 > 0n ? (
            <span>Added {formatBoostSignal(signalIncrementQ8)} to original Boost signal</span>
          ) : actionSignalQ8 > 0n ? (
            <span>Action signal {formatBoostSignal(actionSignalQ8)}</span>
          ) : null}
          {workSignalSubatoms > 0n ? (
            <span>
              WORK {formatWorkAmount(workSignalSubatoms, true)}{" "}
              {`(${formatBoostSignal(workSignalValueQ8)})`}
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
            title="Reply and add proof signal to the original Boost"
            type="button"
          >
            <span className="button-content">
              <MessageCircle size={15} />
              <span>{item.replyCount ?? 0}</span>
            </span>
          </button>
          <button
            aria-pressed={likeActive}
            className={likeActive ? "secondary small is-active" : "secondary small"}
            disabled={actionsLocked || likeActive}
            onClick={() => onLike(item)}
            title={likeActive ? "Liked" : "Like and add proof signal to the original Boost"}
            type="button"
          >
            <span className="button-content">
              <Heart size={15} />
              <span>{item.likeCount ?? 0}</span>
            </span>
          </button>
          <div className="boost-reboost-action">
            <button
              aria-expanded={reboostMenuOpen}
              aria-haspopup="menu"
              aria-pressed={reboostActive}
              className={reboostActive ? "secondary small is-active" : "secondary small"}
              disabled={actionsLocked || reboostActive}
              onClick={() => onReboostMenu(item)}
              title={reboostActive ? "Reboosted" : "Reboost and add proof signal to the original Boost"}
              type="button"
            >
              <span className="button-content">
                <Repeat2 size={15} />
                <span>{item.reboostCount ?? 0}</span>
              </span>
            </button>
            {reboostMenuOpen ? (
              <div className="boost-reboost-menu" role="menu">
                <button onClick={() => onReboost(item)} role="menuitem" type="button">
                  <Repeat2 size={14} /> Reboost
                </button>
                <button onClick={() => onQuote(item)} role="menuitem" type="button">
                  <Quote size={14} /> Quote
                </button>
              </div>
            ) : null}
          </div>
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
            <>
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
            </>
          ) : null}
          {connectedOwner ? (
            <button
              className="secondary small"
              disabled={actionsLocked}
              onClick={() => onTransfer(item)}
              title="Transfer this Boost"
              type="button"
            >
              <span className="button-content">
                <Send size={15} />
                <span>Transfer</span>
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
  const [indexedSearchQuery, setIndexedSearchQuery] = useState("");
  const [storedPayload, setPayload] = useState<BoostFeedPayload | undefined>();
  const [payloadScope, setPayloadScope] = useState("");
  const readLifecycle = useRef(createBoostReadLifecycle());
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
  const [directPostOpen, setDirectPostOpen] = useState(false);
  const [expandedItem, setExpandedItem] = useState<BoostFeedItem | undefined>();
  const [postText, setPostText] = useState("");
  const [postSignalSats, setPostSignalSats] = useState(546);
  const [postWorkAmount, setPostWorkAmount] = useState("0");
  const [postWorkSpendable, setPostWorkSpendable] = useState<bigint | undefined>();
  const [postWorkStatus, setPostWorkStatus] = useState("");
  const [postAttachment, setPostAttachment] = useState<MailAttachment | undefined>();
  const [replyTarget, setReplyTarget] = useState<BoostFeedItem | undefined>();
  const [replyText, setReplyText] = useState("");
  const [pendingPaidAction, setPendingPaidAction] =
    useState<PendingBoostPaidAction | undefined>();
  const [reboostMenuTarget, setReboostMenuTarget] = useState<BoostFeedItem | undefined>();
  const [transferTarget, setTransferTarget] = useState<BoostFeedItem | undefined>();
  const [transferRecipient, setTransferRecipient] = useState("");
  const [quoteTarget, setQuoteTarget] = useState<BoostFeedItem | undefined>();
  const [optimisticActions, setOptimisticActions] = useState<Record<string, BoostOptimisticAction>>({});
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

  const readScope = JSON.stringify([address, network, profileRouteValue, profileTab,
    sortMode, timelineMode, valueWindow, indexedSearchQuery]);
  const currentReadScope = useRef(readScope);
  currentReadScope.current = readScope;
  const searchPending = searchQuery.trim() !== indexedSearchQuery;
  const payload = payloadScope === readScope && !searchPending ? storedPayload : undefined;
  const readStateLabel = busy || searchPending ? "Loading" : "Unavailable";

  const items = useMemo(() => payload?.items ?? [], [payload]);
  const activeMarketListings = useMemo(
    () => boostMarketplaceListingsFromItems(items),
    [items],
  );
  // The indexed query covers complete history and fields absent from display
  // rows. Filtering a loaded page again can hide valid canonical matches.
  const visibleItems = useMemo(
    () =>
      items.map((item) => {
        const optimistic = optimisticActions[boostItemTxid(item)];
        if (!optimistic) return item;
        return {
          ...item,
          likeCount: Math.max(0, Number(item.likeCount ?? 0) + Number(optimistic.likeDelta ?? 0)),
          reboostCount: Math.max(0, Number(item.reboostCount ?? 0) + Number(optimistic.reboostDelta ?? 0)),
          viewerLiked: optimistic.liked ?? item.viewerLiked,
          viewerReboosted: optimistic.reboosted ?? item.viewerReboosted,
        };
      }),
    [items, optimisticActions],
  );
  const suggestedProfiles = useMemo(() => {
    const activeAddress = address.trim();
    const byAddress = new Map<string, BoostFeedItem>();
    for (const item of items) {
      const authorAddress = boostAuthorAddress(item);
      const key = authorAddress;
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
  const expandedReplies = useMemo(
    () =>
      expandedItem
        ? visibleItems.filter(
            (item) =>
              item.kind === "boost-reply" &&
              item.targetTxid === boostItemTxid(expandedItem),
          )
        : [],
    [expandedItem, visibleItems],
  );
  const modalOpen = Boolean(
    directPostOpen || expandedItem || pendingPaidAction || replyTarget,
  );
  const postWorkSubatoms = workAtomsFromDecimal(postWorkAmount);
  useEffect(() => {
    if (!directPostOpen || !address.trim()) {
      setPostWorkSpendable(undefined);
      setPostWorkStatus(address ? "" : "Connect UniSat to check spendable WORK.");
      return;
    }
    let active = true;
    setPostWorkSpendable(undefined);
    setPostWorkStatus("Checking spendable WORK...");
    void fetchBoostWorkCapacity(address).then(
      (capacity) => {
        if (!active) return;
        setPostWorkSpendable(capacity.spendableSubatoms);
        setPostWorkStatus("");
      },
      (error) => {
        if (!active) return;
        setPostWorkSpendable(undefined);
        setPostWorkStatus(error instanceof Error ? error.message : "Spendable WORK is unavailable.");
      },
    );
    return () => { active = false; };
  }, [address, directPostOpen]);
  const profileSubject = payload?.profileSubject;
  const profileSubjectAddress = profileSubject?.address ?? "";
  const profileSubjectId = normalizeBoostId(profileSubject?.id ?? "");
  const profileSelfView = Boolean(
    address.trim() &&
    profileSubjectAddress.trim() &&
      address.trim() ===
        profileSubjectAddress.trim(),
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

  async function ensureBoostWriterReady(requiresRegistry = true) {
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
    if (requiresRegistry) {
      if (!registryAddress) {
        registryAddress = await loadBoostRegistryAndIds(writerAddress);
      }
      if (!registryAddress) {
        throw new Error(
          "boost@proofofwork.me does not have a confirmed receiver yet.",
        );
      }
    }
    return { registryAddress, walletAddress: writerAddress };
  }

  async function broadcastBoostPayload({
    action,
    additionalProtocolPayloads = [],
    beforeBroadcast,
    extraExcludedOutpoints = [],
    paymentLabel,
    payments,
    postProtocolPayments,
    postProtocolPayloads = [],
    protocolPayload,
    walletAddress,
  }: {
    action: BoostActionBusy;
    additionalProtocolPayloads?: string[];
    beforeBroadcast?: () => Promise<void>;
    extraExcludedOutpoints?: BoostSpentOutpoint[];
    paymentLabel: string;
    payments: Array<{ address: string; amountSats: number }>;
    postProtocolPayments?: Array<{ address: string; amountSats: number }>;
    postProtocolPayloads?: string[];
    protocolPayload: string;
    walletAddress: string;
  }): Promise<boolean> {
    setActionBusy(action);
    setStatus({ tone: "idle", text: `Preparing ${paymentLabel}...` });
    try {
      const reservedOutpoints = await fetchReservedAmoAnchorOutpoints(
        walletAddress,
        "livenet",
        [...boostListingAnchorOutpoints(items), ...extraExcludedOutpoints],
      );
      const paymentPsbt = await buildBoostPaymentPsbt({
        excludeOutpoints: reservedOutpoints,
        feeRate,
        fromAddress: walletAddress,
        network: "livenet",
        payments,
        postProtocolPayments,
        postProtocolPayloads,
        protocolPayloads: [protocolPayload, ...additionalProtocolPayloads],
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: "Boost transaction canceled." });
        return false;
      }
      await assertActiveWalletAddress(window.unisat!, walletAddress);
      setStatus({
        tone: "idle",
        text: `Waiting for UniSat signature. Fee estimate: ${paymentPsbt.feeSats.toLocaleString()} proofs.`,
      });
      const broadcast = await signAndBroadcastBoostPsbt({
        beforeBroadcast,
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
      void refresh(false, true, false);
      return true;
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : `${paymentLabel} failed.`,
      });
      return false;
    } finally {
      setActionBusy("");
    }
  }

  async function publishPaidAction(
    action: BoostPaidAction,
    item: BoostFeedItem,
  ): Promise<boolean> {
    const targetTxid = boostItemTxid(item);
    if (!targetTxid) {
      setStatus({ tone: "bad", text: "Boost action target is missing." });
      return false;
    }
    if (action === "like" && item.viewerLiked) {
      setStatus({ tone: "idle", text: "This Boost is already liked by this wallet." });
      return false;
    }
    if (action === "reboost" && item.viewerReboosted) {
      setStatus({ tone: "idle", text: "This Boost is already reboosted by this wallet." });
      return false;
    }
    const ownerAddress = boostOwnerAddress(item);
    if (!ownerAddress || !isValidBitcoinAddress(ownerAddress, "livenet")) {
      setStatus({ tone: "bad", text: "The confirmed current Boost owner is unavailable." });
      return false;
    }
    const label = action === "like" ? "Boost like" : "Boost reboost";
    setOptimisticActions((current) => ({
      ...current,
      [targetTxid]: {
        ...current[targetTxid],
        ...(action === "like" ? { likeDelta: 1, liked: true } : { reboostDelta: 1, reboosted: true }),
      },
    }));
    try {
      const ready = await ensureBoostWriterReady(false);
      const sent = await broadcastBoostPayload({
        action,
        paymentLabel: label,
        payments: [
          {
            address: ownerAddress,
            amountSats: BOOST_ACTION_PAYMENT_SATS,
          },
        ],
        protocolPayload: buildBoostActionPayload(action, targetTxid),
        walletAddress: ready.walletAddress,
      });
      if (!sent) {
        setOptimisticActions((current) => {
          const next = { ...current };
          delete next[targetTxid];
          return next;
        });
      }
      return sent;
    } catch (error) {
      setOptimisticActions((current) => {
        const next = { ...current };
        delete next[targetTxid];
        return next;
      });
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : `${label} failed.`,
      });
      return false;
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
      targetAddress.trim() === address.trim()
    ) {
      setStatus({ tone: "bad", text: "Choose another Boost profile to follow." });
      return;
    }
    try {
      const ready = await ensureBoostWriterReady(false);
      if (targetAddress.trim() === ready.walletAddress.trim()) {
        setStatus({ tone: "bad", text: "Choose another Boost profile to follow." });
        return;
      }
      await broadcastBoostPayload({
        action,
        paymentLabel: label,
        payments: [
          {
            address: targetAddress,
            amountSats: BOOST_ACTION_PAYMENT_SATS,
          },
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
      const ownerAddress = boostOwnerAddress(replyTarget);
      if (!ownerAddress || !isValidBitcoinAddress(ownerAddress, "livenet")) {
        throw new Error("The confirmed current Boost owner is unavailable.");
      }
      const ready = await ensureBoostWriterReady(false);
      const sent = await broadcastBoostPayload({
        action: "reply",
        paymentLabel: "Boost reply",
        payments: [
          {
            address: ownerAddress,
            amountSats: BOOST_ACTION_PAYMENT_SATS,
          },
        ],
        protocolPayload: buildBoostReplyPayload({
          profileId: activeIdentity?.id,
          targetTxid: boostItemTxid(replyTarget),
          text: replyText,
        }),
        walletAddress: ready.walletAddress,
      });
      if (sent) {
        setReplyTarget(undefined);
        setReplyText("");
      }
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : "Boost reply failed.",
      });
    }
  }

  async function resolveBoostTransferRecipient(value: string) {
    const input = value.trim();
    if (isValidBitcoinAddress(input, "livenet")) {
      return input;
    }
    const payload = await fetchProofApiJson<RegistryApiPayload>(
      "/api/v1/registry?fresh=1",
      "livenet",
    );
    const id = normalizeBoostId(input);
    const record = (payload.records ?? []).find(
      (candidate) =>
        candidate.confirmed !== false && normalizeBoostId(candidate.id) === id,
    );
    if (!record?.ownerAddress || !isValidBitcoinAddress(record.ownerAddress, "livenet")) {
      throw new Error("Enter a valid mainnet address or confirmed ProofOfWork ID.");
    }
    return record.ownerAddress;
  }

  async function publishBoostPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const signalSats = postSignalSats;
    const workSubatoms = workAtomsFromDecimal(postWorkAmount);
    if (!Number.isSafeInteger(signalSats) || signalSats < 0) {
      setStatus({ tone: "bad", text: "Enter a non-negative whole Proof signal amount." });
      return;
    }
    if (workSubatoms === null) {
      setStatus({ tone: "bad", text: "Enter a WORK amount using up to 16 decimal places, or 0 for no WORK signal." });
      return;
    }
    if (signalSats === 0 && workSubatoms === 0n) {
      setStatus({ tone: "bad", text: "Add Proof or WORK signal to publish a Boost." });
      return;
    }
    try {
      const ready = await ensureBoostWriterReady(false);
      const workCapacity = workSubatoms > 0n
        ? await fetchBoostWorkCapacity(ready.walletAddress)
        : undefined;
      if (workCapacity && workSubatoms > workCapacity.spendableSubatoms) {
        throw new Error(`Attach up to ${formatWorkAmount(workCapacity.spendableSubatoms)} spendable WORK.`);
      }
      if (workCapacity) await requireBoostWorkWriteAdmission();
      const protocolPayload = buildBoostPostPayload({
        attachment: postAttachment,
        message: postText,
        proofSignalSats: signalSats,
        quoteTxid: quoteTarget ? boostItemTxid(quoteTarget) : undefined,
        workSignalSubatoms: workSubatoms.toString(),
      });
      const attachmentPayloads = postAttachment
        ? buildAttachmentPayloads(postAttachment)
        : [];
      const workPayload = workSubatoms > 0n
        ? buildBoostWorkSendPayload(workSubatoms, ready.walletAddress)
        : "";
      const sent = await broadcastBoostPayload({
        action: "post",
        additionalProtocolPayloads: [
          `pwm1:m:${postText}`,
          ...attachmentPayloads,
        ],
        beforeBroadcast: workPayload
          ? async () => {
              await assertActiveWalletAddress(window.unisat!, ready.walletAddress);
              const latest = await fetchBoostWorkCapacity(ready.walletAddress);
              if (workSubatoms > latest.spendableSubatoms) {
                throw new Error("WORK capacity changed while signing. No transaction was broadcast.");
              }
              await requireBoostWorkWriteAdmission();
            }
          : undefined,
        extraExcludedOutpoints: workCapacity?.anchorOutpoints,
        paymentLabel: quoteTarget ? "Boost quote" : "Boost post",
        payments: signalSats > 0
          ? [{ address: ready.walletAddress, amountSats: signalSats }]
          : [],
        postProtocolPayments: workPayload
          ? [{ address: BOOST_WORK_REGISTRY_ADDRESS, amountSats: BOOST_WORK_MUTATION_PROOFS }]
          : undefined,
        postProtocolPayloads: workPayload ? [workPayload] : [],
        protocolPayload,
        walletAddress: ready.walletAddress,
      });
      if (sent) {
        setDirectPostOpen(false);
        setQuoteTarget(undefined);
        setPostText("");
        setPostSignalSats(546);
        setPostWorkAmount("0");
        setPostAttachment(undefined);
      }
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : "Boost post failed.",
      });
    }
  }

  async function publishBoostTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transferTarget) return;
    try {
      const ready = await ensureBoostWriterReady(true);
      const ownerAddress = boostOwnerAddress(transferTarget);
      if (ownerAddress !== ready.walletAddress) {
        throw new Error("Only the current confirmed Boost owner can transfer it.");
      }
      const recipient = await resolveBoostTransferRecipient(transferRecipient);
      if (recipient === ready.walletAddress) {
        throw new Error("Choose a different Boost owner.");
      }
      const sent = await broadcastBoostPayload({
        action: "transfer",
        paymentLabel: "Boost transfer",
        payments: [{ address: ready.registryAddress, amountSats: BOOST_ACTION_PAYMENT_SATS }],
        protocolPayload: buildBoostTransferPayload(boostItemTxid(transferTarget), recipient),
        walletAddress: ready.walletAddress,
      });
      if (sent) {
        setTransferTarget(undefined);
        setTransferRecipient("");
      }
    } catch (error) {
      setStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : "Boost transfer failed.",
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
        ownerAddress.trim() !==
        ready.walletAddress.trim()
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
      const sent = await broadcastBoostPayload({
        action: "list",
        paymentLabel: "Boost listing",
        payments: [
          {
            address: ready.registryAddress,
            amountSats: BOOST_ACTION_PAYMENT_SATS,
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
      if (sent) {
        setListingTarget(undefined);
        setListingPriceSats(DEFAULT_LIST_PRICE_SATS);
      }
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
      const ready = await ensureBoostWriterReady(false);
      await broadcastBoostPayload({
        action: "profile",
        paymentLabel: "Boost profile",
        payments: [
          {
            address: ready.walletAddress,
            amountSats: BOOST_ACTION_PAYMENT_SATS,
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

  const refresh = async (append = false, fresh = false, announce = true) => {
    if (currentReadScope.current !== readScope) return;
    const request = readLifecycle.current.begin();
    const ownsRequest = () => request.current() && currentReadScope.current === readScope;
    setBusy(true);
    if (announce) setStatus({ tone: "idle", text: "Refreshing Boost..." });
    try {
      const params = new URLSearchParams({
        limit: "50",
        sort: sortMode,
        window: valueWindow,
      });
      if (indexedSearchQuery) params.set("q", indexedSearchQuery);
      if (fresh) params.set("fresh", "1");
      if (append && payload?.nextCursor) params.set("cursor", payload.nextCursor);
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
        { timeoutMs: 60_000, signal: request.signal },
      );
      if (!ownsRequest()) return;
      if (nextPayload.complete !== true || !Array.isArray(nextPayload.items)) {
        throw new Error("Complete canonical Boost history is unavailable. Refresh again in a moment.");
      }
      // Validate exact amounts before admitting a payload to any render path.
      for (const item of nextPayload.items) {
        boostTotalSignalQ8(item);
        boostProofSignalQ8(item);
        boostWorkSignalValueQ8(item);
      }
      for (const stats of [nextPayload.signalStats, nextPayload.profileSubject]) {
        if (!stats) continue;
        boostSignalQ8(stats.totalSignalQ8, stats.totalSignalSatsExact);
        boostSignalQ8(stats.proofSignalQ8, stats.proofSignalSatsExact);
      }
      if (append && (nextPayload.snapshotId !== payload?.snapshotId ||
          nextPayload.start !== payload?.items?.length)) {
        throw new Error("Boost history changed between pages. Refresh from page one.");
      }
      const nextItems = append ? [...(payload?.items ?? []), ...nextPayload.items] : nextPayload.items;
      const identities = new Set(nextItems.map((item) => item.eventId ?? `${item.kind}:${item.txid}`));
      if (identities.size !== nextItems.length) {
        throw new Error("Boost feed repeated a page boundary. Refresh from page one.");
      }
      setPayload({ ...nextPayload, items: nextItems });
      setPayloadScope(readScope);
      const total = Number(
        nextPayload.totalCount ?? nextPayload.items?.length ?? 0,
      );
      if (announce) {
        setStatus({
          tone: "good",
          text: `Boost indexed ${total.toLocaleString()} record${total === 1 ? "" : "s"}.`,
        });
      }
    } catch (error) {
      if (!ownsRequest()) return;
      if (announce) {
        setStatus({
          tone: "bad",
          text: error instanceof Error ? error.message : "Boost refresh failed.",
        });
      }
    } finally {
      if (ownsRequest()) setBusy(false);
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => setIndexedSearchQuery(searchQuery.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    void refresh();
    return () => readLifecycle.current.cancel();
  }, [
    address,
    network,
    profileRouteValue,
    profileTab,
    sortMode,
    timelineMode,
    valueWindow,
    indexedSearchQuery,
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
    if (!modalOpen) return;
    const dialog = boostSurfaceRef.current?.querySelector<HTMLElement>(
      ".boost-modal[role='dialog']",
    );
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusableSelector =
      "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])";
    const focusFrame = window.requestAnimationFrame(() =>
      dialog?.querySelector<HTMLElement>(focusableSelector)?.focus(),
    );
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDirectPostOpen(false);
        setExpandedItem(undefined);
        setPendingPaidAction(undefined);
        setReplyTarget(undefined);
        setTransferTarget(undefined);
        setQuoteTarget(undefined);
        setReplyText("");
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
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
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [modalOpen]);

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
    if (payload?.signalStats && searchQuery.trim() === indexedSearchQuery) {
      return {
        proofSignalQ8: boostSignalQ8(payload.signalStats.proofSignalQ8, payload.signalStats.proofSignalSatsExact),
        totalSignalQ8: boostSignalQ8(payload.signalStats.totalSignalQ8, payload.signalStats.totalSignalSatsExact),
        totalSignalUsd: payload.signalStats.totalSignalUsd,
        workSignalSubatoms: workSubatomsFromCanonicalString(payload.signalStats.workSignalSubatoms) ?? 0n,
      };
    }
    return visibleItems.reduce(
      (totals, item) => ({
        proofSignalQ8: totals.proofSignalQ8 + boostProofSignalQ8(item),
        totalSignalQ8: totals.totalSignalQ8 + boostTotalSignalQ8(item),
        totalSignalUsd: totals.totalSignalUsd + boostTotalSignalUsd(item),
        workSignalSubatoms:
          totals.workSignalSubatoms + boostWorkSignalSubatoms(item),
      }),
      {
        proofSignalQ8: 0n,
        totalSignalQ8: 0n,
        totalSignalUsd: 0,
        workSignalSubatoms: 0n,
      },
    );
  }, [visibleItems, payload?.signalStats, searchQuery, indexedSearchQuery]);

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
      value: payload ? formatBoostSignal(headerSignalStats.totalSignalQ8) : readStateLabel,
      tone: "strong" as const,
    },
    {
      detail: "Direct proof signal only.",
      label: "Proof Signal",
      value: payload ? formatBoostSignal(headerSignalStats.proofSignalQ8) : readStateLabel,
    },
    {
      detail: "Attached WORK signal only.",
      label: "WORK Signal",
      value: payload ? formatWorkSignal(headerSignalStats.workSignalSubatoms) : readStateLabel,
    },
    {
      detail: "Total USD value from proof signal plus attached WORK.",
      label: "Total USD",
      value: payload ? formatUsd(headerSignalStats.totalSignalUsd) : readStateLabel,
    },
    {
      label: "Posts",
      value: payload ? (payload.totalCount ?? visibleItems.length).toLocaleString() : readStateLabel,
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

  function openBoostComposer(quote?: BoostFeedItem) {
    setQuoteTarget(quote);
    setPostText("");
    setPostSignalSats(546);
    setPostWorkAmount("0");
    setPostAttachment(undefined);
    setDirectPostOpen(true);
  }

  function renderBoostPost(item: BoostFeedItem) {
    return (
      <BoostPost
        actionBusy={actionBusy}
        activeAddress={address}
        activeIdentity={activeIdentity}
        item={item}
        key={item.eventId ?? `${item.kind}-${item.txid}`}
        network={network}
        onFollow={(followAction, boostItem) =>
          void publishFollowAction(followAction, boostItem)
        }
        onLike={(boostItem) =>
          setPendingPaidAction({ action: "like", item: boostItem })
        }
        onList={(boostItem) => {
          setListingTarget(boostItem);
          openToolsForCompactSurface();
        }}
        onOpen={(boostItem) => {
          setReboostMenuTarget(undefined);
          setExpandedItem(boostItem);
        }}
        onOpenOriginal={(originalPost) => {
          setReboostMenuTarget(undefined);
          setExpandedItem(originalPost);
        }}
        onReboost={(boostItem) => {
          setReboostMenuTarget(undefined);
          setPendingPaidAction({ action: "reboost", item: boostItem });
        }}
        onReboostMenu={(boostItem) =>
          setReboostMenuTarget((current) =>
            current && boostItemTxid(current) === boostItemTxid(boostItem)
              ? undefined
              : boostItem,
          )
        }
        onQuote={(boostItem) => {
          setReboostMenuTarget(undefined);
          openBoostComposer(boostItem);
        }}
        onReply={(boostItem) => {
          setReplyTarget(boostItem);
          setReplyText("");
        }}
        onTransfer={(boostItem) => {
          setTransferTarget(boostItem);
          setTransferRecipient("");
          openToolsForCompactSurface();
        }}
        reboostMenuOpen={
          reboostMenuTarget !== undefined &&
          boostItemTxid(reboostMenuTarget) === boostItemTxid(item)
        }
      />
    );
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
          onRefresh={() => void refresh(false, true)}
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
                  <span>Post a Boost</span>
                </span>
              </button>
            ) : (
              <button
                className="primary"
                onClick={() => openBoostComposer()}
                type="button"
              >
                <span className="button-content">
                  <Zap size={16} />
                  <span>Post a Boost</span>
                </span>
              </button>
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

          {isProfileView ? (
            <a
              className="secondary link-button boost-profile-timeline-link"
              href={boostRouteHref("/", { boost: "1" })}
            >
              <span className="button-content">
                <Clock size={16} />
                <span>Timeline</span>
              </span>
            </a>
          ) : null}

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
              <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
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

          {transferTarget ? (
            <form className="boost-action-panel" onSubmit={publishBoostTransfer}>
              <div className="boost-action-panel-head">
                <strong>Transfer Boost</strong>
                <button
                  aria-label="Close Boost transfer"
                  className="secondary small"
                  onClick={() => setTransferTarget(undefined)}
                  type="button"
                >
                  <X size={15} />
                </button>
              </div>
              <p className="field-note">
                The current owner signs the transfer. The Boost registry receives 546 proofs.
              </p>
              <label>
                New owner address or ID
                <input
                  autoComplete="off"
                  onChange={(event) => setTransferRecipient(event.target.value)}
                  placeholder="bc1… or name@proofofwork.me"
                  value={transferRecipient}
                />
              </label>
              <button
                className="primary"
                disabled={Boolean(actionBusy) || !transferRecipient.trim()}
                type="submit"
              >
                <span className="button-content">
                  <Send size={15} />
                  <span>{actionBusy === "transfer" ? "Transferring" : "Transfer"}</span>
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
                  <h2>{profileSubjectDisplay(payload)}</h2>
                  <p>{profileSubjectHandle(payload) || profileRouteValue}</p>
                  <div className="boost-profile-stats">
                    <span>{payload ? followerLabel(profileSubject?.followerCount) : "Followers unavailable"}</span>
                    <span>{payload ? followingLabel(profileSubject?.followingCount) : "Following unavailable"}</span>
                    <span>{profileSubject ? formatBoostSignal(boostSignalQ8(profileSubject.totalSignalQ8, profileSubject.totalSignalSatsExact, profileSubject.totalSignalSats ?? 0)) : "Unavailable"} signal</span>
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
                    <strong>{payload?.profileTabs?.[option.value] ?? "—"}</strong>
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
                  <button
                    className="boost-composer-prompt"
                    onClick={() => openBoostComposer()}
                    type="button"
                  >
                    What's happening?
                  </button>
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
              onClick={() => void refresh(false, true)}
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
              visibleItems.map((item) => renderBoostPost(item))
            ) : (
              <div className="boost-empty">
                <Zap size={28} />
                <h2>
                  {!payload ? busy || searchPending ? "Loading Boost history" : "Boost history unavailable" : isProfileView
                    ? profileEmptyTitle(profileTab)
                    : timelineMode === "following"
                    ? address
                      ? "No followed Boosts yet"
                      : "Connect to load Following"
                    : "No confirmed Boost posts indexed yet"}
                </h2>
              </div>
            )}
            {payload?.hasMore ? (
              <button className="secondary" disabled={busy} onClick={() => void refresh(true)} type="button">
                {busy ? "Loading..." : "Load more Boosts"}
              </button>
            ) : null}
          </div>
        </section>

        <aside className="boost-right-rail" aria-label="Boost discovery">
          <section className="boost-rail-panel">
            <div className="boost-rail-head">
              <strong>{isProfileView ? "Profile Signal" : "Signal Now"}</strong>
              <span>{payload?.indexedAt ? formatDate(payload.indexedAt) : "Awaiting canonical history"}</span>
            </div>
            <div className="boost-rail-stats">
              <span>
                <strong>
                  {payload ? formatBoostSignal(
                    isProfileView
                      ? boostSignalQ8(profileSubject?.totalSignalQ8, profileSubject?.totalSignalSatsExact, profileSubject?.totalSignalSats ?? 0)
                      : headerSignalStats.totalSignalQ8,
                  ) : "Unavailable"}
                </strong>
                Total
              </span>
              <span>
                <strong>
                  {payload ? formatBoostSignal(
                    isProfileView
                      ? boostSignalQ8(profileSubject?.proofSignalQ8, profileSubject?.proofSignalSatsExact, profileSubject?.proofSignalSats ?? 0)
                      : headerSignalStats.proofSignalQ8,
                  ) : "Unavailable"}
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
                    <span>{formatBoostSignal(boostTotalSignalQ8(item))}</span>
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

      {modalOpen ? (
        <div className="boost-modal-backdrop">
          <button
            aria-label="Close Boost dialog"
            className="boost-modal-dismiss"
            onClick={() => {
              setDirectPostOpen(false);
              setExpandedItem(undefined);
              setPendingPaidAction(undefined);
              setReplyTarget(undefined);
              setQuoteTarget(undefined);
            }}
            type="button"
          />
          {directPostOpen ? (
            <section
              aria-labelledby="boost-post-dialog-title"
              aria-modal="true"
              className="boost-modal"
              role="dialog"
            >
              <div className="boost-modal-head">
                <div>
                  <span>{quoteTarget ? "Quote" : "New Boost"}</span>
                  <strong id="boost-post-dialog-title">
                    {quoteTarget ? "Add a comment" : "What’s happening?"}
                  </strong>
                </div>
                <button
                  aria-label="Close Boost composer"
                  className="secondary small"
                  onClick={() => {
                    setDirectPostOpen(false);
                    setQuoteTarget(undefined);
                  }}
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
              {quoteTarget ? (
                <QuotedPost network={network} post={quoteTarget} />
              ) : null}
              <form onSubmit={publishBoostPost}>
                <textarea
                  autoFocus
                  maxLength={140}
                  onChange={(event) => setPostText(event.target.value)}
                  placeholder="Share a proof-backed thought"
                  value={postText}
                />
                <div className="boost-modal-form-row">
                  <span className="counter">
                    {boostPostText(postText).length.toLocaleString()} / 140
                  </span>
                  <label>
                    Proof signal
                    <input
                      min={0}
                      onChange={(event) => setPostSignalSats(Number(event.target.value))}
                      step={1}
                      type="number"
                      value={postSignalSats}
                    />
                  </label>
                  <label>
                    WORK signal
                    <input
                      inputMode="decimal"
                      min="0"
                      onChange={(event) => setPostWorkAmount(event.target.value)}
                      step="0.0000000000000001"
                      type="text"
                      value={postWorkAmount}
                    />
                  </label>
                </div>
                <p className={postWorkStatus ? "field-note bad" : "field-note"}>
                  {postWorkStatus ||
                    `Spendable WORK: ${postWorkSpendable === undefined
                      ? "Unavailable"
                      : formatWorkAmount(postWorkSpendable)}`}
                </p>
                <div className="boost-post-attachment">
                  <label className="attachment-picker">
                    <input
                      className="file-input"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        if (!file) return;
                        void attachmentFromFile(file).then(
                          setPostAttachment,
                          (error) => setStatus({
                            tone: "bad",
                            text: error instanceof Error ? error.message : "Boost attachment could not be read.",
                          }),
                        );
                      }}
                      type="file"
                    />
                    <span className="button-content">
                      <Paperclip size={16} />
                      <span>{postAttachment ? "Replace attachment" : "Attach file"}</span>
                    </span>
                  </label>
                  <span>One file, {formatBytes(MAX_ATTACHMENT_BYTES)} max before encoding.</span>
                </div>
                {postAttachment ? (
                  <div className="boost-post-attachment-selected">
                    <span>{postAttachment.name} · {formatBytes(postAttachment.size)}</span>
                    <button
                      aria-label="Remove Boost attachment"
                      className="secondary small"
                      onClick={() => setPostAttachment(undefined)}
                      type="button"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ) : null}
                <p className="field-note">
                  Add Proof, WORK, or both. Proof signal is a self-send; WORK signal is a verified same-transaction WORK self-transfer. Files can be attached in that transaction. Choose the miner fee rate below.
                </p>
                <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
                <button
                  className="primary"
                  disabled={
                    Boolean(actionBusy) ||
                    (!postText.trim() && !postAttachment) ||
                    !address ||
                    !Number.isSafeInteger(postSignalSats) ||
                    postSignalSats < 0 ||
                    postWorkSubatoms === null ||
                    (postSignalSats === 0 && postWorkSubatoms === 0n) ||
                    (postWorkSubatoms > 0n &&
                      (postWorkSpendable === undefined ||
                        postWorkSubatoms > postWorkSpendable))
                  }
                  type="submit"
                >
                  <span className="button-content">
                    {actionBusy === "post" ? <RefreshCw className="refresh-spin" size={16} /> : <Send size={16} />}
                    <span>{actionBusy === "post" ? "Posting…" : quoteTarget ? "Quote" : "Post"}</span>
                  </span>
                </button>
              </form>
            </section>
          ) : replyTarget ? (
            <section
              aria-labelledby="boost-reply-dialog-title"
              aria-modal="true"
              className="boost-modal"
              role="dialog"
            >
              <div className="boost-modal-head">
                <div>
                  <span>Reply</span>
                  <strong id="boost-reply-dialog-title">Replying to Boost</strong>
                </div>
                <button
                  aria-label="Close reply composer"
                  className="secondary small"
                  onClick={() => setReplyTarget(undefined)}
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
              <QuotedPost network={network} post={replyTarget} />
              <form onSubmit={publishReply}>
                <textarea
                  autoFocus
                  maxLength={140}
                  onChange={(event) => setReplyText(event.target.value)}
                  placeholder="Reply with a proof-backed thought"
                  value={replyText}
                />
                <div className="counter">
                  {boostPostText(replyText).length.toLocaleString()} / 140
                </div>
                <p className="field-note">
                  The 546-proof reply signal goes to the original Boost owner. Select the transaction miner fee rate below.
                </p>
                <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
                <button
                  className="primary"
                  disabled={Boolean(actionBusy) || !replyText.trim() || !address}
                  type="submit"
                >
                  <span className="button-content">
                    {actionBusy === "reply" ? <RefreshCw className="refresh-spin" size={16} /> : <Send size={16} />}
                    <span>{actionBusy === "reply" ? "Replying…" : "Reply"}</span>
                  </span>
                </button>
              </form>
            </section>
          ) : pendingPaidAction ? (
            <section
              aria-labelledby="boost-paid-action-dialog-title"
              aria-modal="true"
              className="boost-modal"
              role="dialog"
            >
              <div className="boost-modal-head">
                <div>
                  <span>Proof signal</span>
                  <strong id="boost-paid-action-dialog-title">
                    {pendingPaidAction.action === "like" ? "Like Boost" : "Reboost"}
                  </strong>
                </div>
                <button
                  aria-label="Close Boost action"
                  className="secondary small"
                  onClick={() => setPendingPaidAction(undefined)}
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
              <QuotedPost
                network={network}
                post={pendingPaidAction.item.kind === "boost-reboost"
                  ? pendingPaidAction.item.reboostedPost ?? pendingPaidAction.item
                  : pendingPaidAction.item}
              />
              <p className="field-note">
                This action sends {BOOST_ACTION_PAYMENT_SATS.toLocaleString()} proofs to the current owner and adds them to the original Boost signal. Choose the transaction miner fee rate below.
              </p>
              <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
              <div className="boost-modal-action-row">
                <button
                  className="secondary"
                  onClick={() => setPendingPaidAction(undefined)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={Boolean(actionBusy) || !address}
                  onClick={() => {
                    const pending = pendingPaidAction;
                    if (!pending) return;
                    void publishPaidAction(pending.action, pending.item).then((sent) => {
                      if (sent) setPendingPaidAction(undefined);
                    });
                  }}
                  type="button"
                >
                  <span className="button-content">
                    {actionBusy === pendingPaidAction.action
                      ? <RefreshCw className="refresh-spin" size={16} />
                      : pendingPaidAction.action === "like"
                        ? <Heart size={16} />
                        : <Repeat2 size={16} />}
                    <span>
                      {actionBusy === pendingPaidAction.action
                        ? "Signing…"
                        : pendingPaidAction.action === "like"
                          ? "Like · 546 proofs"
                          : "Reboost · 546 proofs"}
                    </span>
                  </span>
                </button>
              </div>
            </section>
          ) : expandedItem ? (
            <section
              aria-labelledby="boost-detail-dialog-title"
              aria-modal="true"
              className="boost-modal boost-detail-modal"
              role="dialog"
            >
              <div className="boost-modal-head">
                <div>
                  <span>Post</span>
                  <strong id="boost-detail-dialog-title">Boost detail</strong>
                </div>
                <button
                  aria-label="Close Boost detail"
                  className="secondary small"
                  onClick={() => setExpandedItem(undefined)}
                  type="button"
                >
                  <ArrowLeft size={16} />
                  <span>Back</span>
                </button>
              </div>
              {renderBoostPost(expandedItem)}
              <div className="boost-detail-replies">
                <div className="boost-detail-replies-head">
                  <strong>Replies</strong>
                  <span>{expandedReplies.length}</span>
                </div>
                {expandedReplies.length > 0 ? (
                  expandedReplies.map((reply) => (
                    <article className="boost-detail-reply" key={reply.eventId ?? reply.txid}>
                      <strong>{authorLabel(reply, activeIdentity, address)}</strong>
                      <span>{formatDate(reply.createdAt)}</span>
                      <p>{reply.text}</p>
                    </article>
                  ))
                ) : (
                  <p className="field-note">Replies will appear here after the canonical feed refreshes.</p>
                )}
              </div>
              <button
                className="primary"
                onClick={() => {
                  setReplyTarget(expandedItem);
                  setReplyText("");
                  setExpandedItem(undefined);
                }}
                type="button"
              >
                <span className="button-content">
                  <MessageCircle size={16} />
                  <span>Post your reply</span>
                </span>
              </button>
            </section>
          ) : null}
        </div>
      ) : null}

      {embedded ? null : <SocialFooter compact />}
    </div>
  );
}
