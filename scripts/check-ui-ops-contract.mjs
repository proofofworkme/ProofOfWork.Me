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
const managedReleasePrune = read("deploy/proofofwork-release-prune.sh");
const storagePrune = read("deploy/proofofwork-ui-storage-prune.sh");
const storagePruneService = read(
  "deploy/proofofwork-ui-storage-prune.service",
);
const storagePruneTimer = read("deploy/proofofwork-ui-storage-prune.timer");
const provenance = read("deploy/proofofwork-ui-release-provenance.sh");
const publisher = read("deploy/proofofwork-ui-release-publish.sh");
const stager = read("deploy/proofofwork-ui-release-stage.py");
const provenanceService = read(
  "deploy/proofofwork-ui-release-provenance.service",
);
const provenanceTimer = read(
  "deploy/proofofwork-ui-release-provenance.timer",
);
const infrastructure = read("OP_RETURN_INFRASTRUCTURE.md");

for (const executable of [
  "deploy/proofofwork-ui-release-publish.sh",
  "deploy/proofofwork-ui-release-stage.py",
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
assert.match(provenance, /format=proofofwork-ui-rollback-evidence-v1/u);
assert.match(provenance, /scope=ui-surfaces-only/u);
assert.match(provenance, /model=exact-surface-files-bytes-and-modes-v1/u);
assert.match(provenance, /record-rollback-evidence/u);
assert.match(provenance, /verify-rollback/u);
assert.match(provenance, /verify-candidate/u);
assert.match(
  provenance,
  /Active UI release provenance cannot be recorded against a staged root/u,
);
assert.match(provenance, /POW_UI_STAGED_ROOT/u);
assert.match(
  provenance,
  /\/var\/tmp\/proofofwork-deploy\/proofofwork-www-stage-/u,
);
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
assert.doesNotMatch(
  provenance,
  /done < <\([\s\S]*?(?:ls-files|ls-tree|find)/u,
);
assert.doesNotMatch(provenance, /mapfile[^\n]*< <\([\s\S]*?find/u);
assert.match(provenance, /ignored-path discovery failed/u);
assert.match(provenance, /surface file discovery failed/u);
assert.match(provenance, /archive top-level discovery failed/u);
assert.match(provenance, /unsupported file type/u);
assert.match(provenance, /verified_archive_sha256/u);
assert.match(provenance, /verify_archive_payload/u);
assert.match(provenance, /archive_payload_model=surfaces-v1/u);
assert.match(provenance, /--same-permissions/u);
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
assert.match(
  provenanceService,
  /^ExecStart=\/usr\/local\/sbin\/proofofwork-ui-release-provenance verify-rollback$/mu,
);
assert.match(provenanceTimer, /OnCalendar=\*:0\/15/u);
assert.match(provenanceTimer, /Persistent=true/u);
assert.match(
  infrastructure,
  /for evidence_path in "\$\{archive_path\}" "\$\{checksum_path\}" "\$\{provenance_path\}"/u,
);
assert.match(
  infrastructure,
  /ln -- "\$\{archive_temporary\}" "\$\{archive_path\}"[\s\S]*ln -- "\$\{checksum_temporary\}" "\$\{checksum_path\}"/u,
);
assert.ok(
  infrastructure.indexOf("published_checksum=0\n\n/usr/local/sbin/proofofwork-ui-release-provenance") <
    infrastructure.indexOf("record-rollback-evidence --archive"),
  "Bootstrap cleanup must stop deleting published archive evidence before recording provenance.",
);

assert.match(publisher, /renameat2/u);
assert.match(publisher, /RENAME_EXCHANGE/u);
assert.match(publisher, /unsupported/u);
assert.match(publisher, /passthrough_digest/u);
assert.match(publisher, /verify_prior_asset_compatibility/u);
assert.match(publisher, /quoted_reference_pattern[\s\S]*\[\^"'`\?#\\x00-\\x20\]\+/u);
assert.match(publisher, /reference\.startswith\("\/"\)[\s\S]*os\.path\.normpath/u);
assert.match(publisher, /verify_current_rollback_capability/u);
assert.match(publisher, /"\$\{provenance_script\}" verify-rollback/u);
assert.match(publisher, /maximum_dependencies = 256/u);
assert.match(publisher, /maximum_reference_edges = 4096/u);
assert.match(publisher, /maximum_reference_candidates = 524288/u);
assert.match(publisher, /maximum_asset_bytes = 64 \* 1024 \* 1024/u);
assert.match(publisher, /maximum_total_bytes = 512 \* 1024 \* 1024/u);
assert.match(publisher, /details\.st_uid/u);
assert.match(publisher, /details\.st_gid/u);
assert.match(publisher, /www_root_metadata/u);
assert.match(publisher, /POW_UI_DEPLOY_LOCK_FD/u);
assert.match(publisher, /POW_UI_STAGED_ROOT=1/u);
assert.match(publisher, /post-swap verification failed/u);
assert.match(publisher, /rollback_root=/u);
assert.match(publisher, /proofofwork-www-pre-/u);
assert.match(publisher, /fsync_parent_directories/u);
assert.match(publisher, /POW_UI_PUBLISH_TEST_FAIL_EXCHANGE_DURABILITY/u);
assert.match(publisher, /POW_UI_PUBLISH_TEST_FAIL_BEFORE_EXCHANGE/u);
assert.match(publisher, /POW_UI_PUBLISH_TEST_FAIL_ACTIVE_PROVENANCE/u);
assert.match(
  publisher,
  /POW_UI_PUBLISH_TEST_FAIL_EXCHANGE_HELPER_AFTER_SYSCALL/u,
);
assert.match(publisher, /POW_UI_PUBLISH_TEST_FAIL_ROLLBACK_DURABILITY/u);
assert.match(publisher, /POW_UI_PUBLISH_TEST_FAIL_RESTORE_VERIFICATION/u);
assert.match(publisher, /truthful stage path/u);
assert.match(
  publisher,
  /exchange_armed=1\s+exchange_directories "\$\{www_root\}" "\$\{stage_root\}"/u,
);
assert.match(publisher, /post-soak evidence classification/u);
assert.doesNotMatch(publisher, /systemctl|caddy/iu);
assert.match(
  stager,
  /COMPATIBILITY_MODEL = "proofofwork-ui-prior-asset-closure-v1"/u,
);
assert.match(stager, /MAXIMUM_DEPENDENCIES = 256/u);
assert.match(stager, /MAXIMUM_REFERENCE_EDGES = 4096/u);
assert.match(stager, /MAXIMUM_REFERENCE_CANDIDATES = 524288/u);
assert.match(stager, /MAXIMUM_ASSET_BYTES = 64 \* 1024 \* 1024/u);
assert.match(stager, /MAXIMUM_TOTAL_BYTES = 512 \* 1024 \* 1024/u);
assert.match(stager, /MAXIMUM_PAYLOAD_ENTRIES = 10000/u);
assert.match(stager, /MAXIMUM_PAYLOAD_BYTES = 1024 \* 1024 \* 1024/u);
assert.match(stager, /Incoming managed UI payload/u);
assert.match(stager, /Final compatibility-complete managed UI payload/u);
assert.match(stager, /entry-count or 1 GiB archive safety limit/u);
assert.match(stager, /POW_UI_STAGE_TEST_MAXIMUM_PAYLOAD_ENTRIES/u);
assert.match(stager, /POW_UI_STAGE_TEST_MAXIMUM_PAYLOAD_BYTES/u);
assert.match(stager, /QUOTED_REFERENCE_PATTERN/u);
assert.match(stager, /CSS_URL_PATTERN/u);
assert.match(stager, /CSS_IMPORT_PATTERN/u);
assert.match(stager, /copy_prior_asset_compatibility/u);
assert.match(stager, /passthrough_fingerprint/u);
assert.match(stager, /Live managed UI surfaces changed while staging/u);
assert.match(stager, /New-build UI surfaces changed while staging/u);
assert.match(stager, /NFT compatibility alias must exactly match Computer/u);
assert.match(stager, /Refusing to replace an existing UI stage root/u);
assert.match(stager, /RENAME_NOREPLACE/u);
assert.match(stager, /Staged new-build surface copy differs/u);
assert.doesNotMatch(stager, /systemctl|caddy/iu);
const publishExchangeIndex = publisher.lastIndexOf(
  'exchange_directories "${www_root}" "${stage_root}"',
);
assert.ok(
  publisher.indexOf('"${provenance_script}" verify-candidate') <
    publishExchangeIndex,
  "The complete staged UI root must be verified before exchange.",
);
assert.ok(
  publisher.indexOf('"${provenance_script}" record') > publishExchangeIndex,
  "Active deployment provenance must be recorded only after exchange.",
);
assert.match(
  infrastructure,
  /install -d -o root -g root -m 0700 \/var\/backups\/proofofwork-ui\/rollback-roots/u,
);
assert.match(
  infrastructure,
  /proofofwork-ui-release-stage[\s\S]*--surfaces-root[\s\S]*--stage-root/u,
);
assert.match(
  infrastructure,
  /payload_identity="\$\(stat --format='%d:%i'[\s\S]*rm --recursive --force --one-file-system -- "\$\{payload_root\}"[\s\S]*ui_legacy_bootstrap_scratch status=removed/u,
);
assert.match(
  infrastructure,
  /immediate prior asset dependency closure[\s\S]*same-surface root-relative/u,
);
assert.match(infrastructure, /one-release compatibility set/u);
assert.match(infrastructure, /post-deploy soak[\s\S]*checksum, archive, classify/u);
assert.match(infrastructure, /separately co-attests/u);
assert.match(infrastructure, /proofofwork-ui-rollback-evidence-v1/u);
assert.match(
  infrastructure,
  /bytes-only[\s\S]*no\s+release id, source commit, source tree, build, dependency/u,
);
assert.match(
  infrastructure,
  /record-rollback-evidence[\s\S]*verify-rollback/u,
);
assert.match(
  infrastructure,
  /Never silently delete or overwrite that historical record/u,
);
assert.match(
  infrastructure,
  /regular-file relative paths, bytes, modes, and\s+file count[\s\S]*Directory modes[\s\S]*independently safety-validated/u,
);
assert.match(
  infrastructure,
  /external HTTP smoke[\s\S]*cannot be rolled back automatically/u,
);
assert.match(
  infrastructure,
  /path, type,\s+mode, uid, gid, and regular-file bytes/u,
);

assert.match(releasePruneService, /^TimeoutStartSec=30m$/mu);
assert.match(releasePruneService, /^Nice=10$/mu);
assert.match(releasePruneService, /^IOSchedulingClass=idle$/mu);
assert.match(releasePruneService, /^CPUWeight=10$/mu);
assert.match(releasePruneService, /^IOWeight=10$/mu);
assert.match(releasePruneService, /ProtectSystem=strict/u);
assert.match(
  managedReleasePrune,
  /POW_RELEASE_UI_ROLLBACK_ROOT:-\/var\/backups\/proofofwork-ui\/rollback-roots/u,
);
assert.match(managedReleasePrune, /protect_ui_manifest_archive/u);
assert.match(managedReleasePrune, /complete-root rollback/u);
assert.match(
  releasePruneService,
  /ReadWritePaths=\/var\/backups\/proofofwork-ui\/releases \/run\/proofofwork-ui/u,
);

for (const service of [
  storageHealthService,
  storagePruneService,
  provenanceService,
  releasePruneService,
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

for (const lockAwareScript of [
  storagePrune,
  managedReleasePrune,
  provenance,
  publisher,
]) {
  assert.match(
    lockAwareScript,
    /POW_UI_DEPLOY_LOCK:-\/run\/proofofwork-ui\/deploy\.lock/u,
  );
  assert.match(lockAwareScript, /POW_UI_DEPLOY_LOCK_FD/u);
  assert.match(lockAwareScript, /\/proc\/self\/fd\//u);
  assert.match(
    lockAwareScript,
    /must be owner-controlled and not group\/world writable/u,
  );
}
assert.match(publisher, /"\$\{www_root\}\|UI root"/u);
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
  assert.equal(surfaces.length, 14);
  assert.equal(new Set(surfaces).size, 14);
  assert.match(publisher, /surface set must contain exactly 14 entries/u);
  assert.match(provenance, /surface set must contain exactly 14 entries/u);
  const priorAppAssetName = "App-cafebabefeed.js";
  const priorCssAssetName = "theme-decafbad.css";
  const priorImageAssetName = "pixel-a1b2c3d4.png";
  const priorRootAssetName = "favicon.svg";
  const priorBareAssetName = "icons/favicon.svg";
  const priorUnreferencedAssetName = "orphan-01020304.js";
  const nonPathQuotedLiterals = [
    '"plain text"',
    '"escaped\\\\literal"',
    '"☃"',
    '".."',
    ...Array.from({ length: 4_100 }, (_, index) => `"not-a-path-${index}"`),
  ].join(";");
  const priorEntryBytes = (surface) =>
    `import "./${priorAppAssetName}";\nexport default ${JSON.stringify(surface)};\n`;
  for (const surface of surfaces) {
    const directory = join(www, `proofofwork-${surface}`);
    mkdirSync(join(directory, "assets"), { recursive: true });
    mkdirSync(join(directory, "icons"), { recursive: true });
    chmodSync(directory, 0o755);
    chmodSync(join(directory, "assets"), 0o755);
    chmodSync(join(directory, "icons"), 0o755);
    writeFileSync(
      join(directory, "index.html"),
      `<link rel="icon" href="/${priorRootAssetName}"><img src="${priorBareAssetName}"><p>${surface}</p><script src="/assets/index-deadbeef.js"></script>${surface === "computer" ? `<script>${nonPathQuotedLiterals}</script>` : ""}`,
    );
    writeFileSync(
      join(directory, priorRootAssetName),
      `<svg>${surface}</svg>`,
    );
    writeFileSync(join(directory, priorBareAssetName), `icon-${surface}`);
    writeFileSync(
      join(directory, "assets", "index-deadbeef.js"),
      priorEntryBytes(surface),
    );
    writeFileSync(
      join(directory, "assets", priorAppAssetName),
      `import "./${priorCssAssetName}";\nexport const app = ${JSON.stringify(surface)};\n`,
    );
    writeFileSync(
      join(directory, "assets", priorCssAssetName),
      `.surface-${surface}{background-image:url("${priorImageAssetName}")}`,
    );
    writeFileSync(
      join(directory, "assets", priorImageAssetName),
      `image-${surface}`,
    );
    writeFileSync(
      join(directory, "assets", priorUnreferencedAssetName),
      `unreferenced-${surface}`,
    );
    chmodSync(join(directory, "index.html"), 0o644);
    chmodSync(join(directory, priorRootAssetName), 0o644);
    chmodSync(join(directory, priorBareAssetName), 0o644);
    chmodSync(join(directory, "assets", "index-deadbeef.js"), 0o644);
    chmodSync(join(directory, "assets", priorAppAssetName), 0o644);
    chmodSync(join(directory, "assets", priorCssAssetName), 0o644);
    chmodSync(join(directory, "assets", priorImageAssetName), 0o644);
    chmodSync(join(directory, "assets", priorUnreferencedAssetName), 0o644);
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
  runChecked("/usr/bin/chmod", [
    "--recursive",
    "go-w",
    join(archivePayload, "surfaces"),
  ]);
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
  const productionShapedInjection = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify"],
    {
      ...provenanceEnvironment,
      POW_UI_ALLOW_TEST_ROOTS: "",
      POW_UI_TEST_FAIL_SURFACE_DISCOVERY_AFTER_OUTPUT: "1",
    },
  );
  assert.equal(productionShapedInjection.status, 64, productionShapedInjection.stderr);
  assert.match(productionShapedInjection.stderr, /failure injection requires/u);
  chmodSync(fixture, 0o775);
  const unsafeArchiveRoot = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify"],
    provenanceEnvironment,
  );
  assert.equal(unsafeArchiveRoot.status, 64, unsafeArchiveRoot.stderr);
  assert.match(unsafeArchiveRoot.stderr, /UI archive root must be owner-controlled/u);
  chmodSync(fixture, 0o700);
  chmodSync(www, 0o775);
  const unsafeProvenanceRoot = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify"],
    provenanceEnvironment,
  );
  assert.equal(unsafeProvenanceRoot.status, 64, unsafeProvenanceRoot.stderr);
  assert.match(unsafeProvenanceRoot.stderr, /owner-controlled/u);
  chmodSync(www, 0o755);
  const recordArchive = (
    archivePath,
    commit = fullCommit,
    environment = provenanceEnvironment,
  ) =>
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
      environment,
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

  const ignoredDiscoveryArchive = join(
    fixture,
    "proofofwork-ui-release-ignored-discovery-failure.tgz",
  );
  createSurfaceArchive(ignoredDiscoveryArchive);
  const ignoredDiscoveryFailure = recordArchive(
    ignoredDiscoveryArchive,
    fullCommit,
    {
      ...provenanceEnvironment,
      POW_UI_TEST_FAIL_IGNORED_DISCOVERY_AFTER_OUTPUT: "1",
    },
  );
  assert.equal(ignoredDiscoveryFailure.status, 1, ignoredDiscoveryFailure.stderr);
  assert.match(ignoredDiscoveryFailure.stderr, /ignored-path discovery failed/u);
  assert.ok(!existsSync(`${ignoredDiscoveryArchive}.provenance`));

  const surfaceDiscoveryArchive = join(
    fixture,
    "proofofwork-ui-release-surface-discovery-failure.tgz",
  );
  createSurfaceArchive(surfaceDiscoveryArchive);
  const surfaceDiscoveryFailure = recordArchive(
    surfaceDiscoveryArchive,
    fullCommit,
    {
      ...provenanceEnvironment,
      POW_UI_TEST_FAIL_SURFACE_DISCOVERY_AFTER_OUTPUT: "1",
    },
  );
  assert.equal(surfaceDiscoveryFailure.status, 1, surfaceDiscoveryFailure.stderr);
  assert.match(surfaceDiscoveryFailure.stderr, /surface file discovery failed/u);
  assert.ok(!existsSync(`${surfaceDiscoveryArchive}.provenance`));

  const archiveTopLevelDiscoveryArchive = join(
    fixture,
    "proofofwork-ui-release-archive-discovery-failure.tgz",
  );
  createSurfaceArchive(archiveTopLevelDiscoveryArchive);
  const archiveTopLevelDiscoveryFailure = recordArchive(
    archiveTopLevelDiscoveryArchive,
    fullCommit,
    {
      ...provenanceEnvironment,
      POW_UI_TEST_FAIL_ARCHIVE_TOP_LEVEL_DISCOVERY_AFTER_OUTPUT: "1",
    },
  );
  assert.equal(
    archiveTopLevelDiscoveryFailure.status,
    1,
    archiveTopLevelDiscoveryFailure.stderr,
  );
  assert.match(
    archiveTopLevelDiscoveryFailure.stderr,
    /archive top-level discovery failed/u,
  );
  assert.ok(!existsSync(`${archiveTopLevelDiscoveryArchive}.provenance`));

  const unsafeArchiveDirectory = join(
    archivePayload,
    "surfaces",
    "computer",
  );
  chmodSync(unsafeArchiveDirectory, 0o777);
  const unsafeArchiveDirectoryArchive = join(
    fixture,
    "proofofwork-ui-release-unsafe-directory-mode.tgz",
  );
  createSurfaceArchive(unsafeArchiveDirectoryArchive);
  chmodSync(unsafeArchiveDirectory, 0o755);
  assert.equal(statSync(unsafeArchiveDirectory).mode & 0o7777, 0o755);
  assert.equal(
    statSync(join(archivePayload, "surfaces", "activity")).mode & 0o7777,
    0o755,
  );
  const unsafeArchiveDirectoryRecord = recordArchive(
    unsafeArchiveDirectoryArchive,
  );
  assert.equal(
    unsafeArchiveDirectoryRecord.status,
    1,
    unsafeArchiveDirectoryRecord.stderr,
  );
  assert.match(
    unsafeArchiveDirectoryRecord.stderr,
    /unsafe writable or special mode/u,
  );
  assert.ok(!existsSync(`${unsafeArchiveDirectoryArchive}.provenance`));

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
  writeFileSync(nftAliasAsset, priorEntryBytes("computer"));

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
    priorEntryBytes("computer"),
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

  const candidateVerification = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    [
      "verify-candidate",
      "--release-id",
      "fixture-release",
      "--commit",
      fullCommit,
      "--source-checkout",
      sourceCheckout,
      "--archive",
      archive,
    ],
    {
      ...provenanceEnvironment,
      POW_UI_STAGED_ROOT: "1",
    },
  );
  assert.equal(candidateVerification.status, 0, candidateVerification.stderr);
  assert.match(candidateVerification.stdout, /ui_release_candidate status=verified/u);
  assert.equal(existsSync(join(www, ".proofofwork-ui-release")), false);
  assert.equal(existsSync(`${archive}.provenance`), false);
  const stagedRecord = recordArchive(archive, fullCommit, {
    ...provenanceEnvironment,
    POW_UI_STAGED_ROOT: "1",
  });
  assert.equal(stagedRecord.status, 64, stagedRecord.stderr);
  assert.match(stagedRecord.stderr, /cannot be recorded against a staged root/u);
  assert.equal(existsSync(join(www, ".proofofwork-ui-release")), false);
  assert.equal(existsSync(`${archive}.provenance`), false);

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
  const canonicalComputerIndex = readFileSync(computerIndex, "utf8");
  writeFileSync(
    computerIndex,
    `${canonicalComputerIndex}\n<p>drift</p>`,
  );
  const drift = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify"],
    provenanceEnvironment,
  );
  assert.equal(drift.status, 1, drift.stderr);
  assert.match(drift.stderr, /provenance mismatch: computer/u);
  writeFileSync(computerIndex, canonicalComputerIndex);

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

  const publisherRollbackRoot = join(fixture, "publisher-rollbacks");
  mkdirSync(publisherRollbackRoot, { mode: 0o700 });
  chmodSync(publisherRollbackRoot, 0o700);
  const provenanceScript = join(
    process.cwd(),
    "deploy/proofofwork-ui-release-provenance.sh",
  );
  const candidateComputerAssetName = "index-feedfacecafebabe.js";

  const preparePublisherRelease = (releaseId, computerBytes) => {
    const stagedRoot = join(fixture, `proofofwork-www-stage-${releaseId}`);
    runChecked("/usr/bin/cp", ["--archive", "--", www, stagedRoot]);
    unlinkSync(join(stagedRoot, ".proofofwork-ui-release"));
    writeFileSync(
      join(
        stagedRoot,
        "proofofwork-computer",
        "assets",
        candidateComputerAssetName,
      ),
      computerBytes,
      { mode: 0o644 },
    );
    writeFileSync(
      join(stagedRoot, "proofofwork-computer", "index.html"),
      `<link rel="icon" href="/${priorRootAssetName}"><p>computer-${releaseId}</p><script src="/assets/${candidateComputerAssetName}"></script>`,
      { mode: 0o644 },
    );
    rmSync(join(stagedRoot, "proofofwork-nft"), { recursive: true });
    cpSync(
      join(stagedRoot, "proofofwork-computer"),
      join(stagedRoot, "proofofwork-nft"),
      { recursive: true, preserveTimestamps: true },
    );
    for (const surface of surfaces) {
      const surfaceRoot = join(stagedRoot, `proofofwork-${surface}`);
      const inheritedUnreferencedAsset = join(
        surfaceRoot,
        "assets",
        priorUnreferencedAssetName,
      );
      if (existsSync(inheritedUnreferencedAsset)) {
        unlinkSync(inheritedUnreferencedAsset);
      }
      runChecked("/usr/bin/find", [
        surfaceRoot,
        "-type",
        "d",
        "-exec",
        "chmod",
        "0755",
        "{}",
        "+",
      ]);
      runChecked("/usr/bin/find", [
        surfaceRoot,
        "-type",
        "f",
        "-exec",
        "chmod",
        "0644",
        "{}",
        "+",
      ]);
    }

    const publisherPayload = join(fixture, `publisher-payload-${releaseId}`);
    mkdirSync(join(publisherPayload, "surfaces"), { recursive: true });
    for (const surface of surfaces) {
      runChecked("/usr/bin/cp", [
        "--archive",
        "--",
        join(stagedRoot, `proofofwork-${surface}`),
        join(publisherPayload, "surfaces", surface),
      ]);
      runChecked("/usr/bin/find", [
        join(publisherPayload, "surfaces", surface),
        "-type",
        "d",
        "-exec",
        "chmod",
        "0755",
        "{}",
        "+",
      ]);
      runChecked("/usr/bin/find", [
        join(publisherPayload, "surfaces", surface),
        "-type",
        "f",
        "-exec",
        "chmod",
        "0644",
        "{}",
        "+",
      ]);
      assert.equal(
        statSync(join(publisherPayload, "surfaces", surface)).mode & 0o7777,
        0o755,
      );
      assert.equal(
        statSync(
          join(publisherPayload, "surfaces", surface, "index.html"),
        ).mode & 0o7777,
        0o644,
      );
    }
    const publisherArchive = join(
      fixture,
      `proofofwork-ui-release-${releaseId}.tgz`,
    );
    const archiveResult = spawnSync(
      "tar",
      [
        "--create",
        "--gzip",
        "--file",
        publisherArchive,
        "--directory",
        publisherPayload,
        "surfaces",
      ],
      { encoding: "utf8" },
    );
    assert.equal(archiveResult.status, 0, archiveResult.stderr);
    writeArchiveChecksum(publisherArchive);

    const publisherSource = join(
      fixture,
      `proofofwork-ui-source-${releaseId}`,
    );
    runChecked("/usr/bin/cp", [
      "--archive",
      "--",
      sourceCheckout,
      publisherSource,
    ]);
    runChecked("/usr/bin/chmod", ["--recursive", "go-w", publisherSource]);
    return {
      candidateComputerAsset: join(
        stagedRoot,
        "proofofwork-computer",
        "assets",
        candidateComputerAssetName,
      ),
      publisherArchive,
      publisherSource,
      stagedRoot,
    };
  };

  const publisherEnvironment = {
    POW_UI_PUBLISH_WWW_ROOT: www,
    POW_UI_PUBLISH_STAGING_ROOT: fixture,
    POW_UI_RELEASE_ARCHIVE_ROOT: fixture,
    POW_UI_PUBLISH_ROLLBACK_ROOT: publisherRollbackRoot,
    POW_UI_PUBLISH_PROVENANCE_SCRIPT: provenanceScript,
    POW_UI_ALLOW_TEST_ROOTS: "1",
    POW_UI_DEPLOY_LOCK: provenanceEnvironment.POW_UI_DEPLOY_LOCK,
  };
  const publisherArguments = (releaseId, prepared) => [
    "--release-id",
    releaseId,
    "--commit",
    fullCommit,
    "--source-checkout",
    prepared.publisherSource,
    "--archive",
    prepared.publisherArchive,
  ];
  const stagerEnvironment = {
    POW_UI_STAGE_WWW_ROOT: www,
    POW_UI_STAGE_STAGING_ROOT: fixture,
    POW_UI_ALLOW_TEST_ROOTS: "1",
    POW_UI_DEPLOY_LOCK: provenanceEnvironment.POW_UI_DEPLOY_LOCK,
  };
  const runStager = (releaseId, environment = stagerEnvironment) => {
    const surfacesRoot = join(
      fixture,
      `proofofwork-ui-surfaces-${releaseId}`,
      "surfaces",
    );
    const stagedRoot = join(fixture, `proofofwork-www-stage-${releaseId}`);
    const result = spawnSync(
      "/usr/bin/python3",
      [
        "deploy/proofofwork-ui-release-stage.py",
        "--release-id",
        releaseId,
        "--surfaces-root",
        surfacesRoot,
        "--stage-root",
        stagedRoot,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, ...environment },
      },
    );
    return { result, stagedRoot, surfacesRoot };
  };
  const prepareCleanSurfaces = (releaseId) => {
    const payloadRoot = join(
      fixture,
      `proofofwork-ui-surfaces-${releaseId}`,
    );
    const surfacesRoot = join(payloadRoot, "surfaces");
    mkdirSync(surfacesRoot, { recursive: true, mode: 0o755 });
    chmodSync(payloadRoot, 0o755);
    chmodSync(surfacesRoot, 0o755);
    for (const surface of surfaces) {
      const directory = join(surfacesRoot, surface);
      const assetName = `candidate-${surface}.js`;
      mkdirSync(join(directory, "assets"), {
        recursive: true,
        mode: 0o755,
      });
      chmodSync(directory, 0o755);
      chmodSync(join(directory, "assets"), 0o755);
      writeFileSync(
        join(directory, "index.html"),
        `<p>candidate-${surface}</p><script src="/assets/${assetName}"></script>`,
        { mode: 0o644 },
      );
      writeFileSync(
        join(directory, "assets", assetName),
        `export const surface = ${JSON.stringify(surface)};\n`,
        { mode: 0o644 },
      );
      chmodSync(join(directory, "index.html"), 0o644);
      chmodSync(join(directory, "assets", assetName), 0o644);
    }
    rmSync(join(surfacesRoot, "nft"), { recursive: true });
    cpSync(join(surfacesRoot, "computer"), join(surfacesRoot, "nft"), {
      recursive: true,
      preserveTimestamps: true,
    });
    runChecked("/usr/bin/chmod", [
      "--recursive",
      "go-w",
      payloadRoot,
    ]);
    return { payloadRoot, surfacesRoot };
  };
  const archiveStagedSurfaces = (releaseId, stagedRoot) => {
    const payloadRoot = join(fixture, `stager-archive-payload-${releaseId}`);
    mkdirSync(join(payloadRoot, "surfaces"), {
      recursive: true,
      mode: 0o755,
    });
    for (const surface of surfaces) {
      runChecked("/usr/bin/cp", [
        "--archive",
        "--",
        join(stagedRoot, `proofofwork-${surface}`),
        join(payloadRoot, "surfaces", surface),
      ]);
    }
    const archivePath = join(
      fixture,
      `proofofwork-ui-release-${releaseId}.tgz`,
    );
    const archiveResult = spawnSync(
      "tar",
      [
        "--create",
        "--gzip",
        "--file",
        archivePath,
        "--directory",
        payloadRoot,
        "surfaces",
      ],
      { encoding: "utf8" },
    );
    assert.equal(archiveResult.status, 0, archiveResult.stderr);
    writeArchiveChecksum(archivePath);
    return { archivePath, payloadRoot };
  };

  const unattributedReleaseId = "publisher-unattributed";
  const unattributedPrepared = preparePublisherRelease(
    unattributedReleaseId,
    "unattributed release bytes",
  );
  unlinkSync(join(www, ".proofofwork-ui-release"));
  const unattributedPublish = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(unattributedReleaseId, unattributedPrepared),
    publisherEnvironment,
  );
  assert.equal(unattributedPublish.status, 1, unattributedPublish.stderr);
  assert.match(unattributedPublish.stderr, /rollback capability is unattributed/u);
  assert.equal(existsSync(`${unattributedPrepared.publisherArchive}.provenance`), false);
  assert.ok(existsSync(unattributedPrepared.stagedRoot));

  const legacyArchive = join(
    fixture,
    "proofofwork-ui-release-legacy-hybrid-bytes.tgz",
  );
  createSurfaceArchive(legacyArchive);
  const legacyRecord = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["record-rollback-evidence", "--archive", legacyArchive],
    provenanceEnvironment,
  );
  assert.equal(legacyRecord.status, 0, legacyRecord.stderr);
  assert.match(legacyRecord.stdout, /ui_rollback_evidence status=recorded/u);
  const legacyManifestPath = join(www, ".proofofwork-ui-release");
  const legacyManifest = readFileSync(legacyManifestPath, "utf8");
  assert.equal(
    legacyManifest,
    readFileSync(`${legacyArchive}.provenance`, "utf8"),
    "Legacy root evidence must be byte-equal to its archive-adjacent provenance.",
  );
  assert.match(legacyManifest, /^format=proofofwork-ui-rollback-evidence-v1$/mu);
  assert.match(legacyManifest, /^scope=ui-surfaces-only$/mu);
  assert.match(
    legacyManifest,
    /^model=exact-surface-files-bytes-and-modes-v1$/mu,
  );
  assert.doesNotMatch(
    legacyManifest,
    /^(?:release_id|commit|source_tree|source_attestation|source_dependency_|deployed_at)=/mu,
  );
  const legacyAllowedKeys = new Set([
    "format",
    "scope",
    "model",
    "recorded_at",
    "archive_name",
    "archive_sha256",
    "archive_payload_model",
    ...surfaces.flatMap((surface) => [
      `surface.${surface}.file_count`,
      `surface.${surface}.sha256`,
    ]),
  ]);
  for (const line of legacyManifest.trimEnd().split("\n")) {
    assert.ok(
      legacyAllowedKeys.has(line.slice(0, line.indexOf("="))),
      `Legacy evidence made a non-bytes claim: ${line}`,
    );
  }
  const legacyVerify = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify-rollback"],
    provenanceEnvironment,
  );
  assert.equal(legacyVerify.status, 0, legacyVerify.stderr);
  assert.match(legacyVerify.stdout, /ui_rollback_evidence status=verified/u);
  const legacyNoOverwrite = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["record-rollback-evidence", "--archive", legacyArchive],
    provenanceEnvironment,
  );
  assert.equal(legacyNoOverwrite.status, 1, legacyNoOverwrite.stderr);
  assert.match(legacyNoOverwrite.stderr, /Refusing to replace an existing/u);

  const legacyArchiveBytes = readFileSync(legacyArchive);
  writeFileSync(legacyArchive, Buffer.concat([legacyArchiveBytes, Buffer.from("drift")]));
  const legacyArchiveDrift = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify-rollback"],
    provenanceEnvironment,
  );
  assert.equal(legacyArchiveDrift.status, 1, legacyArchiveDrift.stderr);
  assert.match(legacyArchiveDrift.stderr, /checksum does not match/u);
  writeFileSync(legacyArchive, legacyArchiveBytes);
  chmodSync(legacyArchive, 0o644);

  writeFileSync(
    `${legacyArchive}.provenance`,
    `${legacyManifest}unknown_claim=forbidden\n`,
  );
  chmodSync(`${legacyArchive}.provenance`, 0o644);
  const legacyProvenanceDrift = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify-rollback"],
    provenanceEnvironment,
  );
  assert.equal(legacyProvenanceDrift.status, 1, legacyProvenanceDrift.stderr);
  assert.match(legacyProvenanceDrift.stderr, /not bound to matching/u);
  writeFileSync(`${legacyArchive}.provenance`, legacyManifest);
  chmodSync(`${legacyArchive}.provenance`, 0o644);

  const preLegacyDriftIndex = readFileSync(computerIndex, "utf8");
  writeFileSync(computerIndex, `${preLegacyDriftIndex}\nlegacy-drift`);
  const legacySurfaceDrift = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify-rollback"],
    provenanceEnvironment,
  );
  assert.equal(legacySurfaceDrift.status, 1, legacySurfaceDrift.stderr);
  assert.match(legacySurfaceDrift.stderr, /rollback evidence mismatch: computer/u);
  writeFileSync(computerIndex, preLegacyDriftIndex);

  const stagerReleaseId = "stager-contract";
  const stagerPayload = prepareCleanSurfaces(stagerReleaseId);
  const staged = runStager(stagerReleaseId);
  assert.equal(staged.result.status, 0, staged.result.stderr);
  assert.match(
    staged.result.stdout,
    /ui_release_stage status=staged[\s\S]*compatibility_model=proofofwork-ui-prior-asset-closure-v1/u,
  );
  const stagedMetrics = staged.result.stdout.match(
    /payload_entries=(?<payloadEntries>\d+) payload_bytes=(?<payloadBytes>\d+) final_entries=(?<finalEntries>\d+) final_bytes=(?<finalBytes>\d+)/u,
  );
  assert.ok(stagedMetrics?.groups, staged.result.stdout);
  const payloadEntryCount = Number(stagedMetrics.groups.payloadEntries);
  const payloadByteCount = Number(stagedMetrics.groups.payloadBytes);
  const finalEntryCount = Number(stagedMetrics.groups.finalEntries);
  const finalByteCount = Number(stagedMetrics.groups.finalBytes);
  assert.ok(payloadEntryCount > 1);
  assert.ok(payloadByteCount > 0);
  assert.ok(finalEntryCount > payloadEntryCount);
  assert.ok(finalByteCount > payloadByteCount);
  assert.equal(existsSync(join(staged.stagedRoot, ".proofofwork-ui-release")), false);
  assert.equal(
    readFileSync(
      join(
        staged.stagedRoot,
        "proofofwork-computer",
        "assets",
        "candidate-computer.js",
      ),
      "utf8",
    ),
    'export const surface = "computer";\n',
  );
  for (const dependency of [
    "index-deadbeef.js",
    priorAppAssetName,
    priorCssAssetName,
    priorImageAssetName,
  ]) {
    assert.equal(
      readFileSync(
        join(
          staged.stagedRoot,
          "proofofwork-computer",
          "assets",
          dependency,
        ),
        "utf8",
      ),
      readFileSync(
        join(www, "proofofwork-computer", "assets", dependency),
        "utf8",
      ),
      `The stager lost or changed prior compatibility dependency ${dependency}.`,
    );
  }
  for (const dependency of [priorRootAssetName, priorBareAssetName]) {
    assert.equal(
      readFileSync(
        join(staged.stagedRoot, "proofofwork-computer", dependency),
        "utf8",
      ),
      readFileSync(join(www, "proofofwork-computer", dependency), "utf8"),
      `The stager lost or changed prior compatibility dependency ${dependency}.`,
    );
  }
  assert.equal(
    existsSync(
      join(
        staged.stagedRoot,
        "proofofwork-computer",
        "assets",
        priorUnreferencedAssetName,
      ),
    ),
    false,
    "The stager retained an unrelated prior asset.",
  );
  assert.equal(
    readFileSync(
      join(
        staged.stagedRoot,
        "proofofwork-computer.rollback-preserved",
        "evidence.txt",
      ),
      "utf8",
    ),
    readFileSync(join(rollback, "evidence.txt"), "utf8"),
    "The stager changed non-managed passthrough evidence.",
  );
  const stagerArchive = archiveStagedSurfaces(
    stagerReleaseId,
    staged.stagedRoot,
  );
  const stagerSource = join(
    fixture,
    `proofofwork-ui-source-${stagerReleaseId}`,
  );
  runChecked("/usr/bin/cp", [
    "--archive",
    "--",
    sourceCheckout,
    stagerSource,
  ]);
  runChecked("/usr/bin/chmod", ["--recursive", "go-w", stagerSource]);
  const stagerPublisherPreflight = run(
    "deploy/proofofwork-ui-release-publish.sh",
    [
      "--release-id",
      stagerReleaseId,
      "--commit",
      fullCommit,
      "--source-checkout",
      stagerSource,
      "--archive",
      stagerArchive.archivePath,
    ],
    {
      ...publisherEnvironment,
      POW_UI_PUBLISH_TEST_FAIL_BEFORE_EXCHANGE: "1",
    },
  );
  assert.equal(
    stagerPublisherPreflight.status,
    1,
    stagerPublisherPreflight.stderr,
  );
  assert.match(
    stagerPublisherPreflight.stderr,
    /Injected failure after candidate verification and before atomic exchange/u,
    "The publisher must accept the stager's complete candidate contract before the injected stop.",
  );
  assert.ok(existsSync(staged.stagedRoot));
  assert.equal(existsSync(`${stagerArchive.archivePath}.provenance`), false);
  assert.equal(readFileSync(computerIndex, "utf8"), preLegacyDriftIndex);
  rmSync(staged.stagedRoot, { recursive: true });
  rmSync(stagerPayload.payloadRoot, { recursive: true });
  rmSync(stagerSource, { recursive: true });
  rmSync(stagerArchive.payloadRoot, { recursive: true });
  unlinkSync(stagerArchive.archivePath);
  unlinkSync(`${stagerArchive.archivePath}.sha256`);

  const boundaryReleaseId = "stager-payload-boundary";
  const boundaryPayload = prepareCleanSurfaces(boundaryReleaseId);
  const boundaryStage = runStager(boundaryReleaseId, {
    ...stagerEnvironment,
    POW_UI_STAGE_TEST_MAXIMUM_PAYLOAD_ENTRIES: String(finalEntryCount),
    POW_UI_STAGE_TEST_MAXIMUM_PAYLOAD_BYTES: String(finalByteCount),
  });
  assert.equal(boundaryStage.result.status, 0, boundaryStage.result.stderr);
  assert.match(
    boundaryStage.result.stdout,
    new RegExp(
      `final_entries=${finalEntryCount} final_bytes=${finalByteCount}`,
      "u",
    ),
    "The provenance-equivalent aggregate limits must accept exact equality.",
  );
  rmSync(boundaryStage.stagedRoot, { recursive: true });
  rmSync(boundaryPayload.payloadRoot, { recursive: true });

  const incomingOverReleaseId = "stager-incoming-over-limit";
  const incomingOverPayload = prepareCleanSurfaces(incomingOverReleaseId);
  const incomingEntryOver = runStager(incomingOverReleaseId, {
    ...stagerEnvironment,
    POW_UI_STAGE_TEST_MAXIMUM_PAYLOAD_ENTRIES: String(payloadEntryCount - 1),
  });
  assert.equal(incomingEntryOver.result.status, 1, incomingEntryOver.result.stderr);
  assert.match(
    incomingEntryOver.result.stderr,
    /Incoming managed UI payload exceeds the entry-count or 1 GiB/u,
  );
  assert.equal(existsSync(incomingEntryOver.stagedRoot), false);
  const incomingByteOver = runStager(incomingOverReleaseId, {
    ...stagerEnvironment,
    POW_UI_STAGE_TEST_MAXIMUM_PAYLOAD_BYTES: String(payloadByteCount - 1),
  });
  assert.equal(incomingByteOver.result.status, 1, incomingByteOver.result.stderr);
  assert.match(
    incomingByteOver.result.stderr,
    /Incoming managed UI payload exceeds the entry-count or 1 GiB/u,
  );
  assert.equal(existsSync(incomingByteOver.stagedRoot), false);
  rmSync(incomingOverPayload.payloadRoot, { recursive: true });

  const finalOverReleaseId = "stager-final-over-limit";
  const finalOverPayload = prepareCleanSurfaces(finalOverReleaseId);
  const finalEntryOver = runStager(finalOverReleaseId, {
    ...stagerEnvironment,
    POW_UI_STAGE_TEST_MAXIMUM_PAYLOAD_ENTRIES: String(finalEntryCount - 1),
  });
  assert.equal(finalEntryOver.result.status, 1, finalEntryOver.result.stderr);
  assert.match(
    finalEntryOver.result.stderr,
    /Final compatibility-complete managed UI payload exceeds the entry-count or 1 GiB/u,
  );
  assert.equal(existsSync(finalEntryOver.stagedRoot), false);
  const finalByteOver = runStager(finalOverReleaseId, {
    ...stagerEnvironment,
    POW_UI_STAGE_TEST_MAXIMUM_PAYLOAD_BYTES: String(finalByteCount - 1),
  });
  assert.equal(finalByteOver.result.status, 1, finalByteOver.result.stderr);
  assert.match(
    finalByteOver.result.stderr,
    /Final compatibility-complete managed UI payload exceeds the entry-count or 1 GiB/u,
  );
  assert.equal(existsSync(finalByteOver.stagedRoot), false);
  rmSync(finalOverPayload.payloadRoot, { recursive: true });

  const stageCollisionReleaseId = "stager-collision";
  const collisionPayload = prepareCleanSurfaces(stageCollisionReleaseId);
  for (const surface of ["computer", "nft"]) {
    writeFileSync(
      join(
        collisionPayload.surfacesRoot,
        surface,
        "assets",
        priorAppAssetName,
      ),
      "different candidate collision bytes\n",
      { mode: 0o644 },
    );
  }
  const collisionStage = runStager(stageCollisionReleaseId);
  assert.equal(collisionStage.result.status, 1, collisionStage.result.stderr);
  assert.match(collisionStage.result.stderr, /collision differs from prior bytes/u);
  assert.equal(existsSync(collisionStage.stagedRoot), false);
  rmSync(collisionPayload.payloadRoot, { recursive: true });

  const symlinkReleaseId = "stager-symlink";
  const symlinkPayload = prepareCleanSurfaces(symlinkReleaseId);
  const symlinkAsset = join(
    symlinkPayload.surfacesRoot,
    "browser",
    "assets",
    "candidate-browser.js",
  );
  unlinkSync(symlinkAsset);
  symlinkSync("candidate-computer.js", symlinkAsset);
  const symlinkStage = runStager(symlinkReleaseId);
  assert.equal(symlinkStage.result.status, 1, symlinkStage.result.stderr);
  assert.match(symlinkStage.result.stderr, /unsupported file type/u);
  assert.equal(existsSync(symlinkStage.stagedRoot), false);
  rmSync(symlinkPayload.payloadRoot, { recursive: true });

  const driftedPriorReleaseId = "publisher-drifted-prior";
  const driftedPriorPrepared = preparePublisherRelease(
    driftedPriorReleaseId,
    "drifted prior release bytes",
  );
  writeFileSync(computerIndex, `${preLegacyDriftIndex}\npublisher-prior-drift`);
  const driftedPriorPublish = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(driftedPriorReleaseId, driftedPriorPrepared),
    publisherEnvironment,
  );
  assert.equal(driftedPriorPublish.status, 1, driftedPriorPublish.stderr);
  assert.match(driftedPriorPublish.stderr, /rollback evidence mismatch: computer/u);
  assert.equal(existsSync(`${driftedPriorPrepared.publisherArchive}.provenance`), false);
  assert.ok(existsSync(driftedPriorPrepared.stagedRoot));
  writeFileSync(computerIndex, preLegacyDriftIndex);

  const prePublishComputer = readFileSync(unsafeModeAsset, "utf8");
  const prePublishComputerHtml = readFileSync(computerIndex, "utf8");
  const priorComputerAssetReference = prePublishComputerHtml.match(
    /src="(?<path>\/assets\/[^"]+)"/u,
  )?.groups?.path;
  assert.equal(priorComputerAssetReference, "/assets/index-deadbeef.js");
  const priorComputerDependencies = [
    "index-deadbeef.js",
    priorAppAssetName,
    priorCssAssetName,
    priorImageAssetName,
  ];
  const priorComputerDependencyBytes = new Map(
    priorComputerDependencies.map((name) => [
      name,
      readFileSync(
        join(www, "proofofwork-computer", "assets", name),
        "utf8",
      ),
    ]),
  );
  const priorComputerRootAssetBytes = readFileSync(
    join(www, "proofofwork-computer", priorRootAssetName),
    "utf8",
  );
  const lockedReleaseId = "publisher-locked";
  const lockedPrepared = preparePublisherRelease(
    lockedReleaseId,
    "locked release bytes",
  );
  const lockedPublish = runWhileLockHeldSeparately(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(lockedReleaseId, lockedPrepared),
    publisherEnvironment,
  );
  assert.equal(lockedPublish.status, 1, lockedPublish.stderr);
  assert.match(lockedPublish.stderr, /Another UI deployment/u);
  assert.equal(readFileSync(unsafeModeAsset, "utf8"), prePublishComputer);

  const rootMetadataReleaseId = "publisher-root-metadata";
  const rootMetadataPrepared = preparePublisherRelease(
    rootMetadataReleaseId,
    "root metadata release bytes",
  );
  chmodSync(rootMetadataPrepared.stagedRoot, 0o700);
  const rootMetadataPublish = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(rootMetadataReleaseId, rootMetadataPrepared),
    publisherEnvironment,
  );
  assert.equal(rootMetadataPublish.status, 1, rootMetadataPublish.stderr);
  assert.match(rootMetadataPublish.stderr, /preserve the live .* mode, uid, and gid/u);
  assert.equal(readFileSync(unsafeModeAsset, "utf8"), prePublishComputer);

  const passthroughReleaseId = "publisher-passthrough-drift";
  const passthroughPrepared = preparePublisherRelease(
    passthroughReleaseId,
    "passthrough drift release bytes",
  );
  writeFileSync(
    join(
      passthroughPrepared.stagedRoot,
      "proofofwork-computer.rollback-preserved",
      "evidence.txt",
    ),
    "changed historical evidence",
  );
  const passthroughPublish = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(passthroughReleaseId, passthroughPrepared),
    publisherEnvironment,
  );
  assert.equal(passthroughPublish.status, 1, passthroughPublish.stderr);
  assert.match(passthroughPublish.stderr, /does not preserve every non-release/u);
  assert.equal(readFileSync(unsafeModeAsset, "utf8"), prePublishComputer);

  const missingCompatibilityReleaseId = "publisher-missing-compatibility";
  const missingCompatibilityPrepared = preparePublisherRelease(
    missingCompatibilityReleaseId,
    "missing compatibility release bytes",
  );
  unlinkSync(
    join(
      missingCompatibilityPrepared.stagedRoot,
      "proofofwork-computer",
      "assets",
      priorAppAssetName,
    ),
  );
  const missingCompatibilityPublish = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(
      missingCompatibilityReleaseId,
      missingCompatibilityPrepared,
    ),
    publisherEnvironment,
  );
  assert.equal(
    missingCompatibilityPublish.status,
    1,
    missingCompatibilityPublish.stderr,
  );
  assert.match(missingCompatibilityPublish.stderr, /missing prior dependency/u);

  const missingRootCompatibilityReleaseId =
    "publisher-missing-root-compatibility";
  const missingRootCompatibilityPrepared = preparePublisherRelease(
    missingRootCompatibilityReleaseId,
    "missing root compatibility release bytes",
  );
  unlinkSync(
    join(
      missingRootCompatibilityPrepared.stagedRoot,
      "proofofwork-computer",
      priorRootAssetName,
    ),
  );
  const missingRootCompatibilityPublish = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(
      missingRootCompatibilityReleaseId,
      missingRootCompatibilityPrepared,
    ),
    publisherEnvironment,
  );
  assert.equal(
    missingRootCompatibilityPublish.status,
    1,
    missingRootCompatibilityPublish.stderr,
  );
  assert.match(
    missingRootCompatibilityPublish.stderr,
    /missing prior dependency/u,
  );

  const missingBareCompatibilityReleaseId =
    "publisher-missing-bare-compatibility";
  const missingBareCompatibilityPrepared = preparePublisherRelease(
    missingBareCompatibilityReleaseId,
    "missing bare compatibility release bytes",
  );
  unlinkSync(
    join(
      missingBareCompatibilityPrepared.stagedRoot,
      "proofofwork-computer",
      priorBareAssetName,
    ),
  );
  const missingBareCompatibilityPublish = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(
      missingBareCompatibilityReleaseId,
      missingBareCompatibilityPrepared,
    ),
    publisherEnvironment,
  );
  assert.equal(
    missingBareCompatibilityPublish.status,
    1,
    missingBareCompatibilityPublish.stderr,
  );
  assert.match(missingBareCompatibilityPublish.stderr, /missing prior dependency/u);

  const collisionReleaseId = "publisher-compatibility-collision";
  const collisionPrepared = preparePublisherRelease(
    collisionReleaseId,
    "compatibility collision release bytes",
  );
  writeFileSync(
    join(
      collisionPrepared.stagedRoot,
      "proofofwork-computer",
      "assets",
      priorAppAssetName,
    ),
    "different bytes under prior hashed filename",
  );
  const collisionPublish = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(collisionReleaseId, collisionPrepared),
    publisherEnvironment,
  );
  assert.equal(collisionPublish.status, 1, collisionPublish.stderr);
  assert.match(
    collisionPublish.stderr,
    /dependency collision differs from prior bytes/u,
  );
  assert.equal(readFileSync(unsafeModeAsset, "utf8"), prePublishComputer);

  const failedReleaseId = "publisher-failure";
  const failedPrepared = preparePublisherRelease(
    failedReleaseId,
    "failed release bytes",
  );
  const failedPublish = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(failedReleaseId, failedPrepared),
    {
      ...publisherEnvironment,
      POW_UI_PUBLISH_TEST_FAIL_AFTER_SWAP: "1",
    },
  );
  assert.equal(failedPublish.status, 1, failedPublish.stderr);
  assert.match(failedPublish.stderr, /complete prior .* root was atomically restored/u);
  assert.equal(readFileSync(unsafeModeAsset, "utf8"), prePublishComputer);
  assert.ok(existsSync(failedPrepared.stagedRoot));
  assert.equal(
    readFileSync(join(www, ".proofofwork-ui-release"), "utf8"),
    legacyManifest,
    "A failed publish must restore the legacy rollback evidence with the prior root.",
  );
  assert.ok(
    !existsSync(join(publisherRollbackRoot, `proofofwork-www-pre-${failedReleaseId}`)),
  );

  const provenanceFailureReleaseId = "publisher-active-provenance-failure";
  const provenanceFailurePrepared = preparePublisherRelease(
    provenanceFailureReleaseId,
    "active provenance failure bytes",
  );
  const provenanceFailure = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(provenanceFailureReleaseId, provenanceFailurePrepared),
    {
      ...publisherEnvironment,
      POW_UI_PUBLISH_TEST_FAIL_ACTIVE_PROVENANCE: "1",
    },
  );
  assert.equal(provenanceFailure.status, 1, provenanceFailure.stderr);
  assert.match(
    provenanceFailure.stderr,
    /active-provenance finalization failure after atomic exchange/u,
  );
  assert.match(
    provenanceFailure.stderr,
    /complete prior .* root was atomically restored/u,
  );
  assert.equal(readFileSync(unsafeModeAsset, "utf8"), prePublishComputer);
  assert.equal(
    readFileSync(join(www, ".proofofwork-ui-release"), "utf8"),
    legacyManifest,
    "Active-provenance failure must restore the complete prior root and evidence.",
  );
  assert.ok(existsSync(provenanceFailurePrepared.stagedRoot));
  assert.equal(
    existsSync(
      join(provenanceFailurePrepared.stagedRoot, ".proofofwork-ui-release"),
    ),
    false,
    "Candidate verification must not pre-publish an active manifest.",
  );
  assert.equal(
    existsSync(`${provenanceFailurePrepared.publisherArchive}.provenance`),
    false,
    "Candidate verification must not pre-publish archive deployment provenance.",
  );
  assert.ok(
    !existsSync(
      join(
        publisherRollbackRoot,
        `proofofwork-www-pre-${provenanceFailureReleaseId}`,
      ),
    ),
  );

  const helperGapReleaseId = "publisher-helper-gap";
  const helperGapPrepared = preparePublisherRelease(
    helperGapReleaseId,
    "helper gap failure bytes",
  );
  const helperGapFailure = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(helperGapReleaseId, helperGapPrepared),
    {
      ...publisherEnvironment,
      POW_UI_PUBLISH_TEST_FAIL_EXCHANGE_HELPER_AFTER_SYSCALL: "1",
    },
  );
  assert.equal(helperGapFailure.status, 1, helperGapFailure.stderr);
  assert.match(
    helperGapFailure.stderr,
    /exchange-helper failure after renameat2 syscall/u,
  );
  assert.match(
    helperGapFailure.stderr,
    /complete prior .* root was atomically restored/u,
  );
  assert.equal(readFileSync(unsafeModeAsset, "utf8"), prePublishComputer);
  assert.ok(existsSync(helperGapPrepared.stagedRoot));
  assert.ok(
    !existsSync(
      join(publisherRollbackRoot, `proofofwork-www-pre-${helperGapReleaseId}`),
    ),
  );

  const exchangeDurabilityReleaseId = "publisher-exchange-durability";
  const exchangeDurabilityPrepared = preparePublisherRelease(
    exchangeDurabilityReleaseId,
    "exchange durability failure bytes",
  );
  const exchangeDurabilityFailure = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(exchangeDurabilityReleaseId, exchangeDurabilityPrepared),
    {
      ...publisherEnvironment,
      POW_UI_PUBLISH_TEST_FAIL_EXCHANGE_DURABILITY: "1",
    },
  );
  assert.equal(
    exchangeDurabilityFailure.status,
    1,
    exchangeDurabilityFailure.stderr,
  );
  assert.match(
    exchangeDurabilityFailure.stderr,
    /post-exchange durability failure/u,
  );
  assert.match(
    exchangeDurabilityFailure.stderr,
    /complete prior .* root was atomically restored/u,
  );
  assert.equal(readFileSync(unsafeModeAsset, "utf8"), prePublishComputer);

  const rollbackDurabilityReleaseId = "publisher-rollback-durability";
  const rollbackDurabilityPrepared = preparePublisherRelease(
    rollbackDurabilityReleaseId,
    "rollback durability failure bytes",
  );
  const rollbackDurabilityFailure = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(rollbackDurabilityReleaseId, rollbackDurabilityPrepared),
    {
      ...publisherEnvironment,
      POW_UI_PUBLISH_TEST_FAIL_ROLLBACK_DURABILITY: "1",
      POW_UI_PUBLISH_TEST_FAIL_RESTORE_VERIFICATION: "1",
    },
  );
  assert.equal(
    rollbackDurabilityFailure.status,
    70,
    rollbackDurabilityFailure.stderr,
  );
  assert.match(
    rollbackDurabilityFailure.stderr,
    /rollback-preservation durability failure/u,
  );
  assert.match(
    rollbackDurabilityFailure.stderr,
    /restored-root identity verification failure/u,
  );
  assert.match(
    rollbackDurabilityFailure.stderr,
    /CRITICAL: the prior UI root was exchanged back/u,
  );
  assert.equal(readFileSync(unsafeModeAsset, "utf8"), prePublishComputer);
  const misleadingRollbackPath = join(
    publisherRollbackRoot,
    `proofofwork-www-pre-${rollbackDurabilityReleaseId}`,
  );
  assert.ok(!existsSync(misleadingRollbackPath));
  assert.ok(existsSync(rollbackDurabilityPrepared.stagedRoot));
  assert.equal(
    readFileSync(
      rollbackDurabilityPrepared.candidateComputerAsset,
      "utf8",
    ),
    "rollback durability failure bytes",
  );

  const successfulReleaseId = "publisher-success";
  const successfulPrepared = preparePublisherRelease(
    successfulReleaseId,
    "published release bytes",
  );
  const preExchangeFailure = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(successfulReleaseId, successfulPrepared),
    {
      ...publisherEnvironment,
      POW_UI_PUBLISH_TEST_FAIL_BEFORE_EXCHANGE: "1",
    },
  );
  assert.equal(preExchangeFailure.status, 1, preExchangeFailure.stderr);
  assert.match(
    preExchangeFailure.stderr,
    /after candidate verification and before atomic exchange/u,
  );
  assert.equal(readFileSync(unsafeModeAsset, "utf8"), prePublishComputer);
  assert.equal(
    readFileSync(join(www, ".proofofwork-ui-release"), "utf8"),
    legacyManifest,
    "Pre-exchange failure must leave the active root untouched.",
  );
  assert.ok(existsSync(successfulPrepared.stagedRoot));
  assert.equal(
    existsSync(join(successfulPrepared.stagedRoot, ".proofofwork-ui-release")),
    false,
    "Pre-exchange candidate verification must not poison the staged retry.",
  );
  assert.equal(
    existsSync(`${successfulPrepared.publisherArchive}.provenance`),
    false,
    "Pre-exchange candidate verification must not claim deployment.",
  );
  assert.ok(
    !existsSync(
      join(publisherRollbackRoot, `proofofwork-www-pre-${successfulReleaseId}`),
    ),
  );

  const successfulPublish = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(successfulReleaseId, successfulPrepared),
    publisherEnvironment,
  );
  assert.equal(successfulPublish.status, 0, successfulPublish.stderr);
  assert.match(successfulPublish.stdout, /status=published/u);
  assert.equal(readFileSync(unsafeModeAsset, "utf8"), prePublishComputer);
  assert.equal(
    readFileSync(
      join(
        www,
        "proofofwork-computer",
        "assets",
        candidateComputerAssetName,
      ),
      "utf8",
    ),
    "published release bytes",
  );
  assert.equal(
    readFileSync(
      join(
        www,
        "proofofwork-computer",
        priorComputerAssetReference.slice(1),
      ),
      "utf8",
    ),
    prePublishComputer,
    "A client holding the immediate prior HTML must still resolve its hashed asset after exchange.",
  );
  for (const [name, bytes] of priorComputerDependencyBytes) {
    assert.equal(
      readFileSync(
        join(www, "proofofwork-computer", "assets", name),
        "utf8",
      ),
      bytes,
      `The immediate prior asset dependency closure lost ${name}.`,
    );
  }
  assert.equal(
    readFileSync(
      join(www, "proofofwork-computer", priorRootAssetName),
      "utf8",
    ),
    priorComputerRootAssetBytes,
    "The immediate prior root-relative static dependency was lost.",
  );
  assert.equal(
    readFileSync(
      join(www, "proofofwork-computer", priorBareAssetName),
      "utf8",
    ),
    "icon-computer",
    "The immediate prior bare relative static dependency was lost.",
  );
  assert.match(prePublishComputer, new RegExp(priorAppAssetName, "u"));
  assert.match(
    priorComputerDependencyBytes.get(priorAppAssetName),
    new RegExp(priorCssAssetName, "u"),
  );
  assert.match(
    priorComputerDependencyBytes.get(priorCssAssetName),
    new RegExp(priorImageAssetName, "u"),
  );
  assert.equal(
    existsSync(
      join(
        www,
        "proofofwork-computer",
        "assets",
        priorUnreferencedAssetName,
      ),
    ),
    false,
    "An unreferenced asset retained for the prior release must not be carried recursively.",
  );
  assert.ok(!existsSync(successfulPrepared.stagedRoot));
  const publishedRollback = join(
    publisherRollbackRoot,
    `proofofwork-www-pre-${successfulReleaseId}`,
  );
  assert.ok(existsSync(publishedRollback));
  assert.equal(
    readFileSync(
      join(
        publishedRollback,
        "proofofwork-computer",
        "assets",
        "index-deadbeef.js",
      ),
      "utf8",
    ),
    prePublishComputer,
  );
  const publishedManifest = readFileSync(
    join(www, ".proofofwork-ui-release"),
    "utf8",
  );
  assert.match(publishedManifest, /release_id=publisher-success/u);
  assert.match(publishedManifest, /format=proofofwork-ui-release-v3/u);
  assert.match(
    publishedManifest,
    /^deployed_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/mu,
  );
  assert.equal(
    readFileSync(join(publishedRollback, ".proofofwork-ui-release"), "utf8"),
    legacyManifest,
    "The preserved complete-root rollback must retain its honest legacy evidence.",
  );
  const publishedVerify = run(
    "deploy/proofofwork-ui-release-provenance.sh",
    ["verify"],
    provenanceEnvironment,
  );
  assert.equal(publishedVerify.status, 0, publishedVerify.stderr);

  const rollbackCapReleaseId = "publisher-rollback-cap";
  const rollbackCapPrepared = preparePublisherRelease(
    rollbackCapReleaseId,
    "rollback cap release bytes",
  );
  const rollbackCapPublish = run(
    "deploy/proofofwork-ui-release-publish.sh",
    publisherArguments(rollbackCapReleaseId, rollbackCapPrepared),
    publisherEnvironment,
  );
  assert.equal(rollbackCapPublish.status, 1, rollbackCapPublish.stderr);
  assert.match(rollbackCapPublish.stderr, /post-soak evidence classification/u);
  assert.equal(
    readFileSync(
      join(
        www,
        "proofofwork-computer",
        "assets",
        candidateComputerAssetName,
      ),
      "utf8",
    ),
    "published release bytes",
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log("UI operations contract checks passed.");
