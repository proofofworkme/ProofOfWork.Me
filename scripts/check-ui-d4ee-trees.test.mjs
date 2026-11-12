import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('exact d4ee trees require durable metadata recovery and closed hardlinks', () => {
  execFileSync('python3', ['-I', '-B', 'deploy/health-cleanup/check-d4ee.test.py'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe', timeout: 60_000,
  });
});
