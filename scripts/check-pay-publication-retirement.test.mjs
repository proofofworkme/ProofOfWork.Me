import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = fileURLToPath(new URL("..", import.meta.url));
for (const [suite, rootOnly] of [
  ["deploy/publish/check-preservation-admission.test.py", false],
  ["deploy/publish/check-retired-native-fence.test.py", false],
  ["deploy/publish/check-native-exchange-fence.test.py", true],
  ["deploy/ui-retention/check-retirement-publication-cycle.test.py", true],
]) {
  test(suite, {
    skip: rootOnly && process.getuid?.() !== 0
      ? "Protected-filesystem fixture requires the separate isolated root run"
      : false,
  }, () => {
    const result = spawnSync("/usr/bin/python3", ["-I", "-B", suite], {
      cwd: repository,
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 4 * 1024 ** 2,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr + result.stdout);
  });
}
