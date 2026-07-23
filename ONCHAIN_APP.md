# On-Chain App Anchoring

Notes for anchoring ProofOfWork.Me application releases to ProofOfWork.

## Core Idea

The full ProofOfWork.Me app is probably too large to fit directly into a single OP_RETURN.

The local production-build snapshot reviewed on 2026-07-23 is roughly:

```text
Dist with public assets: ~12.8 MB
Compiled JS assets:     ~1.03 MB
App JS chunk:           ~643 KB
Other JS chunks:        ~383 KB across ProofOfWork, React, routes, icons, and runtime
Main CSS bundle:        ~105 KB
Gzipped JS total:       ~271 KB
Gzipped CSS bundle:     ~17 KB
```

That is larger than a practical 100 KB OP_RETURN target.

## Current Launch Status

The Phase 1 launch does not anchor app releases on-chain yet.

Current launch surfaces:

```text
www.proofofwork.me          -> canonical landing/router page
proofofwork.me              -> permanent redirect to https://www.proofofwork.me/
id.proofofwork.me           -> focused mainnet ID registry onboarding
computer.proofofwork.me     -> full mail/computer app
desktop.proofofwork.me      -> public read-only file desktop
browser.proofofwork.me      -> public HTML browser by txid
marketplace.proofofwork.me  -> standalone asset marketplace for IDs and credit sale-ticket markets
credit.proofofwork.me       -> standalone credit creation and mint app
token.proofofwork.me        -> permanent redirect to https://credit.proofofwork.me/
tokens.proofofwork.me       -> permanent redirect to https://credit.proofofwork.me/
wallet.proofofwork.me       -> standalone credit wallet, transfer, listing, delisting, and sale-history app
work.proofofwork.me         -> standalone WORK credit dashboard and mint page
infinity.proofofwork.me     -> standalone Infinity Bond / POWB market and bond composer
inception.proofofwork.me    -> standalone Inception Bond / INCB market and bond composer
log.proofofwork.me          -> public ProofOfWork Computer log
growth.proofofwork.me       -> public growth model dashboard
```

These are served as static frontend builds. Standalone surfaces are selected in
code by hostname or dedicated build flags, with local previews available at:

```text
http://localhost:5173/?id-launch=1
http://localhost:5173/?desktop=1
http://localhost:5173/?browser=1
http://localhost:5173/?marketplace=1
http://localhost:5173/?credit=1
http://localhost:5173/?wallet=1
http://localhost:5173/?work=1
http://localhost:5173/?infinity=1
http://localhost:5173/?inception=1
http://localhost:5173/?log=1
http://localhost:5173/?growth=1
```

`desktop.proofofwork.me`, `browser.proofofwork.me`, `marketplace.proofofwork.me`,
`credit.proofofwork.me`, `wallet.proofofwork.me`, `work.proofofwork.me`,
`infinity.proofofwork.me`, `inception.proofofwork.me`,
`log.proofofwork.me`, and `growth.proofofwork.me` should remain standalone
public surfaces, not hidden tabs that require the full Computer mailbox shell.

Future on-chain app anchoring should verify releases without changing the canonical ID registry address or `pwid1:r2` format.

However, ProofOfWork.Me can still put part of the app on-chain:

- App release metadata.
- App bundle hashes.
- Content URLs.
- A small bootstrap loader.
- A minimal read-only client.

The goal is not necessarily to host the full app on-chain. The goal is to make the official app version verifiable from ProofOfWork.

## Option 1: On-Chain Protocol Manifest

Store release metadata in OP_RETURN:

```text
powapp1:v1:<sha256>:<content-url>
```

The app or loader can:

1. Read the latest valid release event.
2. Fetch the app bundle from the content URL.
3. Hash the downloaded bundle.
4. Compare it to the on-chain hash.
5. Run only if the hash matches.

This gives ProofOfWork.Me a ProofOfWork-anchored release trail.

## Option 2: On-Chain Loader

Create a tiny HTML/JS loader that fits under the OP_RETURN budget.

The loader would:

- Fetch the current app bundle from normal hosting, IPFS, Arweave, or another content source.
- Verify the downloaded bundle hash against an OP_RETURN release event.
- Load the verified bundle.

This is more realistic than storing the full app directly on-chain.

## Option 3: On-Chain Mini Client

Build a very small ProofOfWork.Me client that can fit on-chain.

Possible features:

- Read-only mail viewer.
- ProofOfWork.Me ID resolver.
- Protocol verifier.
- App release verifier.

Likely limitations:

- Minimal UI.
- No full mail experience.
- No large dependencies.
- No full wallet flow.

This could be a powerful proof-of-concept or emergency fallback client.

## Option 4: Chunked On-Chain App

Split a compressed app across multiple OP_RETURN transactions.

Example:

```text
powapp1:chunk:<version>:1/5:<data>
powapp1:chunk:<version>:2/5:<data>
powapp1:chunk:<version>:3/5:<data>
powapp1:chunk:<version>:4/5:<data>
powapp1:chunk:<version>:5/5:<data>
```

A loader would reassemble chunks by version and order.

This is technically possible, but it is probably not the first move.

Tradeoffs:

- More expensive.
- Slower to resolve.
- Harder to update.
- More fragile.
- More of a protocol/art flex than practical hosting.

## App Release Registry

ProofOfWork.Me can have an on-chain app registry similar to the ID registry.

Possible release events:

```text
powapp1:release:<version>:<sha256>:<content-url>
powapp1:revoke:<version>
powapp1:latest:<version>
```

Rules to preserve:

- Releases must be signed/authorized by the project release key.
- Revocations must be signed/authorized by the same release authority.
- Clients should verify bundle hashes before executing code.
- A release event should include enough data to reproduce and verify the bundle.

## Recommended Path

Start with an on-chain manifest:

```text
powapp1:release:<version>:<sha256>:<content-url>
```

Then later add:

- A verified loader.
- IPFS/Arweave mirrors.
- Release revocations.
- A tiny on-chain read-only verifier.

This gives ProofOfWork.Me the feeling of a ProofOfWork-anchored app without forcing every byte of the frontend into OP_RETURN.

## Big Picture

ProofOfWork.Me can exist in layers:

```text
ProofOfWork OP_RETURN
  -> app release hash / manifest
  -> ID registry
  -> mail protocol

Static hosting / IPFS / Arweave
  -> full app bundle

Browser
  -> verifies app hash
  -> runs wallet-signed mail client
```

The full app can remain fast and usable, while ProofOfWork provides the source-of-truth release anchor.
