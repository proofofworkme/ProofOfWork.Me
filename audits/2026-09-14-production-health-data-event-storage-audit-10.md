# 2026-09-14 Production Health, Data, Event, and Storage Audit 10

Read-only audit window: 2026-09-14 21:17-21:44 UTC.

Scope approved by the user: review prior audit logs, inspect both production
VPSes, node health, log health, event health, database health and accuracy,
mempool status, exact math gates, public rendering/API surfaces, storage usage,
and stale/waste candidates; create this audit log. No production cleanup,
database mutation, service restart, deployment, commit, push, or deletion was
approved or performed.

## Prior-audit continuity

Reviewed the mandatory repository context and prior audit chain before assigning
new findings. The current carry-forward map is:

- Audit 8's canonical rebuild outage and INCB/Q16 blockers were repaired by the
  2026-09-13 INCB repair and the later exact-tip recovery addenda.
- Audit 9's H9-01, H9-02, H9-06, and H9-09 were repaired by approved addenda.
- Audit 9's later canonical-summary publication issue was repaired by commit
  `ea66f9502709939b75e46949f649583ab18d533b`.
- The approved node checkout cleanup reclaimed obsolete `/opt` stage copies, but
  node release-health has a new/current mode failure recorded below.
- Existing storage-retention candidates, PostgreSQL WAL policy questions, UI
  release-prune dry-run behavior, slow exact reads, and audit-tool timeout
  issues are carried forward only where they are still visible today.

## Executive verdict

The production application truth plane was healthy at the final sampled
checkpoint. Core, Electrum, the canonical proof index, summary snapshots,
public consistency, ledger math, mail, marketplace, API truth, computer-event
coverage, and public surface probes all returned green at block `967023`.

The app is not in a perfect operations state. Current non-green items are:

- PostgreSQL WAL receiving is broken/degraded: `pg_receivewal_service` is
  `active=false`, `wal_status=lost`, and `pg_receivewal` is repeatedly asking
  for a WAL segment that has already been removed.
- Node `/data` is at the warning threshold (`75%` used), so
  `proofofwork-node-storage-health.service` fails by policy.
- Node release provenance automation is red because the live checkout verifier
  reports `Checkout file has an unsafe mode: .git/index`.
- UI backup retention continues to dominate the UI disk (`20G` under
  `/var/backups/proofofwork-ui`), and release pruning still fails in dry-run
  would-prune mode pending classification.
- Heavy exact/fresh reads are still slow: public surface probes hit `20.7s` for
  AMO marketplace summary, `15.0s` for Wallet WORK token, and `13.0s` for
  Credit token summary.
- `npm run check:ui-ops` still fails with
  `spawnSync /usr/bin/python3 ETIMEDOUT`.
- Strict `indexer:parity` with activity snapshot was stopped after several
  quiet minutes and is recorded as incomplete, not passed.

No current sample showed missing confirmed events, broken credit math, negative
or fractional balances, orphan event relations, stale public health, or wrong
confirmed/pending API status. The caveat is that today's strict parity command
did not complete, so this audit cannot honestly claim that every parity contract
is green.

## Node/API VPS health

Host: `pow-bitcoin-01` (`65.108.122.87`).

- `/`: `98G` total, `22G` used, `72G` available, `23%` used.
- `/data`: `1.7T` total, `1.2T` used, `399G` available, `75%` used.
- Inodes: root `5%`, data `1%`.
- Memory: `124Gi` total, `110Gi` available; swap `15Gi`, `355Mi` used.
- Active services: `bitcoind`, `electrs`, `postgresql@16-main`,
  `pg_receivewal@16-main`, `proofofwork-api`,
  `proofofwork-indexer-worker`, `proofofwork-api-wg.socket`, and
  `proofofwork-api-wg.service`.
- `systemctl --failed`: `proofofwork-node-storage-health.service` and
  `proofofwork-node-release-health.service`.
