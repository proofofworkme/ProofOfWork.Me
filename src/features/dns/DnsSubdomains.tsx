import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
  dnsSubdomainLabelError,
  dnsSubdomainAddressIdentity,
  normalizeDnsSubdomainLabel,
  parseDnsSubdomainName,
} from "../../shared/protocol/dnsSubdomains.mjs";

export type DnsOwnershipEpoch = { txid: string; protocolVout: number; recordOrdinal: number };
export type DnsSubdomainDraft = { parent: string; label: string; action: "create" | "update" | "revoke"; resolver: string };
export type DnsSubdomainRoot = {
  id: string; ownerAddress: string; receiveAddress: string; confirmed: boolean;
  ownershipEpoch?: DnsOwnershipEpoch; network?: string;
};
export type DnsSubdomainRecord = {
  name: string; parent: string; label: string; epoch: DnsOwnershipEpoch;
  ownerAddress: string; receiveAddress: string; resolver: string | null;
  confirmed: boolean; active: boolean; txid: string; updatedTxid?: string;
};
export type DnsSubdomainEvent = {
  name?: string; parent?: string; label?: string; action?: string; kind?: string;
  txid: string; confirmed?: boolean; valid?: boolean; active?: boolean;
  status?: string; reason?: string; epoch?: DnsOwnershipEpoch;
};
export type DnsSubdomainSnapshot = {
  parent: DnsSubdomainRoot | null; record: DnsSubdomainRecord | null;
  subdomains: DnsSubdomainRecord[]; history: DnsSubdomainEvent[];
  pending: DnsSubdomainEvent[]; status: string; complete: boolean;
  admission: { ready: boolean; reason: string };
};

export function validDnsOwnershipEpoch(value: unknown): value is DnsOwnershipEpoch {
  const epoch = value as DnsOwnershipEpoch | null;
  return Boolean(epoch && /^[a-f0-9]{64}$/u.test(epoch.txid) &&
    Number.isSafeInteger(epoch.protocolVout) && epoch.protocolVout >= 0 &&
    Number.isSafeInteger(epoch.recordOrdinal) && epoch.recordOrdinal >= 0);
}
export function sameDnsOwnershipEpoch(left: DnsOwnershipEpoch | undefined, right: DnsOwnershipEpoch | undefined) {
  return Boolean(validDnsOwnershipEpoch(left) && validDnsOwnershipEpoch(right) &&
    left!.txid === right!.txid && left!.protocolVout === right!.protocolVout && left!.recordOrdinal === right!.recordOrdinal);
}

