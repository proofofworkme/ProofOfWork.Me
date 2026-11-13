# Inception H-minus-one oracle incident, 2026-11-12

## Scope and evidence

The canonical worker stopped before committing block 975611. Bitcoin Core and
Electrs were synchronized; application summaries remained at 975610. The error
was `INCEPTION_POST_V5_MINT_PROJECTION_UNAVAILABLE`: the hash-bound H-minus-one
value differed from the raw AMO opening value. Capacity was not the cause.

Affected transaction: `d85af5ecde295bd696f231f3037403c4571fe92e93494154327a00583cb70c28`.
Core block: `00000000000000000001406c39449238d428dcdbee86d2ba8e75baf5a2d13fab`.
Predecessor snapshot: `b0c8ec784ac6a23a837a1c7d`, canonical summary hash
`50d6f74d91b824bbbe9fee76a68bdf7c19841ff9681f683e0df610ea3208ffac`.

Raw opening network value Q8: `9868667630681935556576036671`.
Authenticated public H-minus-one value Q8: `9868667630681953648576036671`.
The difference is exactly 180,920 satoshis: 34 DNS registrations contribute
170,000 and two listings plus two seals contribute 10,920. DNS was intentionally
added in the summary projection, not the raw accumulator. Existing code used the
raw opening for INCB and the current within-block state for the shared transfer's
frozen stamp, contradicting README's existing H-minus-one rule.

The first DNS event is at 969108. The database inspection found no confirmed
Inception bond after that height before this failing block. Retained comparable
summary evidence covers 67 rows from 975541 through 975610, all with the same
difference. It does not establish the first divergent historical summary.

## Correction contract

975611 is an implementation repair boundary, not a new protocol or economic rule.
All previously committed transitions remain unchanged. Before the boundary,
legacy raw replay is byte-for-byte unchanged. At and after it, every accepted
INCB parent requires an authenticated H-minus-one witness, including proof-only
bonds. Invalid candidates do not acquire an unnecessary oracle dependency.

The witness binds exact predecessor height/hash, green snapshot ID/content hash,
full Q8 network value, raw opening state commitment and exact DNS overlay.
Zero DNS is valid, including on another canonical branch. Current-block events
are excluded. The witness is committed in the transition chain and retained in
the transition payload. Normal snapshot pruning retains H-minus-one snapshots referenced by mint
issuance and directly by forward transition witnesses, including during event
recuts. These are required protocol evidence, not redundant backups.
Historical replay can use an archived witness only when
an independently authenticated canonical issuance checkpoint agrees; unavailable
or conflicting evidence fails closed. An archive alone does not reconstruct a
missing oracle; this fallback is conditional, not a claim of automatic recovery.
Legacy V5 migration explicitly refuses
modern witnessed transitions instead of silently dropping their witness.

The private first replay discovers accepted parents and precise shared-transfer
identities. The final replay alone is committed, freezes those movements at the
same H-minus-one value, and must reproduce the exact parent/recipient/transfer
attribution. Admission changes fail closed. No first-pass state is persisted.
DNS is not added to the accumulator, WORK movement is counted once, and fees are
not duplicated. INCB issuance uses recipient-aggregate WORK amounts: incremental
per-send issuance is the difference of rounded cumulative totals, preserving
aggregate semantics and subatom dust rather than rounding each send separately.
Each shared WORK movement retains its individually rounded Q8 frozen stamp. The
incremental recipient-aggregate attachment Q8 can include a carried remainder
and must not be described as that individual movement's standalone value.

## Qualification and limits

Actual Core serialized transactions, header, Merkle/witness evidence and prevouts
were replayed in an isolated process. The affected bond has 546 direct proof
satoshis and 1.8 million attached WORK. Correct INCB total is
`8458857969155960816`; raw-only valuation would yield `8458857969155945308`.
The replay input SHA-256 is
`cff22792686793f78219e24a117cb9c95fce091b5d54db0a08588e7d202e118c`.
The prior state commitment is
`def8fc6f9b0713424571d18ea93694a2da2a612b2c6cf014ebe12133ef1ddd8b`.

Raw arithmetic is not full integration qualification. Independent adversarial
review, authenticated API binding, isolated database materialization, historical
compatibility and both-order/multi-transfer fixtures are release gates. Results
and remaining limits must be appended before production approval. This document
does not assert production deployment, full audit completion or perfection.

No production data, historical records, evidence, ledger or protocol record was
edited for this investigation. The user's confirmed transaction must not be
resent. Existing last-good protections remain enabled.

### Additional qualification receipts

