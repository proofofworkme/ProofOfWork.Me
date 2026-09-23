# Production Remediation and Verification Audit 22

**Audit date:** September 22, 2026 (local); verification continued through September 23, 2026 02:58 UTC.<br>
**Scope:** approved remediation of open findings from Audits 20–21; local source and browser checks; read-only production API regression checks; host access and release readiness.<br>
**Base revision:** a18cae48fdf486eca8168a28fdd114c33c3f7dfb.<br>
**Predecessors:** Audits [20](2026-09-22-production-comprehensive-health-data-integrity-audit-20.md) and [21](2026-09-22-production-comprehensive-health-data-integrity-audit-21.md), with their evidence bundles. The companion [Audit 22 evidence](2026-09-22-production-comprehensive-health-data-integrity-audit-22.evidence.json) records predecessor hashes, checks, post-merge production verification, and release blockers.

## Executive result

Local remediation is implemented and the relevant deterministic and browser suites pass. The read-only production mail-history regression passed across eight mailbox cases. The live marketplace regression **failed**: the current production API still returned the pre-unit WORK AMO relic in exact closed-listing history (H9-01), and the check took about 39.5 seconds before that assertion. The local source now closes that exact-query path and its 529-case recovery suite passes. It was committed as `365d80f` and merged into `main` as `17b0101` after repository-hygiene CI passed on Node 20, 22, and 24. A post-merge live recheck still returns the relic, confirming the source correction has not reached production.

This is a **partial remediation, not a production completion**. The production VPS addresses were reachable, but the available SSH identities were rejected for both hosts. No production filesystem, configuration, database, service, backup, ledger, or protocol record was changed. The repository has no GitHub Actions deployment workflow; it does include guarded host-side UI staging/publication and node publication/exchange tools. Those require authorized host access, exact release artifacts, capacity/rollback proof, and post-deploy attestations. Capacity/retention cleanup, restore proof, log rotation, production deployment, and final production verification remain blocked because host authentication and safe recovery evidence are unavailable. The reviewed source merge is complete; the remaining blockers concern production operations.

## Systems and surfaces checked

- Local application source, proof index readers, API route logic, protocol math and exact-integer Boost writers.
- ID and Desktop rendering, Log status rendering, marketplace summary preview and AMO/history pagination.
- Local browser app through the targeted Playwright surface-read-state suite.
- Read-only production ProofOfWork API through the mail-history and marketplace regression gates.
- UI and node operations/capacity contract tests. Production host state itself was not refreshed because SSH authentication was unavailable.

## Changes prepared

- ID registry rendering distinguishes verified empty data, loading, last-verified data and unavailable reads; a transient empty or malformed refresh no longer fabricates a canonical zero.
- Desktop file identity merges the inbox/sent views of one self-send artifact while preserving distinct transactions that publish identical bytes.
- Log rows render chain confirmation state and network beside semantic content tags.
- Transaction details use fresh canonical status and fail closed when first-party providers are unavailable; dropped requires a proven absence rather than a provider outage.
- Boost satoshi amounts, listing prices and spent outpoints reject fractional, unsafe or malformed values rather than rounding, flooring, coercing or silently omitting an exclusion.
- Marketplace summary listing arrays are now a bounded 40-item preview, including sealed listings. The live regression gate now exhausts the exact cursor-paginated WORK listing history and reconciles every sealed item and known closed/invalid fixture against that complete book.
- Mail event-history overlays follow opaque cursors under one snapshot, enforce exact coverage and reject changed snapshots, repeated cursors, duplicate event identities, and incomplete exhaustion. The relational mail query no longer silently stops at 1,000 rows.
- Stale Marketplace and Mail documentation now labels superseded behavior as historical and documents current verified-read and bounded-preview rules.
- Stale local contract checkers were updated to exercise current exact math/read contracts rather than obsolete source-shape assumptions.

No source change rewrites chain history, balances, protocol events, a ledger, refunds, keys, or seed material.

## Verification results

