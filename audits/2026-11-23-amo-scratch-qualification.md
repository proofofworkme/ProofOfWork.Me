# AMO private staging qualification, 23 November 2026

## Decision

Keep the installed scratch ceiling at 6 GiB. The committed planner knows the release, but the native scratch checker receives a shared directory, an additional byte count and a phase label. Different releases call it with identical arguments. The inherited deployment lock serializes writers without identifying a grant recipient. The November 18 Boost installer replaced the helper for the whole host and tied reversal to its original protected state and a measured fit under the predecessor ceiling. It has no operation to consume an AMO grant. [Native helper](../deploy/proofofwork-ui-capacity.py) · [Transport](../deploy/publish/remote_transport.py) · [Boost installer](../deploy/ui-scratch-capacity/successor_installer.py)

A genuine one-release allowance would need a separately approved, post-build binding for the archive hashes, exact release, attempt, installed tools, protected pair and lifecycle state. Preflight runs before the final plan SHA exists. The receiver would have to verify that plan and consume the binding under the lock before exceptional allocation. A crash can leave newly created evidence above 6 GiB after the lock disappears. Refusing further allocations is possible then. Restoring occupancy below 6 GiB requires a measurement and may require separate recovery. The historical 384 MiB planning exception leaves the native limit in force. This qualification adds no allowance or live entry point.

## Retained evidence

| Item | Value |
|---|---|
| Release | `ace27010a8e4-20261123T181230Z` |
| Artifact commit / tree | `ace27010a8e44886c0c22cf9fe5c98509d28f1bb` / `d648c6c0b5944a11fd364b96141dee65d284d1ac` |
| Source / surfaces archive SHA-256 | `e62a79cf42dda6efdff1d39b37c67a34cab1fdf1aade0705aabc2695f253e5e9` / `92c3a4401b74f4289c0ca57509906dc12c744f4862de982ebd00dc766edc842a` |
| Preflight / build receipt SHA-256 | `1dff1c58922a32ec832999928e5cb3bd8a73b2b176ef42bdcf1307e38d3463fe` / `b49774b72fb2539053d3c0f2266725d134d14d146fbb8a156bc33f2ec8f4b3c9` |
| Closed request / inventory SHA-256 | `3e3bb847bdb644d51167a273ad208c9ffd8705f890c07b18fa39bceb932b61f4` / `e5921b4e325bc73098bb4dcbaf662323ea9996a778b147cf8ecde58cfa542f01` |
| UI controller manifest / state revision | `686eef5c6d3c9132e0ec2f0c0902867070f1eaa0d25679d2b3a7d6d89ec03ac3` / 337 |
| Installed capacity helper / stager SHA-256 | `dfcee2f385e84c42aa98529dd4926fc27c5c6fb4bd0c50b3905b3a3248141df3` / `87ab4269461a91cf89ed50d6ddb81d116a35eb78f7cbcb6b4536946b5bbeb314` |
| Config / state SHA-256 | `bbce6be80e95047760f526550c30ba78f1515a4fd84eba3f7afb39970ebd15d6` / `5a494c50278949e3b44efd25ac96eacfb071c437a36d47b2bb36f4367beb7a1b` |
| Ordered live / rollback releases | `2084747c3f8c-20261118T181547Z` / `9f18a0ce7032-20261118T004519Z` |

Replaying the committed capacity calculation locally with those records and the retained tar-header admission measurements reproduces the 258,375,680-byte scratch deficit. The census had 1,006,153,728 bytes available under the scratch policy. The original candidate required 1,264,529,408 additional bytes. The protected physical reserve is 8 GiB plus 64 MiB, with 128 free inodes required independently. Backup and transport retain their own limits. A successor needs a fresh census at the time of admission. [Capacity calculation](../deploy/publish/sequence_capacity.py)

## Copy-avoidance design and its limits

Construct the private candidate on a fresh, canonical path on the same filesystem. Copy the unchanged passthrough entries independently of the live root. Preserve their internal hardlink relationships across top-level names, directory and root metadata, xattrs and ACLs. Reconstruct incoming surfaces from their verified bytes, then copy the verified dependency closure of the outgoing assets. Keep Pay, both AMO product paths, the Computer/NFT mirror and the current compatibility checks. No candidate inode may alias the live, rollback or incoming trees. Retain existing before/after fingerprints and verify the actual completed allocation under the deployment lock. Mutated inputs, unsupported objects, incomplete surfaces, mismatched closure or metadata must refuse before acceptance. The ordinary route stays in force for other releases. [Stager](../deploy/proofofwork-ui-release-stage.py) · [Private stage model](../deploy/publish/phase_capacity.py)

