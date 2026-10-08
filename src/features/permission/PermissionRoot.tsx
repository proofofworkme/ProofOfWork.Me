import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, Check, Copy, FileKey2, KeyRound, LockKeyhole, Plus, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { AppHeader } from "../../shared/components/AppHeader";
import { ActionTransactionReview } from "../../shared/components/ActionTransactionReview";
import { ActionRecoveryPanel } from "../../shared/components/ActionRecoveryPanel";
import { FeeRateControl } from "../../shared/components/FeeRateControl";
import { SocialFooter } from "../../shared/components/SocialFooter";
import { explorerTxUrl, type BitcoinNetwork } from "../../shared/bitcoin/networks";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { useUnisatPresence } from "../../shared/wallet/useUnisatPresence";
import { readActionReceipts, saveActionReceipt, type ActionReceipt } from "../../shared/wallet/actionRecovery";
import { assertMainnetP2pkhWallet, ensureWalletNetwork, getWalletNetwork, signAndBroadcastBoostPsbt } from "../boost/boostWallet";
import { shortAddress } from "../../functions";
import { PERMISSION_ACTIONS, permissionPolicyEnv } from "../../shared/protocol/permissions.mjs";
import { fetchPermission, fetchPermissionInspection, fetchPermissions, hasVerifiedPermissionHistory, permissionPublicationReady, permissionCheckpoint, PERMISSION_TXID, type PermissionDetail, type PermissionInspection, type PermissionList, type PermissionRecord } from "./permissionApi";
import { buildPermissionPlan, emptyPermissionDraft, isPermissionDraft, permissionDraftFields, permissionDraftFromPolicy, permissionDraftWithFeeRate, permissionDraftWithRecoveryKey, persistPermissionDraft, restorePermissionDraft, PERMISSION_ACTION_LABELS, type PermissionDraft } from "./permissionProtocol";
import { preparePermissionTransaction, samePermissionAddress, verifyPermissionAuthority, verifyPermissionFunding, type PreparedPermission } from "./permissionWallet";
import "./permission.css";

