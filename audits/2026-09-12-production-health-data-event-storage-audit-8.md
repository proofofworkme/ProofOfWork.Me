# Production Health, Data, Event, and Storage Audit 8

Date: 2026-09-12
Mode: read-only production audit, except for this approved audit log
Scope: node health, UI VPS health, API/log/event/database/storage health, event and mempool tracking, exact math/projection health, cleanup candidates

## Executive verdict

Production is **not healthy**.

Bitcoin Core, electrs, PostgreSQL, Caddy, and the static UI surfaces are mostly alive, and the API is correctly failing closed instead of rendering unverified math. The canonical application truth plane is not current: the proof index is in an active rebuild, stuck at block `957949`, while Core is at block `966678`. Fresh ledger, event, ID, parity, and summary checks return `503 CANONICAL_INDEX_UNAVAILABLE`.

The current blocker is more specific than the previous reorg fault: the worker repeatedly stops at confirmed transaction `dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4` in block `957950` because the exact H-1 Inception value snapshot for block `957949` is unavailable.

No production data was deleted, repaired, pruned, restarted, deployed, or mutated during this audit.

## Prior audit continuity

Reviewed the existing audit trail before writing this log to avoid duplicating prior findings:

- `2026-09-11-production-health-data-event-storage-audit-7.md`
- `2026-09-08-production-health-data-event-storage-audit-6.md`
- `2026-09-05-production-health-data-event-storage-audit-5.md`
- Earlier health/storage/remediation manifests where relevant

This audit carries forward the known storage and failed-unit context, but the primary new state is the post-H7 recovery blocker: an active rebuild is now present and repeatedly blocked by a missing exact H-1 INCB/WORK value snapshot.

## Node VPS health

Host: `pow-bitcoin-01`
Audit time: 2026-09-12 12:47-13:01 UTC

Disk:

- `/`: 98G total, 23G used, 71G free, 25% used
- `/data`: 1.7T total, 1.2T used, 362G free, 77% used
- Inodes: `/` 6%, `/data` 1%

Major `/data` users from privileged read-only `du`:

- `/data/bitcoin`: 908G
- `/data/bitcoin/blocks`: 816G
- `/data/bitcoin/indexes`: 82G
- `/data/bitcoin/chainstate`: 11G
- `/data/electrs`: 60G
- `/data/proofofwork-postgres-backups`: 168G
- `/data/proofofwork-audit5-restore-20260905T174233Z`: 21G
- `/data/proofofwork-audit5-restore-20260905T144615Z`: 18G
- `/data/proofofwork-audit5-safeguard-20260905T181729Z`: 11G
- `/data/proofofwork-release-backups`: 9.3G
- `/data/proofofwork-recovery`: 3.6G

Services:

- `bitcoind`: active
- `electrs`: active
- `postgresql@16-main`: active
- `pg_receivewal@16-main`: active
- `proofofwork-api`: active
- `proofofwork-indexer-worker`: active but failing/retrying its backfill cycle
- `proofofwork-node-storage-health.service`: failed because `/data` is above the configured warning threshold
- `proofofwork-node-release-health.service`: still failed, carried forward from earlier audits

Core/electrs/API low-level health:

- Bitcoin Core reports main chain, fully synced, not pruned, not in IBD.
- Electrum health is OK.
- API `/health`, `/health/live`, `/api/v1/consistency?network=livenet&fresh=1`, and fresh summaries return 503 because canonical index availability is false.

## UI VPS health

Host: `ubuntu-4gb-hel1-1`
Audit time: 2026-09-12 12:47-12:54 UTC

Disk:

- `/`: 38G total, 20G used, 17G free, 54% used
- Inodes: 3%

Major UI filesystem users:

- `/var/backups`: 17G
- `/var/backups/proofofwork-ui`: 16G
- `/var/backups/proofofwork-ui/rollbacks`: 6.0G
- `/var/backups/proofofwork-ui/classified-rollback-roots`: 3.6G
- `/var/backups/proofofwork-ui/rollback-classifications`: 2.6G
- `/var/backups/proofofwork-ui/releases`: 2.1G
- `/var/backups/proofofwork-ui/rollback-roots`: 790M
- `/var/www`: 221M
- Journals: 294.2M

Services:

- `caddy`: active
- `proofofwork-ui-storage-health.service`: inactive at check time
- `proofofwork-ui-release-provenance.service`: inactive at check time
- `proofofwork-ui-release-prune.service`: failed

The release-prune unit is still in dry-run/would-prune mode and exits failed after reporting verified archives that would be pruned. It also warns that multiple complete-root UI rollbacks are retained and archive deletion remains disabled pending exact classification.

Configured UI hosts probed locally through Caddy:

- `www.proofofwork.me`: 200
- `id.proofofwork.me`: 200
- `computer.proofofwork.me`: 200
- `amo.proofofwork.me`: 200
- `growth.proofofwork.me`: 200
- `log.proofofwork.me`: 200
- `credit.proofofwork.me`: 200
- `boost.proofofwork.me`: 200
- `browser.proofofwork.me`: 200
- `wallet.proofofwork.me`: 200
- `work.proofofwork.me`: 200
- `infinity.proofofwork.me`: 200
- `inception.proofofwork.me`: 200
- `desktop.proofofwork.me`: 200
- `marketplace.proofofwork.me`: 308 to `amo.proofofwork.me`
- `proofofwork.me`: 301 to `www.proofofwork.me`
- `token.proofofwork.me`: 301
- `tokens.proofofwork.me`: 301

`activity.proofofwork.me` produced a TLS error in a local probe, but the Caddyfile does not configure that host. The Activity app is configured at `log.proofofwork.me`, which returned 200.

## Database health

PostgreSQL structural health:

- Database size: 757 MB
- Largest relations:
  - `proof_indexer.work_amo_block_transitions`: 248 MB
  - `proof_indexer.ledger_snapshots`: 123 MB
  - `proof_indexer.transactions`: 84 MB
  - `proof_indexer.events`: 81 MB
  - `proof_indexer.tx_outputs`: 55 MB
  - `proof_indexer.event_participants`: 49 MB
  - `proof_indexer.event_refs`: 35 MB
- Invalid indexes: 0
- Waiting locks: 0
- Long active queries over 5 minutes: 0
- Deadlocks: 0
- Unvalidated constraints: 0
- Exact-integer numeric constraint violations sampled across credit definitions, balances, and listings: 0

Table-level state:

- `blocks`: 18,501 rows, heights 948000-966500
- `transactions`: 25,384 rows, heights 948283-966498
- `events`: 23,927 rows, heights 948283-957785
- `id_records`: 493 rows
- `credit_definitions`: 238 rows
- `credit_listings`: 170 rows
- `credit_balances`: 0 rows

Basic invariants that still pass inside the stale/rebuild-local tables:

- Duplicate event keys: 0
- Duplicate IDs: 0
- Missing event transaction rows: 0
- Confirmed valid `id-register` events: 493
- `id_records`: 493

