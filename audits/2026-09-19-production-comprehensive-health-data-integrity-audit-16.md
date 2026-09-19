# Production Comprehensive Health and Data-Integrity Audit 16

- Audit date: 2026-09-19 (America/Toronto)
- Scope: read-only production audit of the node/API VPS, UI VPS, full node, Electrs, PostgreSQL, indexer worker, public application surfaces, event projections, mempool visibility, storage, and protocol/application math.
- Production changes: none. No services were restarted, no code/configuration/data/ledger/evidence was changed, and no additional cleanup was performed during this audit.
- Audit log creation: approved by the user.

## Previous audit trail reviewed

Reviewed audits 4 through 15, including the two ordered application audits, the PostgreSQL/WAL recovery audit, and the prior capacity findings. The four approved obsolete logical PostgreSQL backup sets were removed before this audit; the three newest logical sets were retained. The node-ops contract fix and prior math/API truth checks remain passing.

## Systems and services checked

- Node VPS `pow-bitcoin-01` (`65.108.122.87`): Bitcoin Core, Electrs, PostgreSQL 16, WAL receiver, ProofOfWork API, WireGuard API proxy, and PostgreSQL indexer worker.
- UI VPS `ubuntu-4gb-hel1-1` (`77.42.91.106`): filesystem capacity, memory, release/rollback archive inventory, system warnings, and public web serving.
- Public surfaces, in order: `proofofwork.me`, `id`, `desktop`, `browser`, `boost`, `amo`, `credit`, `wallet`, `work`, `infinity`, `inception`, `log`, `growth`, and `computer`.
- Repository verification: ledger consistency, API truth, canonical ordering, WORK precision, bond exact arithmetic, node-ops safety contract, and repository hygiene.

## Health and capacity results

### Node VPS

- `/data`: 1,764,768,071,680 bytes total; 1,265,547,153,408 used; 409,500,143,616 available; 76% reported usage.
- `/`: 98G total, 25G used, 69G available (27%).
- Memory: 124Gi total, 17Gi used, 107Gi available; swap 629Mi/15Gi used.
- Load: 1.74 / 2.01 / 2.42 on the four-month uptime host.
- Core data on disk: approximately 877GB; live Core, Electrs, mempool, and PostgreSQL tablespaces were not altered.
- PostgreSQL database: approximately 28GB; PostgreSQL cluster and WAL receiver active.
- Services checked: all active: `bitcoind`, `electrs`, `postgresql@16-main`, `pg_receivewal@16-main`, `proofofwork-api`, `proofofwork-api-wg`, and `proofofwork-indexer-worker`.

### UI VPS

- `/`: 38G total, 24G used, 13G available, 66% reported usage.
- Memory: 3.7Gi total, 592Mi used, 3.2Gi available; no swap configured.
- Release and rollback archives remain the main growth risk. The largest observed release archive was approximately 186MB, and numerous historical release/rollback artifacts remain. The supported retention tool previously refused to prune because multiple complete rollback roots exist. No UI artifacts were deleted in this audit.
- System warnings in the sampled period were primarily UFW-blocked unsolicited network probes; no application/system failure was observed in the sampled warnings.

### Public surfaces

All 14 requested hosts returned HTTP 200 and followed their canonical HTTPS routes. This confirms edge serving and route availability, but does not by itself prove every authenticated or data-bearing UI workspace state; those are covered by API/indexer and repository contract checks.

## Full-node and indexer verification

- Bitcoin Core chain: `main`; blocks and headers: 967667; `initialblockdownload=false`; `pruned=false`; verification progress 1; warnings empty.
- Core indexes: txindex, coinstatsindex, and basic block filter index all synced through block 967667.
- Electrs header: block 967667 and the exact Core best-block hash; at tip.
- Indexer: complete through block 967667 with zero lag after catch-up; confirmed read-model counts reported by health were 505 IDs, 230 transfers, and 26,209 events.
- Canonical rebuild: complete through block 967667 with no fault.
- Worker: last successful cycle, zero consecutive failures, pending unresolved count zero, and `proofReady=true` after catch-up.

## API, event, mempool, and rendering results

