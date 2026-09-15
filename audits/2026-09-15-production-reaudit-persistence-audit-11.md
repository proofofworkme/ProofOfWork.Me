# Production re-audit persistence audit 11 - 2026-09-15

Read-only re-audit requested after
`2026-09-14-production-health-data-event-storage-audit-10.md` and its ordered
computer surface addendum. This audit checks whether the same findings persist.

No production files, databases, services, WAL slots, backups, release roots, or
storage were modified. No cleanup, restart, deploy, commit, or push was
performed.

## Comparison target

Previous active findings reviewed before this re-audit:

- H10-01: PostgreSQL WAL receiving degraded.
- H10-02: node `/data` storage warning threshold.
- H10-03: node release-health failed.
- H10-04: UI release backup retention risk.
- H10-05: exact/fresh production reads too slow.
- H10-06: audit tooling not fully bounded.
- H10-07: canonical summary payload close to byte budget.
- H10-08: Growth embedded Boost observation can flap while fresh summaries
  prepare.

The re-audit also rechecked the ordered public surfaces with Boost included.

## Ordered surface status

`POW_API_BASE=https://computer.proofofwork.me npm run -s audit:surfaces --
--json --timeout-ms=180000` passed across the canonical host order.

Fresh timings:

- `proofofwork.me`: registry summary `7.587s`.
- `id.proofofwork.me`: IDs summary `6.353s`.
- `desktop.proofofwork.me`: log summary `5.344s`.
- `browser.proofofwork.me`: activity summary `6.173s`.
- `amo.proofofwork.me`: marketplace summary `16.202s`.
- `credit.proofofwork.me`: token summary `6.844s`.
- `wallet.proofofwork.me`: WORK token `12.294s`.
- `work.proofofwork.me`: work summary `9.375s`, work floor `8.163s`.
- `infinity.proofofwork.me`: infinity summary `5.141s`.
- `inception.proofofwork.me`: inception summary `4.821s`.
- `log.proofofwork.me`: log summary `5.720s`.
- `growth.proofofwork.me`: growth summary `6.799s`.
- `computer.proofofwork.me`: health `2.197s`, consistency `10.163s`.

Browser rendering recheck passed on desktop `1440x1000` and mobile `390x844`
for:

`home`, `id`, `desktop`, `browser`, `boost`, `amo`, `credit`, `wallet`,
`work`, `infinity`, `inception`, `log`, `growth`, `computer`.

Every browser route returned HTTP 200, reached its expected app selector, and
showed no page errors, console errors, request failures, same-origin 5xx
responses, or outage text.

## Boost status

Standalone Boost remained healthy:

- `boost.proofofwork.me` HTML returned 200 in `473ms`.
- `/api/v1/boost?network=livenet&limit=20&fresh=1` returned 200 in `5.604s`.
- `/api/v1/boost?network=livenet&listings=1&limit=200&fresh=1` returned 200 in
  `5.221s`.
- Snapshot `98f8108d5fd8e4c133ce588d`, indexed through block `967127`.
- Timeline complete, `totalCount=4`, `items=4`.
- Provenance `model=boost-complete-events-v1`, `eventCount=7`,
  `totalCount=7`, `pages=1`.
- Boost listings complete, `totalCount=0`.
- Exact total Boost signal
  `2795866839044.71735653` proofs.
- Attached WORK signal subatoms `70000011000000000`.

Local Boost/Growth checks passed:

- `npm run -s check:boost-regressions`
- `npm run -s check:growth`
- `npm run -s check:ui`

Growth's embedded Boost observation still flapped on the same snapshot
`98f8108d5fd8e4c133ce588d` at block `967127`: six repeated fresh Growth reads
returned preparing, complete, complete, complete, complete, preparing. No
Growth 503 was seen in this repeat, but H10-08 remains active because the same
snapshot can still alternate between Boost unavailable and complete.

## Full-node and API truth

Bitcoin Core read-only checks:

- chain `main`
- block/header height initially `967127`, later `967129`
- IBD false
- unpruned node
- no Core warnings
- mempool loaded, initially `38854` txs, `13614073` bytes
- `txindex`, `coinstatsindex`, and basic block filter index synced

Loopback health was green at block `967127` during the first truth check, with
zero lag and summary snapshot `98f8108d5fd8e4c133ce588d`.

Ledger audit passed:

`snapshot 98f8108d5fd8e4c133ce588d, value 8387599192530850386.19200809 proofs`.

API truth contract passed.

Mail regression passed.

Computer-events audit passed with `failures=[]` and `warnings=[]`.

Important database coverage from computer-events:

