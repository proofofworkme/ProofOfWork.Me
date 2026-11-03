// Appended only to the isolated candidate after its production startup is removed.
{
  const worker = await import("../scripts/backfill-proof-indexer.mjs");
  const { withProofIndexClient } = await import("./db/postgres.mjs");
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const target = "a4061d7a0b6051b0f1e44b706606951c168a80e94d3e877aadc95ee95a97d13a";
  const keys = ["growthSummary", "inceptionSummary", "infinitySummary", "logSummary",
    "marketplaceSummary", "tokenSummary", "workFloor", "workSummary"];
  try {
    const status = await proofIndexOperationalStatusPayload("livenet");
    const height = status?.indexedThroughBlock, hash = status?.scan?.blockHash;
    assert(Number.isSafeInteger(height) && height >= 974404 && /^[a-f0-9]{64}$/u.test(hash), "Missing scan checkpoint");
    const bundle = await internalCanonicalSummaryPayload("livenet", { checkpointHeight: height, checkpointHash: hash });
    const summary = worker.summaryPayloadsWithAlignedWorkFloor(bundle.summaryPayloads);
    assert(JSON.stringify(Object.keys(summary).sort()) === JSON.stringify(keys) &&
      bundle.indexedThroughBlock === height && bundle.indexedThroughBlockHash === hash &&
      worker.canonicalSummaryCoverage(summary) === height &&
      keys.every(key => worker.summaryPayloadSnapshotId(summary[key]) === bundle.snapshotId &&
        summary[key].indexedThroughBlockHash === hash), "Bundle checkpoint differs");
    const options = { workAmountStorageModel: "work-subatoms-v2" };
    assert(worker.canonicalSummaryAccountingModelsCurrent(summary, options), "Worker accounting rejected the bundle");
    const projection = summary.workSummary.workTransferValueProjection;
    assert(canonicalWorkTransferValueProjectionIsUsable(projection), "Complete valuation projection rejected");
    const parents = projection.transferBatches.filter(row => row.txid === target);
    const children = projection.items.filter(row => row.txid === target);
    assert(parents.length === 1 && parents[0].blockHeight === 974404 && Number(parents[0].paidSats) === 546 &&
      parents[0].recipientCount === 161 && children.length === 161 &&
      new Set(children.map(row => row.batchRecipientIndex)).size === 161 &&
      children.every(row => row.confirmed === true && row.economicDelta === false && Number(row.paidSats) === 0 &&
        Number(row.minerFeeSats) === 0), "Incident parent or complete zero-fee child set differs");
    const batchCount = projection.transferBatches.length;
    for (const preview of [summary.tokenSummary, summary.growthSummary.token, summary.marketplaceSummary.token,
      summary.workSummary.token]) {
      assert(Array.isArray(preview.transferBatches) && preview.transferBatches.length === 0 &&
        preview.totalCounts.transferBatches === batchCount && preview.collectionHasMore.transferBatches === true,
        "A preview repeats batch parents or loses the confirmed count");
    }
    for (const bond of [summary.inceptionSummary.token, summary.infinitySummary.token]) {
      assert(bond.transferBatches.length === 0 && bond.collectionHasMore.transferBatches === false,
        "Bond preview includes unrelated WORK history");
    }
    const sizes = await withProofIndexClient(async client => {
      const log = await worker.publicLogRelationalFingerprint(client);
      const work = await worker.exactWorkQ16CanonicalSummaryState(client, {}, height, options.workAmountStorageModel);
      const now = new Date().toISOString();
      const sourceHashes = { ...bundle.ledger.sourceHashes, blockScan: hash, publicLogRelational: log.hash,
        canonicalSummary: sha256Hex(Buffer.from(JSON.stringify(summary))) };
      const row = worker.canonicalSummarySnapshotPayload({ ...options, generatedAt: now,
        indexedThroughBlock: height, indexedThroughBlockHash: hash, ledger: bundle.ledger,
        publicLogFingerprint: log, previousCoverage: 974402, snapshotId: bundle.snapshotId, sourceHashes,
        summaryPayloads: summary, totals: worker.summarySnapshotTotals(summary), workSufficientState: work.state });
      const compactBytes = worker.assertCanonicalSummarySnapshotStorageBudget(row);
      const sql = await client.query("SELECT octet_length($1::jsonb::text) AS bytes", [JSON.stringify(row)]);
      const sqlBytes = Number(sql.rows[0].bytes);
      assert(compactBytes <= 20971520 && sqlBytes <= 23592960, "Candidate exceeds production storage limits");
      return { compactBytes, sqlBytes };
    });
    await exactCanonicalSummaryCheckpoint("livenet", { checkpointHeight: height, checkpointHash: hash });
    console.log(JSON.stringify({format: "summary-preview-rehearsal-v1", ok: true, published: false,
      indexedThroughBlock: height, indexedThroughBlockHash: hash, snapshotId: bundle.snapshotId,
      batchCount, target, children: children.length, registryProofs: Number(parents[0].paidSats), ...sizes}));
    process.exit(0);
  } catch (error) {
    console.error("Read-only preview rehearsal failed", String(error?.message ?? error).slice(0, 800));
    process.exit(1);
  }
}
