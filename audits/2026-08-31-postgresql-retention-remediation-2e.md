# 2026-08-31 PostgreSQL Retention Remediation 2E

Scope: approved production storage-retention remediation on
`pow-bitcoin-01` (`powadmin@65.108.122.87`). This phase may change the logical
PostgreSQL backup retention depth from `14` to `7` in the tracked repo script
and production script, delete only six approved old standard logical backup
directories, and run `pg_backupcluster 16 main expirebasebackups 1` to keep only
the newest physical base backup and expire obsolete WAL before that remaining
backup.

Do not restart app services, deploy, delete other backups, delete recovery
evidence, commit, push, or change unrelated config.

## Preflight

Captured before cleanup on 2026-08-31:

- Public health: HTTP `200`, `ok=true`, `ready=true`, tip `964905`, indexed
  through `964905`, lag `0`, snapshot `56041beba915298d5860892b`.
- Node `/`: `98G` total, `19G` used, `75G` available, `20%` used.
- Node `/data`: `1.7T` total, `1.2T` used, `334G` available, `79%` used.
- Production logical backup script still had `keep=14`.
- Physical backup inventory showed two valid base backups and WAL:
  - `/var/backups/postgresql/16-main/2026-08-25T203643Z.backup`,
    `36468735108` bytes.
  - `/var/backups/postgresql/16-main/2026-08-31T000345Z.backup`,
    `48385676363` bytes.
  - `/var/backups/postgresql/16-main/wal`, `32982937770` bytes,
    `4002` files.

Approved logical delete targets were present as normal directories:

| Directory | Preflight Size |
| --- | ---: |
| `/data/proofofwork-postgres-backups/logical/proof_indexer-20260825T031900Z.dumpset` | `7.0G` |
| `/data/proofofwork-postgres-backups/logical/proof_indexer-20260825T211952Z.dumpset` | `11G` |
| `/data/proofofwork-postgres-backups/logical/proof_indexer-20260826T031853Z.dumpset` | `11G` |
| `/data/proofofwork-postgres-backups/logical/proof_indexer-20260826T095257Z.dumpset` | `11G` |
| `/data/proofofwork-postgres-backups/logical/proof_indexer-20260826T103901Z.dumpset` | `11G` |
| `/data/proofofwork-postgres-backups/logical/proof_indexer-20260826T124945Z.dumpset` | `7.6G` |

## Approved Mutations

- Changed tracked logical backup retention in
  `deploy/proofofwork-postgres-logical-backup.sh` from `keep=14` to `keep=7`.
- Updated canonical PostgreSQL backup documentation in
  `OP_RETURN_INFRASTRUCTURE.md` to describe the `7`-set logical retention
  window.
- Changed production logical backup retention in
  `/usr/local/sbin/proofofwork-postgres-logical-backup` from `keep=14` to
  `keep=7`.
- Deleted only the six approved old standard logical backup directories listed
  in the preflight table.
- Ran `pg_backupcluster 16 main expirebasebackups 1` as `postgres`.

## Post-Cleanup

Completed on 2026-08-31.

Production script result:

- Production retention line is now `7:keep=7`.
- Production script hash changed from
  `e7b52209aafd9ce98f76cfdbb5560c807c0f7acd6836348e85cb272a88e0c397` to
  `bcce62e2d12b1df7d8f10d805c4be24f144132a00aa5aba9491db71cdfa3c960`.

Logical backup cleanup result:

- Verified all six approved target directories were absent after deletion.
- Verified the retained logical backup inventory is exactly the latest seven
  standard timestamped dump sets:
  - `proof_indexer-20260826T193848Z.dumpset`
  - `proof_indexer-20260826T235127Z.dumpset`
  - `proof_indexer-20260827T031858Z.dumpset`
  - `proof_indexer-20260828T031900Z.dumpset`
  - `proof_indexer-20260829T031856Z.dumpset`
  - `proof_indexer-20260830T031855Z.dumpset`
  - `proof_indexer-20260831T031857Z.dumpset`
- Latest retained logical dump
  `proof_indexer-20260831T031857Z.dumpset/proof_indexer.dump` passed
  `pg_restore --list`.

Physical backup and WAL cleanup result:

- Verified the old physical base backup
  `/data/proofofwork-postgres-backups/physical/16-main/2026-08-25T203643Z.backup`
  was absent after retention.
- Verified the retained physical base backup
  `/data/proofofwork-postgres-backups/physical/16-main/2026-08-31T000345Z.backup`
  was present as a normal directory.
- Retained base backup status file reported `status:"ok"`, start
  `2026-08-31T000345Z`, end `2026-08-31T003730Z`.
- Physical backup inventory after cleanup:
  - Base backup: `48385676363` bytes.
  - WAL: `1255873777` bytes, `173` files.
  - Total: `49641550140` bytes.
- Remaining WAL range begins at `000000010000007100000069.gz`, matching the
  retained latest base backup start segment, and ends at
  `000000010000007200000015.gz.partial`.

Post-cleanup storage:

- Node `/`: `98G` total, `19G` used, `75G` available, `20%` used.
- Node `/data`: `1.7T` total, `1.1T` used, `453G` available, `71%` used.
- Node `/data` exact bytes: `1764768071680` total, `1188973391872` used,
  `486073905152` available.
- `/data/proofofwork-postgres-backups/logical`: `58G`.
- `/data/proofofwork-postgres-backups/physical`: `47G`.
- UI VPS `/`: `38G` total, `9.2G` used, `27G` available, `26%` used.

Post-cleanup health:

- Core node services active: `postgresql@16-main`, `proofofwork-api`,
  `proofofwork-indexer-worker`, `bitcoind`, `electrs`, and
  `pg_receivewal@16-main.service`.
- Current direct storage-health probe passed for `/` and `/data`.
- UI VPS `caddy` service active.
- Public health: HTTP `200`, `ok=true`, `ready=true`, tip `964905`, indexed
  through `964905`, lag `0`, snapshot `56041beba915298d5860892b`.
- Health checks reported node, Electrum, database, index, worker proof, and
  pending events all healthy.

Repository verification:

- `bash -n deploy/proofofwork-postgres-logical-backup.sh`
- `npm run check:node-ops`
- `npm run hygiene:fix`
- `npm run hygiene:check`