- transactions total `25699`
- transactions confirmed `25446`
- transactions pending `38`
- transactions dropped `215`
- confirmed transactions missing raw transaction `0`
- confirmed transactions missing block metadata `0`
- recent confirmed transactions missing block metadata `0`
- events total `26160`
- confirmed valid events `25785`
- confirmed PWT invalid audit events `270`
- confirmed canonical action txids `25130`
- confirmed events missing transaction `0`
- confirmed events without confirmed transaction `0`
- confirmed events missing raw transaction `0`
- event refs `56303`
- event participants `128367`
- credit definitions confirmed `238`
- credit balances `404`
- credit listings `1110`
- ID records `505`
- confirmed mail items `616`
- OP_RETURN rows `25569`

Boost event rollup from the same event audit:

- `boost-follow`: `1` confirmed valid event, `1` pending valid event
- `boost-post`: `4` confirmed valid events
- `boost-profile`: `2` confirmed valid events

## Marketplace, wallet, and fresh-read behavior

Marketplace regression eventually passed end-to-end for ID lookup, V2
cutover/invalid state, POWB sealed listing, WORK listing lifecycle, wallet
scopes, and targeted WORK transfers.

The performance and availability behavior was worse than audit 10:

- first fresh WORK token read: `28.749s`
- V2 cutover section: `52.880s`
- V5 cutover/write gate: `118.597s`
- active/closed WORK listing truth: `90.288s`
- cutover relic wallet checks: `31.488s`
- Carbonz delayed transfer wallet recovery: `25.514s`
- marketplace summary active book: `10.636s`
- individual fresh history reads included `22.788s`, `18.400s`,
  `34.867s`, `19.366s`, and multiple `10s+` reads

During marketplace regression, fresh token-history returned repeated HTTP 503s
with `CANONICAL_INDEX_CATCHING_UP` before recovering:

`The canonical ProofOfWork index is catching up to the Bitcoin Core tip.`

Marketplace correctness recovered and passed, but H10-05 is now both a speed
and transient availability finding.

## ID audit behavior

The previous ordered addendum's strict ID registry audit passed. In this
re-audit, strict ID lifecycle replay was not reliably available:

- initial `audit:ids` failed with HTTP 503 from
  `/api/v1/internal/id-registry-audit?network=livenet`
- retry failed with the same HTTP 503
- after `/health` recovered, public
  `/api/v1/ids-summary?network=livenet&fresh=1` still returned
  `The canonical ProofOfWork index is catching up to the Bitcoin Core tip.`
- bounded strict ID retry failed again with HTTP 503

This is not evidence that ID chain history changed incorrectly. Public surface
rendering and DB event coverage still passed, and confirmed ID record count
remained `505`. It is evidence that the strict fresh ID audit/read path can be
unavailable during canonical catch-up/readiness windows.

## Transient health 503

During the re-audit, both public and loopback `/health?network=livenet`
returned HTTP 503.

The 503 health body showed:

- Core, Electrum, database, disk, canonical state, and summary snapshot were
  otherwise available.
- Tip height `967129`, indexed through `967128`, lag `1`.
- Worker phase `failed-retrying`.
- Worker error:
  `Pending protocol-event readiness is unhealthy: {"globalUnresolved":null,...}`
- The same health payload's pending-event status showed `globalUnresolved=0`,
  `q16PendingUnresolved=0`, `errors=0`, `staleCandidates=3`.

Recent logs showed:

- worker deferred after Core advanced from block `967128` to `967129`
- marketplace summary failures while registry checkpoint was catching up
- fresh wallet credit state temporarily unavailable
- fresh payload refresh failed with `Confirmed protocol transaction order is
  incomplete`
- fresh payload refresh failed with
  `Recovered WORK wallet state refuses a Q8 fallback after Q16 activation`

After waiting for the next worker cycle, `/health` recovered to HTTP 200 at
block `967129`, snapshot `fb374f8de4fde46b0f7781d5`, zero lag, worker
`proofReady=true`.

This is a transient but real readiness/availability regression compared with
the earlier green health sample.

## VPS and storage state

Node/API VPS `pow-bitcoin-01`:

- `/` `98G`, `22G` used, `72G` free, `23%`
- `/data` `1.7T`, `1.2T` used, `385G` free, `76%`
- `/data` inode use `1%`
- memory about `103Gi` available
- failed units:
  `proofofwork-node-release-health.service`,
  `proofofwork-node-storage-health.service`
- active services:
  `bitcoind`, `electrs`, `postgresql@16-main`,
  `pg_receivewal@16-main`, `proofofwork-api`,
  `proofofwork-indexer-worker`, API WireGuard socket/service

PostgreSQL:

- `proof_indexer` database size `26 GB`
- WAL slot `pg_receivewal_service`: `active=false`, `wal_status=lost`,
  `restart_lsn=7C/8000000`, gap about `88 GB`
- database deadlocks observed: `0`

Node storage candidates, read-only only:

