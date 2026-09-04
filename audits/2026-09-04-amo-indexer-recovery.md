# AMO Indexer Recovery Audit

Date: 2026-09-04

## Scope And Approval

The user approved a separate `amo-indexer-recovery-2026-09-04` branch from
`origin/main`, a representation-only ID sale-authorization serialization fix,
regression tests, audit documentation, commit/push/merge, service restart,
data rebuild if evidence requires it, and production deployment.

The approved boundary expressly excludes changes to protocol rules, arithmetic,
fees, wallet signing, canonical ID behavior, and marketplace settlement.

## Incident

The public AMO summary returned HTTP 503 and the UI displayed zero-valued market
metrics while no authoritative summary was available. Production health showed:

- Bitcoin Core, Electrum, PostgreSQL, and disk checks available;
- canonical block-scan checkpoint height `965473`;
- observed Core tip height `965493`;
- worker retries stopped at block `965474`; and
- the internal WORK AMO block verifier returned HTTP 500 with
  `Canonical AMO sufficient state contains an unsupported value.`

The zeros were therefore not market truth. They were a separate client
presentation defect over a correctly fail-closed server response. The UI
modernization branch owns the Loading / Ready / Unavailable / Last Verified
repair and HTTP 503 regression coverage.

## Root Cause

`parseWorkAmoV5IdSaleAuthorization()` normalized five absent optional fields to
own-properties whose value was `undefined`:

- `anchorSignature`;
- `anchorTxid`;
- `buyerAddress`;
- `expiresAt`; and
- `receiveAddress`.

`structuredClone()` preserves those own-properties. When the parsed ID listing
entered the canonical raw ID sufficient-state preimage, the canonical JSON
serializer correctly rejected `undefined`. This stopped the atomic block replay
before checkpoint advancement.

Ordinary JSON transport had historically omitted those values. Omitting them in
the normalized in-memory representation therefore restores the already intended
closed JSON shape; it does not reinterpret an authorization or change its signed
bytes, matching rules, validity, or economic effect.

## Remediation

The parser now conditionally includes each optional field only when its existing
validation produced a non-empty value. Required fields and every existing
validation condition are unchanged.

Regression coverage decodes an actual `pwid1:list5` carrier, proves that the
parsed authorization contains no own-property with an `undefined` value, and
passes the result through `workAmoV5RawIdStateCommitment()`, the same canonical
state-commitment boundary that failed in production.

The canonical serializer was not weakened. Unsupported values elsewhere remain
fail-closed.

### Second fail-closed representation layer

The first merged recovery release passed the formerly failing canonical-state
serialization boundary. Replay then stopped, still before committing block
`965474`, at transaction
`0d966b98ae7672e7812db99ad41ecba5e97697b8f70f814da73f267492b7a649`
with `Canonical AMO prepared-item binding is invalid at 965474:3819:1:0.`

The block-scoped ID verifier returned exactly one canonical `id-list` item at
that position, with the transaction txid as its listing ID. The independent raw
preparation path instead assigned `parts[2]` to every ID marketplace action.
For `pwid1:list5`, `parts[2]` is the Base64URL-encoded sale authorization, not a
listing reference. The raw and verified items therefore failed identity
matching; the verified item and an unmatched invalid raw sibling both reached
the binder with the same canonical position, where the duplicate was correctly
rejected.

Raw preparation now uses the carrier transaction txid for `list5` only.
`seal5` and `delist5` continue to use their explicit referenced listing txid.
This changes no decoded authorization, replay outcome, protocol rule, fee,
signature, canonical ID, or settlement behavior. It only gives the raw
preparation object the same listing identity already used by canonical replay.

The production-shaped regression uses the observed block, transaction,
position, and a `pwid-sale-v4` authorization. It proves that raw preparation
sets `listingId` to the carrier txid, canonical recovery consumes the raw item
exactly once without manufacturing an invalid sibling, and replay binding
produces one bound item at the original position.

## Recovery Plan

1. Prove the focused parser and raw state-commitment regression locally.
2. Run the broader WORK AMO, precision, recovery, API-truth, and hygiene gates.
3. Stage and attest the exact merged node release with a preserved rollback.
4. Restart the API and worker on that release.
5. Allow the worker to resume from the existing hash-bound checkpoint.
6. Require the checkpoint to pass block `965474`, reach the current Core tip,
   publish a coherent canonical summary, and restore green health.