- Cache prune is healthy: `proofofwork-cache-prune.service` exited success for
  both the primary `/data/proofofwork-api-cache` path and optional legacy path.

Storage hot spots:

- `/data/bitcoin`: `908G`, live full-node data.
- `/data/electrs`: `60G`, live Electrum index.
- `/data/proofofwork-postgres-tablespaces`: `26G`, live database tablespace.
- `/data/proofofwork-postgres-backups`: `119G`.
- `/data/proofofwork-release-backups`: `10G`.
- `/data/proofofwork-recovery`: `3.7G`.
- `/data/proofofwork-audit5-restore-20260905T174233Z`: `21G`.
- `/data/proofofwork-audit5-safeguard-20260905T181729Z`: `11G`.
- `/data/proofofwork-audit5-restore-20260905T144615Z`: `2.2G`.
- Retained `/opt/proofofwork-api-stage-*` roots are now bounded-size, roughly
  `159M` to `310M` each; no checkout pruning was performed.

Node storage-health logs:

- `/data` sample: `used_percent=75`, `available_bytes=428232056832`.
- The unit warns: `WARNING storage runway is narrowing for /data.`

Release-health logs:

- `Checkout file has an unsafe mode: .git/index`
- `CRITICAL live node runtime attestation failed.`

## UI VPS health

Host: `ubuntu-4gb-hel1-1` (`77.42.91.106`).

- `/`: `38G` total, `24G` used, `13G` available, `65%` used.
- Inodes: `4%` used.
- Memory: `3.7Gi` total, `3.2Gi` available, no swap.
- `systemctl --failed`: zero loaded failed units at the sample.
- Active: `caddy` and the UI storage/provenance/prune timers.
- Current UI storage-health run succeeded:
  `used_percent=65`, `inode_used_percent=4`,
  `available_bytes=13561950208`.
- UI release provenance verified release
  `62fded8008f9-20260914T025303Z`, commit
  `62fded8008f9bd70e6b392a570f9b777389a5b2b`, archive SHA256
  `9c22c63aa35aa41c3d4d53f8a92ca34b92b133dc247a3c9ae42c0224189e03ce`.

UI storage hot spots:

- `/var/backups/proofofwork-ui`: `20G`.
- `/var/www`: `381M`.
- `/var/log/journal`: `332M`.
- `/var/log/caddy`: `21M`.
- `/var/tmp/proofofwork-deploy`: `52K`.
- Retained unmarked candidate:
  `/var/tmp/proofofwork-ui-q16-v7-preactivation-a007263-final` at `183M`.
- Old preactivation tarball:
  `/var/tmp/proofofwork-ui-release-q16-v7-preactivation-a007263-20260731T171733Z.tgz`
  at `159M`.

UI release-prune remains dry-run/would-prune:

- It verified `12` archives and found `0` unverified archives.
- It would prune five old release archives, but deletion remains disabled
  pending exact rollback-root/archive classification.

## Database health

Database: `proof_indexer`.

- Size: `26 GB`.
- Largest relation: `proof_indexer.work_amo_block_transitions`, `24 GB`,
  live `7373`, dead `0`; this is live canonical math witness data.
- Other large relations: `ledger_snapshots` `779 MB`, `events` `126 MB`,
  `transactions` `94 MB`, `event_participants` `73 MB`, `tx_outputs` `55 MB`,
  `event_refs` `44 MB`, `op_returns` `26 MB`, `tx_inputs` `25 MB`,
  `credit_listings` `17 MB`.
- Invalid or not-ready indexes: `0`.
- Lock waiters: `0`.
- Idle-in-transaction sessions: `0`.
- Recorded deadlocks: `0`.

Direct DB event/transaction sample at 21:19 UTC:

- Transactions: confirmed `25350`, pending `63`, dropped `215`.
- Events: confirmed valid `25686`, confirmed invalid `337`, pending valid `8`,
  pending invalid `55`.
- Confirmed valid events missing height/position: `0`.
- Confirmed events without confirmed transaction: `0`.
- Orphan `event_refs`: `0`.
- Orphan `event_participants`: `0`.

