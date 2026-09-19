// Batching changes transport only. Callers still verify each script, exact value,
// confirmation count and chain/mempool fence before accepting any output.
export async function readCoreOutpointBatches(outpoints, requestBatch) {
  if (!Array.isArray(outpoints) || outpoints.length > 10000) throw new Error("CORE_OUTPOINT_BATCH_BOUND");
  const seen = new Set();
  for (const { txid, vout } of outpoints) {
    const key = `${txid}:${vout}`;
    if (!/^[0-9a-f]{64}$/u.test(txid) || !Number.isSafeInteger(vout) || vout < 0 || vout > 0xffffffff || seen.has(key)) {
      throw new Error("CORE_OUTPOINT_BATCH_IDENTITY");
    }
    seen.add(key);
  }
  const outputs = [];
  for (let start = 0; start < outpoints.length; start += 32) {
    const requests = outpoints.slice(start, start + 32).map(({ txid, vout }, offset) => ({
      id: `pow-outpoint-${start + offset}`, jsonrpc: "1.0", method: "gettxout", params: [txid, vout, true],
    }));
    const response = await requestBatch(requests);
    if (!Array.isArray(response) || response.length !== requests.length) throw new Error("CORE_OUTPOINT_BATCH_INCOMPLETE");
    const expected = new Set(requests.map(row => row.id));
    const byId = new Map();
    for (const row of response) {
      if (!row || !expected.has(row.id) || byId.has(row.id) || row.error != null || !Object.hasOwn(row, "result") ||
          (row.result !== null && (typeof row.result !== "object" || Array.isArray(row.result)))) {
        throw new Error("CORE_OUTPOINT_BATCH_RESPONSE");
      }
      byId.set(row.id, row.result);
    }
    for (const request of requests) outputs.push({ ok: true, result: byId.get(request.id) });
  }
  return outputs;
}