7. Rebuild derived data only if the unchanged checkpoint cannot resume and new
   canonical evidence proves a rebuild is necessary.

No checkpoint rewind or projection rebuild is justified by the current
evidence: the failing block was never committed and the existing checkpoint is
canonical.

## Verification Record

At the initial local remediation checkpoint:

- `npm run check:work-amo-v5`: passed;
- `npm run check:work-amo-v8`: passed;
- `npm run check:work-precision`: passed (131 checks);
- `npm run check:index-recovery-behavior`: passed (492 checks);
- `npm run check:api-truth`: passed;
- `npm run check:live-data`: passed;
- `npm run check:server-globals`: passed;
- `npm run check:canonical-order`: passed;
- `npm run check:hardening`: passed;
- `npm run check:client-read-containment`: passed (43 checks);
- `npm run build`: passed (expected bundle-size warning only);
- syntax checks for both changed JavaScript modules: passed;
- `git diff --check`: passed; and
- first production recovery release: cleared the unsupported-value failure,
  then failed closed at the separate prepared-item identity mismatch described
  above; checkpoint `965473` remained unchanged; and
- follow-up production-shaped index-recovery suite: passed (493 checks).

### Production recovery verification

The two representation fixes shipped through pull requests `#47` and `#48`.
The exact merged recovery release was commit
`339ba3a71ba5f36cb64f4f7c52e01c4a0385fe90`, tree
`4369a862d59420ba084b988059f5070c72a592c7`, with release archive SHA-256
`4bc18861f6a7463621106ba22a8f48d66b5083f749ec34eac5d4edd99c7e1742`.

After restart, the unchanged canonical checkpoint resumed, crossed block
`965474`, and reached the Core tip. At the recorded verification checkpoint:

- public health reported `ok=true`, `ready=true`, and `available=true`;
- block scan and every required summary root were at height `965496`;
- lag was zero blocks and the checkpoint was canonical;
- snapshot ID was `2c44ce3f23fe3824f4001bfc` at block hash
  `000000000000000000002d40ebedd188a84a4f4218743269477f36df02beb883`;
- the worker reported a successful cycle at
  `2026-09-04T15:56:30.912Z`;
- the fresh marketplace summary returned HTTP 200 with canonical data;
- the production ID audit passed with 563 records fetched, 561 confirmed,
  two pending, six active listings, four sales, and exact lifecycle parity;
- the production credit-mint regression passed with confirmed POW supply
  `1,525,100 / 10,101,010` and confirmed WORK supply
  `21,000,000 / 21,000,000`, with no pending supply; and
- the production indexer parity audit completed successfully.

No checkpoint rewind, row deletion, or data rebuild was required.

### Bounded WORK summary count hardening

The post-recovery full marketplace regression exposed a separate read-model
error: the marketplace summary reported 582 open WORK listings while the
scoped WORK summary reported 550. Read-only PostgreSQL and Core-authority
checks proved that 582 is the canonical count:

- 608 unique V8 lifecycle rows were present: 40 `active`, 547 `sealing`, and
  21 `delisted`;
- Core reconciliation proved 26 spent anchors and 582 unique unspent anchors;
- the active inventory was 543 sealed listings plus 39 unsealed listings; and
- the canonical stored summary correctly declared 582 open and confirmed
  listings with zero pending listings.

The stored summary intentionally materialized only 550 rows: all 543 sealed
listings plus the latest 40 ordinary rows, where 33 of those recent rows were
already sealed and seven were unsealed. The remaining 32 older unsealed rows
remain available through paginated history. A read-time
`forceScopedWorkListingCounts` option incorrectly replaced the declared total
with that bounded preview length and falsely cleared the continuation flag.

The hardening removes that unsafe read-time rewrite. Stored aggregate counts
and `collectionHasMore.listings` now survive summary reads, while the existing
same-checkpoint anti-shrink guard remains unchanged. The production regression
oracle now uses the Core-reconciled listing history total and authority counts,
not a bounded materialized array length. This changes representation only; it
does not add, remove, open, close, seal, or settle any listing.

### Canonical summary recut and complete-authority hardening

