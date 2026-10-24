import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// Exact identity only: unsupported policies take the original unshared path.
function canonicalPolicy(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length || Object.getOwnPropertyNames(value).length !== value.length + 1) throw new Error('Unshareable wallet policy.');
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor)) throw new Error('Unshareable wallet policy.');
      return canonicalPolicy(descriptor.value);
    });
  }
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    if (Object.getOwnPropertySymbols(value).length) throw new Error('Unshareable wallet policy.');
    const result = Object.create(null);
    for (const key of Object.getOwnPropertyNames(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('Unshareable wallet policy.');
      result[key] = canonicalPolicy(descriptor.value);
    }
    return result;
  }
  throw new Error('Unshareable wallet policy.');
}
export function walletReadIdentity(network, scope, addresses, options) {
  try {
    if (network !== 'livenet' || typeof scope !== 'string' || scope.length > 256 || !Array.isArray(addresses) ||
        !addresses.length || addresses.length > 64 || !addresses.every(a => typeof a === 'string' && a.length && a.length <= 128 && a === a.trim()) ||
        !options || typeof options !== 'object' || Array.isArray(options)) return null;
    const encoded = JSON.stringify([network, scope, addresses, canonicalPolicy(options)]);
    if (Buffer.byteLength(encoded) > 65_536) return null;
    return createHash('sha256').update(encoded).digest('hex');
  } catch { return null; }
}

const requestScope = new AsyncLocalStorage();
const opaqueId = () => randomBytes(16).toString('hex');
function safeId(makeId = opaqueId) {
  try { const id = makeId(); return /^[0-9a-f]{32}$/u.test(id) ? id : null; } catch { return null; }
}
export function privateReadContext() {
  const context = requestScope.getStore();
  return context ? { ...context, readClass: context.readClass ? { ...context.readClass } : undefined } : {};
}
export function setPrivateReadClass({ wallet, fresh, summary, tokenClass, addressCount, classification }) {
  const context = requestScope.getStore();
  if (context) context.readClass = Object.freeze({ wallet: wallet === true, fresh: fresh === true,
    summary: summary === true, classification: classification === 'resolved-wallet' ? 'resolved-wallet' : 'request-parameters', tokenClass: ['work', 'all'].includes(tokenClass) ? tokenClass : 'other',
    addressCount: Number.isSafeInteger(addressCount) ? Math.max(0, Math.min(64, addressCount)) : 0 });
}
export function withPrivateRequestContext(run, { makeId = opaqueId } = {}) {
  const requestId = safeId(makeId);
  return requestId ? requestScope.run({ requestId, work: 'request' }, run) : run();
}
export function observePrivateHttpRequest(request, response, handle, { observer = receipt => console.log(JSON.stringify(receipt)), makeId = opaqueId } = {}) {
  return withPrivateRequestContext(() => {
    const context = requestScope.getStore();
    const started = Date.now();
    let route = 'other';
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (['/health', '/api/v1/token', '/api/v1/token-summary', '/api/v1/token-history', '/api/v1/marketplace-summary', '/api/v1/health',
        '/api/v1/registry', '/api/v1/ids', '/api/v1/dns', '/api/v1/dns-summary', '/api/v1/log', '/api/v1/log-summary',
        '/api/v1/activity', '/api/v1/activity-summary', '/api/v1/work-summary', '/api/v1/work-floor', '/api/v1/growth-summary',
        '/api/v1/internal/canonical-summary', '/api/v1/internal/pending-work-verifier-stage'].includes(path)) route = path;
    } catch { /* An invalid request remains the handler's responsibility. */ }
    const emit = interrupted => {
      try {
        const contentLength = Number(response.getHeader('content-length'));
        const elapsedMs = Date.now() - started;
        const receipt = { event: interrupted ? 'http-response-interrupted-observation' : 'http-response-observation',
          method: ['GET', 'POST', 'OPTIONS', 'HEAD'].includes(request.method) ? request.method : 'other', route,
          status: interrupted && !response.headersSent ? null : response.statusCode, elapsedMs,
          payloadBytes: interrupted ? null : Number.isSafeInteger(contentLength) ? contentLength : null,
          ...(interrupted ? { headersSent: response.headersSent, outcome: 'transport-close-before-finish' } : { slow: elapsedMs >= 10000 }),
          ...(context ? { ...context } : {}) };
        const result = observer(Object.freeze(receipt));
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch { /* Observation never alters the response. */ }
    };
    response.once('finish', () => emit(false));
    response.once('close', () => { if (!response.writableFinished) emit(true); });
    return handle(request, response);
  }, { makeId });
}

