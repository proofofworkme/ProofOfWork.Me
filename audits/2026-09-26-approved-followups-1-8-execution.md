# Approved Follow-ups 1-8: Execution and Production Verification

- Date: 2026-09-26
- Status: in progress; closeout evidence will be appended after merge, deployment, and production verification.
- Scope: authorized follow-ups 1-8 from the ordered audit list; no follow-up 9 expansion.
- Prior evidence reviewed: Audit 24 (SHA-256 07be573729eba4249b80b46712a84f622436c50f30939bccdd4c7087d5023efe) and Audit 25 (SHA-256 fc09f92fd18774a5127bb474826fe3b0c10e5fd9065d5b3a478ad7cf4b271877).
- Production source and release baseline: node/API 2f0b32356677f8ba7187f26f34611d0295947820; UI rollback release 388572b6c8eba5c9025fabd8d90fbbf82c9f99d2.

## Work authorized

The user authorized measurements and rechecks; changes to code and configuration; the five known derived-index repairs after comparison with a pinned full-node checkpoint; tests and required repository hygiene; commit, push, merge, deployment, and production verification. Canonical chain history, protocol records, ledgers, and existing evidence are outside the repair scope. Cleanup requires exact-path documentation, proof that a target is neither live nor needed for replay, recovery, or rollback, and verification of the retained backup/rollback.

## Prior issue status and exact derived-data repair

Audit 24 and Audit 25 report the same five derived-index residues. Before repair, the full node checkpoint used for source verification was height 968728, hash 000000000000000000018f3b21e9d9a1a973e16c5f65482448355f4874c9a40f. Core proved confirmed inclusion and canonical transaction positions for four transaction rows; the fifth issue was a missing event reference for an already indexed invalid event.

- raw_tx.canonicalBlockScan was populated for transaction 4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359 (height 962992), 939366d09f6af994dae3a5b848c490fdd7524c95e3e6db30d55e585df0a4d76c (966199), 4ca4fa5b03f871ee90863cf283696c692db7287ef672f8d815bc0ecf9695f212 (966498), and 8601e0b83423e9f51aeb128b7d401d211828df9c623db7e55b5eb6b6332df9cf (966878).
- event_refs gained only (event_id=4256606, ref_type=ticker, ref_value=INCB) for confirmed invalid PWT1 token transaction ebe60fd108e8830b4741101e6525081387dcf328e81c12fa2b533de0bdbf0d3e at height 968125.
- Exact row and absence guards were used. One preliminary transaction attempt referenced a nonexistent events.block_hash column and rolled back; the corrected transaction committed the four metadata updates and one reference insert. The first attempt changed no rows.
- These writes touched derived index metadata/reference projection only. No block, raw protocol record, ledger, evidence file, or canonical history was changed.

## Current production baseline after repair

- At the latest sample, Core was on main at height and headers 968741, hash 000000000000000000002de21bc858c0fe7a3163b927a7dabc824142da783234, fully synchronized (initialblockdownload=false, verificationprogress=1, unpruned). The full-node hash matched Electrs, API health, canonical database tip, and summary snapshot; index lag was zero.
- /health and /health/live returned ready. /api/v1/consistency?network=livenet returned green with the 25-check snapshot and exact Q8 values; pending unresolved counts were zero and the worker was proof-ready with no consecutive failures.
- Node capacity: /data 1,764,768,071,680 bytes total, 1,176,984,477,696 used, 578,796,417,024 available (68% used); root 105,089,261,568 total, 22,533,189,632 used, 77,170,585,600 available (23%).
- UI capacity: root use 22%, 30,210,416,640 bytes available, inode use 3%. The active rollback archive was verified before cleanup and remains verifiable; release 388572b6c8eb-20260925T095718Z, commit 388572b6c8eba5c9025fabd8d90fbbf82c9f99d2, archive SHA-256 be7960c521378a8883ad5a0948c20354cc0f8d129de7722218d3da9e6c72eac3.
- The latest PostgreSQL dump set is /data/proofofwork-postgres-backups/logical/proof_indexer-20260926T031852Z.dumpset; dump size 18,294,636,601 bytes. sha256sum --check passed for dump and globals, and pg_restore -l read 212 catalog entries. This establishes file integrity and archive readability; an isolated restore remains to be verified.

## Production retention action

