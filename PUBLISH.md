# ProofOfWork Publish

Publish is the text-only blogging surface at `publish.proofofwork.me` and
Computer's Publish workspace. Writers compose a title and body, retain a private
browser-local draft for their wallet and network, preview it, review the exact
transaction, and sign locally. Readers discover articles, follow authors, open
author archives, and read complete verified text. Confirmed records are
canonical; a broadcast receipt or pending transaction is visibility only.

The writer is a dedicated page at `publish.proofofwork.me/write`, with local
preview at `/?publish=1&write=1` and Computer at `/?folder=publish&write=1`.
Editing and preview use normal page scrolling and Back/Forward navigation.
Only the exact transaction consent review opens a dialog. Reload restores the
current wallet/network article draft.

The article feed, search and author archives use Boost's shared responsive
shell: compact side navigation follows the available surface width, including
Computer workspaces, and becomes bottom navigation on mobile. Publish's reader
and writer typography do not override that navigation layout.

Mail Compose offers Mail, Boost and Publish. Selecting Publish saves every
field of the Mail draft before opening this same writer and its separate
article draft. Back restores Mail under the current wallet/network; a changed
account cannot restore another account's composition. Mail text, attachments,
recipients and reply context are not imported into the public article.

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

After exact body verification, bare root `.pow` names and one-level subdomains
become links to ProofOfWork Browser on the reader's selected network, in a new
tab. This is a display projection: source characters, whitespace, UTF-8 size and
SHA-256 remain unchanged. Rendering performs no name lookup and does not claim
that a name is registered or has a confirmed page link. Browser independently
verifies resolution after navigation and retains its static sandbox. Emails,
existing URLs, inline/fenced code and invalid names remain literal. Article-body
tags and mentions stay literal; writer previews and article-card titles retain
their existing behavior.

The article's self-payment and existing Mail envelope also produce normal
Inbox and Sent records. Their canonical companion Boost post supplies compact
article metadata; the body remains the exact `memo`, without another body
copy or payment. Mail uses the verified article title and an Open Publish link.
Its reader requests fresh exact-txid Boost detail and renders article text only
when confirmed metadata, UTF-8 size, SHA-256 and the full body agree. Malformed,
pending or unavailable evidence does not establish a verified Mail article.

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
and embedded routes, text escaping, transaction preparation, and all eighteen
managed static surfaces. Release source includes the shared protocol and browser
signature modules imported by the API/indexer. Previous fourteen-, fifteen-, sixteen- and
seventeen-surface release evidence remains verifiable.

## Content tips

Boost, Publish articles, and their Computer workspaces share a Tip action next
to replies, likes, and reboosts. The default is 546 proofs; a custom positive
whole-proof amount is preserved exactly, subject to funding and network dust
rules. Miner fees are separate. Tips pay the target's current confirmed content
owner, consistent with existing engagement routing, not a stale displayed ID.
Ownership is checked before signing and before broadcast. Wallet signing stays
local; the prepared outputs and payloads must survive signing unchanged.

The wire record is `pwb1:tip:<target-txid>:<exact-proof-amount>`. A transaction
contains at most one tip; its pre-carrier payments to the historical confirmed
owner must equal that amount. There is no Boost registry fee or legacy
registry-paid tip fallback. Repeated tips in separate transactions are allowed.
Confirmed tips appear in content activity with payer, amount and transaction,
contribute once to the target's signal and existing profile totals, and remain
inspectable in Log and Search. Pending tips cannot establish confirmed totals.

The app also writes one `pwm1:m:Tip <amount> proofs for ProofOfWork content
<target-txid>` in the same transaction. That ordinary Mail envelope owns the
existing canonical payment-flow/network-value contribution. The Boost record
and Search are associations and observations, never extra economic deltas.
Growth reports tip records and its existing Mail overlap diagnostics; this does
not activate the separate Boost accounting proposal or rewrite historical H-1
values, WORK terms or INCB issuance. A standalone historical tip carrier without
Mail can be inspected but gains no new canonical Boost economic contribution.

A signed tip txid is persisted before broadcast in Transaction recovery. An
unknown outcome blocks another tip to that target until first-party status
resolves it. Failed status reads preserve evidence. Confirmation, pending and
dropped status remain distinct; wallet rejection retains the entered amount.
The article reader has a spaced header and an accessible Back to articles arrow
on standalone Publish and Computer.
