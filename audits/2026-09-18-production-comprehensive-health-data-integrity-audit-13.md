# Production comprehensive health and data-integrity audit 13 — 2026-09-18

## Audit date and scope

Read-only audit performed 2026-09-18 local time / 2026-09-19 UTC sampling.
Scope covered the required repository instructions and prior audit chain,
the UI VPS, attempted node/API VPS access, public API reachability, local
contract and deterministic math checks, storage pressure, retention behavior,
and audit-tool limitations. No production data, protocol records, ledgers,
evidence, backups, services, or files were changed. This file is the only
approved artifact created by this audit.

## Prior issues rechecked

The 2026-09-17 audit and preceding audit chain were reviewed before assigning
findings. The following remain unresolved:

- UI backup-retention pressure and failed dry-run prune guard.
- Node `/data` capacity warning and growing canonical/database footprint.
- Lost/inactive PostgreSQL WAL receiver path.
- Slow marketplace summary fallback behavior.
- Incomplete full replay and browser-surface coverage.

## Systems and services checked

- UI VPS `ubuntu-4gb-hel1-1` (`77.42.91.106`): filesystem, inodes, memory,
  load, Caddy, UI storage-health and release-prune units, backup inventory,
  and logs.
- Node/API VPS `pow-bitcoin-01` (`65.108.122.87`): SSH and read-only service,
  filesystem, Core, Electrs, PostgreSQL, API, worker, WAL, and database
  checks were attempted but the audit environment could not establish the SSH
  connection.
- Public health, consistency, ID, Boost, and application endpoints were
  attempted but DNS resolution failed with `EAI_AGAIN`.
- Local source-level and deterministic contract checks were executed where no
  production connection was required.

## Health and capacity results

### UI VPS

- Root volume: 38G total, 24G used, 13G available, 66% used.
- Inodes: 4% used.
- Memory: 3.7GiB total, 3.2GiB available; no swap.
- Load: 0.00/0.00/0.00 at sample time; uptime 134 days.
- Caddy: active.
- UI storage-health: inactive at sample time.
- UI release-prune: failed; the known dry-run/classification guard remains
  active and no deletion was performed.
- `/var/backups/proofofwork-ui`: 20G. This is over half of the root volume
  and leaves only 13G free. The previously observed full-disk outage remains
  a credible repeat risk during continued releases or backup growth.
- `/var/log`: 597M. No inode exhaustion was observed.

### Node/API VPS

SSH failed before any command ran: `socket: Operation not permitted` followed
by connection failure. Therefore current disk, memory, CPU, database, Core,
Electrs, worker, WAL, and node-log state are **not independently verified in
this audit**. Prior audit values must not be presented as current health.

## Database, node, indexer, and event integrity

No current direct database or full-node evidence was available. Accordingly,
this audit does not certify current event counts, duplicate absence, raw
transaction coverage, canonical block coverage, indexer convergence, or
mempool reconciliation. The previous green checkpoint remains historical
evidence only.

The public API checks that would establish current canonical health could not
run because all tested ProofOfWork domains failed local DNS resolution:
`computer.proofofwork.me` and `boost.proofofwork.me` returned resolver error
`EAI_AGAIN`. This is an audit-environment reachability blocker, not proof that
the production services are down.

## Mempool and confirmed/pending status

No fresh Core RPC or public API witness was obtained. Pending/confirmed status,
mempool membership, dropped transaction handling, and persisted pending-event
readiness are therefore unresolved for this audit. No status discrepancy was
asserted without current evidence.

## Math-verification results

Passed local deterministic checks:

- `check:api-truth` — passed, including V8 gate regressions.
- `check:canonical-order` — passed.
- `check:worker-containment` — passed all reported containment, pending-witness,
  and precision checks.
- `check:work-precision` — passed 131 checks; unit scale `100000000`.
- `check:bond-exact-arithmetic` — passed.
- `check:growth` — all 4 tests passed.
- UI and hardening contract checks — passed.

These checks establish deterministic code-level behavior, not current
production replay parity. A complete cross-layer proof still requires current
Core, database, indexer, API, and UI evidence.

## New findings

1. **H13-01 — UI backup retention remains a high repeat-outage risk.**
   Source: live UI VPS sample: 20G backup tree, 13G free, prune unit failed.
   Impact: ordinary release/rollback accumulation can exhaust the 38G root
   volume and repeat the prior application outage. Correction: classify exact
   rollback/release archives and approve only a measured, recoverable cleanup.

2. **H13-02 — Current node/API health is unauditable from this environment.**
   Source: SSH connection failure before command execution. Impact: current
   Core sync, database integrity, indexer state, logs, WAL, and `/data` runway
   cannot be certified. Correction: restore the approved read-only audit SSH
   path or run the audit harness on the node host.

3. **H13-03 — Current public canonical/API/UI health is unauditable from this
   environment.** Source: resolver `EAI_AGAIN` for production domains. Impact:
   no current health, consistency, event rendering, mempool status, or surface
   result can be claimed. Correction: repair audit-environment DNS/network
   access and rerun the ordered production surface audit.

4. **H13-04 — `check:node-ops` currently fails due to a contract-test/source
   false positive.** Source: `check-node-ops-contract.mjs` rejects the surface
   audit source because its forbidden-operation regex matches the literal
   words `writeFile`/`ssh` in the audit script. Impact: the repository’s
   node-ops contract gate is red even though this audit made no such operation.
   Correction: tighten the test to inspect executable operation sites or use a
   token-aware check; requires separate approval before editing tests.

## Actions taken

- Reviewed required protocol/product/operations documents and prior audit logs.
- Performed read-only UI VPS capacity and service checks.
- Attempted node/API and public production checks; recorded exact blockers.
- Ran local deterministic and contract checks; preserved their outputs as
  findings/evidence in this log.
- Created this audit log only. No cleanup, repair, restart, deploy, commit, or
  push was performed.

## Items requiring approval

- Deleting or moving UI release archives, rollback roots, caches, temporary
  files, backups, or audit/recovery artifacts.
- Any WAL receiver reset, base backup, replication-slot change, database
  maintenance, service restart, configuration change, or deployment.
- Any application/indexer/math correction or production data repair.
- Editing the node-ops contract test or changing production audit access.

## Recommended follow-up

1. Restore node read-only SSH and audit-environment DNS, then rerun the full
   production harness at one fenced checkpoint.
2. Classify the 20G UI retention tree and approve a minimal cleanup only after
   proving active-release and rollback coverage.
3. Repair the WAL backup/recovery lane with a fresh validated base backup under
   an explicit runbook.
4. Re-run complete ledger, computer-events, ID, parity, mempool, math, and
   ordered UI audits and attach compact machine-readable evidence.
5. Fix the node-ops contract false positive only after review; do not weaken
   fail-closed production checks.