- The API briefly returned HTTP 503 during the audit while Core advanced one block ahead of the summary snapshot. The response identified the condition precisely: Core/index tip 967667, summary snapshot still at 967666, and worker proof readiness false during catch-up.
- After a 20-second read-only recheck, `/health` returned HTTP 200 with `ok=true`, `ready=true`, `indexedThroughBlock=967667`, `tipHeight=967667`, `lagBlocks=0`, current summary, worker healthy, and `proofReady=true`. This was a transient readiness window, not a persistent failure.
- Mempool was loaded and visible from Core: approximately 76,038 transactions, 39,960,586 bytes, 222,984,968 bytes usage, zero unbroadcast transactions. Pending records remained best-effort and did not alter confirmed canonical projections.
- API health reported pending-event health `globalUnresolved=0`, including Q16 pending unresolved zero.
- The health payload’s canonical summary, event counts, index tip, Core tip, and Electrs tip reconciled after catch-up.
- No production write, repair, restart, or projection mutation was performed.

## Data integrity and reconciliation

- Confirmed history remains anchored to Core/canonical chain data; database projections are treated as read models rather than authority.
- The available health evidence showed no duplicate/corrupt canonical projection signal, no unresolved pending-event signal, no index lag, and no canonical rebuild fault.
- PostgreSQL backup/WAL recovery state remained active and healthy from the previous approved recovery procedure. The three newest logical backups remained present; the four approved older logical sets were absent.
- A direct ad hoc query for a table named `proof_events` was not used as an integrity conclusion because that relation is not part of the deployed schema; the production API health and indexed read-model checks are the authoritative deployed checks for this audit.
- Public root responses were HTTP 200 across all requested surfaces. Application data-bearing routes should continue to be validated through their canonical APIs and browser flows because unauthenticated HTML status alone cannot validate wallet-specific rendering.

## Math verification

All repository math and determinism checks passed:

- `npm run audit:ledger`: passed with no reported inconsistency.
- `npm run check:api-truth`: passed, including WORK AMO V8 pending normalization, aggregate transfer admission, persistent Q16 replay, next-block liveness, and declaration discovery.
- `npm run check:canonical-order`: passed.
- `npm run check:work-precision`: passed 131 checks for `work-atoms-v1`, unit scale 100,000,000.
- `npm run check:bond-exact-arithmetic`: passed.
- `npm run check:node-ops`: passed.
- `npm run hygiene:check`: passed.

These checks cover deterministic integer arithmetic, canonical UTF-8 ordering, activation gates, replay behavior, bond calculations, and node-operation safety contracts across the Computer/indexer/API/UI code paths. Production health showed the same canonical tip and summary provenance after catch-up.

## Previously reported issues rechecked

1. Node API/full-node read access: resolved. Core and API read paths are operational using the service-owned configuration; no secrets were exposed.
2. PostgreSQL WAL receiver/slot recovery: resolved and active; receiver service remained active.
3. UI disk pressure: improved but remains a monitoring risk. UI is at 66% with 13G free, while historical archives remain and the supported prune tool previously refused due to multiple complete rollback roots.
4. Node `/data` pressure: improved after the approved logical-backup deletion and now has 409.5GB free, but remains at 76%, above the preferred 75% line. No further deletion was performed.
5. Node-ops contract false positive: resolved; contract check passes.
6. Prior API/indexer catch-up behavior: not persistently failing, but a transient HTTP 503 readiness interval recurred while the summary snapshot trailed Core by one block. This is recorded as a new operational observation because it occurred during this audit.

## New findings

### F-16-01 — transient API readiness 503 during one-block catch-up

- Source: API `/health` at 05:29:58 UTC.
- Condition: Core/index tip 967667 while the summary snapshot was still at 967666; worker `proofReady=false`; API correctly returned 503.
- Impact: brief unavailability for readiness-gated summary routes during normal chain advancement. No data corruption or canonical divergence was observed, and the condition self-cleared.
- Recommendation: retain the fail-closed behavior, but add/monitor a bounded catch-up SLO and alert with the snapshot age/block delta so transient one-block windows are distinguished from a stuck worker.

### F-16-02 — UI archive retention remains a future capacity risk

- Source: UI VPS archive inventory at 66% usage with no swap and many historical release/rollback artifacts.
- Impact: continued release accumulation could recreate the prior full-disk outage even though current free space is 13G.
- Recommendation: resolve the rollback-root classification so the supported retention tool can prune only demonstrably obsolete archives; retain active release, rollback evidence, provenance sidecars, and protected audit artifacts. Show exact paths and sizes before any future deletion.

### F-16-03 — node `/data` remains above the preferred 75% threshold

- Source: node VPS `df -B1` after approved logical-backup cleanup.
- Impact: less headroom for Core growth, Electrs growth, WAL, database growth, and recovery operations.
- Recommendation: complete read-only classification of `/data/proofofwork-backups`, release backups, recovery artifacts, WAL archives, and caches. Do not remove anything else without exact-path approval and supported-tool acceptance.

