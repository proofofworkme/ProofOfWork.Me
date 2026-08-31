# ProofOfWork.Me Production Health, Data, Event, and Storage Audit

Date: 2026-08-30
Audit window: through about 2026-08-30T20:31Z
Mode: read-only production audit, followed by this approved local audit log
Status: public availability recovered green after audit load; strict verifiability gates partially failing

## Scope

This audit checked both production VPS hosts, public and loopback API health,
node health, log health, event coverage, database integrity, mempool status,
exact math contracts, rendered route shells/assets, and storage candidates that
may be stale, redundant, or wasteful.

No production files, production config, database rows, services, commits,
pushes, deploys, or cleanup actions were intentionally changed. This audit log
and its repository-hygiene classification were added only after explicit user
approval.

## Executive Summary

The confirmed chain, core API health, ledger consistency, event storage, and
exact math contracts are mostly healthy:

- Bitcoin Core is synced on mainnet at block `964782` during the direct node
  sample, is unpruned, not in initial block download, and has txindex,
  coinstats, and basic block filter indexes synced.
- The public API recovered to HTTP 200 green after the heavy audit workload:
  `/health`, `/health/live`, `/api/v1/consistency?network=livenet&fresh=1`,
  and `/api/v1/log?network=livenet&fresh=1` were all healthy at block
  `964783`.
- Public consistency was green with `missingLogEvents: 0`.
- Ledger exact audit, live data checks, computer-event DB audit, mail
  regressions, local API truth, hardening, node/UI ops, exact WORK precision,
  WORK AMO V8, bond arithmetic, INCB range replay witness, and local ID audit
  checks passed.
- Production DB integrity checks showed confirmed events covered by confirmed
  transaction rows, confirmed transaction block/raw metadata present, no
  negative confirmed credit balances, and pending DB transactions fully present
  in the Core mempool sample.

The strict verifier rails are not fully healthy and need follow-up before this
can be called all-green:

- Node `/data` is still in warning: 80% used with about 319G free. This is not
  yet critical, but the storage-health service intentionally fails above the
  75% warning threshold.
- Full marketplace regression fails because compact `marketplace-summary`
  still exposes 40 active legacy WORK listings from `pwt-sale-v1` and
  `pwt-sale-v2`. The complete token-history listings route sampled clean for
  V8, so this appears concentrated in the compact summary active book.
- Heavy production ID audit fails closed with:
  `ID audit transition chain is not contiguous at height 960601`.
- Full indexer parity exits nonzero with canonical summary snapshot,
  registry-history, token-state, marketplace lifecycle, and one WORK closed
  delist query currentness/parity failure.
- Node release health fails because the live checkout `.git/index` has mode
  `664`, and the node also exceeds the bounded release-checkout inventory.
- API/log health is green at rest, but the heavy audit produced a transient
  fail-closed 503 window from Core RPC/outspend timeouts and fresh token/credit
  endpoints. After cooldown, the same public endpoints returned green.

## Production Checkpoint

Latest healthy public checkpoint observed after cooldown:

- Public `/health`: HTTP 200, `ok: true`, `ready: true`.
- Public `/health/live`: HTTP 200, `ok: true`, `ready: true`.
- Indexed-through block: `964783`.
- Public consistency snapshot: `fae40fcede3a8b56244aba89`.
- Public consistency: `status: green`, `missingLogEvents: 0`.
- Public fresh log: total count `24588`, snapshot
  `fae40fcede3a8b56244aba89`.

Earlier route and summary checks at block `964776` also returned HTTP 200 for
health, live health, consistency, ledger consistency, fresh Log, Log history,
marketplace summary, work-floor, and growth summary.

## Verification Matrix

Passed:

- `npm run check:live-data`
- `npm run check:api-truth`
- `npm run check:hardening`
- `npm run check:node-ops`
- `npm run check:ui-ops`
- `npm run check:ui`
- `npm run check:work-precision`
- `npm run check:work-amo-v8`
- `npm run check:bond-exact-arithmetic`
- `npm run check:incb-range-replay-witness`
- `npm run check:id-audit`
- Production public `npm run audit:ledger`
- Production DB-backed `npm run audit:computer-events`
- Production public `npm run check:mail-regressions`
- Production rerun of `npm run check:credit-mint-regressions` after cooldown
- Public route-shell and entry-asset checks for `www`, `id`, `computer`,
  `amo`, `credit`, `wallet`, `work`, `infinity`, `inception`, `log`, `growth`,
  `desktop`, `browser`, and `boost`.

Failed or warning:

