# Publish writer and Mail integration — 2026-10-04

The follow-up application release committed on 2026-10-04 UTC (Oct 3 in
America/Toronto) is production-verified and announced. Node acceptance, UI
publication, all-file HTTPS checks, focused live contracts and guest writer
browser review passed. All prior local drafts and every original refusal remain
intact. This documentation-only handoff records the final production evidence
and preserves the distinct application and deployment-tooling identities.

Publish now opens a dedicated article writer at `publish.proofofwork.me/write`,
local `/?publish=1&write=1`, and Computer `/?folder=publish&write=1`. Writing and
preview use normal document flow and scrolling. Only exact transaction consent
uses a dialog. Back/Forward and reload retain the wallet/network article draft;
a direct writer link has a safe Articles fallback. A failed synchronous save
blocks manual Back, browser Back and workspace leave while preserving text.

Mail Compose offers Mail, Boost and Publish. Publish saves the complete private
Mail composition before opening its separate article draft in the same Computer
origin. Mail text, recipients, attachments and reply context are not imported
into the article. Back restores the current wallet/network Mail draft. When the
account has changed, it restores that account's draft and aligns the Drafts URL,
without reviving the previous account's composition.

Confirmed article self-sends appear in both Inbox and Sent through the existing
Mail projection. Indexed and raw Mail attach compact article metadata only when
the exact confirmed companion post and body commitment agree. The reader checks
fresh exact-txid body evidence. Pending, ambiguous, malformed, wrong-network or
changed-byte evidence does not establish a verified article. Ordinary Mail and
historical Boost self-sends retain their existing projection behavior.

