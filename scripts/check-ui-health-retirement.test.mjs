import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Isolated fixtures only. No SSH, production host, or production deletion.
test('exact health retirement retains identity, recovery, scope and journal fences', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  for (const suite of ['deploy/health-cleanup/check.test.py', 'deploy/ui-retention/check-removal.test.py']) {
    execFileSync('python3', ['-I', '-B', suite], { cwd: root, stdio: 'pipe', timeout: 60_000 });
  }
});
