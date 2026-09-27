# Approved wallet pending-listing and INCB repair — 2026-09-27

## Authorization and scope

The user approved code changes, tests, narrowly scoped production data repair,
commits, deployment, and production verification for the wallet pending-listing /
balance report and INCB transaction
`ebe60fd108e8830b4741101e6525081387dcf328e81c12fa2b533de0bdbf0d3e`.
Preserve canonical history, prevent overspending and double-counting, and do not
sign or broadcast from the user's wallet. The earlier bond `b00b9451…` is not
included in this production issuance approval.

## Initial evidence and implementation

- Production API at block 968766 still exposed the target's confirmed valid
  parent Inception bond and WORK transfer, but its synthetic INCB mint remained
  a reserved-namespace invalid event. Adding its ticker reference in Audit 26
  did not repair issuance. The expected target issuance witness is exactly
  720814688394061543 INCB units.
- Pending V8 listings have no final amount until confirmation. The old UI
  closed all WORK spending when any pending amount was unknown. The candidate
  uses an exact conservative hold derived from the same verified V8 closing
  state as the wallet capacity receipt: floor(25000 * 21000000 * 10^16 * 10^8 / N),
  bounded to 1..21000000*10^16. V8 canonical continuations require nondecreasing N,
  so every valid subsequent listing amount is no greater than this hold.
  Each distinct pending listing is counted once; canonical reservations and
  pending debits remain held. Estimates do not authorize spending. Missing or
  inconsistent bounds fail closed, and fresh preflight plus a final broadcast
  fence recompute the required bound. No signed protocol terms change.
- Wallet proof refresh had no request-generation fence. Older empty/error
  responses could overwrite newer balances. Both wallet-curated and node UTXO
  callbacks now reject superseded requests. Current failures remain visible;
  retained amounts do not authorize spending.
- The existing two-target INCB repair gained an explicit allowlisted single-txid
  option. It retains all canonical replay, H-1 provenance, exact conservation,
  and snapshot protection checks; the selected target determines SQL scope and
  the first affected derived-summary height.

## Isolated replay continuation

The retained clean2 database on the private Unix socket under
`/data/proofofwork-incb-final-source-replay-20260925T022000Z` was at block 958382
with an active bound replay marker. Source commit 9795c8a9aab9, tree
8e0af11cd7979ffc9b7367f15fe12692501ff9f8, matches its independently checked archive.
The prior green H958382 receipt remains preserved.

Its node_modules symlink pointed to a removed release stage. Startup failed
before any scan. A copied runtime dependency tree was also incomplete; it was
retained as attempted-recovery evidence. Dependencies were then installed into
`runtime-clean2/dependencies-20260927` using the identical lockfile
SHA-256 a9bc88218f249818700f1e66e98cf3e92f0a6f4b65b316c243184bed28f4f55f,
with lifecycle scripts disabled. New verifier/runner files in runtime-clean2
pin this dependency directory; historical helpers were not overwritten.
The loopback private API uses port 18888 and the clone DB uses port 65447.
Unit `pow-wallet-incb-clone-20260927-2` runs a bounded 2000-block scan with
8 GiB memory and one-core CPU limits. Production data/services remain unchanged.

## Validation and current status

- Wallet capacity server/client regressions: 21/21 passed.
- Actual wallet UTXO effect race regression: passed.
- Recovery behavior suite including single-target dry-run SQL scope: 542/542 passed.
- Connected wallet/mail browser suite: 13/13 passed, including the standalone
  pending-listing case; the additional embedded Computer wallet case passed.
  Both pending cases show 75,000 WORK remaining from 100,000 with a 25,000
  hold, enable another listing, and assert zero signing calls.
- Accounting, V8 AMO, UI, hardening, API truth, and server-global gates passed.
  Two existing accounting fixtures were updated to load current exact-Q8 and
  bridge helpers so the accounting gate exercises the current production code.
- Single-target INCB repair selector: 4/4 passed.
- Production TypeScript/Vite build passed; initial App gzip 180.59 kB.
- INCB production repair and release verification are not yet complete.

SOUL, ID rules and Mail organization were reviewed: no protocol, fee split,
signing boundary, or operating-memory change is required. README and MARKETPLACE
now describe the wallet behavior; OP_RETURN_INFRASTRUCTURE documents the narrowed
repair invocation. Historical audit evidence is retained.

## Wallet production release

- Code commit `b752518bf8b4e8cb13691d3a09a3ce865c6e0dd0`, tree
  `44a0443ffcb06ed04f14c4d68213788731631bae`, merged via PR #76 as
  `6e542b802aac006bab0217f5f7c6282e4230df3c`; all three hygiene CI jobs passed.
- Node release `b752518bf8b4-20260927T014810Z`, runtime fingerprint
  `f43470a19b05e937a9b1aed2697beec49e146e31675dc5c26997e81a7626ab04`.
  Read-only shadow strict parity passed 102 checks with zero active failures;
  exact ledger audit passed. An initial readiness handoff returned unavailable
  token reads; a fresh independent readiness audit and repeated strict parity
  both passed before publication. The first cutover invocation stopped before
  mutation because its private evidence parent was absent. After creating that
  parent, atomic publication succeeded, with rollback preserved, services ready
  and timers restored. Receipt is under
  `/data/proofofwork-wallet-incb-cutover-b752518bf8b4-20260927T014810Z/cutover`.
- UI release `b752518bf8b4-20260927T014804Z`, managed archive SHA-256
  `d85607cb426ee47110f2268e54d8b913bdeece6ffaccbb23c7a2e8ce7193051e`.
  Publication and provenance verification passed. The prior rollback root
  `proofofwork-www-pre-c64963f4649f-20260927T001231Z` was fingerprinted and
  explicitly retained, not deleted. Exact-byte HTTP smoke passed 771 requests
  across all 14 public UI surfaces, including retained asset closure.
- Public Wallet fresh response at block 968769 was authoritative and exposed
  `pendingListingReserveSubatoms=364405703`; the bound matches exact arithmetic
  from `pendingListingNetworkValueQ8=1440701927434020015221425768`.
  No wallet was connected to production and no transaction was signed/broadcast.

## INCB continuation

The retained earlier clean clone reached 963781 but rejected its full H-1
summary because replay WORK tables disagreed with reconstructed historical
listing lifecycle. Prior diagnostic-only work identified one pinned V5 relic
and 23 pre-V8 listings absent from the table's lifecycle projection. These
artifacts are preserved and are not treated as an issuance oracle. A separate
read-only diagnostic API on port 18889 now captures exact bridge inputs from
that isolated clone; no production issuance repair has run.


The read-only H963781 diagnostic now passes 25/25 ledger checks, with exact
WORK Q8 `740312837488337373524998649`, matching the pinned native transition.
The source-unit correction restores all 21,000 WORK mints. Independent bridge
reconciliation matches 346 holders and full supply `210000000000000000000000`.
It preserves the exact V5 pre-unit relic and all 23 immutable V8 cutover relics
without inventing spends. `scripts/fixtures/incb-replay-cutover-963781.json`
contains compact public-chain witnesses from the read-only clone for regression
checks; unrelated large transaction payloads are excluded. This diagnostic is
not yet an imported production issuance oracle. Production INCB is unchanged.
