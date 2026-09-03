# Production Health, Data, Event, And Storage Audit 4

Date: 2026-09-02
Mode: read-only production audit, plus this approved audit log
Scope: public API, node VPS, UI VPS, PostgreSQL, event/indexer accuracy, math gates, host routing, logs, storage, and prior audit continuity.

No production data, backups, services, DNS, production config, commits, pushes, deploys, or cleanup actions were changed.

## Prior Audit Continuity

Before recording findings, I reviewed the required protocol/product context plus prior audit and retention logs so this pass would not duplicate already-recorded repairs:

- `SOUL.md`
- `README.md`
- `PROOFOFWORK_IDS.md`
- `MARKETPLACE.md`
- `OP_RETURN_INFRASTRUCTURE.md`
- `MAIL_ORGANIZATION.md`
- `audits/2026-09-01-production-health-data-event-storage-audit-3.md`
- `audits/2026-08-31-production-health-data-event-storage-audit-2.md`
- `audits/2026-08-31-postgresql-retention-remediation-2c.md`
- `audits/2026-08-31-postgresql-retention-remediation-2e.md`
- `audits/2026-08-31-storage-retention-node-manifest.md`
- `audits/2026-08-31-storage-retention-ui-manifest.md`
- Earlier overlapping 2026-08-23, 2026-08-28, and 2026-08-30 audit notes.

Current status relative to audit 3:

- The WORK listing-authority gap logged on 2026-09-01 is not reproduced. Fresh Marketplace, listing history, and the full marketplace regression pass completed successfully.
- The WORK atom/sealing reservation issue is now classed as historical diagnostic data, not active oversubscription. The atom audit passes with the production systemd environment pins loaded.
- Node release health is green when run with sudo. Running the same check as `powadmin` can still produce a permission-denied false positive against managed release archives.
- `nft.proofofwork.me` DNS drift is still present and remains a carried-forward host/surface item.

## Final Health Snapshot

Final public health at the end of this audit:

- `/health?network=livenet`: `ok: true`, `ready: true`
- Tip/indexed height: `965181`
- Tip/indexed hash: `00000000000000000001d16b2f2aa06d2367fbb6945a4411f023dd31b8677a86`
- Summary snapshot: `bab31a698e951dfc69f20e81`
- Lag: `0`
- Worker: `ok: true`, `proofReady: true`, `consecutiveFailures: 0`
- Worker last success: `2026-09-02T14:21:47.416Z`
- Pending event health: `globalUnresolved: 0`, `q16PendingUnresolved: 0`, `staleCandidates: 5`
- Node: main chain, unpruned, IBD false, txindex synced at `965181`
- Electrum: at tip `965181`
- Database: `ok: true`, `canonicalMetaOk: true`
- Summary coverage keys all at `965181`: growth, inception, infinity, log, marketplace, token, work floor, and work summary.

Final consistency:

- `/api/v1/consistency?network=livenet&fresh=1`: `ok: true`
- Snapshot: `bab31a698e951dfc69f20e81`
- `missingLogEvents: []`
- Confirmed ProofOfWork IDs: `505`
- Confirmed tokens: `238`
- Confirmed token mints: `21873`
- Confirmed token sales: `68`
- Confirmed token transfers: `199`
- Confirmed computer actions: `25037`
- Canonical activity count matched the public log: `25043` total, `25037` confirmed.
- WORK/growth actual totals reconciled at `7915006689915001000` sats.
- Marketplace mutation fees reconciled at `840294` sats.

## Green Checks

Production and loopback checks that passed:

- `POW_API_BASE=https://computer.proofofwork.me npm run audit:ledger`
- `POW_API_BASE=https://computer.proofofwork.me npm run check:mail-regressions`
- `POW_API_BASE=https://computer.proofofwork.me npm run check:credit-mint-regressions`
- Full production marketplace regression suite after canonical convergence retries: passed for delist, fresh summaries, sealed listings, sales, wallet, and Log close status.
- `POW_SURFACE_AUDIT_TIMEOUT_MS=60000 npm run audit:surfaces`: passed `13/13` surfaces with live API checks.
- `npm run audit:computer-events` on node loopback/API/DB: passed with no failures or warnings.
- `npm run audit:ids` on node loopback/API/DB: passed canonical lifecycle parity.
- `node scripts/check-proof-indexer-parity.mjs` on node loopback/API/DB: exited `0`; output was too large for the terminal budget but the actual parity process succeeded.
- `npm run check:work-precision-v2`
- `npm run check:bond-exact-arithmetic`
- `npm run check:incb-range-replay-witness`
- `npm run check:api-truth`
- `npm run check:index-recovery-behavior`

Important event/database counts from `audit:computer-events`:

- Transactions total: `24955`
- Confirmed transactions: `24697`
- Pending transactions: `32`
- Dropped transactions: `226`
- Confirmed transactions missing raw tx: `0`
- Confirmed transactions missing block: `0`
- Events total: `25583`
- Confirmed canonical activity events: `25037`
- Confirmed events missing transaction: `0`
- Confirmed events without confirmed transaction: `0`
- Confirmed events missing raw tx: `0`
- Event refs: `53382`
- Event participants: `125409`
- Credit definitions confirmed: `238`
- Credit balances: `401`
- Credit listings: `759`
- ID records: `505`
- Confirmed mail items: `612`
- OP_RETURN rows: `24821`

ID audit:

- Registry transactions fetched: `562`
- Covered confirmed registry txs: `560`
- Covered pending registry txs: `2`
- Lifecycle events: `534`
- Active ID listings: `5`
- Canonical ID sales: `4`
- Registration attempts: `524`
- Confirmed winners: `505`
- Pending candidates: `2`
- Refund candidates: `17`
- Pending watchlist: `0`

WORK atom audit with the production environment pins loaded:

- Precision: Q16, `work-subatoms-v2`
- Holder rows: `352`
- Negative balances: `0`
- Confirmed supply: `210000000000000000000000` subatoms
- Pending delta: `0`
- Amount-unit/atom/subatom/precision invalid counts: `0`
- Unrepairable Q16 invalid zero events: `0`
- Repairable Q16 invalid zero events: `3`
- Current oversubscribed sellers: `0`
- Sealing oversubscribed sellers: `5` historical diagnostic rows, not active spendable inventory.
- Snapshot total: `10144`

## Findings

### 1. Fresh Wallet Exact-Tip Reads Can Temporarily Fail Closed

Under the full marketplace sweep, fresh wallet-scoped token reads intermittently returned:

```text
503 CANONICAL_WALLET_INDEX_UNAVAILABLE
Fresh wallet credit state is temporarily unavailable for WORK.
```

Observed affected endpoints included:

- `/api/v1/token?asset=WORK&address=...&wallet=1&fresh=1`
- `/api/v1/token-summary?asset=WORK&address=...&wallet=1&fresh=1`

The retry loop later recovered and returned authoritative wallet-scoped state. A direct sampled wallet response after recovery had:

- `walletScoped: true`
- `authoritativeWallet: true`
- `checkpointComplete: true`
- Balance and active listing data present.

Impact: no incorrect wallet balance or bad math was observed. The application fails closed instead of serving stale exact wallet state, which is the right safety property. The current availability behavior is still worth improving because users can briefly see unavailable wallet/token summaries during exact-tip convergence or audit-load bursts.

### 2. Local `check:live-data` Gate Is Out Of Sync With Current Source Shape

`npm run check:live-data` failed locally on static regex expectations in the marketplace summary/token payload path. The current source uses `canonicalTokenState` after `tokenStateWithCanonicalWorkListingBookForMarketplaceSummary(...)`, while the check expects the older direct `currentTokenState` shape.

Runtime evidence during this audit was green:

- Public consistency passed.
- Marketplace summary passed.
- Full marketplace regression passed after canonical retries.
- WORK precision/math gates passed.

Impact: this looks like a stale repository gate rather than corrupt production data, but it should be repaired or deliberately reclassified because the local live-data check is supposed to be a high-confidence guardrail.

### 3. `check:send-prep-regressions` Fixture No Longer Passes

