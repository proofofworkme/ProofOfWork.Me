# Encryption

Notes for optional ProofOfWork.Me message encryption.

## Current Launch Status

Encryption is not part of the Phase 1 `id.proofofwork.me` launch.

The current ID registry already has an optional PGP public key field in the canonical registration payload:

```text
pwid1:r2:<id-base64url>:<owner-address>:<receive-address>:<pgp-public-key-base64url?>
```

For Phase 1, this key is stored/displayed as registry metadata only. The app does not yet encrypt or decrypt mail content. Future encryption work should build on the confirmed ID resolver and must not make pending IDs routable.

## Core Idea

ProofOfWork.Me messages are permanent because they are written to Bitcoin OP_RETURN outputs.

Encryption can make that permanence safer:

- Plaintext messages are readable forever.
- Encrypted messages are permanent ciphertext.
- The chain still proves the message existed.
- Only the intended recipient should be able to read the content.

Encryption should be optional and seamless in the app flow.

## Privacy Boundary

Encryption protects message content.

It does not hide:

- Sender funding address.
- Recipient address.
- Sats sent.
- Transaction time.
- Transaction graph.
- OP_RETURN protocol usage.
- Message size.

So the product language should say:

```text
Encrypt message content
```

Not:

```text
Make this private
Hide this transaction
Anonymous message
```

## User Experience

The compose screen can have a simple toggle:

```text
[ ] Encrypt content
```

Suggested behavior:

- If the recipient is a ProofOfWork.Me ID with a registered encryption key, enable encryption automatically.
- If the recipient is a raw address with no known key, disable encryption and show plaintext mode.
- If a key exists but is stale/revoked, show a clear warning.
- If encryption is enabled, encrypt only the message body before writing OP_RETURN.
- Sender still signs and broadcasts normally through their wallet.

The user should not need to understand PGP details during normal send flow.

## Key Model

ProofOfWork.Me IDs can have an encryption key attached to them.

Example:

```text
ID: user@proofofwork.me
owner: pubkey/address that controls the ID asset
receiver: pubkey/address where messages are delivered
encryption_key: public OpenPGP key used to encrypt mail content
```

Ownership and encryption should remain separate:

- Owner controls the ID asset.
- Receiver determines where payments/messages go.
- Encryption key determines who can decrypt content.

This lets a user rotate their receiving address or encryption key without necessarily selling/transferring the ID.

## On-Chain Key Registry

Only public keys should ever be registered on-chain.

Never put private keys, seed phrases, passphrases, or encrypted private keys in OP_RETURN.

Possible registry events:

```text
pwid1:k:<id-base64url>:<pgp-public-key-base64url>
pwid1:keydel:<id-base64url>:<fingerprint>
pwid1:keyrot:<id-base64url>:openpgp:<old-fingerprint>:<new-fingerprint>:<key-data-or-chunk>
```

Because public PGP keys can be larger than a single small OP_RETURN payload, the protocol may need chunking:

```text
pwid1:key:<id-base64url>:openpgp:<fingerprint>:1/3:<chunk>
pwid1:key:<id-base64url>:openpgp:<fingerprint>:2/3:<chunk>
pwid1:key:<id-base64url>:openpgp:<fingerprint>:3/3:<chunk>
```

The resolver would reconstruct the key by applying valid chunks in chain order.

Rules to preserve:

- Key registration/update must be authorized by the current ID owner.
- A key should be associated with a fingerprint.
- Old keys should remain visible for decrypting older messages.
- New messages should use the current active key.
- Revoked/rotated keys should not be used for new messages.

## Message Protocol

Plaintext mail can keep using:

```text
pwm1:m:<message-chunk>
```

Encrypted mail should use a distinct marker so clients know they need to decrypt:

```text
pwm1:e:openpgp:<recipient-id-or-fingerprint>:<ciphertext-chunk>
```

Replies can still include thread references:

