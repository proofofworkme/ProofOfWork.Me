import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = fileURLToPath(new URL("..", import.meta.url));
for (const [command, args] of [
  ["/usr/bin/python3", ["-I", "-B", "scripts/check-ui-compatibility-boundaries.py"]],
  ["/usr/bin/python3", ["-I", "-B", "scripts/check-ui-pay-release.py"]],
  [process.execPath, ["scripts/check-ui-ops-contract.mjs"]],
]) {
  test(args.at(-1), () => {
    const result = spawnSync(command, args, {
      cwd: repository,
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 4 * 1024 ** 2,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr + result.stdout);
  });
}
