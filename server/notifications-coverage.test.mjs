import test from "node:test";
import assert from "node:assert/strict";
import { notificationAction, notificationPayload } from "./notifications.mjs";
import { notificationAddressKey } from "./notification-query.mjs";
import { encodeJobRecord, JOBS_ACTIONS } from "../src/shared/protocol/jobs.mjs";
import { encodePermissionRecord } from "../src/shared/protocol/permissions.mjs";
import { notificationDnsRelation } from "./notification-dns-relations.mjs";
import { buildDnsPageLinkPayload } from "../src/shared/protocol/dnsPages.mjs";
import { buildDnsSubdomainPageLinkPayload } from "../src/shared/protocol/dnsSubdomainPages.mjs";
import { buildDnsSubdomainPayload } from "../src/shared/protocol/dnsSubdomains.mjs";
import { qualifyNotificationIds } from "./notification-id-authority.mjs";

// Public addresses are fixture identities only. These tests never sign, submit,
// connect to a wallet, query a node, or mutate the canonical event store.
const AUTHOR = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const OWNER = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
const RECEIVER = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const THIRD = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
const tx = digit => String(digit).repeat(64);
const event = (fields = {}) => ({
  network: "livenet", txid: tx("a"), protocol: "pwm1", kind: "mail",
  confirmed: true, confirmationStatus: "confirmed", status: "confirmed", valid: true,
  actor: AUTHOR, senderAddress: AUTHOR, recipientAddress: RECEIVER,
  protocolVout: 1, recordOrdinal: 0, blockHeight: 972100, blockIndex: 2,
  blockHash: tx("f"), eventId: 100, createdAt: "2026-10-23T12:00:00.000Z",
  ...fields,
});
const history = items => ({
  network: "livenet", items, complete: true, snapshotId: "fixture-snapshot",
  indexedThroughBlock: 972101, indexedThroughBlockHash: tx("f"),
  nextCursor: null, hasMore: false, totalCount: new Set(items.map(item => item.txid)).size,
});

test("verified legacy ID listing and purchase aliases form one accepted action with all decoder evidence", () => {
  const checkpoint = { network:"livenet",indexedThroughBlock:972800,indexedThroughBlockHash:"00000000000000000001300f04152e318b70e9cbc881b3b42bc293733de4bc55" };
  const fixtures = [
    {txid:"eebab2afddef444b0c4345bddde4a771f833e0c1f6bffa0009369576eadfb71c",eventId:4055480,kind:"id-list",decodedKind:"id-list3-invalid",blockHeight:948961,blockHash:"000000000000000000012683119768a2c4fe8a00c34cb96d0d128dfa5742f9d8",blockIndex:1688,protocolVout:1},
    {txid:"da77c38e8df8dd8242464ff384394882d57471a19961655da4cda240286007b1",eventId:4055469,kind:"id-buy",decodedKind:"id-buy2-invalid",blockHeight:948935,blockHash:"00000000000000000001a61ec5b39a9db0d7d928b71f3af43b90acafba517fd5",blockIndex:1763,protocolVout:2},
    {txid:"11b9ee32b7b9ff43da09706ff3f520cda8d3cb8848a7d8dfcf1b6daa89fcacf1",eventId:4055464,kind:"id-list",decodedKind:"id-list2-invalid",blockHeight:948926,blockHash:"0000000000000000000124ed23fd73f5d83eb7c56e1a77e805c5c170a0ffc76c",blockIndex:2072,protocolVout:1},
  ];
  for (const fixture of fixtures) {
    const canonical=event({...fixture,protocol:"pwid1",id:"testdummy",applied:true});
    const decoded=event({...fixture,protocol:"pwid1",id:"testdummy",eventId:fixture.eventId-1,
      kind:fixture.decodedKind,valid:false,protocolValid:false,applied:false,reason:"Legacy decoder rejected this carrier."});
    const registry={...checkpoint,activity:[canonical]};
    const qualified=qualifyNotificationIds([decoded,canonical],registry,checkpoint);
    assert.equal(notificationAction(qualifyNotificationIds([decoded],registry,checkpoint)[0],AUTHOR).status,"confirmed",
      "Accepted exact-carrier authority supersedes a legacy decoder's applied:false flag even without a duplicate canonical row.");
    const result=notificationPayload({...history(qualified),...checkpoint},AUTHOR);
    assert.equal(result.items.length,1);
    assert.equal(result.items[0].status,"confirmed",fixture.decodedKind);
    assert.equal(result.items[0].kind,fixture.kind);
    assert.equal(result.items[0].actions.length,1,"One canonical carrier must not produce duplicated logical actions.");
    const action=result.items[0].actions[0];
    assert.equal(String(action.evidence.sourceEventId),String(fixture.eventId));
    assert.deepEqual(action.evidence.sourceEventIds.map(String).sort(),[String(fixture.eventId-1),String(fixture.eventId)].sort());
    assert.ok(action.evidence.decodedEvents.some(source=>source.kind===fixture.decodedKind && source.valid===false));
    assert.equal(result.items[0].maxEventId,fixture.eventId);
    const wrongCarrier={...decoded,eventId:fixture.eventId+1,protocolVout:fixture.protocolVout+1};
    const unrelated={...decoded,eventId:fixture.eventId+2,txid:tx("d")};
    const rejected=qualifyNotificationIds([wrongCarrier,unrelated],registry,checkpoint).map(item=>notificationAction(item,AUTHOR));
    assert.ok(rejected.every(action=>action.status==="invalid" && !action.evidence.qualification),"Different carriers and unrelated failed attempts retain their rejection.");
    const wrongBlock={...decoded,blockHash:tx("e")};
    assert.equal(notificationAction(qualifyNotificationIds([wrongBlock],registry,checkpoint)[0],AUTHOR).status,"invalid");
    assert.throws(()=>qualifyNotificationIds([decoded],{...registry,activity:[{...canonical,network:undefined}]},checkpoint),error=>error.statusCode===503);
  }
});

