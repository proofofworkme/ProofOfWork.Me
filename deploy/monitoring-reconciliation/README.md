# Monitoring reconciliation, 2026-10-24

The operator approved reconciling outdated monitoring warnings after removing
local backup copies and selecting the newest complete VPS logical backup. This
change does not delete runtime, backup, replay, or evidence data. It does not
change disk, latency, or error thresholds.

`retention.py` preserves and executes the prior installed retention checker.
Only 18 exact node paths and 11 exact UI paths, already missing before this
change, have their historical presence requirement retired. The original
held-review inventory remains unchanged and hash-bound. Their original deletion
time and cause are unknown; qualification does not certify a historical restore
or claim that this reconciliation deleted them. Reappearance, any new missing
path, changed historical evidence, changed prior checker, changed policy,
relocation failure, unsafe metadata, backup failure, or an unrecognized result
schema still fails monitoring. All other issues remain visible.

`install.py` takes the existing role-specific deploy lock and refuses expanded
scope. It validates the old checker hash, evaluates the candidate, installs it
atomically, then checks the existing systemd service context; a verification
failure restores the previous checker. Tiny rollback/config records stay on the
VPS at `/var/lib/proofofwork-monitoring-reconciliation/20261024`. This directory
is deliberately outside `/etc/proofofwork-retention`, whose complete inventory
is itself protected by UI lifecycle custody. Nothing is downloaded or backed up
to the operator machine.

For node source acceptance, the installer binds exactly 13 runtime paths to the
already completed WORK-tips `35a93f60e595` and notifications `49ce8edc9747`
manifest/receipt pairs. It never rewrites runtime source. The existing source
verifier must accept the entire candidate (base Git tree, exact overlay inventory,
source bytes/modes, and retained receipts) before publication. The complete node
release-health service separately retains archive and dependency checks.
`deploy/node-overlay-source-health.py` now reproduces the already-installed
verifier's duplicate-JSON, DEL-character, and final-mode-fence hardening.

The source installer receives JSON on stdin with `retentionSource` (base64 bytes
of `retention.py`) and, for `--role node --sources`, `sourceVerifierSha256` (hash of
the installed reviewed `deploy/node-overlay-source-health.py`). Run with isolated
Python as root on the intended VPS. It is intentionally a one-time controller:
a pre-existing completion directory requires inspection, not an automatic rerun.
The only checker-source substitution is `EXPECTED_POLICY_SHA256 = None` to the
exact generated policy SHA. Do not execute the unbound template as a live check.

## Retention read integrity and scoped update, 2026-10-25

The Linux root checker opens protected inputs with `O_NOATIME`, alongside
`O_NOFOLLOW` and `O_NONBLOCK`, so its own read cannot advance an aged access time
and fail the full before/open/read/after stat fence. All existing byte, inode,
owner, mode, link, metadata and policy checks remain. Failure to open with these
flags is a refusal; there is no fallback that drops access-time integrity.

[`update_retention.py`](update_retention.py) updates only
`/usr/local/sbin/proofofwork-retention-protection` on the selected node or UI VPS.
The reviewed plan binds the role, source repository, final commit and tree,
installed predecessor/candidate hashes, exact input identities and the loaded
service/timer context. Nanosecond identity fields must remain exact JSON
integers; seal the plan with Python, without a floating-point JSON round trip.
The committed canonical change must be exactly the one `O_NOATIME` insertion;
the sole installation substitution binds the existing policy SHA-256.

The node plan's B3 receipt at
`/data/proofofwork-release-backups/runtime-latest-bca2efcbdb20-20261025T162006Z/completion.json`
remains immutable historical incident evidence, not a current-archive gate.
Before rollout, separately verify the latest final runtime archive and its
coverage of the accepted runtime. Install the checker only after the joint
release's UI lifecycle and final release synchronization are complete.

After source review and commit, place the sealed plan at the exact path below,
then run the committed helper as isolated root Python on the intended VPS.
`REVIEWED_PLAN_SHA256` and `ATTEMPT_UTC` must be the reviewed plan hash and a unique
`YYYYMMDDTHHMMSSZ` attempt label. The role is in the plan, with a closed node/UI
input scope; there is no additional role override.

