import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('exact ad330 duplicates preserve unique content and durable recovery', () => {
  execFileSync('python3', ['-I', '-B', 'deploy/health-cleanup/check-ad330.test.py'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe', timeout: 60_000,
  });
});
