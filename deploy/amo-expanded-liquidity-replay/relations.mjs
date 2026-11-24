import { address, networks } from "bitcoinjs-lib";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS, WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS } from "../../server/work-amo-v5.mjs";
import { RESOURCE_LIMITS } from "../work-batch-replay/preflight.mjs";

// The aggregate record budget is separate. Multipart carriers and derived rows have
// the same per-block ceiling as the native transition header and publication plan.
export const MAX_GOVERNED_ROWS_PER_BLOCK = 65536;
const emptyHash = createHash("sha256").update(Buffer.from([1, 0x5b, 0x5d])).digest("hex");
const sha256 = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const decimal = value => typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value);
const protocols = ["pwm1", "pwa1", "pwid1", "pwdns1", "pwb1", "pwt1", "pwc1"];
const protocolSql = "ARRAY['pwm1','pwa1','pwid1','pwdns1','pwb1','pwt1','pwc1']::text[]";
const checked = (value, message) => { if (!value) throw new Error("AMO governed relations: " + message); };

const relationRows = `WITH block_transactions AS MATERIALIZED (
  SELECT t.txid,t.block_index,t.fee_sats::text AS fee
  FROM proof_indexer.transactions t JOIN proof_indexer.blocks b ON
    b.network=t.network AND b.height=t.block_height AND b.block_hash=t.block_hash AND b.canonical
  WHERE t.network='livenet' AND t.status='confirmed' AND t.block_height=$1 AND t.block_hash=$2
), event_rows AS MATERIALIZED (
  SELECT to_jsonb(e) AS doc,t.txid,t.block_index,t.fee,e.event_id FROM block_transactions t
  JOIN proof_indexer.events e ON e.network='livenet' AND e.txid=t.txid
  WHERE e.status='confirmed' AND e.protocol=ANY(${protocolSql})
  UNION ALL
  SELECT to_jsonb(e),e.txid,NULL::integer,NULL::text,e.event_id FROM proof_indexer.events e
  WHERE e.network='livenet' AND e.status='confirmed' AND e.block_height=$1 AND e.protocol=ANY(${protocolSql})
    AND NOT EXISTS(SELECT 1 FROM block_transactions t WHERE t.txid=e.txid)
  LIMIT ${MAX_GOVERNED_ROWS_PER_BLOCK+1}
), record_rows AS MATERIALIZED (
  SELECT to_jsonb(r) AS doc,t.txid,t.block_index,t.fee FROM block_transactions t
  JOIN proof_indexer.op_returns r ON r.network='livenet' AND r.txid=t.txid
  WHERE r.protocol=ANY(${protocolSql}) LIMIT ${MAX_GOVERNED_ROWS_PER_BLOCK+1}
)`;

// Each leaf commits the entire physical row and its canonical transaction join.
// Hash the leaves individually to avoid constructing a single block-sized copy of
// all enriched event documents. The v2 preimage is used by every fresh fence.
const leaf = "encode(sha256(jsonb_send(jsonb_build_array('amo-governed-relational-row-v2',$1::integer,$2::text,txid,block_index,fee,doc))),'hex')";
const setHash = order => `encode(sha256(jsonb_send(COALESCE(jsonb_agg(${leaf} ORDER BY ${order}),'[]'::jsonb))),'hex')`;
export const GOVERNED_RELATIONAL_BINDINGS_SQL = `${relationRows}
SELECT (SELECT count(*)::int FROM event_rows) AS "eventCount",
  (SELECT ${setHash("event_id")} FROM event_rows) AS "eventRowsSha256",
  (SELECT count(*)::int FROM record_rows) AS "recordCount",
  (SELECT ${setHash("block_index,txid COLLATE \"C\",(doc->>'vout')::int,(doc->>'output_index')::int")} FROM record_rows) AS "recordRowsSha256"`;

