# Recursive assurance — local batch 1

Date: 2026-10-01 (America/Toronto). Initial source revision:
`fc3db324b5532bc2f28d48fc00eca3d93597c4e9`. Initial App source SHA-256:
`2a026334f439dfda41fca106549d25fd24b4dbb14781128fc7f6a2a6ef92a365`.
Latest recorded deployed application is App527,
`527e4cbaa66f689169197c7ce9569425ef334492`. This batch does not reattest its
private release manifest or publish a new release.

Status: eight scoped corrections and the additionally approved fixtures are
verified locally within the declared coverage. No client production
closure is claimed. The initial investigation was read-only; the user then
explicitly approved the named local source, tests, report, evidence and hygiene
changes. Git commits/pushes, deployment, configuration changes, migrations,
signing and broadcasts remain outside this approval.

## Target and acceptance inventory

Requirements are taken from SOUL, README, IDs, DNS, Marketplace, Infrastructure
and Mail Organization, read in the requested order. Protocol documentation and
confirmed records outrank operating memory. Prior audits 6, 27, 28, 29 and the
Oct 1 remediation release were reconciled without modifying their evidence.

| Surface / invariant | Canonical requirement | Responsible implementation and existing verification | Evidence needed / coverage gap |
| --- | --- | --- | --- |
| Home | Qualified complete registry counts; confirmed and pending remain distinct. | `LandingRoot`, shared complete-count helpers; surface/read-state checks. | Complete height/hash-bound registries; a shell or preview is insufficient. |
| IDs | First valid confirmed claim; pinned case normalization; 1,000-proof registration, 546-proof mutations; registration-only launch; pending unroutable. | Registry parser/resolver, `IdLaunchApp`, ID audit and pending-time tests. | Raw canonical population/order, owner input and ordered fee outputs. Full live ID replay was not repeated. |
| DNS | Separate registry/name normalization; first confirmed claim; same 1,000/546 split; sale tickets separate from onboarding. | DNS resolver and launch; DNS coverage/authorization regressions. | Complete Core/Electrum-fenced history and exact terms. The live DNS smoke checks its existing coverage witness. |
| Desktop | Confirmed, byte-verified public files; deduplicated owned content; welcome remains a separate verified system reference; latest target wins. | `fetchAddressMail`, `loadDesktopTarget`, file/welcome helpers. | Complete scoped mail and content hashes; malformed/partial responses must not imply zero. H6-06 and RA-M01 are addressed locally. |
| Browser | Requested txid/network, size/hash checks, opaque static iframe, no wallet lane. | `BrowserLaunchApp`, `fetchBrowserPage`, static sanitizer; Browser/containment checks. | Canonical bytes plus sandbox/CSP and request-context tests. H6-12 was reproduced live using the welcome txid. |
| Boost | Confirmed actors/ownership; exact signal units; pending separate; detail not limited to visible feed. | Boost projections and shared client; Boost regression file. | Raw identity at event position, complete graph/detail membership. Conditional ranking and signing fixtures remain unverified live. |
| AMO | Complete verified book, frozen terms, confirmed seal, live unspent ticket and separate fresh signing preflight. | Complete pagination/hash commitments, Core listing authority, prepared review; surface-read-state suite. | Whole-book membership and independent Core ticket checks. Prior 999-ticket receipt is historical; this batch did not repeat it. Browser hydration remained incomplete. |
| Credit | Exact cap/issuance, owner registry fees, pending pressure not confirmed supply; preview not complete history. | `TokenWorkspace`, holder/mint history and exact helpers. | Valid scoped pagination, failed/empty distinction and revision invalidation. H6-08 is addressed locally. |
| Wallet | Exact wallet/network/token scope and reservations; confirmed funding; signing stays local. | Account hydration, UTXO refresh/capacity guards and prepared transactions. | Fresh wallet plus all reservation lanes and exact preflight. No wallet connection, signature or broadcast in this batch. |
| WORK | V8 activation only from declaration; Q16 conservation; exact legacy conversion; sole 25,000-proof face; no legacy settlement restoration. | WORK units/V8 replay/gates; V8, precision-v2, bond and fee checks. | Exact raw activation/migration/pending witness and integer arithmetic. Current supplied floor was calculated independently; no new genesis replay. |
| Infinity | Recipient-issued whole POWB; confirmed flow/floor; no synthetic double-counting. | Bond projection and shared credit ledger; bond arithmetic/ledger checks. | Raw recipient payments, holder conservation and ticket truth. Full bond history/signing not exercised live. |
| Inception | Immutable hash-bound H-1 WORK value; same-block exclusion; floor once to whole INCB; no later repricing. | INCB oracle/replay and exact bond math; ledger checks. | Historical predecessor hashes and numeric prefix values. Prior H-1 receipts retained; no fresh independent historical reconstruction. |
| Log | Confirmed canonical events; explicit pending; latest query/page/workspace wins; no value-bearing hidden population. | Indexed history/refs and client generation fences; behavioral read-state checks. | Complete population and independent raw events. Current smoke/search fixtures do not exhaust every carrier. |
| Growth | Same confirmed snapshot/value as WORK; frozen versus live distinction; forecasts are assumptions; no duplicated Mail/WORK/Boost value. | Shared ledger/forecast source; ledger and growth gates. | Snapshot/hash binding and independently recomputed exact equations. Valid lower canonical-branch acceptance remains an open historical gap. |
| Computer | Integration follows standalone checks; local drafts/backup; review before signing; pending/unknown/dropped separate; context changes cancel authority. | Shared workspaces, Mail review/receipt state, account header, backup allowlist. | Connected workflows, cancellation/recovery and complete reservations. AUD27-01 is addressed locally; connected acceptance remains unavailable here. |

