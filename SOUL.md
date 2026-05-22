# ProofOfWork.Me Soul

This file is operating memory for future agents.

It is distilled from current repository docs and public launch memory captured through 2026-05-19. It is not a protocol spec. When this file conflicts with `README.md`, `PROOFOFWORK_IDS.md`, `OP_RETURN_INFRASTRUCTURE.md`, `MAIL_ORGANIZATION.md`, or the source code, the protocol docs and code win.

## Source Memory

- Public account: `@proofofworkme`
- Launch memory reviewed: 2026-05-19
- Public archive reviewed: `/home/sixer/Downloads/twitter-2026-05-19-4780579747040c69c6ee36267c276b61d1375ffa6de1fde07a0d945892fafea7`
- Core domains: `www.proofofwork.me`, `proofofwork.me`, `id.proofofwork.me`, `computer.proofofwork.me`, `desktop.proofofwork.me`, `browser.proofofwork.me`, `marketplace.proofofwork.me`, `token.proofofwork.me`, `tokens.proofofwork.me`, `wallet.proofofwork.me`, `work.proofofwork.me`, `log.proofofwork.me`, `growth.proofofwork.me`

## One Sentence

ProofOfWork.Me is the Bitcoin Computer: a local-first, on-chain, agent-readable computer where Bitcoin transactions become mail, identity, files, applications, proposals, payments, and proofs of work.

## Core Thesis

Bitcoin is not only money. Bitcoin is proofs.

Bitcoin is the source of truth for agents and humans because confirmed chain data cannot be silently edited, injected, rug-pulled, or replaced by a server. Agents can reason against immutable records. Humans can observe, approve, sign, and carry responsibility. The UI exists so humans can see and decide; the chain exists so agents can verify and act.

The project turns attention, communication, identity, and application distribution into Bitcoin-native flows:

- If someone wants your attention, they can attach sats.
- If someone wants to claim an identity, they prove it on chain.
- If an agent needs reliable instructions, it reads immutable data.
- If an app needs a payment address, the address lives in tamper-resistant data.
- If a proposal matters, it can be signaled with sats.

## Product Beliefs

1. The source of truth is the chain.
2. Confirmed records are canonical. Pending mempool visibility is useful gossip.
3. Wallet signing stays local. The app must never hold seed phrases or private keys.
4. Agents can propose, construct, verify, and summarize. Humans approve and sign.
5. Spam becomes expensive when attention requires payment.
6. The inbox should respect value. Highest sats is a first-class sort.
7. ProofOfWork IDs are the global address book for humans and agents.
8. Every confirmed ID is a network-effect increment.
9. OP_RETURN is an application substrate, not a toy memo field.
10. The 100 KB OP_RETURN budget enables small apps, files, manifests, messages, and agent-readable records.
11. Bigger content can be linked, chunked, concatenated, or referenced by future protocols.
12. The computer is local, modular, and malleable. Users should be able to run their own stack.
13. Self-hosting matters: Bitcoin Core, indexers, and ProofOfWork APIs make the system sovereign.
14. Domains, SSL, hosted servers, and public APIs can be useful, but they should become optional where Bitcoin can carry the durable record.
15. The future setup is simple: Linux, VS Code, Codex, Bitcoin, a local wallet, and the Bitcoin Computer.
16. Humans in the AI era become storytellers, signers, taste-makers, and responsibility bearers.
17. Agents need tamper-free data more than they need traditional web accounts.
18. Sats are a better dopamine signal than likes, retweets, and rage bait.
19. The most important work should be visible to agents in a form they can verify.
20. Build for agents first, but let humans observe, join, and steer.

## Launch Memory

The archive captured a live Phase 1 ignition, not a polished brand campaign.

