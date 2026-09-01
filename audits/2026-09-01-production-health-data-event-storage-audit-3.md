# Production Health, Data, Event, And Storage Audit 3

Date: 2026-09-01
Mode: read-only production audit, plus this approved audit log
Scope: public API, node VPS, UI VPS, PostgreSQL, event/indexer accuracy, math gates, host routing, logs, storage, and prior audit continuity.

No data, backups, services, DNS, production config, commits, pushes, or deployments were changed.

## Prior Audit Continuity

Reviewed the active protocol/product docs and previous audit/remediation logs before logging findings so already-recorded repairs were not duplicated:

- `2026-08-31-production-health-data-event-storage-audit-2.md`
- `2026-08-31-postgresql-retention-remediation-2c.md`
- `2026-08-31-postgresql-retention-remediation-2e.md`
- `2026-08-31-storage-retention-node-manifest.md`
- `2026-08-31-storage-retention-ui-manifest.md`
- Relevant 2026-08-23, 2026-08-28, and 2026-08-30 audit notes where they overlapped with current storage, parity, and UI health.

This audit preserves the previous conclusions that confirmed chain history is canonical, old evidence is not stale by default, and cleanup must be done only from an approved manifest.

## Final Health Snapshot

Final public health recovered to exact tip after a new block arrived during the audit:

- `/health?network=livenet`: `ok: true`, `ready: true`
- Tip/indexed height: `964961`
- Tip/indexed hash: `00000000000000000000622ffdaa163dffbc810de5796a1bd6b16b6de4926f9f`
- Canonical summary snapshot: `246209fc08ce3eb769e46fc5`
- Lag: `0`
- Worker: `ok: true`, `proofReady: true`
- Pending event health: `globalUnresolved: 0`, `q16PendingUnresolved: 0`

Observed transient behavior: immediately after block `964961` arrived, the node and index were at `964961` while the summary snapshot was still `964960`; `/health` and `/health/live` reported not ready until the new exact-tip snapshot published. It recovered within the audit window. This was fail-closed behavior, not stale publication.

## Green Accuracy Checks

Public and loopback checks that passed:

- `/api/v1/consistency?network=livenet&fresh=1`: `ok: true`, `missingLogEvents: []`, no failed checks at block `964961`.
- `npm run audit:ledger` against `https://computer.proofofwork.me`: passed, snapshot `8f2093fc8474ad99d999eb43`, value `7466957362756571486.97802181` proofs during the earlier tip.
- `npm run check:mail-regressions` against production: passed.
- `npm run check:marketplace-regressions`: fast production suite passed.
- `npm run audit:computer-events` on the node VPS loopback/API/DB: passed with `25,321` total events, `24,774` confirmed canonical activity events, `124,100` participants, `52,234` refs, and zero missing confirmed raw transactions.
- `npm run audit:ids` on node loopback/API/DB: passed. It fetched `561` registry transactions, covered `559` confirmed plus `2` pending, verified canonical lifecycle parity, and found `504` confirmed winners.
- `npm run indexer:parity` on node loopback/API/DB: exited `0`. Output was extremely large and tool-truncated, but sampled checks included successful event/read-model parity and WORK AMO evidence checks.
- Local static gates passed: `check:work-precision-v2`, `check:bond-exact-arithmetic`, `check:incb-range-replay-witness`, `check:api-truth`, `check:hardening`, `check:ui`, `check:node-ops`, `check:ui-ops`, and `check:index-recovery-behavior`.

## Findings

### 1. Fresh WORK Token Payload Missing Core Listing Authority Proof

`npm run check:marketplace-regressions:full` failed:

```text
Error: Fresh WORK token payload lacks a complete stable-tip Core sale-ticket authority proof
```

Direct sample after health recovered:

- Endpoint: `/api/v1/token?network=livenet&asset=WORK_TOKEN_ID&fresh=1`
- Source: `proof-indexer-events+proof-indexer-derived-token-value-state+proof-indexer-token-state-tables`
- Listings rendered: `381`
- Versions rendered: `381` V8, `0` V1
- `listingAuthority: null`

Fresh listing history and Marketplace summary did carry Core authority proofs:

- `/api/v1/token-history?...kind=listings&fresh=1`: `listingAuthority.model = proof-token-market-core-gettxout-v1`
- `/api/v1/marketplace-summary?network=livenet&fresh=1`: token listing authority present at block `964961`

