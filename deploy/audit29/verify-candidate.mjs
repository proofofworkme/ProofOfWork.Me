// Run only through the private, source-bound deployment launcher. All HTTP
// application requests are GET; the only Core RPCs are the fixed reads below.
// Credentials remain in the inherited private environment and are never saved.
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFile, mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createProofIndexPool, proofIndexDatabaseUrl } from "../../server/db/postgres.mjs";
import { CANONICAL_WORK_WALLET_CAPACITY_MODEL } from "../../server/work-wallet-capacity.mjs";
import { closeProofIndexReadPool, compareProofIndexRegistryPayloads,
  proofIndexRegistryPayload } from "../../server/db/proof-index-reader.mjs";
import { decimalQ8, digest, inventory, requireFact, verifyBookPair }
  from "../audit5/probe-candidate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HEX = /^[0-9a-f]{64}$/u;
const WORK = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const GATES = { ids: "scripts/audit-id-registry.mjs", events: "scripts/audit-computer-events.mjs",
  parity: "scripts/check-proof-indexer-parity.mjs" };
const LIMITS = Object.freeze({ pageRows: 200, pagesPerInventory: 32, listingRows: 2000,
  httpRequests: 96, coreRequests: 2100, bodyBytes: 32 * 1024 ** 2,
  httpBytes: 192 * 1024 ** 2, gateBytes: 64 * 1024 ** 2, milliseconds: 900_000 });
const execute = promisify(execFile);

async function requireBackupQuiet() {
  const options = { timeout: 10_000, maxBuffer: 4096,
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } };
  const { stdout } = await execute("/usr/bin/systemctl", ["show",
    "proofofwork-postgres-logical-backup.service", "--property=ActiveState",
    "--property=SubState", "--property=MainPID"], options);
  const state = Object.fromEntries(stdout.trim().split("\n").map((line) => line.split("=")));
  requireFact(state.ActiveState === "inactive" && state.SubState === "dead" && state.MainPID === "0",
    "LOGICAL_BACKUP_NOT_QUIET");
  let noDump = false;
  try { await execute("/usr/bin/pgrep", ["-x", "pg_dump"], options); }
  catch (error) { noDump = error.code === 1; }
  requireFact(noDump, "PG_DUMP_WRITER_PRESENT_OR_UNCHECKABLE");
  return { checkedAt: new Date().toISOString(), inactive: true, noPgDumpWriter: true };
}

export function checkedBase(value, internal = false) {
  const url = new URL(value);
  const loopback = url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) &&
    ["8081", "18081"].includes(url.port);
  const publicOrigin = url.protocol === "https:" &&
    ["api.proofofwork.me", "computer.proofofwork.me", "proofofwork.me", "www.proofofwork.me"].includes(url.hostname) && !url.port;
  requireFact((loopback || (!internal && publicOrigin)) && !url.username && !url.password &&
    url.pathname === "/" && !url.search && !url.hash, "REFUSED_API_ORIGIN");
  return url.origin;
}

export function checkedRole(mode, base, authority) {
  const surface = new URL(checkedBase(base));
  const guarded = new URL(checkedBase(authority, true));
  requireFact(mode === "shadow" || mode === "production", "REFUSED_VERIFICATION_MODE");
  requireFact(mode === "shadow"
    ? surface.protocol === "http:" && surface.port === "18081" && guarded.port === "18081"
    : guarded.port === "8081" && (surface.protocol === "https:" || surface.port === "8081"),
  "API_ROLE_ORIGIN_MISMATCH");
  return { mode, base: surface.origin, authority: guarded.origin };
}

