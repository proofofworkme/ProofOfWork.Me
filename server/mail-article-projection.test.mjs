import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import * as articleProtocol from "../src/shared/protocol/publishArticle.mjs";
import { canonicalProtocolCandidateFromOutput } from "./canonical-op-return.mjs";
import { parseWorkAmoV5PwmMessages } from "./work-amo-v5.mjs";
import { compareCanonicalUtf8 } from "./canonical-order.mjs";
import { verifiedMailArticleFields, revalidateMailArticleMessage } from "./db/proof-index-reader.mjs";

// Execute the production Mail assembly functions without starting HTTP or a DB.
// Only unrelated WORK, time and normalization dependencies are isolated.
function functionsAt(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return { source, parsed, functions: new Map(parsed.statements.filter(ts.isFunctionDeclaration)
    .map(node => [node.name.text, node.getText(parsed).replace(/^export\s+/u, "")])) };
}
const api = functionsAt("./proof-api.mjs");
const reader = functionsAt("./db/proof-index-reader.mjs");
function isolated(source, names, globals = {}) {
  const context = vm.createContext({ Buffer, createHash, compareCanonicalUtf8,
    ...articleProtocol, canonicalProtocolCandidateFromOutput, verifiedMailArticleFields,
    revalidateMailArticleMessage, ...globals });
  vm.runInContext(names.map(name => {
    assert.ok(source.functions.has(name), `Missing production function ${name}`);
    return source.functions.get(name);
  }).join("\n"), context);
  return context;
}
const clean = value => JSON.parse(JSON.stringify(value));
const TXID = "a".repeat(64);
const ADDRESS = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const BODY = "  First paragraph with café and 東京.\r\n\n\tSecond paragraph.  \n";
const hash = body => createHash("sha256").update(body).digest("hex");
const metadata = body => ({ v: 1, title: "A title distinct from the first line",
  source: "same-tx-pwm1-message", size: Buffer.byteLength(body), sha256: hash(body) });
const post = article => `pwb1:post:${Buffer.from(JSON.stringify({ v: 1,
  text: article.title, article, proofSignalSats: 546 })).toString("base64url")}`;
function output(text) {
  return { value: 0, scriptpubkey_type: "op_return",
    scriptpubkey: Buffer.from(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(text)])).toString("hex"),
    scriptpubkey_asm: "OP_RETURN " + Buffer.from(text).toString("hex") };
}
function transaction(body = BODY, { confirmed = true, article = metadata(body), extra = [] } = {}) {
  return { txid: TXID, status: { confirmed, block_height: 969778,
    block_hash: "b".repeat(64), block_time: 1791070000 },
    vin: [{ prevout: { scriptpubkey_address: ADDRESS } }],
    vout: [{ value: 546, scriptpubkey_address: ADDRESS, scriptpubkey: "51" },
      output(post(article)), output(`pwm1:m:${body.slice(0, 20)}`),
      output(`pwm1:m:${body.slice(20)}`), ...extra] };
}
function companion(body = BODY, changes = {}) {
  return { txid: TXID, kind: "boost-post", valid: true, confirmed: true,
    article: metadata(body), text: metadata(body).title,
    articleVerification: articleProtocol.PUBLISH_ARTICLE_VERIFICATION, ...changes };
}
function rawRuntime() {
  return isolated(api, ["decodeHex", "decodedOpReturnMessages", "decodedOpReturnMessageEntries",
    "decodedProtocolMessages", "firstProtocolOutputIndex", "receivedPaymentAmount",
    "protocolPaymentOutputs", "inputAddresses", "senderAddress", "transactionTxid",
    "transactionConfirmed", "rawMailArticleCommitment", "extractProtocolMemo",
    "inboxMessagesFromTransactions", "sentMessagesFromTransactions", "mailMessageRichness",
    "mergeMailMessageLists", "subjectOnlyMailBody",
    "mailMessageHasRealBody", "mergeRepairedMailMessage"], {
    PROTOCOL_PREFIX: "pwm1:", MAX_ATTACHMENT_BYTES: 200000,
    parseWorkAmoV5PwmMessages, canonicalEventIdentityDetails: () => ({}),
    attachedWorkCreditsFromVout: () => [], tokenTransactionTime: () => 1791070000000,
  });
}
function readerRuntime(rows) {
  const queries = [];
  const context = isolated(reader, ["normalizedAddress", "knownMailAddress", "normalizedAddressKey",
    "stringList", "objectRecord", "positiveNumber", "dateIso", "recipientAddressRecords",
    "mailParticipantRecordsFromRow", "mailRecipientRowsFromSource", "recipientRows",
    "exactMailRecipientRows", "recipientSummary", "mailSubjectFromEvent", "subjectOnlyMailBody",
    "mailMemoFromEvent", "addressMailRowPayloads", "mailMessageProjectionRank",
    "mergeMailProjectionMessage", "compareMailMessages", "dedupeMailProjectionMessages",
    "proofIndexAddressMailPayload"], {
    normalizeEventPayload: value => value, canonicalEventPayload: value => value,
    canonicalMailAttachedCreditsFromRow: () => [], historicalDroppedMailOutboxWitnessesForAddress: () => [],
    bondTagForKind: () => null,
    WORK_AMO_V5_ACTIVATION_HEIGHT: 0, WORK_TOKEN_ID: "c".repeat(64),
    proofIndexPool: () => ({ query: async (sql, params) => { queries.push({ sql, params }); return { rows }; } }),
  });
  const declaration = reader.parsed.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(node => node.name.getText(reader.parsed) === "ADDRESS_MAIL_EVENT_KINDS");
  vm.runInContext("const ADDRESS_MAIL_EVENT_KINDS = " + declaration.initializer.getText(reader.parsed), context);
  return { context, queries };
}
function mailRow(changes = {}) {
  return { txid: TXID, kind: "mail", status: "confirmed", body_text: BODY,
    sender_address: ADDRESS, amount_sats: 546, event_time: "2026-10-03T23:48:00Z",
    payload: { memo: BODY, senderAddress: ADDRESS,
      recipients: [{ address: ADDRESS, amountSats: 546, display: ADDRESS, vout: 0 }] },
    participants: [{ address: ADDRESS, role: "sender" }, { address: ADDRESS, role: "recipient" }],
    canonical_boost_posts: [companion()], ...changes };
}

