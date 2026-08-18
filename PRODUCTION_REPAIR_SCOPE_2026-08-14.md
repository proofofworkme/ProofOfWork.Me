# Production Repair Scope - 2026-08-14

Status: local repair complete, production deploy approved. This file records
repair candidates found during the 2026-08-14 read-only production health audit,
the later user evidence batch, and the local repair scope approved afterward.

The original audit was read-only and explicitly deferred repair. The user later
approved local repair work for the combined audit scope, then approved commit,
production deployment, push, and production verification.

## Read-Only Audit Summary

- UI VPS `77.42.91.106` had current disk headroom: root filesystem about 60%
  used, about 15 GB free, inode usage about 7%.
- Node/API/DB VPS `65.108.122.87` had current disk headroom: root filesystem
  about 55% used and `/data` about 70% used with about 476 GB free.
- Follow-up disk check showed node root about 56% used, `/data` about 70% used,
  journal usage about 343 MB, UI root about 60% used, UI `/var/log` about
  442 MB, UI journal usage about 193 MB, and UI `/var/tmp/proofofwork-deploy`
  about 8.0 GB.
- Bitcoin Core, electrs, PostgreSQL, the public API, and the indexer worker
  were active.
- Core and electrs agreed at livenet block `962470`.
- Direct full-node verification later showed Bitcoin Core mainnet block and
  headers at `962489`, txindex/coinstats/block-filter indexes synced at
  `962489`, not pruned, not in initial block download, and no Core warnings.
- `/api/v1/consistency` and `/api/v1/ledger-consistency` were green at
  snapshot `18f230c308e419ac85f47561` with `missingLogEvents: []`.
- Follow-up consistency checks were green at block `962489`, snapshot
  `8eed5e1b0a22cf0c8a241542`, with `missingLogEvents: 0` and no failed
  checks. Ledger totals matched across growth/work actual/network values.
- Public surfaces responded successfully for `www`, apex, `id`, `computer`,
  `desktop`, `browser`, `amo`, legacy `marketplace`, `credit`, `wallet`,
  `work`, `infinity`, `inception`, `log`, and `growth`.
- `check:live-data`, `check:mail-regressions`, `check:marketplace-regressions`,
  `check:api-truth`, and `check:index-recovery-behavior` passed.
- Production `check:marketplace-regressions` and `check:mail-regressions`
  passed against `https://computer.proofofwork.me`.
- Production `check:work-participant-regression` failed on the confirmed WORK
  transfer listed below.
- Production browser UI regression pass returned 16 passed and 2 failed; both
  failures were wallet V8 AMO client/rendering semantics, not basic page
  availability.
- Database size was about 13 GB. The largest relations observed were
  `work_amo_block_transitions` at about 8.7 GB and `ledger_snapshots` at about
  3.8 GB.
- Mempool was loaded and optimal with about 67,105 transactions during the
  follow-up full-node check.

## Deferred Repair Candidates

1. Restore production health readiness.

   `https://computer.proofofwork.me/health` returned HTTP 503 because the
   worker pending-event readiness check was fail-closed. The healthy parts of
   the same payload included node, electrum, database, disk, canonical meta, and
   checked summary coverage. The failing branch was `worker.pendingEvents`.

   Observed log signals:

   - `PENDING_WORK_STAGE_BASE_COMMITMENT_INVALID`
   - `work-amo-v8-token-state-listing-invalid`
   - `Canonical WORK confirmed base failed the AMO V8 state commitment.`
   - Worker remained fail-closed until the Q16 pending WORK projection matches
     persisted pending transactions and the exact pending projection.
   - Follow-up worker logs showed confirmed Q16 replay ready at tip `962489`,
     but pending Q16 rebuild remained not ready with a 10 second pending
     backfill timeout.

2. Repair recipient wallet rendering or recovery for a confirmed WORK transfer.

   The transfer below rendered correctly in global token history and in the
   sender wallet, but not in the recipient wallet:

   - txid:
     `6ed13a1783d612dc1c1f692d2bd6e60c55f3bf88ead9352112a78931ea18852f`
   - sender:
     `bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed`
   - recipient:
     `18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW`
   - confirmed block: `956369`
   - amount: `300000` WORK
   - amount subatoms: `3000000000000000000000`

   Treat this as a wallet-scoped recipient recovery/rendering defect unless the
   follow-up audit proves a broader indexed-event defect.

   Follow-up full-node and database evidence narrowed the defect:

   - Core confirms the tx at block `956369` with one OP_RETURN.
   - Global token history returns the transfer.
   - Sender wallet returns the transfer.
   - Recipient wallet does not return the transfer.
   - `event_participants` includes both sender and recipient rows, including a
     `recipient` row for `18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW`.

   This points toward the wallet-scoped token read/recovery filter or response
   shaping, not missing chain data or missing participant indexing.

3. Correct confirmed, spendable, and listed credit balance rendering.

   User screenshots and follow-up API checks show that Wallet and Computer can
   display the full confirmed WORK balance as spendable even when a confirmed
   open listing reserves part of that balance.

   Evidence from `17W7JZ9KjjGUwdAyXeGxhzYe2vGe8YTRzA`:

   - Header/nav displayed `1.0000000000000000...` credit balance and did not
     show a separate listed/reserved balance.
   - Wallet body displayed `1.0000000000000000 WORK` spendable and
     `1.0000000000000000 confirmed`.
   - API wallet view returned one active listing for txid
     `07c9ca719adf7a7e94ff17c917e599e872ae1c0348f282219907c060a72b8043`.
   - Listing amount was `0.0000000752009741 WORK`
     (`752009741` subatoms), confirmed at block `962104`, active and valid.
   - Global log also returned the same tx as a valid confirmed `token-listing`.

   Repair expectation: the navbar/account strip should show confirmed credit
   balance, spendable balance, and listed/reserved balance distinctly. Spendable
   must subtract active listings and pending reservations everywhere the wallet,
   Computer shell, AMO, and send/list/seal flows rely on it.

4. Repair wallet V8 AMO browser/client regressions.

   Production browser UI regression pass returned 16 passed and 2 failed:

   - `wallet V8 AMO repair hides stale invalid rows and reserves spendable WORK`
     failed because `1.9999999247990259 WORK` matched three visible elements.
   - `wallet V8 AMO seal can retry during exact-tip catch-up` failed because
     the expected `.field-note.bad` text was absent; the same
     `work-amo-v8-precision-migration-not-ready` message appeared as a global
     alert instead.

   Treat these as UI/render semantics and test-or-accessibility targeting
   issues to reconcile with the intended wallet flow.

   User screenshot `CANT SEAL LISTING.png` adds a related live symptom:

   - The transfer log showed the active `07c9...` listing as
     `Attempted listing - confirmed tx - rejected credit event -
     work-market-v2-version-required - 546 registry + 0 miner = 546 proofs
     paid, not refunded`.
   - Follow-up API/log checks showed the same tx is a valid confirmed active
     V8 listing, so the UI appears to be mixing stale legacy rejection labeling
     with canonical V8 listing truth.
   - The visible wallet screen did not show the expected listing card or Seal
     action for that active listing.

5. Repair production storage and release guardrails.

   Current disk usage was safe, but the historical disk-full failure mode is not
   fully guarded:

   - UI `/var/tmp/proofofwork-deploy` was about 8 GB.
   - UI `proofofwork-ui-storage-prune.timer` was disabled or inactive.
   - UI `proofofwork-ui-release-prune.timer` was disabled or inactive.
   - UI release provenance health was failing with an active release provenance
     mismatch.
   - Node `proofofwork-node-release-health.service` was failing because the live
     node checkout was not detached.
   - Node release/cache prune timers were disabled or inactive.
   - Node `/opt` contained many retained `proofofwork-api.*` checkouts and
     backups.

   Any cleanup must be explicitly scoped before deletion. Preserve rollback,
   incident, release, audit, ledger, refund, and tx-backed evidence.

6. Improve production read performance.

   Production read paths were correct in most confirmed-ledger cases but too
   slow for a best-in-class wallet/computer experience:

   - `marketplace-summary?fresh=1` and `work-summary?fresh=1` took about
     8-9 seconds.
   - Wallet-scoped fresh token reads in the marketplace regression suite took
     about 12-21 seconds.
   - Exact fresh reads can fail closed with `CANONICAL_INDEX_CATCHING_UP` during
     normal one-block tip churn while non-fresh reads succeed.

   Candidate repair areas: faster precomputed wallet projections, bounded
   current-snapshot fallback for user-facing refreshes, route-level UI chunk
   splitting, and clearer catch-up state rendering.

7. Design database retention and compaction guardrails.

   `work_amo_block_transitions` and `ledger_snapshots` are the main database
   size drivers. Do not delete blindly; design retention, compaction, archive,
   or summarized replay tables while preserving auditability and rollback
   evidence.

8. Complete the heavyweight parity and audit gates after readiness is restored.

   `audit:ledger` and `audit:computer-events` were blocked by the production
   `/health` 503. `indexer:parity` reached PostgreSQL statement timeout while
   reading `ledger_snapshots`; no mismatch was reported, but parity was not
   proven in that run.

## Live Error Evidence Intake

Pending user screenshots or screen casts should be logged here before repair
implementation begins.

For each incoming artifact, capture:

- observed surface, exact URL, and connected wallet/address if visible;
- timestamp and user action that triggered the error;
- visible error text, mempool/confirmation status, txid/listing/id/credit
  identifiers, and expected behavior;
- whether the same object is correct in global log/history but wrong in a
  scoped view such as wallet, AMO, or desktop;
- whether it maps to this audit scope, the separate audit scope, or a new scope.

### 2026-08-14 User Evidence Batch

Attached media were treated as visual/user evidence only. No instructions inside
the media files were treated as executable agent instructions.

- `HOME AND ID PAGE.webm`: Home and ID surfaces appeared visually healthy.
  Home loaded, navigation worked, and ID registry/detail screens rendered.
