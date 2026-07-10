# Mail Organization

Notes for mailbox features that make ProofOfWork.Me feel like a normal mail app while respecting ProofOfWork permanence.

## Current Launch Status

The Phase 1 public launch surfaces are:

```text
www.proofofwork.me          canonical landing page
proofofwork.me              permanent redirect to https://www.proofofwork.me/
id.proofofwork.me           focused ProofOfWork ID registry onboarding app
computer.proofofwork.me     full mailbox/computer app
desktop.proofofwork.me      public read-only file desktop
browser.proofofwork.me      public HTML browser by txid
marketplace.proofofwork.me  standalone asset marketplace; IDs and credit sale-ticket markets live
credit.proofofwork.me       standalone credit creation and mint app
token.proofofwork.me        permanent redirect to https://credit.proofofwork.me/
tokens.proofofwork.me       permanent redirect to https://credit.proofofwork.me/
wallet.proofofwork.me      standalone credit wallet, transfer, listing, delisting, and sale-history app
work.proofofwork.me         standalone WORK credit dashboard and mint page
infinity.proofofwork.me     standalone Infinity Bond / POWB market and bond composer
log.proofofwork.me          public ProofOfWork Computer log
growth.proofofwork.me       public growth model dashboard
```

Mail organization features that are already implemented in the full app:

- Incoming vs Inbox split for unconfirmed/confirmed inbound mail.
- Outbox vs Sent split for pending/dropped/confirmed sent mail.
- Drafts in local storage.
- Archive and Favorites in local storage.
- Contacts in local storage.
- User-created custom folders in local storage.
- Optional Subjects written into the OP_RETURN mail protocol.
- CC compose support for visible additional recipients.
- Multi-recipient compose with removable recipient chips.
- Reply All for multi-recipient mail.
- Approved mainnet senders can attach canonical WORK credit to a message. The message remains normal mail, while the same tx also carries WORK registry mutation payment and `pwt1:send` payloads for the mail recipients.
- Files view for confirmed attachments.
- Desktop search for confirmed public attachments by address or confirmed ProofOfWork ID.
- Browser view for HTML message bodies or verified `text/html` attachments by txid, rendered in a sandboxed iframe.
- Browser-rendered HTML stays separate from wallet signing.
- Canonical `Welcome to ProofOfWork.Me.html` system file pinned by txid and shown by default in Files/Desktop.
- Browser-readable HTML message bodies appear in Files/Desktop as derived `.html` files, even when no attachment exists.
- Browser workspace inside the Computer shell for viewing HTML txids and creating consistent Computer-native page templates.
- Marketplace workspace for confirmed ID listings, delistings, and buyer-funded transfers.
- Credit workspace for mainnet credit creation and minting, Wallet workspace for credit balances, transfers, listings, delistings, and sale history, plus WORK and Infinity workspaces for the dedicated WORK credit dashboard and POWB bond market. Creation pays the `tokens@proofofwork.me` index fee; mints, transfers, listings, seals, delistings, and buys pay each credit registry directly.
- Wallet-owned listing state is reconstructed from the shared credit marketplace ledger, including active, pending, delisted, and sold sale-ticket records. Core-backed sale-ticket spend checks keep Wallet, Marketplace, WORK, and Log aligned while summary payloads warm.
- Log surface for tx-backed registry, marketplace, mail, reply, file, attachment, credit, and seeded Computer mail actions from the canonical livenet ledger.
- Growth surface for canonical modeled network value versus real confirmed registry, log, file, marketplace, and Credit value metrics from the same livenet ledger snapshot used by WORK. WORK values are split into live network value, the active site/floor value, and frozen network value, the confirmation-time audit stamp.
- Export/import for local drafts, archive/favorite preferences, and sent/outbox tracking.
- Confirmed-only ID routing in compose: pending IDs must not receive routed mail.
- First-party OP_RETURN API reads for production mainnet mail, files, registry, Log, Growth, credit/token, marketplace, event history, and tx status when `VITE_POW_API_BASE` is configured; stable confirmed global reads use the proof index database where supported.
- Indexed mailbox reads come from the proof-index address-mail projection when supported; confirmed self-sends must render in both Inbox and Sent, and `pwm1:m:powb` Infinity Bonds must remain mailbox-visible while also classifying as `infinity-bond` in Log/Event History. Subject metadata from `pwm1:s` must stay separate from body text from `pwm1:m`; `mail_items.body_text` and UI memo rendering must not fall back to Log detail strings such as `Subject: ...`. POWB mint credit belongs to the bond recipient address; self-sends credit the sender because the sender is also the recipient.
- Indexed sent/file recovery may use raw transaction sender, recipients, payload,
  and proof-index participants to repair stale projection rows at read time.
  The chain transaction remains the authority; the repair is a projection fix,
  not a new mailbox rule.
