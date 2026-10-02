// Text links are a read-only projection. These lexical rules never define
// registry validity or authorize identity: profile reads resolve confirmed IDs.
const TAG_BODY = String.raw`[\p{L}\p{M}\p{N}_]+`;
const NAME_BODY = String.raw`[\p{L}\p{M}\p{N}\p{S}\p{Pc}\u200d]+(?:[.\-+][\p{L}\p{M}\p{N}\p{S}\p{Pc}\u200d]+)*`;
const TOKEN = new RegExp(String.raw`[#$]${TAG_BODY}|@${NAME_BODY}`, "gu");
const QUOTED_MENTION = /@("(?:[^"\\\r\n]|\\.)*")|("(?:[^"\\\r\n]|\\.)*")@proofofwork\.me/giu;
const QUOTED_EMAIL = /"(?:[^"\\\r\n]|\\.)*"@[\p{L}\p{N}][\p{L}\p{N}._-]*/gu;
const EMAIL = /([^\s<>()\[\]{}"“”‘’@,;:]+)@([\p{L}\p{N}](?:[\p{L}\p{N}._-]*[\p{L}\p{N}])?)/gu;
const URL_TEXT = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[\p{L}\p{N}][\p{L}\p{N}.-]*\.[a-z]{2,}(?:\/|\?|#))[^\s<>"“”]+/giu;
const WORD_CHAR = /[\p{L}\p{M}\p{N}\p{S}\p{Pc}\u200d@#$]/u;
const TAG_WORD_CHAR = /[\p{L}\p{M}\p{N}\p{Pc}@]/u;

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

/** A tag query matches the whole token, including its cash/hashtag prefix. */
export function boostTextMatchesTag(text, query) {
  const normalized = String(query ?? "").trim().toLowerCase();
  return parseBoostText(text).some(segment =>
    (segment.kind === "cashtag" || segment.kind === "hashtag") && segment.value === normalized);
}