## Investigation passes and production evidence

1. Inventory, prior-finding reconciliation, focused local protocol gates and the
   ordered first-party surface smoke: Home, IDs, DNS, Desktop, Browser, Boost,
   AMO, Credit, Wallet, WORK, Infinity, Inception, Log, Growth, then Computer.
2. Controlled in-memory reversed responses, malformed/failed reads, deadline
   faults and stale resume evidence, using actual source functions. These
   specifically exercise gaps that the previously green checks did not detect.
3. Ordered unauthenticated browser inspection and independent integer/snapshot
   comparison, followed by correction regression tests and separate review.
   No artificial malformed response or reorg was injected into production.

The ordered live surface command passed 15/15 hosts, entry assets and sampled
API contracts. API times ranged from 552 ms (health) to 9,664 ms (compact AMO).
This proves the checked availability/schema conditions, not complete workflow
readiness or canonical replay. No resume file was used in that live run.

The strengthened verifier also passed 15/15 sequential surfaces at
13:11:42.730–13:13:08.421 UTC, with every host and sampled API returning HTTP
200; API latency ranged from 475 to 11,448 ms. Its receipt binds script
SHA-256 `9312f9a7b20fad85768263d90118f762195621c7eafb8724c52331e3db6d1323`.
Separate review then found a valid-redirect resume compatibility edge. The
final refinement records requested and observed URLs separately, allows
same-origin API redirects and the canonical Home apex-to-www redirect, and
rejects foreign origins. Its 11 regression cases passed. A final one-surface
Home check at 13:16:28.803–13:16:36.431 UTC passed the actual apex-to-www
redirect using final verifier SHA-256
`c876280878e2dce3a30e08e1de424127ddb7e9d8f10724dc5fe3fda1a9464765`.
This is distinct from pretending the earlier 15-surface receipt used later
source bytes.

The live ledger audit passed snapshot `682ae5389ceec2508eba32f3`. A separate
four-request comparison, 12:58:21.743–12:58:31.044 UTC (08:58 EDT), bound WORK
and Growth to height **969444**, hash
`000000000000000000021d549dcbe4aaf005ad25a203a81fc4cd2918a6b060be`.
First-party health reported the same Core identity before and after. WORK and
Growth agreed on exact network value Q8 `1452112170417446873646341097`.
Independent BigInt division by `21000000` yielded floor Q8
`69148198591306993983`, matching the exposed floor. Health/Core identity is
reported through the first-party API; no direct private Core RPC was performed.

The first ad hoc collector used a nonexistent top-level health hash and could
not establish its fence. Source inspection located `checks.node.bestBlockHash`;
the corrected collector above passed. This was an audit harness error, not a
production mismatch. The sandbox's initial DNS `EAI_AGAIN` was likewise an
environmental failure; authorized read-only network execution succeeded.

