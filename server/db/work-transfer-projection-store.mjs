import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { WORK_ATOMIC_PROJECTION_MODEL, WORK_SUBATOM_PROJECTION_MODEL } from "../work-units.mjs";

export const WORK_TRANSFER_PROJECTION_REFERENCE_MODEL = "canonical-work-transfer-projection-reference-v1";
export const WORK_TRANSFER_PROJECTION_PAGE_BYTES = 256 * 1024;
// PostgreSQL int4 page positions, independent of summary and HTTP envelope size.
const MAX_PAGES = 2_147_483_647;
// Matches the existing native transition bound for one record, not the lifetime projection.
const MAX_RECORD_BYTES = 256 * 1024 * 1024;
const MAX_HEADER_BYTES = 2048;
const ARRAY_FIELDS = new Set(["items", "transferBatches"]);
const TOP_FIELDS = new Set(["model", "amountStorageModel", "batchModel", ...ARRAY_FIELDS]);
const QUERY_PAGES = 8;
const PROJECTION_MODEL = "canonical-work-transfer-value-projection-v1";
const BATCH_MODELS = ["canonical-work-batch-transfer-value-projection-v1", "canonical-work-batch-transfer-value-projection-v2"];
const HASH = /^[0-9a-f]{64}$/u;
const BINDING_KEYS = ["network", "snapshotId", "indexedThroughBlock", "indexedThroughBlockHash"];
const REFERENCE_KEYS = [...BINDING_KEYS, "model", "projectionModel", "amountStorageModel", "batchModel",
  "itemCount", "batchCount", "payloadBytes", "pageCount", "sha256"];

