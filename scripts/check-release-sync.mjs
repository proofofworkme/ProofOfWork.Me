#!/usr/bin/env node
// Required completion gate: actual remote main, primary main and live bundles.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const args = process.argv.slice(2);
assert(args.length === 0 || args.length === 2 && args[0] === '--primary', 'Usage: npm run check:release-sync -- [--primary /absolute/primary-checkout]');
const primary = resolve(args[1] || '/home/sixer/ProofOfWork.Me');
const git = (...values) => execFileSync('git', ['-C', primary, ...values], { encoding: 'utf8', timeout: 45_000 }).trim();
assert.equal(git('branch', '--show-current'), 'main', 'Primary checkout must be on main');
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Primary tracked source must be clean; preserve and integrate pending changes');
const commit = git('rev-parse', 'HEAD');
const tree = git('rev-parse', 'HEAD^{tree}');
const remote = git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/u);
assert.equal(remote.length, 2, 'Expected one remote main');
assert.equal(remote[1], 'refs/heads/main');
assert.equal(remote[0], commit, 'Primary checkout differs from actual GitHub main');
const manifest = execFileSync('ssh', ['-i', '/home/sixer/.ssh/proofofwork_me_ed25519', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', 'root@77.42.91.106', 'cat /var/www/.proofofwork-ui-release'], { encoding: 'utf8', timeout: 45_000 });
const manifestLines = manifest.trim().split("\n");
assert.equal(new Set(manifestLines.map(line => line.slice(0, line.indexOf("=")))).size, manifestLines.length, "Production manifest has duplicate fields");
const fields = Object.fromEntries(manifest.trim().split('\n').map(line => { const n = line.indexOf('='); assert(n > 0); return [line.slice(0, n), line.slice(n + 1)]; }));
assert.equal(fields.format, "proofofwork-ui-release-v4", "Production requires the complete Pages release contract");
assert.equal(Object.keys(fields).filter(key => /^surface\.[^.]+\.sha256$/u.test(key)).length, 21, "Production must preserve all 21 managed products");
assert.equal(fields.commit, commit, 'Production manifest differs from GitHub main');
assert.equal(fields.source_tree, tree, 'Production source tree differs from primary main');
const results = [];
for (const url of ['http://127.0.0.1:4175/source-provenance.json', 'https://pages.proofofwork.me/source-provenance.json', 'https://computer.proofofwork.me/source-provenance.json']) {
  const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `Unavailable source provenance: ${url}`);
  const source = await response.json();
  assert.equal(source.format, 'proof-of-work-ui-source-v1', url);
  assert.equal(source.commit, commit, `Stale bundle: ${url}`);
  assert.equal(source.tree, tree, `Different bundle source: ${url}`);
  assert.equal(source.trackedDirty, false, `Bundle built with uncommitted source: ${url}`);
  results.push(url);
}
// Fence concurrent GitHub advancement during verification.
assert.equal(git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/u)[0], commit, 'GitHub main advanced during verification; reintegrate and redeploy before completion');
console.log(JSON.stringify({ ok: true, commit, tree, primary, verified: results, productionManifest: fields.release_id }));
