import { FormEvent, useEffect, useMemo, useState } from "react";
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
  Tag,
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
  buildBoostListingPayload,
  buildBoostProfilePayload,
  buildBoostReplyPayload,
  idsOwnedByAddress,
  loadBoostIdentityIntent,
  normalizeBoostId,
  saveBoostIdentityIntent,
  type BoostFeedItem,
  type BoostFeedPayload,
  type BoostIdentityIntent,
  type BoostPaidAction,
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

type BoostSortMode = "value" | "newest" | "oldest";
type BoostValueWindow = "hour" | "day" | "week" | "all";

type BoostActionBusy =
  | ""
  | "connect"
  | "identity"
  | "like"
  | "list"
  | "profile"
  | "reboost"
  | "reply";

type RegistryApiPayload = {
  record?: PowIdRecordLike | null;
  records?: PowIdRecordLike[];
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

const DEFAULT_FEE_RATE = 1;
const DEFAULT_LIST_PRICE_SATS = 1_000;

function initialSearchParam(name: string) {
  if (typeof window === "undefined") {
    return "";
  }
  return new URLSearchParams(window.location.search).get(name)?.trim() ?? "";
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

function boostTotalSignalSats(item: BoostFeedItem) {
  const total = Number(item.totalSignalSats ?? item.signalSats);
  return Number.isFinite(total) ? Math.max(0, total) : item.proofSignalSats;
}

function boostTotalSignalUsd(item: BoostFeedItem) {
  const total = Number(item.totalSignalUsd ?? item.signalUsd);
  return Number.isFinite(total) ? Math.max(0, total) : 0;
}

function boostWorkSignalValueSats(item: BoostFeedItem) {
  const value = Number(item.workSignalValueSats);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
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
  const totalSignalSats = boostTotalSignalSats(item);
  const workSignalValueSats = boostWorkSignalValueSats(item);
  const connectedOwner =
    activeAddress &&
    ownerAddress &&
    activeAddress.trim().toLowerCase() === ownerAddress.trim().toLowerCase();
  const actionsLocked = Boolean(actionBusy);

  return (
    <article className="boost-post">
      <BoostAvatar item={item} />
      <div className="boost-post-body">
        <div className="boost-post-head">
          <div>
            {profileValue ? (
              <a className="boost-author" href={boostProfileHref(profileValue)}>
                {authorLabel(item, activeIdentity, activeAddress)}
              </a>
            ) : (
              <span className="boost-author">
                {authorLabel(item, activeIdentity, activeAddress)}
              </span>
            )}
            <span>{formatDate(item.createdAt)}</span>
          </div>
          <strong>{formatProofs(totalSignalSats)}</strong>
        </div>

        {item.text ? <p className="boost-post-text">{item.text}</p> : null}

        {item.media ? (
          <div className="boost-media-pill">
            <Zap size={14} />
            <span>{item.media.name ?? item.media.mime ?? "media"}</span>
          </div>
        ) : null}

        <div className="boost-signal-row">
          <span>Total USD {formatUsd(boostTotalSignalUsd(item))}</span>
          <span>Proof {formatProofs(item.proofSignalSats)}</span>
          {item.workSignal ? (
            <span>
              WORK {item.workSignal} ({formatProofs(workSignalValueSats)})
            </span>
          ) : null}
          <span>{actionLabel(item.kind)}</span>
          <span>Owner {ownerLabel(item)}</span>
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

export default function BoostRoot() {
  const [network, setNetwork] = useState<BitcoinNetwork>("livenet");
  const [sortMode, setSortMode] = useState<BoostSortMode>("value");
  const [valueWindow, setValueWindow] = useState<BoostValueWindow>("all");
  const [profileQuery, setProfileQuery] = useState(() =>
    initialSearchParam("profile"),
  );
  const [listQuery] = useState(() => initialSearchParam("list"));
  const [searchQuery, setSearchQuery] = useState("");
  const [payload, setPayload] = useState<BoostFeedPayload | undefined>();
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<BoostActionBusy>("");
  const [hasUnisat, setHasUnisat] = useState(() => Boolean(window.unisat));
  const [address, setAddress] = useState("");
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
      if (profileQuery.trim()) {
        params.set("profile", profileQuery.trim());
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
  }, [network, profileQuery, sortMode, valueWindow]);

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
      label: "Signal",
      value: formatProofs(
        visibleItems.reduce(
          (total, item) => total + boostTotalSignalSats(item),
          0,
        ),
      ),
      tone: "strong" as const,
    },
    {
      label: "USD",
      value: formatUsd(
        visibleItems.reduce(
          (total, item) => total + boostTotalSignalUsd(item),
          0,
        ),
      ),
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

  return (
    <div className="mail-app boost-public-app">
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
      <AppStatusRow persistent status={status} />

      <main className="boost-shell">
        <aside className="boost-sidebar">
          <div className="boost-compose-panel">
            <a
              className="primary link-button"
              href={appHref(COMPUTER_APP_URL, LOCAL_COMPUTER_APP_URL)}
            >
              <span className="button-content">
                <Zap size={16} />
                <span>Post From Mail</span>
              </span>
            </a>
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

          <label className="boost-profile-filter">
            Profile
            <input
              autoComplete="off"
              onChange={(event) => setProfileQuery(event.target.value)}
              placeholder="address or id"
              value={profileQuery}
            />
          </label>

          <a className="secondary link-button" href={boostAmoHref()}>
            <span className="button-content">
              <ShoppingBag size={16} />
              <span>Boost AMO</span>
            </span>
          </a>
        </aside>

        <section className="boost-feed-panel">
          <div className="boost-feed-toolbar">
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

          <div className="boost-feed">
            {visibleItems.length > 0 ? (
              visibleItems.map((item) => (
                <BoostPost
                  actionBusy={actionBusy}
                  activeAddress={address}
                  activeIdentity={activeIdentity}
                  item={item}
                  key={`${item.kind}-${item.txid}`}
                  network={network}
                  onLike={(boostItem) =>
                    void publishPaidAction("like", boostItem)
                  }
                  onList={setListingTarget}
                  onReboost={(boostItem) =>
                    void publishPaidAction("reboost", boostItem)
                  }
                  onReply={(boostItem) => {
                    setReplyTarget(boostItem);
                    setReplyText("");
                  }}
                />
              ))
            ) : (
              <div className="boost-empty">
                <Zap size={28} />
                <h2>No confirmed Boost posts indexed yet</h2>
              </div>
            )}
          </div>
        </section>
      </main>

      <SocialFooter compact />
    </div>
  );
}
