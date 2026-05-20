# Unwriter GitHub Repository Research

Research date: 2026-05-06

Scope: Public repositories listed at https://github.com/unwriter?tab=repositories on 2026-05-06. I used GitHub metadata, shallow local clones, READMEs, package manifests, and representative source files. Repo activity dates below are GitHub `updated_at` values unless otherwise noted.

## ProofOfWork.Me Launch Relevance

This research informed the current BTC OP_RETURN architecture, but the Phase 1 launch is now fixed around a simpler canonical registry:

```text
id.proofofwork.me
registry: bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e
protocol: pwid1:r2:<id-base64url>:<owner-address>:<receive-address>:<pgp-public-key-base64url?>
price: 1000 sats
```

Future developers should use this research for architectural ideas, not as permission to swap the ID registry protocol, change the registry address, or introduce BSV-style `OP_FALSE OP_RETURN` patterns. ProofOfWork.Me BTC transactions should stay BTC-standard: `OP_RETURN` first, push-only data, and aggregate data-carrier size enforced across all OP_RETURN outputs.

## Executive Summary

Unwriter's GitHub account is a compact 2018-2020 era body of work around Bitcoin-as-data-infrastructure. The major themes are:

- Writing data transactions: `datapay`, `datacash`, `databutton`, `bitpipe`, `BitcoinMediaUpload`.
- Naming and retrieving on-chain data: `B`, `c`, `Bitcom`, `fatURI`.
- Indexing/querying transaction data: `bitd`, `bitdb`, `b0`, `b1`, `b2`, `oldbitquery2`, plus support utilities `bigjq`, `streamjq`, and the `mingo` fork.
- User-facing on-chain applications: `alice`, `bitmedia`, `bitchat`, `Eli`, `_opreturn`, `memobutton`, `memochicken`, `readcash`, `bitgraph`, `bitkey`.
- Chain/library scaffolding: `bitcore-lib-cash`, `bsv-message`, `docker-bitcoin`.

The most reusable ideas for BTC are not the old network endpoints or legacy wallet dependencies. The reusable core is the architecture:

1. Compose a simple declarative transaction object.
2. Put application data in an `OP_RETURN` protocol envelope.
3. Broadcast through a service or wallet flow.
4. Index mempool and block data into queryable collections.
5. Serve media and apps back from transaction IDs or content hashes.

## BTC OP_RETURN Context

Bitcoin Core v30.0 changed relay/mining defaults in a way that makes many of these BSV-era patterns worth revisiting on BTC:

- `-datacarriersize` was increased to `100000` by default, which effectively pushes the data-carrier limit up to the standard transaction size limit.
- Multiple data-carrier (`OP_RETURN`) outputs per transaction are now permitted by default.
- The limit applies across all data-carrier outputs in a transaction.
- These are relay/mining policy defaults, not consensus guarantees. Some nodes and miners may still use smaller limits.
- Bitcoin Core v31.0 is current as of this research date and keeps the same effective 100,000 byte default via `MAX_OP_RETURN_RELAY`.

Important BTC porting detail: Bitcoin Core's nulldata classifier expects the scriptPubKey to start with `OP_RETURN` and then push-only data. BSV's later `OP_FALSE OP_RETURN` / "safe" pattern appears throughout Unwriter's BSV work, especially `datapay`. That pattern should be changed or disabled for BTC relay compatibility.

Sources:

- Bitcoin Core 30.0 release notes: https://bitcoincore.org/en/releases/30.0/
- Bitcoin Core 31.0 release notes: https://bitcoincore.org/en/releases/31.0/
- Bitcoin Core v31.0 source, `solver.cpp` nulldata detection: https://github.com/bitcoin/bitcoin/blob/v31.0/src/script/solver.cpp
- Bitcoin Core v31.0 source, standard transaction datacarrier accounting: https://github.com/bitcoin/bitcoin/blob/v31.0/src/policy/policy.cpp
- Bitcoin Core v31.0 source, default `MAX_OP_RETURN_RELAY`: https://github.com/bitcoin/bitcoin/blob/v31.0/src/policy/policy.h

## Porting Priority

Highest-value BTC ports:

- `B`: Protocol-level file/media envelope for `OP_RETURN`.
- `datapay`: Declarative transaction builder/broadcaster, but it needs a BTC-native signing and broadcast layer.
- `databutton`: Wallet/payment-button UX pattern for building user-approved data transactions.
- `bitpipe`: Broadcast/signing microservice pattern for subsidized or delegated posting.
- `c`: Content-addressed layer over `B://`.
- `bitdb`/`b0` lineage: Indexer/query system, rebuilt around Bitcoin Core ZMQ, Esplora/electrs, or a custom parser.
- `BitcoinMediaUpload`, `alice`, `bitmedia`: Demos that directly show what large BTC `OP_RETURN` enables.

Lower-value or mostly historical:

- `bsv-message`, `bitcore-lib-cash`, `docker-bitcoin`, `mingo`, `edgyhub`, `memodemo`, `web`.

## Repo Notes

### alice

Repo: https://github.com/unwriter/alice

Metadata: HTML. 9 stars, 2 forks. Created 2019-01-23. Updated 2025-05-31. No README.

