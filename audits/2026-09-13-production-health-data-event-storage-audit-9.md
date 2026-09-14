# 2026-09-13 Production Health, Data, Event, and Storage Audit 9

Read-only audit window: 2026-09-13 15:40-16:17 UTC.

Scope approved by the user: inspect production health across the UI VPS, node/API
VPS, logs, event/index data, mempool status, database health, math gates, and
storage usage; create this audit log. No production cleanup, repair, restart,
deployment, commit, or deletion was approved or performed.

## Prior-audit continuity

Reviewed prior health and repair logs before recording findings, including:

- `audits/2026-08-23-read-only-health-data-event-ui-audit.md`
- `audits/2026-08-28-production-health-data-event-audit.md`
- `audits/2026-08-30-production-health-data-event-storage-audit.md`
- `audits/2026-08-31-production-health-data-event-storage-audit-2.md`
- `audits/2026-09-01-production-health-data-event-storage-audit-3.md`
- `audits/2026-09-02-production-health-data-event-storage-audit-4.md`
- `audits/2026-09-05-production-health-data-event-storage-audit-5.md`
- `audits/2026-09-08-production-health-data-event-storage-audit-6.md`
- `audits/2026-09-11-production-health-data-event-storage-audit-7.md`
- `audits/2026-09-12-production-health-data-event-storage-audit-8.md`
- `audits/2026-09-13-incb-production-canonical-repair.md`

Known carry-forward items are explicitly labelled below instead of duplicated as
new issues.

## Executive verdict

Production was serving from the canonical proof index at the end of the audit.
The final public health sample was green at block `966844`:

- `/api/v1/health`: `ok=true`, `ready=true`, `available=true`, `lagBlocks=0`.
- Bitcoin Core: `tipHeight=966844`, `txindexHeight=966844`,
  `txindexSynced=true`, `pruned=false`, `initialBlockDownload=false`.
- Electrum: `headerHeight=966844`, `atTip=true`.
- Canonical index: `indexedThroughBlock=966844`,
  `indexedThroughBlockHash=000000000000000000020cf91fe0d64930dfe0d1fa2a87b7528d1ec65093b154`.
- Summary snapshot: `snapshotId=a1ca5e1cacd4a4b9bb1614e9`,
  `payloadBytes=18404413`, all summary coverage keys at `966844`.
- Worker: `ok=true`, `consecutiveFailures=0`, `phase=idle`,
  `proofReady=true`.
- Public ledger consistency: `ok=true`, `status=green`,
  `missingLogEvents=[]`, `snapshotId=a1ca5e1cacd4a4b9bb1614e9`.

The math-critical gates sampled directly passed for bond exact arithmetic, WORK
Q16 precision, INCB range replay witness, INCB oracle snapshot restore, API
truth, live data, mail regressions, UI surfaces, hardening, and node-ops.

However, the system is not in a perfect audit state. Current read-only parity
gates still report active non-green contracts:

- A WORK V5 pre-unit relic preservation regression remains active.
- The ledger audit contract still expects the old raw AMO V5 bootstrap credit
  carry shape even though production now exposes raw/effective/overlap fields.
- One confirmed transaction row lacks persisted raw/canonicalBlockScan evidence.
- Event relation parity is missing one `ticker=INCB` reference row.
- Rendered mail projection parity has one `message`-field mismatch.
- Activity coverage parity is off by one pending activity item.
- PostgreSQL WAL receiving/retention policy remains unresolved from prior
  audits.
- Several storage retention candidates remain, but deletion requires a separate
  manifest and approval.

## UI VPS health

Host: `ubuntu-4gb-hel1-1` (`77.42.91.106`).

- Root filesystem: `38G` total, `21G` used, `15G` available, `59%` used.
- Inodes: `4%` used.
- Memory: `3.7Gi` total, `626Mi` used, `3.1Gi` available, no swap.
- Load: `0.10 0.08 0.02`; uptime about `128 days`.
- `systemctl --failed`: zero failed units.
- `caddy`: active.
- UI storage health timer: active; last sample `used_percent=59`,
  `inode_used_percent=4`, `available_bytes=15778471936`.
- UI release provenance timer: active; last successful release
  `57bb25106fef-20260913T073622Z`, commit
  `57bb25106fef1d6367fb214711955bba532e88ba`.
- UI warning/error journal in the last two hours: no entries.

Known carry-forward:

- `proofofwork-ui-release-prune.service` is still intentionally failing in
  dry-run/would-prune mode. It reports `verified_archives=8`,
  `unverified_archives=0`, and would prune `3` verified archives, but archive
  deletion remains disabled pending exact rollback-root classification.
- `proofofwork-ui-storage-prune.service` retained the unmarked candidate
  `/var/tmp/proofofwork-ui-q16-v7-preactivation-a007263-final` and performed no
  deletion.

Major UI storage users observed:

- `/var/backups`: `18G`
- `/var/backups/proofofwork-ui`: `17G`
- `/var/backups/proofofwork-ui/rollbacks`: `6.0G`
- `/var/backups/proofofwork-ui/classified-rollback-roots`: `3.6G`
- `/var/backups/proofofwork-ui/rollback-classifications`: `2.6G`
- `/var/backups/proofofwork-ui/releases`: `2.5G`
- `/var/tmp`: `1.3G`
- `/var/tmp/proofofwork-deploy`: `912M`
- `/var/www`: `393M`
- `/var/log`: `574M`; journal about `327M`, Caddy logs about `17M`

The prior UI disk-full incident is not recurring in the current sample, but the
backup/rollback tree still needs an approved retention manifest before any
pruning is safe.

## Node/API VPS health

Host: `pow-bitcoin-01` (`65.108.122.87`).

- Root filesystem: `98G` total, `24G` used, `70G` available, `26%` used.
- Data filesystem: `1.7T` total, `1.1T` used, `443G` available, `72%` used.
- Inodes: root `6%`, data `1%`.
- Memory: `124Gi` total, `15Gi` used, `109Gi` available.
- Swap: `15Gi` total, `349Mi` used.
- Load: `3.22 3.57 3.05`; uptime about `127 days`.
- `systemctl --failed`: zero failed units.
- Active services: `bitcoind`, `electrs`, `postgresql@16-main`,
  `pg_receivewal@16-main`, `proofofwork-api`, and
  `proofofwork-indexer-worker`.
- Active timers: cache prune, PostgreSQL query health, node storage health,
  node release prune, PostgreSQL logical backup, node release health, and worker
  recovery watch.
- Node/API warning/error journal in the last two hours: no entries visible to
  `powadmin`; note that `powadmin` is not in all journal groups.

Known carry-forward:

- `proofofwork-node-release-health.service` last exited with status `2`, the
  previously logged H5-03 release-health class.
- `proofofwork-api-cache-prune.service` still fails its optional legacy
  `.pow-api-cache` path after the real `/data/proofofwork-api-cache` prune
  succeeds. This is the already-logged 2026-08-30 optional-path issue.
- Node release prune remains dry-run only.

Major node storage users observed:

- `/data/bitcoin`: `908G`, live full-node data; not a cleanup candidate.
- `/data/electrs`: `60G`, live Electrum index; not a cleanup candidate.
- `/data/proofofwork-postgres-tablespaces`: `24G`, live PostgreSQL tablespace;
  not a cleanup candidate.
- `/data/proofofwork-postgres-backups`: `78G`.
- `/data/proofofwork-release-backups`: `9.3G`.
- `/data/proofofwork-audit5-restore-20260905T174233Z`: `21G`.
- `/data/proofofwork-audit5-safeguard-20260905T181729Z`: `11G`.
- `/data/proofofwork-recovery`: `3.6G`.
- `/data/proofofwork-audit5-restore-20260905T144615Z`: `2.2G`.
- `/opt`: `7.3G`, including multiple `proofofwork-api-stage-*` directories.

