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
