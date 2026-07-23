# ProofOfWork.Me General Deck

Deck source and product surface updated on 2026-07-23.

Purpose: public-facing narrative deck for the current ProofOfWork Computer.

Positioning:

```text
ProofOfWork.Me is the ProofOfWork Computer: local-first, on-chain, agent-readable software for identity, paid communication, files, pages, markets, credits, wallets, bonds, logs, and growth.
```

## Slide 1: The ProofOfWork Computer

ProofOfWork.Me

The ProofOfWork Computer.

Identity, mail, files, pages, marketplace actions, credit mints, wallet transfers, bonds, logs, and growth signals written to ProofOfWork.

## Slide 2: The Internet Rents Identity

Most identity lives inside platforms.

Accounts can be renamed, banned, rate-limited, captured, or deleted.

The next internet needs identities users can own and agents can verify.

## Slide 3: ProofOfWork Is The Source Of Truth

ProofOfWork gives the app a hard foundation:

- Durable public state.
- Native money.
- Global verification.
- Local wallet signing.
- Open indexing.
- No platform permission.

Confirmed records are canonical. Pending mempool data is useful gossip, not final truth.

## Slide 4: ProofOfWork IDs

Claim a permanent ProofOfWork-native identity:

```text
user@proofofwork.me
```

IDs resolve to ProofOfWork receive addresses.

First confirmed valid registration wins.

Owners can update receivers, transfer IDs, and list IDs in the marketplace.

## Slide 5: ProofOfWork Mail

Send messages with proofs attached.

Every message can carry value, attention, and proof-of-work.

The inbox is sorted by signal, not noise.

Subjects, replies, reply all, contacts, folders, drafts, archive, favorites, backups, and attachments make it feel like normal mail without pretending the chain can be deleted.

## Slide 6: Files And Desktop

ProofOfWork.Me supports small on-chain attachments today.

Images, PDFs, audio, video, text, Markdown, JSON, and code can be previewed in the app.

Desktop turns confirmed public attachments into a search engine:

```text
desktop.proofofwork.me
```

Search any address or confirmed ProofOfWork ID. No wallet required.

## Slide 7: Browser

Browser renders HTML from ProofOfWork transactions.

Users paste a txid and view HTML from either:

- A ProofOfWork message body.
- A verified `text/html` file attachment.

The page renders inside a sandbox. The txid remains the proof.

## Slide 8: Welcome File

The canonical welcome page is already on ProofOfWork:

```text
8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b
```

It appears as the default system file in Files and Desktop.

It opens through Browser by txid.

## Slide 9: Marketplace

ProofOfWork IDs and credits are transferable market assets.

Current marketplace protocols:

```text
pwid1: list5 · seal5 · buy5 · delist5
pwt1:  list5 · seal5 · buy5 · delist5
```

Sellers publish on-chain listings and seal exact sale terms.

Buyers settle by spending a sale-ticket UTXO, paying the seller, paying the registry mutation fee, and writing the transfer or buy event.

Competing buys conflict at the ProofOfWork UTXO layer.

Current governed WORK list, seal, and buy actions use `pwt-sale-v3` with exact atoms and a hash-bound H-1 pricing commitment.

## Slide 10: Credits

Credits are mint-first and ProofOfWork-readable.

```text
credit.proofofwork.me
work.proofofwork.me
```

Creation pays the credit index.

Mints, transfers, listings, seals, delistings, and buys pay each credit registry directly.

WORK starts with 21,000,000 max supply, 1,000 WORK per mint, and 1,000 proofs per mint.

That is exactly 1 proof per WORK.

Wallet is the connected-address credit surface for balances, transfer logs, credit transfers, owned listings, delistings, and sale history.

## Slide 11: Wallet And Bonds

Wallet keeps connected-address signing local:

```text
wallet.proofofwork.me
```

Infinity Bonds issue POWB from confirmed `pwm1:m:powb` actions:

```text
infinity.proofofwork.me
```

Inception Bonds issue INCB from direct proofs plus valid same-transaction WORK attachments fixed by the hash-bound H-1 oracle:

```text
inception.proofofwork.me
```

Both bond families reuse the confirmed credit sale-ticket market while preserving their own supply and network-value rules.

## Slide 12: Log And Growth

Log is the public ProofOfWork Computer activity feed.

It indexes registrations, receiver updates, transfers, listings, seals, delistings, purchases, messages, replies, files, attachments, Browser-readable pages, credit creations, credit mints, credit transfers, credit listings, and credit sales.

Growth compares the canonical success-case model against real confirmed network value in proofs and USD.

WORK and Growth share the same confirmed network-value payload and live node-backed USD benchmark.

The model adds every new product with consistent inputs:

- Real chain metrics.
- Usage assumptions.
- Value assumptions.
- Fee elasticity.
- Blockspace accounting.

## Slide 13: Agent-Readable By Design

Agents need identity, memory, money, and verifiable state.

ProofOfWork.Me gives agents:

- Handles.
- Chain-readable messages.
- Proofs with every interaction.
- Durable files and instructions.
- Public ownership, marketplace, funding, and credit records.
- Local wallet authority controlled by humans.

Humans sign. Agents verify.

## Slide 14: The Final Network

ProofOfWork.Me is a new interface for ProofOfWork.

Mail. IDs. Files. Desktop. Browser.

Marketplace. Credits. Wallet. WORK.

Infinity. Inception. Bonds. Log. Growth.

Agents. Value.

The final network is not a platform.

It is proof of work.