Impact: current data appears healthy, and Marketplace/listing-history proof metadata exists, but the standalone fresh WORK token endpoint is missing the proof object required by the full verifier. This can make independent verification of that endpoint incomplete and caused the full production marketplace audit to fail.

### 2. Fresh Wallet Reads Can Temporarily Fail Closed During Exact-Tip Convergence

The full marketplace audit saw repeated:

```text
503 CANONICAL_WALLET_INDEX_UNAVAILABLE
Fresh wallet credit state is temporarily unavailable
```

The same wallet read later returned successfully with:

- `source: proof-indexer-wallet-token-overlay+proof-indexer-wallet-address-state`
- `authoritativeWallet: true`
- No live incorrect balance was observed.

Impact: this protects math by refusing stale wallet state, but exact fresh wallet surfaces may briefly fail during tip/snapshot convergence. This is related to, but not a duplicate of, the 2026-08-31 wallet fresh-read flicker note because it still reproduced under the full audit load.

### 3. WORK Atom Precision Audit Fails On Sealing Reservation Scope

The actual audit-only command with the production V8 pin environment reached the marker gate and failed on:

```text
WORK atomic migration preflight found oversubscribed listing reservations.
```

The failing preflight counts seller reservations across `status IN ('active', 'pending', 'sealing')`.

Production detail:

- Active/pending-only oversubscribed sellers: `0`
- With sealing rows included: `4` oversubscribed sellers
- WORK `credit_listings` status totals: `31 active`, `0 pending`, `419 sealing`, `69 dropped`
- Version/status rows include `47` historical `pwt-sale-v1` sealing rows and `372` `pwt-sale-v8` sealing rows.

Sampled oversubscribed historical V1 sealing listing:

- Listing `b4cb35b7939be0b28570a69477fd04fd5fdf3cd6d8fd2b726c28bfaab1263aaa`
- Status: `sealing`
- Version: `pwt-sale-v1`
- Public `log-history`: preserved as confirmed history.
- Fresh WORK listing history: not rendered as current inventory.
- Fresh Marketplace summary: not rendered as current WORK inventory.

Impact: no sampled stale V1 sealing row was rendered as buyable WORK inventory, but the production atom audit fails because the preflight treats sealing rows as reserving current seller spendability. This blocks a clean atom precision audit result and should be resolved by a deliberate classification/repair decision, not by deleting history.

### 4. Local `check:live-data` Contract Is Stale Or Out Of Sync

`npm run check:live-data` failed on wallet scoped token read regex assertions. Runtime code still contains the fail-closed `CANONICAL_WALLET_INDEX_UNAVAILABLE` path, `check:index-recovery-behavior` passed, and production wallet reads returned `authoritativeWallet: true` after convergence.

Impact: likely a stale static assertion around code order/shape, but because it is a repository gate it should be repaired after the wallet endpoint behavior is reviewed.

### 5. Node Release Health/Prune Housekeeping Is Failed

Current active services are healthy, but node release housekeeping units are failed:

- `proofofwork-node-release-health.service`: `CRITICAL live node path is not its Git checkout root`
- `proofofwork-node-release-prune.service`: `Refusing retention without archive provenance for the live node commit and tree`

This is a recurrence of the release provenance/prune class from previous audits. It is not breaking the API today, but it blocks automated retention of `/data/proofofwork-release-backups/managed` (`6.6G`) and should be fixed before it becomes storage pressure.

### 6. UI Release Provenance Had A Transient Failure Then Recovered

UI provenance service failed at `2026-09-01 00:00:12 UTC`:

```text
Release surface contains foreign-owned content: /var/www/proofofwork-computer
```

Later timer/manual checks succeeded:

- `2026-09-01 00:15 UTC`: verified
- `2026-09-01 00:30 UTC`: verified
- `2026-09-01 00:45 UTC`: verified
- Manual verification: `status=verified`, release `32f39776afb2-20260831T235646Z`

Impact: no current UI provenance failure, but the transient foreign-owned-content failure should be checked during the next deployment/provenance pass.

### 7. `nft.proofofwork.me` DNS/Host-Map Drift

The production Caddyfile and static files include `nft.proofofwork.me`, and forcing the host to the UI VPS IP returned HTTP `200`. Public DNS lookup failed:

```text
curl: (6) Could not resolve host: nft.proofofwork.me
```

The primary production-domain list in `OP_RETURN_INFRASTRUCTURE.md` does not list NFT, while release smoke/provisioning and Caddy do.

