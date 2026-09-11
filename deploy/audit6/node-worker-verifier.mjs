// Read-only gates for the separately managed, same-code 17/18 MiB recovery.
// Importing this module performs no I/O. The production launcher pins its hash.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MODEL = 'proofofwork-worker-verifier-manifest-v1';
export const SUMMARY_KEYS = Object.freeze(['growthSummary', 'inceptionSummary', 'infinitySummary',
  'logSummary', 'marketplaceSummary', 'tokenSummary', 'workFloor', 'workSummary']);
export const APPLICATIONS = Object.freeze(['proof-indexer-worker', 'proof-indexer-worker-backfill',
  'proof-indexer-worker-parity']);
const SHA256 = /^[0-9a-f]{64}$/u;
const PHASES = new Set(['before-freeze', 'frozen', 'retired', 'first-complete-cycle', 'rollback']);
const WORKER_UNIT = 'proofofwork-indexer-worker.service';
const SQL_LIMIT = 18 * 1024 * 1024;
const COMPACT_LIMIT = 17 * 1024 * 1024;
const PRIOR_COMPACT_LIMIT = 16 * 1024 * 1024;
export function insist(condition, message) { if (!condition) throw new Error(message); }
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const equal = (left, right) => stableJson(left) === stableJson(right);
const validTip = value => Number.isSafeInteger(value?.height) && value.height > 0 && SHA256.test(value.hash);
const isoMs = value => typeof value === 'string' ? Date.parse(value) : NaN;

export function validateManifest(value) {
  insist(value?.model === MODEL && value.network === 'livenet', 'Unknown verifier manifest/network');
  insist(equal(value.budgets, { priorCompactBytes: PRIOR_COMPACT_LIMIT,
    compactBytes: COMPACT_LIMIT, sqlTextBytes: SQL_LIMIT }), 'Unreviewed byte budgets');
  insist(value.nodeBinary?.owner === 0 && SHA256.test(value.nodeBinary.sha256) &&
    SHA256.test(value.verifierModule?.sha256), 'Runtime/module digest missing');
  insist(/^[0-9a-f]{40}$/u.test(value.source?.commit) && Number.isInteger(value.source.owner) &&
    value.source.owner >= 0 && value.source.files && !Array.isArray(value.source.files), 'Source identity missing');
  for (const file of ['scripts/run-proof-indexer-worker.mjs', 'scripts/backfill-proof-indexer.mjs',
    'server/canonical-summary-budget.mjs', 'server/db/proof-index-reader.mjs',
    'server/work-amo-v8-worker-readiness.mjs', 'server/db/postgres.mjs', 'server/proof-api.mjs']) {
    insist(SHA256.test(value.source.files[file]), `Required source digest missing: ${file}`);
  }
  insist(Array.isArray(value.apis) && value.apis.length === 2 &&
    new Set(value.apis.map(api => api.unit)).size === value.apis.length, 'Existing API and socket proxy must be pinned');
  for (const api of value.apis) {
    insist(Number.isSafeInteger(api.pid) && api.pid > 1 && /^\d+$/u.test(api.startTicks) &&
      Number.isSafeInteger(api.port) && api.port > 0 && api.port < 65536 &&
      /^(?:[0-9A-F]{8}|[0-9A-F]{32})$/u.test(api.addressHex), 'API identity/listener incomplete');
    if (api.kind === 'node-api') {
      insist(api.unit === 'proofofwork-api.service' && api.sourceRoot === value.source.root,
        'Primary Node API source identity differs');
    } else {
      insist(api.kind === 'socket-proxy' && api.unit === 'proofofwork-api-wg.service' &&
        api.socketUnit === 'proofofwork-api-wg.socket' && api.listenAddress === '10.77.0.2:8081' &&
        api.executable?.path === '/usr/lib/systemd/systemd-socket-proxyd' && SHA256.test(api.executable.sha256),
      'WireGuard socket proxy identity differs');
    }
  }
  insist(value.primaryApiUnit === 'proofofwork-api.service', 'Primary API must be the existing loopback service');
  for (const key of ['receipt', 'payload']) insist(SHA256.test(value.candidate?.[key]?.sha256), 'Candidate artifact digest missing');
  insist(Number.isSafeInteger(value.candidate.maximumAgeSeconds) &&
    value.candidate.maximumAgeSeconds > 0 && value.candidate.maximumAgeSeconds <= 1800,
  'Candidate receipt freshness must be bounded');
  return value;
}

