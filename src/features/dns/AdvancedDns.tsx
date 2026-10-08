import { useEffect, useRef, useState, type ReactNode } from "react";
import { parseDnsSubdomainName } from "../../shared/protocol/dnsSubdomains.mjs";
import { readDnsPageLinkSnapshot } from "../pages/dnsPageLinkClient.mjs";
import { readDnsSubdomainPageLinkSnapshot } from "../pages/dnsSubdomainPageLinkClient.mjs";
import type { PagesDnsLinkRequest } from "../pages/PagesWorkspace";
import "./advancedDns.css";

type Row = Record<string, any>;
type Props = {
  address: string; network: string; busy: boolean;
  roots: { id: string; ownerAddress: string; confirmed: boolean; network: string }[];
  load: (name: string, signal?: AbortSignal) => Promise<unknown>;
  submit: (request: PagesDnsLinkRequest) => Promise<void>;
  validateAddress: (address: string) => boolean;
  browserHref: (name: string) => string; transactionHref: (txid: string) => string;
  feeControl: ReactNode; refreshNonce: number;
  restore?: { nonce: number; name: string; pageTxid: string | null };
};

// Pages and DNS use the same verified chain records. Local preferences and a
// successful broadcast never establish a confirmed content link.
export function AdvancedDns({ address, network, busy, roots, load, submit, validateAddress,
  browserHref, transactionHref, feeControl, refreshNonce, restore }: Props) {
  const owned = roots.filter(root => root.confirmed && root.network === network && root.ownerAddress === address);
  const [name, setName] = useState("");
  const [pageTxid, setPageTxid] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Row>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);
  const queryLabels = query.trim().toLowerCase().replace(/\.pow$/u, "").split(".");
  const rootName = queryLabels[queryLabels.length - 1] ?? "";
  useEffect(() => {
    generation.current += 1; setData(undefined); setQuery(""); setName(""); setPageTxid(""); setError(""); setNotice(""); setLoading(false);
  }, [address, network]);
  useEffect(() => {
    if (!query && owned[0]) { setQuery(owned[0].id); setName(owned[0].id + ".pow"); }
  }, [query, owned.map(root => root.id).join(":")]);
  useEffect(() => {
    if (!restore) return;
    setName(restore.name); setPageTxid(restore.pageTxid ?? ""); setQuery(restore.name);
    setNotice("Restored for review. Current ownership and content will be verified again.");
  }, [restore?.nonce]);
  useEffect(() => {
    if (!rootName || network !== "livenet") return;
    const request = ++generation.current, controller = new AbortController();
    setLoading(true); setError(""); setData(undefined);
    void load(rootName, controller.signal).then(value => {
      if (request !== generation.current || controller.signal.aborted) return;
      const payload = value as Row;
      if (payload?.network !== network || payload?.id !== rootName || payload?.coverage?.complete !== true) {
        throw new Error("Current verified DNS ownership coverage is unavailable.");
      }
      setData(payload);
    }).catch(error => {
      if (request === generation.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : "DNS records are unavailable.");
    }).finally(() => { if (request === generation.current) setLoading(false); });
    return () => { controller.abort(); generation.current += 1; };
  }, [rootName, network, address, refreshNonce, nonce, load]);

  const childName = parseDnsSubdomainName(name);
  function verifiedName(value: string) {
    if (!data) return undefined;
    const query = parseDnsSubdomainName(value);
    if (!query) return readDnsPageLinkSnapshot(data, value, { network, validateAddress });
    const child = data.subdomains?.find((row: Row) => row.name === query.name) ?? null;
    const link = child?.subdomainPageLink ?? null;
    const exact = { ...data, id: query.label + "." + query.parent, name: query.name,
      parentRecord: data.record, record: child, records: child ? [child] : [], subdomains: child ? [child] : [],
      routable: Boolean(child), status: child ? "confirmed" : "available", pageLink: link, subdomainPageLink: link,
      subdomainEvents: data.subdomainEvents?.filter((row: Row) => row.name === query.name),
      subdomainPageLinkEvents: data.subdomainPageLinkEvents?.filter((row: Row) => row.name === query.name),
      subdomainPageLinkPendingEvents: data.subdomainPageLinkPendingEvents?.filter((row: Row) => row.name === query.name) };
    return readDnsSubdomainPageLinkSnapshot(exact, value, { network, validateAddress });
  }
  let snapshot: ReturnType<typeof readDnsPageLinkSnapshot> | ReturnType<typeof readDnsSubdomainPageLinkSnapshot> | undefined;
  let verification = "";
  if (data) {
    try {
      if (name.trim()) snapshot = verifiedName(name);
    } catch (error) { verification = error instanceof Error ? error.message : "Page-link verification is unavailable."; }
  }
  const canEdit = Boolean(snapshot && snapshot.root.ownerAddress === address && address && !busy && !loading);
  const names = [data?.name, ...(data?.subdomains ?? []).map((row: Row) => row.name)].filter(Boolean) as string[];
  const pending = childName ? data?.subdomainPageLinkPendingEvents : data?.pageLinkPendingEvents;
  const events = childName ? data?.subdomainPageLinkEvents : data?.pageLinkEvents;
  async function review(clear: boolean) {
    if (!canEdit) return;
    setNotice(""); setError("");
    try {
      await submit({ name, pageTxid: clear ? null : pageTxid.trim().toLowerCase() });
      setNotice("Broadcast submitted. The link remains pending until confirmed."); setNonce(value => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not prepare the page link."); }
  }
  return <section className="dns-advanced" aria-label="Advanced DNS">
    <div className="dns-advanced-head"><div><span>ProofOfWork DNS</span><h2>Advanced DNS</h2><p>Connect domains and active subdomains to confirmed Pages transactions.</p></div><button type="button" className="secondary" disabled={loading || !rootName} onClick={() => setNonce(value => value + 1)}>{loading ? "Verifying…" : "Refresh links"}</button></div>
    <form className="dns-advanced-search" onSubmit={event => { event.preventDefault(); setQuery(name); setNonce(value => value + 1); }}>
      <label>DNS name<input value={name} list="advanced-dns-names" autoComplete="off" spellCheck={false} placeholder="alice.pow or app.alice.pow" onChange={event => setName(event.target.value)} /></label>
      <datalist id="advanced-dns-names">{[...new Set([...owned.map(root => root.id + ".pow"), ...names])].map(value => <option key={value} value={value} />)}</datalist>
      <button type="submit" className="secondary" disabled={loading || !name.trim()}>Inspect name</button>
    </form>
    {error ? <p role="alert" className="dns-advanced-error">{error}</p> : null}
    {verification ? <p role="status" className="dns-advanced-error">{verification}</p> : null}
    {data ? <div className="dns-advanced-table"><table><thead><tr><th>Name</th><th>Page transaction</th><th>Status</th><th>Open</th></tr></thead><tbody>{names.map(value => {
      let verified;
      try { verified = verifiedName(value); } catch { /* Coverage failures remain visibly unavailable. */ }
      const ready = Boolean(verified), link = verified?.pageLink;
      return <tr key={value}><td><button type="button" className="dns-advanced-name" onClick={() => { setName(value); setPageTxid(link?.pageTxid ?? ""); }}>{value}</button></td><td>{ready && link ? <a href={transactionHref(link.pageTxid)} target="_blank" rel="noreferrer"><code>{link.pageTxid}</code></a> : "—"}</td><td>{ready ? link ? "Confirmed" : "No page link" : "Verification unavailable"}</td><td>{ready && link ? <a href={browserHref(value)} target="_blank" rel="noreferrer">Browser ↗</a> : "—"}</td></tr>;
    })}</tbody></table></div> : null}
    {snapshot ? <p>Current confirmed link: {snapshot.pageLink ? <a href={transactionHref(snapshot.pageLink.pageTxid)} target="_blank" rel="noreferrer"><code>{snapshot.pageLink.pageTxid}</code></a> : "None"}. Verified through block {snapshot.indexedThroughBlock.toLocaleString()}.</p> : null}
    <form className="dns-advanced-link" onSubmit={event => { event.preventDefault(); void review(false); }}>
      <label>Published page txid<input value={pageTxid} autoComplete="off" spellCheck={false} placeholder="64 character confirmed HTML txid" onChange={event => setPageTxid(event.target.value)} /></label>
      {feeControl}<div className="dns-advanced-actions"><button type="submit" className="primary" disabled={!canEdit || !/^[a-f0-9]{64}$/iu.test(pageTxid.trim())}>Review page link</button><button type="button" className="secondary" disabled={!canEdit || !snapshot?.pageLink} onClick={() => void review(true)}>Review clear link</button></div>
      <small>Only the confirmed root owner can set or clear links. Review the 546-proof owner self-payment and miner fee in your local wallet. Pending links never route.</small>
    </form>
    {notice ? <p role="status">{notice}</p> : null}
    {(pending?.length || events?.length) ? <details><summary>Link history and pending actions</summary><ul>{[...(pending ?? []), ...(events ?? [])].filter((row: Row) => !name || row.name === name.toLowerCase()).map((row: Row) => <li key={row.txid + ":" + row.protocolVout + ":" + row.recordOrdinal}><a href={transactionHref(row.txid)} target="_blank" rel="noreferrer">{row.action ?? row.record?.action ?? "Action"}</a> · {row.confirmed ? row.valid ? "Confirmed" : "Rejected" : "Pending"}{row.reason ? " · " + row.reason : ""}</li>)}</ul></details> : null}
  </section>;
}
