import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUpRight, Check, ChevronRight, CircleAlert, Code2, Copy, Database, FileText, Search, SlidersHorizontal, X } from "lucide-react";
import { AppHeader } from "../../shared/components/AppHeader";
import { SocialFooter } from "../../shared/components/SocialFooter";
import { explorerTxUrl, type BitcoinNetwork } from "../../shared/bitcoin/networks";
import { BROWSER_APP_URL, LOCAL_BROWSER_APP_URL } from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";
import { DEFAULT_SEARCH_QUERY, exactProofs, fetchSearch, fetchSearchDetail, searchApiHref, searchQueryFromLocation,
  type SearchDetail, type SearchQuery, type SearchRecord, type SearchResponse } from "./searchApi";
import "./search.css";

const PROTOCOLS: Record<string, string> = {
  pwid1: "IDs", pwdns1: "DNS", pwm1: "Mail, Files & Bonds", pwb1: "Boost & Publish", pwt1: "Credits & AMO", pwa1: "Applications", unknown: "Other carriers",
};
const NETWORK_LABELS: Record<BitcoinNetwork, string> = { livenet: "Mainnet", testnet: "Testnet3", testnet4: "Testnet4" };

function readableDate(value: string | number | null) {
  if (value == null) return "Time unavailable";
  const date = new Date(typeof value === "number" && value < 100_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function compact(value: string) { return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value; }
function jsonText(value: unknown) { return typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2); }
function errorText(error: unknown) { return error instanceof Error ? error.message : "Search is temporarily unavailable. Try again shortly."; }
async function copyCurrentLink(setCopied: (copied: boolean) => void) {
  try { await navigator.clipboard.writeText(window.location.href); setCopied(true); }
  catch { setCopied(false); }
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().replace(/^"|"$/gu, "");
  const index = needle ? text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1;
  return index < 0 ? <>{text}</> : <>{text.slice(0, index)}<mark>{text.slice(index, index + needle.length)}</mark>{text.slice(index + needle.length)}</>;
}

function RecordBadges({ record }: { record: SearchRecord }) {
  const unverifiedPosition = record.status === "confirmed" && record.canonical === false;
  return <div className="search-record-badges">
    <span className="search-protocol">{record.protocol} <span>· {record.kind}</span></span>
    <span className={`search-badge is-${unverifiedPosition ? "unverified" : record.status}`}>{unverifiedPosition ? "Unverified chain position" : record.status}</span>
    {record.valid !== true && <span className={`search-badge ${record.valid === false ? "is-invalid" : "is-raw"}`}>{record.valid === false ? "Invalid" : "Raw carrier"}</span>}
  </div>;
}

function SearchInspector({ network, id, close, searchValue }: {
  network: BitcoinNetwork; id: string; close: () => void; searchValue: (value: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<SearchDetail | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<"overview" | "payload" | "raw" | "evidence">("overview");
  const [copied, setCopied] = useState(false);
  const titleId = useId();
  const detailKey = `${network}:${id}`;
  const [loadedKey, setLoadedKey] = useState("");
  const loaded = loadedKey === detailKey ? detail : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError(""); setDetail(null); setTab("overview"); setCopied(false);
    void fetchSearchDetail(network, id, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setDetail(value); setLoadedKey(detailKey);
    }).catch(reason => { if (!controller.signal.aborted) setError(errorText(reason)); });
    return () => controller.abort();
  }, [network, id, detailKey, attempt]);

  const record = loaded?.record;
  return <dialog ref={dialogRef} className="search-inspector" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close(); }}>
    <div className="search-inspector-head">
      <div><span className="search-eyebrow">Source inspector · {NETWORK_LABELS[network]}</span><h2 id={titleId}>{record?.title || "Inspect record"}</h2></div>
      <button type="button" className="search-icon-button" aria-label="Close source inspector" onClick={close}><X size={20} /></button>
    </div>
    {!record && !error && <div className="search-inspector-loading" role="status">Reading indexed source evidence…</div>}
    {error && <div className="search-notice is-error" role="alert"><CircleAlert size={19} /><div><strong>Source unavailable</strong><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry source</button></div></div>}
    {record && <>
      <RecordBadges record={record} />
      <div className="search-inspector-actions">
        <a href={explorerTxUrl(record.txid, network)} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={15} /></a>
        <button type="button" onClick={() => void copyCurrentLink(setCopied)}><Copy size={15} /> {copied ? "Link copied" : "Copy record link"}</button>
        {(record.file?.mimeType === "text/html" || record.kind === "html") && <a href={`${appHref(BROWSER_APP_URL, LOCAL_BROWSER_APP_URL)}${appHref(BROWSER_APP_URL, LOCAL_BROWSER_APP_URL).includes("?") ? "&" : "?"}txid=${encodeURIComponent(record.txid)}&network=${network}`}>Open in Browser <ArrowUpRight size={15} /></a>}
      </div>
      <div className="search-inspector-tabs" aria-label="Source sections">
        {(["overview", "payload", "raw", "evidence"] as const).map(value => <button type="button" key={value} aria-pressed={tab === value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>{value === "raw" ? "Raw payload" : value[0].toUpperCase() + value.slice(1)}</button>)}
      </div>
      <div className="search-inspector-content">
        {tab === "overview" ? <>
          {record.valid === false && <div className="search-notice is-error"><CircleAlert size={18} /><div><strong>Invalid history</strong><p>This record does not establish canonical protocol state.</p>{record.validationErrors?.map((reason, index) => <p key={index}>{reason}</p>)}</div></div>}
          {record.status !== "confirmed" && <p className="search-history-warning">{record.status === "pending" ? "Pending visibility is best effort. This record is not confirmed history." : "This record is historical visibility and is not part of the current confirmed chain."}</p>}
          {record.status === "confirmed" && record.canonical === false && <p className="search-history-warning">The indexed chain position of this source is unverified. It does not establish current canonical state.</p>}
          <dl className="search-evidence-fields">
            <div><dt>Transaction</dt><dd>{record.txid}</dd></div>
            <div><dt>Proofs</dt><dd>{exactProofs(record.amountSats)}</dd></div>
            <div><dt>Indexed status</dt><dd>{record.status}</dd></div>
            <div><dt>Data bytes</dt><dd>{record.dataBytes?.toLocaleString("en-US") ?? "Unavailable"}</dd></div>
            <div><dt>Block height</dt><dd>{record.blockHeight ?? "Unconfirmed"}</dd></div>
            {record.blockHash && <div><dt>Block hash</dt><dd>{record.blockHash}</dd></div>}
            <div><dt>Indexed position</dt><dd>Transaction {record.blockIndex ?? "—"} · output {record.source.vout ?? "—"} · record {record.source.ordinal ?? "—"}</dd></div>
            <div><dt>Recorded</dt><dd>{readableDate(record.timestamp)}</dd></div>
          </dl>
          {record.file && <><h3>File metadata</h3><dl className="search-evidence-fields">{Object.entries(record.file).map(([key, value]) => <div key={key}><dt>{key === "sha256" ? "SHA-256" : key}</dt><dd>{String(value)}</dd></div>)}</dl></>}
          {record.participants.length > 0 && <><h3>Participants</h3><ul className="search-source-list">{record.participants.map((person, index) => <li key={`${person.address}:${index}`}><span>{person.role}</span><button type="button" onClick={() => searchValue(person.address)}>{person.powid || person.address}<ChevronRight size={14} /></button>{person.powid && <small>{person.address}</small>}</li>)}</ul></>}
          {record.refs.length > 0 && <><h3>References</h3><ul className="search-source-list">{record.refs.map((ref, index) => <li key={`${ref.type}:${index}`}><span>{ref.type}</span><button type="button" onClick={() => searchValue(ref.value)}>{ref.value}<ChevronRight size={14} /></button></li>)}</ul></>}
        </> : <pre className="search-source-code">{jsonText(tab === "payload" ? loaded.payload : tab === "raw" ? loaded.rawPayload : loaded.evidence)}</pre>}
      </div>
    </>}
  </dialog>;
}

