import { createHash } from 'node:crypto';
import { Transaction } from 'bitcoinjs-lib';
import { parsePowcatOutputScript, POWCAT_MAX_FILE_BYTES, POWCAT_MAX_PART_BYTES, POWCAT_MAX_PARTS } from '../src/shared/protocol/powcat1.mjs';
import { parsePowcatPointer, POWCAT_MAIL_MIME } from '../src/shared/protocol/powcatMail.mjs';

const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const bounded = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const prefix = Buffer.from('powcat1:').toString('hex');
const maxScriptHex = 200_000;

function carrier(hex) {
  if (typeof hex !== 'string' || hex.length < 22 || hex.slice(0,2) !== '6a') return null;
  const op = Number.parseInt(hex.slice(2,4),16);
  const pos = op > 0 && op < 76 ? 4 : op === 76 ? 6 : op === 77 ? 8 : op === 78 ? 12 : 0;
  if (!pos || !['70','6d'].some(tag => hex.slice(pos,pos+prefix.length+2).toLowerCase() === prefix+tag)) return null;
  const checked = hex.length <= maxScriptHex && hex.length % 2 === 0 && /^[a-f0-9]+$/iu.test(hex);
  if (checked) {
    try {
      const record = parsePowcatOutputScript(Buffer.from(hex,'hex'));
      return record.kind === 'part'
        ? {kind:'part', fileHash:record.fileHash, partHash:record.partHash, index:record.index, count:record.count, size:record.bytes.byteLength}
        : {kind:'linker', fileHash:record.fileHash, name:record.name, mime:record.mime, size:record.size, count:record.partTxids.length, partTxids:record.partTxids};
    } catch { /* Recognized but malformed carriers still have bounded evidence. */ }
  }
  return {kind:'malformed', scriptHexSha256:createHash('sha256').update(hex).digest('hex'), scriptBytes:Math.floor(hex.length/2)};
}

