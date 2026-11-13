import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { assertLinkedPublishCapability } from "../../shared/protocol/publishLinkedCapability.mjs";
import { readPublishDraft, writePublishDraft, writePublishDraftPair, removePublishDraft } from "./publishDraftStore";
import { PowcatPublisher } from "../powcat/PowcatPublisher";
import type { PublishWallet } from "../powcat/powcatPublish";
import { sha256Hex } from "../../shared/utils/encoding";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, BookOpen, Eye, PenLine, RefreshCw, Send } from "lucide-react";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { FeeRateControl } from "../../shared/components/FeeRateControl";
import { ActionTransactionReview } from "../../shared/components/ActionTransactionReview";
import { YouTubeLinkCards } from "../../shared/media/YouTubeLinkCards";
import { PUBLISH_DATA_CARRIER_LIMIT } from "../../shared/protocol/publishArticle.mjs";
import { buildPublishPlan, type PreparedPublish, type PublishPlan } from "./publishProtocol";
import type { BoostIdentityIntent } from "../boost/boostProtocol";
import "./publish.css";
import { isMobileWalletBrowser } from "../../shared/wallet/walletLinks";
import { UnisatMobileHandoff } from "../../shared/components/UnisatMobileHandoff";
import { socialFeeRateFromInput, validSocialFeeRate } from "../boost/socialFeePreference";

type Draft = { title: string; body: string; signal: number; feeRate: number; linkedFile?: {txid: string; fileHash: string} };
const emptyDraft = (feeRate: number): Draft => ({ title: "", body: "", signal: 546, feeRate: validSocialFeeRate(feeRate) ? feeRate : 1 });