The node is not near full in the current sample, but there is meaningful
retention weight in backup, restore, release, and stage directories. No file in
that set was deleted or marked safe to delete by this audit.

## Database health

Database: `proof_indexer`.

- Database size: `24 GB`.
- Largest relation:
  `proof_indexer.work_amo_block_transitions` at `24 GB`; this is live
  canonical proof-state weight, not arbitrary waste.
- Other large relations: `ledger_snapshots` `139 MB`, `events` `115 MB`,
  `transactions` `93 MB`, `tx_outputs` `55 MB`,
  `event_participants` `51 MB`, `event_refs` `36 MB`,
  `op_returns` `26 MB`, `tx_inputs` `25 MB`.
- Invalid indexes: `0`.
- Not-ready indexes: `0`.
- Lock waiters: `0`.
- Database deadlocks: `0`.
- Current pending valid event rows: `2` `id-register` and `3`
  `token-listing-sealed`.
- Current pending invalid event rows: `37` `token-event-invalid`.

Credit balance integrity:

- Negative balances: `0`.
- Fractional storage rows: `0`.
- Nonzero pending deltas: `0`.
- Balance rows: `404`.
- Balance addresses: `363`.
- INCB confirmed supply: `224847713398447926`; pending delta `0`; holders `7`.
- POWB confirmed supply: `630496569`; pending delta `0`; holders `11`.
- WORK confirmed supply:
  `210000000000000000000000`; pending delta `0`; holders `356`.

WORK transition-chain integrity:

- Rows: `7222`.
- Range: block `959621` through `966842` when sampled.
- Height gaps: `0`.
- Hash gaps: `0`.
- Value gaps: `0`.
- Invalid flags: `0`.

PostgreSQL WAL carry-forward:

- `pg_wal`: `81 MB`.
- `/var/backups/postgresql/16-main/wal`: `19G`.
- `pg_receivewal@16-main.service`: active/running.
- `pg_replication_slots`: `pg_receivewal_service`, physical,
  `active=false`, `wal_status=lost`.
- `pg_stat_replication`: zero clients.

This is the same H8 WAL receive/archive classification issue. It needs an
approved PostgreSQL backup/WAL retention decision before cleanup.

## Event, log, and mempool health

Public log and summary reads were green at the final snapshot, and public
tx-status correctly distinguished confirmed, pending, and invalid samples.

Confirmed/pending samples:

- Two pending valid ID registrations from 2026-09-11 were still reported as
  `pending` with `mempoolSeen=true` via the public tx-status endpoint:
  `951831f315bde9d28b592f1669071f1db2a96002c9cb15ac0b0416565f84630d`
  and
  `c02ac0c897b2de0341873a7de727f01c7597a8fa8267ce479f8390f515f0d20d`.
- Latest sampled invalid token event
  `b6823b0bbbba707f75c1ee53f600252b3a59ad0eccce6adde013d82c5facfdc5`
  was rendered as `pending`, `mempoolSeen=true`, with Core sources.
- The single transaction missing persisted raw/canonicalBlockScan evidence,
  `9b72b0e5532ee213c040fd8b8e2f67a1a355095cca0ccfa09af263c9de9e69cc`,
  still rendered public tx-status correctly as `confirmed`, `canonical=true`,
  at block `966085`, with Core sources
  `bitcoin-core:getrawtransaction`, `getblockheader`, `getblock`, and
  `getblockhash`.

Important qualification: `bitcoin-cli` direct access as `powadmin` could not use
the RPC cookie/credentials, so raw Core CLI checks were not forced through that
account. The public API status checks still proved Core-backed status reads.

## Math and exactness gates

Passed local/public gates:

- `npm run check:bond-exact-arithmetic`
- `npm run check:work-precision-v2`
- `npm run check:incb-range-replay-witness`
- `npm run check:incb-oracle-snapshot-restore`
- `POW_API_BASE=https://computer.proofofwork.me npm run check:live-data`
- `POW_API_BASE=https://computer.proofofwork.me npm run check:api-truth`
- `POW_API_BASE=https://computer.proofofwork.me npm run check:mail-regressions`
- `npm run check:ui`
- `POW_API_BASE=https://computer.proofofwork.me npm run check:marketplace-regressions`
  partially passed V2 cutover checks before failing the known WORK relic check.
- `POW_API_BASE=https://computer.proofofwork.me POW_SURFACE_AUDIT_JSON=1
  POW_SURFACE_AUDIT_TIMEOUT_MS=60000 npm run audit:surfaces -- --json
  --timeout-ms=60000`
- `npm run check:hardening`
- `npm run check:node-ops`

Exact values sampled from consistency/summary paths:

- INCB confirmed supply: `224847713398447926`.
- INCB network value Q8: `22484771339844794793582060`.
- INCB direct proof issuance units: `27386`.
- INCB attached WORK issuance units: `224847713398420540`.
- INCB issuance dust Q8: `2193582060`.
- INCB accepted mints: `46`.
- INCB parent bonds: `47`.
- POWB confirmed supply and bond flow: `630496569`.
- WORK confirmed supply:
  `210000000000000000000000` subatoms.
- WORK amount storage model: `work-subatoms-v2`.
- WORK precision model: `canonical-work-subatoms-v2`.
- WORK exact network value at the sampled consistency pass:
  `8387576239640462938.59182956` sats.

No sampled arithmetic gate showed floating-point drift or broken supply math.

## Active findings

### H9-01: WORK V5 pre-unit relic preservation gate remains non-green

Status: known carry-forward from audit 8, still active.

`check:marketplace-regressions` still fails on the canonical pre-unit relic
listing:

`4e9cedced2252cd183608dc9176415a913c4f6aa5e8307a732179a2240b6feb1`

The compact `indexer:parity` rerun also reports WORK V5 warning checks with
`migration-not-complete`, while the detailed object includes the relic evidence
as `complete=true`, `valid=true`, `unspent=true`, `disposition=relic`. This
matches the prior idempotency/relic class rather than a new marketplace math
finding.

Required next step: approve a specific repair/contract alignment plan for the
pre-unit relic regression gate. Do not mutate listing rows without fresh backup,
writer exclusion, and exact pre/post parity evidence.

### H9-02: Ledger audit contract disagrees with current AMO V5 bootstrap split

Status: known carry-forward/stale-gate class, still active.

`npm run audit:ledger` against production fails only:

`AMO V5 legacy bootstrap carry is exact and valid-only`

Production consistency now exposes the AMO V5 legacy bootstrap split as
raw/effective/overlap:

- `creditFixedSats=2762`
- `effectiveCreditFixedSats=1008`
- `creditFixedOverlapSats=1754`
- `legacyBootstrapCreditFixedSats=1008`

The local audit assertion still expects the old raw sum `546 + 2216 = 2762`.
Public ledger consistency remains green. This should be treated as an audit
contract/update issue unless a repair review proves production should publish
the older field semantics.

### H9-03: One confirmed transaction row lacks persisted raw/canonicalBlockScan evidence

Status: current finding; not found by exact txid in prior human audit notes.

Affected txid:

`9b72b0e5532ee213c040fd8b8e2f67a1a355095cca0ccfa09af263c9de9e69cc`

Facts:

- Transaction status: `confirmed`.
- Block height/index: `966085` / `1518`.
- Block hash/time metadata are present.
- Canonical block join exists.
- `raw_tx` is null, so `raw_tx.canonicalBlockScan` is absent.
- Dependent protocol/event rows: `0`.
- Indexed inputs: `5`; indexed outputs: `1`; OP_RETURN rows: `0`.
- Public tx-status still renders correctly as confirmed/canonical with Core
  sources.