The amended ledger verifier first stopped on readiness HTTP 503 at height
969447, hash `00000000000000000000325bd9908eb0014bf4c9bd948d777c6f4fce4aab6601`:
the index and replay-worker proof were not ready while the worker ran. A single
bounded health follow-up at 13:14:14.699 UTC returned HTTP 200, ready, and a
complete canonical worker phase. One bounded ledger retry then passed snapshot
`845ea2a17207bea16f93c574`, with the same exact network value
`14521121704174468736.46341097` proofs. The failed transition is preserved,
not replaced by the successful retry.

Browser observations are qualified: IDs displayed Unavailable without claiming
zero; a Desktop account read stopped on canonical catch-up; AMO remained
Loading during the bounded observation. WORK eventually rendered its exact
floor and 388 holders; Infinity rendered its confirmed supply. The welcome
Browser transaction rendered confirmed, hash-verified HTML with empty iframe
`sandbox` permissions. Changing selection to Testnet4 while loading that mainnet
tx returned the selection to Mainnet on completion, reproducing H6-12. The
proof card itself remained correctly labeled Mainnet. Inception rendered its
fixed issuance and explicitly withheld complete-market empty claims. Log
rendered a summary total of 26,277 and a paged total of 26,285; these separate
observations/populations were not hash-fenced, so this is an unverified
discrepancy, not a newly established canonical defect. Growth rendered its
exact value and marked forecasts as assumptions. Computer was inspected last
and required connection to inspect account mail. No wallet was connected.

## Concrete findings and correction contracts

Before-correction locations below refer to the pinned initial revision.
Regression protection executes actual source; fixture outputs are not evidence
of production closure.

| ID / severity | Expected versus observed; minimal reproducer | Cause, proposed correction and limits |
| --- | --- | --- |
| H6-06 / P2, open and reproduced | Start Desktop A, then B; complete B then A. Profiles became `[B,A]`, final A; stale completion cleared loading. `src/App.tsx:27994`. | Workspace-only fence omitted request ownership. Bind target/network/generation; cancel superseded reads; guard payload/status/finally. Local deferred tests; no live wrong-address incident claimed. |
| H6-08 / P2, open and reproduced | Summary says 387 holders with 25-row preview. Search outside preview; reject history with 503. UI says No holder matches and zero matches. HTTP-200 `{}` also becomes empty. `src/App.tsx:43049`, `:43096`, `:17299`, `:44047`. | Failure discards authority and falls back to incomplete preview; revision omitted from dependencies. Validate holder/mint envelopes, maintain scoped error/last-verified states, invalidate on accepted observation. Include valid empty, timeout, stale context and recovery. Does not demonstrate bad wallet balances. |
| H6-12 / P3, open and reproduced locally and live | Start welcome mainnet read; select Testnet4 before completion; selection returns to Mainnet. `src/App.tsx:38656`, `:38763`. | Manual selection does not invalidate load generation. Cancel/invalidate on selection and protect page/status/URL completion. No false chain labeling demonstrated. |
| AUD27-01 / P3, open and reproduced | Empty incoming, one dropped Outbox item, no other pending lanes produces `unconfirmed: 1 event`. `src/App.tsx:24979`. | Outbox membership includes historical dropped attempts. Partition pending, dropped and unknown/checking counts; preserve history and draft restoration. Status-transition tests; original connected fixture not rechecked live. |
| RA-M01 / P2, new client finding | Missing arrays/error envelope or actual failed node fallback with empty arrays becomes successful zero-file Desktop. `src/App.tsx:13734`, `server/proof-api.mjs:64105`. | Client drops scope/coverage/scan failure. Validate arrays and scope; distinguish incomplete node scan from complete indexed base with failed optional enrichment. Successful node/testnet empty responses remain valid. Controlled failure, not observed malformed production response. |
| RA-V01 / P2, new verifier finding | Actual registry validator accepts checkpoint and count `null`, `false`, blank/space strings, `[]`, `[0]` as zero. `scripts/audit-production-surfaces.mjs:267`. | Coercive `Number` parsing. Require safe numbers or canonical integer text; test full validators without stubbing dependencies. Height-only smoke still does not prove a Core hash fence. |
| RA-V02 / P2, new verifier manifestation related to H5-10 | Headers return immediately; abort-aware body takes 80 ms with 20-ms deadline. Ledger helper succeeds after 81 ms. `scripts/audit-ledger-consistency.mjs:147`. | Timer ends before body consumption. Await successful/error bodies inside deadline; test stalls, malformed JSON and cleanup. Historical frontend H5-10 fix remains separate. No live stall shown. |
| RA-V03 / P2, new verifier finding | In-memory 2020 resume, wrong origin, page-only successes for 15 keys: current run claims fresh full `ok/complete`, zero fetches. `scripts/audit-production-surfaces.mjs:637`. | Resume trusts entries without settings/source/time binding and relabels observation time. Validate provenance, preserve original timestamps, label reused evidence, reject incompatible/stale receipts and retry failed surfaces. Current live pass did not use resume. |

