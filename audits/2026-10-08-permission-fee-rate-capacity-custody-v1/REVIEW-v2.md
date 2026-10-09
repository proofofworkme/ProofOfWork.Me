# Exact conditional custody/removal proposal, final packet v2

**Awaiting explicit human authorization.** No payload archive has been transferred, no restore attestation exists, no executable removal manifest exists, no real production removal dry run has passed, and no removal has run. The automatic approval rejection remains unresolved. All corresponding fields in `preparation-proposal-v2.json` are explicitly false.

This packet extends the immutable [original review](REVIEW.md) with a gated dispatcher. The original v1 proposal, review, README and all nine frozen sources remain unchanged. Final source hashes and 39 passing offline refusal tests are bound in [preparation-proposal-v2.json](preparation-proposal-v2.json). The preparation proposal's format is deliberately rejected by the destructive controller.

## Exact proposed scope

Export only these reviewed historical trees through read-only SSH into the private local archive, verify/restore them locally, run the real production read-only dry run, and conditionally remove only these trees if all proofs and unchanged protected pins pass:

- `/var/backups/proofofwork-ui/transport-evidence/ed838d5c8691-20261001T210406Z` — 221,405,184 allocated bytes.
- `/var/backups/proofofwork-ui/transport-evidence/d4d888757a1c-20261002T013828Z` — 221,601,792 allocated bytes.

Exact archive destination: `/home/sixer/ProofOfWork.Me/audits/2026-10-08-permission-fee-rate-capacity-custody-v1/historical-ui-inputs.tgz`, inside this 0700 local directory, with 0600 evidence files. Combined unique allocation is **443,006,976 bytes** across 1,644 entries (1,570 regular files, 74 directories); every regular file has one link. Exact reviewed census: `1079baee64c795e4de236270445a90dd77db4182b503ef7edda7eb289181f37c`. No selected mounts, external links, symlinks, special files or process/config references were found. The source is fixed to that census before export.

The fresh capacity forecast leaves 73,764,864 bytes above the largest native extraction requirement plus publication/sidecar space and an extra 64 MiB operational buffer. Native 10 GiB/64 MiB floors, scratch cap, retention and all other limits stay unchanged; fresh native gates still have to pass. Live source06a, seven rollback roots, eleven helpers, Caddy/hold/timer states, both current transport pools, b40 stage/archive/checksum, and original source/stage evidence remain protected and outside removal scope. Wallets, ledgers, node/runtime overlays and other release archives are outside this operation. Signing stays closed.

## Final execution gate

Final sources are `capture-readonly-v3.py`, `custody-capture-and-verify-v2.py`, `production-readonly-dryrun-v2.py`, `removal-controller-proposal-v1.py` and `dispatch-verified-custody-v1.py`.

The custody runner must produce a real verified archive, local restore, custody file and creation-only `restore-verification-v1.json`. Original numeric root ownership is verified in archive headers; local restoration uses the calling user. No production restoration is authorized.

The dispatcher requires the actual exact manifest/custody files, matching archive SHA and membership, and actual restore attestation, then independently verifies the archive and restored tree again. It cannot use metadata eligibility or a synthetic probe as custody. It dispatches only a real read-only production check by default and records creation-only stdout/error/proof files. The receipt must bind the exact manifest, custody, archive, source census, both controller hashes and unchanged protected baseline, with `removed=false`, `remoteWrites=false` and zero progress.

Execution additionally requires the literal matching `--execute-approved` manifest SHA after explicit human authorization. It demands the previous real successful read-only receipt, repeats a fresh real read-only check, rereads and verifies every local proof again, and only then may dispatch the exact inode-fenced two-tree controller. The controller repeats fresh source/protected/dependency checks under the deploy lock. Receipt directories are creation-only and no occupied namespace is reused. Missing/failed/mismatched proof, drift, reference, hardlink, scratch or capacity failure stops the operation without cleanup/retry. An absent actual manifest/custody/dry-run currently aborts before SSH and before local writes; meaningful offline tests verify those refusals.

After any conditionally approved removal, repeat all native capacity/preflight/provenance guards and continue the unchanged publisher without replaying the occupied source receiver or deleting the failed fee-a1 evidence. Release completion still requires synchronized production source and release-sync verification.

## Unresolved approval blocker

Automatic approval review rejected the full archive transfer because these newly selected production directories could contain sensitive data and exact payload export to this new local destination lacked explicit human authorization. No transfer or removal ran; we have not retried or bypassed that rejection. Filename/type/hash evidence indicates compiled UI transport content but does not prove payloads contain no sensitive data. Explicit human approval must identify both exact trees, the exact private local destination, and conditional removal only after verified custody/restore, independent review and the real production read-only dry run. [AGENTS.md](../../AGENTS.md) separately requires approval for this new historical-storage scope.
