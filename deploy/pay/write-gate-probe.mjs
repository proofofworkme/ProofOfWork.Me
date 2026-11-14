#!/usr/bin/env node
// Exact-tip read probe. Never signs, broadcasts, changes a marker or enables a gate.
import { pathToFileURL } from 'node:url';
const HASH = /^[0-9a-f]{64}$/u;
const ACTIVATION = 975856;
const PARENT = '00000000000000000002104a6f2c1984df28fd344cc34453d91da639f03cbd13';
const need = (value, code) => { if (!value) throw new Error(code); };

export function exactTip(value) {
  need(value?.chain === 'main' && value.initialblockdownload === false &&
    Number.isSafeInteger(value.blocks) && value.blocks >= ACTIVATION && HASH.test(value.bestblockhash ?? ''),
  'pay-core-tip-unavailable');
  return { height: value.blocks, blockHash: value.bestblockhash };
}

export async function verifyGate({ core, read, expectedWriteEnabled, checkpoint }) {
  need(typeof expectedWriteEnabled === 'boolean' && Number.isSafeInteger(checkpoint?.height) &&
    checkpoint.height >= ACTIVATION && HASH.test(checkpoint.blockHash ?? ''), 'pay-request-invalid');
  const tip = exactTip(await core('getblockchaininfo', []));
  need(tip.height === checkpoint.height && tip.blockHash === checkpoint.blockHash, 'pay-qualification-checkpoint-stale');
  need(await core('getblockhash', [ACTIVATION - 1]) === PARENT, 'pay-activation-parent-changed');
  const value = await read();
  need(value?.network === 'livenet' && value.complete === true &&
    value.source === 'proof-indexer-exact-canonical-pay-replay' &&
    value.indexedThroughBlock === tip.height && value.indexedThroughBlockHash === tip.blockHash &&
    value.snapshot?.checkpointHeight === tip.height && value.snapshot?.checkpointHash === tip.blockHash &&
    typeof value.snapshot?.id === 'string' && value.snapshot.id.length > 0 &&
    value.activation?.height === ACTIVATION && value.activation.previousBlockHash === PARENT && value.activation.ready === true &&
    value.admission?.ready === true && value.admission.writesEnabled === expectedWriteEnabled &&
    value.pendingComplete === false && Array.isArray(value.invoices), 'pay-reader-not-qualified');
  need(await core('getblockhash', [tip.height]) === tip.blockHash, 'pay-checkpoint-reorganized');
  const after = exactTip(await core('getblockchaininfo', []));
  need(after.height === tip.height && after.blockHash === tip.blockHash, 'pay-tip-changed');
  return { format: 'pay-write-gate-evidence-v1', pins: {}, tip,
    writesEnabled: expectedWriteEnabled, readerQualified: true, snapshotId: value.snapshot.id,
    activationHeight: ACTIVATION, activationParent: PARENT, verifiedAt: new Date().toISOString(), signingExercised: false };
}

async function boundedJson(response, max) {
  need(response.ok && response.body, 'pay-read-unavailable');
  let length = 0; const chunks = [];
  for await (const bytes of response.body) {
    length += bytes.length; need(length <= max, 'pay-response-bound'); chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function runGateProbe(request, { env = process.env, fetchImpl = fetch } = {}) {
  const endpoint = new URL(env.BITCOIN_RPC_URL);
  need(['http:', 'https:'].includes(endpoint.protocol) && !endpoint.username && !endpoint.password &&
    typeof env.BITCOIN_RPC_USER === 'string' && typeof env.BITCOIN_RPC_PASSWORD === 'string', 'pay-rpc-config-invalid');
  const authorization = Buffer.from(env.BITCOIN_RPC_USER + ':' + env.BITCOIN_RPC_PASSWORD).toString('base64');
  const overall = AbortSignal.timeout(35_000);
  const signal = () => AbortSignal.any([overall, AbortSignal.timeout(10_000)]);
  const core = async (method, params) => {
    need(['getblockchaininfo', 'getblockhash'].includes(method), 'pay-rpc-method-forbidden');
    const value = await boundedJson(await fetchImpl(endpoint, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + authorization },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'pay-gate-read', method, params }), signal: signal() }), 65_536);
    need(!value.error && Object.hasOwn(value, 'result'), 'pay-core-read-unavailable'); return value.result;
  };
  const read = async () => boundedJson(await fetchImpl(
    'http://127.0.0.1:8081/api/v1/pay-invoices?network=livenet&fresh=1&limit=1',
    { redirect: 'error', cache: 'no-store', signal: signal() }), 2 * 1024 ** 2);
  return verifyGate({ core, read, ...request });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let raw = ''; for await (const chunk of process.stdin) { raw += chunk; need(raw.length <= 65_536, 'pay-input-bound'); }
    console.log(JSON.stringify(await runGateProbe(JSON.parse(raw))));
  } catch { console.error('Pay gate read qualification failed.'); process.exitCode = 1; }
}