These invariants do **not** certify live correctness because the index is not current and the summary/projection plane is unavailable.

## Canonical index and event health

Current public API availability:

- `/health`: 503
- `/health/live`: 503
- `/api/v1/consistency?network=livenet&fresh=1`: 503
- `/api/v1/ledger/summary?network=livenet&fresh=1`: 503

Health details:

- Core tip: `966678`
- Canonical rebuild indexed through: `957949`
- Lag: 8,729 blocks at the health check
- Rebuild started: `2026-09-11T12:30:16.794Z`
- Rebuild updated: `2026-09-12T09:02:11.500Z`
- Rebuild from height: `948000`
- Bootstrap height/hash: `947999` / `000000000000000000004238bec59ce46cd5b28982efe2b90071a51168d67986`
- Current rebuild checkpoint hash: `00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e`
- Summary snapshot: absent/empty, not eligible
- Worker last successful run: `2026-09-11T00:13:39.129Z`

Ledger snapshot table:

- `block-scan-partial`: 9,951 rows, heights 947999-957949
- `work-amo-v5-h-minus-one-seed-evidence`: 1 row at height 959620
- No full current canonical summary snapshot is present.

The H-1 snapshot expected by the blocked INCB verifier is missing:

- Expected snapshot id from pinned code/oracle metadata: `b8e77cd30cbed6855977c514`
- Expected H-1 block height/hash: `957949` / `00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e`
- Actual row at height 957949: snapshot `90839f0cc02e705906efac0e`, `block-scan-partial`, 814-byte payload, no canonical summary hash

Worker logs repeatedly stop here:

- Block scan stopped at `957949`
- Internal verifier returns `503 INCEPTION_VALUE_SNAPSHOT_UNAVAILABLE`
- Blocking transaction: `dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4`
- Blocking block: `957950`
- Reason: `green-h-minus-one-summary-unavailable`
- Expected previous block hash: `00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e`

The blocking transaction is present in `transactions` and `op_returns`:

- `transactions.status`: confirmed
- `block_height`: 957950
- `protocol` records:
  - `pwm1:m:incb`
  - `pwt1:send:d4e5...:3644060:1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x`

No normalized `events` row exists for that txid because verification halts before persistence.

## Mempool status health

The DB has 37 stored `pending` transactions.

Core RPC sampled across all 37:

- 31 are still in mempool/unconfirmed according to Core.
- 6 are already confirmed in Core but still stored as `pending` in the index DB.
- 0 were missing from Core.

Confirmed-in-Core but still DB-pending:

- `09a25e4a59ac37b954dee689052ff5784f5f66d1a7f501dfd3b149e852b369f8`
- `11dcb4b5627c0bd4bb89ce0b1eeedf60dda55c8ad1a4cf20afc97353707b3c54`
- `4228600a760825ece8b8fb71664d0f9f13e1a5ca857b4f1ae341d862c41a1f67`
- `a63de3b551953af5f00ef7d439bcad7da684aaea10b102788c10bbaa384e659d`
- `ac80dbb5064f4082c426831aa5afcf1d3f7e3d32469d0d5eea85f6048864601f`
- `fcd0b826648388aa01d3404eb7cfdef5ff8bf8e34a38e41d1032b2e5cecfe501`

Conclusion: pending/mempool status is not fully accurate while the worker is blocked. The public API is fail-closed for fresh reads, but any internal or stale view that bypasses readiness could render incorrect pending status.

## Credit and math projection health

The code-level math contracts passed locally:

- `npm run check:bond-exact-arithmetic`
- `npm run check:work-precision-v2`
- `npm run check:incb-range-replay-witness`

Database constraints for exact integer storage are validated and showed no sampled violations.

However, production credit projections are currently unusable:

- `credit_balances` has 0 rows.
- Confirmed mint events exist for major credits.

Mint-vs-balance examples from the stale/rebuild-local DB:

- WORK: 20,999 confirmed mint rows / 20,999,000 minted / 0 balance rows / 0 balance supply
- POWB: 465 confirmed mint rows / 630,196,569 minted / 0 balance rows / 0 balance supply
- POW: 151 confirmed mint rows / 1,525,100 minted / 0 balance rows / 0 balance supply
- AGENT: 24 confirmed mint rows / 240,000 minted / 0 balance rows / 0 balance supply

This does not prove the on-chain math is wrong. It proves the live projection is incomplete during the stalled rebuild and must not be rendered as truth. The API readiness gate is doing the right thing by returning 503.

## Read-only gates run

Production localhost gates:

- `npm run audit:ledger`: failed on `/api/v1/work-floor?fresh=1&network=livenet` with `503 CANONICAL_INDEX_UNAVAILABLE`
- `npm run audit:computer-events`: failed on `/api/v1/ledger-consistency?network=livenet` with 503
- `npm run audit:ids`: failed on `/api/v1/internal/id-registry-audit?network=livenet` with 503 after loading verifier env
- `npm run indexer:parity`: failed on `/api/v1/ledger-consistency?network=livenet` with 503 when run under the same Node 24 runtime as production

Local code/math gates:

- `check:bond-exact-arithmetic`: passed
- `check:work-precision-v2`: passed
- `check:incb-range-replay-witness`: passed

## Findings

### H8-01 Critical: canonical rebuild is blocked at the first missing INCB H-1 value snapshot

The active rebuild is stopped at block `957949` because the confirmed INCB transaction `dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4` at block `957950` requires a green canonical H-1 summary/value snapshot for block `957949`. That full snapshot is absent; only a `block-scan-partial` marker exists.

Impact:

- Fresh API reads fail closed.
- Ledger, event, ID, and parity audits cannot complete.
- The app cannot honestly claim that every event, address, ID, credit, and mempool status is current.
- The stalled point is before AMO V5/V8 sections, so later application surfaces are not verifiable from the current production index.

Continuity:

- This follows H7-02, but it is not the same finding. H7 found the canonical reorg/fault and required supervised recovery. H8 finds that the attempted recovery is active but blocked by missing H-1 value-snapshot proof at `957950`.

### H8-02 Critical: credit balance projection is empty while confirmed credit mint events exist

`credit_balances` has zero rows even though confirmed mint events exist for WORK, POWB, POW, AGENT, and other credits.

Impact:

- Credit holder/balance rendering would be false if any path bypasses readiness.
- Conserved credit balance math cannot be certified from the current production projection.
- Marketplace/credit/WORK balance dependent surfaces must remain fail-closed until balances are rebuilt and parity passes.

### H8-03 High: stored pending transaction statuses are stale

There are 37 stored pending transactions. Core says 31 are still unconfirmed and 6 are already confirmed.

Impact:

- Mempool status is not currently accurate for every transaction.
- The stale pending rows are a direct consequence of the worker no longer completing successful passes after `2026-09-11T00:13:39.129Z`.

### H8-04 Medium: UI backup retention remains the main UI disk risk

The UI VPS is not full today, but `/var/backups/proofofwork-ui` still consumes 16G on a 38G disk, and the automated release-prune unit remains failed/dry-run.

