# Audit32 partial recovery continuation — incomplete

The approved conditional retirement stopped after **1,407 completed file unlinks and no directory removals**. Exact journal replay confirms 2,814 matched prepare/completed records. The subsequent read-only reconciliation passed: all **7,946 remaining regular-file paths plus 304 directories, or 8,250 entries**, matched the authenticated survivor scope. It also verified the five protected complete rollback roots and the current live tree against their native fingerprints. No partial retirement resume, new UI deployment, or release announcement has occurred.

Production UI remains on `c7935dde7239836f89be27c1ee29dfbc6a585e78`; GitHub main, the clean primary checkout, and the restored local preview use `1a7aebed17db8374b02a1b38b3470d1c26f83df0`, tree `5c925c73656f0490f0c6c5682e3e3a6661122027`. The actual `npm run check:release-sync` failed because production differs. **The release is incomplete.**

The earlier native publication refused because four retained historical rollback manifests still required archives that had been retired locally into verified offhost custody. That missed local dependency is corrected and preserved in the previous refusal evidence. The separately approved four-root recovery was the response to that dependency; the archive bytes and their custody proof remained valid.

Audit date: 2026-10-09 UTC. Scope: a dated, immutable continuation of the original Audit32 and its performance, execution, capacity, refusal, custody, and blocked-state evidence. This continuation records the actual partial retirement and subsequent read-only verification. The tracked original Audit32 Markdown, approved four-root manifest, historical evidence, and prior prepared records remain byte-for-byte unchanged. This record grants no execution authority.

## Completed private custody

Complete private offhost custody was verified before retirement. Actual export 5, fresh full restoration V7, and independent verification V7 all completed with exit 0, returned receipt pins, and durable readback. The proof covers all four complete original roots, exact bytes, modes, integer nanosecond times, empty xattrs, cross-root hardlink topology, and 88 managed surfaces.

The container is 1,025,576,960 bytes, SHA256 `4ba49dc25b84bd079b8c723c1265547837c46b03fbe8fa3b9be5ed1b42e97b2a`. The local restored owner is UID/GID 1000; original UID/GID 0 is authenticated through the bound source metadata. Original inode/device/ctime/atime and an actual root-owned native restoration are not claimed. The complete custody, successful receipts, failed transfer attempts, earlier partial restoration, and failed verifier receipts remain preserved. Raw original content and metadata stay private.

## Partial retirement and current-state verification

- Exact semantic replay against the frozen original inventory confirms the ordered prefix of 1,407 file unlinks, no unmatched prepare record, and no directory removal. The journal is 1,017,008 bytes, SHA256 `eead930154e33ad6ef1554227305d1f03f95c7e957b95e72c66369c088940c51`. Original failure, intent, and journal bytes were captured offhost with exact hashes, mode 0400, and file/parent fsync.
- The actual source-bound read-only collector completed with exit 0 and observed the state at 2026-10-09T23:02:33Z. All 1,407 completed paths were absent. The remaining 8,250 entries passed full file-byte, original metadata, directory-membership, empty-xattr, and dynamic hardlink nlink/ctime checks. Forty-six immediate containing directories have freshly evolved size/allocation/mtime/ctime after the unlinks; their other original identity fields and membership remain required, and the fresh values were closing-fenced.
- All nine historical root names remain, but names do not prove intact contents. The first selected root contains 1,073 remaining entries and no active manifest. All four selected roots remain authenticated tail-recovery scope and are excluded from the five protected complete rollback roots. This is not nine healthy rollback trees.
- The protected five and current live full native fingerprints, original archive/checksum/provenance dependencies, policies, helper pins, detached clean source, managed candidate archive, candidate passthrough, and original phase records passed. Native fingerprint proof covers full file bytes, names, type, mode, and owner. Original per-entry inode/nlink/mtime/ctime/xattrs were unavailable for that protected history; historical equality for those fields is not claimed.
- The fresh protected metadata snapshot contains 202,729 rows. Its uncompressed canonical JSON is 112,143,002 bytes, SHA256 `9396eda4e239412230e6628542b6f7705e9689db5e47638c71b94160df77af82`. This snapshot is new evidence for future verification, not proof of equality to an unavailable old metadata census.
- Opening/closing process, FD, maps, mount, and bounded configuration coverage were qualified in the private read-only evidence, with the original deploy lock and snapshot fenced. The mount namespace captured by the retirement refusal was absent later. Its later absence does not invalidate the original refusal or authorize a retry. Source line 406 repeats during retirement; its location before the first prepare in the source did not establish zero operations.
- The attempted immediate after-refusal full qualification exited 255 when the SSH connection closed. It establishes no fingerprint result. Its failure remains separate from the later successful full read-only reconciliation.

The private actual reconciliation result is 17,373,446 bytes, SHA256 `83047959689283da120fd0519c1483e3ad628787cced51d0533e59c0797877ff`; the source-bound successful execution receipt is 1,599 bytes, SHA256 `2cf8d631cec1043d7536b48522b66028a939190430b448d1301fe8e450864591`. The public projection includes qualified counts and hashes only. The full journal, original inventory, remaining inode/stat rows, compressed census, process/unit/configuration maps, raw service/node captures, and container bodies remain private pointers.