Impact: if NFT is intended to be public, DNS is missing. If NFT is not intended to be public, Caddy/release smoke/docs should be reconciled in an approved config pass.

## Storage And Database Health

Node VPS `pow-bitcoin-01`:

- `/`: `20%` used, `75G` free
- `/data`: `72%` used, `452G` free
- Root inodes: `4%`; `/data` inodes: `1%`
- Storage health script: root and `/data` passed.
- PostgreSQL query health: `5` connections, `1` active, `0` lock waiters, `0` idle-in-transaction.
- `proof_indexer` DB: `18G`
- Largest table: `proof_indexer.work_amo_block_transitions`, `16G`
- Bitcoin Core: main chain, unpruned, IBD false, txindex synced, no warnings.
- Mempool sample: `31,377` txs, about `110 MB` usage of `2 GB` max.
- Node logs: `/var/log` `1.2G`; journal `1.0G`.

Node storage hotspots:

- `/data/bitcoin`: `905G`
- `/data/proofofwork-postgres-backups`: `115G`
- `/data/electrs`: `60G`
- `/data/proofofwork-postgres-tablespaces`: `18G`
- `/data/proofofwork-release-backups`: `7.1G`
- `/data/proofofwork-recovery`: `3.6G`
- `/data/proofofwork-api-cache`: `176M`

Backups:

- Logical backups: `58G`
- Physical backups: `47G`
- Recovery evidence: `9.6G`
- Latest seven logical dump sets present from `20260826T193848Z` through `20260831T031857Z`.
- Next logical backup: `2026-09-01 03:18:48 UTC`; the next keep=7 backup had not run yet during this audit window.

UI VPS `ubuntu-4gb-hel1-1`:

- `/`: `30%` used, `26G` free
- Inodes: `4%`
- UI storage health: passed.
- Caddy and UI storage/provenance/prune timers: active.
- UI logs: `/var/log` `427M`; Caddy logs `22M`; journal `242.3M`.

UI storage hotspots:

- `/var/backups`: `7.0G`
- `/var/backups/proofofwork-ui`: `6.0G`
- `/var/backups/proofofwork-ui/rollbacks`: `3.4G`
- `/var/backups/proofofwork-ui/releases`: `1.7G`
- `/var/tmp`: `1.3G`
- `/var/tmp/proofofwork-deploy`: `837M`

The UI VPS is not close to the previous disk-full failure mode.

## Public Host Sweep

Expected responses:

- `www.proofofwork.me`: `200`
- `proofofwork.me`: `301`
- `id.proofofwork.me`: `200`
- `computer.proofofwork.me`: `200`
- `desktop.proofofwork.me`: `200`
- `browser.proofofwork.me`: `200`
- `boost.proofofwork.me`: `200`
- `amo.proofofwork.me`: `200`
- `marketplace.proofofwork.me`: `308`
- `growth.proofofwork.me`: `200`
- `log.proofofwork.me`: `200`
- `credit.proofofwork.me`: `200`
- `token.proofofwork.me`: `301`
- `tokens.proofofwork.me`: `301`
- `wallet.proofofwork.me`: `200`
- `work.proofofwork.me`: `200`
- `infinity.proofofwork.me`: `200`
- `inception.proofofwork.me`: `200`

Unexpected/drift:

- `nft.proofofwork.me`: public DNS unresolved, but Caddy/static serve `200` when resolved directly to the UI VPS IP.
- `mail.proofofwork.me`: unresolved and not configured in Caddy; this is expected under the current docs because mail lives under the Computer app rather than a separate production hostname.

## Cleanup Candidates

No cleanup was performed.

Do not delete historical protocol evidence, recovery archives, logical/physical backups, release archives, or rollback roots without a specific approved manifest.

Candidates for a future approved cleanup/retention pass:

- Fix node release provenance first; then allow release prune to manage `/data/proofofwork-release-backups/managed` (`6.6G`).
- Re-check the post-`2026-09-01 03:18:48 UTC` logical backup and verify it with `pg_restore --list` before pruning any additional backup material.
- Classify `/data/proofofwork-recovery` and `/data/proofofwork-postgres-backups/recovery-evidence` before considering removal; they are evidence by default.
- UI storage is healthy, but `/var/backups/proofofwork-ui` (`6.0G`) and `/var/tmp/proofofwork-deploy` (`837M`) can be reviewed in the existing UI manifest path if space pressure returns.

## Recommended Next Actions

