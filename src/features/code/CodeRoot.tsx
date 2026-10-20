import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, Check, Code2, Copy, Download, FileCode2, FilePlus2, Folder, GitCommitHorizontal, History, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { AppHeader } from "../../shared/components/AppHeader";
import { followInternalLink, useVerifiedDocumentMetadata } from "../../app/documentMetadata";
import { ActionTransactionReview } from "../../shared/components/ActionTransactionReview";
import { ActionRecoveryPanel } from "../../shared/components/ActionRecoveryPanel";
import { ReviewDialog } from "../../shared/components/ReviewDialog";
import { FeeRateControl } from "../../shared/components/FeeRateControl";
import { SocialFooter } from "../../shared/components/SocialFooter";
import { explorerTxUrl, type BitcoinNetwork } from "../../shared/bitcoin/networks";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { useUnisatPresence } from "../../shared/wallet/useUnisatPresence";
import { readActionReceipts, saveActionReceipt, type ActionReceipt } from "../../shared/wallet/actionRecovery";
import { ensureWalletNetwork, getWalletNetwork, signAndBroadcastBoostPsbt } from "../boost/boostWallet";
import { syncSocialIdentityIntent, subscribeSocialIdentityIntent } from "../identity/socialIdentity";
import type { BoostIdentityIntent } from "../boost/boostProtocol";
import { shortAddress } from "../../functions";
import { fetchCodeRepositories, fetchCodeRepository, fetchCodePageSource, codeEvents, codeRepoId, codeVersion, verifiedCodeSource,
  type CodeDetail, type CodeEvent, type CodeFile, type CodeList, type CodePageEvidence, type CodePageSource } from "./codeApi";
import { buildCodePlan, codeDraftFields, emptyCodeDraft, exactSourceBytes, lineChange, persistCodeDraft, restoredCodeDraft, type CodeDraft } from "./codeProtocol";
import { prepareCodeTransaction, sameCodeAddress, verifyCodeAuthority, verifyCodeFunding, type PreparedCode } from "./codeWallet";
import { codeRepositoryZip, downloadCodeBlob } from "./codeArchive";
import { assertCodeSourceReference, type CodeSourceReference } from "./codeNavigation";
import "./code.css";

export type CodeViewState = { filter: string; openRepo: string; editor: boolean; editorPreview: "source" | "diff" };
export type CodeRootProps = { embedded?: boolean; initialAddress?: string; initialNetwork?: BitcoinNetwork;
  onOpenPages?: (source: CodeSourceReference) => void;
  initialViewState?: CodeViewState; onViewStateChange?: (state: CodeViewState) => void };
