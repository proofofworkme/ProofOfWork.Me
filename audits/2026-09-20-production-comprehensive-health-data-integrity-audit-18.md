# Production health and data-integrity audit 18

Audit date: 2026-09-20. Read-only production observations ran from
approximately 02:35 UTC through 03:22 UTC. These observations were taken on a
moving chain and during normal background jobs, so heights and mempool counts are
time-local checkpoints, not a frozen snapshot.

Local source while auditing: `e372815` (`fix(boost): render verified image and
video media`). The working tree already contained unrelated local changes before
this audit. This report is the only repository file intentionally added by this
audit.

**Result: production is operational and the checked canonical math/data
integrity paths pass, but this is not an all-clear.** The largest risks found in
this pass are capacity runway on the node `/data` volume, UI reserve volatility,
fresh-read latency/readiness windows, a repeatable node release-health warning,
and one local UI ops test timeout. No production records, protocol history,
ledgers, evidence, backups, caches, or configuration were changed. The only
cleanup action was removing `/tmp/pow-pending-sample.txt`, a temporary audit file
created by this audit during a pending-transaction probe.

## Scope

Required operating/canonical documents and prior audit records were reviewed
before live checks, including `SOUL.md`, `README.md`, `PROOFOFWORK_IDS.md`,
`MARKETPLACE.md`, `OP_RETURN_INFRASTRUCTURE.md`, `MAIL_ORGANIZATION.md`, audit
logs 12-17, and the audit-17 safe-stop handoff.

Systems checked:

- Node VPS `65.108.122.87` / `pow-bitcoin-01`: Core, Electrs, PostgreSQL 16,
  `pg_receivewal`, proof API, indexer worker, mempool Docker stack, backup/WAL
  jobs, storage/release/observation health units.
- UI VPS `77.42.91.106` / `ubuntu-4gb-hel1-1`: Caddy/static UI host, release
  backups, rollback roots, retention/prune/provenance/storage-health units.
- Public application/API surfaces: Home, IDs, Desktop, Browser, AMO, Credit,
  Wallet, WORK, Infinity, Inception, Log, Growth, Computer.
- Data objects checked by aggregate invariants and targeted replay/probes:
  events, transactions, addresses/participants, refs, IDs, credits/listings,
  ledger snapshots, pending/dropped status, mempool membership, and canonical
  summary/work-floor math.

## Health and Capacity

| System | Ending observation | Assessment |
| --- | --- | --- |
| Node root | 98 GiB total, 28 GiB used, 66 GiB free, 30% | Healthy |
| Node `/data` | 1.7 TiB total, 1.3 TiB used, 317 GiB free, 80% | Warning, worsening |
| Node memory/CPU | 124 GiB RAM, about 111 GiB available; load about 1.3/2.2/2.5; swap 629 MiB allocated of 15 GiB | No sampled pressure |
| UI root | 38 GiB total, 24 GiB used, 13 GiB free, 66% | OK now, limited reserve |
| UI memory/CPU | 3.7 GiB RAM, about 3.2 GiB available; load about 0.08/0.04/0.08; no swap | No sampled pressure |
| PostgreSQL `proof_indexer` | 29 GiB database | Healthy catalog checks; growth dominated by replay table |

Node storage inventory highlights: Core 910 GiB, Electrs 60 GiB, PostgreSQL
tablespaces 29 GiB, PostgreSQL backups 120 GiB, app backups 14 GiB, release
backups 12 GiB, `/tmp` 3.6 GiB, `/var/log` 974 MiB. The node storage health unit
is failing because `/data` is above the warning threshold; the hourly trend unit
also fails with `/data` in warning and a recent net-consumption estimate around
35 GB/day. This is the most important capacity finding.

UI storage had a worse condition during the audit window: the trend unit reported
critical reserve forecasts between 19:01 and 02:02 UTC, with headroom over the
10 GiB reserve briefly near 140-247 MiB. By 03:02 UTC the same unit succeeded:
about 13.1 GiB available, status `ok`, and `/var/backups/proofofwork-ui` down to
about 18.9 GiB. Ending snapshot still shows 18 GiB in the UI backup root, 1.6 GiB
in `/var/tmp/proofofwork-deploy`, 221 MiB in `/var/www`, and 606 MiB in
`/var/log`. Automatic retention is helping, but the prior full-disk failure class
is not eliminated because reserve can become critical before the static `df` view
looks alarming.

## Services and Node Health

Core, Electrs, PostgreSQL, `pg_receivewal`, proof API, WireGuard API socket,
WireGuard API service, and the indexer worker were active on the node. Caddy was
active on the UI VPS. The high-CPU `node /backend/package/index.js` process on
the node is the healthy `mempool/backend` Docker container, not a stray
ProofOfWork runtime.

