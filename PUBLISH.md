# ProofOfWork Publish

Publish is the text-only blogging surface at `publish.proofofwork.me` and
Computer's Publish workspace. Writers compose a title and body, retain a private
browser-local draft for their wallet and network, preview it, review the exact
transaction, and sign locally. Readers discover articles, follow authors, open
author archives, and read complete verified text. Confirmed records are
canonical; a broadcast receipt or pending transaction is visibility only.

## One article, one social record

An article is an additive original `pwb1:post`, keyed by its transaction ID.
Its title is the ordinary post's short text. The optional `article` member is:

```json
{"v":1,"title":"Article title","source":"same-tx-pwm1-message","size":123,"sha256":"<64 lowercase hex characters>"}
```

The exact UTF-8 body appears once in contiguous `pwm1:m:` chunks in the same
transaction. `size` and `sha256` commit those bytes, including whitespace and
line endings. No mutable URL supplies the article. The verifier requires one
unambiguous original post, a matching title, a complete text-only Mail envelope,
valid UTF-8, exact size/hash, and aggregate OP_RETURN scripts within policy.
Attachments, duplicate positions, ambiguous roots, malformed metadata, NUL and
unpaired surrogate characters fail closed. Existing ordinary Boost posts and
replies retain their 140-character limit. Article titles use that same short
text limit; bodies use the remaining carrier budget.

The 100,000-byte limit applies to the sum of compiled OP_RETURN **scripts**,
including `OP_RETURN`, push opcodes, prefixes, article JSON and all body chunks.
The editor measures the same scripts as the wallet builder. It offers all
remaining bytes instead of a separate application body cap. A title or metadata
change changes the remaining allowance. Miner fees and transaction weight are
reviewed separately. Initial publication self-sends at least 546 proofs to the
author; this is article signal, not a Boost registry fee.

Boost renders article preview cards linking to Publish. Publish verifies the
full body from fresh confirmed raw transaction evidence before displaying it.
The feed carries compact metadata only; it does not load every article body.
`/api/v1/boost?format=article` filters the complete confirmed collection before
pagination. `profile=<address-or-id>&profileTab=boosts&format=article` reads an
author archive. Existing exact-txid detail reads return verified `articleBody`.
Invalid or unavailable body evidence never becomes rendered article text.

## Shared people and engagement

Boost, Publish and Computer share confirmed profiles, avatars, banners,
followers and following. The chosen PowID is scoped to wallet address and
network. A wallet signs the existing profile-intent message; a narrow Computer
identity bridge relays it between trusted origins. Clients verify the signature
and fresh confirmed ID ownership before saving or accepting it. Account changes,
transferred IDs and forged origin/source/nonce messages cannot apply another
wallet's selection. Taproot selections use BIP322 simple signatures for new
choices; exact address-bound historical ECDSA intents remain readable.

The local choice is preparation state. Public bylines come from confirmed
`pwb1:profile` records and current registry ownership. Publishing an article
with a selected ID includes its existing identity-only profile record in the
same transaction, so confirmation establishes that shared public byline while
preserving prior images. Its exact bytes are part of the editor's budget and
transaction review. Publishing the ID choice in either surface updates that
shared public profile. Selecting an ID does not
register, transfer or change its receiver. Address authors remain supported.
Only the bridge route permits framing by the exact Boost, Publish and Computer
origins; ordinary Computer pages retain their embedding restrictions.

Likes, replies and reboosts use the existing `pwb1:like`, `pwb1:reply` and
`pwb1:reboost` events against the same article transaction ID. Their existing
546-proof minimum payment goes to the current confirmed owner. Both surfaces
show the same counts, payments and activity thread. Existing Boost transfers,
sale tickets, hide records and historical forms remain replayable.

## Local review and recovery

Drafts remain local to the current wallet/network and are preserved through
preparation failures. Preview does not publish. Transaction review shows the
article, carrier byte count, exact self-payment, miner fee, funding and change.
Funding uses confirmed inputs and excludes existing sale-ticket anchors.
The selected identity, account, network and current inputs are checked again
before signing and broadcast. The signed txid is retained before broadcast;
an uncertain outcome requires a first-party status check before another publish
attempt. Receipts do not establish confirmed article state. Article text is
immutable once confirmed; local editing is draft editing.

## Integration and accounting

Shared navigation, the landing page, Computer, public Log, Growth, route maps,
API proxy and release surfaces include Publish. Log keeps the canonical
`boost-post` kind and exposes article title and Publish tags. Growth reports
verified article counts as a subset of Boost posts at its existing ledger
checkpoint. Publish uses the existing Boost/Mail scenario and payment lanes:
shared carriers and payments are not added twice, and no canonical WORK floor,
H-1 commitment, issuance or frozen marketplace term changes.

`check:publish` covers body commitments, exact script limits, article filtering,
raw detail verification and shared engagement. Identity checks cover signed
selection and trusted bridge routing. UI and deployment checks cover standalone
and embedded routes, text escaping, transaction preparation, and all seventeen
managed static surfaces. Release source includes the shared protocol and browser
signature modules imported by the API/indexer. Previous fourteen-, fifteen- and
sixteen-surface release evidence remains verifiable.