export function validateCandidate(receipt, payload, manifest, nowMs = Date.now()) {
  insist(receipt?.ok === true && receipt.sameCore === true && receipt.sameScan === true &&
    receipt.candidateMatchesFence === true && validTip(receipt.coreAfter), 'Candidate was not fenced successfully');
  insist(receipt.writerSha256 === manifest.source.files['scripts/backfill-proof-indexer.mjs'], 'Candidate used another writer');
  const age = nowMs - isoMs(receipt.at);
  insist(Number.isFinite(age) && age >= 0 && age <= manifest.candidate.maximumAgeSeconds * 1000,
    'Candidate receipt is stale or future-dated');
  const text = JSON.stringify(payload);
  insist(sha256(text) === receipt.candidate.sha256 && Buffer.byteLength(text) === receipt.candidate.compactBytes,
    'Candidate payload bytes differ from the measured receipt');
  insist(payload.ok === true && payload.status === 'green' && payload.checks.length > 0 &&
    payload.checks.every(check => check.ok === true) && payload.indexedThroughBlock === receipt.coreAfter.height &&
    payload.indexedThroughBlockHash === receipt.coreAfter.hash, 'Candidate accounting/checkpoint is invalid');
  insist(receipt.candidate.compactBytes <= COMPACT_LIMIT && receipt.candidate.sql_text_bytes <= SQL_LIMIT &&
    receipt.candidate.sql_text_bytes > 0, 'Candidate does not fit both envelopes');
  return { height: payload.indexedThroughBlock, hash: payload.indexedThroughBlockHash,
    snapshotId: payload.snapshotId, compactBytes: receipt.candidate.compactBytes,
    sqlTextBytes: receipt.candidate.sql_text_bytes, sha256: receipt.candidate.sha256 };
}

export function canonicalMempool(txids) {
  insist(Array.isArray(txids) && txids.every(txid => SHA256.test(txid)) &&
    new Set(txids).size === txids.length, 'Invalid Core mempool membership');
  const sorted = [...txids].sort();
  return { model: 'canonical-core-mempool-txid-set-v1', count: sorted.length,
    sha256: sha256(`ProofOfWork.Me/WORK-Q16-PENDING-MEMPOOL/v1\n${JSON.stringify(sorted)}`), txids: sorted };
}

export function assertFrozen(observation) {
  insist(observation.workerProcess.frozen === true && observation.workerProcess.pids.length === 1 &&
    observation.workerProcess.pids[0] === observation.workerProcess.pid, 'Worker cgroup is not wholly quiescent/frozen');
  insist(observation.db.sessions.length > 0 && observation.db.sessions.every(row =>
    row.application_name === 'proof-indexer-worker' && row.state === 'idle' && row.xact_start === null &&
    row.wait_event_type === 'Client' && row.wait_event === 'ClientRead'), 'Worker sessions are not idle outside transactions');
  insist(observation.db.worker?.state === 'failed-retrying' && observation.db.worker.ok === false &&
    Number.isFinite(isoMs(observation.db.worker.lastSuccess?.finishedAt)), 'Frozen worker is not the durable retry boundary');
  insist(observation.incident?.matched === true, 'Current retry is not bound to the recorded size incident');
  return true;
}

export function assertRetired(before, observation) {
  insist(before?.phase === 'frozen' && before.passed === true, 'Missing frozen baseline');
  insist(observation.workerProcess.pid === 0 && observation.workerProcess.pids.length === 0 &&
    observation.db.sessions.length === 0, 'Worker process/database sessions remain');
  insist(equal(before.db.durable, observation.db.durable), 'Durable checkpoint changed during retirement');
  return true;
}

export function assertCurrentSummary(db, tip, preparedAt) {
  insist(validTip(tip) && db.scan?.height === tip.height && db.scan.hash === tip.hash &&
    db.scan.complete === true, 'Canonical scan is not at the fresh Core tip');
  const summary = db.summary;
  insist(summary?.height === tip.height && summary.hash === tip.hash && summary.payloadHash === tip.hash &&
    summary.refreshHash === tip.hash && summary.ok === true && summary.status === 'green' &&
    summary.sqlTextBytes > 0 && summary.sqlTextBytes <= SQL_LIMIT &&
    isoMs(summary.generatedAt) >= preparedAt * 1000, 'New canonical summary is missing, stale, invalid, or oversized');
  insist(SUMMARY_KEYS.every(key => summary.coverage?.[key]?.height === tip.height &&
    summary.coverage[key].hash === tip.hash && summary.coverage[key].snapshotId === summary.snapshotId &&
    (summary.coverage[key].nestedHeight === null || summary.coverage[key].nestedHeight === tip.height)),
  'The eight canonical summaries do not share the complete checkpoint');
  insist(summary.workAmountStorageModel === 'work-subatoms-v2' &&
    summary.workSufficientState?.indexedThroughBlock === tip.height &&
    summary.workSufficientState?.indexedThroughBlockHash === tip.hash &&
    equal(summary.workSufficientState?.closingStateCommitment, db.transition?.closingStateCommitment) &&
    equal(summary.workSufficientState?.tokenStateCommitment, db.transition?.tokenStateCommitment) &&
    db.transition?.height === tip.height && db.transition.hash === tip.hash && db.transition.complete === true,
  'Canonical WORK transition/witness binding differs');
  insist(summary.exactAliases?.length === 8 && summary.exactAliases.every(value =>
    typeof value === 'string' && /^[1-9][0-9]*$/u.test(value) && value === summary.exactAliases[0]),
  'Canonical Q8 accounting aliases differ');
  return true;
}

