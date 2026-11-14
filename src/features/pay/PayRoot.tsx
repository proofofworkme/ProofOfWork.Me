import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, Check, Copy, Plus, ReceiptText, RefreshCw, Search, ShieldCheck, Wallet, X } from "lucide-react";
import QRCode from "qrcode";
import { AppHeader } from "../../shared/components/AppHeader";
import { followInternalLink, useVerifiedDocumentMetadata } from "../../app/documentMetadata";
import { SocialFooter } from "../../shared/components/SocialFooter";
import { FeeRateControl } from "../../shared/components/FeeRateControl";
import { ActionTransactionReview } from "../../shared/components/ActionTransactionReview";
import { ActionRecoveryPanel } from "../../shared/components/ActionRecoveryPanel";
import { WalletConnectAction } from "../../shared/components/WalletConnectAction";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { explorerTxUrl, type BitcoinNetwork } from "../../shared/bitcoin/networks";
import { useUnisatPresence } from "../../shared/wallet/useUnisatPresence";
import { useWalletConnection, type EmbeddedWalletSession } from "../../shared/wallet/useWalletConnection";
import { readActionReceipts, saveActionReceipt, type ActionReceipt } from "../../shared/wallet/actionRecovery";
import { signAndBroadcastBoostPsbt } from "../boost/boostWallet";
import { shortAddress } from "../../functions";
import { fetchPayInvoice, fetchPayInvoices, PAY_STATUSES, type Invoice, type PayAction, type PayDetail, type PayList } from "./payApi";
import { buildPayPlan, emptyPayDraft, isPayDraft, PAY_ACTION_LABELS, payDraftFields, persistPayDraft, restorePayDraft, type PayDraft } from "./payProtocol";
import { preparePayTransaction, samePayAddress, verifyPayAuthority, verifyPayFunding, type PreparedPay } from "./payWallet";
import { formatPayAmount, formatPayWorkSubatoms } from "../../shared/protocol/pay.mjs";
import "./pay.css";

export type PayRootProps = { embedded?: boolean; initialAddress?: string; initialNetwork?: BitcoinNetwork; walletSession?: EmbeddedWalletSession };
type Route = { invoice: string; mine: boolean; q: string; status: string };
const compact = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : "Pay is temporarily unavailable. Try again in a moment.";
const statusLabel = (value: string) => value === "paid" ? "Paid · confirmed" : value === "cancelled" ? "Cancelled" : "Awaiting payment";
function initialRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  return { invoice: params.get("invoice") ?? "", mine: params.get("mode") === "my", q: params.get("q") ?? "", status: PAY_STATUSES.includes(params.get("status") as Invoice["status"]) ? params.get("status")! : "" };
}
function routeHref(next: Route) {
  const url = new URL(window.location.href);
  for (const key of ["invoice", "mode", "q", "status"]) url.searchParams.delete(key);
  if (next.invoice) url.searchParams.set("invoice", next.invoice);
  if (next.mine) url.searchParams.set("mode", "my");
  if (next.q) url.searchParams.set("q", next.q);
  if (next.status) url.searchParams.set("status", next.status);
  return url.href;
}
function TxLink({ txid, network, label }: { txid: string; network: BitcoinNetwork; label?: string }) {
  return <a className="pay-tx-link" href={explorerTxUrl(txid, network)} target="_blank" rel="noreferrer" title={txid}>{label ?? compact(txid)} <ArrowUpRight size={14} /></a>;
}
function InvoiceShare({ txid, onStatus }: { txid: string; onStatus: (text: string) => void }) {
  const href = `https://pay.proofofwork.me/?invoice=${txid}`;
  const [qr, setQr] = useState("");
  useEffect(() => {
    let current = true; setQr("");
    void QRCode.toDataURL(href, { errorCorrectionLevel: "M", margin: 4, width: 256 }).then(value => { if (current) setQr(value); }).catch(() => { if (current) onStatus("The QR code could not be generated. The invoice link remains available."); });
    return () => { current = false; };
  }, [href, onStatus]);
  return <details className="pay-share"><summary>Share invoice link and QR code</summary><div>{qr && <img width={256} height={256} src={qr} alt="QR code opening this exact invoice on ProofOfWork Pay" />}<div><label>Invoice link<input value={href} readOnly onFocus={event => event.target.select()} /></label><button type="button" className="secondary" onClick={() => void navigator.clipboard.writeText(href).then(() => onStatus("Invoice link copied.")).catch(() => onStatus("Clipboard unavailable. Select and copy the invoice link."))}><Copy size={16} /> Copy link</button><p className="pay-muted">The link identifies this invoice transaction. Its confirmed terms determine the amount and receiving address.</p></div></div></details>;
}