test("decoded carrier validity cannot override an application rejection", () => {
  const rejected = notificationAction(event({ protocol: "pwb1", kind: "boost-transfer", protocolValid: true,
    boostAuthority: { ready: true, valid: false, reason: "boost-registry-payment-missing" } }), AUTHOR);
  assert.equal(rejected.status, "invalid");
  assert.equal(rejected.evidence.valid, false);
  const invalidCarrier = notificationAction(event({ protocol: "pwb1", kind: "boost-post", protocolValid: false,
    boostAuthority: { ready: true, valid: true } }), AUTHOR);
  assert.equal(invalidCarrier.status, "invalid");
  const additiveDns = notificationAction(event({ protocol: "pwdns1", kind: "dns-page-link-set", valid: false,
    protocolValid: true, dnsPageLinkAuthority: "verified-replay" }), AUTHOR);
  assert.equal(additiveDns.status, "confirmed", "Verified additive DNS replay qualifies a legacy raw carrier.");
});

test("every existing transaction action family has its product destination", () => {
  const families = [
    ["pwid1", "IDs", ["id-register", "id-update", "id-transfer", "id-list", "id-seal", "id-delist", "id-buy"]],
    ["pwdns1", "DNS", ["dns-register", "dns-update", "dns-transfer", "dns-list", "dns-seal", "dns-delist", "dns-buy",
      "dns-subdomain-create", "dns-subdomain-update", "dns-subdomain-revoke", "dns-page-link-set", "dns-page-link-clear",
      "dns-subdomain-page-link-set", "dns-subdomain-page-link-clear"]],
    ["pwb1", "Boost", ["boost-profile", "boost-post", "boost-reply", "boost-like", "boost-reboost", "boost-tip",
      "boost-follow", "boost-unfollow", "boost-hide", "boost-transfer", "boost-list", "boost-seal", "boost-delist", "boost-buy"]],
    ["pwt1", "Wallet", ["token-create", "token-mint", "token-transfer", "token-listing", "token-listing-sealed", "token-listing-closed", "token-sale"]],
    ["pwc1", "Code", ["code-repository", "code-commit"]],
    ["pwm1", "Mail", ["mail", "reply"]],
    ["pwm1", "Files", ["file", "attachment"]],
  ];
  for (const [protocol, app, kinds] of families) {
    for (const kind of kinds) {
      const result = notificationAction(event({ protocol, kind, codeAuthority: { ready: true, valid: true, applied: true } }), AUTHOR);
      assert.equal(result.app, app, kind);
      assert.equal(result.kind, kind, "Notification metadata preserves the exact source kind.");
      assert.equal(result.direction, "outgoing", kind);
      assert.equal(result.status, "confirmed", kind);
      assert.ok(result.target.workspace && result.target.txid, `${kind} retains an inspectable destination`);
    }
  }
  for (const [kind, app] of [["infinity-bond", "Infinity"], ["inception-bond", "Inception"]]) {
    assert.equal(notificationAction(event({ kind }), RECEIVER).app, app, "The canonical bond kind works without optional display text.");
  }
});

