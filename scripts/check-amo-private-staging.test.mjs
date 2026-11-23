import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const installedStaging = "deploy/publish/check-amo-installed-staging.test.py";

for (const suite of [
  "scripts/check-amo-direct-stage-design.py",
  "deploy/publish/check-amo-exchange-scratch.test.py",
  "deploy/publish/check-closed-input.test.py",
  "deploy/publish/check-amo-stage-installer.test.py",
  installedStaging,
]) {
  test(suite, () => {
    const result = spawnSync("python3", ["-I", "-B", suite], {
      cwd: repository,
      encoding: "utf8",
      timeout: suite === installedStaging ? 780_000 : 240_000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr + result.stdout);
  });
}
