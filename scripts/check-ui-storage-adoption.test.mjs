import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('completed storage adoption is exact, non-deleting and fail-closed', () => {
  execFileSync('python3', ['-I', '-B', 'deploy/ui-retention/check-storage-adoption.test.py'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe', timeout: 60_000,
  });
});
