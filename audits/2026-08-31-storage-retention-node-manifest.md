# 2026-08-31 Node Storage-Retention Manifest

Scope: read-only manifest for `pow-bitcoin-01`
(`powadmin@65.108.122.87`). This file records candidate cleanup targets and
proposed next commands only. No production storage was deleted, no databases
were dropped, no services were restarted, and no production configuration was
changed during this phase.

## Health Snapshot

- Node/API health: `ok=true`, `ready=true`.
- Bitcoin Core: `main`, blocks `964901`, headers `964901`, IBD `false`,
  pruned `false`, warnings `[]`.
- Proof index: indexed through `964901`, lag `0`, snapshot
  `a591c24e802aec50bc37f5ce`.
- Summary coverage: Growth, Inception, Infinity, Log, Marketplace, Token,
  WORK floor, and WORK summary all cover block `964901`.
- Pending event health: `ok=true`, global unresolved `0`, Q16 unresolved `0`.
- Disk: `/` `39%` used, `/data` `83%` used, `/data` free `272G`.
- Inodes: `/` `9%`, `/data` `1%`.
- Database: `proof_indexer` is `17 GB`, no waiting locks, readiness queue `0`.

## Protected Live State

These are not cleanup candidates.

- `/data/bitcoin`: `904G`, live Bitcoin Core chain data.
- `/data/electrs`: `60G`, live address index.
- `/data/proofofwork-postgres-tablespaces/proof_indexer_large_state_v1/PG_16_202307071/789821`:
  `17G`, live `proof_indexer` database large-state tablespace directory.
- `/opt/proofofwork-api`: live API checkout/runtime.
- `/data/proofofwork-api-cache`: `175M`, live API cache.

## PostgreSQL Databases Requiring Owner Decision

These databases are not the live `proof_indexer` database. They are large
storage candidates, but they appear to be recovery/fault/rehearsal databases
and must be explicitly retained, archived off-box, or dropped by approval.

| OID | Database | Size | Allows Connections | Phase 2 Classification |
| --- | --- | ---: | --- | --- |
| `735631` | `proof_indexer_fault_reorg_20260826t2342z` | `26 GB` | `false` | Candidate after reorg evidence decision |
| `580086` | `proof_indexer_pre_rollback_current_20260825T140941Z` | `14 GB` | `true` | Candidate after rollback evidence decision |
| `117238` | `proof_indexer_fault_20260816t171442` | `14 GB` | `true` | Candidate after fault evidence decision |
| `16385` | `proof_indexer_rollback_20260711_final` | `3545 MB` | `false` | Candidate after July rollback evidence decision |
| `190363` | `proof_indexer_work_atoms_rehearsal_574a04c` | `757 MB` | `true` | Candidate after rehearsal decision |
| `233190` | `proof_indexer_shadow_20260718` | `422 MB` | `true` | Candidate after shadow decision |
| `350073` | `proof_indexer_incb_repair_20260719_v5` | `304 MB` | `true` | Candidate after INCB repair decision |
| `370258` | `proof_indexer_incb_repair_20260719_v6` | `291 MB` | `true` | Candidate after INCB repair decision |
| `312011` | `proof_indexer_incb_repair_20260719_v4` | `282 MB` | `true` | Candidate after INCB repair decision |
| `292973` | `proof_indexer_incb_repair_20260719_v3` | `280 MB` | `true` | Candidate after INCB repair decision |
| `273257` | `proof_indexer_incb_repair_20260718_v2` | `279 MB` | `true` | Candidate after INCB repair decision |
| `254185` | `proof_indexer_incb_repair_20260718` | `268 MB` | `true` | Candidate after INCB repair decision |

Proposed phase 2 verification before any drop:

```bash
ssh -i ~/.ssh/proofofwork_node_ed25519 -o IdentitiesOnly=yes powadmin@65.108.122.87 'sudo -n -u postgres psql -d postgres -c "SELECT oid, datname, pg_size_pretty(pg_database_size(oid)), datallowconn FROM pg_database ORDER BY pg_database_size(oid) DESC;"'
```

Proposed phase 2 drop form, to run only for approved database names:

```bash
ssh -i ~/.ssh/proofofwork_node_ed25519 -o IdentitiesOnly=yes powadmin@65.108.122.87 'sudo -n -u postgres dropdb --if-exists "APPROVED_DATABASE_NAME"'
```

## PostgreSQL Backup Retention Candidates

Top-level backup usage:

- `/data/proofofwork-postgres-backups/logical`: `120G`.
- `/data/proofofwork-postgres-backups/physical`: `110G`.
- `/data/proofofwork-postgres-backups/recovery-evidence`: `9.6G`.
- `/data/proofofwork-postgres-backups/recovery-20260820T211000Z.tar.zst`:
  `567M`.
- `/data/proofofwork-postgres-backups/prechange`: `48M`.
- `/data/proofofwork-postgres-backups/validation-evidence`: `6.6M`.

Logical dump sets:

| Timestamp | Size | Path | Phase 2 Classification |
| --- | ---: | --- | --- |
| `2026-08-25T03:24` | `7.0G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-20260825T031900Z.dumpset` | Candidate after retention policy |
| `2026-08-25T13:46` | `7.4G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-pre-rollback-20260825T134001Z.dumpset` | Protect until rollback evidence decision |
| `2026-08-25T21:30` | `11G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-20260825T211952Z.dumpset` | Candidate after retention policy |
| `2026-08-26T03:29` | `11G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-20260826T031853Z.dumpset` | Candidate after retention policy |
| `2026-08-26T10:03` | `11G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-20260826T095257Z.dumpset` | Candidate after retention policy |
| `2026-08-26T10:49` | `11G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-20260826T103901Z.dumpset` | Candidate after retention policy |
| `2026-08-26T12:55` | `7.6G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-20260826T124945Z.dumpset` | Duplicated in reorg pinned backups; needs decision |
| `2026-08-26T19:45` | `7.7G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-20260826T193848Z.dumpset` | Duplicated in reorg pinned backups; needs decision |
| `2026-08-26T23:58` | `7.7G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-20260826T235127Z.dumpset` | Candidate after retention policy |
| `2026-08-27T03:25` | `7.8G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-20260827T031858Z.dumpset` | Candidate after retention policy |
| `2026-08-28T03:25` | `8.1G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-20260828T031900Z.dumpset` | Candidate after retention policy |
| `2026-08-29T03:26` | `8.4G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-20260829T031856Z.dumpset` | Retain as recent unless policy says otherwise |
| `2026-08-30T03:26` | `8.7G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-20260830T031855Z.dumpset` | Retain as recent |
| `2026-08-31T03:26` | `8.9G` | `/data/proofofwork-postgres-backups/logical/proof_indexer-20260831T031857Z.dumpset` | Retain as latest |

Physical backup and WAL:

| Size | Path | Phase 2 Classification |
| ---: | --- | --- |
| `46G` | `/data/proofofwork-postgres-backups/physical/16-main/2026-08-31T000345Z.backup` | Retain as latest physical base backup |
| `34G` | `/data/proofofwork-postgres-backups/physical/16-main/2026-08-25T203643Z.backup` | Candidate once latest base backup and needed WAL coverage are verified |
| `31G` | `/data/proofofwork-postgres-backups/physical/16-main/wal` | Retain only the WAL range required by approved PITR policy |

Proposed phase 2 retention command form, after exact policy approval:

```bash
ssh -i ~/.ssh/proofofwork_node_ed25519 -o IdentitiesOnly=yes powadmin@65.108.122.87 'sudo -n find /data/proofofwork-postgres-backups/logical -maxdepth 1 -mindepth 1 -type d -name "proof_indexer-*.dumpset" -print | sort'
```

Actual deletion commands must list approved paths explicitly. Do not use age-only
or broad wildcard deletion for these backups.

## Recovery Evidence

These are protected by default. They can be moved off-box or compacted only
after approval that names the exact target.

| Size | Path | Notes |
| ---: | --- | --- |
| `16G` | `/data/proofofwork-recovery/20260826T193700Z-reorg-964181` | Reorg incident evidence |
| `3.3G` | `/data/proofofwork-recovery/20260817T020625Z-q16-pending-recovery.tar.zst` | Q16 pending recovery archive |
| `101M` | `/data/proofofwork-recovery/20260816T1714-canonical-reorg` | Canonical reorg evidence |
| `4.0M` | `/data/proofofwork-recovery/20260816T1944-pending-projection-freshness` | Pending projection evidence |
| `2.0M` | `/data/proofofwork-recovery/20260816T202446Z-address-wallet-log-filter` | Wallet/log filter evidence |
| `2.0M` | `/data/proofofwork-recovery/20260818T221137Z-pending-work-listing-read-overlay` | Pending listing overlay evidence |

The `20260826T193700Z-reorg-964181` directory contains `16G` of
`pinned-backups`, specifically:

- `7.6G`
  `/data/proofofwork-recovery/20260826T193700Z-reorg-964181/pinned-backups/proof_indexer-20260826T124945Z.dumpset`
