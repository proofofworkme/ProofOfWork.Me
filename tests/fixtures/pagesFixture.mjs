import { expect } from "@playwright/test";
import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import { createOwnerOutputCommitmentFixture } from "./ownerOutputCommitment.mjs";

export const ADDRESS = createOwnerOutputCommitmentFixture().ownerAddress;
export const OTHER_ADDRESS = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
export const HASH = "a".repeat(64);
export const PAGE_TXID = "b".repeat(64);
export const FILE_TXID = "c".repeat(64);
export const LINK_TXID = "d".repeat(64);
export const CODE_REPO = "e".repeat(64);
export const CODE_VERSION = "f".repeat(64);
export const CODE_FILE_TXID = "1".repeat(64);
export const DNS_EPOCH = { txid: HASH, protocolVout: 1, recordOrdinal: 0 };
export const NOW = "2026-10-07T16:00:00Z";
export const CHAIN_HTML = '<!doctype html>\n<html><body><h1>Chain source</h1><script>document.body.dataset.executed="yes"</script></body></html>\n  ';
export const FILE_HTML = '<!doctype html><html><body><h1>Verified file source</h1></body></html>\n';
export const CODE_HTML = '\uFEFF<!doctype html>\n<html><body><h1>Confirmed Code source</h1><script>document.body.dataset.executed="yes"</script></body></html>\n  ';
export const ID_RECORD = { id: "alice", ownerAddress: ADDRESS, receiveAddress: OTHER_ADDRESS,
  confirmed: true, network: "livenet", txid: HASH, amountSats: 1000, createdAt: NOW };
export const REGISTRY = { network: "livenet", activity: [], listings: [], pendingEvents: [], sales: [],
  records: [ID_RECORD], coverage: { complete: true }, indexedThroughBlock: 970000,
  checkpointHash: HASH, indexedAt: NOW };
export const RUNNER_POLICY = "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; sandbox allow-scripts";

export const funding = new bitcoin.Transaction();
funding.addInput(Buffer.alloc(32), 0xffffffff);
funding.addOutput(bitcoin.address.toOutputScript(ADDRESS), 100000n);

export function htmlTransaction(html = CHAIN_HTML, confirmed = true) {
  return { txid: PAGE_TXID, vin: [{ prevout: { scriptpubkey_address: ADDRESS, value: 1000 } }],
    vout: [{ scriptpubkey_address: ADDRESS, value: 546 }, {
      scriptpubkey_type: "op_return",
      scriptpubkey: Buffer.from(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(`pwm1:m:${html}`)])).toString("hex"),
      scriptpubkey_asm: `OP_RETURN OP_PUSHDATA1 ${Buffer.from(`pwm1:m:${html}`).toString("hex")}`,
      value: 0,
    }], status: { confirmed, block_height: confirmed ? 970000 : undefined,
      block_hash: confirmed ? HASH : undefined, block_time: 1791388800 } };
}

export function htmlFileMessage() {
  const bytes = Buffer.from(FILE_HTML);
  return { amountSats: 546, confirmed: true, status: "confirmed", createdAt: NOW,
    from: ADDRESS, to: ADDRESS, replyTo: ADDRESS, memo: "A verified HTML attachment", subject: "Source file",
    network: "livenet", txid: FILE_TXID,
    attachment: { name: "verified-source.html", mime: "text/html", size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), data: bytes.toString("base64url") } };
}

// This synthetic activated checkpoint exercises UI admission without signing or
// publishing a real-chain record. Production activation is pinned separately.
export function dnsPageSnapshot() {
  const root = { ...ID_RECORD, receiveAddress: OTHER_ADDRESS,
    ownershipEpoch: DNS_EPOCH, ownershipEpochBlockHeight: 969997 };
  return { ...REGISTRY, id: "alice", name: "alice.pow", routable: true, status: "confirmed",
    record: root, records: [root], pageLink: null,
    pageLinkEvents: [], pageLinkPendingEvents: [], pageLinkHistoricalRecords: [],
    pageLinkCoverage: { model: "dns-page-link-core-raw-block-coverage-v1", network: "livenet",
      complete: true, activationHeight: 969998, indexedThroughBlock: 970000,
      checkpointHash: HASH, witnessSha256: HASH, pageLinkSha256: HASH, blockCount: 3 },
    pageLinkAdmission: { ready: true, network: "livenet", activationHeight: 969998,
      minSelfPaymentSats: 546, protocolPrefix: "pwdns1:page1:",
      indexedThroughBlock: 970000, checkpointHash: HASH } };
}