Computer-event audit DB sample at 21:21 UTC:

- Transactions total `25634`: confirmed `25350`, pending `69`, dropped `215`.
- Events total `26092`: confirmed valid `25686`,
  confirmed canonical activity `25686`.
- Confirmed transactions missing raw: `0`.
- Confirmed transactions missing block metadata: `0`.
- Confirmed events missing transaction: `0`.
- Confirmed events without confirmed transaction: `0`.
- Confirmed events missing raw transaction: `0`.
- `event_refs`: `55962`.
- `event_participants`: `128027`.
- Confirmed credit definitions: `238`.
- Credit balances: `404`.
- Credit listings: `1069`.
- ID records: `505`.
- Confirmed mail items: `615`.
- OP_RETURN rows: `25470`.

Credit and transition invariants:

- Negative confirmed credit balances: `0`.
- Negative pending deltas: `0`.
- Fractional confirmed balances: `0`.
- Fractional pending deltas: `0`.
- WORK transition rows: `7403`, contiguous from block `959621` through
  `967023`, with `0` incomplete rows and `0` height gaps.

WAL and backup state:

- `pg_wal`: `81M`.
- `/var/backups/postgresql/16-main/wal`: `5.8G`.
- `/data/proofofwork-postgres-backups`: `113G`.
- Logical backups: `63G`.
- Physical backups: `29G`.
- Replication slot `pg_receivewal_service`: physical, `active=false`,
  `wal_status=lost`, `restart_lsn=7C/8000000`, estimated retained LSN gap
  `84 GB`, no replication clients.
- `pg_receivewal@16-main.service` is active but loops on:
  `requested WAL segment 000000010000007C00000008 has already been removed`.

## API, math, event, and mempool health

Public health at `https://computer.proofofwork.me/api/v1/health?network=livenet`
was green:

- `ok=true`, `ready=true`, `available=true`, `lagBlocks=0`.
- Core: main chain, `tipHeight=967023`, `headers=967023`,
  `txindexHeight=967023`, `txindexSynced=true`, `initialBlockDownload=false`,
  `pruned=false`.
- Electrum: `headerHeight=967023`, `atTip=true`.
- Canonical index: `indexedThroughBlock=967023`,
  hash `000000000000000000007f4661a622f45e5da471997dc935b359adf4b8df1dac`.
- Summary snapshot: `snapshotId=60dbb887ff6198228f995a6e`,
  `payloadBytes=19702209`, all summary coverage keys at `967023`.
- Worker: `ok=true`, `consecutiveFailures=0`, `phase=idle`,
  `proofReady=true`.
- Pending event health: `globalUnresolved=0`, `q16PendingUnresolved=0`,
  `checked=3`, `staleCandidates=3`, `errors=0`.

Public consistency at the same block was green:

- `ok=true`, `status=green`, `missingLogEvents=[]`.
- Ledger coverage: `tipLagBlocks=0`, `indexedThroughBlock=967023`.
- Public log split is explicit and correct:
  `ledgerActivityCount=25695`, `publicLogActivityCount=25694`,
  `supplementalActivityCount=1`.
- Token definitions cover confirmed mints; token events and token sales logged.
- Seeded mail, INCB bonds, and POWB bonds logged.
- INCB hard values match:
  accepted mints `46`, parent bond events `47`,
  confirmed supply `224847713398447926`,
  direct proof issuance `27386`,
  attached WORK issuance `224847713398420540`,
  dust Q8 `2193582060`.
- WORK/Growth exact value:
  `8387576239651398879.44479406` proofs.
- AMO V5 legacy bootstrap carry proof passed.

Deployed loopback audit gates:

- `audit:ledger`: passed after one snapshot-change retry; snapshot
  `79ac0c149cebc84c8d870de3`, exact value
  `8387576239651398879.44479406` proofs.
