import { notificationAddressKey } from "./notification-query.mjs";

const TXID = /^[0-9a-f]{64}$/u;
const MAX_RECORDS = 100_000;
const ROOT_ACTIONS = new Set(["register", "update", "transfer", "buy", "list", "seal", "delist"]);

function incomplete(message) {
  return Object.assign(new Error(message), { statusCode: 503,
    details: { code: "NOTIFICATION_REGISTRY_HISTORY_INCOMPLETE" } });
}

function bounded(collections) {
  let count = 0;
  for (const collection of collections) {
    if (collection !== undefined && !Array.isArray(collection)) throw incomplete("Notification lifecycle history is not an array.");
    count += collection?.length ?? 0;
    if (count > MAX_RECORDS) throw incomplete("Notification lifecycle history exceeds its completeness bound.");
  }
}

function confirmed(event) {
  return event?.confirmed !== false && (event?.confirmed === true || event?.status === "accepted" ||
    Number.isSafeInteger(event?.blockHeight) && event.blockHeight > 0) &&
    event.valid !== false && event.protocolValid !== false &&
    !["pending", "mempool", "rejected", "invalid", "dropped", "orphaned"].includes(event.status);
}

function pending(event) {
  return event?.confirmed === false || event?.status === "pending";
}

function acceptedPending(event) {
  return pending(event) && event.valid !== false && event.protocolValid !== false &&
    !["rejected", "invalid", "dropped", "orphaned"].includes(event.status);
}

function rootAction(event) {
  const action = String(event?.kind ?? event?.action ?? "").replace(/^(?:id|dns)-/u, "");
  return action === "marketTransfer" ? "buy" : ROOT_ACTIONS.has(action) ? action : "";
}

function position(event) {
  const result = [event.blockHeight, event.blockIndex ?? event.txIndex, event.protocolVout, event.recordOrdinal];
  if (!TXID.test(event.txid ?? "") || result[0] < 1 || result.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw incomplete("Notification lifecycle history lacks an exact canonical position.");
  }
  return result;
}

function sortTimeline(timeline) {
  const positions = new Set(), transactionPositions = new Map(), positionTransactions = new Map();
  for (const item of timeline) {
    item.position = position(item.event);
    const transactionPosition = item.position.slice(0, 2).join(":");
    if ((transactionPositions.has(item.event.txid) && transactionPositions.get(item.event.txid) !== transactionPosition) ||
        (positionTransactions.has(transactionPosition) && positionTransactions.get(transactionPosition) !== item.event.txid)) {
      throw incomplete("Notification lifecycle history has an ambiguous canonical transaction position.");
    }
    transactionPositions.set(item.event.txid, transactionPosition);
    positionTransactions.set(transactionPosition, item.event.txid);
    const key = item.position.join(":");
    if (positions.has(key)) throw incomplete("Notification lifecycle history has an ambiguous canonical position.");
    positions.add(key);
  }
  return timeline.sort((left, right) => {
    for (let index = 0; index < 4; index += 1) {
      const difference = left.position[index] - right.position[index];
      if (difference) return difference;
    }
    return 0;
  });
}

function rootName(event) {
  return String(event.id ?? event.name ?? "").replace(/\.pow$/u, "");
}

function rootTimeline(events) {
  return (events ?? []).filter(event => confirmed(event) && rootAction(event)).map(event => ({ type: "root", event }));
}

function resultFor(address) {
  const identity = notificationAddressKey(address), txids = new Set(), references = new Map(), participants = new Map();
  return {
    match(event, ...people) {
      for (const [value, role] of people) {
        if (!identity || typeof value !== "string" || !value || notificationAddressKey(value) !== identity) continue;
        if (!TXID.test(event.txid ?? "") || [event.protocolVout, event.recordOrdinal].some(value => !Number.isSafeInteger(value) || value < 0)) {
          throw incomplete("Notification relationship lacks an exact carrier identity.");
        }
        txids.add(event.txid);
        const participant = { txid: event.txid, protocolVout: event.protocolVout, recordOrdinal: event.recordOrdinal,
          address: identity, role };
        participants.set(`${event.txid}:${event.protocolVout}:${event.recordOrdinal}:${identity}:${role}`, participant);
      }
    },
    reference(txid, sourceTxid) {
      if (TXID.test(txid ?? "") && TXID.test(sourceTxid ?? "")) references.set(`${txid}:${sourceTxid}`, { txid, sourceTxid });
    },
    value() { return { txids: [...txids], references: [...references.values()], participants: [...participants.values()] }; },
  };
}

