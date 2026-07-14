import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const caddy = readFileSync("deploy/Caddyfile", "utf8");
const caddyService = readFileSync("deploy/caddy-hardening.conf", "utf8");
const journaldStorage = readFileSync("deploy/journald-storage.conf", "utf8");
const logrotateTimer = readFileSync(
  "deploy/logrotate-timer-override.conf",
  "utf8",
);
const rsyslogLogrotate = readFileSync(
  "deploy/rsyslog-logrotate.conf",
  "utf8",
);
const ufwLogrotate = readFileSync("deploy/ufw-logrotate.conf", "utf8");
const ufwTmpfiles = readFileSync(
  "deploy/proofofwork-ufw-log-tmpfiles.conf",
  "utf8",
);
const postgresBackup = readFileSync(
  "deploy/proofofwork-postgres-logical-backup.sh",
  "utf8",
);
const postgresBackupService = readFileSync(
  "deploy/proofofwork-postgres-logical-backup.service",
  "utf8",
);
const postgresBackupTimer = readFileSync(
  "deploy/proofofwork-postgres-logical-backup.timer",
  "utf8",
);
const postgresBackupMount = readFileSync(
  "deploy/var-backups-postgresql.mount",
  "utf8",
);
const postgresBackupConfig = readFileSync(
  "deploy/postgresql-backup.conf",
  "utf8",
);
const postgresBasebackupTimer = readFileSync(
  "deploy/pg-basebackup-timer-override.conf",
  "utf8",
);
const releasePrune = readFileSync(
  "deploy/proofofwork-release-prune.sh",
  "utf8",
);
const apiService = readFileSync(
  "deploy/proofofwork-api-proof-index.conf",
  "utf8",
);
const apiNodeRuntime = readFileSync(
  "deploy/proofofwork-api-node-runtime.conf",
  "utf8",
);
const nodeRuntimeInstaller = readFileSync(
  "deploy/install-node-runtime.sh",
  "utf8",
);
const workerService = readFileSync(
  "deploy/proofofwork-indexer-worker.service",
  "utf8",
);
const electrsService = readFileSync("deploy/electrs-hardening.conf", "utf8");
const electrsNetwork = readFileSync("deploy/electrs-network.toml", "utf8");
const bitcoinService = readFileSync("deploy/bitcoind-hardening.conf", "utf8");
const bitcoinRpcNetwork = readFileSync(
  "deploy/bitcoin-rpc-network.conf",
  "utf8",
);
const bitcoinBridgeCheck = readFileSync(
  "deploy/verify-bitcoin-rpc-bridge.sh",
  "utf8",
);
const privateApi = readFileSync(
  "deploy/zz-proofofwork-api-private-network.conf",
  "utf8",
);
const privateApiSocket = readFileSync(
  "deploy/proofofwork-api-wg.socket",
  "utf8",
);
const privateApiProxy = readFileSync(
  "deploy/proofofwork-api-wg.service",
  "utf8",
);
const html = readFileSync("index.html", "utf8");

for (const requiredHeader of [
  "Strict-Transport-Security",
  "Content-Security-Policy",
  "frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy",
  "X-Frame-Options",
]) {
  assert.ok(
    caddy.includes(requiredHeader),
    `Caddy hardening is missing ${requiredHeader}.`,
  );
}
assert.match(caddy, /max-age=31536000, immutable/u);
assert.match(caddy, /no-cache, must-revalidate/u);
assert.match(caddy, /encode zstd gzip/u);
assert.match(caddy, /reverse_proxy http:\/\/10\.77\.0\.2:8081/u);
assert.equal(
  caddy.match(/header_up X-Forwarded-For \{remote_host\}/gu)?.length,
  2,
  "Caddy must bind API rate-limit identity to the direct public client on both proxy routes.",
);
assert.doesNotMatch(caddy, /reverse_proxy http:\/\/65\.108\.122\.87/u);
assert.match(
  caddy,
  /http:\/\/77\.42\.91\.106 \{\s+respond "HTTPS hostname required\." 421\s+\}/u,
);
assert.doesNotMatch(
  caddy,
  /http:\/\/77\.42\.91\.106 \{\s+import common_id_app\s+\}/u,
);
assert.match(caddy, /handle \/health\*/u);
assert.match(caddy, /not path \/assets\/\* \/api\/\* \/health\*/u);
assert.match(
  caddy,
  /\(common_headers\)[\s\S]*frame-src 'self';/u,
);
assert.match(
  caddy,
  /\(landing_headers\)[\s\S]*frame-src 'self' https:\/\/www\.youtube\.com https:\/\/www\.youtube-nocookie\.com/u,
);
assert.doesNotMatch(caddy, /browser-sandbox|navigate-to|sandbox allow-scripts/u);
for (const redirectHost of [
  "proofofwork.me",
  "token.proofofwork.me",
  "tokens.proofofwork.me",
]) {
  assert.ok(
    caddy.includes(`${redirectHost} {\n\timport common_headers\n\tredir`),
    `${redirectHost} redirect must carry the security headers.`,
  );
}
assert.doesNotMatch(caddy, /activity\.proofofwork\.me/u);
assert.doesNotMatch(caddy, /pay2speak\.proofofwork\.me/u);