- `check:marketplace-regressions`: passed ID lookup, V2 cutover/invalid state,
  POWB sealed listing, WORK listing lifecycle, wallet scopes, targeted WORK
  transfers, and active-book contract.
- `check:mail-regressions`: passed registry, mailbox, overlay, and self-send
  samples.
- `check:api-truth`: passed.
- `audit:computer-events`: passed with `failures=[]` and `warnings=[]`.

Local code/math gates:

- `npm run check:live-data`: passed.
- `npm run check:hardening`: passed.
- `npm run check:node-ops`: passed.
- `npm run check:ui`: passed.
- `npm run check:bond-exact-arithmetic`: passed.
- `npm run check:work-precision-v2`: passed.
- `npm run check:incb-range-replay-witness`: passed.
- `npm run check:incb-oracle-snapshot-restore`: passed.

Non-green or incomplete gates:

- `npm run check:ui-ops`: failed with
  `AssertionError [ERR_ASSERTION]: spawnSync /usr/bin/python3 ETIMEDOUT`.
- Strict deployed `indexer:parity` with activity snapshot was stopped after
  several quiet minutes and is not counted as passed.
- Early local `audit:ledger` and `check:api-truth` attempts failed DNS under the
  local sandbox (`EAI_AGAIN`); the deployed loopback reruns above are the
  authoritative audit result.

## Public surface health

`POW_API_BASE=https://computer.proofofwork.me npm run -s audit:surfaces -- --json --timeout-ms=180000`
passed all 13 requested public surfaces.

Every host returned HTML `200`, expected content type, and four same-origin
shell assets: one module, two modulepreloads, and one stylesheet.

API probe timings:

- `proofofwork.me`: registry summary `5099ms`.
- `id.proofofwork.me`: IDs summary `5638ms`.
- `desktop.proofofwork.me`: log summary `6966ms`.
- `browser.proofofwork.me`: activity summary `6908ms`.
- `amo.proofofwork.me`: marketplace summary `20658ms`.
- `credit.proofofwork.me`: token summary `13013ms`.
- `wallet.proofofwork.me`: WORK token `14955ms`.
- `work.proofofwork.me`: work summary `11984ms`, work floor `7545ms`.
- `infinity.proofofwork.me`: infinity summary `7475ms`.
- `inception.proofofwork.me`: inception summary `8707ms`.
- `log.proofofwork.me`: log summary `6702ms`.
- `growth.proofofwork.me`: growth summary `7014ms`.
- `computer.proofofwork.me`: health `1643ms`, consistency `8845ms`.

## Active findings

### H10-01: PostgreSQL WAL receiving is degraded and the slot is lost

Status: carry-forward WAL policy issue, actively reproduced today.

`pg_receivewal@16-main.service` is active, but it is not receiving a valid WAL
stream. Logs repeat that WAL segment
`000000010000007C00000008` has already been removed. The physical slot
`pg_receivewal_service` is `active=false`, `wal_status=lost`, and there are
zero replication clients.

Impact: the application/index is healthy, and `pg_wal` is not filling right
now, but WAL-based backup continuity is not healthy. This needs an approved
PostgreSQL backup/WAL retention repair or policy decision.

### H10-02: Node `/data` storage is at warning threshold

Status: carry-forward storage warning, still current.

Node `/data` is `75%` used with about `399G` free by `df`, and the storage
health unit fails by policy. Live chain/index data is the largest consumer and
must not be treated as cleanup. The high-value review candidates remain backup,
restore, release, and recovery trees, especially PostgreSQL backups and the
audit5 restore/safeguard directories.

### H10-03: Node release-health verifier is red on `.git/index` mode

Status: current ops finding.

The scheduled verifier now fails with:

`Checkout file has an unsafe mode: .git/index`

and then:

`CRITICAL live node runtime attestation failed.`

Impact: no live API/data corruption was observed, but release provenance
automation is not green. A narrow permission/attestation repair is needed; do
not loosen repository permissions broadly or clear failed state as a substitute.