function eventMetadata(kind, value) {
  if (!value || !hash(value.fileHash)) return null;
  if (kind === 'powcat-part' && hash(value.partHash) && bounded(value.count,POWCAT_MAX_PARTS) &&
      value.count > 0 && bounded(value.index,value.count-1) && value.size > 0 && bounded(value.size,POWCAT_MAX_PART_BYTES)) {
    return {kind:'part', fileHash:value.fileHash, partHash:value.partHash, index:value.index, count:value.count, size:value.size};
  }
  if (kind === 'powcat-linker' && Array.isArray(value.partTxids) && value.partTxids.length > 0 &&
      value.partTxids.length <= POWCAT_MAX_PARTS && value.partTxids.every(hash) && new Set(value.partTxids).size === value.partTxids.length &&
      value.size > 0 && bounded(value.size,POWCAT_MAX_FILE_BYTES) && typeof value.name === 'string' && value.name.length > 0 &&
      Buffer.byteLength(value.name) <= 255 && !/[\\/\u0000-\u001f\u007f-\u009f]/u.test(value.name) &&
      typeof value.mime === 'string' && value.mime.length <= 127 && /^[a-z0-9][a-z0-9!#$&^_.+\-]*\/[a-z0-9][a-z0-9!#$&^_.+\-]*$/u.test(value.mime)) {
    return {kind:'linker', fileHash:value.fileHash, name:value.name, mime:value.mime, size:value.size,
      count:value.partTxids.length, partTxids:value.partTxids};
  }
  return null;
}

function transactionCarriers(source) {
  let scripts = source.payload?.vout;
  const rawHasMarker = typeof source.rawHex === 'string' && source.rawHex.length <= 800_000 && source.rawHex.toLowerCase().includes(prefix);
  if (rawHasMarker) {
    try {
      const tx = Transaction.fromHex(source.rawHex);
      if (tx.getId() === source.txid) scripts = tx.outs.map(out => ({scriptpubkey:Buffer.from(out.script).toString('hex')}));
    } catch { /* Fall back to the original indexed output scripts. */ }
  }
  return Array.isArray(scripts) ? scripts.flatMap((output, index) => {
    const metadata = carrier(output?.scriptpubkey ?? output?.scriptPubKey?.hex);
    return metadata ? [{ vout:index, ...metadata }] : [];
  }) : [];
}

// Raw physical bytes remain in the immutable source tables and node. The
// source_hash covering those bytes is retained in Search and rechecked on reads.
export function compactPowcatSearchSource(source) {
  if (!source || typeof source !== 'object') return source;
  let metadata, records;
  const event = source.protocol === 'powcat1' && source.sourceClass === 'event';
  if (event) metadata = eventMetadata(source.kind,source.payload?.powcat) ?? { kind:'malformed' };
  else if (source.sourceClass === 'carrier' || source.sourceClass === 'script') {
    metadata = carrier(source.scriptHex ?? source.payload?.scriptHex);
  } else if (source.sourceClass === 'transaction') records = transactionCarriers(source);
  if (!metadata && !records?.length) return source;
  const {rawHex, scriptHex, contentBase64, attachmentCarriers, file, ...compact} = source;
  const payload = records ? {powcatOutputs:records} : {powcat:metadata};
  const title = records ? 'Linked file transaction' : metadata.kind === 'linker' ? metadata.name :
    metadata.kind === 'part' ? `File part ${metadata.index+1} of ${metadata.count}` : 'Unverified linked file carrier';
  const marker = metadata?.kind === 'part' ? 'powcat1:p' : metadata?.kind === 'linker' ? 'powcat1:m' : 'powcat1';
  return {...compact, protocol:source.sourceClass === 'transaction' ? 'transaction' : 'powcat1',
    payload:{...payload,title}, rawPayload:marker, ...(event && metadata.kind === 'malformed' ? {valid:false} : {})};
}

export function linkedFileEvidence(source, verifiedPointer) {
  if (source.protocol === 'powcat1' && source.sourceClass === 'event' && source.kind === 'powcat-linker' &&
      source.payload?.powcat?.kind === 'linker') {
    const file = source.payload.powcat;
    return {type:'linker',txid:source.txid,fileHash:file.fileHash,name:file.name,mime:file.mime,size:file.size};
  }
  if (source.protocol !== 'pwm1' || verifiedPointer?.file.mimeType !== POWCAT_MAIL_MIME || verifiedPointer.bytes.length !== 139) return null;
  const pointer = parsePowcatPointer(verifiedPointer.bytes.toString('utf8'));
  return pointer ? {type:'mail-pointer',...pointer,name:verifiedPointer.file.name} : null;
}

export async function searchPowcatCoverage(client, network, height, blockHash) {
  if (network !== 'livenet') return {ready:false, reason:'mainnet-only'};
  const result = await client.query(`SELECT value,(SELECT block_hash FROM proof_indexer.blocks
    WHERE network=$2 AND height=$3 AND canonical=true) AS checkpoint_hash
    FROM proof_indexer.meta WHERE key=$1`, ['livenet:powcat1:discovery:v1',network,height]);
  const state = result.rows[0]?.value;
  const selectedHash = blockHash ?? result.rows[0]?.checkpoint_hash;
  const fromHeight = 973975, anchorHash = '0000000000000000000197a8d7eeab4e20eae8693e7bb933edd89a75031933e3';
  const ready = state?.network === network && state.model === 'powcat1-discovery-v1' && state.fromHeight === fromHeight &&
    state.anchorHash === anchorHash && state.complete === true && bounded(state.confirmedParts,Number.MAX_SAFE_INTEGER) &&
    bounded(state.confirmedLinkers,Number.MAX_SAFE_INTEGER) && state.indexedThroughBlock === Number(height) &&
    hash(selectedHash) && state.indexedThroughBlockHash === selectedHash;
  return {ready,fromHeight,anchorHash,...(ready ? {checkpointHeight:Number(height),checkpointHash:selectedHash,confirmedParts:state.confirmedParts,confirmedLinkers:state.confirmedLinkers} : {reason:'discovery-checkpoint-unverified'})};
}

// Counts and hashes apply only to confirmed, canonical typed events. Empty
// groups are evidence only when a completed source scan was bound to this run.
export function qualifiedPowcatSearchCoverage(stored, fresh, rows) {
  const current = fresh?.linkedFiles;
  if (!current?.ready || stored?.linkedFiles?.ready !== true ||
      stored.linkedFiles.checkpointHeight !== current.checkpointHeight || stored.linkedFiles.checkpointHash !== current.checkpointHash) {
    return {...current,ready:false,reason:'discovery-checkpoint-unverified'};
  }
  const materialized = {};
  for (const row of rows) {
    if (row.protocol !== 'powcat1' || row.status !== 'confirmed' || row.type !== 'event' || !Number(row.typed_count)) continue;
    materialized[`${row.kind}/${row.valid}`] = [Number(row.typed_count),row.typed_hash];
  }
  const expected = fresh.powcatGroups;
  const equal = groups => groups && expected && Object.keys(groups).length === Object.keys(expected).length &&
    Object.keys(expected).every(k => groups[k]?.[0] === expected[k][0] && groups[k]?.[1] === expected[k][1]);
  const counted = expected && current.confirmedParts === (expected['powcat-part/true']?.[0] ?? 0) &&
    current.confirmedLinkers === (expected['powcat-linker/true']?.[0] ?? 0) &&
    stored.linkedFiles.confirmedParts === current.confirmedParts && stored.linkedFiles.confirmedLinkers === current.confirmedLinkers;
  return counted && equal(stored.powcatGroups) && equal(materialized) ? {...current,typedEvents:Object.values(expected).reduce((n,[count]) => n+count,0)} :
    {...current,ready:false,reason:'typed-event-witness-mismatch'};
}