Impact:

- The exact failure mode from the prior UI-full incident is not active right now.
- The retention guard still is not self-healing.
- Cleanup is available, but it must be classification-backed so rollback evidence is not destroyed.

### H8-05 Medium: node `/data` storage warning continues

`/data` is 77% used with 362G free. The warning is not an emergency today, but the service health unit is failed and the largest non-chain cleanup candidates are substantial.

Cleanup candidates requiring explicit approval and classification:

- `/data/proofofwork-postgres-backups`: 168G
- `/data/proofofwork-audit5-restore-20260905T174233Z`: 21G
- `/data/proofofwork-audit5-restore-20260905T144615Z`: 18G
- `/data/proofofwork-audit5-safeguard-20260905T181729Z`: 11G
- `/data/proofofwork-release-backups`: 9.3G
- `/data/proofofwork-recovery`: 3.6G

No cleanup was performed.

## Recommended next actions

1. Keep production reads fail-closed. Do not treat stale summaries, empty credit balances, or stored pending rows as truth.

2. Repair the canonical recovery path under explicit approval. The repair should use the existing protected restoration/replay tooling, not manual SQL. The key decision is whether to restore the exact locked H-1 summary/value snapshot needed for `dd743...` or re-prepare the canonical PWT range replay with the correct verifier binding and witness manifest.

3. After repair, rerun:
   - `npm run audit:ledger`
   - `npm run audit:computer-events`
   - `npm run audit:ids`
   - `npm run indexer:parity`
   - direct SQL checks for `credit_balances`, pending statuses, duplicate events, ID counts, and summary snapshot eligibility

4. After the indexer is healthy, reconcile the six Core-confirmed transactions still stored as pending and verify the remaining 31 pending rows against current mempool state.

5. Classify and approve storage cleanup separately:
   - UI rollback/release backup pruning
   - node PostgreSQL backup retention
   - audit5 restore/safeguard/recovery directories

6. Only after production is green, reset or retire failed historical systemd units that are no longer actionable, while preserving audit evidence and manifests.

## Non-actions

- No files were deleted.
- No production config was edited.
- No database writes were performed.
- No repairs were run.
- No services were manually restarted.
- No deploy was performed.
- No secrets are recorded in this audit log.

## Ordered surface audit addendum

Date: 2026-09-12 13:08-13:20 UTC
Mode: read-only ordered render/API/full-node audit
Evidence files: `/tmp/pow-computer-audit-20260912/render-audit.json`, `/tmp/pow-computer-audit-20260912/computer-embedded-render-audit.json`, and matching desktop/mobile screenshots in that directory.

This addendum audited the surfaces in the exact requested order and then audited embedded `computer.proofofwork.me` folders. It reviewed the prior audit trail first, especially audit 5, audit 6, audit 7, and this audit's earlier H8 findings, so the findings below extend rather than duplicate the existing log.

### Current full-node-backed state

Direct Bitcoin Core RPC through the `bitcoin` service account at 2026-09-12 13:18 UTC:

- Blocks/headers: `966682`
- Best block hash: `000000000000000000019975f71e5b86ed6712fec3e4b1b212842a84d1d7e79c`
- IBD: false
- Pruned: false
- `txindex`, `coinstatsindex`, and basic block filter index: synced at `966682`
- Mempool: loaded, 27,219 transactions, 10,097,218 bytes

Public API health at 2026-09-12 13:20 UTC:

- `ok`: false
- `ready`: false
- `available`: false
- Core tip: `966683`
- Indexed through: `957949`
- Lag: 8,734 blocks
- Worker: `failed-retrying`
- Consecutive worker failures: 2
- Summary snapshot: not OK, height `0`

Conclusion: the full node is healthy and current; the ProofOfWork canonical index/read-model plane is not healthy or current.

### Current infrastructure/storage recheck

Node VPS:

- `/`: 98G total, 23G used, 71G free, 25% used
- `/data`: 1.7T total, 1.2T used, 362G free, 77% used
- Memory: 124Gi total, 115Gi available
- `proof_indexer`: 757 MB
- Invalid indexes: 0
- Waiting locks: 0
- Deadlocks: 0
- Unvalidated constraints: 0
- Active PostgreSQL replication clients: 0
- `pg_receivewal_service` physical slot: inactive, `wal_status=lost`, lag context about 47 GB
- `/var/lib/postgresql/16/main/pg_wal`: 97M
- `/var/backups/postgresql/16-main/wal`: 19G, 2,720 files

UI VPS:

- `/`: 38G total, 20G used, 17G free, 54% used
- Inodes: 3%
- Memory: 3.7Gi total, 3.2Gi available
- `caddy`: active
- `proofofwork-ui-release-prune.service`: failed on 2026-09-12 00:10 UTC, still dry-run/would-prune
- `/var/backups/proofofwork-ui`: 16G
- Largest UI backup subtrees: `rollbacks` 6.0G, `classified-rollback-roots` 3.6G, `rollback-classifications` 2.6G, `releases` 2.1G

No cleanup was performed.

### Current database/event/mempool recheck

Event and transaction counts:

- `transactions`: 25,126 confirmed, 221 dropped, 37 pending
- `events`: 23,629 confirmed valid, 298 confirmed invalid
- Largest valid event kinds: 21,826 `token-mint`, 493 `id-register`, 465 `infinity-bond`, 236 `token-create`, 170 `token-listing`
- `credit_balances`: 0 rows
- Latest block-scan snapshots around `957949` are still 814-byte partial payloads
- Older full seed snapshot at `959620` still exists, but it does not satisfy the current rebuild checkpoint at `957949`

Core comparison for the 37 DB-pending transactions:

- 31 still report 0 confirmations in Core
- 5 report 79 confirmations in Core
- 1 reports 125 confirmations in Core

This confirms H8-03 is still active.

### Ordered public surfaces

All pages loaded their static shell and production assets on desktop `1440x1000` and mobile `390x900`. The render harness found no horizontal overflow on the audited viewports. The data plane is unavailable across the chain-backed pages because production APIs return `503 CANONICAL_INDEX_UNAVAILABLE`.

1. `proofofwork.me`:
   - Page shell rendered.
   - Registry summary returned 503.
   - Good degraded behavior: clear canonical-index warning, counters withheld as ellipses instead of false zeros.

2. `id.proofofwork.me`:
   - Page shell rendered.
   - Registry summary returned 503.
   - Problem: while the registry API is unavailable, the page still renders `0 Confirmed IDs`, `0 Pending IDs`, `0 Visible records`, and `No registry records found yet`.

3. `desktop.proofofwork.me`:
   - Page shell rendered.
   - No chain-data fetch failed in the initial public route.
   - Initial public desktop state is static and does not claim chain-backed counts.

4. `browser.proofofwork.me`:
   - Page shell rendered.
   - No chain-data fetch failed before a txid is entered.
   - Initial state is static and does not claim chain-backed counts.