Impact: not a missing public event render, but it fails forensics/completeness
contracts:

- `audit:computer-events`: `all-confirmed-transactions-have-raw-transaction`
  missing `1`.
- `indexer:parity`: `confirmed-transactions-have-canonical-block-proof`
  missing `1`.

Required next step: approve a bounded backfill or repair that persists the raw
transaction/canonical block scan evidence for this exact txid, then rerun
`audit:computer-events` and `indexer:parity`.

### H9-04: Event reference semantic parity missing one INCB ticker reference

Status: current finding in the known event-relation parity repair class.

`indexer:parity` failed `rendered-event-reference-semantic-parity`:

- Missing count: `1`.
- Missing tuple: `eventId=4033147`, `refType=ticker`, `refValue=INCB`.
- Event txid:
  `b00b9451bded7d2b7d339556ad2dc5d375e5b52ad877a1d3e2b29149dfc72ccf`.
- Event kind/status/valid: `token-event-invalid`, `confirmed`, `false`.
- Event payload top-level ticker: `INCB`.
- Stored refs for the event currently include the INCB token-id but not the
  ticker row.

Impact: relation parity is not perfect. This does not change sampled public
ledger totals, but address/ticker reference search can be incomplete for this
invalid INCB event.

Required next step: use the supervised event-relation repair process in
`OP_RETURN_INFRASTRUCTURE.md`; do not manually insert the single row without the
full relation parity preflight and writer exclusion.

### H9-05: Rendered mail projection parity has one message-field mismatch

Status: current finding in the known canonical mail projection repair class.

`indexer:parity` failed `rendered-mail-projection-semantic-parity`:

- Mismatched count: `1`.
- Mismatched field: `message`.
- Txid:
  `3325ebc39165bb4c38f078dc936c4c98a420d2e7f7875738e49d123c0e233801`.
- Related events in the tx:
  - `4032520`, `inception-bond`, confirmed valid.
  - `4036074`, `token-mint`, confirmed valid.
- The `mail_items` scalar row is the Inception Bond row:
  sender `bc1q9cxyzlx8e8dyq5ueyckss8fndtdp4ydmvqz874`, subject
  `Inception Bond`, body `incb`, amount `1000`, data bytes `37`.
- `mail_items.message` still has a legacy transaction-style JSON object
  (`amountSats`, `blockHash`, `indexedFrom`, `payload`, raw decode fields, etc.)
  while the canonical event-derived row has no nested `message` object.

Impact: the rendered mailbox row count is correct and the sampled public mail
regression suite passes, but canonical projection parity is not perfect for this
message JSON field.

Required next step: use the supervised canonical mail projection repair process
in `OP_RETURN_INFRASTRUCTURE.md`, then rerun mail parity and public mail
regressions.

### H9-06: Pending activity coverage parity is off by one

Status: current finding.

The compact `indexer:parity` rerun failed `events-cover-canonical-activity` at
block `966844`:

- `canonicalActivityItems=25522`.
- `confirmedEvents=25516`.
- `expectedPendingActivityItems=6`.
- `pendingEvents=5`.
- `pendingAllEvents=5`.
- `pendingCoverageMode=summary-floor`.

Direct DB count of current pending valid event rows also found `5`: two
`id-register` rows and three `token-listing-sealed` rows. Public ledger
consistency still reported green with `missingLogEvents=[]`.

Impact: likely a pending/snapshot-floor parity disagreement rather than a
confirmed ledger math failure, but it is a real non-green parity gate and should
be resolved before claiming all event coverage is perfect.

Required next step: identify the expected sixth pending activity item and decide
whether the event row, summary-floor expectation, or parity contract is stale.

### H9-07: Default surface and ID/ops audit timeouts are too tight for some live reads

Status: current operational/audit finding.

The 60s surface audit passed, but the default 20s surface audit previously
timed out on heavy fresh reads. Observed slow public reads included marketplace
summary around `22.7s`, WORK token around `19.3s`, home registry around `13.5s`,
and WORK summary around `13.0s`.

`npm run check:ui-ops` failed twice locally due a Python fixture timeout:

`AssertionError [ERR_ASSERTION]: spawnSync /usr/bin/python3 ETIMEDOUT`

The production `audit:ids` loopback check was stopped manually after several
minutes without final output and is recorded as incomplete, not failed.

Impact: production surfaces passed with a realistic timeout, but some local audit
fixtures and default audit timeouts do not give stable health signals.

Required next step: separately tune or split slow audit fixtures, and add a
concise progress/summary mode for the production ID audit.

### H9-08: Storage retention candidates still need approval, manifests, and evidence

Status: known carry-forward plus current storage sizing.

Potential storage cleanup must not touch live node, Electrum, PostgreSQL
tablespaces, canonical releases, WAL, recovery evidence, ledgers, or rollback
roots without explicit manifest review.

High-value candidates for a future retention manifest:

- Node audit restore/safeguard directories:
  `/data/proofofwork-audit5-restore-*` and
  `/data/proofofwork-audit5-safeguard-*`.
- Node backup trees under `/data/proofofwork-postgres-backups`, including
  recovery evidence, logical dumps, physical dumps, and H7 recovery dumps.
- Node release backups under `/data/proofofwork-release-backups`.
- Node `/opt/proofofwork-api-stage-*` directories and
  `/opt/proofofwork-quarantine`.
- UI rollback/classification/release archives under
  `/var/backups/proofofwork-ui`.
- UI deployment archives under `/var/tmp/proofofwork-deploy`.
- UI unmarked candidate
  `/var/tmp/proofofwork-ui-q16-v7-preactivation-a007263-final`.

No deletion was performed. The next safe step is a storage-retention manifest
that classifies each path as live, canonical rollback/evidence, duplicate,
expired, or delete-after-backup.

## Checks that passed

- Public health final sample green at block `966844`.
- Public ledger consistency green at block `966844`.
- Bitcoin Core and Electrum exact-tip.
- Worker healthy, no containment, no consecutive failures.
- Disk health green on both root/cache checks exposed by the API.
- UI VPS and node VPS both below filesystem pressure thresholds.
- `systemctl --failed` clean on both VPS samples.
- Credit balances nonnegative, integer, and zero pending deltas.
- WORK transition chain gap-free in height, hash, and value.
- Confirmed event/transaction parent position mismatch: `0`.
- Confirmed transactions missing inputs: `0`.
- Confirmed transactions missing outputs: `0` in the later normalized sample for
  protocol-dependent checks; the parity raw/canonical proof gap is isolated to
  the single non-event txid in H9-03.
- Public mempool/tx-status samples render pending and confirmed status with Core
  sources.

## Checks that did not pass or did not complete

- `npm run audit:ledger`: failed stale AMO V5 bootstrap carry assertion.
- `POW_API_BASE=https://computer.proofofwork.me npm run
  check:marketplace-regressions`: failed known pre-unit relic preservation gate.
- `npm run audit:computer-events` on node loopback: failed because one
  confirmed transaction lacks raw transaction evidence.
- `npm run indexer:parity` on node loopback: failed canonical block proof,
  event reference parity, mail projection parity, pending activity coverage, and
  known WORK V5 warnings.
- `npm run check:ui-ops`: local Python fixture timeout.
- `npm run audit:ids` on node loopback: stopped after several minutes with no
  final output; recorded as incomplete.

Transient block-edge note: several public gates initially saw temporary 503s
while a new block arrived and the exact-tip summary was one block behind. Reruns
recovered. This is correct fail-closed behavior, not stale data being served.

## Non-actions

- No production files were deleted.
- No database rows were inserted, updated, or deleted.
- No services were restarted.
- No deployments were made.
- No production configs were changed.
- No commits were created.