for (const service of [
  bitcoinService,
  caddyService,
  apiService,
  workerService,
  electrsService,
  privateApiProxy,
]) {
  assert.match(service, /LimitCORE=0/u);
  assert.match(service, /CapabilityBoundingSet=/u);
  assert.match(service, /ProtectKernelTunables=true/u);
}
assert.match(caddyService, /NoNewPrivileges=true/u);
assert.match(caddyService, /ProtectHome=true/u);
assert.match(caddyService, /Restart=on-failure/u);
assert.match(caddyService, /RestartSec=5s/u);
assert.match(
  caddyService,
  /CapabilityBoundingSet=\nCapabilityBoundingSet=CAP_NET_BIND_SERVICE/u,
);
assert.match(
  caddyService,
  /AmbientCapabilities=\nAmbientCapabilities=CAP_NET_BIND_SERVICE/u,
);
assert.match(workerService, /ProtectSystem=full/u);
assert.match(workerService, /ProtectHome=true/u);
assert.match(
  apiNodeRuntime,
  /ExecStart=\nExecStart=\/opt\/node-v24\.18\.0-linux-x64\/bin\/node \/opt\/proofofwork-api\/server\/proof-api\.mjs/u,
);
assert.match(
  workerService,
  /ExecStart=\/opt\/node-v24\.18\.0-linux-x64\/bin\/node \/opt\/proofofwork-api\/scripts\/run-proof-indexer-worker\.mjs --loop/u,
);
assert.match(
  apiService,
  /EnvironmentFile=\/etc\/proofofwork-api\/proof-indexer-db\.env/u,
);
assert.match(
  workerService,
  /EnvironmentFile=\/etc\/proofofwork-api\/proof-indexer-db\.env/u,
);
assert.match(nodeRuntimeInstaller, /version="24\.18\.0"/u);
assert.match(
  nodeRuntimeInstaller,
  /expected_sha256="55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742"/u,
);
assert.match(nodeRuntimeInstaller, /sha256sum --check --strict/u);
assert.match(journaldStorage, /SystemMaxUse=1G/u);
assert.match(journaldStorage, /MaxRetentionSec=7day/u);
assert.match(logrotateTimer, /OnCalendar=hourly/u);
assert.match(rsyslogLogrotate, /hourly/u);
assert.match(ufwLogrotate, /create 0640 syslog adm/u);
assert.match(ufwTmpfiles, /f \/var\/log\/ufw\.log 0640 syslog adm/u);
assert.match(postgresBackupConfig, /max_slot_wal_keep_size = '16GB'/u);
assert.match(
  postgresBackupMount,
  /What=\/data\/proofofwork-postgres-backups\/physical/u,
);
assert.match(postgresBackupMount, /Options=bind,nodev,nosuid,noexec/u);
assert.match(postgresBackup, /pg_dump[\s\S]*--format=custom/u);
assert.match(postgresBackup, /pg_dumpall[\s\S]*--globals-only/u);
assert.match(postgresBackup, /pg_restore --list/u);
assert.match(postgresBackup, /sha256sum/u);
assert.match(postgresBackup, /\.dumpset/u);
assert.match(postgresBackupService, /ProtectSystem=strict/u);
assert.match(
  postgresBackupService,
  /ReadWritePaths=\/data\/proofofwork-postgres-backups\/logical/u,
);
assert.match(postgresBackupTimer, /OnCalendar=\*-\*-\* 03:15:00 UTC/u);
assert.match(postgresBasebackupTimer, /Persistent=true/u);
assert.match(
  releasePrune,
  /Refusing unapproved release-retention target/u,
);
assert.match(releasePrune, /checksum_lines/u);
assert.match(releasePrune, /referenced_name.*!=.*name/u);
assert.match(releasePrune, /sha256sum --check --status --strict/u);
for (const directive of [
  "NoNewPrivileges=true",
  "PrivateDevices=true",
  "PrivateTmp=true",
  "ProtectControlGroups=true",
  "ProtectHome=true",
  "ProtectKernelLogs=true",
  "ProtectKernelModules=true",
  "ProtectKernelTunables=true",
  "ProtectSystem=full",
  "RestrictSUIDSGID=true",
  "LockPersonality=true",
  "RestrictRealtime=true",
  "SystemCallArchitectures=native",
]) {
  assert.ok(
    electrsService.includes(directive),
    `Electrs hardening is missing ${directive}.`,
  );
}
assert.match(electrsService, /^CapabilityBoundingSet=$/mu);
assert.match(electrsService, /^AmbientCapabilities=$/mu);
assert.match(electrsService, /After=docker\.service/u);
assert.match(
  electrsService,
  /ExecStartPre=\+\/usr\/local\/sbin\/proofofwork-bitcoin-rpc-bridge-ready/u,
);
assert.match(
  electrsNetwork,
  /^electrum_rpc_addr = "172\.27\.0\.1:50001"$/mu,
);
assert.doesNotMatch(electrsNetwork, /0\.0\.0\.0|\[::\]/u);
assert.match(bitcoinService, /ProtectSystem=full/u);
assert.match(bitcoinService, /NoNewPrivileges=true/u);
assert.match(bitcoinService, /After=docker\.service/u);
assert.match(
  bitcoinService,
  /ExecStartPre=\+\/usr\/local\/sbin\/proofofwork-bitcoin-rpc-bridge-ready/u,
);
assert.match(bitcoinRpcNetwork, /^rpcbind=127\.0\.0\.1$/mu);
assert.match(bitcoinRpcNetwork, /^rpcbind=172\.27\.0\.1$/mu);
assert.match(bitcoinRpcNetwork, /^rpcallowip=172\.27\.0\.0\/16$/mu);
assert.doesNotMatch(bitcoinRpcNetwork, /0\.0\.0\.0|172\.16\.0\.0\/12/u);
assert.match(bitcoinBridgeCheck, /network_name="mempool_mempool"/u);
assert.match(bitcoinBridgeCheck, /expected_cidr="172\.27\.0\.1\/16"/u);
assert.match(bitcoinBridgeCheck, /docker network inspect/u);
assert.match(privateApi, /Environment=HOST=127\.0\.0\.1/u);
assert.match(privateApiSocket, /ListenStream=10\.77\.0\.2:8081/u);
assert.match(privateApiSocket, /BindsTo=wg-quick@wg0\.service/u);
assert.match(privateApiSocket, /PartOf=wg-quick@wg0\.service/u);
assert.match(privateApiProxy, /systemd-socket-proxyd 127\.0\.0\.1:8081/u);
assert.match(privateApiProxy, /ProtectSystem=strict/u);
assert.match(privateApiProxy, /BindsTo=wg-quick@wg0\.service/u);
assert.match(
  privateApiProxy,
  /PartOf=proofofwork-api-wg\.socket wg-quick@wg0\.service/u,
);

