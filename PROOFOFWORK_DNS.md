# ProofOfWork DNS

Canonical documentation for the live ProofOfWork DNS `.pow` registry, backed by
ProofOfWork OP_RETURN events.

The focused DNS registration flow opens an exact review of the name, owner, resolver, registry payment, miner fee, change, and public protocol record before local wallet signing. Availability and confirmed funding are rechecked before signing and broadcast. Browser-local signed-txid receipts support status checks and task restoration after interrupted broadcasts; they never establish confirmed ownership or resolution. Marketplace signing flows remain separate.

## Developer Warning

ProofOfWork DNS is intentionally parallel to ProofOfWork IDs, but it is not an
ID alias and it does not carry PGP keys.

Do not change these without an explicit migration plan:

- Mainnet registry identity: `domains@proofofwork.me`
- Mainnet registry address: `1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY`
- Registration price: `1000` proofs
- Mutation price: `546` proofs for resolver updates, transfers, on-chain listings, seals, delistings, and buyer-funded marketplace transfers
- Subdomain action payment: one `546`-proof self-payment to the root owner for create, update, or revoke; this is not a registry mutation fee
- Page-link action payment: one explicit self-payment of at least `546` proofs to the root owner for set or clear; root `page1` opens at 970426 and child `subpage1` at 970499, each requiring complete canonical coverage
- Protocol prefix: `pwdns1:`
- Registration event: `pwdns1:r1:<name-base64url>:<owner-address>:<resolver-address>`
- Resolver update event: `pwdns1:u:<name-base64url>:<resolver-address>`
- Transfer event: `pwdns1:t:<name-base64url>:<new-owner-address>:<new-resolver-address?>`
- Listing event: `pwdns1:list5:<sale-ticket-json-base64url>`
- Sale-ticket seal event: `pwdns1:seal5:<listing-txid>:<sealed-sale-ticket-json-base64url>`
- Delisting event: `pwdns1:delist5:<listing-txid>`
- Buyer-funded marketplace transfer event: `pwdns1:buy5:<listing-txid>:<new-owner-address>:<new-resolver-address?>`
- Sale authorization version: `pwdns-sale-v1`
- Suffix rule: UI input accepts the bare prefix, such as `alice`; display and lookup append `.pow`
- Resolver rule: first confirmed valid registration wins
- Casing rule: `.pow` names are case-insensitive forever
- Pending rule: pending DNS records are visible but not final

## Product Surfaces

```text
dns.proofofwork.me      .pow claim/search, owner-controlled subdomains, Advanced DNS
domain.proofofwork.me   redirect to https://dns.proofofwork.me/
domains.proofofwork.me  redirect to https://dns.proofofwork.me/
amo.proofofwork.me      DNS tab for root management, subdomains, and trading
computer.proofofwork.me DNS workspace with Advanced DNS; AMO for root management/trading
pages.proofofwork.me    HTML authoring and shared root/active-child page linking
browser.proofofwork.me  reads confirmed covered root/child links; explicit Run app
```

Computer exposes a dedicated DNS workspace beside IDs at `/?folder=dns`, also
reachable from mobile More. It shares the focused app's Mainnet claim/search,
owned-name and public-record views, and owner-controlled subdomain panel.
Owned-name and public-record searches accept the bare label or its full `.pow`
name, as well as addresses and transaction IDs.
Disconnected users can inspect and refresh public records; writes still need
the verified owner wallet and current signing preflights. Retained registration
and subdomain receipts can restore their task into this workspace without
signing or broadcasting. Its AMO control opens `/?folder=marketplace&tab=dns`
inside Computer for root resolver updates, direct transfers, and trading.

The focused DNS app connects UniSat, checks/searches `.pow` availability,
registers root names, shows registry stats and owned names, and lets a confirmed
root owner create, update, or revoke subdomains. It also exposes public root and
child records. AMO's DNS tab provides the same owner-controlled subdomain panel
inside standalone AMO and Computer. Root resolver updates, direct transfers, and
marketplace trading remain in AMO.

Production reads use the same first-party ProofOfWork OP_RETURN API as the rest
of the Computer:

```text
/api/v1/dns-summary?network=livenet
/api/v1/dns?network=livenet
/api/v1/dns/:name?network=livenet
```

Advanced DNS in standalone DNS and Computer shows root and active one-level
child content links, current confirmed status, pending actions, history and
Open in Browser. It supports owner-reviewed set, replacement and clear to an
existing confirmed HTML txid. Pages uses the same canonical `page1`/`subpage1`
records and signing preparation; confirmed links created in Pages automatically
appear in Advanced DNS after refresh. These content pointers do not change payment-address resolution. Public reads
remain available disconnected; writes require the current confirmed root owner,
complete checkpoint evidence, exact review and local wallet signing.

