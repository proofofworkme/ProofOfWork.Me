#!/usr/bin/env node
// Required completion gate: actual remote main, primary main and live bundles.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
assert.equal(fields.format, "proofofwork-ui-release-v5", "Production requires the complete Permission release contract");
assert.equal(Object.keys(fields).filter(key => /^surface\.[^.]+\.sha256$/u.test(key)).length, 22, "Production must preserve all 22 managed products");
assert.equal(fields.commit, commit, 'Production manifest differs from GitHub main');
assert.equal(fields.source_tree, tree, 'Production source tree differs from primary main');
const results = [];
for (const url of ['http://127.0.0.1:4175/source-provenance.json', 'https://permission.proofofwork.me/source-provenance.json', 'https://pages.proofofwork.me/source-provenance.json', 'https://computer.proofofwork.me/source-provenance.json']) {
  const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `Unavailable source provenance: ${url}`);
  const source = await response.json();
  assert.equal(source.format, 'proof-of-work-ui-source-v1', url);
  assert.equal(source.commit, commit, `Stale bundle: ${url}`);
  assert.equal(source.tree, tree, `Different bundle source: ${url}`);
  assert.equal(source.trackedDirty, false, `Bundle built with uncommitted source: ${url}`);
  results.push(url);
}
// The read-only renderer may retain an earlier installed commit when its exact
// modules are unchanged. Its live template must still be this UI release.
const rendererUrl = 'https://publish.proofofwork.me/publish-render-provenance.json';
const rendererResponse = await fetch(rendererUrl, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
assert(rendererResponse.ok, 'Publish renderer source provenance is unavailable');
const renderer = await rendererResponse.json();
assert.equal(renderer.format, 'proof-of-work-publish-render-source-v1');
assert.equal(renderer.ok, true);
assert.match(renderer.commit, /^[a-f0-9]{40}$/u);
assert.match(renderer.tree, /^[a-f0-9]{40}$/u);
assert.equal(renderer.ui?.commit, commit, 'Publish renderer uses a stale UI template');
assert.equal(renderer.ui?.tree, tree);
assert.equal(renderer.ui?.trackedDirty, false);
const rendererFiles = ['server/publish-render/reader.mjs', 'server/publish-render/document.mjs',
  'server/publish-render/handler.mjs', 'server/publish-render/server.mjs', 'src/app/seoMetadata.mjs',
  'src/app/publishArticleSeo.mjs', 'src/shared/protocol/publishArticle.mjs', 'src/shared/protocol/boostText.mjs'];
assert.deepEqual(Object.keys(renderer.files ?? {}).sort(), [...rendererFiles].sort(), 'Unexpected renderer source inventory');
for (const file of rendererFiles) assert.equal(renderer.files[file], createHash('sha256').update(readFileSync(resolve(primary, file))).digest('hex'), `Installed Publish renderer source differs: ${file}`);
results.push(rendererUrl);
// Fence concurrent GitHub advancement during verification.
assert.equal(git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/u)[0], commit, 'GitHub main advanced during verification; reintegrate and redeploy before completion');
console.log(JSON.stringify({ ok: true, commit, tree, primary, verified: results, productionManifest: fields.release_id, publishRendererCommit: renderer.commit }));