Core health at the sampled checkpoint:

- Core 31.1, mainnet, unpruned, `initialblockdownload=false`.
- Blocks/headers 967783 on the first Core sample, later 967785 and then 967786
  during follow-up checks as new blocks arrived.
- `verificationprogress=1`, no Core warnings.
- 124 peers; txindex, coinstatsindex, and basic block filter index all synced.
- Mempool loaded; first sample had 74,761 transactions and about 39.4 MB.
- `verifychain 3 6` returned true.

The proof API/indexer caught up correctly as blocks arrived. A temporary mismatch
observed by `audit:ledger` was fail-closed: Core was one block ahead of the
registry checkpoint, so fresh marketplace reads returned 503 until the indexer
advanced. Later `/health` and `/health/live` were ready/ok at height 967786, with
worker `proofReady=true`, `lagBlocks=0`, pending event health ok, and zero
unresolved Q16 pending events.

Node failed units still requiring attention:

- `proofofwork-node-storage-health.service`: expected failure at `/data` 80%.
- `proofofwork-storage-trend@node.service`: expected warning/failure from node
  storage growth forecast.
- `proofofwork-api-observation-health.service`: latency/error observation
  failures; see API section.
- `proofofwork-node-release-health.service`: release archives verify, but `/opt`
  still has 22 node release checkouts, above the bounded inventory target.
- Historical audit-17 one-shot units remain failed in systemd state. They were
  reviewed as prior audit workflow evidence, not active runtime services.

The UI had no failed units at the final `systemctl --failed` check.

## Database and Backups

PostgreSQL 16.15 catalog checks:

- Database size: 30,871,796,759 bytes, about 29 GiB.
- Largest relation: `proof_indexer.work_amo_block_transitions`, 27 GiB.
- `ledger_snapshots` 775 MiB, `events` 149 MiB, `transactions` 102 MiB,
  `event_participants` 65 MiB, `tx_outputs` 60 MiB.
- Zero invalid/not-ready indexes.
- Zero unconvalidated constraints.
- Zero reported deadlocks for `proof_indexer`.
- No sampled lock-wait or idle-in-transaction issue.
- Physical PostgreSQL page checksums are still `off`; absence of checksum
  failures is therefore not evidence of page-level physical verification.

Backup/WAL status:

- `pg_receivewal@16-main` active and running.
- Replication slot `pg_receivewal_service` active, `wal_status=reserved`,
  `safe_wal_size` about 17.18 GB.
- `/var/backups/postgresql/16-main/wal` about 2.4 GiB, 384 files.
- Logical dumpsets present for 2026-09-17, 2026-09-18, and 2026-09-19.
- The 2026-09-20 logical backup fired during the audit at 03:18:48 UTC and was
  still active at last check, with temporary directory
  `.proof_indexer-20260920T031848Z.dumpset.tmp` at about 1.4 GiB.
- The backup capacity guard logged about 340.3 GB available, 100 GiB reserve, and
  maximum dump bytes about 35.1 GB.

The active September 20 backup was not a failure at audit close, but it should be
rechecked for completion. The backup tree remains the largest non-chain
operational growth source on the node at about 120 GiB.

## Data Integrity

Aggregate database invariants over production read models:

- `events`: 26,438 total; 26,262 confirmed; 176 pending.
- `transactions`: 25,832 total; 25,583 confirmed; 178 pending; 71 dropped.
- Duplicate transaction keys: 0.
- Duplicate event keys: 0.
- Duplicate event IDs: 0.
- Confirmed events without transaction row: 0.
- Confirmed events joined to non-confirmed transaction rows: 0.
- Confirmed event/transaction height mismatch: 0.
- Confirmed transactions missing raw data: 0.
- Orphan participants: 0.
- Orphan refs: 0.
- Duplicate participants: 0.
- Duplicate refs: 0.
- ID records: 505 confirmed records; duplicate `id_lower`: 0.
- Credit balances: 405 rows; pending delta sum 0; negative balances/deltas: 0.
- Credit listings: 72 active, 128 delisted, 119 dropped, 857 sealing; duplicate
  sale-ticket outpoints: 0.
- Ledger snapshots: 19,919 rows at the first snapshot query; latest checked
  snapshots were indexed through 967785 and then 967786 as Core advanced.