5. `amo.proofofwork.me`:
   - Boost listings and marketplace summaries returned 503.
   - Good degraded behavior: shows `AMO summary unavailable` and says the canonical registry, credit, listing, sale, and WORK snapshot could not be verified.

6. `credit.proofofwork.me`:
   - Token directory summary returned 503.
   - Mixed degraded behavior: the page says `Credit directory unavailable`, but the mint panel still renders `Amount 0`, `Mint price 0 proofs`, `Price 0 proof / TOKEN`, `USD/credit $0`, and `Your confirmed balance is 0`.

7. `wallet.proofofwork.me`:
   - Token and WORK floor endpoints returned 503.
   - Problem: the wallet renders `Credit types 0`, `Movements seen 0`, `No credit balance yet`, `No movements yet`, `Spendable 0 TOKEN`, and transfer/listing forms while credit data is unavailable.

8. `work.proofofwork.me`:
   - WORK summary and WORK floor endpoints returned 503.
   - Good degraded behavior: renders `WORK ledger unavailable` rather than false supply/floor values.

9. `infinity.proofofwork.me`:
   - Registry and Infinity summary endpoints returned 503.
   - Mixed degraded behavior: the page has a clear canonical-index warning and `Bond summary unavailable`, but wallet/create/market sections still render `POWB positions 0`, `Movements seen 0`, `No POWB balance yet`, and a create form with `1,000 POWB` despite the unavailable summary.

10. `inception.proofofwork.me`:
    - Registry and Inception summary endpoints returned 503.
    - Mixed degraded behavior: clear canonical-index warning and `Bond summary unavailable`, but wallet/create/market sections still render `INCB positions 0`, `Movements seen 0`, `No INCB balance yet`, and create/transfer panels with zero-like defaults.

11. `log.proofofwork.me`:
    - Log summary/history endpoints returned 503.
    - Good degraded behavior: renders `Log unavailable` and `Unavailable` totals.
    - Speed/data handling note: initial render issues duplicate log summary/history requests.

12. `growth.proofofwork.me`:
    - Growth summary endpoint returned 503.
    - Good degraded behavior: renders `Verified Growth ledger unavailable` and withholds totals.

13. `computer.proofofwork.me`:
    - Default inbox shell rendered with no initial chain API errors.
    - Problem: while the global canonical data plane is unhealthy, the default shell says `ProofOfWork Computer ready. Connect UniSat to load account data.` and renders side-folder counts such as `Inbox 0`, `IDs 0`, `AMO 0`, and local empty states. The wording is accurate only for the local wallet/shell, not for chain-data readiness.
    - Embedded folders mirror the public-surface results:
      - `?folder=ids`: registry 503 plus false `0 total registry records`.
      - `?folder=marketplace`: clear AMO unavailable state.
      - `?folder=token`: credit 503 plus false mint/balance zeros.
      - `?folder=wallet`: token/floor 503 plus false wallet zeros.
      - `?folder=work`: clear WORK unavailable state.
      - `?folder=infinity` and `?folder=inception`: clear global warning plus false wallet/position zeros.
      - `?folder=log`: clear log unavailable state, duplicate summary/history calls.
      - `?folder=inbox`, `?folder=desktop`, `?folder=browser`, and `?folder=contacts`: local shells render without a global canonical-data health banner, even when registry/API health is red.

### Addendum findings

#### H8-06 High: several unavailable data states render false zeros

This is distinct from earlier H5/H6 stale-data findings because it was reproduced during the current canonical rebuild outage on 2026-09-12. When the APIs return `503 CANONICAL_INDEX_UNAVAILABLE`, the following surfaces still render numeric zero or empty claims as if data had loaded:

- `id.proofofwork.me` and Computer IDs: registry counts and empty registry state
- `credit.proofofwork.me` and Computer Credit: mint amount, mint price, per-token price, USD/credit, confirmed balance
- `wallet.proofofwork.me` and Computer Wallet: credit types, movements, spendable token values, no-balance/no-movement messages
- `infinity.proofofwork.me` / `inception.proofofwork.me` and their Computer folders: wallet positions, movements, no-balance/no-movement messages, create/transfer defaults

Required fix after approval: add a UI data-availability contract so chain-backed values can render a number only after their source request returns successfully and is tied to a healthy canonical snapshot. Otherwise render `Unavailable` or `Unverified`, disable mutation forms, and hide derived math/price panels.

#### H8-07 High: Computer shell readiness is not tied to global canonical data readiness

The default Computer route can show `ProofOfWork Computer ready` with local empty counts while `/api/v1/health` is red. Local mail/contact/browser readiness and chain-data readiness need separate states.

Required fix after approval: make Computer read `/api/v1/health` or consume the same truth-plane availability state used by the standalone apps. Show a global degraded banner and replace chain-backed sidebar counts with `Unavailable`/ellipsis while canonical data is unavailable.

#### H8-08 Medium: duplicate initial data fetches slow degraded rendering and amplify 503 noise

The render audit observed duplicate or overlapping summary requests on several surfaces:

- Log: duplicate `log-summary` and `log-history`
- WORK: normal plus fresh `work-floor`, plus `work-summary`
- Wallet: token plus normal/fresh `work-floor`
- Infinity/Inception: registry plus summary, then fresh registry plus fresh summary
- AMO: boost listings, compact summary, and fresh compact summary

Required fix after approval: coalesce initial requests per endpoint/key, prefer one health-gated loader per surface, and only issue fresh retries from explicit user refresh or a bounded background refresh path. This is both a speed upgrade and a log-health upgrade.

#### H8-09 Medium: PostgreSQL WAL receive backup path needs classification

`pg_receivewal_service` is inactive and `lost`, replication clients are zero, and `/var/backups/postgresql/16-main/wal` contains 19G across 2,720 files. Primary `pg_wal` is only 97M, so this is not currently threatening database write availability, but it is a storage-retention risk and backup-health ambiguity.

Required fix after approval: classify the intended WAL backup policy, confirm whether the lost physical slot is still part of the recovery plan, then either repair the receivewal flow or retire the slot/archive material with an audit-backed deletion manifest.

### Addendum recommendations

1. Repair H8-01 first. Until the canonical index advances past `957949` and summary snapshots are green, no page can certify every event, address, ID, credit, listing, seal, balance, or mempool state.

2. Add the unavailable-state contract from H8-06 before relying on public surfaces during any future rebuild. False zero is more dangerous than a visible outage for this application.

3. Split Computer readiness into local shell readiness and canonical data readiness. Computer should be allowed to open while disconnected, but it must not look globally healthy when the full-node-backed data plane is red.

4. Coalesce data fetches and add health-aware loaders. This should reduce redundant 503s now and improve steady-state speed once the index is healthy.

5. After H8-01 repair, rerun the ordered surface audit from this addendum, then run the production ledger/event/ID/parity audits and direct Core pending reconciliation.

6. Classify storage cleanup separately. Current no-delete candidates are the UI backup tree, the node PostgreSQL backup/restore trees from H8-05, and the 19G PostgreSQL WAL archive path from H8-09.