// Compare the same scalar that upsertEvent writes from its normalized item.
// A later partial JSON merge cannot turn a disagreeing physical column into evidence.
const storedAmount = "COALESCE(doc#>>'{payload,amountSats}',doc#>>'{payload,paidSats}',doc#>>'{payload,priceSats}'," +
  "doc#>>'{payload,mintPriceSats}',doc#>>'{payload,creationFeeSats}',doc#>>'{payload,mutationFeeSats}',doc#>>'{payload,feeSats}','0')";
const storedBytes = "COALESCE(doc#>>'{payload,dataBytes}',doc#>>'{payload,protocolBytes}',doc#>>'{payload,sizeBytes}','0')";

const projectionSql = `${relationRows}, physical AS MATERIALIZED (
  SELECT jsonb_build_object('txid',txid,'blockIndex',block_index,
  'vout',doc->'vout','outputIndex',doc->'output_index','protocol',doc->'protocol',
  'payloadHex',doc->'payload_hex','payloadText',doc->'payload_text','dataBytes',doc->'data_bytes') AS item
  FROM record_rows), outcomes AS MATERIALIZED (
  SELECT jsonb_build_object('txid',txid,'blockHeight',doc->'block_height',
  'blockIndex',CASE WHEN (doc->>'block_index')::int=block_index THEN block_index END,
  'vout',doc->'op_return_vout','ordinal',doc->'record_ordinal','protocol',doc->'protocol',
  'kind',doc->'kind','valid',doc->'valid','rawPayload',doc->'raw_payload','feeSats',fee,
  'amountSats',CASE WHEN ${storedAmount}=doc->>'amount_sats' THEN doc->>'amount_sats' END,
  'dataBytes',CASE WHEN ${storedBytes}=doc->>'data_bytes' THEN doc->'data_bytes' END,
  'validationErrors',doc->'validation_errors','bound',doc#>'{payload,_workAmoV5ReplayBound}',
  'rawCandidate',doc#>'{payload,workAmoV5RawCandidate}','outcome',doc#>'{payload,workAmoV5ReplayOutcome}',
  'rawWitness',doc#>'{payload,workAmoV5ReplayRawWitness}','replayOutput',doc#>'{payload,workAmoV5ReplayOutput}',
  'derivedId',doc#>'{payload,derivedId}') AS item FROM event_rows)
SELECT CASE WHEN (SELECT COALESCE(sum(octet_length(jsonb_send(item))),0) FROM physical) <= ${RESOURCE_LIMITS.maxNativePayloadBytesPerBlock}
  THEN (SELECT COALESCE(jsonb_agg(item),'[]'::jsonb) FROM physical) END AS records,
 CASE WHEN (SELECT COALESCE(sum(octet_length(jsonb_send(item))),0) FROM outcomes) <= ${RESOURCE_LIMITS.maxNativePayloadBytesPerBlock}
  THEN (SELECT COALESCE(jsonb_agg(item),'[]'::jsonb) FROM outcomes) END AS events`;

export function verifyGovernedRelationalBindings(bindings) {
  checked(bindings && equal(Object.keys(bindings).sort(),["eventCount","eventRowsSha256","recordCount","recordRowsSha256"]),
    "invalid relational binding keys");
  for (const key of ["event", "record"]) {
    const count = bindings?.[key + "Count"], digest = bindings?.[key + "RowsSha256"];
    checked(integer(count) && count <= MAX_GOVERNED_ROWS_PER_BLOCK && sha256(digest) &&
      ((count === 0) === (digest === emptyHash)), "invalid " + key + " bindings");
  }
  return bindings;
}

export async function readRelationalEvidence(client, height, hash) {
  checked(integer(height) && sha256(hash), "invalid block identity");
  const args = [height, hash];
  const query = async sql => {
    const { rows } = await client.query(sql, args);
    checked(rows.length === 1, "expected one relational result");
    return rows[0];
  };
  const bindings = await query(GOVERNED_RELATIONAL_BINDINGS_SQL);
  verifyGovernedRelationalBindings(bindings);
  if (!bindings.eventCount && !bindings.recordCount) return { bindings, records: [], events: [] };
  return { bindings, ...await query(projectionSql) };
}