export function assertCompleted(before, observation, request) {
  insist(before?.phase === 'frozen' && before.passed === true, 'Missing frozen baseline');
  insist(observation.workerProcess.pid > 1 && observation.workerProcess.pid !== before.workerProcess.pid,
    'No new worker process');
  insist(observation.workerProcess.compactBytes === COMPACT_LIMIT && observation.workerProcess.sqlTextBytes === SQL_LIMIT,
    'New worker budgets differ');
  const worker = observation.db.worker;
  insist(worker?.ok === true && worker.state === 'idle' && worker.consecutiveFailures === 0 &&
    !worker.error && worker.lastSuccessAt === worker.lastSuccess?.finishedAt &&
    isoMs(worker.lastSuccess.finishedAt) >= request.preparedAt * 1000 &&
    isoMs(worker.lastSuccess.finishedAt) > isoMs(before.db.worker?.lastSuccess?.finishedAt),
  'No new fully completed successful cycle');
  insist(observation.readiness?.ready === true && observation.readiness.pendingReady === true &&
    observation.readiness.failureActive === false && observation.readiness.tipHeight === observation.coreAfter.height &&
    observation.readiness.tipHash === observation.coreAfter.hash, 'Durable exact worker readiness is not current');
  assertCurrentSummary(observation.db, observation.coreAfter, request.preparedAt);
  insist(equal(observation.coreBefore, observation.coreAfter), 'Core advanced during verification');
  insist(observation.pending?.ready === true && observation.pending.relevantMembershipStable === true,
    'Relevant pending membership/projection is not bound to the current observation');
  insist(observation.apiReads?.length === 2 && observation.apiReads.every(read =>
    read.status === 200 && read.height === observation.coreAfter.height && read.hash === observation.coreAfter.hash &&
    read.snapshotId === observation.db.summary.snapshotId && read.ready === true && read.protocolWritesEnabled === true &&
    read.workNetworkValueQ8 === observation.db.summary.exactAliases[0]), 'Existing API did not serve current exact WORK and AMO');
  return true;
}

function checkedFile(filename, expectedHash, owner = 0, maximum = 32 * 1024 * 1024) {
  insist(typeof filename === 'string' && path.isAbsolute(filename) && fs.realpathSync(filename) === filename, 'Noncanonical verifier path');
  const stat = fs.lstatSync(filename);
  insist(stat.isFile() && !stat.isSymbolicLink() && stat.uid === owner && !(stat.mode & 0o7022) &&
    stat.size <= maximum, 'Unsafe verifier file owner/mode/size');
  const raw = fs.readFileSync(filename);
  insist(SHA256.test(expectedHash) && sha256(raw) === expectedHash, 'Pinned file changed');
  return raw;
}
function command(binary, args) {
  return execFileSync(binary, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 }).trim();
}
function properties(unit) {
  return Object.fromEntries(command('/usr/bin/systemctl', ['show', unit,
    '--property=MainPID,ActiveState,ControlGroup,WorkingDirectory']).split('\n').map(row => row.split(/=(.*)/su).slice(0, 2)));
}
function processTicks(pid) { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').slice(1).join(') ').split(' ')[19]; }
function environment(pid) {
  return Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(row => row.includes('='))
    .map(row => { const at = row.indexOf('='); return [row.slice(0, at), row.slice(at + 1)]; }));
}
function processList(group) {
  return fs.existsSync(`${group}/cgroup.procs`) ? fs.readFileSync(`${group}/cgroup.procs`, 'utf8').trim().split(/\s+/u).filter(Boolean).map(Number).sort((a, b) => a - b) : [];
}
function assertApis(manifest) {
  const result = [];
  for (const api of manifest.apis) {
    const current = properties(api.unit);
    insist(current.ActiveState === 'active' && Number(current.MainPID) === api.pid && processTicks(api.pid) === api.startTicks,
      'An existing API/proxy process changed');
    if (api.kind === 'node-api') {
      insist(fs.realpathSync(`/proc/${api.pid}/cwd`) === api.sourceRoot &&
        fs.realpathSync(`/proc/${api.pid}/exe`) === manifest.nodeBinary.path, 'Primary API source/runtime changed');
    } else {
      checkedFile(api.executable.path, api.executable.sha256, 0, 16 * 1024 * 1024);
      insist(fs.realpathSync(`/proc/${api.pid}/exe`) === api.executable.path &&
        command('/usr/bin/systemctl', ['show', api.socketUnit, '--property=ActiveState', '--value']) === 'active' &&
        command('/usr/bin/systemctl', ['show', api.socketUnit, '--property=Listen', '--value']) === `${api.listenAddress} (Stream)`,
      'WireGuard socket activation listener changed');
    }
    const sockets = new Set(fs.readdirSync(`/proc/${api.pid}/fd`).flatMap(fd => {
      try { const match = /^socket:\[(\d+)\]$/u.exec(fs.readlinkSync(`/proc/${api.pid}/fd/${fd}`)); return match ? [match[1]] : []; }
      catch { return []; }
    }));
    const listening = ['tcp', 'tcp6'].flatMap(kind => fs.readFileSync(`/proc/${api.pid}/net/${kind}`, 'utf8').trim().split('\n').slice(1))
      .some(line => { const columns = line.trim().split(/\s+/u); return columns[3] === '0A' && sockets.has(columns[9]) &&
        columns[1] === `${api.addressHex}:${api.port.toString(16).toUpperCase().padStart(4, '0')}`; });
    insist(listening, 'An existing API listener disappeared or changed');
    if (api.kind === 'node-api') {
      const env = environment(api.pid);
      insist(Number(env.POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_MAX_BYTES) === PRIOR_COMPACT_LIMIT &&
        Number(env.POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_SQL_TEXT_MAX_BYTES) === SQL_LIMIT, 'Existing API byte budgets changed');
    }
    result.push({ unit: api.unit, pid: api.pid, startTicks: api.startTicks, port: api.port, listenerPresent: true });
  }
  return result;
}
function workerProcess(manifest) {
  const state = properties(WORKER_UNIT);
  const group = '/sys/fs/cgroup/system.slice/' + WORKER_UNIT;
  const pid = Number(state.MainPID);
  const env = pid > 1 ? environment(pid) : {};
  if (pid > 1) {
    insist(fs.realpathSync(`/proc/${pid}/exe`) === manifest.nodeBinary.path &&
      fs.realpathSync(`/proc/${pid}/cwd`) === manifest.source.root &&
      equal(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0'),
        [manifest.nodeBinary.path, path.join(manifest.source.root, 'scripts/run-proof-indexer-worker.mjs'), '--loop', '']),
    'Worker runtime/source command differs from the prepared release');
  }
  return { pid, active: state.ActiveState, pids: processList(group),
    frozen: fs.existsSync(`${group}/cgroup.events`) && fs.readFileSync(`${group}/cgroup.events`, 'utf8').includes('frozen 1'),
    compactBytes: Number(env.POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_MAX_BYTES) || null,
    sqlTextBytes: Number(env.POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_SQL_TEXT_MAX_BYTES) || null };
}