### Addendum non-actions

- No files were deleted.
- No production config was edited.
- No database writes were performed.
- No services were restarted.
- No deploy was performed.
- No cleanup was performed.
- The only repo write was this approved audit-log addendum.

## Screenshot-reported bug triage addendum

Date: 2026-09-12 14:22 UTC
Mode: read-only screenshot/user-report verification plus this approved audit-log update
Evidence:

- `/home/sixer/Pictures/Screenshots/Screenshot from 2026-09-12 10-19-44.png`
- `/home/sixer/Pictures/Screenshots/Screenshot from 2026-09-12 10-20-35.png`

The attached screenshots were treated as evidence only. They contained no operative instructions; the operative instruction was the user's typed request to audit the two visible bugs and add them to this log.

### Screenshot 1: application-wide canonical index banner

Observed surface: `proofofwork.me`

Visible bug/report:

- `The canonical ProofOfWork index is rebuilding or no longer matches Bitcoin Core.`

Read-only verification:

- Public health: `ok=false`, `ready=false`, `available=false`
- Indexed through: `957949`
- Core tip at verification: `966686`
- Lag: 8,737 blocks
- Worker: `failed-retrying`
- Summary snapshot OK: false
- `registry-summary` returned HTTP 503 with `CANONICAL_INDEX_UNAVAILABLE`

Triage:

- This is a verified user-facing manifestation of H8-01, not a new independent root cause.
- The banner is truthful and should remain visible while the canonical index is unavailable.
- The underlying bug remains the stalled canonical rebuild/read-model plane.

### Screenshot 2: AMO summary unavailable banner

Observed surface: `amo.proofofwork.me`

Visible bug/report:

- `AMO summary Unavailable. The canonical ProofOfWork index is rebuilding or no longer matches Bitcoin Core.`
- AMO cards render withheld dash values and the main AMO panel says `AMO summary unavailable`.

Read-only verification:

- `marketplace-summary?compact=1&network=livenet` returned HTTP 503.
- Response code: `CANONICAL_INDEX_UNAVAILABLE`
- Indexed through: `957949`
- Core tip at verification: `966686`
- Lag: 8,737 blocks
- Rebuild active since `2026-09-11T12:30:16.794Z`
- Summary snapshot OK: false

Triage:

- This is also a verified user-facing manifestation of H8-01.
- AMO is failing closed instead of rendering unverifiable listings/sales as truth, which is the correct safety behavior while the index is unhealthy.
- It should still be tracked as a public AMO availability bug because users cannot view or purchase listings from a verified AMO summary until H8-01 is repaired.

### H8-10 High: screenshot-confirmed canonical outage banners block public app and AMO availability

The global canonical-index banner and AMO summary unavailable banner are related symptoms of the same production condition: the full node is current, but the ProofOfWork canonical index and summary snapshots are not available.

Impact:

- Home/public application experience shows an outage banner.
- AMO cannot display verified summary/listing/sale state.
- Purchases/listing-dependent actions must not proceed from unverifiable AMO state.
- This blocks the application from being presented as fully healthy, even though the static UI and full Bitcoin node are online.

Relationship to prior findings:

- Root cause: H8-01.
- False-zero related UI risk: H8-06.
- Computer global readiness copy risk: H8-07.
- This entry adds the user's screenshot-confirmed public evidence and AMO-specific availability impact without changing the root-cause classification.

Recommended fix order:

1. Repair H8-01 first so the canonical index advances beyond `957949` and summary snapshots become eligible again.
2. Re-run AMO summary/listing/seal/purchase verification against Core-backed index data.
3. Keep AMO fail-closed until marketplace summary, credit balances, listings, seals, sales, and WORK snapshot dependencies are all verified.
4. After H8-01 is repaired, verify that the global banner clears only when `/api/v1/health` is green and canonical summary snapshots are current.

### Screenshot triage non-actions

- No production changes were made.
- No database writes were performed.
- No services were restarted.
- No deploy was performed.
- No cleanup was performed.
- The only repo write was this approved screenshot-triage audit-log addendum.

## Approved canonical recovery implementation addendum

Date: 2026-09-12 15:44 UTC
Mode: user-approved production repair, local verification before deploy

This addendum continues H8-01 and H8-10. It does not open a new incident.

### Root cause refinement

The production canonical rebuild was blocked at block `957950` while verifying INCB transaction `dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4`.

Two conditions combined:

- The production database was missing the 18 protected pre-range INCB H-1 canonical summary oracle snapshots previously pinned by audit H8-05.
- After restoring those rows, the exact checkpoint reader still rejected their historical payload shape because the reader only admitted the newer Q8 `workAmountStorageModel` form. The restored rows contained agreeing legacy decimal WORK-value evidence and no modern model markers.

### Production data repair performed

Writers were stopped before the database repair:

- `proofofwork-worker-recovery-watch.timer`
- `proofofwork-indexer-worker.service`
- `proofofwork-api.service`

Before insertion, a production database backup was created and retained:

- `/var/lib/postgresql/proofofwork-incb-oracle-restore-20260912/proof_indexer-pre-incb-oracle-20260912T145255Z.dump`
- `/var/lib/postgresql/proofofwork-incb-oracle-restore-20260912/proof_indexer-pre-incb-oracle-20260912T145255Z.toc`

The 18 missing immutable oracle rows were exported from the retained audit restore cluster to:

- `/var/lib/postgresql/proofofwork-incb-oracle-restore-20260912/incb-oracle-18-stage.csv`

The guarded restore inserted exactly 18 rows and committed only after matching the audit H8-05 protected row hashes.

### Code repair implemented

The exact canonical summary reader now has a guarded legacy checkpoint path for requested historical H-1 reads only.

Behavioral constraints:

- Ordinary latest-summary reads remain on the modern exact Q8 `workAmountStorageModel` path.
- Legacy rows are eligible only for exact checkpoint requests.
- Legacy rows are rejected if any modern accounting-model marker is present.
- All available legacy decimal WORK-value aliases must agree after exact Q8 conversion.
- Any historical Q8 aliases that are present must match the converted decimal Q8 value.
- The normalized result publishes the same exact Q8/sats aliases expected by INCB value-snapshot verification.

This preserves math verifiability while allowing the restored protected oracle history to replay.

### Verification completed before deploy

Local verification passed:

- `npm run check:index-recovery-behavior` -> `505/505 behavior checks passed`
- `npm run check:incb-oracle-snapshot-restore` -> `{"checks":24,"model":"check-restore-incb-oracle-snapshots-v1","ok":true}`
- `npm run check:ui` -> passed
- `npm run build` -> passed
- `npm run check:surface-read-state` -> passed
- `npm run check:api-truth` -> passed
- `npm run check:live-data` -> passed
- `npm run check:worker-containment` -> passed

### Storage and deletion boundary

No backups, WAL archives, restore directories, staging CSVs, or storage candidates were deleted.

The following remain explicitly preserved until a separate deletion manifest is prepared and approved:

