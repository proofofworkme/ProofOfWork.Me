// Read the installed loopback API's negotiated body exactly as the canonical worker does.
import assert from "node:assert/strict";
import { get } from "node:http";
import { once } from "node:events";
import { Readable } from "node:stream";
import { readCanonicalSummaryStream, SUMMARY_STREAM_TYPE } from "../../server/canonical-summary-stream.mjs";

const [heightText, hash] = process.argv.slice(2);
const height = Number(heightText);
assert.ok(Number.isSafeInteger(height) && height > 0 && /^[0-9a-f]{64}$/u.test(hash));
const token = process.env.POW_INTERNAL_VERIFIER_TOKEN;
assert.ok(token?.length >= 32);
const route = "/api/v1/internal/canonical-summary";
const params = new URLSearchParams({ network:"livenet", workProjectionTransport:"v1", checkpointHeight:heightText, checkpointHash:hash });
const request = get({ hostname:"127.0.0.1",port:8081,path:route + "?" + params,agent:false,
  headers:{"x-pow-internal-verifier":token},signal:AbortSignal.timeout(150_000) });
const [response] = await once(request,"response");
try {
  assert.equal(response.statusCode,200);
  assert.equal(response.headers["content-type"],SUMMARY_STREAM_TYPE);
  assert.match(response.headers["content-length"] ?? "",/^[1-9]\d*$/u);
  const expected = Number(response.headers["content-length"]);
  assert.ok(Number.isSafeInteger(expected));
  let bytes = 0;
  const counted = Readable.from((async function* () {
    for await (const chunk of response) { bytes += chunk.length; yield chunk; }
  })());
  const bundle = await readCanonicalSummaryStream(counted,64*1024*1024);
  assert.ok(response.complete);
  assert.equal(bytes,expected);
  assert.equal(bundle.indexedThroughBlock,height);
  assert.equal(bundle.indexedThroughBlockHash,hash);
  assert.equal(Object.keys(bundle.summaryPayloads).length,8);
  assert.ok(Array.isArray(bundle.summaryPayloads.workSummary.workTransferValueProjection.items));
  console.log(JSON.stringify({ok:true,route,status:200,height,hash,snapshotId:bundle.snapshotId,receivedBytes:bytes,contentLength:expected}));
} finally { response.destroy(); }