export function readonlyEnvironment(original, authorityBase) {
  requireFact(!original.LD_PRELOAD && !original.LD_LIBRARY_PATH &&
    String(original.NODE_OPTIONS ?? "").split(/\s+/u).filter(Boolean).every((option) =>
      /^--(?:max-old-space-size|max-semi-space-size|stack-size)=[1-9][0-9]*$/u.test(option)),
  "REFUSED_INHERITED_CODE_LOADER");
  const db = new URL(proofIndexDatabaseUrl(original));
  requireFact(["postgres:", "postgresql:"].includes(db.protocol), "REFUSED_DATABASE_URL");
  const options = db.searchParams.get("options") ?? "";
  db.searchParams.set("options", `${options} -c default_transaction_read_only=on -c lock_timeout=5000 -c idle_in_transaction_session_timeout=30000`);
  return { ...original, NETWORK: "livenet", POW_API_BASE: authorityBase,
    PATH: "/opt/node-v24.18.0-linux-x64/bin:/usr/bin:/bin", NODE_DISABLE_COMPILE_CACHE: "1",
    POW_INDEX_DATABASE_URL: db.toString(), PROOF_INDEX_DATABASE_URL: "", DATABASE_URL: "",
    POW_INDEX_DB_POOL_MAX: "1", POW_INDEX_DB_STATEMENT_TIMEOUT_MS: "30000",
    POW_INDEX_DB_APP_NAME: "audit29-candidate-readonly", POW_INDEX_PARITY_STRICT: "1",
    POW_INDEX_FETCH_TIMEOUT_MS: "120000", POW_INDEX_FETCH_RETRIES: "0",
    POW_INDEX_PARITY_ACTIVITY_SNAPSHOT: "0", POW_INDEX_PARITY_LOG_FRESH: "0",
    POW_INDEX_PARITY_SNAPSHOT_FRESH: "0", POW_INDEX_PARITY_TOKEN_FRESH: "0",
    POW_ID_AUDIT_API_BASE: authorityBase, POW_ID_AUDIT_ADDRESS_API_BASE: authorityBase,
    POW_ID_AUDIT_PRODUCTION: "1", POW_ID_AUDIT_WRITE_REPORTS: "0", POW_ID_AUDIT_RETRIES: "0",
    POW_ID_AUDIT_TIMEOUT_MS: "60000", POW_ID_AUDIT_COVERAGE_TIMEOUT_MS: "600000",
    COMPUTER_AUDIT_REQUEST_TIMEOUT_MS: "120000", COMPUTER_AUDIT_FRESH_HISTORY: "0",
    MAX_LEDGER_TIP_LAG_BLOCKS: "0" };
}

export function sameTip(a, b) {
  return Number.isSafeInteger(a?.height) && a.height > 0 && HEX.test(a.hash ?? "") &&
    a.height === b?.height && a.hash === b?.hash;
}

export function verifyPendingDates(canonical, indexed) {
  const parity = compareProofIndexRegistryPayloads(canonical, indexed);
  requireFact(Object.values(parity.confirmed).every((items) => items.length === 0) &&
    Object.values(parity.pending).every((items) => items.length === 0), "REGISTRY_SEMANTIC_PARITY_FAILED");
  const pending = (canonical.records ?? []).filter((row) => row.confirmed !== true);
  const indexedByTx = new Map((indexed.records ?? []).filter((row) => row.confirmed !== true)
    .map((row) => [row.txid, row]));
  requireFact(indexedByTx.size === pending.length, "PENDING_MEMBERSHIP_CHANGED");
  for (const row of pending) {
    const other = indexedByTx.get(row.txid);
    requireFact(other && row.createdAt === other.createdAt &&
      row.createdAtSource === "proof-indexer-retained-event-time" &&
      row.indexedEventTime === row.createdAt && other.indexedEventTime === other.createdAt &&
      row.indexedFirstSeenAt === other.indexedFirstSeenAt &&
      row.mempoolAcceptedAtSource === "bitcoin-core-getmempoolentry" &&
      Number.isFinite(Date.parse(row.mempoolAcceptedAt)), "PENDING_TIMESTAMP_PROVENANCE_FAILED");
  }
  return { pendingRecords: pending.length, historicalAuditBaseline: 20,
    deltaFromAuditBaseline: pending.length - 20, recordsSha256: digest(pending),
    confirmedRecords: (canonical.records ?? []).filter((row) => row.confirmed === true).length,
    qualification: "Retained indexed event time is checked separately from current Core admission; it is not proof of first-ever network observation." };
}

