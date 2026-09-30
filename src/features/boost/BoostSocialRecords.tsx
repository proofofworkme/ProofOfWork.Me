import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { explorerTxUrl } from "../../shared/bitcoin/networks";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { formatDate } from "../../functions";
import { ProfileImage } from "./BoostProfileImages";
import { createBoostReadLifecycle } from "./boostReadLifecycle";
import { boostRouteHref, type BoostFeedItem, type BoostProfile } from "./boostProtocol";
import { boostSignalQ8 } from "./boostAmounts";

export type ConnectionTab = "followers" | "following";
function moveTab(event: import("react").KeyboardEvent<HTMLButtonElement>) {
  const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? []);
  const index = tabs.indexOf(event.currentTarget);
  const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
    : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
  if (next >= 0 && tabs[next]) { event.preventDefault(); tabs[next].focus(); tabs[next].click(); }
}
type ActivityTab = "replies" | "likes" | "reboosts";
type Person = { address: string; id?: string; displayName: string; profile?: BoostProfile;
  viewerFollowsProfile?: boolean; followsViewer?: boolean };
type SocialRecord = Person & { txid: string; eventId?: string | number; createdAt: string;
  confirmed: boolean; kind: string; post?: BoostFeedItem };
type SocialPayload = { complete: boolean; snapshotId: string; mode: string;
  items: SocialRecord[]; totalCount: number; hasMore: boolean; nextCursor: string;
  start: number; post?: BoostFeedItem; profileSubject?: Person };