export function PublishComposer({ address, network, identity, connecting = false, hasUnisat = true, onConnect, onClose, onPrepare, onSign, restoreDraft, initialFeeRate = 1, onFeeRateChange, returnLabel = "Articles", onLeaveGuardChange }: {
  address: string; network: BitcoinNetwork; identity?: BoostIdentityIntent;
  connecting?: boolean;
  hasUnisat?: boolean;
  onConnect: () => void; onClose: () => void;
  onPrepare: (plan: PublishPlan, feeRate: number) => Promise<PreparedPublish>;
  onSign: (prepared: PreparedPublish, assertCurrent: () => void) => Promise<string>;
  restoreDraft?: Draft;
  initialFeeRate?: number;
  onFeeRateChange?: (feeRate: number) => void;
  returnLabel?: "Articles" | "Mail";
  onLeaveGuardChange?: (guard?: () => boolean) => void;
}) {
  const identityId = identity?.id ?? "";
  const storageKey = `proofofwork.publish.draft.v1:${network}:${address || "disconnected"}`;
  const sharedFeeRate = useRef(initialFeeRate);
  sharedFeeRate.current = initialFeeRate;
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(initialFeeRate));
  const [feeInput, setFeeInput] = useState(() => String(emptyDraft(initialFeeRate).feeRate));
  const [loadedKey, setLoadedKey] = useState("");
  const [preview, setPreview] = useState(false);
  const [upload, setUpload] = useState<{file: File; wallet: PublishWallet; scope: string; hash: string}>();
  const [prepared, setPrepared] = useState<PreparedPublish>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  const flight = useRef(false);
  const savedDraft = useRef("");
  const completedPublicationExit = useRef("");
  const unloadedDraftExit = useRef("");
  const alive = useRef(true);
  const scope = JSON.stringify([storageKey, identity, draft, feeInput]);
  const currentScope = useRef(scope);
  currentScope.current = scope;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    unloadedDraftExit.current = "";
    setPrepared(undefined); setError(""); setSaveError(""); setLoadError(""); setDraftNotice(""); savedDraft.current = "";
    void (async () => {
      try {
        const raw = await readPublishDraft(storageKey);
        if (cancelled) return;
        let candidate = raw ? JSON.parse(raw) : emptyDraft(sharedFeeRate.current);
        if (typeof candidate.title !== "string" || typeof candidate.body !== "string" ||
            !Number.isSafeInteger(candidate.signal) || !Number.isFinite(candidate.feeRate)) throw new Error("The saved draft could not be read. Preserve browser storage before repairing it.");
        const guestKey = `proofofwork.publish.draft.v1:${network}:disconnected`;
        let displacedWalletDraft: Draft | undefined;
        if (!restoreDraft && address && loadedKey === guestKey && (draft.title.trim() || draft.body.trim())) {
          if (candidate.title.trim() || candidate.body.trim()) {
            displacedWalletDraft = candidate;
            if (!cancelled) setDraftNotice("Continuing your disconnected draft. Your previous wallet draft is preserved in the disconnected draft.");
          }
          candidate = draft;
        }
        const loaded = restoreDraft ?? candidate;
        if (cancelled) return;
        if (displacedWalletDraft) await writePublishDraftPair(guestKey, displacedWalletDraft, storageKey, loaded);
        else await writePublishDraft(storageKey, loaded);
        if (cancelled) return;
        savedDraft.current = JSON.stringify([storageKey, loaded]);
        setDraft(loaded); setFeeInput(String(loaded.feeRate)); setLoadedKey(storageKey);
      } catch (cause) {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : "The saved draft could not be read.";
        setLoadError(message); setSaveError(message);
      }
    })();
    return () => { cancelled = true; };
  }, [storageKey, restoreDraft]);
  useEffect(() => {
    if (loadedKey !== storageKey || loadError) return;
    let cancelled = false;
    const snapshot = JSON.stringify([storageKey, draft]);
    void writePublishDraft(storageKey, draft).then(() => {
      if (!cancelled) { savedDraft.current = snapshot; setSaveError(""); }
    }, () => { if (!cancelled) setSaveError("Draft autosave is unavailable. Copy your text before leaving this editor."); });
    return () => { cancelled = true; };
  }, [draft, loadedKey, storageKey, loadError]);
  useEffect(() => { setPrepared(undefined); }, [scope]);

  const budget = useMemo(() => {
    try { return { plan: buildPublishPlan(draft.title, draft.body, draft.signal, identity, draft.linkedFile), error: "" }; }
    catch (cause) { return { plan: undefined, error: cause instanceof Error ? cause.message : "Article is invalid." }; }
  }, [draft.title, draft.body, draft.signal, draft.linkedFile, identity]);
  const overBudget = Boolean(budget.plan && budget.plan.carrierBytes > PUBLISH_DATA_CARRIER_LIMIT);
  const words = draft.body.trim() ? draft.body.trim().split(/\s+/u).length : 0;
  const update = (patch: Partial<Draft>) => { setDraft(value => ({ ...value, ...patch, ...(patch.body !== undefined && patch.body !== value.body ? {linkedFile: undefined} : {}) })); setError(""); };

  async function uploadArticle() {
    if (flight.current || !budget.plan || !overBudget || network !== "livenet" || !address) return;
    const expectedScope = scope;
    flight.current = true; setBusy(true); setError("");
    try {
      assertLinkedPublishCapability(await fetchProofApiJson("/api/v1/boost?capabilities=linked-articles-v2&fresh=1", network), network);
      const bytes = new TextEncoder().encode(draft.body);
      const wallet = (await import("../../App")).powcatWallet;
      if (!alive.current || currentScope.current !== expectedScope) return;
      setUpload({file: new File([bytes], "article.txt", {type: "text/plain"}), wallet, scope: expectedScope, hash: sha256Hex(bytes)});
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Article upload unavailable."); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }

  function preserveDraftBeforeExit() {
    if (!flight.current && !loadedKey && loadError && unloadedDraftExit.current === scope) return true;
    if (flight.current || loadedKey !== storageKey) {
      setError("Wait for the current wallet or draft operation before leaving this editor.");
      return false;
    }
    if (loadError) { setSaveError(loadError); return false; }
    if (savedDraft.current !== JSON.stringify([storageKey, draft])) {
      setSaveError("Wait for the draft to finish saving before leaving, or copy your text if browser storage is unavailable.");
      return false;
    }
    return true;
  }

  useEffect(() => {
    onLeaveGuardChange?.(preserveDraftBeforeExit);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (preserveDraftBeforeExit()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      onLeaveGuardChange?.();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  });

  useEffect(() => {
    const completedSnapshot = completedPublicationExit.current;
    if (!completedSnapshot) return;
    completedPublicationExit.current = String();
    // Register the cleared draft's leave guard before requesting navigation.
    // Never carry this completion into a different wallet or draft scope.
    if (!flight.current && savedDraft.current === completedSnapshot &&
        JSON.stringify([storageKey, draft]) === completedSnapshot) onClose();
  });

  async function leaveWriter() {
    if (flight.current || loadedKey !== storageKey || loadError) { preserveDraftBeforeExit(); return; }
    const expectedScope = scope;
    flight.current = true; setBusy(true);
    try {
      await writePublishDraft(storageKey, draft);
      if (!alive.current || currentScope.current !== expectedScope) return;
      savedDraft.current = JSON.stringify([storageKey, draft]); setSaveError("");
      // The persisted snapshot is complete before the parent checks its guard.
      flight.current = false; setBusy(false); onClose();
    } catch { if (alive.current) setSaveError("Draft autosave is unavailable. Copy your text before leaving this editor."); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (flight.current || !budget.plan || overBudget || !address || network !== "livenet") return;
    const selectedFeeRate = socialFeeRateFromInput(feeInput);
    if (selectedFeeRate === undefined) {
      setError("Choose a miner fee of at least 0.1 proofs/vB with up to 8 decimal places.");
      return;
    }
    const expectedScope = scope;
    flight.current = true; setBusy(true); setError("");
    try {
      await writePublishDraft(storageKey, draft);
      if (!alive.current || currentScope.current !== expectedScope) return;
      onFeeRateChange?.(selectedFeeRate);
      const next = await onPrepare(budget.plan, selectedFeeRate);
      if (alive.current && currentScope.current === expectedScope) setPrepared(next);
    } catch (cause) {
      if (alive.current && currentScope.current === expectedScope) setError(cause instanceof Error ? cause.message : "Article could not be prepared.");
    } finally { flight.current = false; if (alive.current) setBusy(false); }
  }

  async function sign() {
    if (!prepared || flight.current) return;
    const expectedScope = scope;
    const assertCurrent = () => {
      if (!alive.current || currentScope.current !== expectedScope) throw new Error("Article, identity, wallet, or network changed. Prepare a new review.");
    };
    flight.current = true; setBusy(true); setError("");
    try {
      setPrepared(undefined);
      await onSign(prepared, assertCurrent);
      assertCurrent();
      await removePublishDraft(storageKey);
      assertCurrent();
      const cleared = emptyDraft(sharedFeeRate.current);
      savedDraft.current = JSON.stringify([storageKey, cleared]);
      completedPublicationExit.current = savedDraft.current;
      setDraft(cleared);
      setFeeInput(String(cleared.feeRate));
      flight.current = false; setBusy(false);
    } catch (cause) {
      if (alive.current) { setPrepared(undefined); setError(cause instanceof Error ? cause.message : "Article signing failed."); }
    } finally { flight.current = false; if (alive.current) setBusy(false); }
  }

  if (loadedKey !== storageKey) return <section className="publish-composer" role="status"><p>{loadError || "Loading your private article draft…"}</p>
    {loadError && <button type="button" className="secondary" onClick={() => {
      // Explicit escape only when this editor has never exposed an editable draft.
      if (flight.current || loadedKey || !loadError) { preserveDraftBeforeExit(); return; }
      unloadedDraftExit.current = scope;
      onClose();
    }}>Back without changing saved drafts</button>}</section>;

  if (prepared) return <ActionTransactionReview review={prepared.review} returnFocus={null}
    onCancel={() => { if (!flight.current) setPrepared(undefined); }} onApprove={() => void sign()} />;

  return <section className="publish-composer" aria-labelledby="publish-composer-title">
    <div className="publish-writer-head">
      <button className="secondary small" disabled={busy} onClick={leaveWriter} type="button"><ArrowLeft size={18} /> Back to {returnLabel}</button>
      <div><span>Write on ProofOfWork</span><h1 id="publish-composer-title">{preview ? "Preview your article" : "New article"}</h1></div>
    </div>
    <form onSubmit={prepare}>
      <div className="publish-editor-toolbar">
        <span>{identityId ? `${identityId}@proofofwork.me` : address ? "Your connected address" : "Connect to choose your byline"}</span>
        <button className="secondary small" type="button" onClick={() => setPreview(value => !value)}>
          {preview ? <><PenLine size={15} /> Edit</> : <><Eye size={15} /> Preview</>}
        </button>
      </div>
      {preview ? <article className="publish-reading publish-preview"><h1>{draft.title || "Untitled article"}</h1>
        <p className="publish-byline">{identityId ? `${identityId}@proofofwork.me` : "Your address"} · Draft · {Math.max(1, Math.ceil(words / 220))} min read</p>
        <div className="publish-article-body">{draft.body || "Your article text will appear here."}</div>
        <YouTubeLinkCards text={draft.body} />
      </article> : <>
        <label className="publish-title-label"><span>Title</span><input aria-label="Article title" className="publish-title-input" maxLength={140} placeholder="Give your story a title" value={draft.title} onChange={event => update({ title: event.target.value })} disabled={busy} /></label>
        <label className="publish-body-label"><span>Article</span><textarea aria-label="Article text" className="publish-body-input" placeholder="Start writing…" value={draft.body} onChange={event => update({ body: event.target.value })} disabled={busy} /></label>
      </>}
      <div className={overBudget ? "publish-budget is-over" : "publish-budget"} aria-live="polite">
        <span>{words.toLocaleString()} words</span>
        <span>{budget.plan ? `${budget.plan.carrierBytes.toLocaleString()} / ${PUBLISH_DATA_CARRIER_LIMIT.toLocaleString()} bytes` : `${PUBLISH_DATA_CARRIER_LIMIT.toLocaleString()} available bytes`}</span>
        <progress aria-label="Aggregate OP_RETURN budget" max={PUBLISH_DATA_CARRIER_LIMIT} value={budget.plan?.carrierBytes ?? 0} />
        <small>{draft.linkedFile ? "Final article reference transaction only. Confirmed file parts carry the full text." : "Inline transaction budget includes title, metadata, text and script overhead. Larger articles use linked transactions, up to 4,000,000 UTF-8 bytes."}</small>
      </div>
      {overBudget && budget.plan && <div className="publish-linked-upload"><p>Publish the article text as linked file transactions first. Each part and the linker require local signing and confirmation; then review the final article post. Miner fees apply to each transaction.</p>
        <button type="button" className="secondary" disabled={busy || !address || network !== "livenet"} onClick={() => void uploadArticle()}>Upload article text in linked parts</button></div>}
      {upload && upload.scope === scope && <PowcatPublisher key={`${network}:${address}:article:${upload.hash}`} address={address} network={network}
        defaultFeeRate={draft.feeRate} wallet={upload.wallet} initialFile={upload.file} autoOpen attachLabel="Use verified article text"
        onClose={() => setUpload(undefined)} onAttachVerified={link => {
          if (currentScope.current !== upload.scope || link.fileHash !== upload.hash) { setError("The linked file does not match this draft. Recheck the article text."); return; }
          update({linkedFile: {txid: link.txid, fileHash: link.fileHash}}); setUpload(undefined);
        }} />}
      <div className="publish-publishing-options"><label>Proof signal<input type="number" aria-label="Article proof signal" min={546} step={1} value={draft.signal} onChange={event => update({ signal: Number(event.target.value) })} disabled={busy} /></label>
        <FeeRateControl feeRate={draft.feeRate} disabled={busy} inputValue={feeInput}
          setFeeRate={value => update({ feeRate: value })} setInputValue={value => {
            if (flight.current) return;
            setFeeInput(value);
            const parsed = socialFeeRateFromInput(value);
            update({ feeRate: parsed ?? 0 });
            if (parsed !== undefined) onFeeRateChange?.(parsed);
          }} />
      </div>
      <p className="field-note">Your draft stays in this browser. Publishing makes the exact text public and permanent. Proof signal returns to your wallet; the miner fee is spent. {identityId ? "Your selected PowID is published as your shared Boost profile in this transaction." : "Your public byline uses your confirmed Boost profile or address."}</p>
      {saveError ? <p className="field-note bad" role="alert">{saveError}</p> : null}
      {draftNotice ? <p className="field-note" role="status">{draftNotice}</p> : null}
      {error || overBudget || (budget.error && draft.body) ? <p className="field-note bad" role="alert">{error || budget.error || "This text needs linked file transactions before the final article review."}</p> : null}
      {network !== "livenet" ? <p className="field-note">Article publishing uses mainnet. Switch to mainnet to prepare a review.</p> : null}
      <div className="publish-editor-actions"><button className="secondary" onClick={leaveWriter} type="button" disabled={busy}><ArrowLeft size={16} /> Save draft and back</button>
        {!address ? !hasUnisat && isMobileWalletBrowser(navigator) ? <UnisatMobileHandoff /> : <button className="primary" onClick={onConnect} type="button" disabled={connecting}>{connecting ? <RefreshCw className="refresh-spin" size={16} /> : <BookOpen size={16} />} {connecting ? "Connecting…" : "Connect to publish"}</button> : <button className="primary" type="submit" disabled={busy || connecting || !budget.plan || overBudget || network !== "livenet" || loadedKey !== storageKey}>
          {busy ? <RefreshCw className="refresh-spin" size={16} /> : <Send size={16} />} {busy ? "Preparing…" : "Review publication"}</button>}
      </div>
    </form>
  </section>;
}
