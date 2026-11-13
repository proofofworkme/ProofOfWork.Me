# Linked Publish staged release

These tools prepare and perform a **writer-off** runtime cutover. They never
enable linked writes. The final source must pass the complete release gates and
root reconciliation before apply accepts a plan.

## Source and runtime provenance

The node runtime has accepted native-storage, observation and shared-confirmed
Search adaptations not represented by its historical Git HEAD. Never reset it
or copy the canonical checkout over it.

`prepare-profile.py` produces an exact 19-file overlay, including the additive
SQL, bounded-reader helper, pure metadata/limits modules and the unchanged
powcat1 limit import/re-export. It preserves import adaptations, uses independently reviewed exact
active/base/candidate triples for semantic Search integration, and rejects
unreviewed conflicts. Run it on the VPS after source freeze, review every
before/after hash, and commit the generated profile with the final source.
Later source changes invalidate plan creation. The SQL is not JavaScript:
only that exact fixed schema path is excluded from Node syntax checks; its
PostgreSQL semantics are covered by native integration gates.

The existing digest-pinned scoped node engine still owns source, metadata,
service/gateway, authority, archive and rollback fences. The wrapper adds
candidate staging and a final drained-checkpoint raw-v2 census.

## Verification and planning

Run:
```sh
node --test scripts/check-publish-linked-deployment.test.mjs
```

This covers the exact overlay guard, pin semantics, single-owner coordinator,
child-timeout recovery, qualification admission and raw-v2 census. It makes no
production changes. Also run every functional/native/browser release-impact
gate, final-source hygiene and independent review. Browser evidence must explicitly
mark completion and contain the exact 52 unique named cases; a passing partial
run, duplicate case or substituted name cannot qualify. The synthetic v2 fixtures
must demonstrate rendering, full-body Search, shared-confirmed/reorg handling
and disabled-writer behavior. They do not constitute a signed live transaction.

From the final clean committed candidate, use `release.py plan COMMIT OUTPUT`
through isolated root Python on the node. Inspect the exact resulting plan and
its SHA. No production state changes in the planning phase.

## Single-owner apply sequence

Apply requires two environment values identifying a final read-only
qualification receipt:
`POW_LINKED_RELEASE_QUALIFICATION_PATH` and
`POW_LINKED_RELEASE_QUALIFICATION_SHA256`. The receipt must bind the exact
commit/tree, plan SHA, runtime hashes and all required passing evidence.
The `qualification.py` validator defines its strict schema. A missing or stale
receipt leaves apply disabled. Setting these variables is not a gate bypass.

The coordinator:
1. Stages only the merged, plan-bound executable dependency closure plus the
   committed schema/helpers under a root-owned VPS source directory.
2. Acquires exactly one hold through the existing pinned Search timer controller.
   Both old timer and builder must stop. Merely pinning a generation while the
   old builder runs is unsafe because that builder ignores the pin table.
3. Applies the additive derived schema, then pins the latest ready v5 generation
   without replacing another release's pin. New pruning retains recursive
   shared-confirmed ancestors and remains version-scoped.
4. Runs bounded v6 builds under the existing resource envelope, with a 1200-second
   total prebuild deadline. It verifies actual reader queries, canonical witness,
   exact current Search coverage and capacity before runtime cutover.
5. Invokes the existing scoped runtime controller under the same hold. After
   that controller drains the old API/indexer and before any candidate file is
   installed, a read-only census checks every retained confirmed raw transaction
   at the drained checkpoint for v2/linked Publish post metadata. Any candidate,
   missing raw data, reorg or resource failure stops installation and triggers
   verified old-byte recovery. Preexisting v2 requires explicit replay review,
   not a false zero based on old typed projections.
6. Installs exact candidate sources and restores services, retaining the v5 pin.
   It restores the Search timer only after the controller verifies its outcome.

On a known prebuild failure or verified old-byte rollback, the coordinator first
proves the exact old runtime, then removes **only its own recoverable prebuild
pin**, and finally restores the old builder. This prevents the old worker's
pruning from colliding with an unsupported retained pin. A foreign/changed pin,
changed baseline, unverified child stop or uncertain runtime outcome preserves
the hold for supervised recovery. It never guesses that a timeout rolled back.

The census is assurance over retained raw transactions at a checkpoint, not
independent genesis discovery. Its compact receipt stays with the scoped
runtime receipt. No canonical history, balances or protocol evidence is edited.

## Writer-off rollback and activation

The first successful v2-capable writer-off release is the rollback target.
Retain and verify its node runtime archive, matching UI and Publish renderer,
full-body Search, release-sync result, native/browser v2 fixtures and live
preactivation receipt. `validate_retained_rollback` checks the evidence bundle.
Its output explicitly does **not** claim a newly signed live v2 write.

The UI-host Publish renderer is not installed by the node profile. Ship it with
its existing guarded installer and matching UI release, then perform mandatory
release synchronization before announcing completion.

Only after the retained writer-off bundle and live gates pass may a separate
authorized activation step enable writes. These tools contain no enable step.
After the first v2 article, e266 is not a parity-preserving rollback. Disable
new writes while retaining v2 readers/indexing/full-body Search, and use the
retained writer-off release or a bounded roll-forward. Never drop additive
tables, source commitments, referenced bodies or historical evidence.

Do not retire the successful release's v5 pin automatically. Its removal needs
a current-serving and rollback-retention decision. No general cleanup command
or postactivation legacy rollback is provided.
