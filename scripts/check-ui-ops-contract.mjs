import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const read = (file) => readFileSync(file, "utf8");
const caddy = read("deploy/Caddyfile");
const caddyService = read("deploy/caddy-hardening.conf");
const caddyTmpfiles = read("deploy/proofofwork-caddy-log-tmpfiles.conf");
const uiRuntimeTmpfiles = read(
  "deploy/proofofwork-ui-runtime-tmpfiles.conf",
);
const storageHealth = read("deploy/proofofwork-ui-storage-health.sh");
const storageHealthService = read(
  "deploy/proofofwork-ui-storage-health.service",
);
const storageHealthTimer = read("deploy/proofofwork-ui-storage-health.timer");
const releasePruneService = read(
  "deploy/proofofwork-ui-release-prune.service",
);
const storagePrune = read("deploy/proofofwork-ui-storage-prune.sh");
const storagePruneService = read(
  "deploy/proofofwork-ui-storage-prune.service",
);
const storagePruneTimer = read("deploy/proofofwork-ui-storage-prune.timer");
const provenance = read("deploy/proofofwork-ui-release-provenance.sh");
const provenanceService = read(
  "deploy/proofofwork-ui-release-provenance.service",
);
const provenanceTimer = read(
  "deploy/proofofwork-ui-release-provenance.timer",
);

for (const executable of [
  "deploy/proofofwork-ui-release-provenance.sh",
  "deploy/proofofwork-ui-storage-health.sh",
  "deploy/proofofwork-ui-storage-prune.sh",
]) {
  assert.notEqual(
    statSync(executable).mode & 0o111,
    0,
    `${executable} must be tracked executable.`,
  );
}