### H10-04: UI backup retention remains the UI disk runway risk

Status: carry-forward storage finding, still current.

UI `/` is not full (`65%`, about `13G` free), but
`/var/backups/proofofwork-ui` is `20G`, and release-prune remains dry-run only.
Deletion still needs a manifest that classifies rollback roots, release
archives, provenance, and evidence.

### H10-05: Exact/fresh production reads remain too slow

Status: carry-forward performance/data-handling issue, still current.

Correctness gates passed, but fresh reads are slow enough to affect rendering:
AMO marketplace summary `20.7s`, Wallet WORK token `15.0s`, Credit token
summary `13.0s`, WORK summary `12.0s`, and marketplace regression sections
around `57s` for V5 and active/closed listing groups.

Required follow-up: keep exact math/fail-closed semantics, but render from
small current headers first and page/stream expensive detail payloads.

### H10-06: Audit tooling is still not fully bounded

Status: current tooling finding, known class from prior audits.

`check:ui-ops` timed out in a Python fixture. Strict `indexer:parity` did not
complete within a practical audit window and was stopped. These are not
evidence of corrupted production data, but they prevent a clean all-green audit
story and should be made progress-reporting/bounded.

### H10-07: Canonical summary payload is close to the active byte budget

Status: current capacity risk.

Health reported `payloadBytes=19702209` for the canonical summary snapshot.
The active H7 override budget is `20971520` bytes, leaving roughly `1.27 MB`
of headroom. The system is healthy today, but this is close enough to warrant
monitoring and compaction work before another H7-style summary budget outage.

## Storage candidates and non-actions

No deletion was performed.

Potential future manifest candidates:

- Node PostgreSQL backups under `/data/proofofwork-postgres-backups`.
- Node audit5 restore/safeguard directories under `/data`.
- Node release backups under `/data/proofofwork-release-backups`.
- UI release/rollback/classification archives under
  `/var/backups/proofofwork-ui`.
- UI unmarked preactivation candidate under `/var/tmp`.
- Any stale failed-unit state after exact evidence classification.

Preserve live chain data, Electrum data, PostgreSQL tablespaces, current
rollback/provenance, WAL evidence, audit evidence, and recovery evidence unless
a separate approved manifest says otherwise.

## Final position

Production is serving exact-tip, verified data. Math did not break in the
sampled gates, confirmed events are logged and joined, credit balances are
integer/nonnegative, AMO transition math is contiguous, public surfaces return
200, and mempool/pending health is green.

The remaining work is operational hardening and capacity management: fix WAL
receiving, classify/prune storage with approval, repair node release-health,
bound the slow audit tools, and reduce exact-read latency and summary payload
growth before they become correctness-adjacent availability issues.

## Ordered computer surface addendum - 2026-09-15

Scope: read-only follow-up audit in the user-requested order, with
`boost.proofofwork.me` added after the user clarified the scope. No production
files, services, databases, backups, WAL slots, releases, or storage were
modified. No cleanup was performed.

Reviewed previous audit logs first and did not duplicate repaired H8/H9 issue
classes. Active H10 findings below are carried forward only where reproduced.

### Ordered public surface audit

Canonical fresh surface probes passed for all original requested hosts, in
order, with `POW_API_BASE=https://computer.proofofwork.me` and
`--timeout-ms=180000`.

Observed fresh API timings:

- `proofofwork.me`: registry summary `13.032s`.
- `id.proofofwork.me`: IDs summary `5.138s`.
- `desktop.proofofwork.me`: log summary `5.464s`.
- `browser.proofofwork.me`: activity summary `5.626s`.
- `amo.proofofwork.me`: marketplace summary `18.379s`.
- `credit.proofofwork.me`: token summary `11.784s`.
- `wallet.proofofwork.me`: WORK token `14.000s`.
- `work.proofofwork.me`: work summary `10.513s`, work floor `8.097s`.
- `infinity.proofofwork.me`: infinity summary `6.889s`.
- `inception.proofofwork.me`: inception summary `6.557s`.
- `log.proofofwork.me`: log summary `6.785s`.
- `growth.proofofwork.me`: growth summary `7.287s`.
- `computer.proofofwork.me`: health `1.637s`, consistency `10.771s`.