`POW_API_BASE=https://computer.proofofwork.me npm run check:send-prep-regressions` failed:

```text
armyofyouth send prep: expected at least 1 confirmed UTXO(s), got 0
```

Impact: this did not coincide with any event/log/math corruption. It likely means the fixture address or expected spendable UTXO assumption has drifted. It still needs triage because send-prep correctness is user-facing and regression coverage should not be red.

### 4. UI Deploy Scratch Storage Grew Quickly

The UI VPS is healthy today, but `/var/tmp/proofofwork-deploy` grew from the `837M` noted in audit 3 to `4.9G` in this audit.

Current UI disk:

- Root filesystem: `38G` size, `19G` used, `18G` free, `52%`
- `/var/tmp/proofofwork-deploy`: `4.9G`
- `/var/backups/proofofwork-ui`: `9.8G`
- `/var/www`: `384M`
- `/var/log`: `414M`

Impact: the UI VPS is not near the prior disk-full failure mode, but deploy scratch growth is the clearest near-term storage waste candidate. It should be pruned only from an approved manifest that preserves current release provenance, rollbacks, and deployment evidence.

### 5. Historical Failed Units Still Clutter Node Monitoring

The node/API VPS has no failed live services, but `systemctl --failed` still lists old one-shot/candidate units:

- `proofofwork-api-candidate-93f085b.service`
- `proofofwork-recovery-parity.service`
- `proofofwork-recovery-snapshot.service`
- `proofofwork-reorg-restore-20260826.service`

Impact: no current runtime breakage was found. Clearing or documenting these with an approved ops pass would make future failed-unit scans cleaner and reduce false alarm surface.

### 6. `nft.proofofwork.me` DNS Drift Remains

This is carried forward from audit 3.

Current checks:

- Local runner DNS: unresolved.
- UI VPS DNS: unresolved.
- Caddy config still contains `nft.proofofwork.me`.
- Forced host resolution to the UI VPS IP returned HTTP `200`.

Impact: if the NFT compatibility hostname is public, DNS is missing. If it is not public, docs/Caddy/release smoke behavior should be reconciled in an approved config pass. This is not an indexer/data issue.

## Node/API VPS Health

Host: `pow-bitcoin-01`

Storage:

- `/`: `98G` size, `21G` used, `73G` free, `22%`
- `/data`: `1.7T` size, `1.1T` used, `445G` free, `72%`
- Root inodes: healthy.
- `/data` inodes: healthy.

Largest current storage areas:

- `/data/bitcoin`: `905G`
- `/data/electrs`: `60G`
- `/data/proofofwork-postgres-backups`: `121G`
- `/data/proofofwork-postgres-tablespaces`: `18G`
- `/data/proofofwork-release-backups`: `7.2G`
- `/data/proofofwork-recovery`: `3.6G`
- `/var/log`: `1.2G`
- `/opt`: `4.1G`
- Live API cache: about `246M`

Services:

- `bitcoind`: active, main chain, unpruned, txindex synced.
- `electrs`: active and at tip.
- `postgresql@16-main`: active.
- `proofofwork-api`: active.
- `proofofwork-indexer-worker`: active.
- `pg_receivewal@16-main`: active.
- Node storage and release health timers: active.

Logs:

- Warning-or-higher journal scan over the recent audit window found no live-service warnings for API, indexer worker, PostgreSQL, bitcoind, or electrs.
- API logs did show expected fail-closed exact-checkpoint messages during block advancement and audit load, including fresh payload refresh deferrals and wallet overlay rejections without an exact checkpoint. Those are the same availability class recorded above, not silent stale publication.

Bitcoin Core:

- Chain: main
- Initial block download: false
- Pruned: false
- Blocks/headers at sample: `965179`, then public health later reached `965181`
- txindex synced: true
- Mempool loaded.
- Mempool sample: `36091` txs, `23.6M` bytes, `130.9M` memory usage, `2G` max.

PostgreSQL:

- `proof_indexer` database size: `18G`
- No leftover old production-sized databases were found.
- Query health: no lock waiters, no idle-in-transaction sessions, low fanout.
- Tablespace `proof_indexer_large_state_v1`: `18G`, placement complete, invalid indexes `0`.

Largest relations:

- `proof_indexer.work_amo_block_transitions`: `17GB`
- `proof_indexer.ledger_snapshots`: `812MB`
- `proof_indexer.events`: `107MB`
- `proof_indexer.transactions`: `73MB`
- `proof_indexer.event_participants`: `47MB`
- `proof_indexer.tx_outputs`: `44MB`
- `proof_indexer.event_refs`: `30MB`
- `proof_indexer.tx_inputs`: `19MB`
- `proof_indexer.op_returns`: `19MB`
- `proof_indexer.credit_listings`: `11MB`

Backups:

- Total PostgreSQL backup directory: `121G`
- Logical backups: `61G`
- Physical backups: `50G`
- Recovery evidence: `9.6G`
- Exactly seven daily logical dump sets were present from `2026-08-27` through `2026-09-02`.
- Latest logical dump set: `proof_indexer-20260902T031851Z.dumpset`, about `9.5G`, modified around `03:26 UTC`.

## UI VPS Health

Host: `ubuntu-4gb-hel1-1`

Storage:

- Root filesystem: `38G` size, `19G` used, `18G` free, `52%`
- Inodes: healthy.
- `/var/tmp/proofofwork-deploy`: `4.9G`
- `/var/backups/proofofwork-ui`: `9.8G`
- `/var/www`: `384M`
- `/var/log`: `414M`

Services and timers:

- `caddy`: active.
- UI storage health timer: active.
- UI release/provenance/prune timers: active.
- No failed units.

UI health/provenance:

- `/usr/local/sbin/proofofwork-ui-storage-health`: passed.
- `/usr/local/sbin/proofofwork-ui-release-provenance verify`: verified.
- Release id: `116191e1f58d-20260902T015215Z`
- Commit: `116191e1f58d18c7707fb839b5e79ffdb9a48fdb`
- Archive SHA-256: `735c3b7834620c1da56077d0a32c7e615e8a458267e2e97d4f14af71f7b4f5fd`
- Recent warning-or-higher journal scan for Caddy/UI health/provenance/prune: no entries.

## Public Surface Health

`POW_SURFACE_AUDIT_TIMEOUT_MS=60000 npm run audit:surfaces` passed all configured public surfaces:

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

The first page-only pass hit short-timeout aborts for `proofofwork.me`, `id.proofofwork.me`, and `amo.proofofwork.me`; direct curls were healthy, and the rerun with the 60 second timeout passed. This is a latency/test-budget note, not a surface outage.

## Cleanup Candidates

No cleanup was performed.

Do not delete historical protocol evidence, recovery archives, rollback roots, logical or physical backups, release archives, chain data, or event history without a specific approved manifest.

Candidate areas for a future approved cleanup pass:

- UI deploy scratch: `/var/tmp/proofofwork-deploy` at `4.9G`. This is the clearest non-live growth point.
- UI release backups: `/var/backups/proofofwork-ui` at `9.8G`. Preserve current release provenance and rollback evidence unless a manifest says otherwise.
- Node PostgreSQL backups: `/data/proofofwork-postgres-backups` at `121G`. Retention appears healthy with seven logical sets, but physical/recovery evidence should be classified before any deletion.
- Node `/opt` staging/quarantine trees at `4.1G`. Release health is green; classify before pruning.
- Node release/recovery archives: `/data/proofofwork-release-backups` at `7.2G` and `/data/proofofwork-recovery` at `3.6G`. Preserve by default.
- API cache shadow/quarantine directories: small relative to disk, but can be folded into a broader retention manifest.
- Historical failed systemd units: can be reset or documented in an approved ops cleanup pass so failed-unit scans only show active problems.

## Recommended Next Actions