## Recommended next approvals

1. Approve a bounded parity repair plan for H9-03, H9-04, H9-05, and H9-06,
   with fresh backup, writer exclusion where required, exact before/after
   parity, and public API regression reruns.
2. Approve a contract update or production-field repair decision for H9-02.
3. Approve a WORK V5 relic regression alignment plan for H9-01.
4. Approve a PostgreSQL WAL/archive retention policy for the
   `pg_receivewal_service` lost/inactive slot and 19G WAL archive.
5. Approve a storage-retention manifest before deleting any UI/node backup,
   restore, release, stage, WAL, or recovery path.

## 2026-09-13 ordered Computer surface addendum

Read-only audit window: 2026-09-13 20:07-20:45 UTC.

Scope: the user requested an ordered read-only audit of
`proofofwork.me`, `id.proofofwork.me`, `desktop.proofofwork.me`,
`browser.proofofwork.me`, `amo.proofofwork.me`, `credit.proofofwork.me`,
`wallet.proofofwork.me`, `work.proofofwork.me`,
`infinity.proofofwork.me`, `inception.proofofwork.me`,
`log.proofofwork.me`, `growth.proofofwork.me`, and finally
`computer.proofofwork.me`; verify data with the full node; review previous
audit logs; identify speed, data handling, bug, stale-data, backup, and storage
recommendations; and append the audit log. No code repair, production deploy,
commit, push, storage deletion, WAL cleanup, or unrelated data mutation was
approved or performed during this addendum.

Prior continuity reviewed: the active H9 findings in this log, previous
storage/data audits, the 2026-09-13 INCB canonical repair log, and the
September UI/UX audit were searched for H9/H8/H7 findings, release/cache prune
issues, AMO/wallet availability notes, `summary-floor` parity notes, and
storage-retention candidates. Existing items are carried forward below rather
than duplicated.

### Final production health

Final public health sample after the audit load:

- Time: 2026-09-13 20:45 UTC.
- `/health?network=livenet`: HTTP `200` in `2.28s`, `ok=true`,
  `ready=true`, `available=true`.
- Full node as reported by health: main chain, `tipHeight=966870`,
  `headers=966870`, `txindexHeight=966870`, `txindexSynced=true`,
  `initialBlockDownload=false`, `pruned=false`, `verificationProgress=1`.
- Best block hash:
  `00000000000000000000afcaaed5a7fccb61c02d41eeacc46f425188ee1a4df5`.
- Electrum: `headerHeight=966870`, `atTip=true`, same header hash.
- Index: `indexedThroughBlock=966870`, `lagBlocks=0`.
- Summary snapshot: `snapshotId=491b6436f8a8bcb2fb315e18`,
  `payloadBytes=18833452`, all summary coverage keys at `966870`.
- Worker: `ok=true`, `consecutiveFailures=0`, `phase=idle`,
  `proofReady=true`, `pendingEvents.globalUnresolved=0`,
  `pendingEvents.q16PendingUnresolved=0`, `staleCandidates=0`.
- API disk guards: cache path `/data/proofofwork-api-cache` ok at about
  `73.87%` used with `461GB` available; root ok at about `29.31%` used with
  `74GB` available.

Direct Bitcoin Core RPC via the configured `bitcoin` service user also passed
earlier in the window:

- `getblockchaininfo`: main chain, blocks/headers `966868`,
  `initialblockdownload=false`, `verificationprogress=1`, `pruned=false`,
  no warnings.
- `getmempoolinfo`: `loaded=true`, `size=38006`, `bytes=11753697`,
  `usage=78309200`, `fullrbf=true`, `optimal=true`.

### Ordered surface audit

Saved run:

`POW_API_BASE=https://computer.proofofwork.me npm run -s audit:surfaces -- --json --timeout-ms=180000`

Result: `ok=true`, started `2026-09-13T20:39:43.343Z`, finished
`2026-09-13T20:42:10.500Z`. Every requested host returned HTML `200`, a React
root, and `4` same-origin shell assets: `1` module, `2` modulepreloads, and
`1` stylesheet.

Ordered probe timings:

1. `proofofwork.me`: HTML `1136ms`; registry summary `9706ms`.
2. `id.proofofwork.me`: HTML `474ms`; IDs summary `17720ms`.
3. `desktop.proofofwork.me`: HTML `506ms`; log summary `5174ms`.
4. `browser.proofofwork.me`: HTML `588ms`; activity summary `7282ms`.
5. `amo.proofofwork.me`: HTML `710ms`; marketplace summary `16962ms`.
6. `credit.proofofwork.me`: HTML `715ms`; token summary `8189ms`.
7. `wallet.proofofwork.me`: HTML `433ms`; WORK token `11855ms`.
8. `work.proofofwork.me`: HTML `449ms`; work summary `8975ms`; work floor
   `7382ms`.
9. `infinity.proofofwork.me`: HTML `520ms`; infinity summary `6757ms`.
10. `inception.proofofwork.me`: HTML `645ms`; inception summary `4580ms`.
11. `log.proofofwork.me`: HTML `425ms`; log summary `6244ms`.
12. `growth.proofofwork.me`: HTML `715ms`; growth summary `7019ms`.
13. `computer.proofofwork.me`: HTML `201ms`; health `1623ms`; consistency
    `9524ms`.

Headless render evidence:

- Desktop and mobile screenshots were captured for all 13 surfaces under
  `/tmp/pow-computer-audit-20260913-surfaces-render2`.
- All 26 render probes had `navStatus=200`, no console errors after known
  YouTube/browser-feature noise filtering, no HTTP asset/API errors, and no
  request failures.
- First-screen visual review found all pages nonblank and recognizably mounted.
- AMO did not finish its visible canonical summary state after an `8.5s` or
  `26s` wait, but a focused `70s` AMO trace did eventually reach `Ready
  Canonical AMO summary`. Its browser API calls returned `200`, with
  `marketplace-summary?compact=1&fresh=1` taking roughly `9.7s-11.3s` and a
  non-fresh compact summary call taking roughly `10.0s` before a later cached
  call returned in `805ms`.
- WORK mobile was still loading after `8.5s` but reached populated WORK data by
  the focused `26s` pass.
- Wallet with no connected address still showed `Spendable proofs Loading` after
  `26s`; this is a UI state-handling issue, not incorrect chain data.
- Layout detector noise mostly came from `sr-only` text and intentionally
  scrollable mobile nav, but there are real polish candidates: long proof values
  overflow `code`/metric containers on WORK and Growth desktop, and mobile
  section navs overflow on Credit, Wallet, Infinity, and Growth.

### Event, relation, mail, credit, and math health

Production computer-event audit from the deployed host passed after the current
snapshot warmed:

`POW_API_BASE=https://computer.proofofwork.me npm run -s audit:computer-events`

Result: `ok=true`, `failures=[]`, `warnings=[]`, ledger snapshot
`998be604733ac0e91ace7313` at block `966869`, `status=green`,
`tipLagBlocks=0`, `missingLogEvents=0`,
`networkValueSats=8387576239642319000`.

Database/event facts from the same audit:

- Transactions: total `25482`, confirmed `25230`, pending `37`, dropped `215`.
- Events: total `25938`, confirmed valid `25567`, confirmed canonical activity
  `25567`.
- Confirmed transaction/event integrity failures: missing raw `0`, missing
  block `0`, confirmed events missing transaction `0`, confirmed events without
  confirmed transaction `0`, confirmed events missing raw transaction `0`.
- Relations: `event_refs=55323`, `event_participants=127254`.
- Projections: confirmed credit definitions `238`, credit balances `404`,
  credit listings `1008`, ID records `505`, confirmed mail items `615`,
  OP_RETURN rows `25351`.