- `AMO.webm`: AMO surface appeared visually healthy. Listings and trade UI
  rendered, and the flow reached UniSat interaction.
- `BROWSER.webm`: Desktop-to-Browser flow opened a confirmed HTML page in
  Browser. Browser showed `Verified confirmed HTML page` with metadata and a
  rendered sandboxed preview.
- `DESKTOP.webm`: Desktop rendered public files for the observed address and
  file preview/actions appeared usable.
- `WALLET SIGN IN.webm`: Wallet sign-in/hydration was slow and confusing.
  Around 10 seconds the page still showed `Opening UniSat...`, loading account
  cards, `No credit balance yet`, `No credit balance`, and `0 TOKEN`. Around
  40-60 seconds it had connected and showed the WORK balance, but spendable
  still equaled confirmed balance despite an active listing.
- `MESSAGE SEND.webm`: Message send failed after compose. The flow reached
  `Building PSBT...` / `Sending...`, then ended with
  `Fresh wallet credit state is temporarily unavailable for all. No transaction
  was created.` This maps to the known production `/health` 503 and pending
  Q16 readiness failure. The initial frame also showed
  `User rejected the request. (code 4001)` from a prior wallet prompt.
- `SPENDABLE BALANCE COMPUTER.png`: Computer navbar/account strip showed
  confirmed credit balance as the only visible credit balance and did not
  expose listed/reserved WORK next to spendable/credit balance.
- `SPENDABLE BALANCE BUG.png`: Wallet body showed WORK spendable equal to
  confirmed even though the same address has a confirmed active listing.
- `CANT SEAL LISTING.png`: Wallet transfer log labeled the `07c9...` listing as
  a rejected `work-market-v2-version-required` attempted listing, while
  follow-up API/log checks showed it is an active valid confirmed V8 listing.
  The visible UI did not present a Seal action for the active listing.

Follow-up read-only API checks for this batch:

- `token?asset=WORK&address=17W7JZ9KjjGUwdAyXeGxhzYe2vGe8YTRzA&wallet=1&fresh=1`
  returned HTTP 200 but took about 23 seconds.
- `token-history?asset=WORK&kind=listings&address=17W7...&fresh=1` returned
  the active `07c9...` listing but took about 63 seconds.
- `log?q=07c9...&fresh=1` returned the listing as valid confirmed.
- `health?network=livenet` still returned HTTP 503 at block `962491`; disk
  remained healthy and the failing branch was worker pending-event readiness.
- User-reported green surfaces for bond pages, log, and growth were checked
  again through summary endpoints. `infinity-summary`, `inception-summary`,
  `log-summary`, and `growth-summary` returned HTTP 200 at block `962491`.

## 2026-08-16 Read-Only Audit Addendum

Status: read-only audit complete. No production fix, restart, deploy, database
mutation, cleanup, commit, or push was performed. This addendum records the
second user-requested audit alongside the 2026-08-14 audit scope.

Audit order requested by the user:

1. `proofofwork.me`
2. `id.proofofwork.me`
3. `desktop.proofofwork.me`
4. `browser.proofofwork.me`
5. `amo.proofofwork.me`
6. `credit.proofofwork.me`
7. `wallet.proofofwork.me`
8. `work.proofofwork.me`
9. `infinity.proofofwork.me`
10. `inception.proofofwork.me`
11. `log.proofofwork.me`
12. `growth.proofofwork.me`
13. `computer.proofofwork.me`

### Critical Production Finding

The public app shell is available, but production data is not healthy. The
ProofOfWork canonical index is fail-closed because the database checkpoint no
longer matches Bitcoin Core after a one-block reorg at height `962722`.

Observed at about `2026-08-16T13:18Z` through `2026-08-16T13:28Z`:

- Bitcoin Core was healthy on mainnet: blocks, headers, and txindex all at
  `962737`; node was unpruned, out of IBD, and verification progress was `1`.
- Electrum reported the same tip hash and height as Core.
- The proof index checkpoint was at block `962722` with stored hash
  `00000000000000000001a7b86759d1ef4795cbebf29c2a480c2dd6db3c99c253`.
- Core reported block `962722` hash
  `00000000000000000001da4d083992144f9cd20883ca7b26132c6498ddc3f93d`.
- Database `proof_indexer.blocks` rows matched Core for heights
  `962715` through `962721`, then diverged at `962722`. The last common
  ancestor appears to be `962721`.
- `/health`, `/health/live`, `/api/v1/consistency`, and
  `/api/v1/ledger-consistency` were red with `CANONICAL_INDEX_UNAVAILABLE`.
- The API reported `broadcastReady: false`, `ready: false`, and
  `available: false`.
- The indexer worker repeatedly exited with
  `Canonical indexing is faulted; run a new supervised canonical rebuild.`
- Last successful Q16 worker proof was `2026-08-16T07:49:06.813Z` at block
  `962694`, snapshot `70c1cff1514de962aea7bf0f`.

This is the correct fail-closed safety behavior, but it is a live data outage.
Fresh and default reads for IDs, AMO, Credit, Wallet token data, WORK,
Infinity, Inception, Log, Growth, and Computer Log all returned HTTP `503`.

### Public Surface And UI Findings

- Every requested hostname loaded an HTML shell with HTTP `200`; the apex
  `proofofwork.me` redirected to `https://www.proofofwork.me/`.
- All audited hostnames served the same HTML hash and same hashed asset set:
  `assets/index-DdFGXGIm.js`,
  `assets/rolldown-runtime-QTnfLwEv.js`,
  `assets/react-CJuB4iyY.js`, and `assets/index-CALxGTBQ.css`.
- Document responses carried no-cache revalidation, HSTS, CSP, and COOP.
  Hashed assets were served with `public, max-age=31536000, immutable`.
- WORK showed a clear red canonical-index warning and a centered
  `WORK ledger unavailable` state instead of false floor/balance data.
- Growth hid live totals and showed `Verified Growth ledger unavailable`.
- Log showed the red canonical-index warning but also rendered `0` actions,
  `0` confirmed, `0` pending, and `0 B`; this can be mistaken for a true empty
  log.
- AMO rendered metric cards as `0` while backing APIs were HTTP `503`; this
  can be mistaken for an empty market rather than unavailable verified data.
- Credit, Wallet, Infinity, Inception, and embedded Computer data folders
  loaded shells but received HTTP `503` from their backing data endpoints.
- Desktop and Browser shells loaded without API errors until a user supplies a
  search address or txid.
- Default `computer.proofofwork.me` loaded without API errors in the unauthenticated
  default shell, but embedded IDs, AMO, Wallet, WORK, Infinity, Inception, and
  Log folders shared the same 503-backed data outage.

### VPS, Storage, Database, And Log Health

UI VPS `77.42.91.106`:

- Root filesystem was about `55%` used with about `17G` free.
- Inode usage was about `5%`.
- Memory pressure was low: about `3.1Gi` available.
- Caddy was active.
- `/var/www` was about `3.8G`, `/var/tmp/proofofwork-deploy` about `5.4G`,
  and `/var/log` about `440M`.
- Persistent journal usage was about `195M`; Caddy logs were about `4.1M`.
- `proofofwork-ui-storage-health.timer` and
  `proofofwork-ui-release-provenance.timer` were active.
- `proofofwork-ui-storage-prune.timer` and
  `proofofwork-ui-release-prune.timer` were inactive.
- `proofofwork-ui-release-provenance.service` was failing every 15 minutes
  with `Active UI release provenance mismatch: activity`.

Node/API/DB VPS `65.108.122.87`:

- Root filesystem was about `55%` used with about `43G` free.
- `/data` was about `71%` used with about `465G` free.
- Inodes were healthy: about `17%` on `/` and `1%` on `/data`.
- Bitcoin Core, electrs, PostgreSQL, public API, and indexer worker services
  were active.
- API health marked node, Electrum, database, and disk as healthy; index and
  worker were unhealthy because of the canonical checkpoint fault.
- Database size was about `14 GB`.
- Largest database relations were:
  `proof_indexer.work_amo_block_transitions` about `9456 MB`,
  `proof_indexer.ledger_snapshots` about `4300 MB`,
  `proof_indexer.events` about `137 MB`, and
  `proof_indexer.transactions` about `103 MB`.
- Pending database visibility at audit time: `34` pending transactions and
  `34` pending events. Several pending transaction rows were first seen in
  June 2026, and pending events included old July records.
- Dropped database visibility at audit time: `216` dropped transactions and
  `174` dropped events.
- Latest confirmed event max block was `962707`, with `24274` confirmed events.
- `/data/proofofwork-api-cache` was about `52M`.
- `/var/backups/postgresql` was about `40G`;
  `/data/proofofwork-postgres-backups` about `68G`; latest logical dump
  completed at `2026-08-16T03:24Z` and was about `6.75G`.
- Node journal usage was about `467M`; PostgreSQL logs were about `48M`.
- Query-health, storage-health, logrotate, basebackup, WAL compression, and
  logical-backup timers were scheduled.
- `proofofwork-node-release-health.service` failed because retained release
  archives had unsafe ownership/modes, missing checksum sidecars, or missing
  v2 provenance. It reported `archives=35`, `verified=21`, `unverified=14`,
  `current_provenance=0`, and `opt_checkouts=142`.

Storage was not the immediate outage. The active outage was the canonical
proof-index checkpoint mismatch.

### Read-Only Verification Results

Local repository contract checks passed:

- `npm run check:live-data`
- `npm run check:api-truth`
- `npm run check:hardening`
- `npm run check:node-ops`
- `npm run check:ui-ops`
- `npm run check:ui`
- `npm run check:work-precision`
- `npm run check:bond-exact-arithmetic`
- `npm run check:incb-range-replay-witness`
- `npm run check:index-recovery-behavior` (`449/449` behavior checks passed)

Production-facing gates failed because the live API returned HTTP `503`:

- `POW_API_BASE=https://computer.proofofwork.me npm run audit:ledger`
  failed at `/api/v1/work-floor?fresh=1&network=livenet`.
