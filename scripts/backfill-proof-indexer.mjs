import { createHash } from "node:crypto";

import { createProofIndexPool } from "../server/db/postgres.mjs";

const DEFAULT_API_BASE = "http://127.0.0.1:8081";
const API_BASE = String(process.env.POW_API_BASE ?? DEFAULT_API_BASE).replace(
  /\/+$/u,
  "",
);
const NETWORK = process.env.NETWORK ?? "livenet";
const PAGE_LIMIT = Number(process.env.POW_INDEX_BACKFILL_LIMIT ?? 200);
const MAX_PAGES = Number(process.env.POW_INDEX_BACKFILL_MAX_PAGES ?? 2000);
const REQUEST_TIMEOUT_MS = Number(process.env.POW_INDEX_FETCH_TIMEOUT_MS ?? 60_000);
const DRY_RUN = process.argv.includes("--dry-run");
const SOURCE_FILTER = new Set(
  String(process.env.POW_INDEX_BACKFILL_SOURCES ?? "")
    .split(/[,\s]+/u)
    .map((value) => value.trim())
    .filter(Boolean),
);
const ALL_SOURCES = [
  { label: "log", path: "/api/v1/log-history" },
  { label: "registry-records", path: "/api/v1/registry-history", params: { kind: "records" } },
  { label: "registry-pending", path: "/api/v1/registry-history", params: { kind: "pending" } },
  { label: "registry-listings", path: "/api/v1/registry-history", params: { kind: "listings" } },
  { label: "registry-sales", path: "/api/v1/registry-history", params: { kind: "sales" } },
  { label: "tokens", path: "/api/v1/token-history", params: { kind: "tokens" } },
  { label: "token-mints", path: "/api/v1/token-history", params: { kind: "mints" } },
  { label: "token-transfers", path: "/api/v1/token-history", params: { kind: "transfers" } },
  { label: "token-listings", path: "/api/v1/token-history", params: { kind: "listings" } },
  {
    label: "token-closed-listings",
    path: "/api/v1/token-history",
    params: { kind: "closed-listings" },
  },
  { label: "token-sales", path: "/api/v1/token-history", params: { kind: "sales" } },
  {
    label: "token-invalid-events",
    path: "/api/v1/token-history",
    params: { kind: "invalid-events" },
  },
  { label: "token-holders", path: "/api/v1/token-history", params: { kind: "holders" } },
];
const SOURCES = SOURCE_FILTER.size
  ? ALL_SOURCES.filter((source) => SOURCE_FILTER.has(source.label))
  : ALL_SOURCES;