test("compact article fields require the exact confirmed txid, title and body commitment", () => {
  const message = { txid: TXID, memo: BODY, confirmed: true };
  assert.deepEqual(verifiedMailArticleFields(message, companion()), {
    socialMode: true, article: metadata(BODY), articleVerification: articleProtocol.PUBLISH_ARTICLE_VERIFICATION,
  });
  for (const change of [{ txid: "d".repeat(64) }, { kind: "boost-reply" }, { confirmed: false },
    { valid: false }, { text: "Other title" }, { articleVerification: undefined },
    { article: { ...metadata(BODY), size: 1 } }, { article: { ...metadata(BODY), sha256: "f".repeat(64) } }]) {
    assert.deepEqual(verifiedMailArticleFields(message, companion(BODY, change)), {});
  }
  for (const change of [{ confirmed: false }, { memo: BODY.trim() }, { attachment: { name: "file" } }]) {
    assert.deepEqual(verifiedMailArticleFields({ ...message, ...change }, companion()), {});
  }
});

test("indexed Mail retains exact body and the same self-send independently in Inbox and Sent", async () => {
  const { context, queries } = readerRuntime([mailRow()]);
  const result = clean(await context.proofIndexAddressMailPayload("livenet", ADDRESS));
  assert.equal(result.inboxMessages.length, 1); assert.equal(result.sentMessages.length, 1);
  for (const message of [...result.inboxMessages, ...result.sentMessages]) {
    assert.equal(message.txid, TXID); assert.equal(message.memo, BODY);
    assert.equal(message.amountSats, 546); assert.deepEqual(message.article, metadata(BODY));
    assert.equal(message.articleBody, undefined);
  }
  assert.equal(result.stats.inbox, 1); assert.equal(result.stats.sent, 1);
  assert.deepEqual(clean(queries[0].params[2]), ["mail", "reply", "file", "attachment", "browser", "inception-bond", "infinity-bond"]);
  const sql = queries[0].sql;
  for (const guard of ["transaction_record.status = 'confirmed'", "canonical_block.canonical = true",
    "transaction_record.block_height = post.block_height", "transaction_record.block_index = post.block_index",
    "canonical_block.block_hash = transaction_record.block_hash", "post.protocol = 'pwb1'", "post.valid = true",
    "post.status = 'confirmed'", "canonical_boost_posts.block_height = e.block_height",
    "canonical_boost_posts.block_index = e.block_index"]) assert.ok(sql.includes(guard), guard);
});

test("indexed Mail omits article claims for ambiguous roots, pending state or changed carrier bytes", () => {
  const { context } = readerRuntime([]);
  for (const change of [{ canonical_boost_posts: [companion(), companion()] },
    { canonical_boost_posts: [] }, { status: "pending" },
    { payload: { ...mailRow().payload, memo: BODY.trim() } },
    { canonical_boost_posts: [companion(BODY, { txid: "d".repeat(64) })] }]) {
    const projected = clean(context.addressMailRowPayloads(mailRow(change), ADDRESS, "livenet"));
    assert.equal(projected.length, 2);
    assert.ok(projected.every(item => !item.message.article && !item.message.articleVerification));
  }
});

