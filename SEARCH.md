# ProofOfWork Search

Search is public, read-only discovery across the ProofOfWork Computer's
metaprotocols and their data. Open `https://search.proofofwork.me` or Computer's
`/?folder=search`. Local standalone preview uses `/?search-app=1`; `search=1`
remains available to earlier Log/Boost routes. Search requires no wallet.

## Searchable records

The derived corpus contains current and historical validator events, decoded
OP_RETURN carriers, undecodable OP_RETURN scripts, source transactions and
verified file records. Protocol prefixes include `pwid1`, `pwdns1`, `pwm1`,
`pwb1`, `pwt1` and `pwa1`; a family with no source records remains supported
without inventing records. IDs, DNS/subdomains, Mail, Files/HTML, Boost/Publish,
Credits/WORK, Infinity/Inception and AMO actions retain their original forms.

Search matches parsed fields, names, identifiers, participants, references,
exact proof quantities, public text, metadata and raw payloads. Readable file
text is indexed only after exact size and SHA-256 verification and valid UTF-8
decoding. Text, HTML, structured data and source-code files remain inert text
inside Search. Binary media remains searchable by metadata and evidence;
Search does not perform OCR or transcription. Browser handles HTML rendering
through its existing sandbox.

Confirmed valid records are the default. The status selector exposes pending,
dropped and orphaned history; the validity selector exposes invalid events
and raw evidence. A decoded carrier has unknown semantic validity, never
automatic protocol authority. Invalid attempts and historical versions remain
inspectable. Exact amounts stay decimal strings; sorting uses exact numeric
values, and UI formatting uses integers.

Results have excerpts, source links, pagination and an inspector for parsed
payload, raw payload and evidence. Query, filters, network and selected record
are shareable URL state. Every result is scoped to its requested network;
failed or changing reads remain visibly unavailable. Production verification
requires the configured first-party full node, so unconfigured networks cannot
claim verified coverage.

## Agent API

`GET /api/v1/search` accepts `network`, `q`, `protocol`, `kind`,
`status=confirmed|all|pending|dropped|orphaned`, `valid=valid|all|invalid`,
`sort=relevance|newest|oldest|proofs`, `limit` from 1 to 50 and an opaque
`cursor`. Defaults are confirmed, valid, relevance and 20 results. The UI
requests 25 results. Literal substring matching complements simple-language
full-text matching; SQL values are parameterized.

The response contains `results`, `pagination` and `coverage`. Coverage names
the index version, completed checkpoint height/hash, indexing time, source
counts, action kinds and protocol counts. Pending visibility is best effort.
`GET /api/v1/search/detail?network=livenet&id=...` returns `record`, `payload`,
`rawPayload`, `evidence` and `coverage`. Stable identities retain the source
event ID, transaction, output and ordinal. Cursors bind to the query, index
generation and source witness; changed or expired evidence requires a new
first page.

## Authority and operation

Search is a disposable projection over existing chain-backed source tables.
It changes no registry, protocol fee, AMO term, wallet balance, economic replay
or confirmed history. Search records and searches add no network-value or
Growth contribution. Existing validators determine event validity. The source
transaction and full-node canonical block remain evidence.

Only the additive `server/sql/proof-search-v1.sql` schema belongs to this
release. Historical indexing is bounded and resumable. The separate Search
job cannot block the canonical indexer's economic summary publication. A
completed corpus must match its source witness and canonical checkpoint;
incomplete or changed evidence fails the read closed. The reported checkpoint
is the indexed boundary, not a claim that every mempool or later block record
has already been indexed.

`npm run search:schema` applies only Search's additive schema.
`npm run search:index -- --batch-size=200 --max-batches=20 --budget-ms=30000`
performs one bounded cycle. The job uses an advisory lock, saves a source
cursor after each committed batch and resumes incomplete generations. A
verified prior generation may supply unchanged confirmed history when its
earlier source witness still agrees. Reorgs and changed historical semantics
require a fresh verified projection.

Only the newest two ready generations and one building generation are retained.
Removing superseded Search copies preserves every underlying transaction,
event, file and canonical economic record. Expired cursors return a conflict.
The separate `proofofwork-search-index.timer` refreshes the projection every
thirty seconds; its service is limited to one database connection, fifteen-second
statements, 512 MiB memory and a forty-five-second runtime. Its failures leave
the canonical economic worker running.

Release verification and exact deployment identities will be recorded after
the approved 2026-10-04 rollout passes production checks.
