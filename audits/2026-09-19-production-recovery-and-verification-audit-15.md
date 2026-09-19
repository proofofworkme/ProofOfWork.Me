# Production recovery and verification audit 15 — 2026-09-19

## Scope

Approved follow-up actions from audits 13 and 14 were executed with production
changes limited to PostgreSQL backup/WAL recovery and a local node-ops test
fix. No protocol records, ledgers, application tables, or chain data were
modified.

## Actions completed

- Re-established read-only SSH access to both VPS environments.
- Created a fresh PostgreSQL physical base backup using the documented
  `pg_basebackup@16-main.service` unit.
- Base backup completed successfully at `2026-09-19 04:54:27 UTC` after
  approximately 13 minutes.
- Recreated the broken physical replication slot
  `pg_receivewal_service` after the base backup completed.
- Preserved the obsolete local WAL archive rather than deleting it:
  `/var/backups/postgresql/16-main/wal-lost-slot-20260919T045531Z`.
- Created a fresh receiver directory at
  `/var/backups/postgresql/16-main/wal` and restarted
  `pg_receivewal@16-main.service`.
- Receiver is active with the recreated slot; observed lag was approximately
  7,125 kB at verification time.
- Updated `scripts/check-node-ops-contract.mjs` so its forbidden-operation
  scan is token-aware and no longer rejects harmless source-text substrings.
- `npm run check:node-ops` passed after the fix.

## UI retention

The approved six release candidates were not deleted. The production retention
tool failed closed because multiple complete-root UI rollbacks remain and some
candidate names are referenced by rollback-classification evidence. No manual
bypass was used.

The six candidates remain pending a supported classification/retention run:

- `proofofwork-ui-release-6c1b47801671-20260905T020357Z`
- `proofofwork-ui-release-b76a4f56aff2-20260903T033447Z`
- `proofofwork-ui-release-96d3f8935592-20260903T023514Z`
- `proofofwork-ui-release-89736d9d42f7-20260902T222258Z`
- `proofofwork-ui-release-fb4d08ab973e-20260902T155203Z`
- `proofofwork-ui-release-5f3ab07b1ddd-20260902T145844Z`

Each has a matching release archive, checksum sidecar, and provenance sidecar
under `/var/backups/proofofwork-ui/releases`. Rollback-bound copies were
preserved.

## Current capacity and service state

- Node `/data`: approximately 332–347 GiB free during the operation; 79% used
  after the new base backup.
- PostgreSQL database: 28 GB.
- `pg_receivewal@16-main.service`: active after recovery.
- Core, Electrs, PostgreSQL, API, and indexer worker: active at the node check.
- UI root: 38G volume, 13G free, 66% used before any retention action.
- UI release-prune: still fails closed due to multiple complete-root rollbacks.

## Verification limitations

- Bitcoin Core RPC credentials were not available to the read-only SSH account,
  so `getblockchaininfo` and `getmempoolinfo` were not independently verified.
- The command-line ordered application harness still fails with API/DNS
  `fetch failed` from this environment.
- A complete canonical ledger/event/UI reconciliation therefore remains
  pending an authorized RPC credential path and functioning audit API access.

## Commit and deployment scope

The node-ops test fix and this audit evidence are the only repository changes.
No application bundle or protocol code changed, so no UI/API application
deployment was required. The production infrastructure changes above were
applied and verified directly on the node VPS.

## Remaining follow-up

1. Classify the multiple complete-root rollback set through the supported
   retention workflow before deleting any release archive.
2. Provide a read-only Core RPC credential path and rerun sync/mempool checks.
3. Restore command-line API/DNS reachability and rerun all ordered surfaces.
4. Reconcile the application/indexer/database values against one fenced Core
   checkpoint and attach machine-readable evidence.