- Actual block 975611 replay with the production authenticated canonical summary
  reader passed; snapshot ID, canonical summary hash and exact Q8 value match.
  Corrected closing state commitment:
  `0a40612770988f58d73e664c0cccbe3dbdcbce93cc5d7baed382518c7798e17a`.
- Historical Core blocks 975605 (six protocol records) and 975610 (empty)
  produced byte-for-byte identical complete replay results in candidate and
  production legacy raw code. The predecessor commitment remains unchanged.
- AMO V5 and V6 checks pass. Wallet-capacity, WORK-batch and DNS raw suites pass
  all 36 tests. The independent actual-input adversarial suite passes 23 checks.
- The initial broad recovery run passed 548/553; the five failures were missing
  `recordPublishLinkedCapability` fixture dependencies in the preceding linked
  release, not production executions. They remain a release gate until repaired
  and rerun. Private API/indexer materialization is still in progress.

- The five fixture dependencies were repaired without production logic changes;
  the broad recovery suite now passes 553/553. The portable witness suite passes
  seven tests, including accepted proof-only, invalid parent, multi-send aggregate
  rounding, zero DNS, malformed witnesses and prefix protection. Its tested
  reverse-order carrier remains invalid with the existing PWM output-conflict
  reason; no protocol acceptance rule was relaxed to make that case pass.

## Separate restore-qualification finding (not the incident cause)

The prior logical restore passed its data/checksum checks. It was not qualified
for write admission: its semantically equivalent constraint expression has a
different catalog representation, so the exact native-storage signature guard
rejects it. This is a restore-qualification gap, not the cause of the live
Inception indexer stall, and does not invalidate the recorded data checksums.
The guard has not been bypassed or weakened. A faithful physical clone is being
prepared separately for full materialization qualification; raw/API arithmetic
success is not deployment.

## Emergency release scope

The emergency source branch is based directly on live source commit
`e2669bc1fd32eba625c1a65fb2a102ba6433fb7a`, not the unpublished linked/Growth
release. Only the oracle correction, required retention/replay guard changes,
portable tests and documentation are included. The earlier combined candidate
and its linked-release fixture repairs are separate evidence, not deployment
contents. On this minimal branch, all 553 recovery checks, 43 portable witness /
wallet / batch / DNS tests, and AMO V5/V6 checks pass without those fixture edits.
Actual runtime deployment must preserve separately accepted production overlays,
match the isolated physical-fixture runtime, and pass rollback/readiness gates.

## Physical-fixture finding and additional forward correction

The faithful physical clone matched production catalog and reached the real
API verification successfully, including exact INCB supply
`9404520723478393444` (above signed 64-bit range). Its first materialization
attempt refused before persistence: the application placed the aggregate mint
at body `pwm1:m:incb` output 2, while canonical raw PWM aggregation correctly
anchors the parent at its first subject carrier, output 1. The original mint
binding guard caught this; the checkpoint remained 975610.

The correction binds only forward witnessed application mint coordinates to the
unique authenticated direct-recipient raw child, then proves all existing
recipient, descriptor, parent, amount and snapshot invariants. Native raw
records and historical positions are not rewritten. Component validation also
recomputes cumulative Q16 recipient increments, rather than incorrectly
assuming each incremental issuance equals an independently floored send value.
Tampered or unavailable witness/component evidence remains fail-closed.

This is an additional material source correction beyond initially approved
commit 1023472. That commit has not been pushed or deployed. A successor must
pass full physical materialization and review and receive fresh publication
approval before production action.

The successor's local gates pass: 47 focused tests, AMO V5/V6 checks, and
553/553 recovery checks. All 17 declared CI test files report 119 passes,
zero failures and one explicitly skipped real-PostgreSQL wallet-coalescing
integration case. Safe private test copies preserve controller permission
guards; no production permissions were changed. The strict carrier helper also
passes against the captured real API item and native transition: only vout 2
becomes vout 1; issuance and authenticated component evidence remain exact.
Full persisted-block and subsequent canonical-summary tests remain mandatory.

## API pre-materialization discriminator correction

The exact successor physical test failed before persistence because the API
issuance mint is not yet a materialized event and lacked its `kind` discriminator.
The strict component binder correctly returned no eligible mint. Set the
canonical `token-mint` kind in the API projection before binding; no arithmetic,
oracle, recipient, coordinate or validation guard is relaxed. The new regression
executes the actual API mapping with a kindless issuance object, reproduces the
previous exact failure, and proves corrected mapping plus wrong-token refusal.
The physical API-to-database and rollback gates remain required.