What it is: A static demo called "Alice in BitcoinLand" that loads an HTML document from a single Bitcoin SV transaction via BitDB/Babel. The local `index.html` queries transaction `b742886801560f57b4dc824ce3a1719613d8b2d38530909fe988c1ca04cc82af`, reconstructs long string chunks from `out[1].lsN` fields, and injects the result into the page.

Technical notes:

- Shows the core "website stored in one transaction" pattern.
- Depends on `babel.bitdb.network` and a hardcoded API key.
- Treats the blockchain as content storage and a public CDN index.
- Has an image and social card metadata framing the demo.

BTC port notes: This is directly relevant under the new BTC policy. A single HTML file below roughly 100 KB can now plausibly live inside a standard BTC `OP_RETURN` output if miners relay it. For ProofOfWork.Me, this is a strong demo pattern: publish a small page/app shell on BTC, then resolve it by txid. Replace BitDB with a BTC indexer that fetches nulldata payloads from a txid.

### B

Repo: https://github.com/unwriter/B

Metadata: No primary language detected. 71 stars, 10 forks. Created 2019-01-28. Updated 2026-04-06. Homepage: https://b.bitdb.network.

What it is: The `B://` Bitcoin Data Protocol. It specifies an `OP_RETURN` envelope for storing arbitrary public media on-chain and referencing it from other on-chain documents.

Protocol shape:

```text
OP_RETURN
19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut
[Data]
[Media Type]
[Encoding]
[Filename]
```

Key idea: `B://<txid>` is a URI for a transaction that contains media data. Other HTML or Markdown can reference `b://...` links and images.

Technical notes:

- Prefix/address: `19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut`.
- Supports raw binary data using ArrayBuffer, not just base64 text.
- Media type follows IANA media types.
- Encoding defaults to `binary`.
- Filename is optional.
- Explicitly not an authenticated/encrypted media protocol.

BTC port notes: This is one of the most important repos to port. The protocol can mostly survive unchanged, but a BTC version should:

- Use `OP_RETURN` as the first opcode, not BSV `OP_FALSE OP_RETURN`.
- Define a max payload target around the 100,000 byte default minus script overhead and fee safety margin.
- Add a chunking or manifest convention for objects over the standard transaction size.
- Include SHA-256 content hash metadata so retrieved bytes can be verified without trusting an indexer.
- Use a BTC resolver endpoint, likely `/b/:txid`, backed by a local Core/electrs/Esplora index.

### b0

Repo: https://github.com/unwriter/b0

Metadata: JavaScript. 0 stars, 1 fork. Created 2018-09-16. Updated 2023-07-25. No README.

What it is: A BitDB-style daemon that indexes transaction inputs and outputs into MongoDB. It reads blocks and mempool from a local bitcoind RPC/ZMQ node, decodes transaction xputs with `bton`, filters with `mingo`, stores state in LevelDB, and writes `confirmed` / `unconfirmed` MongoDB collections.

Technical notes:

- Starts indexing at block height `525470`.
- `bitdb.json` has no filter, so this variant indexes broad xput data.
- Mongo indexes include sender, receiver, tx, block, `b0..b19`, `s0..s19`, and full-text string indexes.
- Supports mempool sync and periodic block catch-up.
- Publishes ZMQ notifications to an outgoing local socket.

BTC port notes: Architecturally valuable. The current code is old and BSV/BCH-shaped, but the indexing pattern maps well to BTC: Core RPC + ZMQ -> transaction decoder -> nulldata filter -> Mongo/Postgres/SQLite collections -> query API. For BTC `OP_RETURN`, the decoder should store script hex, ASM, push buffers, text fallbacks, tx fee, vsize, block metadata, and policy acceptance context.

### b1

Repo: https://github.com/unwriter/b1

Metadata: JavaScript. 0 stars, 1 fork. Created 2018-09-21. Updated 2023-07-25. No README.

What it is: A narrower BitDB daemon variant. It shares the same file layout as `b0` but includes a `bitdb.json` filter for outputs where `b0` is opcode `106`, i.e. `OP_RETURN`.

Technical notes:

- Starts at block height `525470`.
- Indexes into MongoDB with keys for tx, senders, receivers, block, string, and pushdata fields.
- Uses local RPC/ZMQ and `bton`.
- More directly aligned with application-layer protocols than `b0`.

BTC port notes: This is the best starting point for a BTC nulldata indexer conceptually. A modern rebuild should index only `TxoutType::NULL_DATA` outputs and expose fields similar to BitDB's `out.sN`, `out.hN`, `out.bN`, plus raw script bytes. Add support for multiple `OP_RETURN` outputs per transaction because Core v30+ permits them by default.

### b2

Repo: https://github.com/unwriter/b2

Metadata: JavaScript. 0 stars, 1 fork. Created 2018-09-20. Updated 2023-07-25. No README.

What it is: Another BitDB daemon variant close to `b1`, but with no `OP_RETURN` filter in `bitdb.json`. It appears to be an experimental version around the same xput indexing model.

Technical notes:

- Starts at block height `525470`.
- Uses MongoDB indexes for tx, senders, receivers, block metadata, and decoded push/string fields.
- RPC/ZMQ settings default to localhost.

BTC port notes: Treat as historical reference. If porting the indexer line, merge lessons from `b0`, `b1`, and `b2` into one clean BTC daemon rather than preserving each variant.

### biggybank

Repo: https://github.com/unwriter/biggybank

