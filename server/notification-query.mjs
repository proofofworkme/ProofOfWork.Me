// Read-only projection over existing events. No new canonical rows or balances.
export const NOTIFICATION_QUERY_MODEL = "proof-notification-transaction-query-v1";

export function notificationAddressKey(value) {
  const address = String(value ?? "").trim();
  return /^(?:bc1|tb1|bcrt1)/iu.test(address) ? address.toLowerCase() : address;
}

// Base58 case is significant. Only a network address already validated by the
// API may use the Bech32 case-normalized path.
export function notificationAddressSql(expression, parameter) {
  return `(${expression} = ${parameter} OR (${parameter} ~ '^(bc1|tb1|bcrt1)' AND lower(${expression}) = ${parameter}))`;
}

function directSql(alias, parameter) {
  return `EXISTS (SELECT 1 FROM proof_indexer.event_participants np
    WHERE np.event_id = ${alias}.event_id AND ${notificationAddressSql("np.address", parameter)}
      AND (np.role NOT IN ('owner','participant')
        OR np.address IS DISTINCT FROM ${alias}.payload->>'currentOwnerAddress'
        OR np.address = ${alias}.payload->>'ownerAddress'
        OR np.address = ${alias}.payload->>'authorAddress'
        OR np.address = ${alias}.payload->>'senderAddress'
        OR np.address = ${alias}.payload->>'actor'))`;
}

export function notificationReferenceSql(alias) {
  // Read typed references only. Free text, Permission labels/policy recipients,
  // mentions, and the current ID registry never establish a recipient.
  return `SELECT nr.ref_value AS txid, nr.ref_type AS type
    FROM proof_indexer.event_refs nr WHERE nr.event_id = ${alias}.event_id
      AND nr.ref_type IN ('boost-txid','target-txid','parent-txid','repository-txid',
        'source-txid','listing-id','job-txid','job-proposal-txid',
        'job-assignment-txid','job-delivery-txid','job-artifact-txid')
    UNION SELECT value, type FROM (VALUES
      (${alias}.payload->>'quoteTxid', 'quote-txid'),
      (${alias}.payload->>'pageTxid', 'page-txid'),
      (${alias}.payload->'record'->>'pageTxid', 'page-txid'),
      (${alias}.payload->'metadata'->>'sourceTxid', 'source-txid')
    ) notification_reference(value,type) WHERE value ~ '^[0-9a-f]{64}$'`;
}

function earlierSql(source, action) {
  return `(${action}.status <> 'confirmed' OR
    (${source}.block_height, COALESCE(${source}.block_index,-1), COALESCE(${source}.op_return_vout,-1), COALESCE(${source}.record_ordinal,-1)) <
    (${action}.block_height, COALESCE(${action}.block_index,-1), COALESCE(${action}.op_return_vout,-1), COALESCE(${action}.record_ordinal,-1)))`;
}

export function notificationRelatedSql(alias, parameter, checkpoint = "2147483647") {
  return `(${directSql(alias, parameter)} OR EXISTS (
    SELECT 1 FROM (${notificationReferenceSql(alias)}) nr
    JOIN proof_indexer.events ns ON ns.network = ${alias}.network AND ns.txid = nr.txid
    JOIN proof_indexer.transactions nt ON nt.network = ns.network AND nt.txid = ns.txid
      AND nt.status = 'confirmed' AND nt.block_height = ns.block_height
    JOIN proof_indexer.blocks nb ON nb.network = nt.network AND nb.height = nt.block_height
      AND nb.block_hash = nt.block_hash AND nb.canonical = true
    WHERE ns.status = 'confirmed' AND ns.valid = true AND ns.block_height <= ${checkpoint} AND ${earlierSql("ns", alias)}
      AND EXISTS (SELECT 1 FROM proof_indexer.event_participants np
        WHERE np.event_id = ns.event_id AND np.role IN ('author','sender','actor','creator')
          AND ${notificationAddressSql("np.address", parameter)})
  ) OR EXISTS (
    -- A job cancellation self-pays its client. Earlier job participants still
    -- need its related activity; this is participation, never assignment proof.
    SELECT 1 FROM proof_indexer.event_refs root_ref
    JOIN proof_indexer.event_refs prior_ref ON prior_ref.ref_type = 'job-txid'
      AND prior_ref.ref_value = root_ref.ref_value
    JOIN proof_indexer.events prior ON prior.event_id = prior_ref.event_id
      AND prior.network = ${alias}.network AND prior.protocol = 'pwm1'
      AND prior.status = 'confirmed' AND prior.valid = true
    JOIN proof_indexer.transactions pt ON pt.network = prior.network AND pt.txid = prior.txid
      AND pt.status = 'confirmed' AND pt.block_height = prior.block_height
    JOIN proof_indexer.blocks pb ON pb.network = pt.network AND pb.height = pt.block_height
      AND pb.block_hash = pt.block_hash AND pb.canonical = true
    WHERE root_ref.event_id = ${alias}.event_id AND root_ref.ref_type = 'job-txid'
      AND prior.block_height <= ${checkpoint} AND ${earlierSql("prior", alias)} AND ${directSql("prior", parameter)}
  ))`;
}

export function notificationTransactionSql(parameter, checkpoint, supplemental = "ARRAY[]::text[]") {
  return `NOT EXISTS (SELECT 1 FROM proof_indexer.events earlier
      WHERE earlier.network = e.network AND earlier.txid = e.txid AND earlier.status = e.status AND earlier.event_id < e.event_id
        AND (earlier.kind NOT LIKE 'token-%' OR earlier.protocol = 'pwt1')
        AND (e.status <> 'confirmed' OR earlier.block_height = e.block_height))
    AND (e.txid = ANY(${supplemental}::text[])
      OR EXISTS (SELECT 1 FROM proof_indexer.tx_inputs ni WHERE ni.network=e.network AND ni.txid=e.txid AND ${notificationAddressSql("ni.address", parameter)})
      OR EXISTS (SELECT 1 FROM proof_indexer.tx_outputs no WHERE no.network=e.network AND no.txid=e.txid AND ${notificationAddressSql("no.address", parameter)})
      OR EXISTS (SELECT 1 FROM proof_indexer.events ne
      WHERE ne.network = e.network AND ne.txid = e.txid AND ne.status = e.status
        AND ${notificationRelatedSql("ne", parameter, checkpoint)}))`;
}