- PostgreSQL backup and restore trees from H8-05/H8-01 recovery work
- WAL archive material
- UI backup trees
- Any restore directories used to recover or verify protected oracle rows

### Remaining production step

Deploy the verified reader/API/UI recovery commit, restart the production API and worker, then verify that:

- The worker advances beyond `957950`.
- `/api/v1/health?network=livenet` returns a green canonical state.
- Public app and AMO banners clear only after canonical summary snapshots are current.
- AMO, wallet, credit, listing, seal, sale, WORK, INCB, and mempool surfaces render verified data rather than false zero or unavailable placeholders.

## Approved verifier-position recovery addendum

Date: 2026-09-12 15:23 UTC
Mode: user-approved production repair, post-deploy verification finding

After the protected H-1 oracle rows and legacy exact-checkpoint reader path were deployed, the original INCB snapshot-unavailable blocker cleared. The worker then reached the same confirmed transaction and failed closed on a new, narrower invariant:

- Transaction: `dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4`
- Block: `957950`
- Error: `Confirmed verifier item position is incomplete.`

Triage:

- The internal token verifier was correctly requiring a chain-bound protocol position.
- The historical synthetic INCB mint projection carried the correct block hash, block height, and block index, but it could lose the parent PWM OP_RETURN `protocolVout` and `recordOrdinal` while transforming the bond activity into a token-mint verifier item.
- This was not a math repricing issue. It was an incomplete proof-coordinate propagation issue.

Code repair implemented:

- PWM memo extraction now retains the positioned OP_RETURN entry used for mail/bond activity.
- Bond activity items preserve their canonical protocol coordinates.
- Derived INCB mint projections and invalid attachment dispositions inherit the exact bond protocol coordinates.
- Already-complete bound v2 INCB mint objects are returned by identity when their coordinates already match, preserving immutable replay behavior.

Additional verification completed:

- `npm run check:index-recovery-behavior` -> `505/505 behavior checks passed`
- `npm run check:api-truth` -> passed
- `npm run check:live-data` -> passed
- `npm run check:worker-containment` -> passed
- `npm run check:ui` -> passed
- `npm run check:incb-oracle-snapshot-restore` -> passed
- `npm run check:surface-read-state` -> passed
- `npm run build` -> passed

Storage and deletion boundary:

- No backups, WAL archives, restore directories, staging CSVs, or storage candidates were deleted.
- The node deployment backup created for the first recovery deploy is preserved at `/opt/proofofwork-api/backups/recovery-a7c2a63-20260912T150922Z`.

## Approved verifier-timeout hardening addendum

Date: 2026-09-12 15:35 UTC
Mode: user-approved production recovery hardening

Post-fix monitoring showed the worker advancing through the protected INCB oracle band, but cold confirmed verifier calls could exceed the old hardcoded `30,000ms` request budget. Those aborts were retryable and not deterministic math failures, but repeated aborts triggered longer worker retry delays and slowed canonical recovery.

Code hardening:

- Confirmed internal verifier recovery calls now use a bounded default `120,000ms` timeout.
- The timeout remains constrained to a `30,000ms` minimum and `300,000ms` maximum.
- Pending verifier calls keep their existing stricter pending timeout path.
- The confirmed timeout can be overridden for supervised recovery with `POW_INDEX_CONFIRMED_VERIFIER_TIMEOUT_MS` or a direct `confirmedVerifierTimeoutMs` option.

Verification:

- `npm run check:index-recovery-behavior` -> `505/505 behavior checks passed`
- `npm run check:live-data` -> passed

Deletion boundary:

- No backups, WAL archives, restore directories, staging CSVs, or storage candidates were deleted.

## Approved Q16 migration recovery addendum

Date: 2026-09-12 21:00 UTC
Mode: user-approved production canonical-index recovery, code repair, and
bounded production verification

This addendum continues H8-01, H8-06, H8-07, and H8-10. It does not duplicate
the earlier missing-INCB-oracle or verifier-position findings. The original
blocker at `957950` cleared, then production exposed a later Q16 precision
migration consistency deadlock.

### Root cause refinement

The app appeared broadly broken because the public API correctly failed closed
while the canonical ProofOfWork index was not eligible. The full node and
Electrum were current, but the index could not prove current summary state.

The new blocker was specific:

- The immutable WORK precision V2 migration marker existed and matched the
  canonical declaration boundary at block `960600`.
- The mutable WORK credit definition row was still in the old Q8 storage shape:
  `2100000000000000` max supply and `100000000000` mint amount.
- The worker had already advanced beyond the V8 activation boundary, so the
  migration tool refused to run because it expected the rebuild cursor to be
  exactly at `960600`.
- One historical pre-unit relic listing row was already absent because the
  current rebuild only retained the exact confirmed invalid event:
  `work-market-v2-canonical-oracle-unavailable`.

This was not a floating-point or repricing failure. It was an idempotency and
recovery-boundary mismatch between an immutable migration marker, a mutable
token definition row, and replay progress after activation.

### Code repair implemented

The WORK precision migration path now accepts only the exact safe recovery
shape:

- If the existing migration marker exactly matches the canonical completed Q16
  marker, the migration may repair Q8 mutable storage into Q16.
- If the rebuild cursor has advanced past the declaration boundary, the script
  verifies the pinned declaration block against Bitcoin Core and rewinds only
  the active canonical rebuild metadata to the declaration checkpoint.
- Derived activation-and-later snapshots are invalidated by the existing
  migration policy so the worker replays from the Q16 activation boundary.
- The pre-unit relic step is idempotent only when the mutable listing row is
  absent and the exact confirmed invalid event is present with the pinned
  block, index, vout, ordinal, listing id, token id, attempted kind, and reason.
- Any other marker, token, row, or event shape remains fail-closed.

The AMO V8 readiness latch now separates marker readiness from definition
readiness so the API can report the true migration state instead of collapsing
the condition into generic declaration evidence unavailability.

### Production recovery performed

Production backups were created before replacing migration scripts and are
preserved under `/opt/proofofwork-api/backups/`:

- `production-recovery-20260912T2038Z-q16-marker-storage-recovery`
- `production-recovery-20260912T2050Z-q16-ahead-boundary-rewind`
- `production-recovery-20260912T2106Z-q16-relic-idempotency`

The final deployed production runtime hashes match the repaired local files:

- `server/db/proof-index-reader.mjs`:
  `8cf63fb3f7d951300fdfb13ee3971c33a8790117eb28d51941853baae3beedf9`
- `server/proof-api.mjs`:
  `c9c711a14bff8a9c80bbdfb33bcad64cc1699de64bd47732c8103fc7f6433d8f`
- `scripts/backfill-proof-indexer.mjs`:
  `803cc2d683c0a6a042135d1efd5a481c3391a5c869fa9b0302c20f3803b7e652`
- `scripts/migrate-work-precision-v2.mjs`:
  `9fef243894c929116f38109bd75fb0e8441344d01e1c011d8ff98bdd22037da2`