export function activeDnsPageLink() {
  return { name: "alice.pow", pageTxid: PAGE_TXID, network: "livenet", confirmed: true,
    status: "active", active: true, valid: true, ownerAddress: ADDRESS,
    epoch: DNS_EPOCH, ownershipEpoch: DNS_EPOCH, txid: LINK_TXID,
    blockHeight: 969999, protocolVout: 1, recordOrdinal: 0 };
}

export function codeSnapshot() {
  const bytes = Buffer.from(CODE_HTML);
  const file = { path: "site/index.html", txid: CODE_FILE_TXID,
    sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  return { network: "livenet", source: "fixture-confirmed-code", complete: true,
    indexedThroughBlock: 970000, indexedThroughBlockHash: HASH,
    snapshot: { id: "fixture-code-snapshot", checkpointHeight: 970000, checkpointHash: HASH },
    repository: { txid: CODE_REPO, repoTxid: CODE_REPO, name: "Alice's website", description: "HTML source",
      ownerAddress: ADDRESS, ownerId: "alice", headTxid: CODE_VERSION, fileCount: 1, commitCount: 1 },
    files: [file], filesComplete: true, version: CODE_VERSION, selectedVersionTxid: CODE_VERSION,
    pagination: { limit: 30, hasMore: false, nextCursor: null }, events: [], pendingEvents: [],
    file: { ...file, content: CODE_HTML, contentBase64: bytes.toString("base64") } };
}

export async function fixture(page, { mailDraft, chainConfirmed = true } = {}) {
  const state = { requests: [], writes: [], external: [], chainConfirmed, chainHtml: CHAIN_HTML,
    dns: dnsPageSnapshot(), dnsRegistry: { ...REGISTRY, records: [] }, dnsReply: undefined,
    pageTxids: new Set([PAGE_TXID]), code: codeSnapshot(), codeReply: undefined };
  await page.addInitScript(({ address, otherAddress, mailDraft }) => {
    // The wallet fixture represents the host extension, never an app-frame bridge.
    if (window !== window.top) return;
    const listeners = new Map();
    window.__pagesFixture = { address, otherAddress, connected: false, signCalls: 0,
      changeAccount(next) { this.address = next; this.connected = true; listeners.get("accountsChanged")?.([next]); },
    };
    window.unisat = {
      getAccounts: async () => window.__pagesFixture.connected ? [window.__pagesFixture.address] : [],
      requestAccounts: async () => { window.__pagesFixture.connected = true; return [window.__pagesFixture.address]; },
      getChain: async () => ({ enum: "BITCOIN_MAINNET" }),
      getNetwork: async () => "livenet", on: (event, listener) => listeners.set(event, listener),
      removeListener: (event) => listeners.delete(event),
      signPsbt: async () => { window.__pagesFixture.signCalls++; throw new Error("This test stops at transaction review"); },
    };
    if (mailDraft && !localStorage.getItem(`proofofwork.draft.v1:livenet:${address}`)) {
      localStorage.setItem(`proofofwork.draft.v1:livenet:${address}`, JSON.stringify(mailDraft));
    }
  }, { address: ADDRESS, otherAddress: OTHER_ADDRESS, mailDraft });
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    state.requests.push(url);
    if (request.method() !== "GET") {
      state.writes.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 405, contentType: "application/json", body: '{"error":"Read-only Pages fixture"}' });
    }
    let json = {};
    if (url.pathname === "/api/v1/registry" || url.pathname === "/api/v1/registry-summary") json = REGISTRY;
    else if (url.pathname.startsWith("/api/v1/dns/")) {
      expect(url.searchParams.get("current")).toBe("1");
      expect(url.searchParams.get("fresh")).toBe("1");
      json = state.dnsReply ? await state.dnsReply(url) : state.dns;
    }
    else if (url.pathname.startsWith("/api/v1/ids/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/v1/ids/".length)).replace(/@proofofwork\.me$/u, "");
      const record = id === "alice" ? ID_RECORD : id === "pending" ? { ...ID_RECORD, id: "pending", confirmed: false } : null;
      json = { ...REGISTRY, record, records: record ? [record] : [], status: record ? record.confirmed ? "confirmed" : "pending" : "available" };
    } else if (url.pathname === "/api/v1/code-repository") {
      json = { ...state.code, file: url.searchParams.has("path") ? state.code.file : null };
      if (state.codeReply) json = await state.codeReply(url, json);
    } else if (state.pageTxids.has(url.pathname.match(/^\/api\/v1\/tx\/([a-f0-9]{64})$/u)?.[1])) {
      const txid = url.pathname.split("/").pop();
      json = { tx: { ...htmlTransaction(state.chainHtml, state.chainConfirmed), txid } };
    }
    else if (url.pathname.endsWith("/mail")) {
      const address = decodeURIComponent(url.pathname.split("/")[4]);
      json = { address, network: url.searchParams.get("network") || "livenet",
        inboxMessages: address === ADDRESS ? [htmlFileMessage()] : [], sentMessages: [],
        historyCoverage: { model: "proof-index-address-mail-complete-v1", complete: true } };
    }
    else if (url.pathname.endsWith(`/address/${ADDRESS}/utxo`)) {
      json = [{ txid: funding.getId(), vout: 0, value: 100000,
        status: { confirmed: true, block_height: 969999, block_hash: HASH } }];
    } else if (url.pathname === `/api/v1/tx/${funding.getId()}/hex`) json = { hex: funding.toHex() };
    else if (url.pathname === "/api/v1/token" || url.pathname === "/api/v1/token-summary") {
      json = { source: "fixture", authoritativeWallet: true, walletScoped: true,
        tokens: [], holders: [], mints: [], transfers: [], listings: [], sales: [], invalidEvents: [] };
    } else if (url.pathname === "/api/v1/token-history") {
      json = { kind: url.searchParams.get("kind"), items: [], totalCount: 0, hasMore: false, nextCursor: "", indexedAt: NOW };
    } else if (url.pathname.endsWith("/status")) json = { status: "confirmed" };
    else if (url.pathname === "/api/v1/marketplace-summary") {
      json = { network: "livenet", indexedAt: NOW, registry: REGISTRY,
        token: { tokens: [], listings: [], sales: [], mints: [], holders: [], transfers: [] } };
    } else if (url.pathname === "/api/v1/dns" || url.pathname === "/api/v1/dns-summary") json = state.dnsRegistry;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(json) });
  });
  await page.route("**/pages-test-network/**", route => {
    state.external.push(route.request().url());
    return route.abort();
  });
  // Vite has no production response headers. Supply the same frame containment
  // and runner policy so an interactive preview is tested under its real boundary.
  // Full script-src 'self' is exercised when running against a built bundle;
  // Vite's React refresh bootstrap requires its development inline script.
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!request.isNavigationRequest() || url.pathname !== "/" && url.pathname !== "/pages-runner.html") return route.fallback();
    const response = await route.fetch();
    const policy = url.pathname === "/pages-runner.html" ? RUNNER_POLICY
      : process.env.POW_PLAYWRIGHT_PRODUCTION_BUILD === "1"
        ? "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:"
        : "frame-src 'self'; object-src 'none'; base-uri 'self'";
    return route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": policy, "referrer-policy": "no-referrer" } });
  });
  return state;
}

export async function connect(page) {
  const button = page.getByRole("button", { name: "Connect UniSat", exact: true });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator(".topbar-wallet-button")).toContainText(ADDRESS.slice(0, 8));
}

export async function expectNoSignature(page, state) {
  expect(await page.evaluate(() => window.__pagesFixture.signCalls)).toBe(0);
  expect(state.writes).toEqual([]);
}
