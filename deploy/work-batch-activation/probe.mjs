#!/usr/bin/env node
// Read-only evidence probe. Imports no API entrypoint; errors contain fixed codes only.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const fail = code => { throw new Error(code); };
const need = (value, code) => { if (!value) fail(code); };
const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const same = isDeepStrictEqual;
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function exactTip(value) {
  need(value?.chain === "main" && Number.isSafeInteger(value.blocks) && value.blocks > 0 &&
    hash(value.bestblockhash) && value.initialblockdownload === false, "core-tip-unavailable");
  return { height: value.blocks, blockHash: value.bestblockhash };
}

export function requireV8(value, tip) {
  need(value && ["writeAdmission", "protocolReady", "evidenceComplete", "indexReady"]
    .every(key => value[key] === true) && value.activation?.tipVerified === true &&
    value.tipHeight === tip.height && value.tipHash === tip.blockHash, "v8-write-admission-unavailable");
}

export function requireTransition(wrapper, tip, activation, normalizePins) {
  const p = wrapper?.payload;
  need(wrapper?.blockHeight === tip.height && wrapper?.blockHash === tip.blockHash &&
    p?.blockHeight === tip.height && p.blockHash === tip.blockHash && p.network === "livenet" &&
    ["complete", "blockAtomic", "feeOnce", "invalidZero"].every(key => p[key] === true) &&
    hash(p.transitionChainCommitment?.sha256) &&
    p.workBatchV1?.activationHeight === activation.activationHeight &&
    same(normalizePins({ ...p.workBatchV1.declaration, activationHeight: p.workBatchV1.activationHeight }), activation.declaration) &&
    same(p.workBatchV1.evidenceCommitment, activation.evidenceCommitment),
  "batch-transition-parity-unavailable");
  return p;
}

export async function verifyEvidence(d) {
  const tip = exactTip(await d.core("getblockchaininfo", []));
  const validation = d.validateMarker(await d.readMarker());
  need(validation?.valid === true, "batch-marker-unavailable");
  const marker = validation.marker;
  const pins = marker.declaration;
  need(tip.height >= pins.activationHeight, "batch-activation-not-reached");
  if (d.expectedPins) need(same(d.normalizePins(d.expectedPins), pins), "batch-pins-conflict");
  await d.verifySelection(pins);
  const activation = await d.loadActivation(pins, tip);
  need(activation?.active === true && activation.canonical === true && activation.confirmed === true &&
    activation.evidenceComplete === true && same(activation.declaration, pins) &&
    same(activation.evidenceCommitment, marker.evidenceCommitment), "batch-core-marker-conflict");
  const activationTip = { height: marker.activationHeight, blockHash: marker.activationBlock.hash };
  need(await d.core("getblockhash", [activationTip.height]) === activationTip.blockHash,
    "batch-activation-reorg");
  const activationTransition = await d.readTransition(activationTip);
  requireTransition(activationTransition, activationTip, activation, d.normalizePins);
  need(same(d.markerFromTransition(activationTransition), marker), "batch-activation-transition-conflict");
  const current = requireTransition(await d.readTransition(tip), tip, activation, d.normalizePins);
  requireV8(await d.readV8(), tip);
  const status = await d.readBatch();
  need(status?.protocol === "work-batch-v1" && status.network === "livenet" && status.active === true &&
    status.writeEnabled === d.expectedWriteEnabled && status.ready === d.expectedWriteEnabled &&
    status.declarationTxid === pins.txid && status.activationHeight === pins.activationHeight &&
    status.checkedTipHeight === tip.height && status.checkedTipHash === tip.blockHash &&
    status.registryFeeProofs === 546 && same(status.limits,
      { minRecipients: 2, maxRecipients: 256, maxPayloadBytes: 65536 }), "batch-api-parity-unavailable");
  need(same(exactTip(await d.core("getblockchaininfo", [])), tip), "core-tip-changed");
  need(same(d.validateMarker(await d.readMarker()).marker, marker), "batch-marker-changed");
  return { format: "work-batch-activation-evidence-v1", pins,
    tip, markerSha256: digest(marker), evidenceCommitment: marker.evidenceCommitment,
    activationTransitionCommitment: marker.activationBlock.transitionChainCommitment,
    currentTransitionCommitment: current.transitionChainCommitment,
    v8WriteAdmission: true, verifiedAt: new Date().toISOString() };
}