- `scripts/run-proof-indexer-worker.mjs`:
  `2bcb92de33ec64942efbc50d331fd7943e74be28ac885cfb9683d971a838b053`

The supervised production dry run returned `ready-to-apply` with Q8 input
storage, exact declaration evidence at block `960600`, and the preserved
marker-bound balance/listing hashes. The approved production apply then
completed and changed the WORK definition to Q16 storage:

- Max supply subatoms: `210000000000000000000000`
- Mint amount subatoms: `10000000000000000000`
- Precision model: `canonical-work-subatoms-v2`
- Migration model: `canonical-work-q8-to-q16-migration-v1`

After restart, the worker began replaying from the Q16 boundary. At
`2026-09-12T20:58:29Z`, production health was still fail-closed but advancing:

- Core/electrum tip: `966718`
- Canonical index checkpoint: `960757`
- Lag: `5961` blocks
- Canonical fault: none
- Pending event health: green, zero unresolved global and Q16 pending events
- Summary snapshot eligibility: false until replay reaches tip
- Root filesystem: about `27%` used by `df -h`
- Node `/data`: about `77%` used by `df -h`
- API disk health: cache/data ok with about `399.5 GB` available

The worker crossed at least one post-boundary protocol transaction after the
Q16 repair without failing (`height=960692`, `indexed=1`, `protocolTxids=1`).

Two stale audit monitor shell loops were stopped because they were repeatedly
polling production API/DB every 25 seconds. Live services, backups, WAL
archives, and restore directories were not deleted or modified by that action.
The retained audit restore PostgreSQL clusters were observed and intentionally
left intact pending a separate deletion/retention manifest.

At `2026-09-12T21:03:58Z`, the first post-repair confirmed block-scan child
hit the existing `900000ms` wall-clock budget at block `960848`, just before
the configured `250` block chunk would have completed. Because the checkpoint
was still advanced and exact, this was a throughput/batch-boundary problem,
not a math failure. A scoped systemd drop-in was added and the worker was
restarted to set `POW_INDEX_BACKFILL_BLOCK_SCAN_MAX_BLOCKS=200`. The tracked
deployment template and live-data contract were aligned to the same value so
production does not drift from source. After restart, the worker resumed from
the latest checkpoint and advanced to `960908` by `2026-09-12T21:07:09Z`.

### Verification completed after the Q16 repair

Local verification passed after the final patch set:

- `node --check scripts/migrate-work-precision-v2.mjs`
- `npm run check:work-precision-v2`
- `npm run check:live-data`
- `npm run check:index-recovery-behavior` ->
  `510/510 behavior checks passed`
- `npm run check:work-amo-v8`
- `npm run check:worker-containment`
- `npm run check:api-truth`
- `npm run check:surface-read-state`
- `npm run check:ui`
- `npm run check:node-ops`
- `npm run check:hardening`

`npm run check:ui-ops` was started but remained silent for several minutes and
was stopped manually; do not count it as passed until it is rerun to completion
or given a bounded timeout.

### Current production verdict

The code and data repair for the known canonical recovery blockers is in
place, but the public application is not yet healthy. The app should continue
to show canonical-index unavailable states until the worker reaches the Core
tip and publishes eligible canonical summary snapshots. Do not clear banners,
enable write surfaces, or certify AMO/wallet/WORK/Growth/Log totals before
that exact-tip summary condition is true.

Next verification after replay reaches tip:

1. Confirm `/health` and `/api/v1/consistency?network=livenet&fresh=1` are
   green at the same Core tip and hash.
2. Run the ordered public surface audit again: home, ID, Desktop, Browser,
   AMO, Credit, Wallet, WORK, Infinity, Inception, Log, Growth, then Computer.
3. Run production ledger/event/ID/parity audits against the exact-tip
   checkpoint.
4. Verify AMO listings, sales, seals, wallet balances, spendable balances,
   ID ownership, credit balances, bond balances, and mempool statuses from the
   full node/index/API/UI surfaces.

Storage and deletion boundary:

- No backups, WAL archives, restore directories, staging CSVs, or storage
  candidates were deleted.
- Any future removal of backups, WAL archives, restore clusters/directories,
  deployment archives, retained audit evidence, or staging material still
  requires a separate deletion manifest and explicit approval.

## Approved exact-tip production recovery completion addendum

Date: 2026-09-13 05:51 UTC
Mode: user-approved production canonical-index recovery, code repair,
deployment, and verification

This addendum continues the Q16 recovery above. It records the final
exact-tip recovery work and does not duplicate the earlier Q16 migration,
INCB oracle, verifier-position, or worker-batch findings.

### Root cause completion

After the worker reached tip, production still exposed several fail-closed
unavailable states because the exact-tip summary validators were proving more
strict contracts than the rendered surfaces actually require.

The remaining issues were:

- AMO V5 legacy bootstrap accounting included a pre-unit raw relic carry and a
  canonical miner fee that overlapped by `1,208` proofs. The ledger needed to
  preserve the committed historical `N` while publishing valid-only
  marketplace flow.
- The pre-unit raw relic evidence did not explicitly mark that its canonical
  miner fee was already covered by normalized input/output totals, causing a
  later reconciliation path to treat all legacy carry as additive.
- Public Log history compared public rows to the full ledger activity count.
  The full summary had `ledgerActivityCount=25429`,
  `publicLogActivityCount=25428`, and `supplementalActivityCount=1`; the
  public Log page was correct at `25428`, but the validator was false-failing
  against the broader ledger total.

These were not floating-point math failures or node mismatches. They were
proof-envelope and public-surface contract mismatches around historical
bootstrap evidence and one non-renderable supplemental accounting row.

### Code repair implemented

- AMO V5 raw relic evidence now carries explicit canonical miner-fee coverage
  fields:
  `canonicalMinerFeeCovered=true`,
  `canonicalMinerFeeSats=1208`, and
  `minerFeeSource=proof-indexer-normalized-input-output-totals`.
- AMO V5 legacy bootstrap reconciliation now separates raw carry, effective
  carry, and overlap:
  `legacyBootstrapRawCreditFixedQ8=276200000000`,
  `legacyBootstrapCreditFixedQ8=155400000000`, and
  `legacyBootstrapCreditFixedOverlapQ8=120800000000`.
- Marketplace mutation fee consistency accepts the exact one-fee-per
  transaction model when canonical miner-fee coverage proves the fee is already
  counted.
- Listing activity projections carry canonical miner-fee details so AMO/WORK
  surfaces can prove the fee source instead of guessing.
- Public Log validators now compare full public history reads to the
  authenticated public-log count from the
  `canonical-activity-count-matches-public-log` consistency proof. The broader
  ledger total remains visible in `/api/v1/log-summary`.

### Production deployment

Two final node/API deployments were performed with backups preserved under
`/opt/proofofwork-api/backups/`:

- `production-recovery-20260913T0523Z-relic-fee-carry-accounting`
- `production-recovery-20260913T0528Z-legacy-credit-overlap`
- `production-recovery-20260913T0540Z-public-log-count-parity`