```text
pwm1:r:<parent-txid>
pwm1:e:openpgp:<recipient-id-or-fingerprint>:<ciphertext-chunk>
```

Important:

- Encrypt the message body, not the whole transaction.
- Keep protocol fields needed for routing/threading outside the ciphertext.
- Avoid leaking plaintext previews for encrypted messages.
- Inbox rows should show something like `Encrypted message` until decrypted.

## Size Budget

PGP-encrypted messages can fit under a 100 KB OP_RETURN policy budget for normal text mail.

Approximate sizes:

```text
Short text message:      usually 1-5 KB encrypted
10 KB plaintext:         roughly 12-18 KB encrypted
50 KB plaintext:         roughly 65-80 KB encrypted if armored/base64
Large docs/attachments:  not a good fit
```

ASCII-armored PGP is bulky because it base64-encodes encrypted bytes and adds headers. It can add about 33% or more overhead.

Binary OpenPGP packets are smaller, but they require binary-safe OP_RETURN chunking and more careful app handling.

Recommended first version:

- Use encryption for text messages only.
- Do not support attachments in OP_RETURN.
- Avoid full ASCII-armored PGP if a compact envelope is available.
- Store encrypted payloads as compact base64url chunks.
- Set the encrypted plaintext limit lower than the raw OP_RETURN limit.
- A conservative plaintext limit of `50-60 KB` should leave room for encryption overhead under a `100 KB` protocol budget.

PGP is feasible for normal messages, but the app should design conservatively.

## Decryption Flow

When viewing an encrypted message:

- The app detects `pwm1:e`.
- The app asks the local key manager/wallet/browser storage for the user's private key.
- The app decrypts locally in the browser.
- The decrypted plaintext is never sent to the ProofOfWork.Me backend or indexer.

Possible private key storage options:

- User imports private PGP key into browser local storage.
- User keeps private key in a local file and unlocks when needed.
- Future wallet integration handles encryption/decryption.
- Future ProofOfWork.Me ID account flow helps manage keys.

The first version should avoid storing sensitive private keys permanently unless the user explicitly opts in.

## Sender Copies

PGP-style encryption should consider sender readability.

If a sender wants to read their own sent encrypted messages later, encrypt to both:

- Recipient public key.
- Sender public key.

Otherwise, Sent may only show ciphertext after refresh or browser reset.

This should be automatic when the sender has a registered encryption key.

## Key Rotation

Key rotation is essential because OP_RETURN is permanent.

Recommended model:

- Old messages stay encrypted to old keys.
- New messages use the latest active key.
- The app shows key fingerprint and active/revoked status.
- Revocation prevents future encryption to compromised keys.
- Revocation cannot make old ciphertext disappear.

## Product Language

Use:

```text
Encrypt content
Encrypted message
Decrypt locally
Key fingerprint
Rotate encryption key
```

Avoid:

```text
Fully private
Anonymous
Untraceable
Delete encrypted message
```

## Open Questions

- Should ProofOfWork.Me use full OpenPGP, or a smaller modern encryption format?
- Should raw addresses support encryption, or only ProofOfWork.Me IDs?
- Should public keys be stored fully on-chain, or should OP_RETURN store a key hash plus external fetch location?
- Should encryption be enabled by default when a recipient key exists?
- How should users back up private keys safely?
- How should encrypted search work, if at all?

## Big Picture

Encryption makes ProofOfWork.Me safer for permanent messages.

The ideal user experience:

```text
Resolve recipient
Find recipient encryption key
Toggle Encrypt content
Encrypt locally
Sign transaction locally
Write ciphertext to Bitcoin
Decrypt locally when reading
```

This preserves the core ProofOfWork.Me model:

- Bitcoin stores the permanent proof/message record.
- Wallets sign transactions locally.
- Public keys can be discovered from the chain.
- Private keys stay with the user.
- The app remains non-custodial.
