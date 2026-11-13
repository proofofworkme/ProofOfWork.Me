import { linkedSourceClosure, linkedSourceClosureAsync, createBoundedCapabilityProbe } from "./publish-linked-source.mjs";
import { resolveIndexedPowcatFile } from "./powcat-index.mjs";
import { createHash } from "node:crypto";
import { parsePowcatTransaction } from "../src/shared/protocol/powcat1.mjs";
import { normalizePublishArticleMetadata, publishArticleMetadataFromPayload,
  linkedArticlePointerFromRecords, publishArticleDataCarrierBytes,
  publishLinkedArticleBody } from "../src/shared/protocol/publishArticle.mjs";
import { decodeCanonicalOpReturnOutput } from "./canonical-op-return.mjs";

export const LINKED_ARTICLE_EVIDENCE_MODEL = "canonical-linked-publish-dependencies-v1";
const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const height = value => Number.isSafeInteger(value) && value >= 0;
const sha = value => createHash("sha256").update(value).digest("hex");
const fail = (message, statusCode = 503) => { throw Object.assign(new Error(message), { statusCode }); };
const admitted = new WeakMap();
export const linkedArticleEvidenceForTx = tx => admitted.get(tx) ?? null;

export function linkedArticleRecord(tx) {
  const records = (tx?.vout ?? []).map((output, voutIndex) => ({
    ...decodeCanonicalOpReturnOutput(output), voutIndex,
  })).filter(record => record.prefix);
  const posts = records.filter(record => record.prefix === "pwb1:" && String(record.text).startsWith("pwb1:post:"));
  if (posts.length !== 1) return null;
  const article = publishArticleMetadataFromPayload(posts[0].text);
  if (article?.v !== 2) return null;
  const pointer = linkedArticlePointerFromRecords(records, article, publishArticleDataCarrierBytes(tx));
  return pointer ? { article, pointer, protocolVout: posts[0].voutIndex } : null;
}

// A certificate is not independent chain authority: readers must also bind every
// dependency to current canonical rows and verify the linker's raw commitment.
export function linkedArticleEvidenceMatches(articleInput, position, evidence) {
  const article = normalizePublishArticleMetadata(articleInput);
  if (article?.v !== 2 || evidence?.model !== LINKED_ARTICLE_EVIDENCE_MODEL ||
      evidence.network !== "livenet" || !hash(position?.txid) ||
      !height(position.blockHeight) || !hash(position.blockHash) ||
      !Number.isSafeInteger(position.protocolVout) || position.protocolVout < 0 ||
      evidence.postTxid !== position.txid || evidence.postBlockHeight !== position.blockHeight ||
      evidence.postBlockHash !== position.blockHash || evidence.protocolVout !== position.protocolVout ||
      evidence.metadataSha256 !== sha(JSON.stringify(article)) || evidence.linkerTxid !== article.linkerTxid ||
      evidence.fileHash !== article.sha256 || evidence.size !== article.size ||
      !Array.isArray(evidence.dependencies) || evidence.dependencies.length < 2 || evidence.dependencies.length > 68 ||
      evidence.dependencies.some(d => !d || Object.keys(d).sort().join(",") !== "blockHash,blockHeight,txid" ||
        !hash(d.txid) || !hash(d.blockHash) || !height(d.blockHeight))) return false;
  const [root, ...parts] = evidence.dependencies;
  return root.txid === article.linkerTxid && root.blockHeight < position.blockHeight &&
    parts.every(part => part.blockHeight < root.blockHeight) &&
    new Set(evidence.dependencies.map(d => d.txid)).size === evidence.dependencies.length;
}

export async function verifyLinkedArticle(tx, position, { readFile, blockHashAtHeight, network = "livenet" }) {
  const record = linkedArticleRecord(tx);
  if (!record) return null;
  if (network !== "livenet" || !height(position?.blockHeight) || !hash(position.blockHash) ||
      tx.txid !== position.txid || !hash(tx.txid)) fail("Confirmed linked article position is unavailable.");
  if (await blockHashAtHeight(position.blockHeight) !== position.blockHash) fail("Linked article post was reorganized.");
  const file = await readFile(record.article.linkerTxid, { includeEvidence: true });
  const body = publishLinkedArticleBody(record.article, file);
  if (body === null) fail("Linked article file bytes disagree with the commitment.", 422);
  const evidence = { model: LINKED_ARTICLE_EVIDENCE_MODEL, network, postTxid: tx.txid,
    postBlockHeight: position.blockHeight, postBlockHash: position.blockHash,
    protocolVout: record.protocolVout, metadataSha256: sha(JSON.stringify(record.article)),
    linkerTxid: record.article.linkerTxid, fileHash: record.article.sha256, size: record.article.size,
    dependencies: file.dependencies };
  if (!linkedArticleEvidenceMatches(record.article, { ...position, protocolVout: record.protocolVout }, evidence))
    fail("Linked article requires complete earlier canonical dependencies.", 422);
  // Fence the post after all bounded file calls, not just the file checkpoint.
  if (await blockHashAtHeight(position.blockHeight) !== position.blockHash) fail("Linked article post was reorganized.");
  return { article: record.article, body, evidence };
}

