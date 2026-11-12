import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const status = JSON.parse(execFileSync('python3', [
  '-I', '-B', 'deploy/ui-retention/lifecycle.py', 'status', '--require-complete',
], { cwd: repo, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 8 * 1024 ** 2 }));
assert.equal(status.retentionComplete, true);
assert.equal(status.publicationHealthy, true);
assert.deepEqual(status.pair, {
  current: '037f8db7edcc-20261111T182211Z', previous: 'd9fa69d9e1e4-20261110T210615Z',
});
assert.equal(status.binding.controller.sha256,
  createHash('sha256').update(readFileSync(new URL('../deploy/ui-retention/lifecycle_remote.py', import.meta.url))).digest('hex'));
assert.deepEqual(status.unfinishedIntents, []);
assert(status.verifiedPreservedFallback);
assert.equal(status.verifiedCapacityFloor.rootReserveBytes, 8 * 1024 ** 3);
assert.equal(status.verifiedCapacityFloor.growthReserveBytes, 64 * 1024 ** 2);
console.log(JSON.stringify({
  ok: true, operation: 'non-publishing-storage-adoption', pair: status.pair,
  stateSha256: status.stateSha256, controllerSha256: status.binding.controller.sha256,
  websiteSourceUnchanged: true, repairBranchIntegrationPending: true,
}));