export type PermissionRootProps = { embedded?: boolean; initialAddress?: string; initialNetwork?: BitcoinNetwork };
function routePermission() { return new URLSearchParams(window.location.search).get("permission") ?? ""; }
function routeNetwork(fallback?: BitcoinNetwork): BitcoinNetwork {
  const value = new URLSearchParams(window.location.search).get("network");
  return value === "livenet" || value === "testnet" || value === "testnet4" ? value : fallback ?? "livenet";
}
function errorText(error: unknown) { return error instanceof Error ? error.message : "Permission is temporarily unavailable. Try again in a moment."; }
function compactTx(value: string) { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
function permissionName(record: PermissionRecord) { return record.label || "Permission grant"; }
function PermissionCard({ record, onOpen }: { record: PermissionRecord; onOpen: () => void }) {
  return <article className="permission-card"><div className="permission-card-top"><button type="button" onClick={onOpen}>{permissionName(record)}</button><span className={`permission-pill${record.status === "active" ? " is-active" : ""}`}>{record.status}</span></div>
    <p>Wallet · {record.walletAddress}</p><div className="permission-actions-list">{record.policy.allowedActions.map(action => <code key={action}>{action}</code>)}</div>
    <div className="permission-card-limits"><span><strong>{BigInt(record.policy.maxTransactionProofs).toLocaleString()}</strong> proofs / transaction</span><span><strong>{BigInt(record.policy.dailyLimitProofs).toLocaleString()}</strong> proofs / day</span><code>{compactTx(record.txid)}</code></div></article>;
}
function RawPermissionRecord({ inspection, network }: { inspection: PermissionInspection; network: BitcoinNetwork }) {
  const record = inspection.record;
  return <section className="permission-detail" aria-label="Raw permission inspection"><div className="permission-detail-head"><strong>{record.metadata.label || (record.action === "revoke" ? "Revocation record" : "Permission record")}</strong><span className="permission-pill">Current status unverified</span></div>
    <div className="permission-notice" role="status">This confirmed record is inspectable, but complete current permission history is unavailable. It cannot authorize execution or lifecycle changes.</div>
    <div className="permission-detail-body"><dl className="permission-facts"><div><dt>Record wallet authority</dt><dd>{inspection.authorityVerified ? "Verified input-authorizing wallet" : "Record failed authority or protocol validation"}<br /><code>{record.walletAddress || "Unavailable"}</code></dd></div><div><dt>Transaction</dt><dd><code>{record.txid}</code></dd></div><div><dt>Original grant</dt><dd><code>{record.rootTxid}</code></dd></div><div><dt>Current confirmed head</dt><dd>Unavailable</dd></div><div><dt>Confirmation</dt><dd>Block {record.blockHeight.toLocaleString()} · <a href={explorerTxUrl(record.txid, network)} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={13} /></a></dd></div>{record.validationErrors?.length ? <div><dt>Validation</dt><dd>{record.validationErrors.join(" · ")}</dd></div> : null}</dl><div><p className="permission-muted">Recorded terms · current authority unavailable</p><pre className="permission-code" aria-label="Recorded permission terms"><code>{record.metadata.policy ? permissionPolicyEnv(record.metadata.policy) : `REVOKE_GRANT=${record.metadata.grant}\nREVIEWED_PARENT=${record.metadata.parent}`}</code></pre><p className="permission-muted">A single transaction cannot establish that no later replacement or revocation exists. Spending and committed budgets remain unavailable.</p></div></div>
    <details className="permission-history"><summary>Inspect exact public record</summary><pre className="permission-code"><code>{record.rawBody}</code></pre></details>
  </section>;
}

export default function PermissionRoot({ embedded = false, initialAddress = "", initialNetwork }: PermissionRootProps = {}) {
  const [network, setNetwork] = useState<BitcoinNetwork>(() => routeNetwork(initialNetwork));
  const [address, setAddress] = useState(initialAddress);
  const [hasUnisat] = useUnisatPresence();
  const [selected, setSelected] = useState(routePermission);
  const [search, setSearch] = useState(routePermission);
  const [list, setList] = useState<PermissionList>();
  const [detail, setDetail] = useState<PermissionDetail>();
  const [inspection, setInspection] = useState<PermissionInspection>();
  const [readBusy, setReadBusy] = useState(false);
  const [readError, setReadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [editor, setEditor] = useState(false);
  const [draft, setDraft] = useState<PermissionDraft>({ ...emptyPermissionDraft, allowedActions: [...emptyPermissionDraft.allowedActions] });
  const [draftLoaded, setDraftLoaded] = useState("");
  const [draftError, setDraftError] = useState("");
  const [status, setStatus] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedPermission>();
  const [receipts, setReceipts] = useState<ActionReceipt[]>([]);
  const [recoveryError, setRecoveryError] = useState("");
  const [checking, setChecking] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const flight = useRef(false), alive = useRef(true), sequence = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const unsavedReceipt = useRef<ActionReceipt>();
  const draftKey = `proofofwork.permission.draft.v1:${network}:${address || "disconnected"}`;
  const scope = JSON.stringify([network, address, draft]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const accountRef = useRef({ address, network }); accountRef.current = { address, network };
  const storageRef = useRef({ key: draftKey, loaded: draftLoaded, error: draftError, draft, editor });
  storageRef.current = { key: draftKey, loaded: draftLoaded, error: draftError, draft, editor };
  const planResult = useMemo(() => { try { return { plan: buildPermissionPlan(draft), error: "" }; } catch (error) { return { plan: undefined, error: errorText(error) }; } }, [draft]);
  const current = detail?.currentPermission ?? detail?.permission;
  const verified = Boolean(detail && hasVerifiedPermissionHistory(detail));
  const owner = Boolean(current && samePermissionAddress(current.walletAddress, address, network));
  const supportedWallet = useMemo(() => { try { assertMainnetP2pkhWallet(address, network); return true; } catch { return false; } }, [address, network]);
  const canManage = Boolean(verified && current?.status === "active" && owner && supportedWallet && detail && permissionPublicationReady(detail) && !readBusy && !actionBusy);
  const visibleReceipts = receipts.filter(item => item.network === network && samePermissionAddress(item.address, address, network));

  function preserveDraft() {
    if (flight.current) { setActionError("Wait for the current wallet operation before leaving Permission."); return false; }
    const saved = storageRef.current;
    if (!saved.editor) return true;
    if (saved.loaded !== saved.key || saved.error) { setActionError(saved.error || "The local draft is still loading."); return false; }
    try { persistPermissionDraft(localStorage, saved.key, saved.draft); return true; }
    catch (error) { setDraftError(errorText(error)); return false; }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  useEffect(() => { setAddress(initialAddress); }, [initialAddress]);
  useEffect(() => { if (initialNetwork) setNetwork(initialNetwork); }, [initialNetwork]);
  useEffect(() => { setPrepared(undefined); }, [scope]);
  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    const leave = (event: Event) => { if (!preserveDraft()) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { if (!preserveDraft()) { event.preventDefault(); event.returnValue = ""; } };
    const pop = () => { if (preserveDraft()) { setSelected(routePermission()); setSearch(routePermission()); setEditor(false); } };
    window.addEventListener("proofofwork:permission-refresh", refresh);
    window.addEventListener("proofofwork:before-permission-writer-leave", leave);
    window.addEventListener("beforeunload", unload); window.addEventListener("popstate", pop);
    return () => { window.removeEventListener("proofofwork:permission-refresh", refresh); window.removeEventListener("proofofwork:before-permission-writer-leave", leave); window.removeEventListener("beforeunload", unload); window.removeEventListener("popstate", pop); };
  }, []);
  useEffect(() => {
    const wallet = window.unisat;
    if (!wallet) return;
    const accounts = (...args: unknown[]) => { setAddress(Array.isArray(args[0]) ? String(args[0][0] ?? "") : ""); setPrepared(undefined); setStatus("Wallet account changed. Review Permission actions again."); };
    const changed = () => { setPrepared(undefined); void getWalletNetwork(wallet).then(value => { if (value) setNetwork(value); else setAddress(""); }); };
    wallet.on?.("accountsChanged", accounts); wallet.on?.("networkChanged", changed); wallet.on?.("chainChanged", changed);
    return () => { wallet.removeListener?.("accountsChanged", accounts); wallet.removeListener?.("networkChanged", changed); wallet.removeListener?.("chainChanged", changed); };
  }, [hasUnisat]);
  useEffect(() => {
    setDraftError("");
    try { const raw = localStorage.getItem(draftKey); const value: unknown = raw ? JSON.parse(raw) : { ...emptyPermissionDraft, allowedActions: [...emptyPermissionDraft.allowedActions] };
      if (!isPermissionDraft(value)) throw new Error("Saved Permission draft is unreadable. Preserve local storage before repairing it.");
      setDraft(value); setDraftLoaded(draftKey);
    } catch (error) { setDraftError(errorText(error)); setDraftLoaded(draftKey); }
  }, [draftKey]);
  useEffect(() => {
    if (draftLoaded !== draftKey || draftError) return;
    try { persistPermissionDraft(localStorage, draftKey, draft); } catch (error) { setDraftError(errorText(error)); }
  }, [draft, draftKey, draftLoaded, draftError]);
  useEffect(() => {
    try { setReceipts(readActionReceipts(localStorage).filter(item => item.key.startsWith("permission:"))); setRecoveryError(""); }
    catch (error) { setRecoveryError(errorText(error)); }
  }, [address, network]);
  useEffect(() => {
    const controller = new AbortController(), read = ++sequence.current;
    setReadBusy(true); setReadError(""); setList(undefined); setDetail(undefined); setInspection(undefined);
    const task = selected ? fetchPermission(network, selected, { fresh: attempt > 0, signal: controller.signal }).catch(async error => {
      if (controller.signal.aborted) throw error;
      try { return await fetchPermissionInspection(network, selected, { signal: controller.signal }); } catch { throw error; }
    }) : fetchPermissions(network, { address: address || undefined, fresh: attempt > 0, signal: controller.signal });
    void task.then(value => { if (controller.signal.aborted || sequence.current !== read) return; if ("record" in value) setInspection(value as PermissionInspection); else if ("permission" in value) setDetail(value as PermissionDetail); else setList(value as PermissionList); })
      .catch(error => { if (!controller.signal.aborted && sequence.current === read) setReadError(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted && sequence.current === read) setReadBusy(false); });
    return () => controller.abort();
  }, [selected, network, address, attempt]);

  function navigate(txid: string) {
    if (!preserveDraft()) return;
    const url = new URL(window.location.href); if (txid) url.searchParams.set("permission", txid); else url.searchParams.delete("permission");
    window.history.pushState({}, "", url); setSelected(txid); setSearch(txid); setEditor(false); setPrepared(undefined);
  }
  async function connect() {
    if (flight.current || !preserveDraft()) return;
    if (!window.unisat) { setActionError("Install UniSat to publish permission records."); return; }
    flight.current = true; setActionBusy(true); setActionError("");
    try { const accounts = window.unisat.requestAccounts ? await window.unisat.requestAccounts() : await window.unisat.getAccounts?.();
      if (!accounts?.[0]) throw new Error("UniSat did not return an address."); setAddress(await ensureWalletNetwork(window.unisat, network, accounts[0]));
    } catch (error) { setActionError(errorText(error)); } finally { flight.current = false; setActionBusy(false); }
  }
  function changeNetwork(value: BitcoinNetwork) {
    if (!preserveDraft()) return;
    setNetwork(value); setPrepared(undefined); setEditor(false);
    const url = new URL(window.location.href); url.searchParams.set("network", value); window.history.replaceState(window.history.state, "", url);
  }
  function begin(action: PermissionDraft["action"]) {
    if (!preserveDraft()) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (action === "grant") setDraft({ ...emptyPermissionDraft, allowedActions: [...emptyPermissionDraft.allowedActions], feeRate: draft.feeRate });
    else if (current && canManage) setDraft({ ...permissionDraftFromPolicy(current.policy, current.label, current.rootTxid, current.headTxid), action, feeRate: draft.feeRate });
    else return;
    setEditor(true); setPrepared(undefined); setActionError("");
  }
  function updateDraft(patch: Partial<PermissionDraft>) { setDraft(value => ({ ...permissionDraftWithRecoveryKey(value), ...patch })); setPrepared(undefined); setActionError(""); }
  function updateAgentRate(value: string) { setDraft(currentDraft => permissionDraftWithFeeRate(currentDraft, value)); setPrepared(undefined); setActionError(""); }
  function retainReceipt(receipt: ActionReceipt) { setReceipts(saveActionReceipt(localStorage, receipt).filter(item => item.key.startsWith("permission:"))); }
  async function assertNoDuplicate(key: string, ownSignedTxid?: string) {
    if (unsavedReceipt.current && unsavedReceipt.current.txid !== ownSignedTxid) throw new Error(`Signed transaction ${unsavedReceipt.current.txid} has unsaved recovery evidence. Preserve its TXID and check Transaction recovery before any new signature.`);
    if (recoveryError) throw new Error(recoveryError);
    const retained = readActionReceipts(localStorage).filter(item => item.key === key && item.txid !== ownSignedTxid && item.network === network && samePermissionAddress(item.address, address, network));
    if (retained.some(item => item.status === "unknown" || item.status === "pending")) throw new Error("A signed Permission transaction for this task is unresolved or pending. Check Transaction recovery before creating another transaction.");
    for (const confirmed of retained.filter(item => item.status === "confirmed")) {
      const task = restorePermissionDraft(confirmed.fields);
      try { const history = await fetchPermission(network, task?.action === "revoke" ? task.grant : confirmed.txid, { fresh: true, requireComplete: true });
        if (!history.events.some(event => event.txid === confirmed.txid && event.applied)) throw new Error("Confirmed task absent from replay."); }
      catch { throw new Error("A confirmed Permission transaction is not yet present in complete replay. Refresh before preparing another transaction."); }
      if (key.startsWith("permission:grant:")) throw new Error(`This exact permission task already confirmed as ${confirmed.txid}. Inspect it before creating a different grant.`);
    }
  }
  async function assertPlanNoDuplicate(plan: PreparedPermission["plan"], ownSignedTxid?: string) {
    if (plan.draft.recoveryKey && plan.draft.recoveryKey !== plan.key) await assertNoDuplicate(plan.draft.recoveryKey, ownSignedTxid);
    await assertNoDuplicate(plan.key, ownSignedTxid);
  }
  async function prepare(event: FormEvent) {
    event.preventDefault(); if (flight.current || !planResult.plan || draftError || draftLoaded !== draftKey) return;
    const expected = scope; const assertCurrent = () => { if (!alive.current || scopeRef.current !== expected) throw new Error("Permission terms, wallet, or network changed. Prepare a new review."); };
    flight.current = true; setActionBusy(true); setActionError("");
    try { await assertPlanNoDuplicate(planResult.plan); const next = await preparePermissionTransaction(planResult.plan, address, network, assertCurrent); await assertPlanNoDuplicate(planResult.plan); assertCurrent(); setPrepared(next); }
    catch (error) { if (alive.current) setActionError(errorText(error)); } finally { flight.current = false; if (alive.current) setActionBusy(false); }
  }
  async function sign() {
    if (flight.current || !prepared) return;
    const reviewed = prepared, expected = scope;
    const assertCurrent = () => { if (!alive.current || scopeRef.current !== expected) throw new Error("Permission terms, wallet, or network changed. Prepare a new review."); };
    let receipt: ActionReceipt | undefined, receiptPersisted = false;
    flight.current = true; setActionBusy(true); setActionError("");
    try {
      await assertPlanNoDuplicate(reviewed.plan); assertCurrent(); await verifyPermissionAuthority(reviewed.plan, reviewed.address, reviewed.network, assertCurrent); await verifyPermissionFunding(reviewed); await verifyPermissionAuthority(reviewed.plan, reviewed.address, reviewed.network, assertCurrent); assertCurrent();
      const result = await signAndBroadcastBoostPsbt({ wallet: window.unisat!, network: reviewed.network, signingAddress: reviewed.address, psbtHex: reviewed.payment.psbtHex,
        inputCount: reviewed.payment.inputCount, signInputIndexes: reviewed.payment.walletInputIndexes, requireP2pkhAllInputs: true,
        onSigned: txid => { receipt = { txid, address: reviewed.address, network: reviewed.network, title: PERMISSION_ACTION_LABELS[reviewed.plan.draft.action], key: reviewed.plan.key, createdAt: new Date().toISOString(), status: "unknown", fields: permissionDraftFields(reviewed.plan.draft) }; unsavedReceipt.current = receipt; retainReceipt(receipt); receiptPersisted = true; unsavedReceipt.current = undefined; },
        beforeBroadcast: async () => { assertCurrent(); await assertPlanNoDuplicate(reviewed.plan, receipt?.txid); await verifyPermissionAuthority(reviewed.plan, reviewed.address, reviewed.network, assertCurrent); await verifyPermissionFunding(reviewed); assertCurrent(); },
      });
      if (receipt) retainReceipt({ ...receipt, status: "pending" });
      setPrepared(undefined); setEditor(false); setStatus(`Transaction ${result.txid} broadcast. Permission authority updates only after confirmation and verified replay. Autonomous signing remains closed.`); setAttempt(value => value + 1);
    } catch (error) { if (alive.current) { setPrepared(undefined); setActionError(`${errorText(error)}${receipt ? receiptPersisted ? " Signed evidence is retained in Transaction recovery. Check its status before retrying." : ` Signed transaction ${receipt.txid} could not be saved. No broadcast was attempted. Preserve this TXID and check its status before retrying.` : ""}`); } }
    finally { flight.current = false; if (alive.current) setActionBusy(false); }
  }
  async function checkReceipts() {
    if (checking || flight.current) return;
    const expected = { ...accountRef.current }; setChecking(true); setRecoveryError("");
    try {
      const retained = [...readActionReceipts(localStorage), ...(unsavedReceipt.current ? [unsavedReceipt.current] : [])].filter(item => item.key.startsWith("permission:") && item.network === expected.network && samePermissionAddress(item.address, expected.address, expected.network));
      for (const item of retained.filter(item => item.status === "pending" || item.status === "unknown")) {
        const value = await fetchProofApiJson<{ status?: string }>(`/api/v1/tx/${item.txid}/status`, item.network);
        if (accountRef.current.address !== expected.address || accountRef.current.network !== expected.network) return;
        if (!["confirmed", "pending", "dropped"].includes(value.status ?? "")) throw new Error("Transaction status is unavailable. Recovery evidence and retry protection remain active.");
        retainReceipt({ ...item, status: value.status as ActionReceipt["status"] });
        if (unsavedReceipt.current?.txid === item.txid) unsavedReceipt.current = undefined;
      }
      setAttempt(value => value + 1);
    } catch (error) { setRecoveryError(errorText(error)); } finally { setChecking(false); }
  }
  async function loadMore() {
    if (!list?.pagination?.hasMore || !list.pagination.nextCursor || pageBusy || readBusy) return;
    const read = sequence.current; setPageBusy(true);
    try { const next = await fetchPermissions(network, { address: address || undefined, cursor: list.pagination.nextCursor });
      if (read !== sequence.current) return;
      const before = permissionCheckpoint(list), after = permissionCheckpoint(next);
      if (before.height !== after.height || before.hash !== after.hash) throw new Error("Permission checkpoint changed. Refresh the inventory.");
      const records = [...list.permissions, ...next.permissions];
      if (new Set(records.map(item => item.rootTxid)).size !== records.length) throw new Error("Permission inventory changed. Refresh before continuing.");
      setList({ ...next, permissions: records });
    } catch (error) { if (read === sequence.current) setReadError(errorText(error)); } finally { setPageBusy(false); }
  }
  async function copy(value: string, message: string) { try { await navigator.clipboard.writeText(value); setStatus(message); } catch { setStatus("Clipboard unavailable. Select the displayed text to copy it."); } }
  const evidence = detail ?? list;
  const checkpoint = evidence ? permissionCheckpoint(evidence) : undefined;
  const preview = planResult.plan?.policy ? permissionPolicyEnv(planResult.plan.policy) : draft.action === "revoke" ? `REVOKE_GRANT=${draft.grant}\nREVIEWED_HEAD=${draft.parent}` : "Complete the permission fields to preview its exact terms.";
  return <div className={`permission-app${embedded ? " permission-embedded-app" : ""}`}>
    {!embedded && <AppHeader title="ProofOfWork Permission" subtitle="On-chain authority. Local wallet control." address={address} network={network} hasUnisat={hasUnisat} busy={readBusy || actionBusy}
      connectWallet={() => void connect()} disconnectWallet={() => { if (preserveDraft()) setAddress(""); }} onNetworkChange={changeNetwork} onDomainNavigate={() => !preserveDraft()}
      onRefresh={() => setAttempt(value => value + 1)} onRefreshRecovery={() => void checkReceipts()} />}
    <main className="permission-workspace" aria-label="ProofOfWork Permission workspace">
      <div className="permission-heading"><div><span className="permission-eyebrow"><FileKey2 size={17} /> Permission on ProofOfWork</span><h2>{editor ? PERMISSION_ACTION_LABELS[draft.action] : "Wallet permissions"}</h2>
        <p>{editor ? "Review exact public authority before signing with the wallet it permits." : "Give agents a permission transaction. Bind actions and budgets to one authorizing wallet."}</p></div>
        {editor ? <button type="button" className="secondary" disabled={actionBusy} onClick={() => { if (preserveDraft()) { setEditor(false); setPrepared(undefined); } }}><ArrowLeft size={16} /> Save draft and back</button>
          : <button type="button" className="primary" disabled={actionBusy || network !== "livenet"} onClick={() => begin("grant")}><Plus size={17} /> New permission</button>}
      </div>
      {embedded && <div className="permission-account"><span>{network === "livenet" ? "Mainnet" : network === "testnet" ? "Testnet3" : "Testnet4"} · {address ? shortAddress(address) : "Read without a wallet"}</span>{!address && <button type="button" className="secondary" onClick={() => void connect()} disabled={actionBusy}>Connect UniSat</button>}</div>}
      <section className="permission-controller" aria-label="Autonomous signing status"><LockKeyhole size={27} /><div><strong>Autonomous signing is closed</strong><p>Grants record authority. Unattended execution stays closed until an isolated controller, protected secret storage, shared budgets, and the UniSat signing bridge are verified. Human-reviewed grant signing is separate.</p></div><span className="permission-pill is-closed">Controller not enabled</span></section>
      {status && <div className="permission-notice" role="status"><Check size={17} /><span>{status}</span><button type="button" aria-label="Dismiss status" onClick={() => setStatus("")}><X size={16} /></button></div>}
      {actionError && <div className="permission-notice is-error" role="alert">{actionError}</div>}
      <ActionRecoveryPanel receipts={visibleReceipts} error={recoveryError} checking={checking} restoringDisabled={actionBusy} canRestore={item => Boolean(restorePermissionDraft(item.fields))}
        onRestore={item => { if (!preserveDraft()) return; const restored = restorePermissionDraft(item.fields); if (restored) { setDraft({ ...restored, recoveryKey: item.key }); setPrepared(undefined); setEditor(true); setStatus("Retained task restored for inspection. Verify current confirmed history before preparing a new review."); } }} onCheck={() => void checkReceipts()}
        workspaceHref={item => `/?${new URLSearchParams({ ...(embedded ? { folder: "permission" } : { "permission-app": "1" }), network: item.network, permission: item.txid })}`} />
      {editor ? <section className="permission-editor" aria-label="Permission editor"><div className="permission-editor-top"><ShieldCheck size={17} /><span>Authorizing and permitted wallet · {address || "Connect UniSat before review"}</span></div>
        {address && !supportedWallet && <p className="permission-notice" role="status">Permission v1 requires a mainnet P2PKH UniSat address beginning with 1. Choose that wallet before preparing a review.</p>}
        <form className="permission-form" onSubmit={prepare}><div className="permission-editor-grid"><div>
          {draft.action !== "grant" && <div className="permission-muted">Original grant <code>{draft.grant}</code><p>Reviewed confirmed head <code>{draft.parent}</code></p></div>}
          {draft.action !== "revoke" ? <><label>Permission label<input required maxLength={200} value={draft.label} onChange={event => updateDraft({ label: event.target.value })} disabled={actionBusy} placeholder="Computer automation" autoComplete="off" /></label>
            <label className="permission-checkbox"><input type="checkbox" checked={draft.signingEnabled} onChange={event => updateDraft({ signingEnabled: event.target.checked })} disabled={actionBusy} /><span>Allow signing within this grant</span></label>
            <fieldset disabled={actionBusy}><legend>Allowed actions</legend>{PERMISSION_ACTIONS.map(action => <label className="permission-checkbox" key={action}><input type="checkbox" checked={draft.allowedActions.includes(action)} onChange={event => updateDraft({ allowedActions: event.target.checked ? [...draft.allowedActions, action] : draft.allowedActions.filter(value => value !== action) })} /><code>{action}</code></label>)}</fieldset>
            <div className="permission-number-fields"><label>Maximum transaction proofs<input inputMode="numeric" required value={draft.maxTransactionProofs} onChange={event => updateDraft({ maxTransactionProofs: event.target.value })} disabled={actionBusy} /></label><label>Daily limit proofs<input inputMode="numeric" required value={draft.dailyLimitProofs} onChange={event => updateDraft({ dailyLimitProofs: event.target.value })} disabled={actionBusy} /></label></div>
            {(draft.maxMinerFeeProofs !== undefined || draft.legacyMaxMinerFeeProofs !== undefined) && <p className="permission-notice">Historical total miner-fee cap: {draft.maxMinerFeeProofs ?? draft.legacyMaxMinerFeeProofs} proofs. This is not a fee rate. The original record stays unchanged; this replacement or upgraded draft requires an explicitly selected agent transaction rate.</p>}
            <FeeRateControl label="Agent transaction fee rate (proofs/vB)" presetsLabel="Agent transaction fee presets" disabled={actionBusy} feeRate={draft.minerFeeRateProofsPerVbyte ? Number(draft.minerFeeRateProofsPerVbyte) : Number.NaN} inputValue={draft.minerFeeRateProofsPerVbyte ?? ""} setFeeRate={rate => updateAgentRate(String(rate))} setInputValue={updateAgentRate} />
            <p className="permission-muted">Agents construct transactions at this recorded rate, rounding the total miner fee upward to whole proofs. Fee increases require a new owner-reviewed permission. Transaction and daily proof limits still apply.</p>
            <label>Permitted recipients<select value={draft.recipientMode} onChange={event => updateDraft({ recipientMode: event.target.value as PermissionDraft["recipientMode"] })} disabled={actionBusy}><option value="any">Any recipient within the other limits</option><option value="self">Authorizing wallet only</option><option value="restricted">Only listed addresses and the authorizing wallet</option></select></label>
            {draft.recipientMode === "restricted" && <label>Allowed recipient addresses<textarea rows={3} value={draft.recipients} onChange={event => updateDraft({ recipients: event.target.value })} disabled={actionBusy} placeholder="One exact address per line" /></label>}
            <details><summary>WORK asset and marketplace limits</summary><label className="permission-checkbox"><input type="checkbox" checked={draft.workEnabled} onChange={event => updateDraft({ workEnabled: event.target.checked })} disabled={actionBusy} /><span>Explicitly permit bounded WORK operations</span></label>
              <p className="permission-muted">Without explicit WORK limits, WORK attachments, listings, seals, and purchases are denied by the controller even when their action appears above. Existing AMO rules still apply.</p>
              {draft.workEnabled && <><label>Maximum WORK amount in subatoms<input inputMode="numeric" value={draft.maxAmountSubatoms} onChange={event => updateDraft({ maxAmountSubatoms: event.target.value })} disabled={actionBusy} /></label><p className="permission-muted">One WORK is exactly 10000000000000000 subatoms. Integer subatoms avoid rounding.</p><div className="permission-number-fields"><label>Minimum sale proceeds proofs<input inputMode="numeric" value={draft.minSaleProofs} onChange={event => updateDraft({ minSaleProofs: event.target.value })} disabled={actionBusy} /></label><label>Maximum purchase proofs<input inputMode="numeric" value={draft.maxPurchaseProofs} onChange={event => updateDraft({ maxPurchaseProofs: event.target.value })} disabled={actionBusy} /></label></div><label>Maximum open WORK listings<input inputMode="numeric" value={draft.maxOpenListings} onChange={event => updateDraft({ maxOpenListings: event.target.value })} disabled={actionBusy} /></label></>}
            </details></> : <p className="permission-notice">Revocation takes effect after confirmation and current-history verification. It stops new authorizations, preserves all records, and cannot cancel signatures already released.</p>}
          <FeeRateControl label="Permission publication fee rate (proofs/vB)" presetsLabel="Permission publication fee presets" disabled={actionBusy} feeRate={draft.feeRate} setFeeRate={feeRate => { if (!actionBusy) updateDraft({ feeRate }); }} />
        </div><aside className="permission-editor-aside"><h3>{draft.action === "revoke" ? "Revocation reference" : "On-chain permission preview"}</h3><pre className="permission-code" aria-label="Permission terms preview"><code>{preview}</code></pre><p className="permission-muted">Permissions have no expiry and no named-agent binding. Daily budgets reset at 00:00 UTC. Replacing a grant preserves spending and outstanding commitments.</p><p className="permission-muted">The 546-proof self-payment returns to this wallet. The publication fee pays for this grant record; the agent transaction rate is its separate on-chain instruction. Passwords and secret references are never included in the public grant.</p>{draft.allowedActions.includes("amo.buywork") && BigInt(/^\d+$/u.test(draft.maxTransactionProofs) ? draft.maxTransactionProofs : "0") < 25000n && <p className="permission-muted">The 5,000-proof default transaction cap cannot authorize the current 25,000-proof WORK purchase, before fees. Choosing an action does not override its spending cap.</p>}</aside></div>
          {draftError && <p className="permission-notice is-error" role="alert">{draftError}</p>}{!planResult.plan && <p className="permission-muted">{planResult.error}</p>}
          <div className="permission-editor-footer"><p className="permission-muted">Local draft · no wallet signature requested until you continue from exact review.</p><button type="submit" className="primary" disabled={!address || !supportedWallet || network !== "livenet" || actionBusy || !planResult.plan || Boolean(draftError) || draftLoaded !== draftKey}><ShieldCheck size={17} /> {actionBusy ? "Preparing review…" : "Review permission"}</button></div>
        </form></section> : <>
        <div className="permission-tools"><form onSubmit={event => { event.preventDefault(); if (PERMISSION_TXID.test(search.trim())) navigate(search.trim()); else setActionError("Enter a 64-character lowercase permission transaction ID."); }}><label className="sr-only" htmlFor="permission-txid">Permission transaction ID</label><input id="permission-txid" value={search} onChange={event => setSearch(event.target.value)} placeholder="Inspect a permission transaction ID" autoComplete="off" /><button type="submit" className="secondary"><Search size={17} /><span>Inspect</span></button></form><button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)} disabled={readBusy}><RefreshCw size={16} /> Refresh</button></div>
        {selected && <button type="button" className="permission-back" onClick={() => navigate("")}><ArrowLeft size={16} /> Back to permissions</button>}
        {readBusy ? <div className="permission-read-state" role="status"><h3>Verifying confirmed permissions…</h3><p>Reading wallet authority and checkpoint-bound history.</p></div> : readError ? <div className="permission-read-state" role="alert"><h3>Permission evidence unavailable</h3><p>{readError}</p><button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>Retry confirmed read</button></div> : inspection ? <RawPermissionRecord inspection={inspection} network={network} /> : detail ? <section className="permission-detail" aria-label="Permission details"><div className="permission-detail-head"><strong>{permissionName(detail.permission)}</strong><span className={`permission-pill${verified && detail.permission.status === "active" ? " is-active" : ""}`}>{verified ? detail.permission.status : "Current status unverified"}</span><div className="permission-detail-actions"><button type="button" className="secondary" onClick={() => void copy(detail.permission.txid, "Permission transaction ID copied.")}><Copy size={16} /> Copy TXID</button><button type="button" className="secondary" onClick={() => begin("replace")} disabled={!canManage}>Replace</button><button type="button" className="secondary" onClick={() => begin("revoke")} disabled={!canManage}>Revoke</button></div></div>
          {!verified && <div className="permission-notice" role="status">This confirmed record is inspectable, but complete current permission history is unavailable. It cannot authorize execution or lifecycle changes.</div>}
          {verified && current && detail.permission.txid !== current.txid && <div className="permission-notice"><span>This is a historical permission version. Agents must use current confirmed authority.</span><button type="button" className="secondary" onClick={() => navigate(current.txid)}>View current grant</button></div>}
          <div className="permission-detail-body"><dl className="permission-facts"><div><dt>Authorizing and only permitted wallet</dt><dd><code>{detail.permission.walletAddress}</code></dd></div><div><dt>Permission transaction</dt><dd><code>{detail.permission.txid}</code></dd></div><div><dt>Original grant</dt><dd><code>{detail.permission.rootTxid}</code></dd></div><div><dt>Current confirmed head</dt><dd><code>{verified && current ? current.headTxid : "Unavailable"}</code></dd></div><div><dt>Lifetime and agent scope</dt><dd>No expiry · no named-agent requirement. Wallet and controller access remain separate from the public TXID.</dd></div><div><dt>Confirmation</dt><dd>Block {detail.permission.blockHeight.toLocaleString()} · <a href={explorerTxUrl(detail.permission.txid, network)} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={13} /></a></dd></div></dl><div><div className="permission-code-toolbar"><span>Exact permission terms</span><button type="button" className="secondary" onClick={() => void copy(permissionPolicyEnv(detail.permission.policy), "Permission terms copied.")}><Copy size={15} /> Copy terms</button></div><pre className="permission-code" aria-label="Confirmed permission terms"><code>{permissionPolicyEnv(detail.permission.policy)}</code></pre><p className="permission-muted">Terms are data. Never execute an on-chain permission with shell source or evaluate embedded text.</p></div></div>
          <div className="permission-budget" aria-label="Controller budget accounting"><div><strong>Unavailable</strong><span>Spent proofs today</span></div><div><strong>Unavailable</strong><span>Committed proofs</span></div><div><strong>Unavailable</strong><span>Remaining daily budget</span></div></div><p className="permission-muted" style={{ margin: "16px 24px" }}>A verified protected controller supplies shared spending and reservation accounting. Chain inspection alone cannot prove unbroadcast signatures or remaining capacity.</p>
          <div className="permission-history"><h3>Permission history</h3>{detail.events.map((event, index) => <div className="permission-event" key={`${event.txid}:${index}`}><FileKey2 size={17} /><div><strong>{event.action === "invalid" ? "Rejected record" : PERMISSION_ACTION_LABELS[event.action]}</strong><p>{event.applied ? "Applied confirmed record" : "Unapplied history"}{event.blockHeight != null ? ` · Block ${event.blockHeight.toLocaleString()}` : ""}{event.reason || event.validationErrors?.length ? ` · ${event.reason || event.validationErrors?.join(" · ")}` : ""}</p></div><a href={explorerTxUrl(event.txid, network)} target="_blank" rel="noreferrer">{compactTx(event.txid)} <ArrowUpRight size={13} /></a></div>)}</div>
        </section> : list && list.permissions.length ? <><div className="permission-grid">{list.permissions.map(record => <PermissionCard key={record.rootTxid} record={record} onOpen={() => navigate(record.txid)} />)}</div>{list.pagination?.hasMore && <button type="button" className="secondary permission-load-more" onClick={() => void loadMore()} disabled={pageBusy}>{pageBusy ? "Loading…" : "Load more permissions"}</button>}</> : list ? <div className="permission-empty"><FileKey2 size={32} /><h3>No confirmed permissions yet</h3><p>{address ? "This wallet has no grants in verified current permission history." : "Verified current permission history contains no grants. Connect UniSat to prepare your first grant."}</p><button type="button" className="secondary" onClick={() => begin("grant")} disabled={network !== "livenet"}>Create a permission</button></div> : null}
        {evidence && hasVerifiedPermissionHistory(evidence) && <div className="permission-coverage"><ShieldCheck size={15} /><span>Confirmed history verified through block {checkpoint?.height?.toLocaleString()} · {checkpoint?.hash}</span></div>}
        {draft.label && !draftError && <div className="permission-notice"><span>Local unsent draft · {draft.label}</span><button type="button" className="secondary" onClick={() => { if (preserveDraft()) setEditor(true); }}>Resume draft</button></div>}
      </>}
      <details className="permission-setup"><summary><KeyRound size={17} /> Local wallet setup and agent configuration</summary><div className="permission-setup-grid"><div><h3>Public grant, local secret</h3><pre className="permission-code" aria-label="Local configuration example"><code>{`unisat_permissions="${verified && current?.status === "active" ? current.txid : "<confirmed-permission-txid>"}"\nunisat_password_secret="unisat_local"`}</code></pre><p>The secret name refers to a protected keyring entry. It contains no password. Putting this configuration in a project or .codex folder does not install or enable a wallet controller.</p><p>Never publish a wallet password, seed phrase, private key, or controller access credential on chain.</p></div><div><h3>Protected execution boundary</h3><ol><li>Owner stores the UniSat unlock credential in the isolated controller's secret store.</li><li>Local or cloud agents submit requests. The controller verifies current grants, exact wallet and transaction, and shared budget reservations.</li><li>The controller unlocks and signs only through a verified UniSat bridge. It keeps credentials and wallet controls outside agent access.</li></ol><p>This release keeps that execution boundary closed. An ordinary unlocked Login keyring and unrestricted wallet browser access do not establish hard enforcement.</p></div></div></details>
    </main>
    {!embedded && <SocialFooter />}
    {prepared && <ActionTransactionReview review={prepared.review} onCancel={() => { if (!actionBusy) setPrepared(undefined); }} onApprove={() => void sign()} returnFocus={returnFocus.current} />}
  </div>;
}