- `/data/bitcoin` `909G`
- `/data/proofofwork-postgres-backups` `133G`
- `/data/electrs` `60G`
- `/data/proofofwork-postgres-tablespaces` `26G`
- `/data/proofofwork-audit5-restore-20260905T174233Z` `21G`
- `/data/proofofwork-audit5-safeguard-20260905T181729Z` `11G`
- `/data/proofofwork-release-backups` `10G`
- `/data/proofofwork-recovery` `3.7G`
- `/var/log` `928M`

UI VPS `ubuntu-4gb-hel1-1`:

- `/` `38G`, `24G` used, `13G` free, `65%`
- inode use `4%`
- memory about `3.1Gi` available
- no swap configured
- `caddy` active
- failed unit: `proofofwork-ui-release-prune.service`
- `/var/backups/proofofwork-ui` `20G`
- `/var/www` `381M`
- `/var/log` `597M`

## Payload budget

Canonical summary payload grew again:

- block `967127`: `payloadBytes=20543309`
- block `967129`: `payloadBytes=20543313`

Against the active budget `20971520`, remaining headroom is only `428207`
bytes. H10-07 persists and is now urgent.

## Audit tooling

`timeout 150s npm run -s check:ui-ops` exited `124`. H10-06 persists.

## Findings

### A11-01: Fresh-read readiness instability is now the highest-priority issue

Status: active and worse than audit 10.

The system's canonical math and final snapshots are still correct in the
sampled checks, but fresh reads can flap or temporarily fail:

- public and loopback health returned 503 before later recovering
- ID summary/audit paths returned 503/catch-up errors
- marketplace token-history saw repeated canonical catch-up 503s before
  recovering
- Growth embedded Boost alternated between preparing and complete on the same
  snapshot

Required direction: keep exact/fail-closed math, but separate last-complete
read serving from fresh projection preparation. Reads should be snapshot-bound
and stable while refresh continues. Strict audit endpoints should return a
bounded "preparing" state or last complete audit checkpoint instead of
unstructured 503s during normal block advancement.

### A11-02: Exact reads are slower than before in important paths

Status: active and worse than audit 10.

Fresh reads remain correct when they complete, but marketplace and wallet paths
now show many double-digit-second calls, including `28.749s`, `34.867s`,
`118.597s` for a section, and `90.288s` for a section.

Required direction: serve small verified headers first, page heavy histories
and wallet/listing detail by snapshot id, and precompute/materialize hot
read-model joins without relaxing integer math.

### A11-03: Summary payload budget is now near exhaustion

Status: active and worse than audit 10.

Only `428207` bytes remain under the active summary byte budget. This is close
enough that another growth burst could become an availability issue.

Required direction: split/compact canonical summaries before adding more
surface data, especially marketplace/token/wallet/history detail.

### A11-04: WAL archival remains degraded

Status: active, persisted.

The WAL slot remains `lost` and inactive, now about `88 GB` behind. This is a
backup/recovery hazard, not observed app-data corruption.

### A11-05: Storage pressure remains active

Status: active, persisted/worse on the node.

Node `/data` is now `76%` used. PostgreSQL backups alone are `133G`. UI backup
retention remains `20G` and the UI prune unit remains failed.

No deletion should happen without an approved retention/deletion manifest.

### A11-06: Node release-health remains failed

Status: active, persisted.

`proofofwork-node-release-health.service` remains failed. This blocks a clean
runtime provenance story.

### A11-07: UI ops audit tooling remains unbounded

Status: active, persisted.

`check:ui-ops` timed out under an explicit `150s` bound. The tool needs phase
logs, partial machine-readable status, and per-phase timeout behavior.

## Recommended repair order

1. Stabilize fresh-read/readiness behavior across health, IDs, marketplace,
   wallet, Growth/Boost, and strict audit endpoints.
2. Split/compact the canonical summary payload before the remaining `428207`
   bytes of headroom disappear.
3. Add `boost.proofofwork.me` and `/api/v1/boost` permanently to the canonical
   surface audit script.
4. Repair WAL receiving with an explicit backup/recovery plan.
5. Prepare an approved storage retention manifest for node backups, audit
   restore/safeguard directories, release backups, and UI backup roots.
6. Repair node release-health/provenance.
7. Bound `check:ui-ops` with progress output and partial JSON.

## Final position

Core chain truth, exact ledger math, marketplace correctness, wallet scope
logic, mail overlays, Boost standalone data, and browser rendering remain
healthy when the system reaches a complete snapshot.

The most important issue is availability around fresh reads and readiness
windows. The computer is correct, but it is not yet smooth or hardened enough:
it can temporarily report catch-up/503 while the worker and summaries converge,
and its payload/latency/storage margins are too tight for a perfect production
computer.
