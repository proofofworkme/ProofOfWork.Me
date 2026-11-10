// Display-only links. Never interpret source as HTML or change indexed tokens.
export function boostWebLinks(text) {
  const parts = [];
  let offset = 0;
  for (const match of text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"“”‘’`]+/giu)) {
    if (match.index && /[\p{L}\p{N}_@/\\:=]/u.test(text[match.index - 1])) continue;
    let label = match[0].replace(/[.,!?;:]+$/u, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      while (label.endsWith(close) && label.split(close).length > label.split(open).length) label = label.slice(0, -1);
    }
    let url;
    try { url = new URL(label); } catch { continue; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    parts.push({ text: label, href: url.href });
    offset = match.index + label.length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}