- Confirmed Log/Event History, credit history, marketplace state, WORK/Growth
  network value, Wallet, and Infinity views must agree with first-party
  full-node confirmed tx truth before production changes ship. If a stable
  proof-index row hides a confirmed tx, shows a sold listing as active, or
  returns stale zero value, the projection is wrong and must be repaired or
  bypassed.

Future developers should keep `id.proofofwork.me` narrow. Do not pull the full mailbox UI into the Phase 1 registry launch unless the launch scope explicitly changes.
Marketplace actions should stay outside the mailbox folders. Keep ID and credit trading in the Computer Marketplace workspace and `marketplace.proofofwork.me`, while mail organization remains focused on messages, files, contacts, drafts, and local folders. The Marketplace workspace is tabbed by asset class: IDs and Credits both use sale-ticket settlement, while Wallet stays the place to transfer or list owned credit balances.
Log is not a mailbox folder. It is a read-only ProofOfWork Computer audit surface for every tx-backed app action the indexer can discover: registry events, marketplace events, messages, replies, files, attachments, credit creations, credit mints, credit transfers, credit listings, credit sales, and seeded Computer mail events such as Infinity Bonds. Server-backed Log search should query the canonical confirmed ledger by address, confirmed ID, txid, protocol kind, participant, token id, or app label, using the proof index database for stable confirmed search/filter reads and the node/API path for volatile first-page, fresh, pending, dropped, and fallback reads. A direct address lookup must not expose confirmed value-bearing events that are absent from global Log. Mail, Log, and Event History must agree on the same txid; if a confirmed mailbox tx is value-bearing, it must also be searchable in global Log/Event views with the normalized kind.
Growth is not a mailbox folder. It is a read-only model surface that compares confirmed chain-derived network value with the canonical ProofOfWork Computer growth model in proofs and USD. Merged apps such as Credits and Wallet should appear as normal app surfaces, Computer workspaces when useful, and first-class Growth inputs. Growth, WORK, Log, and credit/token history should read the same canonical ledger snapshot, served through the proof index database where supported, so proofs/USD totals and event search agree after refresh. WORK's live value is the current floor source; WORK's frozen value is the immutable confirmation-time value of past WORK movement and fixed event components.
Browser is not a mailbox folder. It is an HTML renderer over ProofOfWork message bodies and the same verified file attachment protocol used by Files and Desktop. Browser-rendered HTML stays separate from wallet signing. Browser should not introduce B protocol, Ordinals, inscriptions, or any outside carrier unless the product direction explicitly changes.
Confessions is not a mailbox folder. It is staged/local-only until separately approved. Confessions posts, social profile metadata, follows, likes, reposts, replies, tips, links, Files-backed small inline image references, Files-backed 100 KB profile banner references, and hide/archive visibility tombstones should use their own `pwc1:` meta protocol and should not be written as mailbox organization state or ID registry mutations. Confessions image bytes should be created through the existing ProofOfWork Files attachment layer and referenced from posts or profile proofs by file proof metadata. Its follow graph, Following timeline, profile tabs, profile earnings, and WORK-balance display are social views over confirmed chain-readable records, not local mail folders.

## Core Idea

Messages written to ProofOfWork are permanent. The app should not pretend users can delete them from the chain.

Instead, ProofOfWork.Me can provide local mailbox organization:

- Archive messages to remove them from Inbox.
- Favorite important messages.
- File confirmed messages into user-created local folders.
- Keep All Mail available so archived messages are still reachable.
- Keep Sent as local sent history.
- Send one message to multiple recipients without duplicating the OP_RETURN payload.

This gives users normal mail hygiene without misrepresenting what happens on-chain.

Subject metadata is not the message body. Mail composers may write a short `pwm1:s:<subject-base64url>` header and one or more `pwm1:m:<message-chunk>` body chunks, but readers should render the subject in the header and the decoded `pwm1:m` text as the body. Indexed or cached rows that only contain `Subject: ...` as body text are stale projections and should be repaired from the raw tx when the txid is known.

## Suggested Folders

```text
Incoming
Inbox
Sent
Outbox
Drafts
Files
Favorites
Archive
Custom folders
All Mail
```

Folder behavior:

- Incoming shows inbound messages that are visible in mempool but not confirmed.
- Inbox shows confirmed received messages that are not archived.
- Sent shows confirmed messages sent by the connected account, recovered from chain data when possible.
- Outbox shows local or chain-detected sent attempts that are pending in mempool or dropped.
- Drafts shows the connected account's local unsent message.
- Files shows confirmed messages from Inbox and Sent that contain attachments.
- Favorites shows starred confirmed Inbox and Sent messages, including archived favorites.
- Archive shows archived messages.
- Custom folders show confirmed mail the user filed locally under that folder name.
- All Mail shows everything the app knows about, including archived messages.

## Files

Files is a derived view, not a separate storage layer.

The app should scan confirmed known mail and show only messages with attachments. Pending Incoming messages or pending/dropped Outbox attempts should not appear in Files by default because they are not durable on-chain records.

Browser-readable HTML message bodies are also files for UX purposes. If a confirmed `pwm1:m` body looks like HTML and has no attachment, Files/Desktop should synthesize a `.html` file from the message body and open it through Browser by txid. This is a derived view only; it does not create a new protocol or pretend an attachment exists on-chain.

The default Files experience should feel more like a desktop/file manager than an email reader:

- Browse attachments across Inbox and Sent.
- Display files in a desktop-style icon grid.
- Show image thumbnails when possible.
- Show clean file icons for PDFs, documents, and other files.
- Filter by file type: all files, images, PDFs, documents, and other.
- Sort by highest proofs, newest, oldest, thread, largest file, file type, or address.
- Select a file to see a details inspector.
- Download from the inspector.
- Keep `Open Message` as an explicit option for viewing the source mail/thread.

This creates a Finder/Gmail/Google Drive style attachment surface while staying serverless. The file bytes still come from valid ProofOfWork.Me OP_RETURN payloads, and the source message remains available without dominating the Files view.

Files and Desktop should preview common content in-app before falling back to download:

- Images render inline.
- Audio and video use native browser players.
- PDFs use the browser PDF viewer when available.
- Text, Markdown, JSON, and code files render in a readable monospace viewer with one-click copy for humans and agents.
- Unknown file types keep a polished metadata/download fallback.

## Desktop

Desktop is the public read-only version of Files. On `desktop.proofofwork.me`, it is a standalone search engine, not the full Computer mailbox shell.

Behavior:

- Search a ProofOfWork address or confirmed `user@proofofwork.me`.
- Resolve ProofOfWork IDs only when confirmed.
- Load confirmed mail for the resolved address.
- Show confirmed attachments as a desktop-style public file space.
- Preview supported files directly from the on-chain attachment bytes.
- Support the same file filters and file-oriented sorts as Files.
- Do not require wallet connection for browsing.
- Do not show local-only metadata such as drafts, folders, favorites, archives, or contacts.
- Do not show pending Incoming or Outbox transactions as public files.
- Always include the canonical `Welcome to ProofOfWork.Me.html` system file so every searched address has a starting document. It should open through Browser by txid, not pretend to be a user-owned attachment.
- Do not expose `Open Message` as a private mailbox action in the public inspector; link to the source transaction instead.
- Do not show the Computer sidebar, compose tools, wallet controls, inbox/sent folders, or local account state on the public Desktop route.

Production route:

```text
desktop.proofofwork.me
```

This route should use the same OP_RETURN parser/API as the full Computer app. It is a presentation surface, not a new protocol.

The Computer app may still keep an internal Desktop folder for signed-in users. That internal view can live inside the Computer shell; the public Desktop domain should stay focused on search and public file browsing.

## Browser

Browser is the public HTML renderer for the ProofOfWork Computer. On `browser.proofofwork.me`, users paste a txid and the app renders HTML from the existing `pwm1:m` message body or reconstructs a verified `text/html` attachment from `pwm1:a` chunks.

The full Computer app also exposes Browser as a sidebar workspace. New products should follow this pattern: a standalone public surface when useful, a Computer workspace when it belongs inside the full machine, and a matching entry in the growth model.

That same shape applies to audits: test the standalone surface first, then test
the matching Computer workspace during the final `computer.proofofwork.me`
audit. Computer should be the last integration check over surfaces that already
passed on their own.

Behavior:

- Accept a ProofOfWork txid on mainnet, testnet4, or testnet3.
- Fetch the transaction through the ProofOfWork API when configured.
- Render HTML-like message bodies directly from `pwm1:m` chunks.
- Reconstruct HTML attachments through the same size and SHA-256 checks as Files/Desktop.
- Render only HTML-like content: message bodies that look like HTML, or attachments marked `text/html`, `application/xhtml+xml`, `.html`, or `.xhtml`.
- Render pending pages inside a sandboxed iframe with scripts disabled.
- Render confirmed pages inside a sandboxed iframe that may run page scripts, but without same-origin privileges.
- Keep wallet signing outside Browser iframes. Browser renders verified HTML, but iframe scripts do not get a parent signing bridge.
- Show proof metadata: txid, status, network, sender, proofs, protocol bytes, size, and SHA-256.
- Expose a simple Computer-native HTML template users can copy before publishing as a message body or download before publishing as a normal ProofOfWork file attachment.
- Treat pending pages as pending visibility, not final truth.

Canonical welcome page:

```text
txid: 8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b
name: Welcome to ProofOfWork.Me.html
carrier: pwm1:m HTML message body
```

Production route:

```text
browser.proofofwork.me
```

This route should stay compatible with the current Computer mail/file protocol. HTML pages are messages or files, not a new external carrier.

## Outbox

Outbox is local broadcast tracking for transactions that have not become durable on-chain mail yet.

Broadcast attempts should have one of these statuses:

```text
Pending
Confirmed
Dropped
Checking
```

Behavior:

- New broadcasts enter Outbox as Pending.
- The app checks the txid through the selected network's first-party ProofOfWork API status route.
- Confirmed txs move into Sent.
- Confirmed sent mail is also reconstructed from the connected address transaction history, so Sent and Files survive stale local browser state.
- Dropped txs remain in Outbox with a restore-to-draft action.
- Dropped txs should not appear in Sent or Files.
- Pending txs should not appear in Files by default.
- Pending visibility is best-effort because mempool transactions are gossip. The API can merge local node/proof-indexer mempool state with a pending fallback, but confirmation is the only durable state.
- Older local sent records without a known status can appear as Checking until the txid is verified.

This prevents the app from treating dropped mempool transactions as permanent mail.

## Incoming

Incoming is the inbound mirror of Outbox.

Behavior:

- Unconfirmed inbound ProofOfWork.Me payments appear in Incoming.
- Once confirmed, inbound mail moves into Inbox.
- Incoming messages can be viewed and replied to, but should not be archived as permanent mail until confirmed.
- Incoming attachments should not appear in Files until the transaction confirms.
- Self-sends can appear in both Incoming and Outbox while pending, then Inbox and Sent once confirmed.

## Refresh

Refresh is a single on-demand sync action for the connected account.

Behavior:

- Rescan the connected address for incoming and sent ProofOfWork.Me protocol transactions.
- Rebuild Incoming, Inbox, Sent, and Files from the latest chain/mempool view.
- Check pending, dropped, and checking Outbox txids against the selected network's first-party ProofOfWork API status route.
- Move confirmed inbound mail into Inbox, and confirmed broadcasts into Sent and Files.
- Keep pending Incoming or pending/dropped Outbox records out of Files until they become durable chain records.
- Show a concise status summary after refresh.

## Local State

Drafts, archive, and favorite state can stay serverless at first.

Drafts:

- Store one draft per wallet address and network at first.
- Save recipient, CC recipient, subject, proofs, fee rate, message body, attachment, reply parent txid, and update time.
- Keep drafts in `localStorage`; they are not written on-chain.
- Clear the draft after successful broadcast or explicit discard.
- Key drafts by `network + address`.

Archive and favorite preferences:

Store local message preferences and custom folder assignments in `localStorage`, keyed by:

```text
folder-network-txid
```

Example shape:

```json
{
  "inbox-testnet4-e3760f38...": {
    "archived": true,
    "favorite": false,
    "folders": ["projects"]
  }
}
```

When the app scans inbox or loads sent mail, it should merge blockchain/local messages with these local flags.

Custom folders:

- Store the folder list locally in `localStorage`.
- Folder membership is local metadata keyed to known message txids.
- Only confirmed Inbox/Sent mail should be fileable so folders do not imply dropped or temporary mempool data is durable.
- Custom folder names should remain user-controlled; the app only normalizes whitespace and keeps the local UX tidy.

Contacts:

- Store contacts locally in `localStorage`.
- A contact can be a ProofOfWork address or a confirmed `user@proofofwork.me` ID resolved to its receive address.
- Pending IDs should not be saved as routable contacts.
- Confirmed registry rows can expose an `Add Contact` action next to `View TX`.
- Compose should offer saved contacts as suggestions.
- Contacts are convenience metadata only; they do not change on-chain mail routing.

