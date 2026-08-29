import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Heart,
  MessageCircle,
  RefreshCw,
  Repeat2,
  Search,
  Share2,
  ShoppingBag,
  UserCircle,
  Zap,
} from "lucide-react";
import {
  COMPUTER_APP_URL,
  ID_APP_URL,
  LOCAL_COMPUTER_APP_URL,
  LOCAL_ID_APP_URL,
} from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { explorerTxUrl } from "../../shared/bitcoin/networks";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { AppHeader } from "../../shared/components/AppHeader";
import { AppStatusRow, type AppStatusState } from "../../shared/components/AppStatusRow";
import { SocialFooter } from "../../shared/components/SocialFooter";
import { formatDate, shortAddress } from "../../functions";

type BoostSortMode = "value" | "newest" | "oldest";
type BoostValueWindow = "hour" | "day" | "week" | "all";

type BoostProfile = {
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
};

type BoostFeedItem = {
  actionCount?: number;
  authorAddress: string;
  authorId?: string;
  boostTxid?: string;
  confirmed: boolean;
  createdAt: string;
  currentOwnerAddress?: string;
  currentOwnerId?: string;
  kind: string;
  listingPriceSats?: number;
  media?: {
    mime?: string;
    name?: string;
    sha256?: string;
    size?: number;
  };
  proofSignalSats: number;
  replyCount?: number;
  reboostCount?: number;
  likeCount?: number;
  signalUsd?: number;
  targetTxid?: string;
  text: string;
  txid: string;
  workSignal?: string;
  profile?: BoostProfile;
};

type BoostFeedPayload = {
  btcUsd?: number;
  indexedAt?: string;
  items?: BoostFeedItem[];
  network?: BitcoinNetwork;
  source?: string;
  stats?: {
    confirmed?: number;
    pending?: number;
    total?: number;
  };
  totalCount?: number;
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

function initialProfileQuery() {
  if (typeof window === "undefined") {
    return "";
  }
  return new URLSearchParams(window.location.search).get("profile")?.trim() ?? "";
}

function formatProofs(value: number | undefined) {
  const proofs = Math.max(0, Math.floor(Number(value ?? 0)));
  return `${proofs.toLocaleString()} proofs`;
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

function authorLabel(item: BoostFeedItem) {
  return item.authorId
    ? `${item.authorId}@proofofwork.me`
    : shortAddress(item.authorAddress);
}

function ownerLabel(item: BoostFeedItem) {
  return item.currentOwnerId
    ? `${item.currentOwnerId}@proofofwork.me`
    : item.currentOwnerAddress
      ? shortAddress(item.currentOwnerAddress)
      : authorLabel(item);
}

function boostProfileHref(value: string) {
  const params = new URLSearchParams({ boost: "1", profile: value });
  return `/?${params.toString()}`;
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
  const label = item.authorId || item.authorAddress || "Boost";
  return label.slice(0, 2).toUpperCase();
}

function BoostAvatar({ item }: { item: BoostFeedItem }) {
  const imageUrl = item.profile?.image?.url;
  if (imageUrl) {
    return (
      <img
        alt=""
        className="boost-avatar"
        loading="lazy"
        src={imageUrl}
      />
    );
  }

  return (
    <div className="boost-avatar boost-avatar-fallback" aria-hidden="true">
      {avatarText(item)}
    </div>
  );
}

function BoostPost({
  item,
  network,
}: {
  item: BoostFeedItem;
  network: BitcoinNetwork;
}) {
  const txHref = explorerTxUrl(item.txid, network);
  const shareHref = boostShareUrl(item, network);
  return (
    <article className="boost-post">
      <BoostAvatar item={item} />
      <div className="boost-post-body">
        <div className="boost-post-head">
          <div>
            <a
              className="boost-author"
              href={boostProfileHref(item.authorId ?? item.authorAddress)}
            >
              {authorLabel(item)}
            </a>
            <span>{formatDate(item.createdAt)}</span>
          </div>
          <strong>{formatProofs(item.proofSignalSats)}</strong>
        </div>

        {item.text ? <p className="boost-post-text">{item.text}</p> : null}

        {item.media ? (
          <div className="boost-media-pill">
            <Zap size={14} />
            <span>{item.media.name ?? item.media.mime ?? "media"}</span>
          </div>
        ) : null}

        <div className="boost-signal-row">
          <span>{formatUsd(item.signalUsd)}</span>
          {item.workSignal ? <span>{item.workSignal} WORK</span> : null}
          <span>{actionLabel(item.kind)}</span>
          <span>Owner {ownerLabel(item)}</span>
        </div>

        <div className="boost-actions">
          <button className="secondary small" type="button">
            <span className="button-content">
              <MessageCircle size={15} />
              <span>{item.replyCount ?? 0}</span>
            </span>
          </button>
          <button className="secondary small" type="button">
            <span className="button-content">
              <Heart size={15} />
              <span>{item.likeCount ?? 0}</span>
            </span>
          </button>
          <button className="secondary small" type="button">
            <span className="button-content">
              <Repeat2 size={15} />
              <span>{item.reboostCount ?? 0}</span>
            </span>
          </button>
          {item.listingPriceSats ? (
            <a
              className="secondary small link-button"
              href={appHref(COMPUTER_APP_URL, LOCAL_COMPUTER_APP_URL)}
            >
              <span className="button-content">
                <ShoppingBag size={15} />
                <span>{formatProofs(item.listingPriceSats)}</span>
              </span>
            </a>
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
  const [profileQuery, setProfileQuery] = useState(initialProfileQuery);
  const [searchQuery, setSearchQuery] = useState("");
  const [payload, setPayload] = useState<BoostFeedPayload | undefined>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AppStatusState>({
    tone: "idle",
    text: "",
  });

  const items = useMemo(() => payload?.items ?? [], [payload]);
  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return items;
    }
    return items.filter((item) =>
      [
        item.text,
        item.authorId,
        item.authorAddress,
        item.currentOwnerId,
        item.currentOwnerAddress,
        item.txid,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [items, searchQuery]);

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
      setStatus({
        tone: "good",
        text: `Boost indexed ${Number(nextPayload.totalCount ?? nextPayload.items?.length ?? 0).toLocaleString()} record${Number(nextPayload.totalCount ?? nextPayload.items?.length ?? 0) === 1 ? "" : "s"}.`,
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

  const accountStats = [
    {
      label: "Signal",
      value: formatProofs(
        visibleItems.reduce((total, item) => total + item.proofSignalSats, 0),
      ),
      tone: "strong" as const,
    },
    {
      label: "USD",
      value: formatUsd(
        visibleItems.reduce((total, item) => total + Number(item.signalUsd ?? 0), 0),
      ),
    },
    {
      label: "Posts",
      value: visibleItems.length.toLocaleString(),
    },
  ];

  return (
    <div className="mail-app boost-public-app">
      <AppHeader
        accountStats={accountStats}
        busy={busy}
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
                <BoostPost item={item} key={`${item.kind}-${item.txid}`} network={network} />
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
