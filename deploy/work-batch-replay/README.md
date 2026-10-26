# WORK batch bounded declaration replay

This controller repairs the exact declaration transaction
`b7c620e48c2d725a143cecd7f7808036d89907124d410ba57d272d34e650cc28`
at block 973103, transaction index 1621, after activation block 973104 was sealed
without batch context. It preserves the original transaction, its attached WORK
accounting, and all original native archives/chunks. It does not sign, broadcast,
enable WORK writes, or change authority service/configuration state.

The early compatibility controller must refuse after D+1 is sealed. This late
controller requires fresh proof for every complete block 973104 through H,
bounded to 512 blocks and 1,024 ordinary, non-derived protocol records in total.
Full Core block bytes must contain no batch attempt. Declaration/input signatures,
canonical coverage, original scalar seals, baseline replay, repeated compatible
replay, unchanged economic results and projections, and the derived marker must
agree. Unsupported derived records, any semantic difference, incomplete evidence
or a resource ceiling refuses publication. No generic backfill or tip-only marker
is permitted.

Each original and corrected native payload is limited to 128 MiB; cumulative
original and corrected native bytes are each limited to 8 GiB. Cumulative raw
block bytes are limited to 2 GiB, and qualification receipts to 32 MiB. These are
hard resource ceilings, not permission to skip blocks or weaken verification.

## Fixed scope

Base: A3 commit `eb0a2cf01b5173e14c710ed48c1a98b8d0a9ddee`, tree
`bf0ee61f0b37e585464e3673df169d28957e8f93`. Final source must be a clean descendant.
Planning preserves accepted runtime overlays using exact active/base/candidate
hashes and explicit reviewed conflict resolutions.

Exactly six existing files may change:

- `server/proof-api.mjs`
- `server/work-amo-v5-raw.mjs`
- `server/work-batch-declaration.mjs`
- `server/db/work-batch-reader.mjs`
- `scripts/backfill-proof-indexer.mjs`
- `server/db/native-transition-storage.mjs`

The native helper is an accepted overlay absent from A3 Git. Its sole permitted
base is SHA-256 `7e3393953864a68cdd72f43b7f3ae8e7eb4a24502ff2b260320790ee9be7f584`.
It is never treated as a new file or arbitrary live-source fallback. Other bases
come from A3 Git. All accepted dependency bytes/metadata, source/parent inodes,
Node, worker wrapper, gateway/static service configuration, private environment
fingerprints, and Search bindings remain pinned.

The publisher installs the catalog extension, immutable versions, exact current
row replacements, and derived D+1 marker in one SERIALIZABLE transaction.
For empty blocks, only `workBatchV1` and `transitionChainCommitment` change.
For ordinary nonempty blocks, `replayRecords`, `traces` and
`replayDescriptorCommitment` also change. Within each existing record or trace,
only `transitionChainCommitmentAfter.sha256` may differ; its model and payload
length, every other nested field and the exact array order remain unchanged. Event-set commitments, projections and
all scalar metadata remain exact. Original archives/chunks and historical
summaries remain readable. The native hot cache keeps its existing 128-height
policy; older replacements are verified through cold reconstruction.
The summary freshness fix lets the ordinary generator replace a stale current
summary when its transition source hash/chain/event-set binding changes.

## Prepare on the VPS

Wait for the concurrent release to finish and hand over the runtime slot.
Full captures, source stages, plans, SQL, logs and receipts stay in root-owned
private VPS directories. Do not change live source/configuration to fit a plan.

1. Integrate, review, test, run repository hygiene, and commit the repair.
   Record final commit/tree and keep that checkout clean.
2. Capture the handed-over runtime and run the render-only compose command.
   It produces immutable composition.json and reviewed candidate files, preserving
   exact active/base/candidate hashes. Conflicts require the hash-bound
   `--reviewed-merges` input.
3. Run `prepare-source-manifest.py` with that exact composition and capture.
   It stages the committed A3/final import closure and checks the imported runtime
   bytes against the captured/composed sources. The old accepted native helper
   validates the pre-publication catalog; the separate six-file runtimeSources
   map binds the new installed hashes. The resulting manifest binds the final
   commit/tree, Node, package lock and composition SHA. Exploratory manifests
   cannot authorize publication. Generate the final plan only after this step.
4. Review plan/review JSON, all candidate/dependency/inode/configuration pins,
   committed verifier/publisher/SQL/catalog hashes, and tests. Planning does not
   mutate live runtime or the database.