1. Fix `/api/v1/token?asset=WORK&fresh=1` so fresh standalone WORK token reads carry the same Core sale-ticket `listingAuthority` proof as Marketplace summary/listing history, or fail closed when the proof is unavailable.
2. Decide the correct treatment of `sealing` rows in the WORK atom audit preflight. Historical V1 sealing rows should remain replayable but should not block current Q16 precision verification if they are not current spendable inventory.
3. Repair or reclassify node release provenance so release-health and release-prune can pass again.
4. Reconcile `nft.proofofwork.me`: either add DNS and docs if public, or remove it from Caddy/release smoke if not public.
5. Update `check:live-data` wallet-scoped assertions after confirming the runtime wallet fail-closed behavior remains correct.
6. Verify the next logical backup after it runs on 2026-09-01 at 03:18 UTC.

## Requested Surface Audit Addendum

Audit window: 2026-09-01 01:25-01:49 UTC.
Mode: read-only production surface audit, plus this already-approved audit log append.
Scope: the requested host order, public rendering health, public endpoint health, full-node state, mempool/pending state, PostgreSQL/event accuracy, both VPS storage maps, and previous audit continuity.

No services, data, backups, DNS, production config, commits, pushes, deployments, or cleanup actions were changed.

### Browser Coverage Note

The in-app Browser runtime was unavailable (`No browser is available`), so rendering checks used read-only headless Chrome/DOM fetches and public API probes. This is a test-tooling limitation only; the public endpoints rendered/answered from production.

### Ordered Surface Render Audit

1. `proofofwork.me` / `www.proofofwork.me`
   - Initial render returned the homepage but briefly showed `The indexed registry checkpoint does not match Bitcoin Core.`
   - Re-render shortly after tip convergence recovered to `Full-node ProofOfWork ID registry summary verified.`
   - Registry APIs were green at block `964965`; treat this as a transient fail-closed exact-tip UI state, not durable registry corruption.
2. `id.proofofwork.me`
   - Rendered `ProofOfWork IDs`; wallet-disconnected state said `ProofOfWork Computer ready. Connect UniSat to load account data.`
   - Public registry read: HTTP `200`, block `964965`, `506` records, `5` listings, `4` sales, `0` pending events.
   - Node-loopback ID replay later verified exact Core-ordered lifecycle parity at the newer tip: `561` fetched registry transactions, `559` confirmed covered, `2` pending covered, `504` confirmed winners, `5` active listings, `4` canonical sales.
3. `desktop.proofofwork.me`
   - Rendered `ProofOfWork Desktop | Open a public ProofOfWork desktop.`
   - Seeded public file sender mail returned HTTP `200`: `1` inbox, `1` sent, `2` indexed events, `scanFailed: false`.
   - File attachment was present on the sent message: `pepe mic drop.jpeg`, `image/jpeg`, `6284` bytes, SHA-256 `98e75adcc612894c206681ab4eab4e4e5a2fa0b3d07169cc00aaaa57f38b422a`.
4. `browser.proofofwork.me`
   - Default route rendered `Enter a ProofOfWork txid to load verified HTML.`
   - Welcome tx route rendered `Verified confirmed HTML page.` for txid `8c2fd17cc7f83926563de05cba23063a4cc3356884b3bd6df5e60f54407d3015`, status `Confirmed`, source `Message body`, size `1018 B`, payment `546 proofs`, and SHA-256 `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`.
5. `amo.proofofwork.me`
   - Rendered `ProofOfWork AMO`, `WORK AMO State`, `Credit Markets`, and `Credit Sale Tickets`.
   - Marketplace summary returned HTTP `200`, block `964965`, snapshot `be4cf91ad74648379aa6499c`, `238` tokens, `382` listings, `40` closed listings, `40` sales.
   - Listing authority was present: `proof-token-market-core-gettxout-v1`.
6. `credit.proofofwork.me`
   - Rendered `Credits`, `Create credit`, `Mint credit`, `DRAIN holders`, `DRAIN mints`, `Credit index`, and `Created credits`.
   - Token summary returned HTTP `200`, block `964965`, snapshot `be4cf91ad74648379aa6499c`, `238` tokens, `381` listings, `40` closed listings, `40` sales.
