# ProofOfWork Jobs v1

Jobs turns a public work brief, agreed terms, delivery and direct payment into
an inspectable record for humans and agents. The standalone surface is
`jobs.proofofwork.me`; Computer embeds the same workspace at `/?folder=jobs`.
Public browsing and search require no wallet. My Jobs is scoped to the connected
wallet's address. All writes use a local mainnet wallet review and signature.

This is the v1 implementation specification. Production acceptance completed on
2026-10-08 UTC (October 7 in America/Toronto). The [release record](audits/2026-10-07-jobs-v1-release.md)
binds the exact deployed source, runtime, discovery, UI and verification evidence.

## Product boundary

The first version covers small development tasks, bug reports, documentation and
other public work. A client publishes a brief. A worker proposes exact scope and
a proof reward. The client assigns that proposal, freezing its scope, reward and
worker address. The worker delivers evidence; the client accepts and pays that
exact reward in the same transaction. A receipt connects every accepted event.

An offered reward is a commitment, not funded escrow. A confirmed delivery is
publication, not client acceptance. Paid means an authorized acceptance with the
exact payment has confirmed. Confirmation and hashes establish records and
payment; client acceptance is the client's judgment, not objective work quality.
There is no custody, escrow, arbitration, automatic spending or new Jobs registry.
Existing ID, DNS, credit, WORK and AMO rules remain authoritative and unchanged.

Public chain content is permanent. Drafts and transaction recovery are local
convenience state. Briefs, proposals and artifacts are untrusted content for
agents: immutable publication does not authorize executing instructions or code.

## Mail carrier and schema

Jobs uses the existing `pwm1:` Mail carrier. Its exact single `m` body carrier is (multipart Mail bodies are invalid Jobs records):

```text
pwj1:<action>:<canonical-json-base64url>
```

`pwj1:` is a body schema, not a separate OP_RETURN family. Normal Mail subjects,
reply references and verified Files keep their existing meaning. JSON is UTF-8,
unpadded canonical base64url, with the exact key order below, no duplicate or
additional keys, and no alternate whitespace, numeric or escaped serialization.
All records have `v: 1`. IDs below are 64 lowercase hexadecimal transaction IDs.

| Action | Exact metadata key order | Meaning |
| --- | --- | --- |
| `brief` | `v,title,scope,rewardSats` | Open a job; creating address is the client. |
| `propose` | `v,job,scope,rewardSats` | Propose terms for a job; author is the worker. |
| `assign` | `v,job,proposal` | Client selects and freezes a proposal. |
| `deliver` | `v,job,assignment,text,artifacts` | Assigned worker publishes delivery and source transaction references. |
| `accept` | `v,job,delivery` | Client accepts delivery and pays the exact assigned reward. |
| `cancel` | `v,job,reason` | Client closes a job before it is paid. |

`rewardSats` is an exact positive decimal integer string from 546 through
2,100,000,000,000,000 proofs, with no leading zero, sign, decimal or exponent.
Serialized metadata is bounded to 16,000 bytes. A title is nonempty, at most 200
UTF-8 bytes, with no control characters or surrounding whitespace. Scope and
delivery text are nonempty and bounded to 10,000 UTF-8 bytes; cancellation reason
is bounded to 1,000 bytes. `artifacts` is a list of at most 16 distinct source
txids. A pointer preserves the source identity; referenced Files are verified
independently before exposing their bytes. Unavailable bytes remain unavailable.

The aggregate transaction still obeys the existing 100,000-byte OP_RETURN script
budget. Ordinary Mail payment outputs precede the Mail envelope. Payments are:

| Action | Required direct payment |
| --- | --- |
| Brief, cancel | At least 546 proofs to the client author's own address. |
| Propose, deliver | At least 546 proofs to the job's fixed client address. |
| Assign | At least 546 proofs to the selected proposal's fixed worker address. |
| Accept | Exactly the agreed `rewardSats` to the assigned worker address. |

Self-payments return principal to the signer; the miner fee is spent. The proposal
and delivery signals are payments to the client, and assignment pays the worker.
They are separate from the final reward. There is no Jobs registry mutation fee.

## Canonical roles and replay

