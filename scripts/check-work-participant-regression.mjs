#!/usr/bin/env node

const API_BASE = String(
  process.env.POW_API_BASE ??
    process.env.VITE_POW_API_BASE ??
    "http://127.0.0.1:8081",
).replace(/\/+$/u, "");
const NETWORK = process.env.NETWORK ?? "livenet";
const REQUEST_TIMEOUT_MS = Number(
  process.env.WORK_PARTICIPANT_REGRESSION_TIMEOUT_MS ?? 60_000,
);

const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const INCEPTION_REGISTRATION_TXID =
  "20ecfdddbb5ca7ac82bf7deb812c561d3156a3a5ef2abbd93142f7838021e640";
const CARBONZ_ADDRESS =
  "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed";
const CARBONZ_TRANSFER_TXID =
  "6ed13a1783d612dc1c1f692d2bd6e60c55f3bf88ead9352112a78931ea18852f";
const CARBONZ_TRANSFER_RECIPIENT = "18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW";
const CARBONZ_FUNDING_SALE_TXID =
  "efba11aea43cfac9943009abed07ce287066a5b2708809c6b32a761adb73f884";
const CARBONZ_FUNDING_LISTING_ID =
  "7096eaec54fef90468dff9a8ae70c312f1d6a90fdecb6a6196f230519f699f73";
