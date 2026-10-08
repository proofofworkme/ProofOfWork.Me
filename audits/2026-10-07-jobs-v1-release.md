# Jobs v1 release — 2026-10-07

Jobs v1 is production-verified at `jobs.proofofwork.me` and Computer's
`/?folder=jobs`. It connects public briefs, proposed terms, fixed assignment,
delivery and client-approved direct proof payments into inspectable receipts.
Public browse/search needs no wallet. Signing remains local; agents can prepare
and verify. Offered rewards are not funded escrow. Client acceptance establishes
the client's decision and exact payment, not objective work quality.

The user approved the complete build-and-ship scope on October 7. Deployment
began October 7 UTC; final production verification completed October 8 UTC
(October 7 in America/Toronto). The companion [evidence](2026-10-07-jobs-v1-release.evidence.json)
records exact identities, receipts, raw API evidence and qualified checks.

| Release identity | Exact binding |
| --- | --- |
| Source commit | `fc396c9a9abd1cdb1081b0b3585f1d02f3289a1d` |
| Source tree | `8093a90255aad38145bc44efda5d8a4976336bea` |
| Main merge | `7244cf717bed8249bbc7550b59182fa640840ec7` — identical tree, PR #111 |
| Release | `fc396c9a9abd-20261007T233244Z` |
| Node plan | `2c9f7009ccd8d47e63801ae10ba0373dd1fd115686fe54faadc8946f5effcd95` |
| UI manifest | `30a6c0e9273b601eff11b4fecb4f2fab5a62ae9d0f076d871363bbea66944c40` |
| Managed archive | `962a790de9060deca5d54f295965f19a3797d39a620609a2bcc194efa6334452` |
| Caddy | `23a5ec1fb98091ac50f497cc75d406312e2858edb18ee1d26579a2398606a6ae` |

Jobs uses closed version-one `pwj1:` metadata inside ordinary `pwm1:m:` Mail and
normal Files. Underlying payments and carrier bytes retain their existing
canonical accounting exactly once. ID/DNS/marketplace rules, fee splits, WORK
formulas and protected AMO anchors remain unchanged. No Jobs schema migration,
registry fee, custody, arbitration or autonomous spending was introduced.

Confirmed admission starts at 970404 with the immutable independently verified
970403 parent pin in [JOBS.md](../JOBS.md). Bootstrap covered two raw blocks
through 970405 with complete empty discovery. Independent hot-index verification
then matched Core and all 26 fresh consistency checks at 970409, four blocks
beyond bootstrap. The public Jobs API and live browser reads matched 970410.
At that checkpoint, jobs, candidate events and accepted payments were zero;
`paidProofs` was the exact string `0`. Pending visibility remained best effort.

The node installed only eight reviewed, independently hash-verified merged
runtime files and preserved all 70 dependency pins, native storage access,
Core/Electrs/PostgreSQL authority identities and the existing Git baseline
`92eb5fbdaacfd05955dae6d994586850f93944b9`. Search was held, then restored with
its pinned units and timer. The controller retained original bytes and rollback
receipts. It preserved accepted audit, Code and content-tip overlays.

All nineteen public builds and the verified Computer/NFT alias came from the
exact committed source. The first staging attempt verified the input bundle,
then refused a 515,686,400-byte full-copy admission against 4,942,610,432 bytes
already in scratch and the unchanged 5,368,709,120-byte ceiling. Its evidence and
inputs remain retained. Supported continuation built in the release evidence
pool, measured 284,164,096 bytes / 1,020 unique inodes, and passed the original
scratch and 10 GiB reserve gates. All prior roots and the complete previous live
root remain retained. There was no historical cleanup or guard weakening.

Source recovery passed 552/552; Mail preservation passed 295 and pending/fee
checks passed 25. Jobs/Code tests passed 42, scoped deployment checks 12,
supervision checks 14, publisher checks 48, and disposable browser fixtures 11.
UI operations, build/types, affected accounting/live-data gates and hygiene
passed. GitHub hygiene passed on Node 20/22/24. Exact captured-runtime differential
improved from 543/552 to 544/552, with zero new failures and eight unchanged
native-overlay/source-extraction/mock qualifications. The evidence lists each;
this does not claim the entire runtime harness was green. Actual native catalog
and closure checks, plus independent live read-only verification, passed.

Off-host HTTPS compared 1,616/1,616 archived public files across 19/19 hostnames
and verified the apex redirect, manifest, archive and sidecar: 289,403,819 response
bytes in 327.521 seconds. The managed NFT alias was separately verified. Four
production browser cases passed standalone Jobs and Computer at 390/1440 widths:
complete evidence, search, disconnected My Jobs, unsent local drafts, navigation
and layout. Root visually inspected the live board/editor screenshots. There
were zero browser errors, signatures or API mutations. Post-deployment health
returned zero alerts.

No release test created a real paid job or exercised mainnet wallet signing and
financial broadcast. Synthetic positive/adversarial lifecycle, role, payment,
signed-intent and uncertain-broadcast tests remain separately qualified.

Release announcement is authorized and pending publication. This acceptance
bookkeeping describes the same release and does not warrant a second announcement.