Confirmed invalid events are retained protocol history, not a storage-corruption
finding: 339 confirmed invalid events were classified as invalid WORK/ID attempts
(`token-event-invalid`, already-sealed listings, invalid legacy mints/listings,
and a small number of invalid ID sale/list events). Samples showed validation
errors such as `work-amo-v6-listing-already-sealed` and
`work-amo-v5-raw-mint-state-invalid`.

Pending status was checked against Core. Representative old pending transaction
IDs are still present in Core's live mempool and have no blockhash/confirmations
in txindex, so their pending status is not stale in the sampled cases. Dropped
transactions include 33 with reason
`absent-from-synced-unpruned-mainnet-bitcoin-core-txindex-and-mempool`; the rest
have no stored dropped reason.

Mail regression passed against production. The registry source resolved 527
records, and checked mail/contact/self-send cases all returned indexed mail/log
history without scan failure.

Marketplace fast regression passed against production. It covered ID lookup, V2
cutover/invalid state, POWB sealed listing, WORK listing lifecycle, wallet scopes,
targeted WORK transfers, and delayed transfer wallet recovery. It observed one
transient `CANONICAL_WALLET_INDEX_UNAVAILABLE` 503 on a fresh wallet read, then
retried successfully.

Production surface audit:

- Full pass with default timeout completed every surface except AMO.
- AMO failed with `This operation was aborted` on the default 20-second audit.
- Focused AMO retry with a 60-second timeout passed; marketplace summary took
  14,944 ms.
- Other surfaces passed but many API probes were slow: Wallet WORK token 11,869
  ms, WORK summary/floor 9,753/11,005 ms, Computer consistency 9,655 ms.

## Math Verification

Local and production math checks:

- `npm run check:work-precision`: passed, 131 checks, `work-atoms-v1`.
- `npm run check:work-precision-v2`: passed global Q16 units, immutable Q8
  conversion, V8 pricing/cutover/metadata/cross-plane wiring.
- `npm run check:bond-exact-arithmetic`: passed.
- `npm run check:work-amo-v8`: passed V8 declaration/gate regressions.
- `npm run check:api-truth`: passed.
- `npm run check:live-data`: passed.
- `npm run check:id-audit`: passed local ID audit contract checks.
- `npm run audit:ledger`: initially failed on a one-block freshness guard and a
  worker proof-readiness window, then passed after catch-up.

Final ledger result:

`Ledger consistency audit passed for https://work.proofofwork.me: snapshot
2b57f12e9aec6c79ffd45fcf, value 8387599195491582871.08091127 proofs.`

The work-floor API exposes exact fixed-point fields separately from approximate
floating fields. At the checked snapshot, `networkValueQ8` was
`838759919549158287108091127` and `floorQ8` was
`39940948549959918433`; the rendered exact floor was
`399409485499.59918433`. This matches deterministic integer/fixed-point
division by the 21,000,000 WORK supply with truncation to the Q8 scale.

No protocol/application math discrepancy was found in the checked paths.

## Test and Tooling Results

Passed:

- `check:work-precision`
- `check:work-precision-v2`
- `check:bond-exact-arithmetic`
- `check:work-amo-v8`
- `check:api-truth`
- `check:live-data`
- `check:marketplace-regressions` with `POW_API_BASE=https://computer.proofofwork.me`
- `check:mail-regressions`
- `check:id-audit`
- `check:node-ops`
- `check:surface-read-state`
- `check:production-observability`
- `audit:ledger` final retry
- `audit:surfaces -- --surface=amo` with longer timeout

Failed or limited:

- `audit:computer-events` was not run locally because no production database URL
  is configured in the local shell. Equivalent aggregate event/participant/ref
  integrity was checked directly with read-only production SQL.
- `audit:ids` refused to run locally without `POW_INTERNAL_VERIFIER_TOKEN`. ID
  contract checks passed, and production SQL/API counts were checked, but the
  token-protected production ID audit was not repeated from the local checkout.
- `check:ui-ops` timed out in the embedded Python compatibility-dependency
  regression harness after its hard 180-second timeout. Treat this as a tooling
  or performance finding requiring investigation, not as evidence of UI data
  corruption.
- `audit:surfaces` default timeout failed AMO, then focused AMO retry passed
  with a 60-second timeout. This is an availability/latency finding.

## Previously Reported Issues Rechecked

- Audit-17 raw transaction repair remains resolved: confirmed transactions
  missing raw data = 0.
- Audit-17 participant/ref/mail repair remains resolved: orphan participants = 0,
  orphan refs = 0, duplicate participants = 0, duplicate refs = 0, mail
  regressions passed.
- Audit-17 ID repair remains consistent in SQL/API checks: 505 confirmed ID
  records, 22 pending ID registration events, no duplicate `id_lower`.
