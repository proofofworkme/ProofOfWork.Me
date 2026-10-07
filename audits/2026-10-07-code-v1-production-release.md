# ProofOfWork Code v1 production release audit

Production discovery, runtime/public admission, UI/Caddy/HTTPS and live browser
verification passed on **2026-10-07**. One release announcement was verified on
[@proofofworkme](https://x.com/proofofworkme/status/2107780536563388860) at
**2026-10-07T10:30:52.852Z**. The authored documentation reconciliation records the required
repository hygiene and final semantic review below.

## Product and release identities

Code v1 provides public address-owned repositories, exact UTF-8 source, one
confirmed history, browser diffs, verified source and ZIP downloads. Creation
txid identifies the repository and initial head; hydrated input prevouts establish
its immutable owner. Commits apply only against the current parent and valid
path tree. Stale and pending events remain visible without advancing that tree.
Nonempty files use one verified `source.txt` / `text/plain` Files attachment,
up to 60,000 exact bytes. BOM, Unicode, case, whitespace and newlines survive.
Empty files use a zero-byte Code commitment. Source stays inert. Code adds no
economic migration: ordinary Mail/Files count the owner-directed payment of at
least 546 proofs once, plus the reviewed miner fee. V1 excludes Git transport,
branches, merges, private repositories, ownership transfer and code execution.

| Scope | Source | Merged PR and merge commit |
| --- | --- | --- |
| Product/protocol and 19-root UI | `13ddf6d7f401195c210e0cc201c2aadca71daabe` | [101](https://github.com/proofofworkme/ProofOfWork.Me/pull/101), `d3975038df5ba54ee90c820b270c278f3780fc9d` |
| Search timer/service guard | `fce904c29c5bb99c86ad4c83ac49b032a17236cd` | [102](https://github.com/proofofworkme/ProofOfWork.Me/pull/102), `4b50c6163aca4347e845c814d13b6a3984d39af4` |
| Pinned socket/proxy drain/restore | `2263be80ff6d0d71f72158f829132a83260189c8` | [103](https://github.com/proofofworkme/ProofOfWork.Me/pull/103), `0a859776f86b670baf64d5558574d092ea57e329` |
| Trusted-Core discovery repair | `ed0fc2c5df564c8275975a7c056d7481346033e6` | [104](https://github.com/proofofworkme/ProofOfWork.Me/pull/104), `fcb44ce5142f03a267379db0f88283ea6e9288dd` |

The UI is the frozen release `13ddf6d7f401-20261007T030045Z`, source tree
`edc04af413dbabea8fa044bd2677b22cc3543e7a`. The active scanner overlay is
`ed0fc2c5df56-20261007T033400Z`. The later controller/scanner commits did not
rebuild that UI. Documentation preparation is based on merged PR104 at `fcb44ce…`.

## Active-source preservation and guarded installation

Production Git HEAD `92eb5fbdaacfd05955dae6d994586850f93944b9` was background
identity, not complete runtime authority. Exact before/after hashes preserved
accepted Audit31 P2/P3, native lossless transition storage, wallet/economic
dependencies and Search shared-confirmed generations. The original dirty Audit31
checkout remains untouched. Initial deployment used 11 fixed source targets,
193 dependency pins and 196 unique active paths after overrides. Import closure
grew only through the three Code helpers. Native closure uses the accepted
storage contract and `proof_indexer.read_work_transition_payload_v1`, then the
strict physical raw-candidate/sealed-witness check. Search retains
`proof-search-v3-code-shared-confirmed`. No canonical replay/reset, silent
historical append, H-1/WORK authority migration or ledger/config cleanup occurred.

The initial timer-shaped guard refused before source writes. A subsequent API
socket reactivation race refused the fix1 cutover; rollback/restoration evidence
is retained. PR102/103 repaired those exact controller guards. Fix2 installed the
original overlay at 03:18:04 UTC, with immutable rollback root
`/data/proofofwork-release-backups/code-13ddf6d7f401-20261007T030045Z-20261007T031803Z`.
Its live verification retained all 196 pins and authority identities, while Code
correctly returned unavailable for incomplete historical discovery.

Two later automatic approval reviews refused the optimization before execution.
The retrieved original human approval is preserved. Fresh direct human approval
in the 03:39 UTC minute answered “I approve these production actions” to the
named runtime update, Search hold/restore, pinned gateway/API/worker cutover,
bounded discovery, staged 19-root UI/Caddy publication and verification scope.
Its trusted contextual async item is
`["request_user_input_async","call_cef4386e8aa44230b1e065a5bee0f4cb",0]`;
this item identifies human authorization and is not presented as a hashed receipt.
The approved optimized cutover completed at 03:40:28 UTC and was verified at 03:40:56. Only
`server/code-repositories.mjs` and `scripts/backfill-proof-indexer.mjs` changed;
the other nine targets, all 196 active pins and authority identities were retained,
and Search was restored. Optimized rollback root:
`/data/proofofwork-release-backups/code-ed0fc2c5df56-20261007T033400Z-20261007T034027Z`.
Earlier refusals and source/provenance records are not relabeled as successful.

## Supervised historical discovery

An earlier use of the `pwc1:` marker may be malformed; detection is not acceptance
of a repository or commit. The scan follows authenticated first-party Core's
accepted chain/body/consensus, checking requested/returned header hashes, parent
continuity, full canonical raw framing and exact output-script boundaries.
Negative blocks avoid verbose hydration; positives retain exact raw/verbose
candidate parity, prevout/source verification and sealed closure. Checkpoint,
reorg and gap checks remain. This does not independently revalidate consensus or
Merkle/witness roots, and required no wallet signing or broadcast.

Each attempt resumed the saved marker without resetting it. Public readiness,
196 source pins, canonical identities, exclusive owned children and resource
bounds remained fenced. From Run7, unchanged readiness predicates could recover
for at most 60 seconds while no child ran; running-child degradation still halted.
Later namespace and diagnostic changes are preserved separately. The sample
wrapper's failed attempts/corrections and original bounded 1,000-block witness
remain evidence. The table records boundaries rather than minute-by-minute reads.

| Attempt | Saved versus supervisor-accepted boundary | Outcome and qualification |
| --- | --- | --- |
| Run1 | 1,000 unchanged | `busctl` option parsing refused before unit/child acceptance; delimiter-only correction followed. |
| Run2 | 71,000 | Seven children succeeded; pre-child readiness guard halted. Failed request component was not retained; cause unknown. |
| Run3 | 221,000 | Fifteen children succeeded; pre-child guard halted. Later 503 is separate evidence, not proof of the failed request's cause. |
| Run4 | 221,000 unchanged | Fresh outer 503 refused before own root/unit creation; failed component not retained. |
| Run5 | saved 253,000 / accepted 252,000 | Child succeeded; health-after timeout 3.015258 seconds halted acceptance. No HTTP body; cause unproven. |
| Run6 | 349,000 | 96 children accepted; next child never started after preserved 503/lag1/worker-not-ready. |
| Run7 | saved 374,000 / accepted 373,000 | Successful child followed by exhausted idle wait. Old exception handling lost original success-state fields; surviving drain assertion is not reconstructed as a direct inactive snapshot. |
| Run8 | 675,000 | 301 fixed 1,000-height children accepted; natural pre-child idle exhaustion. Next child absent. No forced cancellation occurred. |
| Run9 | saved 690,584 / accepted 685,000 | First 10,000-height child succeeded; next running-child timeout 3.015342 seconds halted. No failed-child drain receipt; reviewed latched cleanup plus later not-found/empty groups are distinct evidence. |
| Run10 | saved 702,742 / accepted 700,584 | First 10,000-height child succeeded; second during-child timeout 3.015210 seconds halted. Same failed-child evidence qualification. |
| Run11 | 702,742 unchanged | Outer timeout 3.014769 seconds refused before own root/unit creation. |
| Run12 | saved 834,742 / accepted 833,742 | Child132 succeeded, exact drain assertion preceded post-idle exhaustion: 11 failures, five 503s/six timeouts, last 3.000139 seconds. Failed recovery and later three healthy reads remain separate. |
| Run13 | 970,323 complete | 136 fixed 1,000-height children; final child scanned remaining 581 blocks. Exact complete marker and accepted health / Code / health probe retained. |

Timeout causes remain unproven; later health samples are not substituted for the
failed request. Longer-batch timing and peak memory do not establish causation.
Original successful active/exited snapshots, executed exact-invocation
descendantsAbsent assertions and later direct not-found/empty snapshots remain
distinct. The scoped worker-journal export and proposed own-gap cancellation were
automatically rejected before execution. No export/retry/classification probe or
production pause/control/signal/timespec read occurred for those proposals; the
cancellation plan was disabled and Run8 continued to its natural halt.

## Completed coverage and ongoing extension

Run13 final at **2026-10-07T09:50:19.284080+00:00** binds full discovery from
height **1 through 970323**, hash
`00000000000000000000d4401afd7a7795ee06e4d333308e61961cece32dd47c`.
Model `canonical-code-candidate-discovery-v1`, network `livenet`, complete true,
candidate count **0**, blocked candidates `[]`, digest
`38a551871e844eab776d536642267b0d313630a76e5de06240bfb950c9920587`.
That establishes no earlier uses of the marker in the covered accepted history,
including malformed uses; it does not exercise a live repository transaction.
The retained exact-tip internal completion bracket returned fresh Code 200 with
`proof-indexer-exact-canonical-code-replay`, coherent complete snapshot 970323
and ready/zero-lag matching-hash health before and after.

Ordinary scanning subsequently extended the still-complete marker to **970324**,
hash `00000000000000000000bab1afd1d7d07c7b7b177bc836f704f51d3d8b8699ca`,
generated `2026-10-07T09:56:56.057Z`, preserving zero count/digest and no blockers.
The original historical target 970323 stays in metadata. This later observation
does not replace final runtime/public admission checks or ongoing new-block gates.

Final backend runtime verification at **09:59:30 UTC** accepted all 196 source
pins, four unit-byte pins and six unchanged authority identities, with Search
unheld/HTTP 200. Its strict health / Code / health bracket took 1.679462/0.478415/1.137311
seconds and matched complete marker/snapshot 970324. Independent off-host public
verification at **09:59:55.540695 UTC** accepted the same boundary: health ready/
zero-lag before and after fresh Code HTTP 200, source `proof-indexer-exact-canonical-code-replay`,
coherent complete snapshot, total 0/no further pagination and zero repositories,
commits, files, invalid events and pending events. Later observer latency is
separate from these accepted bounded gates and is not assigned a cause. These
receipts cleared UI publication to proceed; they do not establish its completion.

Post-publication checks preserve a separate failed health-before timeout at
**10:16:01.998024 UTC**, receipt
`931f786da2fde526a2ad26d6d9435702ed906c3e819d7652c61924731961ad40`;
complete marker 970328 and source/unit/identity checks survived, but no health body
was retained and cause remains unproven. The same frozen verifier later accepted
**10:16:50.620949 UTC**, receipt
`69b70d1ea81ef56e890cfb1aca5ad1e146af4997cf163cd7f4593340ea69fd90`,
196 source pins/four unit pins/six identities unchanged, Search unheld/200 and
strict bracket 0.770275/0.477069/0.461921 seconds. Independent public gate then
accepted **10:17:44.935814 UTC**, receipt
`fce76037440459d0fa929f199d471bbbf150a327ae7035e66b6e64f1807757b3`,
at complete checkpoint 970328 /
`00000000000000000000989d8a9d2814d1ff919799b7b4aa3e214dcdcf6a8bf1`,
still zero count/digest/no blockers. These later dated observations supplement
the preserved original 324 boundary rather than replacing its receipt.

Read-only quiescence v3 was independently checked with 22 local tests before its
owner executed it. It pins manifest, stored final/last-batch hashes, source/release,
exact integer fromHeight, successful child/drained invocation and complete probe.
It accepts only empty or exact owned actual control groups and checks recursive
populated state plus direct process/thread absence. At **09:59:02 UTC** it observed
parent active/exited with MainPID 0 and empty actual group, last/next child not-found,
no remaining owned groups. Original final-child active/exited success snapshot and
drain assertion remain separate from these later direct observations.

## Critical evidence

Original artifact bundles, corrections, all supervised attempts and the detailed
preparation narrative remain preserved. These are critical boundary SHA-256 values,
not a minute-probe list. Local full inventory:
`/tmp/proofofwork-code-release-draft-evidence-index.json`; historical preparation:
`/tmp/proofofwork-code-production-release-audit-draft.md`.

| Record | SHA-256 |
| --- | --- |
| Optimized cutover / Search restore | `23d924cceea500ac9bf63bd6a94b3bdf2dcbf3817fab6c62e1fdf40593eaf76a` / `fac06cd0bad9934d391efbfdbd67cd8153bc0dce22bbfa53e0fc65f5adcacd0a` |
| Corrected bounded sample / harmless typed probe | `1416c74ed7e9e335cb4227ec5a0f19402385284cb4dcc097583a7cee6c184f94` / `c9a6b13db609550da5605cb96d5214b38d2d9751c5e7910fd9772dd27cd70d9c` |
| Runs2 / Run3 compact halt boundaries | `811ec3cc2119f654cc320d74c8fb2518e85c2484d95f4e5967280aa90e52b8fe` / `b53a2fcbc5d1775640891d13b04297381d6bb68f1e80a5a2b26641f0b3a769cc` |
| Runs4–5 compact boundaries | `ce01b505924818db8d1ae1922bbedb25a3e65ee811013d7a2b8c52d5cdf6ecbc` |
| Runs6–7 / Run8 and Run9 compact boundaries | `d8adfc71f35dd31ee33477049afaa73f695f47b1920adcffc7c1d41ade8aa7c4` / `f14925af893d846a75badb8e541e43faf562b6910daf4ec90767054f653c01fa` |
| Runs10–12 / Run12 halt and Run13 launch compact boundaries | `52f5e9404cd202f9f3e226b4935cb936d703157f858b1792d9f4f0fa8bc5be4c` / `60b2d326b29a4ad1e75a5ef8fc3232cc102c16cb7e3a1411dbbbb3ad20e6a826` |
| Unexecuted cancellation rejection / disabled plan | `ff28fbcbecb6d6c49159d0431a2a77b2f55ed50465afac992bab268721672723` / `26227d127b8f8c0413b4f578dcb740b1e5753efa8a975fcd0eaf3ef3d8e87dea` |
| Complete final / last successful batch | `1c0752b192569db31e9eee1fbfb7d517104874325f383c6246ab5fe7b08deacb` / `bd6a2ea0fe19a29dc16fccbc131f576e6b8ae376ca5b2865f0b289b8fd12e245` |
| Complete monitor / ordinary extension monitor | `064210e4348922b2b2ff620832cf733fd54c02aeeabb3b877dd501f9f0606efc` / `86cc8a8b33a9f6dee4d20f6b884afb988f76edf03b4219a3c5c1a94d55dcc8e4` |
| Quiescence v3 local review / actual read-only receipt | `ada105c7859dfdf12f3ba042aec6775b191fe404d4bb4b148fa921ce48c826d3` / `ff305f4106d32da866fbaa9777d73c95adfa6117050e980177ff6f410375cc31` |
| Final backend runtime / independent public admission | `4f91c8c3f47fa5189184e055948dd6666b7c081951deae5f1bc86ac47d7da024` / `98a8251a3a96509ab879c85b368a2ec26b377dd4a25c8c5ebca6899dfe4cbac1` |
| Final backend handoff and qualifications | `d589a09412562a3c3d09d2ced700e52e5de062184670c788aff71c37f274758a` |

## UI and release verification

Prepared UI has 19 managed roots: 18 public builds plus NFT's byte-identical
Computer alias. Historical 14–18 families and retained source/rollback archives
remain verifiable. Initial capacity refusal is preserved; preparation used exact
preserved inputs without deleting history. Managed archive SHA
`f57f6c5f589938f35ef2061015e4abc53c50121c9eccdb75a5a09e77e578259d`,
stage receipt `274f096d9c99d851561a0019de6a6c7ff450c65dff1937ebad0a0c27ec6fd2b1`,
source receipt `96251247717d5eb2974dfa2d600704016913a33bc6c3572663a8c96b85fbb123`.
These establish prepared/staged bytes, not publication or live Caddy/HTTPS evidence.

The first publisher invocation at 10:00 UTC refused its nonblocking lock before
intent creation, SHA `63ab3ddeecf583e6a11b8d6a17e97bb1cf26b925c2aed7565d7edbacf1e7a8f1`.
Post-refusal quiescence `68d2746886f4c20ee1772b1ef6cbbeadfa83fc13826ed8c09233698e1b3c4c43`
observes own unit failed/PID0/empty group; no publication intent or initial Caddy
evidence exists. Fresh live receipt `5ac57321afcfd670abb49889dd030500a0a053d097534bd0125eaa4905249e11`
retains unchanged Tips roots/Caddy, while candidate receipt
`a121820039000592dd07f86b1aa43bdefb7c57915a5f02af487d356e8f7bfd00` preserves staged inputs.
Root/backend separately cleared namespace-only v2 plan
`e9013cfede950fbc611ffaba599f7f3560fe0bb128361532d5f033b127760dcc` and held arguments
`8f9bbe6bf15f38be32011d97ba59103af67c3757134efa60d8ab95bfa848f435`; no override or lock
bypass was used. The exact reviewed v2 attempt subsequently finished successfully
at **2026-10-07T10:11:14Z**, accepted publisher receipt
`cd4e0a757d2c41aa64f830f66b107ec61a5330c1d24ae43d9966dc05b04e4208`,
manifest `e2ef305fe4e20aa708b03e7e35a3835fbbb98f9b421be05b01202d1a9ca7b1ab`,
with exact release/commit/tree/archive and all prior roots preserved. The new
rollback root `/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-13ddf6d7f401-20261007T030045Z`
preserves old-live manifest
`6cfcd207286449e9a3d5474b00e8eb3f03a96ad7b83f7320edb8c4fb1128853a`
and tree `267d584f1dfd5996655cd0aecc776ff5edef1956abd37524e1564cfd4edbff8e`.
The earlier lock refusal stays historical. Caddy/HTTPS evidence and root-owned
live browser QA are separate completion gates.

Caddy completed with pinned manifest
`efd400b83c8f77053335718cd739064b36b937000fbd6362e1cf3dfbc5652e3e`,
intent `d2e1627ec8ab55c4a93851d0d2420c7bb241f028a0dd635125cf0b0ed33eb8a4`
and completed receipt `30b4e109f3184c50f6f26a11f7e951bc34fcfe41f4017b844e2705fca05fd737`.
Accepted read-only observation at **10:13:27 UTC**,
`7e83e20d003293003d366c88ada65a88cc9490e1a76bfc970cdf7cbe072f7a17`,
binds `/etc/caddy/Caddyfile` old hash
`49b996bb16ca275c1b82dece01b10b0dbafbc9d79eb621d97df4aa9a60fd4bfe`
to `035b238a3aad7a94efa1443006d186eae6a4c8cc1ce87f5514992e44c9473116`,
root-owned mode 0644. Caddy remains PID 3092586 with original invocation
`201feac74de54f1da7b5e304adb1b621`. The just-published serving root and preserved
rollback roots remained pinned through the Caddy installation. The three retained
roots and timers were preserved, with the audit28 hold intact. HTTPS bytes and
browser behavior remain separate checks.

Whole-release off-host HTTPS byte verification passed at
**2026-10-07T10:17:35.047Z**, receipt
`201cd16b1d2a6b6e8282b871e120d1e99103cefc0d00dc4fdabe7af2de1653a2`:
all 1,406 expected public files across 18 hostname roots, apex redirect, exact
archive/sidecar/provenance and final local evidence, 271,660,227 response bytes.
All 19 managed roots remain in the exact archive; only NFT's 79 duplicate files
were skipped for public HTTP requests, with its alias/stage/archive guards intact.
Compact UI acceptance `1b8c2b5f4c7b21fce69e7494e65518e0f5a1ff576bd903ba0f4ad24a4962fc27`
binds publisher/Caddy/HTTPS, unchanged Caddy invocation/timers/hold, preserved roots
and clean frozen source/nine wrappers. This is byte/provenance verification;
root performed actual desktop/mobile standalone/Computer browser checks.
Final live QA accepted **2026-10-07T10:25:29.724Z**, receipt
`f0b52926fd78546efa287465e711b4501d2dbd5ba66cc3ed55634818c6131168`,
bound to complete public checkpoint 970328. Fourteen PASS entries cover standalone
reader/refresh and blank writer at 1440/390, mobile overflow, explicit absent-repo
state, Computer's single header/read/editor/refresh/navigation, Home's Code link
and activity, Search's Code filter and Growth's four Code counts/shared value.
One wrong-viewport capture is retained as superseded; early stale-paint captures
are excluded. Final actual screenshots include
`/tmp/proofofwork-code-live-list-1440.jpg`,
`/tmp/proofofwork-code-live-list-390.jpg`,
`/tmp/proofofwork-code-live-computer-1440-final.jpg` and
`/tmp/proofofwork-code-live-computer-390-final.jpg`.
Root viewed those finals and separately verified DOM width; no material console
errors were recorded. Live source/history/file-ZIP and real Search record replay
remain not applicable because confirmed repositories/files/records are zero;
their local fixture checks remain separately qualified. Only blank unsubmitted
drafts were used. No wallet connection, transaction preparation, signing,
broadcast, financial action or deletion of user data occurred.

Local checks cover protocol/replay, API/source/ZIP/reservations/drafts/wire order,
server closure, shared economics, Search, Growth, builds and guarded deployment.
Six browser regression cases and source/history/editor screenshots are mocked
fixtures only. No production Code transaction was signed or broadcast, no
financial wallet transaction was performed, and no private key or seed was handled.
Source-linked checks and their retained evidence remain separate from the
live-production gates. This final handoff changes documentation only; its
required hygiene check verifies the note inventory, links and generated bytes.

One release announcement was verified on the exact permalink
[https://x.com/proofofworkme/status/2107780536563388860](https://x.com/proofofworkme/status/2107780536563388860)
from `@proofofworkme` at **2026-10-07T10:30:52.852Z**, visible as
“6:30 AM · Oct 7, 2026”. Receipt
`de249ef5c04f2f523cb5ce7a88eb3092b774f5ba71f1012ee2bcdc4a3fa25065`
and actual published screenshot
`0d7912e047dff85808a019c7467e63fcbb166160f567f9b6394ffef284c3d3a2`
bind the account, product link, text and `$WORK $POWB $INCB`. An initial click
showed no completion; an independent fresh profile confirmed no Code post before
the scoped submission succeeded. Only one release post was published and verified.

| Final gate | Result and exact receipt |
| --- | --- |
| Historical complete marker and internal exact-tip Code bracket | Complete through 970323; final/last-batch hashes above |
| Owned natural quiescence | Passed at 09:59:02; receipt `ff305f4106…` above |
| Final 196 source pins/four unit pins/six identities/runtime/Search/readiness | Passed at 09:59:30 and repeated at 10:16:50 at 328; receipts `4f91c8c3…`/`69b70d1e…` above |
| Independent public health/fresh-Code/health admission | Passed at 324 and repeated at 10:17:44 at 328; receipts `98a8251a…`/`fce76037…` above |
| All 19 roots published with retention/source/archive provenance | Passed at 10:11:14; accepted publisher `cd4e0a75…`, manifest `e2ef305f…` above |
| Caddy exact before/after and Code same-origin route | Passed; accepted observation10:13:27 `7e83e20d…`, completed `30b4e109…` above |
| Whole-release off-host HTTPS asset bytes | Passed at 10:17:35; receipt `201cd16b…`, compact `1b8c2b5f…` above |
| Live standalone/Computer desktop/mobile browser | Passed at 10:25:29; root receipt `f0b52926…` above; live source/history/ZIP explicitly N/A |
| Documentation reconciliation | Hygiene fix passed with no allowlisted cleanup; hygiene check passed. Six canonical docs, this protected audit and its inventory classification were reviewed; no source/runtime changes or deletions. The authored commit carries the required trailers. |
| One verified `@proofofworkme` release announcement | Passed at 10:30:52; [verified post](https://x.com/proofofworkme/status/2107780536563388860), receipt `de249ef5…` above |

The final hygiene pass ran `npm run hygiene:fix`: no allowlisted rebuildable
state was found. `npm run hygiene:check` passed; the final wording was checked
again before staging. Semantic review covered SOUL and canonical product/protocol
docs, the note inventory, generated artifacts, the unchanged cleanup allowlist,
Git status/diff and the relevant retained source tests. ID/DNS registry rules,
1,000/546-proof fees, ID management boundaries and Mail/Files accounting remain
unchanged. This audit is classified as protected ledger/audit evidence. Only six
canonical docs, this audit and that classification change. Historical evidence,
ledgers, refunds, archives and the separate Audit31 checkout remain preserved.
No files were deleted. The authored handoff commit uses
`Documentation-Impact: updated` and `Repository-Hygiene: reviewed`; its Git
identity is the commit containing this note. Documentation bookkeeping belongs
to the same Code release and receives no second announcement.
