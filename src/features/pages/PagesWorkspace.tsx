import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { ArrowUpRight, Braces, CheckCircle2, Code2, Copy, Download, FileCode2, FolderOpen, Play, Plus, Square, Upload } from "lucide-react";
import {
  MAX_PAGE_BYTES, MAX_PAGE_DRAFTS, decodePageFile, identityCardHtml, insertPageMarkup,
  pageByteLength, pageFileName, pagesAppPreviewHtml, pagesStorageKey, pageTemplateHtml,
  validatePageHtml, validatePagesDrafts,
  type PageDraft, type PagesDraftStore, type PagesIdentity, type PagesNetwork,
} from "./pagesModel.mjs";
import "./pages.css";
import { dnsPageLinkNameError, normalizeDnsPageLinkName } from "../../shared/protocol/dnsPages.mjs";
import { parseDnsSubdomainName } from "../../shared/protocol/dnsSubdomains.mjs";
import { fetchCodeRepository, codeVersion, verifiedCodeSource } from "../code/codeApi";
import { validateCodePath } from "../../shared/protocol/codeRepository.mjs";
import { appHref } from "../../app/routeRegistry";

export type PagesPublication = { title: string; html: string; mode: "body" | "attachment" };
export type PagesPublicationDraft = PagesPublication;
export type PagesLoadedPage = { html: string; title: string; txid: string; confirmed: boolean; sender: string; sha256: string };
export type PagesFileChoice = { key: string; name: string; html: string };
export type PagesDnsLinkRequest = { name: string; pageTxid: string | null };
export type PagesWorkspaceProps = {
  embedded?: boolean;
  address?: string;
  network: PagesNetwork;
  onPublish: (draft: PagesPublication) => void | Promise<void>;
  onLoadPage: (txid: string) => Promise<PagesLoadedPage>;
  onResolveIdentity: (id: string) => Promise<PagesIdentity>;
  renderStaticPreview: (html: string) => ReactNode;
  fileChoices?: PagesFileChoice[];
  onOpenFiles?: () => void;
  browserHref: (txid: string) => string;
  pageHref?: (txid: string) => string;
  onLinkPage?: (request: PagesDnsLinkRequest) => void | Promise<void>;
  dnsBrowserHref?: (name: string) => string;
  dnsLinkFeeControl?: ReactNode;
  dnsLinkRestore?: { nonce: number; name: string; pageTxid: string | null };
};

function createDraft(title: string, html = pageTemplateHtml(title)): PageDraft {
  return { id: crypto.randomUUID(), title, html, updatedAt: Date.now() };
}

function initialDrafts(key: string) {
  const draft = createDraft("My ProofOfWork Page");
  const fallback: PagesDraftStore = { version: 1, activeId: draft.id, drafts: [draft] };
  try {
    const raw = localStorage.getItem(key);
    return { store: raw === null ? fallback : validatePagesDrafts(JSON.parse(raw)), error: "", writable: true };
  } catch {
    return {
      store: fallback,
      error: "Saved Pages drafts could not be read. Existing storage is preserved; export your work to keep changes made in this session.",
      writable: false,
    };
  }
}

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

// Changing account or network remounts the editor, fences asynchronous imports,
// and stops its app frame before a different local draft namespace is opened.
export function PagesWorkspace(props: PagesWorkspaceProps) {
  const scopeKey = pagesStorageKey(props.network, props.address);
  useEffect(() => {
    if (document.head.querySelector("meta[data-pow-pages-frame-policy]")) return;
    const policy = document.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = "frame-src 'self'";
    policy.dataset.powPagesFramePolicy = "";
    document.head.append(policy);
    // CSP stays effective after removal, so keep the policy visible to inspect.
  }, []);
  return <PagesEditor key={scopeKey} {...props} scopeKey={scopeKey} />;
}

