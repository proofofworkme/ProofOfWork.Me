#!/usr/bin/env node

const DEFAULT_API_BASE = "https://computer.proofofwork.me";
const API_BASE = String(process.env.POW_API_BASE ?? DEFAULT_API_BASE).replace(
  /\/+$/u,
  "",
);
const NETWORK = String(process.env.POW_NETWORK ?? "livenet");
const FETCH_TIMEOUT_MS = Number(process.env.POW_MAIL_CHECK_TIMEOUT_MS ?? 30000);

const CHECKS = [
  {
    address:
      "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed",
    label: "carbonz@proofofwork.me",
    minInbox: 1,
    minTotal: 1,
  },
  {
    address:
      "bc1p8ddc3s6z09ktchgdxxht8l0tt7gs7jn90w004uw2hrxuue39lp7qlxrd3q",
    label: "pinoratiko@proofofwork.me",
    minSent: 1,
    minTotal: 1,
  },
  {
    address: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
    label: "otc@proofofwork.me self-send",
    minInbox: 1,
    minSent: 1,
    minTotal: 2,
    mustInboxTxid:
      "64dcddd3bc035ad57e021f302f021fac5c135c20dcfeffb487ba6b23317d155e",
    mustSentTxid:
      "64dcddd3bc035ad57e021f302f021fac5c135c20dcfeffb487ba6b23317d155e",
  },
];

const REGISTRY_RESOLUTION_CHECKS = [
  {
    id: "otc",
    label: "otc@proofofwork.me",
    ownerAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
  },
];

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function countConfirmedInbox(payload) {
  return (Array.isArray(payload?.inboxMessages) ? payload.inboxMessages : [])
    .filter((message) => message?.confirmed).length;
}

function countVisibleSent(payload) {
  return (Array.isArray(payload?.sentMessages) ? payload.sentMessages : [])
    .filter((message) => message?.status === "confirmed").length;
}

async function fetchMailbox(check) {
  const url = new URL(
    `/api/v1/address/${encodeURIComponent(check.address)}/mail`,
    API_BASE,
  );
  url.searchParams.set("network", NETWORK);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${check.label} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchRegistry() {
  const url = new URL("/api/v1/registry", API_BASE);
  url.searchParams.set("network", NETWORK);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`registry returned HTTP ${response.status}`);
  }
  return response.json();
}

function assertRegistryResolution(payload) {
  const source = String(payload?.source ?? "");
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const failures = [];
  if (!source.includes("proof-indexer-registry-snapshot")) {
    failures.push(
      `expected proof-indexer-registry-snapshot source, got ${source || "none"}`,
    );
  }
  for (const check of REGISTRY_RESOLUTION_CHECKS) {
    const record = records.find(
      (item) =>
        item?.id === check.id &&
        item?.confirmed &&
        item?.ownerAddress === check.ownerAddress,
    );
    if (!record) {
      failures.push(`missing confirmed registry resolution for ${check.label}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`registry: ${failures.join("; ")}`);
  }
  return {
    records: records.length,
    source,
  };
}

function assertMailbox(check, payload) {
  const inboxMessages = Array.isArray(payload?.inboxMessages)
    ? payload.inboxMessages
    : [];
  const sentMessages = Array.isArray(payload?.sentMessages)
    ? payload.sentMessages
    : [];
  const inbox = countConfirmedInbox(payload);
  const sent = countVisibleSent(payload);
  const total = inboxMessages.length + sentMessages.length;
  const scanFailed = Boolean(payload?.stats?.scanFailed);
  const indexedEvents = numberValue(payload?.stats?.indexedEvents);
  const source = String(payload?.source ?? "");

  const failures = [];
  if (inbox < numberValue(check.minInbox)) {
    failures.push(`expected at least ${check.minInbox} confirmed inbox item(s)`);
  }
  if (sent < numberValue(check.minSent)) {
    failures.push(`expected at least ${check.minSent} confirmed sent item(s)`);
  }
  if (total < numberValue(check.minTotal)) {
    failures.push(`expected at least ${check.minTotal} total mail item(s)`);
  }
  if (scanFailed && indexedEvents === 0) {
    failures.push("scan failed and no indexed events were returned");
  }
  if (!source.includes("proof-indexer-mail")) {
    failures.push(`expected proof-indexer-mail source, got ${source || "none"}`);
  }
  if (
    check.mustInboxTxid &&
    !inboxMessages.some(
      (message) =>
        String(message?.txid ?? "").toLowerCase() === check.mustInboxTxid,
    )
  ) {
    failures.push(`missing inbox tx ${check.mustInboxTxid}`);
  }
  if (
    check.mustSentTxid &&
    !sentMessages.some(
      (message) =>
        String(message?.txid ?? "").toLowerCase() === check.mustSentTxid,
    )
  ) {
    failures.push(`missing sent tx ${check.mustSentTxid}`);
  }

  if (failures.length > 0) {
    throw new Error(`${check.label}: ${failures.join("; ")}`);
  }

  return { inbox, indexedEvents, scanFailed, sent, source, total };
}

const results = [];
const registryPayload = await fetchRegistry();
const registry = assertRegistryResolution(registryPayload);
for (const check of CHECKS) {
  const payload = await fetchMailbox(check);
  results.push({
    label: check.label,
    ...assertMailbox(check, payload),
  });
}

console.log(
  JSON.stringify(
    {
      apiBase: API_BASE,
      network: NETWORK,
      ok: true,
      registry,
      results,
    },
    null,
    2,
  ),
);
