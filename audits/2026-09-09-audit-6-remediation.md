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

## Local verification checkpoint

Partial results and source-receipt hashes are saved in
[verification evidence](2026-09-09-audit-6-remediation.verification.json). This is
not a release attestation. Integrated tests and the final build remain open.

- Existing WORK Q16 precision, bond exact-arithmetic, and V8 protocol/admission
  regressions passed. New registry observation and readiness-diagnostic fixtures
  passed; all write-admission bits stay fail-closed.
- The candidate Boost authority projection accepted all three current posts from
  node-backed wire/index evidence at block 966128, preserving direct proof and
  exact attached WORK amounts. This covers current posts, not nonexistent live
  adversarial transfers or sales; separate adversarial fixtures cover those cases.
- A read-only mailbox shadow matched 22 inbox and 11 sent/outbox records with
  zero semantic differences after correcting whitespace preservation. Added
  output and event-position metadata is intentional. Its primary database read
  timing is not comparable to the full production API's pending/Core enrichment.
- Manual candidate browser checks verified Timeline placement, the Home excerpt,
  Credit width at 375 pixels, and Infinity Floor label bounds. Credit's
  disconnected-balance copy was found during review and is being corrected.
- Fresh read-only operations evidence confirmed the current API, worker, Core,
  Electrs, PostgreSQL, WAL receiver, and Caddy remained running. UI disk use was
  54%, node root 24%, and node `/data` 78%. Existing warning findings remain open.

Deployment review found a new release-safety condition: new HTML delivered just
before rollback can still request candidate assets after prior HTML is restored.
The original two-root rollback does not guarantee those assets remain available.
A separately attested recovery root with prior HTML and the union of immutable
assets is being developed without altering the original prior root. Fault tests
and independent systemd recovery remain required. The node route/writer handoff
is separately unproven. No production transition or cleanup has occurred.

## UI implementation checkpoint

The UI source has passed one non-overlapping clean TypeScript/Vite build and
its lifecycle, authority, display, UI-contract and live-data checks. Browser
checks in connected Chrome cover the Timeline move, Home excerpt, Credit at
375 pixels, exact WORK High label, cold-ID qualification and disconnected Inbox.
An isolated local HTTP fixture exercised both cold and retained Credit history
503s followed by Retry and successful empty responses. The new Playwright test
file is retained but its runner was not executed; these are separate manual
Chrome observations. No wallet was connected and no signing was performed.

The UI checkpoint covers H6-04, H6-06 through H6-10, and H6-12 through H6-19,
plus the qualified-state/chart parts of H5-02. H6-05's client guard is tested,
but end-to-end authority remains gated: independent review found the existing
legacy full-parity resolver can omit a later valid post-activation PWID carrier.
The backend correction is being bound to the current accepted registry under a
read-only consistent transaction and full-node fences. Historical resolver
behavior is preserved. A successful UI build does not resolve this backend gate.

The final backend event/lifecycle checks passed 19/19, Boost integration 12/12,
and complete-mail pagination 5/5. The actual complete Boost reader accepted all
three live posts at block 966131 in 3.267 seconds with unchanged exact amounts.
The 504/504 recovery suite, API-truth, hardening and free-identifier checks passed
before the later registry strengthening. Those receipts remain historical
verification; the changed registry path requires a new final-source pass.

AMO can now display qualified exact summary metrics while its full listing book
is loading. This preview never supplies reservation or action authority. A
failed or incomplete book remains unavailable. Exact Q8 point labels are kept
for WORK and both bonds; older numeric-only history, graph axes and USD overlays
are explicitly approximate. The shared App bundle remains a size warning.

Production application source, configuration, services and data remain unchanged.
No named production cleanup candidate has been deleted. UI recovery tests and
the narrower node route/worker recovery adapter are still under verification.

## Live summary-publication incident, 2026-09-09 01:38 UTC

The user's AMO and WORK messages were independently reproduced. Core, Electrs
and the canonical scan reached block 966134, while all eight published summary
components remained at 966131, snapshot `a1ea54d3b1efee2bca194e5d`. The worker
repeatedly rejected a 16,803,750-byte compact snapshot against its 16,777,216-byte
budget; systemd had automatically restarted it four times. AMO returned 503.
This is a deterministic summary-publication budget failure. Earlier healthy
observations in this log do not describe the incident state. The disks are not
full (UI 54%, node root 24%, node data 78%).

The last-good stored SQL JSON text occupies 17,231,973 bytes, below the API's
18 MiB SQL-text cap. Both current API and worker use compact16MiB/SQL18MiB.
Listing arrays account for 4,318,975 SQL-text bytes in tokenSummary and repeat
in the marketplace and WORK summaries. These component sizes are measurements
of the last-good snapshot, not the failed candidate. No records were deleted,
truncated or rewritten. Exact-value witnesses and canonical history must remain
complete in any correction.

A bounded same-code worker budget correction is under review. It must first
prove compatibility with the serving API and independent worker recovery;
changing only the worker's cap must not silently publish an unreadable snapshot.
The existing API must keep serving and action admission must continue its live
checks. No production configuration or service change has been made. This is a
continuation of the readiness/publication finding, not a duplicate audit item.

The strengthened fresh-registry read matched all 505 current records, 535
accepted activity rows and all six Core-unspent returned tickets at block
966134 in a bounded read-only shadow (819 ms candidate read). Two additional
stored candidate tickets were correctly filtered as Core-spent. This observation
does not itself restore summary publication or certify a deployment.

Visual-check qualification: initial local Vite geometry checks used fallback
fonts because dependency files were outside Vite's allowed symlink root. The
worktree now has its own dependency copy; Credit and Infinity geometry must be
rechecked with the intended fonts before final visual acceptance.

## Application source verification checkpoint

The final MVCC registry candidate subsequently passed the complete 504/504
index-recovery behavior suite. This supersedes the earlier registry test gap.
The current-node registry shadow and source regressions establish the candidate
read contract; production rollout and a fresh release-bound reconciliation remain
separate gates. SOUL and the ID/marketplace protocol documents were reviewed:
no fee, replay cutoff, confirmed ownership, exact arithmetic or local-signing
rule changes are required. README, infrastructure and mailbox documentation
describe the candidate behavior. Historical audits and generated release assets
are preserved. Local hygiene removed only allowlisted Vite caches and build output.