export const SNAPSHOT_SQL = `
WITH scan AS (SELECT snapshot_id, indexed_through_block, source_hashes, payload, consistency
 FROM proof_indexer.ledger_snapshots WHERE network='livenet' AND source_hashes ? 'blockScan'
 AND NOT (source_hashes ? 'canonicalSummary') ORDER BY indexed_through_block DESC NULLS LAST, generated_at DESC LIMIT 1),
summary AS (SELECT snapshot_id, generated_at, indexed_through_block, source_hashes, payload, consistency
 FROM proof_indexer.ledger_snapshots WHERE network='livenet' AND source_hashes ? 'canonicalSummary'
 ORDER BY indexed_through_block DESC NULLS LAST, generated_at DESC LIMIT 1),
transition AS (SELECT t.* FROM proof_indexer.work_amo_block_transitions t JOIN proof_indexer.blocks b
 ON b.network=t.network AND b.height=t.block_height AND b.block_hash=t.block_hash AND b.canonical=true
 WHERE t.network='livenet' ORDER BY t.block_height DESC LIMIT 1)
SELECT jsonb_build_object(
 'worker',(SELECT value FROM proof_indexer.meta WHERE key='worker:lastRun'),
 'scan',(SELECT jsonb_build_object('snapshotId',snapshot_id,'height',indexed_through_block,'hash',source_hashes->>'blockScan',
   'complete',COALESCE((payload->>'complete')::boolean,false) AND COALESCE((consistency->>'ok')::boolean,false)) FROM scan),
 'summary',(SELECT jsonb_build_object('snapshotId',snapshot_id,'generatedAt',generated_at,'height',indexed_through_block,
   'hash',source_hashes->>'blockScan','payloadHash',payload->>'indexedThroughBlockHash','refreshHash',payload->'summaryRefresh'->>'indexedThroughBlockHash',
   'sqlTextBytes',octet_length(payload::text),'ok',COALESCE((consistency->>'ok')::boolean,false),'status',consistency->>'status',
   'workAmountStorageModel',payload->>'workAmountStorageModel','workSufficientState',payload->'workSufficientState',
   'exactAliases',jsonb_build_array(payload->'totals'->>'workNetworkValueQ8',payload->'totals'->>'growthActualValueQ8',
     payload->'summaryPayloads'->'workFloor'->>'networkValueQ8',payload->'summaryPayloads'->'workFloor'->>'liveNetworkValueQ8',
     payload->'summaryPayloads'->'workFloor'->'actualValue'->>'networkValueQ8',payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveNetworkValueQ8',
     payload->'summaryPayloads'->'workFloor'->'actualValue'->>'totalQ8',payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveTotalQ8'),
   'coverage',(SELECT jsonb_object_agg(k,jsonb_build_object('height',v->'indexedThroughBlock','hash',v->>'indexedThroughBlockHash',
       'snapshotId',v->>'snapshotId','nestedHeight',CASE WHEN k='workSummary' THEN v->'floor'->'indexedThroughBlock'
         WHEN k IN ('growthSummary','marketplaceSummary') THEN v->'workFloor'->'indexedThroughBlock' ELSE NULL END))
       FROM jsonb_each(payload->'summaryPayloads') AS entries(k,v))) FROM summary),
 'transition',(SELECT jsonb_build_object('height',block_height,'hash',block_hash,'complete',complete,
   'closingStateCommitment',jsonb_build_object('model',state_commitment_model,'payloadBytes',closing_state_payload_bytes,'sha256',closing_state_sha256),
   'tokenStateCommitment',payload->'closingSufficientState'->'tokenStateCommitment') FROM transition),
 'pending',(SELECT jsonb_build_object('model',value->>'model','network',value->>'network','ready',value->'ready',
   'generatedAt',value->>'generatedAt','canonicalTip',value->'canonicalTip','membershipSnapshot',value->'membershipSnapshot',
   'projection',value->'projection','projectionCommitment',value->'projectionCommitment','mempoolSnapshot',value->'mempoolSnapshot')
   FROM proof_indexer.meta WHERE key='workQ16PendingRebuild:livenet'),
 'durable',jsonb_build_object(
   'worker',(SELECT value FROM proof_indexer.meta WHERE key='worker:lastRun'),
   'scan',(SELECT jsonb_build_array(snapshot_id,indexed_through_block,source_hashes,md5(payload::text)) FROM scan),
   'summary',(SELECT jsonb_build_array(snapshot_id,indexed_through_block,source_hashes,md5(payload::text)) FROM summary),
   'transition',(SELECT jsonb_build_array(block_height,block_hash,closing_state_sha256,event_set_sha256) FROM transition),
   'pending',(SELECT jsonb_agg(jsonb_build_array(key,md5(value::text)) ORDER BY key) FROM proof_indexer.meta
     WHERE key IN ('workQ16PendingRebuild:livenet','workQ16PendingAttempt:livenet'))
 )) AS snapshot`;