test("sale-ticket and repository notifications retain action-specific language", () => {
  for (const [kind, word] of [["boost-list", /listing/iu], ["boost-seal", /seal/iu], ["boost-delist", /delist/iu], ["boost-buy", /purchase/iu], ["code-repository", /repository/iu]]) {
    const result = notificationAction(event({ kind, protocol: kind.startsWith("code") ? "pwc1" : "pwb1" }), AUTHOR);
    assert.match(result.label, word, kind);
  }
});

test("all Mail recipients and self-sends get the correct direction", () => {
  const item = event({ recipients: [{ address: RECEIVER, amountSats: 546 }, { address: OWNER, amountSats: 1000 }, { address: AUTHOR, amountSats: 546 }] });
  assert.equal(notificationAction(item, RECEIVER).direction, "incoming");
  assert.equal(notificationAction(item, OWNER).direction, "incoming");
  assert.equal(notificationAction(item, AUTHOR).direction, "self");
  assert.deepEqual(new Set(notificationAction(item, OWNER).recipientAddresses), new Set([RECEIVER, OWNER, AUTHOR]));
});

test("new asset owner and distinct mail receiver each see an incoming ID or DNS transfer", () => {
  for (const protocol of ["pwid1", "pwdns1"]) {
    const item = event({ protocol, kind: protocol === "pwid1" ? "id-transfer" : "dns-transfer", ownerAddress: OWNER, receiveAddress: RECEIVER });
    assert.equal(notificationAction(item, OWNER).direction, "incoming", "Owner authority is distinct from receiver routing.");
    assert.equal(notificationAction(item, RECEIVER).direction, "incoming");
    assert.equal(notificationAction(item, AUTHOR).direction, "outgoing");
  }
});

test("Base58 identity is exact while Bech32 spellings share display identity", () => {
  assert.notEqual(notificationAddressKey(AUTHOR), notificationAddressKey(AUTHOR.toLowerCase()));
  assert.equal(notificationAddressKey(RECEIVER), notificationAddressKey(RECEIVER.toUpperCase()));
  assert.equal(notificationAction(event(), AUTHOR.toLowerCase()).direction, "related", "A different Base58 spelling is not the sender.");
  assert.equal(notificationAction(event(), RECEIVER.toUpperCase()).direction, "incoming");
});

test("decoded body schemas alone never establish a confirmed Jobs payment or Permission grant", () => {
  const jobBody = encodeJobRecord("accept", { v: 2, job: tx("b"), delivery: tx("c") });
  const result = notificationAction(event({ memo: jobBody }), RECEIVER);
  assert.equal(result.app, "Jobs");
  assert.equal(result.status, "unavailable");
  assert.equal(result.target.txid, tx("b"));
  const malformed = notificationAction(event({ memo: "pwperm1:grant:invalid" }), AUTHOR);
  assert.equal(malformed.app, "Permission");
  assert.notEqual(malformed.status, "confirmed");
  const rejected = notificationAction(event({ memo: jobBody, jobs: { ready: true, valid: false, applied: false, reason: "wrong-worker-payment" } }), RECEIVER);
  assert.equal(rejected.status, "invalid");
  assert.equal(rejected.evidence.reason, "wrong-worker-payment");
});

test("all six Jobs actions keep fixed job references, including a self-paid cancellation", () => {
  const metadata = {
    brief: { v: 1, title: "Repair the app", scope: "Verify and repair", rewardSats: "1000" },
    propose: { v: 1, job: tx("b"), scope: "The agreed work", rewardSats: "1000" },
    assign: { v: 1, job: tx("b"), proposal: tx("c") },
    deliver: { v: 1, job: tx("b"), assignment: tx("d"), text: "Delivered", artifacts: [tx("e")] },
    accept: { v: 1, job: tx("b"), delivery: tx("e") },
    cancel: { v: 1, job: tx("b"), reason: "Cancelled before payment" },
  };
  assert.deepEqual(Object.keys(metadata), [...JOBS_ACTIONS]);
  for (const action of JOBS_ACTIONS) {
    const item = event({ memo: encodeJobRecord(action, metadata[action]), jobs: { ready: true, valid: true, applied: true } });
    const result = notificationAction(item, AUTHOR);
    assert.equal(result.app, "Jobs", action);
    assert.equal(result.target.txid, action === "brief" ? item.txid : tx("b"));
    assert.equal(result.status, "confirmed", action);
  }
  const cancellation = event({ memo: encodeJobRecord("cancel", metadata.cancel), recipientAddress: AUTHOR,
    jobs: { ready: true, valid: true, applied: true }, notificationRefs: [{ refType: "job-txid", refValue: tx("b") }] });
  const related = notificationAction(cancellation, OWNER);
  assert.equal(related.direction, "related", "An indirectly selected worker is not falsely presented as a payment recipient.");
  assert.ok(related.relatedTxids.includes(tx("b")));
});

