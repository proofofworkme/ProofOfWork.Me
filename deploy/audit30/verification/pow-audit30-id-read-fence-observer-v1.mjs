// Diagnostic projection only; every existing audit payload and predicate is preserved.
const AUDIT30_FENCE_HASH_FIELDS = Object.freeze([
  'checkpointHash', 'confirmedTxidsSha256', 'electrumCheckpointHash',
  'electrumHeaderSha256', 'pendingMempoolTimeSha256', 'pendingTxidsSha256',
  'registryProjectionSha256', 'relationalRowsSha256', 'snapshotSha256',
  'transitionSha256', 'fenceSha256',
]);
const AUDIT30_FENCE_INTEGER_FIELDS = Object.freeze([
  'checkpointHeight', 'confirmedTxidCount', 'electrumCheckpointHeight',
  'pendingTxidCount', 'transitionCount',
]);
let audit30FenceObservationCount = 0;
const audit30FenceObservationStart = performance.now();
function audit30SafeReadFenceObservation(url, config, payload) {
  if (!isExactLoopbackAuditCoverageUrl(url, config)) return null;
  const kind = new URL(url).pathname.endsWith('/id-registry-audit-fence') ? 'final-fence' : 'coverage';
  const fence = kind === 'coverage' ? payload?.coverage?.readFence : (payload?.readFence ?? payload?.coverage?.readFence);
  const row = { schema: 'pow-audit30-id-read-fence-observation-v1', kind,
    elapsedMs: Math.max(0, Math.min(750000, Math.round(performance.now() - audit30FenceObservationStart))),
    networkMatches: payload?.network === 'livenet', shape: 'missing', fields: {}, invalidFields: [] };
  if (!fence || typeof fence !== 'object' || Array.isArray(fence)) return row;
  row.shape = 'object';
  for (const key of AUDIT30_FENCE_HASH_FIELDS) {
    if (typeof fence[key] === 'string' && /^[0-9a-f]{64}$/u.test(fence[key])) row.fields[key] = fence[key];
    else row.invalidFields.push(key);
  }
  for (const key of AUDIT30_FENCE_INTEGER_FIELDS) {
    if (Number.isSafeInteger(fence[key]) && fence[key] >= 0) row.fields[key] = fence[key];
    else row.invalidFields.push(key);
  }
  if (fence.indexScanStatus === 'block-scan-current') row.fields.indexScanStatus = 'block-scan-current';
  else row.invalidFields.push('indexScanStatus');
  if (typeof fence.indexScanSnapshotId === 'string' && Buffer.byteLength(fence.indexScanSnapshotId) <= 4096) {
    row.fields.indexScanSnapshotIdBytes = Buffer.byteLength(fence.indexScanSnapshotId);
    row.fields.indexScanSnapshotIdSha256 = createHash('sha256').update(fence.indexScanSnapshotId, 'utf8').digest('hex');
  } else row.invalidFields.push('indexScanSnapshotId');
  return row;
}
function audit30ObserveReadFence(url, config, payload) {
  // Diagnostic output cannot replace or modify any original validation/error.
  try {
    if (audit30FenceObservationCount >= 2) return;
    const row = audit30SafeReadFenceObservation(url, config, payload);
    if (!row) return;
    const encoded = JSON.stringify(row);
    if (Buffer.byteLength(encoded) > 8192) return;
    audit30FenceObservationCount += 1;
    console.log('POW_AUDIT30_READ_FENCE ' + encoded);
  } catch {}
}
