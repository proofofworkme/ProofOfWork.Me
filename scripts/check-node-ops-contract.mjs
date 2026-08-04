import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const read = (path) => readFileSync(path, "utf8");

const releasePrune = read("deploy/proofofwork-release-prune.sh");
const releasePruneService = read(
  "deploy/proofofwork-node-release-prune.service",
);
const releasePublish = read("deploy/proofofwork-node-release-publish.sh");
const releaseHealth = read("deploy/proofofwork-node-release-health.sh");
const releaseHealthService = read(
  "deploy/proofofwork-node-release-health.service",
);
const releaseHealthTimer = read("deploy/proofofwork-node-release-health.timer");
const storageHealth = read("deploy/proofofwork-node-storage-health.sh");
const storageHealthService = read(
  "deploy/proofofwork-node-storage-health.service",
);
const storageHealthTimer = read("deploy/proofofwork-node-storage-health.timer");
const postgresObservability = read("deploy/postgresql-observability.conf");
const postgresProofIndexTablespace = read(
  "deploy/postgresql-proof-index-tablespace.conf",
);
const postgresObservabilitySql = read(
  "deploy/proof-indexer-db-observability.sql",
);
const postgresQueryHealth = read(
  "deploy/proofofwork-postgres-query-health.sh",
);
const postgresQueryHealthService = read(
  "deploy/proofofwork-postgres-query-health.service",
);
const postgresQueryHealthTimer = read(
  "deploy/proofofwork-postgres-query-health.timer",
);
const infrastructure = read("OP_RETURN_INFRASTRUCTURE.md");

for (const executable of [
  "deploy/proofofwork-node-release-publish.sh",
  "deploy/proofofwork-node-release-health.sh",
  "deploy/proofofwork-node-storage-health.sh",
  "deploy/proofofwork-postgres-query-health.sh",
]) {
  assert.notEqual(
    statSync(executable).mode & 0o111,
    0,
    `${executable} must be tracked executable.`,
  );
}

assert.match(releasePrune, /verified_archives/u);
assert.match(releasePrune, /unverified_count/u);
assert.match(
  releasePrune,
  /referenced_name.*!=.*name.*referenced_name.*!=.*root.*name/su,
);
assert.match(releasePrune, /Verified legacy absolute checksum target/u);
assert.match(releasePrune, /sha256sum --check --status --strict/u);
assert.match(releasePrune, /verified retention completed/u);
assert.match(releasePrune, /if \(\(unverified_count > 0\)\); then\s+exit 2/su);
assert.match(releasePrune, /\.provenance/u);
assert.match(releasePrune, /protected_archives/u);
assert.match(releasePrune, /archive-bound active UI provenance/u);
assert.match(releasePrune, /proof-of-work-node-release-provenance-v2/u);
assert.match(releasePruneService, /^TimeoutStartSec=30m$/mu);
assert.match(releasePruneService, /^Nice=10$/mu);
assert.match(releasePruneService, /^IOSchedulingClass=idle$/mu);
assert.match(releasePruneService, /^CPUWeight=10$/mu);
assert.match(releasePruneService, /^IOWeight=10$/mu);
assert.match(releasePruneService, /ProtectSystem=strict/u);

