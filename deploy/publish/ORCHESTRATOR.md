# Native publication phase journal

`orchestrator.py` is a preparation adapter, not a replacement release authority.
It executes exactly one named native `release.py` phase per invocation. It does
not transport archives, verify HTTPS, complete retention, qualify Pay, enable
writes, or claim release synchronization. No production run has been qualified.

## Explicit host boundaries

Each journal owns **one phase on one host**. The role is immutable in its
hash-pinned specification:

- `node`: `prepare-closed-input` or `make-plan` using the existing local CLI.
- `ui`: `preflight`, `upload-plan` or `publish`, using native `--ui-host`.

The native UI host guard still runs. There is no new SSH route, key forwarding,
archive transfer or fabricated completed predecessor phase. Prepare the closed
request on Node, explicitly transfer only the reviewed request and `.zlib`
inventory to UI, run UI preflight, transfer its receipt back to Node, make the
plan, then explicitly transfer the plan to UI. Each invocation has a different
private journal/specification. Cross-host transfers remain separate reviewed
operations; their exact received bytes must match the supplied pins.

The source checker requires a **full clean source checkout**, exact committed
tracked bytes and modes, and no unknown untracked entries. It intentionally does
not infer missing sparse paths. Ignored dependencies may remain under the
repository's own ignore rules. Do not copy archives to a laptop, relax this
source boundary, or copy a full checkout to evade a capacity ceiling. Before
live use, qualify that the full clean source already exists on the selected VPS
and that the native source/host/capacity gates accept it. No production run of
this new adapter has yet been qualified.

## Specification and invocation

Keep all plans, logs and journal directories on the VPS within its storage
policy and capacity limits. Native outputs require each private journal below
`/tmp` on that VPS; `/data` and other output namespaces are rejected before intent. The journal directory must be private, canonical
and owner-controlled. Ancestors must be root/current-user owned and not
group/world-writable, except the root-owned sticky `/tmp` and `/var/tmp`
namespaces. Symlink ancestors are refused. Pass the SHA-256 of the exact specification bytes:

```
python3 -I -B deploy/publish/orchestrator.py JOURNAL SPEC.json \
  --spec-sha256 EXACT_SHA256 preview
```

`preview` checks source/input identities, creates only the private journal and
lock if needed, and prints the exact native argv without creating an intent or
launching a native phase. `status` requires the journal to exist and checks the
same pins. Neither checks fresh production state or grants approval.

Specification keys (all required, no extras):

- `schema`: `proof-ui-phase-journal-v1`
- `repository`: canonical full clean checkout path on this host
- `commit`, `tree`: exact 40-character Git identities
- `role`, `phase`: one allowed pair above
- `inputs`: exact named `{path, bytes, sha256}` pins listed below
- `attempt`: native publication attempt identifier
- `privateStaging`: true only for private `prepare-closed-input`, false otherwise
- `existingInventory`: true only for the native preflight reuse option

Required inputs:

| Phase | Inputs |
| --- | --- |
| prepare-closed-input | buildReceipt |
| preflight | closedRequest, closedInventory |
| make-plan | buildReceipt, preflight |
| upload-plan | plan |
| publish | plan |

The imported closed inventory must be at the request path plus `.zlib`, and its
SHA must match the request. Source-bearing build/request/plan identities must
match this committed checkout. The unchanged native commands validate the
remaining predecessor semantics and current host state, including preflight's
own binding. Merely importing a pinned file never manufactures a completed
stage or a fresh qualification.

Run the explicit phase in place of `preview` to dispatch once. The plan always
selects existing `deploy-scratch-v1`. Build archive inventory and native capacity
checks remain mandatory. Log/output filenames are creation-only. Compressed
closed inventory is pinned with its request, not reconstructed.

Before explicitly dispatching `publish`, separately complete the supported
native surfaces/source transport and reconcile its terminal outcome. The native
publisher, not this journal, validates those protected receipts, the current
host, rollback pair, capacity and installed helpers. Upload never automatically
publishes. Never relabel a previous attempt or bypass fresh-namespace rules.

## Resume and uncertainty

An exclusive journal lock prevents two invocations sharing this directory.
An fsynced intent is written **before** launching the native child. On return,
source and inputs are verified again and exact outputs are pinned in a durable
result. A completed journal phase is not re-executed. `status` checks saved
bytes but explicitly does not establish fresh host state or qualify a release.
Every separately dispatched phase executes its unchanged native current-state guards.

A missing result after intent, nonzero exit, changed input, changed source or
changed output blocks this journal. Preserve it and reconcile the actual native
unit, lock, intent, receipts and live manifest. There is no reset, force, repair,
assume-success, delete or generic shell command. A separately reviewed native
reconciliation may require a new plan/attempt; this adapter does not authorize
one or turn cached evidence into current authority.

Publication must return exit zero **and** the final native `ok:true` record with
all prior roots preserved. The earlier publisher receipt is insufficient.
`retentionDeferred:true` and `frontendOnly:true` are mandatory. Current plus one
verified prior rollback remains the policy; the journal creates no new backup
and never authorizes deletion of an older generation. Retirement remains a
separate exact native action with action-time authorization where required.

## Operational boundaries

Use the established health monitor, limits and native timeout/recovery policy.
The adapter adds no outer kill timeout or signals and no resource relaxation.
On a publication health breach, do not blindly stop its supervisor or whole
unit: authenticate the actual phase/child and preserve native rollback.

No streaming shell is introduced. Existing native streaming must preserve both
sender and receiver statuses; if a session wrapper is needed, the separately
proved `setsid --wait` behavior applies. A zero receiver exit alone is not proof
that the producer sent the complete archive.

Pay qualification and its fresh native probe/enable must remain a separately
reviewed immediate composition, with actual artifact cwd for unchanged product
checks. This journal neither caches qualification nor bridges activation's
checkpoint freshness. Isolated verifier commits are not interchangeable with
released artifact identity or stock release-sync success.

Offline tests: `python3 -I -B deploy/publish/check-orchestrator.test.py`.
