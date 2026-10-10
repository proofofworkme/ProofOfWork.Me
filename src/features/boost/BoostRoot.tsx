import { buildBoostTip, buildBoostWorkTip, boostTipAmount, BOOST_TIP_DEFAULT_SATS } from "../../shared/protocol/boostTip.mjs";
import {
  FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";
import {
  ArrowUpRight,
  ArrowLeft,
  BookOpen,
  Clock,
  Home,
  MoreHorizontal,
  Heart,
  HandCoins,
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
import { createInFlightRequestPool } from "../../shared/api/inFlightRequestPool";
import { useUnisatPresence } from "../../shared/wallet/useUnisatPresence";
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
import { BoostActivity, BoostConnections, type ConnectionTab } from "./BoostSocialRecords";
import { boostMediaUrl } from "./boostMedia";
import { BoostProfileImages, ProfileImage } from "./BoostProfileImages";
import { BoostText, BoostTextProvider } from "./BoostText";
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
  normalizeBoostId,
  type BoostFeedItem,
  type BoostFeedPayload,
  type BoostFollowAction,
  type BoostIdentityIntent,
  type BoostPaidAction,
  type BoostProfileTab,
  type BoostProfileImage,
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
  type BoostPaymentPsbt,
} from "./boostWallet";
import { ActionTransactionReview, type ActionReview } from "../../shared/components/ActionTransactionReview";
import { fetchBoostTipWorkCapacity } from "./boostTipWorkCapacity";
import { inspectPreparedPayment } from "../../shared/wallet/paymentReview";
import { readActionReceipts, saveActionReceipt, type ActionReceipt } from "../../shared/wallet/actionRecovery";
import { ActionRecoveryPanel } from "../../shared/components/ActionRecoveryPanel";
import { PublishComposer } from "../publish/PublishComposer";
import { PublishArticleCard, PublishArticleText } from "../publish/PublishArticle";
import { isPublishWriterLocation, publishHref, publishWriteHref, publishWriterHistoryState,
  publishWriterReturn as readPublishWriterReturn, requirePublishBudget,
  type PreparedPublish, type PublishPlan } from "../publish/publishProtocol";
import { normalizeBoostTxid } from "./boostProtocol";
import { syncSocialIdentityIntent, publishSocialIdentityIntent, subscribeSocialIdentityIntent } from "../identity/socialIdentity";
import { verifiedSocialIdentityIntent } from "../identity/socialIdentityCore.mjs";
import "./boost.css";
import "../publish/publish.css";

type PreparedContentTip = {
  scope: string; targetTxid: string; ownerAddress: string; walletAddress: string;
  currency: "proofs" | "WORK"; amountText: string; amountSats: number;
  workSubatoms: bigint; feeRate: number; payment: BoostPaymentPsbt; review: ActionReview;
};

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
  | "tip"
  | "transfer"
  | "unfollow";

type PendingBoostPaidAction = {
  action: BoostPaidAction;
  item: BoostFeedItem;
};

type RegistryApiPayload = {
  network?: BitcoinNetwork;
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
  surface?: "boost" | "publish";
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

function initialSearchView() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("mode") === "search" || params.has("q") || params.has("search");
}

function initialBoostNetwork(fallback: BitcoinNetwork) {
  const value = initialSearchParam("network");
  return value === "livenet" || value === "testnet" || value === "testnet4" ? value : fallback;
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

function CompactSignal({ value }: { value: bigint }) {
  const exact = formatBoostSignal(value);
  const units = [[1_000_000_000_000n, "T"], [1_000_000_000n, "B"], [1_000_000n, "M"], [1_000n, "K"]] as const;
  const unit = value >= 10_000n * 100_000_000n
    ? units.find(([scale]) => value >= scale * 100_000_000n) : undefined;
  const compact = unit
    ? `${value / (unit[0] * 100_000_000n)}.${(value * 100n / (unit[0] * 100_000_000n) % 100n).toString().padStart(2, "0")}${unit[1]} proofs`
    : exact;
  return <span aria-label={exact} title={exact}>{compact}</span>;
}

function boostOwnerAddress(item: BoostFeedItem) {
  return (item.currentOwnerAddress || item.authorAddress || "").trim();
}

function boostAuthorAddress(item: BoostFeedItem) {
  return item.authorAddress.trim();
}

function sameBoostWalletAddress(left: string, right: string) {
  const leftAddress = left.trim();
  const rightAddress = right.trim();
  if (!leftAddress || !rightAddress) return false;
  if (leftAddress === rightAddress) return true;
  try {
    return Buffer.from(scriptForAddress(leftAddress, "livenet", "Boost address"))
      .equals(Buffer.from(scriptForAddress(rightAddress, "livenet", "Boost address")));
  } catch {
    return false;
  }
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
    sameBoostWalletAddress(item.authorAddress, activeAddress);
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

function profileSubjectDisplay(payload: BoostFeedPayload | undefined) {
  const subject = payload?.profileSubject;
  const displayName = subject?.displayName?.trim();
  // Shorten the generated full ID only. Preserve an explicit display name.
  if (displayName && displayName.toLowerCase() !== `${subject?.id}@proofofwork.me`.toLowerCase()) {
    return displayName;
  }
  return subject?.id || (subject?.address ? shortAddress(subject.address) : "Boost profile");
}

function profileCount(count: number | undefined) {
  return count !== undefined && Number.isSafeInteger(count) && count >= 0
    ? count.toLocaleString()
    : "—";
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

function boostTimelineHref(embedded: boolean, network?: BitcoinNetwork) {
  return boostRouteHref("/", { ...(embedded ? { folder: "boost" } : { boost: "1" }), network });
}

function boostSearchHref(embedded: boolean, network: BitcoinNetwork) {
  return boostRouteHref("/", { ...(embedded ? { folder: "boost" } : { boost: "1" }), network, mode: "search" });
}

function boostProfileHref(value: string, embedded: boolean) {
  return boostRouteHref("/", {
    ...(embedded ? { folder: "boost" } : { boost: "1" }),
    profile: value,
  });
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
  const txLink = sharedPost.article ? publishHref({ txid: sharedPost.txid, network }) : explorerTxUrl(sharedPost.txid, network);
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
      `Selected fee rate: ${feeRate} proofs/vB.`,
      `Estimated fee: ${feeSats.toLocaleString()} proofs.`,
      "Use a larger confirmed UTXO or batch payments to avoid this. Continue signing?",
    ].join("\n\n"),
  );
}

function BoostAvatar({ item }: { item: BoostFeedItem }) {
  return <ProfileImage pointer={item.profile?.image} network={item.network ?? "livenet"}
    className="boost-avatar" fallback={avatarText(item)} />;
}

const BOOST_MEDIA_MAX_CONCURRENT = 4;
const boostMediaRequests = createInFlightRequestPool<{
  attachment?: {
    data?: string; mime?: string; name?: string; sha256?: string; size?: number;
  };
}>();
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
    const txid = String(item.boostTxid || item.txid).trim().toLowerCase();
    void boostMediaRequests
      .request(`${network}:${txid}`, controller.signal, async (signal) => {
        const release = await acquireBoostMediaSlot(signal);
        try {
          return await fetchProofApiJson<{ attachment?: {
            data?: string; mime?: string; name?: string; sha256?: string; size?: number;
          } }>(
            `/api/v1/tx/${encodeURIComponent(txid)}`,
            network,
            { signal, timeoutMs: 30_000 },
          );
        } finally {
          release();
        }
      })
      .then((payload) => {
        if (!controller.signal.aborted) {
          const url = boostMediaUrl(item.media, payload.attachment);
          if (url) setMediaUrl(url);
          else setMediaError(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setMediaError(true);
      });
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
  embedded,
  network,
  onOpenOriginal,
  post,
}: {
  embedded: boolean;
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
        if (target.closest("a,button,input,textarea,select,details,summary")) return;
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
              <a className="boost-author" href={boostProfileHref(profileValue, embedded)}>
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
          {post.article ? <PublishArticleCard item={post} network={network} /> :
            post.text ? <p className="boost-post-text"><BoostText text={post.text} /></p> : null}
          {post.media?.mime && /^(?:image|video)\//iu.test(post.media.mime) ? (
            <BoostMedia item={post} network={network} />
          ) : null}
          <div className="boost-reboosted-signal">
            <span>Original Boost signal</span>
            <strong>{formatBoostSignal(boostProofSignalQ8(post))}</strong>
          </div>
          <details className="boost-proof-details">
            <summary>View original proof</summary>
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
          </details>
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
      {post.article ? <PublishArticleCard item={post} network={network} /> :
        post.text ? <p><BoostText text={post.text} /></p> : null}
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
  articleReader = false,
  publishSurface = false,
  embedded,
  actionBusy,
  activeAddress,
  activeIdentity,
  item,
  network,
  onFollow,
  onLike,
  onTip,
  onList,
  onOpen,
  onOpenOriginal,
  onReboost,
  onReboostMenu,
  onQuote,
  onReply,
  onTransfer,
  reboostMenuOpen,
  profileAddress,
}: {
  articleReader?: boolean;
  publishSurface?: boolean;
  embedded: boolean;
  actionBusy: BoostActionBusy;
  activeAddress: string;
  activeIdentity?: BoostIdentityIntent;
  item: BoostFeedItem;
  network: BitcoinNetwork;
  onFollow: (action: BoostFollowAction, item: BoostFeedItem) => void;
  onLike: (item: BoostFeedItem) => void;
  onTip: (item: BoostFeedItem) => void;
  onList: (item: BoostFeedItem) => void;
  onOpen: (item: BoostFeedItem) => void;
  onOpenOriginal: (item: BoostFeedItem) => void;
  onReboost: (item: BoostFeedItem) => void;
  onReboostMenu: (item: BoostFeedItem) => void;
  onQuote: (item: BoostFeedItem) => void;
  onReply: (item: BoostFeedItem) => void;
  onTransfer: (item: BoostFeedItem) => void;
  reboostMenuOpen: boolean;
  profileAddress?: string;
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
  const connectedOwner = sameBoostWalletAddress(activeAddress, ownerAddress);
  const connectedAuthor = sameBoostWalletAddress(activeAddress, authorAddress);
  const actionsLocked = Boolean(actionBusy);
  const followAction: BoostFollowAction = item.viewerFollowsAuthor
    ? "unfollow"
    : "follow";
  const FollowIcon = followAction === "follow" ? UserPlus : UserMinus;
  const likeActive = item.viewerLiked === true;
  const reboostActive = item.viewerReboosted === true;

  return (
    <article
      className={articleReader ? "boost-post publish-full-post" : "boost-post"}
      data-testid="boost-post"
      onClick={(event) => {
        if (articleReader) return;
        const target = event.target as HTMLElement;
        if (target.closest("a,button,input,textarea,select,details,summary")) return;
        onOpen(item);
      }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
          event.preventDefault();
          onOpen(item);
        }
      }}
      tabIndex={articleReader ? undefined : 0}
    >
      <BoostAvatar item={item} />
      <div className="boost-post-body">
        <div className="boost-post-head">
          <div className="boost-author-line">
            {profileValue ? (
              <a className="boost-author" href={publishSurface ? publishHref({ profile: profileValue, network, embedded }) : boostProfileHref(profileValue, embedded)}>
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
            <strong>{isPaidAction ? "Action signal " : ""}<CompactSignal value={displayedSignalQ8} /></strong>
            {!connectedAuthor && authorAddress && !sameBoostWalletAddress(authorAddress, profileAddress ?? "") ? (
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
          <ReboostedPost embedded={embedded} network={network} onOpenOriginal={onOpenOriginal} post={item.reboostedPost} />
        ) : (
          <>
            {item.article ? articleReader ? <PublishArticleText item={item} network={network} /> :
              <PublishArticleCard item={item} network={network} embedded={embedded && window.location.search.includes("folder=publish")} /> :
              item.text ? <p className="boost-post-text"><BoostText text={item.text} /></p> : null}

            {item.media?.mime && /^(?:image|video)\//iu.test(item.media.mime) ? (
              <BoostMedia item={item} network={network} />
            ) : null}
          </>
        )}
        {!isReboost ? <QuotedPost network={network} post={item.quotedPost} /> : null}

        <details className="boost-proof-details">
          <summary>View proof <span>{item.confirmed ? "Confirmed" : "Pending"}</span></summary>
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

          <dl className="boost-proof-record">
            <dt>Transaction</dt><dd>{item.txid}</dd>
            <dt>Owner</dt><dd>{ownerAddress}</dd>
            <dt>Confirmed tips</dt><dd>{item.tipCount ?? 0} · {item.tipSatsExact ?? "0"} proofs · {formatWorkAmount(workSubatomsFromCanonicalString(item.tipWorkSubatomsExact) ?? 0n, true)} WORK</dd>
            {item.media?.sha256 ? <><dt>File SHA-256</dt><dd>{item.media.sha256}</dd></> : null}
          </dl>
        </details>

        <div className="boost-actions">
          <button
            className="secondary small"
            disabled={actionsLocked}
            onClick={() => onReply(item)}
            aria-label={`Reply, ${item.replyCount ?? 0} replies`}
            title="Reply and add proof signal to the original Boost"
            type="button"
          >
            <span className="button-content">
              <MessageCircle size={15} />
              <span>{item.replyCount ?? 0}</span>
            </span>
          </button>
          <button
            aria-label={`Like, ${item.likeCount ?? 0} likes`}
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
          <button className="secondary small" disabled={actionsLocked} onClick={() => onTip(item)}
            aria-label={`Tip, ${item.tipCount ?? 0} tips`} title="Tip the current owner" type="button">
            <span className="button-content"><HandCoins size={15} /><span>{item.tipCount ?? 0}</span></span>
          </button>
          <div className="boost-reboost-action">
            <button
              aria-label={`Reboost, ${item.reboostCount ?? 0} reboosts`}
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
          <a
            className="secondary small link-button"
            aria-label="Share Boost"
            href={shareHref}
            rel="noreferrer"
            target="_blank"
          >
            <span className="button-content">
              <Share2 size={15} />
              <span>Share</span>
            </span>
          </a>
          <details className="boost-more-actions" onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}>
            <summary aria-label="More Boost actions" title="More Boost actions"><MoreHorizontal size={18} /></summary>
            <div className="boost-more-actions-panel">
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
          <button className="secondary small" onClick={() => onOpen(item)} type="button">View activity</button>
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
          </details>
        </div>
      </div>
    </article>
  );
}