Prior H6 findings above were never proven closed; their reproduction is not a
recurrence after a verified repair. H6-07 fresh complete-book reuse and H6-09
UTXO response ownership pass their current local regressions. H6-05 contraction
and H6-10 canonical-branch acceptance remain qualified/open; no reorg occurred.
AUD28-specific fixes and AUD29-01–04 retain their existing scoped release
evidence. Audit29 connected AMO rendering and its announcement remain pending.
AUD29-R01's 23 historical missing scratch files and R02 maintenance attribution,
capacity/transition growth, physical checksums, PITR, off-host alert delivery
and provider bandwidth remain unresolved or separately approval-dependent.

## Audit of the audit

Previously green containment/live-data/read-state checks did not detect the
Desktop, Browser and history failure counterexamples. Several were source
pattern assertions. The DNS Audit28 regression stubs the numeric/checkpoint
helpers, so it could not detect RA-V01. Shared parsers, server summaries and
agent agreement are consistency evidence, not independent raw-chain proof.
The event audit's missing-value defaults remain a separate verification gap;
no new event-audit implementation change is approved in this batch.

The strengthened tests reject original counterexamples and still accept
valid empty/fallback reads, latest responses, exact integer zero and matching
interrupted-audit resumption. Unavailable evidence cannot establish ownership,
balances, complete history, routing or settlement. Read admission must also
recover when valid evidence becomes available.

## Local validation, hygiene and release boundary

Pre-correction gates passed: TypeScript without emit; V8, precision-v2, bond
exact arithmetic, fee precision, pending-time/Audit29 UI, UTXO freshness,
43-check client containment, surface-read-state and eight send-preparation
fixture cases. A sandbox loopback-listen EPERM prevented an API timeout test;
this was not counted as a passing test or application failure.

Post-correction validation passed:

- TypeScript without emit; client containment's 43 checks; all eight
  surface-read-state coverage groups, including actual-source deferred Desktop,
  standalone/Computer Browser, mail lifecycle/envelope and token history cases.
- The new verifier suite: 11 named cases; its package command also passed.
  Audit28's eight cases, pending registry timestamps and Audit29 UI cases passed.
- WORK V8 and precision-v2, bond exact arithmetic, fee precision, wallet UTXO
  refresh and all eight send-preparation fixtures passed.
- All ten API timeout/caller cancellation cases passed when loopback access
  was authorized. The earlier sandbox EPERM remains classified as environmental.
- Separate review found no additional material issue within these corrected
  contracts. It caught and resolved integrated Browser omission, explicit
  history refusal flags and redirect resume compatibility before acceptance.

Intermediate new-test failures were broken harness fixtures: a nonempty mint
fixture omitted rendered `paidSats` fields, and adding an integrated Browser
effect made a globally selected effect marker ambiguous. The fixture was
completed, the markers are distinct, and extraction now requires exactly one
match. The final whole behavioral suite passed; these failures are not hidden
as application regressions. One attempted npm alias did not exist; the actual
Audit28 script was run directly and passed.

Before fixture approval, `check:live-data` failed exactly two obsolete
source-pattern assertions: they expected the old three-argument
`fetchAddressMail` signature and the old uncaptured `network` call. The existing
Desktop browser fixture also omitted the address/network envelope fields
provided by both real producers. No assertion was bypassed and no browser-test
pass was claimed at that stage. The user subsequently replied “i approve” to
the exact two-file scope below:

| File | Approved fixture update | Acceptance / risk / rollback |
| --- | --- | --- |
| `scripts/check-live-data-contract.mjs:1647` | Updated two patterns to require the optional cancellation signal and captured request network. | `check:live-data` passed; first-party URL assertions and behavioral counterexamples retained. Revert these two pattern edits independently if wrong. |
| `tests/browser/desktop-welcome-ui.spec.mjs:20` | Added actual requested address and `network: livenet` at three mock response sites. | All five existing Desktop welcome/deduplication browser cases passed in 12.8 s; unavailable/pending/wrong-txid/retry assertions preserved. Revert only scope fields if wrong. |

