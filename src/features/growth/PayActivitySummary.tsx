import { useEffect, useState } from "react";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { formatPayWorkSubatoms } from "../../shared/protocol/pay.mjs";
import { fetchPayInvoices, type PayList } from "../pay/payApi";

export default function PayActivitySummary({ network, refreshing = false }: { network: BitcoinNetwork; refreshing?: boolean }) {
  const [observation, setObservation] = useState<PayList>();
  const [reason, setReason] = useState("Loading confirmed Pay activity…");
  useEffect(() => {
    const controller = new AbortController();
    setObservation(undefined); setReason(network === "livenet" ? "Loading confirmed Pay activity…" : "Pay is available on Mainnet.");
    if (refreshing || network !== "livenet") return () => controller.abort();
    void fetchPayInvoices(network, { fresh: true, signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      const stats = value.stats;
      if (!stats || [stats.invoices, stats.open, stats.paid, stats.cancelled].some(count => !Number.isSafeInteger(count) || Number(count) < 0) ||
        Number(stats.open) + Number(stats.paid) + Number(stats.cancelled) !== stats.invoices ||
        !/^(0|[1-9][0-9]*)$/u.test(stats.paidProofs ?? "") || !/^(0|[1-9][0-9]*)$/u.test(stats.paidWorkSubatoms ?? "")) {
        throw new Error("Complete confirmed Pay observations are unavailable.");
      }
      setObservation(value);
    }).catch(error => { if (!controller.signal.aborted) setReason(error instanceof Error ? error.message : "Confirmed Pay activity is unavailable."); });
    return () => controller.abort();
  }, [network, refreshing]);
  if (!observation) return <p className="field-note" role="status">{reason}</p>;
  const stats = observation.stats!;
  return <div className="growth-boost-details" aria-label="Confirmed Pay activity">
    <p>{stats.invoices!.toLocaleString()} invoices · {stats.open!.toLocaleString()} open · {stats.paid!.toLocaleString()} paid · {BigInt(stats.paidProofs!).toLocaleString()} proofs paid · {formatPayWorkSubatoms(stats.paidWorkSubatoms!)} WORK paid</p>
    <p className="field-note">Pay checkpoint {observation.indexedThroughBlock.toLocaleString()} · {observation.indexedThroughBlockHash.slice(0, 12)}. Requested amounts are not payments. These totals include the first exact confirmed settlement for each invoice.</p>
    <p className="field-note">Pay uses existing Mail and WORK records. Their transaction value and fees enter existing accounting once; these observations add no second usage forecast or WORK-floor contribution. Additional payments remain visible in invoice history.</p>
  </div>;
}