## Capacity and held-UI canonical results

At the read-only observation, the UI VPS had 11,862,667,264 available bytes and 2,186,912 available inodes. Scratch allocation was 2,869,129,216 bytes against the unchanged 5 GiB ceiling. These are observations, not publication capacity approval.

The remaining selected regular-file groups comprise 3,632 unique inodes and 866,992,128 bytes of conservative regular allocation; directory reclaim credit is zero. The original regular allocation minus that remaining allocation is 147,816,448 bytes with no surviving selected links. This is original-group allocation accounting, not an exact measured free-space gain: other host activity and metadata can affect available space. No cleanup gain or publication GO is claimed.

A fresh held-UI canonical sample reconciled full-node opening/closing height 970686 and block hash `00000000000000000001e9c50a9d05ebed49d3fc8eed69074f1b5f7efce3448d`. Known event identities and output accounting were canonical and unique; Code adds 0 economic proofs, Mail contributes 546 once, and the known contribution total is 546. All five public API probes returned 200, with observed request times from 0.422 to 3.068 seconds. This is a bounded known-transaction/sample check, not genesis replay, every protocol calculation, new UI rendering, or final release verification.

Mandatory local hygiene fix/check passed. Only inspected generated dist and empty Vite temporary output were removed. The same-source local preview was rebuilt and verified clean. Unrelated work, tracked history, accepted runtime overlays, and audit evidence were preserved. These local actions did not publish production. Actual release synchronization still refuses the source mismatch.

## Why the remaining action needs a new exact approval

The approved manifest is [the original four-root recovery proposal](/home/sixer/ProofOfWork.Me/audits/2026-10-09-audit32-four-rollback-roots-recovery-proposal.json), SHA256 `406e77bc5de8d2dc722a388f0821ff004c70516f67f4c8cfc1fc9cb52c223c04`. Its `conditionalRetirementRequirements[1]` states:

> Fresh continuous exclusive native deploy lock, stable root/file metadata+membership/content+xattrs and exact native-compatible fingerprints, no active unit/worktree/input/container/service/config/process/FD/map/mount reference; any uncertainty stops.

Its `publicationContinuationRequirements[3]` states:

> All canonical native archive/source/probe/retained-root/current-rollback/capacity/lock gates run normally. If any gate refuses, preserve new failure evidence and stop.

Those are the stop conditions of the exact approved operation. The original complete-root fingerprint gates no longer describe the four selected current copies after 1,407 unlinks. The newly authenticated remaining 8,250-entry state must be the basis of a concrete remaining-operations proposal and separate human approval. This continuation authorizes no automatic resume, restoration, further deletion, guard relaxation, retention-policy change, or installed-helper change.

The concrete next approval artifact is [the partial-tail recovery proposal](/home/sixer/ProofOfWork.Me/audits/2026-10-09-audit32-four-rollback-roots-partial-tail-recovery-proposal.json), 21,131 bytes, SHA256 `813eb6da87638b468809c90bcf95f616a4f178be5eeaae8005036e4de4cf282a`. It is independently reviewed, durably created, and awaits separate human approval. Its exact private deletion manifest is SHA256 `7ba51179bbde27ac28b74405d6d9b5a3413029810e8fee21fe505f438d3d97f8`. The new temporary tail controller, coordinator, evidence adapters, and meaningful refusal/interruption tests have not been implemented or executed; their source-bound tests and independent review are requirements before action. Passed read-only reconciliation and its tests do not substitute for those future checks.

## Required follow-up and release gates

Review the exact remaining scope and recovery choices against the complete original private custody and successful read-only proof, then obtain separate approval for the concrete proposal. Any approved continuation must retain fresh references, exact source/input/record/fingerprint pins, meaningful interruption/refusal tests, unchanged native storage reserves, complete operation journals, and independent post-action verification. The observation above does not replace fresh action-time admission.

Publishing the approved product still requires successful completion of the separately approved tail scope, a fresh five-root plan, successful unchanged native publication gates, a new rollback of old live c793, checks for all 22 managed archive/root artifacts and the 21 public HTTPS endpoints in the existing contract, affected UI/browser checks, fresh authoritative canonical reconciliation, accepted overlay provenance, and a successful `npm run check:release-sync`. Only after those gates pass may the single release announcement be published. The final release aggregator remains held.

The separately evidenced provenance timer opens/truncates/chmods the deploy lock before flock admission and caused prior export 1/2 strict lock-identity refusals. Preserve this as a future separately approved operational reliability issue. It authorizes no timer/helper changes now, does not explain export 3's owned stop or export 4's body deadline, and is not application field-performance evidence.

Earlier performance measurements and their 170-file frontend binding retain their original limits: isolated lab evidence, host-load variability, no field p75 pass or broad causal speed claim, and unresolved CLS/large-data observations. The interrupted storage recovery does not justify weakening canonical accounting, signing preflights, freshness, or those qualifications.