async function databaseSnapshot(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='6s'");
    await client.query("SET LOCAL lock_timeout='1s'");
    const result = await client.query(SNAPSHOT_SQL);
    const sessions = await client.query(`SELECT pid,backend_start::text,application_name,state,xact_start::text,wait_event_type,wait_event
      FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND application_name=ANY($1::text[]) ORDER BY pid`, [APPLICATIONS]);
    await client.query('COMMIT');
    return { ...result.rows[0].snapshot, sessions: sessions.rows };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

function incidentEvidence(worker, pid) {
  // The parent error can be a bounded child-exit wrapper; bind the actual
  // budget exception to this service invocation's journal, not an old outage.
  const lines = command('/usr/bin/journalctl', ['-u', WORKER_UNIT, '--since', '-10min', '-n', '1200', '--no-pager', '-o', 'json']);
  const records = lines.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const invocation = command('/usr/bin/systemctl', ['show', WORKER_UNIT, '--property=InvocationID', '--value']);
  const match = records.filter(row => row._SYSTEMD_INVOCATION_ID === invocation).reverse().find(row =>
    /Canonical summary snapshot is (\d+) bytes; the storage budget is 16777216 bytes\./u.test(row.MESSAGE ?? ''));
  const bytes = match ? Number(/snapshot is (\d+) bytes/u.exec(match.MESSAGE)[1]) : null;
  return { matched: worker?.state === 'failed-retrying' && worker.ok === false && Boolean(match) &&
      bytes > PRIOR_COMPACT_LIMIT && bytes <= COMPACT_LIMIT && Number.isFinite(isoMs(worker.failedAt)) &&
      Math.abs(Number(match?.__REALTIME_TIMESTAMP) / 1000 - isoMs(worker.failedAt)) < 120_000,
    pid, invocation, payloadBytes: bytes, budgetBytes: PRIOR_COMPACT_LIMIT,
    journalAt: match ? new Date(Number(match.__REALTIME_TIMESTAMP) / 1000).toISOString() : null };
}

async function readJson(url, options = {}) {
  const started = Date.now();
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeoutMs ?? 12000) });
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length; insist(bytes <= 4 * 1024 * 1024, 'Verifier HTTP response exceeds bound'); chunks.push(chunk);
  }
  return { status: response.status, elapsedMs: Date.now() - started, body: JSON.parse(Buffer.concat(chunks)) };
}
async function core(env, method, params = []) {
  const read = await readJson(env.BITCOIN_RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json',
    authorization: 'Basic ' + Buffer.from(env.BITCOIN_RPC_USER + ':' + env.BITCOIN_RPC_PASSWORD).toString('base64') },
  body: JSON.stringify({ jsonrpc: '2.0', id: 'worker-recovery-readonly', method, params }), timeoutMs: 7000 });
  insist(read.status === 200 && !read.body.error, 'Core RPC failed'); return read.body.result;
}
async function coreTip(env) { const result = await core(env, 'getblockchaininfo');
  insist(result.chain === 'main' && result.initialblockdownload === false && result.blocks === result.headers, 'Core is not synchronized');
  return { height: result.blocks, hash: result.bestblockhash }; }

