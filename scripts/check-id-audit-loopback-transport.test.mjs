import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import test from 'node:test';
import {
  auditConfiguration,
  fetchLoopbackAuditCoverageResponse,
  isExactLoopbackAuditCoverageUrl,
} from './audit-id-registry.mjs';

const token = 'fixture-internal-verifier-'.padEnd(40, 'x');
const path = '/api/v1/internal/id-registry-audit?network=livenet';
async function fixture(handler, run) {
  const sockets = new Set();
  const server = createServer(handler);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  const config = { apiBase, production: true, internalVerifierToken: token };
  try { return await run(config, `${apiBase}${path}`); }
  finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('only exact production numeric-loopback coverage and fence routes qualify', () => {
  const config = { apiBase: 'http://127.0.0.1:8081', production: true };
  assert.equal(isExactLoopbackAuditCoverageUrl(config.apiBase + path, config), true);
  assert.equal(isExactLoopbackAuditCoverageUrl(config.apiBase + path.replace('audit?', 'audit-fence?'), config), true);
  for (const url of [
    'http://localhost:8081' + path,
    'http://127.1:8081' + path,
    'http://[::1]:8081' + path,
    'http://127.0.0.1:8082' + path,
    'https://127.0.0.1:8081' + path,
    'http://user:password@127.0.0.1:8081' + path,
    config.apiBase + path + '#fragment',
    config.apiBase + path + '&network=livenet',
    config.apiBase + path + '&extra=1',
    config.apiBase + path.replace('network=livenet', 'network=testnet'),
    config.apiBase + '/api/v1/token?network=livenet',
    config.apiBase + '/api/v1/internal/id-registry-audit-extra?network=livenet',
  ]) assert.equal(isExactLoopbackAuditCoverageUrl(url, config), false, url);
  assert.equal(isExactLoopbackAuditCoverageUrl(config.apiBase + path, { ...config, production: false }), false);
  for (const apiBase of ['http://user:password@127.0.0.1:8081', config.apiBase + '?query=1', config.apiBase + '#fragment']) {
    assert.equal(isExactLoopbackAuditCoverageUrl(config.apiBase + path, { ...config, apiBase }), false);
  }
  assert.equal(isExactLoopbackAuditCoverageUrl('invalid', config), false);
});

test('a normalized path base qualifies only its exact two coverage paths', () => {
  const config = { apiBase: 'http://127.0.0.1:8081/operator', production: true };
  assert.equal(isExactLoopbackAuditCoverageUrl(config.apiBase + path, config), true);
  assert.equal(isExactLoopbackAuditCoverageUrl('http://127.0.0.1:8081' + path, config), false);
});

test('GET has exact verifier authorization, numeric peer and JSON body', async () => {
  await fixture((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, path);
    assert.equal(req.headers.accept, 'application/json');
    assert.equal(req.headers['x-pow-internal-verifier'], token);
    assert.equal(req.socket.remoteAddress, '127.0.0.1');
    assert.equal(req.headers.authorization, undefined);
    res.end(JSON.stringify({ network: 'livenet', exact: '10000000000000001' }));
  }, async (config, url) => {
    const response = await fetchLoopbackAuditCoverageResponse(url, config, 1000);
    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { network: 'livenet', exact: '10000000000000001' });
  });
});

test('delayed headers succeed within the same entire request budget', async () => {
  await fixture((req, res) => { setTimeout(() => res.end('{"ok":true}'), 50); }, async (config, url) => {
    assert.deepEqual(await (await fetchLoopbackAuditCoverageResponse(url, config, 500)).json(), { ok: true });
  });
});

