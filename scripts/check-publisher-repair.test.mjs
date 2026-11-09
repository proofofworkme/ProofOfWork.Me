import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repo = fileURLToPath(new URL("..", import.meta.url));
for (const suite of [
  "deploy/summary-storage-readers/check.test.py",
  "scripts/check-ui-compatibility-boundaries.py",
  "deploy/publish/check-input-compaction.test.py",
  "deploy/publish/check-closed-input.test.py",
  "deploy/publish/check-ui-release.test.py",
  "deploy/publish/check-private-staging.test.py",
  "deploy/publish/check-preservation-admission.test.py",
  "deploy/publish/check-native-exchange-fence.test.py",
  "deploy/audit30/check-ui-storage.test.py",
  "deploy/ui-retention/check-lifecycle-remote.test.py",
  "deploy/ui-stream-tools/check-installer.test.py",
  "deploy/ui-stream-tools/check-private-stage-installer.test.py",
  "deploy/publish/check-ui-native-dispatch.test.py",
]) {
  test(suite, () => {
    const run = spawnSync("python3", ["-B", suite], { cwd: repo, encoding: "utf8", timeout: 600_000 });
    assert.equal(run.status, 0, run.error?.message ?? run.stderr + run.stdout);
  });
}