- `POW_API_BASE=https://computer.proofofwork.me npm run check:mail-regressions`
  failed because registry returned HTTP `503`.
- `POW_API_BASE=https://computer.proofofwork.me npm run check:marketplace-regressions`
  failed on `/api/v1/ids/carbonz?network=livenet`.
- `POW_API_BASE=https://computer.proofofwork.me npm run check:work-participant-regression`
  failed on `/api/v1/ids/inception?network=livenet&current=1&fresh=1`.
- `POW_API_BASE=https://computer.proofofwork.me npm run audit:computer-events`
  could not run locally without production database credentials.

### Proposed Follow-Up Fixes

These are proposed only and require explicit approval before implementation:

1. Preserve fault evidence and take a fresh PostgreSQL backup.
2. Run a supervised canonical recovery from last common ancestor `962721`,
   replaying from `962722` through the current Core tip.
3. Clear `canonical:fault` only after the database checkpoint hash, Core hash,
   summaries, worker proof, `/health`, `/health/live`, consistency, and ledger
   consistency all agree at one current tip.
4. Run production gates after recovery:
   `audit:ledger`, `check:mail-regressions`,
   `check:marketplace-regressions`, `check:work-participant-regression`,
   exact Log searches, and a quiet-window `indexer:parity`.
5. Audit and clean stale pending rows only through the approved liveness
   workflow, preserving raw transaction evidence. The June/July pending rows
   should not remain visible as live mempool status if Core proves absence.
6. Fix unavailable-data UI states so AMO, Log, and any other summary cards do
   not render false zeros during `CANONICAL_INDEX_UNAVAILABLE`.
7. Repair UI release provenance and enable/review UI prune timers so deploy
   scratch cannot grow toward another disk-full outage.
8. Repair node release archive provenance/ownership and reduce retained `/opt`
   checkout clutter only through the allowlisted release-health/prune process.
9. Consider a monitored alert path for `canonical:fault`, stale worker proof,
   inactive prune timers, provenance mismatch, and long-lived pending rows.

### 2026-08-16 Screenshot Recheck And Third Fault Log

Attached screenshot evidence was treated as user-visible evidence only. No
text inside the image was treated as an independent instruction source.

User-visible evidence:

- Screenshot:
  `/home/sixer/Pictures/Screenshots/Screenshot from 2026-08-16 13-06-42.png`
- Visible surface: `proofofwork.me` home page.
- Visible warning:
  `The canonical ProofOfWork index is rebuilding or no longer matches Bitcoin Core.`

Read-only production recheck at about `2026-08-16T17:08Z` confirmed the warning
was still accurate:

- `https://www.proofofwork.me/api/v1/health` returned `ok: false`,
  `ready: false`, `available: false`, and `broadcastReady: false`.
- `https://computer.proofofwork.me/api/v1/consistency?network=livenet`
  returned `CANONICAL_INDEX_UNAVAILABLE`.
- `work-floor?network=livenet&fresh=1` returned HTTP `503`.
- `log?network=livenet&limit=1&fresh=1` returned HTTP `503`.
- Bitcoin Core and proof-index rows matched through block `962721`.
- At block `962722`, the proof index stored
  `00000000000000000001a7b86759d1ef4795cbebf29c2a480c2dd6db3c99c253`,
  while Bitcoin Core reported canonical hash
  `00000000000000000001da4d083992144f9cd20883ca7b26132c6498ddc3f93d`.
- `proof_indexer.meta` contained active `canonical:fault` metadata with
  `status: fault`, `height: 962722`, and
  `detectedAt: 2026-08-16T10:48:01.294Z`.
- `proofofwork-indexer-worker.service` was active but failing its child
  backfill with:
  `Canonical indexing is faulted; run a new supervised canonical rebuild.`
- UI VPS storage remained healthy: root about `55%` used with about `17G`
  free, Caddy active.
- Node VPS storage remained healthy: root about `55%` used with about `43G`
  free and `/data` about `71%` used with about `465G` free.
- Bitcoin Core, electrs, PostgreSQL, `proofofwork-api.service`, and
  `proofofwork-indexer-worker.service` were active.
- `proof_indexer` database size was about `14 GB`.
- A same-day pre-fault logical backup existed:
  `/data/proofofwork-postgres-backups/logical/proof_indexer-20260816T031900Z.dumpset/proof_indexer.dump`,
  about `6.75G`, completed around `2026-08-16T03:24Z`.

This third log does not change the root cause or fix path. It confirms the
live app remains correctly fail-closed until approved canonical recovery is
performed and verified.

## 2026-08-16 Production Canonical Recovery Completion Log

Status: supervised production canonical recovery completed after explicit user
approval. No UI/API source deploy was required for this recovery; the production
repair was database/service recovery plus evidence logging.

Recovery evidence directory on the node VPS:

- `/data/proofofwork-recovery/20260816T1714-canonical-reorg`

Production recovery actions:

1. Stopped `proofofwork-indexer-worker.service` and `proofofwork-api.service`.
   The API was being reactivated by `proofofwork-api-wg.service` and
   `proofofwork-api-wg.socket`, so all four units were temporarily runtime
   masked for the recovery window.
2. Captured systemd/config/service evidence into the locked recovery directory.
3. Took a fresh fault-state logical PostgreSQL backup:
   `/data/proofofwork-postgres-backups/logical/proof_indexer-20260816T171442Z.dumpset`.
4. Verified checksums for both the pre-fault dump
   `proof_indexer-20260816T031900Z.dumpset` and the fresh fault-state dump.
5. Restored the verified pre-fault dump into shadow database
   `proof_indexer_reorg_recovery_20260816t1724`.
6. Verified the shadow database had no active `canonical:fault` row and was
   indexed through block `962666` with hash
   `000000000000000000002b21d6fefef0f635ffcca6225824d430cdbb8cd0fb1a`,
   matching Bitcoin Core at the same height.
7. Promoted the shadow database into the production `proof_indexer` name and
   preserved the faulted database as
   `proof_indexer_fault_20260816t171442`.
8. Moved derived API cache contents under the recovery evidence directory before
   restart.
9. Restarted the API, then the indexer worker. The worker replayed blocks
   `962667` through `962767`.
10. Re-enabled `proofofwork-api-wg.socket` and `proofofwork-api-wg.service`
    after local health was green.

Final canonical state:

- Bitcoin Core tip: block `962767`, hash
  `00000000000000000001fe0b4091ce82d8ed3c0cc034c6ca07d86c7e8eab8ff8`.
- Production proof index checkpoint: block `962767`, hash
  `00000000000000000001fe0b4091ce82d8ed3c0cc034c6ca07d86c7e8eab8ff8`.
- `canonical:fault` rows in production: `0`.
- Local `/api/v1/health`: `ok: true`, `ready: true`, `available: true`,
  `lagBlocks: 0`.
- Public `https://computer.proofofwork.me/api/v1/health`: `ok: true`,
  `ready: true`, `available: true`, `lagBlocks: 0`.
- Public consistency and ledger consistency returned `ok: true`.
- Fresh WORK floor and Log reads returned data at checkpoint `962767`.

Final VPS health:

- Node/API/DB VPS `65.108.122.87`: all core services active
  (`proofofwork-api`, `proofofwork-api-wg.socket`,
  `proofofwork-api-wg`, `proofofwork-indexer-worker`, `bitcoind`,
  `electrs`, PostgreSQL). Root was about `56%` used with about `42G` free;
  `/data` was about `72%` used with about `439G` free. Production
  `proof_indexer` and preserved `proof_indexer_fault_20260816t171442`
  were each about `14 GB`.
- UI VPS `77.42.91.106`: Caddy and UI health/provenance timers were active.
  Root was about `55%` used with about `17G` free; inode usage about `5%`;
  memory pressure low. `proofofwork-ui-storage-prune.timer` and
  `proofofwork-ui-release-prune.timer` remained inactive, and old failed UI
  deploy/provenance units remained present as follow-up operations debt.

Post-recovery verification passed:

- Public host checks: `proofofwork.me` redirected to
  `https://www.proofofwork.me/`; all requested hostnames returned HTTP `200`.
- `POW_API_BASE=https://computer.proofofwork.me npm run audit:ledger`
  passed with snapshot `569527f737404f31b1353db8`.
- `POW_API_BASE=https://computer.proofofwork.me npm run check:mail-regressions`
  passed.
- `POW_API_BASE=https://computer.proofofwork.me npm run check:marketplace-regressions`
  passed.
- `POW_API_BASE=https://computer.proofofwork.me npm run check:work-participant-regression`
  passed.
- Production-node `audit:computer-events` passed with `48` checks, `0`
  failures, and `0` warnings.
- Production-node default `indexer:parity` exited `0`. It retained warning
  notes for `work-amo-v5-migration` and `work-amo-v5-usd-quote-head` with
  reason `migration-not-complete`.
- Local contract gates passed:
  `check:live-data`, `check:api-truth`, `check:hardening`, `check:node-ops`,
  `check:ui-ops`, `check:ui`, `check:work-precision`,
  `check:bond-exact-arithmetic`, `check:incb-range-replay-witness`, and
  `check:index-recovery-behavior` (`449/449` behavior checks passed).
- Exact transaction and Log spot checks passed for representative sale,
  transfer, ID registration, and WORK transfer txids. Each checked transaction
  resolved as confirmed and appeared in exact Log history at checkpoint
  `962767`.

Non-blocking follow-up observations:

- A stricter diagnostic parity run with fresh history/snapshot/token flags
  exited non-zero. It is preserved as evidence and should be triaged before
  making strict/fresh parity a required production gate. Reported strict
  failures were registry-history parity categories, current relational token
  state, marketplace token-state lifecycle presence, plus the existing
  warning-severity WORK AMO V5 migration/USD quote readiness items.
- The preserved fault database
  `proof_indexer_fault_20260816t171442` should be retained only as long as
  needed for incident review, then retired through an approved cleanup.