Run the committed tools as root with isolated Python. Replace the uppercase
metavariables with concrete exact private paths/identities:

```text
python3 -I -B deploy/work-batch-replay/release.py capture /tmp/CONTROL/capture.json

python3 -I -B deploy/work-batch-replay/release.py compose \
  /tmp/CLEAN_FINAL_SOURCE FINAL_COMMIT \
  eb0a2cf01b5173e14c710ed48c1a98b8d0a9ddee \
  /tmp/CONTROL/capture.json /tmp/CONTROL/composition \
  --release-id FINAL_PREFIX-YYYYMMDDTHHMMSSZ

python3 -I -B deploy/work-batch-replay/prepare-source-manifest.py \
  --source-root /tmp/CLEAN_FINAL_SOURCE --source-commit FINAL_COMMIT \
  --source-tree FINAL_TREE \
  --composition /tmp/CONTROL/composition/composition.json \
  --composition-sha256 EXACT_COMPOSITION_SHA256 \
  --capture /tmp/CONTROL/capture.json \
  --node-path /opt/REVIEWED_NODE/bin/node \
  --node-modules /CANONICAL_VERIFIED_NODE_MODULES \
  --output-root /tmp/CONTROL/replay-sources

python3 -I -B deploy/work-batch-replay/release.py plan \
  /tmp/CLEAN_FINAL_SOURCE FINAL_COMMIT \
  eb0a2cf01b5173e14c710ed48c1a98b8d0a9ddee \
  /tmp/CONTROL/capture.json /tmp/CONTROL/plan \
  --release-id FINAL_PREFIX-YYYYMMDDTHHMMSSZ \
  --composition /tmp/CONTROL/composition/composition.json \
  --composition-sha256 EXACT_COMPOSITION_SHA256 \
  --replay-source-manifest /tmp/CONTROL/replay-sources/source-manifest.json \
  --replay-source-manifest-sha256 EXACT_SHA256
```

The source stage keeps the exact committed Git package lock. A single accepted
A3 dependency compatibility lane permits Git lock SHA-256
`77170945a8cbc8a94c3e6d63b2faef6516317de6a1ad3e894ec363f77c243b14`
with captured runtime lock
`1f6d39daa9d62f3ce75e804333f04031a934f6f50690734df7f00effb7f3f4b6`
and installed hidden lock
`2463141898c4cbc3b775420a89e8ae71b12e9d82cf0bc39fd154922a332256aa`.
It binds the exact successful A3 plan, post-install and completion evidence.
The only permitted difference adds Space Grotesk 5.3.0 and its root dependency
while omitting the root MIT metadata; every other package and root field must
match, including installed replay dependencies. The manifest records this
provenance, and both qualification source fences recheck the installed lock,
module link and accepted evidence. This does not install or update packages;
all other unequal lock pairs fail closed.

## Apply and verify

The explicit overlay command is the only live action. Dispatch it once in a
bounded, file-backed detached VPS unit so progress can be observed without
blocking the operator. Use CPUQuota=100%, MemoryMax=2G, MemorySwapMax=0, Nice=15.
Use an outer RuntimeMaxSec of at least 37800s, with 900s termination grace.
The before-drain replay is bounded to 21600s and the cached-prefix/extension
qualification after draining to 7200s. Publication preparation has 300s and
execution 1800s, with a 1200s database statement ceiling. The controller supervisor
allows 33600s plus 900s recovery; the dispatcher allows 34800s plus 900s recovery.
These ceilings bound failure handling; they are not expected durations.
A shorter outer timeout must not kill recovery.

```text
python3 -I -B deploy/work-batch-replay/release.py overlay \
  /tmp/CONTROL/plan/plan.json /tmp/CONTROL/dispatch-receipt.json
```

The pinned Search controller holds Search. The source controller checks source,
configuration and authority fences, retains the private API environment without
emitting credentials, and performs a before-drain qualification while API and
indexing remain active. Bounded progress JSONL stays in a private VPS file;
stdout remains the final hash-bound result. It drains the
gateway socket/service, dependent worker, then API. The after-drain qualification
must independently revalidate every previously qualified block's Core hash,
original native digest, scalar metadata and relational fingerprint under the same
source, declaration, anchor and database identity. It may reuse that exact
qualified prefix and replay a newly indexed extension through the final drained
checkpoint, within the same hard ceilings. Its receipt binds the prior receipt,
reused rows and final checkpoint. A changed prior row, reorg, unavailable evidence
or changed checkpoint after draining refuses before source writes. Reuse never
substitutes a boolean for the original proof or its revalidation.