| Additional scratch, bytes | Local design estimate |
|---|---:|
| Direct construction, including compact input, full incoming charge, completed-candidate bound and evidence margin | 927,125,504 |
| Source receipt, including verification and evidence margin | 946,282,496 |
| Remaining policy headroom at that source checkpoint | 59,871,232 |

The second figure cannot qualify the entire publication. The publisher exchanges the candidate and live roots, verifies active provenance, then moves the outgoing root from scratch into rollback storage. A rename can increase the measured allocation **inside scratch** without consuming another physical disk block. Under the retained source, compact-input, verification and margin charges, 602,902,528 bytes are already committed at that point. The remaining conservative allowance for the outgoing root is **403,251,200 bytes**. The saved 680,783,872-byte estimate is the cost of a future copy. The retained receipt has no measurement of the outgoing root's distinct allocated inodes at exchange. This supersedes the prior end-to-end estimate of 59,871,232 bytes to spare. [Exchange and rollback](../deploy/proofofwork-ui-release-publish.sh) · [Admission checks](../deploy/publish/native_exchange_fence.py)

## Local fixture evidence

The test-only constructor and the ordinary full-copy stager produced the same final tree for all 23 synthetic Pay-family surfaces. Both kept the transitive compatibility assets for Pay and Marketplace. Comparisons included content, modes, ownership, stable mtimes, sample xattrs and hardlink groups. No candidate inode was shared with live or incoming files. A changed source xattr and an unsafe link refused construction. At the sampled incoming-copy boundaries, the full-copy fixture used up to 5,468,160 allocated bytes and the direct fixture used up to 471,040. Both finished at 413,696 bytes. Sampling excludes transient in-copy allocations and the fixture omits the filesystem-wide sync. These are local parity results, not a disk guarantee for the VPS. [Differential fixture](../scripts/check-amo-direct-stage-design.py)

A second fixture reproduces the missing exchange charge using independent pre-exchange and post-exchange directory layouts. The stock planner can admit the smaller candidate while the native scratch checker refuses the larger outgoing tree by one byte. Even a zero-byte allocation request can refuse while failed evidence remains above the ordinary ceiling. Returning authority to the default cannot be treated as proof of restored occupancy. [Exchange-layout fixture](../deploy/publish/check-amo-exchange-scratch.test.py)

The ordinary planner fixtures exercise exact, short and mismatched limits, stale archive hashes, different releases and historical grants. Two expectations in the old scratch suite still assumed the 5.5 GiB predecessor. They now check the installed 6 GiB ceiling and retain the historical arithmetic. The helper refuses a one-byte overage under the default. Local qualification never arms a 6.25 or 6.5 GiB grant. [Closed input fixtures](../deploy/publish/check-closed-input.test.py) · [Sequence fixtures](../scripts/check-ui-release-sequence-capacity.py)

Seven local suites passed 73 tests. All host-style operations in these suites used disposable local fixtures.

| Suite | Passed |
|---|---:|
| `scripts/check-amo-direct-stage-design.py` | 3 |
| `deploy/publish/check-amo-exchange-scratch.test.py` | 2 |
| `deploy/publish/check-closed-input.test.py` | 9 |
| `scripts/check-ui-release-sequence-capacity.py` | 25 |
| `deploy/ui-scratch-capacity/check-successor-installer.test.py` | 28 |
| `deploy/publish/check-private-staging.test.py` | 2 |
| `deploy/publish/check-native-exchange-fence.test.py` | 4 |

The native exchange suite refused the new worktree's group-writable helper mode during setup. Setting that local file to 0755 retained its committed bytes. All four cases then passed with the existing publisher and exchange fence. Both late inode-substitution cases recorded zero root moves. Repository hygiene and `git diff --check` passed.

## Proposed qualification and approval sequence

A separately approved read-only UI census can answer the first outstanding capacity question. Bind the current and prior tree fingerprints, scan allocated blocks and hardlink identities under the deployment lock, account for any shared inodes without assuming a future release of space, and verify the same identities again before accepting the result. Preserve the retained roots and do not perform a trial exchange. Recompute the bound with fresh inputs before any later use.