function PagesEditor({ embedded, address, network, onPublish, onLoadPage, onResolveIdentity, renderStaticPreview, fileChoices = [], onOpenFiles, browserHref, pageHref, onLinkPage, dnsBrowserHref, dnsLinkFeeControl, dnsLinkRestore, scopeKey }: PagesWorkspaceProps & { scopeKey: string }) {
  const [initial] = useState(() => initialDrafts(scopeKey));
  const [store, setStore] = useState(initial.store);
  const [saveError, setSaveError] = useState(initial.error);
  const [savedAt, setSavedAt] = useState<number>();
  const [view, setView] = useState<"source" | "preview">("source");
  const [status, setStatus] = useState<{ tone: "idle" | "good" | "bad"; text: string }>({ tone: "idle", text: "Create HTML locally. Preview it, then review publication in Mail." });
  const [mode, setMode] = useState<"body" | "attachment">("body");
  const [txid, setTxid] = useState(() => new URLSearchParams(window.location.search).get("txid") || "");
  const [identity, setIdentity] = useState("");
  const [fileKey, setFileKey] = useState("");
  const [codeRepo, setCodeRepo] = useState("");
  const [codePath, setCodePath] = useState("index.html");
  const [codeRevision, setCodeRevision] = useState("");
  const [busy, setBusy] = useState<"load" | "identity" | "publish" | "import" | "code" | "link" | undefined>();
  const codeInFlight = useRef(false);
  const codeAbort = useRef<AbortController>();
  const [dnsName, setDnsName] = useState("");
  const [dnsTxid, setDnsTxid] = useState("");
  const dnsAutofill = useRef("");
  const dnsInFlight = useRef(false);
  const [runtime, setRuntime] = useState<{ draftId: string; source: string; srcDoc: string; runId: number }>();
  const [discardArmed, setDiscardArmed] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const draft = store.drafts.find((candidate) => candidate.id === store.activeId)!;
  const bytes = useMemo(() => pageByteLength(draft.html), [draft.html]);
  const activeRuntime = runtime?.draftId === draft.id && runtime.source === draft.html ? runtime : undefined;
  const staticPreview = useMemo(() => view === "preview" && !activeRuntime ? renderStaticPreview(draft.html) : null, [activeRuntime, draft.html, renderStaticPreview, view]);
  const suggestedDnsTxid = draft.origin?.confirmed && !draft.origin.modified ? draft.origin.txid : "";
  const dnsChildName = parseDnsSubdomainName(dnsName);
  const dnsNameError = dnsName.trim() && !dnsChildName ? dnsPageLinkNameError(dnsName) : "";
  const canReviewDns = Boolean(address && network === "livenet" && onLinkPage && !busy && dnsName.trim() && !dnsNameError);
  let dnsNameHref: string | undefined;
  if (dnsBrowserHref && dnsName.trim() && !dnsNameError) dnsNameHref = dnsBrowserHref(dnsChildName?.name ?? `${normalizeDnsPageLinkName(dnsName)}.pow`);
  const codeParams = new URLSearchParams({ network });
  if (/^[a-f0-9]{64}$/iu.test(codeRepo.trim())) codeParams.set("repo", codeRepo.trim().toLowerCase());
  if (validateCodePath(codePath.trim())) codeParams.set("path", codePath.trim());
  if (/^[a-f0-9]{64}$/iu.test(codeRevision.trim())) codeParams.set("version", codeRevision.trim().toLowerCase());
  const codeHref = appHref(`https://code.proofofwork.me/?${codeParams}`, `/?code=1&${codeParams}`);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; codeAbort.current?.abort(); };
  }, []);
  useEffect(() => {
    const initialTxid = new URLSearchParams(window.location.search).get("txid") || "";
    if (/^[a-f0-9]{64}$/iu.test(initialTxid)) void loadHtml(true);
  }, []);
  useEffect(() => {
    if (!initial.writable) return;
    try {
      const checked = validatePagesDrafts(store);
      localStorage.setItem(scopeKey, JSON.stringify(checked));
      setSaveError("");
      setSavedAt(Date.now());
    } catch (error) {
      setSaveError(`${message(error, "Local autosave failed.")} Your current work remains in this session. Download HTML to keep a copy.`);
    }
  }, [initial.writable, scopeKey, store]);
  useEffect(() => {
    const previous = dnsAutofill.current;
    setDnsTxid((current) => !current || current === previous ? suggestedDnsTxid : current);
    dnsAutofill.current = suggestedDnsTxid;
  }, [draft.id, suggestedDnsTxid]);
  useEffect(() => {
    if (!dnsLinkRestore || dnsLinkRestore.nonce === 0) return;
    setDnsName(dnsLinkRestore.name);
    setDnsTxid(dnsLinkRestore.pageTxid || "");
    setStatus({ tone: "idle", text: "Saved DNS page-link task restored. Its live owner, epoch, page, and funding are checked again before review." });
  }, [dnsLinkRestore?.nonce]);

  function invalidate() {
    generation.current += 1;
    codeAbort.current?.abort();
    setRuntime(undefined);
    setBusy(undefined);
    setDiscardArmed(false);
  }

  function updateDraft(change: Partial<Pick<PageDraft, "title" | "html">>) {
    invalidate();
    setStore((current) => ({ ...current, drafts: current.drafts.map((item) => item.id === current.activeId ? {
      ...item, ...change, updatedAt: Date.now(),
      ...(change.html !== undefined && item.origin ? { origin: { ...item.origin, modified: true } } : {}),
    } : item) }));
  }

  function addDraft(next: PageDraft) {
    if (store.drafts.length >= MAX_PAGE_DRAFTS) throw new Error(`You have ${MAX_PAGE_DRAFTS} local drafts. Export and discard a draft before creating another.`);
    invalidate();
    setStore((current) => ({ ...current, activeId: next.id, drafts: [...current.drafts, next] }));
    setView("source");
  }

  function newDraft(app: boolean) {
    try {
      const title = app ? "My ProofOfWork App" : "Untitled page";
      addDraft(createDraft(title, pageTemplateHtml(title, app)));
      setStatus({ tone: "good", text: app ? "App draft created. Preview is static until you choose Run app." : "Page draft created and saved locally." });
    } catch (error) { setStatus({ tone: "bad", text: message(error, "Could not create a draft.") }); }
  }

  function downloadHtml() {
    const url = URL.createObjectURL(new Blob([draft.html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = pageFileName(draft.title);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus({ tone: "good", text: "HTML download prepared from the current source." });
  }

  async function copyHtml() {
    try {
      await navigator.clipboard.writeText(draft.html);
      if (mounted.current) setStatus({ tone: "good", text: "HTML copied." });
    } catch { if (mounted.current) setStatus({ tone: "bad", text: "Clipboard unavailable. Select the source or download the HTML." }); }
  }

  async function importHtml(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const request = ++generation.current;
    setRuntime(undefined);
    setBusy("import");
    try {
      if (file.size > MAX_PAGE_BYTES) throw new Error(`Import an HTML file of at most ${MAX_PAGE_BYTES.toLocaleString()} bytes.`);
      const html = decodePageFile(new Uint8Array(await file.arrayBuffer()));
      if (!mounted.current || request !== generation.current) return;
      addDraft(createDraft(file.name.replace(/\.(?:html?|xhtml)$/iu, "").slice(0, 160) || "Imported page", html));
      setStatus({ tone: "good", text: "HTML imported with its UTF-8 bytes preserved. Scripts have not run." });
    } catch (error) {
      if (mounted.current && request === generation.current) setStatus({ tone: "bad", text: message(error, "Could not import HTML.") });
    } finally { if (mounted.current && request === generation.current) setBusy(undefined); }
  }

  async function loadHtml(preview = false) {
    const target = txid.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(target)) {
      setStatus({ tone: "bad", text: "Enter a valid 64 character transaction ID." });
      return;
    }
    const request = ++generation.current;
    setRuntime(undefined);
    setBusy("load");
    setStatus({ tone: "idle", text: "Verifying HTML through Browser's existing transaction and file checks..." });
    try {
      const loaded = await onLoadPage(target);
      if (!mounted.current || request !== generation.current) return;
      const html = validatePageHtml(loaded.html);
      if (loaded.txid !== target || !/^[a-f0-9]{64}$/u.test(loaded.sha256)
          || typeof loaded.confirmed !== "boolean" || typeof loaded.sender !== "string") {
        throw new Error("The loaded page's source evidence is incomplete.");
      }
      const reusable = store.drafts.find((item) => item.origin?.txid === loaded.txid && !item.origin.modified && item.html === html);
      const imported: PageDraft = { ...(reusable || createDraft(loaded.title.slice(0, 160) || "Imported page", html)), updatedAt: Date.now(), origin: {
        txid: loaded.txid, sha256: loaded.sha256, confirmed: loaded.confirmed, sender: loaded.sender, modified: false,
      } };
      if (reusable) {
        invalidate();
        setStore((current) => ({ ...current, activeId: imported.id, drafts: current.drafts.map((item) => item.id === imported.id ? imported : item) }));
        setView("source");
      } else addDraft(imported);
      if (preview) setView("preview");
      setStatus({ tone: loaded.confirmed ? "good" : "idle", text: loaded.confirmed ? "Verified confirmed HTML imported as a local draft. Scripts have not run." : "Verified pending HTML imported. Pending visibility is best effort; confirmation is canonical. Scripts have not run." });
    } catch (error) {
      if (mounted.current && request === generation.current) setStatus({ tone: "bad", text: message(error, "Could not load verified HTML.") });
    } finally { if (mounted.current && request === generation.current) setBusy(undefined); }
  }

  async function insertIdentity() {
    const requestedId = identity.trim();
    if (!requestedId) { setStatus({ tone: "bad", text: "Enter a ProofOfWork ID to resolve its confirmed receiver." }); return; }
    const request = ++generation.current;
    const selection = editor.current && document.activeElement === editor.current ? { start: editor.current.selectionStart, end: editor.current.selectionEnd } : undefined;
    setRuntime(undefined);
    setBusy("identity");
    try {
      const resolved = await onResolveIdentity(requestedId);
      if (!mounted.current || request !== generation.current) return;
      const html = validatePageHtml(insertPageMarkup(draft.html, identityCardHtml(resolved), selection));
      updateDraft({ html });
      setView("source");
      setStatus({ tone: "good", text: `Inserted ${resolved.id} with its confirmed owner and receiver. This card is a snapshot; resolve again when updating it.` });
    } catch (error) {
      if (mounted.current && request === generation.current) setStatus({ tone: "bad", text: message(error, "Could not resolve a confirmed ID.") });
    } finally { if (mounted.current && request === generation.current) setBusy(undefined); }
  }

  function importFromFiles() {
    try {
      const choice = fileChoices.find((candidate) => candidate.key === fileKey);
      if (!choice) throw new Error("Choose a verified HTML file first.");
      addDraft(createDraft(choice.name.replace(/\.(?:html?|xhtml)$/iu, "").slice(0, 160) || "Imported file", validatePageHtml(choice.html)));
      setStatus({ tone: "good", text: "Verified Files HTML imported as a local draft. Scripts have not run." });
    } catch (error) { setStatus({ tone: "bad", text: message(error, "Could not import from Files.") }); }
  }

  async function importFromCode() {
    if (codeInFlight.current || dnsInFlight.current) return;
    const repo = codeRepo.trim().toLowerCase();
    const path = codePath.trim();
    const requestedVersion = codeRevision.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(repo) || requestedVersion && !/^[a-f0-9]{64}$/u.test(requestedVersion)) {
      setStatus({ tone: "bad", text: "Enter a 64 character repository transaction and, optionally, a confirmed version transaction." });
      return;
    }
    if (!validateCodePath(path) || !/\.(?:html?|xhtml)$/iu.test(path)) {
      setStatus({ tone: "bad", text: "Choose an HTML file path from the Code repository." });
      return;
    }
    codeInFlight.current = true;
    const request = ++generation.current;
    const controller = new AbortController();
    codeAbort.current = controller;
    setRuntime(undefined);
    setBusy("code");
    setStatus({ tone: "idle", text: "Verifying the confirmed Code tree, version, and exact HTML bytes..." });
    try {
      const detail = await fetchCodeRepository(network, repo, { version: requestedVersion || undefined, fresh: true, signal: controller.signal });
      if (!mounted.current || request !== generation.current) return;
      const version = codeVersion(detail, requestedVersion);
      if (!/^[a-f0-9]{64}$/u.test(version)) throw new Error("The confirmed Code version is unavailable.");
      const expected = detail.files.find((file) => file.path === path);
      if (!expected) throw new Error("This HTML file is missing from the confirmed Code version.");
      const loaded = await fetchCodeRepository(network, repo, { snapshot: detail.snapshot.id, version, path, signal: controller.signal });
      if (!mounted.current || request !== generation.current) return;
      if (!loaded.file) throw new Error("Verified Code source bytes are unavailable.");
      const html = decodePageFile(verifiedCodeSource(loaded.file, expected).bytes);
      addDraft(createDraft(path.split("/").pop()!.replace(/\.(?:html?|xhtml)$/iu, "").slice(0, 160) || "Code HTML", html));
      setStatus({ tone: "good", text: `Verified Code HTML imported from ${path} at version ${version.slice(0, 12)}. This local draft must be published before DNS linking. Scripts have not run.` });
    } catch (error) {
      if (mounted.current && request === generation.current) setStatus({ tone: "bad", text: message(error, "Could not import verified Code HTML.") });
    } finally {
      codeInFlight.current = false;
      if (codeAbort.current === controller) codeAbort.current = undefined;
      if (mounted.current && request === generation.current) setBusy(undefined);
    }
  }

  function runApp() {
    try {
      setRuntime({ draftId: draft.id, source: draft.html, srcDoc: pagesAppPreviewHtml(draft.html, document), runId: Date.now() });
      setView("preview");
      setStatus({ tone: "idle", text: "Inline JavaScript is running in an isolated frame. Editing the source stops this run." });
    } catch (error) { setStatus({ tone: "bad", text: message(error, "Could not run the app preview.") }); }
  }

  async function reviewPublication() {
    const request = ++generation.current;
    setRuntime(undefined);
    try {
      validatePageHtml(draft.html);
      if (!address) throw new Error("Connect your local wallet to review publication.");
      setBusy("publish");
      await onPublish({ title: draft.title.trim() || "ProofOfWork page", html: draft.html, mode });
      if (mounted.current && request === generation.current) setStatus({ tone: "good", text: "Publication copied into Mail. Review recipient, proofs, file evidence, and miner fee before signing locally." });
    } catch (error) {
      if (mounted.current && request === generation.current) setStatus({ tone: "bad", text: message(error, "Could not prepare publication.") });
    } finally { if (mounted.current && request === generation.current) setBusy(undefined); }
  }

  async function reviewDnsLink(clear: boolean) {
    if (dnsInFlight.current) return;
    dnsInFlight.current = true;
    const request = ++generation.current;
    setRuntime(undefined);
    try {
      if (!address || network !== "livenet") throw new Error("Connect your local Mainnet wallet to link a .pow name.");
      if (!onLinkPage) throw new Error("DNS page linking is unavailable in this build.");
      const childName = parseDnsSubdomainName(dnsName);
      const nameError = childName ? "" : dnsPageLinkNameError(dnsName);
      if (nameError) throw new Error(nameError);
      const name = childName?.name ?? normalizeDnsPageLinkName(dnsName);
      const pageTxid = clear ? null : dnsTxid.trim().toLowerCase();
      if (pageTxid !== null && !/^[a-f0-9]{64}$/u.test(pageTxid)) throw new Error("Enter a valid published page transaction ID.");
      setBusy("link");
      await onLinkPage({ name, pageTxid });
      if (mounted.current && request === generation.current) setStatus({ tone: "idle", text: `DNS ${clear ? "clear" : "link"} submitted for ${childName ? name : name + ".pow"}. It remains pending until confirmed; Browser resolution follows confirmed links.` });
    } catch (error) {
      if (mounted.current && request === generation.current) setStatus({ tone: "bad", text: message(error, "Could not prepare a DNS page link.") });
    } finally {
      dnsInFlight.current = false;
      if (mounted.current && request === generation.current) setBusy(undefined);
    }
  }

  function discardDraft() {
    if (!discardArmed) { setDiscardArmed(true); return; }
    invalidate();
    const remaining = store.drafts.filter((item) => item.id !== draft.id);
    const next = remaining[0] || createDraft("Untitled page");
    setStore({ version: 1, activeId: next.id, drafts: remaining.length ? remaining : [next] });
    setStatus({ tone: "idle", text: "Local draft discarded. Published ProofOfWork records remain permanent." });
  }

  return <section className={`pages-workspace${embedded ? " pages-workspace-embedded" : ""}`} aria-label="Pages workspace">
    <header className="pages-hero">
      <div><span className="pages-kicker">ProofOfWork Computer / Pages</span><h2>Create something worth keeping.</h2><p>Write a page or a small app. Keep drafts locally, preview the source, and publish through the existing ProofOfWork Mail and Files tools.</p></div>
      <div className="pages-hero-mark" aria-hidden="true"><FileCode2 size={32} /><span>HTML / CSS / JS</span></div>
    </header>
    <div className={`pages-status pages-status-${status.tone}`} role="status"><span className="pages-status-dot" aria-hidden="true" />{status.text}</div>
    {saveError ? <div className="pages-save-error" role="alert"><strong>Local autosave unavailable</strong><p>{saveError}</p><button type="button" className="secondary small" onClick={downloadHtml}><Download size={15} /> Download HTML</button></div> : null}

    <div className="pages-editor-card">
      <div className="pages-draft-toolbar">
        <label className="pages-draft-select">Local draft<select value={store.activeId} disabled={Boolean(busy)} onChange={(event) => { invalidate(); setStore((current) => ({ ...current, activeId: event.target.value })); }}>
          {store.drafts.map((item) => <option key={item.id} value={item.id}>{item.title || "Untitled page"}</option>)}
        </select></label>
        <div className="pages-actions"><button type="button" className="secondary small" disabled={Boolean(busy)} onClick={() => newDraft(false)}><Plus size={15} /> New page</button><button type="button" className="secondary small" disabled={Boolean(busy)} onClick={() => newDraft(true)}><Braces size={15} /> New app</button></div>
      </div>
      <div className="pages-document-head"><label>Page title<input value={draft.title} maxLength={160} disabled={busy === "publish" || busy === "link"} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="Name your page" /></label><span className="pages-save-state">{saveError ? "Session only" : savedAt ? "Saved locally" : "Saving locally"}<small>{address ? `${network} · ${address.slice(0, 8)}…${address.slice(-6)}` : `${network} · disconnected drafts`}</small></span></div>
      <div className="pages-editor-tools">
        <div className="pages-view-tabs" role="group" aria-label="Editor view"><button type="button" aria-pressed={view === "source"} disabled={busy === "publish" || busy === "link"} onClick={() => { setRuntime(undefined); setView("source"); }}><Code2 size={15} /> Source</button><button type="button" aria-pressed={view === "preview"} disabled={busy === "publish" || busy === "link"} onClick={() => setView("preview")}><FileCode2 size={15} /> Preview</button></div>
        <div className="pages-actions"><input ref={importInput} data-testid="pages-import" aria-label="Import HTML file" type="file" accept=".html,.htm,.xhtml,text/html,application/xhtml+xml" hidden onChange={(event) => void importHtml(event)} /><button type="button" className="secondary small" disabled={Boolean(busy)} onClick={() => importInput.current?.click()}><Upload size={15} /> Import HTML</button><button type="button" className="secondary small" onClick={downloadHtml}><Download size={15} /> Download HTML</button><button type="button" className="secondary small" onClick={() => void copyHtml()}><Copy size={15} /> Copy HTML</button></div>
      </div>
      {view === "source" ? <textarea ref={editor} className="pages-source" aria-label="HTML source" value={draft.html} spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={busy === "publish" || busy === "link"} onChange={(event) => updateDraft({ html: event.target.value })} /> : <div className="pages-preview">
        <div className="pages-preview-head"><div><strong>{activeRuntime ? "App preview" : "Static preview"}</strong><p>{activeRuntime ? "Inline JavaScript runs in an isolated preview. Wallet access, external resources, forms, popups, and top navigation are disabled." : "Browser's static renderer disables scripts and external requests. Choose Run app to test inline JavaScript for this draft."}</p></div>{activeRuntime ? <button type="button" className="secondary small" onClick={() => setRuntime(undefined)}><Square size={15} /> Stop app</button> : <button type="button" className="secondary small" disabled={Boolean(busy) || bytes > MAX_PAGE_BYTES || !draft.html.trim()} onClick={runApp}><Play size={15} /> Run app</button>}</div>
        {activeRuntime ? <iframe key={activeRuntime.runId} title="Pages app preview" sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; autoplay 'none'; display-capture 'none'" referrerPolicy="no-referrer" src={`/pages-runner.html#${encodeURIComponent(activeRuntime.srcDoc)}`} /> : staticPreview}
      </div>}
      <div className="pages-editor-foot"><span className={bytes > MAX_PAGE_BYTES ? "pages-over-limit" : ""}>{bytes.toLocaleString()} UTF-8 bytes <span>/ {MAX_PAGE_BYTES.toLocaleString()} source limit</span></span><span>Protocol overhead is checked in Mail review.</span></div>
    </div>

    {draft.origin ? <details className="pages-source-evidence" open><summary><CheckCircle2 size={16} /> Imported source evidence <span>Status at import: {draft.origin.confirmed ? "Confirmed" : "Pending"}{draft.origin.modified ? " · edited locally" : " · source unchanged"}</span></summary><dl><div><dt>Transaction ID</dt><dd>{draft.origin.txid}</dd></div><div><dt>Source SHA-256</dt><dd>{draft.origin.sha256}</dd></div><div><dt>Sender</dt><dd>{draft.origin.sender}</dd></div></dl><p>{draft.origin.modified ? "This evidence identifies the source at the time of import. The edited draft is a new local document." : draft.origin.confirmed ? "The source was confirmed when imported. This local draft preserves historical provenance; load the transaction again to check current chain status." : "The source was pending when imported. Pending visibility is best effort; load the transaction again to check current chain status."}</p><div className="pages-actions"><a className="secondary small link-button" href={browserHref(draft.origin.txid)} target="_blank" rel="noreferrer">Open source in Browser <ArrowUpRight size={14} /></a>{pageHref ? <button type="button" className="secondary small" onClick={() => { void navigator.clipboard.writeText(pageHref(draft.origin!.txid)).then(() => { if (mounted.current) setStatus({ tone: "good", text: "Pages source link copied." }); }, () => { if (mounted.current) setStatus({ tone: "bad", text: "Clipboard unavailable. Open the source in Browser to share its transaction ID." }); }); }}><Copy size={14} /> Copy Pages link</button> : null}</div></details> : null}

    <div className="pages-tools-grid">
      <section className="pages-tool-card"><span className="pages-kicker">Identity</span><h3>Build with confirmed IDs</h3><p>Resolve an existing ID and insert its owner, receiver, and Computer link into the source.</p><form onSubmit={(event) => { event.preventDefault(); void insertIdentity(); }}><label>ProofOfWork ID<input value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder="name@proofofwork.me" autoComplete="off" spellCheck={false} /></label><button type="submit" className="secondary" disabled={Boolean(busy) || !identity.trim()}>{busy === "identity" ? "Resolving..." : "Insert identity"}</button></form><small>Identity card values are a confirmed snapshot at insertion.</small></section>
      <section className="pages-tool-card"><span className="pages-kicker">Browser</span><h3>Continue from chain HTML</h3><p>Load a message body or verified HTML attachment as a new local draft.</p><form onSubmit={(event) => { event.preventDefault(); void loadHtml(); }}><label>Transaction ID<input value={txid} onChange={(event) => setTxid(event.target.value)} placeholder="64 character txid" autoComplete="off" spellCheck={false} /></label><button type="submit" className="secondary" disabled={Boolean(busy) || !txid.trim()}>{busy === "load" ? "Verifying..." : "Load HTML"}</button></form><small>Imported apps stay static until you choose Run app.</small></section>
      <section className="pages-tool-card"><span className="pages-kicker">Files</span><h3>Use your HTML library</h3><p>Start from confirmed HTML already verified by the Computer's file tools.</p><label>Verified HTML file<select value={fileChoices.some((choice) => choice.key === fileKey) ? fileKey : ""} onChange={(event) => setFileKey(event.target.value)}><option value="">{fileChoices.length ? "Choose a file" : "No verified HTML files available"}</option>{fileChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.name}</option>)}</select></label><div className="pages-actions"><button type="button" className="secondary" disabled={Boolean(busy) || !fileChoices.some((choice) => choice.key === fileKey)} onClick={importFromFiles}>Import from Files</button>{onOpenFiles ? <button type="button" className="secondary small" onClick={onOpenFiles}><FolderOpen size={15} /> Open Files</button> : null}</div></section>
    </div>

    <section className="pages-code-card"><div><span className="pages-kicker">Code</span><h3>Start from confirmed source.</h3><p>Import an HTML file from a public Code repository. Its confirmed version and exact source bytes are verified before a local draft is created.</p><a className="secondary small link-button" href={codeHref} target="_blank" rel="noreferrer">Open Code<ArrowUpRight size={14} /></a></div><form onSubmit={(event) => { event.preventDefault(); void importFromCode(); }}><label className="pages-code-repository">Repository creation txid<input value={codeRepo} disabled={Boolean(busy)} onChange={(event) => setCodeRepo(event.target.value)} placeholder="64 character repository txid" autoComplete="off" spellCheck={false} /></label><label>HTML file path<input value={codePath} disabled={Boolean(busy)} onChange={(event) => setCodePath(event.target.value)} placeholder="index.html" autoComplete="off" spellCheck={false} /></label><label>Version txid (optional)<input value={codeRevision} disabled={Boolean(busy)} onChange={(event) => setCodeRevision(event.target.value)} placeholder="Current confirmed main head" autoComplete="off" spellCheck={false} /></label><button type="submit" className="secondary" disabled={Boolean(busy) || !codeRepo.trim() || !codePath.trim()}>{busy === "code" ? "Verifying Code..." : "Import Code HTML"}</button><small>Imports stay local until publication. A Code commit is source history; DNS linking uses a published HTML page transaction.</small></form></section>

    <section className="pages-publish-card"><div><span className="pages-kicker">Publish through Mail</span><h3>Review before making it permanent.</h3><p>HTML uses the existing message or file carrier. Mail prepares the transaction for your review and local wallet signature. Published pages open statically; Browser can run inline apps when the reader chooses Run app.</p></div><div className="pages-publish-controls"><label>Publication format<select value={mode} onChange={(event) => setMode(event.target.value as "body" | "attachment")} disabled={Boolean(busy)}><option value="body">HTML message body</option><option value="attachment">HTML file attachment</option></select></label><button type="button" className="primary" disabled={Boolean(busy) || !address || !draft.html.trim() || bytes > MAX_PAGE_BYTES} onClick={() => void reviewPublication()}>{busy === "publish" ? "Preparing..." : "Review publication"}<ArrowUpRight size={16} /></button>{!address ? <small>Connect your local wallet to publish. Drafts and previews work without a connection.</small> : null}</div></section>
    <section className="pages-dns-card" aria-label="DNS page linking"><div><span className="pages-kicker">ProofOfWork DNS</span><h3>Give your page a .pow address.</h3><p>Link a confirmed page transaction to a root name or active subdomain you own. Browser opens <span className="pages-dns-example">alice.pow</span> directly at its linked page. Your name's payment resolver stays the same.</p><small>A link uses published HTML, not this local draft. Only unchanged, confirmed imported source fills the transaction field automatically.</small></div><form onSubmit={(event) => { event.preventDefault(); void reviewDnsLink(false); }}><label>.pow name<input value={dnsName} aria-invalid={Boolean(dnsNameError)} disabled={Boolean(busy)} onChange={(event) => setDnsName(event.target.value)} placeholder="alice.pow or app.alice.pow" autoComplete="off" spellCheck={false} /></label>{dnsNameError ? <small className="pages-dns-error">{dnsNameError}</small> : null}<label>Published page txid<input value={dnsTxid} disabled={Boolean(busy)} onChange={(event) => setDnsTxid(event.target.value)} placeholder="64 character confirmed HTML txid" autoComplete="off" spellCheck={false} /></label>{dnsLinkFeeControl}<div className="pages-actions"><button type="submit" className="primary" disabled={!canReviewDns || !/^[a-f0-9]{64}$/iu.test(dnsTxid.trim())}>{busy === "link" ? "Preparing..." : "Review page link"}</button><button type="button" className="secondary" disabled={!canReviewDns} onClick={() => void reviewDnsLink(true)}>Review clear link</button>{dnsNameHref ? <a className="secondary small link-button" href={dnsNameHref} target="_blank" rel="noreferrer">Open name in Browser<ArrowUpRight size={14} /></a> : null}</div><small>{!address || network !== "livenet" ? "Connect your local Mainnet wallet to review a link or clear action." : "Confirmed ownership and page content are checked before review. The 546-proof payment goes to your owner address; pending links do not change Browser resolution."}</small></form></section>
    <div className="pages-local-foot"><span>{store.drafts.length} / {MAX_PAGE_DRAFTS} drafts in this browser and network. Download HTML for a portable copy.</span><button type="button" className="pages-discard" disabled={Boolean(busy)} onClick={discardDraft}>{discardArmed ? "Confirm discard of local draft" : "Discard local draft"}</button>{discardArmed ? <button type="button" className="pages-discard" onClick={() => setDiscardArmed(false)}>Cancel</button> : null}</div>
  </section>;
}
