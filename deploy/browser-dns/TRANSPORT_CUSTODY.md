# Exact six-payload historical transport custody

The user explicitly approved this separate storage scope on 2026-10-08 after reviewing immutable manifest `cba4fa57c76b3e958df7120dd82224eb8c7f813513747973c66623c1abbbc1cb`. The earlier automatic approval rejection occurred before transfer. The exact approved transfer subsequently passed automatic review and completed. This approval is limited to the six payload trees below; the persistent audit28 hold remains in effect for all other history.

Under `/var/backups/proofofwork-ui/transport-evidence/`, the approved payloads are the source and surfaces directories for each release:

- `38ac6e2bff2a-20261003T190512Z`
- `d5a8493119ba-20261003T222517Z`
- `01ec4968caa9-20261007T150110Z`

Each exact target is `<release>/proofofwork-ui-{source,surfaces}-<release>`. No other path may be removed. The foreign Permission transport `7bad9495d118-20261006T180919Z`, all parent receipts/completion markers/archive-base objects, live UI and every current rollback root, sealed release archives and sidecars, configuration, services, logical backups and retention hold are protected.

The verified owner-local custody is `/home/sixer/ProofOfWork.Me/local/browser-dns-transport-custody/approval-20261008/`, with private 0700 custody directories and 0600 top-level files. Source payloads never enter Git or a public upload. The only Git exclusion appended was `/local/browser-dns-transport-custody/` in the primary checkout's machine-local `.git/info/exclude`; preexisting bytes were preserved. An initial local preflight refused the existing owner-local `local/` parent's 0775 mode before any stream. Its receipt is retained; the completed capture preserves that existing parent's permissions and requires 0700 on the new dedicated directories.

The actual read-only capture acquired no global deployment lock, allowing the concurrent Permission publisher to continue. All 26,702 selected entries, their hashes, modes, original ownership, nanosecond mtimes, xattrs and hardlink topology, the eighteen retained parent objects, source Git commit/tree integrity and the persistent hold matched before and after capture. The complete archive passed independent format/member guards and a local restore verified all bytes and metadata; the archive records original root ownership while the private local rehearsal belongs to its calling owner. All regular source and restored payload files have nlink1.

| Evidence | SHA-256 / value |
| --- | --- |
| Approved immutable manifest | `cba4fa57c76b3e958df7120dd82224eb8c7f813513747973c66623c1abbbc1cb` |
| Source rows | `182e649331bccdeb3f68ad540385fe584faf4624217210fd5c104ff613778746` |
| `historical-ui-payloads.tgz` | `6ca971fe701b6075ab927e52bb36f5e9a492780de158819ee199891b2b5aae5a` |
| Archive bytes | 977,529,931 |
| `custody.json`, canonical JSON hash used by controller | `5e94126771ed54701fbf13ad8b19c71ee0823abc664762119d647c119cecb97d` |
| `custody.json`, actual file bytes | `18510347ba5225541876a517be91594728feee2e45c65b3f4ee803c47f877a99` |
| Reviewed and executed removal controller | `16609ad223632ab7fa071f63bb8d8930c34329ddcc2a64cbf62fefb9d3df87af` |
| Executed capture controller | `1fa1148d62830f7f1846a94b8a38f1d98c484fc509d4eab28037f8e8912ccab0` |
| Final independent production controller/test review | `87168185665710d0bf140dba3aebebdf0a5c5fbc5133f768cfe42622f8ba6868` |
| Independent actual archive/restore review | `a8946cf9a8c51346e0aea67ce0129ab07865a7e880030338fe3971bb6cc94f5f` |
| Independent restored Git HEAD/tree/fsck review | `93c3098feca43b9a332b51efc7bd07eb234aa7fc9e37a06b704504a3d1b016cc` |
| Prepared private execution request | `c2fc30ba518e81fec49ca807e808146a294b550ae5dcfcb342b75942f2f4208f` |
| Exact approved target allocation | 1,627,607,040 bytes |

The approved manifest, custody receipt, archive, capture metadata log, executed capture controller, initial preflight refusal and small actual summary are retained in that durable directory. The archive/full private census/manifest are deliberately excluded from tracked release artifacts. The pre-dispatch checkpoint on 2026-10-08 recorded backup and rehearsal completion while production removal remained held. That checkpoint is preserved here as history; the subsequent operation is recorded below.

## Removal and recovery controls

The sibling controller has no production path override. Mutation requires isolated root, exact approved manifest plus actual custody/archive/controller hash arguments, the normal nonblocking deployment lock and fresh complete protected closure. Root must first coordinate the release handoff, obtain final independent controller review, and direct dispatch. A legitimate prior Permission release is captured as the current protected state; the human approval does not freeze an older live commit.

The controller rechecks the current live/rollback/archive/configuration/service/mount/other-transport closure, retained parent objects, unchanged persistent hold and masked/inactive prune timers. It refuses target references from processes, configs or mounts and source drift. Removal unlinks only frozen descriptor-bound rows, rechecks identities and content, and uses rmdir for directories. An unreviewed entry is preserved and causes refusal. Receipts are creation-only, fsynced and recorded per target in `/var/backups/proofofwork-ui/transport-evidence/browser-dns-relocation-state/<approval-hash>/<execution-id>/`, including explicit partial/refusal evidence.