The five local browser cases cover confirmed welcome bytes, pending rejection,
unavailable-to-confirmed refresh recovery, wrong-txid rejection, and owned-file
counts with welcome/self-send deduplication. Independent review confirmed the
diff contains only the two patterns and scope fields at the three mock sites;
all browser assertions and transaction fixtures remain unchanged. Both affected
existing gates now pass. This closes the local fixture acceptance gap without
claiming that every unrelated repository check or connected workflow was run.

The first `hygiene:fix` found no allowlisted rebuildable state and removed
nothing. After the approved browser run, a second pass removed only
`node_modules/.vite` (7.08 MiB) and `node_modules/.vite-temp` (0 B), both ignored
allowlisted caches. No tracked or protected evidence was removed. The
semantic review found existing SOUL and canonical requirements already accurate:
these corrections enforce their failure, confirmed/pending, scoped read and
local-signing rules without a protocol, fee, activation or deployment change.
The classified note inventory, predecessor findings/releases, deterministic
generated-artifact policy, cleanup allowlist, ignored state and final source
diff were reviewed. Historical evidence is retained. Final `hygiene:check` is
recorded in the companion evidence. Rollback is limited to this local
source/test batch while preserving the audit and predecessor evidence. No
staging, commit, push, deployment or announcement occurred.

Acceptance means verified within the stated scope and supplied evidence. It is
not universal bug freedom. Highest-value next action after local acceptance is
a separately approved release with fresh deployed-source and connected
standalone/Computer verification.
Production closure cannot come from this local correction batch alone.

## Approved frontend release preparation

After local acceptance, the user approved release steps 1–4 with “i approve
1-4”: build the frontend and prepare rollback; commit/push/deploy this verified
batch; verify fresh production evidence and record closure; publish and verify
the release announcement. This supersedes the original batch exclusion of Git
and frontend deployment actions only. Production configuration, protocol
migrations, node application changes, signing and broadcasts remain outside
scope. The earlier no-release statement records the local acceptance boundary.

The working-tree production build passed. Deployment will use a second build
from a clean detached full commit through `deploy/audit5/build-ui-release.sh`,
with isolated dependencies and all 15 public surfaces plus the Computer/NFT
copy. Fresh helper hashes, capacity admission and complete prior-root
fingerprints bind transport and staging. The documented installed frontend
publisher will perform candidate/provenance checks and atomic root exchange;
`--defer-verified-retention` preserves every prior rollback and release artifact.
The Audit29 coupled node-shadow gate is unchanged and is not invoked for this
frontend-only release. No hold, prune timer, Caddy, API, registry or fee change
is included.

Rollback preserves the complete currently served root for release
`527e4cbaa66f-20261001T062733Z`, not merely its entry bundles. The publisher
restores that root on failures inside its transaction. If external HTTP
verification fails after publication, restore the freshly fingerprinted prior
root by complete-root atomic exchange under the shared deployment lock, verify
its provenance and public HTTP, durably sync parent directories, and retain
the rejected candidate with truthful failed-release evidence. Never delete or
prune recovery to make this release fit.

Production acceptance will bind active manifest, source commit/tree, dependency
digest, managed archive and exact public bytes separately from the unchanged
node runtime. Controlled race and malformed-response tests remain local
evidence; real public reads and connected-account checks are separately
reported. Release preparation is approved; publication and announcement are
still pending at this pre-commit boundary.

Fresh UI preflight at 13:43:23 UTC verified prior rollback provenance and
capacity. Live manifest SHA256 is
`305492a8b43e08a3fec529fad770f58b5209c9eb605490c694562242314f94ba`;
complete live root is
`acde0cfe67a9716074135758b364703c05047693336dcaec1e5282361d9de8c0`.
The single existing rollback root is retained with its exact fresh fingerprints
in the companion evidence. Root available space was 25,747,083,264 bytes;
release scratch used 3,936,157,696 of the fixed 5 GiB ceiling. Neither reserve
will be lowered. Preparation hygiene removed only ignored `dist` (13.1 MiB)
and the zero-byte Vite temporary cache; repository hygiene and diff checks
passed. No tracked or protected deletion occurred.