for (const broadcastLimit of [
  "POW_API_BROADCAST_RATE_WINDOW_MS=60000",
  "POW_API_BROADCAST_RATE_PER_CLIENT=12",
  "POW_API_BROADCAST_RATE_GLOBAL=120",
  "POW_API_BROADCAST_CONCURRENCY_MAX=4",
]) {
  assert.ok(
    apiService.includes(broadcastLimit),
    `API hardening is missing ${broadcastLimit}.`,
  );
}

for (const electrumLimit of [
  "ELECTRUM_HOST=172.27.0.1",
  "ELECTRUM_PORT=50001",
  "ELECTRUM_MAX_IN_FLIGHT=8",
  "ELECTRUM_MAX_QUEUE=256",
  "ELECTRUM_MAX_RESPONSE_BYTES=16777216",
]) {
  assert.ok(
    apiService.includes(electrumLimit),
    `API hardening is missing ${electrumLimit}.`,
  );
}
assert.match(apiService, /WALLET_SCOPED_INDEX_WAIT_MS=10000/u);
assert.match(workerService, /POW_INDEX_RUSH_BOOTSTRAP_BATCH_SIZE=250/u);
assert.match(workerService, /POW_INDEX_RUSH_ELECTRUM_TIMEOUT_MS=120000/u);
assert.match(workerService, /ELECTRUM_HOST=172\.27\.0\.1/u);
assert.match(workerService, /ELECTRUM_PORT=50001/u);

assert.doesNotMatch(html, /favicon\.png/u);
assert.match(html, /apple-touch-icon\.png/u);

console.log("Hardening contract checks passed.");