// The caller supplies complete, accepted registry activity at the notification
// checkpoint. This projects relationships; it never accepts raw registry claims.
function applyRoot(event, roots, result) {
  const name = rootName(event), action = rootAction(event), previous = roots.get(name);
  if (!name || (action === "register" ? Boolean(previous) : !previous)) {
    throw incomplete("Notification registry history has an incomplete ownership lifecycle.");
  }
  matchRoot(event, previous, result);
  if (!["register", "update", "transfer", "buy"].includes(action)) return { name, action, previous, next: previous };
  const ownerAddress = action === "update" ? previous.ownerAddress : event.ownerAddress;
  const resolverAddress = event.receiveAddress ?? event.resolverAddress;
  if (!ownerAddress || !resolverAddress || (action === "update" && event.ownerAddress &&
      notificationAddressKey(event.ownerAddress) !== notificationAddressKey(ownerAddress))) {
    throw incomplete("Notification registry history lacks accepted owner or receiver evidence.");
  }
  const next = { ownerAddress, resolverAddress };
  roots.set(name, next);
  return { name, action, previous, next };
}

function matchRoot(event, previous, result) {
  result.match(event, [previous?.ownerAddress, "historical-owner"], [previous?.resolverAddress, "previous-receiver"],
    [event.ownerAddress, "owner"], [event.receiveAddress, "receiver"], [event.resolverAddress, "receiver"],
    [event.sellerAddress, "counterparty"], [event.buyerAddress, "buyer"], [event.saleAuthorization?.buyerAddress, "buyer"]);
}

export function notificationIdHistoryRelations(events, address) {
  bounded([events]);
  const roots = new Map(), result = resultFor(address);
  for (const { event } of sortTimeline(rootTimeline(events))) applyRoot(event, roots, result);
  // Each pending action is compared independently to confirmed state. It never
  // changes the receiver/owner used for another pending action.
  for (const event of events ?? []) {
    if (acceptedPending(event) && rootAction(event)) matchRoot(event, roots.get(rootName(event)), result);
  }
  return result.value();
}

function childAddress(child, root) {
  if (!child) return undefined;
  return child.resolverOverride === null ? root?.resolverAddress :
    child.resolverOverride ?? child.resolvedAddress ?? child.resolverAddress;
}

