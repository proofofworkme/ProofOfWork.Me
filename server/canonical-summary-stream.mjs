import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  createWorkTransferProjectionDecoder, prepareWorkTransferProjection,
  workTransferProjectionPageLength,
} from "./db/work-transfer-projection-store.mjs";

export const SUMMARY_STREAM_TYPE = "application/vnd.proofofwork.canonical-summary.v1";

function withProjection(bundle, projection) {
  const summaries = bundle.summaryPayloads;
  return {
    ...bundle, summaryPayloads: {
      ...summaries, workSummary: { ...summaries.workSummary, workTransferValueProjection: projection },
    },
  };
}

// The hash remains byte-identical to JSON.stringify on the decoded JSON
// bundle. Stream the two lifetime arrays instead of making one giant string.
export function canonicalSummaryPayloadHash(summaries) {
  const digest = createHash("sha256");
  function object(fields, write) {
    digest.update("{");
    let separator = "";
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      digest.update(separator + JSON.stringify(key) + ":");
      write(key, value);
      separator = ",";
    }
    digest.update("}");
  }
  function emit(value) { digest.update(JSON.stringify(value)); }
  function projectionField(key, value) {
    if ((key === "items" || key === "transferBatches") && Array.isArray(value)) {
      digest.update("[");
      for (const [index, item] of value.entries()) {
        if (index) digest.update(",");
        emit(item ?? null);
      }
      digest.update("]");
    } else emit(value);
  }
  object(summaries, (key, value) => {
    if (key !== "workSummary") return emit(value);
    object(value, (field, part) => {
      if (field === "workTransferValueProjection") object(part, projectionField);
      else emit(part);
    });
  });
  return digest.digest("hex");
}

// Only the authenticated worker negotiates this format. One bounded JSON header
// and ordered raw pages share the same completed canonical build and checkpoint.
export function writeCanonicalSummaryStream(response, bundle, maxHeaderBytes) {
  const { reference, pages } = prepareWorkTransferProjection(
    bundle.summaryPayloads.workSummary.workTransferValueProjection, bundle,
  );
  const header = Buffer.from(JSON.stringify(withProjection(bundle, reference)));
  if (header.length > maxHeaderBytes) throw new Error("Canonical summary header exceeds its byte limit");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(header.length);
  response.writeHead(200, { "Content-Type": SUMMARY_STREAM_TYPE, "Cache-Control": "no-store" });
  return pipeline(Readable.from([size, header, ...pages]), response);
}

export async function readCanonicalSummaryStream(response, maxHeaderBytes) {
  const input = response[Symbol.asyncIterator]();
  let remainder = Buffer.alloc(0);
  async function take(length) {
    const result = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      if (!remainder.length) {
        const next = await input.next();
        if (next.done) throw new Error("Truncated canonical summary stream");
        remainder = Buffer.from(next.value);
      }
      const copied = remainder.copy(result, offset, 0, length - offset);
      offset += copied;
      remainder = remainder.subarray(copied);
    }
    return result;
  }
  const headerLength = (await take(4)).readUInt32BE();
  if (!headerLength || headerLength > maxHeaderBytes) throw new Error("Invalid canonical summary header length");
  const bundle = JSON.parse((await take(headerLength)).toString("utf8"));
  const ref = bundle.summaryPayloads?.workSummary?.workTransferValueProjection;
  // Validate all dimensions and the checkpoint before allocating the first page.
  workTransferProjectionPageLength(ref, bundle, 0);
  const decoder = createWorkTransferProjectionDecoder(ref, bundle);
  for (let index = 0; index < ref.pageCount; index++) {
    decoder.write(await take(workTransferProjectionPageLength(ref, bundle, index)));
  }
  if (remainder.length || !(await input.next()).done || response.complete === false) {
    throw new Error("Unexpected trailing or incomplete canonical summary stream");
  }
  return withProjection(bundle, decoder.finish());
}