- Production `npm run audit:ids`
- Internal `/api/v1/internal/id-registry-audit`
- Internal `/api/v1/internal/id-registry-audit-fence`
- Production `npm run check:marketplace-regressions`
- Production full `MARKETPLACE_REGRESSION_MODE=full npm run check:marketplace-regressions`
- Production full `npm run indexer:parity`
- Node `proofofwork-node-storage-health.service`
- Node `proofofwork-node-release-health.service`
- Node `proofofwork-cache-prune.service` logs a failed main process because one
  configured optional cache path does not exist.

Transient under heavy audit load:

- First `npm run check:credit-mint-regressions` attempt failed on
  `/api/v1/token-summary?network=livenet&fresh=1` HTTP 503, then a direct
  token-summary recheck returned HTTP 200 and the rerun passed.
- Caddy and API logs showed a burst of 503s during the heavy audit window,
  mostly on fresh health/token/registry paths. The API recovered after Core RPC
  and outspend queue pressure cleared.

## Node and API Health

Host: `pow-bitcoin-01` (`65.108.122.87`)

Live services observed active:

- `bitcoind`
- `electrs`
- `postgresql@16-main`
- `proofofwork-api`
- `proofofwork-indexer-worker`
- `proofofwork-api-wg.socket`
- `proofofwork-api-wg.service`
- `pg_receivewal`

Direct Core state:

- Chain: `main`.
- Blocks: `964782`.
- Headers: `964782`.
- Best block hash:
  `000000000000000000010524f83835187ad682b90eb7fcc7f949b400d4a648af`.
- Initial block download: false.
- Pruned: false.
- Verification progress: `1`.
- Size on disk: `871926564947`.
- Indexes synced at height `964782`: `txindex`, `coinstatsindex`,
  `basic block filter index`.

Direct Core mempool state:

- Loaded: true.
- Size: `72471`.
- Bytes: `37523764`.
- Usage: `209672176`.
- Total fee: `0.06046884`.
- Max mempool: 2GB.
- Full RBF: true.
- Mempool min fee and incremental relay fee at the expected 1 sat/vB level.

Node resource sample at 2026-08-30T20:23:57Z:

- `/`: 98G size, 32G used, 62G available, 35% used.
- `/data`: 1.7T size, 1.3T used, 319G available, 80% used.
- `/data` inodes: 1% used.
- Memory: 124Gi total, 108Gi available.
- Swap: 15Gi total, 660Mi used.
- Journals: 690.7M.

Node service memory sample:

- `bitcoind`: ps RSS about 10.6GB; systemd MemoryCurrent reported about
  80.8GB for its cgroup/cache envelope.
- `electrs`: about 4.14GB.
- `postgresql@16-main`: about 19.1GB.
- `proofofwork-api`: about 3.77GB.
- `proofofwork-indexer-worker`: about 429MB.

Node failed units observed:

- `proofofwork-api-candidate-93f085b.service`: old/transient candidate failure.
- `proofofwork-node-release-health.service`.
- `proofofwork-node-storage-health.service`.
- `proofofwork-recovery-parity.service`.
- `proofofwork-recovery-snapshot.service`.
- `proofofwork-reorg-restore-20260826.service`.

The failed recovery/reorg services appear to be historical repair/audit jobs,
not active production serving paths, but they remain visible in systemd and
should be either resolved, archived with explanation, or reset only after an
explicit operations decision.

## UI VPS Health

Host: `77.42.91.106`

UI resource sample at 2026-08-30T20:23:56Z:

- `/`: 38G size, 15G used, 22G available, 41% used.
- Root inodes: 6% used.
- Memory: 3.7Gi total, 3.2Gi available.
- Swap: none configured.
- Journals: 242.9M.
- Failed units: 0.

Active services/timers observed:

- `caddy`
- `wg-quick@wg0`
- `proofofwork-ui-storage-health.timer`
- `proofofwork-ui-storage-prune.timer`
- `proofofwork-ui-release-provenance.timer`
- `proofofwork-ui-release-prune.timer`
- `logrotate.timer`

UI storage health was green with about 41% disk usage and about 22G free.
Release provenance repeatedly verified release id
`33c12c5a2a42-20260829T010316Z`, commit
`33c12c5a2a42a9afdd2d54195760f4f47fd1ca14`, and archive SHA
`4bde499dc508db72ba5b2738a52eba819b5e6cc3375442413ac10d7928bb53de`.

## Route and Render Health

Public app route shells returned HTML and their entry assets returned HTTP 200:

- `www.proofofwork.me`
- `id.proofofwork.me`
- `computer.proofofwork.me`
- `amo.proofofwork.me`
- `credit.proofofwork.me`
- `wallet.proofofwork.me`
- `work.proofofwork.me`
- `infinity.proofofwork.me`
- `inception.proofofwork.me`
- `log.proofofwork.me`
- `growth.proofofwork.me`
- `desktop.proofofwork.me`
- `browser.proofofwork.me`
- `boost.proofofwork.me`