Direct database aggregate checks:

- Event status split: confirmed valid `25567`, confirmed invalid `334`,
  pending valid `2`, pending invalid `35`.
- Transaction status split: confirmed `25230`, pending `37`, dropped `215`.
- Confirmed valid events missing block tuple: `0`.
- Orphan event refs: `0`.
- Orphan event participants: `0`.
- Confirmed valid events without participants: `0`.
- Negative confirmed credit balances: `0`.
- Negative pending credit deltas: `0`.
- Core token balance sums:
  - `WORK`: token id
    `d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8`,
    confirmed, holders `356`, confirmed balance sum
    `210000000000000000000000`, pending delta `0`, matching max supply.
  - `POWB`: token id
    `a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562`,
    confirmed, holders `11`, confirmed balance sum `630496569`, pending
    delta `0`.
  - `INCB`: token id
    `3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d`,
    confirmed, holders `7`, confirmed balance sum `224847713398447926`,
    pending delta `0`.

Current listing status aggregate:

- `WORK`: active `67`, sealing `699`, delisted `120`, dropped `119`.
- `POWB`: sealing `1`.
- `DRAIN`: active `1`.
- `POW`: delisted `1`.

Strict parity:

`POW_API_BASE=http://127.0.0.1:8081 POW_INDEX_PARITY_ACTIVITY_SNAPSHOT=1 POW_INDEX_PARITY_SNAPSHOT_FRESH=1 POW_INDEX_PARITY_TOKEN_FRESH=1 npm run -s indexer:parity`

Result: `ok=true` at block `966869`, snapshot
`998be604733ac0e91ace7313`. The only non-ok checks were warning-severity carry
forwards:

- `work-amo-v5-migration`: reason `migration-not-complete`, migration status
  itself `complete`.
- `work-amo-v5-usd-quote-head`: reason `migration-not-complete`.

Default parity without the activity snapshot still fails H9-06 in
`summary-floor` mode at block `966869`:

- `confirmedEvents=25567`, `expectedConfirmedActivityItems=25567`.
- `expectedPendingActivityItems=3`, `pendingEvents=2`,
  `pendingAllEvents=2`.

This confirms H9-03, H9-04, and H9-05 were repaired by the approved production
repair before this addendum. H9-06 is now narrowed to the default parity
contract/fallback formula, not live confirmed event loss.

### VPS, database, and log health

UI VPS `ubuntu-4gb-hel1-1`:

- Root filesystem: `38G` total, `21G` used, `15G` available, `59%` used.
- Inodes: `4%` used.
- Memory: `3.7Gi` total, `676Mi` used, `3.1Gi` available, no swap.
- Load: `0.00 0.02 0.00`.
- `systemctl --failed`: zero failed units.
- Active units/timers sampled: `caddy`, storage-health, release-provenance,
  release-prune, storage-prune.
- Storage health last result: success, `used_percent=59`,
  `inode_used_percent=4`, `available_bytes=15773802496`.
- Release provenance last result: success for release
  `57bb25106fef-20260913T073622Z`, commit
  `57bb25106fef1d6367fb214711955bba532e88ba`.
- UI warning logs in the last 24h only contained the known release-prune
  dry-run/would-prune failure.

Node/API VPS `pow-bitcoin-01`:

- Root filesystem: `98G` total, `24G` used, `70G` available, `26%` used.
- Data filesystem: `1.7T` total, `1.2T` used, `430G` available, `73%` used.
- Inodes: root `6%`, data `1%`.
- Memory: `124Gi` total, `20Gi` used, `104Gi` available.
- Swap: `15Gi` total, `349Mi` used.
- Load: `6.69 4.52 3.03`.
- `systemctl --failed`: zero failed units.
- Active units sampled: `bitcoind`, `electrs`, `postgresql@16-main`,
  `pg_receivewal@16-main`, `proofofwork-api`,
  `proofofwork-indexer-worker`, worker recovery watch timer.
- Node warning/error journal in the last 3h via sudo: no entries for bitcoind,
  electrs, PostgreSQL, pg_receivewal, API, indexer worker, or recovery watch.

Database metadata:

- `proof_indexer` size: `24 GB`.
- Largest relations by total size:
  - `work_amo_block_transitions`: `24 GB`, live `7218`, dead `0`.
  - `ledger_snapshots`: `277 MB`, live `18921`, dead `122`.
  - `events`: `122 MB`, live `25938`, dead `549`.
  - `transactions`: `94 MB`, live `25482`, dead `2393`.
  - `event_participants`: `68 MB`, live `127254`, dead `884`.
  - `tx_outputs`: `55 MB`, live `75909`, dead `8291`.
  - `event_refs`: `42 MB`, live `55323`, dead `470`.
  - `op_returns`: `26 MB`, live `25351`, dead `2254`.
  - `tx_inputs`: `25 MB`, live `30267`, dead `2829`.
  - `credit_listings`: `16 MB`, live `1008`, dead `122`.
- Autovacuum/autoanalyze timestamps were recent on core event/read tables.
- No lock wait or failed service symptom was observed during the audit.

### Storage and retention candidates

No deletion was performed.

Current high-weight storage:

- UI: `/var/backups/proofofwork-ui` `17G`,
  `/var/tmp/proofofwork-deploy` `912M`, `/var/www` `393M`, `/var/log` `579M`.
- Node: `/data/bitcoin` `908G` and `/data/electrs` `60G` are live full-node
  data and not cleanup candidates.
- Node: `/data/proofofwork-postgres-tablespaces` `24G` is live database data
  and not a cleanup candidate.
- Node: `/data/proofofwork-postgres-backups` `91G`, including the fresh logical
  backup created for the approved repair.
- Node: `/data/proofofwork-release-backups` `9.3G`.
- Node audit/recovery evidence:
  `/data/proofofwork-audit5-restore-20260905T174233Z` `21G`,
  `/data/proofofwork-audit5-safeguard-20260905T181729Z` `11G`,
  `/data/proofofwork-audit5-restore-20260905T144615Z` `2.2G`, and
  `/data/proofofwork-recovery` `3.6G`.

Updated storage/ops finding:

- `proofofwork-node-release-health` currently exits with:
  `CRITICAL live node checkout contains untracked non-ignored path: backups/`.
- The path is `/opt/proofofwork-api/backups`, size `17M`, with recovery-code
  directories:
  `production-recovery-20260913T090324Z-incb-canonical-repair` and
  `production-recovery-20260913T151329Z-incb-repair-code`.
- This is not meaningful disk pressure, but it breaks the release-health guard.
  It should be moved into an approved recovery/evidence path or classified in
  the release-health allowlist during a separate approved cleanup/config pass.

Carry-forward storage/ops findings:

- UI release-prune remains dry-run only and would prune three verified release
  archives, while deletion remains disabled pending exact rollback-root
  classification.
- UI storage-prune still preserves unmarked candidate
  `/var/tmp/proofofwork-ui-q16-v7-preactivation-a007263-final`.
- Node `proofofwork-cache-prune.service` still reports hourly failures on the
  missing legacy optional path `/opt/proofofwork-api/.pow-api-cache` after the
  real `/data/proofofwork-api-cache` prune succeeds.
- PostgreSQL WAL/archive retention remains a prior unresolved decision class;
  no WAL cleanup was approved or attempted in this addendum.

### Current non-green gates

- H9-01 remains current:
  `check:marketplace-regressions` passes the WORK Marketplace V2 cutover
  contract, then fails the known WORK AMO V5 pre-unit relic preservation txid
  `4e9cedced2252cd183608dc9176415a913c4f6aa5e8307a732179a2240b6feb1`.
- H9-02 remains current:
  `audit:ledger` fails only `AMO V5 legacy bootstrap carry is exact and
  valid-only`.
