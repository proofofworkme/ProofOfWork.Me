# ProofOfWork Jobs

Jobs turns a public work brief, agreed terms, delivery and direct payment into
an inspectable record for humans and agents. The standalone surface is
`jobs.proofofwork.me`; Computer embeds the same workspace at `/?folder=jobs`.
Public browsing and search require no wallet. My Jobs is scoped to the connected
wallet's address. All writes use a local mainnet wallet review and signature.

Version 1's production acceptance completed on
2026-10-08 UTC (October 7 in America/Toronto). The [release record](audits/2026-10-07-jobs-v1-release.md)
binds that historical source, runtime, discovery, UI and verification evidence.
The additive version-2 reward schema supports canonical WORK without
reinterpreting version-1 records or changing WORK's own transfer rules.

## Product boundary

The first version covers small development tasks, bug reports, documentation and
other public work. A client publishes a brief. A worker proposes exact scope and
a reward in proofs or canonical WORK credit. The client assigns that proposal,
freezing its scope, reward currency, exact amount and worker address. The worker
delivers evidence; the client accepts and pays that exact reward in the same
transaction. A worker may propose a different currency from the brief;
assignment accepts the selected proposal's exact terms. A receipt connects
every accepted event.

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
Version-1 records have `v: 1` and retain the following exact schema. IDs below are
64 lowercase hexadecimal transaction IDs.

| Action | Exact metadata key order | Meaning |
| --- | --- | --- |
| `brief` | `v,title,scope,rewardSats` | Open a job; creating address is the client. |
| `propose` | `v,job,scope,rewardSats` | Propose terms for a job; author is the worker. |
| `assign` | `v,job,proposal` | Client selects and freezes a proposal. |
| `deliver` | `v,job,assignment,text,artifacts` | Assigned worker publishes delivery and source transaction references. |
| `accept` | `v,job,delivery` | Client accepts delivery and pays the exact assigned reward. |
| `cancel` | `v,job,reason` | Client closes a job before it is paid. |

Version 2 uses the same actions and body prefix, with `v: 2`. A `brief` uses
`v,title,scope,reward`; a `propose` uses `v,job,scope,reward`. Other actions retain
the exact key order above. The nested `reward` is one of these closed objects,
with its exact key order:

```json
{"asset":"proofs","amountSats":"546"}
{"asset":"WORK","token":"d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8","amountSubatoms":"10000000000000000"}
```

The WORK token identity is fixed. `amountSubatoms` is a canonical positive decimal
integer string, at most `210000000000000000000000` (21,000,000 WORK). One WORK is
exactly `10000000000000000` subatoms. The UI accepts exact positive WORK amounts
with up to sixteen decimal places and never rounds an offer or converts it from
a displayed proof/USD value. Version-1 proof rewards normalize to the same
proof reward object for API display while their original wire bytes stay intact.

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
| Accept, proof reward | Exactly the agreed proof reward to the assigned worker address. |
| Accept, WORK reward | At least 546 proofs as Mail signal to the assigned worker, plus the exact agreed canonical WORK transfer in that same transaction. |

A WORK acceptance contains exactly one canonical `pwt1:send3` after all Mail
parts, naming the fixed WORK token, agreed integer subatoms and historical
assigned worker address. A distinct exact 546-proof WORK-registry payment to
`1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV` follows the Mail envelope and precedes the
WORK transfer. That registry payment and the worker's Mail signal are separate
from the reward and miner fee. Other Jobs actions retain their ordinary Mail
payments. Version-1 Jobs transactions remain exclusively Mail/Files carriers.

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
the selected proposal's scope, reward currency and exact amount, and worker.
Invalid, conflicting or stale
records remain inspectable evidence and cannot change an accepted state. Reorg
replay follows the surviving canonical chain.

Version 2 opens at height **970577**, after independently verified Core parent
**970576** / `00000000000000000001bc401b09150a6f092579644cc5616a828949f48bbd1d`.
Earlier version-2-shaped Mail is rejected historical evidence. The original
version-1 boundary and complete candidate-discovery witness remain unchanged.
Public version support requires the additional parent pin and complete current
checkpoint coverage; unverifiable evidence closes version-2 writes.

A WORK acceptance becomes Paid only when the canonical WORK engine accepted
its exact same-transaction transfer at the matching block, transaction, output
and ordinal. The Jobs reader checks accepted relational transfer evidence
against the sealed raw replay witness, exact recipient/amount and registry
payment claims. Parsing a `send3` string alone cannot prove a valid balance
movement. Missing or conflicting settlement evidence cannot produce Paid or a
WORK paid total. Missing or incomplete canonical witnesses make the read
unavailable with `JOBS_WORK_SETTLEMENT_UNAVAILABLE`; a canonically rejected
transfer remains inspectable and unpaid. This qualification creates no new
canonical economic record.

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
only accepted confirmed payments, with proof totals and exact WORK-subatom totals
kept separate. API jobs expose `offeredReward`, `reward` and `paidReward`;
`paidReward` is null until accepted payment. Legacy `offeredRewardSats`,
`rewardSats` and `paidSats` describe proofs only and are `"0"` for WORK rewards.
These observations can be inspected by future
agents and shared through a Jobs permalink.

## Signing and recovery

Preparation uses confirmed funding only and excludes all protected AMO anchors.
The shared [Code wallet reservation contract](CODE.md#transaction-authority-and-mail-accounting)
accepts authoritative complete wallet listings even when unrelated history is
summarized; explicit listing incompleteness still blocks preparation and signing.
The exact review names the action, fixed destinations, payments, miner fee,
change and public record passed to the wallet. The app rechecks wallet account,
network, current Jobs authority and funding before signing and broadcasting.
Signed bytes must match the reviewed intent.
WORK acceptance additionally rechecks V8 admission and authoritative transferable
WORK capacity after active sale reservations and pending outgoing commitments.

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
changes, signed intent and uncertain broadcasts, WORK precision/settlement
evidence and cross-currency proposals. Run the applicable existing
Mail, ledger/accounting, release compatibility, UI/live-data and hygiene gates.
Publish from one exact reviewed commit with preserved prior runtime and UI roots.
Production verification must record the deployed source identity, discovery
checkpoint, API evidence and rendered Jobs/Computer checks. No test wallet or
synthetic fixture is a real paid job.