- UI prune timers, UI release provenance failures, node release archive
  provenance/ownership, retained release checkout clutter, stale pending-row
  liveness, and clearer unavailable-data UI states remain proposed follow-up
  hardening work.

## Required Verification After Repair

Run the combined post-audit scope through the production gates before calling
the repair complete:

- `https://computer.proofofwork.me/health`
- `https://computer.proofofwork.me/health/live`
- `/api/v1/consistency?network=livenet`
- `/api/v1/ledger-consistency?network=livenet`
- `npm run check:live-data`
- `POW_API_BASE=https://computer.proofofwork.me npm run check:mail-regressions`
- `POW_API_BASE=https://computer.proofofwork.me npm run check:marketplace-regressions`
- `POW_API_BASE=https://computer.proofofwork.me npm run check:work-participant-regression`
- `POW_API_BASE=https://computer.proofofwork.me npm run audit:ledger`
- `POW_API_BASE=https://computer.proofofwork.me npm run audit:computer-events`
- `npm run indexer:parity` against the production database in a quiet window or
  with an explicitly approved statement-timeout adjustment.

## Scope Boundary

Do not implement this file directly in isolation. First complete the separate
audit requested by the user, merge the findings into a single proposed repair
scope, then ask for explicit approval before making production changes.

## Local Repair Completion Log

Local repair was completed under the approved combined audit scope before
production deployment.

Implemented repairs:

- Wallet-scoped token reads now backfill exact holder rows from indexed holder
  history when an address-scoped wallet payload has listings/transfers but no
  holder row.
- Wallet and Computer account strips now render confirmed credit, spendable
  credit, and listed/reserved credit separately.
- Wallet balances now subtract active listing reservations from spendable
  credit displays.
- A confirmed active listing suppresses a stale invalid listing echo such as
  `work-market-v2-version-required` for the same token/listing txid.
- Listing seal failures are rendered beside the listing row, so a retryable
  exact-tip or readiness failure is not hidden as only a global alert.
- Proofs-only mail keeps send preparation independent from fresh WORK wallet
  catch-up, while positive WORK attachments still require strict fresh wallet
  authority.
- Wallet sign-in paints current authoritative WORK state first, then refreshes
  fresh wallet authority in the background.
- Backfill event-relation ordering now uses canonical UTF-8 comparison instead
  of locale-sensitive `localeCompare`.

Local verification completed before deploy approval:

- `npm run check:ui`
- `npm run build`
- `npx playwright test --config playwright.ui.config.mjs tests/browser/mail-compose.spec.mjs`
- `npm run check:live-data`
- `npm run check:index-recovery-behavior`
- `npm run check:api-truth`
- `npm run check:hardening`
- `npm run check:node-ops`
- `npm run check:ui-ops`
- `npm run check:worker-containment`
- `npm run check:server-globals`
- `npm run check:client-read-containment`
- `npm run check:canonical-order`
- `npm run hygiene:fix`
- `npm run hygiene:check`
- `git diff --check`

Local-only blocked checks:

- `npm run check:mail-regressions` and
  `npm run check:send-prep-regressions` require production API/DNS access.
- `npm run check:marketplace-regressions` requires a live API target.

These are production-verification gates after deploy, not local code failures.

## Production Canonical Summary Recovery Log - 2026-08-16 15:43 ET

User-facing symptom:

- `amo.proofofwork.me` still showed
  `The canonical ProofOfWork index is catching up to the Bitcoin Core tip.`
- The AMO exact-tip banner reported last-good summary block `962768`,
  canonical scan checkpoint `962773`, and full-node tip `962774` while the
  visible AMO book still rendered pending and confirmed sale-ticket rows.

Fresh production evidence:

- The node/API/DB VPS was not disk-full. Root was about `56%` used with about
  `42G` free; `/data` was about `72%` used with about `439G` free.
- The UI VPS was not disk-full. Root was about `55%` used with about `17G`
  free and low memory pressure.
- `bitcoind`, `electrs`, PostgreSQL, `proofofwork-api`, and
  `proofofwork-indexer-worker` were active on the node VPS.
- The production database `proof_indexer` was about `14 GB`. Largest relations
  were `proof_indexer.work_amo_block_transitions` at about `9.6 GB` and
  `proof_indexer.ledger_snapshots` at about `4.1 GB`.
- Bitcoin Core and the proof-index checkpoint were able to reach the same tip,
  but canonical summary publication failed because one pending token-state
  projection was present in ledger activity before it was admissible through
  public Log membership.
- Representative pending seal tx
  `e89bab27e511d8c0d8a6da897db666a095c169fe7cd4311da5eadfe23dc7c8e1`
  was indexed as pending `token-listing-sealed` for listing
  `e7a130c79cbabade61f202dbb1f1b2d3e1cda8d7b98f06da31b5d9a83db049e6`,
  protocol vout `1`, record ordinal `0`.

Root cause:

- The canonical summary gate correctly rejected a count mismatch between
  public Log activity and canonical ledger activity.
- Confirmed activity matched, but pending activity was off by one:
  token-state pending projection could outrun the public Log boundary during a
  fresh exact-tip summary build.
- This made the app fail closed with a catch-up banner even after Core and the
  database checkpoint were current.

Implemented repair:

- Canonical ledger summary construction now uses
  `tokenActivityItemsFromStateForCanonicalLedger`.
- Confirmed token activity remains admissible from token state.
- Pending token activity from token state is admitted only when the same
  activity key is already present in the public Log activity boundary.
- Pending token activity with incomplete identity is rejected from the
  canonical public-log boundary instead of producing an unmatchable summary
  count.
- `scripts/check-index-recovery-behavior.mjs` now includes the regression
  check `pending token projections cannot outrun public Log membership`.

Production actions completed under the approved recovery scope:

- Took fresh production evidence from the node/API/DB VPS and UI VPS.
- Backed up the live API file under
  `/data/proofofwork-recovery/20260816T1944-pending-projection-freshness/`.
- Installed the patched `server/proof-api.mjs` on the node VPS.
- Restarted `proofofwork-api` and `proofofwork-indexer-worker`.
- Rebuilt and published the exact canonical summary using the same environment
  pins as the production API service.

Post-repair production checkpoint:

- Canonical summary block: `962776`.
- Canonical summary hash:
  `000000000000000000020294a201dd7149c53cba6cfaab2fa8db60ee37e00d65`.
- Canonical summary snapshot: `2ff7afe6e602246eb348d172`.
- Public health:
  `https://computer.proofofwork.me/api/v1/health` returned `ok: true`,
  `ready: true`, `available: true`, `lagBlocks: 0`, and `error: null`.
- Fresh token history, public Log history, and token market-log checks for
  tx `e89bab27e511d8c0d8a6da897db666a095c169fe7cd4311da5eadfe23dc7c8e1`
  all returned snapshot `2ff7afe6e602246eb348d172` with the pending seal
  rendered as pending rather than confirmed truth.
- Production marketplace regression gate exited `0` against
  `https://computer.proofofwork.me`.

Local verification for the patch:

- `npm run check:index-recovery-behavior` passed with `450/450` behavior
  checks.
- `npm run check:live-data` passed.
- `npm run check:api-truth` passed.
- `git diff --check` passed.

Remaining approved/proposed hardening:

- Make canonical-summary manual/backfill jobs inherit the same active
  production API environment pins automatically, so Q16/V8 declaration
  settings cannot be omitted during supervised recovery.
- Triage the nonfatal production warning
  `Fresh payload refresh failed: Recovered WORK wallet state refuses a Q8 fallback after Q16 activation.`
  The fail-closed behavior is correct after V8 activation, but the caller
  should avoid attempting Q8 fallback refreshes on current WORK paths.
- Add retention/partition planning for large derived tables, especially
  `proof_indexer.work_amo_block_transitions` and
  `proof_indexer.ledger_snapshots`, while preserving replay evidence and
  rollback material.
- Harden UI VPS operations debt: failed SSH password attempts should be
  rate-limited or blocked more aggressively, UI release provenance failures
  should be resolved, and inactive prune timers should be reviewed before they
  are relied on for disk control.

## Production Address/Wallet Read Repair Log - 2026-08-16 16:17 ET

Status: production address/wallet read repair completed after the approved
supervised recovery scope exposed a remaining wallet rendering defect.

User-visible report:

- Screenshot:
  `/home/sixer/Pictures/Screenshots/Screenshot from 2026-08-16 16-17-15.png`
- Connected address:
  `19MXUmBgBN3nJr2V1yvEdysZBB8cYSaHk4`.
- Wallet page showed `Credit types 0`, `Movements seen 0`, and no balance even
  though the address held confirmed proofs.

Production evidence:

- Address UTXO endpoint returned one confirmed UTXO:
  `b4d5d1de723e45650837c758e661e5556435d11c5f93ee9a32e90f87d5cca28f:0`.
- Confirmed address value was `38,136` proofs at block `962691`.
- Wallet-scoped credit endpoint was authoritative and wallet-scoped, but
  returned `holderCount: 0`, `tokenCount: 0`, `transferCount: 0`, and
  `listingCount: 0`; the address had base proofs, not confirmed credit units in
  that wallet credit projection.
- Before repair, a fresh address-scoped Log-history read could fail with
  `CANONICAL_LOG_HISTORY_MISMATCH` because the filtered page total was compared
  against the global canonical Log summary total.

Root cause:

- The fresh Log-history exactness gate was correct for unfiltered public Log
  summary reads, but too strict for filtered reads such as address searches.
- A filtered page can legitimately return fewer rows than the global canonical
  Log summary while still being bound to the same snapshot, block height, and
  block hash.
- The Wallet UI also conflated "no credit units" with "no funds" on the
  standalone wallet surface by not showing spendable base proofs alongside
  credit-unit balances.

Implemented repair:

- `server/proof-api.mjs` now requires the filtered Log page and global Log
  summary to agree on snapshot identity and block identity, but compares the
  page total to the global summary total only for full unfiltered Log reads.
