import { createHash } from "node:crypto";

import {
  PROOF_INDEX_RENDERED_MAIL_KINDS,
} from "./proof-index-mail-projection.mjs";

export const PROOF_INDEX_EVENT_RELATION_PARITY_MODEL =
  "canonical-proof-index-rendered-event-relation-parity-v1";

const RENDERED_MAIL_KIND_SET = new Set(PROOF_INDEX_RENDERED_MAIL_KINDS);

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function canonicalText(value) {
  return String(value ?? "").trim();
}

function observedText(value) {
  return String(value ?? "");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalRows(rows, keyForRow) {
  const unique = new Map();
  for (const row of rows) {
    unique.set(keyForRow(row), row);
  }
  return [...unique.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, row]) => row);
}

function firstCanonicalText(...values) {
  for (const value of values) {
    const text = canonicalText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function renderedMailParticipantContext(item, context = {}) {
  const source = objectRecord(item);
  const event = objectRecord(context);
  const protocol = canonicalText(event.protocol ?? source.protocol)
    .toLowerCase();
  const kind = canonicalText(event.kind ?? source.kind).toLowerCase();
  return protocol === "pwm1" && RENDERED_MAIL_KIND_SET.has(kind);
}

export function proofIndexMailParticipantAliasesForItem(item, context = {}) {
  if (!renderedMailParticipantContext(item, context)) {
    return [];
  }
  const source = objectRecord(item);
  const aliases = [];
  const add = (address, role) => {
    const value = canonicalText(address);
    if (value) {
      aliases.push({ address: value, powid: "", role });
    }
  };
  add(
    firstCanonicalText(source.senderAddress, source.from, source.actor),
    "sender",
  );
  add(
    firstCanonicalText(
      source.recipientAddress,
      source.to,
      source.counterparty,
    ),
    "recipient",
  );
  for (const recipient of Array.isArray(source.recipients)
    ? source.recipients
    : []) {
    add(recipient?.address ?? recipient?.display, "recipient");
  }
  return canonicalRows(aliases, (participant) =>
    JSON.stringify([
      participant.address,
      participant.role,
      participant.powid,
    ])
  );
}

function canonicalParticipantRow(value) {
  const row = objectRecord(value);
  return {
    address: canonicalText(row.address),
    eventId: canonicalText(row.eventId ?? row.event_id),
    powid: canonicalText(row.powid),
    role: canonicalText(row.role),
  };
}

function observedParticipantRow(value) {
  const row = objectRecord(value);
  return {
    address: observedText(row.address),
    eventId: observedText(row.eventId ?? row.event_id),
    powid: observedText(row.powid),
    role: observedText(row.role),
  };
}

function participantKey(row) {
  return JSON.stringify([
    row.eventId,
    row.address,
    row.role,
    row.powid,
  ]);
}

function observedRefRow(value) {
  const row = objectRecord(value);
  return {
    eventId: observedText(row.eventId ?? row.event_id),
    refType: observedText(row.refType ?? row.ref_type),
    refValue: observedText(row.refValue ?? row.ref_value),
  };
}

function refKey(row) {
  return JSON.stringify([row.eventId, row.refType, row.refValue]);
}

function relationRowsSha256(label, rows) {
  return createHash("sha256")
    .update(
      Buffer.from(
        `ProofOfWork.Me/PROOF-INDEX-EVENT-${label}/v1\n${
          JSON.stringify(rows)
        }`,
        "utf8",
      ),
    )
    .digest("hex");
}

function relationParity(expectedRows, observedRows, keyForRow, label) {
  const expected = canonicalRows(expectedRows, keyForRow);
  const observed = canonicalRows(observedRows, keyForRow);
  const expectedKeys = new Set(expected.map(keyForRow));
  const observedKeys = new Set(observed.map(keyForRow));
  const missing = expected.filter((row) => !observedKeys.has(keyForRow(row)));
  const extra = observed.filter((row) => !expectedKeys.has(keyForRow(row)));
  return {
    expectedCount: expected.length,
    extraCount: extra.length,
    extraSample: extra.slice(0, 20),
    extraSha256: relationRowsSha256(`${label}-EXTRA`, extra),
    missingCount: missing.length,
    missingSample: missing.slice(0, 20),
    missingSha256: relationRowsSha256(`${label}-MISSING`, missing),
    observedCount: observed.length,
    ready: missing.length === 0 && extra.length === 0,
  };
}

export function proofIndexEventParticipantsForItem(item, context = {}) {
  const source = objectRecord(item);
  const authorization = objectRecord(source.saleAuthorization);
  const inceptionAttachment = objectRecord(source.inceptionAttachment);
  const participants = [];
  const add = (address, role, powid = "") => {
    const value = canonicalText(address);
    if (value) {
      participants.push({
        address: value,
        powid: canonicalText(powid),
        role,
      });
    }
  };
  for (const address of Array.isArray(source.participants)
    ? source.participants
    : []) {
    add(address, "participant");
  }
  for (const recipient of Array.isArray(source.recipients)
    ? source.recipients
    : []) {
    add(recipient?.address ?? recipient?.display, "recipient");
  }
  for (const credit of Array.isArray(source.attachedCredits)
    ? source.attachedCredits
    : []) {
    add(credit?.recipientAddress, "recipient");
    add(credit?.registryAddress, "registry");
  }
  add(source.address, "address");
  add(source.actor, "actor");
  add(source.counterparty, "counterparty");
  add(source.senderAddress, "sender");
  add(source.authorAddress, "author", source.authorId);
  add(source.recipientAddress, "recipient");
  add(source.ownerAddress, "owner", source.id);
  add(source.currentOwnerAddress, "owner", source.currentOwnerId);
  add(source.targetOwnerAddress, "target-owner", source.targetOwnerId);
  add(source.receiveAddress, "receiver", source.id);
  add(source.sellerAddress, "seller");
  add(source.buyerAddress, "buyer");
  add(source.registryAddress, "registry");
  add(authorization.sellerAddress, "seller");
  add(authorization.buyerAddress, "buyer");
  add(authorization.registryAddress, "registry");
  add(
    authorization.receiveAddress,
    "receiver",
    firstCanonicalText(authorization.id, source.id),
  );
  add(inceptionAttachment.recipientAddress, "recipient");
  add(inceptionAttachment.registryAddress, "registry");
  add(source.creatorAddress, "creator");
  add(source.minterAddress, "minter");
  participants.push(
    ...proofIndexMailParticipantAliasesForItem(source, context),
  );
  return canonicalRows(participants, (participant) =>
    JSON.stringify([
      participant.address,
      participant.role,
      participant.powid,
    ])
  );
}

export function proofIndexEventRefsForItem(item) {
  const source = objectRecord(item);
  const authorization = objectRecord(source.saleAuthorization);
  const inceptionAttachment = objectRecord(source.inceptionAttachment);
  const refs = [];
  const add = (refType, refValue) => {
    const value = canonicalText(refValue);
    if (value) {
      refs.push({ refType, refValue: value });
    }
  };
  const addSaleTicketOutpoint = (txid, vout) => {
    const canonicalTxid = canonicalText(txid);
    const canonicalVout = canonicalText(vout);
    if (canonicalTxid && canonicalVout) {
      add("sale-ticket-outpoint", `${canonicalTxid}:${canonicalVout}`);
    }
  };
  add("powid", source.id);
  add("powid", authorization.id);
  add("token-id", source.tokenId);
  add("token-id", authorization.tokenId);
  add("ticker", source.ticker);
  add("ticker", authorization.ticker);
  add("listing-id", source.listingId);
  add("boost-txid", source.boostTxid);
  add("target-txid", source.targetTxid);
  add("parent-txid", source.parentTxid);
  add("closed-txid", source.closedTxid);
  add("seal-txid", source.sealTxid);
  for (const credit of Array.isArray(source.attachedCredits)
    ? source.attachedCredits
    : []) {
    add("token-id", credit?.tokenId);
    add("ticker", credit?.ticker);
  }
  add("token-id", inceptionAttachment.tokenId);
  add("ticker", inceptionAttachment.ticker);
  addSaleTicketOutpoint(source.saleTicketTxid, source.saleTicketVout);
  addSaleTicketOutpoint(
    authorization.saleTicketTxid,
    authorization.saleTicketVout,
  );
  addSaleTicketOutpoint(authorization.anchorTxid, authorization.anchorVout);
  return canonicalRows(refs, (ref) =>
    JSON.stringify([ref.refType, ref.refValue])
  );
}

export function proofIndexCanonicalEventRelationParity({
  eventRows,
  participantRows,
  refRows,
  supplementalParticipantRows,
} = {}) {
  const events = new Map();
  const statusCounts = new Map();
  for (const row of Array.isArray(eventRows) ? eventRows : []) {
    const eventId = canonicalText(row?.event_id ?? row?.eventId);
    if (eventId) {
      events.set(eventId, {
        event: objectRecord(row),
        payload: objectRecord(row?.payload),
      });
      const status = canonicalText(row?.status).toLowerCase();
      if (status) {
        statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
      }
    }
  }
  const expectedParticipants = [];
  const expectedRefs = [];
  for (const [eventId, { event, payload }] of events) {
    expectedParticipants.push(
      ...proofIndexEventParticipantsForItem(payload, event).map(
        (participant) => ({
          ...participant,
          eventId,
        }),
      ),
    );
    expectedRefs.push(
      ...proofIndexEventRefsForItem(payload).map((ref) => ({
        ...ref,
        eventId,
      })),
    );
  }
  for (const row of Array.isArray(supplementalParticipantRows)
    ? supplementalParticipantRows
    : []) {
    const participant = canonicalParticipantRow(row);
    if (
      events.has(participant.eventId) &&
      participant.address &&
      participant.role
    ) {
      expectedParticipants.push(participant);
    }
  }
  const participants = relationParity(
    expectedParticipants,
    (Array.isArray(participantRows) ? participantRows : [])
      .map(observedParticipantRow),
    participantKey,
    "PARTICIPANTS",
  );
  const refs = relationParity(
    expectedRefs,
    (Array.isArray(refRows) ? refRows : []).map(observedRefRow),
    refKey,
    "REFS",
  );
  return {
    eventCount: events.size,
    model: PROOF_INDEX_EVENT_RELATION_PARITY_MODEL,
    participants,
    ready: participants.ready && refs.ready,
    refs,
    statusCounts: Object.fromEntries(
      [...statusCounts.entries()].sort(([left], [right]) =>
        compareText(left, right)
      ),
    ),
  };
}
