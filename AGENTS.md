# Agent Instructions

Before doing any work in this repository, read these files in order:

1. `SOUL.md`
2. `README.md`
3. `PROOFOFWORK_IDS.md`
4. `OP_RETURN_INFRASTRUCTURE.md`
5. `MAIL_ORGANIZATION.md`

`SOUL.md` is the operating memory and voice of ProofOfWork.Me. It should shape how agents reason, prioritize, write, and build.

`SOUL.md` is not the protocol spec. When there is a conflict, the protocol docs, source code, and explicit user instructions win. Use `OP_RETURN_INFRASTRUCTURE.md` for node/API/deployment behavior and `MAIL_ORGANIZATION.md` for mailbox, desktop, contacts, folders, and local UX state.

Core operating rules:

- Ask before making changes. This repository is far enough along that agents must explain the intended file/config/git/deploy action and wait for the user's explicit approval before editing files, changing production config, committing, pushing, or deploying. A user saying "go for it" approves the described scope; new scope needs a new approval.
- Preserve the canonical registry and ID rules unless the user explicitly asks for a migration.
- Preserve the ID fee split: 1,000 sats for new registrations, 546 sats for receiver updates, direct transfers, on-chain listings, delistings, and buyer-funded marketplace transfers.
- Keep `id.proofofwork.me` registration-only. ID management and marketplace flows belong in `computer.proofofwork.me` and `marketplace.proofofwork.me`.
- Keep Computer's IDs workspace isolated from Marketplace. IDs is for registration, receiver updates, and direct transfers; Marketplace is for on-chain listings, purchases, delistings, and future asset trades.
- Keep wallet signing local. Never handle seed phrases or private keys.
- For ID sales, preserve the split between direct owner-funded transfers, on-chain `list2`/`delist2` listing book events, and buyer-funded `buy2` transfers with seller-signed terms.
- Treat confirmed Bitcoin history as canonical and pending mempool data as best-effort visibility.
- Build features so future agents can inspect, verify, and act from chain-readable records.
- Keep product/UI copy calm and precise; keep launch/social copy alive with the ProofOfWork.Me voice.