export function pendingBinding(db, beforeMempool, afterMempool) {
  const witness = db.pending;
  const membership = witness?.membershipSnapshot;
  const txids = membership?.txids;
  const replay = db.worker?.lastSuccess?.workPrecision?.replay;
  const projection = witness?.projection ?? witness?.projectionCommitment;
  const valid = Array.isArray(txids) && txids.every(txid => SHA256.test(txid)) && new Set(txids).size === txids.length &&
    equal([...txids].sort(), txids) && membership.model === 'canonical-work-q16-pending-membership-v2' &&
    membership.count === txids.length && membership.sha256 ===
      sha256(`ProofOfWork.Me/WORK-Q16-PENDING-MEMBERSHIP/v1\n${JSON.stringify(txids)}`);
  const before = new Set(beforeMempool.txids); const after = new Set(afterMempool.txids);
  const relevantMembershipStable = valid && txids.every(txid => before.has(txid) && after.has(txid));
  return { ready: valid && witness.ready === true && witness.network === 'livenet' &&
      witness.model === 'canonical-work-q16-pending-rebuild-v2' &&
      replay?.pendingMembershipCount === membership.count && replay.pendingMembershipSha256 === membership.sha256 &&
      SHA256.test(replay.pendingProjectionSha256) && replay.pendingProjectionSha256 === projection?.commitmentSha256 &&
      witness.canonicalTip?.height === db.scan?.height && witness.canonicalTip?.hash === db.scan?.hash &&
      Date.now() - isoMs(witness.generatedAt) >= 0 && Date.now() - isoMs(witness.generatedAt) <= 600000,
    relevantMembershipStable, count: membership?.count, sha256: membership?.sha256,
    projectionSha256: projection?.commitmentSha256,
    scope: 'published indexed candidates; current Core membership; undiscovered arrivals remain best-effort' };
}

async function apiRead(base, endpoint) {
  const result = await readJson(`${base}/api/v1/${endpoint}?compact=1&fresh=1&network=livenet`);
  const body = result.body; const floor = body.floor ?? body.workFloor;
  return { endpoint, status: result.status, elapsedMs: result.elapsedMs, height: body.indexedThroughBlock,
    hash: body.indexedThroughBlockHash, snapshotId: body.snapshotId, ready: body.workAmoV8?.ready === true,
    protocolWritesEnabled: body.workAmoV8?.protocolWritesEnabled === true,
    workNetworkValueQ8: floor?.networkValueQ8, errorCode: body.details?.code ?? body.code ?? null };
}