The standalone DNS build uses:

```bash
VITE_DNS_LAUNCH_ONLY=1 VITE_POW_API_BASE=https://dns.proofofwork.me npm run build
```

## Wire Format

Registrations write the bare normalized name as base64url and imply the `.pow`
suffix at display/read time:

```text
pwdns1:r1:<name-base64url>:<owner-address>:<resolver-address>
```

The app normalizes user input by trimming, removing a trailing `.pow` when
present, lowercasing, and validating the remaining label. Users should not need
to type `.pow`; `alice` registers and searches `alice.pow`.

Current mutation payloads:

```text
pwdns1:u:<name-base64url>:<resolver-address>
pwdns1:t:<name-base64url>:<new-owner-address>:<new-resolver-address?>
pwdns1:list5:<sale-ticket-json-base64url>
pwdns1:seal5:<listing-txid>:<sealed-sale-ticket-json-base64url>
pwdns1:delist5:<listing-txid>
pwdns1:buy5:<listing-txid>:<new-owner-address>:<new-resolver-address?>
```

`pwdns1:r1` registrations require a 1,000-proof payment to the DNS registry
address. The root mutations and AMO writes listed above require the same
546-proof registry mutation fee used by ID AMO. The registry payment output must
appear before the DNS OP_RETURN output. The additive `pwdns1:sub1` child actions
use the owner self-payment described below; they do not pay this registry fee.

AMO DNS sale tickets use the same sale-ticket lifecycle as IDs, with
`pwdns-sale-v1` authorization JSON and `.pow` asset display. A valid purchase
must spend the active sale-ticket UTXO, pay the seller price plus ticket value,
pay the DNS mutation fee, and write `pwdns1:buy5`.

## Verified read coverage

DNS summary `indexedThroughBlock` is the stable Core checkpoint proven against
Electrum before and after complete canonical transaction hydration.
`checkpointHash` binds that height; `latestEventBlock` separately reports the most
recent DNS event. A changing checkpoint/history or incomplete hydration fails
the read instead of implying complete coverage. Confirmed sale-ticket matching
compares normalized terms by field, independent of JSON property insertion order;
signatures and the sealed anchor txid remain separately verified.

## Owner-controlled subdomains V1

The additive `pwdns1:sub1` protocol registers exactly one child level, such as
`abc.alice.pow`. It does not change root registration, fees, resolver updates,
ownership, or sale-ticket rules. The current confirmed root owner controls every
child. Root resolver recipients have no independent authority, and children have
no independent transfer, sale, or delegated ownership in V1.

The canonical record is:

```text
pwdns1:sub1:<canonical-json-base64url>
```

Create and update use this exact JSON key order:

```json
{"action":"create","parent":"alice","label":"abc","epoch":{"txid":"<root-ownership-event-txid>","protocolVout":1,"recordOrdinal":0},"resolver":null}
```

`action` is `create`, `update`, or `revoke`. `parent` and `label` are bare
lowercase labels of 1–63 ASCII characters, using letters, numbers, and internal
hyphens; each end must be a letter or number. Display and lookup use
`<label>.<parent>.pow`. User builders normalize casing and trim input. Wire
records must already have canonical lowercase labels.

`epoch` has exactly `txid`, `protocolVout`, and `recordOrdinal`, in that order.
The txid is 64 lowercase hexadecimal characters. The output index is a
nonnegative uint32, and the record ordinal is a nonnegative safe integer.
The epoch identifies the accepted root ownership event, never merely an owner
address. `resolver: null` inherits the root's current confirmed resolver; a
valid explicit network address overrides inheritance. Valid Bech32 address
spellings are canonicalized to lowercase; Base58 address case remains exact.
Updates may switch between inheritance and an override. A revoke record omits
`resolver` entirely and otherwise uses the same field order and ownership epoch.

The JSON must match exact canonical serialization: no extra or duplicate keys,
alternate key order, whitespace, escaped equivalents, or alternate number
encodings. Encoding is unpadded base64url with canonical unused bits and valid
UTF-8. A carrier is bounded to 2,048 text characters. Ordinary messages that
mention a child name are not subdomain records.