// A missing collection/coverage marker is unavailable evidence, never an empty registry.
export function readDnsSubdomainSnapshot(payload: unknown, query: string, options?: { network: string; validateAddress: (address: string) => boolean }): DnsSubdomainSnapshot {
  const data = payload as Record<string, any> | null;
  const child = parseDnsSubdomainName(query);
  if (!data || (options && data.network !== options.network) || data.coverage?.complete !== true || data.subdomainCoverage?.complete !== true ||
    !Number.isSafeInteger(data.indexedThroughBlock) || data.indexedThroughBlock < 0 ||
    !/^[a-f0-9]{64}$/u.test(data.checkpointHash ?? "") ||
    !Array.isArray(data.subdomainEvents) || !Array.isArray(data.pendingEvents) ||
    (!child && !Array.isArray(data.subdomains))) {
    throw new Error(data?.subdomainAdmission?.ready === false && typeof data.subdomainAdmission.reason === "string"
      ? `${data.subdomainAdmission.reason} Subdomain history is not yet verified.`
      : "Subdomain history is unavailable or its chain coverage is incomplete. Refresh before drawing conclusions.");
  }
  const parent = child ? data.parentRecord : data.record;
  const expectedParent = child?.parent ?? query.replace(/\.pow$/u, "");
  if (parent && (parent.id !== expectedParent || parent.confirmed !== true ||
    typeof parent.ownerAddress !== "string" || typeof parent.receiveAddress !== "string" ||
    (options && (!options.validateAddress(parent.ownerAddress) || !options.validateAddress(parent.receiveAddress))) ||
    !validDnsOwnershipEpoch(parent.ownershipEpoch))) {
    throw new Error("The parent ownership evidence does not match this DNS lookup.");
  }
  const records: DnsSubdomainRecord[] = child ? data.record ? [data.record] : [] : data.subdomains;
  if (records.some(record => !parent || record.parent !== expectedParent ||
    record.name !== `${record.label}.${expectedParent}.pow` || (child && record.name !== child.name) || dnsSubdomainLabelError(record.label) ||
    record.confirmed !== true || record.active !== true ||
    dnsSubdomainAddressIdentity(record.ownerAddress) !== dnsSubdomainAddressIdentity(parent.ownerAddress) || !sameDnsOwnershipEpoch(record.epoch, parent.ownershipEpoch) ||
    typeof record.receiveAddress !== "string" || !record.receiveAddress ||
    (record.resolver !== null && (typeof record.resolver !== "string" || (options && !options.validateAddress(record.resolver)))) ||
    (options && !options.validateAddress(record.receiveAddress)) ||
    dnsSubdomainAddressIdentity(record.receiveAddress) !== dnsSubdomainAddressIdentity(record.resolver ?? parent.receiveAddress) ||
    !/^[a-f0-9]{64}$/u.test(record.updatedTxid ?? record.txid))) {
    throw new Error("The current subdomain records do not match the confirmed parent ownership period.");
  }
  return {
    parent: parent ?? null, record: child ? records[0] ?? null : null,
    subdomains: records, history: data.subdomainEvents,
    pending: (child ? data.pendingEvents : Array.isArray(data.subdomainPendingEvents) ? data.subdomainPendingEvents : []).filter((event: DnsSubdomainEvent) => event.name || event.kind?.startsWith("dns-subdomain") || ["create", "update", "revoke"].includes(event.action ?? "")),
    status: typeof data.status === "string" ? data.status : "unavailable", complete: true,
    admission: { ready: data.subdomainAdmission?.ready === true,
      reason: typeof data.subdomainAdmission?.reason === "string" ? data.subdomainAdmission.reason : "Subdomain writes are unavailable until activation and complete current chain coverage are verified." },
  };
}

export function assertDnsSubdomainAction(snapshot: DnsSubdomainSnapshot, draft: DnsSubdomainDraft, address: string, expectedEpoch?: DnsOwnershipEpoch) {
  if (!snapshot.complete || !snapshot.admission.ready) throw new Error(snapshot.admission.reason);
  const parent = snapshot.parent;
  if (!parent?.confirmed || parent.id !== draft.parent || dnsSubdomainAddressIdentity(parent.ownerAddress) !== dnsSubdomainAddressIdentity(address) || !validDnsOwnershipEpoch(parent.ownershipEpoch)) {
    throw new Error("Only the current confirmed parent owner can publish subdomains. Refresh ownership before trying again.");
  }
  if (expectedEpoch && !sameDnsOwnershipEpoch(parent.ownershipEpoch, expectedEpoch)) {
    throw new Error("The parent ownership period changed. Prepare and review a new transaction.");
  }
  const label = normalizeDnsSubdomainLabel(draft.label);
  const labelError = dnsSubdomainLabelError(label);
  if (labelError) throw new Error(labelError);
  const active = snapshot.subdomains.find(record => record.label === label);
  if ((draft.action === "create" && active) || (draft.action !== "create" && !active)) {
    throw new Error(draft.action === "create" ? "This subdomain is already active. Choose update or revoke." : "This subdomain is no longer active. Refresh before choosing an action.");
  }
  if (snapshot.pending.some(event => event.name === `${label}.${draft.parent}.pow` || event.label === label)) {
    throw new Error("A subdomain action is already pending. Wait for confirmation or dropping before another action.");
  }
  return { parent, active };
}

type Props = {
  address: string; network: string; busy: boolean; registryReady: boolean;
  roots: DnsSubdomainRoot[]; draft: DnsSubdomainDraft; setDraft: (draft: DnsSubdomainDraft) => void;
  load: (query: string, signal?: AbortSignal) => Promise<DnsSubdomainSnapshot>;
  submit: (draft: DnsSubdomainDraft) => Promise<boolean>;
  validateAddress: (address: string) => boolean; feeControl: ReactNode;
  transactionUrl: (txid: string) => string; refreshNonce: number;
};

