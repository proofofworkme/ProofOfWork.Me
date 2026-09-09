# Node publication: smallest current-candidate path to prove

Status: source assessment and readiness fixture, not a certified node cutover.
Keep the current serving release active. The existing stopped-listener/API
publication workflow remains outside the no-planned-outage approval. A full
writer-generation redesign has not been shown necessary for this candidate.

## Scope and existing behavior

The current worker program/backfill implementation is unchanged. Its mutation
change is the imported unfollow event relation projection. Most other server
changes are read projections, validation/diagnostic handling and statistics.
There is no new schema migration in this remediation diff. Verify that scope
again against the final candidate before using this narrower plan.

The current WireGuard proxy points to 127.0.0.1:8081 and the UI Caddy routes API
and health requests to 10.77.0.2:8081. The worker unit is PartOf the API and uses
that API. Therefore leave the old API/proxy/unit running while preparing an
additional candidate API and while assessing worker replacement.

`deploy/audit5/shadow-entry.mjs` already requires a separate release-named cache,
127.0.0.1:18081 and a PostgreSQL read-only default/search path. That is useful
for the first read phase. It does not itself install a public candidate route.

A worker restart is not automatically an application outage. The real readiness
function in `server/work-amo-v8-worker-readiness.mjs` deliberately accepts
`starting`, `running` and `canonical-phase-complete` when a durable exact-tip
last success is valid. Startup preserves lastSuccess/workPrecision. Normal
SIGTERM shutdown exits without writing a synthetic `stopped` failure record.
`check-audit6-deployment-worker-readiness.mjs` exercises these exact functions:
all four normal states remain ready; changed tip, a recorded failure and absent
Core mempool evidence still fail closed. Public read freshness additionally
expires after the configured age (10 minutes by default); no gate is weakened.

## Proposed phased adapter

1. Stage an immutable exact-commit checkout and separate cache. Keep its path
   stable for the whole lifetime of every process running it. Run the existing
   read-only shadow with exact canonical/mempool, event/address, math, identity,
   current/old payload compatibility, and meaningful performance checks. Keep
   all migration/backfill entrypoints out of this read-only process.
2. Prove a separate candidate WireGuard listener restricted to the UI VPS, then
   a manager-owned reversible Caddy route update. Route only audited public
   read endpoints to the candidate at first. Keep the five POST/broadcast paths,
   internal worker/verifier routes and any unaudited path on the original API.
   HTTP method alone is not the audit: verify each selected handler's effects
   and test the route allowlist and direct method rejection. Test long reads,
   streams if any, failed upstream health and lost coordinator sessions.
3. For the worker-only change, prefer the same existing systemd worker unit
   with an exact immutable candidate ExecStart/WorkingDirectory. Its
   KillMode=control-group serializes old/new service processes. A separate
   manager-owned controller must retain the previous unit definition and
   source/runtime identity, prove old children/transactions are finished before
   starting the candidate, and restore/start the old worker if the candidate
   fails first-cycle validation. Leave both HTTP APIs serving throughout.
   Inventory other scheduled/manual writers and prohibit overlapping maintenance
   during this approved transition; do not invent a global generation protocol
   unless the actual inventory requires one.
4. Prove the drain boundary rather than assuming it. The existing SIGTERM
   handler immediately signals an active backfill child and can SIGKILL it after
   five seconds; it is not a finish-current-cycle drain command. An external
   sampled `idle` label alone has a race with the next cycle. The bounded test
   needs the real worker/backfill entrypoints and a disposable database: stop at
   idle and each in-flight transaction/publication boundary, verify rollback or
   completion, preserve readiness evidence, start the exact candidate without
   overlap and observe first-cycle checkpoint/mempool continuity. A child stop
   must not leave a poisoned checkpoint or force an avoidable admission outage.
   If an explicit drain handshake is necessary, add/test that small mechanism
   rather than silently relying on timing.
5. Candidate first-cycle checks must include unfollow target relations, exact
   chain/mempool state, original/updated reader compatibility, and the unchanged
   hard math gates. Prove old-worker recovery with the candidate's resulting
   backward-compatible rows. A Core tip change may legitimately close exact-tip
   admission during normal indexing; distinguish that existing behavior from a
   deployment-caused gap, without masking or bypassing the gate.
6. Move mutation routes only after their candidate admission checks and recovery
   are independently proved. Initial read routing alone does not close every
   server finding (especially admission diagnostics on the old mutation API).
   Keep original API/worker source and caches until observation and retention
   review. The active release verifier must attest the checkout actually used
   by each serving process; do not swap a live pathname beneath lazy imports.

## Still required before production transition

No parallel route or worker takeover adapter has been executed. The concrete
remaining proof is the candidate read route/supervised rollback, the complete
actual-writer inventory, deterministic old-worker drain and database/readiness
continuity, single-unit old/new exclusion, source/runtime attestation at stable
paths, and independently managed restoration of the prior worker/unit/route.
The readiness fixture reduces uncertainty: it shows a short healthy takeover
need not require an application outage. It does not certify the rest of that
transition. No production service, route, database or source path was changed.