test('header wait aborts, closes the owned connection and reports TimeoutError', async () => {
  let closed = false;
  await fixture((req, res) => { req.socket.on('close', () => { closed = true; }); }, async (config, url) => {
    await assert.rejects(fetchLoopbackAuditCoverageResponse(url, config, 40), { name: 'TimeoutError' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(closed, true);
  });
});

test('body activity cannot reset the absolute request deadline', async () => {
  await fixture((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"payload":"');
    const timer = setInterval(() => res.write('x'), 5);
    req.socket.on('close', () => clearInterval(timer));
  }, async (config, url) => {
    const start = performance.now();
    await assert.rejects(fetchLoopbackAuditCoverageResponse(url, config, 60), { name: 'TimeoutError' });
    assert.ok(performance.now() - start < 500);
  });
});

test('redirects are refused without forwarding verifier to another origin', async () => {
  let redirectTargetCalls = 0;
  await fixture((req, res) => { redirectTargetCalls++; res.end('{}'); }, async (otherConfig) => {
    await fixture((req, res) => { res.writeHead(302, { Location: otherConfig.apiBase + path }); res.end(); }, async (config, url) => {
      await assert.rejects(fetchLoopbackAuditCoverageResponse(url, config, 500), /redirects are refused/);
    });
  });
  assert.equal(redirectTargetCalls, 0);
});

test('non-2xx status is preserved without reading or exposing its private error body', async () => {
  await fixture((req, res) => { res.writeHead(503); res.write('private-error-fixture'); }, async (config, url) => {
    const response = await fetchLoopbackAuditCoverageResponse(url, config, 500);
    assert.deepEqual(response, { ok: false, status: 503 });
    assert.equal(response.json, undefined);
  });
});

test('declared body above64MiB is refused before its body is read', async () => {
  await fixture((req, res) => { res.writeHead(200, { 'Content-Length': 64 * 1024 * 1024 + 1 }); res.flushHeaders(); }, async (config, url) => {
    await assert.rejects(fetchLoopbackAuditCoverageResponse(url, config, 500), /byte bound exceeded/);
  });
});

test('actual chunked body above64MiB is refused and connection closed', async () => {
  await fixture(async (req, res) => {
    const chunk = Buffer.alloc(1024 * 1024, 120);
    for (let i = 0; i < 65 && !res.destroyed; i++) {
      if (!res.write(chunk)) await new Promise((resolve) => {
        const done = () => {
          res.removeListener('drain', done);
          res.removeListener('close', done);
          res.removeListener('error', done);
          resolve();
        };
        res.once('drain', done);
        res.once('close', done);
        res.once('error', done);
      });
    }
    if (!res.destroyed) res.end();
  }, async (config, url) => {
    await assert.rejects(fetchLoopbackAuditCoverageResponse(url, config, 5000), /byte bound exceeded/);
  });
});

test('malformed JSON and interrupted bodies refuse without accepted payload', async () => {
  await fixture((req, res) => res.end('{malformed'), async (config, url) => {
    await assert.rejects(fetchLoopbackAuditCoverageResponse(url, config, 500), SyntaxError);
  });
  await fixture((req, res) => { res.write('{"incomplete":'); setTimeout(() => res.destroy(), 10); }, async (config, url) => {
    await assert.rejects(fetchLoopbackAuditCoverageResponse(url, config, 500), /interrupted|hang up/);
  });
});

test('oversized headers refuse within bounded parser resources', async () => {
  await fixture((req, res) => { res.writeHead(200, { 'X-Oversized': 'x'.repeat(17000) }); res.end('{}'); }, async (config, url) => {
    await assert.rejects(fetchLoopbackAuditCoverageResponse(url, config, 500), /Header overflow/);
  });
});

test('invalid scope, deadline and authorization refuse before any socket is created', async () => {
  let calls = 0;
  await fixture((req, res) => { calls++; res.end('{}'); }, async (config, url) => {
    for (const timeout of [0, -1, 600001, NaN, 1.5]) await assert.rejects(fetchLoopbackAuditCoverageResponse(url, config, timeout));
    for (const internalVerifierToken of ['', 'short', token + '\n', token + '\u0100']) {
      await assert.rejects(fetchLoopbackAuditCoverageResponse(url, { ...config, internalVerifierToken }, 500));
    }
    await assert.rejects(fetchLoopbackAuditCoverageResponse(url.replace('http:', 'https:'), config, 500));
    await assert.rejects(fetchLoopbackAuditCoverageResponse(url.replace('127.0.0.1', 'localhost'), config, 500));
    assert.equal(calls, 0);
  });
});

test('existing coverage max/default and remote fetch TLS/redirect/signal gates remain', async () => {
  const source = await readFile(new URL('./audit-id-registry.mjs', import.meta.url), 'utf8');
  assert.match(source, /timeoutMs > 300_000 &&\s*isExactLoopbackAuditCoverageUrl\(url, config\)/);
  assert.match(source, /redirect: "error"/);
  assert.match(source, /signal: AbortSignal.timeout\(timeoutMs\)/);
  assert.doesNotMatch(source, /rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|setGlobalDispatcher/);
  const config = auditConfiguration({ POW_ID_AUDIT_API_BASE: 'http://127.0.0.1:8081', POW_INTERNAL_VERIFIER_TOKEN: token });
  assert.equal(config.coverageTimeoutMs, 300000);
  assert.equal(auditConfiguration({ POW_ID_AUDIT_API_BASE: config.apiBase, POW_INTERNAL_VERIFIER_TOKEN: token, POW_ID_AUDIT_COVERAGE_TIMEOUT_MS: '600000' }).coverageTimeoutMs, 600000);
  assert.throws(() => auditConfiguration({ POW_ID_AUDIT_API_BASE: config.apiBase, POW_INTERNAL_VERIFIER_TOKEN: token, POW_ID_AUDIT_COVERAGE_TIMEOUT_MS: '600001' }));
});
