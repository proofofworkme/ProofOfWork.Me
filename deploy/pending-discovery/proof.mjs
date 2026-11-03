// Replaces only the HTTP listener/startup tail inside the read-only rehearsal.
{
  const worker = await import("../scripts/backfill-proof-indexer.mjs");
  const { withProofIndexClient } = await import("./db/postgres.mjs");
  const incident = "f2a4543e7a18ce1a6ed232c35a3ac03d99be05e603b738c2daf9865b01adb3f3";
  const need = (value, message) => { if (!value) throw new Error(message); };
  async function hintRequest(token, remoteAddress, network = "livenet") {
    const result = {};
    const response = {
      setHeader() {}, writeHead(code, headers) { result.code = code; result.headers = headers; },
      end(raw) { result.payload = JSON.parse(raw); },
    };
    await handleRequest({ method: "GET", url: "/api/v1/internal/pending-discovery-hints?network=" + network,
      headers: { host: "127.0.0.1", "x-pow-internal-verifier": token }, socket: { remoteAddress } }, response);
    return result;
  }
  async function incidentState() {
    const raw = await bitcoinRpc("getrawtransaction", [incident, true]);
    const entry = await bitcoinRpc("getmempoolentry", [incident]);
    if (!raw.ok && !entry.ok && raw.error?.code === -5 && entry.error?.code === -5) {
      return { disposition: "absent", txid: incident };
    }
    need(raw.ok && raw.result?.txid === incident && typeof raw.result.hex === "string", "Incident raw transaction unavailable");
    const tx = bitcoin.Transaction.fromHex(raw.result.hex);
    need(tx.getId() === incident, "Incident raw hash differs");
    const mail = tx.outs.filter(output => Buffer.from(output.script).toString("hex") === "6a0970776d313a6d3a7266");
    const paidOutputs = tx.outs.filter(output => BigInt(output.value) === 1034n).length;
    need(paidOutputs === 11 && mail.length === 1, "Incident Mail carrier or payment vector differs");
    if (entry.ok && !raw.result.blockhash) {
      return { disposition: "pending", txid: incident, paidOutputs, firstSeen: entry.result.time };
    }
    const blockHash = raw.result.blockhash;
    need(!entry.ok && entry.error?.code === -5 && /^[a-f0-9]{64}$/u.test(blockHash), "Incident state changed during sample");
    const header = await bitcoinRpc("getblockheader", [blockHash, true]);
    need(header.ok && header.result.confirmations > 0 && header.result.hash === blockHash, "Incident header unavailable");
    const height = header.result.height;
    const canonical = await bitcoinRpc("getblockhash", [height]);
    need(canonical.ok && canonical.result === blockHash, "Incident confirmation is not canonical");
    return { disposition: "confirmed", txid: incident, paidOutputs, height, blockHash };
  }
  try {
    const status = await proofIndexOperationalStatusPayload("livenet");
    const height = status?.indexedThroughBlock, hash = status?.scan?.blockHash;
    need(Number.isSafeInteger(height) && /^[0-9a-f]{64}$/u.test(hash), "Missing scan checkpoint");
    const rejected = await hintRequest("", "127.0.0.1");
    const offHost = await hintRequest(INTERNAL_VERIFIER_TOKEN, "192.0.2.1");
    const allowed = await hintRequest(INTERNAL_VERIFIER_TOKEN, "127.0.0.1");
    need(rejected.code === 404 && offHost.code === 404 && allowed.code === 200 &&
      allowed.headers["Cache-Control"] === "no-store" &&
      allowed.payload.model === "accepted-broadcast-txid-hints-v1" && allowed.payload.network === "livenet" &&
      Array.isArray(allowed.payload.txids) && allowed.payload.txids.every(txid => /^[a-f0-9]{64}$/u.test(txid)) &&
      new Set(allowed.payload.txids).size === allowed.payload.txids.length, "Hint endpoint evidence or admission differs");
    const { acceptedHintTxids } = await import("./pending-mempool-discovery.mjs");
    const accepted = acceptedHintTxids(allowed.payload, "livenet");
    need(JSON.stringify(accepted) === JSON.stringify(allowed.payload.txids) &&
      acceptedHintTxids(allowed.payload, "testnet").length === 0, "Worker rejects the candidate API contract");
    const witness = await incidentState();
    const bundle = await internalCanonicalSummaryPayload("livenet", { checkpointHeight: height, checkpointHash: hash });
    const summary = worker.summaryPayloadsWithAlignedWorkFloor(bundle.summaryPayloads);
    const keys = ["growthSummary", "inceptionSummary", "infinitySummary", "logSummary",
      "marketplaceSummary", "tokenSummary", "workFloor", "workSummary"];
    need(JSON.stringify(Object.keys(summary).sort()) === JSON.stringify(keys) &&
      bundle.indexedThroughBlock === height && bundle.indexedThroughBlockHash === hash &&
      worker.canonicalSummaryCoverage(summary) === height &&
      keys.every(key => worker.summaryPayloadSnapshotId(summary[key]) === bundle.snapshotId &&
        summary[key].indexedThroughBlockHash === hash) && worker.canonicalSummaryAccountingModelsCurrent(summary, {
          workAmountStorageModel: "work-subatoms-v2",
        }), "Candidate bundle is not an exact validated summary");
    const baseline = await withProofIndexClient(async client => {
      const { rows } = await client.query(
        "SELECT payload#>>'{summaryPayloads,workFloor,networkValueQ8}' AS value, payload#>>'{summaryPayloads,growthSummary,actualValue,totalQ8}' AS growth, payload->>'indexedThroughBlockHash' AS hash FROM proof_indexer.ledger_snapshots WHERE network=$1 AND snapshot_id=$2 AND indexed_through_block=$3",
        ["livenet", status.summarySnapshot.snapshotId, height]
      );
      need(rows.length === 1 && rows[0].hash === hash &&
        rows[0].value === summary.workFloor.networkValueQ8 && rows[0].growth === summary.growthSummary.actualValue.totalQ8,
        "Pending discovery changed exact confirmed economics at the same checkpoint");
      const events = await client.query(
        "SELECT status, kind, count(*)::int AS count FROM proof_indexer.events WHERE network=$1 AND txid=$2 GROUP BY status, kind ORDER BY status, kind",
        ["livenet", incident]
      );
      return { snapshotId: status.summarySnapshot.snapshotId, networkValueQ8: rows[0].value, incidentEvents: events.rows };
    });
    await exactCanonicalSummaryCheckpoint("livenet", { checkpointHeight: height, checkpointHash: hash });
    console.log(JSON.stringify({ format: "pending-discovery-rehearsal-v1", ok: true, published: false,
      height, hash, snapshotId: bundle.snapshotId, baseline, witness, acceptedHintCount: allowed.payload.txids.length,
      unauthorizedRejected: true, nonLoopbackRejected: true, confirmedEconomicsMatched: true }));
    process.exit(0);
  } catch (error) {
    console.error("Read-only pending rehearsal failed", String(error?.message ?? error).slice(0, 800));
    process.exit(1);
  }
}
