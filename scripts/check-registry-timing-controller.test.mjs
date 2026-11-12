import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('registry timing overlay keeps exact source and preservation fences', () => {
  execFileSync('python3', ['-I', '-B', 'deploy/registry-timing/check.test.py'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe', timeout: 60_000,
  });
});