export async function verifyPhase(manifest, request, dependencies) {
  const baselineMode = request?.baselineMode;
  insist(PHASES.has(request?.phase) &&
    ['incident-existing-unhealthy', 'incident-existing-recovered'].includes(baselineMode) &&
    Number.isFinite(request.preparedAt) && request.preparedAt > 0, 'Unknown phase/baseline request');
  const observation = await dependencies.observe(request.phase);
  insist(equal(observation.coreBefore, observation.coreAfter), 'Core advanced during verification');
  if (request.phase === 'before-freeze') {
    insist(equal(observation.coreAfter, { height: dependencies.candidate.height, hash: dependencies.candidate.hash }),
      'Rebuild the read-only candidate size receipt at the new Core checkpoint');
    insist(observation.workerProcess.compactBytes === PRIOR_COMPACT_LIMIT && observation.workerProcess.sqlTextBytes === SQL_LIMIT,
      'Original worker budget baseline changed');
    insist(observation.workerProcess.frozen === false && observation.workerProcess.pids.length === 1 &&
      observation.workerProcess.pids[0] === observation.workerProcess.pid,
    'Worker process group is not quiescent');
    insist(observation.db.sessions.length > 0 && observation.db.sessions.every(row =>
      row.application_name === 'proof-indexer-worker' && row.state === 'idle' && row.xact_start === null &&
      row.wait_event_type === 'Client' && row.wait_event === 'ClientRead'),
    'Worker sessions are not idle outside transactions');
    insist(observation.db.summary?.sqlTextBytes > 0 && observation.db.summary.sqlTextBytes <= SQL_LIMIT,
      'Existing stored summary is already unreadable by the API');
    if (baselineMode === 'incident-existing-unhealthy') {
      insist(observation.apiBaseline?.status === 503 && observation.apiBaseline.errorCode === 'CANONICAL_SUMMARY_UNAVAILABLE',
        'The live API failure does not match this incident');
    } else {
      const summary = observation.db.summary;
      const api = observation.apiBaseline;
      insist(summary?.height === dependencies.candidate.height && summary.hash === dependencies.candidate.hash &&
        summary.snapshotId === dependencies.candidate.snapshotId && summary.ok === true && summary.status === 'green' &&
        summary.sqlTextBytes > 0 && summary.sqlTextBytes <= SQL_LIMIT,
      'Recovered canonical summary is not the pinned exact candidate');
      insist(api?.status === 200 && api.height === dependencies.candidate.height &&
        api.hash === dependencies.candidate.hash && api.snapshotId === dependencies.candidate.snapshotId &&
        api.ready === true && api.protocolWritesEnabled === true &&
        api.workNetworkValueQ8 === summary.exactAliases?.[0],
      'Recovered API response is not the pinned exact candidate');
    }
    return { passed: true, phase: request.phase, healthy: baselineMode === 'incident-existing-recovered',
      candidate: dependencies.candidate, ...observation };
  }
  if (request.phase === 'frozen') assertFrozen(observation);
  if (request.phase === 'retired') assertRetired(request.before, observation);
  if (request.phase === 'first-complete-cycle') assertCompleted(request.before, observation, request);
  if (request.phase === 'rollback') {
    insist(observation.workerProcess.pid > 1 && observation.workerProcess.compactBytes === PRIOR_COMPACT_LIMIT &&
      observation.workerProcess.sqlTextBytes === SQL_LIMIT, 'Original worker budget was not restored');
    insist(['frozen', 'before-freeze'].includes(request.before?.phase) && request.before.passed === true,
      'Rollback lacks a durable preflight or frozen baseline');
    if (request.before.phase === 'before-freeze') {
      insist(request.retirementOccurredPossible === false && request.wasFrozenBaseline === false,
        'A possibly retired worker requires the frozen baseline');
    }
    insist(observation.db.scan?.height >= request.before.db.scan?.height &&
      (observation.db.scan.height !== request.before.db.scan.height || observation.db.scan.hash === request.before.db.scan.hash),
      'Rollback changed the canonical baseline');
    const beforeFinished = isoMs(request.before.db.worker?.lastSuccess?.finishedAt);
    const afterFinished = isoMs(observation.db.worker?.lastSuccess?.finishedAt);
    insist(afterFinished === beforeFinished || (afterFinished > beforeFinished &&
      observation.db.worker.lastSuccess?.workPrecision?.era === 'q16' &&
      observation.db.worker.lastSuccess.workPrecision.replay?.ready === true),
      'Rollback lost the prior complete worker checkpoint');
  }
  return { passed: true, phase: request.phase, healthy: request.phase === 'first-complete-cycle', ...observation };
}