## Actions taken

- Read-only checks and public probes only.
- Created this audit log after the approved audit.
- No production data, protocol records, ledgers, evidence, backups, logs, configuration, or services were modified.

## Items requiring approval

- Any UI archive or node storage deletion beyond the four already approved logical PostgreSQL backup sets.
- Any change to readiness thresholds, worker behavior, retention policy, service configuration, or alerting.
- Any code fix for the transient readiness window.

## Recommended follow-up actions

1. Add monitoring for API readiness catch-up duration and summary block lag, with alerts only when the bounded window is exceeded.
2. Continue node storage classification and bring `/data` below 75% using only the supported cleanup tools after exact-path review.
3. Resolve UI rollback-root ownership/classification so safe release retention can be enforced; keep protected evidence and current rollback roots.
4. Add a scheduled read-only integrity audit that records Core tip, index tip, summary snapshot, event counts, pending unresolved counts, database size, WAL lag, and both VPS capacity.
5. Repeat the ordered public-surface audit after the next production release and verify data-bearing API responses, not only HTTP root availability.

## Ordered application-surface re-audit append — 2026-09-19

### Audit date and scope

This append is a read-only re-audit of all public application surfaces in the requested order, performed after reviewing audits 12–16. No code, configuration, production data, databases, ledgers, backups, logs, services, or infrastructure were modified. No cleanup or restart was performed.

### Pages reviewed in order

1. `proofofwork.me` — Home
2. `id.proofofwork.me` — ID management
3. `desktop.proofofwork.me` — Desktop
4. `browser.proofofwork.me` — Browser
5. `boost.proofofwork.me` — Social tools
6. `amo.proofofwork.me` — AMO listings and purchases
7. `credit.proofofwork.me` — Credits
8. `wallet.proofofwork.me` — balances, spendability, listings, seals, and related wallet routes
9. `work.proofofwork.me` — Work
10. `infinity.proofofwork.me` — Infinity Bonds
11. `inception.proofofwork.me` — Inception Bonds
12. `log.proofofwork.me` — Logs
13. `growth.proofofwork.me` — Growth
14. `computer.proofofwork.me` — Computer, audited last

Every root route returned HTTP 200 over HTTPS. Measured root response times were approximately 0.42–0.45 seconds for all surfaces except the home redirect path at approximately 0.89 seconds. Each response was 1,653 bytes. This verifies availability and edge serving; it is not treated as proof that wallet-specific authenticated workspaces render every record correctly.

### Full-node verification

- Core mainnet tip: block 967667; headers equal blocks; `initialblockdownload=false`; unpruned; warnings empty.
- txindex, coinstatsindex, and basic block filter index were each synced through 967667.
- Core best-block hash and Electrs/API canonical tip remained aligned.
- Mempool: 79,868 transactions, 40,683,905 bytes, 228,093,656 bytes usage, zero unbroadcast transactions.
- Core is authoritative for confirmed status; pending data remains best-effort and did not alter canonical projections.

### API, indexer, database, and event results

- API `/health`: HTTP 200; `ok=true`, `ready=true`, `tipHeight=967667`, `indexedThroughBlock=967667`, `lagBlocks=0`, current summary, worker healthy, and `proofReady=true`.
- Confirmed read-model counts: 505 IDs, 230 transfers, and 26,209 events. Pending-event health reported zero unresolved records and zero Q16 pending unresolved records.
- PostgreSQL database size: approximately 28GB. PostgreSQL, WAL receiver, API, indexer worker, Core, and Electrs services were active.
- No new duplicate, corruption, canonical mismatch, stale projection, or confirmed/pending status discrepancy was observed in the available API health and Core reconciliation evidence.
- The full deployed relational schema was not inferred from a guessed table name; the earlier ad hoc `proof_events` lookup remains non-evidence because that relation does not exist in the deployed schema.

### Health, capacity, logs, and security observations

- Node VPS: `/data` remained at 76% with approximately 382G available; root filesystem 27%; 124GiB memory with approximately 109GiB available; swap use 629MiB.
- UI VPS: root filesystem remained at 66% with approximately 13G available; 3.7GiB memory with approximately 3.1GiB available; no swap.
- UI backup/archive inventory was approximately 21.1GB. Historical release and rollback archives remain the principal growth risk.
- UI system errors included repeated failed starts for `proofofwork-ui-storage-health.service` and `proofofwork-ui-release-prune.service`. These are continuity of previously reported unresolved retention/health findings, not duplicated as new bugs. They should be repaired or reconfigured only after explicit approval.
- Other sampled UI errors were SSH protocol resets/version mismatches and blocked unsolicited network probes. No application crash was observed in the sampled interval.
- No secrets were exposed or inspected; read-only Core access used the existing service-owned configuration.