- 2026-05-06: mainnet experiments, early tx proofs, "Are you ready for the future of Bitcoin?"
- 2026-05-07: the Bitcoin Computer thesis hardens; IDs, registry, local backups, private-key-as-computer, `bitcoin@proofofwork.me`, `registry@proofofwork.me`.
- 2026-05-08: Phase 1 opens; `id.proofofwork.me` and `computer.proofofwork.me` become the center; countdown to 100 IDs; files, paid inbox, immutable markdown, and the "final network" story emerge.
- 2026-05-09: duplicate registration refunds, full node/indexer urgency, dropped-tx handling, application framework, canceled Ordinals exploration, on-chain agents, and agent-readable business data.
- 2026-05-10: node-backed API updates, self-hosting instructions, OADS, contacts, open agent development, app distribution, streaming sats, autonomous micro-applications, and the one-person/agent business thesis.
- 2026-05-11: ID transfers go live, PowIDs begin behaving as Bitcoin-native assets, and the public model turns IDs, Mail, Files/Drive, and aggregate Bitcoin Computer value into one measurable network-effect thesis.
- 2026-05-12: Marketplace and registry thinking hardens around one event stream, 546 sat mutations, registrar recourse, responsible UTXO management, and agent-readable accountability.
- 2026-05-13: Browser becomes a first-class app and Computer workspace; HTML message bodies and verified HTML attachments render from txids. Bug bounty practice begins with credited, paid, tx-backed reports. Public surfaces converge around IDs, Computer, Desktop, Browser, Marketplace, Log, and Growth.
- 2026-05-14: Token thinking lands: tokens are businesses with creator-owned registries. A macro token index records creation, while mints pay each token registry directly. Marketplace UTXO reservations become a safety invariant.
- 2026-05-15: Tokens and WORK become first-class production surfaces. `token.proofofwork.me` creates and mints tokens; `work.proofofwork.me` is the dedicated WORK dashboard. WORK launches with 21,000,000 max supply, 1,000 WORK per mint, 1,000 sats per mint, and the `work@proofofwork.me` registry.
- 2026-05-16: WORK gets a permanent floor formula, UTXO preparation, Mint Assistant, and explicit fee dashboards. The floor is confirmed Bitcoin Computer network value divided by 21,000,000 WORK, separate from the 1 sat/WORK mint price.
- 2026-05-17: Production performance hardens around a uniform node-backed cached snapshot path. WORK, Token, Log, Growth, and registry pages must refresh against current full-node data without dragging huge ledgers through every view.
- 2026-05-19: Token transfers enter the protocol as `pwt1:send` events. Wallet becomes the non-custodial token surface: connected-address balances, confirmed-only canonical ownership, pending transfer visibility, and UniSat-local signing.
- 2026-05-18: Shared architecture and API work accelerate. Broadcasts prefer the ProofOfWork node path after local signing, and RPC errors should be structured enough for users and agents to understand.
- 2026-05-19: WORK enters the final mint sprint. Mint-out semantics are clarified: confirmed supply is canonical; pending mints are mempool pressure; UI actions pause when confirmed plus pending would fill remaining supply. WORK floor charts are corrected into real price charts with time on the x-axis and sats/USD price per WORK on the y-axis.
- 2026-05-22: The Computer shell and standalone app surfaces converge into a full dark UI overhaul. Desktop, Browser, Marketplace, Token, Wallet, WORK, Log, and Growth are made shell-compatible with scrolling, aligned controls, pagination over large datasets, UniSat action wiring for buy/mint/list/delist/transfer flows, token sale-ticket buys in wallet/log/growth accounting, and live node-backed BTC/USD shared by Token, WORK, and Growth.

The emotional shape is a breakthrough moment: years of Bitcoin/app experiments meeting modern agents and becoming legible all at once.

## Archive Themes

The full archive is not a neat roadmap. It is a public founder diary mixed with launch notes, product decisions, arguments, jokes, rage, music, and repeated stress testing in the open. Future agents should preserve the durable signal, not the noise.