- H9-06 remains current only for the default `summary-floor` parity fallback.
  Strict activity-snapshot parity passes.
- New H9-09 class from this addendum: live node checkout release-health guard is
  red because `/opt/proofofwork-api/backups/` is untracked/non-ignored.

### Recommendations needing separate approval

1. Repair H9-06 in `scripts/check-proof-indexer-parity.mjs` so the default
   summary-floor fallback compares public activity to the right pending/public
   metric, then keep strict activity-snapshot parity as the high-confidence
   math gate.
2. Decide H9-01 explicitly: either repair production relic projection or update
   the marketplace regression contract if the chain-canonical pre-unit relic
   semantics changed deliberately.
3. Decide H9-02 explicitly: update the ledger audit for the current
   raw/effective/overlap AMO V5 bootstrap fields, or repair production if the
   new field shape is wrong.
4. Speed/data handling: make AMO, ID, Wallet, WORK, and marketplace summaries
   render from small, already-current snapshot headers first, then stream or
   page expensive detail payloads. The current data is safe but some fresh reads
   take `10s-18s`, and AMO can remain visibly loading for longer than `26s`.
5. UI state hardening: Wallet should not show an indefinite spendable-proof
   loading value when no wallet address is connected; WORK/Growth should wrap or
   format giant proof numbers inside metric/code containers; mobile section navs
   need predictable horizontal scrolling or compact overflow controls.
6. Audit-tool hardening: keep a long-budget surface audit for production, but
   split per-surface probes or add per-probe progress JSON so one heavy route
   cannot make later surfaces look untested.
7. Storage/ops: classify `/opt/proofofwork-api/backups/` and either move it to
   `/data/proofofwork-recovery` or add an explicit allowlist rule; fix the
   cache-prune unit's missing legacy path; then rerun release/cache health.
8. Prepare a new storage-retention manifest before deleting any backup,
   release, rollback, restore, WAL, or recovery material. Start with non-live
   scratch and already-verified duplicate release/archive paths, not chain data,
   index data, ledgers, or audit evidence.

### Non-actions in this addendum

- No production files were changed.
- No production services were stopped or restarted.
- No database rows were inserted, updated, or deleted.
- No storage, backups, WAL, release archives, or recovery evidence were deleted.
- No deployment, commit, or push was performed.

## Approved H9 Repair Addendum

Scope approved by operator:

- Repair H9-01, H9-02, H9-06, and H9-09 only.
- Inspect local, git/origin, and production deployed state.
- Make minimum necessary code, test, audit-log, repository-hygiene, production
  config, and deployment changes.
- Preserve production backups/recovery evidence; no chain data, database data,
  WAL archives, release archives, recovery evidence, or unrelated storage may
  be deleted.

Pre-deploy repair results:

- H9-01 is reclassified to the current chain/indexer contract. The exact
  pre-unit AMO V5 listing attempt
  `4e9cedced2252cd183608dc9176415a913c4f6aa5e8307a732179a2240b6feb1`
  is preserved as confirmed invalid audit history at height `959241`, block
  index `2601`, protocol output `1`, ordinal `0`, reason
  `work-market-v2-canonical-oracle-unavailable`, amount atoms `1600`, price
  `1500479`, and `refundEligible:false`. Exact active-listing,
  closed-listing, and market-log reads remain terminal-empty for that txid and
  the V5 declaration txid, so no stale reservation/relic can be manufactured.
- H9-02 is repaired in `scripts/audit-ledger-consistency.mjs`. The ledger audit
  now proves the legacy-bootstrap raw fixed-flow residual (`2762` proofs),
  effective valid-only carry, overlap, and all Q8 identities instead of
  treating the raw value as the outward valid-only field.
- H9-06 is repaired in `scripts/check-proof-indexer-parity.mjs`. The default
  `summary-floor` fallback now compares confirmed canonical activity against
  public activity metrics and subtracts supplemental activity when exact
  activity-snapshot coverage is not enabled. Pending mempool activity stays
  visible without blocking healthy confirmed ledger coverage.
- H9-09 production preservation step completed on the node VPS. The exact
  `/opt/proofofwork-api/backups/` recovery evidence was moved, not deleted, to
  `/data/proofofwork-recovery/h9-09-release-health-20260913T212750Z/backups`.
  The same recovery directory stores the pre-change live head, status, diff,
  backup inventory, backup SHA256 manifest, and cache-prune unit/status.
- H9-09 cache-prune service was corrected and installed. The required primary
  `/data/proofofwork-api-cache` prune remains active; the legacy
  `/opt/proofofwork-api/.pow-api-cache` prune now runs only when that optional
  directory exists. A production run at `2026-09-13T21:28Z` exited both
  ExecStart lines with status `0/SUCCESS`.

Pre-deploy verification:

- `node --check scripts/check-proof-indexer-parity.mjs`: passed.
- `node --check scripts/audit-ledger-consistency.mjs`: passed.
- `node --check scripts/check-marketplace-regressions.mjs`: passed.
- `POW_API_BASE=https://computer.proofofwork.me npm run audit:ledger`: passed,
  snapshot `e2c91ec310e1e986fb2d6026`, value
  `8387576239642319265.81121031` proofs.
- `POW_API_BASE=https://computer.proofofwork.me npm run
  check:marketplace-regressions`: passed after the H9-01 contract update and
  POWB direct-listing regression scope correction. The gate still showed
  several exact fresh reads in the `5s-19s` range; this remains a speed/data
  handling upgrade target, not a correctness blocker.
- `npm run check:live-data`: passed.
- `npm run check:node-ops`: passed.
- `npm run check:api-truth`: passed.

Production sync finding before commit/deploy:

- Local/origin head was `083bfe2bf6d431b3dfe15f7015b35718e0cacd33`.
- Node VPS live checkout head was `4515c3bc3421c64d1497aae5ec8498183727467c`
  with eight modified tracked files. The SHA256 of the production dirty patch
  exactly matched the local committed range
  `4515c3bc3421c64d1497aae5ec8498183727467c..083bfe2bf6d431b3dfe15f7015b35718e0cacd33`
  (`66e382dd66e4a7a06e7012c31344438d3dea5caff1aa4b1eaddd7dde3506b7b9`),
  so those hotfix bytes are already preserved in git.
- After moving `backups/` and fixing cache-prune, release-health advanced to a
  tracked mode failure on `OP_RETURN_INFRASTRUCTURE.md` (`664` on disk vs
  Git-tracked `100644`). The node runbook explicitly normalizes exact release
  checkouts with `chmod --recursive go-w /opt/proofofwork-api`; final deployment
  must leave the live checkout exact, detached, and non-group-writable.

Post-deploy repair results:

- The H9 code/config/docs/audit repair was committed as
  `008a5c776bb5ac767d7d696377837c4170979f89` and pushed to
  `origin/growth-all-products-2026-09-05`.
- The node VPS was deployed from the exact pushed commit with the live checkout
  detached at `008a5c776bb5ac767d7d696377837c4170979f89`, tree
  `f2b27fa497ac8e2d40764b0f51e3c10d99ea25ef`, and runtime SHA256
  `9bb36545a39fec8b393a17024cb94dcfb4b068cf10323a9f676b8ec5cf7eb3a2`.
  The published node release archive was
  `proofofwork-node-release-008a5c7-20260913T213731Z.tgz`, SHA256
  `5f36ef427e16933c5cf2cac41b3af3da19ba6bbc0995d0c196c72849b8f8f57c`.
- Production node services verified active after deploy:
  `proofofwork-api`, `proofofwork-indexer-worker`,
  `proofofwork-api-wg.socket`, and `proofofwork-api-wg.service`.
