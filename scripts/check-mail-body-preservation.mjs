#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseWorkAmoV5PwmMessages } from '../server/work-amo-v5.mjs';
import {
  proofIndexCanonicalMailProjectionRows,
  proofIndexCanonicalMailProjectionParity,
} from '../server/proof-index-mail-projection.mjs';

// Extract the actual reader/UI helpers without importing API startup or pools.
const reader = readFileSync('server/db/proof-index-reader.mjs', 'utf8');
const readerBodies = reader.slice(reader.indexOf('function subjectOnlyMailBody(value)'),
  reader.indexOf('function mailParticipantRecordsFromRow'));
assert(readerBodies.includes('function mailMemoFromEvent(row, payload)'));
const readMemo = new Function(`${readerBodies}; return mailMemoFromEvent;`)();
const app = readFileSync('src/App.tsx', 'utf8');
const uiBody = app.slice(app.indexOf('function browserMessageBodyAttachment('),
  app.indexOf('function browserPageFromTransaction('))
  .replace('html: string,\n  subject?: string,\n): MailAttachment', 'html,\n  subject,\n)');
const bodyAttachment = new Function('base64UrlEncodeBytes', 'sha256Hex',
  `${uiBody}; return browserMessageBodyAttachment;`)(
  bytes => Buffer.from(bytes).toString('base64url'),
  bytes => createHash('sha256').update(bytes).digest('hex'),
);
const txid = 'a'.repeat(64);
let assertions = 0;
const equal = (left, right) => { assert.deepEqual(left, right); assertions++; };
const event = (payload, kind = 'mail', status = 'confirmed') => ({
  network: 'livenet', txid, protocol: 'pwm1', valid: true, kind, status,
  amount_sats: '546', data_bytes: 16, payload, event_time: null,
});
function check(body, kind = 'mail', status = 'confirmed') {
  equal(parseWorkAmoV5PwmMessages([`pwm1:m:${body}`]).memo, body);
  const source = event({ memo: body }, kind, status);
  const projection = proofIndexCanonicalMailProjectionRows([source]);
  equal(projection.invalid.length, 0);
  equal(projection.rows[0].body_text, body || null);
  const rendered = readMemo({ body_text: body.trim() || null }, source.payload);
  equal(rendered, body);
  equal(Buffer.from(rendered), Buffer.from(body));
  equal(proofIndexCanonicalMailProjectionParity({
    eventRows: [source], mailRows: projection.rows,
  }).ready, true);
  if (body && body !== body.trim()) {
    equal(proofIndexCanonicalMailProjectionParity({
      eventRows: [source],
      mailRows: [{ ...projection.rows[0], body_text: body.trim() || null }],
    }).ready, false);
  }
}
for (const body of [' tail\n', '\n', '\t', '\r\n', '\u00a0', '\ufeff',
  '  😀\r\n', ' Subject: literal body\n', ' PoWb\n', ' INCB\t', '']) check(body);
for (const kind of ['attachment', 'browser', 'file', 'inception-bond',
  'infinity-bond', 'mail', 'reply']) {
  for (const status of ['confirmed', 'pending', 'dropped', 'orphaned']) {
    check(' raw\n', kind, status);
  }
}
for (const key of ['body', 'message', 'memo']) {
  const payload = { [key]: ' legacy\n' };
  equal(proofIndexCanonicalMailProjectionRows([event(payload)]).rows[0].body_text,
    ' legacy\n');
  equal(readMemo({}, payload), ' legacy\n');
}
equal(readMemo({ body_text: ' stored\r\n' }, {}), ' stored\r\n');
equal(readMemo({ body_text: ' \nSubject: metadata\n' }, {}), '');
for (const payload of [{ memo: null }, { memo: '' }]) {
  equal(proofIndexCanonicalMailProjectionRows([event(payload)]).rows[0].body_text, null);
  equal(readMemo({ body_text: null }, payload), '');
}
equal(proofIndexCanonicalMailProjectionRows([event({})]).invalid.length, 1);
equal(readMemo({ body_text: null }, {}), '');
for (const payload of [{ detail: ' \nSubject: metadata\n' },
  { memo: '', detail: ' \nSubject: metadata\n' }]) {
  equal(proofIndexCanonicalMailProjectionRows([event(payload)]).rows[0].body_text, null);
  equal(readMemo({ body_text: null }, payload), '');
}
const fallback = { memo: '', detail: ' old detail\r\n' };
equal(proofIndexCanonicalMailProjectionRows([event(fallback)]).rows[0].body_text,
  ' old detail\r\n');
equal(readMemo({}, fallback), ' old detail\r\n');
const html = '  <!doctype html>\n<div>😀</div>\r\n';
const derived = bodyAttachment(readMemo({ body_text: html.trim() }, { memo: html }),
  'Byte fixture');
equal(derived.size, Buffer.byteLength(html));
equal(derived.sha256, createHash('sha256').update(Buffer.from(html)).digest('hex'));
equal(Buffer.from(derived.data, 'base64url'), Buffer.from(html));
console.log(JSON.stringify({ ok: true, assertions,
  qualification: 'Actual projection, reader and UI byte constructor; synthetic UTF8 fixtures, no database, signing or network calls.' }));
