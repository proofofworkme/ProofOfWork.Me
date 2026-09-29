# Approved Audit 28 cleanup and corrections — production execution

Date: **2026-09-29**, America/Toronto. Remediation followed the same-day audit and was verified through approximately **20:30 UTC / 16:30 EDT**. The user explicitly approved cleanup, corrections, commit, deploy, merge, push and verification through production.

## Result and recursive evidence

The four new Audit 28 defects are corrected in production. UI capacity is restored, the DNS seal appears as a valid confirmed public Log event, DNS coverage is fenced to the canonical scan checkpoint, and Desktop preserves canonical message/download bytes. Final node readiness is **true with zero chain lag**. Strict indexer parity, exact Core-ordered ID replay, the public ledger audit and all 15 public surface checks passed, with one homepage timeout successfully rechecked.

This does **not** close all older application or storage issues. Fresh wallet availability, unchecked physical database pages, isolated restore qualification, transition-table growth and retained replay/incident material remain follow-up work. This record supplements the immutable [Audit 28 baseline](2026-09-29-production-comprehensive-health-data-integrity-audit-28.md); its earlier read-only result remains historically correct.

[Execution evidence](2026-09-29-approved-audit-28-cleanup-corrections-execution.evidence.json) SHA-256: `a569ee9b9b4535ec993fc993f65e59c6d5cbcfe98155eafa8a7c713047d768ec`.

Predecessor bindings:

- Baseline report: `9310f980d27cb7d8296b32b207b7c0f937b5ceb0c6bb9cfa8dc775cfd24dc8b6`.
- Baseline evidence: `db1ca241011a777be688b4c8e0ddd4eaf02eef5ea75645f4e20e36e47be9090a`.

The evidence contains sanitized execution receipts, exact cleanup plans, read-only reconciliation and scoped derived-repair procedures, parity checks and public surface results. It binds full execution transcript hashes while omitting repetitive cutover output. No credentials, seeds, private keys or private mailbox bodies are included.

## Releases and systems checked

