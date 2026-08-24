# ProofOfWork.Me Read-Only Health, Data, Event, and UI Audit

Date: 2026-08-23
Mode: read-only audit
Status: initial non-visual audit complete, visual screenshot/recording audit pending

## Scope

This audit reviewed production health, node/indexer status, database consistency,
event/log coverage, wallet and marketplace data, public page availability, and
VPS resource health before any shipping work.

No files, production config, database rows, services, commits, pushes, deploys,
or restarts were intentionally changed during the audit phase. This file was
created only after explicit user approval.

## Visual Audit Limitation

Browser automation was unavailable in the audit environment. The browser runtime
reported no available browser sessions, so the first audit pass used live HTTP
shell checks, headers, API responses, production regression scripts, direct VPS
inspection, PostgreSQL read-only queries, and Bitcoin Core full-node checks.

Screenshot and screen-recording review is pending and should be appended below
after the user provides the media.

## Overall Health Summary

- Overall application health is green at the chain/index/API layer.
- Full node, Electrum, API health, indexer worker, and summary snapshots agreed
  at block 963764.
- Full-node block hash for height 963764:
  `0000000000000000000134ba3cee4f12a0566195ed358f927e7d2a62e1d3079e`.
- API `/health/live` also reported tip and indexed-through block 963764 with
  zero lag.
- Confirmed events, balances, listings, seals, and logs are broadly healthy.
- Main issues found:
  - Node `/data` is at 76% used, above the documented 75% warning threshold.
  - Node release provenance/prune checks are failing.
  - Six confirmed valid sale-close events are missing event time metadata.
  - A full marketplace regression observed one transient wallet-scoped transfer
    omission during fresh convergence; direct requery later returned the
    confirmed transfer correctly.
  - Several fresh/history/wallet endpoints are slow.

## VPS and Resource Health

### UI VPS: 77.42.91.106

- Host: `ubuntu-4gb-hel1-1`.
- Uptime: about 107 days.
- Load: low.
- Disk `/`: 45% used, about 20G free.
- Inodes: 6% used.
- Memory: about 3.2G available.
- Swap: none.
- Caddy: active.
- Failed units: none found.
- UI storage health: passing.
- UI release provenance: verified for commit
  `c9f486ef538257164599e36bbc2a67be11f5521b`.
- `/var/www`: about 5.8G.
- `/var/tmp`: about 3.0G.
- `/var/log/caddy`: about 19M.
- Recent warning/error log check for Caddy/UI health services returned no
  warning/error entries in the sampled window.
- Caddy status tail contained reverse-proxy client disconnect and timeout
  messages. These look like request-level aborts, not app corruption.

### Node/API VPS: 65.108.122.87

- Host: `pow-bitcoin-01`.
- Uptime: about 106 days.
- Load: moderate and acceptable.
- Root disk `/`: 32% used, about 65G free.
- Data disk `/data`: 76% used, about 382G free.
- Inodes on `/data`: 1% used.
- Memory: about 111G available.
- Swap: 15G total, about 296M used.
- Active services:
  - `bitcoind`
  - `electrs`
  - `postgresql@16-main`
  - `proofofwork-api`
  - `proofofwork-indexer-worker`
  - `proofofwork-api-wg.socket`
  - `proofofwork-api-wg.service`
- Failed services:
  - `proofofwork-node-storage-health.service`
  - `proofofwork-node-release-health.service`
  - `proofofwork-node-release-prune.service`
- Storage health failure is caused by `/data` crossing the warning threshold:
  76% used.
- Release health failure reports `/opt` has more node release checkouts than the
  bounded inventory allows.
- Release prune refuses retention because archive provenance for the live node
  commit and tree is incomplete.

Top `/data` consumers:

- `/data/bitcoin`: 903G.
- `/data/proofofwork-postgres-backups`: 166G.
- `/data/electrs`: 59G.
- `/data/proofofwork-postgres-tablespaces`: 37G.
- `/data/proofofwork-release-backups`: 7.4G.
- `/data/proofofwork-api-cache`: 63M.

## Node, Indexer, and Worker Health