function endpoint(pathname, params = {}) {
  const url = new URL(`${API_BASE}${pathname}`);
  url.searchParams.set("network", NETWORK);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function readJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${url.pathname} returned HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function isHexTxid(value) {
  return /^[0-9a-f]{64}$/u.test(String(value ?? "").toLowerCase());
}

function itemTxid(item) {
  const candidates = [
    item?.txid,
    item?.eventTxid,
    item?.listingId,
    item?.closedTxid,
    item?.sealTxid,
    item?.tokenId,
  ];
  return String(candidates.find(isHexTxid) ?? "").toLowerCase();
}

function itemStatus(item) {
  const raw = String(item?.status ?? "").toLowerCase();
  if (["pending", "confirmed", "dropped", "orphaned"].includes(raw)) {
    return raw;
  }
  if (item?.dropped === true) {
    return "dropped";
  }
  return item?.confirmed === false ? "pending" : "confirmed";
}

function itemTime(item) {
  return (
    item?.createdAt ??
    item?.confirmedAt ??
    item?.indexedAt ??
    item?.updatedAt ??
    null
  );
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bigintOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function eventKind(item, fallback) {
  return String(item?.kind ?? item?.action ?? fallback ?? "event")
    .trim()
    .toLowerCase();
}

function protocolForItem(item, kind) {
  if (item?.protocol) {
    return String(item.protocol);
  }
  if (kind.startsWith("token") || item?.tokenId || item?.ticker) {
    return "pwt1";
  }
  if (kind.startsWith("id") || item?.id || item?.ownerAddress || item?.receiveAddress) {
    return "pwid1";
  }
  if (kind.startsWith("rush")) {
    return "pwr1";
  }
  if (
    ["mail", "reply", "file", "attachment", "browser", "infinity-bond"].includes(kind)
  ) {
    return "pwm1";
  }
  return "proof";
}

function amountSats(item) {
  return bigintOrZero(
    item?.amountSats ??
      item?.paidSats ??
      item?.priceSats ??
      item?.mintPriceSats ??
      item?.creationFeeSats ??
      item?.mutationFeeSats ??
      item?.feeSats,
  );
}

function dataBytes(item) {
  return bigintOrZero(item?.dataBytes ?? item?.protocolBytes ?? item?.sizeBytes);
}

function stableEventKey({ item, kind, protocol, sourceLabel, txid }) {
  const parts = [
    protocol,
    kind,
    txid,
    item?.listingId,
    item?.tokenId,
    item?.id,
    item?.parentTxid,
    item?.attachmentIndex,
    item?.vout,
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(String);
  if (parts.length >= 3) {
    return parts.join(":").toLowerCase();
  }
  const digest = createHash("sha256")
    .update(JSON.stringify({ item, sourceLabel }))
    .digest("hex")
    .slice(0, 24);
  return `${sourceLabel}:${digest}`;
}

function participantsForItem(item) {
  const participants = [];
  const add = (address, role, powid = "") => {
    const value = String(address ?? "").trim();
    if (value) {
      participants.push({ address: value, powid: String(powid ?? ""), role });
    }
  };
  for (const address of Array.isArray(item?.participants) ? item.participants : []) {
    add(address, "participant");
  }
  add(item?.address, "address");
  add(item?.senderAddress, "sender");
  add(item?.recipientAddress, "recipient");
  add(item?.ownerAddress, "owner", item?.id);
  add(item?.receiveAddress, "receiver", item?.id);
  add(item?.sellerAddress, "seller");
  add(item?.buyerAddress, "buyer");
  add(item?.registryAddress, "registry");
  add(item?.creatorAddress, "creator");
  add(item?.minterAddress, "minter");
  const unique = new Map();
  for (const participant of participants) {
    unique.set(
      `${participant.address}:${participant.role}:${participant.powid}`,
      participant,
    );
  }
  return [...unique.values()];
}

function refsForItem(item) {
  const refs = [];
  const add = (refType, refValue) => {
    const value = String(refValue ?? "").trim();
    if (value) {
      refs.push({ refType, refValue: value });
    }
  };
  add("powid", item?.id);
  add("token-id", item?.tokenId);
  add("ticker", item?.ticker);
  add("listing-id", item?.listingId);
  add("parent-txid", item?.parentTxid);
  add("closed-txid", item?.closedTxid);
  add("seal-txid", item?.sealTxid);
  if (item?.saleTicketTxid && item?.saleTicketVout !== undefined) {
    add("sale-ticket-outpoint", `${item.saleTicketTxid}:${item.saleTicketVout}`);
  }
  return refs;
}

async function upsertTransaction(client, item, txid, status, sourceLabel) {
  const eventTime = itemTime(item);
  await client.query(
    `
      INSERT INTO proof_indexer.transactions (
        network,
        txid,
        status,
        first_seen_at,
        last_seen_at,
        confirmed_at,
        block_height,
        block_time,
        source,
        raw_tx
      )
      VALUES (
        $1,
        $2,
        $3,
        now(),
        now(),
        CASE WHEN $3 = 'confirmed' THEN COALESCE($4::timestamptz, now()) ELSE NULL END,
        $5,
        $4::timestamptz,
        $6,
        $7::jsonb
      )
      ON CONFLICT (network, txid)
      DO UPDATE SET
        status = EXCLUDED.status,
        last_seen_at = now(),
        confirmed_at = COALESCE(proof_indexer.transactions.confirmed_at, EXCLUDED.confirmed_at),
        block_height = COALESCE(EXCLUDED.block_height, proof_indexer.transactions.block_height),
        block_time = COALESCE(EXCLUDED.block_time, proof_indexer.transactions.block_time),
        source = COALESCE(EXCLUDED.source, proof_indexer.transactions.source),
        raw_tx = COALESCE(proof_indexer.transactions.raw_tx, EXCLUDED.raw_tx),
        updated_at = now()
    `,
    [
      NETWORK,
      txid,
      status,
      eventTime,
      numberOrNull(item?.blockHeight ?? item?.height),
      sourceLabel,
      JSON.stringify({ indexedFrom: sourceLabel, item }),
    ],
  );
}

async function upsertEvent(client, sourceLabel, item) {
  const txid = itemTxid(item);
  const status = itemStatus(item);
  if (!txid) {
    await upsertProjection(client, sourceLabel, item, status);
    return { projected: true, skipped: true };
  }

  const kind = eventKind(item, sourceLabel);
  const protocol = protocolForItem(item, kind);
  const eventKey = stableEventKey({ item, kind, protocol, sourceLabel, txid });
  const eventTime = itemTime(item);

  await upsertTransaction(client, item, txid, status, sourceLabel);

  const result = await client.query(
    `
      INSERT INTO proof_indexer.events (
        network,
        event_key,
        txid,
        protocol,
        kind,
        status,
        valid,
        validation_errors,
        amount_sats,
        data_bytes,
        block_height,
        block_time,
        event_time,
        raw_payload,
        payload
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::text[],
        $9,
        $10,
        $11,
        $12::timestamptz,
        $13::timestamptz,
        $14,
        $15::jsonb
      )
      ON CONFLICT (network, event_key)
      DO UPDATE SET
        status = EXCLUDED.status,
        valid = EXCLUDED.valid,
        validation_errors = EXCLUDED.validation_errors,
        amount_sats = EXCLUDED.amount_sats,
        data_bytes = EXCLUDED.data_bytes,
        block_height = COALESCE(EXCLUDED.block_height, proof_indexer.events.block_height),
        block_time = COALESCE(EXCLUDED.block_time, proof_indexer.events.block_time),
        event_time = COALESCE(EXCLUDED.event_time, proof_indexer.events.event_time),
        raw_payload = EXCLUDED.raw_payload,
        payload = EXCLUDED.payload,
        updated_at = now()
      RETURNING event_id
    `,
    [
      NETWORK,
      eventKey,
      txid,
      protocol,
      kind,
      status,
      item?.valid !== false && !String(kind).includes("invalid"),
      item?.reason ? [String(item.reason)] : [],
      amountSats(item),
      dataBytes(item),
      numberOrNull(item?.blockHeight ?? item?.height),
      eventTime,
      eventTime,
      item?.payload ? String(item.payload) : "",
      JSON.stringify({ ...item, indexedFrom: sourceLabel }),
    ],
  );
  const eventId = result.rows[0].event_id;

  await client.query("DELETE FROM proof_indexer.event_participants WHERE event_id = $1", [
    eventId,
  ]);
  for (const participant of participantsForItem(item)) {
    await client.query(
      `
        INSERT INTO proof_indexer.event_participants (event_id, address, role, powid)
        VALUES ($1, $2, $3, NULLIF($4, ''))
        ON CONFLICT DO NOTHING
      `,
      [eventId, participant.address, participant.role, participant.powid],
    );
  }

  await client.query("DELETE FROM proof_indexer.event_refs WHERE event_id = $1", [
    eventId,
  ]);
  for (const ref of refsForItem(item)) {
    await client.query(
      `
        INSERT INTO proof_indexer.event_refs (event_id, ref_type, ref_value)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `,
      [eventId, ref.refType, ref.refValue],
    );
  }

  await upsertProjection(client, sourceLabel, item, status);
  return { skipped: false };
}

async function upsertProjection(client, sourceLabel, item, status) {
  if (sourceLabel === "registry-records" && item?.id && item?.ownerAddress) {
    await client.query(
      `
        INSERT INTO proof_indexer.id_records (
          network,
          id_lower,
          display_id,
          owner_address,
          receive_address,
          pgp_public_key,
          registration_txid,
          last_event_txid,
          registered_height,
          updated_height,
          updated_at
        )
        VALUES ($1, lower($2), $2, $3, $4, $5, $6, $6, $7, $7, now())
        ON CONFLICT (network, id_lower)
        DO UPDATE SET
          display_id = EXCLUDED.display_id,
          owner_address = EXCLUDED.owner_address,
          receive_address = EXCLUDED.receive_address,
          pgp_public_key = COALESCE(EXCLUDED.pgp_public_key, proof_indexer.id_records.pgp_public_key),
          last_event_txid = EXCLUDED.last_event_txid,
          updated_height = COALESCE(EXCLUDED.updated_height, proof_indexer.id_records.updated_height),
          updated_at = now()
      `,
      [
        NETWORK,
        String(item.id),
        item.ownerAddress,
        item.receiveAddress ?? item.ownerAddress,
        item.pgpPublicKey ?? null,
        item.txid,
        numberOrNull(item.blockHeight ?? item.height),
      ],
    );
  }

  if (sourceLabel === "tokens" && item?.tokenId && item?.ticker) {
    await client.query(
      `
        INSERT INTO proof_indexer.credit_definitions (
          network,
          token_id,
          ticker,
          creator_address,
          registry_address,
          max_supply,
          mint_amount,
          mint_price_sats,
          create_txid,
          confirmed,
          created_height,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        ON CONFLICT (network, token_id)
        DO UPDATE SET
          ticker = EXCLUDED.ticker,
          creator_address = EXCLUDED.creator_address,
          registry_address = EXCLUDED.registry_address,
          max_supply = EXCLUDED.max_supply,
          mint_amount = EXCLUDED.mint_amount,
          mint_price_sats = EXCLUDED.mint_price_sats,
          confirmed = EXCLUDED.confirmed,
          created_height = COALESCE(EXCLUDED.created_height, proof_indexer.credit_definitions.created_height),
          metadata = EXCLUDED.metadata
      `,
      [
        NETWORK,
        item.tokenId,
        item.ticker,
        item.creatorAddress ?? null,
        item.registryAddress,
        String(item.maxSupply ?? 0),
        String(item.mintAmount ?? 0),
        bigintOrZero(item.mintPriceSats),
        item.txid ?? item.tokenId,
        status === "confirmed",
        numberOrNull(item.blockHeight ?? item.height),
        JSON.stringify(item),
      ],
    );
  }

  if (sourceLabel === "token-holders" && item?.tokenId && item?.address) {
    await client.query(
      `
        INSERT INTO proof_indexer.credit_balances (
          network,
          token_id,
          address,
          confirmed_balance,
          pending_delta,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (network, token_id, address)
        DO UPDATE SET
          confirmed_balance = EXCLUDED.confirmed_balance,
          pending_delta = EXCLUDED.pending_delta,
          updated_at = now()
      `,
      [
        NETWORK,
        item.tokenId,
        item.address,
        String(item.balance ?? item.confirmedBalance ?? 0),
        String(item.pendingDelta ?? item.pendingBalance ?? 0),
      ],
    );
  }

  if (
    ["token-listings", "token-closed-listings"].includes(sourceLabel) &&
    item?.listingId &&
    item?.tokenId
  ) {
    await client.query(
      `
        INSERT INTO proof_indexer.credit_listings (
          network,
          listing_id,
          token_id,
          status,
          seller_address,
          buyer_address,
          amount,
          price_sats,
          sale_ticket_txid,
          sale_ticket_vout,
          sale_ticket_value_sats,
          seal_txid,
          close_txid,
          payload,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, now())
        ON CONFLICT (network, listing_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          seller_address = EXCLUDED.seller_address,
          buyer_address = EXCLUDED.buyer_address,
          amount = EXCLUDED.amount,
          price_sats = EXCLUDED.price_sats,
          sale_ticket_txid = EXCLUDED.sale_ticket_txid,
          sale_ticket_vout = EXCLUDED.sale_ticket_vout,
          sale_ticket_value_sats = EXCLUDED.sale_ticket_value_sats,
          seal_txid = EXCLUDED.seal_txid,
          close_txid = EXCLUDED.close_txid,
          payload = EXCLUDED.payload,
          updated_at = now()
      `,
      [
        NETWORK,
        item.listingId,
        item.tokenId,
        listingStatus(item, sourceLabel),
        item.sellerAddress ?? "",
        item.buyerAddress ?? null,
        String(item.amount ?? 0),
        bigintOrZero(item.priceSats),
        item.saleTicketTxid ?? item.saleAuthorization?.saleTicketTxid ?? null,
        numberOrNull(item.saleTicketVout ?? item.saleAuthorization?.saleTicketVout),
        bigintOrZero(item.saleTicketValueSats ?? item.saleAuthorization?.saleTicketValueSats),
        item.sealTxid ?? null,
        item.closedTxid ?? item.closeTxid ?? null,
        JSON.stringify(item),
      ],
    );
  }

  if (["mail", "reply", "file", "attachment", "browser"].includes(eventKind(item))) {
    const txid = itemTxid(item);
    if (txid) {
      await client.query(
        `
          INSERT INTO proof_indexer.mail_items (
            network,
            txid,
            status,
            sender_address,
            subject,
            parent_txid,
            body_text,
            amount_sats,
            data_bytes,
            message,
            event_time
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz)
          ON CONFLICT (network, txid)
          DO UPDATE SET
            status = EXCLUDED.status,
            sender_address = COALESCE(EXCLUDED.sender_address, proof_indexer.mail_items.sender_address),
            subject = COALESCE(EXCLUDED.subject, proof_indexer.mail_items.subject),
            parent_txid = COALESCE(EXCLUDED.parent_txid, proof_indexer.mail_items.parent_txid),
            body_text = COALESCE(EXCLUDED.body_text, proof_indexer.mail_items.body_text),
            amount_sats = EXCLUDED.amount_sats,
            data_bytes = EXCLUDED.data_bytes,
            message = EXCLUDED.message,
            event_time = COALESCE(EXCLUDED.event_time, proof_indexer.mail_items.event_time)
        `,
        [
          NETWORK,
          txid,
          status,
          item.senderAddress ?? null,
          item.subject ?? null,
          item.parentTxid ?? null,
          item.body ?? item.message ?? null,
          amountSats(item),
          dataBytes(item),
          JSON.stringify(item),
          itemTime(item),
        ],
      );
    }
  }
}

function listingStatus(item, sourceLabel) {
  if (item?.dropped) {
    return "dropped";
  }
  if (sourceLabel === "token-closed-listings") {
    if (item?.saleTxid || item?.buyerAddress) {
      return "sold";
    }
    return "delisted";
  }
  if (item?.sealTxid || item?.sealPending) {
    return "sealing";
  }
  return item?.confirmed === false ? "pending" : "active";
}

async function storeLedgerSnapshot(client) {
  const payload = await readJson(endpoint("/api/v1/ledger-consistency"));
  await client.query(
    `
      INSERT INTO proof_indexer.ledger_snapshots (
        network,
        snapshot_id,
        generated_at,
        indexed_through_block,
        source_hashes,
        metrics,
        consistency,
        payload
      )
      VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
      ON CONFLICT (network, snapshot_id)
      DO UPDATE SET
        generated_at = EXCLUDED.generated_at,
        indexed_through_block = EXCLUDED.indexed_through_block,
        source_hashes = EXCLUDED.source_hashes,
        metrics = EXCLUDED.metrics,
        consistency = EXCLUDED.consistency,
        payload = EXCLUDED.payload
    `,
    [
      NETWORK,
      payload.snapshotId ?? "unknown",
      payload.generatedAt ?? null,
      numberOrNull(payload.indexedThroughBlock),
      JSON.stringify(payload.sourceHashes ?? {}),
      JSON.stringify(payload.metrics ?? {}),
      JSON.stringify({
        checks: payload.checks ?? [],
        missingLogEvents: payload.missingLogEvents ?? [],
        ok: payload.ok,
        status: payload.status,
      }),
      JSON.stringify(payload),
    ],
  );
  return payload;
}

async function backfillSource(client, source) {
  let cursor = "";
  let page = 0;
  let seen = 0;
  let skipped = 0;

  while (page < MAX_PAGES) {
    const url = endpoint(source.path, { ...(source.params ?? {}), cursor });
    const payload = await readJson(url);
    const items = Array.isArray(payload.items) ? payload.items : [];

    await client.query("BEGIN");
    try {
      for (const item of items) {
        const result = await upsertEvent(client, source.label, item);
        if (result.skipped) {
          skipped += 1;
        } else {
          seen += 1;
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    console.log(
      JSON.stringify({
        cursor: payload.cursor,
        indexed: seen,
        page,
        skipped,
        source: source.label,
        totalCount: payload.totalCount,
      }),
    );

    cursor = String(payload.nextCursor ?? "");
    page += 1;
    if (!cursor || items.length === 0) {
      break;
    }
  }

  return { indexed: seen, skipped, source: source.label };
}

if (DRY_RUN) {
  console.log(
    JSON.stringify(
      {
        apiBase: API_BASE,
        dryRun: true,
        maxPages: MAX_PAGES,
        network: NETWORK,
        pageLimit: PAGE_LIMIT,
        sources: SOURCES.map((source) => source.label),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const pool = createProofIndexPool({
  env: {
    ...process.env,
    POW_INDEX_DB_APP_NAME:
      process.env.POW_INDEX_DB_APP_NAME ?? "proof-indexer-backfill",
  },
});

try {
  const client = await pool.connect();
  try {
    const snapshot = await storeLedgerSnapshot(client);
    const results = [];
    for (const source of SOURCES) {
      results.push(await backfillSource(client, source));
    }
    console.log(
      JSON.stringify(
        {
          apiBase: API_BASE,
          network: NETWORK,
          ok: true,
          results,
          snapshotId: snapshot.snapshotId,
        },
        null,
        2,
      ),
    );
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