Metadata: JavaScript, MIT. 7 stars, 3 forks. Created 2019-06-21. Updated 2023-07-25. NPM package `biggybank` v0.0.6.

What it is: A console helper that displays a Bitcoin SV address, QR code, and a Money Button payment URL so a developer can refill an app wallet from the terminal.

Technical notes:

- Depends on `datapay` and `qrcode-terminal`.
- Can accept a raw address, custom message, custom Insight endpoint, or a Money Button payload.
- Designed for developer-operated services that need funded posting keys.

BTC port notes: Useful as UX glue, not as protocol infrastructure. A BTC port would replace Money Button with a BIP21 URI, Lightning fallback if desired, and maybe PSBT funding instructions. For ProofOfWork.Me, the relevant pattern is "make funding an app posting key easy from the CLI."

### bigjq

Repo: https://github.com/unwriter/bigjq

Metadata: JavaScript. 4 stars, 4 forks. Created 2018-10-05. Updated 2022-01-17. NPM package `bigjq` v0.0.7.

What it is: A wrapper around `node-jq` that passes large JSON input through stdin to avoid command argument size limits.

Technical notes:

- Provides `jq.run(filter, data)`.
- Uses `node-jq` underneath.
- Added for large BitDB query/response transforms.

BTC port notes: Still useful for stream/query tooling, although modern Node or direct `jq` subprocess usage may be simpler. Could help transform large transaction/index responses.

### bitchat

Repo: https://github.com/unwriter/bitchat

Metadata: JavaScript. 21 stars, 10 forks. Created 2019-01-22. Updated 2025-11-19. NPM package `bitchat` v0.0.5.

What it is: A terminal "realtime chat over Bitcoin" client. It reads recent chat messages from BitDB, subscribes to live messages through Bitsocket/EventSource, and sends messages by POSTing a Datapay payload to a local Bitpipe signer/broadcaster.

Protocol shape:

- Query watches `out.b0` as `OP_RETURN` and `out.b1` as `OP_0`.
- Message body is in `out[0].s2`.
- Sending uses `data: ["", line]`, then Bitpipe prepends `USERNAME:`.

Technical notes:

- Uses `bitpipe`, `eventsource`, `axios`, `chalk`, `figlet`, `moment`, and desktop notifications.
- Includes local WIF key management via `.env`.
- Explicitly targets Bitcoin SV.

BTC port notes: The app pattern is relevant, but a BTC chat over 100 KB `OP_RETURN` should probably use a compact protocol instead of free-form large messages. Replace Bitsocket with a BTC mempool/block subscription service. Fees will dominate, so the product should surface cost and maybe batch messages or use a channel-like manifest.

### BitcoinMediaUpload

Repo: https://github.com/unwriter/BitcoinMediaUpload

Metadata: JavaScript. 16 stars, 3 forks. Created 2019-01-25. Updated 2023-03-09. Package name `bppp` v0.0.2.

What it is: A small demo set for uploading media to Bitcoin with `datapay` or `bitpipe`.

Files:

- `simple.js`: upload an image directly with Datapay.
- `build.js`: build/export a transaction for manual broadcast.
- `pipe.js`: submit Datapay JSON to a Bitpipe service.

Technical notes:

- Uses `image-data-uri` in the demo, plus `datapay` and `bitpipe`.
- Important as a pedagogical bridge between low-level transaction building and user-facing uploaders.

BTC port notes: High-value demo to recreate. Update it to compare raw binary `OP_RETURN`, base64 data URI, and content-addressed `B://` style payloads. Use a BTC transaction builder and mempool/broadcast API.

### Bitcom

Repo: https://github.com/unwriter/Bitcom

Metadata: JavaScript. 52 stars, 16 forks. Created 2019-01-25. Updated 2025-07-19. NPM package `bitcom` v0.1.2.

What it is: "Universal Bitcoin Computer", a command-line model for publishing application protocols and commands to Bitcoin. It is inspired by Unix commands/filesystems and aims to create a decentralized registry of Bitcoin application protocols.

Technical notes:

- CLI binary is `bit`.
- Commands include `init`, `whoami`, `useradd`, `echo`, `cat`, and `route`.
- `init` creates a `.bit` file with BSV private key, address, and public key.
- `post()` publishes command pushdata through `datapay.send`.
- Route commands use BitDB/Babel queries to check route records.

Protocol idea:

- Command payloads start with `$`, then command name and arguments.
- Examples: `["$", "echo", content, "to", filename]` and route declarations.

BTC port notes: The registry concept is valuable. BTC port should be protocol-first rather than CLI-first:

- Define a `pow://` or `bitcom://` protocol envelope in BTC `OP_RETURN`.
- Separate identity, route registration, content publish, and resolution.
- Avoid WIF storage in plaintext `.bit`; use descriptors, PSBT, hardware wallet, or browser wallet signing.
- Replace BitDB route lookup with local indexer queries.

### bitcore-lib-cash

Repo: https://github.com/unwriter/bitcore-lib-cash

Metadata: JavaScript, fork of BitPay's Bitcoin Cash library. 1 star, 0 forks under Unwriter. Created 2018-05-11. Updated 2018-06-10. License shown as noassertion.

What it is: A forked copy of `bitcore-lib-cash`, a JavaScript Bitcoin Cash transaction/key/script library.

Technical notes:

- Large vendor-style library.
- Used by `datacash`.
- Has docs and tests for address, block, crypto, transaction, URI, etc.

BTC port notes: Do not port this directly. Use modern BTC libraries and PSBT support instead. Useful only to understand how `datacash` built BCH transactions.

### bitd

Repo: https://github.com/unwriter/bitd

Metadata: JavaScript. 29 stars, 4 forks. Created 2018-06-29. Updated 2023-12-22. Marked deprecated in description, replaced by Planaria.

What it is: The early BitDB daemon. It connects to a local Bitcoin RPC/ZMQ node, parses OP_RETURN transactions, and writes them into MongoDB.

Technical notes:

- Depends on `bitcoincashjs`, `bitcoind-rpc`, `mongodb`, `zeromq`, `iconv-lite`.
- `index.js` wires local RPC, ZMQ mempool/block handlers, and Mongo processing.
- README is minimal and requires local MongoDB.

BTC port notes: Historical predecessor to `b0/b1/b2` and Planaria. For BTC, use it as a conceptual map: node event stream -> parser -> database -> query API. Do not reuse the code as-is.

### bitdb

Repo: https://github.com/unwriter/bitdb

Metadata: JavaScript. 25 stars, 8 forks. Created 2018-06-29. Updated 2022-10-13. Deprecated in description, replaced by Planaria.

What it is: A Node client for reading a local BitDB MongoDB instance.

Technical notes:

- Main API is `bitdb.read()`.
- Reads both `confirmed` and `unconfirmed` collections.
- Supports Mongo `find`, `aggregate`, `sort`, `project`, `limit`, and `distinct`.
- Handles binary field encoding/decoding for pushdata fields.

BTC port notes: The API shape is still good. A BTC replacement could expose a BitDB-like query API over normalized transaction/output tables. It should not expose raw Mongo access casually in production; use validated query subsets or prebuilt endpoints.

### bitgraph

Repo: https://github.com/unwriter/bitgraph

Metadata: HTML. 5 stars, 2 forks. Created 2019-07-20. Updated 2023-07-25.

What it is: A browser-based Bitcoin transaction/address/block graph explorer built with Cytoscape. It queries BitDB endpoints, renders graph nodes/edges, and listens to live unconfirmed transactions with EventSource.

Technical notes:

- Uses Cytoscape, Dagre/Klay layouts, Noty, and jscolor.
- Can query by tx, address, or block.
- Uses `euler`, `chronos`, `genesis`, and `meta` BitDB endpoints.
- Graph model represents txs, addresses, outputs, input edges, and output edges.

BTC port notes: Valuable visualization concept. A modern BTC version could visualize `OP_RETURN` application graphs: content tx -> reference tx -> author/funding address -> protocol prefix. This is especially useful for explaining on-chain websites/media and protocol registries.

### bitkey

Repo: https://github.com/unwriter/bitkey

Metadata: HTML/JavaScript app. 4 stars, 1 fork. Created 2019-11-11. Updated 2023-07-25. NPM package `bitkey` v0.0.1.

What it is: A global Bitcoin user database for paymail public keys stored on Bitcoin. The server fetches paymail identity data, signs a hash of handle+pubkey, and renders a Money Button flow to publish identity records.

Technical notes:

- Express/EJS app using `bsv`, `bsv/message`, `axios`, and Money Button.
- Supports Money Button paymail and had HandCash route scaffolding.
- `/how` explains the protocol:

```text
OP_0
OP_RETURN
[Bitcom Address]
[Paymail]
[Public Key]
[Message]
[Signature]
```

- Front page queries BitDB for records with a known address in `out.s2`.

BTC port notes: Conceptually relevant if ProofOfWork.Me needs portable identity attestations. On BTC, use `OP_RETURN <protocol> <identifier> <pubkey> <signature>`, but avoid old paymail assumptions. Consider nostr pubkeys, DID-like identifiers, or domain-based attestations.

### bitmedia

Repo: https://github.com/unwriter/bitmedia

Metadata: HTML. 4 stars, 2 forks. Created 2019-01-24. Updated 2023-07-25. No README.

What it is: A tiny media viewer that accepts a transaction hash in the URL hash, queries BitDB/Babel, extracts a long string field, and renders it as an image, data URI, HTML image tag, or text.

Technical notes:

- Hardcoded Babel endpoint and API key.
- Looks for `lsN` output fields.
- Designed for "single push data Bitcoin transaction" media.

BTC port notes: Very portable as a resolver/viewer. Replace BitDB lookup with BTC indexer lookup and add safe rendering rules. For security, avoid direct `innerHTML` for arbitrary HTML unless intentionally building an on-chain browser sandbox.

### bitpipe

Repo: https://github.com/unwriter/bitpipe

Metadata: JavaScript. 33 stars, 9 forks. Created 2019-01-21. Updated 2025-11-19. NPM package `bitpipe` v0.0.12.

What it is: A transaction broadcast microservice powered by Datapay. It accepts declarative Datapay JSON, optionally transforms or filters it with a server-side lambda, signs with one of the server's keys, and broadcasts.

Technical notes:

- Express server with `/bitpipe` POST endpoint.
- Supports signed raw tx passthrough or unsigned Datapay payloads.
- Reads private keys from `.env` and rotates through them.
- Supports local RPC mode or remote Insight mode.
- Lambda pattern enables filter/map transforms before signing.