test("Permission label and allowed recipient policy do not claim delivery to those addresses", () => {
  const policy = { signingEnabled: true, allowedActions: ["mail.send"], maxTransactionProofs: "5000", dailyLimitProofs: "30000",
    minerFeeRateProofsPerVbyte: "0.5", allowedRecipients: [OWNER], workLimits: null };
  for (const action of ["grant", "replace", "revoke"]) {
    const metadata = { v: 2, network: "livenet", ...(action === "grant" ? {} : { grant: tx("b"), parent: tx("c") }),
      ...(action === "revoke" ? {} : { label: `${OWNER}@proofofwork.me`, policy }) };
    const item = event({ memo: encodePermissionRecord(action, metadata), recipientAddress: AUTHOR,
      permission: { ready: true, valid: true, applied: true } });
    const result = notificationAction(item, OWNER);
    assert.equal(result.app, "Permission");
    assert.equal(result.direction, "related");
    assert.ok(!result.recipientAddresses.includes(OWNER));
    assert.equal(result.target.txid, action === "grant" ? item.txid : tx("b"));
  }
});

test("a compound article, Mail, file and WORK transaction creates one inbox item with all evidence", () => {
  const items = [
    event({ memo: "Article body", kind: "mail" }),
    event({ protocol: "pwb1", kind: "boost-post", article: { title: "Published title" }, protocolVout: 3, eventId: 101 }),
    event({ kind: "attachment", protocolVout: 4, eventId: 102 }),
    event({ protocol: "pwt1", kind: "token-transfer", protocolVout: 5, eventId: 103,
      amountSubatoms: "210000000000000000000000", tokenId: tx("b") }),
  ];
  const result = notificationPayload(history(items), RECEIVER);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].actions.length, 4);
  assert.equal(result.items[0].app, "Publish");
  const work = result.items[0].actions.find(action => action.kind === "token-transfer");
  assert.equal(work.evidence.amounts.amountSubatoms, "210000000000000000000000");
  assert.equal(result.items[0].id, `livenet:${items[0].txid}`);
});

test("pending, confirmed, reorganized and reindexed versions keep one read-state identity", () => {
  const baseline = event();
  const versions = [
    { confirmed: false, status: "pending", confirmationStatus: "pending", eventId: 12, blockHeight: null, blockHash: null },
    { eventId: 500 },
    { status: "orphaned", confirmationStatus: "orphaned", confirmed: false, eventId: 501 },
    { eventId: 999, blockHeight: 972105, blockHash: tx("e"), blockIndex: 17 },
  ].map(patch => notificationPayload(history([{ ...baseline, ...patch }]), RECEIVER).items[0]);
  assert.equal(new Set(versions.map(item => item.id)).size, 1);
  assert.equal(new Set(versions.map(item => item.actions[0].id)).size, 1);
  assert.deepEqual(versions.map(item => item.status), ["pending", "confirmed", "orphaned", "confirmed"]);
});

test("indirect content references retain source identity without attributing a new payment", () => {
  const item = event({ protocol: "pwc1", kind: "code-commit", repoTxid: tx("c"), recipientAddress: AUTHOR,
    metadata: { v: 2, op: "reference", repo: tx("c"), sourceTxid: tx("b") },
    codeAuthority: { ready: true, valid: true, applied: true },
    notificationRefs: [{ refType: "source-txid", refValue: tx("b") }] });
  const result = notificationAction(item, OWNER);
  assert.equal(result.direction, "related");
  assert.deepEqual(result.relatedTxids, [tx("c"), tx("b")]);
  assert.equal(result.target.txid, tx("c"));
  assert.equal(result.target.version, item.txid);
  assert.ok(!result.recipientAddresses.includes(OWNER));
});

test("an explicitly incomplete history cannot become complete notification coverage", () => {
  let result;
  try { result = notificationPayload({ ...history([event()]), complete: false }, RECEIVER); }
  catch (error) { assert.equal(error.statusCode, 503); return; }
  assert.equal(result.coverage.complete, false);
});