- Audit-15 WAL receiver repair remains active: `pg_receivewal_service` active and
  reserved.
- Audit-16 UI retention improvement is working but not sufficient by itself:
  the UI trend job recovered to ok after earlier critical warnings in the same
  audit window.
- Node `/data` storage warning is worse than prior audits: previously about 76%,
  now 80%.
- Node release-health checkout-count warning persists.
- Fresh-read 503 behavior remains fail-closed and self-healing, but is visible to
  production audits and users during catch-up/proof windows.

## New Findings

### H18-01 Node `/data` capacity warning has worsened

Source: node `df`, storage-health/trend units, storage inventory.

Impact: `/data` is 80% used with 317 GiB free. This is below the 85% fail
threshold but above the warning threshold. The largest contributors are Core
chain data, PostgreSQL backups, Electrs, and tablespaces. Continued backup and
chain growth can push the node toward failure.

Recommended correction: approve a capacity plan before emergency pressure:
classify retained recovery/evidence trees, verify backup retention policy,
consider moving/expanding storage, and keep the 100 GiB backup reserve enforced.
Do not delete evidence/backups without a named approval and restore/RPO review.

### H18-02 UI storage reserve remains volatile

Source: UI storage trend logs and final capacity snapshot.

Impact: UI was critical earlier in the window and ok later after automatic
retention. A release/rollback burst can again consume the 10 GiB reserve even
when final `df` still reads 66%.

Recommended correction: keep hourly trend alerting, reduce peak deployment
scratch where possible, and approve a classified archive/retention plan for UI
backup roots. Consider increasing UI disk or off-hosting protected rollback
evidence.

### H18-03 Fresh API/readiness latency is operationally significant

Source: `proofofwork-api-observation-health`, marketplace regression, surface
audit, and ledger audit retries.

Impact: Data correctness is guarded by fail-closed 503s, but users and monitors
can observe slow responses and transient unavailability. Routes implicated
include `marketplace-summary`, `internal/canonical-summary`, `token`,
`token-history`, `token-summary`, WORK floor/summary, and Computer consistency.

Recommended correction: profile fresh summary/wallet/token paths, reduce payload
or recomputation costs, and consider making readiness state smoother without
weakening canonical freshness guarantees.

### H18-04 Node release-health checkout warning persists

Source: `proofofwork-node-release-health.service`.

Impact: Release archives verify, but `/opt` has 22 checkouts, above the bounded
inventory target. This is not currently the primary disk risk, but it is
operational drift and keeps the health unit failed.

Recommended correction: approve a release-checkout cleanup after verifying the
currently live release, provenance, and rollback requirements.

### H18-05 UI ops contract timeout

Source: `npm run check:ui-ops`.

Impact: The embedded compatibility dependency regression did not finish within
its hard 180-second timeout. This reduces confidence in the local UI ops test
gate until investigated.

Recommended correction: profile the embedded Python harness, decide whether the
timeout reflects expected workload growth or a regression, and update the test or
staging logic accordingly.

### H18-06 Physical database checksums remain disabled

Source: PostgreSQL `show data_checksums`.

Impact: Logical/catalog checks pass, but PostgreSQL cannot provide page-checksum
corruption detection for this cluster.

Recommended correction: track as a planned maintenance decision. Enabling data
checksums requires a controlled PostgreSQL procedure and downtime/replica plan.

## Actions Taken

- Performed read-only SSH, Core RPC, SQL, API, service, journal, and script
  checks.
- Removed `/tmp/pow-pending-sample.txt`, a temporary file created by this audit.
- Added this audit log.

No production data, protocol records, ledgers, backup artifacts, release
evidence, or historical records were modified or deleted.

## Items Requiring Approval

- Any cleanup of node PostgreSQL backup/recovery/evidence trees or release
  checkouts.
- Any cleanup of UI rollback/release/recovery-evidence roots.
- Any change to backup retention, storage thresholds, alert policy, or reserve
  sizing.
- Any performance/remediation deploy for fresh summary, wallet, token, AMO, or
  marketplace APIs.
- Any PostgreSQL checksum/restore/PITR drill that changes cluster state.

## Recommended Follow-Up

1. Recheck the September 20 logical PostgreSQL backup after it completes and
   validate its dump checksums.
2. Open a targeted capacity ticket for node `/data` before it reaches 85%.
3. Open a targeted UI storage ticket for reserve volatility, not just final
   percent-used.
4. Profile the slow fresh summary/token/marketplace/AMO paths using production
   observations from this audit.
5. Investigate `check:ui-ops` timeout and make the gate reliable again.
6. Decide whether to reset or archive historical failed audit-17 one-shot systemd
   units after preserving their evidence trail.

