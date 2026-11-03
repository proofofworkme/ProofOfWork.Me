import { useEffect, useState } from "react";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";

type Observation = {
  network: string; source: string; complete: boolean; fromHeight: number; indexedThroughBlock: number; indexedThroughBlockHash: string;
  parts: string; publications: string; publishedBytes: string; minerFeeProofs: string | null;
};
const count = (value: unknown): value is string => typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
const show = (value: string) => BigInt(value).toLocaleString();
export default function LinkedFilesActivity({ network, refreshing }: { network: BitcoinNetwork; refreshing: boolean }) {
  const [data, setData] = useState<Observation>();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const control = new AbortController();
    setData(undefined); setLoading(network === "livenet");
    if (network === "livenet" && !refreshing) {
      void fetchProofApiJson<Observation>("/api/v1/powcat-activity?fresh=1", network, { signal: control.signal })
        .then(value => {
          if (control.signal.aborted || value.network !== network || value.source !== "powcat1-discovery-v1" || value.complete !== true ||
              !Number.isSafeInteger(value.fromHeight) || value.fromHeight < 1 || !Number.isSafeInteger(value.indexedThroughBlock) ||
              value.indexedThroughBlock < value.fromHeight || !/^[0-9a-f]{64}$/u.test(value.indexedThroughBlockHash) ||
              ![value.parts, value.publications, value.publishedBytes].every(count) ||
              !(value.minerFeeProofs === null || count(value.minerFeeProofs))) return;
          setData(value);
        }).catch(() => {}).finally(() => { if (!control.signal.aborted) setLoading(false); });
    }
    return () => control.abort();
  }, [network, refreshing]);
  if (network !== "livenet") return null;
  if (!data) return <p className="field-note" role="status">{loading ? "Loading confirmed linked files…" : "Confirmed linked-file counts unavailable."}</p>;
  return <div className="growth-boost-details" aria-label="Confirmed linked files">
    <p>{show(data.publications)} linked file publications · {show(data.publishedBytes)} published bytes · {show(data.parts)} confirmed parts</p>
    <p className="field-note">Blocks {data.fromHeight.toLocaleString()}–{data.indexedThroughBlock.toLocaleString()}. {data.minerFeeProofs === null ? "Miner fees unavailable." : `${show(data.minerFeeProofs)} proofs in miner fees across parts and linkers.`}</p>
  </div>;
}
