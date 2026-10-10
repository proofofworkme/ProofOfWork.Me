// Text links are a read-only projection. These lexical rules never define
// registry validity or authorize identity: profile reads resolve confirmed IDs,
// and Browser independently verifies a clicked .pow name's confirmed page link.
const TAG_BODY = String.raw`[\p{L}\p{M}\p{N}_]+`;
const NAME_BODY = String.raw`[\p{L}\p{M}\p{N}\p{S}\p{Pc}\u200d]+(?:[.\-+][\p{L}\p{M}\p{N}\p{S}\p{Pc}\u200d]+)*`;
const TOKEN = new RegExp(String.raw`[#$]${TAG_BODY}|@${NAME_BODY}`, "gu");
const QUOTED_MENTION = /@("(?:[^"\\\r\n]|\\.)*")|("(?:[^"\\\r\n]|\\.)*")@proofofwork\.me/giu;
const QUOTED_EMAIL = /"(?:[^"\\\r\n]|\\.)*"@[\p{L}\p{N}][\p{L}\p{N}._-]*/gu;
const EMAIL = /([^\s<>()\[\]{}"“”‘’@,;:]+)@([\p{L}\p{N}](?:[\p{L}\p{N}._-]*[\p{L}\p{N}])?)/gu;
const URL_TEXT = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[\p{L}\p{N}][\p{L}\p{N}.-]*\.[a-z]{2,}(?:\/|\?|#))[^\s<>"“”]+/giu;
const WORD_CHAR = /[\p{L}\p{M}\p{N}\p{S}\p{Pc}\u200d@#$]/u;
const TAG_WORD_CHAR = /[\p{L}\p{M}\p{N}\p{Pc}@]/u;
// Mirror Browser's ASCII root/one-level-child shape, never DNS validity.
const DNS_LABEL = String.raw`[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?`;
// Consume a lexical delimiter so an overlong word is not searched repeatedly
// for a valid suffix. Unicode boundaries are checked separately below.
const DNS_NAME = new RegExp(String.raw`(^|[^a-zA-Z0-9.-])((?:${DNS_LABEL}\.)?${DNS_LABEL}\.[pP][oO][wW])`, "gu");
const DNS_BEFORE = /[\p{L}\p{M}\p{N}\p{Pc}\u200d@#$.+\-/\\:%]/u;
const DNS_AFTER = /[\p{L}\p{M}\p{N}\p{Pc}\u200d@+\-/\\]/u;

// This is only a lexical exclusion for new DNS links. It does not interpret
// Markdown or change the existing tag/mention projection inside source text.
function dnsCodeRanges(text) {
  const ranges = [];
  const fences = /^[ ]{0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gmu;
  for (let opener; (opener = fences.exec(text));) {
    const marker = opener[1], start = opener.index;
    const closing = new RegExp(String.raw`^[ ]{0,3}${marker[0]}{${marker.length},}[ \t]*(?:\r?\n|$)`, "gmu");
    closing.lastIndex = fences.lastIndex;
    const end = closing.exec(text);
    const rangeEnd = end ? end.index + end[0].length : text.length;
    ranges.push({ start, end: rangeEnd });
    fences.lastIndex = rangeEnd;
  }
  const ticks = /`+/gu;
  let fenceIndex = 0;
  for (let opener; (opener = ticks.exec(text));) {
    const start = opener.index;
    while (fenceIndex < ranges.length && ranges[fenceIndex].end <= start) fenceIndex++;
    if (fenceIndex < ranges.length && ranges[fenceIndex].start <= start) {
      ticks.lastIndex = ranges[fenceIndex].end;
      continue;
    }
    const marker = opener[0];
    let end = text.indexOf(marker, ticks.lastIndex);
    while (end >= 0 && (text[end - 1] === "`" || text[end + marker.length] === "`")) {
      end = text.indexOf(marker, end + marker.length);
    }
    const rangeEnd = end < 0 ? text.length : end + marker.length;
    ranges.push({ start, end: rangeEnd });
    ticks.lastIndex = rangeEnd;
  }
  return ranges;
}

function mergedRanges(ranges) {
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  return merged;
}

function dnsLiteralRanges(text) {
  const ranges = [];
  // Bound exclusions to lexical chunks rather than repeatedly searching a
  // long article for an absent @, scheme or domain separator.
  for (const match of text.matchAll(/[^\s<>"“”]+/gu)) {
    const chunk = match[0];
    // A bare www.alice.pow is a valid child, not an external web URL.
    if (chunk.includes("@") || chunk.includes("://") ||
        /\.[a-z]{2,}(?:\/|\?|#)/iu.test(chunk)) {
      ranges.push({ start: match.index, end: match.index + chunk.length });
    }
  }
  // Quoted IDs/emails can contain whitespace. Walk each quoted span once,
  // honoring escapes, without interpreting it as markup or an identity.
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '"') continue;
    let end = start + 1;
    while (end < text.length && text[end] !== '"' && !/[\r\n]/u.test(text[end])) {
      end += text[end] === "\\" ? 2 : 1;
    }
    if (text[start - 1] === "@" || (text[end] === '"' && text[end + 1] === "@")) {
      ranges.push({ start: text[start - 1] === "@" ? start - 1 : start, end: Math.min(text.length, end + 1) });
    }
    start = end;
  }
  return ranges;
}

function dnsLinks(text, existingLinks = []) {
  const ranges = mergedRanges([...existingLinks, ...dnsCodeRanges(text), ...dnsLiteralRanges(text)]);
  const links = [];
  let rangeIndex = 0;
  for (const match of text.matchAll(DNS_NAME)) {
    const name = match[2], start = match.index + match[1].length, end = start + name.length;
    while (rangeIndex < ranges.length && ranges[rangeIndex].end <= start) rangeIndex++;
    // Read only adjacent code points, keeping long article scans bounded.
    const beforeOffset = start > 1 && /[\uDC00-\uDFFF]/u.test(text[start - 1]) ? start - 2 : start - 1;
    const before = start ? text.slice(beforeOffset, start) : "";
    const afterPoint = text.codePointAt(end);
    const after = afterPoint === undefined ? "" : String.fromCodePoint(afterPoint);
    // An unspaced word-colon prefix is URI-like and stays literal, including
    // "see:alice.pow". A separated prose prefix and trailing colon do link.
    if ((rangeIndex < ranges.length && ranges[rangeIndex].start < end) ||
        DNS_BEFORE.test(before) || DNS_AFTER.test(after) ||
        /^\.[\p{L}\p{M}\p{N}_-]/u.test(text.slice(end)) ||
        /^:[^\s.,;!?()[\]{}<>"“”‘’]/u.test(text.slice(end))) continue;
    links.push({ start, end, kind: "dns", text: name, value: name.toLowerCase() });
  }
  return links;
}

function textSegments(text, links) {
  links.sort((left, right) => left.start - right.start);
  const segments = [];
  let offset = 0;
  for (const { start, end, ...link } of links) {
    if (start < offset) continue;
    if (start > offset) segments.push({ kind: "text", text: text.slice(offset, start), value: text.slice(offset, start) });
    segments.push(link);
    offset = end;
  }
  if (offset < text.length) segments.push({ kind: "text", text: text.slice(offset), value: text.slice(offset) });
  return segments;
}

/** DNS-only display projection; article tags/mentions remain literal text. */
export function parsePowDnsText(value) {
  const text = String(value ?? "");
  return textSegments(text, dnsLinks(text));
}

function addressMention(value) {
  // Shape recognition preserves Base58 case and folds only unmixed Bech32.
  // The API independently checks address checksum and the selected network.
  if (/^[13mn2][a-z0-9]{25,34}$/iu.test(value)) return value;
  const lower = value.toLowerCase();
  if (/^(?:bc1|tb1|bcrt1)[a-z0-9]{11,87}$/u.test(lower)) {
    return value === lower || value === value.toUpperCase() ? lower : value;
  }
  return "";
}

function characterBefore(text, offset) {
  return [...text.slice(0, offset)].at(-1) ?? "";
}

function tokenBoundary(text, start, end) {
  const before = characterBefore(text, start);
  const after = [...text.slice(end)].at(0) ?? "";
  return (!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after));
}

function tagBoundary(text, start, end, links) {
  const before = characterBefore(text, start), after = [...text.slice(end)].at(0) ?? "";
  const previousTag = links.some(link => link.end === start && (link.kind === "cashtag" || link.kind === "hashtag"));
  return (!before || !TAG_WORD_CHAR.test(before) || previousTag) && (!after || !TAG_WORD_CHAR.test(after));
}

function normalizeMentionId(value) {
  return String(value).trim().toLowerCase().replace(/^@/u, "")
    .replace(/@proofofwork\.me$/u, "").trim();
}

/** Preserve every source character and return linkable text projections. */
export function parseBoostText(value) {
  const text = String(value ?? "");
  if (!text) return [];
  const urlRanges = [...text.matchAll(URL_TEXT)].map(match => ({ start: match.index, end: match.index + match[0].length }));
  const links = [];
  for (const match of text.matchAll(QUOTED_MENTION)) {
    const start = match.index, end = start + match[0].length;
    if (urlRanges.some(range => range.start < start && range.end >= start)) continue;
    if (!tokenBoundary(text, start, end) || (match[2] && /^[.\-][\p{L}\p{N}_]/u.test(text.slice(end)))) continue;
    try {
      const id = normalizeMentionId(JSON.parse(match[1] ?? match[2]));
      if (id) links.push({ start, end, kind: "mention", text: match[0], value: id, identityKind: "id" });
    } catch { /* An invalid quoted name remains source text. */ }
  }
  const protectedRanges = links.map(({ start, end }) => ({ start, end }));
  protectedRanges.push(...[...text.matchAll(QUOTED_EMAIL)].map(match => ({
    start: match.index, end: match.index + match[0].length,
  })));
  protectedRanges.push(...urlRanges.filter(url =>
    !protectedRanges.some(range => url.start < range.end && url.end > range.start)));
  for (const match of text.matchAll(EMAIL)) {
    const start = match.index, end = start + match[0].length;
    if (protectedRanges.some(range => start < range.end && end > range.start)) continue;
    protectedRanges.push({ start, end });
    if (match[2].toLowerCase() !== "proofofwork.me" || !tokenBoundary(text, start, end)) continue;
    const id = normalizeMentionId(match[1]);
    if (!id) continue;
    links.push({ start, end, kind: "mention", text: match[0], value: id, identityKind: "id" });
  }
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index, end = start + match[0].length;
    const prefix = match[0][0], body = match[0].slice(1);
    if (protectedRanges.some(range => start < range.end && end > range.start) ||
        !(prefix === "@" ? tokenBoundary(text, start, end) : tagBoundary(text, start, end, links))) continue;
    if (prefix !== "@" && /[#$]/u.test(characterBefore(text, start))) continue;
    if (prefix === "$" && !/\p{L}/u.test(body)) continue;
    if (prefix === "#" && !/[\p{L}\p{N}]/u.test(body)) continue;
    const address = prefix === "@" ? addressMention(body) : "";
    links.push({ start, end, text: match[0],
      kind: prefix === "@" ? "mention" : prefix === "$" ? "cashtag" : "hashtag",
      value: prefix === "@" ? address || body.toLowerCase() : match[0].toLowerCase(),
      ...(prefix === "@" ? { identityKind: address ? "address" : "id" } : {}),
    });
  }
  links.push(...dnsLinks(text, links));
  return textSegments(text, links);
}

/** A tag query matches the whole token, including its cash/hashtag prefix. */
export function boostTextMatchesTag(text, query) {
  const normalized = String(query ?? "").trim().toLowerCase();
  return parseBoostText(text).some(segment =>
    (segment.kind === "cashtag" || segment.kind === "hashtag") && segment.value === normalized);
}