Production verification of the first count hardening found one additional
presentation boundary. The stored canonical WORK summary was already correct
at snapshot `ac83f851be20a9f757a8b52f`: 582 confirmed open listings, zero
pending, 550 visible preview rows, and `collectionHasMore.listings=true`.
However, the public scoped summary wrapper reapplied the historical WORK V2
cutover to that already-cut-over bounded snapshot. The cutover correctly
recomputed a full state, but on a summary preview its only available array had
550 rows, so the wrapper collapsed the preserved 582 total back to 550 and
cleared the continuation flag.

At current post-V2 livenet checkpoints, the read policy treats a `summaryOnly`
payload as already cut over only when it carries the exact canonical WORK V2
activation marker. At a post-V8 checkpoint, every materialized WORK row must
also carry the current V8 authorization; a V2 marker cannot revive a legacy
listing. Pre-activation and non-livenet behavior remains unchanged. Unmarked,
malformed, legacy-row, and full-state current payloads continue through the
existing cutover and policy path. A production-shaped regression runs the real
V2 cutover implementation
against a 550-row preview with a declared total of 582: the valid marked
summary retains 582/550/`hasMore=true`, while the same unmarked shape is
deliberately recut to 550 and `hasMore=false`.

Fresh scoped WORK responses had a related evidence defect. They reconciled only
the visible preview with Core and could therefore attach internally consistent
authority for 550 inputs while the complete lifecycle contained 608 anchors.
Fresh reads now obtain the existing complete, checkpoint-bound listing-history
projection, which validates the full relational materialization, canonical V8
witnesses, and every anchor through Core. The response remains bounded to 550
rows but is accepted only when:

- the summary, relational projection, and Core evidence share the exact block
  height and hash;
- Core checked all 608 lifecycle anchors and the projection accounts for its
  582 unspent protocol-active listings;
- private, non-response membership sets prove the complete relational input,
  Core-unspent set, and protocol-active subset with unique canonical IDs;
- the scoped token, stats, totals, preview size, continuation flag, and pending
  count components agree before authority is attached; and
- the complete source, scope, membership cardinality, and authority model are
  explicit.

The complete Core sweep includes mempool spends. A confirmed preview row is
removed only when it is present in the complete relational input and absent
from the Core-unspent set. A row missing from the complete input, or one that
is Core-unspent but excluded by current protocol policy, fails closed. Because
the bounded summary does not carry a full-membership digest that binds its
aggregate ask to the complete Core-authority set, fresh authority binding
clears the aggregate ask aliases. Listing rows remain available, while no price
is retained from an unproved source membership. Pending listings and their
counts remain the checkpoint projection; they are not represented as confirmed
Core-authority members.

Identical exact-checkpoint authority reads share one in-flight sweep. Successful
envelopes may be reused for at most 15 seconds in a dedicated two-checkpoint
cache; expired and older checkpoints are evicted, failures are never cached,
and there is no stale fallback. Any missing, partial, mismatched, or raced
evidence returns HTTP 503 with
`CANONICAL_WORK_LISTING_AUTHORITY_UNAVAILABLE` instead of presenting a
preview-sized proof as complete. This is a read-model representation and
evidence change only; protocol rules, arithmetic, fees, signing, canonical IDs,
and settlement remain unchanged.

### Scoped summary follow-up local verification

The completed read-layer candidate passed:

- JavaScript syntax checks for the API and behavior suite;
- `npm run check:index-recovery-behavior` (496/496 checks);
- WORK marketplace V2 and AMO V5, V6, V7, and V8 contracts;
- WORK Q8 and Q16 precision contracts;
- API-truth, live-data, hardening, canonical-order, server-global,
  client-containment, worker-containment, node-operations, and bond-arithmetic
  contracts; and
- the production build, with only the existing bundle-size warning.

Read-only external baseline checks for Credit minting and Mail also passed. The
workstation candidate could not run the environment-bound marketplace suite
because it intentionally has no production PostgreSQL/Core credentials; its
local API returned `CANONICAL_INDEX_UNAVAILABLE` before marketplace assertions.
The exact merged release subsequently passed the full marketplace gate inside
the production node environment, as recorded below. The unrelated live
send-preparation fixture currently reports zero confirmed UTXOs for
`armyofyouth`; that external fixture drift does not exercise this read path.

## Change Log

### 2026-09-04 — Local recovery candidate

