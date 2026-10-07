import { useEffect, useState } from "react";
import { JOBS_ACTIVATION_HEIGHT, JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH } from "../../shared/protocol/jobs.mjs";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";

type JobsObservation = {
  network: BitcoinNetwork; source: string; complete: boolean; activationHeight: number; activationPreviousBlockHash: string;
  indexedThroughBlock: number; indexedThroughBlockHash: string;
  snapshot: { id: string; checkpointHeight: number; checkpointHash: string };
  stats: { jobs: number; open: number; assigned: number; delivered: number; paid: number; cancelled: number;
    proposals: number; deliveries: number; acceptedPayments: number; paidProofs: string; events: number; invalidEvents: number };
};
export default function JobsActivitySummary({ network, refreshing = false }: { network: BitcoinNetwork; refreshing?: boolean }) {
  const [observation, setObservation] = useState<JobsObservation>();
  const [reason, setReason] = useState("Loading confirmed Jobs activity…");
  useEffect(() => {
    const controller = new AbortController();
    setObservation(undefined); setReason(network === "livenet" ? "Loading confirmed Jobs activity…" : "Jobs is available on Mainnet.");
    if (refreshing || network !== "livenet") return () => controller.abort();
    void fetchProofApiJson<JobsObservation>("/api/v1/jobs?limit=1&fresh=1", network, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      const counts = value.stats && [value.stats.jobs, value.stats.open, value.stats.assigned, value.stats.delivered, value.stats.paid,
        value.stats.cancelled, value.stats.proposals, value.stats.deliveries, value.stats.acceptedPayments, value.stats.events, value.stats.invalidEvents];
      if (value.activationHeight !== JOBS_ACTIVATION_HEIGHT || value.activationPreviousBlockHash !== JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH || value.complete !== true || value.source !== "proof-indexer-exact-canonical-jobs-replay" || value.network !== network ||
        !value.snapshot?.id || !Number.isSafeInteger(value.indexedThroughBlock) || value.indexedThroughBlock < JOBS_ACTIVATION_HEIGHT - 1 ||
        !/^[a-f0-9]{64}$/u.test(value.indexedThroughBlockHash) || (value.indexedThroughBlock === JOBS_ACTIVATION_HEIGHT - 1 && value.indexedThroughBlockHash !== JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH) || value.snapshot.checkpointHeight !== value.indexedThroughBlock ||
        value.snapshot.checkpointHash !== value.indexedThroughBlockHash || !counts || counts.some(count => !Number.isSafeInteger(count) || count < 0) ||
        !/^(0|[1-9][0-9]*)$/u.test(value.stats.paidProofs) || value.stats.open + value.stats.assigned + value.stats.delivered + value.stats.paid + value.stats.cancelled !== value.stats.jobs ||
        value.stats.acceptedPayments !== value.stats.paid) throw new Error("Complete confirmed Jobs activity is unavailable.");
      setObservation(value);
    }).catch(error => { if (!controller.signal.aborted) setReason(error instanceof Error ? error.message : "Confirmed Jobs activity is unavailable."); });
    return () => controller.abort();
  }, [network, refreshing]);
  if (!observation) return <p className="field-note" role="status">{reason}</p>;
  return <div className="growth-boost-details" aria-label="Confirmed Jobs activity">
    <p>{observation.stats.jobs.toLocaleString()} jobs · {observation.stats.open.toLocaleString()} open · {observation.stats.paid.toLocaleString()} paid · {BigInt(observation.stats.paidProofs).toLocaleString()} proofs paid</p>
    <p className="field-note">Jobs checkpoint {observation.indexedThroughBlock.toLocaleString()} · {observation.indexedThroughBlockHash.slice(0, 12)}. Offered rewards are commitments; these totals include confirmed accepted payments only.</p>
    <p className="field-note">Jobs records share existing Mail and Files. Their payments and transaction value are counted once; these observations add no second WORK-floor contribution.</p>
  </div>;
}