1. Fix or reclassify `npm run check:live-data` so the local static gate matches the canonical token-state path currently used by production.
2. Triage `check:send-prep-regressions` for the `armyofyouth` confirmed UTXO assumption and update the fixture or endpoint expectation deliberately.
3. Improve fresh wallet exact-checkpoint availability so canonical wallet/token-summary reads converge faster under block advancement and audit load while preserving fail-closed math safety.
4. Prepare an approved UI storage cleanup manifest focused first on `/var/tmp/proofofwork-deploy`, with explicit preserve/delete decisions.
5. Decide whether `nft.proofofwork.me` is public. If public, restore DNS. If not, remove or document the compatibility host in an approved routing/docs pass.
6. Clear or document historical failed systemd units in an approved ops pass.

## Ordered Surface And Computer Audit Append

Date: `2026-09-02`, final samples around `15:12 UTC`.

Mode: read-only production audit. No cleanup, config change, deployment, service restart, database mutation, or production file edit was performed. The only write in this pass is this user-approved audit-log append.

Browser note: the in-app Browser control skill was initialized, but no browser session was available in this Codex environment. Visual/click auditing was therefore not performed. The audit below used HTTP surface checks, API payload checks, source checks, full-node checks, database checks, journals, and production regression scripts.

Prior-audit continuity: this append reviewed the existing audit trail in this file and intentionally does not duplicate resolved issues. Items still reproduced or newly sharpened are called out below.

### Ordered Public Surface Results

The production surface audit passed all configured surfaces with `POW_SURFACE_AUDIT_TIMEOUT_MS=60000 POW_SURFACE_AUDIT_JSON=1 npm run audit:surfaces`. The built-in script does not include `boost.proofofwork.me`, so Boost was checked separately.

| Order | Surface | Page/API result | Notes |
| --- | --- | --- | --- |
| 1 | `proofofwork.me` | page `200`, registry summary `200` | Registry/ID payload indexed through block `965182` during the surface pass, 507 records. |
| 2 | `id.proofofwork.me` | page `200`, IDs summary `200` | Same registry source, 507 records. |
| 3 | `desktop.proofofwork.me` | page `200`, log summary `200` | Log/activity count `25043`. |
| 4 | `browser.proofofwork.me` | page `200`, activity summary `200` | Activity count `25043`. |
| 5 | `boost.proofofwork.me` | page `200`, Boost API `200` | Standalone Boost is live; 2 confirmed Boost posts, 0 pending. |
| 6 | `amo.proofofwork.me` | page `200`, marketplace summary `200` | Compact payload about `4.48 MB`; slowest ordered surface at about `15.7s` in one fresh pass. |
| 7 | `credit.proofofwork.me` | page `200`, token summary `200` | Compact token summary about `3.86 MB`. |
| 8 | `wallet.proofofwork.me` | page `200`, WORK token state `200` | WORK token payload about `3.52 MB`; wallet exact-state availability caveat below. |
| 9 | `work.proofofwork.me` | page `200`, work summary/floor `200` | Work summary about `4.04 MB`; work-floor was slow in the first ordered pass and later recovered. |
| 10 | `infinity.proofofwork.me` | page `200`, infinity summary `200` | POWB summary healthy. |
| 11 | `inception.proofofwork.me` | page `200`, inception summary `200` | INCB summary healthy. |
| 12 | `log.proofofwork.me` | page `200`, log summary `200` | Public log health consistent with ledger activity. |
| 13 | `growth.proofofwork.me` | page `200`, growth summary `200` | Growth totals match WORK floor totals. |
| 14 | `computer.proofofwork.me` | page `200`, health/consistency `200` | Final sample green at block `965186`, lag `0`, missing log events `[]`. |

Final public health/consistency sample:

- Health: `ok: true`, `ready: true`, `indexedThroughBlock: 965186`, `tipHeight: 965186`, `lagBlocks: 0`.
- Health snapshot: `8c5c68df88d5bc5b7dd6e711`, payload bytes `13778765`, every summary key covered through `965186`.
- Consistency: `ok: true`, `status: green`, block hash `00000000000000000000d3b0f4905a4d1dc5366526c311004e9468743df764d3`, missing log events `[]`.
- Consistency metrics: `powids: 505`, `activityItems: 25043`, `confirmedTokens: 238`, `confirmedComputerActions: 25037`, `confirmedTokenMints: 21873`, `confirmedTokenSales: 68`, `confirmedTokenTransfers: 199`.
- Exact value totals matched: WORK actual/network and Growth actual/work-floor all `7915006689915001000` sats in the public JSON number representation; exact script output retained decimal string `7915006689915000725.3639599` sats where the audit command prints the high-precision value.