## Ordered Read-Only Surface Audit Addendum - 2026-09-20

Scope: Follow-up read-only audit requested after the comprehensive audit above.
The audit reviewed prior audit logs first, then checked the application surfaces
in this explicit order:

1. `proofofwork.me` - Home
2. `id.proofofwork.me` - ID management
3. `desktop.proofofwork.me` - Desktop
4. `browser.proofofwork.me` - Browser
5. `boost.proofofwork.me` - Social tools
6. `amo.proofofwork.me` - Autonomous Money Organization
7. `credit.proofofwork.me` - Credits
8. `wallet.proofofwork.me` - Wallet
9. `work.proofofwork.me` - Work
10. `infinity.proofofwork.me` - Infinity Bonds
11. `inception.proofofwork.me` - Inception Bonds
12. `log.proofofwork.me` - Logs
13. `growth.proofofwork.me` - Growth
14. `computer.proofofwork.me` - Computer, audited last

No production data, ledgers, database rows, backups, logs, configuration, code,
services, deployments, or cleanup targets were modified during this addendum.
The only approved write is this audit-log append.

### Previous Audit Logs Reviewed

- Audit 14 ordered surface audit:
  `audits/2026-09-19-production-ordered-surface-readonly-audit-14.md`.
- Audit 17 comprehensive health/data audit:
  `audits/2026-09-19-production-comprehensive-health-data-integrity-audit-17.md`.
- Audit 18 comprehensive health/data audit, above.

Previously reported ordered-surface failures were rechecked:

- AMO stuck loading: not reproduced; `amo.proofofwork.me` passed page and
  marketplace-summary probes.
- Log stuck loading cached Computer log: not reproduced; `log.proofofwork.me`
  passed page and log-summary probes.
- Growth ledger unavailable: not reproduced; `growth.proofofwork.me` passed page
  and growth-summary probes.
- Computer canonical verification incomplete: resolved in this run; Computer
  health and consistency probes passed.
- Prior lack of full-node access: resolved for this audit; Core RPC and index
  state were checked directly on the node VPS.

Previously reported audit-18 issues remain as follows:

- Node `/data` capacity risk: unresolved and materially worse after the logical
  backup completed.
- UI storage reserve volatility: unresolved. The current state is OK, but the
  storage trend service recorded critical reserve pressure earlier the same hour
  and had failed runs before recovering.
- Fresh API/readiness latency: unresolved. Correctness is still fail-closed, but
  production checks observed slow fresh reads and transient wallet 503s.
- UI ops contract timeout: unresolved; `npm run check:ui-ops` again timed out
  inside its Python compatibility fixture.
- PostgreSQL data checksums: still `off`.

### Full-Node Verification Results

Authoritative source: Bitcoin Core on `pow-bitcoin-01`, queried through
`bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf`.

- Chain: `main`.
- Height: `967790` blocks and headers.
- Best block hash:
  `000000000000000000011e5254174eb4229bda1693b0e8e5a2871014d7db4e35`.
- Verification progress: `1`; initial block download: `false`.
- Pruned: `false`.
- Mempool: loaded, `77907` transactions, `40193476` bytes,
  `224197744` memory usage, `fullrbf=true`.
- Indexes: `txindex`, `coinstatsindex`, and basic block filter index all synced
  at height `967790`.
- `verifychain 3 6`: `true`.

Public and private application health later agreed with the same canonical tip:

- `/health?network=livenet`: `ok=true`, `ready=true`,
  `tipHeight=967790`, `indexedThroughBlock=967790`, `lagBlocks=0`.
- Health node hash matched the Core best block hash above.
- Worker: `ok=true`, `proofReady=true`, phase `idle`,
  last success `2026-09-20T03:35:45.162Z`.
- Pending event health: `ok=true`, `globalUnresolved=0`,
  `q16PendingUnresolved=0`.
- Summary snapshot: `df013116a68858a16780388e`,
  generated/indexed at `2026-09-20T03:29:38.548Z`,
  payload about `20.6MB`.

### Ordered Surface Results

All requested surfaces served HTML and their expected API probes passed. Static
page responses were generally sub-second; data-heavy APIs were often
multi-second.