export default function SearchRoot({ embedded = false, initialNetwork = "livenet" }: { embedded?: boolean; initialNetwork?: BitcoinNetwork } = {}) {
  const [query, setQuery] = useState<SearchQuery>(() => searchQueryFromLocation(initialNetwork));
  const [draft, setDraft] = useState(query.q);
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get("record") ?? "");
  const [refresh, setRefresh] = useState(0);
  const [response, setResponse] = useState<{ key: string; value: SearchResponse; rows: SearchRecord[] } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  const [copied, setCopied] = useState(false);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController>();
  const queryKey = JSON.stringify(query);
  const requestKey = `${queryKey}:${refresh}`;
  const active = response?.key === requestKey ? response : null;
  const error = failure?.key === requestKey ? failure.message : "";
  const loading = !active && !error;
  const coverage = active?.value.coverage;
  const recordCount = active?.value.pagination.total;
  const checkpointScoped = coverage?.ready && coverage.scope === "complete-at-checkpoint";
  const formId = useId();

  const writeLocation = useCallback((next: SearchQuery, record = "", replace = false) => {
    const url = new URL(window.location.href);
    for (const key of ["q", "protocol", "kind", "status", "valid", "sort", "network", "record", "cursor"]) url.searchParams.delete(key);
    for (const [key, value] of Object.entries(next)) if (value !== "" && (key === "network" || value !== DEFAULT_SEARCH_QUERY[key as keyof SearchQuery])) url.searchParams.set(key, value);
    if (record) url.searchParams.set("record", record);
    window.history[replace ? "replaceState" : "pushState"](window.history.state, "", url);
    setQuery(next); setSelectedId(record); setCopied(false);
  }, []);

  const applyQuery = useCallback((next: SearchQuery) => {
    controllerRef.current?.abort();
    setDraft(next.q); setLoadingMore(false); setPageError("");
    writeLocation(next);
  }, [writeLocation]);

  useEffect(() => {
    const onPop = () => {
      const next = searchQueryFromLocation(initialNetwork);
      setQuery(next); setDraft(next.q); setSelectedId(new URLSearchParams(window.location.search).get("record") ?? ""); setCopied(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [initialNetwork]);

  const previousNetworkRef = useRef(initialNetwork);
  useEffect(() => {
    if (previousNetworkRef.current === initialNetwork) return;
    previousNetworkRef.current = initialNetwork;
    applyQuery({ ...query, network: initialNetwork });
  }, [initialNetwork, applyQuery, query]);

  useEffect(() => {
    const generation = ++generationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoadingMore(false); setPageError(""); setFailure(null);
    void fetchSearch(query, controller.signal).then(value => {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setResponse({ key: requestKey, value, rows: value.results });
    }).catch(reason => {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setFailure({ key: requestKey, message: errorText(reason) });
    });
    return () => controller.abort();
  }, [requestKey, query]);

  const loadMore = async () => {
    const cursor = active?.value.pagination.nextCursor;
    if (!cursor || loadingMore) return;
    const generation = generationRef.current;
    const controller = controllerRef.current;
    if (!controller || controller.signal.aborted) return;
    setLoadingMore(true); setPageError("");
    try {
      const next = await fetchSearch(query, controller.signal, cursor);
      if (generation !== generationRef.current || controller.signal.aborted) return;
      const seen = new Set(active.rows.map(row => row.id));
      const rows = [...active.rows, ...next.results.filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; })];
      if (next.pagination.hasMore && next.pagination.nextCursor === cursor) throw new Error("The result cursor did not advance. Refresh this search to continue.");
      setResponse({ key: requestKey, value: next, rows });
    } catch (reason) {
      if (generation === generationRef.current && !controller.signal.aborted) setPageError(errorText(reason));
    } finally { if (generation === generationRef.current && !controller.signal.aborted) setLoadingMore(false); }
  };

  const protocols = useMemo(() => Array.from(new Set([...Object.keys(PROTOCOLS), ...Object.keys(coverage?.byProtocol ?? {}), ...(query.protocol ? [query.protocol] : [])])), [coverage, query.protocol]);
  const kinds = useMemo(() => Array.from(new Set([...(coverage?.kinds ?? []), ...(active?.rows.map(row => row.kind) ?? []), ...(query.kind ? [query.kind] : [])])).sort(), [coverage, active, query.kind]);
  const hasFilters = query.protocol || query.kind || query.status !== "confirmed" || query.valid !== "valid" || query.sort !== "relevance";
  const submit = (event: FormEvent) => { event.preventDefault(); const next = { ...query, q: draft.trim() }; if (next.q === query.q) setRefresh(value => value + 1); else applyQuery(next); };
  const Main = embedded ? "div" : "main";

  return <div className={embedded ? "search-embedded-app" : "search-standalone-app"}>
    {!embedded && <AppHeader title="ProofOfWork Search" subtitle="The public Computer, searchable." />}
    <Main className="search-main" {...(!embedded ? { id: "main-content" } : {})}>
      <section className="search-intro" aria-labelledby={`${formId}-title`}>
        <div className="search-intro-copy"><span className="search-eyebrow"><Database size={13} /> ProofOfWork Computer</span><h1 id={`${formId}-title`}>Find the record.</h1><p>Search public protocols, words, names, files, and transaction data.</p></div>
        <span className="search-public-label"><span aria-hidden="true" /> Public · No wallet needed</span>
      </section>
      <form className="search-query-form" onSubmit={submit} role="search" aria-label="Computer records">
        <label className="search-query-label" htmlFor={`${formId}-query`}>Search the Computer</label>
        <div className="search-query-box"><Search size={22} aria-hidden="true" /><input id={`${formId}-query`} type="search" value={draft} onChange={event => setDraft(event.target.value)} maxLength={512} placeholder="A topic, PowID, address, txid, or protocol…" autoComplete="off" /><button type="submit">Search <ChevronRight size={17} /></button></div>
        <div className="search-query-hint"><span>Public text and exact source data. Confirmed, valid records by default.</span><a href={searchApiHref(query)} target="_blank" rel="noreferrer"><Code2 size={14} /> JSON API <ArrowUpRight size={12} /></a></div>
      </form>
      <section className="search-filters" aria-label="Search filters">
        <span className="search-filter-icon" aria-hidden="true"><SlidersHorizontal size={17} /></span>
        <label>Protocol<select aria-label="Protocol" value={query.protocol} onChange={event => applyQuery({ ...query, protocol: event.target.value, kind: "" })}><option value="">All protocols</option>{protocols.map(protocol => <option key={protocol} value={protocol}>{PROTOCOLS[protocol] ? `${PROTOCOLS[protocol]} · ${protocol}` : protocol}</option>)}</select></label>
        <label>Action<select aria-label="Action" value={query.kind} onChange={event => applyQuery({ ...query, kind: event.target.value })}><option value="">All actions</option>{kinds.map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label>
        <label>History<select aria-label="History" value={query.status} onChange={event => applyQuery({ ...query, status: event.target.value as SearchQuery["status"] })}><option value="confirmed">Confirmed</option><option value="all">All statuses</option><option value="pending">Pending</option><option value="dropped">Dropped</option><option value="orphaned">Orphaned</option></select></label>
        <label>Validity<select aria-label="Validity" value={query.valid} onChange={event => applyQuery({ ...query, valid: event.target.value as SearchQuery["valid"] })}><option value="valid">Valid records</option><option value="all">All evidence</option><option value="invalid">Invalid records</option></select></label>
        <label>Sort<select aria-label="Sort" value={query.sort} onChange={event => applyQuery({ ...query, sort: event.target.value as SearchQuery["sort"] })}><option value="relevance">Relevance</option><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="proofs">Highest proofs</option></select></label>
        <label>Network<select aria-label="Network" value={query.network} onChange={event => applyQuery({ ...query, network: event.target.value as BitcoinNetwork })}>{Object.entries(NETWORK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </section>
      <div className="search-result-toolbar"><div aria-live="polite" role="status">{loading ? "Searching public records…" : error ? "Search unavailable" : <>{recordCount?.toLocaleString("en-US")} {coverage?.ready ? "matching" : "currently indexed"} {recordCount === 1 ? "record" : "records"}{query.q && <> for <strong>“{query.q}”</strong></>}</>}</div><div className="search-toolbar-actions">{hasFilters && <button type="button" onClick={() => applyQuery({ ...DEFAULT_SEARCH_QUERY, network: query.network, q: query.q })}>Reset filters</button>}<button type="button" onClick={() => void copyCurrentLink(setCopied)}><Copy size={14} /> {copied ? "Copied" : "Share search"}</button></div></div>
      {coverage && !coverage.ready && <div className="search-notice" role="status"><CircleAlert size={19} /><div><strong>Index coverage is incomplete</strong><p>These results cover the records indexed so far. Missing results do not establish that a record does not exist.</p></div></div>}
      {checkpointScoped && <p className="search-checkpoint-note">Search covers verified history through block {coverage.checkpointHeight?.toLocaleString("en-US") ?? "unavailable"}. Newer records may not be indexed yet.</p>}
      {query.status !== "confirmed" && <div className="search-history-warning">Pending visibility is best effort. Dropped and orphaned records do not establish current confirmed state.</div>}
      {error && <div className="search-notice is-error" role="alert"><CircleAlert size={20} /><div><strong>Search is unavailable</strong><p>{error}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>Retry search</button></div></div>}
      <section className="search-results" aria-label="Search results" aria-busy={loading}>
        {loading && <div className="search-loading"><span className="search-loading-line" /><span className="search-loading-line" /><span className="search-loading-line" /><p>Reading the public search index…</p></div>}
        {active?.rows.map(record => <article className="search-result" key={record.id}>
          <RecordBadges record={record} />
          <h2><button type="button" onClick={() => writeLocation(query, record.id)}><span className="search-result-title"><Highlight text={record.title || record.kind} query={query.q} /></span><ArrowUpRight size={18} aria-hidden="true" /></button></h2>
          {record.excerpt && <p className="search-excerpt"><Highlight text={record.excerpt.slice(0, 800)} query={query.q} /></p>}
          {record.file && <div className="search-file-meta"><FileText size={14} />{record.file.name} · {record.file.mimeType} · {record.file.size.toLocaleString("en-US")} bytes</div>}
          <div className="search-result-meta"><span className="search-proofs">{exactProofs(record.amountSats)} <span>proofs</span></span><time>{readableDate(record.timestamp)}</time>{record.blockHeight != null && <span>Block {record.blockHeight.toLocaleString("en-US")}</span>}<a href={explorerTxUrl(record.txid, query.network)} target="_blank" rel="noreferrer" aria-label={`Transaction ${record.txid}`}>{compact(record.txid)} <ArrowUpRight size={12} /></a></div>
          {record.participants.length > 0 && <div className="search-result-people">{record.participants.slice(0, 3).map((person, index) => <button type="button" key={`${person.address}:${index}`} title={`${person.role}: ${person.address}`} onClick={() => applyQuery({ ...query, q: person.address })}>{person.role}: {person.powid || compact(person.address)}</button>)}</div>}
        </article>)}
        {active && active.rows.length === 0 && <div className="search-empty"><Search size={34} aria-hidden="true" /><h2>{checkpointScoped ? `No matching records through block ${coverage.checkpointHeight?.toLocaleString("en-US")}` : coverage?.ready ? "No matching records" : "No matches in the indexed records yet"}</h2><p>{coverage?.ready ? "Try another word, an exact identifier, or broader filters." : "Coverage is still building. Try again as the index advances."}</p>{hasFilters && <button type="button" onClick={() => applyQuery({ ...DEFAULT_SEARCH_QUERY, network: query.network, q: query.q })}>Clear filters</button>}</div>}
      </section>
      {pageError && <p className="search-page-error" role="alert">{pageError}</p>}
      {active?.value.pagination.hasMore && <div className="search-pagination"><span>{active.rows.length.toLocaleString("en-US")} of {recordCount?.toLocaleString("en-US")} records</span><button type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading records…" : pageError ? "Retry more results" : "More results"}<ArrowDown size={16} /></button></div>}
      {coverage && <details className="search-coverage"><summary><span><span className={`search-coverage-dot ${coverage.ready ? "is-ready" : ""}`} />{coverage.ready ? "Indexed coverage" : "Partial index coverage"} · {NETWORK_LABELS[query.network]}{coverage.checkpointHeight != null && ` · block ${coverage.checkpointHeight.toLocaleString("en-US")}`}</span><Database size={15} /></summary><div className="search-coverage-content"><p>Results are projections of public chain records. The source transaction remains the evidence.</p><dl className="search-evidence-fields"><div><dt>Index version</dt><dd>{coverage.indexVersion || "Unavailable"}</dd></div><div><dt>Last indexed</dt><dd>{coverage.lastIndexedAt || "Unavailable"}</dd></div>{coverage.checkpointHash && <div><dt>Checkpoint hash</dt><dd>{coverage.checkpointHash}</dd></div>}</dl><pre className="search-source-code">{JSON.stringify({ sourceCounts: coverage.sourceCounts, byProtocol: coverage.byProtocol }, null, 2)}</pre></div></details>}
      <div className="search-bottom-note"><Check size={15} /> Inspect the source. Verify the record.</div>
    </Main>
    {!embedded && <SocialFooter compact />}
    {selectedId && <SearchInspector key={`${query.network}:${selectedId}`} id={selectedId} network={query.network} close={() => writeLocation(query, "", true)} searchValue={value => applyQuery({ ...query, q: value })} />}
  </div>;
}