### Boost Findings

Boost is live as a standalone app and through AMO Boost links, but it is not a Computer workspace folder.

Evidence:

- `src/main.tsx` routes `appSurface === "boost"` to `BoostRoot`.
- `src/App.tsx` `Folder` and `COMPUTER_ROUTE_FOLDERS` include Desktop, Browser, IDs, AMO, Credit, Wallet, WORK, Infinity, Inception, Log, and Contacts, but not Boost.
- `src/App.tsx` standalone route params also omit `boost`.

Boost data health:

- `boost.proofofwork.me` page and assets returned `200`.
- `/api/v1/boost?network=livenet&limit=5&fresh=1` returned `200`.
- Payload contained 2 confirmed Boost posts, 0 pending, both with correct confirmed mempool/chain status.
- The latest Boost post carried proof signal `546` plus exact WORK signal fields: `workSignalSubatoms`, `workSignalValueQ8`, `workSignalValueSatsExact`, `totalSignalQ8`, and `totalSignalSatsExact`.

Boost hardening recommendation:

- `BoostRoot.tsx` currently converts displayed signal values with `Number(item.totalSignalSats)` and `Number(item.workSignalValueSats)`.
- The API and protocol type already expose exact Q8/string fields.
- For future-proof math, Boost UI ranking and totals should prefer exact string/Q8 values and only format down at the presentation edge.

### Full Node, Indexer, Event, And Math Health

Final direct Bitcoin Core sample:

- Chain: `main`.
- Blocks/headers: `965186`.
- Best block hash: `00000000000000000000d3b0f4905a4d1dc5366526c311004e9468743df764d3`.
- Verification progress: `1`.
- Initial block download: `false`.
- Pruned: `false`.
- Core warnings: `[]`.
- `txindex`: synced, best block height `965186`.
- Mempool: loaded, `33564` transactions, `23508751` bytes, `129342664` memory usage, `0.04889736` total fee, `2 GB` max mempool, full RBF true.

Production worker/API health:

- Worker containment inactive, reason `canonical-scan-success`.
- Worker consecutive failures `0`.
- Worker proof source `current-confirmed-replay`.
- Pending event health green: `globalUnresolved: 0`, `q16PendingUnresolved: 0`.
- API and worker advanced to canonical phase complete at the sampled tips.

Computer event audit on node loopback:

- `ok: true`, no failures.
- Ledger status `green`, tip lag `0`.
- Missing log events `0`.
- Confirmed transactions cover canonical action txids: `24400`.
- Confirmed canonical activity events: `25037`.
- Confirmed events missing transaction rows: `0`.
- Confirmed events without confirmed transaction join: `0`.
- Confirmed events missing raw transaction or payload: `0`.
- Confirmed transactions missing raw transaction: `0`.
- Recent/all confirmed transactions missing block metadata: `0`.
- Event search indexes populated: `53386` refs and `125419` participants.

ID registry audit on node loopback:

- Fetched registry transactions: `562`.
- Covered confirmed registry transactions: `560`.
- Covered pending registry transactions: `2`.
- Canonical lifecycle parity: verified against exact Core-ordered chain replay.
- Lifecycle events: `534`.
- Active listings: `5`.
- Canonical sales: `4`.
- Registration attempts: `524`.
- Confirmed winners: `505`.
- Pending candidates: `2`.
- Refund candidates: `17`.
- Pending watchlist: `0`.

Math/regression gates:

- `POW_API_BASE=https://computer.proofofwork.me npm run audit:ledger`: passed.
- `POW_API_BASE=https://computer.proofofwork.me npm run check:mail-regressions`: passed.
- `POW_API_BASE=https://computer.proofofwork.me npm run check:credit-mint-regressions`: passed.
- `POW_API_BASE=https://computer.proofofwork.me npm run check:marketplace-regressions:full`: passed in this audit.
- `npm run check:ui`: passed.
- `npm run check:api-truth`: passed.
- `npm run check:client-read-containment`: passed.
- `npm run check:worker-containment`: passed.
- `npm run check:work-precision-v2`: passed.
- `npm run check:bond-exact-arithmetic`: passed.
- `npm run check:index-recovery-behavior`: passed.
- `npm run check:incb-range-replay-witness`: passed.
- `npm run check:hardening`: passed.
- `npm run check:node-ops`: passed.
- `npm run check:ui-ops`: passed.

Exact WORK atom audit on node loopback:

- `ok: true`.
- Projection: `work-subatoms-v2`, precision `q16`, decimals `16`.
- Confirmed supply: `210000000000000000000000` subatoms, matching `21,000,000 WORK`.
- Negative balances: `0`.
- Invalid atom/subatom/precision events: `0`.
- Ambiguous exact events: `0`.
- Mismatched atom events: `0`.
- Oversubscribed active sellers: `0`.
- Historical sealing oversubscription count remains `5` and is not a live spendable balance break.

### Current Red/Yellow Items

1. Manual parity script is not a dependable live audit gate right now.

   A direct node run of `node scripts/check-proof-indexer-parity.mjs` returned nonzero during this audit. One run was dominated by a moving-tip readiness race with `canonical-tip-not-current`; a narrowed rerun failed on `/api/v1/marketplace-summary` returning HTTP `503` while the indexed registry checkpoint was catching up to Core. The immediate follow-up loopback probe recovered:

   - Full marketplace summary: `200`, `13.80s`, about `4.50 MB`.
   - Compact marketplace summary: `200`, `6.36s`, about `4.48 MB`.
   - Fresh compact marketplace summary: `200`, `6.68s`, about `4.49 MB`.
   - Fresh work-floor: `200`, `3.09s`, about `93 KB`.

   Also, `proofofwork-indexer-worker` currently has `POW_INDEX_WORKER_PARITY=0`. The worker's canonical scan and readiness path is green, but the explicit parity child is disabled. Recommendation: add a stable-tip/manual parity mode that does not fail because a block arrives mid-check, then re-enable or deliberately document the worker parity schedule.

2. Fresh exact marketplace/wallet reads can fail closed during catch-up.

   API logs during audit load showed expected safety failures:

   - `The indexed registry checkpoint is catching up to Bitcoin Core.`
   - `Fresh wallet credit state is temporarily unavailable...`
   - `Confirmed protocol transaction order is incomplete.`

   Public health and consistency recovered green, and no stale/wrong data was observed. This remains the most important availability/speed hardening item because users can see temporary 503s or long waits even while the canonical math is safe.

3. `npm run check:live-data` still fails as a stale local static gate.

   This is carried forward because it reproduced. The failure expects older marketplace summary source text around `currentTokenState`; the source now uses the canonical token-state path. Runtime/API checks are green, but the guardrail should be repaired or reclassified.

4. `POW_API_BASE=https://computer.proofofwork.me npm run check:send-prep-regressions` still fails.

   This is carried forward because it reproduced:

   ```text
   armyofyouth send prep: expected at least 1 confirmed UTXO(s), got 0
   ```

   No ledger corruption was observed, but send-prep regression coverage should not remain red.

5. Boost is not integrated into `computer.proofofwork.me`.

   This matches the user's note. Decide whether Boost should become a first-class Computer folder or remain a standalone surface linked from AMO/Mail.

### Database And Storage Health

Node/API VPS `pow-bitcoin-01`:

- `/`: `98G` size, `21G` used, `73G` free, `22%`.
- `/data`: `1.7T` size, `1.1T` used, `445G` free, `72%`.
- Inodes healthy: root `5%`, data `1%`.
- Memory: `124Gi` total, about `104Gi` available.
- Failed units still historical: `proofofwork-api-candidate-93f085b.service`, `proofofwork-recovery-parity.service`, `proofofwork-recovery-snapshot.service`, `proofofwork-reorg-restore-20260826.service`.
- Recent warning-or-higher logs for API, worker, PostgreSQL, bitcoind, and electrs: no entries in the final warning scan.