```sh
sudo /usr/bin/python3 -I -B deploy/monitoring-reconciliation/update_retention.py \
  --plan /tmp/proofofwork-retention-atime-20261025/update-plan.json \
  --plan-sha256 "$REVIEWED_PLAN_SHA256" --attempt "$ATTEMPT_UTC"
```

Under the existing role-specific operations lock, the helper records intent and
the tiny predecessor in
`/var/lib/proofofwork-monitoring-reconciliation/20261025-atime/attempt-<UTC>/`.
It executes the exact candidate bytes in memory, requires a successful role-bound
result, and repeats the input/configuration fences before atomic replacement.
It preserves the installed owner and mode, then requires a fresh successful
invocation of the existing oneshot service and its exact-role JSON result. A
qualifying timer invocation is reused; otherwise the helper starts that service
once. Changed configuration, stale invocation evidence or a real checker issue
cannot certify the update.

A failed installation restores the predecessor only while the replacement still
belongs to that attempt; a foreign replacement is preserved and recovery remains
incomplete. The durable result records verification and rollback. Any prior
attempt requires evidence review rather than automatic retry. Completion requires
that successful result, including actual service verification.

Historical policy, held-review evidence, retention masks, service/timer settings,
archive contents and deletion scope remain unchanged. No archive is created or
removed, and no payload or backup is copied to the operator machine. Validate the
reader regression and the updater's synthetic path/service fixtures with:

```sh
sudo /usr/bin/python3 -I -B deploy/monitoring-reconciliation/check.test.py
sudo /usr/bin/python3 -I -B deploy/monitoring-reconciliation/update_retention.test.py
```

Validation:

```sh
python3 deploy/monitoring-reconciliation/check.test.py
python3 scripts/check-node-overlay-source-health.py
```

Completion records (UTC):

- UI `retention-completion.json`, 2026-10-24 14:58:53: service succeeded; original
  295 held rows retained, 13 total qualified retirements (11 added), 282 paths
  still required, including two proven relocations. Policy SHA-256
  `2c9592f15ae4d5ad8da01fc22028b7a3ad713f46b5408e2e9296c524917337c6`.
- Node `source-completion.json`, 14:59:42: all 48 source overlays verified;
  acceptance SHA-256
  `a033115e53f1cfe08868fced3cae6dd609e6bc44a4a8037fa8a2bbeccb950fe6`.
- Node `retention-completion.json`, 14:59:43: service succeeded; original 521 held
  rows retained, 22 total qualified retirements (18 added), 499 paths still
  required. Latest-only logical backup check remained healthy with one set.
  Policy SHA-256
  `f972d08d3b0bf3beeabf418510650150a2a6717ed1ab92d81bf7ec1477a3134a`.

Existing storage warnings remain actionable reviews. At 14:45 UTC `/data` was
81% used with about 321 GiB available, above the percentage warning threshold
but above the absolute reserve. The latest trend observation had healthy
capacity forecasts and separate allocation reviews for approximately 10.36 GB
release evidence, 89.53 GB INCB replay, and 140.75 GB ID-seal replay. This change
neither approves deleting these datasets nor suppresses their warnings.

The full node release-health check at 15:00:34 UTC still failed its independent
archive coverage requirement: all nine managed archives verified and dependency
custody passed, but none described the complete current runtime. The newest
same-base accepted-overlay archive is
`proofofwork-node-release-92eb5fbdaacf-accepted-overlays-20261022T175657Z.tgz`,
which predates WORK-tips and notifications. Its runtime digest begins `e50c3c`;
the current measurement began `91f721`. The current-archive count was zero.
This real gap remains visible; source-only acceptance is not an archive
certificate. No new runtime archive or replacement provenance was fabricated.

## Authorized VPS-only archive refresh