// Pending posts remain unqualified. Temporary RPC faults halt admission rather
// than persisting false rejection. Synchronized absent roots are terminal invalid.
// This derives new records; it never rewrites historical rows.
export async function admitIndexedLinkedArticle(tx, { rpc, network }) {
  admitted.delete(tx);
  const record = linkedArticleRecord(tx);
  if (!record || network !== "livenet") return tx;
  const blockHeight = tx.height ?? tx._powBlockHeight ?? tx.status?.block_height ?? tx.canonicalBlockScan?.height;
  const blockHash = tx._powBlockHash ?? tx.blockhash ?? tx.status?.block_hash ?? tx.canonicalBlockScan?.blockHash;
  if (!height(blockHeight) || !hash(blockHash)) return tx;
  const chain = await rpc("getblockchaininfo", []);
  if (chain?.chain !== "main" || chain.initialblockdownload !== false || !height(chain.blocks) || chain.blocks < blockHeight)
    fail("Linked article admission requires a synchronized main-chain node.");
  const index = await rpc("getindexinfo", ["txindex"]);
  if (index?.txindex?.synced !== true || index.txindex.best_block_height < blockHeight)
    fail("Linked article admission requires synchronized transaction evidence.");
  let root;
  try { root = await rpc("getrawtransaction", [record.article.linkerTxid, true]); }
  catch (error) {
    if ((error?.rpcCode ?? error?.code) === -5) return tx;
    throw error;
  }
  if (!root?.blockhash || !(root.confirmations > 0)) return tx;
  const header = await rpc("getblockheader", [root.blockhash, true]);
  if (!(header?.confirmations > 0)) fail("Linked article linker changed chain.");
  if (!height(header.height) || header.height >= blockHeight) return tx;
  // Reuse the indexer's terminal-invalid versus unavailable distinction for
  // missing/unconfirmed parts. A malformed linker must not stall every block.
  const deadline = Date.now() + 90_000;
  let calls = 0;
  const boundedRpc = async (...args) => {
    if (++calls > 280 || Date.now() > deadline) fail("Linked article index verification exceeded its bound.");
    const result = await rpc(...args);
    if (Date.now() > deadline) fail("Linked article index verification exceeded its bound.");
    return result;
  };
  try {
    const result = await verifyLinkedArticle(tx, { txid: tx.txid, blockHeight, blockHash },
      { readFile: async () => {
        const file = await resolveIndexedPowcatFile(root, { blockHeight: header.height, blockHash: root.blockhash },
          boundedRpc, { includeEvidence: true });
        if (!file) fail("Invalid linked article dependencies.", 422);
        return file;
      }, blockHashAtHeight: h => boundedRpc("getblockhash", [h]), network });
    if (result) admitted.set(tx, result.evidence);
  } catch (error) {
    if (error?.statusCode !== 422) throw error;
  }
  return tx;
}

export function linkedArticleCanonicalProjectionMatches(article, position, evidence, rootHex, dependenciesCanonical) {
  if (dependenciesCanonical !== true || !linkedArticleEvidenceMatches(article, position, evidence)) return false;
  try {
    const root = parsePowcatTransaction(rootHex, article.linkerTxid);
    return root.kind === "manifest" && root.fileHash === article.sha256 && root.size === article.size &&
      root.mime === "text/plain" && JSON.stringify(root.partTxids) === JSON.stringify(evidence.dependencies.slice(1).map(d => d.txid));
  } catch { return false; }
}