### Math and deterministic verification

The following all passed again:

- `npm run audit:ledger` completed without a reported inconsistency.
- `npm run check:api-truth` passed the WORK AMO V8 and Q16 replay gates.
- `npm run check:canonical-order` passed.
- `npm run check:work-precision` passed all 131 checks for `work-atoms-v1` at unit scale 100,000,000.
- `npm run check:bond-exact-arithmetic` passed.
- `npm run check:node-ops` passed.

No new rounding, precision, unit-conversion, fee, balance, accounting, or reconciliation defect was identified. The checks continue to support deterministic integer arithmetic, canonical ordering, activation/declaration gates, replay, and exact bond calculations across Computer/indexer/API contracts.

### Previously reported issues rechecked

- Core/API access, WAL receiver recovery, node-ops contract, and indexer catch-up: remain operational.
- The prior transient API one-block readiness window did not recur during this pass; the endpoint was ready and aligned at the sampled tip.
- UI archive retention and failed retention/storage-health units: remain unresolved and materially relevant.
- Node `/data` remains above the preferred 75% usage line; no additional deletion was performed.
- No prior finding was closed merely because root HTML returned HTTP 200.

### New findings and severity

No new data-integrity or protocol-math defect was opened.

- **Unresolved / medium:** UI retention and storage-health systemd units continue to fail, leaving archive-growth protection operationally incomplete.
- **Unresolved / medium:** UI has approximately 13G free and approximately 21.1GB of retained backup/archive files; continued releases can recreate the historical full-disk outage.
- **Informational / low:** UI logs contain repeated internet scanning/protocol-noise errors. Firewall blocks are functioning; continue monitoring SSH hardening and log volume.

### Recommended improvements

1. Repair and test the UI storage-health and release-prune units without deleting anything automatically; preserve fail-closed behavior and protected rollback evidence.
2. Establish a measured UI pre-deploy free-space budget and an alert before archive creation can exhaust the filesystem.
3. Continue node storage classification and reduce `/data` below 75% only through approved, supported cleanup paths.
4. Add a scheduled cross-surface probe that records response time, API tip, index tip, snapshot height, event counts, pending unresolved counts, and confirmed/pending status samples.
5. Add a bounded API catch-up alert based on block delta and elapsed readiness time; keep fail-closed readiness semantics.
6. Continue periodic deterministic math and ledger checks after each protocol or indexer release.

### Storage items requiring review

- UI release archives and rollback roots under `/var/backups/proofofwork-ui`; exact classifications and retention ownership must precede deletion.
- Node `/data/proofofwork-backups`, release backups, recovery artifacts, WAL archives, caches, and temporary files; no deletion is authorized by this append.

### Actions requiring explicit approval

Any code/configuration fix, systemd unit repair, retention-policy change, archive deletion, storage cleanup, service restart, deployment, or production data/projection change requires separate explicit approval. This append performed none of those actions.

## Approved UI retention remediation append — 2026-09-19

- User approved resolving the multiple-complete-root classification guard without modifying rollback roots, manifests, checksums, provenance, or protected evidence.
- The supported retention tool was updated so validated complete rollback roots remain protected while verified release archives are evaluated normally. The tool remains fail-closed for invalid ownership, malformed evidence, checksum drift, unverified archives, unsafe paths, and discovery failures.
- Local `check:node-ops` and `check:ui-ops` contract tests passed after the change.
- The updated tool was deployed to the UI VPS and dry-run verified 17 verified archives, zero unverified archives, nine validated rollback roots, and exactly six eligible archive sets.
- User then approved exactly those six archive sets and their matching `.sha256` and `.provenance` sidecars for deletion through `/usr/local/sbin/proofofwork-release-prune ... 5 --apply`.
- Apply completed successfully. Verification found all 18 approved files missing, the active release `84a9871040db-20260918T190233Z` retained, and all nine rollback roots retained.
- UI filesystem usage improved from 66% / approximately 13G free to 64% / approximately 14G free. The backup tree reduced from approximately 20G to 19G. No other storage category was removed.
- The one-shot retention and storage-health units were not restarted or reset during this action; their existing inactive/failed status remains an operational follow-up item.
