import { useEffect, useRef, useState } from "react";
import { address as chainAddress } from "bitcoinjs-lib";
import { ReviewDialog } from "../../shared/components/ReviewDialog";
import { FeeRateControl } from "../../shared/components/FeeRateControl";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { assertFeeRatePrecision } from "../../walletUtxos";
import { openPowcatJournal, withPowcatPublisherLock, type PowcatDraft, type PowcatJournal } from "./powcatJournal.mjs";
import { allPartsConfirmed, estimatePublication, linkerOrderInvalid, observe, observeDraft, outpoint, partIds, readSelectedFile,
  sameFile, stageCount, stageLabel, stagePayload, verifyLinker, type Prepared, type PublishWallet, type Seen, type SelectedFile, type Stage } from "./powcatPublish";

type Review = { stage: Stage; plan: Prepared; rate: number };
const format = (value: number) => value.toLocaleString("en-US");

export function PowcatPublisher({address, network, defaultFeeRate, wallet, initialFile, autoOpen = false, onClose, onAttachVerified}: {
  address: string; network: BitcoinNetwork; defaultFeeRate: number; wallet: PublishWallet;
  initialFile?: File; autoOpen?: boolean; onClose?: () => void;
  onAttachVerified?: (link: {txid: string; fileHash: string; name: string}) => void;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [working, setWorking] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<PowcatDraft | null>(null);
  const [last, setLast] = useState<PowcatDraft | null>(null);
  const [seen, setSeen] = useState<Record<string, Seen>>({});
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [rateInput, setRateInput] = useState(String(defaultFeeRate));
  const trigger = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true), inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const identity = draft ?? selected?.identity;
  const count = identity ? stageCount(identity) : 0;
  const rate = Number(rateInput);
  let estimate: number | null = null;
  if (identity && Number.isFinite(rate) && rate >= 0.1) {
    try { estimate = estimatePublication(identity, rate, chainAddress.toOutputScript(address).length, draft); } catch { /* Incomplete rate input. */ }
  }
  const missing = Array.from({length: count}, (_, i) => i).find(i => !draft?.receipts[i]);
  const stage: Stage | undefined = missing ?? (draft && allPartsConfirmed(draft, seen) && !draft.receipts.manifest ? "manifest" : undefined);
  const steps = draft ? Object.entries(draft.receipts) : [];
  const invalidOrder = !!draft && linkerOrderInvalid(draft, seen);

  function assertCurrent() { if (!mounted.current) throw new Error("The active Files workspace changed."); }
  async function run(action: (journal: PowcatJournal) => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setWorking(true); setNotice("");
    try { await action(await openPowcatJournal(network, address)); }
    catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : "This upload step could not be completed."); }
    finally { inFlight.current = false; if (mounted.current) setWorking(false); }
  }
  async function refresh(journal: PowcatJournal) {
    const [active, previous] = await Promise.all([journal.read(), journal.lastPublished()]);
    assertCurrent(); setDraft(active); setLast(previous); setReady(true); setSeen({}); setReview(null);
    if (active) { const states = await observeDraft(active); assertCurrent(); setSeen(states); }
  }
  useEffect(() => {
    if (!autoOpen || network !== "livenet" || !address) return;
    setOpen(true);
    void run(async journal => {
      await refresh(journal);
      if (initialFile) {
        const active = await journal.read();
        const source = await readSelectedFile(initialFile, active?.partSize);
        if (active && !sameFile(active, source.identity)) throw new Error("Finish the saved upload before starting another file.");
        if (!active) {
          const previous = await journal.lastPublished();
          if (previous && sameFile(previous, source.identity)) await journal.begin(source.identity);
        }
        assertCurrent(); setSelected(source); await refresh(journal);
      }
    });
  }, [autoOpen, initialFile, network, address]);
  function close() {
    if (inFlight.current) return;
    setReview(null); setOpen(false); onClose?.();
  }
  function choose(file: File | undefined) {
    if (!file) return;
    void run(async journal => {
      const current = await journal.read();
      const source = await readSelectedFile(file, current?.partSize);
      if (current && !sameFile(current, source.identity)) throw new Error("Select the same file, with its original name and type, to resume this upload.");
      const previous = await journal.lastPublished();
      if (!current && previous && sameFile(previous, source.identity)) await journal.begin(source.identity);
      assertCurrent(); setSelected(source); await refresh(journal);
    });
  }
  async function checkStage(journal: PowcatJournal, index: Stage) {
    if (!identity) throw new Error("Select a file first.");
    const current = await journal.read();
    if ((current && (!sameFile(current, identity) || current.receipts[index])) || (!current && index !== 0)) {
      throw new Error("The saved upload changed. Refresh its progress.");
    }
    if (index === "manifest" && (!current || !allPartsConfirmed(current, await observeDraft(current)))) {
      throw new Error("Every file part must be confirmed before linking. Refresh after confirmation.");
    }
    assertCurrent();
    return current;
  }
  async function prepare(journal: PowcatJournal) {
    if (!identity || stage === undefined || estimate === null) throw new Error("Select a file and a valid miner fee rate.");
    assertFeeRatePrecision(rate);
    const current = await checkStage(journal, stage);
    const payload = stagePayload(identity, stage, selected, current ? partIds(current) : []);
    const plan = await wallet.prepare(payload, address, rate);
    assertCurrent(); setReview({stage, plan, rate});
  }
  async function submit(journal: PowcatJournal) {
    if (!identity || !review) return;
    const {stage: step, plan} = review;
    await withPowcatPublisherLock(network, address, async () => {
      await checkStage(journal, step);
      await wallet.validate(address, plan.funding);
      assertCurrent();
      const signed = await wallet.sign(address, plan);
      // Persist even if the workspace changed while the wallet signature dialog was open.
      await journal.begin(identity);
      const updated = await journal.saveSigned(identity.fileHash, step, signed);
      assertCurrent(); setReview(null); setDraft(updated);
      if (step === "manifest" && !allPartsConfirmed(updated, await observeDraft({...updated, receipts: Object.fromEntries(Object.entries(updated.receipts).filter(([k]) => k !== "manifest"))}))) {
        throw new Error("A part lost confirmation. The signed linker was saved. Wait for all parts before broadcasting.");
      }
      await wallet.validate(address, plan.funding, signed.txid);
      assertCurrent();
      if (await wallet.broadcast(signed.hex) !== signed.txid) throw new Error("Node receipt differs from the saved transaction.");
      assertCurrent(); setNotice(`${stageLabel(step)} submitted. Refresh to check confirmation.`);
    });
  }
  async function replay(journal: PowcatJournal, step: Stage) {
    await withPowcatPublisherLock(network, address, async () => {
      const current = await journal.read();
      const receipt = current?.receipts[step];
      if (!current || !receipt || !draft || !sameFile(current, draft) || receipt.txid !== draft.receipts[step]?.txid) throw new Error("Upload recovery changed. Refresh to continue.");
      if ((await observe(receipt.txid)).status !== "dropped") throw new Error("The node has not proven this transaction absent.");
      if (step === "manifest" && !allPartsConfirmed(current, await observeDraft(current))) throw new Error("All file parts must reconfirm before rebroadcasting the saved linker.");
      const hex = await journal.raw(current.fileHash, step);
      if (!hex) throw new Error("Exact signed recovery bytes are unavailable.");
      await wallet.validate(address, receipt.outpoints.map(input => { const [txid, vout] = input.split(":"); return {txid, vout: Number(vout)}; }), receipt.txid);
      assertCurrent();
      if (await wallet.broadcast(hex) !== receipt.txid) throw new Error("Node receipt differs from the saved transaction.");
      await refresh(journal);
      setNotice("The exact saved transaction was submitted again.");
    });
  }
  async function complete(journal: PowcatJournal) {
    await withPowcatPublisherLock(network, address, async () => {
      const current = await journal.read();
      if (!current?.receipts.manifest || current.receipts.manifest.txid !== draft?.receipts.manifest?.txid) throw new Error("Refresh publication progress.");
      await verifyLinker(current); assertCurrent();
      await journal.finish(current.fileHash); setSelected(null);
      await refresh(journal); setNotice("File verified. Copy the linker TXID to attach it in Mail.");
    });
  }
  async function repairOrder(journal: PowcatJournal) {
    await withPowcatPublisherLock(network, address, async () => {
      const current = await journal.read();
      if (!current?.receipts.manifest || current.receipts.manifest.txid !== draft?.receipts.manifest?.txid ||
          !linkerOrderInvalid(current, await observeDraft(current))) throw new Error("The changed confirmation order could not be verified.");
      assertCurrent(); await journal.supersedeLinker(current.fileHash, current.receipts.manifest.txid);
      await refresh(journal); setNotice("All parts can be reused. Review a new linker and use its new TXID for delivery.");
    });
  }
  const published = last?.receipts.manifest;
  return <>
    {!autoOpen && <button className="secondary small" ref={trigger} type="button" disabled={!address || network !== "livenet"}
      title={network !== "livenet" ? "Linked file publishing requires Mainnet" : "Publish a linked file on Mainnet"}
      onClick={() => { setOpen(true); setReady(false); void run(refresh); }}>Publish linked file</button>}
    {open && <ReviewDialog title="Publish linked file" closeLabel="Close" returnFocus={trigger.current} onCancel={close}>
      <p>Mainnet · Up to 4,000,000 bytes. File parts are public as soon as they are broadcast. One final linker identifies the complete file.</p>
      <p>Wallet <code className="review-exact">{address}</code></p>
      <label>{draft ? "Reselect original file to resume" : selected ? "Change selected file" : "File to publish"} <input type="file" disabled={!ready || working || !!review} onChange={e => choose(e.target.files?.[0])} /></label>
      {identity && <>
        <dl className="review-fields">
          <div><dt>File</dt><dd className="review-exact">{identity.name} · {identity.mime} · {format(identity.size)} bytes</dd></div>
          <div><dt>SHA-256</dt><dd><code className="review-exact">{identity.fileHash}</code></dd></div>
          <div><dt>Publication</dt><dd>{count} part{count === 1 ? "" : "s"} and 1 linker. Each transaction needs confirmed funding and a local signature.</dd></div>
          <div><dt>Estimated total miner fees</dt><dd>{estimate === null ? "Enter a valid fee rate" : `${format(estimate)} proofs`}. Assumes one input and one change output per unsigned transaction. Mail delivery is separate.</dd></div>
        </dl>
        <FeeRateControl feeRate={rate} disabled={working || !!review} inputValue={rateInput} setInputValue={setRateInput} setFeeRate={v => setRateInput(String(v))} />
      </>}
      {steps.length > 0 && <details><summary>Saved transactions ({steps.length})</summary><ol className="review-list">{steps.map(([key, receipt]) => {
        const step = key === "manifest" ? "manifest" : Number(key);
        return <li key={key}><strong>{stageLabel(step)}</strong><code className="review-exact">{receipt.txid}</code>
          <span>{seen[key]?.status ?? "Awaiting verification"} · {format(receipt.fee)} proofs miner fee</span>
          {seen[key]?.status === "dropped" && <button type="button" className="secondary" disabled={working || !!review} onClick={() => void run(j => replay(j, step))}>Rebroadcast saved {stageLabel(step).toLowerCase()}</button>}
        </li>;
      })}</ol></details>}
      {draft && !review && stage === undefined && !draft.receipts.manifest && <p>Wait for all {count} parts to confirm, then refresh to prepare the linker.</p>}
      {review && <>
        <h3>Review {stageLabel(review.stage).toLowerCase()}</h3>
        <dl className="review-fields">
          <div><dt>Destination</dt><dd>Zero-proof on-chain file record. Change of {format(review.plan.change)} proofs returns to <code className="review-exact">{address}</code>.</dd></div>
          <div><dt>Exact miner fee</dt><dd>{format(review.plan.fee)} proofs, including {format(review.plan.extraFee)} proofs of below-dust change. {format(review.plan.estimatedVbytes)} estimated vB at {review.rate} selected proofs/vB.</dd></div>
          <div><dt>Funding</dt><dd>{review.plan.funding.map(u => <div key={outpoint(u)}><code className="review-exact">{outpoint(u)}</code> · {format(u.value)} proofs</div>)}</dd></div>
        </dl>
        <button className="secondary" type="button" disabled={working} onClick={() => setReview(null)}>Back</button>{" "}
        <button className="primary" type="button" disabled={working} onClick={() => void run(submit)}>Sign and broadcast {stageLabel(review.stage).toLowerCase()}</button>
      </>}
      {!review && <div className="review-actions">
        <button className="secondary" type="button" disabled={working} onClick={() => void run(refresh)}>Refresh progress</button>
        {stage !== undefined && <button className="primary" type="button" disabled={working || !ready || estimate === null || (typeof stage === "number" && !selected)} onClick={() => void run(prepare)}>Review {stageLabel(stage).toLowerCase()}</button>}
        {draft?.receipts.manifest && !invalidOrder && <button className="primary" type="button" disabled={working} onClick={() => void run(complete)}>Verify completed file</button>}
        {invalidOrder && <button className="secondary" type="button" disabled={working} onClick={() => void run(repairOrder)}>Prepare a new linker after reorg</button>}
      </div>}
      {last && published && <><h3>Last verified publication</h3><p>{last.name}</p><code className="review-exact">{published.txid}</code>
        <div className="review-actions"><button type="button" className="secondary" disabled={working} onClick={() => { void navigator.clipboard.writeText(published.txid).then(() => setNotice("Linker TXID copied.")).catch(() => setNotice("Select and copy the linker TXID above.")); }}>Copy linker TXID</button>
        {onAttachVerified && <button type="button" className="primary" disabled={working} onClick={() => void run(async () => {
          await verifyLinker(last); assertCurrent(); setReview(null); setOpen(false);
          onAttachVerified({txid: published.txid, fileHash: last.fileHash, name: last.name}); onClose?.();
        })}>Attach in Mail</button>}
        {!draft && <button className="secondary" type="button" disabled={working} onClick={() => void run(async j => { await j.begin(last); setSelected(null); await refresh(j); })}>Recheck publication</button>}</div></>}
      <p role="status" aria-live="polite">{working ? "Checking publication progress…" : notice}</p>
    </ReviewDialog>}
  </>;
}