- Isolated the fix on `amo-indexer-recovery-2026-09-04` from `origin/main`.
- Omitted absent optional ID sale-authorization fields from the parsed object.
- Added a carrier-to-canonical-state regression reproducing the failure lane.
- Preserved protocol, math, fee, signing, canonical ID, and settlement behavior.
- Data changes applied: none.
- Production changes applied: none at this checkpoint.

### 2026-09-04 — Follow-up list5 preparation correction

- Confirmed the first serializer correction reached the next replay stage in
  production without advancing or partially committing the failing block.
- Compared the one-item block-scoped ID verifier response with raw preparation
  for the exact failing `pwid1:list5` carrier.
- Corrected raw `list5` listing identity from the authorization field to the
  carrier transaction txid while preserving referenced IDs for follow-on
  actions.
- Added an end-to-end preparation, recovery, and replay-binding regression for
  the observed production position.
- Rebuild required: no. The canonical checkpoint remains safe and resumable.

### 2026-09-04 — Production recovery and summary count hardening

- Deployed the exact merged recovery commit and preserved its rollback release.
- Verified canonical catch-up through the formerly failing block and to the
  current Core tip with all required summary roots aligned.
- Confirmed the 582-versus-550 discrepancy was a bounded-preview count rewrite,
  not duplicate inventory or a protocol-state inconsistency.
- Preserved the canonical 582 total and the true continuation flag without
  changing any marketplace lifecycle record.
- Added a production-shaped 582-declared / 550-materialized regression and
  corrected the production marketplace oracle to use authoritative totals.
- Rebuild required: no.

### 2026-09-04 — Scoped summary and fresh-authority follow-up

- Proved the stored canonical WORK summary was already 582 total / 550 visible
  at the production checkpoint and isolated the collapse to a second read-time
  cutover.
- Prevented exact marker-bound bounded summaries from being cut over twice.
- Bound fresh scoped WORK responses to complete relational and Core authority,
  while keeping response rows bounded and paginated.
- Added production-shaped count, continuation, preview-only-authority,
  checkpoint, three-set membership, V8 marker, mempool-spend, bounded-cache,
  ask-invalidation, and count-component regressions.
- Rebuild required: no. No canonical data mutation is part of this change.

### 2026-09-04 — Complete-authority production release

- Merged pull request 50 and released exact main commit
  `432c01581e5e2987e26a3190be2817c7bddc6470` as
  `432c01581e5e-20260904T174541Z`.
- Preserved the prior checkout at
  `/opt/proofofwork-api-stage-432c01581e5e-20260904T174541Z`.
- Published
  `proofofwork-node-release-432c015-432c01581e5e-20260904T174541Z.tgz`
  with archive SHA-256
  `f977f5aa7e3a6f2ccff286866e337ec2e495f51de7d8fe4f9f44407b774a084c`
  and runtime SHA-256
  `99e504fa0355fcdd51b98b6de03c3c64ce371385c9493d97f1ac7282be37ad7d`.
- The atomic checkout exchange completed once. Initial archive publication
  then failed closed because a post-exchange status read recreated
  `.git/index` with mode `0664`. Services remained stopped, the exchange was
  not rerun, the live tree was normalized to remove group/world write bits,
  and the same exact checkout passed publication before services restarted.
- Public and loopback health returned ready, available, canonical, and zero
  blocks behind at height `965504`, hash
  `000000000000000000017adb5d007cc51cbd1101bb16ab356b5546d2de7229b4`.
- Dynamic authority verification proved 608 complete lifecycle inputs, 582
  Core-unspent protocol-active listings, zero pending listings, 582 total open
  listings, a 550-row summary preview, and a true continuation flag. Public
  responses exposed none of the private membership arrays and did not retain
  an unbound aggregate ask.
- Full production marketplace convergence, ledger consistency, Mail, and
  Credit mint regressions passed. Ledger snapshot
  `f55ff9dac6a8f85d8128cc98` reconciled to
  `8115626634080169885.41580993` proofs.
- Recursive release attestation verified the live commit, tree, runtime digest,
  eight archives, and one current provenance record. The service retains its
  existing warning exit because `/opt` contains 17 historical node checkouts,
  above the bounded inventory warning threshold; current release provenance is
  valid and no historical checkout was deleted.
- Data rebuild required or performed: no.
- Protocol rules, math, fees, signing, canonical IDs, and settlement behavior
  changed: none.