Expected redirects were present:

- `proofofwork.me` redirects to `https://www.proofofwork.me/`.
- `marketplace.proofofwork.me` redirects to `https://amo.proofofwork.me/`.

All checked app shells used `cache-control: no-cache, must-revalidate`, and
their hashed entry JS assets loaded.

## Database and Event Health

Live PostgreSQL database footprint:

- Live database `proof_indexer`: 17GB.
- Largest historical/snapshot databases:
  - `proof_indexer_fault_reorg_20260826t2342z`: 26GB.
  - `proof_indexer_pre_rollback_current_20260825T140941Z`: 14GB.
  - `proof_indexer_fault_20260816t171442`: 14GB.
  - `proof_indexer_rollback_20260711_final`: 3545MB.
- Tablespace `proof_indexer_large_state_v1`: 70GB.

Largest live relations:

- `work_amo_block_transitions`: 16GB.
- `ledger_snapshots`: 808MB.
- `events`: 93MB.
- `transactions`: 69MB.
- `event_participants`: 47MB.
- `tx_outputs`: 41MB.
- `event_refs`: 26MB.
- `tx_inputs`: 19MB.
- `op_returns`: 17MB.

Live event and transaction aggregate counts:

- Transactions: 24,482 total, 24,228 confirmed, 175 pending, 79 dropped.
- Events: 25,083 total, 24,560 confirmed valid, 310 confirmed invalid.
- Event participants: 122,934.
- Event refs: 51,192.
- OP_RETURN rows: 24,351.
- ID records: 504 distinct rows, zero missing owners, zero missing receivers.
- Credit balances: 398, zero negative confirmed balances, zero nonzero pending
  deltas.
- Credit listings: 519.

Direct integrity checks:

- Confirmed events missing transaction rows: 0.
- Confirmed events without confirmed transaction rows: 0.
- Confirmed transactions missing block metadata: 0.
- Confirmed transactions missing raw transaction data: 0.
- Pending DB transactions missing from Core mempool: 0.

DB-backed `audit:computer-events` passed:

- Ledger status: green.
- Tip lag: 0.
- Missing log events: 0.
- Confirmed canonical action txids covered: 23,932.
- Confirmed computer actions: 24,559.
- Confirmed action transactions: 24,227.
- Confirmed events have transaction rows, confirmed transaction joins, raw
  tx/block metadata, and search relations.

Latest ledger snapshots sampled:

- `fae40fcede3a8b56244aba89`, block `964783`, generated
  `2026-08-30T20:28:01.989Z`, status green, missing 0.
- `9b7e8a36695a93ff9f6ea865`, block `964783`, status block-scan-current,
  missing 0.
- `fb4e1d5a586f739c8a3449f8`, block `964782`, status green, missing 0.
- `7345192e07f387e7800441a6`, block `964782`, status block-scan-current,
  missing 0.
- `ed6246fb0bcdd04d1dae08d7`, block `964781`, status green, missing 0.

## Math and Protocol Invariants

Exact arithmetic and local protocol contracts passed:

- `check:work-precision`: 131 checks, model `work-atoms-v1`, unit scale
  `100000000`, token id
  `d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8`.
- `check:work-amo-v8`: version `pwt-sale-v8`, allowed face proofs `[25000]`,
  amount field `unitAmountSubatoms`, precision model `work-subatoms-v2`,
  subatoms per WORK `10000000000000000`, network value scale `Q8`.
- `check:bond-exact-arithmetic`: passed.
- `check:incb-range-replay-witness`: passed with commitment
  `6967b8f747b57f1474e87c8b3d262e76ac9c1e7041a75dcd05a4c1a582d7e6e1`.

Ledger audit passed against production with exact value:

- `7466952437974660723.66697069` proofs.

Credit mint regressions passed after the transient 503 cleared:

- POW: `1,525,100 / 10,101,010` confirmed, pending `0`, available
  `8,575,910`.
- WORK: `21,000,000 / 21,000,000` confirmed, pending `0`.

## Mempool Status

The direct DB-to-Core mempool check was healthy:

- DB pending transactions: 175.
- Core mempool size at the comparison sample: 75,180.
- Pending DB transactions present in Core mempool: 175.
- Pending DB transactions missing from Core mempool: 0.

This supports the current pending status projection for database-tracked
transactions. Pending mempool data remains best-effort visibility, while
confirmed chain history remains canonical.

## Marketplace Findings

`check:marketplace-regressions` failed because compact marketplace summary
returned 40 active WORK listings that are not `pwt-sale-v8`.

Direct summary analysis:

- `marketplace-summary` block: `964777`.
- Snapshot: `c4baf7df35d8047d897c47da`.
- Consistency: green.
- Token listings total: 316.
- WORK listings: 315.
- Wrong legacy active WORK rows: 40.
- Active V8 sealed/sealing rows: 275.
- Legacy `pwt-sale-v1` unsealed rows: 20.
- Legacy `pwt-sale-v2` unsealed rows: 20.

Sample legacy listing txids exposed by the compact summary:

- `2862a5d8d66b4ee2ec5675cfebe1dbf9b5fcd74f825880f1c881a68c2a22ab8f`
- `e5ddefd60d9c3dc7433e68bb8450a21e0fc88232e999ff61762e9e30bed73eb3`
- `02529c1578296cb0dbda9fd1961ced0fbffd0936b00dcadeb4a258392bb09f6e`
- `5099463369b14de18a55f9caa27ee14f000a2832e9932f1f96800d288eb73c55`
- `53a9835681494fdb9371005f5234e9b69eabb4e8f278868c952af6a36800edd0`

The complete listings route looked cleaner in the sampled page:

- `/api/v1/token-history?kind=listings&asset=WORK&limit=500&fresh=1`
  returned `totalCount: 284`.
- The first 200 returned items were all V8, with no legacy listing rows in the
  sampled page.

Inference: the primary token-history listing view appears to be applying the V8
authority/lifecycle model, while the compact `marketplace-summary` active book
still admits historical V1/V2 WORK rows as active. That must be corrected
before marketplace rendered state can be considered fully accurate.

## ID Audit Findings

Lightweight local ID audit passed, and production mail/ID-backed route samples
were healthy:

- Mail registry source:
  `proof-indexer-current-id-events+proof-indexer-confirmed-id-records`.
- Mail registry records: 527.
- Sampled ID/address scans did not fail.

The heavy production ID audit failed closed:

- `npm run audit:ids` against loopback returned HTTP 503 from the internal ID
  audit endpoint.
- `/api/v1/internal/id-registry-audit?network=livenet` returned:
  `ID audit transition chain is not contiguous at height 960601`.
- `/api/v1/internal/id-registry-audit-fence?network=livenet` returned the same
  contiguity failure.

This is a strict verifier failure, not a proof that the public ID UI is
currently rendering incorrect records. It does mean the ID transition-chain
audit rail is red and needs focused repair or documented reconciliation.

## Indexer Parity Findings

Full production indexer parity remained red:

- Total checks: 102.
- Failed checks: 11.
- Warning checks: 8.
- Strict mode in the compact rerun summary: false.

Failed checks:

- `database-has-canonical-summary-snapshot`.
- `canonical-summary-snapshot-current`.
- `registry-history-listings-parity`.
- `registry-history-sales-parity`.
- `registry-confirmed-listings-semantic-parity`.
- `registry-confirmed-activity-semantic-parity`.
- `registry-payload-current-relational`.
- `token-state-current-relational`.
- `marketplace-token-state-lifecycle-present`.
- `work-token-state-current-relational`.
- `token-history-work-delist-closed-query-current-relational`.

Warnings:

- `work-amo-v5-migration`.
- `work-amo-v5-usd-quote-head`.
- `growth-summary-snapshot-parity`.
- `inception-summary-snapshot-parity`.
- `infinity-summary-snapshot-parity`.
- `marketplace-summary-snapshot-parity`.
- `work-floor-snapshot-parity`.
- `work-summary-snapshot-parity`.

This parity result does not contradict the green live consistency snapshot. It
means the deeper relational/currentness parity suite still finds stale,
missing, or non-current summary/state paths that must be reconciled for full
verifiability.

## Storage Candidates

No cleanup was performed.

Node storage candidates that require explicit retention and safety decisions:

- Historical PostgreSQL databases:
  - `proof_indexer_fault_reorg_20260826t2342z`: 26GB.
  - `proof_indexer_pre_rollback_current_20260825T140941Z`: 14GB.
  - `proof_indexer_fault_20260816t171442`: 14GB.
  - `proof_indexer_rollback_20260711_final`: 3545MB.
- `/data/proofofwork-postgres-backups`: 195G total, including logical,
  physical, recovery-evidence, prechange, and validation-evidence material.
- `/data/proofofwork-recovery`: 19G, including reorg/recovery evidence and a
  Q16 pending recovery archive.
- `/data/proofofwork-release-backups`: 8.1G, mostly managed release/rollback
  evidence.
- `/opt`: 8.6G, including the active checkout, retired/quarantined checkouts,
  and many stage/rollback directories that exceed bounded release inventory.
- `/data/proofofwork-api-cache`: 171M plus small/quarantined cache remnants.

Node active data that should not be treated as stale:

- `/data/bitcoin`: about 904G, active full-node data.
- `/data/electrs`: about 60G, active Electrs index.
- `/data/proofofwork-postgres-tablespaces`: about 70G, active PostgreSQL
  tablespace.
- `/data/mempool`: about 1.3G, active mempool data.

UI storage candidates that require explicit retention and release-provenance
decisions:

- `/var/tmp/proofofwork-deploy`: 5.3G of deploy scratch/source/surface
  material.
- `/var/tmp/proofofwork-ui-q16-v7-preactivation-a007263-final`: 183M retained
  by the UI storage prune as an unmarked cleanup candidate.
- `/var/backups/proofofwork-ui`: 5.2G of rollbacks, releases, rollback roots,
  cleanup evidence, and old release backups.
- `/var/www` old pre-rollback/current release roots: low total footprint, but
  candidates only after rollback/provenance approval.

## Recommendations

1. Treat node `/data` as an operational warning. Either approve a retention
   cleanup pass with exact targets, expand storage, or both before it approaches
   the documented critical line.
2. Fix compact `marketplace-summary` so active WORK listings obey the current
   V8 authority/lifecycle model and do not render historical V1/V2 unsealed
   rows as active.
3. Investigate the ID transition-chain contiguity failure at height `960601`
   with a focused audit around adjacent ID events and transition records.
4. Reconcile full indexer parity failures, especially canonical summary
   currentness, registry history, token state currentness, marketplace lifecycle
   presence, and the stale WORK closed-listing query at block `954224`.
5. Fix node release health by correcting the active checkout file mode and
   pruning or archiving excess release checkouts only after provenance review.
6. Fix the cache-prune unit so an absent optional `.pow-api-cache` path does
   not register as a service failure.
7. Consider lowering concurrency or isolating heavy production audits from
   public fresh endpoints. The system failed closed and recovered, but the 503
   burst shows the audit workload can compete with Core/outspend freshness.

## Bottom Line

Confirmed chain ingestion, ledger consistency, event persistence, mempool
tracking, and exact math checks are broadly healthy at the public checkpoint.
The application is not fully all-green: node `/data` storage is warning, strict
ID audit is red, full indexer parity is red, node release health is red, and
compact marketplace summary is rendering 40 legacy active WORK rows that should
not pass the current V8 active listing contract.

Until those red rails are repaired, production should be described as
available and mostly consistent, but not fully verified healthy across every
event, ID, address, credit, listing, and rendered state path.

## Requested Computer Surface-Order Audit - 2026-08-31T00:24Z to 01:05Z

Mode: read-only follow-up audit in the exact user-requested surface order. No
production files, production config, database rows, services, commits, pushes,
deploys, or cleanup actions were changed. Browser automation was attempted with
the in-app browser tool, but no browser instance was available, so this pass
used route shells, assets, production APIs, the node/API VPS, PostgreSQL, Core,
Electrs, logs, and local/regression verifiers.

### Full Node And System Checkpoint

Final public health checkpoint:

- `/health/live`: HTTP 200, `ok: true`, `ready: true`.
- Indexed-through block: `964809`.
- Tip height: `964809`.
- Public consistency: HTTP 200, `status: green`, `missingLogEvents: []`.
- Snapshot: `c453f9bd8b0c2f833911fcd0`.
- Summary coverage keys for growth, inception, infinity, log, marketplace,
  token, work-floor, and work summary all covered block `964809`.

Direct node sample:

- Bitcoin Core chain: `main`.
- Blocks and headers: `964806` during the initial direct sample, then public
  health advanced to `964809`.
- Initial block download: `false`.
- Pruned: `false`.
- Verification progress: `1`.
- `txindex`, `coinstatsindex`, and basic block filter index were synced.
- Core mempool sample: loaded, 62,472 transactions, about 36.9MB, full-RBF
  enabled.
- All 146 pending transactions sampled from PostgreSQL were present in Core
  mempool after correcting the shell variable escape.

Database integrity sample:

- Live database `proof_indexer`: about 17GB.
- Events: 25,089 total; confirmed valid events: 24,562; confirmed invalid
  protocol rows: 310.
- Transactions: 24,488 total; confirmed 24,230; pending 146; dropped 112.
- Confirmed events missing transaction rows: 0.
- Confirmed events linked to non-confirmed transactions: 0.
- Confirmed transactions missing block metadata: 0.
- Confirmed transactions missing both raw JSON and raw hex: 0.
- Confirmed transaction `raw_hex` is not populated, but all confirmed rows have
  normalized `raw_tx` JSON.
- Negative confirmed credit balances: 0.
- Nonzero pending credit deltas in sampled credit balances: 0.
- ID records missing owner or receiver: 0.

### Surface Results In Requested Order

