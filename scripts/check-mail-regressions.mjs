#!/usr/bin/env node

const DEFAULT_API_BASE = "https://computer.proofofwork.me";
const API_BASE = String(process.env.POW_API_BASE ?? DEFAULT_API_BASE).replace(
  /\/+$/u,
  "",
);
const NETWORK = String(process.env.POW_NETWORK ?? "livenet");
const FETCH_TIMEOUT_MS = Number(process.env.POW_MAIL_CHECK_TIMEOUT_MS ?? 90000);

const CHECKS = [
  {
    address:
      "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed",
    label: "carbonz@proofofwork.me",
    minInbox: 1,
    minTotal: 1,
    mustNotInboxTxid:
      "8e9074486fa0a6a75fd01f20c8a41a56ccd964be569e61e81e92c60266c001f0",
  },
  {
    address: "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH",
    label: "armyofyouth@proofofwork.me",
    minInbox: 1,
    minTotal: 1,
    mustDroppedOutboxTxid:
      "8e9074486fa0a6a75fd01f20c8a41a56ccd964be569e61e81e92c60266c001f0",
    mustBodyIncludes: "confirmed network value / 21,000,000 WORK",
    mustBodySubject: "$work now has a permanent Bitcoin Computer floor.",
    mustBodyTxid:
      "cbb8a1b4af2ea8665129e799a85dfba31cea87ef38b9a99bcf198d827c12a58c",
    mustInboxTxid:
      "91a754469f5efcbf4312a71a11352fa3141eef19a6ace923ad22b16250c05e37",
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
    minInbox: 2,
    minSent: 2,
    minTotal: 4,
    mustInboxTxid:
      "64dcddd3bc035ad57e021f302f021fac5c135c20dcfeffb487ba6b23317d155e",
    mustInfinityBondAmountSats: 50_000,
    mustInfinityBondTxid:
      "64dcddd3bc035ad57e021f302f021fac5c135c20dcfeffb487ba6b23317d155e",
    mustSentTxid:
      "64dcddd3bc035ad57e021f302f021fac5c135c20dcfeffb487ba6b23317d155e",
    mustUniqueTxids: [
      "64dcddd3bc035ad57e021f302f021fac5c135c20dcfeffb487ba6b23317d155e",
      "7a416ae4f98588ca20adbd55917ed5ae36b6f9f20e4a5241e4f84b8bb255cbed",
    ],
  },
  {
    address: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
    label: "otc@proofofwork.me latest POWB self-send",
    minInbox: 6,
    minSent: 6,
    minTotal: 12,
    mustInboxTxid:
      "e54e68d1e567ab6158100d27a6fe357950d19248336af90fd4e7ed068f650b46",
    mustInfinityBondAmountSats: 30_000,
    mustInfinityBondTxid:
      "e54e68d1e567ab6158100d27a6fe357950d19248336af90fd4e7ed068f650b46",
    mustSentTxid:
      "e54e68d1e567ab6158100d27a6fe357950d19248336af90fd4e7ed068f650b46",
    mustInboxTxids: [
      "e54e68d1e567ab6158100d27a6fe357950d19248336af90fd4e7ed068f650b46",
      "bb7e8873088c9244afb38c23186d2dc7394c49bac48ee89be025da71518e9cec",
      "e26a42c356c5230cbb060580f78fc1d026a39f057d949082fe60bdb97d998b09",
      "7a416ae4f98588ca20adbd55917ed5ae36b6f9f20e4a5241e4f84b8bb255cbed",
      "9bc8b59e7befc0a2f48403f2b2e8416336e4b80357f3e11e0fc6e1fb58eb7701",
      "64dcddd3bc035ad57e021f302f021fac5c135c20dcfeffb487ba6b23317d155e",
    ],
    mustSentTxids: [
      "e54e68d1e567ab6158100d27a6fe357950d19248336af90fd4e7ed068f650b46",
      "bb7e8873088c9244afb38c23186d2dc7394c49bac48ee89be025da71518e9cec",
      "e26a42c356c5230cbb060580f78fc1d026a39f057d949082fe60bdb97d998b09",
      "7a416ae4f98588ca20adbd55917ed5ae36b6f9f20e4a5241e4f84b8bb255cbed",
      "9bc8b59e7befc0a2f48403f2b2e8416336e4b80357f3e11e0fc6e1fb58eb7701",
      "64dcddd3bc035ad57e021f302f021fac5c135c20dcfeffb487ba6b23317d155e",
    ],
    mustUniqueTxids: [
      "e54e68d1e567ab6158100d27a6fe357950d19248336af90fd4e7ed068f650b46",
      "bb7e8873088c9244afb38c23186d2dc7394c49bac48ee89be025da71518e9cec",
      "e26a42c356c5230cbb060580f78fc1d026a39f057d949082fe60bdb97d998b09",
      "9bc8b59e7befc0a2f48403f2b2e8416336e4b80357f3e11e0fc6e1fb58eb7701",
      "64dcddd3bc035ad57e021f302f021fac5c135c20dcfeffb487ba6b23317d155e",
      "7a416ae4f98588ca20adbd55917ed5ae36b6f9f20e4a5241e4f84b8bb255cbed",
    ],
  },
  {
    address: "bc1q7lvsdf0lpgmvn0c8emj9zvjm0sycn4lu3qrry0",
    label: "desktop public file sender",
    minSent: 1,
    minTotal: 1,
    mustAttachmentMime: "image/jpeg",
    mustAttachmentName: "pepe mic drop.jpeg",
    mustAttachmentTxid:
      "e6ad5d7c10e19bd3e34155061ba05ed4862b2aecf35ae4dc5f59a10aedaf22a1",
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

async function fetchHistory(pathname, params = {}) {
  const url = new URL(pathname, API_BASE);
  url.searchParams.set("network", NETWORK);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${pathname} returned HTTP ${response.status}`);
  }
  return response.json();
}

function historyItems(payload) {
  return Array.isArray(payload?.items) ? payload.items : [];
}

function duplicateRegistryIds(records) {
  const seen = new Set();
  const duplicates = new Set();
  for (const record of records) {
    const id = String(record?.id ?? "").trim().toLowerCase();
    if (!id) {
      continue;
    }
    if (seen.has(id)) {
      duplicates.add(id);
      continue;
    }
    seen.add(id);
  }
  return [...duplicates];
}

function assertRegistryResolution(payload) {
  const source = String(payload?.source ?? "");
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const failures = [];
  if (!source) {
    failures.push("missing registry source");
  }
  const duplicateIds = duplicateRegistryIds(records);
  if (duplicateIds.length > 0) {
    failures.push(
      `duplicate registry IDs: ${duplicateIds.slice(0, 8).join(", ")}`,
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
  for (const txid of check.mustInboxTxids ?? []) {
    const normalizedTxid = String(txid).toLowerCase();
    if (
      !inboxMessages.some(
        (message) =>
          String(message?.txid ?? "").toLowerCase() === normalizedTxid &&
          message?.confirmed,
      )
    ) {
      failures.push(`missing confirmed inbox tx ${normalizedTxid}`);
    }
  }
  if (
    check.mustNotInboxTxid &&
    inboxMessages.some(
      (message) =>
        String(message?.txid ?? "").toLowerCase() === check.mustNotInboxTxid,
    )
  ) {
    failures.push(`dropped tx ${check.mustNotInboxTxid} leaked into inbox`);
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
  for (const txid of check.mustSentTxids ?? []) {
    const normalizedTxid = String(txid).toLowerCase();
    if (
      !sentMessages.some(
        (message) =>
          String(message?.txid ?? "").toLowerCase() === normalizedTxid &&
          message?.status === "confirmed",
      )
    ) {
      failures.push(`missing confirmed sent tx ${normalizedTxid}`);
    }
  }
  if (
    check.mustDroppedOutboxTxid &&
    !sentMessages.some(
      (message) =>
        String(message?.txid ?? "").toLowerCase() ===
          check.mustDroppedOutboxTxid &&
        message?.status === "dropped",
    )
  ) {
    failures.push(`missing dropped outbox tx ${check.mustDroppedOutboxTxid}`);
  }
  for (const txid of check.mustUniqueTxids ?? []) {
    const normalizedTxid = String(txid).toLowerCase();
    const inboxMatches = inboxMessages.filter(
      (message) =>
        String(message?.txid ?? "").toLowerCase() === normalizedTxid,
    );
    const sentMatches = sentMessages.filter(
      (message) =>
        String(message?.txid ?? "").toLowerCase() === normalizedTxid,
    );
    if (inboxMatches.length > 1) {
      failures.push(`duplicate inbox tx ${normalizedTxid}`);
    }
    if (sentMatches.length > 1) {
      failures.push(`duplicate sent tx ${normalizedTxid}`);
    }
  }
  if (check.mustBodyTxid) {
    const message = [...inboxMessages, ...sentMessages].find(
      (item) =>
        String(item?.txid ?? "").toLowerCase() ===
        String(check.mustBodyTxid).toLowerCase(),
    );
    if (!message) {
      failures.push(`missing subject/body tx ${check.mustBodyTxid}`);
    } else {
      const memo = String(message.memo ?? "");
      const subject = String(message.subject ?? "");
      if (check.mustBodySubject && subject !== check.mustBodySubject) {
        failures.push(`subject/body tx ${check.mustBodyTxid} has wrong subject`);
      }
      if (!memo.includes(check.mustBodyIncludes)) {
        failures.push(`subject/body tx ${check.mustBodyTxid} is missing body text`);
      }
      if (/^Subject:\s*/iu.test(memo.trim())) {
        failures.push(`subject/body tx ${check.mustBodyTxid} still uses subject as body`);
      }
    }
  }
  if (check.mustAttachmentTxid) {
    const message = [...inboxMessages, ...sentMessages].find(
      (item) =>
        String(item?.txid ?? "").toLowerCase() ===
        String(check.mustAttachmentTxid).toLowerCase(),
    );
    if (!message) {
      failures.push(`missing attachment tx ${check.mustAttachmentTxid}`);
    } else if (!message.attachment) {
      failures.push(`attachment tx ${check.mustAttachmentTxid} has no attachment`);
    } else {
      const name = String(message.attachment.name ?? "");
      const mime = String(message.attachment.mime ?? "");
      if (check.mustAttachmentName && name !== check.mustAttachmentName) {
        failures.push(
          `attachment tx ${check.mustAttachmentTxid} has wrong name ${name}`,
        );
      }
      if (check.mustAttachmentMime && mime !== check.mustAttachmentMime) {
        failures.push(
          `attachment tx ${check.mustAttachmentTxid} has wrong mime ${mime}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`${check.label}: ${failures.join("; ")}`);
  }

  return { inbox, indexedEvents, scanFailed, sent, source, total };
}