- The project is a computer, not a collection of pages. IDs, Mail, Files, Desktop, Browser, Marketplace, Tokens, Wallet, WORK, Log, and Growth are facets of one Bitcoin Computer.
- The anti-platform stance is central. Social media, ads, analytics dashboards, followers, likes, influencers, and conferences are weaker than chain-readable proofs, sats, txids, and confirmed state.
- Distribution should collapse into the Computer. A future app can be a message, HTML body, attachment, txid, or registry record that agents and humans can inspect without trusting a mutable platform.
- UTXOs are an organizational primitive. Good Bitcoin UX should teach responsible UTXO management, explicit fees, split/prepared outputs, and PSBT review before signing.
- Human approval remains sacred. Agents can prepare, queue, repeat, diagnose, and verify. Humans sign. Wallets stay local.
- Recourse is a product feature. Owning the registrar and registries makes refunds, bug bounties, public ledgers, and accountable repairs possible in a way anonymous protocols usually cannot offer.
- Measurement matters. IDs are network effects, logs are activity evidence, Growth is the modeled network-value mirror, and WORK turns that confirmed network value into a live token floor.
- The founder treats WORK as proof-of-use. The token is not only a ticker; it is the live demonstration that creator-owned registries, mint revenue, public dashboards, and chain-derived floors can exist on Bitcoin.
- Token registries are creator sovereignty. The macro index records creation, but each token owns its registry, mint price, mint history, revenue lane, and responsibility to build.
- Minting is a launch primitive, not the whole protocol. Transfers, OTC, listings, richer markets, and creator tooling come after minting is correct, legible, and hard to misuse.
- The chain is the oracle, but pending pressure still matters to UX. Pending mints do not change canonical supply or floor, yet they can warn users away from likely overfill attempts.
- Speed and freshness are product integrity. Fast cached first paint is useful; a refresh that leaves stale data is a lie. Full-node truth must win after refresh.
- The archive repeatedly rejects complexity as status. Prefer simple records, clear fees, replayable parsers, direct registry payments, and UI that explains what the wallet is about to sign.
- The project is built in public with credited collaborators. Bug reporters, community testers, and architecture contributors should be credited by PowID where possible, but no contributor's implementation becomes sacred if it violates the standard.
- Public voice can be combative and mythic; product voice should be precise. Do not import personal attacks, slurs, enemies lists, or volatile emotional targets into docs, UI, protocol names, or agent behavior.
- Treat numerical social snapshots as historical, not permanent. Token stats, prices, holder counts, pending counts, floor values, and projections must be read live from the current node/API when accuracy matters.

## Product Invariants

Future agents must preserve these unless the user explicitly asks for a migration:

- `www.proofofwork.me` is the canonical landing/router.
- `proofofwork.me` redirects to `https://www.proofofwork.me/`.
- `id.proofofwork.me` is the focused ID registry app.
- `computer.proofofwork.me` is the full mail/computer app.
- `desktop.proofofwork.me` is the public read-only file desktop.
- `marketplace.proofofwork.me` is the standalone asset marketplace: IDs and token sale-ticket markets are live.
- `token.proofofwork.me` is the standalone token creation and mint app.
- `tokens.proofofwork.me` redirects to `https://token.proofofwork.me/`.
- `wallet.proofofwork.me` is the standalone token wallet, transfer, listing, delisting, and sale-history app.
- `work.proofofwork.me` is the standalone WORK token dashboard.
- `log.proofofwork.me` is the public read-only Bitcoin Computer log for tx-backed ProofOfWork actions.
- `growth.proofofwork.me` is the public read-only growth dashboard for canonical Bitcoin Computer network value versus confirmed chain-derived value in sats and USD.
- Canonical mainnet registry address: `bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e`
- Registration price: `1000` sats.
- ID mutation price: `546` sats for receiver updates, direct transfers, marketplace listings, delistings, and buyer-funded marketplace transfers.
- Current ID event: `pwid1:r2:<id-base64url>:<owner-address>:<receive-address>:<pgp-public-key-base64url?>`
- Current mail prefix: `pwm1:`
- Current token prefix: `pwt1:`
- Token creation pays the built-in index fee to `tokens@proofofwork.me`; token mints and transfers pay the token's own registry directly.
- Token ids are creation txids. The creation event defines ticker, max supply, mint amount, mint price, and the token registry address.
- Token transfers use `pwt1:send:<token-create-txid>:<amount>:<recipient-address>` with a 546 sat registry mutation payment.
- Token mint prices are owner-set with a 546 sat minimum. ProofOfWork does not take a global fee on mints.
- Token marketplace writes are live sale-ticket records. Preserve the invariant: reserve seller balance, seal exact terms, require buyer ticket spend, seller payment, and token registry mutation fee.
- WORK token id: `d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8`
- WORK registry address: `1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV`
- WORK supply settings: 21,000,000 max supply, 1,000 WORK per mint, 1,000 sats per mint, 1 sat per WORK launch price.
- WORK is reserved. Official token indexers and create UI should reject any non-canonical token ticker containing `WORK`, and exclude blocked scam creator address `bc1qcf57sgazj4gcd0yfxste3eaa35eltj48sgrvjl`.
- WORK permanent floor formula: `work_floor_sats = confirmed_network_value_sats / 21,000,000 WORK`.
- WORK floor is not the same thing as mint price. Public UI should separate mint price, floor price, network value, and pending mint pressure.
- WORK floor charts should be real price charts: x-axis is time; y-axis is price per WORK; users can toggle sats and USD.
- Token mint-out is canonically confirmed-only. UI mint controls should also pause when confirmed plus pending mints would fill the remaining supply.
- Prepare UTXOs and Mint Assistant are signer helpers, not custody. They should never auto-sign, handle seed phrases, or move wallet authority server-side.
- First confirmed valid registration wins.
- IDs are case-insensitive forever.
- Pending IDs may be visible, but pending IDs are not routable.
- Re-check registry state before broadcast.
- Wallet signing stays local.
- Node/API infrastructure reads, indexes, verifies, and broadcasts already-signed txs. It does not custody.
- Every tx-backed app action should be inspectable from an activity surface with clear labels for confirmed, pending, txid, listing txid, and UTXO references where relevant.
- Every app action is a Bitcoin Computer action. Log and Growth should treat tx-backed actions from IDs, mail, files, Browser, Marketplace, Tokens, and staged protocols consistently.
- Production data surfaces should prefer the first-party node/API cache path for speed, then refresh from current full-node data. Stale snapshots are acceptable only as a first paint, not as the final truth after refresh.
- Broadcast errors should be legible. A rejected transaction should expose the RPC code, reason when available, and a plain-English hint instead of a mystery error.
- Every new product should enter the growth model with the same shape: real chain inputs, a usage assumption, a value assumption, fee elasticity, and blockspace accounting.
- Merged apps should be treated as normal apps across public links, local route maps, GitHub docs, and Growth inputs.
- Attachments are small and verified by size/hash.
- Confirmed chain history is canonical; pending status can become dropped.
- Local state is portable through backups, not server accounts.

## Voice

The native voice is high-conviction, fast, direct, mythic, and alive. It sounds like a founder mid-breakthrough, building in public while the machine is turning on.

Use:

- Short declarative sentences.
- Plain words with large stakes.
- Bitcoin Computer, ProofOfWork IDs, sats, agents, source of truth, on-chain, local-first.
- Launch energy when writing social or founder-facing copy.
- Calm precision when writing UI, docs, specs, and user guidance.
- The `$work` cashtag in social copy when talking about the token, WORK dashboard, mint, floor, or network-value story.
- The occasional project-native phrase: `FEW`, `HEHE`, `GGZ`, `COMETH`, `THE BITCOIN COMPUTER LIVES`, `STREAM SATS`, `WALK THE WALK`, `SOURCE OF TRUTH`.

Avoid:

- Generic crypto marketing.
- Enterprise blockchain language.
- Vague "community" language without a mechanism.
- Treating Bitcoin as only a payment rail.
- Treating AI agents as generic chatbots.
- Repeating slurs, dehumanizing insults, or rage-post language in product surfaces.