const key = (txid, vout, ordinal) => JSON.stringify([txid, vout, ordinal]);
function add(map, identity, row) {
  checked(!map.has(identity), "duplicate canonical position");
  map.set(identity, row);
}

function storedKind(descriptor, raw) {
  const { valid, semanticKind } = descriptor.outcome;
  checked(typeof valid === "boolean" && typeof semanticKind === "string" && semanticKind.length, "invalid semantic outcome");
  checked(semanticKind === descriptor.output?.projection?.kind, "stored kind lacks its replay projection");
  if (!valid && descriptor.protocol === "pwid1") return "id-event-invalid";
  // The raw PWB evaluator observes a Boost carrier; the event writer keeps the
  // wire action's concrete kind. Its accepted aliases follow boostItemFromMessage.
  if (descriptor.protocol === "pwb1" && semanticKind === "boost-event") {
    const parts = raw.message.split(":"), action = parts[1]?.trim().toLowerCase();
    const aliases = {repost:"reboost", tip2:"tip", t:"transfer", list5:"list", seal5:"seal", delist5:"delist", buy5:"buy"};
    const ordinary = ["tip","profile","follow","unfollow","post","reply","like","reboost","hide"];
    checked(Object.hasOwn(aliases, action) || ordinary.includes(action), "unsupported Boost action");
    checked(action !== "t" || parts.length === 4, "unsupported Boost transfer shape");
    return "boost-" + (aliases[action] ?? action) + (valid ? "" : "-invalid");
  }
  return valid || semanticKind.endsWith("-invalid") ? semanticKind : semanticKind + "-invalid";
}

// baseProtocolItem sums positive address-bearing outputs before the first carrier.
// Derive address recognition from the authenticated script, never from database JSON.
function paymentOutputs(raw, before = raw.tx?.vout?.length) {
  const outputs = raw.tx?.vout;
  checked(Array.isArray(outputs) && outputs.length > raw.position.protocolVout, "raw payment outputs unavailable");
  const payments = [];
  for (const output of outputs.slice(0,before)) {
    checked(integer(output.value) && typeof output.scriptpubkey === "string", "invalid raw payment output");
    try {
      const recipient = address.fromOutputScript(Buffer.from(output.scriptpubkey,"hex"),networks.bitcoin);
      if (output.value > 0) payments.push({recipient,value:BigInt(output.value)});
    } catch { continue; }
  }
  return payments;
}

const tokenFlow = {
  "token-create":"tokenCreationFlowSats", "token-mint":"tokenMintFlowSats",
  "token-transfer":"tokenTransferFlowSats", "token-transfer-batch":"tokenTransferFlowSats",
  "token-listing":"tokenMarketplaceFeeSats", "token-listing-sealed":"tokenMarketplaceFeeSats",
  "token-listing-closed":"tokenMarketplaceFeeSats", "token-sale":"tokenSaleVolumeSats",
};
function accounting(record, raw, transactionBytes) {
  const ownBytes = raw.rawRecordParts.reduce((sum,part) => sum + part.payloadHex.length/2,0);
  const kind = record.outcome.semanticKind;
  if (record.protocol === "pwc1") return {amountSats:"0",dataBytes:0};
  if (record.rawCandidate === false) {
    if (["token-mint","token-transfer"].includes(kind)) return {amountSats:"0",dataBytes:0};
    if (kind === "token-listing-closed") return {amountSats:"546",dataBytes:transactionBytes};
    if (kind === "id-listing-closed" && record.protocol === "pwid1") {
      // The ID buy parent alone owns the economic output. Its closure is a recovered
      // reporting row with no independent amount or byte count in the native descriptor.
      return {amountSats:null,dataBytes:null};
    }
    throw new Error("AMO governed relations: unclassified derived event accounting " + kind);
  }
  // DNS root and subdomain items also retain baseProtocolItem accounting;
  // DNS has no token/ID recovery endpoint that replaces its amount with a registry fee.
  if (["pwm1","pwb1","pwdns1"].includes(raw.protocol)) {
    const payments = paymentOutputs(raw,raw.position.protocolVout);
    return {amountSats:payments.reduce((sum,payment) => sum + payment.value,0n).toString(),dataBytes:ownBytes};
  }
  if (raw.protocol === "pwid1") {
    const claims = record.stateDelta.economicOutputs.filter(item => item.role === "pwid-registry");
    return {amountSats:claims.reduce((sum,item) => sum + BigInt(item.attributedSats),0n).toString(), dataBytes:transactionBytes};
  }
  if (raw.protocol === "pwa1") {
    // The quote writer picks the first applicable physical registry output, even on rejection.
    const registry = paymentOutputs(raw).find(p => p.recipient === WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS &&
      p.value >= BigInt(WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS));
    return {amountSats:(registry?.value ?? 0n).toString(),dataBytes:ownBytes};
  }
  if (record.outcome.valid && raw.protocol === "pwt1" && Object.hasOwn(tokenFlow,kind)) {
    const flows = record.stateDelta.baseContributions.filter(item => item.field === tokenFlow[kind]);
    checked(flows.length && flows.every(item => decimal(item.value)), "unattributed token event " + kind);
    return {amountSats:flows.reduce((sum,item) => sum + BigInt(item.value),0n).toString(),dataBytes:transactionBytes};
  }
  if (raw.protocol === "pwt1" && !record.outcome.valid) {
    // A rejected token action has zero native economic delta. Its reporting amount
    // can come from historical recovery or raw preparation. The normalized item is
    // the source for that display scalar; SQL checks it against the column and v2
    // commits both. There is no corresponding consensus amount to manufacture.
    return {amountSats:null,dataBytes:transactionBytes === ownBytes ? ownBytes : null};
  }
  throw new Error("AMO governed relations: unclassified stored accounting for " + raw.protocol + "/" + kind);
}

