# Agent Instructions

Before doing any work in this repository, read these files in order:

1. `SOUL.md`
2. `README.md`
3. `PROOFOFWORK_IDS.md`
4. `MARKETPLACE.md`
5. `OP_RETURN_INFRASTRUCTURE.md`
6. `MAIL_ORGANIZATION.md`

`SOUL.md` is the operating memory and voice of ProofOfWork.Me. It should shape how agents reason, prioritize, write, and build.

`SOUL.md` is not the protocol spec. When there is a conflict, the protocol docs, source code, and explicit user instructions win. Use `MARKETPLACE.md` for current ID/credit sale-ticket behavior, `OP_RETURN_INFRASTRUCTURE.md` for node/API/deployment behavior, and `MAIL_ORGANIZATION.md` for mailbox, desktop, contacts, folders, and local UX state.

Core operating rules:

- Ask before making changes. This repository is far enough along that agents must explain the intended file/config/git/deploy action and wait for the user's explicit approval before editing files, changing production config, committing, pushing, or deploying. A user saying "go for it" approves the described scope; new scope needs a new approval.
- Mandatory commit hygiene: every approved update ends with a repository-hygiene pass, even when no commit is created. Before final staging or committing, run `npm run hygiene:fix`, review its report and make the required semantic decisions, then run `npm run hygiene:check`. Do not bypass the repository hooks or hygiene CI without the user's explicit approval. Follow `REPOSITORY_HYGIENE.md` for the required commit trailers and deletion attestation.
- The hygiene pass must review `SOUL.md`, the canonical protocol/product docs, tracked notes and generated artifacts, the safe cleanup allowlist, `git status`, the final diff, and relevant tests. Automatic cleanup is intentionally narrow; it does not authorize deleting history, evidence, ledgers, refunds, release artifacts, or files outside the approved change scope.
- Old is not stale. Preserve historical protocol forms, migrations, audits, incident evidence, and tx-backed records when they remain useful for replay or accountability. Qualify historical material instead of silently deleting it.
- Preserve the canonical registry and ID rules unless the user explicitly asks for a migration.
- Preserve the ID fee split: 1,000 proofs for new registrations, 546 proofs for receiver updates, direct transfers, on-chain listings, seals, delistings, and buyer-funded marketplace transfers.
- Keep `id.proofofwork.me` registration-only. ID management and marketplace flows belong in `computer.proofofwork.me` and `marketplace.proofofwork.me`.
- Keep Computer's IDs workspace isolated from Marketplace. IDs is for registration, receiver updates, and direct transfers; Marketplace is for on-chain listings, seals, purchases, delistings, credit sale-ticket trades, and future asset trades.
- Keep wallet signing local. Never handle seed phrases or private keys.
- For ID sales, preserve the split between direct owner-funded transfers, current on-chain `list5`/`seal5`/`delist5` sale-ticket events, and buyer-funded `buy5` transfers with seller-signed terms. Historical `list2`/`delist2`/`buy2`, `list3`/`delist3`/`buy3`, and `list4`/`delist4`/`buy4` events remain replayable history.
- Treat confirmed ProofOfWork history as canonical and pending mempool data as best-effort visibility.
- Build features so future agents can inspect, verify, and act from chain-readable records.
- Keep product/UI copy calm and precise; keep launch/social copy alive with the ProofOfWork.Me voice.
- In public/social copy, use ProofOfWork, ProofOfWork-native, and proofs; do not use Bitcoin or BTC. Put `$WORK $POWB $INCB` on every ProofOfWork.Me public/social post unless the user explicitly requests different cashtags.
- After a user-approved production workflow has been production-verified, committed, deployed, and pushed, immediately provide tweet-ready public copy in the ProofOfWork.Me voice unless the user explicitly says not to.
