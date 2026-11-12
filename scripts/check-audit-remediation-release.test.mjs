import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('audit remediation overlay keeps exact source and preservation fences', () => {
  execFileSync('python3', ['-I', '-B', 'deploy/audit-remediation/check.test.py'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe', timeout: 60_000,
  });
});

test("UI build admission refuses unsafe roots and exhausted budgets", () => {
  execFileSync("python3", ["-I", "-B", "deploy/publish/check-build-capacity.test.py"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "pipe", timeout: 60_000,
  });
});