The operator subsequently authorized closing that gap with one newest runtime
archive on the VPS, after the approved two-file API rollout. The scoped
`runtime_archive.py` controller accepts that completed API-latency release's exact
`server/proof-api.mjs` and `server/db/proof-index-reader.mjs` receipt. It also
recognizes the separate `proof-of-work-amo-browse-scoped-runtime-v1` receipt for
exactly `server/proof-api.mjs` and the new `server/amo-browse-snapshot.mjs` helper.
The AMO receipt must prove the helper was absent before installation and is not
replacing any accepted overlay; the existing reader and every other accepted
source remain unchanged. Receipt family, complete source set and before/after
hashes must agree. It verifies source acceptance and dependency custody, then
reuses the hash-bound Oct22
archive/runtime model under the existing operations lock. A new archive must
match the complete current runtime and pass full release-health before any
retirement. This proves archive contents and provenance, not an independent
application restore or database restore.

The first migration retires only the nine exact superseded ordinary managed
runtime archives enumerated in the controller. Subsequent releases replace only
the single archive bound by an explicit prior completion path and SHA-256,
using `--previous-completion` and `--previous-completion-sha256`. That receipt's
archive identity, size, checksum, provenance and exact one-archive inventory
must still match. The immutable held-review inventory and current
accepted-evidence paths are exclusion gates. Each old archive, checksum,
provenance, metadata identity, and known Oct22 custody hardlink is checked before
unlinking. Compact historical provenance and exact retirement identities stay in
`/data/proofofwork-release-backups/runtime-latest-<commit>-<time>/retirement-plan.json`.
The new archive has one managed path; raw archive bytes never reach the local
machine. Historical protocol activation JSON, replay datasets, live runtime,
rollback directories, scoped release receipts, and daily DB backups remain
outside this controller's deletion scope. Failure before retirement leaves the
old archives available; the plan records intent before any unlink.

Run the reviewed script using isolated root Python on the node VPS with
`--receipt-dir`, `--manifest-sha256`, `--source-commit`, and
`--create-and-retain-latest`. The archive inventory and receipt scope are exact;
unknown archives or expanded source scope require review. There is no wildcard
prune or removal of retention masks. Its checks are:

```sh
python3 deploy/monitoring-reconciliation/runtime_archive.test.py
```

## Summary monitor derived snapshot comparison

The summary monitor compares the source checkpoint separately from the response
snapshot ID. Marketplace enrichment may produce a different response ID with an
explicit top-level `derivedFromSnapshotId`. The monitor accepts that direct link
only when the other route is its source, both routes have valid matching network,
height, block hash and `indexedAt`, and the link is neither empty nor self-referential.
Different children, indirect links and conflicting lineage remain failures.
Equal IDs also cannot hide differing checkpoint metadata. HTTP errors, lag,
canonical V8 evidence and latency remain independent gates.

The scoped installation target is only
`/usr/local/sbin/proofofwork-summary-route-health`. The separately stored
`/opt/proofofwork-api/scripts/check-summary-route-readiness.mjs` is inside the
managed runtime and is not changed by this monitor installation. Therefore this
scope requires neither a runtime overlay acceptance change nor another runtime
archive. The service and timer are also unchanged.

After the source is committed and reviewed, use the clean committed node-side
release checkout to supply `scripts/check-summary-route-readiness.mjs`. Bind its
commit and SHA-256 and, under `/run/proofofwork-audit29-ops.lock`, recheck the
installed regular file's root ownership, mode `0755`, single link and old SHA-256
`149c74a1c53d63cd41b6c0d39ea8461cbb64749226b996de9a60924e4f56010a`.
Also pin the service SHA-256
`7e2c3662dd7318b7101c683048370fcf2c0ebc53350b0f1af43d2dfda710ce0c`
and timer SHA-256
`1720b87f4d2a64772234ed66a9e28c9b0ab0bab1d089eb34becbefc0e25dbf23`.
Unexpected bytes or metadata require another review.

Check candidate syntax, preserve the small predecessor script on the VPS with
the scoped receipt, atomically install the exact candidate with the existing
metadata, and verify the installed hash. Record the commit, before/after hashes,
unit hashes and verification result in a hash-bound receipt under
`/var/lib/proofofwork-monitoring-reconciliation/20261024/`. Roll back the exact
predecessor if installation or byte verification fails. Run the existing service
once and report its actual correctness and latency findings; a genuine alert
must not be converted into success. No API restart or local backup is involved.

```sh
node --test scripts/check-summary-route-latency.test.mjs
node --check scripts/check-summary-route-readiness.mjs
```