| Check | Result |
| --- | --- |
| npm run build | Passed. Existing bundle-size warning remains: largest minified chunk about 770 kB (about 187 kB gzip). |
| npx playwright test --config playwright.ui.config.mjs tests/browser/surface-read-state.spec.mjs | Passed, 11/11. |
| npm run check:boost-regressions | Passed, 31/31, including fractional/unsafe satoshi and outpoint rejection. |
| npm run check:index-recovery-behavior | Passed, 529/529. |
| npm run check:work-precision | Passed, 131 exact-unit checks. |
| npm run check:read-projections | Passed, 5/5. |
| node --test server/event-history-pages.test.mjs server/transaction-detail.test.mjs | Passed, 10/10. |
| node --test scripts/complete-token-history-pages.test.mjs | Passed, 4/4 cursor completeness and fail-closed pagination tests. |
| npm run check:work-precision-v2, check:audit19-accounting, check:bond-exact-arithmetic, check:incb-range-replay-witness, check:work-amo-v8 | Passed in the approved remediation run. |
| npm run check:ui-capacity | Passed, 7 storage/publisher safety contracts; these are local contracts, not current VPS measurements. |
| npm run check:ui-ops and npm run check:node-ops | Passed. |
| npm run check:live-data, check:api-truth, check:ui, check:client-read-containment, check:api-client-timeouts | Passed after refreshing stale test contracts. |
| npm run check:mail-regressions against https://computer.proofofwork.me | Passed. Registry response reported 527 records; all eight sampled sender/recipient histories returned scanFailed=false, including the historical dropped-mail witness and indexed event overlay case. |
| POW_API_BASE=https://computer.proofofwork.me npm run check:marketplace-regressions | The first fast-gate run **failed against current production** at the WORK AMO V5 exact closed-listing assertion: pre-unit relic 4e9ced…b6feb1 was returned. Request for closed-listing history took 37.27 s; the failing fast gate completed in 39.53 s. This confirms H9-01 remains open in production and that summary/history latency remains material. The gate now includes full-listing cursor exhaustion and sealed/stale-item reconciliation, but the run stopped at H9-01 before reaching those checks. |
| Post-merge `POW_API_BASE=https://computer.proofofwork.me npm run check:marketplace-regressions` | **Failed again against production** at the same exact WORK AMO V5 closed-listing assertion. The same pre-unit relic `4e9ced…b6feb1` remains in the response; request took 37.401 s and the gate failed after 39.689 s. This confirms merging source did not deploy it. Full-book cursor exhaustion and sealed/stale-item reconciliation remain unverified in production because the gate stops at this failure. |
| npm run hygiene:fix | Three allowlisted cleanup passes: the first removed ignored dist/ (12.9 MiB), node_modules/.vite (7.08 MiB) and empty node_modules/.vite-temp; after the next build regenerated dist/, the second pass removed that 12.9 MiB output and empty node_modules/.vite-temp; after the final validation build, the last pass removed dist/ (12.9 MiB), node_modules/.vite (7.08 MiB), and empty node_modules/.vite-temp. No production storage was cleaned. |
| Repository npm run hygiene:check; git diff --check | Passed after the Audit 22 report and inventory were added. |

The build and green local tests establish source-level behavior only. They do not establish current production source, full-node tip, database parity, backup restoreability, or live UI correctness after release.

## Previously reported issues rechecked

| Finding | Audit 22 disposition |
| --- | --- |
| H5-02 cold ID false-zero | Local browser coverage now verifies loading, confirmed empty, unavailable/malformed, and regressing refresh states. Production status remains unverified because the fix is not deployed. |
| H20-03 duplicate Desktop self-send tile | Local browser test passes: one self-send file is one tile, while a second transaction remains a separate tile. Production status remains unverified. |
| H20-04 missing Log confirmation label | Local browser test passes for Confirmed, Mainnet, and content tags together. Production status remains unverified. |
| H19-02 provider outage shown as false 404; H19-03 stale cached confirmation across reorg | Local transaction-detail tests pass for unavailable providers, Core-proven absence, fresh pending status overriding cached confirmation, fresh canonical block replacing an older confirmation, and strict provider timeout. No live fault injection was performed; production deployment is pending. |
| H9-01 pre-unit WORK listing and exact-history leakage | **Still open in production after source merge.** The post-merge live gate reproduced the relic leak; local reader behavior is corrected and the recovery contract suite passes, but production still serves the old behavior. |
| H6-03 mail history pagination/truncation | Local reader/paginator contract rejects incomplete or mixed-snapshot pages; live mail regression passed all eight sampled histories. This does not prove every address or every historical row. |
| H7-01 / H10-07 / A11-03 summary size and latency | Local summary listing projection is capped at 40, with full-book pagination retained. Not production-verified. Previous Audit 21 recorded a 32.0 MB summary and slow responses; the post-merge live marketplace gate still took 39.7 seconds across its failed AMO V5 check. |
| Stale Marketplace/Mail instructions | Current docs were reconciled and old June behavior explicitly marked historical. |
| H5-01 / H13-01 UI capacity reserve | **Open and not refreshed.** Audit 21's last verified measurement was only 80,510,976 B (76.78 MiB) above the 10 GiB reserve and 13,402,112 B (12.78 MiB) above the deploy helper's additional 64 MiB margin. |
| H8-05 / H10-02 backup retention and database growth | **Open.** No current complete database restore proof or safe one-rollback candidate was established. No production backup was removed. |
| H20-01 unbounded container logs | **Open.** Active container logging configuration is not tracked here and host access was unavailable. No truncation or rotation change was made. |

