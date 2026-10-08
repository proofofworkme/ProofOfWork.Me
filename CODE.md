# ProofOfWork Code

Code v1 is a public source repository surface for `code.proofofwork.me` and
Computer's Code workspace. It creates a repository, commits one exact UTF-8
file at a time, removes files, and exposes the confirmed tree and transaction
history. Readers inspect source as inert text and verify its transaction, size
and SHA-256. Wallet signing stays local. The initial implementation is a local
product build; a configured hostname or source document does not establish a
production release.

This version has one immutable address owner and one linear head. It has no
private repositories, Git transport, branches, merge or pull-request authority,
ownership transfers, repository marketplace or code execution. A repository
name is display metadata; the creation transaction ID is its identity. PowIDs
may label addresses through existing confirmed identity evidence, but changing
an ID's owner or receiver does not transfer a Code repository.

## Wire records

The additive OP_RETURN family is `pwc1:`. Each transaction contains exactly one
Code carrier, with one of these payloads:

```text
pwc1:repo:<base64url JSON>
pwc1:commit:<base64url JSON>
```

Repository JSON, in canonical key order:

```json
{"v":1,"name":"Example","description":"A public source tree."}
```

Put JSON, in canonical key order:

```json
{"v":1,"repo":"<creation-txid>","parent":"<current-head-txid>","op":"put","path":"src/main.ts","message":"Save source","sha256":"<exact-source-sha256>","size":123}
```

Delete JSON, in canonical key order:

```json
{"v":1,"repo":"<creation-txid>","parent":"<current-head-txid>","op":"delete","path":"src/main.ts","message":"Remove source"}
```

The canonical codec is `src/shared/protocol/codeRepository.mjs`, shared by the
writer and verifier. Its JSON uses exactly the shown key order, compact
`JSON.stringify` encoding and unpadded canonical base64url. Decoding re-encodes
the validated closed object and requires identical JSON bytes. Extra or
duplicate keys, alternate key order, whitespace, noncanonical encodings,
unknown versions/operations and invalid field types fail closed. Transaction
IDs and SHA-256 values are exactly 64 lowercase hexadecimal characters.

Code-specific metadata bounds are 200 UTF-8 bytes for the nonblank name,
1,000 for the description, 500 for the commit message, 1,024 for a path and
4,096 for the complete decoded JSON. Names cannot contain control characters
or leading/trailing whitespace. Description and message text preserve their
bytes; neither can contain NUL or unpaired UTF-16 surrogates. These limits do
not change the ID, DNS, Mail or other protocol rules.

## Source and paths

A nonempty put uses exactly one same-transaction Files attachment. Its existing
`pwm1:a:` parts have wire name `source.txt`, MIME `text/plain`, the put's exact
size and SHA-256, and the existing unpadded base64url bytes. Repository path is
committed separately in Code JSON; Files filename normalization cannot alter
it. Parts may occur in any physical order, but their indexes must cover one
complete set without duplicates, conflicting metadata or more than 1,000
parts. The verifier reconstructs the bytes from raw output scripts and checks
size, hash and fatal UTF-8 decoding. Parsed UI objects and `verified` flags are
never source evidence.

Source is limited to 60,000 raw bytes per file. Spaces, tabs, Unicode, a leading
UTF-8 byte-order mark, carriage returns and final newlines are preserved exactly. NUL and invalid UTF-8 are
rejected; no newline or Unicode normalization is performed. Text remains inert
in the reader, including HTML and executable source.

An empty file is a Code commitment with `size:0` and SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
It carries no Files attachment, so existing Files' nonempty-attachment rules
remain unchanged. The normal Mail envelope is still required. No nonempty or
zero-byte attachment is permitted on this empty put. Repository creation and
delete records likewise carry no attachment.

Paths are exact relative POSIX strings. They preserve case and Unicode,
including distinct normalization forms. Empty paths, absolute paths, Windows
drive prefixes, backslashes, control characters, empty segments, `.` and `..`
segments are rejected. A path has at most 64 segments, each at most 255 UTF-8
bytes. A put replaces an exact existing file or adds a new one; it cannot make
a file also serve as a directory. For example, `src` and `src/main.ts` cannot
coexist. A delete must match an existing file exactly. Trees sort paths by
unsigned UTF-8 bytes, never locale, case folding or display order.

## Transaction authority and Mail accounting

Authority comes from every input's hydrated previous-output address. All
inputs must establish the same nonempty address. Missing prevouts, mixed
owners and coinbase inputs cannot authorize Code. No metadata owner field,
profile label, wallet draft or supplied attachment can substitute for this
evidence. The caller must obtain prevouts and script-derived output addresses
from the first-party raw transaction/full-node path.