| Release identity | Exact binding |
| --- | --- |
| Application | `eb5e8c70cb0df99fa50ff4d94be1f3ab69546d09`, tree `ee3b85ea5ac58c30e31ff5e6774d01fad6303f4d` |
| Release | `eb5e8c70cb0d-20261004T005638Z` |
| Prior closeout | `4f7af6daa47539cf34cf0e3757b830ad5f64df94` |
| Git | `codex/publish`; application and deployment tooling committed and pushed |
| Deployment tooling | `8062c68a4df570904fbb700c96bfee0764f6f309`, tree `2bb63c280f748b11ac3422b88c87003bd7271019` |
| Node runtime | `0c2c42c315a24c534c4c6741d6faca413dab14eb93dfb322791a1572b1f4f4ae` |
| Node acceptance | `74fe79da0eb11c71d469037e0d4f9cc0ee84b2ba3406c5552924d20ff69d93f4`, checkpoint `969783/00000000000000000001f5156b6bd78db9a946ea0e74f086e2379b6495e33982` |
| UI publication | Manifest `b9e89168f9763a04fe3b3f9122303933e3a18bff4d7f354de71f10d4bf0427c2`; managed archive `789e5969e4348d4c9d8d328fb6d04ff94f555071012e253ce51f1e078b5d6319` |
| Public HTTPS | `9d159c1eb160ac8cad5c4bffd0570b48ca5657b76ac755e70677481962de9d82`; 992 public files / 16 public roots |
| Announcement | [Verified release post](https://x.com/proofofworkme/status/2106562933551436262), posted 2026-10-04 01:51:56 UTC |

Local wallet signing, exact aggregate OP_RETURN allowance, transaction review,
signed-txid-before-broadcast recovery, uncertain-status protection, PowID
selection bridging and shared Boost engagement remain in place. The identity
bridge does not relay article text. This change adds no registration/economic
migration or second article payment/engagement protocol. Historical audit files
are byte-identical to the prior closeout, and the application diff contains no
tracked file deletions. Node protected state is recorded by its verified closeout. UI publication preserves
all three prior retained roots and adds a rollback root matching the prior live
manifest and tree.

The exact focused browser selection passed **37/37**: Publish 13, Boost social UI
5 and Mail 19, including eight new Mail integration checks. It was selected with
`--list` before execution. Vite observed a late `App.tsx` change during that run;
the final changed-account route alignment was separately retested after source
freeze: **1/1 passed** in 9.5 seconds. The corrected Inbox WORK admission fixture
was also tested alone on the exact committed source: **1/1 passed** in 8.5
seconds. Both scoped preview servers stopped without further HMR output.
TypeScript, the UI contract and build passed; the build retained its ordinary
large-chunk warning.

`check:publish` passed the two directly visible parent file wrappers, eight
signed identity checks and five signed-receipt recovery checks. The separate Mail
projection log exposes one passing parent file wrapper. Its committed source
contains eight named fixture groups; that source count is not presented as an
independently logged child assertion total. The immutable Mail index/recovery
regression log reports **552/552 behavior checks passed**. No unsupported
295-check aggregate is claimed.

The original broader Mail file run remains **88 passed / 4 failed out of 92**:

- Inbox WORK admission and Unknown Mail broadcast fixtures lacked the canonical
  address/network response shape. Their original failures remain retained.
  Corrected Inbox passed the isolated committed-source test; corrected Unknown
  Mail passed within the exact 37-test focused selection.
- The two standalone INCB assertions reproduced on the retained prior `d5a849`
  build, using the unchanged selected test bodies and 54 byte-matched Computer
  surface files (13,791,030 logical bytes). That baseline run intentionally
  retains two failures. It proves the same assertion failures existed on that
  baseline; it does not certify every unrelated INCB behavior or convert the
  92-test run into a pass.

Original logs also retain dependency-font allow-list warnings from the earlier
symlinked preview. The final frozen account and committed Inbox tests used fresh
locked dependencies. Positive article body, Mail projection, identity, signing
and social checks are local fixtures. No production wallet signature, financial
broadcast, confirmed article or social action is asserted by these local results.

The companion `2026-10-04-publish-writer-mail-release.evidence.json` pins immutable
local logs, selections, baseline comparison and initial audit files by bytes and
SHA-256 without embedding private streams, secrets or deployment plans. Completed
production and announcement receipts are recorded below. This documentation-only
closeout does not trigger a second announcement.


The Node final closeout is pinned by SHA-256
`c8139babec89e9a40493ba811085c42a831c3edb89ed32d565e4fb471b618725`.
It verifies the exact eb5 application/tree/runtime at stable checkpoint
`969783/00000000000000000001f5156b6bd78db9a946ea0e74f086e2379b6495e33982`.
IDs, events and parity gates passed with stable checkpoints; the ID gate reports
587 fetched transactions, 508 confirmed winners and 20 pending candidates, while
events and parity report 49 and 102 checks. The accepted public exact-ID read
records `ross` as pending; it is not described as confirmed. Wallet balance and
capacity passed. The complete listing book has 1,006 rows and independently
checked Core anchors, with six full and six display pages and membership
rechecked after Core verification.

The Node closeout attests preserved Core, Electrs and PostgreSQL identities,
timer states and retention holds, together with the prior checkout and recovery
archive/provenance. The new API and worker run the exact eb5 runtime. No private
controller command contents or raw private streams were exported, and no
financial transaction or broadcast occurred during verification. The existing
Node controller remains pinned at
`09afe5ddd243a796ea9c830b0041924747eb77a3803a3cfe56a3279cd24bf670`.
These Node acceptance claims are distinct from the successful UI publication and
public verification recorded below.

The read-only Node closeout collector also retained two operator refusals.
Its initial assumption of at most 64 JSON-only controller entries refused the
actual 145-entry directory. A revised bound of 256 kept private command logs as
metadata only, then refused with `NameError` because its explicit `TREE` pin was
missing. The corrected collector passed and retained 16 JSON receipts plus
metadata for 129 private command logs. Original operators, refusals and bounded
metadata diagnostics remain pinned. No command-log contents or raw private
streams were read or exported, and no Node acceptance or deployment was retried.

Initial UI staging refused its installed stager's full-copy scratch bound:
`4,936,785,920 + 478,883,840 > 5,368,709,120` bytes at
`stage-private-root`. The current release input had already been durably moved
without changing inodes into its exact evidence pool. All eight initial failure
records and its incoming/independent receiver receipts remain pinned. No stage,
source checkout or private candidate existed at refusal; live UI and three
retained roots remained unchanged. The scratch limit and cleanup prohibition
were retained.

Deployment tooling commit
`8062c68a4df570904fbb700c96bfee0764f6f309` recognizes only this exact initial
`surfaces-stage` eight-record refusal as an additional preserved-stage recovery
case. It retains the historical six-record resume case. The application and
archives remain eb5; only the deployment documentation, two validation helpers
and refusal tests change. Independent review verified frozen patch
`3b15f391be49f261c4d740d5114f2ae92126f578b6df2d21c8fee9324c784d3a`,
with all other helper module logic unchanged. Seven new tests plus fifteen
retained focused tests passed (**22/22**), and the complete wrapper suite passed
**43/43** in 119.948 seconds. The actual captured eight-record binding passed an
offline check; that is not a remote stage or publication acceptance. No capacity,
root reserve, inode, authorization, provenance or exclusive-lock check was
weakened, and no installed helper changed.

The fresh official UI preflight passed and its exact proof remains preserved.
A separate local summary step requested absent `storage` and raised
`KeyError: storage` after the tool had saved the proof. That summary refusal did
not require repeating the official preflight or any production mutation; both
outcomes remain separately qualified. The original completed-v1 UI plan and bounded review remain pinned. The completed
stage, source-only retry, publication and public verification are recorded below.


Completed-v1 staging passed under the unchanged capacity and authorization
checks. The completed candidate has 1,455 paths and 717 unique inodes; its
239,136,768 allocated bytes plus 23,904,256 metadata bytes charge 263,041,024
additional bytes. The initial full-copy estimate of 478,883,840 bytes remains
preserved and charged on its evidence filesystem. The 5 GiB scratch ceiling,
10 GiB root reserve, inode checks, no-follow/no-atime ownership checks, bounded
managed execution, exclusive locks and cleanup prohibition remain intact. No
installed helper was promoted or replaced during this follow-up. Stage receipt
`e4ad8ead68a544fc4cba1e39fd3ede6e605947e5e4ab7de009888efd96bbd067`
binds the unchanged 211,800,485-byte managed archive.

The first source phase refused at its nonblocking exclusive deploy lock with
`EAGAIN`, before creating an output namespace, reading input or extracting
source. Its original log and dispatch remain pinned. The later read-only census
found no current lock owner, no source outputs, an intact stage and unchanged
live/retained/input roots. The historical holder is unknown; no monitor,
collector or deployment is asserted as its cause. No holder was stopped and no
lock was bypassed.

A separately reviewed source-only retry used a fresh preflight. Its plan differs
only in attempt name, fresh preflight hash and removal of the stage-resume
binding; application, tooling, archives, input and old roots remain identical.
There was no surface restage or input replay. Source receipt
`8888e91b2f924c97018c461a57f6998a8637ce9508e78d7de86c48c0574870b1`
records the exact clean detached eb5 application/tree and successful candidate
provenance. The source receiver pins archive
`991052ec328ad7b67226ce82a8186d787afe2b5d5dd1a2dc1a2f4a1923370c45`;
its independently reconstructed 413-byte canonical receipt has SHA-256
`e8578949228fb4b93344ab79ca873d174363ae06f2af47e0102c1546f6f7a803`.
The 53,349-byte candidate provenance log is pinned without embedding its contents.

Publication used the original completed-v1 plan, separately binding the accepted
source retry. It passed at 2026-10-04 01:45:59 UTC after 418.346 seconds. The
publisher log is pinned at
`380c12f3fd1ef0fc088c816cf0a06941720583588476739c7af1f58b841aa1c7`.
The new manifest is `b9e89168f9763a04fe3b3f9122303933e3a18bff4d7f354de71f10d4bf0427c2`.
All three prior retained roots remain unchanged. The new rollback root preserves
the former live manifest `201fcf4897c1eaf9cd0062476ed00f00fa277af10d3c9f3628d1df6ce10425b6`
and tree `c038882738369d2fa03c0338eb32eca5758468f293f07f6270b73462d6ac8f2d`.
No historical deletion occurred.

Public HTTPS verification checked **992/992 public files** across **16 public
roots**, totaling 237,576,152 response bytes, and verified the apex redirect.
The managed provenance contains 17 surfaces and 1,054 regular files: 62 archived
NFT alias files remain preserved and are excluded from public counts. Archive,
checksum sidecar and provenance match the exact eb5 application/tree and published
manifest. Verification finished at 01:50:51.063 UTC in 229.822 seconds. This count
describes the public release, not deletion of the archived compatibility alias.

The separate focused live verifier passed **16 checks / 21 HTTPS responses**.
All 21 retained bodies independently match their recorded bytes and hashes.
Dedicated writer assets and Computer navigation match the committed build. The
exact Computer bridge query permits only the trusted Boost, Publish and Computer
ancestors; ordinary, duplicate-query and other-path Computer responses retain
framing denial. Boost and Publish parent policies permit same-origin frames and
the Computer bridge. The complete, compact, bodyless article feed contains zero
verified articles; ordinary Boost contains eight records with existing kinds,
counts and its 140 UTF-16-unit text cap intact.

Live in-app browser review exercised the guest writer direct route, normal page
scrolling, zero dialogs, regular 400-weight body text, exact inline preview,
draft reload, direct-entry Articles fallback and browser Back/Forward. It restored
and reloaded the original empty guest draft. The guest Mail action reached its
wallet-connect state; connected Mail composer handoff was not exercised live.
With zero confirmed articles, article detail and article self-send Inbox/Sent
confirmation were not exercised live. Those positive cases retain local fixture
coverage. No production wallet signing, financial broadcast, article publication
or social transaction was performed for verification.

The single release announcement was published by the logged-in in-app browser
and verified at its dedicated permalink:
[verified release post](https://x.com/proofofworkme/status/2106562933551436262). Its receipt is pinned at
`cb7c314e7d5e15914643d168bafb3851f80f15ca166254bedbfa0d8f01d15d92`.
The first button click retained the composer, and a fresh profile showed no new
post. The same retained draft then submitted via Enter; author, exact text,
writer link and `$WORK $POWB $INCB` were verified on the single published post.
No duplicate announcement or documentation-only second post is required.

The independent review of the collected receipts used local evidence only and
performed no remote SSH, repository edit or deployment mutation. It reconstructed all 12 captured stage records and
all nine source records, checked the canonical source receiver, focused response
bodies, managed archive/sidecar/provenance and browser/announcement screenshots.
The companion JSON pins every referenced file by exact bytes and SHA-256 without
embedding secrets, raw private streams, whole deployment plans or controller
command contents. Product, deployment and announcement work is complete. This
documentation-only handoff preserves the evidence without relabeling the deployed
application or publishing another announcement.

Repository closeout reviewed SOUL, canonical product/protocol docs, classified
notes, generated artifacts, the cleanup allowlist, Git scope and relevant tests.
The hygiene cleaner found no allowlisted rebuildable state to remove, and the
initial repository state check passed. Current Boost compose wording now calls
it an option in the selector. This handoff adds only documentation, audit
evidence and note classification; there are no tracked deletions. The final
repository state check passed; the tracked commit hooks enforce the same final
state and required hygiene trailers when this handoff is committed.
