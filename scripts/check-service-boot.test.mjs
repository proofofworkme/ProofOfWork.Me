import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("systemd boots the private API listener with WireGuard", (t) => {
  const tool = spawnSync("systemd-analyze", ["--version"], { encoding: "utf8" });
  if (tool.error?.code === "ENOENT" && process.platform !== "linux") {
    return t.skip("systemd-analyze is unavailable on this platform");
  }
  assert.equal(tool.status, 0, tool.error?.message || tool.stderr);

  const root = mkdtempSync(join(tmpdir(), "pow-service-boot-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const socket = "proofofwork-api-wg.socket";
  const tunnel = "wg-quick@wg0.service";
  const unit = readFileSync(new URL(`../deploy/${socket}`, import.meta.url), "utf8");
  for (const name of ["basic", "multi-user", "network-online", "shutdown", "sockets", "sysinit"]) {
    copyFileSync(`/usr/lib/systemd/system/${name}.target`, join(root, `${name}.target`));
  }
  // Model wg-quick's network ordering and normal service defaults. Verification
  // only builds a transaction; it never creates an interface or opens a port.
  writeFileSync(join(root, tunnel), `[Unit]
Description=Fixture WireGuard tunnel
Wants=network-online.target
After=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/true
`);
  writeFileSync(join(root, "proofofwork-api-wg.service"), "[Service]\nExecStart=/bin/true\n");
  function enable(owner, name) {
    const wants = join(root, owner + ".wants");
    mkdirSync(wants);
    symlinkSync(join("..", name), join(wants, name));
  }
  enable("multi-user.target", tunnel);
  assert.deepEqual(unit.match(/^WantedBy=.*$/gmu), [`WantedBy=${tunnel}`]);
  enable(tunnel, socket);

  function verify(contents) {
    writeFileSync(join(root, socket), contents);
    return spawnSync("systemd-analyze", [
      "verify", "--man=no", "--generators=no", join(root, "multi-user.target"), join(root, socket),
    ], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", SYSTEMD_UNIT_PATH: root },
    });
  }

  const current = verify(unit);
  assert.equal(current.status, 0, current.stderr);
  // systemd can return success after discarding a job to break a cycle.
  assert.doesNotMatch(current.stderr, /ordering cycle|deleted to break|transaction order is cyclic/iu);
  const installOnly = verify(unit.replace(/^DefaultDependencies=no$/mu, "DefaultDependencies=yes"));
  assert.match(installOnly.stderr, /ordering cycle/iu);
});