Every action requires an explicit self-payment output of at least **546 proofs**
before its own protocol OP_RETURN output, plus the miner fee. The payment goes
to the root owner, not the DNS registry. Every transaction input must resolve to
that same recognized owner address: mixed authors, unknown prevouts, missing
input addresses, and coinbase inputs fail authorization. The transaction may
carry a normal human-readable self-message, but V1 permits exactly **one**
`sub1` carrier per transaction. All matching prefix carriers count, including
malformed records, so one self-payment cannot authorize several child actions.
Payment amounts are verified as exact nonnegative integers; floating-point or
guessed base-unit conversions are not authority.

Confirmed replay combines already accepted root registration, transfer,
purchase, and resolver-update events with independently discovered raw child
records. Ordering is exact block height, transaction index, protocol output
index, and record ordinal. Missing or ambiguous accepted root positions fail
the read closed. Registry-address history alone is not complete child
discovery: owner self-messages must be discovered from complete canonical
protocol history, including malformed child carriers.

An accepted root registration opens its first ownership epoch. Every accepted
confirmed direct transfer or marketplace purchase opens a new epoch, including
a transfer to the same address. The current ownership epoch must be confirmed
in an earlier block than a child action. Same-block resolver updates do not
reset that height. At the child's exact position, the root must exist, the
record must bind the current epoch, and the transaction author must be the
current root owner. A former owner's message confirmed after a transfer has no
authority, even if it was signed or broadcast earlier.

Within an epoch, the first valid create for a child wins. An active child may be
updated or revoked; updates and revokes for an absent child are invalid. A
revoked child may be created again. Inherited children follow later accepted
parent resolver updates, while explicit overrides retain their address.
Listings, seals, and delistings do not reset the epoch or invalidate children.

Every accepted ownership change immediately invalidates all active children of
that root. A new owner may create those names again under the new epoch. An
Alice → Bob → Alice sequence cannot resurrect Alice's old children. Revoked,
invalidated, and rejected records remain inspectable history. Reorg replay
rebuilds ownership and children from the surviving canonical chain, restoring
or removing child validity according to that history.

Pending records are best-effort previews over confirmed state. They never
change canonical resolution, authorize a later pending update, reserve a name,
or become ownership evidence. Subdomains are derived DNS state; their
self-payments add no new registry or network-value contribution. Existing
independent protocol accounting remains unchanged.

The mainnet V1 activation boundary is the opening of block **969489**, pinned by
`DNS_SUBDOMAIN_ACTIVATION_HEIGHT = 969489`. A zero boundary disables child
admission. The rollout must prove complete canonical discovery from activation
through the current checkpoint before exposing writes. Child-shaped messages
confirmed below height 969489 never acquire authority. Wallet review names the
exact action, full child name, parent owner,
ownership epoch, resolver mode, self-payment destination, miner fee, change,
and public wire record. Signing stays local.

## Owner-controlled root page links V1

The additive `pwdns1:page1` protocol binds a root such as `alice.pow` to a
published HTML transaction, separate from root payment resolution and child
records. The approved mainnet source pin is
`DNS_PAGE_LINK_ACTIVATION_HEIGHT = 970426`. Its canonical predecessor at 970425
is `00000000000000000001a22c08622961c9fc0a1b063510bf5fc9141577b77537`, verified
against Core and canonical index coverage during shipping preflight. Writes
require complete independent raw discovery from the opening through the
verified checkpoint. Zero remains an explicit disabled boundary. No
existing registration, resolver, ownership, fee, or AMO rule is migrated.

The record is:

```text
pwdns1:page1:<canonical-json-base64url>
```

Set uses this exact JSON key order:

```json
{"action":"set","name":"alice","epoch":{"txid":"<root-ownership-event-txid>","protocolVout":1,"recordOrdinal":0},"pageTxid":"<published-html-txid>"}
```

Clear omits `pageTxid` entirely:

```json
{"action":"clear","name":"alice","epoch":{"txid":"<root-ownership-event-txid>","protocolVout":1,"recordOrdinal":0}}
```

`name` is one bare canonical lowercase root label, with the existing root name
validation; child names are outside this version. User builders accept a bare
label or its full `.pow` spelling. `epoch` has exactly `txid`, `protocolVout`,
and `recordOrdinal` and identifies the accepted ownership event. Both txids use
64 lowercase hexadecimal characters. The epoch output index is a nonnegative
uint32 and the ordinal a nonnegative safe integer. Encoding is canonical
unpadded base64url containing exact canonical UTF-8 JSON: alternate key order,
whitespace, extra or duplicate keys, escaped equivalents, and alternate number
encodings are rejected. A carrier is bounded to 2,048 text characters.