assert.match(caddy, /admin 127\.0\.0\.1:2019/u);
assert.match(caddy, /exclude http\.log\.access/u);
assert.match(caddy, /include http\.log\.access/u);
assert.match(caddy, /output file \/var\/log\/caddy\/access\.json/u);
assert.match(caddy, /mode 0600/u);
assert.match(caddy, /roll_size 25MiB/u);
assert.match(caddy, /roll_interval 24h/u);
assert.match(caddy, /roll_keep 8/u);
assert.match(caddy, /roll_keep_for 168h/u);
assert.match(caddy, /request>client_ip delete/u);
assert.match(caddy, /request>remote_ip delete/u);
assert.match(caddy, /request>remote_port delete/u);
assert.match(caddy, /request>headers delete/u);
assert.match(caddy, /request>uri regexp \\?\?\.\*\$ ""/u);
assert.match(caddy, /resp_headers delete/u);
assert.match(caddy, /\(common_access_log\) \{\s+log\s+\}/u);
assert.match(
  caddy,
  /http:\/\/proofofwork\.me,[\s\S]*http:\/\/inception\.proofofwork\.me \{\s+import common_access_log\s+redir https:\/\/\{host\}\{uri\} 308\s+\}/u,
);
assert.doesNotMatch(caddy, /log_credentials|sampling\s*\{/u);
assert.match(caddyService, /^UMask=0077$/mu);
assert.match(caddyTmpfiles, /d \/var\/log\/caddy 0700 caddy caddy/u);
assert.match(
  caddyTmpfiles,
  /f \/var\/log\/caddy\/access\.json 0600 caddy caddy/u,
);
assert.match(uiRuntimeTmpfiles, /d \/run\/proofofwork-ui 0700 root root/u);
assert.match(
  uiRuntimeTmpfiles,
  /f \/run\/proofofwork-ui\/deploy\.lock 0600 root root/u,
);

for (const threshold of [
  "POW_STORAGE_WARN_PERCENT=75",
  "POW_STORAGE_CRITICAL_PERCENT=85",
  "POW_STORAGE_WARN_INODE_PERCENT=75",
  "POW_STORAGE_CRITICAL_INODE_PERCENT=85",
  "POW_STORAGE_ROOT_MIN_FREE_BYTES=10737418240",
]) {
  assert.ok(storageHealthService.includes(threshold));
}
assert.match(storageHealth, /df --block-size=1 --output=source,pcent,avail/u);
assert.match(storageHealth, /df --output=ipcent,iavail/u);
assert.match(storageHealth, /exit 2/u);
assert.match(storageHealth, /exit 1/u);
assert.match(storageHealthTimer, /OnCalendar=\*:0\/5/u);
assert.match(storageHealthTimer, /Persistent=true/u);

assert.match(storagePrune, /--dry-run \| --apply/u);
assert.match(storagePrune, /max_paths=256/u);
assert.match(storagePrune, /--one-file-system/u);
assert.match(storagePrune, /historical recovery evidence/u);
assert.match(storagePrune, /failed\|stage/u);
assert.match(storagePrune, /minimum_age_seconds=1209600/u);
assert.match(storagePrune, /minimum_age_seconds=604800/u);
assert.match(storagePrune, /proofofwork-rebuildable-ui-stage-v1/u);
assert.match(storagePrune, /validate_marker/u);
assert.match(storagePrune, /reject_nested_mounts/u);
assert.match(storagePrune, /flock --exclusive --nonblock/u);
assert.match(storagePrune, /-perm \/7022/u);
assert.match(
  storagePruneService,
  /ReadWritePaths=\/var\/www \/var\/tmp \/run\/proofofwork-ui/u,
);
assert.match(storagePruneService, /ProtectSystem=strict/u);
assert.match(storagePruneService, /^TimeoutStartSec=30m$/mu);
assert.match(storagePruneTimer, /OnCalendar=\*-\*-\* 01:10:00 UTC/u);
assert.match(storagePruneTimer, /Persistent=true/u);

assert.match(provenance, /format=proofofwork-ui-release-v3/u);
assert.match(provenance, /source_tree=/u);
assert.match(provenance, /source_attestation=detached-recursive-git-tree-v1/u);
assert.match(provenance, /source_dependency_model=node-modules-recursive-v1/u);
assert.match(provenance, /non-dependency ignored path/u);
assert.match(provenance, /--source-checkout/u);
assert.match(provenance, /ls-tree -r -z --full-tree/u);
assert.match(provenance, /hash-object --no-filters/u);
assert.match(provenance, /reject_nested_mounts/u);
assert.match(provenance, /flock --exclusive --nonblock/u);
assert.match(provenance, /NFT compatibility alias must exactly match Computer/u);
assert.match(provenance, /surface_tree_sha256/u);
assert.match(provenance, /sha256sum --binary/u);
assert.match(provenance, /LC_ALL=C sort --zero-terminated/u);
assert.match(provenance, /unsupported file type/u);
assert.match(provenance, /verified_archive_sha256/u);
assert.match(provenance, /verify_archive_payload/u);
assert.match(provenance, /archive_payload_model=surfaces-v1/u);
assert.match(provenance, /archive_provenance/u);
assert.match(provenance, /mktemp "\$\{ui_root\}\/\.proofofwork-ui-release/u);
assert.match(
  provenance,
  /mv --no-target-directory -- "\$\{temporary\}" "\$\{manifest\}"/u,
);
assert.match(provenanceService, /ProtectSystem=strict/u);
assert.match(
  provenanceService,
  /ReadWritePaths=\/run\/proofofwork-ui/u,
);
assert.match(provenanceService, /^TimeoutStartSec=30m$/mu);
assert.match(provenanceTimer, /OnCalendar=\*:0\/15/u);
assert.match(provenanceTimer, /Persistent=true/u);

assert.match(releasePruneService, /^TimeoutStartSec=30m$/mu);
assert.match(releasePruneService, /^Nice=10$/mu);
assert.match(releasePruneService, /^IOSchedulingClass=idle$/mu);
assert.match(releasePruneService, /^CPUWeight=10$/mu);
assert.match(releasePruneService, /^IOWeight=10$/mu);
assert.match(releasePruneService, /ProtectSystem=strict/u);

for (const service of [
  storageHealthService,
  storagePruneService,
  provenanceService,
]) {
  for (const directive of [
    "NoNewPrivileges=true",
    "PrivateDevices=true",
    "ProtectHome=true",
    "ProtectKernelTunables=true",
    "CapabilityBoundingSet=",
    "AmbientCapabilities=",
    "RestrictSUIDSGID=true",
    "LockPersonality=true",
    "RestrictRealtime=true",
    "SystemCallArchitectures=native",
  ]) {
    assert.ok(service.includes(directive), `Missing ${directive}`);
  }
}

for (const lockAwareScript of [storagePrune, provenance]) {
  assert.match(
    lockAwareScript,
    /POW_UI_DEPLOY_LOCK:-\/run\/proofofwork-ui\/deploy\.lock/u,
  );
  assert.match(lockAwareScript, /POW_UI_DEPLOY_LOCK_FD/u);
  assert.match(lockAwareScript, /\/proc\/self\/fd\//u);
  assert.match(
    lockAwareScript,
    /UI root must be owner-controlled and not group\/world writable/u,
  );
}
assert.match(provenance, /Release surface contains foreign-owned content/u);

const run = (script, arguments_, env) =>
  spawnSync("bash", [script, ...arguments_], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
const runWithInheritedLock = (
  script,
  arguments_,
  env,
  openedLock = env.POW_UI_DEPLOY_LOCK,
) =>
  spawnSync(
    "bash",
    [
      "-c",
      'set -Eeuo pipefail; script="$1"; lock="$2"; shift 2; exec 9>"${lock}"; chmod 0600 "${lock}"; flock --exclusive 9; POW_UI_DEPLOY_LOCK_FD=9 "${script}" "$@" 9>&9',
      "ui-inherited-lock-test",
      script,
      openedLock,
      ...arguments_,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ...env },
    },
  );
const runWhileLockHeldSeparately = (script, arguments_, env) =>
  spawnSync(
    "bash",
    [
      "-c",
      'set -Eeuo pipefail; script="$1"; lock="$2"; shift 2; exec 8>"${lock}"; chmod 0600 "${lock}"; flock --exclusive 8; "${script}" "$@"',
      "ui-independent-lock-test",
      script,
      env.POW_UI_DEPLOY_LOCK,
      ...arguments_,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ...env },
    },
  );
const runChecked = (command, arguments_) => {
  const result = spawnSync(command, arguments_, { encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `${command} ${arguments_.join(" ")} failed:\n${result.stderr}`,
  );
  return result.stdout.trim();
};

const healthWarning = run("deploy/proofofwork-ui-storage-health.sh", [], {
  POW_STORAGE_WARN_PERCENT: "1",
  POW_STORAGE_CRITICAL_PERCENT: "100",
  POW_STORAGE_WARN_INODE_PERCENT: "99",
  POW_STORAGE_CRITICAL_INODE_PERCENT: "100",
  POW_STORAGE_ROOT_MIN_FREE_BYTES: "1",
});
assert.equal(healthWarning.status, 1, healthWarning.stderr);
assert.match(healthWarning.stdout, /storage target=\/ filesystem=/u);
const healthCritical = run("deploy/proofofwork-ui-storage-health.sh", [], {
  POW_STORAGE_WARN_PERCENT: "1",
  POW_STORAGE_CRITICAL_PERCENT: "2",
  POW_STORAGE_WARN_INODE_PERCENT: "99",
  POW_STORAGE_CRITICAL_INODE_PERCENT: "100",
  POW_STORAGE_ROOT_MIN_FREE_BYTES: "1",
});
assert.equal(healthCritical.status, 2, healthCritical.stderr);

const fixture = mkdtempSync(join(tmpdir(), "proofofwork-ui-ops-"));
try {
  const www = join(fixture, "www");
  const varTmp = join(fixture, "var-tmp");
  mkdirSync(www, { mode: 0o755 });
  mkdirSync(varTmp, { mode: 0o755 });
  chmodSync(www, 0o755);
  chmodSync(varTmp, 0o755);
  const makeDirectory = (root, name, ageDays) => {
    const directory = join(root, name);
    mkdirSync(directory, { mode: 0o755 });
    chmodSync(directory, 0o755);
    writeFileSync(join(directory, "evidence.txt"), name, { mode: 0o644 });
    chmodSync(join(directory, "evidence.txt"), 0o644);
    const timestamp = new Date(Date.now() - ageDays * 86_400_000);
    utimesSync(directory, timestamp, timestamp);
    return directory;
  };
  const markDirectory = (directory, className, releaseId, ageDays) => {
    const marker = join(directory, ".proofofwork-rebuildable-stage-v1");
    writeFileSync(
      marker,
      [
        "format=proofofwork-rebuildable-ui-stage-v1",
        `class=${className}`,
        `release_id=${releaseId}`,
        "",
      ].join("\n"),
      { mode: 0o644 },
    );
    chmodSync(marker, 0o644);
    const timestamp = new Date(Date.now() - ageDays * 86_400_000);
    utimesSync(directory, timestamp, timestamp);
  };

  const rollback = makeDirectory(
    www,
    "proofofwork-computer.rollback-preserved",
    90,
  );
  const previous = makeDirectory(
    www,
    "proofofwork-computer.previous-preserved",
    90,
  );
  const pre = makeDirectory(www, "proofofwork-computer.pre-preserved", 90);
  const oldFailed = makeDirectory(
    www,
    "proofofwork-computer.failed-old",
    30,
  );
  const newestFailed = makeDirectory(
    www,
    "proofofwork-computer.failed-newest",
    20,
  );
  const oldStage = makeDirectory(
    www,
    "proofofwork-computer.stage-old",
    4,
  );
  const freshStage = makeDirectory(
    www,
    "proofofwork-computer.stage-fresh",
    1,
  );
  const oldStaging = makeDirectory(www, ".staging-old", 4);
  const oldStageRoot = makeDirectory(www, "proofofwork-stage-old", 4);
  const oldUiStageRoot = makeDirectory(
    www,
    "proofofwork-ui-stage-old",
    4,
  );
  const oldVarTmp = makeDirectory(varTmp, "proofofwork-ui-old", 8);
  const freshVarTmp = makeDirectory(varTmp, "proofofwork-ui-fresh", 1);
  const unmarkedOldStage = makeDirectory(
    www,
    "proofofwork-computer.stage-unmarked",
    30,
  );
  markDirectory(oldFailed, "failed", "old", 30);
  markDirectory(newestFailed, "failed", "newest", 20);
  markDirectory(oldStage, "stage", "old", 4);
  markDirectory(freshStage, "stage", "fresh", 1);
  markDirectory(oldStaging, "staging", "old", 4);
  markDirectory(oldStageRoot, "stage-root", "old", 4);
  markDirectory(oldUiStageRoot, "ui-stage-root", "old", 4);
  markDirectory(oldVarTmp, "var-tmp-ui", "old", 8);
  markDirectory(freshVarTmp, "var-tmp-ui", "fresh", 1);
  const cleanupEnvironment = {
    POW_UI_WWW_ROOT: www,
    POW_UI_VAR_TMP_ROOT: varTmp,
    POW_UI_ALLOW_TEST_ROOTS: "1",
    POW_UI_DEPLOY_LOCK: join(fixture, "ui-deploy.lock"),
  };

  const fakeMountinfo = join(fixture, "mountinfo");
  writeFileSync(
    fakeMountinfo,
    `1 0 0:1 / ${join(oldStage, "nested-mount")} rw - tmpfs tmpfs rw\n`,
  );
  chmodSync(fixture, 0o770);
  const unsafeLockParent = run(
    "deploy/proofofwork-ui-storage-prune.sh",
    ["--dry-run"],
    cleanupEnvironment,
  );
  assert.equal(unsafeLockParent.status, 64, unsafeLockParent.stderr);
  assert.match(unsafeLockParent.stderr, /lock parent has unsafe/u);
  chmodSync(fixture, 0o700);

  writeFileSync(cleanupEnvironment.POW_UI_DEPLOY_LOCK, "", { mode: 0o660 });
  chmodSync(cleanupEnvironment.POW_UI_DEPLOY_LOCK, 0o660);
  const unsafeLockFile = run(
    "deploy/proofofwork-ui-storage-prune.sh",
    ["--dry-run"],
    cleanupEnvironment,
  );
  assert.equal(unsafeLockFile.status, 64, unsafeLockFile.stderr);
  assert.match(unsafeLockFile.stderr, /owner-controlled regular file/u);
  chmodSync(cleanupEnvironment.POW_UI_DEPLOY_LOCK, 0o600);

  for (const inheritedDescriptor of ["not-a-fd", "9"]) {
    const invalidInheritedDescriptor = run(
      "deploy/proofofwork-ui-storage-prune.sh",
      ["--dry-run"],
      {
        ...cleanupEnvironment,
        POW_UI_DEPLOY_LOCK_FD: inheritedDescriptor,
      },
    );
    assert.equal(
      invalidInheritedDescriptor.status,
      64,
      invalidInheritedDescriptor.stderr,
    );
    assert.match(invalidInheritedDescriptor.stderr, /descriptor is invalid/u);
  }

  const wrongInheritedDescriptor = runWithInheritedLock(
    "deploy/proofofwork-ui-storage-prune.sh",
    ["--dry-run"],
    cleanupEnvironment,
    join(fixture, "wrong-ui-deploy.lock"),
  );
  assert.equal(
    wrongInheritedDescriptor.status,
    64,
    wrongInheritedDescriptor.stderr,
  );
  assert.match(wrongInheritedDescriptor.stderr, /descriptor is invalid/u);

  const independentlyHeldLock = runWhileLockHeldSeparately(
    "deploy/proofofwork-ui-storage-prune.sh",
    ["--dry-run"],
    cleanupEnvironment,
  );
  assert.equal(independentlyHeldLock.status, 1, independentlyHeldLock.stderr);
  assert.match(independentlyHeldLock.stderr, /Another UI deployment/u);

  chmodSync(www, 0o775);
  const unsafeUiRoot = run(
    "deploy/proofofwork-ui-storage-prune.sh",
    ["--dry-run"],
    cleanupEnvironment,
  );
  assert.equal(unsafeUiRoot.status, 64, unsafeUiRoot.stderr);
  assert.match(unsafeUiRoot.stderr, /owner-controlled/u);
  chmodSync(www, 0o755);
  const mountedTree = run(
    "deploy/proofofwork-ui-storage-prune.sh",
    ["--dry-run"],
    { ...cleanupEnvironment, POW_UI_MOUNTINFO_PATH: fakeMountinfo },
  );
  assert.equal(mountedTree.status, 1, mountedTree.stderr);
  assert.match(mountedTree.stderr, /nested mount/u);

  const dryRun = run(
    "deploy/proofofwork-ui-storage-prune.sh",
    ["--dry-run"],
    cleanupEnvironment,
  );
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /would_prune/u);
  const inheritedDryRun = runWithInheritedLock(
    "deploy/proofofwork-ui-storage-prune.sh",
    ["--dry-run"],
    cleanupEnvironment,
  );
  assert.equal(inheritedDryRun.status, 0, inheritedDryRun.stderr);
  assert.match(inheritedDryRun.stdout, /would_prune/u);
  assert.doesNotMatch(dryRun.stdout, /rollback-preserved|previous-preserved|pre-preserved/u);
  for (const preserved of [
    rollback,
    previous,
    pre,
    oldFailed,
    newestFailed,
    oldStage,
    freshStage,
    oldStaging,
    oldStageRoot,
    oldUiStageRoot,
    oldVarTmp,
    freshVarTmp,
    unmarkedOldStage,
  ]) {
    assert.ok(existsSync(preserved), `Dry run removed ${preserved}`);
  }

  const apply = run(
    "deploy/proofofwork-ui-storage-prune.sh",
    ["--apply"],
    cleanupEnvironment,
  );
  assert.equal(apply.status, 0, apply.stderr);
  for (const preserved of [
    rollback,
    previous,
    pre,
    newestFailed,
    freshStage,
    freshVarTmp,
    unmarkedOldStage,
  ]) {
    assert.ok(existsSync(preserved), `Cleanup removed protected ${preserved}`);
  }
  for (const pruned of [
    oldFailed,
    oldStage,
    oldStaging,
    oldStageRoot,
    oldUiStageRoot,
    oldVarTmp,
  ]) {
    assert.ok(!existsSync(pruned), `Cleanup retained expired ${pruned}`);
  }

  const surfaces = [
    "activity",
    "browser",
    "computer",
    "desktop",
    "growth",
    "id",
    "inception",
    "infinity",
    "landing",
    "marketplace",
    "nft",
    "token",
    "wallet",
    "work",
  ];
  for (const surface of surfaces) {
    const directory = join(www, `proofofwork-${surface}`);
    mkdirSync(join(directory, "assets"), { recursive: true });
    chmodSync(directory, 0o755);
    chmodSync(join(directory, "assets"), 0o755);
    writeFileSync(
      join(directory, "index.html"),
      `<p>${surface}</p><script src="/assets/index-deadbeef.js"></script>`,
    );
    writeFileSync(join(directory, "assets", "index-deadbeef.js"), surface);
    chmodSync(join(directory, "index.html"), 0o644);
    chmodSync(join(directory, "assets", "index-deadbeef.js"), 0o644);
  }
  const nftSurface = join(www, "proofofwork-nft");
  rmSync(nftSurface, { recursive: true });
  cpSync(join(www, "proofofwork-computer"), nftSurface, {
    recursive: true,
    preserveTimestamps: true,
  });
  runChecked("/usr/bin/chmod", ["--recursive", "go-w", nftSurface]);
  const archivePayload = join(fixture, "archive-payload");
  mkdirSync(join(archivePayload, "surfaces"), { recursive: true });
  for (const surface of surfaces) {
    cpSync(
      join(www, `proofofwork-${surface}`),
      join(archivePayload, "surfaces", surface),
      { recursive: true },
    );
  }
  const writeArchiveChecksum = (archivePath) => {
    chmodSync(archivePath, 0o644);
    const archiveSha256 = createHash("sha256")
      .update(readFileSync(archivePath))
      .digest("hex");
    writeFileSync(
      `${archivePath}.sha256`,
      `${archiveSha256}  ${basename(archivePath)}\n`,
    );
    chmodSync(`${archivePath}.sha256`, 0o644);
  };
  const createSurfaceArchive = (archivePath) => {
    const created = spawnSync(
      "tar",
      [
        "--create",
        "--gzip",
        "--file",
        archivePath,
        "--directory",
        archivePayload,
        "surfaces",
      ],
      { encoding: "utf8" },
    );
    assert.equal(created.status, 0, created.stderr);
    chmodSync(archivePath, 0o644);
    writeArchiveChecksum(archivePath);
  };
  const sourceCheckout = join(fixture, "source-checkout");
  mkdirSync(sourceCheckout, { mode: 0o755 });
  chmodSync(sourceCheckout, 0o755);
  runChecked("/usr/bin/git", ["-C", sourceCheckout, "init", "--quiet"]);
  runChecked("/usr/bin/git", [
    "-C",
    sourceCheckout,
    "config",
    "user.name",
    "UI Ops Contract",
  ]);
  runChecked("/usr/bin/git", [
    "-C",
    sourceCheckout,
    "config",
    "user.email",
    "ui-ops-contract@invalid.example",
  ]);
  const sourceFile = join(sourceCheckout, "source.txt");
  const sourceGitignore = join(sourceCheckout, ".gitignore");
  writeFileSync(sourceGitignore, "node_modules/\n.env*.local\n", {
    mode: 0o644,
  });
  chmodSync(sourceGitignore, 0o644);
  writeFileSync(sourceFile, "canonical UI source\n", { mode: 0o644 });
  chmodSync(sourceFile, 0o644);
  runChecked("/usr/bin/git", [
    "-C",
    sourceCheckout,
    "add",
    ".gitignore",
    "source.txt",
  ]);
  runChecked("/usr/bin/git", [
    "-C",
    sourceCheckout,
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  runChecked("/usr/bin/git", [
    "-C",
    sourceCheckout,
    "checkout",
    "--quiet",
    "--detach",
    "HEAD",
  ]);
  const sourceDependencyRoot = join(
    sourceCheckout,
    "node_modules",
    "fixture-dependency",
  );
  mkdirSync(sourceDependencyRoot, { recursive: true, mode: 0o755 });
  runChecked("/usr/bin/chmod", [
    "--recursive",
    "go-w",
    join(sourceCheckout, "node_modules"),
  ]);
  const sourceDependencyFile = join(sourceDependencyRoot, "index.js");
  writeFileSync(sourceDependencyFile, "export const dependency = true;\n", {
    mode: 0o644,
  });
  chmodSync(sourceDependencyFile, 0o644);
  const fullCommit = runChecked("/usr/bin/git", [
    "-C",
    sourceCheckout,
    "rev-parse",
    "HEAD",
  ]);
  const fullTree = runChecked("/usr/bin/git", [
    "-C",
    sourceCheckout,
    "rev-parse",
    "HEAD^{tree}",
  ]);
  const provenanceEnvironment = {
    POW_UI_WWW_ROOT: www,
    POW_UI_RELEASE_ARCHIVE_ROOT: fixture,
    POW_UI_ALLOW_TEST_ROOTS: "1",
    POW_UI_DEPLOY_LOCK: join(fixture, "ui-deploy.lock"),
  };
  chmodSync(www, 0o775);
  const unsafeProvenanceRoot = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify"],
    provenanceEnvironment,
  );
  assert.equal(unsafeProvenanceRoot.status, 64, unsafeProvenanceRoot.stderr);
  assert.match(unsafeProvenanceRoot.stderr, /owner-controlled/u);
  chmodSync(www, 0o755);
  const recordArchive = (archivePath, commit = fullCommit) =>
    run(
      "deploy/proofofwork-ui-release-provenance.sh",
      [
        "record",
        "--release-id",
        "fixture-release",
        "--commit",
        commit,
        "--source-checkout",
        sourceCheckout,
        "--archive",
        archivePath,
      ],
      provenanceEnvironment,
    );

  const ignoredEnvironmentArchive = join(
    fixture,
    "proofofwork-ui-release-ignored-env.tgz",
  );
  createSurfaceArchive(ignoredEnvironmentArchive);
  const ignoredEnvironment = join(sourceCheckout, ".env.production.local");
  writeFileSync(ignoredEnvironment, "VITE_UNATTESTED_INPUT=1\n", {
    mode: 0o600,
  });
  const ignoredInput = recordArchive(ignoredEnvironmentArchive);
  assert.equal(ignoredInput.status, 1, ignoredInput.stderr);
  assert.match(ignoredInput.stderr, /non-dependency ignored path/u);
  assert.ok(!existsSync(`${ignoredEnvironmentArchive}.provenance`));
  unlinkSync(ignoredEnvironment);

  const aliasArchive = join(
    fixture,
    "proofofwork-ui-release-alias-drift.tgz",
  );
  createSurfaceArchive(aliasArchive);
  const nftAliasAsset = join(
    www,
    "proofofwork-nft",
    "assets",
    "index-deadbeef.js",
  );
  writeFileSync(nftAliasAsset, "nft alias drift");
  const aliasDrift = recordArchive(aliasArchive);
  assert.equal(aliasDrift.status, 1, aliasDrift.stderr);
  assert.match(aliasDrift.stderr, /NFT compatibility alias must exactly match Computer/u);
  assert.ok(!existsSync(`${aliasArchive}.provenance`));
  writeFileSync(nftAliasAsset, "computer");

  const mismatchArchive = join(
    fixture,
    "proofofwork-ui-release-mismatch.tgz",
  );
  writeFileSync(
    join(archivePayload, "surfaces", "computer", "assets", "index-deadbeef.js"),
    "mismatched archive bytes",
  );
  createSurfaceArchive(mismatchArchive);
  const mismatch = recordArchive(mismatchArchive);
  assert.equal(mismatch.status, 1, mismatch.stderr);
  assert.match(mismatch.stderr, /archive surface does not match active UI bytes: computer/u);
  assert.ok(!existsSync(`${mismatchArchive}.provenance`));
  writeFileSync(
    join(archivePayload, "surfaces", "computer", "assets", "index-deadbeef.js"),
    "computer",
  );

  const traversalArchive = join(
    fixture,
    "proofofwork-ui-release-traversal.tgz",
  );
  const traversalSource = join(fixture, "escape.txt");
  writeFileSync(traversalSource, "escape");
  const traversalTar = spawnSync(
    "tar",
    [
      "--create",
      "--gzip",
      "--file",
      traversalArchive,
      "--transform=s|^|../|",
      "--directory",
      fixture,
      basename(traversalSource),
    ],
    { encoding: "utf8" },
  );
  assert.equal(traversalTar.status, 0, traversalTar.stderr);
  writeArchiveChecksum(traversalArchive);
  const traversal = recordArchive(traversalArchive);
  assert.equal(traversal.status, 1, traversal.stderr);
  assert.match(traversal.stderr, /archive contains an unsafe path/u);

  const archiveSymlink = join(
    archivePayload,
    "surfaces",
    "id",
    "assets",
    "unsafe-link",
  );
  symlinkSync("index-deadbeef.js", archiveSymlink);
  const symlinkArchive = join(
    fixture,
    "proofofwork-ui-release-symlink.tgz",
  );
  createSurfaceArchive(symlinkArchive);
  const linked = recordArchive(symlinkArchive);
  assert.equal(linked.status, 1, linked.stderr);
  assert.match(linked.stderr, /link or unsupported entry type/u);
  unlinkSync(archiveSymlink);

  const archive = join(fixture, "proofofwork-ui-release-test.tgz");
  createSurfaceArchive(archive);
  const abbreviatedCommit = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    [
      "record",
      "--release-id",
      "fixture-release",
      "--commit",
      "0123456789abcdef",
      "--archive",
      archive,
    ],
    provenanceEnvironment,
  );
  assert.equal(abbreviatedCommit.status, 64, abbreviatedCommit.stderr);
  assert.match(abbreviatedCommit.stderr, /full lowercase hexadecimal object id/u);
  const wrongCommit = `${fullCommit[0] === "0" ? "1" : "0"}${fullCommit.slice(1)}`;
  const wrongSource = recordArchive(archive, wrongCommit);
  assert.equal(wrongSource.status, 1, wrongSource.stderr);
  assert.match(wrongSource.stderr, /does not match the requested full commit/u);

  runChecked("/usr/bin/git", [
    "-C",
    sourceCheckout,
    "update-index",
    "--skip-worktree",
    "source.txt",
  ]);
  writeFileSync(sourceFile, "concealed UI source drift\n");
  const concealedSourceDrift = recordArchive(archive);
  assert.equal(concealedSourceDrift.status, 1, concealedSourceDrift.stderr);
  assert.match(concealedSourceDrift.stderr, /tracked bytes differ from Git/u);
  writeFileSync(sourceFile, "canonical UI source\n");
  runChecked("/usr/bin/git", [
    "-C",
    sourceCheckout,
    "update-index",
    "--no-skip-worktree",
    "source.txt",
  ]);

  const record = recordArchive(archive);
  assert.equal(record.status, 0, record.stderr);
  assert.match(record.stdout, /status=recorded/u);
  assert.ok(existsSync(`${archive}.provenance`));
  const recordedManifest = readFileSync(
    join(www, ".proofofwork-ui-release"),
    "utf8",
  );
  assert.match(recordedManifest, /format=proofofwork-ui-release-v3/u);
  assert.match(recordedManifest, new RegExp(`commit=${fullCommit}`));
  assert.match(recordedManifest, new RegExp(`source_tree=${fullTree}`));
  assert.match(
    recordedManifest,
    /source_dependency_model=node-modules-recursive-v1/u,
  );
  assert.match(recordedManifest, /source_dependency_sha256=[0-9a-f]{64}/u);
  const verify = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify"],
    provenanceEnvironment,
  );
  assert.equal(verify.status, 0, verify.stderr);
  assert.match(verify.stdout, /status=verified/u);
  const inheritedVerify = runWithInheritedLock(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify"],
    provenanceEnvironment,
  );
  assert.equal(inheritedVerify.status, 0, inheritedVerify.stderr);
  assert.match(inheritedVerify.stdout, /status=verified/u);

  const surfaceMountinfo = join(fixture, "surface-mountinfo");
  writeFileSync(
    surfaceMountinfo,
    `2 0 0:2 / ${join(www, "proofofwork-computer", "assets")} rw - tmpfs tmpfs rw\n`,
  );
  const mountedSurface = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify"],
    { ...provenanceEnvironment, POW_UI_MOUNTINFO_PATH: surfaceMountinfo },
  );
  assert.equal(mountedSurface.status, 1, mountedSurface.stderr);
  assert.match(mountedSurface.stderr, /nested mount/u);

  const computerIndex = join(www, "proofofwork-computer", "index.html");
  writeFileSync(
    computerIndex,
    '<p>drift</p><script src="/assets/index-deadbeef.js"></script>',
  );
  const drift = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify"],
    provenanceEnvironment,
  );
  assert.equal(drift.status, 1, drift.stderr);
  assert.match(drift.stderr, /provenance mismatch: computer/u);
  writeFileSync(
    computerIndex,
    '<p>computer</p><script src="/assets/index-deadbeef.js"></script>',
  );

  const symlink = join(www, "proofofwork-id", "assets", "unsafe-link");
  symlinkSync("index-deadbeef.js", symlink);
  const unsafe = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify"],
    provenanceEnvironment,
  );
  assert.equal(unsafe.status, 1, unsafe.stderr);
  assert.match(unsafe.stderr, /unsupported file type/u);
  unlinkSync(symlink);

  const unsafeModeAsset = join(
    www,
    "proofofwork-computer",
    "assets",
    "index-deadbeef.js",
  );
  chmodSync(unsafeModeAsset, 0o666);
  const unsafeMode = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify"],
    provenanceEnvironment,
  );
  assert.equal(unsafeMode.status, 1, unsafeMode.stderr);
  assert.match(unsafeMode.stderr, /unsafe writable or special mode/u);
  chmodSync(unsafeModeAsset, 0o644);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log("UI operations contract checks passed.");
