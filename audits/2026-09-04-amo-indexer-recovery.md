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
- production deployment: not yet performed.

Production results, exact release commits, checkpoint catch-up evidence, and
whether a rebuild was required will be appended after deployment verification.

## Change Log

### 2026-09-04 — Local recovery candidate

- Isolated the fix on `amo-indexer-recovery-2026-09-04` from `origin/main`.
- Omitted absent optional ID sale-authorization fields from the parsed object.
- Added a carrier-to-canonical-state regression reproducing the failure lane.
- Preserved protocol, math, fee, signing, canonical ID, and settlement behavior.
- Data changes applied: none.
- Production changes applied: none at this checkpoint.