- Bitcoin Core:
  - Chain: main.
  - Tip height: 963764.
  - Headers: 963764.
  - Pruned: false.
  - Initial block download: false.
  - Txindex synced: true.
  - Warnings: none from `getblockchaininfo`.
- Electrum:
  - Configured: true.
  - At tip: true.
  - Header height/hash matched Core/API.
- API health:
  - `ok: true`.
  - `ready: true`.
  - `lagBlocks: 0`.
  - Summary snapshot coverage reached block 963764 for:
    - growthSummary
    - inceptionSummary
    - infinitySummary
    - logSummary
    - marketplaceSummary
    - tokenSummary
    - workFloor
    - workSummary
- Worker:
  - Phase: idle.
  - Consecutive failures: 0.
  - Pending event health: ok.
  - Global unresolved pending events: 0.
  - Q16 pending unresolved: 0.

## Database Health

- Database: `proof_indexer`.
- Size: 24GB.
- Largest tables:
  - `proof_indexer.work_amo_block_transitions`: 13GB.
  - `proof_indexer.ledger_snapshots`: 11GB.
  - `proof_indexer.events`: 85MB.
  - `proof_indexer.transactions`: 68MB.
  - `proof_indexer.event_participants`: 47MB.
- Connections: 17.
- Active connections: 2.
- Waiting locks: 0.
- Credit balances:
  - Rows: 395.
  - Negative confirmed balances: 0.
  - Nonzero pending deltas: 0.
- ID records:
  - Rows: 502.
  - Distinct IDs: 502.
  - Missing owner: 0.
  - Missing receiver: 0.

## Event and Indexing Accuracy

Production consistency checks passed:

- `npm run check:ui`
- `npm run check:hardening`
- `npm run check:node-ops`
- `npm run check:ui-ops`
- `npm run check:api-truth`
- `npm run check:live-data`
- `npm run check:work-precision`
- `npm run check:bond-exact-arithmetic`
- `npm run audit:ledger`
- `npm run audit:computer-events`
- `npm run check:mail-regressions`
- `POW_API_BASE=https://computer.proofofwork.me npm run check:marketplace-regressions`

Ledger consistency:

- Passed for `https://work.proofofwork.me`.
- Snapshot during ledger audit: `4cc0c9c0f74ec0f5aff21170`.
- Later fresh summary snapshot: `0ad16b19f6caa2ec4add90f6`.

Core ledger metrics:

- Current POW IDs: 502.
- Public activity items: 24,277.
- Confirmed tokens: 238.
- Confirmed token mints: 21,873.
- Confirmed token sales: 55.
- Confirmed token transfers: 186.
- Seeded confirmed mail items: 606.
- Inception bonds logged: 46.
- Infinity bonds logged: 465.
- Missing log events: 0.

Event table status counts:

- Confirmed valid events: 24,245.
- Confirmed invalid audit events: 306.
- Pending valid events: 32.
- Pending invalid events: 164.
- Dropped valid events: 1.
- Dropped invalid events: 13.

Confirmed invalid protocol attempts are present as audit history and should not
be rendered as valid business activity.

### Event Metadata Bug

Proof-indexer parity found six confirmed valid events missing canonical parent
metadata. Direct PostgreSQL sampling showed they are all `token-listing-closed`
events with correct block height/index and confirmed transaction joins, but null
`event.block_time` and null `event.event_time`.

Affected txids:

- `b587b787ad7a621e6096ba6b77c162793c37a61cb5b2a981c6ff6dd875a8203a`
- `431cea7dc3c6f9136ebc5cd259a7e436580fe1234c265e0e43e7c55b1e260a07`
- `d735596cf0281f617905a386c1d0a1a4363684593a83e9a54d1496c3192bdbf5`
- `d097aaba4990b6b98574765349891dd19828df4e12182ec9db68ecb8da0d10c9`
- `5b2cf523d4e67c9f3427aca951a13daa3da94595051be4e10fc767537effc8d2`
- `3ce256fa95758a6ed58e00aa8f90644601f1c5f50d50c5a285aa23d479256284`

The last txid above was read from terminal output; verify exact spelling before
using it in a migration.

## Wallet, Credit, Listing, Seal, and Purchase Accuracy

Marketplace fast regression passed against production:

