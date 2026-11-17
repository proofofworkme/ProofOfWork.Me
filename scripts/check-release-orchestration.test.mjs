import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
const repository = fileURLToPath(new URL("..", import.meta.url));
for (const suite of ["deploy/publish/check-orchestrator.test.py", "deploy/pay/check-qualification-coordinator.test.py"]) {
  test("offline release orchestration: " + suite, () => {
    const result = spawnSync("/usr/bin/python3", ["-I", "-B", suite], {
      cwd: repository, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 ** 2,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr + result.stdout);
  });
}
