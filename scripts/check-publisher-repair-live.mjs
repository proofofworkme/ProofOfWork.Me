import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const status = JSON.parse(execFileSync("python3", [
  "-I", "-B", "deploy/ui-retention/lifecycle.py", "status", "--require-complete",
], { cwd: repo, encoding: "utf8", timeout: 1_800_000, maxBuffer: 8 * 1024 ** 2 }));
assert.equal(status.retentionComplete, true);
assert.equal(status.publicationHealthy, true);
const capacityApproval = readFileSync(join(repo, "audits/2026-11-08-ui-publisher-capacity-floor-approval.json"));
const capacityGrant = JSON.parse(capacityApproval);
assert.deepEqual(status.binding.capacityFloor, status.verifiedCapacityFloor);
assert.equal(status.verifiedCapacityFloor.model, "verified-ui-capacity-floor-v1");
assert.equal(status.verifiedCapacityFloor.approvalSha256, createHash("sha256").update(capacityApproval).digest("hex"));
assert.match(status.verifiedCapacityFloor.installedSha256, /^[0-9a-f]{64}$/u);
assert.equal(status.verifiedCapacityFloor.rootReserveBytes, capacityGrant.rootReserveBytes);
assert.equal(status.verifiedCapacityFloor.growthReserveBytes, capacityGrant.growthReserveBytes);
assert.equal(status.context.guards.heldIdentityModel, "pow-ui-held-census-rotating-logs-v2");

// Compare the verified in-place artifacts with their admissions before the release.
assert.deepEqual(status.verifiedPreservedFallback, {
  "model": "verified-fallback-in-place-v1",
  "releaseId": "c3969c39c2b2-20261101T051206Z",
  "introducedBy": "54088ca155bc-20261103T032112Z",
  "admissions": {
    "archive": "d28d8784520421497e228c38ab8a06bc5569ce3b45bb778d354ab60613a51c3b",
    "root": "910b4232f582eb0ac4c23411d38cbf3b90d3c095d4ad60cb06d4f1cddf08d8f3"
  },
  "manifestSha256": "2507b02cf45892625a6091de458b081a5d582b23676ad4288714d0d4a41c0040",
  "archivePayloadSha256": "29374dbeebfe5b83ce90dc248f9e56bda4477307acc14ccd50808a014fb316dd",
  "snapshotSha256": {
    "/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-54088ca155bc-20261103T032112Z": "30753986c138b165e7b93bdef6e24ce84d79594f41c280ea5fabfc35859ce514",
    "/var/backups/proofofwork-ui/releases/proofofwork-ui-release-c3969c39c2b2-20261101T051206Z.tgz": "6df3f6fbe4739b27d11b4dc3e96c706f0ece2af82c004e70e79753352e685ce7",
    "/var/backups/proofofwork-ui/releases/proofofwork-ui-release-c3969c39c2b2-20261101T051206Z.tgz.sha256": "cfc09b7c39923e5a470d18b8af912c5c364a643b8cabc76d39105690a8a23b59",
    "/var/backups/proofofwork-ui/releases/proofofwork-ui-release-c3969c39c2b2-20261101T051206Z.tgz.provenance": "249d2a9353aab877e5457e9a996e3e68f8f95cc1702fc82b55099aa8a767346f"
  }
});

const helpers = [
  ["deploy/proofofwork-ui-capacity.py", "/usr/local/sbin/proofofwork-ui-capacity"],
  ["deploy/audit5/stream-ui-bundle.py", "/var/tmp/proofofwork-deploy/audit29-tools/stream-ui-bundle.py"],
  ["deploy/proofofwork-ui-release-stage.py", "/usr/local/sbin/proofofwork-ui-release-stage"],
  ["deploy/proofofwork-ui-release-publish.sh", "/usr/local/sbin/proofofwork-ui-release-publish"],
];
const uiSsh = [
  "-i", join(homedir(), ".ssh/proofofwork_me_ed25519"), "-o", "BatchMode=yes",
  "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15",
  "root@77.42.91.106",
];
const installed = execFileSync("ssh", [...uiSsh, "sha256sum", ...helpers.map(([, path]) => path)],
  { encoding: "utf8", timeout: 45_000 }).trimEnd().split("\n");
assert.equal(installed.length, helpers.length);
for (const [index, [source, path]] of helpers.entries()) {
  const expected = createHash("sha256").update(readFileSync(join(repo, source))).digest("hex");
  assert.equal(installed[index], expected + "  " + path);
}
function readCapacity(command) {
  return JSON.parse(execFileSync("ssh", [...uiSsh,
    "/usr/bin/python3", "-I", "-B", "/usr/local/sbin/proofofwork-ui-capacity", command,
    "--path", "/var/tmp/proofofwork-deploy", "--phase", "release-sync",
  ], { encoding: "utf8", timeout: 120_000 }));
}
const capacity = readCapacity("check");
assert.equal(capacity.status, "sufficient");
assert.equal(capacity.rootReserveBytes, 8 * 1024 ** 3);
assert.equal(capacity.growthReserveBytes, 64 * 1024 ** 2);
const root = capacity.checks.find(row => row.path === "/");
assert.equal(root.requiredBytes, capacity.rootReserveBytes + capacity.growthReserveBytes);
assert.ok(root.availableBytes >= root.requiredBytes && root.availableInodes >= root.requiredInodes);
assert.equal(root.requiredInodes, 128);
assert.deepEqual(Object.fromEntries(capacity.retention.map(row => [row.path, row.maximumBytes])), {
  "/var/backups/proofofwork-ui": 18 * 1024 ** 3,
  "/var/backups/proofofwork-ui/transport-evidence": 9 * 1024 ** 3 + 64 * 1024 ** 2,
});
assert.ok(capacity.retention.every(row => row.allocatedBytes <= row.maximumBytes && row.automaticEvidenceDeletion === false));
const scratch = readCapacity("check-scratch");
assert.equal(scratch.status, "sufficient");
assert.equal(scratch.maximumBytes, 5 * 1024 ** 3);
assert.ok(scratch.allocatedBytes <= scratch.maximumBytes);
assert.equal(scratch.cleanupApproved, false);
execFileSync(process.execPath, [join(repo, "scripts/check-summary-preview-live.mjs")], { cwd: repo, stdio: "inherit", timeout: 240_000 });
execFileSync(process.execPath, [join(repo, "scripts/check-pending-discovery-live.mjs")], { cwd: repo, stdio: "inherit", timeout: 240_000 });
execFileSync(process.execPath, [join(repo, "scripts/check-work-storage-readers-live.mjs")], { cwd: repo, stdio: "inherit", timeout: 480_000 });
console.log(JSON.stringify({
  verifiedRelease: status.pair.current, immediateRollback: status.pair.previous,
  retainedFallback: status.verifiedPreservedFallback.releaseId,
  publisherFloorBytes: capacity.rootReserveBytes, availableRootBytes: root.availableBytes,
  scratchAllocatedBytes: scratch.allocatedBytes, scratchLimitBytes: scratch.maximumBytes,
}));
