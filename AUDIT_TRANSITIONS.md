# Audit transition regression scope

Added 2026-11-12. This is an isolated regression gate, not a claim of full-chain
correctness or live browser/wallet end-to-end coverage.

## Repeatable gate

Use the installed supported Node runtime (production currently Node 24), from a
VPS source worktree with dependencies. Do not build or store evidence locally.

```sh
PATH=/opt/node-v24.18.0-linux-x64/bin:$PATH \
  timeout 300s nice -n 10 npm run check:audit-transitions
```

Save output, source commit, runtime version, UTC start/end and exit status in the
VPS audit evidence directory. Failures are release blockers for affected changes;
skips must be named, not counted as successful assertions. This command does not
load production configuration, start the API, broadcast, or write production SQL.

Coverage:

- Code/Jobs candidate discovery reorg proofs, competing branches, preserved old
  evidence, compare-and-swap and fail-closed recovery fixtures.
- Pending arrival fairness, broadcast hint authorization, bounded discovery,
  health-only witness transitions and readiness refusal invariants.
- Retained pending observation times, unavailable wallet diagnostics, exact
  canonical checkpoints and pending/confirmed/dropped display semantics.
- Core absence required for dropped transaction detail; failed status sources
  remain unavailable; fresh pending/confirmation replaces stale cached status.
- Summary transition freshness and fail-closed seal evidence; incomplete counts,
  scoped wallet reservations and unavailable surface reads.
- INCB range witness binding, exact Q8 values and malformed/tampered witness
  refusal. This does not independently recompute every historical H-1 valuation.

The PostgreSQL reorg/publication-lock integration case in
`check-summary-transition-freshness.test.mjs` skips unless its explicit isolated
fixture socket is configured. A private PG16 cluster on the Node data volume
subsequently passed all 14 summary-transition cases with zero skips. Separately,
the real-PostgreSQL wallet coalescing/MVCC suite passed 15/15 with zero skips.
Both runs used an owned private Unix socket, no TCP listener or production
connection; the private cluster was stopped cleanly after each run. Evidence is
retained in the audit-e2e-pg-20261112 fixture and coalescing-fixture logs. These
are separate conditional integration cases, not interchangeable coverage.
Never point either fixture at production. The rest
are in-memory/source fixtures; they do not prove current production DB contents.

Two pre-existing harness drifts were repaired: the standalone wallet policy
fixture supplies its no-active-snapshot dependency; the original frozen SQL
oracle permits exactly the two chunk-aware transition payload substitutions
introduced by 698e03d, retaining the original query hashes and query-count fence.
No production calculation, query, event or ledger was changed by these repairs.

## Complementary evidence, not interchangeable tests

Use existing `audit:computer-events`, `audit:ledger`, `audit:ids` and
`audit:surfaces` only after reviewing their current read/write scope and target.
Record checkpoint height/hash and report dependencies, counts and exclusions.
HTTP page/asset 200 responses do not prove executed JavaScript or wallet UX.
The attached ThinkPad exposed no functioning in-app browser in this audit;
UniSat connect and human-signing flows remain unverified. Do not emulate a real
signature or create paid records to close that gap.

Live browser acceptance, when available: connect UniSat with the human; inspect
wallet balances and loading/unavailable states; compare a canonical confirmed
transaction and a currently Core-present pending transaction with API data;
verify product navigation and render completion. Exercise dropped/reorg cases
in mocked browser fixtures, not by manipulating production chain/indexer state.
Any signing or paid publication needs the human's explicit action.

## Bounded independent replay follow-up

The first audit verified all 26,845 stored confirmed transactions against Core,
raw txids and 81,385 stored outputs. That is membership validation, not proof
that no candidate was missed. These deeper passes remain separate work:

1. Pin tip height/hash and protocol activation boundaries. Read Core blocks in
   bounded sequential batches, independently extract every recognized protocol
   carrier, and compare `(txid,vout,ordinal,protocol)` against read-only database
   snapshots. Persist cursor and batch digests on the Node data volume. Check
   parent hashes and tip hash again; invalidate affected batches after reorg.
   Include malformed candidates, not only accepted events. This proves discovery
   only for explicitly enumerated ranges/protocols.
2. For every candidate input, resolve its prevout from Core transaction/block
   data, independently compare script, amount and actor evidence with stored
   rows, and recompute integer fees. Stored input sums alone are not independent
   prevout validation. Bound RPC concurrency, batch size and retained raw data;
   unavailable/pruned data is a gap, not a pass.
3. Replay protocol economics in deterministic canonical order in a disposable
   isolated database, never via live repair tools. Compare checkpoint digests,
   exact integer supply, holders, reservations, credits and fees after each
   batch. INCB must bind each valuation to independently derived H-1 evidence;
   fixture witness validation is insufficient. Reuse verified raw data without
   trusting production projected balances as initial truth.
4. Budget CPU/I/O, storage and time before starting; use a single low-priority
   worker, resumable checkpoints and explicit stop thresholds. Do not run an
   unbounded genesis scan beside production. Retain manifests/differences rather
   than duplicate archives, and do not delete source evidence to make room.

## Release simplification without safety loss

Run this single named gate once per exact candidate commit and retain its receipt
instead of manually repeating its component commands. Reuse receipts only when
source/dependencies/runtime match. Keep existing full release hygiene, relevant
math/product tests, browser checks, rollback, capacity reserve, deployed commit
and canonical readiness checks. Do not merge build success with live assurance,
remove fail-closed checks, lower storage safeguards, or retire the last verified
rollback to accelerate shipping.

## Bounded independent chain sample, November 12, 2026

A single low-priority read-only scanner independently decoded every transaction
output in two twelve-block windows, not only transactions selected from the
database. Canonical hashes for all 24 blocks were rechecked after each window.

- Heights 975515–975526: 46,521 transactions, 26,375 OP_RETURN outputs, zero
  recognized application carriers and zero indexed carriers. This window alone
  supplies no prevout or fee coverage.
- Heights 975476–975487: 36,833 transactions, 14,622 OP_RETURN outputs, 35
  recognized application carriers and 35 indexed carriers, with exact txid/vout,
  protocol and payload-hex agreement. This window was deliberately selected
  using the latest indexed transaction height; carrier enumeration inside the
  window remained independent of database-selected transaction IDs.
- For the first 25 discovered protocol transactions, all 25 input prevouts were
  fetched independently from Core. Stored prior txid/vout, address, satoshi value
  and previous-output script matched; independently computed integer input-minus-
  output fees matched all 25 stored fees. No discrepancies were observed.
- Unrelated OP_RETURN scripts outside the push-only decoder contract are counted
  separately, not called invalid application events. No production records,
  services, protocol data, signing or transactions were changed.

Scanner source, per-block hashes, detailed results and compact summary are
retained under the Node audit's independent-carriers-20261112 evidence directory.
This is sampled recent discovery and prevout assurance, not complete historical
carrier discovery, every historical prevout, genesis economic replay, or INCB
H-1 reconstruction.
