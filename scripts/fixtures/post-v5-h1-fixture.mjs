import { createHash } from "node:crypto";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const id = (value) => sha(value).slice(0, 24);
export function postV5H1Fixture(target, index) {
  const snapshotId = id("post-v5-h1:" + target.height);
  const generatedAt = new Date(Date.UTC(2026, 8, 23, 16, index, 0)).toISOString();
  const canonicalSummary = sha("full-summary:" + target.height);
  const sourceHashes = { blockScan: target.blockHash, canonicalSummary };
  const q8 = target.workNetworkValueQ8;
  const decimal = (BigInt(q8) / 100000000n).toString() + "." +
    (BigInt(q8) % 100000000n).toString().padStart(8, "0");
  const child = () => ({ snapshotId, indexedThroughBlock: target.height });
  const floor = {
    ...child(), indexedThroughBlockHash: target.blockHash,
    workNetworkValueAccountingModel: "canonical-exact-work-network-q8-v1",
    networkValueQ8: q8, liveNetworkValueQ8: q8,
    liveNetworkValueSats: decimal, networkValueSats: decimal,
    actualValue: {
      workNetworkValueAccountingModel: "canonical-exact-work-network-q8-v1",
      networkValueQ8: q8, liveNetworkValueQ8: q8,
      totalQ8: q8, liveTotalQ8: q8,
      totalSats: decimal, liveTotalSats: decimal,
    },
  };
  const commitment = (model, suffix) => ({
    model, payloadBytes: 123, sha256: sha("state:" + target.height + ":" + suffix),
  });
  const row = {
    network: "livenet", snapshotId, generatedAt,
    indexedThroughBlock: target.height, sourceHashes, metrics: {},
    consistency: {
      ok: true, status: "green", missingLogEvents: [],
      checks: [
        { name: "token-components-cover-confirmed-activity", ok: true },
        { name: "canonical-activity-count-matches-public-log", ok: true },
      ],
    },
    payload: {
      checks: [
        { name: "token-components-cover-confirmed-activity", ok: true },
        { name: "canonical-activity-count-matches-public-log", ok: true },
      ], generatedAt, indexedThroughBlock: target.height,
      indexedThroughBlockHash: target.blockHash,
      metrics: {}, missingLogEvents: [], network: "livenet",
      ok: true, snapshotId, sourceHashes, status: "green",
      summaryPayloads: {
        growthSummary: { ...child(), workFloor: { indexedThroughBlock: target.height } },
        inceptionSummary: child(), infinitySummary: child(),
        logSummary: child(),
        marketplaceSummary: { ...child(), workFloor: { indexedThroughBlock: target.height } },
        tokenSummary: child(), workFloor: floor,
        workSummary: { ...child(), floor: { indexedThroughBlock: target.height } },
      },
      summaryPayloadsIndexedAt: generatedAt,
      summaryRefresh: {
        mode: "canonical-summary-refresh",
        indexedThroughBlock: target.height,
        indexedThroughBlockHash: target.blockHash,
      },
      totals: {
        workNetworkValueAccountingModel: "canonical-exact-work-network-q8-v1",
        workNetworkValueQ8: q8, workActualValueQ8: q8,
        growthActualValueQ8: q8, growthWorkFloorValueQ8: q8,
      },
      workAmountStorageModel: "work-subatoms-v2",
      workSufficientState: {
        amountStorageModel: "work-subatoms-v2",
        closingStateCommitment: commitment(
          "canonical-work-amo-sufficient-state-sha256-v1", "closing"),
        decimals: 16, indexedThroughBlock: target.height,
        indexedThroughBlockHash: target.blockHash,
        model: "canonical-work-q16-transition-checkpoint-v1",
        precisionModel: "canonical-work-subatoms-v2",
        tokenStateCommitment: commitment(
          "canonical-work-amo-payload-sha256-v1", "token"),
        transitionModel: "canonical-work-amo-full-position-block-sequencer-v4",
        unitScale: "10000000000000000",
        workTokenStateModel: "canonical-work-token-state-subatoms-v3",
      },
    },
  };
  const witness = {
    blockHash: target.blockHash, height: target.height,
    snapshotId, workNetworkValueQ8: q8,
  };
  return { row, witness };
}