- `scripts/check-index-recovery-behavior.mjs` now covers an address-scoped fresh
  Log read that returns zero matching rows while sharing the canonical snapshot.
- `src/App.tsx` now computes connected-wallet proof availability once and shows
  a `Spendable proofs` stat in Wallet and the Computer wallet workspace.
- Wallet credit balances still render credit units only; base proofs now render
  separately so an address with proofs but no credit units is not presented as
  empty.

Production actions completed:

- Backed up live API file under
  `/data/proofofwork-recovery/20260816T202446Z-address-wallet-log-filter/`.
- Installed the patched API file on the node VPS.
- Restarted `proofofwork-api` and `proofofwork-indexer-worker`.
- Backed up the live Computer UI to
  `/var/www/proofofwork-computer.previous-address-wallet-20260816T202704Z`.
- Rebuilt and deployed the Computer UI bundle to
  `/var/www/proofofwork-computer`.
- Backed up the live Wallet UI to
  `/var/www/proofofwork-wallet.previous-address-wallet-20260816T202732Z`.
- Rebuilt and deployed the Wallet UI bundle to `/var/www/proofofwork-wallet`.

Post-repair production checkpoint:

- API and indexer services were both active after restart.
- Public health returned `ok: true`, `available: true`, `ready: true`,
  `tipHeight: 962779`, `indexedThroughBlock: 962779`, and `lagBlocks: 0`.
- Node health showed mainnet tip `962779`, txindex height `962779`, txindex
  synced, unpruned, and verification progress `1`.
- Database, Electrum, disk, index, and worker health checks were green.
- Fresh address-scoped Log-history read for
  `19MXUmBgBN3nJr2V1yvEdysZBB8cYSaHk4` returned no error, snapshot
  `d266e5d635a98fc02327407c`, block `962779`, consistency `green`, and
  `totalCount: 0`.
- Address UTXO read returned the confirmed `38,136` proof UTXO.
- Wallet-scoped credit read returned authoritative zero credit units for the
  address, which is distinct from its base proof balance.
- Production Wallet and Computer HTML returned `HTTP/2 200`.
- Deployed Wallet asset `App-7s-xMSj_.js` and Computer asset `App-BIY10O6m.js`
  both contain the new `Spendable proofs` wallet UI.

Local verification for the patch:

- `npm run check:index-recovery-behavior` passed with `450/450` behavior
  checks.
- Computer build passed with
  `VITE_POW_API_BASE=https://computer.proofofwork.me`.
- Wallet build passed with `VITE_WALLET_ONLY=1` and
  `VITE_POW_API_BASE=https://wallet.proofofwork.me`.
- `npm run check:live-data` passed.
- `npm run check:api-truth` passed.
- `git diff --check` passed.
- Production endpoint checks passed for address UTXO, wallet-scoped credit, fresh
  Log-history, public health, and UI static assets.

## Production Q16 Pending Witness And Wallet Buy Recovery Log - 2026-08-16 21:49 ET

Status: supervised production recovery completed after explicit user approval to
commit, deploy, push, merge, and ship all the way to production.

User-visible report:

- Screencast:
  `/home/sixer/Videos/Screencasts/Screencast from 2026-08-16 21-49-48.webm`.
- AMO and Home showed
  `The canonical ProofOfWork index is catching up to the Bitcoin Core tip.`
- The app was reported about eight blocks behind.
- Wallet did not render spendable proof balances for connected address
  `19MXUmBgBN3nJr2V1yvEdysZBB8cYSaHk4`.
- AMO buying was unavailable while exact-tip write admission remained
  fail-closed.

Production evidence captured:

- Node/API/DB recovery evidence directory:
  `/data/proofofwork-recovery/20260817T020625Z-q16-pending-recovery`.
- Captured systemd unit state, worker status, worker journal, public health,
  selected table counts, WORK transition heads, V8 listing terms, Q16 metadata,
  and SHA256 evidence manifests before changing services.
- Two interrupted read-only dump attempts remain preserved as evidence in that
  recovery directory. They were not deleted because production disk still had
  safe headroom.
- UI VPS backup directory:
  `/var/backups/proofofwork-ui/20260817T021417Z-wallet-amo-q16-recovery`.

Root cause:

- Confirmed replay could catch up, but the canonical summary stayed fail-closed
  because the isolated pending-Q16 witness phase did not publish a ready witness
  on a large mempool.
- The pending witness child inherited hot-loop mempool bounds
  (`POW_INDEX_MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS=5`) and an outer watchdog too
  small for the recovery-sized pending scan.
- AMO buy admission correctly stayed closed because the public WORK floor and
  canonical summary could not be proven exact-tip.
- The standalone wallet also trusted an empty UniSat curated UTXO response as
  final, so addresses with confirmed base proofs could render as empty when the
  first-party address API had confirmed spendable UTXOs.

Implemented repair:

- `scripts/run-proof-indexer-worker.mjs` now lets only the
  `best-effort-pending` Q16 witness child use a 540 second mempool scan budget,
  250 protocol txids, and 500 total txids after confirmed replay has already
  caught up.
- Production worker pending-child watchdog is now capped and pinned at
  `600000` milliseconds in the service unit, with a later recovery drop-in at
  `/etc/systemd/system/proofofwork-indexer-worker.service.d/50-q16-pending-recovery.conf`
  preserving the active override without deleting older evidence.
- `src/App.tsx` now falls back from an empty UniSat curated UTXO response to the
  first-party address UTXO API, while still enriching nonempty curated UTXOs
  with confirmation evidence.
- Wallet, Computer, and AMO static bundles were rebuilt and deployed to their
  production roots.

Production actions completed:

- Stopped and restarted the indexer worker as needed after taking fresh
  evidence and backups.
- Installed the patched worker script, patched worker service unit, and Q16
  recovery drop-in on the node VPS.
- Deployed refreshed Wallet, Computer, and AMO UI bundles on the UI VPS.
- Preserved production evidence and backups before changing services or static
  roots.

Post-repair production checkpoint:

- Public health returned `ok: true`, `ready: true`, `tipHeight: 962818`,
  `indexedThroughBlock: 962818`, and `lagBlocks: 0`.
- Fresh WORK floor returned `ready: true`, `writeAdmission: true`,
  `settlementWritesEnabled: true`, and `listingWritesEnabled: true`.
- Q16 pending witness published with `q16PendingWitnessReady: true`,
  `q16PendingUnresolved: 0`, `protocolTxids: 23`, and `indexed: 59`.
- Connected address `19MXUmBgBN3nJr2V1yvEdysZBB8cYSaHk4` returned two confirmed
  spendable UTXOs totaling `48,478` proofs.
- Node/API VPS services `proofofwork-api` and `proofofwork-indexer-worker` were
  active; node storage was about `/` `55%` used and `/data` `74%` used.
- UI VPS storage was about `/` `50%` used, and Caddy was active.
- Wallet, AMO, and Computer production HTML returned `HTTP/2 200`.

Local verification for the patch:

- `node scripts/check-ui-contract.mjs` passed.
- `node scripts/check-worker-containment.mjs` passed.
- `node scripts/check-live-data-contract.mjs` passed.
- `node scripts/check-index-recovery-behavior.mjs` passed with `450/450`
  behavior checks.
- `npm run build` passed.
- Wallet, Computer, and AMO production-targeted builds passed.

## Production Proof Balance Split Repair Log - 2026-08-17 13:49 ET

Status: UI guardrail repair completed after explicit user approval to commit,
deploy, merge, push, and ship all the way to production.

User-visible report:

- Screenshot:
  `/home/sixer/Pictures/Screenshots/Screenshot from 2026-08-17 13-49-05.png`.
- AMO showed the connected wallet as having `10,342 proofs` under a
  `confirmed balance` style account strip while UniSat showed `0.00048478`
  total, `0.00010342` available, and `0.00038136` unavailable.

Production evidence:

- First-party address UTXO endpoint for
  `19MXUmBgBN3nJr2V1yvEdysZBB8cYSaHk4` returned two confirmed outputs:
  `38,136` proofs at block `962691` and `10,342` proofs at block `962815`,
  totaling `48,478` confirmed proofs.
- Public health was green during diagnosis and after deploy. The post-deploy
  checkpoint returned `tipHeight: 962924`, `indexedThroughBlock: 962924`,
  `lagBlocks: 0`, worker `ok: true`, and Q16 pending unresolved `0`.

Root cause:

- The account strip reused the UniSat-curated signing lane as the displayed
  confirmed proof balance.
- That lane intentionally excludes outputs UniSat marks unavailable or outputs
  filtered because they carry attached wallet assets, so AMO buying did not try
  to spend the protected `38,136`-proof output.
- The funding behavior was safe, but the label was misleading: `10,342` was
  wallet-spendable, not the full-node confirmed total.

Implemented repair:

- `src/App.tsx` now loads a separate first-party full-node address UTXO lane
  for display while preserving the UniSat-curated UTXO lane for signing.
- Connected account stats now render `total confirmed`, `spendable proofs`,
  and `protected proofs` instead of collapsing all three concepts into one
  balance.
- Wallet and Computer wallet cards now explain total confirmed proofs,
  wallet-spendable proofs, and protected/unavailable proofs.
- AMO purchase failure messaging now includes the proof split when a purchase
  cannot be funded from wallet-spendable outputs.
- `scripts/check-ui-contract.mjs` now guards the full-node total versus
  UniSat-spendable/protected split and the AMO purchase error copy.

Production actions completed:

- Backed up the live UI roots under
  `/var/backups/proofofwork-ui/20260817T1755Z-proof-balance-split`.
- Rebuilt and deployed AMO to `/var/www/proofofwork-marketplace`.
- Rebuilt and deployed Wallet to `/var/www/proofofwork-wallet`.
- Rebuilt and deployed Computer to `/var/www/proofofwork-computer`.

Post-repair production checkpoint:

- AMO, Wallet, and Computer HTML returned `HTTP/2 200`.
- Deployed assets:
  - `/var/www/proofofwork-marketplace/assets/App-C7aekCC2.js`
  - `/var/www/proofofwork-wallet/assets/App-CjGLSTSl.js`
  - `/var/www/proofofwork-computer/assets/App-Bz60a5Fh.js`
- All three deployed assets contain the new `total confirmed`,
  `spendable proofs`, `protected proofs`, and protected-UniSat purchase
  messaging.
- UI VPS storage was healthy at about `/` `50%` used, and Caddy was active.

Local verification for the patch:

- `node scripts/check-ui-contract.mjs` passed.
- `npm run build` passed.
- AMO, Wallet, and Computer production-targeted builds passed.

## Production Health Audit Log - 2026-08-17 14:55 EDT

Status: read-only audit completed and logged. No repository files, production
configuration, services, deploys, commits, or pushes were changed during the
audit itself.

Audit request:

- Recheck that all events are logged, tracked, and rendered correctly across
  the application.
- Check node health, log health, event health, database health, database space,
  both VPS disk usage, and mempool/confirmed status rendering.
- Pay special attention to avoiding the previous UI VPS full-disk failure mode.

Data and event health evidence:

- Production ledger consistency passed on the node/API VPS against the local
  production API at `http://127.0.0.1:8081`.
- Passing ledger snapshot:
  `1fdaaf654028472964e15f05`.
- Ledger snapshot covered livenet block `962931` with value
  `7009061625111427010.97459467` proofs.
- `/api/v1/consistency` was green with `missingLogEvents: 0`.
- Production Computer/event audit passed against the local production API and
  indexer database.
- Computer/event audit confirmed:
  - `0` confirmed events missing transaction rows.
  - `0` confirmed events joined to non-confirmed transactions.
  - `0` confirmed events missing raw transaction or payload evidence.
  - `0` confirmed transactions missing block metadata.
  - `120058` event participant rows.
  - `48685` event reference rows.
  - `23841` OP_RETURN rows.
- Confirmed canonical activity count matched DB events:
  `24048` confirmed canonical activity events.
- Confirmed canonical action txids were covered:
  `23436`.
- Public log history rendered current confirmed events from snapshot
  `d679a75c2f04d8225df85693` at block `962930`, with `24079` total log
  items observed.
- Mail regression passed against production.
- Marketplace regression passed against production after its normal fresh-state
  retry.
- Production indexer parity passed on the node/API VPS.
- Local live-data, node-ops, UI-ops, and WORK AMO V8 contract checks passed.
- WORK floor credit miner fee coverage reported `0` missing confirmed events,
  `0` missing confirmed transactions, and no missing confirmed txids.

ID and mempool status evidence:

- First-party registry reported `527` records total:
  `501` confirmed records and `26` pending records.
- Registry stats reported `pendingRecords: 26`, `pendingEvents: 0`,
  `confirmedSales: 4`, and `salesVolumeSats: 22000`.
- A known pending ID, `shining`, resolved with `status: pending`.
- A known confirmed ID, `run`, resolved with `confirmed: true` and
  `status: confirmed`.
- External `npm run audit:ids` was inconclusive because `mempool.space` reset
  connections during the read. This was treated as a third-party fetch failure,
  not a first-party registry failure.

Node/API/DB VPS health:

- Host: `pow-bitcoin-01` at `65.108.122.87`.
- Root filesystem was healthy: about `55%` used, about `42G` free.
- `/data` was healthy but near the warning line: about `74%` by `df`, and the
  API disk probe observed about `75.00%` used with about `411G` free.
- Inodes were healthy.
- Largest observed storage consumers:
  - `/data/proofofwork-postgres-backups`: about `134G`.
  - `/data/proofofwork-postgres-tablespaces`: about `29G`.
  - `/var/lib/postgresql`: about `7.2G`.
  - `/var/log`: about `890M`.
- `proof_indexer` database size was about `15GB`.
- Largest database relations were `work_amo_block_transitions` at about
  `10GB` and `ledger_snapshots` at about `4.9GB`.
- Large-state database tablespace was correctly placed under
  `/data/proofofwork-postgres-tablespaces/proof_indexer_large_state_v1`.
- Bitcoin Core was synced, not pruned, not in IBD, and txindex was synced.
- `bitcoind`, `electrs`, `postgresql@16-main`, `proofofwork-api`,
  `proofofwork-indexer-worker`, and WireGuard API units were active.
- WAL/receivewal state was healthy, with the physical slot active and only
  about `16MB` retained WAL observed.

UI VPS health:

- Host: `ubuntu-4gb-hel1-1` at `77.42.91.106`.
- Root filesystem was healthy: about `50%` used, about `18G` free.
- Inodes were healthy.
- `/var/www` was about `3.8G`.
- `/var/tmp/proofofwork-deploy` was about `3.6G`.
- Caddy logs were about `17M`.
- System journal usage was about `226M`.
- Caddy was active, with some reverse-proxy timeout/incomplete-response noise
  and raw-IP ACME challenge noise, but no observed disk exhaustion.
- Public app hostnames returned successful HTML responses after expected
  redirects.

Readiness and latency findings:

- Public `/health` temporarily returned HTTP `503` during the audit.
- The failure was not a confirmed data mismatch. Observed blockers included
  transient Electrum/address-index timeout, DB health timeout, pending-event
  status errors, or exact-tip summary snapshot lag immediately after a new
  block.
- A clear local example occurred at block `962931`: Core, electrs, database,
  worker, and indexer were healthy with lag `0`, but summary coverage was still
  at block `962930`, so `/health` marked readiness false until the exact-tip
  summary snapshot caught up.
- After a short wait, local health returned green at block `962931`, with no
  failed checks and summary snapshot `1fdaaf654028472964e15f05`.
- App and worker journals showed no warning-or-higher entries during the
  inspected health-flap window, so the observed readiness failures looked like
  timing/latency gates rather than a logged crash path.

Operational issues to repair before the next audit:

1. Repair node release provenance.

   The node release health verifier failed because the live checkout at
   `/opt/proofofwork-api` had tracked drift, including:

   - `scripts/run-proof-indexer-worker.mjs`
   - `server/proof-api.mjs`

   Follow-up repair should compare the live files against the intended
   committed release, preserve evidence, and either commit/deploy the intended
   state or restore the approved release state.

2. Repair UI release provenance.

   The UI release provenance verifier failed because active UI surfaces had
   unsafe ownership or modes. Observed affected roots included:

   - `/var/www/proofofwork-computer`
   - `/var/www/proofofwork-marketplace`
   - `/var/www/proofofwork-wallet`

   Follow-up repair should normalize active surface ownership and modes through
   the approved UI deployment/provenance path.

3. Review and enable prune timers.

   UI deploy scratch was not full during this audit, but prune timers were
   disabled. Node release prune was also disabled. Because prior UI failure was
   caused by disk exhaustion, follow-up repair should review retention policy,
   enable the appropriate prune timers, and verify they preserve required
   release evidence while preventing unbounded deploy scratch growth.

4. Investigate health-gate flapping.

   Exact-tip summary coverage and pending-event checks can briefly fail the
   readiness gate after new blocks or during slow reads. Follow-up repair should
   decide whether the readiness gate needs a grace window, clearer degraded
   status, longer internal timeout, or improved summary generation latency.

5. Watch node `/data` growth.

   `/data` has substantial free space but is at the documented warning line.
   Backups are currently the largest storage consumer. Follow-up audit should
   check backup retention, tablespace growth, and whether storage alerting is
   firing before the critical threshold.

Next audit baseline:

- Treat snapshot `1fdaaf654028472964e15f05` at block `962931` as the latest
  passed ledger and Computer/event audit baseline from this read-only pass.
- Re-run ledger consistency, Computer/event audit, mail regression,
  marketplace regression, indexer parity, VPS disk checks, failed-unit checks,
  release provenance checks, and prune timer checks before any future
  production repair.

## Read-only ordered Computer audit - 2026-08-17 22:16 UTC

User request:

- Audit the public surfaces in order: Home, ID, Desktop, Browser, AMO, Credit,
  Wallet, WORK, Infinity, Inception, Log, Growth, then
  `computer.proofofwork.me` last.
- Use the full node to verify data before shipping anything.
- Keep the pass read-only until improvements are separately approved.
- Include recommendations for speed, data handling, accuracy, and hardening.

Scope performed:

- No production files, configs, services, deploys, commits, or pushes were
  changed during the audit.
- The in-app browser connector was unavailable, so the surface pass used local
  headless Chrome/Playwright, same-origin API probes, first-party production
  API reads, PostgreSQL proof-index reads, and Bitcoin Core checks over SSH.
- All requested public pages returned HTTP 200 in the requested order. The apex
  `proofofwork.me` redirected to `https://www.proofofwork.me/` as expected.

Critical live finding:

- At `2026-08-17 22:16 UTC`, the node API was indexed to Core tip block
  `962951` with `lagBlocks: 0`, but public summary coverage was still block
  `962950` at snapshot `74b8c9309ca809210eeb37b9`.
- `/health?network=livenet` reported `ok:false`, `ready:false`, and
  `available:false`.
- `work-summary?network=livenet&fresh=1` returned HTTP `503` with
  `CANONICAL_SUMMARY_UNAVAILABLE` and message
  `The canonical ProofOfWork summary snapshot is catching up.`
- Worker/API logs repeatedly reported
  `PENDING_WORK_STAGE_BASE_UNAVAILABLE`: the relational token tables did not
  provide an exact-tip Q16 WORK base.
- Bitcoin Core verification of block `962951` returned `935` OP_RETURN
  transactions and zero ProofOfWork protocol hits for `pwid1`, `pwm1`, `pwt1`,
  or `pow1`. The block scan was right that no protocol events were present;
  the summary publisher failed to advance the coherent public summary bundle
  across a zero-protocol block.

Confirmed-data health:

- Production ledger audit passed at snapshot `74b8c9309ca809210eeb37b9`, with
  confirmed value around `7009061625112567991.93552426` proofs.