Browser render pass also passed on desktop `1440x1000` and mobile `390x844`
for every surface with Boost inserted before AMO:

`home`, `id`, `desktop`, `browser`, `boost`, `amo`, `credit`, `wallet`,
`work`, `infinity`, `inception`, `log`, `growth`, `computer`.

Every browser route returned HTTP 200, reached its expected app selector, and
showed no page errors, console errors, request failures, same-origin 5xx
responses, or outage text. Screenshots were written only under
`/tmp/pow-ordered-render-audit-2026-09-15T00-58-11-736Z`.

### Boost added scope

`boost.proofofwork.me` page HTML returned 200 in `669ms`, loaded the SPA root,
and referenced six app assets.

`/api/v1/boost?network=livenet&limit=20&fresh=1` returned 200 in `7.668s`:

- `complete=true`
- `mode=timeline`
- `source=proof-indexer-events`
- `snapshotId=cdcbe068e8f0b72fb5a4504e`
- `indexedThroughBlock=967044`
- `totalCount=4`, `items=4`
- provenance `model=boost-complete-events-v1`, `eventCount=7`,
  `totalCount=7`, `pages=1`
- exact signal total `2795866839043.88675887` proofs
- attached WORK signal subatoms `70000011000000000`

`/api/v1/boost?network=livenet&listings=1&limit=200&fresh=1` returned 200 in
`4.723s`, `complete=true`, `mode=listings`, `totalCount=0`, on the same
snapshot. Zero Boost listings is consistent with the current event rollup.

Local Boost and Growth regressions passed:

- `npm run -s check:boost-regressions`
- `npm run -s check:growth`

### Full-node, DB, and event truth

Bitcoin Core read-only checks through `/etc/bitcoin/bitcoin.conf`:

- chain `main`
- blocks `967044`, headers `967044`
- best block
  `00000000000000000001120f3d0272ddeac9f8ea1e37a2edf76b3b7c581fbf83`
- `initialblockdownload=false`
- `verificationprogress=1`
- unpruned node
- no Core warnings
- mempool loaded: `34409` transactions, `11696742` bytes
- `txindex`, `coinstatsindex`, and basic block filter index synced at
  height `967044`

Loopback API health reported Core, Electrum, index, worker, and database green
at block `967044`, zero lag, pending events green, and canonical summary
snapshot `cdcbe068e8f0b72fb5a4504e`.

Loopback ledger audit passed:

`snapshot cdcbe068e8f0b72fb5a4504e, value 8387599192528358593.62410996 proofs`.

Loopback API truth contract passed.

Marketplace regression passed for ID lookup, V2 cutover/invalid state, POWB
sealed listing, WORK listing lifecycle, wallet scopes, and targeted WORK
transfers. Wallet-specific checks passed for legacy inventory exclusion,
multi-anchor closure preservation, disabled legacy sealed WORK inventory,
cutover relic wallets, and Carbonz delayed WORK transfer recovery. Fresh reads
inside this gate remained slow, including token-history market-log reads above
`14s`, closed-listing reads above `12s`, and WORK token reads around `10s`.

Mail regression passed for indexed inbox/sent overlays and self-send cases.

Computer event audit passed with `failures=[]` and `warnings=[]`. Important DB
coverage counts:

- transactions total `25672`, confirmed `25422`, pending `35`, dropped `215`
- confirmed transactions missing raw transaction `0`
- confirmed transactions missing block metadata `0`
- events total `26132`
- confirmed valid events `25760`
- confirmed PWT invalid audit events `270`
- confirmed canonical action txids `25106`
- confirmed events missing transaction `0`
- event refs `56176`
- event participants `128225`
- credit definitions confirmed `238`
- credit balances `404`
- credit listings `1101`
- ID records `505`
- confirmed mail items `616`
- OP_RETURN rows `25545`

