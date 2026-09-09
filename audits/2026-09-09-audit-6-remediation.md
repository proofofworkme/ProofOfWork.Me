# Audit 6 approved remediation and resumable handoff

## Authorization and safety boundary

The user approved all eight proposed packages, H6-01 through H6-19, and the
unresolved carried-forward findings on September 8, 2026 (America/Toronto).
Approval includes source, tests, documentation, deployment safeguards, commits,
pushes, and phased production deployment after verification. The user requires:

> Keep the current application serving during preparation. Establish and
> fault-test deployment and recovery that do not depend on the assistant session
> before any production transition. Do not use a deployment method requiring a
> planned outage under this approval. If safe continuation cannot be established,
> stop before changing production and preserve a resumable checkpoint.

Cleanup is restricted to the audit's named candidates after proving non-use and
preserving required rollback and recovery evidence. Confirmed history, protocol
rules, exact arithmetic, and local wallet signing remain mandatory. Approval does
not authorize wallet transactions or a planned outage.

## Starting evidence

- [Audit 6 and ordered application review](2026-09-08-production-health-data-event-storage-audit-6.md)
  is the finding inventory, including H6-19 and prior-audit dispositions.
- Its evidence JSON and historical reproduction scripts are preserved unchanged.
- Audit baseline commit: `40c7fa0` on `growth-all-products-2026-09-05`.
- Implementation branch: `audit6-remediation-2026-09-09`.
- Implementation worktree: `/tmp/proofofwork-audit6-remediation`.
- Original workspace: `/home/sixer/ProofOfWork.Me`.
- Raw read-only audit receipts: `/tmp/pow-ordered-audit-20260908/`.
- Machine-readable checkpoint: [remediation state](2026-09-09-audit-6-remediation.state.json).

## Package plan

1. Event authority and completeness: Boost authorization and hide behavior,
   unfollow relations, complete address-mail pagination, stable event identity,
   and correct confirmed/pending/dropped classification.
2. Exact financial and status display: integer-derived labels, correct units and
   totals, explicit retained/unavailable state, and coherent canonical replacement.
3. Response ordering: request generations and account/network/query fences across
   Desktop, Browser, AMO, Credit, Wallet, Log, and manual Computer mail refresh.
4. Readiness and operations: investigate intermittent 503s and verifier identity,
   distinguish unavailable declaration reads, and preserve fail-closed authority.
5. Speed and data handling: bounded pagination, cache freshness, carrier
   prefiltering, and measured improvements that retain canonical verification.
6. Storage and recovery: session-independent deployment/recovery fault tests,
   capacity and rollback checks, and only proven-unused named cleanup candidates.
7. UI: accurate Home excerpt, mobile Credit width, Infinity axis labels, and
   Timeline in Boost's left action panel beside Post From Mail and Get ID.
8. Verification: corrected-behavior regressions, existing release gates, isolated
   replay where feasible, full-node reconciliation, and phased production smoke
   checks. Wallet signing stays local; unavailable real-device/wallet checks must
   be reported as limitations rather than claimed passed.

## Current checkpoint

Preparation is local. No production source, configuration, service, database,
deployment pointer, or cleanup mutation has been performed in this implementation.
The baseline audit commit is complete. Implementation is in progress and has not
yet passed integrated verification or been deployed.

Ownership during parallel work:

- Root: this handoff, canonical documentation, package scripts, hygiene inventory,
  Home and Boost cosmetics, integration, and release decisions.
- `math_checks`: backend Boost/event authority, lifecycle, and mail pagination.
- `ui_audit`: `src/App.tsx`, associated helpers/styles, and response/state tests.
- `prior_audits`: `deploy/audit6/`, deployment fault tests, and no-outage assessment.

The production transition gate is **closed**. Existing UI exchange handles ordinary
errors with a shell trap, but post-publication smoke failure and abrupt termination
need durable recovery. Existing node checkout exchange explicitly stops services;
the WireGuard proxy also depends on the API unit and targets port 8081. That method
does not satisfy this approval. A persistent UI controller is being prepared and
fault-tested locally. Node route switching, drain, cache/schema compatibility, and
exclusive writer handoff must be established before any node transition.

## Resume procedure

1. Read repository instructions and this handoff, then inspect branch, worktree,
   status, diff, tests, and live agent state. Do not discard uncommitted work.
2. Inspect the state JSON and later checkpoint entries. A listed task is not a
   completion claim. Historical audit reproductions demonstrate old failures;
   corrected-behavior tests must separately prove the implementation.
3. Continue implementation and local verification. Keep production transition
   closed until autonomous recovery and no-outage operation have passed fault tests.
4. Recheck the full node, indexer, storage, database, API authority, and current
   release identities before shipping; September 8 audit observations are historical.
5. Run `npm run hygiene:fix`, review its report and semantic documentation, then
   relevant tests and `npm run hygiene:check`. Review status and final diff before
   committing with the required trailers. Preserve audits and recovery evidence.
6. Record every transition and rollback result durably. If safe continuation is
   unproven, stop before production changes and update this checkpoint.

No deployment or cleanup command is authorized merely by appearing in an older
runbook. The user's no-outage and recovery conditions govern this implementation.
