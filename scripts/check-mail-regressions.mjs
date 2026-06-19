#!/usr/bin/env node

const DEFAULT_API_BASE = "https://computer.proofofwork.me";
const API_BASE = String(process.env.POW_API_BASE ?? DEFAULT_API_BASE).replace(
  /\/+$/u,
  "",
);
const NETWORK = String(process.env.POW_NETWORK ?? "livenet");
const FETCH_TIMEOUT_MS = Number(process.env.POW_MAIL_CHECK_TIMEOUT_MS ?? 15000);

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

function assertMailbox(check, payload) {
  const inbox = countConfirmedInbox(payload);
  const sent = countVisibleSent(payload);
  const total =
    (Array.isArray(payload?.inboxMessages) ? payload.inboxMessages.length : 0) +
    (Array.isArray(payload?.sentMessages) ? payload.sentMessages.length : 0);
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

  if (failures.length > 0) {
    throw new Error(`${check.label}: ${failures.join("; ")}`);
  }

  return { inbox, indexedEvents, scanFailed, sent, source, total };
}

const results = [];
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
      results,
    },
    null,
    2,
  ),
);