test("rejected and dropped actions keep the exact chain-status evidence", () => {
  const invalid = notificationAction(event({ protocol: "pwt1", kind: "token-event-invalid", valid: false, reason: "insufficient-balance" }), AUTHOR);
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.evidence.chainStatus, "confirmed");
  assert.equal(invalid.evidence.valid, false);
  const dropped = notificationAction(event({ status: "dropped", confirmationStatus: "dropped", confirmed: false }), AUTHOR);
  assert.equal(dropped.status, "dropped");
  assert.equal(dropped.evidence.chainStatus, "dropped");
});

test("untyped relations stay related and free text never creates sender or recipient identity", () => {
  const item = event({ memo: `Hello ${OWNER} and @somebody`, authorId: "somebody", currentOwnerId: "somebody",
    notificationParticipants: [{ address: THIRD, role: "participant" }] });
  assert.equal(notificationAction(item, OWNER).direction, "related");
  assert.equal(notificationAction(item, THIRD).direction, "related");
});

test("current-owner display enrichment cannot invent historical recipients or incoming direction", () => {
  for (const [protocol, kind] of [["pwid1", "id-update"], ["pwdns1", "dns-page-link-set"], ["pwb1", "boost-post"]]) {
    const item = event({ protocol, kind, currentOwnerAddress: OWNER, currentOwnerId: "later-owner",
      participants: [AUTHOR, OWNER], notificationParticipants: [{ address: OWNER, role: "owner" }, { address: OWNER, role: "participant" }] });
    const historicalActor = notificationAction(item, AUTHOR), currentOwner = notificationAction(item, OWNER);
    assert.equal(historicalActor.direction, "outgoing", kind);
    assert.equal(currentOwner.direction, "related", "A current display owner has no historical recipient authority.");
    assert.ok(!historicalActor.recipientAddresses.includes(OWNER), `${kind}: display owner must not appear in To`);
    assert.ok(!currentOwner.recipientAddresses.includes(OWNER));
    const explicit = notificationAction({ ...item, ownerAddress: OWNER }, OWNER);
    assert.equal(explicit.direction, "incoming", `${kind}: explicit event owner evidence remains authoritative`);
    assert.ok(explicit.recipientAddresses.includes(OWNER));
    const verified = notificationAction({ ...item, notificationParticipants: [{ address: OWNER, role: "owner",
      txid: item.txid, protocolVout: item.protocolVout, recordOrdinal: item.recordOrdinal }] }, OWNER);
    assert.equal(verified.direction, "incoming", "Verified lifecycle participants retain their exact carrier attribution.");
  }
});

test("raw additive DNS carriers retain exact Page references before application qualification", () => {
  const epoch = { txid: tx("b"), protocolVout: 2, recordOrdinal: 0 };
  const child = { txid: tx("c"), protocolVout: 3, recordOrdinal: 0 };
  for (const payload of [
    buildDnsPageLinkPayload({ action: "set", name: "alice", epoch, pageTxid: tx("d") }),
    buildDnsSubdomainPageLinkPayload({ action: "set", parent: "alice", label: "app", epoch, child, pageTxid: tx("d") }),
  ]) {
    const relation = notificationDnsRelation({ txid: tx("a"), payload: { payload }, status: "confirmed", block_height: 972100,
      block_index: 2, op_return_vout: 4, record_ordinal: 0 }, address => [AUTHOR, OWNER, RECEIVER].includes(address));
    assert.equal(relation.pageTxid, tx("d"));
    assert.equal(relation.txid, tx("a"));
    assert.equal(relation.record.epoch.txid, tx("b"));
    assert.equal(relation.blockHeight, 972100);
    assert.equal(relation.protocolVout, 4);
    assert.equal(relation.valid, undefined, "Decoding a reference does not claim accepted DNS state.");
  }
  const malformed = notificationDnsRelation({ txid: tx("a"), payload: { payload: "pwdns1:page1:not-valid-base64" } });
  assert.equal(malformed.pageTxid, "");
  assert.equal(malformed.record, null);
});

test("explicit child resolver remains a recipient reference with case-sensitive identity", () => {
  const validateAddress = address => [AUTHOR, OWNER, RECEIVER].includes(address);
  const payload = buildDnsSubdomainPayload({ action: "create", parent: "alice", label: "mail",
    epoch: { txid: tx("b"), protocolVout: 1, recordOrdinal: 0 }, resolver: OWNER }, { validateAddress });
  const relation = notificationDnsRelation({ txid: tx("a"), payload: { payload }, status: "pending" }, validateAddress);
  assert.equal(relation.resolver, OWNER);
  assert.notEqual(relation.resolver, OWNER.toLowerCase());
  assert.equal(relation.record.action, "create");
});