export function expectedRelationalRows({ height, hash, records, replayRecords }) {
  checked(integer(height) && sha256(hash) && Array.isArray(records) && Array.isArray(replayRecords), "invalid canonical input");
  const physical = new Map(), logical = new Map(), events = new Map(), consumed = new Set(), transactionBytes = new Map();
  function position(record) {
    const p = record?.position;
    checked(sha256(record?.txid) && p?.blockHash === hash && p.blockHeight === height &&
      [p.blockTransactionIndex,p.protocolVout,p.recordOrdinal].every(integer) &&
      protocols.includes(record.protocol) && decimal(record.transactionMinerFeeSats), "invalid canonical position or fee");
    return p;
  }
  for (const record of records) {
    const p = position(record), parts = record.rawRecordParts ?? record.payload?.rawRecordParts;
    checked(p.recordOrdinal === 0 && Array.isArray(parts) && parts.length > 0 &&
      parts[0].protocolVout === p.protocolVout && (record.protocol === "pwm1" || parts.length === 1),
      "invalid canonical carrier group");
    add(logical, key(record.txid,p.protocolVout,p.recordOrdinal), record);
    for (const [index,part] of parts.entries()) {
      checked(integer(part.protocolVout) && (!index || part.protocolVout > parts[index-1].protocolVout) &&
        part.prefix === record.protocol + ":" && part.decodeValid === true &&
        typeof part.text === "string" && part.text.startsWith(part.prefix) && !part.text.includes("\u0000") &&
        Buffer.from(part.text, "utf8").toString("hex") === part.payloadHex,
        "unsupported or inconsistent physical carrier encoding");
      // proofProtocolDataBytesForVout counts these four application protocols per transaction.
      if (["pwm1","pwt1","pwid1","pwdns1"].includes(record.protocol)) {
        transactionBytes.set(record.txid,(transactionBytes.get(record.txid) ?? 0) + part.payloadHex.length/2);
      }
      add(physical, key(record.txid,part.protocolVout,0), {txid:record.txid,blockIndex:p.blockTransactionIndex,
        vout:part.protocolVout,outputIndex:0,protocol:record.protocol,payloadHex:part.payloadHex,
        payloadText:part.text,dataBytes:part.payloadHex.length/2});
    }
    checked(record.message === parts.map(part => part.text).join("\n"), "canonical carrier text differs");
  }
  for (const record of replayRecords) {
    const p = position(record), identity = key(record.txid,p.protocolVout,p.recordOrdinal);
    const raw = logical.get(key(record.txid,p.protocolVout,0));
    checked(raw && raw.position.blockTransactionIndex === p.blockTransactionIndex &&
      raw.transactionMinerFeeSats === record.transactionMinerFeeSats, "replay transaction differs");
    if (record.rawCandidate === true) {
      checked(p.recordOrdinal === 0 && raw.protocol === record.protocol && equal(raw.payload,record.rawWitness),
        "replayed raw witness differs");
      consumed.add(identity);
    } else {
      const child = record.rawWitness?.descriptor;
      checked(record.rawCandidate === false && p.recordOrdinal > 0 && record.derived === true &&
        record.chargesTransactionFee === false && record.rawWitness?.model === "canonical-work-amo-v5-derived-child-v1" &&
        equal(record.rawWitness.parentPosition,raw.position) && equal(child?.projectionPosition,p) &&
        child.chargesTransactionFee === false && typeof child.derivedId === "string" &&
        child.derivedId === [record.txid,height,p.blockTransactionIndex,p.protocolVout,p.recordOrdinal].join(":"),
        "unbound replayed child");
    }
    const {kind,valid,reasonCode} = record.outcome;
    checked(kind === record.protocol + (valid ? "-valid" : "-invalid") &&
      typeof reasonCode === "string" && valid === (reasonCode === ""), "invalid replay outcome");
    add(events,identity,{txid:record.txid,blockHeight:height,blockIndex:p.blockTransactionIndex,vout:p.protocolVout,
      ordinal:p.recordOrdinal,protocol:record.protocol,kind:storedKind(record,raw),valid,
      ...accounting(record,raw,transactionBytes.get(record.txid) ?? 0),
      rawPayload:record.rawCandidate ? raw.message : "", feeSats:record.transactionMinerFeeSats,
      validationErrors:valid ? [] : [reasonCode], bound:true, rawCandidate:record.rawCandidate,
      outcome:{kind,reasonCode,valid},rawWitness:record.rawWitness,replayOutput:record.output,
      derivedId:record.rawCandidate ? null : record.rawWitness.descriptor.derivedId});
  }
  checked(consumed.size === logical.size, "missing replay for canonical record");
  return { records:[...physical.values()], events:[...events.values()] };
}