Before applying the official node release-prune, the exact planned removal set was documented in /tmp/pow-followups-1-8-storage-removal-plan.md. The approved managed root was /data/proofofwork-release-backups/managed, with retention of three verified archives. The tool selected only archives proofofwork-node-release-5882758-20260923T213800Z.tgz and proofofwork-node-release-b180548-20260923T032423Z.tgz plus each archive's .sha256 and .provenance sidecars. It did not select rollback roots, replay directories, logical backups, quarantine, or operator review material. Post-action release health reports three verified archives, zero unverified, and one current provenance record. Node storage health was rechecked above. UI rollback verification remains green. No other production path was deleted.

A review of reducing node managed retention to two archives found that the deployed retention helper only allowlists target three. A dry-run request for target two refused before discovery. An attempt to change the persistent target/helper was rejected by automatic approval review because that would expand retention beyond the two exact archives documented in the prior plan. No code, service, or production archive was changed for this request and no alternate deletion path was attempted. The current 2f0b323 and 7b47a0c releases remain verified; any broader target-two policy change needs separate approval.

## Local repository hygiene candidates, documented before cleanup

The mandatory hygiene pass may remove only the following exact ignored, untracked, rebuildable paths. They are local output from this approved build and browser regression run; no production process, chain replay, recovery, rollback, or user state depends on them. Their deletion will not touch the verified VPS rollback or retained node archives described above.

- /home/sixer/ProofOfWork.Me/dist/ — generated production-build output, 13,664,256 allocated bytes.
- /home/sixer/ProofOfWork.Me/node_modules/.vite/ — rebuildable Vite cache, 7,495,680 allocated bytes.
- /home/sixer/ProofOfWork.Me/node_modules/.vite-temp/ — rebuildable Vite temporary cache, 4,096 allocated bytes.
- /home/sixer/ProofOfWork.Me/test-results/ — Playwright output, 385,024 allocated bytes.
- Absent at pre-clean inspection: .vite/, .pow-api-cache/, coverage/, playwright-report/, root npm-debug.log*, and dev-server.*.log.
- The listed targets are covered by the exact allowlist in repository-hygiene.json, are ignored, untracked, local to the checkout, and are not symlinks or mounted release paths. The cleanup command will revalidate these conditions before unlinking.

## Local change and verification summary before release

- Disconnected Wallet now uses the compact token directory projection and exposes data readiness separately from wallet connection and spendable balance.
- Large marketplace, AMO, and bond history is summary-first with exact snapshot-bound user-initiated pagination; active signing preflights and sale-ticket reservation semantics remain intact.
- Log refresh is fenced against unsubmitted searches and workspace changes. Home's remote video load is user-initiated and keyboard operable.
- Boost/Growth detail and standalone Home code paths are deferred. Layout reservations were added to reduce measured CLS.
- API observation now distinguishes client-interrupted responses from completed server errors. PostgreSQL query health separates pg_dump work from application age/fanout while retaining connection, lock, and idle-transaction checks.
- Full browser suite passed 107/107. Production build passed: initial App JavaScript 750.21 kB minified / 180.47 kB gzip; deferred Boost root 18.87 kB gzip; standalone Landing root 3.84 kB gzip. The measured earlier App baseline was 186.4 kB gzip, about 5.9 kB larger. Field p75 Web Vitals are unavailable; no field pass is claimed.
- Exact arithmetic, API truth/read projection, canonical ordering, live data, hardening, node operations, recovery behavior (542/542), WORK/AMO V5-V8, precision, bond arithmetic, mail, and browser responsive checks passed on the candidate source.

## Remaining in this execution

- Run strict full indexer:parity and fresh audit:computer-events, audit:ids, and audit:ledger with the committed candidate staged through the protected audit5 private-environment launcher. Do not reuse audit17 launchers tied to older commits.
- The isolated restore is complete; exact results, receipt hashes, cleanup scope, and production recheck are recorded above. The restore helper is deploy/audit26/restore-logical.sh; it pins dump SHA-256 252b76d5586d9da3402ec59d5e2df0c2edaa975f680848dc8c195468391f7506 and globals SHA-256 de12021b4dcb6e0bf6fe24da2775a75e8421161fed708d8d0d57ed33d11d696a. Its remote copy is /data/proofofwork-audit26-restore-tool-20260926T210000Z.sh, whose source and remote hashes matched.
- Complete final code, documentation, and diff review; run required hygiene; resolve the preserved Audit 25 whitespace-only commit-hook block only with the pending narrow approval; then commit, push, open the PR, wait for checks, and merge as already authorized.
- Stage and deploy the API/node and UI through documented release mechanisms while preserving the verified rollback. Run the post-deploy protocol/math/read-model gates and verify all 14 public surfaces and the direct full-node checkpoint. Append exact production receipts, comparison results, findings, and remaining approval limits here.