// All root/additive histories come from the same verified DNS replay. In
// particular, currentOwnerAddress and current .records are display state and
// are deliberately never consulted for historical relationships.
export function notificationDnsHistoryRelations(dns, address) {
  bounded([dns?.activity, dns?.subdomainEvents, dns?.pageLinkEvents, dns?.subdomainPageLinkEvents,
    dns?.pageLinks, dns?.pageLinkHistoricalRecords, dns?.subdomainPageLinks, dns?.subdomainPageLinkHistoricalRecords,
    dns?.subdomainHistoricalRecords, dns?.subdomainPendingEvents, dns?.pageLinkPendingEvents, dns?.subdomainPageLinkPendingEvents]);
  const timeline = rootTimeline(dns?.activity);
  for (const [type, events] of [["child", dns?.subdomainEvents], ["page", dns?.pageLinkEvents],
    ["child-page", dns?.subdomainPageLinkEvents]]) {
    for (const event of events ?? []) {
      if (event.valid === true && confirmed(event)) timeline.push({ type, event });
    }
  }
  const roots = new Map(), children = new Map(), result = resultFor(address);
  for (const { type, event } of sortTimeline(timeline)) {
    if (type === "root") {
      const { name, action, previous } = applyRoot(event, roots, result);
      if (previous && ["transfer", "buy"].includes(action)) {
        for (const [childName, child] of children) {
          if (child.parent !== name) continue;
          result.match(event, [child.ownerAddress, "historical-owner"], [childAddress(child, previous), "previous-receiver"]);
          children.delete(childName);
        }
      }
      continue;
    }
    const record = event.record, state = event.state;
    const parent = record?.parent ?? record?.name;
    const root = roots.get(parent);
    if (!record || !state || !root) throw incomplete("Notification DNS history lacks accepted lifecycle state.");
    if (type === "child") {
      const name = `${record.label}.${parent}.pow`, previous = children.get(name);
      if (record.action === "create" ? Boolean(previous) : !previous) {
        throw incomplete("Notification DNS history has an incomplete child lifecycle.");
      }
      result.match(event, [root.ownerAddress, "historical-owner"], [state.ownerAddress, "historical-owner"],
        [childAddress(state, root), "receiver"], [childAddress(previous, root), "previous-receiver"]);
      if (record.action === "revoke") children.delete(name);
      else children.set(name, { ...state, parent });
    } else {
      const child = type === "child-page" ? children.get(`${record.label}.${parent}.pow`) : null;
      if (type === "child-page" && !child) throw incomplete("Notification DNS page history lacks its child lifecycle.");
      result.match(event, [root.ownerAddress, "historical-owner"], [state.ownerAddress, "historical-owner"],
        [type === "child-page" ? childAddress(child, root) : root.resolverAddress, "receiver"]);
      result.reference(event.txid, state.pageTxid);
    }
  }
  // Replay records retain the old Page on replacement/clear and the exact
  // event which invalidated it. A clear has no pageTxid in its wire payload.
  for (const collection of [dns?.pageLinks, dns?.pageLinkHistoricalRecords,
    dns?.subdomainPageLinks, dns?.subdomainPageLinkHistoricalRecords]) {
    for (const record of collection ?? []) {
      for (const txid of [record.txid, record.clearedByTxid, record.replacedByTxid, record.invalidatedByTxid]) {
        result.reference(txid, record.pageTxid);
      }
    }
  }
  const activeLinks = [...(dns?.pageLinks ?? []), ...(dns?.subdomainPageLinks ?? [])];
  const rootLinks = new Map((dns?.pageLinks ?? []).map(link => [String(link.id ?? link.name).replace(/\.pow$/u, ""), link]));
  const childLinks = new Map((dns?.subdomainPageLinks ?? []).map(link => [link.name, link]));
  for (const event of dns?.activity ?? []) {
    if (!acceptedPending(event) || !rootAction(event)) continue;
    const name = rootName(event), root = roots.get(name);
    matchRoot(event, root, result);
    if (root && ["transfer", "buy"].includes(rootAction(event))) {
      for (const child of children.values()) {
        if (child.parent === name) result.match(event, [childAddress(child, root), "previous-receiver"]);
      }
      for (const link of activeLinks) {
        if ((link.parent ?? String(link.id ?? link.name).replace(/\.pow$/u, "")) === name) result.reference(event.txid, link.pageTxid);
      }
    }
  }
  for (const [type, events] of [["child", dns?.subdomainPendingEvents], ["page", dns?.pageLinkPendingEvents],
    ["child-page", dns?.subdomainPageLinkPendingEvents]]) {
    for (const event of events ?? []) {
      if (event.valid !== true || !acceptedPending(event)) continue;
      const record = event.record, parent = record?.parent ?? record?.name, root = roots.get(parent);
      if (!record || !root) throw incomplete("Pending notification DNS history lacks confirmed root state.");
      const name = `${record.label}.${parent}.pow`, child = children.get(name);
      if (type === "child") {
        if (record.action !== "create" && !child) throw incomplete("Pending notification DNS history lacks confirmed child state.");
        result.match(event, [root.ownerAddress, "historical-owner"], [childAddress(child, root), "previous-receiver"],
          [record.action === "revoke" ? undefined : record.resolver ?? root.resolverAddress, "receiver"]);
        if (record.action === "revoke") result.reference(event.txid, childLinks.get(name)?.pageTxid);
      } else {
        if (type === "child-page" && !child) throw incomplete("Pending notification Page history lacks confirmed child state.");
        result.match(event, [root.ownerAddress, "historical-owner"],
          [type === "child-page" ? childAddress(child, root) : root.resolverAddress, "receiver"]);
        result.reference(event.txid, record.pageTxid);
        result.reference(event.txid, (type === "child-page" ? childLinks.get(name) : rootLinks.get(parent))?.pageTxid);
      }
    }
  }
  return result.value();
}
