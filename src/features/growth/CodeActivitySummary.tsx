import { useEffect, useState } from "react";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";

type CodeObservation = {
  network: BitcoinNetwork;
  source: string;
  complete: boolean;
  indexedThroughBlock: number;
  indexedThroughBlockHash: string;
  snapshot: { id: string; checkpointHeight: number; checkpointHash: string };
  stats: { repositories: number; acceptedCommits: number; unappliedCommits: number; files: number };
};

export default function CodeActivitySummary({ network, refreshing = false }: {
  network: BitcoinNetwork; refreshing?: boolean;
}) {
  const [observation, setObservation] = useState<CodeObservation>();
  const [reason, setReason] = useState("Loading confirmed Code activity…");
  useEffect(() => {
    const controller = new AbortController();
    setObservation(undefined);
    setReason("Loading confirmed Code activity…");
    if (refreshing) return () => controller.abort();
    void fetchProofApiJson<CodeObservation>("/api/v1/code-repositories?limit=1&fresh=1", network, { signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        if (value.complete !== true || value.source !== "proof-indexer-exact-canonical-code-replay" || value.network !== network || !value.snapshot?.id ||
          !Number.isSafeInteger(value.indexedThroughBlock) || value.indexedThroughBlock < 1 ||
          !/^[a-f0-9]{64}$/u.test(value.indexedThroughBlockHash) ||
          value.snapshot.checkpointHeight !== value.indexedThroughBlock ||
          value.snapshot.checkpointHash !== value.indexedThroughBlockHash || !value.stats ||
          [value.stats.repositories, value.stats.acceptedCommits, value.stats.unappliedCommits, value.stats.files]
            .some(count => !Number.isSafeInteger(count) || count < 0)) {
          throw new Error("Complete confirmed Code activity is unavailable.");
        }
        setObservation(value);
      }).catch(error => {
        if (!controller.signal.aborted) setReason(error instanceof Error ? error.message : "Confirmed Code activity is unavailable.");
      });
    return () => controller.abort();
  }, [network, refreshing]);
  if (!observation) return <p className="field-note" role="status">{reason}</p>;
  return <div className="growth-boost-details" aria-label="Confirmed Code activity">
    <p>{observation.stats.repositories.toLocaleString()} repositories · {observation.stats.acceptedCommits.toLocaleString()} accepted commits · {observation.stats.files.toLocaleString()} current files</p>
    <p className="field-note">{observation.stats.unappliedCommits.toLocaleString()} unapplied commits retained in history. Code checkpoint {observation.indexedThroughBlock.toLocaleString()} · {observation.indexedThroughBlockHash.slice(0, 12)}.</p>
    <p className="field-note">These activity counts describe Code’s own complete checkpoint. Payments and carrier transactions contribute through Mail and Files once.</p>
  </div>;
}
