# Jobs release runbook

This is a release procedure, not a production receipt. The user approved Jobs
v1's build, configuration, tests, hygiene, commit, push, deployment, verification,
rollback preservation and release announcement on 2026-10-07. Publication remains
conditional on the exact candidate passing its local and chain/API checks.

## WORK rewards upgrade

The user approved the complete Jobs WORK-reward build-and-ship scope on
2026-10-08. Metadata version 2 preserves v1 and the original discovery boundary;
its additional opening is 970577 after independently verified Core parent
970576 / `00000000000000000001bc401b09150a6f092579644cc5616a828949f48bbd1d`.
No bootstrap rewrite or database migration is part of this upgrade. Verify the
new parent, complete current Jobs coverage, original Welcome job and separate
proof/WORK paid totals before UI publication. The current UI contract is V5
with all 22 managed roots, including Pages and Permission. The original
twenty-root v1 release below remains historical recovery context.

For this upgrade, use the previous synchronized source commit
`b40d4f4a0d3144996058cc034a7480e048a88793` as the three-way merge base. Capture
from the new exact controller, then plan from a clean exact committed checkout:

```sh
python3 -I -B deploy/jobs/release.py capture /tmp/jobs-work-runtime-capture.json
python3 -I -B deploy/jobs/release.py plan "$PWD" "$candidate_commit" \
  b40d4f4a0d3144996058cc034a7480e048a88793 \
  /tmp/jobs-work-runtime-capture.json /tmp/jobs-work-runtime-plan \
  --reviewed-helper-upgrades /tmp/jobs-work-helper-review.json
```

The explicit review file uses format
`proof-of-work-jobs-reviewed-helper-upgrades-v1`, exact `baseCommit` and
`sourceCommit`, and a `sources` array with one row per changed existing helper:
`path`, `activeSha256`, `baseSha256`, `repositoryCandidateSha256`, and `reason`.
Only `server/jobs.mjs`, `server/db/jobs-reader.mjs`, and
`src/shared/protocol/jobs.mjs` are helper-upgrade targets. Each active helper
must exactly equal the prior released base bytes; replacement bytes come only
from the committed candidate. The remote manifest and receipt preserve these
review pins. An unchanged helper must not have an unnecessary upgrade row.

Without a flag, the planner retains creation-only first-install behavior.
`--preserve-existing-helpers` instead requires every existing helper to equal
the candidate bytes and permits no helper change. It is mutually exclusive with
the reviewed-upgrade mode. A conflicted shared-file merge can use the explicit
`--reviewed-merges` file with format `proof-of-work-jobs-reviewed-merges-v1` and
hash-bound active, base, candidate and reviewed `/tmp` merged bytes. Only the
five existing non-helper runtime paths accept such a resolution. Conflicts,
missing reviews, changed input hashes or unreviewed helper drift refuse.

Complete captured source inventory, dependency/runtime hashes and API/worker
service units/state are fenced. Keep accepted native transition access and all
unrelated overlays. Apply the reviewed plan using `release.py overlay`; the
controller preserves original bytes and verifies application or rollback
before Search restoration. Interrupted or incomplete rollback retains the
Search hold and recovery evidence for supervised recovery. Ordinary indexing
continues the existing candidate witness after the short source cutover;
underlying WORK and Mail economics are unchanged.

## Preserve the active runtime

The node serves `/opt/proofofwork-api` with accepted, uncommitted audit, Code and
content-tip overlays. Do not deploy a full checkout, reset Git, or replace those
changes. Capture the current Git identity, complete relative-import closure,
source hashes, local Node executable hash, API/worker working directories,
gateway activation/enablement, authority service state and installed Search unit
hashes before preparing the Jobs manifest.

Apply only the reviewed Jobs delta to the captured active sources. For a shared
file, use the exact pre-Jobs repository source, reviewed Jobs source and captured
runtime source to construct and inspect a three-way merge. A conflict or an
unexplained runtime difference requires resolution and another local check;
never resolve it by overwriting the active file. Run relevant Jobs, Code, Mail,
ledger and discovery checks against that merged runtime candidate as well as the
repository commit. Runtime package and lockfile bytes remain dependency pins,
not write targets.

`scoped-node.py` accepts only eight runtime paths: the API, shared DB reader,
indexer, event relations, existing Code raw-block walker and three new Jobs
helpers. Its manifest binds an exact Jobs commit and release ID, every old/new
source hash, complete runtime dependencies, Node executable, gateway units and
an existing Search hold. It refuses drift before writes, saves before/candidate
bytes and fsynced receipts, drains the socket/proxy before API/worker, preserves
authority services and rolls back original existing sources on failure. New
unused helpers remain retained evidence after rollback.

## Node and discovery sequence

1. Run `npm run check:jobs`, `npm run check:jobs:deploy` and the affected regression
   gates. Complete `npm run hygiene:fix`, semantic documentation review and
   `npm run hygiene:check` before committing the exact reviewed candidate.
2. Capture fresh source/dependency pins and prepare a creation-only manifest
   using format `proof-of-work-jobs-scoped-runtime-v1`. Its `sources` must match
   the controller's exact `ALLOWED` set. The active runtime's Git HEAD is a
   baseline pin; the Jobs commit is provenance for the additive delta.
