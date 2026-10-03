import * as bitcoin from "bitcoinjs-lib";
import { Buffer } from "buffer";
export function byteLength(value) {
    return new TextEncoder().encode(value).length;
}
export function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function sha256Hex(bytes) {
    return bytesToHex(bitcoin.crypto.sha256(Buffer.from(bytes)));
}
export function base64UrlFromBase64(value) {
    return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}
export function base64FromBase64Url(value) {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}
export function base64UrlEncodeBytes(bytes) {
    return base64UrlFromBase64(Buffer.from(bytes).toString("base64"));
}
export function base64UrlDecodeBytes(value) {
    if (!/^[A-Za-z0-9_-]*$/.test(value)) {
        throw new Error("Invalid base64url data.");
    }
    return new Uint8Array(Buffer.from(base64FromBase64Url(value), "base64"));
}
export function encodeTextBase64Url(value) {
    return base64UrlEncodeBytes(new TextEncoder().encode(value));
}
export function decodeTextBase64Url(value) {
    return new TextDecoder("utf-8", { fatal: false }).decode(base64UrlDecodeBytes(value));
}
export function chunkAscii(value, maxBytes) {
    const chunks = [];
    for (let index = 0; index < value.length; index += maxBytes) {
        chunks.push(value.slice(index, index + maxBytes));
    }
    return chunks.length ? chunks : [""];
}
export function chunkUtf8(value, maxBytes) {
    const chunks = [];
    let current = "";
    for (const character of value) {
        const next = `${current}${character}`;
        if (byteLength(next) > maxBytes) {
            chunks.push(current);
            current = character;
            continue;
        }
        current = next;
    }
    if (current || chunks.length === 0) {
        chunks.push(current);
    }
    return chunks;
}
function isBrowserHtmlMessageBody(value) {
    const text = value.trim();
    if (!text) {
        return false;
    }
    return (/^<!doctype\s+html[\s>]/iu.test(text) ||
        /^<html[\s>]/iu.test(text) ||
        /<\/(?:html|head|body)>/iu.test(text) ||
        /^<(?:a|article|body|button|canvas|code|div|form|h[1-6]|head|img|input|main|ol|p|pre|script|section|span|style|svg|table|ul)(?:\s|>|\/)/iu.test(text));
}
function browserMessageBodyAttachment(html, subject) {
    const bytes = new TextEncoder().encode(html);
    const safeSubject = (subject ?? "")
        .trim()
        .replace(/[^\w.-]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        .slice(0, 80);
    const name = safeSubject
        ? safeSubject.toLowerCase().endsWith(".html")
            ? safeSubject
            : `${safeSubject}.html`
        : "message-body.html";
    return {
        data: base64UrlEncodeBytes(bytes),
        mime: "text/html",
        name,
        sha256: sha256Hex(bytes),
        size: bytes.byteLength,
    };
}

const rows=[];let size=0;for await(const piece of process.stdin){size+=piece.length;if(size>16*1024*1024)throw Error('HTML_INPUT_BOUND');rows.push(piece);}const messages=JSON.parse(Buffer.concat(rows).toString('utf8'));if(!Array.isArray(messages)||messages.length!==619)throw Error('HTML_POPULATION_COUNT');const out=[],ids=new Set();let classified=0,attached=0;
for(const message of messages){if(!message||typeof message.memo!=='string'||!/^[a-f0-9]{64}$/u.test(message.txid)||ids.has(message.txid))throw Error('HTML_MESSAGE_SHAPE');ids.add(message.txid);const bytes=new TextEncoder().encode(message.memo),raw=sha256Hex(bytes);if(raw!==message.rawBody.sha256||bytes.length!==message.rawBody.bytes)throw Error('HTML_CANONICAL_MEMO_BYTES');if(!isBrowserHtmlMessageBody(message.memo))continue;classified++;if(message.hasExplicitAttachment){attached++;continue;}const attachment=browserMessageBodyAttachment(message.memo);if(attachment.mime!=='text/html'||attachment.size!==bytes.length||attachment.sha256!==raw||!Buffer.from(attachment.data,'base64url').equals(Buffer.from(bytes)))throw Error('HTML_DERIVED_BYTES');out.push({txid:message.txid,bytes:attachment.size,sha256:attachment.sha256});}
console.log(JSON.stringify({schema:'pow-audit30-derived-html-body-hashes-v1',populationRows:messages.length,htmlBodiesClassified:classified,explicitAttachmentHtmlBodiesExcluded:attached,derivedBodyAttachmentsVerified:out.length,rawBytesPreserved:true,rows:out,privateMemoExported:false,attachmentRenderingCertified:false}));