- Node disk remained healthy after the deploy: `/` at `26%` used and `/data`
  at `73%` used. The production `/health` readiness response later returned
  `ok:true`, `ready:true`, full-node/electrum/header height `966877`,
  indexed-through block `966877`, lag `0`, worker proof ready, and pending
  unresolved counts `0`.
- `scripts/check-proof-indexer-parity.mjs` ran on the deployed node against
  `http://127.0.0.1:8081` and exited `0`. Compact evidence: `ok:true`,
  indexed-through block `966876`, snapshot `4d92b8715a367318d9b502bf`,
  `errorCount:0`, and the expected non-failing warning labels
  `work-amo-v5-migration` and `work-amo-v5-usd-quote-head`. H9-06's default
  summary-floor coverage was green with public activity `25569`, supplemental
  activity `1`, confirmed events `25567`, and expected pending activity `2`.
- Post-deploy `POW_API_BASE=https://computer.proofofwork.me npm run
  audit:ledger` passed, snapshot `7e7d11b193e50cf4f4b46a16`, value
  `8387576239642319265.81121031` proofs.
- Post-deploy `POW_API_BASE=https://computer.proofofwork.me npm run
  check:marketplace-regressions` passed on rerun for ID lookup, V2
  cutover/invalid state, POWB sealed listing, WORK listing lifecycle, wallet
  scopes, and targeted WORK transfers. The first post-deploy attempt hit a
  transient `CANONICAL_INDEX_CATCHING_UP` window and failed only the strict
  `10s` exact-history latency ceiling; the exact read later returned and the
  rerun passed. Several exact/fresh wallet and history reads still took
  `15s-43s`, so speed/data handling remains the highest-value follow-up.
- H9-09 release-health criticals were cleared: `/opt/proofofwork-api/backups/`
  no longer exists inside the live checkout, tracked file modes were normalized,
  and the cache-prune unit exits cleanly. Release-health still reports the
  existing warning `opt_checkouts=24` because `/opt` contains more node release
  checkouts than the bounded inventory allows. No checkout pruning or release
  evidence deletion was approved or performed in this repair.
- UI VPS read-only verification found Caddy active and `/` at `59%` used. The
  live UI release remains
  `57bb25106fef1d6367fb214711955bba532e88ba`; no frontend/build inputs changed
  between that commit and the H9 repair commit, so served UI bytes are not
  expected to differ. A strict UI provenance redeploy was intentionally not
  performed because `/var/backups/proofofwork-ui/rollback-roots` already
  contains retained rollback roots that require separate classification before
  another publish under the documented runbook.

Remaining approval boundary after H9 repair:

- Approve a separate retention-classification pass before pruning the existing
  node release checkouts (`opt_checkouts=24`) or UI rollback roots. None were
  deleted here.
- Approve a separate speed/data-handling repair for exact history, wallet, and
  marketplace reads. Correctness and math gates pass, but production latency is
  still too high for the desired product bar.

## Approved AMO Status-Count Frontend Repair Addendum

Scope approved by operator:

- Repair only the AMO/Credit/WORK frontend status-count bug reported from the
  `amo.proofofwork.me` green status bar.
- Preserve backend/indexer/database/math/event logic, chain data, production
  data, wallets, node configuration, storage retention, backups, recovery
  material, and unrelated page/style behavior.

Continuity:

- This follows the prior H6-18 class, "AMO refresh banner uses the wrong
  quantity and sales scope", without duplicating it as a new backend/indexer
  issue. The current evidence shows canonical fields are present; the visible
  bug was frontend status text choosing compact preview array lengths.

Root cause:

- `src/App.tsx` status text used token/listing/sale array lengths from compact
  AMO/token payloads. Those arrays can be bounded previews when
  `summaryOnly:true`, `hasMore:true`, or `collectionHasMore.*:true`, so they
  are not cardinality authority.
- The status path also missed selected-token fields and
  `listingAuthority.buyableCandidateCount`, causing selected WORK status to
  inherit global preview counts instead of the scoped canonical WORK counts.

Live read-only evidence at `2026-09-14T00:14:27Z`:

- Fresh AMO summary from `amo.proofofwork.me` was at indexed block `966888`.
  Its compact preview carried `238` token rows, `706` listing rows, and `40`
  sale rows, while canonical `totalCounts` reported `238` tokens, `743`
  listings, and `76` sales.
- The same AMO payload declared `summaryOnly:true`, `hasMore:true`,
  `collectionHasMore.listings:true`, and `collectionHasMore.sales:true`, so the
  preview rows cannot be used as complete counts.
- Selected WORK fields in the AMO payload reported `741` open WORK listings,
  `741` confirmed open WORK listings, `0` pending WORK listings, `76`
  confirmed WORK sales, and `0` pending WORK sales.
- `listingAuthority` reported `buyableCandidateCount:703`,
  `checkedListingCount:743`, and `unspentListingCount:743`.
- Fresh global token state from `computer.proofofwork.me` at block `966888`
  agreed on `238` credits, `743` open listings, `76` confirmed sales, and `0`
  pending sales.
- Fresh WORK token summary from `work.proofofwork.me` at block `966888`
  reported scoped `totalCounts.listings:741`, `totalCounts.sales:76`, and
  `totalCounts.holders:356`, while its compact arrays again exposed only
  `705` listing rows and `40` sale rows.

Repair:

- Added a shared `tokenMarketplaceStatusText`/`tokenMarketplaceCanonicalCounts`
  path in `src/App.tsx` that prefers scoped token fields, canonical
  `totalCounts`, canonical `stats`, and WORK `listingAuthority` buyable counts
  before falling back to preview rows.
- Preserved selected-token wording: selected WORK/credit routes render
  `<ticker> market loaded...`; unscoped credit status renders
  `Credit market loaded...`.
- Updated AMO/WORK/Credit refresh status selection in standalone and embedded
  contexts, including the active AMO tab status handoff.
- Added focused UI contract and Playwright coverage proving partial compact
  previews do not control AMO status counts.
- Updated the mail-compose AMO fixture evidence so complete listing hydration
  tests still represent the current display-projection contract.
- Updated deterministic AMO and Computer 390px snapshots only for the approved
  status-copy change.

Local verification:

- `npm run check:ui`: passed.
- `npm run build`: passed. Vite retained the existing large-chunk warning.
- Focused browser subset against `http://127.0.0.1:4174`: `5` tests passed,
  covering partial AMO previews, AMO order-book counts, standalone INCB
  preview clearing, mobile AMO status, and representative mobile snapshots.
- Full browser UI suite against `http://127.0.0.1:4174`: `68` tests passed.

Production read-only verification before any UI publish:

- `POW_API_BASE=https://computer.proofofwork.me npm run
  check:marketplace-regressions`: passed for ID lookup, V2
  cutover/invalid state, POWB sealed listing, WORK listing lifecycle, wallet
  scopes, targeted WORK transfers, and marketplace summary active-book
  contract.
- UI host storage health remained above the documented floor: `/` at `66%`
  used with `13,132,247,040` bytes free.
- Active UI provenance verified release
  `4ce5f70c6538-20260913T224020Z` at commit
  `4ce5f70c653871122d79a312862ef9922b637db5`.
- Six existing complete-root UI rollback roots were fingerprinted by the
  read-only retained-root helper. No rollback root, release archive, backup,
  recovery material, WAL archive, or production data was deleted or moved.

Non-actions in this addendum:

- No backend, indexer, database, math, event, chain, wallet, node, or storage
  retention logic was changed.
- No production service was stopped or restarted during the frontend repair
  verification.

## Approved Canonical Summary Publication Repair Addendum

Scope approved by operator:

- Repair canonical summary publication after AMO, WORK, Wallet, Credit, Growth,
  Log, and Computer surfaces reported exact-tip summary unavailability.
