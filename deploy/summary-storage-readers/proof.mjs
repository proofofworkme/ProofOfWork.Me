// Runs only in the native read-only rehearsal namespace with listener startup removed.
{
  const worker = await import("../scripts/backfill-proof-indexer.mjs");
  const { prepareWorkTransferProjection, decodeWorkTransferProjection } = await import("./db/work-transfer-projection-store.mjs");
  const { withProofIndexClient } = await import("./db/postgres.mjs");
  const { canonicalSummaryPayloadHash } = await import("./canonical-summary-stream.mjs");
  const need = (condition, error) => { if (!condition) throw new Error(error); };
  const targets = [
    "0bb04cc303f1ac2b68db93fd769f3b3dbd4368b5472030148b0956899302785e",
    "2ba09b2fd5ec3b38b32350530868e43ac9a8fcc55b6ff95d06986e0a4143333f",
    "4d73d28338baab56c9295e365d24bc8c536477855d3a5ba290aac35cb49ff653",
    "5773d2baa8248ff723085e914a35accc1989b005bd54c9ac3332977dec7da168",
  ];
  try {
    const status = await proofIndexOperationalStatusPayload("livenet");
    const height = status.indexedThroughBlock, hash = status.scan.blockHash;
    need(height >= 974919 && /^[0-9a-f]{64}$/u.test(hash), "Invalid indexed checkpoint");
    const bundle = await internalCanonicalSummaryPayload("livenet", { checkpointHeight: height, checkpointHash: hash });
    const summary = worker.summaryPayloadsWithAlignedWorkFloor(bundle.summaryPayloads);
    need(bundle.indexedThroughBlock === height && bundle.indexedThroughBlockHash === hash &&
      worker.canonicalSummaryCoverage(summary) === height &&
      Object.keys(summary).length === 8 && Object.values(summary).every(v => worker.summaryPayloadSnapshotId(v) === bundle.snapshotId && v.indexedThroughBlockHash === hash) &&
      worker.canonicalSummaryAccountingModelsCurrent(summary, { workAmountStorageModel: "work-subatoms-v2" }), "Candidate summary failed exactness/accounting");
    const projection = summary.workSummary.workTransferValueProjection;
    need(canonicalWorkTransferValueProjectionIsUsable(projection), "Unusable complete WORK projection");
    const families = targets.map(txid => {
      const parents = projection.transferBatches.filter(row => row.txid === txid);
      const children = projection.items.filter(row => row.txid === txid);
      need(parents.length === 1 && parents[0].blockHeight === 974919 && parents[0].recipientCount === 256 && Number(parents[0].paidSats) === 546 &&
        children.length === 256 && children.every(row => Number.isInteger(row.batchRecipientIndex) && row.batchRecipientIndex>=0 && row.batchRecipientIndex<256 && row.confirmed === true && row.economicDelta === false &&
          Number(row.paidSats) === 0 && Number(row.minerFeeSats) === 0) &&
        new Set(children.map(row => row.batchRecipientIndex)).size === 256, "Incomplete batch or duplicated child economics: " + txid);
      return { txid, children: children.length, registryProofs: String(parents[0].paidSats) };
    });
    const binding = { network:"livenet", snapshotId:bundle.snapshotId, indexedThroughBlock:height, indexedThroughBlockHash:hash };
    const { reference, pages } = prepareWorkTransferProjection(projection, binding);
    const restored = decodeWorkTransferProjection(reference, pages, binding);
    need(JSON.stringify(restored) === JSON.stringify(projection) && canonicalWorkTransferValueProjectionIsUsable(restored), "Paged full history differs");
    const storage = await withProofIndexClient(async client => {
      const row = (await client.query("SELECT payload->'summaryPayloads' AS summary,payload->>'indexedThroughBlockHash' AS hash FROM proof_indexer.ledger_snapshots WHERE network=$1 AND snapshot_id=$2 AND indexed_through_block=$3",
        ["livenet",status.summarySnapshot.snapshotId,height])).rows[0];
      need(row?.hash === hash && row.summary.workFloor.networkValueQ8 === summary.workFloor.networkValueQ8 &&
        row.summary.growthSummary.actualValue.totalQ8 === summary.growthSummary.actualValue.totalQ8, "Persisted exact-tip economics differ");
      const options = { workAmountStorageModel:"work-subatoms-v2" }, log=await worker.publicLogRelationalFingerprint(client);
      const work = await worker.exactWorkQ16CanonicalSummaryState(client, {}, height, options.workAmountStorageModel);
      const snapshot = worker.canonicalSummarySnapshotPayload({ ...options, generatedAt:new Date().toISOString(),
        indexedThroughBlock:height, indexedThroughBlockHash:hash, ledger:bundle.ledger, publicLogFingerprint:log,
        previousCoverage:height, snapshotId:bundle.snapshotId, sourceHashes:{...bundle.ledger.sourceHashes, blockScan:hash, publicLogRelational:log.hash,
          canonicalSummary:canonicalSummaryPayloadHash(summary)}, summaryPayloads:summary, totals:worker.summarySnapshotTotals(summary), workSufficientState:work.state });
      snapshot.summaryPayloads = { ...summary, workSummary:{...summary.workSummary,workTransferValueProjection:reference} };
      const bytes = worker.assertCanonicalSummarySnapshotStorageBudget(snapshot);
      const sql=await client.query("SELECT octet_length($1::jsonb::text) AS bytes",[JSON.stringify(snapshot)]);
      const sqlBytes=Number(sql.rows[0].bytes);
      need(bytes <= 20971520 && sqlBytes <= 23592960, "Compact page-referenced row exceeds the original H7 limits");
      return { bytes,sqlBytes,networkValueQ8:summary.workFloor.networkValueQ8,growthTotalQ8:summary.growthSummary.actualValue.totalQ8 };
    });
    const { recoverCandidateDiscoveryReorg } = await import("./candidate-discovery-reorg.mjs");
    const discovery = await withProofIndexClient(async client => {
      const recovered = {};
      for (const key of ["code:candidate-discovery","jobs:candidate-discovery"]) {
        const marker = (await client.query("SELECT value FROM proof_indexer.meta WHERE key=$1",[key])).rows[0]?.value;
        const { proof } = await recoverCandidateDiscoveryReorg({ client, network:"livenet", key, marker, dryRun:true,
          rpc: async (method,args) => { const data=await bitcoinRpc(method,args); need(data.ok,method); return data.result; } });
        need(proof.ancestor.height === 974399 && proof.detached.length === 1 && proof.detached[0].height === 974400 &&
          proof.prefixCount === (key.startsWith("code:") ? 4 : 1), "Code or Jobs orphan proof differs");
        recovered[key] = { ancestor:proof.ancestor, detach:proof.detached[0], count:proof.prefixCount, sha256:proof.prefixSha256 };
      }
      return recovered;
    });
    await exactCanonicalSummaryCheckpoint("livenet",{checkpointHeight:height, checkpointHash:hash});
    console.log(JSON.stringify({format:"summary-storage-readers-rehearsal-v1",ok:true,published:false,height,hash,snapshotId:bundle.snapshotId,
      families,discovery,pageCount:reference.pageCount,pageBytes:reference.payloadBytes,projectionSha256:reference.sha256,...storage}));
    process.exit(0);
  } catch(error) {
    console.error("Combined reader rehearsal failed", String(error?.message ?? error).slice(0,700));
    process.exit(1);
  }
}
