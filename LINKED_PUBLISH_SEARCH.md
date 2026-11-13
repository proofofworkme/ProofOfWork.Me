# Linked Publish full-body Search candidate

This document records the implementation contract and its qualification history.
Production deployment and writer activation are established only by the current
release manifest, fresh capability evidence and the append-only audit trail.

Existing inline query semantics remain unchanged. Linked body bytes are content-addressed once, separate from per-generation references and parser-qualified JSONB postings. Query-specific vectors preserve native simple-parser positions, matching and ts_rank_cd normalization 0. Literal substring fallback searches the complete exact prefix, newline and body. No byte normalization or truncation is permitted.

## Operational capacity

Limits are availability policy, never chain validity: 4,000,000-byte body; 256 MiB serialized postings per content/parser; 8 GiB aggregate logical content/postings; 12 GiB actual relation/TOAST/index allocation; 100 GiB free filesystem plus 512 MiB scratch and prospective materialization. The content writer is advisory-serialized. Existing reader statements retain their 15-second limit. Writer readiness requires exact canonical current Search coverage and worst-case next-article capacity.

All ready/building generation references pin content. Only unreferenced reproducible postings, then unreferenced bodies, qualify for GC. Interrupted copy progress and references roll back together. Canonical evidence, ledgers and historical source records are never cleanup targets.

DELETE does not imply reclaimed filesystem bytes. Actual allocated size includes dead storage. The candidate explicit operator command `node scripts/backfill-proof-search.mjs --compact-linked-search` requires operational review before production use. It excludes generation builds with a maintenance lock, reserves a full temporary-copy budget, uses a one-second relation-lock timeout and 120-second per-table timeout, rewrites only the three derived tables, and verifies unchanged row/logical accounting. Reclaimed bytes are measured, not presumed. Timeout is not success.

## Qualification

Initial private PostgreSQL testing measured 3.81 MB physical compact storage for one 4 MB/500,000-distinct-token body versus approximately 42 MB with per-token rows. This is not a universal bound. Initial prefix/phrase/NOT/OR matching and ranking passed 180 comparisons. A combined maximum-length query timed out; native and candidate phases are being measured separately. Per-case results, not transport success, determine qualification.

Remaining: final-source native integration, canonical dependency/reorg and pending cases, Unicode/query adversaries, pagination, interrupted builds, GC and compaction, worst-case resource bounds, independent review, surface impact and release synchronization. Do not enable 4 MB Publish from these preliminary results.


## Additional qualification, 2026-11-12

Native lifecycle fixture 201000 passed 16 checks: canonical byte materialization, exact Unicode retention, copying, actual reader SQL substring/negation/pagination/cursor rejection, dependency reorg rejection, interrupted-copy rollback/retry, building-generation pins, maintenance exclusion, GC and compaction. Reader source census was explicitly synthetic-stubbed; this is not a live historical witness proof. Clean shutdown/no socket/PID verified. Compaction measured 114,688 to 57,344 physical bytes after GC.

The 2047-character/1024-term grouped and interleaved queries produced exactly equal native/reconstructed vectors and matches. Both native and candidate ranking exceeded 15 seconds; successful rank parity is not established for that adversary. Keep honest unavailable behavior, not silently changed ranking.

Four-million-byte dense single-letter text materialized in 2.96 seconds. Short-distinct 4 MB text occupied 4,358,144 physical bytes. Five BOM/combining/control/overlong/punctuation cases matched native vectors. Independent e266-versus-candidate review reported 147 identical historical v1 metadata/raw-post/body cases, including NUL/BOM/surrogate/Unicode/CRLF. No v1 contract edit was needed.

Earlier blocker, resolved by the later native-first candidate below: valid 4 MB repeated compound text exceeds 64 MiB temporary-file cap in native ts_parse tuplestore, although native to_tsvector completes. Removing SQL CTE materialization does not help. Bounded function-local memory tuning is under independent review. No global memory increase or semantic chunking is approved here. Keep writer off until resolved and final integrated source qualified.


## Release and rollback ordering

Apply the additive derived schema and build/verify a complete v6 generation before switching API readers. Where deployment tooling permits, retain current v5 API and generation while prebuilding; do not present a schema-only deployment as ready. The v2 writer stays disabled until source coherence, canonical Search readiness, capacity, all consuming surfaces and measured capability latency pass. Native tiny-fixture timings do not qualify production latency.

After the first v2 article, old e266 UI/backend Search is not a parity-preserving rollback. Disable new writes while keeping v2-capable readers and full-body Search. Retain additive tables, source commitments and content. A rollback candidate must demonstrate read-only rendering and full Search of existing v2 articles with writes disabled, or use a bounded roll-forward plan. Do not drop these tables or rely on a legacy archive as the entire rollback strategy.

## Recovered parser qualification

The initial native-first investigation reported success even though its final
distinct-token assertion had a SQL syntax error. That result is not accepted
as a full pass. The original evidence is preserved. A corrected fail-closed
fixture passed native compound/dense parity, mixed fallback, and every position
for 500,000 distinct lexemes in a 4,000,000-byte body. A separate near-threshold
compound plus 87,500 / 100,000 / 125,000 unique-lexeme fixture passed in at most
3.994 seconds per fallback, with a combined private PostgreSQL cgroup peak of
662,237,184 bytes, no OOM, no temporary-file limit failure, and clean shutdown.

The candidate now prefers native to_tsvector and falls back only for its exact
documented vector-size error. Function-local work_mem is 256 MiB; it is a
per-operation limit, not a process-memory guarantee. Global PostgreSQL settings
are unchanged. Materialization remains globally advisory-serialized. These
synthetic measurements do not certify production latency or final release
readiness. Evidence is retained in the node's native-first-resume and
parser-threshold-resume fixture directories dated 2026-11-12.

## Full-source transition qualification

The recovered candidate preserves the accepted shared-confirmed generation
overlay. Linked references belong to the independently verified confirmed base,
not the shared generation's rewritten identity. Per-version retention follows
all copy ancestors, including ancestors of explicit serving pins. Source batches
commit at most one linked article with their cursor, so a process deadline cannot
repeatedly roll back hundreds of expensive articles.

Native lifecycle and unmocked source-SQL transition fixtures each passed 17 checks.
A separate exact 4,000,000-byte, approximately 500,000-token article passed the
same 17 transition checks: pending visibility, confirmation, shared generations,
new-height copying, dependency reorg rejection, restoration and unchanged source
payment attribution. The full source witness took 200 ms; Search readiness took
132–139 ms; initial confirmed materialization and backfill took 2.754 seconds.
Private PostgreSQL peaked at 744,034,304 bytes with 77,520,896 bytes of cluster
allocation, below the unchanged 1 GiB and 256 MiB limits. No OOM or resource
violation occurred, and shutdown was clean.

The fixture used synthetic Core and indexed-source data. It did not mock the
Search source-witness SQL. It does not establish live production latency,
transaction signing, full protocol replay or whole-economy correctness.
The 298-file source manifest was checked before and after execution.
Completed receipt SHA256:
0de56715efd5e21c09120d94c4efeb49d9f99bc91c5a1b01ccb37b17490a36f3.
Source manifest SHA256:
b0c8e540be1f5354c8e3afb1864dad9035c7a8397250183c4865b20bc6eaa52f.

Final exact-commit release checks, production preactivation and coherent
deployment remain required before writes are enabled.