// Coalesce only concurrent whole-file verification, never cache a completed
// answer. Every caller still fences its own article post before/after this read.
// An abort-ignoring transport retains its occupied slot until it really settles.
export function createCoalescedLinkedFileReader(readFile, { maxConcurrent = 2, maxWaiters = 16, timeoutMs = 95_000 } = {}) {
  if (typeof readFile !== "function" || !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 2 ||
      !Number.isSafeInteger(maxWaiters) || maxWaiters < 1 || maxWaiters > 16 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 100_000) throw new TypeError("Invalid linked article read bounds.");
  const inflight = new Map();
  return async function read(txid) {
    if (!hash(txid)) fail("Invalid linked article TXID.", 400);
    let job = inflight.get(txid);
    if (!job) {
      if (inflight.size >= maxConcurrent) fail("Linked article verification is busy.", 429);
      const controller = new AbortController();
      job = { waiters: 0 };
      let timeoutReject;
      const timeout = new Promise((_, reject) => { timeoutReject = reject; });
      const timer = setTimeout(() => {
        controller.abort();
        timeoutReject(Object.assign(new Error("Linked article verification timed out."), {statusCode:503}));
      }, timeoutMs);
      const actual = Promise.resolve().then(() => readFile(txid, {includeEvidence:true,signal:controller.signal}));
      job.result = Promise.race([actual, timeout]);
      // Observe rejection even if all consumers already timed out.
      actual.then(() => {clearTimeout(timer);inflight.delete(txid);},
        () => {clearTimeout(timer);inflight.delete(txid);});
      inflight.set(txid,job);
    }
    if (job.waiters >= maxWaiters) fail("Too many linked article readers.", 429);
    job.waiters++;
    try { return await job.result; } finally { job.waiters--; }
  };
}

// Operational writer readiness only. This gate never changes deterministic
// validation of chain records, and is stored outside canonical events/ledgers.
export const PUBLISH_LINKED_CAPABILITY_MODEL = "publish-linked-capability-v2";
export const PUBLISH_LINKED_INDEXER_MODEL = "publish-linked-indexer-ready-v2";
export const publishLinkedCapabilityKey = network => network + ":publish-linked-writer:v2";
const sourceIdentity = linkedSourceClosure;
const loadedSourceIdentity = Object.freeze(sourceIdentity());
export const publishLinkedSourceIdentity = () => ({...loadedSourceIdentity});
export function publishLinkedSourceUnchanged() {
  try { return JSON.stringify(sourceIdentity()) === JSON.stringify(loadedSourceIdentity); } catch { return false; }
}
export async function recordPublishLinkedCapability(client, {network, height: blockHeight, blockHash}) {
  if (network !== "livenet") return;
  if (!height(blockHeight) || !hash(blockHash) || !publishLinkedSourceUnchanged())
    fail("Linked article source identity changed during indexer preparation.");
  const marker = {model:PUBLISH_LINKED_INDEXER_MODEL,version:2,network,
    checkpoint:{height:blockHeight,hash:blockHash},sourceIdentity:publishLinkedSourceIdentity()};
  await client.query("INSERT INTO proof_indexer.meta(key,value,updated_at) VALUES($1,$2::jsonb,now()) " +
    "ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at",
    [publishLinkedCapabilityKey(network),JSON.stringify(marker)]);
}
function publishLinkedReadiness({network, fresh, health, marker, nowMs=Date.now(),
  source = publishLinkedSourceIdentity(), sourceUnchanged = publishLinkedSourceUnchanged()}) {
  const checkpoint = marker?.checkpoint;
  let reason = null;
  const index = health?.checks?.index, node = health?.checks?.node;
  if (network !== "livenet") reason="Linked articles require livenet.";
  else if (!fresh) reason="A fresh capability check is required.";
  else if (!sourceUnchanged) reason="Linked article runtime source changed.";
  else if (marker?.model !== PUBLISH_LINKED_INDEXER_MODEL || marker.version !== 2 || marker.network !== network ||
    (!marker.sourceIdentity || Object.keys(marker.sourceIdentity).length !== Object.keys(source).length ||
      Object.keys(source).some(key => marker.sourceIdentity[key] !== source[key]))) reason="The paired linked article indexer is not qualified.";
  else if (!height(checkpoint?.height) || !hash(checkpoint?.hash) || health?.ready !== true ||
    index?.ok !== true || index.indexedThroughBlock !== checkpoint.height || index.checkpointHash !== checkpoint.hash ||
    node?.chain !== "main" || node.tipHeight !== checkpoint.height || node.bestBlockHash !== checkpoint.hash ||
    !Number.isSafeInteger(node.txindexHeight) || node.txindexHeight < checkpoint.height) reason="The linked article checkpoint is not freshly canonical.";
  return {model:PUBLISH_LINKED_CAPABILITY_MODEL,network,ready:reason===null,readerVersion:2,indexerVersion:2,
    checkpoint:height(checkpoint?.height)&&hash(checkpoint?.hash)?checkpoint:null,
    serverTime:new Date(nowMs).toISOString(),reason};
}