Boost event rollup was present in the same event audit:

- `boost-post`: `4` confirmed valid events, `2184` sats
- `boost-profile`: `2` confirmed valid events, `1092` sats
- `boost-follow`: `1` confirmed valid event, `1092` sats

ID registry audit passed strict Core-ordered lifecycle parity:

- address source `http://127.0.0.1:8081`
- registry address `bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e`
- fetched transactions `564`
- covered confirmed registry transactions `562`
- covered pending registry transactions `2`
- lifecycle events `535`
- active listings `6`
- canonical sales `4`
- registration attempts `524`
- confirmed winners `505`
- pending candidates `2`
- refund candidates `17`
- pending watchlist `0`
- no report files written

### VPS, storage, log, and database health

Node/API VPS `pow-bitcoin-01`:

- uptime about `128 days`
- `/` `98G`, `22G` used, `72G` free, `23%`
- `/data` `1.7T`, `1.2T` used, `399G` free, `75%`
- `/data` inode use `1%`
- memory `124Gi`, about `109Gi` available
- failed units: `proofofwork-node-release-health.service`,
  `proofofwork-node-storage-health.service`
- active services: `bitcoind`, `electrs`, `postgresql@16-main`,
  `pg_receivewal@16-main`, `proofofwork-api`,
  `proofofwork-indexer-worker`, API WireGuard socket/service

PostgreSQL:

- version `16.15`
- `proof_indexer` database size `26 GB`
- replication slot `pg_receivewal_service` remains `active=false`,
  `wal_status=lost`, `restart_lsn=7C/8000000`, gap about `85 GB`
- no database deadlocks observed
- largest DB relation footprint: `work_amo_block_transitions` about `24 GB`
  total, with TOAST/storage dominating the visible heap/index size

Node storage candidates observed, read-only only:

- `/data/bitcoin` `909G`
- `/data/proofofwork-postgres-backups` `119G`
- `/data/electrs` `60G`
- `/data/proofofwork-postgres-tablespaces` `26G`
- `/data/proofofwork-audit5-restore-20260905T174233Z` `21G`
- `/data/proofofwork-audit5-safeguard-20260905T181729Z` `11G`
- `/data/proofofwork-release-backups` `10G`
- `/data/proofofwork-recovery` `3.7G`

UI VPS `ubuntu-4gb-hel1-1`:

- uptime about `130 days`
- `/` `38G`, `24G` used, `13G` free, `65%`
- inode use `4%`
- memory about `3.1Gi` available
- no swap configured
- `caddy` active
- failed unit: `proofofwork-ui-release-prune.service`
- `/var/backups/proofofwork-ui` `20G`
- `/var/www` `381M`
- `/var/log` `594M`

### Updated findings

#### H10-01 remains active: WAL receiving is still degraded

The WAL receiver process is running, but the replication slot is still lost and
inactive with an `85 GB` LSN gap. This is not a current app-data corruption
finding, but it is a backup/recovery hazard. The fix should recreate or
advance the WAL receive path with an explicit recovery/backup plan; do not just
clear the failed symptom.

#### H10-02 remains active: node `/data` is still at the warning threshold

`/data` remains `75%` used with about `399G` free, and the node storage-health
unit remains failed by policy. This is not immediately full, but the system
already learned that disk runway can become an application availability issue.

#### H10-03 remains active: node release-health is still failed

`proofofwork-node-release-health.service` remains failed. Prior evidence showed
the verifier complaining that `.git/index` has an unsafe mode. This blocks a
clean release provenance story even though live chain/API truth is green.

#### H10-04 remains active: UI release backup retention is still the UI disk risk

The UI VPS has `13G` free, but managed UI backups still consume `20G`, and
`proofofwork-ui-release-prune.service` remains failed. No deletion should occur
without an approved manifest that classifies release roots, rollback roots,
incident evidence, provenance, and generated state.