| Order | Surface | Result |
| --- | --- | --- |
| 1 | `proofofwork.me` | OK; HTML `948ms`, assets `4`, registry summary `5099ms`. |
| 2 | `id.proofofwork.me` | OK; HTML `483ms`, assets `4`, IDs summary `5450ms`. |
| 3 | `desktop.proofofwork.me` | OK; HTML `571ms`, assets `4`, log summary `6616ms`. |
| 4 | `browser.proofofwork.me` | OK; HTML `482ms`, assets `4`, activity summary `6723ms`. |
| 5 | `boost.proofofwork.me` | OK; HTML `200` in `0.47s`; Boost API `200` in `7.17s`. Feed indexed at block `967790` with snapshot `df013116a68858a16780388e`. |
| 6 | `amo.proofofwork.me` | OK; HTML `468ms`, assets `4`, marketplace summary `15381ms`. |
| 7 | `credit.proofofwork.me` | OK; HTML `478ms`, assets `4`, token summary `7842ms`. |
| 8 | `wallet.proofofwork.me` | OK; HTML `548ms`, assets `4`, WORK token `11503ms`. |
| 9 | `work.proofofwork.me` | OK; HTML `548ms`, assets `4`, work summary `11831ms`, work floor `9388ms`. |
| 10 | `infinity.proofofwork.me` | OK; HTML `465ms`, assets `4`, infinity summary `5523ms`. |
| 11 | `inception.proofofwork.me` | OK; HTML `497ms`, assets `4`, inception summary `5118ms`. |
| 12 | `log.proofofwork.me` | OK; HTML `473ms`, assets `4`, log summary `7172ms`. |
| 13 | `growth.proofofwork.me` | OK; HTML `463ms`, assets `4`, growth summary `6481ms`. |
| 14 | `computer.proofofwork.me` | OK; HTML `472ms`, assets `4`, health `1428ms`, consistency `7755ms`. |

### Database And Data-Integrity Results

PostgreSQL aggregate query on `proof_indexer`, network `livenet`:

- Database size: `29 GB`.
- Transactions: `25832` total, `25583` confirmed, `178` pending, `71` dropped.
- Confirmed transactions missing raw transaction bytes: `0`.
- Events: `26438` total; confirmed valid events: `25923`.
- Confirmed canonical action txids: `25265`.
- Confirmed events missing transaction rows: `0`.
- Confirmed events joined to non-confirmed transactions: `0`.
- Confirmed events missing raw transaction rows: `0`.
- Event refs: `56216`; event participants: `125934`.
- Confirmed credit definitions: `238`.
- Credit balances: `405`; negative confirmed balances: `0`;
  negative effective balances after pending deltas: `0`.
- Credit listings: `1176`.
- ID records: `505`.
- Confirmed mail items: `616`.
- OP_RETURN rows: `25706`.
- Invalid or not-ready indexes: `0`.
- Unvalidated constraints: `0`.
- Ledger snapshots: `19924`.
- Latest ledger snapshot: `df013116a68858a16780388e`, block `967790`,
  generated `2026-09-20 03:48:51.01+00`.

`npm run audit:ledger` passed against `https://work.proofofwork.me`, snapshot
`df013116a68858a16780388e`, with value
`8387599195491582871.08091127` proofs.

### Pending And Mempool Status

Sampled the eight most recently updated DB-pending transaction rows and checked
each against Bitcoin Core:

- All 8 sampled txids were present in Core's mempool.
- The local API status endpoint returned `status=pending` and `confirmed=false`
  for all 8 sampled txids.
- The status endpoint did not expose a separate `inMempool` field in the sampled
  response shape; pending display is therefore carried by the `status` field.

This sample supports pending/confirmed status correctness for current pending
rows, while the transient fresh wallet 503s below remain a readiness/availability
issue.

### Math And Protocol Verification

Passed:

- `npm run check:work-precision`: `131` checks, model `work-atoms-v1`.
- `npm run check:work-precision-v2`.
- `npm run check:bond-exact-arithmetic`.
- `npm run check:work-amo-v8`.
- `npm run check:api-truth`.
- `npm run check:live-data`.
- `npm run check:boost-regressions`.
- `npm run check:node-ops`.
- `npm run check:production-observability`.
- `npm run check:surface-read-state`.
- `npm run check:credit-mint-regressions`: POW
  `1,525,100/10,101,010` confirmed, `0` pending, `8,575,910` available;
  WORK `21,000,000/21,000,000` confirmed, `0` pending.
- `npm run check:send-prep-regressions`.
- `POW_API_BASE=https://computer.proofofwork.me npm run check:marketplace-regressions`.
- `npm run check:message-signatures`.
- `npm run check:canonical-order`.
- `npm run check:client-read-containment`.
- `npm run check:read-projections`.
- `npm run check:growth`.
- `npm run check:mail-regressions`.
- `npm run check:index-recovery-behavior`: `528/528` behavior checks passed.