7. `wallet.proofofwork.me`
   - Default disconnected route rendered `Wallet`, `Connect UniSat`, `Balances`, `Transfer`, `List`, `Transfer log`, and `No movements yet`.
   - Seeded wallet reads returned `authoritativeWallet: true` and `walletScoped: true`.
   - Carbonz WORK wallet sample: holders `1`, current listings `0`, closed listings `3`, transfers `1`, sales `1`, and Carbonz closed listing present.
   - Known transfer wallet sample: holders `1`, listings `11`, closed listings `2`, sales `4`, transfers `17`, known transfer present.
8. `work.proofofwork.me`
   - Rendered `WORK`, `Live WORK floor`, `Mint WORK`, `Credit facts`, `Top holders`, and `Mint log`.
   - Displayed `21,000,000 / 21,000,000 WORK confirmed`, `350` holders, `21,000` confirmed mints, floor `355,569,536,991.4912252 proofs / WORK`, and network value `7,466,960,276,821,315,729.29674497 proofs`.
   - Public WORK token endpoint returned only current V8 listing data, but still lacked standalone `listingAuthority` (same strict issue logged above).
9. `infinity.proofofwork.me`
   - Rendered `Infinity Bonds`, `Infinity Bond Market`, `Infinity Bond Chart`, `Create Bond`, `Balances`, `Transfer`, and `List`.
   - Summary returned supply `630,196,569 POWB`, floor `1.00000606 proofs / POWB`, network value `630,200,391 proofs`, holders `12`.
10. `inception.proofofwork.me`
    - Rendered `Inception Bonds`, `Inception Bond Market`, `Inception Bond Chart`, `Create Bond`, `Balances`, `Transfer`, and `List`.
    - Summary returned supply `224,847,713,398,447,926 INCB`, floor `1 proofs / INCB`, network value `224,847,713,398,447,947.9358206 proofs`, holders `7`.
11. `log.proofofwork.me`
    - Rendered `Log loaded from indexed ledger. 24,784 computer actions tracked.`
    - Log summary/history returned HTTP `200`, block `964965`, total count `24,784`.
12. `growth.proofofwork.me`
    - Rendered current network value around `7,466,960,276,821,315,729.29674497 proofs` and `24,781` confirmed computer actions.
    - Growth summary returned HTTP `200`, block `964965`, snapshot `be4cf91ad74648379aa6499c`, floor `355,569,536,991.4912252 proofs`.
13. `computer.proofofwork.me`
    - Default disconnected route rendered the Computer inbox shell with `Install UniSat` and empty local folder counts.
    - `/api/v1/consistency?network=livenet&fresh=1` returned green with `missingLogEvents: 0`, no failed checks, and all required summary coverage at exact tip.
    - Node-loopback `audit:computer-events` later passed at block `964967`, snapshot `cd7b40c101dd3dc322cf54c8`, with zero missing confirmed transaction/event/raw/block joins.

### Full Node, Mempool, And Pending Status

- Bitcoin Core at `pow-bitcoin-01`: main chain, blocks/headers `964965` during the first node check, best hash `00000000000000000000df32c8140ec435b7baf937ca161a199fe67da319915f`, IBD `false`, pruned `false`, verification progress `1`, no warnings.
- Core mempool: loaded, size `29,710`, bytes `20,411,181`, usage `109,835,904`, max mempool `2,000,000,000`, unbroadcast count `0`, full-RBF enabled, datacarrier size `100000`, `optimal: true`.
- API/indexer health at the same tip: `ready: true`, worker `ok: true`, `proofReady: true`, pending events `globalUnresolved: 0`, `q16PendingUnresolved: 0`, checked `3`, stale candidates `3`.
- Database event status snapshot: confirmed valid `24,781`, confirmed invalid `328`, dropped invalid `168`, dropped valid `30`, pending invalid `12`, pending valid `3`.
- Node-loopback computer event audit at block `964967`: total events `25,322`, confirmed valid events `24,781`, confirmed canonical action txids `24,150`, transactions confirmed `24,446`, event refs `52,240`, event participants `124,105`, confirmed mail items `610`, op_returns `24,568`, no failures or warnings.

### Math And Accuracy Gates

Passed:

- `npm run check:work-precision-v2`
- `npm run check:bond-exact-arithmetic`
- `npm run check:incb-range-replay-witness`
- `POW_API_BASE=https://computer.proofofwork.me npm run audit:ledger`
- `POW_API_BASE=https://computer.proofofwork.me npm run check:mail-regressions`
- `POW_API_BASE=https://computer.proofofwork.me npm run check:marketplace-regressions` fast suite
- Node-loopback `npm run audit:computer-events`
- Node-loopback `npm run audit:ids`