function requireValue(value, reason) {
  if (!value) throw new Error("Invalid WORK transfer projection: " + reason);
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function validateBinding(binding) {
  requireValue(binding && typeof binding.network === "string" && /^[a-z0-9]{1,16}$/u.test(binding.network) &&
    typeof binding.snapshotId === "string" && /^[a-zA-Z0-9_-]{1,128}$/u.test(binding.snapshotId) &&
    Number.isSafeInteger(binding.indexedThroughBlock) && binding.indexedThroughBlock > 0 &&
    typeof binding.indexedThroughBlockHash === "string" && HASH.test(binding.indexedThroughBlockHash), "snapshot identity");
}
function projectionCounts(projection) {
  requireValue(projection?.model === PROJECTION_MODEL && Array.isArray(projection.items) &&
    [WORK_ATOMIC_PROJECTION_MODEL, WORK_SUBATOM_PROJECTION_MODEL].includes(projection.amountStorageModel),
    "projection model, precision or items");
  if (Object.hasOwn(projection, "batchModel") || Object.hasOwn(projection, "transferBatches")) {
    requireValue(BATCH_MODELS.includes(projection.batchModel) && Array.isArray(projection.transferBatches), "batch model or parents");
  }
  return { projectionModel: projection.model, amountStorageModel: projection.amountStorageModel,
    batchModel: projection.batchModel ?? null, itemCount: projection.items.length, batchCount: projection.transferBatches?.length ?? 0 };
}
export function isWorkTransferProjectionReference(value) {
  return value?.model === WORK_TRANSFER_PROJECTION_REFERENCE_MODEL;
}
export function validateWorkTransferProjectionReference(reference, binding) {
  validateBinding(binding);
  requireValue(isWorkTransferProjectionReference(reference) && Object.keys(reference).length === REFERENCE_KEYS.length &&
    REFERENCE_KEYS.every(key => Object.hasOwn(reference, key)) && BINDING_KEYS.every(key => binding[key] === reference[key]),
    "reference identity");
  requireValue(reference.projectionModel === PROJECTION_MODEL &&
    [WORK_ATOMIC_PROJECTION_MODEL, WORK_SUBATOM_PROJECTION_MODEL].includes(reference.amountStorageModel) &&
    (reference.batchModel === null || BATCH_MODELS.includes(reference.batchModel)) &&
    Number.isSafeInteger(reference.itemCount) && reference.itemCount >= 0 &&
    Number.isSafeInteger(reference.batchCount) && reference.batchCount >= 0 &&
    (reference.batchModel !== null || reference.batchCount === 0) &&
    Number.isSafeInteger(reference.payloadBytes) && reference.payloadBytes > 0 &&
    reference.payloadBytes <= WORK_TRANSFER_PROJECTION_PAGE_BYTES * MAX_PAGES &&
    reference.pageCount === Math.ceil(reference.payloadBytes / WORK_TRANSFER_PROJECTION_PAGE_BYTES) &&
    reference.itemCount + reference.batchCount <= reference.payloadBytes &&
    typeof reference.sha256 === "string" && HASH.test(reference.sha256), "reference bounds or commitment");
}
export function prepareWorkTransferProjection(projection, binding) {
  validateBinding(binding);
  const counts = projectionCounts(projection);
  const keys = Object.keys(projection);
  requireValue(keys.every(key => TOP_FIELDS.has(key)), "unknown top-level field");
  const pages = [];
  const hash = createHash("sha256");
  let page = Buffer.allocUnsafe(WORK_TRANSFER_PROJECTION_PAGE_BYTES);
  let used = 0;
  let payloadBytes = 0;
  function writeLine(value, limit) {
    const json = JSON.stringify(value);
    requireValue(typeof json === "string" && Buffer.byteLength(json) <= limit, "record bound");
    const bytes = Buffer.from(json + "\n");
    hash.update(bytes);
    payloadBytes += bytes.length;
    requireValue(Number.isSafeInteger(payloadBytes) && Math.ceil(payloadBytes / WORK_TRANSFER_PROJECTION_PAGE_BYTES) <= MAX_PAGES,
      "page position exceeds PostgreSQL range");
    let offset = 0;
    while (offset < bytes.length) {
      const length = Math.min(bytes.length - offset, page.length - used);
      bytes.copy(page, used, offset, offset + length);
      used += length;
      offset += length;
      if (used === page.length) {
        pages.push(page);
        page = Buffer.allocUnsafe(WORK_TRANSFER_PROJECTION_PAGE_BYTES);
        used = 0;
      }
    }
  }
  // The first JSON line preserves top-level key order and array counts. Each
  // remaining line represents one exact record in its original array order.
  writeLine(keys.map(key => [key, ARRAY_FIELDS.has(key) ? projection[key].length : projection[key]]), MAX_HEADER_BYTES);
  for (const key of keys.filter(key => ARRAY_FIELDS.has(key))) {
    for (const record of projection[key]) {
      requireValue(record && typeof record === "object" && !Array.isArray(record), "non-object projection record");
      writeLine(record, MAX_RECORD_BYTES);
    }
  }
  if (used) pages.push(Buffer.from(page.subarray(0, used)));
  const reference = { model: WORK_TRANSFER_PROJECTION_REFERENCE_MODEL,
    ...Object.fromEntries(BINDING_KEYS.map(key => [key, binding[key]])), ...counts,
    payloadBytes, pageCount: pages.length, sha256: hash.digest("hex") };
  validateWorkTransferProjectionReference(reference, binding);
  return { reference, pages };
}
function expectedPageBytes(reference, index) {
  return Math.min(WORK_TRANSFER_PROJECTION_PAGE_BYTES, reference.payloadBytes - index * WORK_TRANSFER_PROJECTION_PAGE_BYTES);
}
export function workTransferProjectionPageLength(reference, binding, index) {
  validateWorkTransferProjectionReference(reference, binding);
  requireValue(Number.isSafeInteger(index) && index >= 0 && index < reference.pageCount, "page index");
  return expectedPageBytes(reference, index);
}
function verifyPageBytes(reference, pages, binding) {
  validateWorkTransferProjectionReference(reference, binding);
  requireValue(Array.isArray(pages) && pages.length === reference.pageCount, "page count");
  const hash = createHash("sha256");
  for (const [index, page] of pages.entries()) {
    requireValue(Buffer.isBuffer(page) && page.length === expectedPageBytes(reference, index), "page length");
    hash.update(page);
  }
  requireValue(hash.digest("hex") === reference.sha256, "projection digest");
}
export function createWorkTransferProjectionDecoder(reference, binding) {
  validateWorkTransferProjectionReference(reference, binding);
  const hash = createHash("sha256");
  const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let pageIndex = 0;
  let lineBytes = 0;
  let fragments = [];
  let projection = null;
  let ended = false;
  const arrays = [];
  let arrayIndex = 0;
  function completeLine() {
    requireValue(lineBytes > 0, "empty record");
    const rowBytes = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments, lineBytes);
    const row = JSON.parse(utf8.decode(rowBytes));
    fragments = [];
    lineBytes = 0;
    if (!projection) {
      requireValue(Array.isArray(row) && row.length >= 3 && row.length <= TOP_FIELDS.size, "field manifest");
      projection = {};
      for (const entry of row) {
        requireValue(Array.isArray(entry) && entry.length === 2 && TOP_FIELDS.has(entry[0]) &&
          !Object.hasOwn(projection, entry[0]), "duplicate or unknown field");
        const [key, value] = entry;
        if (ARRAY_FIELDS.has(key)) {
          requireValue(value === (key === "items" ? reference.itemCount : reference.batchCount), "array count");
          projection[key] = [];
          if (value) arrays.push([key, value]);
        } else {
          projection[key] = value;
        }
      }
      requireValue(Array.isArray(projection.items) && projection.model === reference.projectionModel &&
        projection.amountStorageModel === reference.amountStorageModel &&
        (projection.batchModel ?? null) === reference.batchModel &&
        Object.hasOwn(projection, "transferBatches") === (reference.batchModel !== null), "manifest metadata");
    } else {
      requireValue(arrayIndex < arrays.length && row && typeof row === "object" && !Array.isArray(row), "unexpected projection record");
      const [key, length] = arrays[arrayIndex];
      projection[key].push(row);
      if (projection[key].length === length) arrayIndex++;
    }
  }
  return {
    write(page) {
      requireValue(!ended && pageIndex < reference.pageCount && Buffer.isBuffer(page) &&
        page.length === expectedPageBytes(reference, pageIndex), "page length or count");
      pageIndex++;
      hash.update(page);
      let start = 0;
      while (start < page.length) {
        const newline = page.indexOf(10, start);
        const end = newline === -1 ? page.length : newline;
        lineBytes += end - start;
        requireValue(lineBytes <= (projection ? MAX_RECORD_BYTES : MAX_HEADER_BYTES), "record bound");
        if (end > start) fragments.push(page.subarray(start, end));
        if (newline === -1) break;
        completeLine();
        start = end + 1;
      }
    },
    finish() {
      requireValue(!ended && pageIndex === reference.pageCount && !lineBytes && projection && arrayIndex === arrays.length,
        "incomplete pages or records");
      ended = true;
      requireValue(hash.digest("hex") === reference.sha256, "projection digest");
      const counts = projectionCounts(projection);
      requireValue(Object.entries(counts).every(([key, count]) => reference[key] === count), "reconstructed projection metadata");
      return projection;
    },
  };
}
export function decodeWorkTransferProjection(reference, pages, binding) {
  validateWorkTransferProjectionReference(reference, binding);
  requireValue(Array.isArray(pages) && pages.length === reference.pageCount, "page count");
  const decoder = createWorkTransferProjectionDecoder(reference, binding);
  for (const page of pages) decoder.write(page);
  return decoder.finish();
}
async function verifyParent(client, reference, forWrite = false) {
  const result = await client.query(
    "SELECT 1 FROM proof_indexer.ledger_snapshots WHERE network=$1 AND snapshot_id=$2 AND indexed_through_block=$3 " +
    "AND payload->>'indexedThroughBlockHash'=$4 AND payload->>'network'=$1 AND payload->>'snapshotId'=$2 " +
    "AND payload->'summaryPayloads'->'workSummary'->'workTransferValueProjection'=$5::jsonb" + (forWrite ? " FOR SHARE" : ""),
    [reference.network, reference.snapshotId, reference.indexedThroughBlock, reference.indexedThroughBlockHash, JSON.stringify(reference)]);
  requireValue(result.rows.length === 1, "snapshot does not bind this projection");
}
async function verifyPageInventory(client, reference) {
  const result = await client.query(
    "SELECT count(*) AS pages,coalesce(sum(page_bytes),0) AS bytes,min(page_index) AS first,max(page_index) AS last " +
    "FROM proof_indexer.work_transfer_projection_pages WHERE network=$1 AND snapshot_id=$2",
    [reference.network, reference.snapshotId]);
  const row = result.rows[0];
  requireValue(Number(row?.pages) === reference.pageCount && Number(row?.bytes) === reference.payloadBytes &&
    row.first === 0 && row.last === reference.pageCount - 1, "missing or extra pages");
}
export async function storeWorkTransferProjection(client, { reference, pages }) {
  verifyPageBytes(reference, pages, reference);
  // PostgreSQL refuses SAVEPOINT outside a transaction, before any page can be written.
  await client.query("SAVEPOINT work_projection_store_guard");
  await client.query("RELEASE SAVEPOINT work_projection_store_guard");
  await verifyParent(client, reference, true);
  for (let start = 0; start < pages.length; start += QUERY_PAGES) {
    const batch = pages.slice(start, start + QUERY_PAGES);
    await client.query(
      "INSERT INTO proof_indexer.work_transfer_projection_pages (network,snapshot_id,page_index,payload) " +
      "SELECT $1,$2,$3::int + ord::int - 1,bytes FROM unnest($4::bytea[]) WITH ORDINALITY AS p(bytes,ord) " +
      "ON CONFLICT (network,snapshot_id,page_index) DO NOTHING",
      [reference.network, reference.snapshotId, start, batch]);
    const result = await client.query(
      "SELECT page_index,encode(page_sha256,'hex') AS sha256 FROM proof_indexer.work_transfer_projection_pages " +
      "WHERE network=$1 AND snapshot_id=$2 AND page_index >= $3 AND page_index < $4 ORDER BY page_index",
      [reference.network, reference.snapshotId, start, start + batch.length]);
    requireValue(result.rows.length === batch.length && result.rows.every((row, i) =>
      row.page_index === start + i && row.sha256 === sha256(batch[i])), "stored pages conflict with this snapshot");
  }
  await verifyPageInventory(client, reference);
}
export async function readWorkTransferProjection(client, value, binding) {
  if (!isWorkTransferProjectionReference(value)) {
    requireValue(value?.model === PROJECTION_MODEL && Array.isArray(value.items), "unknown embedded model");
    return value;
  }
  validateWorkTransferProjectionReference(value, binding);
  await verifyParent(client, value);
  await verifyPageInventory(client, value);
  const decoder = createWorkTransferProjectionDecoder(value, binding);
  for (let start = 0; start < value.pageCount; start += QUERY_PAGES) {
    const expected = Math.min(QUERY_PAGES, value.pageCount - start);
    const result = await client.query(
      "SELECT page_index,payload,encode(page_sha256,'hex') AS sha256 FROM proof_indexer.work_transfer_projection_pages " +
      "WHERE network=$1 AND snapshot_id=$2 AND page_index >= $3 AND page_index < $4 ORDER BY page_index",
      [value.network, value.snapshotId, start, start + expected]);
    requireValue(result.rows.length === expected, "missing pages");
    for (const [offset, row] of result.rows.entries()) {
      requireValue(row.page_index === start + offset && Buffer.isBuffer(row.payload) &&
        sha256(row.payload) === row.sha256, "page identity or digest");
      decoder.write(row.payload);
    }
  }
  return decoder.finish();
}