No protocol math discrepancy was identified in this addendum. The checks above
covered deterministic ordering, exact WORK precision/Q16 behavior, bond
arithmetic, AMO V8 gates, marketplace lifecycle math, wallet reservation
behavior, ledger consistency, growth/Boost projections, mail projections, send
preparation, signatures, pending/recovery behavior, and fail-closed canonical
read behavior.

Checks that did not complete cleanly:

- `npm run check:hardening` failed in the local audit environment because its
  fixture expected `/usr/bin/psql`; this container does not have that path. This
  is a local check portability issue, not evidence of production data
  corruption.
- `npm run check:ui-ops` timed out inside its hardcoded 180-second Python
  compatibility dependency fixture. This keeps the UI ops gate unresolved.
- `npm run audit:computer-events` could not run locally because no
  `POW_INDEX_DATABASE_URL`, `PROOF_INDEX_DATABASE_URL`, or `DATABASE_URL` was
  present. Equivalent read-only production DB aggregate checks were run through
  `psql` instead.
- `npm run audit:ids` could not run locally because it requires
  `POW_INTERNAL_VERIFIER_TOKEN`. Equivalent ID count and surface/API checks were
  performed without exposing verifier secrets.

### VPS Health And Storage

UI VPS `ubuntu-4gb-hel1-1`, `2026-09-20T03:47:00Z`:

- Disk `/`: `38G` total, `24G` used, `13G` available, `66%`.
- Memory: `3.7GiB` total, `598MiB` used, `3.1GiB` available, no swap.
- Load average: `0.03`, `0.03`, `0.00`.
- Major storage consumers: `/var/backups/proofofwork-ui` `18G`,
  `/var/tmp/proofofwork-deploy` `1.6G`, `/var/www` `221M`,
  `/var/log` `607M`, `/tmp` `261M`.
- Listeners: SSH on `22`; Caddy on `80` and `443`; Caddy admin on
  `127.0.0.1:2019`.
- Storage timers present for UI storage health, release provenance, storage
  trend, release prune, and storage prune.
- `proofofwork-storage-trend@ui.service` current run at `03:02Z` was OK with
  `13,118,877,696` bytes available and `2,381,459,456` bytes reserve headroom.
- The same unit reported `critical` at `02:02Z`, with only `246,796,288` bytes
  reserve headroom and projected reserve exhaustion in `10303` seconds. Earlier
  `01:01Z` and `02:02Z` runs exited with `status=2/INVALIDARGUMENT`.

Node VPS `pow-bitcoin-01`, `2026-09-20T03:47:12Z`:

- Disk `/`: `98G` total, `28G` used, `66G` available, `30%`.
- Disk `/data`: `1.7T` total, `1.3T` used, `302G` available, `81%`.
- Memory: `124GiB` total, `15GiB` used, `109GiB` available; swap `15GiB`,
  `629MiB` used.
- Load average: `2.01`, `2.69`, `2.54`.
- Major storage consumers: `/data/bitcoin` `910G`, `/data/electrs` `60G`,
  `/data/proofofwork-postgres-tablespaces` `29G`,
  `/data/proofofwork-postgres-backups` `135G`,
  `/data/proofofwork-backups` `14G`,
  `/data/proofofwork-release-backups` `12G`, `/tmp` `3.6G`,
  `/var/log` `984M`.
- The September 20 logical PostgreSQL backup completed: directory
  `proof_indexer-20260920T031848Z.dumpset` exists, and
  `proofofwork-postgres-logical-backup.service` is inactive/dead with
  `Result=success`.
- `bitcoind` is active, has been running since `2026-09-12T06:24:39Z`, and uses
  about `38.4G` memory at this snapshot.
- `proofofwork-api` is active on the private listener `127.0.0.1:8081`, with
  about `2.4G` memory at the checked status snapshot.

### New Or Updated Findings

#### H18-07 Node `/data` backup/capacity risk worsened

Severity: High.

Source: node `df`, `du`, and backup service status at `2026-09-20T03:47Z`.

Evidence: `/data` is now `81%` used with `302G` available. The logical backup
completed successfully, but `/data/proofofwork-postgres-backups` grew to `135G`.
This is a worsening of H18-01, not a resolved item.

Impact: The node still has more absolute free space than the UI VPS, but
Bitcoin Core, electrs, PostgreSQL tablespaces, logical backups, recovery
artifacts, and release backups share the same `/data` risk surface. Continued
backup growth could consume the remaining margin.

Recommended correction: approve a backup-retention and recovery-evidence review
before `/data` reaches 85%. Do not delete backup/evidence trees until retention,
restore, and replay requirements are explicitly verified.