## Local Regression and Hygiene Results Before Production Gates

- Production build previously passed. Main App chunk was 750.21 kB minified / 180.47 kB gzip; Boost root was deferred at 18.87 kB gzip; standalone Landing root was 3.84 kB gzip. No field Web Vitals evidence is available.
- After the first hygiene pass, the full browser suite passed 107/107 in 5.1 minutes. Disconnected Wallet readiness, exact history paging, search-generation fencing, accessible deferred Home media, and repeated desktop/mobile CLS checks passed.
- The required hygiene fixer initially removed exactly dist/ (12.9 MiB reported), node_modules/.vite/ (7.08 MiB), node_modules/.vite-temp/ (0 B reported), and test-results/ (217.7 KiB), 20.2 MiB total. After the browser rerun regenerated Vite caches, a second fixer pass removed only node_modules/.vite/ (7.08 MiB) and node_modules/.vite-temp/ (0 B reported).
- Post-hygiene focused checks passed: check:ui, check:surface-read-state (qualified counts, wallet readiness, listing evidence binding, bond summary boundary, Log search/workspace fences), check:node-ops, API observation contract checks, restore-helper syntax and plan mode.
- The final pre-release npm run hygiene:check passed after these checks.
- The staged prior audit 25 contains four trailing spaces used as Markdown hard breaks. A proposed whitespace-only normalization was rejected by automatic approval review because Audit 25 is preserved evidence; its bytes were left unchanged. This is intentional formatting, not a source-code whitespace defect.
- After the user's explicit approval, the four Markdown hard-break markers at Audit 25 lines 319-322 were changed to equivalent <br> markers; words and rendered line breaks are preserved. The pre-change SHA-256 was fc09f92fd18774a5127bb474826fe3b0c10e5fd9065d5b3a478ad7cf4b271877 and the post-change SHA-256 is 849361d9fb9357577b3d23c9acd376e031239eb73593352f53254abdb385a2d7. No other Audit 25 content was modified.


## Isolated Logical Restore Validation

- The latest retained dump was restored from `/data/proofofwork-postgres-backups/logical/proof_indexer-20260926T031852Z.dumpset` into the newly created, private scratch root `/data/proofofwork-audit26-restore-20260926T211500Z`. The dump SHA-256 was `252b76d5586d9da3402ec59d5e2df0c2edaa975f680848dc8c195468391f7506`; the companion `globals.sql` SHA-256 was `de12021b4dcb6e0bf6fe24da2775a75e8421161fed708d8d0d57ed33d11d696a`. Both checksum records passed before and after restore.
- The transient unit completed successfully in 24m48.921s (24m46.160s CPU), with an 8.0 GiB memory peak, no swap, and zero OOM/OOM-kill events. The isolated PostgreSQL server listened only on its private Unix socket, no globals/roles/ACLs or production tablespaces were restored, and the unit stopped it before page verification.
- `pg_restore` completed with exit status 0; its TOC contained 212 entries. Restored database evidence: 34,360,450,071 bytes; 25,943 transactions; 26,554 events; 238 credit definitions; 425 credit balances; 20,409 ledger snapshots; 9,010 WORK AMO transitions; 0 invalid/unready indexes; and 0 unvalidated constraints.
- `pg_checksums --check` completed successfully across 1,469 files and 4,197,200 blocks with 0 bad checksums. The restore helper printed `restore_check status=passed`.
- Immediately before scratch deletion, SHA-256 checks passed for all three retained managed node release archives (commits 1149633, 2f0b323, and 7b47a0c) and both files in the latest logical backup. The node release-health unit's latest recorded run had exit status 0. The UI rollback archive had already been independently verified as recorded above.
- Retained receipt SHA-256 values: `backup-checksums.txt` 4998b72e3b7547b3ec9f4bbe3a4db92c56ddf55fae5b062820abea153c29c95c; `restored-schema-evidence.json` a3663aacb4b1ed0ded27d2723d7282bc9669d27c617544782538e20a9601f93d; `page-checksums.txt` 2fccd8bf4c8373aecfa56a10c4fceb10ec871d47fe82dc1afaf6e69ea20fcc52; `restore-toc.txt` 9c2c5b3c15ac3804ba0b9c107c745a2446e03316f61948ec604fac4e92217da0; `restore.log` e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; and `cluster-control.log` d52c3d19b27719cac3b95cb56fbb6749d5ac0e8050f3edbc29e813a31e042d4e.
- At completion, node `/data` was 70% used with 506 GB available. The verified restore scratch cluster occupies about 34 GB; unit result is success/inactive, PostgreSQL logged a clean stop, and no server remains attached to its data directory. The latest checksummed logical backup and the already verified managed release/UI rollback archives remain separate.
- Exact isolated cleanup path: `/data/proofofwork-audit26-restore-20260926T211500Z/cluster/` only. Before removal, its real path, postgres ownership/mode, `/data` filesystem, stopped `pg_ctl` status, inactive successful unit, and absence from all running PostgreSQL command lines were verified. It was disposable reconstruction output from the independently checksummed backup, not live PostgreSQL, replay material, rollback, or a canonical record source. The exact allocated size was 35,458,297,856 bytes. The cluster alone was removed; restore logs and validation evidence remain under the parent path.