export function DnsSubdomains({ address, network, busy, registryReady, roots, draft, setDraft, load, submit, validateAddress, feeControl, transactionUrl, refreshNonce }: Props) {
  const owned = roots.filter(root => root.confirmed && dnsSubdomainAddressIdentity(root.ownerAddress) === dnsSubdomainAddressIdentity(address) && root.network === network);
  const selected = draft.parent ? owned.find(root => root.id === draft.parent) : owned[0];
  const parent = selected?.id ?? "";
  const [ownerState, setOwnerState] = useState<DnsSubdomainSnapshot>();
  const [ownerError, setOwnerError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<DnsSubdomainSnapshot>();
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const searchController = useRef<AbortController>();
  const readIdentity = `${network}:${address}:${parent}`;
  const acceptedIdentity = useRef("");
  useEffect(() => {
    const controller = new AbortController();
    setOwnerState(undefined); setOwnerError(""); acceptedIdentity.current = "";
    if (!parent || !registryReady) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    load(parent, controller.signal).then(state => {
      if (!controller.signal.aborted) { acceptedIdentity.current = readIdentity; setOwnerState(state); }
    }).catch(error => { if (!controller.signal.aborted) setOwnerError(error instanceof Error ? error.message : "Subdomains are unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load, parent, readIdentity, registryReady, revision, refreshNonce]);
  useEffect(() => { searchController.current?.abort(); setResult(undefined); setSearchError(""); setSearching(false); }, [network]);
  useEffect(() => () => searchController.current?.abort(), []);
  const current = acceptedIdentity.current === readIdentity ? ownerState : undefined;
  const effectiveDraft = { ...draft, parent };
  let disabledReason = !address ? "Connect the parent owner wallet to manage subdomains." : !registryReady ? "A current verified DNS registry is required." : !parent ? owned.length ? "Choose a currently owned parent .pow name." : "This wallet has no confirmed .pow roots to manage." : loading || !current ? ownerError || "Verifying parent ownership and subdomain history…" : "";
  if (!disabledReason && current) {
    try { assertDnsSubdomainAction(current, effectiveDraft, address); }
    catch (error) { disabledReason = error instanceof Error ? error.message : "Subdomain action unavailable."; }
  }
  if (!disabledReason && draft.action !== "revoke" && draft.resolver.trim() && !validateAddress(draft.resolver.trim())) disabledReason = "Enter a valid resolver address or leave it empty to inherit.";
  async function search(event: FormEvent) {
    event.preventDefault(); searchController.current?.abort(); setResult(undefined); setSearchError("");
    const name = parseDnsSubdomainName(query);
    if (!name) { setSearchError("Enter one child label and one parent, such as abc.alice.pow."); return; }
    const controller = new AbortController(); searchController.current = controller; setSearching(true);
    try { const state = await load(name.name, controller.signal); if (!controller.signal.aborted) setResult(state); }
    catch (error) { if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : "Subdomain lookup unavailable."); }
    finally { if (!controller.signal.aborted) setSearching(false); }
  }
  function history(events: DnsSubdomainEvent[]) {
    return events.length ? <details><summary>Inspect subdomain history ({events.length})</summary>
      <ul>{events.map((event, index) => <li key={`${event.txid}:${index}`}>
        <span>{event.name ?? `${event.label}.${event.parent}.pow`} · {event.action ?? event.kind} · {event.confirmed ? event.valid === false ? "Confirmed invalid record" : "Confirmed history" : "Pending preview"}{event.reason ? ` · ${event.reason}` : ""}</span>{" "}
        <a href={transactionUrl(event.txid)} rel="noreferrer" target="_blank">View TX</a>
        {event.epoch ? <code className="review-exact">Ownership period: {event.epoch.txid}:{event.epoch.protocolVout}:{event.epoch.recordOrdinal}</code> : null}
      </li>)}</ul></details> : <p className="field-note">No subdomain history in this verified lookup.</p>;
  }
  return <section className="id-card id-launch-card" id="dns-subdomains" aria-labelledby="dns-subdomains-title">
    <div className="id-card-head"><div><h3 id="dns-subdomains-title">Subdomains</h3>
      <p>The confirmed parent owner publishes subdomains with a 546-proof self-payment plus miner fee. A confirmed parent transfer or purchase invalidates earlier subdomains.</p></div></div>
    <form onSubmit={event => { event.preventDefault(); if (!disabledReason && !busy) void submit(effectiveDraft).then(sent => { if (sent) setRevision(value => value + 1); }); }} aria-label="Manage DNS subdomains">
      {owned.length ? <label>Parent .pow name<select disabled={busy} value={parent} onChange={event => setDraft({ ...draft, parent: event.target.value })}>{!parent ? <option value="">Choose parent .pow</option> : null}{owned.map(root => <option key={root.id} value={root.id}>{root.id}.pow</option>)}</select></label> : null}
      <div className="compose-grid"><label>Subdomain label<input disabled={busy} autoComplete="off" spellCheck={false} placeholder="abc" value={draft.label} onChange={event => setDraft({ ...draft, parent, label: event.target.value })} /></label>
        <label>Subdomain action<select disabled={busy} value={draft.action} onChange={event => setDraft({ ...draft, parent, action: event.target.value as DnsSubdomainDraft["action"] })}><option value="create">Create</option><option value="update">Update resolver</option><option value="revoke">Revoke</option></select></label></div>
      <p className="field-note">{normalizeDnsSubdomainLabel(draft.label) || "abc"}.{parent || "alice"}.pow</p>
      {draft.action !== "revoke" ? <label>Resolver override (optional)<input disabled={busy} autoComplete="off" spellCheck={false} placeholder="Leave empty to inherit the parent resolver" value={draft.resolver} onChange={event => setDraft({ ...draft, parent, resolver: event.target.value })} /></label> : null}
      {current?.parent ? <p className="field-note">Parent resolver: <code className="review-exact">{current.parent.receiveAddress}</code> Inherited subdomains follow the current parent resolver.</p> : null}
      {feeControl}
      {disabledReason ? <p role="status" className="field-note">{disabledReason}</p> : null}
      <div className="id-record-actions"><button className="primary" type="submit" disabled={busy || Boolean(disabledReason)}>{busy ? "Preparing subdomain…" : "Review subdomain transaction"}</button><button type="button" className="secondary" disabled={busy || loading || !parent} onClick={() => setRevision(value => value + 1)}>Refresh subdomains</button></div>
    </form>
    {current ? <><h4>Active subdomains</h4>{current.subdomains.length ? <ul>{current.subdomains.map(record => <li key={record.name}><strong>{record.name}</strong><code className="review-exact">{record.receiveAddress}</code><span>{record.resolver === null ? "Inherits parent resolver" : "Resolver override"}</span>{" "}<a href={transactionUrl(record.updatedTxid ?? record.txid)} rel="noreferrer" target="_blank">View TX</a></li>)}</ul> : <p className="field-note">No active subdomains in this confirmed ownership period.</p>}{history(current.history)}{current.pending.length ? <p role="status" className="field-note">{current.pending.length} pending subdomain action(s). Pending records do not resolve.</p> : null}</> : null}
    <h4>Public subdomain lookup</h4><form onSubmit={search} aria-label="Search DNS subdomains"><label>Full subdomain name<input autoComplete="off" spellCheck={false} placeholder="abc.alice.pow" value={query} onChange={event => { searchController.current?.abort(); setSearching(false); setResult(undefined); setSearchError(""); setQuery(event.target.value); }} /></label><button type="submit" className="secondary" disabled={searching}>{searching ? "Verifying subdomain…" : "Find subdomain"}</button></form>
    {searchError ? <p role="status" className="field-note">{searchError}</p> : null}
    {result ? <div role="status"><p>{result.record ? `${result.record.name} is active and confirmed.` : `No active confirmed subdomain for this name (${result.status}).`}</p>{result.record ? <><code className="review-exact">{result.record.receiveAddress}</code><p className="field-note">{result.record.resolver === null ? "Inherits the current parent resolver." : "Uses the owner-authorized resolver override."}</p></> : null}{result.pending.length ? <p>Pending previews do not resolve.</p> : null}{history(result.history)}</div> : null}
  </section>;
}
