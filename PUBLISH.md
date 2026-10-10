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

Boost, Publish articles, and their Computer workspaces share a Tip action with
Proofs / WORK selection. Proofs default to 546; custom positive whole-proof
amounts remain exact, subject to funding and network dust rules. WORK accepts
positive exact amounts with up to sixteen decimal places, down to
`0.0000000000000001 WORK`; the wire amount is a canonical positive Q16 integer
bounded by the 21,000,000 WORK supply cap. Miner fees are separate. WORK tips also
pay the existing 546-proof WORK registry mutation fee. There is no Boost
registry tip fee.

Both currencies route to the target's current confirmed content owner. A display
ID does not determine payment authority. Ownership, confirmed funding and WORK
admission/capacity where applicable are checked before signing and before
broadcast. The prepared review shows the selected currency, exact tip, recipient,
registry payment where applicable, miner fee, change, inputs and protocol records.
Wallet signing stays local; signed transactions must preserve the review.

The existing proof record remains unchanged:

```text
pwb1:tip:<target-txid>:<exact-proof-amount>
```

Its pre-carrier owner-directed proof payments must equal the declared amount;
there is no legacy registry-paid tip fallback. The additive WORK record is:

```text
pwb1:tip2:<target-txid>:<canonical-WORK-id>:<amount-subatoms>
```

The canonical WORK id is
`d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8`.
A WORK tip must match exactly one accepted same-transaction canonical
`pwt1:send3` transfer with the same payer, exact Q16 amount and historical current
content owner as recipient. Final canonical raw block replay must accept the
transfer, exact registry output and movement claim; token-verifier preparation
alone cannot grant the association. A WORK-tip transaction has exactly one
`pwb1:` carrier and one `pwt1:` carrier, preventing the same WORK transfer from
signaling another Boost action. Decoded bytes alone cannot establish accepted
transfer or tip validity. An association rejection clears its application signal
evidence while retaining the raw canonical Boost outcome for replay and parity. The writer makes no owner-directed proof tip payment,
places the 546-proof WORK registry output after the Boost carrier and before
`send3`, and omits `pwm1:` Mail because there is no Mail delivery payment.

A transaction contains at most one tip carrier across both forms, including
malformed matching carriers. Repeated tips in separate transactions remain
allowed. Both forms use the indexed `boost-tip` kind. Confirmed activity exposes
payer, currency, exact amount and transaction; proof and WORK signal lanes count
their respective accepted amounts once. Pending records remain visible without
establishing confirmed totals. Log and Search preserve exact source amounts,
canonical token identity and target references.

Proof tips also write one `pwm1:m:Tip <amount> proofs for ProofOfWork content
<target-txid>`. That ordinary Mail envelope owns its existing payment-flow and
network-value contribution once. For WORK tips, the accepted WORK transfer owns
its existing registry fee and WORK movement economics once; the tip association
adds neither Mail delivery nor another economic delta. Growth observes both tip
forms and existing companion Mail/WORK attribution. This does not activate the
separate Boost accounting proposal or rewrite historical H-1 values, WORK terms
or INCB issuance. A standalone historical proof-tip carrier without Mail remains
inspectable without gaining a new canonical Boost economic contribution.

Signed tip txids are persisted before broadcast in Transaction recovery, with
currency and exact quantity retained. Unknown outcomes block another tip to that
target; unknown WORK outcomes also protect wallet-wide WORK capacity across tip
targets until first-party status resolves them. Failed status reads preserve
evidence. Confirmed, pending and dropped status remain distinct, and wallet
rejection retains the entered currency and amount. The article reader retains
its spaced header and accessible Back to articles arrow on standalone Publish
and Computer.