const CARBONZ_FUNDING_SALE_HEIGHT = 956_362;
const CARBONZ_TRANSFER_HEIGHT = 956_369;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function endpoint(pathname, params = {}) {
  const url = new URL(pathname, `${API_BASE}/`);
  url.searchParams.set("network", NETWORK);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function readJson(pathname, params) {
  const url = endpoint(pathname, params);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url.pathname}${url.search} returned HTTP ${response.status}`);
  }
  return response.json();
}

function payloadItems(payload) {
  for (const key of ["items", "transfers", "activity", "events"]) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }
  return [];
}

function txidOf(item) {
  return String(item?.txid ?? item?.txId ?? "").trim().toLowerCase();
}

function itemForTxid(payload, txid) {
  const normalized = txid.toLowerCase();
  return payloadItems(payload).find((item) => txidOf(item) === normalized);
}

function itemsForTxid(payload, txid) {
  const normalized = txid.toLowerCase();
  return payloadItems(payload).filter((item) => txidOf(item) === normalized);
}

function collectionItemForTxid(items, txid) {
  const normalized = txid.toLowerCase();
  return (Array.isArray(items) ? items : []).find(
    (item) => txidOf(item) === normalized,
  );
}

function stringFields(item) {
  return JSON.stringify(item ?? {}).toLowerCase();
}

function assertCanonicalTransfer(item, surface) {
  assert(item, `${surface} is missing the reported Carbonz WORK transfer`);
  assert(
    item.confirmed === true && item.valid !== false,
    `${surface} did not preserve the transfer as confirmed and valid`,
  );
  assert(
    Number(item.amount ?? 0) === 300_000,
    `${surface} did not preserve the 300,000 WORK amount`,
  );
  if (item.blockHeight != null) {
    assert(
      Number(item.blockHeight) === CARBONZ_TRANSFER_HEIGHT,
      `${surface} did not preserve the canonical transfer height`,
    );
  }
  assert(
    String(item.tokenId ?? WORK_TOKEN_ID).toLowerCase() === WORK_TOKEN_ID &&
      String(item.ticker ?? "WORK").toUpperCase() === "WORK",
    `${surface} did not preserve the WORK asset scope`,
  );
  assert(
    String(item.senderAddress ?? "").toLowerCase() ===
      CARBONZ_ADDRESS.toLowerCase(),
    `${surface} did not preserve Carbonz as sender`,
  );
  assert(
    String(item.recipientAddress ?? "").toLowerCase() ===
      CARBONZ_TRANSFER_RECIPIENT.toLowerCase(),
    `${surface} did not preserve the transfer recipient`,
  );
}

function assertCanonicalSurfaceEvent(item, surface) {
  assert(item, `${surface} is missing the reported Carbonz WORK transfer`);
  const serialized = stringFields(item);
  assert(
    item.confirmed === true && item.valid !== false,
    `${surface} did not preserve the transfer as confirmed and valid`,
  );
  assert(
    String(item.kind ?? "").toLowerCase() === "token-transfer",
    `${surface} did not classify the event as a token transfer`,
  );
  assert(
    Number(item.blockHeight ?? 0) === CARBONZ_TRANSFER_HEIGHT,
    `${surface} did not preserve the canonical transfer height`,
  );
  assert(
    serialized.includes(CARBONZ_ADDRESS.toLowerCase()) &&
      serialized.includes(CARBONZ_TRANSFER_RECIPIENT.toLowerCase()),
    `${surface} is missing sender or recipient participant context`,
  );
}

async function main() {
  const idState = await readJson("/api/v1/ids/inception", {
    current: 1,
    fresh: 1,
  });
  assert(
    idState?.record?.confirmed === true &&
      String(idState.record.id ?? "").toLowerCase() === "inception" &&
      String(idState.record.txid ?? "").toLowerCase() ===
        INCEPTION_REGISTRATION_TXID,
    "fresh current exact-ID read did not return confirmed inception@proofofwork.me",
  );

  const fundingSales = await readJson("/api/v1/token-history", {
    asset: WORK_TOKEN_ID,
    fresh: 1,
    kind: "sales",
    limit: 100,
    q: CARBONZ_FUNDING_SALE_TXID,
  });
  const fundingSale = itemForTxid(fundingSales, CARBONZ_FUNDING_SALE_TXID);
  assert(
    itemsForTxid(fundingSales, CARBONZ_FUNDING_SALE_TXID).length === 1 &&
      fundingSale?.confirmed === true &&
      fundingSale?.valid !== false &&
      Number(fundingSale?.amount ?? 0) === 420_000 &&
      String(fundingSale?.buyerAddress ?? "").toLowerCase() ===
        CARBONZ_ADDRESS.toLowerCase() &&
      String(fundingSale?.listingId ?? "").toLowerCase() ===
        CARBONZ_FUNDING_LISTING_ID,
    "the confirmed 420,000 WORK sale funding Carbonz is missing or incomplete",
  );

  const fundingSaleEvents = await readJson("/api/v1/event-history", {
    kind: "token-sale",
    limit: 100,
    status: "confirmed",
    txid: CARBONZ_FUNDING_SALE_TXID,
  });
  const fundingSaleEvent = itemForTxid(
    fundingSaleEvents,
    CARBONZ_FUNDING_SALE_TXID,
  );
  assert(
    itemsForTxid(fundingSaleEvents, CARBONZ_FUNDING_SALE_TXID).length === 1 &&
      fundingSaleEvent?.confirmed === true &&
      fundingSaleEvent?.valid !== false &&
      String(fundingSaleEvent?.kind ?? "").toLowerCase() === "token-sale" &&
      Number(fundingSaleEvent?.amount ?? 0) === 420_000 &&
      Number(fundingSaleEvent?.blockHeight ?? 0) ===
        CARBONZ_FUNDING_SALE_HEIGHT,
    "Event History is missing the canonical 420,000 WORK sale funding Carbonz",
  );
  assert(
    CARBONZ_FUNDING_SALE_HEIGHT < CARBONZ_TRANSFER_HEIGHT &&
      Number(fundingSaleEvent.amount) >= 300_000,
    "the canonical funding sale does not precede and cover the reported transfer",
  );

  const transferHistory = await readJson("/api/v1/token-history", {
    asset: WORK_TOKEN_ID,
    fresh: 1,
    kind: "transfers",
    limit: 100,
    q: CARBONZ_TRANSFER_TXID,
  });
  assert(
    itemsForTxid(transferHistory, CARBONZ_TRANSFER_TXID).length === 1,
    "WORK transfer history does not contain exactly one canonical reported transfer",
  );
  assertCanonicalTransfer(
    itemForTxid(transferHistory, CARBONZ_TRANSFER_TXID),
    "WORK transfer history",
  );
  assert(
    !(Array.isArray(transferHistory.canonicalInvalidTxids)
      ? transferHistory.canonicalInvalidTxids
      : []
    ).some((txid) => String(txid).toLowerCase() === CARBONZ_TRANSFER_TXID),
    "WORK transfer history incorrectly marks the canonical transfer txid invalid",
  );

  const transferHistoryByTxid = await readJson("/api/v1/token-history", {
    asset: WORK_TOKEN_ID,
    fresh: 1,
    kind: "transfers",
    limit: 100,
    txid: CARBONZ_TRANSFER_TXID,
  });
  assert(
    itemsForTxid(transferHistoryByTxid, CARBONZ_TRANSFER_TXID).length === 1,
    "exact txid transfer history does not contain exactly one canonical row",
  );
  assertCanonicalTransfer(
    itemForTxid(transferHistoryByTxid, CARBONZ_TRANSFER_TXID),
    "exact txid transfer history",
  );
  assert(
    !(Array.isArray(transferHistoryByTxid.canonicalInvalidTxids)
      ? transferHistoryByTxid.canonicalInvalidTxids
      : []
    ).some((txid) => String(txid).toLowerCase() === CARBONZ_TRANSFER_TXID),
    "exact txid transfer history incorrectly marks the canonical transfer invalid",
  );

  for (const exactParams of [
    { q: CARBONZ_TRANSFER_TXID },
    { txid: CARBONZ_TRANSFER_TXID },
  ]) {
    const invalidByTxid = await readJson("/api/v1/token-history", {
      asset: WORK_TOKEN_ID,
      fresh: 1,
      kind: "invalid-events",
      limit: 100,
      ...exactParams,
    });
    assert(
      !itemForTxid(invalidByTxid, CARBONZ_TRANSFER_TXID),
      "the valid Carbonz transfer still has a stale invalid-event alias",
    );
  }

  for (const address of [CARBONZ_ADDRESS, CARBONZ_TRANSFER_RECIPIENT]) {
    const scopedHistory = await readJson("/api/v1/token-history", {
      asset: WORK_TOKEN_ID,
      fresh: 1,
      kind: "transfers",
      limit: 100,
      q: address,
      txid: CARBONZ_TRANSFER_TXID,
    });
    assert(
      itemsForTxid(scopedHistory, CARBONZ_TRANSFER_TXID).length === 1,
      `${address} scoped transfer history is missing or duplicating the transfer`,
    );
    assertCanonicalTransfer(
      itemForTxid(scopedHistory, CARBONZ_TRANSFER_TXID),
      `${address} scoped transfer history`,
    );

    const wallet = await readJson("/api/v1/token", {
      address,
      asset: WORK_TOKEN_ID,
      fresh: 1,
      wallet: 1,
    });
    assert(
      (Array.isArray(wallet.transfers) ? wallet.transfers : []).filter(
        (item) => txidOf(item) === CARBONZ_TRANSFER_TXID,
      ).length === 1,
      `${address} Wallet is missing or duplicating the transfer`,
    );
    assertCanonicalTransfer(
      collectionItemForTxid(wallet.transfers, CARBONZ_TRANSFER_TXID),
      `${address} Wallet`,
    );
    assert(
      !collectionItemForTxid(wallet.invalidEvents, CARBONZ_TRANSFER_TXID),
      `${address} Wallet still exposes a stale invalid-event alias`,
    );
  }

  for (const query of [
    {
      params: { kind: "token-transfer", limit: 100, q: CARBONZ_TRANSFER_TXID },
      path: "/api/v1/log-history",
    },
    {
      params: {
        address: CARBONZ_ADDRESS,
        kind: "token-transfer",
        limit: 100,
        status: "confirmed",
        txid: CARBONZ_TRANSFER_TXID,
      },
      path: "/api/v1/event-history",
    },
    {
      params: {
        address: CARBONZ_TRANSFER_RECIPIENT,
        kind: "token-transfer",
        limit: 100,
        status: "confirmed",
        txid: CARBONZ_TRANSFER_TXID,
      },
      path: "/api/v1/event-history",
    },
    {
      params: { kind: "token-transfer", limit: 100, q: CARBONZ_TRANSFER_TXID },
      path: "/api/v1/log",
    },
  ]) {
    const history = await readJson(query.path, query.params);
    assert(
      itemsForTxid(history, CARBONZ_TRANSFER_TXID).length === 1,
      `${query.path} is missing or duplicating the reported transfer`,
    );
    assertCanonicalSurfaceEvent(
      itemForTxid(history, CARBONZ_TRANSFER_TXID),
      query.path,
    );
  }

  for (const query of [
    {
      params: { limit: 100, status: "confirmed", txid: CARBONZ_TRANSFER_TXID },
      path: "/api/v1/event-history",
    },
    {
      params: { limit: 100, q: CARBONZ_TRANSFER_TXID },
      path: "/api/v1/log-history",
    },
  ]) {
    const history = await readJson(query.path, query.params);
    assert(
      itemsForTxid(history, CARBONZ_TRANSFER_TXID).length === 1,
      `${query.path} exposes a missing or duplicate semantic alias for the transfer`,
    );
    assertCanonicalSurfaceEvent(
      itemForTxid(history, CARBONZ_TRANSFER_TXID),
      `${query.path} unkinded exact lookup`,
    );
  }

  for (const path of ["/api/v1/log-history", "/api/v1/event-history"]) {
    const invalidHistory = await readJson(path, {
      kind: "token-event-invalid",
      limit: 100,
      q: CARBONZ_TRANSFER_TXID,
      status: "confirmed",
      txid: CARBONZ_TRANSFER_TXID,
    });
    assert(
      !itemForTxid(invalidHistory, CARBONZ_TRANSFER_TXID),
      `${path} still exposes a stale invalid-event alias for the transfer`,
    );
  }

  console.log(
    JSON.stringify(
      {
        apiBase: API_BASE,
        carbonzAddress: CARBONZ_ADDRESS,
        fundingSaleTxid: CARBONZ_FUNDING_SALE_TXID,
        fundingSaleHeight: CARBONZ_FUNDING_SALE_HEIGHT,
        inceptionTxid: idState.record.txid,
        ok: true,
        transferAmount: 300_000,
        transferHeight: CARBONZ_TRANSFER_HEIGHT,
        transferTxid: CARBONZ_TRANSFER_TXID,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
