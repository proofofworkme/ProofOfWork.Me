import { measurePrivatePhase, privateReadContext } from "../wallet-read-observation.mjs";

// Conservative shape labels only. Neither SQL nor parameters leave the facade.
export function privateSnapshotQueryKind(sql) {
  if (/MIGRATION\.VALUE AS MIGRATION_MARKER/u.test(sql) && /DEFINITION\.MAX_SUPPLY::TEXT/u.test(sql) && /AS TRANSITION_HEIGHT/u.test(sql)) return "full-readiness-audit";
  if (/MIGRATION_MARKER AS \(/u.test(sql) && /LATEST_TRANSITION AS \(/u.test(sql) && /CANONICAL_TIP AS \(/u.test(sql)) return "readiness-compact";
  if (/INFORMATION_SCHEMA\.|(?:FROM|JOIN) (?:PG_CATALOG\.)?PG_(?:ATTRIBUTE|CLASS|NAMESPACE)\b/u.test(sql)) return "catalogue";
  if (/FROM PROOF_INDEXER\.CREDIT_BALANCES CB\b/u.test(sql) && /CB\.ADDRESS = ANY\(/u.test(sql)) return "wallet-overlay";
  if (/CANONICAL_WORK_WALLET_CAPACITY_CHECKPOINT/u.test(sql) && /FROM PROOF_INDEXER\.WORK_AMO_BLOCK_TRANSITIONS TRANSITION\b/u.test(sql)) return "capacity";
  if (/AS MATCHING_SNAPSHOT_COUNT/u.test(sql) && /FROM PROOF_INDEXER\.LEDGER_SNAPSHOTS SNAPSHOT\b/u.test(sql)) return "summary";
  return "other";
}
// Only deadline exhaustion and PostgreSQL query cancellation become controlled
// unavailability. Other database and programming errors retain their identity.
export class ReadOnlySnapshotBudgetError extends Error {
  constructor(diagnostic) {
    super("Read-only snapshot budget unavailable.");
    this.name = "ReadOnlySnapshotBudgetError";
    this.diagnostic = Object.freeze(diagnostic);
  }
}
export function isReadOnlySnapshotBudgetError(error) {
  return error instanceof ReadOnlySnapshotBudgetError;
}

// A cancelled acquisition never leaks a late client back into work. Its owner
// releases the client when pg eventually resolves the connection attempt.
export async function acquireReadOnlySnapshotClient(pool, { deadline, signal, timeoutMs }) {
  let abandoned = false, timer, abort;
  const unavailable = (cause) => new ReadOnlySnapshotBudgetError({
    stage: "snapshot-client-wait", cause, elapsedMs: Math.max(0, timeoutMs - (deadline - Date.now())),
    remainingMs: Math.max(0, deadline - Date.now()), budgetMs: timeoutMs,
    ...privateReadContext(),
  });
  if (signal?.aborted || Date.now() >= deadline) throw unavailable(signal?.aborted ? "aborted" : "deadline");
  const pending = Promise.resolve().then(() => pool.connect()).then(client => {
    if (abandoned) { client.release(); throw unavailable("aborted"); }
    return client;
  });
  const cancelled = new Promise((_, reject) => {
    abort = () => { abandoned = true; reject(unavailable("aborted")); };
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { abandoned = true; reject(unavailable("deadline")); }, Math.max(1, deadline - Date.now()));
    if (signal?.aborted) abort();
  });
  try { return await Promise.race([pending, cancelled]); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

// One connection owns the snapshot. Existing reader helpers may borrow it,
// but their transaction boundaries must never commit the owning transaction.
export async function withReadOnlySnapshot(pool, read, { timeoutMs = 10_000, signal, deadlineAt } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error("Invalid read-only snapshot budget.");
  }
  const startedAt = Date.now();
  const deadline = deadlineAt === undefined ? startedAt + timeoutMs : deadlineAt;
  if (!Number.isSafeInteger(deadline) || deadline > startedAt + timeoutMs) throw new Error("Invalid snapshot deadline.");
  const client = await measurePrivatePhase("snapshot-client-wait", () =>
    acquireReadOnlySnapshotClient(pool, { deadline, signal, timeoutMs }));
  const pending = new Set();
  const leases = new Set();
  const queryStates = new Map();
  let activeQueryCount = 0;
  let closed = false, failed = false, opened = false, timer, releaseError;
  let abort, clientReleased = false;
  let querySequence = 0, budgetFailure;
  let timerDispatchedAt = null;
  let stage = "snapshot-open", queryId = 0;
  const budgetError = (cause, sqlState = null, failedQueryId = queryId) => new ReadOnlySnapshotBudgetError({
    stage, queryId: failedQueryId, cause, sqlState,
    elapsedMs: Math.max(0, timeoutMs - (deadline - Date.now())),
    remainingMs: Math.max(0, deadline - Date.now()), budgetMs: timeoutMs,
    ...privateReadContext(),
    queryIdMeaning: "last-dispatched-ordinal",
    timerDispatchLagMs: timerDispatchedAt === null ? null : Math.min(86_400_000, Math.max(0, timerDispatchedAt - deadline)),
    deadlineOverrunMs: Math.min(86_400_000, Math.max(0, Date.now() - deadline)),
    currentWork: activeQueryCount ? "pending-client-query" : stage === "snapshot-query" || stage === "snapshot-callback" ? "application-callback" : stage,
    pendingQueryCount: Math.min(1_000_000, activeQueryCount),
    pendingQueryOverflow: activeQueryCount > queryStates.size,
    pendingQueries: Object.freeze([...queryStates.values()].map(({ ordinal, kind, phase, phaseStartedAt }) => Object.freeze({ ordinal, kind, phase,
      phaseElapsedMs: Math.min(86_400_000, Math.max(0, Date.now() - phaseStartedAt)) }))),
  });
  const unavailable = () => Date.now() >= deadline
    ? budgetError("deadline") : new Error("Read-only snapshot unavailable.");
  const query = async (...args) => {
    if (closed || failed || Date.now() >= deadline) throw unavailable();
    const sql = String(typeof args[0] === "string" ? args[0] : args[0]?.text ?? "")
      .trim().replace(/\s+/gu, " ").replace(/;$/u, "").toUpperCase();
    if (/^(?:BEGIN|START TRANSACTION|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|PREPARE TRANSACTION|SET TRANSACTION)\b/u.test(sql)) {
      failed = true;
      throw unavailable();
    }
    stage = "snapshot-query";
    queryId = ++querySequence;
    const currentQueryId = queryId;
    const queryState = { ordinal: Math.min(1_000_000, currentQueryId), kind: privateSnapshotQueryKind(sql), phase: "statement-timeout-client-wait", phaseStartedAt: Date.now() };
    activeQueryCount++;
    if (queryStates.size < 8) queryStates.set(currentQueryId, queryState);
    const remainingMs = Math.max(1, deadline - Date.now());
    const work = measurePrivatePhase("snapshot-sql-wait", async () => {
      await Promise.race([client.query(`SET LOCAL statement_timeout = '${remainingMs}ms'`), timeout]);
      if (closed || failed || Date.now() >= deadline) throw unavailable();
      queryState.phase = "sql-client-wait";
      queryState.phaseStartedAt = Date.now();
      return Promise.race([client.query(...args), timeout]);
    });
    pending.add(work);
    try { return await work; }
    catch (error) {
      failed = true;
      if (error?.code === "57014") {
        budgetFailure = budgetError("query-cancelled", "57014", currentQueryId);
        throw budgetFailure;
      }
      if (isReadOnlySnapshotBudgetError(error)) budgetFailure = error;
      throw error;
    }
    finally { pending.delete(work); queryStates.delete(currentQueryId); activeQueryCount--; }
  };
  const snapshotPool = {
    query,
    async connect() {
      if (closed || failed) throw unavailable();
      let transaction = false, released = false;
      const lease = {
        async query(...args) {
          if (released || closed || failed) throw unavailable();
          const sql = String(typeof args[0] === "string" ? args[0] : args[0]?.text ?? "")
            .trim().replace(/\s+/gu, " ").replace(/;$/u, "").toUpperCase();
          if (/^BEGIN(?: TRANSACTION)? ISOLATION LEVEL REPEATABLE READ READ ONLY$/u.test(sql)) {
            if (transaction) { failed = true; throw unavailable(); }
            transaction = true;
            return { rows: [], rowCount: 0 };
          }
          if (sql === "COMMIT" && transaction) {
            transaction = false;
            return { rows: [], rowCount: 0 };
          }
          if (sql === "ROLLBACK") {
            transaction = false;
            failed = true;
            return { rows: [], rowCount: 0 };
          }
          return query(...args);
        },
        release() {
          if (transaction) failed = true;
          released = true;
          leases.delete(lease);
        },
      };
      leases.add(lease);
      return lease;
    },
  };
  // Arm cancellation before BEGIN, and retain it through COMMIT/ROLLBACK.
  // Destroying this exclusively owned client rolls back its read-only session
  // and prevents a stalled setup/control query from escaping the deadline.
  const timeout = new Promise((_, reject) => {
    const terminate = cause => {
      closed = true;
      const error = budgetError(cause);
      if (!clientReleased) { clientReleased = true; client.release(error); }
      reject(error);
    };
    abort = () => terminate("aborted");
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { timerDispatchedAt = Date.now(); terminate("deadline"); }, Math.max(1, deadline - Date.now()));
    if (signal?.aborted || Date.now() >= deadline) terminate(signal?.aborted ? "aborted" : "deadline");
  });
  timeout.catch(() => {});
  const controlQuery = sql => Promise.race([
    Promise.resolve().then(() => {
      if (clientReleased) throw unavailable();
      return client.query(sql);
    }), timeout,
  ]);
  try {
    await measurePrivatePhase("snapshot-open", () => controlQuery("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
    opened = true;
    const openingRemainingMs = Math.max(1, deadline - Date.now());
    await controlQuery(`SET LOCAL statement_timeout = '${openingRemainingMs}ms'`);
    await controlQuery(`SET LOCAL idle_in_transaction_session_timeout = '${openingRemainingMs}ms'`);
    stage = "snapshot-callback";
    const result = await Promise.race([Promise.resolve().then(() => measurePrivatePhase("snapshot-assembly", () => read(snapshotPool))), timeout]);
    closed = true;
    await Promise.allSettled([...pending]);
    if (budgetFailure) throw budgetFailure;
    if (failed || leases.size || Date.now() >= deadline || signal?.aborted) throw unavailable();
    stage = "snapshot-commit";
    await controlQuery("COMMIT");
    opened = false;
    return result;
  } finally {
    closed = true;
    await Promise.allSettled([...pending]);
    if (opened && !clientReleased) await controlQuery("ROLLBACK").catch((error) => { releaseError = error; });
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (!clientReleased) { clientReleased = true; client.release(releaseError); }
  }
}