Full restoration refuses if **any** of the six destinations already exists. This conservative command does not automate partial recovery alongside remaining intact or partially removed trees. Preserve all remaining bytes and the partial receipt; perform a separately reviewed missing-only recovery if needed. No recursive removal of residual or unreviewed entries is authorized by the command.

For full restoration, first run `--mode prepare-restore` with the same pinned approved request. It admits a fresh 10 GiB plus 64 MiB root reserve, a conservative rounded complete copy/metadata bound, the inbound archive and an inode reserve, then prepares the private inbound directory. Transfer only the original verified archive there as `historical-ui-payloads.tgz` without replacing an existing object. This inbound preparation/restore path is not used during normal removal.

`--mode restore` re-admits capacity before extraction, rechecks the exact original archive and tar members/metadata/xattrs, extracts into private empty staging, verifies and fsyncs every staged file/directory, and moves each of the six roots with descriptor-bound `renameat2(RENAME_NOREPLACE)`. Existing targets survive collisions; unsafe parent symlinks or staging drift refuse. Original numeric ownership is restored on host. Failed staging and receipts remain recoverable. No restoration command has been dispatched to production during preparation.

The exact pinned controller passed 28 author tests and 12 independent tests. Independent actual archive/restore and restored-Git checks passed; their private reports are retained in custody. These checks do not imply a production writer or restore command ran. Run checks locally with `python3 transport-relocation-controller.test.py`. Tests use invented local fixtures, cover full backup/restore metadata and xattrs, source/protected drift, new entries after census, directory xattr drift, base/retained-parent relocation at the delete or restore boundary, parent symlinks, atomic no-replace collisions, receipt immutability and capacity/inode refusal. Do not bypass retention or normal release controls to dispatch this release-specific writer.

## Actual removal and postverification — 2026-10-08 UTC

The release owners coordinated a temporary UI publication hold. The exact reviewed
controller completed removal of all six approved extracted payload trees under
the normal deployment lock. Fourteen creation-only receipts account for all
26,702 entries, with no remaining target paths. Eighteen parent objects, the
current ABA live release, all five rollback roots, sealed archives, other transport
evidence, Caddy and systemd configuration, service state, retention hold and
masked/inactive prune timers remained unchanged. This operation did not restore
or remove any additional historical payload.

The retrieved terminal receipt is SHA-256
`aab3ef0391a1d0271cc5b11753d7b1e6491a54b3052ef5efa0aed85dd4711c54`.
Root and independent review of all fourteen receipts produced matching
SHA-256 `0fa1c7535f10941ddeb4a323cebb0d4c7e30c396b9f24094d030e6c2377811b2`.
A subsequent read-only SSH verification, SHA-256
`28efbd655bd379408201c9bc8f678702e129864ab01d9221a59c46c6ebec5525`,
checked actual target absence, both fresh protected-closure passes, all ten
installed deployment helpers, live and rollback fingerprints, unchanged hold
and timers, and actual lock acquisition before and after verification. No
removal actor retained an open controller descriptor.

Actual available root space increased from 11,373,236,224 to 12,969,054,208
bytes, a net increase of 1,595,817,984 bytes. The exact selected payload allocation
was 1,627,607,040 bytes; the control and receipt evidence occupied 22,077,440
allocated bytes at verification. Available inodes were 2,174,940. These observed
values establish this operation's result; each following publication still
requires its own fresh capacity and dependency-graph admission.

The original verification's public HTTP tail failed because it included the
concurrent Permission hostname, whose activation was still pending. That failure
and its SSH success remain preserved separately. Individual HTTPS probes,
SHA-256 `7ffbd722324e7030be438b29056c27d8fca8dddd802c338995fa3d558f7a5f0b`,
confirmed that the actually published Browser, Computer, Pages and DNS hosts
returned clean ABA commit `aba69af9c0caba1145fbf7dd28c0fa3acc963dce` and
tree `c83f46a853322f5b4262391ea42419fbe6c36376`; only the pending Permission
URL returned the recorded TLS failure. The full protected Caddy closure remained
unchanged. This qualification does not claim that Permission HTTPS passed and
does not relax that release's hostname activation or final release-sync gate.
All private dispatch, refusal, completion and postverification evidence remains
in owner-local custody, outside Git and public uploads.

The creation-only local qualification seal is SHA-256
`2599336cdf5599b2b1e6eefb455a553f2d5502f276e398b578748fbee822c029`.
It binds the actual successful SSH proof and individual public probes, explicitly
retains the original failed Permission HTTP tail, and attributes its unactivated
hostname classification to the concurrent release owner. It performs no network
request, production mutation, or automatic release of the other owner's hold.

Independent review of the qualified seal, SHA-256
`f3ca2f01de68040857e526e7a8635d46e0cfb0bb6079f94c4247b83543563afc`,
replayed its local assertions and retained the same limitations. Root explicitly
returned the temporary publication hold to the concurrent Permission release
owner after that review; Browser/DNS integration and deployment continue to
wait for that release's synchronized completion.
