# ProofOfWork DNS

Canonical documentation for the live ProofOfWork DNS `.pow` registry, backed by
ProofOfWork OP_RETURN events.

## Developer Warning

ProofOfWork DNS is intentionally parallel to ProofOfWork IDs, but it is not an
ID alias and it does not carry PGP keys.

Do not change these without an explicit migration plan:

- Mainnet registry identity: `domains@proofofwork.me`
- Mainnet registry address: `1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY`
- Registration price: `1000` proofs
- Mutation price: `546` proofs for resolver updates, transfers, on-chain listings, seals, delistings, and buyer-funded marketplace transfers
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
dns.proofofwork.me      focused .pow claim/search app
domain.proofofwork.me   redirect to https://dns.proofofwork.me/
domains.proofofwork.me  redirect to https://dns.proofofwork.me/
amo.proofofwork.me      DNS tab for listing, sealing, delisting, and purchases
computer.proofofwork.me AMO workspace with the same DNS tab
```

The DNS launch app stays narrow: connect UniSat, check/search `.pow`
availability, register, view registry stats, view owned names, and view public
registry records. DNS management and trading belong in AMO.

Production reads use the same first-party ProofOfWork OP_RETURN API as the rest
of the Computer:

```text
/api/v1/dns-summary?network=livenet
/api/v1/dns?network=livenet
/api/v1/dns/:name?network=livenet
```

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
address. Mutations and AMO writes require the same 546-proof registry mutation
fee used by ID AMO. The registry payment output must appear before the DNS
OP_RETURN output.

AMO DNS sale tickets use the same sale-ticket lifecycle as IDs, with
`pwdns-sale-v1` authorization JSON and `.pow` asset display. A valid purchase
must spend the active sale-ticket UTXO, pay the seller price plus ticket value,
pay the DNS mutation fee, and write `pwdns1:buy5`.