## New finding

| Finding | Severity | Source and impact | Correction and verification |
| --- | --- | --- | --- |
| H22-01 unproven transaction absence labeled dropped | Medium | In server/proof-api.mjs, an empty provider fallback without a canonical Core absence proof could return a dropped detail. On networks or outages without authoritative absence evidence, this can misstate transaction status. | The local route now returns unavailable (503) unless Core proves absence. The transaction-detail suite passes 7/7, including this path. Not yet deployed. |

## Current health, storage and release blockers

- Audit 21 remains the latest host inventory: UI free space 10,817,929,216 B, only 76.78 MiB beyond reserve; database about 32.35 GB, with work_amo_block_transitions about 30.96 GB. These are dated values and must not be represented as current.
- The last database dump had checksums and a readable 202-entry TOC but had not been restored. No new restore rehearsal was possible. A checksum/TOC is not a restore proof.
- Older UI rollback roots and archives, old database dumps, node release archives/checkouts, and log files remain candidates only. No exact production object was re-inventoried, proven safe, or removed. Historical audit evidence and chain-backed transition data remain protected.
- Read-only SSH to UI 77.42.91.106 and node 65.108.122.87 reached the hosts but failed authentication (Permission denied (publickey,password) on UI; Permission denied (publickey) on node). No interactive/key material was requested or handled.
- The only GitHub Actions workflow found is repository-hygiene CI; it does not deploy. The repository contains guarded host-side tools (`deploy/proofofwork-ui-release-stage.py`, `deploy/proofofwork-ui-release-publish.sh`, `deploy/proofofwork-node-release-publish.sh`, and `deploy/proofofwork-node-release-exchange.py`). They require an authenticated operator on the target host; that access was unavailable here.
- The live AMO history response latency is a current concern. Optimization must preserve the exact Core-bound listing lifecycle and complete pagination; do not hide the returned relic with a preview-only UI filter.

## Actions, approval, and next steps

Local source, test, and documentation remediation was committed as `365d80faddcb6cb13275d2ba606fc18530158c30` in [PR #55](https://github.com/proofofworkme/ProofOfWork.Me/pull/55). All repository-hygiene CI jobs passed on Node 20, 22, and 24. The PR merged into `main` as `17b0101c71f62a07d1b393115040cf6e5268ba73`; its tree `194a87425fe3266a6fd04f4f495813cf0745bcb0` matches the exact merge tree reviewed before merge.

The merge did not deploy production. A post-merge read-only marketplace gate again returned the pre-unit relic in exact closed-listing history after a 37.401-second request (39.689 seconds total to failure). No production filesystem, configuration, database, service, backup, log, ledger, or protocol record was changed, and no production cleanup was performed. The read-only production mail regression passed eight sampled cases.

The user has approved the remediation scope, source commit/push/PR/merge, and storage cleanup only after exact safety proof. **The remaining blocker is operational access and recovery proof, not user approval.** Until those are available:

1. Keep all production rollback, backup, WAL, logs, and transition history unchanged.
2. Provide an authorized host-side operator/deployment path; do not send private keys or seed material in chat. Remeasure exact UI reserve and node/database growth.
3. Restore-test the newest complete logical backup (including globals/roles) in an isolated target and rehearse the compatible UI/API rollback without changing canonical production records.
4. Inventory exact container definitions before designing log rotation; prove rotation does not truncate active logs or remove evidence.
5. Revalidate each named cleanup candidate under the installed retention lock and preserve one exact compatible, restore-proven rollback per purpose before removing any older copy.
6. Once host readiness is proven, deploy the already-merged `main` revision `17b0101` using the approved release procedure, then rerun exact-tip/API/UI gates. The H9-01 live gate must pass before calling production complete.
