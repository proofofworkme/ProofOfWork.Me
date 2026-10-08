# Pages: approved five-root storage operation

This is the separately approved exact storage proposal, not an ordinary retention
policy or a new exception to the Audit28 hold. Direct approval was received as
“Approve this exact plan” at `2026-10-08T02:59:48.755147+00:00`.

The original proposal bytes are SHA-256
`b7ec857468f3c425fa9bed1f366bf2313536913e3d62b18a8246ccd29f68f591`.
The direct human approval bytes are SHA-256
`4971f117af5947b69014583a1c3194b25d27147dfaa5f1b3defd40c64ba11385`.
Both are immutable pins in `ui-storage-export.py`; a reformatted or substituted
JSON object refuses even when its decoded content appears equivalent.

## Exact scope and protected recovery

Only these five complete directories under
`/var/backups/proofofwork-ui/rollback-roots/` may be exported, independently
restored off host, and then retired from that parent:

| Directory | Uniquely allocated file and directory blocks |
| --- | ---: |
| `proofofwork-www-pre-01ec4968caa9-20261007T150110Z` | 245,227,520 bytes |
| `proofofwork-www-pre-13ddf6d7f401-20261007T030045Z` | 242,954,240 bytes |
| `proofofwork-www-pre-19cc93a7c97f-20261007T161406Z` | 247,189,504 bytes |
| `proofofwork-www-pre-471a30c41991-20261004T122500Z` | 241,381,376 bytes |
| `proofofwork-www-pre-7bad9495d118-20261006T180919Z` | 242,610,176 bytes |

The locked proposal census closes 3,883 regular inode groups entirely inside
these roots, with no external or cross-root file hardlinks. Allocated blocks total
`1,219,362,816` bytes; logical file sizes total `2,355,771,891` bytes. Neither
logical size nor this block estimate is a guaranteed future `statvfs` delta.
New receipts and concurrent background writes are separately reported.

At the approved census, `/var/www` identifies release
`fc396c9a9abd1cdb1081b0b3585f1d02f3289a1d`. This operation preserves that live
root until normal release publication. Immediate prior directory
`proofofwork-www-pre-fc396c9a9abd-20261007T233244Z` stays on the UI server.
All sealed archives and sidecars, source trees, transport/recovery/audit evidence,
existing cleanup receipts, hold bytes and timer masks remain on the server.
The installed 10 GiB root reserve, 64 MiB growth reserve, 5 GiB deployment scratch
ceiling and inode guards are unchanged. Clearing the five roots addresses root
capacity; the supported current-release staging continuation still handles any
independent scratch admission refusal.

## Read-only export and independent restoration

The durable off-host destination is a fresh directory on the operator's computer:

```sh
evidence=/home/sixer/ProofOfWork.Me.local-before-main-sync-20261008T022312Z/pages-release-evidence-11c0dd7
custody=/home/sixer/ProofOfWork.Me.local-before-main-sync-20261008T022312Z/pages-ui-rollback-custody-b7ec8574
python3 -I -B deploy/pages/ui-storage-export.py export \
  --proposal "$evidence/storage-proposal.json" \
  --approval "$evidence/storage-human-approval.json" --output "$custody"
unshare --user --map-root-user python3 -I -B deploy/pages/ui-storage-export.py \
  verify --custody "$custody"
```

Export streams one root at a time over the fixed SSH identity/verified host key.
It takes the existing UI deploy lock, reads with `O_NOATIME`, verifies complete
selected/live/prior roots against the original proposal, and fences helpers,
hold identities, timer unit states and mounts before and after streaming. It
allocates no archive on the UI server. Local archives, stderr, original proposal,
approval, exact exporter source and checksum receipts are exclusive-create.
Failed partial streams remain evidence; the exporter never silently resumes or
overwrites a destination.

The frozen exporter source used for these exports is SHA-256
`098924a20c920c26167cc30b7f961496f86a7da4a9c7209c834b31bfbc1955c3`.
Verification independently extracts all five archives into fresh directories.
It compares every byte, file/directory type, mode, numeric owner, nanosecond
atime/mtime, xattr and internal hardlink group, including passthrough assets and
the root release manifest. Unexpected, duplicated, escaping, linked/special,
truncated or incomplete members refuse. Extraction never touches the live site.

All original production owners are UID/GID 0. The isolated local user namespace
maps host UID/GID 1000 to namespace 0, so numeric owner restoration is checked
without local sudo or changing the host user. Custody records the actual UID/GID
maps and this qualification. A future restoration by production root uses the
original archive UID/GID 0. New inode IDs and ctime are unavoidable on extraction;
the complete original IDs/ctime remain in the proposal and PAX evidence.