The final deployed hashes are:

- `server/proof-api.mjs`:
  `9852cb361bcd052922bacb3ef230d263b1d4481eb9392fd89addaa67a8d6e324`
- `server/db/proof-index-reader.mjs`:
  `748b00adc6c791297fbb6c6c1e37fa1ebfdc8f10bdcc1fcc0f3cf96cfe6e0391`

The previous live API file hash before the final deploy was preserved in the
backup directory:

- `822e1fd37044f9a4263d36a1f38f85b695c5c2913676e0c40b4131a7987629de`

### Verification completed

Local verification after the final patch set:

- `node --check server/proof-api.mjs`
- `node --check scripts/check-index-recovery-behavior.mjs`
- `npm run check:index-recovery-behavior` ->
  `513/513 behavior checks passed`
- `npm run check:work-amo-v5`
- `npm run check:live-data`
- `npm run check:worker-containment`
- `npm run check:work-precision-v2`
- `npm run check:work-amo-v8`
- `npm run check:surface-read-state`
- `npm run hygiene:fix`
- `npm run hygiene:check`

Production API/node verification after deploy:

- `/health` returned `ok=true`, `ready=true`, `available=true`,
  `indexedThroughBlock=966781`, `tipHeight=966781`, `lagBlocks=0`.
- Health proved node, Electrum, database, disk, index, and worker all ok.
- Canonical summary coverage keys all matched block `966781`:
  Growth, Inception, Infinity, Log, Marketplace, Token, WORK floor, and WORK
  summary.
- `/api/v1/consistency?network=livenet&fresh=1` returned `ok=true` at
  `indexedThroughBlock=966781`, `snapshotId=bd737a27c79c5145a5131d3e`.
- `/api/v1/log?network=livenet&limit=5` returned `totalCount=25428`,
  `indexedThroughBlock=966780`, with no error.
- `/api/v1/log?network=livenet&limit=5&fresh=1` returned
  `totalCount=25428`, `indexedThroughBlock=966781`,
  `snapshotId=bd737a27c79c5145a5131d3e`, with no error.
- `/api/v1/log-summary?network=livenet` returned `totalCount=25429` and the
  authenticated split:
  `ledgerActivityCount=25429`, `publicLogActivityCount=25428`,
  `canonicalActivityCount=25428`, `supplementalActivityCount=1`.
- `/api/v1/marketplace-summary?network=livenet&fresh=1` returned no error at
  `indexedThroughBlock=966781`, `snapshotId=bd737a27c79c5145a5131d3e`.
- `/api/v1/work-summary?network=livenet&fresh=1` returned no error at the same
  checkpoint, with `networkValueSats=8387576239637288248.64522713`,
  `marketplaceSaleVolumeSats=9400286`, and `tokenSaleFlowSats=9378286`.
- `/api/v1/token-summary?network=livenet&fresh=1` returned no error at the
  same checkpoint, with WORK confirmed supply `21000000`, pending supply `0`,
  and `holderCount=356`.

Post-commit production spot-check stayed green at `indexedThroughBlock=966781`,
`snapshotId=b5a586cf5eb11661e3dbf54e`: `/health` returned `ok=true`,
`ready=true`, `available=true`, `lagBlocks=0`, and worker
`proofReady=true`; fresh and stable public Log reads returned no error with
`publicLogActivityCount=25429`, `ledgerActivityCount=25430`, and
`supplementalActivityCount=1`.

Ordered production surface audit passed all 13 requested surfaces:

- `proofofwork.me`
- `id.proofofwork.me`
- `desktop.proofofwork.me`
- `browser.proofofwork.me`
- `amo.proofofwork.me`
- `credit.proofofwork.me`
- `wallet.proofofwork.me`
- `work.proofofwork.me`
- `infinity.proofofwork.me`
- `inception.proofofwork.me`
- `log.proofofwork.me`
- `growth.proofofwork.me`
- `computer.proofofwork.me`

`npm run audit:surfaces` returned `{"failed":[],"ok":true,"surfaces":13}`.
The browser-runtime surface scan also returned `ok=true`, HTTP `200` for all
13 surfaces, no page/console errors, and no visible hits for the prior outage
strings:

- `canonical ProofOfWork index is rebuilding`
- `no longer matches Bitcoin Core`
- `AMO summary unavailable`
- `WORK ledger unavailable`
- `Verified Growth ledger unavailable`
- `Log unavailable`
- `Credit balances unavailable`
- `Bond summary unavailable`
- `Boost history unavailable`

### VPS health and storage

Node/API VPS (`65.108.122.87`):

- `/`: `98G` size, `24G` used, `70G` available, `26%` used.
- `/data`: `1.7T` size, `1.2T` used, `353G` available, `78%` used.
- PostgreSQL database sizes:
  `proof_indexer=24 GB`, `postgres=7567 kB`, `template1=7567 kB`,
  `template0=7345 kB`.
- Active services:
  `bitcoind`, `electrs`, `postgresql@16-main`, `proofofwork-api`, and
  `proofofwork-indexer-worker`.
- Recent warning/error logs for `proofofwork-api` and
  `proofofwork-indexer-worker`: no entries in the sampled 15-minute window.

UI VPS (`77.42.91.106`):

- `/`: `38G` size, `20G` used, `17G` available, `54%` used.
- `caddy` active; `nginx` and `apache2` inactive.
- Recent Caddy warning/error logs: no entries in the sampled 15-minute window.

Stale failed systemd units remain listed from older audit, incident, recovery,
release-health, storage-health, and UI publish/prune jobs. They were not
cleared in this repair because clearing failed-unit state or pruning old
retention jobs is operational cleanup outside the approved no-deletion
boundary. Recommended follow-up: prepare a separate cleanup manifest for stale
failed unit state and any old release/audit job retention before taking action.

### Final verdict

Production is back to an exact-tip healthy state for the audited canonical
index, node, API, data summaries, and public UI surfaces. The original
application-wide unavailable banners were caused by fail-closed canonical
summary validation after the Q16/AMO recovery path, not by Bitcoin Core being
behind or UI VPS storage exhaustion.

The current remaining work is hardening, not emergency recovery:

- Add a permanent production runtime UI/string smoke check to CI/deploy.
- Add an alert for the public-log/ledger supplemental-count split so it remains
  explicit and never reappears as an unexplained off-by-one.
- Add alerts for node `/data` crossing `82%`, `85%`, and `90%` used.
- Create a separate deletion/retention manifest for stale failed unit state,
  old release artifacts, old audit jobs, and storage candidates.

Storage and deletion boundary:

- No backups, WAL archives, restore directories, deployment archives, retained
  audit evidence, or storage candidates were deleted.
- The only files removed during this addendum were temporary local runtime
  verifier scripts created during the current check and not used as backup,
  evidence, WAL, restore, or production data.
- Any future removal of backups, WAL archives, restore clusters/directories,
  deployment archives, retained audit evidence, or staging material still
  requires a separate deletion manifest and explicit approval.
