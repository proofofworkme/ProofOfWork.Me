# 2026-08-31 PostgreSQL Retention Remediation 2C

Scope: approved production storage-retention remediation on
`pow-bitcoin-01` (`powadmin@65.108.122.87`). This phase may drop only the
old non-live PostgreSQL databases identified in the 2B target list and delete
only the verified duplicate/nonstandard logical backup directories identified
in the 2B target list.

Do not drop the live `proof_indexer` database. Do not delete standard logical
backup sets, physical base backups, WAL archives, or other recovery evidence.
Do not change production config, restart services, commit, push, or deploy.

## Preflight

Captured before cleanup on 2026-08-31:

- Node `/data`: `1.7T` total, `1.3T` used, `274G` available, `83%` used.
- Public health: HTTP `200`, `ok=true`, `ready=true`, tip `964904`, indexed
  through `964904`, lag `0`, snapshot `a02784a38e83164c0d4b3b77`.
- Live database: `proof_indexer`, `17 GB`, `7` sessions.
- Approved non-live database targets: all had `0` sessions.
- Approved backup directory targets existed with expected sizes.
- Latest logical backup was readable by `pg_restore -l` during the 2B audit.
- Physical base backups and WAL retention were explicitly out of scope.

## Approved Database Drop Targets

| Database | Preflight Size | Sessions |
| --- | ---: | ---: |
| `proof_indexer_fault_reorg_20260826t2342z` | `26 GB` | `0` |
| `proof_indexer_pre_rollback_current_20260825T140941Z` | `14 GB` | `0` |
| `proof_indexer_fault_20260816t171442` | `14 GB` | `0` |
| `proof_indexer_rollback_20260711_final` | `3545 MB` | `0` |
| `proof_indexer_work_atoms_rehearsal_574a04c` | `757 MB` | `0` |
| `proof_indexer_shadow_20260718` | `422 MB` | `0` |
| `proof_indexer_incb_repair_20260719_v5` | `304 MB` | `0` |
| `proof_indexer_incb_repair_20260719_v6` | `291 MB` | `0` |
| `proof_indexer_incb_repair_20260719_v4` | `282 MB` | `0` |
| `proof_indexer_incb_repair_20260719_v3` | `280 MB` | `0` |
| `proof_indexer_incb_repair_20260718_v2` | `279 MB` | `0` |
| `proof_indexer_incb_repair_20260718` | `268 MB` | `0` |

## Approved Backup Delete Targets

These are exact directory targets only:

- `/data/proofofwork-postgres-backups/logical/proof_indexer-pre-rollback-20260825T134001Z.dumpset`
  (`7.4G`), a nonstandard pre-rollback dump set outside the normal retention
  naming rule.
- `/data/proofofwork-recovery/20260826T193700Z-reorg-964181/pinned-backups/proof_indexer-20260826T124945Z.dumpset`
  (`7.6G`), verified duplicate of the normal retained logical backup by
  matching `SHA256SUMS` and file sizes.
- `/data/proofofwork-recovery/20260826T193700Z-reorg-964181/pinned-backups/proof_indexer-20260826T193848Z.dumpset`
  (`7.7G`), verified duplicate of the normal retained logical backup by
  matching `SHA256SUMS` and file sizes.

## Post-Cleanup

Completed on 2026-08-31.

Database cleanup result:

- Dropped all twelve approved non-live PostgreSQL databases with
  `dropdb --if-exists`, without `--force`.
- Post-cleanup PostgreSQL catalog showed only `proof_indexer`, `17 GB`, with
  normal live app sessions.
- No production app service was restarted.

Backup cleanup result:

- Deleted the three approved exact backup directories.
- Verified all three deleted paths were absent after cleanup.
- Verified the normal retained logical backups
  `proof_indexer-20260826T124945Z.dumpset`,
  `proof_indexer-20260826T193848Z.dumpset`, and
  `proof_indexer-20260831T031857Z.dumpset` still exist.
- Verified `13` timestamped logical backup sets remain. The normal timer can
  refill the retention window on its next run.
- Did not delete physical base backups, WAL archives, standard logical backup
  sets, or other recovery evidence.

Post-cleanup storage:

- `/`: `98G` total, `19G` used, `75G` available, `20%` used.
- `/data`: `1.7T` total, `1.2T` used, `334G` available, `79%` used.
- `/data/proofofwork-postgres-tablespaces`: `17G`.
- `/data/proofofwork-postgres-backups/logical`: `113G`.
- `/data/proofofwork-postgres-backups/physical`: `110G`.
- `/data/proofofwork-recovery`: `3.6G`.

Post-cleanup health:

- Core services active: `postgresql@16-main`, `proofofwork-api`,
  `proofofwork-indexer-worker`, `bitcoind`, `electrs`, and
  `pg_receivewal@16-main.service`.
- Public health: HTTP `200`, `ok=true`, `ready=true`, tip `964904`, indexed
  through `964904`, lag `0`, snapshot `a02784a38e83164c0d4b3b77`.
- Health checks reported node, Electrum, database, index, worker proof, and
  pending events all healthy.

Net effect:

- Node `/data` improved from `83%` used and `274G` available to `79%` used and
  `334G` available.
- The system is still above the documented `75%` storage-health warning line,
  so a separate retention-policy decision is still needed for deeper runway.