export default function PayRoot({ embedded = false, initialAddress = "", initialNetwork, walletSession }: PayRootProps = {}) {
  const [localNetwork, setNetwork] = useState<BitcoinNetwork>(() => { const value = new URLSearchParams(window.location.search).get("network"); return initialNetwork ?? (value === "testnet" || value === "testnet4" ? value : "livenet"); });
  const [localAddress, setAddress] = useState(initialAddress);
  const network = walletSession?.network ?? localNetwork, address = walletSession?.address ?? localAddress;
  const [hasUnisat] = useUnisatPresence();
  const [route, setRoute] = useState(initialRoute), [query, setQuery] = useState(route.q);
  const [list, setList] = useState<PayList>(), [detail, setDetail] = useState<PayDetail>();
  const [attempt, setAttempt] = useState(0), [readBusy, setReadBusy] = useState(true), [pageBusy, setPageBusy] = useState(false);
  const [readError, setReadError] = useState(""), [status, setStatus] = useState("");
  const [editor, setEditor] = useState(false), [draft, setDraft] = useState<PayDraft>({ ...emptyPayDraft });
  const [loadedKey, setLoadedKey] = useState(""), [draftError, setDraftError] = useState(""), [actionError, setActionError] = useState("");
  const [transactionBusy, setActionBusy] = useState(false), [prepared, setPrepared] = useState<PreparedPay>();
  const [receipts, setReceipts] = useState<ActionReceipt[]>([]), [recoveryError, setRecoveryError] = useState(""), [checking, setChecking] = useState(false);
  const preparedWalletRevision = useRef<number>();
  const alive = useRef(true), flight = useRef(false), readSequence = useRef(0), checkFlight = useRef(false), returnFocus = useRef<HTMLElement | null>(null);
  const draftKey = `proofofwork.pay.draft.v1:${network}:${address || "disconnected"}`;
  const state = useRef({ draft, draftKey, loadedKey, draftError, editor }); state.current = { draft, draftKey, loadedKey, draftError, editor };
  const account = useRef({ address, network }); account.current = { address, network };
  const preserveDraft = useCallback(() => {
    if (flight.current) { setActionError("Wait for the current wallet operation before leaving Pay."); return false; }
    const value = state.current;
    if (!value.editor) return true;
    if (value.loadedKey !== value.draftKey || value.draftError) { setActionError(value.draftError || "Your Pay draft is still loading."); return false; }
    try { persistPayDraft(localStorage, value.draftKey, value.draft); return true; }
    catch { setDraftError("Invoice draft autosave is unavailable. Copy your fields before leaving."); return false; }
  }, []);
  const walletConnection = useWalletConnection({ address, network, embedded, session: walletSession, hasUnisat, beforeChange: preserveDraft,
    onChange: value => { setAddress(value.address); setNetwork(value.network); setPrepared(undefined); },
    onInvalidate: () => setPrepared(undefined), onStatus: setStatus, onError: setActionError });
  const actionBusy = transactionBusy || walletConnection.busy;
  const invoice = detail?.invoice;
  const scope = JSON.stringify([address, network, draft, route.invoice, invoice?.headTxid, editor]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const issuer = Boolean(invoice && samePayAddress(invoice.issuerAddress, address, network));
  const selfRecipient = Boolean(invoice && samePayAddress(invoice.recipientAddress, address, network));
  const supportedWallet = network === "livenet" && /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/u.test(address);
  const visibleReceipts = receipts.filter(item => item.network === network && samePayAddress(item.address, address, network));
  const draftPresent = draft.action !== "invoice" || Boolean(draft.title || draft.description || draft.reference || draft.recipient || draft.asset !== "proofs" || draft.proofs !== emptyPayDraft.proofs || draft.work !== emptyPayDraft.work);
  const planResult = useMemo(() => { try { return { plan: buildPayPlan(draft), error: "" }; } catch (error) { return { plan: undefined, error: errorText(error) }; } }, [draft]);
  useVerifiedDocumentMetadata({ parameter: "invoice", id: invoice?.txid, network, privateView: editor || route.mine || network !== "livenet", metadata: invoice && !readBusy && !readError && invoice.txid === route.invoice ? { title: `${invoice.title} | ProofOfWork Pay`, description: invoice.description } : undefined });
  useEffect(() => { alive.current = true; return () => { alive.current = false; readSequence.current++; }; }, []);
  useEffect(() => { setAddress(initialAddress); }, [initialAddress]);
  useEffect(() => { if (initialNetwork) setNetwork(initialNetwork); }, [initialNetwork]);
  useEffect(() => { setPrepared(undefined); }, [scope]);
  const retainReceipt = useCallback((receipt: ActionReceipt) => { setReceipts(saveActionReceipt(localStorage, receipt).filter(item => item.key.startsWith("pay:"))); }, []);
  const checkReceipts = useCallback(async () => {
    if (checkFlight.current || flight.current) return;
    checkFlight.current = true; setChecking(true); setRecoveryError("");
    const expected = { ...account.current };
    const current = () => account.current.address === expected.address && account.current.network === expected.network && alive.current;
    try {
      const unresolved = readActionReceipts(localStorage).filter(item => item.key.startsWith("pay:") && item.network === expected.network && samePayAddress(item.address, expected.address, expected.network) && ["unknown", "pending", "confirmed"].includes(item.status));
      for (let index = 0; index < unresolved.length; index += 2) {
        const results = await Promise.allSettled(unresolved.slice(index, index + 2).map(async receipt => {
          const value = await fetchProofApiJson<{ status?: string }>(`/api/v1/tx/${receipt.txid}/status`, receipt.network);
          if (!["confirmed", "pending", "dropped"].includes(value.status ?? "")) throw new Error("Transaction status is unavailable. Retry protection remains active.");
          return { ...receipt, status: value.status as ActionReceipt["status"] };
        }));
        if (!current()) return;
        let failure: unknown;
        for (const result of results) { if (result.status === "fulfilled") retainReceipt(result.value); else failure = result.reason; }
        if (failure) throw failure;
      }
      if (current()) setReceipts(readActionReceipts(localStorage).filter(item => item.key.startsWith("pay:")));
    } catch (error) { if (current()) setRecoveryError(errorText(error)); }
    finally { checkFlight.current = false; if (alive.current) setChecking(false); }
  }, [retainReceipt]);
  useEffect(() => {
    const refresh = () => { if (!flight.current) { setAttempt(value => value + 1); void checkReceipts(); } };
    const leave = (event: Event) => { if (!preserveDraft()) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { if (!preserveDraft()) { event.preventDefault(); event.returnValue = ""; } };
    const pop = () => { setPrepared(undefined); if (preserveDraft()) { setRoute(initialRoute()); setEditor(false); } };
    window.addEventListener("proofofwork:pay-refresh", refresh); window.addEventListener("proofofwork:before-pay-writer-leave", leave); window.addEventListener("beforeunload", unload); window.addEventListener("popstate", pop);
    return () => { window.removeEventListener("proofofwork:pay-refresh", refresh); window.removeEventListener("proofofwork:before-pay-writer-leave", leave); window.removeEventListener("beforeunload", unload); window.removeEventListener("popstate", pop); };
  }, [checkReceipts, preserveDraft]);
  useEffect(() => {
    setDraftError(""); setPrepared(undefined);
    try {
      const raw = localStorage.getItem(draftKey), previous = state.current;
      const carry = !raw && address && previous.editor && previous.loadedKey === `proofofwork.pay.draft.v1:${network}:disconnected`;
      if (carry) persistPayDraft(localStorage, draftKey, previous.draft);
      const value: unknown = raw ? JSON.parse(raw) : carry ? previous.draft : { ...emptyPayDraft };
      if (!isPayDraft(value)) throw new Error("Saved Pay draft is unreadable. Preserve local storage before repairing it.");
      setDraft(value); setLoadedKey(draftKey);
    } catch (error) { setLoadedKey(draftKey); setDraftError(errorText(error)); }
  }, [draftKey]);
  useEffect(() => {
    if (loadedKey !== draftKey || draftError) return;
    try { persistPayDraft(localStorage, draftKey, draft); } catch { setDraftError("Invoice draft autosave is unavailable. Copy your fields before leaving."); }
  }, [draft, draftKey, loadedKey, draftError]);
  useEffect(() => {
    try { setReceipts(readActionReceipts(localStorage).filter(item => item.key.startsWith("pay:"))); setRecoveryError(""); } catch (error) { setRecoveryError(errorText(error)); }
    void checkReceipts();
  }, [address, network, checkReceipts]);
  const navigate = useCallback((next: Route) => {
    if (!preserveDraft()) return;
    window.history.pushState({}, "", routeHref(next)); setRoute(next); setQuery(next.q); setEditor(false); setPrepared(undefined); setActionError("");
  }, [preserveDraft]);
  useEffect(() => {
    const controller = new AbortController(), sequence = ++readSequence.current;
    setReadBusy(true); setReadError(""); setDetail(undefined); setList(undefined);
    if (route.mine && !address && !route.invoice) { setReadBusy(false); return () => controller.abort(); }
    const task = route.invoice ? fetchPayInvoice(network, route.invoice, { fresh: attempt > 0, signal: controller.signal }) : fetchPayInvoices(network, { q: route.q, status: route.status, address: route.mine ? address : undefined, fresh: attempt > 0, signal: controller.signal });
    void task.then(value => { if (!controller.signal.aborted && sequence === readSequence.current) { if ("invoice" in value) setDetail(value); else setList(value); } })
      .catch(error => { if (!controller.signal.aborted && sequence === readSequence.current) setReadError(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted && sequence === readSequence.current) setReadBusy(false); });
    return () => controller.abort();
  }, [network, route.invoice, route.mine, route.q, route.status, route.mine ? address : "", attempt]);
  const connect = walletConnection.connect;
  function changeNetwork(value: BitcoinNetwork) {
    if (flight.current || !preserveDraft()) return;
    walletConnection.invalidate(); setNetwork(value); setPrepared(undefined); setEditor(false);
    const url = new URL(window.location.href); url.searchParams.set("network", value); window.history.replaceState(window.history.state, "", url);
  }
  function begin(action: PayAction) {
    if (flight.current || !preserveDraft() || (action !== "invoice" && (!invoice || readBusy || readError))) return;
    if (draftPresent) { setActionError("A saved Pay draft already exists. Resume it or discard it before starting another action."); return; }
    const amount = action === "pay" ? invoice?.amount : undefined;
    setDraft({ ...emptyPayDraft, action, feeRate: draft.feeRate, recipient: action === "invoice" ? address : invoice?.recipientAddress ?? "", title: action === "invoice" ? "" : invoice?.title ?? "", invoice: action === "invoice" ? "" : invoice?.txid ?? "", expectedHead: action === "invoice" ? "" : invoice?.headTxid ?? "", asset: amount?.asset ?? "proofs", proofs: amount?.asset === "proofs" ? amount.amountSats : "546", work: amount?.asset === "WORK" ? formatPayWorkSubatoms(amount.amountSubatoms) : "1" });
    setActionError(""); setPrepared(undefined); setEditor(true);
  }
  function discardDraft() {
    if (!preserveDraft() || !window.confirm("Discard this local Pay draft? Published records and transaction recovery will remain.")) return;
    const next = { ...emptyPayDraft, feeRate: draft.feeRate };
    try { persistPayDraft(localStorage, draftKey, next); setDraft(next); setPrepared(undefined); setEditor(false); setActionError(""); } catch (error) { setDraftError(errorText(error)); }
  }
  function updateDraft(patch: Partial<PayDraft>) { setDraft(value => ({ ...value, ...patch })); setActionError(""); setPrepared(undefined); }
  async function noDuplicate(key: string, ownTxid?: string) {
    const current = account.current;
    if (recoveryError) throw new Error(recoveryError);
    const matching = readActionReceipts(localStorage).filter(item => item.txid !== ownTxid && item.key === key && item.network === current.network && samePayAddress(item.address, current.address, current.network));
    if (matching.some(item => ["unknown", "pending"].includes(item.status))) throw new Error("A signed Pay transaction for this task is unresolved or pending. Check Transaction recovery before trying again.");
    for (const receipt of matching.filter(item => item.status === "confirmed")) {
      const retained = restorePayDraft(receipt.fields);
      if (!retained) throw new Error("Confirmed Pay recovery evidence is unreadable. Preserve it before continuing.");
      const projection = await fetchPayInvoice(current.network, retained.action === "invoice" ? receipt.txid : retained.invoice, { fresh: true });
      if (!projection.events.some(item => item.txid === receipt.txid)) throw new Error("Your confirmed transaction is absent from complete Pay replay. Refresh before trying again.");
      if (retained.action === "invoice") throw new Error("This exact invoice was already published. Open its confirmed invoice instead.");
    }
  }
  async function prepare(event: FormEvent) {
    event.preventDefault(); if (flight.current || !planResult.plan || draftError || loadedKey !== draftKey) return;
    const expected = scope, plan = planResult.plan, revision = walletConnection.getRevision();
    const assertCurrent = () => { if (!alive.current || currentScope.current !== expected || walletConnection.getRevision() !== revision) throw new Error("Invoice fields, wallet or confirmed terms changed. Prepare a new review."); };
    flight.current = true; setActionBusy(true); setActionError("");
    try { await noDuplicate(plan.key); const value = await preparePayTransaction(plan, address, network, assertCurrent); await noDuplicate(plan.key); assertCurrent(); returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; preparedWalletRevision.current = revision; setPrepared(value); }
    catch (error) { if (alive.current) setActionError(errorText(error)); } finally { flight.current = false; if (alive.current) setActionBusy(false); }
  }
  async function sign() {
    if (flight.current || !prepared) return;
    const reviewed = prepared, expected = scope, revision = preparedWalletRevision.current;
    const assertCurrent = () => { if (!alive.current || currentScope.current !== expected || walletConnection.getRevision() !== revision) throw new Error("Invoice fields, wallet or confirmed terms changed. Prepare a new review."); };
    let receipt: ActionReceipt | undefined;
    flight.current = true; setActionBusy(true); setActionError("");
    try {
      await noDuplicate(reviewed.plan.key); assertCurrent(); await verifyPayAuthority(reviewed.plan, reviewed.address, reviewed.network, assertCurrent); await verifyPayFunding(reviewed); assertCurrent();
      const result = await signAndBroadcastBoostPsbt({ wallet: window.unisat!, network: reviewed.network, signingAddress: reviewed.address, psbtHex: reviewed.payment.psbtHex, inputCount: reviewed.payment.inputCount, signInputIndexes: reviewed.payment.walletInputIndexes, requireP2pkhAllInputs: true,
        onSigned: txid => { const signed: ActionReceipt = { txid, address: reviewed.address, network: reviewed.network, title: PAY_ACTION_LABELS[reviewed.plan.draft.action], key: reviewed.plan.key, createdAt: new Date().toISOString(), status: "unknown", fields: [...payDraftFields(reviewed.plan.draft), ...(reviewed.amount ? [["Pay reviewed amount", JSON.stringify(reviewed.amount)] as [string, string]] : [])] }; retainReceipt(signed); receipt = signed; },
        beforeBroadcast: async () => { assertCurrent(); await noDuplicate(reviewed.plan.key, receipt?.txid); assertCurrent(); await verifyPayAuthority(reviewed.plan, reviewed.address, reviewed.network, assertCurrent, receipt?.txid); await verifyPayFunding(reviewed, receipt?.txid); assertCurrent(); } });
      if (receipt) retainReceipt({ ...receipt, status: "pending" });
      setPrepared(undefined); setStatus(`Transaction ${result.txid} broadcast. Pay updates after confirmed replay. Your draft remains saved.`); setEditor(false); setAttempt(value => value + 1);
    } catch (error) { if (alive.current) { setPrepared(undefined); setActionError(`${errorText(error)}${receipt ? " Signed evidence remains in Transaction recovery. Check its status before retrying." : ""}`); } }
    finally { flight.current = false; if (alive.current) setActionBusy(false); }
  }
  async function loadMore() {
    if (!list || pageBusy || readBusy || !list.pagination.nextCursor) return;
    const captured = list, sequence = readSequence.current; setPageBusy(true);
    try {
      const next = await fetchPayInvoices(network, { q: route.q, status: route.status, address: route.mine ? address : undefined, cursor: captured.pagination.nextCursor!, snapshot: captured.snapshot.id });
      if (!alive.current || sequence !== readSequence.current) return;
      const invoices = [...captured.invoices, ...next.invoices];
      if (new Set(invoices.map(item => item.txid)).size !== invoices.length) throw new Error("Invoice pagination repeated records. Refresh the list.");
      setList({ ...next, invoices });
    } catch (error) { if (alive.current && sequence === readSequence.current) setReadError(errorText(error)); }
    finally { if (alive.current && sequence === readSequence.current) setPageBusy(false); }
  }
  function restore(receipt: ActionReceipt) {
    if (!preserveDraft()) return;
    const value = restorePayDraft(receipt.fields); if (!value) return;
    if (draftPresent && !window.confirm("Replace the current local draft with this retained task? Transaction recovery will remain.")) return;
    if (value.invoice) navigate({ ...route, invoice: value.invoice });
    setDraft(value); setEditor(true); setPrepared(undefined); setStatus("Retained task restored for inspection. Nothing was submitted.");
  }
  const evidence = detail ?? list;
  const canWrite = Boolean(evidence?.activation.ready && evidence.admission.ready && evidence.admission.writesEnabled);
  const actionDisabled = actionBusy || readBusy || Boolean(readError) || !supportedWallet || !canWrite;
  return <div className={`pay-app${embedded ? " pay-embedded-app" : ""}`}>
    {!embedded && <AppHeader title="ProofOfWork Pay" subtitle="Request. Pay. Verify." address={address} network={network} hasUnisat={hasUnisat} busy={actionBusy} connectWallet={() => void connect()} disconnectWallet={() => void walletConnection.disconnect()} onNetworkChange={changeNetwork} onDomainNavigate={() => !preserveDraft()} onRefresh={() => setAttempt(value => value + 1)} onRefreshRecovery={() => void checkReceipts()} />}
    <main className="pay-workspace" id={embedded ? "pay-workspace" : "main-content"}>
      <div className="pay-heading"><div><span className="pay-eyebrow"><ReceiptText size={18} /> Pay</span><h1>{editor ? PAY_ACTION_LABELS[draft.action] : "Payment, with a record."}</h1><p>On-chain invoices and confirmed receipts in proofs or WORK.</p></div>{!editor && <button className="primary" type="button" onClick={() => begin("invoice")} disabled={actionBusy || network !== "livenet"}><Plus size={16} /> New invoice</button>}</div>
      {embedded && <div className="pay-account"><span>{address ? `Connected · ${shortAddress(address)}` : "Read invoices without a wallet"}</span><div>{!address && <WalletConnectAction hasUnisat={hasUnisat} busy={actionBusy} onConnect={connect} />}<button className="secondary" type="button" onClick={() => { setAttempt(value => value + 1); void checkReceipts(); }} disabled={readBusy || actionBusy}><RefreshCw size={15} /> Refresh</button></div></div>}
      <ActionRecoveryPanel receipts={visibleReceipts} error={recoveryError} checking={checking} restoringDisabled={actionBusy} canRestore={item => Boolean(restorePayDraft(item.fields))} onRestore={restore} onCheck={() => void checkReceipts()} workspaceHref={item => { const retained = restorePayDraft(item.fields); const id = retained?.action === "invoice" ? item.txid : retained?.invoice; return `/?${new URLSearchParams({ ...(embedded ? { folder: "pay" } : { pay: "1" }), network: item.network, ...(id ? { invoice: id } : {}) })}`; }} />
      {status && <div className="pay-notice" role="status"><Check size={17} /><span>{status}</span><button type="button" onClick={() => setStatus("")} aria-label="Dismiss status"><X size={15} /></button></div>}
      {actionError && <p className="pay-notice is-error" role="alert">{actionError}</p>}
      {network !== "livenet" && <p className="pay-notice">Pay v1 uses Mainnet. Choose Mainnet to read or publish invoices.</p>}
      {address && !supportedWallet && <p className="pay-notice">Pay v1 signing requires a mainnet P2PKH UniSat address beginning with 1. Receiving addresses can use other supported mainnet formats.</p>}
      {evidence && !canWrite && <p className="pay-notice" role="status">{evidence.admission.reason || "Invoice history is readable. New transactions are unavailable until Pay admission is verified."}</p>}
      {draftPresent && !editor && <div className="pay-saved-draft"><span>Saved local draft · {PAY_ACTION_LABELS[draft.action]}</span><div><button className="secondary" type="button" onClick={() => { if (preserveDraft()) setEditor(true); }} disabled={actionBusy}>Resume draft</button><button className="secondary" type="button" onClick={discardDraft} disabled={actionBusy || Boolean(draftError)}>Discard draft</button></div></div>}
      {editor ? <section className="pay-editor" aria-label="Invoice action editor"><button className="pay-back" type="button" disabled={actionBusy} onClick={() => { if (preserveDraft()) { setEditor(false); setPrepared(undefined); } }}><ArrowLeft size={16} /> Save draft and back</button><p className="pay-muted">Drafts stay in this browser. Signing publishes a public, permanent record. Keep private customer information outside it.</p><form onSubmit={event => void prepare(event)} aria-busy={actionBusy}>
        {draft.action === "invoice" ? <><label>Invoice title<input value={draft.title} onChange={event => updateDraft({ title: event.target.value })} disabled={actionBusy} placeholder="Website design" required /><small>Up to 200 UTF-8 bytes.</small></label><label>Public description<textarea value={draft.description} onChange={event => updateDraft({ description: event.target.value })} rows={5} disabled={actionBusy} placeholder="Describe the work or purpose of this payment." required /></label><label>Fixed receiving address<input className="pay-mono" value={draft.recipient} onChange={event => updateDraft({ recipient: event.target.value })} disabled={actionBusy} placeholder="Mainnet receiving address" required autoComplete="off" /><small>This exact address remains fixed for the invoice.</small></label><div className="pay-form-grid"><label>Currency<select value={draft.asset} onChange={event => updateDraft({ asset: event.target.value as "proofs" | "WORK" })} disabled={actionBusy}><option value="proofs">Proofs</option><option value="WORK">WORK credit</option></select></label><label>Exact amount<input value={draft.asset === "WORK" ? draft.work : draft.proofs} onChange={event => updateDraft(draft.asset === "WORK" ? { work: event.target.value } : { proofs: event.target.value })} inputMode={draft.asset === "WORK" ? "decimal" : "numeric"} disabled={actionBusy} required /><small>{draft.asset === "WORK" ? "Up to 16 decimal places. Fees are separate." : "Whole proofs, at least 546. Miner fee is separate."}</small></label></div><label>Work reference <span className="pay-muted">optional</span><input className="pay-mono" value={draft.reference} onChange={event => updateDraft({ reference: event.target.value })} disabled={actionBusy} placeholder="Confirmed transaction ID" autoComplete="off" /><small>Reference an existing File, Page, Job or other confirmed transaction.</small></label></> : <><dl className="pay-facts"><div><dt>Invoice transaction</dt><dd><code>{draft.invoice}</code></dd></div><div><dt>Reviewed confirmed head</dt><dd><code>{draft.expectedHead}</code></dd></div></dl>{draft.action === "pay" ? <div className="pay-payment-summary"><ReceiptText size={24} /><div><h2>{invoice ? formatPayAmount(invoice.amount) : "Verify the invoice before payment"}</h2><p>Paid directly to the invoice's fixed recipient.</p><code className="pay-exact">{invoice?.recipientAddress || draft.recipient}</code></div></div> : <label>Public cancellation reason<textarea value={draft.reason} onChange={event => updateDraft({ reason: event.target.value })} rows={4} disabled={actionBusy} required /></label>}</>}
        <div className="pay-costs"><FeeRateControl feeRate={draft.feeRate} setFeeRate={value => updateDraft({ feeRate: value })} /><p className="pay-muted">{draft.action === "pay" ? draft.asset === "WORK" ? "Exact WORK amount plus a separate 546-proof Mail signal, 546-proof WORK registry fee and miner fee." : "Exact invoice amount plus miner fee." : "546 proofs return to your wallet as ordinary Mail signal. The miner fee is spent. Pay adds no registry fee."}</p></div>
        {draftError && <p className="pay-notice is-error" role="alert">{draftError}</p>}{planResult.error && <p className="pay-muted" role="status">{planResult.error}</p>}
        <div className="pay-actions"><button className="secondary" type="button" onClick={() => { if (preserveDraft()) setEditor(false); }} disabled={actionBusy}>Save draft and back</button>{address ? <button className="primary" type="submit" disabled={actionBusy || !supportedWallet || !planResult.plan || Boolean(draftError) || loadedKey !== draftKey}><ShieldCheck size={16} />{actionBusy ? "Preparing…" : "Review transaction"}</button> : <WalletConnectAction hasUnisat={hasUnisat} busy={actionBusy} onConnect={connect} className="primary" label="Connect to review" />}</div>
      </form></section> : <>
        {route.invoice ? <a className="pay-back" href={routeHref({ ...route, invoice: "" })} onClick={event => followInternalLink(event, () => navigate({ ...route, invoice: "" }))}><ArrowLeft size={16} /> Back to invoices</a> : <><div className="pay-tools"><div className="pay-tabs"><button type="button" aria-pressed={!route.mine} onClick={() => navigate({ ...route, mine: false })}>Public invoices</button><button type="button" aria-pressed={route.mine} onClick={() => navigate({ ...route, mine: true })}>My invoices</button></div><label className="pay-filter">Status<select value={route.status} onChange={event => navigate({ ...route, status: event.target.value })}><option value="">All statuses</option>{PAY_STATUSES.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label></div><form className="pay-search" onSubmit={event => { event.preventDefault(); navigate({ ...route, q: query.trim() }); }}><label><Search size={18} /><span className="sr-only">Search invoices</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search title, address or transaction" /></label><button className="secondary" type="submit">Search</button></form></>}
        {readBusy ? <div className="pay-read-state" role="status"><RefreshCw className="refresh-spin" size={24} /><div><strong>Verifying invoice history…</strong><p>Checking complete records at one chain checkpoint.</p></div></div> : readError ? <div className="pay-read-state is-error" role="alert"><ShieldCheck size={24} /><div><strong>Pay evidence unavailable</strong><p>{readError}</p><button className="secondary" type="button" onClick={() => setAttempt(value => value + 1)}>Retry verified read</button></div></div> : route.mine && !address && !route.invoice ? <div className="pay-empty"><Wallet size={28} /><h2>Your invoices and payments</h2><p>Connect to inspect invoices you issued, received or paid.</p><WalletConnectAction hasUnisat={hasUnisat} busy={actionBusy} onConnect={connect} className="primary" /></div> : list ? <>{list.invoices.length ? <div className="pay-list">{list.invoices.map(item => <article className="pay-card" key={item.txid}><div><span className={`pay-badge is-${item.status}`}>{statusLabel(item.status)}</span><a className="pay-card-title" href={routeHref({ ...route, invoice: item.txid })} onClick={event => followInternalLink(event, () => navigate({ ...route, invoice: item.txid }))}>{item.title}</a><p>{item.description}</p><span className="pay-muted" title={item.issuerAddress}>Issued by {shortAddress(item.issuerAddress)}</span></div><div className="pay-card-amount"><strong>{formatPayAmount(item.amount)}</strong><a href={routeHref({ ...route, invoice: item.txid })} onClick={event => followInternalLink(event, () => navigate({ ...route, invoice: item.txid }))}>View invoice <ArrowUpRight size={15} /></a></div></article>)}</div> : <div className="pay-empty"><ReceiptText size={30} /><h2>{route.q || route.status || route.mine ? "No matching confirmed invoices" : "Your next payment starts here."}</h2><p>{route.q || route.status || route.mine ? "No invoices match these filters at the verified checkpoint." : "Publish an invoice, share its link, and keep a receipt tied to the payment."}</p><button className="primary" type="button" onClick={() => begin("invoice")} disabled={actionBusy}>Create an invoice</button></div>}{list.pagination.hasMore && <button className="secondary pay-load-more" type="button" disabled={pageBusy} onClick={() => void loadMore()}>{pageBusy ? "Loading verified invoices…" : "Load more invoices"}</button>}</> : invoice && detail ? <section className="pay-invoice"><div className="pay-invoice-top"><span className={`pay-badge is-${invoice.status}`}>{statusLabel(invoice.status)}</span><span className="pay-muted">Confirmed at block {invoice.blockHeight.toLocaleString()}</span></div><h2>{invoice.title}</h2><div className="pay-invoice-amount">{formatPayAmount(invoice.amount)}</div><p className="pay-prose">{invoice.description}</p><dl className="pay-facts"><div><dt>Issued by</dt><dd><code>{invoice.issuerAddress}</code></dd></div><div><dt>Fixed receiving address</dt><dd><code>{invoice.recipientAddress}</code></dd></div><div><dt>Invoice transaction</dt><dd><code>{invoice.txid}</code><TxLink txid={invoice.txid} network={network} label="Inspect invoice" /></dd></div>{invoice.reference && <div><dt>Work reference</dt><dd><code>{invoice.reference}</code><TxLink txid={invoice.reference} network={network} label="Inspect referenced transaction" /></dd></div>}</dl>
          <div className="pay-actions">{invoice.status === "open" && !address && <WalletConnectAction hasUnisat={hasUnisat} busy={actionBusy} onConnect={connect} className="primary" label="Connect to pay" />}{invoice.status === "open" && address && !selfRecipient && <button className="primary" type="button" onClick={() => begin("pay")} disabled={actionDisabled}>Review payment</button>}{invoice.status === "open" && issuer && <button className="secondary" type="button" onClick={() => begin("cancel")} disabled={actionDisabled}>Cancel invoice</button>}</div>{invoice.status === "open" && selfRecipient && <p className="pay-muted">This is your receiving address. Share the invoice with the payer; self-payments cannot settle it.</p>}
          {invoice.status === "paid" && <section className="pay-receipt" aria-label="Confirmed payment receipt"><div className="pay-receipt-title"><ShieldCheck size={22} /><h3>Confirmed payment receipt</h3></div><p>{formatPayAmount(invoice.paidAmount!)} paid to the fixed recipient.</p><dl className="pay-facts"><div><dt>Paid by</dt><dd><code>{invoice.payerAddress}</code></dd></div><div><dt>Payment transaction</dt><dd><code>{invoice.paymentTxid}</code><TxLink txid={invoice.paymentTxid} network={network} label="Inspect settlement" /></dd></div></dl><button className="secondary" type="button" onClick={() => void navigator.clipboard.writeText(JSON.stringify(detail.receipt, null, 2)).then(() => setStatus("Verified receipt JSON copied.")).catch(() => setStatus("Clipboard unavailable. Exact receipt data remains below."))}><Copy size={16} /> Copy receipt JSON</button><details><summary>Inspect exact receipt</summary><pre tabIndex={0}>{JSON.stringify(detail.receipt, null, 2)}</pre></details><p className="pay-muted">This proves the recorded settlement. It does not certify the quality or delivery of goods.</p></section>}
          <InvoiceShare txid={invoice.txid} onStatus={setStatus} />
          {detail.pendingEvents.length > 0 && <details className="pay-history" open><summary>Pending visibility ({detail.pendingEvents.length})</summary><p className="pay-muted">Pending records do not change invoice status or establish payment.</p>{detail.pendingEvents.map(event => <div key={event.txid}><strong>{event.action === "invalid" ? "Unverified Pay record" : PAY_ACTION_LABELS[event.action]}</strong><TxLink txid={event.txid} network={network} /></div>)}</details>}
          <details className="pay-history"><summary>Complete confirmed history ({detail.events.length})</summary>{detail.events.map(event => <article key={event.txid}><div><strong>{event.action === "invalid" ? "Malformed record" : PAY_ACTION_LABELS[event.action]}</strong><span>{event.valid && event.applied ? "Applied" : "Unapplied evidence"}</span><TxLink txid={event.txid} network={network} /></div><code className="pay-exact">{event.authorAddress}</code>{event.validationErrors.length > 0 && <p>{event.validationErrors.join(" · ")}</p>}<details><summary>Exact record</summary><pre tabIndex={0}>{JSON.stringify(event.metadata, null, 2)}</pre></details></article>)}</details>
        </section> : null}
        {evidence && <div className="pay-coverage"><ShieldCheck size={16} /><span>Complete confirmed replay through block {evidence.indexedThroughBlock.toLocaleString()}</span><code title={evidence.indexedThroughBlockHash}>{compact(evidence.indexedThroughBlockHash)}</code></div>}
      </>}
      <p className="pay-product-note">Payments go directly to the fixed recipient. Signing stays in your wallet. Pending transactions remain separate from confirmed receipts.</p>
    </main>{!embedded && <SocialFooter />}
    {prepared && <ActionTransactionReview review={prepared.review} returnFocus={returnFocus.current} onCancel={() => { if (!flight.current) setPrepared(undefined); }} onApprove={() => void sign()} />}
  </div>;
}