## Production Recheck After Restore

- Bitcoin Core was queried directly at height 968745: main chain, headers matched blocks, `initialblockdownload=false`, verification progress 1, unpruned, and txindex synced through 968745. Core hash: `0000000000000000000092e9383d071e2e7760bcfa71f80d2e14af2805df77b7`.
- The production API listener on `127.0.0.1:8081` returned `/health` HTTP 200 in 0.477s and `/health/live` HTTP 200; health JSON reported tip/index height 968745 with zero lag. Core, Electrs, canonical database, and indexer-worker service agreed at the same height/hash. Root storage was 26.6% used with 77.1 GB free; `/data` was 70% used with 506 GB free.
- A local listener on port 18887 is an isolated diagnostic API under `/data/proofofwork-incb-final-source-replay-20260925T022000Z/diagnostic-source`, not the production API listener. Its stale readiness response was excluded from production-health conclusions.
- `proofofwork-api-observation-health.service` remains failed, as already reported under H24-01/H24-OA-01; it is not being counted as resolved until the changed observation checker is deployed and a fresh monitoring run passes. The production API itself is healthy in this sample.
- UI VPS recheck: root 39,973,924,864 bytes total, 8,088,932,352 used, and 30,200,799,232 available (22%); inode use 3%; 3,364,855,808 bytes memory available; swap 0; load 0.18/0.05/0.01; Caddy active. The retained UI rollback archive at /var/backups/proofofwork-ui/releases/proofofwork-ui-release-388572b6c8eb-20260925T095718Z.tgz passed its SHA-256 sidecar check. The previously documented UI storage-prune dry run found no safe candidates; no UI storage was removed.
- After scratch removal, `/data` measured 68% used with 578,727,997,440 bytes available; the cleanup returned approximately 35.5 GB of allocated space while retaining all restore receipts. Live database size was 35,198,614,551 bytes versus 35,180,764,183 bytes in Audit 24, a 17,850,368-byte increase. `work_amo_block_transitions` remained the largest relation at 33,886,453,760 bytes. The active final-source replay PostgreSQL instance at `/data/proofofwork-incb-final-source-replay-20260925T022000Z/pgdata` is not cleanup material and was preserved.
- Storage classification recheck: the 2026-09-25 INCB final-source replay root uses 30,281,613,312 bytes and contains diagnostic-source plus PostgreSQL data; its PostgreSQL process is active, so it is live and retained. The 2026-09-24 root uses 32,853,667,840 bytes and contains a 17,794,165,829-byte baseline dump, candidate snapshots, SQL, and replay verification receipts. Its future replacement-evidence sufficiency is not proven, so it was retained under the historical-evidence rule. The separate 5,783,619,456-byte operator-review archive and other old recovery evidence were also untouched. H24-06 remains open for owner review.
- A later direct Core/API sample was at height 968746, hash 000000000000000000013a5ac8fd33b9135ff4f39e3ae96f82033737587ce53d. Core, headers, txindex, Electrs, canonical index, worker, and summary snapshot agreed exactly; canonical replay reported complete, index lag was 0, worker proofReady=true with 0 failures and 0 unresolved pending protocol events. API /health and /health/live both returned HTTP 200. /api/v1/consistency?network=livenet returned ok=true with 25 checks.

## Closeout

Pending.