export function hydrateRawTransaction(raw, wanted, Transaction) {
  need(raw?.txid === wanted && typeof raw.hex === "string" && /^[0-9a-f]+$/u.test(raw.hex) &&
    raw.hex.length % 2 === 0 && raw.hex.length <= 8_000_000, "core-transaction-unavailable");
  const tx = Transaction.fromHex(raw.hex);
  need(tx.getId() === wanted, "core-transaction-binding");
  need(tx.ins.length > 0, "core-inputs-unavailable");
  return { txid: wanted, hex: raw.hex,
    vin: tx.ins.map(input => ({ txid: Buffer.from(input.hash).reverse().toString("hex"),
      vout: input.index, sequence: input.sequence, scriptsig: Buffer.from(input.script).toString("hex") })),
    vout: tx.outs.map(output => {
      need(BigInt(output.value) <= BigInt(Number.MAX_SAFE_INTEGER), "core-value-range");
      return { value: Number(output.value), scriptpubkey: Buffer.from(output.script).toString("hex") };
    }),
    status: { confirmed: Number(raw.confirmations) > 0, block_hash: raw.blockhash } };
}

export function canonicalCandidateIsCoinbase(candidate, decoded, block, canonicalHash) {
  const index = block.tx?.indexOf(decoded.txid);
  need(decoded.status.confirmed && block.hash === decoded.status.block_hash &&
    block.hash === candidate.blockHash && block.height === candidate.blockHeight &&
    index === candidate.blockTransactionIndex && index >= 0 && canonicalHash === block.hash,
    "candidate-canonical-mismatch");
  return index === 0;
}