- ID lookup.
- V2 cutover and relic state.
- V5/V6/V8 gates.
- Listing lifecycle.
- Active and closed listing truth.
- Wallet scopes.
- Targeted WORK transfers.

Marketplace summary at block 963764:

- Token listings: 144.
- Closed listings: 40.
- Sales: 40.
- WORK AMO V8 ready: true.
- Pending membership live: true.

Credit and wallet sanity:

- Token summary populated with 238 tokens and 144 listings.
- Credit balances have no negative confirmed balances.
- Credit balances have no nonzero pending deltas.

### Transient Wallet-Scoped Transfer Failure

The full marketplace regression failed once because wallet-scoped transfers for
address `18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW` did not include confirmed transfer
`c90f95cdd45892f76af89686dea7c1c35ec070148e5a74c947f174e244ef44db`.

Direct verification showed:

- The transfer exists in `/api/v1/token-history`.
- The DB row exists as `event_id 3106439`.
- Kind: `token-transfer`.
- Status: confirmed.
- Valid: true.
- Block height: 955792.
- Sender: `18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW`.
- Recipient: `14hKW6Z3WKrJZayZhCvLJCocMaaAtTHd9L`.
- Amount: 20,000 WORK.

Later direct fresh wallet requery returned 16 transfers and included the tx.
This appears to be a transient fresh-convergence or partial-response issue, not
a persistent chain/index data loss.

## Performance Findings

Observed endpoint timings included:

- Ledger consistency: about 8.4s.
- Marketplace summary fresh: about 7.9s to 8.3s.
- Work floor fresh: about 5.8s in audit script, about 12.3s in one direct run.
- Work summary fresh: about 17.9s in one direct run.
- Log-history query: commonly about 5s to 6.5s, with one direct fresh request
  about 12.3s.
- Wallet-scoped WORK token fresh reads: commonly 5s to 10s, with spikes to
  28.3s and 38.6s.

Correctness is mostly holding, but these latencies are high enough to affect
trust and perceived reliability in the UI.

## Page-by-Page Findings

### 1. proofofwork.me

- Apex redirects to `https://www.proofofwork.me/`.
- Page shell returned HTTP 200 after redirect.
- First-load shell timing observed around 0.957s.
- Registry summary returned 528 historical/current records.
- No data corruption found.

### 2. id.proofofwork.me

- Page shell returned HTTP 200.
- First-load shell timing observed around 0.472s.
- Current ID records: 502.
- Distinct current IDs: 502.
- Missing owner/receiver: 0.
- Carbonz ID lookup passed in marketplace regression, around 1.8s to 1.9s.

### 3. desktop.proofofwork.me

- Page shell returned HTTP 200.
- First-load shell timing observed around 0.470s.
- Mail regression passed.
- Sampled identities had no scan failures.
- Desktop public file sender sample passed with total 2 indexed items.

### 4. browser.proofofwork.me

- Page shell returned HTTP 200.
- First-load shell timing observed around 0.649s.
- Ledger reports browser flow sats as 0.
- No backend inconsistency found in this pass.
- Visual/browser interaction is pending screenshots or recordings.

### 5. amo.proofofwork.me

- Page shell returned HTTP 200.
- First-load shell timing observed around 0.435s.
- Marketplace summary coherent at exact tip.
- Listing/seal/purchase regression coverage mostly passed.
- Full marketplace pass exposed the transient wallet-scoped transfer issue
  described above.

### 6. credit.proofofwork.me

- Page shell returned HTTP 200.
- First-load shell timing observed around 0.437s.
- Token summary populated with 238 tokens and 144 listings.
- Token definitions cover confirmed mints.
- Credit balances are sane.

### 7. wallet.proofofwork.me

- Page shell returned HTTP 200.
- First-load shell timing observed around 0.446s.
- Wallet-scoped checks generally pass.
- One transient omission of confirmed transfer `c90f95cd...44db` occurred in
  the full marketplace regression and then resolved on direct requery.
- Fresh wallet reads are too slow and should be optimized.

### 8. work.proofofwork.me

- Page shell returned HTTP 200.
- First-load shell timing observed around 0.438s.
- Work floor and work summary coherent at exact tip.
- Work network value:
  `7403128374883298504.15767145` proofs.