3. Use the hash-pinned `deploy/search/hold-node-timer.py` controller to acquire
   the release's Search hold. Retain its receipt and marker hash. Run the exact
   committed Jobs controller as root with `python3 -I -B` and that manifest on
   stdin, under the approved managed execution and existing operations lock.
   Restore Search activation in a `finally` path using the same hold identity
   and pinned service/timer bytes. If an interrupted node controller has not
   finished its rollback, retain the hold and its receipt until supervised
   recovery confirms that controller has exited. Never resume Search over an
   uncertain runtime.
4. Run the supervised Core candidate bootstrap using
   `npm run indexer:backfill -- --bootstrap-jobs-candidates`. Its bounded scan
   starts at the explicit Jobs v1 first-admission height **970404**, whose
   independently Core-verified parent is height **970403** /
   `00000000000000000000cf98017be585521a2a84e4030e20021565479c6218fe`.
   These immutable boundary pins are part of the version-one protocol, not a
   mutable deployment timestamp. Earlier Mail remains ordinary replayable Mail;
   it cannot retroactively gain Jobs authority. Scan every raw block from that
   boundary to the exact current tip, covering `pwm1:m:pwj1:` occurrences,
   including malformed records, at an authenticated hash-bound checkpoint.
   `POW_INDEX_JOBS_BOOTSTRAP_MAX_BLOCKS` controls each bounded invocation; repeat
   only from its saved verified progress until the complete witness exists.
   Keep existing public services available throughout discovery. Jobs reads
   must remain visibly unavailable while coverage is incomplete. At the exact
   pinned parent tip, the bootstrap can publish a complete empty witness after
   checking that parent against both DB and Core. This enables an empty Jobs
   board before its first admitted block without admitting any earlier Mail.
5. Verify the complete discovery witness, canonical position and input
   authority, then fresh Jobs list/detail/stats reads at the same confirmed
   checkpoint. An earlier candidate missing canonical Mail/seal evidence must
   fail closed; it cannot be silently added to a sealed economic history.
   Investigate such a refusal before any separately scoped replay.

There is no Jobs schema migration, second payment contribution, registry fee,
custody, or wallet-key handling in this sequence. Keep ordinary Mail/Files
economics and their immutable historical seals intact.

The executable capture and planner use creation-only private `/tmp` paths. Run
them from the clean exact candidate after commit; inspect `review.json`, all
merged sources and the manifest before either production command. The planner
preserves the accepted native transition accessor for the new Jobs closure,
then checks the complete before/after relative-import fence and merged syntax.
The separate bootstrap dispatch reuses the active worker's configuration
internally and runs as that worker's user; it never records configuration
values in the plan or receipt.

```sh
candidate_commit="$(git rev-parse HEAD)"
python3 -I -B deploy/jobs/release.py capture /tmp/jobs-runtime-capture.json
python3 -I -B deploy/jobs/release.py plan "$PWD" "$candidate_commit" \
  0d55e0034554fda5dc43b3329b061e004f1f9d30 \
  /tmp/jobs-runtime-capture.json /tmp/jobs-runtime-plan
```

After the reviewed plan's exact commit is cleared for rollout:

```sh
python3 -I -B deploy/jobs/release.py overlay \
  /tmp/jobs-runtime-plan/plan.json /tmp/jobs-overlay-receipt.json
python3 -I -B deploy/jobs/release.py bootstrap \
  /tmp/jobs-runtime-plan/plan.json /tmp/jobs-bootstrap-receipt.json
```

An incomplete bootstrap returns failure and preserves its receipt; it never
claims successful installation. Inspect the saved progress and cause before a
bounded retry with a fresh receipt path. A successful bootstrap still requires
the fresh Jobs API and canonical consistency checks before UI publication.

## UI publication and verification

Jobs adds the nineteenth public build and twentieth managed root; NFT remains
a verified Computer alias. `deploy/publish/build.py` builds all surfaces from
one fresh exact committed checkout, including `VITE_JOBS_ONLY=1` with
`https://jobs.proofofwork.me`. Build receipts and transport archives remain
outside source. The current stager, publisher, provenance, retention,
preflight, capacity and HTTPS verifier include Jobs, while preserving every
historical fourteen- through nineteen-root family.

Use the existing exact-commit `deploy/publish/release.py` plan, transport,
publication and collection workflow. Install only hash-bound release helpers
through `deploy/search/install-ui.py`'s guarded helper phase. Classify and
fingerprint every retained rollback root; retain the complete current serving
root and archive. Do not prune history, release evidence or rollback roots.
All capacity, compatibility, operations-lock and retention-hold checks remain
mandatory. Publication exchanges one complete root atomically and preserves
prior reachable assets so open old tabs keep working.

The guarded Caddy phase requires the exact newly published commit/tree and
all twenty managed roots before validation and reload. It adds
`jobs.proofofwork.me`, its HTTP-to-HTTPS redirect and `/var/www/proofofwork-jobs`
SPA root using the shared static/API/security policy. Jobs needs no additional
social identity iframe authority.

After publication, compare every archived managed public file against off-host
HTTPS with `deploy/publish/https_smoke.py`; verify Jobs standalone and Computer
routes, fresh node APIs, discovery checkpoint, evidence unavailable states,
existing products and rollback provenance. Local wallet signing remains local;
record any live transaction path that was not exercised. Update release
evidence, commit and push its reviewed bookkeeping, then publish the authorized
release announcement and verify its public link.
