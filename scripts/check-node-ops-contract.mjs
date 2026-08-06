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
  symlinkSync,
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
const apiWireGuardSocket = read("deploy/proofofwork-api-wg.socket");
const apiWireGuardService = read("deploy/proofofwork-api-wg.service");
const wireGuardRecovery = read("deploy/wireguard-node-api-listener.conf");
const opsAlert = read("deploy/proofofwork-ops-alert.sh");
const opsAlertService = read("deploy/proofofwork-ops-alert@.service");
const nodeApiHealth = read("deploy/proofofwork-node-api-health.sh");
const nodeApiHealthService = read("deploy/proofofwork-node-api-health.service");
const nodeApiHealthTimer = read("deploy/proofofwork-node-api-health.timer");
const postgresBackupHealth = read(
  "deploy/proofofwork-postgres-backup-health.sh",
);
const postgresBackupHealthService = read(
  "deploy/proofofwork-postgres-backup-health.service",
);
const postgresBackupHealthTimer = read(
  "deploy/proofofwork-postgres-backup-health.timer",
);
const postgresOffsiteBackup = read(
  "deploy/proofofwork-postgres-offsite-backup.sh",
);
const postgresOffsiteBackupService = read(
  "deploy/proofofwork-postgres-offsite-backup.service",
);
const postgresOffsiteBackupTimer = read(
  "deploy/proofofwork-postgres-offsite-backup.timer",
);
const postgresBackupAlerts = read("deploy/postgresql-backup-alerts.conf");
const apiProofIndex = read("deploy/proofofwork-api-proof-index.conf");
const indexerWorkerService = read("deploy/proofofwork-indexer-worker.service");
const logicalBackupService = read(
  "deploy/proofofwork-postgres-logical-backup.service",
);
const cachePruneService = read("deploy/proofofwork-cache-prune.service");
const infrastructure = read("OP_RETURN_INFRASTRUCTURE.md");

