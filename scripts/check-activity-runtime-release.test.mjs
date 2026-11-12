import test from "node:test";
import { execFileSync } from "node:child_process";

test("activity runtime adapter preserves exact scope, overlay bytes and rollback metadata", () => {
  execFileSync("python3", ["-I", "-B", "deploy/activity-fee-factor/check.test.py"], {
    encoding: "utf8", timeout: 30_000,
  });
});
