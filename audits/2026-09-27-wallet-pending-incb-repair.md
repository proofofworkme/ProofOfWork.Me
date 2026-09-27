# Approved wallet pending-listing and INCB repair — 2026-09-27

## Completed production status

Both approved fixes are deployed and production-verified. Wallet pending listings
reserve only their exact conservative capacity, and stale refresh responses cannot
overwrite newer balances. The target `ebe60fd1…` now appears exactly once in
public Inception history with `720814688394061543` issued units. Production has
47 INCB mints and conserved supply `945662401792509469`.

The repair preserved all 46 older mint rows, unrelated canonical history, pending
deltas, retained snapshots and all 9,203 pre-repair native transition rows.
Fresh summary consistency passed all 25 checks; final strict live parity passed
102 checks with zero error-level failures, and the full ledger audit passed.
Public Inception and wallet verification passed at block 968825, with ready
zero-lag production health. No user wallet transaction was signed or broadcast.

The following sections retain the implementation, intermediate failures, recovery
and verification history. Earlier pending-status statements describe those
stages and are superseded by this completed status.

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

## Exact-source checkpoint and next replay barrier

Replay reconciliation commit `dd437a71071aa38f238df5c14183b34a24c5432c`
(PR #77, all three hygiene CI jobs passed and merged) reproduced H963781
from an exact archive (`f7d8253bf16a7f8734919a712149178d03107e99b49682b726b0df88b0d9c023`).
All 25 checks passed; response SHA-256
`982d9bbcd7b842637ec6b770b01f8a688a184a4f63f523ba688bff42acd89638`.
The bound replay marker remained unchanged. The subsequent isolated scan stored
that green H-1 checkpoint, then stopped safely before block 963782 because its
native direct/WORK issuance components could not bind to one combined mint.

The component correction preserves the native four-record commitment while
storing exactly one recipient mint. The public-chain fixture at
`scripts/fixtures/incb-replay-components-963782.json` includes the exact Core
transaction, native replay records and independently verified canonical mint.
Regression coverage rejects altered/missing/duplicate components and absent WORK
parents; it asserts unchanged transition history and exact event-set digest.

Read-only comparison also found six older production INCB mint amounts differ
from the isolated replay (three at 958796, two at 958943, one at 959004).
These are not included in the approved single-target production repair. No
production mint, balance, historical snapshot or recovery marker has been changed.
The production marker remains an ordinary completed rebuild, not a certified
958383 replay; existing importer/repair guards must not be bypassed or replaced
with a copied clone certificate.

## Narrow production repair admission (in preparation)

Component commit `75b196ea8aab12606470f58faf947b8ca3095ee3` (PR #78,
all three hygiene CI jobs passed and merged) replayed block 963782 successfully:
one combined mint of `352529923159` units and the unchanged native four-record
commitment. Its exact source archive SHA-256 is
`ade5e4923911393e6d9f27666d3a697be3bf7562f27155456d4626d9b39236f8`.
The isolated continuation is progressing toward the target H-1 at 968124;
production remains on the wallet release and production INCB is unchanged.

The pending scoped importer stores the independently verified H-1 source row as
a sealed, target-only proof wrapper, not as an eligible public summary. It has
no `canonicalSummary` source hash, no summary payloads and no green summary
status. A read-only query using the actual PostgreSQL public-summary admission
expression accepted the original full H963781 source and rejected its wrapper.
The final target proof remains disabled until the completed replay certificate,
immutable witness manifest, exact source bytes, native state commitments and
Core hashes are reviewed and pinned. No environment override enables it.

The production recovery marker is never replaced with the clone certificate.
Only the selected `ebe60fd1…` issuance can use the scoped checkpoint; transaction
specific cache keys prevent it being reused for another bond in the same block.
The repair binds the two native issuance components into one persisted mint,
then checks the original ordered block event-set commitment before commit.
A repeated exact repair returns `already-applied` with zero changed rows and
requires conserved supply and the same native commitment. The six older mint
amounts and the earlier `b00b9451…` incident remain outside this repair.

An independent logical copy of production is being prepared for rehearsal of
the final pinned importer and single-target repair. This rehearsal is separate
from the historical replay database. The expected target-only supply change is
`224847713398447926` to `945662401792509469` units; fixed issuance value Q8 changes
from `22484771339844794793582060` to `94566240179250949146190218`.
These are expectations, not a receipt of production mutation.

The scoped balance rebuild now refuses to reclassify any pre-existing malformed
or generic reserved-namespace mint instead of rewriting that historical row.
It also preserves existing pending INCB deltas during the confirmed balance
rebuild. These safeguards apply only to the explicitly scoped issuance repair;
ordinary canonical recovery behavior is unchanged.

The production rehearsal backup completed at `2026-09-27T03:11:11Z`: custom
archive size `20162773017` bytes, SHA-256
`89d1718cfa6b3e0c1e825ac50149605ec2b048d26e94539da843b4358e0a7850`.
Its restore list passed and the checksum was independently re-read before
restoration into `proof_indexer_scoped_rehearsal_20260927` on the private Unix
socket/port 65447. This is a rehearsal backup, not the final production repair
window backup. Native production H968124 is already pinned by closing state
`1ba106b2a4636f92a3f4479c1f6b0181448b47e85144640abc99142463f2df8e`
and WORK token state
`7d8fc8fbea6d4e2913988ea0c1b6230bd00beddaca00d83ab5cb55b2873da69c`;
the completed independent source must match both exactly.


The restored production baseline passed all 25 ledger checks at block 968773
(hash `0000000000000000000002e48c0a7659a430c38fe079ebb47a2ffbc344188a9e`),
using exact commit `2f6378963aae66c3e601405e9a772fd6f306b214` with admission
disabled. It retained 46 mints and supply `224847713398447926`; response SHA-256
`b1a42b5cc4d38ec7577311dd301a31b98b8aa63806cbe05f963b5be092e7abbb`.
The initial baseline connection was rejected by the private cluster's exact
database allowlist. A single local peer rule for the new rehearsal database
resolved it; production authentication was unchanged. Restore completed at
03:33:53 UTC and the baseline passed at 03:35:07 UTC.

The immutable before-inventory covers all transactions, blocks, metadata,
unrelated events and references, non-INCB balances/definitions, listings,
9,153 complete native transitions, 20,407 snapshots, and all 46 existing INCB
mints. Inventory SHA-256 is
`86e25a35c1c37c37c7d53a954b30884e1f78ec0468259d222526d24ce9d20fd8`;
ordered native-row SHA-256 is
`a738062d70578861d5467e66a185bfe7f69cad5a20a6598f2bd9a814917e4aee`.
There were no pending INCB deltas in this baseline. The production target block
still contains only its accepted parent bond, accepted WORK transfer, and two
invalid issuance aliases.

A future full replay can deterministically reproduce an H-1 snapshot identity.
That identity is reserved for the sealed scoped oracle once pinned, so a newly
rebuilt public summary receives a distinct deterministic identity if it would
collide. All eight summary children and the ledger use the distinct identity;
the original proof remains immutable and excluded from public summaries.
The scoped oracle and full API builder regressions pass, as do 547 recovery
behavior checks and server-global/module-syntax checks. The target proof is
still unpinned and no production INCB mutation has occurred.

## Guarded code release, before target proof admission

PR #79 merged as `0b582547fd7f3607c56cc22cb4b5792a9015c2be`, with all three
hygiene CI jobs passing for exact source `f4ca769e920287d2deb1a21f35371fd4488f5344`.
The code-only node release `f4ca769e9202-20260927T055111Z` completed its atomic
cutover at `2026-09-27T05:59:30Z`. Source tree:
`d4f8beb68ee21bc6d1d44c121f4b7d47ace9c003`; source bundle SHA-256:
`2d3cbd751c7ad9f68f288fae1dff371a81c0c1b2703524939f88deeecbad6247`;
attested runtime SHA-256:
`2a05b563bc14160b1122f38fcc67f00fb6eb763279a4c6b583df2e4111a0192c`.
The UI remains on the verified wallet release.

The read-only candidate passed strict parity (102 checks, zero errors) and the
ledger consistency audit at 968786. Receipt hashes are respectively
`b12d62d1e0f3a509bb84c72b9fb815b0662f4aafb09a82ec3fe61551b699fcd6`
and `e455027c62aa5989dd1cb839a9d836f5cfdeecc12c809a5e20b74a5f068c658c`.
Candidate wallet receipt SHA-256:
`56843f5e814915fa31f7d9715b7d6def836dfd51289c6a7b90654fa81f2973d9`.

The live wallet check initially returned 503 while block 968788 and its summary
were catching up. Once the checkpoint was current, the fresh authoritative
wallet passed with 123 unique reservations, exact reservation sum, conserved
confirmed-minus-reserved spendable balance, and pending-listing reserve
`364405703` subatoms. Successful live wallet receipt SHA-256:
`6fbfd4818f55f702c1feefc71513e7037137706cf87613b69b00c09be634fe02`.
Production readiness was true with zero lag at 968788. SQL verified the same
46 INCB mints and supply `224847713398447926`, with no target mint. The compiled
scoped proof pin remains null; this release did not perform the data repair.
Core/database services and the independent historical replay remained running.
Durable cutover evidence is under
`/data/proofofwork-incb-guarded-cutover-f4ca769e9202-20260927T055111Z/cutover`.


## H968124 checkpoint validation

The isolated replay reached H968124 after completing the 965783–967782 batch
(2,000 blocks, 592 protocol transaction IDs, zero skips) and the following
342-block batch. The retained first-batch continuation journal SHA-256 is
`145f05db462b0491bb492adfd9c9968b4631fb857e711c7c8f1f23396a819d9f`.
An extra pre-barrier summary probe stopped safely because the derived WORK
balance table still reflected the start of its batch. Both projections contained
the same 228 WORK transfers and 84 sales, and listing reconciliation passed.
The existing guarded, WORK-only balance synchronization resolved this mismatch
without changing the replay checkpoint. This was an orchestration-order issue;
no parity guard was removed and production was unaffected.

The repeated probe passed WORK holder reconciliation and exact native WORK
value `840950469793071163780428513`, but the historical INCB baseline check
correctly refused to compare independent replay totals to the old production
46-mint totals. All 24 other ledger checks passed. The replay profile now derives
its exact expectation from green snapshot `6838bcd9ef74c5b9b408ca2f` at 963781
(source-row file SHA-256
`dc478211126a97ff58aa929062b6643792c907fb51ad52ac5ffe573b47ce4a22`)
and the independently verified `b00b9451…` component fixture at 963782.
The resulting baseline has 47 mints, supply `210841722086821750`, direct units
`27932`, attached units `210841722086793818`, fixed value Q8
`21084172208682177064339629`, and issuance dust Q8 `2064339629`.

Selection requires the exact reviewed active replay binding and immutable
18-entry witness set. The source checkpoint, lineage and witness pins are
retained in the ledger check; stored-summary admission rejects tampering.
Ordinary production keeps its original baseline and earlier mint amounts.
Regressions cover the actual ledger check and stored-summary validator,
including unchanged production admission, false zero, wrong witness/checkpoint,
and one-Q8-unit discrepancies. The target proof remains disabled pending a
successful repeat and complete replay certificate.

The repeated H968124 probe passed all 25 checks on source
`e2c4610072563f9ea19e5b1f67941bcbfb83cde8` (tree
`66326668ea8b4b23700be4a1a710f11d2af5e853`, source archive SHA-256
`3932bc9360922b6cf6569bba53ac10e4e908b733d630ee2b5b1d5f3ac934c998`).
The 3,210,164-byte probe response SHA-256 is
`09c8682711bf805d9b1f4307509f9d3477fd0fbc173b0127f9e262e5bbf2857c`.
The replay then processed block 968125 successfully at
`2026-09-27T08:16:26Z`. A read-only query found exactly one target mint,
amount `720814688394061543`, fixed value Q8
`72081468839406154352608158`, and H-1 snapshot
`a15d16ce2b3bc363ac1ed091`. The replay is continuing to its captured tip to
complete the witness certificate; this intermediate success is not production
repair authorization evidence by itself. At production height 968807, health
remained ready with zero lag, 46 existing INCB mints, unchanged supply
`224847713398447926`, and no accepted target mint.

The actual stored H-1 row also passed the complete post-V5 import validator.
Its raw artifact is 3,407,385 bytes, SHA-256
`6e1aaec23312e2f86d70f0fa9cf8aeb9e110123209882be05db100a05004ae25`;
the row without its terminal newline hashes to
`c367fb109738073cd55d36bc4bebb7a4f8f418f16e935aaf64610b3ddfa67250`.
The later completed-proof export must match this independently captured row.

A fresh production backup completed at `2026-09-27T08:33:05Z`, before repair:
`/data/proofofwork-incb-production-backup-20260927T082400Z/production-before-scoped-repair.dump`.
It contains 20,256,103,254 bytes, SHA-256
`ed251ef8b7ce69166f42e351c59f3bb55cd15002598f6187e989d6f95d3a2932`;
its restore catalog was verified. The original rehearsal backup and all replay
evidence remain retained.

Before the final rehearsal, insertion-path review identified a noncanonical
side effect: the normal event upsert refreshed the confirmed parent transaction's
observation timestamps. The scoped repair now selects and verifies that existing
canonical parent without any transaction-row write. Admission is restricted to
the pinned target, its exact confirmed block position, INCB mint kind, and
canonical raw transaction marker. The actual selector and insertion routing
regression reject missing, duplicate, foreign, pending, or mismatched parents;
all 548 recovery behavior checks pass. Ordinary ingestion is unchanged.

## Preserved-witness completion guard

The 968806 completion attempt correctly stopped at 968805 because ten preserved
pre-V5 INCB payloads had been normalized during replay. Their amounts, exact Q8
values, and H-1 bindings were unchanged. Differences were limited to the empty
precision annotation, `historical-q8` versus `send2`, string versus integer payment
representations, and synthetic `protocolVout` / `recordOrdinal` annotations.
The immutable 18-entry manifest and the byte-for-byte completion guard were not
changed or bypassed.

A clone-only, hash-pinned operator restoration restored the original ten payloads
from that manifest. It refused any other payload difference and preserved every
physical event position and every other event column. It was hard-bound to
`proof_indexer_final_replay_clean` on private Unix socket port 65447, the exact
active verifier binding, and checkpoint 968805. It verified each historical
block and predecessor against Core. Production was not a possible target.
The same transaction in rollback mode passed before apply; apply changed exactly
ten payloads and repeat changed zero. Balances, issuance sums, native state
commitments, protected snapshots, the canonical fault state, and the rebuild
marker shared unchanged critical-state SHA-256
`d635d10c2d352a970d46268ee3076f558d08f5fe2d919a5428622b47597a2044`.

Retained directory:
`/data/proofofwork-incb-final-source-replay-20260925T022000Z/witness-restoration-20260927`.
Helper SHA-256: `8ab387a41cffad9f2873f6466625cd1ab6ff25a9c8e4c581be02679fa3b84438`.
Diagnostic SHA-256: `8f4a63f64125b955f21999c0f321cf728605d735f6637925030198e5ee884da2`.
Rollback receipt SHA-256: `2de33c44774105123028942641aa0f08dbd4f103ed16738662eee1ce9a6fa464`.
Apply receipt SHA-256: `90fbd0bab1a2521d7748ce6182fe01862a5f27a61706b2595f6cfa8710fe4b7b`.
Repeat receipt SHA-256: `ef25aacf3086f9a18513fa5ef72338cf6142b56f11c7a24c6f7458154f976054`.
The remaining blocks are then processed with the unchanged pinned `e2c4610`
source and unchanged certificate validator. The completed proof must include
this restoration's exact evidence and receipts.

The next completion attempt passed the preserved witnesses and stopped at
968820 on the first post-V5 rederive entry. The immutable legacy manifest had
recorded `attachedWorkAmountAtoms: "0"` for both send3 bonds; the old completion
predicate incorrectly compared that field to the real converted Q8 alias.
Completion now requires the exact known Q16 path for these two entries: one
confirmed parent, one accepted send3 WORK transfer, one combined mint, matching
physical positions, the parent's exact Q16 attachment, correct unit metadata,
and the independently pinned direct/attached issuance and H-1 values. The two
entries cannot fall back to the legacy Q8 predicate. No manifest or mint amount
is changed. Real captured projections are retained in the regression fixture;
tampered amounts, one-Q8-unit value changes, incorrect precision/positions,
missing or duplicate companions, and foreign targets fail. All 549 recovery
behavior checks pass.

## Completed certificate and scoped proof activation

The isolated replay completed through 968821 with source
`ac488b093fceacbcfa6aaeb59d04c79bd9359241`, tree
`9f3a02234e48ae73c3055239fc9ef25de2f2df51`, archive SHA-256
`b423f2de2dd36959e40ac14560749ca70a3070dfa7571b6e64b41a9abe0d7a93`.
The certificate accounts for all 18 witnesses: ten preserved byte-for-byte and
eight rederived. It includes the exact clone-only restoration evidence above.
The independent local review passed the full 25-check H-1 validator, verified
the sealed-wrapper round trip and confirmed that the raw source artifact matches
the previously captured 3,407,385 bytes. Production native H-1 commitments match.

Completed proof SHA-256:
`09b6440d3eb2b30483e5baae1b21a6511edfd23604d03cbab9e89c587cde00ed`.
Retained export:
`/data/proofofwork-incb-final-source-replay-20260925T022000Z/scoped-target-proof-ac488b0`.
The source now pins this proof for only `ebe60fd1…`; stored-proof absence still
fails closed. Production has not yet been repaired. The next gate is the
production-copy rehearsal, including strict preservation of all 46 older mints,
all unrelated history and native accounting rows, and repeat-apply idempotence.

## Pinned production-copy rehearsal and node release

Commit `bf81f9cffcc7df2165e011e36543420a9f10066b` (tree
`639ea2fe7202caad2776be5861d78bc5e88b87ba`) pins the completed proof.
PR 81 merged as `819f0d8c380498ce658d503989e6e42d0527e3ac`; all three CI
checks passed. Scoped-oracle, post-V5 repair, H-1 import and hygiene checks passed.

In the isolated production copy, import dry-run rolled back, apply inserted
one sealed oracle, and repeat inserted zero. Repair dry-run rolled back; apply
added exactly one mint and removed exactly two invalid aliases; repeat returned
`already-applied`, changing zero rows. The helper's API shutdown initially
misidentified its exited but unreaped child as running. The systemd unit exited,
and independent socket, process and database checks proved it was stopped.
Publishing uses a separate start process so the unchanged stop verifier sees a
reaped process. The application source and repair receipts were unchanged.

The full before/after comparison passed: 46 older mint rows, all unrelated
transactions/events/participants/references, token definitions, WORK balances,
credit listings, native accounting rows and retained snapshots were byte-for-byte
unchanged. Pending INCB deltas were conserved. Only the target recipient gained
`720814688394061543`, yielding 47 mints and supply `945662401792509469`.
The earlier missing bond was not repaired. The sealed oracle was added and
380 recognized derived summaries were invalidated; historical evidence remained.
Before inventory SHA-256:
`86e25a35c1c37c37c7d53a954b30884e1f78ec0468259d222526d24ce9d20fd8`.
After inventory SHA-256:
`b56400da70bdf4191867d46798ed5c70b726d9e224df1455af853efe57eee1a0`.

The exact candidate passed strict parity (102 checks, zero error-level failures;
two preexisting historical V5 warnings), ledger consistency, and wallet
conservation for 123 distinct reservations. Parity SHA-256:
`cb32960fd98f61081b24e863ec766a7e627bea2255f61f7180e9169dadc2778c`;
ledger SHA-256:
`133649db9eb716a38156d98c2db01620e4df599f38ecc3c56a3a43748b62c4d9`;
wallet SHA-256:
`61078efc00a70ff048fa751f51ce08389d8a6870b8a24d9d7d413b7e463934bc`.

Node release `bf81f9cffcc7-20260927T093457Z` has runtime SHA-256
`89a5290570f36fa0298262ff9c46cfc60b77c44baa0b6b9237f5d5bb851cb523`.
Its first cutover rolled back automatically because the archive publisher
requires the seven-character commit in its request filename. The corrected
retry deployed the same attested source successfully at `2026-09-27T09:42:06Z`,
with ready health and zero lag at 968821. Both attempts and rollback receipts
are retained under
`/data/proofofwork-incb-guarded-cutover-bf81f9cffcc7-20260927T093457Z`.
Core and PostgreSQL authority services were unchanged. This code-only deployment
did not yet apply production issuance.

The rehearsal summary gate exposed a reader incompatibility before production
repair: the exact Q16 mint includes the lossless Q8 compatibility alias that the
reader itself emits, but its input validator rejected any simultaneous alias.
The reader now accepts that alias only when exact integer division reconstructs
it without rounding. Q16 remains the authoritative quantity. Conflicting,
noncanonical, fractional, missing-primary and mixed-model fields remain rejected.
Regression coverage reads both real post-V5 fixtures and round-trips the exact
projection; no mint payload or issuance amount is rewritten for this fix.

## Reader correction and final repair admission

Reader correction `9d04fd3cf1f69d0f37aae558667e5c2e61eafe86`, tree
`3109ca01196d5dacb6d7a8219a50e1d2fd48d02f`, passed 550 recovery checks,
exact accounting, scoped-oracle/post-V5 repair checks, server globals and hygiene.
PR 82 merged as `6512c77b813177aaac88141f7690ce70c147ba42` after all three CI
checks passed. Its immutable rehearsal archive SHA-256 is
`15ebb4c7039ee68209b194b2200060640f95df20b34212faa29892533722441e`.
The already inventoried production copy then passed all 25 fresh ledger checks
and published a fresh summary. Ledger receipt SHA-256:
`780889f8f26504843275b8c3d1bfcbafa1435d7ebf404adce7ad0ffd6904b998`;
summary publication receipt SHA-256:
`07f6e79dc2844ea4107f0db09c4185fa3fd00ce15c86a5de1a331ce6373a26e6`.
No additional rehearsal issuance changes were needed.

Final node release `9d04fd3cf1f6-20260927T094716Z` has runtime SHA-256
`b964b923cea303ec331581469ac57bc8dd3d1b090218ddf4800a8a5275d206b6`.
Strict candidate parity passed 102 checks with zero error-level failures.
The ledger audit initially observed the arrival of block 968822 and failed
readiness at one-block lag; the unchanged audit passed after convergence.
Gate hashes: parity
`0ec28cb22cc55ff09c2e95bdfea7771879885eb717152127e9c7db06ab054158`,
ledger retry
`894d56b9e7561ec327e0238afc5f7e3b1d3a2d3ece3ce97c416dab0d7104d5f5`,
wallet
`0f84cb2df3b52488a6e85f0ca6b58be7fa01199273bcb0305bb765cb37824bfb`.
Atomic cutover completed at `2026-09-27T09:52:50Z`, with ready zero-lag health
at 968822. Evidence remains in
`/data/proofofwork-incb-guarded-cutover-9d04fd3cf1f6-20260927T094716Z/cutover`.

An initial production maintenance attempt stopped before inventory or any
database mutation because the helper expected a MainPID property on the
WireGuard socket unit. Services and timers were restored and readiness verified.
The corrected helper treats an inactive socket's absent PID as zero, retaining
the same inactivity requirement. Failed-attempt evidence remains in
`/data/proofofwork-incb-production-repair-9d04fd3-20260927`; retry evidence uses
`/data/proofofwork-incb-production-repair-9d04fd3-20260927-retry`.

## Production single-target apply

The corrected maintenance controller validated the retained backup digest,
stopped application readers/writers and selected timers, and captured production
at block 968823/hash
`000000000000000000017ab807def9c15e6e87433d77e0a1fdf0a5850051c90e`.
Production retains its ordinary completed recovery from 948000/bootstrap 947999;
the clone replay certificate was not copied into its recovery marker.
Before inventory SHA-256:
`d2244dc6294cf35f60608e608f3d377fef6bcf378541b65f491283e72c74e446`.
The 9,203 native transition rows hash to
`1a9543bb466a29b8b63929bc853fc6bd18afccd8115829dd32d5aa4a1b2de0d4`.

Production proof import dry-run rolled back; apply inserted one sealed oracle;
repeat inserted zero. The issuance dry run passed. Apply added exactly one mint
for `ebe60fd1…`, removed its two invalid reserved-namespace aliases, and
invalidated 379 recognized derived summaries. Supply changed from
`224847713398447926` to `945662401792509469`, exactly the target issuance
`720814688394061543`. Repeat returned `already-applied`, `changedRows: 0`.
Apply JSON receipt SHA-256:
`16c420410af3386befbc654ab17df64073ed99f5a2429c14f35e77df048ca127`.
Repeat JSON receipt SHA-256:
`baea86abac121877ccc3d0ff00289da3088dc07d3d15d7c82a3081608386fe5f`.
The recovery-marker fingerprint remains
`d25e8d3d1eda55853667eb2bff5799ebd6c721688f203432762230997d381eb2`.
Readers remain closed pending the independent full after-inventory and fresh
summary checks; these apply receipts alone are not completion evidence.

## Final production verification

The independent full comparison passed. Every older mint and every unrelated
transaction, event, participant, reference, definition, balance and credit
listing matched the before-inventory. All 9,203 native transition rows were
unchanged, as were retained snapshots and pending INCB deltas. The only balance
increase was the exact target issuance to its canonical recipient. The earlier
`b00b9451…` bond remained untouched. After inventory SHA-256:
`1f739463a03117a26e61cb154c54febbae7107f978b4f559c0c3c4bbb0665873`.
The recovery marker stayed unchanged through repair and fresh-summary publication.
Normal forward indexing resumed only after those checks passed.

The repaired fresh summary passed all 25 consistency checks, SHA-256
`7564d81a8e730ecccfab38fc5f2d928aeea26391d8cb11c9a8b5a7594653acc8`.
Services and timers returned to their exact prior active/inactive states. Core,
Electrum and PostgreSQL authority processes were preserved. Production reached
ready, zero-lag height 968825 with no active canonical fault or worker failures.
The complete controller exited successfully.

Public Inception verification passed on its first attempt: 47 confirmed bond
actions, 46 attached-WORK actions, exact supply `945662401792509469`, and fixed
issuance value Q8 `94566240179250949146190218`. The target history contains exactly
one confirmed mint, amount `720814688394061543`, fixed value Q8
`72081468839406154352608158`, direct issuance 546, attached issuance
`720814688394060997`, and H-1 snapshot `a15d16ce2b3bc363ac1ed091` at 968124.
The public response is coherent, ready, current and green on all 25 checks.
Public Inception response SHA-256:
`816752d6371d8e7c33b0486ed210aa38c23a42a231d0d8831f2a8057f6216c74`.
Public target history response SHA-256:
`cadccb32a37fe5ff65d1331661d8cb40ec200b0db747a59063731ecf3eda2a5c`.

Final live wallet verification at 968825 confirmed 123 distinct reservations,
exact summed reserves, confirmed-minus-reserved transferable balance, matching
checkpoint hashes and conservative pending-listing reserve `364405703` subatoms.
No signing or broadcasting was used for this verification. Final strict live
parity passed 102 checks with zero error-level failures, retaining only the two
preexisting historical V5 warnings. The full ledger audit passed, including
INCB supply/fixed-value conservation and WORK/Growth value agreement.

Final evidence digests (SHA-256):

- `post-parity.log`: `0adc4e6ef2f04e507b110ed78967b24da6a40011988ac93dd39f8ed4cf3f8f99`.

- `post-ledger.log`: `5c8841f7bce569e48cbcb64734d54795a391e488258780a8f12a4065298ced8d`.

- `wallet-final.json`: `74cf3a05dbbfbd8569b4dce261b8dea46469293bed62f1be590315195fc0d3df`.

- `comparison.json`: `5fe7939195b9fdf8ac36caf68482b614d6d98c7269945056aece5c0e39635b21`.

- `repair-complete.json`: `6403ac8f46113a9031d0d0d50c52d3d59eec75163e8a5dff3bdbf1f7e8b14907`.

- `production-after.json`: `09548bb56bf4960fe84f6d652a899b0fbfdb12b1c5d331890ebfcacfcbfca4ec`.

- `timers-restored.json`: `53366cc21035bd312d89656e86ae89ffb7b22f9318b00c88be4259ccb8accacb`.

- `summary-publish.json`: `07cd155f47e2d4aefd23253cfe9e4fd4c4d80d77bcdbb513c91fb309b388e541`.

All operator receipts remain under
`/data/proofofwork-incb-production-repair-9d04fd3-20260927-retry`.
The verified production backup, independent replay proof, original immutable
witness manifest, failed-attempt evidence and source archives remain retained.
The UI release remains `b752518bf8b4-20260927T014804Z`; the final node release is
`9d04fd3cf1f6-20260927T094716Z`. No user wallet transaction was signed or broadcast.
