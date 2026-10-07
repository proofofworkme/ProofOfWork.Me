# Grouped navigation production release — 2026-10-07

The approved header/footer menus are live on all eighteen public surfaces.
Corrected release `19cc93a7c97f-20261007T161406Z` passed independent production,
HTTPS, browser pointer/focus and post-browser health verification. Five rollback
roots remain preserved; retention stays deferred. This audit retains the earlier
refusals, initial tap defect and their evidence.

## Approved behavior and source

The user approved this exact order with “i approve ship”:

| Menu | Products in order |
| --- | --- |
| UTILITY | COMPUTER, DESKTOP, BROWSER, CODE |
| ID&SOC | ID, DNS, BOOST, PUBLISH |
| FINANCE | WALLET, AMO, CREDIT, WORK, INFINITY, INCEPTION |
| INSIGHTS | LOG, GROWTH, SEARCH |

Header/footer share `APP_MENU_GROUPS` derived from canonical `APP_LINKS`.
Display ID preserves internal IDs callbacks; destinations/local routes and
Computer workspace authority remain unchanged. The brand opens Home; social
links remain direct. Protocols, registries, fees and local signing are unchanged.

| Approved scope | Exact source commit / tree | Merge and validation |
| --- | --- | --- |
| Grouped navigation | `42a52513a801c6ba5d8fcd3fe7979421483c990f` / `185e3ef5da574c984498af0bc44e09964c8cf6f2` | [PR106](https://github.com/proofofworkme/ProofOfWork.Me/pull/106), merge `e7e563b2817e24d95d738ed5c523921961dee756`; CI 37635565894. |
| Dependency guard repair | `01ec4968caa9fca596d6ad4bab434c86d12a7aeb` / `6d53cf4e89dc32e7e2f904a4db24cb9a417d414e` | [PR107](https://github.com/proofofworkme/ProofOfWork.Me/pull/107), merge `8e366b480b75906845f8039063ed87dfff4f1be8`; CI 37641736074/37641920994. |
| Timeout repair | `af22a5726cdab87cd0f1324696ba64f2428aa665` / `0ae4e8b33c090c51cf5bc781793a1229f8556d86` | [PR108](https://github.com/proofofworkme/ProofOfWork.Me/pull/108), merge `495de4c56daaa03c6dd7798631f635c802be1928`; CI 37646213173/37646381909. |
| Mobile stacking correction | `19cc93a7c97f8003a235d6c9ca30fac4f952cb98` / `de453c5eea3ccf9199e1dd2b43e01a256091d228` | [PR109](https://github.com/proofofworkme/ProofOfWork.Me/pull/109), merge `a73d7ec5be5c29d13059e3f18d094198884d1182`; CI 37650549580/37650821534. |

Every merge has its source tree; Node.js 20/22/24 passed. The managed worktree
excluded the original checkout’s approved dirty audit work.

## Local checks, guards and preserved refusals

UI/diff and keyboard/menu cases passed across 320–1440; initial tests omitted
pointer occlusion. An earlier Home-helper failure was corrected and retained.
UI operations/eight retention tests passed; release tests passed 44 cases in 190.217s,
then 47 in 157.256s after the approved timeout patch; syntax passed.

`check:live-data` retains two reproduced **pre-existing Code v1 baseline failures**:
“hot worker summary publication is canonical, conservative, and health-gated” and
“supervised canonical rebuild resets mixed-era state behind a hashed bootstrap”.
Their six-protocol expectations omit `pwc1:`/`pwc1`; no pass or bypass is claimed.

Independent resolver receipt `fabc03b4fc3a9202435c9875411244256dd4f7e54bdc127760b0072fe5fdf740`
measured 1,045 dependencies/3,572 edges: deployed Code 914,196 candidates/63,525,507B;
initial navigation 918,072/63,635,441B. The human separately approved four files
raising only dependencies 1024→1536, with 13 selected boundary checks passing.
Edges 4096, candidates 1048576, index 2 MiB, file 64 MiB, total 512 MiB, path/ownership/
collision/capacity/provenance/rollback guards remain. The separately approved
three-file timeout 120s retains TERM/five-second kill grace. Diagnostic
`13c59fcb35fbe138ce856c3eb4994f8024d550c9cbdbe9d53f0fff0ac8e2821d`
passed locally at 120s in 28.137s **and** 45s in 27.697s; the server timeout was not
reproduced locally. Scaled timeout/missing/collision checks refused safely.

| Historical attempt | Refusal and preserved evidence |
| --- | --- |
| Initial 42 staging | Dependency 1024 ceiling; direct error `2f2e5ea2243ef0abaf9ee5c0f75fe54baa2eb2e7b98309388dca6a19de9b05c4`. Only surfaces transferred; source was never uploaded. Inventory `84d56dd53189be5426f2c3a52d9ac021bf448c1e4015bc2d81fe4698a00e7678` proves absent stage/source/private candidates and unchanged live/three roots. |
| Initial 01ec full-copy staging | Scratch 515,637,248+4,940,906,496>5,368,709,120; evidence `f877bebe538d43df281ed71f765a1c52be8407c033f84f10eb1a0692d26bc16f`. Incoming/eight records/live/three roots preserved; supported authenticated resume followed. |
| First 01ec publisher | Exit 124 at 45s compatibility scan; full log (56,564 bytes) `ffddb8311ad80d407a566edc17a85df6c6939ace5805a774533194b0ed21e7f8`. Verification `a723f6511cd7dda84db5be6c42c31ff972f59a303f8803f8605714d841bf1d2d` confirms unchanged live and preserved source/stage/archive. |
| Initial 19cc full-copy staging | Scratch 521,523,200+4,941,795,328>5,368,709,120; review `ede118e1408cb1caa4ad285119b469d6492cb17a4c839353ea08a7f3114f629e`. Incoming/inodes preserved; unchanged 01ec/four roots; stage/source/private candidates absent. |

Neither scratch refusal changed caps or approved cleanup. A postinstall preflight
also failed without captured stdout; its cause remains unknown. The unchanged-guard
retry passed. These historical refusals did not publish.

## Initial publication and tap correction

Initial release `01ec4968caa9-20261007T150110Z` built 18 surfaces+NFT, receipt
`391ee24d58bdf7df489da224731dc3cc98c04f762de5f4fd7bd2a465a9dcaa1d`.
Source (116,331,483 bytes): `fd67b31ad4bb49652d36e8891295f2c5da65756c25d2ddbb37c3b000535250c5`;
surfaces (232,833,863 bytes): `6f76aa49f9fc1a3463a55d16f99be92bc13329f018051fe4814f7cac4f920c53`.
Publication passed 15:56:23Z, full log (235,887 bytes): `eb701fabfb3a961579c4ec2bfc91deb3688733d98715fedff48ff51178e8e312`;
manifest `6b95971e0cd1ee508063f40a8d4ee28cb65e62618cb430199ae37fbea08cc3b8`,
archive `73dd7daf87d62e16c6c5cbd80bad9f8bfdfb4b642ca1509e0b1723f57471ceed`.
HTTPS 1458/1458 passed (`8e59301d39c0505e87c65d1626190907917c1e74122eb2977e3cc7a4f11ec454`).

Original browser 36/36 geometry/focus cases passed 234 inspections in 127.335s,
receipt `12f538c1f3f364f70ef8d0c4ca4961a8a0e56d23cda95f78122ff1bc3db043a0`.
Follow-up probe `5e7ac3094b0c73914bebf31c2dc2bed1a81617fe23a3dcbaaf3194339994248b`
found Boost SEARCH center y 786.625 hitting Profile: sheet 75 beneath dock 85.
The two-file correction raises mobile scrim/sheet to 89/90; desktop 75 stays.
Actual-hit regression failed before correction, then three cases passed 24.4s.
Landscape fixture taps passed 844×390/640×400, receipt
`23ea84c93e61afd06072ce3b683bd78a61ce75e6c4182cf470be2566f61b1a6f`.

Two initial registry-summary 503s (Inception mobile/Computer desktop) recurred at
exact URL recheck `cd4ead55455d89e4d9563597bf13beead06b65d7f7a01bf14900c60bcda09433`.
Preserve these observations; successful health checks do not establish every
endpoint’s availability.

## Corrected immutable release and final verification

Build receipt `80c85f00546d7259afdb1a5d5252579c23ed2a36425ec8d571c4a7accee7a215`
binds exact 19cc/de453 and 18 builds+NFT:
source (116,300,529 bytes): `04255121306e2a451526c9f162530d89432df7d4badecc14d81d9b9397efaf35`;
surfaces (232,836,034 bytes): `742d3442418832339f6dba466723a0435b644676da98e9ded0e2d77ec75c7c9c`.
Preserved plan `4b720160d37340980d0877b6ad8b923c88a3644f3e303fe8dcd51e29342f1e3a`
passed independent review `4fd03bbef7fd59da9afbfacf352de8035bc6f85d52de2144495ff62b1c2eb610`.
Stage/source passed 4m22.818s/2m57.797s; log hashes
`46545f2e0fcd50119dcf7da809b2fecf008d2164d32781bd35ee81c48a2a8d57` /
`24ef6ed10d87568fc82fbe6a2ac6c1c0e9e498fa6d702673b5cea0ed5b86ae28`.

Publication completed 16:51:40Z, exit 0/`failure:null`, 8m43.054s.
Full publisher (255,636 bytes): `e45e5e35fbafaefd2f77f8d9705041a376f8c89cdc40c53479a3baab1be1b657`;
manifest `832192886705912b8793cc3d1e5cd9aadb87996648ee87b195192c44c98061ca`;
archive (237,912,381 bytes): `99879912ce86548396d817fb72fd5db5f66a34f61bf1ba561c1e126af6eb0801`.
Live root `a6ea770a044780ab1f41176823f6cb17430ca50dd448ac4ee422858c2938dc24`:
1812 entries/481876684B. Four historical roots plus fifth exact 01ec root
`f230b17e6ff7ace7bfef319c0020009b00aa49e427d175be75414e636b665714`
(1945 entries/485324747B, initial manifest above) remain retained.

| Final evidence | SHA-256 and result |
| --- | --- |
| Independent production v3 | `bded24826a801df4ce4238adb538085b8b16ac63595e00033f464dca0558744a`: clean 19cc source, stage/candidate absent, five roots retained; helpers/Caddy/timers/hold unchanged. |
| Archive review | `1c2f959aa210a935688604ee864e6578b53906f866cc36ece51cad03632ce49f`: all 19 fingerprints; NFT matches Computer bytes/modes. |
| HTTPS | `f68f93a03fa66612fb1d08f8a5609d6d5457bf1ad85f2bc30c7fd7f71702effc`: 1332/1332 files/18 hosts, 74 NFT skips, 272,953,428 response bytes; apex/final reverify passed 16:56:44.358Z. |
| Independent HTTPS | `32d9f2c3bb78d002ba619bf124ae93e40dc5a806f66edfd78cfdea8edf0c6c57`: archive/source/manifest/build/plan/production bindings agree. |
| Main browser | `25ad9c9f7e0427fb5fb05cf9ce70735643462333e7c5510218bd6deef95564f2`: 36/36, 234 menus, 217 center hits, 5 Boost backdrop checks, 149.72s. |
| Boost 320/390/480 | `e2c6a69ecb01ceeaad604216210f42df34a3fc212e14d7391ce59d2d74de760d`: 3/3, 21 center hits/6 backdrop checks, 9.754s. |
| Post-browser health | `b5eefe54c899acf1c359e3f2839f9b00a11a4ebdf8337b99bbe30558e08b659d`: tip 970367/hash `000000000000000000010c34d419f72bfb4a69084ca3a679bb4f2496491c29fc`, zero lag/missing Log/failed checks. |

Both final browser runs observed zero JS/console/HTTP≥400 errors, without API
fixtures or signing. All twelve screenshots were inspected unobstructed; earlier 503s remain historical observations, with no universal API uptime claim.

Durable publication intent/receipt/log remain under
`/var/tmp/proofofwork-deploy/recovery-publish-19cc93a7c97f-20261007T161406Z-preserved-v1/`;
receipt SHA `db81b75f733e2b84f8c53e4bb5d27e4153f8e3e48b2d7557d8064fca46f50770`.
Durable transport/refusal phase receipts remain under
`/var/tmp/proofofwork-deploy/recovery-transport-<release>-<phase>-<attempt>/`.
Preserved source, incoming and allocation evidence remains under
`/var/backups/proofofwork-ui/transport-evidence/`; archives/sidecars remain under
`/var/backups/proofofwork-ui/releases/`.

The first independent final verifier incorrectly assumed `private_paths==[]`.
V3 verifies the canonical 0700 parent
`/var/backups/proofofwork-ui/transport-evidence/19cc93a7c97f-20261007T161406Z/.proofofwork-ui-stage-19cc93a7c97f-20261007T161406Z.preserved-v1/`,
containing only the 0600
`completed-candidate-allocation.json`, SHA `43851374b7a745e9cae2e0e8be2124a0c8a18282984e92506497e5ba55050c9b`,
bound to authenticated transport measurement. Stage/candidate are absent; retained
allocation evidence is intentional. Earlier failure/diagnostic remain preserved, diagnostic SHA
`32e0f5aa73df6edfb2b90a0bf34005b07b6d7829f07ef3d90235f25699f84113`;
verification correction made no server mutation or cleanup.

## Documentation, hygiene and announcement

SOUL/README/MAIL grouping and canonical protocol/product docs were reviewed.
OP_RETURN qualifies historical 16/17 recipes, retaining their receipts; current
18+NFT/1536/120s documentation agrees with source. No further memory edit is needed.
Hygiene removed only ignored rebuildable dist/Vite state, including 7.08 MiB for
the overlay fix; checks/hooks/trailers passed. No tracked deletion, evidence
cleanup or original-checkout edit occurred. This audit is classified as retained
evidence; generated artifacts and cleanup allowlist remain unchanged.

[One verified release announcement](https://x.com/proofofworkme/status/2107865006142583033)
announces 17 products/four menus/header/footer/desktop/mobile with `$WORK $POWB $INCB`;
verification SHA `6d45be7963ce5fc873b417c40e157fcd373b7290cd8b591406b120384f73af92`.
The same feature’s correction and documentation bookkeeping receive no second post.