1. `proofofwork.me` home page: HTTP 200, effective host
   `https://www.proofofwork.me/`, route shell and `index-IjBlYuBi.js` asset
   loaded. Fresh registry summary returned HTTP 200 at block `964807` with 527
   records, 5 listings, and 60 activity items.
2. `id.proofofwork.me`: HTTP 200, route shell and `index-zCVrjwMw.js` asset
   loaded. Fresh registry summary returned HTTP 200 at block `964807`. Strict
   internal ID audit remains red with
   `ID audit transition chain is not contiguous at height 960601`.
3. `desktop.proofofwork.me`: HTTP 200, route shell and `index-CEMA_OuX.js`
   asset loaded. Fresh registry summary returned HTTP 200. Mail regression
   checks passed for sampled inbox/sent/self-send/public-file cases.
4. `browser.proofofwork.me`: HTTP 200, route shell and `index-BDLx2UvE.js`
   asset loaded. Fresh log summary returned HTTP 200 at block `964807`, total
   count 24,590, consistency green, missing log events 0.
5. `amo.proofofwork.me`: HTTP 200, route shell and `index-BUicC0R2.js` asset
   loaded. Fresh compact marketplace summary returned HTTP 200 at block
   `964807`, with 318 token listings and 317 WORK listings. Regression failure:
   compact marketplace summary still exposes 40 active WORK listings that are
   not `pwt-sale-v8`.
6. `credit.proofofwork.me`: HTTP 200, route shell and `index-xCFxXBPi.js`
   asset loaded. Fresh compact token summary returned HTTP 200 at block
   `964807`. WORK showed confirmed supply `21000000`, pending supply `0`,
   decimals `16`, unit scale `10000000000000000`, and precision model
   `canonical-work-subatoms-v2`. Credit mint regression passed after readiness
   recovered.
7. `wallet.proofofwork.me`: HTTP 200, route shell and `index-CDKFOPOw.js`
   asset loaded. Sample wallet read for
   `18hkqE81wQuq75UEBKhB4JjAuQg47jN7Aa` returned authoritative wallet data,
   1 holder, 18 listings, 2 closed listings, 1 sale, 1 transfer, balance
   `0.9999999250969634` WORK, `0` pending delta, and 24 UTXOs. Wallet route is
   functional, but it depends on the same fresh-read readiness rail that briefly
   failed closed under load.
8. `work.proofofwork.me`: HTTP 200, route shell and `index-GkF_ZIny.js` asset
   loaded. Fresh work summary returned HTTP 200 at block `964807`, confirmed
   supply `21000000`, pending supply `0`, and exact floor network value
   `7466952437976470779.66914702` sats.
9. `infinity.proofofwork.me`: HTTP 200, route shell and `index-ClEmov-Y.js`
   asset loaded. Fresh infinity summary returned HTTP 200 at block `964807`;
   POWB confirmed supply `630196569`, confirmed bond actions 465,
   network value `630200391` sats, floor `1.00000606`.
10. `inception.proofofwork.me`: HTTP 200, route shell and `index-BUbRs50U.js`
    asset loaded. Fresh inception summary returned HTTP 200 at block `964807`;
    INCB confirmed supply `224847713398447926`, confirmed bond actions 46, and
    network value `224847713398447947.9358206` sats.
11. `log.proofofwork.me`: HTTP 200, route shell and `index-BL7TaRwE.js` asset
    loaded. Fresh log summary and log history returned HTTP 200, total count
    24,590, latest sampled event `token-listing-sealed` at block `964789`,
    consistency green, missing events 0.
12. `growth.proofofwork.me`: HTTP 200, route shell and `index-B6JMPHb3.js`
    asset loaded. Fresh growth summary returned HTTP 200 at block `964807`,
    confirmed computer actions 24,562, and growth/work floor values both
    `7466952437976470779.66914702` sats.
13. `computer.proofofwork.me`: HTTP 200, route shell and `index-CRlSYOpZ.js`
    asset loaded. Final `/health/live` recovered green at block `964809`, lag
    0, worker OK, node OK, database OK, disk OK, pending events OK.

All thirteen route shells shared the current production HTML shell and shared
CSS asset `index-Dv7zhNQh.css`; all entry assets returned HTTP 200. Route shell
latencies were generally about 0.4s to 1.1s. Fresh data reads were much slower:
registry summaries about 9.6s, marketplace compact about 16.1s, wallet token
about 9.4s, work summary about 10.1s, and log history about 9.5s.

### Math And Ledger Checks

Passed during this follow-up pass:

- `npm run check:ui`
- `npm run check:api-truth`
- `npm run check:hardening`
- `npm run check:work-precision`
- `npm run check:node-ops`
- `npm run check:ui-ops`
- `npm run check:work-amo-v8`
- `npm run check:bond-exact-arithmetic`
- `npm run check:incb-range-replay-witness`
- `npm run check:live-data`
- `npm run audit:ledger`
- `npm run check:mail-regressions`
- `npm run check:credit-mint-regressions` after worker readiness recovered

Important exact values observed:

- WORK confirmed supply: `21000000`.
- WORK pending supply: `0`.
- WORK decimals: `16`.
- WORK unit scale: `10000000000000000`.
- WORK precision model: `canonical-work-subatoms-v2`.
- WORK floor/network value: `7466952437976470779.66914702` sats.
- INCB issuance/accounting model:
  `canonical-pre-bond-live-network-value-v2`.
- Public consistency had `missingLogEvents: []` at the final checkpoint.

### Red Or Warning Findings

- Node `/data` is now 83% used with about 273G free. This is above the
  documented warning threshold and the storage health unit remains failed.
- The heavy audit briefly forced the API/worker into a fail-closed state:
  fresh credit/WORK lookups returned HTTP 503 while the index was one block
  behind, and worker logs showed
  `Pending-only WORK Q16 pass did not atomically publish one complete ready witness`.
  The worker recovered to green without intervention.
- Compact marketplace summary is still incorrect for current active WORK
  listing rendering: the regression found 40 active WORK rows that are not
  `pwt-sale-v8`. This is the clearest user-facing data-rendering bug in the
  requested surface list.
- Strict ID verifier remains red at height `960601`; public registry summaries
  are available, but the hard transition-chain audit is not all-green.
- Full indexer parity remains red: 11 hard failures and 8 warnings. Hard
  failures included canonical summary snapshot currentness, registry listings
  and sales parity, registry semantic parity, token state currentness,
  marketplace lifecycle presence, WORK token state currentness, and one stale
  WORK delist closed-query path at block `954224`.
- Caddy on the UI VPS is active and disk is healthy, but recent logs include
  reverse-proxy timeouts and one wallet broadcast POST ending in 502/EOF.
- Several fresh endpoints are too slow for a best-in-class wallet/application
  feel, especially marketplace, work, wallet, and log-history reads.

### Storage And Cleanup Candidates

No cleanup was performed. The following require explicit retention decisions
before removal:

- Node historical PostgreSQL databases:
  `proof_indexer_fault_reorg_20260826t2342z` about 26GB,
  `proof_indexer_pre_rollback_current_20260825T140941Z` about 14GB,
  `proof_indexer_fault_20260816t171442` about 14GB, and
  `proof_indexer_rollback_20260711_final` about 3.5GB.
- Node `/data/proofofwork-postgres-backups`: about 240G.
- Node `/data/proofofwork-release-backups`: about 8.1G.
- Node `/data/proofofwork-recovery`: about 3.6G.
- Node `/opt`: about 8.6G, including active, stage, rollback, retired, and
  quarantined API checkouts.
- UI `/var/backups/proofofwork-ui`: about 5.2G.
- UI `/var/tmp/proofofwork-deploy`: about 4.1G.
- UI `/var/tmp/proofofwork-ui-q16-v7-preactivation-a007263-final`: retained
  dated deployment/release material from 2026-07-31.

Active data that should not be treated as stale:

- Node `/data/bitcoin`: about 904G, active full-node chain data.
- Node `/data/electrs`: about 60G, active Electrs index.
- Node `/data/proofofwork-postgres-tablespaces`: about 70G, active PostgreSQL
  tablespace.
- Node `/data/mempool`: about 1.3G, active mempool data.
- UI `/var/www`: about 386M, active web roots and bounded release material.

### Follow-Up Recommendations

1. Fix compact marketplace active-book filtering first. Active WORK inventory
   should be current V8 only unless a historical route is explicitly requested.
2. Fix the strict ID transition-chain verifier around height `960601`, or
   document and encode the reconciliation if the public current state is
   intentionally different from the strict replay rail.
3. Reconcile full indexer parity until the deeper relational/currentness suite
   is green, not only the public fresh summary layer.
4. Harden the Q16 pending witness publish path so exact-tip fresh reads do not
   fail closed under normal audit/load bursts, or isolate heavy audits from the
   public freshness budget.
5. Start a storage-retention pass for node `/data` before it crosses 90%:
   review backup databases, PostgreSQL backup cadence, release backups,
   recovery archives, and old stage/rollback checkouts.
6. Precompute or cache the slow fresh read surfaces more aggressively, with
   exact snapshot identity preserved in the payload, so wallet, AMO, work, log,
   and registry pages render from verifiable data without 9s to 16s waits.
7. Add alerting for worker failed-retrying state, fresh 503 bursts, Caddy
   upstream timeouts, and `/data` runway, with separate thresholds for warning
   and critical pages.

