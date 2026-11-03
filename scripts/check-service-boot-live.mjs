// Prove that public traffic reaches the API through the boot-enabled listener.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const unit = "proofofwork-api-wg.socket";
const expectedHash = createHash("sha256")
  .update(readFileSync(new URL("../deploy/" + unit, import.meta.url)))
  .digest("hex");
const audit = `
set -eu
unit=proofofwork-api-wg.socket
file=/etc/systemd/system/$unit
test "$(readlink -f "/etc/systemd/system/wg-quick@wg0.service.wants/$unit")" = "$file"
test ! -L "/etc/systemd/system/sockets.target.wants/$unit"
test "$(systemctl show "$unit" -p DefaultDependencies --value)" = no
systemctl is-active --quiet wg-quick@wg0.service
systemctl is-active --quiet "$unit"
ss -H -lnt 'sport = :8081' | awk '$4 == "10.77.0.2:8081" {seen=1} END {exit !seen}'
sha256sum "$file"
`;
const evidence = execFileSync("ssh", [
  "-i", join(homedir(), ".ssh/proofofwork_node_ed25519"),
  "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
  "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10",
  "powadmin@65.108.122.87", "/bin/sh -s",
], { input: audit, encoding: "utf8", timeout: 30_000 });
assert.equal(evidence.trim().split(/\s+/u)[0], expectedHash, "Installed socket differs from released source");

for (const path of ["/health/live", "/health"]) {
  const response = await fetch("https://computer.proofofwork.me" + path, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, path);
  const health = await response.json();
  assert.equal(health.ready, true, path);
  if (path === "/health") {
    assert(Number.isSafeInteger(health.tipHeight) && health.tipHeight > 0);
    assert.equal(health.indexedThroughBlock, health.tipHeight);
    assert.equal(health.lagBlocks, 0);
  }
}
console.log(JSON.stringify({ ok: true, unit, sha256: expectedHash }));
