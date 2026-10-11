import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_YOUTUBE_CARDS, parseYouTubeUrl, youtubeLinksFromText } from "./youtubeLinks.mjs";
const id = "rThDEqJsRtk";

test("recognizes YouTube watch, share, shorts, live and embed links", () => {
  for (const url of [
    `https://youtu.be/${id}?si=mRJf8Ygs-iVetqUb`, `https://www.youtube.com/watch?v=${id}&feature=share`,
    `https://m.youtube.com/shorts/${id}`, `https://youtube.com/live/${id}`, `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`, `www.youtube.com/watch?v=${id}`,
    `WWW.YOUTUBE.COM/watch?v=${id}`,
  ]) assert.equal(parseYouTubeUrl(url)?.videoId, id, url);
});

test("rejects spoofed hosts, credentials, unsupported schemes, ambiguous IDs and non-video links", () => {
  for (const url of [
    `https://youtube.com.evil.example/watch?v=${id}`, `https://evil.example/youtu.be/${id}`,
    `https://youtube.com@evil.example/watch?v=${id}`, `https://user@youtube.com/watch?v=${id}`,
    `https://youtube.com:8443/watch?v=${id}`, `ftp://youtube.com/watch?v=${id}`,
    `javascript:https://youtube.com/watch?v=${id}`, `https://youtu.be/${id}/extra`,
    "https://youtube.com/watch?v=too-short", `https://youtube.com/watch?v=${id}&v=aaaaaaaaaaa`,
    `https://youtube.com/playlist?list=${id}`, `https://youtube.com/channel/${id}`,
    `https://notyoutube.com/watch?v=${id}`, `https://youtube.com/watch?v=${id}%2F`,
  ]) assert.equal(parseYouTubeUrl(url), null, url);
});

test("timestamps are bounded and normalized; tracking and player-control parameters are discarded", () => {
  for (const [suffix, start] of [["?t=1h2m3s", 3723], ["?start=90", 90], ["#t=25", 25], ["?t=75", 75],
    ["?t=-1", 0], ["?t=1.5", 0], ["?t=99999999999999999", 0], ["?t=bad", 0]]) {
    const link = parseYouTubeUrl(`https://youtu.be/${id}${suffix}`);
    assert.equal(link.start, start);
  }
  assert.deepEqual(parseYouTubeUrl(`https://youtu.be/${id}?t=1m&autoplay=1&origin=https://evil.example&si=tracker`),
    { videoId: id, start: 60, watchUrl: `https://www.youtube.com/watch?v=${id}&t=60s` });
});

test("extracts punctuation-delimited links, preserves source, deduplicates and caps cards", () => {
  const source = `A café 🧭 (https://youtu.be/${id}?t=45).\nhttps://youtube.com/watch?v=${id}\n` +
    ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map(value => `https://youtu.be/${value}`).join(" ");
  const before = Buffer.from(source);
  const links = youtubeLinksFromText(source);
  assert.deepEqual(links.map(link => link.videoId), [id, "aaaaaaaaaaa", "bbbbbbbbbbb"]);
  assert.equal(links[0].start, 45);
  assert.equal(links.length, MAX_YOUTUBE_CARDS);
  assert.deepEqual(Buffer.from(source), before);
});

test("does not turn code, email-like tokens or nested URLs into video cards", () => {
  for (const text of [
    `\`https://youtu.be/${id}\``, `\`\`https://youtu.be/${id}\`\``,
    `\`\`\`text\nhttps://youtu.be/${id}\n\`\`\``, `~~~\nhttps://youtu.be/${id}\n~~~`,
    `\`\`\`\nhttps://youtu.be/${id}`, `owner@www.youtube.com/watch?v=${id}`,
    `https://evil.example/?redirect=https://youtu.be/${id}`, `ftp://www.youtube.com/watch?v=${id}`,
  ]) assert.deepEqual(youtubeLinksFromText(text), [], text);
  assert.equal(youtubeLinksFromText(`\`code\` https://youtu.be/${id}`).length, 1);
});

test("long untrusted backtick runs cannot cause regex backtracking stalls", () => {
  const text = `prefix ${"`".repeat(100_000)} suffix https://youtu.be/${id}`;
  const started = performance.now();
  assert.deepEqual(youtubeLinksFromText(text), []);
  assert.ok(performance.now() - started < 1_000, "bounded article scan exceeded one second");
});