## Prepare, review and retire

After complete independent verification, prepare a fresh source-bound request:

```sh
unshare --user --map-root-user python3 -I -B deploy/pages/ui-storage.py prepare \
  --custody "$custody" --output /tmp/pages-five-roots-retire-b7ec8574.json
```

Preparation rehashes every archive and all custody/index/recipe/exporter bytes,
and rechecks the actual restored trees. It fsyncs archive/restored data and
metadata, the custody directories, and the durable outer parent before creating
the request. The request binds exact proposal/approval/custody bytes and both
exporter/writer source hashes. Inspect its reported SHA and source pins and the
five exact exports/restoration receipts before the explicit mutation phase:

```sh
unshare --user --map-root-user python3 -I -B deploy/pages/ui-storage.py apply \
  --request /tmp/pages-five-roots-retire-b7ec8574.json \
  --log "$custody/retirement-dispatch.json"
```

The initial dispatcher attempt on 2026-10-08 refused SSH host-key lookup before
connecting because its isolated UID 0 selected a different home directory. Keep
the original request and `retirement-dispatch.json`; verify that the managed unit
and retirement intent are absent and the original root fingerprints unchanged.
The corrected source-bound request and log must use fresh creation-only paths,
such as `/tmp/pages-five-roots-retire-b7ec8574-knownhosts.json` and
`retirement-dispatch-knownhosts.json`. Never overwrite or silently retry the
original attempt.

Apply repeats off-host custody verification before dispatch. SSH explicitly uses
`/home/sixer/.ssh/known_hosts`, the original operator trust store, while retaining
strict host-key checking and the fixed deployment identity. This keeps the same
verified host key when the local user namespace has UID 0. The remote managed
unit uses a 30-minute maximum, 50% CPU, 1 GiB memory without swap, 64 tasks,
private umask and idle I/O. The production writer accepts no test layout or guard
override. It verifies the exact approved deploy-lock inode against both pathname
and held descriptor before the intent and each whole-root guard. Existing
operation namespaces are checked again while holding the lock; any prior intent
requires explicit reconciliation rather than an automatic second attempt.

Before the intent and each root, the writer rechecks all remaining selected
root bytes/metadata, live/immediate prior fingerprints, helper identities, hold
bytes and timer states. Bounded process scans cover cwd/root/exe, open/deleted
FDs, maps and command lines, plus every readable process mount namespace's source
root and mount target. Configured operator/unit/cron roots and all loaded native
or transient systemd FragmentPath/DropInPaths are checked. Exact `/dev/null`
mask targets are qualified as their root-owned character device; secret files,
unreadable sources and exceeded bounds refuse instead of weakening the fence.

Capacity admission charges 32 MiB/128 inodes for durable operation evidence and
rechecks the unchanged scratch ceiling. The evidence namespace is under
`/var/backups/proofofwork-ui/cleanup-evidence/pages-five-roots-b7ec8574-ATTEMPT/`.
Its outer parent is fsynced before destructive work. Original proposal, approval,
custody, approved intent and an exclusive append-only action journal remain
durable. The journal's own directory entry is fsynced before its first action;
each action intent/result and parent unlink/rmdir are fsynced.

Removal is descriptor-relative and limited to the exact inventoried members.
Every opened ancestor's current parent entry must still match its held descriptor;
moving or replacing even a nested directory refuses before the next unlink.
File content/xattrs and full identities are checked immediately before removal.
Only observed changes produced by this writer's own unlink/rmdir advance tracked
link counts and ctime/directory metadata. External hardlinks refuse.

Partial, failed, signaled and completed receipts preserve progress. A failed or
timed-out run requires inspection of the managed unit, journal and actual roots;
missing paths never imply success, and there is no generic retry. Completed
receipts report before/after available bytes/inodes and qualified measured
deltas. Obtain a fresh normal release preflight and plan only after the five-root
operation and protected recovery pair are verified complete.

## Recovery and fixtures

Keep the custody directory and its restoration recipe durably. To rehearse or
recover archived historical roots into a fresh parent on a root executor:

```sh
python3 -I -B "$custody/exporter.py" restore --custody "$custody" \
  --output /fresh/recovery-parent
```

This recreates the five complete historical directories with independent
metadata/content verification. It does not publish them or overwrite a serving
root. Any production recovery/publication is a separate concrete action with
fresh verification; never infer that an interrupted retirement can resume.

Portable fixtures use real temporary files, xattrs, hardlinks, archives,
descriptor deletion and source/lock/ancestor replacement races:

```sh
python3 -I -B deploy/pages/check-ui-storage.test.py
unshare --user --map-root-user python3 -I -B deploy/pages/check-ui-storage.test.py
```