export function verifyWalletResponse(status, payload, address, tip) {
  requireFact(sameTip(tip, tip), "WALLET_CHECKPOINT_INVALID");
  if (status === 503) {
    requireFact(payload?.ok === false &&
      payload.error === `Fresh wallet credit state is temporarily unavailable for ${WORK}.` &&
      Object.keys(payload).length === 3 &&
      payload?.details?.code === "CANONICAL_WALLET_INDEX_UNAVAILABLE" &&
      payload.details.requiredSource === "proof-indexer-wallet-token-overlay" &&
      Object.keys(payload.details).length === 2, "UNQUALIFIED_WALLET_UNAVAILABLE");
    return { ready: false, balanceVerified: false, capacityVerified: false, status,
      verificationStatus: "known-unresolved-availability", code: payload.details.code,
      requiredSource: payload.details.requiredSource, payloadSha256: digest(payload),
      knownIssueGroups: ["H24-01", "AUD26-02", "AUD26-03", "PERF-27"],
      qualification: "The exact existing fail-closed unavailable response is retained as unresolved availability. Neither wallet balance nor transfer capacity passed verification; inspect bounded private wallet-token-overlay-unavailable diagnostics." };
  }
  requireFact(status === 200 && payload.authoritativeWallet === true &&
    payload.indexedThroughBlock === tip.height && payload.indexedThroughBlockHash === tip.hash,
  "WALLET_AUTHORITY_OR_CHECKPOINT_FAILED");
  const rows = (payload.holders ?? []).filter((row) => row.address === address && row.tokenId === WORK);
  const capacities = (payload.canonicalWorkCapacities ?? []).filter((row) => row.address === address);
  requireFact(rows.length === 1 && capacities.length === 1, "WALLET_EXACT_CAPACITY_MISSING");
  const capacity = capacities[0];
  requireFact(capacity.model === CANONICAL_WORK_WALLET_CAPACITY_MODEL &&
    capacity.network === "livenet" && capacity.tokenId === WORK &&
    capacity.indexedThroughBlock === tip.height && capacity.indexedThroughBlockHash === tip.hash,
  "WALLET_CAPACITY_SCOPE_FAILED");
  const exact = (value) => { requireFact(typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value), "WALLET_INTEGER_INEXACT"); return BigInt(value); };
  const confirmed = exact(capacity.confirmedBalanceSubatoms);
  const spendable = exact(capacity.transferableBalanceSubatoms);
  const reserved = exact(capacity.reservedBalanceSubatoms);
  requireFact(confirmed === exact(rows[0].balanceSubatoms) && confirmed === spendable + reserved,
    "WALLET_BALANCE_CONSERVATION_FAILED");
  return { ready: true, balanceVerified: true, capacityVerified: true,
    verificationStatus: "passed", status, confirmedBalanceSubatoms: confirmed.toString(),
    spendableBalanceSubatoms: spendable.toString(), reservedBalanceSubatoms: reserved.toString(),
    pendingDeltaSubatoms: rows[0].pendingDeltaSubatoms, payloadSha256: digest(payload) };
}

export function verifyFencedWalletRead(status, payload, address, before, after) {
  requireFact(sameTip(before, after), "CORE_CHECKPOINT_MOVED");
  return { ...verifyWalletResponse(status, payload, address, before),
    checkpoint: { before, after, stable: true } };
}