type Route = { repo: string; version: string; path: string; tab: "code" | "history" };
type Source = { file: CodeFile; content: string; bytes: Uint8Array; network: BitcoinNetwork; repo: string; version: string; snapshot: string };
const hexTx = /^[a-f0-9]{64}$/u;
function initialRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  return { repo: params.get("repo") ?? "", version: params.get("version") ?? "", path: params.get("path") ?? "", tab: params.get("tab") === "history" ? "history" : "code" };
}
function routeHref(next: Route) {
  const url = new URL(window.location.href);
  for (const key of ["repo", "version", "path", "tab"]) url.searchParams.delete(key);
  if (next.repo) url.searchParams.set("repo", next.repo);
  if (next.version) url.searchParams.set("version", next.version);
  if (next.path) url.searchParams.set("path", next.path);
  if (next.tab === "history") url.searchParams.set("tab", "history");
  return url.href;
}
function initialNetwork(fallback?: BitcoinNetwork): BitcoinNetwork {
  const value = new URLSearchParams(window.location.search).get("network");
  return value === "testnet" || value === "testnet4" || value === "livenet" ? value : fallback ?? "livenet";
}
function errorText(error: unknown) { return error instanceof Error ? error.message : "Code is temporarily unavailable. Try again in a moment."; }
function hasCodeDraft(draft: CodeDraft) {
  return Boolean(draft.name || draft.description || draft.path || draft.message || draft.content || draft.sourceTxid);
}
function codeDraftLabel(draft: CodeDraft) { return draft.kind === "repo" ? draft.name || "New repository" : draft.path || "Source commit"; }
function compactTx(txid: string) { return `${txid.slice(0, 8)}…${txid.slice(-6)}`; }
function eventApplied(event: CodeEvent) { return event.applied === true || event.accepted === true || event.status === "applied" || event.status === "accepted"; }
function eventReason(event: CodeEvent) { return event.reason || event.validationErrors?.join(" · ") || (eventApplied(event) ? "Confirmed main history" : "Unapplied record; inspect transaction evidence"); }
function dateText(value: CodeEvent) {
  const time = value.blockTime ?? value.timestamp;
  if (time == null) return value.blockHeight == null ? "Chain time unavailable" : `Block ${value.blockHeight.toLocaleString()}`;
  const date = new Date(typeof time === "number" ? time * 1000 : time);
  return Number.isNaN(date.getTime()) ? "Chain time unavailable" : date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function SourceText({ content }: { content: string }) {
  return <pre className="code-source" tabIndex={0} aria-label="Exact source text"><code>{content || <span className="code-empty-source">Empty source file · 0 bytes</span>}</code></pre>;
}
function CodeDiff({ before, after }: { before: string; after: string }) {
  const change = lineChange(before, after);
  return <div className="code-diff" aria-label="Source changes"><p className="code-muted">{change.unchanged ? "The source bytes are unchanged." : `Changed line span beginning at line ${change.start}. Exact removed and added text is shown below.`}</p>
    {!change.unchanged && <><div className="code-diff-heading">Removed · {change.removed.length.toLocaleString()} lines</div><pre className="code-diff-removed">{change.removed.map(line => `− ${line}`).join("\n")}</pre><div className="code-diff-heading">Added · {change.added.length.toLocaleString()} lines</div><pre className="code-diff-added">{change.added.map(line => `+ ${line}`).join("\n")}</pre></>}
    {before !== after && <p className="code-muted">Line endings and the final newline are committed exactly; use file downloads to inspect every byte.</p>}
  </div>;
}

export default function CodeRoot({ embedded = false, initialAddress = "", initialNetwork: initialNetworkProp, onOpenPages, initialViewState, onViewStateChange }: CodeRootProps = {}) {
  const [network, setNetworkState] = useState<BitcoinNetwork>(() => initialNetwork(initialNetworkProp));
  const [address, setAddress] = useState(initialAddress);
  const [hasUnisat] = useUnisatPresence();
  const [identity, setIdentity] = useState<BoostIdentityIntent>();
  const [route, setRoute] = useState(initialRoute);
  const [list, setList] = useState<CodeList>();
  const [detail, setDetail] = useState<CodeDetail>();
  const [source, setSource] = useState<Source>();
  const [readBusy, setReadBusy] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [readError, setReadError] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState(initialViewState?.filter ?? "");
  const [openRepo, setOpenRepo] = useState(initialViewState?.openRepo ?? "");
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [editor, setEditor] = useState(initialViewState?.editor === true);
  const [draft, setDraft] = useState<CodeDraft>({ ...emptyCodeDraft });
  const [draftKeyLoaded, setDraftKeyLoaded] = useState("");
  const [draftError, setDraftError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedCode>();
  const [pendingEditor, setPendingEditor] = useState<{ draft: CodeDraft; file?: Source; scope: string }>();
  const [editorPreview, setEditorPreview] = useState<"source" | "diff">(initialViewState?.editorPreview === "diff" ? "diff" : "source");
  const [baseline, setBaseline] = useState("");
  const [baselineReady, setBaselineReady] = useState(true);
  const [baselineError, setBaselineError] = useState("");
  const [pathLocked, setPathLocked] = useState(false);
  const [receipts, setReceipts] = useState<ActionReceipt[]>([]);
  const [recoveryError, setRecoveryError] = useState("");
  const [checking, setChecking] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [pageSource, setPageSource] = useState<CodePageEvidence>();
  const [pageSourceBusy, setPageSourceBusy] = useState(false);
  const pageSourceSequence = useRef(0);
  const [diffEvent, setDiffEvent] = useState<CodeEvent>();
  const [historyDiff, setHistoryDiff] = useState<{ before: string; after: string }>();
  const [diffError, setDiffError] = useState("");
  const flight = useRef(false);
  const alive = useRef(true);
  const returnFocus = useRef<HTMLElement | null>(null);
  const editorElement = useRef<HTMLElement | null>(null);
  const actionErrorElement = useRef<HTMLDivElement | null>(null);
  const readSequence = useRef(0);
  const draftKey = `proofofwork.code.draft.v1:${network}:${address || "disconnected"}`;
  const scope = JSON.stringify([address, network, identity?.id ?? "", draft]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const currentAccount = useRef({ address, network });
  currentAccount.current = { address, network };
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const draftStorage = useRef({ key: draftKey, loaded: draftKeyLoaded, error: draftError });
  draftStorage.current = { key: draftKey, loaded: draftKeyLoaded, error: draftError };
  const visibleReceipts = receipts.filter(item => item.network === network && sameCodeAddress(item.address, address, network));
  const repo = detail?.repository;
  const selectedVersion = detail ? codeVersion(detail, route.version) : "";
  const atHead = Boolean(repo && selectedVersion === repo.headTxid);
  useVerifiedDocumentMetadata({ parameter: "repo", id: repo ? codeRepoId(repo) : undefined, network,
    privateView: editor || network !== "livenet",
    metadata: repo && !readBusy && !readError && detail?.network === network &&
      codeRepoId(repo) === route.repo && (!route.version || route.version === selectedVersion)
      ? { title: `${repo.name} | ProofOfWork Code`, description: repo.description } : undefined });
  const canContinueInPages = Boolean(onOpenPages && source && repo && !readBusy && !readError && !sourceBusy && !sourceError &&
    source.network === network && source.repo === route.repo && source.version === selectedVersion && (!route.version || source.version === route.version) &&
    source.snapshot === detail?.snapshot.id && source.file.path === route.path && /\.(?:html?|xhtml)$/iu.test(source.file.path));
  const owner = Boolean(repo && sameCodeAddress(repo.ownerAddress, address, network));
  const canWrite = owner && atHead && network === "livenet" && !readBusy && !actionBusy;
  const planResult = useMemo(() => {
    try { return { plan: buildCodePlan(draft), error: "" }; }
    catch (error) { return { plan: undefined, error: errorText(error) }; }
  }, [draft]);

  useEffect(() => { onViewStateChange?.({ filter, openRepo, editor, editorPreview }); }, [filter, openRepo, editor, editorPreview, onViewStateChange]);

  function continueInPages() {
    if (!canContinueInPages || !onOpenPages || !source || !repo || !preserveDraft()) return;
    try {
      const reference: CodeSourceReference = { network, repo: codeRepoId(repo), version: selectedVersion,
        path: source.file.path, sha256: source.file.sha256, size: source.file.size };
      assertCodeSourceReference(reference, network);
      onOpenPages(reference);
    } catch (error) { setActionError(errorText(error)); }
  }

  useEffect(() => { alive.current = true; return () => { alive.current = false; readSequence.current++; }; }, []);
  useEffect(() => { setAddress(initialAddress); }, [initialAddress]);
  useEffect(() => { if (initialNetworkProp) setNetworkState(initialNetworkProp); }, [initialNetworkProp]);
  useEffect(() => { setPrepared(undefined); setIdentity(undefined); }, [address, network]);
  useEffect(() => { setPrepared(undefined); setPendingEditor(undefined); }, [scope]);
  useEffect(() => {
    if (!actionError) return;
    actionErrorElement.current?.focus({ preventScroll: true });
    actionErrorElement.current?.scrollIntoView({ block: "nearest" });
  }, [actionError]);
  useEffect(() => { pageSourceSequence.current++; setPageSource(undefined); setPageSourceBusy(false); }, [address, network, draft.sourceTxid]);
  const selectedPageSource = pageSource && pageSource.sourceTxid === draft.sourceTxid
    ? pageSource.sources.find(item => item.kind === draft.sourceKind && item.vout === draft.sourceVout && item.content === draft.content)
    : undefined;
  const referenceReady = draft.kind !== "reference" || Boolean(selectedPageSource);

  function preserveDraft() {
    if (flight.current) { setActionError("Wait for the current wallet operation before leaving the Code editor."); return false; }
    if (!editorRef.current) return true;
    const storage = draftStorage.current;
    if (storage.loaded !== storage.key || storage.error) { setActionError(storage.error || "The local draft is still loading."); return false; }
    try { persistCodeDraft(localStorage, storage.key, draftRef.current); return true; }
    catch { setDraftError("Draft autosave is unavailable. Copy your source before leaving this editor."); return false; }
  }
  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    const leave = (event: Event) => { if (!preserveDraft()) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { if (!preserveDraft()) { event.preventDefault(); event.returnValue = ""; } };
    const pop = () => { if (preserveDraft()) setRoute(initialRoute()); };
    window.addEventListener("proofofwork:code-refresh", refresh);
    window.addEventListener("proofofwork:before-code-writer-leave", leave);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", pop);
    return () => { window.removeEventListener("proofofwork:code-refresh", refresh); window.removeEventListener("proofofwork:before-code-writer-leave", leave); window.removeEventListener("beforeunload", unload); window.removeEventListener("popstate", pop); };
  }, []);
  useEffect(() => {
    let active = true;
    setIdentity(undefined);
    if (!address) return;
    void syncSocialIdentityIntent(address, network).then(value => { if (active) setIdentity(value); }).catch(() => {});
    const unsubscribe = subscribeSocialIdentityIntent(address, network, value => { if (active) setIdentity(value); });
    return () => { active = false; unsubscribe(); };
  }, [address, network]);
  useEffect(() => {
    const wallet = window.unisat;
    if (!wallet) return;
    const accounts = (...args: unknown[]) => {
      const value = Array.isArray(args[0]) ? String(args[0][0] ?? "") : "";
      setAddress(value); setPrepared(undefined); setStatus("Wallet account changed. Review Code actions again.");
    };
    const changed = () => { void getWalletNetwork(wallet).then(value => { if (value) setNetworkState(value); else setAddress(""); setPrepared(undefined); }); };
    wallet.on?.("accountsChanged", accounts); wallet.on?.("networkChanged", changed); wallet.on?.("chainChanged", changed);
    return () => { wallet.removeListener?.("accountsChanged", accounts); wallet.removeListener?.("networkChanged", changed); wallet.removeListener?.("chainChanged", changed); };
  }, [hasUnisat]);
  useEffect(() => {
    setDraftError("");
    try {
      const raw = localStorage.getItem(draftKey);
      const loaded: unknown = raw ? JSON.parse(raw) : { ...emptyCodeDraft };
      const candidate = loaded as CodeDraft;
      if (!candidate || !["repo", "put", "delete", "reference"].includes(candidate.kind) ||
        [candidate.name, candidate.description, candidate.repo, candidate.parent, candidate.path, candidate.message, candidate.content].some(value => typeof value !== "string") || !Number.isFinite(candidate.feeRate)) throw new Error("Saved Code draft is unreadable. Preserve local storage before repairing it.");
      if (candidate.kind === "reference" &&
          ((candidate.sourceTxid !== undefined && typeof candidate.sourceTxid !== "string") ||
           (candidate.sourceKind !== undefined && !["body", "attachment"].includes(candidate.sourceKind)) ||
           (candidate.sourceVout !== undefined && (!Number.isSafeInteger(candidate.sourceVout) || candidate.sourceVout < 0)))) {
        throw new Error("Saved Page reference is unreadable. Preserve local storage before repairing it.");
      }
      // The disconnected draft is retained. Connecting carries the in-progress
      // editor to the new wallet without overwriting that wallet's saved draft.
      if (editorRef.current && draftKeyLoaded.endsWith(":disconnected") && address) {
        if (raw && JSON.stringify(candidate) !== JSON.stringify(emptyCodeDraft)) {
          setStatus("Your previous wallet draft is preserved. Save or finish it before carrying the disconnected draft into this wallet.");
          setEditor(false);
          setDraft(candidate);
        }
      } else {
        setDraft(candidate);
        if (editorRef.current) {
          setBaseline(""); setBaselineReady(candidate.kind === "repo");
          setBaselineError(""); setPathLocked(candidate.kind === "delete");
        }
      }
      setDraftKeyLoaded(draftKey);
    } catch (error) { setDraftError(errorText(error)); setDraftKeyLoaded(draftKey); }
  }, [draftKey]);
  useEffect(() => {
    if (draftKeyLoaded !== draftKey || draftError) return;
    try { persistCodeDraft(localStorage, draftKey, draft); }
    catch { setDraftError("Draft autosave is unavailable. Copy your source before leaving this editor."); }
  }, [draft, draftKey, draftKeyLoaded, draftError]);
  useEffect(() => {
    try { setReceipts(readActionReceipts(localStorage).filter(item => item.key.startsWith("code:"))); setRecoveryError(""); }
    catch (error) { setRecoveryError(errorText(error)); }
  }, [address, network]);

  const navigate = useCallback((next: Route) => {
    if (!preserveDraft()) return;
    window.history.pushState({}, "", routeHref(next));
    setRoute(next); setCopied(false); setDiffEvent(undefined); setHistoryDiff(undefined); setEditor(false); setPendingEditor(undefined);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++readSequence.current;
    setReadBusy(true); setReadError(""); setDetail(undefined); setList(undefined); setSource(undefined);
    setDiffEvent(undefined); setHistoryDiff(undefined);
    const task = route.repo
      ? fetchCodeRepository(network, route.repo, { version: route.version || undefined, fresh: attempt > 0, signal: controller.signal })
      : fetchCodeRepositories(network, { fresh: attempt > 0, signal: controller.signal });
    void task.then(value => {
      if (controller.signal.aborted || sequence !== readSequence.current) return;
      if ("repository" in value) {
        setDetail(value);
        if (!route.path) {
          const readme = value.files.find(file => /(?:^|\/)readme(?:\.md|\.txt)?$/iu.test(file.path)) ?? value.files[0];
          if (readme) setRoute(current => current.repo === route.repo ? { ...current, path: readme.path } : current);
        }
      } else setList(value);
    }).catch(error => { if (!controller.signal.aborted && sequence === readSequence.current) setReadError(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted && sequence === readSequence.current) setReadBusy(false); });
    return () => controller.abort();
  }, [network, route.repo, route.version, attempt]);
  useEffect(() => {
    const controller = new AbortController();
    setSource(undefined); setSourceError(""); setSourceBusy(false);
    if (!detail || !route.path || route.tab !== "code") return;
    const expected = detail.files.find(file => file.path === route.path);
    if (!expected) { setSourceError("This path does not exist in the selected confirmed version."); return; }
    setSourceBusy(true);
    void fetchCodeRepository(network, codeRepoId(detail.repository), { snapshot: detail.snapshot.id, version: selectedVersion, path: route.path, signal: controller.signal })
      .then(value => { if (controller.signal.aborted) return; if (!value.file) throw new Error("Source is unavailable for this confirmed file."); const verified = verifiedCodeSource(value.file, expected); setSource({ file: expected, content: verified.source, bytes: verified.bytes, network, repo: codeRepoId(detail.repository), version: selectedVersion, snapshot: detail.snapshot.id }); })
      .catch(error => { if (!controller.signal.aborted) setSourceError(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted) setSourceBusy(false); });
    return () => controller.abort();
  }, [network, detail, route.path, route.tab, selectedVersion]);
  useEffect(() => {
    const controller = new AbortController();
    setHistoryDiff(undefined); setDiffError("");
    if (!diffEvent || !detail || !eventApplied(diffEvent) || !diffEvent.path || !diffEvent.op) return;
    const commit = diffEvent;
    const parent = commit.parent ?? commit.parentTxid;
    if (!parent) { setDiffError("The parent reference is unavailable."); return; }
    const params = { snapshot: detail.snapshot.id, path: commit.path, signal: controller.signal };
    void Promise.all([fetchCodeRepository(network, codeRepoId(detail.repository), { ...params, version: parent }), fetchCodeRepository(network, codeRepoId(detail.repository), { ...params, version: commit.txid })])
      .then(([before, after]) => { if (!controller.signal.aborted) setHistoryDiff({ before: before.file ? verifiedCodeSource(before.file).source : "", after: after.file ? verifiedCodeSource(after.file).source : "" }); })
      .catch(error => { if (!controller.signal.aborted) setDiffError(errorText(error)); });
    return () => controller.abort();
  }, [diffEvent, detail, network]);

  useEffect(() => {
    if (editor && draft.kind !== "repo") { setBaseline(""); setBaselineReady(false); setBaselineError(""); }
  }, [editor, draft.kind, draft.repo, draft.parent, draft.path, network]);
  useEffect(() => {
    const controller = new AbortController();
    if (!editor || baselineReady || draft.kind === "repo" || !draft.repo || !draft.parent || !draft.path) return;
    setBaselineError("");
    void fetchCodeRepository(network, draft.repo, { version: draft.parent, path: draft.path, fresh: true, signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        setBaseline(value.file ? verifiedCodeSource(value.file).source : "");
        setBaselineReady(true);
      }).catch(error => { if (!controller.signal.aborted) setBaselineError(errorText(error)); });
    return () => controller.abort();
  }, [editor, baselineReady, draft.kind, draft.repo, draft.parent, draft.path, network]);

  async function connect() {
    if (flight.current || !preserveDraft()) return;
    const wallet = window.unisat;
    if (!wallet) { setActionError("Install UniSat to create a repository or commit source."); return; }
    flight.current = true; setActionBusy(true); setActionError("");
    try {
      const accounts = wallet.requestAccounts ? await wallet.requestAccounts() : await wallet.getAccounts?.();
      if (!accounts?.[0]) throw new Error("UniSat did not return an address.");
      const verifiedAddress = await ensureWalletNetwork(wallet, network, accounts[0]);
      setAddress(verifiedAddress); setStatus(`${shortAddress(verifiedAddress)} connected. Signing stays in UniSat.`);
    } catch (error) { setActionError(errorText(error)); }
    finally { flight.current = false; setActionBusy(false); }
  }
  function changeNetwork(value: BitcoinNetwork) {
    if (flight.current || !preserveDraft()) return;
    setNetworkState(value); setPrepared(undefined); setEditor(false);
    const url = new URL(window.location.href); url.searchParams.set("network", value); window.history.replaceState(window.history.state, "", url);
  }
  function draftReady() {
    if (draftKeyLoaded !== draftKey || draftError) {
      setActionError(draftError || "The local draft is still loading.");
      return false;
    }
    return true;
  }
  function editorFocus() {
    return editorElement.current?.querySelector<HTMLElement>("input:not(:disabled), textarea:not(:disabled)") ?? null;
  }
  function openEditor(next: CodeDraft, file?: Source) {
    setActionError(""); setPrepared(undefined); setPendingEditor(undefined); setPageSource(undefined);
    setEditorPreview("source"); setBaseline(""); setBaselineReady(next.kind === "repo"); setBaselineError("");
    setPathLocked(next.kind === "delete" || Boolean(file));
    setDraft(next); setEditor(true);
    window.requestAnimationFrame(() => editorFocus()?.focus());
  }
  function resumeDraft() {
    if (flight.current || !draftReady() || !preserveDraft()) return;
    if (!pendingEditor) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openEditor(draft);
  }
  function beginEditor(kind: CodeDraft["kind"], file?: Source) {
    if (flight.current || !draftReady() || !preserveDraft()) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (kind !== "repo" && !repo) return;
    const next: CodeDraft = kind === "repo" ? { ...emptyCodeDraft, feeRate: draft.feeRate }
      : { ...emptyCodeDraft, kind, repo: codeRepoId(repo!), parent: repo!.headTxid, path: file?.file.path ?? "", content: file?.content ?? "", feeRate: draft.feeRate };
    if (hasCodeDraft(draft)) {
      if (kind !== "repo" && draft.kind === kind && draft.repo === next.repo && (!file || draft.path === next.path)) {
        openEditor(draft);
      } else {
        setPendingEditor({ draft: next, file, scope });
      }
      return;
    }
    openEditor(next, file);
  }
  function updateDraft(patch: Partial<CodeDraft>) { setDraft(value => ({ ...value, ...patch })); setActionError(""); setPrepared(undefined); }
  async function assertNoDuplicate(planKey: string, ownSignedTxid?: string) {
    if (recoveryError) throw new Error(recoveryError);
    const matching = readActionReceipts(localStorage).filter(item => item.txid !== ownSignedTxid && item.key === planKey && item.network === network && sameCodeAddress(item.address, address, network));
    const existing = matching.find(item => item.status === "unknown" || item.status === "pending");
    if (existing) throw new Error(`A signed Code transaction for this task is ${existing.status === "unknown" ? "unresolved" : "pending"}. Check Transaction recovery before creating another transaction.`);
    // Node confirmation may lead the Code index. A resolved receipt does not
    // allow a second transaction until complete Code replay has observed it.
    for (const confirmed of matching.filter(item => item.status === "confirmed")) {
      const retained = restoredCodeDraft(confirmed.fields);
      if (!retained) throw new Error("Confirmed Code recovery evidence is unreadable. Preserve it before continuing.");
      const repositoryId = retained.kind === "repo" ? confirmed.txid : retained.repo;
      let projection: CodeDetail;
      try {
        projection = await fetchCodeRepository(network, repositoryId, { fresh: true });
      } catch { throw new Error("A confirmed Code transaction is still absent from complete Code replay. Refresh before preparing another transaction for this task."); }
      if (retained.kind === "repo") continue;
      while (!codeEvents(projection).some(event => event.txid === confirmed.txid)) {
        if (!projection.pagination.hasMore || !projection.pagination.nextCursor) throw new Error("A confirmed Code commit is not yet present in complete Code replay. Refresh before preparing another commit.");
        projection = await fetchCodeRepository(network, repositoryId, { snapshot: projection.snapshot.id, version: projection.version, cursor: projection.pagination.nextCursor });
      }
    }
  }

  function retainReceipt(receipt: ActionReceipt) { setReceipts(saveActionReceipt(localStorage, receipt).filter(item => item.key.startsWith("code:"))); }
  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (flight.current || pageSourceBusy || !referenceReady || !planResult.plan || draftError || draftKeyLoaded !== draftKey) return;
    const expected = scope;
    const assertCurrent = () => { if (!alive.current || currentScope.current !== expected) throw new Error("Source, wallet, network, or identity changed. Prepare a new Code review."); };
    flight.current = true; setActionBusy(true); setActionError("");
    try {
      await assertNoDuplicate(planResult.plan.key);
      const next = await prepareCodeTransaction(planResult.plan, address, network, assertCurrent);
      await assertNoDuplicate(planResult.plan.key); assertCurrent(); setPrepared(next);
    } catch (error) { if (alive.current) setActionError(errorText(error)); }
    finally { flight.current = false; if (alive.current) setActionBusy(false); }
  }
  async function sign() {
    if (flight.current || !prepared) return;
    const reviewed = prepared;
    const expected = scope;
    const assertCurrent = () => { if (!alive.current || currentScope.current !== expected) throw new Error("Source, wallet, network, or identity changed. Prepare a new Code review."); };
    let receipt: ActionReceipt | undefined;
    flight.current = true; setActionBusy(true); setActionError("");
    try {
      await assertNoDuplicate(reviewed.plan.key); assertCurrent();
      await verifyCodeAuthority(reviewed.plan, reviewed.address, reviewed.network, assertCurrent);
      await verifyCodeFunding(reviewed); assertCurrent();
      const result = await signAndBroadcastBoostPsbt({ wallet: window.unisat!, network: reviewed.network, signingAddress: reviewed.address,
        psbtHex: reviewed.payment.psbtHex, inputCount: reviewed.payment.inputCount, signInputIndexes: reviewed.payment.walletInputIndexes,
        onSigned: txid => {
          receipt = { txid, address: reviewed.address, network: reviewed.network, title: reviewed.plan.draft.kind === "repo" ? "Create Code repository" : "Publish Code commit",
            key: reviewed.plan.key, createdAt: new Date().toISOString(), status: "unknown", fields: codeDraftFields(reviewed.plan.draft) };
          retainReceipt(receipt);
        },
        beforeBroadcast: async () => { assertCurrent(); await assertNoDuplicate(reviewed.plan.key, receipt?.txid); assertCurrent(); await verifyCodeAuthority(reviewed.plan, reviewed.address, reviewed.network, assertCurrent); await verifyCodeFunding(reviewed); assertCurrent(); },
      });
      if (receipt) retainReceipt({ ...receipt, status: "pending" });
      setPrepared(undefined); setStatus(`Transaction ${result.txid} broadcast. Your repository history updates after confirmation. The source draft is retained locally.`); setEditor(false); setAttempt(value => value + 1);
    } catch (error) {
      if (alive.current) { setPrepared(undefined); setActionError(`${errorText(error)}${receipt ? " Signed transaction evidence is retained in Transaction recovery. Check its status before retrying." : ""}`); }
    } finally { flight.current = false; if (alive.current) setActionBusy(false); }
  }
  async function checkReceipts() {
    if (checking || flight.current) return;
    const expected = { ...currentAccount.current };
    setChecking(true); setRecoveryError("");
    try {
      const current = readActionReceipts(localStorage).filter(item => item.key.startsWith("code:") && item.network === expected.network && sameCodeAddress(item.address, expected.address, expected.network));
      for (const receipt of current.filter(item => item.status === "unknown" || item.status === "pending")) {
        const value = await fetchProofApiJson<{ status?: string }>(`/api/v1/tx/${receipt.txid}/status`, receipt.network);
        if (currentAccount.current.address !== expected.address || currentAccount.current.network !== expected.network) return;
        if (!["confirmed", "pending", "dropped"].includes(value.status ?? "")) throw new Error("Transaction status is unavailable. Recovery evidence and retry protection remain active.");
        retainReceipt({ ...receipt, status: value.status as ActionReceipt["status"] });
      }
      setAttempt(value => value + 1);
    } catch (error) { setRecoveryError(errorText(error)); }
    finally { setChecking(false); }
  }
  async function loadMore() {
    if (pageBusy || readBusy) return;
    const current = detail ?? list;
    if (!current?.pagination.hasMore || !current.pagination.nextCursor) return;
    const sequence = readSequence.current;
    setPageBusy(true); setReadError("");
    try {
      if (detail) {
        const next = await fetchCodeRepository(network, codeRepoId(detail.repository), { cursor: detail.pagination.nextCursor ?? undefined, snapshot: detail.snapshot.id, version: selectedVersion });
        if (sequence !== readSequence.current) return;
        if (next.snapshot.id !== detail.snapshot.id) throw new Error("History snapshot changed. Refresh the repository.");
        setDetail({ ...next, events: [...codeEvents(detail), ...codeEvents(next)] });
      } else if (list) {
        const next = await fetchCodeRepositories(network, { cursor: list.pagination.nextCursor ?? undefined });
        if (sequence !== readSequence.current) return;
        if (next.snapshot.id !== list.snapshot.id) throw new Error("Repository list snapshot changed. Refresh the list.");
        setList({ ...next, repositories: [...list.repositories, ...next.repositories] });
      }
    } catch (error) { if (sequence === readSequence.current) setReadError(errorText(error)); }
    finally { setPageBusy(false); }
  }
  async function downloadRepository() {
    if (!detail || archiveBusy) return;
    const captured = detail;
    const version = selectedVersion;
    const sequence = readSequence.current;
    setArchiveBusy(true); setActionError("");
    try {
      const estimatedBytes = captured.files.reduce((total, file) => total + file.size + 76 + 2 * new TextEncoder().encode(file.path).length, 22);
      if (captured.files.length > 65535 || estimatedBytes > 0xffffffff) throw new Error("This repository exceeds the supported ZIP archive limits. Download individual source files.");
      const files: { path: string; bytes: Uint8Array }[] = [];
      for (let start = 0; start < captured.files.length; start += 3) {
        const group = await Promise.all(captured.files.slice(start, start + 3).map(async file => {
          const value = await fetchCodeRepository(network, codeRepoId(captured.repository), { snapshot: captured.snapshot.id, version, path: file.path });
          if (!value.file) throw new Error(`Source is unavailable for ${file.path}. No archive was downloaded.`);
          return { path: file.path, bytes: verifiedCodeSource(value.file, file).bytes };
        }));
        if (!alive.current || sequence !== readSequence.current) throw new Error("Repository selection changed. Download the selected version again.");
        files.push(...group);
      }
      downloadCodeBlob(codeRepositoryZip(files), `${captured.repository.name.replace(/[^A-Za-z0-9._-]/gu, "_") || "repository"}-${version.slice(0, 8)}.zip`);
      setStatus(`Downloaded all ${files.length.toLocaleString()} verified files at ${version}.`);
    } catch (error) { setActionError(errorText(error)); }
    finally { setArchiveBusy(false); }
  }
  function selectPageSource(item: CodePageSource) {
    updateDraft({ sourceKind: item.kind, sourceVout: item.vout, content: item.content,
      ...(draft.path ? {} : { path: "index.html" }) });
  }
  async function verifyPageSource() {
    if (flight.current || pageSourceBusy) return;
    const expected = scope;
    const sequence = ++pageSourceSequence.current;
    setPageSourceBusy(true); setPageSource(undefined); setPrepared(undefined); setActionError("");
    try {
      const result = await fetchCodePageSource(network, draft.sourceTxid ?? "");
      if (!alive.current || sequence !== pageSourceSequence.current || currentScope.current !== expected) return;
      setPageSource(result);
      const retained = result.sources.find(item => item.kind === draft.sourceKind && item.vout === draft.sourceVout);
      if (retained || result.sources.length === 1) selectPageSource(retained ?? result.sources[0]);
      else updateDraft({ sourceKind: undefined, sourceVout: undefined, content: "" });
    } catch (error) {
      if (alive.current && sequence === pageSourceSequence.current && currentScope.current === expected) setActionError(errorText(error));
    } finally {
      if (alive.current && sequence === pageSourceSequence.current) setPageSourceBusy(false);
    }
  }
  async function uploadSource(file: File | undefined) {
    if (!file || actionBusy) return;
    try {
      if (file.size > 60000) throw new Error("One source file may contain at most 60,000 bytes.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (bytes.length !== file.size || exactSourceBytes(content).length !== bytes.length) throw new Error("The file changed or is not valid UTF-8 text.");
      updateDraft({ content, ...(draft.path ? {} : { path: file.name }) });
    } catch (error) { setActionError(errorText(error)); }
  }
  const treeFiles = detail?.files ?? [];
  const listedRepositories = list?.repositories.filter(item => `${item.name} ${item.description} ${item.ownerAddress}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) ?? [];
  const recoveryWorkspaceHref = (receipt: ActionReceipt) => {
    const params = new URLSearchParams({ ...(embedded ? { folder: "code" } : {}), network: receipt.network });
    const values = Object.fromEntries(receipt.fields); if (values.Repository) params.set("repo", values.Repository);
    return `/?${params}`;
  };
  const coverage = detail ?? list;
  return <div className={`code-app${embedded ? " code-embedded-app" : ""}`}>
    {!embedded && <AppHeader title="ProofOfWork Code" subtitle="Public source. Confirmed history." address={address} network={network} hasUnisat={hasUnisat}
      busy={readBusy || actionBusy} connectWallet={() => void connect()} disconnectWallet={() => { if (preserveDraft()) setAddress(""); }}
      onNetworkChange={changeNetwork} onDomainNavigate={() => !preserveDraft()} onRefresh={() => setAttempt(value => value + 1)} onRefreshRecovery={() => void checkReceipts()} />}
    <main className="code-workspace" aria-label="ProofOfWork Code workspace">
      <div className="code-workspace-heading"><div><span className="code-eyebrow"><Code2 size={17} /> Code on ProofOfWork</span><h2>{editor ? draft.kind === "repo" ? "New repository" : draft.kind === "delete" ? "Delete a file" : draft.kind === "reference" ? "Add an existing page" : "Commit a source file" : repo ? repo.name : "Repositories"}</h2>
        <p>{editor ? draft.kind === "repo" ? "Public source. A wallet-owned main history." : draft.kind === "reference" ? "Add confirmed HTML by transaction ID. Keep its source on chain." : "One file. One reviewed transaction. Exact source bytes." : repo ? repo.description || "A public repository with verifiable source history." : "Small repositories, source files, and a main history you can verify from the chain."}</p></div>
        {!editor && <button className="primary" type="button" onClick={() => beginEditor("repo")} disabled={actionBusy || network !== "livenet"}><Plus size={17} /> New repository</button>}
        {editor && <button type="button" className="secondary" disabled={actionBusy} onClick={() => { if (preserveDraft()) { setEditor(false); setPrepared(undefined); returnFocus.current?.focus(); } }}><ArrowLeft size={16} /> Save draft and back</button>}
      </div>
      {embedded && <div className="code-embedded-account"><span>{network === "livenet" ? "Mainnet" : network === "testnet" ? "Testnet3" : "Testnet4"} · {identity ? `${identity.id}@proofofwork.me` : address ? shortAddress(address) : "Read without a wallet"}</span>{!address && <button type="button" className="secondary" onClick={() => void connect()} disabled={actionBusy}>Connect UniSat</button>}</div>}
      {status && <div className="code-notice" role="status"><Check size={17} /><span>{status}</span><button type="button" aria-label="Dismiss status" onClick={() => setStatus("")}><X size={16} /></button></div>}
      {actionError && !editor && <div ref={actionErrorElement} className="code-notice is-error" role="alert" tabIndex={-1}>{actionError}</div>}
      <ActionRecoveryPanel receipts={visibleReceipts} error={recoveryError} checking={checking} restoringDisabled={actionBusy}
        canRestore={item => Boolean(restoredCodeDraft(item.fields))} onRestore={item => { if (!preserveDraft()) return; const restored = restoredCodeDraft(item.fields); if (restored) { setDraft(restored); setBaseline(""); setBaselineReady(restored.kind === "repo"); setPathLocked(restored.kind === "delete"); setPrepared(undefined); setEditor(true); setStatus("Retained task restored. Check the confirmed main head and review before retrying."); } }}
        onCheck={() => void checkReceipts()} workspaceHref={recoveryWorkspaceHref} />
      {editor ? <section ref={editorElement} className="code-editor" aria-label="Code editor"><form onSubmit={prepare}>
        <div className="code-editor-owner"><ShieldCheck size={17} /><span>Creating wallet · {identity ? `${identity.id}@proofofwork.me` : address ? shortAddress(address) : "Connect to publish"}</span></div>
        {draft.kind === "repo" ? <div className="code-form-grid"><label>Repository name<input required maxLength={200} value={draft.name} onChange={event => updateDraft({ name: event.target.value })} disabled={actionBusy} placeholder="my-first-repository" autoComplete="off" /></label><label>Description<textarea maxLength={1000} rows={3} value={draft.description} onChange={event => updateDraft({ description: event.target.value })} disabled={actionBusy} placeholder="What does this repository contain?" /></label><p className="code-muted">Public, with one main history. The creating wallet owns this repository permanently. Names are display labels; the creation transaction is its unique address.</p></div> : <>
          <div className="code-editor-reference"><span>Repository <code>{draft.repo}</code></span><span>Parent <code>{draft.parent}</code></span></div>
          <label>Exact file path<input required value={draft.path} onChange={event => updateDraft({ path: event.target.value })} disabled={actionBusy || draft.kind === "delete" || pathLocked} placeholder={draft.kind === "reference" ? "index.html" : "src/main.ts"} autoComplete="off" /></label>
          {draft.kind === "put" && <><div className="code-editor-toolbar"><div className="code-tabs"><button type="button" aria-pressed={editorPreview === "source"} onClick={() => setEditorPreview("source")}>Source</button><button type="button" aria-pressed={editorPreview === "diff"} onClick={() => setEditorPreview("diff")}>Changes</button></div><label className="code-upload">Upload UTF-8 file<input type="file" disabled={actionBusy} onChange={event => { void uploadSource(event.target.files?.[0]); event.target.value = ""; }} /></label></div>
            {editorPreview === "source" ? <label className="code-source-label"><span className="sr-only">Source text</span><textarea className="code-source-editor" spellCheck={false} value={draft.content} onChange={event => {
              const value = event.target.value;
              const uniformCRLF = draft.content.includes("\r\n") && !/[\r\n]/u.test(draft.content.replace(/\r\n/gu, ""));
              updateDraft({ content: uniformCRLF ? value.replace(/\r\n|\r|\n/gu, "\r\n") : value });
            }} disabled={actionBusy} placeholder="Write the exact source to commit…" /></label> : baselineReady ? <CodeDiff before={baseline} after={draft.content} /> : <p className="code-notice" role={baselineError ? "alert" : "status"}>{baselineError || "Verifying source at the retained parent before showing changes…"}</p>}
            <div className={`code-byte-budget${new TextEncoder().encode(draft.content).length > 60000 ? " is-over" : ""}`}><span>{new TextEncoder().encode(draft.content).length.toLocaleString()} / 60,000 UTF-8 bytes</span><progress max={60000} value={Math.min(60000, new TextEncoder().encode(draft.content).length)} aria-label="Source byte budget" /></div>
            <p className="code-muted">Uploads retain exact bytes and newlines. An unchanged loaded file retains its exact source. Edits preserve uniform CRLF; editing mixed line endings writes the editor's LF line endings. Empty files are supported.</p>
          </>}
          {draft.kind === "reference" && <div className="code-page-reference">
            <label>Published page TXID<input value={draft.sourceTxid ?? ""} disabled={actionBusy} onChange={event => updateDraft({ sourceTxid: event.target.value.trim().toLowerCase(), sourceKind: undefined, sourceVout: undefined, content: "" })} placeholder="64 character confirmed page transaction ID" autoComplete="off" spellCheck={false} /></label>
            <button type="button" className="secondary" disabled={actionBusy || pageSourceBusy || !hexTx.test(draft.sourceTxid ?? "")} onClick={() => void verifyPageSource()}>{pageSourceBusy ? "Verifying page…" : "Verify page"}</button>
            <p className="code-muted">Choose a repository path such as index.html. The commit references the published HTML without uploading its source again. Pages up to 60,000 UTF-8 bytes are supported.</p>
            {pageSource && <><p className="code-muted">Confirmed in block {pageSource.blockHeight.toLocaleString()}. {pageSource.sources.length > 1 ? "Choose the HTML source to reference." : "Exact HTML source verified."}</p>
              {pageSource.sources.length > 1 && <label>HTML source<select value={selectedPageSource ? `${selectedPageSource.kind}:${selectedPageSource.vout}` : ""} disabled={actionBusy} onChange={event => { const item = pageSource.sources.find(value => `${value.kind}:${value.vout}` === event.target.value); if (item) selectPageSource(item); }}><option value="" disabled>Select an HTML source</option>{pageSource.sources.map(item => <option key={`${item.kind}:${item.vout}`} value={`${item.kind}:${item.vout}`}>{item.kind === "body" ? "Message body" : item.name} · output {item.vout} · {item.size.toLocaleString()} bytes</option>)}</select></label>}
              {selectedPageSource && <><div className="code-editor-reference"><span>Source SHA-256 <code>{selectedPageSource.sha256}</code></span><span>{selectedPageSource.size.toLocaleString()} UTF-8 bytes · {selectedPageSource.kind === "body" ? "HTML message body" : "HTML attachment"} · output {selectedPageSource.vout}</span></div><div className="code-tabs"><button type="button" aria-pressed={editorPreview === "source"} onClick={() => setEditorPreview("source")}>Source</button><button type="button" aria-pressed={editorPreview === "diff"} onClick={() => setEditorPreview("diff")}>Changes</button></div>{editorPreview === "source" ? <SourceText content={selectedPageSource.content} /> : baselineReady ? <CodeDiff before={baseline} after={selectedPageSource.content} /> : <p role="status">{baselineError || "Verifying the previous source…"}</p>}</>}
            </>}
            {!referenceReady && !pageSourceBusy && <p className="code-muted">Verify the page and select its source before reviewing this commit.</p>}
          </div>}
          {draft.kind === "delete" && <p className="code-notice is-warning">The next main version removes this path. Earlier source remains in confirmed history.</p>}
          <label>Commit message<input required maxLength={500} value={draft.message} onChange={event => updateDraft({ message: event.target.value })} disabled={actionBusy} placeholder={draft.kind === "delete" ? "Remove unused source" : "Describe this change"} autoComplete="off" /></label>
        </>}
        <div className="code-publish-options"><p><strong>546 proofs</strong> returned to your wallet.<br /><span className="code-muted">Only the miner fee is spent. Source is public and permanent.</span></p><FeeRateControl feeRate={draft.feeRate} setFeeRate={feeRate => updateDraft({ feeRate })} /></div>
        {draftError && <p className="code-notice is-error" role="alert">{draftError}</p>}
        {network !== "livenet" && <p className="code-notice is-warning">Code publishing uses mainnet. Switch to mainnet to prepare a transaction.</p>}
        {!planResult.plan && Boolean(draft.name || draft.description || draft.path || draft.message || draft.content) && <p className="code-muted">{planResult.error}</p>}
        {actionError && <div ref={actionErrorElement} className="code-notice is-error" role="alert" tabIndex={-1}>{actionError}</div>}
        <div className="code-editor-actions"><span className="code-muted">{draftError ? "Draft autosave unavailable" : draftKeyLoaded !== draftKey ? "Loading local draft…" : "Draft saved in this browser"}{planResult.plan ? ` · ${planResult.plan.carrierBytes.toLocaleString()} record bytes` : ""}</span>
          {!address ? <button type="button" className="primary" disabled={actionBusy} onClick={() => void connect()}>Connect to review</button> : <button type="submit" className="primary" disabled={actionBusy || pageSourceBusy || !referenceReady || !planResult.plan || Boolean(draftError) || draftKeyLoaded !== draftKey || network !== "livenet"}>{actionBusy ? <RefreshCw className="refresh-spin" size={17} /> : <GitCommitHorizontal size={17} />}{actionBusy ? "Preparing wallet action…" : draft.kind === "repo" ? "Review repository" : "Review commit"}</button>}
        </div>
      </form></section> : <>
        {route.repo && <a className="code-back" href={routeHref({ repo: "", version: "", path: "", tab: "code" })} onClick={event => followInternalLink(event, () => navigate({ repo: "", version: "", path: "", tab: "code" }))}><ArrowLeft size={16} /> All repositories</a>}
        {readBusy && <div className="code-read-state" role="status"><RefreshCw className="refresh-spin" size={20} /><div><strong>Reading confirmed Code history…</strong><p>Checking a complete checkpoint before showing repository state.</p></div></div>}
        {readError && <div className="code-read-state is-error" role="alert"><div><strong>Code evidence unavailable</strong><p>{readError}</p><button type="button" className="secondary" disabled={readBusy} onClick={() => setAttempt(value => value + 1)}>Retry confirmed read</button></div></div>}
        {!route.repo && list && <>
          <div className="code-list-tools"><label className="code-filter"><Search size={18} /><input aria-label="Filter loaded repositories" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter loaded repositories" /></label><form onSubmit={event => { event.preventDefault(); const value = openRepo.trim().toLowerCase(); if (!hexTx.test(value)) { setActionError("Enter the repository's 64-character creation transaction."); return; } navigate({ repo: value, version: "", path: "", tab: "code" }); }}><input aria-label="Repository creation transaction" value={openRepo} onChange={event => setOpenRepo(event.target.value)} placeholder="Open repository by transaction" /><button type="submit" className="secondary">Open</button></form></div>
          <div className="code-repositories">{listedRepositories.map(item => <article className="code-repository-card" key={codeRepoId(item)}><div><Code2 size={23} /><div><a className="code-repository-name" href={routeHref({ repo: codeRepoId(item), version: "", path: "", tab: "code" })} onClick={event => followInternalLink(event, () => navigate({ repo: codeRepoId(item), version: "", path: "", tab: "code" }))}>{item.name}</a><p>{item.description || "No description"}</p></div></div><span className="code-owner">{item.ownerId ? `${item.ownerId}@proofofwork.me` : shortAddress(item.ownerAddress)}</span><div className="code-repository-counts"><span>{item.fileCount.toLocaleString()} files</span><span>{item.commitCount.toLocaleString()} commits</span><code>{compactTx(codeRepoId(item))}</code></div></article>)}</div>
          {!list.repositories.length && <div className="code-empty"><Folder size={30} /><h3>No confirmed repositories yet</h3><p>Create the first public repository. It appears here when its transaction confirms.</p><button type="button" className="primary" onClick={() => beginEditor("repo")} disabled={network !== "livenet"}>Create a repository</button></div>}
          {list.repositories.length > 0 && !listedRepositories.length && <p className="code-empty">No loaded repository matches this filter.</p>}
          {list.pagination.hasMore && <button type="button" className="secondary code-load-more" disabled={pageBusy} onClick={() => void loadMore()}>{pageBusy ? "Reading more repositories…" : "Load more repositories"}</button>}
          <p className="code-muted">{list.repositories.length.toLocaleString()} repositories loaded{list.pagination.total !== undefined ? ` of ${list.pagination.total.toLocaleString()}` : ""}. Filters apply to loaded repositories.</p>
        </>}
        {draftKeyLoaded === draftKey && hasCodeDraft(draft) && (!route.repo || draft.repo === route.repo) && <div className="code-saved-draft"><span>Saved {draft.kind === "repo" ? "repository" : "source commit"} draft · {codeDraftLabel(draft)}</span><button type="button" className="secondary" onClick={resumeDraft}>Resume draft</button></div>}
        {detail && repo && <section className="code-repository" aria-label="Repository">
          <div className="code-repository-meta"><span><ShieldCheck size={16} /> Owner <code title={repo.ownerAddress}>{repo.ownerId ? `${repo.ownerId}@proofofwork.me` : shortAddress(repo.ownerAddress)}</code>{owner && <span className="code-pill">Your wallet</span>}</span><span className="code-pill">Public</span><span className="code-pill">main</span><span>{treeFiles.length.toLocaleString()} files</span><span>{repo.commitCount.toLocaleString()} commits</span></div>
          <div className="code-repository-tools"><div className="code-tabs" aria-label="Repository views"><button type="button" aria-pressed={route.tab === "code"} onClick={() => navigate({ ...route, tab: "code" })}><Code2 size={16} /> Code</button><button type="button" aria-pressed={route.tab === "history"} onClick={() => navigate({ ...route, tab: "history" })}><History size={16} /> History</button></div><div className="code-actions"><button type="button" className="secondary" onClick={() => { void navigator.clipboard.writeText(window.location.href).then(() => setCopied(true)).catch(() => setActionError("Clipboard unavailable. Copy this page's URL from the browser.")); }}><Copy size={15} /> {copied ? "Copied" : "Copy link"}</button><button type="button" className="secondary" disabled={archiveBusy} onClick={() => void downloadRepository()}><Download size={16} /> {archiveBusy ? "Verifying files…" : "Download ZIP"}</button>{canWrite && <><button type="button" className="secondary" onClick={() => beginEditor("reference")}>Add existing page</button><button type="button" className="primary" onClick={() => beginEditor("put")}><FilePlus2 size={16} /> Add file</button></>}</div></div>
          <div className="code-head"><GitCommitHorizontal size={17} /><span>{atHead ? "Confirmed main head" : "Historical confirmed version"}</span><code>{compactTx(selectedVersion)}</code><a href={explorerTxUrl(selectedVersion, network)} target="_blank" rel="noreferrer" aria-label="Inspect version transaction"><ArrowUpRight size={17} /></a>{!atHead && <a className="code-return-head" href={routeHref({ ...route, version: "" })} onClick={event => followInternalLink(event, () => navigate({ ...route, version: "" }))}>Return to main head</a>}</div>
          {route.tab === "code" ? <div className="code-browser"><aside className="code-file-tree" aria-label="Source files"><div className="code-tree-title"><Folder size={16} /> Files</div>{treeFiles.map(file => <a key={file.path} href={routeHref({ ...route, path: file.path })} className={file.path === route.path ? "is-selected" : ""} aria-current={file.path === route.path ? "page" : undefined} onClick={event => followInternalLink(event, () => navigate({ ...route, path: file.path }))}><FileCode2 size={16} /><span title={file.path}>{file.path}</span><small>{file.size.toLocaleString()} B</small></a>)}{!treeFiles.length && <p className="code-muted">No files in this version.</p>}</aside>
            <div className="code-file-panel">{!treeFiles.length ? <div className="code-empty"><FilePlus2 size={30} /><h3>Your repository starts here</h3><p>Add a README or your first source file. Each commit changes one file.</p>{canWrite && <button type="button" className="primary" onClick={() => beginEditor("put")}>Add the first file</button>}</div> : <>
              <div className="code-file-toolbar"><strong>{route.path || "Select a source file"}</strong><div>{source && <button type="button" className="secondary" onClick={() => downloadCodeBlob(new Blob([new Uint8Array(source.bytes).buffer], { type: "text/plain;charset=utf-8" }), source.file.path.split("/").pop() || "source.txt")} aria-label="Download exact source"><Download size={16} /> Download</button>}{canContinueInPages && <button type="button" className="secondary" onClick={continueInPages}>Continue in Pages <ArrowUpRight size={15} /></button>}{canWrite && source && <><button type="button" className="secondary" onClick={() => beginEditor("put", source)}>Edit</button><button type="button" className="secondary" onClick={() => beginEditor("delete", source)} aria-label="Delete source file"><Trash2 size={16} /></button></>}</div></div>
              {sourceBusy && <div className="code-file-loading" role="status">Verifying exact source bytes…</div>}{sourceError && <p className="code-notice is-error" role="alert">{sourceError}</p>}
              {source && <><div className="code-file-evidence"><span>{source.file.size.toLocaleString()} bytes · {(source.content ? source.content.split("\n").length - (source.content.endsWith("\n") ? 1 : 0) : 0).toLocaleString()} lines</span><code title={source.file.sha256}>SHA-256 {compactTx(source.file.sha256)}</code></div><SourceText content={source.content} />{source.file.sourceTxid && <div className="code-editor-reference"><span>Referenced page <code>{source.file.sourceTxid}</code><a href={explorerTxUrl(source.file.sourceTxid, network)} target="_blank" rel="noreferrer">Inspect page transaction <ArrowUpRight size={14} /></a></span><span>Repository commit <code>{source.file.txid}</code><span>{source.file.sourceKind === "body" ? "HTML message body" : "HTML attachment"} · output {source.file.sourceVout}</span></span></div>}<p className="code-source-footnote">{/(?:^|\/)readme(?:\.md|\.txt)?$/iu.test(source.file.path) ? "README shown as exact source text. " : ""}Source is inert text; HTML and scripts never execute in Code.</p></>}
            </>}</div></div> : <div className="code-history">{codeEvents(detail).map(event => <article className="code-history-entry" key={event.txid}><GitCommitHorizontal size={20} /><div><div className="code-history-title"><strong>{event.message || (event.op ? `${event.op === "reference" ? "Reference" : event.op === "put" ? "Write" : "Delete"} ${event.path}` : "Create repository")}</strong><span className={`code-pill${eventApplied(event) ? " is-confirmed" : " is-unapplied"}`}>{eventApplied(event) ? "Main history" : event.status === "pending" ? "Pending" : "Unapplied"}</span></div><p>{event.path || repo.name} · {dateText(event)}</p><p className="code-muted">{eventReason(event)}</p><div className="code-history-evidence"><code>{compactTx(event.txid)}</code>{event.parent || event.parentTxid ? <code>Parent {compactTx(event.parent ?? event.parentTxid!)}</code> : null}<a href={explorerTxUrl(event.txid, network)} target="_blank" rel="noreferrer">Inspect transaction <ArrowUpRight size={14} /></a></div><div className="code-history-actions">{eventApplied(event) && <a className="secondary" href={routeHref({ repo: codeRepoId(repo), version: event.txid, path: event.path ?? "", tab: "code" })} onClick={click => followInternalLink(click, () => navigate({ repo: codeRepoId(repo), version: event.txid, path: event.path ?? "", tab: "code" }))}>View version</a>}{event.op && <button type="button" className="secondary" onClick={() => setDiffEvent(event)}>Inspect change</button>}</div></div></article>)}{!codeEvents(detail).length && <p className="code-empty">No commit records in this history page.</p>}{detail.pagination.hasMore && <button type="button" className="secondary code-load-more" disabled={pageBusy} onClick={() => void loadMore()}>{pageBusy ? "Reading more history…" : "Load more history"}</button>}
              {diffEvent && <section className="code-history-inspector" aria-label="Commit inspection"><div className="code-file-toolbar"><strong>{diffEvent.path}</strong><button type="button" className="secondary" onClick={() => setDiffEvent(undefined)} aria-label="Close commit inspection"><X size={17} /></button></div><p>{eventReason(diffEvent)}</p><dl><dt>Commit</dt><dd><code>{diffEvent.txid}</code></dd><dt>Parent</dt><dd><code>{diffEvent.parent ?? diffEvent.parentTxid ?? "Unavailable"}</code></dd>{diffEvent.sourceTxid && <><dt>Referenced page</dt><dd><code>{diffEvent.sourceTxid}</code> · {diffEvent.sourceKind} · output {diffEvent.sourceVout}</dd></>}{diffEvent.sha256 && <><dt>Source SHA-256</dt><dd><code>{diffEvent.sha256}</code></dd></>}</dl>{diffError && <p className="code-notice is-error" role="alert">{diffError}</p>}{eventApplied(diffEvent) && !historyDiff && !diffError && <p role="status">Verifying source changes against the same snapshot…</p>}{historyDiff && <CodeDiff before={historyDiff.before} after={historyDiff.after} />}</section>}
            </div>}
          {!owner && <p className="code-source-footnote">Only the creating wallet can commit source. Wallet ownership is independent of its displayed PowID.</p>}
        </section>}
        {coverage?.pendingComplete === false && <p className="code-notice" role="status">Pending observations are incomplete. Repository state comes from the verified confirmed checkpoint.</p>}
        {coverage?.pendingEvents?.length ? <details className="code-pending-records"><summary>{coverage.pendingEvents.length.toLocaleString()} pending Code records observed</summary><p className="code-muted">Best-effort mempool visibility. These records do not change confirmed repository ownership, source, or main history.</p>{coverage.pendingEvents.map(event => <div key={event.txid}><span>{event.message || event.path || "Code repository record"}</span><a href={explorerTxUrl(event.txid, network)} target="_blank" rel="noreferrer">{compactTx(event.txid)} <ArrowUpRight size={14} /></a></div>)}</details> : null}
        {coverage && <div className="code-coverage"><ShieldCheck size={16} /><span>Confirmed state through block {coverage.indexedThroughBlock.toLocaleString()} · complete checkpoint replay</span><code title={coverage.indexedThroughBlockHash}>{compactTx(coverage.indexedThroughBlockHash)}</code><span>Pending transactions do not change main.</span></div>}
      </>}
    </main>
    {!embedded && <SocialFooter />}
    {pendingEditor && <ReviewDialog title="Keep your saved draft?" closeLabel="Keep draft" onCancel={() => setPendingEditor(undefined)} returnFocus={returnFocus.current} fallbackFocus={editorFocus}>
      <p>Your saved draft, <strong>{codeDraftLabel(draft)}</strong>, is still in this browser. Resume it, or discard it to start the selected action.</p>
      <div className="review-actions"><button className="secondary" type="button" onClick={resumeDraft}>Resume saved draft</button><button className="primary" type="button" onClick={() => {
        if (pendingEditor.scope !== currentScope.current || flight.current || !draftReady() || !preserveDraft()) return;
        openEditor(pendingEditor.draft, pendingEditor.file);
      }}>Discard draft and continue</button></div>
    </ReviewDialog>}
    {prepared && <ActionTransactionReview review={prepared.review} returnFocus={returnFocus.current} onCancel={() => { if (!flight.current) setPrepared(undefined); }} onApprove={() => void sign()} />}
  </div>;
}
export const CodeWorkspace = CodeRoot;