function assertInfinityBondHistory(check, logPayload, eventPayload) {
  const expectedTxid = String(check.mustInfinityBondTxid ?? "").toLowerCase();
  if (!expectedTxid) {
    return null;
  }

  const minAmount = numberValue(check.mustInfinityBondAmountSats);
  const isExpectedBond = (item) =>
    String(item?.txid ?? "").toLowerCase() === expectedTxid &&
    item?.kind === "infinity-bond" &&
    numberValue(item?.amountSats) >= minAmount;
  const duplicateKeys = (items) => {
    const counts = new Map();
    for (const item of items.filter(isExpectedBond)) {
      const key = `${item.kind}:${String(item.txid ?? "").toLowerCase()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count > 1);
  };
  const failures = [];
  if (!historyItems(logPayload).some(isExpectedBond)) {
    failures.push(`missing Log infinity-bond tx ${expectedTxid}`);
  }
  if (!historyItems(eventPayload).some(isExpectedBond)) {
    failures.push(`missing Event infinity-bond tx ${expectedTxid}`);
  }
  const logDuplicates = duplicateKeys(historyItems(logPayload));
  const eventDuplicates = duplicateKeys(historyItems(eventPayload));
  if (logDuplicates.length > 0) {
    failures.push(`duplicate Log infinity-bond tx ${expectedTxid}`);
  }
  if (eventDuplicates.length > 0) {
    failures.push(`duplicate Event infinity-bond tx ${expectedTxid}`);
  }
  if (failures.length > 0) {
    throw new Error(`${check.label}: ${failures.join("; ")}`);
  }
  return {
    eventHistoryCount: numberValue(eventPayload?.totalCount),
    logHistoryCount: numberValue(logPayload?.totalCount),
    txid: expectedTxid,
  };
}

const results = [];
const historyResults = [];
const registryPayload = await fetchRegistry();
const registry = assertRegistryResolution(registryPayload);
for (const check of CHECKS) {
  const payload = await fetchMailbox(check);
  results.push({
    label: check.label,
    ...assertMailbox(check, payload),
  });
  if (check.mustInfinityBondTxid) {
    const [logPayload, eventPayload] = await Promise.all([
      fetchHistory("/api/v1/log-history", {
        kind: "infinity-bond",
        limit: 20,
        q: check.mustInfinityBondTxid,
      }),
      fetchHistory("/api/v1/event-history", {
        address: check.address,
        kind: "infinity-bond",
        limit: 50,
      }),
    ]);
    historyResults.push({
      label: check.label,
      ...assertInfinityBondHistory(check, logPayload, eventPayload),
    });
  }
}

console.log(
  JSON.stringify(
    {
      apiBase: API_BASE,
      network: NETWORK,
      ok: true,
      registry,
      historyResults,
      results,
    },
    null,
    2,
  ),
);
