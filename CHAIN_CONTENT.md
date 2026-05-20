# Chain Content

Notes for expanding ProofOfWork.Me content beyond a single OP_RETURN payload by concatenating content from multiple blockchain transactions.

## Current Launch Status

Chain content expansion is not part of the Phase 1 `id.proofofwork.me` launch.

Current production behavior remains intentionally conservative:

- Mail and ID registry payloads must fit within the aggregate `100,000` byte OP_RETURN data-carrier script budget for one transaction.
- Attachments in the full mail app are capped at `60,000` raw bytes before encoding.
- The ID launch flow writes one `pwid1:r2` registration transaction and does not use multi-transaction concatenation.

Future chain-content work should be additive. Do not change the Phase 1 ID registry format to depend on `powcat1` or a manifest resolver.

Inspired by BCAT:

```text
https://bcat.bico.media/
```

## Core Idea

A single OP_RETURN has a practical size limit. ProofOfWork.Me has been designing around a `100 KB` protocol budget.

For larger content, the app can use a multi-transaction content protocol:

1. Split content into chunks.
2. Store each chunk in its own transaction.
3. Publish a manifest transaction that references all chunk txids in order.
4. Reconstruct the original content by fetching and concatenating each chunk.

This makes content larger than one OP_RETURN possible while keeping each transaction within the normal payload budget.

## What BCAT Does

BCAT describes a way to represent large files by spreading data across transactions.

The pattern:

- A manifest transaction stores metadata and a sequence of transaction IDs.
- Each referenced transaction contains a part of the original content.
- Clients fetch `TX1`, `TX2`, ... `TXn`.
- Clients concatenate the referenced data in order.
- Concatenation must be binary safe.
- Flags like `gzip` can tell gateways how to serve or decode content.

BCAT is from the BSV/Bitcom ecosystem, so ProofOfWork.Me should not copy it blindly. But the concept is useful:

```text
manifest tx -> ordered chunk txids -> reconstructed content
```

## ProofOfWork.Me Use Cases

Large chain content could support:

- Larger encrypted messages.
- Attachments.
- On-chain app loaders or mini apps.
- Larger public keys or key bundles.
- Rich profile metadata for ProofOfWork.Me IDs.
- Public files sent with paid mail.

This should be optional. Normal text mail should stay small and simple.

## Suggested Protocol: `powcat1`

ProofOfWork.Me can define its own content concatenation protocol.

### Chunk Transaction

Each chunk transaction stores one part of the content:

```text
powcat1:p:<content-hash>:<index>:<total>:<chunk-hash>:<chunk-data>
```

Fields:

- `p` means part/chunk.
- `content-hash` is the hash of the full original content.
- `index` is the zero-based chunk index.
- `total` is total chunk count.
- `chunk-hash` verifies this chunk.
- `chunk-data` is the raw or encoded chunk payload.

### Manifest Transaction

The manifest references all chunks:

```text
powcat1:m:<mime>:<encoding>:<name>:<flags>:<size>:<sha256>:<txid-0>:<txid-1>:...:<txid-n>
```

Fields:

- `m` means manifest.
- `mime` describes the reconstructed content type.
- `encoding` describes text/binary encoding, or `bin`.
- `name` is optional display filename.
- `flags` can include compression or special handling.
- `size` is the original byte size.
- `sha256` is the full content hash.
- `txid-*` values are chunk transaction IDs in order.

The manifest usually has to be published after the chunks, because it needs the chunk txids.

## Mail Pointer

ProofOfWork.Me mail should not inline huge content by default.

Instead, a normal mail message can point to a `powcat1` manifest:

```text
pwm1:a:powcat:<manifest-txid>:<sha256>:<mime>:<name>
```

Possible reader behavior:

- Show the normal mail body.
- Show an attachment/content card.
- Fetch chunk txs only when the user opens the content.
- Verify hashes before rendering.
- Refuse to render if chunks are missing or hashes fail.

## Binary Safety

Concatenation must be binary safe.

Clients should not treat chunks as normal UTF-8 text unless the manifest says the final content is text.

Recommended chunk encoding:

- Raw bytes if transaction construction supports binary-safe OP_RETURN.
- Otherwise compact base64url.

If base64url is used, the app should decode each chunk before concatenating.

## Compression

Compression should be supported with a flag.

Possible flags:

```text
none
gzip
br
encrypted
encrypted+gzip
```

Recommended order:

```text
plaintext -> compress -> encrypt -> chunk
```

For encrypted content, do not compress after encryption because ciphertext does not compress meaningfully.

## Verification

Every reconstructed content object should be verified.

Recommended checks:

- Every referenced txid exists.
- Every chunk follows the `powcat1:p` format.
- Chunk indexes are complete and unique.
- Chunk hashes match.
- Reconstructed byte size matches manifest `size`.
- Reconstructed full hash matches manifest `sha256`.
- Manifest txid matches the pointer from the mail message.

If any check fails, the UI should show a clear error and avoid rendering the content.

## Indexer Support

This can work client-side through public APIs, but it gets much better with a ProofOfWork.Me indexer.

Indexer responsibilities:

- Find `powcat1` manifests.
- Find `powcat1` chunks.
- Resolve manifest txid to reconstructed metadata.
- Cache verified chunk maps.
- Serve content bytes only after hash verification.
- Prevent random OP_RETURN data from being interpreted as ProofOfWork.Me content.

The indexer should still not need private keys or custody.

## Product Constraints

Large content should not make the core mail app slow.

Recommended behavior:

- Load message text first.
- Lazy-load large content.
- Show content size before fetching.
- Confirm before loading very large content.
- Do not autoplay or auto-render untrusted rich content.
- Do not support executable content as trusted app code unless hash-verified through the app-release system.

## Cost And UX Tradeoffs

Multi-transaction content is powerful but expensive.

Tradeoffs:

- More transactions.
- More fees.
- More waiting for confirmation.
- More data to index.
- More permanent public data.
- More complex failure cases.

Good first use cases:

- Encrypted long-form text.
- Small attachments.
- Public profile images or metadata for ProofOfWork.Me IDs.
- App release manifests and verified loaders.

Avoid early:

- Large video.
- Large arbitrary file hosting.
- Unbounded attachments.
- Auto-loading rich HTML.

## Relation To Other Plans

This connects to:

- `ENCRYPTION.md`: encrypted content can use `powcat1` when ciphertext exceeds a normal message budget.
- `PROOFOFWORK_IDS.md`: ID profiles, public keys, and marketplace metadata can reference larger content.
- `ONCHAIN_APP.md`: app bundles or loaders can be chunked or referenced through manifests.
- `MAIL_ORGANIZATION.md`: large content should still participate in archive/favorite/all-mail views through the parent mail tx.

## Open Questions

- Should `powcat1` chunks be separate mail transactions or separate zero-value content transactions?
- Should chunk txs pay sats to the recipient, or only the mail pointer tx pays the recipient?
- Should chunk content be allowed in Inbox ranking, or only parent mail tx value counts?
- Should chunk manifests be reusable across many messages?
- Should the app support raw binary OP_RETURN chunks or only base64url?
- What maximum reconstructed size should the first version allow?

## Recommended First Version

Start small:

```text
pwm1:m:<short message>
pwm1:a:powcat:<manifest-txid>:<sha256>:<mime>:<name>
```

Support:

- One attachment/content pointer per message.
- Conservative max reconstructed size, such as `1 MB`.
- Text, image, and encrypted text content only.
- Hash verification before display.
- Lazy loading only.

This gives ProofOfWork.Me a path beyond 100 KB without making normal mail complicated.