assert.match(releasePublish, /\/var\/tmp\/proofofwork-deploy\//u);
assert.doesNotMatch(releasePublish, /status --porcelain/u);
assert.match(releasePublish, /symbolic-ref.*--quiet.*HEAD/u);
assert.match(releasePublish, /HEAD\^\{commit\}/u);
assert.match(releasePublish, /HEAD\^\{tree\}/u);
assert.match(releasePublish, /GIT_OPTIONAL_LOCKS/u);
assert.match(releasePublish, /ls-tree", "-r", "-z", "--full-tree"/u);
assert.match(releasePublish, /hash-object.*--no-filters/u);
assert.match(releasePublish, /Checkout tracked bytes differ from Git tree/u);
assert.match(releasePublish, /clone --quiet --no-local --no-checkout/u);
assert.match(releasePublish, /runtime_entry_count/u);
assert.match(releasePublish, /runtime_sha256/u);
assert.match(releasePublish, /POW_NODE_RELEASE_MAX_SOURCE_BYTES:-8589934592/u);
assert.match(releasePublish, /\/proc\/self\/mountinfo/u);
assert.match(releasePublish, /proof-of-work-node-release-provenance-v2/u);
assert.ok(
  releasePublish.indexOf('mv -- "${checksum_tmp}" "${final_checksum}"') <
    releasePublish.indexOf('mv -- "${archive_tmp}" "${final_archive}"'),
  "Node archive publication must make its checksum visible before the archive.",
);
assert.ok(
  releasePublish.indexOf('mv -- "${provenance_tmp}" "${final_provenance}"') <
    releasePublish.indexOf('mv -- "${archive_tmp}" "${final_archive}"'),
  "Node archive publication must make provenance visible before the archive.",
);

assert.match(releaseHealth, /current_provenance_count/u);
assert.doesNotMatch(releaseHealth, /status --porcelain/u);
assert.match(releaseHealth, /ls-tree -r -z --full-tree/u);
assert.match(releaseHealth, /hash-object --no-filters/u);
assert.match(releaseHealth, /runtime_attestation/u);
assert.match(releaseHealth, /proof-of-work-node-release-provenance-v2/u);
assert.match(releaseHealth, /POW_RELEASE_MAX_CHECKOUT_COUNT:-9/u);
assert.match(releaseHealth, /unverified node release archives/u);
assert.match(releaseHealthService, /ProtectSystem=strict/u);
assert.match(releaseHealthService, /CapabilityBoundingSet=$/mu);
assert.match(releaseHealthService, /^Nice=10$/mu);
assert.match(releaseHealthService, /^IOSchedulingClass=idle$/mu);
assert.match(releaseHealthService, /^CPUWeight=10$/mu);
assert.match(releaseHealthService, /^IOWeight=10$/mu);
assert.match(releaseHealthService, /^TimeoutStartSec=30m$/mu);
assert.match(releaseHealthTimer, /OnCalendar=\*-\*-\* 04:15:00 UTC/u);
assert.match(releaseHealthTimer, /Persistent=true/u);

for (const target of [
  'targets=("/" "/data")',
  "findmnt",
  "--output=ipcent,iavail",
]) {
  assert.ok(storageHealth.includes(target), `Storage health is missing ${target}.`);
}
assert.match(storageHealth, /POW_STORAGE_WARN_PERCENT:-75/u);
assert.match(storageHealth, /POW_STORAGE_CRITICAL_PERCENT:-85/u);
assert.match(storageHealth, /POW_STORAGE_ROOT_MIN_FREE_BYTES:-10737418240/u);
assert.match(storageHealth, /POW_STORAGE_DATA_MIN_FREE_BYTES:-107374182400/u);
assert.match(storageHealthService, /^Requisite=data\.mount$/mu);
assert.match(storageHealthService, /^After=data\.mount$/mu);
assert.match(storageHealthService, /^TimeoutStartSec=30s$/mu);
assert.doesNotMatch(storageHealthService, /RequiresMountsFor/u);
assert.match(storageHealthService, /ProtectSystem=strict/u);
assert.match(storageHealthTimer, /OnCalendar=\*:0\/5/u);
assert.match(storageHealthTimer, /Persistent=true/u);

for (const setting of [
  "compute_query_id = on",
  "track_io_timing = on",
  "track_wal_io_timing = on",
  "log_min_duration_statement = '5s'",
  "log_parameter_max_length = 0",
  "log_lock_waits = on",
]) {
  assert.ok(
    postgresObservability.includes(setting),
    `PostgreSQL observability is missing ${setting}.`,
  );
}
assert.doesNotMatch(postgresObservability, /^shared_preload_libraries\s*=/mu);
assert.match(postgresObservability, /merge pg_stat_statements/u);
assert.match(
  postgresProofIndexTablespace,
  /^RequiresMountsFor=\/data\/proofofwork-postgres-tablespaces\/proof_indexer_large_state_v1$/mu,
);
assert.match(postgresProofIndexTablespace, /^After=data\.mount$/mu);
assert.match(postgresProofIndexTablespace, /^BindsTo=data\.mount$/mu);
assert.match(
  postgresProofIndexTablespace,
  /^AssertPathIsMountPoint=\/data$/mu,
);
assert.match(
  postgresObservabilitySql,
  /CREATE EXTENSION IF NOT EXISTS pg_stat_statements/u,
);
assert.match(postgresObservabilitySql, /REVOKE EXECUTE ON FUNCTION/u);
assert.match(postgresObservabilitySql, /REVOKE SELECT ON %I\.%I FROM PUBLIC/u);
assert.match(postgresQueryHealth, /pg_stat_activity/u);
assert.match(postgresQueryHealth, /query_id::text/u);
assert.match(postgresQueryHealth, /backend_type = 'client backend'/u);
assert.match(postgresQueryHealth, /all_client_sessions/u);
assert.match(postgresQueryHealth, /scoped_sessions/u);
assert.match(postgresQueryHealth, /POW_POSTGRES_WARN_QUERY_FANOUT:-4/u);
assert.match(postgresQueryHealth, /POW_POSTGRES_CRITICAL_QUERY_FANOUT:-8/u);
assert.match(postgresQueryHealth, /POW_POSTGRES_WARN_LOCK_WAIT_SECONDS:-5/u);
assert.match(postgresQueryHealth, /POW_POSTGRES_CRITICAL_LOCK_WAIT_SECONDS:-20/u);
assert.match(postgresQueryHealth, /proof_indexer_large_state_v1/u);
assert.match(
  postgresQueryHealth,
  /\/data\/proofofwork-postgres-tablespaces\/proof_indexer_large_state_v1/u,
);
assert.match(
  postgresQueryHealth,
  /expected_parents\(relname\)[\s\S]*ledger_snapshots[\s\S]*work_amo_block_transitions/u,
);
assert.match(
  postgresQueryHealth,
  /base_relations[\s\S]*indexes[\s\S]*closure[\s\S]*relation\.reltablespace/u,
);
assert.match(postgresQueryHealth, /indisvalid[\s\S]*indisready/u);
assert.match(postgresQueryHealth, /owned_sequences/u);
assert.match(postgresQueryHealth, /unrelated_count/u);
assert.match(
  postgresQueryHealth,
  /CRITICAL PostgreSQL large-state tablespace placement differs/u,
);
assert.doesNotMatch(
  postgresQueryHealth,
  /work_amo_block_transitions[^\n]*payload|ledger_snapshots[^\n]*payload/u,
);
assert.match(
  postgresQueryHealth,
  /printf 'postgres database=%s cluster_client_connections=%s active=%s oldest_active_seconds=%s max_same_query_fanout=%s lock_waiters=%s oldest_lock_wait_seconds=%s idle_in_transaction=%s/u,
);
assert.match(postgresQueryHealthService, /User=postgres/u);
assert.match(postgresQueryHealthService, /^Requisite=postgresql@16-main\.service$/mu);
assert.match(postgresQueryHealthService, /^TimeoutStartSec=20s$/mu);
assert.match(postgresQueryHealthService, /ProtectSystem=strict/u);
assert.match(postgresQueryHealthTimer, /OnCalendar=\*:0\/5/u);
assert.match(
  releasePublish,
  /--upload-pack="\/usr\/bin\/git -c safe\.directory=\$\{checkout\}\/\.git upload-pack"/u,
);

for (const requiredPath of [
  "deploy/postgresql-observability.conf",
  "deploy/postgresql-proof-index-tablespace.conf",
  "deploy/proofofwork-node-storage-health.sh",
  "deploy/proofofwork-postgres-query-health.sh",
  "deploy/proofofwork-node-release-publish.sh",
  "deploy/proofofwork-node-release-health.sh",
]) {
  assert.ok(
    infrastructure.includes(requiredPath),
    `Infrastructure guide does not route ${requiredPath}.`,
  );
}
assert.match(infrastructure, /proof-of-work-node-release-provenance-v2/u);
assert.match(infrastructure, /Its bytes are never trusted, extracted, or copied/u);
assert.match(
  infrastructure,
  /chmod --recursive go-w \/opt\/proofofwork-api/u,
);
assert.match(infrastructure, /proofofwork-ui-release-v3/u);
assert.match(infrastructure, /nft.*compatibility alias/su);

const runChecked = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stderr}`,
  );
  return result.stdout.trim();
};

const testRoot = mkdtempSync(join(tmpdir(), "pow-release-prune-contract-"));
try {
  const nodeRoot = join(testRoot, "node");
  const uiRoot = join(testRoot, "ui");
  const pruneNodeCheckout = join(testRoot, "prune-node-checkout");
  const uiManifest = join(testRoot, "active-ui-manifest");
  mkdirSync(nodeRoot);
  mkdirSync(uiRoot);
  mkdirSync(pruneNodeCheckout);
  runChecked("/usr/bin/git", ["-C", pruneNodeCheckout, "init", "--quiet"]);
  runChecked("/usr/bin/git", [
    "-C",
    pruneNodeCheckout,
    "config",
    "user.name",
    "Prune Contract",
  ]);
  runChecked("/usr/bin/git", [
    "-C",
    pruneNodeCheckout,
    "config",
    "user.email",
    "prune-contract@invalid.example",
  ]);
  writeFileSync(join(pruneNodeCheckout, "tracked.txt"), "prune fixture\n");
  runChecked("/usr/bin/git", ["-C", pruneNodeCheckout, "add", "tracked.txt"]);
  runChecked("/usr/bin/git", [
    "-C",
    pruneNodeCheckout,
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  runChecked("/usr/bin/git", [
    "-C",
    pruneNodeCheckout,
    "checkout",
    "--quiet",
    "--detach",
    "HEAD",
  ]);
  const pruneCommit = runChecked("/usr/bin/git", [
    "-C",
    pruneNodeCheckout,
    "rev-parse",
    "HEAD",
  ]);
  const pruneTree = runChecked("/usr/bin/git", [
    "-C",
    pruneNodeCheckout,
    "rev-parse",
    "HEAD^{tree}",
  ]);
  const fixturePath = join(testRoot, "proofofwork-release-prune");
  const fixture = releasePrune
    .replace(
      "/var/backups/proofofwork-ui/releases:5",
      `${uiRoot}:5`,
    )
    .replace(
      "/data/proofofwork-release-backups/managed:3",
      `${nodeRoot}:3`,
    );
  writeFileSync(fixturePath, fixture, { mode: 0o700 });
  chmodSync(fixturePath, 0o700);

  const createArchive = ({
    root,
    kind,
    label,
    age,
    sidecarTarget,
    provenance = false,
  }) => {
    const name = `proofofwork-${kind}-release-${label}.tgz`;
    const archive = join(root, name);
    const body = `archive-${kind}-${label}\n`;
    writeFileSync(archive, body);
    chmodSync(archive, 0o644);
    const timestamp = new Date(1_700_000_000_000 + age * 1_000);
    utimesSync(archive, timestamp, timestamp);
    if (sidecarTarget !== null) {
      const digest = createHash("sha256").update(body).digest("hex");
      const target = sidecarTarget === "basename" ? name : sidecarTarget(name);
      writeFileSync(`${archive}.sha256`, `${digest}  ${target}\n`);
      chmodSync(`${archive}.sha256`, 0o644);
    }
    if (provenance) {
      writeFileSync(`${archive}.provenance`, "historical-test-provenance\n");
      chmodSync(`${archive}.provenance`, 0o644);
    }
    return archive;
  };

  const verifiedNodeArchives = Array.from({ length: 5 }, (_, index) =>
    createArchive({
      root: nodeRoot,
      kind: "node",
      label: `verified-${index}`,
      age: index,
      sidecarTarget: "basename",
      provenance: index < 2,
    }),
  );
  const activeNodeArchive = verifiedNodeArchives[0];
  const activeNodeBytes = readFileSync(activeNodeArchive);
  const activeNodeDigest = createHash("sha256")
    .update(activeNodeBytes)
    .digest("hex");
  writeFileSync(
    `${activeNodeArchive}.provenance`,
    [
      "format=proof-of-work-node-release-provenance-v2",
      `archive=${basename(activeNodeArchive)}`,
      `archive_sha256=${activeNodeDigest}`,
      `archive_bytes=${activeNodeBytes.length}`,
      `commit=${pruneCommit}`,
      `tree=${pruneTree}`,
      "runtime_entry_count=1",
      "runtime_bytes=1",
      `runtime_sha256=${"a".repeat(64)}`,
      "commit_time=2026-08-02T00:00:00Z",
      "recorded_at=2026-08-02T00:00:01Z",
      "",
    ].join("\n"),
  );
  chmodSync(`${activeNodeArchive}.provenance`, 0o644);
  const missingNodeArchive = createArchive({
    root: nodeRoot,
    kind: "node",
    label: "missing-sidecar",
    age: 6,
    sidecarTarget: null,
  });
  const badNodeArchive = createArchive({
    root: nodeRoot,
    kind: "node",
    label: "bad-sidecar",
    age: 7,
    sidecarTarget: (name) => `/tmp/not-the-retention-root/${name}`,
  });
  const nodeResult = spawnSync(
    "/usr/bin/bash",
    [fixturePath, nodeRoot, "3"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        POW_RELEASE_ALLOW_TEST_ROOTS: "1",
        POW_RELEASE_NODE_CHECKOUT: pruneNodeCheckout,
      },
    },
  );
  assert.equal(nodeResult.status, 2, nodeResult.stderr);
  assert.equal(existsSync(verifiedNodeArchives[0]), true);
  assert.equal(existsSync(`${verifiedNodeArchives[0]}.sha256`), true);
  assert.equal(existsSync(`${verifiedNodeArchives[0]}.provenance`), true);
  assert.equal(existsSync(verifiedNodeArchives[1]), false);
  for (const archive of verifiedNodeArchives.slice(2)) {
    assert.equal(existsSync(archive), true);
    assert.equal(existsSync(`${archive}.sha256`), true);
  }
  assert.equal(existsSync(missingNodeArchive), true);
  assert.equal(existsSync(badNodeArchive), true);
  assert.match(nodeResult.stderr, /verified retention completed/u);

  const verifiedUiArchives = Array.from({ length: 7 }, (_, index) =>
    createArchive({
      root: uiRoot,
      kind: "ui",
      label: `verified-${index}`,
      age: index,
      sidecarTarget:
        index === 6 ? (name) => `${uiRoot}/${name}` : "basename",
    }),
  );
  const activeUiManifest = [
    "format=proofofwork-ui-release-v3",
    `archive_name=${basename(verifiedUiArchives[0])}`,
    "",
  ].join("\n");
  writeFileSync(uiManifest, activeUiManifest);
  writeFileSync(`${verifiedUiArchives[0]}.provenance`, activeUiManifest);
  chmodSync(uiManifest, 0o644);
  chmodSync(`${verifiedUiArchives[0]}.provenance`, 0o644);
  const uiResult = spawnSync(
    "/usr/bin/bash",
    [fixturePath, uiRoot, "5"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        POW_RELEASE_ALLOW_TEST_ROOTS: "1",
        POW_RELEASE_UI_MANIFEST: uiManifest,
      },
    },
  );
  assert.equal(uiResult.status, 0, uiResult.stderr);
  assert.equal(existsSync(verifiedUiArchives[0]), true);
  assert.equal(existsSync(verifiedUiArchives[1]), false);
  for (const archive of verifiedUiArchives.slice(2)) {
    assert.equal(existsSync(archive), true);
  }
  assert.match(uiResult.stderr, /Verified legacy absolute checksum target/u);

  rmSync(uiRoot, { recursive: true });
  mkdirSync(uiRoot);
  const canonicalUiArchives = [];
  for (let index = 0; index < 5; index += 1) {
    canonicalUiArchives.push(createArchive({
      root: uiRoot,
      kind: "ui",
      label: `canonical-${index}`,
      age: index,
      sidecarTarget: "basename",
    }));
  }
  const canonicalActiveManifest = [
    "format=proofofwork-ui-release-v3",
    `archive_name=${basename(canonicalUiArchives[0])}`,
    "",
  ].join("\n");
  writeFileSync(uiManifest, canonicalActiveManifest);
  writeFileSync(`${canonicalUiArchives[0]}.provenance`, canonicalActiveManifest);
  chmodSync(uiManifest, 0o644);
  chmodSync(`${canonicalUiArchives[0]}.provenance`, 0o644);
  const arbitraryAbsoluteArchive = createArchive({
    root: uiRoot,
    kind: "ui",
    label: "arbitrary-absolute",
    age: 8,
    sidecarTarget: (name) => `/tmp/unapproved-release-root/${name}`,
  });
  const arbitraryResult = spawnSync(
    "/usr/bin/bash",
    [fixturePath, uiRoot, "5"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        POW_RELEASE_ALLOW_TEST_ROOTS: "1",
        POW_RELEASE_UI_MANIFEST: uiManifest,
      },
    },
  );
  assert.equal(arbitraryResult.status, 2, arbitraryResult.stderr);
  assert.equal(existsSync(arbitraryAbsoluteArchive), true);
  assert.match(arbitraryResult.stderr, /invalid checksum sidecar/u);

  const publishRoot = join(testRoot, "publish");
  const retentionRoot = join(publishRoot, "retention");
  const stagingRoot = join(publishRoot, "staging");
  const liveCheckout = join(publishRoot, "live");
  mkdirSync(retentionRoot, { recursive: true });
  mkdirSync(stagingRoot, { recursive: true });
  mkdirSync(liveCheckout, { recursive: true });

  runChecked("/usr/bin/git", ["-C", liveCheckout, "init", "--quiet"]);
  runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "config",
    "user.name",
    "Node Ops Contract",
  ]);
  runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "config",
    "user.email",
    "node-ops-contract@invalid.example",
  ]);
  mkdirSync(join(liveCheckout, "nested"));
  writeFileSync(join(liveCheckout, ".gitignore"), "node_modules/\n");
  writeFileSync(
    join(liveCheckout, "nested", "tracked.txt"),
    "canonical tracked bytes\n",
  );
  runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "add",
    ".gitignore",
    "nested/tracked.txt",
  ]);
  runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "checkout",
    "--quiet",
    "--detach",
    "HEAD",
  ]);
  mkdirSync(join(liveCheckout, "node_modules", "fixture-runtime"), {
    recursive: true,
  });
  writeFileSync(
    join(liveCheckout, "node_modules", "fixture-runtime", "index.js"),
    "export const runtime = true;\n",
  );
  runChecked("/usr/bin/chmod", ["--recursive", "go-w", liveCheckout]);
  const liveOwnership = statSync(liveCheckout);
  assert.notEqual(
    liveOwnership.uid,
    0,
    "The publisher fixture must model a non-root-owned live checkout.",
  );
  const fixtureCommit = runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "rev-parse",
    "HEAD",
  ]);
  const fixtureTree = runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "rev-parse",
    "HEAD^{tree}",
  ]);
  const shortFixtureCommit = fixtureCommit.slice(0, 7);

  const publisherFixturePath = join(publishRoot, "node-release-publish");
  const publisherFixture = releasePublish
    .replaceAll(
      "/data/proofofwork-release-backups/managed",
      retentionRoot,
    )
    .replaceAll("/opt/proofofwork-api", liveCheckout)
    .replaceAll("/var/tmp/proofofwork-deploy", stagingRoot)
    .replace("if ((EUID != 0)); then", "if ((0 != 0)); then")
    // Exercise the production root-only ownership normalization while the
    // fixture's canonical live checkout is owned by this non-root test user.
    .replace("if ((EUID == 0)); then", "if ((1 == 1)); then");
  writeFileSync(publisherFixturePath, publisherFixture, { mode: 0o700 });
  chmodSync(publisherFixturePath, 0o700);

  const createReleaseArchive = (label, mutateTrackedFile) => {
    const archiveRoot = join(publishRoot, `archive-${label}`);
    const archivedCheckout = join(archiveRoot, "proofofwork-api");
    mkdirSync(archiveRoot, { recursive: true });
    cpSync(liveCheckout, archivedCheckout, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    if (mutateTrackedFile) {
      writeFileSync(
        join(archivedCheckout, "nested", "tracked.txt"),
        "mismatched tracked bytes\n",
      );
    }
    const archiveName = `proofofwork-node-release-${label}-${shortFixtureCommit}-20260802T000000Z.tgz`;
    const archivePath = join(stagingRoot, archiveName);
    runChecked("/usr/bin/tar", [
      "--gzip",
      "--create",
      `--file=${archivePath}`,
      `--directory=${archiveRoot}`,
      "proofofwork-api",
    ]);
    chmodSync(archivePath, 0o644);
    return { archiveName, archivePath };
  };

  const publisherEnvironment = {
    ...process.env,
    POW_NODE_RELEASE_MIN_HEADROOM_BYTES: "1",
  };
  const skipWorktreeRelease = createReleaseArchive("skip-worktree", false);
  runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "update-index",
    "--skip-worktree",
    "nested/tracked.txt",
  ]);
  writeFileSync(
    join(liveCheckout, "nested", "tracked.txt"),
    "skip-worktree concealed drift\n",
  );
  const skipWorktreeResult = spawnSync(
    "/usr/bin/bash",
    [publisherFixturePath, skipWorktreeRelease.archivePath],
    { encoding: "utf8", env: publisherEnvironment },
  );
  assert.equal(skipWorktreeResult.status, 1, skipWorktreeResult.stderr);
  assert.match(skipWorktreeResult.stderr, /tracked bytes differ from Git tree/u);
  assert.equal(
    existsSync(join(retentionRoot, skipWorktreeRelease.archiveName)),
    false,
  );
  writeFileSync(
    join(liveCheckout, "nested", "tracked.txt"),
    "canonical tracked bytes\n",
  );
  runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "update-index",
    "--no-skip-worktree",
    "nested/tracked.txt",
  ]);
  runChecked("/usr/bin/chmod", ["--recursive", "go-w", liveCheckout]);

  const runtimeFile = join(
    liveCheckout,
    "node_modules",
    "fixture-runtime",
    "index.js",
  );
  const unsafeDirectoryRelease = createReleaseArchive(
    "unsafe-directory-mode",
    false,
  );
  chmodSync(join(liveCheckout, "nested"), 0o775);
  const unsafeDirectoryMode = spawnSync(
    "/usr/bin/bash",
    [publisherFixturePath, unsafeDirectoryRelease.archivePath],
    { encoding: "utf8", env: publisherEnvironment },
  );
  assert.equal(unsafeDirectoryMode.status, 1, unsafeDirectoryMode.stderr);
  assert.match(unsafeDirectoryMode.stderr, /unsafe mode/u);
  chmodSync(join(liveCheckout, "nested"), 0o755);

  const unsafeModeRelease = createReleaseArchive("unsafe-mode", false);
  chmodSync(runtimeFile, 0o666);
  const unsafeModeResult = spawnSync(
    "/usr/bin/bash",
    [publisherFixturePath, unsafeModeRelease.archivePath],
    { encoding: "utf8", env: publisherEnvironment },
  );
  assert.equal(unsafeModeResult.status, 1, unsafeModeResult.stderr);
  assert.match(unsafeModeResult.stderr, /unsafe mode/u);
  chmodSync(runtimeFile, 0o644);

  // The staged tar deliberately contains different tracked bytes. Publication
  // must construct from the attested live checkout instead of copying them.
  const matchingRelease = createReleaseArchive("trusted-live", true);
  const matchingResult = spawnSync(
    "/usr/bin/bash",
    [publisherFixturePath, matchingRelease.archivePath],
    { encoding: "utf8", env: publisherEnvironment },
  );
  assert.equal(matchingResult.status, 0, matchingResult.stderr);
  assert.equal(existsSync(join(retentionRoot, matchingRelease.archiveName)), true);
  assert.equal(
    existsSync(join(retentionRoot, `${matchingRelease.archiveName}.sha256`)),
    true,
  );
  const recordedProvenance = readFileSync(
    join(retentionRoot, `${matchingRelease.archiveName}.provenance`),
    "utf8",
  );
  assert.match(recordedProvenance, new RegExp(`commit=${fixtureCommit}`));
  assert.match(recordedProvenance, new RegExp(`tree=${fixtureTree}`));
  assert.match(recordedProvenance, /format=proof-of-work-node-release-provenance-v2/u);
  assert.match(recordedProvenance, /runtime_entry_count=[1-9][0-9]*/u);
  assert.match(recordedProvenance, /runtime_sha256=[0-9a-f]{64}/u);

  const archivedTrackedBytes = spawnSync(
    "/usr/bin/tar",
    [
      "--extract",
      "--to-stdout",
      `--file=${join(retentionRoot, matchingRelease.archiveName)}`,
      "proofofwork-api/nested/tracked.txt",
    ],
    { encoding: "utf8" },
  );
  assert.equal(archivedTrackedBytes.status, 0, archivedTrackedBytes.stderr);
  assert.equal(archivedTrackedBytes.stdout, "canonical tracked bytes\n");
  const archivedOwnership = spawnSync(
    "/usr/bin/tar",
    [
      "--list",
      "--verbose",
      "--numeric-owner",
      `--file=${join(retentionRoot, matchingRelease.archiveName)}`,
      "proofofwork-api/.git/HEAD",
      "proofofwork-api/node_modules/fixture-runtime/index.js",
    ],
    { encoding: "utf8" },
  );
  assert.equal(archivedOwnership.status, 0, archivedOwnership.stderr);
  const numericOwner = `${liveOwnership.uid}/${liveOwnership.gid}`;
  for (const listingLine of archivedOwnership.stdout.trim().split("\n")) {
    assert.ok(
      listingLine.includes(numericOwner),
      `Archive did not preserve non-root live ownership: ${listingLine}`,
    );
  }

  const healthFixturePath = join(publishRoot, "node-release-health");
  const healthFixture = releaseHealth
    .replaceAll(
      "/data/proofofwork-release-backups/managed",
      retentionRoot,
    )
    .replaceAll("/opt/proofofwork-api", liveCheckout);
  writeFileSync(healthFixturePath, healthFixture, { mode: 0o700 });
  chmodSync(healthFixturePath, 0o700);
  const healthy = spawnSync("/usr/bin/bash", [healthFixturePath], {
    encoding: "utf8",
  });
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.match(healthy.stdout, /current_provenance=1/u);

  writeFileSync(runtimeFile, "export const runtime = 'drift';\n");
  const runtimeDrift = spawnSync("/usr/bin/bash", [healthFixturePath], {
    encoding: "utf8",
  });
  assert.equal(runtimeDrift.status, 2, runtimeDrift.stderr);
  assert.match(runtimeDrift.stderr, /commit, tree, and runtime/u);
  writeFileSync(runtimeFile, "export const runtime = true;\n");

  runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "update-index",
    "--skip-worktree",
    "nested/tracked.txt",
  ]);
  writeFileSync(
    join(liveCheckout, "nested", "tracked.txt"),
    "health concealed drift\n",
  );
  const trackedDrift = spawnSync("/usr/bin/bash", [healthFixturePath], {
    encoding: "utf8",
  });
  assert.equal(trackedDrift.status, 2, trackedDrift.stderr);
  assert.match(trackedDrift.stderr, /tracked bytes differ from Git tree/u);
  writeFileSync(
    join(liveCheckout, "nested", "tracked.txt"),
    "canonical tracked bytes\n",
  );
  runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "update-index",
    "--no-skip-worktree",
    "nested/tracked.txt",
  ]);
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}

console.log("Node operations contract checks passed.");
