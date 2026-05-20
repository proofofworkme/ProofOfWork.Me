# ProofOfWork.Me General Deck

Generated on 2026-05-13.

Purpose: public-facing narrative deck for the current Bitcoin Computer.

Positioning:

```text
ProofOfWork.Me is the Bitcoin Computer: local-first, on-chain, agent-readable software for identity, paid communication, files, pages, markets, funding, tokens, logs, and growth.
```

## Slide 1: The Bitcoin Computer

ProofOfWork.Me

The Bitcoin Computer.

Identity, mail, files, pages, marketplace actions, Pay2Speak funding, token mints, logs, and growth signals written to Bitcoin.

## Slide 2: The Internet Rents Identity

Most identity lives inside platforms.

Accounts can be renamed, banned, rate-limited, captured, or deleted.

The next internet needs identities users can own and agents can verify.

## Slide 3: Bitcoin Is The Source Of Truth

Bitcoin gives the app a hard foundation:

- Durable public state.
- Native money.
- Global verification.
- Local wallet signing.
- Open indexing.
- No platform permission.

Confirmed records are canonical. Pending mempool data is useful gossip, not final truth.

## Slide 4: ProofOfWork IDs

Claim a permanent Bitcoin-native identity:

```text
user@proofofwork.me
```

IDs resolve to Bitcoin receive addresses.

First confirmed valid registration wins.

Owners can update receivers, transfer IDs, and list IDs in the marketplace.

## Slide 5: Bitcoin Mail

Send messages with sats attached.

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

Browser renders HTML from Bitcoin transactions.

Users paste a txid and view HTML from either:

- A ProofOfWork message body.
- A verified `text/html` file attachment.

The page renders inside a sandbox. The txid remains the proof.

## Slide 8: Welcome File

The canonical welcome page is already on Bitcoin:

```text
8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b
```

It appears as the default system file in Files and Desktop.

It opens through Browser by txid.

## Slide 9: Marketplace

ProofOfWork IDs are transferable assets.

Current marketplace protocol:

```text
pwid1:list5
pwid1:seal5
pwid1:buy5
pwid1:delist5
```

Sellers publish on-chain listings.

Buyers settle by spending a sale-ticket UTXO, paying the seller, paying the registry mutation fee, and writing the transfer event.

Competing buys conflict at the Bitcoin UTXO layer.

## Slide 10: Tokens

Tokens are mint-first and Bitcoin-readable.

```text
token.proofofwork.me
work.proofofwork.me
```

Creation pays the token index.

Mints pay each token registry directly at the owner-set price.

WORK starts with 21,000,000 max supply, 1,000 WORK per mint, and 1,000 sats per mint.

That is exactly 1 sat per WORK.

## Slide 11: Log And Growth

Log is the public Bitcoin Computer activity feed.

It indexes registrations, receiver updates, transfers, listings, purchases, messages, replies, files, attachments, Browser-readable pages, Pay2Speak funding, token creations, and token mints.

Growth compares the canonical success-case model against real confirmed network value in sats and USD.

The model adds every new product with consistent inputs:

- Real chain metrics.
- Usage assumptions.
- Value assumptions.
- Fee elasticity.
- Blockspace accounting.

## Slide 12: Agent-Readable By Design

Agents need identity, memory, money, and verifiable state.

ProofOfWork.Me gives agents:

- Handles.
- Chain-readable messages.
- Sats with every interaction.
- Durable files and instructions.
- Public ownership, marketplace, funding, and token records.
- Local wallet authority controlled by humans.

Humans sign. Agents verify.

## Slide 13: The Final Network

ProofOfWork.Me is a new interface for Bitcoin.

Mail.
IDs.
Files.
Desktop.
Browser.
Marketplace.
Pay2Speak.
Tokens.
WORK.
Log.
Growth.
Agents.
Value.

The final network is not a platform.

It is proof of work.