for (const executable of [
  "deploy/proofofwork-node-release-publish.sh",
  "deploy/proofofwork-node-release-health.sh",
  "deploy/proofofwork-node-storage-health.sh",
  "deploy/proofofwork-postgres-query-health.sh",
  "deploy/proofofwork-ops-alert.sh",
  "deploy/proofofwork-node-api-health.sh",
  "deploy/proofofwork-postgres-backup-health.sh",
  "deploy/proofofwork-postgres-offsite-backup.sh",
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
assert.match(
  releasePruneService,
  /^CapabilityBoundingSet=CAP_DAC_READ_SEARCH$/mu,
);
assert.match(
  releasePruneService,
  /^AmbientCapabilities=CAP_DAC_READ_SEARCH$/mu,
);
assert.match(releasePruneService, /^RestrictAddressFamilies=AF_UNIX$/mu);

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
assert.match(releasePublish, /--upload-pack=\/usr\/bin\/git-upload-pack/u);
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
assert.match(releaseHealth, /8#\$\{file_mode\} & 0100/u);
assert.match(releaseHealth, /8#\$\{file_mode\} & 0111/u);
assert.doesNotMatch(releaseHealth, /-x "\$\{live_path\}"/u);
assert.match(releaseHealth, /runtime_attestation/u);
assert.match(releaseHealth, /proof-of-work-node-release-provenance-v2/u);
assert.match(releaseHealth, /POW_RELEASE_MAX_CHECKOUT_COUNT:-9/u);
assert.match(releaseHealth, /unverified legacy node release archives/u);
assert.match(releaseHealth, /critical_archive_count/u);

for (const isolatedGitScript of [releasePublish, releaseHealth, releasePrune]) {
  assert.match(isolatedGitScript, /\/usr\/bin\/env --ignore-environment/u);
  assert.match(isolatedGitScript, /GIT_CONFIG_NOSYSTEM=1/u);
  assert.match(isolatedGitScript, /GIT_CONFIG_SYSTEM=\/dev\/null/u);
  assert.match(isolatedGitScript, /GIT_CONFIG_GLOBAL=\/dev\/null/u);
  assert.match(isolatedGitScript, /GIT_NO_LAZY_FETCH=1/u);
  assert.match(isolatedGitScript, /GIT_NO_REPLACE_OBJECTS=1/u);
  assert.match(isolatedGitScript, /GIT_TERMINAL_PROMPT=0/u);
  assert.match(isolatedGitScript, /GIT_CONFIG_KEY_2=core\.fsmonitor/u);
  assert.match(isolatedGitScript, /GIT_CONFIG_VALUE_2=false/u);
  assert.match(isolatedGitScript, /GIT_CONFIG_KEY_4=core\.hooksPath/u);
  assert.match(isolatedGitScript, /GIT_CONFIG_VALUE_4=\/dev\/null/u);
  assert.match(isolatedGitScript, /GIT_CONFIG_KEY_8=maintenance\.auto/u);
  assert.match(isolatedGitScript, /GIT_CONFIG_KEY_11=protocol\.allow/u);
  assert.match(isolatedGitScript, /GIT_CONFIG_VALUE_11=never/u);
  assert.match(isolatedGitScript, /GIT_CONFIG_KEY_12=protocol\.file\.allow/u);
  assert.match(isolatedGitScript, /GIT_CONFIG_VALUE_12=always/u);
  assert.match(
    isolatedGitScript,
    /GIT_CONFIG_KEY_13=uploadpack\.packObjectsHook/u,
  );
  assert.match(isolatedGitScript, /GIT_CONFIG_VALUE_13=\/usr\/bin\/env/u);
  assert.match(
    isolatedGitScript,
    /GIT_CONFIG_KEY_14=core\.alternateRefsCommand/u,
  );
  assert.match(isolatedGitScript, /GIT_CONFIG_VALUE_14=\/usr\/bin\/false/u);
  assert.match(isolatedGitScript, /isolated_checkout_git/u);
  assert.match(
    isolatedGitScript,
    /--git-dir="\$\{trusted_checkout\}\/\.git"/u,
  );
  assert.match(isolatedGitScript, /--work-tree="\$\{trusted_checkout\}"/u);
}

assert.doesNotMatch(releasePrune, /\/usr\/bin\/git -c safe\.directory/u);

assert.match(releaseHealthService, /ProtectSystem=strict/u);
assert.match(
  releaseHealthService,
  /^CapabilityBoundingSet=CAP_DAC_READ_SEARCH$/mu,
);
assert.match(
  releaseHealthService,
  /^AmbientCapabilities=CAP_DAC_READ_SEARCH$/mu,
);
assert.match(releaseHealthService, /^RestrictAddressFamilies=AF_UNIX$/mu);
assert.doesNotMatch(releaseHealthService, /^ReadWritePaths=/mu);
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

assert.match(apiWireGuardSocket, /^ListenStream=10\.77\.0\.2:8081$/mu);
assert.doesNotMatch(apiWireGuardSocket, /ListenStream=(0\.0\.0\.0|\[::\])/u);
assert.match(
  apiWireGuardSocket,
  /^After=network-online\.target wg-quick@wg0\.service$/mu,
);
assert.match(apiWireGuardSocket, /^BindsTo=wg-quick@wg0\.service$/mu);
assert.match(apiWireGuardSocket, /^PartOf=wg-quick@wg0\.service$/mu);
assert.match(
  apiWireGuardSocket,
  /^WantedBy=sockets\.target wg-quick@wg0\.service$/mu,
);
assert.match(apiWireGuardService, /^BindsTo=wg-quick@wg0\.service$/mu);
assert.match(apiWireGuardService, /^After=proofofwork-api\.service$/mu);
assert.doesNotMatch(
  apiWireGuardService,
  /^(?:Requires|BindsTo|PartOf)=proofofwork-api\.service$/mu,
);
assert.match(apiWireGuardService, /^Restart=on-failure$/mu);
assert.match(apiWireGuardService, /^RestartSec=1s$/mu);
assert.match(wireGuardRecovery, /^Wants=proofofwork-api-wg\.socket$/mu);
assert.match(wireGuardRecovery, /^\[Unit\]$/mu);
assert.match(wireGuardRecovery, /^OnFailure=proofofwork-ops-alert@%n\.service$/mu);

assert.match(opsAlert, /event=unit_failure/u);
assert.match(opsAlert, /daemon\.crit/u);
assert.match(opsAlert, /POW_ALERT_DEDUPE_SECONDS:-900/u);
assert.match(opsAlert, /root:root/u);
assert.match(opsAlert, /config_mode.*600/u);
assert.match(opsAlert, /journal\.last/u);
assert.match(opsAlert, /webhook\.last/u);
assert.match(opsAlert, /for attempt in 1 2 3/u);
assert.match(opsAlert, /webhook_delivered == 1/u);
assert.match(opsAlertService, /^StateDirectory=proofofwork-alerts$/mu);
assert.match(opsAlertService, /^CapabilityBoundingSet=$/mu);
assert.match(opsAlertService, /^ExecStart=\/usr\/local\/sbin\/proofofwork-ops-alert %i$/mu);

assert.match(nodeApiHealth, /http:\/\/127\.0\.0\.1:8081/u);
assert.match(nodeApiHealth, /proofofwork-op-return-api/u);
assert.match(nodeApiHealth, /available.*is not True/su);
assert.match(nodeApiHealth, /ready.*is not True/su);
assert.match(nodeApiHealth, /worker_restarts_increased/u);
assert.match(nodeApiHealthService, /^StateDirectory=proofofwork-ops-health$/mu);
assert.match(nodeApiHealthTimer, /^OnCalendar=\*:0\/2$/mu);

assert.match(
  postgresBackupHealth,
  /"\$\{sha256sum_bin\}" --check --status --strict/u,
);
assert.match(postgresBackupHealth, /logical_max_age.*108000/u);
assert.match(postgresBackupHealth, /physical_max_age.*691200/u);
assert.match(postgresBackupHealth, /wal_max_age.*1800/u);
assert.match(postgresBackupHealth, /full_verify_max_age.*86400/u);
assert.match(postgresBackupHealth, /logical_verification="cached"/u);
assert.match(postgresBackupHealth, /pg_receivewal@16-main\.service/u);
assert.match(postgresBackupHealth, /pg_compresswal@16-main\.timer/u);
assert.match(postgresBackupHealth, /offsite_evidence/u);
assert.match(postgresBackupHealthService, /^RestrictAddressFamilies=AF_UNIX$/mu);
assert.match(postgresBackupHealthService, /^StateDirectory=proofofwork-backup-health$/mu);
assert.match(postgresBackupHealthService, /^IOSchedulingClass=idle$/mu);
assert.match(postgresBackupHealthService, /^IOWeight=10$/mu);
assert.match(postgresBackupHealthTimer, /^OnCalendar=\*:0\/5$/mu);
assert.match(postgresBackupAlerts, /^OnFailure=proofofwork-ops-alert@%n\.service$/mu);

for (const alertedService of [
  releasePruneService,
  releaseHealthService,
  storageHealthService,
  postgresQueryHealthService,
  logicalBackupService,
  indexerWorkerService,
  cachePruneService,
  apiProofIndex,
]) {
  assert.match(
    alertedService,
    /^OnFailure=proofofwork-ops-alert@%n\.service$/mu,
  );
}

assert.match(postgresOffsiteBackup, /POW_OFFSITE_BACKUP_ENABLED:-0/u);
assert.match(postgresOffsiteBackup, /sftp:proofofwork-offsite-backup:/u);
assert.match(postgresOffsiteBackup, /BatchMode=yes/u);
assert.match(postgresOffsiteBackup, /StrictHostKeyChecking=yes/u);
assert.match(postgresOffsiteBackup, /UserKnownHostsFile=/u);
assert.match(postgresOffsiteBackup, /Inline or command-derived restic passwords are forbidden/u);
assert.match(postgresOffsiteBackup, /snapshots --json --latest 1/u);
assert.match(postgresOffsiteBackup, /backup --json --tag proofofwork-postgres/u);
assert.match(postgresOffsiteBackup, /snapshots --json "\$\{snapshot_id\}"/u);
assert.match(postgresOffsiteBackup, /snapshot\.get\("id"\) != sys\.argv\[5\]/u);
assert.match(postgresOffsiteBackup, /snapshot\.get\("hostname"\) != sys\.argv\[6\]/u);
assert.match(postgresOffsiteBackup, /check --read-data-subset/u);
assert.match(postgresOffsiteBackup, /POW_OFFSITE_LOGICAL_MAX_AGE_SECONDS:-108000/u);
assert.match(postgresOffsiteBackup, /POW_OFFSITE_PHYSICAL_MAX_AGE_SECONDS:-691200/u);
assert.match(postgresOffsiteBackup, /POW_OFFSITE_WAL_MAX_AGE_SECONDS:-1800/u);
assert.match(postgresOffsiteBackup, /pg_receivewal@16-main\.service/u);
assert.match(postgresOffsiteBackup, /\[0-9A-F\]\{24\}.*\\\.gz/u);
assert.ok(
  (postgresOffsiteBackup.match(/sort --numeric-sort \|\s*\/usr\/bin\/tail --lines=1/gu) ?? [])
    .length >= 3,
  "Off-site source selection must consume complete inventories without a pipefail/head SIGPIPE.",
);
assert.doesNotMatch(
  postgresOffsiteBackup,
  /sort --numeric-sort --reverse \| \/usr\/bin\/head/u,
);
assert.doesNotMatch(postgresOffsiteBackup, /"\$\{restic\[@\]\}" (init|forget|prune)/u);
assert.match(postgresOffsiteBackupService, /^EnvironmentFile=\/etc\/proofofwork-backup\/offsite\.env$/mu);
assert.match(postgresOffsiteBackupService, /^User=postgres$/mu);
assert.match(postgresOffsiteBackupTimer, /^OnCalendar=\*-\*-\* 05:15:00 UTC$/mu);
assert.match(infrastructure, /deliberately default-off and is not a\s+completed backup/su);

for (const [name, value] of Object.entries({
  POW_RUSH_PUBLIC_READS_ENABLED: "0",
  POW_API_RESPONSE_CACHE_MAX_ENTRIES: "512",
  POW_API_RESPONSE_CACHE_MAX_BYTES: "268435456",
  POW_API_EXACT_TIP_TOKEN_CACHE_MAX_ENTRIES: "128",
  POW_API_EXACT_TIP_TOKEN_CACHE_MAX_BYTES: "268435456",
  MAX_TRANSACTION_CACHE_SIZE: "20000",
  MAX_TRANSACTION_CACHE_BYTES: "268435456",
  TRANSACTION_CACHE_TTL_MS: "21600000",
  POW_API_PUBLIC_READ_MAX_QUERY_BYTES: "8192",
  POW_API_PUBLIC_READ_MAX_RECOVERY_HINTS: "12",
  POW_API_HISTORY_MAX_PAGE: "10000",
  POW_API_HISTORY_MAX_OFFSET: "1000000",
  POW_API_HEAVY_READ_MAX_ACTIVE: "8",
  POW_API_HEAVY_READ_MAX_QUEUED: "32",
  POW_API_HEAVY_READ_QUEUE_WAIT_MS: "1500",
  POW_API_FRESH_READ_MAX_ACTIVE: "2",
  POW_API_FRESH_READ_MAX_QUEUED: "8",
  POW_API_FRESH_READ_QUEUE_WAIT_MS: "1000",
  POW_API_EXPENSIVE_READ_RATE_WINDOW_MS: "10000",
  POW_API_HEAVY_READ_RATE_PER_CLIENT: "30",
  POW_API_FRESH_READ_RATE_PER_CLIENT: "6",
  POW_API_TRUSTED_PROXY_ADDRESSES: "127.0.0.1,::1,10.77.0.1",
})) {
  assert.ok(
    apiProofIndex.includes(`Environment=${name}=${value}`),
    `API production config is missing ${name}=${value}.`,
  );
}
assert.doesNotMatch(releasePublish, /safe\.directory=.*upload-pack/u);

for (const requiredPath of [
  "deploy/postgresql-observability.conf",
  "deploy/postgresql-proof-index-tablespace.conf",
  "deploy/proofofwork-node-storage-health.sh",
  "deploy/proofofwork-postgres-query-health.sh",
  "deploy/proofofwork-node-release-publish.sh",
  "deploy/proofofwork-node-release-health.sh",
  "deploy/wireguard-node-api-listener.conf",
  "deploy/proofofwork-ops-alert.sh",
  "deploy/proofofwork-node-api-health.sh",
  "deploy/proofofwork-postgres-backup-health.sh",
  "deploy/proofofwork-postgres-offsite-backup.sh",
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
  const pruneFsmonitorMarker = join(testRoot, "prune-fsmonitor-executed");
  const maliciousPruneFsmonitor = join(
    testRoot,
    "malicious-prune-fsmonitor",
  );
  writeFileSync(
    maliciousPruneFsmonitor,
    [
      "#!/usr/bin/env bash",
      "set -Eeuo pipefail",
      `printf 'executed\\n' >>${JSON.stringify(pruneFsmonitorMarker)}`,
      "printf '\\n'",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  chmodSync(maliciousPruneFsmonitor, 0o700);
  runChecked("/usr/bin/git", [
    "-C",
    pruneNodeCheckout,
    "config",
    "core.fsmonitor",
    maliciousPruneFsmonitor,
  ]);
  runChecked("/usr/bin/git", [
    "-C",
    pruneNodeCheckout,
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  assert.equal(
    existsSync(pruneFsmonitorMarker),
    true,
    "The malicious prune fsmonitor control fixture was not armed.",
  );
  rmSync(pruneFsmonitorMarker);
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
  assert.equal(
    existsSync(pruneFsmonitorMarker),
    false,
    "The privileged node release-prune validation executed repository-local fsmonitor config.",
  );
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

  const fsmonitorMarker = join(publishRoot, "fsmonitor-executed");
  const maliciousFsmonitor = join(publishRoot, "malicious-fsmonitor");
  writeFileSync(
    maliciousFsmonitor,
    [
      "#!/usr/bin/env bash",
      "set -Eeuo pipefail",
      `printf 'executed\\n' >>${JSON.stringify(fsmonitorMarker)}`,
      "printf '\\n'",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  chmodSync(maliciousFsmonitor, 0o700);
  const uploadPackMarker = join(publishRoot, "upload-pack-hook-executed");
  const maliciousUploadPackHook = join(
    publishRoot,
    "malicious-upload-pack-hook",
  );
  writeFileSync(
    maliciousUploadPackHook,
    [
      "#!/usr/bin/env bash",
      "set -Eeuo pipefail",
      `printf 'executed\\n' >>${JSON.stringify(uploadPackMarker)}`,
      'exec "$@"',
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  chmodSync(maliciousUploadPackHook, 0o700);
  runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "config",
    "core.fsmonitor",
    maliciousFsmonitor,
  ]);
  runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "config",
    "uploadpack.packObjectsHook",
    maliciousUploadPackHook,
  ]);
  runChecked("/usr/bin/git", [
    "-C",
    liveCheckout,
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  assert.equal(
    existsSync(fsmonitorMarker),
    true,
    "The malicious fsmonitor control fixture was not armed.",
  );
  rmSync(fsmonitorMarker);

  // The staged tar deliberately contains different tracked bytes. Publication
  // must construct from the attested live checkout instead of copying them.
  const matchingRelease = createReleaseArchive("trusted-live", true);
  const matchingResult = spawnSync(
    "/usr/bin/bash",
    [publisherFixturePath, matchingRelease.archivePath],
    { encoding: "utf8", env: publisherEnvironment },
  );
  assert.equal(matchingResult.status, 0, matchingResult.stderr);
  assert.equal(
    existsSync(fsmonitorMarker),
    false,
    "The privileged publisher executed repository-local fsmonitor config.",
  );
  assert.equal(
    existsSync(uploadPackMarker),
    false,
    "The privileged publisher executed repository-local upload-pack config.",
  );
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
  assert.equal(
    existsSync(fsmonitorMarker),
    false,
    "The privileged release-health verifier executed repository-local fsmonitor config.",
  );

  const retainedLegacyArchive = join(
    retentionRoot,
    "proofofwork-node-release-retained-legacy.tgz",
  );
  writeFileSync(retainedLegacyArchive, "retained historical evidence\n");
  chmodSync(retainedLegacyArchive, 0o600);
  const healthyWithRetainedLegacy = spawnSync(
    "/usr/bin/bash",
    [healthFixturePath],
    { encoding: "utf8" },
  );
  assert.equal(
    healthyWithRetainedLegacy.status,
    0,
    healthyWithRetainedLegacy.stderr,
  );
  assert.match(healthyWithRetainedLegacy.stdout, /legacy_unverified=1/u);
  assert.match(
    healthyWithRetainedLegacy.stderr,
    /current exact rollback evidence is healthy/u,
  );

  const unsafeSidecarArchive = join(
    retentionRoot,
    "proofofwork-node-release-unsafe-sidecar.tgz",
  );
  writeFileSync(unsafeSidecarArchive, "unsafe sidecar fixture\n");
  chmodSync(unsafeSidecarArchive, 0o600);
  symlinkSync(
    join(retentionRoot, "missing-checksum-target"),
    `${unsafeSidecarArchive}.sha256`,
  );
  const unsafeSidecar = spawnSync("/usr/bin/bash", [healthFixturePath], {
    encoding: "utf8",
  });
  assert.equal(unsafeSidecar.status, 2, unsafeSidecar.stderr);
  assert.match(unsafeSidecar.stderr, /sidecar is not a safe regular file/u);
  rmSync(`${unsafeSidecarArchive}.sha256`);
  rmSync(unsafeSidecarArchive);

  chmodSync(join(retentionRoot, matchingRelease.archiveName), 0o664);
  const unsafeArchiveMode = spawnSync("/usr/bin/bash", [healthFixturePath], {
    encoding: "utf8",
  });
  assert.equal(unsafeArchiveMode.status, 2, unsafeArchiveMode.stderr);
  assert.match(unsafeArchiveMode.stderr, /unsafe mode or ownership/u);
  chmodSync(join(retentionRoot, matchingRelease.archiveName), 0o644);

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

const healthTestRoot = mkdtempSync(join(tmpdir(), "pow-ops-health-contract-"));
try {
  const fakeCurl = join(healthTestRoot, "curl");
  const fakeSystemctl = join(healthTestRoot, "systemctl");
  const fakeSha256sum = join(healthTestRoot, "sha256sum");
  const sha256Counter = join(healthTestRoot, "sha256-check-count");
  const stateRoot = join(healthTestRoot, "state");
  mkdirSync(stateRoot);
  writeFileSync(
    fakeCurl,
    `#!/usr/bin/env bash
set -Eeuo pipefail
output=""
url=""
while (($#)); do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --write-out) shift 2 ;;
    http://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
if [[ "$url" == */health/live ]]; then
  printf '%s' '{"service":"proofofwork-op-return-api","available":true,"ready":false,"mode":"availability"}' >"$output"
  printf '200'
elif [[ "$url" == */health ]]; then
  if [[ "\${FAKE_READY:-1}" == "1" ]]; then
    printf '%s' '{"service":"proofofwork-op-return-api","available":true,"ready":true,"mode":"readiness"}' >"$output"
    printf '200'
  else
    printf '%s' '{"service":"proofofwork-op-return-api","available":true,"ready":false,"mode":"readiness"}' >"$output"
    printf '503'
  fi
else
  exit 22
fi
`,
    { mode: 0o700 },
  );
  writeFileSync(
    fakeSystemctl,
    `#!/usr/bin/env bash
set -Eeuo pipefail
case "$1" in
  is-active) exit 0 ;;
  show) printf '%s\n' "\${FAKE_RESTARTS:-22}" ;;
  *) exit 2 ;;
esac
`,
    { mode: 0o700 },
  );
  writeFileSync(
    fakeSha256sum,
    `#!/usr/bin/env bash
set -Eeuo pipefail
for argument in "$@"; do
  if [[ "$argument" == "--check" ]]; then
    printf 'check\n' >>"$POW_TEST_SHA_COUNTER"
    break
  fi
done
exec /usr/bin/sha256sum "$@"
`,
    { mode: 0o700 },
  );
  writeFileSync(sha256Counter, "");
  chmodSync(fakeCurl, 0o700);
  chmodSync(fakeSystemctl, 0o700);
  chmodSync(fakeSha256sum, 0o700);

  const nodeHealthEnvironment = {
    ...process.env,
    POW_OPS_ALLOW_TEST_ROOTS: "1",
    POW_OPS_CURL_BIN: fakeCurl,
    POW_OPS_SYSTEMCTL_BIN: fakeSystemctl,
    POW_OPS_SHA256SUM_BIN: fakeSha256sum,
    POW_TEST_SHA_COUNTER: sha256Counter,
    POW_NODE_HEALTH_STATE_ROOT: stateRoot,
    FAKE_READY: "1",
    FAKE_RESTARTS: "22",
  };
  const nodeHealthy = spawnSync(
    "/usr/bin/bash",
    ["deploy/proofofwork-node-api-health.sh"],
    { encoding: "utf8", env: nodeHealthEnvironment },
  );
  assert.equal(nodeHealthy.status, 0, nodeHealthy.stderr);
  assert.match(nodeHealthy.stdout, /live_http=200 ready_http=200/u);
  const workerRestarted = spawnSync(
    "/usr/bin/bash",
    ["deploy/proofofwork-node-api-health.sh"],
    {
      encoding: "utf8",
      env: { ...nodeHealthEnvironment, FAKE_RESTARTS: "23" },
    },
  );
  assert.equal(workerRestarted.status, 2, workerRestarted.stderr);
  assert.match(workerRestarted.stderr, /worker_restarts_increased/u);

  const logicalRoot = join(healthTestRoot, "logical");
  const physicalRoot = join(healthTestRoot, "physical", "16-main");
  const logicalSet = join(logicalRoot, "proof_indexer-20260805T010203Z.dumpset");
  const physicalSet = join(physicalRoot, "2026-08-05T010203Z.backup");
  mkdirSync(logicalSet, { recursive: true });
  mkdirSync(join(physicalRoot, "wal"), { recursive: true });
  mkdirSync(physicalSet);
  const dumpBytes = "logical dump fixture\n";
  const globalsBytes = "globals fixture\n";
  const dumpDigest = createHash("sha256").update(dumpBytes).digest("hex");
  const globalsDigest = createHash("sha256")
    .update(globalsBytes)
    .digest("hex");
  const validLogicalManifest =
    `${dumpDigest}  proof_indexer.dump\n${globalsDigest}  globals.sql\n`;
  writeFileSync(join(logicalSet, "proof_indexer.dump"), dumpBytes);
  writeFileSync(join(logicalSet, "globals.sql"), globalsBytes);
  writeFileSync(join(logicalSet, "SHA256SUMS"), validLogicalManifest);
  chmodSync(logicalSet, 0o700);
  for (const name of ["proof_indexer.dump", "globals.sql", "SHA256SUMS"]) {
    chmodSync(join(logicalSet, name), 0o600);
  }
  writeFileSync(join(physicalSet, "base.tar.gz"), "base backup fixture\n");
  writeFileSync(join(physicalSet, "backup_manifest"), "manifest fixture\n");
  writeFileSync(
    join(physicalSet, "status"),
    '{"status":"ok","type":"basebackup"}\n',
  );
  chmodSync(physicalSet, 0o700);
  for (const name of ["base.tar.gz", "backup_manifest", "status"]) {
    chmodSync(join(physicalSet, name), 0o600);
  }
  writeFileSync(join(physicalRoot, "wal", "A".repeat(24) + ".gz"), "wal\n");
  const backupHealthEnvironment = {
    ...process.env,
    POW_OPS_ALLOW_TEST_ROOTS: "1",
    POW_OPS_SYSTEMCTL_BIN: fakeSystemctl,
    POW_OPS_SHA256SUM_BIN: fakeSha256sum,
    POW_TEST_SHA_COUNTER: sha256Counter,
    POW_BACKUP_HEALTH_STATE_ROOT: stateRoot,
    POW_BACKUP_LOGICAL_ROOT: logicalRoot,
    POW_BACKUP_PHYSICAL_ROOT: physicalRoot,
    POW_OFFSITE_CONFIG: join(healthTestRoot, "offsite-not-configured"),
    POW_OFFSITE_EVIDENCE: join(healthTestRoot, "offsite-no-evidence"),
  };
  const backupHealthy = spawnSync(
    "/usr/bin/bash",
    ["deploy/proofofwork-postgres-backup-health.sh"],
    { encoding: "utf8", env: backupHealthEnvironment },
  );
  assert.equal(backupHealthy.status, 0, backupHealthy.stderr);
  assert.match(backupHealthy.stdout, /offsite=not-configured/u);
  assert.match(backupHealthy.stdout, /logical_verification=full/u);
  assert.equal(readFileSync(sha256Counter, "utf8"), "check\n");
  const backupCached = spawnSync(
    "/usr/bin/bash",
    ["deploy/proofofwork-postgres-backup-health.sh"],
    { encoding: "utf8", env: backupHealthEnvironment },
  );
  assert.equal(backupCached.status, 0, backupCached.stderr);
  assert.match(backupCached.stdout, /logical_verification=cached/u);
  assert.equal(
    readFileSync(sha256Counter, "utf8"),
    "check\n",
    "A cached five-minute health sample must not rehash the logical dump.",
  );

  const compressedWal = join(physicalRoot, "wal", "A".repeat(24) + ".gz");
  const rawWal = join(physicalRoot, "wal", "B".repeat(24));
  writeFileSync(rawWal, "raw wal\n");
  rmSync(compressedWal);
  const rawWalHealthy = spawnSync(
    "/usr/bin/bash",
    ["deploy/proofofwork-postgres-backup-health.sh"],
    { encoding: "utf8", env: backupHealthEnvironment },
  );
  assert.equal(rawWalHealthy.status, 0, rawWalHealthy.stderr);

  const physicalStatus = join(physicalSet, "status");
  const externalStatus = join(healthTestRoot, "external-status");
  writeFileSync(externalStatus, '{"status":"ok","type":"basebackup"}\n', {
    mode: 0o600,
  });
  rmSync(physicalStatus);
  symlinkSync(externalStatus, physicalStatus);
  const symlinkedPhysicalArtifact = spawnSync(
    "/usr/bin/bash",
    ["deploy/proofofwork-postgres-backup-health.sh"],
    { encoding: "utf8", env: backupHealthEnvironment },
  );
  assert.equal(
    symlinkedPhysicalArtifact.status,
    2,
    symlinkedPhysicalArtifact.stderr,
  );
  assert.match(symlinkedPhysicalArtifact.stderr, /physical_backup=invalid_artifacts/u);
  rmSync(physicalStatus);
  writeFileSync(physicalStatus, '{"status":"ok","type":"basebackup"}\n', {
    mode: 0o600,
  });

  const runBackupHealth = () =>
    spawnSync(
      "/usr/bin/bash",
      ["deploy/proofofwork-postgres-backup-health.sh"],
      { encoding: "utf8", env: backupHealthEnvironment },
    );
  const manifestPath = join(logicalSet, "SHA256SUMS");
  writeFileSync(manifestPath, `${dumpDigest}  proof_indexer.dump\n`);
  const omittedManifestEntry = runBackupHealth();
  assert.equal(omittedManifestEntry.status, 2, omittedManifestEntry.stderr);
  assert.match(omittedManifestEntry.stderr, /invalid_manifest_or_artifacts/u);

  writeFileSync(
    manifestPath,
    `${validLogicalManifest}${dumpDigest}  unexpected.dump\n`,
  );
  const extraManifestEntry = runBackupHealth();
  assert.equal(extraManifestEntry.status, 2, extraManifestEntry.stderr);
  assert.match(extraManifestEntry.stderr, /invalid_manifest_or_artifacts/u);

  writeFileSync(
    manifestPath,
    `${dumpDigest}  proof_indexer.dump\n${globalsDigest}  ../globals.sql\n`,
  );
  const traversalManifestEntry = runBackupHealth();
  assert.equal(traversalManifestEntry.status, 2, traversalManifestEntry.stderr);
  assert.match(traversalManifestEntry.stderr, /invalid_manifest_or_artifacts/u);

  writeFileSync(manifestPath, validLogicalManifest);
  const externalGlobals = join(healthTestRoot, "external-globals.sql");
  writeFileSync(externalGlobals, globalsBytes, { mode: 0o600 });
  rmSync(join(logicalSet, "globals.sql"));
  symlinkSync(externalGlobals, join(logicalSet, "globals.sql"));
  const symlinkedArtifact = runBackupHealth();
  assert.equal(symlinkedArtifact.status, 2, symlinkedArtifact.stderr);
  assert.match(symlinkedArtifact.stderr, /invalid_manifest_or_artifacts/u);
  rmSync(join(logicalSet, "globals.sql"));
  writeFileSync(join(logicalSet, "globals.sql"), globalsBytes, { mode: 0o600 });

  writeFileSync(join(logicalSet, "proof_indexer.dump"), "tampered\n");
  const backupTampered = spawnSync(
    "/usr/bin/bash",
    ["deploy/proofofwork-postgres-backup-health.sh"],
    { encoding: "utf8", env: backupHealthEnvironment },
  );
  assert.equal(backupTampered.status, 2, backupTampered.stderr);
  assert.match(
    backupTampered.stderr,
    /logical_backup=(?:checksum_failed|invalid_manifest_or_artifacts)/u,
  );

  const offsiteDisabled = spawnSync(
    "/usr/bin/bash",
    ["deploy/proofofwork-postgres-offsite-backup.sh"],
    {
      encoding: "utf8",
      env: { POW_OFFSITE_BACKUP_ENABLED: "0" },
    },
  );
  assert.equal(offsiteDisabled.status, 2, offsiteDisabled.stderr);
  assert.match(offsiteDisabled.stderr, /Off-site backup is disabled/u);
} finally {
  rmSync(healthTestRoot, { recursive: true, force: true });
}

console.log("Node operations contract checks passed.");
