# Publish release — 2026-10-03

Release began on 2026-10-03 UTC. Final public verification and the verified
announcement completed on 2026-10-04 UTC (Oct 3 in America/Toronto).

Publish provides text-only articles at `publish.proofofwork.me` and Computer's
Publish workspace. Browser-local wallet/network drafts support title/body
editing, preview, exact transaction review and local signing. Articles use one
existing `pwb1:post` plus exact same-transaction UTF-8 `pwm1:m` body bytes. The
compiled aggregate OP_RETURN script ceiling remains 100,000 bytes; ordinary
Boost posts/replies and article titles retain 140 characters. Boost and Publish
share confirmed profiles, selected PowIDs, follows, likes, replies, reboosts and
current-owner payments. No new ID/economic migration or engagement protocol was
introduced. Confirmed records remain canonical.

| Release identity | Exact binding |
| --- | --- |
| Application | `d5a8493119baf48231cab2db34883169399a41be`, tree `938354edb5174f320fbcf284e66a1c5532885a1d` |
| Tooling | `b35829846c105cfa5e9b50e7df3de1a1ebfbe738`, tree `f7f6f57bc1f9d3dbd780c892a5ccdb5c1af53017` |
| Release | `d5a8493119ba-20261003T222517Z` |
| Node runtime | `f7fe0b8ed5484d641c35fd416a41e7b179429802419a76db4712f61f92219ea3` |
| Managed UI archive | 213,287,253 bytes, `fc4f3d4d61ead3b3bac5dac1c9d967bcee6992bcd79b1759130b15fe43a3ca66` |
| Final manifest | `201fcf4897c1eaf9cd0062476ed00f00fa277af10d3c9f3628d1df6ce10425b6` |
| Final Node acceptance | `6f8a8327a4442547d54eea2e4d52feca0cb04ca20ddc5a8e4a86ed33169f4121`, checkpoint `969778/000000000000000000003a2ca37e47607a8f2aa0ddc296786bcdafee61507b34` |
| UI publication | `5555b7346e2c423fc7861933ff34121fcf2592105315fe5a3494bff562a37ce2` |
| Caddy installation | `5e4e3c0e8b34399a5cf6fe06ee050b437e0b44a56547ece6e469ce1d3bded9df`, config `07498aaf20376c0aa3f3de1802337fa5a657288ec743a08dd2ba04cf1c250c58` |
| HTTPS/browser | `1d8a378c80e92835a508d02619d1aa180e1b1e29d74db530c3001af1fe3b2cac` / `85c941d43e9350012e6e9b5ff0c879e94c2c7e687285c9cc3224fbda3adb5ec5` |

The application artifacts remain unchanged across tooling repairs a4c45f→
dc5266d→b3582984. The original scratch refusal and subsequent full-copy refusal
remain preserved. The completed candidate was built in its exact release
evidence pool and admitted 262,606,848 conservative bytes (1,511 paths / 686
unique inodes). Its original 452,718,592-byte logical-copy guard stayed active
on that filesystem; the 5 GiB scratch ceiling, 10 GiB root reserve and shared
lock stayed unchanged. Source is the clean detached application commit, and
candidate provenance passed. The guarded Node exchange completed at 23:02:26
UTC. Core, Electrs and PostgreSQL identities, prior checkout/archive, all
retained UI roots, recovery material, holds and prune masks remained protected.
No historical deletion occurred.

Launch attempts remain evidence. They include the old-controller CLI refusal,
initial controller-lock refusal, strict checkpoint movement, an undetermined
ID-gate failure later followed by direct recovery, and retry4's known operator
origin error (`api.proofofwork.me` DNS `ENOTFOUND`). Corrected attempts use the
already documented Computer public origin. The initial Caddy version-pin mismatch
(`v2.6.2` expected / `2.6.2` observed) refused before installation or reload; its
fresh retry bound the observed version and exact binary, without weakening guards.
Passed child gates or public reads
do not substitute for a complete stable acceptance receipt. The companion
[evidence](2026-10-03-publish-product-release.evidence.json) records exact
attempt outcomes and immutable receipt pins without private streams or plans.

Local verification passed article protocol 9, Publish/Boost browser 13, wrapper 35,
stager/phase 15, dedup 16, UI operations 8, isolated loader 1 and expanded focused
wrapper 15 checks, plus build/types/UI contracts, hooks and hygiene. Final Node
acceptance independently verified 1,006 WORK book anchors, complete full/display
listings (six pages each), wallet capacity/balance and stable checkpoint 969778.

Off-host HTTPS compared `1,044` files across all sixteen public
hostnames and verified the apex redirect; all seventeen managed roots include
NFT. Its 66 archived alias files remain under the prior verified Computer alias
proof and were excluded from public hostname requests. Focused verification passed 13 checks / 16 requests, receipt
`a83a4fc8caf84dd9b0a7312b6295a30b1c0db8b6df794fe8a0ad3894d6b9dac8`.
Valid TLS, exact root/entry/navigation bytes, one CSP header per response, seven
bridge/parent variants and shared Publish/Boost behavior passed. The exact
Computer bridge permits Boost/Publish/Computer framing with no X-Frame-Options;
ordinary Computer, duplicate queries, extra folder queries and other paths retain
DENY and `frame-ancestors 'none'`. Boost/Publish permit same-origin frames and their Computer bridge child.

The live browser loaded the indexed empty article state and guest editor,
previewed temporary text (36 words / 555 of 100,000 script bytes), then restored
the fields empty and closed the editor. Its receipt is
`85c941d43e9350012e6e9b5ff0c879e94c2c7e687285c9cc3224fbda3adb5ec5`.
The article feed was complete with zero confirmed or pending articles; ordinary
Boost had eight confirmed entries. No production wallet was connected, selected
identity signed, transaction submitted, or confirmed article body/social action
exercised. Synthetic positive body, identity, review/signing and social tests
remain separately qualified. No financial broadcasts occurred during verification. The first generic HTTPS
collector exited 143 (SIGTERM) without a final receipt; the triggering cause is
unknown. Its inputs remain retained. The exact committed verifier and settings passed
the tty retry: 1,044/1,044 files, 16/16 hostname roots and 241,820,726 response
bytes in 227.227 seconds. No byte-mismatch or deadline diagnosis is established.

Announcement: [verified release post](https://x.com/proofofworkme/status/2106537799943868594). This bookkeeping
records the same release and does not create a second announcement. Earlier
dated release/helper tables retain their historical pins; current serving and
installed helper state is established by this release's receipts.