BTC port notes: One of the most important infrastructure patterns to port. A BTC version should:

- Accept PSBTs and raw txs, not just WIF-signed payloads.
- Support policy checks: script starts with `OP_RETURN`, aggregate datacarrier size, vsize, fee rate, dust, and RBF.
- Make subsidized posting explicit with quotas/rate limits.
- Use Bitcoin Core RPC `sendrawtransaction`, mempool.space, or a private relay/broadcaster.
- Never keep hot WIF keys in plaintext for production.

### bsv-message

Repo: https://github.com/unwriter/bsv-message

Metadata: JavaScript, fork of BitPay bitcore-message. 4 stars, 1 fork. Created 2018-12-19. Updated 2022-04-02. NPM package `bsv-message` v1.0.3.

What it is: Message signing and verification support adapted to BSV.

Technical notes:

- Depends on `bsv`.
- Exposes the familiar `Message('hello').sign(privateKey)` / `.verify(address, signature)` flow.

BTC port notes: Mostly not needed. BTC projects should use maintained message-signing standards and libraries. If identity signatures matter, prefer BIP-322-compatible signing rather than legacy "Bitcoin Signed Message" formats.

### buttonpage

Repo: https://github.com/unwriter/buttonpage

Metadata: HTML. 4 stars, 1 fork. Created 2019-01-26. Updated 2023-07-25. No README.

What it is: A shareable Money Button landing page generator. The URL hash contains base64-encoded JSON payload for Money Button rendering.

Technical notes:

- Uses Ace editor and Money Button.
- Lets users edit JSON payload and regenerates a shareable URL.
- Adds callbacks for payment success/error and links to Whatsonchain tx.

BTC port notes: Useful UX pattern for "share a transaction intent." Modern BTC version could encode a PSBT, BIP21 URI, or app-specific publish request into a URL. For large data payloads, avoid stuffing raw payloads into URL hashes; store draft content locally or in a backend and have the wallet sign a PSBT.

### c

Repo: https://github.com/unwriter/c

Metadata: JavaScript. 7 stars, 5 forks. Created 2019-04-18. Updated 2023-12-27. Package name `planarian`.

What it is: `C://`, a content-addressed file layer over `B://`. Instead of identifying media only by txid, it stores files by SHA-256 hash of their content and maps B txids to C hashes.

Technical notes:

- README positions `C://` as immutable, content-addressable, and trustless.
- `planaria.js` scans B protocol transactions with prefix `19Hxig...`, extracts payloads, ungzips if `out.s4 === "gzip"`, hashes bytes with SHA-256, stores files to disk, records media type and B->C mapping in LMDB, and indexes into `c` and `u` collections.
- `planarium.js` exposes routes `/c/:id` and `/b/:id`, setting `Content-Type` from LMDB and streaming bytes from disk.
- Uses Planaria/Planarium conventions.

BTC port notes: Extremely relevant. This is the right answer to the trust problem in `B://` txid addressing. For BTC:

- Keep `c://<sha256>` as the integrity-first URI.
- Support `/b/:txid` as convenience and `/c/:sha256` as verified retrieval.
- Include content hash in manifests and maybe in the `OP_RETURN` payload itself.
- Add chunk manifests for objects over the standard transaction size.

### cryptograffitiweb

Repo: https://github.com/unwriter/cryptograffitiweb

Metadata: HTML. 8 stars, 4 forks. Created 2018-09-29. Updated 2023-07-25. No README.

What it is: A simple renderer for websites uploaded through cryptograffiti.info. It accepts a tx hash or address, queries BitDB v2, concatenates `out.s2` values, and writes the result into the page.

Technical notes:

- Supports URL hash `#@<txid>` or address lookup.
- Uses old `https://bitdb.network/q/` endpoint and v2 query shape.
- Directly `document.write`s fetched content.

BTC port notes: Historically important as an early on-chain website renderer. For BTC, port the retrieval concept but sandbox rendering. Do not use unrestricted `document.write` on arbitrary transaction content in a production app.

### databutton

Repo: https://github.com/unwriter/databutton

Metadata: JavaScript. 24 stars, 7 forks. Created 2018-10-02. Updated 2023-07-25. NPM package `databutton` v0.0.4.

What it is: A Datapay plugin for building Money Button transactions that include arbitrary data outputs.

Technical notes:

- Browser-only helper.
- Uses Datapay to build a transaction script, converts the output script to ASM, and passes it to Money Button as a zero-amount output.
- Supports string/hex data and file input as ArrayBuffer.
- Provides helper functions for file metadata: file bytes, MIME type, name, size, last modified.
- Supports additional payment outputs through `$pay.to`.

BTC port notes: High value UX idea. A BTC version should target wallet-native PSBTs or browser wallet APIs rather than Money Button. The builder should produce a standard BTC nulldata output and expose a clear cost/fee estimate before signing.

### datacash

Repo: https://github.com/unwriter/datacash

Metadata: JavaScript. 58 stars, 17 forks. Created 2018-05-12. Updated 2024-05-01. Topics: `bch`, `bitcoincash`, `blockchain`, `javascript`. NPM package `datacash` v1.2.0.

What it is: A declarative Bitcoin Cash transaction builder and broadcaster focused on OP_RETURN data.

Technical notes:

- API has two main methods: `build` and `send`.
- Payload keys: `data`, `cash`, `tx`.
- `data` can be an array of strings/hex strings or a raw script hex string.
- `cash` handles key, RPC endpoint, fee, and payment outputs.
- Uses `bitcore-lib-cash` and `bitcore-explorers`.
- Default RPC endpoint is `https://cashexplorer.bitcoin.com`.
- Uses `OP_RETURN` directly, unlike later `datapay` safe default.

BTC port notes: Conceptually close to what BTC needs, but BCH libraries/endpoints are obsolete for our purpose. A BTC port could copy the declarative API shape:

```js
btcdata.build({
  data: ["<protocol>", bytes, "text/html", "utf-8", "index.html"],
  pay: { psbt: true, feeRate: 5 }
})
```

Use modern BTC transaction construction and PSBTs. Add binary Buffer/ArrayBuffer support from `datapay`.

### datapay

Repo: https://github.com/unwriter/datapay

Metadata: JavaScript. 83 stars, 42 forks. Created 2019-01-30. Updated 2026-03-15. NPM package `datapay` v0.0.22.

What it is: The core BSV declarative transaction builder/broadcaster. It is the central dependency for many later Unwriter repos.

Technical notes:

- API has two main methods: `build` and `send`.
- Payload keys: `safe`, `data`, `pay`, `tx`.
- `data` supports strings, `0x` hex strings, Buffer, ArrayBuffer, and opcode objects.
- `pay` handles WIF key, RPC endpoint, fee, fee per byte estimate, UTXO filter, and extra payment outputs.
- `tx` can import a prior raw transaction.
- Defaults: RPC `api.mattercloud.net`, fee `400`, fee byte multiplier `1.4`.
- Source defaults `safe` to true, adding `OP_FALSE` before `OP_RETURN`.

BTC port notes: This is the main engineering target, but should be rewritten rather than lightly patched. Required changes:

- Standard BTC `OP_RETURN` output must start with `OP_RETURN`.
- Replace `bsv` and `bitcore-explorers` with modern BTC/PSBT libraries and APIs.
- Support SegWit/Taproot inputs and fee calculation by vbytes.
- Separate build, fund, sign, and broadcast steps.
- Enforce Core v30+ datacarrier policy locally.
- Make binary payload size and fee estimation visible before signing.

### difficulty

Repo: https://github.com/unwriter/difficulty

Metadata: HTML. 1 star, 1 fork. Created 2019-01-17. Updated 2023-07-25. No README.

What it is: A one-page Chart.js visualization of Bitcoin difficulty from BitDB meta endpoint.

Technical notes:

- Queries `meta.bitdb.network` for blocks with height >= 556000.
- Projects `difficulty` and `height`.
- Renders a line chart.

BTC port notes: Not directly related to OP_RETURN. Could be replaced with modern Core RPC or public block API if ProofOfWork.Me wants chain status visualizations.

### docker-bitcoin

Repo: https://github.com/unwriter/docker-bitcoin

Metadata: Dockerfile, fork of `zquestz/docker-bitcoin`, MIT. 1 star, 1 fork. Created 2018-09-11. Updated 2023-07-25.

What it is: Docker images for Bitcoin Cash full nodes: Bitcoin ABC, Bitcoin Unlimited, and Bitcoin XT.

Technical notes:

- Provides generated Dockerfiles, entrypoint, versions manifest, Compose and Kubernetes examples.
- Not Unwriter-specific beyond being useful for running BCH infrastructure.

BTC port notes: Not useful for BTC directly. Use maintained Bitcoin Core Docker images or build from official releases.

### edgyhub

Repo: https://github.com/unwriter/edgyhub

Metadata: CSS. 2 stars, 3 forks. Created 2020-06-23. Updated 2026-03-08.

What it is: A Chrome extension that removes rounded corners from GitHub UI.

BTC port notes: No relevance to OP_RETURN or Bitcoin application work.

### Eli

Repo: https://github.com/unwriter/Eli

Metadata: JavaScript. 11 stars, 5 forks. Created 2019-01-23. Updated 2023-07-25. Package name `bitcoinbot` v0.0.1.

What it is: An Eliza chatbot that lives on Bitcoin. It listens to Bitchat messages via Bitsocket, runs them through Eliza logic, and sends replies as new Bitchat transactions through Bitpipe.

Technical notes:

- Uses Bitsocket/Chronos EventSource subscription.
- Uses Bitpipe on port 8082.
- Lambda prepends `Eli: ` to outgoing payloads.
- Responds probabilistically based on a "chatty" counter.
- README explicitly argues BSV welcomes data transactions.

BTC port notes: Valuable as an autonomous agent pattern: listen to on-chain protocol events, transform them, post a new transaction. On BTC, fee economics and policy variability make this expensive, so use it for high-signal events or batched attestations, not casual chat spam.

### fatURI

Repo: https://github.com/unwriter/fatURI

Metadata: No primary language. 18 stars, 4 forks. Created 2018-08-30. Updated 2025-02-05.

What it is: A proposal to extend BIP21-style Bitcoin URIs with a `tx` parameter containing a full raw transaction hex string.

Technical notes:

- Chain-agnostic proposal: `bitcoin:?tx=[RAW TRANSACTION HEX]` or `bitcoincash:?tx=[RAW TRANSACTION HEX]`.
- Motivation is to unbundle compose, sign, and broadcast.
- Enables wallets to approve complex transactions without every app needing key custody.
- Applies to OP_RETURN apps, multisig, timelocks, tokens, and pre-signed transactions.

BTC port notes: Very relevant. Today this idea maps naturally to PSBTs and wallet handoff. For ProofOfWork.Me, prefer a PSBT/BIP21 style handoff over app-managed private keys. The key product idea is still excellent: app composes, wallet signs, broadcaster broadcasts.

### memobutton

Repo: https://github.com/unwriter/memobutton

Metadata: HTML. 8 stars, 1 fork. Created 2018-10-02. Updated 2023-07-25.

What it is: A browser app for posting to Memo.cash using Money Button, Datapay, Databutton, and BitDB.

Technical notes:

- Memo post protocol uses `0x6d02`.
- Databutton builds Money Button outputs from data.
- Reads feed from a BitDB endpoint, rendering unconfirmed and confirmed posts.

BTC port notes: Useful UX reference for a simple "type message -> wallet signs OP_RETURN -> feed updates" app. On BTC, rename/reframe away from Memo.cash and use a new protocol prefix. Fees make short attestations more realistic than chatty social posting.

### memochicken

Repo: https://github.com/unwriter/memochicken

Metadata: HTML/JavaScript. 3 stars, 3 forks. Created 2018-10-28. Updated 2023-07-25. Homepage: https://unwriter.github.io/memochicken.

What it is: An autonomous app demo: users post a Memo.cash message with `#memochicken` and payment; a relayer watches Bitsocket, checks the payment amount, and sends BCH to the HandCash `$chicken` handle to trigger a chicken feeder.

Technical notes:

- Client uses Money Button/Databutton pattern.
- Server uses Bitsocket, `datacash`, Coinbase exchange rate API, and HandCash API.
- Demonstrates "on-chain event -> conditional off-chain/on-chain action."

BTC port notes: Architecturally useful for ProofOfWork.Me automation. The BTC version would watch an `OP_RETURN` event plus payment output, verify the amount, then trigger a service. Replace HandCash/Memo with modern APIs and use stricter replay/idempotency tracking.

### memodemo

Repo: https://github.com/unwriter/memodemo

Metadata: Empty repo. 1 star, 0 forks. Created 2018-09-25. Updated 2023-07-25.

What it is: Empty placeholder.

BTC port notes: No actionable material.

### mingo

Repo: https://github.com/unwriter/mingo

Metadata: JavaScript, fork of `kofrasa/mingo`, MIT. 3 stars, 1 fork. Created 2019-08-19. Updated 2023-07-25. Package version in clone: 2.3.5.

What it is: JavaScript implementation of MongoDB query language, used by several Unwriter tools for filtering objects in memory.

Technical notes:

- Supports query/projection operators and aggregation framework.
- Used by `b0`/`datapay` style filters.

BTC port notes: Use an up-to-date maintained version if needed. The concept remains useful for local filters over decoded tx/output objects.

### oldbitquery2

Repo: https://github.com/unwriter/oldbitquery2

Metadata: JavaScript. 0 stars, 1 fork. Created 2018-10-04. Updated 2018-10-04. Description says deprecated and archived.

What it is: Deprecated Bitquery v2 query engine for direct MongoDB access to a BitDB node.

Technical notes:

- API validates `v` and `q` fields.
- Supports `find`, `aggregate`, `sort`, `project`, `limit`, `distinct`.
- Encodes query values for binary fields and decodes response fields.
- Connects to `mongodb://localhost:27017` by default.

BTC port notes: Historical only. Useful for understanding the BitDB query language evolution from `request/response` to `v/e/q` query objects.

### readcash

Repo: https://github.com/unwriter/readcash

Metadata: JavaScript, MIT. 19 stars, 7 forks. Created 2018-06-04. Updated 2026-01-18. Default branch `gh-pages`. Homepage: https://read.cash.

What it is: A serverless wallet watcher for multiple BCH app wallets. Users add public addresses, see balances, and generate QR/share links without exposing private keys.

Technical notes:

- Static frontend hosted on GitHub Pages.
- Uses public addresses only.
- Local/browser-side data model.
- Includes vendor copies of `datacash`, `bchaddrjs`, QR code, Bootstrap, Handlebars, FontAwesome, and JSON diff patch.
- Provides URL patterns like `/add#[address]` and `/share#[address]`.

BTC port notes: Useful for account/watch-only UX. For ProofOfWork.Me, this pattern could monitor posting keys, protocol addresses, and app wallets with zero private-key custody. Replace BCH libraries with BTC address/descriptor support and modern APIs.

### streamjq

Repo: https://github.com/unwriter/streamjq

Metadata: JavaScript. 10 stars, 5 forks. Created 2019-07-29. Updated 2023-07-25. NPM package `streamjq` v0.0.9.

What it is: A streaming `jq` wrapper: readable stream -> jq filter -> writable stream.

Technical notes:

- Downloads/builds jq binary during install.
- Uses `JSONStream`, `event-stream`, `bin-build`, `download`, `tempfile`.
- README example transforms a BitDB response stream.

BTC port notes: Useful for a CLI/data pipeline around transaction indexer output. Audit dependencies if reused because this is old Node ecosystem code.

### web

Repo: https://github.com/unwriter/web

