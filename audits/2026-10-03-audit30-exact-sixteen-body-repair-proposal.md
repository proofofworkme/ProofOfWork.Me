# Audit 30: proposed exact sixteen body repair

Status: tested proposal awaiting final human approval. No production data repair, inverse, source cutover, recovery change or additional retirement has been executed.

The proposed operation changes only `body_text` on the 16 existing livenet `mail_items` rows in the original Core-backed manifest: 11 mail messages, 3 files and 2 replies. It restores exact UTF-8 source bytes, including whitespace, for a net increase of 18 bytes. Source events, participants, nonbody fields, nontarget rows, protocol history and ledgers remain unchanged. The existing NULL case remains distinct from an empty string; a separately invoked inverse restores that exact preimage.

The fresh read-only capture at 2026-10-03T08:37:08Z contains all 619 event, mail and transaction rows. Its only differences are the original 16 `body_text` targets; missing, extra, duplicate, invalid and volatile categories are zero. This is a point-in-time observation. The production transaction repeats its exact source/preimage and worker fences.

| Binding | SHA-256 |
| --- | --- |
| Original private plan | `4ac3a8d9b4b79befd36abc590731b1bc8f2e6c83919d5f6427c34c58a6ddba00` |
| Original public sixteen-target manifest | `8d5d347aea2d398d75e69631f90b3efdd1c3254cfdbf3864015199b078699c50` |
| Tested original writer template | `2e9a7fb67616e46b3b14d1074dc5206eb280df6868cc249943645b8d8ab685da` |
| Accepted private read-only closure | `d818545fa493f1032b3b6bfb7b1ba4b8738e3b15968c3f0ed949a0d1bb09bce8` |
| Accepted fresh production projection | `d3b1c6f7b5aae0873fb98ed7b07c47948326ee6832e3b7cec7b363870bcab40c` |
| Proposed root control V3 | `b989a3f2395e7cbf13cb2d3dbd2d258a3fd21867131e41644c094772aba11168` |

The isolated forward COMMIT and separate inverse were both acknowledged, with all 619 mailbox preimages restored. The original 074500 supervisor attempt remains failed because its post-commit verifier used the wrong hash-helper contract. Saved-receipt reconciliation and the later read-only finalization establish the acknowledged operations, restored mail/journal state, sealed-source hashes, stopped private cluster and offline checks without repeating either write.

The observed production identity is `/var/lib/postgresql/16/main`, local socket `/var/run/postgresql`, port 5432, database `proof_indexer`, user `postgres`, listen address `localhost`, NULL server address, default read-only `off` and data checksums `off`. The capture itself used a READ ONLY transaction. The final human receipt must bind these exact nine values.

1. Obtain final approval of this exact manifest, writer and evidence, including apply and a separately invoked conditional inverse before code cutover. No approval receipt or executable production request exists yet.
2. Prepare the immutable package, then repeat the stateless normal-worker observation and exact five service/source/backup/capacity guards. The worker checkpoint minus its 144-block lookback must remain above target height 962933. This repair path has no circular requirement for a pre-repair accepted strict receipt.
3. Run one bounded SERIALIZABLE transaction. Lock the fixed source and readiness tables before reads; verify exact preimages, all nontarget/nonbody fingerprints and canonical trigger closure; update only the 16 existing bodies. The canonical readiness queue flush deliberately causes one legitimate shard invalidation for each committed apply or inverse. No epoch is rewound.
4. Record the acknowledged action, owned-unit stop and fresh root postguards. Unknown COMMIT or failed postacceptance requires explicit reconciliation; there is no automatic retry or inverse.
5. Require fresh 619-row parity and an unwaived full strict pass before separately authorized API/worker cutover and production/UI acceptance. If a conditional inverse is separately invoked before cutover, it must bind the acknowledged apply raw receipt, exact current postimages, same database and same generated writer.

Source checks pass: 48 adapter assertions, 31 caller assertions, 31 root-control cases and 11 bootstrap cases. Actual `d818` plus `d3b1` also pass the unchanged adapter's public-proof validator. These tests and captures do not authorize a production writer.

The [exact nonexecutable JSON proposal](../deploy/audit30/verification/pow-audit30-exact-sixteen-final-review-plan-source-template-v3.json) and [root command specification](../deploy/audit30/verification/pow-audit30-production-sixteen-root-command-spec-v4.json) retain `pending-final-human-approval` and all production authority fields as false.