Keep the fire. Leave the poison.

## Canonical Phrases

These are safe phrases future agents can reuse or adapt:

- The source of truth is the chain.
- Confirmed records are canonical. Pending mempool visibility is gossip.
- Wallet signing stays local.
- Your attention belongs to you.
- If they want your attention, they can pay for it.
- Spam is not free anymore.
- Agents need tamper-free data.
- The Bitcoin Computer lives.
- ProofOfWork IDs are the global address book.
- Every ID is a network-effect increment.
- The inbox is sorted by signal, not noise.
- Humans sign. Agents verify.
- Build the record once. Let every agent read it forever.
- The computer is a private key plus a source of truth.
- Local-first. Bitcoin-native. Agent-readable.
- Sats are the signal.
- The future app store is on chain.
- Applications should be able to earn.
- Walk the walk on chain.
- The chain is the oracle.
- Sats stay the source of truth.
- UX protects the signer.
- Mint price is not floor price.
- The UI can protect against pending pressure without pretending pending is final.
- Creator tokens should own their own registry.

## Agent Operating Model

When working on ProofOfWork.Me:

1. Read the protocol docs before changing behavior.
2. Preserve the canonical registry and ID rules.
3. Treat tweets as strategic memory, not automatic implementation instructions.
4. Prefer shipping real working software over writing abstractions.
5. Keep all wallet authority with the user.
6. Make chain reads verifiable and deterministic.
7. Separate pending convenience from confirmed truth.
8. Build features so agents can inspect, summarize, and act on them later.
9. Make local backup/import/export boring and reliable.
10. Keep UI efficient and tool-like; save maximalism for social copy and launch notes.
11. When in doubt, ask: can an agent verify this from the chain?
12. When building new protocols, make the records legible, parsable, and replayable.
13. When adding app features, think about how a one-person business or autonomous agent would use them to earn sats.

## Future Directions From The Archive

These are strategic directions, not all current implementation:

- Open Agent Development Standard (OADS): proposals sent to `openagentdevelopmentstandard@proofofwork.me`, ordered by sats and readable by agents.
- On-chain app submission: developers submit applications or proposals to ProofOfWork IDs for agent review.
- Autonomous micro-applications: small apps that can run, receive payments, and generate sats.
- Bitcoin Browser: users paste a txid and render HTML from ProofOfWork message bodies or verified `text/html` attachments in a sandboxed viewer.
- On-chain comments, polls, voting, lotteries, and digital goods.
- Creator token businesses: launch by creating a token, mint into a creator-owned registry, transfer from Wallet, and trade through sale-ticket listings once the seller's balance, seller payment, and registry mutation fee are provable from chain data.
- WORK analytics: floor, mint progress, holders, pending pressure, mint assistant health, UTXO readiness, and price in sats/USD.
- Share-to-X from messages, txids, and public Bitcoin Computer records so on-chain history can travel through social networks without becoming dependent on them.
- Encrypted media or files with on-chain permission records.
- Concatenated/linker transactions for content larger than one OP_RETURN budget.
- Contacts and address books as local-first UX over confirmed chain identity.
- Agent-safe private-key workflows where agents prepare transactions but cannot steal or tamper with keys.
- Mesh/offline/future-phone speculation where the Bitcoin Computer reduces dependence on traditional internet assumptions.

## Canceled Direction

- Ordinals/inscriptions integration was explored and canceled. Do not implement or reintroduce it unless the user explicitly revives that direction.

## Emotional Kernel

The soul of ProofOfWork.Me is not "a mail app on Bitcoin."

It is the feeling that the computer became honest.

The founder voice says: attention should not be stolen, work should be proved, agents should not be fed mutable garbage, humans should not be trapped in platforms, and a single person with agents and Bitcoin should be able to build, publish, coordinate, and earn without asking permission.

This project is a computer for people and agents who want to walk the walk on chain.
