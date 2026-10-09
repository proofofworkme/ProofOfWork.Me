import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, BriefcaseBusiness, Check, CheckCircle2, ClipboardList, Copy, Download, FileCheck2, FileUp, Handshake, Plus, RefreshCw, Search, ShieldCheck, Wallet, X } from "lucide-react";
import { AppHeader } from "../../shared/components/AppHeader";
import { SocialFooter } from "../../shared/components/SocialFooter";
import { FeeRateControl } from "../../shared/components/FeeRateControl";
import { ActionTransactionReview } from "../../shared/components/ActionTransactionReview";
import { ActionRecoveryPanel } from "../../shared/components/ActionRecoveryPanel";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { explorerTxUrl, type BitcoinNetwork } from "../../shared/bitcoin/networks";
import { useUnisatPresence } from "../../shared/wallet/useUnisatPresence";
import { readActionReceipts, saveActionReceipt, type ActionReceipt } from "../../shared/wallet/actionRecovery";
import { attachmentFromFile } from "../../shared/protocol/mailAttachment";
import { ensureWalletNetwork, getWalletNetwork, signAndBroadcastBoostPsbt } from "../boost/boostWallet";
import { shortAddress } from "../../functions";
import { fetchJob, fetchJobs, jobReward, JOB_STATUSES, JOB_TXID, type Job, type JobAction, type JobDetail, type JobEvent, type JobsList } from "./jobsApi";
import { buildJobsPlan, emptyJobsDraft, isJobsDraft, JOB_ACTION_LABELS, jobsDraftFields, persistJobsDraft, restoreJobsDraft, type JobsDraft } from "./jobsProtocol";
import { prepareJobsTransaction, sameJobsAddress, verifyJobsAuthority, verifyJobsFunding, type PreparedJob } from "./jobsWallet";
import { downloadJobsFile, fetchJobsFile, type JobsFile } from "./jobsArtifacts";
import { formatJobReward, formatJobWorkSubatoms, jobRewardFromMetadata, type JobReward } from "../../shared/protocol/jobs.mjs";
import "./jobs.css";