### 9. infinity.proofofwork.me

- Page shell returned HTTP 200.
- First-load shell timing observed around 0.430s.
- POWB confirmed supply: `630196569`.
- Network value: `630200937`.
- Holder count in compact summary: 12.
- Summary coherent at exact tip.

### 10. inception.proofofwork.me

- Page shell returned HTTP 200.
- First-load shell timing observed around 0.425s.
- INCB confirmed supply: `224847713398447926`.
- Network value: `224847713398447947.9358206`.
- Holder count in compact summary: 7.
- Summary coherent at exact tip.

### 11. log.proofofwork.me

- Page shell returned HTTP 200.
- First-load shell timing observed around 0.425s.
- Log summary total count: 24,277.
- Latest sampled log-history item was confirmed, valid, and a token transfer.
- Missing log events: 0.
- Log-history performance is slow.

### 12. growth.proofofwork.me

- Page shell returned HTTP 200.
- First-load shell timing observed around 0.438s.
- Growth value checks reconciled in ledger consistency.
- Growth summary provenance coherent at exact tip.

### 13. computer.proofofwork.me

- Page shell returned HTTP 200.
- First-load shell timing observed around 0.426s.
- Final health check green at block 963764.
- Ledger consistency passed.
- Computer-events audit passed.
- Worker and pending event health passed.

## Bugs and Risks

### High: Node `/data` Storage Warning

`/data` is 76% used and storage health fails at the documented warning
threshold. This is not critical yet, but it is an operational risk and should be
handled before it becomes another disk-full incident.

### High: Six Confirmed Sale-Close Events Missing Event Time Metadata

Six confirmed valid `token-listing-closed` events have null event time fields.
Rendered values currently appear protected by transaction/log views, but the DB
row quality is not perfect and parity correctly flags this.

### High: Transient Wallet-Scoped Transfer Omission

The full marketplace regression observed a confirmed transfer missing from a
wallet-scoped fresh response during convergence. Direct requery corrected it.
This is a trust issue even if data is eventually correct.

### Medium: Release Provenance and Prune Failures

Node release health/prune are failing because live archive provenance is
incomplete and release checkout inventory is above the bounded target.

### Medium: Slow Fresh and History Endpoints

Several user-facing data paths take multiple seconds, with wallet fresh reads
occasionally taking tens of seconds.

### Medium: Proof-Indexer Parity Contract Drift

`check-proof-indexer-parity` reports token-state relational checks as failed
because it expects the internal source to be exactly
`proof-indexer-token-state-tables`, while public token summary now reports the
composite source
`proof-indexer-events+proof-indexer-derived-token-value-state+proof-indexer-token-state-tables`.
This may be a stale checker contract, an internal read-model exposure issue, or
both.

### Low: Caddy Config Warnings

Caddy validate warns that explicit `header_up X-Forwarded-For` entries are
unnecessary because they match reverse proxy defaults. This is cleanup only.

## Recommendations

1. Resolve node `/data` runway before it becomes urgent:
   - Classify large backup/release dirs.
   - Repair release provenance.
   - Prune only approved, provenance-safe candidates.
   - Consider increasing `/data` capacity.

2. Backfill and fix sale-close event metadata:
   - Backfill `block_time` and `event_time` for the six confirmed
     `token-listing-closed` rows from the parent transaction row.
   - Fix the derived close-event insert path so future rows always carry parent
     block time and event time.
   - Add a regression check for confirmed derived events with null event time.

3. Harden wallet-scoped fresh reads:
   - Ensure wallet views never serve partial in-flight token state.
   - Prefer last complete exact-tip or last complete coherent snapshot while a
     refresh is running.
   - Add a regression for sender wallet transfer
     `c90f95cdd45892f76af89686dea7c1c35ec070148e5a74c947f174e244ef44db`.

4. Optimize slow endpoints:
   - Wallet-scoped `/api/v1/token`.
   - `/api/v1/marketplace-summary?fresh=1`.
   - `/api/v1/log-history`.
   - `/api/v1/work-summary?fresh=1`.
   - Add endpoint-level timing metrics to production health or structured logs.