function useSocialRecords(params: Record<string, string>, network: BitcoinNetwork) {
  const scope = JSON.stringify([network, params]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const lifecycle = useRef(createBoostReadLifecycle());
  const [state, setState] = useState<{ scope: string; payload?: SocialPayload; busy: boolean; error: string }>({ scope, busy: true, error: "" });
  const payload = state.scope === scope ? state.payload : undefined;
  const busy = state.scope !== scope || state.busy;
  const error = state.scope === scope ? state.error : "";
  async function load(append = false) {
    const request = lifecycle.current.begin();
    const owns = () => request.current() && currentScope.current === scope;
    setState({ scope, payload: append ? payload : undefined, busy: true, error: "" });
    try {
      const query = new URLSearchParams({ ...params, limit: "50", fresh: "1" });
      if (append && payload?.nextCursor) query.set("cursor", payload.nextCursor);
      const next = await fetchProofApiJson<SocialPayload>(`/api/v1/boost?${query}`, network,
        { signal: request.signal, timeoutMs: 60_000 });
      if (!owns()) return;
      if (next.complete !== true || !next.snapshotId || !Array.isArray(next.items) ||
          next.mode !== (params.detail ? "detail" : "connections") ||
          !Number.isSafeInteger(next.totalCount) || next.totalCount < 0 ||
          next.items.some(row => row.confirmed !== true || !row.address || !/^[0-9a-f]{64}$/.test(row.txid)) ||
          (params.detail && next.post?.txid !== params.detail)) {
        throw new Error("Complete confirmed social records are unavailable.");
      }
      if (append && (next.snapshotId !== payload?.snapshotId || next.start !== payload.items.length)) {
        throw new Error("Social history changed. Refresh from the first page.");
      }
      for (const post of [next.post, ...next.items.map(row => row.post)]) {
        if (post) { boostSignalQ8(post.totalSignalQ8, post.totalSignalSatsExact); boostSignalQ8(post.proofSignalQ8, post.proofSignalSatsExact); }
      }
      const items = append ? [...(payload?.items ?? []), ...next.items] : next.items;
      const keys = new Set(items.map(row => row.eventId ?? `${row.address}:${row.txid}`));
      if (keys.size !== items.length) throw new Error("Social history repeated a page. Refresh from the first page.");
      setState({ scope, payload: { ...next, items }, busy: false, error: "" });
    } catch (cause) {
      if (owns()) setState({ scope, payload: append ? payload : undefined, busy: false,
        error: cause instanceof Error ? cause.message : "Social records are unavailable." });
    }
  }
  useEffect(() => { void load(); return () => lifecycle.current.cancel(); }, [scope]);
  return { payload, busy, error, load };
}

function RecordStatus({ records, empty }: { records: ReturnType<typeof useSocialRecords>; empty: string }) {
  return <>
    {records.busy ? <p role="status">Loading confirmed records…</p> : null}
    {records.error ? <div role="alert"><p>{records.error}</p><button className="secondary" onClick={() => void records.load()} type="button">Retry from first page</button></div> : null}
    {!records.busy && !records.error && records.payload?.items.length === 0 ? <p className="field-note">{empty}</p> : null}
    {records.payload?.hasMore && !records.error ? <button className="secondary" disabled={records.busy} onClick={() => void records.load(true)} type="button">Load more</button> : null}
  </>;
}

function PersonRow({ row, network, viewer, onFollow }: { row: SocialRecord; network: BitcoinNetwork;
  viewer: string; onFollow?: (row: SocialRecord) => void }) {
  const self = viewer && (viewer === row.address || (/^(bc1|tb1)/i.test(viewer) && viewer.toLowerCase() === row.address.toLowerCase()));
  return <article className="boost-person-row">
    <a className="boost-person-avatar" href={boostRouteHref("/", { boost: "1", profile: row.id || row.address })} aria-label={`Open ${row.displayName} profile`}>
      <ProfileImage pointer={row.profile?.image} network={network} className="boost-avatar" fallback={row.displayName.slice(0, 2)} />
    </a>
    <div className="boost-person-copy">
      <a href={boostRouteHref("/", { boost: "1", profile: row.id || row.address })}><strong>{row.profile?.name || row.id || row.displayName}</strong></a>
      <span>{row.id ? `${row.id}@proofofwork.me` : row.address}</span>
      {row.followsViewer ? <span>Follows you</span> : null}
      {row.viewerFollowsProfile ? <span>Following</span> : null}
      <details><summary>Proof details</summary><span className="boost-person-address">{row.address}</span>
        <span>{formatDate(row.createdAt)} · Confirmed</span>
      </details>
      <a href={explorerTxUrl(row.txid, network)} target="_blank" rel="noreferrer">View TX</a>
    </div>
    {onFollow && !self ? <button className="secondary small" onClick={() => onFollow(row)} type="button">{row.viewerFollowsProfile ? "Unfollow" : "Follow"}</button> : null}
  </article>;
}

export function BoostConnections({ profile, tab, onTab, network, viewer, onBack, onFollow }: {
  profile: string; tab: ConnectionTab; onTab: (tab: ConnectionTab) => void; network: BitcoinNetwork;
  viewer: string; onBack: () => void; onFollow: (address: string, id: string, following: boolean) => void;
}) {
  const records = useSocialRecords({ profile, connections: tab, viewer }, network);
  return <section aria-label="Profile connections" className="boost-connections">
    <div className="boost-profile-titlebar"><button className="secondary small" aria-label="Back to profile" onClick={onBack} type="button"><ArrowLeft size={20} /></button>
      <div><strong>{records.payload?.profileSubject?.displayName || profile}</strong><p>Connections</p></div>
      <button className="secondary small" aria-label="Refresh connections" disabled={records.busy} onClick={() => void records.load()} type="button"><RefreshCw size={18} /></button>
    </div>
    <div className="boost-profile-tabs" role="tablist" aria-label="Connections tabs">
      {(["followers", "following"] as const).map(value => <button key={value} type="button" role="tab" onKeyDown={moveTab} aria-selected={tab === value}
        aria-controls="boost-connections-panel" id={`boost-connections-${value}`} onClick={() => onTab(value)}>{value === "followers" ? "Followers" : "Following"}</button>)}
    </div>
    <div id="boost-connections-panel" role="tabpanel" aria-labelledby={`boost-connections-${tab}`}>
      <p className="field-note">{records.payload ? `${records.payload.totalCount} confirmed ${tab}` : "Confirmed connections"}</p>
      {records.payload?.items.map(row => <PersonRow key={row.address} row={row} network={network} viewer={viewer}
        onFollow={row => onFollow(row.address, row.id || "", Boolean(row.viewerFollowsProfile))} />)}
      <RecordStatus records={records} empty={`No confirmed ${tab} yet.`} />
    </div>
  </section>;
}

export function BoostActivity({ txid, network, viewer, renderPost }: { txid: string; network: BitcoinNetwork;
  viewer: string; renderPost: (post: BoostFeedItem) => ReactNode }) {
  const [tab, setTab] = useState<ActivityTab>("replies");
  const records = useSocialRecords({ detail: txid, activity: tab, viewer }, network);
  return <>
    {records.payload?.post ? renderPost(records.payload.post) : null}
    <div className="boost-profile-tabs" role="tablist" aria-label="Boost activity">
      {(["replies", "likes", "reboosts"] as const).map(value => <button key={value} type="button" role="tab" onKeyDown={moveTab} aria-selected={tab === value}
        id={`boost-activity-${value}`} aria-controls="boost-activity-panel" onClick={() => setTab(value)}>
        {value === "replies" ? "Replies" : value === "likes" ? "Likes" : "Reboosts"}
        {records.payload?.post ? ` ${value === "replies" ? records.payload.post.replyCount : value === "likes" ? records.payload.post.likeCount : records.payload.post.reboostCount}` : ""}
      </button>)}
    </div>
    <div className="boost-detail-replies" id="boost-activity-panel" role="tabpanel" aria-labelledby={`boost-activity-${tab}`}>
      {records.payload ? <p className="field-note">{records.payload.totalCount} confirmed {tab}</p> : null}
      {records.payload?.items.map(row => row.post ? <div key={row.eventId ?? row.txid} className="boost-thread-reply">{renderPost(row.post)}</div>
        : <PersonRow key={row.eventId ?? row.txid} row={row} network={network} viewer={viewer} />)}
      <RecordStatus records={records} empty={`No confirmed ${tab} yet.`} />
    </div>
  </>;
}