Every action requires at least **546 proofs** paid explicitly to the current
root owner before its own protocol OP_RETURN, plus the miner fee. Every input
must resolve to that same owner. Unknown prevouts, mixed authors, coinbase
inputs, or missing input addresses fail authorization. Exactly one `page1`
carrier is allowed per transaction; matching malformed carriers count too.
Self-payments are neither registry fees nor a new network-value contribution.

Replay binds complete accepted root history and independently discovered page
carriers to one checkpoint. It orders events by exact block height, transaction
index, protocol output index, and record ordinal. The root must exist with the
bound ownership epoch confirmed in an earlier block. At the action's exact
position the author must still own that root. A valid set creates or replaces
its active link; a clear removes an existing active link and rejects when no
link is active. Confirmed direct transfers and purchases
invalidate links, including same-address transfers and Alice → Bob → Alice
ownership sequences. Resolver updates, listings, seals, and delistings retain
the link. Invalidated and rejected records remain inspectable history; reorg
replay rebuilds state from the surviving chain. Pending page actions never
alter Browser resolution or authorize subsequent pending actions.

Root API responses expose page links separately from root payment and child
state: `pageLink`, `pageLinkEvents`, `pageLinkPendingEvents`, and
`pageLinkHistoricalRecords`. `pageLinkCoverage` reports completeness, indexed
height, checkpoint hash, and witness hash; `pageLinkAdmission` reports readiness,
the pinned activation height, minimum self-payment, prefix, and any unavailable
reason. Missing or incomplete link coverage cannot masquerade as a complete
empty namespace. These fields do not replace root or child coverage.

Pages reviews set/clear with the current owner, root name, bound epoch, target
txid when present, self-payment, miner fee, change, and exact public wire record.
The target must be confirmed HTML verified through the existing Browser reader.
Signing stays local. Browser accepts a full root name such as `alice.pow`,
requires an active confirmed link plus complete matching checkpoint coverage,
then verifies the target transaction independently and opens it in static mode.
An explicit Run app action can start inline JavaScript in the isolated Browser
runner; name resolution itself never grants execution or wallet authority.
Pending, missing, cleared, invalidated, or unverified targets do not resolve to
a page. Payment-address lookup continues to return the existing resolver.

## Owner-controlled subdomain page links V1

The additive `pwdns1:subpage1` lane binds an active one-level child such as
`app.alice.pow` to a page txid. It does not extend `page1`, alter `sub1`, or
rewrite root ownership, payment resolution, registration, mutation or AMO fees.
The current confirmed root owner controls set and clear.

```text
pwdns1:subpage1:<canonical-json-base64url>
```

Set uses this exact key order:

```json
{"action":"set","parent":"alice","label":"app","epoch":{"txid":"<root-ownership-event-txid>","protocolVout":1,"recordOrdinal":0},"child":{"txid":"<accepted-child-create-txid>","protocolVout":1,"recordOrdinal":0},"pageTxid":"<published-html-txid>"}
```

Clear omits `pageTxid`:

```json
{"action":"clear","parent":"alice","label":"app","epoch":{"txid":"<root-ownership-event-txid>","protocolVout":1,"recordOrdinal":0},"child":{"txid":"<accepted-child-create-txid>","protocolVout":1,"recordOrdinal":0}}
```

`parent` and `label` follow canonical lowercase `sub1` label rules. `epoch`
identifies the current accepted root registration, transfer or purchase.
`child` identifies the accepted **create** event for the current child lifecycle,
never its latest resolver update. Both identities have exactly the keys `txid`,
`protocolVout`, `recordOrdinal`: lowercase 64-hex txid, uint32 output index and
nonnegative safe-integer ordinal. Exact canonical JSON/UTF-8/unpadded base64url
and the 2,048-character carrier limit match `page1`: extra/duplicate keys,
alternate order, whitespace, escaped equivalents, alternate number encodings
and unused-bit encodings are invalid. Clear requires an existing active link.

Every transaction input must resolve to the same current root owner. Unknown
prevouts, missing input addresses, mixed authors and coinbase inputs fail
authorization. One explicit output of at least **546 proofs** must pay that owner
before the link's protocol output; several smaller payments cannot be summed.
Exactly one `subpage1` carrier is permitted per transaction, including malformed
matching carriers. Child page-link authority additionally requires at least one
cryptographically verified current-owner signature that commits **all outputs**,
including the exact link carrier and self-payment. `SIGHASH_ALL`,
`SIGHASH_ALL | ANYONECANPAY`, and Taproot key-spend `SIGHASH_DEFAULT` provide
that output commitment; `SIGHASH_NONE` or `SIGHASH_SINGLE` alone do not. Every
input still belongs to the current owner. Replay verifies recognized executed
single-key spend paths against the exact serialized transaction and ordered
canonical prevout scripts and values; unsupported paths or missing evidence
fail closed. This added rule applies only to `subpage1`; historical root
`page1`, `sub1`, and registry admission retain their existing rules.

