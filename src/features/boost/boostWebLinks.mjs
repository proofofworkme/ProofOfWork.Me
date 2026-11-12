// Display-only links. Never interpret source as HTML or change indexed tokens.
const DOMAIN = String.raw`(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}`;
const WEB_TOKEN = new RegExp(String.raw`\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"“”‘’\x60]+|\b${DOMAIN}(?::[0-9]{1,5})?(?:[/?#][^\s<>"“”‘’\x60]*)?`, "giu");

// Compute on the complete source, before mentions/tags split it into segments.
export function boostWebLinkCodeRanges(text) {
  const ranges = [];
  const fence = /^[ ]{0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gmu;
  for (let open; (open = fence.exec(text));) {
    const marker = open[1];
    const close = new RegExp(`^[ ]{0,3}${marker[0]}{${marker.length},}[ \\t]*(?:\\r?\\n|$)`, "gmu");
    close.lastIndex = fence.lastIndex;
    const end = close.exec(text);
    const stop = end ? end.index + end[0].length : text.length;
    ranges.push({ start: open.index, end: stop });
    fence.lastIndex = stop;
  }
  const ticks = /`+/gu;
  for (let open; (open = ticks.exec(text));) {
    const protectedRange = ranges.find(range => range.start <= open.index && range.end > open.index);
    if (protectedRange) { ticks.lastIndex = protectedRange.end; continue; }
    let end = text.indexOf(open[0], ticks.lastIndex);
    while (end >= 0 && (text[end - 1] === "`" || text[end + open[0].length] === "`")) end = text.indexOf(open[0], end + open[0].length);
    const stop = end < 0 ? text.length : end + open[0].length;
    ranges.push({ start: open.index, end: stop });
    ticks.lastIndex = stop;
  }
  return ranges;
}

export function boostWebLinks(text, { codeRanges = boostWebLinkCodeRanges(text), sourceOffset = 0 } = {}) {
  const parts = [];
  let offset = 0;
  for (const match of text.matchAll(WEB_TOKEN)) {
    const start = match.index, absoluteStart = sourceOffset + start;
    if (codeRanges.some(range => range.start < absoluteStart + match[0].length && range.end > absoluteStart)) continue;
    if (start && /[\p{L}\p{M}\p{N}_@/\\:=.+-]/u.test(text[start - 1])) continue;
    const explicit = /^[a-z][a-z0-9+.-]*:\/\//iu.test(match[0]);
    if (!explicit) {
      // Do not activate a suffix inside an email, URI, path, or malformed host.
      const prefix = text.slice(0, start).match(/[^\s<>"“”‘’`]*$/u)?.[0] ?? "";
      if (prefix.includes("@") || /[a-z][a-z0-9+.-]*:/iu.test(prefix)) continue;
      if (/[\p{L}\p{M}\p{N}_@\\-]/u.test(text[start + match[0].length] ?? "")) continue;
      if (/^\.[\p{L}\p{M}\p{N}_-]/u.test(text.slice(start + match[0].length))) continue;
      if (/^:[^\s.,;!?()[\]{}<>"“”‘’]/u.test(text.slice(start + match[0].length))) continue;
    }
    let label = match[0].replace(/[.,!?;:]+$/u, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      while (label.endsWith(close) && label.split(close).length > label.split(open).length) label = label.slice(0, -1);
    }
    let url;
    try { url = new URL(explicit ? label : `https://${label}`); } catch { continue; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
    if (!explicit && (url.hostname.toLowerCase().endsWith(".pow") || url.hostname.length > 253)) continue;
    if (start > offset) parts.push({ text: text.slice(offset, start) });
    parts.push({ text: label, href: url.href });
    offset = start + label.length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}