5. Repair node release provenance and prune workflow:
   - Add or repair live commit/tree archive provenance.
   - Then run bounded release prune only after explicit approval.

6. Update parity checker contracts:
   - Align token-state source checks with the current composite public source, or
     query the intended internal token-state tables directly.
   - Keep the parent-metadata check strict.

7. Expose storage warning state more clearly:
   - `/health/live` currently reports disk ok because its max threshold is 90%.
   - Ops storage health flags warning at 75%.
   - Add a warning-level runway field so health consumers see the same risk.

8. Run visual UI audit after screenshots and recordings:
   - Verify visible values against API/full-node truth.
   - Check pending/confirmed/dropped rendering.
   - Check stale cache symptoms.
   - Check layout and interaction issues across the requested pages.

## Visual Audit Addendum

### Evidence Reviewed

- Screencast folder:
  `/home/sixer/Videos/Screencasts/SCREENCAST AUDIT AUGUST 23 2026`
- Reviewed 11 WebM recordings, captured from 2026-08-23 19:33:26 through
  2026-08-23 19:51:11.
- Generated read-only contact sheets at roughly three-second intervals and
  extracted 31 full-resolution frames for Computer, AMO, Wallet, WORK, and
  related transition states.
- Reviewed user screenshot:
  `/home/sixer/Pictures/Screenshots/Screenshot from 2026-08-23 19-56-40.png`.
- Live read-only work-floor quote at 2026-08-23T23:34:45.078Z:
  `indexedThroughBlock=963781`, `snapshotId=2ec4530e433885e9cebc4b8e`,
  `workAmoV8.reasonCode=work-amo-v8-precision-migration-not-ready`,
  `precisionMigrationReady=false`, `protocolReady=false`,
  `writeAdmission=false`, `listingWritesEnabled=false`,
  `settlementWritesEnabled=false`; activation itself is reached, active,
  evidence-complete, and tip-verified at height 960601.

### High: Wallet AMO V8 Actions Remain Reachable While Writes Are Paused

Evidence:

- Screenshot `Screenshot from 2026-08-23 19-56-40.png` shows Wallet displaying
  `WORK precision writes are paused (work-amo-v8-precision-migration-not-ready).
  No transaction was created.`
- The same screen still shows an enabled-looking
  `Create 25,000 proofs AMO intent` action and a listing row with active-looking
  `Seal` and `Delist` actions.
- Screencast frames show the list panel alternating between
  `Proof-native AMO write gate: temporarily unavailable` with `AMO paused`
  listing controls and `Proof-native AMO write gate: fresh preflight` with
  create/seal/delist controls reachable.
- Source inspection confirms the fail-closed path: `freshWorkWriteMode()` in
  `src/App.tsx` throws before transaction creation when
  `workWriteModeForQuote()` returns `paused`. The server status in
  `server/work-amo-v8.mjs` returns
  `work-amo-v8-precision-migration-not-ready` when activation/evidence are good
  but `precisionMigrationReady` is false.

Impact:

- Safety is working: no transaction is created while writes are paused.
- UX/trust is not healthy: users can press controls that are guaranteed to fail
  under current server truth, and the row state can show both an action and a
  pause error.

Proposed fix, not applied:

- Treat `work-amo-v8-precision-migration-not-ready` as a hard UI write block for
  AMO create, seal, delist, and purchase actions unless a distinct explicit
  "retry fresh preflight" state is intended.
- Disable or relabel transaction buttons when the current accepted quote has
  `writeAdmission=false`, `listingWritesEnabled=false`, or
  `settlementWritesEnabled=false`.
- Render the reason inline before action: "AMO V8 precision migration is not
  ready. No AMO transaction can be created yet."
- Keep the fail-closed preflight check, but prevent wasted preparation work and
  repeated user attempts while the reason code is unchanged.
- Add browser regression coverage for the screenshot state: active V8
  declaration, evidence complete, precision migration not ready, no enabled
  create/seal/delist buttons, and no transaction preparation started.

### High: Wallet Actions Can Be Enabled While Wallet/Balance State Is Refreshing

Evidence:

- Screencast frames show the top Wallet strip still reporting `Loading wallet
  proofs` and/or `Refreshing credit balances` while the AMO listing form and
  listing actions are visible and clickable.
- A later frame shows `Preparing 25,000 proofs AMO V8 unit...` while the top
  strip is still refreshing.

Impact:

- Transaction preparation can begin from a mixed state where local wallet,
  credit balances, listing reservations, and AMO write admission are not all
  current.
- This increases stale-cache and stale-admission risk even when the final
  preflight fails safely.

Proposed fix, not applied:

- Gate every wallet-mutating action on a coherent ready snapshot:
  connected wallet address, current wallet proofs, current token balances,
  current listing reservations, current mempool state, and current AMO write
  admission.
- Show a single blocking reason while any required domain is still refreshing.
- Preserve last-good read-only rendering, but do not allow writes from a
  refreshing or partially loaded state.

### Medium: AMO Listing Status Labels Conflict Across Adjacent Panels

Evidence:

- AMO screencast frames show the listing book filtered to `Sealed`, with cards
  labeled `Sealed`, while adjacent sale/listing log cards for AMO units show
  `Waiting for seal` and also include `Seal TX` links or seal-pending text.
- The same view shows a possible count mismatch: status text reports
  `144 open listings`, while the visible listing tab shows `All 143` with the
  search field empty. This may be a cross-asset/global-vs-filtered count issue,
  but the UI does not explain the difference.

Impact:

- Users cannot reliably tell whether an AMO ticket is sealed, sealing, waiting
  for seal, or purchasable from the visible labels alone.

Proposed fix, not applied:

- Normalize listing/seal status derivation into one shared helper used by AMO,
  Wallet, Marketplace, and logs.
- Split status into explicit fields: listing confirmed, seal absent, seal
  pending, seal confirmed, sold/closed, invalid/dropped.
- Label counts with scope, for example "all credit listings" versus "all visible
  WORK listings", or reconcile the underlying count query.
- Add visual/browser tests where a listing has a seal txid, a pending seal txid,
  and no seal txid, and assert each surface renders the same status.

### Medium: AMO Asset/Detail Media Region Can Render Corrupted Or Obscuring

Evidence:

- Screencast `Screencast from 2026-08-23 19-39-37.webm` shows a large noisy,
  blocky media/header band on `amo.proofofwork.me/?asset=...` for multiple
  timestamps.
- The band overlaps or visually competes with the top AMO detail area and
  summary cards.

Impact:

- Users may interpret the asset/detail page as corrupted or stale.
- If the noisy bitmap is a real asset preview, the page still lacks containment
  and fallback handling to keep the rest of the AMO data readable.

Proposed fix, not applied:

- Constrain asset media/header previews to a stable aspect ratio and clipped
  container.
- Add loading, decode-error, and unsupported-media fallbacks.
- Ensure media/canvas layers cannot overlay summary counts or action panels.
- If this is an intentional asset image, add enough framing so it is read as an
  asset preview rather than a rendering failure.

### Medium: Exact Numeric Values Overflow Or Wrap In Trust-Critical UI

Evidence:

- Computer, AMO, Wallet, and WORK frames show long exact credit, WORK, floor,
  and network-value fields clipped with ellipses in the global balance strip.
- AMO credit cards wrap values such as WORK supply into broken fragments across
  multiple lines.
- WORK/AMO metric cards display very long exact values that crowd their
  containers.

Impact:

- Values may be numerically correct, but the rendering makes balances, floor
  values, supply, and reservations harder to verify visually.

Proposed fix, not applied:

- Separate exact machine values from display values: compact primary display,
  exact value in tooltip/details/copy affordance.
- Use fixed decimal policies per domain: proofs as integers, WORK display with
  bounded precision, exact subatom values available on demand.
- Add responsive tests for the longest known live values in the top strip,
  token cards, and metric cards.

### Low: Loading Layouts Look Broken During Slow Reads

Evidence:

- WORK/Computer loading frames show controls such as `Factory` and `Refresh`
  rendered as tall narrow boxes before the ledger loads.
- Computer mailbox frames show the shell interactive while still displaying
  transient statuses such as `Opening UniSat...` and long balance refresh
  states.

Impact:

- This does not prove data corruption, but it makes slow read paths appear
  broken and amplifies user concern when a later action fails.

Proposed fix, not applied:

- Give loading controls stable dimensions and hide non-actionable controls until
  their layout container is ready.
- Add skeleton states for dashboard panels that preserve the final grid
  geometry.
- Tie "Opening UniSat" and refresh statuses to explicit timeouts, success, and
  retry affordances so stale transient messages do not linger.

## Approved Remediation Log - 2026-08-24

After user approval, the permanent core fix set was implemented for production
release. The audit findings above remain preserved as the read-only evidence
captured before changes.

Implemented fixes:

- Wallet write coherence gate: wallet-mutating actions now require connected
  address, loaded proof UTXOs, loaded chain UTXOs, and every credit lane loaded
  without an active error before PSBT preparation or broadcast can start.
- AMO V8 precision migration hard pause: `work-amo-v8-precision-migration-not-ready`
  now blocks create, seal, delist, purchase, mint, transfer, listing, and UTXO
  preparation paths instead of entering a fresh-preflight retry path that cannot
  create a valid transaction.
- AMO action feedback: blocked actions now report the specific paused/syncing
  reason before action state is set, so no misleading "Preparing..." state is
  entered when writes are unavailable.
- Seal/listing status normalization: AMO listings with a 64-hex `sealTxid` and
  `sealConfirmed !== true` are treated as pending seal state instead of being
  rendered as fully sealed.
- Proof-only mail signing fallback: proof-only mail send keeps strict reserved
  listing-anchor protection while allowing the current-token fallback when no
  WORK payload is attached, avoiding a wallet hang from unavailable WORK lane
  freshness.
- Canonical indexer hardening: malformed canonical INCB bond projection mints
  are now converted to invalid token events with
  `canonical-incb-bond-projection-invalid` before reserved namespace checks,
  preventing a single malformed projection event from crashing canonical token
  balance rebuild and stalling the production indexer.

Verification performed before commit/deploy:

- `npm run check:ui`
- `npm run build`
- Focused browser regression for paused AMO create/seal/delist controls.
- Browser regressions for proof-only mail fallback and AMO order book counts.
- Full browser UI suite: 19 passed.
- `npm run check:work-amo-v8`
- `npm run check:work-precision-v2`
- `npm run check:worker-containment`
- `npm run check:api-truth`
- `npm run check:server-globals`
- `npm run check:live-data`
- `npm run check:index-recovery-behavior` with 447/447 behavior checks passing.

Production deployment requirements:

- Deploy the UI bundle containing the wallet/AMO write-gate fixes to the UI VPS.
- Deploy the indexer script containing the INCB projection invalidation guard to
  the node/API VPS.
- Restart the API/indexer services only after the deployed source is in place.
- Re-run production health checks and marketplace regression after services are
  live to confirm that the public API is no longer serving
  `CANONICAL_INDEX_UNAVAILABLE`.

## Production Verification Addendum - 2026-08-24

The first production deploy proved that the recovery-time INCB projection guard
was necessary but not sufficient: an already-persisted confirmed row for
`b00b9451bded7d2b7d339556ad2dc5d375e5b52ad877a1d3e2b29149dfc72ccf`
remained `kind=token-mint`, `valid=true` in the canonical replay input. The
worker still failed while rebuilding confirmed credit balances, before a fresh
recovery pass could replace that stale row.

Final permanent server hardening:

- Canonical credit balance replay now detects malformed INCB bond projection
  rows already stored as valid `token-mint` events.
- Those stale rows are rewritten in `proof_indexer.events` as
  `token-event-invalid`, `valid=false`, with
  `reasonCode=canonical-incb-bond-projection-invalid`.
- The invalid row is skipped for supply/balance replay, while true generic
  POWB/INCB namespace mint attempts still fail closed.
- Regression coverage now includes the production-shaped stale-row txid above,
  proving the worker quarantines it instead of crashing.

Additional verification:

- `npm run check:index-recovery-behavior` with 448/448 behavior checks passing.
- `npm run check:live-data`
- `npm run check:server-globals`
- `npm run check:api-truth`
- `npm run check:worker-containment`