- Identify the exact post-`966897` event/component causing the AMO
  legacy-bootstrap credit reconciliation divergence.
- Make the minimum backend/indexer/test/audit-log change required to preserve
  exact, full-node-verifiable math.
- Back up PostgreSQL before production changes, restart only affected
  API/indexer worker services if required, regenerate canonical summary
  snapshots, commit, push, deploy, and verify production sync.
- Do not alter wallets, signing, chain data, raw node data, unrelated UI,
  storage retention, backups, WAL archives, rollback roots, release evidence,
  recovery material, or unrelated production data.

Read-only production evidence before repair:

- Public AMO, WORK, and consistency reads failed closed with
  `CANONICAL_SUMMARY_UNAVAILABLE`.
- Full node and canonical scan checkpoint were at block `966904` with hash
  `00000000000000000001eab4a57a98a637472ce16ce7ae50533e5feb9d0dd697`.
- Latest eligible canonical-summary refresh snapshot was block `966897`,
  snapshot `bc67357819c249798616fe20`, hash
  `780a5e98212cd96c0d494a482767aa887c63a3461c28d51184e2b3a1343840b5`.
- `proofofwork-indexer-worker` was active but `failed-escalating`; the child
  backfill failed on `/api/v1/internal/canonical-summary` HTTP `503`.
- The exact fail-closed reason was
  `legacy-bootstrap-credit-value-diverged`, with
  `committedCreditFixedQ8=4164278500000000`,
  `validCreditFixedQ8=4164286900000000`, and
  `legacyBootstrapCreditRemainderQ8=-8400000000`.
- Relational confirmed events first advanced past the last-good summary at
  block `966898`. That block contained WORK sale tx
  `d9bcb5e967bc8be6cb15627748ecacc62acc8f792bbd62d07316427a718a4ca3`
  with a derived `token-listing-closed` row, and WORK listing tx
  `96b9f2731bb91d644b3682d5c38c6491f78fc7965a9ff9aaab84031446404b6d`.
- Core-derived transaction fees for that block were `1222` proofs for the sale
  tx and `794` proofs for the listing tx.
- The AMO transition credit delta from block `966897` to `966898` was exactly
  `28108` proofs:
  `25000` sale price + `1222` sale miner fee + `546` close mutation fee +
  `546` listing mutation fee + `794` listing miner fee.
- The summary-side credit replay advanced by `28654` proofs, exactly one extra
  `546` proof marketplace mutation payment. The generic credit replay was
  assigning a default `546` marketplace mutation fee to the sale movement while
  also counting the canonical `token-listing-closed` mutation row for the same
  transaction.

Repair:

- Updated `server/proof-api.mjs` so `creditNetworkValueMetrics` treats
  token-sale replay rows as sale-price and movement records only. Canonical
  `token-listing-closed`, `token-listing`, and `token-listing-sealed`
  mutation rows own marketplace mutation payments exactly once.
- The first production retry proved the same fallback also existed in
  `growthActualLiveTotalSatsAtProvider`, the replay provider used by the
  legacy-bootstrap reconciliation. The repair now removes the synthetic
  sale-level `546` fee from that mirror path too.
- Added a production-shaped regression to
  `scripts/check-index-recovery-behavior.mjs` proving one WORK sale plus its
  same-transaction derived close produces one `546` marketplace mutation fee,
  not two.
- Added a second provider-level regression proving live-total replay ignores
  sale-level display/projection mutation fields and uses the same once-only
  accounting, so AMO legacy-bootstrap reconciliation cannot drift from the
  detailed credit metrics path.

Local verification before production change:

- `npm run check:live-data`: passed.
- `npm run check:api-truth`: passed.
- `npm run check:ui`: passed.
- `npm run check:index-recovery-behavior`: passed, `517/517` behavior checks.
- `npm run check:work-amo-v8`: passed.
- `npm run check:work-amo-v5`: passed.
- `npm run check:work-precision`: passed.
- `npm run check:worker-containment`: passed.
- `npm run check:hardening`: passed.
- `npm run build`: passed. Vite retained the existing large-chunk warning.

Pre-deploy non-actions:

- No production files were changed before the PostgreSQL backup step.
- No production services were stopped or restarted before the deployment step.
- No database rows were inserted, updated, or deleted during diagnosis.
- No storage, backups, WAL archives, rollback roots, release evidence, or
  recovery material were deleted or moved.

Production repair and verification:

- Created the pre-change PostgreSQL logical backup at
  `/data/proofofwork-postgres-backups/logical/proof_indexer-20260914T034044Z-pre-be715e9.dumpset`.
  Backup checksums were recorded in that backup directory; no retention or
  cleanup action was run.
- Final deployed source is commit
  `ea66f9502709939b75e46949f649583ab18d533b`, after intermediate repairs
  `be715e95b9983941f2b3c9067576a3bf19b717c0` and
  `b245c2e7be8566ca99b3303fc3cf27b2abd82ce6` proved the remaining replay
  mirror path.
- Final accounting invariant: token-sale projection may carry a display
  `marketplaceMutationFeeSats`, but credit replay must ignore sale-level
  mutation fees. Canonical `token-listing-closed`, `token-listing`, and
  `token-listing-sealed` rows own marketplace mutation payments exactly once.
- Production health recovered to exact tip with `lagBlocks=0`. Verified healthy
  snapshots included block `966909` snapshot `398b7bd1ec4e7e5069e187ac`, block
  `966911` snapshot `14fb97b506001b40394ce5fe`, and block `966913` snapshot
  `9dcc9f0936cbd34b702a906e`.
- `https://work.proofofwork.me/api/v1/work-floor?network=livenet&fresh=1`
  returned block `966913`, snapshot `9dcc9f0936cbd34b702a906e`, and exact
  `networkValueSats=8387576239647223792.78260041` with
  `actualValue.creditFixedQ8=4164278500000000`.
- Production `audit:ledger` passed against `https://work.proofofwork.me`,
  snapshot `33d14faa87e6ba8141346a61`, value
  `8387576239647223792.78260041` proofs.
- Production `check:marketplace-regressions` passed against
  `https://computer.proofofwork.me`: ID lookup, V2 cutover/invalid state, POWB
  sealed listing, WORK listing lifecycle, wallet scopes, targeted WORK
  transfers, and marketplace active-book contract.
- Production `audit:surfaces` passed all `13` checked hosts, including AMO,
  WORK, Wallet, Credit, Growth, Log, and Computer API probes.
- Production `check:credit-mint-regressions` passed against
  `https://credit.proofofwork.me`: POW `1,525,100/10,101,010` confirmed and
  WORK `21,000,000/21,000,000` confirmed, both with `0` pending.
- Production DB-backed `indexer:parity`, run on the VPS with the same canonical
  summary size budget as the deployed services, passed `102` checks with zero
  error failures at block `966913`, snapshot
  `9dcc9f0936cbd34b702a906e`. The only remaining warning failures were the
  already-disabled AMO V5 migration and USD quote-head readiness checks.
- Production DB-backed `audit:computer-events` passed `49` checks with zero
  failures on the VPS loopback API.

Observed transient exact-tip behavior:

- During production verification, new blocks caused short expected `503`
  windows such as `CANONICAL_SUMMARY_TIP_CHANGED`,
  `REGISTRY_AUTHORITY_UNAVAILABLE`, and `CANONICAL_WALLET_INDEX_UNAVAILABLE`.
  Retry-aware gates recovered after the worker published the next exact-tip
  snapshot. These were not the previous block-`966897` stuck summary failure.

Final non-actions:

- No wallet, signing, chain, raw node, production data, storage retention, WAL,
  rollback-root, release-evidence, recovery-material, or backup deletion was
  performed.
