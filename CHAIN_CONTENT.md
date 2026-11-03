# Chain Content

## Files and Mail v1

A mainnet file has one linker transaction ID. A reader starts with that ID and
recovers the file from confirmed transaction bytes. A file contains 1 through
4,000,000 raw bytes in 1 through 67 parts. Each part contains at most 96,000
raw bytes. A full-size file at the writer's target size uses 42 part
transactions and one linker. Sending a reference in Mail takes one further
ordinary paid Mail transaction. Inline Files and Mail continue to use their
existing 60,000-byte attachment format. The 100,000-byte aggregate script
budget and 400,000 weight-unit transaction ceiling apply per carrier.

### Wire format

Each part or linker transaction has inputs, exactly one zero-proof OP_RETURN
output with one minimally encoded data push, and may contain ordinary funding
change. Coinbase transactions are ineligible. The two prefixes are nine
literal ASCII bytes. Fields below follow the prefix immediately and hashes
are 32 raw bytes. TXIDs use the byte order of their displayed hexadecimal
string. No delimiters or unused trailing bytes are allowed.

| Record | Fields following the prefix, in order |
| --- | --- |
| `powcat1:p` | File SHA-256, zero-based index (u8), part count (u8), SHA-256 of this part, raw bytes to the end of the push |
| `powcat1:m` | File SHA-256, raw byte length (u32 big-endian), part count (u8), filename byte length (u8), MIME byte length (u8), filename (UTF-8), MIME (lowercase ASCII type/subtype), ordered list of part TXIDs |

Require unique references, exact field lengths, valid filename UTF-8 and
bounded metadata. Filenames contain 1–255 bytes, exclude path separators,
control characters and the names `.` and `..`. MIME is at most 127 bytes.
Each part must confirm in a block earlier than the linker on the same chain.
Check TXID, index, count, both hashes and exact final length before serving.
Version one uses raw bytes and a flat list. The MIME label describes bytes
and grants no execution authority.

### Publication, recovery and delivery

The wallet reviews estimated total cost and exact transaction inputs, change
and miner fee before each local signature. Parts use confirmed, available
funding inputs. The journal reserves inputs for wallet actions in the same
browser profile and origin. Other devices, sites and external wallet clients
can still spend those inputs. Resume on the original site in the original
browser profile and reselect the original bytes when needed. Verify the file hash before continuing and
record a signed TXID, raw transaction and inputs before broadcast. An unknown
broadcast retains its reservation. Check authoritative status before retrying
the exact signed bytes. Wait for confirmed parts before signing the linker.
If a reorg confirms the old linker before or alongside one of its parts,
publish a fresh linker referencing the confirmed parts and use its new TXID.

Mail sends one ordinary `pwm1:a` attachment with MIME
`application/vnd.proofofwork.powcat1` and a display name ending in `.powcat`.
Its 139 UTF-8 bytes are exactly
`pwm1:cat1:<64-lowercase-hex-linker-txid>:<64-lowercase-hex-file-sha256>`.
Normal Mail attachment verification checks the reference's length and hash.
Opening it checks the separate whole-file commitment against the linker.
The original name and media type come from the verified linker. A user may
share the same linker again. Existing Mail/Files payment attribution applies
once per delivery. Content parts and linkers only consume their own miner fees.

`GET /api/v1/powcat/<txid>?network=livenet` verifies the file against the
node and returns its name, MIME, size, SHA-256, ordered part TXIDs and linker
block evidence. Add `download=1` to retrieve verified bytes as an attachment.
Requests are bounded and responses are uncached. Recheck active-chain
membership on every read. Pending, missing, malformed or detached evidence
does not yield file bytes. A reorg may make an earlier observation unavailable.

The qualification test uses an isolated Bitcoin Core regtest, a 4,000,000-byte
binary file, a real wallet and normal policy. It exercises interrupted resume,
lost and restored confirmations, replacement of a linker with invalid block
ordering, and recovery from the delivered Mail reference.
See [the codec](src/shared/protocol/powcat1.mjs) and
[the regtest](scripts/check-powcat-regtest.mjs).

## Historical proposal

The following notes record the original proposed encodings, limits and
product ideas. The version-one wire contract above supersedes them.


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
- Should chunk txs pay proofs to the recipient, or only the mail pointer tx pays the recipient?
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