- Application release: `3bc6c9d44e00c504c324a1f13b7803f89cbfb122`, tree `a3428b21a53b98603771470a7744b5e9ec81eb42`; [PR 93](https://github.com/proofofworkme/ProofOfWork.Me/pull/93).
- UI release: `3bc6c9d44e00-20260929T200127Z`, all **16 deployed static surfaces**, archive SHA-256 `9fb8049076552a54fa847cb86c39dbeeb02268e07a38dc6e1366043b8876438f`.
- Node release: `3bc6c9d44e00-20260929T200136Z`, recursively attested source and dependencies; runtime fingerprint `2532852be0eef362a2902d4defbc2662e10d2a2fb1d8310069480cac22399f09`.
- UI retention tooling: commit `cefcc18`, [PR 94](https://github.com/proofofworkme/ProofOfWork.Me/pull/94); verified installed publisher and helper hashes are in evidence.
- Node retention tooling: commit `e6e60ba`, [PR 95](https://github.com/proofofworkme/ProofOfWork.Me/pull/95); installed tool/service hashes are in evidence.

Both VPSes, Caddy, Core/Electrs, PostgreSQL, API/indexer worker, canonical checkpoint and summary read models, transaction status, DNS/ID/event/mail projections, static assets, backup retention and capacity monitors were checked. The baseline contains the comprehensive CPU, network, RAID, inode, logs, database and protocol arithmetic inspections; this execution rechecked release-sensitive results. Provider billing-period network quotas were not available.

## Health, capacity and retention

| Final measurement | UI VPS `77.42.91.106` | Node VPS `65.108.122.87` |
| --- | --- | --- |
| Root available | **28,538,146,816 B**, 26% used | **71,733,825,536 B**, 29% used |
| `/data` available | No application database on UI host | **474,455,666,688 B**, 73% used |
| RAM available | 3,341,549,568 B of 4,005,457,920 B | 117,962,178,560 B of 134,125,752,320 B |
| Load sample | 0.24 / 0.24 / 0.30 | 4.80 / 3.48 / 2.89 during audits |
| Primary services | Caddy active | Core, Electrs, API, worker, PostgreSQL active |
| Database bytes | None | 37,538,323,479 B |

UI available space increased by approximately **17.42 GB** relative to the baseline despite staging the new release. The original approximately 364 MiB headroom above the 10 GiB reserve is now approximately **17.80 GB**. The reserve and admission safeguards were preserved.

Before deletion, current/latest complete roots and their archives were verified, live process/file/config/symlink/mount references were checked, and compact retirement evidence was saved. Actions:

1. Retired **16** obsolete complete UI rollback roots. Preserved the then-current and verified latest rollback.
2. Retired **68** proven rebuildable UI source/surface/transport paths, approximately **10,367,815,680 allocated bytes**. The incomplete/unverified `source-388572b6c8eb` copy was excluded.
3. Pruned **17** obsolete managed UI archives initially, then the superseded d2 archive after the new release. Exactly **two managed release archives** remain: current 3bc and latest rollback 0e. Exactly **one complete rollback root** remains, `proofofwork-www-pre-3bc6c9d44e00-20260929T200127Z`, containing 0e.
4. Retired the one newly redundant complete root after publication with the new verified-retention helper. It refuses unique non-release content, missing/corrupt recovery material and live references; repeated dry-run then reported zero candidates.
5. Initially pruned **16** older verified node managed archives, then **two** superseded archives after publication. Exactly **two managed node release archives** remain: 3bc and the prior live d2 release.
6. Installed verified UI retirement after successful publication under its inherited deployment lock. Node release-prune now runs `managed 2 --apply` under the explicit operator approval. UI and node retention services returned success; UI storage health also returned success.

Managed release archives are distinguished from unverified historical recovery artifacts. Legacy incident/configuration copies were preserved. Node logical backups, the active approximately **89.5 GB INCB replay database**, other replay/repair material and unique evidence were not deleted. Age alone did not establish safe retirement. The PostgreSQL transition table remains the dominant database consumer; this cleanup did not truncate or compact canonical history.

## Corrections and integrity verification

### AUD28-01: DNS seal authorization comparison and derived event

Normalized DNS sale authorizations previously compared serialized object property order. The seal path appended signing fields in a different order, causing an otherwise valid signature/terms pair to be classified invalid. Comparison now checks normalized semantic fields, with signatures still validated separately. Altered-price and signed/unsigned regressions pass.

After independent Core raw transaction, canonical block/index, protocol script, seller input and signature validation, exactly **one existing derived event** was corrected:

- Txid: `dd498455bb712411341cfde6fab38764281ff6b77076a41012c3bee768475e38`.
- Canonical position: block **969136**, transaction index **3156**, protocol vout **1**, record ordinal **0**.
- Event ID **4472609**: `dns-seal-invalid` → `dns-seal`, valid=true; participants and refs regenerated using the canonical relation module.
- Preimage receipt: `/data/proofofwork-audit28-dns-repair/before.json`, SHA-256 `862b8bc0fe3dd9ca828b24713f833cccba8ad8c2771de02d8a2031d58f85afd7`.

Canonical raw transaction bytes, historical ledger transitions and chain evidence were unchanged. Final public Log txid search returns exactly **one valid dns-seal**. No broad reindex, migration or ledger rewrite was performed.

### AUD28-02/03: DNS checkpoint and validator

DNS uses complete registry address history, exact confirmed Core hydration, canonical block order and authoritative pending hydration, fenced by stable Core/Electrum tip and history fingerprints before/after the read. `indexedThroughBlock` now describes the scanned checkpoint; `latestEventBlock` separately describes event recency. Incomplete or changing coverage fails closed. The surface validator now checks DNS's actual records/statistics/coverage contract. Shadow and production DNS tests passed.

### AUD28-04: Desktop bytes

Mail activity no longer trims canonical memo text, and public Desktop search uses fresh address mail. The deployed `message-body.html` and its observed Download data-URL payload contain **1,018 bytes**, end with byte 10, and hash to `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`, matching canonical bytes. The prior 1,017-byte trimmed representation is gone. Native download-event observation timed out; the actual browser download payload was decoded and verified, but a saved file on disk was not independently verified.

### Complete reconciliation and status

- **26,069 indexed transactions** were checked against Core raw bytes, with no raw/confirmation errors; **21,196 canonical block hashes** matched. No dropped transaction was present in both mempool observations. This check was fenced at tip **969195**.
- One indexed pending transaction was absent from both authoritative observations: `d729663829165bf4500e4708fd62dbf00f8012dde9ab4e53b321ce0cfe864cc2`. The worker required repeated absence over its confirmation interval, recorded eight observations, and correctly transitioned it to dropped. API status independently confirmed authoritative absence. Readiness returned green without a manual status edit or weakened guard.
- Final readiness checkpoint **969196**: Core, Electrum and indexer agree on canonical hash; zero lag, canonical state valid and all eight summary keys eligible.
- Strict parity: **102 checks**, zero active invariant failures. Existing historical migration/bootstrap warnings remain classified, not treated as new defects. Earlier concurrent-head/NULL parity attempts failed; the final strict run passed.
- Event relation/mail projection gate passed. Exact ID replay: **587 fetched transactions**, 565 confirmed and 22 pending registry transactions, 538 lifecycle events, 508 winners, six active listings and four canonical sales. Seventeen existing refund candidates and two pending watch entries remain records, not executed refunds.
- All 15 canonical public surface checks passed across the sweep and homepage recheck. The sweep's first homepage probe aborted at 20 seconds; its 60-second recheck passed. All 16 static release surface fingerprints were separately verified.

## Math and prior findings

The baseline's exhaustive fee, supply, ordering, INCB integer and transition checks remain bound in its evidence. Post-correction strict parity and public ledger consistency passed with zero permitted tip lag, snapshot `0e25b0d45ad952359ba8d758`, network value **14520834903306801355.85252463 proofs**. No arithmetic constant or protocol fee rule changed.

WORK conservation/caps, the 47 canonical INCB mint integer/dust calculation, generic credit conservation, canonical transaction fees, transition linkage and the intentional migration boundary remain verified as described in Audit 28. The DNS value overlay remains **12,046,000,000,000 Q8 units**, corresponding to 120,460 weighted proofs; the event classification repair does not change that already accepted canonical overlay.

Rechecked prior issues, without issuing duplicate tickets:

- UI accumulation H5-01/H8-04/H10-04/H18-08: current capacity regression corrected and publication/managed archive recurrence controls installed.
- Fresh wallet fail-closed/last-verified availability H24-01/AUD26-02: remains an existing limitation; public surfaces passing does not prove uninterrupted fresh spending availability for every wallet.
- PostgreSQL checksums disabled H18-06 and no physical `amcheck` coverage: remain unresolved; logical/Core reconciliation does not prove every physical page healthy.
- AUD26-01/H24 storage growth and replay/repair copies: available space remeasured, active/unique material retained; further dependency and restore qualification needed.
- Historical checkpoint/header/migration/USD-quote warnings: no new invariant failure in final strict parity; preserve historical evidence.

## Deployment actions, limits and handoff

Node candidate passed attestation and read-only shadow checks before cutover. The first publish attempt used an incompatible archive commit-prefix length; guarded cutover restored the prior node and service/timer state automatically. The corrected retry completed successfully. Core/Electrs/PostgreSQL authority identities were preserved. UI capacity/provenance gates passed before and after atomic publication. Retention tooling was installed with prior tool/service copies preserved and exact installed hashes checked.

Application and retention changes were committed, pushed and merged through PRs 93–95; repository hygiene hooks and Node 20/22/24 hygiene CI passed. Relevant DNS/API truth, live-data, UI operations, seven retention refusal/preservation tests, node operations, storage forecast and API observation tests passed. SOUL and canonical product/protocol docs were reviewed; the lasting changes are documented in DNS, Mail and infrastructure docs. No protocol migration, refund, wallet signature or transaction broadcast occurred.

No remaining approval is needed for the executed scope. Future deletion of unverified/active recovery databases or evidence, enabling database checksums, physical repair, or a historical ledger/protocol rewrite requires a separately scoped plan and explicit approval.

Recommended next steps: verify sustained capacity trends after cleanup rather than using deployment-burst forecasts; qualify an isolated restore of the latest logical backup; identify active replay dependencies and safe retirement proofs; keep fresh-wallet availability investigation attached to its existing issue; measure transition-table growth before considering any reversible derived-storage optimization. Future audits should bind this record and its evidence hashes, recheck unresolved items, and create only new or regressed findings.
