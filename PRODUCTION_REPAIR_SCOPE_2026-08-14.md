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