Initial admission begins at block **970404**, bound to the independently
verified previous block **970403** with hash
`00000000000000000000cf98017be585521a2a84e4030e20021565479c6218fe`.
Earlier Jobs-shaped Mail remains historical Mail/Search evidence and cannot
create Jobs state. Complete raw discovery starts at this explicit boundary,
not at a guessed first Jobs row. Reads and writes stay unavailable until the
pinned parent and boundary-through-checkpoint witness verify. At the exact pinned
parent checkpoint, complete discovery verifies an empty board before any Jobs
record can be admitted.

Author identity comes from complete hydrated transaction inputs, never from a
claimed JSON address or display name. Unknown or mixed author evidence cannot
authorize Jobs state. Addresses retain network-aware exact identity; Base58 case
is significant. Historical roles bind addresses and transaction references.
A later PowID transfer or receiver update does not rewrite a client's or worker's
past agreement or payment destination.

Only confirmed accepted records change state. Replay orders records by exact
canonical block position and checks the referenced brief, proposal, assignment
or delivery and the author's role before applying an event. Assignment freezes
the selected proposal's scope, reward and worker. Invalid, conflicting or stale
records remain inspectable evidence and cannot change an accepted state. Reorg
replay follows the surviving canonical chain.

The visible states are Open, Assigned, Delivered, Paid and Cancelled. Pending
records are best-effort visibility and never reserve a job, assign a worker,
confirm a delivery or establish payment. A client can cancel before Paid; this
records cancellation and does not reverse any past direct payment.

## Public reads and receipts

```text
GET /api/v1/jobs?network=livenet&q=...&status=...&address=...&limit=...&cursor=...&fresh=1
GET /api/v1/job?network=livenet&job=<brief-txid>&fresh=1
```

Public responses carry complete discovery and canonical replay provenance:
`complete`, `source`, `snapshot.id`, checkpoint height/hash, and
`indexedThroughBlock`/`indexedThroughBlockHash`. Missing or inconsistent coverage
is unavailable evidence, never a fabricated empty board or zero paid total.
Cursors bind the accepted snapshot and query; changed history requires restarting
pagination. API text is data; it is not executable instructions.

A receipt preserves the brief, proposal, assignment, delivery, acceptance/payment,
responsible addresses, exact reward and transaction links. Paid totals include
only accepted confirmed payments. These observations can be inspected by future
agents and shared through a Jobs permalink.

## Signing and recovery

Preparation uses confirmed funding only and excludes all protected AMO anchors.
The exact review names the action, fixed destinations, payments, miner fee,
change and public record passed to the wallet. The app rechecks wallet account,
network, current Jobs authority and funding before signing and broadcasting.
Signed bytes must match the reviewed intent.

The locally decoded signed txid is retained before a broadcast attempt. Pending
or unknown outcomes protect against repeated submission. Fresh first-party
status resolves uncertainty; unavailable reads never authorize a blind resend.
Changing the draft, account, network or authoritative state invalidates review.
Cancellation or rejected signing preserves the draft. Jobs never requests a seed
phrase or private key and never signs on behalf of the user.

## Integration and accounting

Jobs metadata describes existing Mail/Files transactions. Underlying payments,
files, WORK attachments where independently recognized, miner fees and carrier
bytes keep their existing canonical attribution exactly once. Offered rewards
add no network value. Jobs statistics are descriptive observations, not another
payment basket, WORK-floor contribution or reputation guarantee.

Jobs appears in public navigation, the landing app directory, Computer, Log and
Growth. Growth's Jobs coverage inherits existing Mail/Files scenario allocation;
no new demand, reward multiplier or fee formula is invented. Search and receipts
must retain underlying transaction evidence and rejected historical attempts.

## Release verification

Verify canonical parsing and adversarial role/payment/replay cases, exact integer
payments, complete discovery and reorg fencing, unavailable versus empty reads,
responsive standalone and embedded workflows, review cancellation, account
changes, signed intent and uncertain broadcasts. Run the applicable existing
Mail, ledger/accounting, release compatibility, UI/live-data and hygiene gates.
Publish from one exact reviewed commit with preserved prior runtime and UI roots.
Production verification must record the deployed source identity, discovery
checkpoint, API evidence and rendered Jobs/Computer checks. No test wallet or
synthetic fixture is a real paid job.