Largest node storage areas:

- `/data/bitcoin`: `905G`.
- `/data/electrs`: `60G`.
- `/data/proofofwork-postgres-backups`: `121G`.
- `/data/proofofwork-postgres-tablespaces`: `18G`.
- `/data/proofofwork-release-backups`: `7.2G`.
- `/data/proofofwork-recovery`: `3.6G`.
- `/data/proofofwork-api-cache`: `246M`.
- `/var/log`: `1.2G`.
- `/opt`: `4.1G`.

PostgreSQL:

- `proof_indexer` database size: `18 GB`.
- Largest relation: `work_amo_block_transitions` at `17 GB`.
- Other largest relations: `ledger_snapshots` `812 MB`, `events` `107 MB`, `transactions` `73 MB`, `event_participants` `47 MB`, `tx_outputs` `44 MB`, `event_refs` `30 MB`, `tx_inputs` `19 MB`, `op_returns` `19 MB`, `credit_listings` `11 MB`.
- Autovacuum/analyze has run recently on the hot tables; dead tuples were low relative to table sizes in the sampled stats.

UI VPS `ubuntu-4gb-hel1-1`:

- `/`: `38G` size, `19G` used, `17G` free, `53%`.
- Inodes healthy: `6%`.
- Memory: `3.7Gi` total, about `3.1Gi` available.
- Active: `caddy`, UI storage health timer, release provenance timer, release prune timer.
- Failed units: none.
- UI storage health: passed.
- UI release provenance: verified release `116191e1f58d-20260902T015215Z`, commit `116191e1f58d18c7707fb839b5e79ffdb9a48fdb`, archive SHA-256 `735c3b7834620c1da56077d0a32c7e615e8a458267e2e97d4f14af71f7b4f5fd`.
- Recent warning-or-higher logs for Caddy/UI health/provenance/prune: no entries.

Largest UI cleanup candidates:

- `/var/tmp/proofofwork-deploy`: `5.5G`, including repeated surface/source deployment dirs and tarballs from `2026-08-31` through `2026-09-02`.
- `/var/backups/proofofwork-ui`: `9.8G`, with `rollbacks` `5.3G`, `releases` `1.9G`, `rollback-classifications` `1.7G`, `rollback-roots` `384M`, `cleanup-evidence` `161M`.
- `/var/www`: `384M`.
- `/var/log`: `382M`.

No stale or wasted storage was removed. For the next approved cleanup pass, start with a manifest for `/var/tmp/proofofwork-deploy` because it is non-live scratch and grew the fastest. Preserve release provenance, current roots, rollback evidence, backups, recovery material, chain data, and audit evidence unless the cleanup manifest explicitly classifies a path for deletion.

### Speed/Data Handling Recommendations

1. Split heavy fresh route payloads by default: AMO, Credit, Wallet, and WORK should load small active-state summaries first, then page historical/detail payloads.
2. Precompute and serve route-specific compact projections for public surfaces so a user landing page does not pay the full `3.5 MB` to `4.5 MB` token/marketplace payload cost.
3. Coalesce exact-tip refreshes: when several surfaces request `fresh=1`, one canonical refresh should satisfy all waiters instead of each route racing the same checkpoint.
4. Add a stable-tip parity/audit mode: pin a known Core height/hash at the start, audit against that height, and report new blocks as skipped rather than failing the parity process.
5. Re-enable or deliberately document worker parity. Current worker health is green, but `POW_INDEX_WORKER_PARITY=0` makes parity a manual-only discipline.
6. Move Boost display/ranking math to exact Q8/string values.
7. Fix the stale `check:live-data` and `check:send-prep-regressions` gates so local red means real risk again.
8. Prepare an approved UI deploy-scratch cleanup manifest before `/var/tmp/proofofwork-deploy` grows back toward the previous disk-full failure class.