#### H10-05 remains active: exact/fresh reads are correct but too slow

Correctness gates passed, but the fresh path is slow enough to affect user
experience and recurring audit cost. The ordered surface audit showed AMO
`18.379s`, wallet WORK `14.000s`, registry `13.032s`, credit `11.784s`, WORK
summary `10.513s`, and consistency `10.771s`. Marketplace regression repeated
multi-second to double-digit-second token-history and wallet reads.

Recommended direction: keep exact integer math and fail-closed semantics, but
serve a small, current, verified header quickly and page/stream heavy detail
sets from snapshot-bound projections.

#### H10-06 remains active: audit tooling is still not fully bounded

`check:ui-ops` stayed silent for more than two minutes and was manually stopped
with exit `130`. This matches the prior audit tooling class. Hardening,
node-ops, UI contract, Boost, and Growth checks passed, so this is an
auditability/tooling issue rather than production data corruption evidence.

#### H10-07 is worse: canonical summary payload has less than 1 MB headroom

Health reported canonical summary `payloadBytes=20335225`. Against the active
H7 override budget `20971520`, that leaves only `636295` bytes of headroom.
This is closer than the previous audit and should be treated as a near-term
capacity risk.

#### H10-08 new: Growth's embedded Boost observation can flap while fresh summaries prepare

The standalone Boost feed/listing API was complete and stable for the sampled
snapshot, and the event audit confirms seven valid confirmed `pwb1` Boost
events. However, repeated fresh Growth summary reads showed unstable embedded
Boost readiness:

- On snapshot `cdcbe068e8f0b72fb5a4504e` at block `967044`, five fresh reads
  returned: Boost preparing, Boost complete, HTTP `503`, Boost complete,
  HTTP `503`.
- On the next snapshot `a03f5c94177c2dcf9b5b44df` at block `967045`, four
  fresh reads returned: Boost preparing, then three complete reads.

Latest complete Boost growth counts were:

- events `7`
- transactions `7`
- posts `4`
- follows `1`
- profiles `2`
- listings/seals/delistings/sales `0`
- attached WORK subatoms `70000011000000000`
- attributed mail sats `2184`

This does not show math corruption in the final complete payload. It does show
that Growth can render a transient unavailable Boost observation or a 503 for
the same fresh summary/snapshot. Recommended fix: atomically attach Boost
growth observations to summary snapshots, serve the last complete same-tip
observation while a new one is preparing, and make the failure mode bounded and
observable instead of flapping between ready, not-ready, and 503.

### Recommendations before any approved repair pass

1. Add `boost.proofofwork.me` and `/api/v1/boost` to the canonical
   production surface audit script so future audits cannot forget it.
2. Repair PostgreSQL WAL receiving with an explicit backup/recovery plan.
3. Classify storage candidates into an approved deletion/retention manifest
   before pruning anything.
4. Fix node release-health/provenance rather than clearing failed state.
5. Move heavy summary/listing/history endpoints toward snapshot-bound small
   headers plus paginated detail projections.
6. Compact or split canonical summary payloads before the remaining
   `636295` bytes of budget headroom disappears.
7. Stabilize Growth's Boost observation lifecycle so a single snapshot cannot
   alternate between preparing, complete, and 503.
8. Bound long audit tools with progress output, per-phase timeouts, and
   machine-readable partial status.

### Addendum final position

The computer is serving verified chain-backed data at tip in the sampled
checks. Full-node state, Core indexes, Electrum/index/API health, ledger math,
marketplace/listing/seal/wallet regressions, ID lifecycle replay, mail
regressions, Boost feed/listing endpoints, and browser rendering all passed.

The remaining work is not a math failure. It is operational hardening:
restore WAL archival, reduce disk/backup pressure, repair release-health,
make audit tooling bounded, reduce exact-read latency, split/compact payloads,
and stabilize Growth's Boost-ready state under fresh snapshot preparation.