export function createWalletReadCoalescer({ makeId = opaqueId, observer = defaultObserver } = {}) {
  const flights = new Map();
  return async (identity, load) => {
    if (typeof identity !== 'string' || !/^[0-9a-f]{64}$/u.test(identity)) identity = null;
    let flight = identity ? flights.get(identity) : null;
    if (!flight) {
      if (!identity || flights.size >= 4) {
        observeFlight(null, 'unshared');
        return structuredClone(await load());
      }
      const flightId = safeId(makeId);
      observeFlight(flightId, 'owner');
      const context = { ...privateReadContext(), ...(flightId ? { flightId } : {}), role: 'owner', work: 'owned-flight' };
      flight = Promise.resolve().then(() => requestScope.run(context, load));
      flight.privateId = flightId;
      flights.set(identity, flight);
      const clear = () => { if (flights.get(identity) === flight) flights.delete(identity); };
      // Remove settled positives and negatives before any receipt escapes.
      flight.then(clear, clear);
    } else observeFlight(flight.privateId, 'joiner');
    return structuredClone(await flight);
  };
  function observeFlight(flightId, role) {
    try {
      const context = requestScope.getStore();
      if (context) { context.role = role; if (flightId) context.flightId = flightId; else delete context.flightId; }
      const result = observer(Object.freeze({ event: 'private-wallet-read-flight', ...privateReadContext(),
        ...(flightId ? { flightId } : {}), role }));
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch { /* Sharing and cleanup do not depend on diagnostics. */ }
  }
}

const phases = new Set([
  'snapshot-client-wait', 'snapshot-open', 'snapshot-assembly', 'snapshot-sql-wait',
  'full-audit-queue-wait', 'full-audit-execution', 'wallet-supply', 'wallet-capacity',
  'closing-core', 'closing-mempool', 'confirmed-scan', 'confirmed-barrier',
  'confirmed-replay', 'confirmed-summary', 'pending-status', 'pending-scan',
  'pending-plan', 'pending-verifier', 'pending-persistence',
  'ledger-source-activity', 'ledger-source-registry', 'ledger-source-dns',
  'ledger-source-price', 'ledger-source-token-table', 'ledger-source-market-overlay',
]);
const timingScope = new AsyncLocalStorage();
const defaultObserver = receipt => console.warn(JSON.stringify(receipt));
export async function withPrivatePhaseTimings(run, observer = defaultObserver) {
  const context = privateReadContext();
  const existing = timingScope.getStore();
  if (existing && existing.work === context.work && existing.flightId === context.flightId) return run();
  const totals = new Map();
  try { return await timingScope.run({ totals, work: context.work, flightId: context.flightId }, run); }
  finally {
    try {
      const observed = observer(Object.freeze({ event: 'private-wallet-worker-phase-timing', ...privateReadContext(), phases:
        Object.freeze(Object.fromEntries([...totals].map(([name, value]) => [name, Object.freeze(value)]))) }));
      if (observed && typeof observed.catch === 'function') observed.catch(() => {});
    } catch { /* Observation cannot alter readiness or operation results. */ }
  }
}
export async function measurePrivatePhase(name, run) {
  if (!phases.has(name)) return run();
  const scope = timingScope.getStore();
  if (!scope) return withPrivatePhaseTimings(() => measurePrivatePhase(name, run));
  const totals = scope.totals;
  const started = performance.now();
  try { return await run(); }
  finally {
    const previous = totals.get(name) ?? { count: 0, elapsedMs: 0 };
    totals.set(name, { count: Math.min(1_000_000, previous.count + 1),
      elapsedMs: Math.min(86_400_000, previous.elapsedMs + Math.max(0, performance.now() - started)) });
  }
}