Failed as expected from the previous strict issue:

- `POW_API_BASE=https://computer.proofofwork.me npm run check:marketplace-regressions:full`
- Failure: `Fresh WORK token payload lacks a complete stable-tip Core sale-ticket authority proof`

No arithmetic mismatch was observed in WORK, Growth, Infinity, or Inception values. The visible math issue is proof completeness on the standalone WORK token endpoint, not a wrong displayed total.

### Freshly Reproduced Speed And Data-Handling Issues

- Several default UI renders were slow enough to exceed an 18s compact render cutoff; longer direct renders succeeded:
  - `wallet.proofofwork.me`: about `27.4s`
  - `work.proofofwork.me`: about `24.0s`
  - `infinity.proofofwork.me`: about `18.1s`
  - `inception.proofofwork.me`: about `15.9s`
  - `credit.proofofwork.me`: about `12.5s`
  - `amo.proofofwork.me`: about `9.1s`
  - `log.proofofwork.me`: about `9.6s`
- Public endpoint timings worth optimizing:
  - desktop public mail: `9935ms`
  - log history: `9169ms`
  - marketplace summary: `8326ms`
  - work summary: `8005ms`
  - work floor: `5269ms`
  - registry: about `5.1-5.3s`
- The fast marketplace regression reproduced transient exact-tip `503` responses:
  - `CANONICAL_WALLET_INDEX_UNAVAILABLE`
  - `CANONICAL_INDEX_CATCHING_UP`
  - Both recovered on retry and protected correctness by failing closed, but they are user-visible latency/reliability issues.
- One non-fresh seller wallet read took `31541ms`.
- A multi-anchor fresh wallet read needed four attempts and about `25984ms` total before passing.
- API logs repeatedly included `Accepted proof-index ... fallback without current coverage proof; serving latest complete indexed summary while refresh continues.` Health recovered green, but this fallback path should be made crisper in UI/API semantics so users see `catching up` rather than scary mismatch language.

### Current VPS Storage And Service Health

Node VPS:

- `/`: `98G` total, `19G` used, `75G` available, `21%` used; inodes `4%`.
- `/data`: `1.7T` total, `1.1T` used, `452G` available, `72%` used; inodes `1%`.
- Memory: `124Gi` total, `109Gi` available; swap `15Gi`, about `635Mi` used.
- Active: `bitcoind`, `electrs`, `postgresql@16-main`, `proofofwork-api`, `proofofwork-indexer-worker`, `pg_receivewal@16-main.service`.
- Recent warning/error journal scan for API/indexer/Postgres/Core/electrs returned no warning-or-higher entries in the sampled two-hour window.
- Failed housekeeping/recovery units remain the same class as the prior audit: candidate API, node release health/prune, recovery parity/snapshot, and the 2026-08-26 reorg restore unit.
- Fresh `/data` size map:
  - `/data/bitcoin`: `905G`
  - `/data/proofofwork-postgres-backups`: `115G`
  - `/data/electrs`: `60G`
  - `/data/proofofwork-postgres-tablespaces`: `18G`
  - `/data/proofofwork-release-backups`: `7.1G`
  - `/data/proofofwork-recovery`: `3.6G`
  - `/data/mempool`: `1.1G`
  - `/data/proofofwork-api-cache`: `176M`

UI VPS:

- Host: `ubuntu-4gb-hel1-1`; checked at `2026-09-01 01:43 UTC`.
- `/`: `38G` total, `11G` used, `26G` available, `30%` used; inodes `4%`.
- Memory: `3.7Gi` total, `3.0Gi` available; no swap configured.
- No failed systemd units.
- Caddy active since `2026-08-12 06:03:49 UTC`; latest storage health, provenance, storage prune, and release prune runs succeeded.
- Caddy status included intermittent reverse-proxy incomplete-response lines (`connection reset`, `stream canceled`, `timeout: no recent network activity`), but not a service crash.
- Journal warning stream was dominated by UFW blocks. UI provenance had earlier transient failures but the latest status was verified.
- Fresh UI size map:
  - `/var/backups`: `7.0G`
  - `/var/backups/proofofwork-ui`: `6.0G`
  - `/var/backups/proofofwork-ui/rollbacks`: `3.4G`
  - `/var/backups/proofofwork-ui/releases`: `1.7G`
  - `/var/tmp`: `1.3G`
  - `/var/tmp/proofofwork-deploy`: `837M`
  - `/var/tmp/proofofwork-ui-q16-v7-preactivation-a007263-final`: `183M`, explicitly retained by the storage-prune job as unmarked.
  - `/var/www`: `383M`, including several `*.pre-rollback-current-20260825T134644Z` trees around `13M` each.

