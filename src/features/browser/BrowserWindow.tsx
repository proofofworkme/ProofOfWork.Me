import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Code2, Copy, Download, Expand, Globe, Maximize2, Minimize2, Play, Plus, RefreshCw, Search, ShieldCheck, Square, X } from "lucide-react";
import { BrowserNetworkTabs } from "../../shared/components/BrowserNetworkTabs";
import { browserAppDocument, browserDocumentTitle } from "./browserAppDocument";

type Network = "livenet" | "testnet" | "testnet4";
type Entry = { target: string; network: Network };
type Tab = { id: number; title: string; entries: Entry[]; index: number };
type Page = {
  txid: string; network: Network; html: string; confirmed: boolean; source: "attachment" | "message";
  sender: string; amountSats: number; protocolBytes: number;
  attachment: { name: string; size: number; sha256: string };
  dnsLink?: { name: string; txid: string; ownerAddress: string; indexedThroughBlock: number; checkpointHash: string };
};
type Props<T extends Page> = {
  page?: T; query: string; network: Network; loading: boolean; embedded?: boolean;
  normalizeTarget: (target: string) => string;
  onQueryChange: (query: string) => void; onNetworkChange: (network: Network) => void;
  onNavigate: (target: string, network: Network) => Promise<void>; onClear: () => void;
  renderStaticPage: (page: T) => ReactNode;
  explorerHref: (page: T) => string; editHref: (page: T) => string;
  createHref: string; templateTools?: ReactNode;
};
const networkLabel = (network: Network) => ({ livenet: "Mainnet", testnet: "Testnet", testnet4: "Testnet4" })[network];
const pageKey = (page: Page) => `${page.network}:${page.txid}:${page.attachment.sha256}`;
const targetOf = (page: Page) => page.dnsLink?.name ?? page.txid;
const sameEntry = (a: Entry, b: Entry) => a.target === b.target && a.network === b.network;