The child admission model is `owner-signed-all-outputs-v1`. An active child
lookup includes its exact accepted set event and signed spend evidence. Browser,
Pages, and Advanced DNS verify that proof locally against the current owner,
carrier, self-payment, ownership epoch and child create identity; a model tag or
`valid` flag is never the authority proof. Current-lifecycle pending events must
pass the same check before fencing another local action. Pages and Advanced
DNS require that exact model, request `SIGHASH_ALL` for local child actions, and
verify the returned final spend uses `ALL` or Taproot `DEFAULT` for every input
before broadcast. An unchanged unsigned transaction does not establish that
its signatures commit the reviewed output bytes. Payment evidence uses exact nonnegative integers. The
self-payment is not a registry fee or new Growth/WORK value; a companion ordinary
Mail carrier retains its existing payment and fee accounting once.

Replay consumes complete accepted root history, complete accepted `sub1` history,
and independently discovered raw `subpage1` carriers at one canonical checkpoint.
Order is exact block height, transaction index, protocol output and ordinal;
incomplete or ambiguous accepted positions fail the whole read closed. At the
link's position the root must have the bound ownership epoch and the child must
still be active with the bound create identity. Root ownership and child create
must each be confirmed in an **earlier block** than a confirmed link action.

Set creates or replaces the child link. Parent/child resolver updates retain it.
Revoke immediately invalidates the child's link; recreating that spelling opens
a fresh create identity and cannot restore the former link. Every accepted root
transfer or purchase invalidates its children and child links, including
same-address transfers and Alice → Bob → Alice ownership cycles. Listings,
seals and delistings do not reset either identity. Replaced, cleared, invalidated
and rejected events remain history. Reorg replay rebuilds from the surviving
chain. Pending actions never route or authorize another pending action, and a
stale epoch/create binding remains rejected even if signed before the change.

The approved opening is **970499**, exported as
`DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT`. Its independently checked Core
predecessor at 970498 is
`00000000000000000001683a72df9a22322b2117aab9a1b264c5284045702d51`, exported as
`DNS_SUBDOMAIN_PAGE_LINK_PREDECESSOR_HASH`. Zero disables admission; below-opening
carriers acquire no authority. The index reader binds the opening predecessor,
then independently checks every raw carrier through the exact current checkpoint.
Complete `sub1` history and complete child page-link coverage are separate gates.

API child records include `childLifecycle` and `createdAtBlock`; child lookups
also include the confirmed `parentRecord` ownership epoch and its block height.
The new lane exposes `subdomainPageLink`, `subdomainPageLinks`,
`subdomainPageLinkEvents`, `subdomainPageLinkPendingEvents`,
`subdomainPageLinkHistoricalRecords`, `subdomainPageLinkCoverage` and
`subdomainPageLinkAdmission`. Coverage uses
`dns-subdomain-page-link-core-raw-block-coverage-v1`, the exact checkpoint,
rolling witness and `subdomainPageLinkSha256`. Child lookup `pageLink` is a
consistent Browser alias; root `pageLink` retains its existing meaning. Missing
or incomplete coverage is unavailable, never a verified empty namespace.

Pages and Advanced DNS review the full child name, current root owner, root
epoch, original child create tuple, target txid, self-payment, miner fee, change
and exact public record. The target must be confirmed HTML independently checked
by Browser before review and routing. Signing stays local. Browser opens only a
confirmed active link after coherent root/child/link coverage, then independently
verifies target bytes. Run app remains explicit and isolated.

## Resumable verified discovery

The `sub1`, `page1` and `subpage1` lanes retain independently Core-proven contiguous
prefixes when a bounded read runs out of time. A retry rebinds the retained end
hash to Core and the unique canonical index anchor before verifying the next
tail. Every saved block already passed complete raw-carrier bytes/positions and
descriptor checks, including malformed carriers. Reorgs discard invalid prefixes.
Complete admission still requires exact checkpoint and rolling-witness closure;
progress is operator state, never routing, empty-state or signing authority.
Bounded background warming advances these same shared reads without user actions.
See [deploy/browser-dns/README.md](deploy/browser-dns/README.md) for the scoped
runtime controller and accepted-overlay preservation.