- Production Computer/event audit passed at block `962950`, with no failures or
  warnings. Key counts included `24076` confirmed canonical events,
  `24109` canonical activity items, `501` ID records, `238` confirmed credit
  definitions, `604` confirmed mail items, `21873` confirmed token mints, and
  `174` confirmed token transfers.
- `/api/v1/consistency?network=livenet` was green for snapshot
  `74b8c9309ca809210eeb37b9`, with `missingLogEvents: []`.
- Mail regression passed against `https://computer.proofofwork.me`.
- AMO/marketplace regression passed against `https://amo.proofofwork.me`,
  including ID lookup, legacy cutover/relic state, listing lifecycle, wallet
  scopes, and targeted WORK transfers.
- Local contract checks passed: `check:live-data`, `check:node-ops`,
  `check:ui-ops`, `check:api-truth`, `check:ui`, `check:work-precision-v2`,
  and production-side `check:work-amo-v8`.
- Sample pending events were confirmed as real Core mempool entries through
  `/api/v1/tx-status` and Bitcoin Core. Pending rows remained visibility only,
  not canonical ownership/value.

Parity finding:

- Production `npm run indexer:parity` exited non-zero.
- Confirmed activity counts matched, but pending activity accounting differed:
  the parity script expected `33` pending activity items while the event table
  exposed `36` valid pending events.
- Broad token/marketplace relational state in the parity script was empty
  (`tokens: 0`, active listings `0`, closed listings `0`, sales `0`) even
  though direct token, AMO, WORK, wallet, and regression endpoints returned
  populated state.
- Treat this as a required repair for the parity gate or its broad-state read
  eligibility before any future production shipping gate depends on it.

Surface-specific findings:

- AMO displayed stale protocol copy in production: it could show V6 as
  authoritative with `20,000`, `50,000`, and `100,000` proof faces even though
  active V8 permits only the single `25,000` proof face.
- Source locations to review include `src/App.tsx` around the V8/V6 branch at
  `45263`, the listing prompt around `29616`, and the legacy listing copy
  around `37137`.
- WORK loaded valid data by about 30 seconds, but still showed loading copy
  after roughly 7 seconds on the first pass. First paint should use the last
  coherent canonical snapshot and revalidate in the background.
- Mobile layout had repeated overflow in shared `.status-text`, plus some H1
  and button overflow on Desktop, Browser, AMO, Growth, Infinity, and
  Inception. Chart SVG labels on Infinity/Growth may clip or be false-positive
  text overflow and need visual confirmation after layout changes.
- Home had only a benign console warning for unsupported `web-share`.
- No failed requests, broken images, or horizontal page overflow were observed
  in the automated surface sweep.

Wallet and credit observations:

- Wallet UTXO read for `19MXUmBgBN3nJr2V1yvEdysZBB8cYSaHk4` returned three
  UTXOs quickly, split correctly into one confirmed output and two pending
  outputs. A known pending sale tx was visible as unconfirmed.
- A real credit-holder sample
  `1447TsdXtFSnVrWawSamyyQKPDNW4ALtBT` cross-checked cleanly: database balances
  showed WORK and INCB, and the wallet-scoped token summary returned the same
  holder records with zero pending deltas plus closed/sale history.
- The wallet-scoped credit/WORK read path was slow: observed reads ranged from
  about `7.5s` to `21.5s`, and marketplace regression previously saw wallet
  scoped reads in the `30s` range.

VPS and log health:

- Node/API VPS `pow-bitcoin-01`:
  - Root filesystem about `55%` used with about `42G` free.
  - `/data` about `74%` used with about `411G` free; the API disk probe saw
    about `75.03%`, which is the caution band.
  - Large consumers: `/data/proofofwork-postgres-backups` about `135G`,
    `/data/proofofwork-postgres-tablespaces` about `29G`,
    `/var/lib/postgresql` about `7.2G`, and `/var/log` about `885M`.
  - `proof_indexer` database about `15GB`.
  - Largest relations: `work_amo_block_transitions` about `10GB`,
    `ledger_snapshots` about `5GB`.
  - `bitcoind`, `electrs`, PostgreSQL, API, indexer worker, and WireGuard API
    units were active.
  - Failed historical units remain for old deployment/tablespace attempts,
    node release health, node release prune, and release publish.
  - `/opt/proofofwork-api` live checkout is dirty:
    `scripts/run-proof-indexer-worker.mjs` and `server/proof-api.mjs` differ
    from HEAD. Observed diff includes longer pending-backfill timeout and
    token/log read changes.
- UI VPS `ubuntu-4gb-hel1-1`:
  - Root filesystem about `43%` used with about `21G` free.
  - `/var/www` about `3.8G`, `/var/tmp/proofofwork-deploy` about `1.2G`,
    `/var/log` about `455M`.
  - Caddy and storage-health timer were active.
  - UI release provenance failed every 15 minutes with
    `Active UI release provenance mismatch: activity`.
  - Several active/release roots remain owned by `1000:1000` and/or writable,
    including active `proofofwork-computer`, `proofofwork-marketplace`,
    `proofofwork-wallet`, `proofofwork-log`, and related historical roots.

Recommended repair order, pending user approval:

1. Fix exact-tip summary publication for zero-protocol blocks so a block scan
   with no new protocol txids still publishes a coherent summary bundle or
   intentionally reuses the prior value under the new block hash.
2. Decouple confirmed exact-tip summary readiness from pending-only WORK
   verifier failure where confirmed state is hash-matched and current.
3. Repair `indexer:parity` pending-count logic and broad token/marketplace
   relational read eligibility.
4. Fix AMO V8 production copy so V6 appears only as historical context and V8
   shows the single 25,000-proof face everywhere.
5. Add wallet-scoped materialized/read-model paths for balances, listings,
   seals, sales, reserved anchors, and spendable WORK so Wallet/AMO reads stay
   under a tight latency budget.
6. Add client/server request dedupe and stale-while-revalidate first paint for
   WORK, AMO, Wallet, Growth, Infinity, Inception, and Log.
7. Normalize UI release provenance and repair node release provenance after
   preserving evidence of the current production drift.
8. Review prune timers and retention policies for UI deploy scratch, node
   release archives, Postgres backups, and ledger snapshot growth.
9. Tighten storage alerting before `/data` grows beyond the caution band.

Do not ship from this audit baseline until the block `962951` exact-tip
summary/readiness failure is either repaired or explicitly accepted as the
next approved repair target.

## User bug reports appended - 2026-08-18 01:31 UTC

User reports reviewed:

- `gullish@proofofwork.me` / X report:
  `https://x.com/cramericaTV/status/2089438118390694229`.
- Tweet-linked transaction:
  `b2875f7260a142d8720fd74a7d2536fb4ddc5c98cfbc16960527ba0f66365b32`.
- `carbonz@proofofwork.me` AMO report: connected-wallet AMO shows
  `Frozen terms unavailable`; reporter expected a normal buy action.
- User screenshot evidence:
  `/home/sixer/Pictures/Screenshots/Screenshot from 2026-08-17 21-21-31.png`.

Read-only verification:

- The X post was readable through direct X metadata extraction after the
  in-app browser connector was unavailable. The post complains that the
  Computer inbox still needs fixes and links the transaction above.
- Bitcoin Core verified transaction
  `b2875f7260a142d8720fd74a7d2536fb4ddc5c98cfbc16960527ba0f66365b32`
  as confirmed in block `962933` at `2026-08-17T19:05:28Z`. The transaction
  carries a canonical `pwm1` mail subject/body pair, pays `546` proofs to
  `1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv`, and returns change to
  `bc1p0e5qs2vcu6c50t6xwxuk7yfnqpwtm03rclv7wzgxzk37849xt8fssl6zvd`.
- `proof_indexer.events` contains event `3602387` for that transaction:
  `kind=mail`, `status=confirmed`, `valid=true`, `block_height=962933`,
  `protocol=pwm1`, subject `Trying to contact you`.
- `proof_indexer.mail_items` contains the matching confirmed mail projection,
  and `/api/v1/event-history` plus `/api/v1/log-history` both return the tx.
- Current ID registry state maps `gullish` owner and receive address to
  `bc1p0e5qs2vcu6c50t6xwxuk7yfnqpwtm03rclv7wzgxzk37849xt8fssl6zvd`.
  Therefore this transaction is sender-side mail for `gullish`, not inbox
  mail for `gullish`.
- `/api/v1/address/{gullish-address}/mail` returns the tx in `sentMessages`
  with `status=confirmed`. `/api/v1/address/1F1p9UE.../mail` returns it in
  `inboxMessages` with `confirmed=true`. If the Computer UI failed to show
  the tx to the reporter, the likely defect is folder/search/copy visibility
  or ID/address expectation, not missing Core data, event indexing, or mail
  projection.

AMO connected-wallet state finding:

- Source review found the visible AMO label at `src/App.tsx` around the
  connected marketplace buy-label branch: confirmed WORK listing plus missing
  `workFrozen` currently renders `Frozen terms unavailable` before the generic
  seal-state labels.
- Protocol expectation: confirmed V8 WORK sale tickets are visible but are not
  buyable until sealed; sealed non-WORK listings should render a normal `Buy`
  action for non-seller wallets.
- Live data check: the `gullish` marketplace row
  `dcac1665798675b7817a973fa990283bc9de2c77cc374361e8cb956a5f2daa46`
  is a POWB listing, not WORK. Its seal transaction
  `720311f99aad3368946de248fd833d1c555ed0e001cbee0931ded5d099146b72`
  is confirmed by Core and the index; the marketplace summary exposes
  `sealConfirmed=true` and a complete anchored sale authorization.
- Live WORK V8 term rows were not missing frozen terms: latest
  `work_amo_v8_listing_terms` rows include `frozen_terms`, and the active WORK
  listing table count for missing frozen terms was `0`.