## Local Fix Pass - 2026-08-31

Mode: local-only repository fix pass. No deployment, service restart,
production config change, storage deletion, commit, or push was performed.

### Local Fixes Prepared

- Compact AMO, marketplace, growth, and WORK summary reads now apply the
  current post-V8 WORK active-listing policy, so legacy `pwt-sale-v1` and
  `pwt-sale-v2` WORK sale rows are removed from current active inventory while
  remaining replayable as historical records.
- Strict ID audit transition-chain continuity now encodes the exact Q16
  precision boundary at height `960601` as a one-time, marker-bound state
  rebinding. The rebinding requires the V8 block sequencer model, the token
  state preimage model, exact activation height, exact migration marker, and
  equal opening/closing token commitments.
- Full index reader current ID listings now filter out sale-ticket listings
  whose anchor outpoints are already known spent in the index. The backfill
  block scanner was extended so future approved backfill/recovery passes can
  discover and persist external spends of ID sale-ticket anchors.
- Unpinned exact token marketplace txid reads now use current scan-bound
  relational coverage rather than stale snapshot cursors.
- Canonical summary storage defaults now match the production/documented
  envelope: 16 MiB compact payloads and 18 MiB SQL text payloads.
- Worker Q16 pending-readiness checks now use a bounded exact-audit retry
  wrapper. This keeps the readiness gate fail-closed, but reduces transient
  public 503 windows during audit/load bursts.

### Local Verification

Passed:

- `npm run check:id-audit`
- `npm run check:index-recovery-behavior` (`479/479` checks)
- `npm run check:api-truth`
- `npm run check:live-data`
- `npm run check:worker-containment`
- `npm run check:work-precision`
- `npm run check:hardening`
- `npm run check:node-ops`
- `npm run check:ui-ops`
- `npm run check:ui`
- `npm run hygiene:fix` reported no allowlisted rebuildable state found.

Known local verification gap:

- `npm run check:marketplace-regressions` requires a reachable API. The local
  run was blocked by no local API at `127.0.0.1:8081` and sandbox loopback
  denial (`connect EPERM 127.0.0.1:8081`), not by a regression assertion.

### Read-Only Production Snapshot

Captured at about `2026-08-31T02:11:00Z`:

- `https://computer.proofofwork.me/health/live` returned HTTP 200 in about
  `1.24s`.
- Health reported `ok: true`, node/electrum/index/worker/database all green,
  `indexedThroughBlock: 964812`, zero lag, txindex synced, and worker
  `proofReady: true`.
- Latest eligible canonical summary health snapshot was at block `964812`,
  payload size `10096098` bytes, snapshot
  `cb818fedcf6b07a6bc598f4e`.
- `https://computer.proofofwork.me/api/v1/marketplace-summary?network=livenet`
  returned HTTP 200 in about `15.21s`. This remains too slow for the target
  wallet/marketplace feel.
- Current production marketplace summary still exposes 40 active legacy WORK
  listings beside 277 active V8 WORK listings. The local fix should remove
  those legacy rows from current active rendering after approved deployment.
- UI VPS `/` was 37% used with 23G free and inode usage 5%.
- Node VPS `/` was 35% used with 61G free. Node `/data` was 83% used with
  273G free and inode usage 1%; this remains a warning, not a crisis.
- Active `proof_indexer` database size was about 17G.
- Largest retained historical PostgreSQL databases were
  `proof_indexer_fault_reorg_20260826t2342z` at 26G,
  `proof_indexer_pre_rollback_current_20260825T140941Z` at 14G, and
  `proof_indexer_fault_20260816t171442` at 14G.
- Current read-only backup/recovery footprints were about 568M for
  `/data/proofofwork-postgres-backups`, 356M for
  `/data/proofofwork-release-backups`, 3.3G for
  `/data/proofofwork-recovery`, and 6.5G for `/opt`.
- UI retained storage candidates remain about 5.2G at
  `/var/backups/proofofwork-ui`, 4.1G at `/var/tmp/proofofwork-deploy`, and
  183M at
  `/var/tmp/proofofwork-ui-q16-v7-preactivation-a007263-final`.

### Remaining Before Production Can Be Called Clean

1. Review and approve deploying the local fix set.
2. After deployment, approve a controlled service restart/reload if the deploy
   path requires it.
3. Approve a supervised read-only/full parity rerun against production,
   including marketplace regressions and proof-indexer parity.
4. Approve a carefully scoped backfill/recovery pass to persist the known
   externally spent ID sale-ticket anchor, then rerun registry parity.
5. Make explicit retention decisions before deleting old databases, backups,
   release archives, recovery directories, or deployment staging folders.