1. Qualify a successor constructor and matching preflight, planner and receiver in disposable storage. Bound partial copies before deduplication, metadata, old compatibility assets, inodes and temporary files. Compare output against the reference constructor. Measure the outgoing live tree and its contents' pool membership under the lock. Include the exchange interval, verification failure and reverse exchange in the model. An insufficient physical, inode or pool budget must stop admission. Keep restoration of the prior root available on failure.
2. Commit and review the successor together with the correct stager installer and exchange guard. The existing deployment-only reuse list excludes the sequence model. Closed input also binds installed helper bytes to the artifact commit. The normal workflow therefore requires a **new isolated Node build and release ID**. Record its actual commit, tree, build receipt, both archive digests and inventory after it exists. Do not precompute an approval against the old release ID. [Artifact binding](../deploy/publish/release.py)
3. Obtain explicit approval for the actual Git revision and destinations, Node build, and any guarded installation of the named UI helper digests. Use a creation-only installation journal, exact predecessor identities and a tested reverse path. Verify the protected live/rollback pair and package/retention authority before and after. Keep the installed 6 GiB scratch policy throughout. No limit reversal is needed with this design.
4. With authorization for that successor's private staging, run fresh closed preflight and the whole-release planner. Recheck the sealed plan and actual filesystem at dispatch. Receive only the two pinned archives and require both terminal private-stage receipts. Refuse reuse on a changed attempt, plan, state, inventory or helper. Preserve failed evidence for reconciliation.
5. A later application publication, production replay, 250k activation and any retention operation are separate decisions. A staging failure leaves live and rollback in place. If a helper install is interrupted, verify its exact journal, installed inode and protected state before a guarded rollback. After a public exchange the publisher's verified reverse-exchange path must work even when capacity is tight. Do not recover by deleting release assets.

For the proposed successor, the normal Git destination is `proofofworkme/ProofOfWork.Me` on `refs/heads/main`. The isolated builder is `pow-bitcoin-01` and the private receiver is `ubuntu-4gb-hel1-1`. Scope the future approval to the exact reviewed successor commit and tree, the isolated build, the guarded UI helper install and reversal, and private receipt of that build's source and surfaces archives. Record their real hashes after the build. Before selecting the new construction mode, require both planner and receiver to match the new release ID, attempt, archive and inventory digests, installed helper hashes, retained pair and config/state identities against a fresh sealed plan. A changed input requires a new plan. Completion or failure must never grant a different release a construction mode or a higher scratch ceiling.

## Verified outgoing-root census and capacity decision

On November 23 at 20:26:47 UTC, the outgoing live root occupied **286,646,272 bytes in 1,915 unique inodes** across 3,427 entries. Two independent metadata passes agreed. Live and rollback manifests, lifecycle config and completed pair/state matched the retained pins before and after. The newest live entry change time was November 18. No product files were opened for content. The deployment check would exclude writers while traversing, so this observation used no deployment lock. An initial probe stopped before scanning because it looked for the pair at the top of the state document. The corrected probe used the controller's established `completedContext.pair` field and the same hash pin.

At 20:27:53 UTC, two passes agreed on the three current pool totals. Scratch occupied 5,436,297,216 bytes. Root availability measured 16,184,459,264 bytes and 2,195,296 inodes. Replaying the committed planner and the offline direct-exchange model using those measurements and the retained artifact inputs gave the following results.

| Capacity decision | Projected occupancy or requirement | Remaining headroom |
|---|---:|---:|
| Direct construction at the highest scratch phase, source receipt | 6,382,579,712 bytes | 59,871,232 bytes |
| Scratch while the outgoing root occupies the exchanged path | 6,325,846,016 bytes | 116,604,928 bytes |
| Physical root after allowing the existing 8 GiB + 64 MiB floor | 1,373,889,577 additional bytes | 6,153,526,231 bytes |
| Inodes after the existing 128-inode reserve | 34,366 additional inodes | 2,160,802 inodes |
| Backup pool | 1,175,499,817 additional bytes | 6,718,520,279 bytes |
| Transport pool | 67,108,864 additional bytes | 6,708,367,360 bytes |

The exchange fixture passed four tests, including exact thresholds and one-unit refusals across all five budgets, both exchange directions and interrupted evidence retention. The reported peak uses conservative inputs and charges no future retirement or shared-inode savings. Capacity fits for the proposed constructor at the observed occupancy and retained artifact sizes. Completion of a production constructor, guarded installation/reversal and a fresh plan for the actual successor remain necessary.

The ordinary ace27010 plan still projects 6,700,826,624 bytes and refuses before upload by 258,375,680 bytes. The Boost 5.5-to-6 GiB migration bound two exact helper hashes and its original lifecycle state. Its rollback restores 5.5 GiB and rechecks occupancy. The ace27010 planner requires the native setting to equal its compiled 6 GiB. Each phase obtains its own deployment lock, leaving no supported exclusive temporary grant across this release. A different native limit and planner would require a reviewed successor build. Owner approval to exceed the ceiling does not supply executable tooling for that change. [Boost approval](2026-11-18-ui-scratch-capacity-approval.json) · [Installer](../deploy/ui-scratch-capacity/successor_installer.py) · [Local review manifest and census](2026-11-23-amo-copy-avoidance-review.json)