- `7.7G`
  `/data/proofofwork-recovery/20260826T193700Z-reorg-964181/pinned-backups/proof_indexer-20260826T193848Z.dumpset`

## Node Release/Stage Retention

Installed retention unit:

- `proofofwork-node-release-prune.service` runs
  `/usr/local/sbin/proofofwork-release-prune /data/proofofwork-release-backups/managed 3`.
- `proofofwork-node-release-prune.timer` exists but had no next run scheduled.
- `proofofwork-node-release-health.service` failed because the live node path
  is not recognized as its Git checkout root.

Managed release archive count: `40` `.tgz` files. Current configured keep count:
`3`.

Latest three managed release archives that match the keep-count intent:

- `/data/proofofwork-release-backups/managed/proofofwork-node-release-2250911-225091141c4c-20260831T071100Z.tgz`
- `/data/proofofwork-release-backups/managed/proofofwork-node-release-92b7582-92b758269d7d-20260831T073502Z.tgz`
- `/data/proofofwork-release-backups/managed/proofofwork-node-release-5de1b0c-5de1b0c59015-20260831T074908Z.tgz`

Older managed release archives are phase 2 prune candidates after confirming no
incident-specific archive must be pinned outside normal retention.

`/opt` stage/rollback/quarantine candidates total approximately `11G`:

| Size | Path |
| ---: | --- |
| `1.7G` | `/opt/proofofwork-retired-542cd64-20260827T060751Z` |
| `427M` | `/opt/proofofwork-quarantine` |
| `250M` | `/opt/proofofwork-api.pre-rollback-current-683464a-20260825T134644Z` |
| `234M` | `/opt/proofofwork-api-stage-542cd64c1067-20260827T054846Z` |
| `234M` | `/opt/proofofwork-api-stage-14f84ab-20260826T124434Z` |
| `231M` | `/opt/proofofwork-api-stage-93f085b52980-20260827T204432Z` |
| `229M` | `/opt/proofofwork-api-stage-90087f7dd4be-20260831T050700Z` |
| `229M` | `/opt/proofofwork-api-stage-82a7fae6e9c7-20260831T052600Z` |
| `229M` | `/opt/proofofwork-api-stage-009023c24844-20260826T113952Z` |
| `228M` | `/opt/proofofwork-api-stage-9f8b89fb1934-20260831T045200Z` |
| `227M` | `/opt/proofofwork-api-stage-2b1e7392cd5-20260831T042432Z` |
| `226M` | `/opt/proofofwork-api-stage-97065f4ffe2-20260831T042039Z` |
| `225M` | `/opt/proofofwork-api-stage-d039b0838ee1-20260831T055900Z` |
| `225M` | `/opt/proofofwork-api-stage-92b758269d7d-20260831T073502Z` |
| `225M` | `/opt/proofofwork-api-stage-67daacdc3ca0-20260831T022328Z` |
| `225M` | `/opt/proofofwork-api-stage-5de1b0c59015-20260831T074908Z` |
| `225M` | `/opt/proofofwork-api-stage-3cb2d0c828e-20260831T041006Z` |
| `225M` | `/opt/proofofwork-api-stage-39d4957451e-20260831T063058Z` |
| `225M` | `/opt/proofofwork-api-stage-2519e92920cb-20260831T040432Z` |
| `225M` | `/opt/proofofwork-api-stage-225091141c4c-20260831T064257Z` |
| `224M` | `/opt/proofofwork-api-stage-fb21b2dc4da8-20260827T043029Z` |
| `224M` | `/opt/proofofwork-api-stage-cf289ed83a8d-20260829T023127Z` |
| `224M` | `/opt/proofofwork-api-stage-c9450496012a-20260827T045135Z` |
| `224M` | `/opt/proofofwork-api-stage-b0b24c2dbf8f-20260827T203314Z` |
| `224M` | `/opt/proofofwork-api-stage-6ff2fa144acb-20260828T015626Z-rollback` |
| `224M` | `/opt/proofofwork-api-stage-6f69cf84872d-20260829T145800Z` |
| `224M` | `/opt/proofofwork-api-stage-6e6c3ee4cd65-20260829T025245Z` |
| `224M` | `/opt/proofofwork-api-stage-38e90e51f4a6-20260827T041410Z` |
| `224M` | `/opt/proofofwork-api-stage-33c12c5a2a42-20260829T010316Z` |
| `224M` | `/opt/proofofwork-api-stage-18dcd89f6d76-20260828T182500Z` |
| `223M` | `/opt/proofofwork-api-stage-f70b0bf3b047-20260827T170709Z` |
| `223M` | `/opt/proofofwork-api-stage-d7b5842563b0-20260831T035219Z` |
| `223M` | `/opt/proofofwork-api-stage-c4743d3cc618-20260829T024150Z` |
| `222M` | `/opt/proofofwork-api-stage-2f50b88d44ed-20260831T032327Z` |
| `221M` | `/opt/proofofwork-api-stage-d17b6c7f4584-20260831T024217Z` |
| `221M` | `/opt/proofofwork-api-stage-826474228bbe-20260831T031227Z` |
| `220M` | `/opt/proofofwork-api-stage-d77fb7db373f-20260831T030722Z` |
| `192M` | `/opt/proofofwork-api-stage-9f8b89fb1934-20260831T044300Z` |
| `192M` | `/opt/proofofwork-api-stage-92b758269d7d-20260831T073319Z` |
| `189M` | `/opt/proofofwork-api-stage-cdc8f77853d7-20260828T024205Z` |
| `188M` | `/opt/proofofwork-api-stage-78da1a8de05a-20260828T020349Z-rollback` |
| `188M` | `/opt/proofofwork-api-stage-6ff2fa144acb-20260827T231524Z` |
| `175M` | `/opt/proofofwork-api-stage-2002b1c82af8-20260828T180823Z` |
| `60M` | `/opt/proofofwork-api-stage-5de1b0c59015-20260831T074838Z` |
| `4.0K` | `/opt/proofofwork-api-stage-82a7fae6e9c7-20260831T052200Z` |