Each action includes the existing normal `pwm1:` Mail envelope and at least
546 whole proofs paid to that input owner before both the first PWM carrier
and the Code carrier. Multiple early owner-directed outputs can sum to that
minimum. Later change cannot establish the required payment. This is a
self-payment, not a separate Code registry fee. Miner fees are additional and
shown separately in the transaction review. Existing Mail/Files economics
owns the transaction's payment-flow contribution once; Code metadata, Log and
Search observations add no second contribution or new WORK accounting rule.

All OP_RETURN outputs must be unfunded and completely decoded from their
exact scripts. The transaction's sum of compiled OP_RETURN scripts, including
OP_RETURN and push opcodes, prefixes, metadata and attachment encoding, must
not exceed 100,000 bytes. Code v1 permits Code and PWM carriers only. Other
protocols or unknown OP_RETURN records, multiple Code candidates, malformed
scripts or invalid UTF-8 invalidate the Code event. This conservative Code
rule does not rewrite how another protocol replays historical transactions.

The PWM envelope permits message, subject and attachment parts. It must be a
valid normal Mail envelope. Subject is optional, canonical base64url UTF-8,
and appears at most once. There is one logical PWM envelope, and no Code
carrier can occur strictly between its first and last parts. Every PWM part
must precede the Code carrier, matching the writer's complete Mail envelope
followed by Code. Ordinary addressed outputs may
appear between carriers without splitting that logical envelope. Code does
not use Mail reply/forward fields as repository ancestry.

Wallet preparation uses confirmed funding inputs and excludes every active
sale-ticket anchor. Review exposes the exact action, repository, parent, path,
source hash/size, self-payment, records, funding, miner fee and change. Wallet,
network, authority, funding and confirmed head are checked again before
signing and before broadcast. The signed transaction must preserve every
prepared input/output/value/record. Its signed txid is saved locally before
broadcast; an unknown outcome prevents a duplicate action until first-party
status resolves it. Rejection preserves the draft. A receipt never establishes
a confirmed repository head.

Code and Jobs share fresh wallet-scoped AMO reservation checks. The
authoritative `proof-indexer-wallet-token-overlay` response includes every
active wallet listing and refuses listing overflow. Its `summaryOnly` and
aggregate pagination flags describe omitted history, not missing reservation
listings. Accept that contract while rejecting explicitly incomplete listing
collections, inconsistent listing counts, or missing wallet authority. Check
the protected anchor union again before signing and broadcast.

## Replay and discovery

Repository creation sets both repository ID and head to the creation txid,
with an empty tree and the address inferred from its inputs. A confirmed
commit applies only when its repository exists, its author matches that
immutable owner, its `parent` equals the current confirmed head, and its tree
operation is valid. Successful puts/deletes advance the head to their own
txid. Stale parents, foreign owners, missing files and prefix collisions remain
inspectable events with explicit validation errors and `applied:false`; they
do not advance the head. Authors must review a new commit against the refreshed
head rather than silently rebasing an old signed intent.

Confirmed replay uses the exact canonical tuple
`(blockHeight, blockTransactionIndex, protocolVout, recordOrdinal)`, with Code's
single event at ordinal zero. Time, transaction ID and index insertion order
cannot choose the head. Duplicate transaction evidence, competing transaction
positions or mixed block hashes at one height fail the replay. Pending,
dropped, orphaned and unavailable evidence never mutate confirmed trees.
Replaying from scratch at a new canonical checkpoint handles reorganizations;
a later descendant whose parent disappeared is retained unapplied.

`verifyCodeTransaction` accepts hydrated raw transactions, not semantic UI
claims. `replayCodeTransactions` returns repositories and all discovered Code
candidate events. A hash callback verifies nonempty source bytes in both Node
and browser runtimes. Resulting file entries retain their source txid, exact
size/hash, fixed Files metadata, base64url data and decoded source text.

Replay alone does not prove discovery completeness. Before serving a committed
tree or authoritative head, the API must prove a complete raw chain scan that
includes malformed/rejected Code candidates, transaction order and hydrated
prevouts at a hash-bound checkpoint verified against the first-party full node.
An address subset, Search results, recent page or decoded valid-event list is
insufficient. Exact-tip reads require matching height and hash; stable reads
must expose their verified boundary and lag. Cursors bind to a coherent
snapshot and changed checkpoints require restarting pagination. Incomplete
reads cannot claim no repositories, full history or an authoritative head.

Historical discovery looks for earlier uses of the `pwc1:` marker at protocol
payload boundaries, including malformed records. These are called candidates
in discovery metadata; detection does not establish a valid repository or commit.
Authenticated first-party Core supplies accepted-chain/body/consensus authority.
The scanner binds header hashes, parent continuity, complete transaction framing
and exact output scripts, then verifies positive record/source/seal evidence.
It does not independently validate block consensus or transaction Merkle/witness
roots. The scan itself requires no wallet signing or broadcast.