- Treat the AMO report as a required UI/state-consistency bug: a sealed POWB
  row must not inherit WORK AMO disabled wording, and an unsealed WORK row
  should show a clear seal state such as `Needs seal` or `Awaiting seal`, not
  an internal frozen-terms failure unless terms are actually unavailable.

Exact-tip screenshot addendum:

- The user screenshot at `2026-08-17 21:21` shows Wallet connected to
  `17W7JZ9K...Ge8YTRzA` while the banner says WORK exact-tip summary
  publication is temporarily unavailable, last-good summary block `962950`,
  current canonical scan checkpoint block `962969`, and full-node tip
  `962969`.
- A read-only node health check at `2026-08-18 01:27 UTC` reproduced the same
  class: Core/Electrum/index were at block `962969` with `lagBlocks: 0`, but
  summary coverage remained pinned to snapshot `74b8c9309ca809210eeb37b9` at
  block `962950`; `/api/v1/work-summary?fresh=1` failed closed with
  `The canonical ProofOfWork summary snapshot is catching up.`
- This is the same critical exact-tip publication/readiness bug already logged
  in the ordered audit, now with direct Wallet UI evidence at block `962969`.

Recommended additions to the repair backlog, pending approval:

1. Add a focused regression for the tweet-linked mail transaction:
   event history, log history, mail projection, sender Sent, recipient Inbox,
   and Computer search/folder visibility must all agree for
   `b2875f7260a142d8720fd74a7d2536fb4ddc5c98cfbc16960527ba0f66365b32`.
2. Fix AMO action labels so `Buy`, `Needs seal`, `Seal pending`,
   `Your listing`, `Buyer locked`, and WORK-only term failures are mutually
   exclusive and derived from the same confirmed seal/term state.
3. Add regression coverage for the sealed `gullish` POWB listing
   `dcac1665798675b7817a973fa990283bc9de2c77cc374361e8cb956a5f2daa46` so a
   non-seller wallet sees a buyable sealed listing.
4. Add a Wallet/AMO exact-tip UI regression that asserts stale last-good
   summary banners cannot coexist with misleading action affordances when
   Core/index are at tip but summary publication is pinned.

## Approved bugfix implementation log - 2026-08-18 02:05 UTC

Approved scope:

- User approved committing, deploying, pushing, merging, and syncing local,
  git, and production for the audit-backed fixes.
- Implement a UI-safe AMO fix before production deploy: connected-wallet action
  labels must derive from confirmed seal state first, then protocol/term
  readiness.
- Preserve read-only audit evidence and convert the new user reports into
  regression coverage.

Implementation:

- `src/App.tsx` now computes a single `listingIsWork` value for marketplace
  sale-ticket rows and evaluates buy labels in this order: connected wallet,
  active WORK era, seal needed, seal pending, WORK write gate, WORK terms,
  owner/buyer lock, then `Buy`.
- The reported phrase `Frozen terms unavailable` was removed from the UI.
  Missing WORK terms now render `Terms unavailable`, and unsealed rows render
  `Needs seal` before any WORK-only terms failure.
- The connected-wallet listing seal button now distinguishes pre-V8 relic,
  missing terms, wrong era, and paused AMO write-gate states.
- The owner-side V3 WORK recovery copy now points sellers to a current V8
  `25,000`-proof AMO unit instead of obsolete `20,000`, `50,000`, and
  `100,000` proof faces.
- `scripts/check-ui-contract.mjs` now fails if AMO action labels evaluate
  WORK term failures before seal state or if the old `Frozen terms unavailable`
  string returns.
- `scripts/check-mail-regressions.mjs` now checks the tweet-linked mail
  transaction
  `b2875f7260a142d8720fd74a7d2536fb4ddc5c98cfbc16960527ba0f66365b32`
  in both sender Sent and recipient Inbox views.
- `scripts/check-marketplace-regressions.mjs` now checks the reported sealed
  POWB listing
  `dcac1665798675b7817a973fa990283bc9de2c77cc374361e8cb956a5f2daa46`
  and seal transaction
  `720311f99aad3368946de248fd833d1c555ed0e001cbee0931ded5d099146b72`
  for confirmed anchor metadata.

Pre-deploy verification:

- `npm run check:ui` passed.
- `npm run build` passed.
- `npm run check:mail-regressions` passed against
  `https://computer.proofofwork.me`; the new gullish sender/recipient checks
  returned indexed mail data with no scan failure.
- `npm run check:server-globals` passed.
- `npm run check:client-read-containment` passed.
- `npm run check:worker-containment` passed.
- `npm run check:live-data` passed.
- `POW_API_BASE=https://computer.proofofwork.me npm run
  check:marketplace-regressions` failed before deploy on the already-logged
  production exact-tip issue: fresh WORK token reads returned HTTP `503` for
  `Fresh credit state is still catching up`, exhausting the fast gate's
  convergence budget.

## Approved exact-tip worker repair log - 2026-08-18 02:32 UTC

Post-deploy finding:

- The first approved production deploy moved both VPSs to commit `fde6f8a`,
  but `https://computer.proofofwork.me/health` still reported `ok=false`.
- Core, Electrum, and the block scan were exact-tip, but the summary snapshot
  remained pinned to block `962950` while the canonical scan had advanced.
- Worker logs showed the confirmed AMO V8 Q16 replay passing at tip, followed
  by pending-only witness failure because the pending verifier could not obtain
  an exact-tip relational WORK base.

Repair:

- `scripts/run-proof-indexer-worker.mjs` now publishes the confirmed canonical
  summary immediately after the confirmed block-scan phase proves its
  checkpoint, before starting the bounded best-effort pending rebuild.
- Pending verification still runs after pending-status maintenance and remains
  a separate fail-closed accuracy gate; the repair does not relax confirmed
  replay, relational parity, or pending witness correctness.
- `scripts/check-worker-containment.mjs`,
  `scripts/check-live-data-contract.mjs`, and
  `scripts/check-index-recovery-behavior.mjs` now enforce the confirmed-first
  publication order.
- A stale wallet reserved-outpoint source assertion in
  `scripts/check-index-recovery-behavior.mjs` now matches the current
  `connectedWalletReservedOutpoints` contract, preserving the check that
  wallet proof spendability excludes active ID and token listing anchors.

Local verification:

- `npm run check:worker-containment` passed.
- `npm run check:live-data` passed.
- `npm run check:server-globals` passed.
- `node scripts/check-api-truth-contract.mjs` passed.
- `node scripts/check-index-recovery-behavior.mjs` passed with `450/450`.
- `npm run check:ui` passed.

## Approved canonical outpoint close summary repair log - 2026-08-18 02:48 UTC

Post-worker-repair finding:

- The node deploy at commit `2d14470` put the block scan at exact tip, with
  current token tables hash-bound and balance-conserved at block `962974`.
- The internal canonical summary still rejected publication because the exact
  token-table helper returned `null` after Q16 precision validation.
- Read-only production diagnostics narrowed the drop to
  `payloadWithCanonicalWorkLifecyclePositions`.
- One WORK listing,
  `e299613d6ed3e8d35aad408d439f4b4b170daeb2877199c2ac747c71114691e0`,
  was correctly closed by canonical sale-ticket outpoint spend tx
  `b587b787ad7a621e6096ba6b77c162793c37a61cb5b2a981c6ff6dd875a8203a`,
  but that spend's protocol event was an invalid sale attempt
  (`token-sale-invalid`, reason `work-amo-v5-raw-buy-state-invalid`), not a
  valid `token-listing-closed` event.

Repair:

- `server/db/proof-index-reader.mjs` now treats a confirmed
  `closedByCanonicalOutpointSpend` listing with exact spend block position as
  already lifecycle-bound for the close position.
- Listing and seal positions remain rebound through canonical confirmed
  events, and ordinary close records still require valid close-event evidence.
- `server/proof-api.mjs` now skips valid close-log expectations for canonical
  outpoint-spend closures so the consistency checker does not require an
  invalid sale attempt to masquerade as a valid `token-listing-closed` action.
- `scripts/check-index-recovery-behavior.mjs` now covers canonical
  outpoint-spend closes so an invalid buy can close an already-spent sale
  ticket without being counted as a valid sale or blocking exact summary
  publication.

## Approved pending WORK verifier outpoint-close repair log - 2026-08-18 03:01 UTC

Post-summary-repair finding:

- The deploy at commit `cf38ccd` restored exact-tip canonical summary
  publication, but worker readiness still reported `ok=false`.
- The remaining red gate was `/api/v1/internal/pending-work-verifier-stage`:
  pending replay failed while rebuilding its confirmed WORK base because a
  confirmed canonical outpoint-spend close had no valid close-event
  `closedProtocolVout` or `closedRecordOrdinal`.
- Live token-state diagnostics confirmed the production shape on listing
  `e299613d6ed3e8d35aad408d439f4b4b170daeb2877199c2ac747c71114691e0`:
  exact `closedTxid`, `closedBlockHash`, `closedBlockHeight`, and
  `closedBlockIndex`, with no valid close OP_RETURN tuple because the spend
  was an invalid buy attempt.

Repair:

- `server/proof-api.mjs` now normalizes confirmed
  `closedByCanonicalOutpointSpend` listings for the pending WORK verifier by
  requiring exact transaction/block closure proof and deliberately omitting
  close protocol tuple fields.
- Protocol close events still require exact `closedProtocolVout` and
  `closedRecordOrdinal`; cutover relic handling remains unchanged.
- The internal pending verifier code-version pin is advanced from `v4` to
  `v5` across the API, worker, backfill, and reader so no older pending
  witness can be reused across the new outpoint-close normalizer.
- `scripts/check-index-recovery-behavior.mjs` now covers the pending verifier
  outpoint-close normalizer so the live production shape remains fail-closed
  on missing block proof without inventing protocol coordinates.

Local verification:

- `node scripts/check-index-recovery-behavior.mjs` passed with `450/450`.
- `npm run check:server-globals` passed.
- `npm run check:worker-containment` passed after the code-version bump.
