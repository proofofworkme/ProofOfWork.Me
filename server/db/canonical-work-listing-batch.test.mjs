import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./proof-index-reader.mjs", import.meta.url), "utf8");
function extract(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
const version = "work-amo-v8";
const hash = "a".repeat(64);
function fixture(count = 2) {
  const ids = Array.from({ length: count }, (_, i) => (i + 1).toString(16).padStart(64, "0"));
  const rows = ids.map((id) => ({
    listing_id: id, listing_status: "active", block_hash: hash,
    block_height: 100, block_index: 3, protocol_vout: 1, record_ordinal: 0,
    amount_units: "900719925474099312345", price_sats: "546",
    sale_ticket_txid: id, sale_ticket_vout: 2, sale_ticket_value_sats: "546",
    listing_event_payload: { saleAuthorization: { version } },
  }));
  const terms = ids.map((id) => ({ listing_id: id, normalized: {
    listingPosition: { blockHeight: 100, blockIndex: 3, protocolVout: 1, recordOrdinal: 0 },
    frozenTerms: { listingBlockHash: hash, unitAmountSubatoms: "900719925474099312345" },
  } }));
  return { ids, rows, terms };
}
function reader(data, { fail = false } = {}) {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, args) {
      queries.push({ sql, args });
      if (sql.includes("FROM proof_indexer.credit_listings")) {
        if (fail) throw Error("database unavailable");
        assert.match(sql, /listing_anchor\.spent_by_txid IS NULL/);
        assert.match(sql, /listing_block\.canonical = true/);
        assert.match(sql, /listing_event\.valid = true/);
        assert.match(sql, /listing\.listing_id = ANY\(\$2::text\[\]\)/);
        return { rows: data.rows };
      }
      if (sql.includes("FROM proof_indexer.work_amo_v8_listing_terms")) {
        assert.match(sql, /listing_tx\.block_hash = terms\.listing_block_hash/);
        assert.match(sql, /listing_event\.record_ordinal =/);
        assert.match(sql, /terms\.listing_id = ANY\(\$2::text\[\]\)/);
        return { rows: data.terms };
      }
      return { rows: [] };
    },
    release() { released = true; },
  };
  const context = vm.createContext({
    proofIndexPool: () => ({ connect: async () => client }),
    normalizedLowerText: (v) => String(v ?? "").trim().toLowerCase(),
    WORK_TOKEN_ID: "work", WORK_AMO_V8_AUTH_VERSION: version,
    WORK_AMO_V5_AUTH_VERSION: "v5", WORK_AMO_V6_AUTH_VERSION: "v6", WORK_MARKET_V4_AUTH_VERSION: "v4",
    WORK_PRECISION_V2_MIGRATION_META_KEY: "migration",
    canonicalCreditListingEffectiveSaleTicketJoinSql: () => "JOIN effective_sale_ticket ON true",
    configuredWorkPrecisionV2ReaderPins: () => ({ activationHeight: 90 }),
    proofIndexWorkAmoV8ActivationLatch: async (_network, _pins, options) => {
      assert.equal(options.client, client);
      await client.query("SELECT activation_latch");
      return null;
    },
    normalizedWorkAmoV8ListingTermsRow: (row) => row.invalid ? null : row.normalized,
    canonicalAmoPosition: (row) => ({ blockHeight: row.block_height, blockIndex: row.block_index, protocolVout: row.protocol_vout, recordOrdinal: row.record_ordinal }),
    workAmountProjection: () => ({}),
    workListingAmountProjection: (_payload, { storedAmount }) => ({ amount: storedAmount }),
    workAmountProjectionMetadataForAmount: (amount) => ({ amountSubatoms: amount.amount }),
  });
  const names = ["canonicalWorkListingRows", "canonicalWorkListingFromRow", "workAmoV8ListingTermsByIds", "proofIndexCanonicalWorkAmoV8ListingsByIds"];
  const read = vm.runInContext(`${names.map(extract).join("\n")}\nproofIndexCanonicalWorkAmoV8ListingsByIds`, context);
  return { read, queries, released: () => released };
}

test("complete V8 book uses three bounded SELECTs in one read-only snapshot and preserves exact terms", async () => {
  const data = fixture(1100);
  const { read, queries, released } = reader(data);
  const result = await read("livenet", [...data.ids, data.ids[0]]);
  assert.equal(result.length, 1100);
  assert.equal(queries.length, 5);
  assert.equal(queries[0].sql, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.equal(queries[1].args.length, 3);
  assert.equal(queries[1].args[1].length, 1100);
  assert.equal(result[0].amountSubatoms, "900719925474099312345");
  assert.equal(result[0].listingFrozenTerms, data.terms[0].normalized.frozenTerms);
  assert.equal(released(), true);
});

test("missing, duplicate, invalid and cross-block frozen evidence stays unavailable per listing", async () => {
  const mutations = [
    (d) => d.rows.shift(),
    (d) => d.rows.push(structuredClone(d.rows[0])),
    (d) => d.terms.shift(),
    (d) => d.terms.push(structuredClone(d.terms[0])),
    (d) => { d.terms[0].invalid = true; },
    (d) => { d.terms[0].normalized.listingPosition.blockHeight++; },
    (d) => { d.terms[0].normalized.listingPosition.blockIndex++; },
    (d) => { d.terms[0].normalized.listingPosition.protocolVout++; },
    (d) => { d.terms[0].normalized.listingPosition.recordOrdinal++; },
    (d) => { d.terms[0].normalized.frozenTerms.listingBlockHash = "b".repeat(64); },
    (d) => { d.rows[0].listing_event_payload.saleAuthorization.version = "v6"; },
  ];
  for (const mutate of mutations) {
    const data = fixture();
    mutate(data);
    const result = await reader(data).read("livenet", data.ids);
    assert.deepEqual(Array.from(result, (r) => r.listingId), [data.ids[1]]);
  }
});

test("invalid or oversized requests do not query; failed reads roll back and release", async () => {
  const data = fixture();
  const normal = reader(data);
  for (const ids of [[], ["bad"], fixture(5001).ids]) {
    assert.equal((await normal.read("livenet", ids)).length, 0);
  }
  assert.equal(normal.queries.length, 0);
  const failing = reader(data, { fail: true });
  await assert.rejects(failing.read("livenet", data.ids), /database unavailable/);
  assert.equal(failing.queries.at(-1).sql, "ROLLBACK");
  assert.equal(failing.released(), true);
});