export function workTransferProjectionSqlEligibility(snapshotAlias) {
  requireValue(typeof snapshotAlias === "string" && /^[a-z_][a-z0-9_]*$/u.test(snapshotAlias), "SQL snapshot alias");
  const snapshot = snapshotAlias;
  const keys = "ARRAY[" + REFERENCE_KEYS.map(key => "'" + key + "'").join(",") + "]::text[]";
  return `(
    SELECT CASE WHEN ref->>'model' = '${WORK_TRANSFER_PROJECTION_REFERENCE_MODEL}' THEN EXISTS (
      SELECT 1 FROM (
        SELECT count(*) AS pages, sum(page_bytes) AS bytes, min(page_index) AS first, max(page_index) AS last,
               count(*) FILTER (WHERE page_bytes <> ${WORK_TRANSFER_PROJECTION_PAGE_BYTES}) AS short_pages,
               max(page_index) FILTER (WHERE page_bytes <> ${WORK_TRANSFER_PROJECTION_PAGE_BYTES}) AS short_index
        FROM proof_indexer.work_transfer_projection_pages
        WHERE network=${snapshot}.network AND snapshot_id=${snapshot}.snapshot_id
      ) inventory
      WHERE ref ?& ${keys} AND (ref - ${keys}) = '{}'::jsonb
        AND ref->>'network'=${snapshot}.network AND ref->>'snapshotId'=${snapshot}.snapshot_id
        AND ref->'indexedThroughBlock'=to_jsonb(${snapshot}.indexed_through_block)
        AND ref->>'indexedThroughBlockHash'=${snapshot}.payload->>'indexedThroughBlockHash'
        AND ref->>'indexedThroughBlockHash' ~ '^[0-9a-f]{64}$'
        AND ref->>'projectionModel'='${PROJECTION_MODEL}' AND ref->>'amountStorageModel' IN ('${WORK_ATOMIC_PROJECTION_MODEL}','${WORK_SUBATOM_PROJECTION_MODEL}')
        AND (ref->'batchModel'='null'::jsonb AND ref->'batchCount'='0'::jsonb OR ref->>'batchModel' IN ('${BATCH_MODELS[0]}','${BATCH_MODELS[1]}'))
        AND jsonb_typeof(ref->'itemCount')='number' AND ref->>'itemCount' ~ '^(0|[1-9][0-9]{0,9})$'
        AND jsonb_typeof(ref->'batchCount')='number' AND ref->>'batchCount' ~ '^(0|[1-9][0-9]{0,9})$'
        AND ref->>'sha256' ~ '^[0-9a-f]{64}$' AND inventory.pages BETWEEN 1 AND ${MAX_PAGES}
        AND inventory.first=0 AND inventory.last=inventory.pages-1 AND inventory.short_pages <= 1
        AND (inventory.short_pages=0 OR inventory.short_index=inventory.last)
        AND ref->'pageCount'=to_jsonb(inventory.pages) AND ref->'payloadBytes'=to_jsonb(inventory.bytes)
    ) ELSE NOT coalesce(ref ?| ARRAY['projectionModel','pageCount','sha256','payloadBytes'], false) END
    FROM (SELECT ${snapshot}.payload->'summaryPayloads'->'workSummary'->'workTransferValueProjection' AS ref OFFSET 0) projection
  )`;
}