async function runChild(script, env, remaining) {
  const child = spawn(process.execPath, ["--max-old-space-size=1024", script],
    { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = []; let bytes = 0; let exceeded = false; let stderrBytes = 0;
  const timer = setTimeout(() => { exceeded = true; child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 1000).unref(); }, Math.min(600_000, remaining()));
  child.stdout.on("data", (part) => { bytes += part.length;
    if (bytes > LIMITS.gateBytes) { exceeded = true; child.kill("SIGKILL"); }
    else stdout.push(part); });
  child.stderr.on("data", (part) => { stderrBytes += part.length;
    if (stderrBytes > LIMITS.gateBytes) { exceeded = true; child.kill("SIGKILL"); } });
  try {
    const exitCode = await new Promise((done, reject) => {
      child.once("error", reject); child.once("close", done);
    });
    requireFact(!exceeded, "GATE_TIME_OR_OUTPUT_BUDGET_EXCEEDED");
    const raw = Buffer.concat(stdout);
    // No child log or raw exception is persisted: it could contain connection
    // details. Only parsed check names/statuses, byte counts and digests escape.
    return { exitCode, raw, stdoutBytes: bytes, stderrBytes,
      stdoutSha256: createHash("sha256").update(raw).digest("hex") };
  } finally { clearTimeout(timer); }
}

async function verifyCheckout(candidate) {
  const child = spawn("/usr/bin/git", ["-c", `safe.directory=${ROOT}`, "-C", ROOT,
    "rev-parse", "HEAD", "HEAD^{tree}"], { stdio: ["ignore", "pipe", "ignore"],
    env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0" } });
  let result = "";
  child.stdout.on("data", (part) => { result += part.toString("utf8");
    if (result.length > 1024) child.kill("SIGKILL"); });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try { const code = await new Promise((done, reject) => {
    child.once("error", reject); child.once("close", done);
  });
    requireFact(code === 0 && result.trim() === `${candidate.commit}\n${candidate.tree}`,
      "CANDIDATE_CHECKOUT_IDENTITY_MISMATCH");
    try { await execute("/usr/bin/git", ["-c", `safe.directory=${ROOT}`, "-C", ROOT,
      "diff", "--quiet", "HEAD", "--"], { timeout: 10_000, maxBuffer: 4096,
      env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0" } }); }
    catch { throw new Error("CANDIDATE_TRACKED_SOURCE_CHANGED"); }
  } finally { clearTimeout(timer); }
}

async function makeIO(base, authority, remaining, report) {
  let httpCalls = 0; let coreCalls = 0; let bytes = 0;
  const token = process.env.POW_INTERNAL_VERIFIER_TOKEN ?? "";
  requireFact(token.length >= 32, "PRIVATE_VERIFIER_TOKEN_REQUIRED");
  const rpc = new URL(process.env.BITCOIN_RPC_URL ?? "");
  requireFact(rpc.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(rpc.hostname) &&
    !rpc.username && !rpc.password && process.env.BITCOIN_RPC_USER && process.env.BITCOIN_RPC_PASSWORD,
  "LOCAL_PRIVATE_CORE_REQUIRED");
  async function body(response, budget) {
    const parts = []; let size = 0;
    for await (const part of response.body) { size += part.length; bytes += part.length;
      requireFact(size <= budget && bytes <= LIMITS.httpBytes, "READ_BYTE_BUDGET_EXCEEDED"); parts.push(part); }
    return Buffer.concat(parts);
  }
  async function getStatus(path, privateRead = false) {
    requireFact(++httpCalls <= LIMITS.httpRequests, "HTTP_REQUEST_BUDGET_EXCEEDED");
    const origin = privateRead ? authority : base;
    const url = new URL(path, origin);
    requireFact(url.origin === origin && url.pathname.startsWith("/api/v1/"), "REFUSED_HTTP_PATH");
    const response = await fetch(url, { method: "GET", redirect: "error",
      signal: AbortSignal.timeout(Math.min(privateRead ? 600_000 : 120_000, remaining())),
      headers: privateRead ? { "X-PoW-Internal-Verifier": token } : {} });
    const raw = await body(response, LIMITS.bodyBytes);
    report.reads.push({ route: url.pathname, status: response.status, bytes: raw.length,
      sha256: createHash("sha256").update(raw).digest("hex") });
    return { status: response.status, payload: JSON.parse(raw.toString("utf8")) };
  }
  return {
    getStatus,
    async get(path) { const result = await getStatus(path); requireFact(result.status === 200,
      `HTTP_${result.status}`); return result.payload; },
    async core(method, params = []) {
      requireFact(["getblockchaininfo", "gettxout"].includes(method) && ++coreCalls <= LIMITS.coreRequests,
        "CORE_METHOD_OR_REQUEST_BUDGET_EXCEEDED");
      const response = await fetch(rpc, { method: "POST", redirect: "error",
        signal: AbortSignal.timeout(Math.min(15_000, remaining())),
        headers: { "Content-Type": "application/json", Authorization: "Basic " +
          Buffer.from(`${process.env.BITCOIN_RPC_USER}:${process.env.BITCOIN_RPC_PASSWORD}`).toString("base64") },
        body: JSON.stringify({ jsonrpc: "2.0", id: coreCalls, method, params }) });
      const raw = await body(response, 1024 * 1024);
      requireFact(response.ok, "CORE_READ_UNAVAILABLE");
      const json = JSON.parse(raw.toString("utf8")); requireFact(!json.error, "CORE_READ_REFUSED");
      if (method === "gettxout" && json.result) {
        const matches = [...raw.toString("utf8").matchAll(/"value"\s*:\s*(\d+(?:\.\d+)?)(?=\s*[,}])/gu)];
        requireFact(matches.length === 1, "CORE_VALUE_LEXEME_MISSING");
        json.result.exactValueProofs = decimalQ8(matches[0][1]).toString();
      }
      return json.result;
    },
    counters: () => ({ httpCalls, coreCalls, bytes }),
  };
}

async function main() {
  requireFact(process.version === "v24.18.0" && process.versions.unicode === "17.0", "PINNED_NODE_UNICODE_REQUIRED");
  const argv = process.argv.slice(2); const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    requireFact(argv[index]?.startsWith("--") && argv[index + 1] && !(argv[index] in args), "INVALID_ARGUMENTS");
    args[argv[index]] = argv[index + 1];
  }
  requireFact(Object.keys(args).length === 8 && ["--mode", "--base-url", "--authority-base-url", "--output",
    "--wallet-address", "--candidate-commit", "--candidate-tree", "--runtime-sha256"].every((key) => args[key]), "INVALID_ARGUMENTS");
  const base = checkedBase(args["--base-url"]); const authority = checkedBase(args["--authority-base-url"], true);
  const mode = checkedRole(args["--mode"], base, authority).mode;
  requireFact(mode === "shadow" ? ROOT.startsWith("/opt/proofofwork-api-stage-")
    : ROOT === "/opt/proofofwork-api", "CHECKOUT_ROLE_MISMATCH");
  const candidate = { commit: args["--candidate-commit"], tree: args["--candidate-tree"], runtimeSha256: args["--runtime-sha256"] };
  requireFact(/^[0-9a-f]{40}$/u.test(candidate.commit) && /^[0-9a-f]{40}$/u.test(candidate.tree) &&
    HEX.test(candidate.runtimeSha256), "INVALID_CANDIDATE_BINDING");
  const address = args["--wallet-address"];
  requireFact(/^[a-zA-Z0-9]{26,100}$/u.test(address), "INVALID_WALLET_ADDRESS");
  const output = resolve(args["--output"]);
  requireFact(output === args["--output"] && await realpath(dirname(output)) === dirname(output), "REFUSED_OUTPUT_PATH");
  await mkdir(output, { mode: 0o700 });
  const report = { format: "audit29-candidate-readonly-v1", ok: false, network: "livenet",
    startedAt: new Date().toISOString(), candidate, mode, base, authority, limits: LIMITS,
    gates: { ids: false, events: false, parity: false }, gateReceipts: {}, reads: [], backupQuietChecks: [],
    qualification: "Candidate runtime identity is supplied by the guarded launcher and separately bound by the release controller; this driver performs no signing, broadcast, replay repair or data writes." };
  const started = Date.now(); let io; let readTip;
  const remaining = () => { const time = LIMITS.milliseconds - (Date.now() - started);
    requireFact(time > 0, "OVERALL_TIME_BUDGET_EXCEEDED"); return time; };
  try {
    await verifyCheckout(candidate);
    report.backupQuietChecks.push(await requireBackupQuiet());
    const env = readonlyEnvironment(process.env, authority);
    for (const key of Object.keys(env)) if (key.startsWith("POW_") || key === "NETWORK" ||
      ["PROOF_INDEX_DATABASE_URL", "DATABASE_URL", "MAX_LEDGER_TIP_LAG_BLOCKS", "COMPUTER_AUDIT_REQUEST_TIMEOUT_MS", "COMPUTER_AUDIT_FRESH_HISTORY"].includes(key)) process.env[key] = env[key];
    const pool = createProofIndexPool({ env });
    try { const probe = await pool.query("SELECT current_setting('transaction_read_only') AS read_only, current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout");
      requireFact(probe.rows[0]?.read_only === "on" && ["30s", "30000"].includes(probe.rows[0]?.statement_timeout) &&
        ["5s", "5000"].includes(probe.rows[0]?.lock_timeout), "READONLY_SQL_PREFLIGHT_FAILED"); }
    finally { await pool.end(); }
    io = await makeIO(base, authority, remaining, report);
    readTip = async () => { const core = await io.core("getblockchaininfo");
      requireFact(core.chain === "main" && core.initialblockdownload === false, "CORE_NOT_HEALTHY");
      return { height: core.blocks, hash: core.bestblockhash }; };
    const before = await readTip(); report.checkpointBefore = before;
    requireFact(sameTip(before, before), "CORE_CHECKPOINT_INVALID");
    for (const [name, script] of Object.entries(GATES)) {
      report.backupQuietChecks.push(await requireBackupQuiet());
      const gateBefore = await readTip();
      const gateStartedAt = new Date().toISOString();
      const run = await runChild(script, env, remaining);
      const gateAfter = await readTip();
      const receipt = { exitCode: run.exitCode, stdoutBytes: run.stdoutBytes,
        stderrBytes: run.stderrBytes, stdoutSha256: run.stdoutSha256,
        scriptSha256: createHash("sha256").update(await readFile(resolve(ROOT, script))).digest("hex"),
        startedAt: gateStartedAt, completedAt: new Date().toISOString(),
        before: gateBefore, after: gateAfter, checkpointStable: sameTip(gateBefore, gateAfter) };
      report.gateReceipts[name] = receipt;
      let gateOk = run.exitCode === 0;
      if (name !== "ids") {
        try { const parsed = JSON.parse(run.raw.toString("utf8"));
          receipt.checks = (parsed.checks ?? []).map(({ name, ok, severity }) => ({ name, ok, severity }));
          receipt.checkCount = receipt.checks.length;
          gateOk = gateOk && parsed.ok === true &&
            (name !== "parity" || parsed.strict === true && receipt.checkCount === 102);
        } catch { gateOk = false; receipt.outputNotJson = true; }
      } else {
        const text = run.raw.toString("utf8");
        receipt.counts = Object.fromEntries(["Fetched transactions", "Confirmed winners", "Pending candidates",
          "Covered confirmed registry transactions", "Covered pending registry transactions"].map((label) =>
          [label, Number(text.match(new RegExp(`${label}: (\\d+)`))?.[1]) || 0]));
      }
      requireFact(receipt.checkpointStable && sameTip(before, gateAfter), "CORE_CHECKPOINT_MOVED");
      requireFact(gateOk, "STRICT_GATE_FAILED");
      requireFact(run.exitCode === 0, "READONLY_GATE_FAILED"); report.gates[name] = true;
    }
    const canonicalRead = await io.getStatus("/api/v1/internal/registry-parity?network=livenet", true);
    requireFact(canonicalRead.status === 200, "REGISTRY_AUTHORITY_UNAVAILABLE");
    const canonical = canonicalRead.payload;
    const authorityFence = canonical._powRegistryParityAuthority;
    requireFact(authorityFence?.model === "proof-registry-first-party-fenced-v1" &&
      sameTip(before, { height: authorityFence.core.before.height, hash: authorityFence.core.before.blockHash }) &&
      sameTip(before, { height: authorityFence.core.after.height, hash: authorityFence.core.after.blockHash }) &&
      authorityFence.pendingMempoolTime.beforeSha256 === authorityFence.pendingMempoolTime.afterSha256,
    "REGISTRY_CORE_FENCE_FAILED");
    report.pendingDates = verifyPendingDates(canonical, await proofIndexRegistryPayload("livenet"));
    const exactId = await io.get("/api/v1/ids/ross?network=livenet&current=1&fresh=1");
    requireFact(exactId.id === "ross" && exactId.record?.id === "ross" &&
      typeof exactId.record.confirmed === "boolean" &&
      (exactId.record.confirmed || exactId.status === "pending" && exactId.routable === false &&
        exactId.record.createdAtSource === "proof-indexer-retained-event-time" &&
        exactId.record.indexedEventTime === exactId.record.createdAt),
    "EXACT_ID_CURRENT_READ_FAILED");
    report.exactId = { id: "ross", confirmed: exactId.record.confirmed,
      status: exactId.status, payloadSha256: digest(exactId) };
    const walletBefore = await readTip();
    requireFact(sameTip(before, walletBefore), "CORE_CHECKPOINT_MOVED");
    const walletRead = await io.getStatus(`/api/v1/token?network=livenet&asset=WORK&wallet=1&fresh=1&address=${address}`);
    const walletAfter = await readTip();
    report.wallet = verifyFencedWalletRead(walletRead.status, walletRead.payload, address, walletBefore, walletAfter);
    report.backupQuietChecks.push(await requireBackupQuiet());
    const full = await inventory(io, "/api/v1/token-history", "book", { asset: "WORK", kind: "listings", projection: "full" });
    const display = await inventory(io, "/api/v1/token-history", "book", { asset: "WORK", kind: "listings", projection: "display-v1" });
    requireFact(full.first.indexedThroughBlock === before.height && full.first.indexedThroughBlockHash === before.hash,
      "LISTING_CHECKPOINT_MISMATCH");
    report.book = { ...verifyBookPair(full, display), fullPages: full.pages, displayPages: display.pages,
      historicalAuditBaseline: 999, deltaFromAuditBaseline: full.rows.length - 999 };
    const witnesses = [];
    for (const row of full.rows) {
      const auth = row.saleAuthorization;
      requireFact(row.tokenId === WORK && auth?.anchorType === "sale-ticket-v1" &&
        Number.isSafeInteger(auth.anchorVout) && auth.anchorVout >= 0, "LISTING_ANCHOR_IDENTITY_FAILED");
      const out = await io.core("gettxout", [row.listingId, auth.anchorVout, true]);
      requireFact(out && out.bestblock === before.hash && out.confirmations > 0 &&
        out.exactValueProofs === String(auth.anchorValueSats) && out.scriptPubKey?.hex === auth.anchorScriptPubKey,
      "LISTING_CORE_OUTPOINT_FAILED");
      witnesses.push([row.listingId, auth.anchorVout, out.exactValueProofs, out.scriptPubKey.hex]);
    }
    report.book.independentCoreAnchors = witnesses.length;
    report.book.independentCoreSha256 = digest(witnesses);
    const finalPage = await io.get("/api/v1/token-history?network=livenet&asset=WORK&kind=listings&projection=display-v1&limit=200&fresh=1");
    requireFact(finalPage.indexedThroughBlock === before.height && finalPage.indexedThroughBlockHash === before.hash &&
      finalPage.snapshotId === full.first.snapshotId && finalPage.totalCount === full.rows.length &&
      digest(finalPage.listingProjection) === digest(full.first.listingProjection) &&
      finalPage.listingAuthority?.checkedOutpointsSha256 === full.first.listingAuthority.checkedOutpointsSha256,
    "LISTING_MEMBERSHIP_CHANGED_DURING_CORE_CHECKS");
    report.book.membershipRecheckedAfterCore = true;
    const after = await readTip(); report.checkpointAfter = after;
    requireFact(sameTip(before, after), "CORE_CHECKPOINT_MOVED");
    report.stableCheckpoint = after;
    report.walletQualification = report.wallet.ready ? "exact-balance-and-capacity-verified"
      : "known-unresolved-availability-balance-and-capacity-not-verified";
    report.ok = true;
  } catch (error) {
    report.failure = /^[A-Z0-9_]+$/u.test(error?.message ?? "") ? error.message : "READONLY_VERIFICATION_FAILED";
    report.needsAttention = report.failure === "CORE_CHECKPOINT_MOVED" ? "moving-checkpoint-preserve-attempt-before-bounded-retry" : "review-preserved-receipt";
    process.exitCode = 1;
  } finally {
    if (readTip && !report.checkpointAfter) {
      try { report.checkpointAfter = await readTip();
        if (!sameTip(report.checkpointBefore, report.checkpointAfter)) {
          report.originalFailure = report.failure;
          report.failure = "CORE_CHECKPOINT_MOVED";
          report.needsAttention = "moving-checkpoint-preserve-attempt-before-bounded-retry";
        }
      } catch { report.finalCoreCheckpointUnavailable = true; }
    }
    await closeProofIndexReadPool(); report.completedAt = new Date().toISOString();
    if (io) report.counters = io.counters();
    await writeFile(resolve(output, "receipt.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ ok: report.ok, failure: report.failure ?? null, output }));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error("audit29_candidate status=refused"); process.exitCode = 1; });
}
