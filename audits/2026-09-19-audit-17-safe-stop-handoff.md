# Audit 17 — safe stop and lower-usage handoff

User explicitly requested a safe stop to conserve weekly usage and resume with
a less expensive model such as Luna light. Do not automatically resume work or
start another model/task. Wait for the user to resume. Standing implementation
approval remains in the conversation; do not ask again for already approved work.

## Verified stop state

- Node production: `1f467cc59f41ed284f89d854ebd943525fe5b525`.
- UI production: `6eb4a1e07131fc0b27d381dda52986f9d1bf3398` (unchanged by node-only work).
- Main and remote audit branch: `567823b`, containing completed rollout evidence.
- Local branch `codex/audit17-writer-hardening`: `589bc71e7c967782fda66bb9193fe0e31a89a03a`.
  This additional candidate is committed locally, **not deployed or pushed**.
- Temporary `proofofwork-audit17-floor-shadow.service` stopped, MainPID 0.
- The bounded warm comparison finished before shutdown. No audit probe remained
  matching the exact two active-run paths checked by the stop procedure.
- Production API/worker, Core, Electrs, PostgreSQL and WAL receiver remain active;
  API/worker PIDs 2034219/2034231 and authority PIDs
  1324302/1324320/1324240/1649219 were unchanged by shutdown.
- No production restart, data repair, cleanup or deployment was performed to stop.
- No off-host encryption/transfer/restore has started; no new restore container
  was created. The local tool download/image pull completed and were retained.

## Completed and pushed

Read the existing Audit 17 log and `2026-09-19-audit-17-rollout.evidence.json`
before repeating work. Retain existing issue IDs and all historical evidence.

- Writer fixes and guarded Core-proved repairs: four missing raw records,
  1,816 event timestamps, INCB exact display aliases and Mail/participant/ref drift.
  Canonical economic and ownership history unchanged.
- UI fixes, exact amount/status handling, full-book projections and canonical
  authority hardening were deployed and verified in prior releases.
- Logical restore and physical named-restore-point/PITR passed in isolated node
  clusters; checksums/backup manifests/WAL evidence retained. Not off-host proof.
- Backup growth guard, hourly storage forecast and response health monitors
  deployed. External alert delivery is not configured. UI free space last checked
  11,876,700,160 bytes; capacity/retention remains open.
- `005a4e5`: Core outpoint batching and measured response bytes. Same-tip transport
  benchmark improved, but full-book reads still took several seconds.
- `85ce565`: Boost current confirmed ID ownership binding, independent registry
  and event snapshot IDs at the same canonical block, preserved raw claims.
  Full candidate/production Core probe passed: 871 anchors, 505 confirmed and
  22 pending IDs, 238 credits, exact wallet and bond checks. 24 Boost tests and
  528 recovery checks passed. Strict ID replay on this release passed 586 fetched
  transactions, 535 lifecycle events, six listings/four sales and 505 winners.
  Seventeen old refund candidates/two pending watch items are unchanged, not new.
- `1f467cc`: exclude another author's replies/reboosts from acquired-asset counts.
  All 25 Boost tests passed locally and Node 24. Core-backed complete ten-event
  fixture reproduced Purchased 1 before and Purchased 0 after; browser refresh
  confirmed zero with original post and exact signal totals preserved.
- `567823b`: completed rollout evidence and controllers, merged/pushed.

## Pending candidate 589bc71 — resume here, do not blindly deploy

Public WORK-floor route shares only in-flight requests with identical network
and freshness mode, including all canonical provenance and market checks.
Success/failure evicts the promise; no settled-result TTL or error cache.

Changed files are committed: `server/proof-api.mjs`,
`server/work-floor-response.test.mjs`, `scripts/check-live-data-contract.mjs`,
infrastructure/audit docs, and `deploy/audit17/probe-work-floor-burst.mjs`.
Three actual-function concurrency/failure tests, globals/live-data checks and
all 528 recovery checks passed. Node 24 three tests passed too.

- Release: `589bc71e7c96-20260919T172951Z`.
- Stage: `/opt/proofofwork-api-stage-589bc71e7c96-20260919T172951Z`.
- Tree: `b25e595e7b8a050d0abba5a153bcb5df1fe568c3`.
- Runtime SHA256: `00e2129a4b65118f8a960e87593cb6da046cfe23b834a34adeddbc4967943b40`.
- Bundle SHA256: `992cd9ea13f127e68525faa619c29daa2c06eeb0239629e5ab3b785ac150e95d`.
- First production burst: 7369/8656/8656 ms, subsequent request 6596 ms,
  Core 967724. First shadow burst: 9556/9545/9545 ms, subsequent 5105 ms,
  Core 967726. All exact Q8 values identical and integer floor division passed.
  **No end-to-end speedup demonstrated yet**; cold state/resource limits and
  different checkpoints make these timings inconclusive.