// Readiness is not write authority. Only this wrapper applies the independent
// runtime switch, and a private preactivation receipt is never a capability.
export function publishLinkedWriterCapability(options) {
  const {ready,...value}=publishLinkedReadiness(options);
  const reason=options.enabled===true ? value.reason : "Linked article publication is not enabled.";
  return {...value,enabled:options.enabled===true && ready,reason};
}

// Production route adapter, also exercised by HTTP cadence tests with fake
// chain/wallet services. This controls our writer only, never record validity.
export function createLinkedWriterCapabilityEndpoint({readMarker,readHealth,blockHashAtHeight,readSearch,searchContract,
  enabled,readSource=linkedSourceClosureAsync,loadedSource=publishLinkedSourceIdentity,probeOptions}={}) {
  const probe=createBoundedCapabilityProbe(async()=>{
    const [marker,health]=await Promise.all([readMarker(),readHealth()]);
    const checkpoint=marker?.checkpoint;
    // This must execute the Search reader's fresh canonical generation, parser,
    // body-reference and capacity checks. A feature/version flag is insufficient.
    const search=typeof readSearch==="function"?await readSearch(checkpoint):null;
    const storage=search?.storage;
    const searchReady=searchContract?.model && searchContract?.indexVersion &&
      search?.model===searchContract.model && search.indexVersion===searchContract.indexVersion &&
      search.ready===true && search.fullBodySearch===true && hash(search.parserIdentity) &&
      search.checkpoint?.height===checkpoint?.height && search.checkpoint?.hash===checkpoint?.hash &&
      storage?.model===searchContract.model &&
      [storage.retainedBytes,storage.maxRetainedBytes,storage.physicalBytes,storage.maxPhysicalBytes,storage.minFreeBytes]
        .every(n=>Number.isSafeInteger(n)&&n>=0) &&
      storage.retainedBytes<storage.maxRetainedBytes && storage.physicalBytes<storage.maxPhysicalBytes &&
      typeof storage.freeBytes==="string" && /^(0|[1-9]\d*)$/u.test(storage.freeBytes) &&
      BigInt(storage.freeBytes)>=BigInt(storage.minFreeBytes);
    const fence=Number.isSafeInteger(checkpoint?.height)?await blockHashAtHeight(checkpoint.height):null;
    // Source fence follows the last health/chain await, not an earlier cached read.
    const source=await readSource();
    const sourceUnchanged=JSON.stringify(source)===JSON.stringify(loadedSource());
    let value=publishLinkedReadiness({network:"livenet",fresh:true,health,marker,source,sourceUnchanged});
    if(value.ready && !searchReady) value={...value,ready:false,reason:"Full linked article Search is not freshly qualified."};
    if(value.ready && fence!==checkpoint?.hash) value={...value,ready:false,reason:"The linked article checkpoint changed."};
    return {...value,sourceIdentity:source,search};

  },probeOptions);
  const endpoint=async ({network,fresh})=>{
    let value=publishLinkedWriterCapability({network,fresh,enabled:false,health:null,marker:null,
      source:loadedSource(),sourceUnchanged:false});
    if(network==="livenet" && fresh && enabled()) {
      try {
        const {ready,sourceIdentity,search,...receipt}=await probe();
        value={...receipt,enabled:enabled()===true && ready,
          reason:enabled()===true ? receipt.reason : "Linked article publication is not enabled."};
      } catch {value={...value,reason:"Fresh linked article readiness is unavailable or busy."};}
    }
    return value;
  };
  // Called only by the existing authenticated loopback verifier route. It shares
  // the exact bounded probe with public admission, never changes configuration,
  // and refuses to certify preactivation if writes are enabled at either fence.
  endpoint.preactivation=async ({network,fresh})=>{
    const started=performance.now();
    let value={model:"publish-linked-preactivation-v1",network,ready:false,enabled:false,
      writesEnabled:enabled()===true,serverTime:new Date().toISOString(),
      reason:"Preactivation requires livenet, a fresh probe, and disabled writes."};
    if(network==="livenet" && fresh===true && enabled()===false) {
      try {
        const receipt=await probe(),writesEnabled=enabled()===true;
        value={...receipt,model:"publish-linked-preactivation-v1",enabled:false,writesEnabled,
          ready:receipt.ready===true && !writesEnabled,
          reason:writesEnabled ? "Writes became enabled during preactivation." : receipt.reason};
      } catch {value={...value,writesEnabled:enabled()===true,reason:"Fresh linked article readiness is unavailable or busy."};}
    }
    return {...value,elapsedMs:Math.round((performance.now()-started)*1000)/1000};
  };
  return endpoint;
}