Proposed phase 2 command forms:

```bash
# Re-enable configured node release retention, if approved.
ssh -i ~/.ssh/proofofwork_node_ed25519 -o IdentitiesOnly=yes powadmin@65.108.122.87 'sudo -n systemctl enable --now proofofwork-node-release-prune.timer'

# Run the existing managed release prune, if approved.
ssh -i ~/.ssh/proofofwork_node_ed25519 -o IdentitiesOnly=yes powadmin@65.108.122.87 'sudo -n /usr/local/sbin/proofofwork-release-prune /data/proofofwork-release-backups/managed 3'
```

Any `/opt` deletion approval should list exact paths from the table above and
retain the live `/opt/proofofwork-api` checkout plus at least the latest known
good rollback/stage evidence.

## Cache And Quarantine

These are low-impact compared with backups and database copies.

| Size | Path | Phase 2 Classification |
| ---: | --- | --- |
| `175M` | `/data/proofofwork-api-cache` | Protect live |
| `93M` | `/data/proofofwork-api-cache-restore-shadow-c4d5e9c-retained` | Candidate after restore-shadow decision |
| `93M` | `/data/proofofwork-api-cache-restore-shadow-c4d5e9c-retained-norecovery` | Candidate after restore-shadow decision |
| `93M` | `/data/proofofwork-api-cache.audit-quarantine-20260810T051400Z` | Candidate after audit-quarantine decision |
| `65M` | `/data/proofofwork-api-cache-recovery-20260826T193700Z` | Protect until reorg recovery decision |
| `47M` | `/data/proofofwork-prethread-restore-20260805T031900Z` | Candidate after prethread restore decision |
| `25M` | `/data/proofofwork-api-cache-candidate-4acbde1de362-20260826T090612Z` | Candidate |

## Read-Pressure Findings

- Public/current routes are functioning, but some fresh reads are heavy.
- Loopback fresh probes returned `200`:
  - Marketplace summary compact fresh: `5.013s`, `3.4MB`.
  - Registry fresh `limit=5`: `14.395s`, `1.8MB`.
  - Log fresh `limit=5`: `8.115s`, `190KB`.
  - WORK summary fresh: `5.251s`, `2.9MB`.
  - Growth summary fresh: `3.039s`, `164KB`.
- Recent API logs showed `0` `Work queue depth exceeded` events in 24h, but
  `204` timeout/timed-out mentions and `141` checkpoint-mismatch route failures
  before current recovery.
- Source admission limits for raw transactions are: max in-flight `4`, max queue
  `64`, queue wait `5000ms`, capped at source lines around
  `server/proof-api.mjs:332` and enforced around `server/proof-api.mjs:7578`.

Proposed code fix pass, not executed in this phase:

1. Add per-route singleflight/coalescing for identical fresh summary requests.
2. Add duplicate raw-transaction request coalescing keyed by txid/verbosity.
3. Add operator-visible raw RPC admission metrics to health or an internal ops
   route.
4. Add compact/paginated variants for token and marketplace payloads used by
   first-paint UI views.
5. Keep exact-tip fail-closed semantics for math and canonical event state.