export default function BoostRoot({
  surface = "boost",
  embedded = false,
  initialAddress = "",
  initialNetwork = "livenet",
  onComposeBoost,
}: BoostRootProps = {}) {
  const isPublish = surface === "publish";
  const surfaceName = isPublish ? "Publish" : "Boost";
  const [articleRoute] = useState(() => isPublish && !isPublishWriterLocation() ? initialSearchParam("article") : "");
  const articleTxid = normalizeBoostTxid(articleRoute);
  const [publishWriterOpen, setPublishWriterOpen] = useState(() => isPublish && isPublishWriterLocation());
  const [publishWriterReturn, setPublishWriterReturn] = useState(() => readPublishWriterReturn(window.history.state));
  const publishWriterLeaveGuard = useRef<(() => boolean) | undefined>(undefined);
  const publishWriterOpenRef = useRef(publishWriterOpen);
  publishWriterOpenRef.current = publishWriterOpen;
  const [publishRestoreDraft, setPublishRestoreDraft] = useState<{ address: string; network: BitcoinNetwork;
    draft: { title: string; body: string; signal: number; feeRate: number } }>();
  const [publishReceipts, setPublishReceipts] = useState<ActionReceipt[]>([]);
  const [publishRecoveryError, setPublishRecoveryError] = useState("");
  const [publishRecoveryChecking, setPublishRecoveryChecking] = useState(false);
  const publishSigning = useRef(false);
  const [network, setNetworkState] = useState<BitcoinNetwork>(() => initialBoostNetwork(initialNetwork));
  const networkRef = useRef(network);
  const setNetwork = (value: BitcoinNetwork) => {
    if (value !== networkRef.current) { identityReadRequest.current++; setOwnedIds([]); setActiveIdentity(undefined); setSelectedIdentityId(""); }
    networkRef.current = value; setNetworkState(value);
  };
  const previousInitialNetwork = useRef(initialNetwork);
  const [sortMode, setSortMode] = useState<BoostSortMode>("value");
  const [valueWindow, setValueWindow] = useState<BoostValueWindow>("all");
  const [timelineMode, setTimelineMode] =
    useState<BoostTimelineMode>("all");
  const [profileRouteValue] = useState(() => isPublish && isPublishWriterLocation() ? "" : initialSearchParam("profile"));
  const [connectionsTab, setConnectionsTab] = useState<ConnectionTab | undefined>(() => {
    const value = initialSearchParam("connections");
    return value === "followers" || value === "following" ? value : undefined;
  });
  function selectConnections(tab?: ConnectionTab) {
    setConnectionsTab(tab);
    const url = new URL(window.location.href);
    if (tab) url.searchParams.set("connections", tab);
    else url.searchParams.delete("connections");
    window.history.replaceState(null, "", url);
  }
  const [profileLookup, setProfileLookup] = useState(profileRouteValue);
  const [profileTab, setProfileTab] =
    useState<BoostProfileTab>(initialProfileTab);
  const [listQuery] = useState(() => initialSearchParam("list"));
  const [searchQuery, setSearchQuery] = useState(() => initialSearchParam("q") || initialSearchParam("search"));
  const [indexedSearchQuery, setIndexedSearchQuery] = useState(() => initialSearchParam("q") || initialSearchParam("search"));
  const [routeSearchActive] = useState(() => !(isPublish && isPublishWriterLocation()) && initialSearchView());
  const [profileSearchActive, setProfileSearchActive] = useState(initialSearchView);
  const [storedPayload, setPayload] = useState<BoostFeedPayload | undefined>();
  const [payloadScope, setPayloadScope] = useState("");
  const readLifecycle = useRef(createBoostReadLifecycle());
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<BoostActionBusy>("");
  const [hasUnisat, setHasUnisat] = useUnisatPresence();
  const [address, setAddressState] = useState(initialAddress);
  const walletAddressRef = useRef(initialAddress);
  const identityReadRequest = useRef(0);
  const setAddress = (value: string) => {
    if (value !== walletAddressRef.current) { setOwnedIds([]); setActiveIdentity(undefined); setSelectedIdentityId(""); }
    walletAddressRef.current = value; identityReadRequest.current++; setAddressState(value);
  };
  const [boostRegistryAddress, setBoostRegistryAddress] = useState("");
  const [ownedIds, setOwnedIds] = useState<PowIdRecordLike[]>([]);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
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
  const paidActionInFlight = useRef(false);
  const [tipReceipts, setTipReceipts] = useState<ActionReceipt[]>([]);
  const [tipRecoveryError, setTipRecoveryError] = useState("");
  const [tipRecoveryChecking, setTipRecoveryChecking] = useState(false);
  const [tipAmountText, setTipAmountText] = useState(String(BOOST_TIP_DEFAULT_SATS));
  const [tipCurrency, setTipCurrency] = useState<"proofs" | "WORK">("proofs");
  const [tipWorkAmountText, setTipWorkAmountText] = useState("1");
  const [tipWorkSpendable, setTipWorkSpendable] = useState<bigint | undefined>();
  const [tipWorkStatus, setTipWorkStatus] = useState("");
  const [preparedTip, setPreparedTip] = useState<PreparedContentTip | undefined>();
  const tipReturnFocus = useRef<HTMLElement | null>(null);
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
  const profileSearchRef = useRef<HTMLInputElement>(null);
  const profileSearchTriggerRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<AppStatusState>({
    tone: "idle",
    text: "",
  });
  const writerScope = JSON.stringify([address, network, activeIdentity?.id ?? ""]);
  const currentWriterScope = useRef(writerScope);
  currentWriterScope.current = writerScope;

  const isProfileView = Boolean(profileRouteValue.trim());
  const isSearchView = !isProfileView && routeSearchActive;
  const emptySearch = isSearchView && !searchQuery.trim();
  const readScope = JSON.stringify([surface, address, network, profileRouteValue, profileTab,
    sortMode, isSearchView ? "search" : timelineMode, valueWindow, indexedSearchQuery]);
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
      if (!key || sameBoostWalletAddress(key, activeAddress) || item.viewerFollowsAuthor ||
          (profileRouteValue.trim() && sameBoostWalletAddress(key, payload?.profileSubject?.address ?? ""))) {
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
  }, [address, items, profileRouteValue, payload?.profileSubject?.address]);
  const topSignalItems = useMemo(() => visibleItems.slice(0, 3), [visibleItems]);
  const tipScope = JSON.stringify([address, network, pendingPaidAction?.action,
    pendingPaidAction ? boostItemTxid(pendingPaidAction.item) : "", tipCurrency,
    tipAmountText, tipWorkAmountText, feeRate]);
  const currentTipScope = useRef(tipScope);
  currentTipScope.current = tipScope;
  const tipWorkSubatoms = workAtomsFromDecimal(tipWorkAmountText);
  const modalOpen = !preparedTip && Boolean(
    directPostOpen || expandedItem || pendingPaidAction || replyTarget,
  );
  useEffect(() => {
    if (pendingPaidAction?.action !== "tip" || tipCurrency !== "WORK" || !address || network !== "livenet") {
      setTipWorkSpendable(undefined); setTipWorkStatus(""); return;
    }
    let active = true;
    setTipWorkSpendable(undefined); setTipWorkStatus("Checking spendable WORK...");
    void fetchBoostTipWorkCapacity(address).then(capacity => {
      if (active) { setTipWorkSpendable(capacity.spendableSubatoms); setTipWorkStatus(""); }
    }, cause => {
      if (active) { setTipWorkSpendable(undefined); setTipWorkStatus(cause instanceof Error ? cause.message : "Spendable WORK is unavailable."); }
    });
    return () => { active = false; };
  }, [address, network, pendingPaidAction, tipCurrency]);
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
  const profileBoostCount = profileSubject?.boostCount ?? payload?.profileTabs?.boosts;
  const profileSubjectId = normalizeBoostId(profileSubject?.id ?? "");
  const profileSelfView = sameBoostWalletAddress(address, profileSubjectAddress);
  const profileFollowAction: BoostFollowAction = profileSubject?.viewerFollowsProfile
    ? "unfollow"
    : "follow";
  const profileWorkSignalSubatoms =
    workSubatomsFromCanonicalString(profileSubject?.workSignalSubatoms) ?? 0n;

  async function loadBoostRegistryAndIds(walletAddress: string) {
    const request = ++identityReadRequest.current;
    const ownsRequest = () => request === identityReadRequest.current &&
      sameBoostWalletAddress(walletAddressRef.current, walletAddress) && networkRef.current === "livenet";
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
    const owned = idsOwnedByAddress(
      registryPayload.records ?? [],
      walletAddress,
      "livenet",
    );
    const storedIdentity = await syncSocialIdentityIntent(walletAddress, "livenet");
    if (!ownsRequest()) return "";
    setBoostRegistryAddress(registryReceiveAddress);
    setOwnedIds(owned);
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
    onSigned,
    onBroadcast,
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
    onSigned?: (txid: string) => void;
    onBroadcast?: () => void;
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
        onSigned,
        beforeBroadcast,
        inputCount: paymentPsbt.inputCount,
        network: "livenet",
        psbtHex: paymentPsbt.psbtHex,
        signInputIndexes: paymentPsbt.walletInputIndexes,
        signingAddress: walletAddress,
        wallet: window.unisat!,
      });
      onBroadcast?.();
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

  async function checkTipReceipts() {
    if (tipRecoveryChecking) return;
    const scope = address;
    setTipRecoveryChecking(true);
    setTipRecoveryError("");
    try {
      const receipts = readActionReceipts(localStorage).filter(row => row.key.startsWith("boost-tip:") && row.network === network && sameBoostWalletAddress(row.address, scope));
      setTipReceipts(receipts);
      for (const row of receipts.filter(row => row.status === "unknown" || row.status === "pending")) {
        const response = await fetchProofApiJson<{ status?: string }>(`/api/v1/tx/${row.txid}/status`, row.network);
        if (walletAddressRef.current !== scope || networkRef.current !== row.network) return;
        if (["confirmed", "pending", "dropped"].includes(response.status ?? "")) {
          saveActionReceipt(localStorage, { ...row, status: response.status as ActionReceipt["status"] });
        } else throw new Error("Tip status is unavailable. Keep the retained transaction before retrying.");
      }
      if (walletAddressRef.current === scope) setTipReceipts(readActionReceipts(localStorage).filter(row => row.key.startsWith("boost-tip:") && row.network === network && sameBoostWalletAddress(row.address, scope)));
    } catch (cause) { if (walletAddressRef.current === scope) setTipRecoveryError(cause instanceof Error ? cause.message : "Tip status is unavailable."); }
    finally { setTipRecoveryChecking(false); }
  }

  useEffect(() => {
    setTipReceipts([]); setTipRecoveryError("");
    void checkTipReceipts();
  }, [address, network]);

  async function publishPaidAction(
    action: BoostPaidAction,
    item: BoostFeedItem,
  ): Promise<boolean> {
    if (action === "tip") { await prepareContentTip(item); return false; }
    if (paidActionInFlight.current || actionBusy) return false;
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
        ...(action === "like" ? { likeDelta: 1, liked: true } : action === "reboost" ? { reboostDelta: 1, reboosted: true } : {}),
      },
    }));
    paidActionInFlight.current = true;
    setActionBusy(action);
    try {
      const ready = await ensureBoostWriterReady(false);
      const sent = await broadcastBoostPayload({
        action, paymentLabel: label,
        payments: [{ address: ownerAddress, amountSats: BOOST_ACTION_PAYMENT_SATS }],
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
    } finally { paidActionInFlight.current = false; setActionBusy(""); }
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
    if (sameBoostWalletAddress(targetAddress, address)) {
      setStatus({ tone: "bad", text: "Choose another Boost profile to follow." });
      return;
    }
    try {
      const ready = await ensureBoostWriterReady(false);
      if (sameBoostWalletAddress(targetAddress, ready.walletAddress)) {
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
    window.location.href = isPublish ? publishHref({ profile: nextProfile, network, embedded }) : boostProfileHref(nextProfile, embedded);
  }

  function selectProfileTab(nextTab: BoostProfileTab) {
    setProfileTab(nextTab);
    if (!profileRouteValue.trim()) {
      return;
    }
    const url = new URL(window.location.href);
    if (embedded) {
      url.searchParams.delete("boost");
      url.searchParams.set("folder", surface);
    } else {
      url.searchParams.delete(isPublish ? "boost" : "publish");
      url.searchParams.set(isPublish ? "publish" : "boost", "1");
    }
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

  function scopedPublishReceipts() {
    return readActionReceipts(localStorage).filter(receipt => receipt.key.startsWith("publish:") &&
      sameBoostWalletAddress(receipt.address, address) && receipt.network === network);
  }

  function retainPublishReceipt(receipt: ActionReceipt) {
    const next = saveActionReceipt(localStorage, receipt);
    setPublishReceipts(next.filter(row => row.key.startsWith("publish:") &&
      sameBoostWalletAddress(row.address, address) && row.network === network));
  }

  function assertPublishRecovery(plan: PublishPlan) {
    const blocker = scopedPublishReceipts().find(receipt => receipt.status === "unknown" ||
      (receipt.status === "pending" && receipt.key === `publish:${plan.article.sha256}`));
    if (blocker) throw new Error(`An article transaction is ${blocker.status === "unknown" ? "awaiting a known broadcast outcome" : "pending confirmation"}. Check transaction recovery before preparing another copy.`);
  }

  async function verifyPublishWriter(walletAddress: string, identityId: string, expectedScope: string, identity?: BoostIdentityIntent) {
    if (currentWriterScope.current !== expectedScope) throw new Error("Wallet, network, or selected identity changed. Prepare a new article review.");
    await ensureWalletNetwork(window.unisat!, "livenet", walletAddress);
    await assertActiveWalletAddress(window.unisat!, walletAddress);
    if (identityId) {
      if (!identity || identity.id !== identityId || !verifiedSocialIdentityIntent(identity, walletAddress, "livenet")) {
        throw new Error("Your selected PowID signature is unavailable or invalid. Select the ID again before publishing.");
      }
      const latest = await fetchProofApiJson<RegistryApiPayload>(
        `/api/v1/ids/${encodeURIComponent(identityId)}?current=1&fresh=1`, "livenet");
      if (latest.record?.confirmed !== true || normalizeBoostId(latest.record.id) !== identityId ||
          latest.network !== "livenet" || (latest.record.network && latest.record.network !== "livenet") ||
          !sameBoostWalletAddress(latest.record.ownerAddress, walletAddress)) {
        throw new Error("Your selected PowID is no longer confirmed as owned by this wallet. Refresh identity before publishing.");
      }
    }
    if (currentWriterScope.current !== expectedScope) throw new Error("Selected identity changed during verification. Prepare a new article review.");
  }

  async function verifyPublishFunding(prepared: PreparedPublish) {
    const utxos = await fetchProofApiJson<Array<{ txid: string; vout: number; status?: { confirmed?: boolean } }>>(
      `/api/v1/address/${encodeURIComponent(prepared.address)}/utxo`, prepared.network);
    if (!Array.isArray(utxos)) throw new Error("Fresh article funding evidence is unavailable.");
    const available = new Set(utxos.filter(utxo => utxo.status?.confirmed === true).map(utxo => `${utxo.txid}:${utxo.vout}`));
    const reserved = await fetchReservedAmoAnchorOutpoints(prepared.address, prepared.network, boostListingAnchorOutpoints(items));
    const reservations = new Set(reserved.map(outpoint => `${outpoint.txid}:${outpoint.vout}`));
    if (prepared.review.evidence!.inputs.some(input => !available.has(input.outpoint) || reservations.has(input.outpoint))) {
      throw new Error("Reviewed article funding changed or became reserved. Prepare a new transaction review.");
    }
  }

  async function preparePublishArticle(plan: PublishPlan, articleFeeRate: number): Promise<PreparedPublish> {
    if (publishSigning.current || actionBusy) throw new Error("Another wallet action is in progress.");
    requirePublishBudget(plan);
    if (network !== "livenet" || !address || !Number.isFinite(articleFeeRate) || articleFeeRate < 0.1) {
      throw new Error("Connect your mainnet wallet and choose a miner fee of at least 0.1 proofs/vB.");
    }
    const expectedScope = writerScope;
    const identityId = normalizeBoostId(activeIdentity?.id ?? "");
    publishSigning.current = true;
    setActionBusy("post");
    try {
      assertPublishRecovery(plan);
      await verifyPublishWriter(address, identityId, expectedScope, plan.identity);
      const exclusions = await fetchReservedAmoAnchorOutpoints(address, network, boostListingAnchorOutpoints(items));
      const paymentPsbt = await buildBoostPaymentPsbt({ excludeOutpoints: exclusions,
        feeRate: articleFeeRate, fromAddress: address, network,
        payments: [{ address, amountSats: plan.proofSignalSats }], protocolPayloads: plan.payloads });
      const evidence = inspectPreparedPayment({ psbtHex: paymentPsbt.psbtHex,
        network: bitcoin.networks.bitcoin, paymentCount: 1, registryPaymentCount: 0,
        feeSats: paymentPsbt.feeSats, changeSats: paymentPsbt.changeSats });
      if (JSON.stringify(evidence.records) !== JSON.stringify(plan.payloads)) throw new Error("Prepared article bytes differ from the preview.");
      await verifyPublishWriter(address, identityId, expectedScope, plan.identity);
      return { plan, address, network, identityId, feeRate: articleFeeRate, paymentPsbt,
        review: { title: "Publish article", networkLabel: "Mainnet", feeRate: String(articleFeeRate),
          dustFeeProofs: String(paymentPsbt.dustFeeSats), evidence, paymentLabels: ["Article proof signal returned to your wallet"],
          walletSpendProofs: evidence.feeProofs,
          fields: [["Title", plan.article.title], ["Selected identity", identityId ? `${identityId}@proofofwork.me` : address],
            ["Text size", `${plan.article.size} UTF-8 bytes`], ["SHA-256", plan.article.sha256],
            ["Aggregate OP_RETURN scripts", `${plan.carrierBytes} / 100000 bytes`]],
          explanation: "The complete article is public and permanent. The existing Boost post is its one social and ownership target; replies, likes, reboosts, transfers, and sales use that same transaction. A selected PowID updates your existing shared Boost profile in this transaction; your avatar and banner are preserved." } };
    } finally { publishSigning.current = false; setActionBusy(""); }
  }

  async function signPublishArticle(prepared: PreparedPublish, assertCurrent: () => void) {
    if (publishSigning.current || actionBusy) throw new Error("Another wallet action is in progress.");
    const expectedScope = JSON.stringify([prepared.address, prepared.network, prepared.identityId]);
    let receipt: ActionReceipt | undefined;
    publishSigning.current = true;
    setActionBusy("post");
    try {
      assertCurrent();
      assertPublishRecovery(prepared.plan);
      await verifyPublishWriter(prepared.address, prepared.identityId, expectedScope, prepared.plan.identity);
      await verifyPublishFunding(prepared);
      assertCurrent();
      const broadcast = await signAndBroadcastBoostPsbt({
        inputCount: prepared.paymentPsbt.inputCount, psbtHex: prepared.paymentPsbt.psbtHex,
        signInputIndexes: prepared.paymentPsbt.walletInputIndexes, network: prepared.network,
        signingAddress: prepared.address, wallet: window.unisat!,
        onSigned: txid => {
          receipt = { txid, address: prepared.address, network: prepared.network, title: "Publish article",
            key: `publish:${prepared.plan.article.sha256}`, createdAt: new Date().toISOString(), status: "unknown",
            fields: [["Title", prepared.plan.article.title], ["Body", prepared.plan.body],
              ["Proof signal", String(prepared.plan.proofSignalSats)], ["Fee rate", String(prepared.feeRate)],
              ["Selected identity", prepared.identityId], ["SHA-256", prepared.plan.article.sha256]] };
          retainPublishReceipt(receipt);
        },
        beforeBroadcast: async () => {
          assertCurrent();
          await verifyPublishWriter(prepared.address, prepared.identityId, expectedScope, prepared.plan.identity);
          await verifyPublishFunding(prepared);
          assertCurrent();
        },
      });
      if (receipt) retainPublishReceipt({ ...receipt, status: "pending" });
      setStatus({ tone: "good", text: "Article broadcast. It will appear in Publish and Boost after confirmation.",
        links: [{ href: broadcast.url, text: "View TX", title: "View article transaction", ariaLabel: "View article transaction" }] });
      void refresh(false, true, false);
      return broadcast.txid;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Article could not be signed or broadcast.";
      setStatus({ tone: "bad", text: receipt ? `${message} Signed transaction evidence is retained in Transaction recovery. Check its status before retrying.` : message });
      throw cause;
    } finally { publishSigning.current = false; setActionBusy(""); }
  }

  async function checkPublishReceipts() {
    if (publishRecoveryChecking) return;
    const expectedScope = currentWriterScope.current;
    setPublishRecoveryChecking(true);
    setPublishRecoveryError("");
    try {
      const current = scopedPublishReceipts();
      for (let start = 0; start < current.length; start += 4) {
        await Promise.all(current.slice(start, start + 4).filter(receipt => receipt.status === "unknown" || receipt.status === "pending").map(async receipt => {
          const response = await fetchProofApiJson<{ status?: string }>(`/api/v1/tx/${receipt.txid}/status`, receipt.network);
          if (currentWriterScope.current !== expectedScope) return;
          if (["confirmed", "pending", "dropped"].includes(response.status ?? "")) retainPublishReceipt({ ...receipt, status: response.status as ActionReceipt["status"] });
          else throw new Error("Article transaction status is unavailable. Recovery evidence and retry protection are retained.");
        }));
      }
    } catch (cause) {
      if (currentWriterScope.current === expectedScope) setPublishRecoveryError(cause instanceof Error ? cause.message : "Transaction status is unavailable.");
    } finally { setPublishRecoveryChecking(false); }
  }

  function assertTipScope(prepared: Pick<PreparedContentTip, "scope">) {
    if (currentTipScope.current !== prepared.scope) throw new Error("Tip fields, wallet, or network changed. Prepare a new review.");
  }

  function assertTipRecovery(targetTxid: string, walletAddress: string, ownSignedTxid?: string) {
    const unresolved = readActionReceipts(localStorage).find(row => row.txid !== ownSignedTxid &&
      row.key === `boost-tip:${targetTxid}` && sameBoostWalletAddress(row.address, walletAddress) &&
      row.network === "livenet" && row.status === "unknown");
    if (unresolved) throw new Error("A signed tip has an unknown outcome. Check Transaction recovery before sending another tip.");
  }

  async function verifyContentTip(prepared: PreparedContentTip, ownSignedTxid?: string, checkFunding = true) {
    assertTipScope(prepared);
    assertTipRecovery(prepared.targetTxid, prepared.walletAddress, ownSignedTxid);
    if (networkRef.current !== "livenet" || !sameBoostWalletAddress(walletAddressRef.current, prepared.walletAddress))
      throw new Error("Wallet or network changed. Prepare a new tip review.");
    await ensureWalletNetwork(window.unisat!, "livenet", prepared.walletAddress);
    await assertActiveWalletAddress(window.unisat!, prepared.walletAddress);
    const fresh = await fetchProofApiJson<{ post?: BoostFeedItem }>(`/api/v1/boost?detail=${prepared.targetTxid}&fresh=1`, "livenet");
    if (!fresh.post?.confirmed || !sameBoostWalletAddress(boostOwnerAddress(fresh.post), prepared.ownerAddress))
      throw new Error("Content ownership changed or is unavailable. Refresh and review the tip again.");
    const workCapacity = prepared.currency === "WORK"
      ? await fetchBoostTipWorkCapacity(prepared.walletAddress, ownSignedTxid) : undefined;
    if (workCapacity && prepared.workSubatoms > workCapacity.spendableSubatoms)
      throw new Error(`Tip up to ${formatWorkAmount(workCapacity.spendableSubatoms)} spendable WORK. Prepare a new review.`);
    if (workCapacity) await requireBoostWorkWriteAdmission();
    if (checkFunding) {
      const utxos = await fetchProofApiJson<Array<{ txid: string; vout: number; status?: { confirmed?: boolean } }>>(
        `/api/v1/address/${encodeURIComponent(prepared.walletAddress)}/utxo`, "livenet");
      if (!Array.isArray(utxos)) throw new Error("Fresh tip funding evidence is unavailable.");
      const available = new Set(utxos.filter(row => row.status?.confirmed === true).map(row => `${row.txid}:${row.vout}`));
      const reserved = await fetchReservedAmoAnchorOutpoints(prepared.walletAddress, "livenet",
        [...boostListingAnchorOutpoints(items), ...(workCapacity?.anchorOutpoints ?? [])]);
      const protectedInputs = new Set(reserved.map(row => `${row.txid}:${row.vout}`));
      if (prepared.review.evidence!.inputs.some(input => !available.has(input.outpoint) || protectedInputs.has(input.outpoint)))
        throw new Error("Reviewed tip funding changed or became reserved. Prepare a new review.");
    }
    assertTipScope(prepared);
  }

  async function prepareContentTip(item: BoostFeedItem) {
    if (paidActionInFlight.current || actionBusy) return;
    const targetTxid = boostItemTxid(item), ownerAddress = boostOwnerAddress(item);
    const scope = tipScope, currency = tipCurrency, amountSats = currency === "proofs" ? boostTipAmount(tipAmountText) : 0;
    const workSubatoms = currency === "WORK" ? workAtomsFromDecimal(tipWorkAmountText) : 0n;
    if (!targetTxid || !isValidBitcoinAddress(ownerAddress, "livenet")) {
      setStatus({ tone: "bad", text: "The confirmed current content owner is unavailable." }); return;
    }
    if (amountSats === null || workSubatoms === null || currency === "WORK" && workSubatoms <= 0n) {
      setStatus({ tone: "bad", text: currency === "WORK" ? "Enter a positive WORK amount using up to 16 decimal places." : "Enter a positive whole-proof tip amount." }); return;
    }
    paidActionInFlight.current = true; setActionBusy("tip");
    setStatus({ tone: "idle", text: "Preparing exact tip review..." });
    try {
      const ready = await ensureBoostWriterReady(false);
      const workCapacity = currency === "WORK" ? await fetchBoostTipWorkCapacity(ready.walletAddress) : undefined;
      if (workCapacity && workSubatoms > workCapacity.spendableSubatoms)
        throw new Error(`Tip up to ${formatWorkAmount(workCapacity.spendableSubatoms)} spendable WORK.`);
      if (workCapacity) await requireBoostWorkWriteAdmission();
      assertTipRecovery(targetTxid, ready.walletAddress);
      const tip = currency === "WORK" ? buildBoostWorkTip(targetTxid, workSubatoms) : buildBoostTip(targetTxid, amountSats);
      const records = currency === "WORK" ? [tip.payload] : [tip.payload, buildBoostTip(targetTxid, amountSats).mailPayload];
      const exclusions = await fetchReservedAmoAnchorOutpoints(ready.walletAddress, "livenet",
        [...boostListingAnchorOutpoints(items), ...(workCapacity?.anchorOutpoints ?? [])]);
      const payment = await buildBoostPaymentPsbt({ excludeOutpoints: exclusions, feeRate,
        fromAddress: ready.walletAddress, network: "livenet",
        payments: currency === "proofs" ? [{ address: ownerAddress, amountSats }] : [],
        protocolPayloads: records,
        postProtocolPayments: currency === "WORK" ? [{ address: BOOST_WORK_REGISTRY_ADDRESS, amountSats: BOOST_WORK_MUTATION_PROOFS }] : [],
        postProtocolPayloads: currency === "WORK" ? [buildBoostWorkSendPayload(workSubatoms, ownerAddress)] : [],
      });
      const evidence = inspectPreparedPayment({ psbtHex: payment.psbtHex, network: bitcoin.networks.bitcoin,
        paymentCount: currency === "proofs" ? 1 : 0, registryPaymentCount: currency === "WORK" ? 1 : 0,
        feeSats: payment.feeSats, changeSats: payment.changeSats });
      const amountText = currency === "WORK" ? formatWorkAmount(workSubatoms, true) : String(amountSats);
      const prepared: PreparedContentTip = { scope, targetTxid, ownerAddress, walletAddress: ready.walletAddress,
        currency, amountText, amountSats, workSubatoms, feeRate, payment,
        review: { title: "Review content tip", networkLabel: "Mainnet", feeRate: String(feeRate),
          dustFeeProofs: String(payment.dustFeeSats), evidence,
          paymentLabels: [currency === "WORK" ? "WORK registry mutation payment" : "Tip paid to current content owner"],
          fields: [["Content transaction", targetTxid], ["Current confirmed owner", ownerAddress], ["Tip", `${amountText} ${currency}`],
            ...(currency === "WORK" ? [["Exact WORK subatoms", workSubatoms.toString()] as [string, string]] : [])],
          explanation: currency === "WORK" ? "The exact WORK tip goes to the current confirmed content owner. The 546-proof WORK registry payment and miner fee are separate. No proofs are tipped to the owner." : "The exact proof tip goes to the current confirmed content owner. The miner fee is separate." } };
      await verifyContentTip(prepared);
      tipReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPreparedTip(prepared); setStatus({ tone: "idle", text: "Review the exact tip before continuing to your wallet." });
    } catch (cause) { setStatus({ tone: "bad", text: cause instanceof Error ? cause.message : "Tip preparation failed." }); }
    finally { paidActionInFlight.current = false; setActionBusy(""); }
  }

  async function signContentTip() {
    if (!preparedTip || paidActionInFlight.current || actionBusy) return;
    const prepared = preparedTip;
    let receipt: ActionReceipt | undefined;
    paidActionInFlight.current = true; setActionBusy("tip");
    try {
      await verifyContentTip(prepared);
      const broadcast = await signAndBroadcastBoostPsbt({ network: "livenet", wallet: window.unisat!,
        signingAddress: prepared.walletAddress, psbtHex: prepared.payment.psbtHex,
        inputCount: prepared.payment.inputCount, signInputIndexes: prepared.payment.walletInputIndexes,
        onSigned: txid => {
          receipt = { txid, address: prepared.walletAddress, network: "livenet", title: "Content tip",
            key: `boost-tip:${prepared.targetTxid}`, status: "unknown", createdAt: new Date().toISOString(),
            fields: [["Target", prepared.targetTxid], ["Recipient", prepared.ownerAddress], ["Currency", prepared.currency],
              ["Tip amount", prepared.amountText], ...(prepared.currency === "WORK" ? [["WORK subatoms", prepared.workSubatoms.toString()] as [string, string]] : [])] };
          const receipts = saveActionReceipt(localStorage, receipt);
          setTipReceipts(receipts.filter(row => row.key.startsWith("boost-tip:") && sameBoostWalletAddress(row.address, prepared.walletAddress)));
        },
        beforeBroadcast: () => verifyContentTip(prepared, receipt?.txid),
      });
      if (receipt) setTipReceipts(saveActionReceipt(localStorage, { ...receipt, status: "pending" })
        .filter(row => row.key.startsWith("boost-tip:") && sameBoostWalletAddress(row.address, prepared.walletAddress)));
      setPreparedTip(undefined); setPendingPaidAction(undefined);
      setStatus({ tone: "good", text: `Tip broadcast: ${shortAddress(broadcast.txid)}.`, links: [{ href: broadcast.url, text: "View TX", ariaLabel: "View tip transaction" }] });
      void refresh(false, true, false);
    } catch (cause) {
      setPreparedTip(undefined);
      setStatus({ tone: "bad", text: `${cause instanceof Error ? cause.message : "Tip failed."}${receipt ? " Signed evidence remains in Transaction recovery. Check its status before retrying." : ""}` });
    } finally { paidActionInFlight.current = false; setActionBusy(""); }
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
      const signature = await window.unisat.signMessage(message, /^(?:bc1p|tb1p)/iu.test(address) ? "bip322-simple" : "ecdsa");
      const intent = {
        address,
        createdAt,
        id: profileId,
        message,
        network: "livenet" as const,
        signature,
      };
      const sharedIntent = await publishSocialIdentityIntent(intent);
      if (!sharedIntent) throw new Error("Signed ID selection could not be verified against current confirmed ownership.");
      setActiveIdentity(sharedIntent);
      setSelectedIdentityId(sharedIntent.id);
      setStatus({
        tone: "good",
        text: `${profileId}@proofofwork.me selected for Boost and Publish.`,
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

  async function publishProfileImages(images: { image?: BoostProfileImage | null; banner?: BoostProfileImage | null }) {
    try {
      if (network !== "livenet") throw new Error("Choose Mainnet and reload your image files before publishing.");
      const ready = await ensureBoostWriterReady(false);
      const sent = await broadcastBoostPayload({
        action: "profile", paymentLabel: "Boost profile images",
        payments: [{ address: ready.walletAddress, amountSats: BOOST_ACTION_PAYMENT_SATS }],
        protocolPayload: buildBoostProfilePayload({ ...images }),
        walletAddress: ready.walletAddress,
      });
      if (sent) setImageEditorOpen(false);
      return sent;
    } catch (error) {
      setStatus({ tone: "bad", text: error instanceof Error ? error.message : "Profile image publishing failed." });
      return false;
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
    if (fresh && !append) void checkTipReceipts();
    if (isSearchView && !indexedSearchQuery) {
      setBusy(false);
      if (announce) setStatus({ tone: "idle", text: "Search Boost by keyword, hashtag, or cashtag." });
      return;
    }
    const request = readLifecycle.current.begin();
    const ownsRequest = () => request.current() && currentReadScope.current === readScope;
    setBusy(true);
    if (announce) setStatus({ tone: "idle", text: `Refreshing ${surfaceName}...` });
    try {
      const params = new URLSearchParams({
        limit: "50",
        sort: sortMode,
        window: valueWindow,
      });
      if (isPublish) params.set("format", "article");
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
        params.set("view", isSearchView ? "all" : timelineMode);
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
          text: `${surfaceName} indexed ${total.toLocaleString()} record${total === 1 ? "" : "s"}.`,
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
    isSearchView,
  ]);

  useEffect(() => {
    if (isSearchView || profileSearchActive) profileSearchRef.current?.focus();
  }, [isSearchView, profileSearchActive]);

  useEffect(() => {
    if (previousInitialNetwork.current !== initialNetwork) {
      previousInitialNetwork.current = initialNetwork;
      setNetwork(initialNetwork);
    }
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
  }, [hasUnisat]);

  useEffect(() => {
    setActiveIdentity(undefined);
    setSelectedIdentityId("");
    if (!address) return;
    return subscribeSocialIdentityIntent(address, network, intent => {
      setActiveIdentity(intent);
      setSelectedIdentityId(intent?.id ?? "");
    });
  }, [address, network]);

  useEffect(() => {
    if (!isPublish) return;
    try { setPublishReceipts(scopedPublishReceipts()); setPublishRecoveryError(""); }
    catch (cause) { setPublishRecoveryError(cause instanceof Error ? cause.message : "Recovery evidence is unavailable."); }
    void checkPublishReceipts();
  }, [address, network, isPublish]);

  useEffect(() => {
    if (!isPublish) return;
    const restoreWriterLocation = (event: PopStateEvent) => {
      const nextWriting = isPublishWriterLocation();
      if (publishWriterOpenRef.current && !nextWriting && publishWriterLeaveGuard.current && !publishWriterLeaveGuard.current()) {
        event.stopImmediatePropagation();
        const destination = window.location.href;
        const mailReturn = Boolean(window.history.state?.proofOfWorkMailCompose);
        const state = publishWriterHistoryState(destination, mailReturn ? "Mail" : "Articles");
        window.history.pushState(state, "", publishWriteHref({ network: networkRef.current, embedded }));
        setPublishWriterReturn(readPublishWriterReturn(state));
        return;
      }
      setPublishWriterOpen(nextWriting);
      setPublishWriterReturn(readPublishWriterReturn(window.history.state));
      setPublishRestoreDraft(undefined);
      setToolsOpen(false);
      clearSocialOverlays();
    };
    const beforeWriterLeave = (event: Event) => {
      if (publishWriterOpenRef.current && publishWriterLeaveGuard.current && !publishWriterLeaveGuard.current()) event.preventDefault();
    };
    window.addEventListener("popstate", restoreWriterLocation, true);
    window.addEventListener("proofofwork:before-publish-writer-leave", beforeWriterLeave);
    return () => {
      window.removeEventListener("popstate", restoreWriterLocation, true);
      window.removeEventListener("proofofwork:before-publish-writer-leave", beforeWriterLeave);
    };
  }, [isPublish, embedded]);

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
    const initialFocus = panel?.querySelector<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
        );
    initialFocus?.focus();

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
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusableSelector =
      "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary";
    const focusFrame = window.requestAnimationFrame(() =>
      dialog?.querySelector<HTMLElement>(focusableSelector)?.focus(),
    );
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (publishSigning.current) return;
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
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [modalOpen]);

  useEffect(() => {
    const surface = boostSurfaceRef.current;
    if (!surface) {
      return;
    }

    const closeDesktopDrawer = () => {
      setDiscoveryOpen(surface.getBoundingClientRect().width > 1120);
      if (surface.getBoundingClientRect().width > 1120) {
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

  const [discoveryOpen, setDiscoveryOpen] = useState(false);

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
      value: payload
        ? Number.isSafeInteger(payload.totalCount)
          ? Number(payload.totalCount).toLocaleString()
          : payload.hasMore === false
            ? visibleItems.length.toLocaleString()
            : "Unavailable"
        : readStateLabel,
    },
    {
      label: "Loaded Listings",
      value: payload ? activeMarketListings.length.toLocaleString() : readStateLabel,
    },
  ];

  function openTools() {
    toolsInvokerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setToolsOpen(true);
  }

  function openProfileSearch() {
    setProfileSearchActive(true);
    profileSearchRef.current?.focus();
  }

  function openToolsForCompactSurface() {
    const surfaceWidth = boostSurfaceRef.current?.getBoundingClientRect().width;
    if ((surfaceWidth ?? window.innerWidth) <= 1120) {
      openTools();
    }
  }

  function updateSearchQuery(value: string) {
    setSearchQuery(value);
    const url = new URL(window.location.href);
    url.searchParams.delete("search");
    url.searchParams.set("network", network);
    if (isProfileView && !value.trim()) url.searchParams.delete("q");
    else url.searchParams.set("q", value.trim());
    if (isSearchView) url.searchParams.set("mode", "search");
    window.history.replaceState(null, "", url);
    if (isSearchView && !value.trim()) {
      readLifecycle.current.cancel();
      setBusy(false);
      setStatus({ tone: "idle", text: "Search Boost by keyword, hashtag, or cashtag." });
    }
  }

  function renderSearchControl() {
    const label = isProfileView ? "Search this profile" : `Search ${surfaceName}`;
    return <form className="boost-search boost-route-search" role="search" aria-label={label}
      onSubmit={event => { event.preventDefault(); setIndexedSearchQuery(searchQuery.trim()); }}>
      <Search size={15} aria-hidden="true" />
      <input autoComplete="off" onChange={event => updateSearchQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Escape" && isProfileView) {
            event.preventDefault();
            updateSearchQuery("");
            setIndexedSearchQuery("");
            setProfileSearchActive(false);
            profileSearchTriggerRef.current?.focus();
          }
        }}
        aria-label={label} placeholder={label} ref={profileSearchRef} value={searchQuery} />
    </form>;
  }

  function openBoostComposer(quote?: BoostFeedItem) {
    setToolsOpen(false);
    setQuoteTarget(quote);
    if (quote) setPostText("");
    setPostSignalSats(546);
    setPostWorkAmount("0");
    setPostAttachment(undefined);
    setDirectPostOpen(true);
  }

  function openPublishComposer() {
    if (publishSigning.current) return;
    setPublishRestoreDraft(undefined);
    openPublishWriter();
  }

  function openPublishWriter() {
    setToolsOpen(false);
    clearSocialOverlays();
    if (!isPublishWriterLocation()) {
      const state = publishWriterHistoryState(window.location.href);
      window.history.pushState({ ...window.history.state, ...state }, "", publishWriteHref({ network, embedded }));
    }
    setPublishWriterReturn(readPublishWriterReturn(window.history.state));
    setPublishWriterOpen(true);
  }

  function clearSocialOverlays() {
    setImageEditorOpen(false);
    setDirectPostOpen(false);
    setExpandedItem(undefined);
    setPendingPaidAction(undefined);
    setReplyTarget(undefined);
    setQuoteTarget(undefined);
  }

  function closePublishWriter() {
    if (publishSigning.current) return;
    setPublishRestoreDraft(undefined);
    if (readPublishWriterReturn(window.history.state)) {
      window.history.back();
      return;
    }
    window.history.replaceState(null, "", publishHref({ network, embedded }));
    setPublishWriterReturn(undefined);
    setPublishWriterOpen(false);
  }

  function renderIdentityControls() {
    return <section className="boost-action-panel">
      <div className="boost-action-panel-head"><strong>Identity</strong>
        {activeIdentity ? <span>{activeIdentity.id}@proofofwork.me</span> : null}</div>
      {address ? ownedIds.length > 0 ? <>
        <label>ID<select disabled={Boolean(actionBusy)} onChange={event => setSelectedIdentityId(event.target.value)} value={selectedIdentityId}>
          {ownedIds.map(record => { const id = normalizeBoostId(record.id); return <option key={id} value={id}>{id}@proofofwork.me</option>; })}
        </select></label>
        <div className="boost-action-buttons">
          <button className="secondary small" disabled={Boolean(actionBusy) || !selectedIdentityId} onClick={() => void signIdentityIntent()} type="button">
            <span className="button-content"><UserCircle size={15} /><span>{actionBusy === "identity" ? "Signing" : "Sign ID"}</span></span>
          </button>
          {publishWriterOpen ? null : <button className="secondary small" disabled={Boolean(actionBusy) || !activeIdentity} onClick={() => void publishProfileIntent()} type="button">
            <span className="button-content"><Send size={15} /><span>{actionBusy === "profile" ? "Publishing" : "Publish"}</span></span>
          </button>}
        </div>
      </> : <p className="field-note">This wallet has no confirmed IDs.</p> :
        <button className="secondary small" disabled={Boolean(actionBusy)} onClick={() => void connectWallet()} type="button">
          <span className="button-content"><UserCircle size={15} /><span>Connect</span></span>
        </button>}
    </section>;
  }

  const timelineHref = isPublish ? publishHref({ network, embedded }) : boostTimelineHref(embedded, network);
  const myProfileHref = isPublish ? publishHref({ profile: activeIdentity?.id || address, network, embedded }) : boostProfileHref(activeIdentity?.id || address, embedded);
  const composeSurface = isPublish ? openPublishComposer : onComposeBoost ?? (() => openBoostComposer());

  function renderBoostPost(item: BoostFeedItem, articleReader = false) {
    return (
      <BoostPost
        articleReader={articleReader}
        publishSurface={isPublish}
        embedded={embedded}
        actionBusy={actionBusy}
        activeAddress={address}
        activeIdentity={activeIdentity}
        profileAddress={isProfileView ? profileSubjectAddress : undefined}
        item={item}
        key={item.eventId ?? `${item.kind}-${item.txid}`}
        network={network}
        onFollow={(followAction, boostItem) =>
          void publishFollowAction(followAction, boostItem)
        }
        onLike={(boostItem) =>
          setPendingPaidAction({ action: "like", item: boostItem })
        }
        onTip={(boostItem) => {
          setTipAmountText(String(BOOST_TIP_DEFAULT_SATS));
          setTipCurrency("proofs"); setTipWorkAmountText("1"); setPreparedTip(undefined);
          setPendingPaidAction({ action: "tip", item: boostItem });
        }}
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
    <BoostTextProvider embedded={embedded} network={network} snapshotId={payload?.snapshotId}>
    <div
      className={[
        embedded ? "boost-public-app boost-embedded-app" : "mail-app boost-public-app",
        isProfileView ? "boost-profile-surface" : isSearchView ? "boost-search-surface" : "",
        isProfileView && profileSearchActive ? "boost-profile-search-active" : "",
        isPublish ? "publish-public-app" : "",
      ].filter(Boolean).join(" ")}
      ref={boostSurfaceRef}
    >
      {embedded ? null : (
        <AppHeader
          accountStats={[]}
          address={address}
          busy={busy || Boolean(actionBusy)}
          connectWallet={() => void connectWallet()}
          disconnectWallet={disconnectWallet}
          hasUnisat={hasUnisat}
          network={network}
          onNetworkChange={setNetwork}
          onRefresh={() => { void refresh(false, true); if (isPublish) void checkPublishReceipts(); }}
          subtitle={isPublish ? "Stories published on ProofOfWork" : "Proof-ranked social signal"}
          title={surfaceName}
        />
      )}
      <AppStatusRow persistent status={status} />
      <ActionRecoveryPanel receipts={tipReceipts} error={tipRecoveryError} checking={tipRecoveryChecking}
        restoringDisabled={Boolean(actionBusy)} canRestore={() => false} onRestore={() => { setStatus({ tone: "idle", text: "Inspect the tip transaction and its status. Open the target content to review a new tip." }); }}
        onCheck={() => void checkTipReceipts()} workspaceHref={receipt => isPublish ? publishHref({ txid: receipt.fields.find(field => field[0] === "Target")?.[1], network: receipt.network, embedded }) : boostTimelineHref(embedded, receipt.network)} />
      {isPublish ? <ActionRecoveryPanel receipts={publishReceipts} error={publishRecoveryError}
        checking={publishRecoveryChecking} restoringDisabled={Boolean(actionBusy)}
        canRestore={receipt => receipt.status === "dropped"}
        onRestore={receipt => {
          const fields = Object.fromEntries(receipt.fields);
          setPublishRestoreDraft({ address: receipt.address, network: receipt.network,
            draft: { title: fields.Title ?? "", body: fields.Body ?? "", signal: Number(fields["Proof signal"] ?? 546), feeRate: Number(fields["Fee rate"] ?? 1) } });
          openPublishWriter();
        }} onCheck={() => void checkPublishReceipts()} workspaceHref={receipt => publishHref({ txid: receipt.txid, network: receipt.network, embedded })} /> : null}
      {isPublish && publishWriterOpen ? <section className="publish-writer-workspace" aria-label="Article writer" role={embedded ? undefined : "main"}>
        {address ? <details className="publish-writer-identity"><summary>Byline identity · {activeIdentity?.id ? `${activeIdentity.id}@proofofwork.me` : shortAddress(address)}</summary>{renderIdentityControls()}</details> : null}
        <PublishComposer address={address} network={network} identity={activeIdentity}
          returnLabel={publishWriterReturn?.returnLabel}
          restoreDraft={publishRestoreDraft && sameBoostWalletAddress(publishRestoreDraft.address, address) && publishRestoreDraft.network === network ? publishRestoreDraft.draft : undefined}
          onConnect={() => void connectWallet()} onClose={closePublishWriter}
          onLeaveGuardChange={guard => { publishWriterLeaveGuard.current = guard; }}
          onPrepare={preparePublishArticle} onSign={signPublishArticle} />
      </section> : <>
      {!isProfileView ? (
        <details className="boost-network-stats">
          <summary>Network stats</summary>
          <dl>{accountStats.map((stat) => <div key={stat.label}><dt>{stat.label}</dt><dd title={stat.detail}>{stat.value}</dd></div>)}</dl>
        </details>
      ) : null}

      <div
        aria-label={embedded ? undefined : isSearchView ? `${surfaceName} search` : `${surfaceName} timeline`}
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
        <nav className="boost-compact-nav" aria-label={`${surfaceName} navigation`}>
          <a href={timelineHref} aria-label="Home" title="Home"><Home size={22} /><span>Home</span></a>
          <a href={isPublish ? `${publishHref({ network, embedded })}&mode=search` : boostSearchHref(embedded, network)} aria-label={`Search ${surfaceName}`} title={`Search ${surfaceName}`} aria-current={isSearchView ? "page" : undefined}><Search size={22} /><span>Search</span></a>
          {address ? <a href={myProfileHref} aria-label="My profile" title="My profile"><UserCircle size={22} /><span>Profile</span></a> :
            <button onClick={openTools} type="button" aria-label="Connect profile" title="Connect profile"><UserCircle size={22} /><span>Profile</span></button>}
          <a href={isPublish ? appHref("https://boost.proofofwork.me/", "/?boost=1") : publishHref({ network })} aria-label={isPublish ? "Open Boost" : "Open Publish"} title={isPublish ? "Open Boost" : "Open Publish"}><BookOpen size={22} /><span>{isPublish ? "Boost" : "Publish"}</span></a>
          <button className="primary" onClick={composeSurface} type="button" aria-label={isPublish ? "Write an article" : "Post a Boost"} title={isPublish ? "Write an article" : "Post a Boost"}><BookOpen size={22} /><span>{isPublish ? "Write" : "Post"}</span></button>
        </nav>
        <aside
          aria-label={`${surfaceName} tools`}
          aria-modal={toolsOpen || undefined}
          className={toolsOpen ? "boost-sidebar is-open" : "boost-sidebar"}
          id="boost-tools-panel"
          ref={toolsPanelRef}
          role={toolsOpen ? "dialog" : undefined}
        >
          <div className="boost-sidebar-mobile-head">
            <div>
              <span>{surfaceName} controls</span>
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
            {isPublish ? <button className="primary" onClick={openPublishComposer} type="button"><span className="button-content"><BookOpen size={16} /><span>Write an article</span></span></button> : onComposeBoost ? (
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
              href={timelineHref}
            >
              <span className="button-content">
                <Clock size={16} />
                <span>Timeline</span>
              </span>
            </a>
          ) : null}

          {renderIdentityControls()}

          {address ? <button className="secondary" type="button" disabled={Boolean(actionBusy)} onClick={() => setImageEditorOpen(true)}>Profile images</button> : null}

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

          <a className="secondary link-button boost-search-nav-link" href={isPublish ? `${publishHref({ network, embedded })}&mode=search` : boostSearchHref(embedded, network)}
            aria-current={isSearchView ? "page" : undefined}>
            <span className="button-content"><Search size={16} /><span>Search {surfaceName}</span></span>
          </a>

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
              <span>AMO</span>
            </span>
          </a>
        </aside>

          {imageEditorOpen && address ? <BoostProfileImages key={`${network}:${address}`} address={address} network={network}
            feeRate={feeRate} setFeeRate={setFeeRate}
            busy={Boolean(actionBusy)} publishStatus={status.text} onPublish={publishProfileImages} onClose={() => setImageEditorOpen(false)} /> : null}

        <section className="boost-feed-panel">
          {isSearchView ? (
            <header className="boost-search-head">
              <a className="secondary small link-button" href={timelineHref}
                aria-label="Back to timeline" title="Back to timeline"><ArrowLeft size={20} /></a>
              {renderSearchControl()}
            </header>
          ) : null}
          {isPublish && articleRoute ? <section className="publish-reader" aria-label="Published article">
            <div className="publish-reader-titlebar"><a className="secondary small link-button" href={timelineHref}
              aria-label="Back to articles" title="Back to articles"><ArrowLeft size={20} /></a><strong>Read on ProofOfWork</strong></div>
            {articleTxid ? <BoostActivity key={`${network}:${articleTxid}`} txid={articleTxid} network={network} viewer={address}
              renderPost={post => renderBoostPost(post, post.txid === articleTxid)} /> :
              <div className="publish-read-error" role="alert"><h2>Invalid article transaction</h2><p>Open an article with its full 64-character transaction ID.</p></div>}
          </section> : isProfileView && connectionsTab ? (
            <BoostConnections profile={profileRouteValue} tab={connectionsTab} onTab={selectConnections}
              network={network} viewer={address} onBack={() => selectConnections()}
              onFollow={(target, id, following) => { if (!actionBusy) void publishFollowTarget(following ? "unfollow" : "follow", target, id); }} />
          ) : <>
          {isProfileView ? (
            <>
            <div className="boost-profile-titlebar">
              <a className="secondary small link-button" href={timelineHref} aria-label="Back to timeline" title="Back to timeline">
                <ArrowLeft size={20} />
              </a>
              <div className="boost-profile-title">
                <strong title={profileSubjectDisplay(payload)}>{profileSubjectDisplay(payload)}</strong>
                <span>{profileCount(profileBoostCount)} {isPublish ? profileBoostCount === 1 ? "Article" : "Articles" : profileBoostCount === 1 ? "Boost" : "Boosts"}</span>
              </div>
              <button className="secondary small" onClick={openProfileSearch} ref={profileSearchTriggerRef} type="button" aria-label="Search this profile" title="Search this profile">
                <Search size={20} />
              </button>
            </div>
            <div className="boost-profile-head">
              <ProfileImage pointer={profileSubject?.profile?.banner} network={network} className="boost-profile-cover" alt="Profile banner" expandable />
              <div className="boost-profile-main">
                <ProfileImage pointer={profileSubject?.profile?.image} network={network}
                  className="boost-profile-avatar" fallback={profileSubjectAvatarText(payload)} alt="Profile picture" expandable />
                <div className="boost-profile-copy">
                  <h2>{profileSubjectDisplay(payload)}</h2>
                  <p>{profileSubjectHandle(payload) || profileRouteValue}</p>
                  <div className="boost-profile-stats" aria-label="Profile connections">
                    <button type="button" onClick={() => selectConnections("following")}><strong>{profileCount(profileSubject?.followingCount)}</strong> Following</button>
                    <button type="button" onClick={() => selectConnections("followers")}><strong>{profileCount(profileSubject?.followerCount)}</strong> Followers</button>
                  </div>
                  <div className="boost-profile-signal" aria-label="Profile signal">
                    <span>{profileSubject ? <CompactSignal value={boostSignalQ8(profileSubject.totalSignalQ8, profileSubject.totalSignalSatsExact, profileSubject.totalSignalSats ?? 0)} /> : "Unavailable"} signal</span>
                    {profileWorkSignalSubatoms > 0n ? (
                      <span>{formatWorkSignal(profileWorkSignalSubatoms)}</span>
                    ) : null}
                  </div>
                  <details className="boost-profile-identity boost-network-stats">
                    <summary>Identity & proof details</summary>
                    <dl>
                      {profileSubjectId ? <div><dt>ProofOfWork ID</dt><dd>{profileSubjectId}@proofofwork.me</dd></div> : null}
                      <div><dt>Profile address</dt><dd>{profileSubjectAddress || "Unavailable"}</dd></div>
                      {accountStats.filter((stat) => stat.label !== "Wallet").map((stat) => (
                        <div key={stat.label}><dt>{stat.label}</dt><dd title={stat.detail}>{stat.value}</dd></div>
                      ))}
                    </dl>
                  </details>
                </div>
                {profileSelfView ? <button className="secondary small boost-profile-edit" onClick={() => {
                  setImageEditorOpen(true);
                }} type="button">Edit profile</button> : null}
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
                    <span>{isPublish && option.value === "boosts" ? "Articles" : option.label}</span>
                    <strong>{payload?.profileTabs?.[option.value] ?? "—"}</strong>
                  </button>
                ))}
              </div>
            </div>
            </>
          ) : !isSearchView ? (
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
                    {isPublish && option.value === "all" ? "Articles" : option.label}
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
                {!onComposeBoost && !isPublish ? <label className="boost-inline-draft">
                  <textarea aria-label="Boost text" maxLength={140} placeholder="Share a proof-backed thought" rows={2} value={postText} onChange={(event) => setPostText(event.target.value)} />
                </label> : null}
                {onComposeBoost && !isPublish ? (
                  <button
                    className="boost-composer-prompt"
                    onClick={onComposeBoost}
                    type="button"
                  >
                    Review Boost
                  </button>
                ) : (
                  <button
                    className="boost-composer-prompt"
                    onClick={composeSurface}
                    type="button"
                  >
                    {isPublish ? "Write your next article" : "Review Boost"}
                  </button>
                )}
                <p className="boost-composer-hint">{isPublish ? "Text stories · Shared Boost replies, likes, and reboosts" : "140 characters · Proof / WORK · Files"}</p>
              </div>
            </div>
          ) : null}
          {isProfileView && profileSearchActive ? renderSearchControl() : null}
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
            <label className="boost-mobile-filter">Period
              <select aria-label="Boost value window" value={valueWindow} onChange={(event) => setValueWindow(event.target.value as typeof valueWindow)}>
                {VALUE_WINDOWS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="boost-mobile-filter">Sort
              <select aria-label="Boost sort" value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)}>
                {SORT_MODES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
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
            {!isProfileView || embedded ? <button
              className="secondary small"
              disabled={busy}
              onClick={() => void refresh(false, true)}
              type="button"
            >
              <span className="button-content">
                <RefreshCw className={busy ? "refresh-spin" : ""} size={15} />
                <span>{busy ? "Refreshing" : "Refresh"}</span>
              </span>
            </button> : null}
          </div>

          <div
            aria-labelledby={
              isSearchView ? undefined : isProfileView
                ? `boost-profile-tab-${profileTab}`
                : `boost-timeline-tab-${timelineMode}`
            }
            aria-label={isSearchView ? "Boost search results" : undefined}
            className="boost-feed"
            id={isSearchView ? "boost-search-results" : isProfileView ? "boost-profile-panel" : "boost-timeline-panel"}
            role={isSearchView ? "region" : "tabpanel"}
            tabIndex={0}
          >
            {emptySearch ? (
              <div className="boost-empty">
                <Search size={28} />
                <h2>Search {surfaceName}</h2>
                <p>Find Boosts by keyword, hashtag, or cashtag.</p>
              </div>
            ) : visibleItems.length > 0 ? (
              visibleItems.map((item) => renderBoostPost(item))
            ) : (
              <div className="boost-empty">
                <Zap size={28} />
                <h2>
                  {isPublish ? (!payload ? busy || searchPending ? "Loading articles" : "Article history unavailable" : timelineMode === "following" ? address ? "No articles from followed writers yet" : "Connect to load Following" : "No confirmed articles yet") : !payload ? busy || searchPending ? "Loading Boost history" : "Boost history unavailable" : isSearchView
                    ? "No Boosts match your search"
                    : isProfileView
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
                {busy ? "Loading..." : isPublish ? "Load more articles" : "Load more Boosts"}
              </button>
            ) : null}
          </div>
          </>}
        </section>

        <aside className="boost-right-rail" aria-label="Boost discovery">
          <details className="boost-discovery-details" open={discoveryOpen} onToggle={(event) => setDiscoveryOpen(event.currentTarget.open)}>
          <summary>{isPublish ? "Explore articles" : "Explore Boost"}</summary>
          <div className="boost-discovery-content">
          <section className="boost-rail-panel">
            <div className="boost-rail-head">
              <strong>{isProfileView ? "Profile Signal" : "Signal Now"}</strong>
              <span>{payload?.indexedAt ? formatDate(payload.indexedAt) : "Awaiting canonical history"}</span>
            </div>
            <div className="boost-rail-stats">
              <span>
                <strong>
                  {payload ? <CompactSignal value={
                    isProfileView
                      ? boostSignalQ8(profileSubject?.totalSignalQ8, profileSubject?.totalSignalSatsExact, profileSubject?.totalSignalSats ?? 0)
                      : headerSignalStats.totalSignalQ8
                  } /> : "Unavailable"}
                </strong>
                Total
              </span>
              <span>
                <strong>
                  {payload ? <CompactSignal value={
                    isProfileView
                      ? boostSignalQ8(profileSubject?.proofSignalQ8, profileSubject?.proofSignalSatsExact, profileSubject?.proofSignalSats ?? 0)
                      : headerSignalStats.proofSignalQ8
                  } /> : "Unavailable"}
                </strong>
                Proof
              </span>
              <span>
                <strong>
                  {isProfileView
                    ? Number.isSafeInteger(profileSubject?.followerCount)
                      ? Number(profileSubject?.followerCount).toLocaleString()
                      : "Unavailable"
                    : Number.isSafeInteger(payload?.graph?.followingCount)
                      ? Number(payload?.graph?.followingCount).toLocaleString()
                      : "Unavailable"}
                </strong>
                {isProfileView ? "Followers" : "Following"}
              </span>
            </div>
          </section>

          <section className="boost-rail-panel">
            <div className="boost-rail-head">
              <strong>{isPublish ? "Top articles" : "Top Boosts"}</strong>
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
                    <CompactSignal value={boostTotalSignalQ8(item)} />
                  </a>
                ))
              ) : (
                <span>
                  {payload
                    ? "No Boost signal in this verified snapshot."
                    : readStateLabel}
                </span>
              )}
            </div>
          </section>

          <section className="boost-rail-panel">
            <div className="boost-rail-head">
              <strong>Who To Follow</strong>
              <span>{payload ? suggestedProfiles.length.toLocaleString() : "—"}</span>
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
                      <small>{followerLabel(item.followerCount)}</small>
                    </span>
                    <span className="boost-suggestion-follow"><UserPlus size={15} /> Follow</span>
                  </button>
                ))
              ) : (
                <span>
                  {payload
                    ? isProfileView
                      ? "No other profile suggestions in this verified view."
                      : "Connect and refresh to find active Boost profiles."
                    : readStateLabel}
                </span>
              )}
            </div>
          </section>

          {activeMarketListings.length > 0 ? (
            <section className="boost-rail-panel">
              <div className="boost-rail-head">
                <strong>{isPublish ? "Listed articles" : "Listed Boosts"}</strong>
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
          </div>
          </details>
        </aside>
      </div>

      {preparedTip ? <ActionTransactionReview review={preparedTip.review} returnFocus={tipReturnFocus.current}
        onCancel={() => { if (!paidActionInFlight.current) setPreparedTip(undefined); }}
        onApprove={() => void signContentTip()} /> : null}
      {modalOpen ? (
        <div className="boost-modal-backdrop">
          <button
            aria-label="Close Boost dialog"
            className="boost-modal-dismiss"
            onClick={() => {
              if (publishSigning.current) return;
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
                  aria-label="Boost text"
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
                <details className="boost-composer-preview">
                  <summary>Preview Boost</summary>
                  <p>{postText || "Attachment-only Boost"}</p>
                  {postAttachment ? <span>{postAttachment.name} · {formatBytes(postAttachment.size)}</span> : null}
                </details>
                <p className="field-note">Review and sign in your wallet. Original posts have no Boost registry fee. A WORK transfer adds its existing {BOOST_WORK_MUTATION_PROOFS}-proof mutation fee, plus the miner fee.</p>
                {!address ? <button className="secondary" disabled={Boolean(actionBusy)} onClick={() => void connectWallet()} type="button">Connect to post</button> : null}
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
                    {pendingPaidAction.action === "tip" ? "Tip" : pendingPaidAction.action === "like" ? "Like Boost" : "Reboost"}
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
                {pendingPaidAction.action === "tip" && tipCurrency === "WORK"
                  ? "The WORK tip goes to the current confirmed owner. A separate 546-proof WORK registry payment and miner fee require proof funds in your wallet."
                  : `This action sends ${pendingPaidAction.action === "tip" ? tipAmountText : BOOST_ACTION_PAYMENT_SATS.toLocaleString()} proofs to the current owner and adds them to the content signal. The miner fee is separate.`}
              </p>
              {pendingPaidAction.action === "tip" ? <>
                <label className="boost-tip-amount">Tip currency
                  <select value={tipCurrency} disabled={Boolean(actionBusy)} onChange={event => setTipCurrency(event.target.value as "proofs" | "WORK")}>
                    <option value="proofs">Proofs</option><option value="WORK">WORK credit</option>
                  </select>
                </label>
                <label className="boost-tip-amount">{`Tip amount (${tipCurrency === "WORK" ? "WORK" : "proofs"})`}
                  <input inputMode={tipCurrency === "WORK" ? "decimal" : "numeric"} type="text"
                    value={tipCurrency === "WORK" ? tipWorkAmountText : tipAmountText} disabled={Boolean(actionBusy)}
                    onChange={event => tipCurrency === "WORK" ? setTipWorkAmountText(event.target.value) : setTipAmountText(event.target.value)}
                    aria-invalid={tipCurrency === "WORK" ? tipWorkSubatoms === null || tipWorkSubatoms <= 0n : boostTipAmount(tipAmountText) === null} />
                  <small>{tipCurrency === "WORK" ? "Exact positive WORK, up to 16 decimal places. The amount is never rounded." : "Positive whole proofs. Wallet funds and network dust rules apply. The amount is never rounded up."}</small>
                </label>
                {tipCurrency === "WORK" ? <p className="field-note" role="status">{tipWorkStatus || `Spendable WORK: ${tipWorkSpendable === undefined ? "Unavailable" : formatWorkAmount(tipWorkSpendable, true)}`}</p> : null}
              </> : null}
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
                  disabled={Boolean(actionBusy) || !address || (pendingPaidAction.action === "tip" &&
                    (tipCurrency === "WORK" ? tipWorkSubatoms === null || tipWorkSubatoms <= 0n || tipWorkSpendable === undefined || tipWorkSubatoms > tipWorkSpendable : boostTipAmount(tipAmountText) === null))}
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
                      : pendingPaidAction.action === "tip"
                        ? <HandCoins size={16} />
                        : pendingPaidAction.action === "like"
                        ? <Heart size={16} />
                        : <Repeat2 size={16} />}
                    <span>
                      {actionBusy === pendingPaidAction.action
                        ? "Signing…"
                        : pendingPaidAction.action === "tip"
                          ? `Review tip · ${tipCurrency === "WORK" ? tipWorkAmountText : tipAmountText} ${tipCurrency}`
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
                  <span className="button-content"><ArrowLeft size={16} /><span>Back</span></span>
                </button>
              </div>
              <BoostActivity key={expandedItem.txid}
                txid={expandedItem.txid}
                network={network} viewer={address} renderPost={renderBoostPost} />
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
      </>}

      {embedded ? null : <SocialFooter quiet />}
    </div>
    </BoostTextProvider>
  );
}