async function run() {
  const startedAt = Date.now();
  const manifestAt = process.argv.indexOf('--manifest'); const digestAt = process.argv.indexOf('--manifest-sha256');
  insist(process.geteuid() === 0 && manifestAt > 0 && digestAt > 0, 'Pinned root-owned manifest required');
  const manifest = validateManifest(JSON.parse(checkedFile(process.argv[manifestAt + 1], process.argv[digestAt + 1], 0, 1024 * 1024)));
  checkedFile(manifest.verifierModule.path, manifest.verifierModule.sha256, 0, 1024 * 1024);
  checkedFile(manifest.nodeBinary.path, manifest.nodeBinary.sha256, 0, 128 * 1024 * 1024);
  for (const [relative, digest] of Object.entries(manifest.source.files)) {
    insist(!path.isAbsolute(relative) && !relative.split('/').includes('..'), 'Invalid source-relative path');
    checkedFile(path.join(manifest.source.root, relative), digest, manifest.source.owner, 8 * 1024 * 1024);
  }
  const git = ['-c', `safe.directory=${manifest.source.root}`, '-C', manifest.source.root];
  insist(command('/usr/bin/git', [...git, 'rev-parse', 'HEAD']) === manifest.source.commit &&
    command('/usr/bin/git', [...git, 'status', '--porcelain', '--untracked-files=no']) === '',
  'Running release differs from the prepared clean commit');
  const raw = fs.readFileSync(0); insist(raw.length <= 1024 * 1024, 'Oversized verifier request'); const request = JSON.parse(raw);
  const hardBudgetMs = request.phase === 'first-complete-cycle' ? 585000 : 50000;
  const hardDeadline = setTimeout(() => {
    process.stdout.write(JSON.stringify({ passed: false, phase: request.phase, error: 'Read-only verifier deadline exceeded' }));
    process.exit(1);
  }, Math.max(1, startedAt + hardBudgetMs - Date.now()));
  hardDeadline.unref();
  const receipt = JSON.parse(checkedFile(manifest.candidate.receipt.path, manifest.candidate.receipt.sha256));
  const artifact = JSON.parse(checkedFile(manifest.candidate.payload.path, manifest.candidate.payload.sha256));
  // Freshness is a pretransition requirement. Resuming final/rollback gates
  // must not fail solely because the immutable preflight receipt has aged.
  const candidate = validateCandidate(receipt, artifact.payload, manifest,
    request.phase === 'before-freeze' ? Date.now() : isoMs(receipt.at));
  const primary = manifest.apis.find(api => api.unit === manifest.primaryApiUnit);
  assertApis(manifest);
  const env = environment(primary.pid);
  Object.assign(process.env, env, { POW_INDEX_DB_APP_NAME: 'audit6-worker-recovery-verifier',
    POW_INDEX_DB_POOL_MAX: '1', POW_INDEX_DB_CONNECT_TIMEOUT_MS: '1000', POW_INDEX_DB_STATEMENT_TIMEOUT_MS: '6000' });
  const { createProofIndexPool } = await import(pathToFileURL(path.join(manifest.source.root, 'server/db/postgres.mjs')));
  const { exactWorkAmoV8WorkerReadiness } = await import(pathToFileURL(path.join(manifest.source.root, 'server/work-amo-v8-worker-readiness.mjs')));
  const pool = createProofIndexPool(); const base = `http://127.0.0.1:${primary.port}`;
  try {
    if (request.phase === 'before-freeze') {
      const measured = await pool.query('SELECT octet_length($1::jsonb::text) AS bytes', [JSON.stringify(artifact.payload)]);
      insist(measured.rows[0].bytes === candidate.sqlTextBytes && measured.rows[0].bytes <= SQL_LIMIT,
        'Current PostgreSQL serialization differs from the measured candidate');
    }
    const observe = async phase => {
      const apis = assertApis(manifest); const coreBefore = await coreTip(env);
      const firstMempool = phase === 'first-complete-cycle' ? canonicalMempool(await core(env, 'getrawmempool', [false])) : null;
      const db = await databaseSnapshot(pool); const process = workerProcess(manifest);
      const result = { at: new Date().toISOString(), apis, coreBefore, db, workerProcess: process };
      if (phase === 'before-freeze') result.apiBaseline = await apiRead(base, 'marketplace-summary');
      if (phase === 'frozen') result.incident = incidentEvidence(db.worker, process.pid);
      if (phase === 'first-complete-cycle') {
        result.readiness = exactWorkAmoV8WorkerReadiness({ network: 'livenet', worker: db.worker },
          { network: 'livenet', tipHash: coreBefore.hash, tipHeight: coreBefore.height, liveMempoolSnapshot: firstMempool });
        // Wait for the durable cycle before loading even compact API summaries.
        insist(db.worker?.state === 'idle' && db.worker.ok === true && result.readiness.ready === true &&
          isoMs(db.worker.lastSuccess?.finishedAt) >= request.preparedAt * 1000,
        'New worker has not completed its exact cycle');
        assertCurrentSummary(db, coreBefore, request.preparedAt);
        result.apiReads = [await apiRead(base, 'work-summary'), await apiRead(base, 'marketplace-summary')];
        const lastMempool = canonicalMempool(await core(env, 'getrawmempool', [false]));
        result.pending = pendingBinding(db, firstMempool, lastMempool);
        result.mempool = { before: { count: firstMempool.count, sha256: firstMempool.sha256 },
          after: { count: lastMempool.count, sha256: lastMempool.sha256 }, authority: 'diagnostic-global-membership' };
        const afterDb = await databaseSnapshot(pool);
        insist(equal(db.durable, afterDb.durable), 'Durable worker/snapshot/pending publication changed during verification');
      }
      result.coreAfter = await coreTip(env); assertApis(manifest); return result;
    };
    const deadline = Date.now() + (request.phase === 'first-complete-cycle' ? 570000 : 45000);
    let lastError; let attempts = 0;
    do {
      try { const result = await verifyPhase(manifest, request, { observe, candidate });
        process.stdout.write(JSON.stringify({ ...result, attempts: attempts + 1 })); return;
      } catch (error) {
        lastError = error;
        if (request.phase !== 'first-complete-cycle') throw error;
        attempts += 1;
        if (Date.now() + 6000 >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } while (Date.now() < deadline);
    throw new Error(`No complete canonical recovery before deadline: ${lastError?.message}`);
  } finally { clearTimeout(hardDeadline); await pool.end(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  run().catch(error => { process.stdout.write(JSON.stringify({ passed: false, error: String(error.message).slice(0, 700) })); process.exitCode = 1; });
}