- Warm comparison completed successfully but timing receipts were not reviewed
  before the user stopped work. Node receipt directories:
  `/home/powadmin/audit17-work-floor-burst-before-warm` and
  `/home/powadmin/audit17-work-floor-burst-shadow-warm`.
- Other receipts: `/home/powadmin/audit17-work-floor-burst-before` and
  `/home/powadmin/audit17-work-floor-burst-shadow`.
  Local copies of their receipts/logs are `/tmp/audit17-work-floor-burst-*`.
- Untracked `deploy/audit17/publish-node-work-floor.py` is a pinned candidate
  controller; six simulated cutover/failure checks passed. It was **not uploaded
  or executed**. Reassess measurements before deploying.
- Shadow cache/private launch capture retained. To restart, existing launcher
  requires an empty newly prepared cache; do not delete retained evidence to
  bypass that requirement. Use a fresh reviewed run identity/procedure.

## Off-host recovery preparation and user input

User provided two public encryption recipient keys. They exactly match the public
halves of the existing node/UI SSH keys. Fingerprints:

- `SHA256:3QYaFu2nHUeGx3xRgWNk0In8Ip9mq1oD8VZvR6ifMzI`
- `SHA256:m8nCniKWdwBM4dP1EZ4a1dS0DKoHsqkiChErmOfrE78`

The assistant stated the workstation would be the off-host test destination
(about 710 GB free), using both recipients and encryption before VPS egress.
Do not print private keys or globals SQL: globals can contain password hashes.

- Local recipient file: `/tmp/proofofwork-audit17-offhost-tools/recipients.txt`.
- Ubuntu age package 1.1.1-1ubuntu0.24.04.3 downloaded/extracted there; no system
  package installation. Binary `unpacked/usr/bin/age`, SHA256
  `529450dfeaf3055cb24d76789d0b1f5eb8cd23e03dc4add64f84776df1272b02`.
- Official local `postgres:16-bookworm` image pulled, digest
  `sha256:efedf3595f1d6f415c08568ba171029bf54052e754cc9f030e3f2412b21f3d67`.
  Docker requires tool sandbox escalation; it works. No container started.
- Verified source set on node:
  `/data/proofofwork-postgres-backups/logical/proof_indexer-20260919T031850Z.dumpset`.
  Dump 15,890,347,429 bytes, SHA256
  `cc465d73c1465eac4a11065b174d2733710abf11d18d4e62e10a9ceae60fa262`;
  globals SHA256 `be2dbe2e9cd6454aefef03ddeba79581bbcee43c9a13152357ac83e4c3215c6c`.
  Prior `deploy/audit17/restore-logical.sh` restored data/schema only, no owners/ACL.
  Future exercise must separately verify roles/grants and tablespace handling.
- Encryption/export controller has **not** been written. Use bounded resources,
  source shared backup lock, existing checksums, >=100 GiB node data reserve,
  private files and a new exclusive job. Encrypt on node before export. Restore
  locally with no network/TCP exposure and no production mounts/connections.

## Remaining work and usage discipline

Prioritize bounded evidence-based changes, not repeated full deployment cycles.
Use the user-selected cheaper model; do not spawn agents or raise reasoning/model
cost without user instruction. Avoid rerunning completed checks absent changes.

Open: comprehensive independent historical math replay; connected-wallet and
pending/drop/replacement/reorg lifecycle coverage; full Boost seal/unspent-ticket
verification; remaining snapshot/summary latency and payload size; durable UI
retention; off-host recovery/role grants; external alert delivery. Live PostgreSQL
checksums are disabled; enabling them needs a separately reviewed maintenance
operation. Never claim fixture coverage proves every historical object.

Code-reading lead (not yet changed): Boost listing writers use
`Math.floor(listingPriceSats)` in BoostRoot and `Math.floor(priceSats)` in
boostProtocol; boostWallet also floors output amounts and outpoint vouts.
Investigate strict integer validation with meaningful tests before changing.
No code for this lead has been edited.

Node SSH: `powadmin@65.108.122.87`, existing `~/.ssh/proofofwork_node_ed25519`.
UI SSH: `root@77.42.91.106`, existing `~/.ssh/proofofwork_me_ed25519`.
Main worktree: `/tmp/proofofwork-audit17-main`.
Before new repo work, follow AGENTS required reading order. Before commits run
required hygiene fix/check and include Documentation-Impact/Repository-Hygiene
trailers. Preserve untracked `deploy/audit17/__pycache__/` and `tsconfig.tsbuildinfo`
unless separately documented as safe cleanup. Do not delete audits, rollback,
restore evidence or uncertain backups.