export type JobsRootProps = { embedded?: boolean; initialAddress?: string; initialNetwork?: BitcoinNetwork };
type Route = { job: string; mine: boolean; q: string; status: string };
const compact = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : "Jobs is temporarily unavailable. Try again in a moment.";
const proofText = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
function rewardText(reward: JobReward | null) {
  if (!reward) return "Reward unavailable";
  const [amount, asset] = formatJobReward(reward).split(" "), [whole, fraction] = amount.split(".");
  return `${proofText(whole)}${fraction === undefined ? "" : `.${fraction}`} ${asset}`;
}
function workText(value: string) {
  const [whole, fraction] = formatJobWorkSubatoms(value).split(".");
  return `${proofText(whole)}${fraction === undefined ? "" : `.${fraction}`} WORK`;
}
function RewardValue({ reward }: { reward: JobReward | null }) {
  const value = rewardText(reward), split = value.lastIndexOf(" ");
  return <>{value.slice(0, split)} <span>{value.slice(split + 1)}</span></>;
}
const statusLabel = (value: string) => value === "paid" ? "Paid · confirmed" : value === "cancelled" ? "Cancelled" : value === "delivered" ? "Awaiting acceptance" : value === "assigned" ? "Assigned" : "Open";
function initialRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  return { job: params.get("job") ?? "", mine: params.get("mode") === "my", q: params.get("q") ?? "", status: JOB_STATUSES.includes(params.get("status") as Job["status"]) ? params.get("status")! : "" };
}
function dateText(value: number | string | null) {
  if (!value || (typeof value === "number" && value < 1)) return "Chain time unavailable";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "Chain time unavailable" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function TxLink({ txid, network, label }: { txid: string; network: BitcoinNetwork; label?: string }) {
  return <a className="jobs-tx-link" href={explorerTxUrl(txid, network)} target="_blank" rel="noreferrer" title={txid}>{label ?? compact(txid)} <ArrowUpRight size={14} /></a>;
}
function FileEvidence({ txid, network, own = false }: { txid: string; network: BitcoinNetwork; own?: boolean }) {
  const [file, setFile] = useState<JobsFile>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const alive = useRef(true);
  const controller = useRef<AbortController>();
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, [txid, network]);
  async function inspect() {
    if (busy) return;
    controller.current?.abort(); const active = new AbortController(); controller.current = active;
    setBusy(true); setMessage("");
    try {
      const result = await fetchJobsFile(txid, network, active.signal);
      if (!alive.current || active.signal.aborted) return;
      if (result) setFile(result); else setMessage("Confirmed transaction. It carries no Files attachment; inspect its source record using the transaction link.");
    } catch (error) { if (alive.current && !active.signal.aborted) setMessage(errorText(error)); }
    finally { if (alive.current && !active.signal.aborted) setBusy(false); }
  }
  return <div className="jobs-file-evidence"><div><FileCheck2 size={16} /><span>{own ? "Delivery file" : "Transaction reference"}</span><TxLink txid={txid} network={network} /></div>
    {file ? <><p><strong>{file.name}</strong> · {file.size.toLocaleString()} bytes · {file.mime}</p><code className="jobs-exact">SHA-256 {file.sha256}</code><button className="secondary" type="button" onClick={() => downloadJobsFile(file)}><Download size={15} /> Download verified file</button><p className="jobs-muted">Confirmed transaction bytes, exact size and SHA-256 verified. This does not attest to the file's quality. Files are downloaded without executing them here.</p></> : <button className="secondary" type="button" onClick={() => void inspect()} disabled={busy}>{busy ? <RefreshCw className="refresh-spin" size={15} /> : <ShieldCheck size={15} />}{busy ? "Verifying file…" : "Inspect file evidence"}</button>}
    {message && <p className="jobs-muted" role="status">{message}</p>}
  </div>;
}

export default function JobsRoot({ embedded = false, initialAddress = "", initialNetwork }: JobsRootProps = {}) {
  const [network, setNetwork] = useState<BitcoinNetwork>(() => { const value = new URLSearchParams(window.location.search).get("network"); return initialNetwork ?? (value === "testnet" || value === "testnet4" || value === "livenet" ? value : "livenet"); });
  const [address, setAddress] = useState(initialAddress);
  const [hasUnisat] = useUnisatPresence();
  const [route, setRoute] = useState(initialRoute);
  const [query, setQuery] = useState(route.q);
  const [list, setList] = useState<JobsList>();
  const [detail, setDetail] = useState<JobDetail>();
  const [attempt, setAttempt] = useState(0);
  const [readBusy, setReadBusy] = useState(true);
  const [pageBusy, setPageBusy] = useState(false);
  const [readError, setReadError] = useState("");
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<"brief" | "proposals" | "deliveries" | "receipt">("brief");
  const [editor, setEditor] = useState(false);
  const [draft, setDraft] = useState<JobsDraft>({ ...emptyJobsDraft });
  const [loadedKey, setLoadedKey] = useState("");
  const [draftError, setDraftError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedJob>();
  const [receipts, setReceipts] = useState<ActionReceipt[]>([]);
  const [recoveryError, setRecoveryError] = useState("");
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true), flight = useRef(false), readSequence = useRef(0), checkFlight = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const fileSequence = useRef(0);
  const draftKey = `proofofwork.jobs.draft.v1:${network}:${address || "disconnected"}`;
  const state = useRef({ draft, draftKey, loadedKey, draftError, editor, prepared });
  state.current = { draft, draftKey, loadedKey, draftError, editor, prepared };
  const account = useRef({ address, network }); account.current = { address, network };
  const scope = JSON.stringify([address, network, draft, route.job, detail?.job.headTxid, editor]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const job = detail?.job;
  const requester = Boolean(job && sameJobsAddress(job.requesterAddress, address, network));
  const worker = Boolean(job && sameJobsAddress(job.workerAddress, address, network));
  const visibleReceipts = receipts.filter(item => item.network === network && sameJobsAddress(item.address, address, network));
  const planResult = useMemo(() => { try { return { plan: buildJobsPlan(draft), error: "" }; } catch (error) { return { plan: undefined, error: errorText(error) }; } }, [draft]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; readSequence.current++; fileSequence.current++; }; }, []);
  useEffect(() => { setAddress(initialAddress); }, [initialAddress]);
  useEffect(() => { if (initialNetwork) setNetwork(initialNetwork); }, [initialNetwork]);
  useEffect(() => { setPrepared(undefined); }, [scope]);
  const preserveDraft = useCallback(() => {
    if (flight.current) { setActionError("Wait for the current wallet operation before leaving Jobs."); return false; }
    const value = state.current;
    if (!value.editor) return true;
    if (value.loadedKey !== value.draftKey || value.draftError) { setActionError(value.draftError || "The local Jobs draft is still loading."); return false; }
    try { persistJobsDraft(localStorage, value.draftKey, value.draft); return true; }
    catch { setDraftError("Job draft autosave is unavailable. Copy your fields before leaving."); return false; }
  }, []);
  const retainReceipt = useCallback((receipt: ActionReceipt) => { setReceipts(saveActionReceipt(localStorage, receipt).filter(item => item.key.startsWith("jobs:"))); }, []);
  const checkReceipts = useCallback(async () => {
    if (checkFlight.current || flight.current) return;
    checkFlight.current = true; setChecking(true); setRecoveryError("");
    const expected = { ...account.current };
    const assertAccount = () => account.current.address === expected.address && account.current.network === expected.network && alive.current;
    try {
      const current = readActionReceipts(localStorage).filter(item => item.key.startsWith("jobs:") && item.network === expected.network && sameJobsAddress(item.address, expected.address, expected.network));
      const unresolved = current.filter(item => item.status === "unknown" || item.status === "pending");
      for (let index = 0; index < unresolved.length; index += 2) {
        const group = await Promise.allSettled(unresolved.slice(index, index + 2).map(async receipt => {
          const value = await fetchProofApiJson<{ status?: string }>(`/api/v1/tx/${receipt.txid}/status`, receipt.network);
          if (!["confirmed", "pending", "dropped"].includes(value.status ?? "")) throw new Error("Transaction status is unavailable. Retry protection remains active.");
          return { ...receipt, status: value.status as ActionReceipt["status"] };
        }));
        if (!assertAccount()) return;
        let failure: unknown;
        for (const result of group) { if (result.status === "fulfilled") retainReceipt(result.value); else failure = result.reason; }
        if (failure) throw failure;
      }
      if (assertAccount()) setReceipts(readActionReceipts(localStorage).filter(item => item.key.startsWith("jobs:")));
    } catch (error) { if (assertAccount()) setRecoveryError(errorText(error)); }
    finally { checkFlight.current = false; if (alive.current) setChecking(false); }
  }, [retainReceipt]);
  useEffect(() => {
    const refresh = () => { if (!flight.current) { setAttempt(value => value + 1); void checkReceipts(); } };
    const leave = (event: Event) => { if (!preserveDraft()) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { if (!preserveDraft()) { event.preventDefault(); event.returnValue = ""; } };
    const pop = () => { setPrepared(undefined); if (preserveDraft()) { setRoute(initialRoute()); setEditor(false); } };
    window.addEventListener("proofofwork:jobs-refresh", refresh); window.addEventListener("proofofwork:before-jobs-writer-leave", leave);
    window.addEventListener("beforeunload", unload); window.addEventListener("popstate", pop);
    return () => { window.removeEventListener("proofofwork:jobs-refresh", refresh); window.removeEventListener("proofofwork:before-jobs-writer-leave", leave); window.removeEventListener("beforeunload", unload); window.removeEventListener("popstate", pop); };
  }, [checkReceipts, preserveDraft]);
  useEffect(() => {
    setDraftError(""); setPrepared(undefined);
    try {
      const raw = localStorage.getItem(draftKey); const value: unknown = raw ? JSON.parse(raw) : { ...emptyJobsDraft };
      if (!isJobsDraft(value)) throw new Error("Saved Jobs draft is unreadable. Preserve local storage before repairing it.");
      if (state.current.editor && state.current.loadedKey && state.current.loadedKey !== draftKey) setStatus("The previous account's draft is saved separately. This account's Jobs draft is now loaded.");
      setDraft(value); setLoadedKey(draftKey);
    } catch (error) { setLoadedKey(draftKey); setDraftError(errorText(error)); }
  }, [draftKey]);
  useEffect(() => {
    if (loadedKey !== draftKey || draftError) return;
    try { persistJobsDraft(localStorage, draftKey, draft); } catch { setDraftError("Job draft autosave is unavailable. Copy your fields before leaving."); }
  }, [draft, draftKey, loadedKey, draftError]);
  useEffect(() => {
    try { setReceipts(readActionReceipts(localStorage).filter(item => item.key.startsWith("jobs:"))); setRecoveryError(""); } catch (error) { setRecoveryError(errorText(error)); }
    void checkReceipts();
  }, [address, network, checkReceipts]);
  useEffect(() => {
    const wallet = window.unisat; if (!wallet) return;
    const accounts = (...args: unknown[]) => { setAddress(Array.isArray(args[0]) ? String(args[0][0] ?? "") : ""); setPrepared(undefined); if (state.current.prepared) setActionError("Wallet account changed. Review Jobs actions again."); setStatus("Wallet account changed. Review Jobs actions again."); };
    const changed = () => { setPrepared(undefined); void getWalletNetwork(wallet).then(value => { if (value) setNetwork(value); else setAddress(""); }).catch(() => setAddress("")); };
    wallet.on?.("accountsChanged", accounts); wallet.on?.("networkChanged", changed); wallet.on?.("chainChanged", changed);
    return () => { wallet.removeListener?.("accountsChanged", accounts); wallet.removeListener?.("networkChanged", changed); wallet.removeListener?.("chainChanged", changed); };
  }, [hasUnisat]);
  const navigate = useCallback((next: Route) => {
    if (!preserveDraft()) return;
    const url = new URL(window.location.href);
    for (const key of ["job", "mode", "q", "status"]) url.searchParams.delete(key);
    if (next.job) url.searchParams.set("job", next.job);
    if (next.mine) url.searchParams.set("mode", "my");
    if (next.q) url.searchParams.set("q", next.q);
    if (next.status) url.searchParams.set("status", next.status);
    window.history.pushState({}, "", url); setRoute(next); setQuery(next.q); setEditor(false); setPrepared(undefined); setActionError(""); setTab("brief"); setCopied(false);
  }, [preserveDraft]);
  useEffect(() => {
    const controller = new AbortController(), sequence = ++readSequence.current;
    setReadBusy(true); setReadError(""); setDetail(undefined); setList(undefined);
    if (route.mine && !address && !route.job) { setReadBusy(false); return () => controller.abort(); }
    const task = route.job ? fetchJob(network, route.job, { fresh: attempt > 0, signal: controller.signal }) : fetchJobs(network, { q: route.q, status: route.status, address: route.mine ? address : undefined, fresh: attempt > 0, signal: controller.signal });
    void task.then(value => { if (!controller.signal.aborted && sequence === readSequence.current) { if ("job" in value) setDetail(value); else setList(value); } })
      .catch(error => { if (!controller.signal.aborted && sequence === readSequence.current) setReadError(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted && sequence === readSequence.current) setReadBusy(false); });
    return () => controller.abort();
  }, [network, route.job, route.mine, route.q, route.status, route.mine ? address : "", attempt]);

  async function connect() {
    if (flight.current || !preserveDraft()) return;
    const wallet = window.unisat; if (!wallet) { setActionError("Install UniSat to publish or act on a job."); return; }
    flight.current = true; setActionBusy(true); setActionError("");
    try {
      const accounts = wallet.requestAccounts ? await wallet.requestAccounts() : await wallet.getAccounts?.();
      if (!accounts?.[0]) throw new Error("UniSat did not return an address.");
      const verified = await ensureWalletNetwork(wallet, network, accounts[0]);
      const prior = state.current, nextKey = `proofofwork.jobs.draft.v1:${network}:${verified}`;
      if (!account.current.address && prior.editor && prior.loadedKey === prior.draftKey && !localStorage.getItem(nextKey)) persistJobsDraft(localStorage, nextKey, prior.draft);
      setAddress(verified); setStatus(`${shortAddress(verified)} connected. Signing stays in UniSat.`);
    }
    catch (error) { setActionError(errorText(error)); } finally { flight.current = false; if (alive.current) setActionBusy(false); }
  }
  function changeNetwork(value: BitcoinNetwork) {
    if (flight.current || !preserveDraft()) return;
    setNetwork(value); setPrepared(undefined); setEditor(false);
    const url = new URL(window.location.href); url.searchParams.set("network", value); window.history.replaceState(window.history.state, "", url);
  }
  function begin(action: JobAction, proposal?: JobEvent) {
    if (flight.current || !preserveDraft() || (action !== "brief" && (!job || readBusy || readError))) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActionError(""); setPrepared(undefined);
    const reward = proposal ? jobRewardFromMetadata(proposal.metadata) : job && action !== "brief" ? jobReward(job) : null;
    setDraft({ ...emptyJobsDraft, action, feeRate: draft.feeRate, title: action === "brief" ? "" : job?.title ?? "", job: action === "brief" ? "" : job?.txid ?? "", expectedHead: action === "brief" ? "" : job?.headTxid ?? "", scope: action === "propose" ? job?.scope ?? "" : "", rewardSats: reward?.asset === "proofs" ? reward.amountSats : "546", rewardAsset: reward?.asset ?? "proofs", rewardWork: reward?.asset === "WORK" ? formatJobWorkSubatoms(reward.amountSubatoms) : "1", proposal: proposal?.txid ?? "", assignment: job?.assignmentTxid ?? "", delivery: job?.deliveryTxid ?? "" });
    setEditor(true);
  }
  function updateDraft(patch: Partial<JobsDraft>) { setDraft(value => ({ ...value, ...patch })); setActionError(""); setPrepared(undefined); }
  async function noDuplicate(key: string, ownTxid?: string) {
    const current = account.current;
    if (recoveryError) throw new Error(recoveryError);
    const matching = readActionReceipts(localStorage).filter(item => item.txid !== ownTxid && item.key === key && item.network === current.network && sameJobsAddress(item.address, current.address, current.network));
    if (matching.some(item => item.status === "unknown" || item.status === "pending")) throw new Error("A signed Jobs transaction for this task is unresolved or pending. Check Transaction recovery before creating another transaction.");
    for (const receipt of matching.filter(item => item.status === "confirmed")) {
      const retained = restoreJobsDraft(receipt.fields);
      if (!retained) throw new Error("Confirmed Jobs recovery evidence is unreadable. Preserve it before continuing.");
      const projection = await fetchJob(current.network, retained.action === "brief" ? receipt.txid : retained.job, { fresh: true });
      if (!projection.events.some(item => item.txid === receipt.txid)) throw new Error("A confirmed Jobs transaction is still absent from complete replay. Refresh before trying another transaction.");
      if (retained.action === "brief") throw new Error("This exact job brief was already published. Open its confirmed job instead of publishing it again.");
    }
  }
  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (flight.current || !planResult.plan || draftError || loadedKey !== draftKey) return;
    const expected = scope, plan = planResult.plan;
    const assertCurrent = () => { if (!alive.current || currentScope.current !== expected) throw new Error("Job fields, account, network or confirmed terms changed. Prepare a new review."); };
    flight.current = true; setActionBusy(true); setActionError("");
    try { await noDuplicate(plan.key); const value = await prepareJobsTransaction(plan, address, network, assertCurrent); await noDuplicate(plan.key); assertCurrent(); returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setPrepared(value); }
    catch (error) { if (alive.current) setActionError(errorText(error)); } finally { flight.current = false; if (alive.current) setActionBusy(false); }
  }
  async function sign() {
    if (flight.current || !prepared) return;
    const reviewed = prepared, expected = scope;
    const assertCurrent = () => { if (!alive.current || currentScope.current !== expected) throw new Error("Job fields, account, network or confirmed terms changed. Prepare a new review."); };
    let receipt: ActionReceipt | undefined;
    flight.current = true; setActionBusy(true); setActionError("");
    try {
      await noDuplicate(reviewed.plan.key); assertCurrent(); await verifyJobsAuthority(reviewed.plan, reviewed.address, reviewed.network, assertCurrent); await verifyJobsFunding(reviewed); assertCurrent();
      const result = await signAndBroadcastBoostPsbt({ wallet: window.unisat!, network: reviewed.network, signingAddress: reviewed.address, psbtHex: reviewed.payment.psbtHex, inputCount: reviewed.payment.inputCount, signInputIndexes: reviewed.payment.walletInputIndexes,
        onSigned: txid => { const signed: ActionReceipt = { txid, address: reviewed.address, network: reviewed.network, title: JOB_ACTION_LABELS[reviewed.plan.draft.action], key: reviewed.plan.key, createdAt: new Date().toISOString(), status: "unknown", fields: [...jobsDraftFields(reviewed.plan.draft), ...(reviewed.reward ? [["Jobs reviewed reward", JSON.stringify(reviewed.reward)] as [string, string]] : [])] }; retainReceipt(signed); receipt = signed; },
        beforeBroadcast: async () => { assertCurrent(); await noDuplicate(reviewed.plan.key, receipt?.txid); assertCurrent(); await verifyJobsAuthority(reviewed.plan, reviewed.address, reviewed.network, assertCurrent, receipt?.txid); await verifyJobsFunding(reviewed, receipt?.txid); assertCurrent(); },
      });
      if (receipt) retainReceipt({ ...receipt, status: "pending" });
      setPrepared(undefined); setStatus(`Transaction ${result.txid} broadcast. Jobs updates after confirmed replay. Your draft remains saved.`); setEditor(false); setAttempt(value => value + 1);
    } catch (error) { if (alive.current) { setPrepared(undefined); setActionError(`${errorText(error)}${receipt ? " Signed transaction evidence remains in Transaction recovery. Check its status before retrying." : ""}`); } }
    finally { flight.current = false; if (alive.current) setActionBusy(false); }
  }
  async function upload(file?: File) {
    if (!file || flight.current) return;
    const sequence = ++fileSequence.current, expected = scope;
    setActionError("");
    try { const attachment = await attachmentFromFile(file); if (alive.current && sequence === fileSequence.current && currentScope.current === expected) updateDraft({ attachment }); }
    catch (error) { if (alive.current && sequence === fileSequence.current) setActionError(errorText(error)); }
  }
  async function loadMore() {
    if (!list || pageBusy || readBusy || !list.pagination.nextCursor) return;
    const captured = list, sequence = readSequence.current;
    setPageBusy(true); setReadError("");
    try {
      const next = await fetchJobs(network, { q: route.q, status: route.status, address: route.mine ? address : undefined, cursor: captured.pagination.nextCursor!, snapshot: captured.snapshot.id });
      if (!alive.current || sequence !== readSequence.current) return;
      const combined = [...captured.jobs, ...next.jobs];
      if (new Set(combined.map(item => item.txid)).size !== combined.length) throw new Error("Jobs pagination repeated records. Refresh the board.");
      setList({ ...next, jobs: combined });
    } catch (error) { if (alive.current && sequence === readSequence.current) setReadError(errorText(error)); }
    finally { if (alive.current && sequence === readSequence.current) setPageBusy(false); }
  }
  async function copyLink() { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { setStatus("Clipboard unavailable. Copy the job URL from your browser."); } }
  const evidence = detail ?? list;
  const actionDisabled = actionBusy || readBusy || Boolean(readError) || network !== "livenet";
  const proposal = detail?.proposals.find(item => item.txid === draft.proposal);
  const draftPresent = draft.action !== "brief" || Boolean(draft.title || draft.scope);
  function restore(receipt: ActionReceipt) {
    if (!preserveDraft()) return;
    const value = restoreJobsDraft(receipt.fields); if (!value) return;
    if (value.job) navigate({ ...route, job: value.job });
    setDraft(value); setEditor(true); setPrepared(undefined); setStatus("Retained task fields restored for inspection. Nothing was submitted.");
  }
  function renderReceipt() {
    if (!job) return null;
    return <section className="jobs-receipt"><div className="jobs-section-heading"><ShieldCheck size={19} /><h3>Work receipt</h3><span className={`jobs-badge is-${job.status}`}>{statusLabel(job.status)}</span></div>
      <p className="jobs-muted">A receipt links the parties, agreed terms, delivery and direct payment. Acceptance records the requester's attestation. It does not judge work quality.</p>
      <dl className="jobs-receipt-fields"><div><dt>Requester</dt><dd><code className="jobs-exact">{job.requesterAddress}</code></dd></div><div><dt>Worker</dt><dd><code className="jobs-exact">{job.workerAddress || "Not assigned"}</code></dd></div><div><dt>{job.assignmentTxid ? "Agreed reward" : "Offered reward"}</dt><dd><strong>{rewardText(jobReward(job))}</strong></dd></div><div><dt>Confirmed reward payment</dt><dd>{job.status === "paid" ? rewardText(jobReward(job, "paidReward")) : "Not paid"}</dd></div></dl>
      <p className="jobs-prose">{job.scope}</p>
      <dl className="jobs-receipt-links">{[["Brief", job.txid], ["Proposal", job.proposalTxid], ["Assignment", job.assignmentTxid], ["Delivery", job.deliveryTxid], ["Acceptance and direct payment", job.paymentTxid]].map(([label, txid]) => <div key={label}><dt>{label}</dt><dd>{txid ? <><code className="jobs-exact">{txid}</code><TxLink txid={txid} network={network} label="Inspect transaction" /></> : <span className="jobs-muted">Not recorded</span>}</dd></div>)}</dl>
      {job.workSettlement && <div className="jobs-work-settlement"><h4>Confirmed WORK settlement</h4><p className="jobs-muted">The exact assigned WORK transfer is verified against canonical credit replay in the acceptance transaction. The Mail signal and WORK registry fee remain separate.</p><code className="jobs-exact">{job.workSettlement.reward.asset === "WORK" ? `${job.workSettlement.reward.amountSubatoms} subatoms · ${job.workSettlement.reward.token}` : ""}</code><p className="jobs-muted">WORK record output {job.workSettlement.protocolVout} · registry payment output {job.workSettlement.registryVout} · confirmed block {job.workSettlement.blockHeight.toLocaleString()}</p></div>}
      {job.status !== "paid" && <p className="jobs-notice">The offered or agreed reward is an unfunded promise. No funds are held in escrow.</p>}
      <button className="secondary" type="button" onClick={copyLink}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Link copied" : "Copy receipt link"}</button>
    </section>;
  }
  return <div className={`jobs-app${embedded ? " jobs-embedded-app" : ""}`}>
    {!embedded && <AppHeader title="ProofOfWork Jobs" subtitle="Agree. Deliver. Get paid." address={address} network={network} hasUnisat={hasUnisat} busy={actionBusy || readBusy} connectWallet={() => void connect()} disconnectWallet={() => { if (preserveDraft()) setAddress(""); }} onNetworkChange={changeNetwork} onDomainNavigate={() => !preserveDraft()} onRefresh={() => setAttempt(value => value + 1)} onRefreshRecovery={() => void checkReceipts()} />}
    <main className="jobs-workspace" id={embedded ? "jobs-workspace" : "main-content"}>
      <div className="jobs-workspace-heading"><div><span className="jobs-eyebrow"><BriefcaseBusiness size={16} /> PROOFOFWORK JOBS</span><h2>Work worth proving.</h2><p>Public briefs. Agreed scope. Delivered work. Direct payment in proofs or WORK credit.</p></div><button className="primary" type="button" onClick={() => begin("brief")} disabled={actionBusy}><Plus size={16} /> Post a job</button></div>
      {embedded && <div className="jobs-embedded-account"><span>{address ? `Connected · ${shortAddress(address)}` : "Public board · connect to publish or work"}</span><div>{!address && <button className="secondary" type="button" onClick={() => void connect()} disabled={actionBusy}><Wallet size={15} /> Connect UniSat</button>}<button className="secondary" type="button" onClick={() => { setAttempt(value => value + 1); void checkReceipts(); }} disabled={readBusy || actionBusy}><RefreshCw size={15} /> Refresh</button></div></div>}
      <ActionRecoveryPanel receipts={visibleReceipts} error={recoveryError} checking={checking} restoringDisabled={actionBusy} canRestore={item => Boolean(restoreJobsDraft(item.fields))} onRestore={restore} onCheck={() => void checkReceipts()} workspaceHref={() => embedded ? "/?folder=jobs" : "/?jobs=1"} />
      {status && <div className="jobs-notice" role="status"><CheckCircle2 size={17} /><span>{status}</span><button type="button" onClick={() => setStatus("")} aria-label="Dismiss status"><X size={15} /></button></div>}
      {actionError && <p className="jobs-notice is-error" role="alert">{actionError}</p>}
      {network !== "livenet" && <p className="jobs-notice">Jobs uses Mainnet. Switch to Mainnet to read the board or prepare a transaction.</p>}
      {editor ? <section className="jobs-editor" aria-label="Job action editor"><button className="jobs-back" type="button" onClick={() => { if (preserveDraft()) { setEditor(false); setPrepared(undefined); } }} disabled={actionBusy}><ArrowLeft size={16} /> Save draft and back</button><h3>{JOB_ACTION_LABELS[draft.action]}</h3><p className="jobs-muted">Drafts stay in this browser. Signing publishes a public, permanent record through your local wallet.</p>
        <form onSubmit={event => void prepare(event)} aria-busy={actionBusy}>
          {draft.job && <div className="jobs-editor-reference"><span>Job transaction<code className="jobs-exact">{draft.job}</code></span><span>Reviewed confirmed head<code className="jobs-exact">{draft.expectedHead}</code></span></div>}
          {draft.action === "brief" && <label>Job title<input value={draft.title} onChange={event => updateDraft({ title: event.target.value })} disabled={actionBusy} placeholder="What needs to be done?" required /><small>Up to 200 UTF-8 bytes. Use a clear title.</small></label>}
          {["brief", "propose"].includes(draft.action) && <><label>{draft.action === "brief" ? "Brief and acceptance criteria" : "Proposed scope and acceptance criteria"}<textarea value={draft.scope} onChange={event => updateDraft({ scope: event.target.value })} rows={9} disabled={actionBusy} placeholder="Describe the deliverable, evidence required, and what acceptance means." required /></label><label>Reward currency<select value={draft.rewardAsset ?? "proofs"} onChange={event => updateDraft({ rewardAsset: event.target.value as "proofs" | "WORK" })} disabled={actionBusy}><option value="proofs">Proofs</option><option value="WORK">WORK credit</option></select></label><label>{`${draft.action === "brief" ? "Offered" : "Proposed"} reward in ${draft.rewardAsset === "WORK" ? "WORK" : "proofs"}`}<input value={draft.rewardAsset === "WORK" ? draft.rewardWork ?? "" : draft.rewardSats} onChange={event => updateDraft(draft.rewardAsset === "WORK" ? { rewardWork: event.target.value } : { rewardSats: event.target.value })} inputMode={draft.rewardAsset === "WORK" ? "decimal" : "numeric"} pattern={draft.rewardAsset === "WORK" ? "[0-9]+([.][0-9]{1,16})?" : "[0-9]+"} disabled={actionBusy} required /><small>{draft.rewardAsset === "WORK" ? "Exact positive WORK, up to 16 decimal places. WORK transfer fees remain separate." : "Exact whole proofs, at least 546."} This is a promise; no escrow is funded.</small></label></>}
          {draft.action === "assign" && <div className="jobs-agreement"><Handshake size={20} /><h4>Agree to this proposal</h4><code className="jobs-exact">{draft.proposal}</code><p className="jobs-prose">{String(proposal?.metadata.scope ?? "Confirmed scope will be checked during preparation.")}</p><strong>{rewardText(proposal ? jobRewardFromMetadata(proposal.metadata) : null)}</strong><p className="jobs-muted">Assignment freezes this proposal's scope and reward for this worker. You will pay the reward directly when accepting a confirmed delivery.</p></div>}
          {draft.action === "deliver" && <><label>Delivery and supporting evidence<textarea value={draft.text} onChange={event => updateDraft({ text: event.target.value })} rows={9} disabled={actionBusy} placeholder="Explain what you delivered and how it meets the agreed acceptance criteria." required /></label><label>Confirmed transaction references<textarea className="jobs-reference-input" value={draft.artifacts} onChange={event => updateDraft({ artifacts: event.target.value })} rows={3} disabled={actionBusy} placeholder="Optional: up to 16 file, Code, or evidence transaction IDs" /><small>Separate lowercase transaction IDs with spaces, commas or new lines. References are statements; file bytes can be verified independently.</small></label><div className="jobs-upload-row"><label className="jobs-file-upload"><FileUp size={16} /> Attach a delivery file<input type="file" disabled={actionBusy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} /></label><span className="jobs-muted">One file, up to 60,000 bytes. Its bytes are published in the delivery transaction.</span></div>{draft.attachment && <div className="jobs-attached-file"><strong>{draft.attachment.name}</strong><span>{draft.attachment.size.toLocaleString()} bytes</span><code className="jobs-exact">{draft.attachment.sha256}</code><button className="secondary" type="button" disabled={actionBusy} onClick={() => updateDraft({ attachment: undefined })}><X size={15} /> Remove draft attachment</button></div>}</>}
          {draft.action === "accept" && <div className="jobs-agreement"><CheckCircle2 size={21} /><h4>Accept and pay {rewardText(job ? jobReward(job) : null)}</h4><p>The exact agreed reward goes directly to the assigned worker in the same transaction as your acceptance.</p><code className="jobs-exact">{job?.workerAddress}</code><p className="jobs-muted">Accept only after inspecting the delivery. Your signature records your acceptance; the chain does not evaluate the quality of the work.</p></div>}
          {draft.action === "cancel" && <label>Cancellation reason<textarea value={draft.reason} onChange={event => updateDraft({ reason: event.target.value })} rows={4} disabled={actionBusy} required /><small>The requester can cancel any job before its reward is paid. Cancellation records an attestation; it does not resolve disputes.</small></label>}
          <div className="jobs-editor-costs"><FeeRateControl feeRate={draft.feeRate} setFeeRate={value => updateDraft({ feeRate: value })} /><p className="jobs-muted">{draft.action === "accept" ? job && jobReward(job)?.asset === "WORK" ? "Exact agreed WORK reward, plus a separate 546-proof Mail signal, 546-proof WORK registry fee and miner fee. No Jobs registry fee." : "Agreed proof reward plus miner fee. No Jobs registry fee." : draft.action === "brief" || draft.action === "cancel" ? "546 proofs return to your wallet as ordinary Mail signal. The miner fee is spent." : "546 proofs are sent as ordinary Mail to the other participant. The miner fee is additional."}</p></div>
          {draftError && <p className="jobs-notice is-error" role="alert">{draftError}</p>}
          {planResult.error && <p className="jobs-muted" role="status">{planResult.error}</p>}
          {planResult.plan && <p className="jobs-muted">{planResult.plan.carrierBytes.toLocaleString()} / 100,000 on-chain script bytes</p>}
          <div className="jobs-editor-actions"><button className="secondary" type="button" onClick={() => { if (preserveDraft()) setEditor(false); }} disabled={actionBusy}>Save draft and back</button>{address ? <button className="primary" type="submit" disabled={actionBusy || !planResult.plan || Boolean(draftError) || loadedKey !== draftKey || network !== "livenet"}>{actionBusy ? <RefreshCw className="refresh-spin" size={16} /> : <ShieldCheck size={16} />}{actionBusy ? "Preparing…" : "Review transaction"}</button> : <button className="primary" type="button" onClick={() => void connect()} disabled={actionBusy}><Wallet size={16} /> Connect to review</button>}</div>
        </form>
      </section> : <>
        {route.job ? <button className="jobs-back" type="button" onClick={() => navigate({ ...route, job: "" })}><ArrowLeft size={16} /> Back to jobs</button> : <><div className="jobs-board-tools"><div className="jobs-tabs" aria-label="Jobs board"><button type="button" aria-pressed={!route.mine} onClick={() => navigate({ ...route, mine: false })}>Browse jobs</button><button type="button" aria-pressed={route.mine} onClick={() => navigate({ ...route, mine: true })}>My Jobs</button></div><label className="jobs-status-filter">Status<select value={route.status} onChange={event => navigate({ ...route, status: event.target.value })}><option value="">All statuses</option>{JOB_STATUSES.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label></div><form className="jobs-search" onSubmit={event => { event.preventDefault(); navigate({ ...route, q: query.trim() }); }}><label htmlFor="jobs-search-query"><Search size={17} /><span className="sr-only">Search jobs</span><input id="jobs-search-query" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search brief, scope, address or transaction" /></label><button className="secondary" type="submit">Search</button></form></>}
        {list?.stats?.paidProofs !== undefined && list.stats.paidWorkSubatoms !== undefined && <div className="jobs-paid-stats" aria-label="Confirmed Jobs reward payments"><div><span>Confirmed proof rewards paid</span><strong>{proofText(list.stats.paidProofs)} proofs</strong></div><div><span>Confirmed WORK rewards paid</span><strong>{workText(list.stats.paidWorkSubatoms)}</strong></div></div>}
        {list?.versions?.supported?.includes(2) && (!list.stats || list.stats.paidProofs === undefined || list.stats.paidWorkSubatoms === undefined) && <p className="jobs-muted" role="status">Confirmed Jobs reward totals unavailable.</p>}
        {draftPresent && <div className="jobs-saved-draft"><span>Saved local draft · {JOB_ACTION_LABELS[draft.action]}</span><button className="secondary" type="button" onClick={() => { if (preserveDraft()) setEditor(true); }} disabled={actionBusy}>Resume draft</button></div>}
        {readBusy ? <div className="jobs-read-state" role="status"><RefreshCw className="refresh-spin" size={22} /><div><strong>Verifying confirmed Jobs records…</strong><p>Checking complete history at one chain checkpoint.</p></div></div> : readError ? <div className="jobs-read-state is-error" role="alert"><ShieldCheck size={24} /><div><strong>Jobs evidence unavailable</strong><p>{readError}</p><button className="secondary" type="button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={15} /> Retry verified read</button></div></div> : route.mine && !address && !route.job ? <div className="jobs-empty"><Wallet size={26} /><h3>Connect to see My Jobs</h3><p>Your requested, proposed and assigned work will appear after a verified account read.</p><button className="primary" type="button" onClick={() => void connect()}>Connect UniSat</button></div> : list ? <>
          {list.jobs.length ? <div className="jobs-board">{list.jobs.map(item => <article className="jobs-card" key={item.txid}><div className="jobs-card-top"><span className={`jobs-badge is-${item.status}`}>{statusLabel(item.status)}</span><span>{dateText(item.blockTime)}</span></div><button className="jobs-card-title" type="button" onClick={() => navigate({ ...route, job: item.txid })}>{item.title}</button><p>{item.brief}</p><div className="jobs-card-reward"><strong><RewardValue reward={jobReward(item)} /></strong><small>{item.status === "paid" ? "Confirmed reward paid" : item.assignmentTxid ? "Agreed reward · unfunded" : "Offered reward · unfunded"}</small></div><div className="jobs-card-footer"><span title={item.requesterAddress}>Requester · {item.requesterId || shortAddress(item.requesterAddress)}</span><button type="button" onClick={() => navigate({ ...route, job: item.txid })}>View job <ArrowUpRight size={15} /></button></div></article>)}</div> : <div className="jobs-empty"><ClipboardList size={28} /><h3>{route.mine ? "No matching confirmed work" : route.q || route.status ? "No matching confirmed jobs" : "The first job starts here."}</h3><p>{route.mine ? "No requested, proposed or assigned jobs match this account and filter at the verified checkpoint." : route.q || route.status ? "Adjust the search or status to browse more jobs." : "Publish a clear brief and an offered reward. People and agents can propose work and deliver evidence."}</p><button className="primary" type="button" onClick={() => begin("brief")}><Plus size={16} /> Post a job</button></div>}
          {list.pagination.hasMore && <button className="secondary jobs-load-more" type="button" disabled={pageBusy} onClick={() => void loadMore()}>{pageBusy ? "Loading verified jobs…" : "Load more jobs"}</button>}
        </> : detail && job ? <section className="jobs-detail"><div className="jobs-detail-heading"><div><span className={`jobs-badge is-${job.status}`}>{statusLabel(job.status)}</span><h3>{job.title}</h3><p>Requester · {job.requesterId || shortAddress(job.requesterAddress)} · {dateText(job.blockTime)}</p></div><div className="jobs-detail-reward"><strong><RewardValue reward={jobReward(job)} /></strong><small>{job.status === "paid" ? "Confirmed reward paid" : "Reward promise · no escrow"}</small></div></div>
          <div className="jobs-detail-actions">{!address ? <button className="secondary" type="button" onClick={() => void connect()}><Wallet size={15} /> Connect to participate</button> : null}{job.status === "open" && !requester && address && <button className="primary" type="button" disabled={actionDisabled} onClick={() => begin("propose")}><Handshake size={15} /> Propose work</button>}{worker && ["assigned", "delivered"].includes(job.status) && <button className="primary" type="button" disabled={actionDisabled} onClick={() => begin("deliver")}><FileUp size={15} /> Deliver work</button>}{requester && job.status === "delivered" && <button className="primary" type="button" disabled={actionDisabled} onClick={() => begin("accept")}><CheckCircle2 size={15} /> Accept and pay</button>}{requester && ["open", "assigned", "delivered"].includes(job.status) && <button className="secondary" type="button" disabled={actionDisabled} onClick={() => begin("cancel")}>Cancel job</button>}<button className="secondary" type="button" onClick={copyLink}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Link copied" : "Copy job link"}</button></div>
          <div className="jobs-tabs jobs-detail-tabs" aria-label="Job sections">{(["brief", "proposals", "deliveries", "receipt"] as const).map(value => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{value === "brief" ? "Brief" : value === "receipt" ? "Work receipt" : value === "proposals" ? `Proposals (${detail.proposals.length})` : `Deliveries (${detail.deliveries.length})`}</button>)}</div>
          {tab === "brief" && <div className="jobs-detail-body"><h4>{job.assignmentTxid ? "Agreed scope" : "Brief and acceptance criteria"}</h4><p className="jobs-prose">{job.scope}</p>{job.assignmentTxid && (job.scope !== job.brief || JSON.stringify(jobReward(job)) !== JSON.stringify(jobReward(job, "offeredReward"))) && <details><summary>Original published brief</summary><p className="jobs-prose">{job.brief}</p><p className="jobs-muted">Originally offered: {rewardText(jobReward(job, "offeredReward"))}.</p></details>}<dl className="jobs-participants"><div><dt>Requester wallet</dt><dd><code className="jobs-exact">{job.requesterAddress}</code></dd></div>{job.workerAddress && <div><dt>Assigned worker wallet</dt><dd><code className="jobs-exact">{job.workerAddress}</code></dd></div>}</dl><p className="jobs-muted">Roles belong to the confirmed signing addresses. A PowID label does not transfer the agreement to another wallet.</p><TxLink txid={job.txid} network={network} label="Inspect original brief transaction" /></div>}
          {tab === "proposals" && <div className="jobs-detail-body">{detail.proposals.length ? detail.proposals.map(item => <article className="jobs-proposal" key={item.txid}><div><Handshake size={18} /><strong>{shortAddress(item.authorAddress)}</strong><span className="jobs-badge">{job.proposalTxid === item.txid ? "Assigned proposal" : "Confirmed proposal"}</span></div><p className="jobs-prose">{String(item.metadata.scope ?? "")}</p><strong>{rewardText(jobRewardFromMetadata(item.metadata))}</strong><div className="jobs-row-actions"><TxLink txid={item.txid} network={network} />{requester && job.status === "open" && item.valid && item.applied && <button className="primary" type="button" disabled={actionDisabled} onClick={() => begin("assign", item)}>Review assignment</button>}</div></article>) : <div className="jobs-empty"><h4>No confirmed proposals yet</h4><p>Proposals define a worker's scope and reward. Assignment records the requester's agreement.</p></div>}</div>}
          {tab === "deliveries" && <div className="jobs-detail-body">{detail.deliveries.length ? detail.deliveries.map(item => <article className="jobs-delivery" key={item.txid}><div className="jobs-section-heading"><FileCheck2 size={18} /><strong>{job.deliveryTxid === item.txid ? "Latest confirmed delivery" : "Earlier confirmed delivery"}</strong></div><p className="jobs-prose">{String(item.metadata.text ?? "")}</p><TxLink txid={item.txid} network={network} label="Inspect delivery transaction" /><FileEvidence txid={item.txid} network={network} own />{Array.isArray(item.metadata.artifacts) && item.metadata.artifacts.filter((value): value is string => typeof value === "string" && JOB_TXID.test(value)).map(txid => <FileEvidence key={txid} txid={txid} network={network} />)}{requester && job.status === "delivered" && job.deliveryTxid === item.txid && <button className="primary" type="button" disabled={actionDisabled} onClick={() => begin("accept")}>Review acceptance and {rewardText(jobReward(job))} payment</button>}</article>) : <div className="jobs-empty"><h4>No confirmed delivery yet</h4><p>The assigned worker can publish delivery text, a Files attachment, and references to prior confirmed work.</p></div>}</div>}
          {tab === "receipt" && renderReceipt()}
          <details className="jobs-history"><summary>Inspect complete confirmed history ({detail.events.length})</summary>{detail.events.map(item => <div className="jobs-history-event" key={item.txid}><div><strong>{item.action === "invalid" ? "Malformed Jobs evidence" : JOB_ACTION_LABELS[item.action]}</strong><span>{item.applied && item.valid ? "Applied" : "Unapplied evidence"}</span><TxLink txid={item.txid} network={network} /></div><code className="jobs-exact">{item.authorAddress}</code>{item.validationErrors.length > 0 && <p>{item.validationErrors.join(" · ")}</p>}<details><summary>Inspect exact record</summary><pre tabIndex={0}>{JSON.stringify(item.metadata, null, 2)}</pre></details></div>)}</details>
        </section> : null}
        {evidence && <div className="jobs-coverage"><ShieldCheck size={16} /><span>Complete confirmed replay through block {evidence.indexedThroughBlock.toLocaleString()}</span><code title={evidence.indexedThroughBlockHash}>{compact(evidence.indexedThroughBlockHash)}</code><span>Pending records do not establish assignments, delivery or payment.</span></div>}
      </>}
      <p className="jobs-product-note">Humans sign. Agents can prepare and verify. Jobs holds no funds and adds no registry fee.</p>
    </main>
    {!embedded && <SocialFooter />}
    {prepared && <ActionTransactionReview review={prepared.review} returnFocus={returnFocus.current} onCancel={() => { if (!flight.current) setPrepared(undefined); }} onApprove={() => void sign()} />}
  </div>;
}
export const JobsWorkspace = JobsRoot;
