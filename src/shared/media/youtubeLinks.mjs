// YouTube cards are a read-only view of links. The original post/article text
// remains untouched; no external metadata can become committed source evidence.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const EMBED_HOSTS = new Set(["youtube-nocookie.com", "www.youtube-nocookie.com"]);
export const MAX_YOUTUBE_CARDS = 3;
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_START_SECONDS = 604_800;

function startSeconds(value) {
  if (!value) return 0;
  if (/^\d+$/u.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) && seconds <= MAX_START_SECONDS ? seconds : 0;
  }
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/u.exec(value);
  if (!parts || !parts.slice(1).some(Boolean)) return 0;
  const seconds = Number(parts[1] || 0) * 3600 + Number(parts[2] || 0) * 60 + Number(parts[3] || 0);
  return Number.isSafeInteger(seconds) && seconds <= MAX_START_SECONDS ? seconds : 0;
}

export function parseYouTubeUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  let url;
  try { url = new URL(/^www\./iu.test(value) ? `https://${value}` : value); } catch { return null; }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  let videoId = "";
  if (SHORT_HOSTS.has(host)) videoId = /^\/([A-Za-z0-9_-]{11})\/?$/u.exec(url.pathname)?.[1] || "";
  else if (YOUTUBE_HOSTS.has(host)) {
    if (/^\/watch\/?$/u.test(url.pathname) && url.searchParams.getAll("v").length === 1) videoId = url.searchParams.get("v") || "";
    else videoId = /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/u.exec(url.pathname)?.[1] || "";
  } else if (EMBED_HOSTS.has(host)) videoId = /^\/embed\/([A-Za-z0-9_-]{11})\/?$/u.exec(url.pathname)?.[1] || "";
  if (!VIDEO_ID.test(videoId)) return null;
  const hash = new URLSearchParams(url.hash.slice(1));
  const start = startSeconds(url.searchParams.get("t") || url.searchParams.get("start") || hash.get("t"));
  return { videoId, start, watchUrl: `https://www.youtube.com/watch?v=${videoId}${start ? `&t=${start}s` : ""}` };
}

function withoutCode(text) {
  // Exclude fenced and inline code without interpreting or rewriting Markdown.
  // Masking preserves boundaries so adjacent prose cannot become a synthetic URL.
  const masked = text.split("");
  const fences = /^[ ]{0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gmu;
  for (let opener; (opener = fences.exec(text));) {
    const marker = opener[1];
    const closing = new RegExp(`^[ ]{0,3}${marker[0]}{${marker.length},}[ \\t]*(?:\\r?\\n|$)`, "gmu");
    closing.lastIndex = fences.lastIndex;
    const end = closing.exec(text);
    const until = end ? end.index + end[0].length : text.length;
    masked.fill(" ", opener.index, until);
    fences.lastIndex = until;
  }
  // Match complete backtick runs by length. A backreference regex can spend
  // quadratic time splitting a long unclosed run in an untrusted article.
  const runs = Array.from(masked.join("").matchAll(/`+/gu));
  const nextRun = new Map(), nextMatching = new Map();
  for (let index = runs.length - 1; index >= 0; index--) {
    const length = runs[index][0].length;
    if (nextRun.has(length)) nextMatching.set(index, nextRun.get(length));
    nextRun.set(length, index);
  }
  for (let index = 0; index < runs.length;) {
    const endIndex = nextMatching.get(index);
    const until = endIndex === undefined ? text.length : runs[endIndex].index + runs[endIndex][0].length;
    masked.fill(" ", runs[index].index, until);
    if (endIndex === undefined) break;
    index = endIndex + 1;
  }
  return masked.join("");
}

export function youtubeLinksFromText(value) {
  if (typeof value !== "string" || !value) return [];
  const text = withoutCode(value.slice(0, MAX_TEXT_LENGTH));
  const links = [], seen = new Set();
  // Consume all schemes, including unsupported ones, to avoid finding a trusted
  // URL nested inside an untrusted URL's path/query or an unsupported scheme.
  for (const match of text.matchAll(/(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.)[^\s<>"“”‘’`]+/giu)) {
    if (match.index && /[\p{L}\p{N}_@/\\:=]/u.test(text[match.index - 1])) continue;
    const candidate = match[0].replace(/[.,!?;:)\]}]+$/u, "");
    const link = parseYouTubeUrl(candidate);
    if (!link || seen.has(link.videoId)) continue;
    seen.add(link.videoId);
    links.push(link);
    if (links.length === MAX_YOUTUBE_CARDS) break;
  }
  return links;
}