#### H18-08 UI reserve volatility remains the most immediate repeat-failure risk

Severity: High.

Source: UI `df`, `du`, storage trend journal, and timer status.

Evidence: Current disk usage is only `66%`, but the trend unit reported critical
reserve pressure at `02:02Z`, recovered by `03:02Z`, and had earlier failed
runs. The large directories remain `/var/backups/proofofwork-ui` (`18G`) and
`/var/tmp/proofofwork-deploy` (`1.6G`).

Impact: This directly matches the prior failure class where the UI server became
full and application failures followed. Percent-used alone is misleading because
reserve headroom can swing by gigabytes between hourly runs.

Recommended correction: require alerting on reserve headroom and backup/deploy
burst size, not only percent used. Review UI backup retention, deploy staging,
and prune job outcomes before any cleanup.

#### H18-09 Fresh wallet/API readiness still has intermittent fail-closed 503s

Severity: Medium.

Source: production marketplace regression gate.

Evidence: During the Carbonz delayed WORK transfer wallet recovery check, a
fresh wallet token read for address
`14hKW6Z3WKrJZayZhCvLJCocMaaAtTHd9L` returned
`503 CANONICAL_WALLET_INDEX_UNAVAILABLE` twice, then succeeded on the third
attempt. The overall marketplace regression passed.

Impact: Correctness is preserved because the API fails closed instead of serving
unverified wallet state, but users can still see transient unavailable wallet,
listing, or balance states.

Recommended correction: profile and smooth fresh wallet overlay/readiness
publication. Preserve fail-closed behavior, but reduce the duration/frequency of
temporary canonical-wallet unavailability.

#### H18-10 Data-heavy public API paths are correct but slow

Severity: Medium.

Source: ordered surface audit, Boost API probe, marketplace regression timings.

Evidence: Several successful endpoints were slow: marketplace summary `15381ms`,
WORK token `11503ms`, work summary `11831ms`, work floor `9388ms`, Boost feed
`7170ms`, log/growth/browser/desktop summaries about `6-7s`, and marketplace
history/wallet regression groups often `5-18s`.

Impact: Slow reads increase user-visible loading time and raise the probability
that callers hit readiness race windows or timeouts even when data is correct.

Recommended correction: prioritize profiling cached fresh summaries, token
history filters, wallet overlays, Boost feed valuation, and marketplace summary
paths. Add latency SLO alerting for data-heavy endpoints.

#### H18-11 Local ops/hardening test gates are not reliably green

Severity: Medium.

Source: local `npm run check:ui-ops` and `npm run check:hardening`.

Evidence: `check:ui-ops` timed out inside its Python fixture after the hardcoded
180-second budget. `check:hardening` failed because the local environment lacks
`/usr/bin/psql`, producing a different error than the fixture expected.

Impact: These failures reduce confidence in pre-deploy operational gates even
though production runtime checks were healthy in this audit.

Recommended correction: make the UI ops fixture faster or split it into bounded
subtests. Make the hardening fixture independent of a fixed `/usr/bin/psql`
path, or explicitly document the required local dependency.

### Storage Items Requiring Review Before Any Cleanup

- UI: `/var/backups/proofofwork-ui` `18G`.
- UI: `/var/tmp/proofofwork-deploy` `1.6G`.
- Node: `/data/proofofwork-postgres-backups` `135G`.
- Node: `/data/proofofwork-backups` `14G`.
- Node: `/data/proofofwork-release-backups` `12G`.
- Node: `/tmp` `3.6G`.
- Existing historical audit/recovery artifacts in `deploy/audit17/` and audit
  logs remain evidence-bearing until explicitly reviewed.

No cleanup was performed.

### Actions Taken In This Addendum

- Reviewed previous audit logs and current audit 18 findings.
- Ran read-only public surface probes in the user-specified order.
- Ran manual read-only Boost page/API probes.
- Queried full-node, mempool, index, API health, PostgreSQL aggregate state,
  disk/memory/load, service status, timers, and storage allocation.
- Ran read-only local and production regression/contract checks listed above.
- Appended this audit-log addendum after completing the audit.

### Items Requiring Explicit Approval

- Any cleanup of UI backups, deploy staging directories, rollback roots, or
  temporary files.
- Any cleanup of node PostgreSQL backups, release backups, `/tmp`, or recovery
  evidence.
- Any service restart, deploy, configuration change, backup-retention change, or
  database maintenance operation.
- Any protocol/data/ledger repair, historical record change, or production
  database mutation.
- Any fix for fresh wallet readiness, API latency, UI ops tests, hardening tests,
  or PostgreSQL checksum posture.