The bounded discovery bootstrap scans every Core block from height one with
authenticated `getblock(hash, 0)`. A server-only walker verifies the requested
header hash, predecessor hash, canonical CompactSize framing and complete byte
consumption for legacy and witness transactions. It examines exact output-script
boundaries with the existing raw OP_RETURN decoder, including split/nonminimal
pushes, malformed scripts and invalid UTF-8 candidates. A raw byte substring
search cannot establish a negative result.

Blocks with no Code candidates skip verbose transaction JSON. Positive blocks
still fetch `getblock(hash, 2)`, require the canonical block envelope and exact
raw/decoded candidate transaction IDs, output positions and scripts, then use
the unchanged prevout hydration, candidate digest and sealed-event closure.
Core remains the authenticated body/consensus authority, as in the original
verbose scanner; the negative walker does not claim independent transaction
Merkle or witness-root verification. Unsupported, oversized or malformed raw
framing refuses discovery rather than becoming negative evidence. Existing
per-block canonical-hash rechecks, target hash, atomic marker persistence,
resumption and historical seal/replay requirements remain mandatory.

## Product integration and validation

Code is an additive product surface with shared navigation and a Computer
workspace, Log/searchable events, verified file links, protocol statistics and
applicable read-only Growth observation. Code observations reuse Mail/Files'
existing scenario and payment lanes. There is no canonical economic migration,
ID/DNS migration or activation of the separate Boost accounting proposal.
Search's derived copies preserve underlying chain records and cannot establish
additional payments. A changed Search projection requires its versioned
rebuild and coverage proof.

Production hosting requires the coordinated Code route, same-origin API proxy,
public hostname and complete nineteen-root release tooling while preserving
historical fourteen- through eighteen-root rollback evidence. A local preview
does not authorize production configuration, wallet broadcast, deployment,
commit or push. The release audit and first-party production verification must
record their actual scope and any unexercised live transaction paths.

An approved Code rollout over an active runtime uses
`deploy/code/scoped-node.py` with an exact eleven-file allowlist, committed
source identity, before/after hashes and complete dependency pins. It preserves
active audit changes and immutable rollback evidence, and requires the independent
Search job's exact held-state receipt before restarting API and worker. It pins
the existing API gateway socket/service bytes and activation, drains the socket
before its proxy and the applications, then restores their prior activation
without changing configuration or enablement.
Where accepted native transition storage is active, the overlay supplies
reconstructed full transition records to the unchanged Code seal-closure check.
The canonical database, existing seals, authority services and configuration
are outside this source controller's write scope. Discovery bootstrap and the
versioned Search rebuild remain separate supervised steps; source installation
does not establish complete Code history.

### Production verification — 2026-10-07

Code v1 is available at `code.proofofwork.me` and in Computer. The UI release
is `13ddf6d7f401-20261007T030045Z`; the active scanner repair derives from
`ed0fc2c5df56`, preserving the accepted Audit31/native/Search overlay. The
historical discovery checkpoint completed from height 1 through 970323 /
`00000000000000000000d4401afd7a7795ee06e4d333308e61961cece32dd47c`, count 0, no blockers,
digest `38a551871e844eab776d536642267b0d313630a76e5de06240bfb950c9920587`. Ordinary canonical
scanning extended the still-complete marker to 970324 /
`00000000000000000000bab1afd1d7d07c7b7b177bc836f704f51d3d8b8699ca`; independent public
health/fresh-Code/health admission passed there at 2026-10-07 09:59:55 UTC.
Post-publication admission passed again at 970328 /
`00000000000000000000989d8a9d2814d1ff919799b7b4aa3e214dcdcf6a8bf1` at 10:17:44 UTC. The release audit records final
fresh Code reads, Search coverage, UI/Caddy/HTTPS/browser receipts and
unexercised live transaction paths: [audits/2026-10-07-code-v1-production-release.md](audits/2026-10-07-code-v1-production-release.md).
These dated observations do not replace the ongoing readiness, reorg,
source-verification and local-signing rules above.

`scripts/check-code-repositories.mjs` checks canonical codec rejection, exact
Unicode/content preservation, zero-byte files, raw attachment reconstruction,
input authority, mixed/malformed carriers, script budgets, immutable ownership,
stale parents, tree conflicts, canonical ordering and reorg replay. Backend
and UI tests additionally verify complete checkpoint discovery, source reads,
draft isolation, exact review and retry protection.
`npm run check:code:deploy` checks the scoped controller's refusal and rollback
behavior using isolated local filesystem fixtures.
