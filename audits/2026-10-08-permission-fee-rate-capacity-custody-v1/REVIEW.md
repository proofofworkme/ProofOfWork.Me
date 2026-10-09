# Permission fee-rate release: exact historical custody proposal

**Status: awaiting exact human authorization.** No archive payload has been transferred, no restore test has run, no production removal dry run has passed, and no historical data has been removed. This is a conditional preparation/removal proposal; `preparation-proposal-v1.json` is deliberately a different format from the executable removal manifest and is rejected by the removal controller.

## Exact proposed paths and destination

- `/var/backups/proofofwork-ui/transport-evidence/ed838d5c8691-20261001T210406Z`: 221,405,184 allocated bytes, 822 entries.
- `/var/backups/proofofwork-ui/transport-evidence/d4d888757a1c-20261002T013828Z`: 221,601,792 allocated bytes, 822 entries.

The proposed off-host archive is `/home/sixer/ProofOfWork.Me/audits/2026-10-08-permission-fee-rate-capacity-custody-v1/historical-ui-inputs.tgz`, inside this private local directory (0700). New evidence files are 0600. Both histories remain preserved locally after any approved removal. The earlier four-directory and `7bad…` approvals do not apply to these paths.

## Completed read-only checks

The fresh metadata census found exactly 1,644 entries: 1,570 regular files and 74 directories. Combined unique `(device,inode)` allocation is **443,006,976 bytes**, equal to the summed allocation; every regular file has one link. There are no symlinks, special files, external hardlinks or selected submounts. A fresh scan of processes and 45 configuration files found no references to the selected paths. Filename/type evidence consists of compiled `surfaces`, `archive-base` and two `incoming-receipt.json` files. No file payload contents were exported or executed; filename evidence alone does not prove payloads contain no sensitive data.

Exact full metadata/content-hash census: `1079baee64c795e4de236270445a90dd77db4182b503ef7edda7eb289181f37c`. `capture-readonly-v3.py` requires that census before invoking tar, so drift is refused before export.

Fresh protected probes passed: live source `06a2baf…`, all **seven** rollback roots, **11** helpers including verified retention, Caddy hash `9c12f0da…`, the exact audit28 hold, masked/inactive prune timers, active provenance timer and Caddy. Exact current live06a/b40 transport trees, b40 staged candidate, both source/stage evidence directories, b40 managed archive/checksum and stopped transport units are separately pinned. These paths, node/runtime files, wallets, ledgers, other release archives and retention settings are outside removal scope. Existing failed source evidence is retained.

## Capacity forecast

Fresh observed free space: 10,967,445,504 bytes. The largest retained/live native archive extraction requires 11,260,141,568 bytes with the unchanged 10 GiB root floor and 64 MiB growth reserve. Adding 8 MiB publication evidence, a 1 MiB sidecar/exchange envelope and an extra 64 MiB operational buffer gives a reclamation target of 369,242,112 bytes. The exact pair forecasts **73,764,864 bytes** above that buffered target. This forecast is evidence for selection; all native gates must pass again against fresh disk measurements before publication.

## Pending authorized sequence

1. Human authorizes exporting these two exact reviewed payloads to this exact private local destination, and conditional removal only after all following checks pass.
2. Stream through the pinned read-only capture; verify every archive member, content hash, numeric root owner/mode, nanosecond time and link relationship; perform a local restore test including xattrs/ACLs. The local restore uses the calling user's ownership; original root ownership is verified in the archive, and no production restore is authorized.
3. Create the exact closed removal manifest with verified custody and pinned protected baseline; obtain independent review. Run `production-readonly-dryrun-v1.py` against it: no deletion functions, execution argument, remote receipt files or remote writes.
4. Only if all checks pass unchanged, the separately reviewed inode-fenced proposal may remove these two exact trees using its exact manifest hash. Any mismatch, source mutation, external link, reference, missing proof or failed capacity check stops the sequence; no broad cleanup/retry is authorized.
5. Repeat native release gates and continue the unchanged publisher using the existing clean preserved source and an unused publication namespace. Autonomous signing remains closed; no wallet operations are included.

The prepared offline checks passed **28/28**: 22 scope/identity/protected-state/controller tests and six archive metadata/member refusal tests. Results and final source hashes are recorded in `offline-test-results-v1.json` and `preparation-proposal-v1.json`.

## Why authorization is required

Automatic approval review rejected the attempted archive transfer: the full contents of the two newly selected production directories might be sensitive, and exact payload export to this destination lacked explicit human authorization. No transfer or removal ran. We did not retry or bypass that rejection. [AGENTS.md](../../AGENTS.md) also requires separate approval for this new historical-storage scope. Archive/restore/production dry-run fields remain explicitly false until verified evidence exists.