Before the first source replacement, it durably records source-write intent.
Source installation uses root-private same-filesystem quarantine and directory
descriptors with no-replace operations. Exact owned inode/hash/metadata and all
preserved dependencies are checked again before publication.

The controller prepares and pins the publication manifest/rendered SQL, records
dispatch intent, then executes with the exact database name discovered by the
READ ONLY qualification, with its captured local socket/port checked again.
Before COMMIT, first-party Core must still return the exact declaration and
checkpoint block hashes; failed Core or source checks roll back the transaction.
The immutable `publication-dispatch.json.result.json`
must prove COMMIT, exact old/new native digests, retained archives/chunks, current
metadata/scalars/hot slots and the replay-derived marker.
`publication-dispatch.json` alone means outcome unknown.

After repeated source/configuration fences, it restores API/worker and original
gateway activation states. HTTP postflight must expose the exact active
declaration and activation height, a tip at least as new as qualified H (the
same exact hash at H), writes disabled and ready=false. The current status API
does not expose replayReady separately; canonical summary freshness remains an
explicit final release check.
Search resumes only after verified terminal success or verified pre-source
recovery.

## Failure and release completion

Before source-write intent, recovery may restore only the verified unchanged
baseline. After intent, every failure is forward-only: API/worker/gateway stay
drained, Search stays held, all source/quarantine/native evidence is preserved,
and source rollback is prohibited. Timeout, malformed/lost receipt, uncertain
COMMIT, or changed inode/configuration is not permission to rerun, remove holds,
overwrite source or restore services. Inspect the preserved receipts and complete
a reviewed forward repair.

Controller success does not replace release synchronization. Verify affected
API/Computer surfaces, canonical summary freshness, native contract/marker and
runtime overlay provenance. Synchronize GitHub main, primary main, preview and
production source through the established release tools, then run
`npm run check:release-sync`. API-only pins/write enablement use the separate
activation controller after exact chain and canonical evidence agree.

## Runtime acceptance and latest archive

After successful replay publication, use the committed `runtime-archive.py`
adapter to extend accepted source provenance and run the unchanged VPS-only
archive verifier/retention lifecycle. The approval JSON has format
`work-batch-replay-runtime-archive-approval-v1` and exactly these inputs:

- `sourceCommit`, `sourceTree` and `releaseId` from the clean released source;
- `plan` with its absolute `path` and `sha256`;
- `inner` with the completed replay receipt directory `path`,
  `manifestSha256` and `receiptSha256`;
- `acceptedSha256` for the current accepted overlay inventory;
- `previousCompletion` with its absolute `path`, `sha256` and
  `archiveSha256` from the verified prior lifecycle;
- `heldSha256` matching the adapter's exact retained-inventory pin.

Read these values from the handed-over and completed receipts. Review the
private approval file and its digest before the live acceptance/archive action:

```text
python3 -I -B deploy/work-batch-replay/runtime-archive.py \
  --approval /tmp/CONTROL/runtime-archive-approval.json \
  --approval-sha256 EXACT_APPROVAL_SHA256 \
  --create-and-retain-latest
```

The adapter revalidates the before/after replay evidence, native publication,
six installed files and preserved dependencies before accepting the source.
Retain the resulting completion receipt. Only the latest verified managed VPS
backup remains; no archive or restoration payload is downloaded locally.
This lifecycle does not enable batch writes or replace release synchronization.

## Validation and retained evidence

`npm run check:work-batch:replay` runs source preparation, preflight, controller
and runtime-archive fixtures. `storage-fixture-test.py --output-root /tmp/PRIVATE_NEW_TEST_OUTPUT`
runs the native storage suite in a disposable PostgreSQL cluster on the VPS;
it never connects to production. Also run `storage-fixture-test.py --long-suffix
--output-root /tmp/PRIVATE_NEW_LONG_TEST_OUTPUT` in a separate fresh output
directory to verify the 129-block hot/cold cache boundary. Run both as root under
the same bounded resource policy. Preserve their compact result receipts.

`verify-supersessions.sql` is a read-only successor check for the original and
corrected native frames, current pointers and scalar metadata. Pair it with the
current native contract, Core and marker/checkpoint verification. Historical
restore verifiers and their receipts remain preserved; this small read check
does not claim complete restore or availability verification.