test("raw Mail verifies complete same-tx article bytes and matches indexed self-send metadata", () => {
  const context = rawRuntime();
  const inbox = clean(context.inboxMessagesFromTransactions([transaction()], ADDRESS, "livenet"));
  const sent = clean(context.sentMessagesFromTransactions([transaction()], ADDRESS, "livenet"));
  const { context: indexed } = readerRuntime([]);
  const rows = clean(indexed.addressMailRowPayloads(mailRow(), ADDRESS, "livenet"));
  assert.equal(inbox.length, 1); assert.equal(sent.length, 1);
  for (const message of [...inbox, ...sent]) {
    assert.equal(message.memo, BODY); assert.equal(message.amountSats, 546);
    assert.deepEqual(message.article, rows[0].message.article);
    assert.equal(message.articleVerification, rows[0].message.articleVerification);
  }
});

test("raw Mail refuses pending, duplicate, incomplete, attachment, invalid UTF-8 and over-budget article evidence", () => {
  const context = rawRuntime();
  const invalidUtf8 = transaction();
  invalidUtf8.vout[2] = { ...output("pwm1:m:"), scriptpubkey: "6a0870776d313a6d3aff",
    scriptpubkey_asm: "OP_RETURN 70776d313a6d3aff" };
  const incomplete = transaction(); incomplete.vout.splice(3, 1);
  const huge = "x".repeat(100000);
  for (const tx of [transaction(BODY, { confirmed: false }),
    transaction(BODY, { extra: [output(post(metadata(BODY)))] }), incomplete,
    transaction(BODY, { extra: [output("pwm1:a:invalid-file")] }), invalidUtf8, transaction(huge)]) {
    const result = clean(context.inboxMessagesFromTransactions([tx], ADDRESS, "livenet"));
    assert.ok(result.every(message => !message.article && !message.articleVerification));
  }
});

test("overlay and body repair retain only article metadata matching the final exact body", () => {
  const context = rawRuntime();
  const articleMail = clean(context.inboxMessagesFromTransactions([transaction()], ADDRESS, "livenet"))[0];
  const plain = { ...articleMail }; delete plain.article; delete plain.articleVerification; delete plain.socialMode;
  assert.deepEqual(clean(context.mergeMailMessageLists([articleMail], [plain]))[0].article, metadata(BODY));
  assert.deepEqual(clean(context.mergeRepairedMailMessage({ ...plain, memo: "" }, articleMail)).article, metadata(BODY));
  const changed = clean(context.mergeRepairedMailMessage(articleMail, { ...plain, memo: BODY.trim() }));
  assert.equal(changed.memo, BODY.trim()); assert.equal(changed.article, undefined);
  const overlay = clean(context.mergeMailMessageLists([articleMail], [{ ...plain, memo: "Changed carrier" }]))[0];
  assert.equal(overlay.article, undefined); assert.equal(overlay.articleVerification, undefined);
  const { context: indexed } = readerRuntime([]);
  const deduped = clean(indexed.dedupeMailProjectionMessages([articleMail, { ...plain, memo: "Changed carrier" }]));
  assert.equal(deduped.length, 1); assert.equal(deduped[0].article, undefined);
});

test("canonical display normalization does not change a valid article title or raw body", () => {
  const article = { ...metadata(BODY), title: "  Exact title  " };
  const source = companion(BODY, { article, text: article.title.trim() });
  const fields = verifiedMailArticleFields({ txid: TXID, memo: BODY, confirmed: true }, source);
  assert.equal(fields.article.title, article.title);
  const context = rawRuntime();
  const messages = clean(context.inboxMessagesFromTransactions([transaction(BODY, { article })], ADDRESS, "livenet"));
  assert.equal(messages[0].article.title, article.title); assert.equal(messages[0].memo, BODY);
});

test("ordinary Mail and legacy Boost self-sends retain their original projection behavior", () => {
  const context = rawRuntime();
  const tx = transaction("Ordinary body");
  tx.vout.splice(1, 1);
  const legacy = { ...tx, vout: [tx.vout[0], output(`pwb1:post:${Buffer.from(JSON.stringify({
    v: 1, text: "Ordinary Boost" })).toString("base64url")}`), ...tx.vout.slice(1)] };
  for (const value of [tx, legacy]) {
    const inbox = clean(context.inboxMessagesFromTransactions([value], ADDRESS, "livenet"));
    const sent = clean(context.sentMessagesFromTransactions([value], ADDRESS, "livenet"));
    assert.equal(inbox.length, 1); assert.equal(sent.length, 1);
    assert.equal(inbox[0].memo, "Ordinary body"); assert.equal(sent[0].memo, "Ordinary body");
    assert.equal(inbox[0].amountSats, 546); assert.equal(sent[0].amountSats, 546);
    assert.equal(inbox[0].article, undefined); assert.equal(sent[0].article, undefined);
  }
});