Multi-recipient mail:

- Compose accepts addresses, confirmed ProofOfWork IDs, and saved Contacts separated by commas, semicolons, or new lines.
- The To field and CC field both resolve through the same confirmed-ID/address logic.
- Each resolved recipient gets a normal ProofOfWork payment output before the first `pwm1:` OP_RETURN output.
- The OP_RETURN payload is written once per transaction, so all recipients share the same txid and thread root.
- The reader derives recipients from payment outputs, not OP_RETURN data.
- To/CC labels are local sender-side organization metadata. Recipients can see payment outputs on-chain, but the protocol does not currently make role labels authoritative for every recipient.
- Reply targets the sender; Reply All targets the sender plus other payment-output recipients, excluding the connected wallet address.
- Keep the current cap at 10 recipients until wallet signing UX and fee estimates have more production mileage.

Subject:

- Write optional subjects as `pwm1:s:<subject-base64url>`.
- Keep subjects short in the UI, but let the aggregate OP_RETURN transaction cap remain the hard protocol limit.
- Fall back to the first message line or attachment name for older mail without a subject field.

## Product Language

Use:

```text
Archive
Favorite
Unarchive
Remove favorite
All Mail
```

Avoid:

```text
Delete
Trash
Erase
Remove from chain
```

The user can hide messages from views, but the app should be honest that on-chain messages remain permanent.

## Backup And Import

Local state should be portable because ProofOfWork.Me is serverless.

Backup should export a versioned JSON file containing only supported app-local data:

- Drafts keyed by wallet address and network.
- Archive and favorite preferences.
- Custom folder definitions and folder membership.
- Local contacts.
- Local sent/outbox broadcast tracking.
- Theme preference.

Import should validate the JSON before writing anything, ignore unsupported keys, and restore only ProofOfWork.Me local storage keys. It must not include wallet private keys, seed phrases, UniSat connection state, or anything outside app-local UX data.

## UI Notes

Useful controls:

- Archive button in the reader toolbar.
- Favorite star in the reader toolbar.
- Favorite marker in message rows.
- Sidebar counts for Inbox, Sent, Favorites, and Archive.
- Sidebar count for Drafts.
- Sidebar count for Files.
- Empty states for Favorites and Archive.
- Empty state for Files when no attachments are available.

Useful sorting:

- Highest proofs.
- Newest.
- Oldest.
- Thread.
- Favorites first, if needed later.
- Largest attachment and file type for Files.

## Sync Considerations

At first, archive/favorite state is local to the browser.

That means:

- It is private.
- It is simple.
- It works without a server.
- It does not follow the user across browsers/devices.

Later options:

- Export/import mailbox preferences.
- Encrypted backup tied to a ProofOfWork.Me ID.
- Optional server-side encrypted preference sync.
- Optional wallet-signed preference records.

The first implementation should stay local and simple.

## Leaderboard

ProofOfWork.Me can add a leaderboard to show which accounts or IDs receive the most proofs through messages.

This turns paid mail into a visible attention market:

- More proofs received means more value, attention, or signal.
- Public rankings make the app feel alive.
- Users can discover high-signal accounts.
- Recipients have an incentive to share their ProofOfWork.Me address or ID.
- It adds a game layer without changing the core mail protocol.

Possible leaderboard views:

```text
Top Receivers
Top ProofOfWork.Me IDs
Most Messages Received
Highest Single Message
Most Replies
Trending This Week
```

Possible ranking windows:

```text
Today
7 days
30 days
All time
```

Possible ranking metrics:

- Total proofs received.
- Number of messages received.
- Highest single message value.
- Number of unique senders.
- Reply activity.
- Thread activity.

Before ProofOfWork.Me IDs exist, the leaderboard can rank raw ProofOfWork addresses.

After IDs exist, the leaderboard should prefer names like:

```text
user@proofofwork.me
```

The leaderboard can still fall back to raw addresses when no ID is registered.

Important design note:

- The leaderboard should only count valid ProofOfWork.Me protocol messages.
- It should not count random payments or unrelated OP_RETURN transactions.
- Archived/favorited local state should not affect public ranking.
- The leaderboard should be computed from indexed confirmed chain data, not local browser state.

## Big Picture

Archive, Favorites, and Files make ProofOfWork.Me feel like a real mail client.

They also fit the ProofOfWork model:

- ProofOfWork keeps the permanent record.
- The app gives users a personal view over that record.
- No delete fiction is needed.
- Leaderboards make paid attention visible and social.
