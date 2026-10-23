import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDownLeft, ArrowUpRight, Bell, Check, CheckCheck, ChevronDown, CircleAlert, CircleDot, RefreshCw, Search, X } from "lucide-react";
import { explorerTxUrl, type BitcoinNetwork } from "../../shared/bitcoin/networks";
import { notificationAddressScope, notificationHasUnloadedUnread, notificationIsRead, notificationSnapshotReadIds } from "./notificationState.mjs";
import { notificationMatchesDirection } from "./notificationFilters.mjs";
import { notificationQueryKey, notificationReadScope } from "./notificationScope.mjs";
import type { ComputerNotification, NotificationQuery, NotificationTarget } from "./notificationsApi";
import { useNotificationReadState, useNotifications } from "./useNotifications";
import "./notifications.css";

export type NotificationIdentity = { id: string; ownerAddress: string; receiveAddress: string; registrationTxid?: string };
export type NotificationsButtonProps = {
  network: BitcoinNetwork;
  address: string;
  resolveIdentity?: (input: string, signal: AbortSignal) => Promise<NotificationIdentity>;
  validateAddress?: (address: string) => boolean;
  onOpenRecord?: (target: NotificationTarget, notification: ComputerNotification) => boolean | void;
};
const NETWORK_LABELS = { livenet: "Mainnet", testnet: "Testnet3", testnet4: "Testnet4" };
const APP_LABELS: Record<string, string> = { mail: "Mail", files: "Files", boost: "Boost", publish: "Publish", wallet: "Wallet", ids: "IDs", id: "IDs", dns: "DNS", amo: "AMO", marketplace: "AMO", jobs: "Jobs", code: "Code", pages: "Pages", permission: "Permission", credit: "Credit", work: "WORK", infinity: "Infinity", inception: "Inception", applications: "Applications", computer: "Computer", browser: "Browser" };
function appLabel(app: string) { return APP_LABELS[app.toLowerCase()] ?? app; }
function displayTime(value: string | number | null) {
  if (value == null) return "Time unavailable";
  const date = new Date(typeof value === "number" && value < 100_000_000_000 ? value * 1_000 : value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function notificationStatus(item: ComputerNotification) {
  if (item.status === "invalid" || item.evidence.valid === false) return "Invalid action";
  if (item.status === "confirmed") return item.evidence.applied === false ? "Confirmed · not applied" : "Confirmed";
  return { pending: "Pending", dropped: "Dropped", orphaned: "Orphaned", unavailable: "Status unavailable" }[item.status];
}
function directionLabel(direction: string) { return ({ incoming: "Incoming", outgoing: "Outgoing", self: "Incoming and outgoing", related: "Related activity" } as Record<string, string>)[direction]; }

function NotificationRow({ item, network, read, onRead, onOpen }: {
  item: ComputerNotification; network: BitcoinNetwork; read: boolean;
  onRead: (read: boolean) => void; onOpen?: (target?: NotificationTarget) => void;
}) {
  const invalid = item.evidence.valid === false || item.status === "invalid";
  return <li className={`notification-row${read ? "" : " is-unread"}`}>
    <div className="notification-row-icon" aria-hidden="true">{invalid ? <CircleAlert size={20} /> : item.direction === "outgoing" ? <ArrowUpRight size={20} /> : item.direction === "incoming" ? <ArrowDownLeft size={20} /> : <CircleDot size={20} />}</div>
    <article className="notification-row-content" aria-label={`${read ? "Read" : "Unread"}: ${item.label}`}>
      <div className="notification-row-meta"><span>{appLabel(item.app)}</span><span>{directionLabel(item.direction)}</span>{!read && <span className="notification-unread-label">Unread</span>}</div>
      <h3>{item.label}</h3>
      {item.detail && <p className="notification-detail">{item.detail}</p>}
      <div className="notification-row-meta"><span className={`notification-status is-${invalid ? "invalid" : item.status}`}>{notificationStatus(item)}</span><span>{displayTime(item.createdAt)}</span></div>
      {item.status === "pending" && <p className="notification-qualification">Pending visibility is best effort; this action is not confirmed.</p>}
      {(item.status === "dropped" || item.status === "orphaned") && <p className="notification-qualification">This action is outside current confirmed history.</p>}
      {invalid && <p className="notification-qualification">This record does not establish accepted protocol state.</p>}
      {(item.evidence.reason || typeof item.evidence.qualification === "string") && <p className="notification-qualification">{item.evidence.reason || String(item.evidence.qualification)}</p>}
      <div className="notification-row-actions">
        {item.evidence.protocol === "transaction" ? <a href={explorerTxUrl(item.txid, network)} target="_blank" rel="noreferrer">View transaction in explorer <ArrowUpRight size={15} aria-hidden="true" /></a> : onOpen && <button type="button" onClick={() => onOpen()}>Open record <ArrowUpRight size={15} aria-hidden="true" /></button>}
        <button type="button" onClick={() => onRead(!read)}>{read ? <CircleDot size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}Mark {read ? "unread" : "read"}</button>
      </div>
      <details className="notification-evidence"><summary>Transaction evidence <ChevronDown size={16} aria-hidden="true" /></summary>
        <dl>
          <div><dt>Transaction</dt><dd><a href={explorerTxUrl(item.txid, network)} target="_blank" rel="noreferrer">{item.txid}<ArrowUpRight size={14} aria-hidden="true" /></a></dd></div>
          <div><dt>Chain status</dt><dd>{item.evidence.chainStatus ?? item.status}</dd></div>
          <div><dt>Protocol</dt><dd>{item.evidence.protocol === "transaction" ? "No protocol record" : item.evidence.protocol} · {item.kind}</dd></div>
          {item.evidence.protocol !== "transaction" && <div><dt>Position</dt><dd>Output {item.protocolVout ?? "unavailable"} · record {item.recordOrdinal ?? "unavailable"}</dd></div>}
          {item.evidence.blockHeight != null && <div><dt>Block height</dt><dd>{item.evidence.blockHeight}</dd></div>}
          {item.evidence.blockHash && <div><dt>Block hash</dt><dd>{item.evidence.blockHash}</dd></div>}
          {item.senderAddresses?.length ? item.senderAddresses.map(sender => <div key={sender}><dt>Input address</dt><dd>{sender}</dd></div>) : item.actorAddress && <div><dt>From</dt><dd>{item.actorAddress}</dd></div>}
          {item.recipientAddresses.map(address => <div key={address}><dt>To</dt><dd>{address}</dd></div>)}
          {item.relatedTxids.map(txid => <div key={txid}><dt>Related transaction</dt><dd><a href={explorerTxUrl(txid, network)} target="_blank" rel="noreferrer">{txid}<ArrowUpRight size={14} aria-hidden="true" /></a></dd></div>)}
          {Object.entries(item.evidence.amounts ?? {}).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{String(value)}</dd></div>)}
        </dl>
        {(!item.actions || item.actions.length <= 1) && <pre className="notification-source-json">{JSON.stringify(item.evidence, null, 2)}</pre>}
        {item.actions && item.actions.length > 1 && <div className="notification-group-actions"><h4>Actions in this transaction</h4>{item.actions.map((action, index) => <details className="notification-action-evidence" key={`${action.kind}:${index}`}><summary><span>{action.label || action.kind}<span className={`notification-status is-${action.evidence.valid === false ? "invalid" : action.status}`}>{notificationStatus(action)}</span></span></summary><p className="notification-qualification">{appLabel(action.app)} · {directionLabel(action.direction)} · {action.evidence.protocol === "transaction" ? "No protocol record" : `output ${action.protocolVout ?? "unavailable"} · record ${action.recordOrdinal ?? "unavailable"}`}</p>{action.evidence.reason && <p className="notification-qualification">{action.evidence.reason}</p>}<pre className="notification-source-json">{JSON.stringify(action.evidence, null, 2)}</pre>{action.evidence.protocol === "transaction" ? <a href={explorerTxUrl(action.txid, network)} target="_blank" rel="noreferrer">View transaction in explorer <ArrowUpRight size={15} aria-hidden="true" /></a> : onOpen && action.target && <button type="button" onClick={() => onOpen(action.target)}>Open this action <ArrowUpRight size={15} aria-hidden="true" /></button>}</details>)}</div>}
      </details>
    </article>
  </li>;
}

export function NotificationsButton({ network, address, resolveIdentity, validateAddress, onOpenRecord }: NotificationsButtonProps) {
  const [open, setOpen] = useState(false);
  const [override, setOverride] = useState<({ key: string; label: string } & ({ type: "address"; address: string } | { type: "id"; id: string })) | null>(null);
  const accountKey = `${network}:${address}`;
  const scopedOverride = override?.key === accountKey ? override : null;
  const scopedId = scopedOverride?.type === "id" ? scopedOverride.id : undefined;
  const scopedAddress = scopedId ? "" : scopedOverride?.type === "address" ? scopedOverride.address : notificationAddressScope(address);
  const scopeValue = scopedId ?? scopedAddress;
  const query = useMemo<NotificationQuery>(() => scopedId ? { network, id: scopedId } : { network, address: scopedAddress }, [network, scopedId, scopedAddress]);
  const queryKey = notificationQueryKey(query);
  const activity = useNotifications(query, open);
  const readState = useNotificationReadState(network, notificationReadScope(query, activity.response));
  const [direction, setDirection] = useState("all");
  const [app, setApp] = useState("all");
  const [input, setInput] = useState("");
  const [lookupExpanded, setLookupExpanded] = useState(!address);
  const [identity, setIdentity] = useState<NotificationIdentity | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const lookupController = useRef<AbortController>();
  const accountRef = useRef(accountKey);
  accountRef.current = accountKey;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const scopeInputId = useId();
  const appInputId = useId();
  const response = activity.response;
  const rows = response?.items ?? [];
  const unread = rows.filter(item => !notificationIsRead(readState.state, item)).length;
  const unknownUnread = notificationHasUnloadedUnread(readState.state, response);
  const partialCount = Boolean(unknownUnread || (response && !response.coverage.complete));
  const countLabel = response ? `${unread}${partialCount ? "+" : ""}` : null;
  const allReadBoundary = response?.readBoundary?.maxFirstSeenAt;
  const canMarkAll = Boolean(response?.readBoundary && (allReadBoundary || response.readBoundary.explicitIds?.length));
  const markAllIds = response ? notificationSnapshotReadIds(response) : [];
  const apps = [...new Set(rows.flatMap(item => [item.app, ...(item.actions?.map(action => action.app).filter((value): value is string => Boolean(value)) ?? [])]))].sort((a, b) => appLabel(a).localeCompare(appLabel(b)));
  const visibleRows = rows.filter(item => (app === "all" || item.app === app || item.actions?.some(action => action.app === app))
    && notificationMatchesDirection(item, direction));

  useEffect(() => {
    lookupController.current?.abort(); setLookingUp(false); setOverride(null); setIdentity(null); setLookupError(""); setInput(""); setLookupExpanded(!address); setDirection("all"); setApp("all");
    return () => lookupController.current?.abort();
  }, [accountKey]);
  useEffect(() => { setDirection("all"); setApp("all"); setNavigationError(""); }, [queryKey]);
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      lookupController.current?.abort();
      const restore = previousFocus instanceof HTMLElement && previousFocus.isConnected ? previousFocus : triggerRef.current;
      restore?.focus({ preventScroll: true });
    };
  }, [open]);

  const close = () => { setOpen(false); setLookingUp(false); setNavigationError(""); };
  const openRecord = (item: ComputerNotification, target = item.target) => {
    if (!onOpenRecord) return;
    try {
      if (onOpenRecord(target, item) === false) {
        setNavigationError("The current workspace could not be left. Close notifications to review its status.");
        return;
      }
    } catch (reason) {
      setNavigationError(reason instanceof Error ? reason.message : "This record could not be opened. Your current task is preserved.");
      return;
    }
    readState.mark([item.id], true);
    close();
  };
  const selectAddress = (value: string, label = "Public address") => {
    lookupController.current?.abort(); setOverride({ key: accountKey, type: "address", address: notificationAddressScope(value), label }); setIdentity(null); setLookupError(""); setLookingUp(false);
  };
  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (!value) { setLookupError("Enter an address or confirmed ProofOfWork ID."); return; }
    lookupController.current?.abort(); setIdentity(null); setLookupError("");
    if (validateAddress?.(value)) { selectAddress(value); return; }
    if (!resolveIdentity) { setLookupError("Enter a valid address for this network."); return; }
    const controller = new AbortController(); lookupController.current = controller; setLookingUp(true);
    const originatingAccount = accountKey;
    try {
      const next = await resolveIdentity(value, controller.signal);
      if (controller.signal.aborted || accountRef.current !== originatingAccount) return;
      setIdentity(next); setLookupExpanded(true);
      setOverride({ key: accountKey, type: "id", id: next.id, label: "ID history" });
    } catch (reason) {
      if (!controller.signal.aborted && accountRef.current === originatingAccount) setLookupError(reason instanceof Error ? reason.message : "This ID could not be resolved in the confirmed registry.");
    } finally { if (!controller.signal.aborted && accountRef.current === originatingAccount) setLookingUp(false); }
  };

  const dialog = open ? <dialog ref={dialogRef} className="notifications-dialog" aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); close(); }} onClose={close}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <header className="notifications-heading"><div><h2 id={headingId}>Notifications</h2><p>{NETWORK_LABELS[network]} · {scopedId ? "ID-linked activity across owners" : "Activity to, from, and involving this address"}</p></div><button type="button" className="notification-icon-button" aria-label="Close notifications" onClick={close}><X size={20} aria-hidden="true" /></button></header>
    <div className="notifications-body">
      {scopeValue && <div className="notifications-scope"><span>{scopedOverride?.label ?? "Connected address"}</span><code>{scopeValue}</code>{scopedId && <p className="notification-qualification">This ID’s registry history and actions linked to it follow the ID across owners.</p>}{scopedOverride && address && <button type="button" onClick={() => { setOverride(null); setIdentity(null); }}>Use connected address</button>}</div>}
      <details className="notifications-lookup" open={lookupExpanded} onToggle={event => setLookupExpanded(event.currentTarget.open)}>
        <summary><Search size={17} aria-hidden="true" />Inspect an address or ID</summary>
        <form onSubmit={event => void lookup(event)}><label htmlFor={scopeInputId}>Address or confirmed ProofOfWork ID</label><div className="notifications-lookup-controls"><input id={scopeInputId} value={input} onChange={event => setInput(event.target.value)} placeholder="Address or name@proofofwork.me" spellCheck={false} autoComplete="off" /><button type="submit" disabled={lookingUp}>{lookingUp ? "Looking up…" : "Look up"}</button></div></form>
        <p className="notification-qualification">Read-only lookup. An ID opens its linked history across owners. An address opens activity involving that exact address.</p>
        {lookupError && <p className="notification-error" role="alert">{lookupError}</p>}
        {identity && <div className="notification-identity"><strong>{identity.id}</strong><p>Confirmed routing at lookup. These address histories are separate from the ID’s linked history.</p>{[{ label: "Owner", value: identity.ownerAddress }, { label: "Receiver", value: identity.receiveAddress }].filter((item, index, values) => index === 0 || item.value !== values[0].value).map(item => <div key={item.label}><span>{item.label}{identity.ownerAddress === identity.receiveAddress ? " and receiver" : ""}</span><code>{item.value}</code><button type="button" onClick={() => selectAddress(item.value, `${identity.id} · ${item.label.toLowerCase()} at lookup`)}>View {item.label.toLowerCase()} address</button></div>)}</div>}
      </details>
      {!scopeValue && <div className="notifications-empty"><Bell size={28} aria-hidden="true" /><h3>Choose an address or ID</h3><p>Connect your wallet or look up an address or confirmed ID to read its Computer activity.</p></div>}
      {scopeValue && <>
        <div className="notifications-tools"><div className="notifications-directions" aria-label="Activity direction">{["all", "incoming", "outgoing"].map(value => <button type="button" key={value} aria-pressed={direction === value} onClick={() => setDirection(value)}>{value === "all" ? "All" : value === "incoming" ? "Incoming" : "Outgoing"}</button>)}</div><button type="button" className="notification-icon-button" aria-label="Refresh notifications" disabled={activity.reading} onClick={activity.refresh}><RefreshCw size={18} aria-hidden="true" /></button></div>
        <div className="notifications-filters"><label htmlFor={appInputId}>App<select id={appInputId} value={app} onChange={event => setApp(event.target.value)}><option value="all">All apps</option>{apps.map(value => <option key={value} value={value}>{appLabel(value)}</option>)}</select></label><button type="button" disabled={!response || (!unread && !response.hasMore)} onClick={() => canMarkAll && allReadBoundary ? readState.markAll(markAllIds.map(id => ({ id })), allReadBoundary, response!.readBoundary!.maxEventId) : readState.mark(markAllIds, true)}><CheckCheck size={16} aria-hidden="true" />{canMarkAll ? "Mark all read" : "Mark loaded read"}</button></div>
        {navigationError && <p className="notification-notice is-error" role="alert">{navigationError}</p>}
        {readState.warning && <p className="notification-notice" role="status">{readState.warning}</p>}
        {activity.error && <div className="notification-notice is-error" role="alert"><strong>{response ? "Refresh unavailable · showing the last verified activity" : "Notifications unavailable"}</strong><p>{activity.error}</p><button type="button" onClick={activity.refresh}>Retry</button></div>}
        {!response && !activity.error && <p className="notifications-loading" role="status">Reading Computer activity…</p>}
        {response && <>
          <p className="notifications-count" role="status">{unread.toLocaleString()} unread in {rows.length.toLocaleString()} loaded notifications{response.hasMore ? ` · ${response.totalCount.toLocaleString()} available in total` : ""}{activity.reading ? " · Refreshing…" : ""}</p>
          {response.hasMore && <p className="notification-qualification">Filters apply to loaded activity. Load older notifications to include more history.</p>}
          {!response.coverage.complete && <p className="notification-notice">Coverage is incomplete. An empty view does not establish that this scope has no activity.</p>}
          {visibleRows.length > 0 ? <ol className="notifications-list">{visibleRows.map(item => <NotificationRow key={item.id} item={item} network={network} read={notificationIsRead(readState.state, item)} onRead={read => readState.mark([item.id], read)} onOpen={onOpenRecord ? (target) => openRecord(item, target) : undefined} />)}</ol>
            : <div className="notifications-empty"><Bell size={28} aria-hidden="true" /><h3>{rows.length ? "No loaded activity matches these filters" : response.coverage.complete ? "No notifications yet" : "No activity available"}</h3><p>{rows.length ? "Choose All or load more history." : scopedId ? "Computer actions linked to this ID appear here." : "Computer actions involving this address appear here."}</p></div>}
          {activity.pageError && <p className="notification-notice is-error" role="alert">{activity.pageError}</p>}
          {response.hasMore && <button type="button" className="notifications-load-more" disabled={activity.loadingMore || activity.reading} onClick={() => void activity.loadMore()}>{activity.loadingMore ? "Loading older activity…" : activity.pageError ? "Retry older activity" : "Load older notifications"}</button>}
          <details className="notifications-coverage"><summary>Activity coverage</summary><p>Read status stays in this browser for this network and {scopedId ? "ID registration, across owner and receiver changes" : "exact address"}. Pending observations are best effort. Confirmed records remain the source of truth.</p>{response.scope?.type === "id" && <p>ID registration <a href={explorerTxUrl(response.scope.registrationTxid, network)} target="_blank" rel="noreferrer">{response.scope.registrationTxid}</a></p>}{response.coverage.localActions && <p>{response.coverage.localActions}</p>}{response.coverage.mentions && <p>{response.coverage.mentions}</p>}{response.coverage.qualification.map((note, index) => <p key={index}>{note}</p>)}{response.indexedThroughBlock != null && <p>Indexed through block {response.indexedThroughBlock.toLocaleString()}.</p>}{response.indexedThroughBlockHash && <code>{response.indexedThroughBlockHash}</code>}</details>
        </>}
      </>}
    </div>
  </dialog> : null;
  return <><button ref={triggerRef} type="button" className="notifications-bell" aria-haspopup="dialog" aria-expanded={open}
    aria-label={`Notifications${scopedOverride ? ` for ${scopedOverride.label}, ${scopeValue}` : ""}${countLabel ? `, ${countLabel} unread in loaded activity` : scopeValue ? ", activity unavailable or loading" : ""}`}
    title={`Notifications${scopedOverride ? ` · ${scopedOverride.label} · ${scopeValue}` : ""}${activity.error ? " · refresh unavailable" : ""}`} onClick={() => setOpen(true)}><Bell size={20} aria-hidden="true" /><span className="notifications-bell-label">Notifications</span>{countLabel && (unread > 0 || partialCount) && <span className="notifications-badge" aria-hidden="true">{unread > 99 ? "99+" : countLabel}</span>}{activity.error && <span className="notifications-unavailable" aria-hidden="true">!</span>}</button>{dialog && createPortal(dialog, document.body)}</>;
}