Metadata: Empty repo. 2 stars, 0 forks. Created 2019-03-30. Updated 2022-09-06.

What it is: Empty placeholder.

BTC port notes: No actionable material.

### _opreturn

Repo: https://github.com/unwriter/_opreturn

Metadata: JavaScript. 16 stars, 5 forks. Created 2018-05-31. Updated 2022-02-10. Homepage: https://twitter.com/_opreturn.

What it is: A Twitter bot that mirrors Bitcoin Cash social protocol posts from Memo.cash and Matter.cash to Twitter. It uses Bitsocket EventSource to watch realtime OP_RETURN activity and posts matching content through Twitter API.

Technical notes:

- Watches all outputs where `out.b0` is `OP_RETURN`.
- Memo.cash protocol branches include `6d02`, `6d03`, `6d0c`, `6d10`.
- Matter.cash branch watches `9d01`.
- Posts all regular Memo posts and selectively posts replies/topics/polls that mention `@_opreturn`.

BTC port notes: Strong event-bridge pattern. For BTC, bridge high-value protocol events from `OP_RETURN` into web/social/search surfaces. Be careful with moderation, spam, and cost incentives.

## Cross-Repo Architecture Lessons

### 1. Separate data protocol from transport

`B`, `C`, and `Bitcom` define protocol shapes. `datapay`, `databutton`, and `bitpipe` are transports/signers/broadcasters. `bitdb` and `b0/b1` are indexers. Keeping these layers separate will make BTC ports much easier.

### 2. Replace endpoints, keep concepts

Most old endpoints are historical: BitDB, Babel, Chronos, Genesis, Bitsocket, MatterCloud, Money Button, HandCash, and Memo.cash assumptions should not be treated as live infrastructure. The concepts remain useful.

### 3. Build BTC-native signing

WIF hot-key signing was convenient in 2018-2019 demos, but BTC ports should prefer:

- PSBT handoff for user signing.
- Descriptor wallets or hardware wallets for service wallets.
- Core RPC `walletcreatefundedpsbt`, `utxoupdatepsbt`, `walletprocesspsbt`, `finalizepsbt`.
- Explicit fee-rate and policy checks.

### 4. Index multiple OP_RETURN outputs

Older code often assumes one data output or one relevant output per tx. BTC Core v30+ allows multiple data-carrier outputs by default, so the indexer and protocol parser should store every nulldata output with output index.

### 5. Add integrity metadata

The trust gap in txid-addressed media is why `C://` matters. A BTC data layer should include:

- SHA-256 of content.
- MIME type.
- Encoding/compression.
- Byte length.
- Optional filename.
- Optional chunk manifest if content spans transactions.

## Current App Decision

ProofOfWork.Me does not need the full Unwriter-style BTC toolchain before the current app can move forward. The app already contains lightweight versions of the most important ideas:

- A `datapay`-like layer: the app builds PSBTs with `OP_RETURN` outputs.
- A `B://`/media-like layer: the app already supports chunked attachments with MIME metadata, size checks, and SHA-256 verification.
- A `fatURI`-like wallet handoff: UniSat signs the app-constructed PSBT instead of the app holding user keys.
- A BitDB-like read layer: the app currently relies on mempool.space scanning rather than running its own indexer.

The better near-term path is to keep ProofOfWork.Me focused as a usable BTC `OP_RETURN` mail/files app, while extracting small internal modules as the code matures:

- `protocol.ts` for `pwm1:` encode/decode.
- `opreturn.ts` for script building and size checks.
- `psbt.ts` for UniSat PSBT construction.
- `attachments.ts` for chunking and hash verification.
- `mempool.ts` for scanning and broadcast calls.

Separate BTC infrastructure tools should come later, once real app usage proves which pieces deserve to exist outside the app. Good triggers for separate tools would be needing a custom indexer instead of mempool.space, public `b://` / `c://` resolvers, reusable npm packages, non-UniSat wallet support, larger media/app publishing, or a Bitpipe-like subsidized posting service.

Immediate caution: the app should enforce aggregate `OP_RETURN` data size per transaction, not only per-output size. Bitcoin Core v30+ applies `-datacarriersize` across all data-carrier outputs in the transaction.

## Suggested ProofOfWork.Me Next Steps

1. Build a BTC `datapay` successor.
   - API compatible enough to port demos.
   - BTC standard `OP_RETURN` output.
   - PSBT-first signing.
   - Core/Esplora broadcast adapters.

2. Build a `B://` + `C://` resolver.
   - Store and resolve by txid and content hash.
   - Serve with correct `Content-Type`.
   - Verify hash before serving `c://` content.

3. Build a small BTC nulldata indexer.
   - Bitcoin Core ZMQ for mempool/block.
   - RPC or raw block source for full transactions.
   - SQLite/Postgres/Mongo tables for txs and nulldata outputs.
   - Query fields inspired by BitDB: `out.hN`, `out.sN`, `out.bN`, output index, txid, block, fee, vsize.

4. Port one demo first.
   - Recommended first demo: `alice` or `BitcoinMediaUpload`.
   - Goal: publish and retrieve a small HTML/image payload on BTC under current default policy.

5. Then port the app layer.
   - `bitmedia` viewer.
   - `B://` references inside on-chain HTML/Markdown.
   - `bitgraph` visualization for protocol relationships.