export function BrowserWindow<T extends Page>({ page, query, network, loading, embedded = false,
  normalizeTarget, onQueryChange, onNetworkChange, onNavigate, onClear, renderStaticPage,
  explorerHref, editHref, createHref, templateTools }: Props<T>) {
  const [tabs, setTabs] = useState<Tab[]>(() => [{ id: 1, title: "New tab", entries: normalizeTarget(query) ? [{ target: normalizeTarget(query), network }] : [], index: normalizeTarget(query) ? 0 : -1 }]);
  const [activeId, setActiveId] = useState(1);
  const [runtime, setRuntime] = useState<{ key: string; html: string; runId: number }>();
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState("");
  const nextTab = useRef(2);
  const root = useRef<HTMLElement>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const activeTab = tabs.find(tab => tab.id === activeId)!;
  const entry = activeTab.entries[activeTab.index];
  const displayedPage = page && entry && page.network === network && sameEntry(entry, { target: targetOf(page), network: page.network }) ? page : undefined;
  const activeRuntime = displayedPage && runtime?.key === pageKey(displayedPage) ? runtime : undefined;

  // Browser history restores freshly verified pages through the same adapter.
  // No source or run permission is saved in a tab or restored automatically.
  useEffect(() => {
    setRuntime(undefined);
    if (!page || loading || page.network !== network) return;
    const next = { target: targetOf(page), network: page.network };
    setTabs(current => current.map(tab => {
      if (tab.id !== activeIdRef.current) return tab;
      const index = tab.index >= 0 && sameEntry(tab.entries[tab.index], next) ? tab.index : tab.entries.findIndex(item => sameEntry(item, next));
      const entries = index >= 0 ? tab.entries : [...tab.entries.slice(0, tab.index + 1), next];
      return { ...tab, title: browserDocumentTitle(page.html, document) || page.dnsLink?.name || page.attachment.name, entries, index: index >= 0 ? index : entries.length - 1 };
    }));
  }, [page, network, loading]);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  function navigate(target = query, targetNetwork = network, historyIndex?: number) {
    setRuntime(undefined); setNotice("");
    if (targetNetwork !== network) onNetworkChange(targetNetwork);
    const normalized = normalizeTarget(target);
    if (normalized) setTabs(current => current.map(tab => {
      if (tab.id !== activeId) return tab;
      if (historyIndex !== undefined) return { ...tab, index: historyIndex };
      const next = { target: normalized, network: targetNetwork };
      if (tab.index >= 0 && sameEntry(tab.entries[tab.index], next)) return tab;
      const entries = [...tab.entries.slice(0, tab.index + 1), next];
      return { ...tab, entries, index: entries.length - 1 };
    }));
    void onNavigate(target, targetNetwork);
  }
  function selectTab(tab: Tab) {
    if (tab.id === activeId) return;
    setRuntime(undefined); setNotice(""); setActiveId(tab.id);
    activeIdRef.current = tab.id;
    const target = tab.entries[tab.index];
    if (target) { onQueryChange(target.target); if (target.network !== network) onNetworkChange(target.network); void onNavigate(target.target, target.network); }
    else { onClear(); onQueryChange(""); }
  }
  function addTab() {
    if (tabs.length >= 12) return;
    const tab = { id: nextTab.current++, title: "New tab", entries: [], index: -1 };
    setTabs(current => [...current, tab]); setActiveId(tab.id); activeIdRef.current = tab.id;
    setRuntime(undefined); setNotice(""); onClear(); onQueryChange("");
    window.requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>(".browser-address-input")?.focus());
  }
  function closeTab(tab: Tab) {
    if (tabs.length === 1) {
      setTabs([{ ...tab, title: "New tab", entries: [], index: -1 }]);
      setRuntime(undefined); onClear(); onQueryChange(""); return;
    }
    const remaining = tabs.filter(item => item.id !== tab.id);
    setTabs(remaining);
    if (tab.id === activeId) selectTab(remaining[Math.min(tabs.indexOf(tab), remaining.length - 1)]);
  }
  function runApp() {
    if (!displayedPage || loading) return;
    try { setRuntime({ key: pageKey(displayedPage), html: browserAppDocument(displayedPage.html, document), runId: Date.now() }); setNotice(""); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not run this app."); }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch { setNotice("Full screen is unavailable here. Expand viewport still gives the page more room."); }
  }
  async function copySource() {
    if (!displayedPage) return;
    try { await navigator.clipboard.writeText(displayedPage.html); setNotice("Verified HTML copied."); }
    catch { setNotice("Clipboard unavailable. Select the source or download HTML."); }
  }

  return <section ref={root} className={`browser-window${embedded ? " is-embedded" : ""}${expanded ? " is-expanded" : ""}`} aria-label="ProofOfWork Browser">
    <div className="browser-tabs-row"><div className="browser-tabs" role="tablist" aria-label="Browser tabs">{tabs.map(tab => <div className={`browser-tab${tab.id === activeId ? " is-active" : ""}`} key={tab.id}>
      <button type="button" role="tab" aria-selected={tab.id === activeId} tabIndex={tab.id === activeId ? 0 : -1} aria-controls="browser-current-page" onClick={() => selectTab(tab)} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        selectTab(tabs[index]);
        root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
      }}><Globe size={14} aria-hidden="true" /><span>{tab.title}</span></button>
      <button type="button" className="browser-tab-close" aria-label={`Close tab ${tab.title}`} onClick={() => closeTab(tab)}><X size={14} /></button>
    </div>)}</div><button type="button" className="browser-icon-button" aria-label="New tab" disabled={tabs.length >= 12} onClick={addTab}><Plus size={18} /></button></div>

    <form className="browser-toolbar" onSubmit={event => { event.preventDefault(); navigate(); }}>
      <div className="browser-navigation"><button className="browser-icon-button" type="button" aria-label="Back" disabled={activeTab.index <= 0} onClick={() => { const index = activeTab.index - 1; const previous = activeTab.entries[index]; navigate(previous.target, previous.network, index); }}><ArrowLeft size={18} /></button>
        <button className="browser-icon-button" type="button" aria-label="Forward" disabled={activeTab.index >= activeTab.entries.length - 1} onClick={() => { const index = activeTab.index + 1; const next = activeTab.entries[index]; navigate(next.target, next.network, index); }}><ArrowRight size={18} /></button>
        <button className="browser-icon-button" type="button" aria-label="Reload page" disabled={loading || !entry} onClick={() => navigate(entry.target, entry.network, activeTab.index)}><RefreshCw size={18} /></button></div>
      <label className="browser-address"><span className="browser-address-label">Transaction ID or .pow name</span>{displayedPage && !loading && normalizeTarget(query) === targetOf(displayedPage) ? <ShieldCheck size={17} aria-hidden="true" /> : <Globe size={17} aria-hidden="true" />}<input className="browser-address-input" autoComplete="off" aria-label="Transaction ID or .pow name" spellCheck={false} placeholder="alice.pow or a transaction ID" value={query} onChange={event => onQueryChange(event.target.value)} /></label>
      <button className="primary browser-go" type="submit" aria-label={loading ? "Loading" : "View Page"} disabled={loading}><Search size={16} /><span>{loading ? "Loading" : "View Page"}</span></button>
      <BrowserNetworkTabs network={network} onChange={next => { setRuntime(undefined); setNotice(""); onNetworkChange(next); }} />
    </form>

    <div className="browser-page-toolbar"><span className="browser-page-state">{loading ? "Verifying page…" : displayedPage ? `${displayedPage.confirmed ? "Confirmed" : "Pending"} · ${activeRuntime ? "App running" : "Static page"}` : "New tab"}</span>
      <div className="browser-page-actions">{displayedPage ? <><button type="button" className="secondary small" disabled={loading} onClick={activeRuntime ? () => setRuntime(undefined) : runApp}>{activeRuntime ? <Square size={15} /> : <Play size={15} />}<span>{activeRuntime ? "Stop app" : "Run app"}</span></button><a className="secondary small link-button" href={editHref(displayedPage)}><Code2 size={15} />Edit in Pages</a></> : <a className="secondary small link-button" href={createHref}>Create in Pages<ArrowUpRight size={14} /></a>}
        <button className="browser-icon-button" type="button" aria-label={expanded ? "Restore viewport" : "Expand viewport"} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        <button className="browser-icon-button" type="button" aria-label={fullscreen ? "Exit full screen" : "Full screen"} onClick={() => void toggleFullscreen()}><Expand size={17} /></button></div>
    </div>
    {notice ? <p className="browser-notice" role="status">{notice}</p> : null}
    {activeRuntime ? <p className="browser-run-note">Inline JavaScript runs locally. State lasts for this run. Wallet access and network requests are disabled.</p> : null}
    {displayedPage ? <div className="browser-page-grid" id="browser-current-page" role="tabpanel"><article className="browser-preview-card" aria-label={displayedPage.attachment.name}>
      {activeRuntime ? <iframe key={activeRuntime.runId} title="Published Pages app" sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; autoplay 'none'; display-capture 'none'" referrerPolicy="no-referrer" src={`/pages-runner.html#${encodeURIComponent(activeRuntime.html)}`} /> : renderStaticPage(displayedPage)}
    </article></div> : <div className="browser-new-tab" id="browser-current-page" role="tabpanel"><Globe size={38} aria-hidden="true" /><h2>{loading ? "Opening your page" : "The ProofOfWork web"}</h2><p>{loading ? "Verifying transaction bytes and confirmed name records." : "Open a .pow name or transaction ID. Run a published app when you’re ready."}</p></div>}

    {displayedPage ? <div className="browser-inspectors"><details className="browser-proof-card"><summary>Page evidence<ShieldCheck size={16} /></summary><div className="browser-inspector-content"><a className="secondary small link-button" href={explorerHref(displayedPage)} target="_blank" rel="noreferrer">View TX<ArrowUpRight size={14} /></a><dl>
      {displayedPage.dnsLink ? <><div><dt>.pow name</dt><dd>{displayedPage.dnsLink.name}</dd></div><div><dt>DNS link TXID</dt><dd>{displayedPage.dnsLink.txid}</dd></div><div><dt>DNS owner</dt><dd>{displayedPage.dnsLink.ownerAddress}</dd></div><div><dt>DNS checkpoint</dt><dd>{displayedPage.dnsLink.indexedThroughBlock.toLocaleString()} · {displayedPage.dnsLink.checkpointHash}</dd></div></> : null}
      <div><dt>Status</dt><dd>{displayedPage.confirmed ? "Confirmed" : "Pending"}</dd></div><div><dt>Network</dt><dd>{networkLabel(displayedPage.network)}</dd></div><div><dt>Source</dt><dd>{displayedPage.source === "attachment" ? "HTML attachment" : "Message body"}</dd></div><div><dt>Size</dt><dd>{displayedPage.attachment.size.toLocaleString()} bytes</dd></div><div><dt>Protocol bytes</dt><dd>{displayedPage.protocolBytes.toLocaleString()}</dd></div><div><dt>Sender</dt><dd>{displayedPage.sender}</dd></div><div><dt>Payment</dt><dd>{displayedPage.amountSats.toLocaleString()} proofs</dd></div><div><dt>SHA-256</dt><dd>{displayedPage.attachment.sha256}</dd></div><div><dt>TXID</dt><dd>{displayedPage.txid}</dd></div>
    </dl></div></details><details className="browser-source-card"><summary>Verified HTML source<Code2 size={16} /></summary><div className="browser-inspector-content"><div className="browser-source-actions"><button className="secondary small" type="button" onClick={() => void copySource()}><Copy size={14} />Copy HTML</button><a className="secondary small link-button" download={displayedPage.attachment.name} href={`data:text/html;charset=utf-8,${encodeURIComponent(displayedPage.html)}`}><Download size={14} />Download HTML</a></div><pre tabIndex={0}>{displayedPage.html}</pre></div></details></div> : null}
    {!expanded && templateTools ? <details className="browser-template-disclosure"><summary>Page template</summary>{templateTools}</details> : null}
  </section>;
}