### Cleanup Review Candidates

No cleanup was performed.

Candidates for a future approved manifest, in priority order:

1. Node: resolve release provenance/prune first, then let the managed retention job classify `/data/proofofwork-release-backups` (`7.1G`).
2. Node: keep `/data/bitcoin`, `/data/electrs`, and `/data/proofofwork-postgres-tablespaces` as live data. They are large by design and not cleanup targets.
3. Node: classify `/data/proofofwork-postgres-backups` (`115G`) only through the backup verification flow; the next logical backup was due `2026-09-01 03:18:48 UTC` and was not due yet during this pass.
4. Node: preserve `/data/proofofwork-recovery` (`3.6G`) as evidence until the recovery units are explicitly closed out.
5. UI: review `/var/backups/proofofwork-ui/rollbacks` (`3.4G`) and `/var/backups/proofofwork-ui/releases` (`1.7G`) through the existing UI retention manifest.
6. UI: classify `/var/tmp/proofofwork-deploy` (`837M`) and the retained Q16 preactivation path (`183M`) before deletion; the prune job intentionally retained one unmarked candidate.
7. UI: review the `*.pre-rollback-current-20260825T134644Z` static trees in `/var/www` only after proving they are not active rollback roots.

### Recommendations After This Read-Only Phase

1. Fix the standalone fresh WORK token response so it carries the same stable-tip Core sale-ticket authority proof as AMO summary and listing history, or fails closed when that proof is not available.
2. Add/repair a UI `catching up to full node` state for homepage registry and wallet/token fresh reads so users do not see a registry mismatch message during normal exact-tip convergence.
3. Optimize wallet and summary hydration paths. The worst observed surface loads were 15-31s; precomputed wallet overlays, smaller default payloads, and lazy history tabs would materially improve the product without relaxing correctness.
4. Reclassify historical `sealing` listing rows so replay evidence remains preserved but current spendability and atom precision audits are not blocked by non-current reservations.
5. Add synthetic monitoring in the exact requested host order, with assertions for title/primary heading, key API block height, `confirmed/pending/dropped` status labels, and value math string equality.
6. Repair node release provenance/prune and then run a manifest-based retention pass. This is the correct way to reduce storage without risking live data or audit evidence.
7. Add a compact `indexer:parity` report mode. The current full output is useful but too large for recurring LLM recursion; a deterministic pass/fail summary with hashes would be better.
8. Keep exact integer/string math at boundaries. Large values such as WORK network value and INCB supply should continue to be compared as decimal strings/BigInt-derived exact values, not JavaScript floats.

## Approved Local Remediation Addendum

Date: 2026-09-01
Mode: local repository changes only, user-approved for audit items 1, 2, 3, 4, and 7.

No deployment, production config change, production restart, data deletion, backup deletion, or production cleanup was performed.

Local changes made:

- Fresh standalone WORK token reads now pass through `tokenReadResponsePayload`, which requires a complete `proof-token-market-core-gettxout-v1` listing authority proof for livenet fresh WORK responses. If the proof cannot be attached from the spendable-listing reconciliation, the API fails closed with `CANONICAL_WORK_LISTING_AUTHORITY_UNAVAILABLE`.
- Registry checkpoint mismatch copy now says the indexed registry checkpoint is catching up to Bitcoin Core, while preserving the existing fail-closed `core-checkpoint-mismatch` reason.
- Wallet UI read-state handling now treats `CANONICAL_WALLET_INDEX_UNAVAILABLE` as an explicit transient wallet-proof state and tells users wallet actions remain unavailable until the wallet proof catches up.
- The WORK atom reservation audit now fails on current `active`/`pending` oversubscription only, while reporting `sealing_oversubscribed_sellers` as historical sealing diagnostics. Historical sealing rows remain replayable evidence and are not deleted or hidden.
- Added `npm run audit:surfaces`, a read-only synthetic production surface audit that checks the requested host order, HTML shell rendering, key public JSON probes, response timing, consistency, and Core listing-authority presence.
- Updated local regression/static checks so the repaired contracts are covered without duplicating prior audit issues.

Local verification completed before hygiene:

- `node --check server/proof-api.mjs`
- `node --check scripts/audit-production-surfaces.mjs`
- `node scripts/audit-production-surfaces.mjs --help`
- `npm run check:client-read-containment`
- `npm run check:node-ops`
- `npm run check:index-recovery-behavior`
- `npm run check:live-data`
- `npm run check:api-truth`
- `npm run check:ui`
- `npm run build`
- `git diff --check`

## Approved UI Release And WORK Projection Follow-Up

Date: 2026-09-01
Mode: user-approved production UI publish plus local/API remediation for the
remaining active WORK listing projection bug.

This addendum extends the previous findings without duplicating them. No data,
backups, release archives, rollback evidence, database rows, or production
configuration were deleted or cleaned up.

UI rollback-root classification and release publication:

- Classified the retained rollback root
  `/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-32f39776afb2-20260831T235646Z`
  as legacy rollback evidence and moved it, without deletion, to
  `/var/backups/proofofwork-ui/rollbacks/proofofwork-www-pre-32f39776afb2-20260831T235646Z`.
- Preservation evidence was recorded under
  `/var/backups/proofofwork-ui/rollback-classifications/proofofwork-www-pre-32f39776afb2-20260831T235646Z-20260901T032907Z`.
- Complete-root evidence archive:
  `/var/backups/proofofwork-ui/rollback-classifications/proofofwork-www-pre-32f39776afb2-20260831T235646Z-20260901T032907Z/proofofwork-www-pre-32f39776afb2-20260831T235646Z.complete-root-20260901T032907Z.tgz`
  with SHA256
  `020c3546b7f135068d8c2e54945c9c0193c1362394c57ddc182947555d1e29f8`.
- The first classification verifier compared the legacy rollback evidence
  manifest to the newer active release provenance format and exited non-zero
  after the move. The follow-up classification note records this as a format
  mismatch, not data loss. Active rollback verification passed afterward.
- Published the already-built UI release
  `ec97e1817dd8-20260901T022632Z` for commit
  `ec97e1817dd87793f506cf4eba5035052dc3fc33`.
- Published release archive:
  `/var/backups/proofofwork-ui/releases/proofofwork-ui-release-ec97e1817dd8-20260901T022632Z.tgz`
  with SHA256
  `dd7af29f510787a5d32c3123a7f72bd66091af53098e9f33eee6afb060a8e362`.
- The publisher created the current rollback root
  `/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-ec97e1817dd8-20260901T022632Z`;
  it remains preserved as release evidence.
- External HTTPS archive smoke passed for the requested 13 roots in order:
  `proofofwork.me`, `id.proofofwork.me`, `desktop.proofofwork.me`,
  `browser.proofofwork.me`, `amo.proofofwork.me`, `credit.proofofwork.me`,
  `wallet.proofofwork.me`, `work.proofofwork.me`,
  `infinity.proofofwork.me`, `inception.proofofwork.me`,
  `log.proofofwork.me`, `growth.proofofwork.me`, and
  `computer.proofofwork.me`. The smoke verified the active provenance sidecar
  and byte-compared live HTTPS HTML against the release archive.

Remaining active WORK listing projection remediation:

- Production pre-fix sampling showed `36` legacy `pwt-sale-v1` rows still
  rendering as active on the standalone fresh WORK token payload, even though
  current post-V8 WORK active inventory must be `pwt-sale-v8` only.
- The cause was a projection gap where token read/response wrappers and indexed
  active-listing recovery could preserve or reintroduce legacy WORK listings
  after the V8 current-listing policy had already run elsewhere.
- `server/proof-api.mjs` now applies the current WORK active-listing policy
  before spendable-listing reconciliation, after spendable reconciliation, in
  the response wrapper, and after indexed active-listing recovery.
- The policy now recognizes authorization versions from nested authorization
  objects and the top-level `authorizationVersion` field, so valid V8 rows are
  preserved while legacy WORK rows are removed from current active views.
- This does not delete historical `pwt-sale-v1` rows, change confirmed event
  history, or alter non-WORK sale-ticket behavior.

Local verification for the WORK projection patch:

- `node --check server/proof-api.mjs`
- `node --check scripts/check-index-recovery-behavior.mjs`
- `npm run check:index-recovery-behavior`
- `npm run check:work-amo-v8`
- `npm run check:work-precision`
- `npm run check:api-truth`
- `git diff --check`

Production API deployment and post-deploy verification are pending at the time
of this local addendum.