async function boundedJson(response, maxBytes = 4_000_000) {
  need(response.ok, "http-evidence-unavailable");
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length; need(bytes <= maxBytes, "http-evidence-oversized"); chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function readRequest() {
  const input = readFileSync(0, "utf8");
  need(Buffer.byteLength(input, "utf8") <= 65536, "probe-request-oversized");
  return JSON.parse(input);
}

export async function main() {
  // Python supplies the already fenced API environment in memory. No environment
  // files, response bodies, credentials, raw transactions or private errors are printed.
  const root = "/opt/proofofwork-api";
  const request = readRequest();
  const load = path => import(pathToFileURL(root + "/" + path).href);
  const declaration = await load("server/work-batch-declaration.mjs");
  const runtime = await load("server/work-batch-runtime.mjs");
  const selection = await load("server/work-batch-selection.mjs");
  const reader = await load("server/db/proof-index-reader.mjs");
  const protocol = await load("server/canonical-op-return.mjs");
  const { Transaction, address, networks } = createRequire(root + "/package.json")("bitcoinjs-lib");
  const registryScript = Buffer.from(address.toOutputScript(
    declaration.WORK_BATCH_DECLARATION_REGISTRY_ADDRESS, networks.bitcoin)).toString("hex");
  const endpoint = new URL(process.env.BITCOIN_RPC_URL);
  need(["http:", "https:"].includes(endpoint.protocol) && !endpoint.username && !endpoint.password,
    "core-endpoint-invalid");
  const authorization = Buffer.from(String(process.env.BITCOIN_RPC_USER) + ":" +
    String(process.env.BITCOIN_RPC_PASSWORD)).toString("base64");
  const core = async (method, params) => {
    need(["getblockchaininfo", "getblockhash", "getblock", "getrawtransaction"].includes(method),
      "core-method-forbidden");
    const value = await boundedJson(await fetch(endpoint, { method: "POST", redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: "Basic " + authorization },
      body: JSON.stringify({ jsonrpc: "1.0", id: "batch-activation-read", method, params }),
      signal: AbortSignal.timeout(10_000) }), 32_000_000);
    need(!value.error && Object.hasOwn(value, "result"), "core-evidence-unavailable");
    return value.result;
  };
  const getTransaction = async (txid, raw = null, firstInputOnly = false) => {
    const tx = hydrateRawTransaction(raw ?? await core("getrawtransaction", [txid, true]), txid, Transaction);
    need(tx.status.confirmed && hash(tx.status.block_hash), "core-unconfirmed-declaration");
    // Bind every prevout to its raw transaction ID. Core's canonical inclusion
    // supplies consensus validity; raw decoding supplies exact script/value bytes.
    for (const input of firstInputOnly ? tx.vin.slice(0, 1) : tx.vin) {
      const prev = hydrateRawTransaction(await core("getrawtransaction", [input.txid, true]), input.txid, Transaction);
      need(prev.vout[input.vout], "core-prevout-unavailable");
      input.prevout = prev.vout[input.vout];
    }
    return { ...tx, _powCanonicalRpcHydration: true };
  };
  const validateCandidate = async candidate => {
    const raw = await core("getrawtransaction", [candidate.txid, true]);
    const decoded = hydrateRawTransaction(raw, candidate.txid, Transaction);
    need(decoded.status.confirmed && hash(decoded.status.block_hash), "candidate-unconfirmed");
    const block = await core("getblock", [decoded.status.block_hash, 1]);
    const index = block.tx?.indexOf(decoded.txid);
    // Only Core-proven position zero can be excluded before prevout hydration.
    if (canonicalCandidateIsCoinbase(candidate, decoded, block,
        await core("getblockhash", [block.height]))) return null;
    const first = await getTransaction(candidate.txid, raw, true);
    if (first.vin[0].prevout.scriptpubkey !== declaration.WORK_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY) return null;
    const tx = await getTransaction(candidate.txid, raw);
    const record = declaration.workBatchDeclarationCommitment().protocolRecord;
    const carriers = tx.vout.flatMap((output, i) =>
      protocol.canonicalProtocolCandidateFromOutput(output)?.text === record ? [i] : []);
    const payments = tx.vout.flatMap((output, i) =>
      output.scriptpubkey === registryScript && output.value >= 546 ? [i] : []);
    if (carriers.length !== 1 || payments.length !== 1) return null;
    const pins = { txid: tx.txid, blockHeight: block.height, blockHash: block.hash,
      blockTransactionIndex: index, protocolVout: carriers[0], recordOrdinal: 0,
      registryPaymentVout: payments[0], activationHeight: block.height + 1 };
    const evidence = declaration.workBatchDeclarationEvidenceFromTransaction({
      ...tx, status: { ...tx.status, block_height: block.height }, _powBlockIndex: index }, pins, { canonical: true });
    return evidence.evidenceComplete === true ? declaration.normalizeWorkBatchDeclarationPins(pins) : null;
  };
  const port = process.env.PORT ?? "8081";
  need(/^[1-9][0-9]*$/u.test(port) && Number(port) <= 65535, "api-port-invalid");
  try {
    const result = await verifyEvidence({
      core, expectedPins: request.expectedPins, expectedWriteEnabled: request.expectedWriteEnabled,
      normalizePins: declaration.normalizeWorkBatchDeclarationPins,
      validateMarker: declaration.validateWorkBatchActivationMarker,
      markerFromTransition: declaration.workBatchActivationMarkerFromTransition,
      readMarker: () => reader.proofIndexWorkBatchActivationMarker("livenet"),
      readTransition: tip => reader.proofIndexWorkAmoBlockTransition("livenet", tip.height, tip.blockHash),
      verifySelection: pins => selection.verifyWorkBatchDeclarationSelection({ pins,
        readCandidates: options => reader.proofIndexWorkBatchDeclarationCandidates("livenet", options),
        validateCandidate, maxCandidates: 64, completeDiscovery: true,
        verifyCheckpoint: async cp => await core("getblockhash", [cp.blockHeight]) === cp.blockHash }),
      loadActivation: (pins, tip) => runtime.loadWorkBatchActivation({
        configuration: { requested: true, pins, writesEnabled: false },
        blockHeight: tip.height, blockHash: tip.blockHash,
        getBlockHash: height => core("getblockhash", [height]),
        getBlock: blockHash => core("getblock", [blockHash, 1]), getTransaction }),
      readBatch: async () => boundedJson(await fetch(
        "http://127.0.0.1:" + port + "/api/v1/work-batch-status",
        { redirect: "error", signal: AbortSignal.timeout(25_000) })),
      readV8: async () => (await boundedJson(await fetch(
        "http://127.0.0.1:" + port + "/api/v1/work-floor?fresh=1",
        { redirect: "error", signal: AbortSignal.timeout(25_000) }))).workAmoV8,
    });
    process.stdout.write(JSON.stringify(result) + "\n");
  } finally { await reader.closeProofIndexReadPool(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write("activation-evidence-unavailable\n"); process.exitCode = 1; });
}