export function verifyRelationalEvidence(evidence, canonical) {
  const expected = expectedRelationalRows(canonical);
  // The original read-only empty fixtures returned only the four manifest fields.
  // A nonempty block always needs row-level evidence from PostgreSQL.
  const bindings = evidence?.bindings ?? evidence;
  verifyGovernedRelationalBindings(bindings);
  for (const [table,count,ordinal] of [["records","recordCount","outputIndex"],["events","eventCount","ordinal"]]) {
    const rows = evidence?.bindings ? evidence[table] : [];
    checked(Array.isArray(rows) && rows.length === expected[table].length && bindings[count] === rows.length,
      "governed relational rows differ in " + table + " count");
    const remaining = new Map(expected[table].map(row => [key(row.txid,row.vout,row[ordinal]),row]));
    for (const row of rows) {
      const identity = key(row?.txid,row?.vout,row?.[ordinal]);
      const want = remaining.get(identity);
      if (want && table === "events" && ((want.valid === false && want.protocol === "pwt1") ||
          (!want.rawCandidate && want.protocol === "pwid1" && want.kind === "id-listing-closed"))) {
        // Null expectations occur only for the non-consensus reporting fields above.
        checked(decimal(row.amountSats) && integer(row.dataBytes), "governed relational rows differ in events accounting");
        if (want.amountSats === null) want.amountSats = row.amountSats;
        if (want.dataBytes === null) want.dataBytes = row.dataBytes;
      }
      checked(want && equal(row,want), "governed relational rows differ in " + table);
      remaining.delete(identity);
    }
    checked(!remaining.size, "missing " + table + " position");
  }
  return bindings;
}
